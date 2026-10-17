// folder_source.js — connect a folder of photos with NO install, using the browser.
//
// WHY: the media agent (web/media_agent/) is right for a DEVICE — a bedside kiosk that
// boots unattended and must serve files with nobody logged in. It is wrong for a PERSON:
// asking someone to install a Python service to look at their own photos is not a product.
// The File System Access API lets the browser itself read a folder the user picks, so a
// laptop needs nothing installed. The privacy story is identical — arguably better, since
// the bytes never even cross localhost.
//
// WHERE THE HANDLE LIVES, and why it is not on the server:
// A FileSystemDirectoryHandle is device-local and grants access to real files. It is not
// JSON, it cannot be meaningfully sent anywhere, and shipping it would violate the one rule
// the platform has (the server never sees media — see ../../DECISIONS.md). So handles live
// in IndexedDB ON THIS DEVICE. The consequence to keep in mind: a folder source connected
// on a laptop does NOT appear on the kiosk, by design. Agent sources are per-user and shared;
// folder sources are per-device. media_sources.js merges the two.
//
// THE KIOSK QUESTION (Mike asked it, and it decides whether an upcycled laptop can be a
// bedside screen): permission normally has to be re-granted by a click after a restart,
// which an unattended kiosk has nobody to give. Chrome can persist it for an INSTALLED app,
// so the intended flow is: install the site, pick the folder once with a human present, and
// let it boot unattended afterwards. That is NOT verified on Pi Chromium, so nothing here
// assumes it — `folderPermission()` reports the truth and the UI is expected to say so
// plainly rather than show an empty screen.

const DB_NAME = 'nimrod-media';
const DB_VERSION = 1;
const STORE = 'folders';

// *** THESE THREE LISTS ARE MIRRORED IN web/media_agent/agent.py, AND A TEST HOLDS THEM EQUAL. ***
// `media_agent/test_agent.py` reads these arrays out of this file and compares them with the
// agent's sets, and both sides check `dev/media_kinds.json` (one table, two languages). A folder
// source and an agent source listing the same folder must give the same kinds, or a song plays
// from one and not the other with nothing anywhere to say why.
// folder art (2026-10-07): svg added, so a drawing made with the art kit (art_kit.js) can be picked from a folder.
// *** THE SECURITY INVARIANT: AN SVG FROM A FOLDER NEVER RUNS ANYTHING IN THIS SITE. *** An .svg can carry
// script. Here it is only ever handed out as a `data:` URL (`svgDataUrl` below), never a `blob:` one: in an <img>
// or a CSS background nothing in it runs or loads, and even opened on its own in a tab a data: document has no
// site of its own, so it cannot reach this page, its storage or its sign-in. A blob: URL would carry THIS site's
// origin into that tab. Drawing one inline (an animated avatar) goes through svg_sanitize.js and nowhere else.
export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'svg'];
export const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v', 'ogv'];
// AUDIO (2026-09-30). Before this a music folder listed as EMPTY: an .mp3 was skipped here, so a
// music favourite pointing at a folder and game music's folder mode found nothing to play.
//   IN:  mp3, m4a, aac, ogg, oga, opus, wav, flac - what Chromium (the kiosk) plays natively, and
//        what people's music folders are actually full of.
//   OUT: webm - it stays VIDEO. It is a container, a listing cannot see inside it, and moving it
//        would pull every video .webm out of the photo slideshow. game_music.js's `isAudioPath`
//        still accepts it by extension, so an audio-only .webm in a music folder still plays.
//        ogv stays video for the same reason (it is the video spelling; .ogg/.oga are audio).
//   OUT: wma, aiff/aif, mid, ape, alac-in-.caf - Chromium will not play them, and listing a file
//        that cannot play only produces an error-and-skip in the player.
// EVERY CONSUMER FILTERS BY KIND. photos.js shows image + video only (see `slideshowItems`);
// adding this kind without that filter would have put songs into the slideshow as broken images.
export const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac'];

