// user_folders.js — THE ONE STORAGE ROOT, AND THE SUBFOLDERS PEOPLE FILL THEMSELVES (row 2.49).
//
// Mike, 2026-10-01: *"It would be nice if they could connect folders with their own fonts, LUTs,
// VSTs, etc."* And `DECISIONS.md`, 2026-08-30, "One storage root, set up once": *the user is given an
// empty folder tree and chooses where it lives. Everything else defaults to its own folder inside
// that tree.* So fonts, colour looks (LUTs) and audio plugins are NOT three more "choose a folder"
// prompts — they are three subfolders of the one root, made when the root is chosen.
//
// WHAT EXISTED BEFORE THIS: the decision, not the root. The recordings folder (`fs_sink.js`) and the
// photo folders (`folder_source.js`) each still pick their own folder. This file is the root itself,
// built on `fs_sink.js`'s own remember/recall (same database, its own key), so no new storage layer.
// Moving recordings and photos under it is later work and is not done here.
//
// *** NOTHING HERE SENDS ANYTHING ANYWHERE. *** A folder handle lives in this browser's IndexedDB
// (it cannot be sent — see folder_source.js); files are read into memory on this device. The
// server never sees a font, a LUT or a plugin.
//
// THE TREE, on first choice: `fonts/`, `luts/`, `audio-plugins/`, each with a short README.txt saying
// what goes in it (DECISIONS' open question — "empty with named subfolders and a short README in
// each ... a person can see what the software will do before it does any of it"). A README that is
// already there is never overwritten: it might be the person's own notes. The NAMES are a default
// (`SUBFOLDERS`, overridable per call) — plain words so the folder explains itself in a file manager.
//
// Everything takes its handle and IndexedDB as arguments, so the suite runs on fake folders.

import { rememberFolder, recallFolder } from './fs_sink.js';

export const ROOT_KEY = 'root';
export const SUBFOLDERS = Object.freeze({ fonts: 'fonts', luts: 'luts', plugins: 'audio-plugins' });

export const README = Object.freeze({
  fonts: 'Put font files here (.woff2, .woff, .ttf or .otf). They appear as font choices in Nimrod on this device.\n'
    + 'They are read from this folder on this device and never uploaded.\n',
  luts: 'Put colour look files here (.cube). One can be chosen as a colour grade for photos, wallpaper or video.\n'
    + 'Off until somebody chooses one. Read on this device, never uploaded.\n',
  plugins: 'Put Web Audio Module (WAM) plugins here, one folder per plugin. VST plugins cannot run in a web browser.\n'
    + 'A plugin is a program: it can do anything this page can do, so only add plugins you trust.\n'
    + 'WAM plugins also need the free WAM host files: put the @webaudiomodules/sdk package in a folder named wam-sdk here.\n'
    + 'Off until somebody turns a plugin on.\n',
});

export function available(view = (typeof window !== 'undefined' ? window : null)) {
  return !!(view && typeof view.showDirectoryPicker === 'function');
}

async function dirIn(parent, name, create) {
  try { return await parent.getDirectoryHandle(name, create ? { create: true } : undefined); } catch { return null; }
}

/**
 * Make the named subfolders (and their READMEs) inside `root`. Idempotent: what is there is left
 * alone. Returns `{ made: [names created], ok }`; a folder that could not be made is simply missing
 * from `made` (a read-only root still works for reading).
 */
export async function ensureTree(root, { names = SUBFOLDERS, readme = README } = {}) {
  const made = [];
  if (!root?.getDirectoryHandle) return { made, ok: false };
  for (const [kind, name] of Object.entries(names)) {
    const existed = await dirIn(root, name, false);
    const dir = existed || await dirIn(root, name, true);
    if (!dir) continue;
    if (!existed) made.push(name);
    if (readme[kind]) {
      let has = false;
      try { await dir.getFileHandle('README.txt'); has = true; } catch { has = false; }
      if (!has) {
        try {
          const fh = await dir.getFileHandle('README.txt', { create: true });
          const w = await fh.createWritable();
          try { await w.write(readme[kind]); } finally { await w.close(); }
        } catch { /* a read-only folder: the subfolder still works */ }
      }
    }
  }
  return { made, ok: true };
}

/**
 * Ask for the root. A REAL PROMPT — only from something somebody pressed. Remembers it on this
 * device and makes the tree. Resolves `{ handle, made }`.
 */
export async function pickRoot({ view = (typeof window !== 'undefined' ? window : null), idb, names } = {}) {
  if (!available(view)) throw new Error('This browser cannot open a folder you choose.');
  const handle = await view.showDirectoryPicker({ id: 'nimrod-root', mode: 'readwrite' });
  await rememberFolder(handle, { idb, key: ROOT_KEY });
  const { made } = await ensureTree(handle, { names });
  return { handle, made };
}

/** The remembered root and whether it can be used now (`fs_sink.recallFolder`'s honest reading). */
export function recallRoot({ idb } = {}) {
  return recallFolder({ idb, key: ROOT_KEY });
}

/** One of the subfolders, or null (no root, no such folder). Never creates anything. */
export async function subfolder(root, kind, { names = SUBFOLDERS } = {}) {
  const name = names[kind] || kind;
  return root ? dirIn(root, name, false) : null;
}

const extOf = (name) => {
  const s = String(name).toLowerCase().replace(/^\.+/, '');
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(dot + 1) : '';
};

/** Files directly in `dir` whose extension is in `exts` (any case), sorted: `[{ name, handle }]`. */
export async function listFiles(dir, exts) {
  const want = new Set((exts || []).map((e) => String(e).toLowerCase()));
  const out = [];
  if (!dir?.entries) return out;
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.') || entry.kind !== 'file') continue;
    if (want.size && !want.has(extOf(name))) continue;
    out.push({ name, handle: entry });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Subfolders directly in `dir`, sorted: `[{ name, handle }]`. */
export async function listFolders(dir) {
  const out = [];
  if (!dir?.entries) return out;
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.') || entry.kind !== 'directory') continue;
    out.push({ name, handle: entry });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export { extOf };
