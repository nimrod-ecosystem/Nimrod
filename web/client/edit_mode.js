// edit_mode.js — EDIT ANY MODULE, IN PLACE, ON ANY DASHBOARD (Mike, 2026-10-02).
//
// Mike: *"every module should have an edit mode I think. That would probably be some sort of global
// function. You wouldn't have to be in the edit dashboard to edit a module. So you could click on a
// button or piece of furniture or whatever else and have access to any options for it."*
//
// *** WHAT EDIT MODE IS. *** One panel at a time (per dashboard) is "being edited". While it is:
//   * a press INSIDE it does not do what it normally does -- it CHOOSES what was pressed (the words on a
//     sign, its picture, the panel itself), and the chosen thing's OPTIONS show;
//   * everything else on the screen works as it always does, and the panel itself keeps running (a
//     slideshow keeps turning, a clock keeps ticking): only presses on it are taken;
//   * Done (always in the panel's top-left corner, the first thing in it), Escape, the panel's ✎ corner
//     pressed again, `shell/edit-panel { on: false }`, or a while with no press at all, leaves it.
// It is entered by the ✎ corner beside ⤢ on every panel (arrangement.js), by a verb on the bus
// (`shell/edit-panel { id }` -- a menu row, a bound switch, Home's "Edit the chosen panel"), or by a
// dashboard that opens with a panel already being edited (`editPanel` on its settings doc: the builder).
//
// *** WHERE THE OPTIONS SHOW. *** The selection is PUBLISHED (`edit/selected`) with a `claim()`. A panel
// that shows options (modules/edit_options.js -- the builder dashboard's top right) claims it and draws
// it; when nobody claims it, a small options card is drawn INSIDE the panel being edited. So the same
// press shows its options in the builder's settings panel, or right where it was pressed, anywhere else.
//
// *** THE CONTRACT A MODULE OPTS INTO (module.js passes it through as `editTargets()`). ***
//   impl.editTargets() -> [{ id, label, el, keys?, fields?, values?, set?, help? }]
//     id      stable within the module ('words', 'picture', an object's id)
//     el      the element a press selects it by (the nearest one wins: list the small ones first)
//     keys    which of the module's OWN declared settings belong to this element (the usual case), or
//     fields  settings_fields.js declarations of its own, with `values()` / `set(patch)` to read and write
//             them (an element whose options are not on the panel's state row: a room object's door)
//     help    a sentence saying what it is (else Nimrod's words for the panel, cat_help.js)
//     also    more elements that choose the SAME thing (2026-10-02: a room object is drawn twice -- its
//             picture, and the clear button over it that takes a press -- and either is "the desk")
//     whole   this target IS the panel (a room's walls and floor): it is what is chosen to begin with,
//             and what a press on nothing else chooses. List it LAST (it holds every other target).
//     redraws (row 2.184, 2026-11-02) true: the module draws this element again on every change (an AAC board's card), so
//             after a write or one of its buttons the targets are found again; one that is gone chooses the panel.
//     handles (2026-10-25) drag / scale / turn handles on it while chosen, room_handles.js, drawn by the
//             dashboard (arrangement.js): `{ el, piece, floor?, movable?, geometry?: 'svg', onCommit(patch) }`.
//             The village's pieces use them, so a room and a village are moved by the same editor.
//     transformKeys (row 2.145 step 1, 2026-10-31) which of its `fields` are its TRANSFORM -- where it stands, its size,
//             its turn (['x', 'y', 'size', 'rotate'] for a room or village piece). The one editor (editor.js) shows
//             those first, under "Transform", and the rest under its settings. Absent: it has no transform of its own.
//             Carried onto the selection as `transformKeys` ([] when absent); nothing else reads it.
//     siteDefault (row 2.145 step 5c, 2026-10-31) () => { kind, path, body } | null: this thing, as it is now, as an entry
//             for the site's own defaults (nimrod_defaults.js: a room's `rooms` [preset], a village's `village` [scene],
//             a Town place's `town` [deck, place]). Only the one editor reads it, for an owner's "Save as the site default"
//             (site_defaults.js: queued for Code, never applied by the page). Carried onto the selection; absent: null.
//             (step 2, 2026-10-31: a room piece also names 'facing' and 'wall', a village piece 'facing', a Town piece
//             ['x', 'y', 'size', 'facing'] -- where it stands, its size, its turn and which way it faces.)
// A record may also say `passThrough` (a CSS selector): a press inside a matching element nested in the
// panel is NOT taken -- a module sitting in a room's slot keeps working while the room is being edited.
// A module that cannot be edited (yet) without changing its file can be DECLARED here instead
// (`DECLARED_TARGETS`: a CSS selector per element and its keys). And a module that does neither is still
// editable as a whole: pressing anywhere in it chooses the panel, and its options are its manifest's
// settings -- the same rows the ⚙ menu shows for it.
//
// *** NOT A GATE (CLAUDE.md: "a screen must never enter a state that only an input can leave, when the
// person in front of it cannot give that input"). *** Nothing about the screen stops; only presses on the
// one panel are taken, and only by a pointer -- a switch's verbs reach the module exactly as before. If
// nobody answers, it leaves by itself after `editIdleMs` (the dashboard's setting, default 5 minutes,
// argued at EDIT_DEFAULTS). Done is never hidden and never dimmed.

import { getManifest } from './module.js';
import { fieldsFor, normalizeField, fieldItems, fieldValue, stepValue, displayValue, showsAtLevel } from './settings_fields.js';
import { explainModule, selectionAt, explain } from './cat_help.js';
import { cornerShowCss } from './panel_corners.js';   // corner on hover (2026-10-09): when the ✎ corner shows
import { stageOf } from './modules_catalog.js';      // live and beta (2026-10-14): the Beta tag beside Done
import { BETA_WORDS } from './beta.js';
import { wordsElementAt, recordChange, showWordsInPlace, norm, LINE_MAX } from './wording_edit.js';   // the site's words (note FC 2)

export const EDIT_PANEL_TOPIC = 'shell/edit-panel';   // { id?, on?: true|false } -- absent `on` toggles
export const EDIT_SELECTED_TOPIC = 'edit/selected';   // the selection (below), with claim()
export const EDIT_ENDED_TOPIC = 'edit/ended';         // { id } -- edit mode left that panel

