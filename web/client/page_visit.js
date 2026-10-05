// page_visit.js — "SEE THEIR PAGE" and "SEE OLDER MESSAGES": two windows modules/people.js opens over Your people.
//
// Mike, 2026-10-04 (night; DECISIONS.md "People across accounts", items 7-9):
//   * on a connection's card, "See their page" opens their page READ-ONLY, showing only what they opened to you (by
//     default their picture and name, and no more) -- and only if they let you open it at all;
//   * no separate guestbook: "Leave a note" on their page is the regular note (note_visit.js), the same permission
//     as "Send a message" on their card;
//   * "Messages for you" gets a way to scroll back through your old notes: newest first, a page at a time, who and when.
//
// *** THE SERVER DECIDES WHAT IS SHOWN. *** This file draws exactly what GET /api/people/<card>/visit hands back
// (web/server/page_visits.py filters part by part and field by field). It never asks for the person's page record
// itself and never filters anything on its own: a part that is not in the answer does not exist here.
//
// THEIR COLOURS (2026-10-05, "Colours for my page"): the server sends the page's theme id with an open page; it is
// worn on this window (`wearColours`) unless the visitor's own colours are for reading (page_sections.js pageColours).
//
// PICTURES ON SOMEBODY ELSE'S PAGE: the pictures come from the owner's own folder through their own media connection
// (an address on their machine, theirs alone), so the visitor's page says "Pictures are only on <name>'s own
// devices" -- the server never sends that address, so there is nothing here to leak and no broken box to show.

import { mountModule, getManifest, extendCtx } from './module.js';
import { authHeaders } from './auth.js';
import { createBus } from './bus.js';
import { mountRecommendedVideo } from './recommend.js';
import { mountNoteVisit } from './note_visit.js';
import { whenOf, whenWords } from './modules/note.js';
import { boxHeight, videoOf, aboutText, pageColours, ACCESS_THEMES } from './page_sections.js';
import { THEMES, applyTheme, listThemes } from './theme.js';

// ---- "Colours for my page" (2026-10-05; the rule is page_sections.js pageColours) ----------------------------------
const norm = (v) => String(v || '').trim().toLowerCase();
/** Which of the site's themes the colours around `el` are ('' when they match none, or cannot be read). An
 *  accessibility theme is looked for first: it is the one the rule turns on. */
export function viewerThemeOf(el) {
  try {
    const cs = getComputedStyle(el);
    const bg = norm(cs.getPropertyValue('--bg'));
    const text = norm(cs.getPropertyValue('--text'));
    if (!bg) return '';
    const ids = [...ACCESS_THEMES, ...Object.keys(THEMES).filter((k) => !ACCESS_THEMES.includes(k))];
    return ids.find((id) => THEMES[id] && norm(THEMES[id].vars['--bg']) === bg && norm(THEMES[id].vars['--text']) === text) || '';
  } catch { return ''; }
}
/** Does this browser ask for more contrast, or force its own colours? */
export function wantsMoreContrast(win = (typeof window !== 'undefined' ? window : null)) {
  try { return !!(win?.matchMedia?.('(prefers-contrast: more)').matches || win?.matchMedia?.('(forced-colors: active)').matches); } catch { return false; }
}
export const knownThemes = () => { try { return listThemes().map((t) => t.id); } catch { return []; } };
// What wearing a theme changed on each element, so taking it off puts back exactly what was there.
const WORN = new WeakMap();
/**
 * Put a page's colours on `el` (theme.js applyTheme: the variables only -- the moving scene of a live theme is drawn
 * only on <html> or an element marked `data-scene-host`, which this does not mark), with the page's own background
 * and text, or take them off again (`id` ''). Returns the id worn. Only what it changed is put back.
 */
export function wearColours(el, id) {
  if (!el?.style) return '';
  const want = id && THEMES[id] ? id : '';
  const prev = WORN.get(el);
  if ((prev?.id || '') === want) return want;
  if (prev) {
    for (const [n, v] of prev.before) { if (v) el.style.setProperty(n, v); else el.style.removeProperty(n); }
    WORN.delete(el);
    delete el.dataset.pageColours;
  }
  if (!want) return '';
  const snap = () => new Map([...el.style].map((n) => [n, el.style.getPropertyValue(n)]));
  const before = snap();
  applyTheme(el, want);
  el.style.setProperty('background-color', 'var(--bg)');
  el.style.setProperty('color', 'var(--text)');
  const after = snap();
  const changed = new Map();
  for (const [n, v] of after) if (before.get(n) !== v) changed.set(n, before.get(n) || '');
  WORN.set(el, { id: want, before: changed });
  el.dataset.pageColours = want;
  return want;
}

