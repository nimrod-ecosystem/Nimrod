// try_new.js — "TRY IT AS SOMEONE NEW": SEE THE SITE EXACTLY AS A BRAND-NEW PERSON WOULD, AS OFTEN AS YOU
// LIKE, WITHOUT LOSING ANYTHING OF YOUR OWN.
//
// Chat, 2026-10-04: *"Mike will be the first walkthrough, with [his AI] (Ollama) and Notes. Anything that makes
// a true first-run easy to repeat helps (a fresh person, or a 'start over as new' switch)."* This does NOT change
// what a new person lands on (row 2.53 is Mike's to decide); it only makes the first run that exists repeatable.
//
// =====================================================================================================
// THE SHAPE, ARGUED (three ways to get a first run; one is built, one is documented, one is refused):
//   * A TEST PERSON ON THE ACCOUNT — BUILT. The account grows a person named "New person - test"; this browser
//     is switched to them (people.js's remembered person) and the landing opens as their first visit. FOR: it is
//     the real server, the real person layer, the real per-person and per-dashboard records, so what is seen is
//     what a new person gets; and the owner's own person is never written (the suite holds it to that, but for
//     the notes, which are the point of the walk — below). AGAINST: it is a second person on the account, so the
//     people bar becomes a chooser while it exists ("Remove the test person" takes it away again).
//   * THE SIGNED-OUT MODE IN A PRIVATE WINDOW — DOCUMENTED, NOT BUILT. Cheap and already there (local_store.js:
//     "real pages without an account"). AGAINST as the main way: signed out is a different backend (IndexedDB, no
//     server, no push, no Claude, no notes on a record), and a private window forgets everything when it closes,
//     notes included. It is the right way to see the signed-out first visit, and it needs nothing from here.
//   * WIPING YOUR OWN PROGRESS — REFUSED. Destructive: tour, points, Home, notes and settings are records you
//     keep, and there is no undo for an append-only points ledger.
//
// WHAT "FRESH" IS MADE OF, and why each is fresh by construction rather than by deleting:
//   * tour progress and points live on a DASHBOARD's own records (unlocks.js decision 1: the ledger and the
//     unlock log are per-profile streams) — a new person has no dashboards, so none;
//   * the saved Home and Home's own settings (home_dashboard.js HOME_STATE_KEY) live on the PERSON — new person,
//     empty record;
//   * what's new has NO "seen" marker anywhere (modules/whats_new.js reads only the changelog), so there is
//     nothing to reset — the suite checks no such key appears;
//   * the landing tried before it is saved runs over this browser's local store under ONE preview id
//     (modules.html), shared by every person in the browser. A test person gets an id of their own
//     (`previewIdFor`), so Nimrod's walk and anything the preview kept start empty, and "Start over", which
//     makes a NEW person, gets a new one;
//   * a few first-run facts live in THIS BROWSER, not on any record: FIRST_RUN_KEYS, each argued below. They
//     are put aside on the way in and put back on "Back to me", so the owner's own browser state is untouched.
//
// "START OVER" MAKES A NEW PERSON. Points are an append-only ledger and the server will not delete events
// (db.delete_profile), so a person cannot be emptied in place; a new person (new id, new dashboards) is empty
// by construction. The old test person and their dashboards are removed — and only a person whose record says
// they are a test person, and only dashboards made after they were (a screen of yours handed to them stops it,
// with a sentence). Two presses: the first arms it, the second does it; nothing happens if nobody presses again.
//
// NOTES GO TO YOUR OWN PERSON, AS YOU MAKE THEM. Argued:
//   FOR copying them over on "Back to me": the test person's record would be a faithful "new person" record.
//   AGAINST, and it decides it: a copy that waits for a press is a copy that can be lost — a closed tab, a
//   "Start over" first, a second browser — and the walk exists to produce the notes. Written straight to the
//   owner's record (`openTrialNotes`, used by modules/nimrod.js), there is nothing to copy and nothing "Start
//   over" can reach. Each is marked "(trying it as someone new)" in its context, so the pasted list says which
//   ones were. Belt and braces: "Start over" and "Remove" still move any notes they find on the test person
//   (on their record, or in the preview's local store) to the owner before anything is removed.
//   The AI's name and how it talks stay the TEST person's (fresh, as a new person meets them); the AI's
//   ADDRESS and key are this browser's (ai.js) and are kept, so Nimrod's connect step finds your Ollama.
//   Argued: a first run with no AI reachable would not be the walk chat described, and moving a key in and
//   out of storage is a way to lose one.
//
// SCREENS KEEP THEIR OWN PERSON. Nothing here touches a screen's person: the kiosk never reads the remembered
// person (it is opened by its screen, and the screen names its person), and the test person's dashboards are
// newer than every screen of yours, so no "first screen" fallback ever picks one of theirs. The ⚙ rows live
// on Home only (modules.html's own rows), so a screen never shows them; argued there.
// =====================================================================================================