// Keys on a DASHBOARD's settings doc (the screen's, not a panel's).
export const EDIT_PANEL_KEY = 'editPanel';     // an instance id: the dashboard opens with it being edited
export const EDIT_IDLE_KEY = 'editIdleMs';     // how long edit mode waits with no press before leaving
export const EDIT_CORNER_KEY = 'editCorner';   // false: no ✎ corner on this dashboard's panels

// =====================================================================================================
// THE NUMBERS (Rule 1).
//   idleMs 5 min   FOR leaving by itself at all: a pointer user who walked away from a panel in edit mode
//                  comes back to presses that "do nothing" and no idea why. FOR 5 minutes: long enough to
//                  read every option of a sign and think about it; the kiosk's own "nobody touched it"
//                  waits are minutes, not seconds. AGAINST: somebody thinking for six minutes is put out
//                  of edit mode -- which costs one press of ✎ and loses nothing (every change was already
//                  written). 0 = never. A dashboard setting (`editIdleMs`).
//   corner on      the ✎ corner shows wherever the ⤢ corner does (hover, keyboard focus), which a scanning
//                  switch never lands on, so it costs a switch user nothing. `editCorner: false` hides it.
//                  (corner on hover, 2026-10-09: WHEN both show is panel_corners.js's; on the panel being
//                  edited the ✎ stays up -- "Stop editing" -- until edit mode ends.)
//   level          the options card shows the 'standard' rows, as the ⚙ menu does; the builder's options
//                  panel has its own Show row (essential / standard / advanced).
// =====================================================================================================
export const EDIT_DEFAULTS = Object.freeze({ idleMs: 5 * 60 * 1000, corner: true, level: 'standard' });
export const EDIT_IDLE_CHOICES = Object.freeze([0, 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000]);

/** The dashboard settings that bear on edit mode, read safely. */
export function editSettingsFrom(s = {}) {
  const r = s && typeof s === 'object' ? s : {};
  const idle = Number(r[EDIT_IDLE_KEY]);
  return {
    idleMs: Number.isFinite(idle) && idle >= 0 ? idle : EDIT_DEFAULTS.idleMs,
    corner: r[EDIT_CORNER_KEY] !== false,
    panel: typeof r[EDIT_PANEL_KEY] === 'string' && r[EDIT_PANEL_KEY] ? r[EDIT_PANEL_KEY] : null,
  };
}

// =====================================================================================================
// DECLARED TARGETS: modules whose own file has not opted in, described from outside by what they draw.
// The keys are each module's own declared settings (its manifest); a key a module does not declare is
// simply not shown, so a stale entry here shows fewer rows, never a broken one.
// =====================================================================================================
export const DECLARED_TARGETS = Object.freeze({
  // modules/button.js: a sign, a framed picture, or both. Smallest first (the words sit on the face).
  button: Object.freeze([
    Object.freeze({ id: 'words', label: 'The words', selector: '.ab-word',
      keys: ['label', 'font', 'color', 'wordsSize', 'wordsAlign', 'wordsEmphasis', 'style', 'inkLightness', 'inkSaturation', 'inkHue'],
      help: 'The words on it: what they say, their font and their color.' }),
    Object.freeze({ id: 'picture', label: 'The picture', selector: '.ab-img',
      keys: ['image', 'frame'], help: 'The picture on it, and the frame around it.' }),
    Object.freeze({ id: 'face', label: 'The button', selector: '[data-face]',
      keys: ['style', 'frame', 'background', 'whenPressed'],
      help: 'The whole button: its look, its background and what pressing it does.' }),
  ]),
});

/**
 * The targets a mounted panel offers, nearest-first: the module's own `editTargets()` if it has one,
 * else the DECLARED ones found in its mount. `rec` is an arrangement record ({ instance, el, type }).
 */
export function targetsOf(rec) {
  if (!rec) return [];
  let raw = null;
  try {
    const inst = rec.instance;
    const fn = inst && (typeof inst.editTargets === 'function' ? inst.editTargets
      : typeof inst.impl?.editTargets === 'function' ? inst.impl.editTargets.bind(inst.impl) : null);
    raw = fn ? fn() : null;
  } catch (err) { console.error(`edit mode: ${rec.type} editTargets`, err); raw = null; }
  if (Array.isArray(raw) && raw.length) {
    return raw.filter((t) => t && t.id && t.el && typeof t.el.contains === 'function')
      .map((t) => ({ ...t, id: String(t.id), label: String(t.label || t.id),
        also: (Array.isArray(t.also) ? t.also : []).filter((e) => e && typeof e.contains === 'function') }));
  }
  const decl = DECLARED_TARGETS[rec.type] || [];
  const root = rec.el;
  if (!root?.querySelector) return [];
  const out = [];
  for (const d of decl) {
    const el = root.querySelector(d.selector);
    if (el) out.push({ id: d.id, label: d.label, el, keys: [...d.keys], help: d.help || null });
  }
  return out;
}

/** Which target a press on `node` chose: the first (nearest-first) whose element holds it, else null. */
export function targetAt(targets, node) {
  if (!node) return null;
  const holds = (e) => !!e && (e === node || e.contains(node));
  return (targets || []).find((t) => holds(t.el) || (t.also || []).some(holds)) || null;
}

/**
 * THE SELECTION: what a press chose, as everything an options view needs.
 *   { panelId, type, title, target: { id, label } | null, label, help, fields, values(), set(key, v) }
 * `fields` are settings_fields.js fields (normalised). A target's `keys` pick from the module's own;
 * its `fields` are its own; no target = the whole panel's.
 */
