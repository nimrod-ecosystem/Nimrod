// lut.js — A COLOUR GRADE FROM A `.cube` FILE IN THE `luts/` FOLDER (row 2.49). OFF BY DEFAULT.
//
// Mike, 2026-10-01: user folders for "fonts, LUTs, VSTs". A LUT (look-up table) is the file a film
// colourist uses for a "look": every input colour mapped to an output colour. `.cube` (Adobe/
// Resolve's text format) is the common one.
//
// *** HOW IT IS APPLIED — THE CHEAPEST THING THAT WORKS ON A PI 400, ARGUED. ***
//   (a) WebGL, a shader sampling the LUT as a 3D texture: EXACT, but every photo, wallpaper frame
//       and video frame would have to be drawn through a canvas the module does not have today —
//       a second render path for PHOTOS (the module that matters most), and per-frame texture
//       uploads of video on the Pi 400's GPU, which is the costly part. Unmeasured, and the
//       change to photos.js would not be "minimal".
//   (b) Baking each photo once on the CPU: exact for photos, but nothing for video, and a
//       12-megapixel photo in JavaScript on a Pi 400 is seconds per picture.
//   (c) *** AN SVG FILTER, APPLIED AS A CSS `filter` — CHOSEN. *** The browser already draws
//       <img> and <video>; `filter: url(#…)` with only a colour matrix and per-channel curves
//       (feColorMatrix + feComponentTransfer) is a plain per-pixel colour operation that Chromium
//       runs inside its normal drawing, on the GPU where it has one [training knowledge — the
//       Pi 400 frame rate with it on is UNMEASURED; it belongs on the bench Pi before anyone
//       relies on it]. The change to photos.js and wallpaper.js is one line each, and with no
//       grade chosen it does nothing at all.
//   The cost of (c), said plainly: an SVG filter cannot hold a full 3D table. A 1D `.cube` (per-
//   channel curves) is EXACT. A 3D `.cube` is APPROXIMATED by the closest "colour matrix then
//   per-channel curves" (or curves alone, whichever is closer), fitted over the LUT's own grid,
//   and the error is MEASURED and kept with it (`error.mean`/`error.max`, 0–1 per channel) so a
//   screen can say "close" or "rough" instead of pretending. Looks that are curves and channel mixing
//   (most film looks) come out close; hue-twisting looks do not — that is when (a) would be worth
//   building, as a later option.
//
// *** PER DEVICE, OFF BY DEFAULT, PER TARGET. *** The `.cube` file is on this device, so the choice is
// stored in this browser (`GRADE_KEY`), and stored COMPILED (a matrix and three 256-step curves, a
// few KB) — so it still works after a reload when the folder's permission needs a press again. Each
// target (`photos`, `video`, `wallpaper`) is its own switch, all off. Nothing is sent anywhere.
//
// *** PHOTOS ARE THE MOST IMPORTANT MODULE. *** `applyGrade` with no grade, or with its target off,
// returns false WITHOUT TOUCHING THE ELEMENT — not even an empty `style.filter` — so normal display
// is byte-for-byte what it was. The suites test exactly that.

export const GRADE_KEY = 'nimrod.colourGrade.device';
export const GRADE_TARGETS = Object.freeze(['photos', 'video', 'wallpaper']);
export const FILTER_ID = 'nimrod-colour-grade';
const DEFS_ID = 'nimrod-colour-grade-defs';
const TABLE = 256;

// ---------------------------------------------------------------------------------------------
// reading a .cube
// ---------------------------------------------------------------------------------------------

/**
 * `{ ok: true, lut: { title, kind: '1d'|'3d', size, min: [r,g,b], max: [r,g,b], data: Float32Array } }`
 * or `{ ok: false, why }`. `data` is RGB triples; for 3D, red changes fastest (the .cube order).
 */