import { createState } from './state.js';

// people.js's remembered person, read and written here by its key rather than by importing people.js: modules/
// nimrod.js imports this file, and people.js brings the whole avatar stack with it. (The suite checks the key.)
export const LAST_PERSON_KEY = 'nimrod:last-person';
const readLastPerson = (s) => { try { return s?.getItem(LAST_PERSON_KEY) || ''; } catch { return ''; } };
const writeLastPerson = (id, s) => { try { s?.setItem(LAST_PERSON_KEY, String(id || '')); } catch { /* private mode */ } };

export const TRY_NEW_KEY = 'nimrod:tryNew';          // this browser's trial: { user, testId, ownerId, startedAt }
export const TRY_STASH_KEY = 'nimrod:tryNew:stash';  // this browser's own first-run keys, put back on "Back to me"
export const TRIAL_KEY = 'trial';                     // on the test person's record: { trial, ownerId, startedAt }
export const NOTES_RECORD_KEY = 'nimrod-ai';          // = nimrod_ai.js AI_STATE_KEY (the suite checks they agree)
export const NOTES_MAX = 200;                         // = nimrod_notes.js NOTES_MAX (the suite checks)
// Not "New person (test)": the server's name pattern (app.py NAME_RE) refuses brackets, and widening a server-wide
// rule for one label is the wrong trade. The hyphen reads the same.
export const TRIAL_NAME = 'New person - test';
export const TRYING_LABEL = 'Trying it as someone new';
export const TRIAL_NOTE_MARK = '(trying it as someone new)';
// A landing tried before it is saved: modules.html's own preview id, plus the test person's id.
export const PREVIEW_BASE = 'home-example-preview';   // = modules.html PREVIEW_PROFILE_ID (the suite checks)
export const previewIdFor = (personId) => `${PREVIEW_BASE}-${personId}`;

// THIS BROWSER'S FIRST-RUN FACTS. Put aside on the way in, put back exactly on "Back to me".
//   IN, each because a brand-new person on a brand-new browser would not have it:
//     tour position / done (tour.js), Nimrod the cat's position / done / preferences / remembered profile
//     (cat_guide.js, game/cat_steps.js), the demo strip dismissed (demo_strip.js), the starting-settings layer
//     (starting_defaults.js — "default settings"), this browser's screen settings and theme (settings.js,
//     theme.js), the colour grade and font chosen for this device (lut.js, user_fonts.js), recent pictures
//     (picture_picker.js).
//   OUT, each argued: the sign-in key (nimrod:deviceKey — losing it signs a paired device out); the AI's
//     address, backend and key (above); the master volume (the speakers here are the speakers here — a reset
//     could be loud); the remembered person (this file manages it); the offline cache (a mirror, not a record);
//     the device id and restart config (what this machine is, not who is using it).
export const FIRST_RUN_KEYS = Object.freeze([
  'nimrod:tourStep', 'nimrod:tourDone',
  'nimrod:catStep', 'nimrod:catDone', 'nimrod:catPrefs', 'nimrod:catProfile',
  'nimrod:demoStripDismissed',
  'nimrod.startingDefaults',
  'nimrod:device-settings', 'nimrod:theme',
  'nimrod.colourGrade.device', 'nimrod.userFont.device',
  'nimrod:recentPictures',
]);

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const getItem = (s, k) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const setItem = (s, k, v) => { try { s?.setItem(k, v); return true; } catch { return false; } };
const dropItem = (s, k) => { try { s?.removeItem(k); } catch { /* private mode */ } };
const readJSON = (s, k) => { try { const raw = getItem(s, k); return raw ? JSON.parse(raw) : null; } catch { return null; } };

