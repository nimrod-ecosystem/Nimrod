// device_pictures.js — PICTURES SOMEBODY ADDED FROM THIS DEVICE, KEPT ON THIS DEVICE.
//
// Mike, 2026-10-02: *"Having the pictures scroll through all your pictures in the settings menu
// isn't a good way to do it. There should be upload or a folder picker."* The folder picker already
// existed (`folder_source.js`). This is the other half: "add a picture from this device" — a file
// input, which works in every browser, including the ones with no folder picker at all (Firefox,
// Safari, most phones).
//
// *** WHERE THE PICTURE GOES, AND WHERE IT DOES NOT. ***
//
// There is no upload to the platform server, and this file has no code that could make one: no
// fetch, no FormData. The file is copied into THIS BROWSER's IndexedDB (`nimrod-pictures`) and read
// back from there. The rule `board_editor.js` used to state as "there is no upload path in the
// client" was about the BYTES LEAVING THE MACHINE, and that part is unchanged: they do not.
// `dev/picture_picker_test.html` counts every fetch made while a picture is added and fails on one.
//
// WHY INDEXEDDB AND NOT THE STORAGE ROOT (`user_folders.js`), argued — this is on Mike's list:
//   FOR the storage root: it is the decided home for the person's files ("One storage root, set up
//     once"), the pictures would be visible in a file manager, and they would survive clearing the
//     browser's site data.
//   AGAINST, and it wins for now: the root needs the folder picker (Chromium only), a root nobody has
//     chosen yet leaves the button doing nothing, and its WRITE permission lapses after a restart
//     until somebody presses something — an unattended screen would lose its pictures at reboot.
//     IndexedDB works everywhere, needs no permission, and never lapses.
//   THE COST, said plainly: clearing this site's data in the browser removes these pictures, and
//     they are on this device only (like a connected folder). The setting keeps only a reference
//     (`{ sourceId: 'device-pictures', path }`), so a picture that has gone shows the words alone,
//     never an error over them.
//
// THE SOURCE. It looks like any other media source (`{ id, label, kind }`) so the picture loader
// and the picker treat it the same, but it is deliberately NOT in `createMediaSourcesClient().list()`:
// that list is what `photos` reads, and adding a source there would change which source a new
// photos panel adopts by itself. `media_sources.sourceById` finds it by id instead.
// (photo sources first, 2026-10-09: UNLESS somebody added pictures here FOR PHOTOS - `devicePhotosOn`, below.)

import { kindOf, isSvgFile, svgDataUrl } from './folder_source.js';

export const DEVICE_SOURCE_ID = 'device-pictures';
export const DEVICE_SOURCE = Object.freeze({
  id: DEVICE_SOURCE_ID, label: 'Added on this device', kind: 'device', local: true,
});
export const isDeviceSource = (s) => !!s && (s.kind === 'device' || s.id === DEVICE_SOURCE_ID);

const DB_NAME = 'nimrod-pictures';
const STORE = 'pictures';

const idbOf = (idb) => idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);

