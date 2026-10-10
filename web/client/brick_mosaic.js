// brick_mosaic.js — A PICTURE TURNED INTO NIMROD BRICKS, with no DOM (brick games, row 2.76, 2026-10-10).
//
// Mike, 2026-10-09: "Any other ideas for games with our bricks?" Chat's list: "a photo turned into a brick mosaic, built
// a brick at a time". `modules/brickmosaic.js` is the panel; this file is the arithmetic, so a suite can check it with
// numbers: a picture's pixels -> a grid of cells -> each cell's nearest brick colour -> runs of one colour joined into
// real brick lengths -> the order they are laid in.
//
// *** THE COLOURS. *** By default the five brick colours of the theme in force (brick_colours.js; the panel reads
// `--brick-1` .. `--brick-5` off its own element, so a panel wearing its own theme gets that theme's). "Every brick
// colour" is all of them, every theme's, once each (ALL_BRICK_COLOURS): the full set of bricks we make.
// NEAREST IS MEASURED IN CIELAB (CIE76, plain distance), argued: FOR Lab over RGB - RGB distance picks greys and
// muddy greens for skin and sky; Lab is built so equal distances look about equally different. FOR CIE76 over
// CIEDE2000 (what brick_colours.js measures its sets with): the pick is between colours already at least 10 apart, so
// the finer formula changes almost nothing, and this runs for every cell of every picture. AGAINST: near-ties can fall
// the other way from what CIEDE2000 would pick. Nobody would see it in a mosaic.
//
// *** FIT THE PICTURE'S LIGHT AND DARK TO THE COLOURS (`stretch`, on by default, argued). *** Five colours of one theme
// often sit in a narrow band of lightness (the default theme's are all fairly dark). Matched as it is, a photo turns
// into one or two colours and nothing can be recognised. Stretched, the picture's darkest tenth and lightest tenth are
// laid onto the darkest and lightest brick, so a face still reads as a face. AGAINST: the colours are less "true" -
// a pale sky can come out as the darkest brick's opposite. Off is one setting away.
// *** NO DITHERING BY DEFAULT (`dither`, argued). *** FOR dithering: it fakes in-between shades with a mix of bricks.
// AGAINST, and it wins for the default: it scatters single bricks of every colour everywhere, so fewer bricks join into
// long ones and the picture is busy - and this is meant to be calm. One setting away.
//
// *** RUNS JOIN INTO REAL BRICKS (`join`, on). *** Cells side by side in one colour become one longer brick, up to
// JOIN_MAX cells: 4 cells is 160 mm, the longest of the published 40 mm-high bricks below the 320 mm one (bricks.json:
// 40, 80, 120, 160, 320). FOR stopping at 4: a whole row in one brick reads as a stripe, not a brick wall. It is a
// setting's ceiling, not a rule: `joinMax` may ask for 1 (every cell its own brick) to 8 (320 mm).

import { BRICK_COLOURS, BRICK_COLOUR_COUNT } from './brick_colours.js';

export const JOIN_MAX = 4;
export const ROWS_MIN = 4, ROWS_MAX = 64;        // a picture's rows, whatever its shape (a very wide or tall one)
export const STRETCH_LO = 0.1, STRETCH_HI = 0.9; // the darkest and lightest tenth laid onto the darkest and lightest brick
export const ORDERS = Object.freeze(['rows', 'scatter']);

/** Every theme's brick colours, each hex once, in theme order. */
export const ALL_BRICK_COLOURS = Object.freeze((() => {
  const seen = new Set();
  const out = [];
  for (const set of Object.values(BRICK_COLOURS)) {
    for (const c of set) {
      const h = String(c.hex).toLowerCase();
      if (!seen.has(h)) { seen.add(h); out.push(Object.freeze({ name: c.name, hex: h })); }
    }
  }
  return out;
})());
export const THEME_COLOUR_COUNT = BRICK_COLOUR_COUNT;

/** '#rgb' / '#rrggbb' / 'rgb(r, g, b)' -> [r, g, b] (0..255), or null. */
export function parseColour(s) {
  const t = String(s == null ? '' : s).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) return m[1].split('').map((ch) => parseInt(ch + ch, 16));
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  if (m) return [1, 2, 3].map((i) => Math.max(0, Math.min(255, Math.round(Number(m[i])))));
  return null;
}
export const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

// sRGB (D65) -> CIELAB.
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
export function rgbToLab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
  const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** A palette from colour strings: [{ hex, lab }], unreadable ones left out. */
export function paletteFrom(colours) {
  const out = [];
  for (const c of colours || []) {
    const rgb = parseColour(typeof c === 'string' ? c : c && c.hex);
    if (rgb) out.push({ hex: toHex(rgb), lab: rgbToLab(rgb) });
  }
  return out;
}

/** The index of the palette colour nearest `lab`. */
export function nearest(lab, palette) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) { const d = d2(lab, palette[i].lab); if (d < bd) { bd = d; best = i; } }
  return best;
}

