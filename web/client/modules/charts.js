// modules/charts.js — CHARTS OF WHAT PLAYED ON THIS SCREEN: bars, a line over time, a pie, one number, or a list.
// Row 2.62, step 2. Mike, 2026-10-07: *"It would be nice for people to be able to visualize Spotify/Youtube plays ...
// There should be a data visualization module or set of modules."*
//
// ONE MODULE WITH A "SHOW AS" CHOICE, NOT FIVE MODULES. Argued:
//   * FOR five (a Bar chart, a Pie chart ... each its own module): each is one word in the Modules list, and a person
//     looking for "a pie" finds it by name.
//   * FOR one (chosen): all five answer the SAME questions (which plays, counted how, over when) and read the same
//     table aloud, so five modules would be five copies of the same settings and the same reading, drifting apart.
//     Changing how it is shown is a setting on the panel already there - and "Next view" walks the ready-made ones -
//     rather than removing a panel and adding another. Row 2.53 says most people never wire anything: one panel that
//     starts as "Top played this week" and has a button to see it other ways is the smaller thing to learn.
//   The library's search finds it under "chart", "graph", "bars", "pie" (the catalog entry's lead).
//
// *** WHOSE PLAYS IT SHOWS: THIS SCREEN'S OWN, AND NOBODY ELSE'S. *** Every play on this device carries the screen it
// was played on (plays.js), and this panel counts only the rows for the screen it is on (`ctx.profileId`). Argued:
//   * FOR a wider view (every play on this device): a family tablet where everybody's music shares a chart; a poster
//     of "the house's top songs".
//   * AGAINST, and it wins as the default: a screen belongs to one person (plays.js header), and a shared device is
//     exactly where one person's listening would show on another's screen without either choosing it. Mike: who sees
//     a person's listening "falls under the blanket of a larger permission like media or data" with finer ones at the
//     advanced level - and that permission is not built. So this shows the screen's own, and a "this device's, all
//     screens" choice waits for that permission (on Mike's list). A person with two screens on ONE device sees each
//     screen's plays on that screen, not both together; a per-person total needs the person on the row (not there).
// With no screen at all (a page trying the module out), it shows an EXAMPLE, labelled as one, never the device's plays.
//
// SPOTIFY IS NOT COUNTED (play_charts.js header: its developer rules on listening statistics). No cover art, no
// thumbnails: the two services' rules on showing them are unchecked (row 2.62), so nothing here draws a picture of a
// song or a video.
//
// THE READING. Every chart is also a plain table (`<table>` in the panel: hidden from sight but read by a screen
// reader, and shown by "Show as a list"), and a sentence spoken aloud ("Say it", the first switch press, or
// "computer please, what played most" - actions.js CHART_ACTIONS). All three come from one model
// (play_charts.js `chartModel`), so the drawing, the table and the voice cannot disagree.
//
// NOTHING LEAVES THE DEVICE: it reads this browser's own record (plays.js `devicePlays`) and writes nothing but its own
// settings. Names for YouTube ids come from the YouTube panel on the screen (PLAY_LABELS_TOPIC), held in memory only.

import { registerModule } from '../module.js';
import { devicePlays } from '../plays.js';
import {
  chartModel, chartTable, spokenAnswer, normalizeChart, seriesColours, SERIES_TOKENS, CHART_DEFAULTS,
  WINDOWS, WINDOW_WORDS, SHOW_AS, SHOW_WORDS, WHAT_CHOICES, sourceWord, PLAY_LABELS_TOPIC, PLAY_KIND,
} from '../play_charts.js';
import { CHARTS_SAY_TOPIC } from '../actions.js';

