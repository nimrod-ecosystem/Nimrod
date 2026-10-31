// editor.js — THE ONE EDITOR: a scene tree, the view, an inspector (row 2.145 step 1, 2026-10-31).
//
// Mike, 2026-10-27: *"There should just be one thing built for this. It should feel like editing a scene in Godot or
// Blender."* The approved shape (docs/for_chat/proposals_dc_20261027.md, DC 2) is Godot's three docks:
//   1. THE SCENE TREE (left, can be put away): what is on the dashboard, as a tree (editor_targets.js buildTree).
//      Choosing a row chooses that thing in the view; choosing a thing in the view marks its row.
//   2. THE VIEW (middle): the real dashboard, live, exactly as it is. This file draws nothing over it: the area between
//      the tree and the inspector lets every press through, and edit mode (edit_mode.js) does the choosing, the outlines
//      and the handles there, unchanged.
//   3. THE INSPECTOR (right; a sheet along the bottom on a narrow screen): Transform (as numbers), then the thing's own
//      settings -- the SAME rows, drawn by the same renderer (edit_mode.js renderOptions), as the in-panel card.
//   A toolbar across the top: Done FIRST, then Undo, Redo, Add, Duplicate, Delete, and the list's own show / hide.
//
// *** STEP 1 IS ONLY THIS. *** Over what edit mode already edits -- a dashboard's panels and its room (and what a module
// lists of its own things: a village's pieces, a sign's words). Town, pages, words and the two layers (the site's
// default and a person's own) are later steps of the same proposal. Its look is the theme's plain one, tokens only: the
// editor's own design is Design's item 49, not delivered yet.
// *** STEP 2 (2026-10-31): ONE TRANSFORM. *** A room's, the village's and a placed panel's Transform read the same
// (editor_targets.js presentTransform: one order, size as a percent, where it stands as a percent of the stage), and
// their numbers can be TYPED between ‹ and › (edit_mode.js renderOptions `typed`; Enter keeps, Escape puts it back).
// And Town is in the list: an open place's things are its pieces (modules/town.js editTargets), "Open a place" on the
// Town's own row moves between its places.
// *** STEP 3 (2026-10-31): WORDS, AS TEXT NODES. *** A toolbar toggle, "Show the words" (off unless a person turns it
// on, or the page was opened with `?wording=1` -- kiosk.js), puts the words on the dashboard in the list
// (editor_words.js, editor_targets.js): a panel's OWN words (a sign's) are its row, tagged 'words', changed in its own
// Words row as before; the SITE's words in each panel are leaves under it, changed in a Words section here through
// wording edit's own draft list (wording_edit.js: a suggestion kept in this browser and copied for the site's next
// update -- "Use these words", "Put back the site's words", "Copy changes"). While they are shown, a press on words in
// the view CHOOSES them and presses nothing (a capture on the window, ahead of edit mode's); words outside the panels
// join "Words on this screen" when pressed. Not step 5: nothing is re-applied at load, nothing written to the site.
//
// *** HOW IT SITS ON WHAT IS THERE (nothing underneath it changes). ***
//   * The selection IS edit mode's. A row chosen here is `arr.editPanel(id, true)` then `arr.editSelect(target)`; a
//     thing chosen in the view arrives as edit mode's `edit/selected`, which this CLAIMS (so the little in-panel card
//     stays away while the inspector shows the same rows) and marks in the tree. One panel at a time, as edit mode is.
//   * A placed panel's Transform goes through the edit windows' own edit model (dashboard_editor.js, opened here with
//     no windows), so it is saved by the host's merge-save and undone by its Undo -- one copy of that rule, not two.
//   * A room or village piece's Transform is its own rows (`transformKeys`, edit_mode.js contract), written by its
//     target's `set` and undone by the room's own Undo.
//   * The kiosk holds it exactly as it holds the edit windows (kiosk.js openEditView): the switch scan, the "nobody
//     answering" close, the menu opening putting it away. It hands this the same `{ el, scan, close, isOpen }` shape.
//
// *** NEVER A GATE, NEVER A TRAP (CLAUDE.md). *** Off unless a person opens it: importing this file draws nothing, and
// nothing opens it at boot. Done is the first thing in it and the first stop of the switch walk, never dimmed. Escape
// leaves edit mode's choice first (edit mode's own Escape), and a second Escape closes the editor. Every number has ‹
// and ›, so a switch does everything a pointer can. The view keeps running underneath, and the host closes it after its
// own wait with no press (kiosk.js `editIdleMs`). Every change is saved as it is made: closing loses nothing.

import { openDashboardEditor } from './dashboard_editor.js';
import { renderOptions, ensureEditCss, targetsOf, targetAt, EDIT_SELECTED_TOPIC, EDIT_ENDED_TOPIC } from './edit_mode.js';
import { buildTree, nodeForEditing, nodeIdFor, splitSelection, ROOT_ID } from './editor_targets.js';
import { preset } from './layout.js';
// (row 2.145 step 3) The words. wording_edit.js is imported for its shared pieces only (nothing starts on import).
// FOR importing it here, at load: one draft list and one rule, not a copy. AGAINST: the kiosk now fetches that small file
// on every load (it is pure functions; the bar itself still starts only on a page that asks for it, theme.js).
import { wordsElementAt, norm, readChanges, recordChange, showWordsInPlace, changesText, LINE_MAX } from './wording_edit.js';
import { createWordsScanner, wordsSource, WORDS_KINDS } from './editor_words.js';

export const SCENE_EDITOR_KIND = 'scene';

