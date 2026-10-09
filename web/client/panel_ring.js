// panel_ring.js — "SHOW WHICH PANEL IS SELECTED": the ring round the selected panel, kept, shown for a while
// after a press, or never. One setting for a whole screen (its row), like "Grow the panel the cursor is on".
//
// Mike, 2026-10-09, on 29b238e (the ring kept on a panel filling the screen while an overlay over it is in the
// switch scan): "That should be an option or maybe the selection turns off after a little bit. Don't assume
// everyone is a switch user or even that every switch user would always want the highlight."
//
// THE RING ITSELF is kiosk.css's (`.k-cell[data-focused] .k-mod`) and, on a module placed freely, arrangement.js
// `syncRingAlone`'s inline outline. This file never draws it: it marks the screen (`kioskEl`) and kiosk.css takes
// the ring off under the mark --
//   data-panel-ring="always" | "after" | "never"   which choice is in force
//   data-panel-ring-idle                            "after", and the wait since the last press has run out
// so turning the setting back to "Always" leaves nothing behind. `data-focused` is never touched: the bar's lit
// chip, the cat and the menu's "Settings for" all read it, and the panel IS still selected while no ring shows.
// Only the PANEL's ring goes. A button or a field inside a panel keeps its own focus ring in every choice.
//
// *** THE ONE-PANEL RULE (29b238e) STILL HOLDS IN EVERY CHOICE, "Always" INCLUDED. *** "Always" means "does not go
// away by itself", not "a ring that answers no question": Mike's 10-08 complaint was a ring round the only panel.
// The case for the opposite: somebody who wants the ring as a steady "this screen is taking my presses" sign even
// with one panel. Not built; on the report as a guess.
//
// *** DEFAULT: FOR 10 SECONDS AFTER A PRESS. Argued (Rule 1; Mike leans this way): ***
//   FOR going away: most of the time a screen is WATCHED -- photos, a video, a call -- and the ring is a coloured
//     frame over the thing being watched while nobody is choosing anything. The ring answers "which panel will the
//     next press act on", a question somebody has around a press, not an hour later. And it costs nobody the answer:
//     the next press, key, switch step or mouse move brings it straight back.
//   FOR "Always" as the default: it is what every screen does today, so this changes every screen that never chose;
//     and a slow switch user deciding between steps can see the ring go before they press.
//   10 SECONDS, NOT 3: press-to-press time with a switch is several seconds for plenty of people (a scan step, then
//     deciding, then the select), and 3 s would take the ring away in the middle of an ordinary choice. 30 s is
//     offered for slower hands; "Always" for anybody who wants it to stay.
// THE WAIT IS PART OF THE ONE ROW (three lengths), not a second "how long" row: a second row would be a stop on
// every switch walk through the menu that only changes anything for one of the choices (kiosk.js keeps rows to
// where they change something). A length nobody needs is one more choice in one row, which costs a step only to
// somebody stepping through that row.
//
// *** "NEVER" IS A PERSON'S OWN CHOICE, NOT A DEFAULT, AND IT STRANDS NOBODY: *** scanning still works (focus
// still moves, a press still acts on the selected panel); what says where you are is the bar's lit chip (the
// selected panel's name, lit; a press brings the bar unless it was set to stay away), the menu's "Settings for"
// row, and "Grow the panel the cursor is on" if that is on. The row's help says so.
//
// GOES AWAY AT ONCE, NOT A FADE: kiosk.css's "NO TRANSITION ON THE RING" (an animated outline drew in the wrong
// colour on the frame it appeared). It comes back at once too.
//
// WHAT BRINGS IT BACK: a press, key, pointer move or touch on the screen, and any verb on the bus (a switch, a
// gamepad, a spoken "next" -- every one reaches the panels as a verb, so a switch that is not a keyboard counts).
// NOT a focus change nobody made (a panel mounting, a call taking the screen): a timer that repaints focus would
// then keep the ring on forever. On the report as a guess.
// THE FIRST PRESS AFTER IT HAS GONE STILL DOES WHAT IT DOES (it is not swallowed to bring the ring back): a select
// acts on the selected panel, which did not change while the ring was away. On the report as a guess, with the case
// for the opposite (a TV remote's first press often only shows where you are).

import { VERBS, FOCUS_VERBS, MEDIA_VERBS, ACTION_VERBS, verbTopic } from './actions.js';

