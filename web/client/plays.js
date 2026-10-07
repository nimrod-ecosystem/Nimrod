// plays.js — WHAT WAS PLAYED, by any player, in one shape, KEPT ON THE DEVICE THAT PLAYED IT. Rows 2.62 and 2.58.
//
// Mike, 2026-10-07 (row 2.62): *"It would be nice for people to be able to visualize Spotify/Youtube plays ... posters
// on the wall with your top played albums/artists of the week."* That made this file: one shape every player writes,
// and the table it answers with.
//
// *** WHERE IT LIVES: THIS DEVICE, NOT THE SERVER (row 2.58). *** Mike, the same day: *"This is the kind of data
// people should keep on their own system though."* Which photo, video or song played when is a person's own record,
// so it is kept in this browser's own storage (IndexedDB, database `nimrod-plays`) and the server refuses it
// (storage_line.py, kind `play` and stream `plays`). The weighted picker (rng.js) reads it exactly as it read the
// panel's server rows before: the same `{ id: { n, last } }` stats, from the same plays.
//
// ONE LOG FOR THE WHOLE DEVICE, FILED BY PANEL. Argued (row 2.58's "per screen setup, or per person on this device"):
//   * FOR one log per person on the device: a family browser that shows two people's screens keeps them apart, and a
//     "your top songs" poster is about a person.
//   * AGAINST, and it wins for now: the picker reads ONE PANEL's plays (as it always has), and a panel belongs to one
//     screen, which belongs to one person - so filing by panel already keeps two people's pickers apart. Every row
//     also carries its `screen`, so a per-person table later is a filter, not a move. And a browser is not a lock
//     between two people who share it: a split by person here would look like privacy without being any.
//   What a person loses by moving the record here, and why the helper file is not built yet: row 2.58's report.
//
// ROW SHAPE (the same event-like shape the server rows had, so playsOf/tally/statsFromPlays are unchanged):
//   { kind: 'play', created_at: <ISO, this device's clock>, data: { source, id, panel?, screen?, title?, by? } }
//     source   which player: 'youtube', 'spotify', 'photos', 'folder', ... (any id-shaped word; not a closed list)
//     id       what played, in that source's own terms: a YouTube video id, a Spotify URI, a file's path
//     panel    the module instance that played it - the picker reads only its own panel's plays
//     screen   the screen (profile) the panel is on, so a per-screen or per-person table needs no second record
//     title    the item's name, and `by` its artist or channel - ONLY for a source in `keepText` (below)
//   `created_at` is this device's clock: there is no server to stamp it any more. A clock set wrong makes "this week"
//   wrong on this device only, and the picker's recency uses the same clock it is compared against.
//
// *** WHICH SOURCES KEEP A TITLE: A DEFAULT, ARGUED FROM THE TWO SERVICES' OWN TERMS (row 2.62). *** These hold on a
// device as much as on a server - an app keeping text is the app keeping it, wherever the file sits.
//   * Spotify: its Developer Terms let an app cache metadata and cover art, not keep them (section IV.3), and its
//     Developer Policy says not to analyze Spotify Content to create "derived listenership metrics" (III.13). So a
//     Spotify play keeps its URI and nothing Spotify supplied; a "top artists" poster for Spotify should show
//     Spotify's own top-items answer, not one counted here.
//   * YouTube: its Developer Policies let an app keep API Data at most 30 days (III.E.4.c/d). So a YouTube play
//     keeps its video id; the title is looked up when it is drawn.
//   * A folder's file tags are the person's own, so a folder play keeps its title and artist.
//   `keepText` is overridable per handle (Rule 1) for a source added later.
//
// THE ONE-TIME MOVE (row 2.58): each panel, the first time it mounts on a device after this change, reads its old
// server `play` rows once (from the panel's own events handle, which the screen loads anyway) and files them here,
// then never reads the server for plays again. Marked per panel AND source, so a panel switched to another kind
// still brings that kind's rows down. The rows on the server are removed separately, by Mike, with
// web/server/remove_play_history.py.
//
// KNOWN BOUNDS: `keep` plays per panel (newest kept). The picker used to see the newest 50 events of its panel (the
// server's default read), so 500 is ten times its old memory. Two tabs on one device each keep their own copy in
// memory and both write the store; each picks up the other's plays on its next write or load.

