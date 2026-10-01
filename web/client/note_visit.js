// note_visit.js — LEAVE A NOTE FROM YOUR OWN ACCOUNT, and WHO MAY.
//
// Mike, 2026-10-01: a visitor can leave the "note from someone" (modules/note.js) from their own
// account. Two halves, both shown in the Remote tab:
//
//   mountNoteVisit   — the visitor's side. The same note module the screen shows, mounted here with a
//                      `makeEvents` that reaches the server's narrow note route
//                      (`/api/people/<person>/notes/<screen>/<stream>`), and `ctx.author` set to this
//                      account's display name with `authorLocked`, so the form signs as them. They see
//                      what the screen shows: the note on show, and its history. The server stamps who
//                      wrote each row (server/notes.py); nothing here can sign as somebody else.
//
//   mountNoteWriters — the owner's side. WHO MAY, ticked per person from the people who already hold a
//                      drive grant, on the person's own row (`noteWriters`, beside the intercom's
//                      `intercomAllowed`). EMPTY BY DEFAULT: a drive grant lets somebody press the
//                      screen's buttons while the room watches; typing words onto it from anywhere is a
//                      different yes. The argument is in server/notes.py.
//
// THE NAME YOU SIGN WITH is per account (`/api/me` `display_name`), set in the visitor's section. Empty
// by default, and then notes say "Someone": nothing is guessed from the sign-in (with Google we do not
// even ask for the email), and a name nobody chose should not appear on somebody else's wall.

import { mountModule } from './module.js';
import { createBus } from './bus.js';
import { createEvents } from './events.js';
import { authHeaders } from './auth.js';
import { SOMEONE, MAX_NAME } from './modules/note.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const WRITERS_FIELD = 'noteWriters';
export const screensURL = (personId) => `/api/people/${encodeURIComponent(personId)}/notes/screens`;
export const noteURL = (personId, screenId, stream = 'note') =>
  `/api/people/${encodeURIComponent(personId)}/notes/${encodeURIComponent(screenId)}/${encodeURIComponent(stream)}`;

