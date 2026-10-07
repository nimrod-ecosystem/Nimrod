// play_charts.js — QUESTIONS ASKED OF THIS DEVICE'S PLAYS, AND THE ANSWERS AS A TABLE, A SERIES, A NUMBER OR WORDS.
// Row 2.62, step 2 ("flat chart modules first ... each with a plain table reading for screen readers and for voice").
//
// Mike, 2026-10-07: *"It would be nice for people to be able to visualize Spotify/Youtube plays."* Step 1 made the
// record (plays.js: one shape for every player, kept ON THIS DEVICE). This file asks it questions - "what played most
// this week", "how many plays each day this month" - and returns plain data a chart draws, a table reads out and a
// voice says. modules/charts.js is the panel that shows them.
//
// *** NOTHING LEAVES THE DEVICE. *** Every function here is pure over rows already in this browser (plays.js
// `devicePlays`). No server table, no server call, nothing written anywhere: a chart is a reading, not a record. The
// labels a player hands back for its own ids (`PLAY_LABELS_TOPIC`, below) are held in memory while a chart is drawn and
// never kept.
//
// *** WHOSE PLAYS: THE SCREEN'S OWN, ONLY. *** Every row carries the `screen` it was played on (plays.js). A chart
// filters to the screen it is on - which belongs to one person - so a family device that shows two people's screens
// never shows one person's listening on the other's. Argued in modules/charts.js's header; on Mike's list.
//
// *** SPOTIFY IS LEFT OUT OF EVERY COUNT, BY DEFAULT. *** plays.js's header reads Spotify's Developer Policy as saying
// an app should not analyze Spotify Content to make "derived listenership metrics" (III.13) - which is what a chart
// counted here would be. So `countedSources` drops 'spotify' unless a caller names it on purpose, and the panel offers
// no Spotify choice. Spotify's own "top items" answer (an account's top artists and songs, which Spotify computes and
// may be shown) is the route for a Spotify chart; it is not built (it needs the history permission at Connect,
// modules/music.js `historyWanted`). [Reading of the terms carried from plays.js, not re-checked this session.]

import { playsOf, tally, PLAY_KIND, PLAY_LABELS_TOPIC } from './plays.js';
import { weekStart } from './points.js';
import { contrast } from './theme.js';

// ---------------------------------------------------------------------------------------------
// THE WINDOWS. Local calendar time, never UTC: "today" is the day of whoever is in front of the screen (the same rule
// scoreboard.js `localDay` and points.js `dayKey` follow). A week starts on MONDAY - points.js `weekStart`, so "this
// week" means the same days on a chart as on the scoreboard. [Hard-coded with the scoreboard; a Sunday start is one
// line there and would move both together.]
// ---------------------------------------------------------------------------------------------
export const WINDOWS = Object.freeze(['today', 'week', 'month', 'all']);
export const WINDOW_WORDS = Object.freeze({ today: 'today', week: 'this week', month: 'this month', all: 'all time' });

/** `{ since, until }` in ms for a window at `now` (until is null: up to now). `all` has no `since`. Pure. */
export function windowRange(win, now = Date.now()) {
  const w = WINDOWS.includes(win) ? win : 'week';
  if (w === 'all') return { since: null, until: null };
  const d = new Date(now);
  if (w === 'today') { d.setHours(0, 0, 0, 0); return { since: d.getTime(), until: null }; }
  if (w === 'week') return { since: weekStart(now), until: null };
  d.setHours(0, 0, 0, 0); d.setDate(1);
  return { since: d.getTime(), until: null };
}

// ---------------------------------------------------------------------------------------------
// THE SOURCES - which players' plays are counted. Any id-shaped word can be a source (plays.js); these are the ones a
// person picks from, by name. 'all' is every source on the screen EXCEPT those in LEFT_OUT (Spotify, see the header).
// ---------------------------------------------------------------------------------------------
export const SOURCE_WORDS = Object.freeze({
  youtube: 'YouTube', spotify: 'Spotify', folder: 'Music from folders', photos: 'Photos',
  personal: 'Personal videos', educational: 'Learning videos', interstitials: 'Between videos',
});
export const WHAT_CHOICES = Object.freeze(['all', 'youtube', 'folder', 'photos', 'personal']);
export const LEFT_OUT = Object.freeze(['spotify']);

export const sourceWord = (s) => SOURCE_WORDS[s] || (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : 'Unknown');

/** The play rows a chart counts: this window, these sources, this screen. `screen` null means no screen filter (a
 *  caller that has no screen passes none - modules/charts.js never does). Oldest first. Pure. */
