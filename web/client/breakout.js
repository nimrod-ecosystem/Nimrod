// breakout.js — THE RULES AND THE PHYSICS OF BRICK-BREAKER, with no DOM and no clock of its own.
//
// Row 2.37 item 10 ("Rhythm and brick-breaker games on floor tiles and bricks", MIKE_CHANGE_LIST.md,
// private repo; room_as_home_20260930.md §7). `modules/brickbreaker.js` is the panel; this file is
// what it asks. Split the way klondike.js / solitaire.js are, for the same reason: the suite can
// step a game a thousand times a second with no browser frame in the way (the headless test browser
// is a hidden document where requestAnimationFrame never fires, so NOTHING here waits for one).
//
// EVERYTHING IS IN FIELD UNITS: the field is FIELD_W (100) wide and FIELD_H (62.5) tall - 16:10,
// the shape of a wall panel and near enough to a quarter of a 1080p screen. The panel scales it.
// Speeds are field units per second, times are milliseconds.
//
// `step(g, dt, opts)` MUTATES `g` and returns what happened (['paddle', 'brick', 'miss', ...]).
// Mutating rather than copying is deliberate: this runs every frame on a Pi 400, and a game state
// is one object that nothing else holds.

export const FIELD_W = 100;
export const FIELD_H = 62.5;

// ---- the settings' values, named here so the module and the suite read the same numbers ---------
// Ball speed, field units per second. SLOW IS THE DEFAULT (the module's DEFAULTS): at 28 a ball
// takes about two seconds to fall the height of the field, which leaves a one-switch player time
// to see where it is going and press. 'fast' is still slower than most commercial breakouts.
export const BALL_SPEEDS = Object.freeze({ 'very-slow': 18, slow: 28, medium: 42, fast: 60 });
// Paddle width, field units (of 100). Wide by default: a miss is gentle here, but a catch is the fun.
export const PADDLE_WIDTHS = Object.freeze({ normal: 18, wide: 26, 'very-wide': 38 });
// How fast the sweeping paddle glides, field units per second (one-switch play).
export const SWEEP_SPEEDS = Object.freeze({ slow: 22, medium: 34, fast: 50 });
// How far one next/prev press moves the paddle, field units.
export const STEP_SIZES = Object.freeze({ small: 6, medium: 10, large: 16 });
export const CONTROLS = Object.freeze(['sweep', 'steps', 'follow']);

// ---- constants that are NOT settings, each argued -------------------------------------------------
export const BALL_R = 1.6;        // big enough to follow at kiosk distance; small enough to fit between bricks
export const PADDLE_H = 2.2;
export const PADDLE_Y = FIELD_H - 5;   // the paddle's top edge: a margin under it so a miss is SEEN going past
// The steepest rebound off the paddle's end, from straight up. 60 degrees is the classic value: any
// wider and a ball can skim sideways for seconds, which reads as "nothing is happening".
export const MAX_BOUNCE = Math.PI / 3;
// NEVER-ENDING LOOPS ARE REFUSED. A ball going straight up and down between the paddle and an empty
// column, or skimming almost flat between the walls, would play forever without anything changing.
// So after every bounce a ball keeps at least 12% of its speed sideways and 35% up or down.
export const MIN_VX_FRAC = 0.12;
export const MIN_VY_FRAC = 0.35;
// The wall: rows of bricks laid IN A RUNNING BOND (every other row shifted half a brick, with half
// bricks at the ends), because these are going to be the room's own wall bricks and a wall of
// stacked rectangles is not what a brick wall looks like. Not a setting: it changes nothing about
// how the game plays, only whether it looks like a wall.
const WALL_TOP = 6, WALL_SIDE = 3, BRICK_GAP = 0.8, BRICK_H = 3.4;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Bricks for one wall. `rows` of `cols` whole bricks; odd rows are shifted half a brick. */
export function makeWall({ rows = 4, cols = 8 } = {}) {
  const r = clamp(Math.round(Number(rows) || 4), 1, 8);
  const c = clamp(Math.round(Number(cols) || 8), 2, 12);
  const bw = (FIELD_W - 2 * WALL_SIDE - (c - 1) * BRICK_GAP) / c;
  const pitch = bw + BRICK_GAP;
  const left = WALL_SIDE, right = FIELD_W - WALL_SIDE;
  const bricks = [];
  for (let row = 0; row < r; row++) {
    const y = WALL_TOP + row * (BRICK_H + BRICK_GAP);
    const shift = row % 2 ? -pitch / 2 : 0;
    let col = 0;
    for (let i = 0; i <= c; i++) {
      let x0 = left + shift + i * pitch;
      let x1 = x0 + bw;
      x0 = Math.max(x0, left); x1 = Math.min(x1, right);
      if (x1 - x0 < bw * 0.3) continue;          // a sliver is not a brick
      bricks.push({ id: `${row}.${col}`, row, col, x: x0, y, w: x1 - x0, h: BRICK_H, alive: true });
      col++;
    }
  }
  return bricks;
}