/** The ticked accounts on a person's row. Pure. Plain names, or `{account}` (the intercom's shape). */
export function noteWritersFrom(row) {
  const raw = row && Array.isArray(row[WRITERS_FIELD]) ? row[WRITERS_FIELD] : [];
  const out = [];
  for (const e of raw) {
    const a = typeof e === 'string' ? e.trim() : (e && typeof e.account === 'string' ? e.account.trim() : '');
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Owner and drive grants -> who could be ticked. Pure. [{ account, label, note, current }] */
export function writerCandidates({ grants = [], ticked = [], now = new Date().toISOString() } = {}) {
  const out = [];
  for (const g of grants || []) {
    if (!g || (g.subject_kind && g.subject_kind !== 'account')) continue;
    const account = String(g.subject_id || '');
    if (!account || out.some((x) => x.account === account)) continue;
    const live = !g.expires_at || String(g.expires_at) > now;
    out.push({ account, label: (g.label || '').trim(),
      note: live ? 'may use these screens' : 'their permission to use these screens has ended', current: live });
  }
  for (const a of ticked) {
    if (!out.some((x) => x.account === a)) out.push({ account: a, label: '', note: 'no longer allowed to use these screens', current: false });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// THE OWNER'S SIDE
// ---------------------------------------------------------------------------------------
export function mountNoteWriters(root, {
  personName = '',
  state,                        // the person's row: { get(), set(patch), subscribe?(fn) }
  loadGrants = async () => [],
  now = () => new Date().toISOString(),
} = {}) {
  if (!root) throw new Error('mountNoteWriters: a root element is required');
  if (!state) throw new Error('mountNoteWriters: the person’s row is required');
  let grants = [];
  let destroyed = false;
  const ac = new AbortController();
  const ticked = () => noteWritersFrom(state.get?.() || {});

  function render() {
    if (destroyed) return;
    const list = ticked();
    const cands = writerCandidates({ grants, ticked: list, now: now() });
    root.innerHTML = `
      <div class="nw">
        <h2 class="r-h2">Who may leave a note for ${esc(personName || 'this person')}</h2>
        <p class="h-hint">They can leave the note on these screens from their own sign-in, and see the note
          and the earlier ones. Each note shows the name they chose (or “${SOMEONE}”), and which sign-in
          wrote it is kept with the note. Nobody is on this list until you tick them.</p>
        ${cands.length ? `<ul class="r-list nw-list">${cands.map((c) => {
          const on = list.includes(c.account);
          return `<li data-account="${esc(c.account)}">
            <label><input type="checkbox" data-allow-note${on ? ' checked' : ''}${!c.current && !on ? ' disabled' : ''}>
              <b>${esc(c.account)}</b></label>
            <span class="h-hint">${c.label ? ` — ${esc(c.label)}` : ''} — ${esc(c.note)}</span>
          </li>`;
        }).join('')}</ul>`
        : '<p class="h-hint">Nobody may use these screens yet, so nobody can be added. Add them above first.</p>'}
        <p class="r-msg" data-nw-msg role="status"></p>
      </div>`;
  }
  const say = (t) => { const m = root.querySelector('[data-nw-msg]'); if (m) m.textContent = t || ''; };

  function write(next, msg) {
    try {
      const r = state.set({ [WRITERS_FIELD]: next });
      Promise.resolve(r).then(() => { render(); say(msg); }, (err) => { console.error('note writers', err); say('Could not save that.'); });
    } catch (err) { console.error('note writers', err); say('Could not save that.'); }
  }

  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-allow-note]')) return;
    const account = e.target.closest('[data-account]')?.dataset.account;
    if (!account) return;
    const list = ticked();
    if (e.target.checked) write([...list.filter((a) => a !== account), account], 'Added. They can leave a note now.');
    else write(list.filter((a) => a !== account), 'Removed. They can no longer leave a note.');
  }, { signal: ac.signal });

  const offSub = typeof state.subscribe === 'function' ? state.subscribe(() => render()) : null;
  render();
  const ready = (async () => {
    try { grants = (await loadGrants()) || []; } catch { grants = []; }
    render();
  })();
  return {
    ready, render, ticked,
    destroy() { destroyed = true; ac.abort(); try { offSub?.(); } catch { /* gone */ } root.innerHTML = ''; },
  };
}

// ---------------------------------------------------------------------------------------
// THE VISITOR'S SIDE
// ---------------------------------------------------------------------------------------

// The panel's own settings, kept in memory: this is a view of somebody else's note, so nothing about
// how it is drawn here is saved anywhere.
function memState(initial = {}) {
  let v = { ...initial };
  const subs = new Set();
  return { get: () => v, set(p) { v = { ...v, ...p }; subs.forEach((f) => f(v)); }, subscribe(f) { subs.add(f); return () => subs.delete(f); },
    flush() {}, load: async () => {}, destroy() { subs.clear(); } };
}

// "Read it aloud" on this machine, if it can speak. Optional; the button does nothing without it.
function browserVoice() {
  const s = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') return null;
  return { say(text) { try { s.cancel(); s.speak(new SpeechSynthesisUtterance(text)); } catch { /* no voice */ } return 'v'; },
    cancel() { try { s.cancel(); } catch { /* no voice */ } } };
}

export function mountNoteVisit(root, {
  personId = '',
  personName = '',
  user = null,
  fetchImpl = (...a) => fetch(...a),
  // (url, opts) -> an events handle. The real one talks to the server; a test hands in its own.
  eventsFor = (url, opts) => createEvents({ url, user, ...opts }),
  output = browserVoice(),
} = {}) {
  if (!root) throw new Error('mountNoteVisit: a root element is required');
  let torn = false;
  let screens = [];
  let screenId = null;
  let displayName = '';
  let note = null;
  let status = 'loading';       // 'loading' | 'ok' | 'refused' | 'error'
  let nameMsg = '';
  const ac = new AbortController();
  const who = personName || 'them';

  const get = async (url) => {
    const r = await fetchImpl(url, { headers: authHeaders(user), credentials: 'same-origin' });
    return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
  };

  function dropNote() { try { note?.destroy(); } catch { /* gone */ } note = null; }

  function render() {
    if (torn) return;
    dropNote();
    const head = `<h2 class="r-h2">A note for ${esc(who)}</h2>`;
    if (status === 'loading') { root.innerHTML = `<div class="nv">${head}<p class="h-hint">Loading…</p></div>`; return; }
    if (status === 'refused') {
      root.innerHTML = `<div class="nv" data-nv-refused>${head}<p class="h-hint">You cannot leave a note for ${esc(who)} yet.
        Whoever looks after ${esc(who)}’s screens can allow it, on their Remote tab.</p></div>`;
      return;
    }
    if (status === 'error') { root.innerHTML = `<div class="nv">${head}<p class="h-hint">The note could not be loaded. Try again later.</p></div>`; return; }
    if (!screens.length) {
      root.innerHTML = `<div class="nv" data-nv-none>${head}<p class="h-hint">${esc(who)} has no screens yet, so there is nowhere to leave a note.</p></div>`;
      return;
    }
    const cur = screens.find((s) => s.id === screenId) || screens[0];
    root.innerHTML = `
      <div class="nv">
        ${head}
        <p class="h-hint">Leave the note on ${esc(who)}’s screen. It shows on the screen with your name and the time,
          and every earlier note is kept.</p>
        ${screens.length > 1 ? `<div class="r-chips" data-nv-screens>${screens.map((s) => `
          <button class="r-chip${s.id === cur.id ? ' on' : ''}" data-nv-screen="${esc(s.id)}" aria-pressed="${s.id === cur.id}">${esc(s.name)}</button>`).join('')}</div>` : ''}
        ${cur.has_note ? '' : `<p class="h-hint" data-nv-nopanel>${esc(cur.name)} has no note panel on it yet. A note you leave is kept and shows once one is added.</p>`}
        <form class="h-new nv-name" data-nv-name-form>
          <label>You sign notes as
            <input type="text" data-nv-name maxlength="${MAX_NAME}" value="${esc(displayName)}" placeholder="${SOMEONE}" aria-label="Your name on notes"></label>
          <button type="submit" class="h-btn">Save name</button>
        </form>
        <p class="h-hint">Shown on every note you leave, on any screen. Leave it empty and your notes say “${SOMEONE}”.</p>
        <p class="r-msg" data-nv-name-msg role="status">${esc(nameMsg)}</p>
        <div class="nv-note" data-nv-note style="position:relative;min-height:320px"></div>
      </div>`;
    const host = root.querySelector('[data-nv-note]');
    try {
      note = mountModule('note', {
        mount: host, bus: createBus(), state: memState(), personId, instanceId: `visit-note-${personId}-${cur.id}`,
        user, makeEvents: (key, opts) => eventsFor(noteURL(personId, cur.id, key), opts || {}),
        author: () => displayName, authorLocked: true,
        ...(output ? { output } : {}),
      });
      note.init();
    } catch (err) { console.error('note visit: mount', err); host.textContent = 'The note could not be shown here.'; note = null; }
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-nv-screen]');
    if (!b) return;
    screenId = b.dataset.nvScreen;
    render();
  }, { signal: ac.signal });

  root.addEventListener('submit', async (e) => {
    if (!e.target.matches('[data-nv-name-form]')) return;
    e.preventDefault();
    const name = root.querySelector('[data-nv-name]')?.value || '';
    try {
      const r = await fetchImpl('/api/me/display-name', {
        method: 'PUT', credentials: 'same-origin',
        headers: { ...authHeaders(user), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) { nameMsg = (body && body.detail) || 'Could not save that name.'; }
      else { displayName = body?.display_name ?? ''; nameMsg = displayName ? `Saved. Your notes say “${displayName}”.` : `Saved. Your notes say “${SOMEONE}”.`; }
    } catch { nameMsg = 'Could not save that name.'; }
    const m = root.querySelector('[data-nv-name-msg]');
    if (m) m.textContent = nameMsg;
    const input = root.querySelector('[data-nv-name]');
    if (input && document.activeElement !== input) input.value = displayName;
  }, { signal: ac.signal });

  render();
  const ready = (async () => {
    if (!personId) { status = 'error'; render(); return; }
    try {
      const me = await get('/api/me');
      displayName = (me.body && typeof me.body.display_name === 'string') ? me.body.display_name : '';
      const s = await get(screensURL(personId));
      if (s.status === 403 || s.status === 404) status = 'refused';
      else if (!s.body) status = 'error';
      else {
        screens = Array.isArray(s.body.screens) ? s.body.screens : [];
        screenId = (screens.find((x) => x.has_note) || screens[0] || {}).id || null;
        status = 'ok';
      }
    } catch { status = 'error'; }
    render();
  })();

  return {
    ready,
    status: () => status,
    screens: () => screens.map((s) => ({ ...s })),
    screenId: () => screenId,
    displayName: () => displayName,
    note: () => note,
    destroy() { torn = true; ac.abort(); dropNote(); root.innerHTML = ''; },
  };
}
