// room_flat.js — "FLATTEN TO 2D": A 3D ROOM BAKED INTO AN ORDINARY 2D ROOM WHOSE DOORS AND SCREENS STILL WORK.
//
// Mike, 2026-10-02: "Would it be possible to 'flatten' 3d dashboards to 2d? Like a photo mode in a game but
// the interactive stuff stays interactive. That way people could build scenes on their computer and use them
// on their pi." Yes, and this is it. A flattened room is a NORMAL 2D ROOM (`scene.kind: 'room'`, room_scene.js)
// -- the thing a Pi already runs -- made of three parts, all computed from the 3D room's own geometry
// (room3d.js `project` and friends, the stage's exact perspective):
//
//   1. THE BACKDROP: the walls, floor, ceiling and furniture as they are drawn from the fixed camera, as a
//      plan of flat polygons (room_backdrop.js), painted with the 3D room's own theme tokens.
//   2. A HOTSPOT per piece of furniture, SAME ID, same name, same `opens`: the projected box's outline
//      (the convex hull of its eight corners, which is exactly a box's silhouette). A door is still a door --
//      press it and `dashboard/go` goes out, as it did in 3D -- and a piece that was not a door is still an
//      object the map editor can make one.
//   3. A QUAD per place a module sat on a wall -- each wall slot (SAME ID, so a module placed in slot 'back'
//      stays in slot 'back') and each module placed freely on a wall (a new slot `p-<its id>`, and its entry
//      is pointed at it). A quad is the module's own box drawn onto the four projected corners with a CSS
//      matrix3d (room_backdrop.js `quadMatrix`), so a TV on the side wall is still a live TV, in perspective.
//
// *** WHY A PLAN AND NOT A PICTURE, ARGUED. *** The ask was a rendered image, "stored like other pictures".
//   AGAINST a picture: (a) there is no dependable DOM-to-image for CSS 3D -- html2canvas-style renderers do not
//   do 3D transforms, and an SVG foreignObject snapshot does not either and taints the canvas; (b) there is no
//   upload path: pictures added on a device stay in THAT browser (device_pictures.js, deliberately), so a
//   picture made on the computer would never reach the Pi -- the whole point; (c) a picture is fixed colours,
//   so the room would stop following the screen's theme (room3d.js rule 1). A data: URL in the layout would
//   reach the Pi, at 100 KB-1 MB per room in the settings document.
//   FOR a plan: the geometry is KNOWN (every face is a rectangle at a known place), so drawing it again is
//   exact -- floor boards are straight lines under perspective, so they are exact too; it is a few KB in the
//   layout, which already travels to every screen; it is one SVG layer, no 3D compositing at all; and it is
//   painted with theme tokens, so a dark theme still makes a dark room. room_backdrop.js still accepts an
//   image backdrop, for the day a scene has no plan to give (a WebGL one, which would bake from its canvas).
//
// *** THE LIMITS, SAID PLAINLY. ***
//   - THE CAMERA IS FIXED: the drift is not baked (it is a sway; the bake is its middle).
//   - SHADING IS APPROXIMATE: the side walls' and floor's gradients are drawn straight across the screen,
//     where CSS draws them across the face (so in perspective). Flat colours, edges and lines are exact.
//   - MODULES DRAW ABOVE THE FURNITURE, as everything a 2D room holds does (room_scene.js rule 1). A piece of
//     furniture standing in front of a wall screen would hide it in 3D and does not here. The box room has none.
//   - ANIMATION: the 3D room has none but the drift, so nothing is lost today. A later scene that moves would
//     bake its moving parts as loops or overlays, not into the backdrop.
//   - RE-BAKE: a flattened room keeps its 3D source (`recipe.flat.source`) and the source's HASH. `flatState`
//     says it is stale when the source would now draw differently (its preset changed in code, the bake
//     itself changed -- FLAT_VERSION) or, given the 3D layout it was made from, when that layout changed. A
//     door set on the flattened room is KEPT through a re-bake and through "Back to 3D".
//
//   flattenLayout(layout)       a room3d layout -> the same dashboard's layout, flattened (null if not 3D)
//   unflattenLayout(layout)     a flattened layout -> its 3D room again, with any door edits carried back
//   rebakeLayout(layout)        unflatten, then flatten (what "Re-bake" does)
//   flatState(layout, {source}) { flat, stale, hash, expected } (or { flat: false, can })
//   flatActions(layout)         the menu rows for the scene: [{ key, label, enabled, note }]
//   applyFlatAction(layout, key)

