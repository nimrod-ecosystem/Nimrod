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

import { rememberFolder, recallFolder, forgetFolder } from './fs_sink.js';
// Only for `checkDeviceLook` at the bottom (a look whose file is gone). lut.js imports nothing.
import { reconcileGrade, refreshGrade } from './lut.js';

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
export async function pickRoot({ view = (typeof window !== 'undefined' ? window : null), idb, names, store = null } = {}) {
  if (!available(view)) throw new Error('This browser cannot open a folder you choose.');
  const handle = await view.showDirectoryPicker({ id: 'nimrod-root', mode: 'readwrite' });
  if (store) await store.put(ROOT_KEY, handle);
  else await rememberFolder(handle, { idb, key: ROOT_KEY });
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

// ---------------------------------------------------------------------------------------------
// A FOLDER OF ITS OWN FOR ONE KIND, AND THE SCREEN'S READING OF EACH (2026-10-02, the screen for
// row 2.49 - `user_folders_page.js`).
//
// *** ONE ROOT STAYS THE DEFAULT; A KIND MAY POINT ELSEWHERE. Both sides, since this bends the
// 2026-08-30 decision quoted at the top. *** For one root only: one prompt, one permission to
// re-grant after a restart, one place to look. For a folder per kind: somebody who already keeps
// fonts in a folder of their own, or colour looks where their editing software put them, should not
// have to copy files to use them, and DECISIONS itself says everything else *defaults* to its own
// folder inside the tree - a default, not a rule. So: nothing changes for anybody who never presses
// "Choose a different folder"; whoever does gets that folder for that kind only, and its permission is
// shown (and re-granted) on its own line. "Use the one in my Nimrod folder" undoes it.
//
// READ ONLY for a kind's own folder (`KIND_MODE`), argued: nothing here writes into it (the READMEs
// are the root's), and asking for write access to somebody's fonts folder is asking for more than is
// used. The root keeps read+write: it makes the subfolders.
// ---------------------------------------------------------------------------------------------
export const FOLDER_KINDS = Object.freeze(Object.keys(SUBFOLDERS));
export const KIND_MODE = 'read';
export const ROOT_MODE = 'readwrite';
export const kindKey = (kind) => `folder:${kind}`;

/**
 * The handles this device remembers, behind one small door: `{ get(key), put(key, handle), del(key) }`.
 * The default is fs_sink's IndexedDB store (the same database and store as the recordings folder,
 * its own keys). A suite passes a Map-backed one: an in-memory fake folder cannot be stored in
 * IndexedDB, which only takes real handles.
 */
export function handleStore({ idb = (typeof indexedDB !== 'undefined' ? indexedDB : null) } = {}) {
  return {
    async get(key) { const r = await recallFolder({ idb, key }); return r.handle || null; },
    put: (key, handle) => rememberFolder(handle, { idb, key }),
    del: (key) => forgetFolder({ idb, key }),
  };
}

/** `granted`, `prompt`, `denied`, `unknown`, or `none` (no handle). Never prompts, never throws. */
export async function permissionOf(handle, mode = KIND_MODE) {
  if (!handle) return 'none';
  try { return (await handle.queryPermission?.({ mode })) || 'unknown'; } catch { return 'unknown'; }
}

/**
 * Ask the browser to let this page into a remembered folder again. *** ONLY FROM A PRESS *** - the
 * browser refuses to prompt otherwise, and the refusal looks like a denial (fs_sink.ensurePermission).
 */
export async function allowAgain(handle, mode = KIND_MODE) {
  if (!handle?.requestPermission) return 'unknown';
  try {
    if (await handle.queryPermission?.({ mode }) === 'granted') return 'granted';
    return await handle.requestPermission({ mode });
  } catch { return 'denied'; }
}

/** Ask for a folder for ONE kind (a real prompt: only from a press) and remember it for that kind. */
export async function pickKindFolder(kind, { view = (typeof window !== 'undefined' ? window : null), store = handleStore() } = {}) {
  if (!FOLDER_KINDS.includes(kind)) throw new Error(`no such kind of folder: ${kind}`);
  if (!available(view)) throw new Error('This browser cannot open a folder you choose.');
  const handle = await view.showDirectoryPicker({ id: `nimrod-${kind}`, mode: KIND_MODE });
  await store.put(kindKey(kind), handle);
  return { handle };
}

/** Back to the root's own subfolder for this kind. The folder and its files are not touched. */
export async function useRootFor(kind, { store = handleStore() } = {}) {
  return store.del(kindKey(kind));
}

/** Stop using the root on this device. The folder and its files are not touched. */
export async function forgetRoot({ store = handleStore() } = {}) {
  return store.del(ROOT_KEY);
}

/**
 * WHERE ONE KIND'S FILES COME FROM ON THIS DEVICE, NOW. Never prompts. Resolves
 *   { kind, source: 'own' | 'root' | 'none', permission, name, holder, mode, dir, missing }
 * `dir` is a folder that can be read right now, or null; `holder` is the handle the permission is
 * on (the kind's own folder, or the root) - what "Allow again" asks about; `missing` is a root whose
 * subfolder for this kind is not there (deleted or renamed by hand).
 */
export async function kindFolder(kind, { store = handleStore(), names = SUBFOLDERS } = {}) {
  const get = async (key) => { try { return await store.get(key); } catch { return null; } };
  const own = await get(kindKey(kind));
  if (own) {
    const permission = await permissionOf(own, KIND_MODE);
    return { kind, source: 'own', permission, name: String(own.name || ''), holder: own, mode: KIND_MODE,
      dir: permission === 'granted' ? own : null, missing: false };
  }
  const root = await get(ROOT_KEY);
  if (!root) return { kind, source: 'none', permission: 'none', name: '', holder: null, mode: ROOT_MODE, dir: null, missing: false };
  const permission = await permissionOf(root, ROOT_MODE);
  const sub = permission === 'granted' ? await subfolder(root, kind, { names }) : null;
  return { kind, source: 'root', permission, name: `${root.name || ''}/${names[kind] || kind}`, holder: root, mode: ROOT_MODE,
    dir: sub, missing: permission === 'granted' && !sub };
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

/**
 * A COLOUR LOOK WHOSE FILE IS GONE FALLS BACK TO NONE (2026-10-02). Reads the looks folder (never
 * prompts); if it can be read and the look in force came from a file no longer in it, the look is
 * cleared, quietly, and anything already graded is put back. A folder that cannot be read right now
 * keeps the look (lut.js stores it compiled for exactly that). For the kiosk at boot and the folders
 * page. Resolves `{ cleared, read, files }` - `files` the .cube names found, when `read`.
 */
export async function checkDeviceLook({ store, storage, names } = {}) {
  const k = await kindFolder('luts', { ...(store ? { store } : {}), ...(names ? { names } : {}) });
  if (!k.dir) return { cleared: false, read: false, files: [] };
  const files = (await listFiles(k.dir, ['cube'])).map((f) => f.name);
  const cleared = reconcileGrade(files, storage);
  if (cleared) refreshGrade({ storage });
  return { cleared, read: true, files };
}
