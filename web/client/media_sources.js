// media_sources.js — the per-user media-source registry client + the resolver.
//
// TWO halves, both deliberately thin:
//
//  1. REGISTRY client — talks to the platform (/api/media-sources): list / add /
//     remove the folders a user has connected. This is tiny per-user text (a label
//     + a base_url + a kind); it is ALL the platform ever stores about media.
//
//  2. RESOLVER — given a source and an album, fetches the agent's /list and turns
//     each item into a renderable absolute URL. The listing and the bytes come
//     STRAIGHT from the user's media agent at `base_url`; the platform server is
//     never in that path. This is the client half of "the server never sees the
//     bytes" (see ../../DECISIONS.md, web/media_agent/README.md).
//
// A photos module holds a reference {sourceId, album}; it looks the source up in
// the registry, calls resolveListing(), and feeds the item ids to the shared
// picker (rng.js). The item `id` == its path, stable across sessions, so the
// picker's play-stats key on it correctly.

import { cachedFetch } from './cache.js';
import { authHeaders, httpError } from './auth.js';
import { listFolderSources, removeFolderSource, resolveFolderListing,
         folderFileUrl, listFolderEntries, cleanFolderPath, DEEP_LIMITS } from './folder_source.js';
import { DEVICE_SOURCE, DEVICE_SOURCE_ID, listDevicePictures, devicePictureUrl,
         devicePhotosOn, setDevicePhotosOn, resolveDeviceListing } from './device_pictures.js';

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

// Build the absolute media URL for an item on a source: base_url + /files/<path>,
// with each path SEGMENT encoded but the slashes preserved (so "trip 2019/a b.jpg"
// works). The agent serves relative paths precisely so this stays client-side —
// base_url is the user's runtime config, never in the repo.
export function mediaUrl(baseUrl, path) {
  const enc = String(path).split('/').map(encodeURIComponent).join('/');
  return `${trimSlash(baseUrl)}/files/${enc}`;
}

