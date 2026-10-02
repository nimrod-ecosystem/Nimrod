// modules/rhythm.js — RHYTHM TILES: floor tiles light to a beat, and you press on the beat.
//
// Row 2.37 item 10 (MIKE_CHANGE_LIST.md, private repo; room_as_home_20260930.md §7): *"Floor tiles and
// bricks can be used for rhythm and brick-breaker games."* Built standalone first; the tiles are drawn
// from theme custom properties (`--floor-tile`, `--floor-tile-lit`) so the room's own floor can be the
// game later. The arithmetic (beat, judge, flash limit, patterns) is `../rhythm_beat.js`.
//
// ONE SWITCH WORKS BY DEFINITION: the whole game is one kind of press, at the right moment. Any press
// counts - select, next or prev, a key, a tap anywhere on the panel - unless `target` is set to "the
// lit tile", which is a harder game for a pointer.
//
// *** THE TIMING WINDOW DEFAULTS TO GENEROUS (±250 ms), ARGUED. ***
//   FOR generous: a switch is slow to close and slower to close on time - press-to-contact latency is
//   commonly a few hundred milliseconds and, after a brain injury, uneven from press to press. A
//   window a rhythm game for gamers would use (±50-100 ms) would read as "you missed" to someone who
//   pressed on the beat as well as their hand allows. Feeling in time is the point; the first
//   session has to feel like success.
//   AGAINST: at the default 60 bpm, ±250 ms is half of every beat, so a press at a random moment is
//   a hit half the time; a hit is weak evidence of timing. That is why points are off by default
//   (below), why tighter windows are one setting away, and why the window is capped at 40% of the gap
//   between beats (rhythm_beat.js) so at fast tempos "on the beat" still means something. There is
//   also a "my presses land late by" setting, which fixes a steady lateness better than widening.
// A press can only be judged ONCE PER BEAT (the first press nearest a beat is that beat's answer), so
// mashing the switch does not score: each beat's first mashed press lands half a beat early.
//
// *** FLASHING: THE SCREEN'S LIMIT WHEN ONE IS SET, the game's own range when not (2026-10-01). ***
// One tile lights per beat. The tempo tops out at the game's own 300 bpm (rhythm_beat.js argues it);
// a screen with a flash limit (the "Flashing can cause seizures" starting default, or the setting)
// caps it lower - 175 at 3 a second, 115 at 2, 55 at 1 - and slows the hit mark to fit. A hit shows as
// a mark INSIDE the tile that is already lit - never a second light. A limit changed mid-game restarts
// the beat at once. `dev/rhythm_test.html` counts every onset.
// THE WORDS UNDER THE TILES change at most about three times a second at ANY limit (STATUS_GAP_MS):
// that one is readability, not flashing - a line replaced faster than that cannot be read.
//
// HITS ARE SHOWN WITH MORE THAN COLOUR: a lit tile carries a big dot; a hit puts "✓ Hit!" in it; early
// and late say "◀ A little early" / "A little late ▶" under the tiles; the tally is a number.
//
// *** WHERE THE BEAT COMES FROM. *** Default: its own metronome, a click on the audio bus's "Game
// sounds" channel. `game_music.js` has no beat to follow (its ambient bed is a slow drone and a folder's
// tracks have no known tempo), so it is not used here; instead, `beatFrom: 'screen'` follows a tempo
// published on the screen (`tempo.js`, `tempo/value`) when there is one - which is how this game will
// play along with real music once something publishes the tempo of what is playing.
//
// ROUNDS, AND A GAME NOBODY PLAYS COMES TO REST. The beat starts on the first press (a game waiting
// for a press is ordinary; games are settled - CLAUDE.md). A round is a count-in, 16 beats to play,
// then a short rest showing how it went; the next round starts by itself. A round with no press in it
// at all stops the beat, so an empty room does not get a metronome ticking all night.
//
// *** A START BUTTON, AND THE COMPUTER PLAYING MEANWHILE (Mike, 2026-10-02 late). *** It opens waiting
// for Start (`autostart`, off; game_start.js argues it, and it replaces the old `startOn` row - a saved
// "as soon as it is on the screen" still reads as autostart on). Meanwhile the computer taps along
// (game_agent.js), a little off the beat and missing one now and then, SILENT unless `attractSound`, and
// never counted: no score, no points, no stats. Any press starts a real game, and the beat with it. A
// beat that stopped because nobody was playing brings the demo back after `attractAfterMs`.
// PAUSE / PLAY (the bar's button, Space, "pause"): `rhythm/pause` stops the beat; `rhythm/play` starts it
// (or starts the game). The verb map entries are actions.js's (lines handed to its owner).

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { TEMPO_TOPIC, normalizeTempo } from '../tempo.js';
import {
  MAX_BPM, TEMPOS, WINDOWS, LIT_FRACTION, PATTERNS, clampBpm, lightEvery, windowMs, judge,
  roundOf, createPattern, maxBpmFor,
} from '../rhythm_beat.js';
import { flashLimit, minFlashPeriodMs, normalizeFlashLimit } from '../flash_limit.js';
import {
  autostartFields, attractFields, shouldAutostart, panelAlone, createPlayReporter, demoLimitMs, demoReturnMs,
  ATTRACT_DEFAULTS, START_VOICE, START_LINES, ensureStartStyle, startOverlayHtml,
} from '../game_start.js';
import { gameAgentFor, askAgent } from '../game_agent.js';

