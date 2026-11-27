// room_generate.js — A ROOM MADE FROM THE PIECES' FACTS, the way it would be in the real world (note GO, row 2.285).
//
// Mike, 2026-11-24: "How hard would it be for the site to have a procedural generation system for things like rooms,
// themes, games, etc. using the assets we have? Have things come out the way they would be in the real world." Then,
// 2026-11-26: "yes to both room questions": start with a BEDROOM from the room's own drawn pieces, and the facts live
// with the pieces (Design's asset manifest for its kits; here for the drawn ones, which are not in that manifest).
//
// WHAT IT IS: pure and seeded (rng.js mulberry32). `generateRoom({ type, seed })` returns an ordinary room recipe
// (room_scene.js's schema), so a made room is a normal room: the room editor can change it afterwards, and the same
// seed makes the same room on every screen. Nothing here touches the page.
//
// HOW (ProcTHOR's order, borrowed as a method, not code: shell, then the big piece against a wall, then what goes
// with it, then the walls, then fill):
//   1. the shell, its finishes and colours;
//   2. the door (its swing kept clear) and the window;
//   3. the ANCHOR (a bed) against the back wall, out of the door's way;
//   4. what goes with it (`goes_with`): a nightstand at its head, a lamp ON the nightstand, a rug in front;
//   5. the wall things over a surface: a picture over the bed, a clock;
//   6. fill to each piece's `count`, checking overlap and clearance each time. A piece with no room left is left out.
//
// THE PLAN IS IN CENTIMETRES, not stage pixels: a floor `ROOM_CM.w` wide and `ROOM_CM.d` deep, seen from the front.
// Each piece's footprint is its real width (as drawn: across the screen) by its real depth (into the room), so
// "nothing overlaps" and "you can walk past" are real-world checks. Only then is the plan drawn onto the stage: the
// depth into the room becomes the foot's height on the floor, the floor narrows toward the back wall as the shell
// does, and each piece gets the `scale` that makes its drawn width its real width at that depth (so a lamp is never
// as big as a wardrobe).
//
// *** THE NUMBERS (Rule 1). *** Every number in ROOM_FACTS is a real-world measurement of an ordinary piece of that
// kind (a double bed is about 200 x 140 cm, a nightstand about 45 x 40 x 55), chosen here, not by Design; a recipe can
// still move or resize anything afterwards. `ROOM_CM` (a 4 x 3.2 m room, walls 2.5 m) is an ordinary bedroom; it is
// an option of `generateRoom` (`roomCm`), not a setting yet, because nobody has asked to pick a room's size.

import { mulberry32 } from './rng.js';
import { ROOM_SHELLS, FURNITURE, WALL_FINISHES, FLOOR_FINISHES, STAGE } from './room_parts.js';
import { depthScale, itemBox, sideWallTransform } from './room_scene.js';

// `w: null`: the room's width follows the shell, so a centimetre is as wide as it is tall on the back wall (a "flat"
// shell's back wall is wider on the stage than a "room" shell's, so its room is wider, not its pieces stretched).
export const ROOM_CM = Object.freeze({ w: null, d: 320, wall: 250 });

/** The room's size in cm for a shell: `roomCm.w`, or the back wall's own proportion times the wall height. */
export function roomSizeFor(shell, roomCm = ROOM_CM) {
  const b = shell.back;
  const w = Number(roomCm.w) > 0 ? Number(roomCm.w)
    : Math.round(roomCm.wall * (((b.r - b.l) / 100) * STAGE.w) / (((b.b - b.t) / 100) * STAGE.h));
  return { w, d: roomCm.d, wall: roomCm.wall };
}

