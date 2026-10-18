// modules/stackline.js — STACK TO THE LINE: ONE PRESS DROPS A SLIDING BRICK; BUILD A TOWER UP TO THE LINE (brick games,
// row 2.76, 2026-10-10).
//
// Mike, 2026-10-09: "Any other ideas for games with our bricks?" Chat's list: "stack to the line (one press drops a
// brick; a one-switch timing game)". The rules are `../stack_line.js` (which says what is ours and why); the brick is
// drawn by `../brick_face.js`; this file is the panel.
//
// *** THE NAME: "STACK TO THE LINE", ARGUED. *** FOR: it is the whole game in four plain words, it is what chat called
// it, and it borrows no other game's name. AGAINST: it is long for a tile; "Tower" was weighed (short, but says nothing
// about the line), and "Stack" alone is another game's name. A name is one line here and in the catalog. [Mike's list.]
//
// *** ONE PRESS, ANY INPUT. *** A brick slides along above the tower by itself; the one press drops it. Every input is
// that press: a switch's select (or next, previous, down, launch: actions.js MODULE_VERBS), Enter or the Down arrow
// with the panel focused, a click or a touch anywhere on the panel, and the Drop button. Nothing else is needed to play
// a whole game. What hangs over the edge of the brick below is cut off and falls away.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. *** (brick breaker's and Brick Drop's rules, kept)
//   * It waits for Start (game_start.js), with the computer playing a silent demo meanwhile.
//   * Reaching the line: "You reached the line!" for REST_MS, then a fresh tower goes up by itself. A press skips it.
//   * A miss (a brick that lands on nothing) costs nothing by default: the same brick comes again.
//   * A GAME NOBODY IS PLAYING COMES TO REST: IDLE_MS with no press and the brick stops sliding; the demo comes back
//     after `attractAfterMs`. The next press picks it up.
//   * No sound before the first press; music only while somebody is playing.
//   * Reduced motion: a cut piece just goes (no fall), and there is no demo. The sliding brick still slides - it is the
//     game - and "One cell at a time" (`slide: 'steps'`) is one setting away.
//
// THE SCORE is towers built to the line this game, on the score contract (`../score_source.js`). EACH LINE REACHED PAYS
// `linePoints` Play points (1 by default: a tower is built by presses, and a game nobody presses comes to rest).