// --- Registry client (platform API) ----------------------------------------
// `personId` SCOPES THE REGISTRY TO ONE PERSON'S SCREENS: their own sources plus the
// account-wide ones. Absent, the client sees everything the account owns, which is the
// management view - and which is what every existing caller gets, unchanged.
//
// WHY IT MATTERS ON A SCREEN RATHER THAN IN AN ADMIN PANEL: an account with one person never
// notices this exists. An account with several - a family, a facility, a clinician with a
// caseload - needs each resident's albums to be THEIRS rather than a merged pile of four
// families.
//
// THAT IS AN ORGANIZATION WIN, NOT A SECRECY ONE, and the distinction is worth keeping: the
// therapists in her room already see whatever is on her screen, so nothing here is protecting
// her from them. What it protects is the SCREEN being about the right person. The real
// boundary between people who did not choose each other is across ACCOUNTS, which `user_id`
// already enforced, and any finer-grained "who may see whose media" belongs on the grants
// table beside "who may drive" rather than in a column here.
// photo sources first (2026-10-09): `devicePhotos` (a seam, default `devicePhotosOn`) - whether the pictures added on
// this device are one of the photo sources here (device_pictures.js argues why that is a press, not automatic).
export function createMediaSourcesClient({ user, base = '', cache = false, personId = null,
  devicePhotos = devicePhotosOn, setDevicePhotos = setDevicePhotosOn } = {}) {
  const scope = personId ? `?person_id=${encodeURIComponent(personId)}` : '';
  async function fetchList() {
    const res = await fetch(`${base}/api/media-sources${scope}`, { headers: authHeaders(user) });
    if (!res.ok) throw httpError(res, `GET /api/media-sources -> ${res.status}`);
    return (await res.json()).sources;
  }
  // `cache:true` opts into offline resilience: the registry (which folder → which
  // base_url) survives a coordination-server outage, so photos/personal can still
  // resolve media from the LOCAL agent. The agent's own /list is already local.
  // Two kinds of source, merged here so no consumer has to know the difference:
  //   * `agent`  — registered on the platform, shared across this user's devices.
  //   * `folder` — a browser folder handle, stored in IndexedDB on THIS DEVICE only
  //                (folder_source.js explains why it cannot be sent to the server).
  // The merge happens AFTER the cached fetch on purpose — folding device-local rows into
  // the cached server payload would write them into the offline mirror as if the server
  // had sent them, and they would then appear on devices that never had the folder.
  async function list() {
    // A failing registry call must NOT hide device-local folders. Two cases where it
    // otherwise would: the coordination server is unreachable (the offline-resilience
    // case this project cares about), and the demo page, where nobody is signed in and
    // /api/media-sources is a 401 by design. Folders live on the device and are still
    // perfectly usable in both.
    let remote = [];
    try {
      remote = (cache
        // THE CACHE KEY CARRIES THE PERSON. Without it, two people's screens on one machine
        // would share one offline mirror, and whichever loaded first would decide what the
        // other saw the next time the server was unreachable - which is the privacy bug this
        // whole column exists to prevent, arriving through the back door.
        ? await cachedFetch(`media-sources:${user || 'anon'}:${personId || 'all'}`, fetchList)
        : await fetchList()) || [];
    } catch (err) {
      console.warn('media-sources: registry unavailable, using device-local folders only', err);
    }
    const local = await listFolderSources();
    // photo sources first: the device's own pictures, LAST, and only once somebody added them for photos.
    const device = devicePhotos() ? [DEVICE_SOURCE] : [];
    const all = [...remote, ...local, ...device];
    noteListed(personId, all);   // backup source: what the screen's "Backup folder" row offers
    return all;
  }
  // Adding from a person's screen files the source under that person by default, which is
  // what somebody standing at a bedside means. Pass `person_id: null` explicitly to make one
  // account-wide from such a screen.
  async function add({ label, base_url, kind = 'agent', person_id = personId }) {
    const res = await fetch(`${base}/api/media-sources`, {
      method: 'POST',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, base_url, kind, person_id: person_id || null }),
    });
    if (!res.ok) throw httpError(res, `POST /api/media-sources -> ${res.status}`);
    return res.json();
  }

  // Move a source between "the account's" and "one person's". BOTH DIRECTIONS: narrowing is
  // the privacy fix, widening is the commoner mistake - a family folder set up on one screen
  // that everybody then wants, and which without this is stuck there.
  async function moveTo(id, person_id) {
    const res = await fetch(`${base}/api/media-sources/${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(user), 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: person_id || null }),
    });
    if (!res.ok) throw httpError(res, `PATCH /api/media-sources/${id} -> ${res.status}`);
    return res.json();
  }
  // A folder source only exists on this device, so it is removed from IndexedDB — asking
  // the platform to delete an id it has never seen would just 404.
  async function remove(id) {
    // photo sources first: "Disconnect" on the device's pictures stops listing them as photos; the pictures stay
    // (a button or a card may still show one), the way a disconnected folder's files stay.
    if (id === DEVICE_SOURCE_ID) { setDevicePhotos(false); return { ok: true }; }
    const local = await listFolderSources();
    if (local.some((s) => s.id === id)) return removeFolderSource(id);
    const res = await fetch(`${base}/api/media-sources/${id}`, {
      method: 'DELETE', headers: authHeaders(user),
    });
    if (!res.ok) throw httpError(res, `DELETE /api/media-sources/${id} -> ${res.status}`);
    return res.json();
  }
  return { list, add, remove, moveTo, personId: () => personId || null };
}

// --- Resolver (talks to the user's media agent, NOT the platform) ----------
// Fetch a source's listing for `album` and attach an absolute `url` + `sourceId`
// to each item. `fetchImpl` is injectable for tests. Throws on a dead/erroring
// agent so the caller can show "source unreachable" rather than a blank wall.
// every folder inside (2026-10-10, row 2.78): `deep` lists every folder inside `album` too, and `leaveOut` names the
// folders (relative to the source's top) left out of that - see "EVERY FOLDER INSIDE" below. Both off/empty: exactly
// the listing this always made.
export async function resolveListing(source, album = '', { fetchImpl = fetch, deep = false, leaveOut = [] } = {}) {
  // A folder source has no base_url to fetch — the browser reads the files directly.
  // Same return shape, so photos.js and personal.js are unchanged.
  const out = deep ? cleanLeaveOut(leaveOut) : [];
  if (source && source.kind === 'folder') {
    return deep ? resolveFolderListing(source, album, { deep: true, leaveOut: out }) : resolveFolderListing(source, album);
  }
  if (source && source.kind === 'device') return resolveDeviceListing(source, album);   // photo sources first (flat)
  const base = trimSlash(source.base_url);
  const q = listQuery(album, deep, out);
  const res = await fetchImpl(`${base}/list${q}`);
  if (!res.ok) throw httpError(res, `media source "${source.label}": /list -> ${res.status}`);
  const body = await res.json();
  // The page's own filter as well as the agent's: the folders a long list could not fit in the address, and an older
  // agent that does not know `skip` (it does not know `deep` either, so it lists one level, as it always did).
  const items = applyLeaveOut(body.items || [], out, album).map((it) => ({
    ...it,
    sourceId: source.id,
    url: mediaUrl(base, it.path),
  }));
  const listing = { album: body.album || album, albums: body.albums || [], items, count: items.length };
  if (deep && body.deep) Object.assign(listing, { deep: true, folders: Array.isArray(body.folders) ? body.folders.map(String) : [], truncated: String(body.truncated || '') });
  return listing;
}

// ------------------------------------------------------------------------- EVERY FOLDER INSIDE (2026-10-10, row 2.78)
// Mike: "Could I just link her pictures folder as the drive from my computer and it would pull from all the folders
// inside it?" Before this, no: a source listed one folder (the media agent's list_album, folder_source.js's one-level
// read), and Photos showed its top or one album - for a Pictures folder of 57 dated folders, "No photos".
//
// TWO SETTINGS ON EACH PANEL THAT PLAYS FROM A SOURCE, beside "Photos from" and "Album", not on the source itself.
// ARGUED (Rule 2):
//   FOR THE SOURCE: it is how Mike put it - "link her pictures folder"; set once, every panel on it would follow.
//   FOR THE PANEL (chosen): the album - which part of the source - already lives on the panel, and these two are the
//     same kind of choice; a wallpaper on "Backgrounds" and a slideshow of everything can share one source; and a
//     source is stored in two places (an agent's on the server, a browser folder's in this browser only), so a source
//     setting is a server change plus a second store for one switch. AGAINST: a second photos panel on the same
//     source sets its leave-out list again (`copyFromSibling` copies both into a new photos panel, so only a panel
//     made by hand on another screen starts empty).
//   "Include every folder inside" (`subfolders`): ON by default for pictures, videos and music. AGAINST: a panel
//     whose source holds other things in its folders (a scanned-papers folder inside Pictures) now shows them, and a
//     panel that showed a folder's top shows everything under it after this update. FOR: a folder of pictures is
//     what people point at, and one sorted into dated folders showed nothing at all; "Leave out" is one press away.
//   "Leave out" (`leaveOut`): folders PER SOURCE - `{ <sourceId>: ['2019-taxes', 'Screenshots'] }` - so a stand-in
//     or a backup never loses a folder that happens to share a name, and choosing another source and coming back
//     keeps the list. Panel STATE (text), never media.
// HARD-CODED, argued: LEAVE_OUT_MAX 200 folders per source (a list longer than that is the wrong folder chosen -
// choose an album instead); FOLDER_ROWS_MAX 60 rows of folders in the settings menu (Mike's 57 dated folders fit;
// past that, the menu is a scroll nobody with one switch should walk, and the rest are listed by count).
export const SUBFOLDERS_KEY = 'subfolders';
export const LEAVE_OUT_KEY = 'leaveOut';
export const LEAVE_OUT_MAX = 200;
export const FOLDER_ROWS_MAX = 60;
// The longest address a deep listing asks for; folders that do not fit are left out by the page instead (above).
const LIST_QUERY_MAX = 6000;

function listQuery(album, deep, leaveOut) {
  const parts = [];
  if (album) parts.push(`album=${encodeURIComponent(album)}`);
  if (deep) {
    parts.push('deep=1');
    let len = parts.join('&').length;
    for (const f of leaveOut) {
      const p = `skip=${encodeURIComponent(f)}`;
      if (len + p.length + 1 > LIST_QUERY_MAX) break;
      parts.push(p);
      len += p.length + 1;
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** A leave-out list tidied: folder paths ('/' separators, no '..'), no repeats, at most LEAVE_OUT_MAX. Pure. */
export function cleanLeaveOut(list) {
  const out = [];
  for (const raw of (Array.isArray(list) ? list : [])) {
    const c = cleanFolderPath(raw);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= LEAVE_OUT_MAX) break;
  }
  return out;
}

/** The stored `leaveOut` setting tidied to `{ <sourceId>: [folder, ...] }` (anything else: empty). Pure. */
export function normalizeLeaveOut(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [sid, list] of Object.entries(raw)) {
    const c = cleanLeaveOut(list);
    if (sid && c.length) out[sid] = c;
  }
  return out;
}

/**
 * Items without the ones in a left-out folder. A folder applies when it is INSIDE what was listed (`album`): an album
 * that is itself on the list, or inside a folder on it, still lists - the album chosen wins, as the agent does. Pure.
 */
export function applyLeaveOut(items, leaveOut, album = '') {
  const a = String(album || '').replace(/^\/+|\/+$/g, '');
  const folders = cleanLeaveOut(leaveOut).filter((f) => !a || f.startsWith(`${a}/`));
  const list = Array.isArray(items) ? items : [];
  if (!folders.length) return list;
  return list.filter((it) => {
    const p = String((it && (it.path || it.id)) || '');
    return !folders.some((f) => p.startsWith(`${f}/`));
  });
}

/** What a panel's two settings mean for one source: `{ deep, leaveOut }` for `resolveListing`. Pure. */
export function listOptions(cfg, sourceId, { subfoldersDefault = true } = {}) {
  const v = cfg ? cfg[SUBFOLDERS_KEY] : undefined;
  const deep = v === undefined || v === null || v === '' ? !!subfoldersDefault : (v === true || v === 'true' || v === 1);
  const map = normalizeLeaveOut(cfg ? cfg[LEAVE_OUT_KEY] : null);
  return { deep, leaveOut: deep && sourceId && map[sourceId] ? map[sourceId] : [] };
}

/** A lister that lists with a panel's settings: `resolve(source, album, optsFor(source))`. */
export function withListOptions(resolve, optsFor) {
  return (source, album) => resolve(source, album, (typeof optsFor === 'function' ? optsFor(source) : optsFor) || {});
}

/** The `leaveOut` setting with `folder` put on (or taken off) `sourceId`'s list - what a panel writes. Pure. */
export function toggleLeaveOut(raw, sourceId, folder, leave = null) {
  const map = normalizeLeaveOut(raw);
  const f = cleanFolderPath(folder);
  if (!sourceId || !f) return map;
  const list = map[sourceId] ? map[sourceId].slice() : [];
  const at = list.indexOf(f);
  const want = leave === null ? at < 0 : !!leave;
  if (want && at < 0 && list.length < LEAVE_OUT_MAX) list.push(f);
  if (!want && at >= 0) list.splice(at, 1);
  if (list.length) map[sourceId] = list; else delete map[sourceId];
  return map;
}

/**
 * THE DECLARED ROW: "Include every folder inside". `what` names the panel's things ('pictures', 'videos', 'songs').
 * Level 'standard' by default, beside the source row: it decides what the panel shows, which somebody setting one up
 * should see. Photos passes 'advanced' (photos.js argues it: the one-switch lap of the critical panel).
 */
export function subfoldersField({ on = true, what = 'pictures', appliesWhen = null, label = 'Include every folder inside',
  level = 'standard' } = {}) {
  return { key: SUBFOLDERS_KEY, label, kind: 'toggle', default: !!on, level,
    onLabel: `Yes: the ${what} in its folders too`, offLabel: `No: only the ${what} at its top`,
    ...(appliesWhen ? { appliesWhen } : {}) };
}

/**
 * THE PANEL'S OWN "LEAVE OUT" ROWS (kiosk.js `menuItems`), from the last listing of the chosen source. One row that
 * opens the folders ("Folders inside: 57 · 2 left out"), then - open - one row per folder, the left-out ones first
 * ("Put back 2019-taxes"), then the rest ("Leave out 2019-07-04 · 50 pictures"), a folder inside a left-out one not
 * shown (it is already out). Empty when the setting is off, or nothing has been listed from the chosen source.
 *   listing   the chosen source's listing ({ folders, items }), album the panel's album, cfg the panel's settings
 *   open      whether the folders are showing; onOpen(bool) to change it (the panel keeps it, not saved)
 *   onSet(map) writes the new `leaveOut` setting
 */
export function leaveOutRows({ idPrefix = 'leave', listing = null, album = '', sourceId = '', cfg = {}, open = false,
  onOpen = () => {}, onSet = () => {}, what = 'pictures', subfoldersDefault = true } = {}) {
  const { deep } = listOptions(cfg, sourceId, { subfoldersDefault });
  if (!deep || !sourceId || !listing || !listing.deep) return [];
  const left = normalizeLeaveOut(cfg[LEAVE_OUT_KEY])[sourceId] || [];
  const a = String(album || '').replace(/^\/+|\/+$/g, '');
  const within = (f) => !a || f.startsWith(`${a}/`);
  const leftHere = left.filter(within);
  const inLeft = (f) => leftHere.some((l) => f === l || f.startsWith(`${l}/`));
  const folders = (Array.isArray(listing.folders) ? listing.folders : []).map(String).filter((f) => within(f) && !inLeft(f))
    .sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0));
  if (!folders.length && !leftHere.length) return [];
  // Each item counts toward every folder it sits in: its path's own prefixes, so a big listing costs its items times
  // their depth, never items times folders (the menu paints synchronously).
  const counts = {};
  const known = new Set(folders);
  for (const it of (listing.items || [])) {
    const parts = String(it.path || '').split('/');
    for (let i = 1; i < parts.length; i += 1) {
      const f = parts.slice(0, i).join('/');
      if (known.has(f)) counts[f] = (counts[f] || 0) + 1;
    }
  }
  const shown = (f) => (a ? f.slice(a.length + 1) : f).split('/').join(' / ');
  const rows = [{ kind: 'item', id: `${idPrefix}-folders`,
    label: open ? 'Hide the folders inside' : 'Folders inside: choose any to leave out',
    hint: `${folders.length + leftHere.length} folder${folders.length + leftHere.length === 1 ? '' : 's'}`
      + `${leftHere.length ? ` · ${leftHere.length} left out` : ' · none left out'}`,
    run: () => onOpen(!open) }];
  if (!open) return rows;
  for (const f of leftHere) {
    rows.push({ kind: 'item', id: `${idPrefix}-back:${f}`, label: `Put back ${shown(f)}`,
      hint: `left out: its ${what} are not shown`, run: () => onSet(toggleLeaveOut(cfg[LEAVE_OUT_KEY], sourceId, f, false)) });
  }
  const room = Math.max(0, FOLDER_ROWS_MAX - leftHere.length);
  for (const f of folders.slice(0, room)) {
    const n = counts[f] || 0;
    rows.push({ kind: 'item', id: `${idPrefix}-out:${f}`, label: `Leave out ${shown(f)}`,
      hint: `${n} ${n === 1 ? what.replace(/s$/, '') : what}`, run: () => onSet(toggleLeaveOut(cfg[LEAVE_OUT_KEY], sourceId, f, true)) });
  }
  if (folders.length > room) {
    rows.push({ kind: 'item', id: `${idPrefix}-more`, label: `${folders.length - room} more folders are not listed here`,
      hint: 'choose a folder inside as the Album to see its folders', disabled: true, run: () => {} });
  }
  return rows;
}

// ------------------------------------------------------------------------------ CHOOSING THE ALBUM (2026-10-10)
// Found 2026-10-10: the Photos panel's "Album" row was read-only and said "set in Media / Sources" - and Media /
// Sources has no album chooser; only a dev address (?photoAlbum=) ever set one. So the album is chosen where it lives,
// on the panel, from the source's own folders: "Album: The whole source / <each folder at its top> ...".
//
// THE ROW IS A CHOICE, built from listings the panel already makes (the settings menu paints synchronously):
//   * "The whole source" (''), then each folder at the source's top, in name order;
//   * the album chosen now, and the folders directly inside it, right under its top folder - so a press on a folder
//     inside goes one level down, and its parent (also listed) one level back up;
//   * a chosen album the source does not have stays on the list, last-but-named ("<name> — not in this source"), so the
//     row is never a dead id and one press repairs it (settings_fields.js stepValue).
// Long lists open as a list (settings_fields.js PICKER_OVER); "Step through (for a switch)" steps them, as every choice.
// WHERE THE TOP FOLDERS COME FROM: the listing of the whole source, when that is what the panel shows; when an album is
// chosen, ONE quiet listing of the source's top (never one that would make the browser ask: quietResolve), once per
// source per panel. A browser folder is read for names only (listFolderEntries): a full listing of it would replace
// the picture addresses the slideshow is showing (folder_source.js revokeFor).
// HARD-CODED, argued (Rule 1): ALBUM_CHOICES_MAX 200 options. Mike's Pictures folder has 57; past a couple of hundred
// the list is the wrong folder chosen as the source, and a menu row that builds thousands of options paints slowly on
// a Pi. The chosen album and its own folders are always on the list, whatever the cap leaves out.
export const ALBUM_KEY = 'album';
export const ALBUM_WHOLE_LABEL = 'The whole source';
export const ALBUM_CHOICES_MAX = 200;

/**
 * THE DECLARED ROW: "Album". A choice whose live options come from `albumChoices` (each panel's `settingsChoices`).
 * Declared with the one option every source has, so a panel not mounted still reads as "The whole source".
 * `key` / `label` for a panel whose album row has its own name: the press game's "Music folder" (`musicAlbum`, beside
 * its "Music from"), which said "set in Media / Sources" for the same reason Photos' did (found 2026-10-10).
 */
export function albumField({ level = 'standard', appliesWhen = null, key = ALBUM_KEY, label = 'Album' } = {}) {
  return { key, label, kind: 'choice', default: '', level, emptyLabel: ALBUM_WHOLE_LABEL,
    options: [{ value: '', label: ALBUM_WHOLE_LABEL }], ...(appliesWhen ? { appliesWhen } : {}) };
}

const byName = (x, y) => { const a = x.toLowerCase(), b = y.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; };

/** The folders at the top of a listing of the whole source, by name. Pure. */
export function topFoldersOf(listing) {
  if (!listing) return [];
  const raw = listing.deep && Array.isArray(listing.folders)
    ? listing.folders.map(String).filter((f) => f && !f.includes('/'))
    : (Array.isArray(listing.albums) ? listing.albums.map(String) : []);
  return [...new Set(raw.map(cleanFolderPath).filter((f) => f && !f.includes('/')))].sort(byName);
}

/**
 * The folders DIRECTLY inside `album`, from a listing of that album, as paths from the source's top. An agent names
 * them from the top ('Trips/Paris'), a browser folder by name ('Paris'); both come out the same. Pure.
 */
export function foldersInside(listing, album) {
  const a = cleanFolderPath(album);
  if (!listing || !a) return [];
  const raw = listing.deep && Array.isArray(listing.folders)
    ? listing.folders.map(String)
    : (Array.isArray(listing.albums) ? listing.albums.map(String).map((f) => (f.startsWith(`${a}/`) ? f : `${a}/${f}`)) : []);
  return [...new Set(raw.map(cleanFolderPath).filter((f) => f.startsWith(`${a}/`) && !f.slice(a.length + 1).includes('/')))]
    .sort(byName);
}

/**
 * THE ROW'S OPTIONS (above). `top` the folders at the source's top (null: not known yet); `inside` the folders directly
 * inside the chosen album. Returns `{ options, note }`: `note` says why there is nothing to choose, when there is not
 * (the row is then not a stop, and says so). Pure.
 */
export function albumChoices({ album = '', top = null, inside = [], max = ALBUM_CHOICES_MAX } = {}) {
  const a = String(album || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const clean = cleanFolderPath(a);
  const shown = (f) => f.split('/').join(' / ');
  const tops = Array.isArray(top) ? top.map(cleanFolderPath).filter((f) => f && !f.includes('/')) : [];
  const chain = clean ? clean.split('/').map((_, i, p) => p.slice(0, i + 1).join('/')) : [];
  const kids = clean ? (inside || []).map(cleanFolderPath).filter((f) => f.startsWith(`${clean}/`)) : [];
  // Is the chosen album missing from the source? Only said when the top is known and its top folder is not there.
  const missing = !!a && (!clean || (Array.isArray(top) && !tops.includes(chain[0])));
  const keep = new Set([...chain, ...kids]);
  const order = [];
  for (const t of tops) {
    order.push(t);
    if (!missing && chain.length && t === chain[0]) order.push(...chain.slice(1), ...kids);
  }
  if (!missing && chain.length && !tops.includes(chain[0])) order.push(...chain, ...kids);   // the top not known yet
  const seen = new Set(['']);
  const opts = [{ value: '', label: ALBUM_WHOLE_LABEL }];
  const room = Math.max(1, Number(max) || ALBUM_CHOICES_MAX);
  let extra = 0;
  for (const f of order) {
    if (seen.has(f)) continue;
    if (opts.length >= room && !keep.has(f)) { extra += 1; continue; }
    seen.add(f);
    opts.push({ value: f, label: shown(f) });
  }
  if (missing) opts.push({ value: a, label: `${clean ? shown(clean) : a} — not in this source` });
  let note = null;
  if (opts.length < 2) note = Array.isArray(top) ? 'no folders inside this source' : 'its folders show once it has been listed';
  else if (extra) note = `${extra} more folders are not listed`;
  return { options: opts, note };
}

/**
 * ONE PANEL'S ALBUM CHOICES: it hears each listing of its chosen source (`heard`) and answers the row (`row`). `listTop`
 * (source) -> top folder names is asked only when the panel shows an album and the top of that source is not known.
 * `topFoldersLister` below is the production one.
 */
export function createAlbumChooser({ listTop = null } = {}) {
  let top = null;        // { sourceId, folders }
  let last = null;       // { sourceId, album, listing }
  let asking = null;     // the source whose top is being asked for
  return {
    heard(source, album, listing) {
      if (!source || !source.id) return;
      const a = cleanFolderPath(String(album || ''));
      if (listing) last = { sourceId: source.id, album: a, listing };
      if (!a) { if (listing) top = { sourceId: source.id, folders: topFoldersOf(listing) }; return; }
      if ((top && top.sourceId === source.id) || asking === source.id || typeof listTop !== 'function') return;
      const sid = source.id;
      asking = sid;
      Promise.resolve().then(() => listTop(source)).then((folders) => {
        if (asking === sid) top = { sourceId: sid, folders: topFoldersOf({ albums: Array.isArray(folders) ? folders : [] }) };
      }, () => {}).then(() => { if (asking === sid) asking = null; });
    },
    row(sourceId, album) {
      const a = cleanFolderPath(String(album || ''));
      const t = top && top.sourceId === sourceId ? top.folders : null;
      const l = last && last.sourceId === sourceId && last.album === a ? last.listing : null;
      return albumChoices({ album, top: t, inside: foldersInside(l, a) });
    },
    known: () => ({ top: top ? { ...top, folders: top.folders.slice() } : null, asking }),
  };
}

/**
 * The top folders of a source, never making the browser ask (quietResolve): a media agent's one-level listing, a browser
 * folder's names (listFolderEntries, which leaves the slideshow's picture addresses alone), nothing for this device's
 * pictures. `resolve` is a panel's injected lister (the suites'), used for every kind when given.
 */
export function topFoldersLister({ resolve = null, check = null } = {}) {
  return async (source) => {
    if (!source || source.kind === 'device') return [];
    if (source.kind === 'folder' && !resolve) return topFoldersOf(await listFolderEntries(source, ''));
    return topFoldersOf(await quietResolve(resolve || resolveListing, { check })(source, ''));
  };
}

/** The words after "N items" when a listing stopped early ('' when it did not). Plain text. */
export function truncatedWords(listing) {
  const why = listing && listing.truncated;
  if (!why) return '';
  if (why === 'time') return ' (all it could list in time: the folder is very big)';
  if (why === 'depth') return ` (folders more than ${DEEP_LIMITS.depth} deep inside are not included)`;
  return ' (the first part only: the folder is very big — choose an album, or leave folders out)';
}

/**
 * WHAT IS ON A SOURCE, BY NAME ONLY — for something that offers a choice of one file (the
 * `button` module's picture) rather than playing them all. Returns `[{ path, name, kind }]`.
 *
 * For a FOLDER it deliberately does not go through `resolveListing`: that makes an object URL for
 * every file and revokes the previous listing's, which would blank a photo panel showing the same
 * folder (see `listFolderNames`). For an agent, `/list` already is names only.
 */
export async function listItemNames(source, album = '', { fetchImpl = fetch } = {}) {
  return (await listPictureEntries(source, album, { fetchImpl })).items;
}

/**
 * The same, plus the SUB-FOLDERS ("albums") at that level: `{ items, albums }`. Added 2026-10-02
 * for the shared picture picker (`picture_picker.js`), which opens a sub-folder the way the board
 * editor's own picker did. One request for an agent (its `/list` already carries both).
 * A `device` source (`device_pictures.js`, pictures added from this device) has no sub-folders.
 */
export async function listPictureEntries(source, album = '', { fetchImpl = fetch } = {}) {
  if (!source) return { items: [], albums: [] };
  if (source.kind === 'folder') return listFolderEntries(source, album);
  if (source.kind === 'device') return { items: await listDevicePictures(), albums: [] };
  const base = trimSlash(source.base_url);
  const q = album ? `?album=${encodeURIComponent(album)}` : '';
  const res = await fetchImpl(`${base}/list${q}`);
  if (!res.ok) throw httpError(res, `media source "${source.label}": /list -> ${res.status}`);
  const body = await res.json();
  const items = (body.items || []).map((it) => ({
    path: it.path, name: it.name || String(it.path || '').split('/').pop(), kind: it.kind,
  })).filter((it) => it.path);
  return { items, albums: Array.isArray(body.albums) ? body.albums.map(String) : [] };
}

/**
 * THE SOURCE A STORED REFERENCE NAMES, out of a listed registry — or the pictures added on this
 * device, which are deliberately NOT in that list (`device_pictures.js` says why: `photos` reads the
 * list, and an extra source would change which one a new photos panel adopts). Every picture
 * loader looks its source up through this, so a picture added from this device shows everywhere a
 * picture from a folder does: a button, an avatar, a board card.
 */
export function sourceById(list, id) {
  const hit = (Array.isArray(list) ? list : []).find((s) => s && s.id === id);
  if (hit) return hit;
  return id === DEVICE_SOURCE_ID ? DEVICE_SOURCE : null;
}

/**
 * ONE item on a source, as a renderable URL — for anything holding a single file rather than
 * playing a listing. An AAC card is the case that needed it: it keeps one picture for weeks.
 *
 * Returns `{url, release}`. `release` is a no-op for an agent source (an https URL owns nothing)
 * and revokes the object URL for a folder — so a caller can treat both the same and simply call
 * it when the thing holding the picture goes away. See `folderFileUrl` for why a folder card
 * cannot just reuse a URL off `resolveListing`.
 */
export async function resolveItemUrl(source, path) {
  if (!source || !path) return null;
  if (source.kind === 'folder') return folderFileUrl(source.id, path);
  if (source.kind === 'device') return devicePictureUrl(path);
  return { url: mediaUrl(source.base_url, path), release: () => {} };
}

// Liveness probe for a source — used by a Sources UI to show connected/unreachable.
// Never throws; returns {ok:false,...} on any failure.
export async function sourceHealth(source, { fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${trimSlash(source.base_url)}/health`);
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    return { ok: !!body.ok, ...body };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ------------------------------------------------- a source should degrade, not stop
// (MIKE_CHANGE_LIST §3e, Mike 2026-09-08: "If a chosen source can't be reached and an equivalent one
// can, use it and say so somewhere visible. If none can, show something rather than nothing.")
//
// Photos and personal videos both resolved a chosen `sourceId` and stopped there: an agent that was
// down at boot, or a source taken out of the registry, left the panel saying so to nobody. These are
// the shared half -- which other sources may stand in, and the try-in-order -- so the two panels
// cannot disagree about whose sources are fair game. What a panel SAYS and what it keeps is its own.

/**
 * HOW LONG A PANEL WAITS FOR A SOURCE'S LISTING BEFORE TRYING ANOTHER: 20 seconds. Argued:
 *   - A refused or dead agent fails at once; this only bites a request that HANGS, which on facility
 *     wifi happens (the same reason person_known.js has a wait at all).
 *   - The same figure personal.js already gives a big clip to start over that wifi (`stallMs`), so a
 *     listing is not held to a stricter standard than the clips it lists.
 *   - Shorter risks giving up on a slow-but-working agent with a large folder; that costs little,
 *     because the chosen source is asked again every SOURCE_RECHECK_MS and taken back when it answers.
 *   - Longer is that much longer looking at "Loading" when something else could be showing.
 * A seam (`ctx.listingWaitMs`) for tests; 0 means wait however long.
 */
export const LISTING_WAIT_MS = 20000;

/**
 * HOW OFTEN A PANEL SHOWING A STAND-IN ASKS WHETHER ITS CHOSEN SOURCE IS BACK: every 60 seconds.
 * One listing request to one source. Shorter is more requests at a source that is down (a /list of
 * a big folder is not free); longer keeps the stand-in on screen that much after the chosen one is
 * back. A minute is well inside how long anybody would notice. Seam: `ctx.sourceRecheckMs`.
 */
export const SOURCE_RECHECK_MS = 60000;

/**
 * HOW MANY PICTURES (OR CLIPS) IN A ROW MAY FAIL TO LOAD BEFORE THE SOURCE IS TREATED AS DOWN: 3.
 * A source can die AFTER it listed (an agent stopped, a drive unplugged): the listing in hand still
 * names files, and every one of them fails. Argued:
 *   - One failure is a bad file: it is skipped quietly and the slideshow carries on.
 *   - Two in a row can still be two bad files side by side in a folder.
 *   - Three in a row from one source, with the flash-limit backoff between them (about 0.3 s, 2 s,
 *     4 s), is a source that has stopped serving -- caught in seconds, and any one good file in
 *     between resets the count, so a folder with scattered broken files never trips it.
 *   - More only lengthens the stretch spent on failures before the panel does something about it.
 * Then the panel does what a source that fails at load does: a stand-in, the last pictures, or says so.
 * A seam (`ctx.downAfterFailures`); 0 turns it off (the backoff tests use that).
 */
export const DOWN_AFTER_FAILURES = 3;

/**
 * Does this item actually load? For the recheck of a source whose FILES stopped loading: its listing
 * answering proves nothing, so one picture (or a clip's metadata) is fetched for real. Never rejects.
 */
export function mediaLoads(item, { waitMs = LISTING_WAIT_MS, setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id) } = {}) {
  return new Promise((done) => {
    if (!item || !item.url || typeof document === 'undefined') { done(false); return; }
    const video = item.kind === 'video';
    const el = document.createElement(video ? 'video' : 'img');
    let finished = false;
    let t = null;
    const end = (ok) => {
      if (finished) return;
      finished = true;
      if (t != null) clearTimer(t);
      done(ok);
    };
    el.addEventListener(video ? 'loadedmetadata' : 'load', () => end(true), { once: true });
    el.addEventListener('error', () => end(false), { once: true });
    if (Number(waitMs) > 0) t = setTimer(() => end(false), Number(waitMs));
    if (video) { el.muted = true; el.preload = 'metadata'; }
    el.src = item.url;
  });
}

