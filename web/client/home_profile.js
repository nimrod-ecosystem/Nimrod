// home_profile.js — YOUR HOME, MADE YOUR OWN: Design's profile editor and scene editor, over a REAL
// dashboard. Everything here is pure (data in, data out), so `dev/home_profile_test.html` checks it
// without a page; `modules.html` does the reading, the writing and the drawing.
//
// Mike, 2026-10-02: *"The profiles are wrong. That's what the rooms and stuff are for. Can we just start out
// with the profile and scene editors that design made?"* and *"this shouldn't be a hidden feature on the
// transport bar. I'm expecting the home page to be your profile, and you add whatever modules you want to
// make it your own."* And: *"modules on a dashboard should be as hot swappable as possible."*
//
// *** WHAT DESIGN'S EDITORS ARE, AND WHAT THEY BECAME. *** Design's profile editor is the home-dashboard
// handoff's EDIT BAR (`dashboard.js`: Room / Add / Change: <thing> / Undo / Redo, each a tray of buttons a
// single switch can reach, "nothing needs a drag"); its scene editor is the same bar's Room tray plus the
// room-is-the-screen prototype's picker of rooms and grounds. Both edited a ROOM RECIPE held in the page.
// Here they edit the person's real dashboard:
//   Scene      -> which backdrop: one of Design's rooms (layout.scene), the 3D room (room3d.js), a live theme,
//                 or a still one; and for a room, Design's own rows (shape, walls, floor, light, out of the
//                 window) on its recipe -- for the 3D room its own (camera drift, depth; ROOM3D_ROWS)
//   Add        -> a MODULE (any part from the catalog) or one of the profile's old pieces (picture frame,
//                 name sign), placed where it fits: a free grid cell, else on the room's back wall, else
//                 flat on the screen
//   Change     -> the thing chosen: previous / next, SWITCH MODULE (another module in the same place, one
//                 press), move, smaller / bigger, remove
//   Transform… -> the site's own Transform and Layers windows (edit_windows.js, the dashboard's `edit()`),
//                 not a second copy of them
//   Undo/Redo  -> snapshots of the arrangement AND the modules on it (so undoing a Remove brings the module
//                 back with its settings)
// What Design's prototype had that the site already has is wired, not redrawn: Save / Save as / History
// (home_dashboard.js), the module picker (Modules), the Transform/Layers windows.
//
// *** WHERE A CHANGE GOES. *** What is ON the dashboard and WHERE (add, remove, switch, move, the room) saves
// as it is made -- the composer and the edit windows already work that way, and a module that has been
// added exists on the server whether or not anybody presses Save. A SETTING (a theme picked in Scene, a
// row in the ⚙ menu) waits for Save, as everything on Home's draft does. Undo reverses either kind.

import { PLACED_DEFAULTS } from './layout.js';
import { ROOM_PRESETS, presetRecipe } from './room_presets.js';
import { ROOM_SHELLS, WALL_FINISHES, FLOOR_FINISHES } from './room_parts.js';
import { THEMES, DEFAULT_THEME, paintedTheme } from './theme.js';
import { profileSetup } from './game/game.js';
import { ROOM3D_PRESETS, ROOM3D_DEFAULT_PRESET, ROOM3D_DEFAULTS, normalizeRoom3d, viewOf, slotSpot } from './room3d.js';
import { tidyScene } from './room_doors.js';

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// =====================================================================================================
// THE NUMBERS (Rule 1: each argued; none is a person's preference, so none is a menu row -- the Transform
// window types any exact value, and these are only what one press of a button does).
//   MOVE_STEP 3      Design's prototype ("Move left" = 3% of the room). Small enough to line things up in
//                    a few presses, big enough that a switch user is not pressing forty times to cross.
//   SIZE_STEP 0.1    Design's prototype ("Smaller" / "Bigger" = 10%).
//   SIZE_RANGE       5–100% of the dashboard: smaller than 5% is not readable on a TV across a room;
//                    100% is the whole screen (layout.js's own w/h limit).
//   UNDO_LIMIT 40    Design's prototype keeps the last 40 changes. Each step here can hold every module's
//                    settings, so more would be memory for nothing on a Pi.
// =====================================================================================================
export const MOVE_STEP = 3;
export const SIZE_STEP = 0.1;
export const SIZE_RANGE = Object.freeze([5, 100]);
export const UNDO_LIMIT = 40;

// Where an added thing lands when there is no free grid cell, in order (x, y centre in %), so a second
// added thing does not sit exactly on the first. On a room these are on the BACK wall (16–84 across, above
// the floor line at 66); flat, they are spread over the screen. Code's guess, on Mike's list; Transform or
// the Move buttons put a thing anywhere.
export const ADD_SPOTS_ROOM = Object.freeze([[50, 30], [30, 26], [70, 26], [38, 46], [62, 46]]);
export const ADD_SPOTS_FLAT = Object.freeze([[50, 50], [30, 35], [70, 35], [30, 65], [70, 65]]);
export const ADD_SIZE_ROOM = Object.freeze({ w: 18, h: 22 });
export const ADD_SIZE_FLAT = Object.freeze({ w: PLACED_DEFAULTS.w, h: PLACED_DEFAULTS.h });
// *** THE 3D ROOM (2026-10-02). *** An added thing goes, in order: where one of the room's own slots is still
// EMPTY (hung there as a free placement at exactly the slot's place and size -- room3d.js `slotSpot` -- so
// Move and Bigger work on it, which they cannot on a thing IN a slot); then these spots, on the back wall.
// Its back wall is drawn 20-80% across and about 6-66% down (room3d.js: lens 700, depth 467, eye 15), with
// the default room's own back-wall slot in its middle (about 34-66 across, 16-44 down), so the spots are the
// two upper corners beside that slot, then the lower left one (the lower right is behind the bookshelf).
// After those they repeat, and things overlap, which Move fixes. Smaller than the 2D room's (12 x 16, not
// 18 x 22): a face CLIPS what overhangs it, and 12% across is the widest that fits between the slot and the
// wall's edge. Code's guess, on Mike's list.
export const ADD_SPOTS_ROOM3D = Object.freeze([
  Object.freeze({ surface: 'back', x: 27, y: 18 }), Object.freeze({ surface: 'back', x: 73, y: 18 }),
  Object.freeze({ surface: 'back', x: 27, y: 44 }),
]);
export const ADD_SIZE_ROOM3D = Object.freeze({ w: 12, h: 16 });

