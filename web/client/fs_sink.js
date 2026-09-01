// fs_sink.js — WRITING INTO A FOLDER THE USER PICKED, AND CLEANING UP AFTER IT.
//
// `DECISIONS.md`, settled 2026-08-29: *users decide where their data goes by picking folders,
// and Nimrod should not have anywhere to save it.* The media agent is the built precedent for
// READING that way — the platform server never receives the bytes. This is the same idea in the
// other direction, and it is the first thing in the project that writes.
//
// The File System Access API is what makes that literal rather than aspirational: the user picks
// a directory, the page writes into it, and **nothing goes anywhere near a server**. No upload
// path, no "temporarily" holding it, no bucket. The bytes are on their machine because they
// never left it.
//
// ---------------------------------------------------------------------------------------
// *** WHAT IT CANNOT DO, SAID FIRST, BECAUSE IT DECIDES WHAT MAY BE PROMISED ***
// ---------------------------------------------------------------------------------------
//
// Mike, 2026-08-31: *"how long the files are kept is an issue."* It is, and the honest shape of
// the answer is narrower than the obvious one.
//
// **Nimrod cannot promise "deleted after thirty days."** The files are in a folder on somebody's
// machine and this software is not running on day thirty. A retention policy enforced by a page
// that has to be open to enforce it is a promise enforced by nothing.
//
// What it CAN do, and does:
//
//   1. **Write the expiry into every recording**, so the fact survives independently of any
//      setting and of this software — see `recorder.js`. A script, a later version, or a person
//      with a file manager can all act on it.
//   2. **Sweep whenever it has the folder open.** Opportunistic, real, and describable without
//      lying: *"tidied up whenever this is opened"*.
//   3. **Say which files are over their date but still here**, so somebody can see the gap
//      rather than assume there is none.
//
// *** AND MIKE'S RULING, 2026-08-31: "if deleting the files is on the user, that's fine for
// now." *** So that is the shape, and it settles what this file is FOR: the expiry date and the
// sweep are a CONVENIENCE, not a promise. Nothing nags, nothing counts down on screen, and the
// honest sentence is "these are your files, in your folder, and there is a Delete button".
//
// Which is also why nothing here escalates. A version of this that started warning somebody
// weekly about recordings they had chosen to keep would be the product deciding it knows better
// than the person whose folder it is — and that is exactly the move `PRINCIPLES.md` §1.2 is
// about. The information is available; the pressure is not applied.
//
// ---------------------------------------------------------------------------------------
// A SESSION IS A FOLDER, AND IT IS DELETED WHOLE
// ---------------------------------------------------------------------------------------
//
// Each recording is a directory: `manifest.json` plus one WAV per channel. **Deleting removes
// the whole directory**, never a file inside it — because a half-deleted pair is worse than
// either half. Far-field audio with no label is unusable; a label with no far-field audio is a
// transcript of somebody with the context gone; and a manifest describing files that are not
// there is a puzzle for whoever finds it.
//
// ---------------------------------------------------------------------------------------
// EVERYTHING IS INJECTED
// ---------------------------------------------------------------------------------------
//
// A `FileSystemDirectoryHandle` is a small, well-defined interface, so the whole of this is
// exercised against a fake one — no picker, no permission prompt, no files. Which is the only
// way anything that DELETES somebody's recordings should be tested.

