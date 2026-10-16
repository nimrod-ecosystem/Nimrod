// preset_editor.js - A PRESET IS EDITED WITH THE MODULE'S OWN SETTINGS FORM (row 2.22; Mike 2026-10-14 via chat CB).
//
// Mike: *"Just replace the one on the media page with the one from the Youtube settings."* The Media page's preset
// form was typed lines (`name | HH:MM | HH:MM | playlist`); he uses YouTube's own settings - its boxes, its time
// pickers - and that is the form a preset gets now.
//
// ONE FORM, NOT A COPY OF IT. The real YouTube module is mounted here, bound to the PRESET (a draft of its settings),
// not to a panel: its own settings drawer is the form, its own Add / Use playlist / schedule rows write the draft, and
// nothing plays (a player that plays nothing; no sound registered). So the preset editor and a YouTube panel's settings
// can never drift apart - there is one form. Only the drawer is shown.
//   * NOTHING ON A SCREEN CHANGES while a preset is edited (Code's addition, which chat said fits Mike's ruling): the
//     draft is this page's own until Save, and a screen using the preset picks it up after that, as before.
//   * WHAT A PRESET HOLDS is what a YouTube panel takes from one (youtube.js `effective*`): the playlist, a playlist
//     link, the schedule, shuffle. The drawer's other switches (play the next video when one ends) are a panel's own
//     and are not saved into a preset.

import { mountModule } from './module.js';
import { createBus } from './bus.js';
import './modules/youtube.js';   // registers 'youtube'
import { LINEUP_TYPE, LINEUP_MODULES, OFTEN_LABELS, OFTEN_DEFAULT, DAY_LABELS, cleanEntries, OFTEN as OFTEN_NUMBERS } from './lineup.js';

export const PRESET_KEYS = Object.freeze({
  youtube: Object.freeze(['playlist', 'playlistId', 'schedule', 'shuffle']),
  // A Lineup (row 2.87, lineup.js): its entries, one per line.
  lineup: Object.freeze(['entries']),
});
export const PRESET_EDITOR_TYPES = Object.freeze(Object.keys(PRESET_KEYS));

/** Only what a preset of `type` holds, from a draft. Pure. */
export function presetSettingsFrom(type, draft = {}) {
  const keys = PRESET_KEYS[type] || [];
  const d = draft && typeof draft === 'object' ? draft : {};
  const out = {};
  for (const k of keys) if (k in d) out[k] = d[k];
  return out;
}

// A player that plays nothing: the form needs the module, not a video.
const quietPlayer = () => ({ load() {}, stop() {}, destroy() {}, cueList() {}, pause() {}, resume() {}, setVolume() {} });

/**
 * Mount `type`'s own settings form in `host`, editing `settings` (a preset's, or {} for a new one).
 * Returns { values() -> the preset's settings now, destroy() }. `onChange(values)` after each edit.
 */