export function countedPlays(events, { win = 'week', what = 'all', screen = null, now = Date.now(),
  leftOut = LEFT_OUT } = {}) {
  const { since, until } = windowRange(win, now);
  const rows = playsOf(events, { since, until, screen: screen || null });
  if (what && what !== 'all') return rows.filter((e) => e.data.source === what);
  return rows.filter((e) => !(leftOut || []).includes(e.data.source));
}

// ---------------------------------------------------------------------------------------------
// LABELS. A row keeps a title only where the source's terms allow (plays.js `keepText`: folders). Otherwise the name
// is looked up WHEN IT IS DRAWN: a player on the screen answers for its own ids (`PLAY_LABELS_TOPIC`; YouTube answers
// from its playlist), and failing that the id is shown as plainly as it can be - a file's name without its folder or
// extension, or "YouTube video <id>".
// ---------------------------------------------------------------------------------------------
export { PLAY_LABELS_TOPIC };

const baseName = (id) => {
  const s = String(id || '');
  const tail = s.split(/[\\/]/).pop() || s;
  if (tail === s && !/\.[a-z0-9]{2,4}$/i.test(s)) return '';
  return tail.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ').trim();
};
const ITEM_WORDS = Object.freeze({ youtube: 'YouTube video', photos: 'Photo', personal: 'Video', folder: 'Song',
  educational: 'Learning video', interstitials: 'Video' });

/** The words for one tallied row. `labels` is a Map (or object) of `${source}:${id}` -> name. Pure. */
export function labelFor(row, { by = 'id', labels = null } = {}) {
  if (!row) return '';
  if (by === 'source') return sourceWord(row.key);
  if (by === 'by') return String(row.key || '');
  const key = `${row.source}:${row.key}`;
  const looked = labels ? (typeof labels.get === 'function' ? labels.get(key) : labels[key]) : null;
  if (row.label && row.label !== row.key) return row.label;
  if (looked) return String(looked);
  const file = baseName(row.key);
  if (file) return file;
  return `${ITEM_WORDS[row.source] || sourceWord(row.source)} ${row.key}`;
}

// ---------------------------------------------------------------------------------------------
// THE QUESTIONS
// ---------------------------------------------------------------------------------------------
export const COUNT_BY = Object.freeze(['item', 'source', 'by']);
const tallyField = (count) => (count === 'source' ? 'source' : count === 'by' ? 'by' : 'id');

/**
 * TOP-N: the most played, most first. `count`: 'item' (each song, video or photo), 'source' (which player), 'by' (the
 * artist or channel, where one was kept). Rows: [{ key, label, value, source, last }]. `top` 0 = every row. Pure.
 */
export function topPlays(events, { win = 'week', what = 'all', count = 'item', top = 5, screen = null,
  now = Date.now(), labels = null, leftOut = LEFT_OUT } = {}) {
  const rows = countedPlays(events, { win, what, screen, now, leftOut });
  const by = tallyField(count);
  return tally(rows, { by, top }).map((r) => ({ ...r, label: labelFor(r, { by: by === 'id' ? 'id' : by, labels }) }));
}

/** The top N, and everything past it as one more row ("Everything else") - so a pie still adds up to the whole. */
export function withRest(allRows, top, { restLabel = 'Everything else' } = {}) {
  const list = Array.isArray(allRows) ? allRows : [];
  const n = Math.max(0, Number(top) | 0);
  if (!n || list.length <= n) return list.slice();
  const rest = list.slice(n).reduce((s, r) => s + (Number(r.value) || 0), 0);
  return [...list.slice(0, n), { key: '__rest', label: restLabel, value: rest, source: null, rest: true }];
}

/** How many plays in the window. Pure. */
export function totalPlays(events, opts = {}) { return countedPlays(events, opts).length; }

// ---------------------------------------------------------------------------------------------
// ONE NUMBER (row 2.62, step 3: "the data source kind in automation, so any existing setting can follow data").
// automation.js's "what's been played" source asks one of these and drives a setting with the answer. Same windows,
// same sources, same screen filter and the same Spotify rule as every chart here, so a lamp that follows "plays this
// week" and a chart of "plays this week" can never disagree. Always a finite number: an empty device is 0, never NaN.
//   plays  how many plays                           ("plays today", "YouTube plays this week")
//   top    how many times the most played thing played
//   items  how many different things played
// ---------------------------------------------------------------------------------------------
export const NUMBER_QUERIES = Object.freeze(['plays', 'top', 'items']);
export const NUMBER_WORDS = Object.freeze({
  plays: 'How many plays',
  top: 'Plays of the most played thing',
  items: 'How many different things played',
});

