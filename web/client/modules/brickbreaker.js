// modules/brickbreaker.js — BRICK-BREAKER, PLAYABLE ON ONE SWITCH.
//
// Row 2.37 item 10 (MIKE_CHANGE_LIST.md, private repo; room_as_home_20260930.md §7): *"Floor tiles
// and bricks can be used for rhythm and brick-breaker games."* Built standalone first; the bricks
// are drawn from theme custom properties (`--wall-brick`, `--wall-mortar`) so that when this is
// placed on the room's wall, the room sets two properties and the wall IS the game. The rules and
// the physics are `../breakout.js`; this file is the panel.
//
// *** THE ONE-SWITCH SCHEME, ARGUED (the default is `sweep`). ***
// Three ways one press can play brick-breaker; all three are built, and `control` picks:
//   sweep  (DEFAULT) The paddle glides back and forth by itself. A press STOPS it; the next press
//          starts it again - heading TOWARD THE BALL, so one press means "go and get it" and the
//          next means "stop here". The player makes one real decision per ball: where to stop.
//   steps  Nothing moves until told: next / prev move the paddle a step, select launches. For two
//          switches, arrow keys, or somebody who wants no timing at all.
//   follow The paddle catches every ball by itself; a press changes WHERE on the paddle it lands
//          (left, straight, right), which steers the rebound. Cause and effect with no failing.
// FOR `sweep` as the default: it is the only one of the three where a single switch makes a
// decision that matters, which is the difference between playing and watching. The ball is slow by
// default (breakout.js BALL_SPEEDS) and the paddle is wide, so the decision is not a race. And
// "toward the ball" on restart removes the worst case of a sweep (the paddle heading the wrong way
// with no switch to turn it round).
// AGAINST: timing is the hardest thing a switch asks for - switch users often take half a second or
// more from deciding to the press landing, and after a brain injury that can be longer and less
// steady. For them `sweep` is a game of misses, which is why missing costs nothing here (below),
// why sweep speed is its own setting, and why `follow` exists. If Mike's first user cannot time a
// press, `follow` is the better default for them - but a default is for somebody nobody has met yet.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. ***
//   * Lives are OFF by default: a missed ball comes back to the paddle and goes again by itself
//     after a few seconds (a setting; 0 = only on a press). With lives on, running out shows
//     "Again!" beside the field for REST_MS and a new game starts by itself; a press starts it at once.
//   * A cleared wall says "Wall down!" for REST_MS and the next wall goes up by itself.
//   * A GAME NOBODY IS PLAYING COMES TO REST. It starts still (the first press launches), and after
//     IDLE_BALLS balls in a row are lost with no press in between, it stops launching and the sweep
//     stops: an empty room does not get a ball bouncing forever. The next press picks it up again.
//     That is inaction, not a gate - nothing on the panel is waiting behind a press but the game.
//   * No sound before the first press, and music only while somebody is playing.
//
// THE SCORE is bricks broken this game, on the score contract (`../score_source.js`); drawn here
// only when no scoreboard shows it. A cleared wall pays NOTHING by default (see `wallPoints`).

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { createGameMusic } from '../game_music.js';
import {
  FIELD_W, FIELD_H, BALL_R, PADDLE_H, PADDLE_Y, BALL_SPEEDS, PADDLE_WIDTHS, SWEEP_SPEEDS, STEP_SIZES,
  CONTROLS, newGame, launch, step, setPaddleX, nudgePaddle, landingX, togglePause, nextWall, aliveCount,
} from '../breakout.js';

export const GAME = 'brickbreaker';
export const SCORE_LABEL = 'Brick breaker: bricks';

// "Wall down!" / "Again!" stay up this long before the next wall starts by itself. Long enough to
// read a short line at kiosk distance; short enough not to feel like a screen you have to get past.
// A press skips it. Argued, not a setting: nobody's play changes with it.
export const REST_MS = 3000;
// A game nobody is playing comes to rest after this many balls lost in a row with no press. Three,
// not one: a single miss is ordinary play, and somebody thinking between presses must not have
// the game stop under them. Argued, not a setting; on Mike's list.
export const IDLE_BALLS = 3;

