// sort_bricks.js — THE RULES OF SORT THE BRICKS, with no DOM and no clock of its own (brick games, row 2.76, 2026-10-10).
//
// Mike, 2026-10-09 (row 2.76): "Any other ideas for games with our bricks?" Two of chat's ideas, built as ONE game:
// "sort by colour or size (therapy-friendly, very easy levels)" and "match the brick to its slot (a shape sorter for the
// earliest levels)". `modules/sortbricks.js` is the panel; this file is the tray of bricks, the places they go and what a
// choice does, so a suite can play a whole game with numbers. `step(g, dt)` MUTATES `g` and returns what happened, the
// stack_line.js shape.
//
// *** OUR OWN GAME. *** A shape sorter and sorting by colour are old, free ideas. Nothing here is drawn from any toy:
// the bricks are Nimrod bricks seen from the front (brick_face.js, one keyed socket per 40 mm cell), in the theme's
// brick colours; a slot is the brick's own outline in a plate; a box is a plain box. No other toy's name or look.
//
// *** THE LEVELS (Rule 1: the table is the default, argued; the tray size and the rest are settings on the panel). ***
//   1 One slot      one brick, one slot it fits. ANY PRESS PUTS IT IN, and that is right: cause and effect, and the
//                   level a person who can only press one thing (or watch the demo) can always win.
//   2 Two slots     two slots of different lengths; the brick fits one. A shape sorter's first real choice.
//   3 Two colours   two boxes, each a colour; every brick goes in the box of its colour.
//   4 Three colours
//   5 Two sizes     two boxes, Short (40 mm) and Long (120 mm): the two lengths furthest apart that still read as
//                   bricks, so the first size choice is an easy one.
//   6 Three sizes   Short, Middle and Long (40, 80, 120 mm).
//   FOR colour before size: colour is seen at a glance; length has to be compared. FOR stopping at three places: three
//   is what a person can hold in view at once (card_sort.js argues the same number), and with one switch a lap of
//   three is already 12 s at the default light. AGAINST: no four- or five-way level for somebody who outgrows these. A
//   row in LEVELS adds one; the panel's level menu is built from this table.
//
// *** ONE THING DIFFERS BY DEFAULT (`mix: 'one'`, argued). *** At the colour levels every brick is the same length
// (2 cells); at the size levels every brick of a tray is the same colour. FOR: the thing to sort by is then the only
// thing that changes, which is the easiest version of the exercise. AGAINST: the real skill is ignoring what does not
// matter. `mix: 'both'` mixes lengths into the colour levels and colours into the size levels.
//
// *** A MISS COSTS NOTHING. *** A brick put in the wrong place comes back to the tray and the same brick is asked
// again. After `showAfter` misses on one brick (2 by default, the quiz games' "misses before offering the answer";
// 0 = never) the right place is shown. Nothing is ever taken away.

export const MOVE_MS = 700;           // a brick going into its place: long enough to SEE where it went (0 with reduced motion)
export const REST_MS = 3000;          // "All sorted!" stays this long (stack_line.js's rest), a press skips it
export const SIZES = Object.freeze([1, 2, 3, 4]);   // the 40 mm-high bricks, in cells (bricks.json: 40, 80, 120, 160 mm)
export const COLOUR_COUNT = 5;        // the theme's five brick colours (brick_colours.js)
export const MIXES = Object.freeze(['one', 'both']);
export const AFTER_TRAY = Object.freeze(['same', 'up']);
export const SAME_LENGTH = 2;         // the length every brick is at the colour levels with `mix: 'one'`

// What a size box is called, by its length. Plain words a person can say and hear.
export const SIZE_NAMES = Object.freeze({ 1: 'Short', 2: 'Middle', 3: 'Long', 4: 'Longest' });
const SIZE_SETS = Object.freeze({ 2: [1, 3], 3: [1, 2, 3], 4: [1, 2, 3, 4] });

export const LEVELS = Object.freeze({
  1: Object.freeze({ label: 'One slot', kind: 'slot', places: 1 }),
  2: Object.freeze({ label: 'Two slots', kind: 'slot', places: 2 }),
  3: Object.freeze({ label: 'Two colors', kind: 'colour', places: 2 }),
  4: Object.freeze({ label: 'Three colors', kind: 'colour', places: 3 }),
  5: Object.freeze({ label: 'Two sizes', kind: 'size', places: 2 }),
  6: Object.freeze({ label: 'Three sizes', kind: 'size', places: 3 }),
});
export const LEVEL_IDS = Object.freeze(Object.keys(LEVELS).map(Number));
export const levelOf = (n) => (LEVELS[Math.round(Number(n))] ? Math.round(Number(n)) : 1);

/** The tray size a setting may ask for (a stored value outside it is clamped, never trusted). */
export const TRAY_LIMITS = Object.freeze([1, 20]);
export const trayOf = (n, d = 5) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.max(TRAY_LIMITS[0], Math.min(TRAY_LIMITS[1], v)) : d;
};