// The facts columns (the same names as the asset manifest's, GO proposal):
//   real_size [w, d, h] cm, as drawn: w across the screen, d into the room
//   sits_on   'floor' | 'wall' | 'surface' (on a piece with `surface`)
//   against   'wall' (backs onto the back wall) | 'none'
//   rooms     the room types it belongs in
//   goes_with what is placed with it when it is the anchor
//   clearance cm kept free in front of it (a door: its swing)
//   count     [min, max] in one room
//   faces     'room' (everything drawn here faces the viewer; kept for the 3D room and the kits)
//   flat      lies on the floor under things (a rug): it blocks nothing
//   surface   cm: the height of its top, when a lamp or speaker can stand on it
//   at        cm: a wall piece's centre above the floor
export const ROOM_FACTS = Object.freeze({
  sofa:      { real_size: [200, 90, 85],  sits_on: 'floor', against: 'wall', rooms: ['living'], goes_with: ['rug', 'sideTable', 'tableLamp', 'floorLamp'], clearance: 60, count: [0, 1], faces: 'room' },
  armchair:  { real_size: [85, 85, 95],   sits_on: 'floor', against: 'none', rooms: ['living', 'bedroom', 'study'], goes_with: ['sideTable', 'floorLamp'], clearance: 40, count: [0, 1], faces: 'room' },
  bed:       { real_size: [200, 140, 55], sits_on: 'floor', against: 'wall', rooms: ['bedroom'], goes_with: ['sideTable', 'tableLamp', 'rug'], clearance: 50, count: [1, 1], faces: 'room' },
  bookshelf: { real_size: [80, 30, 180],  sits_on: 'floor', against: 'wall', rooms: ['living', 'bedroom', 'study'], goes_with: [], clearance: 60, count: [0, 1], faces: 'room' },
  desk:      { real_size: [120, 60, 75],  sits_on: 'floor', against: 'wall', rooms: ['study', 'bedroom'], goes_with: ['tableLamp'], clearance: 70, count: [0, 1], faces: 'room', surface: 75 },
  sideTable: { real_size: [45, 40, 55],   sits_on: 'floor', against: 'wall', rooms: ['living', 'bedroom'], goes_with: ['tableLamp'], clearance: 0, count: [0, 2], faces: 'room', surface: 55 },
  cabinet:   { real_size: [120, 45, 60],  sits_on: 'floor', against: 'wall', rooms: ['living', 'bedroom', 'study'], goes_with: ['tableLamp', 'speaker'], clearance: 50, count: [0, 1], faces: 'room', surface: 60 },
  tableLamp: { real_size: [25, 25, 45],   sits_on: 'surface', against: 'none', rooms: ['living', 'bedroom', 'study'], goes_with: [], clearance: 0, count: [0, 2], faces: 'room' },
  // a floor lamp and a plant stand by a wall (seen in the browser pane 2026-11-26: placed anywhere, a plant stood in the
  // middle of the floor, which no one does)
  floorLamp: { real_size: [35, 35, 160],  sits_on: 'floor', against: 'wall', rooms: ['living', 'bedroom', 'study'], goes_with: [], clearance: 0, count: [0, 1], faces: 'room' },
  plant:     { real_size: [40, 40, 90],   sits_on: 'floor', against: 'wall', rooms: ['living', 'bedroom', 'study', 'kitchen'], goes_with: [], clearance: 0, count: [0, 2], faces: 'room' },
  rug:       { real_size: [200, 140, 1],  sits_on: 'floor', against: 'none', rooms: ['living', 'bedroom'], goes_with: [], clearance: 0, count: [0, 1], faces: 'room', flat: true },
  // `back_only` (2026-11-26, seen in the browser pane): a fireplace is built into a wall, and the room draws every floor
  // piece facing the viewer, so one "against" a side wall stood out on the floor in front of the sofa. The back wall only.
  fireplace: { real_size: [140, 40, 110], sits_on: 'floor', against: 'wall', back_only: true, rooms: ['living'], goes_with: ['rug', 'armchair'], clearance: 90, count: [0, 1], faces: 'room' },
  window:    { real_size: [120, 10, 120], sits_on: 'wall', against: 'wall', rooms: ['living', 'bedroom', 'study', 'kitchen'], goes_with: [], clearance: 0, count: [1, 1], faces: 'room', at: 140 },
  wallShelf: { real_size: [90, 20, 25],   sits_on: 'wall', against: 'wall', rooms: ['living', 'bedroom', 'study', 'kitchen'], goes_with: [], clearance: 0, count: [0, 1], faces: 'room', at: 165 },
  door:      { real_size: [90, 5, 210],   sits_on: 'wall', against: 'wall', rooms: ['living', 'bedroom', 'study', 'kitchen'], goes_with: [], clearance: 90, count: [0, 1], faces: 'room', at: 105 },
  speaker:   { real_size: [20, 20, 35],   sits_on: 'surface', against: 'none', rooms: ['living', 'study'], goes_with: [], clearance: 0, count: [0, 2], faces: 'room' },
});