// =====================================================================================================
// THE PROFILE'S OLD PIECES, KEPT AS THINGS ANYBODY CAN ADD. Mike retired "a picture frame and a name sign"
// AS the profile; they are still good things to hang on a wall. Each is a `button` module with the profile
// game's starting settings (game/game.js profileSetup), so one added here is the same as one the old
// profile made -- and old profiles keep loading, untouched.
// =====================================================================================================
export const ADD_PIECES = Object.freeze([
  Object.freeze({ key: 'piece:picture', type: 'button', start: 'picture', label: 'Picture frame',
    hint: 'an empty frame: choose the picture in its ⚙ menu' }),
  Object.freeze({ key: 'piece:sign', type: 'button', start: 'sign', label: 'Name sign',
    hint: 'your name, on a sign' }),
]);
/** The starting settings for one piece (null for a plain module, which starts as it always does). */
export function pieceState(key, personName = '') {
  const p = ADD_PIECES.find((x) => x.key === key);
  if (!p) return null;
  const s = profileSetup(personName);
  return p.start === 'picture' ? { ...s.picture } : { ...s.sign };
}

// =====================================================================================================
// THE ARRANGEMENT, CHANGED. A layout is layout.js's shape: { preset, slots, placed?, scene? }. Nothing here
// checks ids against the screen (the caller's normalizeLayout does, after the module exists).
// =====================================================================================================
export function layoutIds(layout) {
  const L = layout || {};
  return [...(L.slots || []).filter(Boolean), ...(L.placed || []).map((p) => p && p.id).filter(Boolean)];
}

/** Where a module is: { kind: 'slot', index } | { kind: 'placed', entry } | null. */
export function whereIs(layout, id) {
  const L = layout || {};
  const i = (L.slots || []).indexOf(id);
  if (id && i >= 0) return { kind: 'slot', index: i };
  const e = (L.placed || []).find((p) => p && p.id === id);
  return e ? { kind: 'placed', entry: { ...e } } : null;
}

/**
 * *** THE HOT SWAP, AS DATA. *** `newId` takes `oldId`'s place: the same grid cell, or the same placed
 * entry with every bit of its geometry (x, y, w, h, scale, rot, layer, surface, slot, door) kept. Nothing
 * else moves. A module the layout does not place is not swapped (null: the caller says so).
 */
export function swapInLayout(layout, oldId, newId) {
  if (!layout || !oldId || !newId || !whereIs(layout, oldId)) return null;
  const L = clone(layout);
  if (Array.isArray(L.slots)) L.slots = L.slots.map((s) => (s === oldId ? newId : s));
  if (Array.isArray(L.placed)) L.placed = L.placed.map((p) => (p && p.id === oldId ? { ...p, id: newId } : p));
  return L;
}

/** Every id renamed by `map` (oldId -> newId): what an undo uses when a module comes back under a new id. */
export function remapLayoutIds(layout, map = {}) {
  if (!layout) return layout;
  const L = clone(layout);
  const to = (id) => (id && map[id] ? map[id] : id);
  if (Array.isArray(L.slots)) L.slots = L.slots.map(to);
  if (Array.isArray(L.placed)) L.placed = L.placed.map((p) => (p ? { ...p, id: to(p.id) } : p));
  return L;
}

/** The module off the dashboard: its cell emptied, or its placed entry gone. */
export function removeFromLayout(layout, id) {
  if (!layout) return layout;
  const L = clone(layout);
  if (Array.isArray(L.slots)) L.slots = L.slots.map((s) => (s === id ? null : s));
  if (Array.isArray(L.placed)) {
    L.placed = L.placed.filter((p) => p && p.id !== id);
    if (!L.placed.length) delete L.placed;
  }
  return L;
}

// *** WHICH KIND OF ROOM (2026-10-02). *** Design's 2D room (`room`, room_scene.js) and the CSS-3D room
// (`room3d`, room3d.js) are both ROOMS for placement -- a module goes ON a wall, never into the backdrop's
// cell, and going back to a theme takes things off the walls -- but they are different rooms for EDITING:
// the 2D room's rows (shape, walls, floor, light, window) are about its recipe's drawn parts, which the 3D
// room does not have (its colours are the theme's). So two predicates, and every use says which it means.
const isRoom2d = (layout) => !!(layout && layout.scene && layout.scene.kind === 'room');
const isRoom3d = (layout) => !!(layout && layout.scene && layout.scene.kind === 'room3d');
const isAnyRoom = (layout) => isRoom2d(layout) || isRoom3d(layout);

/** A 3D room's recipe and view, as room3d.js would draw them. */
function room3dOf(layout) {
  const recipe = normalizeRoom3d(layout.scene);
  return { recipe, view: viewOf(recipe, ROOM3D_DEFAULTS) };
}

/**
 * Where the next thing added to a 3D room goes (ADD_SPOTS_ROOM3D argues the order): an EMPTY slot's place
 * first, then the spots not already taken, then round again. `{ surface, x, y, w, h }`.
 */
