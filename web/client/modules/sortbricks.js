// modules/sortbricks.js — SORT THE BRICKS: A SHAPE SORTER, THEN SORTING BY COLOUR AND BY SIZE (brick games, row 2.76,
// 2026-10-10).
//
// Mike, 2026-10-09: "Any other ideas for games with our bricks?" Two of chat's ideas, as one game: "sort by colour or
// size (therapy-friendly, very easy levels)" and "match the brick to its slot (a shape sorter for the earliest levels)".
// The rules and the levels are `../sort_bricks.js` (which says what is ours and why); the brick is drawn by
// `../brick_face.js`; this file is the panel.
//
// *** THE NAME: "SORT THE BRICKS", ARGUED. *** FOR: three plain words that say the whole game, and it covers every level
// (a slot is a place a brick is sorted into too). AGAINST: "Shape sorter" is the more familiar phrase for the first two
// levels, but it says nothing about colour and size, and it is a toy's common name. A name is one line here and in the
// catalog. [Mike's list.]
//
// *** CHOOSING: EVERY WAY THE OTHER CHOICE GAMES HAVE. ***
//   * ONE SWITCH: the places light up one after another by themselves (`lightMoves: 'auto'`, every `scanMs`); a press
//     puts the brick in the lit one. The step is never shorter than the screen's flashing limit (Brick Drop's rule).
//   * TWO SWITCHES: next / previous move the light (and start its clock again, so a jump is never cut short), select
//     puts the brick in. `lightMoves: 'off'` stops the light moving by itself, for two switches or keys.
//   * TOUCH OR CLICK: a place itself, touched, takes the brick. Keys: Left / Right move the light, Enter or Down puts it
//     in, the number keys 1-3 choose a place outright.
//   * AT ONE SLOT, ANY PRESS PUTS THE BRICK IN, and it is right: select, next, previous, any of those keys, or a touch
//     anywhere on the game. The first level can be won by somebody who can only press one thing.
// The light names each place aloud as it lands on it ("Teal?"), the quiz games' "Say the switch choice too", and each
// new brick says its colour ("A teal brick."), where the screen's voice is on. Nothing is said before Start.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. *** (Stack to the line's rules, kept)
//   * It waits for Start (game_start.js), with the computer sorting calmly meanwhile: it looks at the brick, lights the
//     place it goes, and puts it in, a brick every few seconds. That is also the game for somebody who can only watch.
//   * A full tray sorted: "All sorted!" for REST_MS, then a new tray by itself. A press skips it.
//   * A wrong place costs nothing: the brick comes back and is asked again; after `showAfter` misses the right place
//     is shown.
//   * A GAME NOBODY IS PLAYING COMES TO REST: IDLE_MS with no press and the light stops; the demo comes back after
//     `attractAfterMs`. The next press picks it up.
//   * No sound before the first press, and no music: this is a game that talks, and music under a voice saying colour
//     names competes with it. [Argued; Mike's list.]
//     *** MUSIC IS NOW A SETTING, STILL OFF BY DEFAULT (row 2.107, 2026-10-31). *** Mike: "What happened to adding music
//     to the games?" The same rows as every game with music (game_music_host.js), played only while it is being played.
//     The default stays 'off', argued (Rule 1): FOR 'mine' (your music), as Build it and the other brick games: it is a
//     building game, and the bed is ducked under the voice. AGAINST, and it decides it: the argument above still holds -
//     with one switch the voice naming each lit place ("Teal?") IS how the game is played (`sayChoice`), and every new
//     brick is said by colour; a bed under that costs clarity for exactly the person scanning by ear. The answer games
//     made the same call (quiz_flow.js). Somebody who plays by sight turns it on in one row. [Guess, on Mike's list.]
//   * Reduced motion: a brick goes straight into its place, nothing shakes, and there is no demo (the still Start).
//
// THE SCORE is bricks sorted this game, on the score contract (`../score_source.js`). EACH TRAY SORTED PAYS `trayPoints`
// Play points (1 by default: a tray is sorted by presses, and a game nobody presses comes to rest).

