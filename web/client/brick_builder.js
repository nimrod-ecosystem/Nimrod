// brick_builder.js — A MODEL BUILT FROM NIMROD PARTS: THE DATA, THE MOVES, THE DRAWING AND THE MATCH. No DOM.
//
// Mike, 2026-10-09: "We aren't limited to A1 sizes now that it's for the site. Did you make the furniture out of
// pieces that small? We need some sort of builder on the site for making models out of the bricks as well as building
// rooms/dashboards." And: "We should have a building game where you can see the finished product and you have to
// build it."
//
// This file is both of those without a page: the Brick builder (modules/brickbuilder.js, through
// brick_builder_view.js) and Build it (modules/buildit.js, build_it.js) use it, and a suite tests every move here
// without mounting anything.
//
// *** WHAT A BUILD IS (`nimrod-brick-build/1`). *** JSON of parts -- no pictures, no sound, so it is a person's own
// small layout data the server may keep (storage_line.py: integers and short strings):
//   { schema, id, name, floor: { w, d } mm, parts: [ { id, part, w, l, h, x, y, z, rot, colour } ], updated }
//   part      a brick_parts.js part: brick | baseplate | lbracket | corner3 | plateI | plateL | plateT
//   w, l, h   its size in mm as brick_parts.js `partSpec` makes it (w along x, l along z, h up), BEFORE turning
//   x, z      where its footprint's corner is, mm, on the 40 mm grid; y how high it sits, mm (worked out, below)
//   rot       quarter turns about the vertical, 0..3
//   colour    'theme1'..'theme5' (the theme's brick colours, var(--brick-N): they change with the theme) or '#rrggbb'
// The frame is brick_parts.js's drawing frame: x along the width, y UP, z the depth (toward the viewer). The CAD
// side's assemblies are +Z up; `fromAssembly` turns one round.
//
// *** THINGS FALL DOWN (`settle`), ARGUED. *** A part is never put at a height: it goes on the floor or on top of
// whatever is under it, and taking a part away lets what stood on it come down. FOR: one rule a person learns in one
// go, a model can never hold a part floating in the air that a printed model could not, nothing has to be "lifted a
// layer" by hand (a switch user's presses), and the match in Build it compares heights without anybody lining them
// up. AGAINST: a real model is held by its connectors, so a bracket on the side of a leg, or a shelf half-way up a
// frame, is something this cannot make yet -- the side-mounted brackets of the published desk come out of
// `fromAssembly` standing on the floor. "Stick it to the side" is the next thing to add, not a reason to drop the
// rule for v1. [A guess, in the report.]
//
// *** NO PRINTER CAP. *** Any size in 40 mm steps up to brick_parts.js SIZE_MAX (2560 mm -- a sanity bound, not a
// printer); a floor up to FLOOR_MAX cells. Printing is talked about on the bricks page, not here.
//
// HARD-CODED, each with its argument (Rule 1):
//   MAX_PARTS 300        a build's size bound: the published desk is 32 parts, so 300 is ten desks. It keeps one build
//                        well under the server's row cap (a part is ~110 bytes: 300 is ~33 KB of a 2 MB row) and keeps
//                        the drawing quick on a Pi. AGAINST: a big model wants more. It is one number.
//   FLOOR 16 cells       a new build's floor, 640 mm square: big enough for a table, small enough that a 40 mm brick
//                        is still a good size on a small screen. It grows by itself to fit what is put on it, and the
//                        builder's "Bigger floor" / "Smaller floor" change it. A setting in the builder (floorCells).
//   FLOOR_MIN 4, FLOOR_MAX 64 cells   160 mm to 2.56 m: past that the 40 mm grid is too fine to see on a screen.
//   HISTORY_MAX 100      undo steps kept. Each is a copy of the parts (300 parts at most): memory, not a limit anyone
//                        should meet.
//   GHOST 0.55, DIM 0.35 how see-through the part in your hand and the parts behind a choice are: looks, not settings.

import {
  GRID, PART_IDS, PARTS, SIZE_MAX, THICKNESSES, partSpec, partBoxes, isoProject, isoPath, isoSocketPts, isoGridLines,
} from './brick_parts.js';
import { BRICK_COLOUR_COUNT, BRICK_SHADES, brickColourCss } from './brick_colours.js';

export { GRID };
export const SCHEMA = 'nimrod-brick-build/1';
export const MAX_PARTS = 300;
export const FLOOR_CELLS = 16;
export const FLOOR_MIN = 4;
export const FLOOR_MAX = 64;
export const HISTORY_MAX = 100;
export const NAME_MAX = 60;
export const COLOURS = Object.freeze(Array.from({ length: BRICK_COLOUR_COUNT }, (_, i) => `theme${i + 1}`));
export const HAND_DEFAULT = Object.freeze({ part: 'brick', w: 80, l: 40, h: 40, rot: 0, colour: 'theme1' });

const J = (v) => JSON.stringify(v);
const int = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
const onGrid = (v) => Math.max(0, Math.round(int(v) / GRID) * GRID);
const hexOf = (v) => { const s = String(v ?? '').trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : null; };

/** A colour as stored: 'theme1'..'theme5' or '#rrggbb'; anything else 'theme1'. */
export function normalizeColour(v) {
  if (COLOURS.includes(v)) return v;
  return hexOf(v) || COLOURS[0];
}
/** A colour as CSS: var(--brick-N) for a theme colour (it follows the theme), the hex for your own. */
export function colourCss(v) {
  const c = normalizeColour(v);
  const i = COLOURS.indexOf(c);
  return i >= 0 ? brickColourCss(i) : c;
}

