// modules/play_objects.js — WHAT PLAYED ON THIS SCREEN, AS THINGS IN A ROOM: A STACK OF BRICKS, A PIE, POSTERS ON THE WALL.
// Row 2.62 step 4. Mike, 2026-10-07: *"Stacks of objects for bar graphs, an actual pie for a pie chart, posters on the wall
// with your top played albums/artists of the week, whatever else anyone can think of."*
//
// *** WHY A MODULE, NOT A NEW KIND OF ROOM ITEM. *** Argued:
//   FOR a room item (a `kind: 'stack'` in the recipe, drawn by room_scene.js): it would be furniture like a sofa, with no
//   panel around it. AGAINST, and it wins: a recipe item has no settings, no state row and no way to be added - a room's
//   recipe has no "add" list at all - and the 3D room would need it built a second time. A MODULE placed in a room gets
//   all of that for nothing: Home's Add tray adds it (on a room it lands on the wall, home_profile.js `addToLayout`),
//   Move / Bigger / Transform place it, the ⚙ menu has its settings, the switch lap reaches it, the 2D and the 3D room
//   both hold it, and a flat dashboard shows it too. It is drawn with NO PANEL AROUND IT (it starts with its own panel
//   background set to clear, `pieceState`), so on a wall it is an object, not a card.
// *** WHY ONE MODULE WITH A "SHAPE", NOT THREE. *** The Charts module's reason (modules/charts.js header): all three answer
// the same question with the same settings and read the same table aloud. The Add tray still offers each by name
// (home_profile.js ADD_READY: "Top played this week: a stack of bricks" ...), so nobody has to find the setting.
// *** WHY NOT A "SHOW AS" ON CHARTS. *** Charts is a panel to READ (a title, buttons, a card); these are objects to LOOK AT
// across a room, with one press for the reading. Putting both behind one setting would give the chart's buttons to a pie
// on a wall, or take them from the chart.
//
// THE SAME DATA AS CHARTS, EXACTLY: play_charts.js `chartModel` (this screen's own plays, Spotify left out - its developer
// rules on listening statistics - the same windows and the same names), and the same reading: a real <table> a screen
// reader reads, the same sentence spoken (`spokenAnswer`). NO COVER ART AND NO THUMBNAILS: Spotify's and YouTube's rules on
// showing them are unchecked (row 2.62), so a poster carries a NAME and a count, in text, and nothing else.
//
// THE STACK IS BUILT FROM THE PRINTED BRICK (row 2.51: "the site's 3D assets come from the 3D-printing models"): each block
// is the published 40 mm cube brick's picture (design-assets/bricks, the same render the bricks page shows), tinted with the
// theme. "Drawn" (a setting, or by itself if the picture will not load) draws a plain cube in the same place instead.
//
// *** COST ON A PI 400 (each number argued below, on Mike's list). *** Nothing here animates and nothing runs per frame:
// the drawing is rebuilt only when the ANSWER changes (a play lands, or the once-a-minute re-read finds something new),
// and a re-read whose answer is the same touches no element at all. Bounded: at most MAX_ITEMS things, MAX_BLOCKS bricks a
// stack (so at most 60 bricks, as <use> copies of ONE picture under ONE tint), one SVG, no images of its own.
//
// ONE PRESS FOR THE READING. The whole object is one button: pressing it (a pointer, Enter, or `select` from a switch)
// says the answer aloud and shows it as a list over the object; pressing again puts the list away, and it goes by itself
// after READING_MS. Nothing waits on it either way.

import { registerModule } from '../module.js';
import { devicePlays } from '../plays.js';
import {
  chartModel, chartTable, spokenAnswer, normalizeChart, seriesColours, SERIES_TOKENS, CHART_DEFAULTS,
  WINDOWS, WINDOW_WORDS, WHAT_CHOICES, sourceWord, PLAY_LABELS_TOPIC,
} from '../play_charts.js';
import { examplePlays } from './charts.js';
import { buildUrls } from '../brick_builds.js';

