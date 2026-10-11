// removed_pictures.js — "REMOVE THIS PICTURE": which pictures somebody removed, kept on this device and in the person's
// Nimrod folder, never on the server; and which sources move a removed picture into their Removed folder.
//
// Mike, 2026-10-10: "There should be options for this when you're setting up folders. You can decide whether pictures
// are deleted off of each drive when they are deleted." So a removal is two things:
//   1. THE LIST (this file): the picture leaves every slideshow that reads it, as a hide does (hidden_pictures.js) -
//      every panel and every person on this device, and every device that reads the same Nimrod folder. Undone by
//      "bring it back" (by voice, two-step like Hide, or a "Bring back" row in the panel's settings). Always for
//      everybody: a picture moved off a drive is gone from it for everybody, so a per-person removal would be a lie.
//   2. EACH SOURCE'S OWN CHOICE (media_sources.js ON_REMOVE, set in Media where the folder is added): "keep it here"
//      (THE DEFAULT, DECISIONS 2026-10-09/10: deletions kept by default) leaves the file alone; "remove it here too"
//      MOVES it into a Removed folder (.nimrod-removed/<date>/) inside that folder - never deletes it. The media agent
//      does the move (agent.py POST /media/remove, only with --removals, only from its own computer); a browser folder
//      does it itself once the browser was given permission to change it (folder_source.js moveFolderPicture).
//
// THE LIST IS THE HIDDEN LIST'S MACHINERY (createHiddenPictures with this file's kinds, stream, record and tag): an
// append-only log of remove / restore rows, replayed; on this device in IndexedDB `nimrod-removed`; copied to the
// person's Nimrod folder as Data/History/removed-pictures-<YYYY-MM>.jsonl; never the server (storage_line.py rule 7
// refuses the tag, the keys, the kinds and the stream; this file has no way to reach the site at all - the moves go
// through media_sources.js, to the person's own media agent or folder).
//
// *** THE FOLLOW-UP (`followUpPlan`). *** A source set to "remove it here too" may not be reachable at the moment of the
// removal: a drive in another room, a screen that is off, an agent that takes moves only from its own computer. So
// every Photos panel, whenever it lists a source set to "remove it here too", moves any listed picture that is on the
// removed list (and brings back any brought-back picture that is not listed). That is how a removal said on one
// screen reaches the drive of another, and how a removal made while a drive was away reaches it when it is back.
// Bounded per listing (FOLLOW_UP_MAX) and once per page for each (source, picture), so a big list never turns one
// listing into hundreds of requests.

import { createHiddenPictures, hiddenEntries, pictureKey, HIDDEN_DEFAULTS } from './hidden_pictures.js';
import { idbPlayStore, memoryPlayStore } from './plays.js';

export const REMOVED_STREAM = 'removed';               // the folder's file name starts with it (agent HISTORY_STREAM_RE)
export const REMOVED_FILE_SCOPE = 'pictures';          // ... then this: removed-pictures-<month>.jsonl
export const REMOVE_KIND = 'remove-picture';
export const RESTORE_KIND = 'restore-picture';
export const REMOVED_KINDS = Object.freeze({ on: REMOVE_KIND, off: RESTORE_KIND });
export const REMOVED_DB = 'nimrod-removed';
export const REMOVED_RECORD = 'removed:pictures';
// The list's own tag, on any copy of it as one object (`snapshot()`). The server refuses anything carrying it
// (storage_line.py rule 7, which holds the strings equal through test_storage_line.py).
export const REMOVED_FORMAT = 'nimrod-removed-pictures';

// HARD-CODED, argued (Rule 1; a cap protects the computer, it is not a taste):
//   FOLLOW_UP_MAX 20   moves (or bring-backs) one listing may ask for. A person removes pictures one at a time, so a
//                      listing almost never finds more than one or two; 20 catches up a drive that was away for a
//                      while within a few listings (a panel lists again every hour after a pull, and on every reload),
//                      and keeps a long list from sending hundreds of requests at a Pi in one go.
export const FOLLOW_UP_MAX = 20;

/** The device's store: this browser's IndexedDB, or memory where there is none. */
let deviceStore = null;
export function removedDeviceStore() {
  if (!deviceStore) {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    deviceStore = idb ? idbPlayStore({ name: REMOVED_DB, idb }) : memoryPlayStore();
  }
  return deviceStore;
}

/**
 * A HANDLE OVER THE REMOVAL LOG: createHiddenPictures's (ready, rows, entries, paths, sync, pull, subscribe, snapshot)
 * with this list's kinds, and two names that say what they do:
 *   remove({ path, name?, screen?, panel? })   on the list at once, for everybody; resolves the row or null
 *   restore(entry)                             off the list ("bring it back"); resolves the row or null
 *   restored()                                 the entries brought back (newest row a restore), newest first
 */
export function createRemovedPictures(o = {}) {
  const h = createHiddenPictures({ ...o, kinds: REMOVED_KINDS, stream: REMOVED_STREAM, fileScope: REMOVED_FILE_SCOPE,
    record: REMOVED_RECORD, format: REMOVED_FORMAT });
  const remove = (raw = {}) => h.hide({ ...raw, scope: 'everyone', person: '' });
  const restore = (entry = {}) => h.unhide({ ...entry, scope: 'everyone', person: '' });
  return { ...h, remove, restore, hide: remove, unhide: restore, restored: () => h.offEntries() };
}

/** The entries in force in a removal log's rows (pure; for the suites and the follow-up). */
export const removedEntries = (rows) => hiddenEntries(rows, { kinds: REMOVED_KINDS });

/**
 * WHAT ONE LISTING OF A SOURCE SET TO "REMOVE IT HERE TOO" SHOULD ASK IT TO DO (THE FOLLOW-UP, above). Pure.
 *   items     the listing's items (each with a path or id)
 *   removed   Set of removed paths; restored: Set of brought-back paths
 *   done      Set of `${kind}|${sourceId}|${path}` already asked this page (read only; the caller adds)
 * Returns { remove: [paths], restore: [paths] }, at most `max` in all, removals first.
 */
export function followUpPlan({ sourceId = '', items = [], removed = new Set(), restored = new Set(), done = new Set(),
  max = FOLLOW_UP_MAX } = {}) {
  const listed = new Set((Array.isArray(items) ? items : []).map((it) => pictureKey(it)).filter(Boolean));
  const out = { remove: [], restore: [] };
  let room = Math.max(0, Number(max) || 0);
  for (const p of listed) {
    if (!room) break;
    if (removed.has(p) && !done.has(`remove|${sourceId}|${p}`)) { out.remove.push(p); room -= 1; }
  }
  for (const p of restored) {
    if (!room) break;
    if (!listed.has(p) && !removed.has(p) && !done.has(`restore|${sourceId}|${p}`)) { out.restore.push(p); room -= 1; }
  }
  return out;
}

// ---------- this page's one handle ----------
let device = null;
let deviceHistory = null;
let deviceUnwatch = null;
/**
 * THE PAGE'S HANDLE over this device's removal log (hidden_pictures.js deviceHiddenPictures, the same way): copied to
 * the folder of the screen's history host, and merged from it at most once a `lookEveryMs`.
 */
export function deviceRemovedPictures({ history = null } = {}) {
  if (!device) {
    device = createRemovedPictures({ store: removedDeviceStore(), folder: () => (deviceHistory && deviceHistory.folder) || null });
    device.ready.then(() => { device.pull(); device.sync(); });
  }
  if (history && history !== deviceHistory) {
    deviceHistory = history;
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
