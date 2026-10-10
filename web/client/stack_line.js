// stack_line.js — THE RULES OF STACK TO THE LINE, with no DOM and no clock of its own (brick games, row 2.76, 2026-10-10).
//
// Mike, 2026-10-09 (row 2.76): "Any other ideas for games with our bricks?" Chat's first idea: "stack to the line (one
// press drops a brick; a one-switch timing game)". `modules/stackline.js` is the panel; this file is the tower, the
// sliding brick and what a press does, so a suite can play a whole game with numbers. `step(g, dt, opts)` MUTATES `g`
// and returns what happened (['land', 'cut', 'line', ...]), the brick_drop.js shape.
//
// *** OUR OWN GAME. *** Stacking a sliding block and cutting off what overhangs is an old idea and free to use; the
// name, the look and the rules here are ours: the bricks are Nimrod bricks seen from the front (brick_face.js, one
// keyed socket per 40 mm cell), in the theme's brick colours, on a short track; there is a LINE to reach, and at the
// easy levels nothing is ever lost. No other game's name, art, colours or sounds.
//
// *** WHOLE BRICKS BY DEFAULT (`cut: 'cell'`, argued). *** A dropped brick lands on the nearest whole 40 mm cell, so
// what is cut off is always a whole brick (one cell, two cells...) and what stays is a real Nimrod brick length. FOR:
// it is OUR brick (every part is on the 40 mm grid), and it is forgiving: anywhere within half a cell of right is
// exactly right, which at the Very easy speed is a full second to press in. AGAINST: it is easier than the classic
// game, and the tower can never be "nearly" right. `cut: 'exact'` cuts where it lands, for anybody who wants that.
//
// *** THE LEVELS, AND WHAT EACH ARGUES (Rule 1: the level table is the default; every number in it is also its own
// setting on the panel, "As the level says" by default). ***
//   track  how many cells wide the space the brick slides in is. A brick slides from one side to the other.
//   width  the first brick's width in cells (the base is the same width). Wider is easier.
//   line   how many bricks high the line is. Fewer is a shorter game.
//   speed  cells a second. FOR slower: a switch press can take a second to land, and at 1 cell a second the brick
//          spends a whole second within half a cell of right. AGAINST: slower than this and it reads as stopped.
//   1 Very easy: an 8-cell track, a 4-cell brick, the line 5 high, 1 cell a second.
//   2 Easy:      the line 6 high, 1.5 a second.
//   3 Medium:    a 3-cell brick on a 9-cell track, the line 8 high, 2 a second.
//   4 Hard:      a 10-cell track, the line 10 high, 3 a second.
//   5 Very hard: a 2-cell brick, the line 12 high, 4 a second.
//
// *** A MISS COSTS NOTHING BY DEFAULT (`onMiss: 'again'`, argued). *** A brick that lands on nothing falls away and the
// same brick comes again. FOR: in therapy the point is the next press, not a losing screen. AGAINST: with nothing to
// lose there is less to win. `onMiss: 'restart'` starts the tower again from the base, for somebody who wants that.
// *** A PERFECT DROP PUTS A CELL BACK (`perfectGrows`, on by default, argued). *** FOR: a brick that only ever shrinks
// makes every game end in thin bricks; a reward for getting it right is the kind thing. AGAINST: it is one more rule to
// understand. It never grows past the first brick's width.

export const REST_MS = 3000;          // "You reached the line!" stays this long (brick_drop.js's rest), a press skips it
export const CUT_FALL_MS = 900;       // a cut-off piece falls and fades this long: long enough to SEE where it went
export const EXACT_PERFECT = 0.12;    // in `cut: 'exact'`, this close (in cells) to right counts as perfect: about 5 mm
const EPS = 1e-6;
export const SLIDES = Object.freeze(['smooth', 'steps']);
export const CUTS = Object.freeze(['cell', 'exact']);
export const MISS_MODES = Object.freeze(['again', 'restart']);
export const AFTER_LINE = Object.freeze(['same', 'up']);
export const COLOUR_MODES = Object.freeze(['rows', 'one']);

export const LEVELS = Object.freeze({
  1: Object.freeze({ label: 'Very easy', track: 8, width: 4, line: 5, speed: 1 }),
  2: Object.freeze({ label: 'Easy', track: 8, width: 4, line: 6, speed: 1.5 }),
  3: Object.freeze({ label: 'Medium', track: 9, width: 3, line: 8, speed: 2 }),
  4: Object.freeze({ label: 'Hard', track: 10, width: 3, line: 10, speed: 3 }),
  5: Object.freeze({ label: 'Very hard', track: 10, width: 2, line: 12, speed: 4 }),
});
export const LEVEL_IDS = Object.freeze(Object.keys(LEVELS).map(Number));
export const levelOf = (n) => (LEVELS[Math.round(Number(n))] ? Math.round(Number(n)) : 1);

