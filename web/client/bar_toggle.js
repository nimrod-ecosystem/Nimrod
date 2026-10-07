// bar_toggle.js — SHOW OR HIDE THE BAR WITH A KEY, AND KEEP IT HIDDEN A WHILE AFTERWARDS (2026-10-06).
//
// Mike, 2026-10-06: *"The transport bar keeps getting in the way. Maybe H should show/hide the transport bar and
// if you use it to hide the bar it doesn't pop up for another 30 seconds as default. Never pop up on its own should
// probably be an option for people that only want to use a hotkey. Hotkeys like that could of course be bound to
// anything."*
//
// *** WHAT IT DOES. *** One action, `system/bar-toggle` (actions.js SYSTEM_ACTIONS), H by default and movable to any
// key or switch from Devices like every other binding. Pressed while the bar is showing, it puts the bar away and
// starts a QUIET PERIOD: for that long, nothing brings the bar back BY ITSELF -- not the pointer coming near it, not
// a touch, not a key, not a switch press. Pressed again, the bar comes back at once. Anything that ASKS for the bar
// (Escape or a long switch press for the plain bar, the cat pointing at it, a room's "modules" object, a bound
// `system/modules`) still brings it: those are a person reaching for it, not the bar popping up.
//
// *** H, AND WHAT H USED TO DO. *** H was the kiosk's bare key for the screen picker (⌂ Home). Mike asked for H, so
// the bar has it and the picker moved to S ("your Screens", the button's own title). Argued:
//   FOR moving the picker: the bar is the thing in the way many times a day; the picker is one button on the bar
//     itself and a bindable action (`system/dashboards`), so it loses nothing but a letter. H reads as "hide".
//   AGAINST: anybody who learned H for Home has to learn S. Nothing on the site taught it but the Home button's
//     tooltip, which now says (S).
//
// *** TWO SETTINGS, NOT ONE (the case for folding them is real). *** Both are the screen's (below):
//   "After hiding the bar with its key, keep it hidden for: 10 s / 30 s / 1 min / 5 min / until I show it"
//   "The bar comes up by itself: yes / only when I ask for it"
//   FOR one row ("until I show it" doing both jobs): one fewer row on the switch walk.
//   AGAINST, and it wins: they answer different questions. "Until I show it" is about the minutes after a person
//     hid the bar; it says nothing about the bar popping up at boot, after a reload or on a screen nobody has
//     pressed H on yet -- which is exactly the hotkey person's complaint. And somebody who likes the bar popping
//     up normally but wants it to stay gone when they DO hide it (a film) needs the first without the second.
//
// *** NOBODY IS STRANDED (the project's rule: a screen must never enter a state that only an input can leave,
// when the person in front of it cannot give that input). *** A hidden bar stops nothing -- every panel keeps
// playing -- but it is the way to ⚙ and Home, so a person with no keyboard must still be able to reach it:
//   * a quiet period of 10 s to 5 min ends by itself, and then a touch brings the bar back as it always did;
//   * while touch is held back for longer ("until I show it", or "only when I ask"), HOLDING STILL ON THE SCREEN
//     for the plain bar's hold time (1.5 s by default, the screen's own setting) brings it, with the same ring and
//     words the switch hold shows. A tap stays a tap. Holding a mouse button still is not dragging (a drag moves),
//     so it costs a person dragging nothing;
//   * a switch: the long press (dashboard path) and any switch bound to this action or to `system/modules`;
//   * a keyboard: the key itself, Escape (the plain bar), M (the menu, where both settings are).
//   Why not grey out "only when I ask" on a screen with no keyboard: a browser cannot tell whether a keyboard is
//   plugged in, and the default H binding exists on every screen, so "a key is bound" proves nothing. The hold
//   works with whatever the person has.
//
// HARD-CODED, each with its reason (CLAUDE.md porting rule 1):
//   30 s default        Mike's number.
//   10 s .. 5 min       a moment, his default, a minute, a scene of a film; "until I show it" for the rest.
//   12 px hold slop     a finger resting on glass wanders a few pixels; a drag moves further than this.

export const BAR_TOGGLE_ACTION = 'system/bar-toggle';
export const BAR_TOGGLE_TOPIC = 'system/bar-toggle';      // = actions.js SYSTEM_ACTIONS (bar_toggle_test checks they agree)
export const BAR_TOGGLE_CONTROL = 'key:h';
/** Published on the screen's bus (shell_verbs.js SHELL_STATE) as `{ barKeyHidden }` when the key hides or shows the bar. */
export const BAR_KEY_HIDDEN = 'barKeyHidden';