/** The brick_parts.js spec of a part record (its true dims: a plate is never less than it can be). */
export function specOf(p) {
  return partSpec({ part: p.part, width: p.w, length: p.l, height: p.h, thickness: THICKNESSES.includes(Number(p.h)) ? Number(p.h) : 5 });
}

/** A part as stored, or null (not a part). Pure. */
export function normalizePart(p, i = 0) {
  if (!p || typeof p !== 'object' || !PART_IDS.includes(p.part)) return null;
  const spec = specOf({ part: p.part, w: int(p.w, GRID), l: int(p.l, GRID), h: int(p.h, GRID) });
  const rot = ((int(p.rot) % 4) + 4) % 4;
  const id = typeof p.id === 'string' && /^[\w-]{1,40}$/.test(p.id) ? p.id : `p${i + 1}`;
  return { id, part: spec.part, w: spec.dims[0], l: spec.dims[1], h: spec.dims[2], x: onGrid(p.x), y: Math.max(0, int(p.y)), z: onGrid(p.z), rot, colour: normalizeColour(p.colour) };
}

/** The footprint a part covers, turned: { w, d } mm. */
export function footprint(p) {
  const s = specOf(p);
  return p.rot % 2 ? { w: s.dims[1], d: s.dims[0] } : { w: s.dims[0], d: s.dims[1] };
}

const floorOf = (f) => ({
  w: Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, Math.round(int(f?.w, FLOOR_CELLS * GRID) / GRID))) * GRID,
  d: Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, Math.round(int(f?.d, FLOOR_CELLS * GRID) / GRID))) * GRID,
});

/** A new, empty build. */
export function newBuild({ id = null, name = 'My build', floorCells = FLOOR_CELLS } = {}) {
  const n = Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, int(floorCells, FLOOR_CELLS)));
  return { schema: SCHEMA, id: id || newId(), name: cleanName(name), floor: { w: n * GRID, d: n * GRID }, parts: [], updated: 0 };
}
let idSeq = 0;
export function newId(now = Date.now()) { idSeq = (idSeq + 1) % 1296; return `b${now.toString(36)}${idSeq.toString(36)}`; }
export const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NAME_MAX) || 'My build';

/** A build as stored (anything else made safe): parts on the grid, inside the floor, settled. Pure. */
export function normalizeBuild(b) {
  if (!b || typeof b !== 'object') return null;
  const parts = (Array.isArray(b.parts) ? b.parts : []).slice(0, MAX_PARTS).map(normalizePart).filter(Boolean);
  // Unique part ids (a hand-edited file may repeat one).
  const seen = new Set();
  parts.forEach((p, i) => { if (seen.has(p.id)) p.id = `p${i + 1}x${i}`; seen.add(p.id); });
  let floor = floorOf(b.floor);
  floor = grownToFit(floor, parts);
  return {
    schema: SCHEMA,
    id: typeof b.id === 'string' && /^[\w-]{1,40}$/.test(b.id) ? b.id : newId(),
    name: cleanName(b.name),
    floor,
    parts: settle(parts),
    updated: Math.max(0, int(b.updated)),
  };
}

function grownToFit(floor, parts) {
  let { w, d } = floor;
  for (const p of parts) { const f = footprint(p); w = Math.max(w, p.x + f.w); d = Math.max(d, p.z + f.d); }
  return { w: Math.min(FLOOR_MAX * GRID, w), d: Math.min(FLOOR_MAX * GRID, d) };
}

// ---------------------------------------------------------------------------------------------------------------
// WHERE A PART IS: its boxes in the world (turned, moved), for the drawing, the falling and the match.
// ---------------------------------------------------------------------------------------------------------------
function rotXZ(x, z, rot, W, D) {
  switch (rot) {
    case 1: return [D - z, x];
    case 2: return [W - x, D - z];
    case 3: return [z, W - x];
    default: return [x, z];
  }
}
function rotN(nx, nz, rot) {
  switch (rot) {
    case 1: return [-nz, nx];
    case 2: return [-nx, -nz];
    case 3: return [nz, -nx];
    default: return [nx, nz];
  }
}
const centres = (a, b) => { const out = []; for (let c = a + GRID / 2; c < b; c += GRID) out.push(c); return out; };
const NORMAL = { top: [0, 0], left: [0, 1], right: [1, 0] };

/** A part's boxes in the world: [{ x0, y0, z0, x1, y1, z1, sockets }]. Pure. */
export function worldBoxes(p) {
  const spec = specOf(p);
  const [W, D] = spec.dims;
  const rot = p.rot || 0;
  return partBoxes(spec).map((b) => {
    const [ax, az] = rotXZ(b.x0, b.z0, rot, W, D);
    const [bx, bz] = rotXZ(b.x1, b.z1, rot, W, D);
    const out = {
      x0: Math.min(ax, bx) + p.x, x1: Math.max(ax, bx) + p.x, y0: b.y0 + p.y, y1: b.y1 + p.y,
      z0: Math.min(az, bz) + p.z, z1: Math.max(az, bz) + p.z, sockets: [],
    };
    if (spec.part === 'brick' || spec.part === 'baseplate') {
      // A brick has a socket on every cell of every face, so its visible faces are drawn afresh after a turn.
      for (const x of centres(out.x0, out.x1)) for (const z of centres(out.z0, out.z1)) out.sockets.push({ face: 'top', at: [x, out.y1, z] });
      if (spec.part === 'brick') {
        for (const x of centres(out.x0, out.x1)) for (const y of centres(out.y0, out.y1)) out.sockets.push({ face: 'left', at: [x, y, out.z1] });
        for (const z of centres(out.z0, out.z1)) for (const y of centres(out.y0, out.y1)) out.sockets.push({ face: 'right', at: [out.x1, y, z] });
      }
    } else {
      for (const s of b.sockets) {
        const [nx, nz] = rotN(...NORMAL[s.face], rot);
        const face = s.face === 'top' ? 'top' : nx === 1 ? 'right' : nz === 1 ? 'left' : null;
        if (!face) continue;   // turned to face away: hidden
        const [sx, sz] = rotXZ(s.at[0], s.at[2], rot, W, D);
        out.sockets.push({ face, at: [sx + p.x, s.at[1] + p.y, sz + p.z] });
      }
    }
    return out;
  });
}

const xzOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;

/** How high part `p` comes to rest among `others` (already standing): the top of what is under any of its boxes. */
export function restingY(p, others) {
  const mine = worldBoxes({ ...p, y: 0 });
  let y = 0;
  for (const q of others) {
    if (q === p || q.id === p.id) continue;
    for (const qb of worldBoxes(q)) for (const pb of mine) if (xzOverlap(pb, qb)) y = Math.max(y, qb.y1 - pb.y0);
  }
  return y;
}

/** Everything comes to rest, lowest first (then in the order put down). Pure: a new array. */
export function settle(parts) {
  const order = parts.map((p, i) => ({ p, i })).sort((a, b) => (a.p.y - b.p.y) || (a.i - b.i));
  const placed = [];
  const out = new Array(parts.length);
  for (const { p, i } of order) {
    const y = restingY(p, placed);
    const np = y === p.y ? p : { ...p, y };
    placed.push(np);
    out[i] = np;
  }
  return out;
}

/** The part on top at cell (cx, cz) (cells), or null. */
export function topAt(parts, cx, cz) {
  const px = cx * GRID + GRID / 2; const pz = cz * GRID + GRID / 2;
  let best = null; let top = -1;
  for (const p of parts) {
    for (const b of worldBoxes(p)) {
      if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1 && b.y1 > top) { top = b.y1; best = p; }
    }
  }
  return best;
}

/** The top of the stack at a cell, mm (0: the floor). */
export function heightAt(parts, cx, cz) {
  const px = cx * GRID + GRID / 2; const pz = cz * GRID + GRID / 2;
  let top = 0;
  for (const p of parts) for (const b of worldBoxes(p)) if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1) top = Math.max(top, b.y1);
  return top;
}

// ---------------------------------------------------------------------------------------------------------------
// THE MOVES. An editor holds a build, a cursor (a cell), the part in your hand, and undo / redo. Every move is one
// step back. No DOM: brick_builder_view.js draws it and turns presses into these.
// ---------------------------------------------------------------------------------------------------------------
/** The hand as data: a part, its size, its turn and its colour, always one a part can be. */
export function normalizeHand(h) {
  const v = h && typeof h === 'object' ? h : {};
  const p = normalizePart({ ...HAND_DEFAULT, ...v, x: 0, z: 0, y: 0, id: 'hand' });
  return p ? { part: p.part, w: p.w, l: p.l, h: p.h, rot: p.rot, colour: p.colour } : { ...HAND_DEFAULT };
}

/** The size rows a part has (brick_parts.js PARTS[part].rows), as the hand's keys. */
export function sizeRows(part) {
  const rows = (PARTS[part] || PARTS.brick).rows;
  return rows.map((r) => (r === 'width' ? 'w' : r === 'length' ? 'l' : 'h'));
}