// Case-insensitive, like the agent. A past bug hid ~497 uppercase .JPG files behind a
// case-sensitive filter; the same mistake is very easy to repeat here.
const extOf = (name) => {
  // Like Python's os.path.splitext, so the two sides agree on odd names too: leading dots are part
  // of the name, not an extension, and a name with no dot has no extension ("mp3" is not a song).
  const s = String(name).toLowerCase().replace(/^\.+/, '');
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(dot + 1) : '';
};
export const kindOf = (name) => {
  const e = extOf(name);
  if (IMAGE_EXTS.includes(e)) return 'image';
  if (VIDEO_EXTS.includes(e)) return 'video';
  if (AUDIO_EXTS.includes(e)) return 'audio';
  return null;
};

// folder art: is this file an SVG drawing? By name, or by type when the name has no extension.
export const isSvgFile = (file, name = file && file.name) => extOf(name || '') === 'svg'
  || String((file && file.type) || '').toLowerCase().startsWith('image/svg');

/**
 * folder art: an SVG file as a `data:` URL - see the invariant over IMAGE_EXTS. The type is set here, not taken from
 * the file, so an <img> always reads it as a drawing (a file with no type would not show). Nothing to revoke.
 */
export function svgDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('could not read the drawing'));
    r.readAsDataURL(new Blob([file], { type: 'image/svg+xml' }));
  });
}

export function isFolderPickerSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// --- the tiny IndexedDB layer ----------------------------------------------
// Handles are structured-cloneable, which is the only reason this works: localStorage
// (JSON only) could not hold one.
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(store)).then((v) => { out = v; }).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

const reqAsPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// --- the source records -----------------------------------------------------
// Shaped like a registry source so callers cannot tell the difference: {id, label, kind}.
// `base_url` is deliberately absent — there is no URL; that IS the point.
// remove this picture (2026-10-10): `on_remove` ('keep' unless the row says 'remove'), kept on the folder's own row here
// on this device, as an agent source keeps it on the server (media_sources.js ON_REMOVE).
const toSource = (row) => ({ id: row.id, label: row.label, kind: 'folder', local: true,
  on_remove: row.on_remove === 'remove' ? 'remove' : 'keep' });

export async function listFolderSources() {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const rows = await tx('readonly', (s) => reqAsPromise(s.getAll()));
    return (rows || []).map(toSource);
  } catch { return []; }          // private mode / storage disabled — degrade to none
}

async function getRow(id) {
  try { return await tx('readonly', (s) => reqAsPromise(s.get(id))); }
  catch { return null; }
}

// Prompt for a folder and remember it. MUST be called from a user gesture (a click) —
// the browser refuses otherwise, and that refusal is the whole security model.
// `kind` (row 2.49): which of the Nimrod folder's folders the picker opens in - 'pictures' (the default), 'videos' or
// 'music' (user_folders.js startInFor; never prompts, skipped if slow). user_folders.js is loaded here, not at the top:
// it imports fs_sink.js, which a page using only folder sources need not load.
export async function pickFolder(label = '', { kind = 'pictures' } = {}) {
  if (!isFolderPickerSupported()) throw new Error('This browser cannot open a folder directly.');
  let opts = { id: 'nimrod-media', mode: 'read' };
  try { const uf = await import('./user_folders.js'); opts = uf.withStartIn(opts, await uf.startInFor(kind)); } catch { /* where it always opened */ }
  const handle = await window.showDirectoryPicker(opts);
  return addFolderSource(handle, label);
}

/**
 * A folder this device ALREADY HAS a handle for, kept as a folder source with no picker (2026-10-04): the
 * Pictures, Music or Videos folder of the person's Nimrod folder (user_folders.js), or a folder they pointed
 * one of those kinds at. The same row `pickFolder` keeps, so every panel treats it the same. Nothing is copied:
 * a source is a handle, and the files stay where they are.
 */
export async function addFolderSource(handle, label = '') {
  if (!handle) throw new Error('No folder to connect.');
  const id = (crypto.randomUUID && crypto.randomUUID()) || `f${Date.now()}`;
  const row = {
    id,
    label: String(label || '').trim() || handle.name || 'Folder',
    handle,
    created_at: new Date().toISOString(),
  };
  await tx('readwrite', (s) => s.put(row));
  return toSource(row);
}

