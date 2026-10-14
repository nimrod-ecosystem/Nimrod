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

export const PRESET_KEYS = Object.freeze({ youtube: Object.freeze(['playlist', 'playlistId', 'schedule', 'shuffle']) });
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
export function mountPresetEditor(host, { type = 'youtube', settings = {}, onChange = null, user = null } = {}) {
  if (!host) throw new Error('mountPresetEditor: a host element is required');
  if (!PRESET_KEYS[type]) throw new Error(`mountPresetEditor: no preset form for "${type}"`);
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
