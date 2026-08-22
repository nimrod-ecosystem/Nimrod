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

const DB_NAME = 'nimrod-local';
const DB_VERSION = 1;
const PROFILES = 'profiles';
const STATE = 'state';
const EVENTS = 'events';

const nowISO = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `x${Date.now()}${Math.floor(Math.random() * 1e6)}`)
  .replace(/-/g, '');

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of [PROFILES, STATE, EVENTS]) {
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
  const strip = (p) => ({ id: p.id, name: p.name, created_at: p.created_at });

  async function list() {
    const rows = await allRows(PROFILES);
    return rows
      .map((r) => r.v)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(strip);
  }

  async function get(pid) {
    const row = await getRow(PROFILES, pid);
    if (!row) throw new Error(`no such profile: ${pid}`);
    return { ...strip(row.v), modules: [...(row.v.modules || [])] };
  }

  async function create(name) {
    const p = { id: newId(), name, created_at: nowISO(), modules: [] };
    await putRow(PROFILES, { k: p.id, v: p });
    return strip(p);
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

  return { list, get, create, rename, remove, addModule, removeModule, stateURL, eventsURL };
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

// The four-up starter screen, clockwise from the top left: photos, the word game, the clock,
// and YouTube. A first visit should not land on an empty page — someone deciding whether this is worth
// their time needs to see a screen, not a form. One starter screen, with the two modules
// that show what this is for.
export async function seedStarterScreen(profilesClient = createLocalProfilesClient(),
                                       makeSettings = (pid) => createLocalState(pid, 'settings')) {
  if (await hasLocalData()) return null;
  const p = await profilesClient.create('My screen');

  // 'quad' is a plain 2x2 filled in DOM order, so its slots are TL, TR, BL, BR. Clockwise
  // from the top left is therefore slots 0, 1, 3, 2 — not 0,1,2,3.
  const photos = await profilesClient.addModule(p.id, 'photos');
  const word = await profilesClient.addModule(p.id, 'wordforge');
  const clock = await profilesClient.addModule(p.id, 'clock');
  const tube = await profilesClient.addModule(p.id, 'youtube');

  const settings = makeSettings(p.id);
  await settings.load();
  settings.set({
    kiosk: { layout: { preset: 'quad', slots: [photos.id, word.id, tube.id, clock.id] } },
  });
  await settings.flush();
  settings.destroy();
  return p;
}

// Used by the "keep this" path later (slice 3) and by the tests, which must not leak state
// from one case into the next.
export async function clearLocalData() {
  for (const s of [PROFILES, STATE, EVENTS]) {
    await tx(s, 'readwrite', (store) => { store.clear(); });
  }
}