export const aliveCount = (g) => g.bricks.reduce((n, b) => n + (b.alive ? 1 : 0), 0);

/** A new game: a full wall, the ball resting on a still paddle, nothing moving until somebody presses. */
export function newGame({ rows = 4, cols = 8, paddle = 'wide', lives = 0 } = {}) {
  const w = PADDLE_WIDTHS[paddle] || PADDLE_WIDTHS.wide;
  const g = {
    bricks: makeWall({ rows, cols }),
    rows, cols,
    paddle: { x: FIELD_W / 2, w, dir: 1, moving: false },
    ball: { x: FIELD_W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, r: BALL_R },
    phase: 'ready',          // ready | play | cleared | again | paused
    before: null,            // the phase a pause interrupted
    wait: 0,                 // ms until the phase moves on by itself (ready: auto-launch; cleared/again: next wall)
    broken: 0,               // bricks broken this game (the score)
    walls: 0,                // walls cleared this game
    misses: 0,
    catches: 0,
    livesLeft: Number(lives) > 0 ? Math.round(Number(lives)) : null,   // null = lives off
    aim: 0,                  // follow mode: -1 left, 0 straight, 1 right
  };
  g.startLives = g.livesLeft;
  return g;
}

function restOnPaddle(g) {
  g.ball.x = clamp(g.paddle.x, BALL_R, FIELD_W - BALL_R);
  g.ball.y = PADDLE_Y - BALL_R;
  g.ball.vx = 0; g.ball.vy = 0;
}

/** Launch the resting ball. The angle comes from the aim in follow mode, else a gentle random lean. */
export function launch(g, { speed = BALL_SPEEDS.slow, rand = Math.random, control = 'sweep' } = {}) {
  if (g.phase !== 'ready') return false;
  let a;
  if (control === 'follow' && g.aim) a = g.aim * (MAX_BOUNCE * 0.6);
  else {
    const side = rand() < 0.5 ? -1 : 1;
    a = side * (0.25 + rand() * 0.35);           // 14 to 34 degrees off vertical
  }
  g.ball.vx = Math.sin(a) * speed;
  g.ball.vy = -Math.cos(a) * speed;
  g.phase = 'play';
  g.wait = 0;
  return true;
}

// Keep a moving ball at the current speed, and out of the never-ending loops above.
function normalizeBall(g, speed) {
  const b = g.ball;
  let m = Math.hypot(b.vx, b.vy);
  if (!(m > 0)) return;
  b.vx = (b.vx / m) * speed; b.vy = (b.vy / m) * speed;
  const minX = MIN_VX_FRAC * speed, minY = MIN_VY_FRAC * speed;
  if (Math.abs(b.vy) < minY) {
    b.vy = (b.vy < 0 ? -1 : 1) * minY;
    b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(Math.max(0, speed * speed - minY * minY));
  }
  if (Math.abs(b.vx) < minX) {
    // Push it toward the middle of the field - deterministic, and away from the nearer wall.
    const dir = b.x < FIELD_W / 2 ? 1 : -1;
    b.vx = dir * minX;
    b.vy = (b.vy < 0 ? -1 : 1) * Math.sqrt(Math.max(0, speed * speed - minX * minX));
  }
}