export const visitURL = (personId) => `/api/people/${encodeURIComponent(personId)}/visit`;
export const historyURL = (personId, { before = null, limit = null } = {}) => {
  const q = new URLSearchParams();
  if (before != null) q.set('before', String(before));
  if (limit != null) q.set('limit', String(limit));
  const s = q.toString();
  return `/api/people/${encodeURIComponent(personId)}/notes/history${s ? `?${s}` : ''}`;
};

// The words, in one place (the suite holds every one to page_sections.js pageWordProblems).
export const VISIT_WORDS = Object.freeze({
  see: 'See their page',
  seeShort: 'What they show you',
  dimShort: 'Not open to you',
  title: (name) => (name ? `${name}’s page` : 'Their page'),
  lead: (name) => (name ? `This is ${name}’s page. You see the parts ${name} chose to show you.`
    : 'This is their page. You see the parts they chose to show you.'),
  callThem: (n) => `You call them ${n}.`,
  nothingMore: (name) => `${name || 'They'} ha${name ? 's' : 've'} not shown anything else here yet.`,
  photosElsewhere: (name) => (name ? `Pictures are only on ${name}’s own devices.` : 'Pictures are only on their own devices.'),
  noVideo: 'No video chosen yet.',
  play: 'Play',
  playShort: 'Plays here, on this page',
  stop: 'Stop',
  note: 'Leave a note',
  noteShort: 'It shows on their screen, from you',
  noteDone: 'Close the note',
  loading: 'Opening their page…',
  failed: 'Their page could not be opened just now. Try again in a little while.',
  cannotShow: 'This could not be shown here just now.',
  // Why "See their page" is dimmed (page_visits.py REFUSAL_TEXT's codes).
  why: (code, name) => (code === 'not-connected'
    ? `You are not connected with ${name || 'them'}, so their page is not open to you.`
    : `${name || 'They'} ha${name ? 's' : 've'} not opened their page to you.`),
});

export const OLDER_WORDS = Object.freeze({
  see: 'See older messages',
  seeShort: 'Every message left for you',
  title: 'Older messages',
  lead: 'Every message left for you, newest first.',
  none: 'No messages yet. When someone leaves you one, it shows here.',
  more: 'Show more',
  moreShort: 'Older ones',
  end: 'That is every message left for you.',
  loading: 'Loading…',
  failed: 'Your messages could not be read just now. Try again in a little while.',
  on: (screen) => (screen ? `, on ${screen}` : ''),
});

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BOX_LOADERS = Object.freeze({ clock: () => import('./modules/clock.js') });

function memState(initial = {}) {
  let v = { ...initial };
  const subs = new Set();
  return { get: () => v, set(p) { v = { ...v, ...p }; subs.forEach((f) => { try { f(v); } catch { /* gone */ } }); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); }, load: async () => v, flush: async () => {}, destroy() { subs.clear(); } };
}
function noEvents() {
  return { append: async () => ({}), subscribe: () => () => {}, load: async () => {}, get: () => ({ events: [] }), flush: async () => {}, destroy() {} };
}
const btn = (attrs, label, short = '', { dim = false, why = '' } = {}) => `<button type="button" class="pp-btn${dim ? '' : ' is-go'}" ${attrs}
  ${dim ? `aria-disabled="true" data-pv-why="${esc(why)}" title="${esc(why)}"` : ''}>${esc(label)}${short ? `<small>${esc(short)}</small>` : ''}</button>`;

/**
 * Their page, read-only. `personId`: the card on YOUR page (the server reaches their page through it).
 *   name       what you call them (the card's name), used until the server's answer names their own
 *   faceHTML   their picture as your card draws it (people.js; read from their home, through your card)
 *   note       "Leave a note": { enabled, reason, short } -- the card's own "Send a message" answer
 *   reach      where a note for them goes (the card's `reach`)
 *   baseCtx    the page's ctx, for the boxes (a clock) and the player
 */