function openDb({ idb, dbName = DB_NAME } = {}) {
  const db = idbOf(idb);
  if (!db) return Promise.reject(new Error('This browser has no storage for pictures.'));
  return new Promise((resolve, reject) => {
    const req = db.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn, opts) {
  const db = await openDb(opts);
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/** Is this file a picture? By its type first, then by its name — the same extensions a folder lists. */
export function isPictureFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  return kindOf(file.name || '') === 'image';
}

// A name that is unique in the store and still reads as the file's own name in a file list. The
// stamp keeps two "IMG_0001.jpg" from different phones apart; `name` keeps what the person saw.
const safeName = (n) => String(n || 'picture').replace(/[\\/]+/g, '_').trim() || 'picture';
const pathFor = (name, now) => `${Number(now()).toString(36)}-${safeName(name)}`;

/**
 * Keep one picture on this device. Resolves `{ sourceId, path, name }` — the reference a setting
 * stores. Refuses anything that is not a picture rather than storing a file nothing can show.
 */
export async function addDevicePicture(file, { idb, dbName, now = () => Date.now() } = {}) {
  if (!isPictureFile(file)) throw new Error('That file is not a picture.');
  const name = safeName(file.name);
  const path = pathFor(name, now);
  await run('readwrite', (s) => s.put({
    path, name, type: file.type || '', size: Number(file.size) || 0, blob: file, added_at: Number(now()),
  }), { idb, dbName });
  return { sourceId: DEVICE_SOURCE_ID, path, name };
}

/** The pictures kept here, by name only, NEWEST FIRST (what somebody just added is what they want). */
export async function listDevicePictures({ idb, dbName } = {}) {
  let rows = [];
  try { rows = (await run('readonly', (s) => s.getAll(), { idb, dbName })) || []; } catch { return []; }
  return rows
    .sort((a, b) => (b.added_at || 0) - (a.added_at || 0))
    .map((r) => ({ path: r.path, name: r.name || r.path, kind: 'image' }));
}

/** One picture as a URL THE CALLER OWNS AND RELEASES (the same contract as `folderFileUrl`). */
export async function devicePictureUrl(path, { idb, dbName } = {}) {
  const row = await run('readonly', (s) => s.get(String(path || '')), { idb, dbName });
  if (!row || !row.blob) {
    const err = new Error(`no picture "${path}" on this device`);
    err.code = 'missing';
    throw err;
  }
  // folder art (2026-10-07): an SVG kept here is handed out the way a folder's is - a data: URL, never a blob: one,
  // so even opened on its own in a tab it runs nothing in this site (folder_source.js, the invariant over IMAGE_EXTS).
  if (isSvgFile(row.blob, row.name || row.path)) return { url: await svgDataUrl(row.blob), release: () => {} };
  const url = URL.createObjectURL(row.blob);
  return { url, release: () => { try { URL.revokeObjectURL(url); } catch { /* gone */ } } };
}

// ------------------------------------------------------------- photo sources first (2026-10-09)
// Mike, 2026-10-09, on the media agent: *"So everyone needs to download software to look at photos?"* No: the
// everyday ways in are a folder on this computer (Chrome/Edge) and PICTURES ADDED FROM THIS DEVICE, which works in
// every browser, phones included. So the pictures kept here can now be a PHOTO SOURCE too, played by a photos panel
// like a folder - but only once somebody asked for that, on the Media tab or a photos panel ("Add pictures from this
// device"). Argued:
//   FOR "always a source when there are pictures here": one less switch.
//   AGAINST, and it wins: a picture added for a button or a talk-board card would then put a SECOND source on the
//     screen, and a photos panel that quietly showed the one folder would start saying "more than one photo source
//     is connected" (photos.js `multiSource`) - a change nobody asked for, the reason this header keeps the source
//     out of the list at all. A per-device switch, set by the press that adds pictures FOR PHOTOS, keeps both.
// Per device (localStorage) because the pictures are per device. Cleared by "Disconnect" on the Media tab; the
// pictures themselves stay (a button may still use one).
export const DEVICE_PHOTOS_KEY = 'nimrod-device-pictures-as-photos';
const storeOf = (s) => s || (typeof localStorage !== 'undefined' ? localStorage : null);

/** Are the pictures added on this device one of the photo sources here? Never throws. */
export function devicePhotosOn({ storage } = {}) {
  try { return storeOf(storage)?.getItem(DEVICE_PHOTOS_KEY) === '1'; } catch { return false; }
}

/** Turn the device's pictures on (or off) as a photo source here. Never throws. */
export function setDevicePhotosOn(on, { storage } = {}) {
  try {
    const s = storeOf(storage);
    if (!s) return;
    if (on) s.setItem(DEVICE_PHOTOS_KEY, '1'); else s.removeItem(DEVICE_PHOTOS_KEY);
  } catch { /* private mode: the pictures are kept, the panel just won't list them */ }
}

/**
 * Keep several pictures (a file input with `multiple`). Resolves `{ added, skipped }`: a file that is not a
 * picture is skipped, not an error, so one stray PDF in a phone's selection does not lose the rest.
 */
export async function addDevicePictures(files, opts = {}) {
  const added = [];
  let skipped = 0;
  let n = 0;
  const base = opts.now || (() => Date.now());
  for (const f of Array.from(files || [])) {
    if (!isPictureFile(f)) { skipped += 1; continue; }
    const k = n++;
    // one stamp per file: two pictures added in the same millisecond must not share a path.
    added.push(await addDevicePicture(f, { ...opts, now: () => Number(base()) + k }));
  }
  return { added, skipped };
}

// Object URLs for the LISTING a photos panel plays, released by the next listing (folder_source.js `revokeFor`,
// the same bookkeeping and the same reason: a screen re-lists for weeks).
let listedUrls = [];

/**
 * The pictures kept here as a LISTING, the shape `media_sources.resolveListing` returns for every source, so the
 * photos panel cannot tell this from a folder. No albums. An SVG is a data: URL (folder_source.js's invariant).
 */
export async function resolveDeviceListing(source = DEVICE_SOURCE, album = '', { idb, dbName } = {}) {
  const rows = (await run('readonly', (s) => s.getAll(), { idb, dbName })) || [];
  const urls = [];
  const items = [];
  for (const r of rows.sort((a, b) => (b.added_at || 0) - (a.added_at || 0))) {
    if (!r || !r.blob) continue;
    let url;
    if (isSvgFile(r.blob, r.name || r.path)) { try { url = await svgDataUrl(r.blob); } catch { continue; } }
    else { url = URL.createObjectURL(r.blob); urls.push(url); }
    items.push({ id: r.path, name: r.name || r.path, path: r.path, kind: 'image', size: Number(r.size) || 0,
      mtime: Math.floor((Number(r.added_at) || 0) / 1000), url, sourceId: (source && source.id) || DEVICE_SOURCE_ID });
  }
  for (const u of listedUrls) { try { URL.revokeObjectURL(u); } catch { /* gone */ } }
  listedUrls = urls;
  return { album: '', albums: [], items, count: items.length };
}

/** Take one away. Used by tests and by anything that later offers "remove this picture". */
export async function removeDevicePicture(path, { idb, dbName } = {}) {
  await run('readwrite', (s) => s.delete(String(path || '')), { idb, dbName });
  return { ok: true };
}
