// input_runtime.js — the input stack WITHOUT any user interface.
//
// WHY THIS FILE EXISTS. Everything that turns a device into a verb — the input bus, the
// device adapters, the focus router, the person's stored bindings — was constructed inside
// `inputs.js`, which is a PANEL ON THE HOME PAGE. The kiosk, the surface at the bedside,
// imported none of it. So the promise the verb layer was built to make — "set your switch
// up once, ever, and it follows you to any screen on any machine" — was true where a
// clinician configures and false where a person actually lives.
//
// The modules were never the problem. A module subscribes to `photos/next` on its scoped
// bus and has no idea a switch exists, which is exactly right and is why it can be used
// anywhere. What was missing was somebody CONSTRUCTING the device half on the other
// surface. That is all this is: the same primitives, assembled, with no DOM of its own.
//
// THREE THINGS IT DOES THAT A SECOND COPY OF THE WIRING WOULD NOT:
//
// 1. IT SHARES `normalizeRecord` WITH THE BINDER. What a stored record MEANS has exactly
//    one definition. Two surfaces reading the same row with two interpretations is the
//    bug that ends with a switch working in the clinic and not at the bed.
//
// 2. IT RE-READS THE RECORD WHEN THE SERVER CHANGES IT. The state handle already polls,
//    so a clinician editing bindings on a laptop lands on the person's screen within a
//    poll or two, with nobody reloading anything. That is the clinical scenario — one
//    person configuring while another uses it — and it needed no new transport, because
//    the bindings are per-PERSON and the server is already the thing both surfaces share.
//
// 3. IT IS HEADLESS AND INJECTABLE, so it can be tested without a screen and mounted by
//    any surface: kiosk today, a bare module host tomorrow.
//
// WHAT IT DELIBERATELY DOES NOT DO: no binding EDITOR. Capturing a control, naming it and
// saving it is the binder's job and stays on the home side. This runtime only consumes.

import { createInputBus, normalizeBinding, GATES } from './input.js';
import { createVerbRouter } from './input_router.js';
import { attachKeyboard } from './input_keyboard.js';
import { attachPointer } from './input_pointer.js';
import { createGamepads } from './input_gamepad.js';
import { createDefaultRegistry, MODULE_VERBS } from './actions.js';

export const INPUTS_KEY = 'input-bindings';
export const RECORD_VERSION = 2;      // 1 was per-screen, bound to module-specific actions

// THE ONE DEFINITION OF WHAT A STORED RECORD MEANS. `inputs.js` imports this rather than
// keeping its own copy — see note 1 above.
//
// `fallback` is what an account with nothing saved gets. Bindable never means arrives
// unconfigured. A v1 record is deliberately NOT migrated: those bindings named actions
// that no longer exist, and silently reinterpreting somebody's switch setup is worse than
// asking them again.
export function normalizeRecord(saved, fallback = []) {
  const source = saved && Array.isArray(saved.bindings) && saved.v === RECORD_VERSION
    ? saved.bindings
    : fallback;
  return {
    v: RECORD_VERSION,
    gate: GATES.includes(saved?.gate) ? saved.gate : 'both',
    // Off by default. A laptop announcing every press in a shared room is worse than
    // silence; for someone who cannot see the screen it is the only feedback there is.
    speak: saved?.speak === true,
    bindings: (source || []).map((b, i) => {
      try { return normalizeBinding(b, `b${i + 1}`); } catch (err) {
        console.error('dropped a binding', b, err);
        return null;
      }
    }).filter(Boolean),
  };
}