// ---------- this browser's half ----------
/** The trial this browser is in, or null. `user`, when given, must match (a shared browser, two accounts). */
export function readTrial(storage = defaultStorage(), user = null) {
  const t = readJSON(storage, TRY_NEW_KEY);
  if (!t || typeof t !== 'object' || !t.testId) return null;
  if (user && t.user && t.user !== user) return null;
  return { user: t.user || null, testId: String(t.testId), ownerId: String(t.ownerId || ''), startedAt: Number(t.startedAt) || 0 };
}
/** The trial, only when this browser is actually showing the test person (the remembered person is them). */
export function trialShowing(storage = defaultStorage(), user = null) {
  const t = readTrial(storage, user);
  return t && readLastPerson(storage) === t.testId ? t : null;
}

/** Put this browser's first-run keys aside (once: a stash already there is the owner's, never overwritten). */
export function stashBrowser(storage = defaultStorage()) {
  if (getItem(storage, TRY_STASH_KEY) != null) return false;
  const kept = {};
  for (const k of FIRST_RUN_KEYS) { const v = getItem(storage, k); if (v != null) kept[k] = v; }
  return setItem(storage, TRY_STASH_KEY, JSON.stringify({ at: Date.now(), kept }));
}
export function clearFirstRun(storage = defaultStorage()) {
  for (const k of FIRST_RUN_KEYS) dropItem(storage, k);
}
/** Put them back EXACTLY: what was there is restored, what was not is removed (a key the test made goes). */
export function restoreBrowser(storage = defaultStorage()) {
  const st = readJSON(storage, TRY_STASH_KEY);
  if (!st || typeof st !== 'object') return false;
  const kept = st.kept && typeof st.kept === 'object' ? st.kept : {};
  for (const k of FIRST_RUN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(kept, k)) setItem(storage, k, String(kept[k]));
    else dropItem(storage, k);
  }
  dropItem(storage, TRY_STASH_KEY);
  return true;
}
function enterBrowser(storage, marker) {
  stashBrowser(storage);
  clearFirstRun(storage);
  setItem(storage, TRY_NEW_KEY, JSON.stringify(marker));
  writeLastPerson(marker.testId, storage);
}
function leaveBrowser(storage) {
  restoreBrowser(storage);
  dropItem(storage, TRY_NEW_KEY);
}

// ---------- the account's half ----------
async function readRow(makePersonState, personId, key) {
  const h = makePersonState(personId, key);
  if (!h) return { h: null, data: null };
  const data = await h.load();
  return { h, data: data || h.get?.() || {} };
}
async function writeRow(h, patch) { h.set(patch); await h.flush?.(); }
const done = (h) => { try { h?.destroy?.(); } catch { /* gone */ } };

/** The test-person record, or null when `personId` is nobody's test person. Throws when it cannot be read
 *  (offline): a caller must not take "could not tell" for "not a test person". */
export async function readTrialRecord(makePersonState, personId) {
  if (!personId || typeof makePersonState !== 'function') return null;
  const { h, data } = await readRow(makePersonState, personId, TRIAL_KEY);
  done(h);
  return data && data.trial === true ? { trial: true, ownerId: String(data.ownerId || ''), startedAt: Number(data.startedAt) || 0 } : null;
}

/** The account's test person ({ person, record }), or null. One per account: the first found. */
export async function findTrialPerson({ profiles, makePersonState }) {
  const list = (await profiles.people()) || [];
  for (const p of list) {
    let rec = null;
    try { rec = await readTrialRecord(makePersonState, p.id); } catch { rec = null; }
    if (rec) return { person: p, record: rec, people: list };
  }
  return null;
}