// What it says. Site copy: plain words, no "her screen", no names.
export const EDITOR_WORDS = Object.freeze({
  chooseFirst: 'Choose something in the list first.',
  nothingToUndo: 'Nothing to undo yet.',
  nothingToRedo: 'Nothing to redo.',
  noHistory: 'Its settings are kept as they change; there is no history to undo for them yet.',
  noRedo: 'Redo is not built for this yet. Undo steps back.',
  slotDelete: 'A panel in a cell of the layout is not taken out from here yet.',
  cannotTakeOut: 'This one cannot be taken out.',
  copyModule: 'Copying a module is not built yet.',
  copyPiece: 'Copying a piece of furniture is not built yet.',
  cannotCopy: 'This one cannot be copied.',
  addHere: 'Adding to the dashboard from here is not built yet. Choose a room, a scene or an open Town place to add a piece to it.',
  slotTransform: 'Its place is its cell of the layout.',
  stageTransform: 'It fills the screen.',
  roomTransform: 'The room fills the screen behind the panels.',
  partTransform: 'It moves with its panel.',
  // (row 2.145 step 2, 2026-10-31) A room's piece with no Transform of its own was told "It moves with its panel", which
  // is not true of furniture: it is that moving it is not built there yet. Said so, plainly.
  room3dTransform: 'Moving the 3D room\'s furniture is not built yet.',
  pieceFixed: 'Moving this one is not built yet.',
  rootHelp: 'Choose something in the list, or press ✎ on a panel and then a thing in it. Its options show here.',
  cellHelp: 'Choose the panel in it to see its options.',
  emptyCell: 'Nothing is in this cell.',
  groupHelp: 'Panels placed freely. Choose one to move it with numbers.',
  // (row 2.145 step 3, 2026-10-31) The words.
  showWords: 'Show the words',
  hideWords: 'Hide the words',
  wordsShown: 'Words shown. A press on words chooses them, and does not press anything while the words are shown.',
  wordsTools: 'Words are changed in the inspector: "Use these words" or "Put back the site\'s words".',
  wordsTransform: 'Words have no place of their own.',
  siteWordsTitle: 'Site words',
  siteWordsHelp: 'Words the site shows here. A change is a suggestion: it shows here at once, is kept in this browser, and is copied for the site\'s next update. Nothing is saved to the site.',
  wordsKeys: 'One line, up to 300 letters. Enter keeps them; Escape puts the box back. A switch cannot type here (there is no on-screen keyboard for this yet); "Put back the site\'s words" and "Copy changes" work with one.',
  wordsEmpty: 'Type the new words first. To go back to the site\'s words, press "Put back the site\'s words".',
  wordsKept: 'Kept as a suggestion, and shown here. "Copy changes" copies it for the site\'s next update.',
  wordsKeptNotShown: 'Kept as a suggestion. These words are not on the screen now, so nothing here changed.',
  wordsSame: 'These are the site\'s words; no change is kept for them.',
  wordsBack: 'The site\'s words are back, and the suggestion is dropped.',
  wordsAlready: 'These are the site\'s words already.',
  noCopy: 'This browser would not copy them.',
  screenWordsHelp: 'Words outside the panels: with the words shown, press words on the screen to list them here. Changes already kept for this page that are not on the screen now are here too.',
  ownWords: 'These words are this panel\'s own setting, kept with it (its Words row). They are not the site\'s words.',
});
/** "Copied 2 changes. Send them to Code." -- the wording bar's own sentence (wording_edit.js), so the two say one thing. */
export const copiedWords = (n) => `Copied ${n === 1 ? '1 change' : `${n} changes`}. Send them to Code.`;

/**
 * Why a chosen thing has no Transform section, in words (row 2.145 step 2). PURE.
 *   node        the tree's node (editor_targets.js): its kind and whether it is a thing in a panel
 *   sel         edit mode's selection for it (its `type`: 'room3d' for the 3D room)
 *   hasLayout   whether the dashboard has a layout of cells (else it is the one-at-a-time stage)
 */
export function transformWhy(node, sel = null, { hasLayout = true } = {}) {
  if (!node) return EDITOR_WORDS.stageTransform;
  if (node.kind === 'room') return EDITOR_WORDS.roomTransform;
  if (node.kind === 'piece') return sel?.type === 'room3d' ? EDITOR_WORDS.room3dTransform : EDITOR_WORDS.pieceFixed;
  if (node.targetId) return EDITOR_WORDS.partTransform;
  return hasLayout ? EDITOR_WORDS.slotTransform : EDITOR_WORDS.stageTransform;
}

const LEVELS = ['essential', 'standard', 'advanced'];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
const GROUPISH = new Set(['dashboard', 'cell', 'group']);
// (step 3) The site's words and "Words on this screen": chosen HERE, like a group (edit mode is left), since they are no
// panel's settings. A panel's own words ('words') are edit mode's part, chosen through it as before.
const WORDS_LOCAL = new Set([WORDS_KINDS.site, WORDS_KINDS.group]);
const VIEW_PRESSES = ['click', 'pointerdown', 'mousedown', 'touchstart'];
const HAS_LETTER = /\p{L}/u;
const TOOLS = ['undo', 'redo', 'add', 'duplicate', 'delete'];
const TOOL_LABELS = Object.freeze({ undo: 'Undo', redo: 'Redo', add: 'Add', duplicate: 'Duplicate', delete: 'Delete' });

/**
 * openSceneEditor(opts) -> { kind: 'scene', el, scan, close, isOpen, refresh, tree, selected, placedModel, choose }
 *   arr         the arrangement whose panels and room are edited (its `editPanel`, `editSelect`, `editing`, `editRecs`)
 *   bus         where edit mode publishes `edit/selected` and `edit/ended`
 *   mountIn     the element the editor's box is added to (the kiosk's own element)
 *   dashOpts    the options the host gives the edit windows (dashboard_editor.js openDashboardEditor): its baseLayout,
 *               its merge-save, its apply. Used for the placed panels' edit model, opened with no windows.
 *   level       'essential' | 'standard' | 'advanced', or a getter: which rows the inspector shows (the menu's level)
 *   notify(t)   a short spoken and shown notice (a refused Delete); absent: the status line alone
 *   onClose()   after it closed, any way
 *   onActivity() somebody chose something (a press in the view counts): the host's "nobody answering" wait restarts
 *   words       (row 2.145 step 3) open with the words shown (`?wording=1`, kiosk.js). Default false: a person turns them on.
 *   clipboard   where "Copy changes" writes (default the browser's); `now()` dates the copied lines. For the suite.
 */
