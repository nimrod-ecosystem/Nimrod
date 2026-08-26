// input.js - the INPUT BUS: physical devices -> bind, gate, time, log -> actions.
//
// The layer between "someone pressed a thing" and "an action happened". bus.js already
// carries the action onward; actions.js says what is bindable. This file is the five
// decisions in between, and it exists because every one of them is a real clinical
// requirement, not plumbing:
//
//   1. BIND      which control drives which action, captured Overwatch-style
//                (pick the action, press the thing) - bindings persist by action id.
//   2. GATE      a live three-way role switch: moderator only / participant only / both.
//                A caregiver locks the participant's inputs during setup, hands control
//                over for a session, or runs both at once.
//   3. TIME      PER BINDING, not globally: press vs release edge, minimum hold,
//                debounce, repeat-lockout.
//   4. ACT       publish to the action's topic. Modules are untouched and unaware.
//   5. LOG       EVERY activation, INCLUDING the ones this file threw away, with the
//                reason. False-activation rate is a metric nobody in the field
//                measures; it only exists if rejections are recorded as data.
//
// PRESS VS RELEASE IS PER BINDING, and that is the whole point. For someone whose hand
// closes involuntarily, press is a noisy channel and release is a clean one. Grid 3 and
// Android ship this; Apple does not. A global setting cannot express "this switch on the
// headrest fires on press, the one in her hand fires on release".
//
// HOLD MEANS ONE THING ON BOTH EDGES: `holdMs` is the minimum time the control must be
// held. The edge decides only WHEN it fires - press fires the moment the threshold is
// met, release fires on let-go. Anything shorter is rejected as `too-short` and logged.
//
// MAX-HOLD AUTO-RELEASE (carried over from Cici's cici_input.js, and the only thing that
// needed carrying): a press that never sends its release - a stuck switch, or Christine
// not letting go, which is a case that actually happened - leaves a consumer held
// forever. Every press arms a watchdog; if no release arrives within maxHoldMs we
// synthesize one. A synthesized release DOES NOT fire release-edge bindings: nobody let
// go, so firing would be a false activation. It is logged as `auto-release`, which is
// exactly the kind of event the rejection log exists to count.
// (Deliberately not watchdog.js - that primitive is "this should have made progress by
// now", single-key, with retries. This needs one independent timer per held control and
// has no notion of retrying.)
//
// WHY NOT bus.addBinding(): the bus routes synchronously through a pure transform, so it
// can express neither "fire 400ms from now if still held" nor "this was rejected, and
// here is why". The input bus therefore does its own matching and calls bus.publish()
// with the result. Everything downstream is unchanged.
//
// Timers and the clock are injectable so the whole file is testable against a fake clock.

import { ROLE_CYCLE_ACTION, ROLE_CYCLE_TOPIC } from './actions.js';
import { gatePermits, senderMeta, ROLES, GATES } from './sender.js';

// IMPORTED, then re-exported. `sender.js` owns these because the pure gate rule needs them
// and this file needs the pure gate rule; declaring them here made the two files import each
// other. Everything that already said `import { ROLES, GATES } from './input.js'` keeps
// working, which is the point of re-exporting rather than moving the import sites.
//
// A bare `export { ROLES, GATES } from './sender.js'` was the first attempt and it is a real
// trap: a re-export creates NO LOCAL BINDING, so this file re-exported names it could not
// itself see, and `GATES.includes(gate)` twenty lines down threw at construction. Caught by
// a test that built an input bus, which is the only reason it was not a blank screen.
export { ROLES, GATES };
export const EDGES = ['press', 'release'];

// The closed set of reasons an activation was thrown away. Closed on purpose: the
// outbound payload allowlist validates against it, so a new reason cannot leak free text.
export const REJECTIONS = [
  'unbound',          // nothing is bound to that control
  'role-gated',       // the gate does not currently permit that role
  'unknown-action',   // binding points at an action id no longer registered (stale profile)
  'debounce',         // a second edge too soon after the last one - switch bounce
  'lockout',          // repeat too soon after this binding last fired
  'too-short',        // released before holdMs
  'auto-release',     // the max-hold watchdog synthesized this release; nobody let go
];

export const ACTIVATION_TOPIC = 'access/activation';   // live diagnostic nudge, NOT the record

