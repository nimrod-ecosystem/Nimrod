// progress.js — the PROGRESS dashboard: how someone is actually doing, over time.
//
// Ported from the old Cici dashboard's `datadash.js` (a go/no-go assessment screen over the
// pressgame/wordgame logs) and generalised. It reads the shared `gameplay` telemetry stream
// (telemetry.js) and answers two questions:
//
//   1. Is this getting better?      -> accuracy per session, oldest to newest.
//   2. What is hard?                -> accuracy per CONCEPT, hardest first, with a trend
//                                      arrow so "bad but improving" reads differently from
//                                      "bad and stuck".
//
// NOT A PERSONA. This is not "the Cici screen" or "the school screen" — the same instrument
// serves a response game (cue appears, press in time) and a learning game (question appears,
// answer it), because telemetry.js gives both the same trial shape. **One person may play
// games from both sets**, so the filter is by GAME, never by who someone is. A profile with
// a reaction game and an algebra game shows both in one picker and can view either alone.
//
// THE COUNTERPART TO `quests`. That module is an ECONOMY — a balance earned and spent, where
// the number motivates. This one is a MEASUREMENT — evidence, where the number informs. They
// share a substrate (profile-scoped append-only streams) and nothing else.
//
// READ-ONLY, ON PURPOSE. This module never appends a trial. It refreshes on the
// `gameplay/logged` nudge and otherwise polls; games are the only writers.
//
// TESTABILITY: ctx.now() is injectable (default Date.now), like sprint.js and quests.js.

import { registerModule } from '../module.js';
import {
  createTelemetry, GAMEPLAY_TOPIC,
  summarize, games as gamesOf, modes as modesOf, filterTrials, bySession, byConcept,
  byBand, bands as bandsOf, fmtPct, fmtMs,
} from '../telemetry.js';

