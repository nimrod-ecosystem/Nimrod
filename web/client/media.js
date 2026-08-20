// media.js — the MEDIA SOURCES panel: connect the folders your photos live in.
//
// WHY THIS EXISTS: photos.js fails with "No photo source connected. Add one in
// Media / Sources." — and until this panel there WAS no Media / Sources. The
// registry API (/api/media-sources) and its client have existed since the start;
// the only missing piece was somewhere for a person to type a base_url.
//
// THE MODEL, in one line: the platform NEVER stores media, only a reference to
// where it lives (a label + a base_url), so something has to record that once.
// The bytes are then fetched by the browser straight from the agent at base_url.
//
// A NOTE ON base_url THAT SAVES A LOT OF CONFUSION: a source is per-USER, not
// per-device, and `http://localhost:8770` means "the agent on whatever machine is
// showing this screen". So ONE source entry can serve the kiosk at the bedside AND
// a desktop, each from its own local agent — provided each runs one. An HTTPS page
// is allowed to fetch http://localhost, which is why this works at all.

import { createMediaSourcesClient, resolveListing } from './media_sources.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DEFAULT_URL = 'http://localhost:8770';

// `client` and `resolve` are injectable so the test can drive this with no network.
export function mountMedia(root, { user = null, client = null, resolve = resolveListing } = {}) {
  const sources = client || createMediaSourcesClient({ user });
  let list = [];
  let busy = false;

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Media</h1>
        <p>Your photos and videos stay on your own machine — Nimrod only remembers
          <b>where</b> they are. Run the media agent on the computer that holds them, then
          connect it here once.</p>
      </div>

      <form class="h-new" data-new>
        <input type="text" data-label placeholder="Name it (e.g. Christine's photos)"
               aria-label="source name" required>
        <input type="text" data-url placeholder="${DEFAULT_URL}" value="${DEFAULT_URL}"
               aria-label="agent address" required>
        <button type="submit" class="h-btn h-primary">Connect</button>
      </form>
      <p class="h-hint"><b>${DEFAULT_URL}</b> means “the agent on whatever machine is showing
        the screen” — right for the usual setup where the agent runs on the kiosk itself.</p>

      <div class="h-msg" data-msg></div>
      <div class="h-list" data-list><p class="h-loading">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);
  const listEl = el('[data-list]');
  const msgEl = el('[data-msg]');

  const say = (text, bad = false) => {
    msgEl.textContent = text || '';
    msgEl.classList.toggle('bad', !!bad);
  };

  // Probe a source the same way a module will: ask the agent for its listing. This is
  // the difference between "saved" and "actually works" — a typo'd port or a stopped
  // agent otherwise shows up much later as an empty screen at the bedside.
  async function probe(src) {
    const cell = root.querySelector(`[data-probe="${CSS.escape(src.id)}"]`);
    if (!cell) return;
    cell.textContent = 'checking…';
    try {
      const listing = await resolve(src, '');
      const albums = listing.albums || [];
      const n = listing.count;
      cell.textContent = n
        ? `reachable — ${n} item${n === 1 ? '' : 's'}`
        : (albums.length
            ? `reachable, but no media at the top level — folders inside: ${albums.join(', ')}`
            : 'reachable, but the folder is empty');
      cell.classList.toggle('bad', !n);
    } catch {
      cell.textContent = 'not reachable — is the agent running on that machine?';
      cell.classList.add('bad');
    }
  }

  function card(s) {
    return `
      <div class="h-card">
        <div class="h-card-head">
          <b>${esc(s.label)}</b>
          <button class="h-btn" data-remove="${esc(s.id)}">Disconnect</button>
        </div>
        <div class="h-quiet">${esc(s.base_url)}</div>
        <div class="h-quiet" data-probe="${esc(s.id)}">checking…</div>
      </div>`;
  }

  function render() {
    listEl.innerHTML = list.length
      ? list.map(card).join('')
      : `<p class="h-loading">No media connected yet. Start the agent on the machine holding
           your photos, then connect it above.</p>`;

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
      listEl.innerHTML = '<p class="h-loading">Could not load your media sources.</p>';
    }
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
      // The server validates base_url, so a 400 here is almost always a typo'd address.
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

  el('[data-new]').addEventListener('submit', (e) => {
    e.preventDefault();
    const label = el('[data-label]').value.trim();
    const url = el('[data-url]').value.trim();
    if (label && url) add(label, url);
  });

  return { refresh, destroy() {} };
}