/**
 * *** "CONNECT A FOLDER", THE NIMROD FOLDER FIRST (row 2.49, the plan's step 2). *** When this device's Nimrod folder
 * (user_folders.js) has its Pictures / Videos / Music folder readable now, that folder IS the source: no picker at
 * all, and the same row `addFolderSource` keeps (one already kept for it is used, never a second). Otherwise the
 * picker, opening there (`pickFolder`'s `kind`). `uf` is a seam for a suite.
 */
export async function connectFolderFor(kind = 'pictures', label = '', { uf = null } = {}) {
  let k = null;
  try { const mod = uf || await import('./user_folders.js'); k = await mod.kindFolder(kind); } catch { k = null; }
  if (k && k.dir) {
    const have = await findFolderSource(k.dir);
    if (have) return have;
    return addFolderSource(k.dir, label || k.dir.name || '');
  }
  return pickFolder(label, { kind });
}

/** The folder source already kept for this very folder (`isSameEntry`), or null. Never throws. */
export async function findFolderSource(handle) {
  if (!handle || typeof indexedDB === 'undefined') return null;
  let rows = [];
  try { rows = (await tx('readonly', (s) => reqAsPromise(s.getAll()))) || []; } catch { return null; }
  for (const row of rows) {
    try { if (row.handle && await row.handle.isSameEntry(handle)) return toSource(row); } catch { /* a stale handle */ }
  }
  return null;
}

export async function removeFolderSource(id) {
  await tx('readwrite', (s) => s.delete(id));
  revokeFor(id);
  return { ok: true };
}

// 'granted' | 'prompt' | 'denied' | 'missing'
// `missing` means the handle is gone from storage entirely (cleared site data), which is a
// different problem from a revoked permission and should be said differently.
export async function folderPermission(id) {
  const row = await getRow(id);
  if (!row || !row.handle) return 'missing';
  try { return await row.handle.queryPermission({ mode: 'read' }); }
  catch { return 'prompt'; }
}

// Re-ask. Also needs a user gesture, which is exactly why an unattended kiosk cannot
// recover on its own once permission lapses.
export async function requestFolderAccess(id) {
  const row = await getRow(id);
  if (!row || !row.handle) return 'missing';
  try { return await row.handle.requestPermission({ mode: 'read' }); }
  catch { return 'denied'; }
}

// ------------------------------------------------------------------ REMOVE THIS PICTURE (2026-10-10)
// A folder is opened READ-ONLY (`pickFolder`, mode 'read'), and stays that way unless somebody chooses otherwise. For a
// folder source set to "remove it here too", moving a removed picture into its Removed folder needs the browser's
// permission to CHANGE the folder. *** IT IS NEVER ASKED FOR BY ITSELF. *** `folderWritePermission` only looks (a query
// never shows a prompt); `requestFolderWrite` asks, and is called only from a press on "Allow removing here" (media.js),
// so a screen nobody can answer never shows the browser's question. Without the permission a removed picture still
// leaves every slideshow (the list); the move waits until it is given, and the panel's follow-up does it then.

/** 'keep' or 'remove' for a folder source, kept on its row here. Resolves the source, or null when it is not here. */
export async function setFolderOnRemove(id, value) {
  const v = value === 'remove' ? 'remove' : 'keep';
  const row = await getRow(id);
  if (!row) return null;
  const next = { ...row, on_remove: v };
  await tx('readwrite', (s) => s.put(next));
  return toSource(next);
}

/** 'granted' | 'prompt' | 'denied' | 'missing' for CHANGING the folder. Never asks. */
export async function folderWritePermission(id) {
  const row = await getRow(id);
  if (!row || !row.handle) return 'missing';
  try { return await row.handle.queryPermission({ mode: 'readwrite' }); }
  catch { return 'prompt'; }
}

