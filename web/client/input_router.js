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
  // THE VOCABULARY IS AN ARGUMENT, not an import. It was already a list and a lookup table;
  // making it a parameter is the whole of custom-verb support at this layer, because nothing
  // here ever cared what the nine names were. See `mergeVerbs` in actions.js.
  verbs = VERBS,
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

  /**
   * *** FOCUS IS WHERE SOMEBODY PUT IT. CYCLING ONLY VISITS PANELS THAT CAN DO SOMETHING. ***
   *
   * These used to be the same list, and that produced D16 -- a bug on the transport bar that
   * chat put plainly: **a control that removes itself when pressed is the failure mode Nimrod
   * exists to prevent.** A panel whose type answers no verbs was not `reachable`, so it could
   * not be focused, so the bar dropped its button the moment it was placed on screen. Pressing
   * a button deleted that button, and somebody using one switch cannot undo it.
   *
   * The rule that fixes it without breaking what `reachable` is for:
   *
   *   * `setFocus` -- a DELIBERATE choice, by name, from the bar -- may land on any panel on
   *     the screen, including one with nothing to press. **An empty control set is a correct
   *     answer; a vanishing button is not.**
   *   * `step` -- what a switch does -- still walks only panels that answer a verb, so a
   *     single-switch user is never cycled onto a dead panel.
   *
   * Nobody is stranded either way: `dispatch` on a verb-less panel already reports
   * `no-mapping` rather than failing silently, and `focus-next` still moves on, because `step`
   * walks the reachable list regardless of where focus happens to be sitting.
   */
  const onScreen = () => modules() || [];

  function focused() {
    const here = onScreen().find((m) => m.id === focusId);
    if (here) return here;                    // including one with no verbs, if it was chosen
    const list = reachable();
    return list.length ? list[0] : null;
  }

  function setFocus(id) {
    const hit = onScreen().find((m) => m.id === id);
    if (!hit) return focused();
    focusId = hit.id;
    onChange?.({ ...hit });
    return hit;
  }

  function step(delta) {
    if (paused) return focused();
    const list = reachable();
    if (!list.length) return null;
    // `-1` when focus is sitting on a panel that answers no verbs -- somebody chose it by name
    // from the bar. Stepping forward from there has to land on the FIRST reachable panel;
    // `Math.max(0, ...)` would have started at index 0 and stepped to the SECOND, skipping a
    // panel that a switch user can then only reach by going all the way round.
    const at = list.findIndex((m) => m.id === focused()?.id);
    // Wraps. With one switch you can only go one way, so the ring has to close or the
    // last panel is a dead end.
    const from = at < 0 ? (delta > 0 ? -1 : 0) : at;
    const next = list[(from + delta + list.length) % list.length];
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
    for (const v of verbs) {
      const t = verbTarget(m.type, v.id, maps);
      if (t) out[v.id] = t;
    }
    return out;
  }

  // `meta` is carried straight through from the verb to the module topic and never rewritten
  // here. The router decides WHICH PANEL a verb lands on; it has no business changing who
  // sent it, and a module asking "who pressed this" must get the same answer the bus was
  // handed. Undefined stays undefined, so a caller that knows nothing about senders behaves
  // exactly as it always did.
  //
  // *** INSTANCE ADDRESSING, NOT THE BARE TYPE TOPIC. ***
  //
  // Until now this published `target.topic` bare — `photos/next` — which is a TYPE-keyed
  // string, so on a screen with two photos panels BOTH would hear it. `focused()` already
  // knows WHICH ONE (`m.id`), and has always thrown that away at the last step. `bus.js`'s
  // `scope(instanceId)` already gives every mounted instance a second, instance-scoped alias
  // of every topic it subscribes to (see `module.js`); publishing to that alias here — instead
  // of the bare topic — is the other half, and it is the whole fix: the focused instance's own
  // subscription still fires (it is registered on both), and no unfocused sibling instance of
  // the same type hears a verb meant for the one somebody is actually looking at.
  //
  // `bus.instanceTopic` may be absent on a bus that predates this (a hand-built fake in an
  // older test) — falls back to the bare topic, which is exactly what publishing always did.
  function dispatch(verb, meta) {
    if (paused) return null;
    const m = focused();
    if (!m) return onUnhandled?.({ verb, reason: 'no-panel' }) ?? null;
    const target = verbTarget(m.type, verb, maps);
    if (!target) return onUnhandled?.({ verb, reason: 'no-mapping', module: { ...m } }) ?? null;
    const topic = bus.instanceTopic ? bus.instanceTopic(m.id, target.topic) : target.topic;
    bus.publish(topic, target.payload, meta);
    return { ...target, module: { ...m } };
  }

  for (const v of verbs) {
    offs.push(bus.subscribe(verbTopic(v.id), (_p, _t, meta) => dispatch(v.id, meta)));
  }
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
