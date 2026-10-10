// hidden_pictures.js — "HIDE THIS PICTURE": which pictures a slideshow leaves out, kept on this device and in the
// person's Nimrod folder, never on the server (row 2.74; docs/for_chat pictures_order_20261009.md section 3).
//
// Mike, 2026-10-09: build it now ("it doesn't depend on Google"); hides apply to EVERYBODY by default ("Let's make the
// default for everyone"), and to one person only as an option. Undoable: "bring it back" by voice, "Bring back" in the
// panel's settings, never only by voice (somebody at the screen may not be able to speak).
//
// *** AN APPEND-ONLY LOG OF hide / unhide ROWS; THE LIST IN FORCE IS THE LOG REPLAYED. *** Undo is an `unhide` row,
// never a deletion, so the Nimrod folder's copy (and the media agent's POST /history/<stream>, which only appends) is a
// record of what happened, readable in any text editor, and a mistaken hide is always recoverable from it.
//   row: { kind: 'hide-picture' | 'unhide-picture', created_at: <ISO, this device's clock>,
//          data: { id, path, name?, scope: 'everyone' | 'person', person?, screen?, panel? } }
//     path    THE PICTURE'S PATH INSIDE ITS SOURCE (`pictureKey`), not the source's own id: the same picture on the
//             drive and on the Pi's own copy has the same path when the folder layout is the same (rclone keeps it),
//             so a hide survives the slideshow switching to its backup source.
//     scope   'everyone' (the default): every slideshow that reads this log hides it - every panel and every person
//             on this device, and every device that reads the same Nimrod folder. 'person': only where the screen is
//             for `person`.
//   The newest row for one (scope, person, path) wins.
//
// WHERE IT LIVES:
//   * THIS DEVICE: IndexedDB `nimrod-hidden` (one record for the whole device), read at once and offline. The device
//     copy is COMPACTED when it grows past `keep` (rows that no longer change anything are dropped); the folder's
//     copy never is.
//   * THE PERSON'S NIMROD FOLDER, when this device has one: Data/History/hidden-pictures-<YYYY-MM>.jsonl, written by
//     the media agent on this computer when it offers history, else by the browser (history_place.js `nimrodFolder`,
//     the same writer, files and per-folder markers as the play history). A device that can READ the folder (the
//     browser folder; the agent has no read route) merges rows it has not seen, so two screens on one folder agree.
//   * NEVER THE SERVER: a list of which family pictures somebody chose not to see is personal (row 2.58's line).
//     web/server/storage_line.py rule 7 refuses it on every route; the site's code never sends it.
// ALWAYS COPIED TO THE FOLDER WHEN ONE IS REACHABLE, argued: FOR a "this device only" choice (history_place.js gives
// one for plays): a hide is small and the person's own folder is theirs, so a copy there costs nothing anybody can
// see, and without it a re-imaged Pi or a second screen shows every hidden picture again. AGAINST: somebody who wants
// no trace. Not offered yet; it would be one row on the history page.
//
// Everything is injected (the store, the folder, the clock, the timers), so the suite runs with no browser folder.

import { idbPlayStore, memoryPlayStore, playRecord } from './plays.js';
import { markFor, folderMarkKey } from './history_place.js';

export const HIDDEN_STREAM = 'hidden';                 // the folder's file name starts with it (agent HISTORY_STREAM_RE)
export const HIDDEN_FILE_SCOPE = 'pictures';           // ... then this: hidden-pictures-<month>.jsonl
export const HIDE_KIND = 'hide-picture';
export const UNHIDE_KIND = 'unhide-picture';
export const HIDDEN_KINDS = Object.freeze([HIDE_KIND, UNHIDE_KIND]);
export const HIDDEN_DB = 'nimrod-hidden';
export const HIDDEN_RECORD = 'hidden:pictures';
// The list's own tag, on any copy of it as one object (`snapshot()`). The server refuses anything carrying it
// (storage_line.py rule 7, which holds the two strings equal through test_storage_line.py).
export const HIDDEN_FORMAT = 'nimrod-hidden-pictures';
export const HIDE_SCOPES = Object.freeze(['everyone', 'person']);
export const DEFAULT_HIDE_SCOPE = 'everyone';