// ---------------------------------------------------------------------------------------------
// THE NUMBERS. Rule 1: each argued; the ones a person would change are settings below.
//   MAX_ITEMS 6     how many things one object shows, whatever "How many" says. A wall of posters reads as 2 rows of 3
//                   from across a room; a pie past 6 slices (+ "Everything else") has slivers too thin to number and runs
//                   out of theme colours that clear 3:1 (play_charts.js seriesColours finds 3-6 on most themes); six
//                   stacks keep each brick wide enough to see. A 7th is in the reading, never lost.
//   MAX_BLOCKS 10   the tallest stack, in bricks. Ten is still countable at a glance; past it a stack is a wall. With 6
//                   stacks that bounds the drawing at 60 bricks on a Pi. When the most played thing would need more,
//                   each brick stands for more plays (BLOCK_STEPS), and the object says how many ("1 brick = 5 plays").
//   BLOCK_STEPS     1, 2, 5, 10, 20, 50 ... - the steps a person reads without arithmetic (a ruler's), smallest that fits.
//   READING_MS 60000 the list shown over the object goes by itself after a minute nobody touched it: the room's own lifted
//                   panel's time (room_scene.js liftReturnMs), so the two "look closer" things behave alike.
//   REFRESH_MS 60000 charts.js's: the device's record is read again once a minute (another tab's plays; midnight).
// ---------------------------------------------------------------------------------------------
export const MAX_ITEMS = 6;
export const MAX_BLOCKS = 10;
export const BLOCK_STEPS = Object.freeze([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]);
export const READING_MS = 60 * 1000;
export const REFRESH_MS = 60 * 1000;
export const PER_BLOCK_CHOICES = Object.freeze(['auto', '1', '2', '5', '10']);

export const SHAPES = Object.freeze(['stack', 'pie', 'posters']);
export const SHAPE_WORDS = Object.freeze({ stack: 'A stack of bricks for each', pie: 'A pie', posters: 'Posters on the wall' });
const SHAPE_SHORT = Object.freeze({ stack: 'a stack of bricks', pie: 'a pie', posters: 'posters' });

// Defaults: Charts' own (what, count, window, how many, how many said), so the same question gives the same answer, and
// a stack (the "bar chart" of things), built from the printed brick. A new object is "Top played this week".
export const OBJECT_DEFAULTS = Object.freeze({ shape: 'stack', what: CHART_DEFAULTS.what, count: CHART_DEFAULTS.count,
  win: CHART_DEFAULTS.win, top: CHART_DEFAULTS.top, sayTop: CHART_DEFAULTS.sayTop, perBlock: 'auto', look: 'bricks' });

/** Settings as given, made safe: an unknown value is its default; `top` never above MAX_ITEMS. Pure. */
export function normalizeObjects(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = normalizeChart({ ...OBJECT_DEFAULTS, ...r, show: 'bar' });
  return {
    shape: SHAPES.includes(r.shape) ? r.shape : OBJECT_DEFAULTS.shape,
    what: c.what, count: c.count, win: c.win, top: Math.min(MAX_ITEMS, c.top), sayTop: c.sayTop,
    perBlock: PER_BLOCK_CHOICES.includes(String(r.perBlock)) ? String(r.perBlock) : OBJECT_DEFAULTS.perBlock,
    look: r.look === 'drawn' ? 'drawn' : 'bricks',
  };
}

/** Plays one brick stands for: the person's choice, or ('auto') the smallest BLOCK_STEPS that keeps the most played
 *  thing to MAX_BLOCKS bricks. Pure. */
export function playsPerBlock(maxValue, perBlock = 'auto') {
  const chosen = Number(perBlock);
  if (perBlock !== 'auto' && Number.isFinite(chosen) && chosen >= 1) {
    // A chosen size still never builds past MAX_BLOCKS: past it, the next step that fits.
    if (Math.ceil((Number(maxValue) || 0) / chosen) <= MAX_BLOCKS) return chosen;
  }
  const m = Math.max(0, Number(maxValue) || 0);
  return BLOCK_STEPS.find((s) => Math.ceil(m / s) <= MAX_BLOCKS) || Math.ceil(m / MAX_BLOCKS) || 1;
}

/**
 * The object's model: play_charts.js `chartModel` (a pie's rows with "Everything else", so it adds up), plus for a stack
 * each row's `blocks` (rounded UP: anything played shows at least one brick) and `per`, the plays a brick stands for.
 */
