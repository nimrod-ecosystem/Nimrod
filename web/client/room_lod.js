// room_lod.js — HOW MUCH DETAIL A 3D SCENE'S OBJECTS GET ON THIS DEVICE: TWO LEVELS, A MEASURED BUDGET.
//
// Mike, 2026-10-02: "Do we need to make some sort of level of detail system?" Code's answer, built here:
// TWO LEVELS ONLY -- `full` up close, a generated `proxy` far away -- plus a PER-DEVICE BUDGET that drops
// objects to their proxy when the scene would cost more than this device should be asked to draw. Both
// levels come from the ONE source (the object's recipe entry); nobody draws or stores a second model.
//
// *** WHAT IT COVERS TODAY, SAID PLAINLY. *** The client renders NO meshes: there is no WebGL and no three.js
// anywhere in it (the bricks' GLBs in design-assets/bricks are published for download, never drawn). So the
// only 3D objects with a cost to manage are the CSS-3D room's furniture (room3d.js): a box of four faces,
// each a composited page element. Its proxy is ONE face -- the front, which is also its button when it is a
// door -- because a box drawn a few dozen pixels tall shows its sides and top as slivers nobody can see.
// This file knows nothing about boxes: `chooseLod` takes `{ id, w, h, faces, proxyFaces }` per object, so a
// mesh renderer (a brick with its sockets, a decimated GLB) plugs into the same selection when one exists.
//
// *** THE MEASUREMENT (`measureCapability`). *** Not a guess from the device's description: avatar_display.js
// already argued why `hardwareConcurrency` / `deviceMemory` cannot tell a Pi 400 (4 cores, 4 GB) from a
// laptop. This TIMES a fixed piece of work of the kind the site does all day -- serialising and reading back
// a 60-object recipe (JSON), which is allocation- and memory-bound, the place a small board falls furthest
// behind. Measured 2026-10-02, headless Chromium, 300 rounds (this file runs 100):
//     desktop (12 cores, the dev machine)   13-14 ms      bench Pi 400 (Chromium, Trixie)   42-48 ms
// ~3.2x apart and steady across runs. A pure-arithmetic loop was tried first and REJECTED: 12 ms vs 20 ms,
// only 1.7x, with one desktop run at 15-21 ms -- the JIT closes the gap. SLOW_MS = 8 per 100 rounds sits at
// the geometric middle of the two (4.5 and 14). It costs ~5 ms once per page on a desktop, ~40 ms on a Pi
// (best of three), and only when a 3D scene is drawn or a 3D card is offered.
//   It CANNOT see the GPU. The compositor is where a CSS-3D room really costs, and that needs frames, which a
//   hidden document never gives (rAF does not fire) -- so it is not measured here. On Mike's list.
//
// *** THE BUDGET, PER DEVICE, IN FACES DRAWN AT FULL DETAIL. ***
//   slow 24   the bench Pi held the box room (3 pieces, 12 furniture faces) at 60 fps at 1080p with the drift
//             on (9dab948). 24 is twice that measured-good point: a room twice as furnished stays full, and
//             past it the smallest pieces go to their proxy first. Above 24 is unmeasured, so it is not given.
//   fast 400  a desktop GPU composites hundreds of layers without noticing; 400 is a ceiling against a recipe
//             gone wrong (thousands of pieces), not a tuning.
//   Each is a DEFAULT: `room3dDetail` (below) overrides the measurement on a device, and a host can pass a
//   budget of its own (`lodBudget` on room3d.js).
//
// *** WHEN AN OBJECT IS "FAR". *** `nearPx` 64: an object drawn less than 64 CSS px in its larger dimension
// gets its proxy. At that size a box's side faces are ~4-10 px wide and its top a few px tall; under it, the
// four-face box and the one-face proxy are the same picture. Smaller and the saving is never taken; bigger
// and a person close to a large screen sees a piece go flat.

export const LOD_LEVELS = Object.freeze(['full', 'proxy']);
export const LOD_MODES = Object.freeze(['auto', 'full', 'proxy']);
export const LOD_DEFAULTS = Object.freeze({ nearPx: 64 });
export const BUDGETS = Object.freeze({ slow: 24, fast: 400 });
export const PROBE_ROUNDS = 100;
export const PROBE_RUNS = 3;
export const SLOW_MS = 8;

// The work timed: one recipe-sized object, out to text and back, PROBE_ROUNDS times.
const PROBE_RECIPE = Object.freeze({
  items: Array.from({ length: 60 }, (_, i) => ({ id: `thing${i}`, kind: 'furniture', x: i * 1.5, y: 66, part: 'desk', opens: i % 3 ? null : `dash${i}` })),
});
function probeWork(rounds) {
  let acc = 0;
  for (let i = 0; i < rounds; i++) {
    const s = JSON.stringify(PROBE_RECIPE);
    acc += JSON.parse(s).items.length + s.length;
  }
  return acc;
}

/**
 * Time the fixed work: `{ ms, slow, rounds, measured: true }`, `ms` the best of PROBE_RUNS runs (the least
 * disturbed by anything else the page is doing). `now` is injectable (a test).
 */
export function measureCapability({ now = () => (globalThis.performance ? performance.now() : Date.now()),
  rounds = PROBE_ROUNDS, runs = PROBE_RUNS, slowMs = SLOW_MS } = {}) {
  probeWork(Math.max(1, Math.round(rounds / 10)));      // warm the JIT, so the first run is not the slow one
  let best = Infinity;
  for (let r = 0; r < Math.max(1, runs); r++) {
    const t = now();
    probeWork(rounds);
    best = Math.min(best, now() - t);
  }
  const ms = Math.round(best * 100) / 100;
  return { ms, slow: ms > slowMs, rounds, measured: true };
}

