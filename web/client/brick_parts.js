// brick_parts.js — THE NIMROD PARTS, AS SETTINGS AND AS A DRAWING: everything "Bricks" (modules/bricks.js, type
// 'bricks', row 2.76) is, with no page and no module around it -- so the library can read an old per-part key
// through `migrateBrickRef` without registering a module, and a suite can test every part without mounting one.
//
// Mike, 2026-10-09: "In the modules module, there shouldn't be a separate module for each brick. Just a bricks
// module. Also, there should be brick colors to match each theme."
//
// Until today the library (Modules) listed every published part as its own card -- twenty-one of them, from
// bricks.json -- none of which could be put anywhere. Now there is one Bricks module, and its settings choose:
//   Part       a brick, a baseplate, an L bracket, the three-way corner, or a straight / corner / T joiner plate
//   Width, Length, Height   in 40 mm steps, 40 to 320 (the grid every Nimrod part is on)
//   Thickness  a baseplate's: 5 or 10 mm (the two heights the CAD side catalogues, 40..320 x 40..320 at each)
//   Colour     one of the theme's five brick colours (brick_colours.js), or your own
//   Look       the part's published picture where there is one, or drawn
// A row that does not apply to the part chosen is left out of the menu (`appliesWhen`), and comes back with its
// value when it applies again.
//
// *** HOW A PART IS DRAWN. *** Where bricks.json has the part, its published picture (Blender's render, grey) is
// tinted with the colour -- brick_builds.js `tintedPicture`, the same renderer the bricks page and the rooms use.
// A baseplate is pictured by baseplate_art.js (the CAD helper's: drawn from its numbers, greys, tinted the same
// way), so the 72 catalogued baseplates need no published model each (`pictureFor`).
// Every other size is DRAWN here: the part as boxes on the 40 mm grid, in the same three-quarter view, with a
// socket at the centre of every 40 mm cell of every face it has them on (bricks.json: "a 10 mm socket at the
// centre of every 40 mm cell on every face"). A picture that will not load falls back to the drawing, so a part
// is never an empty box. THE SEAM for a better drawing (the CAD side may propose a procedural plate) is
// `setPartDrawer(part, fn)`: fn(spec) returns boxes (the shape below) or an SVG string, and is used before the
// boxes here.
//
// *** MATCHING A PUBLISHED PART is by KIND AND SIZE, NOT BY ID. *** The CAD side names a brick by its sorted size
// ("a 80x40x40 brick is the 40x40x80 brick lying down") and a baseplate `modl_<WWW>x<D>x<H>_sockets_v1`; matching
// on `kind` + dims means a part published tomorrow under either rule is found without a change here. A picture is
// used only where it shows the size chosen (width and length swapped: the same picture, mirrored); a brick lying
// down where its picture stands up is drawn instead, so what is on the screen is what the settings say.
//
// *** WHAT HAPPENED TO THE OLD PER-PART ENTRIES. *** They were library items (`brick:<id>`), never panels: none was
// placeable (`placeable: false`), so no saved screen can hold one. What could still name one is a library key
// (`brick:<id>`) or a part id; `migrateBrickRef` turns either into this module with that part chosen, and the
// library reads an old key through it (library.js `byKey`).
//
// HARD-CODED, each with its argument (Rule 1) -- the ones a person might want are settings above:
//   GRID 40, SIZES 40..320       the Nimrod grid and the catalogue's largest size (CATALOGUE_MAX in the CAD source:
//                                "mostly virtual" past the 256 mm bed); a size past 320 is drawn, not offered.
//   THICKNESSES 5, 10            the CAD side's BASEPLATE_HEIGHTS (row 2.76).
//   PANEL_T 5, SOCKET_D 10       a bracket's or plate's thickness and the socket's bore, from the CAD source.
//   minimum plate sizes          a joiner plate joins at least two cells (I, L: 80) and a T needs three across (120).
//   BRICK_SHADES                 brick_colours.js: the faces' shading, measured with the colours.
//   the drawing's line weights   1.5 px outline, sockets at 35% black: looks, not settings.

import { normalizeField, fieldValue } from './settings_fields.js';
import { BRICKS_BASE, partUrls } from './brick_builds.js';
// The CAD helper's baseplate pictures (row 2.76): any W x D x H baseplate drawn from its numbers, in greys, for
// tintedPicture -- in place of 72 published models and their renders.
import { baseplateDataUrl, baseplateId } from './baseplate_art.js';
import { BRICK_COLOUR_COUNT, BRICK_SHADES, brickColourCss } from './brick_colours.js';

