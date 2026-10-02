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
// Everything is injectable (`view` for the picker, `store` for remembered handles), so the suite drives
// it against in-memory folders with no prompt.

import {
  FOLDER_KINDS, SUBFOLDERS, ROOT_KEY, ROOT_MODE, available, handleStore, permissionOf, allowAgain,
  pickRoot, pickKindFolder, useRootFor, forgetRoot, kindFolder, listFiles, listFolders,
} from './user_folders.js';
import { FONT_EXTS, faceFromName } from './user_fonts.js';
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

/**
 * Everything the page shows, read without prompting:
 * `{ available, root: { chosen, name, permission }, kinds: [ kindFolder(...) + { found } ] }`.
 */
export async function readUserFolders({ view = (typeof window !== 'undefined' ? window : null), store = handleStore(), names = SUBFOLDERS } = {}) {
  let rootHandle = null;
  try { rootHandle = await store.get(ROOT_KEY); } catch { rootHandle = null; }
  const root = { chosen: !!rootHandle, name: rootHandle ? String(rootHandle.name || '') : '',
    permission: await permissionOf(rootHandle, ROOT_MODE), handle: rootHandle };
  const kinds = [];
  for (const kind of FOLDER_KINDS) {
    const k = await kindFolder(kind, { store, names });
    kinds.push({ ...k, found: k.dir ? await scanFolder(kind, k.dir) : null });
  }
  return { available: available(view), root, kinds };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Paragraph text in the menu's own muted style (modules/settings.js does the same).
const say = (text, attrs = '') => (text ? `<p class="st-hint" style="display:block;margin:0 0 8px" ${attrs}>${esc(text)}</p>` : '');
const button = (act, label, hint = '', kind = '') => `<button class="st-item" type="button" data-act="${act}"${kind ? ` data-kind="${kind}"` : ''}>
    <span class="st-label">${esc(label)}</span>${hint ? `<span class="st-hint">${esc(hint)}</span>` : ''}</button>`;

/** The page's markup for a `readUserFolders` reading. Pure. */
export function userFoldersHtml(s) {
  const parts = [];
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
  names = SUBFOLDERS, onChange = null } = {}) {
  let torn = false;
  let last = null;
  let message = '';
  const draw = async () => {
    const s = await readUserFolders({ view, store, names });
    if (torn) return s;
    last = s;
    el.innerHTML = userFoldersHtml(s);
    const m = el.querySelector('[data-uf-msg]');
    if (m) m.textContent = message;
    return s;
  };
  const tell = (text) => { message = text || ''; const m = el.querySelector('[data-uf-msg]'); if (m) m.textContent = message; };
  // A cancelled picker is not an error: somebody changed their mind.
  const failed = (err) => (err && err.name === 'AbortError' ? '' : `That did not work: ${String((err && err.message) || err)}`);

  async function act(name, kind) {
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
    act(b.dataset.act, b.dataset.kind || '');
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
