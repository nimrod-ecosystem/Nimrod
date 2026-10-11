// storage_view.js — "STORAGE": WHERE THE PICTURES COME FROM, AND HOW EACH PLACE IS DOING. My dashboards -> Devices.
//
// WHY (2026-10-10; storage roles Stage 4, row 2.77, and row 2.73). The photo pull now runs jobs (8544ea1): job 1 copies
// Google Drive onto the drive the screen reads and writes `.nimrod-pull/last-pull.json` there; job 2 copies that drive
// to a folder on the screen's own computer and writes `.nimrod-pull/last-fallback.json` in it. Nothing showed either
// file except the Photos panel's one line ("3 new pictures today"). Mike, 2026-10-09: "Seems like an external hard
// drive needs to be a device too." So each picture source this page knows is listed here as a device, with what can be
// read about it: its role, which computer it is on, free space, the last copy and how long ago, and how many pictures
// were left out for space.
//
// READ-ONLY, AND NOTHING GOES TO THE SITE.
//   * Every number here is read IN THIS BROWSER, straight from each source (a media agent's /health and its status
//     files, a browser folder, this browser's own storage). The site's server is never asked about a drive and never
//     told (web/server/storage_line.py rule 8 refuses a drive note on every route).
//   * Nothing here changes a drive, a Pi or a job. Roles, schedules and the space kept free are set when the screen
//     was installed (nimrod-photo-pull.sh's settings file); this section says so instead of offering buttons.
//   * This section keeps its own choices in this browser (STORAGE_VIEW_KEY, below).
//
// SEEN AWAY FROM HOME, THROUGH THE PERSON'S OWN NIMROD FOLDER (Mike, 2026-10-10: "I think the point of the g drive is so
// you can see things anywhere. Let it be saved wherever the user wants."; storage_notes.js argues the rest). Each look
// that reaches a drive is also noted - times, counts, free space, never file names - in the person's Nimrod folder,
// the way play history and the hidden-picture list go there. A browser that cannot reach a drive itself (away from
// home) shows the newest note for it from that folder: "From your Nimrod folder, read 3 hours ago by “Bedside”." A
// screen notes its drives too, with no Storage section on it (startDriveNotes, kiosk.js). No Nimrod folder chosen on
// this device: nothing is saved, and the section says where to choose one.
//   SAVE TO YOUR NIMROD FOLDER  on by default, argued. FOR on: it is Mike's ruling's whole point; a note holds nothing
//     about anybody (no names, no pictures, no paths - only times, counts and free space); it only happens where a
//     person already chose a Nimrod folder, which is itself the choice to keep things there; and the play history and
//     the hidden-picture list already go there the same way. FOR off: a Nimrod folder shared with people who should
//     not see when copies ran or how full a drive is, or somebody who wants no trace at all. Off is one tick, on this
//     device, in the section's Settings box. (This device, argued: the Nimrod folder itself is per device - a browser
//     folder or the agent on that computer - so the switch for writing to it sits at the same level.)
//   NOTE AGAIN WHEN NOTHING CHANGED  every 6 hours (NOTE_AGAIN_DEFAULT_MS). A note is made whenever what a drive says
//     changes (a copy ran, free space moved); this is how often one is made anyway, so "read N hours ago" away from
//     home is never older than this while a screen at home is looking. Six hours keeps a household of five drives
//     at about twenty short lines a day in the folder; every hour would be a hundred and twenty; once a day would
//     let a drive that stopped answering this morning still read "fine, yesterday". Choices: 1, 6 and 12 hours, a day.
//
// A SOURCE ON ANOTHER COMPUTER IS ASKED ONLY THE QUIET WAY (media_sources.js quietReach). An address Chrome would ask
// about ("allow this site to reach devices on your network?") is not fetched by itself: the row says it is not asked
// from here, with a press, "Check on this computer", which is the person asking - the same rule as the panels' "Try on
// this computer". A press that reaches it is remembered (rememberReached), so it is quiet from then on.
//
// ROLES, from two places, each said as it is:
//   * the status files: `role` (primary -> "Main", fallback -> "Backup copy"), and what filled it - job `drive` is the
//     copy in from Google Drive; `from_role: primary` is a copy of the main drive;
//   * the dashboards on this login whose "Backup folder for this screen" names this source -> "Backup folder for X".
//     (A dashboard's row is read once per look, through the same settings handle the composer uses; nothing is written.)
//
// TIMING, two choices in the section (STORAGE_VIEW_KEY, this browser only), each a default argued:
//   LOOK AGAIN EVERY  10 minutes (RECHECK_DEFAULT_MS). The status files change once per copy - daily by default, hourly
//     at most - so ten minutes notices any copy well within its hour, and one small read per source every ten minutes
//     is nothing for an agent on the same network. Shorter adds requests nobody sees; longer leaves an open tab saying
//     "never" for up to that long after a copy. 0 = only when the tab opens or "Look again" is pressed. A tab in the
//     background skips its look and takes the next one.
//   CALL A COPY LATE AFTER  2 days (LATE_DEFAULT_MS). The pull's default is daily, overnight (03:00-07:00), so a copy
//     36 hours old is one missed night - which happens (a Pi off that night) and is not news; two days is two missed
//     nights in a row, which is worth a plain sentence. It is said in words ("later than expected"), not as an alarm:
//     no red, nothing that moves, nothing that asks for an answer. If a status file ever says how often its job runs
//     (`every`: hourly | daily | weekly), the line is never drawn before two of those periods (a weekly job is not late
//     after two days); today's files do not carry it, so the choice alone decides. 0 = never call it late.
// HARD-CODED, argued (Rule 1; options of mountStorageView, not settings on the page):
//   READ_WAIT_MS 10 s       the longest one read may take before the source is called unreachable. A status file is a
//                           few hundred bytes; an agent that has not answered in ten seconds is not answering. Shorter
//                           than the panels' LISTING_WAIT_MS (20 s): those wait for a whole folder's listing.
//   STATUS_FOLDERS_MAX 8    when a source's top holds no status file, its top folders are looked in, at most this many
//                           (the Drive pull often fills a folder INSIDE the agent's, e.g. photos/family_drive). Eight
//                           covers a drive laid out by hand; each miss is one small 404 from the agent.

