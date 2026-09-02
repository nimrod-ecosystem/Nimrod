// local_store.js — the whole product, running with no account, in the browser.
//
// WHY: signing up to find out what something is is a bad trade for someone having a hard
// week, and a separate "demo" page is worse — it is a brochure that moves, and it drifts
// from the real thing the moment anyone touches either. So instead of a demo, the REAL
// pages run for a signed-out visitor against browser storage. Signing in stops being a gate
// and becomes a feature: keep this, and use it on your other devices.
//
// HOW IT FITS: everything in the client already goes through three injectables —
// `createProfilesClient`, `createState`, `createEvents`. This file implements the same three
// surfaces over IndexedDB, so `mountHome` and the panels below it are UNCHANGED. If these
// contracts drift apart, signed-out mode quietly rots; the test drives both through the same
// assertions for that reason.
//
// WHAT IS DELIBERATELY DIFFERENT:
//   * No versions/conflicts. Optimistic concurrency exists because two devices can write the
//     same row; here there is exactly one device and one tab-owner, so `version` is a
//     counter that only ever goes up, kept so `getVersion()` still answers.
//   * No polling. Nothing else can change this data, so `startPolling()` is a no-op rather
//     than a timer that wakes a kiosk up forever for nothing.
//   * Writes land immediately. The server client debounces to spare the network; there is no
//     network here, and a lost write because someone closed the tab 300ms early would be
//     indistinguishable from the bug we just spent a night removing.

import { listFolderSources, removeFolderSource } from './folder_source.js';
import { STARTER_MODULES } from './modules_catalog.js';

const DB_NAME = 'nimrod-local';
// Bumped for the PEOPLE store. `onupgradeneeded` creates any store that is missing, so an
// existing visitor's screens and state survive the bump — the new store simply appears,
// and their orphaned screens are adopted by their first person exactly as the server does
// it for a legacy account.
const DB_VERSION = 2;
const PROFILES = 'profiles';
const STATE = 'state';
const EVENTS = 'events';
const PEOPLE = 'people';

// Mirrors db.person_scope on the server, so per-person rows are addressed the same way on
// both sides and the two halves cannot drift into disagreeing about where a binding lives.
export const personScope = (personId) => `_user_${personId}`;
export const LEGACY_PERSON_SCOPE = '_user';

const nowISO = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `x${Date.now()}${Math.floor(Math.random() * 1e6)}`)
  .replace(/-/g, '');

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of [PROFILES, STATE, EVENTS, PEOPLE]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store, mode, fn) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      Promise.resolve(fn(t.objectStore(store))).then((v) => { out = v; }).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

const getRow = (store, k) => tx(store, 'readonly', (s) => asPromise(s.get(k)));
const putRow = (store, row) => tx(store, 'readwrite', (s) => { s.put(row); });
const allRows = (store) => tx(store, 'readonly', (s) => asPromise(s.getAll()));
const delRow = (store, k) => tx(store, 'readwrite', (s) => { s.delete(k); });