import { W, H, normalizeRoom3d, viewOf, faceToWorld, faceSize, project, boxFaces, boxCorners, faceBoxFor,
  SURFACES, NEAR_CLIP, opensOf } from './room3d.js';
import { placedGeometry } from './layout.js';
import { sceneRecipe, furnitureIds, tidyScene } from './room_doors.js';

// Bump when the bake itself changes how a room is drawn: every flattened room then offers Re-bake.
export const FLAT_VERSION = 1;
// The slot a module placed freely on a 3D wall gets in the flattened room.
export const FLAT_SLOT_PREFIX = 'p-';

const clone = (v) => JSON.parse(JSON.stringify(v));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const is3d = (layout) => !!(layout && layout.scene && layout.scene.kind === 'room3d');

// ---------------------------------------------------------------------------------------------
// GEOMETRY
// ---------------------------------------------------------------------------------------------
/** A 3D polygon cut at the near plane (z <= lens x NEAR_CLIP): Sutherland-Hodgman against one plane. */
export function clipNear(poly, view) {
  const zMax = view.lens * NEAR_CLIP - 1e-6;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ina = a[2] <= zMax, inb = b[2] <= zMax;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (zMax - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, zMax]);
    }
  }
  return out;
}
/** A 3D polygon -> its drawn outline, stage px, rounded to 0.1 px. */
export function projectPoly(poly, view) {
  return clipNear(poly, view).map(([x, y, z]) => project(view, x, y, z).map(r1));
}
/** A rectangle on a face, in that face's px -> its four corners in the room (TL, TR, BR, BL as the face sees it). */
export function faceRect(surface, u0, v0, u1, v1, view) {
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => faceToWorld(surface, u, v, view));
}
/** The convex hull of 2D points (Andrew's monotone chain), counter-clockwise on screen. */
export function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { left, top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
};

// ---------------------------------------------------------------------------------------------
// 1. THE BACKDROP PLAN (room3d.css's faces, as polygons)
// ---------------------------------------------------------------------------------------------
// Numbers lifted from room3d.css, not chosen here: the skirting line is 6px, the floor's boards are 2px every
// 80px, the floor's shadow fades out 70% of the way to the front, the side walls' shading runs 14%->4% (left)
// and 16%->5% (right), front to back. The bake follows the stylesheet; it has no look of its own.
const SKIRT = 6, BOARD_W = 2, BOARD_EVERY = 80, FLOOR_FADE = 0.7;