const ownerOf = (s) => (s && s.person_id) || null;

/**
 * THE SOURCES THAT MAY STAND IN FOR `chosenId`, in the order to try them: the person's own other
 * sources first, then the account-wide ones (no person). NEVER ANOTHER RESIDENT'S: a source filed
 * under a different person is left out, and so is EVERY person's source when whose screen this is
 * is not known (`personId` null) -- the list a screen gets after its person lookup timed out is the
 * whole account's, and "the only other one there" may be somebody else's photographs.
 * A device-local folder carries no person; it is this device's, and counts as account-wide.
 */
export function fallbackSources(sources, { chosenId = null, personId = null } = {}) {
  const list = (Array.isArray(sources) ? sources : []).filter((s) => s && s.id && s.id !== chosenId);
  const own = personId ? list.filter((s) => ownerOf(s) === personId) : [];
  const shared = list.filter((s) => ownerOf(s) === null);
  return [...own, ...shared];
}

/** True when a source may be shown on this person's screen at all (own, or account-wide). */
export function mayShowSource(source, personId = null) {
  const o = ownerOf(source);
  return o === null || (!!personId && o === personId);
}

/**
 * The words for a panel showing something other than what it was set to. Plain text: escape it
 * before it goes into markup. `shownLabel` null means "the last pictures" (photos keeps those).
 */
