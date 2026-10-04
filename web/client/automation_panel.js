// automation_panel.js — THE SMALLEST EDITOR FOR automation.js: list what is driven, add, remove.
//
// Standalone on purpose: a self-contained panel any page can mount (`mountAutomationPanel(el, {...})`).
// The edit view reaches it as one of its windows (2026-10-02): edit_windows.js `mountAutomationWindow`
// puts it in the same solid, Close-first shell, and dashboard_editor.js offers it as "Automation…" in
// the Layers window whenever its host hands it the screen's engine.
//
// WHO IT IS FOR: the person SETTING UP a screen (a puzzle's author, a caregiver). Every control is a
// native form control, so a keyboard and a pointer reach all of it, typing included.
//
// *** AND A SWITCH (2026-10-04). *** It used to promise keyboard and pointer only, so "a switch reaches
// only Close" (Mike's list). A person who sets up with a switch is still a person setting up, so the form
// is now WALKED (`panel.scan`), the same way choice_picker.js / picture_picker.js are walked so nobody
// learns two, and the person's own "How you choose things" (settings_fields.js CHOOSE_MODE_FIELD, 6fd7575)
// picks the walk -- the same mapping the bar and the library use (transport_bar.js barScanModeOf):
//   step through -> ROWS: a field lights as a row; select goes INTO it; next / prev walk its things; select
//                   takes one; back comes out; back from the rows is "leave" (the window closes).
//                     a choice   its options appear as buttons, the lit one starting on what it is NOW, so
//                                a stray select changes nothing; select takes the lit one and comes out.
//                     a number   its − and +; select nudges and STAYS in the row (five + is five presses).
//                     Add        one thing in the row, so the select that would have entered it presses it
//                                (choice_picker.js's rule).
//                     the list   its Remove buttons. ALWAYS entered, even with one rule in it -- an exception
//                                to the rule above, argued: a removal is not undoable here, so a press that
//                                only meant "go in" must never be the press that removes.
//   point and click (everybody's default) -> ONE stop at a time: a choice is one stop and a press STEPS it
//                   when it is short, or OPENS THE CHOICE PICKER when it is long -- settings_fields.js
//                   `opensPicker`, the settings menu's own rule, threshold and all; a number's − and + are
//                   stops of their own; Add and each Remove are stops.
// The fields that used to need TYPING get choices instead, wherever there is something to choose from;
// the box stays, for a keyboard:
//   message name   the names given (`topics`) plus the ones this screen's rules already use. With none, it is
//                  not a stop (a switch would land on something it cannot operate) and a keyboard types it.
//   panel / output (another panel's output) the panels that SEND a number (links.js portsFor: an `out` port
//                  of type number), by name; choosing one fills its first number output in.
//   up / down with the verbs (actions.js), down with "none" first.
//
// Nothing here writes a setting. It adds and removes BINDINGS through the engine, and the engine's
// `onChange` is where the host saves them.

import { SOURCE_KINDS, CURVES, QUIET, LFO_SHAPES, AUTOMATION_DEFAULTS, LFO_MIN_PERIOD_MS, bindableSettings } from './automation.js';
import { VERBS, MEDIA_VERBS } from './actions.js';
import { portsFor } from './links.js';
import { opensPicker, chooseModeOf } from './settings_fields.js';
import { mountChoicePicker } from './choice_picker.js';

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

// *** HOW A SWITCH NUDGES A NUMBER -- each a default, and each an option (`steps` on mount; Rule 1). ***
//   across       20   presses from one end of a range to the other: a setting's From / To (its own min..max,
//                     snapped to the setting's own step), a message's lowest / highest (the 0..1 input range),
//                     and the 0..1 fractions (right at, give or take, one press moves). FOR 20: both − and +
//                     are there, so nobody goes round, and a peak's "give or take" (0.1 by default) moves in
//                     halves of itself. AGAINST 10 (a tenth, the verb's own step): one press would take that
//                     width to 0 or double it, too coarse for the hidden-writing curve. AGAINST 100: a hundred
//                     presses end to end is a quarter of an hour at a fifteen-second scan.
//   periodStepS  0.5  seconds per press on "once every" -- the box's own step, from the floor up
//                     (automation.js LFO_MIN_PERIOD_MS: nothing under a second is offered).
export const AUTOMATION_PANEL_DEFAULTS = Object.freeze({ across: 20, periodStepS: 0.5 });

