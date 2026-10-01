// user_fonts.js — FONTS FROM THE PERSON'S OWN `fonts/` FOLDER (row 2.49).
//
// Mike, 2026-10-01: *"We haven't really discussed fonts and the depth of options users could have.
// It would be nice if they could connect folders with their own fonts."* A font file in the storage
// root's `fonts/` subfolder (user_folders.js) becomes a font choice on this device.
//
// HOW: the browser's FontFace interface. The file's bytes are read from the folder into memory and
// handed to `new FontFace(family, bytes)`; `document.fonts.add` makes the family usable in CSS.
// *** NEVER UPLOADED, NEVER FETCHED: *** no URL is made for the file at all, so there is nothing a
// request could even go to. (Chrome can also list INSTALLED fonts, with a permission prompt — the
// Local Font Access API. Not used: a prompt on a screen nobody may be at, for fonts a person can
// simply copy into the folder.)
//
// FAMILY NAMES come from the FILE NAME, not from inside the font: `Atkinson-Hyperlegible-Bold.ttf`
// is family "Atkinson Hyperlegible", weight 700. Reading a font's own name table would need a
// decompressor for .woff2 (Brotli) the browser does not expose to a page; a file name is what a
// person sees and can rename. The cost: two files of one family named differently show as two.
//
// PER DEVICE, like the AI settings (ai.js): the files are on this device, so the CHOICE is stored in
// this browser's localStorage (`USER_FONT_KEY`), read in try/catch. After a reload the folder's
// permission may need a press again (fs_sink.js); until then the chosen family is simply not
// loaded and the fallback stack (the theme's own font) shows — `fontStack` always carries one.

import { listFiles } from './user_folders.js';

export const FONT_EXTS = Object.freeze(['woff2', 'woff', 'ttf', 'otf']);
export const USER_FONT_KEY = 'nimrod.userFont.device';

// Style words at the end of a file name, longest first so "SemiBold" is not read as "Bold".
const WEIGHTS = [
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600], ['extrabold', 800],
  ['ultrabold', 800], ['hairline', 100], ['regular', 400], ['medium', 500], ['normal', 400], ['light', 300],
  ['black', 900], ['heavy', 900], ['thin', 100], ['bold', 700], ['book', 400],
];

/** `{ family, weight, style }` from a font file's name. Never throws; junk gives family ''. */
export function faceFromName(fileName) {
  let base = String(fileName || '').replace(/\.[^.]+$/, '');
  let style = 'normal';
  let weight = 400;
  // Variable fonts: "Inter[wght].ttf", "Roboto-VariableFont_wght.ttf".
  base = base.replace(/\[[^\]]*\]/g, '').replace(/[-_ ]?VariableFont.*$/i, '');
  const tail = /[-_ ]([A-Za-z]+)$/.exec(base);
  if (tail) {
    let t = tail[1].toLowerCase();
    const italic = /(italic|oblique)$/.test(t);
    if (italic) t = t.replace(/(italic|oblique)$/, '');
    const w = t ? WEIGHTS.find(([k]) => t === k) : null;
    // Only a tail that is ENTIRELY style words is a style: "Atkinson-Hyperlegible" keeps its word.
    if (w || (italic && !t)) {
      base = base.slice(0, tail.index);
      weight = w ? w[1] : 400;
      style = italic ? 'italic' : 'normal';
    }
  }
  // CamelCase and separators to spaces: "OpenDyslexic" stays one word; "Atkinson-Hyperlegible" -> two.
  const family = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { family, weight, style };
}

/** A CSS font-family value: the family, quoted, then a fallback stack. */
export function fontStack(family, fallback = 'system-ui, sans-serif') {
  const f = String(family || '').replace(/["\\]/g, '').trim();
  return f ? `"${f}", ${fallback}` : fallback;
}

/**
 * Load every font file in `dir` (the `fonts/` subfolder) into the page.
 * Resolves `{ families: [{ family, faces }], failed: [{ name, why }] }`. A file that is not a font
 * the browser can read is reported in `failed`, never a throw, and never stops the others.
 * `FontFaceImpl` and `fontSet` are injectable for tests.
 */
export async function loadUserFonts(dir, { FontFaceImpl = globalThis.FontFace,
  fontSet = (typeof document !== 'undefined' ? document.fonts : null) } = {}) {
  const families = new Map();
  const failed = [];
  if (typeof FontFaceImpl !== 'function' || !fontSet) return { families: [], failed: [{ name: '', why: 'this browser cannot load fonts from files' }] };
  for (const { name, handle } of await listFiles(dir, FONT_EXTS)) {
    const { family, weight, style } = faceFromName(name);
    if (!family) { failed.push({ name, why: 'no name to call it by' }); continue; }
    try {
      const bytes = await (await handle.getFile()).arrayBuffer();
      const face = new FontFaceImpl(family, bytes, { weight: String(weight), style });
      await face.load();
      fontSet.add(face);
      families.set(family, (families.get(family) || 0) + 1);
    } catch (err) {
      failed.push({ name, why: `not a font this browser can read (${String((err && err.message) || err)})` });
    }
  }
  return { families: [...families].map(([family, faces]) => ({ family, faces })).sort((a, b) => a.family.localeCompare(b.family)),
    failed };
}

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** This device's chosen user font family, or '' (none — the theme's font). */
export function chosenUserFont(storage = defaultStorage()) {
  try { const v = storage ? JSON.parse(storage.getItem(USER_FONT_KEY) || 'null') : null; return v && typeof v.family === 'string' ? v.family : ''; }
  catch { return ''; }
}

export function chooseUserFont(family, storage = defaultStorage()) {
  try {
    if (!family) storage?.removeItem?.(USER_FONT_KEY);
    else storage?.setItem(USER_FONT_KEY, JSON.stringify({ family: String(family) }));
  } catch { /* private window: the choice lasts this page */ }
  return chosenUserFont(storage);
}

/**
 * The `--font` value with this device's user font in front of the theme's own, or the theme's own
 * unchanged when none is chosen. For `theme.js` (see the report: one line where it sets `--font`).
 */
export function userFontStack(themeFont, storage = defaultStorage()) {
  const f = chosenUserFont(storage);
  return f ? fontStack(f, themeFont || 'system-ui, sans-serif') : themeFont;
}
