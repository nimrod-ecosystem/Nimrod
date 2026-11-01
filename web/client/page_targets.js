// page_targets.js — THE ONE EDITOR OVER ANY OTHER PAGE OF THE SITE: the page and its parts as a tree (row 2.145 step 4,
// 2026-10-31). No drawing: editor.js draws it, opened by page_editor.js.
//
// The approved proposal (docs/for_chat/proposals_dc_20261027.md, DC 2), step 4: "Pages (the scrolling layout's sections)
// as targets", and its tree: "a page -> its sections; words as leaves under what they belong to". A dashboard's parts are
// editor_targets.js's; this is every OTHER page that loads theme.js (the landing page, the library, the wallpapers...),
// opened with `?wording=1`. Those pages are written in the site's code, with no data model behind their parts, so here a
// part is only a place on the page that words belong to -- nothing is moved, hidden or taken out, and nothing is written
// but words, as suggestions in the one draft list (wording_edit.js, exactly as on a dashboard).
//
// *** THE TREE. ***
//   dash                         "This page: <its title>" ('page')
//     pagesection:<path>         each part of the page ('pagesection'): a landmark -- header, nav, main, aside, footer,
//                                section, a region, an open dialog -- in the order on the page; a part inside a part is
//                                under it ("0.2": the third part inside the first)
//       words:<part>:<words>     the site's words in it ('sitewords', editor_words.js), not those of the parts inside it
//     pagesection:rest           "The rest of the page": words in no part (only when the page has parts, and words there)
//     words:screen               words pressed on the page that are not listed above, and changes kept for this page that
//                                are not on it now ('wordsgroup', editor_words.js `screen`)
// A page with no parts at all (the call page, the check-in) has its words straight under the page's row.
// Words are listed only while the editor's words are shown; the parts always are (so "Show the words" has a place to fill).
//
// *** HOW A PART IS NAMED (site copy: plain words, nobody named, nobody's screen). *** Its own label (`aria-label`, else the words
// of what `aria-labelledby` points at), else its first heading that is its own (not one inside a part within it), else
// what it is: "The top of the page", "The links", "The main part", "Beside the main part", "The bottom of the page",
// else "A part of the page". Cut at 40 letters as every row is (editor_words.js shortWords).
//
// THE NUMBERS (Rule 1):
//   3 levels of parts  FOR: the pages here nest two deep at most (the landing page: main -> its sections; the library:
//                 a section -> its two asides); one more is room for a page built later, and a word under a third-level
//                 part sits 64 px in (4 x the tree's 16 px indent) -- the tree's 240 px still holds a 40-letter label on
//                 about two lines. AGAINST: a part nested deeper is not a row of its own: its words are listed under the
//                 third-level part that holds it (never lost, only less finely placed). A module option if a real page
//                 needs more.
//   30 words a part   editor_words.js PANEL_WORDS_MAX, the same cap as a dashboard panel's, for the same reasons; past it,
//                 words are chosen by pressing them on the page.
// NEVER THROWS: a page that will not answer is a tree with just its own row.
import { ROOT_ID } from './editor_targets.js';
import { shortWords, WORDS_GROUP_ID } from './editor_words.js';
import { norm } from './wording_edit.js';

export const PAGE_SECTION_DEPTH = 3;
export const PAGE_REST_ID = 'pagesection:rest';
/** What counts as a part of a page: the page's landmarks (HTML's, and the same roles written out). */
export const PAGE_LANDMARKS = 'header, nav, main, aside, footer, section, dialog[open], [role="region"], [role="banner"], '
  + '[role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"]';
// Never a part of the page: the editor itself (and its host), and anything hidden or not drawn.
const NOT_PARTS = '[data-scene-editor], [data-page-editor], [hidden], template';
const HEADINGS = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const KIND_NAMES = Object.freeze({
  header: 'The top of the page', banner: 'The top of the page',
  nav: 'The links', navigation: 'The links',
  main: 'The main part',
  aside: 'Beside the main part', complementary: 'Beside the main part',
  footer: 'The bottom of the page', contentinfo: 'The bottom of the page',
});
export const PART_NAME = 'A part of the page';

const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };

/** The nearest part of the page that holds `el` (itself included), among `PAGE_LANDMARKS`, or null. */
const partOf = (el) => safe(() => el.closest(PAGE_LANDMARKS), null);

/** A part's name (the header above). PURE over the DOM it is given. */
export function partLabel(el) {
  if (!el) return PART_NAME;
  const own = norm(el.getAttribute?.('aria-label'));
  if (own) return shortWords(own);
  const ids = norm(el.getAttribute?.('aria-labelledby')).split(' ').filter(Boolean);
  const by = norm(ids.map((id) => safe(() => el.ownerDocument.getElementById(id)?.textContent, '') || '').join(' '));
  if (by) return shortWords(by);
  for (const h of safe(() => [...el.querySelectorAll(HEADINGS)], []) || []) {
    if (partOf(h) !== el || h.closest('[hidden]')) continue;      // a heading of a part inside this one is that part's
    const t = norm(h.textContent);
    if (t) return shortWords(t);
  }
  const kind = String(el.getAttribute?.('role') || el.tagName || '').toLowerCase();
  return KIND_NAMES[kind] || PART_NAME;
}