export function openSceneEditor(opts = {}) {
  const { arr, bus = null, mountIn = null, dashOpts = null, level = 'standard', notify = null, onClose = null, onActivity = null,
    words: wordsAtOpen = false, clipboard = globalThis.navigator?.clipboard, now = () => new Date() } = opts;
  if (!arr) throw new Error('openSceneEditor: an arrangement is required');
  const doc = mountIn?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('openSceneEditor: there is no page to draw on');
  const levelNow = () => { const v = safe(() => (typeof level === 'function' ? level() : level), 'standard'); return LEVELS.includes(v) ? v : 'standard'; };
  let closed = false;
  let box = null;
  let tree = null;
  let selectedId = ROOT_ID;
  let selectedPrev = null;        // (step 2) the row the inspector was last drawn for: its scroll is kept for the same one
  let chosenLocal = ROOT_ID;      // a row that is not a panel (the dashboard, a cell, a group): chosen here, not in edit mode
  let views = [];
  let lastNote = '';
  let scanKey = null;
  let scanIdx = -1;
  const offs = [];
  // (step 3) The words: shown or not, the scanner that finds them (only while shown), words pressed outside the panels,
  // each changed element's way back (`showWordsInPlace`), and which row each listed element is (for a press in the view).
  let wordsOn = false;
  let scanner = null;
  const clicked = [];
  const undoInPlace = new WeakMap();
  let leafByEl = new Map();
  const win = doc.defaultView || globalThis;
  const page = () => win.location?.pathname || '/';

  // ---- the placed panels' edit model: the edit windows' own, with no window open ----
  let placed = null;
  try {
    const { onClose: _c, mountIn: _m, host: _h, windows: _w, onChange: hostChange, ...rest } = dashOpts || {};   // eslint-disable-line no-unused-vars
    placed = openDashboardEditor({
      ...rest, arr, host: doc.createElement('div'), windows: [], onClose: null,
      onChange: () => {
        try { hostChange?.(); } catch (err) { console.error('editor: host onChange', err); }
        render();
      },
    });
  } catch (err) { console.error('editor: the placed panels', err); placed = null; }
  const model = () => placed?.model || null;
  // The toolbar follows the model AT ONCE (Undo lights the moment there is something to undo), not after the screen has
  // been moved (the host's onChange comes after its apply, a moment later): a quick second press must find it lit.
  try { offs.push(placed?.model?.subscribe?.((evt) => { if (evt && evt.type === 'items' && box && !closed) { drawBar(tree?.nodes.get(selectedId) || null, editingNow()); paint(); } })); }
  catch (err) { console.error('editor: following the placed model', err); }

  // ---- the box ----
  ensureEditCss(doc);
  ensureSceneCss(doc);
  box = doc.createElement('div');
  box.className = 'se';
  box.dataset.sceneEditor = '';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Editor');
  box.innerHTML = `<div class="se-bar" role="toolbar" aria-label="Editor tools" data-se-bar>
      <button type="button" class="se-btn em-btn em-done" data-se="done">Done</button>
      ${TOOLS.map((t) => `<button type="button" class="se-btn em-btn" data-se="${t}">${TOOL_LABELS[t]}</button>`).join('')}
      <button type="button" class="se-btn em-btn" data-se="words" aria-pressed="false">${EDITOR_WORDS.showWords}</button>
      <button type="button" class="se-btn em-btn" data-se="list" aria-expanded="true">Hide the list</button>
      <span class="se-status" role="status" aria-live="polite" data-se-status></span>
      <span class="se-why" data-se-why></span>
    </div>
    <div class="se-main">
      <div class="se-tree" role="tree" aria-label="What is on this dashboard" data-se-tree></div>
      <div class="se-gap" aria-hidden="true"></div>
      <div class="se-ins" aria-label="Inspector" data-se-ins></div>
    </div>`;
  (mountIn || doc.body).append(box);
  const barEl = box.querySelector('[data-se-bar]');
  const treeEl = box.querySelector('[data-se-tree]');
  const insEl = box.querySelector('[data-se-ins]');
  const statusEl = box.querySelector('[data-se-status]');
  const whyEl = box.querySelector('[data-se-why]');

  function note(text) {
    lastNote = String(text || '');
    if (statusEl) statusEl.textContent = lastNote;
    if (lastNote) { try { notify?.(lastNote); } catch { /* the line still says it */ } }
  }
  const activity = () => { try { onActivity?.(); } catch (err) { console.error('editor: activity', err); } };
  const editingNow = () => safe(() => arr.editing(), null);
  const recOf = (id) => safe(() => (arr.editRecs?.() || []).find((r) => r && r.id === id), null);
  const leaveEditMode = () => { const e = editingNow(); if (e) { try { arr.editPanel(e.id, false); } catch (err) { console.error('editor: leaving edit mode', err); } } };

  // =====================================================================================================
  // THE TOOLBAR: what each tool does for what is chosen, or why it does nothing here (said on the button and in the
  // line beside them -- a tool is never silently dead).
  // =====================================================================================================
  const on = (run) => ({ on: true, why: '', run });
  const off = (why) => ({ on: false, why, run: null });
  /** The chosen panel's `whole` target when it takes "Add a piece" (a room, a village's scene); else null. */
  function addTargetOf(panelId) {
    const rec = panelId ? recOf(panelId) : null;
    if (!rec) return null;
    return safe(() => targetsOf(rec).find((t) => t.whole && Array.isArray(t.fields) && t.fields.some((f) => f && f.key === 'addPiece')), null);
  }
  function toolsFor(node, editing) {
    // (step 3) Words chosen: the inspector's own buttons change them; every tool says so.
    if (node && WORDS_LOCAL.has(node.kind)) {
      const w = off(EDITOR_WORDS.wordsTools);
      return { undo: w, redo: w, add: w, duplicate: w, delete: w };
    }
    const sel = editing ? safe(() => arr.editSelection(), null) : null;
    const act = (id) => (sel?.actions || []).find((a) => a.id === id && typeof a.run === 'function') || null;
    const m = model();
    const group = !node || !editing || GROUPISH.has(node.kind);
    const placedPanel = !group && !!node.place && !node.targetId && !!m && !!safe(() => m.item(node.panelId), null);
    const t = {};
    // Undo / Redo: the placed panels' history (also from the dashboard's own row: a panel taken out is undone there),
    // else the chosen thing's own Undo (a room's, a village's), else nothing to step back through.
    if (placedPanel || (group && m)) {
      t.undo = m.canUndo() ? on(() => m.undo()) : off(EDITOR_WORDS.nothingToUndo);
      t.redo = m.canRedo() ? on(() => m.redo()) : off(EDITOR_WORDS.nothingToRedo);
    } else if (group) {
      t.undo = off(EDITOR_WORDS.chooseFirst); t.redo = off(EDITOR_WORDS.chooseFirst);
    } else {
      t.undo = act('undo') ? on(() => act('undo').run()) : off(EDITOR_WORDS.noHistory);
      t.redo = off(EDITOR_WORDS.noRedo);
    }
    // Delete
    if (group) t.delete = off(EDITOR_WORDS.chooseFirst);
    else if (placedPanel) {
      t.delete = on(() => {
        const id = node.panelId;
        leaveEditMode();
        if (!m.remove(id)) note('It is locked, so it was not taken out.');
      });
    } else if (act('remove')) t.delete = on(() => act('remove').run());
    else if (node.kind === 'panel' && !node.place) t.delete = off(EDITOR_WORDS.slotDelete);
    else t.delete = off(EDITOR_WORDS.cannotTakeOut);
    // Duplicate
    if (group) t.duplicate = off(EDITOR_WORDS.chooseFirst);
    else if (act('copy')) t.duplicate = on(() => act('copy').run());
    else if (node.kind === 'panel') t.duplicate = off(EDITOR_WORDS.copyModule);
    else if (node.kind === 'piece') t.duplicate = off(EDITOR_WORDS.copyPiece);
    else t.duplicate = off(EDITOR_WORDS.cannotCopy);
    // Add: into the chosen room or scene (its own "Add a piece" row, chosen and put under the cursor).
    const into = !group && node.panelId && addTargetOf(node.panelId) ? node.panelId : null;
    t.add = into ? on(() => addInto(into)) : off(EDITOR_WORDS.addHere);
    return t;
  }
  function addInto(panelId) {
    try { arr.editPanel(panelId, true); arr.editSelect(null); } catch (err) { console.error('editor: add', err); return; }
    const b = insEl.querySelector('[data-se-sec="s"] [data-em-focus="addPiece:1"]');
    if (!b) return;
    if (scanKey !== null) { scanKey = keyOf(b); paint(); }
    try { b.focus({ preventScroll: true }); } catch { /* not focusable */ }
  }
  function runTool(id) {
    if (closed) return;
    const node = tree?.nodes.get(selectedId) || null;
    const t = toolsFor(node, editingNow())[id];
    if (!t) return;
    if (!t.on) { note(t.why); return; }
    note('');
    try { t.run(); } catch (err) { console.error(`editor: ${id}`, err); }
    render();
  }

  // =====================================================================================================
  // CHOOSING A ROW.
  // =====================================================================================================
  function choose(nodeId) {
    if (closed || !tree) return false;
    const n = tree.nodes.get(nodeId);
    if (!n) return false;
    note('');
    if (GROUPISH.has(n.kind) || WORDS_LOCAL.has(n.kind)) {
      chosenLocal = n.id;
      if (editingNow()) leaveEditMode();    // edit mode's `edit/ended` draws it again
      render();
      return true;
    }
    chosenLocal = ROOT_ID;
    let ok = false;
    try { ok = arr.editPanel(n.panelId, true) !== false && !!editingNow(); } catch (err) { console.error('editor: choose', err); ok = false; }
    if (!ok) { note('That one cannot be edited from here.'); render(); return false; }
    try { arr.editSelect(n.targetId || null); } catch (err) { console.error('editor: choose', err); }
    render();
    return true;
  }

  // =====================================================================================================
  // DRAWING. Each draw is from what is there NOW (the tree is built again): a room drawn again, a piece taken out, a
  // panel placed or removed all show without anybody telling this.
  // =====================================================================================================
  /** The tree as it is now: with the words while they are shown (step 3), else exactly steps 1 and 2's. */
  function buildNow() {
    const words = wordsOn ? wordsSource({
      recs: safe(() => arr.editRecs?.() || [], []) || [], profileName: safe(() => arr.profile()?.name, '') || '',
      scanner, page: page(), drafts: readChanges(), clicked,
    }) : null;
    return safe(() => buildTree(arr, { placedModel: model(), words }), null);
  }
  /** Keep a built tree, and which row each listed element is (a press on words in the view finds its row by it). */
  function keepTree(next) {
    tree = next || { root: null, nodes: new Map(), list: [] };
    leafByEl = new Map();
    for (const n of tree.list) if (n.kind === WORDS_KINDS.site && n.words?.el) leafByEl.set(n.words.el, n.id);
  }
  function render() {
    if (closed || !box) return;
    const focusKey = doc.activeElement && box.contains(doc.activeElement) ? keyOf(doc.activeElement) : null;
    keepTree(buildNow());
    const editing = editingNow();
    let id = editing ? nodeForEditing(tree, editing) : null;
    if (!id) id = tree.nodes.has(chosenLocal) ? chosenLocal : ROOT_ID;
    selectedId = id;
    const node = tree.nodes.get(id) || null;
    // (step 2) Drawn again for the SAME thing, the inspector and the list stay where they were scrolled to (a press
    // low in a long list of rows must not jump it to the top). A different thing starts at the top.
    const sameThing = id === selectedPrev;
    const insTop = sameThing ? insEl.scrollTop : 0;
    const treeTop = treeEl.scrollTop;
    selectedPrev = id;
    drawBar(node, editing);
    drawTree();
    drawInspector(node, editing);
    try { insEl.scrollTop = insTop; treeEl.scrollTop = treeTop; } catch { /* not laid out */ }
    paint();
    if (focusKey) { const n = stops(true).find((b) => keyOf(b) === focusKey); try { n?.focus({ preventScroll: true }); } catch { /* gone */ } }
  }
  function drawBar(node, editing) {
    const t = toolsFor(node, editing);
    const why = [];
    for (const id of TOOLS) {
      const b = barEl.querySelector(`[data-se="${id}"]`);
      if (!b) continue;
      b.disabled = !t[id].on;
      b.title = t[id].on ? TOOL_LABELS[id] : t[id].why;
      if (!t[id].on) why.push(`${TOOL_LABELS[id]}: ${t[id].why}`);
    }
    // The reasons, said once in a line (a disabled button cannot be pressed to ask why).
    whyEl.textContent = why.join('  ');
    statusEl.textContent = lastNote;
  }
  function drawTree() {
    treeEl.innerHTML = tree.list.map((n) => `<button type="button" class="se-row" role="treeitem" data-se-node="${esc(n.id)}"
      data-se-kind="${esc(n.kind)}" aria-level="${n.depth + 1}" aria-selected="${n.id === selectedId}" style="--se-d:${n.depth}">${esc(n.label)}</button>`).join('');
  }
  function section(key, sel, { typed = false } = {}) {
    const wrap = doc.createElement('section');
    wrap.className = 'se-sec';
    wrap.dataset.seSec = key;
    const host = doc.createElement('div');
    wrap.append(host);
    insEl.append(wrap);
    // (row 2.145 step 2) Transform's numbers can be TYPED as well as stepped: a box between ‹ and › (edit_mode.js
    // renderOptions `typed`). Never a switch stop (stops() below takes buttons and links only).
    views.push(renderOptions(host, sel, { level: levelNow(), onDone: null, typed }));
  }
  function plain(key, title, text) {
    const wrap = doc.createElement('section');
    wrap.className = 'se-sec';
    wrap.dataset.seSec = key;
    wrap.innerHTML = `<div class="em-opts"><strong class="em-title">${esc(title)}</strong><p class="em-help">${esc(text)}</p></div>`;
    insEl.append(wrap);
  }
  function drawInspector(node, editing) {
    for (const v of views) { try { v.destroy(); } catch { /* gone */ } }
    views = [];
    insEl.innerHTML = '';
    const head = doc.createElement('div');
    head.className = 'se-head em-opts';
    insEl.append(head);
    if (node && WORDS_LOCAL.has(node.kind)) { drawWords(node, head); return; }
    if (!node || !editing || GROUPISH.has(node.kind)) {
      // The dashboard, a cell, a group: what it is, in words. Nothing to set on them in step 1.
      let help = EDITOR_WORDS.rootHelp;
      if (node?.kind === 'cell') {
        const panel = node.children()[0];
        help = panel ? `${panel.label}. ${EDITOR_WORDS.cellHelp}` : EDITOR_WORDS.emptyCell;
      } else if (node?.kind === 'group') help = EDITOR_WORDS.groupHelp;
      else {
        const L = safe(() => arr.layout(), null);
        if (L) help = `Laid out as “${preset(L.preset).label}”. ${help}`;
      }
      head.innerHTML = `<strong class="em-title" data-se-title>${esc(node?.label || 'This dashboard')}</strong><p class="em-help" data-se-help>${esc(help)}</p>`;
      return;
    }
    const sel = safe(() => arr.editSelection(), null);
    head.innerHTML = `<strong class="em-title" data-se-title>${esc(sel?.label || node.label)}</strong>${sel?.help ? `<p class="em-help" data-se-help>${esc(sel.help)}</p>` : ''}`;
    const split = splitSelection(sel);
    // TRANSFORM first: a placed panel's (the edit model's), else a piece's own rows, else why it has none. Both are
    // presented one way (editor_targets.js presentTransform), and its numbers take typing (step 2).
    const tf = node.place && !node.targetId ? safe(() => node.transform(), null) : split.transform;
    if (tf) section('t', tf, { typed: true });
    else plain('t', 'Transform', transformWhy(node, sel, { hasLayout: !!safe(() => arr.layout(), null) }));
    // ...then its own settings (and its buttons: Take it out, Copy as the default...).
    if (split.settings && (split.settings.fields.length || (split.settings.actions || []).length)) section('s', split.settings);
    // (step 3) A panel's own words: the same rows (its Words row is above), and what they are, in words.
    if (node.kind === WORDS_KINDS.own) plain('w', 'Words', EDITOR_WORDS.ownWords);
  }

  // =====================================================================================================
  // THE SITE'S WORDS IN THE INSPECTOR (row 2.145 step 3). Transform: none (words have no place of their own). Words: the
  // site's words as they are in the code (read-only), a box with the new words, and three buttons:
  //   Use these words        the change, into wording edit's draft list (wording_edit.js recordChange), and shown in
  //                          place at once (`showWordsInPlace`, marked while the words are shown)
  //   Put back the site's words   the change dropped, the element as it was
  //   Copy changes (N)       the whole list, as the wording bar copies it (`changesText`), for the site's next update
  // ONE LINE (wording_edit.js `norm`: the copied lines and the apply tool hold words on one line), so Enter keeps them and
  // there is no Shift+Enter. Up to LINE_MAX letters, as the original. Escape in the box with typing in it puts the box
  // back and is used up there (the editor stays); in a box with nothing new, it is Escape as anywhere in the editor.
  // A SWITCH: the box is not a stop (a switch cannot type, and there is no on-screen keyboard for it in the client yet --
  // the help line says so); the three buttons are, so a switch can read the words, put them back and copy the list.
  // =====================================================================================================
  function draftFor(original) {
    return readChanges().find((c) => c.page === page() && c.old === original) || null;
  }
  function drawWords(node, head) {
    if (node.kind === WORDS_KINDS.group) {
      head.innerHTML = `<strong class="em-title" data-se-title>${esc(node.label)}</strong><p class="em-help" data-se-help>${esc(EDITOR_WORDS.screenWordsHelp)}</p>`;
      return;
    }
    const w = node.words || {};
    const draft = draftFor(w.original);
    const count = readChanges().length;
    head.innerHTML = `<strong class="em-title" data-se-title>${esc(EDITOR_WORDS.siteWordsTitle)}</strong><p class="em-help" data-se-help>${esc(EDITOR_WORDS.siteWordsHelp)}</p>`;
    plain('t', 'Transform', EDITOR_WORDS.wordsTransform);
    const wrap = doc.createElement('section');
    wrap.className = 'se-sec';
    wrap.dataset.seSec = 'w';
    const notShown = draft && !(w.el && w.changed);
    wrap.innerHTML = `<div class="em-opts" role="group" aria-label="Words">
      <strong class="em-title">Words</strong>
      <p class="em-help">The site's words: <q data-se-original>${esc(w.original)}</q></p>
      ${draft ? `<p class="em-help" data-se-draft>Suggested: <q>${esc(draft.new)}</q>${notShown ? ' (not on the screen now)' : ''}</p>` : ''}
      <label class="se-wl">New words<textarea class="se-words" data-se-words data-em-focus="box" rows="3" maxlength="${LINE_MAX}" autocomplete="off">${esc(draft ? draft.new : w.original)}</textarea></label>
      <div class="em-act">
        <button type="button" class="em-btn" data-se-w="use" data-em-focus="use">Use these words</button>
        <button type="button" class="em-btn" data-se-w="back" data-em-focus="back">Put back the site's words</button>
        <button type="button" class="em-btn" data-se-w="copy" data-em-focus="copy">Copy changes (${count})</button>
      </div>
      <p class="em-help" data-se-words-help>${esc(EDITOR_WORDS.wordsKeys)}</p></div>`;
    insEl.append(wrap);
  }
  /** The chosen site words, or null. */
  const chosenWords = () => { const n = tree?.nodes.get(selectedId); return n && n.kind === WORDS_KINDS.site ? n : null; };
  function useWords(node = chosenWords(), text = null) {
    if (closed || !node) return false;
    const w = node.words || {};
    const ta = insEl.querySelector('[data-se-words]');
    const nw = norm(text != null ? text : ta ? ta.value : '');
    if (!nw) { note(EDITOR_WORDS.wordsEmpty); return false; }
    recordChange({ page: page(), old: w.original, now: nw.slice(0, LINE_MAX) });
    let shown = false;
    if (w.el && w.el.isConnected) {
      // One way back per element: the element is put back first, so its way back is always to the site's own words.
      const prev = undoInPlace.get(w.el);
      if (prev) { prev(); undoInPlace.delete(w.el); }
      if (nw !== w.original) { undoInPlace.set(w.el, showWordsInPlace(w.el, nw)); shown = true; }
    }
    scanner?.forget();
    note(nw === w.original ? EDITOR_WORDS.wordsSame : shown ? EDITOR_WORDS.wordsKept : EDITOR_WORDS.wordsKeptNotShown);
    render();
    return true;
  }
  function putBackWords(node = chosenWords()) {
    if (closed || !node) return false;
    const w = node.words || {};
    const had = !!draftFor(w.original);
    if (had) recordChange({ page: page(), old: w.original, now: w.original });   // withChange: back to the original drops it
    const undo = w.el ? undoInPlace.get(w.el) : null;
    if (undo) { undo(); undoInPlace.delete(w.el); }
    scanner?.forget();
    note(had || undo ? EDITOR_WORDS.wordsBack : EDITOR_WORDS.wordsAlready);
    render();
    return had || !!undo;
  }
  async function copyWords() {
    const list = readChanges();
    const text = changesText(list, now().toISOString().slice(0, 10));
    try {
      if (!clipboard?.writeText) throw new Error('no clipboard');
      await clipboard.writeText(text);
      note(copiedWords(list.length));
    } catch { note(EDITOR_WORDS.noCopy); }
    return text;
  }

  // =====================================================================================================
  // WORDS SHOWN, AND A PRESS ON WORDS IN THE VIEW (row 2.145 step 3).
  // While the words are shown, a press on words anywhere outside the editor's box CHOOSES them and presses nothing: a
  // capture listener on the WINDOW (it runs before edit mode's, which is on the panel's box) takes the press, the
  // pointer-down that comes before it and the mouse-down, as the wording bar does. Which words: the wording bar's own
  // rule (wording_edit.js `wordsElementAt`). Then:
  //   * words listed under a panel: that row;
  //   * a panel's own words (a sign's): its row, through edit mode, as a press in edit mode would choose it;
  //   * words inside a panel that are not listed (a clock's time, words over the cap, words the panel built since the
  //     list was drawn): the list is drawn again and looked at once more; still not there, the press is the panel's;
  //   * words outside every panel: they join "Words on this screen" and are chosen.
  // A touch is not cancelled (that would cancel the click a touch makes), only kept from the page.
  // Words hidden: nothing is listened to; steps 1 and 2 exactly.
  // =====================================================================================================
  function panelAt(t) {
    const recs = safe(() => arr.editRecs?.() || [], []) || [];
    const holding = recs.filter((r) => r && r.el && typeof r.el.contains === 'function' && r.el.contains(t));
    return holding.find((r) => holding.every((o) => o === r || !r.el.contains(o.el))) || null;
  }
  function ownWordsAt(t, rec) {
    if (!rec) return null;
    const tg = safe(() => targetAt(targetsOf(rec), t), null);
    const id = tg ? nodeIdFor(rec.id, tg.id) : null;
    return id && tree?.nodes.get(id)?.kind === WORDS_KINDS.own ? id : null;
  }
  function wordsHit(t) {
    const el = wordsElementAt(t);
    if (!el || box.contains(el) || el.closest?.('#wording-edit-bar')) return null;
    const rec = panelAt(t);
    const find = () => leafByEl.get(el) || ownWordsAt(t, rec);
    let id = find();
    if (id) return { id };
    if (rec) { render(); id = find(); return id ? { id } : null; }
    const shown = norm(el.textContent);
    if (!shown || shown.length > LINE_MAX || !HAS_LETTER.test(shown) || el.closest?.('[data-live-words], [role="timer"], [aria-live], [hidden]')) return null;
    return { add: el };
  }
  function onViewPress(e) {
    if (closed || !wordsOn) return;
    const n = e.target;
    const t = n && n.nodeType === 1 ? n : n?.parentElement || null;
    if (!t || !t.isConnected || box.contains(t)) return;
    const hit = wordsHit(t);
    if (!hit) return;
    if (e.type !== 'touchstart') e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    activity();
    if (hit.add) {
      if (!clicked.includes(hit.add)) clicked.push(hit.add);
      render();
      const id = leafByEl.get(hit.add);
      if (id) choose(id);
      return;
    }
    choose(hit.id);
  }
  function setWords(on) {
    const want = !!on;
    if (closed || want === wordsOn) return wordsOn;
    wordsOn = want;
    if (want) {
      scanner = createWordsScanner({ win });
      for (const ev of VIEW_PRESSES) win.addEventListener(ev, onViewPress, true);
      // Changed words are marked only while the words are shown (a ring left on a dashboard after would be noise).
      try { doc.documentElement.dataset.seWordsShown = ''; } catch { /* no page */ }
    } else {
      for (const ev of VIEW_PRESSES) win.removeEventListener(ev, onViewPress, true);
      try { scanner?.destroy(); } catch { /* gone */ }
      scanner = null;
      try { delete doc.documentElement.dataset.seWordsShown; } catch { /* no page */ }
      if (WORDS_LOCAL.has(tree?.nodes.get(selectedId)?.kind)) chosenLocal = ROOT_ID;
    }
    const b = barEl.querySelector('[data-se="words"]');
    if (b) { b.setAttribute('aria-pressed', String(want)); b.textContent = want ? EDITOR_WORDS.hideWords : EDITOR_WORDS.showWords; }
    note(want ? EDITOR_WORDS.wordsShown : '');
    render();
    return wordsOn;
  }

  // =====================================================================================================
  // THE SWITCH WALK: every button in the editor, in the order drawn -- Done first (it is the first thing drawn) --
  // skipping a text box (a switch cannot type; its ✓ is the stop) and anything disabled or put away. The kiosk calls
  // next / prev / select while the editor holds the scan, and back (true: used here; false: the kiosk closes it).
  // =====================================================================================================
  function keyOf(el) {
    if (!el || !el.dataset) return null;
    if (el.dataset.se) return `bar:${el.dataset.se}`;
    if (el.dataset.seNode) return `tree:${el.dataset.seNode}`;
    const sec = el.closest?.('[data-se-sec]');
    if (sec && el.dataset.emFocus) return `${sec.dataset.seSec}:${el.dataset.emFocus}`;
    return null;
  }
  function stops(withInputs = false) {
    if (!box) return [];
    const sel = withInputs ? 'button, a[href], input, textarea' : 'button, a[href]';
    return [...box.querySelectorAll(sel)].filter((b) => !b.disabled && !b.hidden && !b.closest('[hidden]') && keyOf(b));
  }
  function current() {
    if (scanKey === null) return null;
    const list = stops();
    if (!list.length) return null;
    const hit = list.find((b) => keyOf(b) === scanKey);
    if (hit) return hit;
    // The stop went (a row taken out, a tool now disabled): the one now in its place.
    const n = list[Math.max(0, Math.min(scanIdx, list.length - 1))];
    scanKey = keyOf(n);
    return n;
  }
  function paint() {
    if (!box) return null;
    box.querySelectorAll('.se-scan').forEach((n) => n.classList.remove('se-scan'));
    const n = current();
    if (n) {
      n.classList.add('se-scan');
      scanIdx = stops().indexOf(n);
      try { n.scrollIntoView?.({ block: 'nearest' }); } catch { /* not laid out */ }
    }
    return n;
  }
  function step(d) {
    const list = stops();
    if (!list.length) return null;
    const cur = current();
    const i = cur ? list.indexOf(cur) : -1;
    const n = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + Math.sign(d || 1) + list.length) % list.length;
    scanKey = keyOf(list[n]);
    scanIdx = n;
    return paint();
  }
  const scan = {
    stops: () => stops(),
    current: () => current(),
    next: () => step(1),
    prev: () => step(-1),
    select() {
      const c = current();
      if (!c) return false;
      c.click();
      paint();
      return true;
    },
    /** Back: out of edit mode's choice first (true); with nothing chosen, false -- the host closes the editor. */
    back() {
      if (closed) return false;
      if (editingNow()) { leaveEditMode(); render(); return true; }
      // (step 3) Out of chosen words to the dashboard's row, as out of edit mode's choice.
      if (WORDS_LOCAL.has(tree?.nodes.get(selectedId)?.kind)) { chosenLocal = ROOT_ID; render(); return true; }
      return false;
    },
    holds: () => false,
    reset() { scanKey = null; scanIdx = -1; paint(); },
  };

  // =====================================================================================================
  // EVENTS.
  // =====================================================================================================
  barEl.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button[data-se]') : null;
    if (!b || b.disabled || !barEl.contains(b)) return;
    const id = b.dataset.se;
    if (id === 'done') { close('done'); return; }
    if (id === 'words') { setWords(!wordsOn); activity(); return; }
    if (id === 'list') {
      const show = treeEl.hidden;
      treeEl.hidden = !show;
      b.setAttribute('aria-expanded', String(show));
      b.textContent = show ? 'Hide the list' : 'Show the list';
      paint();
      return;
    }
    runTool(id);
  });
  treeEl.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-se-node]') : null;
    if (!b || !treeEl.contains(b)) return;
    choose(b.dataset.seNode);
  });
  // A pointer press moves the switch cursor too (when one is showing), so the two never disagree about where it is.
  // Capture: the inspector's own rows stop their clicks (edit_mode.js renderOptions), and they redraw themselves.
  box.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button, a[href]') : null;
    if (!b || !box.contains(b)) return;
    if (scanKey !== null && keyOf(b)) scanKey = keyOf(b);
    queueMicrotask(() => { if (!closed) paint(); });
    if (insEl.contains(b) && (b.matches('[data-em-run]') || b.matches('[data-em-step]'))) laterFollow();
  }, true);
  // ...and a number typed and kept (Enter in a Transform box) the same.
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof Element && e.target.matches('[data-em-num]') && insEl.contains(e.target)) laterFollow();
  }, true);
  // (step 3) The Words section's buttons, and its box: Enter keeps the words; Escape with typing in it puts the box back
  // and is used up here (the editor's own Escape below ignores a key already used).
  insEl.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-se-w]') : null;
    if (!b || !insEl.contains(b)) return;
    const node = chosenWords();
    if (!node) return;
    activity();
    if (b.dataset.seW === 'use') useWords(node);
    else if (b.dataset.seW === 'back') putBackWords(node);
    else if (b.dataset.seW === 'copy') copyWords();
  });
  insEl.addEventListener('keydown', (e) => {
    const ta = e.target instanceof Element && e.target.matches('[data-se-words]') ? e.target : null;
    if (!ta) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); useWords(); return; }
    if (e.key === 'Escape' && ta.value !== ta.defaultValue) { e.preventDefault(); e.stopPropagation(); ta.value = ta.defaultValue; }
  });
  // (row 2.145 step 2) AFTER A CHANGE MADE IN THE INSPECTOR, THE LIST FOLLOWS. A press there can change what is in the
  // list, not only a value: a piece taken out or copied ("Take it out", "Copy it"), a Town place opened ("Open a place"
  // puts its things in the list), a piece added. So once the press is done the tree is built again, and if it differs
  // (or edit mode's choice has moved) the editor is drawn again; if it is the same, only the toolbar is (Undo may have
  // lit). FOR checking first: drawing the inspector again on every ‹ › would be wasted work on a Pi 400 for the usual
  // press, which changes a number and nothing in the list. AGAINST: the tree is built twice for a press that does change it.
  // A TIMER, NOT A MICROTASK: a real press runs microtasks between this capture listener and the row's own, and drawing
  // here would take the button away before its row's listener saw it pressed (edit_mode.js renderOptions checks it is
  // still there). One pending at a time.
  let followTimer = null;
  const sigOf = (tr) => (tr?.list || []).map((n) => `${n.id}|${n.label}|${n.kind}`).join('\n');
  function laterFollow() {
    if (closed || followTimer !== null) return;
    const win = doc.defaultView || globalThis;
    followTimer = win.setTimeout(() => {
      followTimer = null;
      if (closed) return;
      const next = buildNow();
      const editing = editingNow();
      const id = next && editing ? nodeForEditing(next, editing) : null;
      if (!next || sigOf(next) !== sigOf(tree) || (editing && id !== selectedId)) { render(); return; }
      keepTree(next);
      drawBar(tree.nodes.get(selectedId) || null, editing);
      paint();
    }, 0);
  }
  // ESCAPE. While edit mode has something chosen, its own capture listener takes the key first (and leaves); so a key
  // that reaches here is a second one, or one with nothing chosen: it closes the editor. Bubble phase, and claimed, so
  // the same key does not also open the menu (input_keyboard.js binds Escape to it on window).
  function onKey(e) {
    if (closed || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    if (editingNow()) { leaveEditMode(); render(); return; }
    // (step 3) Chosen words are left first too, the same way: the dashboard's row, the editor still open.
    if (WORDS_LOCAL.has(tree?.nodes.get(selectedId)?.kind)) { chosenLocal = ROOT_ID; render(); return; }
    close('escape');
  }
  doc.addEventListener('keydown', onKey);
  if (bus && typeof bus.subscribe === 'function') {
    offs.push(bus.subscribe(EDIT_SELECTED_TOPIC, (p) => {
      if (closed || !p || typeof p !== 'object') return;
      // Only this dashboard's choice (a nested dashboard's edit mode publishes on the same bus).
      const e = editingNow();
      if (!e || e.id !== p.panelId) return;
      try { p.claim?.(); } catch { /* nothing to claim */ }
      render();
      activity();
    }));
    offs.push(bus.subscribe(EDIT_ENDED_TOPIC, () => { if (!closed) render(); }));
  }

  function close(reason = 'done') {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onKey);
    // (step 3) The words' watch and the window's listeners go with it. Words changed in place stay as they are shown (the
    // change is kept to copy), as the wording bar leaves them; their mark goes with the words being shown.
    for (const ev of VIEW_PRESSES) win.removeEventListener(ev, onViewPress, true);
    try { scanner?.destroy(); } catch { /* gone */ }
    scanner = null;
    try { delete doc.documentElement.dataset.seWordsShown; } catch { /* no page */ }
    for (const off of offs.splice(0)) { try { off?.(); } catch { /* gone */ } }
    // Edit mode's choice ends with the editor (its in-panel card would otherwise come back on a panel nobody chose).
    leaveEditMode();
    for (const v of views) { try { v.destroy(); } catch { /* gone */ } }
    views = [];
    try { placed?.close(); } catch { /* gone */ }
    try { box.remove(); } catch { /* gone */ }
    try { onClose?.(reason); } catch (err) { console.error('editor: onClose', err); }
  }

  // Already something chosen when it opened: chosen again, so this claims it (the in-panel card goes) and shows it.
  const was = editingNow();
  if (was) { try { arr.editSelect(was.target); } catch { /* gone */ } }
  // (step 3) Opened with the words shown (`?wording=1`): only when the opener asked. It draws (setWords renders).
  if (wordsAtOpen) setWords(true); else render();

  return {
    kind: SCENE_EDITOR_KIND,
    el: box,
    scan,
    close: () => close('done'),
    isOpen: () => !closed,
    refresh: render,
    tree: () => tree,
    selected: () => selectedId,
    placedModel: () => model(),
    choose,
    tools: () => toolsFor(tree?.nodes.get(selectedId) || null, editingNow()),
    // (step 3) The words: shown or not, shown or hidden, and the Words section's three buttons (for a host and the suite).
    words: () => wordsOn,
    showWords: (on = true) => setWords(on),
    useWords: (text = null) => useWords(chosenWords(), text),
    putBackWords: () => putBackWords(chosenWords()),
    copyWords,
  };
}

