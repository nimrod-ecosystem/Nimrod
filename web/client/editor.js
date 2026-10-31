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
import { renderOptions, ensureEditCss, targetsOf, EDIT_SELECTED_TOPIC, EDIT_ENDED_TOPIC } from './edit_mode.js';
import { buildTree, nodeForEditing, splitSelection, ROOT_ID } from './editor_targets.js';
import { preset } from './layout.js';

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
  addHere: 'Adding to the dashboard from here is not built yet. Choose a room or a scene to add a piece to it.',
  slotTransform: 'Its place is its cell of the layout.',
  stageTransform: 'It fills the screen.',
  roomTransform: 'The room fills the screen behind the panels.',
  partTransform: 'It moves with its panel.',
  rootHelp: 'Choose something in the list, or press ✎ on a panel and then a thing in it. Its options show here.',
  cellHelp: 'Choose the panel in it to see its options.',
  emptyCell: 'Nothing is in this cell.',
  groupHelp: 'Panels placed freely. Choose one to move it with numbers.',
});

const LEVELS = ['essential', 'standard', 'advanced'];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safe = (fn, fallback = null) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
const GROUPISH = new Set(['dashboard', 'cell', 'group']);
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
 */
export function openSceneEditor(opts = {}) {
  const { arr, bus = null, mountIn = null, dashOpts = null, level = 'standard', notify = null, onClose = null, onActivity = null } = opts;
  if (!arr) throw new Error('openSceneEditor: an arrangement is required');
  const doc = mountIn?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) throw new Error('openSceneEditor: there is no page to draw on');
  const levelNow = () => { const v = safe(() => (typeof level === 'function' ? level() : level), 'standard'); return LEVELS.includes(v) ? v : 'standard'; };
  let closed = false;
  let box = null;
  let tree = null;
  let selectedId = ROOT_ID;
  let chosenLocal = ROOT_ID;      // a row that is not a panel (the dashboard, a cell, a group): chosen here, not in edit mode
  let views = [];
  let lastNote = '';
  let scanKey = null;
  let scanIdx = -1;
  const offs = [];

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
    if (GROUPISH.has(n.kind)) {
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
  function render() {
    if (closed || !box) return;
    const focusKey = doc.activeElement && box.contains(doc.activeElement) ? keyOf(doc.activeElement) : null;
    tree = safe(() => buildTree(arr, { placedModel: model() }), null) || { root: null, nodes: new Map(), list: [] };
    const editing = editingNow();
    let id = editing ? nodeForEditing(tree, editing) : null;
    if (!id) id = tree.nodes.has(chosenLocal) ? chosenLocal : ROOT_ID;
    selectedId = id;
    const node = tree.nodes.get(id) || null;
    drawBar(node, editing);
    drawTree();
    drawInspector(node, editing);
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
  function section(key, sel) {
    const wrap = doc.createElement('section');
    wrap.className = 'se-sec';
    wrap.dataset.seSec = key;
    const host = doc.createElement('div');
    wrap.append(host);
    insEl.append(wrap);
    views.push(renderOptions(host, sel, { level: levelNow(), onDone: null }));
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
    // TRANSFORM first: a placed panel's (the edit model's), else a piece's own rows, else why it has none.
    const tf = node.place && !node.targetId ? safe(() => node.transform(), null) : split.transform;
    if (tf) section('t', tf);
    else {
      const why = node.kind === 'room' ? EDITOR_WORDS.roomTransform : node.targetId ? EDITOR_WORDS.partTransform
        : safe(() => arr.layout(), null) ? EDITOR_WORDS.slotTransform : EDITOR_WORDS.stageTransform;
      plain('t', 'Transform', why);
    }
    // ...then its own settings (and its buttons: Take it out, Copy as the default...).
    if (split.settings && (split.settings.fields.length || (split.settings.actions || []).length)) section('s', split.settings);
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
    const sel = withInputs ? 'button, a[href], input' : 'button, a[href]';
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
  }, true);
  // ESCAPE. While edit mode has something chosen, its own capture listener takes the key first (and leaves); so a key
  // that reaches here is a second one, or one with nothing chosen: it closes the editor. Bubble phase, and claimed, so
  // the same key does not also open the menu (input_keyboard.js binds Escape to it on window).
  function onKey(e) {
    if (closed || e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    if (editingNow()) { leaveEditMode(); render(); return; }
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
  render();

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
@media (max-width:700px){
  .se-main{flex-direction:column}
  .se-tree{width:auto;max-height:30%}
  .se-ins{width:auto;max-height:45%}
}`;
  (doc.head || doc.documentElement).append(s);
}