const DEVICE_CLASSES = ['gamepad', 'keyboard', 'switch', 'hid', 'serial', 'bluetooth', 'pointer'];
// A device name is "class" or "class:instance" ("gamepad:0", "hid:0x1234"). Only the
// CLASS ever leaves the machine - an instance can carry a product string.
export function deviceClass(device) {
  const head = String(device || '').split(':')[0].toLowerCase();
  return DEVICE_CLASSES.includes(head) ? head : 'other';
}

const ck = (device, control) => `${device} ${control}`;
const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : dflt);

// A binding with every field filled in, validated. Exported because the bus is not the
// only thing that holds bindings: a saved profile and an editor UI hold the same shape,
// and if THEY carry half-populated objects the bus quietly normalizes its own copy while
// the stored one keeps rendering `undefined` into a number field. One definition.
export function normalizeBinding(b = {}, fallbackId = '') {
  const id = String(b.id || fallbackId);
  const actionId = String(b.actionId || '');
  const device = String(b.device || '');
  const control = String(b.control || '');
  if (!id) throw new Error('binding: an id is required');
  if (!actionId) throw new Error('binding: actionId is required');
  if (!device || !control) throw new Error(`binding "${actionId}": device and control are required`);
  const edge = b.edge === undefined ? 'press' : String(b.edge);
  if (!EDGES.includes(edge)) throw new Error(`binding "${actionId}": bad edge "${b.edge}"`);
  const role = b.role === undefined ? 'universal' : String(b.role);
  if (!ROLES.includes(role)) throw new Error(`binding "${actionId}": bad role "${b.role}"`);
  return {
    id, actionId, device, control, edge, role,
    holdMs: num(b.holdMs, 0),
    debounceMs: num(b.debounceMs, 0),
    lockoutMs: num(b.lockoutMs, 0),
    payload: b.payload,
    label: b.label ? String(b.label) : '',
  };
}

