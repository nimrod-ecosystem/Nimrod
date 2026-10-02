// picture_picker.js — CHOOSING ONE PICTURE. ONE PICKER, EVERY PLACE THAT ASKS FOR A PICTURE.
//
// Mike, 2026-10-02: *"Having the pictures scroll through all your pictures in the settings menu
// isn't a good way to do it. There should be upload or a folder picker."* Until today four places
// each made somebody walk their pictures ONE AT A TIME, BY NAME: the button's Picture row (a
// `choice` with every file in the folder as an option — four hundred photos was four hundred
// presses), the avatar maker's "use a picture instead" (one button per file name), and the board
// editor's own picker (a grid, but built on a listing that blanked a photo panel showing the same
// folder). Mike's rule for that shape: several ways in, "they should all really just be the same
// thing". So this is the one thing, and each of those now opens it.
//
// THREE WAYS TO A PICTURE, in the order a switch reaches them:
//   1. RECENT — the last few pictures chosen anywhere on this device, first. The commonest answer to
//      "which picture" is "the one I used a minute ago", and it is one row from the top.
//   2. ADD ONE FROM THIS DEVICE — a file input (`device_pictures.js`): works in every browser, and
//      the picture is kept on this device. Nothing is sent anywhere.
//   3. CHOOSE FROM A FOLDER — the person's connected folders and media agents (and "Connect a
//      folder", the browser's own folder picker, where the browser has one), shown as THUMBNAILS in a
//      grid with a search box, a sub-folder at a time.
//
// ONE SWITCH REACHES EVERYTHING, BY ROWS. The picker is a stack of rows (recent, the actions, the
// sources, each line of the grid, "Show more"). `next`/`prev` light a ROW; `select` goes INTO it and
// `next`/`prev` then walk its pictures; `select` takes one; `back` comes out of the row, and `back`
// from the rows is Cancel. A row with one thing in it is taken by the `select` that would have
// entered it. Row/column scanning: a hundred pictures in four columns is at most 25 + 4 presses,
// not a hundred. The first `select` only lights the first row (the calculator's rule). The search
// box is for a keyboard and is not a stop — a switch cannot type, and a stop it cannot use is a
// wasted press on every lap.
//
// WHAT IT HANDS BACK is a REFERENCE, `{ sourceId, path }` — never the bytes, never a URL (a folder's
// object URL dies when anything lists that folder again). `null` means "No picture", offered only
// where the caller says no picture is allowed.
//
// EVERYTHING IS INJECTED (the registry client, the listing, the URL resolver, the folder picker, the
// device store, storage for the recent list), so `dev/picture_picker_test.html` drives it against a
// fake folder, a fake File and a fake switch.

import { createMediaSourcesClient, listPictureEntries, resolveItemUrl, sourceById } from './media_sources.js';
import { isFolderPickerSupported, pickFolder, requestFolderAccess } from './folder_source.js';
import {
  DEVICE_SOURCE, DEVICE_SOURCE_ID, isDeviceSource, isPictureFile,
  addDevicePicture, listDevicePictures, devicePictureUrl,
} from './device_pictures.js';

// *** THREE NUMBERS, EACH A DEFAULT AND EACH AN OPTION (Rule 1). ***
//   recentMax 6   one row of recent pictures at the default four columns plus two: enough that the
//                 last few choices are all there, few enough that the row stays one row on a phone.
//   columns   4   the grid's width, and so the cost of a row/column scan: rows + columns presses.
//                 Four keeps a thumbnail big enough to recognise a face in a settings-sized panel.
//   pageSize  48  twelve rows of four. Past that a "Show more" stop, so a folder of two thousand
//                 photos does not read two thousand files to draw one screen.
export const PICKER_DEFAULTS = Object.freeze({ recentMax: 6, columns: 4, pageSize: 48 });
export const RECENT_KEY = 'nimrod:recentPictures';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const nameOf = (path) => String(path || '').split('/').pop();
export function refOf(x) {
  return x && x.sourceId && x.path ? { sourceId: String(x.sourceId), path: String(x.path) } : null;
}
export function sameRef(a, b) {
  const x = refOf(a), y = refOf(b);
  return (!x && !y) || (!!x && !!y && x.sourceId === y.sourceId && x.path === y.path);
}
const albumOf = (path) => { const p = String(path || '').split('/'); p.pop(); return p.join('/'); };

