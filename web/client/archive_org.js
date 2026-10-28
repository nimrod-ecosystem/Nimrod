// archive_org.js — THE INTERNET ARCHIVE AS A PLACE THE SITE PLAYS FROM. Row 2.69.
//
// Mike, 2026-10-08: *"I think we already discussed adding Internet Archive. That would be a good one."*
// The curated list (docs/from_chat/embed_candidates.md, Tier 2) has it for old television, old radio, music, books
// and the Archive's in-browser arcade, and notes that "every item has a stable identifier, so a playlist is just a
// list in module state".
//
// WHAT WAS CHECKED BEFORE BUILDING (2026-10-10, read off archive.org itself):
//   * The terms (archive.org/about/terms.php; the 2014 change is blog.archive.org/2014/12/30/update-to-terms-of-use/)
//     dropped the old ban on copying offsite and the word "noncommercial"; use is "limited to noninfringing or fair
//     use", and an item's own licence (often Creative Commons) applies as far as you trust its uploader. The help
//     page on rights (help.archive.org/help/rights/) puts the copyright check on the person using an item, and says
//     wholesale copying and rehosting may go beyond what the terms allow. NOTHING HERE COPIES OR REHOSTS: a screen
//     plays a file straight from archive.org, the way a visitor's browser would.
//   * The metadata API (https://archive.org/metadata/<id>) is public, needs no key, and answers any page
//     (`Access-Control-Allow-Origin: *`, measured). A missing or private item answers `{}`.
//   * The embed page (https://archive.org/embed/<id>) sends no X-Frame-Options and no frame-ancestors (measured), so
//     it can sit in a frame. For a game it carries the Archive's emulator (its CSP names their "emularity" hosts).
//
// THE STORAGE LINE HOLDS: the only thing kept for a person is the identifier they chose (and, while it plays, which
// file of it). The file list read from the metadata is kept in THIS PAGE'S MEMORY only, and the sound and pictures go
// from archive.org to the browser. The site's server never sees them.
//
// PRIVACY: requests carry no referrer (`referrerPolicy: 'no-referrer'`), no cookies (`credentials: 'omit'`) and no
// header of ours. The browser's own User-Agent is the only one sent; nothing about the person is.
//
// PURE except `fetchItem` (one fetch, injectable) and the page-memory cache.

export const ARCHIVE_ORIGIN = 'https://archive.org';

// An item identifier as the Archive allows them: letters, digits, dot, dash, underscore; at most 100 characters.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// The path words that come before an identifier in an archive.org address.
const ID_PATHS = new Set(['details', 'embed', 'download', 'metadata', 'stream', 'compress']);

/** Is this an Internet Archive identifier? PURE. */
export const isArchiveId = (s) => typeof s === 'string' && ID_RE.test(s);

/**
 * The identifier in what somebody pasted or typed, or ''. Accepts
 *   https://archive.org/details/<id>  (and /embed/, /download/<id>/<file>, /metadata/, /stream/)
 *   archive.org/details/<id>          (no scheme)        www.archive.org/...       a data server's /<n>/items/<id>/...
 *   archive:<id>                      and, with `bare` (the default), a plain identifier: "OTRR_Dragnet_Singles".
 * `bare: false` is for a box that also takes other links (the music favourites): a plain word is not taken as an item.
 * PURE.
 */
export function parseArchiveId(input, { bare = true } = {}) {
  let s = String(input == null ? '' : input).trim().replace(/^<|>$/g, '');
  if (!s) return '';
  const pref = /^archive:(.+)$/i.exec(s);
  if (pref) return isArchiveId(pref[1].trim()) ? pref[1].trim() : '';
  if (/^(www\.)?archive\.org\//i.test(s)) s = `https://${s}`;
  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return ''; }
    const host = u.hostname.toLowerCase();
    if (host !== 'archive.org' && !host.endsWith('.archive.org')) return '';
    const parts = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    let id = '';
    if (parts.length >= 2 && ID_PATHS.has(parts[0].toLowerCase())) id = parts[1];
    else {
      const i = parts.indexOf('items');
      if (i >= 0 && parts[i + 1]) id = parts[i + 1];
    }
    return isArchiveId(id) ? id : '';
  }
  return bare && isArchiveId(s) ? s : '';
}