/** The plan of a 3D room's backdrop: `{ kind: 'plan', shapes }` (room_backdrop.js's shape). */
export function bakePlan(recipe, view) {
  const shapes = [];
  const L = view.depth + view.front;
  const oy = (view.eye / 100) * H;
  const poly = (pts3) => projectPoly(pts3, view);
  const at = (surface, u, v) => project(view, ...faceToWorld(surface, u, v, view)).map(r1);
  shapes.push({ pts: [[0, 0], [W, 0], [W, H], [0, H]], fill: 'bg' });
  // The ceiling and the floor (the floor with its shadow and its boards).
  shapes.push({ pts: poly(faceRect('ceiling', 0, 0, W, L, view)), fill: 'ceiling' });
  const floor = poly(faceRect('floor', 0, 0, W, L, view));
  shapes.push({ pts: floor, fill: 'floor' });
  shapes.push({ pts: floor, grad: { a: at('floor', W / 2, 0), b: at('floor', W / 2, FLOOR_FADE * L), stops: [[0, 'shade:16'], [1, 'shade:0']] } });
  for (let u = 0; u < W; u += BOARD_EVERY) shapes.push({ pts: poly(faceRect('floor', u, 0, Math.min(W, u + BOARD_W), L, view)), fill: 'board' });
  // The side walls: the wall, its shading front -> back, its skirting.
  for (const [side, from, to] of [['left', 'shade:14', 'shade:4'], ['right', 'shade:5', 'shade:16']]) {
    const wall = poly(faceRect(side, 0, 0, L, H, view));
    shapes.push({ pts: wall, fill: 'wall' });
    shapes.push({ pts: wall, grad: { a: at(side, 0, oy), b: at(side, L, oy), stops: [[0, from], [1, to]] } });
    shapes.push({ pts: poly(faceRect(side, 0, H - SKIRT, L, H, view)), fill: 'base' });
  }
  // The back wall last of the walls (it meets all four), with its skirting.
  shapes.push({ pts: poly(faceRect('back', 0, 0, W, H, view)), fill: 'wall' });
  shapes.push({ pts: poly(faceRect('back', 0, H - SKIRT, W, H, view)), fill: 'base' });
  // The furniture, farthest first (painter's order), each box's faces that can be seen.
  for (const f of furnitureFarFirst(recipe, view)) {
    const fs = boxFaces(f, view);
    if (fs.top.seen) shapes.push({ pts: poly(fs.top.pts), fill: 'woodTop' });
    if (fs.left.seen) shapes.push({ pts: poly(fs.left.pts), fill: 'woodSide' });
    if (fs.right.seen) shapes.push({ pts: poly(fs.right.pts), fill: 'woodSide' });
    shapes.push({ pts: poly(fs.front.pts), fill: 'wood', stroke: 'edge', sw: 2 });
  }
  return { kind: 'plan', shapes: shapes.filter((s) => s.pts.length >= 3) };
}
/** The furniture, farthest from the eye first (by the box's middle); a tie keeps recipe order. */
export function furnitureFarFirst(recipe, view) {
  return (recipe.furniture || []).map((f, i) => {
    const fs = boxFaces(f, view);
    return { f, i, z: (fs.front.pts[0][2] + fs.top.pts[0][2]) / 2 };
  }).sort((a, b) => (a.z - b.z) || (a.i - b.i)).map((x) => x.f);
}

// ---------------------------------------------------------------------------------------------
// 2. HOTSPOTS, 3. QUADS
// ---------------------------------------------------------------------------------------------
/** A piece of furniture -> a 2D room `hotspot` item: same id, name and door; its drawn outline. */
export function hotspotFor(f, view) {
  const hull = convexHull(boxCorners(f, view).map(([x, y, z]) => project(view, x, y, z)));
  const b = bbox(hull);
  const w = Math.max(b.w, 1), h = Math.max(b.h, 1);
  const it = {
    kind: 'hotspot', id: f.id, label: f.name,
    x: r2(((b.left + w / 2) / W) * 100), y: r2(((b.top + h / 2) / H) * 100), w: r1(w), h: r1(h),
    poly: hull.map(([x, y]) => [r1(((x - b.left) / w) * 100), r1(((y - b.top) / h) * 100)]),
  };
  const door = opensOf(f);
  if (door) it.opens = door;
  return it;
}
/** Four room points (TL, TR, BR, BL) + the module box's own size -> a 2D room `module` item drawn on the quad. */
function quadItem(id, corners3, w, h, view) {
  const q = corners3.map(([x, y, z]) => project(view, x, y, z));
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  return { kind: 'module', id, w: r1(w), h: r1(h), x: r2((cx / W) * 100), y: r2((cy / H) * 100),
    quad: q.map(([x, y]) => [r2((x / W) * 100), r2((y / H) * 100)]) };
}
/** A 3D wall slot -> its quad item (same id). The module inside keeps the slot's size in the face's px. */
export function slotQuad(slot, view) {
  const fs = faceSize(slot.surface, view);
  const cx = (slot.x / 100) * fs.w, cy = (slot.y / 100) * fs.h, w = (slot.w / 100) * fs.w, h = (slot.h / 100) * fs.h;
  return quadItem(slot.id, faceRect(slot.surface, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, view), w, h, view);
}
/** A module placed freely on a 3D wall (a layout `placed` entry) -> its quad item, `p-<id>`. Its turn and
 *  its scale are drawn into the corners, about its middle, as the arrangement turns and scales it there. */