/** ASKS for permission to change the folder. Call it only from a press (the browser refuses otherwise, rightly). */
export async function requestFolderWrite(id) {
  const row = await getRow(id);
  if (!row || !row.handle) return 'missing';
  try { return await row.handle.requestPermission({ mode: 'readwrite' }); }
  catch { return 'denied'; }
}

export const REMOVED_DIR = '.nimrod-removed';
export const REMOVED_LIST_FILE = 'removed-paths.txt';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** A picture's path as parts, or null: the agent's rules (agent.py removal_parts) - no '.', '..', dot parts, breaks. */
export function removalParts(path) {
  const s = String(path || '');
  if (!s || s.length > 1024 || /[\n\r\t\0\\]/.test(s)) return null;
  const parts = s.split('/').filter((p) => p !== '');
  if (!parts.length || parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return null;
  return kindOf(parts[parts.length - 1]) ? parts : null;
}
async function dirAt(root, parts, create = false) {
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function fileIn(dir, name) {
  try { return await dir.getFileHandle(name); } catch { return null; }
}
async function readList(rdir) {
  const fh = await fileIn(rdir, REMOVED_LIST_FILE);
  if (!fh) return [];
  try { return (await (await fh.getFile()).text()).split(/\r?\n/).filter((l) => l.trim()); } catch { return []; }
}
async function writeList(rdir, lines) {
  const fh = await rdir.getFileHandle(REMOVED_LIST_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(lines.map((l) => `${l}\n`).join(''));
  await w.close();
}
// A MOVE: the browser's own move where it has one; else a copy, and the original taken out only once the copy is
// written - the net effect is the same move, and the picture is never without a copy.
async function moveFile(fromDir, name, toDir, toName) {
  const fh = await fromDir.getFileHandle(name);
  if (typeof fh.move === 'function') { await fh.move(toDir, toName); return; }
  const out = await toDir.getFileHandle(toName, { create: true });
  const w = await out.createWritable();
  await w.write(await fh.getFile());
  await w.close();
  await fromDir.removeEntry(name);
}

/**
 * Move a picture of folder source `id` into <folder>/.nimrod-removed/<day>/<path>, and list it in removed-paths.txt
 * (as the agent does). Resolves { done } - 'moved', 'not-here' (listed all the same), 'asks' (no permission to change
 * the folder: nothing asked, nothing moved), 'missing', 'bad' or 'failed'. Never asks for permission.
 */
export async function moveFolderPicture(id, path, { day = today(), handleFor = null } = {}) {
  const parts = removalParts(path);
  if (!parts) return { done: 'bad' };
  const row = handleFor ? { handle: await handleFor(id) } : await getRow(id);
  const root = row && row.handle;
  if (!root) return { done: 'missing' };
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch { perm = 'prompt'; }
  if (perm !== 'granted') return { done: 'asks' };
  try {
    const rdir = await root.getDirectoryHandle(REMOVED_DIR, { create: true });
    const key = parts.join('/');
    const listed = await readList(rdir);
    let from = null;
    try { from = await dirAt(root, parts.slice(0, -1)); } catch { from = null; }
    const name = parts[parts.length - 1];
    if (!from || !(await fileIn(from, name))) {
      if (!listed.includes(key)) await writeList(rdir, [...listed, key]);
      return { done: 'not-here' };
    }
    let dest = null;
    for (let n = 1; n < 1000 && !dest; n += 1) {
      const folder = n === 1 ? day : `${day}-${n}`;
      let d = null;
      try { d = await dirAt(rdir, [folder, ...parts.slice(0, -1)]); } catch { d = null; }
      if (!d || !(await fileIn(d, name))) dest = folder;
    }
    if (!dest) return { done: 'failed' };
    const to = await dirAt(rdir, [dest, ...parts.slice(0, -1)], true);
    await moveFile(from, name, to, name);
    if (!listed.includes(key)) await writeList(rdir, [...listed, key]);
    return { done: 'moved', folder: dest };
  } catch (err) {
    console.error('folder source: moving a removed picture', err);
    return { done: 'failed' };
  }
}

/** "Bring it back" for folder source `id`: the newest removed copy goes back, never over a picture already there. */
export async function restoreFolderPicture(id, path, { handleFor = null } = {}) {
  const parts = removalParts(path);
  if (!parts) return { done: 'bad' };
  const row = handleFor ? { handle: await handleFor(id) } : await getRow(id);
  const root = row && row.handle;
  if (!root) return { done: 'missing' };
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'readwrite' }); } catch { perm = 'prompt'; }
  if (perm !== 'granted') return { done: 'asks' };
  try {
    let rdir = null;
    try { rdir = await root.getDirectoryHandle(REMOVED_DIR); } catch { return { done: 'not-removed' }; }
    const key = parts.join('/');
    const name = parts[parts.length - 1];
    const listed = await readList(rdir);
    const unlist = async () => { if (listed.includes(key)) await writeList(rdir, listed.filter((l) => l !== key)); };
    const days = [];
    for await (const [n, h] of rdir.entries()) if (h.kind === 'directory' && /^\d{4}-\d{2}-\d{2}(-\d{1,4})?$/.test(n)) days.push(n);
    days.sort((a, b) => (a.slice(0, 10) === b.slice(0, 10)
      ? (Number(b.slice(11) || 1) - Number(a.slice(11) || 1)) : (a < b ? 1 : -1)));
    let found = null;
    for (const d of days) {
      let dir = null;
      try { dir = await dirAt(rdir, [d, ...parts.slice(0, -1)]); } catch { dir = null; }
      if (dir && await fileIn(dir, name)) { found = dir; break; }
    }
    const back = await dirAt(root, parts.slice(0, -1), true);
    if (await fileIn(back, name)) { await unlist(); return { done: 'already' }; }
    if (!found) { await unlist(); return { done: listed.includes(key) ? 'emptied' : 'not-removed' }; }
    await moveFile(found, name, back, name);
    await unlist();
    return { done: 'back' };
  } catch (err) {
    console.error('folder source: bringing a removed picture back', err);
    return { done: 'failed' };
  }
}

