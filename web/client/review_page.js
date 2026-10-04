// review_page.js — THE REVIEW PAGE (/reviews.html): which question packs are waiting, how far each review
// has got, and every question somebody marked wrong — with their note — so it can be fixed or dropped.
//
// Mike, 2026-10-03: "Can I just play through and pass them?" The playing happens in Trivia (pack_reviews.js
// has the rule); this page is the other end — what came out of it, in one place, with "Export flagged" to
// paste to Code. Its own page, like claude.html: one task, reached from a link. Colours come only from the
// theme (theme.js), never from this file.

import { exportFlagged, packProgress, topicName } from './pack_reviews.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (at) => (at ? String(at).slice(0, 10) : '');

export const REVIEW_PAGE_STYLE = `
.rv-card{box-sizing:border-box;width:100%;max-width:46rem;margin:0 auto;padding:20px;border-radius:16px;border:1px solid var(--border);
  background:var(--surface);color:var(--text)}
.rv-card h1{font-size:1.35rem;margin:0 0 .3em}
.rv-card h2{font-size:1.05rem;margin:1.3em 0 .4em}
.rv-muted{color:var(--text-muted)}
.rv-packs{width:100%;border-collapse:collapse}
.rv-packs th,.rv-packs td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--border);vertical-align:top}
.rv-done{font-weight:700}
.rv-flag{margin:.6em 0;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
.rv-flag p{margin:.2em 0}
.rv-q{font-weight:700}
.rv-btn{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer}
.rv-btn:focus-visible{outline:3px solid var(--link);outline-offset:2px}
.rv-export{box-sizing:border-box;width:100%;min-height:12rem;margin-top:.5em;padding:8px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font:13px/1.4 ui-monospace,Menlo,Consolas,monospace}
`;

/**
 * Draw the page into `el`. `reviews` is a createPackReviews handle (a suite passes one over fake data).
 * Returns { render, exportText() } for the suite.
 */
export function mountReviewPage(el, { reviews, now = () => new Date(), copy = null } = {}) {
  let exported = '';
  let copied = '';

  function render() {
    const listing = reviews.listing();
    const packs = reviews.packs();
    const map = reviews.map();
    const flagged = reviews.flagged();
    const rows = listing.map((entry) => {
      const pack = packs.get(entry.id);
      if (!pack) {
        return `<tr><td>${esc(topicName(entry.name))}<br><span class="rv-muted">${esc(entry.url)}</span></td>
          <td colspan="4" class="rv-muted">Could not be read.</td></tr>`;
      }
      const p = packProgress(pack, map);
      return `<tr data-rv-pack="${esc(entry.id)}"><td>${esc(topicName(pack.name || entry.name))}<br><span class="rv-muted">${esc(entry.url)}</span></td>
        <td>${p.passed}</td><td>${p.flagged}</td><td>${p.open}</td>
        <td>${p.reviewed ? '<span class="rv-done" data-rv-reviewed>Reviewed</span>' : '<span class="rv-muted">Reviewing</span>'}</td></tr>`;
    }).join('');
    const flags = flagged.map((f) => `
      <div class="rv-flag" data-rv-flag="${esc(f.key)}">
        <p class="rv-muted">${esc(f.packName)}</p>
        <p class="rv-q">${esc(f.question)}</p>
        <p>Marked right: <b>${esc(f.answer)}</b>${f.answers.length ? ` <span class="rv-muted">(options: ${esc(f.answers.join(' | '))})</span>` : ''}</p>
        ${f.notes.length
          ? f.notes.map((n) => `<p data-rv-note>What’s wrong: ${esc(n.note)} <span class="rv-muted">${esc(n.by || '')}${n.at ? ` · ${esc(day(n.at))}` : ''}</span></p>`).join('')
          : '<p class="rv-muted">No note.</p>'}
        <p class="rv-muted">Flagged${f.flaggedBy ? ` by ${esc(f.flaggedBy)}` : ''}${f.flaggedAt ? ` on ${esc(day(f.flaggedAt))}` : ''}.</p>
        <button type="button" class="rv-btn" data-rv-unflag="${esc(f.key)}">Fixed — ask it again</button>
      </div>`).join('');
    el.innerHTML = `
      <section class="rv-card">
        <h1>Questions waiting for review</h1>
        <p>These questions were written by an AI. Some were written from its own memory, with no source to check
          them against. A pack has to name where its questions came from, but “from memory” is a name, so that
          check lets them through. <b>A person reading each question while playing it is the real check</b> — a
          wrong “right answer” taught as fact is worse than no question.</p>
        <p class="rv-muted">To review: open a Trivia panel’s settings, turn on <b>Include unreviewed questions (review
          as you play)</b>, and choose one of these packs under <b>Which pack</b>. Play as usual. A question
          answered and moved on from is passed; press <b>✗ wrong</b> (or W, or say “that one is wrong”) for one that
          is not right, and it is never asked again. Reviews count for everyone on this account. Turn the setting
          off when you are done.</p>
        <h2>Packs</h2>
        ${listing.length ? `<table class="rv-packs"><thead><tr><th>Pack</th><th>Passed</th><th>Wrong</th><th>Not yet</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table>` : '<p class="rv-muted" data-rv-none>No packs are waiting for review.</p>'}
        <h2>Marked wrong (${flagged.length})</h2>
        ${flagged.length ? flags : '<p class="rv-muted" data-rv-noflags>Nothing has been marked wrong.</p>'}
        <p><button type="button" class="rv-btn" data-rv-export ${flagged.length ? '' : 'disabled'}>Export flagged</button>
          ${copied ? `<span class="rv-muted" role="status">${esc(copied)}</span>` : ''}</p>
        ${exported ? `<textarea class="rv-export" data-rv-export-text readonly>${esc(exported)}</textarea>` : ''}
      </section>`;
  }

  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.rvUnflag) {
      reviews.unflag(t.dataset.rvUnflag).then(() => render());
      return;
    }
    if (t.hasAttribute('data-rv-export')) {
      exported = exportFlagged(reviews.flagged(), { now: now() });
      copied = '';
      render();
      const write = copy || ((text) => navigator.clipboard?.writeText?.(text));
      Promise.resolve().then(() => write(exported))
        .then(() => { copied = 'Copied — paste it to Code.'; render(); })
        .catch(() => { copied = 'Select the text below and copy it.'; render(); });
    }
  });

  reviews.subscribe(() => render());
  render();
  reviews.ready.then(() => render());
  return { render, exportText: () => exported };
}
