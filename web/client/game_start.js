// game_start.js — WHEN A GAME STARTS, AND WHAT IT SHOWS UNTIL IT DOES (2026-10-02).
//
// Mike, 2026-10-02 (late), on the live site:
//   * "When a game is in the dashboard. It shouldn't start right away. Brain games just starts talking.
//     It should preferably have a computer playing the game and a start button. Maybe autostart on load
//     needs to be a setting. I could see it being on for youtube/picture slideshow and off for games.
//     Maybe even have a separate setting for if it's the only thing in a dashboard."
//   * "It would be cool for games like that to have the computer playing them when they're open but not
//     in use. Like classic video games. Maybe even have your AI play them as an option."
//
// So three shared pieces, here once, used by every game that opts in (brick breaker, rhythm, the quiz
// games through quiz_view.js, card sort):
//
//   1. AUTOSTART, A SETTING PER PANEL (`autostart`), with "when it is the only thing on the dashboard"
//      as its own row (`autostartAlone`). A game that does not start shows a START button (a press, a
//      switch, "start" or "play" said aloud) and says NOTHING until it is pressed.
//   2. THE PLAY STATE, TOLD TO THE SHELL (`PLAY_STATE_TOPIC`). The bar's one Pause / Play (and Space,
//      input_keyboard.js) remembers what IT last sent a panel; a game that has not started is "paused" to
//      it only if the game says so. Without this the first Space on a waiting game sent `pause` to a game
//      that was not going, and only the second one started it.
//   3. THE DEMO ("attract mode") settings: the computer plays while nobody is, silently, never scoring,
//      and any press starts a real game. The players themselves are game_agent.js.
//
// *** AUTOSTART'S DEFAULTS, ARGUED (Mike's split, and why "games off" holds even where it costs a press):
//   ON for media (a video, a slideshow): the content IS the point of opening it, and nothing about it
//      asks anything of anybody. Unchanged from what those panels do today.
//   OFF for games: a game that starts by itself asks for an answer nobody may be there to give, and a
//      talking game talks to an empty room (the report that started this). AGAINST: somebody who opens a
//      game on purpose pays one press for it. That press is the Start button, which every input reaches.
// *** "THE ONLY THING ON THE DASHBOARD" DEFAULTS TO "THE SAME AS ABOVE", ARGUED. ***
//   FOR "start by itself" when alone: a dashboard holding one game is usually somebody choosing that game.
//   AGAINST, and it wins: a one-game dashboard is just as likely a screen's HOME, which comes up at boot
//      and after every power cut - a quiz starting to talk at 3 a.m. is exactly the bug. "Starts by
//      itself when alone" is one choice away for the person who means the first case. [On Mike's list.]
//   The host says whether the panel is alone through `ctx.panelCount` (a number, or a function returning
//   one). A host that does not say (a preview page, a test) is "not known", and the plain row decides.
//
// *** THE DEMO'S DEFAULTS, ARGUED. ***
//   attract ON for arcade games: Mike's own picture ("like classic video games"), and a game that moves
//      is the clearest way to show what it is.
//   attract ON for a quiz game that has a demo (brain games), argued both ways: AGAINST, a question
//      answered by the computer is a page of words changing under somebody who did not ask, and they may
//      be trying to read something else on the screen. FOR, and it wins: Mike said it of brain games in
//      so many words ("It should preferably have a computer playing the game and a start button"), the
//      demo is SILENT (the complaint was the talking), and it changes once every few seconds, not every
//      frame. Off is one setting away. Quiz games with no demo yet (thinking games, word builder) offer
//      no row: a setting that does nothing is a lie.
//   SILENT by default (`attractSound` off): the demo is for looking at. AGAINST: a demo with its sounds is
//      more like the arcade. But an unattended screen making noise every few seconds is the complaint this
//      started from, pointed at the ear instead of the eye.
//   IT RESTS after `attractForMs` (10 minutes by default): the last frame stays, with Start. FOR running for as
//      long as it is open: that is what an arcade cabinet does. AGAINST, and it wins for the default: a
//      demo is frames every second on a Pi all night, and motion in a dark room; "as long as it is open"
//      is a choice. [On Mike's list.]
//   IT COMES BACK `attractAfterMs` (60 s) after a real game comes to rest (the game's own "nobody is
//      playing" rule decides when that is). 0 = never: the game stays where it stopped.
//   REDUCED MOTION: no demo at all (the still Start screen), whatever the setting says.
//
// WHAT IS NOT A GATE HERE: the Start button waits for a press, and that is the game - nothing that was
// already running stops for it (CLAUDE.md: games are the windmill case). Nobody pressing leaves a still
// screen, or the demo, never a stuck one.

