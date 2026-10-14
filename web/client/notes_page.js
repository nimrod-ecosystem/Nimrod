// notes_page.js — NOTES ON A PHONE (notes.html). Row 2.85, 2026-10-14.
//
// Mike (chat's BZ item 3): "a plain Notes module or page for a phone, using the same person-record notes as 'Make a
// note'". THE SAME NOTES, NOT A SECOND LIST: the person's record, `nimrod-ai` -> `notes` (nimrod_ai.js `openAIStore`,
// nimrod_notes.js), the list "Make a note" on a screen keeps and the walkthrough wrap-up reads. A note written here
// is in the screen's list, and the other way round.
//
// A PAGE, NOT A MODULE. FOR a page: a phone has no dashboard, and a page is one address to keep on a home screen.
// AGAINST: a screen cannot hold it as a panel - but a screen already has "Make a note" in Nimrod's panel, which is
// where its notes come from. Typing is the phone's own keyboard, so its own dictation (the microphone on the
// keyboard) works with nothing from us: this page never opens a microphone.
//
// WHAT IT DOES: whose notes (when this login has more than one person; remembered on this phone), a box for a new
// note, every note newest first with its date and where it was made, Change and Remove on each, and the whole list
// copied or saved as a file - the same text "Copy all" makes on a screen (`notesToText`).
//   * REMOVE ASKS, IN PLACE. "Remove this note? Remove / Keep". Nobody answering leaves the note where it is.
//   * TWO PLACES AT ONCE: the record merges by note id (nimrod_notes.js `mergeNotesDoc`), so a note made on the
//     screen while this page changed another keeps both. When both changed the SAME note, this page's words win and
//     it says so, quoting the other words so they can be put back by hand.
//   * It reads the record again every 20 s while open (a slow safety net: a phone page is open for a minute, not all
//     day) and when the page is shown again.

import { authHeaders, httpError, isAuthError } from './auth.js';
import { createState } from './state.js';
import { AI_STATE_KEY } from './nimrod_ai.js';
import { cleanNotes, makeNote, addNote, removeNote, editNote, mergeNotesDoc, nearlyFull, notesToText, notesFileName,
  stamp, contextLine, NOTES_MAX, NOTE_MAX_CHARS } from './nimrod_notes.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const PERSON_KEY = 'nimrod:notes:person';
export const NOTES_POLL_MS = 20000;
// Where a note made here says it came from (its context line reads "page: notes.html").
export const NOTES_PAGE = 'notes.html';

