// automation_panel.js — THE SMALLEST EDITOR FOR automation.js: list what is driven, add, remove.
//
// Standalone on purpose: a self-contained panel any page can mount (`mountAutomationPanel(el, {...})`).
// The edit view reaches it as one of its windows (2026-10-02): edit_windows.js `mountAutomationWindow`
// puts it in the same solid, Close-first shell, and dashboard_editor.js offers it as "Automation…" in
// the Layers window whenever its host hands it the screen's engine.
//
// WHO IT IS FOR: the person SETTING UP a screen (a puzzle's author, a caregiver), with a keyboard
// and a pointer. `settings_fields.js` draws that line itself: the one-switch rule binds what the
// person at the screen uses, not the admin tools somebody drives on a laptop. Every control is a
// native form control, so a keyboard reaches all of it; no switch walk is promised.
//
// Nothing here writes a setting. It adds and removes BINDINGS through the engine, and the engine's
// `onChange` is where the host saves them.

import { SOURCE_KINDS, CURVES, QUIET, LFO_SHAPES, AUTOMATION_DEFAULTS, bindableSettings } from './automation.js';
import { VERBS, MEDIA_VERBS } from './actions.js';

const KIND_LABELS = {
  bus: 'a message (a sensor, a game, a score)',
  link: 'another panel’s output',
  verb: 'a switch or key (a verb)',
  clock: 'the time of day',
  lfo: 'a slow wave',
};
const CURVE_LABELS = {
  linear: 'straight', 'ease-in': 'slow then fast', 'ease-out': 'fast then slow',
  steps: 'in steps', peak: 'only when it is right (hidden writing)',
};
const QUIET_LABELS = { hold: 'stay where it was', release: 'go back to its own setting' };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) e.dataset[dk] = dv;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids) if (k) e.append(k);
  return e;
}
const field = (label, control) => el('label', { class: 'auto-field' }, el('span', { text: label }), control);
function select(name, options, value = null) {
  const s = el('select', { name, data: { a: name } });
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label, disabled: o.disabled ? true : null });
    if (value !== null && String(o.value) === String(value)) opt.selected = true;
    s.append(opt);
  }
  return s;
}
const numInput = (name, value, step = 'any') => el('input', { type: 'number', name, step, value, data: { a: name } });
const textInput = (name, value = '', list = null) => el('input', { type: 'text', name, value, list, data: { a: name } });

/** Describe a binding in one line, for the list. */
export function describeBinding(b, { panelTitle = null, settingLabel = null } = {}) {
  const s = b.source || {};
  const from = s.kind === 'bus' ? `“${s.topic}”`
    : s.kind === 'link' ? `${s.instance} → ${s.port}`
    : s.kind === 'verb' ? `the ${s.up} verb${s.down ? ` (and ${s.down} back)` : ''}`
    : s.kind === 'clock' ? 'the time of day'
    : s.kind === 'lfo' ? `a ${s.shape} wave every ${Math.round((s.periodMs || 0) / 100) / 10} s`
    : 'nothing';
  const curve = b.map?.curve && b.map.curve !== 'linear' ? `, ${CURVE_LABELS[b.map.curve] || b.map.curve}` : '';
  return `${panelTitle || b.target.instance}: ${settingLabel || b.target.key} ← ${from}${curve}`;
}

/**
 * Mount the editor.
 *   engine   the createAutomation() of this screen
 *   panels   () => [{ id, title, manifest, instance? }] - the panels on this screen, read on every
 *            repaint so a panel added since is offered
 *   verbs    extra verb ids to suggest (a screen's custom verbs)
 *   selected the panel id to start on (or a getter): the edit view passes the thing chosen in
 *            Layers, so "Automation…" pressed with the sign chosen opens on the sign
 */
