// user_folders_page.js — THE PAGE WHERE A PERSON POINTS AT THEIR OWN FOLDERS (row 2.49, 2026-10-02).
//
// 867a7ff built the folders (user_folders.js) and what reads them - fonts (user_fonts.js), colour looks
// from .cube files (lut.js), Web Audio Module plugins (wam_loader.js) - and said plainly: "No screen to
// choose any of this yet: tested APIs only." This is that screen. On it a person can:
//   * see each kind of folder and where it is (the Nimrod folder's own subfolder, or one of its own);
//   * choose the Nimrod folder, or a different folder for one kind, through the browser's own folder
//     picker - the same File System Access path the recordings folder (fs_sink.js) uses;
//   * see what is in each: font family names, .cube file names, plugin folder names;
//   * let the browser back in when its permission has lapsed (it asks again after a restart).
//
// *** NOTHING ON THIS PAGE RUNS A PLUGIN. *** It LISTS the plugin folders' names (`listFolders`) and
// whether the WAM host files are there. It never reads a plugin's files, never makes a blob: URL, never
// imports anything. Loading one (`mixer_fx.addWamFromFolder`) is 867a7ff's door and is still only
// reachable from code; this page adds no way to run one. Said on the page too, in words.
//
// *** NOTHING IS UPLOADED. *** Folder handles stay in this browser (fs_sink's IndexedDB); names are read
// from the folder on this device. No request is made by anything here.
//
// *** WHY THIS PAGE HANDS NO MOVES TO THE MENU (settings.js openPage), argued. *** Every action here
// ends in a dialog the BROWSER draws - the folder picker, the permission prompt - which a switch cannot
// answer. A switch walking these buttons would reach a press that opens something it cannot leave
// except by the dialog's own Cancel. So with one switch, `select` on this page does what it does on any
// page with no moves of its own: it goes Back. A keyboard and a pointer reach every button (Tab, click).
// This is the settings_fields.js header's own narrowing: the one-button rule binds what the person at
// the screen uses, not the set-up a helper does with a mouse.
//
// *** AND WHAT IS FOUND CAN BE CHOSEN (2026-10-02). *** Until today the fonts loaded and nothing chose
// one (`chooseUserFont` had no caller), and nothing set a .cube as the grade. Now:
//   * "Font on this device": the theme's own (the default), then every family loaded from the fonts
//     folder. Stored by family name, per device (user_fonts.js), and applied at once (theme.js
//     `refreshUserFont`). A family not loaded here shows the theme's font behind it - never blank.
//   * "Colour look": None (the default) and each .cube found, then a switch for each place it applies
//     (photos, video, wallpaper). The device-level grade lut.js already reads; a change shows on what is
//     on screen at once (`refreshGrade`); a look whose file is gone goes back to None, quietly.
//   * Fonts load as soon as the page opens and after any folder change here - not at the next start.
// These two rows are ordinary choices with no browser dialog behind them, so unlike the folder buttons
// they COULD be walked by a switch; they are still on this pointer page because that is where the files
// they choose from are shown. A long list opens the choice picker (more than five, settings_fields.js
// `opensPicker`, with the person's "How you choose things"); a short one steps, as everywhere.
//
// Everything is injectable (`view` for the picker, `store` for remembered handles, `storage`/`fontSet`
// for the choices), so the suite drives it against in-memory folders with no prompt.

import {
  FOLDER_KINDS, SUBFOLDERS, ROOT_KEY, ROOT_MODE, available, handleStore, permissionOf, allowAgain,
  pickRoot, pickKindFolder, useRootFor, forgetRoot, kindFolder, listFiles, listFolders, checkDeviceLook,
} from './user_folders.js';
import { FONT_EXTS, faceFromName, chosenUserFont, chooseUserFont, userFontOptions, loadDeviceFonts } from './user_fonts.js';
// CHOOSING (2026-10-02): the device's font and its colour look, on this page, through the menu's own
// field machinery and choice picker - one engine for every choice in the product.
import { readGrade, gradeFromFile, clearGrade, setGradeTarget, refreshGrade, describeFit, GRADE_TARGETS,
  FIRST_LOOK_TARGETS } from './lut.js';