export function degradedLine({ shownLabel = null, chosenLabel = null, err = null, backup = false, verb = 'Showing' } = {}) {
  // backup source (2026-10-08): a backup somebody CHOSE says it is the backup ("Showing the backup: ..."); the
  // automatic stand-in keeps its old words, so a screen nobody has set up reads exactly as it did.
  const shown = shownLabel ? `${backup ? 'the backup: ' : ''}“${shownLabel}”` : 'the last pictures';
  const chosen = chosenLabel ? `“${chosenLabel}”` : 'the chosen source';
  // photo source (2026-10-08, the bench's Pictures screen): 'gone' -- the chosen id is not in this screen's list at all
  // -- used to say "can't be reached", which sent a helper to check the media agent and the network. The usual cause
  // is a folder connected in ANOTHER browser (a folder lives in one browser only), or a source removed or moved to
  // another person. Nothing there is unreachable; it is not connected here, and the words now say that.
  const why = err && err.code === 'permission' ? 'needs permission again'
    : err && err.code === 'album' ? 'doesn’t have that album'
      : err && (err.code === 'gone' || err.code === 'not-connected') ? 'isn’t connected here'   // backup source: music's word too
        : err && err.code === 'unplayable' ? 'wouldn’t play'                                   // backup source: music
          : err && err.code === 'elsewhere' ? 'is on another computer'                         // desktop prompt (quietReach)
            : 'can’t be reached';
  // backup source: `verb` - music is "Playing", a picture "Showing".
  return `${verb === 'Playing' ? 'Playing' : 'Showing'} ${shown} — ${chosen} ${why}.`;
}

