// build_it.js — BUILD IT: THE LEVELS, THE MODELS TO BUILD, AND THE CHOICES (no DOM). The panel is modules/buildit.js.
//
// Mike, 2026-10-09: "We should have a building game where you can see the finished product and you have to build it."
//
// The game shows a finished model; the player builds the same. Two ways to build (`modeFor`, argued):
//   CHOOSE (the easy levels, one switch): the next part is offered as two or three pictures -- the model so far with
//     that part in it -- lit in turn; a press takes the lit one. The right one snaps into place; a wrong one says so
//     gently and stays offered no more (nothing is lost, nothing is put down). So a person who can make ONE press,
//     at a time of their choosing, can finish every model at levels 1 and 2.
//     FOR choosing over building at the start: building with a switch is a cell a press (brick_builder_view.js);
//     a three-part bridge would be twenty presses of moving before the first decision that matters. Choosing is
//     one decision a part -- which is the game: "which one goes next, and where?". AGAINST: it is recognising, not
//     making; the harder levels BUILD, in the brick builder itself, and "How you build" chooses either at any level.
//   BUILD (levels 3 to 5): the brick builder, with the model to copy above it. It is checked after every change, so
//     there is no "Check" to press and no wrong answer to be told about: "4 of 6 parts are right", until it is built.
//
// *** THE MATCH (brick_builder.js `matchBuilds`): the same parts, places and colours, anywhere on the floor and with
// the whole model turned any way round; a brick turned a quarter is the same brick. Colours can be switched off
// ("Colours must match"), for somebody who sees shape better than colour.
//
// *** THE MODELS: built in, easy to hard, every one checked by dev/buildit_test.html (it stands as built: nothing in
// it falls when it is settled; its parts are in the level's range; each choice the game offers is one only one of
// which is right). Levels: 1 two or three bricks, 2 three or four, 3 five or six, 4 seven to nine with plates and
// brackets, 5 ten to twelve.

import { GRID, COLOURS, normalizeBuild, normalizePart, settle, worldBoxes, restingY, specOf } from './brick_builder.js';

const C = (n) => COLOURS[(n - 1) % COLOURS.length];
// Parts in CELLS (40 mm): brick at cell (x, z), w x l x h cells, colour 1..5. `y` is worked out (things fall down).
const B = (x, z, w, l, h, c) => ({ part: 'brick', x: x * GRID, z: z * GRID, w: w * GRID, l: l * GRID, h: h * GRID, colour: C(c) });
const PI = (x, z, w, c, rot = 0) => ({ part: 'plateI', x: x * GRID, z: z * GRID, w: w * GRID, l: GRID, h: 5, colour: C(c), rot });
const BP = (x, z, w, l, t, c) => ({ part: 'baseplate', x: x * GRID, z: z * GRID, w: w * GRID, l: l * GRID, h: t, colour: C(c) });
const LB = (x, z, w, c, rot = 0) => ({ part: 'lbracket', x: x * GRID, z: z * GRID, w: w * GRID, l: GRID, h: GRID, colour: C(c), rot });

export const LEVELS = Object.freeze({
  1: Object.freeze({ label: 'Easy', parts: [2, 3], mode: 'choose', choices: 2 }),
  2: Object.freeze({ label: 'Gentle', parts: [3, 4], mode: 'choose', choices: 3 }),
  3: Object.freeze({ label: 'Medium', parts: [5, 6], mode: 'build', choices: 3 }),
  4: Object.freeze({ label: 'Harder', parts: [7, 9], mode: 'build', choices: 3 }),
  5: Object.freeze({ label: 'Hardest', parts: [10, 12], mode: 'build', choices: 3 }),
});
export const LEVEL_IDS = Object.freeze(Object.keys(LEVELS).map(Number));
export const levelOf = (v) => (LEVEL_IDS.includes(Number(v)) ? Number(v) : 1);