export function objectModel(events, settings = {}, { screen = null, now = Date.now(), labels = null } = {}) {
  const s = normalizeObjects(settings);
  const m = chartModel(events, { what: s.what, count: s.count, win: s.win, top: s.top, sayTop: s.sayTop,
    show: s.shape === 'pie' ? 'pie' : 'bar' }, { screen, now, labels });
  const rows = (m.rows || []).filter((r) => r && r.value > 0);
  const out = { ...m, rows, shape: s.shape, objects: s };
  if (s.shape !== 'stack') return out;
  const per = playsPerBlock(Math.max(0, ...rows.map((r) => r.value)), s.perBlock);
  return { ...out, per, rows: rows.map((r) => ({ ...r, blocks: Math.min(MAX_BLOCKS, Math.max(1, Math.ceil(r.value / per))) })) };
}

/** "1 brick = 1 play", "1 brick = 5 plays (rounded up)". Pure. */
export const brickKey = (per) => (per === 1 ? '1 brick = 1 play' : `1 brick = ${per} plays, rounded up`);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const pc = (i) => `var(--po-${i + 1}, var(${SERIES_TOKENS[i % SERIES_TOKENS.length]}))`;
/** A name in at most two lines of about `width` characters, for under a stack. Pure. */
export function twoLines(text, width = 14) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if (`${cur} ${w}`.length <= width) lines[lines.length - 1] = `${cur} ${w}`;
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = `${lines[1]} ${w}`; break; }
  }
  return lines.map((l) => clip(l, width + 2));
}

// ---------------------------------------------------------------------------------------------
// THE DRAWINGS (pure: a model in, markup out; `uid` keeps two objects' ids apart on one page). Every colour is a theme
// token. The drawing is a picture of the reading, so it is aria-hidden; the table is what is read.
// ---------------------------------------------------------------------------------------------
// The brick picture's proportions (design-assets/bricks/renders/brick_40x40x40_v1_sm.png, 128 px, measured): its upright
// edges are 71 of its 128 px, so a brick stacked on another sits 0.555 of a brick higher - the next one's foot on the
// last one's top. Geometry of the published render, not a preference; a new render would mean a new number here.
export const BRICK_RISE = 0.555;
const B = 100, STEP = B * BRICK_RISE, CW = 140, TOP_PAD = 44, LABEL_H = 64;
export const BRICK_URL = buildUrls('brick_40x40x40_v1').small;

const shade = (uid) => `<filter id="po-shade1-${uid}" color-interpolation-filters="sRGB"><feComponentTransfer>`
  + '<feFuncR type="linear" slope=".8"/><feFuncG type="linear" slope=".8"/><feFuncB type="linear" slope=".8"/></feComponentTransfer></filter>'
  + `<filter id="po-shade2-${uid}" color-interpolation-filters="sRGB"><feComponentTransfer>`
  + '<feFuncR type="linear" slope=".62"/><feFuncG type="linear" slope=".62"/><feFuncB type="linear" slope=".62"/></feComponentTransfer></filter>';