export function room3dSpot(layout) {
  const { recipe, view } = room3dOf(layout);
  const placed = (layout.placed || []).filter(Boolean);
  const filled = new Set(placed.map((p) => p.slot).filter(Boolean));
  const at = (s) => placed.some((p) => !p.slot && (p.surface || 'back') === s.surface && p.x === s.x && p.y === s.y);
  for (const sl of recipe.slots) {
    if (filled.has(sl.id)) continue;
    const s = slotSpot(sl, view);
    if (!at(s)) return s;
  }
  const free = ADD_SPOTS_ROOM3D.find((s) => !at(s));
  const s = free || ADD_SPOTS_ROOM3D[placed.length % ADD_SPOTS_ROOM3D.length];
  return { surface: s.surface, x: s.x, y: s.y, ...ADD_SIZE_ROOM3D };
}

/** A placed entry IN a 3D room's slot, taken out of it at exactly the slot's place (so it can move). */
function unslot3d(layout, entry) {
  const { recipe, view } = room3dOf(layout);
  const sl = recipe.slots.find((s) => s.id === entry.slot);
  const { slot, ...rest } = entry;     // eslint-disable-line no-unused-vars
  if (!sl) return rest;
  const s = slotSpot(sl, view);
  return { ...rest, surface: s.surface, x: s.x, y: s.y, w: s.w, h: s.h };
}

/**
 * A new module ON the dashboard. `null` layout (the one-at-a-time stage: every module takes its turn) needs
 * no entry -- the module joins the stage by existing -- so it is returned as it was. Otherwise: the first
 * free grid cell; else placed, on the room's back wall (a room), on a 3D room's wall (room3dSpot), or flat
 * on the screen, at the next spot not already taken.
 */
export function addToLayout(layout, id) {
  if (!layout || !id) return layout;
  const L = clone(layout);
  if (layoutIds(L).includes(id)) return L;
  const room = isAnyRoom(L);
  const free = Array.isArray(L.slots) ? L.slots.indexOf(null) : -1;
  // A free cell, but NOT on a room: a room's single 'full' cell is the backdrop's, and a module in it would
  // cover the whole room.
  if (free >= 0 && !room) { L.slots[free] = id; return L; }
  if (isRoom3d(L)) {
    const s = room3dSpot(L);
    L.placed = [...(L.placed || []), { id, place: 'scene', surface: s.surface, x: s.x, y: s.y, w: s.w, h: s.h }];
    return L;
  }
  const spots = room ? ADD_SPOTS_ROOM : ADD_SPOTS_FLAT;
  const size = room ? ADD_SIZE_ROOM : ADD_SIZE_FLAT;
  const taken = new Set((L.placed || []).map((p) => `${p.x},${p.y}`));
  const at = spots.find(([x, y]) => !taken.has(`${x},${y}`)) || spots[(L.placed || []).length % spots.length];
  const entry = room
    ? { id, place: 'scene', surface: 'back', x: at[0], y: at[1], ...size }
    : { id, place: 'screen', x: at[0], y: at[1], ...size };
  L.placed = [...(L.placed || []), entry];
  return L;
}

// *** OVER THE DASHBOARD (Mike, 2026-10-03). *** Add with "Over the dashboard" chosen puts a module over the
// dashboard as a small panel in a corner, out of the switch lap; a clock or a camera becomes the corner clock /
// mirror. layout.js "OVER THE DASHBOARD" argues each number and choice.
// The numbers and the placing live in layout.js (the bare kiosk's ⚙ menu and the Modules library place overlays
// too, and neither loads this file); re-exported here, where Home reads them.
export { OVERLAY_SIZE, OVERLAY_MARGIN, OVERLAY_CORNERS, overlaySpot, cornerOf, addAsOverlay } from './layout.js';

// A thing IN one of a 3D room's slots comes out of it first, at the slot's own place, so a press of Move or
// Bigger moves it from where it is seen (a slot holds its module at the slot's box whatever x/y say). The 2D
// room's slots are left as they were: where one is drawn is room_scene.js's to say, not this file's.
const freed = (layout, p) => (p && p.slot && isRoom3d(layout) ? unslot3d(layout, p) : p);

/** Move a PLACED thing by (dx, dy) percent. A thing in a grid cell does not move (null: say so). */
export function nudgeInLayout(layout, id, dx, dy) {
  const w = whereIs(layout, id);
  if (!w || w.kind !== 'placed') return null;
  const L = clone(layout);
  L.placed = L.placed.map((p0) => {
    if (!p0 || p0.id !== id) return p0;
    const p = freed(layout, p0);
    const x = typeof p.x === 'number' ? p.x : PLACED_DEFAULTS.x;
    const y = typeof p.y === 'number' ? p.y : PLACED_DEFAULTS.y;
    return { ...p, x: round1(clamp(x + dx, 0, 100)), y: round1(clamp(y + dy, 0, 100)) };
  });
  return L;
}

/** Smaller (-) or bigger (+) by `step` (a fraction): w and h together, kept inside SIZE_RANGE. */
export function resizeInLayout(layout, id, step) {
  const w = whereIs(layout, id);
  if (!w || w.kind !== 'placed') return null;
  const L = clone(layout);
  const [lo, hi] = SIZE_RANGE;
  L.placed = L.placed.map((p0) => {
    if (!p0 || p0.id !== id) return p0;
    const p = freed(layout, p0);
    const f = 1 + step;
    const pw = typeof p.w === 'number' ? p.w : PLACED_DEFAULTS.w;
    const ph = typeof p.h === 'number' ? p.h : PLACED_DEFAULTS.h;
    return { ...p, w: round1(clamp(pw * f, lo, hi)), h: round1(clamp(ph * f, lo, hi)) };
  });
  return L;
}

