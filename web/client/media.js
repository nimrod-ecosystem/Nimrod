// media.js — the MEDIA panel: connect the folders your photos live in.
//
// WHY THIS EXISTS: photos.js fails with "No photo source connected. Add one in
// Media / Sources." — and until this panel there WAS no Media / Sources. The
// registry API (/api/media-sources) and its client have existed since the start;
// the only missing piece was somewhere for a person to say where their photos are.
//
// TWO WAYS IN, and the order matters. Picking a folder in the browser is FIRST because
// it needs nothing installed — that is the path a person should ever see. Running the
// media agent is second, and it is for a DEVICE: a bedside kiosk that boots unattended
// and must serve files with nobody logged in. Leading with the agent (as this panel
// first did) makes the product look like it requires a Python install to view your own
// photos, which is not a product.
//
// THE FOLDER PICKER IS ALSO THE SHARING STORY, and the panel never said so. Google Drive
// for Desktop, OneDrive and Dropbox all mount as an ORDINARY FOLDER, so pointing the
// picker at a synced folder means everyone with access to that folder can put photos in
// it and they appear on the screen — with nothing installed beyond the sync client the
// family already has, and nothing typed. That is the answer to "how do I get pictures to
// Grandma's screen", and it was invisible because the panel only said "on this computer".
//
// THE AGENT IS AN IT JOB AND IS NOW LABELLED AS ONE. Download a script, install Python,
// open a terminal, leave it running, then transcribe a URL back into this box. That is a
// reasonable ask of whoever sets up a facility's kiosk and an unreasonable one of anybody
// else, so it says so rather than sitting there looking like the second of two equal
// choices. (The real fix is a pairing code — the agent shows six digits, you type them
// here, nobody transcribes a URL. Not built; see pending_flags.)
//
// THE MODEL, unchanged by either: the platform NEVER stores media, only a reference to
// where it lives. Agent sources are per-USER (a base_url, shared across devices); folder
// sources are per-DEVICE (a handle in IndexedDB that cannot leave the machine — see
// folder_source.js). The panel labels which is which, because "why don't my photos show
// up on the other screen?" is otherwise a genuinely confusing afternoon.

import { createMediaSourcesClient, resolveListing } from './media_sources.js';
import {
  isFolderPickerSupported, pickFolder, folderPermission, requestFolderAccess,
} from './folder_source.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULT_URL = 'http://localhost:8770';

