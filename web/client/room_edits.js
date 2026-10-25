// room_edits.js - A DASHBOARD'S ROOM, REARRANGED: move, size, turn round, take out and add its furniture.
// Row 2.110 step 1 (the scene editor). PURE: every function takes a room recipe and returns a new one.
//
// Mike, 2026-10-18: *"There was supposed to be a scene editor that could be used to move/change the objects on the
// themes/rooms/etc. I was going to adjust some things on the themes to make the default versions how I want them."*
// Step 1 is a dashboard's own room (arrangement.js "THE DASHBOARD'S ROOM, EDITED IN PLACE"): what Town's Rearrange
// already does for a Town place (town_edits.js, modules/town.js), on the recipe a dashboard's room is drawn from
// (`layout.scene.recipe`, room_scene.js `normalizeRecipe`). Step 2 is "Copy as the default"; step 3 (the themes' own
// objects) waits on chat and Design.
//
// *** TOWN'S BOUNDS, NOT TOWN'S FUNCTIONS, argued. *** The numbers are town_edits.js's own (imported, so the two editors
// cannot drift): where a wall thing and a floor thing may go, how big or small, how many things. The functions are
// not reused, because a dashboard's room differs from a Town place in three ways that matter (measured 2026-10-21):
//   1. ITS PIECES ARE KNOWN BY ID. A door ("Opens"), a look and the switch's selection all name a piece by its id, and
//      a piece with no id of its own is named by its PLACE in the list (room_doors.js `recipeItemIds`). Town's
//      operations work by index and add pieces with no id - so taking one out would renumber the pieces after it, and
//      a door would move to the wrong piece. Here every piece is given its id before anything changes (`withIds`),
//      and a new piece gets one of its own.
//   2. WHAT STANDS ON THE FLOOR is the renderer's rule (room_scene.js `isFloor`: FURNITURE's own `on`, a cat, a brick
//      build), not town's (which takes everything but a few wall pieces for a wall thing: a cat would be lifted onto
//      the wall, a door dropped onto the floor).
//   3. A ROOM HAS MORE THAN TOWN CAN DRAW: doors, speakers, side walls. Town's `cleanRecipe` keeps only what its flat
//      drawing knows, so it is never run here; nothing is taken out that the person did not take out.
// WHAT IS EDITED: furniture, the cat, and brick builds. A panel's place in the room (a module, a frame, the clock, the
// calendar, a sign) is the placement editor's, not this. A thing on a SIDE wall keeps its place (its x and y are
// drawn through the side wall's slant, and moving it along there is not built): it can still be sized, turned round
// or taken out.
import { FURNITURE, FURNITURE_GROUPS, MOUNT_KINDS } from './room_parts.js';
import { recipeItemIds } from './room_doors.js';
import { defaultsEntry } from './nimrod_defaults.js';
import { WALL_Y, FLOOR_Y, X_RANGE, SCALE_RANGE, SCALE_STEP, RECIPE_MAX_ITEMS } from './town_edits.js';

// One press of "Left or right" or "Nearer or further": Town's Rearrange's step (modules/town.js MOVE_STEP), so a
// person who has rearranged a Town place finds the room moves the same.
export const MOVE_STEP = 4;
// The most things a room may hold: Town's bound (RECIPE_MAX_ITEMS, argued there), counting only what this editor
// adds. A built-in room has at most 11 things.
export const ROOM_MAX_ITEMS = RECIPE_MAX_ITEMS;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round1 = (v) => Math.round(v * 10) / 10;
const copy = (r) => JSON.parse(JSON.stringify(r || {}));

/** Whether the renderer stands it on the floor (room_scene.js `isFloor`, the same rule, without importing the renderer). */
export const standsOnFloor = (it) => (it.kind === 'furniture' ? FURNITURE[it.part]?.on === 'floor'
  : it.kind === 'build' ? true : MOUNT_KINDS[it.kind]?.on === 'floor');
/** Whether this editor edits it: furniture, the cat, a brick build. */
export const isEditablePiece = (it) => !!it && typeof it === 'object' && ['furniture', 'cat', 'build'].includes(it.kind);
const onSideWall = (it) => !standsOnFloor(it) && (it.wall === 'left' || it.wall === 'right');
/** Whether it can be moved here (not on a side wall). */
export const isMovable = (it) => isEditablePiece(it) && !onSideWall(it);

