// art_check.js — THE ART CHECKER: pick a picture (or a folder of them) and it says, in plain sentences, what is wrong
// with each one for the kind of artwork it is meant to be. Row 2.64; chat's suggestion (note BF item 7).
//
// The kinds and their numbers are art_kit.js (`ART_KINDS`): this file only measures a file and compares.
//
// *** NOTHING LEAVES THIS DEVICE. *** A file is read in this browser - its size and type from the File, its pixels
// decoded with `createImageBitmap` and read off a canvas, an SVG's text parsed by svg_sanitize.js (an inert document:
// nothing runs, nothing loads). There is no fetch, no FormData, no upload in this file, and dev/art_check_test.html
// counts every request made while files are checked and fails on one. The storage line (storage_line.py) refuses
// pictures on the server anyway; this never gets that far.
//
// TWO HALVES, so the judging is testable without pictures:
//   readArtFacts(file)        -> facts: { name, ext, type, bytes, decoded, width, height, alpha, border, checker,
//                                 outside, svg }   (the browser half: decoding, pixels)
//   judgeArt(facts, kind)     -> { verdict: 'ready' | 'works' | 'no', notes: [{ level, text }] }   (pure)
//   checkArtFile / checkArtFiles / checkArtFolder put them together; kindFor works out which kind a file is for.
//
// THREE LEVELS, said as words on the page: 'no' (it will not show, or shows wrongly), 'warn' (it works, but looks or
// loads worse than it could), 'tip' (the name). A file with only tips is "ready".
//
// *** THE MEASURING NUMBERS, EACH A DEFAULT (`opts`), EACH ARGUED. ***
//   sample 256       the long side the picture is shrunk to before its pixels are read: enough to see a background and
//                    a circle, cheap enough to check a folder of a hundred on a Pi.
//   clearAlpha 16    a pixel this transparent or more counts as clear (out of 255): anti-aliased edges are not
//                    "clear", a real background is 0.
//   borderClear 0.5  half the picture's edge pixels clear = it has a clear background. A figure may touch the edge;
//                    a solid background covers all of it.
//   outsideMax 0.02  for an avatar: more than 2 % of the drawn pixels outside the circle = something will be cut off.
//                    A little (a shoulder) is normal; a hand in a corner is what this is for.
//   maxFiles 300     a folder check stops there and says so: three times a big set of board cards.
//   svgReadMax       an SVG over svg_sanitize.js's own cap (SVG_LIMITS.maxChars) is not read at all - the site would
//                    refuse to draw it inline, and reading a huge file to say so is the cost the cap exists to avoid.

import { ART_KINDS, ART_FOLDER, NAME_MAX, NAME_RE, ASPECT_TOLERANCE, TYPE_WORDS, MIME_EXT, extOfName, baseOfName,
  shapeWords, typesWords, bytesWords } from './art_kit.js';
import { sanitizeSvg, SVG_LIMITS } from './svg_sanitize.js';

export const CHECK_DEFAULTS = Object.freeze({ sample: 256, clearAlpha: 16, borderClear: 0.5, outsideMax: 0.02, maxFiles: 300 });

// Types a browser draws as a picture at all. HEIC/HEIF and TIFF are pictures that Chrome, Edge and Firefox cannot show.
const SHOWABLE = new Set(['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp', 'avif', 'svg']);

/** The parent folder names of a path, innermost last: 'Artwork/Avatars/sam.png' -> ['Artwork', 'Avatars']. */
const foldersOf = (path) => String(path || '').split(/[\\/]+/).filter(Boolean).slice(0, -1);

/**
 * Which kind a file is for: its folder first (the kind's folder anywhere in its path, any case), then its name's start
 * (`avatar-...`). null when neither says. Pure.
 */
export function kindFor({ name = '', folder = '' } = {}, kinds = ART_KINDS) {
  const dirs = [...String(folder || '').split(/[\\/]+/).filter(Boolean), ...foldersOf(name)].map((d) => d.toLowerCase());
  for (let i = dirs.length - 1; i >= 0; i--) {
    const hit = kinds.find((k) => k.folder.toLowerCase() === dirs[i]);
    if (hit) return hit;
  }
  const base = baseOfName(String(name).split(/[\\/]/).pop()).toLowerCase();
  return kinds.find((k) => base === k.prefix || base.startsWith(`${k.prefix}-`) || base.startsWith(`${k.prefix}_`)) || null;
}

