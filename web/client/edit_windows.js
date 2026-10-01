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

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let uid = 0;

// ---------------------------------------------------------------------------------------
// THE SHELL every window shares: header with the title and Close, a body the window draws,
// clicks and typed commits routed to the window, Escape, the switch walk, and destroy.
// ---------------------------------------------------------------------------------------
function mountWindow(host, model, { kind, title, subtitle = () => '', body, onAction, onCommit, onClose }) {
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
    return n;
  }
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
  return { el, render, close, destroy, scanTargets, focusStep, select, current, isOpen: () => !destroyed };
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
export function mountLayersWindow(host, model, { onClose, onShownToggle } = {}) {
  const afterColon = (k) => k.slice(k.indexOf(':') + 1);
  return mountWindow(host, model, {
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
      const can = { undo: model.canUndo(), redo: model.canRedo(), duplicate: !!it, copy: !!it, paste: model.hasClipboard(), remove: !!(it && !it.locked) };
      return (rows || '<p class="ew-note">Nothing here yet.</p>')
        + `<div class="ew-acts" role="group" aria-label="Edit">${ACTIONS.map(([a, l]) => btn(`act:${a}`, l, { disabled: !can[a] })).join('')}</div>`;
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
    },
    onClose,
  });
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