// `dashboards` (a Lineup's form): the account's dashboards [{ id, name }], for a dashboard entry's "Shows". It may
// arrive later (`setDashboards` on what this returns).
export function mountPresetEditor(host, { type = 'youtube', settings = {}, onChange = null, user = null, presets = [], dashboards = [] } = {}) {
  if (!host) throw new Error('mountPresetEditor: a host element is required');
  if (!PRESET_KEYS[type]) throw new Error(`mountPresetEditor: no preset form for "${type}"`);
  if (type === LINEUP_TYPE) return mountLineupForm(host, { settings, onChange, presets, dashboards });
  // `directed` + no autoAdvance: the module waits to be told to play, and nobody tells it.
  let draft = { ...presetSettingsFrom(type, settings), directed: true, autoAdvance: false };
  const subs = new Set();
  const state = {
    get: () => draft,
    set: (patch) => {
      draft = { ...draft, ...(patch || {}) };
      for (const f of [...subs]) { try { f(draft); } catch (err) { console.error('preset editor', err); } }
      try { onChange?.(presetSettingsFrom(type, draft)); } catch (err) { console.error('preset editor: onChange', err); }
    },
    subscribe: (f) => { subs.add(f); try { f(draft); } catch (err) { console.error(err); } return () => subs.delete(f); },
    load: async () => draft, flush: async () => {}, startPolling() {}, destroy() { subs.clear(); },
  };
  const events = { append: () => Promise.resolve(), subscribe: () => () => {}, load: async () => [], get: () => [],
    startPolling() {}, destroy() {} };
  host.classList.add('preset-editor');
  const inner = document.createElement('div');
  inner.className = 'preset-editor-module';
  host.replaceChildren(inner);
  const inst = mountModule(type, { mount: inner, bus: createBus(), state, events, user, playerFactory: quietPlayer,
    instanceId: `preset-editor-${type}` });
  inst.init();
  // Only the drawer: open, and without its Close (closing it would leave an empty editor; Cancel is the page's own).
  const drawer = inner.querySelector('[data-settings]');
  if (drawer) drawer.hidden = false;
  inner.querySelector('[data-close]')?.remove();
  inner.querySelector('[data-preset-note]')?.remove();
  // A row for something a preset does not hold would look saved and not be (PRESET_KEYS): "play the next video when
  // one ends" is a panel's own.
  for (const box of inner.querySelectorAll('[data-opt]')) {
    if (!PRESET_KEYS[type].includes(box.getAttribute('data-opt'))) box.closest('label')?.remove();
  }
  ensureStyle(host.ownerDocument || document);
  return {
    values: () => presetSettingsFrom(type, draft),
    destroy: () => { try { inst.destroy(); } catch { /* gone */ } state.destroy(); host.replaceChildren(); host.classList.remove('preset-editor'); },
  };
}

const STYLE_ID = 'preset-editor-style';
function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  // The module's own drawer, laid out as a form on a page: everything else of the module is hidden, and the drawer is
  // in the page's flow rather than over a panel.
  s.textContent = `.preset-editor .youtube{position:static;height:auto;min-height:0;background:none}
.preset-editor .youtube > :not([data-settings]){display:none !important}
.preset-editor .youtube [data-settings]{position:static;inset:auto;max-height:none;overflow:visible;margin:0;box-shadow:none}`;
  doc.head.append(s);
}

// ---- THE LINEUP'S FORM (row 2.87, Stage 1; lineup.js) ----------------------------------------------------------------
// Mike: "do an add module button, so you can add a module to the lineup ... if it's between these hours and a weekday
// play this." One row per entry - which module, which of its presets, which days, from / to (time pickers), how often,
// and for Pictures how long a turn lasts - and "Add module" under them. A row reads as the sentence it is
// (lineup.js `entryWords`); its parts are AND, two rows for one module are OR. Plain controls, so a switch or a
// keyboard reaches every one.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const toTime = (h) => (h == null ? '' : `${pad(Math.floor(h))}:${pad(Math.round((h % 1) * 60))}`);
const fromTime = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m ? Number(m[1]) + Number(m[2]) / 60 : null; };
export const TURN_CHOICES = Object.freeze([
  { value: 0, label: 'the Lineup\'s own setting' }, { value: 60000, label: '1 minute' }, { value: 120000, label: '2 minutes' },
  { value: 300000, label: '5 minutes' }, { value: 600000, label: '10 minutes' },
]);
// (2026-10-16, Mike: turn length "an option per module with your defaults (one video for videos, 2 minutes for
// pictures)") Videos: one video by default, or minutes of videos one after another. Learning keeps its own end.
const VIDEO_TURN_CHOICES = Object.freeze([
  { value: 0, label: 'one video' }, { value: 300000, label: '5 minutes' }, { value: 600000, label: '10 minutes' },
  { value: 1800000, label: '30 minutes' }, { value: 3600000, label: '1 hour' },
]);
// A dashboard: 5 minutes unless the entry says otherwise (modules/director.js DASHBOARD_TURN_MS argues it).
const DASHBOARD_TURN_CHOICES = Object.freeze([
  { value: 0, label: '5 minutes' }, { value: 120000, label: '2 minutes' }, { value: 600000, label: '10 minutes' },
  { value: 1800000, label: '30 minutes' }, { value: 3600000, label: '1 hour' },
]);
export const TURN_CHOICES_FOR = Object.freeze({ pictures: TURN_CHOICES, youtube: VIDEO_TURN_CHOICES, personal: VIDEO_TURN_CHOICES,
  dashboard: DASHBOARD_TURN_CHOICES });