import { statsFromEvents } from './rng.js';

export const PLAYS_STREAM = 'plays';          // the stream name the server now refuses (it was never written to)
export const PLAYS_TOPIC = 'plays/logged';    // bus topic - a live nudge, NOT the record
export const PLAY_KIND = 'play';
export const PLAYS_DB = 'nimrod-plays';       // this browser's IndexedDB database

// EVERY NUMBER HERE IS A DEFAULT (Rule 1), overridable per handle.
//   keepText  sources whose title/artist may be kept in the record (argued above)
//   textMax   longest title / artist kept: a song or video name, not a description
//   idMax     longest id kept: a file path can be long; a URI or video id is under 60
//   keep      plays kept per panel on this device (newest first): ten times what the picker read from the server
export const PLAYS_DEFAULTS = Object.freeze({
  keepText: Object.freeze(['folder']),
  textMax: 200,
  idMax: 500,
  keep: 500,
});

const WORD_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const text = (v, max) => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
};
const shortId = (v) => { const s = String(v || '').trim(); return s && s.length <= 64 ? s : ''; };

/**
 * One play, as it is kept: `{ source, id, panel?, screen?, title?, by? }`, or null when it has no source or no id.
 * `keepText` decides whether title/by survive (see the header).
 */
export function normalizePlay(raw, { keepText = PLAYS_DEFAULTS.keepText, textMax = PLAYS_DEFAULTS.textMax,
                                     idMax = PLAYS_DEFAULTS.idMax } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const source = String(raw.source || '').trim().toLowerCase();
  if (!WORD_RE.test(source)) return null;
  const id = text(raw.id, idMax);
  if (!id) return null;
  const out = { source, id };
  const panel = shortId(raw.panel);
  if (panel) out.panel = panel;
  const screen = shortId(raw.screen);
  if (screen) out.screen = screen;
  if ((keepText || []).includes(source)) {
    const title = text(raw.title, textMax);
    const by = text(raw.by, textMax);
    if (title) out.title = title;
    if (by) out.by = by;
  }
  return out;
}

const timeOf = (e) => { const t = Date.parse(e?.created_at); return Number.isFinite(t) ? t : 0; };

/**
 * The play rows in a list, oldest first, filtered. `since` / `until` are ms (until exclusive), read against
 * `created_at`.
 */
export function playsOf(events, { source = null, panel = null, screen = null, since = null, until = null } = {}) {
  return (events || []).filter((e) => {
    if (!e || e.kind !== PLAY_KIND || !e.data || !e.data.source || !e.data.id) return false;
    if (source && e.data.source !== source) return false;
    if (panel && e.data.panel !== panel) return false;
    if (screen && e.data.screen !== screen) return false;
    const t = timeOf(e);
    if (since != null && t < since) return false;
    if (until != null && t >= until) return false;
    return true;
  });
}

export const TALLY_BY = Object.freeze(['id', 'by', 'title', 'source']);

/**
 * *** THE TABLE: a ranked list of rows, not one number. *** Plays grouped `by` one field, counted, most first.
 *   rows: [{ key, label, value, last, source }]   value = plays; last = ms of the latest; source = the source of
 *         the group's latest play (an `id` group is one source; a `by` group may span two).
 * Ties: the more recently played first, then by key, so the list does not jitter between reads. A row with no
 * value for the field (a `by` grouping over plays that kept no artist) is left out rather than invented.
 * `top` keeps the first N (0 or absent = all).
 */