export const BRICKS_TYPE = 'bricks';
export const BRICKS_TITLE = 'Bricks';
export const GRID = 40;
export const SIZES = Object.freeze([40, 80, 120, 160, 200, 240, 280, 320]);
export const THICKNESSES = Object.freeze([5, 10]);
export const PANEL_T = 5;
export const SOCKET_D = 10;
export const BRICKS_JSON = `${BRICKS_BASE}bricks.json`;

// The parts, in the order the Part row offers them. `rows`: which size rows apply. `min`: the least a part can be.
export const PARTS = Object.freeze({
  brick: Object.freeze({ label: 'Brick', rows: ['width', 'length', 'height'], min: {} }),
  baseplate: Object.freeze({ label: 'Baseplate', rows: ['width', 'length', 'thickness'], min: {} }),
  lbracket: Object.freeze({ label: 'L bracket', rows: ['width'], min: {} }),
  corner3: Object.freeze({ label: 'Three-way corner', rows: [], min: {} }),
  plateI: Object.freeze({ label: 'Straight joiner plate', rows: ['width'], min: { width: 80 } }),
  plateL: Object.freeze({ label: 'Corner joiner plate', rows: ['width', 'length'], min: { width: 80, length: 80 } }),
  plateT: Object.freeze({ label: 'T joiner plate', rows: ['width', 'length'], min: { width: 120, length: 80 } }),
});
export const PART_IDS = Object.freeze(Object.keys(PARTS));
const PLATE_SHAPE = Object.freeze({ plateI: 'I', plateL: 'L', plateT: 'T' });

export const COLOUR_CHOICES = Object.freeze([...Array.from({ length: BRICK_COLOUR_COUNT }, (_, i) => `theme${i + 1}`), 'own']);
export const BRICKS_DEFAULTS = Object.freeze({
  part: 'brick', width: 40, length: 40, height: 40, thickness: 5, colour: 'theme1', ownColour: '#c07a3e', look: 'picture',
  words: true,
});

const applies = (row) => (v) => (PARTS[v?.part] || PARTS[BRICKS_DEFAULTS.part]).rows.includes(row);
const mm = (n) => ({ value: n, label: `${n} mm` });
export const BRICKS_SETTINGS = Object.freeze([
  { key: 'part', label: 'Part', kind: 'choice', default: BRICKS_DEFAULTS.part, level: 'essential',
    options: PART_IDS.map((id) => ({ value: id, label: PARTS[id].label })),
    help: 'Which Nimrod part to show. Every part is on the same 40 mm grid, so any two fit together.' },
  { key: 'width', label: 'Width', kind: 'choice', default: BRICKS_DEFAULTS.width, level: 'essential',
    options: SIZES.map(mm), appliesWhen: applies('width'),
    help: 'In 40 mm steps. A joiner plate is at least two steps long, a T plate three.' },
  { key: 'length', label: 'Length', kind: 'choice', default: BRICKS_DEFAULTS.length, level: 'essential',
    options: SIZES.map(mm), appliesWhen: applies('length') },
  { key: 'height', label: 'Height', kind: 'choice', default: BRICKS_DEFAULTS.height, level: 'essential',
    options: SIZES.map(mm), appliesWhen: applies('height') },
  { key: 'thickness', label: 'Thickness', kind: 'choice', default: BRICKS_DEFAULTS.thickness, level: 'essential',
    options: THICKNESSES.map(mm), appliesWhen: applies('thickness') },
  { key: 'colour', label: 'Colour', kind: 'choice', default: BRICKS_DEFAULTS.colour, level: 'essential',
    options: COLOUR_CHOICES.map((v, i) => ({ value: v, label: v === 'own' ? 'Your own colour' : `Theme colour ${i + 1}` })),
    help: 'The theme’s brick colours change with the theme; your own stays the same whatever the theme.' },
  { key: 'ownColour', label: 'Your own colour', kind: 'color', default: BRICKS_DEFAULTS.ownColour, level: 'essential',
    appliesWhen: (v) => v?.colour === 'own' },
  { key: 'look', label: 'Look', kind: 'choice', default: BRICKS_DEFAULTS.look, level: 'standard',
    options: [{ value: 'picture', label: 'Its picture, where there is one' }, { value: 'drawn', label: 'Drawn' }],
    help: 'Its picture: the part as it is printed, for the sizes that have one. Drawn: every size the same way.' },
  { key: 'words', label: 'Words under it', kind: 'toggle', default: BRICKS_DEFAULTS.words, level: 'standard',
    help: 'Which part it is, and its size.' },
]);
const FIELDS = BRICKS_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);