export const TARGETS = Object.freeze({
  1: [
    { id: 'tower', name: 'A tower', parts: [B(0, 0, 1, 1, 1, 1), B(0, 0, 1, 1, 1, 2)] },
    { id: 'step', name: 'A step', parts: [B(0, 0, 2, 1, 1, 1), B(0, 0, 1, 1, 1, 3)] },
    { id: 'bridge', name: 'A bridge', parts: [B(0, 0, 1, 1, 1, 1), B(2, 0, 1, 1, 1, 1), B(0, 0, 3, 1, 1, 2)] },
  ],
  2: [
    { id: 'bench', name: 'A bench', parts: [B(0, 0, 1, 1, 1, 1), B(2, 0, 1, 1, 1, 1), B(0, 0, 3, 1, 1, 2), B(1, 0, 1, 1, 1, 3)] },
    { id: 'corner', name: 'A corner', parts: [B(0, 0, 3, 1, 1, 2), B(0, 1, 1, 2, 1, 2), B(0, 0, 1, 1, 1, 4)] },
    { id: 'steps', name: 'Steps', parts: [B(0, 0, 3, 1, 1, 1), B(1, 0, 2, 1, 1, 2), B(2, 0, 1, 1, 1, 3)] },
  ],
  3: [
    { id: 'table', name: 'A table', parts: [B(0, 0, 1, 1, 2, 1), B(2, 0, 1, 1, 2, 1), B(0, 2, 1, 1, 2, 1), B(2, 2, 1, 1, 2, 1), B(0, 0, 3, 3, 1, 2)] },
    { id: 'house', name: 'A little house', parts: [B(0, 0, 3, 1, 1, 1), B(0, 2, 3, 1, 1, 1), B(0, 1, 1, 1, 1, 1), B(2, 1, 1, 1, 1, 1), B(0, 0, 3, 3, 1, 5)] },
    { id: 'stairs', name: 'Stairs', parts: [B(0, 0, 3, 1, 1, 1), B(1, 0, 2, 1, 1, 2), B(2, 0, 1, 1, 1, 3), B(0, 1, 3, 1, 1, 1), B(1, 1, 2, 1, 1, 2), B(2, 1, 1, 1, 1, 3)] },
  ],
  4: [
    { id: 'desk', name: 'A desk', parts: [B(0, 0, 1, 1, 2, 1), B(3, 0, 1, 1, 2, 1), B(0, 1, 1, 1, 2, 1), B(3, 1, 1, 1, 2, 1), B(0, 0, 4, 2, 1, 2), B(3, 0, 1, 1, 1, 3), PI(0, 1, 2, 4)] },
    { id: 'bed', name: 'A bed', parts: [B(0, 0, 1, 1, 1, 5), B(1, 0, 1, 1, 1, 5), B(0, 3, 1, 1, 1, 5), B(1, 3, 1, 1, 1, 5), B(0, 0, 2, 4, 1, 1), B(0, 0, 2, 1, 2, 2), PI(0, 1, 2, 3), BP(0, 2, 2, 2, 10, 4)] },
    { id: 'gate', name: 'A gate', parts: [B(0, 0, 1, 1, 3, 1), B(3, 0, 1, 1, 3, 1), B(0, 0, 4, 1, 1, 2), B(0, 0, 1, 1, 1, 3), B(3, 0, 1, 1, 1, 3), LB(1, 0, 1, 4), B(2, 0, 1, 1, 1, 4)] },
  ],
  5: [
    { id: 'castle', name: 'A castle', parts: [
      B(0, 0, 1, 1, 2, 1), B(3, 0, 1, 1, 2, 1), B(0, 3, 1, 1, 2, 1), B(3, 3, 1, 1, 2, 1),
      B(1, 0, 2, 1, 1, 2), B(1, 3, 2, 1, 1, 2), B(0, 1, 1, 2, 1, 2), B(3, 1, 1, 2, 1, 2),
      B(0, 0, 1, 1, 1, 3), B(3, 0, 1, 1, 1, 3), B(0, 3, 1, 1, 1, 3), B(3, 3, 1, 1, 1, 3)] },
    { id: 'bigHouse', name: 'A two-story house', parts: [
      BP(0, 0, 4, 3, 10, 5), B(0, 0, 4, 1, 1, 1), B(0, 2, 4, 1, 1, 1), B(0, 1, 1, 1, 1, 1), B(3, 1, 1, 1, 1, 1),
      B(0, 0, 4, 1, 1, 2), B(0, 2, 4, 1, 1, 2), B(0, 1, 1, 1, 1, 2), B(3, 1, 1, 1, 1, 2), B(0, 0, 4, 3, 1, 3)] },
  ],
});

/** A target as a build (settled, its own small floor). */
export function targetBuild(t) {
  return normalizeBuild({ id: `target-${t.id}`, name: t.name, floor: { w: 4 * GRID, d: 4 * GRID }, parts: t.parts.map((p, i) => ({ ...p, id: `t${i + 1}` })) });
}
/** The targets of a level, as builds. */
export const targetsFor = (level) => (TARGETS[levelOf(level)] || TARGETS[1]).map(targetBuild);

