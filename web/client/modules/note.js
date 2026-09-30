// modules/note.js — A NOTE FROM SOMEONE: one short note, who wrote it, when, and every earlier one.
//
// Row 2.37 ("a note-from-someone module that a visitor can change", docs/for_chat/MIKE_CHANGE_LIST.md,
// private repo) and Design's room-add-ons spec §12: *"Who writes it: a visitor leaves or changes it
// from their own screen or the kiosk. What it shows: the author and the time. Every change is kept in
// the note's history. Buttons: Read it aloud / Change the note. Where it can go: it fits a sticky note,
// a desk close-up, or the fridge."*
//
// THE NOTE IS ITS HISTORY. Every change is one row appended to a per-profile, append-only events
// stream (`ctx.makeEvents('note')`, the same shared-stream shape the points ledger uses), and the note
// on show is simply the newest row. So "every change is kept" is not a promise this file has to keep —
// the stream cannot be edited, and the server stamps the time (the client clock is never the record).
// Putting an old note back is a NEW row that copies it, so even that is in the history.
//
// WHO WROTE IT. Each row carries `author`, a plain name typed or picked when the note is changed, or
// "Someone" when nobody said. A host that knows who is signed in on the screen can hand the name in as
// `ctx.author` and the change form starts on it; no host does that yet, because the site has no
// display names for accounts. On the kiosk, the form offers the names already in the note's history
// (one press each on a switch), "Someone", and a box to type a new one. It never guesses the last
// writer: on a shared screen that would sign a new visitor's note with the previous visitor's name.
//
// WHO CAN WRITE — THE SEAM, AND WHAT IS MISSING. Writes go through whatever `makeEvents` the host
// hands in, so this module writes wherever its screen's account may write. That covers the kiosk, and
// a family member's own phone or laptop signed into the SAME account. It does NOT yet cover a visitor
// on their OWN account: the server only lets an account write its own profiles (`owned_profile` in
// app.py), and `grants.py` grants DRIVING a screen, not writing to it. Needed, and listed for Mike: a
// grant-scoped append route for this one stream, and a host page that mounts the note for a granted
// person. Nothing here has to change when that lands — the host hands in a different `makeEvents`.
//
// A SWITCH REACHES EVERYTHING. `next`/`prev` walk every button in reading order and wrap; `select`
// presses the lit one; `back` closes the change form or the history. The first `select` only reveals
// the highlight (the calculator's rule). Somebody who cannot type changes the note by picking one of
// the ready-made notes, then a name, then Save — the ready-made list is a setting.
//
// DEFAULTS CHOSEN HERE — each is a setting and each is on Mike's list with its argument:
//   * The ready-made notes: six short, warm, general lines (`READY_NOTES`). Six keeps a switch walk
//     short; general, because the same list is offered to every visitor on every screen.
//   * "Read it aloud" says who it is from as well as the note. A note read without its sender loses
//     half of what it is.
//   * A new note is NOT read aloud by itself when it arrives. Speech nobody asked for, at any hour, in
//     a shared room, is a bigger surprise than a note appearing; it is one setting away.
//   * Changing the note on the panel is allowed. A panel somebody might press by accident (the fridge
//     in a scanned room) can turn it off; the note is still shown, and still changes from elsewhere.

import { registerModule } from '../module.js';

export const NOTE_STREAM = 'note';
export const NOTE_KIND = 'note';
export const SOMEONE = 'Someone';
export const MAX_TEXT = 280;
export const MAX_NAME = 40;
export const DEFAULT_PAPER = '#fbf3a8';

// *** THE READY-MADE NOTES. *** Short enough to fit a sticky note and be read from across a room, and
// true whoever leaves them. Separated by " | " in the setting, so it stays one text row in the menu.
export const READY_NOTES = Object.freeze([
  'Thinking of you.',
  'I love you.',
  'I was here today. See you soon.',
  'Back soon.',
  'Call me when you can.',
  'Have a good day.',
]);
export const READY_SEP = ' | ';

