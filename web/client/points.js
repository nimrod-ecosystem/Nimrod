// points.js — the POINTS LEDGER: the one place a "you earned N points" fact lives.
//
// Oscar's whole curriculum is a points game: a finished sprint, a correct answer in
// a learning game, a chore, a photo tagged for Mom — all of them award points, and a
// dashboard shows the totals. That only works if every source speaks ONE language
// into ONE record. This file is that language.
//
// TWO SEAMS, DELIBERATELY DIFFERENT:
//
//   1. THE RECORD (durable)  — a PROFILE-SCOPED append-only stream named `points`.
//      Reached with ctx.makeEvents('points'), which every module already has on its
//      ctx. Per-instance handles (ctx.events) are keyed to ONE module instance, so a
//      game's points would be invisible to a dashboard instance; a well-known shared
//      stream key fixes that with no server change (the API's stream key is just a
//      string). Append-only means points can never be silently edited away.
//
//   2. THE NUDGE (live)      — the bus topic `points/award`. A mounted dashboard can
//      react the instant points are earned instead of waiting for its next poll.
//
// THE RULE THAT KEEPS THEM HONEST: **only the SOURCE appends.** A consumer that both
// listened on the bus and appended would double-count. Consumers read the stream for
// truth and listen on the bus for immediacy. `award()` below does both halves once.
//
// EVENT SHAPE — kind `points`, data:
//   { amount, mult, source, tags, note }
//     amount  base points (the "atom" ~= one small win ~= ~1 minute of focused work)
//     mult    multiplier (1 default; 1.5 stretch hours; 2 alongside family)
//     source  who awarded them ('sprint', 'wordforge', …) — the dashboard groups by it
//     tags    free labels (subject, quest, task)
//     note    human note (the sprint's task label, the word answered)
//   The server stamps `id` and `created_at`; the client clock is never the record.
//
// KNOWN BOUND: totals here are derived from the most-recent `limit` events (default
// 1000). That is months of a real school year, but it IS a window — when it is
// outgrown the fix is a server-side rollup/aggregate endpoint, not a client cache
// of the total (a cached total can drift from an immutable log; a derived one can't).

export const POINTS_STREAM = 'points';        // well-known shared stream key
export const POINTS_TOPIC  = 'points/award';  // bus topic — live nudge, NOT the record
export const POINTS_KIND   = 'points';        // event kind within the stream

// ---------- pure helpers (no I/O — the math the dashboard and the tests share) ----------

// What one award is actually worth: base x multiplier, rounded to a whole point.
export function pointsValue(ev) {
  const d = (ev && ev.data) || {};
  const amount = Number(d.amount);
  if (!Number.isFinite(amount)) return 0;
  const mult = Number(d.mult);
  return Math.round(amount * (Number.isFinite(mult) && mult > 0 ? mult : 1));
}

// A shared stream may one day carry other kinds; totals only ever count `points`.
export function pointsEvents(events) {
  return (events || []).filter((e) => e && e.kind === POINTS_KIND);
}

export function sumPoints(events) {
  return pointsEvents(events).reduce((n, e) => n + pointsValue(e), 0);
}

// { source -> total }, for the dashboard's "where did today's points come from".
export function sumBySource(events) {
  const out = {};
  for (const e of pointsEvents(events)) {
    const src = (e.data && e.data.source) || 'unknown';
    out[src] = (out[src] || 0) + pointsValue(e);
  }
  return out;
}

// LOCAL calendar day of a server ISO timestamp — "today" means Oscar's today, not UTC's.
export function dayKey(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function sumPointsOn(events, key) {
  return pointsEvents(events)
    .filter((e) => dayKey(e.created_at) === key)
    .reduce((n, e) => n + pointsValue(e), 0);
}

export function todayKey(now = Date.now()) { return dayKey(new Date(now).toISOString()); }

// ---------- the handle ----------

// A ledger over the shared stream. `makeEvents` is ctx.makeEvents — a module never
// builds a storage URL itself.
//
//   award({amount, source, mult, tags, note})  append the record + publish the nudge
//   subscribe(fn)                              fn({events,total}) on every refresh
//   total() / totalToday()                     derived from the loaded window
//
// The caller owns the lifecycle: call destroy() in the module's destroy(), because
// handles a module makes itself are not the ones the runtime disposes.
export function createPointsLedger({ makeEvents, bus = null, limit = 1000, pollMs = 4000 }) {
  if (typeof makeEvents !== 'function') {
    throw new Error('createPointsLedger: ctx.makeEvents is required');
  }
  const stream = makeEvents(POINTS_STREAM, { limit, pollMs });

  async function award({ amount, source, mult = 1, tags = [], note = '' } = {}) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return null;           // nothing earned, nothing recorded
    const m = Number(mult);
    const data = {
      amount: n,
      mult: Number.isFinite(m) && m > 0 ? m : 1,
      source: String(source || 'unknown'),
      tags: Array.isArray(tags) ? tags.filter(Boolean).map(String) : [],
      note: String(note || ''),
    };
    await stream.append(POINTS_KIND, data);                    // 1. the record (durable, first)
    const value = Math.round(data.amount * data.mult);
    if (bus) bus.publish(POINTS_TOPIC, { ...data, value });    // 2. the nudge (live)
    return { ...data, value };
  }

  return {
    award,
    load: () => stream.load(),
    startPolling: () => stream.startPolling(),
    subscribe: (fn) => stream.subscribe(fn),
    get: () => stream.get(),
    events: () => pointsEvents(stream.get().events || []),
    total: () => sumPoints(stream.get().events || []),
    totalToday: (now = Date.now()) => sumPointsOn(stream.get().events || [], todayKey(now)),
    bySource: () => sumBySource(stream.get().events || []),
    destroy: () => stream.destroy(),
  };
}
