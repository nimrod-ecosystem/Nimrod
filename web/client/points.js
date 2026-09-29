// points.js — the POINTS LEDGER: the one place a "you earned N points" fact lives.
//
// A whole curriculum can be run as one points game: a finished sprint, a correct answer
// in a learning game, a chore, a photo tagged for somebody — all of them award points,
// and a dashboard shows the totals. That only works if every source speaks ONE language
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
//   { amount, mult, type, source, tags, note, minutes?, latencyMs? }
//     amount  base points (the "atom" ~= one small win ~= ~1 minute of focused work).
//             NEGATIVE is legal and meaningful: a penalty, or spending points on a reward.
//     mult    multiplier (1 default; 1.5 stretch hours; 2 alongside family/for-Mom)
//     type    the ledger's category — see TYPES below. Mirrors the "Type" column of the
//             points-tracker spreadsheet this model came from, so the two stay portable.
//     source  who awarded them ('sprint', 'quests', 'wordforge', …) — totals group by it
//     tags    free labels (subject, quest, task)
//     note    human note (the sprint's task label, the reward bought)
//     minutes optional — focused MINUTES this event represents. Only school-time events
//             carry it, and it is what the weekly hours engine counts (see below).
//     latencyMs optional — MIKE_CHANGE_LIST.md §0a item 6, quests fifth and last. Most
//             awards have no real stimulus to time (tapping a task you already finished is
//             self-initiated, like sprint's phase advances — see sprint.js's own header on
//             why THAT module doesn't time it either). The one place quests.js shows something
//             and times the response is confirm-to-buy: the reward store's two-tap purchase
//             (see quests.js's `buy()`) shows "tap again to confirm" and the second tap answers it,
//             which is a real shown-then-answered gap the same shape as call's ring-to-answer.
//             Only that caller ever sets it. Never fabricated as 0 or null when absent — the
//             same rule as every other latency field in this codebase.
//   The server stamps `id` and `created_at`; the client clock is never the record.
//
// EARNING vs SPENDING. One stream carries both, separated by `type`: a `Reward` event is
// a purchase (stored NEGATIVE), everything else is earning. So balance is just the sum of
// the whole log, while "earned" and "spent" stay separately reportable — the same split
// the spreadsheet model draws between its Daily Log and its purchases list.
//
// *** 2026-09-28: THERE IS NO LONGER ONE BALANCE — THERE ARE CURRENCIES, AND THE ONE ABOVE IS
// NOW THE TOTAL. *** Kept rather than deleted, because it is still true of `sumPoints` and it
// is the reasoning the currencies were built on. Register 262-263, Mike: *"play and school
// points would be like two different currencies. That would go together into total points.
// You can trade school points for play points, but not the other way around."* So:
//   - A CURRENCY is a row of DATA (`DEFAULT_CURRENCIES` below): id, name, icon, and which
//     earning TYPES feed it. School and Play are just the first two rows; games may get their
//     own later ("more of an economy"). The names are placeholders; the ids are the keys.
//   - Each currency's balance is DERIVED from the same log — earnings of the types that feed
//     it, minus the spends that name it (`currency` on a Reward event), plus/minus exchanges.
//     Nothing about an award call changed: the currency comes from the event's `type`.
//   - The TOTAL is the sum of the currencies, and `sumPoints` still returns it, so every
//     existing caller keeps its meaning.
//   - An EXCHANGE (`type: 'Exchange'`) is ONE event that debits `from` by `amount` and credits
//     `to` by `amount x rate`. It is neither earning nor spending; its only effect on the total
//     is `amount x (rate - 1)` — nothing at the default 1:1. Which directions exist, and at what
//     rate, is DATA too (`DEFAULT_EXCHANGES`); a direction with no row is not allowed.
//   - "Earned" and "spent" keep their old meaning and leave exchanges out, so
//     total = earned - spent + (the net of any exchanges).
//
// A POINT IS A MINUTE OF SUBJECT CREDIT. This is the rule the whole economy turns on, and
// it is about understanding rather than seat time: **games do not pay for time spent.**
// They pay for correct answers, and each point earned also discharges one minute of that
// SUBJECT's required time. Someone who understands quickly finishes their hours quickly;
// someone who stares at a wall for an hour earns nothing from it.
//
// So an event can carry BOTH a currency value and `minutes` of subject credit, and for a
// game those are the same number. A sprint is the other shape: it pays for focused time
// at ~1 point per minute, and records those minutes.
//
// SCHOOL TIME IS STILL NOT PAID TWICE. The weekly banding (x1.5 stretch / x2 overtime) is
// a TOP-UP on the stretch/overtime portion only — it must never re-pay the base.
//
// KNOWN BOUND: totals here are derived from the most-recent `limit` events (default
// 1000). That is months of a real school year, but it IS a window — when it is
// outgrown the fix is a server-side rollup/aggregate endpoint, not a client cache
// of the total (a cached total can drift from an immutable log; a derived one can't).