/**
 * HOW MANY ITEMS ONE PANEL'S LIST HOLDS: 100. A hard-coded bound, argued (Rule 1): it is a sanity limit on what is
 * typed, not a choice anybody makes - a caregiver picks "five things" (embed_candidates.md), and a list of more than a
 * hundred is a paste gone wrong. Past it the rest are left off and the panel says how many.
 */
export const ITEMS_MAX = 100;

/** Every identifier in a typed list (commas, spaces or new lines between them), in order, no repeats. PURE. */
export function parseItemList(text, { max = ITEMS_MAX } = {}) {
  const raw = Array.isArray(text) ? text : String(text == null ? '' : text).split(/[\s,;]+/);
  const out = [];
  let bad = 0;
  let over = 0;
  for (const piece of raw) {
    const p = String(piece || '').trim();
    if (!p) continue;
    const id = parseArchiveId(p);
    if (!id) { bad += 1; continue; }
    if (out.includes(id)) continue;
    if (out.length >= max) { over += 1; continue; }
    out.push(id);
  }
  return Object.assign(out, { bad, over });
}

/** The list as the settings row keeps it: identifiers, comma-separated. PURE. */
export const itemListText = (ids) => (Array.isArray(ids) ? ids : []).filter(isArchiveId).join(', ');

const enc = (s) => encodeURIComponent(String(s));
export const metadataUrl = (id) => `${ARCHIVE_ORIGIN}/metadata/${enc(id)}`;
export const embedUrl = (id) => `${ARCHIVE_ORIGIN}/embed/${enc(id)}`;
export const tileUrl = (id) => `${ARCHIVE_ORIGIN}/services/img/${enc(id)}`;
/** A file's address: each part of its name encoded, the slashes kept (a file inside a folder of the item). */
export const downloadUrl = (id, name) => `${ARCHIVE_ORIGIN}/download/${enc(id)}/${String(name).split('/').map(enc).join('/')}`;
/** The item's page, as words to show (not a link: a link that leaves the page is what a locked screen takes away). */
export const itemAddress = (id) => `archive.org/details/${id}`;

// ---------------------------------------------------------------------------------------------------------------
// WHAT A FILE IS
// ---------------------------------------------------------------------------------------------------------------
// By its extension, which is what decides whether this browser can play it at all. Chromium (the kiosk's browser) plays
// these; .avi, .mpeg, .mkv and .mov often do not, and the Archive makes an .mp4 copy of nearly every video it is given.
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wav']);
const VIDEO_EXT = new Set(['mp4', 'm4v', 'webm', 'ogv']);
const extOf = (name) => { const m = /\.([a-z0-9]{2,5})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

/** 'audio' | 'video' | '' for a file name. PURE. */
export function fileKind(name) {
  const e = extOf(name);
  if (AUDIO_EXT.has(e)) return 'audio';
  if (VIDEO_EXT.has(e)) return 'video';
  return '';
}

/** A file's name to show: its own title when the Archive has one, else the file name without folder or extension. */
export function fileTitle(f) {
  const t = f && typeof f.title === 'string' ? f.title.trim() : '';
  if (t) return t;
  const tail = String((f && f.name) || '').split('/').pop() || '';
  return tail.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\.ia$/i, '').replace(/_/g, ' ').trim();
}