// EVERY NUMBER HERE IS A DEFAULT (Rule 1), argued:
//   keep         rows on the device before it compacts: 5,000 is years of hiding at any human pace, and compacting
//                only drops rows that change nothing, so nothing hidden ever comes back because of it.
//   pathMax      the longest path kept (characters): plays.js idMax, for the same reason (a file path can be long).
//   nameMax      the longest name kept for the list: a file name, not a description.
//   syncDelayMs  the folder copy waits this long after a hide, so "hide, hide, bring it back" is one write.
//   readMax      rows read back from the folder when merging: the same 5,000.
//   lookEveryMs  how often, at most, a change the history host reports makes this copy and read again: the host
//                reports every play it copies (a photo every few seconds), and reading the folder that often is work
//                for nothing; a minute is soon enough for a hide made on another screen.
export const HIDDEN_DEFAULTS = Object.freeze({ keep: 5000, pathMax: 500, nameMax: 200, syncDelayMs: 1500, readMax: 5000,
  lookEveryMs: 60000 });

const clip = (v, max) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max) : s; };
const shortId = (v) => { const s = String(v || '').trim(); return s && s.length <= 64 ? s : ''; };
const timeOf = (r) => { const t = Date.parse(r && r.created_at); return Number.isFinite(t) ? t : 0; };

/**
 * THE KEY A PICTURE IS HIDDEN BY: its path inside its source, slashes forward, no leading "./" or "/". '' when the item
 * has neither a path nor an id (nothing can be hidden then). Pure.
 */
export function pictureKey(item, { pathMax = HIDDEN_DEFAULTS.pathMax } = {}) {
  if (!item || typeof item !== 'object') return '';
  const raw = String(item.path || item.id || '').trim().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
  return raw.length > pathMax ? '' : raw;
}

/** One row's data, kept as it is written; null when it names no picture. Pure. */
export function normalizeHideData(raw, o = {}) {
  const opts = { ...HIDDEN_DEFAULTS, ...o };
  if (!raw || typeof raw !== 'object') return null;
  const path = pictureKey({ path: raw.path }, opts);
  if (!path) return null;
  const scope = HIDE_SCOPES.includes(raw.scope) ? raw.scope : DEFAULT_HIDE_SCOPE;
  const out = { id: shortId(raw.id) || '', path, scope };
  const name = clip(raw.name, opts.nameMax);
  if (name) out.name = name;
  const person = shortId(raw.person);
  if (scope === 'person') out.person = person;          // '' is "a screen nobody is known for"
  const screen = shortId(raw.screen);
  if (screen) out.screen = screen;
  const panel = shortId(raw.panel);
  if (panel) out.panel = panel;
  return out;
}

/** What one row is about: the same (scope, person, path) is the same entry. Pure. */
export const entryKey = (d) => `${d.scope}|${d.scope === 'person' ? (d.person || '') : ''}|${d.path}`;

/**
 * THE LOG REPLAYED: every entry whose newest row is a hide, as `{ key, path, name, scope, person, at, id }`, newest hide
 * first. `person` (optional) keeps only what applies on that person's screens: every 'everyone' entry, and the
 * 'person' entries that are theirs. Rows out of order are fine: it goes by `created_at`, then by place in the list. Pure.
 */
