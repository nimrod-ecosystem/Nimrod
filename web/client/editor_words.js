// editor_words.js — THE ONE EDITOR'S WORDS: the words on a dashboard as leaves of its scene tree (row 2.145 step 3,
// 2026-10-31).
//
// The approved proposal (docs/for_chat/proposals_dc_20261027.md, DC 2) step 3: "Words folded in as text nodes;
// `?wording=1` becomes 'the editor, Words shown'." Mike: *"Editing the site directly should be a part of the same
// editor."* So the words on a dashboard are rows of the one tree, chosen like anything else, and changed in the inspector.
//
// *** TWO KINDS OF WORDS, KEPT APART. ***
//   'words'      A PANEL'S OWN WORDS: a thing in a panel whose own settings hold its words (a sign's "Words" row,
//                modules/button.js `label`). They are already a row of the tree (edit mode's part) and already saved
//                with the panel; step 3 only TAGS them (`ownLabel`), so they read as words. Nothing new is stored.
//   'sitewords'  THE SITE'S WORDS: fixed text in the code, shown in a panel (a button's "Start", a heading). Found by
//                the wording bar's own rule for "these words" (wording_edit.js `wordsElementAt`), inside each panel's
//                element. A change to them is wording edit's: a SUGGESTION, kept in this browser in the one draft list
//                and copied for the site's next update (wording_edit.js `recordChange`, `changesText`). Nothing is
//                written to the site, to the server, or to anybody else's screen.
//   'wordsgroup' "Words on this screen": words outside the panels (the bar, the breadcrumb) once somebody PRESSES them
//                with Words shown, and changes already in the draft list for this page that no panel shows now. The
//                screen outside the panels is not scanned in step 3 (pages are step 4).
//
// *** NOT STEP 5 (said so this file is not read as more than it is). *** No per-person change of the site's words
// re-applied at load, no "changed from the default", no "Reset to the default", no owner's "Save as the site default",
// no server write. Those are the proposal's two layers, step 5.
//
// *** WHAT IS NOT THE SITE'S WORDS (never listed), each for a reason: ***
//   * the panel's own text settings' values (they are kind 'words', above), its title, the dashboard's name;
//   * anything in the editor's box, the wording bar, edit mode's own Done and card, a panel's corners and handles;
//   * boxes people type in (inputs, text areas, choices; contenteditable);
//   * live words: a clock's time and date, anything marked `data-live-words` (a module saying "built while it runs"),
//     `role="timer"` and `aria-live` regions (words that change by themselves are not copy in the code);
//   * words with no letter in them ("10:42", "3", "⤢"), and anything hidden;
//   * other panels nested in this one (a module in a room's slot): theirs, listed under them.
// A run of words is one line (wording_edit.js LINE_MAX: over it, it is a container, not a sentence).
//
// THE NUMBERS (Rule 1):
//   30 a panel   FOR: a panel of buttons and help lines has well under 30 runs of words; a cap keeps a long list (a page
//                of a lesson, a list of names) from burying the tree and from costing a Pi 400 a long walk each time.
//                AGAINST: a panel with more shows its first 30 only -- the rest are reached by pressing them in the view
//                (which finds them by the same rule). A module option later if a real panel needs more.
//   40 letters   a row's label shows the words cut at 40 (with …). FOR: one line in the 240px tree at 15px. AGAINST: two
//                long lines that start the same read the same in the tree; the inspector shows them whole.
import { wordsElementAt, norm, LINE_MAX } from './wording_edit.js';
import { targetsOf, selectionFor } from './edit_mode.js';
import { fieldValue } from './settings_fields.js';

export const WORDS_GROUP_ID = 'words:screen';
export const PANEL_WORDS_MAX = 30;
export const WORDS_LABEL_MAX = 40;
/** The node kinds this file adds to the tree (editor_targets.js buildTree). */
export const WORDS_KINDS = Object.freeze({ own: 'words', site: 'sitewords', group: 'wordsgroup' });

const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
const HAS_LETTER = /\p{L}/u;
// Never the site's words: the editor, the bar, edit mode's own controls and a panel's corners, live and hidden things.
const NOT_WORDS = '[data-scene-editor], #wording-edit-bar, .em-bar, .em-card, .em-handles, .k-editc, .k-promote, '
  + '[data-live-words], [role="timer"], [aria-live], [contenteditable="true"], [contenteditable=""], [hidden], svg';