export async function mountNotesPage(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  makeState = createState,
  pollMs = NOTES_POLL_MS,
  now = () => Date.now(),
  user = null,                         // the dev/test account override (auth.js); null on the real site
  base = '',
} = {}) {
  if (!root) throw new Error('mountNotesPage: a root element is required');
  const get = (k, d = '') => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };
  const ac = new AbortController();
  const on = (el, type, fn) => el?.addEventListener?.(type, fn, { signal: ac.signal });

  let people = [];
  let person = null;
  let handle = null;
  let unsub = null;
  let editing = '';                    // the id of the note whose words are being changed here
  let asking = '';                     // the id of the note whose Remove is asking
  let said = '';                       // one line, after a press (copied, saved, both changed)
  let failed = '';

  root.innerHTML = '<main class="nt" data-body><p class="nt-note">Loading…</p></main>';
  const body = () => root.querySelector('[data-body]');
  const q = (sel) => root.querySelector(sel);

  async function getJSON(path) {
    const res = await fetchImpl(`${base}${path}`, { headers: authHeaders(user), credentials: 'same-origin' });
    if (!res.ok) throw httpError(res, `${path} -> ${res.status}`);
    return res.json();
  }

  const notes = () => { try { return cleanNotes(handle?.get()?.notes); } catch { return []; } };

  function renderSignIn() {
    root.dataset.view = 'signin';
    body().innerHTML = `<h1>Notes</h1>
      <p>Sign in to see your notes: the same ones "Make a note" keeps on a screen.</p>
      <p><a class="nt-btn nt-primary" data-signin href="/auth/login?next=${encodeURIComponent(`/${NOTES_PAGE}`)}">Sign in</a></p>`;
  }

  function renderProblem(text) {
    root.dataset.view = 'problem';
    body().innerHTML = `<h1>Notes</h1><p class="nt-said" role="status" data-problem>${esc(text)}</p>`;
  }

  function noteHtml(n) {
    const c = contextLine(n.context);
    const where = n.where ? `at "${n.where}"` : '';
    const meta = [where, c].filter(Boolean).join(' · ');
    if (editing === n.id) {
      return `<article class="nt-item" data-note="${esc(n.id)}" data-editing>
        <p class="nt-when">${esc(stamp(n.at))}</p>
        <label class="nt-label"><span class="nt-sr">Change this note</span>
          <textarea class="nt-box" data-edit-box maxlength="${NOTE_MAX_CHARS}" rows="5">${esc(n.text)}</textarea></label>
        <div class="nt-row"><button type="button" class="nt-btn nt-primary" data-edit-save>Save</button>
          <button type="button" class="nt-btn" data-edit-cancel>Cancel</button></div>
      </article>`;
    }
    return `<article class="nt-item" data-note="${esc(n.id)}">
      <p class="nt-when">${esc(stamp(n.at))}${meta ? ` <span class="nt-where">${esc(meta)}</span>` : ''}</p>
      <p class="nt-text">${esc(n.text)}</p>
      ${asking === n.id
        ? `<div class="nt-row" role="group" aria-label="Remove this note?" data-asking><span class="nt-ask">Remove this note?</span>
            <button type="button" class="nt-btn nt-danger" data-remove-yes>Remove</button>
            <button type="button" class="nt-btn" data-remove-no>Keep</button></div>`
        : `<div class="nt-row"><button type="button" class="nt-btn" data-edit>Change</button>
            <button type="button" class="nt-btn" data-remove>Remove</button></div>`}
    </article>`;
  }

  function renderList() {
    const list = q('[data-list]');
    if (!list) return;
    const all = notes();
    const box = q('[data-edit-box]');
    const keep = box ? box.value : null;   // words being changed are not thrown away by a refresh
    list.innerHTML = all.length
      ? [...all].reverse().map(noteHtml).join('')
      : '<p class="nt-note" data-empty>No notes yet. Write one above, or say "make a note" to the computer on a screen.</p>';
    const again = q('[data-edit-box]');
    if (again && keep !== null) again.value = keep;
    if (editing && !all.some((n) => n.id === editing)) editing = '';
    const count = q('[data-count]');
    if (count) count.textContent = all.length ? `${all.length} note${all.length === 1 ? '' : 's'}` : '';
    const full = q('[data-full]');
    if (full) {
      full.hidden = !nearlyFull(all);
      full.textContent = `${all.length} of ${NOTES_MAX}. Copy them or save them as a file soon: past ${NOTES_MAX} the oldest goes.`;
    }
    const tools = q('[data-tools]');
    if (tools) tools.hidden = !all.length;
    const s = q('[data-said]');
    if (s) { s.textContent = said; s.hidden = !said; }
  }

  function renderPage() {
    root.dataset.view = 'notes';
    body().innerHTML = `
      <h1>Notes</h1>
      <p class="nt-lead">The same notes "Make a note" keeps on a screen. Whatever you write here is there too.</p>
      ${people.length > 1 ? `<label class="nt-field"><span>Whose notes</span>
        <select data-person>${people.map((p) => `<option value="${esc(p.id)}"${person && p.id === person.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>` : ''}
      <label class="nt-field"><span>A new note</span>
        <textarea class="nt-box" data-new maxlength="${NOTE_MAX_CHARS}" rows="4" placeholder="Type, or use your keyboard's microphone"></textarea></label>
      <button type="button" class="nt-btn nt-primary nt-big" data-save>Save note</button>
      <p class="nt-said" role="status" data-said hidden></p>
      ${failed ? `<p class="nt-said" role="alert" data-failed>${esc(failed)}</p>` : ''}
      <p class="nt-warn" data-full hidden></p>
      <div class="nt-head"><h2 class="nt-h2">Your notes</h2><span class="nt-count" data-count></span></div>
      <div class="nt-row" data-tools hidden>
        <button type="button" class="nt-btn" data-copy>Copy all</button>
        <button type="button" class="nt-btn" data-file>Save as a file</button>
      </div>
      <div class="nt-list" data-list></div>`;
    renderList();
  }

  function say(text) { said = text; const s = q('[data-said]'); if (s) { s.textContent = text; s.hidden = !text; } }

  async function save(list) {
    handle.set({ notes: list });
    try { await handle.flush(); failed = ''; return true; }
    catch (err) {
      failed = isAuthError(err) ? 'Not saved: you are signed out. Sign in again; your words are still in the box.'
        : `Not saved: ${String(err?.message || err)}. Try again in a moment.`;
      const f = q('[data-failed]');
      if (f) f.textContent = failed; else renderPage();
      return false;
    }
  }

  async function openPerson(p) {
    try { unsub?.(); } catch { /* gone */ }
    try { handle?.destroy?.(); } catch { /* gone */ }
    person = p; editing = ''; asking = ''; said = ''; failed = '';
    put(PERSON_KEY, p.id);
    handle = makeState({
      url: `${base}/api/people/${encodeURIComponent(p.id)}/state/${AI_STATE_KEY}`, user, pollMs,
      merge: mergeNotesDoc,
      onLost: (lost) => {
        const words = lost.map((n) => `"${n.text.length > 120 ? `${n.text.slice(0, 119)}…` : n.text}"`).join(', ');
        say(`That note was changed somewhere else at the same time. Your words were kept; the other words were: ${words}`);
      },
    });
    try { await handle.load(); }
    catch (err) {
      if (isAuthError(err)) { renderSignIn(); return; }
      renderProblem('Your notes could not be read just now. Check the connection and reload this page.');
      return;
    }
    renderPage();
    unsub = handle.subscribe(() => renderList());
    try { handle.startPolling(); } catch { /* reads on show instead */ }
  }

  on(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'visible' && handle && person) handle.load?.().then(renderList, () => {});
  });

  on(root, 'change', (e) => {
    const sel = e.target.closest?.('[data-person]');
    if (!sel) return;
    const p = people.find((x) => x.id === sel.value);
    if (p && (!person || p.id !== person.id)) openPerson(p);
  });

  on(root, 'click', async (e) => {
    const t = e.target.closest?.('button');
    if (!t || !handle) return;
    const item = t.closest('[data-note]');
    const id = item ? item.getAttribute('data-note') : '';
    if (t.matches('[data-save]')) {
      const box = q('[data-new]');
      const n = makeNote(box?.value || '', { at: now(), context: { page: NOTES_PAGE } });
      if (!n) { say('Write something first.'); return; }
      if (await save(addNote(notes(), n))) { box.value = ''; say('Saved.'); renderList(); }
    } else if (t.matches('[data-edit]')) {
      editing = id; asking = ''; renderList();
      q('[data-edit-box]')?.focus?.();
    } else if (t.matches('[data-edit-cancel]')) {
      editing = ''; renderList();
    } else if (t.matches('[data-edit-save]')) {
      const words = q('[data-edit-box]')?.value || '';
      if (!words.trim()) { say('A note needs words. To take it away, use Remove.'); return; }
      const next = editNote(notes(), id, words);
      editing = '';
      if (await save(next)) say('Changed.');
      renderList();
    } else if (t.matches('[data-remove]')) {
      asking = id; editing = ''; renderList();
    } else if (t.matches('[data-remove-no]')) {
      asking = ''; renderList();
    } else if (t.matches('[data-remove-yes]')) {
      asking = '';
      if (await save(removeNote(notes(), id))) say('Removed.');
      renderList();
    } else if (t.matches('[data-copy]')) {
      const text = notesToText(notes(), { at: now() });
      try { await nav.clipboard.writeText(text); say('Copied. Paste them wherever you like.'); }
      catch { say('This browser would not copy. Use "Save as a file" instead.'); }
    } else if (t.matches('[data-file]')) {
      const text = notesToText(notes(), { at: now() });
      try {
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
        a.download = notesFileName(now());
        a.hidden = true; doc.body.append(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch { /* gone */ } }, 5000);
        say('Saved as a file.');
      } catch { say('This browser would not save a file. Use "Copy all" instead.'); }
    }
  });

  // Start: who is signed in, and whose notes.
  try {
    const got = await getJSON('/api/people');
    people = (got.people || []).filter((p) => p && p.id).map((p) => ({ id: p.id, name: p.name || 'Me' }));
  } catch (err) {
    if (isAuthError(err)) renderSignIn();
    else renderProblem('Notes could not be loaded just now. Check the connection and reload this page.');
    return api();
  }
  if (!people.length) { renderProblem('This login has nobody to keep notes for yet.'); return api(); }
  const wantId = new URLSearchParams(search || '').get('person') || get(PERSON_KEY, '');
  await openPerson(people.find((p) => p.id === wantId) || people[0]);
  return api();

  function api() {
    return {
      person: () => person,
      notes,
      handle: () => handle,
      destroy: () => {
        ac.abort();
        try { unsub?.(); } catch { /* gone */ }
        try { handle?.flush?.()?.catch?.(() => {}); } catch { /* gone */ }
        try { handle?.destroy?.(); } catch { /* gone */ }
      },
    };
  }
}
