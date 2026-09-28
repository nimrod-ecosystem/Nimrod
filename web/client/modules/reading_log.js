// reading_log.js — a simple, append-only log of what was read.
//
// Row 2.23 (docs/for_chat/MIKE_CHANGE_LIST.md) / register 254
// (docs/from_chat/ideas_register.md), both in the private Nimrod_Ecosystem repo. Mike,
// 2026-09-28: "We'll need to add a reading log." Suggested shape — append-only events:
// title, author, chapter or pages, date, optional note. This module is exactly that and
// nothing more. It is meant to later feed a "transcript lessons for books" feature
// (register 253 / row 2.24) but does not build any part of that here — no quiz, no AI, no
// book lookup. Record what was read, see what was read.
//
// SAME SUBSTRATE AS points.js's LEDGER: a well-known, PROFILE-SCOPED shared stream reached
// with ctx.makeEvents('reading_log'), append-only, exactly like points.js's own header
// describes for the same reason — "append-only means [it] can never be silently edited
// away." A well-known stream key (rather than this module's own per-instance ctx.events)
// means every instance of this module on a profile reads and writes the SAME log, the same
// way every points-earning module pays into the same ledger.
//
// NO DELETE, NO EDIT — CHECKED FOR PRECEDENT RATHER THAN ASSUMED. The brief for this module
// allowed a "delete a typo'd entry" affordance IF a sibling module showed precedent for one.
// None does: presslog.js's own header is explicit ("Nothing here can overwrite or delete
// history"), points.js's ledger has no correction path either (a mistaken award is offset by
// a new one, never rewritten), and progress.js/personal.js are both read-only over their
// streams. So this module holds the line the rest of the codebase already holds: a typo'd
// entry is corrected the way every other record here is corrected — by adding a new one
// (a note, or a follow-up entry), not by rewriting history.
//
// SWITCH-ACCESSIBLE FREE-TEXT ENTRY IS NOT SOLVED HERE, AND NOT SOLVED ANYWHERE ELSE EITHER.
// sprint.js's own task field (`s-task`) is a plain `<input type=text>`, focused and typed
// into like any web form control — no sibling record-keeping module does better, and
// settings_fields.js's header says as much for its own domain ("text... is NOT cycleable,
// and honest about it"). This module follows the same precedent rather than inventing a new
// mechanism: typing a title works for anyone who can reach a keyboard, a switch bound to
// Tab/Enter, or an on-screen keyboard driving focus. It does not work for someone limited to
// picking from a fixed set of options, and that gap is inherited from every module before
// this one, not introduced by it.

import { registerModule } from '../module.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const READING_LOG_STREAM = 'reading_log';
export const READING_LOG_KIND = 'entry';