// The ready-made views "Next view" walks, in order. The first is what a new panel shows (row 2.53: most people never
// configure anything, so the default has to be the useful one). Each sets how it is shown, what is counted and over
// when; which player and how many stay as the person set them.
export const VIEWS = Object.freeze([
  Object.freeze({ id: 'top-week', label: 'Top played this week', show: 'bar', count: 'item', win: 'week' }),
  Object.freeze({ id: 'each-day', label: 'Plays each day this month', show: 'line', count: 'item', win: 'month' }),
  Object.freeze({ id: 'today', label: 'Plays today', show: 'number', count: 'item', win: 'today' }),
  Object.freeze({ id: 'kinds', label: 'What played, by kind, this week', show: 'pie', count: 'source', win: 'week' }),
  Object.freeze({ id: 'all-time', label: 'Most played of all time', show: 'list', count: 'item', win: 'all' }),
]);

/** The ready-made view after the one these settings match (the first when they match none). Pure. */
export function nextView(settings) {
  const s = normalizeChart(settings);
  const at = VIEWS.findIndex((v) => v.show === s.show && v.count === s.count && v.win === s.win);
  return VIEWS[(at + 1) % VIEWS.length];
}

// How often the panel reads the device's record again by itself: another tab on this device may have played
// something, and "today" turns over at midnight. Once a minute costs one IndexedDB read. [Plumbing; not a setting.]
export const REFRESH_MS = 60 * 1000;
// The longest label drawn inside a bar chart; the full name is always in the table. [Plumbing.]
export const LABEL_MAX = 42;

const SETTINGS = [
  { key: 'show', label: 'Show as', kind: 'choice', default: CHART_DEFAULTS.show, level: 'standard',
    options: SHOW_AS.map((v) => ({ value: v, label: SHOW_WORDS[v] })) },
  { key: 'what', label: 'Which plays', kind: 'choice', default: CHART_DEFAULTS.what, level: 'standard',
    note: 'Spotify plays are left out: Spotify’s developer rules say an app should not make listening statistics from them.',
    options: WHAT_CHOICES.map((v) => ({ value: v, label: v === 'all' ? 'Everything played on this screen' : sourceWord(v) })) },
  { key: 'count', label: 'Count each', kind: 'choice', default: CHART_DEFAULTS.count, level: 'standard',
    options: [{ value: 'item', label: 'Song, video or photo' }, { value: 'source', label: 'Kind (YouTube, photos, music …)' },
      { value: 'by', label: 'Artist or channel (where one was kept)' }] },
  { key: 'win', label: 'Over', kind: 'choice', default: CHART_DEFAULTS.win, level: 'standard',
    options: WINDOWS.map((v) => ({ value: v, label: v === 'all' ? 'All time' : WINDOW_WORDS[v].charAt(0).toUpperCase() + WINDOW_WORDS[v].slice(1) })) },
  { key: 'top', label: 'How many to show', kind: 'choice', default: CHART_DEFAULTS.top, level: 'standard',
    options: [3, 5, 10, 20].map((n) => ({ value: n, label: String(n) })) },
  { key: 'sayTop', label: 'How many it says aloud', kind: 'choice', default: CHART_DEFAULTS.sayTop, level: 'advanced',
    options: [1, 3, 5].map((n) => ({ value: n, label: String(n) })) },
];
export const CHART_SETTINGS = SETTINGS;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n = LABEL_MAX) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ---------------------------------------------------------------------------------------------
// THE DRAWINGS (pure: a model in, markup out). Colours are CSS variables only: `--pc-1` ... set on the panel from the
// theme's tokens that read on its surface (play_charts.js `seriesColours`), each falling back to a theme token.
// The SVG is a picture of the table that follows it, so it is `aria-hidden`; the table is what is read.
// ---------------------------------------------------------------------------------------------
const pc = (i) => `var(--pc-${i + 1}, var(${SERIES_TOKENS[i % SERIES_TOKENS.length]}))`;

