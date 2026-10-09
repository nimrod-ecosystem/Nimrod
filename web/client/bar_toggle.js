// bar_toggle.js — SHOW OR HIDE THE BAR WITH A KEY, AND KEEP IT HIDDEN A WHILE AFTERWARDS (2026-10-06).
//
// Mike, 2026-10-06: *"The transport bar keeps getting in the way. Maybe H should show/hide the transport bar and
// if you use it to hide the bar it doesn't pop up for another 30 seconds as default. Never pop up on its own should
// probably be an option for people that only want to use a hotkey. Hotkeys like that could of course be bound to
// anything."*
//
// *** T, NOT H (row 2.72, Mike 2026-10-09). *** Mike asked whether T ("transport") should show and hide the bar; chat
// suggested T with H kept working. His ruling: *"No one used H yet. I'm the only person using the site as far as I
// know."* So T is the default and H is freed -- not kept as a second key. Nothing else ships on T: no default binding
// (input_keyboard.js DEFAULT_BINDINGS, pack_reviews.js W / O, the lock's chord) and no bare key of the kiosk's own (1-9,
// S, C, F, [, ], \). A saved record that carried the shipped H binding (`default/bar-toggle` on H) has it on T, in
// memory, unless T is already the person's for something else (`moveOldBarToggleKey`: theirs wins, and H then stays).
// Read the rest of this header with T where it says H: the reasoning is unchanged.
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
export const BAR_TOGGLE_CONTROL = 'key:t';     // T for the bar (row 2.72); was 'key:h'
/** The key it shipped on before row 2.72, for `moveOldBarToggleKey`. */
export const BAR_TOGGLE_OLD_CONTROL = 'key:h';
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

/**
 * T for the bar (row 2.72): a saved record's SHIPPED toggle binding (its id is the default's) still on H, moved to T --
 * in memory, never written back. Left on H when T is already bound to something else in the record (the person's use
 * of T wins). Any binding the person made themselves (another id) is theirs and untouched. Returns the same array when
 * nothing moves.
 */