import {
  createMediaSourcesClient, mediaUrl, agentBase, addressScope, quietReach, rememberReached, resolveListing, topFoldersOf,
} from './media_sources.js';
import { folderPermission, folderFileUrl } from './folder_source.js';
import { agoWords } from './account_screens.js';
import { nimrodFolder, folderSink, agentSink, localAgentBases } from './history_place.js';
import { createDriveNotes, notesDeviceStore, readerId, SAVE_STATES } from './storage_notes.js';

export const STATUS_FILES = Object.freeze(['.nimrod-pull/last-pull.json', '.nimrod-pull/last-fallback.json']);
export const STATUS_FOLDERS_MAX = 8;
export const READ_WAIT_MS = 10000;
export const STORAGE_VIEW_KEY = 'nimrod-storage-view';
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const RECHECK_DEFAULT_MS = 10 * MIN;
export const LATE_DEFAULT_MS = 2 * DAY;
export const RECHECK_CHOICES = Object.freeze([
  { value: 5 * MIN, label: 'Every 5 minutes' }, { value: 10 * MIN, label: 'Every 10 minutes' },
  { value: 30 * MIN, label: 'Every 30 minutes' }, { value: HOUR, label: 'Every hour' },
  { value: 0, label: 'Only when this tab opens' },
]);
export const LATE_CHOICES = Object.freeze([
  { value: DAY, label: 'After 1 day' }, { value: 2 * DAY, label: 'After 2 days' }, { value: 3 * DAY, label: 'After 3 days' },
  { value: 7 * DAY, label: 'After a week' }, { value: 0, label: 'Never' },
]);
export const NOTE_AGAIN_DEFAULT_MS = 6 * HOUR;
export const NOTE_AGAIN_CHOICES = Object.freeze([
  { value: HOUR, label: 'Every hour' }, { value: 6 * HOUR, label: 'Every 6 hours' },
  { value: 12 * HOUR, label: 'Every 12 hours' }, { value: DAY, label: 'Once a day' },
]);
export const SAVE_DEFAULT = true;
// A screen's first look waits this long after it starts (startDriveNotes), so it never competes with the screen's own
// start-up for the network or the drive. Hard-coded, argued: a minute is nothing against a six-hour note, and long
// enough for the panels to have drawn.
export const NOTES_FIRST_DELAY_MS = MIN;
const PERIOD = { hourly: HOUR, daily: DAY, weekly: 7 * DAY };
export const SETTINGS_WHERE = 'Roles, copy times and the space kept free are set when the screen was installed. This '
  + 'section only shows them. Nothing here changes a drive.';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : null);
const num = (n) => { try { return Number(n).toLocaleString('en-US'); } catch { return String(n); } };
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ the pieces, pure

/** The section's choices, from this browser (never throws; a bad or missing value is the default). */
export function readViewSettings(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  let v = {};
  try { v = JSON.parse(storage?.getItem(STORAGE_VIEW_KEY) || '{}') || {}; } catch { v = {}; }
  if (!v || typeof v !== 'object') v = {};
  const pick = (x, choices, dflt) => (choices.some((c) => c.value === Number(x)) ? Number(x) : dflt);
  return {
    recheckMs: pick(v.recheckMs, RECHECK_CHOICES, RECHECK_DEFAULT_MS),
    lateAfterMs: pick(v.lateAfterMs, LATE_CHOICES, LATE_DEFAULT_MS),
    saveToFolder: typeof v.saveToFolder === 'boolean' ? v.saveToFolder : SAVE_DEFAULT,
    noteAgainMs: pick(v.noteAgainMs, NOTE_AGAIN_CHOICES, NOTE_AGAIN_DEFAULT_MS),
  };
}
export function writeViewSettings(next, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  const cur = readViewSettings(storage);
  const v = { ...cur, ...(next || {}) };
  try {
    storage?.setItem(STORAGE_VIEW_KEY, JSON.stringify({ recheckMs: v.recheckMs, lateAfterMs: v.lateAfterMs,
      saveToFolder: v.saveToFolder !== false, noteAgainMs: v.noteAgainMs }));
  } catch { /* a private window: this page only */ }
}

/**
 * One status file, read: either job's (nimrod-photo-pull.sh writes last-pull.json for job 1 and last-<name>.json for a
 * local copy job). Null when it is not one. Only counts, times, roles and free space are kept - never a file name.
 */