/** The walk a person gets from their "How you choose things": step through -> rows, anything else -> one. */
export function autoScanModeOf(chooseMode) {
  return chooseModeOf(chooseMode) === 'step' ? 'rows' : 'one';
}

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
// Every field is a ROW of the switch walk, named by its control (`data-auto-row` = the control's `data-a`).
const field = (label, control) => el('label', { class: 'auto-field', data: { autoRow: control.dataset.a } },
  el('span', { text: label }), control);
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
let nid = 0;
// A number: its box with − and + beside it ("nothing needs a drag" and nothing needs typing: edit_windows.js).
function numField(label, name, value, step = 'any') {
  const input = numInput(name, value, step);
  input.id = `auto-n-${++nid}`;
  return el('div', { class: 'auto-field auto-numf', data: { autoRow: name } },
    el('label', { for: input.id, text: label }),
    el('div', { class: 'auto-num' },
      el('button', { type: 'button', class: 'auto-nudge', 'aria-label': `Less: ${label}`, data: { autoNudge: `${name}:-1` }, text: '−' }),
      input,
      el('button', { type: 'button', class: 'auto-nudge', 'aria-label': `More: ${label}`, data: { autoNudge: `${name}:1` }, text: '+' })));
}

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

const decimals = (n) => { const s = String(n); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(6, s.length - i - 1); };

/**
 * Mount the editor.
 *   engine     the createAutomation() of this screen
 *   panels     () => [{ id, title, manifest, instance? }] - the panels on this screen, read on every
 *              repaint so a panel added since is offered
 *   verbs      extra verb ids to suggest (a screen's custom verbs)
 *   topics     message names to offer for "a message" (a value or a getter); the ones this screen's rules
 *              already use are always offered too
 *   selected   the panel id to start on (or a getter): the edit view passes the thing chosen in
 *              Layers, so "Automation…" pressed with the sign chosen opens on the sign
 *   chooseMode the person's "How you choose things" ('point' | 'step', or a getter), read at every press
 *   steps      overrides for AUTOMATION_PANEL_DEFAULTS
 */