export function selectionFor(rec, target = null, { pressed = null } = {}) {
  const type = rec?.type || '';
  const manifest = (() => { try { return getManifest(type) || null; } catch { return null; } })();
  const title = rec?.title || manifest?.title || type || 'This panel';
  let all = [];
  try { all = fieldsFor(manifest, rec?.instance); } catch { all = []; }
  let fields;
  if (target && Array.isArray(target.fields)) fields = target.fields.map((f) => normalizeField(f)).filter(Boolean);
  else if (target && Array.isArray(target.keys)) fields = target.keys.map((k) => all.find((f) => f.key === k)).filter(Boolean);
  else fields = all;
  const read = typeof target?.values === 'function' ? target.values : () => rec?.state?.get?.() || {};
  const write = typeof target?.set === 'function' ? target.set : (patch) => rec?.state?.set?.(patch);
  // What it IS, in Nimrod's words (cat_help.js): the target's own sentence, else what was pressed (a room
  // object, a control that names itself), else the panel's module.
  let help = target?.help || null;
  if (!help && pressed) { try { const s = selectionAt(pressed); if (s && s.kind !== 'module') help = explain(s).text; } catch { /* no words */ } }
  if (!help) { try { help = explainModule(type, { chat: 'few' }).text; } catch { help = ''; } }
  return {
    panelId: rec?.id || null, type, title,
    target: target ? { id: target.id, label: target.label } : null,
    label: target ? `${title}: ${target.label}` : title,
    help: help || '',
    fields,
    // (row 2.145 step 1: which fields are its Transform -- the contract above. Only keys it really has.)
    transformKeys: Array.isArray(target?.transformKeys)
      ? target.transformKeys.map(String).filter((k) => fields.some((f) => f.key === k)) : [],
    // A target's LINKS (2026-10-02, a brick-built piece's "Open its bricks"): `{ id, label, href, note? }`,
    // drawn under the rows as ordinary links that open in a new tab. Not settings: nothing is written.
    // And its BUTTONS (row 2.110, 2026-10-21: a room piece's "Take it out" and "Undo"): `{ id, label, run, note? }`,
    // a press that does one thing and is not a setting with a value to step through.
    actions: (Array.isArray(target?.actions) ? target.actions : [])
      .filter((a) => a && a.id && a.label && (typeof a.run === 'function' || (typeof a.href === 'string' && /^(\/|https?:)/.test(a.href))))
      .map((a) => ({ id: String(a.id), label: String(a.label),
        ...(typeof a.run === 'function' ? { run: a.run } : { href: a.href }), note: a.note ? String(a.note) : '' })),
    values: () => { try { return read() || {}; } catch { return {}; } },
    set: (key, value) => { try { write({ [key]: value }); return true; } catch (err) { console.error('edit mode: set', err); return false; } },
    // (row 2.145 step 5, 2026-10-31) Several keys in ONE write: "Put back the site default" writes a setting and the key
    // it used to live under together (site_defaults.js putBackPatch), so nothing reads half of it in between.
    patch: (p) => { try { write({ ...(p || {}) }); return true; } catch (err) { console.error('edit mode: patch', err); return false; } },
    // (step 5) Whether these settings are the panel's own row (its state), not a thing's own `values` (a room piece's
    // place, kept in the room's recipe): only the panel's row is compared with the site's default settings.
    stateRow: typeof target?.values !== 'function',
    // (step 5c) The thing as a whole as a site default, when its module offers one (the contract's `siteDefault`).
    siteDefault: typeof target?.siteDefault === 'function' ? target.siteDefault : null,
  };
}

// =====================================================================================================
// THE OPTIONS, DRAWN. One renderer for the in-panel card and the builder's options panel, so a row looks
// and works the same in both. Every row is a settings_fields.js field: a cycleable one has ‹ and ›
// (one switch only ever needs ›: it wraps), a text one a box (Enter or the ✓ keeps it), a picture one a
// Choose… that opens the shared picture picker. Done is FIRST (the way out first, as everywhere).
// =====================================================================================================
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function optionRows(sel, { level = EDIT_DEFAULTS.level } = {}) {
  if (!sel) return [];
  const vals = sel.values();
  return (sel.fields || []).filter((f) => showsAtLevel(f, level)).filter((f) => {
    if (!f.appliesWhen) return true;
    try { return f.appliesWhen(vals) !== false; } catch { return true; }
  }).map((f) => {
    const v = fieldValue(f, vals);
    return { key: f.key, label: f.label, value: v, shown: displayValue(f, v), field: f,
      cycle: !!f.cycleable, text: !!f.editable && f.kind === 'text', picture: !!f.opens, why: f.cycleable || f.editable || f.opens ? '' : (f.why || '') };
  });
}

// =====================================================================================================
// TYPED NUMBERS (row 2.145 step 2, 2026-10-31). The one editor's Transform (editor.js) puts a box between a number's ‹
// and ›, as Godot's and Blender's inspectors do: type 33.5, press Enter. ONLY WHERE ASKED (`renderOptions(..., { typed:
// true })`): the in-panel card and the builder's options panel draw exactly what they drew before.
//   * The box shows and takes the number IN THE ROW'S OWN UNITS (settings_fields.js `displayScale`: a size typed "120"
//     is kept as 1.2, a village's "50" across as 800 px). A unit typed after it ("120 %") and a decimal comma ("33,5")
//     are taken; anything else that is not a number is refused.
//   * Out of the row's range: REFUSED, not squeezed in. FOR: a typo (999 for 99) that quietly became the maximum would
//     move the thing somewhere nobody asked for; refused, the box says "Between 3 and 97 %" and nothing is written.
//     AGAINST: one more Enter. A TURN is the exception: it goes round (`wraps`, 190° is -170°), as the edit windows take
//     it -- every number is a turn there is.
//   * Enter keeps it (one undoable step, through the row's own `set`: its owner's bounds and rounding, as for ‹ ›).
//     Escape puts the box back and is used up there (edit mode and the editor stay as they were). Leaving the box keeps
//     nothing and puts it back: a box never shows a number that is not in force.
//   * NEVER A SWITCH STOP: a switch cannot type. The ‹ and › either side of it are the stops, exactly as before.
// =====================================================================================================
// =====================================================================================================
// ESCAPE IN A WORDS BOX (row 2.145 step 3, 2026-10-31; a bug the step-3 plan found). A text row's box (`data-em-text`)
// sat inside edit mode, whose Escape left the panel -- so a person who had typed new words and pressed Escape lost them
// with the card, and edit mode with them. Now Escape in a box WITH TYPING NOT YET KEPT puts the box back (as it was drawn:
// the value in force) and is used up there; edit mode and the editor stay.
//   FOR "only when something was typed" (not always, as a number's box is): a box with nothing new in it is not holding
//   anything to lose, so Escape there does what it did before (leaves) -- a keyboard user is never kept in edit mode by
//   the box the focus happens to be in. AGAINST: the number boxes (step 2) use up every Escape; the two differ when the
//   box is unchanged. Left as it is there: a number's box is put back on leaving anyway, and step 2 is tested as it is.
// "Typed" is the box's value against its drawn value (`defaultValue`, the `value` attribute renderOptions writes), so
// nothing has to be remembered: a secret's box is drawn empty, so anything in it is typing.
// =====================================================================================================
/** Whether `el` is a words box (`data-em-text`) with typing in it that was not kept. */
export function textTyped(el) {
  return !!el && typeof el.matches === 'function' && el.matches('[data-em-text]') && el.value !== el.defaultValue;
}

