// modules/whats_new.js — WHAT'S NEW, a module (type 'whats_new'): the patch notes, newest first, each
// thing with where it is found. Mike, 2026-10-02: *"What's new could be like a patch notes module."*
//
// It reads whats_new_data.js (the dated changelog) and nothing else: no server, no network, nothing to
// wait on. Left alone it is a list; a switch walks its items (next / prev, each item's where read out in
// the info line through its `data-help`), and select reads the one it is on aloud.
//
// ONE SETTING (Rule 1): how far back it shows. 7 days by default, argued: long enough to catch a week of
// changes for somebody who looks in once a week, short enough that the list is still "what is new" rather
// than the whole history. All of it is one choice away.

import { registerModule } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { recentEntries } from '../whats_new_data.js';

export const WHATS_NEW_TYPE = 'whats_new';
export const WHATS_NEW_VERB_TOPICS = Object.freeze({ next: 'whats_new/next', prev: 'whats_new/prev', select: 'whats_new/select' });
export const WHATS_NEW_SETTINGS = Object.freeze([
  { key: 'days', label: 'Show what changed in the last', kind: 'choice', default: 7, level: 'standard',
    options: [{ value: 3, label: '3 days' }, { value: 7, label: 'week' }, { value: 30, label: 'month' }, { value: 0, label: 'Everything' }],
    help: 'How far back the list goes. Everything is kept; this only chooses how much is shown.' },
]);
const FIELDS = WHATS_NEW_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** "2026-10-02" -> "Friday 2 October" (the reader's own language for the words). */
export function dayLabel(iso, locale = undefined) {
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (Number.isNaN(t)) return iso;
  try { return new Date(t).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); }
  catch { return iso; }
}

const STYLE = `
.wn-root{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;color:var(--text);font:inherit}
.wn-root h3{margin:0 0 6px;font-size:1.05rem}
.wn-day{margin:12px 0 4px;font-size:.95rem;color:var(--text-muted)}
.wn-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.wn-item{padding:8px 10px;border-radius:10px;background:var(--surface);border:1px solid var(--border)}
.wn-item.is-scan{outline:3px solid var(--scan-ring, var(--highlight));outline-offset:2px}
.wn-where{display:block;color:var(--text-muted);font-size:.9rem;margin-top:2px}
`;

registerModule(
  { type: WHATS_NEW_TYPE, title: 'What’s new', core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'the patch notes: what changed lately, newest first, and where each new thing is',
    settings: WHATS_NEW_SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    let root = null;
    let cursor = -1;
    let days = 7;
    let offState = null;
    const offs = [];
    const items = () => (root ? [...root.querySelectorAll('.wn-item')] : []);
    function paint() {
      const list = items();
      for (const it of list) it.classList.remove('is-scan');
      if (!list.length || cursor < 0) return;
      cursor = ((cursor % list.length) + list.length) % list.length;
      list[cursor].classList.add('is-scan');
      try { list[cursor].scrollIntoView?.({ block: 'nearest' }); } catch { /* old browser */ }
    }
    function draw() {
      if (!root) return;
      const entries = recentEntries(days);
      root.innerHTML = `<h3>What’s new</h3>${entries.length ? entries.map((e) => `
        <h4 class="wn-day">${esc(dayLabel(e.date))}</h4>
        <ul class="wn-list">${e.items.map((it) => `<li class="wn-item" data-help="${esc(`${it.text} Where: ${it.where}`)}"
          data-help-title="New on ${esc(dayLabel(e.date))}">${esc(it.text)}<span class="wn-where">Where: ${esc(it.where)}</span></li>`).join('')}</ul>`).join('')
        : '<p>Nothing new in that time. Choose a longer time in this panel’s settings.</p>'}`;
      paint();
    }
    function readAloud() {
      const it = items()[cursor];
      if (!it || typeof ctx.output?.say !== 'function') return;
      try { ctx.output.say(it.textContent.replace(/\s+/g, ' ').trim(), { source: WHATS_NEW_TYPE }); } catch { /* no voice */ }
    }
    const setFrom = (v) => { const d = fieldValue(FIELDS[0], v || {}); if (d !== days) { days = d; draw(); } };
    return {
      async init() {
        root = mount.ownerDocument.createElement('div');
        root.className = 'wn-root';
        const style = mount.ownerDocument.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        try { await ctx.state?.load?.(); } catch { /* the default stands */ }
        days = fieldValue(FIELDS[0], (() => { try { return ctx.state?.get?.() || {}; } catch { return {}; } })());
        draw();
        try { offState = ctx.state?.subscribe?.(setFrom) || null; } catch { offState = null; }
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(WHATS_NEW_VERB_TOPICS.next, () => { cursor += 1; paint(); });
        on(WHATS_NEW_VERB_TOPICS.prev, () => { cursor = cursor <= 0 ? items().length - 1 : cursor - 1; paint(); });
        on(WHATS_NEW_VERB_TOPICS.select, () => readAloud());
      },
      onResize() {},
      onHide() {},
      destroy() {
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        mount.innerHTML = '';
        root = null;
      },
      __probe: () => ({ days, dates: root ? [...root.querySelectorAll('.wn-day')].map((h) => h.textContent) : [],
        items: items().length, cursor }),
    };
  },
);
