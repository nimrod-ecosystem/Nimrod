// rng.js — the shared weighted picker for photos AND youtube, plus the seedable
// PRNG and Fisher–Yates it rides on.
//
// WHY THIS EXISTS: plain random-with-replacement over a playlist clusters —
// favorites resurface constantly, newly-added items wait a full cycle, and you
// get runs of the same channel. This replaces that with a WEIGHTED draw whose
// weight is a product of tunable factors:
//
//   freshness  = 1 / (playCount + 1)^alpha
//       Long-run coverage. A never-played item (count 0) gets weight 1 (the max),
//       so items you just ADDED surface soon instead of after a whole cycle.
//       alpha < 1 keeps it gentle — a much-played item is less likely, never
//       impossible.
//
//   recency    = 1 - e^(-hoursSinceLastPlay / tau)     (never-played => 1)
//       The "don't repeat too soon" term, with a small floor so a tiny pool never
//       deadlocks. tau (hours) is the day/week pacing knob.
//
//   duration   = 1 / durSec^durationExp                (optional; needs durations)
//       Plays SHORTER items more OFTEN (not shorter — a picked item plays in full).
//       durationExp 0.5 => a 4×-longer video is picked half as often. Off (=1)
//       until durations are supplied.
//
//   diversity  = channelPenalty if this item's channel == the just-played channel
//       Kills runs of the same channel/source — including the burst you get right
//       after adding many items from one channel (they all have max freshness, so
//       without this they'd play back-to-back). Composes with freshness+recency:
//       once one plays, its whole channel is down-weighted for the next draw.
//
// PURE + SEED-INJECTABLE: no DOM, no storage, no wall clock. `now` and `rand` are
// passed in, so identical inputs give an identical draw. That makes it unit-
// testable against the REAL code and, later, seedable for cross-device "watch the
// same thing" sync. Persistence is NOT this module's job: play history lives in
// the platform's append-only events, and the {n,last} stats DERIVE from them via
// statsFromEvents() — there is no localStorage store of record here.

export const DEFAULTS = {
  alpha: 0.5,          // freshness exponent (0..1). Lower = gentler coverage bias.
  tau: 48,             // recency recovery time-constant, in HOURS.
  recencyFloor: 0.03,  // min recency weight, so a small pool never deadlocks.
  excludeLast: 3,      // HARD floor on how many others play before a repeat.
  excludeFrac: 0.2,    // ...or this fraction of the pool, whichever is larger.
  durationExp: 0.5,    // weight ∝ 1/duration^exp; shorter plays more OFTEN.
  channelPenalty: 0.15,// multiplier for an item sharing the just-played channel.
};

const opt = (o, k) => (o && o[k] != null ? o[k] : DEFAULTS[k]);

// --- Seedable PRNG (mulberry32) --------------------------------------------
// A tiny, fast, deterministic generator: same seed → same stream of floats in
// [0, 1). Use it anywhere a draw must be reproducible (tests today; seeded
// cross-device sync later). For "just random", pass Math.random instead.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Fisher–Yates shuffle ---------------------------------------------------
// Returns a NEW shuffled array (never mutates the input). `rand` is injectable so
// a shuffle can be made deterministic. Not a "shuffle bag" for playback — that
// gives refill-runs; the weighted pick() below is the picker. This is for one-off
// ordering (e.g. seeding a deterministic sequence).
export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// --- Weighting --------------------------------------------------------------
// Raw weight of one id given its {n,last} stats. `lastChannel` is the channel of
// the most-recently-played item (or null); items on that channel are down-weighted
// for diversity. `o.channels` maps id -> channelId; `o.durations` maps id -> secs.
export function weightOf(id, st, now, o, lastChannel) {
  const n = (st && st.n) || 0;
  const fresh = 1 / Math.pow(n + 1, opt(o, 'alpha'));

  let rec;
  if (st && st.last) {
    const hours = (now - st.last) / 3600000;
    rec = 1 - Math.exp(-hours / opt(o, 'tau'));
    if (rec < opt(o, 'recencyFloor')) rec = opt(o, 'recencyFloor');
  } else {
    rec = 1; // never played -> full weight (surface it)
  }

  let dur = 1;
  const durations = o && o.durations;
  const dexp = opt(o, 'durationExp');
  if (dexp > 0 && durations && durations[id] > 0) dur = Math.pow(durations[id], -dexp);

  let div = 1;
  const channels = o && o.channels;
  if (lastChannel != null && channels && channels[id] === lastChannel) {
    div = opt(o, 'channelPenalty');
  }

  return fresh * rec * dur * div;
}