import { followPanelSpeaker } from '../speakers.js';
import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { createGameMusic } from '../game_music.js';
import { createGameMusicHost, gameMusicFields } from '../game_music_host.js';
import { SYSTEM_TOPICS } from '../actions.js';
import { SHELL_STATE } from '../shell_verbs.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
import {
  autostartFields, attractFields, shouldAutostart, panelAlone, createPlayWatch, demoLimitMs, demoReturnMs,
  ATTRACT_DEFAULTS, START_VOICE, START_LINES, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';
import { gameAgentFor, askAgent } from '../game_agent.js';
import { ensureBrickFaceStyle } from '../brick_face.js';
import { BRICK_COLOURS, BRICK_COLOUR_COUNT } from '../brick_colours.js';
import {
  LEVELS, LEVEL_IDS, MOVE_MS, REST_MS, MIXES, AFTER_TRAY, levelOf, trayOf, newGame, freshTray, choosePlace, step,
  setPaused, rightPlace, left, colourNames, parseColour, sortComputer,
} from '../sort_bricks.js';

export const GAME = 'sortbricks';
export const TITLE = 'Sort the bricks';
export const SCORE_LABEL = 'Sort the bricks: bricks sorted';

// A game nobody is pressing comes to rest after this long. 45 s, Brick Drop's and Stack to the line's number and
// reason: longer than a person thinking takes (three full laps of three places at the default light), short enough
// that an empty room does not watch a light go round for long. Not a setting.
export const IDLE_MS = 45000;
// The demo takes a step this often: it looks at the brick, then lights its place, then puts it in. 1.5 s a step is
// about one brick every 4 to 5 s with the move: calm enough to watch and follow, quick enough to read as a game.
export const DEMO_STEP_MS = 1500;
export const VOICE = Object.freeze({
  'put it in': 'select', 'in it goes': 'select', 'this one': 'select', pause: 'pause', resume: 'play', ...START_VOICE,
});

// What is said aloud. Short, plain, and never a person's name.
export const LINES = Object.freeze({
  right: 'Yes!',
  wrong: 'Not that one.',
  tray: 'All sorted!',
});

export const DEFAULTS = Object.freeze({
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
  pauseOpensMenu: true,
  level: 1,
  lightMoves: 'auto',
  // *** 4 SECONDS A PLACE, ARGUED. *** FOR longer (input_scan.js's 15 s, carried from a real bedside board): the step is
  // set by how long a RESPONSE takes, and a press can take seconds. AGAINST, for this game's default: with two or three
  // places a 15 s step is a 45 s lap, which reads to a watcher as a game that stopped; Brick Drop's 2 s is for a game of
  // timing. 4 s is a lap of 8 to 12 s. 10 and 15 s are in the list for whoever needs them.
  scanMs: 4000,
  trayBricks: 5,
  showAfter: 2,
  mix: 'one',
  afterTray: 'same',
  speak: true,
  sayChoice: true,
  sounds: true,
  trayPoints: 1,
  // Row 2.107: the music rows, off by default here (the header argues why).
  music: 'off', musicSourceId: '', musicAlbum: '', musicFavourite: '', musicVolume: 0.3,
});
export const MUSIC_DEFAULT = 'off';

// "One level up" after a tray is OFF by default, argued as in Brick Drop: in therapy the level is somebody's choice,
// and a game that gets harder under a person who was managing is a setback nobody asked for.
const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Bricks sorted this game. A Scoreboard on the same screen can show it instead.' }),
  { key: 'level', label: 'Level', kind: 'choice', default: 1, level: 'essential',
    options: LEVEL_IDS.map((n) => ({ value: n, label: LEVELS[n].places === 1 ? `${LEVELS[n].label}: any press puts the brick in` : LEVELS[n].label })),
    note: 'Starts with the next tray.' },
  ...autostartFields({ on: false }),
  ...attractFields({ on: true, sound: true }),
  { key: 'lightMoves', label: 'The light on the places', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Moves by itself. A press puts the brick in the lit place. One switch can play' },
      { value: 'off', label: 'Moves only when told: Next moves it, Select puts the brick in' }],
    note: 'A place touched always takes the brick.' },
  { key: 'scanMs', label: 'How long each choice stays lit', kind: 'choice', default: 4000, level: 'standard',
    options: [2000, 3000, 4000, 6000, 10000, 15000].map((v) => ({ value: v, label: `${v / 1000} seconds` })),
    note: 'Never faster than the screen\'s flashing limit.', appliesWhen: (v) => !v || v.lightMoves !== 'off' },
  { key: 'trayBricks', label: 'Bricks in a tray', kind: 'choice', default: 5, level: 'standard',
    options: [3, 5, 8, 10].map((v) => ({ value: v, label: String(v) })), note: 'Starts with the next tray.' },
  { key: 'showAfter', label: 'After a wrong place, show the right one', kind: 'choice', default: 2, level: 'standard',
    options: [{ value: 1, label: 'After 1 miss' }, { value: 2, label: 'After 2 misses' }, { value: 3, label: 'After 3 misses' },
      { value: 0, label: 'Never' }],
    note: 'A miss never costs anything: the same brick is asked again.' },
  { key: 'mix', label: 'What else changes', kind: 'choice', default: 'one', level: 'standard',
    options: [{ value: 'one', label: 'Nothing: only the color, or only the size, changes' },
      { value: 'both', label: 'Both: sizes mixed in with the colors, colors with the sizes. Harder' }],
    note: 'Starts with the next tray.' },
  { key: 'afterTray', label: 'After a tray is sorted', kind: 'choice', default: 'same', level: 'standard',
    options: [{ value: 'same', label: 'A new tray at the same level' }, { value: 'up', label: 'A new tray one level up' }] },
  { key: 'speak', label: 'Say the brick\'s color aloud', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'sayChoice', label: 'Say each place as it lights', default: true, level: 'standard',
    onLabel: 'Yes ("Teal?")', offLabel: 'No', note: 'Somebody using a switch needs it.' },
  { key: 'sounds', label: 'Sounds', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  ...gameMusicFields({ defaultMode: MUSIC_DEFAULT }),   // row 2.107: the same music rows every game has, off here
  { key: 'pauseOpensMenu', label: 'Escape and the Pause command also open the settings', default: true,
    level: 'standard', onLabel: 'Yes', offLabel: 'No, they only pause' },
  { key: 'trayPoints', label: 'Play points for each tray sorted', kind: 'number', default: 1, min: 0, max: 20, step: 1,
    level: 'advanced', note: '0 means trays pay nothing.' },
];

// Sounds: argued constants (the setting is whether there are any). Right is a bright tone, wrong a soft low one (never
// a buzzer), a full tray a higher one.
const TONES = { right: [523, 110, 'triangle'], wrong: [220, 160, 'sine'], tray: [659, 300, 'triangle'] };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const an = (word) => (/^[aeiou]/i.test(word) ? 'An' : 'A');