export function parseCube(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, why: 'the file is empty' };
  let title = ''; let size1 = 0; let size3 = 0;
  let min = [0, 0, 0]; let max = [1, 1, 1];
  const vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Z_0-9]+)\s+(.*)$/.exec(line);
    if (m && /^[A-Z]/.test(m[1])) {
      const [, key, rest] = m;
      if (key === 'TITLE') title = rest.replace(/^"|"$/g, '');
      else if (key === 'LUT_3D_SIZE') size3 = parseInt(rest, 10);
      else if (key === 'LUT_1D_SIZE') size1 = parseInt(rest, 10);
      else if (key === 'DOMAIN_MIN') min = rest.split(/\s+/).map(Number);
      else if (key === 'DOMAIN_MAX') max = rest.split(/\s+/).map(Number);
      // Other keywords (LUT_1D_INPUT_RANGE, LUT_3D_INPUT_RANGE …) — read the range ones, skip the rest.
      else if (/INPUT_RANGE$/.test(key)) { const [a, b] = rest.split(/\s+/).map(Number); min = [a, a, a]; max = [b, b, b]; }
      continue;
    }
    const nums = line.split(/\s+/).map(Number);
    if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return { ok: false, why: `a line that is not three numbers: "${line.slice(0, 40)}"` };
    vals.push(...nums);
  }
  const kind = size3 ? '3d' : size1 ? '1d' : null;
  if (!kind) return { ok: false, why: 'no LUT_3D_SIZE or LUT_1D_SIZE line' };
  const size = size3 || size1;
  if (!(size >= 2 && size <= 256)) return { ok: false, why: `a size of ${size} is not one this can use (2 to 256)` };
  const want = (kind === '3d' ? size ** 3 : size) * 3;
  if (vals.length !== want) return { ok: false, why: `expected ${want / 3} colours, found ${vals.length / 3}` };
  if (min.length !== 3 || max.length !== 3 || min.some((v, i) => !(max[i] > v))) return { ok: false, why: 'a DOMAIN line that makes no sense' };
  return { ok: true, lut: { title, kind, size, min, max, data: Float32Array.from(vals) } };
}

// ---------------------------------------------------------------------------------------------
// compiling it to what an SVG filter can do
// ---------------------------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// A per-channel table of TABLE steps from (x, y) samples: average per step, gaps filled linearly.
function curveFrom(xs, ys) {
  const sum = new Float64Array(TABLE); const n = new Uint32Array(TABLE);
  for (let i = 0; i < xs.length; i++) {
    const k = Math.round(clamp01(xs[i]) * (TABLE - 1));
    sum[k] += ys[i]; n[k] += 1;
  }
  const out = new Array(TABLE).fill(null);
  for (let k = 0; k < TABLE; k++) if (n[k]) out[k] = sum[k] / n[k];
  const known = out.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0);
  if (!known.length) return Array.from({ length: TABLE }, (_, k) => k / (TABLE - 1));
  for (let k = 0; k < TABLE; k++) {
    if (out[k] != null) continue;
    const a = [...known].reverse().find((j) => j < k); const b = known.find((j) => j > k);
    out[k] = a == null ? out[b] : b == null ? out[a] : out[a] + (out[b] - out[a]) * ((k - a) / (b - a));
  }
  return out.map(clamp01);
}

const look = (table, v) => {
  const x = clamp01(v) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  return table[i] + (table[i + 1] - table[i]) * (x - i);
};

// Solve the 4x4 normal equations for out_c ~ a*r + b*g + c*b + d, one per output channel.
function fitAffine(ins, outs) {
  const A = Array.from({ length: 4 }, () => new Float64Array(4));
  const B = Array.from({ length: 3 }, () => new Float64Array(4));
  for (let i = 0; i < ins.length; i += 3) {
    const v = [ins[i], ins[i + 1], ins[i + 2], 1];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[r][c] += v[r] * v[c];
      for (let ch = 0; ch < 3; ch++) B[ch][r] += v[r] * outs[i + ch];
    }
  }
  const solve = (M, y) => {                       // Gaussian elimination with partial pivoting
    const a = M.map((row, r) => [...row, y[r]]);
    for (let c = 0; c < 4; c++) {
      let p = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      [a[c], a[p]] = [a[p], a[c]];
      if (Math.abs(a[c][c]) < 1e-12) return null;
      for (let r = 0; r < 4; r++) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k < 5; k++) a[r][k] -= f * a[c][k]; }
    }
    return a.map((row, r) => row[4] / row[r]);
  };
  const rows = B.map((y) => solve(A, y));
  return rows.every(Boolean) ? rows : null;
}

/**
 * What the SVG filter will do: `{ kind, matrix: [12] | null, tables: [r[], g[], b[]], error: { mean, max } }`.
 * `matrix` is three rows of [r, g, b, offset] applied first; `tables` are applied after it.
 */