// Measured once per page and kept: the device does not change while the page is open.
let cached = null;
/**
 * This device's capability: the measurement (cached), or what the person chose (`detail`: 'full' says
 * "treat it as fast", 'proxy' "treat it as slow"; 'auto' or nothing measures). `{ ms, slow, measured, chosen }`.
 */
export function deviceCapability({ detail = 'auto', fresh = false, measure = measureCapability } = {}) {
  if (detail === 'full') return { ms: null, slow: false, measured: false, chosen: 'full' };
  if (detail === 'proxy') return { ms: null, slow: true, measured: false, chosen: 'proxy' };
  if (!cached || fresh) {
    try { cached = measure(); } catch { cached = { ms: null, slow: false, measured: false }; }
  }
  return { ...cached, chosen: 'auto' };
}
/** Forget the cached measurement (a test). */
export const resetCapability = () => { cached = null; };

/** The face budget a capability earns (see BUDGETS). */
export const budgetFor = (cap) => (cap && cap.slow ? BUDGETS.slow : BUDGETS.fast);

/**
 * *** WHICH LEVEL EACH OBJECT GETS. *** Pure: the same input always gives the same answer.
 *   objects  [{ id, w, h, faces, proxyFaces }]: its drawn size in STAGE px, and what each level costs
 *   scale    stage px -> CSS px (the room's fit)
 *   mode     'auto' | 'full' (everything full) | 'proxy' (everything a proxy)
 *   nearPx   under this many CSS px in its larger dimension, an object is far (auto only)
 *   budget   faces at most (auto only); past it, the SMALLEST full objects drop first, until it fits
 * Returns `{ levels: Map id -> 'full' | 'proxy', cost, budget, far: [ids], dropped: [ids] }`. An object
 * whose proxy alone is over the budget still gets its proxy: the budget lowers detail, it never hides a thing.
 */
export function chooseLod(objects = [], { scale = 1, mode = 'auto', nearPx = LOD_DEFAULTS.nearPx, budget = Infinity } = {}) {
  const list = (Array.isArray(objects) ? objects : []).filter((x) => x && x.id != null).map((x) => ({
    id: x.id,
    px: Math.max(Number(x.w) || 0, Number(x.h) || 0) * (Number(scale) > 0 ? Number(scale) : 1),
    full: Math.max(0, Number(x.faces) || 0),
    proxy: Math.max(0, Number(x.proxyFaces) || 0),
  }));
  const m = LOD_MODES.includes(mode) ? mode : 'auto';
  const near = Number.isFinite(Number(nearPx)) && Number(nearPx) >= 0 ? Number(nearPx) : LOD_DEFAULTS.nearPx;
  const cap = Number.isFinite(Number(budget)) && Number(budget) >= 0 ? Number(budget) : Infinity;
  const levels = new Map();
  const far = [], dropped = [];
  for (const o of list) {
    const lvl = m === 'full' ? 'full' : m === 'proxy' ? 'proxy' : o.px >= near ? 'full' : 'proxy';
    if (m === 'auto' && lvl === 'proxy') far.push(o.id);
    levels.set(o.id, lvl);
  }
  const costOf = () => list.reduce((s, o) => s + (levels.get(o.id) === 'full' ? o.full : o.proxy), 0);
  let cost = costOf();
  if (m === 'auto' && cost > cap) {
    // Smallest on screen first: what is dropped is what is least seen. Ties: the later one in the recipe.
    const order = list.map((o, i) => ({ o, i })).filter(({ o }) => levels.get(o.id) === 'full')
      .sort((a, b) => (a.o.px - b.o.px) || (b.i - a.i));
    for (const { o } of order) {
      if (cost <= cap) break;
      levels.set(o.id, 'proxy');
      cost -= o.full - o.proxy;
      dropped.push(o.id);
    }
  }
  return { levels, cost, budget: cap, far, dropped };
}

// *** "MAY BE SLOW ON THIS DEVICE": A NOTE, NEVER A HIDING. *** A 3D starting point or scene stays on offer on
// every device -- a person who wants it is entitled to try it -- and on a device the measurement calls slow it
// carries this line. The scene kinds that are 3D: room3d.js's, and nothing else yet.
export const SLOW_NOTE = 'May be slow on this device';
export const THREE_D_KINDS = Object.freeze(['room3d']);
/** The note for a scene/starting-point kind on a device, or '' (not 3D, or not slow). */
export function slowNote(kind, cap) {
  return THREE_D_KINDS.includes(kind) && cap && cap.slow ? SLOW_NOTE : '';
}

// *** THE DEVICE'S OWN SETTING (a row for settings_fields.js; this file does not add it). *** 'auto' follows
// the measurement; 'full' and 'proxy' are for the person who knows better than a 5 ms timing (a fast Pi 5,
// a slow laptop on battery). Per device, because the capability is the device's.
export const DETAIL_KEY = 'room3dDetail';
export const DETAIL_FIELD = Object.freeze({
  key: DETAIL_KEY,
  label: '3D detail on this device',
  kind: 'choice',
  default: 'auto',
  level: 'advanced',
  options: Object.freeze([
    Object.freeze({ value: 'auto', label: 'As this device can manage (measured)' }),
    Object.freeze({ value: 'full', label: 'Always full detail' }),
    Object.freeze({ value: 'proxy', label: 'Always light (simple shapes)' }),
  ]),
  note: 'How much detail 3D rooms draw. Light keeps every object and every door; it draws them as simpler shapes.',
  automatable: false,
});
/** room3d.js options for a device's choice: `{ lod, capability }`. */
export function lodOptionsFor(detail = 'auto') {
  const d = LOD_MODES.includes(detail) ? detail : 'auto';
  return { lod: d, capability: deviceCapability({ detail: d }) };
}
