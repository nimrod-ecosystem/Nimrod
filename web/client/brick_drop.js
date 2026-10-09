// brick_drop.js — THE RULES OF BRICK DROP, with no DOM and no clock of its own (brick games, 2026-10-09).
//
// Mike, 2026-10-09 (row 2.76): "Maybe a Tetris with our bricks." `modules/brickdrop.js` is the panel; this file is
// the wall, the pieces and what a press does, so a suite can play a whole game with numbers. `step(g, dt, opts)`
// MUTATES `g` and returns what happened (['land', 'rows', ...]), the breakout.js shape.
//
// *** OUR OWN GAME, NOT TETRIS'S LOOK. *** Chat's note BN, 2026-10-09 (background, not legal advice): the falling-
// blocks RULE is free to use, but Tetris's EXPRESSION is protected (Tetris Holding v. Xio, 2012): the seven
// four-square pieces and their colours, the tall 10 x 20 well, the ghost piece showing where a piece will land, the
// next-piece box, and the look of how pieces fall and lock. So, on purpose:
//   * THE PIECES ARE OUR BRICKS. Each piece is one, two or three real Nimrod bricks (bricks.json: the 40, 80 and
//     120 mm bricks), joined the way our parts join them (the flat corner plate, the T plate, the joiner plates,
//     the L bracket). NO PIECE HAS FOUR SQUARES: every piece is 1, 2, 3 or 5 cells, so none of them can be one of
//     the seven tetrominoes, and the suite checks it shape by shape anyway.
//   * THE COLOURS ARE THE THEME'S (brick_face.js), and by default a brick's colour says HOW LONG IT IS (every
//     one-cell brick one colour, every two-cell another), not which piece it came from.
//   * THE WALL IS SHORT AND WIDE AND CHANGES WITH THE LEVEL (5 x 9 at the easiest, 9 x 13 at the hardest), drawn as
//     a board of empty sockets the bricks plug into. No ghost piece, no next-piece box.
//   * A FULL ROW IS "A ROW BUILT" and goes, and the score is rows built.
//   * AT THE EASY LEVELS THERE IS NO GAME OVER (below).
//
// *** THE LEVELS, AND WHAT EACH ARGUES (Rule 1: these are the level table, and the level is the setting). ***
//   1 Very easy  one- and two-cell bricks only, a 5-wide wall: a row is two or three presses. Slow everything.
//   2 Easy       adds the three-cell brick; 6 wide.
//   3 Medium     adds the corner (two bricks); 7 wide.
//   4 Hard       drops the single cell, adds the five-cell pieces (T, big corner); 8 wide; a full wall ends the game.
//   5 Very hard  all of them (cup, steps); 9 wide; faster.
//   `glideMs` is how long the gliding piece stays on each column; `fallMs` how long it takes to fall one row when it
//   falls by itself. FOR slower: a switch user's press can take a second or more to land. AGAINST: slower than this
//   at level 1 and the glide reads as stopped. Each is one level away from the next.
//
// *** WHEN THE WALL FILLS UP: NO GAME OVER AT THE EASY LEVELS (argued; `whenFull` changes it). ***
//   'fresh' (levels 1-3): "The wall is full" for REST_MS, then a fresh wall goes up by itself AND THE SCORE CARRIES
//      ON. FOR: in therapy the point is the next brick, not a losing screen; nothing is taken away for having played.
//   'again' (levels 4-5): the game ends - "Again!" - and a new game (score from 0) starts by itself after REST_MS.
//      FOR: at the hard levels the wall filling up IS the challenge, and somebody who wants a real game wants it to
//      be possible to lose one. AGAINST a game over anywhere: it is a failure moment. It never blocks - it starts
//      again by itself - and it is one setting away from 'fresh'.