export const GAME = 'rhythm';
export const SCORE_LABEL = 'Rhythm: on the beat';

// The line under the tiles changes no more often than this (about three a second), so a burst of
// presses cannot make text flicker. The last word is shown when the gap allows. KEPT WITH NO FLASH
// LIMIT, argued: FOR dropping it, it was born beside the flash rule; AGAINST, and it wins, a line of
// words replaced faster than this cannot be read by anybody, so it is a reading floor, not a flash one.
// At a STRICTER flash limit the gap grows with it (`statusGapMs`).
export const STATUS_GAP_MS = 350;
export const statusGapMs = (limit) => Math.max(STATUS_GAP_MS, minFlashPeriodMs(limit));
// The hit mark INSIDE a lit tile. Under a flash limit it keeps the words' gap, exactly as before; with
// no limit it follows the beat (every hit is marked - the mark is the game's own feedback, and a tile
// can only be lit once a beat anyway).
export const markGapMs = (limit) => (Number.isFinite(normalizeFlashLimit(limit)) ? statusGapMs(limit) : 0);
// Clicks are scheduled this far ahead on the audio clock, so a late frame does not make a late click.
const LOOKAHEAD_MS = 120;
// Endless play (no rounds): the beat stops after this many beats with no press. Argued, not a setting.
export const IDLE_BEATS = 16;
// Tile notes, when sound is 'notes': a major pentatonic from middle C. Any two sound fine together,
// which is the point of a pentatonic - a random pattern still makes a tune rather than a clash.
const NOTES = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const CLICK = { accent: 1175, beat: 880, ms: 30 };
const HIT_BLIP = { f: 1568, ms: 70 };

export const DEFAULTS = Object.freeze({
  tempo: 60,              // one beat a second
  window: 'generous',
  pressOffset: 0,
  tiles: 4,               // one per beat of a 4/4 bar, so the walk is a bar
  pattern: 'walk',        // predictable first: you can see which tile is next
  target: 'any',
  countIn: 4,
  roundBeats: 16,
  restBeats: 4,
  sound: 'click',         // a click is the clearest timing cue; 'notes' is more musical
  hitSound: true,
  beatFrom: 'own',
  // game_start.js argues these: it waits for Start, and the computer taps along meanwhile, silently.
  autostart: false,
  autostartAlone: 'same',
  ...ATTRACT_DEFAULTS,
  stopWhenIdle: true,
  // *** A GOOD ROUND PAYS NOTHING BY DEFAULT. *** Both sides:
  //   FOR paying: a round on the beat is a real achievement, and points.js pays for achievement.
  //   AGAINST, and it wins for the default: with the generous window a random presser hits half the
  //   beats, so a "good round" is partly luck; paying for it by default puts luck in the economy.
  //   So a setting pays Play points for a round with at least `goodRoundPct` on the beat.
  roundPoints: 0,
  goodRoundPct: 75,
});

