// plays.js — ONE SHARED `plays` STREAM: what was played, by any player, in one shape. Row 2.62.
//
// Mike, 2026-10-07: *"It would be nice for people to be able to visualize Spotify/Youtube plays ... posters on the
// wall with your top played albums/artists of the week."* Chat's suggested first step (note BE): one shared stream
// every player writes to, the way `gameplay` (telemetry.js) serves the games. This file is that stream and the
// table it answers with. NOTHING WRITES TO IT YET: wiring YouTube, Spotify and the folder players is the next step,
// done in their own files (each one call beside the `play` event it already writes).
//
// THE SAME SUBSTRATE AS telemetry.js AND points.js: a profile-scoped append-only stream reached with
// ctx.makeEvents('plays') (no server change: the stream key is just a string), "only the source appends", and a
// live bus nudge (`plays/logged`) that is NOT the record. The server stamps `id` and `created_at`; time windows
// ("this week") are read from `created_at`, never from a client clock.
//
// EVENT SHAPE — kind `play`, data:
//   { source, id, panel?, title?, by? }
//     source   which player: 'youtube', 'spotify', 'folder', ... (any id-shaped word; not a closed list, so a new
//              player needs no change here)
//     id       what played, in that source's own terms: a YouTube video id, a Spotify URI, a file's path
//     panel    the module instance that played it (optional) - lets one panel's picker read only its own plays
//     title    the item's name, and `by` its artist or channel - ONLY for a source in `keepText` (below)
//   About 60-130 bytes a row: inside the storage line (storage_line.py: 16 KiB an event, no media) by two
//   orders of magnitude, and the same size as the `play {id, at}` rows youtube.js and music_pick.js keep now.
//
// *** WHICH SOURCES KEEP A TITLE: A DEFAULT, ARGUED FROM THE TWO SERVICES' OWN TERMS (row 2.62). ***
//   * Spotify: its Developer Terms let an app cache metadata and cover art, not keep them (section IV.3), and its
//     Developer Policy says not to analyze Spotify Content to create "derived listenership metrics" (III.13). So a
//     Spotify play keeps its URI and nothing Spotify supplied; a "top artists" poster for Spotify should show
//     Spotify's own top-items answer, not one counted here.
//   * YouTube: its Developer Policies let an app keep API Data at most 30 days (III.E.4.c/d). So a YouTube play
//     keeps its video id; the title is looked up when it is drawn.
//   * A folder's file tags are the person's own, so a folder play keeps its title and artist.
//   `keepText` is overridable per handle (Rule 1) for a source added later; the reasons above are why the two
//   services are off by default. The exact clauses and links are in row 2.62's report.
//
// HOW THIS RELATES TO THE PICKERS' OWN HISTORY: youtube.js and music_pick.js each append `play {id, at}` to the
// PANEL's own events, which is what their weighted pick reads. This stream does not replace that yet.
// `statsFromPlays` gives the picker's stats from this stream (filtered by source, and by panel if asked), so a
// picker can move over later without a second history - and DECISIONS ("play stats are per-video, GLOBAL across
// playlists") is then true across panels too, which per-panel events are not today.
//
// KNOWN BOUND: a handle reads the newest `limit` rows, and the server caps a read at 500 (app.py list_events).
// "Plays this week" is honest only while a week is under 500 plays; past that the answer is a server-side query
// over created_at, the same bound telemetry.js and points.js carry.

import { statsFromEvents } from './rng.js';

export const PLAYS_STREAM = 'plays';          // well-known shared stream key
export const PLAYS_TOPIC = 'plays/logged';    // bus topic - a live nudge, NOT the record
export const PLAY_KIND = 'play';

// EVERY NUMBER HERE IS A DEFAULT (Rule 1), overridable per handle.
//   keepText  sources whose title/artist may be kept in the record (argued above)
//   textMax   longest title / artist kept: a song or video name, not a description
//   idMax     longest id kept: a file path can be long; a URI or video id is under 60
//   limit     rows a handle reads: the server's own cap on one read
export const PLAYS_DEFAULTS = Object.freeze({
  keepText: Object.freeze(['folder']),
  textMax: 200,
  idMax: 500,
  limit: 500,
  pollMs: 4000,
});

const WORD_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const text = (v, max) => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) : s;
};

/**
 * One play, as it is kept: `{ source, id, panel?, title?, by? }`, or null when it has no source or no id.
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
  const panel = String(raw.panel || '').trim();
  if (panel && panel.length <= 64) out.panel = panel;
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
 * The play rows in an events list, oldest first, filtered. `since` / `until` are ms (until exclusive), read
 * against the server's `created_at`.
 */
export function playsOf(events, { source = null, panel = null, since = null, until = null } = {}) {
  return (events || []).filter((e) => {
    if (!e || e.kind !== PLAY_KIND || !e.data || !e.data.source || !e.data.id) return false;
    if (source && e.data.source !== source) return false;
    if (panel && e.data.panel !== panel) return false;
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

/** The weighted picker's stats (rng.js `{ id: { n, last } }`) from this stream, for one source (and panel). */
export function statsFromPlays(events, { source = null, panel = null } = {}) {
  const rows = playsOf(events, { source, panel }).map((e) => ({ id: e.data.id, at: timeOf(e) }));
  return statsFromEvents(rows, { idKey: 'id', atKey: 'at' });
}

// ---------- the handle ----------

/**
 * A handle over the shared `plays` stream. `makeEvents` is ctx.makeEvents - a module never builds a storage URL.
 * `log({ source, id, panel?, title?, by? })` writes the record first, then the nudge; it resolves the kept row,
 * or null when the play was not one (no source or id). The caller owns the lifecycle: destroy() on destroy.
 */
export function createPlays({ makeEvents, bus = null, limit = PLAYS_DEFAULTS.limit, pollMs = PLAYS_DEFAULTS.pollMs,
                              keepText = PLAYS_DEFAULTS.keepText } = {}) {
  if (typeof makeEvents !== 'function') throw new Error('createPlays: ctx.makeEvents is required');
  const stream = makeEvents(PLAYS_STREAM, { limit, pollMs });
  const all = () => stream.get()?.events || [];

  async function log(raw) {
    const data = normalizePlay(raw, { keepText });
    if (!data) return null;
    await stream.append(PLAY_KIND, data);             // 1. the record (durable, first)
    if (bus) { try { bus.publish(PLAYS_TOPIC, data); } catch { /* the record stands */ } }   // 2. the nudge
    return data;
  }

  return {
    log,
    load: () => stream.load(),
    startPolling: () => stream.startPolling?.(),
    subscribe: (fn) => stream.subscribe(fn),
    get: () => stream.get(),
    plays: (filter) => playsOf(all(), filter),
    tally: (opts) => tally(all(), opts),
    stats: (opts) => statsFromPlays(all(), opts),
    destroy: () => stream.destroy?.(),
  };
}