export const REST_MS = 3000;          // "The wall is full" / "Again!" / "Up a level" stay this long (brickbreaker's)
export const DROP_ROW_MS = 35;        // a dropped piece falls a row this often: quick, but SEEN to fall
export const SCAN_ORDER = Object.freeze(['left', 'turn', 'right', 'drop']);
export const CONTROLS = Object.freeze(['glide', 'scan', 'keys']);
export const FULL_MODES = Object.freeze(['fresh', 'again']);

// THE PIECES. `bricks`: each brick is a straight run of cells [x, y] (y down), the way a real brick is. `parts`: the
// published bricks it is made of; `joiner`: the published part that holds them together (bricks.json ids, all of
// them; the suite fetches bricks.json and checks every one).
export const SHAPES = Object.freeze({
  one: Object.freeze({ label: 'One brick', bricks: [[[0, 0]]], parts: ['brick_40x40x40_v1'], joiner: null }),
  two: Object.freeze({ label: 'Two-long brick', bricks: [[[0, 0], [1, 0]]], parts: ['brick_40x40x80_v1'], joiner: null }),
  three: Object.freeze({ label: 'Three-long brick', bricks: [[[0, 0], [1, 0], [2, 0]]], parts: ['brick_40x40x120_v1'], joiner: null }),
  corner: Object.freeze({ label: 'Corner', bricks: [[[0, 1], [1, 1]], [[0, 0]]],
    parts: ['brick_40x40x80_v1', 'brick_40x40x40_v1'], joiner: 'plate_L80x80x5_v1' }),
  tee: Object.freeze({ label: 'T', bricks: [[[0, 2], [1, 2], [2, 2]], [[1, 0], [1, 1]]],
    parts: ['brick_40x40x120_v1', 'brick_40x40x80_v1'], joiner: 'plate_T120x80x5_v1' }),
  bigCorner: Object.freeze({ label: 'Big corner', bricks: [[[0, 2], [1, 2], [2, 2]], [[0, 0], [0, 1]]],
    parts: ['brick_40x40x120_v1', 'brick_40x40x80_v1'], joiner: 'plate_L80x80x5_v1' }),
  cup: Object.freeze({ label: 'Cup', bricks: [[[0, 1], [1, 1], [2, 1]], [[0, 0]], [[2, 0]]],
    parts: ['brick_40x40x120_v1', 'brick_40x40x40_v1', 'brick_40x40x40_v1'], joiner: 'bracket_L40x40x5_v1' }),
  steps: Object.freeze({ label: 'Steps', bricks: [[[0, 1], [1, 1], [2, 1]], [[2, 0], [3, 0]]],
    parts: ['brick_40x40x120_v1', 'brick_40x40x80_v1'], joiner: 'plate_I80x40x5_v1' }),
});

export const LEVELS = Object.freeze({
  1: Object.freeze({ label: 'Very easy', shapes: ['one', 'two'], w: 5, h: 9, glideMs: 1100, fallMs: 2400, full: 'fresh' }),
  2: Object.freeze({ label: 'Easy', shapes: ['one', 'two', 'three'], w: 6, h: 10, glideMs: 950, fallMs: 1800, full: 'fresh' }),
  3: Object.freeze({ label: 'Medium', shapes: ['one', 'two', 'three', 'corner'], w: 7, h: 11, glideMs: 800, fallMs: 1200, full: 'fresh' }),
  4: Object.freeze({ label: 'Hard', shapes: ['two', 'three', 'corner', 'tee', 'bigCorner'], w: 8, h: 12, glideMs: 650, fallMs: 800, full: 'again' }),
  5: Object.freeze({ label: 'Very hard', shapes: ['two', 'three', 'corner', 'tee', 'bigCorner', 'cup', 'steps'], w: 9, h: 13,
    glideMs: 500, fallMs: 550, full: 'again' }),
});
export const LEVEL_IDS = Object.freeze(Object.keys(LEVELS).map(Number));
export const levelOf = (n) => LEVELS[Math.round(Number(n))] ? Math.round(Number(n)) : 1;