const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Beats hit this round. A Scoreboard on the same screen can show it instead.' }),
  { key: 'tempo', label: 'Speed of the beat', kind: 'choice', default: 60, level: 'essential',
    options: TEMPOS.map((b) => ({ value: b, label: `${b} a minute${b === 60 ? ' (one a second)' : ''}` })),
    note: `Up to ${MAX_BPM} a minute. A screen with a flashing limit slows the beat to fit `
      + `(3 a second: ${maxBpmFor(3)}; 2 a second: ${maxBpmFor(2)}; 1 a second: ${maxBpmFor(1)}).` },
  { key: 'window', label: 'How close to the beat counts', kind: 'choice', default: 'generous', level: 'essential',
    options: [
      { value: 'tight', label: 'Close (a tenth of a second)' }, { value: 'normal', label: 'Fairly close' },
      { value: 'generous', label: 'Generous (a quarter of a second)' }, { value: 'very-generous', label: 'Very generous' },
    ] },
  { key: 'pressOffset', label: 'My presses land late by', kind: 'choice', default: 0, level: 'standard',
    options: [0, 50, 100, 150, 200, 300].map((v) => ({ value: v, label: v ? `${v} ms` : 'Nothing: judge them as they land' })),
    note: 'For a switch that takes a moment to close: moves "on the beat" to where the presses really land.' },
  { key: 'tiles', label: 'Tiles', kind: 'choice', default: 4, level: 'standard',
    options: [3, 4, 5, 6, 8].map((v) => ({ value: v, label: String(v) })) },
  { key: 'pattern', label: 'Which tile lights next', kind: 'choice', default: 'walk', level: 'standard',
    options: [
      { value: 'walk', label: 'Along the row, left to right' }, { value: 'bounce', label: 'Along and back' },
      { value: 'random', label: 'Any tile (never the same twice)' },
    ] },
  { key: 'target', label: 'What counts as a press', kind: 'choice', default: 'any', level: 'standard',
    options: [{ value: 'any', label: 'Any press, anywhere (one switch)' }, { value: 'tile', label: 'Touching the lit tile' }],
    note: 'Switches and keys always count; this is for a pointer.' },
  { key: 'roundBeats', label: 'Beats in a round', kind: 'choice', default: 16, level: 'standard',
    options: [{ value: 8, label: '8' }, { value: 16, label: '16' }, { value: 32, label: '32' }, { value: 0, label: 'No rounds: keep going' }] },
  { key: 'countIn', label: 'Count-in beats', kind: 'choice', default: 4, level: 'advanced',
    options: [2, 4, 8].map((v) => ({ value: v, label: String(v) })) },
  { key: 'restBeats', label: 'Rest between rounds (beats)', kind: 'choice', default: 4, level: 'advanced',
    options: [2, 4, 8].map((v) => ({ value: v, label: String(v) })) },
  { key: 'sound', label: 'The beat sounds like', kind: 'choice', default: 'click', level: 'standard',
    options: [{ value: 'click', label: 'A click' }, { value: 'notes', label: 'A note for each tile' }, { value: 'off', label: 'Nothing: lights only' }] },
  { key: 'hitSound', label: 'A sound for a hit', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'beatFrom', label: 'Where the beat comes from', kind: 'choice', default: 'own', level: 'advanced',
    options: [{ value: 'own', label: 'Its own metronome' }, { value: 'screen', label: 'A tempo on this screen, when there is one' }],
    note: 'A faster tempo than the limit lights every second (or fourth) beat.' },
  ...autostartFields({ on: false }),
  ...attractFields({ on: true, sound: true }),
  { key: 'stopWhenIdle', label: 'A round with no presses', default: true, level: 'advanced',
    onLabel: 'Stops the beat', offLabel: 'Keeps going' },
  { key: 'roundPoints', label: 'Play points for a good round', kind: 'number', default: 0, min: 0, max: 10, step: 1,
    level: 'advanced', note: '0 means rounds pay nothing.' },
  { key: 'goodRoundPct', label: 'A good round is at least', kind: 'choice', default: 75, level: 'advanced',
    options: [50, 75, 90, 100].map((v) => ({ value: v, label: `${v}% on the beat` })) },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

export const VERDICT_WORDS = Object.freeze({ hit: '✓ On the beat!', early: '◀ A little early', late: 'A little late ▶',
  wrong: '✗ That tile was not lit' });