const NOT_WORDS_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

/** A tree node's id for words: `words:<panel id | screen>:<the original words>`, `#2` for a repeat in the same place. */
export const wordsNodeId = (where, original, n = 1) => `words:${where}:${original}${n > 1 ? `#${n}` : ''}`;
/** Words cut for a row's label. PURE. */
export function shortWords(text, max = WORDS_LABEL_MAX) {
  const s = norm(text);
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The first of a selection's rows that is a person's own words (a text row they can type in), or null. PURE. */
export function ownWordsField(sel) {
  return (sel?.fields || []).find((f) => f && f.kind === 'text' && f.editable && !f.secret) || null;
}

/**
 * The panel's own words, as text (normalised): every text setting's value, of the panel and of each thing in it that
 * keeps its own rows. Words equal to one of these are the panel's (kind 'words'), never listed as the site's.
 */
export function ownTextsOf(rec) {
  const out = new Set();
  const take = (sel) => {
    if (!sel) return;
    const vals = safe(() => sel.values(), {}) || {};
    for (const f of sel.fields || []) {
      if (!f || f.kind !== 'text' || f.secret) continue;
      const v = norm(safe(() => fieldValue(f, vals), ''));
      if (v) out.add(v);
    }
  };
  take(safe(() => selectionFor(rec, null)));
  for (const t of safe(() => targetsOf(rec), []) || []) {
    if (Array.isArray(t.fields) && t.fields.some((f) => f && f.kind === 'text')) take(safe(() => selectionFor(rec, t)));
  }
  return out;
}

/**
 * The site's words in `root` (a panel's element), in the order drawn: [{ el, shown, original, changed }].
 *   skip     elements inside `root` whose words are not its own (a panel nested in it)
 *   exclude  words (normalised) that are not the site's: the panel's own text settings, its title, the dashboard's name
 *   drafts   the draft list (wording_edit.js readChanges): words shown that are a draft's NEW words on this page are
 *            that draft's ORIGINAL words (`original`), so a row keeps its id after a change is shown in place
 *   page     this page's path (the draft list's `page`)
 *   max      at most this many (PANEL_WORDS_MAX)
 */
export function siteWordsIn(root, { skip = [], exclude = new Set(), drafts = [], page = '', max = PANEL_WORDS_MAX } = {}) {
  const out = [];
  const doc = root?.ownerDocument;
  if (!doc || typeof doc.createTreeWalker !== 'function') return out;
  if (root.matches?.('[data-live-words], [role="timer"], [aria-live], [hidden]')) return out;
  const NF = doc.defaultView?.NodeFilter || globalThis.NodeFilter;
  const skipSet = new Set(skip || []);
  const walker = doc.createTreeWalker(root, NF.SHOW_ELEMENT | NF.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === 1) {
        if (n === root) return NF.FILTER_SKIP;
        if (skipSet.has(n) || NOT_WORDS_TAGS.has(n.tagName) || n.matches(NOT_WORDS)) return NF.FILTER_REJECT;
        return NF.FILTER_SKIP;
      }
      return norm(n.nodeValue) ? NF.FILTER_ACCEPT : NF.FILTER_SKIP;
    },
  });
  const seen = new Set();
  const mine = drafts.filter((c) => c && c.page === page);
  for (let t = walker.nextNode(); t && out.length < max; t = walker.nextNode()) {
    const el = wordsElementAt(t);
    if (!el || seen.has(el) || !root.contains(el)) continue;
    seen.add(el);
    const shown = norm(el.textContent);
    if (!shown || shown.length > LINE_MAX || !HAS_LETTER.test(shown) || exclude.has(shown)) continue;
    const d = mine.find((c) => c.new === shown);
    out.push({ el, shown, original: d ? d.old : shown, changed: !!d });
  }
  return out;
}

/**
 * Finding a panel's words again on every draw would walk its whole element each time; this keeps what was found per
 * panel element and walks it again only once something in it changed (a MutationObserver, which only marks it: nothing
 * runs on a change but that). Only while Words are shown: `destroy` stops every watch. `forget` after a change made here
 * (shown in place: the watch tells only a moment later, and the next draw is now).
 */
