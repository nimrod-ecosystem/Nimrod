// wording_edit.js - CHANGE THE SITE'S WORDS WHERE THEY ARE (row 2.123, chat's note CR 1).
//
// Mike, 2026-10-25: "The wall of text they gave me would've taken much longer than just reading through the whole site
// myself. Is there some sort of edit mode for me where I can just change things on the site like wording?" So: open any
// page of the site with `?wording=1` and every click on words opens them to be retyped, on the page, as they sit. The
// page shows the new words at once (to see how they read there); nothing is saved to the site. "Copy changes" copies
// `page<TAB>words on the page<TAB>new words` lines, and web/tools/export_site_text.py --apply-page-edits puts each one
// into the code - found by its words, since a page never knows the file - and refuses, with the reason, whatever
// would need a guess. A person (Code) then reads each applied line against what the code does before committing.
//
// HOW FAR IT REACHES (said where it is turned on, too):
//   reaches     words in the pages and the scripts, as written; words with parts the code fills in ("You have 3 new
//               notes"), as long as those parts stay in the new words
//   by hand     words with a link or bold inside them (the page cannot show where the tags go); words in more than one
//               file that the page does not settle; words built while the page runs, or data - a person's name, a
//               lesson, a setting's value - which the code does not hold as words at all
//   not yet     words that are not on the page as text: a button's hover title, a box's placeholder, a screen
//               reader's label
//
// NOT A GATE (CLAUDE.md: a screen must never enter a state that only an input can leave, when the person in front of it
// cannot give that input). It is turned on only by somebody typing the address; Done (always on its bar) or `?wording=0`
// turns it off; and it turns itself off after IDLE_OFF_MS with no change, keeping the changes. While it is on, a click on
// words does not do what it would do (a button does not press): that is the point of it, and the bar says so.
//
// KEPT: the changes and "it is on" in this browser's storage (a draft in progress, per viewer - never shared, never on
// the server), so moving between pages keeps both. Storage that refuses (a private window) only means it is not kept.
//
// *** ONE DRAFT LIST, TWO WAYS IN (row 2.145 step 3, 2026-10-31). *** On a dashboard, `?wording=1` opens THE ONE EDITOR
// with its Words shown instead of this bar (editor.js, editor_words.js; kiosk.js reads the address, kiosk.html's
// `<meta name="nimrod-wording" content="editor">` tells theme.js not to start the bar there). Both write the SAME list
// in the same key through the same rule (`recordChange` -> `withChange`), and both copy it the same way
// (`changesText`), so a change made in one is in the other's "Copy changes". The pieces the editor shares are exported
// below (`norm`, `readChanges`, `recordChange`, `showWordsInPlace`); importing them starts nothing.

export const ON_KEY = 'nimrod.wording.on';
export const CHANGES_KEY = 'nimrod.wording.changes.v1';
// How long with no change before it turns itself off. Twenty minutes: long enough to read a page slowly and think about
// a line; short enough that a screen it was left on comes back to itself the same afternoon.
export const IDLE_OFF_MS = 20 * 60 * 1000;
export const COPY_HEAD = '# nimrod wording changes (site words edited in place)';
// The longest run of words that counts as one line when it has other elements inside it. 300 characters is a long
// paragraph; past that, a click has landed on a container (a panel with a stray word in it), not on a sentence.
export const LINE_MAX = 300;
const BAR_ID = 'wording-edit-bar';
const STYLE_ID = 'wording-edit-css';

