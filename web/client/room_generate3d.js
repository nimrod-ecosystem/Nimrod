// room_generate3d.js — A MADE ROOM IN THE 3D ROOM (proposal_made_rooms_3d_20261127.md step 1; Mike, 2026-11-27: "C would be
// good eventually. We definitely want 3d at some point.").
//
// The 2D room draws every floor piece facing the viewer, so furniture along a side wall stood out on the floor. In the 3D
// room (room3d.js, CSS 3D, no library) the side walls are real walls. So the SAME plan room_generate.js makes, in
// centimetres, is laid out in the 3D room's own size and turned into its furniture boxes: real sizes, a piece against a
// side wall turned to run along it, and nothing tall standing in front of a wall where a module hangs (a module is
// somebody's photos). Pure and seeded, like the 2D one.
//
// THE SIZE, read off room3d.js, not chosen here: its stage is 960 x 540 px with the back wall `depth` px behind the screen,
// at 0.2 stage px per mm (2 px per cm; its desk note) -- so a room 4.8 m across, 2.7 m high, and as deep as `depth`.
// What it does NOT have yet, said plainly: no door, window, picture or clock (the 3D room draws none), no lamps standing
// on tables (its boxes stand on the floor), and the pieces are boxes (only the desk has a brick-built picture). Steps 2-4
// of the proposal are those.

import { generateRoom, ROOM_TYPES, ROOM_FACTS } from './room_generate.js';
import { ROOM3D_PRESETS, ROOM3D_DEFAULT_PRESET, viewOf, W, H } from './room3d.js';
import { FURNITURE } from './room_parts.js';
import { buildFor } from './brick_builds.js';

/** 3D stage px per cm (room3d.js: 0.2 px per mm). */
export const PX_PER_CM = 2;

/** The 3D room's size in cm for a view (its depth is the view's). */
export function room3dCm(view = viewOf({})) {
  return { w: Math.round(W / PX_PER_CM), d: Math.round(view.depth / PX_PER_CM), wall: Math.round(H / PX_PER_CM) };
}

/**
 * Where the modules hang, as zones of floor nothing tall may stand in front of: each slot of the 3D room's own preset, as
 * cm along its wall and its lowest edge's height above the floor. (Faces, room3d.js faceTransforms: the back face is W x
 * H; a side face is depth + front long, the LEFT one running from the front to the back, the RIGHT one from the back.)
 */
export function slotZonesFor(slots, view = viewOf({})) {
  const D = view.depth, F = view.front, L = D + F;
  const out = [];
  for (const s of Array.isArray(slots) ? slots : []) {
    if (!s) continue;
    const below = Math.round(((1 - (Number(s.y) + Number(s.h) / 2) / 100) * H) / PX_PER_CM);
    if (s.surface === 'back') {
      out.push({ wall: 'back', from: Math.round(((s.x - s.w / 2) / 100) * W / PX_PER_CM), to: Math.round(((s.x + s.w / 2) / 100) * W / PX_PER_CM), below });
    } else if (s.surface === 'left' || s.surface === 'right') {
      const a0 = ((s.x - s.w / 2) / 100) * L, a1 = ((s.x + s.w / 2) / 100) * L;   // face px from the face's left edge
      // px from the back wall: the left face's left edge is the front (F in front of the screen), the right's the back
      const back = s.surface === 'left' ? [L - a1, L - a0] : [a0, a1];
      out.push({ wall: s.surface, from: Math.max(0, Math.round(back[0] / PX_PER_CM)), to: Math.round(Math.min(D, back[1]) / PX_PER_CM), below });
    }
  }
  return out;
}

const round = (v, n = 2) => { const f = 10 ** n; return Math.round(v * f) / f; };

/**
 * A 3D room recipe for `type` from `seed`: { recipe, plan, left_out }. `recipe` is room3d.js's ({ slots, furniture }),
 * with `made: { type, seed }` saying where it came from; its slots are the 3D room's own.
 */
export function generateRoom3d({ type = 'bedroom', seed = 1 } = {}) {
  if (!ROOM_TYPES[type]) throw new Error(`room_generate3d: no room type "${type}"`);
  const base = ROOM3D_PRESETS[ROOM3D_DEFAULT_PRESET].recipe;
  const view = viewOf(base);
  const cm = room3dCm(view);
  const slots = base.slots.map((s) => ({ ...s }));
  const { plan, left_out } = generateRoom({ type, seed, roomCm: cm, mode: '3d', slotZones: slotZonesFor(slots, view) });
  let n = 0;
  const furniture = plan.pieces.map((p) => {
    const hcm = ROOM_FACTS[p.part]?.real_size?.[2] ?? 80;
    const out = {
      id: `${p.part}${++n}`, name: FURNITURE[p.part]?.label || p.part,
      x: round((((p.x0 + p.x1) / 2) / cm.w) * 100), z: round((((p.z0 + p.z1) / 2) / cm.d) * 100),
      w: Math.round((p.x1 - p.x0) * PX_PER_CM), h: Math.round(hcm * PX_PER_CM), d: Math.round((p.z1 - p.z0) * PX_PER_CM),
    };
    // A piece with a brick build (the desk) wears its picture -- only facing the room, so not one turned to a side wall.
    if (buildFor(p.part) && !p.turned) out.part = p.part;
    return out;
  });
  return { recipe: { slots, furniture, made: { type, seed: (Number(seed) >>> 0) || 1 } }, plan, left_out };
}