// The ledger's categories. The first four mirror the points-tracker spreadsheet's "Type"
// column; `School` is focused school time (carries `minutes`); `Reward` is a purchase.
// `Play` (added 2026-09-28, Mike -- register 250/257: "Arcade only... points from playing a
// game shouldn't go towards screen time or anything like that") is arcade-style play only
// (Comet, balloons, pond, press games) -- Word Forge, Trivia and algebra keep paying School,
// because those pay for correct answers against the curriculum this ledger is built on.
// "Play" is a working name from the register, not a spreadsheet column; say so if it should
// change. WHAT PLAY CANNOT DO IS NOT ENFORCED HERE: a per-user setting for which classes may
// buy which rewards (register 250 §2) is separate, not-yet-built work in the reward store
// (quests.js) -- this file only makes the category exist and stops it defaulting to Bonus.
// 2026-09-28, later the same day: WHAT PLAY CANNOT BUY IS NOW ENFORCED — by currencies (below)
// and each reward's `accepts` list in quests.js, not by a check on types.
// `Exchange` (added the same day) is a School -> Play trade; only `exchange()` writes it.
export const TYPES = ['Obligatory', 'Bonus', 'Idea', 'Penalty', 'School', 'Reward', 'Play', 'Exchange'];
export const REWARD_TYPE = 'Reward';
export const SCHOOL_TYPE = 'School';
export const EXCHANGE_TYPE = 'Exchange';

// ---------- currencies (register 262-263): DATA, not two hard-coded names ----------
//
// WHY THIS LIVES HERE AND NOT IN A currencies.js: a balance per currency has to understand
// every event shape this file defines — a Reward spend, an Exchange, the fallbacks for types it
// does not know — and `pointsValue` has to know what an Exchange is worth to the total. Split
// out, the two files would each need the other's rules. One file is the ledger's language.
//
// `icon` was null until design delivered: Mike, *"The different currencies should probably have
// different icons. We'll have to go to design for this."* The slot existed so the design could land
// as data, and on 2026-09-29 it did — Claude Design's two coins (a book on a shield for School, a
// star for Play), in `web/client/design-assets/points/`, credited in ATTRIBUTIONS.md. An ABSOLUTE
// path, like `/packs/…`, so a module on any page reaches it. A custom currency may still carry a
// glyph or null; quests.js draws whichever it gets.
// `name` is a placeholder too (*"We'll probably need different names than play and school"*);
// `id` is what the record is keyed by and should not change when the name does.
export const DEFAULT_CURRENCIES = [
  { id: 'school', name: 'School', icon: '/design-assets/points/school.svg',
    feeds: ['Obligatory', 'Bonus', 'Idea', 'Penalty', 'School'] },
  { id: 'play', name: 'Play', icon: '/design-assets/points/play.svg', feeds: ['Play'] },
];