// The room types this file can make. The bedroom first (Mike's yes, 2026-11-26); the living room and the study from the
// same pieces, since their facts were already here (2026-11-26, later). A kitchen waits for kitchen pieces to be drawn.
// Each is: its ANCHOR (the big piece against the back wall), and what goes with it comes from the anchor's own
// `goes_with` (a bed's nightstands, a sofa's side table and rug, a desk's lamp ON it), then the fill.
export const ROOM_TYPES = Object.freeze({
  bedroom: {
    label: 'Bedroom',
    anchor: 'bed',
    // the fill, in order, after the anchor and what goes with it: each tried up to its count
    fill: ['bookshelf', 'desk', 'armchair', 'floorLamp', 'plant', 'cabinet'],
    shells: ['room', 'corner', 'flat'],
    walls: [['stripes', '#c9d6d3'], ['paint', '#d9d2b6'], ['sprig', '#e6dcc4'], ['limewash', '#cfd8cf'], ['paint', '#b8c4d8'], ['boards', '#a8794e']],
    floors: [['carpet', '#9c8a74'], ['boards', '#9a6a42'], ['carpet', '#7d8a9c'], ['boards', '#6e4a2e']],
    sign: 'Sweet dreams',
  },
  living: {
    label: 'Living room',
    anchor: 'sofa',
    fill: ['fireplace', 'armchair', 'bookshelf', 'cabinet', 'floorLamp', 'plant'],
    shells: ['room', 'corner', 'flat'],
    walls: [['paint', '#e2d6bf'], ['limewash', '#d6cdb8'], ['stripes', '#d8c9b0'], ['paint', '#c7d3c4'], ['boards', '#9a6e48']],
    floors: [['boards', '#8a5a36'], ['boards', '#a57a52'], ['carpet', '#8c7f6c'], ['carpet', '#6f7d6a']],
    sign: 'Welcome home',
  },
  study: {
    label: 'Study',
    anchor: 'desk',
    fill: ['bookshelf', 'armchair', 'cabinet', 'floorLamp', 'plant'],
    // what this kind of room is not itself without (a study with no books is an office): at least one, room allowing
    need: ['bookshelf'],
    shells: ['room', 'corner', 'flat'],
    walls: [['paint', '#cfd6d8'], ['boards', '#8f6844'], ['limewash', '#d3d0c4'], ['paint', '#d8ccb4']],
    floors: [['boards', '#7a5134'], ['carpet', '#6c7584'], ['boards', '#9a6a42']],
    sign: 'Quiet, please',
  },
});

const GAP = 5;   // cm between pieces set side by side (a nightstand beside the bed)
// How far a drawing reaches past its own box (room_parts.js: the window's curtains run 14% past each side and its rod 18%,
// the rod 10% above, the curtains 10% below), as fractions of the box. Read off the drawings, so a change there is a
// change here.
const DRAWN_OVERHANG = Object.freeze({ window: { side: 0.18, top: 0.10, bottom: 0.10 } });
// Stage px kept clear between two things on the back wall (a hair at 960 px: enough that two frames never read as one).
const WALL_GAP_PX = 6;

// ---------------------------------------------------------------------------------------------
// PLAN (cm) -> STAGE (percent)
// ---------------------------------------------------------------------------------------------

/** The floor's left and right edge (stage %) at stage height y, for a shell: the back edge narrows as drawn. */
export function floorEdges(shell, y) {
  const b = shell.back;
  const t = Math.max(0, Math.min(1, (y - b.b) / (100 - b.b)));
  const left = b.l * (1 - t);                 // the floor's front edge spans the whole stage (ROOM_SHELLS' polygons)
  const right = b.r + (100 - b.r) * t;
  return { left, right };
}