/** The saved layout with the placed entries the edit windows left (what Transform changed), nothing else. */
export function withPlaced(base, placed) {
  const L = clone(base) || { preset: 'full', slots: [null] };
  if (Array.isArray(placed) && placed.length) L.placed = clone(placed); else delete L.placed;
  return L;
}

// =====================================================================================================
// THE SCENE EDITOR. A dashboard's backdrop is EITHER one of Design's rooms (`layout.scene`, drawn by
// room_scene.js) OR its theme -- a live one (a scene that moves: fall, winter...) or a still one. One list,
// so "change the scene" is one tray, whichever kind somebody wants next.
// =====================================================================================================
// 2026-10-02: the 3D room (room3d.js) is a choice of its own kind, listed after Design's rooms -- the order
// Home's starting points put it in (dashboards.js EXAMPLE_ORDER).
// *** STILL, LIVE, ROOMS, 3D (Mike, 2026-10-02: "The still themes like Nimrod light should come first"). ***
// The tray's groups go in that order (dashboards.js KIND_ORDER), and within Still the default theme --
// "Nimrod (light)" -- comes first (theme.js lists it first, and it is put first here whatever that order).
export const SCENE_KINDS = Object.freeze({ static: 'Still', live: 'Moving scenes', room: 'Rooms', room3d: 'Rooms in 3D' });
const ROOM_KINDS = new Set(['room', 'room3d']);

export function sceneChoices() {
  const rooms = Object.entries(ROOM_PRESETS).map(([k, p]) => ({ id: `room:${k}`, kind: 'room', key: k, label: p.label }));
  const rooms3d = Object.entries(ROOM3D_PRESETS).map(([k, p]) => ({ id: `room3d:${k}`, kind: 'room3d', key: k, label: p.label }));
  const themes = Object.entries(THEMES).map(([k, t]) => ({ id: `theme:${k}`, kind: t.scene ? 'live' : 'static', key: k, label: t.label || k }));
  const still = themes.filter((t) => t.kind === 'static').sort((a, b) => (b.key === DEFAULT_THEME) - (a.key === DEFAULT_THEME));
  return [...still, ...themes.filter((t) => t.kind === 'live'), ...rooms, ...rooms3d];
}

/** Which choice is showing now. A room edited in place still names the room it started from. */
export function currentScene(layout, theme) {
  if (isAnyRoom(layout)) return `${layout.scene.kind}:${layout.scene.preset || 'custom'}`;
  return `theme:${THEMES[theme] ? theme : DEFAULT_THEME}`;
}

/**
 * Pick a scene. Returns { layout, theme } -- `theme` undefined means "leave the theme as it is".
 *   A ROOM: the layout gets the room. Modules in grid cells move ONTO the back wall (a full grid would
 *     cover the room), each at the next ADD_SPOTS_ROOM spot; modules placed flat stay flat, over it. A live
 *     theme underneath is put back to the still default: a second moving world behind a room is something
 *     nobody sees and the Pi pays for (Design's Pi budget: "one live scene").
 *   A THEME: the room goes. Things placed IN the room come off its walls and stay where they were, flat.
 */
// `ids`: every module on the dashboard. Used only when there is no arrangement yet (the one-at-a-time
// stage, where every module takes its turn): going to a room then hangs each of them on its wall, or they
// would be on the dashboard and nowhere to be seen.
export function applyScene(layout, choiceId, { theme = null, ids = [] } = {}) {
  const c = sceneChoices().find((x) => x.id === choiceId);
  if (!c) return null;
  const base = clone(layout) || { preset: 'full', slots: [null] };
  if (ROOM_KINDS.has(c.kind)) {
    const L = { ...base };
    const moved = layout ? [] : [...ids];
    for (const id of (L.slots || []).filter(Boolean)) moved.push(id);
    const was = isAnyRoom(base) ? base.scene : null;
    // The SAME room picked again keeps what sits in its slots (they still mean the same places). Any other
    // room: a slot of the old one means nothing in the new one -- such a thing hangs on a wall instead, at
    // the slot's own place when the old room was 3D (room3d.js can say where that was), else a spot.
    const same = !!was && was.kind === c.kind && (was.preset || null) === c.key;
    let placed = [...(L.placed || [])].map((p) => {
      if (!p || !p.slot || same) return p;
      if (isRoom3d(base)) return unslot3d(base, p);
      const { slot, ...rest } = p;     // eslint-disable-line no-unused-vars
      return { ...rest, surface: 'back', x: rest.x ?? ADD_SPOTS_ROOM[0][0], y: rest.y ?? ADD_SPOTS_ROOM[0][1], w: rest.w ?? ADD_SIZE_ROOM.w, h: rest.h ?? ADD_SIZE_ROOM.h };
    });
    L.preset = 'full';
    L.slots = [null];
    // The room already showing, pressed again, is kept AS IT IS -- its own recipe (walls, doors, depth) and a
    // 3D room's drift are choices made for this dashboard, and the pressed button is the one marked current.
    L.scene = same ? clone(was) : { kind: c.kind, preset: c.key };
    for (const id of moved) {
      if (placed.some((p) => p && p.id === id)) continue;
      if (c.kind === 'room3d') {
        const s = room3dSpot({ ...L, placed });
        placed.push({ id, place: 'scene', surface: s.surface, x: s.x, y: s.y, w: s.w, h: s.h });
        continue;
      }
      const taken = new Set(placed.map((p) => `${p.x},${p.y}`));
      const at = ADD_SPOTS_ROOM.find(([x, y]) => !taken.has(`${x},${y}`)) || ADD_SPOTS_ROOM[placed.length % ADD_SPOTS_ROOM.length];
      placed.push({ id, place: 'scene', surface: 'back', x: at[0], y: at[1], ...ADD_SIZE_ROOM });
    }
    if (placed.length) L.placed = placed; else delete L.placed;
    // (2026-10-05: "With the seasons" counts by what it paints today - Fall's woods are a moving world too.)
    const live = theme && paintedTheme(theme).scene;
    return { layout: L, theme: live ? DEFAULT_THEME : undefined };
  }
  if (!layout) return { layout: null, theme: c.key };
  const L = { ...base };
  delete L.scene;
  if (Array.isArray(L.placed)) {
    L.placed = L.placed.map((p0) => {
      if (!p0 || p0.place !== 'scene') return p0;
      // Out of a 3D room's slot: flat at the place it was seen (2D slots: the default spot, as before).
      const p = p0.slot && isRoom3d(base) ? unslot3d(base, p0) : p0;
      const { slot, surface, ...rest } = p;   // eslint-disable-line no-unused-vars
      return { ...rest, place: 'screen', x: rest.x ?? PLACED_DEFAULTS.x, y: rest.y ?? PLACED_DEFAULTS.y,
        w: rest.w ?? ADD_SIZE_FLAT.w, h: rest.h ?? ADD_SIZE_FLAT.h };
    });
  }
  return { layout: L, theme: c.key };
}