export function placedQuad(entry, view) {
  const g = placedGeometry(entry);
  const surface = SURFACES.includes(g.surface) ? g.surface : 'back';
  const fb = faceBoxFor(surface, g, view);
  const fs = faceSize(surface, view);
  const cx = (fb.left / 100) * fs.w, cy = (fb.top / 100) * fs.h, w = (fb.width / 100) * fs.w, h = (fb.height / 100) * fs.h;
  const s = g.scale / 100, a = (g.rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const corner = (dx, dy) => { const x = dx * s, y = dy * s; return [cx + x * c - y * sn, cy + x * sn + y * c]; };
  const pts = [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)];
  return quadItem(`${FLAT_SLOT_PREFIX}${entry.id}`, pts.map(([u, v]) => faceToWorld(surface, u, v, view)), w, h, view);
}

// ---------------------------------------------------------------------------------------------
// THE SOURCE'S HASH (re-bake detection)
// ---------------------------------------------------------------------------------------------
/** FNV-1a, 32 bits, as 8 hex digits: a fingerprint, not security. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const onScene = (placed) => (Array.isArray(placed) ? placed : []).filter((e) => e && e.id && e.place === 'scene');
/** What a 3D room WOULD DRAW, fingerprinted: its recipe as drawn (a preset resolved), its view, where each
 *  module on it sits, and the bake's own version. Equal hashes, equal bakes. */
export function sourceHash(scene, placed = []) {
  const recipe = normalizeRoom3d(scene);
  const view = viewOf(recipe, (scene && scene.options) || {});
  const geo = onScene(placed).map((e) => {
    const g = placedGeometry(e);
    return [e.id, e.slot || null, g.surface, g.x, g.y, g.w, g.h, g.scale, g.rot];
  });
  return fnv1a(JSON.stringify([FLAT_VERSION, recipe, [view.lens, view.depth, view.eye, view.front], geo]));
}

// ---------------------------------------------------------------------------------------------
// LAYOUTS
// ---------------------------------------------------------------------------------------------
/** The flattened room's own record of where it came from, or null if `layout` is not a flattened room. */
export function flatOf(layout) {
  const f = layout && layout.scene && layout.scene.kind === 'room' && layout.scene.recipe && layout.scene.recipe.flat;
  return f && typeof f === 'object' && f.source && f.source.scene && f.source.scene.kind === 'room3d' ? f : null;
}

/** A 3D room's layout -> the same dashboard's layout with its room flattened (see the header). Null if not 3D. */
export function flattenLayout(layout) {
  if (!is3d(layout)) return null;
  const scene = layout.scene;
  const recipe = normalizeRoom3d(scene);
  const view = viewOf(recipe, scene.options || {});
  const placed = Array.isArray(layout.placed) ? layout.placed : [];
  const slotIds = new Set(recipe.slots.map((s) => s.id));
  const free = onScene(placed).filter((e) => !(e.slot && slotIds.has(e.slot)));
  const items = [
    ...recipe.slots.map((s) => slotQuad(s, view)),
    ...free.map((e) => placedQuad(e, view)),
    ...furnitureFarFirst(recipe, view).map((f) => hotspotFor(f, view)),
  ];
  const freeIds = new Set(free.map((e) => e.id));
  const out = clone(layout);
  out.scene = {
    kind: 'room',
    recipe: {
      light: 'day',                       // the 3D room has no day and night; the 2D room's veil stays off
      backdrop: bakePlan(recipe, view),
      items,
      flat: { v: FLAT_VERSION, hash: sourceHash(scene, placed), source: { scene: clone(scene), placed: clone(onScene(placed)) } },
    },
  };
  // A free module now sits in its quad's slot. Its turn and scale are drawn INTO the quad's corners, so they
  // come off the entry (the arrangement would turn it a second time inside the slot); the 3D source keeps them.
  out.placed = placed.map((e) => {
    if (!(e && freeIds.has(e.id) && e.place === 'scene')) return clone(e);
    const { rot, scale, ...rest } = clone(e);
    void rot; void scale;
    return { ...rest, slot: `${FLAT_SLOT_PREFIX}${e.id}` };
  });
  return out;
}

/** A flattened layout -> its 3D room again. A door set on the flattened room goes onto the 3D piece with the
 *  same id; a module still in its flattened place goes back to where it was in 3D; anything added since is
 *  kept as it is. Null if `layout` is not a flattened room. */