function paddleBounds(g) { const h = g.paddle.w / 2; return [h, FIELD_W - h]; }

/** Put the paddle's centre at x (a pointer). Clamped to the field. */
export function setPaddleX(g, x) {
  const [lo, hi] = paddleBounds(g);
  const n = Number(x);
  if (!Number.isFinite(n)) return;
  g.paddle.x = clamp(n, lo, hi);
  if (g.phase === 'ready') restOnPaddle(g);
}

/** Move the paddle by dx (a next/prev press). */
export function nudgePaddle(g, dx) { setPaddleX(g, g.paddle.x + dx); }

// Where a falling ball will cross the paddle's line, bouncing off the side walls on the way.
// Used by follow mode (and by the suite's one-switch player). Null while the ball is going up.
export function landingX(g) {
  const b = g.ball;
  if (!(b.vy > 0)) return null;
  const t = (PADDLE_Y - BALL_R - b.y) / b.vy;
  if (t < 0) return b.x;
  const span = FIELD_W - 2 * BALL_R;
  let x = (b.x - BALL_R) + b.vx * t;
  x = ((x % (2 * span)) + 2 * span) % (2 * span);
  if (x > span) x = 2 * span - x;
  return x + BALL_R;
}

/** Pause, or go on from a pause. */
export function togglePause(g) {
  if (g.phase === 'paused') { g.phase = g.before || 'ready'; g.before = null; return false; }
  g.before = g.phase; g.phase = 'paused';
  return true;
}

/**
 * Pause (`on` true) or go on (`on` false), and NOTHING if it is already so. The spoken "pause" and
 * "resume" use this, not the toggle: a command heard twice must leave the game the way it was asked
 * for (input_speech.js: "a spoken command should be IDEMPOTENT"). Returns true when it changed.
 */
export function setPaused(g, on) {
  if ((g.phase === 'paused') === !!on) return false;
  togglePause(g);
  return true;
}

function moveBall(g, dt, speed, events) {
  const b = g.ball;
  // Sub-steps no longer than half a ball radius, so a fast ball or a long frame cannot pass
  // through a brick or the paddle between two looks.
  const dist = speed * dt / 1000;
  const n = Math.max(1, Math.ceil(dist / (BALL_R * 0.5)));
  const h = dt / 1000 / n;
  for (let i = 0; i < n && g.phase === 'play'; i++) {
    const py = b.y;
    b.x += b.vx * h; b.y += b.vy * h;
    // side walls and the top
    if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx); events.push('wall'); }
    if (b.x + BALL_R > FIELD_W) { b.x = FIELD_W - BALL_R; b.vx = -Math.abs(b.vx); events.push('wall'); }
    if (b.y - BALL_R < 0) { b.y = BALL_R; b.vy = Math.abs(b.vy); events.push('wall'); }
    // the paddle: only a ball coming DOWN onto its top edge, so it cannot catch one from below
    const p = g.paddle;
    if (b.vy > 0 && py + BALL_R <= PADDLE_Y + 0.6 && b.y + BALL_R >= PADDLE_Y
        && Math.abs(b.x - p.x) <= p.w / 2 + BALL_R * 0.8) {
      const off = clamp((b.x - p.x) / (p.w / 2), -1, 1);
      const a = off * MAX_BOUNCE;
      b.vx = Math.sin(a) * speed; b.vy = -Math.cos(a) * speed;
      b.y = PADDLE_Y - BALL_R;
      normalizeBall(g, speed);
      g.catches++;
      events.push('paddle');
      continue;
    }
    // one brick per sub-step
    for (const k of g.bricks) {
      if (!k.alive) continue;
      const cx = clamp(b.x, k.x, k.x + k.w), cy = clamp(b.y, k.y, k.y + k.h);
      const dx = b.x - cx, dy = b.y - cy;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      k.alive = false;
      g.broken++;
      const penX = Math.min(b.x + BALL_R - k.x, k.x + k.w - (b.x - BALL_R));
      const penY = Math.min(b.y + BALL_R - k.y, k.y + k.h - (b.y - BALL_R));
      if (penX < penY) b.vx = b.x < k.x + k.w / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
      else b.vy = b.y < k.y + k.h / 2 ? -Math.abs(b.vy) : Math.abs(b.vy);
      normalizeBall(g, speed);
      events.push('brick');
      break;
    }
    if (!aliveCount(g)) {
      g.phase = 'cleared'; g.walls++;
      events.push('cleared');
      return;
    }
    // below the paddle: the ball is gone
    if (b.y - BALL_R > FIELD_H) {
      g.misses++;
      events.push('miss');
      if (g.livesLeft != null) {
        g.livesLeft--;
        if (g.livesLeft <= 0) { g.phase = 'again'; events.push('again'); return; }
      }
      g.phase = 'ready';
      restOnPaddle(g);
      return;
    }
  }
}