/**
 * The parts of the page under `root`, in the order on the page: [{ id, path, el, depth, parentId, label }]. Each is also
 * the stand-in panel record the words are found in (editor_words.js wordsSource takes { id, el }). Never throws.
 */
export function pageSections(root, { maxDepth = PAGE_SECTION_DEPTH } = {}) {
  const out = [];
  const byEl = new Map();
  const found = safe(() => [...root.querySelectorAll(PAGE_LANDMARKS)], []) || [];
  for (const el of found) {
    if (el === root || safe(() => el.closest(NOT_PARTS), null)) continue;
    let parent = null;
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) { if (byEl.has(p)) { parent = byEl.get(p); break; } }
    const depth = parent ? parent.depth + 1 : 1;
    if (depth > maxDepth) continue;                       // its words stay with the part that holds it (the header above)
    const n = out.filter((s) => s.parentId === (parent ? parent.id : null)).length;
    const path = parent ? `${parent.path}.${n}` : String(n);
    const s = { id: `pagesection:${path}`, path, el, depth, parentId: parent ? parent.id : null, label: partLabel(el) };
    out.push(s);
    byEl.set(el, s);
  }
  return out;
}

/** The rest of the page, as a stand-in record: the whole root, with every part's words left to the part. */
export function pageRest(root) {
  return root ? { id: PAGE_REST_ID, el: root } : null;
}

/**
 * buildPageTree(root, { sections, words, title }) -> { root, nodes: Map<id, node>, list: [node] } (depth first, the order
 * drawn), each node the editor_targets.js shape: { id, parent, label, kind, depth, panelId: null, targetId: null, place:
 * null, transform() -> null, fields() -> null, set() -> false, children() }. A page has nothing edit mode edits: a part is
 * chosen in the editor, and its words are changed through the draft list (editor.js).
 *   sections  pageSections(root), when the caller has them already (the editor finds them once per draw)
 *   words     editor_words.js wordsSource({ recs: [...sections, pageRest(root)], ... }) while the words are shown; else null
 *   title     the page's name (default: the document's title)
 */
export function buildPageTree(root, { sections = null, words = null, title = null } = {}) {
  const nodes = new Map();
  const list = [];
  const kids = new Map();
  function add(n) {
    if (nodes.has(n.id)) return nodes.get(n.id);
    const node = {
      parent: null, depth: 0, panelId: null, targetId: null, wholeId: null, place: null, ...n,
      children: () => (kids.get(node.id) || []).map((id) => nodes.get(id)).filter(Boolean),
      transform: () => null,
      fields: () => null,
      set: () => false,
    };
    nodes.set(node.id, node);
    list.push(node);
    if (node.parent) kids.set(node.parent, [...(kids.get(node.parent) || []), node.id]);
    return node;
  }
  // A part's words (its heading included: a part's name is not kept out of its words, `title: ''`).
  const wordsIn = (rec) => (words ? safe(() => words.panel(rec, { title: '' }), []) || [] : []);
  const leaves = (found, owner, parent, depth) => {
    for (const w of found) add({ id: w.id, parent, depth, label: w.label, kind: 'sitewords', owner, words: w.words });
  };
  const name = norm(title ?? safe(() => root.ownerDocument.title, ''));
  add({ id: ROOT_ID, label: name ? `This page: ${shortWords(name)}` : 'This page', kind: 'page' });
  const secs = Array.isArray(sections) ? sections : pageSections(root);
  const under = (pid) => secs.filter((s) => s.parentId === pid);
  const walk = (s) => {
    add({ id: s.id, parent: s.parentId || ROOT_ID, depth: s.depth, label: s.label, kind: 'pagesection', el: s.el });
    leaves(wordsIn(s), s.id, s.id, s.depth + 1);
    under(s.id).forEach(walk);
  };
  under(null).forEach(walk);
  if (words && root) {
    const restWords = wordsIn(pageRest(root));
    if (!secs.length) leaves(restWords, PAGE_REST_ID, ROOT_ID, 1);
    else if (restWords.length) {
      add({ id: PAGE_REST_ID, parent: ROOT_ID, depth: 1, label: 'The rest of the page', kind: 'pagesection', el: null });
      leaves(restWords, PAGE_REST_ID, PAGE_REST_ID, 2);
    }
    // After every part's words (wordsSource remembers which it listed): the rest of the pressed and kept ones.
    const here = safe(() => words.screen(), []) || [];
    if (here.length) {
      add({ id: WORDS_GROUP_ID, parent: ROOT_ID, depth: 1, kind: 'wordsgroup', label: 'More words on this page' });
      for (const w of here) add({ id: w.id, parent: WORDS_GROUP_ID, depth: 2, label: w.label, kind: 'sitewords', owner: null, words: w.words });
    }
  }
  return { root: nodes.get(ROOT_ID), nodes, list };
}