// ---------------------------------------------------------------------------------------------
// RECENT. Per DEVICE, in this browser's storage: a convenience, not a record. Shared by every place
// the picker opens, so a picture chosen for an avatar is first in line for a button. It holds names
// and paths, never pictures. Anybody who opens a picker on this device sees these names — the same
// people who can see the screen the pictures are on.
// ---------------------------------------------------------------------------------------------
function storageOf(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage || null; } catch { return null; }
}
export function readRecent({ storage, max = PICKER_DEFAULTS.recentMax } = {}) {
  const s = storageOf(storage);
  if (!s) return [];
  try {
    const arr = JSON.parse(s.getItem(RECENT_KEY) || '[]');
    return (Array.isArray(arr) ? arr : [])
      .map((r) => { const ref = refOf(r); return ref ? { ...ref, name: String(r.name || nameOf(ref.path)) } : null; })
      .filter(Boolean).slice(0, Math.max(0, max));
  } catch { return []; }
}
export function rememberRecent(ref, { storage, max = PICKER_DEFAULTS.recentMax, name = '' } = {}) {
  const r = refOf(ref);
  if (!r) return readRecent({ storage, max });
  const list = [{ ...r, name: String(name || ref.name || nameOf(r.path)) },
    ...readRecent({ storage, max: 50 }).filter((x) => !sameRef(x, r))].slice(0, Math.max(0, max));
  const s = storageOf(storage);
  try { s?.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* storage full or off: it was a convenience */ }
  return list;
}