const SETTINGS = [
  { key: 'readyNotes', label: 'Ready-made notes', kind: 'text', default: READY_NOTES.join(READY_SEP), level: 'standard',
    note: 'Offered when the note is changed, so it can be changed without typing. Separate them with | .' },
  { key: 'readAuthor', label: 'Read it aloud', default: true, level: 'standard',
    onLabel: 'Says who it is from, then the note', offLabel: 'Says only the note' },
  { key: 'announceNew', label: 'When a new note arrives', default: false, level: 'standard',
    onLabel: 'Read it aloud by itself', offLabel: 'Just show it' },
  { key: 'allowChange', label: 'Change the note from this panel', default: true, level: 'standard',
    onLabel: 'Allowed', offLabel: 'Not from this panel' },
  { key: 'paper', label: 'Paper colour', kind: 'color', default: DEFAULT_PAPER, level: 'standard' },
  { key: 'tilt', label: 'Tilted like a sticky note', default: true, level: 'advanced', onLabel: 'Yes', offLabel: 'No, straight' },
  { key: 'which', label: 'Which note', kind: 'choice', default: 'note', level: 'advanced',
    options: [{ value: 'note', label: 'The note' }, { value: 'note2', label: 'A second note' }, { value: 'note3', label: 'A third note' }],
    note: 'Two panels on the same note show the same thing. A second note is for a second place, like the fridge and the desk.' },
];
export const DEFAULTS = Object.freeze(Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------
// PURE HELPERS — exported so the suite checks the rules without a DOM
// ---------------------------------------------------------------------------------------

export const cleanText = (t) => String(t == null ? '' : t).replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);
export const cleanName = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
/** Whoever wrote it, or "Someone" when nobody said. */
export const authorOf = (e) => cleanName(e?.data?.author) || SOMEONE;

/** When a row was written, in ms: the server's stamp; the row's own clock only if there is none yet. */
export function whenOf(e) {
  const t = Date.parse(e?.created_at || '');
  if (Number.isFinite(t)) return t;
  const a = Number(e?.data?.at);
  return Number.isFinite(a) ? a : 0;
}

/** The note rows, oldest first, whatever order they arrived in. Rows that are not notes are ignored. */
export function noteRows(events) {
  return (Array.isArray(events) ? events : [])
    .filter((e) => e && e.kind === NOTE_KIND && e.data && cleanText(e.data.text))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (whenOf(a.e) - whenOf(b.e)) || ((Number(a.e.id) || 0) - (Number(b.e.id) || 0)) || (a.i - b.i))
    .map((x) => x.e);
}
/** The note on show: the newest. */
export const currentNote = (events) => { const r = noteRows(events); return r.length ? r[r.length - 1] : null; };

/** Names already in the history, newest first, "Someone" left out (it is always offered anyway). */
export function knownAuthors(events, limit = 4) {
  const seen = new Set();
  const out = [];
  for (const e of noteRows(events).reverse()) {
    const a = authorOf(e);
    if (a === SOMEONE || seen.has(a.toLowerCase())) continue;
    seen.add(a.toLowerCase());
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

/** The ready-made notes from the setting's one line; the built-in list if it is empty. */
export function parseReady(line) {
  const list = String(line == null ? '' : line).split('|').map((s) => cleanText(s)).filter(Boolean);
  return list.length ? list.slice(0, 12) : [...READY_NOTES];
}

const pad = (n) => String(n).padStart(2, '0');
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** "today 11:02", "yesterday 18:30", or "Mon 28 Sep 09:12" — local time, as the person reads it. */
export function whenWords(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms);
  let time;
  try { time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d); }
  catch { time = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  if (localDay(ms) === localDay(now)) return `today ${time}`;
  if (localDay(ms) === localDay(now - 86400000)) return `yesterday ${time}`;
  let day;
  try { day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(d); }
  catch { day = localDay(ms); }
  return `${day} ${time}`;
}

/** Big words for a short note, smaller for a long one: a sticky note is read from across a room. */
export const sizeFor = (text) => { const n = String(text || '').length; return n <= 40 ? 'big' : n <= 120 ? 'mid' : 'small'; };

function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export const contrastRatio = (a, b) => { const x = lum(a), y = lum(b); if (x == null || y == null) return 0; const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05); };
export const INKS = Object.freeze(['#2a2414', '#fbf7ec']);
/** The ink for a paper: whichever of a dark and a light ink reads better on it. Any paper stays readable. */
export function inkFor(paper) {
  const p = lum(paper) == null ? DEFAULT_PAPER : paper;
  return contrastRatio(p, INKS[0]) >= contrastRatio(p, INKS[1]) ? INKS[0] : INKS[1];
}

/** The words read aloud. */
export function spoken(e, { readAuthor = true } = {}) {
  if (!e) return 'There is no note yet.';
  const text = cleanText(e.data.text);
  if (!readAuthor) return text;
  const a = authorOf(e);
  return a === SOMEONE ? `A note: ${text}` : `A note from ${a}: ${text}`;
}

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------