function codedError(code, message) { const e = new Error(message); e.code = code; return e; }

/**
 * One listing, given at most `waitMs` to answer. Resolves `{ ok, listing, items }` or `{ ok:false, err }`
 * (err.code 'timeout' when the wait ran out). Never rejects. A listing that lands after the wait is
 * dropped here -- the recheck asks again.
 */
export function listingWithin(resolve, source, album, { accept = (l) => (l && l.items) || [], waitMs = LISTING_WAIT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  return new Promise((done) => {
    let finished = false;
    const t = Number(waitMs) > 0 ? setTimer(() => {
      if (finished) return;
      finished = true;
      done({ ok: false, err: codedError('timeout', `media source "${source && source.label}": no answer in ${waitMs} ms`) });
    }, Number(waitMs)) : null;
    Promise.resolve().then(() => resolve(source, album)).then(
      (listing) => ({ ok: true, listing, items: accept(listing) || [] }),
      (err) => ({ ok: false, err: err || codedError('unreachable', 'listing failed') }),
    ).then((r) => {
      if (finished) return;
      finished = true;
      if (t != null) clearTimer(t);
      done(r);
    });
  });
}

/**
 * THE CHOSEN SOURCE, OR THE BEST STAND-IN. `chosen` is the source row (null when the chosen id is no
 * longer in the list -- removed, or moved to another person); `chosenId` the id the panel was set to.
 *   - The chosen one answers: it is used, EVEN WITH NOTHING IN IT (reachable and empty is a fact about
 *     the folder, not a failure -- the panel says "no photos" as it always did).
 *   - It does not: each stand-in (fallbackSources) is tried in order, with the panel's album and
 *     then without it, and the first with something to show wins.
 * Returns `{ source, listing, items, album, fellBack, failure }`; `source` null means nothing from
 * any source could be shown. NOTHING HERE SAVES ANYTHING: a stand-in is never written back as the
 * chosen source -- the caller shows it and goes back when the chosen one returns.
 */
// backup source (2026-10-08): `backup` is the panel's "If this can't be reached, use" in force (`backupChoice`):
// BACKUP_ANY (the default, and what every caller got before) tries the stand-ins above; BACKUP_NONE tries none; a
// source id tries that one source only. `byChoice` in the result is true when the source shown is a chosen backup.
export async function listOrFallback({ sources, chosen = null, chosenId = null, album = '', personId = null,
  resolve, accept, waitMs = LISTING_WAIT_MS, setTimer, clearTimer, skip = null, backup = BACKUP_ANY } = {}) {
  const opts = { accept, waitMs, ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}) };
  const cid = (chosen && chosen.id) || chosenId || null;
  // `skip`: sources whose FILES stopped loading mid-slideshow (DOWN_AFTER_FAILURES). Their listing may
  // well still answer, so they are not asked; they count as failed until a recheck loads one for real.
  const skipped = (s) => !!(skip && s && (typeof skip.has === 'function' ? skip.has(s.id) : skip.includes?.(s.id)));
  let failure;
  if (chosen && skipped(chosen)) {
    failure = codedError('loading', `media source "${chosen.label}": its files stopped loading`);
  } else if (chosen) {
    const r = await listingWithin(resolve, chosen, album, opts);
    if (r.ok) return { source: chosen, listing: r.listing, items: r.items, album, fellBack: false, failure: null };
    failure = r.err;
  } else {
    failure = codedError('gone', 'the chosen source is not in the list');
  }
  const byChoice = isChosenBackup(backup);
  for (const s of backupSources(sources, { choice: backup, chosenId: cid, personId })) {
    if (skipped(s)) continue;
    for (const a of (album ? [album, ''] : [''])) {
      const r = await listingWithin(resolve, s, a, opts);
      if (r.ok && r.items.length) return { source: s, listing: r.listing, items: r.items, album: a, fellBack: true, failure, byChoice };
    }
  }
  return { source: null, listing: null, items: [], album, fellBack: false, failure, byChoice: false };
}