// Design's Room tray (home-dashboard `dashboard.js` ROOM_ROWS), each row CYCLING its value on a press.
// Wall colour is not a row: Design's swatches are a fixed list of colours, and each finish already brings
// its own colour (room_parts.js); a colour picker for walls is a later change, on Mike's list.
export const ROOM_LIGHTS = Object.freeze([['auto', 'The real time'], ['day', 'Day'], ['evening', 'Evening'], ['night', 'Night']]);
export function roomViews() {
  return [['auto', 'Follow the light'],
    ...Object.entries(THEMES).filter(([, t]) => t.scene).map(([k, t]) => [t.scene, (t.label || k).split(' — ')[0]])];
}
export const ROOM_ROWS = Object.freeze([
  Object.freeze({ key: 'shell', label: 'Room shape', options: () => Object.entries(ROOM_SHELLS).map(([k, v]) => [k, v.label]),
    get: (r) => r.shell || 'room', set: (r, v) => { r.shell = v; } }),
  Object.freeze({ key: 'wall', label: 'Walls', options: () => Object.entries(WALL_FINISHES).map(([k, v]) => [k, v.label]),
    get: (r) => (r.wall && r.wall.finish) || 'paint', set: (r, v) => { r.wall = { ...(r.wall || {}), finish: v, color: WALL_FINISHES[v].color }; } }),
  Object.freeze({ key: 'floor', label: 'Floor', options: () => Object.entries(FLOOR_FINISHES).map(([k, v]) => [k, v.label]),
    get: (r) => (r.floor && r.floor.finish) || 'boards', set: (r, v) => { r.floor = { ...(r.floor || {}), finish: v, color: FLOOR_FINISHES[v].color }; } }),
  Object.freeze({ key: 'light', label: 'Light', options: () => ROOM_LIGHTS,
    get: (r) => r.light || 'auto', set: (r, v) => { r.light = v; } }),
  Object.freeze({ key: 'view', label: 'Out of the window', options: () => roomViews(),
    get: (r) => r.view || 'auto', set: (r, v) => { r.view = v; } }),
]);

// *** THE 3D ROOM'S ROWS (2026-10-02), on the SCENE, not on a 2D recipe. *** Its colours are the theme's, it
// has no light or window, so none of the rows above means anything there; these two are its own.
//   drift   the camera's slow sway (room3d.js argues it OFF by default: motion is opt-in). Per dashboard, in
//           `layout.scene.options.drift` (layout.js keeps only 'on'). On is a REQUEST: the device's reduced-
//           motion setting, and room3d.js's 'still', always win, and the row says so when they do.
//   depth   how deep the room is, i.e. how big its back wall is drawn (room3d.js: lens/(lens+depth)).
//           Shallow 300 -> the back wall is 0.7 of the screen (what hangs on it is bigger -- a TV across a
//           room); Usual 467 -> 0.6, room3d.js's own default (argued there); Deep 700 -> 0.5 (more room,
//           smaller pictures). Three, not a slider: one switch steps through them. Saved on the room's own
//           copy of its recipe (as the 2D rows are), and a room set back to Usual names only its preset again.
// Rows that would apply to BOTH kinds: none yet. A wall colour for both is the obvious first (Mike's list).
export const ROOM3D_DEPTHS = Object.freeze([
  Object.freeze(['shallow', 'Shallow', 300]), Object.freeze(['usual', 'Usual', ROOM3D_DEFAULTS.depth]), Object.freeze(['deep', 'Deep', 700]),
]);
const depthKey = (d) => ROOM3D_DEPTHS.reduce((best, x) => (Math.abs(x[2] - d) < Math.abs(best[2] - d) ? x : best))[0];
const scene3dRecipe = (scene) => clone(scene.recipe && typeof scene.recipe === 'object' ? scene.recipe
  : (ROOM3D_PRESETS[scene.preset] || ROOM3D_PRESETS[ROOM3D_DEFAULT_PRESET]).recipe);
export const ROOM3D_ROWS = Object.freeze([
  Object.freeze({ key: 'drift', label: 'Camera drift', options: () => [['off', 'Off'], ['on', 'On']],
    get: (scene) => (scene.options && scene.options.drift === 'on' ? 'on' : 'off'),
    set: (scene, v) => {
      const o = { ...(scene.options || {}) };
      if (v === 'on') o.drift = 'on'; else delete o.drift;
      if (Object.keys(o).length) scene.options = o; else delete scene.options;
    } }),
  Object.freeze({ key: 'depth', label: 'Depth', options: () => ROOM3D_DEPTHS.map(([k, l]) => [k, l]),
    get: (scene) => depthKey(normalizeRoom3d(scene).depth ?? ROOM3D_DEFAULTS.depth),
    set: (scene, v) => {
      const r = scene3dRecipe(scene);
      const d = ROOM3D_DEPTHS.find(([k]) => k === v);
      if (!d || d[2] === ROOM3D_DEFAULTS.depth) delete r.depth; else r.depth = d[2];
      scene.recipe = r;
    } }),
]);
/** Which rows a scene kind has: the deliberate split (2D only, 3D only; none shared yet). */
export const SCENE_ROWS = Object.freeze({ room: ROOM_ROWS, room3d: ROOM3D_ROWS });