/** Every word typed has to appear in the name (or the path), in any order, any case. */
export function filterByName(items, query) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items || [];
  return (items || []).filter((it) => {
    const hay = `${it.name || ''} ${it.path || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Items in rows of `columns` — the grid a row/column scan walks. */
export function gridRows(items, columns = PICKER_DEFAULTS.columns) {
  const c = Math.max(1, Math.floor(Number(columns)) || 1);
  const out = [];
  for (let i = 0; i < (items || []).length; i += c) out.push(items.slice(i, i + c));
  return out;
}

let cssAdded = false;
function ensureCss() {
  if (cssAdded || typeof document === 'undefined') return;
  cssAdded = true;
  try {
    if (document.querySelector('link[data-pp-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.ppCss = '';
    link.href = new URL('./picture_picker.css', import.meta.url).href;
    document.head.append(link);
  } catch { /* unstyled still works */ }
}

/**
 * Mount the picker into `root`. Returns `{ next, prev, select, back, destroy, refresh, __probe }` —
 * the four verbs for whoever routes a switch to it.
 */
export function mountPicturePicker(root, {
  sources = null,
  listEntries = listPictureEntries,
  resolveUrl = resolveItemUrl,
  folders = null,
  device = null,
  value = null,
  allowNone = false,
  title = 'Choose a picture',
  onPick = () => {},
  onCancel = () => {},
  storage,
  recentMax = PICKER_DEFAULTS.recentMax,
  columns = PICKER_DEFAULTS.columns,
  pageSize = PICKER_DEFAULTS.pageSize,
  // Handle arrow keys, Enter and Escape itself. OFF when a host already routes its keys here as
  // verbs (the settings menu, the avatar maker) — on both, every arrow would move twice.
  keys = false,
} = {}) {
  ensureCss();
  const fs = { isSupported: isFolderPickerSupported, pick: () => pickFolder(''), request: requestFolderAccess, ...(folders || {}) };
  const dev = { add: (f) => addDevicePicture(f), list: () => listDevicePictures(), url: (p) => devicePictureUrl(p), ...(device || {}) };
  let client = sources;
  const registry = () => client || (client = createMediaSourcesClient({ cache: true }));
  const cols = Math.max(1, Math.floor(Number(columns)) || PICKER_DEFAULTS.columns);
  const page = Math.max(cols, Math.floor(Number(pageSize)) || PICKER_DEFAULTS.pageSize);

  let list = null;                 // the sources, once listed; null = still looking
  let cur = { sourceId: '', album: '' };
  const listings = new Map();      // `${sourceId}\n${album}` -> { items, albums, error, code } | 'loading'
  let query = '';
  let shown = page;
  let status = '';
  let lit = { g: -1, i: -1 };      // the lit row, and the lit thing inside it (-1: the whole row)
  const urls = new Map();          // `${sourceId}\n${path}` -> Promise<{url,release}|null>
  let dead = false;
  const chosen = refOf(value);

  const keyOf = (id, album) => `${id}\n${album || ''}`;
  const srcOf = (id) => (list || []).find((s) => s.id === id) || sourceById(list || [], id);
  const listing = () => listings.get(keyOf(cur.sourceId, cur.album));

  // ------------------------------------------------------------------ data
  async function entriesFor(src, album) {
    if (isDeviceSource(src)) return { items: (await dev.list()) || [], albums: [] };
    const got = await listEntries(src, album);
    // A listing function that returns a bare array (the older `listItemNames` shape) has no albums.
    return Array.isArray(got) ? { items: got, albums: [] } : { items: got?.items || [], albums: got?.albums || [] };
  }

  async function loadSources() {
    let reg = [];
    try { reg = (await registry().list()) || []; } catch (err) { console.warn('pictures: could not list sources', err); reg = []; }
    let mine = [];
    try { mine = (await dev.list()) || []; } catch { mine = []; }
    if (dead) return;
    list = [...reg.filter((s) => s && s.id && !isDeviceSource(s)), ...(mine.length ? [DEVICE_SOURCE] : [])];
    // Start where the picture already chosen lives, so "change it" opens on its own folder.
    const start = chosen && list.some((s) => s.id === chosen.sourceId) ? chosen.sourceId : (list[0]?.id || '');
    if (start) await openSource(start, chosen && chosen.sourceId === start ? albumOf(chosen.path) : '');
    else render();
  }

  async function openSource(id, album = '', { force = false } = {}) {
    const src = srcOf(id);
    if (!src) return;
    cur = { sourceId: id, album: album || '' };
    shown = page;
    const k = keyOf(id, cur.album);
    if (force) listings.delete(k);
    if (!listings.has(k)) {
      listings.set(k, 'loading');
      render();
      let got;
      try {
        const e = await entriesFor(src, cur.album);
        got = { items: (e.items || []).filter((it) => it && it.path && (!it.kind || it.kind === 'image')), albums: e.albums || [] };
      } catch (err) {
        got = { items: [], albums: [], code: err?.code || '', error: String(err?.message || err) };
      }
      listings.set(k, got);
      if (dead) return;
    }
    render();
  }

  // ------------------------------------------------------------------ actions
  function pick(ref, name = '') {
    const r = refOf(ref);
    if (!r) return;
    rememberRecent(r, { storage, max: recentMax, name: name || nameOf(r.path) });
    try { onPick(r); } catch (err) { console.error('pictures: onPick', err); }
  }

  async function addFiles(files) {
    const pics = [...(files || [])];
    const refs = [];
    let refused = 0;
    for (const f of pics) {
      if (!isPictureFile(f)) { refused++; continue; }
      try { refs.push(await dev.add(f)); }
      catch (err) { console.warn('pictures: could not keep that picture', err); refused++; }
    }
    if (dead) return;
    if (refs.length === 1 && !refused) { pick(refs[0], refs[0].name); return; }
    status = refs.length
      ? `Added ${refs.length} picture${refs.length === 1 ? '' : 's'}.${refused ? ` ${refused} could not be added (not a picture).` : ''} Choose one.`
      : 'That was not a picture. Choose a photo or a drawing (.jpg, .png, .webp, .gif, .svg).';
    if (refs.length) {
      if (!(list || []).some((s) => s.id === DEVICE_SOURCE_ID)) list = [...(list || []), DEVICE_SOURCE];
      await openSource(DEVICE_SOURCE_ID, '', { force: true });
    } else render();
  }

  async function connectFolder() {
    try {
      const src = await fs.pick();
      if (!src || dead) return;
      if (!(list || []).some((s) => s.id === src.id)) {
        // Before the device's own pictures, so the registry's order (folders, then this device) holds.
        const devAt = (list || []).findIndex((s) => s.id === DEVICE_SOURCE_ID);
        list = devAt < 0 ? [...(list || []), src] : [...list.slice(0, devAt), src, ...list.slice(devAt)];
      }
      status = '';
      await openSource(src.id);
    } catch (err) {
      // Closing the browser's own folder dialog is not an error and must not be reported as one.
      if (err && err.name === 'AbortError') return;
      status = 'No folder was connected.';
      render();
    }
  }

  async function allowAgain() {
    const id = cur.sourceId;
    let r = 'denied';
    try { r = await fs.request(id); } catch { r = 'denied'; }
    if (dead) return;
    if (r === 'granted') await openSource(id, cur.album, { force: true });
    else { status = 'Access was not allowed. The folder stays connected; try again any time.'; render(); }
  }

  function activate(el) {
    if (!el || dead) return;
    const d = el.dataset;
    if ('ppPick' in d) { pick({ sourceId: d.source, path: d.path }, d.name || ''); return; }
    if (d.ppSource) { status = ''; openSource(d.ppSource).then(focusGrid); return; }
    if ('ppAlbum' in d) { openSource(cur.sourceId, d.ppAlbum).then(focusGrid); return; }
    switch (d.ppAct) {
      case 'upload': fileInput()?.click(); return;
      case 'folder': connectFolder(); return;
      case 'allow': allowAgain(); return;
      case 'none': try { onPick(null); } catch (err) { console.error('pictures: onPick', err); } return;
      case 'cancel': cancel(); return;
      case 'more': shown += page; renderResults(); return;
      default:
    }
  }
  function cancel() { try { onCancel(); } catch (err) { console.error('pictures: onCancel', err); } }

  // After choosing a source or a sub-folder, the light goes to the first line of pictures: that is
  // what somebody choosing a folder is about to want, and it saves walking down to it.
  function focusGrid() {
    if (dead || lit.g < 0) return;
    const gs = groups();
    const at = gs.findIndex((g) => g.dataset.ppGroup === 'grid');
    lit = { g: at >= 0 ? at : Math.min(lit.g, gs.length - 1), i: -1 };
    paintLit();
  }

  // ------------------------------------------------------------------ render
  const fileInput = () => root.querySelector('[data-pp-file]');

  function tile(ref, name, extra = '') {
    const on = sameRef(ref, chosen);
    return `<button type="button" class="pp-tile" data-pp-stop data-pp-pick data-source="${esc(ref.sourceId)}"
      data-path="${esc(ref.path)}" data-name="${esc(name)}" aria-label="${esc(name)}" aria-pressed="${on}"${extra}>
      <span class="pp-thumb" data-pp-thumb></span><span class="pp-name">${esc(name)}</span></button>`;
  }

  function recentHtml() {
    if (!list) return '';
    const rec = readRecent({ storage, max: recentMax }).filter((r) => srcOf(r.sourceId));
    if (!rec.length) return '';
    return `<div class="pp-sec"><p class="pp-label">Recent</p>
      <div class="pp-row pp-tiles" data-pp-group="recent" style="--pp-cols:${cols}">
        ${rec.map((r) => tile(r, r.name)).join('')}</div></div>`;
  }

  function actionsHtml() {
    const folderOk = (() => { try { return !!fs.isSupported(); } catch { return false; } })();
    return `<div class="pp-row pp-acts" data-pp-group="actions">
      <button type="button" class="pp-btn" data-pp-stop data-pp-act="upload">Add a picture from this device</button>
      ${folderOk ? '<button type="button" class="pp-btn" data-pp-stop data-pp-act="folder">Connect a folder of pictures</button>' : ''}
      ${allowNone ? '<button type="button" class="pp-btn" data-pp-stop data-pp-act="none">No picture</button>' : ''}
      <button type="button" class="pp-btn" data-pp-stop data-pp-act="cancel">Cancel</button>
    </div>
    <input type="file" accept="image/*" multiple hidden data-pp-file aria-hidden="true" tabindex="-1">`;
  }

  function sourcesHtml() {
    if (!list || !list.length) return '';
    const L = listing();
    const albums = L && L !== 'loading' ? (L.albums || []) : [];
    const srcBtns = list.length > 1 ? list.map((s) => `<button type="button" class="pp-btn pp-src" data-pp-stop
        data-pp-source="${esc(s.id)}" aria-pressed="${s.id === cur.sourceId}">${esc(s.label || s.id)}</button>`).join('') : '';
    const up = cur.album ? `<button type="button" class="pp-btn" data-pp-stop data-pp-album="${esc(albumOf(cur.album))}">Up a folder</button>` : '';
    const albumBtns = albums.map((a) => `<button type="button" class="pp-btn pp-album" data-pp-stop data-pp-album="${esc(a)}">${esc(nameOf(a))}</button>`).join('');
    if (!srcBtns && !up && !albumBtns) return '';
    return `<div class="pp-row pp-acts" data-pp-group="sources">${srcBtns}${up}${albumBtns}</div>`;
  }

  function resultsHtml() {
    if (list === null) return '<p class="pp-note">Looking for your pictures…</p>';
    if (!list.length) {
      return `<p class="pp-note" data-pp-empty>No pictures yet. Add one from this device${
        (() => { try { return fs.isSupported(); } catch { return false; } })() ? ', or connect a folder of pictures' : ''}.
        A folder can also be added under Media on the Home page.</p>`;
    }
    const L = listing();
    const src = srcOf(cur.sourceId);
    const where = `${esc(src?.label || cur.sourceId)}${cur.album ? ` / ${esc(cur.album)}` : ''}`;
    if (!L || L === 'loading') return `<p class="pp-note">Reading ${where}…</p>`;
    if (L.error) {
      // A folder whose permission lapsed is one press from fixed; saying "unreachable" would send
      // somebody to check their wifi.
      if (L.code === 'permission') {
        return `<p class="pp-warn" data-pp-error="permission">${where} needs permission again.</p>
          <div class="pp-row pp-acts" data-pp-group="allow"><button type="button" class="pp-btn" data-pp-stop data-pp-act="allow">Allow access to this folder</button></div>`;
      }
      return `<p class="pp-warn" data-pp-error="${esc(L.code || 'read')}">Could not read ${where}: ${esc(L.error)}</p>`;
    }
    const all = filterByName(L.items, query);
    const some = all.slice(0, shown);
    const rows = gridRows(some, cols).map((r) => `<div class="pp-row pp-tiles" data-pp-group="grid" style="--pp-cols:${cols}">
        ${r.map((it) => tile({ sourceId: cur.sourceId, path: it.path }, it.name || nameOf(it.path))).join('')}</div>`).join('');
    const none = !all.length
      ? `<p class="pp-note" data-pp-none>${query ? `No picture in ${where} matches “${esc(query)}”.` : `No pictures in ${where}.`}</p>` : '';
    const more = all.length > shown
      ? `<div class="pp-row pp-acts" data-pp-group="more"><button type="button" class="pp-btn" data-pp-stop data-pp-act="more">Show more (${all.length - shown} more)</button></div>` : '';
    return `<p class="pp-note" data-pp-count>${where}: ${all.length} picture${all.length === 1 ? '' : 's'}${query ? ` matching “${esc(query)}”` : ''}</p>
      <div class="pp-grid">${rows}</div>${none}${more}`;
  }

  function render() {
    if (dead) return;
    const box = root.querySelector('[data-pp-search]');
    const hadFocus = !!box && typeof document !== 'undefined' && document.activeElement === box;
    const caret = hadFocus ? [box.selectionStart, box.selectionEnd] : null;
    root.innerHTML = `<div class="pp" data-picture-picker>
      <p class="pp-head">${esc(title)}</p>
      <p class="pp-note">Pictures stay on this device or in your own folders. Nothing is sent anywhere.</p>
      ${recentHtml()}
      ${actionsHtml()}
      ${sourcesHtml()}
      ${list && list.length ? `<label class="pp-search">Search by name <input type="search" data-pp-search value="${esc(query)}"
        autocomplete="off" spellcheck="false" placeholder="Type part of a name"></label>` : ''}
      <div data-pp-results>${resultsHtml()}</div>
      <p class="pp-status" role="status" data-pp-status>${esc(status)}</p>
    </div>`;
    if (hadFocus) {
      const el = root.querySelector('[data-pp-search]');
      el?.focus?.();
      if (caret) { try { el.setSelectionRange(caret[0], caret[1]); } catch { /* not a text box */ } }
    }
    fillThumbs();
    paintLit();
  }
  function renderResults() {
    const el = root.querySelector('[data-pp-results]');
    if (!el) { render(); return; }
    el.innerHTML = resultsHtml();
    fillThumbs();
    paintLit();
  }

  // THUMBNAILS. Each takes a URL of its own (`resolveItemUrl` / the device store), resolved once per
  // picture per picker and released when the picker goes — never a URL off a shared listing.
  function urlFor(ref) {
    const k = `${ref.sourceId}\n${ref.path}`;
    if (!urls.has(k)) {
      const src = srcOf(ref.sourceId);
      urls.set(k, (async () => {
        if (!src) return null;
        try { return isDeviceSource(src) ? await dev.url(ref.path) : await resolveUrl(src, ref.path); }
        catch { return null; }
      })());
    }
    return urls.get(k);
  }
  function fillThumbs() {
    for (const t of root.querySelectorAll('[data-pp-pick]')) {
      const slot = t.querySelector('[data-pp-thumb]');
      if (!slot || slot.dataset.filled) continue;
      slot.dataset.filled = '1';
      urlFor({ sourceId: t.dataset.source, path: t.dataset.path }).then((got) => {
        if (dead || !got || !got.url || !slot.isConnected) return;
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = got.url;
        slot.append(img);
      });
    }
  }

  // ------------------------------------------------------------------ the scan
  const stopsIn = (g) => [...g.querySelectorAll('[data-pp-stop]')].filter((b) => !b.disabled);
  const groups = () => [...root.querySelectorAll('[data-pp-group]')].filter((g) => stopsIn(g).length);

  function paintLit() {
    for (const el of root.querySelectorAll('[data-on]')) { delete el.dataset.on; el.removeAttribute('aria-current'); }
    const gs = groups();
    if (lit.g >= gs.length) lit = { g: gs.length ? gs.length - 1 : -1, i: -1 };
    if (lit.g < 0) return;
    const g = gs[lit.g];
    const st = stopsIn(g);
    if (lit.i >= st.length) lit.i = st.length - 1;
    const on = lit.i >= 0 ? st[lit.i] : g;
    on.dataset.on = '1';
    on.setAttribute('aria-current', 'true');
    try { on.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* no layout */ }
  }
  function move(d) {
    const gs = groups();
    if (!gs.length) return;
    if (lit.g >= 0 && lit.i >= 0) {
      const n = stopsIn(gs[lit.g]).length;
      lit.i = ((lit.i + d) % n + n) % n;
    } else {
      lit = { g: lit.g < 0 ? (d > 0 ? 0 : gs.length - 1) : ((lit.g + d) % gs.length + gs.length) % gs.length, i: -1 };
    }
    paintLit();
  }
  function select() {
    const gs = groups();
    if (!gs.length) return;
    if (lit.g < 0) { lit = { g: 0, i: -1 }; paintLit(); return; }
    const st = stopsIn(gs[lit.g]);
    if (lit.i < 0) {
      if (st.length === 1) { activate(st[0]); return; }
      lit.i = 0; paintLit(); return;
    }
    activate(st[lit.i]);
  }
  function back() {
    if (lit.g >= 0 && lit.i >= 0) { lit.i = -1; paintLit(); return; }
    cancel();
  }

  // ------------------------------------------------------------------ wiring
  const gone = new AbortController();
  const on = (type, fn) => root.addEventListener(type, fn, { signal: gone.signal });
  on('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const el = t?.closest('[data-pp-stop]');
    if (!el || !root.contains(el) || el.disabled) return;
    // Not stopped: a host may want to know somebody is using it (the board editor's idle clock).
    // Hosts ignore clicks inside `[data-picture-picker]` for anything else.
    activate(el);
  });
  on('change', (e) => {
    if (!e.target?.matches?.('[data-pp-file]')) return;
    const files = e.target.files;
    addFiles(files).finally(() => { try { e.target.value = ''; } catch { /* read-only in a fake */ } });
  });
  on('input', (e) => {
    if (!e.target?.matches?.('[data-pp-search]')) return;
    query = e.target.value || '';
    shown = page;
    renderResults();
  });
  on('keydown', (e) => {
    const typing = e.target?.matches?.('input,textarea,select');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (typing) { e.target.blur?.(); return; } back(); return; }
    if (!keys || typing) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); move(1); }
    else if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(-1); }
    else if (k === 'Enter' && lit.g >= 0) { e.preventDefault(); e.stopPropagation(); select(); }
  });

  render();
  loadSources();

  return {
    next: () => move(1),
    prev: () => move(-1),
    select,
    back,
    refresh: () => render(),
    // For a host that has its own file input or drop zone (none yet): the same path as the button.
    addFiles: (files) => addFiles(files),
    destroy() {
      if (dead) return;
      dead = true;
      gone.abort();
      for (const p of urls.values()) p.then((got) => { try { got?.release?.(); } catch { /* gone */ } });
      urls.clear();
      root.innerHTML = '';
    },
    __probe: () => {
      const gs = groups();
      const g = lit.g >= 0 ? gs[lit.g] : null;
      const st = g ? stopsIn(g) : [];
      const litEl = g ? (lit.i >= 0 ? st[lit.i] : g) : null;
      const L = listing();
      return {
        sources: (list || []).map((s) => s.id), cur: { ...cur }, query, status,
        items: L && L !== 'loading' ? filterByName(L.items, query).length : null,
        tiles: root.querySelectorAll('[data-pp-group="grid"] [data-pp-pick]').length,
        groups: gs.map((x) => x.dataset.ppGroup), lit: { ...lit },
        litGroup: g ? g.dataset.ppGroup : null,
        litText: litEl ? (litEl.dataset.name || litEl.textContent.trim().replace(/\s+/g, ' ')) : null,
        recent: readRecent({ storage, max: recentMax }),
      };
    },
  };
}

/**
 * The picker on its own, over the page — for a host that has no place of its own to put it (the
 * Settings module's page of another panel's settings). Keys are on: nothing else is routing them.
 * Closes itself on a choice or a cancel. Resolves nothing; `onPick`/`onCancel` say what happened.
 */
export function openPictureDialog(opts = {}) {
  if (typeof document === 'undefined') return null;
  ensureCss();
  const wrap = document.createElement('div');
  wrap.className = 'pp-dialog';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', opts.title || 'Choose a picture');
  wrap.innerHTML = '<div class="pp-dialog-box" tabindex="-1"></div>';
  document.body.append(wrap);
  const box = wrap.querySelector('.pp-dialog-box');
  let api = null;
  const close = () => { api?.destroy(); wrap.remove(); };
  api = mountPicturePicker(box, {
    ...opts,
    keys: true,
    onPick: (ref) => { close(); opts.onPick?.(ref); },
    onCancel: () => { close(); opts.onCancel?.(); },
  });
  // A click on the dim area outside the box is a Cancel: a dialog nobody can click away reads as a crash.
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) { close(); opts.onCancel?.(); } });
  box.focus?.();
  return { ...api, close };
}