export function createEditor(build = null, { onChange = null, hand = null } = {}) {
  let b = normalizeBuild(build || newBuild());
  let cursor = { x: 0, z: 0 };
  let h = normalizeHand(hand);
  const undoStack = [];
  const redoStack = [];
  let seq = b.parts.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0), 0);

  const snap = () => ({ parts: b.parts, floor: { ...b.floor } });
  const cells = () => ({ w: b.floor.w / GRID, d: b.floor.d / GRID });
  const changed = (what) => { try { onChange?.(get(), what); } catch (err) { console.error('brick builder: onChange', err); } };
  function step(next, what) {
    undoStack.push(snap());
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
    b = { ...b, ...next };
    changed(what);
    return true;
  }
  const get = () => ({ ...b, parts: b.parts.map((p) => ({ ...p })), floor: { ...b.floor } });
  const clampCursor = () => {
    const c = cells();
    cursor = { x: Math.max(0, Math.min(c.w - 1, int(cursor.x))), z: Math.max(0, Math.min(c.d - 1, int(cursor.z))) };
  };

  /** The hand's part where it would go now (the cursor, kept inside the floor), resting on what is there. */
  function ghost() {
    const p = normalizePart({ ...h, id: `p${seq + 1}`, x: cursor.x * GRID, z: cursor.z * GRID, y: 0 });
    const f = footprint(p);
    p.x = Math.max(0, Math.min(Math.max(0, b.floor.w - f.w), p.x));
    p.z = Math.max(0, Math.min(Math.max(0, b.floor.d - f.d), p.z));
    p.y = restingY(p, b.parts);
    return p;
  }

  const api = {
    get,
    hand: () => ({ ...h }),
    cursor: () => ({ ...cursor }),
    ghost,
    here: () => topAt(b.parts, cursor.x, cursor.z),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    /** Put the hand's part at the cursor, on top of whatever is there. False when the build is full. */
    put() {
      if (b.parts.length >= MAX_PARTS) return false;
      const p = ghost();
      const f = footprint(p);
      // A part bigger than the floor makes the floor bigger (to FLOOR_MAX): there is no printer bed here.
      const floor = { w: Math.min(FLOOR_MAX * GRID, Math.max(b.floor.w, p.x + f.w)), d: Math.min(FLOOR_MAX * GRID, Math.max(b.floor.d, p.z + f.d)) };
      seq += 1;
      p.id = `p${seq}`;
      return step({ parts: settle([...b.parts, p]), floor }, 'put');
    },
    /** Take away the part on top here. */
    remove() {
      const p = api.here();
      if (!p) return false;
      return step({ parts: settle(b.parts.filter((q) => q !== p)) }, 'remove');
    },
    /** Pick up the part on top here: it goes into your hand (its part, size, turn and colour), off the model. */
    pickUp() {
      const p = api.here();
      if (!p) return false;
      h = normalizeHand(p);
      cursor = { x: p.x / GRID, z: p.z / GRID };
      return step({ parts: settle(b.parts.filter((q) => q !== p)) }, 'pickUp');
    },
    /** Paint the part on top here in the hand's colour. */
    paint() {
      const p = api.here();
      if (!p || p.colour === h.colour) return false;
      return step({ parts: b.parts.map((q) => (q === p ? { ...q, colour: h.colour } : q)) }, 'paint');
    },
    /** Turn the part on top here a quarter, where it stands (kept inside the floor). */
    turnHere() {
      const p = api.here();
      if (!p) return false;
      const t = { ...p, rot: (p.rot + 1) % 4 };
      const f = footprint(t);
      t.x = Math.max(0, Math.min(Math.max(0, b.floor.w - f.w), t.x));
      t.z = Math.max(0, Math.min(Math.max(0, b.floor.d - f.d), t.z));
      // Lift it clear and let it come down again where it now is.
      const others = b.parts.filter((q) => q !== p);
      t.y = restingY(t, others);
      return step({ parts: settle(b.parts.map((q) => (q === p ? t : q))) }, 'turnHere');
    },
    turnHand() { h = { ...h, rot: (h.rot + 1) % 4 }; changed('hand'); return true; },
    setHand(patch) { h = normalizeHand({ ...h, ...(patch || {}) }); changed('hand'); return true; },
    /** The next / previous part in brick_parts.js's order, keeping the size where it applies. */
    cyclePart(dir = 1) {
      const i = PART_IDS.indexOf(h.part);
      const part = PART_IDS[(i + (dir < 0 ? -1 : 1) + PART_IDS.length) % PART_IDS.length];
      const keepH = part === 'baseplate' ? (THICKNESSES.includes(h.h) ? h.h : 5) : part === 'brick' ? Math.max(GRID, h.h) : h.h;
      h = normalizeHand({ ...h, part, h: keepH });
      changed('hand');
      return true;
    },
    /** One size step on a row ('w' | 'l' | 'h'): 40 mm, or a baseplate's 5 <-> 10 mm. False when it cannot. */
    resize(row, dir = 1) {
      if (!sizeRows(h.part).includes(row)) return false;
      let v;
      if (h.part === 'baseplate' && row === 'h') v = dir > 0 ? 10 : 5;
      else v = Math.max(GRID, Math.min(SIZE_MAX, h[row] + (dir > 0 ? GRID : -GRID)));
      const next = normalizeHand({ ...h, [row]: v });
      if (J(next) === J(h)) return false;
      h = next;
      changed('hand');
      return true;
    },
    setColour(c) { h = { ...h, colour: normalizeColour(c) }; changed('hand'); return true; },
    moveCursor(dx, dz) { const was = J(cursor); cursor = { x: cursor.x + int(dx), z: cursor.z + int(dz) }; clampCursor(); if (J(cursor) !== was) changed('cursor'); return J(cursor) !== was; },
    setCursor(x, z) { const was = J(cursor); cursor = { x: int(x), z: int(z) }; clampCursor(); if (J(cursor) !== was) changed('cursor'); return J(cursor) !== was; },
    /** The floor a step bigger or smaller (4 cells each way); never smaller than what stands on it. */
    resizeFloor(dir = 1) {
      const need = grownToFit({ w: FLOOR_MIN * GRID, d: FLOOR_MIN * GRID }, b.parts);
      const d4 = 4 * GRID * (dir > 0 ? 1 : -1);
      const floor = {
        w: Math.min(FLOOR_MAX * GRID, Math.max(need.w, FLOOR_MIN * GRID, b.floor.w + d4)),
        d: Math.min(FLOOR_MAX * GRID, Math.max(need.d, FLOOR_MIN * GRID, b.floor.d + d4)),
      };
      if (floor.w === b.floor.w && floor.d === b.floor.d) return false;
      step({ floor }, 'floor');
      clampCursor();
      return true;
    },
    rename(name) { const n = cleanName(name); if (n === b.name) return false; b = { ...b, name: n }; changed('name'); return true; },
    undo() {
      if (!undoStack.length) return false;
      redoStack.push(snap());
      const s = undoStack.pop();
      b = { ...b, parts: s.parts, floor: s.floor };
      clampCursor();
      changed('undo');
      return true;
    },
    redo() {
      if (!redoStack.length) return false;
      undoStack.push(snap());
      const s = redoStack.pop();
      b = { ...b, parts: s.parts, floor: s.floor };
      clampCursor();
      changed('redo');
      return true;
    },
    /** Open another build: a fresh history, the cursor at the corner. */
    load(build) {
      b = normalizeBuild(build) || newBuild();
      undoStack.length = 0; redoStack.length = 0;
      seq = b.parts.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0), 0);
      cursor = { x: 0, z: 0 };
      changed('load');
      return true;
    },
    /** Replace the parts (a game putting a chosen part), as one step. */
    setParts(parts, what = 'set') {
      const list = (parts || []).slice(0, MAX_PARTS).map(normalizePart).filter(Boolean);
      seq = Math.max(seq, list.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/\D/g, '')) || 0), 0));
      return step({ parts: settle(list), floor: grownToFit(b.floor, list) }, what);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------------