export function tally(events, { by = 'id', top = 0, ...filter } = {}) {
  const field = TALLY_BY.includes(by) ? by : 'id';
  const groups = new Map();
  for (const e of playsOf(events, filter)) {
    const key = e.data[field];
    if (!key) continue;
    const t = timeOf(e);
    const g = groups.get(key) || { key, label: '', value: 0, last: -1, source: e.data.source };
    g.value += 1;
    if (t >= g.last) { g.last = t; g.source = e.data.source; if (e.data.title) g.label = e.data.title; }
    else if (!g.label && e.data.title) g.label = e.data.title;
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({ ...g, label: field === 'id' ? (g.label || g.key) : g.key }));
  rows.sort((a, b) => (b.value - a.value) || (b.last - a.last) || String(a.key).localeCompare(String(b.key)));
  const n = Math.max(0, Number(top) | 0);
  return n ? rows.slice(0, n) : rows;
}

/**
 * THE SAME TABLE AS WORDS - what a chart says to a screen reader, and what a voice answer reads out
 * ("Computer please, what did I play most this week?"). Plain sentences, numbered.
 */
export function tableReading(rows, { one = 'play', many = 'plays', empty = 'Nothing played yet.' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return empty;
  return list.map((r, i) => `${i + 1}. ${r.label || r.key}: ${r.value} ${r.value === 1 ? one : many}.`).join(' ');
}

/** The weighted picker's stats (rng.js `{ id: { n, last } }`) from these rows, for one source (and panel). */
export function statsFromPlays(events, { source = null, panel = null } = {}) {
  const rows = playsOf(events, { source, panel }).map((e) => ({ id: e.data.id, at: timeOf(e) }));
  return statsFromEvents(rows, { idKey: 'id', atKey: 'at' });
}

/**
 * One OLD server row (`play {id, at}` on a panel's own events) as a row here, or null. The time is the row's own
 * `at` (when the panel played it), else the server's `created_at`.
 */
export function rowFromServer(e, { source, panel = '', screen = null } = {}) {
  if (!e || e.kind !== PLAY_KIND || !e.data || typeof e.data !== 'object') return null;
  const data = normalizePlay({ source, id: e.data.id, panel, screen }, { keepText: [] });
  if (!data) return null;
  const at = Number(e.data.at);
  const t = Number.isFinite(at) && at > 0 ? at : timeOf(e);
  if (!t) return null;
  return { kind: PLAY_KIND, created_at: new Date(t).toISOString(), data };
}

// ---------- the store: where the rows sit ----------
// Two stores with one surface, so the handle and the suites run the same code:
//   get(panel)          -> the panel's record { k, rows, moved } or null
//   update(panel, fn)   -> applies fn(record) and saves, as ONE step (one IndexedDB transaction), resolving the
//                          saved record. fn is synchronous: a transaction ends at the first outside await.
//   all()               -> every panel's record (for a table over the whole device)
const emptyRecord = (panel) => ({ k: panel, rows: [], moved: {} });
const asRecord = (panel, r) => (r && Array.isArray(r.rows)
  ? { k: panel, rows: r.rows, moved: (r.moved && typeof r.moved === 'object') ? r.moved : {} }
  : emptyRecord(panel));

/** Memory only: the suites, a page with no IndexedDB, and a panel with no identity to file plays under. */
export function memoryPlayStore() {
  const rows = new Map();
  const copy = (r) => JSON.parse(JSON.stringify(r));
  return {
    kind: 'memory',
    async get(panel) { return rows.has(panel) ? copy(rows.get(panel)) : null; },
    async update(panel, fn) {
      const next = asRecord(panel, fn(asRecord(panel, rows.has(panel) ? copy(rows.get(panel)) : null)));
      rows.set(panel, copy(next));
      return copy(next);
    },
    async all() { return [...rows.values()].map(copy); },
  };
}

/** This browser's IndexedDB (`nimrod-plays`, one store `panels`, one record per panel). */
export function idbPlayStore({ name = PLAYS_DB, idb = (typeof indexedDB !== 'undefined' ? indexedDB : null) } = {}) {
  const STORE = 'panels';
  let opening = null;
  const open = () => {
    if (!idb) return Promise.reject(new Error('no IndexedDB here'));
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const req = idb.open(name, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'k' });
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab upgrading the database (a later version of this file): let it, and open again next time.
          db.onversionchange = () => { try { db.close(); } catch { /* gone */ } opening = null; };
          resolve(db);
        };
        req.onerror = () => { opening = null; reject(req.error); };
        req.onblocked = () => { /* waits for the other tab; onsuccess follows */ };
      });
    }
    return opening;
  };
  const run = async (mode, body) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      let out;
      body(t.objectStore(STORE), (v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    kind: 'indexeddb',
    get: (panel) => run('readonly', (s, done) => {
      const r = s.get(panel);
      r.onsuccess = () => done(r.result ? asRecord(panel, r.result) : null);
    }),
    update: (panel, fn) => run('readwrite', (s, done) => {
      const r = s.get(panel);
      r.onsuccess = () => {
        const next = asRecord(panel, fn(asRecord(panel, r.result || null)));
        s.put(next);
        done(next);
      };
    }),
    all: () => run('readonly', (s, done) => {
      const r = s.getAll();
      r.onsuccess = () => done((r.result || []).map((x) => asRecord(x.k, x)));
    }),
  };
}