const isNumLike = (v) => typeof v === 'number' && Number.isFinite(v);
const roundTo = (v, d) => { const p = 10 ** Math.max(0, Math.min(6, Number(d) || 0)); return Math.round(v * p) / p; };
/** A stored number as the row shows it (its own units, its own decimals), without the unit. PURE. */
export function shownNumber(field, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const scale = Number(field?.displayScale) > 0 ? Number(field.displayScale) : 1;
  return scale === 1 ? n : roundTo(n / scale, field?.displayDecimals ?? 0);
}
/** What a typed number's row says when it is refused. */
export function typedRange(field) {
  const unit = field?.unit ? ` ${field.unit}` : '';
  return `Between ${shownNumber(field, field?.min)} and ${shownNumber(field, field?.max)}${unit}.`;
}
/**
 * A number typed into a row's box, as the value to keep (in stored units), or why not. PURE.
 *   -> { ok: true, value } | { ok: false, why }
 */
export function parseTyped(field, raw) {
  if (!field || field.kind !== 'number' || !isNumLike(field.min) || !isNumLike(field.max)) return { ok: false, why: 'This one is not set by typing.' };
  let s = String(raw ?? '').trim();
  if (field.unit && s.endsWith(field.unit)) s = s.slice(0, -field.unit.length).trim();
  s = s.replace(/^−/, '-').replace(',', '.');     // a typographic minus; a decimal comma
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, why: s ? `That is not a number. ${typedRange(field)}` : `Type a number. ${typedRange(field)}` };
  const scale = Number(field.displayScale) > 0 ? Number(field.displayScale) : 1;
  let v = roundTo(Number(s) * scale, 6);                // 6 places: 120 x 0.01 is 1.2, not 1.2000000000000002
  const w = Number(field.wraps);
  if (w > 0) v = roundTo((((v - field.min) % w) + w) % w + field.min, 6);
  if (v < field.min - 1e-9 || v > field.max + 1e-9) return { ok: false, why: typedRange(field) };
  return { ok: true, value: v };
}

/**
 * Draw `sel`'s options into `host` (replacing what is there). `onDone`: the Done button. `level`: which
 * rows. Returns { refresh, destroy }. Every press writes through `sel.set` and redraws.
 * `typed` (row 2.145 step 2): a box between a number's ‹ and › to type it into (above). Off unless asked.
 * `defaults` (row 2.145 step 5, 2026-10-31): THE SITE'S DEFAULT, per row -- off unless asked (the one editor asks; the
 *   in-panel card and the builder's options panel draw exactly what they drew before). A row whose value differs from
 *   the site's default says so under it, in words ("Changed from the site default: <its value>"), with a "Put back the
 *   site default" button: a switch stop like every button. `{ changed(field, values), siteShown(field, values),
 *   putBack(field), words: { changed, putBack } }` (site_defaults.js says what the site default is).
 */