export const PANEL_RING_KEY = 'panelRing';
// Most shown to least, so stepping through the row goes one way.
export const PANEL_RING_OPTIONS = Object.freeze([
  { value: 'always', label: 'Always' },
  { value: 'after-30', label: 'For 30 seconds after a press' },
  { value: 'after-10', label: 'For 10 seconds after a press' },
  { value: 'after-3', label: 'For 3 seconds after a press' },
  { value: 'never', label: 'Never' },
]);
export const PANEL_RING_DEFAULT = 'after-10';

/** The settings row, as data (settings_fields.js `choice`), for the screen's own settings. */
export const PANEL_RING_FIELD = Object.freeze({
  key: PANEL_RING_KEY, label: 'Show which panel is selected', kind: 'choice', default: PANEL_RING_DEFAULT,
  level: 'standard', options: PANEL_RING_OPTIONS,
  help: 'A ring round the selected panel. It comes back with the next press, key, switch or mouse move. '
    + 'With Never, the bar still lights the selected panel’s name.',
});

/** A stored value as { mode: 'always' | 'after' | 'never', ms }. Anything unknown is the default. */
export function panelRingMode(value) {
  const v = PANEL_RING_OPTIONS.find((o) => o.value === String(value ?? '')) ? String(value) : PANEL_RING_DEFAULT;
  if (v === 'always' || v === 'never') return { mode: v, ms: 0 };
  return { mode: 'after', ms: Number(v.slice('after-'.length)) * 1000 };
}

const WAKE_VERBS = [...VERBS, ...FOCUS_VERBS, ...MEDIA_VERBS, ...ACTION_VERBS].map((v) => v.id);

/**
 * Keep `el`'s marks in step with the setting and with the presses.
 *   el          the screen (kioskEl): it carries the marks
 *   root        where presses and pointer moves are heard (the kiosk's root)
 *   keyTarget   where keys are heard (a real screen: the window -- a key with nothing focused lands on the body)
 *   bus         the screen's bus: every verb counts as a press
 *   timers      { set(fn, ms), clear(t) } -- a seam for the suites
 * Returns { apply(value), wake(), state(), destroy() }.
 */
export function createPanelRing({ el, root = el, keyTarget = root, bus = null, timers = null } = {}) {
  const T = timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  let value = null;
  let cur = panelRingMode(PANEL_RING_DEFAULT);
  let t = null;
  let gone = false;

  function idle(on) {
    if (!el) return;
    if (on) el.dataset.panelRingIdle = '1'; else delete el.dataset.panelRingIdle;
  }
  function wake() {
    if (gone) return;
    if (t != null) { T.clear(t); t = null; }
    if (cur.mode !== 'after') { idle(false); return; }
    idle(false);
    t = T.set(() => { t = null; if (!gone) idle(true); }, cur.ms);
  }
  // Only a CHANGED value does anything: the screen's row is re-read on every poll, and re-applying the same choice
  // must not bring the ring back each time.
  function apply(next) {
    if (gone) return;
    const key = String(next ?? '');
    if (key === value) return;
    value = key;
    cur = panelRingMode(next);
    if (el) el.dataset.panelRing = cur.mode;
    wake();   // a choice just made shows the ring at once (or takes it off, for Never)
  }

  const onInput = () => wake();
  const opts = { capture: true, passive: true };
  for (const ev of ['pointerdown', 'pointermove']) root?.addEventListener?.(ev, onInput, opts);
  keyTarget?.addEventListener?.('keydown', onInput, opts);
  const offs = bus ? WAKE_VERBS.map((v) => bus.subscribe(verbTopic(v), onInput)) : [];

  return {
    apply,
    wake,
    state: () => ({ value: value ?? null, mode: cur.mode, ms: cur.ms,
      idle: !!el?.dataset?.panelRingIdle, shown: cur.mode === 'always' || (cur.mode === 'after' && !el?.dataset?.panelRingIdle) }),
    destroy() {
      gone = true;
      if (t != null) { T.clear(t); t = null; }
      for (const ev of ['pointerdown', 'pointermove']) root?.removeEventListener?.(ev, onInput, opts);
      keyTarget?.removeEventListener?.('keydown', onInput, opts);
      for (const off of offs) { try { off(); } catch { /* already gone */ } }
      if (el) { delete el.dataset.panelRing; delete el.dataset.panelRingIdle; }
    },
  };
}