// ---------------------------------------------------------------- profiles
function createLocalProfilesClient() {
  const strip = (p) => ({
    id: p.id, name: p.name, person_id: p.person_id || '', created_at: p.created_at,
  });
  const byCreated = (a, b) => String(a.created_at).localeCompare(String(b.created_at));

  // ---- people: the same contract the server serves, over IndexedDB --------------
  // Signed out there is one device and no account, but the CONCEPT still has to exist —
  // otherwise a visitor evaluating Nimrod for two residents cannot see the thing that
  // makes it worth having, and the signed-out path drifts from the real one. Same shape,
  // same adoption of orphans, no version/conflict machinery (see this file's header).
  async function people() {
    await ensureDefaultPerson();
    return (await allRows(PEOPLE)).map((r) => r.v).sort(byCreated);
  }

  async function ensureDefaultPerson(name = 'Me') {
    const rows = (await allRows(PEOPLE)).map((r) => r.v).sort(byCreated);
    if (rows.length) return rows[0].id;
    const person = { id: newId(), name, created_at: nowISO() };
    await putRow(PEOPLE, { k: person.id, v: person });
    // Adopt whatever already existed, exactly as db.ensure_default_person does: screens
    // with no person, and the legacy per-user state rows that hold the input bindings.
    for (const row of await allRows(PROFILES)) {
      if (!row.v.person_id) { row.v.person_id = person.id; await putRow(PROFILES, row); }
    }
    for (const row of await allRows(STATE)) {
      const [pid, key] = String(row.k).split('::');
      if (pid !== LEGACY_PERSON_SCOPE) continue;
      await putRow(STATE, { ...row, k: `${personScope(person.id)}::${key}` });
      await delRow(STATE, row.k);
    }
    return person.id;
  }

  async function addPerson(name) {
    await ensureDefaultPerson();
    const person = { id: newId(), name, created_at: nowISO() };
    await putRow(PEOPLE, { k: person.id, v: person });
    return person;
  }

  async function renamePerson(personId, name) {
    const row = await getRow(PEOPLE, personId);
    if (!row) throw new Error(`no such person: ${personId}`);
    row.v.name = name;
    await putRow(PEOPLE, row);
    return row.v;
  }

  // The same two refusals the server makes, and for the same reasons: cascading the
  // screens would make deleting a name a way to destroy a whole setup, and an account
  // with nobody on it has no valid state to be in.
  async function removePerson(personId) {
    const all = (await allRows(PEOPLE)).map((r) => r.v);
    if (all.length <= 1) throw new Error('an account needs at least one person');
    const mine = (await allRows(PROFILES)).filter((r) => r.v.person_id === personId);
    if (mine.length) {
      throw new Error(`this person still has ${mine.length} screen${mine.length === 1 ? '' : 's'} `
        + '- move or delete them first');
    }
    for (const row of await allRows(STATE)) {
      if (String(row.k).split('::')[0] === personScope(personId)) await delRow(STATE, row.k);
    }
    await delRow(PEOPLE, personId);
    return { ok: true };
  }

  // ---- screens ------------------------------------------------------------------
  async function list(personId = '') {
    await ensureDefaultPerson();
    return (await allRows(PROFILES))
      .map((r) => r.v)
      .filter((p) => !personId || (p.person_id || '') === personId)
      .sort(byCreated)
      .map(strip);
  }

  async function get(pid) {
    const row = await getRow(PROFILES, pid);
    if (!row) throw new Error(`no such profile: ${pid}`);
    return { ...strip(row.v), modules: [...(row.v.modules || [])] };
  }

  async function create(name, personId = '') {
    const owner = personId || await ensureDefaultPerson();
    const p = { id: newId(), name, person_id: owner, created_at: nowISO(), modules: [] };
    await putRow(PROFILES, { k: p.id, v: p });
    return strip(p);
  }

  async function moveToPerson(pid, personId) {
    const row = await getRow(PROFILES, pid);
    if (!row) throw new Error(`no such profile: ${pid}`);
    row.v.person_id = personId;
    await putRow(PROFILES, row);
    return strip(row.v);
  }

  async function rename(pid, name) {
    const row = await getRow(PROFILES, pid);
    if (!row) throw new Error(`no such profile: ${pid}`);
    row.v.name = name;
    await putRow(PROFILES, row);
    return strip(row.v);
  }

  // Mirrors the server: deleting a screen drops its modules and settings but NOT its
  // events. A score or a clinical record must not be erasable by removing a screen.
  async function remove(pid) {
    const row = await getRow(PROFILES, pid);
    await delRow(PROFILES, pid);
    for (const m of (row && row.v.modules) || []) await delRow(STATE, `${pid}::${m.id}`);
    await delRow(STATE, `${pid}::settings`);
    return { ok: true };
  }

  async function addModule(pid, type) {
    const row = await getRow(PROFILES, pid);
    if (!row) throw new Error(`no such profile: ${pid}`);
    const mods = row.v.modules || (row.v.modules = []);
    const m = { id: newId(), type, position: mods.length };
    mods.push(m);
    await putRow(PROFILES, row);
    return m;
  }

  async function removeModule(pid, mid) {
    const row = await getRow(PROFILES, pid);
    if (!row) throw new Error(`no such profile: ${pid}`);
    row.v.modules = (row.v.modules || []).filter((m) => m.id !== mid);
    row.v.modules.forEach((m, i) => { m.position = i; });
    await putRow(PROFILES, row);
    await delRow(STATE, `${pid}::${mid}`);      // its overwrite state goes; its events stay
    return { ok: true };
  }

  // Kept so the surface matches the server client exactly. There is no URL here — these are
  // storage keys — but nothing signed-out ever hands them to fetch().
  const stateURL = (pid, key) => `local:${pid}::${key}`;
  const eventsURL = (pid, stream) => `local:${pid}::${stream}`;

  return {
    people, addPerson, renamePerson, removePerson,
    list, get, create, rename, remove, moveToPerson, addModule, removeModule,
    stateURL, eventsURL,
  };
}