// Which trades are allowed, and at what rate: `to` receives `amount x rate`. A direction with
// no row is NOT allowed — so Play -> School is refused by the absence of a row, which is the
// rule Mike gave ("not the other way around"), and a later game currency is refused until
// somebody writes it a row. The 1:1 rate is a default; quests.js exposes it as a setting.
export const DEFAULT_EXCHANGES = [{ from: 'school', to: 'play', rate: 1 }];

// THE HOME CURRENCY — where anything the data cannot place lands. School, argued: (1) every
// event recorded before 2026-09-28 fed School, because Play did not exist; (2) `award()` already
// turns an unknown type into `Bonus`, which feeds School, so the read side and the write side
// agree; (3) the alternative — a point that belongs to no currency — would make the total and
// the sum of the currencies disagree, which is the one thing Mike's "go together into total
// points" rules out. The cost, stated: a type written by some future client this code does not
// know would be spendable as School. Revisable; it is a default, not a rule. A custom currency
// list without a `school` row uses its FIRST row instead.
export const HOME_CURRENCY = 'school';

const currencyList = (currencies) =>
  (Array.isArray(currencies) && currencies.length ? currencies : DEFAULT_CURRENCIES);

function homeCurrencyId(currencies) {
  const list = currencyList(currencies);
  return list.some((c) => c.id === HOME_CURRENCY) ? HOME_CURRENCY : list[0].id;
}

// A currency id as the data knows it; anything else (absent, deleted, misspelled) is the home.
function resolveCurrencyId(id, currencies) {
  const list = currencyList(currencies);
  return list.some((c) => c.id === id) ? id : homeCurrencyId(list);
}

// The parts of a well-formed Exchange event, or null. Malformed exchanges count for NOTHING —
// not in any balance and not in the total — rather than being guessed at.
export function exchangeParts(ev) {
  const d = (ev && ev.data) || {};
  if (d.type !== EXCHANGE_TYPE) return null;
  const amount = Number(d.amount);
  const rate = Number(d.rate);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (typeof d.from !== 'string' || !d.from || typeof d.to !== 'string' || !d.to) return null;
  return { from: d.from, to: d.to, amount, rate };
}

/**
 * Which currency one event belongs to.
 *   - an earning event: the currency its `type` feeds (unknown or missing type -> home)
 *   - a Reward (spend): the `currency` it records. *** A LEGACY SPEND — one written before
 *     2026-09-28, with no `currency` field — COUNTS AGAINST SCHOOL (the home currency), because
 *     every point earned before today's `Play` type fed School, so School is what it spent. ***
 *   - an Exchange: null — it moves points BETWEEN two currencies; see `balancesByCurrency`.
 */
export function currencyOf(ev, currencies = DEFAULT_CURRENCIES) {
  const list = currencyList(currencies);
  const d = (ev && ev.data) || {};
  if (d.type === EXCHANGE_TYPE) return null;
  if (d.type === REWARD_TYPE) return resolveCurrencyId(d.currency, list);
  const hit = list.find((c) => Array.isArray(c.feeds) && c.feeds.includes(d.type));
  return hit ? hit.id : homeCurrencyId(list);
}

// { currencyId -> balance } over the whole log. Every currency in the data is present, at 0 if
// nothing touched it. The values sum to `sumPoints(events)` — always; the tests hold it to that.
export function balancesByCurrency(events, currencies = DEFAULT_CURRENCIES) {
  const list = currencyList(currencies);
  const out = {};
  for (const c of list) out[c.id] = 0;
  for (const e of pointsEvents(events)) {
    const d = e.data || {};
    if (d.type === EXCHANGE_TYPE) {
      const x = exchangeParts(e);
      if (!x) continue;
      out[resolveCurrencyId(x.from, list)] -= x.amount;
      out[resolveCurrencyId(x.to, list)] += x.amount * x.rate;
      continue;
    }
    out[currencyOf(e, list)] += pointsValue(e);
  }
  return out;
}

// The total across currencies ("go together into total points").
export function totalOfBalances(balances) {
  return Object.values(balances || {}).reduce((n, v) => n + (Number(v) || 0), 0);
}