/** How this level is built: 'choose' or 'build' (`how`: 'level' follows the level). */
export function modeFor(level, how = 'level') {
  if (how === 'choose' || how === 'build') return how;
  return LEVELS[levelOf(level)].mode;
}

/** The order the parts go in: lowest first, then back to front, left to right (the order you would build it). */
export function buildOrder(parts) {
  return [...(parts || [])].sort((a, b) => (a.y - b.y) || (a.z - b.z) || (a.x - b.x));
}

const boxSig = (p) => worldBoxes(p).map((b) => [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1].join(',')).sort().join(';');
/** Is `a` the same part in the same place and colour as `b` (exactly: no turning, no shifting)? */
export const samePlaced = (a, b, { colours = true } = {}) => !!a && !!b && a.part === b.part && boxSig(a) === boxSig(b)
  && (!colours || a.colour === b.colour);

/**
 * The choices for the next part (pure): `n` parts, ONE of them right (`right: true`), the others near misses -- a
 * different colour, the same part a cell over, or a size bigger -- none of which is any part still to come (so a
 * wrong one is never also right). `attempt`: the parts put so far (a prefix of the target's build order). `rand`:
 * 0..1 (a suite passes its own). Returns [] when the model is finished.
 */
export function choicesFor(target, attempt, n = 2, rand = Math.random, { colours = true } = {}) {
  const order = buildOrder(target.parts || target);
  const done = (attempt || []).length;
  if (done >= order.length) return [];
  const right = order[done];
  const still = order.slice(done);
  const place = (p) => { const q = normalizePart({ ...p, id: 'c' }); q.y = restingY(q, attempt || []); return q; };
  const cands = [];
  const add = (p) => {
    const q = place(p);
    if (!q) return;
    if (still.some((t) => samePlaced(q, t, { colours }))) return;
    if (cands.some((c) => samePlaced(c, q, { colours: true }))) return;
    cands.push(q);
  };
  // Near misses, the most telling first: another colour (where colours count), a cell over, a size bigger.
  const others = COLOURS.filter((c) => c !== right.colour);
  if (colours) add({ ...right, colour: others[Math.floor(rand() * others.length) % others.length] });
  for (const [dx, dz] of [[GRID, 0], [0, GRID], [-GRID, 0], [0, -GRID]]) {
    if (right.x + dx < 0 || right.z + dz < 0) continue;
    add({ ...right, x: right.x + dx, z: right.z + dz });
  }
  add({ ...right, w: right.w + GRID });
  if (right.part === 'brick') add({ ...right, h: right.h + GRID });
  if (colours) for (const c of others) add({ ...right, colour: c });
  // Pick n - 1 of them, the first (colour) kept for the easy level where colour is the clearest difference.
  const pickFrom = [...cands];
  const wrong = [];
  while (wrong.length < n - 1 && pickFrom.length) {
    const i = wrong.length === 0 ? 0 : Math.floor(rand() * pickFrom.length) % pickFrom.length;
    wrong.push(pickFrom.splice(i, 1)[0]);
  }
  const all = [{ part: place(right), right: true }, ...wrong.map((p) => ({ part: p, right: false }))];
  // Shuffle, so the right one is not always first.
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)) % (i + 1); [all[i], all[j]] = [all[j], all[i]]; }
  return all;
}

/** The parts still wanted, by kind and size and colour (not place): for "Give me the next part". */
export function nextNeeded(target, attempt, { colours = true } = {}) {
  const key = (p) => { const s = specOf(p); const [a, b] = [s.dims[0], s.dims[1]].sort((x, y) => x - y); return `${p.part}|${a}x${b}x${s.dims[2]}|${colours ? p.colour : ''}`; };
  const have = new Map();
  for (const p of attempt || []) have.set(key(p), (have.get(key(p)) || 0) + 1);
  for (const t of buildOrder(target.parts || target)) {
    const k = key(t);
    if ((have.get(k) || 0) > 0) { have.set(k, have.get(k) - 1); continue; }
    return t;
  }
  return null;
}

/** Pairs of parts that share any space (a model must have none). For the suite. */
export function overlaps(parts) {
  const out = [];
  const boxes = (parts || []).map((p) => worldBoxes(p));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (boxes[i].some((a) => boxes[j].some((b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1 && a.z0 < b.z1 && b.z0 < a.z1))) out.push([i, j]);
  }
  return out;
}
export { settle };