export function readCopyStatus(j) {
  if (!j || typeof j !== 'object' || typeof j.at !== 'string' || !Number.isFinite(Date.parse(j.at))) return null;
  const word = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');
  const job = word(j.job) || (j.new_today !== undefined ? 'drive' : '');
  return {
    at: j.at,
    job,
    role: word(j.role) || (job === 'drive' ? 'primary' : ''),
    fromRole: word(j.from_role) || (job === 'drive' ? 'sync' : ''),
    every: PERIOD[word(j.every)] || word(j.every) === 'manual' ? word(j.every) : '',
    new: count(j.new) ?? 0,
    changed: count(j.changed) ?? 0,
    removed: count(j.removed) ?? 0,
    files: count(j.files),
    leftForSpace: count(j.left_for_space),
    freeBytes: j.free_bytes == null ? null : count(j.free_bytes),
    keepFreeBytes: j.keep_free_bytes == null ? null : count(j.keep_free_bytes),
    ok: j.ok !== false,
    why: word(j.why, 120),
  };
}

/** "41 GB", "850 MB", "12 KB". Pure. */
export function bytesWords(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b < 0) return '';
  const units = [['TB', 1e12], ['GB', 1e9], ['MB', 1e6], ['KB', 1e3]];
  for (const [u, s] of units) {
    if (b >= s) { const v = b / s; return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${u}`; }
  }
  return `${Math.round(b)} bytes`;
}

/** Which computer a source is on, in words. `reach` is quietReach's answer (or null before it is known). Pure. */
export function whereWords(source, reach = null) {
  if (!source) return '';
  if (source.kind === 'device') return 'On this device: pictures added in this browser';
  if (source.kind === 'folder') return 'On this computer: a folder this browser opened';
  const base = agentBase(source);
  if (!base) return '';
  let host = '';
  try { host = new URL(base).host; } catch { host = base; }
  const scope = addressScope(base);
  if (scope === 'loopback') {
    return reach && reach.quiet ? `On this computer (${host})` : `On the computer of the screen that uses it (${host})`;
  }
  if (scope === 'private') return `On another computer, at ${host}`;
  return `On the internet, at ${host}`;
}

/** The role words for a source: from its status files and the dashboards that name it as their backup. Pure. */
export function roleWords(copies = [], backupFor = []) {
  const out = [];
  const add = (w) => { if (w && !out.includes(w)) out.push(w); };
  for (const c of copies) {
    if (c.role === 'primary') add('Main');
    else if (c.role === 'fallback') add('Backup copy');
    else if (c.role) add(c.role.charAt(0).toUpperCase() + c.role.slice(1));
  }
  const names = [...new Set((backupFor || []).filter(Boolean))];
  if (names.length) add(`Backup folder for ${names.map((n) => `“${n}”`).join(', ')}`);
  return out;
}

/** Is a copy late? `lateAfterMs` 0 = never. A job that says how often it runs is never late before two periods. Pure. */
export function isLate(copy, now = Date.now(), lateAfterMs = LATE_DEFAULT_MS) {
  if (!copy || !(lateAfterMs > 0)) return false;
  // A job set to run only by hand (`every: manual`, 2026-10-10) has no schedule to be late against.
  if (copy.every === 'manual') return false;
  const at = Date.parse(copy.at);
  if (!Number.isFinite(at)) return false;
  const line = Math.max(lateAfterMs, copy.every ? 2 * PERIOD[copy.every] : 0);
  return now - at > line;
}

/** One status file as one sentence-ish line: `{ text, late }`. Pure given `now`. */
export function copyLine(copy, now = Date.now(), { lateAfterMs = LATE_DEFAULT_MS } = {}) {
  if (!copy) return { text: '', late: false };
  const head = copy.job === 'drive' || copy.fromRole === 'sync' ? 'From Google Drive'
    : copy.fromRole === 'primary' ? 'Copy of the main drive'
    : `Copy${copy.job ? ` (${copy.job})` : ''}`;
  const ago = agoWords(Math.max(0, now - Date.parse(copy.at)));
  const parts = [];
  if (copy.ok) {
    const bits = [];
    if (copy.new) bits.push(`${num(copy.new)} new`);
    if (copy.changed) bits.push(`${num(copy.changed)} changed`);
    if (copy.removed) bits.push(`${num(copy.removed)} set aside`);
    parts.push(`${head}: last copy ${ago}, ${bits.length ? bits.join(', ') : 'nothing new'}.`);
  } else {
    parts.push(`${head}: the last copy did not finish (${ago}${copy.why ? `: ${copy.why}` : ''}).`);
  }
  const held = [];
  if (copy.files != null) held.push(`${plural(copy.files, 'picture')} in it`);
  if (copy.leftForSpace) held.push(`${plural(copy.leftForSpace, 'picture')} left out for space`);
  if (held.length) parts.push(`${held.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()));
  if (copy.freeBytes != null) {
    parts.push(`${bytesWords(copy.freeBytes)} free then${copy.keepFreeBytes ? ` (it keeps ${bytesWords(copy.keepFreeBytes)} free)` : ''}.`);
  }
  const late = isLate(copy, now, lateAfterMs);
  if (late) parts.push('That is later than expected.');
  return { text: parts.join(' '), late };
}

/** What a row says about reaching it, by state. Pure. */
export const STATE_WORDS = Object.freeze({
  reading: 'Looking…',
  none: 'Can be reached. No copy recorded here.',
  unreachable: 'Can’t be reached right now. The computer may be off, or its photo program stopped.',
  elsewhere: 'Not asked from here. It is on another computer, and asking would make this browser ask you for permission first.',
  permission: 'This browser needs your OK to open this folder again. Open it from Media.',
  missing: 'This browser no longer has this folder. Connect it again in Media.',
  checkedNo: 'Checked from this computer: no answer.',
});

