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
// (2026-10-04: the tree is now eight folders with plain names - SUBFOLDERS below says which and why - and
// "Set up your Nimrod folder", `setUpRoot`, makes whatever is missing. The paragraph below is the first tree's.)
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

// ---------------------------------------------------------------------------------------------
// *** THE KINDS, AND THEIR FOLDER NAMES (2026-10-04). *** Mike: *"giving them an empty folder tree ... they
// can set the root once in the site and everything else could autopopulate the folder location."* So the
// tree grew from three folders to eight, and each has a name a person reads in a file manager.
//
// THE KINDS, argued one by one (each is a folder something reads, or a place the site tells you to save to):
//   pictures   photos, the slideshow, pictures on buttons and boards. A POINTER: connect it, or point at
//              the folder your photos are already in. Nothing is ever copied.
//   music      game music and music favourites. A pointer, the same way.
//   videos     personal videos. A pointer, the same way.
//   fonts, luts, plugins   as before (867a7ff): read from the folder on this device.
//   voice      a voice model trained on one person's voice. The browser cannot run it; the desktop speech
//              service can (`--my-voice --root <this folder>` loads "<root>/Voice model"). The NAME is held
//              equal to the service's own by web/speech_service/test_service.py, which reads this file.
//   recordings recordings you save, and the phrases you export to train a voice model. The place to choose
//              when the site asks for a folder to save them in.
// LEFT OUT, argued: Notes and Question packs. Notes live with the account, not in files; question packs are
// imported through their own screen. A folder that nothing reads is a promise nothing keeps. (On Mike's list.)
//
// THE NAMES are plain words, capitalised as a file manager shows its own folders ("Pictures", "Music"). They
// replace the first tree's `fonts`, `luts`, `audio-plugins` (2026-10-01), which are still FOUND (LEGACY_SUBFOLDERS):
// a tree made before today keeps working, and setting up again makes no second fonts folder beside it.
// NOT a per-person setting, argued: the speech service has to find "Voice model" on its own, from a path, with no
// browser to ask - so the names must be the same on both sides. Anybody who wants a different folder for a kind
// points that kind at it ("Choose a different folder"), which already exists and needs no renaming.
// ---------------------------------------------------------------------------------------------
export const SUBFOLDERS = Object.freeze({
  pictures: 'Pictures', music: 'Music', videos: 'Videos',
  fonts: 'Fonts', luts: 'Colour looks', plugins: 'Audio plugins',
  voice: 'Voice model', recordings: 'Recordings',
});
export const LEGACY_SUBFOLDERS = Object.freeze({ fonts: Object.freeze(['fonts']), luts: Object.freeze(['luts']),
  plugins: Object.freeze(['audio-plugins']) });
// The kinds whose folder is only POINTED AT: their files are read where they are, never copied anywhere.
export const POINTER_KINDS = Object.freeze(['pictures', 'music', 'videos']);

export const README = Object.freeze({
  pictures: 'Put photos here (.jpg, .png, .heic and the like), or leave this empty and point Nimrod at the folder\n'
    + 'your photos are already in. Nothing is copied: Nimrod reads pictures where they are, on this device.\n',
  music: 'Put music here (.mp3, .m4a, .ogg, .wav, .flac), or point Nimrod at the folder your music is already in.\n'
    + 'Nothing is copied: it is read where it is, on this device.\n',
  videos: 'Put your own videos here (.mp4, .mov, .webm), or point Nimrod at the folder they are already in.\n'
    + 'Nothing is copied: they are read where they are, on this device.\n',
  fonts: 'Put font files here (.woff2, .woff, .ttf or .otf). They appear as font choices in Nimrod on this device.\n'
    + 'They are read from this folder on this device and never uploaded.\n',
  luts: 'Put colour look files here (.cube). One can be chosen as a colour grade for photos, wallpaper or video.\n'
    + 'Off until somebody chooses one. Read on this device, never uploaded.\n',
  plugins: 'Put Web Audio Module (WAM) plugins here, one folder per plugin. VST plugins cannot run in a web browser.\n'
    + 'A plugin is a program: it can do anything this page can do, so only add plugins you trust.\n'
    + 'WAM plugins also need the free WAM host files: put the @webaudiomodules/sdk package in a folder named wam-sdk here.\n'
    + 'Off until somebody turns a plugin on.\n',
  voice: 'Your own voice model goes here: the files of the folder the conversion step made (model.bin, config.json,\n'
    + 'tokenizer.json, a vocabulary file), directly in this folder. Empty until then: you only have those files\n'
    + 'after recording, exporting, training and converting (Voice recordings, "Your own voice model").\n'
    + 'The speech service loads it with: --my-voice --root "<the full path of your Nimrod folder>".\n',
  recordings: 'Save recordings here, and the phrases you export to train a voice model, when Nimrod asks for a folder.\n'
    + 'They stay on this device. Nimrod uploads none of it.\n',
});