export function renderOptions(host, sel, { onDone = null, level = EDIT_DEFAULTS.level, doneLabel = 'Done', typed = false, defaults = null } = {}) {
  if (!host) return { refresh() {}, destroy() {} };
  const doc = host.ownerDocument || document;
  ensureEditCss(doc);
  let torn = false;
  // (row 2.145 step 5) The site default under a changed row, or '' (never throws: a row is drawn either way).
  const defWords = { changed: 'Changed from the site default', putBack: 'Put back the site default', ...(defaults?.words || {}) };
  function defaultLine(r, vals) {
    if (!defaults) return '';
    let changed = false, shown = '';
    try { changed = !!defaults.changed(r.field, vals); shown = changed ? String(defaults.siteShown?.(r.field, vals) ?? '') : ''; } catch { changed = false; }
    if (!changed) return '';
    return `<div class="em-def" data-em-changed="${esc(r.key)}"><span>${esc(defWords.changed)}${shown ? `: ${esc(shown)}` : ''}</span>`
      + `<button type="button" class="em-btn" data-em-default="${esc(r.key)}" data-em-focus="${esc(r.key)}:d">${esc(defWords.putBack)}</button></div>`;
  }
  function draw() {
    if (torn) return;
    const rows = optionRows(sel, { level });
    const vals = defaults ? sel.values() : null;
    const keepFocus = doc.activeElement && host.contains(doc.activeElement) ? doc.activeElement.dataset.emFocus || null : null;
    host.innerHTML = `<div class="em-opts" role="group" aria-label="${esc(`Options: ${sel.label}`)}" data-em-opts>
      <div class="em-head">${onDone ? `<button type="button" class="em-btn em-done" data-em="done" data-em-focus="done">${esc(doneLabel)}</button>` : ''}
        <strong class="em-title" data-em-title>${esc(sel.label)}</strong></div>
      ${sel.help ? `<p class="em-help" data-em-help>${esc(sel.help)}</p>` : ''}
      <div class="em-rows">${rows.length ? rows.map((r) => `<div class="em-row" data-em-row="${esc(r.key)}">
          <span class="em-l">${esc(r.label)}</span>
          <span class="em-v" data-em-value>${esc(r.shown)}</span>
          <span class="em-c">${r.cycle
            ? `<button type="button" class="em-btn" data-em-step="-1" data-em-key="${esc(r.key)}" data-em-focus="${esc(r.key)}:-1" aria-label="${esc(`${r.label}: back one`)}">‹</button>`
              // (row 2.145 step 2) The typed box, between the two: only where asked, only on a number.
              + (typed && r.field.kind === 'number'
                ? `<input class="em-num" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-em-num="${esc(r.key)}" data-em-focus="${esc(r.key)}:n" aria-label="${esc(`${r.label}, type a number${r.field.unit ? ` in ${r.field.unit === '%' ? 'percent' : r.field.unit === '°' ? 'degrees' : r.field.unit}` : ''}`)}" value="${esc(shownNumber(r.field, r.value))}">`
                : '')
              + `<button type="button" class="em-btn" data-em-step="1" data-em-key="${esc(r.key)}" data-em-focus="${esc(r.key)}:1" aria-label="${esc(`${r.label}: next`)}">›</button>`
            : r.text
              // A secret (a key, a pass phrase; row 2.83) is a HIDDEN box with a Show button, opened empty as before.
              ? (r.field.lines > 1
                // (note FD 3) Several lines: a box of that many; Enter is a new line, Ctrl+Enter or ✓ keeps it.
                ? `<textarea class="em-text" rows="${r.field.lines}" data-em-text="${esc(r.key)}" data-em-focus="${esc(r.key)}:t" aria-label="${esc(`${r.label} (Ctrl+Enter keeps it)`)}"${r.field.maxLength ? ` maxlength="${r.field.maxLength}"` : ''}>${esc(r.value)}</textarea>`
                : `<input class="em-text"${r.field.secret ? ' type="password" autocomplete="new-password"' : ''} data-em-text="${esc(r.key)}" data-em-focus="${esc(r.key)}:t" aria-label="${esc(r.label)}" value="${esc(r.field.secret ? '' : r.value)}"${r.field.maxLength ? ` maxlength="${r.field.maxLength}"` : ''}>`)
                + (r.field.secret ? `<button type="button" class="em-btn" data-em-show="${esc(r.key)}" data-em-focus="${esc(r.key)}:s" aria-pressed="false">Show</button>` : '')
                + `<button type="button" class="em-btn" data-em-keep="${esc(r.key)}" data-em-focus="${esc(r.key)}:k" aria-label="${esc(`Keep ${r.label}`)}">✓</button>`
              : r.picture
                ? `<button type="button" class="em-btn" data-em-pick="${esc(r.key)}" data-em-focus="${esc(r.key)}:p">Choose…</button>`
                : `<small>${esc(r.why)}</small>`}</span>${defaultLine(r, vals)}</div>`).join('')
        : '<p class="em-none" data-em-none>Nothing to set on this one.</p>'}</div>${(sel.actions || []).map((a) => `<div class="em-act" data-em-act="${esc(a.id)}">
          ${a.note ? `<span class="em-v">${esc(a.note)}</span>` : ''}${a.run
            ? `<button type="button" class="em-btn" data-em-run="${esc(a.id)}" data-em-focus="act:${esc(a.id)}">${esc(a.label)}</button>`
            : `<a class="em-btn" href="${esc(a.href)}" target="_blank" rel="noopener" data-em-focus="act:${esc(a.id)}">${esc(a.label)}</a>`}</div>`).join('')}</div>`;
    if (keepFocus) host.querySelector(`[data-em-focus="${keepFocus}"]`)?.focus();
  }
  const rowField = (key) => (sel.fields || []).find((f) => f.key === key) || null;
  function onClick(e) {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b || !host.contains(b)) return;
    e.stopPropagation();
    const ds = b.dataset;
    if (ds.em === 'done') { onDone?.(); return; }
    if (ds.emStep) {
      const f = rowField(ds.emKey);
      if (!f) return;
      sel.set(f.key, stepValue(f, fieldValue(f, sel.values()), Number(ds.emStep)));
      draw();
      return;
    }
    if (ds.emKeep) { keepText(ds.emKeep); return; }
    // (row 2.145 step 5) "Put back the site default" on one row: the host writes it (site_defaults.js putBackPatch).
    if (ds.emDefault) {
      const f = rowField(ds.emDefault);
      if (f && defaults?.putBack) { try { defaults.putBack(f); } catch (err) { console.error('edit mode: put back', err); } }
      if (!torn) draw();
      return;
    }
    if (ds.emRun) {
      const a = (sel.actions || []).find((x) => x.id === ds.emRun && typeof x.run === 'function');
      try { a?.run(); } catch (err) { console.error('edit mode: action', err); }
      if (!torn) draw();
      return;
    }
    if (ds.emShow) {
      // Show / Hide what is typed in a secret's box (row 2.83). Only the box's type changes: nothing is redrawn or saved.
      const box = host.querySelector(`[data-em-text="${CSS.escape ? CSS.escape(ds.emShow) : ds.emShow}"]`);
      if (!box) return;
      const show = box.type === 'password';
      box.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
      return;
    }
    if (ds.emPick) {
      const f = rowField(ds.emPick);
      const item = f ? fieldItems([f], { values: () => sel.values(), level: 'advanced', onStep: (k, v) => { sel.set(k, v); draw(); } })[0] : null;
      try { item?.run(); } catch (err) { console.error('edit mode: picture', err); }
    }
  }
  function keepText(key) {
    const f = rowField(key);
    const box = host.querySelector(`[data-em-text="${CSS.escape ? CSS.escape(key) : key}"]`);
    if (!f || !box) return;
    const item = fieldItems([f], { values: () => sel.values(), level: 'advanced', onStep: (k, v) => { sel.set(k, v); } })[0];
    if (item?.commit(box.value)) draw();
  }
  // ---- the typed box (row 2.145 step 2): Enter keeps, Escape and leaving put it back ----
  const numBox = (key) => host.querySelector(`[data-em-num="${CSS.escape ? CSS.escape(key) : key}"]`);
  const rowOf = (key) => host.querySelector(`[data-em-row="${CSS.escape ? CSS.escape(key) : key}"]`);
  function putBack(key) {
    const f = rowField(key);
    const box = numBox(key);
    if (!f || !box) return;
    const v = fieldValue(f, sel.values());
    box.value = String(shownNumber(f, v));
    box.removeAttribute('aria-invalid');
    const shown = rowOf(key)?.querySelector('[data-em-value]');
    if (shown) shown.textContent = displayValue(f, v);
  }
  function keepTyped(key) {
    const f = rowField(key);
    const box = numBox(key);
    if (!f || !box) return false;
    const got = parseTyped(f, box.value);
    if (!got.ok) {
      // Refused: nothing written; the box keeps what was typed (to be put right), the row says why.
      box.setAttribute('aria-invalid', 'true');
      const shown = rowOf(key)?.querySelector('[data-em-value]');
      if (shown) shown.textContent = got.why;
      return false;
    }
    let ok = false;
    try { ok = sel.set(f.key, got.value) !== false; } catch (err) { console.error('edit mode: typed', err); }
    if (torn) return ok;
    draw();
    // Still in the box (draw put the focus back): its number chosen, so the next one typed replaces it.
    try { const b = numBox(key); if (b && doc.activeElement === b) b.select(); } catch { /* not focusable here */ }
    return ok;
  }
  function onKey(e) {
    if (e.key === 'Enter' && e.target instanceof Element && e.target.matches('[data-em-text]')) {
      // (note FD 3) In a box of several lines Enter is a new line; Ctrl+Enter keeps it (the ✓ always does).
      if (e.target.tagName === 'TEXTAREA' && !(e.ctrlKey || e.metaKey)) { e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation(); keepText(e.target.dataset.emText);
      return;
    }
    // (row 2.145 step 3) Escape in a words box with typing not yet kept: the box back as it was drawn, used up here.
    if (e.key === 'Escape' && textTyped(e.target)) {
      e.preventDefault(); e.stopPropagation();
      e.target.value = e.target.defaultValue;
      return;
    }
    if (e.target instanceof Element && e.target.matches('[data-em-num]')) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); keepTyped(e.target.dataset.emNum); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); putBack(e.target.dataset.emNum); }
    }
  }
  function onLeave(e) {
    if (torn || !(e.target instanceof Element) || !e.target.matches('[data-em-num]') || !e.target.isConnected) return;
    putBack(e.target.dataset.emNum);
  }
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  host.addEventListener('focusout', onLeave);
  draw();
  return {
    refresh: draw,
    /** (row 2.145 step 2) The typed box's Enter, for a host or a suite: keep what is in `key`'s box. */
    keepTyped,
    destroy() {
      torn = true;
      host.removeEventListener('click', onClick); host.removeEventListener('keydown', onKey); host.removeEventListener('focusout', onLeave);
      host.innerHTML = '';
    },
  };
}