export function stackSvg(model, { uid = 'x', look = 'bricks', brickUrl = BRICK_URL } = {}) {
  const rows = (model?.rows || []).filter((r) => r && r.blocks > 0);
  if (!rows.length) return '';
  const most = Math.max(...rows.map((r) => r.blocks));
  const W = rows.length * CW;
  const H = TOP_PAD + B + (most - 1) * STEP + 8 + LABEL_H;
  const foot = H - LABEL_H - 8 - B;                        // the top-left of each stack's bottom brick
  const at = (i, j) => ({ x: i * CW + (CW - B) / 2, y: foot - j * STEP });
  let bricks = '';
  let tops = '', lefts = '', rights = '';
  const texts = [];
  rows.forEach((r, i) => {
    for (let j = 0; j < r.blocks; j += 1) {
      const { x, y } = at(i, j);
      if (look === 'bricks') bricks += `<use href="#po-brick-${uid}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${B}" height="${B}"/>`;
      else {
        // A drawn cube in the brick's own proportions: top 38, upright 55.5 (see BRICK_RISE).
        const p = (pts) => pts.map(([a, b]) => `${(x + a).toFixed(1)},${(y + b).toFixed(1)}`).join(' ');
        tops += `<polygon points="${p([[50, 0], [100, 19], [50, 38], [0, 19]])}"/>`;
        lefts += `<polygon points="${p([[0, 19], [50, 38], [50, 93.5], [0, 74.5]])}"/>`;
        rights += `<polygon points="${p([[100, 19], [50, 38], [50, 93.5], [100, 74.5]])}"/>`;
      }
    }
    const top = at(i, r.blocks - 1);
    const cx = i * CW + CW / 2;
    texts.push(`<text x="${cx}" y="${(top.y - 10).toFixed(1)}" text-anchor="middle" class="po-svg-value">${r.value}</text>`);
    const [l1, l2] = twoLines(`${i + 1}. ${r.label}`);
    texts.push(`<text x="${cx}" y="${H - LABEL_H + 26}" text-anchor="middle" class="po-svg-label">${esc(l1)}</text>`);
    if (l2) texts.push(`<text x="${cx}" y="${H - LABEL_H + 54}" text-anchor="middle" class="po-svg-label">${esc(l2)}</text>`);
  });
  const defs = look === 'bricks'
    ? `<defs><image id="po-brick-${uid}" href="${esc(brickUrl)}" width="${B}" height="${B}" preserveAspectRatio="xMidYMid meet"/>`
      + `<filter id="po-tint-${uid}" color-interpolation-filters="sRGB"><feFlood style="flood-color:${pc(0)}" result="c"/>`
      + '<feComposite in="c" in2="SourceAlpha" operator="in" result="t"/><feBlend in="t" in2="SourceGraphic" mode="multiply"/></filter></defs>'
    : `<defs>${shade(uid)}</defs>`;
  const body = look === 'bricks'
    ? `<g class="po-bricks" filter="url(#po-tint-${uid})">${bricks}</g>`
    : `<g class="po-cubes" fill="${pc(0)}">${tops}<g filter="url(#po-shade1-${uid})">${lefts}</g><g filter="url(#po-shade2-${uid})">${rights}</g></g>`;
  return `<svg class="po-svg" viewBox="0 0 ${W} ${H.toFixed(1)}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false" data-look="${look}">`
    + `${defs}${body}${texts.join('')}</svg>`;
}

/** A pie seen from above and in front: slices on top, the crust's edge in front, numbered like the legend. */
export function pieSvg3d(rows, { uid = 'x', colours = 3 } = {}) {
  const list = (rows || []).filter((r) => r && r.value > 0);
  const sum = list.reduce((n, r) => n + r.value, 0);
  if (!sum) return '';
  const cx = 160, cy = 96, rx = 150, ry = 86, D = 34;
  const n = Math.max(1, Number(colours) | 0);
  const P = (a, dy = 0) => [cx + rx * Math.cos(a), cy + ry * Math.sin(a) + dy];
  const f = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const fill = (r, i) => (r.rest ? 'var(--surface-alt)' : pc(i % n));
  let a0 = -Math.PI / 2;
  const sides = [], tops = [], nums = [];
  list.forEach((r, i) => {
    const frac = r.value / sum;
    const a1 = a0 + frac * Math.PI * 2;
    // The front of the pie is where the slice's edge faces you: angles 0..PI (below the middle, in screen terms).
    const s0 = Math.max(a0, 0), s1 = Math.min(a1, Math.PI);
    if (s1 > s0) {
      sides.push(`<path d="M${f(P(s0))} A${rx},${ry} 0 0 1 ${f(P(s1))} L${f(P(s1, D))} A${rx},${ry} 0 0 0 ${f(P(s0, D))} Z" fill="${fill(r, i)}"/>`);
    }
    if (frac >= 0.9999) tops.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill(r, i)}" class="po-slice${r.rest ? ' po-rest' : ''}"/>`);
    else {
      tops.push(`<path d="M${cx},${cy} L${f(P(a0))} A${rx},${ry} 0 ${frac > 0.5 ? 1 : 0} 1 ${f(P(a1))} Z" fill="${fill(r, i)}" class="po-slice${r.rest ? ' po-rest' : ''}"/>`);
    }
    const mid = (a0 + a1) / 2;
    if (!r.rest && frac >= 0.06) {
      const [lx, ly] = [cx + Math.cos(mid) * rx * 0.62, cy + Math.sin(mid) * ry * 0.62];
      nums.push(`<text x="${lx.toFixed(1)}" y="${(ly + 8).toFixed(1)}" text-anchor="middle" class="po-slice-num">${i + 1}</text>`);
    }
    a0 = a1;
  });
  const plate = `<ellipse cx="${cx}" cy="${cy + D + 6}" rx="${rx + 8}" ry="${ry + 6}" class="po-plate"/>`;
  return `<svg class="po-svg po-pie" viewBox="0 0 320 ${cy + ry + D + 16}" preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">`
    + `<defs>${shade(uid)}</defs>${plate}<g filter="url(#po-shade2-${uid})">${sides.join('')}</g>`
    + `<g>${tops.join('')}</g><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" class="po-crust"/>${nums.join('')}</svg>`;
}