/** Seconds from the Archive's `length` ("1783.69" or "29:43" or "1:02:03"), or 0. PURE. */
export function lengthSeconds(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// THE ONE COPY OF EACH RECORDING TO PLAY. The Archive keeps the file it was given (`source: original`) and copies it
// makes (`derivative`, each naming its `original`): one programme can be there as .mpeg, .mp4 at 480 lines, and .ogv.
// So files are grouped by the recording they come from, and one is picked from each group:
//   'small' (THE DEFAULT, the "Video quality" row argues it): the Archive's own web copy - an .mp4 it made, usually 480
//           lines - then .webm/.ogv, then the original. It plays smoothly on a Raspberry Pi and over facility wifi.
//   'best': the original when it can be played here, else the tallest copy.
// Sound: .mp3 first, then the other compressed kinds, then lossless (.flac/.wav, ten times the size for a speaker
// that will not show the difference), in both qualities but 'best', which takes the original when it can play it.
function score(f, kind, quality) {
  const e = extOf(f.name);
  const derived = f.source === 'derivative';
  if (kind === 'video') {
    const h = Number(f.height) || 0;
    if (quality === 'best') return (derived ? 10 : 0) + (e === 'mp4' || e === 'm4v' ? 0 : 3) - Math.min(h, 4000) / 10000;
    return (e === 'mp4' || e === 'm4v' ? 0 : 2) + (derived ? 0 : 4) + Math.min(h, 4000) / 10000;
  }
  const rank = e === 'mp3' ? 0 : (e === 'flac' || e === 'wav') ? 4 : 2;
  if (quality === 'best') return (derived ? 10 : 0) + rank;
  return rank + (derived ? 0 : 0.5);
}

const trackNo = (f) => { const n = parseInt(String((f && f.track) || '').split('/')[0], 10); return Number.isFinite(n) ? n : null; };
const collator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : null;
const byName = (a, b) => (collator ? collator.compare(a, b) : (a < b ? -1 : a > b ? 1 : 0));

/**
 * HOW MANY FILES ONE ITEM LISTS, BY DEFAULT: 500 (the panel's "Most files from one item" row, 50 to 2000). Argued:
 * an old-time-radio item holds a few hundred episodes (OTRR_Dragnet_Singles: about 300 programmes among 3,120 files),
 * and they should all be there; past a few hundred rows the list is slow to draw on a Pi and nobody walks it with a
 * switch. The rest are left off, and the panel says so.
 */
export const FILES_MAX_DEFAULT = 500;

/**
 * THE FILES OF AN ITEM THIS PAGE CAN PLAY, one per recording, in order: `{ files, total, truncated, kind }`.
 *   want     'any' (videos if the item has any, else sound) | 'audio' | 'video'
 *   quality  'small' | 'best' (above)        max  how many to list (FILES_MAX_DEFAULT)
 * Each file: `{ name, title, kind, url, seconds, format }`. PURE.
 */
export function playableFiles(item, { want = 'any', quality = 'small', max = FILES_MAX_DEFAULT } = {}) {
  const id = item && item.id;
  const all = (item && Array.isArray(item.files) ? item.files : [])
    .filter((f) => f && f.name && !f.private && fileKind(f.name));
  const hasVideo = all.some((f) => fileKind(f.name) === 'video');
  const kind = want === 'audio' ? 'audio' : want === 'video' ? 'video' : (hasVideo ? 'video' : 'audio');
  const groups = new Map();
  for (const f of all) {
    if (fileKind(f.name) !== kind) continue;
    const key = f.source === 'derivative' && f.original ? String(f.original) : f.name;
    const best = groups.get(key);
    if (!best || score(f, kind, quality) < score(best.f, kind, quality)) groups.set(key, { f, key });
  }
  const list = [...groups.values()].sort((a, b) => {
    const ta = trackNo(a.f), tb = trackNo(b.f);
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    return byName(a.key, b.key);
  });
  const cap = Math.max(1, Math.floor(Number(max) || FILES_MAX_DEFAULT));
  const files = list.slice(0, cap).map(({ f }) => ({
    name: f.name, title: fileTitle(f), kind, url: downloadUrl(id, f.name), seconds: lengthSeconds(f.length),
    format: String(f.format || ''),
  }));
  return { files, total: list.length, truncated: list.length > cap, kind };
}

// ---------------------------------------------------------------------------------------------------------------
// WHAT AN ITEM IS, AND HOW IT IS SHOWN
// ---------------------------------------------------------------------------------------------------------------

/** 'audio' | 'video' | 'text' | 'software' | 'collection' | 'image' | 'other', from the item's own type. PURE. */
export function itemType(item) {
  const m = String((item && item.mediatype) || '').toLowerCase();
  if (item && item.emulator) return 'software';
  if (m === 'audio' || m === 'etree') return 'audio';
  if (m === 'movies') return 'video';
  if (m === 'texts') return 'text';
  if (m === 'software') return 'software';
  if (m === 'collection') return 'collection';
  if (m === 'image') return 'image';
  return 'other';
}

// What the Archive's own player (the embed frame) is used for - the panel's "The Archive's own player" row:
//   'books'        (THE DEFAULT) books, pictures and anything else with nothing this page can play - not games
//   'books-games'  the same, and games and programs (the Archive's emulator)
//   'never'        nothing: an item with nothing to play says so
// GAMES ARE OFF BY DEFAULT, argued: a game in the frame takes the keyboard while somebody plays it (a switch that types
// a key goes into the game, not to the screen), and its sound cannot be turned down or paused by the screen (the frame
// is another site's). "Give the keys back" (modules/archive.js) answers the first; nothing here can answer the second.
// AGAINST: Mike's own picture is "playing some classic games at her bedside while she sleeps" - which is somebody who
// chose it, and one press in the settings is that choice.
export const FRAME_FOR = Object.freeze(['books', 'books-games', 'never']);

/**
 * HOW THIS ITEM IS SHOWN: `{ mode: 'media' | 'frame' | 'none', reason }`. `files` is playableFiles' answer. Plain sound
 * and video always play in this page's own player (it follows the screen's speaker, Play / Pause and Next); the frame
 * only shows what only the frame can show. PURE.
 */
export function itemView(item, files, { frameFor = 'books' } = {}) {
  const t = itemType(item);
  if (t === 'collection') return { mode: 'none', reason: 'archive-collection' };
  if (t !== 'software' && files && files.files && files.files.length) return { mode: 'media', reason: null };
  if (t === 'software') return frameFor === 'books-games' ? { mode: 'frame', reason: null } : { mode: 'none', reason: 'archive-games-off' };
  if (frameFor === 'never') return { mode: 'none', reason: 'archive-nothing' };
  return { mode: 'frame', reason: null };
}

/** A few plain words on what an item holds: "12 sound files", "1 video", "a book", "a game or program". PURE. */
export function whatItHolds(item, files) {
  const t = itemType(item);
  const n = files && files.total ? files.total : 0;
  if (t === 'collection') return 'a collection of many items';
  if (t === 'software') return 'a game or program';
  if (n && files.kind === 'video') return n === 1 ? '1 video' : `${n} videos`;
  if (n) return n === 1 ? '1 sound file' : `${n} sound files`;
  if (t === 'text') return 'a book';
  if (t === 'image') return 'pictures';
  return 'nothing this screen can play by itself';
}

// What somebody is told, in sentences they can act on. Shared with the Music panel (music_player.js MESSAGES), so the
// same problem reads the same on both. No placeholders: the music router fills `{name}` only, and these need none.
export const ARCHIVE_MESSAGES = Object.freeze({
  'archive-bad-id': 'That is not an Internet Archive address. Paste an address like archive.org/details/… or type the item’s name.',
  'archive-not-found': 'The Internet Archive has no public item at that address.',
  // Row 2.148 (2026-10-28): the browser asks archive.org itself, so a blocker on this browser or network can stop it too.
  'archive-unreachable': 'The Internet Archive could not be reached. Check the internet connection. An ad blocker on '
    + 'this browser or network can also stop it.',
  'archive-no-audio': 'That Internet Archive item has no sound files this screen can play.',
  'archive-nothing': 'Nothing in this item can be played here.',
  'archive-collection': 'That address is a collection of many items. Add one item from it instead.',
  'archive-games-off': 'This is a game or program. It plays in the Archive’s own player, which is off for games in this '
    + 'part. Turn it on in this part’s settings (“The Archive’s own player”).',
  'archive-files-failed': 'This item’s files would not play. The Internet Archive may be busy; it tries again at the next item.',
});

// ---------------------------------------------------------------------------------------------------------------
// READING AN ITEM
// ---------------------------------------------------------------------------------------------------------------

/**
 * HOW LONG TO WAIT FOR THE ARCHIVE TO ANSWER: 20 seconds. The same figure media_sources.js LISTING_WAIT_MS gives a
 * listing over facility wifi, for the same reason; the Archive's metadata for an item of 3,000 files is about a
 * megabyte. A seam (`timeoutMs`).
 */
export const FETCH_WAIT_MS = 20000;

/**
 * THE PAGE'S MEMORY OF ITEMS ALREADY READ: at most 24, each for 30 minutes. Argued: a panel going round a list of
 * items asks for each one again on every lap, and the Archive's file lists change rarely; 24 covers several panels'
 * lists without holding megabytes, and half an hour means an edit to an item on archive.org shows within the hour.
 * Memory only - nothing is written anywhere.
 */
export const CACHE_MAX = 24;
export const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();   // id -> { at, item }
/** For the suites. */
export function forgetItemsForTest() { cache.clear(); }

const str = (v) => (Array.isArray(v) ? v.map(String).join(', ') : v == null ? '' : String(v));

/** The parts of the Archive's answer this site uses, and nothing else. PURE. */
export function summarizeItem(id, raw) {
  const md = (raw && raw.metadata) || {};
  const files = (Array.isArray(raw && raw.files) ? raw.files : []).map((f) => ({
    name: String(f.name || ''), format: String(f.format || ''), source: String(f.source || ''),
    original: f.original ? str(f.original) : '', length: f.length == null ? '' : String(f.length),
    title: f.title ? str(f.title) : '', track: f.track ? str(f.track) : '', height: f.height ? Number(f.height) || 0 : 0,
    private: f.private === true || f.private === 'true',
  })).filter((f) => f.name);
  return {
    id: String(md.identifier || id),
    title: str(md.title).trim() || String(id),
    mediatype: str(md.mediatype).toLowerCase(),
    creator: str(md.creator).trim(),
    date: str(md.date).trim(),
    license: str(md.licenseurl).trim(),
    emulator: !!str(md.emulator).trim(),
    files,
  };
}

/**
 * READ ONE ITEM: `{ ok: true, item }` or `{ ok: false, reason }` ('archive-bad-id' | 'archive-not-found' |
 * 'archive-unreachable'). Never throws. `fetchImpl`, `timeoutMs` and `now` are seams; `fresh` skips the memory.
 */
export async function fetchItem(id, { fetchImpl = (typeof fetch === 'function' ? fetch : null), timeoutMs = FETCH_WAIT_MS,
  now = () => Date.now(), fresh = false } = {}) {
  if (!isArchiveId(id)) return { ok: false, reason: 'archive-bad-id' };
  const hit = cache.get(id);
  if (!fresh && hit && now() - hit.at < CACHE_MS) return { ok: true, item: hit.item };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'archive-unreachable' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  try {
    const wait = new Promise((_, reject) => {
      if (Number(timeoutMs) > 0) timer = setTimeout(() => { try { ctl?.abort(); } catch { /* gone */ } reject(new Error('timeout')); }, Number(timeoutMs));
    });
    const res = await Promise.race([
      fetchImpl(metadataUrl(id), { credentials: 'omit', referrerPolicy: 'no-referrer', ...(ctl ? { signal: ctl.signal } : {}) }),
      wait,
    ]);
    if (!res || !res.ok) return { ok: false, reason: res && res.status === 404 ? 'archive-not-found' : 'archive-unreachable' };
    const raw = await Promise.race([res.json(), wait]);
    // A missing, dark or private item answers `{}` (measured), or `is_dark`.
    if (!raw || typeof raw !== 'object' || !raw.metadata || raw.is_dark) return { ok: false, reason: 'archive-not-found' };
    const item = summarizeItem(id, raw);
    cache.delete(id);
    cache.set(id, { at: now(), item });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return { ok: true, item };
  } catch {
    return { ok: false, reason: 'archive-unreachable' };
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// SEARCHING (2026-10-17: "Not built: search from the panel", 2026-10-10's note on row 2.69)
// ---------------------------------------------------------------------------------------------------------------
// The Archive's search API (https://archive.org/advancedsearch.php) is public, needs no key, and answers a page on any
// site (measured 2026-10-17: a page on localhost read it directly). Only the words typed are sent, with no cookies and
// no referrer, and only when somebody searches. Sound, films and books (`mediatype` audio, movies, texts): the kinds
// this panel plays; collections are left out (one item from a collection is what can be added), and games and
// programs too, whose player is off by default here. Most downloaded first, so the well-used copy comes before the
// dozen re-uploads of it. [Ten found, and that order: guesses, argued here; a setting when anybody wants another.]
export const SEARCH_ROWS = 10;
export const SEARCH_KINDS = Object.freeze(['audio', 'movies', 'texts']);
const KIND_WORDS = Object.freeze({ audio: 'sound', movies: 'a film or video', texts: 'a book' });
export const searchKindWords = (kind) => KIND_WORDS[kind] || 'an item';
/** The search address for what was typed. PURE. */
export function searchUrl(q, { rows = SEARCH_ROWS } = {}) {
  const words = String(q == null ? '' : q).replace(/\s+/g, ' ').trim().slice(0, 200);
  const query = `(${words}) AND mediatype:(${SEARCH_KINDS.join(' OR ')})`;
  const fl = ['identifier', 'title', 'mediatype', 'creator'].map((x) => `fl[]=${x}`).join('&');
  return `${ARCHIVE_ORIGIN}/advancedsearch.php?q=${enc(query)}&${fl}&sort[]=${enc('downloads desc')}&rows=${Math.max(1, Math.min(50, Number(rows) || SEARCH_ROWS))}&output=json`;
}
/**
 * SEARCH: `{ ok: true, items: [{ id, title, kind, creator }] }` or `{ ok: false, reason }` ('archive-unreachable').
 * Never throws. An empty search finds nothing without asking. `fetchImpl` and `timeoutMs` are seams.
 */
export async function searchArchive(q, { fetchImpl = (typeof fetch === 'function' ? fetch : null), timeoutMs = FETCH_WAIT_MS,
  rows = SEARCH_ROWS } = {}) {
  if (!String(q == null ? '' : q).trim()) return { ok: true, items: [] };
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'archive-unreachable' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  try {
    const wait = new Promise((_, reject) => {
      if (Number(timeoutMs) > 0) timer = setTimeout(() => { try { ctl?.abort(); } catch { /* gone */ } reject(new Error('timeout')); }, Number(timeoutMs));
    });
    const res = await Promise.race([
      fetchImpl(searchUrl(q, { rows }), { credentials: 'omit', referrerPolicy: 'no-referrer', ...(ctl ? { signal: ctl.signal } : {}) }),
      wait,
    ]);
    if (!res || !res.ok) return { ok: false, reason: 'archive-unreachable' };
    const raw = await Promise.race([res.json(), wait]);
    const docs = Array.isArray(raw?.response?.docs) ? raw.response.docs : [];
    const text = (v) => (Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v)).replace(/\s+/g, ' ').trim();
    const items = [];
    for (const d of docs) {
      const id = String(d?.identifier || '');
      if (!isArchiveId(id) || items.some((x) => x.id === id)) continue;
      items.push({ id, title: text(d.title).slice(0, 200) || id, kind: String(d.mediatype || ''), creator: text(d.creator).slice(0, 120) });
    }
    return { ok: true, items };
  } catch {
    return { ok: false, reason: 'archive-unreachable' };
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

/**
 * AN ITEM'S SOUND, AS A MUSIC FAVOURITE PLAYS IT (music_player.js): `{ ok, tracks: [{ url, path, title }] }` or
 * `{ ok: false, reason }`. Sound files only - a favourite is music, and a video's own sound is the video panel's.
 */
export async function archiveAudioTracks(id, { fetchImpl, quality = 'small', max = FILES_MAX_DEFAULT } = {}) {
  const r = await fetchItem(id, fetchImpl ? { fetchImpl } : {});
  if (!r.ok) return r;
  if (itemType(r.item) === 'collection') return { ok: false, reason: 'archive-collection' };
  const { files } = playableFiles(r.item, { want: 'audio', quality, max });
  if (!files.length) return { ok: false, reason: 'archive-no-audio' };
  return { ok: true, title: r.item.title, tracks: files.map((f) => ({ url: f.url, path: f.name, title: f.title })) };
}