registerModule(
  { type: 'note', title: 'Note from someone', core: 'new',
    description: 'A short note somebody leaves, with who wrote it and when. It can be read aloud, and '
      + 'changed from the screen or from another one; every earlier note is kept.',
    // `local`: it shows and keeps a note with no server (kept only on this panel then). Sharing it
    // across panels and screens needs the platform's events stream.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    let cfg = { ...DEFAULTS };
    let stream = null;          // the shared events handle, or null (then rows live in this panel's state)
    let streamKey = null;
    let rows = [];              // every event seen, as the stream gives them
    let view = 'note';          // 'note' | 'edit' | 'history'
    let draft = { text: '', author: null, typedName: '' };
    let err = '';
    let lit = -1;
    let lastSeenId = null;      // the newest row already on show (so only a NEW one is announced)
    let lastSpeech = null;
    let saving = false;
    let dead = false;
    let rootEl = null;
    let offStream = null;

    const ctxAuthor = () => { try { return cleanName(typeof ctx.author === 'function' ? ctx.author() : ctx.author); } catch { return ''; } };

    function say(text) {
      if (!text || !ctx.output?.say) return;
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: 'note' });
      } catch (e) { console.error('note: say', e); }
    }

    // ---- the stream ------------------------------------------------------------------------
    const keyFor = (which) => (['note', 'note2', 'note3'].includes(which) ? (which === 'note' ? NOTE_STREAM : which) : NOTE_STREAM);
    function openStream() {
      const key = keyFor(cfg.which);
      if (stream && key === streamKey) return;
      closeStream();
      streamKey = key;
      rows = [];
      lastSeenId = null;
      if (typeof ctx.makeEvents === 'function') {
        try { stream = ctx.makeEvents(key, { limit: 200, pollMs: 10000 }); } catch (e) { stream = null; console.error('note: no stream', e); }
      }
      if (stream) {
        offStream = stream.subscribe?.((snap) => { rows = snap?.events || []; arrived(); render(); }) || null;
        Promise.resolve(stream.load?.()).catch(() => {})
          .then(() => { if (dead) return; rows = stream?.get?.()?.events || rows; arrived(true); render(); stream?.startPolling?.(); })
          .catch(() => {});
      } else {
        const own = state?.get?.() || {};
        rows = Array.isArray(own[`rows_${key}`]) ? own[`rows_${key}`] : [];
        arrived(true);
      }
    }
    function closeStream() {
      try { offStream?.(); } catch { /* gone */ }
      offStream = null;
      if (stream) { try { stream.destroy?.(); } catch { /* gone */ } }
      stream = null;
    }
    // A row we have not seen before. The first load only notes what is there; after that, a new one
    // can be read aloud if the panel is set to.
    function arrived(first = false) {
      const cur = currentNote(rows);
      const id = cur ? `${cur.id ?? ''}:${whenOf(cur)}` : null;
      if (id === lastSeenId) return;
      const was = lastSeenId;
      lastSeenId = id;
      if (!first && was !== null && cur && cfg.announceNew && !saving) say(spoken(cur, cfg));
    }

    async function append(data) {
      const row = { kind: NOTE_KIND, data: { ...data, at: now() } };
      if (stream) {
        await stream.append(NOTE_KIND, row.data);
        rows = stream.get?.()?.events || rows;
      } else {
        rows = [...rows, { ...row, id: rows.length + 1, created_at: new Date(now()).toISOString() }];
        try { state?.set?.({ [`rows_${streamKey}`]: rows.slice(-200) }); } catch { /* memory only */ }
      }
      lastSeenId = null;
      arrived(true);
    }

    // ---- actions -----------------------------------------------------------------------------
    function openEdit() {
      // Starts on the current note's words, so a keyboard can change one word rather than retype it.
      // A ready-made note REPLACES the words, so this costs a switch user nothing. The name does NOT
      // carry over: whoever changes the note is its author now.
      const cur = currentNote(rows);
      draft = { text: cur ? cleanText(cur.data.text) : '', author: ctxAuthor() || SOMEONE, typedName: '' };
      err = '';
      view = 'edit';
      if (lit >= 0) lit = 0;
      render();
      mount.querySelector('[data-note-input]')?.focus?.({ preventScroll: true });
    }
    function close() { view = 'note'; err = ''; if (lit >= 0) lit = 0; render(); }
    function readDraft() {
      const input = mount.querySelector('[data-note-input]');
      if (input) draft.text = input.value;
      const name = mount.querySelector('[data-note-name]');
      if (name) draft.typedName = name.value;
    }
    async function save() {
      readDraft();
      const text = cleanText(draft.text);
      if (!text) { err = 'Write a note, or pick one, first.'; render(); return; }
      const author = cleanName(draft.typedName) || cleanName(draft.author) || SOMEONE;
      saving = true;
      try {
        await append({ text, author, via: 'changed' });
        view = 'note'; err = '';
        if (lit >= 0) lit = 0;
      } catch (e) {
        console.error('note: save', e);
        err = 'That did not save. The note is still here; try Save again.';
      } finally { saving = false; }
      render();
    }
    async function putBack(i) {
      const list = noteRows(rows);
      const e = list[i];
      if (!e) return;
      saving = true;
      try { await append({ text: cleanText(e.data.text), author: authorOf(e), via: 'put back', from: e.id ?? null }); view = 'note'; err = ''; }
      catch (x) { console.error('note: put back', x); err = 'That did not save. Try again.'; }
      finally { saving = false; }
      if (lit >= 0) lit = 0;
      render();
    }

    function act(b) {
      if (!b || dead) return;
      const a = b.dataset.act;
      if (a !== 'save') readDraft();
      switch (a) {
        case 'read': say(spoken(currentNote(rows), cfg)); return;
        case 'change': openEdit(); return;
        case 'history': view = 'history'; if (lit >= 0) lit = 0; render(); return;
        case 'close': close(); return;
        case 'ready': draft.text = b.dataset.text || ''; err = ''; render(); return;
        case 'author': draft.author = b.dataset.name || SOMEONE; draft.typedName = ''; render(); return;
        case 'save': save(); return;
        case 'putback': putBack(Number(b.dataset.i)); return;
        default:
      }
    }

    // ---- drawing ---------------------------------------------------------------------------
    const btn = (act2, label, extra = '') => `<button type="button" class="nt-btn" data-walk data-act="${act2}"${extra}>${label}</button>`;

    function noteHtml() {
      const cur = currentNote(rows);
      const paper = /^#[0-9a-f]{6}$/i.test(String(cfg.paper || '')) ? cfg.paper : DEFAULT_PAPER;
      const style = `--note-paper:${paper};--note-ink:${inkFor(paper)}`;
      const body = cur
        ? `<p class="nt-text" data-note-text data-size="${sizeFor(cleanText(cur.data.text))}">${esc(cleanText(cur.data.text))}</p>
           <p class="nt-who" data-note-who>${esc(authorOf(cur))} · ${esc(whenWords(whenOf(cur), now()))}</p>`
        : '<p class="nt-empty" data-note-empty>No note yet.</p>';
      const count = noteRows(rows).length;
      return `
        <div class="nt-paper" data-tilt="${cfg.tilt ? 1 : 0}" style="${style}" role="figure" aria-label="The note">${body}</div>
        <div class="nt-btns">
          ${cur ? btn('read', 'Read it aloud') : ''}
          ${cfg.allowChange ? btn('change', cur ? 'Change the note' : 'Leave a note') : ''}
          ${count > 1 ? btn('history', `Earlier notes (${count - 1})`) : ''}
        </div>`;
    }

    function editHtml() {
      const ready = parseReady(cfg.readyNotes);
      const names = [...new Set([ctxAuthor(), ...knownAuthors(rows)].filter(Boolean))];
      const chosen = cleanName(draft.typedName) ? null : (cleanName(draft.author) || SOMEONE);
      const nameBtn = (n) => btn('author', esc(n), ` data-name="${esc(n)}" aria-pressed="${chosen === n}"`);
      return `
        <div class="nt-edit" role="group" aria-label="Change the note">
          <p class="nt-head">The note</p>
          <textarea class="nt-input" data-note-input maxlength="${MAX_TEXT}" aria-label="The note"
            placeholder="Type a note, or pick one below">${esc(draft.text)}</textarea>
          <p class="nt-hint">Or pick one:</p>
          <div class="nt-choices">${ready.map((t) => btn('ready', esc(t), ` data-text="${esc(t)}" aria-pressed="${cleanText(draft.text) === t}"`)).join('')}</div>
          <p class="nt-head">Who is it from?</p>
          <div class="nt-choices">${names.map(nameBtn).join('')}${nameBtn(SOMEONE)}</div>
          <input class="nt-name" data-note-name type="text" maxlength="${MAX_NAME}" aria-label="Another name" placeholder="Or type a name" value="${esc(draft.typedName)}">
          ${err ? `<p class="nt-err" role="alert" data-note-err>${esc(err)}</p>` : ''}
          <div class="nt-btns">${btn('save', 'Save')}${btn('close', 'Cancel')}</div>
        </div>`;
    }

    function historyHtml() {
      const list = noteRows(rows);
      const items = list.map((e, i) => ({ e, i })).reverse();
      return `
        <p class="nt-head">Every note, newest first</p>
        <ol class="nt-hist" data-note-history>${items.map(({ e, i }) => `
          <li${i === list.length - 1 ? ' data-current' : ''}>
            <p class="nt-htext">${esc(cleanText(e.data.text))}</p>
            <p class="nt-hwho">${esc(authorOf(e))} · ${esc(whenWords(whenOf(e), now()))}${e.data.via === 'put back' ? ' · put back' : ''}${i === list.length - 1 ? ' · on show now' : ''}</p>
            ${i === list.length - 1 || !cfg.allowChange ? '' : btn('putback', 'Put this one back', ` data-i="${i}"`)}
          </li>`).join('')}</ol>
        ${err ? `<p class="nt-err" role="alert">${esc(err)}</p>` : ''}
        <div class="nt-btns">${btn('close', 'Back to the note')}</div>`;
    }

    function render() {
      if (dead || !rootEl) return;
      if (view === 'edit' && !cfg.allowChange) view = 'note';
      const hadFocus = mount.ownerDocument?.activeElement;
      const typing = view === 'edit' && hadFocus && (hadFocus.matches?.('[data-note-input],[data-note-name]'));
      const focusSel = typing ? (hadFocus.matches('[data-note-input]') ? '[data-note-input]' : '[data-note-name]') : null;
      rootEl.innerHTML = `<div class="nt" data-note data-view="${view}">${view === 'edit' ? editHtml() : view === 'history' ? historyHtml() : noteHtml()}</div>`;
      if (focusSel) { const el = mount.querySelector(focusSel); el?.focus?.({ preventScroll: true }); try { el.setSelectionRange?.(el.value.length, el.value.length); } catch { /* not a text field */ } }
      paintLit();
    }

    // ---- the walk ----------------------------------------------------------------------------
    const walk = () => [...mount.querySelectorAll('[data-walk]')].filter((b) => !b.disabled && !b.closest('[hidden]'));
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
      const list = walk();
      if (!list.length) return;
      if (lit < 0) { lit = 0; paintLit(); return; }
      act(list[lit]);
    }

    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      if (b && mount.contains(b)) act(b);
    }
    function onKey(e) {
      if (view !== 'edit') return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target.matches?.('[data-note-name]'))) { e.preventDefault(); save(); }
    }
    function onInput(e) {
      if (e.target.matches?.('[data-note-input]')) draft.text = e.target.value;
      if (e.target.matches?.('[data-note-name]')) draft.typedName = e.target.value;
    }

    const applyCfg = (s) => {
      const snap = s || {};
      const next = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (snap[k] !== undefined) next[k] = snap[k];
      cfg = next;
    };

    return {
      __probe: () => ({ view, lit, draft: { ...draft }, rows: noteRows(rows).map((e) => ({ ...e.data, id: e.id })),
        current: currentNote(rows)?.data || null, streamKey, cfg: { ...cfg }, litAct: lit >= 0 ? walk()[lit]?.dataset.act : null,
        litLabel: lit >= 0 ? walk()[lit]?.textContent.trim() : null }),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../note.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-note-css href="${esc(cssHref)}">` : ''}<div class="nt-wrap" data-note-root></div>`;
        rootEl = mount.querySelector('[data-note-root]');
        mount.addEventListener('click', onClick);
        mount.addEventListener('keydown', onKey);
        mount.addEventListener('input', onInput);
        applyCfg(state?.get?.());
        openStream();
        state?.subscribe?.((s) => { const before = cfg.which; applyCfg(s); if (cfg.which !== before) openStream(); render(); });
        bus.subscribe('note/next', () => moveLit(1));
        bus.subscribe('note/prev', () => moveLit(-1));
        bus.subscribe('note/select', () => selectLit());
        bus.subscribe('note/back', () => { if (view !== 'note') close(); });
        render();
      },
      onResize() {},
      onHide() { try { state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        mount.removeEventListener('click', onClick);
        mount.removeEventListener('keydown', onKey);
        mount.removeEventListener('input', onInput);
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
        closeStream();
      },
    };
  },
);