/** A floor point in the plan (x across, z into the room, cm) -> stage % { x, y }. z = 0 is the back wall. */
export function planToStage(shell, x, z, roomCm = ROOM_CM) {
  const b = shell.back;
  const y = b.b + (z / roomCm.d) * (100 - b.b);
  const { left, right } = floorEdges(shell, y);
  return { x: left + (x / roomCm.w) * (right - left), y };
}

/** A back-wall point (x across, h above the floor, cm) -> stage % { x, y }. */
export function wallToStage(shell, x, h, roomCm = ROOM_CM) {
  const b = shell.back;
  return { x: b.l + (x / roomCm.w) * (b.r - b.l), y: b.b - (h / roomCm.wall) * (b.b - b.t) };
}

/** The `scale` that makes a piece's drawn width its real width, for a floor piece with its foot at stage y. */
export function floorScale(shell, part, realW, y, roomCm = ROOM_CM) {
  const def = FURNITURE[part];
  const { left, right } = floorEdges(shell, y);
  const wantPx = (realW / roomCm.w) * ((right - left) / 100) * STAGE.w;
  const drawnPx = def.box[0] * depthScale(y);
  return round(wantPx / drawnPx, 3);
}
export function wallScale(shell, part, realW, roomCm = ROOM_CM) {
  const def = FURNITURE[part];
  const wantPx = (realW / roomCm.w) * ((shell.back.r - shell.back.l) / 100) * STAGE.w;
  return round(wantPx / def.box[0], 3);
}

const round = (v, n = 2) => { const f = 10 ** n; return Math.round(v * f) / f; };

// ---------------------------------------------------------------------------------------------
// THE PLAN: rectangles in cm, checked as they are added
// ---------------------------------------------------------------------------------------------

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

function createPlan(roomCm) {
  const pieces = [];      // { part, x0, x1, z0, z1, clear }   (z0 the back edge, z1 the front edge)
  const keepClear = [];   // rectangles nothing may stand in (a door's swing, a piece's clearance)
  const inside = (r) => r.x0 >= 0 && r.x1 <= roomCm.w && r.z0 >= 0 && r.z1 <= roomCm.d;
  return {
    pieces, keepClear,
    /** Can a footprint `r` with clearance `c` cm in front of it go here? */
    fits(r, c = 0) {
      if (!inside(r)) return false;
      const front = { x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + c };
      if (c > 0 && front.z1 > roomCm.d) return false;
      for (const p of pieces) if (overlaps(r, p) || (c > 0 && overlaps(front, p))) return false;
      for (const k of keepClear) if (overlaps(r, k)) return false;
      return true;
    },
    add(part, r, c = 0) {
      pieces.push({ part, ...r });
      if (c > 0) keepClear.push({ x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + c, of: part, piece: pieces.length - 1 });
    },
    reserve(r, of) { keepClear.push({ ...r, of, piece: -1 }); },
  };
}

// ---------------------------------------------------------------------------------------------
// GENERATE
// ---------------------------------------------------------------------------------------------

/**
 * A room recipe for `type` from `seed`: { recipe, plan, left_out }.
 *   recipe    room_scene.js's schema; `made: { type, seed }` says where it came from
 *   plan      the footprints in cm and the kept-clear areas (for the suite and a future editor overlay)
 *   left_out  the pieces that were tried and had no room
 */