export function barSvg(rows) {
  const list = (rows || []).filter((r) => r && r.value > 0);
  if (!list.length) return '';
  const W = 640, rowH = 68, pad = 6, valW = 64;
  const max = Math.max(...list.map((r) => r.value));
  const H = list.length * rowH + pad;
  const body = list.map((r, i) => {
    const y = pad + i * rowH;
    const w = Math.max(4, ((W - valW - 4) * r.value) / max);
    return `<text x="0" y="${y + 22}" class="pc-svg-label">${esc(clip(`${i + 1}. ${r.label}`))}</text>`
      + `<rect x="0" y="${y + 32}" width="${w.toFixed(1)}" height="26" rx="4" fill="${pc(0)}" class="pc-bar"/>`
      + `<text x="${(w + 8).toFixed(1)}" y="${y + 54}" class="pc-svg-value">${r.value}</text>`;
  }).join('');
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMinYMin meet" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function lineSvg(series) {
  const b = series?.buckets || [];
  if (!b.length) return '';
  const W = 640, H = 280, padL = 52, padR = 20, padT = 16, padB = 42;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...b.map((x) => x.value));
  const xAt = (i) => padL + (b.length === 1 ? iw / 2 : (iw * i) / (b.length - 1));
  const yAt = (v) => padT + ih - (ih * v) / max;
  const ticks = [...new Set([0, Math.round(max / 2), max])];
  const grid = ticks.map((v) => `<line x1="${padL}" y1="${yAt(v).toFixed(1)}" x2="${W - padR}" y2="${yAt(v).toFixed(1)}" class="pc-grid"/>`
    + `<text x="${padL - 10}" y="${(yAt(v) + 7).toFixed(1)}" class="pc-svg-axis" text-anchor="end">${v}</text>`).join('');
  const every = b.length <= 8 ? 1 : Math.ceil(b.length / 6);
  const xl = b.map((x, i) => ((i % every === 0 || i === b.length - 1)
    ? `<text x="${xAt(i).toFixed(1)}" y="${H - 8}" class="pc-svg-axis" text-anchor="middle">${esc(x.label)}</text>` : '')).join('');
  const pts = b.map((x, i) => `${xAt(i).toFixed(1)},${yAt(x.value).toFixed(1)}`).join(' ');
  const dots = b.map((x, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(x.value).toFixed(1)}" r="5" fill="${pc(0)}"/>`).join('');
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">`
    + `${grid}${xl}<polyline points="${pts}" fill="none" stroke="${pc(0)}" stroke-width="3" stroke-linejoin="round" class="pc-line"/>${dots}</svg>`;
}

/** A pie, slices clockwise from the top in the rows' order, each numbered as the legend is. `colours` is how many
 *  series colours read on this theme (they repeat past that; the numbers and the legend tell slices apart). */
export function pieSvg(rows, { colours = 3 } = {}) {
  const list = (rows || []).filter((r) => r && r.value > 0);
  const sum = list.reduce((n, r) => n + r.value, 0);
  if (!sum) return '';
  const S = 260, c = S / 2, R = 122;
  const n = Math.max(1, Number(colours) | 0);
  let a0 = -Math.PI / 2;
  const parts = list.map((r, i) => {
    const frac = r.value / sum;
    const a1 = a0 + frac * Math.PI * 2;
    const fill = r.rest ? 'var(--surface-alt)' : pc(i % n);
    const mid = (a0 + a1) / 2;
    const lx = c + Math.cos(mid) * R * 0.64, ly = c + Math.sin(mid) * R * 0.64;
    const num = !r.rest && frac >= 0.06 ? `<text x="${lx.toFixed(1)}" y="${(ly + 8).toFixed(1)}" class="pc-slice-num" text-anchor="middle">${i + 1}</text>` : '';
    let shape;
    if (frac >= 0.9999) shape = `<circle cx="${c}" cy="${c}" r="${R}" fill="${fill}" class="pc-slice${r.rest ? ' pc-rest' : ''}"/>`;
    else {
      const large = frac > 0.5 ? 1 : 0;
      const x0 = c + Math.cos(a0) * R, y0 = c + Math.sin(a0) * R, x1 = c + Math.cos(a1) * R, y1 = c + Math.sin(a1) * R;
      shape = `<path d="M${c},${c} L${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}" class="pc-slice${r.rest ? ' pc-rest' : ''}"/>`;
    }
    a0 = a1;
    return shape + num;
  }).join('');
  return `<svg class="pc-svg pc-pie" viewBox="0 0 ${S} ${S}" aria-hidden="true" focusable="false">${parts}</svg>`;
}

