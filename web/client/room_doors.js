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

import { presetRecipe } from './room_presets.js';
import { layoutChange, isArranged } from './layout.js';

const J = JSON.stringify;
const clone = (v) => JSON.parse(J(v));

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

/** The recipe a room scene draws: its own, else its preset's (a copy). Null for anything not a room. */
export function sceneRecipe(scene) {
  if (!scene || scene.kind !== 'room') return null;
  return scene.recipe && typeof scene.recipe === 'object' ? clone(scene.recipe) : presetRecipe(scene.preset);
}

/** `{ objectId: target }` for every object in the scene that is a door. */
export function sceneDoors(scene) {
  const r = sceneRecipe(scene);
  if (!r) return {};
  const ids = recipeItemIds(r);
  const out = {};
  (r.items || []).forEach((it, i) => {
    const t = it && it.kind !== 'module' ? doorTarget(it.opens) : null;
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
  const ids = recipeItemIds(r);
  const i = ids.indexOf(objectId);
  if (i < 0) return null;
  const t = doorTarget(target);
  const item = { ...r.items[i] };
  if (t) item.opens = t; else delete item.opens;
  r.items = r.items.map((it, j) => (j === i ? item : it));
  return { ...clone(scene), recipe: r };
}

/** A room scene back to naming only its preset when its copied recipe is exactly the preset's again (the
 *  last door taken off, or undone): so trying a door and taking it back leaves the room following its
 *  preset, as it did. Anything else is returned as it is. */
export function tidyScene(scene) {
  if (!scene || scene.kind !== 'room' || !scene.recipe || typeof scene.preset !== 'string' || !scene.preset) return scene;
  if (J(scene.recipe) !== J(presetRecipe(scene.preset))) return scene;
  const { recipe, ...rest } = scene;     // eslint-disable-line no-unused-vars
  return rest;
}

const stripDoors = (recipe) => ({
  ...recipe,
  items: (recipe.items || []).map((it) => {
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
  if (!a || !b || a.kind !== 'room' || b.kind !== 'room') return J(a || null) === J(b || null) ? [] : null;
  if ((a.preset || null) !== (b.preset || null) && !(a.recipe && b.recipe)) return null;
  const ra = sceneRecipe(a), rb = sceneRecipe(b);
  if (J(stripDoors(ra)) !== J(stripDoors(rb))) return null;
  const ia = recipeItemIds(ra), ib = recipeItemIds(rb);
  const out = [];
  ib.forEach((id, i) => {
    if (!id) return;
    const before = doorTarget(ra.items[ia.indexOf(id)]?.opens);
    const after = doorTarget(rb.items[i]?.opens);
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