/** The cells of a shape turned `rot` quarter turns clockwise, moved so the smallest x and y are 0. Pure. */
export function shapeCells(shapeId, rot = 0) {
  const s = SHAPES[shapeId];
  if (!s) return [];
  let cells = [];
  s.bricks.forEach((run, b) => run.forEach(([x, y]) => cells.push({ x, y, b })));
  const turns = ((Math.round(Number(rot)) || 0) % 4 + 4) % 4;
  for (let t = 0; t < turns; t++) {
    const h = Math.max(...cells.map((c) => c.y));
    cells = cells.map((c) => ({ x: h - c.y, y: c.x, b: c.b }));
  }
  const mx = Math.min(...cells.map((c) => c.x)), my = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => ({ x: c.x - mx, y: c.y - my, b: c.b }));
}

/** A brick's length in cells, for its colour ("length" colours: one colour per length). */
export const brickLength = (shapeId, b) => (SHAPES[shapeId]?.bricks[b]?.length || 1);
/** The colour index of a brick: by its length (default), or one colour for all. */
export const colourFor = (shapeId, b, mode = 'length') => (mode === 'one' ? 0 : brickLength(shapeId, b) - 1);

const emptyWall = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));

/** A new game at `level` (its own wall size, shapes and speeds). No piece yet: `spawn` deals one. */
export function newGame({ level = 1, colours = 'length' } = {}) {
  const lv = levelOf(level);
  const L = LEVELS[lv];
  return {
    level: lv, w: L.w, h: L.h, cells: emptyWall(L.w, L.h), colours,
    piece: null, phase: 'ready', nextBrick: 1, serial: 0,
    rows: 0,              // rows built this game (the score)
    rowsThisLevel: 0,     // toward "goes up a level"
    placed: 0, walls: 0,  // pieces placed; fresh walls this game
    lastBuilt: 0,         // rows the last piece built
    restMs: 0, dropMs: 0, fallMs: 0, glideMs: 0, scanMs: 0,
    glide: { dir: 1, moving: true }, scan: 0,
    pausedFrom: null, v: 0,
  };
}

/** Does a piece's cells fit at (x, y)? Above the top counts as inside (a piece may turn up there). */
export function fits(g, cells, x, y) {
  for (const c of cells) {
    const cx = x + c.x, cy = y + c.y;
    if (cx < 0 || cx >= g.w || cy >= g.h) return false;
    if (cy >= 0 && g.cells[cy][cx]) return false;
  }
  return true;
}

/** Deal the next piece at the top, in the middle. Returns false (and does nothing) when it cannot fit: full. */
export function spawn(g, rand = Math.random) {
  const shapes = LEVELS[g.level].shapes;
  const shape = shapes[Math.min(shapes.length - 1, Math.floor((rand() || 0) * shapes.length))];
  const cells = shapeCells(shape, 0);
  const pw = Math.max(...cells.map((c) => c.x)) + 1;
  const x = Math.floor((g.w - pw) / 2);
  if (!fits(g, cells, x, 0)) { g.piece = null; return false; }
  g.piece = { shape, rot: 0, x, y: 0, cells, id: ++g.serial };
  g.phase = 'play';
  g.fallMs = 0; g.glideMs = 0; g.dropMs = 0;
  g.glide.moving = true;        // a new piece glides again, whatever the last one did (a "stop" is per piece)
  g.v++;
  return true;
}

/** Move the piece `dx` columns (and `dy` rows). true if it moved. */
export function move(g, dx, dy = 0) {
  const p = g.piece;
  if (!p || (g.phase !== 'play' && g.phase !== 'drop')) return false;
  if (!fits(g, p.cells, p.x + dx, p.y + dy)) return false;
  p.x += dx; p.y += dy; g.v++;
  return true;
}