export function mountAutomationPanel(root, {
  engine, panels = () => [], verbs = [], topics = [], selected = null, chooseMode = 'point', steps = null,
} = {}) {
  if (!root || !engine) throw new Error('mountAutomationPanel: a root element and an engine are required');
  const NUDGE = { ...AUTOMATION_PANEL_DEFAULTS, ...(steps || {}) };
  const verbList = [...VERBS, ...MEDIA_VERBS];
  const verbIds = [...new Set(verbList.map((v) => v.id).concat(verbs || []))];
  const listId = `auto-verbs-${Math.random().toString(36).slice(2, 8)}`;

  root.innerHTML = '';
  const wrap = el('div', { class: 'auto-panel', data: { automationPanel: '' } });
  const listEl = el('ul', { class: 'auto-list', data: { list: '', autoRow: 'list' } });
  const form = el('form', { class: 'auto-add', data: { add: '' } });
  const statusEl = el('p', { class: 'auto-status', role: 'status', data: { status: '' } });
  const datalist = el('datalist', { id: listId });
  const pickHost = el('div', { class: 'auto-pick', data: { autoPick: '' }, hidden: true });
  verbIds.forEach((id) => datalist.append(el('option', { value: id })));
  wrap.append(el('h3', { text: 'Settings driven by something else' }), listEl, form, pickHost, datalist);
  root.append(wrap);

  const say = (t) => { statusEl.textContent = t || ''; };
  const allPanels = () => { try { return panels() || []; } catch { return []; } };
  const panelById = (id) => allPanels().find((p) => p.id === id) || null;
  const settingsOf = (p) => (p ? bindableSettings(p.manifest, p.instance || null) : []);
  const modeNow = () => { try { return autoScanModeOf(typeof chooseMode === 'function' ? chooseMode() : chooseMode); } catch { return 'one'; } };

  // ---- the list ----
  function paintList() {
    listEl.innerHTML = '';
    const list = engine.list();
    if (!list.length) { listEl.append(el('li', { class: 'auto-empty', text: 'Nothing is driven yet.' })); return; }
    for (const b of list) {
      const p = panelById(b.target.instance);
      const s = settingsOf(p).find((x) => x.key === b.target.key);
      const state = engine.status(b.id);
      const what = describeBinding(b, { panelTitle: p?.title, settingLabel: s?.label });
      const rm = el('button', { type: 'button', data: { remove: b.id }, 'aria-label': `Remove: ${what}`, text: 'Remove' });
      rm.addEventListener('click', () => {
        engine.remove(b.id);
        say('Removed. The setting is back to its own value.');
        paintList();
        paint();
      });
      listEl.append(el('li', { data: { binding: b.id } },
        el('span', { text: what }),
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
    const fromF = numField('From', 'outMin', '');
    const toF = numField('To', 'outMax', '');
    outMin = fromF.querySelector('input');
    outMax = toF.querySelector('input');
    curveSel = select('curve', CURVES.map((c) => ({ value: c, label: CURVE_LABELS[c] })), 'linear');
    peakBox = el('span', { class: 'auto-peak', data: { peak: '' } },
      numField('Right at (0 to 1)', 'center', AUTOMATION_DEFAULTS.peakCenter, '0.01'),
      numField('Give or take', 'width', AUTOMATION_DEFAULTS.peakWidth, '0.01'));
    quietSel = select('whenQuiet', QUIET.map((q) => ({ value: q, label: QUIET_LABELS[q] })), AUTOMATION_DEFAULTS.whenQuiet);
    const add = el('button', { type: 'submit', data: { addButton: '', autoRow: 'add' }, text: 'Add' });
    form.append(
      field('Panel', panelSel), field('Setting', keySel), field('Driven by', kindSel), srcBox,
      fromF, toF, field('Shape', curveSel), peakBox,
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
  const settingNow = () => settingsOf(panelById(panelSel.value)).find((x) => x.key === keySel.value && x.ok) || null;
  function paintRange() {
    const r = settingNow();
    outMin.value = r ? r.min : '';
    outMax.value = r ? r.max : '';
    if (r) { outMin.min = outMax.min = r.min; outMin.max = outMax.max = r.max; }
  }
  function paintSource() {
    srcBox.innerHTML = '';
    const k = kindSel.value;
    if (k === 'bus') {
      srcBox.append(field('Message name', textInput('topic', '')),
        numField('Its lowest', 'inMin', AUTOMATION_DEFAULTS.inputRange[0]),
        numField('Its highest', 'inMax', AUTOMATION_DEFAULTS.inputRange[1]));
    } else if (k === 'link') {
      srcBox.append(field('Panel id', textInput('instance', '')), field('Its output', textInput('port', '')));
    } else if (k === 'verb') {
      srcBox.append(field('Up with', textInput('up', 'up', listId)),
        field('Down with (optional)', textInput('down', '', listId)),
        numField('One press moves (0 to 1)', 'step', AUTOMATION_DEFAULTS.verbStep, '0.01'));
    } else if (k === 'lfo') {
      srcBox.append(numField('Once every (seconds)', 'periodS', AUTOMATION_DEFAULTS.lfoPeriodMs / 1000, '0.5'),
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
    paint();
  });

  // =================================================================================================
  // THE SWITCH WALK (see the header). Rows are read from the form as it is drawn now, so a field that
  // appears (a verb's own fields) or goes (the peak's, hidden) is in or out of the walk at once, and the
  // cursor is remembered by the ROW's name, so a redraw underneath it does not lose it.
  // =================================================================================================

  // What a text box can be given instead of typing.
  function textChoices(name) {
    if (name === 'topic') {
      let given = [];
      try { given = (typeof topics === 'function' ? topics() : topics) || []; } catch { given = []; }
      const used = engine.list().filter((b) => b.source?.kind === 'bus' && b.source.topic).map((b) => b.source.topic);
      return [...new Set([...given, ...used].map(String).filter(Boolean))].map((t) => ({ value: t, label: t }));
    }
    if (name === 'instance') {
      return allPanels().filter((p) => sendsNumber(p)).map((p) => ({ value: p.id, label: p.title || p.id }));
    }
    if (name === 'port') {
      const p = panelById(form.querySelector('[data-a="instance"]')?.value || '');
      return numberOutputs(p).map((o) => ({ value: o.id, label: o.label }));
    }
    if (name === 'up' || name === 'down') {
      const opts = verbIds.map((id) => ({ value: id, label: id, hint: verbList.find((v) => v.id === id)?.label || '' }));
      return name === 'down' ? [{ value: '', label: 'none' }, ...opts] : opts;
    }
    return [];
  }
  function numberOutputs(p) {
    try { return p ? portsFor(p.manifest).filter((o) => o.direction === 'out' && o.type === 'number') : []; } catch { return []; }
  }
  const sendsNumber = (p) => numberOutputs(p).length > 0;

  function rowsNow() {
    const rows = [];
    const removes = [...listEl.querySelectorAll('[data-remove]')];
    if (removes.length) rows.push({ id: 'list', el: listEl, kind: 'buttons', label: 'Driven now', buttons: removes, always: true });
    for (const w of form.querySelectorAll('[data-auto-row]')) {
      if (w.hidden || w.closest('[hidden]')) continue;
      const id = w.dataset.autoRow;
      if (id === 'add') { if (!w.disabled) rows.push({ id, el: w, kind: 'buttons', label: 'Add', buttons: [w] }); continue; }
      const ctl = w.querySelector(`[data-a="${id}"]`);
      if (!ctl || ctl.disabled) continue;
      const label = (w.querySelector('span,label')?.textContent || id).trim();
      if (ctl.tagName === 'SELECT') {
        const options = [...ctl.options].map((o) => ({ value: o.value, label: o.textContent, disabled: o.disabled }));
        if (options.some((o) => !o.disabled)) rows.push({ id, el: w, kind: 'choice', label, ctl, options });
      } else if (ctl.type === 'number') {
        rows.push({ id, el: w, kind: 'number', label, ctl, buttons: [...w.querySelectorAll('[data-auto-nudge]')] });
      } else {
        const options = textChoices(id);
        if (options.length) rows.push({ id, el: w, kind: 'choice', label, ctl, options, text: true });
      }
    }
    return rows;
  }
  const enabledOf = (r) => r.options.filter((o) => !o.disabled);

  // The top-level stops: a row each (rows), or every thing that can act (one).
  function topStops(rows) {
    if (modeNow() === 'rows') return rows.map((r) => ({ row: r.id, i: -1, el: r.el }));
    const out = [];
    for (const r of rows) {
      if (r.kind === 'choice') out.push({ row: r.id, i: -1, el: r.el });
      else r.buttons.forEach((b, i) => out.push({ row: r.id, i, el: b }));
    }
    return out;
  }
  // Inside a row (rows only): the things in it.
  function insideStops(r) {
    if (!r) return [];
    if (r.kind === 'choice') return [...ensureStrip(r).querySelectorAll('[data-auto-opt]')].filter((b) => !b.disabled);
    return r.buttons.filter((b) => !b.disabled);
  }
  function ensureStrip(r) {
    let strip = r.el.querySelector('[data-auto-opts]');
    const sig = JSON.stringify([r.options, r.ctl.value]);
    if (strip && strip.dataset.sig === sig) return strip;
    strip?.remove();
    strip = el('div', { class: 'auto-opts', role: 'group', 'aria-label': r.label, data: { autoOpts: '', sig } });
    r.options.forEach((o, n) => {
      const on = String(o.value) === String(r.ctl.value);
      strip.append(el('button', { type: 'button', class: 'auto-opt', disabled: o.disabled ? true : null,
        'aria-pressed': on ? 'true' : 'false', title: o.hint || null, data: { autoOpt: String(n) }, text: o.label }));
    });
    r.el.append(strip);
    return strip;
  }
  const dropStrips = () => root.querySelectorAll('[data-auto-opts]').forEach((s) => s.remove());

  let cur = { row: null, i: -1, inside: false };
  let picker = null;
  let pickRow = null;

  function paint() {
    root.querySelectorAll('.is-scan').forEach((n) => n.classList.remove('is-scan'));
    root.querySelectorAll('[data-auto-in]').forEach((n) => { delete n.dataset.autoIn; });
    if (picker) { dropStrips(); return; }
    const rows = rowsNow();
    let r = rows.find((x) => x.id === cur.row) || null;
    // The row the cursor was on went (the last rule removed, a field hidden): the first row, never nowhere.
    if (cur.row && !r) { cur = { row: rows[0]?.id || null, i: -1, inside: false }; r = rows[0] || null; }
    if (!(cur.inside && r && r.kind === 'choice')) dropStrips();
    if (!r) return;
    if (cur.inside) {
      const st = insideStops(r);
      if (!st.length) { cur.inside = false; dropStrips(); paint(); return; }
      if (cur.i < 0 || cur.i >= st.length) cur.i = 0;
      r.el.dataset.autoIn = '';
      st[cur.i].classList.add('is-scan');
      try { st[cur.i].scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* no layout */ }
      return;
    }
    const top = topStops(rows);
    const s = top.find((x) => x.row === cur.row && x.i === cur.i) || top.find((x) => x.row === cur.row) || null;
    if (s) {
      cur.i = s.i;
      s.el.classList.add('is-scan');
      try { s.el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* no layout */ }
    }
  }

  function setChoice(r, value) {
    if (!r?.ctl) return;
    r.ctl.value = value;
    r.ctl.dispatchEvent(new Event(r.ctl.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    // A panel chosen for "another panel's output": its first number output goes in with it, so an output
    // from a panel that was not chosen is never left behind.
    if (r.id === 'instance') {
      const port = form.querySelector('[data-a="port"]');
      const outs = numberOutputs(panelById(value));
      if (port && !outs.some((o) => o.id === port.value)) { port.value = outs[0]?.id || ''; port.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    const o = r.options.find((x) => String(x.value) === String(value));
    say(`${r.label}: ${o ? o.label : value}`);
  }
  function stepChoice(r) {
    const opts = enabledOf(r);
    if (!opts.length) return;
    const at = opts.findIndex((o) => String(o.value) === String(r.ctl.value));
    setChoice(r, opts[(at + 1) % opts.length].value);
  }
  function nudgeSpec(name) {
    const across = Math.max(1, Number(NUDGE.across) || AUTOMATION_PANEL_DEFAULTS.across);
    if (name === 'outMin' || name === 'outMax') {
      const s = settingNow();
      if (!s) return { step: 1 };
      let step = (s.max - s.min) / across;
      const own = Number(s.field?.step);
      if (own > 0) step = own * Math.max(1, Math.round(step / own));
      return { step, min: s.min, max: s.max };
    }
    if (name === 'inMin' || name === 'inMax') {
      const [lo, hi] = AUTOMATION_DEFAULTS.inputRange;
      return { step: (hi - lo) / across };
    }
    if (name === 'center' || name === 'width') return { step: 1 / across, min: 0, max: 1 };
    if (name === 'step') return { step: 1 / across, min: 1 / across, max: 1 };
    if (name === 'periodS') return { step: Number(NUDGE.periodStepS) || AUTOMATION_PANEL_DEFAULTS.periodStepS, min: LFO_MIN_PERIOD_MS / 1000 };
    return { step: 1 };
  }
  function nudge(name, dir) {
    const input = form.querySelector(`[data-a="${name}"]`);
    if (!input || input.disabled) return;
    const { step, min = -Infinity, max = Infinity } = nudgeSpec(name);
    let v = input.value === '' ? NaN : Number(input.value);
    if (!Number.isFinite(v)) v = Number.isFinite(min) ? min : 0;
    v = Math.min(max, Math.max(min, v + dir * step));
    input.value = String(Number(v.toFixed(Math.max(decimals(step), 2))));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openPick(r) {
    const opts = enabledOf(r);
    const left = r.options.length - opts.length;
    pickRow = r.id;
    form.hidden = true;
    listEl.hidden = true;
    pickHost.hidden = false;
    dropStrips();
    picker = mountChoicePicker(pickHost, {
      options: opts.map((o) => ({ value: o.value, label: o.label, hint: o.hint || '' })),
      value: r.ctl.value,
      // The ones that cannot be chosen are not tiles (a tile is something you can take); the list behind
      // says each one's reason, so the title says how many and where.
      title: left ? `${r.label} (${left} more cannot be chosen: the list says why)` : r.label,
      key: r.id,
      keys: false,
      onPick: (v) => { closePick(); const rr = rowsNow().find((x) => x.id === pickRow); if (rr) setChoice(rr, v); paint(); },
      onCancel: () => { closePick(); paint(); },
    });
  }
  function closePick() {
    try { picker?.destroy(); } catch { /* gone */ }
    picker = null;
    pickHost.hidden = true;
    pickHost.innerHTML = '';
    form.hidden = false;
    listEl.hidden = false;
    cur = { row: pickRow, i: -1, inside: false };
  }

  function activateInside(r, i) {
    const st = insideStops(r);
    const b = st[i];
    if (!b) return;
    if (r.kind === 'choice') {
      const o = r.options[Number(b.dataset.autoOpt)];
      cur.inside = false;
      dropStrips();
      if (o) setChoice(r, o.value);
      paint();
      return;
    }
    if (r.kind === 'number') { b.click(); paint(); return; }   // stays in the row
    cur.inside = false;
    b.click();
    paint();
  }

  const scan = {
    mode: () => modeNow(),
    /** The top-level stops, in order (the window puts its Close before them). */
    stops() { return picker ? [] : topStops(rowsNow()).map((s) => s.el); },
    /** True while a row is entered or the picker is open: next / prev / select / back are this panel's. */
    holds: () => !!picker || cur.inside,
    /** The lit element: a thing inside, a top-level stop, the picker's lit row or tile -- or null. */
    current() {
      if (picker) return pickHost.querySelector('[data-on]') || null;
      if (!cur.row) return null;
      return root.querySelector('.is-scan') || null;
    },
    /** Put the top-level cursor on one of `stops()` (or nowhere). False if it is not one. */
    light(n) {
      if (picker) return false;
      if (!n) { cur = { row: null, i: -1, inside: false }; paint(); return true; }
      const s = topStops(rowsNow()).find((x) => x.el === n);
      if (!s) return false;
      cur = { row: s.row, i: s.i, inside: false };
      paint();
      return true;
    },
    step(d) {
      if (picker) { if (d > 0) picker.next(); else picker.prev(); return; }
      const rows = rowsNow();
      if (cur.inside) {
        const st = insideStops(rows.find((x) => x.id === cur.row));
        if (st.length) cur.i = ((cur.i + Math.sign(d || 1)) % st.length + st.length) % st.length;
        paint();
        return;
      }
      const top = topStops(rows);
      if (!top.length) return;
      const at = top.findIndex((x) => x.row === cur.row && x.i === cur.i);
      const n = at < 0 ? (d > 0 ? 0 : top.length - 1) : (at + Math.sign(d || 1) + top.length) % top.length;
      cur = { row: top[n].row, i: top[n].i, inside: false };
      paint();
    },
    select() {
      if (picker) { picker.select(); return; }
      const r = rowsNow().find((x) => x.id === cur.row);
      if (!r) return;
      if (modeNow() === 'rows') {
        if (!cur.inside) {
          const count = r.kind === 'choice' ? enabledOf(r).length : r.buttons.length;
          if (count === 1 && !r.always) {
            cur.inside = true;
            activateInside(r, 0);
            cur.inside = false;
            paint();
            return;
          }
          cur.inside = true;
          // A choice starts on what it is NOW, so a stray select changes nothing.
          const st = insideStops(r);
          const now = r.kind === 'choice' ? st.findIndex((b) => b.getAttribute('aria-pressed') === 'true') : 0;
          cur.i = now < 0 ? 0 : now;
          paint();
          return;
        }
        activateInside(r, cur.i);
        return;
      }
      // One at a time.
      if (r.kind === 'choice') {
        const fieldLike = { kind: 'choice', cycleable: true, options: enabledOf(r) };
        let m = 'point';
        try { m = chooseModeOf(typeof chooseMode === 'function' ? chooseMode() : chooseMode); } catch { m = 'point'; }
        if (opensPicker(fieldLike, { mode: m })) openPick(r); else { stepChoice(r); paint(); }
        return;
      }
      r.buttons[cur.i]?.click();
      paint();
    },
    /** Out of the picker or the row: true. At the top: false (the host decides what leaving means). */
    back() {
      if (picker) { picker.back(); return true; }
      if (cur.inside) { cur.inside = false; dropStrips(); paint(); return true; }
      return false;
    },
  };

  // A pointer on the switch's own buttons: a nudge, or a choice from the row's strip.
  wrap.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const nb = t?.closest('[data-auto-nudge]');
    if (nb && wrap.contains(nb)) {
      e.preventDefault();
      const [name, d] = nb.dataset.autoNudge.split(':');
      nudge(name, Number(d) || 0);
      return;
    }
    const ob = t?.closest('[data-auto-opt]');
    if (ob && wrap.contains(ob) && !ob.disabled) {
      e.preventDefault();
      const r = rowsNow().find((x) => x.el.contains(ob));
      const o = r?.options[Number(ob.dataset.autoOpt)];
      if (r && o) { cur = { row: r.id, i: -1, inside: false }; dropStrips(); setChoice(r, o.value); paint(); }
    }
  });

  paintForm();
  paintList();

  return {
    /** Re-read the panels and the bindings (a panel was added, the list was loaded). */
    refresh() { const keep = panelSel?.value; paintForm(); if (keep && panelById(keep)) { panelSel.value = keep; paintKeys(); } paintList(); paint(); },
    /** Put the form on one panel (the thing chosen elsewhere). False when it is not on this screen. */
    select(id) { if (!id || !panelById(id)) return false; panelSel.value = id; paintKeys(); paint(); return true; },
    /** The form, for a test: fill it the way a person would and submit. */
    form,
    /** The switch walk (see the header). */
    scan,
    destroy() { try { picker?.destroy(); } catch { /* gone */ } picker = null; root.innerHTML = ''; },
  };
}