function mountLineupForm(host, { settings = {}, onChange = null, presets = [], dashboards = [] } = {}) {
  let entries = cleanEntries(settings && settings.entries);
  let boards = Array.isArray(dashboards) ? dashboards : [];
  let seq = entries.length;
  const presetsFor = (moduleId) => {
    const m = LINEUP_MODULES.find((x) => x.id === moduleId);
    return m && m.presets ? (presets || []).filter((p) => p && p.type === m.presets) : [];
  };
  const changed = () => { try { onChange?.({ entries: cleanEntries(entries) }); } catch (err) { console.error('lineup form', err); } };
  function rowHtml(e, i) {
    const opts = presetsFor(e.module);
    return `<fieldset class="lu-row" data-entry="${i}">
      <legend>Turn ${i + 1}</legend>
      <label>Module <select data-f="module">${LINEUP_MODULES.map((m) => `<option value="${m.id}"${m.id === e.module ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      ${LINEUP_MODULES.find((m) => m.id === e.module)?.shows ? `<label>Shows <select data-f="show"><option value="">pick a dashboard</option>${boards.filter((b) => b && b.id).map((b) => `<option value="${esc(b.id)}"${b.id === e.show ? ' selected' : ''}>${esc(b.name || 'a dashboard')}</option>`).join('')}${e.show && !boards.some((b) => b && b.id === e.show) ? `<option value="${esc(e.show)}" selected>${boards.length ? 'a dashboard that is gone' : 'the one chosen (loading the list…)'}</option>` : ''}</select></label>` : ''}
      ${opts.length || e.presetId ? `<label>Using <select data-f="presetId"><option value="">its own settings</option>${opts.map((p) => `<option value="${esc(p.id)}"${p.id === e.presetId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
      <span class="lu-days" role="group" aria-label="Days">${DAY_LABELS.map((d, n) => `<label class="lu-day"><input type="checkbox" data-day="${n}"${!e.days.length || e.days.includes(n) ? ' checked' : ''}> ${d}</label>`).join('')}</span>
      <label>From <input type="time" data-f="from" value="${toTime(e.from)}"></label>
      <label>To <input type="time" data-f="to" value="${toTime(e.to)}"></label>
      <label>How often <select data-f="often">${Object.entries(OFTEN_LABELS).map(([k, l]) => `<option value="${k}"${k === e.often ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${TURN_CHOICES_FOR[e.module] ? `<label>Each turn <select data-f="turnMs">${TURN_CHOICES_FOR[e.module].map((c) => `<option value="${c.value}"${c.value === e.turnMs ? ' selected' : ''}>${c.label}</option>`).join('')}</select></label>` : ''}
      <details class="lu-adv"${e.weight ? ' open' : ''}><summary>Advanced</summary>
        <label>How often, as a number <input type="number" min="0" max="100" step="0.5" data-f="weight" value="${e.weight || ''}"
          placeholder="${OFTEN_NUMBERS[e.often] || 3}" style="width:6em"></label>
        <span class="h-quiet">Rarely is 1, Sometimes 3, Often 9. Empty: the word above.</span>
      </details>
      <button type="button" class="h-btn" data-remove-entry>Remove</button>
    </fieldset>`;
  }
  function draw() {
    host.innerHTML = `<div class="lu-form">
      ${entries.length ? entries.map(rowHtml).join('') : '<p class="h-quiet" data-lu-empty>No turns yet. Add a module, then say when it plays.</p>'}
      <p class="h-quiet">Leave From and To empty for all day. A turn plays only on the days ticked, between those times. Turns whose times overlap share the time, by how often.</p>
      <button type="button" class="h-btn" data-add-entry>Add module</button>
    </div>`;
  }
  const at = (el) => Number(el.closest('[data-entry]')?.getAttribute('data-entry'));
  const onInput = (ev) => {
    const t = ev.target;
    const i = at(t);
    if (!Number.isInteger(i) || !entries[i]) return;
    const e = { ...entries[i] };
    if (t.matches('[data-day]')) {
      const ticked = [...host.querySelectorAll(`[data-entry="${i}"] [data-day]`)].filter((b) => b.checked).map((b) => Number(b.getAttribute('data-day')));
      e.days = ticked.length === 7 ? [] : ticked;
    } else {
      const f = t.getAttribute('data-f');
      if (f === 'from' || f === 'to') {
        const h = fromTime(t.value);
        const other = f === 'from' ? fromTime(host.querySelector(`[data-entry="${i}"] [data-f="to"]`)?.value) : fromTime(host.querySelector(`[data-entry="${i}"] [data-f="from"]`)?.value);
        if (h != null && other != null) { e.from = f === 'from' ? h : other; e.to = f === 'to' ? h : other; } else { delete e.from; delete e.to; }
      } else if (f === 'turnMs') e.turnMs = Number(t.value) || 0;
      else if (f) e[f] = t.value;
      if (f === 'module') { e.presetId = ''; e.turnMs = 0; delete e.show; entries[i] = e; draw(); changed(); return; }
    }
    entries[i] = e;
    changed();
  };
  const onClick = (ev) => {
    const b = ev.target.closest('button');
    if (!b || !host.contains(b)) return;
    if (b.matches('[data-add-entry]')) {
      seq += 1;
      entries = [...entries, { id: `e${Date.now().toString(36)}${seq}`, module: 'youtube', presetId: '', days: [], often: OFTEN_DEFAULT, turnMs: 0 }];
      draw(); changed();
      host.querySelector(`[data-entry="${entries.length - 1}"] select`)?.focus?.();
    } else if (b.matches('[data-remove-entry]')) {
      const i = at(b);
      entries = entries.filter((_, n) => n !== i);
      draw(); changed();
    }
  };
  host.classList.add('preset-editor');
  draw();
  host.addEventListener('change', onInput);
  host.addEventListener('click', onClick);
  ensureLineupStyle(host.ownerDocument || document);
  return {
    values: () => ({ entries: cleanEntries(entries) }),
    // The account's dashboards arrived (or changed): the "Shows" lists are drawn again, nothing chosen is lost.
    setDashboards: (list) => { boards = Array.isArray(list) ? list : []; draw(); },
    destroy: () => { host.removeEventListener('change', onInput); host.removeEventListener('click', onClick); host.replaceChildren(); host.classList.remove('preset-editor'); },
  };
}

function ensureLineupStyle(doc) {
  const id = 'preset-editor-lineup-style';
  if (!doc || doc.getElementById(id)) return;
  const s = doc.createElement('style');
  s.id = id;
  s.textContent = `.lu-form{display:flex;flex-direction:column;gap:.6em}
.lu-row{display:flex;flex-wrap:wrap;gap:.5em .9em;align-items:center;border:1px solid var(--border,#888);border-radius:10px;padding:.5em .8em;margin:0}
.lu-row legend{font-weight:700;padding:0 .3em}
.lu-row label{display:inline-flex;gap:.35em;align-items:center}
.lu-days{display:inline-flex;flex-wrap:wrap;gap:.2em .6em}`;
  doc.head.append(s);
}