import { normalizeField, fieldItems, fieldValue, stepValue, opensPicker, chooseModeOf, DEFAULT_CHOOSE_MODE } from './settings_fields.js';
import { openChoiceDialog } from './choice_picker.js';
import { themeFont, refreshUserFont } from './theme.js';
// The folder name only - a constant. wam_loader.js's top level defines functions and runs nothing.
import { SDK_FOLDER } from './wam_loader.js';

export const USER_FOLDERS_PAGE = 'user-folders';

/** The menu row that opens the page: `{ kind: 'item', page }`, the shape every host's `extras` takes. */
// (Not frozen: a host may tag its rows - kiosk.js's `tagged` - and the menu treats rows as its own.)
export const USER_FOLDER_ITEMS = [
  { kind: 'item', id: USER_FOLDERS_PAGE, label: 'Your own folders',
    hint: 'fonts, colour looks and audio plugins on this device', page: USER_FOLDERS_PAGE },
];

// The words for each kind. `none` is what an empty folder says (what to put in it).
export const KIND_WORDS = Object.freeze({
  fonts: Object.freeze({ title: 'Fonts', what: 'fonts',
    none: 'No font files in it yet (.woff2, .woff, .ttf or .otf).' }),
  luts: Object.freeze({ title: 'Colour looks (LUTs)', what: 'colour looks',
    none: 'No colour look files in it yet (.cube).' }),
  plugins: Object.freeze({ title: 'Audio plugins (Web Audio Modules)', what: 'audio plugins',
    none: 'No plugin folders in it yet (one folder per plugin).' }),
});

const PERMISSION_WORDS = Object.freeze({
  granted: '',
  prompt: 'The browser needs your permission again (it asks after a restart).',
  denied: 'The browser was refused permission. Allow it again, or choose the folder again.',
  unknown: 'This browser did not say whether it may read the folder.',
  none: '',
});

/** A sentence for a permission state ('' when there is nothing to say). */
export function permissionWords(p) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_WORDS, p) ? PERMISSION_WORDS[p] : PERMISSION_WORDS.unknown;
}

/**
 * What is in one kind's folder, by NAME only. Resolves `{ items: [{ name, detail }], sdk? }`.
 *   fonts    one item per family (from the file names, as user_fonts.js names them), with its file count;
 *   luts     one item per .cube file;
 *   plugins  one item per plugin folder (the host files' folder is not a plugin: `sdk` says if it is there).
 * Never reads a file's contents, never throws (an unreadable folder is an empty list).
 */
export async function scanFolder(kind, dir) {
  try {
    if (!dir) return { items: [] };
    if (kind === 'fonts') {
      const fam = new Map();
      for (const { name } of await listFiles(dir, FONT_EXTS)) {
        const { family } = faceFromName(name);
        if (family) fam.set(family, (fam.get(family) || 0) + 1);
      }
      return { items: [...fam].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, n]) => ({ name, detail: n === 1 ? '1 file' : `${n} files` })) };
    }
    if (kind === 'luts') {
      return { items: (await listFiles(dir, ['cube'])).map(({ name }) => ({ name, detail: '' })) };
    }
    if (kind === 'plugins') {
      const folders = await listFolders(dir);
      return { sdk: folders.some((f) => f.name === SDK_FOLDER),
        items: folders.filter((f) => f.name !== SDK_FOLDER).map(({ name }) => ({ name, detail: '' })) };
    }
  } catch { /* an unreadable folder lists nothing */ }
  return { items: [] };
}

// ---------------------------------------------------------------------------------------------
// THE TWO CHOICES (2026-10-02). Their options come from what is on this device; their values from the
// device-level stores user_fonts.js and lut.js already read. Pure, from a reading.
// ---------------------------------------------------------------------------------------------
export const THEME_FONT = '';          // the "theme's own" option: no user font in front
export const NO_LOOK = '';
const KEPT_LOOK = '\u0000kept';         // a look in force whose file cannot be listed right now
export const TARGET_WORDS = Object.freeze({ photos: 'Look on photos', video: 'Look on videos', wallpaper: 'Look on the wallpaper' });

/**
 * `{ font: { value, options, failed }, look: { value, options, grade, fit } }`. `lutFiles` are the .cube
 * names in a looks folder that could be read, or null when none could.
 */