// How many concept bars to draw before the list stops being readable.
export const CONCEPT_LIMIT = 12;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${p(d.getMinutes())}`;
}

export function fmtDur(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

export const TREND_MARK = { up: '▲', down: '▼', flat: '–' };

// A session's span, for the table.
export function sessionDurationMs(session) {
  const ts = session.items.map((t) => new Date(t.created_at).getTime()).filter(Number.isFinite);
  return ts.length ? Math.max(...ts) - Math.min(...ts) : 0;
}

// ---- inline SVG, themed through CSS variables (no chart library) ----

// Accuracy per session, oldest -> newest. Bars, because sessions are discrete sittings
// rather than a continuous signal — a line would imply values in between that don't exist.
export function sessionChart(sessions) {
  const pts = sessions.filter((s) => s.accuracy != null);
  if (!pts.length) return '<div class="g-empty">No sessions with a scored trial yet.</div>';
  const W = 600, H = 150, padL = 32, padT = 8, padB = 16, padR = 6;
  const iw = W - padL - padR, ih = H - padT - padB, bw = iw / pts.length;
  const grid = [0, 0.5, 1].map((v) => {
    const y = padT + (1 - v) * ih;
    return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="g-grid"/>` +
           `<text x="2" y="${y + 4}" class="g-axis">${v * 100}%</text>`;
  }).join('');
  const bars = pts.map((s, i) => {
    const h = s.accuracy * ih;
    const x = padL + i * bw + bw * 0.15;
    return `<rect x="${x.toFixed(1)}" y="${(padT + ih - h).toFixed(1)}" ` +
           `width="${Math.max(2, bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="g-bar">` +
           `<title>${esc(fmtWhen(s.at))} — ${fmtPct(s.accuracy)} of ${s.trials}</title></rect>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="accuracy per session">${grid}${bars}</svg>`;
}

registerModule(
  { type: 'progress', title: 'Progress', description: 'how a game is going over time — accuracy, concepts, reaction time' },
  (ctx) => {
    const { mount, bus } = ctx;
    const now = ctx.now || (() => Date.now());

    let tel = null;
    let game = null;       // null = all games
    let mode = null;       // null = all modes
    let tab = 'concepts';  // concepts | sessions

    const el = (sel) => mount.querySelector(sel);
    const all = () => (tel ? tel.get().events || [] : []);
    const shown = () => filterTrials(all(), { game, mode });

    // ---- CSV export: the caregiver/teacher hands someone a file, deliberately ----
    function exportCsv() {
      const rows = [['timestamp', 'game', 'session', 'mode', 'concept', 'band', 'responded', 'correct', 'latency_ms', 'wait_ms', 'prompt']];
      for (const t of shown()) {
        const d = t.data;
        rows.push([t.created_at, d.game, d.session, d.mode || '', d.concept || '', d.band || '',
          d.responded, d.correct == null ? '' : d.correct,
          d.latencyMs ?? '', d.waitMs ?? '', d.prompt || '']);
      }
      const csv = rows.map((r) => r.map((v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `progress-${game || 'all-games'}-${new Date(now()).toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ---- render ----

    function renderFilters() {
      const gs = gamesOf(all());
      const ms = modesOf(filterTrials(all(), { game }));
      const btn = (attr, val, label, on) =>
        `<button class="g-fbtn${on ? ' on' : ''}" data-${attr}="${esc(val)}">${esc(label)}</button>`;
      el('[data-games]').innerHTML =
        `<span class="g-flabel">Game</span>` + btn('game', '', 'All', !game) +
        gs.map((g) => btn('game', g, g, game === g)).join('');
      el('[data-modes]').innerHTML = ms.length
        ? `<span class="g-flabel">Mode</span>` + btn('mode', '', 'All', !mode) +
          ms.map((m) => btn('mode', m, m, mode === m)).join('')
        : '';
      for (const b of mount.querySelectorAll('[data-game]')) {
        b.addEventListener('click', () => { game = b.dataset.game || null; mode = null; render(); });
      }
      for (const b of mount.querySelectorAll('[data-mode]')) {
        b.addEventListener('click', () => { mode = b.dataset.mode || null; render(); });
      }
    }

    function renderCards(s, sessions) {
      const card = (k, v) => `<div class="g-card"><div class="g-v">${esc(v)}</div><div class="g-k">${esc(k)}</div></div>`;
      // "When answered" only earns its place if misses actually happen — otherwise it is
      // identical to accuracy and just noise.
      const showWhenAnswered = s.misses > 0;
      el('[data-cards]').innerHTML =
        card('sessions', sessions.length) +
        card('trials', s.trials) +
        card('accuracy', fmtPct(s.accuracy)) +
        (showWhenAnswered ? card('when answered', fmtPct(s.whenAnswered)) : '') +
        card('avg response', fmtMs(s.meanLatency)) +
        (s.misses ? card('missed', s.misses) : '');
    }

    function renderConcepts() {
      const list = byConcept(shown());
      if (!list.length) return '<div class="g-empty">No trials recorded yet.</div>';
      const rows = list.slice(0, CONCEPT_LIMIT).map((c) => {
        const pct = c.accuracy == null ? 0 : Math.round(c.accuracy * 100);
        const trend = c.trend ? `<i class="g-trend g-${c.trend}" title="earlier ${fmtPct(c.earlier)} → recent ${fmtPct(c.recent)}">${TREND_MARK[c.trend]}</i>` : '';
        return `<div class="g-crow">
            <div class="g-cname">${esc(c.concept)}${trend}</div>
            <div class="g-cbar"><i style="width:${pct}%"></i></div>
            <div class="g-cpct">${fmtPct(c.accuracy)}<span>${c.trials}</span></div>
          </div>`;
      }).join('');
      const more = list.length > CONCEPT_LIMIT
        ? `<p class="g-note">showing the ${CONCEPT_LIMIT} hardest of ${list.length} concepts</p>` : '';
      return `<p class="g-note">hardest first · ▲ improving, ▼ slipping</p>${rows}${more}`;
    }

    // Accuracy by the content's own difficulty label — "grade-8 words at 85%, grade-10 at
    // 40%". Ordered easiest-first so the drop-off is where you'd expect to read it.
    //
    // Deliberately NOT a percentile or a national comparison. Those need a normed
    // instrument with a sampled population; inventing one would be fabricating a number
    // about a child's education that someone might act on. This says only what it knows:
    // how they did on the material THIS bank labelled that hard.
    function renderBands() {
      const list = byBand(shown());
      if (!list.length) {
        return `<div class="g-empty">No difficulty labels in this data yet.<br>
          <span class="g-note">Games can tag each item with a band (a grade level, a unit)
          and it will appear here.</span></div>`;
      }
      const rows = list.map((b) => {
        const pct = b.accuracy == null ? 0 : Math.round(b.accuracy * 100);
        const trend = b.trend ? `<i class="g-trend g-${b.trend}" title="earlier ${fmtPct(b.earlier)} → recent ${fmtPct(b.recent)}">${TREND_MARK[b.trend]}</i>` : '';
        return `<div class="g-crow">
            <div class="g-cname">${esc(b.band)}${trend}</div>
            <div class="g-cbar"><i style="width:${pct}%"></i></div>
            <div class="g-cpct">${fmtPct(b.accuracy)}<span>${b.trials}</span></div>
          </div>`;
      }).join('');
      return `<p class="g-note">how they did on material the content labelled this hard —
        the bank's own labels, not a national comparison</p>${rows}`;
    }

    function renderSessions(sessions) {
      if (!sessions.length) return '<div class="g-empty">No sessions yet.</div>';
      const rows = [...sessions].reverse().map((s) => `
        <tr>
          <td>${esc(fmtWhen(s.at))}</td>
          <td>${esc(s.game || '—')}${s.mode ? `<span class="g-src">${esc(s.mode)}</span>` : ''}</td>
          <td>${s.trials}</td>
          <td>${s.hits}</td>
          <td>${s.falseAlarms}</td>
          <td>${s.misses}</td>
          <td>${fmtPct(s.accuracy)}</td>
          <td>${fmtMs(s.meanLatency)}</td>
          <td>${esc(fmtDur(sessionDurationMs(s)))}</td>
        </tr>`).join('');
      return `<table class="g-table">
          <thead><tr><th>When</th><th>Game</th><th>Trials</th><th>Right</th><th>Wrong</th>
            <th>Missed</th><th>Accuracy</th><th>Avg</th><th>Length</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    function render() {
      if (!mount.querySelector('.gprogress')) return;
      const list = shown();
      const sessions = bySession(list);
      const s = summarize(list);

      renderFilters();
      renderCards(s, sessions);
      el('[data-chart]').innerHTML = sessionChart(sessions);
      for (const b of mount.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
      // The Bands tab only appears when the data actually carries bands — an empty tab
      // teaches nothing.
      const hasBands = bandsOf(list).length > 0;
      const bandsBtn = mount.querySelector('[data-tab="bands"]');
      if (bandsBtn) bandsBtn.hidden = !hasBands;
      if (!hasBands && tab === 'bands') tab = 'concepts';
      el('[data-panel]').innerHTML =
        tab === 'concepts' ? renderConcepts() :
        tab === 'bands' ? renderBands() :
        renderSessions(sessions);
      el('[data-export]').disabled = !list.length;
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="gprogress">
            <div class="g-filters" data-games></div>
            <div class="g-filters" data-modes></div>
            <div class="g-cards" data-cards></div>
            <div class="g-h">accuracy per session</div>
            <div class="g-chart" data-chart></div>
            <div class="g-tabs">
              <button class="g-tab on" data-tab="concepts">Concepts</button>
              <button class="g-tab" data-tab="bands" hidden>Bands</button>
              <button class="g-tab" data-tab="sessions">Sessions</button>
              <button class="g-tab g-ghost" data-export>Export CSV</button>
            </div>
            <div class="g-panel" data-panel></div>
          </div>`;

        for (const b of mount.querySelectorAll('[data-tab]')) {
          b.addEventListener('click', () => { tab = b.dataset.tab; render(); });
        }
        el('[data-export]').addEventListener('click', exportCsv);

        tel = createTelemetry({ makeEvents: ctx.makeEvents, bus });
        tel.subscribe(() => render());
        tel.load().then(() => tel.startPolling()).catch(() => {});

        // Live nudge from any game that just logged a trial. REFRESH ONLY — this module is
        // never a writer, so a nudge can't invent a trial that isn't in the stream.
        bus.subscribe(GAMEPLAY_TOPIC, () => { tel.load().catch(() => {}); });

        render();
      },

      onResize() {},
      onHide() {},
      destroy() { if (tel) { tel.destroy(); tel = null; } },
    };
  },
);