export const DEFAULTS = Object.freeze({
  control: 'sweep',
  ballSpeed: 'slow',
  paddleWidth: 'wide',
  sweepSpeed: 'slow',
  restart: 'toward',
  stepSize: 'medium',
  autoLaunch: 3,          // seconds a resting ball waits before it goes by itself; 0 = only on a press
  lives: 0,               // 0 = off
  rows: 4,
  cols: 8,
  sounds: true,
  music: 'ambient',       // Mike, 2026-08-29: "The games should still have music."
  musicVolume: 0.3,
  // *** A CLEARED WALL PAYS NOTHING BY DEFAULT. *** Both sides:
  //   FOR paying: a cleared wall is a real result, and comet and the press games pay Play points.
  //   AGAINST, and it wins for the default: points.js pays for achievement, not time. With lives off
  //   and the ball coming back forever, every wall falls eventually to anybody who keeps the panel
  //   open - and in `follow` mode nobody even has to catch. That is paying for time.
  //   So a setting pays a set number of Play points per wall; a family that wants it turns it on.
  wallPoints: 0,
});

const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Bricks broken this game. A Scoreboard on the same screen can show it instead.' }),
  { key: 'control', label: 'How the paddle moves', kind: 'choice', default: 'sweep', level: 'essential',
    options: [
      { value: 'sweep', label: 'It glides by itself; a press stops it and starts it (one switch)' },
      { value: 'steps', label: 'Next and previous move it a step; select launches' },
      { value: 'follow', label: 'It catches every ball; a press changes the angle' },
    ],
    note: 'A pointer can always move the paddle, and a click is a press.' },
  { key: 'ballSpeed', label: 'Ball speed', kind: 'choice', default: 'slow', level: 'essential',
    options: [
      { value: 'very-slow', label: 'Very slow' }, { value: 'slow', label: 'Slow' },
      { value: 'medium', label: 'Medium' }, { value: 'fast', label: 'Fast' },
    ] },
  { key: 'paddleWidth', label: 'Paddle', kind: 'choice', default: 'wide', level: 'standard',
    options: [{ value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }, { value: 'very-wide', label: 'Very wide' }] },
  { key: 'sweepSpeed', label: 'How fast the paddle glides', kind: 'choice', default: 'slow', level: 'standard',
    options: [{ value: 'slow', label: 'Slow' }, { value: 'medium', label: 'Medium' }, { value: 'fast', label: 'Fast' }],
    note: 'Only when it glides by itself.' },
  { key: 'restart', label: 'When the paddle starts again', kind: 'choice', default: 'toward', level: 'standard',
    options: [{ value: 'toward', label: 'It heads toward the ball' }, { value: 'onward', label: 'It carries on the way it was going' }],
    note: 'Only when it glides by itself.' },
  { key: 'stepSize', label: 'How far one press moves the paddle', kind: 'choice', default: 'medium', level: 'standard',
    options: [{ value: 'small', label: 'A little' }, { value: 'medium', label: 'Some' }, { value: 'large', label: 'A lot' }] },
  { key: 'autoLaunch', label: 'A ball on the paddle goes by itself after', kind: 'choice', default: 3, level: 'standard',
    options: [{ value: 0, label: 'Never: only on a press' }, { value: 2, label: '2 seconds' }, { value: 3, label: '3 seconds' },
      { value: 5, label: '5 seconds' }, { value: 8, label: '8 seconds' }] },
  { key: 'lives', label: 'Balls per game', kind: 'choice', default: 0, level: 'standard',
    options: [{ value: 0, label: 'As many as you like' }, { value: 3, label: '3, then it starts again' }, { value: 5, label: '5, then it starts again' }] },
  { key: 'rows', label: 'Rows of bricks', kind: 'choice', default: 4, level: 'advanced',
    options: [2, 3, 4, 5, 6].map((v) => ({ value: v, label: String(v) })), note: 'Starts with the next wall.' },
  { key: 'cols', label: 'Bricks across', kind: 'choice', default: 8, level: 'advanced',
    options: [5, 6, 8, 10].map((v) => ({ value: v, label: String(v) })), note: 'Starts with the next wall.' },
  { key: 'sounds', label: 'Bounce sounds', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'music', label: 'Music', kind: 'choice', default: 'ambient', level: 'standard',
    options: [{ value: 'ambient', label: 'Quiet background music' }, { value: 'off', label: 'No music' }] },
  { key: 'musicVolume', label: 'How loud the music is', kind: 'choice', default: 0.3, level: 'advanced',
    options: [{ value: 0.15, label: 'Very quiet' }, { value: 0.3, label: 'Quiet' }, { value: 0.5, label: 'Medium' }] },
  { key: 'wallPoints', label: 'Play points for a wall knocked down', kind: 'number', default: 0, min: 0, max: 20, step: 1,
    level: 'advanced', note: '0 means walls pay nothing. With the ball coming back forever, any wall falls in the end.' },
];