export function mountPageVisit(root, {
  personId = '', name = '', faceHTML = '', note = { enabled: false, reason: '', short: '' }, reach = '', user = null, baseCtx = {},
  fetchImpl = (...a) => fetch(...a), noteImpl = mountNoteVisit, isScreen = false, moreContrast = wantsMoreContrast(),
} = {}) {
  if (!root) throw new Error('mountPageVisit: a root element is required');
  let torn = false;
  let colours = '';                // the page's own colours, as worn here ('' : the visitor's own)
  // The visitor's own colours, read BEFORE the page's go on (page_sections.js pageColours: theirs win when they are for
  // reading, like High contrast).
  const viewerTheme = viewerThemeOf(root);
  let status = 'loading';          // 'loading' | 'ok' | 'refused' | 'error'
  let answer = null;               // the server's { name, call_name, sections } or { error, text }
  let noteOpen = null;             // mountNoteVisit's handle, while the note is open
  let why = '';
  const boxes = new Map();         // section id -> mounted thing
  const ac = new AbortController();

  const theirName = () => (answer && answer.name) || name || '';
  function unmountAll() {
    for (const b of boxes.values()) { try { b?.destroy?.(); } catch { /* gone */ } }
    boxes.clear();
  }
  function sectionHTML(s) {
    const n = theirName();
    switch (s.kind) {
      case 'about': {
        const text = aboutText(s.options);
        return `<section class="pp-card" data-pv-sec="${esc(s.id)}" data-pv-kind="about"><h2 class="pp-h">About me</h2>${text.trim()
          ? `<p class="pp-about" data-pv-about>${esc(text)}</p>` : '<p class="pp-note">Nothing here yet.</p>'}</section>`;
      }
      case 'clock':
        return `<section class="pp-card" data-pv-sec="${esc(s.id)}" data-pv-kind="clock"><h2 class="pp-h">Clock</h2>
          <div class="pp-box" data-pv-box="${esc(s.id)}" style="height:${esc(boxHeight(s.options))}"></div></section>`;
      case 'photos':
        return `<section class="pp-card" data-pv-sec="${esc(s.id)}" data-pv-kind="photos"><h2 class="pp-h">Pictures</h2>
          <p class="pp-note" data-pv-photos-elsewhere>${esc(VISIT_WORDS.photosElsewhere(n))}</p></section>`;
      case 'video': {
        const vid = videoOf(s.options);
        const playing = boxes.has(s.id);
        return `<section class="pp-card" data-pv-sec="${esc(s.id)}" data-pv-kind="video"><h2 class="pp-h">A video</h2>
          ${vid ? `<div class="pp-btns">${playing ? btn(`data-pv-act="stop" data-pv-id="${esc(s.id)}"`, VISIT_WORDS.stop)
            : btn(`data-pv-act="play" data-pv-id="${esc(s.id)}"`, VISIT_WORDS.play, VISIT_WORDS.playShort)}</div>` : `<p class="pp-note">${esc(VISIT_WORDS.noVideo)}</p>`}
          <div class="pp-box" data-pv-box="${esc(s.id)}" style="height:${playing ? esc(boxHeight(s.options)) : '0px'}"></div></section>`;
      }
      default: return '';          // the server sends nothing else; anything else is not drawn
    }
  }
  function render() {
    if (torn) return;
    unmountAll();
    if (noteOpen) { try { noteOpen.destroy(); } catch { /* gone */ } noteOpen = null; }
    if (status === 'loading') { root.innerHTML = `<div class="pp-list" data-pv-loading><p class="pp-note">${esc(VISIT_WORDS.loading)}</p></div>`; return; }
    if (status !== 'ok') {
      const text = status === 'refused' ? (answer?.text || VISIT_WORDS.why(answer?.error, name)) : VISIT_WORDS.failed;
      root.innerHTML = `<div class="pp-list" data-pv-refused="${esc(answer?.error || status)}"><section class="pp-card"><p class="pp-note">${esc(text)}</p></section></div>`;
      return;
    }
    const n = theirName();
    const secs = (Array.isArray(answer.sections) ? answer.sections : []).filter((s) => s && s.kind !== 'self');
    const call = (answer.call_name || '').trim();
    const noteBtn = btn('data-pv-act="note"', VISIT_WORDS.note, note.enabled ? VISIT_WORDS.noteShort : (note.short || ''),
      { dim: !note.enabled, why: note.reason || '' });
    root.innerHTML = `<div class="pp-list" data-pv-page>
      <section class="pp-card pp-self" data-pv-sec="self"><div class="pp-who"><div class="pp-face">${faceHTML}</div>
        <div><div class="pp-name" data-pv-name>${esc(n)}</div>
        <p class="pp-sub">${esc(VISIT_WORDS.lead(n))}${call && call !== n ? ` ${esc(VISIT_WORDS.callThem(call))}` : ''}</p></div></div></section>
      ${secs.map(sectionHTML).join('')}
      ${secs.length ? '' : `<p class="pp-note" data-pv-nothing>${esc(VISIT_WORDS.nothingMore(n))}</p>`}
      <section class="pp-card" data-pv-note-card><div class="pp-btns">${noteBtn}</div>
        <p class="pp-why" role="status" data-pv-why>${esc(why)}</p><div data-pv-note></div></section>
    </div>`;
    for (const s of secs) if (s.kind === 'clock') mountClock(s);
  }
  async function mountClock(s) {
    const host = root.querySelector(`[data-pv-box="${CSS.escape(s.id)}"]`);
    if (!host) return;
    const slot = {};
    boxes.set(s.id, slot);
    try {
      if (!getManifest('clock')) await BOX_LOADERS.clock();
      if (torn || boxes.get(s.id) !== slot) return;
      const inst = mountModule('clock', extendCtx(baseCtx, {
        mount: host, bus: createBus(), instanceId: `visit-${personId}-${s.id}`, state: memState(s.options?.settings || {}), events: noEvents(),
      }));
      slot.destroy = () => inst.destroy?.();
      await inst.init();
    } catch (err) {
      console.error('page visit: clock', err);
      host.innerHTML = `<p class="pp-note" style="padding:12px">${esc(VISIT_WORDS.cannotShow)}</p>`;
    }
  }
  async function play(id) {
    const s = (answer?.sections || []).find((x) => x.id === id);
    const vid = s ? videoOf(s.options) : null;
    if (!vid || boxes.has(id)) return;
    const slot = {};
    boxes.set(id, slot);
    // Draw the Stop button and the box at its height without tearing the slot down.
    const card = root.querySelector(`[data-pv-sec="${CSS.escape(id)}"]`);
    const host = card?.querySelector('[data-pv-box]');
    if (!host) return;
    host.style.height = boxHeight(s.options);
    const b = card.querySelector('[data-pv-act="play"]');
    if (b) b.outerHTML = btn(`data-pv-act="stop" data-pv-id="${esc(id)}"`, VISIT_WORDS.stop);
    try {
      const child = await mountRecommendedVideo(host, { rec: { provider: 'youtube', kind: 'video', id: vid.id }, baseCtx, instanceId: `visit-${personId}-${id}` });
      if (torn || boxes.get(id) !== slot) { child.destroy(); return; }
      slot.destroy = () => child.destroy();
    } catch (err) {
      console.error('page visit: video', err);
      host.innerHTML = `<p class="pp-note" style="padding:12px">${esc(VISIT_WORDS.cannotShow)}</p>`;
    }
  }
  function stop(id) {
    const slot = boxes.get(id);
    boxes.delete(id);
    try { slot?.destroy?.(); } catch { /* gone */ }
    const card = root.querySelector(`[data-pv-sec="${CSS.escape(id)}"]`);
    const s = (answer?.sections || []).find((x) => x.id === id);
    if (card && s) card.outerHTML = sectionHTML(s);
  }
  function openNote(b) {
    const host = root.querySelector('[data-pv-note]');
    if (!host) return;
    if (noteOpen) {
      try { noteOpen.destroy(); } catch { /* gone */ }
      noteOpen = null;
      b.innerHTML = `${esc(VISIT_WORDS.note)}<small>${esc(VISIT_WORDS.noteShort)}</small>`;
      return;
    }
    noteOpen = noteImpl(host, { personId: reach || personId, personName: theirName(), user });
    b.innerHTML = esc(VISIT_WORDS.noteDone);
  }
  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-pv-act]') : null;
    if (!b || !root.contains(b)) return;
    if (b.getAttribute('aria-disabled') === 'true') {
      why = b.dataset.pvWhy || '';
      const w = root.querySelector('[data-pv-why]');
      if (w) w.textContent = why;
      return;
    }
    const act = b.dataset.pvAct;
    if (act === 'play') play(b.dataset.pvId);
    else if (act === 'stop') stop(b.dataset.pvId);
    else if (act === 'note') openNote(b);
  }, { signal: ac.signal });

  render();
  const ready = (async () => {
    if (!personId) { status = 'error'; render(); return; }
    try {
      const r = await fetchImpl(visitURL(personId), { headers: authHeaders(user), credentials: 'same-origin', signal: ac.signal });
      const body = await r.json().catch(() => null);
      answer = body;
      status = r.ok && body && Array.isArray(body.sections) ? 'ok' : (r.status === 403 || r.status === 409 ? 'refused' : 'error');
    } catch { status = torn ? status : 'error'; }
    if (!torn && status === 'ok') {
      colours = wearColours(root, pageColours({ pageTheme: typeof answer?.theme === 'string' ? answer.theme : '', known: knownThemes(),
        isScreen, viewerTheme, moreContrast }));
    }
    render();
  })();
  return {
    ready,
    status: () => status,
    colours: () => colours,
    pageTheme: () => (typeof answer?.theme === 'string' ? answer.theme : ''),
    sections: () => (answer && Array.isArray(answer.sections) ? answer.sections.map((s) => ({ ...s })) : []),
    noteOpen: () => !!noteOpen,
    playing: () => [...boxes.keys()],
    destroy() { torn = true; ac.abort(); unmountAll(); if (noteOpen) { try { noteOpen.destroy(); } catch { /* gone */ } } wearColours(root, ''); root.innerHTML = ''; },
  };
}