export function moveOldBarToggleKey(bindings) {
  if (!Array.isArray(bindings)) return bindings;
  const id = BAR_TOGGLE_KEY_BINDINGS[0].id;
  const at = bindings.findIndex((b) => b && b.id === id && b.actionId === BAR_TOGGLE_ACTION
    && b.device === 'keyboard' && b.control === BAR_TOGGLE_OLD_CONTROL);
  if (at < 0) return bindings;
  if (bindings.some((b) => b && b.device === 'keyboard' && b.control === BAR_TOGGLE_CONTROL)) return bindings;
  const out = bindings.slice();
  out[at] = { ...bindings[at], control: BAR_TOGGLE_CONTROL };
  return out;
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

// *** BAR WHILE PLAYING (row 2.65, 2026-10-07). *** Mike, after playing Quiz mix: *"Pretty much every game has the issue
// of the transport bar being a bit annoying. Maybe have a deactivate transport bar when playing setting."* Two parts.
//
// 1. THE CAUSE, MEASURED (bar_toggle_test, "bar while playing"): a touch on a Quiz mix answer tile brought the screen's
//    own bar up, and brought a placed bar (Home's, floated over the panels) back from tucked. Both bars came up on ANY
//    pointerdown, so every answer was also a summons. THE RULE: a press that lands on a module's own control (a
//    button, a link, a field: `MODULE_CONTROL_SELECTOR`) inside a panel is aimed at that control, so it does not bring
//    the bar. Presses on a panel's own surface, the gaps, the edges, keys, a switch and the pointer near the bar (but
//    not resting on a module's button) bring it as they did.
//    FOR: the person was looking at the tile and pressing it; the bar sliding over the bottom of the game is noise, in a
//      game or out of one (a calculator key, a keypad, a photo's arrows). It needs no setting and no "is this a game".
//    AGAINST: a panel that is ALL buttons (a board, a keypad filling the screen) leaves a touch-only person no empty
//      spot to tap. Answered by the hold below, which now starts on a module's button too while the bar is away: hold
//      still 1.5 s (the screen's hold time) and the bar comes up. A held press still reaches the button when it lifts,
//      as every press on it did before this, so a slow press loses nothing it had.
//    The pointer resting on a module's button near the bottom does not bring the bar either (a mouse aiming at the
//    bottom row of answers was the same summons as the tap). Moving it onto the gap below them still does.
//
// 2. MIKE'S SETTING: "While a game is being played, the bar: comes up as usual / stays away until I ask". A game is
//    being played from Start until it pauses, ends or leaves the screen: the one signal games already raise
//    (game_start.js `PLAY_STATE_TOPIC`, `playing: true` with no `kind`; a slideshow or a video says its own kind and
//    does not count -- version_watch.js `playKindOf`, the same reading). The kiosk counts only panels still on the
//    screen, so a game switched away without saying it stopped does not keep the bar away for ever. A live call ends
//    it: a call is not a game, and its controls are on the bar.
//    "Stays away" works exactly like "only when I ask" for as long as the game runs: the hold, H, Escape, the long
//    switch press, the cat, and a live call still bring the bar (nobody stranded, the rule above).
//    THE DEFAULT, ARGUED -- "comes up as usual":
//      FOR "stays away": Mike's words ("pretty much every game"), and the ways back exist.
//      FOR "as usual", and it wins for the default: part 1 removes the cause he hit (answering), so what is left of
//        the bar coming up in a game is a tap off the buttons, a key or a switch. And the cost of "stays away" falls on
//        the person who does not know about it: a visitor playing a game with somebody, or a carer reaching for Hush,
//        taps and gets nothing, and the hold is not something a person finds by tapping. The player who is annoyed is
//        the one who knows the setting is there; one row turns it on. [Mike's list: his call.]
//      Not "on when the game fills the screen, off when it shares" (chat's middle): two rules where one would do, and
//        a game on Home fills the window whether or not a visitor is the one playing it.
//    *** SUPERSEDED BY MIKE'S RULING (row 2.65, 2026-10-08): chat asked "does the bar stay away by default while a game
//    fills the screen?" -- Mike: *"Yes"*. *** So the default is chat's middle after all, as a third choice:
//      'full'   (the default) stays away while a game FILLS THE SCREEN; comes up as usual while a game shares the
//               screen with other panels -- the visitor or carer beside a game in one quarter still gets the bar by
//               tapping, as they always did.
//      'usual'  comes up as usual, game or no game (what a screen that chose it keeps).
//      'away'   stays away while any game is played, filling the screen or not (what a screen that chose it keeps).
//    A game FILLS THE SCREEN (kiosk.js `gameFillsScreen`) when it is the panel on a one-at-a-time stage (no
//    arrangement: the screen shows one panel), the only panel in its arrangement's slots (a 'full' dashboard; a small
//    overlay placed over it, like Nimrod on Your people, does not count -- it covers a corner, not the game), or a
//    panel made bigger to fill its dashboard or the screen. A game in a room's scene, or beside other panels, shares.
//    The cost argued above for "stays away" (a visitor tapping and getting nothing) is now paid only where the game is
//    all there is to see, and the ways back are the same: the hold, T, Escape, the long switch press, the cat, a call.
//    Saved values stay what they are: 'usual' and 'away' mean what they meant; a row that never chose follows 'full'.
export const BAR_PLAY_KEY = 'barWhilePlaying';
export const BAR_PLAY_USUAL = 'usual';
export const BAR_PLAY_AWAY = 'away';
export const BAR_PLAY_FULL = 'full';
export const BAR_PLAY_FIELD = Object.freeze({
  key: BAR_PLAY_KEY,
  label: 'While a game is being played, the bar',
  kind: 'choice', level: 'standard', default: BAR_PLAY_FULL,
  options: Object.freeze([
    Object.freeze({ value: BAR_PLAY_FULL, label: 'Stays away while the game fills the screen, until I ask (its key, or hold still on the screen)' }),
    Object.freeze({ value: BAR_PLAY_USUAL, label: 'Comes up as usual' }),
    Object.freeze({ value: BAR_PLAY_AWAY, label: 'Stays away while any game is played, until I ask (its key, or hold still on the screen)' }),
  ]),
});
/** "While a game is being played", from a settings row: 'full' (the default), 'usual' or 'away'. */
export function barPlayFrom(row) {
  const v = row && row[BAR_PLAY_KEY];
  return v === BAR_PLAY_AWAY || v === BAR_PLAY_USUAL ? v : BAR_PLAY_FULL;
}

// What a module's own control is: anything a press OPERATES. The same list screen_controls_test.html's `quietSpot`
// avoids, plus the ARIA roles a module draws its own buttons with. A disabled button counts: a press on an answer
// tile already answered was still aimed at the tile.
export const MODULE_CONTROL_SELECTOR = 'button, a[href], input, select, textarea, label, summary, '
  + '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], '
  + '[role="menuitem"], [role="option"], [role="slider"], [contenteditable=""], [contenteditable="true"]';
// The bars themselves, the one menu and the screens tray are the shell's, not a module's: a press there is somebody
// using the bar, which keeps it up.
const SHELL_CHROME_SELECTOR = '.k-controls, .tb-bar, [data-settings], [data-screens]';
/** Whether a press on `target` lands on a module's own control inside a panel (`.k-mod`), not on the shell's chrome. */
export function onModuleControl(target) {
  const el = target && typeof target.closest === 'function' ? target : target?.parentElement;
  if (!el || typeof el.closest !== 'function') return false;
  const c = el.closest(MODULE_CONTROL_SELECTOR);
  return !!c && !c.closest(SHELL_CHROME_SELECTOR) && !!c.closest('.k-mod');
}

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
export function createBarQuiet({ settings = () => ({}), now = () => Date.now(), playing = () => false,
  fills = () => false } = {}) {
  let hidden = false;
  let until = 0;
  const row = () => { try { return settings() || {}; } catch { return {}; } };
  // bar while playing: is a game being played on this screen right now (the kiosk's reading of PLAY_STATE_TOPIC).
  const gameOn = () => { try { return !!playing(); } catch { return false; } };
  // (row 2.65) ...and does one being played fill the screen (kiosk.js `gameFillsScreen`). Unreadable: it shares.
  const gameFills = () => { try { return !!fills(); } catch { return false; } };
  const playKeepsAway = () => {
    const mode = barPlayFrom(row());
    if (mode === BAR_PLAY_USUAL || !gameOn()) return false;
    return mode === BAR_PLAY_AWAY || gameFills();
  };
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
      if (playKeepsAway()) return false;   // bar while playing (row 2.65: by default, while a game fills the screen)
      return !(hidden && now() < until);
    },
    /** For a suite and a diagnostic page. */
    probe: () => ({ hiddenByKey: hidden, until, self: barSelfFrom(row()), quietMs: barQuietMsFrom(row()),
      whilePlaying: barPlayFrom(row()), playing: gameOn(), fills: gameFills() }),
  };
}
