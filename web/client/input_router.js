// input_router.js - FOCUS, and turning a verb into what the focused panel understands.
//
// The piece the verb vocabulary needs to exist. A binding says "next"; a screen has four
// panels on it; something has to decide WHICH one. That decision is focus, and this file
// is the whole of it:
//
//   verb/next  ->  [which panel is focused?]  ->  photos/next
//
// WHY FOCUS IS NOT A UI DETAIL. For someone with a mouse, focus is obvious - you click
// the thing you mean, and a global "next" would be a downgrade. For someone with ONE
// SWITCH there is no clicking and there is no second switch, so reaching four panels
// means moving between them and then acting. That is exactly how a TV remote works, and
// exactly how every AAC scanner has worked for thirty years. Focus is not overhead added
// to the verb model; it is the half of it that makes one switch sufficient.
//
// PANELS THAT ANSWER NOTHING ARE SKIPPED. A clock has no verbs. Stopping on it while
// scanning costs a press and offers nothing, and for someone whose every press is
// effortful that is not a small waste. `MODULE_VERBS` doubles as the list of what is
// worth stopping on - a module type absent from it is simply never focused.
//
// FOCUS IS TRACKED BY MODULE ID, NOT INDEX. A screen's contents change - modules get
// added and removed while a caregiver is arranging - and an index silently comes to mean
// a different panel when that happens. If the focused module disappears, focus falls
// back to the first one that answers something rather than to nothing.
//
// THE ROUTER PUBLISHES ON THE SAME BUS IT LISTENS TO. `verb/next` in, `photos/next` out,
// and the module at the other end never learns that a verb was involved. That is what
// let this ship without touching a single module.

import { VERBS, FOCUS_VERBS, MODULE_VERBS, verbTopic, verbTarget, respondsToVerbs } from './actions.js';

export function createVerbRouter({
  bus,
  modules = () => [],        // [{id, type, position}] in layout order
  maps = MODULE_VERBS,
  onChange = null,           // told the focused module whenever it moves
  onUnhandled = null,        // "the focused panel has nothing for that verb" - the UI says so
} = {}) {
  if (!bus) throw new Error('createVerbRouter: bus is required');

  let focusId = null;
  const offs = [];
  // PAUSED means "something in front is taking the verbs" — today, an open settings menu.
  // It is a flag here rather than a subscription the menu outbids, because bus delivery
  // order is not a contract and "whoever subscribed first wins" is not a rule anyone
  // should have to know. Paused, the router still tracks focus; it simply stops acting,
  // so closing the menu returns to the panel the person was already on.
  let paused = false;

  // Only panels that answer at least one verb. Anything else is not worth a press.
  const reachable = () => (modules() || []).filter((m) => respondsToVerbs(m.type, maps));

  function focused() {
    const list = reachable();
    if (!list.length) return null;
    return list.find((m) => m.id === focusId) || list[0];
  }

  function setFocus(id) {
    const list = reachable();
    const hit = list.find((m) => m.id === id);
    if (!hit) return focused();
    focusId = hit.id;
    onChange?.({ ...hit });
    return hit;
  }

  function step(delta) {
    if (paused) return focused();
    const list = reachable();
    if (!list.length) return null;
    const at = Math.max(0, list.findIndex((m) => m.id === focused()?.id));
    // Wraps. With one switch you can only go one way, so the ring has to close or the
    // last panel is a dead end.
    const next = list[(at + delta + list.length) % list.length];
    focusId = next.id;
    onChange?.({ ...next });
    return next;
  }

  // What the focused panel would do with each verb — the binder shows this so a person
  // can see "select does nothing here" before they wonder why their switch is dead.
  function targets() {
    const m = focused();
    if (!m) return {};
    const out = {};
    for (const v of VERBS) {
      const t = verbTarget(m.type, v.id, maps);
      if (t) out[v.id] = t;
    }
    return out;
  }

  function dispatch(verb) {
    if (paused) return null;
    const m = focused();
    if (!m) return onUnhandled?.({ verb, reason: 'no-panel' }) ?? null;
    const target = verbTarget(m.type, verb, maps);
    if (!target) return onUnhandled?.({ verb, reason: 'no-mapping', module: { ...m } }) ?? null;
    bus.publish(target.topic, target.payload);
    return { ...target, module: { ...m } };
  }

  for (const v of VERBS) offs.push(bus.subscribe(verbTopic(v.id), () => dispatch(v.id)));
  for (const v of FOCUS_VERBS) {
    const delta = v.id === 'focus-prev' ? -1 : 1;
    offs.push(bus.subscribe(verbTopic(v.id), () => step(delta)));
  }

  return {
    focused, setFocus, targets, dispatch,
    setPaused: (v) => { paused = !!v; },
    isPaused: () => paused,
    focusNext: () => step(1),
    focusPrev: () => step(-1),
    reachable,
    destroy() { offs.forEach((off) => off()); offs.length = 0; },
  };
}