// A recognizable, sortable, human-readable folder name. Sortable matters: somebody looking at
// this folder in a file manager a year from now should see sessions in order without opening
// anything, and `1756598400000` does not do that.
export function sessionName(startedAt, { now = () => Date.now() } = {}) {
  const d = new Date(Number(startedAt) || now());
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `nimrod-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const MANIFEST_FILE = 'manifest.json';

/** Is this browser able to do any of it? Firefox and Safari cannot, as of writing. */
export function available(view = (typeof window !== 'undefined' ? window : null)) {
  return !!(view && typeof view.showDirectoryPicker === 'function');
}

/**
 * Ask for a folder. A REAL PROMPT, so it only ever happens from something somebody pressed —
 * never on mount, for the same reason the microphone permission is not requested on mount.
 */
export async function pickFolder({ view = (typeof window !== 'undefined' ? window : null) } = {}) {
  if (!available(view)) throw new Error('This browser cannot write to a folder you choose.');
  return view.showDirectoryPicker({ id: 'nimrod-recordings', mode: 'readwrite' });
}

// ---------------------------------------------------------------------------------------
// *** REMEMBERING THE FOLDER ACROSS A RELOAD — and the two halves have different answers ***
// ---------------------------------------------------------------------------------------
//
// This decides whether "tidied up whenever this is opened" is true or wishful, so it was probed
// rather than assumed (`dev/fs_handle_probe.html`).
//
// **VERIFIED on Chromium 148, 2026-08-31 — the HANDLE survives.** A `FileSystemDirectoryHandle`
// is structured-cloneable, stores in IndexedDB, and reads back as a working handle;
// `isSameEntry` confirms it is the same directory. That half is exactly what Mike expected.
//
// **The PERMISSION is the other half, and it is the one that bites.** After a reload,
// `queryPermission` on a recalled handle normally reads `prompt`, not `granted` — and
// `requestPermission` may only prompt from a USER GESTURE. So a page cannot silently reach into
// somebody's folder on load, which is correct behavior by the browser and an inconvenience for
// a sweeper.
//
// *(That half needs a folder a human actually picked, so it is the button in the probe rather
// than something I could verify myself. Chrome can also be told "allow on every visit" per site,
// which would make it `granted` — but that is a choice a person makes, never something the page
// may assume.)*
//
// **So the design is: recall silently, sweep silently IF permission survived, and otherwise put
// a button in front of somebody rather than pretending.** `recallFolder` reports which of those
// it is instead of quietly returning a handle that cannot be used.

const DB_NAME = 'nimrod-files';
const STORE = 'handles';
const FOLDER_KEY = 'recordings';

function openDb(idb) {
  return new Promise((res, rej) => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function txDo(db, mode, fn) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const rq = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(rq ? rq.result : true);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

/** Keep the folder somebody chose, so they are not asked to find it again every session. */
export async function rememberFolder(handle, { idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), key = FOLDER_KEY } = {}) {
  if (!idb || !handle) return false;
  try {
    const db = await openDb(idb);
    await txDo(db, 'readwrite', (st) => st.put(handle, key));
    return true;
  } catch { return false; }        // a browser in private mode, or storage refused. Not fatal.
}

/**
 * Get it back, WITH an honest reading of whether it can actually be used.
 *
 * `permission` is `granted` (sweep away), `prompt` (a person has to press something), `denied`,
 * or `unknown`. Returning a handle without saying which of those it is would be the same shape
 * of lie as the retention promise this file exists to avoid.
 */
export async function recallFolder({ idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), key = FOLDER_KEY } = {}) {
  if (!idb) return { handle: null, permission: 'unknown' };
  let handle = null;
  try {
    const db = await openDb(idb);
    handle = await txDo(db, 'readonly', (st) => st.get(key));
  } catch { return { handle: null, permission: 'unknown' }; }
  if (!handle) return { handle: null, permission: 'unknown' };
  let permission = 'unknown';
  try { permission = await handle.queryPermission?.({ mode: 'readwrite' }) || 'unknown'; }
  catch { permission = 'unknown'; }
  return { handle, permission };
}

/**
 * Ask for it back. *** MUST BE CALLED FROM A USER GESTURE *** — the browser will refuse to
 * prompt otherwise, and the refusal looks like a denial, which is a confusing thing to debug.
 */
export async function ensurePermission(handle) {
  if (!handle?.requestPermission) return 'unknown';
  try {
    if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return 'granted';
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch { return 'denied'; }
}

export async function forgetFolder({ idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), key = FOLDER_KEY } = {}) {
  if (!idb) return false;
  try {
    const db = await openDb(idb);
    await txDo(db, 'readwrite', (st) => st.delete(key));
    return true;
  } catch { return false; }
}

/**
 * The whole open-the-app story in one call: get the folder back, and sweep it IF that is
 * possible without interrupting anybody.
 *
 * *** IT NEVER PROMPTS. *** A page that asked for filesystem permission the moment it loaded
 * would train people to refuse — the same reasoning as the microphone permission in
 * `device_panel.js`, and the same answer: a button that says what it will do.
 *
 * `needsPermission: true` is the caller's cue to show that button.
 */
export async function openAndSweep({ isExpired, now = Date.now(), idb, key } = {}) {
  const { handle, permission } = await recallFolder({ idb, key });
  if (!handle) return { handle: null, permission, needsPermission: false, swept: [], overdue: [], kept: 0 };
  if (permission !== 'granted') {
    return { handle, permission, needsPermission: true, swept: [], overdue: [], kept: 0 };
  }
  const res = await sweep(handle, { now, isExpired });
  return { handle, permission, needsPermission: false, ...res };
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await w.write(data); } finally { await w.close(); }
  return name;
}

/**
 * Write one session: a folder containing the manifest and one WAV per channel.
 *
 * *** THE MANIFEST IS WRITTEN LAST, DELIBERATELY. *** If the write is interrupted — a browser
 * closed, a disk full, permission withdrawn mid-way — what is left behind is audio with no
 * manifest, which `listSessions` ignores and a person can see is incomplete. Writing it FIRST
 * would leave a manifest promising channels that are not there, which reads as complete and is
 * not. Neither outcome is good; only one of them lies.
 */
export async function saveSession(dir, { manifest, tracks }, { now = () => Date.now() } = {}) {
  if (!dir) throw new Error('saveSession: no folder chosen');
  if (!manifest || !Array.isArray(tracks)) throw new Error('saveSession: nothing to save');
  const name = sessionName(manifest.startedAt, { now });
  const sub = await dir.getDirectoryHandle(name, { create: true });

  const written = [];
  for (const t of tracks) {
    const file = t.file || `${t.role || 'other'}.wav`;
    await writeFile(sub, file, t.wav);
    written.push(file);
  }
  await writeFile(sub, MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  return { folder: name, files: [...written, MANIFEST_FILE] };
}

/** Read back what is in the folder. A directory with no manifest is skipped rather than guessed
 *  at — see `saveSession` for why one can legitimately exist. */
export async function listSessions(dir) {
  if (!dir?.values) return [];
  const out = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'directory') continue;
    try {
      const fh = await entry.getFileHandle(MANIFEST_FILE);
      const text = await (await fh.getFile()).text();
      out.push({ folder: entry.name, manifest: JSON.parse(text) });
    } catch {
      // No manifest, or unreadable. INCOMPLETE, not corrupt — and reported as such rather than
      // dropped silently, because a folder of orphaned audio is exactly the thing somebody
      // should be told about instead of it sitting there for a year.
      out.push({ folder: entry.name, manifest: null, incomplete: true });
    }
  }
  return out.sort((a, b) => (a.folder < b.folder ? -1 : 1));
}

/**
 * Delete everything past its own expiry date.
 *
 * *** OPPORTUNISTIC, AND THE WORDING MATTERS. *** This runs when the app happens to have the
 * folder. It is not a scheduler and must never be described as one. `swept` is what it actually
 * removed; `overdue` is what it found and did NOT remove, which on a first run is usually
 * nothing and after a long gap is the honest number to show somebody.
 *
 * A session with no expiry is KEPT. That is the safe direction: deleting somebody's recording
 * because a field was missing cannot be undone; keeping one a week too long can.
 */
export async function sweep(dir, { now = Date.now(), isExpired, dryRun = false } = {}) {
  if (!dir || typeof isExpired !== 'function') return { swept: [], overdue: [], kept: 0 };
  const sessions = await listSessions(dir);
  const swept = [], overdue = [];
  let kept = 0;
  for (const s of sessions) {
    if (!s.manifest || !isExpired(s.manifest, now)) { kept += 1; continue; }
    if (dryRun) { overdue.push(s.folder); continue; }
    try {
      // RECURSIVE, so the whole session goes — never a file out of a pair. See the header.
      await dir.removeEntry(s.folder, { recursive: true });
      swept.push(s.folder);
    } catch {
      // A folder that will not delete is reported rather than retried into a loop: it is almost
      // always a permission that has lapsed, and that wants a person, not another attempt.
      overdue.push(s.folder);
    }
  }
  return { swept, overdue, kept };
}

/**
 * Delete one session because somebody asked.
 *
 * Separate from `sweep` on purpose. `DECISIONS.md`: *deletion works from the screen and is a
 * hard delete* — and a person's explicit "remove that" should not be routed through machinery
 * whose job is expiry, where a missing date would turn it into a no-op.
 */
export async function deleteSession(dir, folder) {
  if (!dir || !folder) return false;
  try { await dir.removeEntry(folder, { recursive: true }); return true; }
  catch { return false; }
}

/**
 * What to tell somebody about the state of the folder — in words, and without overclaiming.
 * Returned rather than rendered so the wording is testable, which for a sentence about deleting
 * recordings is the point.
 */
export function describeSweep(res, { keepDays = 0 } = {}) {
  if (!res) return '';
  const bits = [];
  if (res.swept.length) bits.push(`Removed ${res.swept.length} recording${res.swept.length === 1 ? '' : 's'} past its keep-until date.`);
  if (res.overdue.length) bits.push(`${res.overdue.length} could not be removed and are still here.`);
  if (!bits.length) bits.push(`Nothing was due for removal.`);
  // NEVER "deleted after N days". This software is not running on day N, and saying so would be
  // a promise enforced by nothing.
  if (keepDays > 0) bits.push(`New recordings are marked to be kept ${keepDays} days, and are tidied up whenever this page is opened.`);
  else bits.push(`New recordings are marked to be kept until somebody removes them.`);
  return bits.join(' ');
}