/** The recipe with every item carrying the id it is drawn with, so nothing is renumbered by a change. */
export function withIds(recipe) {
  const r = copy(recipe);
  r.items = Array.isArray(r.items) ? r.items : [];
  const ids = recipeItemIds(r);
  r.items.forEach((it, i) => { if (it && typeof it === 'object' && ids[i]) it.id = ids[i]; });
  return r;
}
const indexOf = (r, id) => recipeItemIds(r).indexOf(id);

/** The item drawn as `id`, or null. */
export function pieceOf(recipe, id) {
  const r = recipe && Array.isArray(recipe.items) ? recipe : null;
  const i = r && id ? indexOf(r, id) : -1;
  return i >= 0 ? r.items[i] : null;
}

/** A piece's rows, as settings_fields.js fields (edit mode draws them; the switch menu walks them). */
export function pieceFields(it) {
  if (!isEditablePiece(it)) return [];
  const out = [];
  if (isMovable(it)) {
    const floor = standsOnFloor(it);
    const [lo, hi] = floor ? FLOOR_Y : WALL_Y;
    out.push({ key: 'x', label: 'Left or right', kind: 'number', min: X_RANGE[0], max: X_RANGE[1], step: MOVE_STEP, level: 'essential',
      default: 50, note: '‹ moves it left, › right' });
    out.push(floor
      ? { key: 'y', label: 'Nearer or further', kind: 'number', min: lo, max: hi, step: MOVE_STEP, level: 'essential', default: 90,
        note: '‹ moves it further back, › nearer' }
      : { key: 'y', label: 'Higher or lower', kind: 'number', min: lo, max: hi, step: MOVE_STEP, level: 'essential', default: 30,
        note: '‹ moves it up, › down' });
  }
  out.push({ key: 'size', label: 'Size', kind: 'number', min: SCALE_RANGE[0], max: SCALE_RANGE[1], step: SCALE_STEP, level: 'essential',
    default: 1, note: '1 is its usual size' });
  // ROTATION (chat's note CO, 2026-10-25: "transform controls like position, rotation, scale"): the turn handle's number.
  // A step of 15 degrees for ‹ and ›, the handle itself any whole degree. Not on a side wall (drawn through its slant).
  if (isMovable(it)) out.push({ key: 'rotate', label: 'Rotation', kind: 'number', min: -180, max: 180, step: 15, level: 'essential',
    default: 0, unit: '°', note: '‹ turns it left, › right; the round handle above a chosen piece turns it too' });
  out.push({ key: 'facing', label: 'Facing', kind: 'choice', level: 'essential', default: 'drawn',
    options: [{ value: 'drawn', label: 'As drawn' }, { value: 'turned', label: 'Turned round' }] });
  return out;
}
/** What those rows show now. */
export function pieceValues(it) {
  if (!isEditablePiece(it)) return {};
  return { x: Number(it.x) || 0, y: Number(it.y) || 0, size: Number(it.scale) || 1, rotate: Number(it.rot ?? it.rotate) || 0, facing: it.flip ? 'turned' : 'drawn' };
}

/**
 * The recipe with piece `id` changed by `patch` ({ x?, y?, size?, facing? }), each kept inside its bounds; a thing
 * standing on another (a lamp on a table, `ground`) moves up and down with it, as in Town. Null: no such piece, or
 * not one this edits.
 */
