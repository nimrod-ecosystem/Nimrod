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
//   games   game results (right or wrong, how long)       default: the site's log, AS IT IS NOW (not ruled yet)
//   words   the talk board's words                        default: the site's log, AS IT IS NOW (not ruled yet)
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
//   log     games and words only: the site's full, append-only event log, as before this change.
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

import { idbPlayStore, memoryPlayStore, playRecord } from './plays.js';
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
    what: 'each answer in a game: right or wrong, and how long it took', def: 'log',
    places: Object.freeze(['log', 'device', 'folder', 'us']) }),
  words: Object.freeze({ stream: 'words', kinds: Object.freeze(['select']), title: 'Talk board words',
    what: 'each word chosen on the talk board', def: 'log', places: Object.freeze(['log', 'device', 'folder', 'us']) }),
});
export const KIND_IDS = Object.freeze(Object.keys(HISTORY_KINDS));
export const SECOND_PLACES = Object.freeze(['folder', 'us']);

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
export const HISTORY_DEFAULTS = Object.freeze({ fileMax: 512 * 1024, batch: 200, rowMax: 1024, restoreMax: 500,
  syncDelayMs: 1500, keep: 1000 });

export const PLACE_WORDS = Object.freeze({
  device: 'This device only',
  folder: 'This device and your Nimrod folder',
  us: 'This device and with us',
  log: 'With us, every entry (as it is now)',
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
 *   ctx: { folder: 'ready'|'permission'|'none'|'missing'|'unavailable', withUs: { rows, counted }|null, cap }
 */
export function whereWords(kind, place, ctx = {}) {
  const k = HISTORY_KINDS[kind];
  if (!k) return '';
  const cap = Number(ctx.cap) || 10000;
  if (place === 'log') {
    return `Kept with us, every entry, in the site's log - as it has been. It cannot be removed from there yet. `
      + 'You can choose to keep it on this device, in your Nimrod folder, or with us under a limit instead.';
  }
  if (place === 'device') {
    return 'Only on this device, in this browser. A reset, clearing the browser or re-installing would lose it.';
  }
  if (place === 'folder') {
    const f = ctx.folder;
    if (f === 'ready') return 'On this device, and copied to the Data folder in your Nimrod folder.';
    if (f === 'permission') return 'On this device. Your Nimrod folder needs allowing again here before it is copied '
      + 'there: press "Allow it again". Nothing is lost meanwhile; it is copied when you do.';
    if (f === 'missing') return 'On this device. The Data folder is not in your Nimrod folder: "Set up your Nimrod folder '
      + 'again" makes it, and it is copied there then.';
    if (f === 'unavailable') return 'On this device only: this browser cannot write to a folder (Chrome and Edge can). '
      + 'On this device, choose "with us" for a second copy.';
    return 'On this device only, for now: this device has no Nimrod folder yet. Set one up (This screen, Your own '
      + 'folders) and it is copied there.';
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
  + 'files: they are yours, and deleting them here deletes them.\n';

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
    async append(stream, scope, rows) {
      let w;
      try { w = await where(); } catch (e) { return { ok: false, why: 'none' }; }
      if (w.state !== 'ready') return { ok: false, why: w.state };
      try {
        const h = await historyDir(w.dir);
        const months = new Map();
        for (const r of rows || []) {
          const m = monthOf(r.created_at);
          if (!months.has(m)) months.set(m, []);
          months.get(m).push(JSON.stringify({ at: r.created_at, kind: r.kind, data: r.data }));
        }
        for (const [m, lines] of months) await appendLines(h, `${safeName(stream)}-${safeName(scope)}-${m}`, `${lines.join('\n')}\n`);
        return { ok: true };
      } catch (e) {
        // Almost always a permission that lapsed mid-way: it wants a person, not a retry loop (fs_sink.js `sweep`).
        return { ok: false, why: 'write', error: String((e && e.message) || e) };
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
 */
export function createHistoryHost({ personId = () => null, makePersonState = null, folder = null, server = null,
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
        Promise.resolve(row.load?.()).then(() => { notify(); syncAll(); }).catch(() => {});
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
    syncAll();
    return place;
  }

  function remember(kind, store, key) { known.set(`${kind}:${key}`, { kind, store, key }); }

  async function syncNow(kind, store, key) {
    const k = HISTORY_KINDS[kind];
    const place = placeOf(kind);
    if (!k || !SECOND_PLACES.includes(place)) return { place, sent: 0 };
    const pid = pidNow();
    if (place === 'us' && (!server || !pid)) return { place, sent: 0, why: 'no server' };
    if (place === 'folder' && !folder) return { place, sent: 0, why: 'unavailable' };
    let rec;
    try { rec = playRecord(key, await store.get(key)); } catch { return { place, sent: 0, why: 'device' }; }
    const mark = String(rec.sent?.[place] || '');
    const todo = rec.rows.filter((r) => r && String(r.created_at || '') > mark && k.kinds.includes(r.kind));
    if (!todo.length) return { place, sent: 0 };
    let sent = 0;
    let why = null;
    let upTo = mark;
    if (place === 'folder') {
      const res = await folder.append(k.stream, scopeOf(key), todo);
      if (res.ok) { sent = todo.length; upTo = String(todo[todo.length - 1].created_at); } else why = res.why || 'write';
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
      try { await store.update(key, (r) => ({ ...r, sent: { ...(r.sent || {}), [place]: upTo } })); } catch (e) { console.error('history: marker', e); }
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
    let filled = false;
    await store.update(key, (r) => {
      if ((r.rows || []).length) return r;           // something was played here meanwhile: leave it
      filled = true;
      return { ...r, rows: rows.slice(-limit), restored: true, sent: { ...(r.sent || {}), [place]: newest } };
    });
    return filled;
  }

  /**
   * GAME RESULTS AND BOARD WORDS: an events handle (events.js's shape) that keeps the person's chosen kinds where
   * they chose. With the place at 'log' - the default for both until Mike rules - every call goes to `base`, exactly
   * as before. Otherwise the entries of `kinds` stay on this device (and its second place) and never reach the log;
   * every other kind still goes to `base`. `get()` is both together, oldest first, so a reader (progress.js, the
   * records page) sees one list.
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
          await store.update(recKey, (r) => ({ ...r, rows: [...(r.rows || []), row].slice(-cap) }));
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
    return { places: p, folder: f, withUs, cap, canUs: canUs(), person: !!pid && !!rowNow(), last: { ...last } };
  }

  async function allowFolder() {
    if (!folder) return 'unavailable';
    const p = await folder.allow();
    if (p === 'granted') syncAll();
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
    places, placeOf, setPlace, sync, syncAll, restore, route, status, allowFolder, removeWithUs,
    canUs, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    destroy() {
      for (const t of timers.values()) clearTimer(t);
      timers.clear(); subs.clear();
      try { offRow?.(); } catch { /* gone */ }
      try { row?.destroy?.(); } catch { /* gone */ }
    },
  };
}