// --- object URL bookkeeping -------------------------------------------------
// Each item needs a URL the <img>/<video> can use, and every one holds a reference until
// revoked. A bedside screen re-lists whenever the source or album changes and then runs for
// weeks, so without this the handles would pile up. Keyed by source: producing a new listing
// for a source releases the previous one.
const urlsBySource = new Map();

function revokeFor(sourceId) {
  const urls = urlsBySource.get(sourceId);
  if (!urls) return;
  for (const u of urls) { try { URL.revokeObjectURL(u); } catch { /* already gone */ } }
  urlsBySource.delete(sourceId);
}

// --- the resolver -----------------------------------------------------------
// Returns the SAME shape as media_sources.resolveListing so photos.js cannot tell which
// kind of source it is holding: {album, albums, items:[{id,name,path,kind,size,mtime,url,
// sourceId}], count}. `album` is one level deep, matching the agent's ?album=<sub>.
// *** THE FAILURES CARRY A CODE, NOT JUST A SENTENCE. ***
//
// These used to be plain Errors with a message, and the only caller could not tell them apart —
// so `photos.js` reported every one of them as *"Source X unreachable"*, which describes a dead
// network agent. A folder needing one click and a media agent that has stopped answering are
// completely different problems with completely different repairs, and a person reading the
// wrong one goes and checks their wifi.
//
//   'permission'  the handle is there, the grant lapsed. One click fixes it.
//   'missing'     the handle is gone from storage entirely (site data cleared). Reconnect it.
//   'album'       the sub-folder named by `album` is not there any more.
export function folderError(code, message, sourceId) {
  const err = new Error(message);
  err.code = code;
  err.sourceId = sourceId;
  return err;
}