const store = {
  get(k) { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set(k, v) { try { globalThis.localStorage?.setItem(k, v); } catch { /* not kept */ } },
  del(k) { try { globalThis.localStorage?.removeItem(k); } catch { /* nothing kept */ } },
};
/** Words as the copied lines and the apply tool hold them: every run of spaces and line breaks one space. PURE.
 * (row 2.145 step 3: exported, so the editor's Words keep the same one line.) */
export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Whether `search` (a location.search) turns it on (true), off (false), or says nothing (null). PURE. */
export function wordingParam(search = '') {
  const m = /[?&]wording(?:=([^&]*))?(?:&|$)/.exec(String(search));
  if (!m) return null;
  return !['0', 'off', 'false', 'no'].includes(String(m[1] ?? '1').toLowerCase());
}

/** `href` with `wording` taken out of it (row 2.145 step 3: the kiosk takes it out once read, so the screen's own
 * reloads do not open the editor again). PURE. The same shape as restart.js `withoutBootParam`. */
export function withoutWordingParam(href = '') {
  try {
    const u = new URL(href, 'http://x.invalid');
    if (!u.searchParams.has('wording')) return href;
    u.searchParams.delete('wording');
    return String(href).startsWith('http') ? u.href : `${u.pathname}${u.search}${u.hash}`;
  } catch { return href; }
}

/** Forget "it is on" in this browser (`?wording=0`), without starting anything. */
export function forgetWordingOn() { store.del(ON_KEY); }

/** The changes kept in this browser (the one draft list). Never throws: a refusing store is an empty list. */
export function readChanges() {
  let list = [];
  try { list = JSON.parse(store.get(CHANGES_KEY) || '[]'); } catch { list = []; }
  return Array.isArray(list) ? list.filter((c) => c && typeof c.old === 'string' && typeof c.new === 'string') : [];
}

/** One change made and kept, by `withChange`'s rule (a change back to the original drops it). Returns the list. */
export function recordChange({ page, old, now }) {
  const list = withChange(readChanges(), { page, old, now });
  store.set(CHANGES_KEY, JSON.stringify(list));
  return list;
}

/**
 * Show `words` in place in `el` (to see how they read there) and mark it changed. Returns a function that puts the
 * element back exactly as it was. One run of words: set it; words around other elements: only the first run changes,
 * the rest is left (the copied line still carries the whole sentence).
 */
export function showWordsInPlace(el, words) {
  if (!el || !el.childNodes) return () => {};
  const runs = [...el.childNodes].filter((c) => c.nodeType === 3 && norm(c.nodeValue));
  const wasMarked = el.hasAttribute?.('data-wording-changed');
  let undo = () => {};
  if (runs.length === 1 && el.children.length === 0) {
    const was = el.textContent;
    el.textContent = words;
    undo = () => { el.textContent = was; };
  } else if (runs.length) {
    const run = runs[0];
    const was = run.nodeValue;
    run.nodeValue = ` ${words} `;
    undo = () => { run.nodeValue = was; };
  }
  el.setAttribute?.('data-wording-changed', '');
  return () => { undo(); if (!wasMarked) el.removeAttribute?.('data-wording-changed'); };
}

/** The changes, with one change to the same words on the same page replacing the last (and a change back to the
 * original dropping it). `list` is [{ page, old, new }]. PURE. */
export function withChange(list, { page, old, now }) {
  const out = (Array.isArray(list) ? list : []).map((c) => ({ ...c }));
  const o = norm(old), n = norm(now);
  if (!o) return out;
  // Retyping words already changed on this page edits that change: its ORIGINAL words are what the code holds.
  const prior = out.findIndex((c) => c.page === page && (c.new === o || c.old === o));
  if (prior >= 0) {
    if (n === out[prior].old) out.splice(prior, 1);
    else out[prior].new = n;
    return out;
  }
  if (n !== o) out.push({ page, old: o, new: n });
  return out;
}

/** The text "Copy changes" copies: a header, then `page<TAB>words<TAB>new words` (a line break as `\n`). PURE. */
export function changesText(list, date = '') {
  const cell = (s) => String(s).replace(/\t/g, ' ').replace(/\r?\n/g, '\\n');
  return [`${COPY_HEAD}${date ? `, ${date}` : ''}`, '# page\twords on the page\tnew words',
    ...(list || []).map((c) => `${cell(c.page)}\t${cell(c.old)}\t${cell(c.new)}`)].join('\n') + '\n';
}

/** The element whose words a click on `node` means: the nearest one with words of its own (not only its children's). */
export function wordsElementAt(node) {
  let el = node && node.nodeType === 1 ? node : node?.parentElement || null;
  for (let k = 0; el && k < 6; k += 1, el = el.parentElement) {
    if (['SCRIPT', 'STYLE', 'svg', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return null;
    if ([...el.childNodes].some((c) => c.nodeType === 3 && norm(c.nodeValue))) {
      // A container with a stray word and whole panels inside is not one line of words.
      return el.children.length && norm(el.textContent).length > LINE_MAX ? null : el;
    }
  }
  return null;
}

function ensureCss(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
#${BAR_ID}{position:fixed;right:12px;bottom:12px;z-index:2147483000;max-width:min(560px,calc(100vw - 24px));display:flex;flex-wrap:wrap;gap:8px;align-items:center;
  padding:10px 12px;border-radius:12px;background:#1b2b34;color:#fff;font:15px/1.35 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)}
#${BAR_ID} button{min-height:40px;padding:6px 12px;border-radius:8px;border:0;font:inherit;font-weight:600;cursor:pointer;background:#fff;color:#1b2b34}
#${BAR_ID} .we-say{flex:1 1 220px}
#${BAR_ID} details{flex-basis:100%;font-size:13px;opacity:.9}
#${BAR_ID} .we-edit{flex-basis:100%;display:grid;gap:6px}
#${BAR_ID} textarea{width:100%;min-height:72px;font:inherit;color:#111;border-radius:8px;padding:6px;box-sizing:border-box}
[data-wording-hover]{outline:2px dashed #e0a100 !important;outline-offset:2px;cursor:text !important}
[data-wording-changed]{outline:2px solid #2e9d4a !important;outline-offset:2px}`;
  (doc.head || doc.documentElement).append(s);
}

/**
 * Turn wording edit on in `doc`. Returns { stop(), changes() }. Options are for the suite: `storage`-free runs, a
 * clock and timers, and a clipboard.
 */
export function startWordingEdit({ doc = globalThis.document, setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (h) => clearTimeout(h),
  clipboard = globalThis.navigator?.clipboard, now = () => new Date() } = {}) {
  if (!doc?.body) return { stop() {}, changes: () => [] };
  if (doc.getElementById(BAR_ID)) return doc.defaultView.__nimrodWording || { stop() {}, changes: () => [] };
  store.set(ON_KEY, '1');
  ensureCss(doc);
  const page = () => doc.defaultView?.location?.pathname || '/';
  let list = readChanges();
  let idle = null, hovered = null, editing = null;

  const bar = doc.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Changing the words');
  bar.innerHTML = '<span class="we-say" aria-live="polite"></span>'
    + '<button type="button" data-we="copy">Copy changes</button><button type="button" data-we="done">Done</button>'
    + '<details><summary>What this can change</summary>Click any words to retype them; the page shows the new words at once '
    + 'and nothing is saved to the site. "Copy changes" copies them to send. Words with a link inside, words built while the '
    + 'page runs (a name, a lesson), and hover titles or box hints are put in by hand. While this is on, a click on words '
    + 'does not press anything. It turns itself off after twenty minutes with no change. On a dashboard, this opens the '
    + 'editor with Words shown.</details>';
  doc.body.append(bar);
  const say = (t) => { const s = bar.querySelector('.we-say'); if (s) s.textContent = t; };
  const count = () => list.length;
  const tell = () => say(`Changing the words: click any words to change them. ${count() === 1 ? '1 change' : `${count()} changes`} so far.`);
  const armIdle = () => { if (idle != null) clearTimer(idle); idle = setTimer(() => { idle = null; stop('idle'); }, IDLE_OFF_MS); };
  const ours = (n) => !!(n && n.closest?.(`#${BAR_ID}`));

  function openEditor(el) {
    closeEditor();
    const old = norm(el.textContent);
    const box = doc.createElement('div');
    box.className = 'we-edit';
    box.innerHTML = '<label>New words<textarea></textarea></label><div><button type="button" data-we="save">Use these words</button> '
      + '<button type="button" data-we="cancel">Leave them</button></div>';
    box.querySelector('textarea').value = old;
    bar.append(box);
    editing = { el, old, box };
    try { box.querySelector('textarea').focus(); box.querySelector('textarea').select(); } catch { /* not focusable */ }
  }
  function closeEditor() { try { editing?.box.remove(); } catch { /* gone */ } editing = null; }
  function save() {
    if (!editing) return;
    const { el, old, box } = editing;
    const nw = norm(box.querySelector('textarea').value);
    closeEditor();
    if (!nw || nw === old) { tell(); return; }
    // (row 2.145 step 3) Read again before writing: the editor's Words keep the same list, and this bar's copy from when
    // it started must not write over a change made there since.
    list = recordChange({ page: page(), old, now: nw });
    // Shown in place (showWordsInPlace, above: shared with the editor).
    showWordsInPlace(el, nw);
    armIdle();
    tell();
  }
  async function copy() {
    list = readChanges();     // (row 2.145 step 3) the one list as it is now, whoever changed it last
    const text = changesText(list, now().toISOString().slice(0, 10));
    try {
      if (!clipboard?.writeText) throw new Error('no clipboard');
      await clipboard.writeText(text);
      say(`Copied ${count() === 1 ? '1 change' : `${count()} changes`}. Send them to Code.`);
    } catch { say('This browser would not copy them.'); }
    return text;
  }

  function onClick(e) {
    const t = e.target;
    if (ours(t)) {
      const act = t.closest?.('[data-we]')?.dataset.we;
      if (act === 'copy') copy();
      else if (act === 'done') stop('done');
      else if (act === 'save') save();
      else if (act === 'cancel') { closeEditor(); tell(); }
      return;
    }
    const el = wordsElementAt(t);
    if (!el) return;
    e.preventDefault(); e.stopPropagation(); if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    openEditor(el);
  }
  // A press on words must not reach the page either (a button that acts on pointerdown).
  function onDown(e) {
    if (ours(e.target) || !wordsElementAt(e.target)) return;
    e.preventDefault(); e.stopPropagation(); if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }
  function onOver(e) {
    const el = ours(e.target) ? null : wordsElementAt(e.target);
    if (el === hovered) return;
    hovered?.removeAttribute('data-wording-hover');
    hovered = el;
    el?.setAttribute('data-wording-hover', '');
  }
  function onKey(e) {
    if (!editing) return;
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); tell(); }
    else if (e.key === 'Enter' && !e.shiftKey && e.target?.tagName === 'TEXTAREA') { e.preventDefault(); save(); }
  }
  const evs = [['click', onClick], ['pointerdown', onDown], ['mousedown', onDown], ['mouseover', onOver], ['keydown', onKey]];
  for (const [ev, fn] of evs) doc.addEventListener(ev, fn, true);

  function stop(reason = 'done') {
    for (const [ev, fn] of evs) doc.removeEventListener(ev, fn, true);
    if (idle != null) clearTimer(idle);
    idle = null;
    hovered?.removeAttribute('data-wording-hover');
    closeEditor();
    try { bar.remove(); } catch { /* gone */ }
    store.del(ON_KEY);
    if (doc.defaultView) doc.defaultView.__nimrodWording = null;
    return reason;
  }
  tell();
  armIdle();
  const api = { stop, changes: () => list.map((c) => ({ ...c })), copy, edit: (el) => openEditor(el), save };
  if (doc.defaultView) doc.defaultView.__nimrodWording = api;
  return api;
}

/** On a page load: `?wording=1` turns it on, `?wording=0` off; otherwise it stays as it was left in this browser. */
export function wordingFromPage(win = globalThis.window) {
  const p = wordingParam(win?.location?.search || '');
  if (p === false) { store.del(ON_KEY); return null; }
  if (p === true || store.get(ON_KEY) === '1') return startWordingEdit({ doc: win.document });
  return null;
}