// The look: theme tokens only (theme.js sets them on every page that draws a dashboard). Solid, because a
// question you have to read should not be see-through (Design's rule for dialogs).
// THE RINGS (2026-10-04) are the theme's --focus (3:1 on every surface in every theme, theme.js), not the raw
// --link, which was never measured. Told apart by SHAPE, since they share the hue: the panel being edited is
// DASHED (inside its edge), the things you can choose in it DOTTED, the one chosen SOLID -- on a band of
// --surface filling the gap, because what is around a chosen thing is the module's own picture (a room's wood
// is mixed from --accent), not a surface the ring was measured on.
// THE TYPED BOX (row 2.145 step 2, 2026-10-31): 4.6em wide. FOR: "-180.0" or "100.0" fits at 15px, and with its ‹ and ›
// (44px each) the row's controls stay near 160px, inside the 340px inspector beside the label. AGAINST: a longer number
// (a village's "1600" never shows: it is shown as a percent) scrolls inside the box. Refused, it is marked by SHAPE (a
// dashed edge in the text's own colour) as the rings are, and the row says why in words.
// THE SITE DEFAULT LINE (row 2.145 step 5, 2026-10-31): under its row, across it, in italics -- told from the row's own
// value by shape and by its words, not by a colour -- at .85rem, the editor's own reason line's size (editor.js .se-why).
const CSS_ID = 'em-css';
export function ensureEditCss(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || doc.getElementById(CSS_ID)) return;
  const s = doc.createElement('style');
  s.id = CSS_ID;
  // POINTER-EVENTS ON THE BAR AND THE CARD (row 2.213, 2026-11-05: "Sometimes clicking on it doesn't do anything"). They are
  // put in the panel's box, and when a panel fills its dashboard that box is the kiosk's stage, which lets presses through
  // (pointer-events: none) so the panels under it get them. The bar and the card inherited it: Done and every button on the
  // card were drawn but not pressable, and a press went to the board tile under the card instead. They always take their own.
  s.textContent = `
[data-editing]{outline:3px dashed var(--focus, var(--accent));outline-offset:-3px}
[data-editing] [data-edit-target]{outline:2px dotted var(--focus, var(--accent));outline-offset:2px;cursor:pointer}
[data-editing] [data-edit-selected]{outline:3px solid var(--focus, var(--accent));outline-offset:2px;box-shadow:0 0 0 2px var(--surface)}
.em-bar{position:absolute;left:6px;top:6px;z-index:calc(var(--z-panel-contents,300) + 30);display:flex;gap:6px;align-items:center;
  pointer-events:auto}
.em-card{position:absolute;right:6px;top:58px;bottom:58px;width:min(340px,calc(100% - 12px));overflow:auto;pointer-events:auto;
  z-index:calc(var(--z-panel-contents,300) + 30);background:var(--surface);color:var(--text);
  border:1px solid var(--border);border-radius:12px;box-shadow:0 6px 24px color-mix(in srgb,var(--text) 25%,transparent)}
.em-card[hidden]{display:none}
.em-beta{padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);
  font:700 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif}
.em-btn{min-width:44px;min-height:44px;padding:6px 12px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface-alt,var(--surface));color:var(--text);font:600 15px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}
.em-btn:focus-visible{outline:3px solid var(--focus, var(--accent));outline-offset:2px}
.em-done{background:var(--link);color:var(--on-link);border-color:var(--link)}
.em-opts{padding:10px 12px;font:15px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text)}
.em-head{display:flex;gap:10px;align-items:center;margin:0 0 6px}
.em-title{font-size:1.02rem}
.em-help{margin:0 0 8px;color:var(--text-soft,var(--text));font-size:.9rem}
.em-rows{display:grid;gap:6px}
.em-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;padding:6px 8px;border:1px solid var(--border);border-radius:10px}
.em-l{font-weight:650}
.em-v{grid-column:1;color:var(--text-soft,var(--text));font-size:.9rem}
.em-c{grid-column:2;grid-row:1/span 2;display:flex;gap:4px;align-items:center}
.em-text{min-height:44px;max-width:150px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:inherit}
.em-num{width:4.6em;min-height:44px;box-sizing:border-box;padding:6px 6px;border:1px solid var(--border);border-radius:8px;background:var(--surface);
  color:var(--text);font:600 15px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;text-align:end}
.em-num:focus-visible{outline:3px solid var(--focus, var(--accent));outline-offset:2px}
.em-num[aria-invalid="true"]{border:2px dashed var(--text)}
.em-none{margin:4px 0;color:var(--text-soft,var(--text))}
.em-act{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:8px}
.em-def{grid-column:1/-1;grid-row:3;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;font-size:.85rem;font-style:italic}
.em-act a.em-btn{display:inline-flex;align-items:center;text-decoration:none}
.k-editc{position:absolute;right:calc(56px + var(--k-corner-shift, 0px));bottom:calc(6px + var(--k-corner-lift, 0px));z-index:calc(var(--z-panel-contents,300) + 20);width:44px;height:44px;
  margin:0;padding:0;border-radius:10px;cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--text);
  font:600 20px/1 system-ui,-apple-system,Segoe UI,sans-serif;opacity:0;pointer-events:none;transition:opacity .15s}
${cornerShowCss('.k-editc')}
[data-editing]>.k-editc{opacity:1;pointer-events:auto}
.k-room>.k-editc{right:6px}
.k-barc{position:absolute;right:calc(106px + var(--k-corner-shift, 0px));bottom:calc(6px + var(--k-corner-lift, 0px));z-index:calc(var(--z-panel-contents,300) + 20);width:44px;height:44px;
  margin:0;padding:0;border-radius:10px;cursor:pointer;border:1px solid var(--border);background:var(--surface);color:var(--text);
  font:600 20px/1 system-ui,-apple-system,Segoe UI,sans-serif;opacity:0;pointer-events:none;transition:opacity .15s}
${cornerShowCss('.k-barc')}
@media (prefers-reduced-motion: reduce){.k-editc,.k-barc{transition:none}}`;
  (doc.head || doc.documentElement).append(s);
}