// Local calendar date, never UTC — "today" means whoever is standing in front of this
// screen, the same reasoning points.js's dayKey()/todayKey() already apply to a ledger day.
export function todayStr(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 'YYYY-MM-DD' -> 'M/D/YYYY' for display. Anything that doesn't parse is shown as typed
// rather than hidden — an odd date is still evidence, not an error to swallow.
export function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return s || '—';
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

// Most-recently-READ first — sorted by the entry's OWN `date`, not `created_at`. A reading
// log is allowed to be filled in late (you finish a chapter, log it that evening, or catch
// up on a week of entries at once), so "most recent first" means the most recently read
// book, not the most recently typed row. Same-day entries fall back to `created_at` so they
// still land in a stable order.
export function sortEntries(events) {
  return [...(events || [])]
    .filter((e) => e && e.kind === READING_LOG_KIND && e.data)
    .sort((a, b) => {
      const ad = String(a.data.date || ''), bd = String(b.data.date || '');
      if (ad !== bd) return ad < bd ? 1 : -1;
      return String(a.created_at || '') < String(b.created_at || '') ? 1 : -1;
    });
}

registerModule(
    // `server`, the same reasoning as points.js/progress.js: the record lives in the shared
    // stream on the platform. Without it this mounts but has nothing to show and nowhere to
    // save a new entry — measured the same way progress.js's own manifest comment says it
    // was measured, not assumed.
  { type: 'reading_log', title: 'Reading log', dependsOn: 'server',
    description: 'What was read — title, author, chapter or pages, and when. Add an entry, see the list.' },
  (ctx) => {
    const { mount } = ctx;
    const now = ctx.now || (() => Date.now());
    let stream = null;
    let entries = [];

    const el = (sel) => mount.querySelector(sel);

    function updateAddEnabled() {
      const btn = el('[data-add]');
      const title = el('[data-title]');
      if (btn && title) btn.disabled = !title.value.trim();
    }

    function renderList() {
      const list = el('[data-list]');
      if (!list) return;
      if (!entries.length) {
        list.innerHTML = '<div class="rl-empty">Nothing logged yet.</div>';
        return;
      }
      list.innerHTML = entries.map((e) => {
        const d = e.data || {};
        const bits = [];
        if (d.author) bits.push(esc(d.author));
        if (d.pages) bits.push(esc(d.pages));
        bits.push(esc(fmtDate(d.date)));
        return `<div class="rl-row">
            <div class="rl-title">${esc(d.title)}</div>
            <div class="rl-meta">${bits.join(' · ')}</div>
            ${d.note ? `<div class="rl-note">${esc(d.note)}</div>` : ''}
          </div>`;
      }).join('');
    }

    function resetForm() {
      el('[data-title]').value = '';
      el('[data-author]').value = '';
      el('[data-pages]').value = '';
      el('[data-note]').value = '';
      el('[data-date]').value = todayStr(now());
      updateAddEnabled();
    }

    function addEntry() {
      if (!stream) return;
      const title = el('[data-title]').value.trim();
      if (!title) return;
      const author = el('[data-author]').value.trim();
      const pages = el('[data-pages]').value.trim();
      const note = el('[data-note]').value.trim();
      const date = el('[data-date]').value.trim() || todayStr(now());
      const data = { title, date };
      if (author) data.author = author;
      if (pages) data.pages = pages;
      if (note) data.note = note;
      const btn = el('[data-add]');
      if (btn) btn.disabled = true;
      stream.append(READING_LOG_KIND, data)
        .then(() => resetForm())
        .catch((e) => { console.error('reading_log: append', e); updateAddEnabled(); });
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="rlog">
            <div class="rl-form">
              <input class="rl-input" data-title type="text" placeholder="Title" aria-label="title">
              <input class="rl-input" data-author type="text" placeholder="Author (optional)" aria-label="author">
              <input class="rl-input" data-pages type="text" placeholder="Chapter or pages (optional)" aria-label="chapter or pages">
              <input class="rl-input rl-date" data-date type="date" aria-label="date">
              <textarea class="rl-input rl-notefield" data-note rows="2" placeholder="Note (optional)" aria-label="note"></textarea>
              <button class="rl-btn rl-primary" data-add disabled>Add</button>
            </div>
            <div class="rl-list" data-list></div>
          </div>`;

        el('[data-date]').value = todayStr(now());
        el('[data-title]').addEventListener('input', updateAddEnabled);
        el('[data-add]').addEventListener('click', addEntry);
        // Enter-to-submit on the single-line fields, the same convenience youtube.js's own
        // add-url/search inputs already offer.
        for (const sel of ['[data-title]', '[data-author]', '[data-pages]']) {
          el(sel).addEventListener('keydown', (e) => { if (e.key === 'Enter') addEntry(); });
        }

        stream = ctx.makeEvents(READING_LOG_STREAM, { limit: 500 });
        stream.subscribe((cache) => { entries = sortEntries(cache.events); renderList(); });
        stream.load().then(() => stream.startPolling()).catch(() => {});

        renderList();
      },
      onResize() {},
      onHide() {},
      destroy() { if (stream) { stream.destroy(); stream = null; } },
    };
  },
);