import { followPanelSpeaker } from '../speakers.js';
import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { createGameMusic } from '../game_music.js';
import { SYSTEM_TOPICS } from '../actions.js';
import { SHELL_STATE } from '../shell_verbs.js';
import {
  autostartFields, attractFields, shouldAutostart, panelAlone, createPlayWatch, demoLimitMs, demoReturnMs,
  ATTRACT_DEFAULTS, START_VOICE, START_LINES, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';
import { gameAgentFor, askAgent } from '../game_agent.js';
import { ensureBrickFaceStyle } from '../brick_face.js';
import {
  LEVELS, LEVEL_IDS, REST_MS, CUT_FALL_MS, SLIDES, CUTS, MISS_MODES, AFTER_LINE, COLOUR_MODES, levelOf, sizesFor,
  newGame, deal, drop, step, setPaused, height, topLayer, freshTower, lineComputer,
} from '../stack_line.js';

export const GAME = 'stackline';
export const TITLE = 'Stack to the line';
export const SCORE_LABEL = 'Stack to the line: towers built';

// A game nobody is pressing comes to rest after this long. 45 s, Brick Drop's number and its reason: longer than a
// person thinking takes, short enough that an empty room does not watch a brick slide for long. Not a setting.
export const IDLE_MS = 45000;
// The game's own pause key (Space is the screen's play / pause).
export const PAUSE_KEYS = Object.freeze({ p: 'p', off: null });
export const VOICE = Object.freeze({
  drop: 'down', 'drop it': 'down', now: 'down', pause: 'pause', resume: 'play', ...START_VOICE,
});

export const DEFAULTS = Object.freeze({
  pauseKey: 'off',
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
  pauseOpensMenu: true,
  level: 1,
  // 0 = "as the level says" (the level table in stack_line.js); a number is that many.
  speed: 0,
  width: 0,
  track: 0,
  line: 0,
  slide: 'smooth',
  cut: 'cell',
  onMiss: 'again',
  perfectGrows: true,
  afterLine: 'same',
  colours: 'rows',
  button: true,
  sounds: true,
  music: 'ambient',
  musicVolume: 0.3,
  linePoints: 1,
});

const asLevel = (label) => ({ value: 0, label });
// "Goes up a level" is OFF by default (`afterLine: 'same'`), argued as in Brick Drop: in therapy the level is
// somebody's choice, and a game that gets harder under a person who was managing is a setback nobody asked for.
const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Towers built this game. A Scoreboard on the same screen can show it instead.' }),
  { key: 'level', label: 'Level', kind: 'choice', default: 1, level: 'essential',
    options: LEVEL_IDS.map((n) => ({ value: n, label: `${LEVELS[n].label}: a ${LEVELS[n].width}-wide brick, the line ${LEVELS[n].line} high` })),
    note: 'Starts with the next tower.' },
  ...autostartFields({ on: false }),
  ...attractFields({ on: true, sound: true }),
  { key: 'speed', label: 'How fast the brick slides', kind: 'choice', default: 0, level: 'standard',
    options: [asLevel('As the level says'), { value: 0.5, label: 'Very slow' }, { value: 1, label: 'Slow' },
      { value: 2, label: 'Medium' }, { value: 3, label: 'Fast' }, { value: 4, label: 'Very fast' }],
    note: 'Starts with the next tower.' },
  { key: 'width', label: 'How wide the first brick is', kind: 'choice', default: 0, level: 'standard',
    options: [asLevel('As the level says'), { value: 2, label: '2 cells' }, { value: 3, label: '3 cells' },
      { value: 4, label: '4 cells' }, { value: 5, label: '5 cells' }, { value: 6, label: '6 cells' }],
    note: 'Wider is easier. Starts with the next tower.' },
  { key: 'line', label: 'How high the line is', kind: 'choice', default: 0, level: 'standard',
    options: [asLevel('As the level says'), { value: 3, label: '3 bricks' }, { value: 5, label: '5 bricks' },
      { value: 8, label: '8 bricks' }, { value: 12, label: '12 bricks' }, { value: 16, label: '16 bricks' }],
    note: 'Starts with the next tower.' },
  { key: 'track', label: 'How far the brick slides', kind: 'choice', default: 0, level: 'advanced',
    options: [asLevel('As the level says'), { value: 6, label: '6 cells' }, { value: 8, label: '8 cells' },
      { value: 10, label: '10 cells' }, { value: 12, label: '12 cells' }],
    note: 'Never less than the brick is wide. Starts with the next tower.' },
  { key: 'slide', label: 'How the brick moves', kind: 'choice', default: 'smooth', level: 'standard',
    options: [{ value: 'smooth', label: 'Smoothly' }, { value: 'steps', label: 'One cell at a time: where it is, is where it lands' }] },
  { key: 'cut', label: 'Where a dropped brick lands', kind: 'choice', default: 'cell', level: 'standard',
    options: [{ value: 'cell', label: 'On the nearest whole cell. Within half a cell is just right' },
      { value: 'exact', label: 'Exactly where it is. Harder' }] },
  { key: 'onMiss', label: 'When a brick misses the tower', kind: 'choice', default: 'again', level: 'standard',
    options: [{ value: 'again', label: 'The same brick comes again. Nothing is lost' },
      { value: 'restart', label: 'The tower starts again from the bottom' }] },
  { key: 'perfectGrows', label: 'A brick dropped just right grows back a cell', default: true, level: 'advanced',
    onLabel: 'Yes', offLabel: 'No', note: 'Never wider than the first brick.' },
  { key: 'afterLine', label: 'After the line is reached', kind: 'choice', default: 'same', level: 'standard',
    options: [{ value: 'same', label: 'A new tower at the same level' }, { value: 'up', label: 'A new tower one level up' }] },
  { key: 'colours', label: 'Brick colors', kind: 'choice', default: 'rows', level: 'advanced',
    options: [{ value: 'rows', label: 'From the theme: each row the next color' }, { value: 'one', label: 'From the theme: all one color' }] },
  { key: 'button', label: 'A Drop button under the tower', default: true, level: 'standard', onLabel: 'Shown', offLabel: 'Hidden',
    note: 'A tap anywhere on the game drops the brick too.' },
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
  { key: 'linePoints', label: 'Play points for each tower built to the line', kind: 'number', default: 1, min: 0, max: 20, step: 1,
    level: 'advanced', note: '0 means towers pay nothing.' },
];