// ------------------------------------------------------------------------- backup source (2026-10-08)
// Mike, 2026-10-08, on the bench's Photos panel showing the bench's own folder while its chosen source was not there:
// *"I think we wanted it like this as a backup folder. We should make backup folder options for everything, so people
// could always have a local fallback."* So the stand-in is now a CHOICE, the same one on every panel that plays from a
// source (Photos, Personal videos, Music's folder favourites, Wallpaper), plus one for the whole screen:
//
//   a panel's row "If this can't be reached, use" (key BACKUP_KEY, level advanced)
//       ''            THE DEFAULT: as This screen says (the screen's row below)
//       BACKUP_ANY    any other source this screen may show: the person's own, then the account's (`fallbackSources`)
//       BACKUP_NONE   nothing
//       <source id>   that source, and only that one
//   the screen's row "Backup folder for this screen" (the same key, on the screen's own settings, This screen tab)
//       ''            THE DEFAULT: each panel's own default (`panelDefault`, below)
//       the rest      as above, for every panel on the screen that has not chosen its own
//
// THE DEFAULTS, ARGUED. Nothing changes for a screen nobody sets up: a panel's own default is what it did before -
// Photos and Personal videos BACKUP_ANY (their stand-in since 2026-10-02, §3e), Music and Wallpaper BACKUP_NONE (music
// said "not connected"; a wallpaper falls to its built-in moving colours, and its own header argues that an unrelated
// photo folder appearing in it would be the bigger surprise). AGAINST "the first local folder on this screen" as the
// default everywhere (what Mike's words suggest): it would start a folder of somebody's photographs playing as a
// wallpaper, and a song nobody asked for in place of "the Beatles", on screens where nobody chose that. One row on the
// screen, set once, gives every panel that local fallback.
// A CHOSEN BACKUP REPLACES THE AUTOMATIC STAND-IN rather than coming before it: somebody who names one folder has said
// which; trying every other source after it would put back what they chose instead of. AGAINST: more tries, fewer
// blank panels - BACKUP_ANY is one press away for anybody who wants that. Photos still keeps "the last pictures seen"
// after any of these: those are the panel's own pictures, not another source.
// NOTHING IS SAVED BY FALLING BACK, and the main source is asked again every SOURCE_RECHECK_MS and taken back when it
// answers - the same rule the stand-in always had.
export const BACKUP_KEY = 'backupSource';
export const BACKUP_FOLLOW = '';
export const BACKUP_ANY = 'any';
export const BACKUP_NONE = 'none';
const isChosenBackup = (c) => !!c && c !== BACKUP_ANY && c !== BACKUP_NONE;

/** The backup in force: the panel's own choice, else the screen's, else the panel's default. PURE. */
export function backupChoice({ panel = BACKUP_FOLLOW, screen = BACKUP_FOLLOW, panelDefault = BACKUP_NONE } = {}) {
  const p = String(panel == null ? '' : panel);
  if (p) return p;
  const s = String(screen == null ? '' : screen);
  if (s) return s;
  return panelDefault === BACKUP_ANY ? BACKUP_ANY : BACKUP_NONE;
}

/**
 * The sources to try, in order, when the main one fails. PURE. A chosen source is tried only when this screen may
 * show it (`mayShowSource`: never another resident's, whatever the row says) and it is not the main source itself.
 */
export function backupSources(sources, { choice = BACKUP_ANY, chosenId = null, personId = null } = {}) {
  if (choice === BACKUP_NONE) return [];
  if (!choice || choice === BACKUP_ANY) return fallbackSources(sources, { chosenId, personId });
  if (choice === chosenId) return [];
  const hit = (Array.isArray(sources) ? sources : []).find((s) => s && s.id === choice);
  return hit && mayShowSource(hit, personId) ? [hit] : [];
}

// The sources each panel last listed, per person (`createMediaSourcesClient` records them), so the SCREEN's row can
// offer them: the settings menu paints synchronously and cannot go and ask. In memory, this page only.
const listedBy = new Map();
export function noteListed(personId, list) {
  try { listedBy.set(personId || '', (Array.isArray(list) ? list : []).filter((s) => s && s.id).map((s) => ({ ...s }))); }
  catch { /* only the screen row's choices; never load-bearing */ }
}
/** What this page has seen listed for this person (or, unknown, the account's), never another resident's source. */
export function listedSources(personId = null) {
  const own = listedBy.get(personId || '');
  const list = own || (personId ? listedBy.get('') : null) || [];
  return list.filter((s) => mayShowSource(s, personId));
}
/** For the suites: forget what was listed. */
export function forgetListedForTest() { listedBy.clear(); }

const isLocalSource = (s) => !!s && (s.kind === 'folder' || s.kind === 'device'   // photo sources first: device too
  || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(s.base_url || '')));
const sourceWords = (s) => `${s.label || s.base_url || s.id}${isLocalSource(s) && s.kind !== 'device' ? ' (on this computer)' : ''}`;

/** The words for a backup choice, for a row's "as This screen says (...)" and the screen row. PURE. */
export function backupWords(choice, sources = [], { panelDefaultWords = 'each part’s own choice' } = {}) {
  const c = String(choice == null ? '' : choice);
  if (!c) return panelDefaultWords;
  if (c === BACKUP_ANY) return 'any other source this screen can see';
  if (c === BACKUP_NONE) return 'nothing';
  const s = (Array.isArray(sources) ? sources : []).find((x) => x && x.id === c);
  return s ? `“${s.label || s.base_url || s.id}”` : 'a source not connected here';
}

// The choices in the order a person reads them: what is ON THIS COMPUTER first (Mike's "local fallback"), then the rest.
function sourceChoices(sources, { exclude = null, personId = null } = {}) {
  const ok = (Array.isArray(sources) ? sources : []).filter((s) => s && s.id && s.id !== exclude && mayShowSource(s, personId));
  return [...ok.filter(isLocalSource), ...ok.filter((s) => !isLocalSource(s))]
    .map((s) => ({ value: s.id, label: sourceWords(s) }));
}

/**
 * THE PANEL ROW, declared once for the four panels (each adds it to its SETTINGS). Level `advanced`, argued: the screen's
 * row is the one most people need (one folder covers every panel); this is the exception, and a switch user walks every
 * standard row of a panel's menu on every lap - the reason Photos' "carry on by itself" is advanced too. The declared
 * options are the three that need no account; a mounted panel adds the sources (`backupPanelChoices`).
 */
export function backupPanelField({ panelDefault = BACKUP_NONE } = {}) {
  return {
    key: BACKUP_KEY, label: 'If this can’t be reached, use', kind: 'choice', default: BACKUP_FOLLOW, level: 'advanced',
    options: [
      { value: BACKUP_FOLLOW, label: 'As This screen says' },
      { value: BACKUP_ANY, label: 'Any other source this screen can see' },
      { value: BACKUP_NONE, label: 'Nothing' },
    ],
    note: `The backup is shown, with a quiet note, only while the main one can’t be reached. It goes back by itself when it can. If `
      + `no backup is set anywhere, this one uses ${panelDefault === BACKUP_ANY ? 'any other source this screen can see' : 'nothing'}.`,
  };
}

/**
 * A mounted panel's live options for its row, and the line after the value. `sources`: what the panel last listed;
 * `mainId`: its main source (not offered as its own backup); `current`: the stored choice (kept in the list, saying it is
 * not here, when it is not - the photo-source rule of c3eb41a: the press that repairs it must stay possible); `screen`:
 * the screen's row; `showing`: the label of the backup on screen right now, if one is.
 */