/**
 * Advance the game by `dt` milliseconds.
 *   opts.speed        ball speed (field units/s)
 *   opts.sweep        sweeping paddle speed
 *   opts.control      'sweep' | 'steps' | 'follow'
 *   opts.autoLaunchMs how long a resting ball waits before it goes by itself (0 = only on a press)
 *   opts.restMs       how long "wall down" / "again" shows before the next wall starts by itself
 *   opts.idle         true when nobody has pressed anything since the game came to rest (see module)
 *   opts.rand         randomness for the launch lean
 * Returns the events, in order.
 */
export function step(g, dt, opts = {}) {
  const events = [];
  const d = Math.max(0, Math.min(Number(dt) || 0, 250));   // a long stall (a hidden tab) is not a teleport
  if (!d || g.phase === 'paused') return events;
  const speed = Number(opts.speed) > 0 ? Number(opts.speed) : BALL_SPEEDS.slow;
  const control = CONTROLS.includes(opts.control) ? opts.control : 'sweep';

  // ---- the paddle ----
  const p = g.paddle;
  const [lo, hi] = paddleBounds(g);
  if (control === 'sweep' && p.moving) {
    p.x += p.dir * (Number(opts.sweep) || SWEEP_SPEEDS.slow) * d / 1000;
    if (p.x <= lo) { p.x = lo; p.dir = 1; }
    if (p.x >= hi) { p.x = hi; p.dir = -1; }
  } else if (control === 'follow' && g.phase === 'play') {
    // Glides under the ball (faster than the ball can move sideways, so it always gets there),
    // placed so the ball meets it off-centre by the aim: that is what steers the rebound.
    const land = landingX(g);
    const want = (land == null ? g.ball.x : land) - g.aim * p.w * 0.3;
    const maxMove = speed * 1.5 * d / 1000;
    p.x = clamp(p.x + clamp(want - p.x, -maxMove, maxMove), lo, hi);
  }
  p.x = clamp(p.x, lo, hi);

  // ---- the phases ----
  if (g.phase === 'ready') {
    restOnPaddle(g);
    const auto = Number(opts.autoLaunchMs) || 0;
    if (auto > 0 && !opts.idle) {
      g.wait += d;
      if (g.wait >= auto) { launch(g, { speed, rand: opts.rand || Math.random, control }); events.push('launch'); }
    }
    return events;
  }
  if (g.phase === 'cleared' || g.phase === 'again') {
    g.wait += d;
    if (g.wait >= (Number(opts.restMs) || 3000)) { events.push(...nextWall(g)); }
    return events;
  }
  if (g.phase === 'play') moveBall(g, d, speed, events);
  if (g.phase !== 'play') g.wait = 0;
  return events;
}

/** After "wall down" or "again": the next wall goes up and the ball rests on the paddle. */
export function nextWall(g) {
  const again = g.phase === 'again';
  g.bricks = makeWall({ rows: g.rows, cols: g.cols });
  if (again) {
    g.broken = 0; g.walls = 0; g.misses = 0; g.catches = 0;
    g.livesLeft = g.startLives != null ? g.startLives : g.livesLeft;
  }
  g.phase = 'ready'; g.wait = 0;
  restOnPaddle(g);
  return [again ? 'restart' : 'wall'];
}