// ---------- the handle ----------

const byTime = (a, b) => timeOf(a) - timeOf(b);

/**
 * A handle over this device's plays. `store` is where the rows sit (idbPlayStore / memoryPlayStore).
 *   log({ source, id, panel?, screen?, title?, by? })  file one play: in memory now (so the picker sees it at once),
 *                     then in the store; then the nudge on `bus`. Resolves the kept data, or null when it was not a
 *                     play. A store that cannot be written (private browsing) still leaves the play counted for
 *                     this session.
 *   load(panel)       read one panel's record into memory; loadAll() reads every panel's
 *   plays(filter) / tally(opts) / stats(opts)   answers from what is in memory
 *   moveFromServer({ events, source, panel, screen })   the one-time move (header); { done, stop }
 *   subscribe(fn(panel))   told when a panel's rows change (panel null: many changed)
 */
export function createPlays({ store = memoryPlayStore(), bus = null, keepText = PLAYS_DEFAULTS.keepText,
                              keep = PLAYS_DEFAULTS.keep, now = () => Date.now() } = {}) {
  const records = new Map();         // panel -> record, as last read or written
  const loads = new Map();           // panel -> the load in flight / done
  const subs = new Set();
  const cap = Math.max(1, Number(keep) | 0);
  const trim = (rows) => (rows.length > cap ? rows.slice(rows.length - cap) : rows);
  const notify = (panel) => { for (const f of [...subs]) { try { f(panel); } catch (e) { console.error('plays: subscriber', e); } } };
  const remember = (panel, rec) => { records.set(panel, asRecord(panel, rec)); notify(panel); };
  const all = () => [...records.values()].flatMap((r) => r.rows);

  function load(panel = '') {
    const key = String(panel || '');
    if (!loads.has(key)) {
      loads.set(key, store.get(key)
        .then((rec) => { if (rec) remember(key, rec); else if (!records.has(key)) remember(key, emptyRecord(key)); })
        .catch((e) => { loads.delete(key); console.error('plays: load', e); }));
    }
    return loads.get(key);
  }

  async function loadAll() {
    try { for (const rec of await store.all()) remember(rec.k, rec); }
    catch (e) { console.error('plays: load all', e); }
  }

  async function log(raw) {
    const data = normalizePlay(raw, { keepText });
    if (!data) return null;
    const key = data.panel || '';
    const row = { kind: PLAY_KIND, created_at: new Date(now()).toISOString(), data };
    const cur = records.get(key) || emptyRecord(key);
    remember(key, { ...cur, rows: trim([...cur.rows, row]) });               // 1. counted now
    try {                                                                    // 2. the record on this device
      const saved = await store.update(key, (r) => ({ ...r, rows: trim([...r.rows, row]) }));
      remember(key, saved);
    } catch (e) { console.error('plays: save', e); }
    if (bus) { try { bus.publish(PLAYS_TOPIC, data); } catch { /* the record stands */ } }   // 3. the nudge
    return data;
  }

  function moveFromServer({ events = null, source, panel = '', screen = null } = {}) {
    const key = String(panel || '');
    const src = String(source || '');
    let stopped = false;
    let off = null;
    let settle;
    const done = new Promise((r) => { settle = r; });
    const stop = () => { stopped = true; try { typeof off === 'function' && off(); } catch { /* gone */ } off = null; };
    if (!events || typeof events.subscribe !== 'function' || !src) { settle(0); return { done, stop }; }
    const take = async (cache) => {
      if (stopped) return;
      stop();
      const old = (cache?.events || []).map((e) => rowFromServer(e, { source: src, panel: key, screen }))
        .filter(Boolean);
      let n = 0;
      try {
        const saved = await store.update(key, (r) => {
          if (r.moved[src]) return r;
          n = old.length;
          return { ...r, moved: { ...r.moved, [src]: true }, rows: trim([...old, ...r.rows].sort(byTime)) };
        });
        remember(key, saved);
      } catch (e) { n = 0; console.error('plays: move', e); }
      settle(n);
    };
    store.get(key).then((rec) => {
      if (stopped) { settle(0); return; }
      if (rec && rec.moved && rec.moved[src]) { stopped = true; settle(0); return; }
      // The panel's events handle calls back once it holds the server's answer (at once when it already does);
      // never on a failed read, so a screen that was offline moves its rows the next time instead.
      off = events.subscribe((cache) => { take(cache); }) || null;
      if (stopped) stop();
    }).catch((e) => { console.error('plays: move', e); settle(0); });
    return { done, stop };
  }

  return {
    log,
    load,
    loadAll,
    moveFromServer,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    get: () => ({ events: all() }),
    plays: (filter) => playsOf(all(), filter),
    tally: (opts) => tally(all(), opts),
    stats: (opts) => statsFromPlays(all(), opts),
    store,
    destroy: () => { subs.clear(); },
  };
}