export function available(view = (typeof window !== 'undefined' ? window : null)) {
  return !!(view && typeof view.showDirectoryPicker === 'function');
}

async function dirIn(parent, name, create) {
  try { return await parent.getDirectoryHandle(name, create ? { create: true } : undefined); } catch { return null; }
}

// One kind's folder in a root under its name, or else under an earlier name. Never creates.
async function existingSub(root, kind, name, legacy = LEGACY_SUBFOLDERS) {
  const hit = await dirIn(root, name, false);
  if (hit) return hit;
  for (const old of (legacy && legacy[kind]) || []) {
    const h = await dirIn(root, old, false);
    if (h) return h;
  }
  return null;
}

/**
 * Make the named subfolders (and their READMEs) inside `root`. Idempotent: what is there is left
 * alone. Returns `{ made: [names created], ok }`; a folder that could not be made is simply missing
 * from `made` (a read-only root still works for reading).
 */
export async function ensureTree(root, { names = SUBFOLDERS, readme = README, legacy = LEGACY_SUBFOLDERS } = {}) {
  const made = [];
  if (!root?.getDirectoryHandle) return { made, ok: false };
  for (const [kind, name] of Object.entries(names)) {
    // A folder under its earlier name (LEGACY_SUBFOLDERS) counts as there: no second one is made beside it.
    const existed = await existingSub(root, kind, name, legacy);
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

/**
 * "SET UP YOUR NIMROD FOLDER" (2026-10-04): make whatever is missing of the tree, with no zip to download.
 * With a root already chosen on this device it is used as it is - nothing to pick - after the browser lets this
 * page back in (it asks again after a restart: so ONLY FROM A PRESS). With none, the folder picker opens. It only
 * ever ADDS: a folder, a README or a file already there is left alone, so running it again is safe.
 * Resolves `{ handle, made, picked, ok, permission }`; `ok` false with `permission` when the browser said no.
 */
export async function setUpRoot({ view = (typeof window !== 'undefined' ? window : null), store = handleStore(), names, idb } = {}) {
  let handle = null;
  try { handle = await store.get(ROOT_KEY); } catch { handle = null; }
  if (handle) {
    const permission = await allowAgain(handle, ROOT_MODE);
    if (permission !== 'granted') return { handle, made: [], picked: false, ok: false, permission };
    const { made, ok } = await ensureTree(handle, { names });
    return { handle, made, picked: false, ok, permission };
  }
  const r = await pickRoot({ view, store, names, idb });
  return { ...r, picked: true, ok: true, permission: 'granted' };
}

// ---------------------------------------------------------------------------------------------
// THE ROOT'S FULL PATH, IF SOMEBODY TYPES IT (2026-10-04). A browser never tells a page where a folder it was
// given really is - a handle has a name, not a path - so "<your Nimrod folder>/Voice model" is the most this
// page can say by itself. Somebody who types the full path once gets full paths to copy, and the voice model's
// commands filled in. OPTIONAL, and kept on THIS DEVICE only (this browser's localStorage): a path usually
// names the person whose computer it is, and it means nothing on another computer anyway.
// ---------------------------------------------------------------------------------------------
export const ROOT_PATH_KEY = 'nimrod-root-path';
// Long enough for any real path (Windows' own long-path limit is 32,767, but nobody types that); a cap so a
// paste of a whole document cannot sit in storage.
export const ROOT_PATH_MAX = 1024;
const pathStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

/** A typed path tidied: trimmed, surrounding quotes off (Explorer's "Copy as path" adds them), no trailing
 * separator, no characters that could end a quoted command-line argument. '' for nothing. Pure. */
export function cleanRootPath(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f"]/g, '').trim();
  s = s.replace(/^'+|'+$/g, '').trim();
  if (/^[A-Za-z]:[\\/]*$/.test(s)) s = `${s.slice(0, 2)}\\`;          // a whole drive: "D:\"
  else if (s.length > 1) s = s.replace(/[\\/]+$/, '') || s.slice(0, 1); // "/" alone stays "/"
  return s.slice(0, ROOT_PATH_MAX);
}

/** `root` + one folder name, with the separator the path already uses (a Windows path keeps backslashes). Pure. */
export function joinPath(root, name) {
  const r = String(root || '');
  if (!r) return String(name || '');
  const sep = r.includes('\\') || /^[A-Za-z]:/.test(r) ? '\\' : '/';
  return r.endsWith(sep) ? `${r}${name}` : `${r}${sep}${name}`;
}

/** The last folder name in a path ('D:\\Stuff\\Nimrod' -> 'Nimrod'). Pure. */
export const lastName = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || '';

/** Does a typed path end in the chosen folder's name? (The only check a page can make: names, not places.) */
export function pathMatchesRoot(path, rootName) {
  if (!path || !rootName) return true;
  return lastName(path).toLowerCase() === String(rootName).toLowerCase();
}

export function readRootPath(storage = pathStorage()) {
  try { return cleanRootPath(storage?.getItem(ROOT_PATH_KEY) || ''); } catch { return ''; }
}

/** Keep (or with '' forget) the typed path on this device. Resolves to the path as kept. */
export function saveRootPath(raw, storage = pathStorage()) {
  const p = cleanRootPath(raw);
  try { if (p) storage?.setItem(ROOT_PATH_KEY, p); else storage?.removeItem(ROOT_PATH_KEY); } catch { /* storage refused: this visit only */ }
  return p;
}

/** The remembered root and whether it can be used now (`fs_sink.recallFolder`'s honest reading). */
export function recallRoot({ idb } = {}) {
  return recallFolder({ idb, key: ROOT_KEY });
}

/** One of the subfolders (under its earlier name if that is what is there), or null. Never creates anything. */
export async function subfolder(root, kind, { names = SUBFOLDERS, legacy = LEGACY_SUBFOLDERS } = {}) {
  const name = names[kind] || kind;
  return root ? existingSub(root, kind, name, legacy) : null;
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
  const subName = names[kind] || kind;
  const own = await get(kindKey(kind));
  if (own) {
    const permission = await permissionOf(own, KIND_MODE);
    return { kind, source: 'own', permission, name: String(own.name || ''), sub: subName, holder: own, mode: KIND_MODE,
      dir: permission === 'granted' ? own : null, missing: false };
  }
  const root = await get(ROOT_KEY);
  if (!root) return { kind, source: 'none', permission: 'none', name: '', sub: subName, holder: null, mode: ROOT_MODE, dir: null, missing: false };
  const permission = await permissionOf(root, ROOT_MODE);
  const sub = permission === 'granted' ? await subfolder(root, kind, { names }) : null;
  // `sub`: the subfolder's name as it is on disk (an earlier name, LEGACY_SUBFOLDERS, if that is what is there).
  const actual = (sub && sub.name) || subName;
  return { kind, source: 'root', permission, name: `${root.name || ''}/${actual}`, sub: actual, holder: root, mode: ROOT_MODE,
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