export function compileLut(lut) {
  const { kind, size, min, max, data } = lut;
  // Grid step i of channel ch stands for the input value min + i/(size-1) * (max - min). A picture's
  // values outside the domain take the nearest end (the .cube convention).
  const at = (i, ch) => min[ch] + (i / (size - 1)) * (max[ch] - min[ch]);
  const pos = (v, ch) => clamp01((v - min[ch]) / (max[ch] - min[ch]));
  if (kind === '1d') {
    const tables = [0, 1, 2].map((ch) => {
      const ys = []; for (let i = 0; i < size; i++) ys.push(data[i * 3 + ch]);
      return Array.from({ length: TABLE }, (_, k) => clamp01(look(ys, pos(k / (TABLE - 1), ch))));
    });
    return tidy({ kind, matrix: null, tables, error: { mean: 0, max: 0 } });
  }
  // 3D: the grid's input colours and the LUT's outputs. Only grid points INSIDE 0..1 are pictures'
  // colours; a wider domain's outer points are kept out of the fit.
  const ins0 = []; const outs0 = [];
  for (let b = 0, i = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++, i++) {
    const v = [at(r, 0), at(g, 1), at(b, 2)];
    if (v.some((x) => x < -1e-9 || x > 1 + 1e-9)) continue;
    ins0.push(...v.map(clamp01));
    for (let ch = 0; ch < 3; ch++) outs0.push(data[i * 3 + ch]);
  }
  const ins = Float64Array.from(ins0); const outs = Float64Array.from(outs0);
  const n = ins.length / 3;
  if (!n) return { kind, matrix: null, tables: [0, 1, 2].map(() => Array.from({ length: TABLE }, (_, k) => k / (TABLE - 1))), error: { mean: 1, max: 1 } };
  const errorOf = (matrix, tables) => {
    let sum = 0; let worst = 0;
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 3; ch++) {
        const m = matrix ? clamp01(matrix[ch][0] * ins[i * 3] + matrix[ch][1] * ins[i * 3 + 1] + matrix[ch][2] * ins[i * 3 + 2] + matrix[ch][3])
          : ins[i * 3 + ch];
        const e = Math.abs(look(tables[ch], m) - outs[i * 3 + ch]);
        sum += e; if (e > worst) worst = e;
      }
    }
    return { mean: sum / (n * 3), max: worst };
  };
  const curvesFor = (matrix) => [0, 1, 2].map((ch) => {
    const xs = []; const ys = [];
    for (let i = 0; i < n; i++) {
      xs.push(matrix ? clamp01(matrix[ch][0] * ins[i * 3] + matrix[ch][1] * ins[i * 3 + 1] + matrix[ch][2] * ins[i * 3 + 2] + matrix[ch][3])
        : ins[i * 3 + ch]);
      ys.push(outs[i * 3 + ch]);
    }
    return curveFrom(xs, ys);
  });
  // Two candidates, the closer one wins: curves alone (exact for a per-channel look), and a fitted
  // colour matrix followed by curves (channel mixing, saturation).
  const plain = { matrix: null, tables: curvesFor(null) };
  plain.error = errorOf(null, plain.tables);
  const m = fitAffine(ins, outs);
  let best = plain;
  if (m) {
    const mixed = { matrix: m, tables: curvesFor(m) };
    mixed.error = errorOf(m, mixed.tables);
    if (mixed.error.mean < plain.error.mean - 1e-6) best = mixed;
  }
  return tidy({ kind, matrix: best.matrix ? best.matrix.flat() : null, tables: best.tables, error: best.error });
}

// Four decimals is finer than one step of an 8-bit colour (1/255 = 0.0039), and keeps the stored
// grade a few KB rather than three times that.
const r4 = (v) => Math.round(v * 1e4) / 1e4;
function tidy(c) {
  return { ...c, matrix: c.matrix ? c.matrix.map((v) => Math.round(v * 1e5) / 1e5) : null,
    tables: c.tables.map((t) => t.map(r4)), error: { mean: r4(c.error.mean), max: r4(c.error.max) } };
}

/** A sentence for a screen: how close the grade is to the file. */
export function describeFit(compiled) {
  if (!compiled) return '';
  if (compiled.kind === '1d' || compiled.error.mean < 0.004) return 'Applied exactly.';
  if (compiled.error.mean < 0.02) return 'Applied closely (this file mixes colours in ways the screen can only approximate).';
  return 'Applied roughly: this look twists colours in a way the screen cannot reproduce closely.';
}

// ---------------------------------------------------------------------------------------------
// the filter in the page
// ---------------------------------------------------------------------------------------------

const fmt = (v) => String(Math.round(v * 10000) / 10000);