// ---------------------------------------------------------------------------------------------------------------------
// THE BROWSER HALF: measuring one file.
// ---------------------------------------------------------------------------------------------------------------------

function makeCanvas(w, h, doc) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = (doc || document).createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Pixels of `bitmap` (sx, sy, sw, sh) drawn at w x h. */
function pixels(bitmap, [sx, sy, sw, sh], w, h, doc) {
  const c = makeCanvas(w, h, doc);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, w, h);
  g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/**
 * AN AI'S PAINTED-ON CHECKERBOARD. Asked for "a transparent background", picture AIs very often paint the grey-and-white
 * squares an editor shows BEHIND transparency, as part of the picture. It looks clear in a preview and is a box on a
 * card. Read from a corner at full size: two light, grey colours cover nearly all of it, in alternating squares.
 * Pure over RGBA bytes.
 */
export function looksLikeCheckerboard(data, w, h) {
  if (!data || w < 8 || h < 8) return false;
  const counts = new Map();
  const key = (i) => `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
  let opaque = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    if (data[i + 3] < 250) continue;
    opaque += 1;
    const k = key(i);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  if (opaque < w * h * 0.9) return false;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (top.length < 2) return false;
  const [a, b] = top.map(([k]) => k.split(',').map((n) => Number(n) * 8 + 4));
  const share = (top[0][1] + top[1][1]) / opaque;
  if (share < 0.85 || top[1][1] / opaque < 0.2) return false;
  const grey = (c) => Math.max(...c) - Math.min(...c) <= 24;
  const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  if (!grey(a) || !grey(b) || luma(a) < 150 || luma(b) < 150) return false;
  const diff = Math.abs(luma(a) - luma(b));
  if (diff < 6 || diff > 90) return false;
  // Alternating squares: along a row and down a column the colour changes a few times, in runs of similar length.
  const ka = top[0][0];
  const runs = (step, n, start) => {
    let changes = 0, prev = null;
    for (let j = 0; j < n; j++) {
      const now = key(start + j * step) === ka;
      if (prev !== null && now !== prev) changes += 1;
      prev = now;
    }
    return changes;
  };
  const mid = Math.floor(h / 2), col = Math.floor(w / 2);
  const across = runs(4, w, mid * w * 4);
  const down = runs(w * 4, h, col * 4);
  return across >= 2 && down >= 2 && across <= w / 2 && down <= h / 2;
}

const SVG_REASON = Object.freeze({
  empty: 'the file is empty',
  'too-big': 'it is too big to draw safely',
  doctype: 'it has a DOCTYPE or ENTITY line, which is refused',
  unparseable: 'it is not a well-formed SVG',
  'not-svg': 'it is not an SVG drawing',
  'too-many': 'it has too many shapes to draw safely',
  'too-deep': 'its groups are nested too deeply',
  'use-loop': 'it refers to itself in a loop',
  'no-frame': 'it has no viewBox (no frame to fit in)',
});
const SVG_FATAL = new Set(['empty', 'unparseable', 'not-svg']);
/** What svg_sanitize.js leaves out, in words. */
export function droppedWords(dropped) {
  const seen = new Set();
  for (const d of dropped || []) {
    const m = /^element (\S+)/.exec(d);
    const tag = m ? m[1] : '';
    if (tag === 'text' || tag === 'tspan') seen.add('words (text)');
    else if (tag === 'image' || tag === 'feImage') seen.add('a picture inside it');
    else if (tag === 'filter' || /^fe[A-Z]/.test(tag)) seen.add('a filter effect (blur or shadow)');
    else if (tag === 'script' || d === 'handler') seen.add('a script');
    else if (tag === 'a' || d === 'external-href') seen.add('a link to something else');
    else if (tag === 'foreignObject' || tag === 'iframe') seen.add('a web page inside it');
    else if (tag === 'pattern') seen.add('a pattern fill');
    else if (/^(animate|set)/.test(tag)) seen.add('built-in animation');
  }
  return [...seen];
}

/** A full-size solid shape at the bottom of an SVG = a painted background. On svg_sanitize.js's clean description. */
function svgSolidBackground(clean) {
  const vb = String(clean.viewBox || '').split(/\s+/).map(Number);
  if (vb.length !== 4) return false;
  const [x0, y0, w, h] = vb;
  const kids = (clean.root && clean.root.children) || [];
  for (const n of kids.slice(0, 3)) {
    if (!n || n.tag !== 'rect') continue;
    const a = Object.fromEntries((n.attrs || []).map((x) => [x.name, x.value]));
    const fill = String(a.fill == null ? 'black' : a.fill).trim().toLowerCase();
    if (fill === 'none' || fill === 'transparent' || Number(a['fill-opacity']) === 0 || Number(a.opacity) === 0) continue;
    const num = (v, full) => (/%$/.test(String(v)) ? (parseFloat(v) / 100) * full : parseFloat(v));
    const rx = num(a.x || 0, w), ry = num(a.y || 0, h), rw = num(a.width, w), rh = num(a.height, h);
    if (rx <= x0 + w * 0.01 && ry <= y0 + h * 0.01 && rw >= w * 0.98 && rh >= h * 0.98) return true;
  }
  return false;
}

/**
 * Measure one file, in this browser only. `file` is a File or Blob (with `name`). Resolves the facts `judgeArt`
 * reads; never throws (a file that cannot be read is `decoded: false`).
 */
export async function readArtFacts(file, opts = {}) {
  const o = { ...CHECK_DEFAULTS, ...(opts || {}) };
  const name = String((file && file.name) || '');
  const type = String((file && file.type) || '');
  const ext = extOfName(name) || MIME_EXT[type] || '';
  const facts = { name, ext, type, bytes: Number(file && file.size) || 0, decoded: false, width: 0, height: 0,
    alpha: false, border: 0, checker: false, outside: 0, svg: null };
  if (!file) return facts;
  if (ext === 'svg' || type === 'image/svg+xml') {
    facts.ext = 'svg';
    const cap = Number(o.svgReadMax) || SVG_LIMITS.maxChars;
    if (facts.bytes > cap * 4) { facts.svg = { ok: false, reason: 'too-big' }; return facts; }
    let text = '';
    try { text = await file.text(); } catch { facts.svg = { ok: false, reason: 'empty' }; return facts; }
    const clean = sanitizeSvg(text);
    if (!clean.ok) { facts.svg = { ok: false, reason: clean.reason }; return facts; }
    const vb = String(clean.viewBox).split(/\s+/).map(Number);
    facts.decoded = true;
    facts.width = vb[2]; facts.height = vb[3];
    facts.svg = { ok: true, viewBox: clean.viewBox, eyes: !!clean.parts?.eyes, mouth: !!clean.parts?.mouth,
      left: droppedWords(clean.dropped), solid: svgSolidBackground(clean) };
    facts.alpha = !facts.svg.solid;
    facts.border = facts.svg.solid ? 0 : 1;
    return facts;
  }
  if (typeof createImageBitmap !== 'function') return facts;
  let bm = null;
  try { bm = await createImageBitmap(file); } catch { return facts; }
  try {
    const W = bm.width, H = bm.height;
    if (!(W > 0 && H > 0)) return facts;
    facts.decoded = true;
    facts.width = W; facts.height = H;
    // The whole picture, shrunk: the background and the circle.
    const scale = Math.min(1, o.sample / Math.max(W, H));
    const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    const d = pixels(bm, [0, 0, W, H], w, h, o.doc);
    let clear = 0, edge = 0, edgeClear = 0, drawn = 0, outside = 0;
    const cx = (w - 1) / 2, cy = (h - 1) / 2, r = Math.min(w, h) / 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = d[(y * w + x) * 4 + 3];
        const isClear = a <= o.clearAlpha;
        if (isClear) clear += 1;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { edge += 1; if (isClear) edgeClear += 1; }
        if (a > 128) {
          drawn += 1;
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) outside += 1;
        }
      }
    }
    facts.alpha = clear > 0;
    facts.border = edge ? edgeClear / edge : 0;
    facts.outside = drawn ? outside / drawn : 0;
    // A corner at full size, for a painted checkerboard (only worth looking when the edge is not clear).
    if (facts.border < o.borderClear) {
      const s = Math.min(64, W, H);
      facts.checker = looksLikeCheckerboard(pixels(bm, [0, 0, s, s], s, s, o.doc), s, s);
    }
  } catch { /* a canvas that would not read: what was measured stands */ } finally {
    try { bm.close?.(); } catch { /* gone */ }
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------------
// THE PURE HALF: judging the facts against a kind.
// ---------------------------------------------------------------------------------------------------------------------

const near = (r, [a, b], tol) => Math.abs(r / (a / b) - 1) <= tol;
const ratioWords = (w, h) => {
  const g = (x, y) => (y ? g(y, x % y) : x);
  const k = g(Math.round(w), Math.round(h)) || 1;
  const a = Math.round(w / k), b = Math.round(h / k);
  if (a === b) return 'square';
  return a <= 40 && b <= 40 ? `${a}:${b}` : (w > h ? 'wider than tall' : 'taller than wide');
};

/**
 * One file's facts against one kind (or `null`: only what is true of every kind is said). Pure.
 * Resolves `{ verdict, notes: [{ level: 'no' | 'warn' | 'tip', text }] }`.
 */
export function judgeArt(f, k, opts = {}) {
  const o = { ...CHECK_DEFAULTS, ...(opts || {}) };
  const notes = [];
  const no = (text) => notes.push({ level: 'no', text });
  const warn = (text) => notes.push({ level: 'warn', text });
  const tip = (text) => notes.push({ level: 'tip', text });
  const typeName = TYPE_WORDS[f.ext] || (f.ext ? f.ext.toUpperCase() : 'this kind of file');

  // 1. Is it a picture the site can show at all?
  // An SVG the sanitizer refuses is still shown as a still picture (an <img> cannot run anything) unless it is not a
  // drawing at all - so only those three are "will not work".
  let svgStill = false;
  if (f.ext === 'svg') {
    const reason = f.svg && f.svg.reason;
    if (!f.svg || (!f.svg.ok && SVG_FATAL.has(reason))) {
      no(`This SVG cannot be used: ${SVG_REASON[reason] || 'it could not be read'}.`);
      return finish(notes);
    }
    if (!f.svg.ok) {
      svgStill = true;
      warn(`The site will show this SVG only as a still picture, and some screens may refuse it: ${SVG_REASON[reason] || reason}.`);
    }
  } else if (!f.ext || !SHOWABLE.has(f.ext)) {
    if (f.ext === 'heic' || f.ext === 'heif') no(`${typeName} is a phone camera format most browsers cannot show. Save it as ${k ? typesWords(k) : 'PNG or JPG'}.`);
    else if (f.ext === 'txt' || f.ext === 'md') { notes.push({ level: 'skip', text: 'Not a picture (a text file).' }); return finish(notes); }
    else no(`This is not a picture the site can show${f.ext ? ` (.${f.ext})` : ''}. Save it as ${k ? typesWords(k) : 'PNG, WebP or JPG'}.`);
    return finish(notes);
  } else if (!f.decoded) {
    no('This file could not be opened as a picture. It may be damaged, or not really the type its name says.');
    return finish(notes);
  }

  // 2. The right type for this kind?
  if (k) {
    const ext = f.ext === 'jpeg' ? 'jpg' : f.ext;
    // folder art (2026-10-07): a folder lists SVG files now, so an SVG is judged like any other type - fine where the
    // kind takes it, "works, but best as ..." where it does not (the branch below).
    if (!k.types.includes(ext)) {
      const why = ext === 'jpg' && k.clear === 'wanted' ? ' A JPG cannot have a clear background.' : '';
      warn(`${typeName} works, but ${k.plural.toLowerCase()} are best as ${typesWords(k)}.${why}`);
    }
  }

  // 3. Size and shape.
  const W = Number(f.width) || 0, H = Number(f.height) || 0;
  if (k && W > 0 && H > 0) {
    const r = W / H;
    const isSvg = f.ext === 'svg';
    if (!k.shapes.some((s) => near(r, s, ASPECT_TOLERANCE))) {
      const fit = k.circle ? 'It is cut to fit the circle, so some of it will not show.'
        : k.id === 'wallpaper' ? 'It will be cropped or have bars at the sides.'
          : 'It is fitted inside, with space at the sides.';
      warn(`It is ${isSvg ? '' : `${W} × ${H}, `}${ratioWords(W, H)}; ${k.plural.toLowerCase()} are ${shapeWords(k)}. ${fit}`);
    }
    if (!isSvg) {
      if (Math.min(W, H) < k.minSide) warn(`It is small (${W} × ${H}): it will look blurry when shown large. Aim for ${k.width} × ${k.height}.`);
      else if (Math.max(W, H) > k.maxSide) warn(`It is bigger than it needs to be (${W} × ${H}): it works, but loads slowly. ${k.width} × ${k.height} is enough.`);
    }
  }

  // 4. The background (not measured for an SVG the sanitizer refused).
  if (svgStill) { /* nothing measured */ } else if (k && k.clear === 'wanted') {
    if (f.checker) {
      warn('The background looks like grey-and-white squares painted into the picture: a picture OF transparency, not the real thing. '
        + 'Ask your AI again for a real transparent PNG, or remove the background.');
    } else if ((Number(f.border) || 0) < o.borderClear) {
      warn(f.ext === 'svg' ? 'It has a solid background shape behind it: a box will show around it. Remove the first, full-size rectangle.'
        : 'It has no clear background: a box of colour will show around it. Ask for a transparent background.');
    } else if (k.circle && (Number(f.outside) || 0) > o.outsideMax) {
      warn('Part of it reaches into the corners: an avatar is shown in a circle, so that part is cut off. Keep it nearer the middle.');
    }
  } else if (k && k.clear === 'no' && f.alpha) {
    warn('Part of it is clear (transparent): on a full screen that part shows as black.');
  }

  // 5. An SVG avatar's own parts.
  if (f.ext === 'svg' && f.svg && f.svg.ok) {
    if (f.svg.left && f.svg.left.length) warn(`Left out when it is drawn: ${f.svg.left.join(', ')}.`);
    if (k && k.id === 'avatar' && !(f.svg.eyes && f.svg.mouth)) {
      tip('It will not blink or talk: put the eyes in a group with id="eyes" and the mouth in a group with id="mouth".');
    }
  }

  // 6. File size.
  if (k && f.bytes > k.maxBytes) warn(`It is ${bytesWords(f.bytes)}: it works, but loads slowly. ${k.plural} work best under ${bytesWords(k.maxBytes)}${f.ext === 'png' && k.clear !== 'wanted' ? ' (a JPG or WebP is much smaller)' : ''}.`);

  // 7. The name (a tip).
  const leaf = String(f.name || '').split(/[\\/]/).pop();
  const base = baseOfName(leaf);
  if (k) {
    const tidy = NAME_RE.test(base) && leaf.length <= NAME_MAX && extOfName(leaf) === extOfName(leaf).toLowerCase();
    if (!tidy || !(base === k.prefix || base.startsWith(`${k.prefix}-`))) {
      tip(`Name it like ${k.example}: small letters, numbers and hyphens, starting with “${k.prefix}-”.`);
    }
  }
  return finish(notes);
}

function finish(notes) {
  const verdict = notes.some((n) => n.level === 'skip') ? 'skip'
    : notes.some((n) => n.level === 'no') ? 'no' : notes.some((n) => n.level === 'warn') ? 'works' : 'ready';
  return { verdict, notes: notes.filter((n) => n.level !== 'skip' || verdict === 'skip') };
}

/** The one-line verdict in words. */
export function verdictWords(r) {
  if (!r) return '';
  if (r.verdict === 'skip') return 'Skipped: not a picture.';
  const t = r.kind ? r.kind.title.toLowerCase() : '';
  const as = t ? ` as ${/^[aeiou]/.test(t) ? 'an' : 'a'} ${t}` : '';
  if (r.verdict === 'no') return `Will not work${as}.`;
  if (r.verdict === 'works') return `Works${as}, but:`;
  return r.kind ? `Ready${as}.` : 'A picture the site can show.';
}

// ---------------------------------------------------------------------------------------------------------------------
// PUTTING THEM TOGETHER.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Check one file. `folder` is where it sat (a path inside the Artwork folder, or a picked folder's relative path);
 * `kind` an id to check it as, overriding what its folder and name say. Resolves
 * `{ name, folder, kind, unknown, facts, verdict, notes }` - `unknown` when no kind could be worked out (then only what
 * is true of every kind is checked, and a note says how to say which).
 */
export async function checkArtFile(file, { folder = '', kind = '', kinds = ART_KINDS, opts = {} } = {}) {
  const k = (kind && kinds.find((x) => x.id === kind)) || kindFor({ name: file && file.name, folder }, kinds);
  const facts = await readArtFacts(file, opts);
  const r = judgeArt(facts, k, opts);
  if (!k && r.verdict !== 'skip' && r.verdict !== 'no') {
    r.notes.push({ level: 'tip', text: `Which kind is it for? Put it in one of the ${ART_FOLDER} folders (${kinds.map((x) => x.folder).join(', ')}), `
      + `or start its name with ${kinds.map((x) => `${x.prefix}-`).join(', ')}.` });
  }
  return { name: String((file && file.name) || ''), folder: String(folder || ''), kind: k, unknown: !k, facts, ...r };
}

/**
 * Check a list of picked files: `[File]` from a file input, or `[{ file, folder }]`. A folder input's files carry
 * `webkitRelativePath` ("Artwork/Avatars/sam.png"), which says the folder. At most `maxFiles`; `more` counts the rest.
 */
export async function checkArtFiles(list, { kind = '', kinds = ART_KINDS, opts = {} } = {}) {
  const o = { ...CHECK_DEFAULTS, ...(opts || {}) };
  const items = [...(list || [])].map((x) => (x && x.file ? x : { file: x, folder: x && x.webkitRelativePath
    ? foldersOf(x.webkitRelativePath).join('/') : '' }))
    .filter((x) => x.file && !String(x.file.name || '').startsWith('.'));
  const results = [];
  for (const it of items.slice(0, o.maxFiles)) results.push(await checkArtFile(it.file, { folder: it.folder, kind, kinds, opts: o }));
  return { results, more: Math.max(0, items.length - o.maxFiles) };
}

/**
 * Check a folder handle (the Artwork folder, or any folder): its own files and those one level down (each kind's
 * folder). README files are left out. Never prompts, never writes. Resolves `{ results, more }`.
 */
export async function checkArtFolder(dir, { kinds = ART_KINDS, opts = {} } = {}) {
  const o = { ...CHECK_DEFAULTS, ...(opts || {}) };
  const found = [];
  const walk = async (d, path, depth) => {
    if (!d?.entries) return;
    const here = [];
    for await (const [name, entry] of d.entries()) here.push([name, entry]);
    here.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [name, entry] of here) {
      if (String(name).startsWith('.')) continue;
      if (entry.kind === 'directory') { if (depth < 1) await walk(entry, path ? `${path}/${name}` : name, depth + 1); continue; }
      if (/^readme(\.txt|\.md)?$/i.test(name)) continue;
      found.push({ entry, folder: path });
    }
  };
  await walk(dir, '', 0);
  const results = [];
  for (const it of found.slice(0, o.maxFiles)) {
    let file = null;
    try { file = await it.entry.getFile(); } catch { file = null; }
    if (!file) { results.push({ name: it.entry.name, folder: it.folder, kind: null, unknown: true, facts: null, verdict: 'no', notes: [{ level: 'no', text: 'This file could not be read.' }] }); continue; }
    results.push(await checkArtFile(file, { folder: it.folder, kinds, opts: o }));
  }
  return { results, more: Math.max(0, found.length - o.maxFiles) };
}

/** A count in words for the top of a list of results: "3 checked: 1 ready, 1 works with notes, 1 will not work." */
export function summaryWords({ results = [], more = 0 } = {}) {
  const pics = results.filter((r) => r.verdict !== 'skip');
  if (!pics.length) return more ? '' : 'No pictures found to check.';
  const n = (v) => pics.filter((r) => r.verdict === v).length;
  const bits = [];
  if (n('ready')) bits.push(`${n('ready')} ready`);
  if (n('works')) bits.push(`${n('works')} ${n('works') === 1 ? 'works' : 'work'} with notes`);
  if (n('no')) bits.push(`${n('no')} will not work`);
  const tail = more ? ` (and ${more} more not checked: check them in smaller groups)` : '';
  return `${pics.length} checked: ${bits.join(', ')}${tail}.`;
}