/** The answer to one NUMBER_QUERIES question over these rows. Pure; 0 for nothing, never NaN. */
export function playNumber(events, { query = 'plays', win = 'week', what = 'all', screen = null, now = Date.now(),
  leftOut = LEFT_OUT } = {}) {
  const rows = countedPlays(events, { win, what, screen, now, leftOut });
  const q = NUMBER_QUERIES.includes(query) ? query : 'plays';
  if (q === 'plays') return rows.length;
  const groups = tally(rows, { by: 'id' });
  if (q === 'items') return groups.length;
  const n = Number(groups[0]?.value);
  return Number.isFinite(n) ? n : 0;
}

/** The question in words, for a list of what drives what: "plays this week", "YouTube: different things played today". */
export function playNumberWords({ query = 'plays', win = 'week', what = 'all' } = {}) {
  const q = NUMBER_QUERIES.includes(query) ? query : 'plays';
  const w = WINDOWS.includes(win) ? win : 'week';
  const head = q === 'top' ? 'plays of the most played thing' : q === 'items' ? 'different things played' : 'plays';
  const t = `${head} ${w === 'all' ? 'of all time' : WINDOW_WORDS[w]}`;
  return what && what !== 'all' ? `${sourceWord(what)}: ${t}` : t;
}

/**
 * COUNTS OVER TIME: plays per bucket across the window, every bucket present (a day with none is a 0, not a gap).
 *   today -> each hour up to now; week, month -> each day up to today; all -> each month from the first play.
 * Returns { unit: 'hour'|'day'|'month', buckets: [{ key, label, long, value }] }. Pure.
 */