async function makeTrialPerson({ profiles, makePersonState, ownerId, name }) {
  const person = await profiles.addPerson(name || TRIAL_NAME);
  const { h } = await readRow(makePersonState, person.id, TRIAL_KEY);
  await writeRow(h, { trial: true, ownerId, startedAt: Date.now() });
  done(h);
  return person;
}

/** Whose notes, and whose "Back to me": the person pressed from, or (pressed as the test person) their owner. */
async function ownerOf(makePersonState, personId) {
  if (!personId) return '';
  let rec = null;
  try { rec = await readTrialRecord(makePersonState, personId); } catch { rec = null; }
  return rec ? rec.ownerId : personId;
}

/**
 * "Try it as someone new". Resumes the account's test person if there is one (making it new is "Start over":
 * a mis-press here must not throw a walk-through away), else makes one. Switches THIS browser to them.
 * Returns { person, resumed, ownerId }.
 */
export async function startTrial({ profiles, makePersonState, user = null, ownerId = '', storage = defaultStorage(),
                                   name = TRIAL_NAME } = {}) {
  const owner = await ownerOf(makePersonState, ownerId);
  const found = await findTrialPerson({ profiles, makePersonState });
  let person = found?.person || null;
  const resumed = !!person;
  const keepOwner = found?.record?.ownerId || owner;
  if (!person) person = await makeTrialPerson({ profiles, makePersonState, ownerId: owner, name });
  enterBrowser(storage, { user, testId: person.id, ownerId: keepOwner, startedAt: Date.now() });
  return { person, resumed, ownerId: keepOwner };
}

// ---------- notes: always the owner's ----------
const cleanList = (list) => (Array.isArray(list) ? list : [])
  .filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string' && n.text.trim() && Number.isFinite(Number(n.at)));
/** `into` plus every note of `from` it does not already have (by id), oldest first, capped like nimrod_notes.js. */
export function mergeNotes(into, from) {
  const have = new Set(cleanList(into).map((n) => n.id));
  return [...cleanList(into), ...cleanList(from).filter((n) => !have.has(n.id))]
    .sort((a, b) => Number(a.at) - Number(b.at)).slice(-NOTES_MAX);
}
async function moveNotesToOwner({ makePersonState, ownerId, notes }) {
  const list = cleanList(notes);
  if (!ownerId || !list.length) return 0;
  const { h, data } = await readRow(makePersonState, ownerId, NOTES_RECORD_KEY);
  if (!h) return 0;
  const merged = mergeNotes(data.notes, list);
  await writeRow(h, { notes: merged });
  done(h);
  return list.length;
}

/**
 * Where notes made as `personId` are kept: the OWNER's record, when this browser is trying it as someone new and
 * `personId` is the test person; else null (the module keeps its own). `{ get, set, load, flush, destroy, ownerId }`.
 */
export function openTrialNotes({ personId = '', storage = defaultStorage(), make = createState, baseURL = '' } = {}) {
  const t = readTrial(storage);
  if (!t || !personId || t.testId !== personId || !t.ownerId) return null;
  const h = make({ url: `${baseURL}/api/people/${encodeURIComponent(t.ownerId)}/state/${NOTES_RECORD_KEY}`, user: t.user || null });
  if (!h) return null;
  return {
    ownerId: t.ownerId,
    load: () => h.load(),
    get: () => { try { return h.get() || {}; } catch { return {}; } },
    set: (patch) => { try { h.set(patch); } catch (err) { console.error('try_new: notes', err); } },
    flush: () => h.flush?.(),
    destroy: () => { try { h.flush?.(); } catch { /* gone */ } try { h.destroy?.(); } catch { /* gone */ } },
  };
}