// A turn that does not fit where it is tries a column either side, then two (a piece by the wall can still turn).
const KICKS = [0, -1, 1, -2, 2];
/** Turn the piece a quarter clockwise. true if it turned. */
export function turn(g) {
  const p = g.piece;
  if (!p || g.phase !== 'play') return false;
  const rot = (p.rot + 1) % 4;
  const cells = shapeCells(p.shape, rot);
  for (const k of KICKS) {
    if (fits(g, cells, p.x + k, p.y)) { p.rot = rot; p.cells = cells; p.x += k; g.v++; return true; }
  }
  return false;
}

/** Send the piece down. `instant` (reduced motion, the suite) puts it in place now; otherwise it falls fast. */
export function drop(g, { instant = false, ...rest } = {}) {
  if (!g.piece || g.phase !== 'play') return [];
  if (instant) {
    while (fits(g, g.piece.cells, g.piece.x, g.piece.y + 1)) g.piece.y++;
    return settle(g, rest);
  }
  g.phase = 'drop'; g.dropMs = 0; g.v++;
  return ['drop'];
}

/** The rows that are full. */
export const fullRows = (g) => g.cells.map((r, i) => (r.every(Boolean) ? i : -1)).filter((i) => i >= 0);

/** Put the piece into the wall, build any full rows, and deal the next. Returns the events. */
export function settle(g, { rand = Math.random, levelUp = 0, whenFull = null } = {}) {
  const p = g.piece;
  if (!p) return [];
  const events = ['land'];
  const ids = new Map();
  for (const c of p.cells) {
    if (!ids.has(c.b)) ids.set(c.b, g.nextBrick++);
    const cy = p.y + c.y, cx = p.x + c.x;
    if (cy >= 0) g.cells[cy][cx] = { b: ids.get(c.b), c: colourFor(p.shape, c.b, g.colours), shape: p.shape };
  }
  g.piece = null;
  g.placed++;
  const full = fullRows(g);
  g.lastBuilt = full.length;
  if (full.length) {
    g.cells = [...emptyWall(g.w, full.length), ...g.cells.filter((_, i) => !full.includes(i))];
    g.rows += full.length;
    g.rowsThisLevel += full.length;
    events.push('rows');
  }
  g.v++;
  if (levelUp > 0 && g.rowsThisLevel >= levelUp && LEVELS[g.level + 1]) {
    g.phase = 'levelup'; g.restMs = 0;
    events.push('levelup');
    return events;
  }
  if (!spawn(g, rand)) {
    g.phase = (whenFull || LEVELS[g.level].full) === 'again' ? 'again' : 'full';
    g.restMs = 0;
    events.push(g.phase);
  }
  return events;
}

/** A fresh wall at the game's level (and its size), the score kept. Deals the first piece. */
export function freshWall(g, rand = Math.random) {
  const L = LEVELS[g.level];
  g.w = L.w; g.h = L.h; g.cells = emptyWall(g.w, g.h);
  g.walls++;
  g.v++;
  spawn(g, rand);
}

/** Pause / go on. Idempotent with `on`. Returns true when it changed. */
export function setPaused(g, on) {
  if (on && g.phase !== 'paused') { g.pausedFrom = g.phase; g.phase = 'paused'; g.v++; return true; }
  if (!on && g.phase === 'paused') { g.phase = g.pausedFrom || 'play'; g.pausedFrom = null; g.v++; return true; }
  return false;
}

/**
 * Advance `dt` ms. `opts`: { control, falls (bool), glideMs, fallMs, scanMs, glideTurns, idle, instantDrop,
 * rand, levelUp, whenFull, restMs }. Nothing moves while `idle` (nobody has pressed) except a dropping piece
 * finishing its fall and a rest running out.
 */