export function playsOverTime(events, { win = 'week', what = 'all', screen = null, now = Date.now(),
  leftOut = LEFT_OUT } = {}) {
  const rows = countedPlays(events, { win, what, screen, now, leftOut });
  const p = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];
  const hourWords = (h) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
  const counts = new Map();
  const add = (k) => counts.set(k, (counts.get(k) || 0) + 1);
  const at = (e) => new Date(Date.parse(e.created_at));
  const w = WINDOWS.includes(win) ? win : 'week';
  const end = new Date(now);
  const buckets = [];
  if (w === 'today') {
    for (const e of rows) add(at(e).getHours());
    for (let h = 0; h <= end.getHours(); h += 1) {
      buckets.push({ key: String(h), label: hourWords(h), long: `from ${hourWords(h)}`, value: counts.get(h) || 0 });
    }
    return { unit: 'hour', buckets };
  }
  if (w === 'week' || w === 'month') {
    const dayKey = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    for (const e of rows) add(dayKey(at(e)));
    const d = new Date(windowRange(w, now).since);
    const last = dayKey(end);
    for (let guard = 0; guard < 32; guard += 1) {
      const k = dayKey(d);
      buckets.push({ key: k, label: w === 'week' ? DAYS[d.getDay()] : String(d.getDate()),
        long: `${LONG_DAYS[d.getDay()]} ${LONG_MONTHS[d.getMonth()]} ${d.getDate()}`, value: counts.get(k) || 0 });
      if (k === last) break;
      d.setDate(d.getDate() + 1);
    }
    return { unit: 'day', buckets };
  }
  const monthKey = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
  for (const e of rows) add(monthKey(at(e)));
  if (!rows.length) return { unit: 'month', buckets: [] };
  // The earliest play, whatever order the rows came in (two panels' records are each in order, not together).
  const d = new Date(Math.min(...rows.map((e) => Date.parse(e.created_at)).filter(Number.isFinite)));
  d.setDate(1); d.setHours(0, 0, 0, 0);
  const last = monthKey(end);
  for (let guard = 0; guard < 600; guard += 1) {
    const k = monthKey(d);
    buckets.push({ key: k, label: MONTHS[d.getMonth()], long: `${LONG_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      value: counts.get(k) || 0 });
    if (k === last) break;
    d.setMonth(d.getMonth() + 1);
  }
  return { unit: 'month', buckets };
}

// ---------------------------------------------------------------------------------------------
// THE CHART AS DATA: one model every way of showing it reads - the drawing, the table, the spoken answer.
// ---------------------------------------------------------------------------------------------
export const SHOW_AS = Object.freeze(['bar', 'line', 'pie', 'number', 'list']);
export const SHOW_WORDS = Object.freeze({ bar: 'Bars', line: 'A line over time', pie: 'A pie', number: 'One number',
  list: 'A list' });

// EVERY VALUE HERE IS A DEFAULT, a setting on the panel (modules/charts.js argues each):
//   show 'bar'      the top few, longest bar first: the quickest of the five to read across a room
//   what 'all'      every player on the screen (but Spotify, see the header)
//   count 'item'    each song, video or photo - "what did I play most" is about things, not players
//   win 'week'      Mike's own example ("top played albums/artists of the week")
//   top 5           five rows fit a quarter panel at a readable size; a sixth is a scroll on a small screen
//   sayTop 3        three is what a listener holds in mind from one spoken answer
export const CHART_DEFAULTS = Object.freeze({ show: 'bar', what: 'all', count: 'item', win: 'week', top: 5, sayTop: 3 });

/** Settings as given, made safe: an unknown value is its default. Pure. */
export function normalizeChart(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  return {
    show: pick(r.show, SHOW_AS, CHART_DEFAULTS.show),
    what: typeof r.what === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(r.what) ? r.what : CHART_DEFAULTS.what,
    count: pick(r.count, COUNT_BY, CHART_DEFAULTS.count),
    win: pick(r.win, WINDOWS, CHART_DEFAULTS.win),
    top: int(r.top, 1, 20, CHART_DEFAULTS.top),
    sayTop: int(r.sayTop, 1, 10, CHART_DEFAULTS.sayTop),
  };
}

/** The chart's name, in words: "Top played this week", "YouTube: plays each day this month". Pure. */
export function chartTitle(settings) {
  const s = normalizeChart(settings);
  const when = WINDOW_WORDS[s.win];
  const whenTail = s.win === 'all' ? ', all time' : ` ${when}`;
  let t;
  if (s.show === 'line') {
    const each = s.win === 'today' ? 'each hour' : s.win === 'all' ? 'each month' : 'each day';
    t = `Plays ${each}${whenTail}`;
  } else if (s.show === 'number') {
    t = `Plays${whenTail}`;
  } else if (s.count === 'source') {
    t = `What played, by kind,${whenTail}`;
  } else if (s.count === 'by') {
    t = `Top artists and channels${whenTail}`;
  } else {
    t = `Top played${whenTail}`;
  }
  return s.what !== 'all' ? `${sourceWord(s.what)}: ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t;
}

const plural = (n, one = 'play', many = 'plays') => `${n} ${n === 1 ? one : many}`;

/**
 * The model: { settings, title, kind, rows?, series?, total, empty, emptyText }.
 *   bar / list  rows = the top N
 *   pie         rows = the top N, then "Everything else" (so it adds up to the whole)
 *   line        series = playsOverTime
 *   number      total
 */
export function chartModel(events, settings = {}, { screen = null, now = Date.now(), labels = null } = {}) {
  const s = normalizeChart(settings);
  const base = { win: s.win, what: s.what, screen, now };
  const total = totalPlays(events, base);
  const title = chartTitle(s);
  const when = s.win === 'all' ? 'yet' : WINDOW_WORDS[s.win];
  const emptyText = s.count === 'by' && s.show !== 'line' && s.show !== 'number' && total
    ? 'None of these plays kept an artist or a channel. Only music from folders keeps one today.'
    : `Nothing has played ${when}.`;
  const out = { settings: s, title, kind: s.show, total, emptyText };
  if (s.show === 'number') return { ...out, empty: false };
  if (s.show === 'line') {
    const series = playsOverTime(events, base);
    return { ...out, series, empty: !total };
  }
  const all = topPlays(events, { ...base, count: s.count, top: 0, labels });
  const rows = s.show === 'pie' ? withRest(all, s.top) : all.slice(0, s.top);
  return { ...out, rows, empty: !rows.length, more: Math.max(0, all.length - s.top) };
}

// ---------------------------------------------------------------------------------------------
// THE READING: every chart as a plain table (for a screen reader, and for "Show as a list"), and as words (for the
// voice). Same numbers as the drawing, from the same model, so the three cannot disagree.
// ---------------------------------------------------------------------------------------------
/** { caption, head: [a, b], rows: [[label, value-words]] }. Pure. */
export function chartTable(model) {
  const m = model || {};
  if (m.kind === 'number') return { caption: m.title, head: ['', 'Plays'], rows: [[m.title, String(m.total || 0)]] };
  if (m.kind === 'line') {
    const unit = m.series?.unit;
    const head = [unit === 'hour' ? 'Hour' : unit === 'month' ? 'Month' : 'Day', 'Plays'];
    return { caption: m.title, head, rows: (m.series?.buckets || []).map((b) => [b.long || b.label, String(b.value)]) };
  }
  const head = [m.settings?.count === 'source' ? 'Kind' : m.settings?.count === 'by' ? 'Artist or channel' : 'What played', 'Plays'];
  const sum = (m.rows || []).reduce((n, r) => n + (Number(r.value) || 0), 0);
  return { caption: m.title, head, rows: (m.rows || []).map((r, i) => {
    const pct = m.kind === 'pie' && sum ? ` (${Math.round((r.value / sum) * 100)}%)` : '';
    return [r.rest ? r.label : `${i + 1}. ${r.label}`, `${r.value}${pct}`];
  }) };
}

/**
 * THE SPOKEN ANSWER: "This week, the most played was X, 5 plays; then Y, 3 plays; then Z, 2 plays." At most `limit`
 * rows (the panel's "how many it says"). A line or a number says its total and its busiest stretch. Pure.
 */
export function spokenAnswer(model, { limit = CHART_DEFAULTS.sayTop } = {}) {
  const m = model || {};
  const s = m.settings || CHART_DEFAULTS;
  const when = s.win === 'all' ? 'Of all time' : WINDOW_WORDS[s.win].charAt(0).toUpperCase() + WINDOW_WORDS[s.win].slice(1);
  const from = s.what && s.what !== 'all' ? ` on ${sourceWord(s.what)}` : '';
  if (m.kind === 'number' || m.kind === 'line') {
    if (!m.total) return `Nothing has played${from} ${s.win === 'all' ? 'yet' : WINDOW_WORDS[s.win]}.`;
    let busiest = '';
    if (m.kind === 'line') {
      const top = (m.series?.buckets || []).reduce((a, b) => (b.value > (a?.value ?? -1) ? b : a), null);
      if (top && top.value) busiest = ` The most was ${top.long || top.label}, ${plural(top.value)}.`;
    }
    return `${when}, ${plural(m.total)}${from}.${busiest}`;
  }
  const rows = (m.rows || []).filter((r) => !r.rest).slice(0, Math.max(1, Number(limit) | 0));
  if (!rows.length) return m.emptyText || 'Nothing has played yet.';
  const what = s.count === 'source' ? 'the most played kind' : s.count === 'by' ? 'the most played artist or channel'
    : 'the most played';
  const [first, ...rest] = rows;
  const tail = rest.map((r) => `then ${r.label}, ${plural(r.value)}`).join('; ');
  return `${when}${from}, ${what} was ${first.label}, ${plural(first.value)}${tail ? `; ${tail}` : ''}.`;
}

// ---------------------------------------------------------------------------------------------
// COLOURS THAT READ ON THE THEME: the chart sits on the theme's own `--surface` (so it reads on a clear panel over a
// moving scene), and a bar or a line is drawn in the first of these theme tokens that stands out from that surface by
// at least 3:1 (WCAG's line for a shape someone has to see). The rest, in order, colour a pie's slices. Meaning never
// rides on colour alone: every slice is numbered, and the legend and the table say what each is.
// ---------------------------------------------------------------------------------------------
export const SERIES_TOKENS = Object.freeze(['--link', '--accent', '--text-strong', '--accent-warm-deep', '--text-muted',
  '--accent-warm', '--text-soft']);
export const SHAPE_MIN = 3;

/** The tokens that clear 3:1 against `--surface` in `vars` - with normal vision AND simulated deuteranopia, the same
 *  two floors theme.js holds every ring to - in order; the first is the main series. Pure. A value that is not a hex
 *  colour (or a surface that is not) is kept in order, unjudged, so a theme written another way still draws. */
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export function seriesColours(vars = {}, { tokens = SERIES_TOKENS, min = SHAPE_MIN } = {}) {
  const surface = String(vars['--surface'] || '').trim();
  const out = [];
  for (const t of tokens) {
    const v = String(vars[t] || '').trim();
    if (!v) continue;
    if (!HEX_RE.test(v) || !HEX_RE.test(surface)) { out.push({ token: t, value: v, contrast: null }); continue; }
    const c = Math.min(contrast(v, surface), contrast(v, surface, { deutan: true }));
    if (c >= min) out.push({ token: t, value: v, contrast: c });
  }
  return out;
}

export { PLAY_KIND };
