// modules/brickdrop.js — BRICK DROP: STACK NIMROD BRICKS INTO A WALL, PLAYABLE ON ONE SWITCH (brick games, 2026-10-09).
//
// Mike, 2026-10-09 (row 2.76): "Maybe a Tetris with our bricks." Chat's note BN: our own name, our brick shapes and
// theme colours, not Tetris's protected look. The rules, the pieces and the levels are `../brick_drop.js` (which
// says what is ours and why); the brick is drawn by `../brick_face.js`; this file is the panel.
//
// *** THE NAME: "BRICK DROP", ARGUED. *** FOR: it says what happens in two plain words a person can hear and say
// ("open Brick Drop"), it names our thing (the brick) rather than a genre, and nothing in it borrows a name.
// AGAINST: it is a generic phrase other games have used, and a plain description is weak as a brand. Alternatives
// weighed: "Wall builder" (says the goal, but sounds like a tool, not a game), "Stack it" (vaguer). A name is one
// line here and in the catalog; Mike can rename it without touching the game. [A guess, in the report.]
//
// *** ONE SWITCH, THREE WAYS (`control`; the default is `glide`, argued). ***
//   glide (DEFAULT) The brick glides across the top of the wall by itself, a column at a time, and turns a quarter
//          each time it reaches a side (`glideTurns`). A press drops it where it is. One decision per brick:
//          where (and which way round) it goes. Brick breaker's sweep, for the same reason: the only scheme where
//          a single switch makes a choice that matters.
//   scan   Four choices - Left, Turn, Right, Drop - light in turn (`scanMs`, 2 s by default); a press does the lit
//          one. No timing against a moving brick, at the price of more presses per brick. With two switches,
//          next / previous move the light and select does it.
//   keys   Nothing moves until told: left / right / turn / drop from keys, a switch's verbs, voice or the buttons.
//          The brick falls by itself in this one (`falls`: 'auto'), which is the classic game.
//   AGAINST glide as the default: it is timing, the hardest thing a switch asks. Missing costs nothing here (a
//   brick in the wrong place is just a brick; at the easy levels a full wall starts a fresh one, the score kept),
//   and `scan` exists for somebody who cannot time a press. A default is for somebody nobody has met yet.
// A pointer always works: a tap on the wall drops the brick in that column; a mouse over the wall moves it there.
// The four buttons under the wall (`buttons`, on) are the same four, for touch and for anybody.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. *** (brick breaker's rules, kept)
//   * It waits for Start (game_start.js) with the computer playing a silent demo meanwhile.
//   * A full wall: "The wall is full" and a fresh one goes up by itself (levels 1-3), or "Again!" and a new game
//     starts by itself (4-5). REST_MS, and a press skips it.
//   * A GAME NOBODY IS PLAYING COMES TO REST: IDLE_MS with no press and the glide, the scan and the falling stop;
//     the demo comes back after `attractAfterMs`. The next press picks it up.
//   * No sound before the first press; music only while somebody is playing.
//   * Flashing: the only repeated visible change is the scan light, held to the screen's flash limit
//     (flash_limit.js): its step is never shorter than the limit's period. Reduced motion: a dropped brick goes
//     straight into place, nothing fades, and there is no demo (game_start.js).
//
// THE SCORE is rows built this game, on the score contract (`../score_source.js`). EACH ROW BUILT PAYS
// `rowPoints` Play points (1 by default, argued at DEFAULTS). Being played: game_start.js createPlayWatch.

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { createGameMusic } from '../game_music.js';
import { SYSTEM_TOPICS } from '../actions.js';
import { SHELL_STATE } from '../shell_verbs.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
import {
  autostartFields, attractFields, shouldAutostart, panelAlone, createPlayWatch, demoLimitMs, demoReturnMs,
  ATTRACT_DEFAULTS, START_VOICE, START_LINES, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';
import { gameAgentFor, askAgent } from '../game_agent.js';
import { ensureBrickFaceStyle } from '../brick_face.js';
import {
  LEVELS, LEVEL_IDS, SHAPES, SCAN_ORDER, CONTROLS, REST_MS, levelOf, newGame, spawn, move, turn, drop, step,
  setPaused, settledBricks, pieceBricks, wallRows, stackComputer, fits,
} from '../brick_drop.js';

export const GAME = 'brickdrop';
export const TITLE = 'Brick Drop';
export const SCORE_LABEL = 'Brick Drop: rows built';

// A game nobody is pressing comes to rest after this long. 45 s, argued, not a setting: longer than the slowest
// brick takes to fall the whole wall at level 1 (9 rows x 2.4 s = 22 s) so somebody thinking is never stopped, short
// enough that an empty room does not watch bricks pile up for long. Time and not "N bricks", because in glide and
// scan nothing lands without a press. [On the report's list.]
export const IDLE_MS = 45000;
// The demo acts this often: fast enough to look like play, slow enough to SEE each move (a turn, a step).
export const DEMO_ACT_MS = 450;
// The game's own pause key (brick breaker's: Space is the screen's play / pause).
export const PAUSE_KEYS = Object.freeze({ p: 'p', off: null });
// The commands while this panel has focus. "Turn" is the up verb and "drop" the down verb (the arrow keys' own
// meaning), so a switch bound to Up / Down plays it too. "Stop" stops the glide (brick breaker's "stop").
export const VOICE = Object.freeze({
  left: 'left', right: 'right', turn: 'up', 'turn it': 'up', drop: 'down', 'drop it': 'down',
  stop: 'stop', 'stop there': 'stop', pause: 'pause', resume: 'play', ...START_VOICE,
});
const SCAN_LABELS = Object.freeze({ left: 'move it left', turn: 'turn it', right: 'move it right', drop: 'drop it' });

export const DEFAULTS = Object.freeze({
  pauseKey: 'off',
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
  pauseOpensMenu: true,
  level: 1,
  control: 'glide',
  falls: 'auto',          // 'auto': only in `keys` (the glide and the scan wait at the top for a press)
  glideTurns: true,
  scanMs: 2000,
  whenFull: 'level',      // 'level' (levels 1-3 fresh, 4-5 again) | 'fresh' | 'again'
  levelUp: 0,             // rows built before it goes up a level by itself; 0 = it stays where it is set
  colours: 'length',      // 'length': a brick's colour says how long it is | 'one': all one colour
  buttons: true,
  sounds: true,
  music: 'ambient',
  musicVolume: 0.3,
  // *** A ROW BUILT PAYS 1 PLAY POINT BY DEFAULT. *** Both sides (brick breaker's wall pays 0, and says why):
  //   FOR paying: unlike a ball that comes back for ever, a row here is built by presses - in glide and scan no brick
  //   lands without one, and a game nobody presses comes to rest within IDLE_MS. That is paying for achievement.
  //   AGAINST: in `keys` bricks fall by themselves, and a row can be finished by a brick nobody steered. Rare (it has
  //   to fill a row from the middle) and it stops at IDLE_MS. 0 turns it off.
  rowPoints: 1,
});

// "Goes up a level" is OFF by default, argued: FOR stepping up by itself - progress feels like a game. AGAINST, and
// it wins: in therapy the level is somebody's choice, and a wall that changes size under a person who was managing
// is a setback nobody asked for. Every 10 or 20 rows is one setting away.
const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Rows built this game. A Scoreboard on the same screen can show it instead.' }),
  { key: 'level', label: 'Level', kind: 'choice', default: 1, level: 'essential',
    options: LEVEL_IDS.map((n) => ({ value: n, label: `${LEVELS[n].label}: ${LEVELS[n].w} wide, ${LEVELS[n].shapes.length} kinds of piece` })),
    note: 'Starts with the next wall.' },
  { key: 'control', label: 'How the brick moves', kind: 'choice', default: 'glide', level: 'essential',
    options: [
      { value: 'glide', label: 'It glides by itself; a press drops it (one switch)' },
      { value: 'scan', label: 'Left, Turn, Right and Drop light in turn; a press does the lit one' },
      { value: 'keys', label: 'Keys, buttons or switches move it; it falls by itself' },
    ],
    note: 'A tap on the wall always drops the brick there.' },
  ...autostartFields({ on: false }),
  ...attractFields({ on: true, sound: true }),
  { key: 'falls', label: 'The brick falls by itself', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Only with keys and buttons' }, { value: 'yes', label: 'Yes, always' }, { value: 'no', label: 'No, it waits until dropped' }] },
  { key: 'glideTurns', label: 'A gliding brick turns at each side', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No' },
  { key: 'scanMs', label: 'How long each choice stays lit', kind: 'choice', default: 2000, level: 'standard',
    options: [{ value: 1000, label: '1 second' }, { value: 1500, label: '1.5 seconds' }, { value: 2000, label: '2 seconds' },
      { value: 3000, label: '3 seconds' }, { value: 5000, label: '5 seconds' }],
    note: 'Only when the choices light in turn. Never faster than the screen\'s flashing limit.' },
  { key: 'whenFull', label: 'When the wall fills up', kind: 'choice', default: 'level', level: 'standard',
    options: [{ value: 'level', label: 'As the level says (a fresh wall up to Medium)' },
      { value: 'fresh', label: 'A fresh wall goes up; the score carries on' },
      { value: 'again', label: 'The game ends and a new one starts by itself' }] },
  { key: 'levelUp', label: 'It goes up a level by itself', kind: 'choice', default: 0, level: 'standard',
    options: [{ value: 0, label: 'No, it stays where it is set' }, { value: 10, label: 'After 10 rows' }, { value: 20, label: 'After 20 rows' }] },
  { key: 'colours', label: 'Brick colours', kind: 'choice', default: 'length', level: 'advanced',
    options: [{ value: 'length', label: 'From the theme: each length of brick its own colour' }, { value: 'one', label: 'From the theme: all one colour' }] },
  { key: 'buttons', label: 'Left, Turn, Right and Drop buttons under the wall', default: true, level: 'standard',
    onLabel: 'Shown', offLabel: 'Hidden', note: 'Always shown when the choices light in turn.' },
  { key: 'pauseKey', label: 'A key of its own that pauses', kind: 'choice', default: 'off', level: 'advanced',
    options: [{ value: 'off', label: 'None: Space (the screen\'s pause / play) does it' }, { value: 'p', label: 'P' }],
    note: 'Once the game has been clicked or touched. Escape always pauses.' },
  { key: 'pauseOpensMenu', label: 'Escape and the Pause command also open the settings', default: true,
    level: 'standard', onLabel: 'Yes', offLabel: 'No, they only pause' },
  { key: 'sounds', label: 'Sounds', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'music', label: 'Music', kind: 'choice', default: 'ambient', level: 'standard',
    options: [{ value: 'ambient', label: 'Quiet background music' }, { value: 'off', label: 'No music' }] },
  { key: 'musicVolume', label: 'How loud the music is', kind: 'choice', default: 0.3, level: 'advanced',
    options: [{ value: 0.15, label: 'Very quiet' }, { value: 0.3, label: 'Quiet' }, { value: 0.5, label: 'Medium' }] },
  { key: 'rowPoints', label: 'Play points for each row built', kind: 'number', default: 1, min: 0, max: 20, step: 1,
    level: 'advanced', note: '0 means rows pay nothing.' },
];

// Sounds: argued constants (the setting is whether there are any).
const TONES = { land: [262, 70, 'sine'], rows: [659, 260, 'triangle'], turn: [392, 40, 'triangle'], full: [196, 260, 'sine'] };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v, of) => `${((v / of) * 100).toFixed(3)}%`;

/** The line under the wall. Exported so the suite reads it without a DOM. */
export function statusFor(g, { control = 'glide', idle = false, scan = 0, news = '' } = {}) {
  switch (g.phase) {
    case 'paused': return 'Paused. Press to go on.';
    case 'full': return 'The wall is full. A fresh wall is going up.';
    case 'again': return 'Again! A new game is starting.';
    case 'levelup': return 'Up a level! A new wall is going up.';
    case 'drop': return news || 'Down it goes.';
    case 'ready': return 'Press to play.';
    default:
      if (idle) return 'Press to play.';
      if (news) return news;
      if (control === 'scan') return `Press to ${SCAN_LABELS[SCAN_ORDER[scan] || 'drop']}.`;
      if (control === 'glide') return g.glide.moving ? 'Press to drop the brick.' : 'Press to drop it here.';
      return 'Move it, turn it, then drop it.';
  }
}

// THE PANEL'S OWN LOOK. In the module (game_start.js's shape) so the theme checks that read every client .js read
// it. Colours are theme roles only; the bricks are brick_face.js's.
const STYLE_ID = 'brickdrop-style';
const CSS = `
.bd-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;
  --bd-edge: var(--border, #c9c3ad);
  --bd-socket: color-mix(in srgb, var(--border, #c9c3ad) 80%, var(--text, #0A3323));
  --bd-floor: var(--text-soft, #3c5346);}
.bd-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px;box-shadow:inset 0 0 0 5px var(--surface, Canvas)}
.bd-wrap *{box-sizing:border-box}
.bd{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto auto;gap:.4rem;padding:.5rem;background:transparent;font-family:var(--font)}
.bd [hidden]{display:none !important}
.bd-stage{min-height:0;container-type:size;display:grid;place-items:center}
.bd-board{position:relative;aspect-ratio:var(--bd-w) / var(--bd-hh);width:min(100cqw, calc(100cqh * var(--bd-w) / var(--bd-hh)))}
.bd-well{position:absolute;left:0;right:0;top:0;border:2px solid var(--bd-edge);border-bottom:none;border-radius:6px 6px 0 0;
  overflow:hidden;touch-action:none;cursor:pointer;
  background-image:radial-gradient(circle closest-side at 50% 50%, var(--bd-socket) 0 16%, transparent 22%);
  background-size:calc(100% / var(--bd-w)) calc(100% / var(--bd-h))}
.bd-floor{position:absolute;left:0;right:0;bottom:0}
.bd-brick{position:absolute}
.bd[data-motion="reduce"] *{transition:none !important;animation:none !important}
.bd-paused{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:.4em;
  background:color-mix(in srgb, var(--surface) 55%, transparent);color:var(--text-strong);
  font-weight:800;font-size:clamp(18px, 8cqh, 64px);pointer-events:none}
.bd-paused-word{padding:.05em .4em;border-radius:.3em;background:var(--surface)}
.bd-controls{display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center}
.bd-btn{min-height:48px;min-width:5.5em;padding:.2em .8em;border-radius:12px;border:3px solid var(--bd-edge);
  background:var(--surface);color:var(--text-strong, var(--text));font:800 clamp(15px, 2.4vmin, 26px)/1.1 var(--font);cursor:pointer}
.bd-btn[data-lit="1"]{outline:4px solid var(--scan-ring, var(--focus, currentColor));outline-offset:3px}
.bd-bar{display:flex;flex-wrap:wrap;gap:.2rem 1.2rem;align-items:baseline;justify-content:center;min-height:2.2em}
.bd-say{margin:0;font-size:clamp(15px, 2.4vmin, 28px);font-weight:600;color:var(--text-strong)}
.bd-score{margin:0;font-size:clamp(14px, 2.1vmin, 24px);color:var(--text)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

registerModule(
  { type: GAME, title: TITLE, core: 'new',
    description: 'Stack Nimrod bricks into a wall: a full row is a row built. One switch can play: the brick '
      + 'glides by itself and a press drops it. The easy levels are slow, use small bricks and never end the game.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const audio = ctx.audio || null;
    const rand = ctx.rand || Math.random;
    const clock = ctx.clock || (() => {
      const raf = typeof requestAnimationFrame === 'function';
      return {
        now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
        request: (cb) => (raf ? requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16)),
        cancel: (h) => { if (raf) cancelAnimationFrame(h); else clearTimeout(h); },
      };
    })();
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);

    let cfg = { ...DEFAULTS };
    let g = null;
    let idle = true;
    let quietMs = 0;              // ms with no press, while in play
    let armed = false;
    let news = '';                // "A row built!" - until the next press
    let stats = { best: 0, rows: 0 };
    let loopHandle = null, last = null, dead = false, hidden = false;
    let rootEl = null, wellEl = null, floorEl = null, boardEl = null, sayEl = null, scoreEl = null, ctrlEl = null, overlayEl = null;
    let drawnV = -1, drawnKey = '', lastSay = '', lastScore = '', lastOverlay = null;
    let menuAsks = 0;
    let score = null, ledger = null, tones = null, music = null;
    let started = true, demo = false, demoMs = 0, demoRested = false, demoMemory = {}, demoActMs = 0, agent = null;
    let restTimer = null;
    const plays = createPlayWatch(bus, ctx);

    const control = () => (CONTROLS.includes(cfg.control) ? cfg.control : 'glide');
    const falls = () => (cfg.falls === 'yes' ? true : cfg.falls === 'no' ? false : control() === 'keys');
    // The scan's step: the setting, never shorter than the screen's flash limit allows (flash_limit.js).
    const scanStepMs = () => Math.max(Number(cfg.scanMs) || DEFAULTS.scanMs, minFlashPeriodMs(flashLimit(ctx)));
    const opts = () => ({
      control: started ? control() : 'keys', falls: started ? falls() : false, glideTurns: cfg.glideTurns !== false,
      scanMs: scanStepMs(), idle: started ? idle : false, rand, levelUp: started ? Number(cfg.levelUp) || 0 : 0,
      whenFull: !started ? 'fresh' : (cfg.whenFull === 'fresh' || cfg.whenFull === 'again' ? cfg.whenFull : null), restMs: REST_MS,
    });

    // ---- sound -----------------------------------------------------------------------------------
    function sound(ev) {
      if (!cfg.sounds || !armed || !tones) return;
      if (!started && cfg.attractSound !== true) return;
      const t = TONES[ev === 'again' ? 'full' : ev];
      if (t) tones.tone(t[0], t[1], { type: t[2], level: 0.7 });
    }
    function syncAudio() {
      if (!started) {
        tones?.setActive(!dead && !hidden && armed && demo && !demoRested && cfg.attractSound === true && !!cfg.sounds);
        try { music?.pause(); } catch { /* quiet */ }
        return;
      }
      const playing = !dead && !hidden && armed && g && g.phase !== 'paused' && !idle;
      tones?.setActive(playing && !!cfg.sounds);
      try { if (playing && cfg.music !== 'off') music?.play(); else music?.pause(); } catch { /* quiet */ }
    }
    function save() { try { state?.set?.({ stats }); } catch (err) { console.error('brickdrop: save', err); } }

    // ---- the loop: only while something moves ----------------------------------------------------
    function needsFrames() {
      if (dead || hidden || !g) return false;
      if (!started) return demo && !demoRested;
      if (g.phase === 'paused' || g.phase === 'ready') return false;
      if (g.phase !== 'play') return true;                // drop, full, again, levelup
      if (idle) return false;
      return (control() === 'glide' && g.glide.moving) || control() === 'scan' || falls();
    }
    function ensureLoop() { if (loopHandle != null || !needsFrames()) return; last = null; loopHandle = clock.request(frame); }
    function stopLoop() { if (loopHandle != null) { try { clock.cancel(loopHandle); } catch { /* gone */ } } loopHandle = null; last = null; }
    function frame() {
      loopHandle = null;
      if (dead) return;
      const t = clock.now();
      const dt = last == null ? 0 : t - last;
      last = t;
      advance(dt);
      if (needsFrames()) loopHandle = clock.request(frame); else last = null;
    }

    // ---- the demo ------------------------------------------------------------------------------------
    function demoObservation() {
      return { game: GAME, kind: 'stack', t: demoMs, actions: ['left', 'right', 'turn', 'drop'],
        state: { phase: g.phase, wall: wallRows(g), w: g.w, h: g.h,
          piece: g.piece ? { shape: g.piece.shape, rot: g.piece.rot, x: g.piece.x, y: g.piece.y, id: g.piece.id } : null } };
    }
    function applyDemo(a) {
      if (!a || started || dead || !g || g.phase !== 'play') return;
      if (a.act === 'left') move(g, -1);
      else if (a.act === 'right') move(g, 1);
      else if (a.act === 'turn') turn(g);
      else if (a.act === 'drop') drop(g, { instant: reducedMotion(), ...opts() });
    }
    function advanceDemo(dt) {
      if (!demo || demoRested) return [];
      demoMs += dt;
      if (demoMs >= demoLimitMs(cfg.attractForMs)) { demoRested = true; syncAudio(); render(); return []; }
      demoActMs += dt;
      if (demoActMs >= DEMO_ACT_MS && g.phase === 'play') {
        demoActMs = 0;
        applyDemo(askAgent(agent, demoObservation(), { rand, memory: demoMemory }, { onLate: (x) => applyDemo(x) }));
      }
      const events = step(g, dt, opts());
      for (const ev of events) sound(ev);
      render();
      return events;
    }

    function advance(dt) {
      if (!started) return advanceDemo(dt);
      if (g.phase === 'play' && !idle) {
        quietMs += dt;
        if (quietMs >= IDLE_MS) { idle = true; plays.rest(); syncAudio(); scheduleDemo(); }
      }
      return handle(step(g, dt, opts()));
    }

    // What a step or a press did: sounds, the score, points, the saved totals.
    function handle(events) {
      for (const ev of events) {
        sound(ev);
        if (ev === 'rows') {
          const n = g.lastBuilt || 1;
          news = n > 1 ? `${n} rows built!` : 'A row built!';
          stats = { ...stats, rows: (Number(stats.rows) || 0) + n, best: Math.max(Number(stats.best) || 0, g.rows) };
          pay(n);
        }
      }
      if (events.includes('rows') || events.includes('again')) save();
      if (events.length) syncAudio();
      render();
      return events;
    }

    function pay(n) {
      const per = Math.round(Number(cfg.rowPoints) || 0);
      if (!(per > 0) || !ledger || !(n > 0)) return;
      Promise.resolve(ledger.award({ amount: per * n, source: GAME, type: 'Play', tags: [GAME],
        note: `${TITLE}: ${n > 1 ? `${n} rows` : 'a row'} built` })).catch((err) => console.error('brickdrop: points', err));
    }

    // ---- presses ---------------------------------------------------------------------------------------
    function markInput() {
      idle = false; quietMs = 0; news = '';
      clearRest();
      if (!armed) { armed = true; tones?.resume(); }
      plays.active();
    }
    function clearRest() { if (restTimer != null) { try { clearT(restTimer); } catch { /* gone */ } restTimer = null; } }
    function scheduleDemo() {
      const ms = demoReturnMs(cfg.attractAfterMs);
      if (!(ms > 0) || restTimer != null || dead) return;
      restTimer = setT(() => { restTimer = null; if (!dead && started && idle && g?.phase !== 'paused') toStartScreen(); }, ms);
    }
    const demoWanted = () => cfg.attract !== false && !reducedMotion();
    function toStartScreen() {
      if (dead) return;
      clearRest(); stopLoop();
      started = false;
      g = newGame({ level: levelOf(cfg.level), colours: cfg.colours });
      spawn(g, rand);
      idle = true; quietMs = 0; news = '';
      demo = demoWanted();
      demoMs = 0; demoRested = false; demoMemory = {}; demoActMs = 0;
      agent = demo ? (gameAgentFor(GAME, 'stack') || stackComputer) : null;
      plays.pause();            // a game waiting for Start says it is not playing (game_start.js)
      syncAudio(); render(); ensureLoop();
    }
    function fresh() {
      g = newGame({ level: levelOf(cfg.level), colours: cfg.colours });
      spawn(g, rand);
      idle = true; quietMs = 0; news = '';
    }
    function startGame() {
      if (dead || started) return false;
      stopLoop();
      started = true; demo = false; agent = null; demoMemory = {};
      fresh();
      markInput();
      syncAudio(); render(); ensureLoop();
      return true;
    }
    // A press that finds a rest ("The wall is full", "Again!", "Up a level") skips it.
    function skipRest() {
      if (g.phase !== 'full' && g.phase !== 'again' && g.phase !== 'levelup') return false;
      handle(step(g, REST_MS, opts()));
      return true;
    }
    // Every press goes through here: Start first, then the rest-skip, then the act.
    function press(act) {
      if (dead || !g) return;
      if (startGame()) return;
      markInput();
      if (g.phase === 'paused') { if (act === 'select' || act === 'drop') setPaused(g, false); syncAudio(); render(); ensureLoop(); return; }
      if (skipRest()) { syncAudio(); render(); ensureLoop(); return; }
      if (g.phase !== 'play') { render(); return; }
      let events = [];
      if (act === 'select') act = control() === 'scan' ? SCAN_ORDER[g.scan] : 'drop';
      if (act === 'left') move(g, -1);
      else if (act === 'right') move(g, 1);
      else if (act === 'turn') { if (turn(g)) events = ['turn']; }
      else if (act === 'drop') events = drop(g, { instant: reducedMotion(), ...opts() });
      else if (act === 'stop') g.glide.moving = false;
      // A press on the scan starts the light again from the first choice's full time, so the next one is not cut short.
      if (control() === 'scan') g.scanMs = 0;
      handle(events);
      ensureLoop();
    }
    function scanStep(dir) {
      if (dead || !g) return;
      if (startGame()) return;
      if (control() !== 'scan') { press(dir > 0 ? 'right' : 'left'); return; }
      markInput();
      if (g.phase !== 'play') { skipRest(); render(); ensureLoop(); return; }
      g.scan = (g.scan + dir + SCAN_ORDER.length) % SCAN_ORDER.length; g.scanMs = 0; g.v++;
      render(); ensureLoop();
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
      catch (err) { console.error('brickdrop: settings menu', err); }
      return claimed;
    }
    function pauseGame({ menu = false } = {}) {
      if (dead || !g || !started) return;
      if (setPaused(g, true)) stopLoop();
      plays.pause();
      syncAudio(); render();
      if (menu && cfg.pauseOpensMenu !== false) openMenu();
    }
    function resumeGame() {
      if (dead || !g) return;
      if (startGame()) return;
      markInput();
      setPaused(g, false);
      syncAudio(); render(); ensureLoop();
    }

    // ---- pointer and keys ----------------------------------------------------------------------------------
    function columnAt(e) {
      if (!wellEl || !g) return null;
      const r = wellEl.getBoundingClientRect();
      if (!(r.width > 0)) return null;
      return Math.max(0, Math.min(g.w - 1, Math.floor(((e.clientX - r.left) / r.width) * g.w)));
    }
    // Put the piece's middle over column `col`, as far as it will go.
    function steerTo(col) {
      const p = g?.piece;
      if (!p || g.phase !== 'play') return;
      const pw = Math.max(...p.cells.map((c) => c.x)) + 1;
      const want = Math.max(0, Math.min(g.w - pw, col - Math.floor((pw - 1) / 2)));
      let guard = 20;
      while (p.x !== want && guard-- > 0 && move(g, want > p.x ? 1 : -1)) { /* one column at a time: never through a brick */ }
    }
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
      const btn = e.target.closest?.('[data-act]');
      if (btn && mount.contains(btn)) { e.preventDefault(); press(btn.dataset.act); return; }
      if (!wellEl?.contains(e.target)) { if (!started) startGame(); return; }
      if (startGame()) return;
      const col = columnAt(e);
      if (g.phase === 'play' && col != null) { markInput(); g.glide.moving = false; steerTo(col); }
      press('drop');
    }
    function onPointerMove(e) {
      if (dead || !started || !g || g.phase !== 'play' || e.pointerType !== 'mouse' || !wellEl?.contains(e.target)) return;
      const col = columnAt(e);
      if (col == null) return;
      quietMs = 0;
      g.glide.moving = false;
      steerTo(col);
      render();
    }
    const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'turn', ArrowDown: 'drop', Enter: 'drop' };
    function onKey(e) {
      if (dead || !g || e.repeat) return;
      if (e.key === 'Escape') {
        if (!started) return;
        e.preventDefault(); e.stopPropagation();
        pauseGame({ menu: true });
        return;
      }
      if (KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); press(KEYS[e.key]); return; }
      const want = Object.prototype.hasOwnProperty.call(PAUSE_KEYS, cfg.pauseKey) ? PAUSE_KEYS[cfg.pauseKey] : null;
      if (started && want && String(e.key).toLowerCase() === want) {
        e.preventDefault(); e.stopPropagation();
        if (g.phase === 'paused') resumeGame(); else pauseGame();
      }
    }

    // ---- drawing -------------------------------------------------------------------------------------------
    function brickHtml(b, cls) {
      const w = b.dir === 'v' ? 1 : b.len, h = b.dir === 'v' ? b.len : 1;
      return `<div class="bd-brick nb-face${cls}" data-c="${b.c}" data-dir="${b.dir}" data-len="${b.len}"`
        + ` style="left:${pct(b.x, g.w)};top:${pct(b.y, g.h)};width:${pct(w, g.w)};height:${pct(h, g.h)};--nb-cells:${b.len}"></div>`;
    }
    function render() {
      if (dead || !rootEl || !g) return;
      const bd = rootEl.querySelector('[data-bd]');
      if (bd) {
        bd.dataset.phase = g.phase;
        bd.dataset.control = control();
        bd.dataset.motion = reducedMotion() ? 'reduce' : 'full';
        bd.dataset.started = started ? '1' : '0';
        bd.dataset.demo = !started && demo && !demoRested ? '1' : '0';
        bd.dataset.level = String(g.level);
      }
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ demo: demo && !demoRested, note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      const key = `${g.w}x${g.h}`;
      if (boardEl && key !== drawnKey) {
        boardEl.style.setProperty('--bd-w', String(g.w));
        boardEl.style.setProperty('--bd-h', String(g.h));
        boardEl.style.setProperty('--bd-hh', String(g.h + 1));
        wellEl.style.height = pct(g.h, g.h + 1);
        floorEl.style.height = pct(1, g.h + 1);
        // THE WALL STANDS ON A LONG BRICK: the floor is one brick as wide as the wall, in the theme's own colour.
        floorEl.innerHTML = `<div class="bd-brick nb-face" data-c="4" data-floor style="left:0;top:0;width:100%;height:100%;--nb-cells:${g.w}"></div>`;
        drawnKey = key;
      }
      if (wellEl && g.v !== drawnV) {
        wellEl.innerHTML = settledBricks(g).map((b) => brickHtml(b, '')).join('')
          + pieceBricks(g).map((b) => brickHtml(b, ' bd-piece')).join('')
          + `<div class="bd-paused" data-paused${g.phase === 'paused' ? '' : ' hidden'}><span aria-hidden="true">❚❚</span>`
          + '<span class="bd-paused-word">Paused</span></div>';
        drawnV = g.v;
      }
      if (ctrlEl) {
        const scanOn = started && control() === 'scan';
        // Not while it waits for Start: the Start button is the one thing a press presses then, and it sits there.
        ctrlEl.hidden = !started || !(cfg.buttons !== false || scanOn);
        for (const b of ctrlEl.querySelectorAll('[data-act]')) {
          const lit = scanOn && g.phase === 'play' && !idle && SCAN_ORDER[g.scan] === b.dataset.act ? '1' : '0';
          if (b.dataset.lit !== lit) b.dataset.lit = lit;
        }
      }
      const line = !started ? (demo && !demoRested ? START_LINES.demo : START_LINES.still)
        : statusFor(g, { control: control(), idle, scan: g.scan, news });
      if (sayEl && line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      if (!started) {
        if (scoreEl && lastScore !== '') { scoreEl.textContent = ''; scoreEl.hidden = true; lastScore = ''; }
        return;
      }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const txt = own ? `Rows built: ${g.rows} · Level: ${LEVELS[g.level].label}` : '';
      if (scoreEl && txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      try { score?.set(g.rows, { detail: `Level: ${LEVELS[g.level].label} · Best: ${Math.max(Number(stats.best) || 0, g.rows)}` }); }
      catch (err) { console.error('brickdrop: score', err); }
    }

    return {
      __probe: () => ({ game: g, cfg: { ...cfg }, idle, armed, quietMs, looping: loopHandle != null, stats: { ...stats },
        tones: tones?.state() || null, music: music?.state() || null, menuAsks, started, demo, demoRested, demoMs,
        agent: agent?.id || null, restPending: restTimer != null, playing: plays.playing(), news, scanStepMs: scanStepMs(),
        falls: falls() }),
      __step: (dt) => (dead ? [] : advance(dt)),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStartStyle(doc);
        ensureBrickFaceStyle(doc);
        ensureStyle(doc);
        mount.innerHTML = '<div class="bd-wrap gs-host nb-bricks" data-bd-root tabindex="0" aria-label="Brick Drop"><div class="bd" data-bd>'
          + '<div class="bd-stage"><div class="bd-board" data-board>'
          + '<div class="bd-well" data-well role="img" aria-label="A wall of bricks being built"></div>'
          + '<div class="bd-floor" data-floor-host aria-hidden="true"></div></div></div>'
          + '<div class="bd-controls" data-controls>'
          + '<button type="button" class="bd-btn" data-act="left">◀ Left</button>'
          + '<button type="button" class="bd-btn" data-act="turn">↻ Turn</button>'
          + '<button type="button" class="bd-btn" data-act="right">Right ▶</button>'
          + '<button type="button" class="bd-btn" data-act="drop">▼ Drop</button></div>'
          + '<div class="bd-bar"><p class="bd-say" role="status" aria-live="polite"></p><p class="bd-score" data-score hidden></p></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-bd-root]');
        overlayEl = mount.querySelector('[data-start-host]');
        boardEl = mount.querySelector('[data-board]');
        wellEl = mount.querySelector('[data-well]');
        floorEl = mount.querySelector('[data-floor-host]');
        ctrlEl = mount.querySelector('[data-controls]');
        sayEl = mount.querySelector('.bd-say');
        scoreEl = mount.querySelector('[data-score]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('pointermove', onPointerMove);
        mount.addEventListener('keydown', onKey);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('brickdrop: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null, onShownChange: () => render() });
        const id = ctx.instanceId || 'bd';
        tones = createGameTones({ audio, audioId: `${GAME}:${id}`, volume: 0.5,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });
        music = createGameMusic({ audio, audioId: `${GAME}-music:${id}`, volume: cfg.musicVolume,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });

        const applyCfg = (snap) => {
          const s = snap || {};
          const was = cfg;
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          if (!CONTROLS.includes(next.control)) next.control = DEFAULTS.control;
          next.level = levelOf(next.level);
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          if (g && next.colours !== was.colours) g.colours = next.colours;
          try { music?.setVolume(next.musicVolume); if (next.music === 'off') music?.off(); else if (was.music === 'off' || !g) music?.useAmbient(); } catch { /* quiet */ }
        };
        applyCfg(state?.get?.());
        fresh();
        state?.subscribe?.((s) => {
          const wasLevel = cfg.level;
          applyCfg(s);
          if (!started && (demoWanted() !== demo || cfg.level !== wasLevel)) { toStartScreen(); return; }
          syncAudio(); render(); ensureLoop();
        });

        bus.subscribe(`${GAME}/next`, () => scanStep(1));
        bus.subscribe(`${GAME}/prev`, () => scanStep(-1));
        bus.subscribe(`${GAME}/select`, () => press('select'));
        bus.subscribe(`${GAME}/back`, () => back());
        bus.subscribe(`${GAME}/left`, () => press('left'));
        bus.subscribe(`${GAME}/right`, () => press('right'));
        bus.subscribe(`${GAME}/turn`, () => press('turn'));
        bus.subscribe(`${GAME}/drop`, () => press('drop'));
        bus.subscribe(`${GAME}/stop`, () => press('stop'));
        bus.subscribe(`${GAME}/pause`, (_p, _t, meta) => pauseGame({ menu: !(meta && meta.from === 'transport') }));
        bus.subscribe(`${GAME}/resume`, () => resumeGame());
        bus.subscribe(SHELL_STATE, (p) => { if (p && p.menuOpen === true && started && g && g.phase !== 'paused') pauseGame(); });
        bus.subscribe(`${GAME}/new`, () => { if (!started) { toStartScreen(); return; } fresh(); stopLoop(); syncAudio(); render(); });
        bus.subscribe(`${GAME}/attract`, () => toStartScreen());

        if (shouldAutostart(state?.get?.() || {}, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) {
          started = true; render();
        } else toStartScreen();
      },
      onResize() { render(); },
      onHide() {
        hidden = true;
        if (started && g && (g.phase === 'play' || g.phase === 'drop')) { setPaused(g, true); plays.pause(); }
        stopLoop(); syncAudio(); render();
        try { state?.flush?.(); } catch { /* nothing to do */ }
      },
      onShow() { hidden = false; syncAudio(); render(); ensureLoop(); },
      destroy() {
        dead = true;
        clearRest(); stopLoop();
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('pointermove', onPointerMove);
        mount.removeEventListener('keydown', onKey);
        try { plays.destroy(); } catch { /* gone */ }
        try { tones?.destroy(); } catch { /* gone */ } tones = null;
        try { music?.destroy(); } catch { /* gone */ } music = null;
        try { score?.destroy(); } catch { /* gone */ } score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ } ledger = null;
      },
    };
  },
);

export { LEVELS, SHAPES, fits };