export function createInputBus({
  bus,
  actions,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onActivation = null,       // the log sink - receives every decision, accepted or not
  maxHoldMs = 12000,
  gate = 'both',
} = {}) {
  if (!bus) throw new Error('createInputBus: bus is required');
  if (!actions) throw new Error('createInputBus: an action registry is required');
  if (!GATES.includes(gate)) throw new Error(`createInputBus: bad gate "${gate}"`);

  const bindings = new Map();   // bindingId -> binding
  const held = new Map();       // controlKey -> {at, decided:Set, timers:[], maxTimer}
  const lastDown = new Map();   // controlKey -> t of the previous DOWN (debounce)
  const lastFire = new Map();   // bindingId  -> t it last fired (lockout)
  let seq = 0;
  let hold = num(maxHoldMs, 12000);

  // ---- bindings ----------------------------------------------------------------

  function addBinding(b) {
    const binding = normalizeBinding(b || {}, `b${++seq}`);
    bindings.set(binding.id, binding);
    return binding.id;
  }

  function removeBinding(id) {
    lastFire.delete(id);
    return bindings.delete(id);
  }

  // Hot-swap: replacing the whole set is how a profile switch happens, and it has to be
  // instant. Pending hold timers from the OLD set are harmless - attempt() re-checks
  // that the binding is still installed, by identity, before publishing anything.
  function setBindings(list) {
    bindings.clear();
    lastFire.clear();
    (list || []).forEach(addBinding);
  }

  const listBindings = () => [...bindings.values()].map((b) => ({ ...b }));
  const bindingsFor = (device, control) =>
    [...bindings.values()].filter((b) => b.device === device && b.control === control);
  const hasBinding = (device, control) => bindingsFor(device, control).length > 0;

  // ---- the role gate -----------------------------------------------------------

  let currentGate = gate;

  // The gate control is exempt from the gate. Binding role-cycle as `participant` and then
  // switching to moderator-only would otherwise strand the gate with no way back - a
  // caregiver locked out of their own lock is worse than no lock at all.
  // THE RULE MOVED, THE BEHAVIOUR DID NOT. `gatePermits` in sender.js is this function with
  // its arguments made explicit, and the reason to extract it is Mike's: "the only
  // restrictions are what's set in the person's section." One place to set them has to mean
  // ONE RULE, and a rule that lives inside a closure here cannot also judge a driver arriving
  // over a socket. Both paths now call the same function, and it is testable without
  // building an input bus.
  function permitted(b) {
    return gatePermits(currentGate, b.role, { exempt: b.actionId === ROLE_CYCLE_ACTION });
  }

  function setGate(g) {
    if (!GATES.includes(g)) throw new Error(`setGate: bad gate "${g}"`);
    currentGate = g;
    return currentGate;
  }
  function cycleGate() {
    return setGate(GATES[(GATES.indexOf(currentGate) + 1) % GATES.length]);
  }

  // ---- the log -----------------------------------------------------------------

  function report(rec) {
    const out = {
      at: rec.at,
      device: rec.device,
      deviceClass: deviceClass(rec.device),
      control: rec.control,
      actionId: rec.actionId ?? null,
      bindingId: rec.bindingId ?? null,
      edge: rec.edge ?? null,
      role: rec.role ?? null,
      gate: currentGate,
      accepted: !!rec.accepted,
      reason: rec.reason ?? null,
      heldMs: rec.heldMs ?? null,
      latencyMs: rec.latencyMs ?? null,
    };
    try { onActivation?.(out); } catch (err) { console.error('access log sink threw', err); }
    bus.publish(ACTIVATION_TOPIC, out);
    return out;
  }

  // ---- the decision ------------------------------------------------------------

  // The one place an activation is allowed or refused, so the order of checks is stated
  // once. Called at the exact instant the action would happen - never earlier - which is
  // what makes "the caregiver opened the gate mid-hold" behave correctly.
  function attempt(b, ctx) {
    const { at, device, control, downAt, heldMs } = ctx;
    const base = {
      at, device, control, actionId: b.actionId, bindingId: b.id,
      edge: b.edge, role: b.role, heldMs, latencyMs: at - downAt,
    };
    if (bindings.get(b.id) !== b) return null;             // removed mid-hold; not an event
    if (!permitted(b)) return report({ ...base, reason: 'role-gated' });

    const action = actions.get(b.actionId);
    if (!action) return report({ ...base, reason: 'unknown-action' });

    const last = lastFire.get(b.id);
    if (b.lockoutMs > 0 && last != null && at - last < b.lockoutMs) {
      return report({ ...base, reason: 'lockout' });
    }

    lastFire.set(b.id, at);
    // WHO PRESSED IT, travelling with what happened. A control in the room is a `local`
    // sender carrying the BINDING's role, so a module - or a second cursor, later - can tell
    // this apart from the same verb arriving over a wire. Every module ignores it today,
    // which is the point: it costs them nothing.
    bus.publish(
      action.topic,
      b.payload !== undefined ? b.payload : action.payload,
      // The label is the RAW control id, deliberately. Making it human is controls_view's
      // job (it already owns `controlLabel`), and importing that here would point a lower
      // layer at a higher one for the sake of a prettier string nobody reads at this depth.
      senderMeta({ kind: 'local', id: `${device}:${control}`, role: b.role }),
    );
    return report({ ...base, accepted: true });
  }

  // ---- capture: "press the thing you want to bind" -----------------------------
  //
  // Overwatch's binding gesture, and it has to live HERE rather than in the binder UI
  // for one reason: while you are choosing a control, NOTHING may act. If capture
  // listened alongside the normal path, pressing the switch you are about to bind would
  // also fire whatever it is currently bound to - so binding a control would set off the
  // old action every time, which for a caregiver reassigning a live screen is chaos.
  // Sitting in front of the binding lookup makes "nothing acts while binding" structural
  // rather than something every device adapter has to remember.
  //
  // A capture also MEASURES. onDone reports how long the control was actually held, so
  // the binder can offer "you held that 340ms - set the minimum hold to 250ms?" instead
  // of asking someone to guess a number in milliseconds for a hand they do not have.
  //
  // It always times out. A capture left armed by a dialog nobody closed is a screen with
  // dead inputs, which at a bedside is the worst failure this file can produce.
  let capture = null;   // {onCandidate, onDone, onTimeout, started:Set, timer}

  function beginCapture({ onCandidate = null, onDone = null, onTimeout = null, timeoutMs = 15000 } = {}) {
    cancelCapture();
    const c = { onCandidate, onDone, started: new Set(), timer: null };
    c.timer = setTimer(() => { cancelCapture(); onTimeout?.(); }, num(timeoutMs, 15000));
    capture = c;
    return () => { if (capture === c) cancelCapture(); };
  }

  function cancelCapture() {
    if (!capture) return;
    clearTimer(capture.timer);
    capture = null;
  }

  // ---- raw device edges (device adapters call these) ---------------------------

  function down(device, control) {
    const key = ck(device, control);
    if (held.has(key)) return;            // already down - an adapter repeat, not a new press
    const at = now();

    const h = { at, decided: new Set(), timers: [], maxTimer: null };
    // Armed before any early return: the control is PHYSICALLY down whether or not
    // anything is bound to it, and a stuck unbound switch must still clear.
    h.maxTimer = setTimer(() => up(device, control, { auto: true }), hold);
    held.set(key, h);

    // Before the binding lookup, and before the log: a press made while choosing a
    // control is configuration, not an activation. Recording it would inflate the
    // false-activation rate with the caregiver's own setup fiddling.
    if (capture) {
      capture.started.add(key);
      capture.onCandidate?.({ device, control });
      return;
    }

    const prevDown = lastDown.get(key);
    lastDown.set(key, at);

    const matches = bindingsFor(device, control);
    if (!matches.length) {
      report({ at, device, control, reason: 'unbound', heldMs: 0, latencyMs: 0 });
      return;
    }

    for (const b of matches) {
      // Debounce is judged on the physical edge, before anything is armed - a bounce
      // must not start a hold timer.
      if (b.debounceMs > 0 && prevDown != null && at - prevDown < b.debounceMs) {
        h.decided.add(b.id);
        report({
          at, device, control, actionId: b.actionId, bindingId: b.id,
          edge: b.edge, role: b.role, reason: 'debounce', heldMs: 0, latencyMs: 0,
        });
        continue;
      }
      if (b.edge === 'release') continue;               // decided on the way up
      if (b.holdMs > 0) {
        h.timers.push(setTimer(() => {
          h.decided.add(b.id);
          attempt(b, { at: now(), device, control, downAt: at, heldMs: b.holdMs });
        }, b.holdMs));
        continue;
      }
      h.decided.add(b.id);
      attempt(b, { at, device, control, downAt: at, heldMs: 0 });
    }
  }

  function up(device, control, { auto = false } = {}) {
    const key = ck(device, control);
    const h = held.get(key);
    if (!h) return;                        // a release with no press - adapters do this
    clearTimer(h.maxTimer);
    h.timers.forEach(clearTimer);          // hold-to-activate that never reached threshold
    held.delete(key);

    const at = now();
    const heldMs = at - h.at;
    const ctx = { at, device, control, downAt: h.at, heldMs };

    if (capture) {
      // Only a control whose press BEGAN during the capture resolves it. Letting go of
      // something already held when the dialog opened is not a choice.
      if (capture.started.has(key)) {
        const done = capture.onDone;
        cancelCapture();
        done?.({ device, control, heldMs });
      }
      return;
    }

    for (const b of bindingsFor(device, control)) {
      const base = {
        at, device, control, actionId: b.actionId, bindingId: b.id,
        edge: b.edge, role: b.role, heldMs, latencyMs: heldMs,
      };
      if (b.edge === 'press') {
        // Only a hold-to-activate that never got there is news; anything already
        // decided on the way down already has its log line.
        if (b.holdMs > 0 && !h.decided.has(b.id)) report({ ...base, reason: 'too-short' });
        continue;
      }
      // release edge
      if (auto) { report({ ...base, reason: 'auto-release' }); continue; }
      if (b.holdMs > 0 && heldMs < b.holdMs) { report({ ...base, reason: 'too-short' }); continue; }
      attempt(b, ctx);
    }
  }

  // "Unstick now" - the caregiver-facing safety hatch, same as Cici's releaseAll().
  function releaseAll() {
    for (const key of [...held.keys()]) {
      const i = key.indexOf(' ');
      up(key.slice(0, i), key.slice(i + 1), { auto: true });
    }
  }

  // The gate control arrives as an action like any other - that is what makes it
  // bindable to a physical switch instead of only a keyboard.
  const offGate = bus.subscribe(ROLE_CYCLE_TOPIC, () => cycleGate());

  function destroy() {
    cancelCapture();
    releaseAll();
    offGate();
    bindings.clear();
    lastDown.clear();
    lastFire.clear();
  }

  return {
    addBinding, removeBinding, setBindings, listBindings, hasBinding,
    // What is already on this control, so the binder can say "that is Next photo -
    // replace it?" rather than silently stacking a second action onto one switch.
    bindingsAt: (device, control) => bindingsFor(device, control).map((b) => ({ ...b })),
    beginCapture, cancelCapture, isCapturing: () => !!capture,
    down, up, releaseAll,
    setGate, cycleGate, getGate: () => currentGate, permitted,
    setMaxHold: (ms) => { const v = num(ms, 0); if (v > 0) hold = v; return hold; },
    getMaxHold: () => hold,
    heldControls: () => [...held.keys()].map((k) => { const i = k.indexOf(' '); return [k.slice(0, i), k.slice(i + 1)]; }),
    destroy,
  };
}