const nearest = (list, n) => list.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best), list[0]);
const sizeOf = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? nearest(SIZES, n) : fallback;
};
const hexOf = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
};

/** What a stored row says, every value one of its choices (anything else: the default). Pure. */
export function bricksOptions(values = {}) {
  const v = values && typeof values === 'object' ? values : {};
  const read = (key) => { const f = FIELDS.find((x) => x.key === key); return f ? fieldValue(f, v) : undefined; };
  const part = PART_IDS.includes(read('part')) ? read('part') : BRICKS_DEFAULTS.part;
  const colour = COLOUR_CHOICES.includes(read('colour')) ? read('colour') : BRICKS_DEFAULTS.colour;
  const t = Number(read('thickness'));
  return {
    part,
    width: sizeOf(read('width'), BRICKS_DEFAULTS.width),
    length: sizeOf(read('length'), BRICKS_DEFAULTS.length),
    height: sizeOf(read('height'), BRICKS_DEFAULTS.height),
    thickness: THICKNESSES.includes(t) ? t : BRICKS_DEFAULTS.thickness,
    colour,
    ownColour: hexOf(read('ownColour')) || BRICKS_DEFAULTS.ownColour,
    look: read('look') === 'drawn' ? 'drawn' : 'picture',
    words: read('words') !== false,
  };
}

/** The colour as CSS: `var(--brick-N)` for a theme colour (it follows the theme), the hex for your own. Pure. */
export function colourCss(o) {
  if (o?.colour === 'own') return hexOf(o.ownColour) || BRICKS_DEFAULTS.ownColour;
  const i = COLOUR_CHOICES.indexOf(o?.colour);
  return brickColourCss(i >= 0 && i < BRICK_COLOUR_COUNT ? i : 0);
}

/**
 * The part as built: `{ part, label, dims: [W, D, H] mm, title, shape? }`. W along the grid's x, D its depth, H up --
 * the CAD source's frame. A size under a part's least is raised to it (an 80 mm I plate is the shortest). Pure.
 */
export function partSpec(o = BRICKS_DEFAULTS) {
  const p = PARTS[o.part] ? o.part : BRICKS_DEFAULTS.part;
  const min = PARTS[p].min;
  const w = Math.max(min.width || 0, sizeOf(o.width, BRICKS_DEFAULTS.width));
  const l = Math.max(min.length || 0, sizeOf(o.length, BRICKS_DEFAULTS.length));
  let dims;
  if (p === 'brick') dims = [w, l, sizeOf(o.height, BRICKS_DEFAULTS.height)];
  else if (p === 'baseplate') dims = [w, l, THICKNESSES.includes(Number(o.thickness)) ? Number(o.thickness) : BRICKS_DEFAULTS.thickness];
  else if (p === 'lbracket') dims = [w, GRID, GRID];
  else if (p === 'corner3') dims = [GRID, GRID, GRID];
  else if (p === 'plateI') dims = [w, GRID, PANEL_T];
  else dims = [w, l, PANEL_T];
  const label = PARTS[p].label;
  const size = p === 'corner3' ? `${GRID} mm each way` : p === 'lbracket' ? `${w} mm` : `${dims.join(' × ')} mm`;
  return { part: p, label, dims, title: `${label}, ${size}`, ...(PLATE_SHAPE[p] ? { shape: PLATE_SHAPE[p] } : {}) };
}

const sameDims = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Number(x) === Number(b[i]));
/**
 * The published part (a bricks.json object) that IS this part, as `{ obj, mirror }`, or null. Pure.
 * A picture is used only where it shows what was chosen: the same width, length and height. Width and length the
 * other way round is the same part seen in a mirror (the view is symmetric about the diagonal), so that picture is
 * used flipped (`mirror`); a brick lying down where the picture stands up is not the same picture, and is drawn.
 */