/** The room's recipe as it is drawn: its own copy if edited, else its preset's (2D rooms only). */
export function roomRecipe(layout) {
  if (!isRoom2d(layout)) return null;
  return layout.scene.recipe ? clone(layout.scene.recipe) : presetRecipe(layout.scene.preset);
}

/**
 * [{ key, label, value, valueLabel }] for the room rows of the scene's own kind (empty when it is not a
 * room). `reducedMotion`: the device asks for less motion -- a drift that is On then says it is held still.
 */
export function roomRows(layout, { reducedMotion = false } = {}) {
  const word = (row, v) => (row.options().find(([k]) => k === v) || [v, String(v)])[1];
  if (isRoom3d(layout)) {
    return ROOM3D_ROWS.map((row) => {
      const v = row.get(layout.scene);
      const held = row.key === 'drift' && v === 'on' && reducedMotion;
      return { key: row.key, label: row.label, value: v, valueLabel: held ? 'On (held still: this device asks for less motion)' : word(row, v) };
    });
  }
  const r = roomRecipe(layout);
  if (!r) return [];
  return ROOM_ROWS.map((row) => {
    const v = row.get(r);
    return { key: row.key, label: row.label, value: v, valueLabel: word(row, v) };
  });
}

/** One press of a Room row: the next value, wrapping (one switch travels one way). The room keeps its
 *  preset's name and gets its own copy of the recipe -- a plain copy, as every made dashboard is. */
export function cycleRoomRow(layout, key) {
  const row = (isRoom3d(layout) ? ROOM3D_ROWS : ROOM_ROWS).find((x) => x.key === key);
  const cur = roomRows(layout).find((x) => x.key === key);
  if (!row || !cur) return null;
  const opts = row.options();
  const at = opts.findIndex(([k]) => k === cur.value);
  return setRoomRow(layout, key, opts[(at + 1) % opts.length][0]);
}

/** One Room row set to `value` (one of its options): the layout with it, or null (not a room, no such row,
 *  not one of the choices). The same write `cycleRoomRow` makes -- it is how that one is made -- so edit
 *  mode (arrangement.js, a press on a room's walls) and Home's Room tray save a room the same way. */
export function setRoomRow(layout, key, value) {
  if (isRoom3d(layout)) {
    const row = ROOM3D_ROWS.find((x) => x.key === key);
    if (!row || !row.options().some(([k]) => k === value)) return null;
    const scene = clone(layout.scene);
    row.set(scene, value);
    const L = clone(layout);
    L.scene = tidyScene(scene);
    return L;
  }
  const row = ROOM_ROWS.find((x) => x.key === key);
  const r = roomRecipe(layout);
  if (!row || !r || !row.options().some(([k]) => k === value)) return null;
  row.set(r, value);
  const L = clone(layout);
  L.scene = { ...L.scene, recipe: r };
  return L;
}

// =====================================================================================================
// THE EDIT BAR AND ITS TRAYS, AS DATA (Design: every button always there; one that cannot act now is
// DIMMED, never hidden -- a vanishing button costs a switch user a press to find out it is gone).
// `thing` is the chosen module ({ id, type, title }); `placed` whether it is placed freely (only those
// move and resize by button; a thing in a grid cell moves with Transform or the composer).
// =====================================================================================================
export function editBarModel({ live = false, thing = null, count = 0, canUndo = false, canRedo = false, tray = null } = {}) {
  const b = (act, label, extra = {}) => ({ act, label, ...extra });
  return [
    // Its way out, FIRST and not dimmed (2026-10-02, the bar by switch): a stray select lands on it.
    b('closebar', 'Close', { hint: 'put the edit bar away' }),
    b('scene', 'Scene', { expanded: tray === 'scene', disabled: !live, hint: 'the room or the scene behind everything' }),
    b('add', 'Add', { expanded: tray === 'add', disabled: !live, hint: 'put a module on' }),
    b('change', thing ? `Change: ${thing.title || thing.type}` : 'Choose a thing',
      { expanded: tray === 'change' || tray === 'switch', disabled: !live || !count, hint: 'switch, move or remove one thing' }),
    b('transform', 'Transform…', { disabled: !live || !count, hint: 'position, size, turn and layer, as numbers' }),
    b('undo', 'Undo', { disabled: !live || !canUndo }),
    b('redo', 'Redo', { disabled: !live || !canRedo }),
  ];
}