export function pieLegendHtml(rows, { colours = 3 } = {}) {
  const list = (rows || []).filter((r) => r && r.value > 0);
  const sum = list.reduce((n, r) => n + r.value, 0);
  const n = Math.max(1, Number(colours) | 0);
  if (!sum) return '';
  return `<ol class="po-legend" aria-hidden="true">${list.map((r, i) => `<li><span class="po-sw${r.rest ? ' po-rest' : ''}" style="background:${r.rest ? 'var(--surface-alt)' : pc(i % n)}"></span>`
    + `<span class="po-leg-label">${r.rest ? '' : `${i + 1}. `}${esc(r.label)}</span>`
    + `<span class="po-leg-value">${r.value}</span></li>`).join('')}</ol>`;
}

/** The posters: a rank, a name and a count, in text. No art (see the header). */
export function postersHtml(rows) {
  const list = (rows || []).filter((r) => r && r.value > 0 && !r.rest);
  if (!list.length) return '';
  const cols = Math.min(3, list.length);
  return `<ol class="po-posters" aria-hidden="true" style="--po-cols:${cols}">${list.map((r, i) => `<li class="po-poster" data-rank="${i + 1}">`
    + `<span class="po-rank">${i + 1}</span><span class="po-name">${esc(r.label)}</span>`
    + `<span class="po-count">${r.value === 1 ? '1 play' : `${r.value} plays`}</span></li>`).join('')}</ol>`;
}

function tableHtml(model, { visible = false } = {}) {
  const t = chartTable(model);
  const body = t.rows.length
    ? t.rows.map(([a, b]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')
    : `<tr><td colspan="2">${esc(model.emptyText || 'Nothing has played yet.')}</td></tr>`;
  return `<table class="po-table${visible ? '' : ' po-sr'}"${visible ? ' aria-hidden="true"' : ' data-reading'}>`
    + `<caption>${esc(t.caption)}</caption>`
    + `<thead><tr><th scope="col">${esc(t.head[0])}</th><th scope="col">${esc(t.head[1])}</th></tr></thead>`
    + `<tbody>${body}</tbody></table>`;
}

// One check per picture per page: does the brick's picture load? (A stack whose picture will not load is drawn.)
const probes = new Map();
export function brickLoads(url = BRICK_URL) {
  if (probes.has(url)) return probes.get(url);
  const p = new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    } catch { resolve(false); }
  });
  probes.set(url, p);
  return p;
}

const SETTINGS = [
  { key: 'shape', label: 'Shown as', kind: 'choice', default: OBJECT_DEFAULTS.shape, level: 'essential',
    options: SHAPES.map((v) => ({ value: v, label: SHAPE_WORDS[v] })) },
  { key: 'what', label: 'Which plays', kind: 'choice', default: OBJECT_DEFAULTS.what, level: 'standard',
    note: 'Spotify plays are left out: Spotify’s developer rules say an app should not make listening statistics from them.',
    options: WHAT_CHOICES.map((v) => ({ value: v, label: v === 'all' ? 'Everything played on this screen' : sourceWord(v) })) },
  { key: 'count', label: 'Count each', kind: 'choice', default: OBJECT_DEFAULTS.count, level: 'standard',
    options: [{ value: 'item', label: 'Song, video or photo' }, { value: 'source', label: 'Kind (YouTube, photos, music …)' },
      { value: 'by', label: 'Artist or channel (where one was kept)' }] },
  { key: 'win', label: 'Over', kind: 'choice', default: OBJECT_DEFAULTS.win, level: 'standard',
    options: WINDOWS.map((v) => ({ value: v, label: v === 'all' ? 'All time' : WINDOW_WORDS[v].charAt(0).toUpperCase() + WINDOW_WORDS[v].slice(1) })) },
  { key: 'top', label: 'How many to show', kind: 'choice', default: OBJECT_DEFAULTS.top, level: 'standard',
    options: [1, 3, 5, MAX_ITEMS].map((n) => ({ value: n, label: String(n) })) },
  { key: 'perBlock', label: 'Plays for each brick', kind: 'choice', default: OBJECT_DEFAULTS.perBlock, level: 'advanced',
    help: 'Automatic keeps the tallest stack to ten bricks.',
    options: PER_BLOCK_CHOICES.map((v) => ({ value: v, label: v === 'auto' ? 'Automatic' : v === '1' ? '1 play' : `${v} plays` })) },
  { key: 'look', label: 'The bricks', kind: 'choice', default: OBJECT_DEFAULTS.look, level: 'advanced',
    help: 'Brick-built: the Nimrod brick, as it is printed. Drawn: a plain drawn cube.',
    options: [{ value: 'bricks', label: 'Brick-built' }, { value: 'drawn', label: 'Drawn' }] },
  { key: 'sayTop', label: 'How many it says aloud', kind: 'choice', default: OBJECT_DEFAULTS.sayTop, level: 'advanced',
    options: [1, 3, 5].map((n) => ({ value: n, label: String(n) })) },
];
export const OBJECT_SETTINGS = SETTINGS;

