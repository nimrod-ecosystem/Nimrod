// lineup.js - A LINEUP WITH RULES: which module takes the next turn, by days, hours and how often (row 2.87, Stage 1).
//
// Mike, 2026-10-14: *"I think the lineup is like a module/dashboard randomizer ... do an add module button, so you can
// add a module to the lineup. I'm kind of picturing something like SQL. Where you can set different conditions like if
// it's between these hours and a weekday play this. Then you could have different modules/playlists overlapping in
// different ways."* The plan, argued: Nimrod_Ecosystem docs/for_chat/lineup_plan_20261014.md.
//
// A LINEUP IS A PRESET (presets.js, type 'lineup'), so one can serve several dashboards. Its settings are a list of
// ENTRIES, one per line; a Lineup panel set to use it (modules/director.js `lineupPresetId`) draws each turn from them.
//   entry = { id, module, presetId, days, from, to, often, turnMs }
//     module    which turn: one of LINEUP_MODULES
//     presetId  that module's own preset to use ('' = its own settings on this Lineup panel)
//     days      0-6 (Sunday 0, the JavaScript day); [] or absent = every day
//     from, to  hours, 0-24 as decimals (7.5 = 07:30); both absent = all day; to < from runs past midnight
//     often     'rarely' | 'sometimes' | 'often'      weight  (Advanced) a number of its own, instead of the word
//     turnMs    how long a turn lasts. 0 = the module's own end: ONE video for videos (Mike, 2026-10-16: "one video for
//               videos"), the Lineup's own setting for Pictures (2 minutes), 5 minutes for a dashboard. Minutes on a
//               video turn: videos play one after another until the time is up, then the turn ends at the end of the
//               video playing.
//     show      a 'dashboard' entry only: which dashboard takes the turn (Mike, 2026-10-16: "a dashboard as an entry:
//               yes"). An entry naming none hands its turn straight back.
// ROWS, NOT SQL TEXT (argued in the plan): a row's parts are AND; two rows for the same module are OR.
// Pure: the clock and the random draw are passed in.

export const LINEUP_TYPE = 'lineup';
// The modules that can take a Lineup's turn today (modules/director.js PROVIDERS that are real). Labels are the words
// the form shows.
export const LINEUP_MODULES = Object.freeze([
  Object.freeze({ id: 'youtube', label: 'YouTube', presets: 'youtube' }),
  Object.freeze({ id: 'pictures', label: 'Pictures' }),
  Object.freeze({ id: 'personal', label: 'Personal videos' }),
  // LESSONS REPLACE EDUCATIONAL (row 2.108, Mike 2026-10-18: "Educational seems like it should just be replaced with the
  // lessons."). A turn of the Lessons module (modules/lesson_player.js), which keeps its place between turns.
  Object.freeze({ id: 'lessons', label: 'Lessons' }),
  // A whole dashboard for its turn (modules/director.js `makeDashboardAdapter`): which one is the entry's `show`.
  Object.freeze({ id: 'dashboard', label: 'A dashboard', shows: true }),
]);
const MODULE_IDS = new Set(LINEUP_MODULES.map((m) => m.id));

// HOW OFTEN, AS WEIGHTS (argued): each step three times the last. FOR 3x: "often" against "rarely" is then 9 to 1 -
// a difference anybody watching for an afternoon can see, which is what the words promise. AGAINST: an "often" entry
// can crowd out two "sometimes" ones overlapping it; that is what "often" means, and the freshness weight (Stage 2)
// pulls a module back once it has played a lot. A number under Advanced is a later choice (the plan, question 3).
export const OFTEN = Object.freeze({ rarely: 1, sometimes: 3, often: 9 });
export const OFTEN_DEFAULT = 'sometimes';
export const OFTEN_LABELS = Object.freeze({ rarely: 'Rarely', sometimes: 'Sometimes', often: 'Often' });
export const DAY_LABELS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
export const MAX_ENTRIES = 50;   // a Lineup is a handful of rows; this only stops a runaway paste filling a record

const num = (v) => (v === '' || v == null ? NaN : Number(v));
const hour = (v) => { const n = num(v); return Number.isFinite(n) && n >= 0 && n <= 24 ? n : null; };

