// history_place.js — WHERE A PERSON'S HISTORY IS KEPT: this device, their Nimrod folder, or with us (row 2.58).
//
// Mike, 2026-10-07: *"maybe make having us save it as an option if it's not going to take a lot of space or cost us
// anything. It has to be scalable though."* And for game results and the talk board's word log: *"I would lean
// towards at least recommending they keep stuff like this in their own system."* So their own system is the default
// and the recommendation; keeping it with us is something a person turns on.
//
// *** STATE AND HISTORY ARE TWO THINGS. *** State - levels, points, per item how often and when last played - is small
// and bounded by the size of a library, and stays where it was (the person's rows on the server) so it follows a
// person. HISTORY - every play, every answer, every word - grows without end, and goes where the person chooses. This
// file is the history half only.
//
// THE SETTING: one row on the PERSON (`history-place`, `makePersonState`), one place per kind of history:
//   plays   what played (photos, videos, songs)           default: this device                  (row 2.58, ruled)
//   games   game results (right or wrong, how long)       default: this device                  (ruled 2026-10-08)
//   words   the talk board's words                        default: this device                  (ruled 2026-10-08)
// (2026-10-08, row 2.58, note BK: Mike's "lean towards at least recommending they keep stuff like this in their own
// system", read by chat and passed on as: the person's own system is the default for game results and the word log,
// the server the opt-in. Until then both defaulted to the site's full log. What the site's log already holds stays
// there and is still read - `route` shows both as one list - so nothing is moved or removed; only new entries change
// place. `log` is still honoured for a person whose row says it, and the page offers it only to them.)
// PER PERSON, NOT PER SCREEN, argued:
//   * FOR per screen: the folder half is physically per device (a folder permission lives in one browser), and a
//     care-room screen and a phone might want different answers.
//   * FOR per person (chosen): the only choice the SERVER has to honour - "with us" or not - is a consent about a
//     person's records, not about a screen; one person with three screens should not find their record kept with us
//     from one of them and not the others. The per-device half is handled where it actually lives: "your Nimrod
//     folder" on a device with no Nimrod folder (or a browser that cannot write one) keeps it on that device and SAYS
//     so on the page, with a button for the other places. Changing this later is a key on the screen's row instead.
//
// THE PLACES, and what each means on a device:
//   device  this device only: the browser's own storage (IndexedDB). A reset, a cleared browser or a re-imaged Pi
//           loses it - the page says so and offers a second place.
//   folder  this device AND the Data folder in the person's Nimrod folder (user_folders.js), written by the page
//           itself through the File System Access API - no helper needed (the answer to chat's question).
//   us      this device AND the server, opted in, capped per person with the oldest rolled into totals
//           (web/server/storage_line.py rule 4, db.py history_append). Follows the person to another device.
//   log     games and words only: the site's full, append-only event log, as before 2026-10-08.
//
// *** HISTORY TO THE DRIVE: WHAT BUILT UP BEFORE THE FOLDER WAS CONNECTED IS COPIED WHEN IT IS (2026-10-08). ***
// Mike: *"We can have her info save to the drive in her room. That could be an issue bc I'm setting it up at home."*
// A screen set up at home with "your Nimrod folder" chosen, and its folder on a drive that is somewhere else, keeps
// everything on the device meanwhile; when the folder is first reachable - chosen, allowed again, or a drive plugged
// in - the host copies everything this person's records on the device hold that the folder does not have yet:
//   * WHEN: `watch()` looks every `watchMs` (and when the page gets focus back) whether the folder is reachable, and
//     on the change from "not" to "ready" - or to a DIFFERENT folder - copies (`backfill`). So does choosing a place,
//     "Allow it again", and the person's row arriving. Nothing prompts; a look is a permission query, never a request.
//   * WHAT: every record on this device that is this person's (`who`, stamped on the record; or, for a play record
//     from before the stamp, a play on this screen), not only the panels mounted right now - a panel removed or a
//     dashboard not shown since is still copied. Another person's records on a shared browser are not.
//   * ONCE: how far each record has gone is kept PER FOLDER (`sent['folder@<id>']`; the id is a small file the folder
//     carries, FOLDER_ID_FILE). So connecting the same drive again sends nothing twice, and a different folder - the
//     drive in the room after a folder on the screen's own card at home - gets everything the device still holds.
//   * NOT: what the device already let go of. A device keeps the newest `keep` per panel (plays.js 500, routed 1,000)
//     whether or not a folder is waiting; the page says so while one is. Argued in the 2026-10-08 report: growing the
//     device copy while waiting means rewriting a bigger record on every play, on an SD card.
// The device copy is kept in every case: it is what the weighted picker and the progress views read, at once and
// offline. A second place is a copy, filled from the device record's own marker (`sent`), so a closed tab, a lapsed
// folder permission or an hour offline is caught up the next time rather than lost or sent twice.
//
// *** NOTHING HERE PROMPTS ON ITS OWN OR WAITS FOR AN ANSWER. *** (The screen invariant, PRINCIPLES §1.1: no state
// only an input can leave.) A folder whose permission lapsed (Chrome asks again after a restart unless "Allow on
// every visit" was chosen) is skipped silently and the page says so with an "Allow it again" button - a press,
// because the browser only asks from one.
//
// Everything is injected (the person's row, the folder store, fetch, the timers), so the suite runs with no server,
// no picker and no real folder.

import { idbPlayStore, memoryPlayStore, playRecord, devicePlays, PLAYS_DEFAULTS } from './plays.js';
import { kindFolder, handleStore, permissionOf, allowAgain, subfolder, available as folderApi, ROOT_MODE } from './user_folders.js';
import { authHeaders } from './auth.js';