/** What the section says about saving to the person's Nimrod folder, by the folder's state on this device. */
export const PLACE_WORDS = Object.freeze({
  ready: 'Each look is also saved to your Nimrod folder: times, counts and free space, never file names. It can be '
    + 'seen wherever that folder can be opened (on Google Drive, from anywhere).',
  permission: 'Waiting to be saved to your Nimrod folder: this browser needs your OK to use it again. What waits is '
    + 'saved then.',
  missing: 'Waiting to be saved to your Nimrod folder: it cannot be found here right now. A drive may not be plugged '
    + 'in. What waits is saved when it is back.',
  none: 'Not saved anywhere: this device has no Nimrod folder. To save it, choose one in a screen\'s settings: '
    + 'This screen, then Your own folders.',
  unavailable: 'Not saved: this browser cannot use a folder (Chrome and Edge can).',
  off: 'Not saved to your Nimrod folder: turned off in Settings below.',
});
/** The place line's words. `state` is the folder sink's status; `on` the Save choice. Pure. */
export function placeWords(state, on = true) {
  if (!on) return PLACE_WORDS.off;
  if (state === 'write') return PLACE_WORDS.missing;
  return PLACE_WORDS[state] || PLACE_WORDS.none;
}

/** Where a noted drive is, said from the note (not from this browser: "this computer" would be wrong here). Pure. */
export function noteWhereWords(n) {
  if (!n) return '';
  if (n.kind === 'folder') return 'A folder on the computer that read it';
  if (n.scope === 'loopback') return `On the computer that read it${n.host ? ` (${n.host})` : ''}`;
  if (n.scope === 'private') return `On another computer${n.host ? `, at ${n.host}` : ''}`;
  return `On the internet${n.host ? `, at ${n.host}` : ''}`;
}

/**
 * A NOTE, IN WORDS: `{ head, where, lines: [{ text, late }] }`. `mine`: this browser made it. Pure given `now`.
 *   from the folder:  "From your Nimrod folder, read 3 hours ago by “Bedside”."
 *   this browser's own, the folder not readable here:  "From this browser's last look, 3 hours ago."
 */
export function noteWords(n, now = Date.now(), { lateAfterMs = LATE_DEFAULT_MS, mine = false } = {}) {
  if (!n) return { head: '', where: '', lines: [] };
  const ago = agoWords(Math.max(0, now - Date.parse(n.at)));
  const who = mine ? ' by this browser' : n.readBy ? ` by “${n.readBy}”` : ' by another browser';
  const head = n.from === 'folder' ? `From your Nimrod folder, read ${ago}${who}.` : `From this browser's last look, ${ago}.`;
  const lines = (n.copies || []).map((c) => copyLine(readCopyStatus(c), now, { lateAfterMs })).filter((l) => l.text);
  if (!lines.length) lines.push({ text: 'It could be reached. No copy was recorded there.', late: false });
  return { head, where: noteWhereWords(n), lines };
}

// ------------------------------------------------------------------ the reads (never throw)

// The wait is a race, not only an abort: a fetch that ignores its signal (or a body that never ends) still gives up.
async function readJson(fetchImpl, url, waitMs) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let t = null;
  const gaveUp = new Promise((resolve) => {
    if (waitMs > 0) t = setTimeout(() => { try { ctl?.abort(); } catch { /* fine */ } resolve({ reached: false, data: null }); }, waitMs);
  });
  const read = (async () => {
    try {
      const res = await fetchImpl(url, { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
      if (!res || !res.ok) return { reached: !!res, data: null };
      try { return { reached: true, data: await res.json() }; } catch { return { reached: true, data: null }; }
    } catch { return { reached: false, data: null }; }
  })();
  try { return await Promise.race([read, gaveUp]); }
  finally { if (t) clearTimeout(t); }
}

/** The status files in one place: `get(rel)` resolves the parsed JSON or null. */
async function copiesFrom(get, prefix = '') {
  const out = [];
  for (const rel of STATUS_FILES) {
    const c = readCopyStatus(await get(prefix ? `${prefix}/${rel}` : rel));
    if (c) out.push(c);
  }
  return out;
}

/**
 * Read one source. Resolves `{ state, copies, freeBytes }`; state: 'ok' | 'none' | 'unreachable' | 'elsewhere' |
 * 'permission' | 'missing'. `onPurpose`: the person pressed "Check on this computer" (the quiet rule is skipped then).
 */
export async function readSource(source, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null), check = null, onPurpose = false,
  waitMs = READ_WAIT_MS, folderPerm = folderPermission, readFolderFile = defaultReadFolderFile,
  estimate = defaultEstimate, foldersMax = STATUS_FOLDERS_MAX,
} = {}) {
  if (!source) return { state: 'unreachable', copies: [], freeBytes: null };
  if (source.kind === 'device') {
    let free = null;
    try { const e = await estimate(); if (e && Number.isFinite(e.quota) && Number.isFinite(e.usage)) free = Math.max(0, e.quota - e.usage); }
    catch { free = null; }
    return { state: 'none', copies: [], freeBytes: free, freeHere: true };
  }
  if (source.kind === 'folder') {
    let perm = 'prompt';
    try { perm = await folderPerm(source.id); } catch { perm = 'prompt'; }
    if (perm === 'missing') return { state: 'missing', copies: [], freeBytes: null };
    if (perm !== 'granted') return { state: 'permission', copies: [], freeBytes: null };
    const copies = await copiesFrom(async (rel) => { try { return await readFolderFile(source.id, rel); } catch { return null; } });
    return { state: copies.length ? 'ok' : 'none', copies, freeBytes: null };
  }
  const base = agentBase(source);
  if (!base) return { state: 'unreachable', copies: [], freeBytes: null };
  let reach = { quiet: true, why: 'on-purpose' };
  if (!onPurpose) {
    reach = await quietReach(source, { check });
    if (!reach.quiet) return { state: 'elsewhere', copies: [], freeBytes: null, reach };
  }
  const health = await readJson(fetchImpl, `${base}/health`, waitMs);
  if (!health.reached || !health.data) return { state: 'unreachable', copies: [], freeBytes: null, reach };
  if (onPurpose) { try { rememberReached(base); } catch { /* fine */ } reach = { quiet: true, why: 'reached' }; }
  const get = async (rel) => (await readJson(fetchImpl, mediaUrl(base, rel), waitMs)).data;
  let copies = await copiesFrom(get);
  if (!copies.length && foldersMax > 0) {
    let folders = [];
    try { folders = topFoldersOf(await resolveListing(source, '', { fetchImpl })).slice(0, foldersMax); } catch { folders = []; }
    for (const f of folders) copies.push(...await copiesFrom(get, f));
  }
  return { state: copies.length ? 'ok' : 'none', copies, freeBytes: null, reach };
}

