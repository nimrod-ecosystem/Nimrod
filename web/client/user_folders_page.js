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
// they CAN be walked by a switch - and they are, in the kiosk's menu (2026-10-02, `createDeviceLookRows`
// below: "Settings for: This device"), on the same storage and the same write path. They stay on this
// pointer page too because that is where the files they choose from are shown. A long list opens the
// choice picker (more than five, settings_fields.js `opensPicker`, with the person's "How you choose
// things"); a short one steps, as everywhere.
//
// Everything is injectable (`view` for the picker, `store` for remembered handles, `storage`/`fontSet`
// for the choices), so the suite drives it against in-memory folders with no prompt.
//
// *** "SET UP YOUR NIMROD FOLDER" (2026-10-04). *** Mike: *"giving them an empty folder tree to download and
// then they can set the root once in the site and everything else could autopopulate the folder location ...
// Would that mean duplicate copies of their pictures?"* No zip: the page makes the tree itself, inside a folder
// the person chooses or makes (`setUpRoot`), and running it again only adds what is missing. And no copies,
// said on the page: Pictures, Music and Videos are POINTERS - the Nimrod folder's own subfolder, or "point at the
// folder your photos are already in" (the per-kind override, now shown on every kind) - and "Connect it for
// photos" keeps that folder as a media source (folder_source.js `addFolderSource`), a handle, never a copy.
//   WHERE TO SAVE THINGS: each kind shows its place. A browser never tells a page a folder's real path, so the
// place reads "<your Nimrod folder>/Voice model" unless the person types the root's full path once (kept on
// this device only, user_folders.js `saveRootPath`); then it is a full path. "Copy" copies a sentence saying
// what to save where; "Copy the path" (only with a full path) copies the path alone, for a Save dialog.
//
// *** ARTWORK AND DATA (2026-10-07, rows 2.64 and 2.62). *** Two more kinds (user_folders.js argues them). The Artwork
// section carries "Make your own artwork": the art kit's kinds in one line each, "Copy the art kit", and the checker -
// "Check pictures…", "Check a folder…" (the browser's own file inputs, so every browser) and "Check the Artwork
// folder". Results are plain sentences per file (art_check.js), shown on this page only and kept nowhere. Artwork can
// be "Connected for pictures" like Pictures can for photos, so every picture chooser browses it.

import {
  FOLDER_KINDS, SUBFOLDERS, ROOT_KEY, ROOT_MODE, POINTER_KINDS, available, handleStore, permissionOf, allowAgain,
  pickRoot, setUpRoot, pickKindFolder, useRootFor, forgetRoot, kindFolder, listFiles, listFolders, checkDeviceLook,
  readRootPath, saveRootPath, joinPath, pathMatchesRoot, lastName,
} from './user_folders.js';
import { kindOf, addFolderSource, findFolderSource } from './folder_source.js';
import { checkModelFiles } from './voice_model.js';
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
// The art kit and its checker (2026-10-07, row 2.64): the Artwork section.
import { ART_KINDS, ART_FOLDER, artKitText, shapeWords, typesWords } from './art_kit.js';
import { checkArtFiles, checkArtFolder, summaryWords, verdictWords } from './art_check.js';

export const USER_FOLDERS_PAGE = 'user-folders';

/** The menu row that opens the page: `{ kind: 'item', page }`, the shape every host's `extras` takes. */
// (Not frozen: a host may tag its rows - kiosk.js's `tagged` - and the menu treats rows as its own.)
export const USER_FOLDER_ITEMS = [
  { kind: 'item', id: USER_FOLDERS_PAGE, label: 'Your own folders',
    hint: 'your Nimrod folder: pictures, music, fonts, voice model and more, on this device', page: USER_FOLDERS_PAGE },
];

