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
// *** FLASHING (WCAG 2.3.1): at most three a second, tested. *** One tile lights per beat and the
// tempo is capped at 175 bpm (see rhythm_beat.js for why not 180). A hit shows as a mark INSIDE the
// tile that is already lit - never a second light - and the line under the tiles changes at most
// three times a second too (STATUS_GAP_MS). `dev/rhythm_test.html` counts every onset.
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

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { TEMPO_TOPIC, normalizeTempo } from '../tempo.js';
import {
  MAX_BPM, TEMPOS, WINDOWS, LIT_FRACTION, PATTERNS, clampBpm, lightEvery, intervalFor, windowMs, judge,
  roundOf, createPattern,
} from '../rhythm_beat.js';

export const GAME = 'rhythm';
export const SCORE_LABEL = 'Rhythm: on the beat';

// The line under the tiles changes no more often than this (three a second, with a margin), so a
// burst of presses cannot make text flicker. The last word is shown when the gap allows.
export const STATUS_GAP_MS = 350;
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
  startOn: 'press',
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
    note: `Never faster than ${MAX_BPM} a minute: the tiles must not flash more than three times a second.` },
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
  { key: 'startOn', label: 'The beat starts', kind: 'choice', default: 'press', level: 'advanced',
    options: [{ value: 'press', label: 'On the first press' }, { value: 'open', label: 'As soon as it is on the screen' }] },
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
      + 'Slow and forgiving by default, and never flashes more than three times a second.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
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

    const now = () => clock.now();
    const beatAt = (k) => run.origin + k * run.interval;
    const tempoNow = () => {
      if (cfg.beatFrom === 'screen' && screenTempo) {
        const every = lightEvery(screenTempo.bpm);
        return { bpm: screenTempo.bpm / every, origin: screenTempo.origin, meter: screenTempo.meter || 4, every };
      }
      return { bpm: clampBpm(cfg.tempo), origin: null, meter: 4, every: 1 };
    };

    // ---- the line under the tiles, never more than three changes a second ----------------------
    function wantStatus(text) {
      statusWant = text;
      flushStatus();
    }
    function flushStatus() {
      if (statusWant === status || !sayEl) return;
      const t = now();
      if (t - statusAt < STATUS_GAP_MS) return;          // shown on a later frame
      status = statusWant; statusAt = t;
      sayEl.textContent = status;
    }

    // ---- sound -------------------------------------------------------------------------------------
    function scheduleClicks(t) {
      if (!run || !armed || cfg.sound === 'off' || !tones) return;
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
    function start() {
      if (dead) return;
      const tp = tempoNow();
      const interval = 60000 / tp.bpm;
      const t = now();
      let origin, k0;
      if (tp.origin != null) {
        // Follow the screen's grid: this run's first beat is the next of ITS beats (every nth).
        origin = tp.origin; k0 = Math.floor((t - origin) / interval) + 1;
      } else { origin = t + interval; k0 = 0; }   // own beat: the first one a beat from now
      run = { origin, interval, k0, meter: Math.max(1, Math.round(tp.meter / tp.every)) || 4,
        tileOf: createPattern(cfg.pattern, cfg.tiles, Math.floor(rand() * 1e9) + 1) };
      lastSeen = k0 - 1; lastSounded = k0 - 1;
      judged = new Map(); round = null; lit = null; streak = 0; quietBeats = 0;
      tones?.setActive(armed && cfg.sound !== 'off');
      render('start');
      ensureLoop();
    }
    function stop(reason = '') {
      run = null; lit = null; round = null;
      stopLoop();
      tones?.setActive(false);
      render(reason);
      ensureLoop();                  // only if the words under the tiles are still waiting their turn
    }
    const restart = () => { if (run) { const a = armed; stop(); armed = a; start(); } };

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
      if (run) {
        const win = windowMs(cfg.window, run.interval);
        // beats that have started since the last look
        const kNow = Math.floor((t - run.origin) / run.interval);
        for (let k = lastSeen + 1; k <= kNow && run; k++) onBeat(k, t);
        if (!run) { render(); return; }            // a round with nobody in it stopped the beat
        lastSeen = Math.max(lastSeen, kNow);
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
        if (!(round.beats > 0)) {
          quietBeats++;
          if (cfg.stopWhenIdle && quietBeats > IDLE_BEATS) { stop('idle'); return; }
        }
      }
      if (info.phase === 'rest' && info.beat === 0 && round) endRound();
    }

    function endRound() {
      const r = round;
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
      if (!armed) { armed = true; tones?.resume(); if (run) tones?.setActive(cfg.sound !== 'off'); }
      quietBeats = 0;
      if (!run) { start(); return; }
      const t = now();
      tick(t);                       // catch up first, so the press is judged against the beat as it is now
      if (!run) { start(); return; }
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
        if (cfg.hitSound && tones) tones.tone(HIT_BLIP.f, HIT_BLIP.ms, { type: 'sine', level: 0.5 });
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
      }
      // The hit mark is itself a change on the screen, so it keeps the same three-a-second rule as
      // the lights: at the fastest tempos a hit whose mark would come too soon after the last one is
      // still counted, sounded and tallied - it just does not draw a mark.
      const tNow = now();
      if (lit && judged.get(lit.k) === 'hit' && markedK !== lit.k && tNow - lastMarkAt >= STATUS_GAP_MS) {
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
      if (!run) {
        if (reason || !status) {
          wantStatus(lastResult ? `${lastResult.hits} of ${lastResult.beats} on the beat. Press to play again.`
            : (reason === 'back' ? 'Stopped. Press to start the beat again.' : 'Press to start the beat.'));
        }
      } else if (lastSeen < run.k0 && reason === 'start') wantStatus('Get ready…');
      flushStatus();
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
        judged: new Map(judged), stats: { ...stats }, tones: tones?.state() || null }),
      __tick: () => { if (!dead) tick(now()); },
      init() {
        let cssHref = '';
        try { cssHref = new URL('../rhythm.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-rh-css href="${esc(cssHref)}">` : ''}`
          + '<div class="rh-wrap" data-rh-root><div class="rh" data-rh>'
          + '<div class="rh-tiles" data-tiles></div>'
          + '<div class="rh-bar"><p class="rh-say" role="status" aria-live="polite"></p><p class="rh-score" data-score hidden></p></div>'
          + '</div></div>';
        rootEl = mount.querySelector('[data-rh-root]');
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
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          if (tileEls.length && Number(next.tiles) !== tileEls.length) { tileEls = []; }
          return ['tempo', 'tiles', 'pattern', 'beatFrom', 'countIn', 'roundBeats', 'restBeats']
            .some((k) => next[k] !== was[k]);
        };
        applyCfg(state?.get?.());
        state?.subscribe?.((s) => { if (applyCfg(s)) restart(); tones?.setActive(!!run && armed && cfg.sound !== 'off'); render(); });

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
        bus.subscribe(`${GAME}/back`, () => { if (run) stop('back'); });

        render();
        if (cfg.startOn === 'open') start();
      },
      onResize() {},
      onHide() { hidden = true; if (run) stop('hidden'); try { state?.flush?.(); } catch { /* nothing */ } },
      onShow() { hidden = false; render(); },
      destroy() {
        dead = true;
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