/** "See older messages": every message left for the person, newest first, `Show more` for the next page. */
export function mountOlderMessages(root, { personId = '', user = null, fetchImpl = (...a) => fetch(...a), pageSize = null } = {}) {
  if (!root) throw new Error('mountOlderMessages: a root element is required');
  let torn = false;
  let rows = [];
  let next = null;
  let more = false;
  let status = 'loading';          // 'loading' | 'ok' | 'error'
  let busy = false;
  const ac = new AbortController();

  function render() {
    if (torn) return;
    if (status === 'loading' && !rows.length) { root.innerHTML = `<div class="pp-list"><p class="pp-note">${esc(OLDER_WORDS.loading)}</p></div>`; return; }
    if (status === 'error' && !rows.length) { root.innerHTML = `<div class="pp-list" data-po-failed><p class="pp-note">${esc(OLDER_WORDS.failed)}</p></div>`; return; }
    root.innerHTML = `<div class="pp-list" data-po-list><p class="pp-note">${esc(OLDER_WORDS.lead)}</p>
      ${rows.length ? rows.map((m) => `<p class="pp-msg" data-po-row="${esc(m.id)}"><b>${esc(m.author || 'Someone')}</b>: ${esc(m.text)}
        <br><small>${esc(whenWords(whenOf({ created_at: m.at })))}${esc(OLDER_WORDS.on(m.screen))}</small></p>`).join('')
        : `<p class="pp-note" data-po-none>${esc(OLDER_WORDS.none)}</p>`}
      ${more ? `<div class="pp-btns">${btn('data-po-more', OLDER_WORDS.more, OLDER_WORDS.moreShort)}</div>`
        : (rows.length ? `<p class="pp-note" data-po-end>${esc(OLDER_WORDS.end)}</p>` : '')}
      ${status === 'error' ? `<p class="pp-why" role="status">${esc(OLDER_WORDS.failed)}</p>` : ''}</div>`;
  }
  async function load() {
    if (busy || torn) return;
    busy = true;
    try {
      const r = await fetchImpl(historyURL(personId, { before: next, limit: pageSize }), { headers: authHeaders(user), credentials: 'same-origin', signal: ac.signal });
      const body = r.ok ? await r.json().catch(() => null) : null;
      if (!body || !Array.isArray(body.messages)) throw new Error(`history ${r.status}`);
      const seen = new Set(rows.map((m) => m.id));
      rows = rows.concat(body.messages.filter((m) => !seen.has(m.id)));
      more = !!body.more && body.next != null;
      next = body.next;
      status = 'ok';
    } catch { if (!torn) status = 'error'; }
    busy = false;
    render();
    // After Show more, the cursor stays on Show more (or where it was) - a switch walking down is not sent back up.
    try { root.querySelector('[data-po-more]')?.focus?.({ preventScroll: true }); } catch { /* not focusable */ }
  }
  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-po-more]') : null;
    if (b && root.contains(b)) load();
  }, { signal: ac.signal });
  render();
  const ready = load();
  return {
    ready,
    more: () => (more ? load() : Promise.resolve()),
    rows: () => rows.map((m) => ({ ...m })),
    hasMore: () => more,
    status: () => status,
    destroy() { torn = true; ac.abort(); root.innerHTML = ''; },
  };
}
