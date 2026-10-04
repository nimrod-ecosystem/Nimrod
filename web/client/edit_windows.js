// edit_windows.js — DESIGN'S EDIT WINDOWS, as pieces any dashboard or module can open.
//
// Rows 2.33 / 2.34 (Mike, 2026-09-30): the editors are "just some edit windows you can open in
// any dashboard/module". Design's spec is `room-is-the-screen/README.md` §6 and its working
// prototype `edit-windows.html`; this is that prototype rebuilt over a model instead of a global.
//
//   mountTransformWindow(host, model, opts)    X, Y, Scale, Rotation, Layer; Fine steps; Place / Surface
//   mountSnapWindow(host, model, opts)         Snap to grid, Show grid, Snap to centre, Fine steps; grid size
//   mountLayersWindow(host, model, opts)       top first; ▲ ▼ Shown/Hidden Lock per row; Undo … Delete
//   mountTextEffectsWindow(host, model, opts)  Outline, Glow, Bevel, Emboss; the contrast line
//   mountAutomationWindow(host, opts)          row 2.41: settings driven by something else (automation_panel.js)
//
// Each takes a model from `edit_model.js` and edits it ONLY through the model's methods, and
// redraws when the model says something changed. So the thing being edited can be anything that
// can be described as items — Design's boxes in the demo page today, step 6 Stage R's placed
// modules later — and the window never learns which. `opts.onClose()` is called when it closes.
//
// WHAT A WINDOW PROMISES, each one tested in `dev/edit_windows_test.html`:
//
//   * SOLID AND NON-MODAL. `role="dialog" aria-modal="false"`: it covers its own rectangle and
//     nothing else, and the rest of the page (the plain bar above all) keeps working.
//   * A WAY OUT, ALWAYS. Close is in every window, whatever state the model is in, and it is the
//     FIRST stop of the switch walk. Escape closes it too, and is claimed (preventDefault +
//     stopPropagation) the same way the settings menu claims it, so one Escape does one thing.
//   * NOTHING NEEDS A DRAG. Every number has − and + (a switch can set it), and a typed box
//     (a keyboard can set it exactly).
//   * THE SWITCH WALK: `scanTargets()` / `focusStep(d)` / `select()` / `current()` — the same
//     names `room_scene.js` uses, so a host drives both the same way. The walk skips disabled
//     controls and skips the TYPED BOXES: a box is not something a switch can operate, and at a
//     15-second step every stop a switch cannot use costs its user fifteen seconds. The same
//     reasoning `color_picker.js` gives for keeping swatches out of the walk. The cursor stays on
//     the control it was on across a redraw, so pressing + five times is five presses, not a hunt.

import {
  TRANSFORM_KEYS, PLACES, SURFACES, PLACE_LABELS, SURFACE_LABELS, EFFECTS, EFFECT_AMOUNT,
  normalizeFx, hasText, stepSize,
} from './edit_model.js';
// Row 2.38: the map of the person's dashboards (the Map window).
import { mapSvg, mapListForm, MAP_DEFAULTS } from './dashboard_map.js';
// Row 2.41: the automation editor (the Automation window).
import { mountAutomationPanel } from './automation_panel.js';