registerModule(
  { type: GAME, title: 'Rhythm tiles', core: 'new',
    description: 'Tiles light up to a beat; press on the beat. One switch is all it takes. '
      + 'Slow and forgiving by default, and keeps to the screen\'s flashing limit when one is set.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: START_VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const audio = ctx.audio || null;
    const rand = ctx.rand || Math.random;
    // THE CLOCK IS INJECTABLE (a hidden document never fires animation frames). Wall-clock time by
    // default, because a screen tempo's origin (tempo.js) is wall-clock time.
    const clock = ctx.clock || (() => {
      const raf = typeof requestAnimationFrame === 'function';
      return {
        now: () => Date.now(),
        request: (cb) => (raf ? requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16)),
        cancel: (h) => { if (raf) cancelAnimationFrame(h); else clearTimeout(h); },
      };
    })();
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
    };

    let cfg = { ...DEFAULTS };
    let screenTempo = null;        // the last tempo/value heard
    let run = null;                // { origin, interval, k0, meter, tileOf, windowMs, window }
    let lastSeen = -1;             // the last beat index handled
    let lastSounded = -1;          // the last beat index a click was scheduled for
    let judged = new Map();        // k -> 'hit' | 'early' | 'late' | 'wrong' | 'miss'
    let round = null;              // { index, hits, presses, beats }
    let lastResult = null;         // { hits, beats } of the round just finished
    let lit = null;                // { k, tile, until }
    let streak = 0;
    let quietBeats = 0;            // endless play: beats since the last press
    let stats = { bestRound: 0, rounds: 0 };
    let armed = false;
    let dead = false, hidden = false;
    let loopHandle = null;
    let status = '', statusAt = -1e9, statusWant = '';
    let markedK = null, lastMarkAt = -1e9;
    let rootEl = null, tilesEl = null, sayEl = null, scoreEl = null, tileEls = [];
    let score = null, ledger = null, tones = null;
    // ---- waiting for Start, and the demo (game_start.js, game_agent.js) ----
    let started = true;           // false: the Start button is up; a run, if any, is the demo's (`run.demo`)
    let demo = false;             // the computer is tapping along
    let demoAt = 0;               // when this demo began (the game's clock)
    let demoRested = false;       // it ran its time: the tiles go still, Start stays
    let demoMemory = {};
    let agent = null;
    let restTimer = null;
    let overlayEl = null, lastOverlay = null;
    const report = createPlayReporter(bus, ctx);
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const demoRun = () => !!run && run.demo === true;
    const startLine = () => (demo && !demoRested ? START_LINES.demo : START_LINES.still);

    const now = () => clock.now();
    const beatAt = (k) => run.origin + k * run.interval;
    // THE SCREEN'S FLASH LIMIT, read fresh each time (the kiosk supplies a getter).
    const limitNow = () => flashLimit(ctx);
    const tempoNow = () => {
      const limit = limitNow();
      if (cfg.beatFrom === 'screen' && screenTempo) {
        const every = lightEvery(screenTempo.bpm, limit);
        return { bpm: screenTempo.bpm / every, origin: screenTempo.origin, meter: screenTempo.meter || 4, every, limit };
      }
      return { bpm: clampBpm(cfg.tempo, limit), origin: null, meter: 4, every: 1, limit };
    };

    // ---- the line under the tiles, never more than three changes a second ----------------------
    function wantStatus(text) {
      // Waiting for Start, the words say so and nothing else: the demo's verdicts are not the person's.
      statusWant = started ? text : startLine();
      flushStatus();
    }
    function flushStatus() {
      if (statusWant === status || !sayEl) return;
      const t = now();
      if (t - statusAt < statusGapMs(limitNow())) return;   // shown on a later frame
      status = statusWant; statusAt = t;
      sayEl.textContent = status;
    }

    // ---- sound -------------------------------------------------------------------------------------
    function scheduleClicks(t) {
      if (!run || !armed || cfg.sound === 'off' || !tones) return;
      if (run.demo && cfg.attractSound !== true) return;     // the demo is silent unless asked
      let k = Math.max(lastSounded + 1, run.k0);
      for (; beatAt(k) - t < LOOKAHEAD_MS; k++) {
        const rel = k - run.k0;
        const info = roundOf(rel, rounds());
        if (info.phase === 'count' || info.phase === 'play') {
          const inSec = Math.max(0, (beatAt(k) - t) / 1000);
          if (cfg.sound === 'notes') tones.tone(NOTES[run.tileOf(rel) % NOTES.length], 180, { type: 'triangle', level: 0.6, inSec });
          else tones.tone(rel % run.meter === 0 ? CLICK.accent : CLICK.beat, CLICK.ms, { type: 'triangle', level: 0.7, inSec });
        }
        lastSounded = k;
      }
    }

    const rounds = () => ({ countIn: Number(cfg.countIn) || 0, roundBeats: Number(cfg.roundBeats) || 0,
      restBeats: Number(cfg.restBeats) || 0 });

    // ---- start and stop ----------------------------------------------------------------------------
    function start({ demo: isDemo = false } = {}) {
      if (dead) return;
      const tp = tempoNow();
      const interval = 60000 / tp.bpm;
      const t = now();
      let origin, k0;
      if (tp.origin != null) {
        // Follow the screen's grid: this run's first beat is the next of ITS beats (every nth).
        origin = tp.origin; k0 = Math.floor((t - origin) / interval) + 1;
      } else { origin = t + interval; k0 = 0; }   // own beat: the first one a beat from now
      run = { origin, interval, k0, limit: tp.limit, meter: Math.max(1, Math.round(tp.meter / tp.every)) || 4,
        tileOf: createPattern(cfg.pattern, cfg.tiles, Math.floor(rand() * 1e9) + 1), demo: !!isDemo };
      lastSeen = k0 - 1; lastSounded = k0 - 1;
      judged = new Map(); round = null; lit = null; streak = 0; quietBeats = 0;
      tones?.setActive(armed && cfg.sound !== 'off' && (!isDemo || cfg.attractSound === true));
      if (!isDemo) { clearRest(); report(true); }
      render('start');
      ensureLoop();
    }
    function stop(reason = '') {
      const real = !!run && !run.demo;
      run = null; lit = null; round = null;
      stopLoop();
      tones?.setActive(false);
      if (real) report(false);
      // A beat nobody was playing: the demo comes back after a while (`attractAfterMs`).
      if (real && reason === 'idle') scheduleDemo();
      render(reason);
      ensureLoop();                  // only if the words under the tiles are still waiting their turn
    }
    const restart = () => { if (run) { const a = armed; const d = run.demo; stop(); armed = a; start({ demo: d }); } };

    // ---- Start, and back to the Start screen ----------------------------------------------------------
    function clearRest() { if (restTimer != null) { try { clearT(restTimer); } catch { /* gone */ } restTimer = null; } }
    function scheduleDemo() {
      const ms = demoReturnMs(cfg.attractAfterMs);
      if (!(ms > 0) || restTimer != null || dead) return;
      restTimer = setT(() => { restTimer = null; if (!dead && started && !run) toStartScreen(); }, ms);
    }
    const demoWanted = () => cfg.attract !== false && !reducedMotion();
    function toStartScreen() {
      if (dead) return;
      clearRest();
      if (run) stop();
      started = false;
      demo = demoWanted();
      demoAt = now(); demoRested = false; demoMemory = {};
      agent = demo ? gameAgentFor(GAME, 'beat') : null;
      lastResult = null; streak = 0;
      report(false);
      status = ''; statusAt = -1e9;
      if (demo && !hidden) start({ demo: true });
      wantStatus(startLine());
      render();
    }
    // ANY PRESS STARTS A REAL GAME, and the beat with it.
    function startGame() {
      if (dead || started) return false;
      if (run) stop();
      started = true; demo = false; agent = null; demoMemory = {};
      if (!armed) { armed = true; tones?.resume(); }
      status = ''; statusAt = -1e9;
      start();
      return true;
    }
    // The computer's turn, every frame of the demo: the beat's state in, maybe a press out.
    function demoTick(t) {
      if (!demoRun()) return;
      if (t - demoAt >= demoLimitMs(cfg.attractForMs)) { demoRested = true; stop(); wantStatus(startLine()); return; }
      const k = Math.round((t - run.origin) / run.interval);
      if (k < run.k0) return;
      const info = roundOf(k - run.k0, rounds());
      const prior = judged.get(k);
      const obs = { game: GAME, kind: 'beat', t: t - demoAt, actions: ['press'],
        state: { phase: info.phase, beat: k, msFromBeat: t - beatAt(k), interval: run.interval,
          pressed: !!prior && prior !== 'miss', tiles: tileEls.length, lit: run.tileOf(k - run.k0) } };
      const a = askAgent(agent, obs, { rand, memory: demoMemory });
      if (a && a.act === 'press' && demoRun()) judgePress(t, a.tile == null ? null : Number(a.tile));
    }

    // ---- the loop ----------------------------------------------------------------------------------
    function ensureLoop() {
      if (loopHandle != null || dead || hidden) return;
      if (!run && statusWant === status) return;
      loopHandle = clock.request(frame);
    }
    function stopLoop() {
      if (loopHandle != null) { try { clock.cancel(loopHandle); } catch { /* gone */ } }
      loopHandle = null;
    }
    function frame() {
      loopHandle = null;
      if (dead) return;
      tick(now());
      ensureLoop();
    }

    function tick(t) {
      // A limit lowered (or raised) while the beat runs: the beat is re-made at the new cap at once,
      // rather than finishing the round too fast for the person the new limit is for.
      if (run && limitNow() !== run.limit) restart();
      if (run) {
        const win = windowMs(cfg.window, run.interval);
        // beats that have started since the last look
        const kNow = Math.floor((t - run.origin) / run.interval);
        for (let k = lastSeen + 1; k <= kNow && run; k++) onBeat(k, t);
        if (!run) { render(); return; }            // a round with nobody in it stopped the beat
        lastSeen = Math.max(lastSeen, kNow);
        if (run.demo) { demoTick(t); if (!run) { render(); return; } }
        // beats whose window has closed with no press: a miss (no mark, no sound - just not a hit)
        for (let k = Math.max(run.k0, kNow - 2); k <= kNow; k++) {
          if (!run) break;
          const info = roundOf(k - run.k0, rounds());
          if (info.phase === 'play' && !judged.has(k) && t - (Number(cfg.pressOffset) || 0) > beatAt(k) + win) {
            judged.set(k, 'miss'); streak = 0;
          }
        }
        if (lit && t >= lit.until) lit = null;
        if (run) scheduleClicks(t);
      }
      render();
    }

    function onBeat(k, t) {
      if (!run) return;
      const rel = k - run.k0;
      if (rel < 0) return;
      const info = roundOf(rel, rounds());
      if (info.phase === 'count' || info.phase === 'play') {
        lit = { k, tile: run.tileOf(rel), until: beatAt(k) + run.interval * LIT_FRACTION };
        if (t >= lit.until) lit = null;   // a stalled frame: that light has already been and gone
      } else lit = null;
      if (info.phase === 'count' && info.beat === 0) {
        round = { index: info.round, hits: 0, presses: 0, beats: Number(cfg.roundBeats) || 0 };
        lastResult = null;
      }
      // The words change on the beat's own events, never every frame: a verdict stays up until the
      // next one, and "Go!" does not paper over a press that was already judged.
      if (info.phase === 'count') wantStatus(`Get ready: ${info.left}`);
      else if (info.phase === 'play' && info.beat === 0 && !judged.has(k)) wantStatus('Go!');
      if (info.phase === 'play') {
        if (!round) round = { index: info.round, hits: 0, presses: 0, beats: Number(cfg.roundBeats) || 0 };
        if (!(round.beats > 0) && !run.demo) {
          quietBeats++;
          if (cfg.stopWhenIdle && quietBeats > IDLE_BEATS) { stop('idle'); return; }
        }
      }
      if (info.phase === 'rest' && info.beat === 0 && round) endRound();
    }

    function endRound() {
      const r = round;
      // THE DEMO NEVER COUNTS: no stats, no points, no "how it went" - and it goes round again.
      if (run?.demo) return;
      lastResult = { hits: r.hits, beats: r.beats };
      stats = { ...stats, rounds: (Number(stats.rounds) || 0) + 1, bestRound: Math.max(Number(stats.bestRound) || 0, r.hits) };
      try { state?.set?.({ stats }); } catch (err) { console.error('rhythm: save', err); }
      const pts = Math.round(Number(cfg.roundPoints) || 0);
      if (pts > 0 && ledger && r.beats > 0 && r.hits >= Math.ceil((Number(cfg.goodRoundPct) || 75) / 100 * r.beats)) {
        Promise.resolve(ledger.award({ amount: pts, source: GAME, type: 'Play', tags: [GAME],
          note: `Rhythm: ${r.hits} of ${r.beats} on the beat` })).catch((err) => console.error('rhythm: points', err));
      }
      if (cfg.stopWhenIdle && r.presses === 0) { stop('idle'); return; }
      wantStatus(`${r.hits} of ${r.beats} on the beat! Next round coming.`);
    }

    // ---- a press ------------------------------------------------------------------------------------
    function press(tile = null) {
      if (dead) return;
      if (startGame()) return;       // waiting for Start: any press is Start, and the beat begins
      if (!armed) { armed = true; tones?.resume(); if (run) tones?.setActive(cfg.sound !== 'off'); }
      quietBeats = 0;
      clearRest();
      if (!run) { start(); return; }
      const t = now();
      tick(t);                       // catch up first, so the press is judged against the beat as it is now
      if (!run) { start(); return; }
      judgePress(t, tile);
    }
    // One press, judged against the beat. The person's presses and the demo's both come here; only the
    // person's make a sound unless the demo was asked for its sounds, and only theirs are ever counted
    // (endRound and render leave a demo run out).
    function judgePress(t, tile) {
      const win = windowMs(cfg.window, run.interval);
      const j = judge(t, { origin: run.origin, interval: run.interval, window: win, offset: Number(cfg.pressOffset) || 0 });
      const info = roundOf(j.k - run.k0, rounds());
      if (info.phase !== 'play') { render(); return; }     // counting in, or resting: not judged
      if (round) round.presses++;
      const prior = judged.get(j.k);
      if (prior && prior !== 'miss') { render(); return; }     // one answer per beat
      let verdict = j.verdict;
      if (verdict === 'hit' && cfg.target === 'tile' && tile != null && tile !== run.tileOf(j.k - run.k0)) verdict = 'wrong';
      if (prior === 'miss' && verdict === 'hit') verdict = 'late';   // a window already closed is not reopened
      judged.set(j.k, verdict);
      if (verdict === 'hit') {
        streak++;
        if (round) round.hits++;
        if (cfg.hitSound && tones && (!run.demo || cfg.attractSound === true)) tones.tone(HIT_BLIP.f, HIT_BLIP.ms, { type: 'sine', level: 0.5 });
      } else streak = 0;
      wantStatus(VERDICT_WORDS[verdict]);
      render();
      ensureLoop();
    }

    // ---- drawing --------------------------------------------------------------------------------------
    function buildTiles() {
      const n = Math.max(1, Math.round(Number(cfg.tiles) || 4));
      if (tileEls.length === n) return;
      tilesEl.innerHTML = Array.from({ length: n }, (_, i) => `<div class="rh-tile" data-tile="${i}" role="img" aria-label="tile ${i + 1}">`
        + '<span class="rh-dot" aria-hidden="true"></span><span class="rh-mark" data-mark-text></span></div>').join('');
      tileEls = [...tilesEl.querySelectorAll('.rh-tile')];
    }
    function render(reason = '') {
      if (dead || !rootEl) return;
      buildTiles();
      const root = rootEl.querySelector('[data-rh]');
      if (root) {
        root.dataset.motion = reducedMotion() ? 'reduce' : 'full';
        root.dataset.running = run ? '1' : '0';
        root.dataset.started = started ? '1' : '0';
        root.dataset.demo = demoRun() ? '1' : '0';
      }
      if (overlayEl) {
        const html = started ? '' : startOverlayHtml({ demo: demo && !demoRested, note: false });
        if (html !== lastOverlay) { overlayEl.innerHTML = html; lastOverlay = html; overlayEl.hidden = started; }
      }
      // The hit mark is itself a change on the screen, so under a flash limit it keeps the same rule as
      // the lights: at the fastest tempos a hit whose mark would come too soon after the last one is
      // still counted, sounded and tallied - it just does not draw a mark. No limit: every hit is marked.
      const tNow = now();
      if (lit && judged.get(lit.k) === 'hit' && markedK !== lit.k && tNow - lastMarkAt >= markGapMs(limitNow())) {
        markedK = lit.k; lastMarkAt = tNow;
      }
      tileEls.forEach((el, i) => {
        const on = !!lit && lit.tile === i;
        const hit = on && markedK === lit.k;
        if ((el.dataset.lit === '1') !== on) el.dataset.lit = on ? '1' : '0';
        const mark = hit ? 'hit' : '';
        if ((el.dataset.mark || '') !== mark) {
          if (mark) el.dataset.mark = mark; else delete el.dataset.mark;
          el.querySelector('[data-mark-text]').textContent = hit ? '✓ Hit!' : '';
        }
      });
      // the words
      if (!started) {
        wantStatus(startLine());
      } else if (!run) {
        if (reason || !status) {
          wantStatus(lastResult ? `${lastResult.hits} of ${lastResult.beats} on the beat. Press to play again.`
            : (reason === 'back' ? 'Stopped. Press to start the beat again.'
              : reason === 'paused' ? 'Paused. Press to go on.' : 'Press to start the beat.'));
        }
      } else if (lastSeen < run.k0 && reason === 'start') wantStatus('Get ready…');
      flushStatus();
      // THE DEMO NEVER SCORES: nothing drawn, nothing published.
      if (!started) {
        if (scoreEl && scoreEl.textContent !== '') { scoreEl.textContent = ''; scoreEl.hidden = true; }
        return;
      }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const hits = round ? round.hits : (lastResult ? lastResult.hits : 0);
      const of = round?.beats || lastResult?.beats || 0;
      const txt = own ? `✓ ${hits}${of ? ` of ${of}` : ''} on the beat${streak > 1 ? ` · ${streak} in a row` : ''}` : '';
      if (scoreEl && scoreEl.textContent !== txt) { scoreEl.textContent = txt; scoreEl.hidden = !txt; }
      try {
        score?.set(hits, { target: of || null, detail: `${streak} in a row · best round ${Math.max(Number(stats.bestRound) || 0, hits)}` });
      } catch (err) { console.error('rhythm: score', err); }
    }

    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      const t = e.target.closest('[data-tile]');
      press(t ? Number(t.dataset.tile) : null);
    }

    return {
      __probe: () => ({ cfg: { ...cfg }, running: !!run, run: run ? { ...run } : null, lit: lit ? { ...lit } : null,
        round: round ? { ...round } : null, lastResult, streak, armed, looping: loopHandle != null, status,
        judged: new Map(judged), stats: { ...stats }, tones: tones?.state() || null,
        started, demo, demoRun: demoRun(), demoRested, agent: agent?.id || null, restPending: restTimer != null }),
      __tick: () => { if (!dead) tick(now()); },
      init() {
        let cssHref = '';
        try { cssHref = new URL('../rhythm.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        ensureStartStyle(mount.ownerDocument || (typeof document !== 'undefined' ? document : null));
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-rh-css href="${esc(cssHref)}">` : ''}`
          + '<div class="rh-wrap gs-host" data-rh-root><div class="rh" data-rh>'
          + '<div class="rh-tiles" data-tiles></div>'
          + '<div class="rh-bar"><p class="rh-say" role="status" aria-live="polite"></p><p class="rh-score" data-score hidden></p></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-rh-root]');
        overlayEl = mount.querySelector('[data-start-host]');
        tilesEl = mount.querySelector('[data-tiles]');
        sayEl = mount.querySelector('.rh-say');
        scoreEl = mount.querySelector('[data-score]');
        mount.addEventListener('pointerdown', onPointerDown);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('rhythm: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null,
          onShownChange: () => render() });
        tones = createGameTones({ audio, audioId: `${GAME}:${ctx.instanceId || 'rh'}`, volume: 0.5,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });

        const applyCfg = (snap) => {
          const s = snap || {};
          const was = cfg;
          const next = { ...DEFAULTS };
          for (const k of Object.keys(DEFAULTS)) if (s[k] !== undefined) next[k] = s[k];
          next.tempo = clampBpm(next.tempo);
          next.pattern = oneOf(next.pattern, PATTERNS, DEFAULTS.pattern);
          if (!Object.prototype.hasOwnProperty.call(WINDOWS, next.window)) next.window = DEFAULTS.window;
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          // The old row: "The beat starts: as soon as it is on the screen" IS autostart on.
          if (s.autostart === undefined && s.startOn === 'open') next.autostart = true;
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          if (tileEls.length && Number(next.tiles) !== tileEls.length) { tileEls = []; }
          return ['tempo', 'tiles', 'pattern', 'beatFrom', 'countIn', 'roundBeats', 'restBeats']
            .some((k) => next[k] !== was[k]);
        };
        applyCfg(state?.get?.());
        state?.subscribe?.((s) => {
          if (applyCfg(s)) restart();
          // "While nobody is playing" changed while it waits for Start: the demo follows at once.
          if (!started && demoWanted() !== demo) { toStartScreen(); return; }
          tones?.setActive(!!run && armed && cfg.sound !== 'off' && (!run.demo || cfg.attractSound === true));
          render();
        });

        bus.subscribe(TEMPO_TOPIC, (raw) => {
          const t = normalizeTempo(raw);
          if (!t) return;
          const changed = !screenTempo || t.bpm !== screenTempo.bpm || t.origin !== screenTempo.origin;
          screenTempo = t;
          if (changed && cfg.beatFrom === 'screen') restart();
        });
        // Every press verb is a tap: one switch, two switches, or the scanning "next" switch all play.
        bus.subscribe(`${GAME}/select`, () => press());
        bus.subscribe(`${GAME}/next`, () => press());
        bus.subscribe(`${GAME}/prev`, () => press());
        // back stops the beat (a person stopping it, not a gate: nothing waits behind it).
        bus.subscribe(`${GAME}/back`, () => { if (run && !run.demo) stop('back'); });
        // PAUSE / PLAY: the bar's button, Space, "pause" / "play" (once actions.js maps the verbs here).
        // Pause stops the beat; play starts it - or, waiting for Start, starts the game.
        bus.subscribe(`${GAME}/pause`, () => { if (started && run && !run.demo) stop('paused'); });
        bus.subscribe(`${GAME}/play`, () => { if (startGame()) return; if (!run) { quietBeats = 0; clearRest(); start(); } });
        // Back to the Start screen (and the demo).
        bus.subscribe(`${GAME}/attract`, () => toStartScreen());

        render();
        // OPENS WAITING FOR START, unless this panel starts by itself (game_start.js).
        if (shouldAutostart(cfg, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) { started = true; start(); }
        else toStartScreen();
      },
      onResize() {},
      onHide() {
        hidden = true;
        if (run) stop(run.demo ? '' : 'hidden');
        try { state?.flush?.(); } catch { /* nothing */ }
      },
      // Back on screen, still waiting: the demo picks up again (unless it had already run its time).
      onShow() { hidden = false; if (!started && demo && !demoRested && !run) start({ demo: true }); render(); },
      destroy() {
        dead = true;
        clearRest();
        stopLoop();
        run = null;
        mount.removeEventListener('pointerdown', onPointerDown);
        try { tones?.destroy(); } catch { /* gone */ }
        tones = null;
        try { score?.destroy(); } catch { /* gone */ }
        score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  },
);