/** One entry as kept: unknown modules and broken parts dropped, defaults filled. Null when it names no module. */
// A module a saved entry may still name, and what it reads as now (row 2.108: Educational's turn is Lessons').
export const RENAMED_MODULES = Object.freeze({ educational: 'lessons' });
export function cleanEntry(e, i = 0) {
  if (e && typeof e === 'object' && RENAMED_MODULES[e.module]) e = { ...e, module: RENAMED_MODULES[e.module] };
  if (!e || typeof e !== 'object' || !MODULE_IDS.has(e.module)) return null;
  const days = Array.isArray(e.days) ? [...new Set(e.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  const from = hour(e.from), to = hour(e.to);
  const turnMs = Number(e.turnMs);
  const weight = Number(e.weight);
  return {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 40) : `e${i + 1}`,
    module: e.module,
    presetId: typeof e.presetId === 'string' ? e.presetId.slice(0, 80) : '',
    ...(e.module === 'dashboard' && typeof e.show === 'string' && e.show.trim() ? { show: e.show.trim().slice(0, 80) } : {}),
    days: days.length === 7 ? [] : days,
    ...(from != null && to != null ? { from, to } : {}),
    often: OFTEN[e.often] ? e.often : OFTEN_DEFAULT,
    // (2026-10-16, Mike: "words by default, a number under Advanced") a number of its own, when set, is the weight.
    ...(Number.isFinite(weight) && weight > 0 ? { weight: Math.min(weight, 100) } : {}),
    turnMs: Number.isFinite(turnMs) && turnMs >= 10000 ? Math.min(turnMs, 3600000) : 0,
  };
}
export function cleanEntries(list) {
  const out = [];
  for (const [i, e] of (Array.isArray(list) ? list : []).entries()) {
    const c = cleanEntry(e, i);
    if (c && !out.some((x) => x.id === c.id)) out.push(c);
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

/** Does `entry` hold at `date`? Days, then hours (to < from runs past midnight; equal = all day). */
export function entryMatches(entry, date = new Date()) {
  const e = entry || {};
  const d = date instanceof Date ? date : new Date(date);
  if (Array.isArray(e.days) && e.days.length && !e.days.includes(d.getDay())) return false;
  if (e.from == null || e.to == null || e.from === e.to) return true;
  const h = d.getHours() + d.getMinutes() / 60;
  return e.from < e.to ? h >= e.from && h < e.to : h >= e.from || h < e.to;
}

/** The entries in the draw now. */
export const eligible = (entries, date = new Date()) => cleanEntries(entries).filter((e) => entryMatches(e, date));

/**
 * The entry for the next turn: weighted by how often, times `weightOf(entry)` (Stage 2's freshness; 1 by default),
 * from those that hold now. Null when none holds (the Lineup then keeps its last turn going: the plan, question 1).
 * `rand` returns [0, 1). An entry just played is not drawn twice in a row when another holds.
 */
export function pickEntry(entries, { date = new Date(), rand = Math.random, last = null, weightOf = () => 1 } = {}) {
  let pool = eligible(entries, date);
  if (pool.length > 1 && last) pool = pool.filter((e) => e.id !== last);
  if (!pool.length) return null;
  const w = pool.map((e) => Math.max(0, (e.weight > 0 ? e.weight : OFTEN[e.often]) * (Number(weightOf(e)) || 0)));
  const total = w.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return pool[0];
  let r = Math.min(Math.max(Number(rand()) || 0, 0), 0.999999) * total;
  for (let i = 0; i < pool.length; i += 1) { r -= w[i]; if (r < 0) return pool[i]; }
  return pool[pool.length - 1];
}

// ---- STAGE 2: WHAT HAS PLAYED LESS LATELY COMES UP MORE (Mike: "Start tracking module plays, like how often Spotify or
// Youtube has played recently and use that as an additional weight") ----------------------------------------------
// Each turn is logged as a play of its module (director.js, source 'lineup', on this device). A module's SHARE of the
// turns in the window lowers its weight: weight = 1 / (1 + strength x share). A module with no turns lately keeps 1.
//   STRENGTH, a setting (`lineupFresh`): off 0, "a little" 1 (the default: a module that had every turn lately comes
//   up half as often as one that had none - noticeable, never a lock-out), "a lot" 3 (a quarter as often).
//   THE WINDOW: 24 hours. Argued, not yet a setting (Rule 1, said here and on Mike's list): a day is one cycle of the
//   hours rules, so yesterday's evening does not weigh on this morning twice. FOR shorter: the mix reacts faster.
//   AGAINST: an hour's window forgets a module that filled the whole morning. A setting the day anyone asks.
export const FRESH_WINDOW_MS = 24 * 3600 * 1000;
export const FRESH_STRENGTH = Object.freeze({ off: 0, little: 1, lot: 3 });
export const FRESH_DEFAULT = 'little';
export const FRESH_FIELD = Object.freeze({
  key: 'lineupFresh', label: 'Give what has played less lately more turns', kind: 'choice', default: FRESH_DEFAULT, level: 'standard',
  options: [{ value: 'off', label: 'No' }, { value: 'little', label: 'A little' }, { value: 'lot', label: 'A lot' }],
});
/**
 * `weightOf(entry)` for pickEntry, from play rows ({ created_at, data: { id: <module> } }). Pure.
 * `strength`: a FRESH_STRENGTH key or a number.
 */
export function freshnessWeights(rows, { now = Date.now(), windowMs = FRESH_WINDOW_MS, strength = FRESH_DEFAULT } = {}) {
  const k = typeof strength === 'number' ? strength : (FRESH_STRENGTH[strength] ?? FRESH_STRENGTH[FRESH_DEFAULT]);
  const since = Number(now) - windowMs;
  const counts = {};
  let total = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Date.parse(r && r.created_at);
    const id = r && r.data && r.data.id;
    if (!id || !Number.isFinite(t) || t < since || t > Number(now) + 60000) continue;
    counts[id] = (counts[id] || 0) + 1;
    total += 1;
  }
  return (entry) => {
    if (!(k > 0) || !total) return 1;
    const share = (counts[entry && entry.module] || 0) / total;
    return 1 / (1 + k * share);
  };
}

/** "YouTube, Morning playlist, Mon-Fri, 07:00-11:00, often": an entry as the sentence it is. */
export function entryWords(entry, { presetName = () => '', showName = () => '' } = {}) {
  const e = cleanEntry(entry) || {};
  const m = LINEUP_MODULES.find((x) => x.id === e.module);
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (h) => `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`;
  const days = !e.days || !e.days.length ? 'every day' : e.days.map((d) => DAY_LABELS[d]).join(' ');
  const hours = e.from == null ? 'all day' : `${hm(e.from)}-${hm(e.to)}`;
  // A dashboard entry names its dashboard ("A dashboard, Kitchen, ..."), or says it names none yet.
  const using = m && m.shows
    ? (e.show ? (showName(e.show) || 'a dashboard that is gone') : 'none chosen yet')
    : (e.presetId ? (presetName(e.presetId) || 'a preset that is gone') : '');
  return [m ? m.label : '?', using, days, hours, (OFTEN_LABELS[e.often] || '').toLowerCase()].filter(Boolean).join(', ');
}