/** SVG markup for the filter. `color-interpolation-filters="sRGB"`: a .cube works on the encoded
 *  values a picture is stored in; the filter default (linearRGB) would apply it to the wrong numbers. */
export function filterMarkup(compiled, id = FILTER_ID) {
  const m = compiled.matrix;
  // feColorMatrix rows are [r g b a offset]; ours are [r g b offset], alpha untouched.
  const row = (k) => [m[k], m[k + 1], m[k + 2], 0, m[k + 3]].map(fmt).join(' ');
  const matrix = m ? `<feColorMatrix type="matrix" values="${row(0)} ${row(4)} ${row(8)} 0 0 0 1 0"/>` : '';
  const fn = (tag, t) => `<${tag} type="table" tableValues="${t.map(fmt).join(' ')}"/>`;
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">${matrix}`
    + `<feComponentTransfer>${fn('feFuncR', compiled.tables[0])}${fn('feFuncG', compiled.tables[1])}${fn('feFuncB', compiled.tables[2])}`
    + '<feFuncA type="identity"/></feComponentTransfer></filter>';
}

// ---------------------------------------------------------------------------------------------
// this device's choice
// ---------------------------------------------------------------------------------------------

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/**
 * `{ name, file, compiled, targets: { photos, video, wallpaper } }` or null (no grade — the default).
 * `file` is the .cube file's name in the folder ('' for a grade saved before it was kept, 2026-10-02).
 */
export function readGrade(storage = defaultStorage()) {
  try {
    const g = storage ? JSON.parse(storage.getItem(GRADE_KEY) || 'null') : null;
    if (!g || !g.compiled || !Array.isArray(g.compiled.tables) || g.compiled.tables.length !== 3) return null;
    const targets = {};
    for (const t of GRADE_TARGETS) targets[t] = g.targets?.[t] === true;
    return { name: String(g.name || ''), file: String(g.file || ''), compiled: g.compiled, targets };
  } catch { return null; }
}

/** Store a compiled grade, every target OFF unless `targets` turns one on. */
export function saveGrade({ name, file = '', compiled, targets = {} }, storage = defaultStorage()) {
  const t = {}; for (const k of GRADE_TARGETS) t[k] = targets[k] === true;
  try { storage?.setItem(GRADE_KEY, JSON.stringify({ name, file: String(file || ''), compiled, targets: t })); } catch { /* private window */ }
  return readGrade(storage);
}

// *** WHERE A LOOK APPLIES WHEN SOMEBODY FIRST CHOOSES ONE (from None), ARGUED (Rule 1). *** The
// switches stay what they were when one look replaces another; this is only the first choice.
//   ALL OFF (what `saveGrade` does on its own) was argued against: choosing a look and seeing nothing
//   change reads as a broken control, and needs a second and third press somebody has to discover.
//   PHOTOS AND WALLPAPER ON: still pictures, and the reason somebody chooses a look.
//   VIDEO OFF: the SVG filter runs on every frame of a video, and on a Pi 400 that cost is UNMEASURED
//   (see the header). Its switch is right under the look, one press away. (A wallpaper that is a
//   video follows the wallpaper switch - the switches are by place, not by kind of file.)
export const FIRST_LOOK_TARGETS = Object.freeze({ photos: true, video: false, wallpaper: true });

export function setGradeTarget(target, on, storage = defaultStorage()) {
  const g = readGrade(storage);
  if (!g || !GRADE_TARGETS.includes(target)) return g;
  return saveGrade({ ...g, targets: { ...g.targets, [target]: !!on } }, storage);
}

export function clearGrade(storage = defaultStorage()) {
  try { storage?.removeItem?.(GRADE_KEY); } catch { /* nothing to clear */ }
  return null;
}

/**
 * Read a `.cube` file (from the `luts/` folder) and store it as this device's grade, targets off
 * unless `targets` says (the folders page passes the ones in force, or FIRST_LOOK_TARGETS). A file that
 * cannot be read leaves the grade in force as it was.
 */
export async function gradeFromFile(fileHandle, storage = defaultStorage(), { targets = {} } = {}) {
  let file;
  try { file = await fileHandle.getFile(); } catch (err) { return { ok: false, why: `it could not be opened (${String((err && err.message) || err)})` }; }
  const p = parseCube(await file.text());
  if (!p.ok) return { ok: false, why: p.why };
  const compiled = compileLut(p.lut);
  const g = saveGrade({ name: p.lut.title || file.name, file: file.name, compiled, targets }, storage);
  return { ok: true, grade: g, fit: describeFit(compiled) };
}