// =====================================================================================================
// *** LOCKED IN PLACE (2026-10-02, the tutorial dashboard). *** Mike: "a special tutorial dashboard you can
// always go to that has Nimrod and settings locked into the bottom two slots." A dashboard's settings doc
// may carry `locked: [instance id]` (dashboards.js LOCKED_KEY; the tutorial's maker writes it). While on
// that dashboard, a locked thing is not removed, switched for another, moved or resized from the edit bar:
// those buttons are DIMMED with the reason (never hidden), and the Change tray offers Unlock.
//   WHY A LOCK AT ALL: the tutorial is the place you can ALWAYS find Nimrod and the settings; a stray
//   Remove (one press, by a switch, on the wrong thing) would quietly make that untrue.
//   WHY IT HAS A KEY (Unlock, one press, in the same tray): the person who wants the opposite -- somebody who
//   has learned the site and wants this dashboard for something else -- has a perfectly good reason. A lock
//   with no way out is the undismissable-gate failure in a smaller coat (CLAUDE.md). So "locked" means
//   "not by accident", not "never". Nothing here waits on anybody: a locked thing just stays where it is.
//   NOT ENFORCED YET: the kiosk's own Switch list and its edit windows (kiosk.js, dashboard_editor.js) --
//   the exact lines are with the coordinator. Undo and the composer do not consult it either.
// =====================================================================================================
export const LOCKED_HINT = 'kept here: this dashboard locks it (Unlock, below, if you mean to change it)';
export const isLocked = (locked, id) => Array.isArray(locked) && !!id && locked.includes(id);
/** The lock list without `id` (Unlock). */
export const unlockIn = (locked, id) => (Array.isArray(locked) ? locked.filter((x) => x !== id) : []);

/** The Change tray: Close first (its way out), then pick, then what can be done to the thing. A LOCKED
 *  thing (above): switch, move, size and remove dimmed with the reason, and Unlock offered after them. */
export function changeTrayModel({ thing = null, placed = false, count = 0, locked = false } = {}) {
  const b = (act, label, extra = {}) => ({ act, label, ...extra });
  const none = !thing;
  const held = !none && !!locked;
  const why = held ? { hint: LOCKED_HINT } : {};
  return [
    b('close', 'Close'),
    b('prev', '‹ Previous thing', { disabled: !count }),
    b('next', 'Next thing ›', { disabled: !count }),
    b('switch', 'Switch module…', { disabled: none || held, hint: held ? LOCKED_HINT : 'another module, in exactly this place' }),
    b('move', 'Move left', { d: [-MOVE_STEP, 0], disabled: none || !placed || held, ...why }),
    b('move', 'Move right', { d: [MOVE_STEP, 0], disabled: none || !placed || held, ...why }),
    b('move', 'Move up', { d: [0, -MOVE_STEP], disabled: none || !placed || held, ...why }),
    b('move', 'Move down', { d: [0, MOVE_STEP], disabled: none || !placed || held, ...why }),
    b('size', 'Smaller', { d: -SIZE_STEP, disabled: none || !placed || held, ...why }),
    b('size', 'Bigger', { d: SIZE_STEP, disabled: none || !placed || held, ...why }),
    b('remove', 'Remove', { disabled: none || held, warn: true, ...why }),
    ...(held ? [b('unlock', 'Unlock', { hint: 'let this one be changed or removed, like anything else' })] : []),
  ];
}

/** Previous / next in the dashboard's own ring order (wrapping), from the chosen id. */
export function stepThing(things, id, dir) {
  const list = Array.isArray(things) ? things : [];
  if (!list.length) return null;
  const at = list.findIndex((t) => t.id === id);
  if (at < 0) return list[dir < 0 ? list.length - 1 : 0];
  return list[(at + dir + list.length) % list.length];
}

// =====================================================================================================
// THE EDIT BAR BY SWITCH (2026-10-02). The bar and its trays are reachable by a SWITCH the way the settings
// menu and the dashboards tray are: while the bar HOLDS THE SCAN (the kiosk's host seam, kiosk.js `host.scan`:
// the panel router paused, one holder at a time) next / prev walk the stops that can act now, select presses
// the one the cursor is on, and back leaves a tray, then the bar. Close is the first stop of the bar and of
// each tray, so a stray select lands on the way out. A stop is an opaque key the page makes from a button;
// this is only the walk, so it is checked without a page.
// =====================================================================================================
/** Which bar button a tray belongs to (the Switch tray is opened from Change). */
export function trayOwner(tray) {
  if (!tray) return null;
  return tray === 'switch' ? 'change' : tray;
}
/** Where the cursor is in `list`: on `key`, else on the first stop (Close). */
export function scanAt(list, key) {
  const i = Array.isArray(list) ? list.indexOf(key) : -1;
  return i < 0 ? 0 : i;
}
/**
 * One switch verb on the edit bar. `state` { level: 'bar' | 'tray', key }; `view` { bar: [key], tray:
 * [key] | null (no tray open), trayOf: key of the bar button whose tray is open }. Returns { state, press?,
 * closeTray?, leave? }: `press` the key to press, `closeTray` put the tray away, `leave` leave the bar.
 * Nothing that can act (a change running): the verb does nothing and the place is kept.
 */
export function editScanStep(state, verb, view = {}) {
  const tray = Array.isArray(view.tray) && view.tray.length ? view.tray : null;
  const bar = Array.isArray(view.bar) ? view.bar : [];
  let level = state && state.level === 'tray' ? 'tray' : 'bar';
  let key = state && state.key != null ? state.key : null;
  // The tray went (its Close, a pointer, a finished change): the walk is back on its button on the bar.
  if (level === 'tray' && !tray) { level = 'bar'; key = view.trayOf ?? null; }
  const list = level === 'tray' ? tray : bar;
  const s = { level, key };
  if (verb === 'back') {
    if (level === 'tray') return { state: { level: 'bar', key: view.trayOf ?? null }, closeTray: true };
    return { state: s, leave: true };
  }
  if (!list.length) return { state: s };
  const at = scanAt(list, key);
  if (verb === 'next' || verb === 'prev') {
    const n = list.length;
    return { state: { level, key: list[(at + (verb === 'prev' ? -1 : 1) + n) % n] } };
  }
  if (verb === 'select') return { state: { level, key: list[at] }, press: list[at] };
  return { state: s };
}