// The exchange row for from -> to, or null when that direction is not allowed.
export function findExchange(from, to, exchanges = DEFAULT_EXCHANGES) {
  if (!from || !to || from === to) return null;
  const hit = (Array.isArray(exchanges) ? exchanges : [])
    .find((x) => x && x.from === from && x.to === to && Number(x.rate) > 0);
  return hit ? { from, to, rate: Number(hit.rate) } : null;
}

/**
 * Would this exchange be allowed right now? Pure, so a module can EXPLAIN a refusal rather
 * than only suffer one. `{ ok, reason, rate, gets, have }`, reason one of:
 *   'not-allowed'  no row for that direction (Play -> School, by default)
 *   'bad-amount'   zero, negative, or not a number
 *   'short'        more than the `from` balance (checked against the TRUE balance)
 */
export function checkExchange({ from, to, amount } = {}, events = [],
                              { currencies = DEFAULT_CURRENCIES, exchanges = DEFAULT_EXCHANGES } = {}) {
  const row = findExchange(from, to, exchanges);
  const n = Number(amount);
  const have = balancesByCurrency(events, currencies)[from];
  if (!row) return { ok: false, reason: 'not-allowed', have };
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'bad-amount', have, rate: row.rate };
  if (!(Number(have) >= n)) return { ok: false, reason: 'short', have: Number(have) || 0, rate: row.rate };
  return { ok: true, reason: null, rate: row.rate, gets: n * row.rate, have };
}

export const POINTS_STREAM = 'points';        // well-known shared stream key
export const POINTS_TOPIC  = 'points/award';  // bus topic — live nudge, NOT the record
export const POINTS_KIND   = 'points';        // event kind within the stream

// ---------- pure helpers (no I/O — the math the dashboard and the tests share) ----------

/**
 * What one award is actually worth: base x multiplier.
 *
 * *** IT USED TO ROUND TO A WHOLE POINT, AND THAT HAD TO GO. *** Chat's #5 scores a trivia
 * answer at **1 / 0.75 / 0.5 / 0.25** by guess. Through `Math.round` those become **1 / 1 / 1 /
 * 0** — every guess but the last worth the same, and the last worth nothing. The scheme cannot
 * exist while the ledger rounds.
 *
 * *** THE RECORD KEEPS WHAT HAPPENED. ROUNDING IS A DISPLAY CHOICE. *** That is the same rule
 * this project already holds for content, and it is the safer half of the trade: a stored 0.75
 * can always be shown as 1, and a stored 1 can never be shown as 0.75.
 *
 * WHAT THIS DOES NOT BREAK, checked rather than assumed: affordability in `quests.js` is
 * `balance >= r.cost` against the TRUE balance, so a fractional balance simply cannot offer a
 * reward it will then refuse. The only exposure was a DISPLAYED balance overstating what could
 * be spent, and the displays floor for exactly that reason — see `fmtPoints`.
 */
export function pointsValue(ev) {
  const d = (ev && ev.data) || {};
  // AN EXCHANGE IS WORTH ITS EFFECT ON THE TOTAL: `to` gains amount x rate, `from` loses amount,
  // so the total moves by amount x (rate - 1) — zero at 1:1. Everything that sums pointsValue
  // (the total, a day's total, by-source) therefore stays equal to the sum of the currencies.
  if (d.type === EXCHANGE_TYPE) {
    const x = exchangeParts(ev);
    return x ? x.amount * x.rate - x.amount : 0;
  }
  const amount = Number(d.amount);
  if (!Number.isFinite(amount)) return 0;
  const mult = Number(d.mult);
  return amount * (Number.isFinite(mult) && mult > 0 ? mult : 1);
}

/**
 * A points figure as somebody reads it.
 *
 * *** FLOOR, NEVER ROUND, FOR ANYTHING THAT BEHAVES LIKE A BALANCE. *** Rounding 3.75 to 4 puts
 * a 4 on screen beside a reward costing 4 that the button correctly refuses — the number and the
 * control disagree, and the person cannot tell which is lying. Flooring can only ever understate,
 * which is the direction that keeps a promise.
 *
 * Fractions below a whole point are shown to two decimals rather than hidden: somebody who just
 * earned 0.75 for a second-guess answer should see that it counted.
 */