export const PLAY_STATE_TOPIC = 'shell/play-state';

export const AUTOSTART_KEY = 'autostart';
export const AUTOSTART_ALONE_KEY = 'autostartAlone';
export const AUTOSTART_ALONE = Object.freeze(['same', 'on', 'off']);

/** The two autostart rows. `on` is this module's default (media true, games false). */
export function autostartFields({ on = false, level = 'standard' } = {}) {
  return [
    { key: AUTOSTART_KEY, label: 'When it opens', default: !!on, level,
      onLabel: 'It starts by itself', offLabel: 'It waits for Start',
      note: on ? 'Off: it shows a Start button until somebody presses it.'
        : 'Off: a Start button, and nothing is said until somebody presses it.' },
    { key: AUTOSTART_ALONE_KEY, label: 'When it is the only thing on the dashboard', kind: 'choice', default: 'same',
      level: 'advanced', options: [
        { value: 'same', label: 'The same as above' },
        { value: 'on', label: 'It starts by itself' },
        { value: 'off', label: 'It waits for Start' },
      ] },
  ];
}

/** Is this panel the only one on its dashboard? true / false, or null when the host does not say. */
export function panelAlone(ctx) {
  let n = null;
  try { n = typeof ctx?.panelCount === 'function' ? ctx.panelCount() : ctx?.panelCount; } catch { n = null; }
  if (n == null || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v <= 1 : null;
}

/** Should this panel start by itself now? `fallback` is the module's default for `autostart`. */
export function shouldAutostart(values = {}, { fallback = false, alone = null } = {}) {
  const v = values || {};
  const base = typeof v[AUTOSTART_KEY] === 'boolean' ? v[AUTOSTART_KEY] : !!fallback;
  if (alone === true) {
    if (v[AUTOSTART_ALONE_KEY] === 'on') return true;
    if (v[AUTOSTART_ALONE_KEY] === 'off') return false;
  }
  return base;
}

// ---------------------------------------------------------------------------------------------------
// THE DEMO'S SETTINGS
// ---------------------------------------------------------------------------------------------------
// Durations are stored in milliseconds, like every duration here (settings_audit: a key that stores
// seconds or minutes is refused); the labels say minutes and seconds.
const MIN = 60000;
export const ATTRACT_DEFAULTS = Object.freeze({ attract: true, attractForMs: 10 * MIN, attractAfterMs: 60000, attractSound: false });
export const ATTRACT_FOR_MS = Object.freeze([2 * MIN, 10 * MIN, 30 * MIN, 0]);
export const ATTRACT_AFTER_MS = Object.freeze([0, 30000, 60000, 300000]);

/** The demo rows. `on` is this game's default; `sound` adds the "its sounds" row (games that have any). */
export function attractFields({ on = true, sound = false, level = 'standard' } = {}) {
  return [
    { key: 'attract', label: 'While nobody is playing', default: !!on, level,
      onLabel: 'The computer plays it (a demo)', offLabel: 'It waits, still',
      note: 'The demo never scores and never earns points. Any press starts a real game.' },
    { key: 'attractForMs', label: 'The demo plays for', kind: 'choice', default: ATTRACT_DEFAULTS.attractForMs,
      level: 'advanced', options: [
        { value: 2 * MIN, label: '2 minutes, then rests' }, { value: 10 * MIN, label: '10 minutes, then rests' },
        { value: 30 * MIN, label: '30 minutes, then rests' }, { value: 0, label: 'As long as it is open' },
      ] },
    { key: 'attractAfterMs', label: 'After a game nobody is playing, the demo comes back', kind: 'choice',
      default: ATTRACT_DEFAULTS.attractAfterMs, level: 'advanced', options: [
        { value: 0, label: 'Never: the game stays where it stopped' }, { value: 30000, label: 'After 30 seconds' },
        { value: 60000, label: 'After a minute' }, { value: 300000, label: 'After 5 minutes' },
      ] },
    ...(sound ? [{ key: 'attractSound', label: 'The demo makes its sounds', default: false, level: 'advanced',
      onLabel: 'Yes', offLabel: 'No, it is silent' }] : []),
  ];
}

/** How long the demo plays, ms; 0 = no limit (Infinity). Anything not offered falls back to the default. */
export function demoLimitMs(v) {
  const m = ATTRACT_FOR_MS.includes(Number(v)) ? Number(v) : ATTRACT_DEFAULTS.attractForMs;
  return m > 0 ? m : Infinity;
}
/** How long after a game comes to rest the demo comes back, ms; 0 = never. */
export function demoReturnMs(v) {
  return ATTRACT_AFTER_MS.includes(Number(v)) ? Number(v) : ATTRACT_DEFAULTS.attractAfterMs;
}

// ---------------------------------------------------------------------------------------------------
// SAYING "START" ALOUD. A module's manifest `voice` (input_speech.js `moduleVoiceTable`): while the game
// has focus, these phrases press its `play` verb, which starts a game that is waiting. Not in the screen-
// wide table on purpose (input_speech.js: "start" and "stop" are a sound apart, and everywhere else
// "stop" is pause) - on a waiting game, mis-hearing one for the other does nothing at all.
// ---------------------------------------------------------------------------------------------------
export const START_VOICE = Object.freeze({
  start: 'play', 'start the game': 'play', 'start playing': 'play', 'play the game': 'play',
});

// ---------------------------------------------------------------------------------------------------
// TELLING THE SHELL WHETHER THIS PANEL IS PLAYING. `{ id, playing }` on PLAY_STATE_TOPIC, only when it
// changes. The kiosk's Pause / Play button follows it (kiosk.js `pausedPanels`), so the next press on a
// waiting game is `play`. A host that does not listen loses nothing.
// ---------------------------------------------------------------------------------------------------
export function createPlayReporter(bus, ctx) {
  let last = null;
  return (playing) => {
    const p = !!playing;
    if (p === last) return;
    last = p;
    try { bus?.publish?.(PLAY_STATE_TOPIC, { id: ctx?.instanceId || null, playing: p }); }
    catch (err) { console.error('game: play state', err); }
  };
}

// ---------------------------------------------------------------------------------------------------
// THE START BUTTON. One look for every game: a big button and one line, at the bottom of the panel, over
// whatever is behind it (the demo, or the game's still first frame). Theme variables only.
// The lit button rings in the theme's --scan-ring (3:1 on every surface in every theme, theme.js), not the raw
// --link (2026-10-04). Because what is behind it is a GAME FRAME, not a surface, the gap between the button and
// the ring is filled with a band of --surface (a box-shadow as wide as the offset), so the ring's inner side is
// always a colour it was measured against.
// ---------------------------------------------------------------------------------------------------
const STYLE_ID = 'game-start-style';
const CSS = `
.gs-start{position:absolute;inset:auto 0 0 0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;
  gap:clamp(8px,2cqmin,24px);padding:clamp(8px,2.5cqmin,28px);z-index:4;pointer-events:none}
.gs-start[hidden]{display:none}
.gs-btn{pointer-events:auto;min-height:max(56px,12cqmin);min-width:max(140px,30cqmin);padding:0 clamp(16px,4cqmin,48px);
  border-radius:clamp(12px,2.5cqmin,28px);border:max(3px,.7cqmin) solid var(--accent);background:var(--surface);
  color:var(--text-strong,var(--text));font:800 clamp(18px,6cqmin,64px)/1 var(--font);cursor:pointer}
.gs-btn[data-on="1"]{outline:max(3px,1cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(2px,.5cqmin);
  box-shadow:0 0 0 max(2px,.5cqmin) var(--surface)}
.gs-note{pointer-events:none;margin:0;padding:.3em .8em;border-radius:999px;
  background:color-mix(in srgb, var(--surface) 85%, transparent);color:var(--text);
  font:700 clamp(13px,3cqmin,32px)/1.25 var(--font)}
.gs-host{position:relative}
`;
export function ensureStartStyle(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

export const START_LINES = Object.freeze({
  demo: 'The computer is playing. Press Start to play.',
  still: 'Press Start to play.',
});

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The Start overlay's markup. `demo` picks the line; `note: false` leaves the line out (a game that already
 * has a line of words under its field says it there). The button is lit (`data-on`): on a waiting game
 * it is the only thing a switch can reach, so it is always the one a press presses.
 */
export function startOverlayHtml({ demo = false, label = 'Start', lit = true, note = true, text = null } = {}) {
  const line = text != null ? text : (demo ? START_LINES.demo : START_LINES.still);
  return `<div class="gs-start" data-start-overlay><button type="button" class="gs-btn" data-start${lit ? ' data-on="1"' : ''}>`
    + `▶ ${esc(label)}</button>${note ? `<p class="gs-note" data-start-note>${esc(line)}</p>` : ''}</div>`;
}