export function deviceChoices({ storage, fontSet, lutFiles = null, fontsFailed = [] } = {}) {
  // What "the theme's own" previews as: the theme's font WITHOUT the user's in front of it.
  const base = themeFont() || 'system-ui, sans-serif';
  const current = chosenUserFont(storage);
  const font = {
    value: current,
    options: [{ value: THEME_FONT, label: 'The theme’s own', font: base, hint: 'the default' },
      ...userFontOptions({ fontSet, current, fallback: base })],
    failed: Array.isArray(fontsFailed) ? fontsFailed : [],
  };
  const grade = readGrade(storage);
  const files = Array.isArray(lutFiles) ? lutFiles : [];
  const options = [{ value: NO_LOOK, label: 'None', hint: 'colours as they are (the default)' },
    ...files.map((f) => ({ value: f, label: f.replace(/\.cube$/i, ''), hint: f }))];
  let value = NO_LOOK;
  if (grade) {
    value = grade.file && files.includes(grade.file) ? grade.file : (grade.file || KEPT_LOOK);
    if (!files.includes(value)) {
      options.push({ value, label: grade.name || grade.file || 'The look in use',
        hint: 'kept from before: allow the folder again to change it' });
    }
  }
  return { font, look: { value, options, grade, fit: grade ? describeFit(grade.compiled) : '' } };
}

/** The choices as the menu's own fields (settings_fields.js): a row each, and the switches under a look. */
export function choiceFields(c) {
  const out = [];
  if (!c) return out;
  if (c.font.options.length > 1) {
    out.push(normalizeField({ key: 'font', label: 'Font on this device', kind: 'choice', level: 'essential',
      default: THEME_FONT, options: c.font.options }));
  }
  if (c.look.options.length > 1) {
    out.push(normalizeField({ key: 'look', label: 'Colour look', kind: 'choice', level: 'essential',
      default: NO_LOOK, options: c.look.options }));
  }
  if (c.look.grade) {
    for (const t of GRADE_TARGETS) {
      out.push(normalizeField({ key: `look:${t}`, label: TARGET_WORDS[t] || t, kind: 'toggle', level: 'essential', default: false }));
    }
  }
  return out.filter(Boolean);
}
const choiceValues = (c) => ({ font: c.font.value, look: c.look.value,
  ...Object.fromEntries(GRADE_TARGETS.map((t) => [`look:${t}`, !!c.look.grade?.targets?.[t]])) });
const choiceItems = (c) => fieldItems(choiceFields(c), { values: () => choiceValues(c), level: 'advanced', idPrefix: 'uf:' });

/**
 * Everything the page shows, read without prompting:
 * `{ available, root: { chosen, name, permission }, kinds: [ kindFolder(...) + { found } ], choices }`.
 */