export function publishedFor(spec, doc) {
  const objs = doc && Array.isArray(doc.objects) ? doc.objects : [];
  const [w, d, h] = spec.dims;
  const kindOk = (o) => {
    if (!o || typeof o.id !== 'string' || !Array.isArray(o.dims_mm)) return false;
    if (spec.part === 'brick' || spec.part === 'baseplate' || spec.part === 'lbracket' || spec.part === 'corner3') {
      return o.kind === spec.part;
    }
    return o.kind === 'plate' && o.id.startsWith(`plate_${spec.shape}`);
  };
  const dimsOf = (o) => (spec.part === 'lbracket' ? [Number(o.dims_mm[0])] : o.dims_mm.map(Number));
  const want = spec.part === 'lbracket' ? [w] : spec.dims;
  const exact = objs.find((o) => kindOk(o) && sameDims(dimsOf(o), want));
  if (exact) return { obj: exact, mirror: false };
  if (spec.part === 'lbracket' || spec.part === 'corner3' || w === d) return null;
  const turned = objs.find((o) => kindOk(o) && sameDims(dimsOf(o), [d, w, h]));
  return turned ? { obj: turned, mirror: true } : null;
}

/**
 * The picture for a part, as `{ url, id, mirror, from }`, or null (then it is drawn here). Pure.
 *   from 'published'  the part's baked render (bricks.json), mirrored when width and length are turned
 *   from 'baseplate'  a baseplate with no published model: baseplate_art.js draws it from its numbers (greys, tinted
 *                     like a render), so every one of the 72 the CAD side catalogues -- and any other size -- has one.
 */
