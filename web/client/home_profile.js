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
//   Scene      -> which backdrop: one of Design's rooms (layout.scene), a live theme, or a still one; and
//                 for a room, Design's own rows (shape, walls, floor, light, out of the window) on its recipe
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
import { THEMES, DEFAULT_THEME } from './theme.js';
import { profileSetup } from './game/game.js';

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

const isRoom = (layout) => !!(layout && layout.scene && layout.scene.kind === 'room');

/**
 * A new module ON the dashboard. `null` layout (the one-at-a-time stage: every module takes its turn) needs
 * no entry -- the module joins the stage by existing -- so it is returned as it was. Otherwise: the first
 * free grid cell; else placed, on the room's back wall (a room) or flat on the screen, at the next
 * ADD_SPOTS spot not already taken.
 */
export function addToLayout(layout, id) {
  if (!layout || !id) return layout;
  const L = clone(layout);
  if (layoutIds(L).includes(id)) return L;
  const room = isRoom(L);
  const free = Array.isArray(L.slots) ? L.slots.indexOf(null) : -1;
  // A free cell, but NOT on a room: a room's single 'full' cell is the backdrop's, and a module in it would
  // cover the whole room.
  if (free >= 0 && !room) { L.slots[free] = id; return L; }
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

/** Move a PLACED thing by (dx, dy) percent. A thing in a grid cell does not move (null: say so). */
export function nudgeInLayout(layout, id, dx, dy) {
  const w = whereIs(layout, id);
  if (!w || w.kind !== 'placed') return null;
  const L = clone(layout);
  L.placed = L.placed.map((p) => {
    if (!p || p.id !== id) return p;
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
  L.placed = L.placed.map((p) => {
    if (!p || p.id !== id) return p;
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
export const SCENE_KINDS = Object.freeze({ room: 'Rooms', live: 'Moving scenes', static: 'Still' });

export function sceneChoices() {
  const rooms = Object.entries(ROOM_PRESETS).map(([k, p]) => ({ id: `room:${k}`, kind: 'room', key: k, label: p.label }));
  const themes = Object.entries(THEMES).map(([k, t]) => ({ id: `theme:${k}`, kind: t.scene ? 'live' : 'static', key: k, label: t.label || k }));
  return [...rooms, ...themes.filter((t) => t.kind === 'live'), ...themes.filter((t) => t.kind === 'static')];
}

/** Which choice is showing now. A room edited in place still names the room it started from. */
export function currentScene(layout, theme) {
  if (isRoom(layout)) return `room:${layout.scene.preset || 'custom'}`;
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
  if (c.kind === 'room') {
    const L = { ...base };
    const moved = layout ? [] : [...ids];
    for (const id of (L.slots || []).filter(Boolean)) moved.push(id);
    L.preset = 'full';
    L.slots = [null];
    let placed = [...(L.placed || [])];
    for (const id of moved) {
      if (placed.some((p) => p && p.id === id)) continue;
      const taken = new Set(placed.map((p) => `${p.x},${p.y}`));
      const at = ADD_SPOTS_ROOM.find(([x, y]) => !taken.has(`${x},${y}`)) || ADD_SPOTS_ROOM[placed.length % ADD_SPOTS_ROOM.length];
      placed.push({ id, place: 'scene', surface: 'back', x: at[0], y: at[1], ...ADD_SIZE_ROOM });
    }
    // A slot in the OLD room means nothing in the new one: such a thing hangs on the back wall instead.
    placed = placed.map((p) => {
      if (!p || !p.slot) return p;
      const { slot, ...rest } = p;
      return { ...rest, surface: 'back', x: rest.x ?? ADD_SPOTS_ROOM[0][0], y: rest.y ?? ADD_SPOTS_ROOM[0][1], w: rest.w ?? ADD_SIZE_ROOM.w, h: rest.h ?? ADD_SIZE_ROOM.h };
    });
    if (placed.length) L.placed = placed; else delete L.placed;
    L.scene = { kind: 'room', preset: c.key };
    const live = theme && THEMES[theme] && THEMES[theme].scene;
    return { layout: L, theme: live ? DEFAULT_THEME : undefined };
  }
  if (!layout) return { layout: null, theme: c.key };
  const L = { ...base };
  delete L.scene;
  if (Array.isArray(L.placed)) {
    L.placed = L.placed.map((p) => {
      if (!p || p.place !== 'scene') return p;
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

/** The room's recipe as it is drawn: its own copy if edited, else its preset's. */
export function roomRecipe(layout) {
  if (!isRoom(layout)) return null;
  return layout.scene.recipe ? clone(layout.scene.recipe) : presetRecipe(layout.scene.preset);
}

/** [{ key, label, value, valueLabel }] for the Room rows (empty when the scene is not a room). */
export function roomRows(layout) {
  const r = roomRecipe(layout);
  if (!r) return [];
  return ROOM_ROWS.map((row) => {
    const opts = row.options();
    const v = row.get(r);
    return { key: row.key, label: row.label, value: v, valueLabel: (opts.find(([k]) => k === v) || [v, String(v)])[1] };
  });
}

/** One press of a Room row: the next value, wrapping (one switch travels one way). The room keeps its
 *  preset's name and gets its own copy of the recipe -- a plain copy, as every made dashboard is. */
export function cycleRoomRow(layout, key) {
  const row = ROOM_ROWS.find((x) => x.key === key);
  const r = roomRecipe(layout);
  if (!row || !r) return null;
  const opts = row.options();
  const at = opts.findIndex(([k]) => k === row.get(r));
  row.set(r, opts[(at + 1) % opts.length][0]);
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

/** The Change tray: Close first (its way out), then pick, then what can be done to the thing. */
export function changeTrayModel({ thing = null, placed = false, count = 0 } = {}) {
  const b = (act, label, extra = {}) => ({ act, label, ...extra });
  const none = !thing;
  return [
    b('close', 'Close'),
    b('prev', '‹ Previous thing', { disabled: !count }),
    b('next', 'Next thing ›', { disabled: !count }),
    b('switch', 'Switch module…', { disabled: none, hint: 'another module, in exactly this place' }),
    b('move', 'Move left', { d: [-MOVE_STEP, 0], disabled: none || !placed }),
    b('move', 'Move right', { d: [MOVE_STEP, 0], disabled: none || !placed }),
    b('move', 'Move up', { d: [0, -MOVE_STEP], disabled: none || !placed }),
    b('move', 'Move down', { d: [0, MOVE_STEP], disabled: none || !placed }),
    b('size', 'Smaller', { d: -SIZE_STEP, disabled: none || !placed }),
    b('size', 'Bigger', { d: SIZE_STEP, disabled: none || !placed }),
    b('remove', 'Remove', { disabled: none, warn: true }),
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
export function restorePlan(currentMods, snap) {
  const now = new Map((currentMods || []).map((m) => [m.id, m]));
  const want = new Map(((snap && snap.mods) || []).map((m) => [m.id, m]));
  const add = [];
  const remove = [];
  for (const [id, m] of want) {
    const cur = now.get(id);
    if (!cur) add.push({ fromId: id, type: m.type, state: clone(m.state || {}) });
    else if (cur.type !== m.type) { remove.push(id); add.push({ fromId: id, type: m.type, state: clone(m.state || {}) }); }
  }
  for (const id of now.keys()) if (!want.has(id)) remove.push(id);
  return { add, remove };
}

export function createUndo({ limit = UNDO_LIMIT } = {}) {
  let back = [];
  let fwd = [];
  return {
    /** Before a change: remember how it was. A new change forgets anything that was undone. */
    push(snap) { back.push(clone(snap)); if (back.length > limit) back = back.slice(-limit); fwd = []; },
    /** Undo: hand in how it is NOW (for redo); get back the snapshot to restore, or null. */
    undo(now) { if (!back.length) return null; fwd.push(clone(now)); return back.pop(); },
    redo(now) { if (!fwd.length) return null; back.push(clone(now)); return fwd.pop(); },
    canUndo: () => back.length > 0,
    canRedo: () => fwd.length > 0,
    clear() { back = []; fwd = []; },
    sizes: () => ({ back: back.length, fwd: fwd.length }),
  };
}