export const BAR_QUIET_KEY = 'barQuietMs';
export const BAR_SELF_KEY = 'barShowsItself';
export const BAR_QUIET_UNTIL_SHOWN = 0;
export const BAR_QUIET_DEFAULT_MS = 30 * 1000;
export const BAR_QUIET_CHOICES = Object.freeze([10 * 1000, 30 * 1000, 60 * 1000, 5 * 60 * 1000, BAR_QUIET_UNTIL_SHOWN]);
export const BAR_SELF_YES = 'yes';
export const BAR_SELF_ASKED = 'asked';
export const BAR_HOLD_SLOP_PX = 12;

export const BAR_TOGGLE_KEY_BINDINGS = Object.freeze([Object.freeze({
  id: 'default/bar-toggle', actionId: BAR_TOGGLE_ACTION, device: 'keyboard', control: BAR_TOGGLE_CONTROL,
  edge: 'press', role: 'universal', holdMs: 0, debounceMs: 0, lockoutMs: 0, label: 'Show or hide the bar',
})]);

/** The toggle's binding a saved record does not already cover: it binds the action, or uses the key, and it is left alone. */
export function missingBarToggleBindings(bindings) {
  const list = Array.isArray(bindings) ? bindings : [];
  return BAR_TOGGLE_KEY_BINDINGS.filter((b) => !list.some((x) => x && (
    (x.device === b.device && x.control === b.control) || x.actionId === b.actionId))).map((b) => ({ ...b }));
}

/** Whether this physical control is bound to the toggle right now (so the press that toggles never also wakes the bar). */
export function isBarToggleControl(bindings, device, control) {
  if (!device || !control) return false;
  return (Array.isArray(bindings) ? bindings : []).some((b) => b && b.actionId === BAR_TOGGLE_ACTION
    && b.device === device && b.control === control);
}

const secs = (ms) => (ms % 60000 === 0 ? `${ms / 60000} minute${ms === 60000 ? '' : 's'}` : `${ms / 1000} seconds`);

// `standard`, not `essential`: neither row is the way out -- the hold, the key, Escape and the long press are, and
// none of them depends on a row being shown. A choice made at a higher level stays in force where its row is hidden.
export const BAR_QUIET_FIELD = Object.freeze({
  key: BAR_QUIET_KEY,
  label: 'After hiding the bar with its key, keep it hidden for',
  kind: 'choice', level: 'standard', default: BAR_QUIET_DEFAULT_MS,
  options: Object.freeze(BAR_QUIET_CHOICES.map((ms) => Object.freeze({
    value: ms, label: ms === BAR_QUIET_UNTIL_SHOWN ? 'Until I show it' : secs(ms) }))),
});
export const BAR_SELF_FIELD = Object.freeze({
  key: BAR_SELF_KEY,
  label: 'The bar comes up by itself',
  kind: 'choice', level: 'standard', default: BAR_SELF_YES,
  options: Object.freeze([
    Object.freeze({ value: BAR_SELF_YES, label: 'Yes, when you touch, press or move near it' }),
    Object.freeze({ value: BAR_SELF_ASKED, label: 'No, only when I ask (its key, or hold still on the screen)' }),
  ]),
});

/** The quiet period from a settings row, in ms. 0 = until the bar is shown again. */
export function barQuietMsFrom(row) {
  const v = row && row[BAR_QUIET_KEY];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n <= 60 * 60 * 1000 ? n : BAR_QUIET_DEFAULT_MS;
}
/** Whether the bar comes up by itself, from a settings row: 'yes' (the default) or 'asked'. */
export function barSelfFrom(row) {
  return row && row[BAR_SELF_KEY] === BAR_SELF_ASKED ? BAR_SELF_ASKED : BAR_SELF_YES;
}

/**
 * The quiet period's state. Pure but for the clock and the settings read, both injected.
 *   hide()       the key put the bar away: the quiet period starts now
 *   show()       the bar is showing again (the key, or anything that asked for it): no quiet period
 *   mayPopUp()   may the bar come up BY ITSELF right now (a touch, a key, the pointer near it, a switch press)
 *   hiddenByKey() the key hid it and nothing has shown it since
 */
export function createBarQuiet({ settings = () => ({}), now = () => Date.now() } = {}) {
  let hidden = false;
  let until = 0;
  const row = () => { try { return settings() || {}; } catch { return {}; } };
  return {
    hide() {
      const ms = barQuietMsFrom(row());
      hidden = true;
      until = ms === BAR_QUIET_UNTIL_SHOWN ? Infinity : now() + ms;
    },
    show() { hidden = false; until = 0; },
    hiddenByKey: () => hidden,
    mayPopUp() {
      if (barSelfFrom(row()) === BAR_SELF_ASKED) return false;
      return !(hidden && now() < until);
    },
    /** For a suite and a diagnostic page. */
    probe: () => ({ hiddenByKey: hidden, until, self: barSelfFrom(row()), quietMs: barQuietMsFrom(row()) }),
  };
}
