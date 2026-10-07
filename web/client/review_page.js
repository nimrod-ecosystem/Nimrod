// review_page.js — THE REVIEW PAGE (/reviews.html): check questions here one at a time, see which question packs are
// waiting and how far each has got, and every question somebody marked wrong — with their note — so it can be
// fixed or dropped.
//
// Mike, 2026-10-03: "Can I just play through and pass them?" The playing happens in Trivia (pack_reviews.js
// has the rule); this page is the other end — what came out of it, in one place, with "Export flagged" to
// paste to Code. Its own page, like claude.html: one task, reached from a link. Colours come only from the
// theme (theme.js), never from this file.
//
// Mike, 2026-10-06: "For reviewing the questions it would be nice if it linked to the wiki page and opened in
// another window." / "I'm thinking about maybe having Oscar review questions for his schoolwork. There should
// also be education points awarded for reviewing questions as well." So, since then:
//   * CHECK A QUESTION, HERE. One open question at a time: answer it yourself first (or just show the answer),
//     then "Where this comes from" — a link that opens in a new tab or window — then "Looks right" or "Something
//     is wrong". It is the same review as Trivia's ✓ / ✗ (the same log, the same rule), for somebody at a desk.
//     The verdict buttons come only once the answer is showing: a verdict on a question nobody has read the
//     answer of is not a review. "Skip for now" saves nothing and pays nothing.
//   * WHO IS REVIEWING. The login's own people (the first one by default, then whoever this browser last
//     chose), so the review is signed with their name (the server checks the person and names them) and the
//     points go to them. WHO MAY REVIEW, argued: FOR only the login's owner — a review decides what gets taught
//     as fact. AGAINST, and it wins as the default: anybody on the login can already flag a question while
//     playing, every verdict is signed and kept (nothing is lost; a wrong pass is undone by a flag, which always
//     beats a pass), and Mike's ask is exactly a second person reviewing. So any of the login's own people.
//     People who are on the page only through a connection (their profile lives on another login) are not
//     offered: their reviewing belongs on their own login.
//   * POINTS (review_points.js has the rules and argues each): kept on the person's screen — "Points are kept
//     on" picks which when they have several, and says so plainly when they have none.

import { exportFlagged, packProgress, topicName, sourceHtml } from './pack_reviews.js';
import { paidWords, reviewPrefsFromSettings, fmtAmount as fmtPoints } from './review_points.js';
import { gameFlagsFrom } from './unlocks.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (at) => (at ? String(at).slice(0, 10) : '');

export const REVIEW_PAGE_STYLE = `
.rv-card{box-sizing:border-box;width:100%;max-width:46rem;margin:0 auto 16px;padding:20px;border-radius:16px;border:1px solid var(--border);
  background:var(--surface);color:var(--text)}
.rv-card h1{font-size:1.35rem;margin:0 0 .3em}
.rv-card h2{font-size:1.05rem;margin:1.3em 0 .4em}
.rv-card h2:first-child{margin-top:0}
.rv-muted{color:var(--text-muted)}
.rv-packs{width:100%;border-collapse:collapse}
.rv-packs th,.rv-packs td{text-align:left;padding:5px 6px;border-bottom:1px solid var(--border);vertical-align:top}
.rv-done{font-weight:700}
.rv-flag{margin:.6em 0;padding:10px 12px;border:1px solid var(--border);border-radius:10px}
.rv-flag p{margin:.2em 0}
.rv-q{font-weight:700}
.rv-src{overflow-wrap:anywhere}.rv-src a{color:var(--link)}.rv-src-note{color:var(--text-muted)}
.rv-btn{min-height:44px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font:inherit;cursor:pointer;margin:4px 6px 4px 0}
.rv-btn:focus-visible,.rv-pick:focus-visible{outline:3px solid var(--focus, var(--accent));outline-offset:2px}
.rv-btn:disabled{opacity:.55;cursor:default}
.rv-btn[aria-pressed="true"]{font-weight:700;border-width:2px}
.rv-pick{box-sizing:border-box;max-width:100%;min-height:44px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font:inherit}
.rv-opts{display:flex;flex-wrap:wrap;gap:0}
.rv-said{font-weight:700}
.rv-note{box-sizing:border-box;width:100%;min-height:44px;padding:8px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font:inherit}
.rv-export{box-sizing:border-box;width:100%;min-height:12rem;margin-top:.5em;padding:8px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font:13px/1.4 ui-monospace,Menlo,Consolas,monospace}
`;