/**
 * One file out of a folder source, as a URL THE CALLER OWNS AND RELEASES.
 *
 * *** WHY THIS EXISTS RATHER THAN "just use the url off the listing". ***
 *
 * `resolveFolderListing` calls `revokeFor(source.id)` on every run: the newest listing of a
 * source invalidates the previous one's object URLs. That is right for a slideshow, which only
 * ever wants the current listing — and it is fatal for an AAC card, which holds ONE picture for
 * weeks while other parts of the screen keep listing the same folder. The card's image would go
 * blank the moment anything else looked at that folder, silently, with no error anywhere.
 *
 * A board is somebody's voice. A picture that disappears because a photo panel refreshed is the
 * kind of failure nobody would ever trace. So a card gets its own URL out of its own read, kept
 * out of `urlsBySource` entirely, and releases it when the card goes away.
 */
export async function folderFileUrl(sourceId, path) {
  const row = await getRow(sourceId);
  if (!row || !row.handle) throw folderError('missing', 'that folder is no longer stored', sourceId);
  const perm = await row.handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') {
    throw folderError('permission', `that folder's permission is "${perm}"`, sourceId);
  }
  return fileUrlIn(row.handle, path, sourceId);
}

/**
 * The half of `folderFileUrl` that only needs a directory handle — split out (2026-10-02) so the
 * shared picture picker can be tested against an in-memory folder, with no IndexedDB row behind it.
 */
export async function fileUrlIn(root, path, sourceId = '') {
  const parts = String(path || '').split('/').filter(Boolean);
  const name = parts.pop();
  let dir = root;
  for (const part of parts) {
    try { dir = await dir.getDirectoryHandle(part); }
    catch { throw folderError('album', `no folder "${part}"`, sourceId); }
  }
  let file;
  try { file = await (await dir.getFileHandle(name)).getFile(); }
  catch { throw folderError('album', `no file "${path}"`, sourceId); }
  if (isSvgFile(file, name)) return { url: await svgDataUrl(file), release: () => {} };   // folder art
  const url = URL.createObjectURL(file);
  return { url, release: () => { try { URL.revokeObjectURL(url); } catch { /* gone */ } } };
}

/**
 * THE NAMES IN A FOLDER, AND NOTHING ELSE — no files read, no object URLs made.
 *
 * Added 2026-09-28 for `modules/button.js`, whose picture setting offers "which picture" as a
 * list. It must NOT call `resolveFolderListing` to get that list: every run of that function
 * revokes the previous listing's URLs for the same folder, so a settings row asking "what is in
 * this folder?" would blank a photo panel showing the same folder on the same screen. This reads
 * the directory the same way and stops before touching a single file.
 *
 * Returns `[{ path, name, kind }]`, sorted by name, same `album` rules and same coded failures.
 */
export async function listFolderNames(source, album = '') {
  return (await listFolderEntries(source, album)).items;
}

/**
 * The same reading, plus the SUB-FOLDERS at that level (2026-10-02, for the shared picture picker,
 * which lets somebody open a sub-folder the way the board editor's picker always did). Returns
 * `{ items: [{ path, name, kind }], albums: [name] }`; same coded failures.
 */
export async function listFolderEntries(source, album = '') {
  const row = await getRow(source.id);
  if (!row || !row.handle) {
    throw folderError('missing', `folder source "${source.label}": no longer stored`, source.id);
  }
  const perm = await row.handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') {
    throw folderError('permission',
      `folder source "${source.label}": permission is "${perm}"`, source.id);
  }
  return entriesIn(row.handle, album, source);
}

/** The directory walk on its own, over any handle — what the picker's suite runs on a fake folder. */
export async function entriesIn(root, album = '', source = { id: '', label: '' }) {
  let dir = root;
  for (const part of String(album || '').split('/').filter(Boolean)) {
    try { dir = await dir.getDirectoryHandle(part); }
    catch { throw folderError('album', `folder source "${source.label}": no album "${album}"`, source.id); }
  }
  const items = [];
  const albums = [];
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (entry.kind === 'directory') { albums.push(album ? `${album}/${name}` : name); continue; }
    const k = kindOf(name);
    if (!k) continue;
    items.push({ path: album ? `${album}/${name}` : name, name, kind: k });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  albums.sort();
  return { items, albums };
}