// =====================================================================================================
// UNDO / REDO, OVER THE REAL THING. A step is a SNAPSHOT: { layout, theme, mods: [{ id, type, state }] }.
// Going back to one is a PLAN (`restorePlan`): which modules to bring back (with the settings they had),
// which to take off, and the layout with any returned module's new id. The page carries it out with the
// screens client, so undoing "Remove" brings the module back as it was, not as a fresh one.
// =====================================================================================================
//
// *** UNDO PUTS BACK ONLY WHAT THE STEP DID (2026-10-04, later). *** A snapshot restored whole also put back
// everything ANOTHER device changed since -- a panel moved on the screen itself went back where it was when the
// step here was made. So each step is STAMPED with what it did (`stamp`, after it is made):
//   after.layout = { from, to }  the layout the step was made FROM (the base its write carried) and the layout it
//                                wrote TO (its own `next`, not the merge -- the merge holds the other device's changes,
//                                which are not this step's to take back). null: the step wrote no layout.
//   after.mods   = { from, to }  the module ids before and after the step.
// Undo then sends the layout back to `from` merged onto the doc as it is now, with `to` as the base (doc_merge.js
// `mergeLayoutSave`, the placed list by id): what the step changed goes back, what it did not touch stays as it now
// is, and a part changed both here and elsewhere since is a true clash (the other device's stands, and it is said).
// Modules the same way (`restorePlan`'s `step`): only the ones the step took off come back and only the ones it put
// on come off. Redo is the same thing pointed the other way: the entry Undo hands to the redo list is stamped with the
// step swapped (`swapStep`). A module brought back gets a new id, and every step in both lists is renamed with it
// (`remap`, `remapStep`), so a later Undo still recognises it.
//   FOR this over clearing the list when another device's change is heard: the list stays useful (the common case is
//   two people on two devices touching different panels), and nothing has to watch the doc for changes. AGAINST: it
//   is more machinery than "Undo is gone after a remote change". A step not stamped (none should be) is restored
//   whole, as before.
/**
 * `step` (optional): the stamped `after.mods` ({ from, to } ids) of the step being undone. Without it, the
 * snapshot's modules are restored whole (as before 2026-10-04).
 */
export function restorePlan(currentMods, snap, step = null) {
  const now = new Map((currentMods || []).map((m) => [m.id, m]));
  const want = new Map(((snap && snap.mods) || []).map((m) => [m.id, m]));
  const add = [];
  const remove = [];
  if (step && Array.isArray(step.from) && Array.isArray(step.to)) {
    const from = new Set(step.from), to = new Set(step.to);
    // Taken off by the step and not back since: back, with the settings the snapshot kept.
    for (const id of from) {
      if (to.has(id) || now.has(id)) continue;
      const m = want.get(id);
      if (m) add.push({ fromId: id, type: m.type, state: clone(m.state || {}) });
    }
    // Put on by the step and still here: off. Anything else (added or removed elsewhere since) is left alone.
    for (const id of to) if (!from.has(id) && now.has(id)) remove.push(id);
    return { add, remove };
  }
  for (const [id, m] of want) {
    const cur = now.get(id);
    if (!cur) add.push({ fromId: id, type: m.type, state: clone(m.state || {}) });
    else if (cur.type !== m.type) { remove.push(id); add.push({ fromId: id, type: m.type, state: clone(m.state || {}) }); }
  }
  for (const id of now.keys()) if (!want.has(id)) remove.push(id);
  return { add, remove };
}

/** A step's stamp pointed the other way: what Undo did, as a step Redo can make again (and the reverse). */
export function swapStep(after) {
  if (!after) return after;
  const flip = (p) => (p ? { from: clone(p.to), to: clone(p.from) } : p ?? null);
  return { layout: flip(after.layout), mods: flip(after.mods) };
}

/** A step with every module id renamed by `map` (oldId -> newId), in place: its modules, layout and stamp. */
export function remapStep(entry, map = {}) {
  if (!entry || !Object.keys(map).length) return entry;
  const to = (id) => (id && map[id] ? map[id] : id);
  if (Array.isArray(entry.mods)) entry.mods = entry.mods.map((m) => (m ? { ...m, id: to(m.id) } : m));
  if (entry.layout) entry.layout = remapLayoutIds(entry.layout, map);
  const a = entry.after;
  if (a && a.layout) a.layout = { from: remapLayoutIds(a.layout.from, map), to: remapLayoutIds(a.layout.to, map) };
  if (a && a.mods) a.mods = { from: (a.mods.from || []).map(to), to: (a.mods.to || []).map(to) };
  return entry;
}

export function createUndo({ limit = UNDO_LIMIT } = {}) {
  let back = [];
  let fwd = [];
  let last = null;      // the entry most recently put on either list: what `stamp` stamps by default
  return {
    /** Before a change: remember how it was. A new change forgets anything that was undone. Returns the entry. */
    push(snap) { const e = clone(snap); back.push(e); if (back.length > limit) back = back.slice(-limit); fwd = []; last = e; return e; },
    /** Undo: hand in how it is NOW (for redo); get back the snapshot to restore, or null. */
    undo(now) { if (!back.length) return null; const e = clone(now); fwd.push(e); last = e; return back.pop(); },
    redo(now) { if (!fwd.length) return null; const e = clone(now); back.push(e); last = e; return fwd.pop(); },
    /** What a step did (see above), onto `entry` (default: the one last put on a list). */
    stamp(after, entry = last) { if (entry) entry.after = clone(after); return entry; },
    /** Every entry on both lists, through `fn` (in place): `remapStep` when a module came back under a new id. */
    remap(fn) { for (const e of [...back, ...fwd]) { try { fn(e); } catch { /* one entry, not the list */ } } },
    canUndo: () => back.length > 0,
    canRedo: () => fwd.length > 0,
    clear() { back = []; fwd = []; last = null; },
    sizes: () => ({ back: back.length, fwd: fwd.length }),
  };
}