// The options in an order that does not give the answer away (packs often list the right one first), the SAME
// order every time this question is drawn: sorted by a hash of the question key and the option.
function hashOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function optionOrder(key, answers) {
  return [...(Array.isArray(answers) ? answers : [])].sort((a, b) => hashOf(`${key}|${a}`) - hashOf(`${key}|${b}`));
}

const REMEMBER_KEY = 'nimrod.reviews.person';
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch { return ''; } };
const remember = (id) => { try { localStorage.setItem(REMEMBER_KEY, id); } catch { /* private window: fine */ } };

/** What a screen's points are called, by its switches (unlocks.js decision 6): the record is the same either way. */
export function pointsName(values) {
  const f = gameFlagsFrom(values || {});
  return f.learning ? 'School points' : (f.game ? 'game points' : 'points');
}

/** The one line that says what reviewing pays here. */
export function payLine(prefs, name = 'points') {
  const p = prefs || {};
  if (!(p.reviewPoints > 0) && !(p.reviewSourcePoints > 0)) {
    return 'Reviewing earns no points on this screen (turned off in the Nimrod Game settings). Reviews still count.';
  }
  const parts = [];
  parts.push(p.reviewPoints > 0
    ? `Each question you check earns ${fmtPoints(p.reviewPoints)} ${p.reviewPoints === 1 ? name.replace(/points$/, 'point') : name}, the same whether you say it is right or wrong`
    : 'Checking a question earns nothing by itself here');
  if (p.reviewSourcePoints > 0) parts.push(`, and ${fmtPoints(p.reviewSourcePoints)} more for opening where it comes from`);
  let s = `${parts.join('')}. Once per question.`;
  if (p.reviewDailyCap > 0) s += ` Up to ${fmtPoints(p.reviewDailyCap)} a day.`;
  if (p.reviewMinSeconds > 0) s += ` Take at least ${p.reviewMinSeconds} seconds to look: a quicker one still counts, without points.`;
  return s;
}

/**
 * Draw the page into `el`. `reviews` is a createPackReviews handle (a suite passes one over fake data).
 * `who` (optional; reviews.html gives it once it knows who is signed in, or later with `setWho`):
 *   { people: async () => [{ id, name }], screens: async (personId) => [{ id, name }],
 *     ledgerFor: (screenId) => points ledger, settingsFor: (screenId) => state handle }
 * Without it the page still reviews; it just cannot say who, and pays nobody. Returns
 * { render, exportText(), setWho(who), current(), destroy() } for the suite.
 */