// The words for each kind. `none` is what an empty folder says (what to put in it).
export const KIND_WORDS = Object.freeze({
  pictures: Object.freeze({ title: 'Pictures', what: 'pictures', noun: ['picture', 'pictures'],
    none: 'No pictures directly in it yet.' }),
  music: Object.freeze({ title: 'Music', what: 'music', noun: ['music file', 'music files'],
    none: 'No music files directly in it yet.' }),
  videos: Object.freeze({ title: 'Videos', what: 'videos', noun: ['video', 'videos'],
    none: 'No videos directly in it yet.' }),
  voice: Object.freeze({ title: 'Voice model', what: 'the voice model',
    none: 'No voice model in it yet. You only have one after step 4 (convert) of “Your own voice model” in Voice recordings.' }),
  recordings: Object.freeze({ title: 'Recordings', what: 'recordings', noun: ['item', 'items'],
    none: 'Nothing saved in it yet.' }),
  // 2026-10-07 (rows 2.64, 2.62).
  artwork: Object.freeze({ title: 'Artwork', what: 'pictures you make for Nimrod', noun: ['picture', 'pictures'],
    none: 'No pictures in it yet. The art kit below says what you can make, and which folder each goes in.' }),
  data: Object.freeze({ title: 'Data', what: 'your own Nimrod data', noun: ['file', 'files'],
    none: 'Nothing kept in it yet.' }),
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
    // Pictures, music, videos (2026-10-04): how many of that kind sit directly in it, and how many folders.
    // Names only, one level: a photo library of thousands is counted, never opened.
    const media = { pictures: 'image', music: 'audio', videos: 'video' }[kind];
    if (media) {
      let count = 0;
      let folders = 0;
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.')) continue;
        if (entry.kind === 'directory') folders += 1;
        else if (kindOf(name) === media) count += 1;
      }
      return { items: [], count, folders };
    }
    if (kind === 'voice') {
      const names = [];
      for await (const [name] of dir.entries()) names.push(String(name));
      return { items: [], voice: checkModelFiles(names), names };
    }
    if (kind === 'artwork') {
      // The pictures in each kind's folder (one level down), and any loose in Artwork itself. Names only.
      const isPic = (n) => kindOf(n) === 'image' || /\.svg$/i.test(n);
      let count = 0;
      const per = [];
      for await (const [name, entry] of dir.entries()) {
        if (name.startsWith('.')) continue;
        if (entry.kind === 'directory') {
          let n = 0;
          try { for await (const [inner, e2] of entry.entries()) if (e2.kind !== 'directory' && !inner.startsWith('.') && isPic(inner)) n += 1; } catch { /* unreadable: 0 */ }
          per.push({ folder: String(name), count: n });
          count += n;
        } else if (isPic(name)) { count += 1; per.push({ folder: '', count: 1 }); }
      }
      return { items: [], count, art: per.filter((p) => p.count).reduce((acc, p) => {
        const hit = acc.find((x) => x.folder === p.folder);
        if (hit) hit.count += p.count; else acc.push({ ...p });
        return acc;
      }, []) };
    }
    if (kind === 'recordings' || kind === 'data') {
      let count = 0;
      let exported = false;
      for await (const [name] of dir.entries()) {
        if (name.startsWith('.') || name === 'README.txt') continue;
        if (name === 'nimrod-export.json') exported = true;
        count += 1;
      }
      return { items: [], count, exported };
    }
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

// ---------------------------------------------------------------------------------------------
// ONE WRITE PATH for the two choices, whether this page or the menu's rows (below) made it, and whether
// a press stepped them or the list chose.
// ---------------------------------------------------------------------------------------------
// The looks folder's files by name, read when one is chosen (never prompts).
async function lookHandlesIn({ store, names }) {
  try {
    const k = await kindFolder('luts', { store, names });
    return new Map(k.dir ? (await listFiles(k.dir, ['cube'])).map((f) => [f.name, f.handle]) : []);
  } catch { return new Map(); }
}

// A LOOK CHOSEN. A file that cannot be read leaves the look as it was and says why. STEPPING (a press,
// not the list) moves on past such a file to the next one that can be read, so one broken file can
// never be a wall a switch cannot get past; it stops where it started (`start`), or at None.
// Resolves the sentence to show ('' when there is nothing to say).
async function chooseLookValue(value, { storage, store, names, field = null, stepping = false, start = NO_LOOK }) {
  const prev = readGrade(storage);
  const handles = await lookHandlesIn({ store, names });
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
  if (!skipped.length) return '';
  return skipped.map((x) => `${x.name} could not be read (${x.why})${stepping ? ', so it was skipped' : ''}.`).join(' ')
    + (stepping ? '' : ' The colour look is as it was.');
}

/**
 * Write one of the device's choices and apply it at once: `font` (a family, or THEME_FONT for the
 * theme's own), `look` (a .cube file's name, or NO_LOOK) or `look:<target>` (true / false). Never throws.
 * Resolves `{ action, kind, message }`: `action` is 'font' | 'look' | 'look-target' (null when nothing
 * was written), `kind` the target, `message` a sentence to show ('' when there is nothing to say).
 */
export async function applyDeviceChoice(key, value, { storage, store = handleStore(), names = SUBFOLDERS, field = null,
  stepping = false, start = NO_LOOK } = {}) {
  try {
    if (key === 'font') {
      chooseUserFont(value || THEME_FONT, storage);
      refreshUserFont({ storage });
      return { action: 'font', kind: null, message: '' };
    }
    if (key === 'look') {
      const message = await chooseLookValue(value, { storage, store, names, field, stepping, start });
      return { action: 'look', kind: null, message };
    }
    if (typeof key === 'string' && key.startsWith('look:')) {
      const t = key.slice(5);
      setGradeTarget(t, !!value, storage);
      refreshGrade({ storage });
      return { action: 'look-target', kind: t, message: '' };
    }
  } catch (err) {
    return { action: null, kind: null, message: `That did not work: ${String((err && err.message) || err)}` };
  }
  return { action: null, kind: null, message: '' };
}

// ---------------------------------------------------------------------------------------------
// *** THE SAME TWO CHOICES AS ORDINARY MENU ROWS (2026-10-02, switch access). *** On this page they are
// reached by a pointer or a keyboard only (the header says why the page hands the menu no moves), so a
// person with one switch could never change their font or colour look. The kiosk now offers the same
// rows in its menu ("Settings for: This device"), where a switch walks them like any other row: a short
// list steps, a long one opens the choice picker (which a switch scans), the person's "How you choose
// things" decides. Same storage, same write path (`applyDeviceChoice`), same options (`deviceChoices`).
//
// NEVER HIDDEN: with nothing found on this device the row is still there, DIMMED, and its hint says why
// (no folder chosen, the browser's permission lapsed, the folder is empty...) - a row that appears only
// sometimes is a row nobody knows to look for. The three "Look on ..." switches are the exception, and
// only while no look is in force: they would switch nothing (the page does the same).
//
// Reading the folders is asynchronous and the menu draws synchronously, so: `read()` (never prompts,
// never throws) looks at the folders - loading any fonts not in yet, and dropping a look whose file has
// gone, exactly as this page does on opening - and `rows()` draws from the last reading ("Looking on
// this device…", dimmed, before the first). The host calls `read()` when its menu opens and redraws when
// it settles; `onChange` hears every write, so the host can redraw then too.
// ---------------------------------------------------------------------------------------------
export const DEVICE_LOOK_PREFIX = 'uf:';
export const FONT_ROW_LABEL = 'Font on this device';
export const LOOK_ROW_LABEL = 'Colour look';

/** Why there is no font to choose, for a folder reading (`createDeviceLookRows` `read()`). Pure. */
export function fontReason(f) {
  if (!f || f.source === 'none') return 'no fonts on this device yet: choose a fonts folder in “Your own folders”';
  if (f.permission !== 'granted') return 'no fonts loaded: the browser needs permission for the fonts folder again (“Your own folders”)';
  if (f.missing) return 'no fonts: the fonts folder is not in your Nimrod folder any more (“Your own folders”)';
  if (f.failed && f.failed.length) return 'no fonts loaded: the files in the fonts folder could not be read';
  return 'no fonts in the fonts folder yet (.woff2, .woff, .ttf or .otf files)';
}
/** Why there is no colour look to choose. Pure. */
export function lookReason(l) {
  if (!l || l.source === 'none') return 'no colour looks on this device yet: choose a looks folder in “Your own folders”';
  if (l.permission !== 'granted') return 'no colour looks: the browser needs permission for the looks folder again (“Your own folders”)';
  if (l.missing) return 'no colour looks: the looks folder is not in your Nimrod folder any more (“Your own folders”)';
  return 'no colour looks in the looks folder yet (.cube files)';
}

/**
 * The device's font and colour look as settings-menu rows (settings_fields.js `fieldItems` shape).
 * opts: `store`, `names`, `storage`, `fontSet`, `FontFaceImpl` (all default to this browser's own),
 * `onChange({ action, kind, message })` after each write. Returns `{ read, rows, reading }`.
 */
export function createDeviceLookRows({ store = null, names = SUBFOLDERS, storage, fontSet, FontFaceImpl, onChange = null } = {}) {
  let st = store;
  const storeNow = () => st || (st = handleStore());     // made on first use: no IndexedDB opened for a menu never shown
  let reading = null;
  let message = '';
  let stepping = false;
  const choicesNow = () => deviceChoices({ storage, fontSet, lutFiles: reading?.luts?.files ?? null, fontsFailed: reading?.fonts?.failed || [] });

  async function read() {
    const folder = async (kind) => {
      try {
        const k = await kindFolder(kind, { store: storeNow(), names });
        return { source: k.source, permission: k.permission, missing: !!k.missing };
      } catch { return { source: 'none', permission: 'none', missing: false }; }
    };
    let fonts = { families: [], failed: [] };
    try { fonts = await loadDeviceFonts({ store: storeNow(), FontFaceImpl, fontSet }); } catch { /* none loaded */ }
    let looks = { read: false, files: [] };
    try { looks = await checkDeviceLook({ store: storeNow(), storage, names }); } catch { /* the look stays as it was */ }
    reading = {
      fonts: { ...(await folder('fonts')), failed: fonts.failed || [], count: (fonts.families || []).length },
      luts: { ...(await folder('luts')), files: looks.read ? looks.files : null },
    };
    return reading;
  }

  function write(key, value, field, isStep) {
    message = '';
    const start = choicesNow().look.value;
    return applyDeviceChoice(key, value, { storage, store: storeNow(), names, field, stepping: isStep, start }).then((r) => {
      message = r.message || '';
      try { onChange?.({ action: r.action, kind: r.kind, message }); } catch { /* a listener's fault is its own */ }
      return r;
    });
  }

  const dim = (key, label, hint) => ({ kind: 'item', id: `${DEVICE_LOOK_PREFIX}${key}`, key, label, hint, disabled: true });
  function rows() {
    if (!reading) {
      return [dim('font', FONT_ROW_LABEL, 'looking on this device…'), dim('look', LOOK_ROW_LABEL, 'looking on this device…')];
    }
    const items = fieldItems(choiceFields(choicesNow()), {
      // A function, read at press time (fieldItems says why): the stored choice, never a snapshot.
      values: () => choiceValues(choicesNow()),
      level: 'advanced',
      idPrefix: DEVICE_LOOK_PREFIX,
      onStep: (key, value, f) => { write(key, value, f, stepping); },
    });
    // A press that STEPS (`run`) may skip a .cube that cannot be read; a value chosen from the list
    // (`commit`) is that value or nothing. The same `onStep` hears both, so the step is marked here.
    for (const it of items) {
      const run = it.run;
      it.run = () => { stepping = true; try { run(); } finally { stepping = false; } };
    }
    const font = items.find((it) => it.key === 'font');
    const look = items.find((it) => it.key === 'look');
    if (look && message) look.hint = [look.hint, message].filter(Boolean).join(' · ');
    return [
      font || dim('font', FONT_ROW_LABEL, fontReason(reading.fonts)),
      look || dim('look', LOOK_ROW_LABEL, lookReason(reading.luts)),
      ...items.filter((it) => it.key !== 'font' && it.key !== 'look'),
    ];
  }

  return { read: () => read().catch(() => reading), rows, reading: () => reading };
}

/**
 * Everything the page shows, read without prompting:
 * `{ available, root: { chosen, name, permission }, kinds: [ kindFolder(...) + { found } ], choices }`.
 */
// ---------------------------------------------------------------------------------------------
// WHERE TO SAVE THINGS, AND THE WORDS TO COPY (2026-10-04). Pure.
// ---------------------------------------------------------------------------------------------
export const NIMROD_PLACEHOLDER = '<your Nimrod folder>';
// What "Copy" says, per kind: a sentence somebody can paste into a note, a message or a Save dialog's help.
export const SAVE_WORDS = Object.freeze({
  pictures: 'Save photos in', music: 'Save music in', videos: 'Save videos in',
  fonts: 'Save font files (.woff2, .woff, .ttf, .otf) in', luts: 'Save colour look files (.cube) in',
  plugins: 'Save audio plugins (one folder each) in', voice: 'Put the files of your converted voice model in',
  recordings: 'Save recordings and voice-training exports in',
  artwork: 'Save pictures you make for Nimrod (each kind in its own folder) in',
  data: 'Keep your own Nimrod data (play history, exports) in',
});
// What "Connect it for ..." connects it for: the panels that read a media source of that kind. Artwork (2026-10-07):
// connected, every picture chooser can browse it (a subfolder at a time) and the Photos panel can show it.
export const CONNECT_WORDS = Object.freeze({ pictures: 'photos', music: 'music', videos: 'videos', artwork: 'pictures' });
const POINTER_WORDS = Object.freeze({ pictures: 'your photos are', music: 'your music is', videos: 'your videos are' });

/**
 * One kind's place, from its `kindFolder` reading: `{ own, name, path, relative, text }`.
 *   own      the kind points at a folder of its own (its name is known, its path never is);
 *   relative "<your Nimrod folder>/Pictures" - always true, and all a browser can say by itself;
 *   path     the full path, only when the root's full path was typed (`rootPath`); '' otherwise;
 *   text     the best of those to show.
 */
export function placeOf(k, rootPath = '') {
  const sub = (k && k.sub) || SUBFOLDERS[k && k.kind] || (k && k.kind) || '';
  if (k && k.source === 'own') return { own: true, name: String(k.name || ''), path: '', relative: '', text: `the folder “${k.name || ''}”` };
  const relative = `${NIMROD_PLACEHOLDER}/${sub}`;
  const path = rootPath ? joinPath(rootPath, sub) : '';
  return { own: false, name: sub, path, relative, text: path || relative };
}

/** The sentence "Copy" puts on the clipboard for one kind's place. Pure. */
export function copyText(kind, place) {
  const w = SAVE_WORDS[kind] || 'Save it in';
  if (!place) return '';
  if (place.own) return `${w} the folder “${place.name}” (the one chosen for ${(KIND_WORDS[kind] || { what: kind }).what} on this device).`;
  return `${w}: ${place.text}`;
}

/** What one kind's folder holds, in words, for the page (`scanFolder`'s reading). Pure. */
export function foundWords(kind, found) {
  const w = KIND_WORDS[kind] || { none: '' };
  if (!found) return '';
  if (kind === 'voice') {
    const r = found.voice;
    if (!r) return w.none;
    if (r.ok) return 'A voice model is here, ready for the speech service.';
    if (r.kind === 'checkpoint') return 'A training checkpoint is here: it still needs converting (step 4 of “Your own voice model”).';
    if ((found.names || []).includes('model.bin')) return `A model is here, but it is missing ${r.missing.join(', ')}. Convert it again (step 4).`;
    return w.none;
  }
  if (kind === 'artwork' && Array.isArray(found.art)) {
    if (!found.count) return w.none;
    const where = found.art.map((p) => `${p.folder || 'loose in Artwork'} ${p.count}`).join(', ');
    return `In it: ${found.count} ${found.count === 1 ? 'picture' : 'pictures'} (${where}).`;
  }
  if (typeof found.count === 'number') {
    const [one, many] = w.noun || ['item', 'items'];
    const bits = [];
    if (found.count) bits.push(`${found.count} ${found.count === 1 ? one : many}`);
    if (found.folders) bits.push(`${found.folders} folder${found.folders === 1 ? '' : 's'}`);
    const extra = found.exported ? ' (an export for training is here)' : '';
    return bits.length ? `In it: ${bits.join(' and ')}${extra}.` : w.none;
  }
  return found.items.length
    ? `Found: ${found.items.map((it) => (it.detail ? `${it.name} (${it.detail})` : it.name)).join(', ')}.`
    : w.none;
}

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
  return { available: available(view), root, kinds, choices, rootPath: readRootPath(storage) };
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

// ---------------------------------------------------------------------------------------------
// MAKE YOUR OWN ARTWORK (2026-10-07, row 2.64): the art kit and the checker, in the Artwork section.
// The kit is art_kit.js (the same words as Artwork's README.txt); the checker is art_check.js. A file is checked in
// this browser and goes nowhere: no request is made by checking (dev/art_check_test.html counts them).
// "Check pictures…" and "Check a folder…" are the browser's own file inputs, so they work in every browser, not only
// the ones with a folder picker; "Check the Artwork folder" reads the connected one.
// ---------------------------------------------------------------------------------------------
const LEVEL_WORDS = Object.freeze({ no: '', warn: '', tip: 'Tip: ' });

/** One checked file, as markup. Every name in it is the person's own and is escaped. Pure. */
export function artResultHtml(r) {
  const where = r.folder ? ` (${esc(r.folder)})` : '';
  const notes = (r.notes || []).map((n) => `<li data-level="${esc(n.level)}">${esc(LEVEL_WORDS[n.level] || '')}${esc(n.text)}</li>`).join('');
  return `<div class="st-hint" style="display:block;margin:0 0 8px" data-uf-art-result data-verdict="${esc(r.verdict)}">`
    + `<b>${esc(r.name)}</b>${where}: ${esc(verdictWords(r))}${notes ? `<ul style="margin:4px 0 0 1.2em;padding:0">${notes}</ul>` : ''}</div>`;
}

function artworkHtml(k, s) {
  const out = [];
  out.push(say('Make your own artwork: pictures for Nimrod, made with your own AI or by hand. The art kit says, for each kind, '
    + 'the size, the file type, whether the background is clear, the name and the folder. Give it to your AI with what you want.', 'data-uf-art-intro'));
  out.push(`<ul class="st-hint" style="display:block;margin:0 0 8px 1.2em;padding:0" data-uf-art-kinds>${ART_KINDS.map((a) => `<li data-art-kind="${esc(a.id)}">`
    + `<b>${esc(a.plural)}</b>: ${esc(`${a.width} × ${a.height}`)}, ${esc(shapeWords(a))}, ${esc(typesWords(a))}${a.clear === 'wanted' ? ' with a clear background' : ''}`
    + ` - in ${esc(ART_FOLDER)}/${esc(a.folder)}. For ${esc(a.use)}.</li>`).join('')}</ul>`);
  out.push(say('Not read from files yet: room objects, posters and frames in a room, trophies and badges, theme scenes, module icons, game pieces. '
    + 'Pictures of real people, or of other people’s characters or brands, are yours to answer for.', 'data-uf-art-notyet'));
  out.push(button('copy-kit', 'Copy the art kit', 'to paste into your AI; the README.txt in Artwork is the kit as it was when the folder was made'));
  out.push(say('Check pictures before you use them: it says what is wrong with each one, if anything. Nothing is uploaded; the files are read on this device. '
    + '(Choosing a folder, your browser may say “upload”: nothing leaves this computer.)', 'data-uf-art-checknote'));
  const sel = (s.artKind || '');
  out.push(`<p class="st-hint" style="display:block;margin:0 0 8px"><label>Check as <select data-uf-art-kind style="font:inherit;min-height:36px">`
    + `<option value=""${sel ? '' : ' selected'}>worked out from the folder or name</option>`
    + ART_KINDS.map((a) => `<option value="${esc(a.id)}"${sel === a.id ? ' selected' : ''}>${esc(a.title)}</option>`).join('')
    + '</select></label></p>');
  out.push(button('check-files', 'Check pictures…', 'one or several files'));
  out.push(button('check-dir', 'Check a folder…', 'every picture in it, and one folder down'));
  if (k.dir) out.push(button('check-artwork', 'Check the Artwork folder', 'every kind’s folder'));
  out.push('<input type="file" multiple hidden data-uf-art-files accept="image/*,.svg,.heic,.heif" aria-hidden="true" tabindex="-1">');
  out.push('<input type="file" multiple hidden data-uf-art-dir webkitdirectory aria-hidden="true" tabindex="-1">');
  const c = s.artCheck;
  if (c) {
    out.push(`<div data-uf-art-results aria-live="polite">${say(c.busy ? 'Checking…' : c.error || summaryWords(c), 'data-uf-art-summary')}`
      + (c.results || []).filter((r) => r.verdict !== 'skip').map(artResultHtml).join('') + '</div>');
    if (!c.busy) out.push(button('clear-check', 'Clear the results'));
  }
  return out.join('\n');
}

/** The page's markup for a `readUserFolders` reading. Pure. */
export function userFoldersHtml(s) {
  const parts = [];
  const items = s.choices ? choiceItems(s.choices) : [];
  const rootPath = s.rootPath || '';
  parts.push(say('Files in these folders are read on this device and never uploaded. Everything here is off until somebody chooses it.'));
  parts.push(say('Folder access belongs to this device and this browser. On a second computer, or in another browser, set up '
    + 'the Nimrod folder there once too; every kind below then finds its own folder in it.', 'data-uf-per-device'));
  if (!s.available) {
    parts.push(say('This browser cannot open a folder you choose (Chrome and Edge can; Firefox and Safari cannot yet).', 'data-uf-unavailable'));
  }
  // --- the root ---
  parts.push('<div class="st-head" data-uf-section="root">Your Nimrod folder</div>');
  if (!s.root.chosen) {
    parts.push(say(`Not set up yet. “Set up your Nimrod folder” asks you to choose or make one folder (anywhere: Documents, `
      + `a USB drive), then makes ${Object.values(SUBFOLDERS).join(', ')} inside it, each with a README.txt saying what goes there. `
      + 'Nothing else is touched, and there is nothing to download.', 'data-uf-root-state'));
  } else {
    parts.push(say([`Using “${s.root.name}”.`, permissionWords(s.root.permission)].filter(Boolean).join(' '), 'data-uf-root-state'));
  }
  if (s.available && !s.root.chosen) parts.push(button('pick-root', 'Set up your Nimrod folder…', 'choose or make a folder'));
  if (s.available && s.root.chosen) {
    parts.push(button('set-up', 'Set up your Nimrod folder again', 'adds only what is missing; nothing is changed or removed'));
    parts.push(button('pick-root', 'Choose a different Nimrod folder…'));
  }
  if (s.root.chosen && s.root.permission !== 'granted') parts.push(button('allow-root', 'Allow it again', 'the browser asks'));
  if (s.root.chosen) parts.push(button('forget-root', 'Stop using it on this device', 'the folder and its files stay where they are'));
  // Its full path: optional, this device only. A browser never tells a page where a folder really is.
  parts.push(say('A browser never tells a web page where a folder really is, so the places below read “<your Nimrod folder>/…”. '
    + 'Type its full path once to get full paths you can copy (in Windows: Shift + right-click the folder, “Copy as path”). '
    + 'Optional; kept on this device only.', 'data-uf-path-note'));
  parts.push(`<p style="display:block;margin:0 0 8px"><input type="text" data-uf-path aria-label="Your Nimrod folder's full path"
    placeholder="for example D:\\Nimrod" value="${esc(rootPath)}" spellcheck="false" autocomplete="off"
    style="width:100%;box-sizing:border-box;min-height:44px;font:inherit;padding:6px 10px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit"></p>`);
  parts.push(button('save-path', 'Keep this path on this device', rootPath ? 'empty it and press to forget it' : ''));
  if (rootPath && s.root.chosen && !pathMatchesRoot(rootPath, s.root.name)) {
    parts.push(say(`That path ends in “${lastName(rootPath)}”, but the folder chosen is “${s.root.name}”. Check it is the same folder.`, 'data-uf-path-mismatch'));
  }
  // --- each kind ---
  for (const k of s.kinds) {
    const w = KIND_WORDS[k.kind] || { title: k.kind, what: k.kind, none: '' };
    parts.push(`<div class="st-head" data-uf-section="${esc(k.kind)}">${esc(w.title)}</div>`);
    let where;
    if (k.source === 'own') where = `From its own folder, “${k.name}”.`;
    else if (k.source === 'root') where = `From your Nimrod folder: “${k.name}”.`;
    else where = 'No folder yet: set up your Nimrod folder above, or choose a folder just for these.';
    parts.push(say([where, k.source !== 'none' ? permissionWords(k.permission) : ''].filter(Boolean).join(' '), `data-uf-where="${esc(k.kind)}"`));
    if (POINTER_KINDS.includes(k.kind)) {
      parts.push(say(`Nothing is copied. Use the ${SUBFOLDERS[k.kind]} folder in your Nimrod folder, or point at the folder `
        + `${POINTER_WORDS[k.kind]} already in: it is read where it is.`, `data-uf-pointer="${esc(k.kind)}"`));
    }
    let found;
    if (k.found) {
      found = foundWords(k.kind, k.found);
    } else if (k.missing) {
      found = `The “${k.sub || SUBFOLDERS[k.kind] || k.kind}” folder is not in your Nimrod folder any more. “Set up your Nimrod folder again” makes it.`;
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
    if (k.kind === 'artwork') parts.push(artworkHtml(k, s));
    // Where to save things of this kind, and the words to copy.
    const place = placeOf(k, rootPath);
    parts.push(`<p class="st-hint" style="display:block;margin:0 0 8px" data-uf-place="${esc(k.kind)}">Save ${esc(w.what)} in: `
      + `<code style="user-select:all;word-break:break-all">${esc(place.text)}</code>${k.source === 'none' && !place.own ? ' (once it is set up)' : ''}</p>`);
    parts.push(button('copy', 'Copy', 'what to save, and where', k.kind));
    if (place.path) parts.push(button('copy-path', 'Copy the path', 'just the path, for a Save dialog', k.kind));
    if (CONNECT_WORDS[k.kind] && k.dir) {
      parts.push(button('connect', `Connect it for ${CONNECT_WORDS[k.kind]}`, 'kept as a media folder on this device; nothing is copied', k.kind));
    }
    // THE OVERRIDE, on every kind: point this kind somewhere else, or back at the Nimrod folder.
    if (s.available) {
      parts.push(button('pick-kind', POINTER_KINDS.includes(k.kind) ? `Point at the folder ${POINTER_WORDS[k.kind]} already in…`
        : `Choose a different folder for ${w.what}…`, 'for this kind only', k.kind));
    }
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
  storage, fontSet, FontFaceImpl, chooseMode = DEFAULT_CHOOSE_MODE, openDialog = openChoiceDialog,
  // 2026-10-04: where "Copy" writes (default: the browser's clipboard), and where "Connect it for photos" keeps a
  // folder as a media source (default: folder_source.js, this device's IndexedDB) - `{ add(handle, label), find(handle) }`.
  clipboard = (typeof navigator !== 'undefined' ? navigator.clipboard : null),
  media = { add: addFolderSource, find: findFolderSource } } = {}) {
  let torn = false;
  let last = null;
  let message = '';
  let fontsFailed = [];
  // The art checker (2026-10-07): the last results shown, and the "Check as" choice. This page's only, kept nowhere.
  let artCheck = null;
  let artKind = '';
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
    s.artCheck = artCheck;
    s.artKind = artKind;
    last = s;
    el.innerHTML = userFoldersHtml(s);
    const m = el.querySelector('[data-uf-msg]');
    if (m) m.textContent = message;
    return s;
  };
  const tellHost = (action, kind = null) => { try { onChange?.({ action, kind }); } catch { /* a listener's fault is its own */ } };

  // ONE WRITE PATH for the choices (`applyDeviceChoice`, shared with the menu's rows), whether a press
  // stepped them or the list chose.
  async function choose(key, value, { field = null, stepping = false } = {}) {
    const r = await applyDeviceChoice(key, value, { storage, store, names, field, stepping,
      start: last?.choices?.look?.value ?? NO_LOOK });
    message = r.message || '';
    if (r.action) tellHost(r.action, r.kind);
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

  const madeWords = (made) => (made.length
    ? `Made ${made.join(', ')} in it, each with a README.txt saying what goes there.`
    : 'Everything was already there. Nothing was changed.');

  // COPY (2026-10-04): no redraw, nothing stored, nobody told - it only puts words on the clipboard.
  async function copy(kind, pathOnly) {
    const k = last?.kinds?.find((x) => x.kind === kind);
    if (!k) return;
    const place = placeOf(k, last?.rootPath || '');
    const text = pathOnly ? place.path : copyText(kind, place);
    if (!text) return;
    try {
      if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('no clipboard');
      await clipboard.writeText(text);
      tell(`Copied: ${text}`);
    } catch {
      tell(`Could not copy here. Select it and copy it yourself: ${text}`);
    }
  }

  // THE ART CHECKER. Results replace the last ones; a check never changes a file or the folders.
  async function runArtCheck(job) {
    artCheck = { busy: true, results: [], more: 0 };
    await draw({ load: false });
    try {
      const r = await job();
      artCheck = { results: r.results || [], more: r.more || 0 };
    } catch (err) {
      artCheck = { results: [], more: 0, error: failed(err) || 'Could not check those files.' };
    }
    if (!torn) await draw({ load: false });
    return artCheck;
  }
  const checkPicked = (files) => runArtCheck(() => checkArtFiles(files, { kind: artKind }));

  async function act(name, kind) {
    if (name === 'set') { press(kind); return; }
    if (name === 'copy' || name === 'copy-path') { await copy(kind, name === 'copy-path'); return; }
    if (name === 'copy-kit') {
      const text = artKitText();
      try {
        if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('no clipboard');
        await clipboard.writeText(text);
        tell('Copied the art kit. Paste it into your AI, then ask for what you want.');
      } catch { tell('Could not copy here. The same kit is the README.txt in your Artwork folder.'); }
      return;
    }
    if (name === 'check-files' || name === 'check-dir') {
      // The browser's own file chooser: a real dialog, so only from this press.
      el.querySelector(name === 'check-files' ? '[data-uf-art-files]' : '[data-uf-art-dir]')?.click();
      return;
    }
    if (name === 'check-artwork') {
      const k = last?.kinds?.find((x) => x.kind === 'artwork');
      if (!k?.dir) { tell('The Artwork folder cannot be read right now. Allow it again, or set up your Nimrod folder.'); return; }
      await runArtCheck(() => checkArtFolder(k.dir));
      return;
    }
    if (name === 'clear-check') { artCheck = null; await draw({ load: false }); return; }
    message = '';
    try {
      if (name === 'pick-root') {
        const { made } = await pickRoot({ view, store, names });
        message = madeWords(made);
      } else if (name === 'set-up') {
        const r = await setUpRoot({ view, store, names });
        message = r.ok ? madeWords(r.made) : (permissionWords(r.permission) || 'The browser did not let this page into the folder.');
      } else if (name === 'save-path') {
        const input = el.querySelector('[data-uf-path]');
        const kept = saveRootPath(input ? input.value : '', storage);
        message = kept ? `Kept on this device: ${kept}` : 'The path is forgotten on this device.';
      } else if (name === 'connect') {
        const k = last?.kinds?.find((x) => x.kind === kind);
        if (!k?.dir) throw new Error('that folder cannot be read right now');
        const already = await media.find(k.dir);
        if (already) {
          message = `Already connected on this device, as “${already.label}”.`;
        } else {
          const label = k.source === 'own' ? k.name : `${k.sub || SUBFOLDERS[kind]} (your Nimrod folder)`;
          const src = await media.add(k.dir, label);
          message = `Connected as “${(src && src.label) || label}”. Nothing was copied. Choose it in a panel’s settings where it asks which folder to use.`;
        }
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
  // The art checker's inputs and its "Check as" choice: one listener, the controls redrawn under it.
  const onChangeEvt = (e) => {
    const t = e.target;
    if (!t || !el.contains(t)) return;
    if (t.matches?.('[data-uf-art-kind]')) { artKind = String(t.value || ''); return; }
    if (t.matches?.('[data-uf-art-files],[data-uf-art-dir]')) {
      const files = [...(t.files || [])];
      t.value = '';
      if (files.length) checkPicked(files);
    }
  };
  el.addEventListener('change', onChangeEvt);
  el.innerHTML = say('Looking at this device’s folders…');
  const ready = draw().catch((err) => { if (!torn) { el.innerHTML = say(failed(err) || 'Could not read the folders.'); } return null; });
  return {
    ready,
    refresh: draw,
    act,
    tell,
    // For a suite (and anything that already has files in hand): check these as if they were picked.
    checkFiles: checkPicked,
    destroy() { torn = true; el.removeEventListener('click', onClick); el.removeEventListener('change', onChangeEvt); },
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