// The ranges a setting may ask for (a stored value outside them is clamped, never trusted).
export const LIMITS = Object.freeze({ track: [4, 14], width: [1, 8], line: [2, 20], speed: [0.25, 8] });
const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

/**
 * The numbers one game plays with: the level's, each replaced by its setting when the setting is a number (0, '' or
 * 'level' = as the level says). The width never exceeds the track. Pure.
 */
export function sizesFor(level, { track = 0, width = 0, line = 0, speed = 0 } = {}) {
  const L = LEVELS[levelOf(level)];
  const pick = (v, d, lim) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? clamp(n, lim) : d; };
  const t = Math.round(pick(track, L.track, LIMITS.track));
  const w = Math.min(t, Math.round(pick(width, L.width, LIMITS.width)));
  return { track: t, width: w, line: Math.round(pick(line, L.line, LIMITS.line)), speed: pick(speed, L.speed, LIMITS.speed) };
}

/** The colour index (0..4, brick_face.js data-c) of layer `i`: each row the next theme colour, or all one. Base: 4. */
export const colourOf = (i, mode = 'rows') => (i === 0 ? 4 : mode === 'one' ? 0 : (i - 1) % 4);

/** A new game: the base brick on the floor, no sliding brick yet (`deal` gives one). */
export function newGame({ level = 1, sizes = null, colours = 'rows' } = {}) {
  const lv = levelOf(level);
  const s = sizes || sizesFor(lv);
  const g = {
    level: lv, track: s.track, startWidth: s.width, line: s.line, speed: s.speed, colours,
    layers: [], piece: null, falling: [], phase: 'ready',
    towers: 0,            // lines reached this game (the score)
    placed: 0, misses: 0, perfects: 0, cuts: 0,
    restMs: 0, pausedFrom: null, serial: 0, v: 0,
  };
  g.layers.push({ x: Math.floor((g.track - g.startWidth) / 2), w: g.startWidth, c: colourOf(0, colours) });
  return g;
}

/** How many bricks are on the base (the tower's height toward the line). */
export const height = (g) => g.layers.length - 1;
export const topLayer = (g) => g.layers[g.layers.length - 1];

/** Deal the next sliding brick: as wide as the top, from one side (it alternates sides, row by row). */
export function deal(g, { width = null } = {}) {
  const top = topLayer(g);
  const w = Math.max(EPS, Math.min(g.track, width == null ? top.w : width));
  const fromRight = height(g) % 2 === 1;
  g.piece = { x: fromRight ? g.track - w : 0, w, dir: fromRight ? -1 : 1, acc: 0, id: ++g.serial,
    c: colourOf(g.layers.length, g.colours) };
  g.phase = 'play';
  g.v++;
  return g.piece;
}

/** A fresh tower (the score kept): the base again, at the game's sizes, and the first brick. */
export function freshTower(g, { sizes = null } = {}) {
  if (sizes) { g.track = sizes.track; g.startWidth = sizes.width; g.line = sizes.line; g.speed = sizes.speed; }
  g.layers = [{ x: Math.floor((g.track - g.startWidth) / 2), w: g.startWidth, c: colourOf(0, g.colours) }];
  g.v++;
  deal(g);
}

/** Pause / go on. Idempotent with `on`. true when it changed. */
export function setPaused(g, on) {
  if (on && g.phase !== 'paused') { g.pausedFrom = g.phase; g.phase = 'paused'; g.v++; return true; }
  if (!on && g.phase === 'paused') { g.phase = g.pausedFrom || 'play'; g.pausedFrom = null; g.v++; return true; }
  return false;
}

/** Where the brick would land if dropped now (whole cells in `cell`). Pure. */
export const landingX = (g, cut = 'cell') => (g.piece ? (cut === 'exact' ? g.piece.x : Math.round(g.piece.x)) : null);

/**
 * THE ONE PRESS: drop the sliding brick. Returns the events: 'land' + 'perfect' | 'cut', or 'miss'; 'line' when the
 * tower reached the line. Opts: { cut, onMiss, perfectGrows }.
 */
