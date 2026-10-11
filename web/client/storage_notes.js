// storage_notes.js — HOW THE DRIVES ARE DOING, SAVED TO THE PERSON'S OWN NIMROD FOLDER, so it can be seen away from home.
//
// WHY (Mike, 2026-10-10; DECISIONS.md, "A drive's status is saved wherever the person chooses, not on the server by
// default"): *"I think the point of the g drive is so you can see things anywhere. Let it be saved wherever the user
// wants."* The Storage section (storage_view.js) reads each drive's status files straight from the drive, which only
// works on the drive's own network. So whenever a page reads a drive, it also notes what it read - times, counts and
// free space - and the note goes where the person keeps their Nimrod folder. If that folder is on Google Drive (or any
// folder a sync program keeps), the note can be read from anywhere that folder can be opened: by another browser's
// Storage section, or by anybody opening the file.
//
// *** THE SAME WRITER, FILES AND MARKERS AS THE PLAY HISTORY AND THE HIDDEN-PICTURE LIST - NOT A SECOND MECHANISM. ***
//   * WHERE: the person's Nimrod folder sink (history_place.js `nimrodFolder` / `folderSink`): the media agent on this
//     computer when it offers history, else the browser folder. Data/History/storage-drives-<YYYY-MM>.jsonl, one line
//     per note, rotated by size exactly like the other history files, readable in any text editor.
//   * ONCE: notes wait in this browser's own record (IndexedDB `nimrod-storage-notes`) with a marker per folder
//     (`sent['folder@<id>']`, history_place.js markFor / folderMarkKey). A folder that cannot be reached right now (a
//     drive unplugged, a permission that lapsed) gets what waited when it can be; the same folder never gets a note
//     twice; a different folder gets everything the browser still holds.
//   * NO FOLDER CHOSEN, NOTHING SAVED: a note is only made when this device has a Nimrod folder (reachable now or not).
//     With none chosen ('none'), or a browser that cannot use one ('unavailable'), nothing is kept - not even here.
//
// *** WHAT A NOTE HOLDS, AND NEVER HOLDS. *** One note per drive per look: its id and name, what kind of source it is,
// its address (host and port only - never the path after it), who read it (a random id for this browser and, on a
// screen, the screen's name), and for each status file: when the copy ran, how many pictures were new, changed or set
// aside, how many it holds, how many were left out for space, free space and the space it keeps free, whether it
// finished, and its short reason when it did not. NEVER a file name, a folder name inside the drive, or a path: the
// fields are copied one by one from a fixed list (NOTE_FIELDS), and a reason that looks like a path is dropped.
//
// *** NOTHING HERE GOES TO THE SITE. *** This file has no fetch and no address of ours: the sink is the person's folder
// (or the agent on their own computer). web/server/storage_line.py rule 8 refuses a note on every route anyway, by its
// tag (NOTE_FORMAT), its row kind (NOTE_KIND) and its stream (NOTES_STREAM), held equal by test_storage_line.py.
//
// EVERY NUMBER HERE IS A DEFAULT (Rule 1), argued:
//   keep        notes this browser holds while a folder cannot be reached: 200. A note is ~0.5-1 KB; a household with
//               five drives noted every six hours is twenty a day, so 200 is ten days of a drive unplugged, and what is
//               dropped past it is the OLDEST - the newest note per drive, the one anybody reads, always survives.
//   readMax     notes read back from the folder: 2,000, the newest. At twenty a day per reader that is three months -
//               every drive anybody still looks at is in it. history_place.js reads newest months first, so this is
//               also what bounds the work.
//   nameMax     a drive's name, as the person named it: 80 characters (a label, not a description).
//   whyMax      a copy's reason for not finishing: 120, the same cut storage_view.js readCopyStatus makes.
// THE TWO CHOICES A PERSON MAKES live in the Storage section (storage_view.js: "Save to your Nimrod folder", and how
// often a note is made again when nothing changed); this file takes them as arguments.

import { idbPlayStore, memoryPlayStore, playRecord } from './plays.js';
import { markFor, folderMarkKey } from './history_place.js';
import { agentBase, addressScope } from './media_sources.js';