export function createWordsScanner({ win = (typeof window !== 'undefined' ? window : null) } = {}) {
  const cache = new WeakMap();
  const watches = new Set();
  let gen = 0;
  function scan(root, opts = {}) {
    if (!root) return [];
    const key = JSON.stringify([[...(opts.exclude || [])], (opts.drafts || []).filter((c) => c && c.page === opts.page), (opts.skip || []).length, opts.max || 0]);
    let entry = cache.get(root);
    if (entry && !entry.dirty && entry.gen === gen && entry.key === key) return entry.leaves;
    if (!entry) {
      entry = { dirty: false, gen, key: '', leaves: [] };
      const MO = win?.MutationObserver;
      if (MO) {
        const e = entry;
        const mo = new MO(() => { e.dirty = true; });
        try { mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] }); watches.add(mo); }
        catch { e.always = true; }
      } else entry.always = true;
      cache.set(root, entry);
    }
    entry.leaves = siteWordsIn(root, opts);
    entry.key = key;
    entry.gen = gen;
    entry.dirty = !!entry.always;
    return entry.leaves;
  }
  return {
    scan,
    forget() { gen += 1; },
    destroy() { for (const mo of watches) { try { mo.disconnect(); } catch { /* gone */ } } watches.clear(); gen += 1; },
  };
}

/**
 * What the tree asks of words while they are shown (editor_targets.js buildTree `words`). One per build: it remembers
 * which original words the panels showed, so the draft list's other changes for this page go under "Words on this
 * screen" once, and nothing twice.
 *   recs         the arrangement's panels (`editRecs()`): a panel nested in another is skipped in the outer one
 *   profileName  the dashboard's name (never the site's words)
 *   scanner      createWordsScanner()
 *   page         this page's path
 *   drafts       the draft list now (wording_edit.js readChanges)
 *   clicked      words outside the panels somebody pressed with Words shown: [element]
 */
export function wordsSource({ recs = [], profileName = '', scanner = null, page = '', drafts = [], clicked = [] } = {}) {
  const used = new Set();
  const mine = drafts.filter((c) => c && c.page === page);
  const number = () => { const counts = new Map(); return (where, original) => { const n = (counts.get(original) || 0) + 1; counts.set(original, n); return wordsNodeId(where, original, n); }; };
  const leaf = (id, w) => ({ id, label: `“${shortWords(w.shown)}”${w.changed ? ' (changed)' : ''}`, words: { ...w } });
  return {
    /** A thing in a panel that holds the panel's own words: its row's label ("Words: “Ada”"); else null. */
    ownLabel(rec, t) {
      if (!t || t.whole) return null;
      const sel = safe(() => selectionFor(rec, t));
      const f = ownWordsField(sel);
      if (!f) return null;
      const v = norm(safe(() => fieldValue(f, sel.values() || {}), ''));
      return v ? `Words: “${shortWords(v)}”` : 'Words (none yet)';
    },
    /** The site's words in a panel, as leaves: [{ id, label, words: { el, shown, original, changed } }]. */
    panel(rec, { title = '' } = {}) {
      if (!rec?.el) return [];
      const skip = recs.filter((r) => r && r !== rec && r.el && r.el !== rec.el && rec.el.contains(r.el)).map((r) => r.el);
      const exclude = ownTextsOf(rec);
      for (const s of [title, rec.title, profileName]) { const v = norm(s); if (v) exclude.add(v); }
      const found = (scanner ? scanner.scan(rec.el, { skip, exclude, drafts, page }) : siteWordsIn(rec.el, { skip, exclude, drafts, page })) || [];
      const id = number();
      return found.map((w) => { used.add(w.original); return leaf(id(rec.id, w.original), w); });
    },
    /** "Words on this screen": the ones pressed outside the panels, then this page's other drafts. */
    screen() {
      const id = number();
      const out = [];
      const seenEl = new Set();
      for (const el of clicked) {
        if (!el || !el.isConnected || seenEl.has(el)) continue;
        seenEl.add(el);
        const shown = norm(el.textContent);
        if (!shown || shown.length > LINE_MAX) continue;
        const d = mine.find((c) => c.new === shown);
        const w = { el, shown, original: d ? d.old : shown, changed: !!d };
        used.add(w.original);
        out.push(leaf(id('screen', w.original), w));
      }
      for (const d of mine) {
        if (used.has(d.old)) continue;
        used.add(d.old);
        // Not on the screen now (a change made on another visit: it is not shown again at load -- step 5's).
        out.push(leaf(id('screen', d.old), { el: null, shown: d.old, original: d.old, changed: true }));
      }
      return out;
    },
  };
}
