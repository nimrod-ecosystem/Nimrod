// wording_edit.js - CHANGE THE SITE'S WORDS WHERE THEY ARE: the shared pieces (row 2.123, chat's note CR 1; row 2.145).
//
// Mike, 2026-10-25: "The wall of text they gave me would've taken much longer than just reading through the whole site
// myself. Is there some sort of edit mode for me where I can just change things on the site like wording?" So: open any
// page of the site with `?wording=1` and words on it can be retyped, on the page, as they sit. The page shows the new
// words at once (to see how they read there); nothing is saved to the site. "Copy changes" copies
// `page<TAB>words on the page<TAB>new words` lines, and web/tools/export_site_text.py --apply-page-edits puts each one
// into the code - found by its words, since a page never knows the file - and refuses, with the reason, whatever
// would need a guess. A person (Code) then reads each applied line against what the code does before committing.
//
// HOW FAR IT REACHES:
//   reaches     words in the pages and the scripts, as written; words with parts the code fills in ("You have 3 new
//               notes"), as long as those parts stay in the new words
//   by hand     words with a link or bold inside them (the page cannot show where the tags go); words in more than one
//               file that the page does not settle; words built while the page runs, or data - a person's name, a
//               lesson, a setting's value - which the code does not hold as words at all
//   not yet     words that are not on the page as text: a button's hover title, a box's placeholder, a screen
//               reader's label
//
// *** ONE WAY IN: THE ONE EDITOR (row 2.145 steps 3 and 4, 2026-10-31). *** `?wording=1` opens the one editor with its
// words shown: on a dashboard the kiosk opens it (kiosk.js), on every other page theme.js does (page_editor.js, with the
// page's parts as its list: page_targets.js). The WORDING BAR this file used to draw is gone -- two ways to do one job
// is a stopgap -- and this file keeps only the pieces the editor uses: the one draft list in this browser
// (`readChanges`, `recordChange` by `withChange`'s rule), the one copied format (`changesText`, what the apply tool
// reads), the one rule for "these words" (`wordsElementAt`), one line of words (`norm`, `LINE_MAX`), showing a change in
// place (`showWordsInPlace`), the address (`wordingParam`, `withoutWordingParam`) and "it is on" (`ON_KEY`). Importing it
// starts nothing.
//
// NOT A GATE (CLAUDE.md: a screen must never enter a state that only an input can leave, when the person in front of it
// cannot give that input): opened only by somebody typing the address; Done, Escape, `?wording=0` and IDLE_OFF_MS with
// nobody using it close it, keeping the changes (page_editor.js).
//
// KEPT: the changes and "it is on" in this browser's storage (a draft in progress, per viewer - never shared, never on
// the server), so moving between pages keeps both. Storage that refuses (a private window) only means it is not kept.

export const ON_KEY = 'nimrod.wording.on';
export const CHANGES_KEY = 'nimrod.wording.changes.v1';
// How long with nobody using it before it closes itself. Twenty minutes: long enough to read a page slowly and think
// about a line; short enough that a screen it was left on comes back to itself the same afternoon.
export const IDLE_OFF_MS = 20 * 60 * 1000;
export const COPY_HEAD = '# nimrod wording changes (site words edited in place)';
// The longest run of words that counts as one line when it has other elements inside it. 300 characters is a long
// paragraph; past that, a click has landed on a container (a panel with a stray word in it), not on a sentence.
export const LINE_MAX = 300;

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
