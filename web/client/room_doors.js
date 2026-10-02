// room_doors.js — WHICH DASHBOARD A ROOM'S OBJECTS OPEN, AS DATA (row 2.38, the map editor).
//
// 1c97dc5 let any room object carry `opens: '<dashboard id>'` on its recipe item. This file is the pure,
// light part of EDITING that: reading the doors off a scene, writing one, and telling a change that only
// moved a door apart from one that rebuilt the room. It imports only data (room_presets.js) and the layout
// rules, never the renderer, so the arrangement, the editor and the map can all use it on any screen.
//
// *** WHERE AN OBJECT'S DOOR IS SAVED: ON ITS RECIPE ITEM, IN THE DASHBOARD'S LAYOUT (`scene.recipe`). ***
// The place 1c97dc5 already reads it, and Design's model ("any object in a room recipe can take a role").
//   FOR: one source of truth -- the recipe says what each object is and does, nothing else overrides it.
//   AGAINST, and it is real: a room that names only a PRESET (`scene: { kind: 'room', preset }`) has no
//     recipe of its own, so giving one of its objects a door COPIES the preset's recipe into the layout.
//     From then on that room no longer follows changes to the preset in code. (A plain copy is what the
//     ready-made dashboards already are -- dashboards.js "A PLAIN COPY, NOT A PREFAB".) The other place a
//     door could live -- a `roomDoors` map beside the layout -- avoids the copy but makes two places say
//     what an object opens, and on today's path a swapped-in screen would read the boot screen's map.
//     On Mike's list.
//
// *** A DOOR CHANGE IS NOT A REBUILD. *** `layoutChange` (layout.js) calls ANY scene difference 'grid',
// and the kiosk reloads the screen for 'grid'. `classifyLayoutChange` below is that rule with one
// exception: two layouts whose scenes differ ONLY in their objects' doors are a 'placement' change, which
// the arrangement applies in place (`applyPlaced` -> room_scene.js `setObjectOpens`): the object becomes a
// door, or stops being one, and nothing else on the screen is touched.

//
// *** THE 3D ROOM TOO (2026-10-02). *** A `room3d` scene (room3d.js) keeps its pieces in `recipe.furniture`,
// not `recipe.items`, and names its ids by room3d.js `normalizeRoom3d`'s rule (its own `id`, else
// `thing<n>`, a repeated id DROPPED rather than renamed). Every function below takes either kind; the copy-
// the-preset-in trade-off above is the same for it. room3d.js is imported for its PRESETS only (it has no
// side effects at import; its renderer runs only when `mountRoom3d` is called).

import { presetRecipe } from './room_presets.js';
import { layoutChange, isArranged } from './layout.js';
import { ROOM3D_PRESETS, ROOM3D_DEFAULT_PRESET } from './room3d.js';

const J = JSON.stringify;
const clone = (v) => JSON.parse(J(v));
const is3d = (scene) => !!scene && scene.kind === 'room3d';
const isRoomKind = (scene) => !!scene && (scene.kind === 'room' || scene.kind === 'room3d');

/** The ids room3d.js draws each furniture entry with: its own `id`, else `thing<n>`; a repeat is null
 *  (normalizeRoom3d drops it). Slots share the id space, as there. */
export function furnitureIds(recipe) {
  const used = new Set();
  for (const [i, s] of (Array.isArray(recipe?.slots) ? recipe.slots : []).entries()) {
    if (!s || typeof s !== 'object') continue;
    used.add(typeof s.id === 'string' && s.id ? s.id : `slot${i + 1}`);
  }
  return (Array.isArray(recipe?.furniture) ? recipe.furniture : []).map((f, i) => {
    if (!f || typeof f !== 'object') return null;
    const id = typeof f.id === 'string' && f.id ? f.id : `thing${i + 1}`;
    if (used.has(id)) return null;
    used.add(id);
    return id;
  });
}

// The pieces of a recipe that can be doors, by kind: the list's key, the ids, and which entries count.
function doorList(scene, recipe) {
  if (is3d(scene)) return { key: 'furniture', ids: furnitureIds(recipe), ok: (it) => !!it && typeof it === 'object' };
  return { key: 'items', ids: recipeItemIds(recipe), ok: (it) => !!it && it.kind !== 'module' };
}