export function mountAutomationPanel(root, { engine, panels = () => [], verbs = [], selected = null } = {}) {
  if (!root || !engine) throw new Error('mountAutomationPanel: a root element and an engine are required');
  const verbIds = [...new Set([...VERBS, ...MEDIA_VERBS].map((v) => v.id).concat(verbs || []))];
  const listId = `auto-verbs-${Math.random().toString(36).slice(2, 8)}`;

  root.innerHTML = '';
  const wrap = el('div', { class: 'auto-panel', data: { automationPanel: '' } });
  const listEl = el('ul', { class: 'auto-list', data: { list: '' } });
  const form = el('form', { class: 'auto-add', data: { add: '' } });
  const statusEl = el('p', { class: 'auto-status', role: 'status', data: { status: '' } });
  const datalist = el('datalist', { id: listId });
  verbIds.forEach((id) => datalist.append(el('option', { value: id })));
  wrap.append(el('h3', { text: 'Settings driven by something else' }), listEl, form, datalist);
  root.append(wrap);

  const say = (t) => { statusEl.textContent = t || ''; };
  const allPanels = () => { try { return panels() || []; } catch { return []; } };
  const panelById = (id) => allPanels().find((p) => p.id === id) || null;
  const settingsOf = (p) => (p ? bindableSettings(p.manifest, p.instance || null) : []);

  // ---- the list ----
  function paintList() {
    listEl.innerHTML = '';
    const list = engine.list();
    if (!list.length) { listEl.append(el('li', { class: 'auto-empty', text: 'Nothing is driven yet.' })); return; }
    for (const b of list) {
      const p = panelById(b.target.instance);
      const s = settingsOf(p).find((x) => x.key === b.target.key);
      const state = engine.status(b.id);
      const rm = el('button', { type: 'button', data: { remove: b.id }, text: 'Remove' });
      rm.addEventListener('click', () => {
        engine.remove(b.id);
        say('Removed. The setting is back to its own value.');
        paintList();
      });
      listEl.append(el('li', { data: { binding: b.id } },
        el('span', { text: describeBinding(b, { panelTitle: p?.title, settingLabel: s?.label }) }),
        state && state !== 'running' ? el('em', { text: ` (${state})` }) : null,
        document.createTextNode(' '), rm));
    }
  }

  // ---- the form ----
  let panelSel, keySel, kindSel, srcBox, outMin, outMax, curveSel, peakBox, quietSel;
  function paintForm() {
    form.innerHTML = '';
    const ps = allPanels();
    panelSel = select('panel', ps.length ? ps.map((p) => ({ value: p.id, label: p.title || p.id }))
      : [{ value: '', label: 'No panels on this screen', disabled: true }]);
    keySel = select('key', []);
    kindSel = select('kind', SOURCE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] })), 'bus');
    srcBox = el('span', { class: 'auto-src', data: { src: '' } });
    outMin = numInput('outMin', '');
    outMax = numInput('outMax', '');
    curveSel = select('curve', CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] })), 'linear');
    peakBox = el('span', { class: 'auto-peak', data: { peak: '' } },
      field('Right at (0 to 1)', numInput('center', AUTOMATION_DEFAULTS.peakCenter, '0.01')),
      field('Give or take', numInput('width', AUTOMATION_DEFAULTS.peakWidth, '0.01')));
    quietSel = select('whenQuiet', QUIET.map((q) => ({ value: q, label: QUIET_LABELS[q] })), AUTOMATION_DEFAULTS.whenQuiet);
    const add = el('button', { type: 'submit', data: { addButton: '' }, text: 'Add' });
    form.append(
      field('Panel', panelSel), field('Setting', keySel), field('Driven by', kindSel), srcBox,
      field('From', outMin), field('To', outMax), field('Shape', curveSel), peakBox,
      field('When it goes quiet', quietSel), add, statusEl);
    panelSel.addEventListener('change', paintKeys);
    keySel.addEventListener('change', paintRange);
    kindSel.addEventListener('change', paintSource);
    curveSel.addEventListener('change', () => { peakBox.hidden = curveSel.value !== 'peak'; });
    peakBox.hidden = true;
    let want = null;
    try { want = typeof selected === 'function' ? selected() : selected; } catch { want = null; }
    if (want && ps.some((p) => p.id === want)) panelSel.value = want;
    paintKeys();
    paintSource();
  }

  function paintKeys() {
    const rows = settingsOf(panelById(panelSel.value));
    keySel.innerHTML = '';
    // EVERY setting is listed; the ones that cannot be driven are disabled WITH THE REASON, never
    // left out - "present, disabled, with a reason, never absent" (settings_fields.js).
    for (const r of rows) {
      keySel.append(el('option', { value: r.key, disabled: r.ok ? null : true,
        text: r.ok ? r.label : `${r.label} — ${r.why}` }));
    }
    const first = rows.find((r) => r.ok);
    if (first) keySel.value = first.key;
    if (!rows.length) keySel.append(el('option', { value: '', disabled: true, text: 'This panel has no settings' }));
    else if (!first) say('Nothing on this panel can be driven: only settings that are numbers can.');
    paintRange();
  }
  function paintRange() {
    const r = settingsOf(panelById(panelSel.value)).find((x) => x.key === keySel.value && x.ok);
    outMin.value = r ? r.min : '';
    outMax.value = r ? r.max : '';
    if (r) { outMin.min = outMax.min = r.min; outMin.max = outMax.max = r.max; }
  }
  function paintSource() {
    srcBox.innerHTML = '';
    const k = kindSel.value;
    if (k === 'bus') {
      srcBox.append(field('Message name', textInput('topic', '')),
        field('Its lowest', numInput('inMin', AUTOMATION_DEFAULTS.inputRange[0])),
        field('Its highest', numInput('inMax', AUTOMATION_DEFAULTS.inputRange[1])));
    } else if (k === 'link') {
      srcBox.append(field('Panel id', textInput('instance', '')), field('Its output', textInput('port', '')));
    } else if (k === 'verb') {
      srcBox.append(field('Up with', textInput('up', 'up', listId)),
        field('Down with (optional)', textInput('down', '', listId)),
        field('One press moves (0 to 1)', numInput('step', AUTOMATION_DEFAULTS.verbStep, '0.01')));
    } else if (k === 'lfo') {
      srcBox.append(field('Once every (seconds)', numInput('periodS', AUTOMATION_DEFAULTS.lfoPeriodMs / 1000, '0.5')),
        field('Wave', select('shape', LFO_SHAPES.map((s) => ({ value: s, label: s })), AUTOMATION_DEFAULTS.lfoShape)));
    } else if (k === 'clock') {
      srcBox.append(el('span', { class: 'auto-note', text: 'Low at night, high by day.' }));
    }
  }

  function readForm() {
    const v = (name) => form.querySelector(`[data-a="${name}"]`)?.value ?? '';
    const n = (name) => { const s = v(name); return s === '' ? undefined : Number(s); };
    const kind = kindSel.value;
    const source = { kind };
    if (kind === 'bus') Object.assign(source, { topic: v('topic').trim() });
    if (kind === 'link') Object.assign(source, { instance: v('instance').trim(), port: v('port').trim() });
    if (kind === 'verb') Object.assign(source, { up: v('up').trim(), down: v('down').trim() || null, step: n('step') });
    if (kind === 'lfo') Object.assign(source, { periodMs: (n('periodS') || 0) * 1000, shape: v('shape') });
    const map = { outMin: n('outMin'), outMax: n('outMax'), curve: curveSel.value, whenQuiet: quietSel.value };
    if (kind === 'bus') Object.assign(map, { inMin: n('inMin'), inMax: n('inMax') });
    if (curveSel.value === 'peak') Object.assign(map, { center: n('center'), width: n('width') });
    return { target: { instance: panelSel.value, key: keySel.value }, source, map };
  }

  const REASONS = {
    'invalid-binding': 'Something is missing: a panel, a setting, and where the number comes from.',
    'already-bound': 'That setting is already driven. Remove the other one first.',
    'not-bindable': 'That setting cannot be driven.',
    'duplicate-id': 'That one already exists.',
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const res = engine.add(readForm());
    if (res.ok) { say('Added.'); paintList(); }
    else say(`${REASONS[res.reason] || 'Not added.'}${res.why ? ` (${res.why})` : ''}`);
  });

  paintForm();
  paintList();

  return {
    /** Re-read the panels and the bindings (a panel was added, the list was loaded). */
    refresh() { const keep = panelSel?.value; paintForm(); if (keep && panelById(keep)) { panelSel.value = keep; paintKeys(); } paintList(); },
    /** Put the form on one panel (the thing chosen elsewhere). False when it is not on this screen. */
    select(id) { if (!id || !panelById(id)) return false; panelSel.value = id; paintKeys(); return true; },
    /** The form, for a test: fill it the way a person would and submit. */
    form,
    destroy() { root.innerHTML = ''; },
  };
}
