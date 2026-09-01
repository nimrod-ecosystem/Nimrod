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
//   6. MEASURE   every physical edge on a SECOND topic, whether or not it acted. A module
//                may measure what it does not react to. See EDGE_TOPIC below - the
//                distinction between "what the bus decided" and "what the hand did" is the
//                reason there are two streams and not more fields on one.
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
// needed carrying): a press that never sends its release - a stuck switch, or somebody
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

// THE MEASUREMENT CHANNEL. Every physical edge, whether or not anything acted on it.
//
// WHY A SECOND TOPIC RATHER THAN MORE FIELDS ON THE FIRST. `access/activation` is a record
// of what THE BUS DECIDED - it fires once per decision, and a press-edge binding decides on
// the way down and never again. That is correct for what it is and useless as a record of
// what a HAND did. The two are different measurements and one of them was missing:
//
//   * `heldMs` on an activation is THE BINDING'S THRESHOLD, NOT A MEASUREMENT. A binding with
//     holdMs 250, held for 900ms, reports 250 - because `attempt()` is handed `b.holdMs` on
//     the way down. With holdMs 0 it reports 0. Either way the number is the caregiver's
//     configuration read back, and a study filtering on it would be measuring the setup.
//   * `latencyMs` on an activation is down -> decision, NOT stimulus -> press. A module's
//     own clock is the only thing that knows when it asked.
//   * The release of a press-edge binding produces NO record at all (input_test asserts it),
//     so how long she held it, and how long it took her to let go, did not exist anywhere.
//
// RELEASE IS ITS OWN MEASUREMENT, not a footnote to the press (Mike, 2026-08-29): somebody who
// has to commit hard to close a switch may struggle to open it, and that difficulty is data.
//
// A MODULE MAY MEASURE WHAT IT DOES NOT REACT TO. That is the whole point of the separation -
// an echo press 200ms after the payoff changes nothing on screen and is perseveration in the
// record. Modules subscribe to this only if they have something to do with it; publishing to
// a topic with no sinks returns immediately, so nothing pays for what it does not use.
//
// THE FIELD IS `phase`, NOT `edge`, AND THE NAME IS DELIBERATE. An activation's `edge` is
// press|release (which edge of the binding fired); a physical edge is down|up. Reusing one
// name for two value sets would let a record be fed to the wrong reader - and `toOutbound`'s
// allowlist DROPS AN EVENT WHOLE when a present field fails its check, so the failure would
// be silent. A different name makes a bad join a loud `undefined` instead.
export const EDGE_TOPIC = 'access/edge';
export const PHASES = ['down', 'up'];

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
  // ONE ID PER PHYSICAL PRESS, carried by the down edge, the up edge, and every activation
  // that press produced. Without it the two channels can only be joined on a timestamp, and
  // a timestamp join is a guess - two switches pressed in the same millisecond, or one
  // control with two bindings on it, and the guess is wrong with no way to tell.
  let pressSeq = 0;
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

  // The physical edge. Reports what the control did, never what the bus concluded - the two
  // travel separately on purpose and join on `pressId`.
  function reportEdge(rec) {
    const out = {
      at: rec.at,
      pressId: rec.pressId,
      phase: rec.phase,                 // 'down' | 'up'
      device: rec.device,
      deviceClass: deviceClass(rec.device),
      control: rec.control,
      // MEASURED, and only ever on the way up. Null on a down, because at that instant the
      // hold does not have a duration yet and writing 0 would be the tautology this channel
      // exists to stop telling.
      heldMs: rec.phase === 'up' ? rec.heldMs : null,
      // A synthesized release - the max-hold watchdog or a blur. NOBODY LET GO, so a
      // consumer counting release latency must throw this row out rather than average it in.
      auto: !!rec.auto,
      // Whether anything was bound to this control at the time. An UNBOUND press is still a
      // real thing a person did, and this channel is the only place it survives with timing.
      bound: rec.bound,
      // ---- WHAT WAS ASKED OF THIS PRESS ------------------------------------------------
      //
      // WITHOUT THESE, `heldMs` CONFLATES TWO OPPOSITE THINGS (Mike, 2026-08-29): held long
      // because the SYSTEM ASKED for a hold, and held long because LETTING GO WAS HARD. A
      // long hold is evidence of difficulty only if nothing was demanding it.
      //
      // `requiredHoldMs` is the longest holdMs among the bindings on this control AT PRESS
      // TIME - what the configuration demanded of this particular press. 0 means nothing was
      // asked, which is the case where a long hold is worth a clinician's attention.
      //
      // NOTHING HERE CLASSIFIES THE HOLD, and that is on purpose. "Intentional" vs
      // "difficulty" is a judgement about a person, and this file has no business making it -
      // the same reason the export is evidence candidates and not scores. We record what was
      // asked; somebody who knows her decides what the excess means.
      //
      // The excess is DELIBERATELY NOT STORED. A reader subtracts. A derived column drifts
      // from its inputs, and this repo already learned to let the reader derive.
      requiredHoldMs: rec.requiredHoldMs,
      // How many OTHER controls were down at this instant. Non-zero means two separate
      // physical controls were held together - two switches, a two-handed grip, a chorded AAC
      // device - where a hold may be structural rather than either of the above.
      //
      // *** IT IS NOT THE CTRL+S CASE, AND THAT IS WORTH SAYING BECAUSE IT LOOKS LIKE IT IS. ***
      // `input_keyboard.js` bakes modifiers INTO the control name - ctrl+s is the single
      // control "key:ctrl+s", with one down and one up - and `keyControl` returns null for a
      // bare modifier, so a held Ctrl is never a control at all. `concurrent` reads 0 for that
      // whole family. It needs no disentangling either: the heldMs of "key:ctrl+s" is how long
      // S was held, which is an honest number with nothing folded into it.
      concurrent: rec.concurrent,
    };
    bus.publish(EDGE_TOPIC, out);
    return out;
  }

  function report(rec) {
    const out = {
      at: rec.at,
      // Which physical press this decision came from - see pressSeq.
      pressId: rec.pressId ?? null,
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
    const { at, device, control, downAt, heldMs, pressId } = ctx;
    const base = {
      at, device, control, pressId, actionId: b.actionId, bindingId: b.id,
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

    const h = { at, pressId: ++pressSeq, decided: new Set(), timers: [], maxTimer: null };
    // Armed before any early return: the control is PHYSICALLY down whether or not
    // anything is bound to it, and a stuck unbound switch must still clear.
    h.maxTimer = setTimer(() => up(device, control, { auto: true }), hold);
    held.set(key, h);

    // Before the binding lookup, and before the log: a press made while choosing a
    // control is configuration, not an activation. Recording it would inflate the
    // false-activation rate with the caregiver's own setup fiddling.
    //
    // THE EDGE CHANNEL IS EXCLUDED FOR THE SAME REASON, and it is worth being explicit:
    // a caregiver mashing a switch to bind it is not the person using the screen, and a
    // measurement channel that cannot tell those apart is worse than one that misses the
    // setup entirely. Capture presses appear on neither stream.
    if (capture) {
      capture.started.add(key);
      capture.onCandidate?.({ device, control });
      return;
    }

    const prevDown = lastDown.get(key);
    lastDown.set(key, at);

    const matches = bindingsFor(device, control);
    // Captured at PRESS time, not release time: bindings hot-swap when a profile changes, and
    // what matters is what was being asked of her when she pressed.
    h.requiredHoldMs = matches.reduce((m, b) => Math.max(m, b.holdMs || 0), 0);
    // Emitted before the binding lookup decides anything, so an unbound press is on the
    // measurement channel with the same shape as a bound one.
    reportEdge({
      at, pressId: h.pressId, phase: 'down', device, control,
      bound: matches.length > 0, requiredHoldMs: h.requiredHoldMs,
      concurrent: held.size - 1,          // this control is already in `held`
    });

    if (!matches.length) {
      report({ at, device, control, pressId: h.pressId, reason: 'unbound', heldMs: 0, latencyMs: 0 });
      return;
    }

    for (const b of matches) {
      // Debounce is judged on the physical edge, before anything is armed - a bounce
      // must not start a hold timer.
      if (b.debounceMs > 0 && prevDown != null && at - prevDown < b.debounceMs) {
        h.decided.add(b.id);
        report({
          at, device, control, pressId: h.pressId, actionId: b.actionId, bindingId: b.id,
          edge: b.edge, role: b.role, reason: 'debounce', heldMs: 0, latencyMs: 0,
        });
        continue;
      }
      if (b.edge === 'release') continue;               // decided on the way up
      if (b.holdMs > 0) {
        h.timers.push(setTimer(() => {
          h.decided.add(b.id);
          attempt(b, { at: now(), device, control, downAt: at, heldMs: b.holdMs, pressId: h.pressId });
        }, b.holdMs));
        continue;
      }
      h.decided.add(b.id);
      attempt(b, { at, device, control, downAt: at, heldMs: 0, pressId: h.pressId });
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
    const ctx = { at, device, control, downAt: h.at, heldMs, pressId: h.pressId };

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

    const matches = bindingsFor(device, control);
    // THE ROW THAT DID NOT EXIST BEFORE. Emitted for every release including one no binding
    // cares about, and it carries the hold she ACTUALLY produced rather than the threshold
    // somebody configured.
    reportEdge({
      at, pressId: h.pressId, phase: 'up', device, control, heldMs, auto,
      bound: matches.length > 0,
      // The value from PRESS time, carried on `h` - so a profile swapped mid-hold cannot
      // rewrite what was asked of a press that already happened.
      requiredHoldMs: h.requiredHoldMs ?? 0,
      concurrent: held.size,              // this control has already been removed
    });

    for (const b of matches) {
      const base = {
        at, device, control, pressId: h.pressId, actionId: b.actionId, bindingId: b.id,
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