// ---------- removing a test person (Start over, Remove) ----------
async function removeTestPerson({ profiles, makePersonState, personId, localScope = null }) {
  const rec = await readTrialRecord(makePersonState, personId);
  if (!rec) throw new Error('That is not a test person, so nothing was removed.');
  const people = (await profiles.people()) || [];
  const me = people.find((p) => p.id === personId);
  if (!me) throw new Error('That test person is not on this account any more.');
  const screens = (await profiles.list(personId)) || [];
  // A screen made BEFORE the test person existed was handed to them: it is somebody's own. Checked for all
  // before anything is removed, so a refusal removes nothing.
  const older = screens.filter((s) => String(s.created_at || '') < String(me.created_at || ''));
  if (older.length) {
    throw new Error(`“${older[0].name}” was made before the test person, so it is one of your own: `
      + 'move it back to yourself on My dashboards first. Nothing was removed.');
  }
  // The notes first: on their record, then in the preview's local store.
  let moved = 0;
  try {
    const { h, data } = await readRow(makePersonState, personId, NOTES_RECORD_KEY);
    done(h);
    moved += await moveNotesToOwner({ makePersonState, ownerId: rec.ownerId, notes: data?.notes });
  } catch (err) { console.error('try_new: notes on the record', err); throw new Error('Their notes could not be read, so nothing was removed.'); }
  if (localScope) {
    const rows = await localScope.rows(previewIdFor(personId)).catch(() => []);
    for (const r of rows) moved += await moveNotesToOwner({ makePersonState, ownerId: rec.ownerId, notes: r?.data?.ai?.notes });
  }
  for (const s of screens) await profiles.remove(s.id);
  await profiles.removePerson(personId);
  if (localScope) await localScope.clear(previewIdFor(personId)).catch(() => {});
  return { record: rec, moved };
}

/**
 * "Start over": the test person, made new. Removes them (and their dashboards) and makes a new one for the
 * same owner, then this browser shows the new one with its first-run keys cleared (the owner's stay stashed).
 * `localScope`: { rows(pid), clear(pid) } over this browser's local store (local_store.js), optional.
 * Returns { person, ownerId, moved }.
 */
export async function startOver({ profiles, makePersonState, personId, user = null, storage = defaultStorage(),
                                  localScope = null, name = TRIAL_NAME } = {}) {
  const { record, moved } = await removeTestPerson({ profiles, makePersonState, personId, localScope });
  const person = await makeTrialPerson({ profiles, makePersonState, ownerId: record.ownerId, name });
  enterBrowser(storage, { user, testId: person.id, ownerId: record.ownerId, startedAt: Date.now() });
  return { person, ownerId: record.ownerId, moved };
}

/** "Back to me": this browser goes back to the owner, with its own first-run keys put back. The test person
 *  stays on the account (pick "Try it as someone new" again to carry on). Returns the owner's id. */
export async function backToMe({ makePersonState = null, personId = '', storage = defaultStorage() } = {}) {
  let ownerId = readTrial(storage)?.ownerId || '';
  if (personId && makePersonState) {
    try { const rec = await readTrialRecord(makePersonState, personId); if (rec?.ownerId) ownerId = rec.ownerId; } catch { /* the marker's */ }
  }
  leaveBrowser(storage);
  if (ownerId) writeLastPerson(ownerId, storage);
  return ownerId;
}

/** "Remove the test person": gone, their dashboards with them, their notes moved to the owner first. */
export async function removeTrial({ profiles, makePersonState, personId, storage = defaultStorage(), localScope = null } = {}) {
  const t = readTrial(storage);
  const { record, moved } = await removeTestPerson({ profiles, makePersonState, personId, localScope });
  if (t && t.testId === personId) { leaveBrowser(storage); writeLastPerson(record.ownerId, storage); }
  return { ownerId: record.ownerId, moved };
}

/**
 * Make this browser agree with who it is showing. `record`: readTrialRecord's answer for `personId` (undefined
 * when it could not be read: then nothing changes). A test person shown without the browser half (picked from
 * the people bar) enters it; anybody else shown while the browser is in a trial leaves it.
 */
export function syncTrial({ user = null, personId = '', record, storage = defaultStorage() } = {}) {
  if (record === undefined || !personId) return readTrial(storage, user);
  const t = readTrial(storage, user);
  if (record && record.trial) {
    if (!t || t.testId !== personId) enterBrowser(storage, { user, testId: personId, ownerId: record.ownerId, startedAt: Date.now() });
    return readTrial(storage, user);
  }
  if (t) leaveBrowser(storage);
  return null;
}