export function fmtPoints(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v)) return String(v);
  return Math.abs(v) < 1 ? String(Math.round(v * 100) / 100) : String(Math.floor(v));
}

// A shared stream may one day carry other kinds; totals only ever count `points`.
export function pointsEvents(events) {
  return (events || []).filter((e) => e && e.kind === POINTS_KIND);
}

// The TOTAL: the whole log summed. Purchases are negative, so this is earned - spent (plus the
// net of any exchanges, which is 0 at 1:1). Since 2026-09-28 it equals the sum of
// `balancesByCurrency` — this is the "total points" the currencies go together into.
export function sumPoints(events) {
  return pointsEvents(events).reduce((n, e) => n + pointsValue(e), 0);
}

const isSpend = (e) => (e.data && e.data.type) === REWARD_TYPE;
const isExchange = (e) => (e.data && e.data.type) === EXCHANGE_TYPE;

// Everything that isn't a purchase — penalties included, exactly as the Daily Log sums them.
// NOT exchanges: trading School for Play is not something you did to earn points.
export function sumEarned(events) {
  return pointsEvents(events).filter((e) => !isSpend(e) && !isExchange(e))
    .reduce((n, e) => n + pointsValue(e), 0);
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

// Minutes of credit per SUBJECT — the six-subject view Ohio's requirement is written in.
// Counts every event carrying `minutes`, whichever engine produced it: a sprint's focused
// time and a game's correct answers both discharge the same requirement.
export function minutesBySubject(events, sinceMs = null) {
  const out = {};
  for (const e of pointsEvents(events)) {
    const m = Number(e.data && e.data.minutes);
    if (!Number.isFinite(m) || m <= 0) continue;
    if (sinceMs != null && new Date(e.created_at).getTime() < sinceMs) continue;
    const subj = (e.data && e.data.subject) || 'Unassigned';
    out[subj] = (out[subj] || 0) + m;
  }
  return out;
}

// Local start-of-week (Monday 00:00) — the boundary the weekly hours target resets on.
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // Sunday(0) back 6, Monday(1) back 0
  return d.getTime();
}

// { source -> total }, for the dashboard's "where did today's points come from".
// An exchange contributes its NET (0 at 1:1) under the source that wrote it (`quests`), so the
// sources still add up to the total. Day totals (`sumPointsOn`) do the same; and because an
// exchange is written as `quests`, it can never count against a GAME's daily cap.
export function sumBySource(events) {
  const out = {};
  for (const e of pointsEvents(events)) {
    const src = (e.data && e.data.source) || 'unknown';
    out[src] = (out[src] || 0) + pointsValue(e);
  }
  return out;
}

// LOCAL calendar day of a server ISO timestamp — "today" means the player's today, not UTC's.
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

// What ONE source has already paid out today. This is what a DAILY CAP is built on:
// a game meant to be dipped into between other things must not turn into an income
// stream just because it was left open for six hours.
export function sumPointsOnBySource(events, key, source) {
  return pointsEvents(events)
    .filter((e) => dayKey(e.created_at) === key && (e.data && e.data.source) === source)
    .reduce((n, e) => n + pointsValue(e), 0);
}

// ---------- the handle ----------