// Sounds: a pitch per event, low enough to sit under a voice. Argued constants, not settings - the
// setting is whether there are sounds at all.
const TONES = { paddle: [330, 70, 'triangle'], wall: [262, 40, 'sine'], brick: [523, 60, 'square'],
  miss: [165, 220, 'sine'], cleared: [659, 260, 'triangle'] };

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v, of) => `${((v / of) * 100).toFixed(3)}%`;
const pick = (v, table, dflt) => (Object.prototype.hasOwnProperty.call(table, v) ? table[v] : table[dflt]);

/** The one line under the field, for a phase. Exported so the suite reads it without a DOM. */
export function statusFor(g, { control = 'sweep', idle = false, autoLaunch = 3 } = {}) {
  switch (g.phase) {
    case 'paused': return 'Paused. Press to go on.';
    case 'cleared': return 'Wall down! A new wall is going up.';
    case 'again': return 'Again! A new game is starting.';
    case 'ready':
      if (idle) return 'Press to play.';
      return autoLaunch > 0 ? 'Press to launch, or it goes by itself.' : 'Press to launch.';
    default:
      if (control === 'sweep') return g.paddle.moving ? 'Press to stop the paddle.' : 'Press to move the paddle.';
      if (control === 'follow') return 'Press to change the angle.';
      return 'Move the paddle with next and previous.';
  }
}