export function mountReviewPage(el, { reviews, now = () => new Date(), copy = null, who = null } = {}) {
  let exported = '';
  let copied = '';
  // WHO, and where their points go.
  let whoApi = null;
  let people = [];
  let personId = '';
  let screens = [];
  let screenId = '';
  let whoNote = '';            // why there are no points, in words ('' = there are)
  let settings = null;         // the chosen screen's settings document
  let ledger = null;
  let tracker = null;
  // THE QUESTION BEING CHECKED.
  let cur = null;              // { key, item, packId, packName, sources }
  let opts = [];
  let chosen = null;           // the option picked, or '' for "just show me"
  let verdict = null;          // null | 'right' | 'wrong'
  let said = '';               // what the last verdict saved, in words
  let paidSaid = '';           // ...and what it earned (review_points.js paidWords), redrawn when a source link adds to it
  let fixedSaid = '';          // what the last "Fixed — ask it again" saved and earned
  let offTracker = null;
  const ac = new AbortController();
  let noteSaved = false;
  let packFilter = '';
  const skipped = new Set();
  let dead = false;

  const personName = () => people.find((p) => p.id === personId)?.name || '';
  const nameOfPoints = () => { try { return pointsName(settings?.get?.() || {}); } catch { return 'points'; } };
  const prefsNow = () => { try { return reviewPrefsFromSettings(settings?.get?.() || {}); } catch { return reviewPrefsFromSettings({}); } };

  function nextQuestion() {
    const list = (reviews.openQuestions ? reviews.openQuestions() : [])
      .filter((q) => !skipped.has(q.key) && (!packFilter || q.packId === packFilter));
    cur = list[0] || null;
    opts = cur ? optionOrder(cur.key, cur.item.answers) : [];
    chosen = null; verdict = null; noteSaved = false;
    if (cur) tracker?.shown?.(cur.key);
  }
  const leftCount = () => (reviews.openQuestions ? reviews.openQuestions() : [])
    .filter((q) => !packFilter || q.packId === packFilter).length;

  function whoHtml() {
    if (!whoApi) {
      return `<section class="rv-card" data-rv-who><h2>Who is reviewing</h2>
        <p class="rv-muted" data-rv-who-none>Sign in to choose who is reviewing and to earn points for it. Reviews still count.</p></section>`;
    }
    const pick = people.length
      ? `<select class="rv-pick" data-rv-person aria-label="Who is reviewing">${people.map((p) => `<option value="${esc(p.id)}"${p.id === personId ? ' selected' : ''}>${esc(p.name || 'Somebody')}</option>`).join('')}</select>`
      : '<span class="rv-muted">Loading…</span>';
    let where = '';
    if (whoNote) where = `<p class="rv-muted" data-rv-no-points>${esc(whoNote)}</p>`;
    else if (screens.length > 1) {
      where = `<p><label>Points are kept on <select class="rv-pick" data-rv-screen>${screens.map((s) => `<option value="${esc(s.id)}"${s.id === screenId ? ' selected' : ''}>${esc(s.name || 'a screen')}</option>`).join('')}</select></label></p>`;
    } else if (screens.length === 1) {
      where = `<p class="rv-muted">Points are kept on the screen “${esc(screens[0].name || 'Screen')}”.</p>`;
    }
    const pay = !whoNote && ledger ? `<p data-rv-pay>${esc(payLine(prefsNow(), nameOfPoints()))}</p>
      <p class="rv-muted" data-rv-today>Earned today for reviewing: ${esc(fmtPoints(tracker?.todayEarned?.() || 0))}.</p>` : '';
    return `<section class="rv-card" data-rv-who><h2>Who is reviewing</h2><p>${pick}</p>${where}${pay}</section>`;
  }

  function dealHtml() {
    const packsHere = reviews.listing().filter((e) => e && e.kind === 'trivia' && reviews.packs().get(e.id));
    const filter = packsHere.length > 1 ? `<p><label>Which pack <select class="rv-pick" data-rv-filter>
      <option value="">Any pack</option>${packsHere.map((e) => `<option value="${esc(e.id)}"${e.id === packFilter ? ' selected' : ''}>${esc(topicName(reviews.packs().get(e.id).name || e.name))}</option>`).join('')}
      </select></label></p>` : '';
    if (!cur) {
      return `<section class="rv-card" data-rv-deal><h2>Check a question</h2>${filter}
        <p class="rv-muted" data-rv-deal-none>${said ? `${esc(said)} ` : ''}Nothing is waiting to be checked${packFilter ? ' in this pack' : ''}${skipped.size ? ' (except the ones you skipped — reload the page to see them again)' : ''}.</p></section>`;
    }
    const it = cur.item;
    const shown = chosen !== null;
    const optBtns = opts.map((a, i) => {
      const mark = shown && a === it.correct ? ' (marked right)' : '';
      return `<button type="button" class="rv-btn" data-rv-opt="${i}" ${shown ? 'disabled' : ''} aria-pressed="${chosen === a ? 'true' : 'false'}">${esc(a)}${esc(mark)}</button>`;
    }).join('');
    const yours = !shown ? '' : (chosen === ''
      ? ''
      : `<p class="rv-said" data-rv-yours>${chosen === it.correct ? 'You picked the marked answer.' : `You picked “${esc(chosen)}”. The pack says “${esc(it.correct)}”.`}</p>`);
    const why = shown && typeof it.explain === 'string' && it.explain.trim()
      ? `<p data-rv-explain>Why, according to the pack: ${esc(it.explain.trim())}</p>` : '';
    const src = shown ? sourceHtml(cur.sources, { cls: 'rv-src', key: cur.key }) : '';
    let ask = '';
    if (!shown) {
      ask = `<p class="rv-muted">Answer it yourself first, or just show the answer.</p>
        <p><button type="button" class="rv-btn" data-rv-show>Just show me the answer</button>
        <button type="button" class="rv-btn" data-rv-skip>Skip for now</button></p>`;
    } else if (!verdict) {
      ask = `<p><b>Is this question right?</b> Check the answer, the other choices, and where it comes from.</p>
        <p><button type="button" class="rv-btn" data-rv-right>Yes, it looks right</button>
        <button type="button" class="rv-btn" data-rv-wrong>No, something is wrong</button>
        <button type="button" class="rv-btn" data-rv-skip>Skip for now</button></p>`;
    } else {
      const note = verdict === 'wrong'
        ? (noteSaved ? '<p class="rv-muted" data-rv-note-saved>Note saved.</p>'
          : `<p><label>What is wrong? (optional)<br><input type="text" class="rv-note" data-rv-note maxlength="1000" autocomplete="off"></label></p>
             <p><button type="button" class="rv-btn" data-rv-save-note>Save note</button></p>`)
        : '';
      ask = `<p class="rv-said" role="status" data-rv-said>${esc([said, paidSaid].filter(Boolean).join(' '))}</p>${note}
        <p><button type="button" class="rv-btn" data-rv-next>Next question</button></p>`;
    }
    // A message that is not a verdict's (it did not save; somebody else checked the last one) shows above.
    const before = !verdict && said ? `<p class="rv-said" role="status" data-rv-said>${esc(said)}</p>` : '';
    return `<section class="rv-card" data-rv-deal="${esc(cur.key)}"><h2>Check a question</h2>${filter}${before}
      <p class="rv-muted">${esc(cur.packName)} · ${leftCount()} left to check</p>
      <p class="rv-q" data-rv-question>${esc(it.question)}</p>
      <div class="rv-opts">${optBtns}</div>
      ${yours}${why}${src}${ask}</section>`;
  }

  function restHtml() {
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
        ${f.orphan ? '' : sourceHtml(f.sources, { cls: 'rv-src', key: f.key })}
        ${f.notes.length
          ? f.notes.map((n) => `<p data-rv-note>What’s wrong: ${esc(n.note)} <span class="rv-muted">${esc(n.by || '')}${n.at ? ` · ${esc(day(n.at))}` : ''}</span></p>`).join('')
          : '<p class="rv-muted">No note.</p>'}
        <p class="rv-muted">Flagged${f.flaggedBy ? ` by ${esc(f.flaggedBy)}` : ''}${f.flaggedAt ? ` on ${esc(day(f.flaggedAt))}` : ''}.</p>
        <button type="button" class="rv-btn" data-rv-unflag="${esc(f.key)}">Fixed — ask it again</button>
      </div>`).join('');
    return `
      <section class="rv-card">
        <h1>Questions waiting for review</h1>
        <p>These questions were written by an AI, some from its own memory. Each one names its own source — a
          link, a reference book, or “common knowledge” with a reason — shown under the question while you check
          it. A source an AI names can still be wrong, or not say what it is claimed to say, so open it when in
          doubt. <b>A person reading each question is the real check</b> — a wrong “right answer” taught as fact is
          worse than no question.</p>
        <p class="rv-muted">Two ways to check them: one at a time above, or by playing. To play them, open a
          Trivia’s settings, turn on <b>Include unreviewed questions (review as you play)</b>, and pick one of these
          packs under <b>Which pack</b>. A question you answer and move on from counts as right; press <b>✗ wrong</b>
          (or W, or say “that one is wrong”) for one that is not, and it is never asked again. A check counts for
          everyone on this login. Turn the setting off when you are done.</p>
        <h2>Packs</h2>
        ${listing.length ? `<table class="rv-packs"><thead><tr><th>Pack</th><th>Right</th><th>Wrong</th><th>Not yet</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table>` : '<p class="rv-muted" data-rv-none>No packs are waiting for review.</p>'}
        <h2>Marked wrong (${flagged.length})</h2>
        ${fixedSaid ? `<p class="rv-said" role="status" data-rv-fixed-said>${esc(fixedSaid)}</p>` : ''}
        ${flagged.length ? flags : '<p class="rv-muted" data-rv-noflags>Nothing has been marked wrong.</p>'}
        <p><button type="button" class="rv-btn" data-rv-export ${flagged.length ? '' : 'disabled'}>Export flagged</button>
          ${copied ? `<span class="rv-muted" role="status">${esc(copied)}</span>` : ''}</p>
        ${exported ? `<textarea class="rv-export" data-rv-export-text readonly>${esc(exported)}</textarea>` : ''}
      </section>`;
  }

  el.innerHTML = '<div data-rv-who-host></div><div data-rv-deal-host></div><div data-rv-rest-host></div>';
  const whoHost = el.querySelector('[data-rv-who-host]');
  const dealHost = el.querySelector('[data-rv-deal-host]');
  const restHost = el.querySelector('[data-rv-rest-host]');
  const renderWho = () => { if (!dead) whoHost.innerHTML = whoHtml(); };
  // A half-typed note survives a redraw (a poll, a link's points landing).
  const renderDeal = () => {
    if (dead) return;
    const typed = dealHost.querySelector('[data-rv-note]');
    const keep = typed ? { v: typed.value, focus: typed.ownerDocument.activeElement === typed } : null;
    dealHost.innerHTML = dealHtml();
    const box = keep ? dealHost.querySelector('[data-rv-note]') : null;
    if (box) { box.value = keep.v; if (keep.focus) box.focus(); }
  };
  const renderRest = () => { if (!dead) restHost.innerHTML = restHtml(); };
  function render() { renderWho(); renderDeal(); renderRest(); }

  // ---- who, and where their points go ----
  async function useScreen(id) {
    screenId = id || '';
    try { settings?.destroy?.(); } catch { /* gone */ }
    try { ledger?.destroy?.(); } catch { /* gone */ }
    settings = null; ledger = null; tracker = null;
    try { offTracker?.(); } catch { /* gone */ }
    offTracker = null;
    reviews.payInto?.({ ledger: null });
    if (screenId && whoApi) {
      try {
        ledger = whoApi.ledgerFor(screenId);
        settings = whoApi.settingsFor(screenId);
        tracker = reviews.payInto?.({ ledger, settings, root: el, now: () => now().getTime() }) || null;
        // Points that land after the verdict (opening the source afterwards) are said under the question too.
        offTracker = tracker?.subscribe?.((r) => {
          if (r && verdict && cur && r.key === cur.key) { paidSaid = paidWords(r, { name: personName() }); renderDeal(); }
          renderWho();
        }) || null;
        await Promise.allSettled([tracker?.ready, settings?.load?.()]);
        if (cur) tracker?.shown?.(cur.key);
      } catch (err) { console.error('review page: points', err); ledger = null; tracker = null; }
    }
    renderWho();
  }
  async function usePerson(id) {
    personId = id || '';
    if (personId) remember(personId);
    screens = [];
    whoNote = '';
    renderWho();
    try { screens = personId ? ((await whoApi.screens(personId)) || []) : []; } catch { screens = []; }
    if (!screens.length) {
      whoNote = `No points: ${personName() || 'they'} ${personName() ? 'has' : 'have'} no screen yet to keep them on. Reviews still count, signed with their name.`;
      await useScreen('');
      return;
    }
    await useScreen(screens[0].id);
  }
  async function setWho(next) {
    whoApi = next || null;
    if (!whoApi) { people = []; await useScreen(''); render(); return; }
    renderWho();
    try { people = (await whoApi.people()) || []; } catch { people = []; }
    const want = remembered();
    await usePerson(people.some((p) => p.id === want) ? want : (people[0]?.id || ''));
  }

  // ---- checking one question ----
  async function decide(kind) {
    if (!cur || chosen === null || verdict) return;
    const q = cur;
    verdict = kind;
    said = 'Saving…';
    renderDeal();
    const call = kind === 'right' ? reviews.pass : reviews.flag;
    const ok = await call({ question: q.item.question, answer: q.item.correct, packId: q.packId,
      place: 'the review page', person: personId });
    if (cur !== q) return;
    const base = ok ? (kind === 'right' ? 'Saved: looks right.' : 'Saved: marked wrong. It will not be asked again until somebody fixes it.')
      : 'That did not save just now. Try again in a moment.';
    if (!ok) verdict = null;
    const r = ok && tracker ? tracker.last?.() : null;
    said = base;
    paidSaid = r && r.key === q.key ? paidWords(r, { name: personName() }) : '';
    renderDeal();
    renderWho();
  }

  el.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.matches('[data-rv-person]')) usePerson(t.value);
    else if (t.matches('[data-rv-screen]')) useScreen(t.value);
    else if (t.matches('[data-rv-filter]')) { packFilter = t.value; said = ''; paidSaid = ''; nextQuestion(); renderDeal(); }
  }, { signal: ac.signal });
  el.addEventListener('click', (e) => {
    // A source link opens by itself (a new tab); review_points.js counts it — pack_reviews.js `payInto` listens on
    // this same element — and what it adds is said through the tracker's subscribe, above.
    const t = e.target.closest ? e.target.closest('button') : null;
    if (!t || t.disabled) return;
    if (t.dataset.rvOpt != null && cur && chosen === null) { chosen = opts[Number(t.dataset.rvOpt)] ?? ''; renderDeal(); return; }
    if (t.hasAttribute('data-rv-show') && cur && chosen === null) { chosen = ''; renderDeal(); return; }
    if (t.hasAttribute('data-rv-skip') && cur) { skipped.add(cur.key); said = ''; paidSaid = ''; nextQuestion(); renderDeal(); return; }
    if (t.hasAttribute('data-rv-right')) { decide('right'); return; }
    if (t.hasAttribute('data-rv-wrong')) { decide('wrong'); return; }
    if (t.hasAttribute('data-rv-save-note') && cur) {
      const text = String(el.querySelector('[data-rv-note]')?.value || '').trim();
      if (!text) return;
      const q = cur;
      reviews.note(q.key, text, { person: personId }).then((ok) => { if (cur === q && ok) { noteSaved = true; renderDeal(); } });
      return;
    }
    if (t.hasAttribute('data-rv-next')) { said = ''; paidSaid = ''; nextQuestion(); renderDeal(); return; }
    if (t.dataset.rvUnflag) {
      const key = t.dataset.rvUnflag;
      const f = reviews.flagged().find((x) => x.key === key);
      reviews.unflag(key, { person: personId, question: f?.question || '' }).then((ok) => {
        const r = ok && tracker ? tracker.last?.() : null;
        fixedSaid = ok ? ['Put back: it will be checked again.', r && r.key === key ? paidWords(r, { name: personName() }) : '']
          .filter(Boolean).join(' ') : 'That did not save just now. Try again in a moment.';
        if (!cur) nextQuestion();
        render();
      });
      return;
    }
    if (t.hasAttribute('data-rv-export')) {
      exported = exportFlagged(reviews.flagged(), { now: now() });
      copied = '';
      renderRest();
      const write = copy || ((text) => navigator.clipboard?.writeText?.(text));
      Promise.resolve().then(() => write(exported))
        .then(() => { copied = 'Copied — paste it to Code.'; renderRest(); })
        .catch(() => { copied = 'Select the text below and copy it.'; renderRest(); });
    }
  }, { signal: ac.signal });

  // The log changed (here, on another device, or a poll): the lists are redrawn; the question being checked
  // stays where it is unless somebody else just checked it — then the next one comes up. A half-typed note is
  // never redrawn away.
  const off = reviews.subscribe(() => {
    renderRest();
    if (!cur) { nextQuestion(); renderDeal(); return; }
    const status = reviews.map().get(cur.key)?.status;
    if (status && status !== 'open' && !verdict) { said = 'Somebody else just checked that one.'; nextQuestion(); renderDeal(); }
    else renderDeal();
  });
  render();
  reviews.ready.then(() => { if (!cur) nextQuestion(); render(); });
  if (who) setWho(who);
  return {
    render,
    exportText: () => exported,
    setWho,
    current: () => cur,
    tracker: () => tracker,
    destroy() {
      dead = true; ac.abort();
      for (const f of [off, offTracker]) { try { f?.(); } catch { /* gone */ } }
      reviews.payInto?.({ ledger: null });
    },
  };
}
