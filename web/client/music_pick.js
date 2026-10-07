// music_pick.js — WHAT PLAYS NEXT, CHOSEN BY THE SITE'S OWN WEIGHTED PICKER (rng.js). Row 2.55.
//
// Mike, 2026-10-07: *"Are we using our randomizer for a Spotify option? I like ours better for it's weights."*
// Until this file, only the YouTube panel used rng.js; Spotify played in Spotify's own order. This is the
// YouTube panel's way of choosing, lifted out so a second source can use it unchanged:
//   * the same `pick()` with the same weights (rng.js DEFAULTS): freshness (played less, more likely),
//     recency (played lately, less likely), duration (shorter, a little more often) and diversity (the same
//     artist as the one just played is down-weighted, as YouTube does for the same channel);
//   * the same history: append-only `play` events `{ id, at }` on the panel, and the counts DERIVED from them
//     (`statsFromEvents`), never a separate store of record;
//   * the same short in-memory "just played" list (RECENT_CAP, youtube.js's twelve).
// It is the piece a universal player (row H1) would share across every source; today Spotify uses it and
// youtube.js still has its own copy of these few lines (listed for Mike rather than moved under a parallel edit).
//
// PURE apart from the `events` handle it is given; `now` and `rand` are injectable for the suites.

import { pick, statsFromEvents, record } from './rng.js';

// youtube.js's RECENT_CAP, the same number for the same reason: the in-memory "just played" window; the
// picker's own hard exclusion (rng.js excludeLast / excludeFrac) works inside it.
export const RECENT_CAP = 12;

/** The play history in an events cache, as the picker's stats. youtube.js's `deriveStats`, the same rows. */
export function statsFromCache(cache) {
  const plays = (cache?.events || [])
    .filter((e) => e && e.kind === 'play')
    .map((e) => ({ id: e.data?.id, at: e.data?.at || Date.parse(e.created_at) || 0 }));
  return statsFromEvents(plays, { idKey: 'id', atKey: 'at' });
}

/**
 * A picker over a pool of `{ id, channel?, durationSec? }`. Returns
 *   next(pool)    the id to play next (null for an empty pool)
 *   played(id, channel?)  count it: in memory now, and as a `play` event for next time
 *   state()       { stats, recent } for the suites
 *   destroy()
 * `events` is the panel's events handle (`append(kind, data)`, `subscribe(fn(cache))`), or null to keep the
 * history in memory only.
 */
export function createMusicPicker({ events = null, now = () => Date.now(), rand = Math.random } = {}) {
  let stats = {};
  let recent = [];
  let off = null;
  // Every song's artist this picker has been shown, so the diversity factor still knows the artist of the song
  // just played when the caller leaves that song out of the next pool (music_spotify.js does, so the song
  // playing is never queued after itself).
  const channelOf = new Map();
  try {
    off = events?.subscribe?.((cache) => { stats = statsFromCache(cache); }) || null;
  } catch { off = null; }

  return {
    next(pool) {
      const list = (Array.isArray(pool) ? pool : []).filter((t) => t && t.id);
      if (!list.length) return null;
      const ids = list.map((t) => t.id);
      const durations = {};
      for (const t of list) {
        if (t.channel) channelOf.set(t.id, t.channel);
        if (t.durationSec > 0) durations[t.id] = t.durationSec;
      }
      const channels = Object.fromEntries(channelOf);
      return pick(ids, stats, { now: now(), rand, recent, channels, durations });
    },
    played(id, channel = null) {
      if (!id) return;
      if (channel) channelOf.set(id, channel);
      const at = now();
      stats = record(stats, id, at);
      recent.push(id);
      if (recent.length > RECENT_CAP) recent.shift();
      try {
        const p = events?.append?.('play', { id, at });
        if (p && typeof p.catch === 'function') p.catch(() => { /* the in-memory count still stands */ });
      } catch { /* the in-memory count still stands */ }
    },
    state: () => ({ stats: { ...stats }, recent: recent.slice() }),
    destroy() { try { typeof off === 'function' && off(); } catch { /* gone */ } off = null; },
  };
}