/** How many columns and rows a picture `w` x `h` gets at `cols` across (square cells, a 40 mm brick face each). */
export function gridFor(w, h, cols) {
  const c = Math.max(2, Math.round(Number(cols) || 24));
  const ratio = Number(h) > 0 && Number(w) > 0 ? Number(h) / Number(w) : 0.75;
  return { cols: c, rows: Math.max(ROWS_MIN, Math.min(ROWS_MAX, Math.round(c * ratio))) };
}

/**
 * The average colour of each cell of an RGBA pixel buffer `data` (`w` x `h`), `cols` x `rows` cells, row by row from the
 * top. Transparent pixels count for nothing (a cell of nothing is white).
 */
export function cellColours(data, w, h, cols, rows) {
  const out = [];
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * h) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * w) / cols));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          const a = data[i + 3] / 255;
          r += data[i] * a + 255 * (1 - a); g += data[i + 1] * a + 255 * (1 - a); b += data[i + 2] * a + 255 * (1 - a); n++;
        }
      }
      out.push(n ? [r / n, g / n, b / n] : [255, 255, 255]);
    }
  }
  return out;
}

const quantile = (sorted, q) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1))))];

/**
 * Each cell's palette index. `stretch` lays the picture's lightness range onto the palette's (above); `dither` spreads
 * each cell's error onto its neighbours (Floyd-Steinberg, in Lab).
 */
export function matchCells(cells, palette, { cols, stretch = true, dither = false } = {}) {
  if (!palette.length) return cells.map(() => 0);
  let labs = cells.map((c) => rgbToLab(c));
  if (stretch && labs.length > 1 && palette.length > 1) {
    const ls = labs.map((l) => l[0]).sort((a, b) => a - b);
    const lo = quantile(ls, STRETCH_LO), hi = quantile(ls, STRETCH_HI);
    const pl = palette.map((p) => p.lab[0]);
    const plo = Math.min(...pl), phi = Math.max(...pl);
    if (hi - lo > 1 && phi - plo > 1) {
      labs = labs.map(([L, a, b]) => [plo + ((Math.max(lo, Math.min(hi, L)) - lo) / (hi - lo)) * (phi - plo), a, b]);
    }
  }
  if (!dither) return labs.map((l) => nearest(l, palette));
  const w = Math.max(1, Number(cols) || 1);
  const work = labs.map((l) => l.slice());
  const out = new Array(work.length);
  for (let i = 0; i < work.length; i++) {
    const k = nearest(work[i], palette);
    out[i] = k;
    const err = [0, 1, 2].map((j) => work[i][j] - palette[k].lab[j]);
    const x = i % w;
    const spread = (di, wgt) => { const t = work[i + di]; if (t) for (let j = 0; j < 3; j++) t[j] += err[j] * wgt; };
    if (x + 1 < w) spread(1, 7 / 16);
    if (x > 0) spread(w - 1, 3 / 16);
    spread(w, 5 / 16);
    if (x + 1 < w) spread(w + 1, 1 / 16);
  }
  return out;
}

/** The bricks: each row's runs of one colour joined into bricks of at most `joinMax` cells. { x, y, len, c } */
export function bricksFrom(indices, cols, rows, { join = true, joinMax = JOIN_MAX } = {}) {
  const max = join ? Math.max(1, Math.min(8, Math.round(Number(joinMax) || JOIN_MAX))) : 1;
  const out = [];
  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const c = indices[y * cols + x];
      let len = 1;
      while (len < max && x + len < cols && indices[y * cols + x + len] === c) len++;
      out.push({ x, y, len, c });
      x += len;
    }
  }
  return out;
}

/**
 * The order bricks are laid in. 'rows' (the default): from the bottom row up, left to right - a wall is built from the
 * floor. 'scatter': anywhere, in a shuffled order (`rand`).
 */
export function layOrder(bricks, order = 'rows', rand = Math.random) {
  const list = bricks.slice();
  if (order === 'scatter') {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor((rand() || 0) * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    return list;
  }
  return list.sort((a, b) => b.y - a.y || a.x - b.x);
}

/** The whole mosaic in one go: { cols, rows, indices, bricks (in laying order), palette }. */
export function makeMosaic({ data, w, h }, colours, { cols = 24, stretch = true, dither = false, join = true, joinMax = JOIN_MAX,
  order = 'rows', rand = Math.random } = {}) {
  const grid = gridFor(w, h, cols);
  const palette = paletteFrom(colours);
  const cells = cellColours(data, w, h, grid.cols, grid.rows);
  const indices = matchCells(cells, palette, { cols: grid.cols, stretch, dither });
  const bricks = layOrder(bricksFrom(indices, grid.cols, grid.rows, { join, joinMax }), order, rand);
  return { ...grid, indices, bricks, palette };
}

/** The row a press finishes: the bricks still to lay that share the next one's row (in 'rows' order). */
export function restOfRow(bricks, next) {
  const b = bricks[next];
  if (!b) return next;
  let i = next;
  while (i < bricks.length && bricks[i].y === b.y) i++;
  return i;
}