// ---------- the strip that says so, and its two-press Start over ----------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const STYLE_ID = 'tn-style';
// Theme tokens only. `fixed`: a small pill over the page (the landing fills the window, so it takes no room).
const STYLE = `
.tn-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:6px 10px;border-radius:12px;
  background:var(--surface);color:var(--text);border:2px solid var(--highlight);font:inherit;font-size:.92rem;
  box-sizing:border-box;max-width:calc(100vw - 32px)}
.tn-bar.tn-fixed{position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483000;
  box-shadow:0 2px 10px color-mix(in srgb, var(--text) 25%, transparent)}
.tn-bar b{font-weight:700}
.tn-bar button,.tn-bar a{font:inherit;font-size:.9rem;padding:3px 10px;border-radius:99px;border:1px solid var(--border);
  background:var(--bg);color:var(--text);cursor:pointer;text-decoration:none}
.tn-bar button[data-tn-armed]{border-color:var(--highlight);font-weight:700}
.tn-bar .tn-msg{color:var(--text-muted)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID; s.textContent = STYLE;
  (doc.head || doc.documentElement).append(s);
}

/**
 * The "Trying it as someone new" strip. `onStartOver`, `onBack`: async. `landing`: an address to open the
 * landing from (omitted on the landing itself). Start over takes two presses; Keep going disarms it.
 * Returns { destroy(), arm(), armed(), say(text) }.
 */
export function mountTrialBar(el, { onStartOver, onBack, landing = '', fixed = false, name = TRIAL_NAME } = {}) {
  const doc = el.ownerDocument;
  ensureStyle(doc);
  let armed = false;
  let busy = false;
  let gone = false;
  let msg = '';
  function render() {
    el.innerHTML = `<div class="tn-bar${fixed ? ' tn-fixed' : ''}" data-trial-bar role="status">
      <b>${esc(TRYING_LABEL)}</b><span class="tn-msg">as “${esc(name)}”</span>
      ${landing ? `<a href="${esc(landing)}" data-tn-open>Open the landing</a>` : ''}
      ${armed
        ? `<button type="button" data-tn-start data-tn-armed ${busy ? 'disabled' : ''}>Yes, start over as someone new</button>
           <button type="button" data-tn-cancel ${busy ? 'disabled' : ''}>Keep going</button>`
        : `<button type="button" data-tn-start ${busy ? 'disabled' : ''}
             title="Make them new again: no tour, no points, no Home. Your notes stay with you.">Start over</button>`}
      <button type="button" data-tn-back ${busy ? 'disabled' : ''} title="Back to your own person; this browser’s own settings come back">Back to me</button>
      ${msg ? `<span class="tn-msg" data-tn-msg>${esc(msg)}</span>` : ''}
    </div>`;
  }
  async function run(fn) {
    if (busy) return;
    busy = true; msg = ''; render();
    try { await fn(); } catch (err) { msg = err?.message || 'That did not work.'; console.error('try_new', err); }
    // The action may have taken the strip down (Back to me): then it stays down.
    finally { busy = false; armed = false; if (!gone && el.isConnected) render(); }
  }
  const onClick = (e) => {
    const t = e.target;
    if (!(t instanceof doc.defaultView.Element)) return;
    if (t.closest('[data-tn-start]')) {
      if (!armed) { armed = true; msg = ''; render(); return; }
      run(() => onStartOver?.());
      return;
    }
    if (t.closest('[data-tn-cancel]')) { armed = false; render(); return; }
    if (t.closest('[data-tn-back]')) run(() => onBack?.());
  };
  el.addEventListener('click', onClick);
  render();
  return {
    arm() { if (gone) return; armed = true; render(); },
    armed: () => armed,
    say(text) { if (gone) return; msg = String(text || ''); render(); },
    destroy() { gone = true; el.removeEventListener('click', onClick); el.innerHTML = ''; },
  };
}