export function backupPanelChoices({ sources = [], mainId = null, current = BACKUP_FOLLOW, screen = BACKUP_FOLLOW,
  panelDefault = BACKUP_NONE, personId = null, showing = null } = {}) {
  const inForce = backupChoice({ panel: '', screen, panelDefault });
  const options = [
    { value: BACKUP_FOLLOW, label: `As This screen says (${backupWords(inForce, sources)})` },
    ...sourceChoices(sources, { exclude: mainId, personId }),
    { value: BACKUP_ANY, label: 'Any other source this screen can see' },
    { value: BACKUP_NONE, label: 'Nothing' },
  ];
  const cur = String(current == null ? '' : current);
  if (cur && !options.some((o) => o.value === cur)) options.push({ value: cur, label: 'A source not connected here' });
  return { options, status: showing ? `Showing the backup now: “${showing}”.` : '' };
}

/** THE SCREEN ROW (kiosk.js SCREEN_FIELDS, This screen tab). Its choices are what the panels here have listed. */
export function backupScreenField({ sources = [], personId = null, current = BACKUP_FOLLOW } = {}) {
  const options = [
    { value: BACKUP_FOLLOW, label: 'Not set: each part’s own choice' },
    ...sourceChoices(sources, { personId }),
    { value: BACKUP_ANY, label: 'Any source this screen can see' },
    { value: BACKUP_NONE, label: 'None' },
  ];
  const cur = String(current == null ? '' : current);
  if (cur && !options.some((o) => o.value === cur)) options.push({ value: cur, label: 'A source not connected here' });
  return {
    key: BACKUP_KEY, label: 'Backup folder for this screen', kind: 'choice', level: 'standard', default: BACKUP_FOLLOW,
    options,
    note: 'Used by Photos, Personal videos, Music folders and Wallpaper whenever the one they play from can’t be '
      + 'reached, unless a panel chose its own. They go back by themselves when it can. Not set: Photos and Personal '
      + 'videos use any other source here, Music and Wallpaper nothing. A folder connected in Media / Sources appears '
      + 'here once a panel on this screen has listed it.',
  };
}

/**
 * ASK AFTER THE MAIN SOURCE WHILE A BACKUP IS SHOWING: every SOURCE_RECHECK_MS, `isBack()` (never throws out of here);
 * true calls `onBack()` once and stops. Photos and Personal videos have their own (older, the same shape); Music and
 * Wallpaper use this one. `ms` is a function so a suite's seam is read when armed.
 */
export function createSourceRecheck({ ms = () => SOURCE_RECHECK_MS, setTimer = (fn, t) => setTimeout(fn, t),
  clearTimer = (id) => clearTimeout(id), isBack, onBack } = {}) {
  let t = null;
  let epoch = 0;
  function stop() { epoch += 1; if (t != null) { clearTimer(t); t = null; } }
  function arm() {
    stop();
    const wait = Number(typeof ms === 'function' ? ms() : ms);
    if (!(wait > 0)) return;
    const mine = epoch;
    t = setTimer(async () => {
      t = null;
      let back = false;
      try { back = !!(await isBack()); } catch { back = false; }
      if (mine !== epoch) return;
      if (back) { try { onBack(); } catch (err) { console.error('media-sources: back to the main source', err); } } else arm();
    }, wait);
  }
  return { arm, stop, armed: () => t != null };
}

// ------------------------------------------- a typed address, checked where it can be (2026-10-10, note BO item 3)
// Mike, 2026-10-10: he typed http://localhost:8770 - the photo program on the BENCH screen - from his DESKTOP. Before
// this, Media saved it, said "Connected.", and then asked for it FROM THE DESKTOP: on a page served from the internet,
// Chrome (142 and later) first asks "allow this site to reach devices on your network?" [inferred from Chrome's Local
// Network Access rollout], and then nothing answered on the desktop, so the card read "not reachable" in red - about an
// address that was never meant for the desktop at all. "localhost" means the computer showing the page; an address on
// the home network may be one this computer cannot reach, or one the browser asks about first.
//
// SO: AN ADDRESS ON THIS COMPUTER OR THIS NETWORK IS CHECKED HERE ONLY WHEN THAT CANNOT MAKE THE BROWSER ASK. It is saved
// for the account either way, and the screen that uses it checks it every time it lists it (its Photos panel says when
// it can't be reached, listOrFallback above). The cases, in `checkFromHere`:
//   * an address on the internet                      -> checked, as before (no prompt is involved)
//   * the page itself is on this computer or network   -> checked (a local page reaching a local address is not asked about)
//   * the browser says the permission is already given -> checked (a kiosk installed with the policy that grants it)
//   * given "no", "would ask", or the browser won't say -> NOT checked; "it can't be checked from here", and a press to
//     check anyway ("Check on this computer"), which is the person asking, so the browser asking back is fine.
// "Won't say" counts as "would ask", argued: guessing wrong that way costs one line of text and a button; guessing wrong
// the other way is the prompt on the desktop that this exists to stop. AGAINST: Firefox and Safari, which have no such
// prompt [inferred], no longer check a home-network address here by themselves; the press does it.
// Pairing (`findReachable`, below) is not changed: it runs after somebody typed a code and pressed Connect, and it must
// try the addresses to know which one answers.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * WHERE AN ADDRESS POINTS, from its host name alone (no lookup): 'loopback' (this computer: localhost, 127.x, ::1),
 * 'private' (the home or facility network: 10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64-127.x - Tailscale's - fc/fd
 * and fe80 IPv6, a name ending .local, .lan, .home.arpa, .internal or .ts.net, or a name with no dot), 'public', or
 * 'invalid'. PURE. A public-looking name that a home router resolves to a home address is called public here; the
 * browser then asks or doesn't, and the check simply fails - the same as before this existed.
 */
export function addressScope(url) {
  let host;
  try { host = new URL(String(url || '').trim()).hostname.toLowerCase(); } catch { return 'invalid'; }
  if (!host) return 'invalid';
  host = host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return 'loopback';
  const v4 = IPV4.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return 'loopback';
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127)) return 'private';
    return 'public';
  }
  if (host.includes(':')) return /^(fc|fd|fe8|fe9|fea|feb)/.test(host) ? 'private' : 'public';
  if (/\.(local|lan|home\.arpa|internal|ts\.net)$/.test(host) || !host.includes('.')) return 'private';
  return 'public';
}

/**
 * WHAT THIS BROWSER SAYS ABOUT REACHING `scope` ('loopback' | 'private'), WITHOUT ASKING THE PERSON: 'granted', 'denied',
 * 'prompt', or 'unknown' when it has no such permission to report. A permission QUERY never shows a prompt. The names
 * tried, in order: Chrome's split ones and then the single one it shipped first [inferred: the names have changed
 * between releases, so each is tried and a name the browser doesn't know is skipped].
 */
export async function localNetworkPermission(scope, { permissions = (typeof navigator !== 'undefined' ? navigator.permissions : null) } = {}) {
  if (!permissions || typeof permissions.query !== 'function') return 'unknown';
  const names = scope === 'loopback' ? ['loopback-network', 'local-network-access'] : ['local-network', 'local-network-access'];
  for (const name of names) {
    try {
      const st = await permissions.query({ name });
      if (st && typeof st.state === 'string') return st.state;
    } catch { /* this browser doesn't know that name; try the next */ }
  }
  return 'unknown';
}

/**
 * MAY THIS PAGE CHECK `url` WITHOUT THE BROWSER ASKING? Returns `{ check, scope, why }`; `why` is one of 'public',
 * 'local-page', 'granted', 'denied', 'would-ask'. Never asks, never throws. `pageHost` and `permission` are seams.
 */
export async function checkFromHere(url, {
  pageHost = (typeof location !== 'undefined' ? location.hostname : ''),
  permission = localNetworkPermission,
} = {}) {
  const scope = addressScope(url);
  if (scope === 'public' || scope === 'invalid') return { check: true, scope, why: 'public' };
  const page = addressScope(`http://${String(pageHost || '').includes(':') && !String(pageHost).startsWith('[') ? `[${pageHost}]` : pageHost}/`);
  if (page === 'loopback' || page === 'private') return { check: true, scope, why: 'local-page' };
  let state = 'unknown';
  try { state = await permission(scope); } catch { state = 'unknown'; }
  if (state === 'granted') return { check: true, scope, why: 'granted' };
  // `state` (2026-10-10, quietReach below): what the browser said, so "won't say" ('unknown') and "would ask" ('prompt')
  // can be told apart by a caller that needs to.
  return { check: false, scope, why: state === 'denied' ? 'denied' : 'would-ask', state };
}