export const HISTORY_KEY = 'history-place';          // the person's row (web/server/storage_line.py HISTORY_KEY)
export const HISTORY_DB = 'nimrod-history';          // this browser's own copy of game results and board words
export const HISTORY_FOLDER = 'History';             // inside the Data folder

// The kinds. `stream` is the server's name (storage_line.py HISTORY_STREAMS); `kinds` the event kinds it carries.
export const HISTORY_KINDS = Object.freeze({
  plays: Object.freeze({ stream: 'plays', kinds: Object.freeze(['play']), title: 'What played',
    what: 'which photo, video or song played, and when', def: 'device', places: Object.freeze(['device', 'folder', 'us']) }),
  games: Object.freeze({ stream: 'gameplay', kinds: Object.freeze(['trial']), title: 'Game results',
    what: 'each answer in a game: right or wrong, and how long it took', def: 'device',
    places: Object.freeze(['device', 'folder', 'us', 'log']) }),
  words: Object.freeze({ stream: 'words', kinds: Object.freeze(['select']), title: 'Talk board words',
    what: 'each word chosen on the talk board', def: 'device', places: Object.freeze(['device', 'folder', 'us', 'log']) }),
});
export const KIND_IDS = Object.freeze(Object.keys(HISTORY_KINDS));
export const SECOND_PLACES = Object.freeze(['folder', 'us']);
// The small file in Data/History that names the folder, so a device knows what it already copied THERE (header).
export const FOLDER_ID_FILE = 'folder-id.txt';
// How far a record has gone to one folder: `folder@<its id>`. `sent.folder` stays "the newest copied to any folder".
export const folderMarkKey = (id) => `folder@${id}`;
/** How far a record's rows have gone to `place` (a folder: to THAT folder). '' = nothing yet. Pure.
 *  A record copied before folders had ids (312fab8, 2026-10-07) has only `sent.folder`: it is taken for the first
 *  folder seen with an id, and never again once any folder has its own mark. */
export function markFor(sent, place, folderId = null) {
  const s = sent && typeof sent === 'object' ? sent : {};
  if (place !== 'folder' || !folderId) return String(s[place] || '');
  const own = s[folderMarkKey(folderId)];
  if (own != null) return String(own);
  const anyOwn = Object.keys(s).some((k) => k.startsWith('folder@'));
  return anyOwn ? '' : String(s.folder || '');
}

// EVERY NUMBER HERE IS A DEFAULT (Rule 1), argued:
//   fileMax      a history file in the Data folder is rotated at 512 KiB. Appending through the browser copies the
//                file each time (createWritable keeps a swap copy), so a small file keeps each write cheap; a month of
//                heavy use is about 2 MB, so four files a month. Nothing in this file deletes a file in the
//                person's folder - it is theirs, and deleting their record would be the product deciding (fs_sink.js).
//   batch        rows sent to the server at once: the server's own most (storage_line.HISTORY_POST_MAX).
//   rowMax       an entry bigger than the server takes (storage_line.HISTORY_ROW_MAX_BYTES) stays on the device only,
//                rather than stopping every entry after it.
//   restoreMax   how many entries an EMPTY device fills itself with from the second place: the same 500 a panel keeps.
//   syncDelayMs  copies are sent a moment after the last entry, so a run of answers is one write, not twenty.
//   watchMs      how often a screen whose person chose the Nimrod folder looks whether it is reachable now (a drive
//                plugged in, a permission given on another page). A look is a permission query and one folder
//                lookup - no file is read - so 30 s costs nothing a Pi notices, and a drive plugged in is caught
//                within half a minute. Longer only delays the first copy; nothing is lost meanwhile.
export const HISTORY_DEFAULTS = Object.freeze({ fileMax: 512 * 1024, batch: 200, rowMax: 1024, restoreMax: 500,
  syncDelayMs: 1500, keep: 1000, watchMs: 30000 });

export const PLACE_WORDS = Object.freeze({
  device: 'This device only',
  folder: 'This device and your Nimrod folder',
  us: 'This device and with us',
  log: 'With us, every entry, in the site\'s log (as before)',
});

const placeOk = (kind, p) => !!HISTORY_KINDS[kind] && HISTORY_KINDS[kind].places.includes(p);

/** The person's row, read: `{ plays, games, words }`, each a place that kind can have (else its default). Pure. */
export function normalizePlaces(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of KIND_IDS) out[k] = placeOk(k, r[k]) ? r[k] : HISTORY_KINDS[k].def;
  return out;
}

/**
 * WHERE IT LIVES, IN WORDS - the line the page shows for one kind. Pure.
 *   ctx: { folder: 'ready'|'permission'|'none'|'missing'|'unavailable', withUs: { rows, counted }|null, cap,
 *          waiting: entries on this device not yet in a folder (a number, or absent) }
 */