export function step(g, dt, opts = {}) {
  const o = { control: 'glide', falls: false, glideTurns: true, idle: false, rand: Math.random, restMs: REST_MS, ...opts };
  const L = LEVELS[g.level];
  const glideMs = Number(o.glideMs) > 0 ? Number(o.glideMs) : L.glideMs;
  const fallMs = Number(o.fallMs) > 0 ? Number(o.fallMs) : L.fallMs;
  const scanMs = Number(o.scanMs) > 0 ? Number(o.scanMs) : 2000;
  const events = [];
  const d = Math.max(0, Number(dt) || 0);
  const settleOpts = { rand: o.rand, levelUp: o.levelUp, whenFull: o.whenFull };
  switch (g.phase) {
    case 'paused': case 'ready': return events;
    case 'full': case 'again': case 'levelup':
      g.restMs += d;
      if (g.restMs >= o.restMs) {
        const was = g.phase;
        if (was === 'again') {
          const keep = { colours: g.colours };
          Object.assign(g, newGame({ level: g.level, ...keep }));
          spawn(g, o.rand);
        } else {
          if (was === 'levelup') { g.level = Math.min(Math.max(...LEVEL_IDS), g.level + 1); g.rowsThisLevel = 0; }
          freshWall(g, o.rand);
        }
        events.push(was === 'levelup' ? 'level' : 'fresh');
      }
      return events;
    case 'drop':
      g.dropMs += d;
      while (g.phase === 'drop' && g.dropMs >= DROP_ROW_MS) {
        g.dropMs -= DROP_ROW_MS;
        if (!move(g, 0, 1)) { g.phase = 'play'; events.push(...settle(g, settleOpts)); }
      }
      return events;
    default: break;
  }
  if (g.phase !== 'play' || !g.piece || o.idle) return events;
  // the scan: one choice lit at a time
  if (o.control === 'scan') {
    g.scanMs += d;
    while (g.scanMs >= scanMs) { g.scanMs -= scanMs; g.scan = (g.scan + 1) % SCAN_ORDER.length; g.v++; events.push('scan'); }
  }
  // the glide: one column at a time, turning round at a side (and, with glideTurns, turning the piece)
  if (o.control === 'glide' && g.glide.moving) {
    g.glideMs += d;
    while (g.glideMs >= glideMs && g.phase === 'play') {
      g.glideMs -= glideMs;
      if (move(g, g.glide.dir)) events.push('glide');
      else {
        g.glide.dir = -g.glide.dir;
        if (o.glideTurns && turn(g)) events.push('turn');
        else if (move(g, g.glide.dir)) events.push('glide');
      }
    }
  }
  // falling by itself
  if (o.falls && g.phase === 'play' && g.piece) {
    g.fallMs += d;
    while (g.phase === 'play' && g.piece && g.fallMs >= fallMs) {
      g.fallMs -= fallMs;
      if (!move(g, 0, 1)) events.push(...settle(g, settleOpts));
      else events.push('fall');
    }
  }
  return events;
}

/** The wall as text rows ('.' empty, '#' a brick) - for an agent's observation and the suite. */
export const wallRows = (g) => g.cells.map((r) => r.map((c) => (c ? '#' : '.')).join(''));

/**
 * The bricks to draw: each settled brick as ONE straight run { id, x, y, len, dir: 'h'|'v', c, shape }. A brick cut
 * by a built row stays one straight run (the rows above come down to meet it).
 */
export function settledBricks(g) {
  const by = new Map();
  g.cells.forEach((row, y) => row.forEach((c, x) => {
    if (!c) return;
    if (!by.has(c.b)) by.set(c.b, { id: c.b, c: c.c, shape: c.shape, cells: [] });
    by.get(c.b).cells.push([x, y]);
  }));
  return [...by.values()].map((r) => runOf(r.cells, { id: r.id, c: r.c, shape: r.shape }));
}