// THE DRAWING: every part's boxes, back to front, in the same three-quarter view as one part (brick_parts.js).
// ---------------------------------------------------------------------------------------------------------------
const COS30 = Math.cos(Math.PI / 6);
const fmt = (n) => (Math.round(n * 100) / 100).toString();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const corners = (b) => { const out = []; for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) out.push(isoProject(x, y, z)); return out; };
function rectOf(b) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [px, py] of corners(b)) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  return { x0, y0, x1, y1 };
}
const behind = (a, b) => a.x1 <= b.x0 || a.z1 <= b.z0 || a.y1 <= b.y0;
const depthKey = (b) => b.x0 + b.z0 + b.y0;

/**
 * The boxes in drawing order, back to front (pure). Only boxes whose pictures overlap are ordered against each other,
 * so a big model sorts in O(n^2) rather than brick_parts.js's O(n^3) one-part sort; a tie (which cannot happen between
 * boxes that do not overlap) is broken by depth.
 */
export function orderBoxes(boxes) {
  const n = boxes.length;
  const rects = boxes.map(rectOf);
  const after = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = rects[i]; const s = rects[j];
      if (!(r.x0 < s.x1 - 0.01 && s.x0 < r.x1 - 0.01 && r.y0 < s.y1 - 0.01 && s.y0 < r.y1 - 0.01)) continue;
      const ij = behind(boxes[i], boxes[j]); const ji = behind(boxes[j], boxes[i]);
      if (ij && !ji) { after[i].push(j); indeg[j]++; } else if (ji && !ij) { after[j].push(i); indeg[i]++; } else if (ij && ji) {
        if (depthKey(boxes[i]) <= depthKey(boxes[j])) { after[i].push(j); indeg[j]++; } else { after[j].push(i); indeg[i]++; }
      }
    }
  }
  const ready = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const out = [];
  const done = new Array(n).fill(false);
  while (out.length < n) {
    if (!ready.length) {   // a cycle (should not happen): take the deepest left and carry on
      let k = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (k < 0 || depthKey(boxes[i]) < depthKey(boxes[k]))) k = i;
      ready.push(k); indeg[k] = 0;
    }
    ready.sort((a, b) => depthKey(boxes[a]) - depthKey(boxes[b]) || a - b);
    const i = ready.shift();
    if (done[i]) continue;
    done[i] = true;
    out.push(boxes[i]);
    for (const j of after[i]) if (!done[j] && --indeg[j] === 0) ready.push(j);
  }
  return out;
}

/** Every part's boxes, with what the drawing needs: its colour and its id. */
export function modelBoxes(parts, extra = {}) {
  const out = [];
  for (const p of parts || []) for (const b of worldBoxes(p)) out.push({ ...b, fill: colourCss(p.colour), pid: p.id, ...extra });
  return out;
}