/** The line under the game. Exported so the suite reads it without a DOM. */
export function statusFor(g, { idle = false, news = '' } = {}) {
  switch (g.phase) {
    case 'paused': return 'Paused. Press to go on.';
    case 'won': return 'All sorted! More bricks are coming.';
    case 'moving': return news || 'In it goes!';
    case 'ready': return 'Press to play.';
    default:
      if (idle) return 'Press to play.';
      if (news) return news;
      if (g.places.length === 1) return 'Press to put the brick in.';
      if (g.kind === 'slot') return 'Which slot does it fit?';
      if (g.kind === 'colour') return 'Put it with its color.';
      return 'Put it with its size.';
  }
}
const NEWS = Object.freeze({ wrong: 'Not that one. Try another.', show: 'Not that one. It goes here.' });

// THE PANEL'S OWN LOOK. In the module so the theme checks that read every client .js read it. Theme roles only; the
// bricks are brick_face.js's.
const STYLE_ID = 'sortbricks-style';
const CSS = `
.sb-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;
  --sb-edge: var(--border, #c9c3ad);
  --sb-socket: color-mix(in srgb, var(--border, #c9c3ad) 80%, var(--text, #0A3323));}
.sb-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px;box-shadow:inset 0 0 0 5px var(--surface, Canvas)}
.sb-wrap *{box-sizing:border-box}
.sb{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto;gap:.4rem;padding:.5rem;font-family:var(--font)}
.sb [hidden]{display:none !important}
.sb-stage{min-height:0;container-type:size;display:grid;grid-template-rows:minmax(0,1fr) minmax(0,1.35fr);gap:3cqh;
  --sb-u:min(9cqw, 15cqh);--sb-v:min(6cqw, 10cqh);--sb-w:min(2.6cqw, 4cqh)}
.sb-up{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1cqh;min-height:0}
.sb-brick{height:var(--sb-u);width:calc(var(--sb-u) * var(--nb-cells, 1))}
.sb-brick[data-going]{animation:sb-go ${MOVE_MS}ms ease-in forwards}
@keyframes sb-go{to{transform:translateY(60%) scale(.5);opacity:0}}
.sb-left{margin:0;font:700 clamp(13px, 4cqh, 26px)/1.2 var(--font);color:var(--text)}
.sb-places{display:flex;justify-content:center;align-items:stretch;gap:3cqw;min-height:0}
.sb-place{flex:1 1 0;max-width:34cqw;min-width:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);justify-items:center;
  align-content:start;gap:1.2cqh;padding:1.5cqh 1cqw;border-radius:14px;border:3px solid var(--sb-edge);background:var(--surface);
  color:var(--text-strong, var(--text));font:800 clamp(15px, 5cqh, 34px)/1.1 var(--font);cursor:pointer;touch-action:manipulation}
.sb-places[data-n="2"] .sb-place{max-width:46cqw}
.sb-place[data-kind="slot"]{display:flex;flex-direction:column;align-items:center;justify-content:center;background:color-mix(in srgb, var(--sb-edge) 45%, var(--surface))}
.sb-place[data-lit="1"]{outline:5px solid var(--scan-ring, var(--focus, currentColor));outline-offset:4px}
.sb-place[data-shown="1"]{border-style:dashed;border-width:5px;border-color:var(--text-strong, var(--text))}
.sb-place[data-wrong="1"]{animation:sb-no 400ms ease-in-out}
@keyframes sb-no{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
/* A slot or a size outline is drawn at the SAME scale as the brick up, so a length can be compared by eye. */
.sb-hole{height:var(--sb-u);width:calc(var(--sb-u) * var(--sb-len, 1));border-radius:6px;border:3px dashed var(--sb-socket);
  background-image:radial-gradient(circle closest-side at 50% 50%, var(--sb-socket) 0 18%, transparent 24%);
  background-size:calc(100% / var(--sb-len, 1)) 100%}
.sb-sample{height:var(--sb-v);width:calc(var(--sb-v) * 2)}
.sb-pile{display:flex;flex-wrap:wrap-reverse;justify-content:center;align-content:flex-start;gap:3px;min-height:0;overflow:hidden}
.sb-mini{height:var(--sb-w);width:calc(var(--sb-w) * var(--nb-cells, 1))}
.sb-here{display:block;font-size:.7em;color:var(--text)}
.sb[data-motion="reduce"] *{transition:none !important;animation:none !important}
.sb-paused{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:.4em;
  background:color-mix(in srgb, var(--surface) 55%, transparent);color:var(--text-strong);
  font-weight:800;font-size:clamp(18px, 8cqh, 64px);pointer-events:none}
.sb-paused-word{padding:.05em .4em;border-radius:.3em;background:var(--surface)}
.sb-bar{display:flex;flex-wrap:wrap;gap:.2rem 1.2rem;align-items:baseline;justify-content:center;min-height:2.2em}
.sb-say{margin:0;font-size:clamp(15px, 2.4vmin, 28px);font-weight:600;color:var(--text-strong)}
.sb-score{margin:0;font-size:clamp(14px, 2.1vmin, 24px);color:var(--text)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

registerModule(
  { type: GAME, title: TITLE, core: 'new', routesSound: true,
    description: 'Put each Nimrod brick where it goes: first in the slot it fits, then with its color, then with '
      + 'its size. At the first level any press puts the brick in. The places light up in turn, so one switch can play.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const audio = ctx.audio || null;
    const rand = ctx.rand || Math.random;
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);

    let cfg = { ...DEFAULTS };
    let g = null;
    let idle = true;
    let armed = false;
    let news = '';
    let lit = 0;
    let stats = { best: 0, sorted: 0, trays: 0 };
    let dead = false, hidden = false;
    let rootEl = null, upEl = null, placesEl = null, sayEl = null, scoreEl = null, overlayEl = null, sbEl = null;
    let lastSay = '', lastScore = '', lastOverlay = null, lastUp = '', lastPlaces = '';
    let menuAsks = 0;
    let score = null, ledger = null, tones = null, unSpeaker = null;   // the panel's own speaker (speakers.js followPanelSpeaker)
    let musicHost = null;   // row 2.107: the music (game_music_host.js), on exactly when the game sounds are (syncAudio)
    let started = true, demo = false, demoMs = 0, demoRested = false, demoMemory = {}, agent = null;
    let lightTimer = null, waitTimer = null, idleTimer = null, restTimer = null, demoTimer = null;
    let litSaid = null, litKey = '';
    const said = [];             // what was said, for a suite
    const plays = createPlayWatch(bus, ctx);

    const pick = (v, list, d) => (list.includes(v) ? v : d);
    const moveMs = () => (reducedMotion() ? 0 : MOVE_MS);
    const choiceOpts = () => ({ showAfter: started ? Number(cfg.showAfter) || 0 : 0, moveMs: moveMs(), restMs: REST_MS });
    let pendingLevel = null;     // a level chosen while a tray was going: it starts with the next tray
    const stepOpts = () => ({ rand, afterTray: started ? pick(cfg.afterTray, AFTER_TRAY, 'same') : 'same', level: started ? pendingLevel : null });
    // The light's step: the setting, never shorter than the screen's flash limit allows (flash_limit.js).
    const lightStepMs = () => Math.max(Number(cfg.scanMs) || DEFAULTS.scanMs, minFlashPeriodMs(flashLimit(ctx)));
    const clear = (h) => { if (h != null) { try { clearT(h); } catch { /* gone */ } } return null; };

    // ---- the colours and their names ---------------------------------------------------------------
    function themeColours() {
      let cs = null;
      try { cs = rootEl && typeof getComputedStyle === 'function' ? getComputedStyle(rootEl) : null; } catch { cs = null; }
      return Array.from({ length: BRICK_COLOUR_COUNT }, (_, i) => {
        const v = cs ? cs.getPropertyValue(`--nb-${i + 1}`).trim() : '';
        return parseColour(v) ? v : BRICK_COLOURS.default[i].hex;
      });
    }
    const namesNow = () => colourNames(themeColours(), BRICK_COLOURS);
    const colourName = (c) => namesNow()[c] || `Color ${c + 1}`;
    function placeName(p) {
      if (!p) return '';
      if (g.kind === 'colour') return colourName(p.c);
      if (g.kind === 'size') return p.name;
      return '';
    }
    // Where a place is, said aloud ("the teal box", "this slot").
    const placeWords = (p) => (g.kind === 'slot' ? 'this slot' : `the ${placeName(p).toLowerCase()} box`);

    // ---- speech --------------------------------------------------------------------------------------
    const canSpeak = () => !!cfg.speak && started && !dead && !hidden && g && g.phase !== 'paused' && !!ctx.output?.say;
    function speak(text, { cancelLast = false } = {}) {
      if (!text || !canSpeak()) return null;
      try {
        if (cancelLast && litSaid && ctx.output.cancel) ctx.output.cancel(litSaid);
        const id = ctx.output.say(text, { source: GAME });
        said.push(text);
        if (said.length > 60) said.shift();
        return id;
      } catch (err) { console.error('sortbricks: say', err); return null; }
    }
    let brickSaid = null;        // the brick whose colour was last said
    function sayBrick() {
      if (!g?.brick) return;
      brickSaid = g.brick.id;
      const name = colourName(g.brick.c).toLowerCase();
      speak(`${an(name)} ${name} brick.`);
    }
    // The brick up, said once (a game that started by itself, or woke up, has not said it yet).
    const announce = () => { if (g?.brick && brickSaid !== g.brick.id) sayBrick(); };
    // The lit place, said as it lands (once per place per brick).
    function sayLit() {
      if (!cfg.sayChoice || !g || g.phase !== 'play' || g.places.length < 2 || idle) return;
      const key = `${g.brick?.id}:${lit}`;
      if (key === litKey) return;
      litKey = key;
      const p = g.places[lit];
      const id = speak(g.kind === 'slot' ? 'This slot?' : `${placeName(p)}?`, { cancelLast: true });
      if (id) litSaid = id;
    }

    // ---- sound ---------------------------------------------------------------------------------------
    function sound(ev) {
      if (!cfg.sounds || !armed || !tones) return;
      if (!started && cfg.attractSound !== true) return;
      const t = TONES[ev];
      if (t) tones.tone(t[0], t[1], { type: t[2], level: 0.7 });
    }
    function syncAudio() {
      // The music: only while somebody is playing - never under the demo, while paused, idle or hidden (row 2.107).
      if (!started) {
        musicHost?.follow(false);
        tones?.setActive(!dead && !hidden && armed && demo && !demoRested && cfg.attractSound === true && !!cfg.sounds); return;
      }
      const playing = !dead && !hidden && armed && !!g && g.phase !== 'paused' && !idle;
      musicHost?.follow(playing);
      tones?.setActive(playing && !!cfg.sounds);
    }
    function save() { try { state?.set?.({ stats }); } catch (err) { console.error('sortbricks: save', err); } }

    // ---- the light -----------------------------------------------------------------------------------
    const lightWanted = () => started && !dead && !hidden && !idle && g && g.phase === 'play' && g.places.length > 1
      && cfg.lightMoves !== 'off';
    function armLight() {
      lightTimer = clear(lightTimer);
      if (!lightWanted()) return;
      lightTimer = setT(() => { lightTimer = null; if (!lightWanted()) return; moveLight(1, { press: false }); }, lightStepMs());
    }
    function moveLight(dir, { press = true } = {}) {
      const n = g.places.length;
      if (n < 1) return;
      lit = ((lit + dir) % n + n) % n;
      if (press) news = '';
      sayLit();
      render();
      armLight();
    }

    // ---- timers that move the game on ---------------------------------------------------------------
    function scheduleWait() {
      waitTimer = clear(waitTimer);
      if (dead || hidden || !g || (g.phase !== 'moving' && g.phase !== 'won')) return;
      if (!(g.wait > 0)) { handleStep(step(g, 0, stepOpts())); return; }
      waitTimer = setT(() => {
        waitTimer = null;
        if (dead || !g) return;
        if (!started) demoMs += g.wait;     // the demo's time counts its pauses too ("The demo plays for")
        handleStep(step(g, g.wait, stepOpts()));
      }, g.wait);
    }
    function handleStep(events) {
      if (!events.length) return;
      for (const ev of events) {
        if (ev === 'fresh' || ev === 'levelup') pendingLevel = null;
        if (ev === 'next' || ev === 'fresh' || ev === 'levelup') { lit = 0; litKey = ''; news = ''; sayBrick(); }
      }
      render();
      armLight();
      sayLit();
      demoAfterStep();
    }

    // ---- the demo ------------------------------------------------------------------------------------
    function demoObservation() {
      return { game: GAME, kind: 'sort-bricks', t: demoMs, actions: ['light', 'pick'],
        state: { phase: g.phase, kind: g.kind, lit, right: rightPlace(g),
          brick: g.brick ? { len: g.brick.len, c: g.brick.c, id: g.brick.id } : null,
          places: g.places.map((p) => ({ len: p.len, c: p.c })) } };
    }
    function applyDemo(a) {
      if (!a || started || dead || !g || g.phase !== 'play') return;
      const i = Math.round(Number(a.place));
      if (!(i >= 0 && i < g.places.length)) return;
      if (a.act === 'light') { lit = i; render(); return; }
      if (a.act === 'pick') { lit = i; afterChoice(choosePlace(g, i, choiceOpts())); }
    }
    function demoTick() {
      demoTimer = null;
      if (dead || started || !demo || demoRested || hidden) return;
      demoMs += DEMO_STEP_MS;
      if (demoMs >= demoLimitMs(cfg.attractForMs)) { demoRested = true; syncAudio(); render(); return; }
      if (g.phase === 'play') applyDemo(askAgent(agent, demoObservation(), { rand, memory: demoMemory }, { onLate: (x) => applyDemo(x) }));
      if (g.phase === 'play') demoTimer = setT(demoTick, DEMO_STEP_MS);
    }
    // After a brick has gone in (or a new tray has come), the demo looks again.
    function demoAfterStep() {
      if (started || dead || !demo || demoRested || hidden) return;
      demoTimer = clear(demoTimer);
      demoTimer = setT(demoTick, DEMO_STEP_MS);
    }

    // ---- choices -------------------------------------------------------------------------------------
    function afterChoice(events) {
      for (const ev of events) {
        sound(ev);
        if (!started) continue;
        if (ev === 'right') { news = ''; speak(LINES.right); }
        else if (ev === 'wrong') { news = NEWS.wrong; speak(LINES.wrong); }
        else if (ev === 'show') { news = NEWS.show; speak(`It goes in ${placeWords(g.places[g.shown])}.`); }
        else if (ev === 'tray') {
          stats = { ...stats, trays: (Number(stats.trays) || 0) + 1 };
          speak(LINES.tray);
          pay();
        }
      }
      if (started && events.includes('right')) {
        stats = { ...stats, sorted: (Number(stats.sorted) || 0) + 1, best: Math.max(Number(stats.best) || 0, g.sorted) };
        save();
      }
      if (events.includes('wrong')) litKey = '';
      syncAudio();
      render();
      if (events.includes('right')) { lightTimer = clear(lightTimer); scheduleWait(); } else armLight();
    }
    function pay() {
      const per = Math.round(Number(cfg.trayPoints) || 0);
      if (!(per > 0) || !ledger) return;
      Promise.resolve(ledger.award({ amount: per, source: GAME, type: 'Play', tags: [GAME],
        note: `${TITLE}: a tray sorted` })).catch((err) => console.error('sortbricks: points', err));
    }

    // ---- presses -------------------------------------------------------------------------------------
    function markInput() {
      idle = false;
      clearRest();
      idleTimer = clear(idleTimer);
      if (started) idleTimer = setT(goIdle, IDLE_MS);
      if (!armed) { armed = true; tones?.resume(); }
      plays.active();
      syncAudio();   // row 2.107: a press is what starts the music (and wakes it from idle)
    }
    function goIdle() {
      idleTimer = null;
      if (dead || !started || idle || g?.phase === 'paused') return;
      idle = true;
      lightTimer = clear(lightTimer);
      plays.rest();
      syncAudio(); render();
      scheduleDemo();
    }
    function clearRest() { restTimer = clear(restTimer); }
    function scheduleDemo() {
      const ms = demoReturnMs(cfg.attractAfterMs);
      if (!(ms > 0) || restTimer != null || dead) return;
      restTimer = setT(() => { restTimer = null; if (!dead && started && idle && g?.phase !== 'paused') toStartScreen(); }, ms);
    }
    const demoWanted = () => cfg.attract !== false && !reducedMotion();
    function fresh() {
      g = newGame({ level: levelOf(cfg.level), tray: trayOf(cfg.trayBricks, DEFAULTS.trayBricks), mix: pick(cfg.mix, MIXES, 'one'), rand });
      lit = 0; litKey = ''; news = ''; idle = true;
    }
    function stopTimers() {
      lightTimer = clear(lightTimer); waitTimer = clear(waitTimer); demoTimer = clear(demoTimer);
    }
    function toStartScreen() {
      if (dead) return;
      clearRest(); stopTimers(); idleTimer = clear(idleTimer);
      started = false;
      fresh();
      demo = demoWanted();
      demoMs = 0; demoRested = false; demoMemory = {};
      agent = demo ? (gameAgentFor(GAME, 'sort-bricks') || sortComputer) : null;
      plays.pause();            // a game waiting for Start says it is not playing (game_start.js)
      syncAudio(); render();
      if (demo && !hidden) demoTimer = setT(demoTick, DEMO_STEP_MS);
    }
    function startGame() {
      if (dead || started) return false;
      stopTimers();
      started = true; demo = false; agent = null; demoMemory = {};
      fresh();
      markInput();
      syncAudio(); render();
      sayBrick(); sayLit(); armLight();
      return true;
    }
    // Every press-shaped input goes through here first: Start, then going on from a pause, then skipping the rest.
    function gateInput() {
      if (dead || !g) return true;
      if (startGame()) return true;
      return false;
    }
    function common() {
      if (g.phase === 'paused') { resumeGame(); return true; }
      if (g.phase === 'won') { waitTimer = clear(waitTimer); handleStep(step(g, g.wait, stepOpts())); return true; }
      if (g.phase !== 'play') { render(); return true; }
      return false;
    }
    // SELECT, ENTER, DOWN, LAUNCH: put the brick in the lit place (any press, at one slot).
    function press() {
      if (gateInput()) return;
      const wasIdle = idle;
      markInput();
      if (common()) return;
      announce();
      if (g.places.length === 1) { afterChoice(choosePlace(g, 0, choiceOpts())); return; }
      // A press that wakes a game that came to rest only wakes it: the light had stopped, and putting the brick where
      // it stopped would spend the press on a choice nobody was watching.
      if (wasIdle) { lit = 0; litKey = ''; news = ''; sayLit(); render(); armLight(); return; }
      afterChoice(choosePlace(g, lit, choiceOpts()));
    }
    // NEXT / PREVIOUS (and Right / Left): move the light; at one slot they are any press.
    function move(dir) {
      if (gateInput()) return;
      const wasIdle = idle;
      markInput();
      if (common()) return;
      announce();
      if (g.places.length === 1) { afterChoice(choosePlace(g, 0, choiceOpts())); return; }
      if (wasIdle) { lit = 0; litKey = ''; news = ''; sayLit(); render(); armLight(); return; }
      moveLight(dir);
    }
    // A PLACE TOUCHED (or its number key): that place, outright.
    function pickPlace(i) {
      if (gateInput()) return;
      markInput();
      if (common()) return;
      const k = Math.round(Number(i));
      if (!(k >= 0 && k < g.places.length)) return;
      announce();
      lit = k;
      afterChoice(choosePlace(g, k, choiceOpts()));
    }
    function back() {
      if (dead || !started || !g) return;
      markInput();
      if (g.phase === 'paused') resumeGame(); else pauseGame();
    }
    function openMenu() {
      menuAsks++;
      let claimed = false;
      try { bus.publish(SYSTEM_TOPICS.settings, { from: GAME, claim() { claimed = true; } }); }
      catch (err) { console.error('sortbricks: settings menu', err); }
      return claimed;
    }
    function pauseGame({ menu = false } = {}) {
      if (dead || !g || !started) return;
      if (setPaused(g, true)) { lightTimer = clear(lightTimer); waitTimer = clear(waitTimer); }
      plays.pause();
      syncAudio(); render();
      if (menu && cfg.pauseOpensMenu !== false) openMenu();
    }
    function resumeGame() {
      if (dead || !g) return;
      if (startGame()) return;
      markInput();
      setPaused(g, false);
      syncAudio(); render();
      scheduleWait(); armLight();
    }

    // ---- pointer and keys ----------------------------------------------------------------------------
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
      const place = e.target.closest('[data-place]');
      e.preventDefault();
      if (place && started && g.phase !== 'paused') { pickPlace(Number(place.dataset.place)); return; }
      // Off the places: Start, going on, skipping the rest - and at one slot, the press that puts the brick in.
      if (!started || !g || g.phase !== 'play' || g.places.length === 1) press();
    }
    function onKey(e) {
      if (dead || !g || e.repeat) return;
      if (e.key === 'Escape') {
        if (!started) return;
        e.preventDefault(); e.stopPropagation();
        pauseGame({ menu: true });
        return;
      }
      let act = null;
      if (e.key === 'Enter' || e.key === 'ArrowDown') act = () => press();
      else if (e.key === 'ArrowRight') act = () => move(1);
      else if (e.key === 'ArrowLeft') act = () => move(-1);
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= g.places.length) act = () => (started ? pickPlace(Number(e.key) - 1) : press());
      if (act) { e.preventDefault(); e.stopPropagation(); act(); }
    }

    // ---- drawing -------------------------------------------------------------------------------------
    const face = (b, cls) => `<div class="${cls} nb-face" data-c="${b.c}" style="--nb-cells:${b.len}"></div>`;
    function placeHtml(p, i) {
      const showLit = g.phase === 'play' && (started ? !idle : demo && !demoRested) && g.places.length > 1 && i === lit;
      const shown = g.shown === i;
      const wrong = g.wrong === i && !reducedMotion();
      const attrs = ` data-place="${i}" data-kind="${g.kind}"${showLit ? ' data-lit="1"' : ''}${shown ? ' data-shown="1"' : ''}${wrong ? ' data-wrong="1"' : ''}`;
      const pile = `<div class="sb-pile" aria-hidden="true">${p.items.slice(-8).map((b) => face(b, 'sb-mini')).join('')}</div>`;
      const here = shown ? '<span class="sb-here">It goes here</span>' : '<span class="sb-here"></span>';
      if (g.kind === 'slot') {
        const inIt = p.items.length ? face(p.items[p.items.length - 1], 'sb-brick') : '';
        return `<button type="button" class="sb-place"${attrs} aria-label="A slot ${p.len} long">${here}`
          + `${inIt || `<div class="sb-hole" style="--sb-len:${p.len}"></div>`}<span></span></button>`;
      }
      const name = placeName(p);
      const sample = g.kind === 'colour' ? `<div class="sb-sample nb-face" data-c="${p.c}" style="--nb-cells:2"></div>`
        : `<div class="sb-hole" style="--sb-len:${p.len}"></div>`;
      return `<button type="button" class="sb-place"${attrs} aria-label="${esc(name)}">`
        + `<span>${esc(name)}${shown ? '<span class="sb-here">It goes here</span>' : ''}</span>${sample}${pile}</button>`;
    }
    function render() {
      if (dead || !rootEl || !g) return;
      if (sbEl) {
        sbEl.dataset.phase = g.phase;
        sbEl.dataset.motion = reducedMotion() ? 'reduce' : 'full';
        sbEl.dataset.started = started ? '1' : '0';
        sbEl.dataset.demo = !started && demo && !demoRested ? '1' : '0';
        sbEl.dataset.level = String(g.level);
        sbEl.dataset.kind = g.kind;
      }
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ demo: demo && !demoRested, note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      // The brick up, and how many are left in the tray.
      const b = g.brick;
      const going = g.phase === 'moving' || g.phase === 'won';
      const shownBrick = going ? g.tray[g.at - 1] : b;
      const nLeft = left(g) - (going ? 0 : 1);
      const up = shownBrick
        ? `<div class="sb-brick nb-face" data-brick data-c="${shownBrick.c}" style="--nb-cells:${shownBrick.len}"${going && !reducedMotion() ? ' data-going' : ''}${going && reducedMotion() ? ' hidden' : ''}></div>`
          + `<p class="sb-left" data-left>${nLeft > 0 ? `${nLeft} more to sort` : (going ? '' : 'The last one')}</p>`
        : '';
      const upKey = `${up}|${g.phase === 'paused' ? 'p' : ''}`;
      if (upEl && upKey !== lastUp) {
        upEl.innerHTML = up + `<div class="sb-paused" data-paused${g.phase === 'paused' ? '' : ' hidden'}><span aria-hidden="true">❚❚</span>`
          + '<span class="sb-paused-word">Paused</span></div>';
        upEl.setAttribute('aria-label', b ? `${an(colourName(b.c))} ${colourName(b.c).toLowerCase()} brick, ${b.len} long` : 'The tray');
        lastUp = upKey;
      }
      const places = g.places.map(placeHtml).join('');
      if (placesEl && places !== lastPlaces) { placesEl.innerHTML = places; placesEl.dataset.n = String(g.places.length); lastPlaces = places; }
      const line = !started ? (demo && !demoRested ? START_LINES.demo : START_LINES.still) : statusFor(g, { idle, news });
      if (sayEl && line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      if (!started) {
        if (scoreEl && lastScore !== '') { scoreEl.textContent = ''; scoreEl.hidden = true; lastScore = ''; }
        return;
      }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const txt = own ? `Sorted: ${g.sorted} · Trays: ${g.trays} · Level: ${LEVELS[g.level].label}` : '';
      if (scoreEl && txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      try { score?.set(g.sorted, { detail: `Level: ${LEVELS[g.level].label} · Best: ${Math.max(Number(stats.best) || 0, g.sorted)}` }); }
      catch (err) { console.error('sortbricks: score', err); }
    }

    return {
      __probe: () => ({ game: g, cfg: { ...cfg }, idle, armed, lit, stats: { ...stats }, tones: tones?.state() || null, menuAsks,
        started, demo, demoRested, demoMs, agent: agent?.id || null, restPending: restTimer != null, playing: plays.playing(),
        news, said: said.slice(), lightRunning: lightTimer != null, lightStepMs: lightStepMs(), names: namesNow(),
        timers: [lightTimer, waitTimer, idleTimer, restTimer, demoTimer].filter((h) => h != null).length }),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStartStyle(doc);
        ensureBrickFaceStyle(doc);
        ensureStyle(doc);
        mount.innerHTML = `<div class="sb-wrap gs-host nb-bricks" data-sb-root tabindex="0" aria-label="${esc(TITLE)}"><div class="sb" data-sb>`
          + '<div class="sb-stage"><div class="sb-up" data-up role="img" style="position:relative"></div>'
          + '<div class="sb-places" data-places></div></div>'
          + '<div class="sb-bar"><p class="sb-say" role="status" aria-live="polite"></p><p class="sb-score" data-score hidden></p></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-sb-root]');
        sbEl = mount.querySelector('[data-sb]');
        overlayEl = mount.querySelector('[data-start-host]');
        upEl = mount.querySelector('[data-up]');
        placesEl = mount.querySelector('[data-places]');
        sayEl = mount.querySelector('.sb-say');
        scoreEl = mount.querySelector('[data-score]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('sortbricks: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null, onShownChange: () => render() });
        tones = createGameTones({ audio, audioId: `${GAME}:${ctx.instanceId || 'sb'}`, volume: 0.5,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });
        // Row 2.107: the music, on the speaker arbiter (media tier, music group), as every game's.
        musicHost = createGameMusicHost(ctx, { audio, audioId: `${GAME}-music:${ctx.instanceId || 'sb'}`, cfg: () => cfg,
          defaultMode: MUSIC_DEFAULT,
          make: (o) => createGameMusic({ ...o, ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) }) });

        const applyCfg = (snap) => {
          const s = snap || {};
          const was = cfg;
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          next.level = levelOf(next.level);
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          try { musicHost?.apply(next, was); } catch { /* quiet */ }
        };
        applyCfg(state?.get?.());
        fresh();
        // Row 2.97: "Its sound comes out of" (the Sound tab) sends this game's sound to that speaker.
        unSpeaker = followPanelSpeaker(state, () => [tones, musicHost?.music]);
        state?.subscribe?.((s) => {
          const was = { ...cfg };
          applyCfg(s);
          const shape = ['level', 'trayBricks', 'mix'].some((k) => was[k] !== cfg[k]);
          if (!started && (demoWanted() !== demo || shape)) { toStartScreen(); return; }
          // A new level, tray size or mix starts with the next tray; a full game in progress keeps its tray.
          if (started && shape && g) {
            g.trayN = trayOf(cfg.trayBricks, DEFAULTS.trayBricks); g.mix = pick(cfg.mix, MIXES, 'one');
            if (was.level !== cfg.level) pendingLevel = cfg.level;
          }
          if (was.lightMoves !== cfg.lightMoves || was.scanMs !== cfg.scanMs) armLight();
          syncAudio(); render();
        });

        bus.subscribe(`${GAME}/select`, () => press());
        bus.subscribe(`${GAME}/next`, () => move(1));
        bus.subscribe(`${GAME}/prev`, () => move(-1));
        bus.subscribe(`${GAME}/pick`, (p) => pickPlace(typeof p === 'object' && p ? p.place : p));
        bus.subscribe(`${GAME}/back`, () => back());
        bus.subscribe(`${GAME}/pause`, (_p, _t, meta) => pauseGame({ menu: !(meta && meta.from === 'transport') }));
        bus.subscribe(`${GAME}/resume`, () => resumeGame());
        bus.subscribe(SHELL_STATE, (p) => { if (p && p.menuOpen === true && started && g && g.phase !== 'paused') pauseGame(); });
        bus.subscribe(`${GAME}/new`, () => {
          if (!started) { toStartScreen(); return; }
          stopTimers(); fresh(); markInput(); render(); sayBrick(); sayLit(); armLight();
        });
        bus.subscribe(`${GAME}/attract`, () => toStartScreen());

        if (shouldAutostart(state?.get?.() || {}, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) {
          started = true; render();
        } else toStartScreen();
      },
      onResize() { render(); },
      onHide() {
        hidden = true;
        if (started && g && ['play', 'moving', 'won'].includes(g.phase)) { setPaused(g, true); plays.pause(); }
        stopTimers(); syncAudio(); render();
        try { state?.flush?.(); } catch { /* nothing to do */ }
      },
      onShow() {
        hidden = false; syncAudio(); render();
        if (!started && demo && !demoRested && demoTimer == null) demoTimer = setT(demoTick, DEMO_STEP_MS);
      },
      // Row 2.107: the live "Music from", "Music folder" and "Which favorite" choices (game_music_host.js).
      settingsChoices: () => musicHost?.settingsChoices?.() || {},
      destroy() {
        try { unSpeaker?.(); } catch { /* gone */ } unSpeaker = null;
        dead = true;
        try { musicHost?.destroy(); } catch { /* gone */ } musicHost = null;
        clearRest(); stopTimers(); idleTimer = clear(idleTimer);
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('keydown', onKey);
        try { plays.destroy(); } catch { /* gone */ }
        try { tones?.destroy(); } catch { /* gone */ } tones = null;
        try { score?.destroy(); } catch { /* gone */ } score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ } ledger = null;
      },
    };
  },
);

export { LEVELS, freshTray };