export function pieLegend(rows, { colours = 3 } = {}) {
  const list = (rows || []).filter((r) => r && r.value > 0);
  const sum = list.reduce((n, r) => n + r.value, 0);
  const n = Math.max(1, Number(colours) | 0);
  if (!sum) return '';
  return `<ol class="pc-legend" aria-hidden="true">${list.map((r, i) => `<li><span class="pc-sw${r.rest ? ' pc-rest' : ''}" style="background:${r.rest ? 'var(--surface-alt)' : pc(i % n)}"></span>`
    + `<span class="pc-leg-label">${r.rest ? '' : `${i + 1}. `}${esc(r.label)}</span>`
    + `<span class="pc-leg-value">${r.value} (${Math.round((r.value / sum) * 100)}%)</span></li>`).join('')}</ol>`;
}

export function tableHtml(model, { visible = false } = {}) {
  const t = chartTable(model);
  const body = t.rows.length
    ? t.rows.map(([a, b]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')
    : `<tr><td colspan="2">${esc(model.emptyText || 'Nothing has played yet.')}</td></tr>`;
  return `<table class="pc-table${visible ? '' : ' pc-sr'}" data-reading>`
    + `<caption>${esc(t.caption)}</caption>`
    + `<thead><tr><th scope="col">${esc(t.head[0])}</th><th scope="col">${esc(t.head[1])}</th></tr></thead>`
    + `<tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------------------------------
// AN EXAMPLE, for a page with no screen (trying the module out): made-up plays, labelled as an example everywhere.
// ---------------------------------------------------------------------------------------------
export function examplePlays(now = Date.now()) {
  const day = 24 * 3600 * 1000;
  const out = [];
  const names = ['Example song A', 'Example song B', 'Example video C', 'Example song D', 'Example photo E'];
  const sources = ['folder', 'folder', 'youtube', 'folder', 'photos'];
  const counts = [7, 5, 4, 2, 1];
  counts.forEach((k, i) => {
    for (let j = 0; j < k; j += 1) {
      out.push({ kind: PLAY_KIND, created_at: new Date(now - ((i + j) % 6) * day * 0.4 - j * 60000).toISOString(),
        data: { source: sources[i], id: `example-${i}`, title: names[i] } });
    }
  });
  return out;
}

// The Charts panels mounted on this page, oldest first: the first one answers a spoken question, so two panels never
// talk over each other. Module scope on purpose - it is a fact about the page, not about one panel.
const live = [];

registerModule(
  { type: 'charts', title: 'Charts', core: 'new',
    description: 'What played on this screen, as bars, a line over time, a pie, one number or a list - read aloud on request',
    // `local`: it reads this device's own record and needs no server at all.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    const me = String(ctx.instanceId || `charts-${Math.random().toString(36).slice(2)}`);
    const screen = ctx.profileId ? String(ctx.profileId) : null;
    const plays = ctx.plays || (screen ? devicePlays() : null);
    const labels = new Map();          // `${source}:${id}` -> a name a player on the screen gave; memory only
    const asked = new Set();           // ids already asked about, so drawing never asks twice
    let cfg = normalizeChart({});
    let asList = false;
    let lit = -1;
    let rootEl = null;
    let dead = false;
    let timer = null;
    let off = null;
    let lastSpeech = null;
    let lastSaid = '';
    let colours = 3;
    let again = null;

    const events = () => (plays ? plays.get().events || [] : examplePlays(now()));
    const model = (over = {}) => chartModel(events(), { ...cfg, ...over }, { screen, now: now(), labels });

    function say(text) {
      lastSaid = text;
      if (!text || !ctx.output?.say) return;
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: 'charts' });
      } catch (e) { console.error('charts: say', e); }
    }
    const sayChart = (over = {}) => say(spokenAnswer(model(over), { limit: cfg.sayTop }));

    // Names for the ids on show that kept none: asked of the players on the screen, once per id.
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
        bus.publish(PLAY_LABELS_TOPIC, { ids: want, answer: (source, map) => {
          if (dead || !map || typeof map !== 'object') return;
          let changed = false;
          for (const [id, name] of Object.entries(map)) {
            if (typeof name === 'string' && name.trim()) { labels.set(`${source}:${id}`, name.trim().slice(0, 200)); changed = true; }
          }
          if (changed && again == null) again = setTimeout(() => { again = null; render(); }, 0);
        } });
      } catch (e) { console.error('charts: labels', e); }
    }

    // The theme's tokens, as they are on this panel, so the bars use one that reads on its surface.
    function paintColours() {
      try {
        const cs = getComputedStyle(rootEl);
        const vars = {};
        for (const t of ['--surface', ...SERIES_TOKENS]) vars[t] = cs.getPropertyValue(t).trim();
        if (!vars['--surface']) return;
        const ok = seriesColours(vars);
        colours = Math.max(1, Math.min(6, ok.length || 1));
        ok.slice(0, 6).forEach((c, i) => rootEl.style.setProperty(`--pc-${i + 1}`, `var(${c.token})`));
      } catch { /* the CSS fallbacks draw it */ }
    }

    function bodyHtml(m) {
      if (m.kind === 'number') {
        return `<p class="pc-num"><span class="pc-big" data-total>${m.total}</span>`
          + `<span class="pc-num-words">${m.total === 1 ? 'play' : 'plays'} ${esc(m.settings.win === 'all' ? 'in all' : WINDOW_WORDS[m.settings.win])}</span></p>`;
      }
      if (m.kind === 'list') return '';      // the table IS the list (and says when it is empty)
      if (m.empty) return `<p class="pc-empty" data-empty>${esc(m.emptyText)}</p>`;
      if (m.kind === 'line') return lineSvg(m.series);
      if (m.kind === 'pie') return `<div class="pc-pie-wrap">${pieSvg(m.rows, { colours })}${pieLegend(m.rows, { colours })}</div>`;
      return barSvg(m.rows);
    }

    function render() {
      if (dead || !rootEl) return;
      paintColours();
      const m = model();
      const listShown = m.kind === 'list' || (asList && m.kind !== 'number');
      const btn = (act, label, extra = '') => `<button type="button" class="pc-btn" data-walk data-act="${act}"${extra}>${esc(label)}</button>`;
      const more = m.more && (m.kind === 'bar' || m.kind === 'list') ? `<p class="pc-note">${m.more} more not shown.</p>` : '';
      const example = plays ? '' : '<p class="pc-note" data-example>An example, not real plays: on a screen, this shows that screen’s own plays.</p>';
      rootEl.innerHTML = `
        <div class="pc" data-charts data-kind="${esc(m.kind)}" data-list="${listShown ? '1' : '0'}">
          <p class="pc-title" data-title>${esc(m.title)}</p>
          ${example}
          ${listShown ? '' : `<div class="pc-body" data-body>${bodyHtml(m)}</div>`}
          ${tableHtml(m, { visible: listShown })}
          ${more}
          <div class="pc-btns">
            ${btn('say', 'Say it')}
            ${m.kind === 'list' || m.kind === 'number' ? '' : btn('aslist', asList ? 'Show the chart' : 'Show as a list', ` aria-pressed="${asList ? 'true' : 'false'}"`)}
            ${btn('view', `Next view: ${nextView(cfg).label}`)}
          </div>
          <p class="pc-said" role="status" aria-live="polite" data-said>${esc(lastSaid)}</p>
        </div>`;
      paintLit();
      askLabels(m);
    }

    // ---- the walk (the scoreboard's: hidden until the first verb; the first select says the chart) ----
    const walk = () => [...mount.querySelectorAll('[data-walk]')];
    function paintLit() {
      const list = walk();
      if (lit >= list.length) lit = list.length ? list.length - 1 : -1;
      list.forEach((b, i) => { if (i === lit) { b.dataset.on = '1'; b.setAttribute('aria-current', 'true'); } else { delete b.dataset.on; b.removeAttribute('aria-current'); } });
    }
    function moveLit(d) {
      const n = walk().length;
      if (!n) return;
      lit = lit < 0 ? (d > 0 ? 0 : n - 1) : ((lit + d) % n + n) % n;
      paintLit();
    }
    function selectLit() {
      if (lit < 0) { sayChart(); render(); return; }
      act(walk()[lit]);
    }

    function setCfg(patch) {
      cfg = normalizeChart({ ...cfg, ...patch });
      try { state?.set?.(patch); } catch { /* memory only */ }
      render();
    }
    function act(b) {
      if (!b || dead) return;
      const a = b.dataset.act;
      if (a === 'say') { sayChart(); render(); return; }
      if (a === 'aslist') { asList = !asList; try { state?.set?.({ asList }); } catch { /* memory only */ } render(); return; }
      if (a === 'view') { const v = nextView(cfg); setCfg({ show: v.show, count: v.count, win: v.win }); }
    }
    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      if (b && mount.contains(b)) act(b);
    }

    function applyState(s) {
      const snap = s || {};
      cfg = normalizeChart({ ...CHART_DEFAULTS, ...Object.fromEntries(SETTINGS.map((d) => [d.key, snap[d.key]]).filter(([, v]) => v !== undefined)) });
      asList = snap.asList === true;
    }

    function reload() {
      if (!plays || typeof plays.loadAll !== 'function') { render(); return; }
      Promise.resolve(plays.loadAll()).catch(() => {}).then(() => render());
    }

    return {
      __probe: () => ({ cfg: { ...cfg }, asList, lit, screen, example: !plays, labels: Object.fromEntries(labels),
        said: lastSaid, colours, first: live[0] === me, model: model() }),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../charts.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-charts-css href="${esc(cssHref)}">` : ''}<div class="pc-wrap" data-charts-root></div>`;
        rootEl = mount.querySelector('[data-charts-root]');
        mount.addEventListener('click', onClick);
        applyState(state?.get?.());
        state?.subscribe?.((s) => { if (dead) return; applyState(s); render(); });
        live.push(me);
        bus.subscribe('charts/next', () => moveLit(1));
        bus.subscribe('charts/prev', () => moveLit(-1));
        bus.subscribe('charts/select', () => selectLit());
        // "Computer please, what played most": the first Charts panel on the page answers, for the window asked.
        bus.subscribe(CHARTS_SAY_TOPIC, (p) => {
          if (dead || live[0] !== me) return;
          const win = p && WINDOWS.includes(p.win) ? p.win : cfg.win;
          // A spoken question is about things played, so a panel showing a line or a number answers with its top items.
          const show = cfg.show === 'line' || cfg.show === 'number' ? 'bar' : cfg.show;
          sayChart({ win, show });
          render();
        });
        if (plays && typeof plays.subscribe === 'function') off = plays.subscribe(() => render());
        render();
        reload();
        timer = setInterval(reload, REFRESH_MS);
      },
      onResize() {},
      onShow() { reload(); },
      onHide() { try { state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        const i = live.indexOf(me);
        if (i >= 0) live.splice(i, 1);
        if (timer != null) { clearInterval(timer); timer = null; }
        if (again != null) { clearTimeout(again); again = null; }
        try { typeof off === 'function' && off(); } catch { /* gone */ }
        mount.removeEventListener('click', onClick);
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
      },
    };
  },
);