registerModule(
  { type: GAME, title: 'Brick breaker', core: 'new',
    description: 'Knock down a wall of bricks with a ball and a paddle. One switch can play: the paddle '
      + 'glides by itself and a press stops it. Slow by default, and a missed ball just comes back.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const audio = ctx.audio || null;
    const rand = ctx.rand || Math.random;
    // THE CLOCK IS INJECTABLE. A hidden document never runs requestAnimationFrame, so a suite hands
    // in `{ now, request, cancel }` and steps it; the real page uses animation frames.
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

    let cfg = { ...DEFAULTS };
    let g = null;
    let idle = true;              // nobody has pressed since the game came to rest
    let missesSinceInput = 0;
    let armed = false;            // a press has happened on this mount: sound may start
    let stats = { best: 0, walls: 0 };
    let loopHandle = null;
    let last = null;
    let dead = false;
    let hidden = false;
    let rootEl = null, fieldEl = null, ballEl = null, paddleEl = null, sayEl = null, scoreEl = null, aimEl = null;
    let brickEls = new Map();
    let drawnBricks = null;
    let lastSay = '', lastScore = '';
    let score = null, ledger = null, tones = null, music = null;

    const opts = () => ({
      speed: pick(cfg.ballSpeed, BALL_SPEEDS, 'slow'),
      sweep: pick(cfg.sweepSpeed, SWEEP_SPEEDS, 'slow'),
      control: CONTROLS.includes(cfg.control) ? cfg.control : 'sweep',
      autoLaunchMs: Math.max(0, Number(cfg.autoLaunch) || 0) * 1000,
      restMs: REST_MS,
      idle,
      rand,
    });

    // ---- sound ------------------------------------------------------------------------------
    function sound(ev) {
      if (!cfg.sounds || !armed || !tones) return;
      const t = TONES[ev];
      if (t) tones.tone(t[0], t[1], { type: t[2], level: 0.7 });
    }
    function syncAudio() {
      const playing = !dead && !hidden && armed && g && g.phase !== 'paused' && !idle;
      tones?.setActive(playing && g.phase === 'play' && !!cfg.sounds);
      try {
        if (playing && cfg.music !== 'off') music?.play();
        else music?.pause();
      } catch { /* a bed is not worth an exception */ }
    }

    // ---- saving: the totals only. A ball's position means nothing after a reload. ------------
    function save() { try { state?.set?.({ stats }); } catch (err) { console.error('brickbreaker: save', err); } }

    // ---- the loop: runs only while something is moving ---------------------------------------
    function needsFrames() {
      if (dead || hidden || !g) return false;
      if (g.phase === 'paused') return false;
      if (g.phase === 'play' || g.phase === 'cleared' || g.phase === 'again') return true;
      // ready: a sweeping paddle, or a ball about to go by itself
      if (cfg.control === 'sweep' && g.paddle.moving) return true;
      return !idle && Number(cfg.autoLaunch) > 0;
    }
    function ensureLoop() {
      if (loopHandle != null || !needsFrames()) return;
      last = null;
      loopHandle = clock.request(frame);
    }
    function stopLoop() {
      if (loopHandle != null) { try { clock.cancel(loopHandle); } catch { /* gone */ } }
      loopHandle = null; last = null;
    }
    function frame() {
      loopHandle = null;
      if (dead) return;
      const t = clock.now();
      const dt = last == null ? 0 : t - last;
      last = t;
      advance(dt);
      if (needsFrames()) { loopHandle = clock.request(frame); } else last = null;
    }

    function advance(dt) {
      const before = g.phase;
      const events = step(g, dt, opts());
      for (const ev of events) {
        sound(ev);
        if (ev === 'miss') {
          missesSinceInput++;
          if (missesSinceInput >= IDLE_BALLS) { idle = true; g.paddle.moving = false; }
        }
        if (ev === 'cleared') {
          stats = { ...stats, walls: (Number(stats.walls) || 0) + 1 };
          pay();
        }
        if (ev === 'brick' && g.broken > (Number(stats.best) || 0)) stats = { ...stats, best: g.broken };
      }
      if (events.includes('cleared') || events.includes('again')) save();
      if (before !== g.phase || events.length) syncAudio();
      render();
      return events;
    }

    function pay() {
      const n = Math.round(Number(cfg.wallPoints) || 0);
      if (!(n > 0) || !ledger) return;
      Promise.resolve(ledger.award({ amount: n, source: GAME, type: 'Play', tags: [GAME],
        note: 'Brick breaker: a wall knocked down' })).catch((err) => console.error('brickbreaker: points', err));
    }

    // ---- presses ------------------------------------------------------------------------------
    function markInput() {
      idle = false; missesSinceInput = 0;
      if (!armed) { armed = true; tones?.resume(); }
    }
    function select() {
      if (dead) return;
      markInput();
      const o = opts();
      if (g.phase === 'paused') togglePause(g);
      else if (g.phase === 'ready') {
        launch(g, { speed: o.speed, rand, control: o.control });
        if (o.control === 'sweep') g.paddle.moving = true;
      } else if (g.phase === 'cleared' || g.phase === 'again') nextWall(g);
      else if (g.phase === 'play') {
        if (o.control === 'sweep') {
          const p = g.paddle;
          if (p.moving) p.moving = false;
          else {
            if (cfg.restart !== 'onward') {
              const target = landingX(g) ?? g.ball.x;
              if (Math.abs(target - p.x) > 0.5) p.dir = target > p.x ? 1 : -1;
            }
            p.moving = true;
          }
        } else if (o.control === 'follow') {
          g.aim = g.aim === 0 ? 1 : (g.aim === 1 ? -1 : 0);
        }
      }
      syncAudio(); render(); ensureLoop();
    }
    function nudge(dir) {
      if (dead) return;
      markInput();
      if (g.phase === 'paused') return;
      if (cfg.control === 'follow') g.aim = dir;
      else {
        g.paddle.moving = false;
        nudgePaddle(g, dir * pick(cfg.stepSize, STEP_SIZES, 'medium'));
      }
      syncAudio(); render(); ensureLoop();
    }
    function back() {
      if (dead) return;
      markInput();
      togglePause(g);
      syncAudio(); render();
      if (g.phase === 'paused') stopLoop(); else ensureLoop();
    }

    // ---- pointer ----------------------------------------------------------------------------------
    function fieldX(e) {
      if (!fieldEl) return null;
      const r = fieldEl.getBoundingClientRect();
      if (!(r.width > 0)) return null;
      return ((e.clientX - r.left) / r.width) * FIELD_W;
    }
    function onPointerMove(e) {
      if (dead || cfg.control === 'follow' || !g || g.phase === 'paused') return;
      const x = fieldX(e);
      if (x == null) return;
      missesSinceInput = 0;
      g.paddle.moving = false;
      setPaddleX(g, x);
      render();
    }
    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      if (cfg.control !== 'follow') { const x = fieldX(e); if (x != null && g.phase !== 'paused') setPaddleX(g, x); }
      select();
      // select() starts a sweep on launch; a pointer is holding the paddle, so it stays put.
      if (cfg.control === 'sweep') g.paddle.moving = false;
    }

    // ---- drawing ---------------------------------------------------------------------------------
    function buildField() {
      if (!fieldEl) return;
      const bricks = g.bricks.map((b) => `<div class="bb-brick" data-id="${esc(b.id)}" data-row="${b.row % 4}"`
        + ` style="left:${pct(b.x, FIELD_W)};top:${pct(b.y, FIELD_H)};width:${pct(b.w, FIELD_W)};height:${pct(b.h, FIELD_H)}"></div>`).join('');
      fieldEl.innerHTML = `${bricks}<div class="bb-paddle" data-paddle><span class="bb-aim" data-aim aria-hidden="true"></span></div>`
        + '<div class="bb-ball" data-ball></div>';
      brickEls = new Map([...fieldEl.querySelectorAll('.bb-brick')].map((el) => [el.dataset.id, el]));
      ballEl = fieldEl.querySelector('[data-ball]');
      paddleEl = fieldEl.querySelector('[data-paddle]');
      aimEl = fieldEl.querySelector('[data-aim]');
      drawnBricks = g.bricks;
    }
    function render() {
      if (dead || !rootEl || !g) return;
      if (drawnBricks !== g.bricks) buildField();
      const bb = rootEl.querySelector('[data-bb]');
      if (bb) {
        bb.dataset.phase = g.phase;
        bb.dataset.control = cfg.control;
        bb.dataset.motion = reducedMotion() ? 'reduce' : 'full';
      }
      for (const b of g.bricks) {
        const el = brickEls.get(b.id);
        if (el && el.hidden === b.alive) el.hidden = !b.alive;
      }
      const p = g.paddle;
      if (paddleEl) {
        paddleEl.style.left = pct(p.x - p.w / 2, FIELD_W);
        paddleEl.style.top = pct(PADDLE_Y, FIELD_H);
        paddleEl.style.width = pct(p.w, FIELD_W);
        paddleEl.style.height = pct(PADDLE_H, FIELD_H);
        paddleEl.dataset.moving = p.moving ? '1' : '0';
      }
      if (aimEl) {
        // The aim is an arrow AND a word, not a colour: '↖ left', '↑ straight', '↗ right'.
        const show = cfg.control === 'follow';
        aimEl.hidden = !show;
        if (show) aimEl.textContent = g.aim < 0 ? '↖ left' : (g.aim > 0 ? '↗ right' : '↑ straight');
      }
      if (ballEl) {
        ballEl.style.left = pct(g.ball.x - BALL_R, FIELD_W);
        ballEl.style.top = pct(g.ball.y - BALL_R, FIELD_H);
        ballEl.style.width = pct(BALL_R * 2, FIELD_W);
        ballEl.style.height = pct(BALL_R * 2, FIELD_H);
        ballEl.hidden = g.phase === 'cleared' || g.phase === 'again';
      }
      const line = statusFor(g, { control: cfg.control, idle, autoLaunch: Number(cfg.autoLaunch) || 0 });
      if (sayEl && line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const lives = g.livesLeft != null ? ` · Balls left: ${g.livesLeft}` : '';
      const txt = own ? `Bricks: ${g.broken}${g.walls ? ` · Walls down: ${g.walls}` : ''}${lives}` : '';
      if (scoreEl && txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      try {
        score?.set(g.broken, { detail: `Walls down: ${g.walls} · Best: ${Math.max(Number(stats.best) || 0, g.broken)}` });
      } catch (err) { console.error('brickbreaker: score', err); }
    }

    function fresh() {
      g = newGame({ rows: cfg.rows, cols: cfg.cols, paddle: cfg.paddleWidth, lives: cfg.lives });
      idle = true; missesSinceInput = 0;
    }

    return {
      __probe: () => ({ game: g, cfg: { ...cfg }, idle, armed, missesSinceInput, looping: loopHandle != null,
        stats: { ...stats }, tones: tones?.state() || null, music: music?.state() || null }),
      // The suite's handle on time: advance the game by `dt` ms exactly as a frame would.
      __step: (dt) => (dead ? [] : advance(dt)),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../brickbreaker.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-bb-css href="${esc(cssHref)}">` : ''}`
          + '<div class="bb-wrap" data-bb-root><div class="bb" data-bb>'
          + '<div class="bb-stage"><div class="bb-field" data-field role="img" aria-label="A wall of bricks, a ball and a paddle"></div></div>'
          + '<div class="bb-bar"><p class="bb-say" role="status" aria-live="polite"></p><p class="bb-score" data-score hidden></p></div>'
          + '</div></div>';
        rootEl = mount.querySelector('[data-bb-root]');
        fieldEl = mount.querySelector('[data-field]');
        sayEl = mount.querySelector('.bb-say');
        scoreEl = mount.querySelector('[data-score]');
        mount.addEventListener('pointermove', onPointerMove);
        mount.addEventListener('pointerdown', onPointerDown);

        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('brickbreaker: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null,
          onShownChange: () => render() });
        const id = ctx.instanceId || 'bb';
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
          if (s.ownScore !== undefined) next.ownScore = s.ownScore;
          cfg = next;
          if (s.stats && typeof s.stats === 'object') stats = { ...stats, ...s.stats };
          if (g && next.paddleWidth !== was.paddleWidth) { g.paddle.w = pick(next.paddleWidth, PADDLE_WIDTHS, 'wide'); setPaddleX(g, g.paddle.x); }
          if (g) { g.rows = next.rows; g.cols = next.cols; }
          if (g && next.lives !== was.lives) {
            const n = Number(next.lives) > 0 ? Math.round(Number(next.lives)) : null;
            g.startLives = n; g.livesLeft = n;
          }
          try { music?.setVolume(next.musicVolume); if (next.music === 'off') music?.off(); else if (was.music === 'off' || !g) music?.useAmbient(); } catch { /* quiet */ }
        };
        applyCfg(state?.get?.());
        fresh();
        state?.subscribe?.((s) => { applyCfg(s); syncAudio(); render(); ensureLoop(); });

        bus.subscribe(`${GAME}/next`, () => nudge(1));
        bus.subscribe(`${GAME}/prev`, () => nudge(-1));
        bus.subscribe(`${GAME}/select`, () => select());
        bus.subscribe(`${GAME}/back`, () => back());
        // A fresh game (the suite, or anything that wants to hand somebody a new wall).
        bus.subscribe(`${GAME}/new`, () => { fresh(); stopLoop(); syncAudio(); render(); });

        render();
      },
      onResize() { render(); },
      onHide() {
        hidden = true;
        if (g && g.phase === 'play') togglePause(g);   // somebody coming back finds it paused, not lost
        stopLoop(); syncAudio(); render();
        try { state?.flush?.(); } catch { /* nothing to do */ }
      },
      onShow() { hidden = false; syncAudio(); render(); ensureLoop(); },
      destroy() {
        dead = true;
        stopLoop();
        mount.removeEventListener('pointermove', onPointerMove);
        mount.removeEventListener('pointerdown', onPointerDown);
        try { tones?.destroy(); } catch { /* gone */ }
        tones = null;
        try { music?.destroy(); } catch { /* gone */ }
        music = null;
        try { score?.destroy(); } catch { /* gone */ }
        score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  },
);

export { FIELD_W, FIELD_H, aliveCount };