// `client`, `resolve` and `folders` are injectable so the test can drive every state
// without a server, a media agent, or a real folder-permission prompt.
export function mountMedia(root, {
  user = null,
  client = null,
  resolve = resolveListing,
  folders = null,
} = {}) {
  const sources = client || createMediaSourcesClient({ user });
  const fs = folders || {
    isSupported: isFolderPickerSupported,
    pick: pickFolder,
    permission: folderPermission,
    request: requestFolderAccess,
  };
  let list = [];
  let busy = false;

  const supported = fs.isSupported();

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Media</h1>
        <p>Your photos and videos stay on your own machine — Nimrod only remembers
          <b>where</b> they are. Nothing is uploaded.</p>
      </div>

      <div class="h-card">
        <div class="h-card-head"><b>Photos on this computer</b></div>
        ${supported
          ? `<p class="h-quiet">Choose a folder and the browser reads it directly. Nothing to
               install. This folder is remembered <b>on this device only</b>.</p>
             <p class="h-quiet"><b>Sharing photos with the rest of the family?</b> Pick a folder
               that Google Drive, OneDrive or Dropbox already syncs onto this computer. Anyone
               you share that folder with can drop photos in from their own phone, and they
               turn up on the screen. Nothing else to set up.</p>
             <button class="h-btn h-primary" data-pick>Choose a folder…</button>`
          : `<p class="h-quiet">This browser can’t open a folder directly — that needs Chrome,
               Edge, or another Chromium browser. Use the media agent below instead.</p>`}
      </div>

      <div class="h-msg" data-msg></div>
      <div class="h-list" data-list><p class="h-loading">Loading…</p></div>

      <details class="h-card" data-advanced>
        <summary><b>Connect a device that serves media</b> <span class="h-tag">advanced</span></summary>
        <p class="h-quiet"><b>This one is a setup job, not a click.</b> It is for a screen that
          runs on its own with nobody signed in — a bedside kiosk, a spare tablet, a NAS. On
          <i>that</i> machine you install Python, download the Nimrod media agent, and leave it
          running; then you come back here and type the address it is listening on. If that
          sentence is not something you want to do, use a folder above instead — it does the
          same job for a screen you are sitting at.</p>
        <p class="h-quiet">Unlike a folder, this is remembered for <b>your whole account</b>.
          <b>${DEFAULT_URL}</b> is a special case: it means “whichever machine is showing the
          screen, ask the agent running on it” — so one entry covers every kiosk that runs its
          own agent. For one specific machine, give its address on the network instead.</p>
        <form class="h-new" data-new>
          <input type="text" data-label placeholder="Name it (e.g. Christine's bedside)"
                 aria-label="source name" required>
          <input type="text" data-url placeholder="${DEFAULT_URL}" value="${DEFAULT_URL}"
                 aria-label="agent address" required>
          <button type="submit" class="h-btn">Connect</button>
        </form>
      </details>
    </div>`;

  const el = (sel) => root.querySelector(sel);
  const listEl = el('[data-list]');
  const msgEl = el('[data-msg]');

  const say = (text, bad = false) => {
    msgEl.textContent = text || '';
    msgEl.classList.toggle('bad', !!bad);
  };

  // Probe a source the way a module will, so "saved" and "actually works" are not confused.
  // A stopped agent or a lapsed folder permission otherwise shows up much later as a blank
  // screen at a bedside, which is the worst possible place to discover it.
  async function probe(src) {
    const cell = root.querySelector(`[data-probe="${CSS.escape(src.id)}"]`);
    if (!cell) return;
    cell.textContent = 'checking…';
    cell.classList.remove('bad');

    if (src.kind === 'folder') {
      const perm = await fs.permission(src.id);
      if (perm === 'missing') {
        cell.textContent = 'this device no longer has this folder — connect it again';
        cell.classList.add('bad');
        return;
      }
      if (perm !== 'granted') {
        // Not an error state to hide: the browser drops folder permission on restart unless
        // it was granted persistently, and someone has to click to restore it.
        cell.innerHTML = 'needs permission again — '
          + `<button class="h-btn" data-allow="${esc(src.id)}">Allow access</button>`;
        cell.classList.add('bad');
        cell.querySelector('[data-allow]').addEventListener('click', () => allow(src));
        return;
      }
    }

    try {
      const listing = await resolve(src, '');
      const albums = listing.albums || [];
      const n = listing.count;
      cell.textContent = n
        ? `ready — ${n} item${n === 1 ? '' : 's'}`
        : (albums.length
            ? `no photos at the top level — folders inside: ${albums.join(', ')}`
            : 'this folder is empty');
      cell.classList.toggle('bad', !n);
    } catch {
      cell.textContent = src.kind === 'folder'
        ? 'could not read this folder'
        : 'not reachable — is the agent running on that machine?';
      cell.classList.add('bad');
    }
  }

  async function allow(src) {
    const res = await fs.request(src.id);
    if (res === 'granted') { say(''); probe(src); }
    else say('Access was not granted, so those photos can’t be shown.', true);
  }

  function card(s) {
    const where = s.kind === 'folder'
      ? 'a folder on this device'
      : esc(s.base_url || '');
    const scope = s.kind === 'folder' ? 'this device only' : 'all your devices';
    return `
      <div class="h-card">
        <div class="h-card-head">
          <b>${esc(s.label)}</b>
          <button class="h-btn" data-remove="${esc(s.id)}">Disconnect</button>
        </div>
        <div class="h-quiet">${where} · ${scope}</div>
        <div class="h-quiet" data-probe="${esc(s.id)}">checking…</div>
      </div>`;
  }

  function render() {
    listEl.innerHTML = list.length
      ? list.map(card).join('')
      : `<p class="h-loading">No photos connected yet.${supported
            ? ' Choose a folder above to get started.'
            : ''}</p>`;

    for (const b of root.querySelectorAll('[data-remove]')) {
      b.addEventListener('click', () => remove(b.dataset.remove));
    }
    for (const s of list) probe(s);
  }

  async function refresh() {
    try {
      list = await sources.list();
      render();
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<p class="h-loading">Could not load your connected photos.</p>';
    }
  }

  async function choose() {
    if (busy) return;
    busy = true;
    say('');
    try {
      await fs.pick('');
      await refresh();
      say('Folder connected.');
    } catch (err) {
      // An AbortError just means they closed the picker — that is not a failure to report.
      if (err && err.name === 'AbortError') say('');
      else { console.error(err); say('That folder could not be opened.', true); }
    } finally { busy = false; }
  }

  async function add(label, base_url) {
    if (busy) return;
    busy = true;
    say('');
    try {
      await sources.add({ label, base_url, kind: 'agent' });
      el('[data-label]').value = '';
      await refresh();
      say('Connected.');
    } catch (err) {
      console.error(err);
      // The server validates base_url, so a failure here is almost always a typo'd address.
      say('That didn’t connect — check the address (it must start with http:// or https://).', true);
    } finally { busy = false; }
  }

  async function remove(id) {
    if (busy) return;
    busy = true;
    try {
      await sources.remove(id);
      await refresh();
      say('Disconnected. Your files were not touched.');
    } catch (err) {
      console.error(err);
      say('That didn’t disconnect — try again.', true);
    } finally { busy = false; }
  }

  if (supported) el('[data-pick]').addEventListener('click', choose);

  el('[data-new]').addEventListener('submit', (e) => {
    e.preventDefault();
    const label = el('[data-label]').value.trim();
    const url = el('[data-url]').value.trim();
    if (label && url) add(label, url);
  });

  return { refresh, destroy() {} };
}