export function pictureFor(spec, doc) {
  const m = publishedFor(spec, doc);
  if (m) return { url: partUrls(m.obj.id).picture, id: m.obj.id, mirror: m.mirror, from: 'published' };
  if (spec.part === 'baseplate') {
    const [w, d, h] = spec.dims;
    const url = baseplateDataUrl(w, d, h);
    if (url) return { url, id: baseplateId(w, d, h), mirror: false, from: 'baseplate' };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// MIGRATION: an old reference to one part -> this module with that part chosen. Pure.
// ---------------------------------------------------------------------------------------------------------------
const ID_RULES = [
  [/^brick_(\d+)x(\d+)x(\d+)_v1$/, (g) => ({ part: 'brick', width: +g[1], length: +g[2], height: +g[3] })],
  [/^bracket_L(\d+)x40x5_v1$/, (g) => ({ part: 'lbracket', width: +g[1] })],
  [/^bracket_corner3_40_v1$/, () => ({ part: 'corner3' })],
  [/^plate_([ILT])(\d+)x(\d+)x5_v1$/, (g) => ({ part: `plate${g[1]}`, width: +g[2], length: +g[3] })],
  [/^modl_(\d{3,})x(\d+)x(\d+)_sockets_v1$/, (g) => ({ part: 'baseplate', width: +g[1], length: +g[2], thickness: +g[3] })],
];
/** The Bricks settings that show the published part `id` (a bricks.json id), or null for anything else. */
export function settingsForPartId(id) {
  const s = String(id || '').trim();
  for (const [rx, make] of ID_RULES) {
    const g = s.match(rx);
    if (g) return make(g);
  }
  return null;
}
/**
 * An old per-part reference -- a library key `brick:<id>`, a bare part id, or a saved `{ type, settings }` whose
 * type is either -- as `{ type: 'bricks', settings }`. Anything else: null (it was never a part).
 */
export function migrateBrickRef(ref) {
  const raw = ref && typeof ref === 'object' ? ref.type : ref;
  const id = String(raw || '').replace(/^brick:/, '');
  const settings = settingsForPartId(id);
  if (!settings) return null;
  const own = ref && typeof ref === 'object' && ref.settings && typeof ref.settings === 'object' ? ref.settings : {};
  return { type: BRICKS_TYPE, settings: { ...own, ...settings } };
}

// ---------------------------------------------------------------------------------------------------------------
// THE DRAWING. A part is boxes on the grid -- `{ x0, y0, z0, x1, y1, z1, sockets: [{ face, at: [x, y, z] }] }`, mm,
// x along the width, y UP, z the depth -- seen from above, front and to one side (the published pictures' view).
// ---------------------------------------------------------------------------------------------------------------
const box = (x0, y0, z0, x1, y1, z1) => ({ x0, y0, z0, x1, y1, z1, sockets: [] });
const centres = (a, b) => { const out = []; for (let c = a + GRID / 2; c < b; c += GRID) out.push(c); return out; };
function topSockets(b) { for (const x of centres(b.x0, b.x1)) for (const z of centres(b.z0, b.z1)) b.sockets.push({ face: 'top', at: [x, b.y1, z] }); return b; }
function frontSockets(b) { for (const x of centres(b.x0, b.x1)) for (const y of centres(b.y0, b.y1)) b.sockets.push({ face: 'left', at: [x, y, b.z1] }); return b; }
function sideSockets(b) { for (const z of centres(b.z0, b.z1)) for (const y of centres(b.y0, b.y1)) b.sockets.push({ face: 'right', at: [b.x1, y, z] }); return b; }

/** The cells of a joiner plate (the CAD source's PLATE_SHAPES): [col, row] each 40 mm. */
export function plateCells(shape, w, d) {
  const n = Math.max(1, Math.round(w / GRID)); const m = Math.max(1, Math.round(d / GRID));
  if (shape === 'I') return Array.from({ length: n }, (_, i) => [i, 0]);
  if (shape === 'T') return [...Array.from({ length: n }, (_, i) => [i, m - 1]), ...Array.from({ length: m - 1 }, (_, j) => [Math.floor(n / 2), j])];
  return [...Array.from({ length: n }, (_, i) => [i, 0]), ...Array.from({ length: m - 1 }, (_, j) => [0, j + 1])];
}

/** The boxes a part is drawn as (pure). */
export function partBoxes(spec) {
  const [w, d, h] = spec.dims;
  switch (spec.part) {
    case 'brick': return [sideSockets(frontSockets(topSockets(box(0, 0, 0, w, h, d))))];
    case 'baseplate': return [topSockets(box(0, 0, 0, w, h, d))];
    case 'lbracket': return [frontSockets(box(0, 0, 0, w, GRID, PANEL_T)), topSockets(box(0, 0, PANEL_T, w, PANEL_T, GRID))];
    case 'corner3': {
      const back = box(0, 0, 0, GRID, GRID, PANEL_T); back.sockets.push({ face: 'left', at: [GRID / 2, GRID / 2, PANEL_T] });
      const side = box(0, 0, PANEL_T, PANEL_T, GRID, GRID); side.sockets.push({ face: 'right', at: [PANEL_T, GRID / 2, GRID / 2] });
      const floor = box(PANEL_T, 0, PANEL_T, GRID, PANEL_T, GRID); floor.sockets.push({ face: 'top', at: [GRID / 2, PANEL_T, GRID / 2] });
      return [back, side, floor];
    }
    default: {
      // One box per run of cells along a row, so a long plate is one piece, not a row of tiles.
      const rows = new Map();
      for (const [i, j] of plateCells(spec.shape, w, d)) { if (!rows.has(j)) rows.set(j, []); rows.get(j).push(i); }
      const out = [];
      for (const [j, cols] of rows) {
        cols.sort((a, b) => a - b);
        let start = cols[0]; let prev = cols[0];
        for (const c of [...cols.slice(1), null]) {
          if (c !== null && c === prev + 1) { prev = c; continue; }
          out.push(topSockets(box(start * GRID, 0, j * GRID, (prev + 1) * GRID, PANEL_T, (j + 1) * GRID)));
          if (c !== null) { start = c; prev = c; }
        }
      }
      return out;
    }
  }
}

// Back to front: A goes before B when A is entirely behind B along one axis (smaller x, smaller z, or below).
const behind = (a, b) => a.x1 <= b.x0 || a.z1 <= b.z0 || a.y1 <= b.y0;
function backToFront(boxes) {
  const left = [...boxes]; const out = [];
  while (left.length) {
    const i = left.findIndex((a) => !left.some((b) => b !== a && behind(b, a)));
    out.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  return out;
}

const COS30 = Math.cos(Math.PI / 6);
const project = (x, y, z) => [(x - z) * COS30, (x + z) * 0.5 - y];
const fmt = (n) => (Math.round(n * 100) / 100).toString();
const pathOf = (pts) => `M${pts.map((p) => project(...p)).map(([a, b]) => `${fmt(a)} ${fmt(b)}`).join('L')}Z`;
function socketPts(s) {
  const r = SOCKET_D / 2; const [x, y, z] = s.at; const pts = [];
  for (let k = 0; k < 16; k++) {
    const t = (k / 16) * Math.PI * 2; const a = r * Math.cos(t); const b = r * Math.sin(t);
    pts.push(s.face === 'top' ? [x + a, y, z + b] : s.face === 'left' ? [x + a, y + b, z] : [x, y + b, z + a]);
  }
  return pts;
}
function gridLines(b) {
  const out = [];
  for (const x of centres(b.x0, b.x1).map((c) => c + GRID / 2).filter((x) => x < b.x1)) {
    out.push([[x, b.y1, b.z0], [x, b.y1, b.z1]], [[x, b.y0, b.z1], [x, b.y1, b.z1]]);
  }
  for (const z of centres(b.z0, b.z1).map((c) => c + GRID / 2).filter((z) => z < b.z1)) {
    out.push([[b.x0, b.y1, z], [b.x1, b.y1, z]], [[b.x1, b.y0, z], [b.x1, b.y1, z]]);
  }
  for (const y of centres(b.y0, b.y1).map((c) => c + GRID / 2).filter((y) => y < b.y1)) {
    out.push([[b.x0, y, b.z1], [b.x1, y, b.z1]], [[b.x1, y, b.z0], [b.x1, y, b.z1]]);
  }
  return out;
}

/** The boxes as one SVG, filled with `colour` (any CSS colour, a var() included) and shaded by black over it. Pure. */
export function boxesSvg(boxes, colour, { title = '' } = {}) {
  const list = backToFront(boxes || []);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const b of list) {
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) {
      const [px, py] = project(x, y, z);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  if (!list.length) { minX = 0; minY = 0; maxX = 1; maxY = 1; }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.04 + 1;
  const vb = [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].map(fmt).join(' ');
  const [, left, right] = BRICK_SHADES;
  let body = '';
  for (const b of list) {
    const faces = [
      [[[b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0]], right],
      [[[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], left],
      [[[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], 0],
    ];
    for (const [pts, shade] of faces) {
      const d = pathOf(pts);
      body += `<path class="bk-face" d="${d}" style="fill:var(--bk)"/>`;
      if (shade) body += `<path d="${d}" fill="black" fill-opacity="${shade}"/>`;
    }
    const lines = gridLines(b).map(([a, c]) => pathOf([a, c]).replace(/Z$/, '')).join('');
    if (lines) body += `<path d="${lines}" fill="none" stroke="black" stroke-opacity="0.2" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    if (b.sockets.length) body += `<path data-sockets="${b.sockets.length}" d="${b.sockets.map((s) => pathOf(socketPts(s))).join('')}" fill="black" fill-opacity="0.35"/>`;
    for (const [pts] of faces) body += `<path d="${pathOf(pts)}" fill="none" stroke="black" stroke-opacity="0.45" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  }
  return `<svg class="bk-svg" data-drawn="1" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" role="img"`
    + ` aria-label="${esc(title)}" style="--bk:${esc(colour)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// THE SEAM (see the header): a better drawing for a part, used before the boxes here.
const DRAWERS = new Map();
/** `fn(spec)` -> boxes (as `partBoxes`) or an SVG string; null to remove. Returns the previous one. */
export function setPartDrawer(part, fn) {
  const prev = DRAWERS.get(part) || null;
  if (typeof fn === 'function') DRAWERS.set(part, fn); else DRAWERS.delete(part);
  return prev;
}
/** The part as an SVG string, through a registered drawer where there is one. Pure (apart from the registry). */
export function drawPart(spec, colour) {
  const fn = DRAWERS.get(spec.part);
  if (fn) {
    try {
      const got = fn(spec);
      if (typeof got === 'string' && got.trim().startsWith('<svg')) return got;
      if (Array.isArray(got) && got.length) return boxesSvg(got, colour, { title: spec.title });
    } catch (err) { console.error('bricks: drawer', err); }
  }
  return boxesSvg(partBoxes(spec), colour, { title: spec.title });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// The published parts list, fetched once a page. A failed fetch is an empty list: every part is then drawn.
let partsDoc = null;
export function loadParts(fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  if (partsDoc) return partsDoc;
  partsDoc = (async () => {
    if (!fetchImpl) return { objects: [] };
    try {
      const r = await fetchImpl(BRICKS_JSON, { cache: 'force-cache' });
      return r && r.ok ? await r.json() : { objects: [] };
    } catch { return { objects: [] }; }
  })();
  return partsDoc;
}