export function drop(g, { cut = 'cell', onMiss = 'again', perfectGrows = true } = {}) {
  const p = g.piece;
  if (!p || g.phase !== 'play') return [];
  const top = topLayer(g);
  const x = landingX(g, cut);
  const left = Math.max(x, top.x), right = Math.min(x + p.w, top.x + top.w);
  const overlap = right - left;
  const row = g.layers.length;
  const events = [];
  g.piece = null;
  if (overlap <= EPS) {
    g.misses++;
    g.falling.push({ x, w: p.w, row, c: p.c, ms: 0, id: `f${++g.serial}` });
    events.push('miss');
    if (onMiss === 'restart') freshTower(g);
    else deal(g, { width: p.w });
    g.v++;
    return events;
  }
  const perfect = cut === 'exact' ? Math.abs(x - top.x) <= EXACT_PERFECT && Math.abs(p.w - top.w) <= EXACT_PERFECT
    : Math.abs(x - top.x) < EPS && Math.abs(p.w - top.w) < EPS;
  let layer;
  if (perfect) {
    layer = { x: top.x, w: top.w, c: p.c };
    if (perfectGrows && layer.w < g.startWidth - EPS) {
      const w = Math.min(g.startWidth, layer.w + 1);
      layer.x = Math.max(0, Math.min(g.track - w, layer.x - (layer.x + w > g.track ? 1 : 0)));
      layer.w = w;
      events.push('grow');
    }
    g.perfects++;
  } else {
    layer = { x: left, w: overlap, c: p.c };
    if (x < left - EPS) g.falling.push({ x, w: left - x, row, c: p.c, ms: 0, id: `f${++g.serial}` });
    if (x + p.w > right + EPS) g.falling.push({ x: right, w: x + p.w - right, row, c: p.c, ms: 0, id: `f${++g.serial}` });
    g.cuts++;
  }
  g.layers.push(layer);
  g.placed++;
  events.unshift('land', perfect ? 'perfect' : 'cut');
  if (height(g) >= g.line) {
    g.towers++;
    g.phase = 'won';
    g.restMs = 0;
    events.push('line');
  } else deal(g);
  g.v++;
  return events;
}

/**
 * Advance `dt` ms. Opts: { slide, idle, restMs, afterLine, sizesFor(level) }. Nothing slides while `idle` (nobody has
 * pressed for a while) or paused; a cut piece still finishes falling and a rest still runs out.
 */
export function step(g, dt, opts = {}) {
  const o = { slide: 'smooth', idle: false, restMs: REST_MS, afterLine: 'same', sizesFor: null, ...opts };
  const d = Math.max(0, Number(dt) || 0);
  const events = [];
  if (g.falling.length && g.phase !== 'paused') {
    for (const f of g.falling) f.ms += d;
    const before = g.falling.length;
    g.falling = g.falling.filter((f) => f.ms < CUT_FALL_MS);
    if (g.falling.length !== before) events.push('gone');
    g.v++;
  }
  if (g.phase === 'won') {
    g.restMs += d;
    if (g.restMs >= o.restMs) {
      if (o.afterLine === 'up' && LEVELS[g.level + 1]) g.level += 1;
      freshTower(g, { sizes: typeof o.sizesFor === 'function' ? o.sizesFor(g.level) : null });
      events.push('fresh');
    }
    return events;
  }
  if (g.phase !== 'play' || !g.piece || o.idle) return events;
  const p = g.piece;
  const max = Math.max(0, g.track - p.w);
  if (o.slide === 'steps') {
    // One whole cell at a time, at the same average speed: what is seen is exactly where it lands.
    const each = 1000 / Math.max(0.01, g.speed);
    p.acc += d;
    while (p.acc >= each) {
      p.acc -= each;
      let nx = Math.round(p.x) + p.dir;
      if (nx > max || nx < 0) { p.dir = -p.dir; nx = Math.round(p.x) + p.dir; }
      p.x = Math.max(0, Math.min(max, nx));
      events.push('slide');
    }
  } else {
    let x = p.x + p.dir * g.speed * (d / 1000);
    // Bounce at the sides (a long step reflects as many times as it needs).
    let guard = 8;
    while ((x > max || x < 0) && guard-- > 0) {
      if (x > max) { x = 2 * max - x; p.dir = -1; } else { x = -x; p.dir = 1; }
    }
    p.x = Math.max(0, Math.min(max, x));
    if (d > 0) events.push('slide');
  }
  g.v++;
  return events;
}

// ---------------------------------------------------------------------------------------------------
// THE BUILT-IN DEMO PLAYER, kind 'stack-line' (a registered agent that plays 'stackline' is asked first, game_agent.js).
// It drops when the brick is within its aim of the top, and its aim is a little different every brick (a person, not a
// machine): usually within a third of a cell, sometimes wide.
//   observation.state { phase, piece: { x, w, id }, top: { x, w }, height, line, track }
//   actions ['drop']
// ---------------------------------------------------------------------------------------------------
export const lineComputer = Object.freeze({
  id: 'computer', label: 'The computer', kinds: ['stack-line'],
  decide(obs, { rand = Math.random, memory = {} } = {}) {
    const s = obs?.state;
    if (!s || s.phase !== 'play' || !s.piece || !s.top) return null;
    if (memory.piece !== s.piece.id) {
      memory.piece = s.piece.id;
      const r = rand();
      memory.aim = r < 0.15 ? 0.6 + rand() * 0.8 : 0.05 + rand() * 0.3;   // mostly close, now and then wide
      memory.passes = 0;
      memory.near = false;
    }
    const off = Math.abs(s.piece.x - s.top.x);
    if (off <= memory.aim) return { act: 'drop' };
    return null;
  },
});