export const NOTES_STREAM = 'storage';          // the folder's file name starts with it (agent HISTORY_STREAM_RE)
export const NOTES_FILE_SCOPE = 'drives';       // ... then this: storage-drives-<month>.jsonl
export const NOTE_KIND = 'drive-status';
export const NOTE_FORMAT = 'nimrod-drive-status';   // the server refuses anything carrying it (storage_line.py rule 8)
export const NOTES_DB = 'nimrod-storage-notes';
export const NOTES_RECORD = 'storage:drives';
export const NOTES_BY_KEY = 'nimrod-storage-by';    // this browser's random reader id (localStorage)
export const NOTES_DEFAULTS = Object.freeze({ keep: 200, readMax: 2000, nameMax: 80, whyMax: 120 });
// The folder states in which a note is made: chosen, reachable now or later. 'none' and 'unavailable' make nothing.
export const SAVE_STATES = Object.freeze(['ready', 'permission', 'missing', 'write']);
// The only fields a note's copy carries - the status file's own names, so storage_view.js readCopyStatus reads a note
// back exactly as it reads the file. Nothing else is copied, whatever the file holds.
export const NOTE_FIELDS = Object.freeze(['at', 'job', 'role', 'from_role', 'every', 'new', 'changed', 'removed', 'files',
  'left_for_space', 'free_bytes', 'keep_free_bytes', 'ok', 'why']);

const clip = (v, max) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max) : s; };
const shortId = (v) => { const s = String(v || '').trim(); return s && s.length <= 64 ? s : ''; };
const timeOf = (r) => { const t = Date.parse(r && r.created_at); return Number.isFinite(t) ? t : 0; };
const whole = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null);
const looksLikePath = (s) => /[\\/]/.test(s);

/** This browser's reader id: random, made once, kept in this browser (a new one per page when storage is blocked). */
export function readerId(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    const have = storage?.getItem(NOTES_BY_KEY);
    if (have && /^[A-Za-z0-9-]{6,64}$/.test(have)) return have;
  } catch { /* below */ }
  let made = '';
  try { made = globalThis.crypto?.randomUUID?.() || ''; } catch { made = ''; }
  if (!made) made = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try { storage?.setItem(NOTES_BY_KEY, made); } catch { /* this page only */ }
  return made;
}

/** One status file's copy, as a note keeps it (raw file JSON, or storage_view.js readCopyStatus's answer). Pure. */
export function noteCopy(c, { whyMax = NOTES_DEFAULTS.whyMax } = {}) {
  if (!c || typeof c !== 'object' || typeof c.at !== 'string' || !Number.isFinite(Date.parse(c.at))) return null;
  // readCopyStatus's camelCase names, mapped back to the file's own.
  const src = {
    ...c,
    from_role: c.from_role ?? c.fromRole, left_for_space: c.left_for_space ?? c.leftForSpace,
    free_bytes: c.free_bytes ?? c.freeBytes, keep_free_bytes: c.keep_free_bytes ?? c.keepFreeBytes,
  };
  const out = {};
  for (const f of NOTE_FIELDS) {
    const v = src[f];
    if (v === undefined || v === null || v === '') continue;
    if (f === 'at') out.at = clip(v, 40);
    else if (f === 'ok') out.ok = v !== false;
    else if (f === 'why') { const w = clip(v, whyMax); if (w && !looksLikePath(w)) out.why = w; }
    else if (['job', 'role', 'from_role', 'every'].includes(f)) { const w = clip(v, 40); if (w && !looksLikePath(w)) out[f] = w; }
    else { const n = whole(v); if (n != null) out[f] = n; }
  }
  return out;
}

/**
 * THE NOTE FOR ONE DRIVE, from storage_view.js readSource's answer. Null when there is nothing to note: a look that did
 * not reach it (another computer, no answer, a folder needing permission), or "pictures added on this device" (not a
 * drive; its free space is this browser's own). Pure.
 *   by       this browser's reader id (readerId);  readBy  the screen's name, when a screen made it ('' otherwise)
 */