/** The piece's bricks as runs, at the piece's place. */
export function pieceBricks(g) {
  const p = g.piece;
  if (!p) return [];
  const by = new Map();
  for (const c of p.cells) { if (!by.has(c.b)) by.set(c.b, []); by.get(c.b).push([p.x + c.x, p.y + c.y]); }
  return [...by.entries()].map(([b, cells]) => runOf(cells, { id: `p${b}`, c: colourFor(p.shape, b, g.colours), shape: p.shape }));
}

function runOf(cells, extra) {
  const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  const vertical = new Set(xs).size === 1 && cells.length > 1;
  return { ...extra, x, y, len: cells.length, dir: vertical ? 'v' : 'h' };
}

/** Where a drop from here would land (for an agent planning a move; NEVER drawn - no ghost piece). */
export function landingY(g, cells, x, y = 0) {
  if (!fits(g, cells, x, y)) return null;
  let yy = y;
  while (fits(g, cells, x, yy + 1)) yy++;
  return yy;
}

// ---------------------------------------------------------------------------------------------------
// THE BUILT-IN DEMO PLAYER, kind 'stack' (game_agent.js has none for this kind; a registered agent that plays
// 'brickdrop' is asked first). Picks where the piece goes by a plain score of the wall it would leave (rows built,
// holes, height, bumps) and then walks there one action at a time: turn, then left / right, then drop. About one
// piece in six it picks somewhere else at random, so the demo looks like a person, not a machine.
//   observation.state { phase, wall: wallRows, w, h, piece: { shape, rot, x, y, id } }
//   actions ['left', 'right', 'turn', 'drop']
// ---------------------------------------------------------------------------------------------------
function scoreWall(rows, w, h) {
  let built = 0, holes = 0, agg = 0, bump = 0;
  const heights = Array(w).fill(0);
  for (let x = 0; x < w; x++) {
    let seen = false;
    for (let y = 0; y < h; y++) {
      if (rows[y][x] === '#') { if (!seen) { heights[x] = h - y; seen = true; } }
      else if (seen) holes++;
    }
  }
  for (const r of rows) if (!r.includes('.')) built++;
  for (let x = 0; x < w; x++) { agg += heights[x]; if (x) bump += Math.abs(heights[x] - heights[x - 1]); }
  return built * 8 - holes * 5 - agg * 0.5 - bump * 0.4;
}

export const stackComputer = Object.freeze({
  id: 'computer', label: 'The computer', kinds: ['stack'],
  decide(obs, { rand = Math.random, memory = {} } = {}) {
    const s = obs?.state;
    if (!s || s.phase !== 'play' || !s.piece) return null;
    if (memory.piece !== s.piece.id) {
      memory.piece = s.piece.id;
      const g = { w: s.w, h: s.h, cells: s.wall.map((r) => [...r].map((ch) => (ch === '#' ? 1 : null))) };
      const options = [];
      for (let rot = 0; rot < 4; rot++) {
        const cells = shapeCells(s.piece.shape, rot);
        for (let x = -2; x < s.w; x++) {
          const y = landingY(g, cells, x, 0);
          if (y == null) continue;
          const rows = g.cells.map((r) => r.map((c) => (c ? '#' : '.')));
          for (const c of cells) if (y + c.y >= 0) rows[y + c.y][x + c.x] = '#';
          options.push({ rot, x, score: scoreWall(rows.map((r) => r.join('')), s.w, s.h) });
        }
      }
      if (!options.length) { memory.target = null; return { act: 'drop' }; }
      options.sort((a, b) => b.score - a.score);
      memory.target = rand() < 1 / 6 ? options[Math.floor(rand() * options.length)] : options[0];
      memory.turns = 0;
    }
    const t = memory.target;
    if (!t) return { act: 'drop' };
    if (s.piece.rot !== t.rot && memory.turns < 4) { memory.turns++; return { act: 'turn' }; }
    if (s.piece.x < t.x) return { act: 'right' };
    if (s.piece.x > t.x) return { act: 'left' };
    return { act: 'drop' };
  },
});