export function hiddenEntries(rows, { person } = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .map((r, i) => ({ r, i, t: timeOf(r) }))
    .filter(({ r }) => r && HIDDEN_KINDS.includes(r.kind) && r.data && typeof r.data === 'object')
    .sort((a, b) => (a.t - b.t) || (a.i - b.i));
  const last = new Map();
  for (const { r, t } of list) {
    const d = normalizeHideData(r.data);
    if (!d) continue;
    last.set(entryKey(d), { kind: r.kind, d, t, at: r.created_at });
  }
  const out = [];
  for (const [key, x] of last) {
    if (x.kind !== HIDE_KIND) continue;
    if (person !== undefined && x.d.scope === 'person' && (x.d.person || '') !== String(person || '')) continue;
    out.push({ key, path: x.d.path, name: x.d.name || '', scope: x.d.scope, person: x.d.person || '', at: x.at, t: x.t, id: x.d.id });
  }
  out.sort((a, b) => b.t - a.t);
  return out;
}

/** The paths hidden on a screen for `person` (a Set). Pure. */
export function hiddenPaths(rows, { person = '' } = {}) {
  return new Set(hiddenEntries(rows, { person }).map((e) => e.path));
}

/** The rows that still change something, oldest first: one hide per entry in force (unhides and superseded rows
 *  dropped). What the device keeps when it compacts. Pure. */
export function compactRows(rows) {
  const keep = new Set(hiddenEntries(rows).map((e) => e.key));
  const newest = new Map();
  (Array.isArray(rows) ? rows : []).forEach((r, i) => {
    if (!r || r.kind !== HIDE_KIND || !r.data) return;
    const d = normalizeHideData(r.data);
    if (!d || !keep.has(entryKey(d))) return;
    const cur = newest.get(entryKey(d));
    if (!cur || timeOf(r) >= timeOf(cur.r)) newest.set(entryKey(d), { r, i });
  });
  return [...newest.values()].sort((a, b) => (timeOf(a.r) - timeOf(b.r)) || (a.i - b.i)).map((x) => x.r);
}

/** The device's store: this browser's IndexedDB, or memory where there is none. */
let deviceStore = null;
export function hiddenDeviceStore() {
  if (!deviceStore) {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    deviceStore = idb ? idbPlayStore({ name: HIDDEN_DB, idb }) : memoryPlayStore();
  }
  return deviceStore;
}