export function noteFor(source, result, { by = '', readBy = '', nameMax = NOTES_DEFAULTS.nameMax, whyMax = NOTES_DEFAULTS.whyMax } = {}) {
  if (!source || source.kind === 'device') return null;
  const id = shortId(source.id);
  if (!id || !result || !['ok', 'none'].includes(result.state)) return null;
  let host = '';
  let scope = 'folder';
  if (source.kind !== 'folder') {
    const base = agentBase(source);
    if (!base) return null;
    try { host = new URL(base).host; } catch { return null; }   // host and port only: never the path after it
    const sc = addressScope(base);
    scope = sc === 'loopback' || sc === 'private' ? sc : 'internet';
  }
  const copies = (Array.isArray(result.copies) ? result.copies : []).slice(0, 4).map((c) => noteCopy(c, { whyMax })).filter(Boolean);
  const out = {
    format: NOTE_FORMAT, v: 1,
    source: id,
    name: clip(source.label, nameMax) || host || 'A picture source',
    kind: source.kind === 'folder' ? 'folder' : 'agent',
    scope, host,
    by: shortId(by),
    state: result.state,
    copies,
  };
  const rb = clip(readBy, nameMax);
  if (rb) out.read_by = rb;
  return out;
}

/** A note read back from anywhere (another device wrote it, or somebody edited the file): kept only in the note's own
 *  shape, every field re-checked the way noteFor makes it. Null when it is not a note. Pure. */
export function readNote(row, o = {}) {
  const opts = { ...NOTES_DEFAULTS, ...o };
  if (!row || row.kind !== NOTE_KIND || !row.data || typeof row.data !== 'object') return null;
  const d = row.data;
  const at = String(row.created_at || '');
  if (d.format !== NOTE_FORMAT || !shortId(d.source) || !Number.isFinite(Date.parse(at))) return null;
  const host = clip(d.host, 120);
  return {
    at,
    source: shortId(d.source),
    name: clip(d.name, opts.nameMax) || host || 'A picture source',
    kind: d.kind === 'folder' ? 'folder' : 'agent',
    scope: ['loopback', 'private', 'internet', 'folder'].includes(d.scope) ? d.scope : 'internet',
    host: looksLikePath(host) ? '' : host,
    by: shortId(d.by),
    readBy: clip(d.read_by, opts.nameMax),
    state: d.state === 'none' ? 'none' : 'ok',
    copies: (Array.isArray(d.copies) ? d.copies : []).slice(0, 4).map((c) => noteCopy(c, opts)).filter(Boolean),
  };
}