export function whereWords(kind, place, ctx = {}) {
  const k = HISTORY_KINDS[kind];
  if (!k) return '';
  const cap = Number(ctx.cap) || 10000;
  if (place === 'log') {
    return `Kept with us, every entry, in the site's log - as it was before. It cannot be removed from there yet. `
      + 'You can choose to keep it on this device, in your Nimrod folder, or with us under a limit instead.';
  }
  if (place === 'device') {
    return 'Only on this device, in this browser. A reset, clearing the browser or re-installing would lose it.';
  }
  if (place === 'folder') {
    const f = ctx.folder;
    if (f === 'ready') return 'On this device, and copied to the Data folder in your Nimrod folder.';
    if (f === 'unavailable') return 'On this device only: this browser cannot write to a folder (Chrome and Edge can). '
      + 'On this device, choose "with us" for a second copy.';
    // NOT CONNECTED YET (2026-10-08, history to the drive): a folder chosen but not reachable here. Everything waits on
    // this device and is copied when it is - including what built up before (history_place.js header).
    const n = Number.isFinite(ctx.waiting) && ctx.waiting > 0 ? ctx.waiting : 0;
    const waiting = n ? ` ${n.toLocaleString('en-US')} ${n === 1 ? 'entry is' : 'entries are'} waiting.` : '';
    const keep = Number(ctx.keep) || (kind === 'plays' ? PLAYS_DEFAULTS.keep : HISTORY_DEFAULTS.keep);
    const pending = 'On this device for now. Will be copied to your Nimrod folder when it\'s connected. Until then '
      + `this device keeps the newest ${keep.toLocaleString('en-US')} for each panel.`;
    if (f === 'permission') return `${pending}${waiting} This device needs your Nimrod folder allowing again first: `
      + 'press "Allow it again".';
    if (f === 'missing') return `${pending}${waiting} Your Nimrod folder or its Data folder cannot be found here right `
      + 'now - a drive not plugged in, or a folder moved. Plug it in, or "Set up your Nimrod folder" again.';
    return `${pending}${waiting} This device has no Nimrod folder yet: set one up (This screen, Your own folders).`;
  }
  if (place === 'us') {
    const n = ctx.withUs && Number.isFinite(ctx.withUs.rows) ? ctx.withUs.rows : null;
    return `On this device, and kept with us so it follows this person to another device: the newest ${cap.toLocaleString('en-US')} `
      + 'entries in all, older ones counted rather than kept.' + (n != null ? ` ${n.toLocaleString('en-US')} kept with us now.` : '');
  }
  return '';
}

/** THE SECOND-PLACE OFFER for a kind kept on one device only: the sentence and the places offered, or null. Pure. */
export function secondPlaceOffer(kind, place, { folder = 'none', canUs = false } = {}) {
  if (place !== 'device' && !(place === 'folder' && folder !== 'ready')) return null;
  const offers = [];
  if (place !== 'folder' && folder !== 'unavailable') offers.push('folder');
  if (canUs) offers.push('us');
  if (!offers.length) return null;
  const ask = offers[0] === 'folder' ? 'Keep a copy in your Nimrod folder?' : 'Keep a copy with us?';
  return { text: `Only on this screen. A reset would lose it. ${ask}`, offers };
}

// ---------------------------------------------------------------------------------------------
// THE DATA FOLDER: JSON lines, one file per kind and panel (or screen) and month, rotated by size.
//   <Nimrod folder>/Data/History/<stream>-<scope>-<YYYY-MM>.jsonl, then ...-<YYYY-MM>.part2.jsonl
// One line per entry: {"at": <ISO>, "kind": "...", "data": {...}} - readable in any text editor, and by a script.
// ---------------------------------------------------------------------------------------------
const safeName = (s) => String(s || 'all').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'all';
const monthOf = (iso) => (/^\d{4}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 7) : 'undated');
const byteLen = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length);
const HISTORY_README = 'Your history from Nimrod, kept on this computer because you chose your Nimrod folder for it.\n'
  + 'One file per kind, per panel or screen, per month: plays-..., gameplay-..., words-... Each line is one entry:\n'
  + 'when it happened ("at"), what kind it is, and its data. Nothing here is uploaded, and Nimrod does not delete these\n'
  + 'files: they are yours, and deleting them here deletes them.\n'
  + `${FOLDER_ID_FILE} names this folder, so a device knows what it has already copied here. Deleting it only means\n`
  + 'each device copies everything it still holds here again.\n';
const newFolderId = () => {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* below */ }
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
const ID_RE = /^[A-Za-z0-9-]{6,64}$/;

function fileOrder(name) {
  const m = /-(\d{4}-\d{2}|undated)(?:\.part(\d+))?\.jsonl$/.exec(name);
  return m ? [m[1], Number(m[2] || 1)] : ['', 0];
}

/**
 * The Data folder as a place history can be copied to, on this device. Never prompts except `allow()`, which only a
 * press may call. `store` is user_folders.js's remembered handles.
 *   status()                   'ready' | 'permission' | 'missing' | 'none' | 'unavailable'
 *   append(stream, scope, rows)   { ok, why? }
 *   read(stream, scope, limit)    rows ({kind, created_at, data}), oldest first; [] when it cannot be read now
 *   allow()                    ask the browser again (A PRESS ONLY); resolves the permission
 */