// ------------------------------------------- a panel's source on another computer (2026-10-10, desktop prompt)
// The same rule as the history host (70e26e4), for the four panels that play from a source: Photos, Personal videos,
// Music's folder favourites and Wallpaper. An account-wide `http://localhost:8770` (the photo program on a Pi, added from
// a desktop) is in every screen's list. On a dashboard opened on that DESKTOP, a panel that tried it - as its own source,
// as a stand-in or a backup ("any other source", the screen's backup), or by adopting the only source there - made Chrome
// show its local-network Allow/Block box, for an address with nothing behind it on the desktop.
//
// SO A PANEL ASKS AN AGENT ONLY WHERE THAT CANNOT MAKE THE BROWSER ASK (`quietReach`): checkFromHere's cases (an address
// on the internet; a page served from this computer or network; local-network access already allowed, as on the kiosk),
// plus an address that answered a press here before (`rememberReached`, below). Everything else counts as "on another
// computer": never fetched by itself. What each kind of try then does:
//   * a stand-in, a backup, the screen's backup  -> skipped, as if it had not answered; the next one is tried
//   * adopting the only source                   -> not adopted (and not saved): the panel says the line below
//   * a source somebody chose for the panel      -> not fetched either; the quiet line ELSEWHERE_LINE and a
//                                                   "Try on this computer" press (`tryFromHere`), which fetches on purpose:
//                                                   Chrome's box may come up then, and it is the person's to answer.
// A folder or the pictures added on this device are never "elsewhere" (nothing is fetched over the network for them).
// AGAINST: somebody running the photo program on their OWN desktop, using the site from the internet, now sees the line
// and presses once; after Allow (Chrome) or one answer (a browser that never asks), it is remembered and quiet again.
export const ELSEWHERE_LINE = 'This source is on another computer — it can’t be shown here.';
export const TRY_HERE_LABEL = 'Try on this computer';

/**
 * THE ADDRESSES A PRESS HERE REACHED, kept in this browser: key REACHED_KEY, at most REACHED_MAX. Argued:
 *   - Kept, not just for the page: a browser that never asks (it reports no permission at all) would otherwise show the
 *     line and want the press on every visit, for an address that works.
 *   - Not honoured while the browser says it WOULD ask ('prompt': somebody reset the site's permissions) - then a fetch
 *     is the box again, and the line and the press come back.
 *   - 20: more addresses than anybody keeps on one account; past that the oldest goes, which costs one press.
 */
export const REACHED_KEY = 'nimrod-reached-here';
export const REACHED_MAX = 20;
const reachedMem = new Set();
function readReached() {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(REACHED_KEY) || '[]'); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
}
/** This base answered a press on this browser. Never throws. */
export function rememberReached(base) {
  const b = trimSlash(base);
  if (!b) return;
  reachedMem.add(b);
  try {
    const list = [b, ...readReached().filter((x) => x !== b)].slice(0, REACHED_MAX);
    globalThis.localStorage?.setItem(REACHED_KEY, JSON.stringify(list));
  } catch { /* a private window: this page only */ }
}
export function wasReached(base) { const b = trimSlash(base); return !!b && (reachedMem.has(b) || readReached().includes(b)); }
/** For the suites: forget every press. */
export function forgetReachedForTest() { reachedMem.clear(); try { globalThis.localStorage?.removeItem(REACHED_KEY); } catch { /* fine */ } }

/** The address a source is fetched from, or '' for one that is never fetched over the network (folder, device). PURE. */
export function agentBase(source) {
  if (!source || source.kind === 'folder' || source.kind === 'device') return '';
  const b = trimSlash(source.base_url);
  return /^https?:\/\//i.test(b) ? b : '';
}

/**
 * MAY A PANEL FETCH THIS SOURCE WITHOUT THE BROWSER ASKING? `{ quiet, why }`; why: 'not-fetched' (folder/device),
 * checkFromHere's why, or 'reached' (a press here reached it before). Never throws, never asks. `check` is the seam
 * (a panel passes `ctx.checkFromHere`), default checkFromHere.
 */
export async function quietReach(source, { check = null } = {}) {
  const base = agentBase(source);
  if (!base) return { quiet: true, why: 'not-fetched' };
  let r;
  try { r = await (check || checkFromHere)(base); } catch { r = null; }
  if (r && r.check === true) return { quiet: true, why: r.why || 'checked' };  if (wasReached(base) && !(r && r.state === 'prompt')) return { quiet: true, why: 'reached' };
  return { quiet: false, why: (r && r.why) || 'would-ask' };
}

/** `sources` split into what this page may fetch quietly (`here`) and what it may not (`elsewhere`), order kept. */
export async function splitByReach(sources, { check = null } = {}) {
  const here = [], elsewhere = [];
  for (const s of (Array.isArray(sources) ? sources : [])) ((await quietReach(s, { check })).quiet ? here : elsewhere).push(s);
  return { here, elsewhere };
}

/**
 * A LISTER THAT NEVER MAKES THE BROWSER ASK: `resolve`, except that a source on another computer rejects at once with
 * err.code 'elsewhere' and nothing is fetched. Every automatic try in a panel (its own source, the stand-ins and backups
 * in listOrFallback, the recheck every minute) goes through this, so none of them can bring the box up.
 */
export function quietResolve(resolve, { check = null } = {}) {
  return async (source, album) => {
    if (!(await quietReach(source, { check })).quiet) {
      throw codedError('elsewhere', `media source "${source && source.label}": on another computer, not asked from here`);
    }
    return resolve(source, album);
  };
}

/**
 * "TRY ON THIS COMPUTER": the one fetch made ON PURPOSE (Chrome's box may come up; the press is the person asking).
 * Resolves `{ ok, listing, err }`, never rejects. An answer is remembered (`rememberReached`) so the panels fetch it
 * quietly from then on.
 */
export async function tryFromHere(source, { resolve = resolveListing, album = '' } = {}) {
  try {
    const listing = await resolve(source, album);
    rememberReached(agentBase(source));
    return { ok: true, listing, err: null };
  } catch (err) {
    return { ok: false, listing: null, err: err || codedError('unreachable', 'no answer') };
  }
}

// ---------------------------------------------------------------------- pairing
// SIX CHARACTERS INSTEAD OF AN IP ADDRESS.
//
// Connecting a device used to mean reading its address off one machine and typing it into
// a browser on another. That is an administrator's task, and it is why the media agent was
// unusable by the people it exists for.
//
// THE HALF THAT LIVES HERE IS THE INTERESTING HALF. The agent cannot know which of its
// addresses this browser can reach - `localhost` only works when they are the same
// machine, a LAN address only from the same network - so it offers CANDIDATES and we find
// out, by asking each one. That is why claiming a code does not create a source on the
// server: the server would have to guess, and it would be wrong at a bedside.

export const PAIR_CODE_LEN = 6;

// Case and punctuation are how people write a code down off a screen. Nothing is
// substituted: the alphabet contains no ambiguous glyph (no 0/O, 1/I/L, U), so a typed O
// is a genuine misreading with no correct character to map it to, and quietly changing it
// would pair the wrong device. Mirrors normalize_code() on the server.
export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 32);
}

// Ask an agent who it is. Short timeout because this runs against several addresses in a
// row and most of them are expected to fail — an unreachable LAN address would otherwise
// hang the whole thing on one browser's connect timeout.
async function probeAgent(baseURL, { fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${baseURL}/health`, ctl ? { signal: ctl.signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The first candidate that answers AND is the agent we just paired with, in order.
//
// THE IDENTITY CHECK IS NOT DECORATION. Candidates include LAN addresses, and a machine
// that took the same DHCP lease — or any other agent someone runs on 8770 — would answer
// happily. Without matching the id, "it responded" is enough to make a stranger's folder
// somebody's photo source. When the agent reports no id at all (an older build), reaching
// it is all we can check, and that is stated rather than pretended.
export async function findReachable(baseURLs, agentId, opts = {}) {
  for (const url of baseURLs || []) {
    const health = await probeAgent(url, opts);
    if (!health || health.ok !== true) continue;
    if (agentId && health.agent_id && health.agent_id !== agentId) continue;
    return { base_url: url, agent_id: health.agent_id || '', verified: !!(agentId && health.agent_id) };
  }
  return null;
}