// ---------------------------------------------------------------- state
function createLocalState(pid, key) {
  const k = `${pid}::${key}`;
  let data = {};
  let version = 0;
  let loaded = false;
  let writing = Promise.resolve();
  const subs = new Set();

  const notify = () => {
    const snap = { ...data };
    for (const f of subs) { try { f(snap); } catch (e) { console.error(e); } }
  };

  async function load() {
    const row = await getRow(STATE, k);
    data = (row && row.v && row.v.data) || {};
    version = (row && row.v && row.v.version) || 0;
    loaded = true;
    notify();
    return { ...data };
  }

  function persist() {
    version += 1;
    const snapshot = { data: { ...data }, version };
    writing = writing.then(() => putRow(STATE, { k, v: snapshot })).catch((e) => console.error(e));
    return writing;
  }

  function set(patch) {
    data = { ...data, ...patch };
    notify();
    persist();
  }

  return {
    load,
    get: () => ({ ...data }),
    set,
    subscribe(fn) {
      subs.add(fn);
      if (loaded) { try { fn({ ...data }); } catch (e) { console.error(e); } }
      return () => subs.delete(fn);
    },
    flush: () => writing,        // already written; just let a caller await the tail
    startPolling() {},           // nothing else can change it
    destroy() { subs.clear(); },
    getVersion: () => version,
  };
}

// ---------------------------------------------------------------- events
function createLocalEvents(pid, stream) {
  const k = `${pid}::${stream}`;
  let cache = { events: [], total: 0 };
  let loaded = false;
  let writing = Promise.resolve();
  const subs = new Set();

  const notify = () => { for (const f of subs) { try { f(cache); } catch (e) { console.error(e); } } };

  async function load() {
    const row = await getRow(EVENTS, k);
    const events = (row && row.v && row.v.events) || [];
    cache = { events, total: events.length };
    loaded = true;
    notify();
    return cache;
  }

  // Append-only, like the server — there is no update and no delete, deliberately.
  async function append(kind, data = {}) {
    const e = { id: cache.events.length + 1, kind, data, created_at: nowISO() };
    cache = { events: [...cache.events, e], total: cache.total + 1 };
    const snapshot = { events: cache.events };
    writing = writing.then(() => putRow(EVENTS, { k, v: snapshot })).catch((err) => console.error(err));
    await writing;
    notify();
    return e;
  }

  return {
    load,
    append,
    get: () => cache,
    subscribe(fn) {
      subs.add(fn);
      if (loaded) { try { fn(cache); } catch (e) { console.error(e); } }
      return () => subs.delete(fn);
    },
    startPolling() {},
    destroy() { subs.clear(); },
  };
}

// ---------------------------------------------------------------- the backend
// One object shaped like what home.html builds for a signed-in user, so the page picks a
// backend once and everything below it is identical either way.
export function createLocalBackend() {
  const profiles = createLocalProfilesClient();
  const keyPid = (key) => String(key).split(':')[1] || '';
  return {
    local: true,
    profiles,
    makeSettings: (pid) => createLocalState(pid, 'settings'),
    makeState: (key, _opts, forPid) => createLocalState(forPid || keyPid(key), key),
    // Per-PERSON, signed out. The scope string matches db.person_scope on the server so
    // the two halves address a person's bindings identically and cannot drift.
    makePersonState: (personId, key) => createLocalState(personScope(personId), key),
    makePersonEvents: (personId, stream) => createLocalEvents(personScope(personId), stream),
    makeEvents: (key, _opts, forPid) => createLocalEvents(forPid || keyPid(key), key),
  };
}

export async function hasLocalData() {
  try { return (await allRows(PROFILES)).length > 0; }
  catch { return false; }
}