// =====================================================================================================
// THE MODE ITSELF. `recs()` the dashboard's panels (arrangement records), `boxOf(id)` the element a panel
// is drawn in (its cell), `settings()` the dashboard's settings doc as it stands. One panel at a time.
// =====================================================================================================
export function createEditMode({ bus = null, recs = () => [], boxOf = () => null, doc = (typeof document !== 'undefined' ? document : null),
  settings = () => ({}), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t), onChange = () => {} } = {}) {
  let active = null;      // { id, rec, box, targets, chosen, sel, bar, card, view, timer, offs }
  const recOf = (id) => { try { return (recs() || []).find((r) => r && r.id === id) || null; } catch { return null; } };
  const tell = () => { try { onChange(active ? { id: active.id, target: active.chosen } : null); } catch (err) { console.error('edit mode: onChange', err); } };

  function armIdle() {
    if (!active) return;
    if (active.timer != null) clearTimer(active.timer);
    active.timer = null;
    const { idleMs } = editSettingsFrom(settings());
    if (idleMs > 0) { const me = active; active.timer = setTimer(() => { if (active === me) leave('idle'); }, idleMs); }
  }

  // A `whole` target is the panel itself: it is not outlined as a thing in it (the panel already is).
  const elsOf = (t) => [t.el, ...(t.also || [])];
  function markTargets() {
    for (const t of active.targets) if (!t.whole) for (const e of elsOf(t)) e.dataset.editTarget = t.id;
  }
  function unmark(a) {
    for (const t of a.targets || []) {
      for (const e of elsOf(t)) { delete e.dataset.editTarget; delete e.dataset.editSelected; delete e.dataset.editHelp; delete e.dataset.editLabel; }
    }
  }

  // *** THE SITE'S WORDS, FROM THE EDIT CARD (note FC 2, 2026-11-06: Mike, "I still don't see how I'm supposed to edit text"). ***
  // A press on words in a panel that none of its parts claims (a heading, a button's "Start") chooses THOSE WORDS: the card
  // shows them in a box, and keeping new words records a SUGGESTION in the one list the editor's Words already use
  // (wording_edit.js recordChange: kept in this browser, copied for the site's next update; an owner's "Save as the site
  // default" is the editor's), and shows them in place. Nothing is written to the site, the server or anybody's screen.
  // Not words: a clock's time and other live words, boxes people type in, anything without a letter (editor_words.js's rules).
  // "The whole panel" on the card goes back to the panel's own settings, which a press on words used to choose.
  function siteWordsTarget(a, node) {
    let el = null;
    try { el = wordsElementAt(node); } catch { el = null; }
    if (!el || !a.box.contains(el) || el.closest('.em-card, .em-bar, [contenteditable], [data-live-words], [role="timer"], [aria-live]')) return null;
    const old = norm(el.textContent);
    if (!old || !/\p{L}/u.test(old) || old.length > LINE_MAX) return null;
    let shown = old;
    let putBack = null;
    const page = (() => { try { return doc?.defaultView?.location?.pathname || ''; } catch { return ''; } })();
    return {
      id: 'words:site', label: 'These words', el,
      help: 'The site’s own words. New words are kept as a suggestion in this browser and copied for the site’s next update; they show here straight away.',
      fields: [{ key: 'words', label: 'Words', kind: 'text', default: old, maxLength: LINE_MAX }],
      values: () => ({ words: shown }),
      set: (patch) => {
        const now = norm(patch?.words);
        if (!now) return;
        try { recordChange({ page, old, now }); } catch (err) { console.error('edit mode: words', err); }
        try { putBack?.(); } catch { /* gone */ }
        putBack = now === old ? null : showWordsInPlace(el, now);
        shown = now;
      },
      actions: [{ id: 'whole-panel', label: 'The whole panel', run: () => setTimer(() => { if (active === a) select(null); }, 0),
        note: 'Its own settings, instead of these words.' }],
    };
  }

  /** Choose `targetId` (null: the whole panel) and publish it; draw the in-panel card if nobody claims it. */
  function select(targetId = null, pressed = null) {
    if (!active) return null;
    // The targets are found again on each choice: a module redraws (a sign's words change), and a stale
    // element would choose nothing.
    unmark(active);
    active.targets = targetsOf(active.rec);
    markTargets();
    // Nothing named: the panel's `whole` target if it has one (a room's walls and floor), else the panel.
    // (note FC 2, 2026-11-06) ...unless the press was on the site's own words that no part of the panel claims: then those.
    const site = !targetId && pressed && !active.targets.some((x) => !x.whole && x.el?.contains?.(pressed))
      ? siteWordsTarget(active, pressed) : null;
    if (site) active.targets.push(site);
    const t = (site || (targetId ? active.targets.find((x) => x.id === targetId) : active.targets.find((x) => x.whole))) || null;
    active.chosen = t ? t.id : null;
    const sel = selectionFor(active.rec, t, { pressed });
    active.sel = sel;
    // *** A THING WITH HANDLES, CHANGED FROM ITS ROWS (row 2.145, Mike 2026-11-02: "moving an object with the panel's
    // buttons leaves its box and handles behind"). *** The module redraws the thing (the village draws its whole scene
    // again), so the element the handles were drawn on is gone. A drag already chooses it again once the module has
    // redrawn (arrangement.js syncTargetHandles); a press on a row did not. Now a write from the rows finds the targets
    // again and tells the dashboard, which draws the handles on the new element. The card is NOT drawn again: a person
    // stepping a value by switch keeps their place in it.
    // (row 2.184, 2026-11-02) ...and a thing whose module REDRAWS it on every change (`redraws: true`: an AAC board's card,
    // drawn again from the board's draft). Its BUTTONS change it too (move a card, take it out), so they find it again
    // the same way; a thing a button took away is gone, and the panel itself is chosen instead.
    if (t && (t.handles || t.redraws)) {
      const id = t.id;
      const again = () => setTimer(() => {
        if (!active || active.chosen !== id) return;
        unmark(active);
        active.targets = targetsOf(active.rec);
        markTargets();
        const now = active.targets.find((x) => x.id === id);
        if (!now && t.redraws) { select(null); return; }
        if (now && !now.whole && now.el) { now.el.dataset.editSelected = ''; now.el.dataset.editHelp = sel.help; now.el.dataset.editLabel = sel.label; }
        tell();
      }, 0);
      const set = sel.set, patch = sel.patch;
      sel.set = (k, v) => { const ok = set(k, v); if (ok) again(); return ok; };
      sel.patch = (p) => { const ok = patch(p); if (ok) again(); return ok; };
      if (t.redraws) sel.actions = (sel.actions || []).map((a) => (typeof a.run === 'function'
        ? { ...a, run: () => { const r = a.run(); again(); return r; } } : a));
    }
    if (t && !t.whole) {
      t.el.dataset.editSelected = ''; t.el.dataset.editHelp = sel.help; t.el.dataset.editLabel = sel.label;
      for (const e of t.also || []) e.dataset.editSelected = '';
    }
    else if (active.box) { active.box.dataset.editHelp = sel.help; active.box.dataset.editLabel = sel.label; }
    let claimed = false;
    try { bus?.publish?.(EDIT_SELECTED_TOPIC, { ...sel, claim: () => { claimed = true; } }); } catch (err) { console.error('edit mode: publish', err); }
    try { active.view?.destroy(); } catch { /* gone */ }
    active.view = null;
    if (active.card) {
      active.card.hidden = claimed;
      if (!claimed) active.view = renderOptions(active.card, sel, { onDone: () => leave('done') });
    }
    armIdle();
    tell();
    return sel;
  }

  function onPress(e) {
    if (!active) return;
    const node = e.target instanceof Element ? e.target : null;
    // Its own controls, and the corners, work as themselves.
    // (row 2.110: and a room piece's handles, room_handles.js, which drag, scale and turn the chosen piece.)
    if (!node || node.closest('.em-card, .em-bar, .k-promote, .k-editc, .k-barc, .em-handles')) { armIdle(); return; }
    // A panel nested in this one (a module in a room's slot) works as itself (`passThrough`, above).
    const pass = typeof active.rec?.passThrough === 'string' && active.rec.passThrough ? node.closest(active.rec.passThrough) : null;
    if (pass && pass !== active.box && active.box.contains(pass)) { armIdle(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    // Found AGAIN for the press: a module that redrew since the last choice (a room rebuilt by a changed
    // row) has new elements, and the old list would choose nothing.
    const t = targetAt(targetsOf(active.rec), node);
    select(t ? t.id : null, node);
  }
  function onKey(e) {
    if (!active || e.key !== 'Escape') return;
    // (row 2.145 step 2) Escape in a typed number's box puts the box back (renderOptions, above); it does not leave.
    if (e.target instanceof Element && e.target.closest('[data-em-num]')) return;
    // (row 2.145 step 3, 2026-10-31) A WORDS BOX WITH TYPING NOT YET KEPT: Escape puts the box back (renderOptions
    // `textTyped`), and does not leave -- it used to leave, and the typing went with the card. A box with nothing new in
    // it leaves as before.
    if (textTyped(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    leave('escape');
  }

  function enter(id) {
    const rec = recOf(id);
    if (!rec || !doc) return false;
    if (active && active.id === id) return true;
    if (active) leave('another');
    const box = boxOf(id) || rec.el || null;
    if (!box) return false;
    ensureEditCss(doc);
    box.dataset.editing = '1';
    const bar = doc.createElement('div');
    bar.className = 'em-bar';
    bar.innerHTML = `<button type="button" class="em-btn em-done" data-em="leave">Done</button>`;
    bar.querySelector('button').setAttribute('aria-label', `Done editing ${rec.title || rec.type}`);
    // LIVE AND BETA (2026-10-14): a beta module says so while it is being edited, beside Done, and only then.
    try {
      if (stageOf(rec.type) === 'beta') {
        const tag = doc.createElement('span');
        tag.className = 'em-beta';
        tag.dataset.emBeta = '';
        tag.textContent = BETA_WORDS.badge;
        tag.title = BETA_WORDS.detail;
        bar.append(tag);
      }
    } catch { /* the bar without it */ }
    bar.addEventListener('click', (e) => { e.stopPropagation(); leave('done'); });
    const card = doc.createElement('div');
    card.className = 'em-card';
    card.hidden = true;
    box.append(bar, card);
    active = { id, rec, box, targets: [], chosen: null, sel: null, bar, card, view: null, timer: null };
    for (const ev of ['click', 'pointerdown', 'mousedown', 'touchstart']) box.addEventListener(ev, onPress, true);
    doc.addEventListener('keydown', onKey, true);
    select(null);
    return true;
  }

  function leave(reason = 'done') {
    if (!active) return false;
    const a = active;
    active = null;
    if (a.timer != null) clearTimer(a.timer);
    for (const ev of ['click', 'pointerdown', 'mousedown', 'touchstart']) a.box.removeEventListener(ev, onPress, true);
    doc?.removeEventListener('keydown', onKey, true);
    unmark(a);
    delete a.box.dataset.editing; delete a.box.dataset.editHelp; delete a.box.dataset.editLabel;
    try { a.view?.destroy(); } catch { /* gone */ }
    a.bar.remove(); a.card.remove();
    try { bus?.publish?.(EDIT_ENDED_TOPIC, { id: a.id, reason }); } catch (err) { console.error('edit mode: ended', err); }
    tell();
    return true;
  }

  return {
    enter, leave, select,
    toggle: (id) => (active && active.id === id ? leave('toggle') : enter(id)),
    active: () => (active ? { id: active.id, target: active.chosen } : null),
    /** The chosen target itself, as its module listed it (a village piece's `handles`, below arrangement.js), or null. */
    chosenTarget: () => (active && active.chosen ? active.targets.find((t) => t.id === active.chosen) || null : null),
    selection: () => active?.sel || null,
    /** The panel being edited was remounted, swapped or removed: follow it, or leave. */
    refresh() {
      if (!active) return;
      const rec = recOf(active.id);
      if (!rec) { leave('gone'); return; }
      if (rec !== active.rec) { const id = active.id; leave('remounted'); enter(id); }
    },
    destroy() { leave('gone'); },
  };
}