/** A door's target as data: a trimmed string, or null. (room_scene.js `opensOf`, the same rule.) */
export function doorTarget(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The id each recipe item is drawn with -- room_scene.js `normalizeRecipe`'s rule, repeated here so this
 * file does not import the renderer: its own `id`, else `<kind><index>`, de-duplicated with `_`.
 * (room_doors_test checks the two agree on every preset.)
 */
export function recipeItemIds(recipe) {
  const used = new Set();
  return (Array.isArray(recipe?.items) ? recipe.items : []).map((it, i) => {
    if (!it || typeof it !== 'object') return null;
    let id = typeof it.id === 'string' && it.id ? it.id : `${it.kind || 'item'}${i}`;
    while (used.has(id)) id += '_';
    used.add(id);
    return id;
  });
}

/** A 3D room's preset recipe, as plain data (a copy). */
function preset3d(name) {
  return clone((ROOM3D_PRESETS[name] || ROOM3D_PRESETS[ROOM3D_DEFAULT_PRESET]).recipe);
}

/** The recipe a room scene draws: its own, else its preset's (a copy). Null for anything not a room
 *  (a 2D room's `{ items }`, or a 3D room's `{ slots, furniture }`). */
export function sceneRecipe(scene) {
  if (!isRoomKind(scene)) return null;
  if (scene.recipe && typeof scene.recipe === 'object') return clone(scene.recipe);
  return is3d(scene) ? preset3d(scene.preset) : presetRecipe(scene.preset);
}

/** `{ objectId: target }` for every object in the scene that is a door. */
export function sceneDoors(scene) {
  const r = sceneRecipe(scene);
  if (!r) return {};
  const { key, ids, ok } = doorList(scene, r);
  const out = {};
  (r[key] || []).forEach((it, i) => {
    const t = ok(it) ? doorTarget(it.opens) : null;
    if (t && ids[i]) out[ids[i]] = t;
  });
  return out;
}

/**
 * The scene with object `objectId`'s door set to `target` (null: no door). A preset-only room gets its
 * recipe copied in (see the header). Returns null when the scene is not a room or has no such object.
 */
export function withDoor(scene, objectId, target) {
  const r = sceneRecipe(scene);
  if (!r) return null;
  const { key, ids, ok } = doorList(scene, r);
  const i = objectId ? ids.indexOf(objectId) : -1;
  if (i < 0 || !ok(r[key][i])) return null;
  const t = doorTarget(target);
  const item = { ...r[key][i] };
  if (t) item.opens = t; else delete item.opens;
  r[key] = r[key].map((it, j) => (j === i ? item : it));
  return { ...clone(scene), recipe: r };
}

/** A room scene back to naming only its preset when its copied recipe is exactly the preset's again (the
 *  last door taken off, or undone): so trying a door and taking it back leaves the room following its
 *  preset, as it did. Anything else is returned as it is. */
export function tidyScene(scene) {
  if (!isRoomKind(scene) || !scene.recipe || typeof scene.preset !== 'string' || !scene.preset) return scene;
  if (is3d(scene) && !ROOM3D_PRESETS[scene.preset]) return scene;
  if (J(scene.recipe) !== J(is3d(scene) ? preset3d(scene.preset) : presetRecipe(scene.preset))) return scene;
  const { recipe, ...rest } = scene;     // eslint-disable-line no-unused-vars
  return rest;
}

const stripDoors = (recipe, key = 'items') => ({
  ...recipe,
  [key]: (recipe[key] || []).map((it) => {
    if (!it || typeof it !== 'object') return it;
    const { opens, ...rest } = it;      // eslint-disable-line no-unused-vars
    return rest;
  }),
});

/**
 * If scenes `a` and `b` differ only in their objects' doors: the list of doors that changed,
 * `[{ id, opens }]` (empty when they are the same), else null. A preset-only room and the same room
 * copied out with one door changed differ only in that door.
 */
export function sceneDoorChanges(a, b) {
  if (!a && !b) return [];
  if (!a || !b || !isRoomKind(a) || a.kind !== b.kind) return J(a || null) === J(b || null) ? [] : null;
  if ((a.preset || null) !== (b.preset || null) && !(a.recipe && b.recipe)) return null;
  // Anything beside the recipe (a 3D room's drift, in `options`) is not a door: a change there is a rebuild.
  const { recipe: _ra, preset: _pa, ...oa } = a;      // eslint-disable-line no-unused-vars
  const { recipe: _rb, preset: _pb, ...ob } = b;      // eslint-disable-line no-unused-vars
  if (J(oa) !== J(ob)) return null;
  const ra = sceneRecipe(a), rb = sceneRecipe(b);
  const la = doorList(a, ra), lb = doorList(b, rb);
  if (J(stripDoors(ra, la.key)) !== J(stripDoors(rb, lb.key))) return null;
  const out = [];
  lb.ids.forEach((id, i) => {
    if (!id) return;
    const before = doorTarget(ra[la.key][la.ids.indexOf(id)]?.opens);
    const after = doorTarget(rb[lb.key][i]?.opens);
    if (before !== after) out.push({ id, opens: after });
  });
  return out;
}

/**
 * layout.js's `layoutChange`, with doors: 'none' | 'placement' | 'grid'. A change to the free placement
 * AND/OR to which dashboard the room's objects open is 'placement' (applied in place); anything else that
 * `layoutChange` calls 'grid' still is.
 */
export function classifyLayoutChange(before, after) {
  const c = layoutChange(before, after);
  if (c !== 'grid') return c;
  const a = before || null, b = after || null;
  if (isArranged(a) !== isArranged(b)) return 'grid';
  const { placed: _pa, scene: sa, ...ra } = a || {};       // eslint-disable-line no-unused-vars
  const { placed: _pb, scene: sb, ...rb } = b || {};       // eslint-disable-line no-unused-vars
  if (J(ra) !== J(rb)) return 'grid';
  return sceneDoorChanges(sa || null, sb || null) ? 'placement' : 'grid';
}