async function defaultReadFolderFile(id, rel) {
  const got = await folderFileUrl(id, rel);
  try { const res = await fetch(got.url); return res.ok ? await res.json() : null; }
  finally { try { got.release(); } catch { /* fine */ } }
}
async function defaultEstimate() {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') return null;
  return navigator.storage.estimate();
}

// ------------------------------------------------------------------ the section

const STYLE_ID = 'sv-style';
const STYLE = `
.sv{margin:0 0 22px;padding:14px 16px;background:var(--surface,#fff);border:1px solid var(--border,#e4e0c2);
  border-radius:var(--radius,16px);max-width:900px;min-width:0}
.sv h2{font-size:1.15rem;margin:0 0 4px}
.sv-intro{margin:0 0 10px;color:var(--text-soft,#3c5346);font-size:.9rem;max-width:60ch}
.sv-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.sv-row{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--border,#e4e0c2);
  border-radius:12px;min-width:0}
.sv-name{font-weight:700;overflow-wrap:anywhere}
.sv-where,.sv-role,.sv-free,.sv-state{font-size:.85rem;color:var(--text-muted,#5d7064);overflow-wrap:anywhere}
.sv-role{color:var(--text-soft,#3c5346);font-weight:600}
.sv-copies{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:2px}
.sv-copies li{font-size:.88rem;color:var(--text,#0A3323);overflow-wrap:anywhere}
.sv-late{font-weight:600}
.sv-row .h-btn,.sv-bar .h-btn{min-height:44px;align-self:flex-start}
.sv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 10px}
.sv-timing{font-size:.85rem;color:var(--text-soft,#3c5346)}
.sv-timing summary{cursor:pointer;min-height:44px;display:flex;align-items:center}
.sv-timing label{display:flex;flex-direction:column;gap:2px;margin:6px 0;min-width:0}
.sv-timing select{min-height:44px;max-width:100%;padding:6px 10px;border:1px solid var(--border,#e4e0c2);
  border-radius:10px;background:var(--surface,#fff);color:var(--text,#0A3323);font:inherit}
.sv .h-btn:focus-visible,.sv select:focus-visible,.sv summary:focus-visible,.sv a:focus-visible{
  outline:3px solid var(--focus, currentColor);outline-offset:2px}
.sv-foot{margin:10px 0 0;font-size:.82rem;color:var(--text-muted,#5d7064);overflow-wrap:anywhere}
.sv-foot a{color:var(--link,#105666)}
.sv-place{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:0 0 10px;font-size:.85rem;
  color:var(--text-soft,#3c5346);max-width:70ch;overflow-wrap:anywhere}
.sv-place p{margin:0;min-width:0}
.sv-timing .sv-check{flex-direction:row;align-items:center;gap:8px;min-height:44px}
.sv-timing .sv-check input{width:22px;height:22px;margin:0;flex:none}
.sv-notes{display:flex;flex-direction:column;gap:6px;margin:4px 0 0;padding:6px 0 0;border-top:1px dashed var(--border,#e4e0c2)}
.sv-note{display:flex;flex-direction:column;gap:2px;min-width:0}
.sv-note-head{font-size:.85rem;font-weight:600;color:var(--text-soft,#3c5346);overflow-wrap:anywhere}
.sv-note-where{font-size:.82rem;color:var(--text-muted,#5d7064);overflow-wrap:anywhere}
.sv-elsewhere h3{font-size:1rem;margin:14px 0 6px}
.sv-check input:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:2px}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID; s.textContent = STYLE;
  (doc.head || doc.documentElement).append(s);
}

/**
 * Mount the Storage section into `root`. Options (each a seam a suite fills):
 *   listSources    async () => the sources this page knows (default: createMediaSourcesClient({ user, personId }).list())
 *   screenBackups  async () => [{ label, choice }] - each dashboard's "Backup folder for this screen" (default none)
 *   fetchImpl, check, folderPerm, readFolderFile, estimate, waitMs, foldersMax   see readSource
 *   now            () => ms
 *   storage        where the section's choices are kept (default localStorage)
 *   setTimer, clearTimer, hidden   the look-again clock and "is this tab in the background"
 *   mediaHref      where "Media" links to
 *   folder         the person's Nimrod folder sink (history_place.js shape); default: this device's (defaultFolder);
 *                  null: none (nothing is saved, nothing read back)
 *   notesStore     this browser's record of notes (default IndexedDB `nimrod-storage-notes`)
 *   readBy         () => the name the notes carry for who read them ('' on My dashboards: no screen)
 */
export function mountStorageView(root, {
  user = null, personId = null,
  listSources = null,
  screenBackups = async () => [],
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  check = null, folderPerm = folderPermission, readFolderFile = defaultReadFolderFile, estimate = defaultEstimate,
  waitMs = READ_WAIT_MS, foldersMax = STATUS_FOLDERS_MAX,
  now = () => Date.now(),
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  hidden = () => (typeof document !== 'undefined' && document.hidden === true),
  mediaHref = '/home.html?tab=media',
  folder = undefined, notesStore = null, readBy = () => '',
} = {}) {
  if (!root) throw new Error('mountStorageView: a root element is required');
  ensureStyle(root.ownerDocument);
  const listSourcesNow = listSources || (() => createMediaSourcesClient({ user, personId }).list());
  const listeners = new AbortController();
  let view = readViewSettings(storage);
  let sources = [];
  let backups = [];
  let results = new Map();      // source id -> readSource's answer, or { state: 'reading' }
  let loaded = false, failed = false, destroyed = false;
  let seq = 0;
  let timer = null;
  // THE NIMROD FOLDER (storage_notes.js): where each look is noted, and where notes are read back from.
  const sink = folder === undefined ? defaultFolder(listSourcesNow) : folder;
  const notes = createDriveNotes({ store: notesStore || notesDeviceStore(), folder: () => sink, now, by: readerId(storage), readBy });
  let place = null;             // the folder's state on this device, once known
  let noted = [];               // readBack(): the newest note per (drive, reader)

  const opt = (choices, cur) => choices.map((c) => `<option value="${c.value}"${c.value === cur ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  root.innerHTML = `
    <section class="sv" aria-labelledby="sv-h" data-storage-view>
      <h2 id="sv-h">Storage</h2>
      <p class="sv-intro">The drives and folders pictures come from, and how each one is doing. This browser reads them
        itself; nothing about them is sent to the site.</p>
      <div class="sv-place" data-sv-place></div>
      <div class="sv-bar">
        <button type="button" class="h-btn h-quiet" data-sv-again>Look again</button>
        <details class="sv-timing" data-sv-timing>
          <summary>Settings</summary>
          <label>Look again by itself
            <select data-sv-recheck>${opt(RECHECK_CHOICES, view.recheckMs)}</select></label>
          <label>Call a copy late
            <select data-sv-late>${opt(LATE_CHOICES, view.lateAfterMs)}</select></label>
          <label class="sv-check"><input type="checkbox" data-sv-save${view.saveToFolder ? ' checked' : ''}>
            Save to your Nimrod folder, on this device</label>
          <label>When nothing changed, save it again
            <select data-sv-noteagain>${opt(NOTE_AGAIN_CHOICES, view.noteAgainMs)}</select></label>
        </details>
      </div>
      <div class="h-msg" data-sv-msg role="status" aria-live="polite"></div>
      <div data-sv-body><p class="h-none">Looking…</p></div>
      <p class="sv-foot" data-sv-where>${esc(SETTINGS_WHERE)}</p>
    </section>`;
  const el = (sel) => root.querySelector(sel);
  const body = el('[data-sv-body]');
  const say = (t) => { const m = el('[data-sv-msg]'); if (m) m.textContent = t || ''; };

  function backupNamesFor(id) {
    return backups.filter((b) => b && b.choice && b.choice === id).map((b) => b.label || 'a dashboard');
  }

  function rowHTML(s) {
    const r = results.get(s.id) || { state: 'reading', copies: [] };
    const copies = r.copies || [];
    const roles = roleWords(copies, backupNamesFor(s.id));
    const lines = copies.map((c) => copyLine(c, now(), { lateAfterMs: view.lateAfterMs }));
    const free = r.freeHere && r.freeBytes != null ? `About ${bytesWords(r.freeBytes)} free for pictures added here` : '';
    const stateText = r.state === 'ok' ? '' : (r.checkedNo ? STATE_WORDS.checkedNo : (STATE_WORDS[r.state] || ''));
    return `<li class="sv-row" data-sv-id="${esc(s.id)}" data-sv-state="${esc(r.state)}">
        <span class="sv-name">${esc(s.label || s.base_url || s.id)}</span>
        <span class="sv-where" data-sv-where-row>${esc(whereWords(s, r.reach || null))}</span>
        ${roles.length ? `<span class="sv-role" data-sv-role>${esc(roles.join(' · '))}</span>` : ''}
        ${lines.length ? `<ul class="sv-copies" data-sv-copies>${lines.map((l) => `<li${l.late ? ' class="sv-late" data-sv-lateline' : ''}>${esc(l.text)}</li>`).join('')}</ul>` : ''}
        ${free ? `<span class="sv-free" data-sv-free>${esc(free)}</span>` : ''}
        ${stateText && !(r.state === 'none' && s.kind === 'device') ? `<span class="sv-state" data-sv-statetext>${esc(stateText)}</span>` : ''}
        ${r.state === 'elsewhere' || (r.checkedNo && r.state === 'unreachable') ? `<button type="button" class="h-btn h-quiet" data-sv-check="${esc(s.id)}">Check on this computer</button>` : ''}
        ${notesHTML(notesFor(s.id, r))}
      </li>`;
  }

  // WHICH NOTES SHOW UNDER A ROW: every other reader's newest (a screen at home, seen from here - always true, and
  // labelled with who read it and when), and this browser's own only when its look just now did not reach the drive
  // (away from home: "what it said the last time"). Not while the look is still running.
  const reached = (r) => r && (r.state === 'ok' || r.state === 'none');
  function notesFor(id, r) {
    const ran = r && r.state !== 'reading';
    return noted.filter((n) => n.source === id && (n.by !== notes.by || (ran && !reached(r))));
  }
  function notesHTML(list) {
    if (!list.length) return '';
    return `<div class="sv-notes" data-sv-notes>${list.map((n) => {
      const w = noteWords(n, now(), { lateAfterMs: view.lateAfterMs, mine: n.by === notes.by });
      return `<div class="sv-note" data-sv-note data-sv-note-from="${esc(n.from)}">
          <span class="sv-note-head" data-sv-note-head>${esc(w.head)}</span>
          <span class="sv-note-where">${esc(w.where)}</span>
          <ul class="sv-copies">${w.lines.map((l) => `<li${l.late ? ' class="sv-late" data-sv-lateline' : ''}>${esc(l.text)}</li>`).join('')}</ul>
        </div>`;
    }).join('')}</div>`;
  }
  // Drives this browser does not know (a browser folder on a screen at home, a source added on another login), seen
  // only through the notes other readers left in the folder.
  function elsewhereHTML() {
    const known = new Set(sources.map((s) => s.id));
    const others = noted.filter((n) => !known.has(n.source) && n.by !== notes.by);
    if (!others.length) return '';
    const ids = [...new Set(others.map((n) => n.source))];
    return `<div class="sv-elsewhere" data-sv-elsewhere><h3>Seen only through your Nimrod folder</h3><ul class="sv-list">${ids.map((id) => {
      const mine = others.filter((n) => n.source === id);
      return `<li class="sv-row" data-sv-noted="${esc(id)}"><span class="sv-name">${esc(mine[0].name)}</span>${notesHTML(mine)}</li>`;
    }).join('')}</ul></div>`;
  }
  function renderPlace() {
    const box = el('[data-sv-place]');
    if (!box) return;
    if (place == null) { box.innerHTML = ''; return; }
    const allow = view.saveToFolder && place === 'permission' && sink && typeof sink.allow === 'function';
    box.innerHTML = `<p data-sv-place-text>${esc(placeWords(place, view.saveToFolder))}</p>${allow
      ? '<button type="button" class="h-btn h-quiet" data-sv-allow>Allow it again</button>' : ''}`;
  }

  function render() {
    if (destroyed) return;
    if (!loaded) {
      body.innerHTML = failed ? '<p class="h-none">The picture sources could not be listed. Open this tab again to retry.</p>'
        : '<p class="h-none">Looking…</p>';
      return;
    }
    const focusedCheck = root.ownerDocument?.activeElement?.dataset?.svCheck || null;
    body.innerHTML = (sources.length
      ? `<ul class="sv-list" data-sv-list>${sources.map(rowHTML).join('')}</ul>`
      : `<p class="h-none" data-sv-empty>No picture sources yet. Add a folder or a drive in <a href="${esc(mediaHref)}">Media</a>.</p>`)
      + elsewhereHTML();
    if (focusedCheck) {
      const back = root.querySelector(`[data-sv-id="${CSS.escape(focusedCheck)}"] button, [data-sv-id="${CSS.escape(focusedCheck)}"]`);
      if (back) { if (back.tagName !== 'BUTTON') back.setAttribute('tabindex', '-1'); try { back.focus(); } catch { /* fine */ } }
    }
  }

  const readOpts = () => ({ fetchImpl, check, waitMs, folderPerm, readFolderFile, estimate, foldersMax });

  // Saving: the choice is on, and this device has a Nimrod folder (reachable now or not: what waits is saved later).
  const saving = () => view.saveToFolder && SAVE_STATES.includes(place);
  async function noteIt(s, r) {
    if (!saving()) return null;
    try { return await notes.note(s, r, { noteAgainMs: view.noteAgainMs }); } catch { return null; }
  }
  async function afterLook(mine) {
    if (saving()) { try { await notes.sync(); } catch { /* the next look tries again */ } }
    let back = [];
    try { back = await notes.readBack(); } catch { back = []; }
    if (mine !== seq || destroyed) return;
    noted = back;
    render();
  }

  async function refresh() {
    const mine = ++seq;
    const placeP = notes.place().catch(() => 'none');
    let list;
    try { list = await listSourcesNow(); }
    catch (err) { console.error('storage: sources', err); if (mine === seq) { failed = !loaded; render(); } arm(); return api; }
    if (mine !== seq || destroyed) return api;
    sources = (Array.isArray(list) ? list : []).filter((s) => s && s.id);
    try { backups = (await screenBackups()) || []; } catch { backups = []; }
    place = await placeP;
    if (mine !== seq || destroyed) return api;
    renderPlace();
    loaded = true; failed = false;
    const next = new Map();
    for (const s of sources) next.set(s.id, results.get(s.id) || { state: 'reading', copies: [] });
    results = next;
    render();
    await Promise.all(sources.map(async (s) => {
      const r = await readSource(s, readOpts());
      if (mine !== seq || destroyed) return;
      results.set(s.id, r);
      render();
      await noteIt(s, r);
    }));
    if (mine === seq && !destroyed) await afterLook(mine);
    arm();
    return api;
  }

  function arm() {
    if (timer != null) { clearTimer(timer); timer = null; }
    if (destroyed || !(view.recheckMs > 0)) return;
    timer = setTimer(() => {
      timer = null;
      if (hidden()) { arm(); return; }
      refresh().catch(() => {});
    }, view.recheckMs);
  }

  async function checkHere(id) {
    const s = sources.find((x) => x.id === id);
    if (!s) return;
    say(`Checking “${s.label || s.base_url}” from this computer…`);
    const r = await readSource(s, { ...readOpts(), onPurpose: true });
    if (destroyed) return;
    results.set(id, r.state === 'unreachable' ? { ...r, checkedNo: true } : r);
    say(r.state === 'unreachable' ? `“${s.label || s.base_url}” did not answer from this computer.` : `“${s.label || s.base_url}” answered.`);
    render();
    if (await noteIt(s, r)) await afterLook(seq);   // a look on purpose that reached it is a look like any other
  }

  async function allowFolder() {
    if (!sink || typeof sink.allow !== 'function') return;
    let got = 'denied';
    try { got = await sink.allow(); } catch { got = 'denied'; }   // a press: the browser asks, never this page by itself
    if (destroyed) return;
    say(got === 'granted' ? 'Your Nimrod folder can be used again.' : 'Your Nimrod folder was not allowed.');
    refresh().catch(() => {});
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('button');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-sv-again')) { say(''); refresh().catch(() => {}); return; }
    if (b.hasAttribute('data-sv-allow')) { allowFolder(); return; }
    if (b.dataset.svCheck) checkHere(b.dataset.svCheck);
  }, { signal: listeners.signal });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches?.('[data-sv-recheck]')) { view = { ...view, recheckMs: Number(t.value) }; writeViewSettings(view, storage); arm(); }
    else if (t.matches?.('[data-sv-late]')) { view = { ...view, lateAfterMs: Number(t.value) }; writeViewSettings(view, storage); render(); }
    else if (t.matches?.('[data-sv-noteagain]')) { view = { ...view, noteAgainMs: Number(t.value) }; writeViewSettings(view, storage); }
    else if (t.matches?.('[data-sv-save]')) {
      view = { ...view, saveToFolder: !!t.checked }; writeViewSettings(view, storage); renderPlace();
      if (view.saveToFolder) refresh().catch(() => {});   // turned on: this look is saved now, not in ten minutes
    }
  }, { signal: listeners.signal });

  const api = {
    refresh,
    results: () => new Map(results),
    view: () => ({ ...view }),
    armed: () => timer != null,
    place: () => place,
    notes,
    noted: () => noted.slice(),
    destroy() { destroyed = true; listeners.abort(); if (timer != null) { clearTimer(timer); timer = null; } root.innerHTML = ''; },
  };
  return api;
}