const pickIndex = (rand, n) => Math.min(n - 1, Math.max(0, Math.floor((Number(rand()) || 0) * n)));
/** A shuffled copy (Fisher-Yates with the game's own random source). */
export function shuffled(list, rand = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = pickIndex(rand, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** `k` different values out of `list`, in a random order. */
const choose = (list, k, rand) => shuffled(list, rand).slice(0, Math.max(0, Math.min(k, list.length)));

/** Does this brick belong in this place? Pure. */
export function fits(kind, brick, place) {
  if (!brick || !place) return false;
  if (kind === 'colour') return brick.c === place.c;
  return brick.len === place.len;            // a slot and a size box both go by length
}
/** The index of the place this brick belongs in (-1: none, which a dealt tray never has). */
export const rightPlace = (g, brick = g.brick) => g.places.findIndex((p) => fits(g.kind, brick, p));

/**
 * A new game at `level`: a tray of `tray` bricks and the places they go. `mix` 'one' | 'both'. `rand` the game's own
 * random source (a suite passes a fixed one).
 */
export function newGame({ level = 1, tray = 5, mix = 'one', rand = Math.random } = {}) {
  const lv = levelOf(level);
  const g = {
    level: lv, kind: LEVELS[lv].kind, mix: MIXES.includes(mix) ? mix : 'one', trayN: trayOf(tray),
    places: [], tray: [], at: 0, brick: null, phase: 'ready',
    misses: 0, shown: -1, wrong: -1, wait: 0,
    sorted: 0, trays: 0, tries: 0, firstTry: 0, serial: 0, v: 0,
  };
  freshTray(g, { rand });
  return g;
}

/** Fill the tray again (the score kept): new places at the colour and size levels, new bricks. */
export function freshTray(g, { rand = Math.random, level = null } = {}) {
  if (level != null) { g.level = levelOf(level); g.kind = LEVELS[g.level].kind; }
  const L = LEVELS[g.level];
  const n = L.places;
  const bricks = [];
  if (g.kind === 'slot') {
    // A slot is part of the brick's own plate: each brick brings its places (`places` on the brick).
    for (let i = 0; i < g.trayN; i++) {
      const lens = choose(SIZES, n, rand);
      const len = lens[pickIndex(rand, lens.length)];
      bricks.push({ len, c: i % COLOUR_COUNT, id: ++g.serial, places: lens.map((l) => ({ len: l, items: [] })) });
    }
    g.places = bricks[0].places;
  } else if (g.kind === 'colour') {
    const cs = choose([0, 1, 2, 3, 4], n, rand).sort((a, b) => a - b);
    g.places = cs.map((c) => ({ c, items: [] }));
    // Balanced: every box gets bricks (when the tray is big enough), in a mixed order.
    const want = Array.from({ length: g.trayN }, (_, i) => cs[i % cs.length]);
    for (const c of shuffled(want, rand)) {
      const len = g.mix === 'both' ? SIZES[pickIndex(rand, 3)] : SAME_LENGTH;
      bricks.push({ len, c, id: ++g.serial });
    }
  } else {
    const lens = SIZE_SETS[n] || SIZE_SETS[2];
    g.places = lens.map((len) => ({ len, name: SIZE_NAMES[len], items: [] }));
    const one = pickIndex(rand, COLOUR_COUNT);
    const want = Array.from({ length: g.trayN }, (_, i) => lens[i % lens.length]);
    for (const len of shuffled(want, rand)) {
      bricks.push({ len, c: g.mix === 'both' ? pickIndex(rand, COLOUR_COUNT) : one, id: ++g.serial });
    }
  }
  g.tray = bricks;
  g.at = 0;
  deal(g);
  return g;
}

/** Put the next brick of the tray up (its slots too, at the slot levels). */
export function deal(g) {
  g.brick = g.tray[g.at] || null;
  if (g.kind === 'slot' && g.brick) g.places = g.brick.places;
  g.misses = 0; g.shown = -1; g.wrong = -1; g.wait = 0;
  g.phase = g.brick ? 'play' : 'ready';
  g.v++;
  return g.brick;
}

/** Bricks left to sort in this tray, the one up included. */
export const left = (g) => Math.max(0, g.tray.length - g.at);

/** Pause / go on. Idempotent with `on`. true when it changed. */
export function setPaused(g, on) {
  if (on && g.phase !== 'paused') { g.pausedFrom = g.phase; g.phase = 'paused'; g.v++; return true; }
  if (!on && g.phase === 'paused') { g.phase = g.pausedFrom || 'play'; g.pausedFrom = null; g.v++; return true; }
  return false;
}

/**
 * THE CHOICE: put the brick in place `i`. Returns the events: 'right' (and 'tray' when it was the last of the tray), or
 * 'wrong' (and 'show' when the right place is now shown). Opts: { showAfter, moveMs, restMs }.
 */
export function choosePlace(g, i, { showAfter = 2, moveMs = MOVE_MS, restMs = REST_MS } = {}) {
  if (g.phase !== 'play' || !g.brick) return [];
  const k = Math.round(Number(i));
  if (!Number.isInteger(k) || k < 0 || k >= g.places.length) return [];
  const events = [];
  g.tries++;
  if (fits(g.kind, g.brick, g.places[k])) {
    if (g.misses === 0) g.firstTry++;
    g.places[k].items.push({ len: g.brick.len, c: g.brick.c, id: g.brick.id });
    g.sorted++;
    g.wrong = -1;
    g.lastPlace = k;
    events.push('right');
    g.at++;
    if (g.at >= g.tray.length) {
      g.trays++;
      g.phase = 'won';
      g.wait = Math.max(0, moveMs) + Math.max(0, restMs);
      events.push('tray');
    } else {
      g.phase = 'moving';
      g.wait = Math.max(0, moveMs);
    }
  } else {
    g.misses++;
    g.wrong = k;
    events.push('wrong');
    const n = Math.round(Number(showAfter)) || 0;
    if (n > 0 && g.misses >= n && g.shown < 0) { g.shown = rightPlace(g); events.push('show'); }
  }
  g.v++;
  return events;
}

/**
 * Advance `dt` ms: a brick going into its place, then the next one; "All sorted!", then a fresh tray by itself.
 * Opts: { rand, afterTray: 'same' | 'up', level } - `level` is a level somebody chose while this tray was going: it
 * starts with the next tray, and wins over "one level up". Nothing runs while paused.
 */
export function step(g, dt, { rand = Math.random, afterTray = 'same', level = null } = {}) {
  const events = [];
  if (g.phase !== 'moving' && g.phase !== 'won') return events;
  g.wait -= Math.max(0, Number(dt) || 0);
  if (g.wait > 1e-9) return events;
  g.wait = 0;
  if (g.phase === 'moving') { deal(g); events.push('next'); return events; }
  const up = level == null && afterTray === 'up' && LEVELS[g.level + 1] ? g.level + 1 : null;
  freshTray(g, { rand, level: level != null ? levelOf(level) : up });
  events.push(up ? 'levelup' : 'fresh');
  return events;
}

// ---------------------------------------------------------------------------------------------------
// THE COLOUR NAMES. The panel reads the five brick colours off its own element (a panel wearing its own theme gets its
// own); this turns them into the names brick_colours.js gives them, so the voice says "teal", not "colour two".
// ---------------------------------------------------------------------------------------------------

/** '#rgb' / '#rrggbb' / 'rgb(r, g, b)' -> [r, g, b], or null (brick_mosaic.js's reader, kept here so this file has no
 * imports a panel does not already load). */
export function parseColour(s) {
  const t = String(s == null ? '' : s).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return m[1].split('').map((ch) => parseInt(ch + ch, 16));
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return [0, 2, 4].map((j) => parseInt(m[1].slice(j, j + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  if (m) return [1, 2, 3].map((j) => Math.max(0, Math.min(255, Math.round(Number(m[j])))));
  return null;
}
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * Names for five colours. `sets` is brick_colours.js BRICK_COLOURS. A theme whose five match exactly gives its own five
 * names; otherwise each colour takes the name of the nearest brick colour of any theme (a page with no theme applied: a
 * preview, a test). Two that would come out the same name are told apart by a number ("Teal 2"), so no two places are
 * ever said alike. Pure.
 */
export function colourNames(colours, sets) {
  const rgbs = colours.map((c) => parseColour(c));
  const all = [];
  for (const set of Object.values(sets || {})) for (const c of set) { const r = parseColour(c.hex); if (r) all.push({ name: c.name, rgb: r }); }
  const want = rgbs.map((r) => (r ? hex(r) : ''));
  for (const set of Object.values(sets || {})) {
    if (set.length >= want.length && want.every((h, i) => h && set[i] && String(set[i].hex).toLowerCase() === h)) {
      return want.map((_, i) => set[i].name);
    }
  }
  const names = rgbs.map((r, i) => {
    if (!r || !all.length) return `Color ${i + 1}`;
    let best = all[0];
    for (const a of all) if (dist(a.rgb, r) < dist(best.rgb, r)) best = a;
    return best.name;
  });
  const seen = {};
  return names.map((n) => { seen[n] = (seen[n] || 0) + 1; return seen[n] > 1 ? `${n} ${seen[n]}` : n; });
}

// ---------------------------------------------------------------------------------------------------
// THE BUILT-IN DEMO PLAYER, kind 'sort-bricks' (a registered agent that plays 'sortbricks' is asked first, game_agent.js).
// Calm and always right: it looks at the brick, lights the place it belongs in, then puts it there.
//   observation.state { phase, brick: { len, c, id }, places: [{ len?, c? }], kind, lit, right }
//   actions ['light', 'pick']     light: { act: 'light', place }   pick: { act: 'pick', place }
// ---------------------------------------------------------------------------------------------------
export const sortComputer = Object.freeze({
  id: 'computer', label: 'The computer', kinds: ['sort-bricks'],
  decide(obs) {
    const s = obs?.state;
    if (!s || s.phase !== 'play' || !s.brick || !(s.right >= 0)) return null;
    if (s.lit !== s.right) return { act: 'light', place: s.right };
    return { act: 'pick', place: s.right };
  },
});