// ------------------------------------------------------------------ every folder inside (2026-10-10, row 2.78)
// The browser's half of the media agent's `/list?deep=1` (agent.py "EVERY FOLDER INSIDE" argues each number): the
// pictures in a folder AND in every folder inside it, paths relative to the folder source's own top, so a picture's
// id, plays and hidden-picture key are its path wherever it sits.
// *** MIRRORED FROM web/media_agent/agent.py, AND test_agent.py HOLDS THEM EQUAL. ***
//   items 20 000 · folders 5 000 · depth 8 · ms 10 000 (half the panel's 20 s wait for a listing).
// SKIPPED, as the agent does: a name starting with "." (.nimrod-pull, .nimrod-removed), the drive's own folders below
// (a recycle bin holds DELETED pictures), and the folders on the panel's leave-out list. A browser folder has no
// symlinks to follow out of it (the browser does not hand them over), so the depth and folder caps are what stop a
// tree that never ends.
export const DEEP_LIMITS = Object.freeze({ items: 20000, folders: 5000, depth: 8, ms: 10000 });
export const SKIP_FOLDER_NAMES = Object.freeze(['$recycle.bin', 'system volume information', 'lost+found', 'recycler']);

/** A folder path relative to a source's top, tidied for comparing ('' for one that climbs or is not text). Pure. */
export function cleanFolderPath(p) {
  if (typeof p !== 'string') return '';
  const s = p.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
  if (!s || s.length > 1024 || s.split('/').some((x) => x === '' || x === '.' || x === '..')) return '';
  return s;
}

/**
 * WALK `album` AND EVERY FOLDER INSIDE IT, over any directory handle (the suites hand in a fake one, or the
 * browser's own private folder). Breadth first, each folder in name order, so a walk cut short has the shallow
 * folders whole. Returns `{ files: [{ path, name, kind, entry }], folders: [path], truncated }` - `truncated` is ''
 * or why it stopped ('items' | 'folders' | 'depth' | 'time'). Reads no file: `entry` is the file's handle.
 */