// --- The pick ---------------------------------------------------------------
// Choose one id from `ids` by weighted draw. `stats` maps id -> {n,last}.
// opts: {
//   now,               // ms epoch (injected; default 0)
//   rand,              // () => [0,1) (injected; default Math.random)
//   recent,            // ids most-recently played, oldest..newest — the last few
//                      //   are hard-excluded, and the newest sets the diversity channel
//   channels,          // id -> channelId (for the diversity factor)
//   durations,         // id -> seconds (optional)
//   ...DEFAULTS overrides
// }
// Returns the chosen id, or null for an empty pool.
export function pick(ids, stats, opts) {
  opts = opts || {};
  if (!ids || !ids.length) return null;
  const now = opts.now != null ? opts.now : 0;
  const rand = opts.rand || Math.random;
  const recent = opts.recent || [];
  stats = stats || {};

  // How many recently-played ids to hard-exclude: the larger of a fixed floor and
  // a fraction of the pool, capped so a small pool always keeps ≥2 candidates.
  let k = Math.max(opt(opts, 'excludeLast'), Math.floor(ids.length * opt(opts, 'excludeFrac')));
  k = Math.min(k, Math.max(0, ids.length - 2), recent.length);
  const excluded = new Set();
  for (let r = recent.length - k; r < recent.length; r++) excluded.add(recent[r]);

  let pool = ids.filter((id) => !excluded.has(id));
  if (!pool.length) pool = ids.slice(); // everything excluded -> allow all
  if (pool.length === 1) return pool[0];

  // The channel to down-weight = the channel of the newest recent play.
  const lastId = recent.length ? recent[recent.length - 1] : null;
  const lastChannel = lastId != null && opts.channels ? opts.channels[lastId] : null;

  const weights = pool.map((id) => Math.max(weightOf(id, stats[id], now, opts, lastChannel), 1e-9));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    x -= weights[i];
    if (x <= 0) return pool[i];
  }
  return pool[pool.length - 1]; // float-safety fallback
}

// --- Stats from the append-only event log -----------------------------------
// Derive per-id {n:playCount, last:lastPlayedMs} from play-history events. This is
// how the picker gets its stats on the platform: history is stored as append-only
// events (never lost), and the counts are a projection of it — NOT a separate
// mutable record. `idKey`/`atKey` name the fields on each event.
export function statsFromEvents(events, { idKey = 'id', atKey = 'at' } = {}) {
  const stats = {};
  for (const e of events || []) {
    const id = e[idKey];
    if (id == null) continue;
    const at = e[atKey] || 0;
    const st = stats[id] || { n: 0, last: 0 };
    st.n += 1;
    if (at > st.last) st.last = at;
    stats[id] = st;
  }
  return stats;
}

// --- record (simulation / optimistic local update) --------------------------
// Return a NEW stats object with `id` counted as played at `now`. Handy for tests
// simulating many draws, and for an optimistic in-memory bump before the append
// event round-trips. The durable truth is still the event log (statsFromEvents).
export function record(stats, id, now) {
  const st = (stats && stats[id]) || { n: 0, last: 0 };
  return { ...(stats || {}), [id]: { n: st.n + 1, last: now } };
}