// =====================================================================================================
// THE LOOK: the theme's tokens only (theme.js sets them), solid like edit mode's card -- a question you have to read
// should not be see-through. The editor's own design is Design's item 49; this is the plain look until it comes.
// THE NUMBERS (Rule 1):
//   tree 240px    FOR: a module's name ("Who's who", "Cell 3 of 4") at 15px fits on one line, indented two levels.
//                 AGAINST: the view is narrower by that much -- so also never more than 35% of the width.
//   inspector 340px  edit mode's own card width (edit_mode.js .em-card), so a row reads the same in both.
//                 AGAINST: the view loses it; never more than 45% of the width.
//   700px         FOR: below it the tree (240) and the inspector (340) with their gaps leave under 100px of view
//                 between them, so the inspector becomes a sheet along the bottom and the tree a band at the top --
//                 every phone, and a small tablet held upright. AGAINST: a 768px upright tablet keeps the two
//                 columns with about 150px of view between them; the list can be put away (Hide the list) there.
//   sheet 45%     FOR: more than half the view stays visible above it; AGAINST: a long list of rows scrolls inside it.
//   list band 30% the tree on a narrow screen: a few rows, scrolling; less than the sheet, which holds the rows to set.
//   indent 16px   a level of the tree. FOR: four levels (dashboard, cell, panel, its part) stay inside 240px with room
//                 for the name; AGAINST: a deeper tree (Town's places, step 2) will want less -- a token then, not now.
//   rows 44px     the touch size every button here already has (edit_mode.js .em-btn), so a row is pressable too.
//   (row 2.145 step 3, 2026-10-31) THE WORDS:
//   words box 3 rows  FOR: a 300-letter line wraps to about four lines at the inspector's width, so three show most of a
//                 long one and all of a short one; AGAINST: a very long one scrolls inside it (it can be made taller).
//   site words in italics, "Words on this screen" soft like the other groups: told apart from panels by SHAPE, not
//                 colour (the theme's tokens are the only colours here).
//   changed words: a double ring in the theme's --focus while the words are shown (`html[data-se-words-shown]`), so a
//                 dashboard is not left ringed after; told from edit mode's rings (dashed, dotted, solid) by shape.
// No ResizeObserver or animation frame: the layout is the browser's, from CSS alone.
// =====================================================================================================
const CSS_ID = 'se-css';
export function ensureSceneCss(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || doc.getElementById(CSS_ID)) return;
  const s = doc.createElement('style');
  s.id = CSS_ID;
  s.textContent = `
.se{position:absolute;inset:0;z-index:var(--z-menus,600);display:flex;flex-direction:column;gap:8px;padding:8px;box-sizing:border-box;
  pointer-events:none;font:15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text)}
.se-bar,.se-tree,.se-ins{pointer-events:auto;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:12px;
  box-shadow:0 6px 24px color-mix(in srgb,var(--text) 25%,transparent)}
.se-bar{flex:none;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px}
.se-btn:disabled{opacity:.55;cursor:not-allowed}
.se-status{font-weight:650}
.se-why{flex-basis:100%;color:var(--text-soft,var(--text));font-size:.85rem}
.se-why:empty,.se-status:empty{display:none}
.se-main{flex:1;min-height:0;display:flex;gap:8px;align-items:stretch}
.se-tree{flex:none;width:min(240px,35%);overflow:auto;padding:6px;box-sizing:border-box}
.se-tree[hidden]{display:none}
.se-gap{flex:1;min-width:0}
.se-ins{flex:none;width:min(340px,45%);overflow:auto;box-sizing:border-box}
.se-row{display:block;width:100%;min-height:44px;margin:0 0 2px;padding:6px 8px 6px calc(8px + var(--se-d,0) * 16px);text-align:start;
  border:1px solid transparent;border-radius:8px;background:transparent;color:var(--text);font:inherit;cursor:pointer}
.se-row[data-se-kind="dashboard"],.se-row[data-se-kind="cell"],.se-row[data-se-kind="group"]{color:var(--text-soft,var(--text))}
.se-row[aria-selected="true"]{background:var(--surface-alt,var(--surface));border-color:var(--focus,var(--accent));font-weight:700;color:var(--text)}
.se-row:focus-visible{outline:3px solid var(--focus,var(--accent));outline-offset:2px}
.se .se-scan{outline:3px solid var(--focus,var(--accent));outline-offset:2px;box-shadow:0 0 0 2px var(--surface)}
.se-head{padding-bottom:0}
.se-sec{border-top:1px solid var(--border)}
.se-row[data-se-kind="wordsgroup"]{color:var(--text-soft,var(--text))}
.se-row[data-se-kind="sitewords"]{font-style:italic}
.se-btn[aria-pressed="true"]{border-color:var(--focus,var(--accent));box-shadow:inset 0 0 0 2px var(--focus,var(--accent))}
.se-wl{display:grid;gap:4px;margin:6px 0;font-weight:650}
.se-words{width:100%;min-height:72px;box-sizing:border-box;padding:6px 8px;border:1px solid var(--border);border-radius:8px;
  background:var(--surface);color:var(--text);font:400 15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;resize:vertical}
.se-words:focus-visible{outline:3px solid var(--focus,var(--accent));outline-offset:2px}
html[data-se-words-shown] [data-wording-changed]{outline:3px double var(--focus,var(--accent));outline-offset:2px}
@media (max-width:700px){
  .se-main{flex-direction:column}
  .se-tree{width:auto;max-height:30%}
  .se-ins{width:auto;max-height:45%}
}`;
  (doc.head || doc.documentElement).append(s);
}