/** This device's Nimrod folder, as the screens use it (kiosk.js): the media agent on this computer when it offers
 *  history, else the browser folder. `listSources` finds the agent among the sources on this computer. */
export function defaultFolder(listSources) {
  return nimrodFolder({
    browser: folderSink(),
    agent: agentSink({ candidates: async () => { try { return localAgentBases(await listSources()); } catch { return []; } } }),
  });
}

/**
 * A SCREEN NOTES ITS DRIVES TOO (kiosk.js), with no Storage section on it: the screen is the one on the drive's own
 * network, so without this a drive at somebody's bedside could only be seen by a browser in the same building. Every
 * `recheckMs` (the same choice as the section's; "Only when this tab opens" = once), it reads each drive the quiet way
 * (never a prompt: readSource) and notes what it read, then copies what waits. Nothing at all happens - not one read -
 * while saving is off on this device or no Nimrod folder is chosen. First look after NOTES_FIRST_DELAY_MS.
 * Returns { run, stop, notes }; `run()` resolves { noted, sent?, why? }.
 */
export function startDriveNotes({
  listSources = async () => [], folder = () => null, readBy = () => '',
  storage = (typeof localStorage !== 'undefined' ? localStorage : null), notesStore = null,
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null), check = null, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), firstDelayMs = NOTES_FIRST_DELAY_MS,
  readOpts = {},
} = {}) {
  const notes = createDriveNotes({ store: notesStore || notesDeviceStore(), folder, now, by: readerId(storage), readBy });
  let timer = null;
  let stopped = false;
  let running = null;
  async function once() {
    const v = readViewSettings(storage);
    if (!v.saveToFolder) return { noted: 0, why: 'off' };
    const st = await notes.place();
    if (!SAVE_STATES.includes(st)) return { noted: 0, why: st };
    let list = [];
    try { list = (await listSources()) || []; } catch { return { noted: 0, why: 'sources' }; }
    let n = 0;
    for (const s of list) {
      if (stopped) break;
      if (!s || !s.id || s.kind === 'device') continue;
      const r = await readSource(s, { fetchImpl, check, ...readOpts });
      if (await notes.note(s, r, { noteAgainMs: v.noteAgainMs })) n += 1;
    }
    const synced = await notes.sync();
    return { noted: n, sent: synced.sent || 0, ...(synced.why ? { why: synced.why } : {}) };
  }
  const run = () => {
    if (!running) running = once().catch((e) => { console.error('storage notes: look', e); return { noted: 0, why: 'error' }; })
      .finally(() => { running = null; });
    return running;
  };
  function next(ms) {
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      run().finally(() => { const v = readViewSettings(storage); if (v.recheckMs > 0) next(v.recheckMs); });
    }, ms);
  }
  next(Math.max(0, Number(firstDelayMs) || 0));
  return {
    run, notes,
    stop() { stopped = true; if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; } },
  };
}