export function generateRoom({ type = 'bedroom', seed = 1, roomCm: roomAsked = ROOM_CM } = {}) {
  const spec = ROOM_TYPES[type];
  if (!spec) throw new Error(`room_generate: no room type "${type}"`);
  const s = (Number(seed) >>> 0) || 1;
  const rand = mulberry32(s);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
  const coin = (p = 0.5) => rand() < p;
  const shuffle = (list) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };

  // 1. the shell and its finishes
  const shellKey = pick(spec.shells);
  const shell = ROOM_SHELLS[shellKey];
  const roomCm = roomSizeFor(shell, { ...ROOM_CM, ...(roomAsked || {}) });
  const [wallFinish, wallColor] = pick(spec.walls);
  const [floorFinish, floorColor] = pick(spec.floors);
  const recipe = {
    shell: shellKey,
    wall: { finish: WALL_FINISHES[wallFinish] ? wallFinish : 'paint', color: wallColor },
    floor: { finish: FLOOR_FINISHES[floorFinish] ? floorFinish : 'boards', color: floorColor },
    light: 'auto', view: 'auto',
    made: { type, seed: s },
    items: [],
  };
  const plan = createPlan(roomCm);
  const leftOut = [];
  const wallUsed = [];   // back-wall spans in cm: { x0, x1, h0, h1 }
  const wallFree = (x0, x1, h0, h1) => x0 >= 0 && x1 <= roomCm.w && !wallUsed.some((u) => x0 < u.x1 && u.x0 < x1 && h0 < u.h1 && u.h0 < h1);
  let n = 0;
  const id = (base) => `${base}${++n}`;

  // *** WHAT IS SEEN ON THE BACK WALL, AS DRAWN (Mike, 2026-11-26: "objects on the wall overlapped"). *** The cm spans
  // above use each piece's REAL size, but a drawing is not its real size: a window's curtains and rod reach 18% past its
  // box, a door's drawing is squatter than a door. So every wall thing, and every floor thing standing against the back
  // wall, is also kept as the box the room will draw (room_scene.js itemBox, in stage px, with the overhang), and a new
  // wall thing must not touch any of them, nor a floor thing pushed back against the wall touch a wall thing.
  const ppc = (((shell.back.r - shell.back.l) / 100) * STAGE.w) / roomCm.w;     // stage px per cm on the back wall
  const wallShown = [], backShown = [];
  const shownBox = (item) => {
    const v = itemBox(item, shell).visible;
    const o = item.kind === 'furniture' ? DRAWN_OVERHANG[item.part] : null;
    if (!o) return { l: v.left, t: v.top, r: v.left + v.w, b: v.top + v.h };
    return { l: v.left - v.w * o.side, t: v.top - v.h * o.top, r: v.left + v.w * (1 + o.side), b: v.top + v.h * (1 + o.bottom) };
  };
  const touches = (a, list) => list.some((s) => a.l < s.r + WALL_GAP_PX && s.l < a.r + WALL_GAP_PX && a.t < s.b + WALL_GAP_PX && s.t < a.b + WALL_GAP_PX);

  // 2a. the door, AS TALL AS A REAL DOOR (Mike, 2026-11-26: "the doors didn't go down to the floor"). Its drawing is
  // squatter than a door, so scaled by its width it was about 180 cm tall, centred at 105 cm: 15 cm off the floor. Scaled
  // by its HEIGHT, it is a 210 cm door standing on the floor, a little wider than 90 cm. On a side wall where the shell
  // has one (its swing is the floor beside that wall), else at one end of the back wall (its swing in front of it).
  const door = ROOM_FACTS.door;
  const doorK = round((door.real_size[2] * ppc) / FURNITURE.door.box[1], 3);
  const doorW = (FURNITURE.door.box[0] * doorK) / ppc;                          // its drawn width, cm
  const side = shell.left && shell.right ? pick(['left', 'right']) : shell.left ? 'left' : null;
  if (side) {
    const along = between(0.35, 0.6);                               // how far toward the front, along the side wall
    const edge = side === 'left' ? shell.back.l : 100 - shell.back.r;
    const x = side === 'left' ? edge * (1 - along) : 100 - edge * (1 - along);
    // Its foot on the side wall's floor line at that x (the line runs from the stage's bottom at the front to the back
    // wall's foot), its middle half its drawn height above (room_scene.js sideWallTransform draws it that big there).
    const probe = { kind: 'furniture', part: 'door', x, y: 50, wall: side, scale: doorK };
    const tf = sideWallTransform(shell, probe);
    const u = side === 'left' ? Math.min(0.98, Math.max(0.02, x / shell.back.l)) : Math.min(0.98, Math.max(0.02, (100 - x) / (100 - shell.back.r)));
    const floorY = 100 + u * (shell.back.b - 100);
    const halfH = ((FURNITURE.door.box[1] * doorK * tf.sy) / 2 / STAGE.h) * 100;
    recipe.items.push({ id: id('door'), kind: 'furniture', part: 'door', x: round(x), y: round(floorY - halfH), wall: side, scale: doorK });
    const zMid = along * roomCm.d;
    const xs = side === 'left' ? [0, door.clearance] : [roomCm.w - door.clearance, roomCm.w];
    plan.reserve({ x0: xs[0], x1: xs[1], z0: zMid - doorW / 2, z1: zMid + doorW / 2 }, 'door');
  } else {
    const atLeft = coin();
    const x0 = atLeft ? 10 : roomCm.w - 10 - doorW;
    const at = wallToStage(shell, x0 + doorW / 2, door.real_size[2] / 2, roomCm);
    const item = { id: id('door'), kind: 'furniture', part: 'door', x: round(at.x), y: round(at.y), scale: doorK };
    recipe.items.push(item);
    wallShown.push(shownBox(item));
    wallUsed.push({ x0, x1: x0 + doorW, h0: 0, h1: door.real_size[2] });
    plan.reserve({ x0, x1: x0 + doorW, z0: 0, z1: door.clearance }, 'door');
  }

  // 3. the anchor, against the back wall, out of the door's way. Tried at random spots along the wall, then the rest.
  const anchor = spec.anchor;
  const af = ROOM_FACTS[anchor];
  const [aw, ad] = af.real_size;
  const nightW = ROOM_FACTS.sideTable.real_size[0];
  const goes = new Set(af.goes_with || []);
  const spots = [];
  for (let x0 = 0; x0 + aw <= roomCm.w; x0 += 10) spots.push(x0);
  shuffle(spots);
  let anchorAt = null;
  for (const x0 of spots) {
    const r = { x0, x1: x0 + aw, z0: 0, z1: ad };
    // an anchor that goes with a side table (a bed, a sofa) wants room for one at one end
    const roomForTable = !goes.has('sideTable')
      || plan.fits({ x0: x0 - GAP - nightW, x1: x0 - GAP, z0: 0, z1: ROOM_FACTS.sideTable.real_size[1] })
      || plan.fits({ x0: x0 + aw + GAP, x1: x0 + aw + GAP + nightW, z0: 0, z1: ROOM_FACTS.sideTable.real_size[1] });
    if (plan.fits(r, af.clearance) && roomForTable) { anchorAt = r; break; }
  }
  if (!anchorAt) for (const x0 of spots) { const r = { x0, x1: x0 + aw, z0: 0, z1: ad }; if (plan.fits(r, af.clearance)) { anchorAt = r; break; } }
  const placed = [];   // { part, r, item }
  // A floor piece as it would be drawn at `r`, not yet placed (`placeFloor` places it).
  const floorItem = (part, r, extra = {}) => {
    const f = ROOM_FACTS[part];
    const foot = planToStage(shell, (r.x0 + r.x1) / 2, r.z1, roomCm);
    return { id: `${part}?`, kind: 'furniture', part, x: round(foot.x), y: round(foot.y),
      scale: floorScale(shell, part, f.real_size[0], foot.y, roomCm), ...extra };
  };
  const againstBack = (r) => r.z0 <= 0;
  const placeFloor = (part, r, extra = {}) => {
    const f = ROOM_FACTS[part];
    const item = { ...floorItem(part, r, extra), id: id(part) };
    recipe.items.push(item);
    if (!f.flat) plan.add(part, r, f.clearance);
    if (!f.flat && againstBack(r)) backShown.push(shownBox(item));
    const entry = { part, r, item };
    placed.push(entry);
    return entry;
  };
  const anchorEntry = anchorAt ? placeFloor(anchor, anchorAt) : null;
  if (!anchorAt) leftOut.push(anchor);

  // 4. what goes with the anchor, from its own `goes_with`: side tables at its ends (a lamp on the first), a lamp ON it
  // when it has a top and no side tables (a desk), and a rug in front of it.
  const tables = [];
  if (anchorAt && !goes.has('sideTable') && goes.has('tableLamp') && af.surface) lampOn(anchorEntry);
  if (anchorAt && goes.has('sideTable')) {
    const st = ROOM_FACTS.sideTable;
    const [tw, td] = st.real_size;
    const ends = [
      { x0: anchorAt.x0 - GAP - tw, x1: anchorAt.x0 - GAP, z0: 0, z1: td },
      { x0: anchorAt.x1 + GAP, x1: anchorAt.x1 + GAP + tw, z0: 0, z1: td },
    ];
    if (coin()) ends.reverse();
    const want = coin(0.6) ? 2 : 1;
    for (const r of ends) {
      if (tables.length >= want) break;
      if (plan.fits(r, st.clearance)) tables.push(placeFloor('sideTable', r));
    }
    if (!tables.length) leftOut.push('sideTable');
    // a lamp on the first nightstand (a reading lamp), and sometimes on the second
    tables.forEach((t, i) => { if (i === 0 || coin(0.4)) lampOn(t); });
  }
  // the rug in front of the anchor, centred on it, over the floor it can see. (The draws above come in the same order
  // as before for a bedroom, so a bedroom already made from a seed is the same room after this.)
  if (anchorAt && goes.has('rug')) {
    const rf = ROOM_FACTS.rug;
    const rz0 = anchorAt.z1 - 40, rz1 = Math.min(roomCm.d, rz0 + rf.real_size[1]);
    const rx = (anchorAt.x0 + anchorAt.x1) / 2;
    if (coin(0.8)) placeFloor('rug', { x0: rx - rf.real_size[0] / 2, x1: rx + rf.real_size[0] / 2, z0: rz0, z1: rz1 });
  }
  function lampOn(t) {
    const lf = ROOM_FACTS.tableLamp;
    const foot = t.item.y;
    // the table's top, on the stage: its foot, raised by its drawn height at its depth and scale
    const tablePx = FURNITURE[t.part].box[1] * depthScale(foot) * t.item.scale;
    const topY = foot - (tablePx / STAGE.h) * 100 * 0.9;
    const lamp = { id: 'tableLamp?', kind: 'furniture', part: 'tableLamp', x: t.item.x, y: round(topY), ground: foot,
      scale: floorScale(shell, 'tableLamp', lf.real_size[0], foot, roomCm), standsOn: t.item.id };
    // A lamp on a table against the back wall stands in front of what hangs there: not under a window or a picture.
    const back = againstBack(t.r);
    const box = back ? shownBox(lamp) : null;
    if (back && touches(box, wallShown)) return;
    lamp.id = id('tableLamp');
    recipe.items.push(lamp);
    if (back) backShown.push(box);
  }
  /** Hang a wall thing if what it would look like touches nothing on the back wall (nor a piece standing against it). */
  const hang = (item) => {
    const box = shownBox(item);
    if (touches(box, wallShown) || touches(box, backShown)) return false;
    recipe.items.push(item);
    wallShown.push(box);
    return true;
  };

  // 2b + 5. the wall: the window, a picture over the anchor (the bed, the sofa, the desk), a clock. Each checked against
  // what is on the wall already.
  const win = ROOM_FACTS.window;
  const [ww, , wh] = win.real_size;
  const winSpots = [];
  for (let x0 = 20; x0 + ww <= roomCm.w - 20; x0 += 10) winSpots.push(x0);
  shuffle(winSpots);
  const overBed = anchorAt ? { x0: anchorAt.x0 + 30, x1: anchorAt.x1 - 30 } : null;
  // a window over the bed is ordinary; it then takes the picture's place
  let windowAt = null;
  for (const x0 of winSpots) {
    if (!wallFree(x0, x0 + ww, win.at - wh / 2, win.at + wh / 2)) continue;
    const at = wallToStage(shell, x0 + ww / 2, win.at, roomCm);
    if (hang({ id: `window${n + 1}`, kind: 'furniture', part: 'window', x: round(at.x), y: round(at.y), scale: wallScale(shell, 'window', ww, roomCm) })) {
      n += 1;
      windowAt = x0;
      wallUsed.push({ x0, x1: x0 + ww, h0: win.at - wh / 2, h1: win.at + wh / 2 });
      break;
    }
  }
  if (windowAt == null) leftOut.push('window');
  if (overBed) {
    const fw = 60, fh = 60, fat = 150;
    const cx = (overBed.x0 + overBed.x1) / 2;
    if (wallFree(cx - fw / 2, cx + fw / 2, fat - fh / 2, fat + fh / 2)) {
      const at = wallToStage(shell, cx, fat, roomCm);
      const frame = pick(['classic', 'ornate', 'instant']);
      if (hang({ id: `frame${n + 1}`, kind: 'frame', x: round(at.x), y: round(at.y), frame, width: Math.round(fw * ppc) })) {
        n += 1;
        wallUsed.push({ x0: cx - fw / 2, x1: cx + fw / 2, h0: fat - fh / 2, h1: fat + fh / 2 });
      }
    }
  }
  // The clock: 30 cm across, drawn that size (it was a fixed 60 px, which on a wide wall is far bigger than the 30 cm
  // kept for it, and so it reached over the window).
  const cw = 30, cat = 195;
  for (const cx of [...winSpots].map((x) => x + 15)) {
    if (!wallFree(cx - cw / 2, cx + cw / 2, cat - cw / 2, cat + cw / 2)) continue;
    const at = wallToStage(shell, cx, cat, roomCm);
    if (hang({ id: `clock${n + 1}`, kind: 'clock', x: round(at.x), y: round(at.y), size: Math.round(cw * ppc) })) {
      n += 1;
      wallUsed.push({ x0: cx - cw / 2, x1: cx + cw / 2, h0: cat - cw / 2, h1: cat + cw / 2 });
      break;
    }
  }

  // 6. fill, each to a count drawn from its range, at random spots; against-the-wall pieces at the back wall
  for (const part of spec.fill) {
    const f = ROOM_FACTS[part];
    if (!f || !f.rooms.includes(type)) continue;
    const lo = (spec.need || []).includes(part) ? Math.max(1, f.count[0]) : f.count[0];
    const want = lo + Math.floor(rand() * (Math.max(lo, f.count[1]) - lo + 1));
    const [pw, pd] = f.real_size;
    for (let k = 0; k < want; k++) {
      const tries = [];
      if (f.against === 'wall') {
        for (let x0 = 0; x0 + pw <= roomCm.w; x0 += 10) tries.push({ x0, x1: x0 + pw, z0: 0, z1: pd });   // the back wall
        for (let z0 = 0; z0 + pd <= roomCm.d && !f.back_only; z0 += 20) {                                 // the side walls
          tries.push({ x0: 0, x1: pw, z0, z1: z0 + pd });
          tries.push({ x0: roomCm.w - pw, x1: roomCm.w, z0, z1: z0 + pd });
        }
      }
      else for (let x0 = 0; x0 + pw <= roomCm.w; x0 += 20) for (let z0 = 0; z0 + pd <= roomCm.d; z0 += 20) tries.push({ x0, x1: x0 + pw, z0, z1: z0 + pd });
      shuffle(tries);
      // A piece pushed back against the wall must not stand in front of the window, the picture or the clock (a flat
      // rug is never against a wall).
      const r = tries.find((t) => plan.fits(t, f.clearance) && (f.flat || !againstBack(t) || !touches(shownBox(floorItem(part, t)), wallShown)));
      if (!r) { leftOut.push(part); break; }
      const p = placeFloor(part, r);
      if (f.surface && coin(0.5)) lampOn(p);
    }
  }

  return { recipe, plan: { pieces: plan.pieces, keepClear: plan.keepClear, roomCm }, left_out: leftOut };
}

/** A new seed for "Make another": the one after `seed` in a long, even walk, so pressing it again never repeats soon. */
export const nextSeed = (seed) => (((Number(seed) >>> 0) || 1) * 1103515245 + 12345) >>> 0 || 1;