/**
 * A MISSING FILE FALLS BACK TO NONE, QUIETLY (2026-10-02). `fileNames` are the .cube files in a folder
 * that COULD be read just now. If the grade in force came from a file that is not among them (deleted,
 * renamed), the grade is cleared and this returns true. Only a folder that was read may clear it: a
 * folder whose permission lapsed after a restart says nothing about the file, and the grade is kept
 * compiled precisely so it survives that. A grade with no `file` (saved before files were kept) is
 * never cleared on a guess.
 */
export function reconcileGrade(fileNames, storage = defaultStorage()) {
  const g = readGrade(storage);
  if (!g || !g.file || !Array.isArray(fileNames)) return false;
  if (fileNames.includes(g.file)) return false;
  clearGrade(storage);
  return true;
}

// The filter's markup is put in the page once per grade (keyed by its content), in a hidden <svg>.
function ensureFilter(doc, compiled) {
  const key = String(compiled.tables[0].length) + (compiled.matrix || []).join(',') + compiled.tables.map((t) => t.join(',')).join('|');
  let svg = doc.getElementById(DEFS_ID);
  if (svg && svg.dataset.key === key) return;
  if (!svg) {
    svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', DEFS_ID);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute'; svg.style.width = '0'; svg.style.height = '0';
    (doc.body || doc.documentElement).append(svg);
  }
  svg.dataset.key = key;
  svg.innerHTML = filterMarkup(compiled);
}

/**
 * THE HOOK photos.js and wallpaper.js call on each picture/video element they make. Returns true
 * when it graded the element. With no grade, or its target off, it returns false and DOES NOT
 * TOUCH THE ELEMENT. Never throws.
 */
export function applyGrade(el, target, { storage = defaultStorage(), doc = (typeof document !== 'undefined' ? document : null) } = {}) {
  try {
    if (!el || !doc) return false;
    seen(el, target);
    const g = readGrade(storage);
    if (!g || !g.targets[target]) return false;
    ensureFilter(doc, g.compiled);
    el.style.filter = `url(#${FILTER_ID})`;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// A CHANGE SHOWS AT ONCE (2026-10-02). Without this, turning a look off left the wallpaper graded until
// a reload (a still wallpaper may never change), and a new look waited for the next photo.
//
// Every element the hook is handed is remembered WEAKLY, in this file only - a WeakRef in a set, never a
// mark on the element - so "off means untouched" still holds byte for byte. `refreshGrade` then grades
// the ones whose switch is on, and takes the filter off (and an emptied `style` attribute with it) where
// it is off. Elements no longer in the page are dropped, and the set is pruned as it is added to, so it
// holds what is on screen (a photo, the one behind it, two wallpaper layers), not a slideshow's history.
// ---------------------------------------------------------------------------------------------
const SEEN = new Set();   // { ref: WeakRef(el), target }
const PRUNE_OVER = 16;    // not a setting: when to sweep the set, a bookkeeping number nobody would choose
function seen(el, target) {
  if (typeof WeakRef !== 'function') return;
  if (SEEN.size > PRUNE_OVER) {
    for (const e of SEEN) { const x = e.ref.deref(); if (!x || !x.isConnected || x === el) SEEN.delete(e); }
  }
  for (const e of SEEN) if (e.ref.deref() === el) SEEN.delete(e);
  SEEN.add({ ref: new WeakRef(el), target });
}

/** Apply this device's grade, as it is now, to what is on the page now. Returns how many are graded. Never throws. */
export function refreshGrade({ storage = defaultStorage(), doc = (typeof document !== 'undefined' ? document : null) } = {}) {
  let n = 0;
  try {
    if (!doc) return 0;
    const g = readGrade(storage);
    for (const e of [...SEEN]) {
      const el = e.ref.deref();
      if (!el || !el.isConnected) { SEEN.delete(e); continue; }
      if (g && g.targets[e.target]) {
        ensureFilter(doc, g.compiled);
        el.style.filter = `url(#${FILTER_ID})`;
        n++;
      } else if (String(el.style.filter || '').includes(FILTER_ID)) {
        el.style.removeProperty('filter');
        if (!el.getAttribute('style')) el.removeAttribute('style');
      }
    }
    // A changed look reaches anything else already wearing it.
    if (g && doc.getElementById(DEFS_ID)) ensureFilter(doc, g.compiled);
  } catch { /* a grade is never worth breaking the page for */ }
  return n;
}
