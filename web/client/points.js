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
//   { amount, mult, type, source, tags, note, minutes? }
//     amount  base points (the "atom" ~= one small win ~= ~1 minute of focused work).
//             NEGATIVE is legal and meaningful: a penalty, or spending points on a reward.
//     mult    multiplier (1 default; 1.5 stretch hours; 2 alongside family/for-Mom)
//     type    the ledger's category — see TYPES below. Mirrors the "Type" column of the
//             points-tracker spreadsheet this model came from, so the two stay portable.
//     source  who awarded them ('sprint', 'progress', 'wordforge', …) — totals group by it
//     tags    free labels (subject, quest, task)
//     note    human note (the sprint's task label, the reward bought)
//     minutes optional — focused MINUTES this event represents. Only school-time events
//             carry it, and it is what the weekly hours engine counts (see below).
//   The server stamps `id` and `created_at`; the client clock is never the record.
//
// EARNING vs SPENDING. One stream carries both, separated by `type`: a `Reward` event is
// a purchase (stored NEGATIVE), everything else is earning. So balance is just the sum of
// the whole log, while "earned" and "spent" stay separately reportable — the same split
// the spreadsheet model draws between its Daily Log and its purchases list.
//
// SCHOOL TIME IS NOT PAID TWICE. The spreadsheet model runs two engines "kept separate so
// nothing double-counts": discrete tasks, and school HOURS (~1 point per focused minute,
// with weekly x1 / x1.5 stretch / x2 overtime bands). A finished sprint pays the BASE rate
// once, immediately, and also records its `minutes`. The weekly banding can therefore be
// paid later as a TOP-UP on the stretch/overtime portion only — it must never re-pay the
// base, or the two engines collide.
//
// KNOWN BOUND: totals here are derived from the most-recent `limit` events (default
// 1000). That is months of a real school year, but it IS a window — when it is
// outgrown the fix is a server-side rollup/aggregate endpoint, not a client cache
// of the total (a cached total can drift from an immutable log; a derived one can't).

// The ledger's categories. The first four mirror the points-tracker spreadsheet's "Type"
// column; `School` is focused school time (carries `minutes`); `Reward` is a purchase.
export const TYPES = ['Obligatory', 'Bonus', 'Idea', 'Penalty', 'School', 'Reward'];
export const REWARD_TYPE = 'Reward';
export const SCHOOL_TYPE = 'School';

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

// The BALANCE: the whole log summed. Purchases are negative, so this is earned - spent.
export function sumPoints(events) {
  return pointsEvents(events).reduce((n, e) => n + pointsValue(e), 0);
}

const isSpend = (e) => (e.data && e.data.type) === REWARD_TYPE;

// Everything that isn't a purchase — penalties included, exactly as the Daily Log sums them.
export function sumEarned(events) {
  return pointsEvents(events).filter((e) => !isSpend(e)).reduce((n, e) => n + pointsValue(e), 0);
}

// Purchases, reported POSITIVE ("you have spent 110") though stored negative.
export function sumSpent(events) {
  return -pointsEvents(events).filter(isSpend).reduce((n, e) => n + pointsValue(e), 0);
}

// Focused minutes recorded by school-time events — the input to the weekly hours engine.
export function sumMinutes(events, sinceMs = null) {
  return pointsEvents(events)
    .filter((e) => (e.data && e.data.type) === SCHOOL_TYPE)
    .filter((e) => sinceMs == null || new Date(e.created_at).getTime() >= sinceMs)
    .reduce((n, e) => n + (Number(e.data.minutes) || 0), 0);
}

// Local start-of-week (Monday 00:00) — the boundary the weekly hours target resets on.
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // Sunday(0) back 6, Monday(1) back 0
  return d.getTime();
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

  async function award({ amount, source, mult = 1, type = 'Bonus', tags = [], note = '', minutes = null } = {}) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return null;           // nothing earned, nothing recorded
    const m = Number(mult);
    const data = {
      amount: n,
      mult: Number.isFinite(m) && m > 0 ? m : 1,
      type: TYPES.includes(type) ? type : 'Bonus',
      source: String(source || 'unknown'),
      tags: Array.isArray(tags) ? tags.filter(Boolean).map(String) : [],
      note: String(note || ''),
    };
    if (Number.isFinite(Number(minutes)) && Number(minutes) > 0) data.minutes = Number(minutes);
    await stream.append(POINTS_KIND, data);                    // 1. the record (durable, first)
    const value = Math.round(data.amount * data.mult);
    if (bus) bus.publish(POINTS_TOPIC, { ...data, value });    // 2. the nudge (live)
    return { ...data, value };
  }

  // Spending is an award with the sign flipped and the Reward type — one stream, one
  // append path, so a purchase can no more be silently edited away than a point earned.
  const spend = ({ amount, note = '', source = 'progress', tags = [] } = {}) => {
    const n = Math.abs(Number(amount) || 0);
    return n ? award({ amount: -n, mult: 1, type: REWARD_TYPE, source, tags, note }) : Promise.resolve(null);
  };

  return {
    award,
    spend,
    load: () => stream.load(),
    startPolling: () => stream.startPolling(),
    subscribe: (fn) => stream.subscribe(fn),
    get: () => stream.get(),
    events: () => pointsEvents(stream.get().events || []),
    total: () => sumPoints(stream.get().events || []),          // the balance
    earned: () => sumEarned(stream.get().events || []),
    spent: () => sumSpent(stream.get().events || []),
    totalToday: (now = Date.now()) => sumPointsOn(stream.get().events || [], todayKey(now)),
    minutesThisWeek: (now = Date.now()) => sumMinutes(stream.get().events || [], weekStart(now)),
    bySource: () => sumBySource(stream.get().events || []),
    destroy: () => stream.destroy(),
  };
}