const newRowId = () => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 24); } catch { /* below */ }
  return `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * A HANDLE OVER THE LOG. One per page (`deviceHiddenPictures`), shared by every slideshow on it, so a hide in one
 * panel is in force in all of them at once.
 *   ready                       resolves once the device record is read (never rejects)
 *   rows()                      the log as held now (oldest first)
 *   entries(person) / paths(person)   hiddenEntries / hiddenPaths over it
 *   hide({ path, name?, scope?, person?, screen?, panel? })   in force AT ONCE (memory), then saved, then copied to the
 *                               folder a moment later. Resolves the row, or null when it names no picture.
 *   unhide(entry)               an unhide row for that entry ({ path, scope, person }). Resolves the row, or null.
 *   sync()                      copy rows the folder does not have yet; resolves { sent, why? }
 *   pull()                      merge rows from the folder this device has not seen; resolves how many
 *   subscribe(fn)               told after every change
 * `folder()` returns the person's Nimrod folder sink (history_place.js nimrodFolder / folderSink shape) or null.
 */
export function createHiddenPictures({ store = memoryPlayStore(), folder = () => null, now = () => Date.now(),
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), makeId = newRowId, ...o } = {}) {
  const opts = { ...HIDDEN_DEFAULTS, ...o };
  const key = HIDDEN_RECORD;
  let rec = playRecord(key, null);
  const subs = new Set();
  let lastAt = 0;
  let syncTimer = null;
  let chain = Promise.resolve();
  const notify = () => { for (const f of [...subs]) { try { f(); } catch (e) { console.error('hidden pictures: subscriber', e); } } };
  const take = (r) => { rec = playRecord(key, r); };
  const ready = Promise.resolve().then(() => store.get(key))
    .then((r) => { if (r) { take(r); notify(); } })
    .catch((e) => { console.error('hidden pictures: load', e); });
  const sinkNow = () => { try { return folder() || null; } catch { return null; } };

  // A CLOCK THAT ONLY GOES FORWARD: every new row is newer than every row the log holds, its own or merged from the
  // folder. Two rows in one millisecond would share a marker otherwise, and a Pi with no clock battery can start up
  // behind its own log (or behind another screen's) - a row stamped before the folder's marker would never be copied.
  function stamp() {
    for (const r of rec.rows) { const x = timeOf(r); if (x > lastAt) lastAt = x; }
    let t = Number(now()) || Date.now();
    if (t <= lastAt) t = lastAt + 1;
    lastAt = t;
    return new Date(t).toISOString();
  }

  async function write(row) {
    rec = { ...rec, rows: [...rec.rows, row] };          // 1. in force now
    notify();
    try {                                                // 2. on this device
      const saved = await store.update(key, (r) => {
        let rows = [...(r.rows || []), row];
        if (rows.length > opts.keep) rows = compactRows(rows);
        return { ...r, rows };
      });
      take(saved);
    } catch (e) { console.error('hidden pictures: save', e); }
    syncSoon();                                          // 3. to the folder, a moment later
    return row;
  }

  function hide(raw = {}) {
    const data = normalizeHideData({ ...raw, id: makeId() }, opts);
    if (!data) return Promise.resolve(null);
    return write({ kind: HIDE_KIND, created_at: stamp(), data });
  }
  function unhide(entry = {}) {
    const data = normalizeHideData({ path: entry.path, scope: entry.scope, person: entry.person, name: entry.name,
      screen: entry.screen, panel: entry.panel, id: makeId() }, opts);
    if (!data) return Promise.resolve(null);
    return write({ kind: UNHIDE_KIND, created_at: stamp(), data });
  }

  function syncSoon() {
    if (syncTimer != null) clearTimer(syncTimer);
    syncTimer = setTimer(() => { syncTimer = null; sync(); }, opts.syncDelayMs);
  }

  async function syncNow() {
    const sink = sinkNow();
    if (!sink || typeof sink.append !== 'function') return { sent: 0, why: 'no folder' };
    let fid = null;
    if (typeof sink.id === 'function') {
      try { fid = await sink.id(); } catch { fid = null; }
      if (!fid) return { sent: 0, why: 'not reachable' };
    }
    let r;
    try { r = playRecord(key, await store.get(key)); } catch { return { sent: 0, why: 'device' }; }
    const mark = markFor(r.sent, 'folder', fid);
    const from = fid ? `folder@${fid}` : 'folder';
    // A row read FROM this folder is not sent back to it (`src`).
    const todo = r.rows.filter((x) => x && HIDDEN_KINDS.includes(x.kind) && String(x.created_at || '') > mark && x.src !== from);
    const newest = r.rows.filter((x) => x && String(x.created_at || '') > mark).map((x) => String(x.created_at)).sort().pop() || '';
    let upTo = mark;
    let sent = 0;
    let why = null;
    if (todo.length) {
      const res = await sink.append(HIDDEN_STREAM, HIDDEN_FILE_SCOPE, todo.map(({ kind, created_at, data }) => ({ kind, created_at, data })),
        { folderId: fid });
      if (res && res.ok) { sent = todo.length; upTo = newest; } else {
        why = (res && res.why) || 'write';
        if (res && res.upTo) { upTo = String(res.upTo); sent = todo.filter((x) => String(x.created_at) <= upTo).length; }
      }
    } else upTo = newest || mark;
    if (upTo && upTo !== mark) {
      try {
        take(await store.update(key, (x) => {
          const s = { ...(x.sent || {}) };
          if (fid) { s[folderMarkKey(fid)] = upTo; if (String(s.folder || '') < upTo) s.folder = upTo; } else s.folder = upTo;
          return { ...x, sent: s };
        }));
      } catch (e) { console.error('hidden pictures: marker', e); }
    }
    return { sent, ...(why ? { why } : {}) };
  }
  /** One copy at a time. Never throws. */
  function sync() {
    chain = chain.then(() => ready).then(syncNow).catch((e) => { console.error('hidden pictures: copy', e); return { sent: 0, why: 'error' }; });
    return chain;
  }

  /** Rows in the folder this device has not seen (another screen's hides), merged into the device log. Never throws. */
  async function pull() {
    const sink = sinkNow();
    if (!sink || typeof sink.read !== 'function') return 0;
    await ready;
    let got = [];
    try { got = (await sink.read(HIDDEN_STREAM, HIDDEN_FILE_SCOPE, opts.readMax)) || []; } catch { got = []; }
    if (!got.length) return 0;
    let fid = null;
    if (typeof sink.id === 'function') { try { fid = await sink.id(); } catch { fid = null; } }
    const from = fid ? `folder@${fid}` : 'folder';
    let added = 0;
    try {
      take(await store.update(key, (x) => {
        const seen = new Set((x.rows || []).map((r) => r && r.data && r.data.id).filter(Boolean));
        const fresh = [];
        for (const r of got) {
          if (!r || !HIDDEN_KINDS.includes(r.kind) || !r.data) continue;
          const d = normalizeHideData(r.data, opts);
          if (!d || !d.id || seen.has(d.id)) continue;
          seen.add(d.id);
          fresh.push({ kind: r.kind, created_at: String(r.created_at || ''), data: d, src: from });
        }
        added = fresh.length;
        if (!fresh.length) return x;
        let rows = [...(x.rows || []), ...fresh].sort((a, b) => timeOf(a) - timeOf(b));
        if (rows.length > opts.keep) rows = compactRows(rows);
        return { ...x, rows };
      }));
    } catch (e) { console.error('hidden pictures: merge', e); return 0; }
    if (added) notify();
    return added;
  }

  return {
    ready,
    rows: () => rec.rows.slice(),
    entries: (person) => hiddenEntries(rec.rows, person === undefined ? {} : { person }),
    paths: (person = '') => hiddenPaths(rec.rows, { person }),
    hide, unhide, sync, pull,
    // The list as one tagged object - what any copy of it outside the log carries (a backup, a hand-over), so the
    // server refuses it on sight (storage_line.py rule 7). The site's own code sends it nowhere.
    snapshot: () => ({ format: HIDDEN_FORMAT, v: 1, rows: rec.rows.map(({ kind, created_at, data }) => ({ kind, created_at, data })) }),
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    store,
    destroy() { if (syncTimer != null) clearTimer(syncTimer); syncTimer = null; subs.clear(); },
  };
}

// ---------- this page's one handle ----------
let device = null;
let deviceHistory = null;
/**
 * THE PAGE'S HANDLE over this device's log. `history` is the screen's history host (kiosk.js `ctx.history`): its
 * `folder` is where the copy goes. The newest host handed in is the one used.
 */
export function deviceHiddenPictures({ history = null } = {}) {
  if (!device) {
    device = createHiddenPictures({ store: hiddenDeviceStore(), folder: () => (deviceHistory && deviceHistory.folder) || null });
    device.ready.then(() => { device.pull(); device.sync(); });
  }
  if (history && history !== deviceHistory) {
    deviceHistory = history;
    // A folder that becomes reachable (a drive plugged in, "Allow it again") is told through the host: copy what
    // waited, and read what other screens wrote. The host tells about every copy it makes (each photo shown), so
    // this looks at most once a `lookEveryMs`.
    try { deviceUnwatch?.(); } catch { /* gone */ }
    let lastLook = 0;
    deviceUnwatch = typeof history.subscribe === 'function' ? history.subscribe(() => {
      const t = Date.now();
      if (t - lastLook < HIDDEN_DEFAULTS.lookEveryMs) return;
      lastLook = t;
      device.sync(); device.pull();
    }) : null;
  }
  return device;
}
let deviceUnwatch = null;