// ---------- this device's one handle ----------
let device = null;
/** The device's plays: one handle per page, over IndexedDB (memory where the browser has none). */
export function devicePlays() {
  if (!device) {
    const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
    device = createPlays({ store: idb ? idbPlayStore({ idb }) : memoryPlayStore() });
  }
  return device;
}

/**
 * ONE PANEL'S PLAYS, for a player module: what it calls instead of appending `play` to its events.
 *   played(id)        file a play of `id` from this panel
 *   stats()           the picker's stats for this panel and source
 *   subscribe(fn)     fn(stats) now, when the panel's rows load, and after every play
 *   rows()            this panel's plays (the suites read them)
 *   moved             resolves how many old server rows were brought down (0 when already done or none)
 * Which handle: `ctx.plays` when the host gives one (the suites give a memory one); else this device's own when the
 * panel has an identity (`ctx.playsPanel`, else `ctx.instanceId`); else memory, since a panel with no identity has
 * nothing to file its plays under from one visit to the next.
 */
export function panelPlays(ctx = {}, source) {
  const panel = String(ctx.playsPanel || ctx.instanceId || '');
  const log = ctx.plays || (panel ? devicePlays() : createPlays({ store: memoryPlayStore() }));
  const screen = ctx.profileId ? String(ctx.profileId) : null;
  const filter = { source, panel: panel || null };
  const stats = () => log.stats(filter);
  const subs = new Set();
  const off = log.subscribe((p) => {
    if (p != null && p !== panel) return;
    const s = stats();
    for (const f of [...subs]) { try { f(s); } catch (e) { console.error('plays: panel subscriber', e); } }
  });
  const ready = log.load(panel);
  const move = log.moveFromServer({ events: ctx.events || null, source, panel, screen });
  return {
    panel,
    source,
    played: (id) => log.log({ source, id, panel, screen }).catch((e) => { console.error(`${source}: play log`, e); return null; }),
    stats,
    rows: () => log.plays(filter),
    subscribe(fn) { subs.add(fn); try { fn(stats()); } catch (e) { console.error(e); } return () => subs.delete(fn); },
    ready,
    moved: move.done,
    destroy() { try { off(); } catch { /* gone */ } move.stop(); subs.clear(); },
  };
}