export function withPieceEdit(recipe, id, patch = {}) {
  const r = withIds(recipe);
  const i = indexOf(r, id);
  const it = i >= 0 ? r.items[i] : null;
  if (!isEditablePiece(it) || !patch || typeof patch !== 'object') return null;
  if (isMovable(it) && 'x' in patch && Number.isFinite(Number(patch.x))) it.x = round1(clamp(Number(patch.x), X_RANGE[0], X_RANGE[1]));
  if (isMovable(it) && 'y' in patch && Number.isFinite(Number(patch.y))) {
    const [lo, hi] = standsOnFloor(it) ? FLOOR_Y : WALL_Y;
    const was = Number(it.y) || 0;
    const y = round1(clamp(Number(patch.y), lo, hi));
    if (Number.isFinite(it.ground)) it.ground = round1(clamp(it.ground + (y - was), lo, hi));
    it.y = y;
  }
  if ('size' in patch && Number.isFinite(Number(patch.size))) {
    const s = round1(clamp(Number(patch.size), SCALE_RANGE[0], SCALE_RANGE[1]));
    if (s === 1) delete it.scale; else it.scale = s;
  }
  if ('facing' in patch) { if (patch.facing === 'turned') it.flip = true; else delete it.flip; }
  // Kept as `rot` (Design's village format: x, y = the foot, scale, rot, flip; README 2026-10-25), in -180..180.
  if (isMovable(it) && 'rotate' in patch && Number.isFinite(Number(patch.rotate))) {
    let d = ((Math.round(Number(patch.rotate)) % 360) + 360) % 360;
    if (d > 180) d -= 360;
    if (d === 0) delete it.rot; else it.rot = d;
    delete it.rotate;   // the first day's name for it (2549e18, deployed): moved onto `rot` at its next change
  }
  return r;
}

/** The recipe without piece `id` (its door goes with it). Null: no such piece, or not one this edits. */
export function withoutPiece(recipe, id) {
  const r = withIds(recipe);
  const i = indexOf(r, id);
  if (i < 0 || !isEditablePiece(r.items[i])) return null;
  r.items.splice(i, 1);
  return r;
}

/** The pieces "Add a piece" offers: every drawn piece and every world's, by group (room_parts.js FURNITURE_GROUPS). */
export function addOptions() {
  const out = [{ value: '', label: 'Choose a piece to add' }];
  const seen = new Set();
  for (const [group, ids] of FURNITURE_GROUPS) {
    for (const id of ids) {
      if (seen.has(id) || !FURNITURE[id]) continue;
      seen.add(id);
      out.push({ value: id, label: `${FURNITURE[id].label || id} (${group})` });
    }
  }
  return out;
}

// *** "COPY AS THE DEFAULT" (row 2.110 step 2). *** Mike wants to "make the default versions how I want them": a room
// rearranged on a dashboard, copied as an entry for the site's defaults file, so it can be put in and committed (the
// defaults are code, reviewed like code; the page cannot write the site's files). SINCE 2026-10-25 IN DESIGN'S SHAPE
// (item 42.3: "one file, nimrod_defaults.json ... It matches what Code built on dashboards. Send that to the same file,
// under the same keys"): `{ format: 'nimrod-defaults', version: 1, made, rooms: { <preset>: <recipe> } }`, merged into
// nimrod_defaults.js. Its starting room's name when it has one; a room with no preset is offered as a new one, `myRoom`.
const ID_RE = /^[A-Za-z_$][\w$]*$/;
/** The room as a nimrod_defaults entry (JSON text), saying in `made` when and from which dashboard. PURE. */
export function presetText(recipe, { preset = '', from = '', date = '' } = {}) {
  const name = ID_RE.test(String(preset || '')) ? preset : 'myRoom';
  const made = [date, from ? `rearranged on the dashboard "${String(from).replace(/[\r\n]+/g, ' ')}"` : ''].filter(Boolean).join(', ');
  return defaultsEntry('rooms', [name], withIds(recipe), { made });
}

/**
 * The recipe with a new `part` in the middle of its wall or floor, and its id: `{ recipe, id }`, or `{ recipe: null,
 * why }` (not a piece, or the room is full). Town's places for a new piece (town_edits.js `addPiece`).
 */
export function withNewPiece(recipe, part) {
  if (!part || !FURNITURE[part]) return { recipe: null, why: 'There is no such piece.' };
  const r = withIds(recipe);
  if (r.items.filter(isEditablePiece).length >= ROOM_MAX_ITEMS) return { recipe: null, why: 'This room is full. Take something out first.' };
  const used = new Set(recipeItemIds(r));
  let n = 1;
  while (used.has(`${part}-${n}`)) n += 1;
  const id = `${part}-${n}`;
  r.items.push(FURNITURE[part].on === 'floor' ? { id, kind: 'furniture', part, x: 50, y: 92 } : { id, kind: 'furniture', part, x: 50, y: 30 });
  return { recipe: r, id };
}