export function folderSink({ store = handleStore(), view = (typeof window !== 'undefined' ? window : null),
  fileMax = HISTORY_DEFAULTS.fileMax } = {}) {
  async function where() {
    const k = await kindFolder('data', { store });
    if (k.source === 'none') return { state: folderApi(view) ? 'none' : 'unavailable', k };
    const permission = await permissionOf(k.holder, 'readwrite');
    if (permission !== 'granted') return { state: 'permission', k };
    let dir = null;
    if (k.source === 'own') dir = k.holder;
    else dir = await subfolder(k.holder, 'data');
    if (!dir) return { state: 'missing', k };
    return { state: 'ready', k, dir };
  }
  async function historyDir(dir) {
    const h = await dir.getDirectoryHandle(HISTORY_FOLDER, { create: true });
    try { await h.getFileHandle('README.txt'); } catch {
      try {
        const fh = await h.getFileHandle('README.txt', { create: true });
        const w = await fh.createWritable();
        try { await w.write(HISTORY_README); } finally { await w.close(); }
      } catch { /* the history still works without it */ }
    }
    return h;
  }
  async function appendLines(dir, base, text) {
    const bytes = byteLen(text);
    let part = 1;
    let fh = null;
    let size = 0;
    for (; part < 1000; part += 1) {
      const name = part === 1 ? `${base}.jsonl` : `${base}.part${part}.jsonl`;
      fh = await dir.getFileHandle(name, { create: true });
      size = (await fh.getFile()).size;
      if (size === 0 || size + bytes <= fileMax) break;
    }
    const w = await fh.createWritable({ keepExistingData: true });
    try { await w.seek(size); await w.write(text); } finally { await w.close(); }
  }
  return {
    kind: 'folder',
    async status() { try { return (await where()).state; } catch { return 'none'; } },
    /** WHICH FOLDER (history to the drive, 2026-10-08): the id in Data/History/folder-id.txt, made the first time;
     *  null when the folder cannot be reached (or written) right now. Never prompts. */
    async id() {
      let w;
      try { w = await where(); } catch { return null; }
      if (w.state !== 'ready') return null;
      try {
        const h = await historyDir(w.dir);
        try {
          const text = await (await (await h.getFileHandle(FOLDER_ID_FILE)).getFile()).text();
          const got = String(text || '').trim().split(/\s+/)[0];
          if (ID_RE.test(got)) return got;
        } catch { /* not there yet: made below */ }
        const made = newFolderId();
        const fh = await h.getFileHandle(FOLDER_ID_FILE, { create: true });
        const wr = await fh.createWritable();
        try { await wr.write(`${made}\n`); } finally { await wr.close(); }
        return made;
      } catch { return null; }
    },
    async append(stream, scope, rows) {
      let w;
      try { w = await where(); } catch (e) { return { ok: false, why: 'none' }; }
      if (w.state !== 'ready') return { ok: false, why: w.state };
      // `upTo`: the newest entry written, when a write stops part-way (one month's file written, the next refused), so
      // the device's marker moves past what IS in the folder and nothing is written there twice (history to the drive).
      let upTo = null;
      try {
        const h = await historyDir(w.dir);
        const months = new Map();
        for (const r of rows || []) {
          const m = monthOf(r.created_at);
          if (!months.has(m)) months.set(m, { lines: [], last: null });
          const g = months.get(m);
          g.lines.push(JSON.stringify({ at: r.created_at, kind: r.kind, data: r.data }));
          g.last = r.created_at;
        }
        for (const [m, g] of months) {
          await appendLines(h, `${safeName(stream)}-${safeName(scope)}-${m}`, `${g.lines.join('\n')}\n`);
          upTo = g.last;
        }
        return { ok: true };
      } catch (e) {
        // Almost always a permission that lapsed mid-way: it wants a person, not a retry loop (fs_sink.js `sweep`).
        return { ok: false, why: 'write', error: String((e && e.message) || e), ...(upTo ? { upTo: String(upTo) } : {}) };
      }
    },
    async read(stream, scope, limit = HISTORY_DEFAULTS.restoreMax) {
      let w;
      try { w = await where(); } catch { return []; }
      if (w.state !== 'ready') return [];
      let h;
      try { h = await w.dir.getDirectoryHandle(HISTORY_FOLDER); } catch { return []; }
      const prefix = `${safeName(stream)}-${safeName(scope)}-`;
      const names = [];
      for await (const [name, entry] of h.entries()) {
        if (entry.kind === 'file' && name.startsWith(prefix) && name.endsWith('.jsonl')) names.push(name);
      }
      names.sort((a, b) => { const [ma, pa] = fileOrder(a); const [mb, pb] = fileOrder(b); return ma.localeCompare(mb) || pa - pb; });
      const rows = [];
      for (const name of names) {
        let text = '';
        try { text = await (await (await h.getFileHandle(name)).getFile()).text(); } catch { continue; }
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            if (o && o.kind && o.data && typeof o.data === 'object') rows.push({ kind: o.kind, created_at: o.at, data: o.data });
          } catch { /* a line cut short by a closed tab: skipped, the rest still read */ }
        }
      }
      rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return rows.slice(-Math.max(1, limit));
    },
    async allow() {
      try {
        const k = await kindFolder('data', { store });
        if (!k.holder) return 'none';
        return await allowAgain(k.holder, k.source === 'own' ? 'readwrite' : ROOT_MODE);
      } catch { return 'denied'; }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// WITH US: the server's history route (web/server/app.py /api/people/{id}/history), opted in on the person's row.
// ---------------------------------------------------------------------------------------------
export function serverSink({ urlFor, user = null, fetchImpl = (...a) => fetch(...a) } = {}) {
  if (typeof urlFor !== 'function') return null;
  async function call(method, url, body) {
    try {
      const res = await fetchImpl(url, {
        method,
        headers: { ...authHeaders(user), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      return { ok: !!res.ok, status: res.status, json };
    } catch (e) { return { ok: false, status: 0, json: null, error: String((e && e.message) || e) }; }
  }
  return {
    kind: 'us',
    post: (pid, stream, rows) => call('POST', urlFor(pid, stream), { rows }),
    list: (pid, stream, { scope = '', limit = HISTORY_DEFAULTS.restoreMax } = {}) => call('GET',
      `${urlFor(pid, stream)}?limit=${encodeURIComponent(limit)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`),
    summary: (pid) => call('GET', urlFor(pid, '')),
    remove: (pid, stream = '') => call('DELETE', `${urlFor(pid, '')}${stream ? `?stream=${encodeURIComponent(stream)}` : ''}`),
  };
}

// The device copy of game results and board words (plays keep theirs in plays.js's own `nimrod-plays`).
let deviceStore = null;
export function historyDeviceStore() {
  if (!deviceStore) {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    deviceStore = idb ? idbPlayStore({ name: HISTORY_DB, idb }) : memoryPlayStore();
  }
  return deviceStore;
}

/** EVERY RECORD THIS DEVICE KEEPS, for `backfill` (history to the drive): what played (plays.js's own store, kind
 *  'plays') and the routed game results and board words (this file's store, kind read off each record's key). */
export function deviceSweep() {
  return [{ kind: 'plays', store: devicePlays().store }, { kind: null, store: historyDeviceStore() }];
}
/** The kind a routed record's key says (`gameplay:<screen>` -> 'games', `words:<panel>` -> 'words'), or null. Pure. */
export function kindOfKey(key) {
  const s = String(key || '').split(':')[0];
  return KIND_IDS.find((id) => id !== 'plays' && HISTORY_KINDS[id].stream === s) || null;
}

const rowBytes = (data) => byteLen(JSON.stringify(data ?? null));
// What a record is filed under in the folder and with us: its panel or screen, without the `<stream>:` a routed
// record's device key carries (the server takes an id-shaped word, app.py ID_RE).
export const scopeOf = (key) => safeName(String(key || '').includes(':') ? String(key).split(':').slice(1).join('_') : key);

// ---------------------------------------------------------------------------------------------
// THE HOST: one per screen. Reads the person's row, copies device records to the second place, fills an empty
// device, and routes the game-results and board-word streams.
// ---------------------------------------------------------------------------------------------
/**
 *   personId()                  whose history (the screen's person); null until known - everything waits quietly
 *   makePersonState(pid, key)   the person's row (kiosk.js ctx.makePersonState); null: defaults, nothing with us
 *   folder                      folderSink() or null;  server  serverSink() or null
 *   screenId()                  the screen's id: a play record from before `who` was stamped counts as this person's
 *                               when it has a play on this screen (history to the drive, 2026-10-08)
 *   sweep                       [{ kind|null, store }]: every record on the device, for `backfill` (deviceSweep());
 *                               null: only the records this page has mounted (the suites, before 2026-10-08)
 *   view                        where `watch` hears the page get focus back (window); null: the timer only
 */
export function createHistoryHost({ personId = () => null, makePersonState = null, folder = null, server = null,
  screenId = () => null, sweep = null, view = null,
  defaults = HISTORY_DEFAULTS, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t) } = {}) {
  const opts = { ...HISTORY_DEFAULTS, ...(defaults || {}) };
  let row = null;
  let rowPid = null;
  let offRow = null;
  const subs = new Set();
  const known = new Map();           // `${kind}:${key}` -> { kind, store, key } : every record this screen has seen
  const timers = new Map();
  const chains = new Map();          // one copy at a time per record
  const last = {};                   // kind -> { place, ok, why, sent, at } : the newest copy attempt, for the page
  const notify = () => { for (const f of [...subs]) { try { f(); } catch (e) { console.error('history: subscriber', e); } } };

  function rowNow() {
    let pid = null;
    try { pid = personId() || null; } catch { pid = null; }
    if (!pid || typeof makePersonState !== 'function') return null;
    if (pid !== rowPid) {
      try { offRow?.(); } catch { /* gone */ }
      try { row?.destroy?.(); } catch { /* gone */ }
      rowPid = pid;
      try { row = makePersonState(pid, HISTORY_KEY) || null; } catch { row = null; }
      if (row) {
        try { offRow = row.subscribe?.(() => notify()) || null; } catch { offRow = null; }
        Promise.resolve(row.load?.()).then(() => { notify(); backfill(); }).catch(() => {});
        try { row.startPolling?.(); } catch { /* push or nothing */ }
      }
    }
    return row;
  }
  const places = () => { const r = rowNow(); let raw = null; try { raw = r?.get?.(); } catch { raw = null; } return normalizePlaces(raw); };
  const placeOf = (kind) => places()[kind] || HISTORY_KINDS[kind]?.def || 'device';
  const pidNow = () => { try { return personId() || null; } catch { return null; } };
  const canUs = () => !!server && !!rowNow();

  async function setPlace(kind, place) {
    if (!placeOk(kind, place)) throw new Error(`no such place for ${kind}: ${place}`);
    const r = rowNow();
    if (!r?.set) throw new Error('This screen does not know whose history it is yet.');
    if (place === 'us' && !server) throw new Error('This page cannot reach the site to keep anything with us.');
    r.set({ [kind]: place });
    // Saved before the first copy is sent: the server reads this row on every write, and refuses until it says "us".
    try { await r.flush?.(); } catch { /* the copy waits and tries again */ }
    notify();
    backfill();
    return place;
  }

  function remember(kind, store, key) { known.set(`${kind}:${key}`, { kind, store, key }); }

  // WHOSE A RECORD IS (history to the drive): stamped on the record (`who`) the first time this host handles it with
  // the person known, so a sweep of the whole device copies this person's records and never another's.
  async function stamp(store, key, rec) {
    const pid = pidNow();
    if (!pid || !rec || rec.who) return;
    try { await store.update(key, (r) => (r.who ? r : { ...r, who: pid })); } catch { /* next time */ }
  }
  function belongs(kind, rec) {
    if (!rec) return false;
    const pid = pidNow();
    if (rec.who) return !!pid && rec.who === pid;
    if (kind !== 'plays') return false;
    let sid = null;
    try { sid = screenId() || null; } catch { sid = null; }
    return !!sid && (rec.rows || []).some((r) => r && r.data && r.data.screen === sid);
  }
  // This person's records on the device: those this page handled, and (with `sweep`) every other one that is theirs.
  async function records(kind = null) {
    const out = new Map();
    for (const x of known.values()) if (!kind || x.kind === kind) out.set(`${x.kind}:${x.key}`, x);
    for (const sw of sweep || []) {
      let all = [];
      try { all = (await sw.store.all()) || []; } catch { all = []; }
      for (const rec of all) {
        const kd = sw.kind || kindOfKey(rec.k);
        if (!kd || (kind && kd !== kind) || out.has(`${kd}:${rec.k}`) || !belongs(kd, rec)) continue;
        out.set(`${kd}:${rec.k}`, { kind: kd, store: sw.store, key: rec.k });
      }
    }
    return [...out.values()];
  }

  async function syncNow(kind, store, key) {
    const k = HISTORY_KINDS[kind];
    const place = placeOf(kind);
    let rec0 = null;
    try { rec0 = await store.get(key); } catch { rec0 = null; }
    await stamp(store, key, rec0);
    if (!k || !SECOND_PLACES.includes(place)) return { place, sent: 0 };
    const pid = pidNow();
    if (place === 'us' && (!server || !pid)) return { place, sent: 0, why: 'no server' };
    if (place === 'folder' && !folder) return { place, sent: 0, why: 'unavailable' };
    // WHICH FOLDER (history to the drive): how far this record went to THIS folder; a folder seen for the first time
    // gets everything the device still holds. A sink without ids (a suite's own) keeps the one `sent.folder` marker.
    let fid = null;
    if (place === 'folder' && typeof folder.id === 'function') {
      fid = await folder.id();
      if (!fid) {
        let st = 'none';
        try { st = await folder.status(); } catch { st = 'none'; }
        last[kind] = { place, ok: false, why: st === 'ready' ? 'write' : st, sent: 0, at: Date.now() };
        notify();
        return { place, sent: 0, why: last[kind].why };
      }
    }
    let rec;
    try { rec = playRecord(key, await store.get(key)); } catch { return { place, sent: 0, why: 'device' }; }
    const mark = markFor(rec.sent, place, fid);
    const todo = rec.rows.filter((r) => r && String(r.created_at || '') > mark && k.kinds.includes(r.kind));
    if (!todo.length) {
      // Nothing new for this folder: a record taken over from the old single marker gets its own, so the next folder
      // seen does not mistake that marker for its own.
      if (fid && rec.sent[folderMarkKey(fid)] == null && mark) {
        try { await store.update(key, (r) => ({ ...r, sent: { ...(r.sent || {}), [folderMarkKey(fid)]: mark } })); } catch { /* next time */ }
      }
      return { place, sent: 0 };
    }
    let sent = 0;
    let why = null;
    let upTo = mark;
    if (place === 'folder') {
      const res = await folder.append(k.stream, scopeOf(key), todo);
      if (res.ok) { sent = todo.length; upTo = String(todo[todo.length - 1].created_at); } else {
        why = res.why || 'write';
        if (res.upTo) { upTo = String(res.upTo); sent = todo.filter((r) => String(r.created_at || '') <= upTo).length; }
      }
    } else {
      for (let i = 0; i < todo.length; i += opts.batch) {
        const chunk = todo.slice(i, i + opts.batch);
        const body = chunk.filter((r) => rowBytes(r.data) <= opts.rowMax)
          .map((r) => ({ kind: r.kind, data: r.data, at: r.created_at, scope: scopeOf(key) }));
        const res = body.length ? await server.post(pid, k.stream, body) : { ok: true, status: 200 };
        if (res.ok) { sent += body.length; upTo = String(chunk[chunk.length - 1].created_at); continue; }
        // Not opted in on the server yet, signed out, offline, the server down: keep the marker, try again later.
        // Any other refusal would refuse these same entries for ever: they stay on this device, and the copy moves on.
        if ([0, 401, 403, 408, 429].includes(res.status) || res.status >= 500) { why = res.status === 403 ? 'not opted in' : 'offline'; break; }
        why = (res.json && res.json.detail) || `refused (${res.status})`;
        upTo = String(chunk[chunk.length - 1].created_at);
      }
    }
    if (upTo !== mark) {
      try {
        await store.update(key, (r) => {
          const s = { ...(r.sent || {}) };
          if (fid) {
            s[folderMarkKey(fid)] = upTo;
            if (String(s.folder || '') < upTo) s.folder = upTo;      // "the newest copied to any folder"
          } else s[place] = upTo;
          return { ...r, sent: s };
        });
      } catch (e) { console.error('history: marker', e); }
    }
    last[kind] = { place, ok: !why, why, sent, at: Date.now() };
    notify();
    return { place, sent, why };
  }

  /** Copy one device record's new entries to the person's second place. `soon`: after a short pause (a run of
   *  answers is one write). Never throws; resolves { place, sent, why? }. */
  function sync(kind, store, key, { soon = false } = {}) {
    if (!HISTORY_KINDS[kind] || !store) return Promise.resolve({ sent: 0 });
    remember(kind, store, key);
    const id = `${kind}:${key}`;
    if (soon) {
      if (timers.has(id)) clearTimer(timers.get(id));
      timers.set(id, setTimer(() => { timers.delete(id); sync(kind, store, key); }, opts.syncDelayMs));
      return Promise.resolve({ sent: 0, queued: true });
    }
    const run = (chains.get(id) || Promise.resolve()).then(() => syncNow(kind, store, key))
      .catch((e) => { console.error('history: copy', e); return { sent: 0, why: 'error' }; });
    chains.set(id, run);
    return run;
  }
  function syncAll() { return Promise.all([...known.values()].map((x) => sync(x.kind, x.store, x.key))); }

  /** COPY EVERYTHING THAT WAITED (history to the drive, 2026-10-08): every record of this person's on the device -
   *  not only the panels mounted now - for each kind whose place is a second place, sent from its own marker, so
   *  nothing goes twice. Resolves [{ place, sent, why? }]. Never throws. */
  async function backfill() {
    try {
      const p = places();
      if (!KIND_IDS.some((k) => SECOND_PLACES.includes(p[k]))) return [];
      for (const x of await records()) if (SECOND_PLACES.includes(p[x.kind])) remember(x.kind, x.store, x.key);
      return await syncAll();
    } catch (e) { console.error('history: backfill', e); return []; }
  }

  /** WATCH FOR THE FOLDER (history to the drive): while any kind's place is the Nimrod folder, look every `watchMs`
   *  (and when the page gets focus back) whether it is reachable; when it becomes so, or becomes a DIFFERENT folder,
   *  copy everything that waited. A look never prompts. Returns { stop, check } (`check` resolves the folder's state). */
  let watching = null;
  function watch({ everyMs = opts.watchMs } = {}) {
    if (watching) return watching;
    let seen = null;
    let seenId = null;
    let timer = null;
    let stopped = false;
    let running = null;
    async function look() {
      const p = places();
      if (!folder || !KIND_IDS.some((k) => p[k] === 'folder')) { seen = null; seenId = null; return 'unused'; }
      let st = 'none';
      try { st = await folder.status(); } catch { st = 'none'; }
      let fid = null;
      if (st === 'ready' && typeof folder.id === 'function') fid = await folder.id();
      const changed = st !== seen;
      if (st === 'ready' && (seen !== 'ready' || fid !== seenId)) await backfill();
      seen = st; seenId = fid;
      if (changed) notify();
      return st;
    }
    const check = () => {
      if (!running) running = look().catch((e) => { console.error('history: watch', e); return 'none'; }).finally(() => { running = null; });
      return running;
    };
    const next = () => {
      if (stopped) return;
      timer = setTimer(() => { timer = null; Promise.resolve(check()).finally(next); }, Math.max(1000, Number(everyMs) || opts.watchMs));
    };
    const onFocus = () => { if (!stopped) check(); };
    const onVis = () => { if (!stopped && (!view?.document || view.document.visibilityState !== 'hidden')) check(); };
    try { view?.addEventListener?.('focus', onFocus); view?.document?.addEventListener?.('visibilitychange', onVis); } catch { /* no events here */ }
    check();
    next();
    watching = {
      check,
      stop() {
        stopped = true;
        if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; }
        try { view?.removeEventListener?.('focus', onFocus); view?.document?.removeEventListener?.('visibilitychange', onVis); } catch { /* gone */ }
        watching = null;
      },
    };
    return watching;
  }

  /** AN EMPTY DEVICE FILLS ITSELF from the person's second place, once (a new device, a re-imaged Pi). Resolves
   *  true when it filled the record. A folder that cannot be read right now is not "empty": it tries again later. */
  async function restore(kind, store, key, { keep = opts.restoreMax } = {}) {
    const k = HISTORY_KINDS[kind];
    if (!k || !store) return false;
    remember(kind, store, key);
    const place = placeOf(kind);
    if (!SECOND_PLACES.includes(place)) return false;
    let rec;
    try { rec = await store.get(key); } catch { return false; }
    if (rec && ((rec.rows || []).length || rec.restored)) return false;
    let rows = [];
    const limit = Math.min(Number(keep) || opts.restoreMax, opts.restoreMax);
    if (place === 'us') {
      const pid = pidNow();
      if (!server || !pid) return false;
      const res = await server.list(pid, k.stream, { scope: scopeOf(key), limit });
      if (!res.ok) return false;
      rows = ((res.json && res.json.rows) || []).map((r) => ({ kind: r.kind, created_at: r.at, data: r.data }));
    } else if (folder) {
      rows = await folder.read(k.stream, scopeOf(key), limit);
    }
    rows = rows.filter((r) => r && k.kinds.includes(r.kind) && r.data);
    if (!rows.length) return false;
    const newest = String(rows[rows.length - 1].created_at || '');
    // The folder it came from is marked by its own id, so it is not sent back there (history to the drive).
    const fid = place === 'folder' && typeof folder?.id === 'function' ? await folder.id() : null;
    const pid = pidNow();
    let filled = false;
    await store.update(key, (r) => {
      if ((r.rows || []).length) return r;           // something was played here meanwhile: leave it
      filled = true;
      const sent = { ...(r.sent || {}), [place]: newest, ...(fid ? { [folderMarkKey(fid)]: newest } : {}) };
      return { ...r, rows: rows.slice(-limit), restored: true, sent, ...(pid && !r.who ? { who: pid } : {}) };
    });
    return filled;
  }

  /**
   * GAME RESULTS AND BOARD WORDS: an events handle (events.js's shape) that keeps the person's chosen kinds where
   * they chose. Since 2026-10-08 their default is this device: the entries of `kinds` stay on this device (and its
   * second place) and never reach the log; every other kind still goes to `base`. With the place at 'log' (a person
   * whose row says so) every call goes to `base`, exactly as before. `get()` is both together, oldest first, so a
   * reader (progress.js, the records page) sees one list - including what the site's log held before the change.
   */
  function route(kind, base, { key, store = historyDeviceStore(), keep = opts.keep } = {}) {
    const k = HISTORY_KINDS[kind];
    if (!k || !base || !key) return base;
    const recKey = `${k.stream}:${key}`;
    let local = [];
    let loaded = false;
    const lsubs = new Set();
    const cap = Math.max(1, Number(keep) | 0);
    const merged = () => {
      const b = (base.get && base.get()) || { events: [], total: 0 };
      if (!local.length) return b;
      const events = [...(b.events || []), ...local]
        .sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')));
      return { ...b, events, total: (b.total || 0) + local.length };
    };
    const tell = () => { const c = merged(); for (const f of [...lsubs]) { try { f(c); } catch (e) { console.error('history: route subscriber', e); } } };
    async function loadLocal() {
      try {
        const rec = await store.get(recKey);
        local = rec && Array.isArray(rec.rows) ? rec.rows : [];
        loaded = true;
        if (await restore(kind, store, recKey, { keep: cap })) {
          const again = await store.get(recKey);
          local = again && Array.isArray(again.rows) ? again.rows : local;
        }
        sync(kind, store, recKey);
      } catch (e) { console.error('history: load', e); }
    }
    return {
      async load() {
        await Promise.all([Promise.resolve(base.load?.()).catch(() => null), loadLocal()]);
        tell();
        return merged();
      },
      async append(ev, data = {}, meta = null) {
        const place = placeOf(kind);
        if (place === 'log' || !k.kinds.includes(ev)) return base.append(ev, data, meta);
        const row = { kind: ev, created_at: new Date().toISOString(), data };
        local = [...local, row].slice(-cap);
        tell();
        try {
          const who = pidNow();       // whose it is, for a sweep of the whole device (history to the drive)
          await store.update(recKey, (r) => ({ ...r, rows: [...(r.rows || []), row].slice(-cap), ...(who && !r.who ? { who } : {}) }));
          sync(kind, store, recKey, { soon: true });
        } catch (e) { console.error('history: save', e); }   // counted for this visit; a store that refuses is not fatal
        return row;
      },
      attest: (...a) => base.attest?.(...a),
      get: merged,
      subscribe(fn) {
        lsubs.add(fn);
        const off = base.subscribe ? base.subscribe(() => { try { fn(merged()); } catch (e) { console.error(e); } }) : null;
        if (loaded && local.length) { try { fn(merged()); } catch (e) { console.error(e); } }
        return () => { lsubs.delete(fn); try { off?.(); } catch { /* gone */ } };
      },
      startPolling: () => base.startPolling?.(),
      destroy: () => { lsubs.clear(); return base.destroy?.(); },
      routed: kind,
    };
  }

  /** The page's reading: each kind's place, the folder's state on this device, what is kept with us. */
  async function status() {
    const p = places();
    const f = folder ? await folder.status() : 'unavailable';
    let withUs = null;
    let cap = null;
    const pid = pidNow();
    if (server && pid && KIND_IDS.some((k) => p[k] === 'us' || last[k]?.place === 'us')) {
      const res = await server.summary(pid);
      if (res.ok && res.json) { withUs = res.json.kept || {}; cap = res.json.cap?.rows || null; }
    }
    // WAITING FOR THE FOLDER (history to the drive): entries on this device not yet in any folder, per kind whose
    // place is the folder and which cannot be copied right now - the number the page's "will be copied" line says.
    const waiting = {};
    if (f !== 'ready') {
      for (const kind of KIND_IDS) {
        if (p[kind] !== 'folder') continue;
        let n = 0;
        for (const x of await records(kind)) {
          let rec = null;
          try { rec = await x.store.get(x.key); } catch { rec = null; }
          if (!rec) continue;
          const mark = String((rec.sent && rec.sent.folder) || '');
          n += (rec.rows || []).filter((r) => r && String(r.created_at || '') > mark && HISTORY_KINDS[kind].kinds.includes(r.kind)).length;
        }
        waiting[kind] = n;
      }
    }
    return { places: p, folder: f, withUs, cap, canUs: canUs(), person: !!pid && !!rowNow(), last: { ...last }, waiting };
  }

  async function allowFolder() {
    if (!folder) return 'unavailable';
    const p = await folder.allow();
    if (p === 'granted') backfill();
    notify();
    return p;
  }

  async function removeWithUs(kind = null) {
    const pid = pidNow();
    if (!server || !pid) return { ok: false };
    const res = await server.remove(pid, kind ? HISTORY_KINDS[kind]?.stream || '' : '');
    // Nothing kept with us any more: the next copy, if "with us" is still chosen, starts from what is on the device.
    if (res.ok) {
      for (const x of known.values()) {
        if (kind && x.kind !== kind) continue;
        try { await x.store.update(x.key, (r) => { const s = { ...(r.sent || {}) }; delete s.us; return { ...r, sent: s }; }); } catch { /* next time */ }
      }
    }
    notify();
    return { ok: res.ok, ...(res.json || {}) };
  }

  return {
    places, placeOf, setPlace, sync, syncAll, backfill, watch, restore, route, status, allowFolder, removeWithUs,
    canUs, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    destroy() {
      try { watching?.stop(); } catch { /* gone */ }
      for (const t of timers.values()) clearTimer(t);
      timers.clear(); subs.clear();
      try { offRow?.(); } catch { /* gone */ }
      try { row?.destroy?.(); } catch { /* gone */ }
    },
  };
}