const faceList = (b) => [
  ['right', [[b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0]], BRICK_SHADES[2]],
  ['left', [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], BRICK_SHADES[1]],
  ['top', [[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], BRICK_SHADES[0]],
];

/** The picture's own bounds for a floor and a height (so a model does not jump about as it grows). */
export function viewBounds(floor, boxes, minHeight = 2 * GRID) {
  let top = minHeight;
  for (const b of boxes) top = Math.max(top, b.y1);
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  if (floor) {
    const f = floorOf(floor);
    for (const [x, z] of [[0, 0], [f.w, 0], [0, f.d], [f.w, f.d]]) {
      for (const y of [0, top]) { const [px, py] = isoProject(x, y, z); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
    }
  }
  for (const b of boxes) { const r = rectOf(b); x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); y0 = Math.min(y0, r.y0); y1 = Math.max(y1, r.y1); }
  if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.03 + 2;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/**
 * A model as one SVG string (pure). `opts`:
 *   floor { w, d } mm      the floor drawn under it (a grid of 40 mm cells); null: no floor
 *   cursor { x, z } cells  a ring on the top of that cell's stack
 *   ghost  part            the part in your hand, drawn see-through where it would go
 *   focus  part id         one part drawn in full and the rest faint (a choice in Build it)
 *   sockets                draw the sockets (default true)
 *   title                  the picture's words (aria-label)
 */
export function buildSvg(parts, { floor = null, cursor = null, ghost = null, focus = null, sockets = true, title = '', minHeight = 2 * GRID } = {}) {
  const list = modelBoxes(parts);
  if (ghost) for (const b of worldBoxes(ghost)) list.push({ ...b, fill: colourCss(ghost.colour), pid: 'ghost', ghost: true });
  const ordered = orderBoxes(list);
  const vb = viewBounds(floor, list, floor ? minHeight : 0);
  let body = '';
  if (floor) {
    const f = floorOf(floor);
    const pts = [[0, 0, 0], [f.w, 0, 0], [f.w, 0, f.d], [0, 0, f.d]];
    body += `<path data-floor="" d="${isoPath(pts)}" style="fill:var(--bb-floor, var(--surface-alt, #e8e4cf))" stroke="var(--bb-edge, #8a8470)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    let g = '';
    for (let x = GRID; x < f.w; x += GRID) g += isoPath([[x, 0, 0], [x, 0, f.d]]).replace(/Z$/, '');
    for (let z = GRID; z < f.d; z += GRID) g += isoPath([[0, 0, z], [f.w, 0, z]]).replace(/Z$/, '');
    if (g) body += `<path d="${g}" fill="none" stroke="var(--bb-edge, #8a8470)" stroke-opacity="0.45" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  for (const b of ordered) {
    const faint = focus != null && !b.ghost && b.pid !== focus;
    const op = b.ghost ? 0.55 : faint ? 0.35 : 1;
    body += `<g data-pid="${esc(b.pid)}"${b.ghost ? ' data-ghost=""' : ''}${op < 1 ? ` opacity="${op}"` : ''} style="--bk:${esc(b.fill)}">`;
    for (const [face, pts, shade] of faceList(b)) {
      const d = isoPath(pts);
      body += `<path class="bk-face" data-face="${face}" d="${d}" style="fill:var(--bk)"/>`;
      if (shade) body += `<path d="${d}" fill="black" fill-opacity="${shade}" pointer-events="none"/>`;
    }
    const lines = isoGridLines(b).map(([a, c]) => isoPath([a, c]).replace(/Z$/, '')).join('');
    if (lines) body += `<path d="${lines}" fill="none" stroke="black" stroke-opacity="0.2" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    if (sockets && b.sockets.length) body += `<path data-sockets="${b.sockets.length}" d="${b.sockets.map((s) => isoPath(isoSocketPts(s))).join('')}" fill="black" fill-opacity="0.35" pointer-events="none"/>`;
    for (const [, pts] of faceList(b)) {
      body += `<path d="${isoPath(pts)}" fill="none" stroke="black" stroke-opacity="${b.ghost ? 0.8 : 0.45}" stroke-width="${b.ghost ? 2 : 1.5}"`
        + `${b.ghost ? ' stroke-dasharray="4 3"' : ''} stroke-linejoin="round" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    }
    body += '</g>';
  }
  if (cursor && floor) {
    const y = heightAt(parts, cursor.x, cursor.z);
    const x0 = cursor.x * GRID; const z0 = cursor.z * GRID;
    const ring = isoPath([[x0, y, z0], [x0 + GRID, y, z0], [x0 + GRID, y, z0 + GRID], [x0, y, z0 + GRID]]);
    body += `<path data-cursor="" d="${ring}" fill="none" stroke="var(--surface, #fff)" stroke-width="7" vector-effect="non-scaling-stroke" pointer-events="none"/>`
      + `<path d="${ring}" fill="none" stroke="var(--scan-ring, var(--focus, #1a5fb4))" stroke-width="4" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  }
  return `<svg class="bb-svg" viewBox="${[vb.x, vb.y, vb.w, vb.h].map(fmt).join(' ')}" preserveAspectRatio="xMidYMid meet" role="img"`
    + ` aria-label="${esc(title)}" data-parts="${(parts || []).length}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// ---------------------------------------------------------------------------------------------------------------
// WHERE A PRESS LANDED: a point in the picture's own units -> the cell under it (the floor, a part's top, or the
// column of a part whose side was pressed), and the part. Pure, so a suite can test it with no layout.
// ---------------------------------------------------------------------------------------------------------------
function inside(pt, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]; const [bx, by] = poly[(i + 1) % poly.length];
    const c = (bx - ax) * (pt[1] - ay) - (by - ay) * (pt[0] - ax);
    if (Math.abs(c) < 1e-9) continue;
    const s = c > 0 ? 1 : -1;
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}
const clampI = (v, a, b) => Math.max(a, Math.min(b, v));

/** { x, z, pid } for the point (sx, sy) of the picture, or null (off the floor and every part). */
export function pickAt(parts, floor, sx, sy) {
  const f = floorOf(floor);
  const ordered = orderBoxes(modelBoxes(parts));
  for (let i = ordered.length - 1; i >= 0; i--) {
    const b = ordered[i];
    for (const [face, pts] of faceList(b)) {
      const poly = pts.map((p) => isoProject(...p));
      if (!inside([sx, sy], poly)) continue;
      let x; let z;
      if (face === 'top') {
        const a = sx / COS30; const s = 2 * (sy + b.y1);
        x = (a + s) / 2; z = (s - a) / 2;
      } else if (face === 'right') {
        x = b.x1 - 1; z = b.x1 - sx / COS30;
      } else {
        z = b.z1 - 1; x = sx / COS30 + b.z1;
      }
      const cx = clampI(Math.floor(x / GRID), b.x0 / GRID, b.x1 / GRID - 1);
      const cz = clampI(Math.floor(z / GRID), b.z0 / GRID, b.z1 / GRID - 1);
      return { x: cx, z: cz, pid: b.pid };
    }
  }
  const a = sx / COS30; const s = 2 * sy;
  const x = (a + s) / 2; const z = (s - a) / 2;
  if (x < 0 || z < 0 || x >= f.w || z >= f.d) return null;
  return { x: Math.floor(x / GRID), z: Math.floor(z / GRID), pid: null };
}

// ---------------------------------------------------------------------------------------------------------------
// THE MATCH (Build it): the same parts in the same places and colours, wherever on the floor it was built and
// whichever way round the whole model is turned. A brick turned a quarter is the same brick (it is the same box);
// a bracket turned is not (its boxes differ), which is what "rotation-insensitive where sensible" means here.
// ---------------------------------------------------------------------------------------------------------------
const boxKey = (b) => [b.x0, b.y0, b.z0, b.x1, b.y1, b.z1].join(',');
function shapes(parts, colours) {
  return (parts || []).map((p) => ({
    kind: p.part, colour: colours ? normalizeColour(p.colour) : '',
    boxes: worldBoxes(p).map((b) => ({ x0: b.x0, y0: b.y0, z0: b.z0, x1: b.x1, y1: b.y1, z1: b.z1 })),
  }));
}
function turned(list, k) {
  if (!k) return list;
  return list.map((s) => ({ ...s, boxes: s.boxes.map((b) => {
    const pts = [[b.x0, b.z0], [b.x1, b.z1]].map(([x, z]) => {
      let a = x; let c = z;
      for (let i = 0; i < k; i++) { const t = a; a = -c; c = t; }
      return [a, c];
    });
    return { ...b, x0: Math.min(pts[0][0], pts[1][0]), x1: Math.max(pts[0][0], pts[1][0]), z0: Math.min(pts[0][1], pts[1][1]), z1: Math.max(pts[0][1], pts[1][1]) };
  }) }));
}
const minCorner = (s) => s.boxes.reduce((m, b) => [Math.min(m[0], b.x0), Math.min(m[1], b.z0)], [Infinity, Infinity]);
const sigOf = (s, dx, dz) => `${s.kind}|${s.colour}|${s.boxes.map((b) => boxKey({ ...b, x0: b.x0 + dx, x1: b.x1 + dx, z0: b.z0 + dz, z1: b.z1 + dz })).sort().join(';')}`;

/**
 * How `attempt` compares with `target` (pure): { same, right, total, missing, extra }. `right` is the most parts
 * that line up, over every turn of the whole model and every shift that puts one of its parts on one of the target's.
 *   colours  true (default): a part must be the same colour to count
 *   turns    true (default): the whole model may be turned a quarter, a half or three quarters
 */
export function matchBuilds(target, attempt, { colours = true, turns = true } = {}) {
  const T = shapes(target, colours);
  const want = new Map();
  for (const s of T) { const k = sigOf(s, 0, 0); want.set(k, (want.get(k) || 0) + 1); }
  const A0 = shapes(attempt, colours);
  let best = 0;
  for (let k = 0; k < (turns ? 4 : 1); k++) {
    const A = turned(A0, k);
    const shifts = new Set(['0,0']);
    for (const a of A) for (const t of T) {
      if (a.kind !== t.kind) continue;
      const [ax, az] = minCorner(a); const [tx, tz] = minCorner(t);
      shifts.add(`${tx - ax},${tz - az}`);
    }
    for (const sh of shifts) {
      const [dx, dz] = sh.split(',').map(Number);
      const left = new Map(want);
      let n = 0;
      for (const a of A) {
        const key = sigOf(a, dx, dz);
        const c = left.get(key) || 0;
        if (c > 0) { left.set(key, c - 1); n++; }
      }
      if (n > best) best = n;
    }
  }
  const total = T.length;
  return { same: best === total && A0.length === total, right: best, total, missing: total - best, extra: A0.length - best };
}

// ---------------------------------------------------------------------------------------------------------------
// FILES: a build as a file for the Nimrod folder, and back; the CAD side's assemblies read in.
// ---------------------------------------------------------------------------------------------------------------
export const FILE_ABOUT = 'A model built from Nimrod parts in the brick builder. Sizes and places in mm on the 40 mm grid: '
  + 'x along the width, y up, z toward the front; rot is quarter turns about the vertical; colour is the theme\'s brick '
  + 'colour (theme1..theme5) or your own (#rrggbb).';

/** The build as the text of a .json file (pretty: a person may open it). */
export function toFile(build) {
  const b = normalizeBuild(build);
  return `${JSON.stringify({ ...b, about: FILE_ABOUT }, null, 2)}\n`;
}
/** A file's text as a build, or null. Reads our own files and the CAD side's assemblies (`nimrod-assembly/1`). */
export function fromFile(text) {
  let doc;
  try { doc = JSON.parse(String(text || '')); } catch { return null; }
  if (doc && doc.schema === 'nimrod-assembly/1') return fromAssembly(doc).build;
  if (!doc || (doc.schema && doc.schema !== SCHEMA) || !Array.isArray(doc.parts)) return null;
  return normalizeBuild({ ...doc, id: newId() });
}
/** A safe file name for a build: "my-desk.json". */
export const fileNameFor = (build) => `${(cleanName(build?.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'build')}.json`;

/**
 * A CAD assembly (design-assets/bricks/scenes/<id>.json) as a build: { build, left }. Every BRICK comes in exactly
 * (a brick is a box: its bounding box in the CAD frame, +Z up, is its size and place here). A bracket or a corner is
 * held to the side of something in the real model, which this builder cannot do yet (things fall down, header), so
 * they are counted in `left` and left out, rather than drawn somewhere they are not.
 */
export function fromAssembly(doc) {
  const parts = [];
  const left = {};
  for (const [i, q] of (Array.isArray(doc?.parts) ? doc.parts : []).entries()) {
    const id = String(q?.part || '');
    const bb = q?.bbox_mm;
    if (/^brick_/.test(id) && bb && Array.isArray(bb.min) && Array.isArray(bb.max)) {
      const [x0, y0, z0] = bb.min.map(Number); const [x1, y1, z1] = bb.max.map(Number);
      parts.push({ id: `p${i + 1}`, part: 'brick', w: x1 - x0, l: y1 - y0, h: z1 - z0, x: x0, z: y0, y: z0, rot: 0, colour: 'theme1' });
    } else {
      const kind = id.startsWith('bracket_corner3') ? 'corner' : id.startsWith('bracket_') ? 'bracket' : 'other';
      left[kind] = (left[kind] || 0) + 1;
    }
  }
  const build = normalizeBuild({ id: newId(), name: String(doc?.title || 'Model'), floor: { w: 4 * GRID, d: 4 * GRID }, parts });
  return { build, left };
}

// ---------------------------------------------------------------------------------------------------------------
// TO START FROM: two of the room's pieces as a person could build them on screen, from big pieces (no printer cap):
// the desk's top is ONE 1280 x 640 slab here, where the published desk_v1 is eight 320 mm slabs (the CAD side splits
// every run at its catalogue's 320 mm).
// ---------------------------------------------------------------------------------------------------------------
const P = (id, part, w, l, h, x, z, colour = 'theme1', rot = 0) => ({ id, part, w, l, h, x, z, y: 0, rot, colour });
export const EXAMPLES = Object.freeze({
  desk: Object.freeze({ name: 'Desk', floor: { w: 1280, d: 640 }, parts: [
    P('p1', 'brick', 80, 80, 720, 0, 0), P('p2', 'brick', 80, 80, 720, 1200, 0), P('p3', 'brick', 80, 80, 720, 0, 560),
    P('p4', 'brick', 80, 80, 720, 1200, 560), P('p5', 'brick', 1280, 640, 40, 0, 0, 'theme2'),
  ] }),
  sideTable: Object.freeze({ name: 'Side table', floor: { w: 480, d: 480 }, parts: [
    P('p1', 'brick', 80, 80, 480, 0, 0), P('p2', 'brick', 80, 80, 480, 400, 0), P('p3', 'brick', 80, 80, 480, 0, 400),
    P('p4', 'brick', 80, 80, 480, 400, 400), P('p5', 'brick', 480, 480, 40, 0, 0, 'theme2'),
  ] }),
});
export const EXAMPLE_LABELS = Object.freeze({ desk: 'A desk', sideTable: 'A side table' });
/** An example as a new build of your own. */
export function exampleBuild(key) {
  const e = EXAMPLES[key];
  return e ? normalizeBuild({ ...e, id: newId(), parts: e.parts.map((p) => ({ ...p })) }) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// A BUILD IN A ROOM: the recipe entry a 2D room draws (room_scene.js, item kind 'build', standing on the floor like
// furniture). The entry CARRIES its parts, so a room draws it with nothing to look up and a room shared or exported
// keeps its model; `freshRoomBuilds` brings an entry up to date from the person's saved models (by `build` id).
// THE SEAM, said in the report: a room draws one when its recipe holds it; nothing yet offers "put this model in
// the room" from a room's editor, and the 3D and flattened rooms do not draw one yet.
// ---------------------------------------------------------------------------------------------------------------
// Stage px per mm of the drawing: the published desk (1280 mm wide) is drawn ~210 px wide in a room (room_parts.js
// FURNITURE.desk box), and its three-quarter drawing is ~1660 units across, so 0.12 keeps a built desk the size of the
// drawn one.
export const ROOM_PX_PER_MM = 0.12;
export const BUILD_REF = /^build:([\w-]{1,40})$/;
/** The recipe entry for `build` standing at x% across the room, its feet at `ground`%. */
export function roomItemFor(build, { x = 50, ground = 86, scale = 1 } = {}) {
  const b = normalizeBuild(build);
  return { kind: 'build', id: `build:${b.id}`, build: b.id, x, y: ground, ground, scale, name: b.name, parts: b.parts };
}
/** A recipe with every `build` entry's parts refreshed from `lookup(id) -> build | null` (pure; others untouched). */
export function freshRoomBuilds(recipe, lookup) {
  if (!recipe || !Array.isArray(recipe.items) || typeof lookup !== 'function') return recipe;
  let changed = false;
  const items = recipe.items.map((it) => {
    if (!it || it.kind !== 'build' || !it.build) return it;
    let b = null;
    try { b = lookup(it.build); } catch { b = null; }
    const n = b ? normalizeBuild(b) : null;
    if (!n || JSON.stringify(n.parts) === JSON.stringify(it.parts)) return it;
    changed = true;
    return { ...it, parts: n.parts, name: n.name };
  });
  return changed ? { ...recipe, items } : recipe;
}
/** The box (stage px, before depth) a build takes in a room. */
export function roomBoxFor(build) {
  const b = normalizeBuild(build);
  const boxes = modelBoxes(b.parts);
  if (!boxes.length) return [40, 40];
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const bx of boxes) { const r = rectOf(bx); x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); y0 = Math.min(y0, r.y0); y1 = Math.max(y1, r.y1); }
  return [Math.max(8, (x1 - x0) * ROOM_PX_PER_MM), Math.max(8, (y1 - y0) * ROOM_PX_PER_MM)];
}