// A ledger over the shared stream. `makeEvents` is ctx.makeEvents — a module never
// builds a storage URL itself.
//
//   award({amount, source, mult, tags, note})  append the record + publish the nudge
//   spend({amount, currency, ...})             a Reward event that names the currency paid
//   exchange({from, to, amount})               one Exchange event, or null if refused
//   subscribe(fn)                              fn({events,total}) on every refresh
//   total() / totalToday()                     derived from the loaded window (the TOTAL)
//   balances()                                 { currencyId -> balance }, summing to total()
//
// The caller owns the lifecycle: call destroy() in the module's destroy(), because
// handles a module makes itself are not the ones the runtime disposes.
export function createPointsLedger({ makeEvents, bus = null, limit = 1000, pollMs = 4000,
                                     currencies = DEFAULT_CURRENCIES,
                                     exchanges = DEFAULT_EXCHANGES } = {}) {
  if (typeof makeEvents !== 'function') {
    throw new Error('createPointsLedger: ctx.makeEvents is required');
  }
  const stream = makeEvents(POINTS_STREAM, { limit, pollMs });
  const all = () => stream.get().events || [];

  async function award({ amount, source, mult = 1, type = 'Bonus', tags = [], note = '',
                         minutes = null, subject = null, latencyMs = null, currency = null } = {}) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return null;           // nothing earned, nothing recorded
    // An Exchange cannot be recorded honestly without from/to/rate, and award() has none of
    // them — so it records nothing rather than guessing (and never throws into a module).
    if (type === EXCHANGE_TYPE) return null;
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
    if (subject) data.subject = String(subject);
    if (Number.isFinite(latencyMs) && latencyMs >= 0) data.latencyMs = latencyMs;
    // Only a spend names its currency; an earning's currency is derived from its type.
    if (data.type === REWARD_TYPE) data.currency = resolveCurrencyId(currency, currencies);
    await stream.append(POINTS_KIND, data);                    // 1. the record (durable, first)
    const value = Math.round(data.amount * data.mult);
    if (bus) bus.publish(POINTS_TOPIC, { ...data, value });    // 2. the nudge (live)
    return { ...data, value };
  }

  // Spending is an award with the sign flipped and the Reward type — one stream, one
  // append path, so a purchase can no more be silently edited away than a point earned.
  // Since 2026-09-28 it RECORDS WHICH CURRENCY PAID (`currency`); none named = the home
  // currency, written explicitly so the record never depends on today's fallback rule.
  // It does not check the balance — the reward store does, against the chosen currency.
  const spend = ({ amount, currency = null, note = '', source = 'quests', tags = [],
                   latencyMs = null } = {}) => {
    const n = Math.abs(Number(amount) || 0);
    return n ? award({ amount: -n, mult: 1, type: REWARD_TYPE, source, tags, note, latencyMs, currency })
             : Promise.resolve(null);
  };

  // Trade one currency for another: ONE append-only Exchange event, debit and credit together.
  // One event rather than a debit/credit PAIR because a pair can be half-written (the second
  // append fails and the School is gone with no Play to show for it); one event cannot.
  // REFUSES — returns null, records nothing, never throws — a direction with no row in the
  // exchange data, a non-positive amount, or more than the `from` balance. `exchanges` may be
  // passed per call so a module's rate SETTING applies without rebuilding the ledger.
  async function exchange({ from, to, amount, source = 'quests', note = '',
                            exchanges: rows = exchanges } = {}) {
    const verdict = checkExchange({ from, to, amount }, all(), { currencies, exchanges: rows });
    if (!verdict.ok) return null;
    const data = {
      amount: Number(amount), mult: 1, type: EXCHANGE_TYPE,
      from, to, rate: verdict.rate,
      source: String(source || 'quests'), tags: ['exchange'], note: String(note || ''),
    };
    await stream.append(POINTS_KIND, data);
    const value = data.amount * data.rate - data.amount;       // its effect on the total
    if (bus) bus.publish(POINTS_TOPIC, { ...data, value });
    return { ...data, value, gets: verdict.gets };
  }

  return {
    award,
    spend,
    exchange,
    currencies: () => currencyList(currencies),
    balances: () => balancesByCurrency(all(), currencies),
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
    subjectsThisWeek: (now = Date.now()) => minutesBySubject(stream.get().events || [], weekStart(now)),
    todayFrom: (source, now = Date.now()) =>
      sumPointsOnBySource(stream.get().events || [], todayKey(now), source),
    bySource: () => sumBySource(stream.get().events || []),
    destroy: () => stream.destroy(),
  };
}