function ensureStyles(doc) {
  if (!doc || doc.querySelector('link[data-edit-windows-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./edit_windows.css', import.meta.url).href;
    link.setAttribute('data-edit-windows-css', '');
    doc.head.append(link);
  } catch { /* a page without a head still gets working, unstyled windows */ }
}
// Row 2.38: the Opens-and-shows choice lists and the map, in their own sheet (same rule: tokens only).
function ensureMapStyles(doc) {
  if (!doc || doc.querySelector('link[data-edit-map-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./edit_map.css', import.meta.url).href;
    link.setAttribute('data-edit-map-css', '');
    doc.head.append(link);
  } catch { /* unstyled still works */ }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let uid = 0;

// ---------------------------------------------------------------------------------------
// THE SHELL every window shares: header with the title and Close, a body the window draws,
// clicks and typed commits routed to the window, Escape, the switch walk, and destroy.
// ---------------------------------------------------------------------------------------
function mountWindow(host, model, { kind, title, subtitle = () => '', body, onAction, onCommit, onClose, onPaint, afterRender }) {
  if (!host) throw new Error(`edit_windows: a host element is required (${kind})`);
  if (!model || typeof model.subscribe !== 'function') throw new Error(`edit_windows: a model is required (${kind})`);
  const doc = host.ownerDocument || document;
  ensureStyles(doc);
  const id = `ew-${kind}-${++uid}`;
  const el = doc.createElement('section');
  el.className = `ew-win ew-${kind}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', `${id}-t`);
  host.append(el);

  let destroyed = false;
  let scanKey = null;
  let scanIdx = -1;
  const ac = new AbortController();

  const byKey = (k) => (k ? [...el.querySelectorAll('[data-ew]')].find((n) => n.dataset.ew === k) || null : null);

  function render() {
    if (destroyed) return;
    // Keep keyboard focus, and a half-typed number, across the redraw.
    const active = doc.activeElement;
    let keep = null;
    if (active && el.contains(active) && active.dataset?.ew) {
      keep = { key: active.dataset.ew, input: active.tagName === 'INPUT', value: active.value,
        dirty: active.tagName === 'INPUT' && active.value !== active.getAttribute('value'),
        s: active.selectionStart, e: active.selectionEnd };
    }
    el.innerHTML = `<header class="ew-head"><h3 id="${id}-t">${esc(title)}</h3>`
      + `<span class="ew-sub">${esc(subtitle())}</span>`
      + `<button type="button" class="ew-close" data-ew="close" aria-label="Close ${esc(title)}">Close</button></header>`
      + `<div class="ew-in">${body(id)}</div>`;
    if (keep) {
      const n = byKey(keep.key);
      if (n && !n.disabled) {
        if (keep.input && keep.dirty) n.value = keep.value;
        try { n.focus({ preventScroll: true }); } catch { /* detached */ }
        if (keep.input && keep.dirty) { try { n.setSelectionRange(keep.s, keep.e); } catch { /* not a text box */ } }
      }
    }
    try { afterRender?.(el); } catch (err) { console.error('edit_windows: afterRender', err); }
    paintScan();
  }

  // ---- the switch walk --------------------------------------------------------------
  function scanTargets() {
    if (destroyed) return [];
    const all = [...el.querySelectorAll('button[data-ew]')].filter((b) => !b.disabled && !b.hidden);
    const close = all.find((b) => b.dataset.ew === 'close');
    return close ? [close, ...all.filter((b) => b !== close)] : all;
  }
  function current() {
    const list = scanTargets();
    if (!list.length || scanIdx < 0) return null;
    const n = byKey(scanKey);
    if (n && list.includes(n)) return n;
    return list[Math.min(scanIdx, list.length - 1)];
  }
  function paintScan() {
    el.querySelectorAll('.is-scan').forEach((n) => n.classList.remove('is-scan'));
    const n = current();
    if (n) { n.classList.add('is-scan'); scanKey = n.dataset.ew; scanIdx = scanTargets().indexOf(n); }
    try { onPaint?.(n, el); } catch (err) { console.error('edit_windows: onPaint', err); }
    return n;
  }
  // Row 2.38: a GROUP of windows walked as one (`createWindowGroup`) puts the cursor on a given control,
  // and takes it off this window entirely when the cursor is in another one.
  function focusTarget(n) {
    const list = scanTargets();
    const i = list.indexOf(n);
    if (i < 0) return null;
    scanIdx = i; scanKey = n.dataset.ew;
    return paintScan();
  }
  function blur() { scanIdx = -1; scanKey = null; paintScan(); }
  function focusStep(d) {
    const list = scanTargets();
    if (!list.length) return null;
    const at = current() ? list.indexOf(current()) : -1;
    scanIdx = at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + Math.sign(d || 1) + list.length) % list.length;
    scanKey = list[scanIdx].dataset.ew;
    return paintScan();
  }
  function select() {
    const n = current();
    if (!n) return false;
    n.click();
    return true;
  }

  // ---- events -------------------------------------------------------------------------
  function commitInput(n) {
    const changed = onCommit?.(n.dataset.ew, n.value);
    // Nothing changed (garbage, or the same value): the model said nothing, so put the real
    // value back in the box ourselves rather than leave "abc" showing.
    if (!changed) { n.value = n.getAttribute('value') ?? ''; render(); }
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest?.('button[data-ew]');
    if (!b || !el.contains(b) || b.disabled) return;
    const k = b.dataset.ew;
    if (k === 'close') { close(); return; }
    // A pointer press moves the switch cursor too, so the two never disagree about where it is.
    if (scanIdx >= 0) { scanKey = k; }
    onAction?.(k);
    paintScan();
  }, { signal: ac.signal });
  el.addEventListener('change', (e) => {
    const n = e.target;
    if (n?.tagName === 'INPUT' && n.dataset.ew && el.contains(n)) commitInput(n);
  }, { signal: ac.signal });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    const n = e.target;
    if (e.key === 'Enter' && n?.tagName === 'INPUT' && n.dataset.ew) { e.preventDefault(); commitInput(n); }
  }, { signal: ac.signal });

  const unsub = model.subscribe(() => render());

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    ac.abort();
    unsub();
    el.remove();
  }
  function close() {
    if (destroyed) return;
    destroy();
    try { onClose?.(); } catch (err) { console.error('edit_windows: onClose', err); }
  }

  render();
  return { el, kind, render, close, destroy, scanTargets, focusStep, focusTarget, blur, select, current, isOpen: () => !destroyed };
}

// ---------------------------------------------------------------------------------------
// ROW 2.38: SEVERAL WINDOWS, ONE SWITCH WALK. The edit view opens three or four windows at once; a
// switch walks them as ONE list -- each window's own stops, in order, Close of the first window first
// (closing any one window ends the editing, so that Close is the way out the walk lands on first).
// `windows()` is read on every step, so a window opened or closed meanwhile is simply in or out.
// ---------------------------------------------------------------------------------------
export function createWindowGroup(windows) {
  const live = () => (typeof windows === 'function' ? windows() : windows || []).filter((w) => w && w.isOpen?.());
  let at = null;                    // the window the cursor is in
  const stops = () => live().flatMap((w) => w.scanTargets().map((el) => ({ w, el })));
  function current() {
    if (!at || !at.isOpen()) return null;
    return at.current();
  }
  // 2026-10-04: a window that HOLDS the walk (the Automation window with a row entered or its picker open)
  // gets next / prev itself, so the cursor walks inside it instead of leaving for the next window.
  const holding = () => !!(at && at.isOpen() && typeof at.holds === 'function' && at.holds());
  function step(d) {
    if (holding()) return at.focusStep(d);
    const list = stops();
    if (!list.length) { at = null; return null; }
    const cur = current();
    const i = cur ? list.findIndex((s) => s.el === cur) : -1;
    const n = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + Math.sign(d || 1) + list.length) % list.length;
    for (const w of live()) if (w !== list[n].w) w.blur();
    at = list[n].w;
    return at.focusTarget(list[n].el);
  }
  return {
    stops: () => stops().map((s) => s.el),
    current,
    next: () => step(1),
    prev: () => step(-1),
    select() { if (holding()) return at.select(); const c = current(); if (!c) return false; return at.select(); },
    /** Back, for a window that has a level to come out of: true when it used the press (it came out of a
     *  row, or put itself away); false when it did not, and the host decides (the kiosk ends the editing). */
    back() {
      if (!at || !at.isOpen() || typeof at.back !== 'function' || (!holding() && !current())) return false;
      return at.back() === true;
    },
    /** True while the window the cursor is in holds the walk. */
    holds: () => holding(),
    reset() { for (const w of live()) w.blur(); at = null; },
  };
}

// ---------------------------------------------------------------------------------------
// Small drawing helpers.
// ---------------------------------------------------------------------------------------
const btn = (key, label, { pressed, disabled, aria, cls = '' } = {}) => `<button type="button" class="${cls}" data-ew="${esc(key)}"`
  + (pressed === undefined ? '' : ` aria-pressed="${pressed ? 'true' : 'false'}"`)
  + (aria ? ` aria-label="${esc(aria)}"` : '') + (disabled ? ' disabled' : '') + `>${esc(label)}</button>`;
const toggle = (key, label, on, disabled) => btn(key, label, { pressed: !!on, disabled, cls: 'ew-tg' });
const seg = (label, buttons) => `<div class="ew-seg" role="group" aria-label="${esc(label)}">${buttons.join('')}</div>`;
const fmt = (v) => String(v);

function numberRow(uidp, key, label, value, unit, { disabled, less, more, inputLabel, stepKey, inputKey }) {
  const iid = `${uidp}-${key}`;
  // No visible label when the row already has one beside it (a text-effect toggle); the box then
  // carries its own spoken name.
  return `<div class="ew-f${label ? '' : ' ew-f-bare'}">${label ? `<label for="${iid}">${esc(label)}</label>` : ''}`
    + btn(`${stepKey}:-1`, '−', { aria: less, disabled, cls: 'ew-st' })
    + `<input id="${iid}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-ew="${esc(inputKey)}"`
    + ` value="${esc(fmt(value))}" aria-label="${esc(inputLabel || label)}"${disabled ? ' disabled' : ''}>`
    + btn(`${stepKey}:1`, '+', { aria: more, disabled, cls: 'ew-st' })
    + `<span class="ew-u">${esc(unit)}</span></div>`;
}

// ---------------------------------------------------------------------------------------
// TRANSFORM. "Transform" is the on-screen word — never "transport", which is the bar
// (room_as_home §7.1 ruling 1).
// ---------------------------------------------------------------------------------------
const FIELDS = [['x', 'X', '%'], ['y', 'Y', '%'], ['scale', 'Scale', '%'], ['rot', 'Rotation', '°'], ['layer', 'Layer', '']];

export function mountTransformWindow(host, model, { onClose } = {}) {
  return mountWindow(host, model, {
    kind: 'transform',
    title: 'Transform',
    subtitle: () => { const it = model.selected(); return it ? `${it.name}${it.locked ? ' · locked' : ''}` : ''; },
    body(uidp) {
      const it = model.selected();
      if (!it) return '<p class="ew-note">Nothing is selected. Choose something in the Layers window, or point at it.</p>';
      // Row 2.38: a room's own object keeps the place the room gives it.
      if (it.fixed) return '<p class="ew-note">This is part of the room, so it keeps the place the room gives it. What it opens is set in the Opens and shows window.</p>';
      const s = model.snap();
      const dis = it.locked;
      const rows = FIELDS.map(([k, label, unit]) => {
        const st = stepSize(k, s.fine, model.config());
        return numberRow(uidp, k, label, it[k], unit, {
          disabled: dis, stepKey: `step:${k}`, inputKey: `input:${k}`,
          less: `${label} down ${st}${unit}`, more: `${label} up ${st}${unit}`,
        });
      }).join('');
      return (dis ? '<p class="ew-note">Locked. Unlock it in the Layers window to change it.</p>' : '')
        + rows
        + `<div class="ew-tgs">${toggle('toggle:fine', 'Fine steps', s.fine)}</div>`
        + seg('Place', PLACES.map((p) => btn(`place:${p}`, PLACE_LABELS[p], { pressed: it.place === p, disabled: dis })))
        + (it.place === 'scene'
          ? seg('Surface', SURFACES.map((p) => btn(`surface:${p}`, SURFACE_LABELS[p], { pressed: it.surface === p, disabled: dis })))
          : '');
    },
    onAction(k) {
      const [a, b, c] = k.split(':');
      if (a === 'step') model.step(b, Number(c));
      else if (a === 'toggle') model.toggleSnap(b);
      else if (a === 'place') model.setPlace(b);
      else if (a === 'surface') model.setSurface(b);
    },
    onCommit(k, value) {
      const [a, b] = k.split(':');
      return a === 'input' && TRANSFORM_KEYS.includes(b) ? model.set(b, value, { via: 'type' }) : false;
    },
    onClose,
  });
}

// ---------------------------------------------------------------------------------------
// SNAP
// ---------------------------------------------------------------------------------------
const SNAP_TOGGLES = [['snapGrid', 'Snap to grid'], ['showGrid', 'Show grid'], ['snapCenter', 'Snap to centre'], ['fine', 'Fine steps']];

export function mountSnapWindow(host, model, { onClose } = {}) {
  return mountWindow(host, model, {
    kind: 'snap',
    title: 'Snap',
    body() {
      const s = model.snap();
      return `<div class="ew-tgs">${SNAP_TOGGLES.map(([k, l]) => toggle(`toggle:${k}`, l, s[k])).join('')}</div>`
        + seg('Grid size', model.config().gridSizes.map((g) => btn(`grid:${g}`, `Grid ${g}%`, { pressed: s.gridSize === g })))
        + '<p class="ew-note">Fine steps ignores the grid, so small moves are always possible.</p>';
    },
    onAction(k) {
      const [a, b] = k.split(':');
      if (a === 'toggle') model.toggleSnap(b);
      else if (a === 'grid') model.setSnap({ gridSize: Number(b) });
    },
    onClose,
  });
}

// ---------------------------------------------------------------------------------------
// LAYERS — top first. Selecting a row selects the thing, so nothing needs a click on the
// canvas. The edit actions are buttons here as well as hotkeys, because a hotkey is not
// something a switch can press.
// ---------------------------------------------------------------------------------------
const ACTIONS = [['undo', 'Undo'], ['redo', 'Redo'], ['duplicate', 'Duplicate'], ['copy', 'Copy'], ['paste', 'Paste'], ['remove', 'Delete']];

// `onShownToggle(id, shown)`: called after a PRESS on a row's Shown/Hidden button changed it - the one
// place a hide is unmistakably somebody's own action, which is what the "mute it while hidden?"
// question (hide_sound.js) waits for. Not called for undo/redo or for a change made through the model
// directly: those are not a person pressing Hidden.
// `onAutomation()` / `automationOpen()` (row 2.41): when the host can run automation it gets an
// "Automation…" button here, below the edit actions -- Layers is the list of what is on the screen, and
// the thing chosen in it is the one the Automation window opens on. Absent: no button.
export function mountLayersWindow(host, model, { onClose, onShownToggle, onAutomation = null, automationOpen = () => false } = {}) {
  const afterColon = (k) => k.slice(k.indexOf(':') + 1);
  let w = null;
  w = mountWindow(host, model, {
    kind: 'layers',
    title: 'Layers',
    subtitle: () => 'top first',
    body() {
      const sel = model.selectedId();
      const rows = model.order().map((id) => {
        const it = model.item(id);
        const on = id === sel;
        return `<div class="ew-ly${on ? ' is-sel' : ''}">`
          + btn(`pick:${id}`, `${it.layer} · ${it.name}`, { pressed: on, cls: 'ew-pick', aria: `${it.name}, layer ${it.layer}${it.shown ? '' : ', hidden'}${it.locked ? ', locked' : ''}` })
          + btn(`up:${id}`, '▲', { aria: `Move ${it.name} up a layer`, disabled: !model.canMoveLayer(id, 1) })
          + btn(`down:${id}`, '▼', { aria: `Move ${it.name} down a layer`, disabled: !model.canMoveLayer(id, -1) })
          + btn(`shown:${id}`, it.shown ? 'Shown' : 'Hidden', { pressed: it.shown, aria: `${it.name}: ${it.shown ? 'shown' : 'hidden'}` })
          + btn(`lock:${id}`, it.locked ? 'Locked' : 'Lock', { pressed: it.locked, aria: `${it.name}: ${it.locked ? 'locked' : 'not locked'}` })
          + '</div>';
      }).join('');
      const it = model.selected();
      const own = !!(it && !it.fixed);          // row 2.38: a room's own object is not copied or deleted here
      const can = { undo: model.canUndo(), redo: model.canRedo(), duplicate: own, copy: own, paste: model.hasClipboard(), remove: !!(own && !it.locked) };
      let autoOpen = false;
      try { autoOpen = !!automationOpen?.(); } catch { autoOpen = false; }
      return (rows || '<p class="ew-note">Nothing here yet.</p>')
        + `<div class="ew-acts" role="group" aria-label="Edit">${ACTIONS.map(([a, l]) => btn(`act:${a}`, l, { disabled: !can[a] })).join('')}</div>`
        + (typeof onAutomation === 'function'
          ? `<div class="ew-acts" role="group" aria-label="More">${btn('more:automation', 'Automation…', {
            pressed: autoOpen, aria: 'Automation: settings driven by something else' })}</div>`
          : '');
    },
    onAction(k) {
      const a = k.slice(0, k.indexOf(':'));
      const id = afterColon(k);
      if (a === 'pick') model.select(id);
      else if (a === 'up') model.moveLayer(id, 1);
      else if (a === 'down') model.moveLayer(id, -1);
      else if (a === 'shown') {
        if (model.toggleShown(id)) {
          try { onShownToggle?.(id, !!model.item(id)?.shown); } catch (err) { console.error('edit_windows: onShownToggle', err); }
        }
      }
      else if (a === 'lock') model.toggleLocked(id);
      else if (a === 'act' && ACTIONS.some(([x]) => x === id)) model[id]();
      else if (a === 'more' && id === 'automation' && typeof onAutomation === 'function') {
        try { onAutomation(); } catch (err) { console.error('edit_windows: automation', err); }
        w?.render();
      }
    },
    onClose,
  });
  return w;
}

// ---------------------------------------------------------------------------------------
// ROW 2.41: AUTOMATION -- "settings driven by something else" (automation.js), in the same shell as
// every other window: solid, non-modal, Close first, Escape closes. Its inside is automation_panel.js:
// a form of native controls, so a keyboard and a pointer reach all of it.
//
// *** AND A SWITCH (2026-10-04). *** Until today the walk's only stop here was Close. Now the walk is
// Close, then the panel's own stops (automation_panel.js `scan`, argued there): its fields as ROWS when
// the person's "How you choose things" is step through, or one stop at a time when it is point and click
// (`chooseMode`, a value or a getter the host passes; absent: point). While a row is entered or the choice
// picker is open the window HOLDS the walk (`holds()`), so a group (`createWindowGroup`) hands it next and
// prev instead of moving to the next window. `back()` comes out a level: out of the picker or the row, and
// from the top it closes THIS window (the picker's rule: back from the rows is leave) -- and says it used
// the press (true), so the host does not also end the editing.
//
// It adds and removes BINDINGS through the engine and writes nothing itself: saving is the engine's
// `onChange`, i.e. whatever the host that built the engine already does (the kiosk: the screen's
// `automations` setting). So whoever could save a binding before this window existed can save one
// here, and nobody else.
//
// opts:
//   engine      the screen's createAutomation() (required)
//   panels()    [{ id, title, manifest, instance? }] what is on the screen, read on every repaint
//   selected    the panel id to open on (or a getter): the thing chosen in Layers
//   verbs       extra verb ids to suggest
//   topics      message names to offer for "a message" (a value or a getter)
//   chooseMode  the person's "How you choose things" ('point' | 'step', or a getter)
// ---------------------------------------------------------------------------------------
export function mountAutomationWindow(host, {
  engine, panels = () => [], selected = null, verbs = [], topics = [], chooseMode = 'point', onClose,
} = {}) {
  if (!engine) throw new Error('edit_windows: the Automation window needs the screen\'s automation engine');
  // A model of one, as the Map's: the shell draws once, and the panel keeps its own form after that
  // (a redraw would throw away what somebody is halfway through typing).
  const shell = { subscribe() { return () => {}; } };
  let panel = null;
  const w = mountWindow(host, shell, {
    kind: 'automation',
    title: 'Automation',
    subtitle: () => 'settings driven by something else',
    body: () => '<div class="ew-auto" data-ew-auto></div>',
    afterRender(el) {
      try { panel?.destroy(); } catch { /* gone */ }
      panel = mountAutomationPanel(el.querySelector('[data-ew-auto]'), { engine, panels, selected, verbs, topics, chooseMode });
    },
    onClose,
  });
  // (The panel holds no subscription or timer of its own -- it reads the engine when it paints -- so the
  // window's own destroy, which removes its element, is all the teardown it needs.)
  Object.defineProperty(w, 'panel', { get: () => panel, enumerable: true });
  // ---- the walk: Close, then the panel's own stops (see above) ----
  let atClose = false;
  const closeBtn = () => w.el.querySelector('[data-ew="close"]');
  const paintClose = () => { closeBtn()?.classList.toggle('is-scan', atClose && w.isOpen()); };
  w.scanTargets = () => (w.isOpen() ? [closeBtn(), ...(panel?.scan.stops() || [])].filter(Boolean) : []);
  w.current = () => {
    if (!w.isOpen()) return null;
    if (atClose) return closeBtn();
    return panel?.scan.current() || null;
  };
  w.focusTarget = (n) => {
    if (!w.isOpen() || !n) return null;
    if (n === closeBtn()) { atClose = true; panel?.scan.light(null); }
    else if (panel?.scan.light(n)) atClose = false;
    else return null;
    paintClose();
    return w.current();
  };
  w.blur = () => { atClose = false; try { panel?.scan.light(null); } catch { /* gone */ } paintClose(); };
  w.holds = () => w.isOpen() && !atClose && !!panel?.scan.holds();
  w.focusStep = (d) => {
    if (w.holds()) { panel.scan.step(d); return w.current(); }
    const list = w.scanTargets();
    if (!list.length) return null;
    const at = list.indexOf(w.current());
    const n = at < 0 ? (d > 0 ? 0 : list.length - 1) : (at + Math.sign(d || 1) + list.length) % list.length;
    return w.focusTarget(list[n]);
  };
  w.select = () => {
    // Holding (the picker just opened, nothing in it lit yet): the press is the panel's, lit or not.
    if (w.holds()) { panel.scan.select(); return true; }
    if (!w.current()) return false;
    if (atClose) { w.close(); return true; }
    panel?.scan.select();
    return true;
  };
  w.back = () => {
    if (!w.isOpen()) return false;
    if (w.holds()) { panel.scan.back(); return true; }
    w.close();
    return true;
  };
  /** 'rows' or 'one': the walk the person's "How you choose things" gives. */
  w.scanMode = () => panel?.scan.mode() || 'one';
  /** Re-read the panels and the bindings (something was added to the screen meanwhile). */
  w.refresh = () => { try { panel?.refresh(); } catch (err) { console.error('edit_windows: automation refresh', err); } };
  return w;
}

// ---------------------------------------------------------------------------------------
// TEXT EFFECTS — for anything with text. The contrast line is measured with every effect off
// (edit_model.js `measureText` says why), and every warning is a warning: nothing is refused.
// ---------------------------------------------------------------------------------------
const FX_LABELS = { outline: 'Outline', glow: 'Glow', bevel: 'Bevel', emboss: 'Emboss' };
const FX_AMOUNT_WORD = { outline: 'width', glow: 'size', bevel: 'depth', emboss: 'depth' };

export function mountTextEffectsWindow(host, model, { onClose } = {}) {
  return mountWindow(host, model, {
    kind: 'fx',
    title: 'Text effects',
    subtitle: () => { const it = model.selected(); return it && hasText(it) ? it.name : ''; },
    body(uidp) {
      const it = model.selected();
      if (!it || !hasText(it)) {
        return '<p class="ew-note">Select something with text, such as a name sign, to add an outline, glow, bevel or emboss.</p>';
      }
      const fx = normalizeFx(it.fx);
      const dis = it.locked;
      const rows = EFFECTS.map((k) => {
        const L = FX_LABELS[k];
        return `<div class="ew-fxrow">${toggle(`fx:${k}`, L, fx[k].on, dis)}`
          + numberRow(uidp, k, '', fx[k][EFFECT_AMOUNT[k]], 'px', {
            disabled: dis, stepKey: `fxstep:${k}`, inputKey: `fxinput:${k}`,
            less: `${L} less`, more: `${L} more`, inputLabel: `${L} ${FX_AMOUNT_WORD[k]}, pixels`,
          })
          + '</div>';
      }).join('');
      const m = model.measure();
      const line = m && m.ratio !== null
        ? `<p class="ew-note">Contrast <b data-ew-ratio>${m.ratio.toFixed(1)}:1</b>, measured with every effect off, so switching one off can't make this text harder to read.</p>`
        : '<p class="ew-note">Contrast is measured with every effect off. There is no text colour and background to measure yet.</p>';
      const warns = (m?.warnings || []).map((w) => `<p class="ew-warn" role="status" data-ew-warn="${esc(w.code)}"><b>Warning:</b> ${esc(w.text)}</p>`).join('');
      return (dis ? '<p class="ew-note">Locked. Unlock it in the Layers window to change it.</p>' : '') + rows + line + warns;
    },
    onAction(k) {
      const [a, b, c] = k.split(':');
      if (a === 'fx') model.toggleEffect(b);
      else if (a === 'fxstep') model.stepEffect(b, Number(c));
    },
    onCommit(k, value) {
      const [a, b] = k.split(':');
      return a === 'fxinput' && EFFECTS.includes(b) ? model.setEffect(b, value) : false;
    },
    onClose,
  });
}

// ---------------------------------------------------------------------------------------
// ROW 2.38: OPENS AND SHOWS -- "where does pressing this go, and what does this frame show".
//
// Design has not drawn this window; it follows the windows Design did draw (solid, Close first, nothing
// needs a drag) and Design's edit bar ("Change: <thing>: previous / next thing"). For the selected thing:
//
//   Thing      ◀ Previous / Next ▶ -- every thing, the room's own objects included, so a switch can
//              reach an object that is not in the Layers list (a room's desk has no layer)
//   Opens: X   pressed, it unfolds the choices: Nothing, each of the person's dashboards, + New dashboard;
//              picking one folds it again. Folded by default, so the walk is ~8 stops, not 2 per dashboard.
//   Shows: X   the same, only for a frame / TV / billboard (a placed Dashboard module: `canShow`)
//   Undo, Redo, and Map (the map of every dashboard, when the host offers it)
//
// Every change is ONE `setLink` on the model: Undo puts the old link back, and the host applies it in
// place (a door appears or goes; a frame swaps what it draws) exactly as it applies a move.
//
// opts:
//   dashboards()   [{ id, name }] the person's dashboards, or null while they load
//   refresh()      a Promise that (re)loads them; the window redraws when it settles
//   current        this dashboard's id (or a getter): marked "(this one)" in the choices
//   onNew(key)     makes a new dashboard; resolves { id, name } (or null). Absent: "+ New" is disabled.
//   onMap()        opens or closes the Map window; `mapOpen()` says which
// ---------------------------------------------------------------------------------------
const LINK_WORD = { opens: 'Opens', shows: 'Shows' };
export function mountLinksWindow(host, model, { dashboards = () => [], refresh = null, current = null, onNew = null,
  onMap = null, mapOpen = () => false, onClose } = {}) {
  ensureMapStyles(host?.ownerDocument || document);
  let open = null;                 // which choice list is unfolded: 'opens' | 'shows' | null
  let making = null;               // the link a new dashboard is being made for
  let note = '';                   // one sentence: a make that failed
  let lastSel = model.selectedId();
  const cur = () => (typeof current === 'function' ? current() : current);
  const list = () => { try { return dashboards() || null; } catch { return null; } };
  const nameOf = (id) => {
    if (!id) return 'nothing';
    const d = (list() || []).find((x) => x && x.id === id);
    return d ? (d.name || 'Dashboard') : 'a dashboard that is gone';
  };
  let w = null;
  const redraw = () => { if (w && w.isOpen()) w.render(); };
  function choices(it, key) {
    const ds = list();
    const on = it[key] ?? null;
    const rows = [btn(`pick:${key}:`, 'Nothing', { pressed: !on, cls: 'ew-choice' })];
    if (!ds) rows.push('<p class="ew-note">Finding your dashboards…</p>');
    else {
      for (const d of ds) {
        if (!d || !d.id) continue;
        const label = `${d.name || 'Dashboard'}${d.id === cur() ? ' (this one)' : ''}`;
        rows.push(btn(`pick:${key}:${d.id}`, label, { pressed: on === d.id, cls: 'ew-choice' }));
      }
    }
    rows.push(btn(`new:${key}`, making === key ? 'Making a new dashboard…' : '+ New dashboard',
      { disabled: !onNew || !!making, cls: 'ew-choice ew-new' }));
    return `<div class="ew-choices" role="group" aria-label="${esc(LINK_WORD[key])}: choose a dashboard">${rows.join('')}</div>`;
  }
  function linkRow(it, key) {
    const can = model.canLink(key);
    const on = it[key] ?? null;
    const head = btn(`menu:${key}`, `${LINK_WORD[key]}: ${nameOf(on)}`, { disabled: !can, cls: 'ew-linkhead' })
      .replace('<button ', `<button aria-expanded="${open === key ? 'true' : 'false'}" `);
    const gone = on && list() && !list().some((d) => d && d.id === on);
    return `<div class="ew-link">${head}${open === key && can ? choices(it, key) : ''}`
      + (gone ? `<p class="ew-warn" role="status" data-ew-warn="gone-${key}"><b>Warning:</b> ${key === 'opens'
        ? 'it opens a dashboard that is not in your list any more, so pressing it does nothing.'
        : 'it shows a dashboard that is not in your list any more, so it shows a card saying so.'}</p>` : '')
      + '</div>';
  }
  function says(it) {
    if (it.opens) return `Pressing it goes to ${nameOf(it.opens)}${it.canShow && it.shows ? ', not to what it shows' : ''}.`;
    if (it.canShow && it.shows) return `It shows ${nameOf(it.shows)}, and pressing it goes there.`;
    if (it.fixed) return 'Pressing it does what the room gives it to do.';
    return 'Pressing it does what this module always does.';
  }
  w = mountWindow(host, model, {
    kind: 'links',
    title: 'Opens and shows',
    subtitle: () => { const it = model.selected(); return it ? it.name : ''; },
    body() {
      const it = model.selected();
      if (model.selectedId() !== lastSel) { lastSel = model.selectedId(); open = null; }
      const n = model.things().length;
      const thing = seg('Thing', [btn('thing:-1', '◀ Previous', { aria: 'Previous thing', disabled: n < 2 }),
        btn('thing:1', 'Next ▶', { aria: 'Next thing', disabled: n < 2 })]);
      const acts = `<div class="ew-acts" role="group" aria-label="Edit">${btn('act:undo', 'Undo', { disabled: !model.canUndo() })}`
        + btn('act:redo', 'Redo', { disabled: !model.canRedo() })
        + (onMap ? btn('act:map', mapOpen() ? 'Hide the map' : 'Map', { pressed: !!mapOpen() }) : '') + '</div>';
      if (!it) return `${thing}<p class="ew-note">Nothing is selected. Choose a thing with Previous and Next.</p>${acts}`;
      return thing
        + `<p class="ew-thing">Changing: <b>${esc(it.name)}</b>${it.fixed ? ' <span class="ew-note">(part of the room)</span>' : ''}</p>`
        + (it.locked ? '<p class="ew-note">Locked. Unlock it in the Layers window to change it.</p>' : '')
        + linkRow(it, 'opens')
        + (it.canShow ? linkRow(it, 'shows') : '')
        + `<p class="ew-note" data-ew-says>${esc(says(it))}</p>`
        + (note ? `<p class="ew-warn" role="status">${esc(note)}</p>` : '')
        + acts;
    },
    onAction(k) {
      const [a, b] = k.split(':');
      const rest = k.split(':').slice(2).join(':');
      if (a === 'thing') { open = null; model.selectStep(Number(b)); redraw(); }
      else if (a === 'menu') { open = open === b ? null : b; note = ''; redraw(); }
      else if (a === 'pick') { open = null; if (!model.setLink(b, rest || null)) redraw(); }
      else if (a === 'new' && onNew && !making) {
        making = b; note = ''; redraw();
        const id = model.selectedId();
        Promise.resolve().then(() => onNew(b)).then((d) => {
          making = null; open = null;
          if (d && d.id) model.setLink(b, d.id, { id });
          else note = 'A new dashboard could not be made just now. Nothing changed.';
          redraw();
        }).catch(() => { making = null; note = 'A new dashboard could not be made just now. Nothing changed.'; redraw(); });
      }
      else if (a === 'act' && b === 'undo') model.undo();
      else if (a === 'act' && b === 'redo') model.redo();
      else if (a === 'act' && b === 'map') { try { onMap?.(); } catch (err) { console.error('edit_windows: map', err); } redraw(); }
    },
    onClose,
  });
  if (typeof refresh === 'function') {
    Promise.resolve().then(() => refresh()).then(redraw, redraw);
  }
  return w;
}

// ---------------------------------------------------------------------------------------
// ROW 2.38: THE MAP -- every dashboard a box, every door a solid arrow, every frame a dashed one,
// cycles included (dashboard_map.js draws it). The SAME graph is a list underneath: one button per
// dashboard, with a sentence saying what it opens, shows and is reached from. The list is what a screen
// reader reads and what the switch walks (the picture is `aria-hidden`); the scan cursor on a list
// button also outlines that dashboard's box in the picture. Pressing a dashboard -- its button or its
// box -- goes there (`onGo(id)`). Where you are, and a dashboard that is gone, are not pressable.
//
// opts:
//   load()     resolves `{ graph }` (dashboard_map.js `loadMapData`); called at mount and by `reload()`
//   current    the dashboard showing now (or a getter)
//   onGo(id)   go there (the host publishes `dashboard/go`)
//   drawMax    above this many dashboards, the list alone (MAP_DEFAULTS.drawMax)
// ---------------------------------------------------------------------------------------
export function mountMapWindow(host, { load, current = null, onGo, onClose, drawMax = MAP_DEFAULTS.drawMax } = {}) {
  ensureMapStyles(host?.ownerDocument || document);
  const subs = new Set();
  // A model of one: the shell redraws on its events. `refresh` is how the loaded graph reaches it.
  const shell = { subscribe(fn) { subs.add(fn); return () => subs.delete(fn); } };
  const changed = () => { for (const fn of [...subs]) { try { fn({ type: 'map' }); } catch { /* not load-bearing */ } } };
  const cur = () => (typeof current === 'function' ? current() : current);
  let state = { status: 'loading', graph: null };
  const w = mountWindow(host, shell, {
    kind: 'map',
    title: 'Map',
    subtitle: () => (state.graph ? `${state.graph.nodes.length} dashboard${state.graph.nodes.length === 1 ? '' : 's'}` : ''),
    body() {
      if (state.status === 'loading') return '<p class="ew-note">Drawing the map of your dashboards…</p>';
      if (state.status === 'error' || !state.graph) return '<p class="ew-warn" role="status">The map could not be drawn just now. Nothing changed.</p>';
      const g = state.graph;
      if (!g.nodes.length) return '<p class="ew-note">There are no dashboards to map yet.</p>';
      const here = cur();
      const rows = mapListForm(g, { current: here }).map((e) => `<li class="ew-maprow${e.here ? ' is-here' : ''}${e.missing ? ' is-missing' : ''}">`
        + btn(`go:${e.id}`, e.here ? `${e.name} (you are here)` : e.missing ? `${e.name}` : e.name,
          { disabled: e.here || e.missing, aria: e.here ? `${e.name}, you are here` : `Go to ${e.name}`, cls: 'ew-mapgo' })
        + `<span class="ew-mapsay">${esc(e.sentence)}</span></li>`).join('');
      const picture = g.nodes.length <= drawMax
        ? `<div class="ew-mappic">${mapSvg(g, { current: here })}</div>`
          + '<p class="ew-note ew-legend">A solid arrow: pressing it goes there. A dashed arrow: it is shown inside.</p>'
        : `<p class="ew-note">${g.nodes.length} dashboards are too many to draw clearly, so here they are as a list.</p>`;
      return `${picture}<ol class="ew-maplist" aria-label="Your dashboards, as a list">${rows}</ol>`;
    },
    onAction(k) {
      const i = k.indexOf(':');
      if (k.slice(0, i) === 'go') { try { onGo?.(k.slice(i + 1)); } catch (err) { console.error('edit_windows: map go', err); } }
    },
    // The cursor on a list button outlines that dashboard's box too.
    onPaint(n, el) {
      el.querySelectorAll('[data-map-node].is-scan').forEach((g) => g.classList.remove('is-scan'));
      const id = n && n.dataset.ew && n.dataset.ew.startsWith('go:') ? n.dataset.ew.slice(3) : null;
      if (id) el.querySelector(`[data-map-node="${CSS.escape(id)}"]`)?.classList.add('is-scan');
    },
    onClose,
  });
  // Pressing a box in the picture is pressing its button (the pointer's way; the list is the switch's).
  w.el.addEventListener('click', (e) => {
    const g = e.target.closest?.('[data-map-node]');
    if (!g || !w.el.contains(g)) return;
    const b = w.el.querySelector(`button[data-ew="go:${CSS.escape(g.dataset.mapNode)}"]`);
    if (b && !b.disabled) b.click();
  });
  async function reload() {
    state = { status: 'loading', graph: state.graph };
    changed();
    try {
      const got = await load();
      state = { status: 'ready', graph: got && got.graph ? got.graph : null };
    } catch (err) {
      console.error('edit_windows: map load', err);
      state = { status: 'error', graph: null };
    }
    if (w.isOpen()) changed();
    return state;
  }
  const ready = reload();
  return { ...w, reload, ready, graph: () => state.graph, status: () => state.status };
}