// Sounds: argued constants (the setting is whether there are any). A cut is a low knock, just right is higher, a miss
// is lowest, the line is a bright tone.
const TONES = { cut: [262, 80, 'sine'], perfect: [523, 120, 'triangle'], miss: [196, 200, 'sine'], line: [659, 300, 'triangle'] };

const pct = (v, of) => `${((v / of) * 100).toFixed(3)}%`;

/** The line under the tower. Exported so the suite reads it without a DOM. */
export function statusFor(g, { idle = false, news = '' } = {}) {
  switch (g.phase) {
    case 'paused': return 'Paused. Press to go on.';
    case 'won': return 'You reached the line! A new tower is going up.';
    case 'ready': return 'Press to play.';
    default:
      if (idle) return 'Press to play.';
      if (news) return news;
      return 'Press to drop the brick.';
  }
}
const NEWS = Object.freeze({ perfect: 'Just right!', grow: 'Just right! It grew back a cell.', cut: 'A bit was cut off.',
  miss: 'Missed. Here it comes again.', restart: 'Missed. The tower starts again.' });

// THE PANEL'S OWN LOOK. In the module so the theme checks that read every client .js read it. Theme roles only; the
// bricks are brick_face.js's.
const STYLE_ID = 'stackline-style';
const CSS = `
.sl-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;
  --sl-edge: var(--border, #c9c3ad);
  --sl-socket: color-mix(in srgb, var(--border, #c9c3ad) 80%, var(--text, #0A3323));
  --sl-line: var(--text-strong, var(--text, #0A3323));}
.sl-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px;box-shadow:inset 0 0 0 5px var(--surface, Canvas)}
.sl-wrap *{box-sizing:border-box}
.sl{height:100%;display:grid;grid-template-rows:minmax(0,1fr) auto auto;gap:.4rem;padding:.5rem;background:transparent;font-family:var(--font)}
.sl [hidden]{display:none !important}
.sl-stage{min-height:0;container-type:size;display:grid;place-items:center}
.sl-board{position:relative;aspect-ratio:var(--sl-w) / var(--sl-h);width:min(100cqw, calc(100cqh * var(--sl-w) / var(--sl-h)))}
.sl-well{position:absolute;inset:0;border:2px solid var(--sl-edge);border-radius:6px;overflow:hidden;touch-action:none;cursor:pointer;
  background-image:radial-gradient(circle closest-side at 50% 50%, var(--sl-socket) 0 10%, transparent 14%);
  background-size:calc(100% / var(--sl-w)) calc(100% / var(--sl-h))}
.sl-brick{position:absolute}
.sl-fall{pointer-events:none}
.sl-line{position:absolute;left:0;right:0;height:0;border-top:4px dashed var(--sl-line);pointer-events:none}
.sl-line-word{position:absolute;right:.3em;bottom:.25em;padding:0 .35em;border-radius:.3em;background:var(--surface);
  color:var(--text-strong, var(--text));font:800 clamp(12px, 4cqh, 26px)/1.2 var(--font)}
.sl[data-motion="reduce"] *{transition:none !important;animation:none !important}
.sl-paused{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:.4em;
  background:color-mix(in srgb, var(--surface) 55%, transparent);color:var(--text-strong);
  font-weight:800;font-size:clamp(18px, 8cqh, 64px);pointer-events:none}
.sl-paused-word{padding:.05em .4em;border-radius:.3em;background:var(--surface)}
.sl-controls{display:flex;justify-content:center}
.sl-btn{min-height:48px;min-width:7em;padding:.2em 1em;border-radius:12px;border:3px solid var(--sl-edge);
  background:var(--surface);color:var(--text-strong, var(--text));font:800 clamp(15px, 2.6vmin, 28px)/1.1 var(--font);cursor:pointer}
.sl-bar{display:flex;flex-wrap:wrap;gap:.2rem 1.2rem;align-items:baseline;justify-content:center;min-height:2.2em}
.sl-say{margin:0;font-size:clamp(15px, 2.4vmin, 28px);font-weight:600;color:var(--text-strong)}
.sl-score{margin:0;font-size:clamp(14px, 2.1vmin, 24px);color:var(--text)}
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
    description: 'A brick slides along above a tower. One press drops it, and what hangs over the edge is '
      + 'cut off. Build up to the line. One switch can play. The easy levels are slow, and a miss costs nothing.',
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
    let quietMs = 0;
    let armed = false;
    let news = '';
    let stats = { best: 0, towers: 0 };
    let loopHandle = null, last = null, dead = false, hidden = false;
    let rootEl = null, boardEl = null, pieceEl = null, fallEl = null, staticEl = null, lineEl = null;
    let sayEl = null, scoreEl = null, ctrlEl = null, overlayEl = null;
    let drawnKey = '', drawnBoard = '', lastSay = '', lastScore = '', lastOverlay = null, drawnFalling = '';
    let menuAsks = 0;
    let score = null, ledger = null, tones = null, music = null, unSpeaker = null;   // the panel's own speaker (speakers.js followPanelSpeaker)
    let started = true, demo = false, demoMs = 0, demoRested = false, demoMemory = {}, agent = null;
    let restTimer = null;
    const plays = createPlayWatch(bus, ctx);

    const pick = (v, list, d) => (list.includes(v) ? v : d);
    const sizes = (level) => sizesFor(level, { track: cfg.track, width: cfg.width, line: cfg.line, speed: cfg.speed });
    const dropOpts = () => ({ cut: pick(cfg.cut, CUTS, 'cell'), onMiss: started ? pick(cfg.onMiss, MISS_MODES, 'again') : 'again',
      perfectGrows: cfg.perfectGrows !== false });
    const stepOpts = () => ({ slide: pick(cfg.slide, SLIDES, 'smooth'), idle: started ? idle : false, restMs: REST_MS,
      afterLine: started ? pick(cfg.afterLine, AFTER_LINE, 'same') : 'same', sizesFor: sizes });

    // ---- sound -----------------------------------------------------------------------------------
    function sound(ev) {
      if (!cfg.sounds || !armed || !tones) return;
      if (!started && cfg.attractSound !== true) return;
      const t = TONES[ev];
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
    function save() { try { state?.set?.({ stats }); } catch (err) { console.error('stackline: save', err); } }

    // ---- the loop: only while something moves ----------------------------------------------------
    function needsFrames() {
      if (dead || hidden || !g) return false;
      if (g.falling.length && g.phase !== 'paused') return true;
      if (!started) return demo && !demoRested;
      if (g.phase === 'paused' || g.phase === 'ready') return false;
      if (g.phase === 'won') return true;
      return !idle;
    }
    function ensureLoop() { if (loopHandle != null || !needsFrames()) return; last = null; loopHandle = clock.request(frame); }
    function stopLoop() { if (loopHandle != null) { try { clock.cancel(loopHandle); } catch { /* gone */ } } loopHandle = null; last = null; }
    function frame() {
      loopHandle = null;
      if (dead) return;
      const t = clock.now();
      const dt = last == null ? 0 : Math.min(250, t - last);   // a stalled tab does not jump the brick across the track
      last = t;
      advance(dt);
      if (needsFrames()) loopHandle = clock.request(frame); else last = null;
    }

    // ---- the demo ------------------------------------------------------------------------------------
    function demoObservation() {
      const top = topLayer(g);
      return { game: GAME, kind: 'stack-line', t: demoMs, actions: ['drop'],
        state: { phase: g.phase, piece: g.piece ? { x: g.piece.x, w: g.piece.w, id: g.piece.id } : null,
          top: { x: top.x, w: top.w }, height: height(g), line: g.line, track: g.track } };
    }
    function applyDemo(a) {
      if (!a || started || dead || !g || g.phase !== 'play') return;
      if (a.act === 'drop') for (const ev of drop(g, dropOpts())) sound(ev);
    }
    function advanceDemo(dt) {
      if (!demo || demoRested) { const ev = step(g, dt, stepOpts()); render(); return ev; }
      demoMs += dt;
      if (demoMs >= demoLimitMs(cfg.attractForMs)) { demoRested = true; syncAudio(); render(); return []; }
      const events = step(g, dt, stepOpts());
      if (g.phase === 'play') applyDemo(askAgent(agent, demoObservation(), { rand, memory: demoMemory }, { onLate: (x) => applyDemo(x) }));
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
      return handle(step(g, dt, stepOpts()));
    }

    // What a step or a press did: sounds, the words, the score, points, the saved totals.
    function handle(events) {
      for (const ev of events) {
        sound(ev);
        if (!started) continue;
        if (ev === 'perfect') news = NEWS.perfect;
        else if (ev === 'grow') news = NEWS.grow;
        else if (ev === 'cut') news = NEWS.cut;
        else if (ev === 'miss') news = cfg.onMiss === 'restart' ? NEWS.restart : NEWS.miss;
        else if (ev === 'line') {
          stats = { ...stats, towers: (Number(stats.towers) || 0) + 1, best: Math.max(Number(stats.best) || 0, g.towers) };
          pay();
          save();
        } else if (ev === 'fresh') news = '';
      }
      if (events.length) syncAudio();
      render();
      return events;
    }
    function pay() {
      const per = Math.round(Number(cfg.linePoints) || 0);
      if (!(per > 0) || !ledger) return;
      Promise.resolve(ledger.award({ amount: per, source: GAME, type: 'Play', tags: [GAME],
        note: `${TITLE}: a tower built to the line` })).catch((err) => console.error('stackline: points', err));
    }

    // ---- presses ---------------------------------------------------------------------------------------
    function markInput() {
      idle = false; quietMs = 0;
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
    function fresh() {
      g = newGame({ level: levelOf(cfg.level), sizes: sizes(levelOf(cfg.level)), colours: pick(cfg.colours, COLOUR_MODES, 'rows') });
      deal(g);
      idle = true; quietMs = 0; news = '';
    }
    function toStartScreen() {
      if (dead) return;
      clearRest(); stopLoop();
      started = false;
      fresh();
      demo = demoWanted();
      demoMs = 0; demoRested = false; demoMemory = {};
      agent = demo ? (gameAgentFor(GAME, 'stack-line') || lineComputer) : null;
      plays.pause();            // a game waiting for Start says it is not playing (game_start.js)
      syncAudio(); render(); ensureLoop();
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
    function skipRest() {
      if (g.phase !== 'won') return false;
      handle(step(g, REST_MS, stepOpts()));
      return true;
    }
    // Every press goes through here: Start first, then the rest-skip, then the drop.
    function press() {
      if (dead || !g) return;
      if (startGame()) return;
      const wasIdle = idle;
      markInput();
      if (g.phase === 'paused') { setPaused(g, false); syncAudio(); render(); ensureLoop(); return; }
      if (skipRest()) { syncAudio(); render(); ensureLoop(); return; }
      if (g.phase !== 'play') { render(); return; }
      // A press that wakes a game that came to rest only wakes it (the brick was standing still: dropping it where it
      // stopped would spend the press on a brick nobody was watching).
      if (wasIdle) { news = ''; syncAudio(); render(); ensureLoop(); return; }
      news = '';
      handle(drop(g, dropOpts()));
      ensureLoop();
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
      catch (err) { console.error('stackline: settings menu', err); }
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
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* not focusable here */ }
      e.preventDefault();
      press();
    }
    const KEYS = { ArrowDown: true, Enter: true };
    function onKey(e) {
      if (dead || !g || e.repeat) return;
      if (e.key === 'Escape') {
        if (!started) return;
        e.preventDefault(); e.stopPropagation();
        pauseGame({ menu: true });
        return;
      }
      if (KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); press(); return; }
      const want = Object.prototype.hasOwnProperty.call(PAUSE_KEYS, cfg.pauseKey) ? PAUSE_KEYS[cfg.pauseKey] : null;
      if (started && want && String(e.key).toLowerCase() === want) {
        e.preventDefault(); e.stopPropagation();
        if (g.phase === 'paused') resumeGame(); else pauseGame();
      }
    }

    // ---- drawing -------------------------------------------------------------------------------------------
    const rowsHigh = () => g.line + 2;   // the base, the rows to the line, and one above it for the sliding brick
    function brickStyle(x, w, row, extra = '') {
      const H = rowsHigh();
      return `left:${pct(x, g.track)};bottom:${pct(row, H)};width:${pct(w, g.track)};height:${pct(1, H)};--nb-cells:${(+w).toFixed(3)}${extra}`;
    }
    function render() {
      if (dead || !rootEl || !g) return;
      const sl = rootEl.querySelector('[data-sl]');
      if (sl) {
        sl.dataset.phase = g.phase;
        sl.dataset.motion = reducedMotion() ? 'reduce' : 'full';
        sl.dataset.started = started ? '1' : '0';
        sl.dataset.demo = !started && demo && !demoRested ? '1' : '0';
        sl.dataset.level = String(g.level);
      }
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ demo: demo && !demoRested, note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      const board = `${g.track}x${rowsHigh()}`;
      if (boardEl && board !== drawnBoard) {
        boardEl.style.setProperty('--sl-w', String(g.track));
        boardEl.style.setProperty('--sl-h', String(rowsHigh()));
        drawnBoard = board;
      }
      if (lineEl) lineEl.style.bottom = pct(g.line + 1, rowsHigh());
      // The tower: only when it changed (a brick landed, a fresh tower, the size changed).
      const key = `${g.serial}:${g.layers.length}:${board}:${g.phase === 'paused' ? 'p' : ''}`;
      if (staticEl && key !== drawnKey) {
        staticEl.innerHTML = g.layers.map((l, i) => `<div class="sl-brick nb-face" data-layer="${i}" data-c="${l.c}"`
          + ` style="${brickStyle(l.x, l.w, i)}"></div>`).join('')
          + `<div class="sl-paused" data-paused${g.phase === 'paused' ? '' : ' hidden'}><span aria-hidden="true">❚❚</span>`
          + '<span class="sl-paused-word">Paused</span></div>';
        drawnKey = key;
      }
      // The pieces cut off, falling and fading (reduced motion: not drawn at all - they just go).
      if (fallEl) {
        const fall = reducedMotion() ? '' : g.falling.map((f) => {
          const p = Math.min(1, f.ms / CUT_FALL_MS);
          return `<div class="sl-brick sl-fall nb-face" data-fall data-c="${f.c}" style="${brickStyle(f.x, f.w, f.row - 3 * p * p, `;opacity:${(1 - p).toFixed(3)}`)}"></div>`;
        }).join('');
        if (fall !== drawnFalling) { fallEl.innerHTML = fall; drawnFalling = fall; }
      }
      // The sliding brick: one element, moved.
      if (pieceEl) {
        const p = g.piece;
        if (!p || g.phase === 'won') pieceEl.hidden = true;
        else {
          pieceEl.hidden = false;
          pieceEl.dataset.c = String(p.c);
          pieceEl.setAttribute('style', brickStyle(p.x, p.w, g.layers.length));
        }
      }
      if (ctrlEl) ctrlEl.hidden = !started || cfg.button === false;
      const line = !started ? (demo && !demoRested ? START_LINES.demo : START_LINES.still) : statusFor(g, { idle, news });
      if (sayEl && line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      if (!started) {
        if (scoreEl && lastScore !== '') { scoreEl.textContent = ''; scoreEl.hidden = true; lastScore = ''; }
        return;
      }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const txt = own ? `Towers: ${g.towers} · Height: ${height(g)} of ${g.line} · Level: ${LEVELS[g.level].label}` : '';
      if (scoreEl && txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      try { score?.set(g.towers, { detail: `Level: ${LEVELS[g.level].label} · Best: ${Math.max(Number(stats.best) || 0, g.towers)}` }); }
      catch (err) { console.error('stackline: score', err); }
    }

    return {
      __probe: () => ({ game: g, cfg: { ...cfg }, idle, armed, quietMs, looping: loopHandle != null, stats: { ...stats },
        tones: tones?.state() || null, music: music?.state() || null, menuAsks, started, demo, demoRested, demoMs,
        agent: agent?.id || null, restPending: restTimer != null, playing: plays.playing(), news }),
      __step: (dt) => (dead ? [] : advance(dt)),
      init() {
        const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
        ensureStartStyle(doc);
        ensureBrickFaceStyle(doc);
        ensureStyle(doc);
        mount.innerHTML = '<div class="sl-wrap gs-host nb-bricks" data-sl-root tabindex="0" aria-label="Stack to the line"><div class="sl" data-sl>'
          + '<div class="sl-stage"><div class="sl-board" data-board>'
          + '<div class="sl-well" data-well role="img" aria-label="A tower of bricks, and a line to build up to">'
          + '<div data-static></div><div data-falling aria-hidden="true"></div>'
          + '<div class="sl-brick nb-face" data-piece hidden></div>'
          + '<div class="sl-line" data-line aria-hidden="true"><span class="sl-line-word">The line</span></div>'
          + '</div></div></div>'
          + '<div class="sl-controls" data-controls><button type="button" class="sl-btn" data-act="drop">▼ Drop</button></div>'
          + '<div class="sl-bar"><p class="sl-say" role="status" aria-live="polite"></p><p class="sl-score" data-score hidden></p></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-sl-root]');
        overlayEl = mount.querySelector('[data-start-host]');
        boardEl = mount.querySelector('[data-board]');
        staticEl = mount.querySelector('[data-static]');
        fallEl = mount.querySelector('[data-falling]');
        pieceEl = mount.querySelector('[data-piece]');
        lineEl = mount.querySelector('[data-line]');
        ctrlEl = mount.querySelector('[data-controls]');
        sayEl = mount.querySelector('.sl-say');
        scoreEl = mount.querySelector('[data-score]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('stackline: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null, onShownChange: () => render() });
        const id = ctx.instanceId || 'sl';
        tones = createGameTones({ audio, audioId: `${GAME}:${id}`, volume: 0.5,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });
        music = createGameMusic({ audio, audioId: `${GAME}-music:${id}`, volume: cfg.musicVolume,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });

        const applyCfg = (snap) => {
          const s = snap || {};
          const was = cfg;
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          next.level = levelOf(next.level);
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          if (g && next.colours !== was.colours) g.colours = pick(next.colours, COLOUR_MODES, 'rows');
          try { music?.setVolume(next.musicVolume); if (next.music === 'off') music?.off(); else if (was.music === 'off' || !g) music?.useAmbient(); } catch { /* quiet */ }
        };
        applyCfg(state?.get?.());
        fresh();
        // Row 2.97: "Its sound comes out of" (the Sound tab) sends this game's sound to that speaker.
        unSpeaker = followPanelSpeaker(state, () => [tones, music]);
        state?.subscribe?.((s) => {
          const was = { ...cfg };
          applyCfg(s);
          const sizeChanged = ['level', 'speed', 'width', 'track', 'line'].some((k) => was[k] !== cfg[k]);
          if (!started && (demoWanted() !== demo || sizeChanged)) { toStartScreen(); return; }
          syncAudio(); render(); ensureLoop();
        });

        bus.subscribe(`${GAME}/drop`, () => press());
        bus.subscribe(`${GAME}/back`, () => back());
        bus.subscribe(`${GAME}/pause`, (_p, _t, meta) => pauseGame({ menu: !(meta && meta.from === 'transport') }));
        bus.subscribe(`${GAME}/resume`, () => resumeGame());
        bus.subscribe(SHELL_STATE, (p) => { if (p && p.menuOpen === true && started && g && g.phase !== 'paused') pauseGame(); });
        bus.subscribe(`${GAME}/new`, () => { if (!started) { toStartScreen(); return; } stopLoop(); fresh(); syncAudio(); render(); });
        bus.subscribe(`${GAME}/attract`, () => toStartScreen());

        if (shouldAutostart(state?.get?.() || {}, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) {
          started = true; render();
        } else toStartScreen();
      },
      onResize() { render(); },
      onHide() {
        hidden = true;
        if (started && g && g.phase === 'play') { setPaused(g, true); plays.pause(); }
        stopLoop(); syncAudio(); render();
        try { state?.flush?.(); } catch { /* nothing to do */ }
      },
      onShow() { hidden = false; syncAudio(); render(); ensureLoop(); },
      destroy() {
        try { unSpeaker?.(); } catch { /* gone */ } unSpeaker = null;
        dead = true;
        clearRest(); stopLoop();
        mount.removeEventListener('pointerdown', onPointerDown);
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

export { LEVELS, freshTower };