let uidSeq = 0;

registerModule(
  { type: 'play_objects', title: 'Plays as objects', core: 'new',
    description: 'What played on this screen as things in a room: a stack of bricks for each, a pie, or posters on the wall - read aloud on a press',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    const screen = ctx.profileId ? String(ctx.profileId) : null;
    const plays = ctx.plays || (screen ? devicePlays() : null);
    const brickUrl = typeof ctx.brickUrl === 'string' && ctx.brickUrl ? ctx.brickUrl : BRICK_URL;
    const uid = `${(uidSeq += 1).toString(36)}`;
    const labels = new Map();
    const asked = new Set();
    let cfg = normalizeObjects({});
    let rootEl = null;
    let dead = false;
    let timer = null, readTimer = null, queued = false;
    let off = null;
    let lastSpeech = null, lastSaid = '';
    let colours = 3;
    let reading = false;
    let brickOk = true;
    let sig = '';
    let renders = 0;               // how many times the drawing was rebuilt (a suite checks a same answer rebuilds nothing)

    const events = () => (plays ? plays.get().events || [] : examplePlays(now()));
    const model = () => objectModel(events(), cfg, { screen, now: now(), labels });

    function say(text) {
      lastSaid = text;
      if (!text || !ctx.output?.say) return;
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: 'play_objects' });
      } catch (e) { console.error('play_objects: say', e); }
    }

    function askLabels(m) {
      const want = {};
      for (const r of m.rows || []) {
        if (r.rest || !r.source || cfg.count !== 'item') continue;
        const key = `${r.source}:${r.key}`;
        if (asked.has(key) || labels.has(key)) continue;
        asked.add(key);
        (want[r.source] = want[r.source] || []).push(r.key);
      }
      if (!Object.keys(want).length) return;
      try {
        bus?.publish?.(PLAY_LABELS_TOPIC, { ids: want, answer: (source, map) => {
          if (dead || !map || typeof map !== 'object') return;
          let changed = false;
          for (const [id, name] of Object.entries(map)) {
            if (typeof name === 'string' && name.trim()) { labels.set(`${source}:${id}`, name.trim().slice(0, 200)); changed = true; }
          }
          if (changed) soon();
        } });
      } catch (e) { console.error('play_objects: labels', e); }
    }

    function paintColours() {
      try {
        const cs = getComputedStyle(rootEl);
        const vars = {};
        for (const t of ['--surface', ...SERIES_TOKENS]) vars[t] = cs.getPropertyValue(t).trim();
        if (!vars['--surface']) return;
        const ok = seriesColours(vars);
        colours = Math.max(1, Math.min(6, ok.length || 1));
        ok.slice(0, 6).forEach((c, i) => rootEl.style.setProperty(`--po-${i + 1}`, `var(${c.token})`));
      } catch { /* the CSS fallbacks draw it */ }
    }

    function drawing(m) {
      if (m.empty || !(m.rows || []).length) return `<p class="po-empty" data-empty>${esc(m.emptyText)}</p>`;
      if (m.shape === 'pie') return `<div class="po-pie-wrap">${pieSvg3d(m.rows, { uid, colours })}${pieLegendHtml(m.rows, { colours })}</div>`;
      if (m.shape === 'posters') return postersHtml(m.rows);
      return stackSvg(m, { uid, look: brickOk ? cfg.look : 'drawn', brickUrl });
    }

    /** Rebuild only when the answer (or how it is shown) changed; `force` for the reading's own toggle. */
    function render(force = false) {
      if (dead || !rootEl) return;
      paintColours();
      const m = model();
      const next = JSON.stringify([cfg, m.title, m.total, m.per || 0, (m.rows || []).map((r) => [r.key, r.label, r.value, r.blocks || 0]),
        colours, brickOk, !plays, reading, lastSaid]);
      askLabels(m);
      if (!force && next === sig) return;
      sig = next;
      renders += 1;
      const shapeWords = SHAPE_SHORT[m.shape];
      const example = plays ? '' : '<p class="po-note" data-example>An example, not real plays: on a screen, this shows that screen’s own plays.</p>';
      const key = m.shape === 'stack' && (m.rows || []).length ? `<p class="po-key" data-key>${esc(brickKey(m.per))}</p>` : '';
      const more = m.more && m.shape !== 'pie' ? `<p class="po-note" data-more>${m.more} more in the list.</p>` : '';
      rootEl.innerHTML = `
        <div class="po" data-play-objects data-shape="${esc(m.shape)}" data-reading-open="${reading ? '1' : '0'}">
          <p class="po-title" data-title aria-hidden="true">${esc(m.title)}</p>
          <div class="po-body" data-body>${drawing(m)}</div>
          ${key}${more}${example}
          ${tableHtml(m)}
          <div class="po-reading" data-reading-card${reading ? '' : ' hidden'}>${reading ? tableHtml(m, { visible: true }) : ''}</div>
          <button type="button" class="po-hit" data-act="press"
            aria-label="${esc(`${m.title}, as ${shapeWords}. Press to hear it and see it as a list.`)}"
            aria-expanded="${reading ? 'true' : 'false'}"></button>
          <p class="po-said" role="status" aria-live="polite" data-said>${esc(lastSaid)}</p>
        </div>`;
    }
    function soon() {
      if (queued || dead) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; render(); });
    }

    function hideReading() {
      if (readTimer != null) { clearTimeout(readTimer); readTimer = null; }
      if (!reading) return false;
      reading = false;
      render(true);
      return true;
    }
    /** The one press: say it and show the list; pressed again, put the list away. */
    function press() {
      if (dead) return;
      if (reading) { hideReading(); return; }
      reading = true;
      say(spokenAnswer(model(), { limit: cfg.sayTop }));
      render(true);
      if (readTimer != null) clearTimeout(readTimer);
      readTimer = setTimeout(() => { readTimer = null; hideReading(); }, READING_MS);
    }
    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act="press"]') : null;
      if (b && mount.contains(b)) press();
    }

    function applyState(s) {
      const snap = s || {};
      cfg = normalizeObjects(Object.fromEntries(SETTINGS.map((d) => [d.key, snap[d.key]]).filter(([, v]) => v !== undefined)));
    }
    function reload() {
      if (!plays || typeof plays.loadAll !== 'function') { render(); return; }
      Promise.resolve(plays.loadAll()).catch(() => {}).then(() => render());
    }

    return {
      __probe: () => ({ cfg: { ...cfg }, screen, example: !plays, reading, said: lastSaid, renders, brickOk, colours,
        model: model(), timers: [timer, readTimer].filter((t) => t != null).length }),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../play_objects.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-play-objects-css href="${esc(cssHref)}">` : ''}<div class="po-wrap" data-play-objects-root></div>`;
        rootEl = mount.querySelector('[data-play-objects-root]');
        mount.addEventListener('click', onClick);
        applyState(state?.get?.());
        state?.subscribe?.((s) => { if (dead) return; applyState(s); render(); });
        bus?.subscribe?.('play_objects/select', () => press());
        bus?.subscribe?.('play_objects/back', () => hideReading());
        if (plays && typeof plays.subscribe === 'function') off = plays.subscribe(() => soon());
        brickLoads(brickUrl).then((ok) => { if (dead || ok) return; brickOk = false; render(); });
        render();
        reload();
        timer = setInterval(reload, REFRESH_MS);
      },
      onResize() {},
      onShow() { reload(); },
      onHide() { hideReading(); try { state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        if (timer != null) { clearInterval(timer); timer = null; }
        if (readTimer != null) { clearTimeout(readTimer); readTimer = null; }
        try { typeof off === 'function' && off(); } catch { /* gone */ }
        mount.removeEventListener('click', onClick);
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
      },
    };
  },
);