// Mount the input stack onto a surface.
//
//   bus        the surface's module bus — verbs are published here, modules already listen
//   modules    () => [{id, type}] currently on screen, in the order a scan should visit
//   state      a per-PERSON state handle (or null: then `fallback` bindings are used and
//              nothing is loaded — signed out still has to work)
//   onFocus    told when focus moves, so the surface can show it (or, in the kiosk's
//              single-stage mode, actually bring that module up)
export function mountInputRuntime({
  bus,
  modules = () => [],
  state: stateHandle = null,
  fallback = [],
  maps = MODULE_VERBS,
  target = (typeof window !== 'undefined' ? window : null),
  onFocus = null,
  onUnhandled = null,
  onActivation = null,
  attachDevices = true,
  makeGamepads = createGamepads,
} = {}) {
  if (!bus) throw new Error('mountInputRuntime: a bus is required');

  const actions = createDefaultRegistry();
  let state = stateHandle;
  let record = normalizeRecord(null, fallback);

  // A SHORT RING OF WHAT THE BUS DECIDED. The input bus already knows why every press was
  // accepted or refused; without somewhere to keep it, that knowledge exists only for the
  // instant it happens and only on a machine somebody is looking at. Twenty is enough to
  // answer "why did nothing happen just now" and small enough to never be a memory concern.
  const activity = [];
  const remember = (rec) => {
    activity.push(rec);
    if (activity.length > 20) activity.shift();
    try { onActivation?.(rec); } catch (err) { console.error('activation sink threw', err); }
  };

  const input = createInputBus({ bus, actions, onActivation: remember });
  const router = createVerbRouter({ bus, modules, maps, onChange: onFocus, onUnhandled });

  function apply(rec) {
    record = rec;
    input.setBindings(record.bindings);
    input.setGate(record.gate);
  }
  apply(record);

  const detach = [];
  let pads = null;
  if (attachDevices && target) {
    detach.push(attachKeyboard(input, { target }));
    detach.push(attachPointer(input, { target }));
    // A gamepad is how a great many adaptive switches present themselves — no driver, no
    // permission prompt, no chooser. Starting the poll here is what makes a switch work at
    // the bedside without anybody plugging anything into a laptop first.
    pads = makeGamepads ? makeGamepads({ input }) : null;
    pads?.start?.();
  }

  // ---- the person's record, now and whenever it changes -------------------------
  //
  // TWO STEPS ON PURPOSE. `load()` brings up the shipped defaults with no network at all,
  // so a screen is driveable the instant it renders — a screen that waits for a fetch is
  // undriveable exactly when the network is the thing that broke. `useState()` then swaps
  // in the person's own record once whoever this screen is for has been resolved, and
  // keeps swapping as it changes.
  let unsubscribe = null;

  async function load() {
    apply(normalizeRecord(null, fallback));
    if (state) await useState(state);
    return record;
  }

  // Returns its own detach, so a caller can change person without tearing down the bus.
  async function useState(handle) {
    if (!handle) return () => {};
    try { unsubscribe?.(); } catch { /* already gone */ }
    state = handle;
    await handle.load().catch(() => {});     // offline is not a reason to have no bindings
    apply(normalizeRecord(handle.get()?.[INPUTS_KEY], fallback));
    // The live half. The handle already polls; this is what turns "the clinician saved it"
    // into "her switch does the new thing", with nobody reloading a page anywhere.
    unsubscribe = handle.subscribe
      ? handle.subscribe((s) => apply(normalizeRecord(s?.[INPUTS_KEY], fallback)))
      : null;
    handle.startPolling?.();
    return () => { try { unsubscribe?.(); } catch { /* already gone */ } unsubscribe = null; };
  }

  return {
    input,
    router,
    actions,
    load,
    useState,
    record: () => ({ ...record, bindings: record.bindings.map((b) => ({ ...b })) }),
    recentActivity: () => activity.map((r) => ({ ...r })),
    gate: () => record.gate,
    speaks: () => record.speak,
    // WHAT IS PLUGGED IN RIGHT NOW. A gamepad is how most adaptive switches present
    // themselves, so this is the difference between "her switch is unbound" and "her switch
    // is not connected to anything" - two sentences with completely different repairs.
    devices: () => (pads?.list?.() || []).map((p) => ({ ...p })),
    // WHAT IS PLUGGED IN RIGHT NOW. A gamepad is how most adaptive switches present
    // themselves, so this is the difference between "her switch is unbound" and "her switch
    // is not connected to anything" - two sentences with completely different repairs.
    devices: () => (pads?.list?.() || []).map((p) => ({ ...p })),
    destroy() {
      try { unsubscribe?.(); } catch { /* already gone */ }
      detach.forEach((off) => { try { off(); } catch { /* already gone */ } });
      pads?.stop?.();
      router.destroy();
      input.destroy?.();
      state?.destroy?.();
    },
  };
}