export function unflattenLayout(layout) {
  const f = flatOf(layout);
  if (!f) return null;
  let scene = clone(f.source.scene);
  const doors = new Map((layout.scene.recipe.items || []).filter((it) => it && it.kind === 'hotspot' && it.id)
    .map((it) => [it.id, opensOf(it)]));
  // The recipe as the 3D room reads it (its own, else its preset's -- a copy), and each entry's drawn id.
  const raw = sceneRecipe(scene);
  const ids = furnitureIds(raw);
  let changed = false;
  raw.furniture = (raw.furniture || []).map((p, i) => {
    const id = ids[i];
    if (!p || !id || !doors.has(id) || opensOf(p) === doors.get(id)) return p;
    changed = true;
    const q = { ...p };
    if (doors.get(id)) q.opens = doors.get(id); else delete q.opens;
    return q;
  });
  // A room that named only its preset gets its own copy of the recipe (room_doors.js argues that copy), and
  // goes back to naming only the preset if the copy turns out to be the preset after all.
  if (changed) scene = tidyScene({ ...scene, recipe: raw });
  const src = new Map(onScene(f.source.placed).map((e) => [e.id, e]));
  const placed = (Array.isArray(layout.placed) ? layout.placed : []).map((e) => {
    if (!e || !e.id) return e;
    const flatSlot = `${FLAT_SLOT_PREFIX}${e.id}`;
    const was = src.get(e.id);
    if (was && e.place === 'scene' && (e.slot === flatSlot || e.slot === was.slot)) {
      const back = clone(was);
      for (const k of ['opens', 'shown', 'locked']) { delete back[k]; if (e[k] !== undefined) back[k] = e[k]; }
      return back;
    }
    if (e.slot === flatSlot) { const { slot, ...rest } = e; void slot; return clone(rest); }
    return clone(e);
  });
  return { ...clone(layout), scene, placed };
}

/** "Re-bake": the 3D room again, flattened again -- door edits and module places carried through. */
export function rebakeLayout(layout) {
  const three = unflattenLayout(layout);
  return three ? flattenLayout(three) : null;
}

/**
 * Is this a flattened room, and is it stale? `{ flat: true, stale, hash, expected }`, or `{ flat: false, can }`
 * (`can`: it is a 3D room, so it CAN be flattened). Stale when the room its source would draw now is not the
 * one it was baked from -- or, given `source` (the 3D layout it was made from, kept elsewhere), when that changed.
 */
export function flatState(layout, { source = null } = {}) {
  const f = flatOf(layout);
  if (!f) return { flat: false, can: is3d(layout) };
  const expected = is3d(source) ? sourceHash(source.scene, source.placed) : sourceHash(f.source.scene, f.source.placed);
  return { flat: true, hash: f.hash, expected, stale: f.v !== FLAT_VERSION || f.hash !== expected };
}

// The words a person sees. No absolutes promised: "faster on small devices" is what the plan saves (no 3D).
export const FLAT_ROWS = Object.freeze({
  flatten: Object.freeze({ label: 'Flatten to 2D', note: 'A still picture of this room from where it is seen now. Its doors and its screens keep working, and it is quicker to draw on a small device.' }),
  rebake: Object.freeze({ label: 'Re-bake', note: 'The 3D room has changed since this was made: make the picture again.', fresh: 'Up to date with its 3D room.' }),
  unflatten: Object.freeze({ label: 'Back to 3D', note: 'The 3D room again, with any doors you set here.' }),
});
/** The scene's flatten rows, as data (a row that cannot act now is dimmed, never hidden). */
export function flatActions(layout, opts = {}) {
  const st = flatState(layout, opts);
  if (st.flat) {
    return [
      { key: 'rebake', label: FLAT_ROWS.rebake.label, enabled: st.stale, note: st.stale ? FLAT_ROWS.rebake.note : FLAT_ROWS.rebake.fresh },
      { key: 'unflatten', label: FLAT_ROWS.unflatten.label, enabled: true, note: FLAT_ROWS.unflatten.note },
    ];
  }
  return st.can ? [{ key: 'flatten', label: FLAT_ROWS.flatten.label, enabled: true, note: FLAT_ROWS.flatten.note }] : [];
}
/** One of those rows pressed: the new layout, or null when it does not apply. */
export function applyFlatAction(layout, key) {
  if (key === 'flatten') return flattenLayout(layout);
  if (key === 'rebake') return rebakeLayout(layout);
  if (key === 'unflatten') return unflattenLayout(layout);
  return null;
}