/** The newest note per (drive, reader), newest first. `rows` are history rows; `from` tags where they came from. Pure. */
export function newestNotes(groups) {
  const best = new Map();
  for (const { rows, from } of groups || []) {
    for (const r of rows || []) {
      const n = readNote(r);
      if (!n) continue;
      const key = `${n.source}|${n.by}`;
      const cur = best.get(key);
      // The same note in both places (written here, copied there) is "from your Nimrod folder": it is there.
      if (!cur || Date.parse(n.at) > Date.parse(cur.at) || (n.at === cur.at && from === 'folder')) best.set(key, { ...n, from });
    }
  }
  return [...best.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** This browser's own record of notes. */
let deviceStore = null;
export function notesDeviceStore() {
  if (!deviceStore) {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    deviceStore = idb ? idbPlayStore({ name: NOTES_DB, idb }) : memoryPlayStore();
  }
  return deviceStore;
}

/**
 * A HANDLE OVER THIS BROWSER'S NOTES (the hidden_pictures.js createHiddenPictures pattern, an append-only log with a
 * marker per folder).
 *   place()                    the folder's state: 'ready' | 'permission' | 'missing' | 'write' | 'none' | 'unavailable'
 *   note(source, result, { noteAgainMs })   make a note when it says something new, or the newest one for that drive
 *                              from this browser is at least `noteAgainMs` old. Resolves the row, or null (nothing to
 *                              note, nothing new, or no folder chosen). Never throws.
 *   sync()                     copy notes the folder does not have yet; resolves { sent, why? }. Never throws.
 *   readBack()                 the newest note per (drive, reader): the folder's (when it can be read) and this
 *                              browser's own, each tagged `from` 'folder' | 'device'. Never throws.
 * `folder()` returns the person's Nimrod folder sink (history_place.js nimrodFolder / folderSink shape) or null.
 */
export function createDriveNotes({ store = memoryPlayStore(), folder = () => null, now = () => Date.now(),
  by = '', readBy = () => '', ...o } = {}) {
  const opts = { ...NOTES_DEFAULTS, ...o };
  const key = NOTES_RECORD;
  let lastAt = 0;
  let chain = Promise.resolve();
  const sinkNow = () => { try { return folder() || null; } catch { return null; } };
  const readByNow = () => { try { return String(readBy() || ''); } catch { return ''; } };

  async function place() {
    const sink = sinkNow();
    if (!sink || typeof sink.status !== 'function') return 'none';
    try { return (await sink.status()) || 'none'; } catch { return 'none'; }
  }

  // A clock that only goes forward (hidden_pictures.js `stamp`): every note is newer than every note held, so two
  // notes in one millisecond (five drives read at once) never share a marker, and none is left behind by one.
  function stamp(rows) {
    for (const r of rows) { const x = timeOf(r); if (x > lastAt) lastAt = x; }
    let t = Number(now()) || Date.now();
    if (t <= lastAt) t = lastAt + 1;
    lastAt = t;
    return new Date(t).toISOString();
  }

  async function noteNow(source, result, { noteAgainMs = 0 } = {}) {
    if (!SAVE_STATES.includes(await place())) return null;     // no folder chosen: nothing is kept, not even here
    const data = noteFor(source, result, { by, readBy: readByNow(), nameMax: opts.nameMax, whyMax: opts.whyMax });
    if (!data) return null;
    let made = null;
    try {
      await store.update(key, (r) => {
        const rows = Array.isArray(r.rows) ? r.rows : [];
        let last = null;
        for (const x of rows) if (x && x.data && x.data.source === data.source && x.data.by === data.by && (!last || timeOf(x) >= timeOf(last))) last = x;
        const same = last && JSON.stringify(last.data) === JSON.stringify(data);
        const t = Number(now()) || Date.now();
        if (same && !(noteAgainMs > 0 && t - timeOf(last) >= noteAgainMs)) return r;
        made = { kind: NOTE_KIND, created_at: stamp(rows), data };
        return { ...r, rows: [...rows, made].slice(-Math.max(1, opts.keep)) };
      });
    } catch (e) { console.error('storage notes: save', e); return null; }
    return made;
  }
  /** One at a time, in order (each compares against the one before). */
  function note(source, result, o2 = {}) {
    const run = chain.then(() => noteNow(source, result, o2)).catch((e) => { console.error('storage notes: note', e); return null; });
    chain = run.then(() => null);
    return run;
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
    const todo = r.rows.filter((x) => x && x.kind === NOTE_KIND && String(x.created_at || '') > mark);
    if (!todo.length) return { sent: 0 };
    const res = await sink.append(NOTES_STREAM, NOTES_FILE_SCOPE, todo.map(({ kind, created_at, data }) => ({ kind, created_at, data })),
      { folderId: fid });
    let upTo = mark;
    let sent = 0;
    let why = null;
    if (res && res.ok) { sent = todo.length; upTo = String(todo[todo.length - 1].created_at); } else {
      why = (res && res.why) || 'write';
      if (res && res.upTo) { upTo = String(res.upTo); sent = todo.filter((x) => String(x.created_at) <= upTo).length; }
    }
    if (upTo && upTo !== mark) {
      try {
        await store.update(key, (x) => {
          const s = { ...(x.sent || {}) };
          if (fid) { s[folderMarkKey(fid)] = upTo; if (String(s.folder || '') < upTo) s.folder = upTo; } else s.folder = upTo;
          return { ...x, sent: s };
        });
      } catch (e) { console.error('storage notes: marker', e); }
    }
    return { sent, ...(why ? { why } : {}) };
  }
  function sync() {
    const run = chain.then(syncNow).catch((e) => { console.error('storage notes: copy', e); return { sent: 0, why: 'error' }; });
    chain = run.then(() => null);
    return run;
  }

  async function readBack() {
    const groups = [];
    const sink = sinkNow();
    if (sink && typeof sink.read === 'function') {
      let got = [];
      try { got = (await sink.read(NOTES_STREAM, NOTES_FILE_SCOPE, opts.readMax)) || []; } catch { got = []; }
      groups.push({ rows: got, from: 'folder' });
    }
    try { groups.push({ rows: playRecord(key, await store.get(key)).rows, from: 'device' }); } catch { /* none here */ }
    return newestNotes(groups);
  }

  return { place, note, sync, readBack, by, store, rows: async () => { try { return playRecord(key, await store.get(key)).rows; } catch { return []; } } };
}
