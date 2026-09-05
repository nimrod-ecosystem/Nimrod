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

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'];
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'm4v', 'ogv'];

// Case-insensitive, like the agent. A past bug hid ~497 uppercase .JPG files behind a
// case-sensitive filter; the same mistake is very easy to repeat here.
const extOf = (name) => String(name).toLowerCase().split('.').pop();
export const kindOf = (name) => {
  const e = extOf(name);
  if (IMAGE_EXTS.includes(e)) return 'image';
  if (VIDEO_EXTS.includes(e)) return 'video';
  return null;
};

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
const toSource = (row) => ({ id: row.id, label: row.label, kind: 'folder', local: true });

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
export async function pickFolder(label = '') {
  if (!isFolderPickerSupported()) throw new Error('This browser cannot open a folder directly.');
  const handle = await window.showDirectoryPicker({ id: 'nimrod-media', mode: 'read' });
  const id = (crypto.randomUUID && crypto.randomUUID()) || `f${Date.now()}`;
  const row = {
    id,
    label: label.trim() || handle.name || 'Folder',
    handle,
    created_at: new Date().toISOString(),
  };
  await tx('readwrite', (s) => s.put(row));
  return toSource(row);
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

export async function resolveFolderListing(source, album = '') {
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
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue;               // dotfiles, like the agent
    if (entry.kind === 'directory') { albums.push(name); continue; }
    const k = kindOf(name);
    if (!k) continue;                                 // not media — the agent skips these too
    const file = await entry.getFile();
    const url = URL.createObjectURL(file);
    urls.push(url);
    const path = album ? `${album}/${name}` : name;
    items.push({
      id: path,                                       // stable across sessions: rng.js keys play-stats on it
      name,
      path,
      kind: k,
      size: file.size,
      mtime: Math.floor(file.lastModified / 1000),
      url,
      sourceId: source.id,
    });
  }

  albums.sort();
  items.sort((a, b) => a.name.localeCompare(b.name));

  revokeFor(source.id);                               // release the previous listing's URLs
  urlsBySource.set(source.id, urls);

  return { album, albums, items, count: items.length };
}