export async function readUserFolders({ view = (typeof window !== 'undefined' ? window : null), store = handleStore(), names = SUBFOLDERS,
  storage, fontSet, fontsFailed = [] } = {}) {
  let rootHandle = null;
  try { rootHandle = await store.get(ROOT_KEY); } catch { rootHandle = null; }
  const root = { chosen: !!rootHandle, name: rootHandle ? String(rootHandle.name || '') : '',
    permission: await permissionOf(rootHandle, ROOT_MODE), handle: rootHandle };
  const kinds = [];
  for (const kind of FOLDER_KINDS) {
    const k = await kindFolder(kind, { store, names });
    kinds.push({ ...k, found: k.dir ? await scanFolder(kind, k.dir) : null });
  }
  const luts = kinds.find((k) => k.kind === 'luts');
  const choices = deviceChoices({ storage, fontSet, fontsFailed,
    lutFiles: luts && luts.found ? luts.found.items.map((it) => it.name) : null });
  return { available: available(view), root, kinds, choices };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Paragraph text in the menu's own muted style (modules/settings.js does the same).
const say = (text, attrs = '') => (text ? `<p class="st-hint" style="display:block;margin:0 0 8px" ${attrs}>${esc(text)}</p>` : '');
const button = (act, label, hint = '', kind = '') => `<button class="st-item" type="button" data-act="${act}"${kind ? ` data-kind="${kind}"` : ''}>
    <span class="st-label">${esc(label)}</span>${hint ? `<span class="st-hint">${esc(hint)}</span>` : ''}</button>`;

// A choice row, drawn like every other menu row. It says when a press opens a list.
function fieldButton(it, mode) {
  const opens = !!(it.choice && opensPicker(it.field, { mode }));
  return `<button class="st-item${opens ? ' st-opens' : ''}" type="button" data-act="set" data-key="${esc(it.key)}"${it.disabled ? ' disabled' : ''}${
    opens ? ' aria-haspopup="dialog"' : ''}>
    <span class="st-label">${esc(it.label)}</span>${it.hint ? `<span class="st-hint">${esc(it.hint)}</span>` : ''}</button>`;
}
function fontChoiceHtml(c, items, mode) {
  const out = [];
  const row = items.find((it) => it.key === 'font');
  out.push(row ? fieldButton(row, mode) : say('No fonts loaded on this device yet, so the theme’s own font is used.', 'data-uf-font-none'));
  if (c.font.failed.length) {
    out.push(say(`Not usable: ${c.font.failed.map((f) => (f.name ? `${f.name} (${f.why})` : f.why)).join('; ')}.`, 'data-uf-font-failed'));
  }
  return out.join('\n');
}
function lookChoiceHtml(c, items, mode) {
  const out = [];
  const row = items.find((it) => it.key === 'look');
  if (row) out.push(fieldButton(row, mode));
  if (c.look.grade) {
    out.push(say(c.look.fit, 'data-uf-look-fit'));
    for (const it of items) if (it.key.startsWith('look:')) out.push(fieldButton(it, mode));
  }
  return out.join('\n');
}

/** The page's markup for a `readUserFolders` reading. Pure. */
export function userFoldersHtml(s) {
  const parts = [];
  const items = s.choices ? choiceItems(s.choices) : [];
  parts.push(say('Files in these folders are read on this device and never uploaded. Everything here is off until somebody chooses it.'));
  if (!s.available) {
    parts.push(say('This browser cannot open a folder you choose (Chrome and Edge can; Firefox and Safari cannot yet).', 'data-uf-unavailable'));
  }
  // --- the root ---
  parts.push('<div class="st-head" data-uf-section="root">Your Nimrod folder</div>');
  if (!s.root.chosen) {
    parts.push(say(`Not chosen. Choosing one makes ${Object.values(SUBFOLDERS).join(', ')} folders inside it, each with a short note saying what goes in it.`, 'data-uf-root-state'));
  } else {
    parts.push(say([`Using “${s.root.name}”.`, permissionWords(s.root.permission)].filter(Boolean).join(' '), 'data-uf-root-state'));
  }
  if (s.available) parts.push(button('pick-root', s.root.chosen ? 'Choose a different Nimrod folder…' : 'Choose your Nimrod folder…'));
  if (s.root.chosen && s.root.permission !== 'granted') parts.push(button('allow-root', 'Allow it again', 'the browser asks'));
  if (s.root.chosen) parts.push(button('forget-root', 'Stop using it on this device', 'the folder and its files stay where they are'));
  // --- each kind ---
  for (const k of s.kinds) {
    const w = KIND_WORDS[k.kind] || { title: k.kind, what: k.kind, none: '' };
    parts.push(`<div class="st-head" data-uf-section="${esc(k.kind)}">${esc(w.title)}</div>`);
    let where;
    if (k.source === 'own') where = `From its own folder, “${k.name}”.`;
    else if (k.source === 'root') where = `From your Nimrod folder: “${k.name}”.`;
    else where = 'No folder yet: choose your Nimrod folder above, or a folder just for these.';
    parts.push(say([where, k.source !== 'none' ? permissionWords(k.permission) : ''].filter(Boolean).join(' '), `data-uf-where="${esc(k.kind)}"`));
    let found;
    if (k.found) {
      found = k.found.items.length
        ? `Found: ${k.found.items.map((it) => (it.detail ? `${it.name} (${it.detail})` : it.name)).join(', ')}.`
        : w.none;
    } else if (k.missing) {
      found = `The “${SUBFOLDERS[k.kind] || k.kind}” folder is not in your Nimrod folder any more. Choosing the Nimrod folder again makes it.`;
    } else if (k.source !== 'none') {
      found = 'Allow the folder again to see what is in it.';
    } else found = '';
    parts.push(say(found, `data-uf-found="${esc(k.kind)}"`));
    if (s.choices && k.kind === 'fonts') parts.push(fontChoiceHtml(s.choices, items, s.mode));
    if (s.choices && k.kind === 'luts') parts.push(lookChoiceHtml(s.choices, items, s.mode));
    if (k.kind === 'plugins') {
      if (k.found) {
        parts.push(say(k.found.sdk ? `The WAM host files (${SDK_FOLDER}) are there.`
          : `The WAM host files are missing: plugins need the @webaudiomodules/sdk package's files in a folder named ${SDK_FOLDER} here. Nothing is downloaded.`, 'data-uf-sdk'));
      }
      parts.push(say('Listed only: nothing on this page runs a plugin. A plugin is a program, so only add ones you trust.', 'data-uf-plugins-note'));
    }
    if (s.available) parts.push(button('pick-kind', `Choose a different folder for ${w.what}…`, '', k.kind));
    if (k.source === 'own') {
      if (k.permission !== 'granted') parts.push(button('allow-kind', 'Allow it again', 'the browser asks', k.kind));
      parts.push(button('use-root', 'Use the one in your Nimrod folder', s.root.chosen ? '' : 'none chosen yet', k.kind));
    }
  }
  parts.push('<p class="st-hint" style="display:block;margin:8px 0 0" role="status" data-uf-msg></p>');
  return parts.join('\n');
}

/**
 * Draw the page into `el` and wire its buttons. Resolves nothing; returns `{ ready, refresh, destroy }`
 * (`ready` settles after the first drawing). `onChange` hears every change a press made.
 */
export function renderUserFolders(el, { view = (typeof window !== 'undefined' ? window : null), store = handleStore(),
  names = SUBFOLDERS, onChange = null,
  // The choices (2026-10-02): where they are stored (default: this browser), the font set and FontFace
  // fonts load into (default: the page's), how the person chooses ('point' | 'step', or a function read
  // at each press), and the list the picker opens in (default: the choice picker as a dialog).
  storage, fontSet, FontFaceImpl, chooseMode = DEFAULT_CHOOSE_MODE, openDialog = openChoiceDialog } = {}) {
  let torn = false;
  let last = null;
  let message = '';
  let fontsFailed = [];
  const modeNow = () => {
    try { return chooseModeOf(typeof chooseMode === 'function' ? chooseMode() : chooseMode); } catch { return DEFAULT_CHOOSE_MODE; }
  };
  // `load`: read the folders' fonts into the page and put a look whose file is gone back to None, before
  // drawing - on opening, after a folder changes, and on `refresh`. A choice redraws without it.
  const draw = async ({ load = true } = {}) => {
    if (load) {
      try { fontsFailed = (await loadDeviceFonts({ store, FontFaceImpl, fontSet })).failed || []; } catch { fontsFailed = []; }
      try { await checkDeviceLook({ store, storage, names }); } catch { /* the look stays as it was */ }
    }
    const s = await readUserFolders({ view, store, names, storage, fontSet, fontsFailed });
    if (torn) return s;
    s.mode = modeNow();
    last = s;
    el.innerHTML = userFoldersHtml(s);
    const m = el.querySelector('[data-uf-msg]');
    if (m) m.textContent = message;
    return s;
  };
  const tellHost = (action, kind = null) => { try { onChange?.({ action, kind }); } catch { /* a listener's fault is its own */ } };

  // The looks folder's files by name, read when one is chosen (never prompts).
  async function lookHandles() {
    try {
      const k = await kindFolder('luts', { store, names });
      return new Map(k.dir ? (await listFiles(k.dir, ['cube'])).map((f) => [f.name, f.handle]) : []);
    } catch { return new Map(); }
  }

  // A LOOK CHOSEN. A file that cannot be read leaves the look as it was and says why. STEPPING (a press,
  // not the list) moves on past such a file to the next one that can be read, so one broken file can
  // never be a wall a switch cannot get past; it stops where it started, or at None.
  async function chooseLook(value, { field = null, stepping = false } = {}) {
    const prev = readGrade(storage);
    const start = last?.choices?.look?.value ?? NO_LOOK;
    const handles = await lookHandles();
    const targets = prev ? prev.targets : FIRST_LOOK_TARGETS;
    const skipped = [];
    let v = value;
    const most = Math.max(1, field?.options?.length || 1);
    for (let i = 0; i < most; i++) {
      if (v === NO_LOOK) { clearGrade(storage); break; }
      if (v === KEPT_LOOK || (prev && v === prev.file && !handles.has(v))) break;   // the kept one: nothing to read
      const h = handles.get(v);
      const r = h ? await gradeFromFile(h, storage, { targets }) : { ok: false, why: 'it is not in the folder any more' };
      if (r.ok) break;
      skipped.push({ name: v, why: r.why });
      if (!stepping || !field) break;
      v = stepValue(field, v, 1);
      if (v === start) break;
    }
    refreshGrade({ storage });
    if (skipped.length) {
      message = skipped.map((x) => `${x.name} could not be read (${x.why})${stepping ? ', so it was skipped' : ''}.`).join(' ')
        + (stepping ? '' : ' The colour look is as it was.');
    }
  }

  // ONE WRITE PATH for the choices, whether a press stepped them or the list chose.
  async function choose(key, value, { field = null, stepping = false } = {}) {
    message = '';
    try {
      if (key === 'font') {
        chooseUserFont(value || THEME_FONT, storage);
        refreshUserFont({ storage });
        tellHost('font');
      } else if (key === 'look') {
        await chooseLook(value, { field, stepping });
        tellHost('look');
      } else if (key.startsWith('look:')) {
        const t = key.slice(5);
        setGradeTarget(t, !!value, storage);
        refreshGrade({ storage });
        tellHost('look-target', t);
      }
    } catch (err) { message = `That did not work: ${String((err && err.message) || err)}`; }
    if (!torn) await draw({ load: false });
  }

  // A press on a choice row: a long list OPENS the picker (unless the person steps); otherwise it steps.
  function press(key) {
    if (!last?.choices) return;
    const it = choiceItems(last.choices).find((x) => x.key === key);
    if (!it || it.disabled) return;
    if (it.choice && opensPicker(it.field, { mode: modeNow() })) {
      try {
        openDialog({ ...it.choice, onPick: (v) => { choose(key, v, { field: it.field }); } });
      } catch (err) { message = `That did not work: ${String((err && err.message) || err)}`; draw({ load: false }); }
      return;
    }
    const now = fieldValue(it.field, choiceValues(last.choices));
    choose(key, stepValue(it.field, now, 1), { field: it.field, stepping: true });
  }
  const tell = (text) => { message = text || ''; const m = el.querySelector('[data-uf-msg]'); if (m) m.textContent = message; };
  // A cancelled picker is not an error: somebody changed their mind.
  const failed = (err) => (err && err.name === 'AbortError' ? '' : `That did not work: ${String((err && err.message) || err)}`);

  async function act(name, kind) {
    if (name === 'set') { press(kind); return; }
    message = '';
    try {
      if (name === 'pick-root') {
        const { made } = await pickRoot({ view, store, names });
        message = made.length ? `Made ${made.join(', ')} in it.` : '';
      } else if (name === 'allow-root') {
        const p = await allowAgain(last?.root?.handle, ROOT_MODE);
        message = p === 'granted' ? '' : permissionWords(p);
      } else if (name === 'forget-root') {
        await forgetRoot({ store });
      } else if (name === 'pick-kind') {
        await pickKindFolder(kind, { view, store });
      } else if (name === 'allow-kind') {
        const k = last?.kinds?.find((x) => x.kind === kind);
        const p = await allowAgain(k?.holder, k?.mode);
        message = p === 'granted' ? '' : permissionWords(p);
      } else if (name === 'use-root') {
        await useRootFor(kind, { store });
      } else return;
      try { onChange?.({ action: name, kind: kind || null }); } catch { /* a listener's fault is its own */ }
    } catch (err) { message = failed(err); }
    if (!torn) await draw();
  }

  // ONE listener for the life of the page; the buttons are redrawn under it.
  const onClick = (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !el.contains(b) || b.disabled) return;
    act(b.dataset.act, b.dataset.act === 'set' ? (b.dataset.key || '') : (b.dataset.kind || ''));
  };
  el.addEventListener('click', onClick);
  el.innerHTML = say('Looking at this device’s folders…');
  const ready = draw().catch((err) => { if (!torn) { el.innerHTML = say(failed(err) || 'Could not read the folders.'); } return null; });
  return {
    ready,
    refresh: draw,
    act,
    tell,
    destroy() { torn = true; el.removeEventListener('click', onClick); },
  };
}

/** Ready to hand to a settings menu's `pages`, the same shape connections.js / controls_view.js return. */
export function userFoldersPage(opts = {}) {
  return {
    title: 'Your own folders',
    // No moves are handed back (see the header): with one switch, select on this page is Back.
    render(el) { renderUserFolders(el, opts); },
  };
}