// Media, signed out. The bundled samples are served through the ordinary media-agent
// listing contract (`demo-media/list`), so photos.js goes down the SAME resolver it uses for
// real media — no special case to drift.
//
// It returns the samples ONLY until the visitor connects a folder of their own, then only
// their folders. That is deliberate: photos.js auto-selects when there is exactly one source,
// so keeping the count at one means someone who picks their own photos immediately SEES their
// own photos, instead of having to find a source picker that does not exist yet.
export function createLocalMediaSources({ baseUrl = null } = {}) {
  const samples = () => ({
    id: 'demo-samples',
    label: 'Sample photos',
    kind: 'agent',
    base_url: baseUrl || new URL('demo-media', location.href).href.replace(/\/+$/, ''),
  });
  return {
    async list() {
      const own = await listFolderSources();
      return own.length ? own : [samples()];
    },
    async add() { throw new Error('sign in to save a media source to your account'); },
    async remove(id) { return removeFolderSource(id); },
  };
}

// Time-of-day playlists for the starter screen. `start` is the hour a daypart begins; it
// runs until the next one, and the last wraps past midnight.
export const STARTER_SCHEDULE = [
  { name: 'Morning',    start: 7,  playlistId: 'PLHUSsSIwni6Y' },
  { name: 'Daytime',    start: 11, playlistId: 'PLR0lG5yo6NRE' },
  { name: 'Primetime',  start: 18, playlistId: 'PLapSyaBgXvpk' },
  { name: 'Sleepytime', start: 23, playlistId: 'PLEWwXAKdpWIw' },
];

// The four-up starter screen, clockwise from the top left: photos, the word game, the clock,
// and YouTube. A first visit should not land on an empty page — someone deciding whether this is worth
// their time needs to see a screen, not a form. One starter screen, with the two modules
// that show what this is for.
export async function seedStarterScreen(profilesClient = createLocalProfilesClient(),
                                       makeSettings = (pid) => createLocalState(pid, 'settings'),
                                       makeState = (pid, key) => createLocalState(pid, key)) {
  if (await hasLocalData()) return null;
  const p = await profilesClient.create('My screen');

  // 'quad' is a plain 2x2 filled in DOM order, so its slots are TL, TR, BL, BR. Clockwise
  // from the top left is therefore slots 0, 1, 3, 2 — not 0,1,2,3.
  //
  // *** THE ORDER IS THE ONE THE LANDING PAGE'S POSTER PROMISES. *** Decided 2026-08-27:
  // clockwise from the top left, pictures · live view · clock · word game. The poster on the
  // landing page draws that arrangement, and one tap loads THIS screen inside it — so if the
  // two disagree, the page has lied to somebody in the first five seconds of meeting it.
  // Change one and change the other.
  // From `modules_catalog.js`, so the landing page's "default dashboard" and this cannot drift.
  // They already had: the page advertised camera as a default long after it stopped being one.
  const [pPhotos, pTube, pWord, pClock] = STARTER_MODULES;
  const photos = await profilesClient.addModule(p.id, pPhotos);
  const tube = await profilesClient.addModule(p.id, pTube);
  const word = await profilesClient.addModule(p.id, pWord);
  const clock = await profilesClient.addModule(p.id, pClock);

  const settings = makeSettings(p.id);
  await settings.load();
  settings.set({
    // [TL, TR, BL, BR] — pictures, live view, word game, clock. Clockwise that reads
    // pictures → live view → clock → word game, which is the decided order.
    kiosk: { layout: { preset: 'quad', slots: [photos.id, tube.id, word.id, clock.id] } },
  });
  await settings.flush();
  settings.destroy();

  // Give YouTube something to play. These are curated, general-audience playlists — calm
  // in the evening, livelier in the day — so a visitor sees the time-of-day scheduler
  // actually doing something rather than an empty panel telling them to add videos.
  const tubeState = makeState(p.id, tube.id);
  await tubeState.load();
  tubeState.set({ schedule: STARTER_SCHEDULE });
  await tubeState.flush();
  tubeState.destroy();

  return p;
}

// Used by the "keep this" path later (slice 3) and by the tests, which must not leak state
// from one case into the next.
export async function clearLocalData() {
  for (const s of [PROFILES, STATE, EVENTS]) {
    await tx(s, 'readwrite', (store) => { store.clear(); });
  }
}