export async function walkFolder(dir, album = '', { leaveOut = [], limits = DEEP_LIMITS, now = () => Date.now() } = {}) {
  const lim = { ...DEEP_LIMITS, ...(limits || {}) };
  const out = new Set((Array.isArray(leaveOut) ? leaveOut : []).map(cleanFolderPath).filter(Boolean));
  const start = now();
  const queue = [{ dir, rel: String(album || '').replace(/^\/+|\/+$/g, ''), depth: 0 }];
  const files = [];
  const folders = [];
  let truncated = '';
  for (let head = 0; head < queue.length; head += 1) {
    const { dir: here, rel: at, depth } = queue[head];
    const entries = [];
    try { for await (const [name, entry] of here.entries()) entries.push([name, entry]); }
    catch { continue; }   // a folder that cannot be read is passed over; the rest still lists
    entries.sort((a, b) => (a[0].toLowerCase() < b[0].toLowerCase() ? -1 : a[0].toLowerCase() > b[0].toLowerCase() ? 1 : 0));
    let full = false;
    for (const [name, entry] of entries) {
      if (name.startsWith('.')) continue;
      const rel = at ? `${at}/${name}` : name;
      if (entry.kind === 'directory') {
        if (SKIP_FOLDER_NAMES.includes(name.toLowerCase()) || out.has(rel)) continue;
        if (depth + 1 > lim.depth) { truncated = truncated || 'depth'; continue; }
        if (folders.length >= lim.folders) { truncated = truncated || 'folders'; continue; }
        folders.push(rel);
        queue.push({ dir: entry, rel, depth: depth + 1 });
        continue;
      }
      const k = kindOf(name);
      if (!k) continue;
      if (files.length >= lim.items) { truncated = 'items'; full = true; break; }
      files.push({ path: rel, name, kind: k, entry });
    }
    if (full) break;
    if (now() - start > lim.ms && head + 1 < queue.length) { truncated = 'time'; break; }
  }
  const byPath = (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
  files.sort((a, b) => byPath(a.path, b.path));
  folders.sort(byPath);
  return { files, folders, truncated };
}

// `opts` (every folder inside): `{ deep, leaveOut }` - deep lists every folder inside `album` too, leaving out the
// folders named (relative to the source's top). Without it, exactly what it always listed.
export async function resolveFolderListing(source, album = '', opts = {}) {
  const row = await getRow(source.id);
  if (!row || !row.handle) {
    throw folderError('missing', `folder source "${source.label}": no longer stored`, source.id);
  }

  const perm = await row.handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted') {
    // Deliberately an error, not an empty list: "you need to allow access again" and
    // "this folder is empty" must never look the same to the person setting it up.
    throw folderError('permission',
      `folder source "${source.label}": permission is "${perm}"`, source.id);
  }

  let dir = row.handle;
  if (album) {
    for (const part of String(album).split('/').filter(Boolean)) {
      // CODED like the two above. `getDirectoryHandle` throws a bare NotFoundError, which the
      // panel would otherwise report as the source being unreachable — sending somebody to
      // check a network when an album was renamed.
      try {
        dir = await dir.getDirectoryHandle(part);
      } catch {
        throw folderError('album',
          `folder source "${source.label}": no album "${album}"`, source.id);
      }
    }
  }

  const albums = [];
  const items = [];
  const urls = [];
  // One file as a listing item (folder art: an SVG is a data: URL - the invariant over IMAGE_EXTS); null when it
  // cannot be read, and it is skipped.
  const itemOf = async (entry, name, path, k) => {
    let file;
    try { file = await entry.getFile(); } catch { return null; }
    let url;
    if (isSvgFile(file, name)) { try { url = await svgDataUrl(file); } catch { return null; } }
    else { url = URL.createObjectURL(file); urls.push(url); }
    return {
      id: path,                                       // stable across sessions: rng.js keys play-stats on it
      name,
      path,
      kind: k,
      size: file.size,
      mtime: Math.floor(file.lastModified / 1000),
      url,
      sourceId: source.id,
    };
  };

  // every folder inside: the walk, then the files read a batch at a time (FILE_BATCH, argued below).
  if (opts && opts.deep) {
    const walked = await walkFolder(dir, album, { leaveOut: opts.leaveOut, limits: opts.limits, now: opts.now });
    for (const f of walked.folders) if (!f.slice(album ? album.length + 1 : 0).includes('/')) albums.push(f.split('/').pop());
    for (let i = 0; i < walked.files.length; i += FILE_BATCH) {
      const got = await Promise.all(walked.files.slice(i, i + FILE_BATCH).map((f) => itemOf(f.entry, f.name, f.path, f.kind)));
      for (const it of got) if (it) items.push(it);
    }
    albums.sort();
    revokeFor(source.id);
    urlsBySource.set(source.id, urls);
    return { album, albums, items, count: items.length, deep: true, folders: walked.folders, truncated: walked.truncated };
  }

  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue;               // dotfiles, like the agent
    if (entry.kind === 'directory') { albums.push(name); continue; }
    const k = kindOf(name);
    if (!k) continue;                                 // not media — the agent skips these too
    const it = await itemOf(entry, name, album ? `${album}/${name}` : name, k);
    if (it) items.push(it);
  }

  albums.sort();
  items.sort((a, b) => a.name.localeCompare(b.name));

  revokeFor(source.id);                               // release the previous listing's URLs
  urlsBySource.set(source.id, urls);

  return { album, albums, items, count: items.length };
}

// every folder inside: how many files are read at once. 64, argued: one at a time is a wait per file - measured
// 2026-10-10 in dev/media_sources_test.html on a 57 x 50 folder (headless Chrome, a desktop SSD): walk + read every file
// 0.86-0.99 s at 64, 1.5-2.0 s one at a time (the walk alone ~0.4 s). All 2 850 at once asks the disk for every file in
// the same moment, and on a slow drive the panel's first picture waits behind the last. A batch keeps the disk busy
// without that.
const FILE_BATCH = 64;
