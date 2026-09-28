// media.js — the MEDIA panel: connect the folders your photos live in.
//
// WHY THIS EXISTS: photos.js fails with "No photo source connected. Add one in
// Media / Sources." — and until this panel there WAS no Media / Sources. The
// registry API (/api/media-sources) and its client have existed since the start;
// the only missing piece was somewhere for a person to say where their photos are.
//
// TWO WAYS IN, and which one is RIGHT depends on a question, not on which is easier to
// set up — so the panel now leads with that question, the same pattern modules.html uses
// ("Start here: can they press anything?"): is this the screen you're on right now, or a
// screen somewhere else nobody sits at to answer a permission prompt? Both cards stay
// visible either way — this isn't a hard fork that hides one path, just a reordering of
// which one gets described first and which risk gets named up front.
//
// WHY THE QUESTION MATTERS AND ISN'T JUST FRAMING: tested directly (2026-09-10, see
// MIKE_CHANGE_LIST.md §3b-update) that a folder-picker grant does NOT survive a Chromium
// restart on a bare `--kiosk` launch — queryPermission() came back "prompt", not "granted",
// after a real kill-and-relaunch. So "this screen, right now" genuinely means someone is
// there to re-grant it when that lapses, and "somewhere else" genuinely means the agent is
// the only one of the two that survives unattended. The real test underneath the copy is
// "will a person be there to tap Allow again", not "which device" — but "which screen" is
// the readable proxy a caregiver can actually answer, so that's what the copy asks.
//
// The folder picker still needs nothing installed, so it still gets top billing in ITS
// OWN card — the fork doesn't invert that. It just stops implying the agent path is a
// worse, more advanced fallback, when for an unattended screen it's the only one that works.
//
// THE FOLDER PICKER IS ALSO THE SHARING STORY, and the panel never said so. Google Drive
// for Desktop, OneDrive and Dropbox all mount as an ORDINARY FOLDER, so pointing the
// picker at a synced folder means everyone with access to that folder can put photos in
// it and they appear on the screen — with nothing installed beyond the sync client the
// family already has, and nothing typed. That is the answer to "how do I get pictures to
// Grandma's screen", and it was invisible because the panel only said "on this computer".
//
// THE AGENT NO LONGER NEEDS ANYONE TO TRANSCRIBE A URL. Run it with --pair, it prints six
// characters, you type them here. That is the whole flow, and it is the same one Plex,
// Chromecast and Tailscale use — none of which ask you for an IP address.
//
// The address the source ends up with is worked out HERE and not on the server, because
// the agent genuinely cannot know which of its addresses this browser can reach:
// `localhost` only when they are the same machine, a LAN address only from the same
// network. So claiming a code hands back CANDIDATES, `findReachable` asks each one who it
// is, and the first that answers with the right agent id becomes the source. The question
// "which address do I type" no longer exists.
//
// Installing the agent is still an IT job — Python, a terminal, something left running —
// so that section stays labeled `advanced` and says so plainly. Pairing removes the part
// that was needlessly hard, not the part that is inherently a setup task.
//
// THE MODEL, unchanged by either: the platform NEVER stores media, only a reference to
// where it lives. Agent sources are per-USER (a base_url, shared across devices); folder
// sources are per-DEVICE (a handle in IndexedDB that cannot leave the machine — see
// folder_source.js). The panel labels which is which, because "why don't my photos show
// up on the other screen?" is otherwise a genuinely confusing afternoon.

import {
  createMediaSourcesClient, resolveListing, findReachable, normalizeCode, PAIR_CODE_LEN,
} from './media_sources.js';
import { createProfilesClient } from './profile.js';
import {
  isFolderPickerSupported, pickFolder, folderPermission, requestFolderAccess,
} from './folder_source.js';
import { createPresetLibrary } from './presets.js';
// Reused rather than re-implemented (§0g/register #255 point 4: "one code path, not two") —
// the exact parsing `youtube.js`'s own Add-video/Use-playlist controls already do. Importing
// this file is safe here: ES modules are evaluated once per resolved URL, so on every page
// that already loads the 'youtube' module (every real page this panel is mounted on) this is
// the SAME module instance, not a second `registerModule('youtube', …)` call.
import { parseVideoId, parsePlaylistId } from './modules/youtube.js';

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
  // `pairs` and `fetchAgent` are injectable for the same reason everything else here is:
  // the test drives a full pairing — claim, probe, save — with no server and no agent.
  pairs = null,
  fetchAgent = (...a) => fetch(...a),
  // Presets (register #255) — `presets` is an already-built `createPresetLibrary()` handle,
  // injectable exactly like `client` is, so the test drives create/list/edit/delete with no
  // server. Without one, `personId` + `makeUserState` build a real one (per-person — see
  // presets.js's header for the full scope argument). `makeUserState` is `home.js`'s OWN
  // per-person state factory, ALREADY curried onto the current person — the exact `(key, opts)
  // => handle` shape `inputs.js`/`output_panel.js` already receive under this same name, and
  // exactly what `createPresetLibrary({ makeState })` wants — `personId` is passed alongside it
  // only as the "has a person resolved at all" guard, never re-applied to the call.
  presets = null,
  personId = null,
  makeUserState = null,
} = {}) {
  const sources = client || createMediaSourcesClient({ user });
  const pairClient = pairs || createProfilesClient({ user });
  // Only torn down here if THIS call built it — an injected `presets` handle is the caller's
  // to manage, the same way an injected `client` is never destroyed by this file either.
  const ownsPresetLib = !presets;
  const presetLib = presets || ((personId && makeUserState)
    ? createPresetLibrary({ makeState: makeUserState })
    : null);
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

      <div class="h-card h-fork">
        <div class="h-card-head"><b>Start here: is this the screen you're using right now?</b></div>
        <p class="h-quiet">Or is it somewhere else — a bedside kiosk, a spare tablet, any
          screen nobody sits at to tap a permission prompt? That's the question that decides
          which option below actually holds up, more than which one is easier to set up.</p>
        <p class="h-quiet">Really, the test underneath it is narrower still: <b>will someone be
          there to tap Allow again if the connection ever lapses?</b> Your own laptop, closed for
          a month, hits the same lapse a bedside screen does — you're just there to clear it in
          one click. "Which screen" is just the readable way to tell those two cases apart.</p>
      </div>

      <div class="h-card">
        <div class="h-card-head"><b>This screen, right now</b> <span class="h-tag">no install</span></div>
        ${supported
          ? `<p class="h-quiet">Choose a folder and the browser reads it directly. Nothing to
               install. This folder is remembered <b>on this device only</b> — and only for as
               long as this browser keeps the permission, which a restart can clear. Fine if
               you're sitting here to grant it again; not the right choice for a screen nobody
               watches.</p>
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

      <div class="h-card">
        <div class="h-card-head"><b>A screen somewhere else</b> <span class="h-tag">survives a restart</span></div>
        <p class="h-quiet">This is the one for a bedside kiosk or any screen that boots up with
          nobody there to answer a prompt: once connected, it keeps working through a reboot or
          a power cut, with nothing to re-click. It does need something installed on that
          machine — a real setup step, not hidden here, just worth it for a screen that has to
          run unattended.</p>
        <p class="h-quiet">If someone has already set up the Nimrod media agent on that
          machine, it shows a <b>six-character code</b>. Type it here and the two find each
          other. You never need to know its address.</p>
        <form class="h-new" data-pair>
          <input type="text" data-code placeholder="Pairing code (e.g. 7KJ4QW)"
                 aria-label="pairing code" maxlength="12" autocomplete="off"
                 spellcheck="false" class="m-code" required>
          <button type="submit" class="h-btn h-primary">Connect</button>
        </form>
        <div class="h-msg" data-pairmsg></div>
      </div>

      <details class="h-card" data-advanced>
        <summary><b>Type an address instead</b> <span class="h-tag">advanced</span></summary>
        <p class="h-quiet"><b>Only if pairing will not do.</b> Pairing above is the same thing
          without needing an address, so this is here for an agent that cannot reach the
          internet to get a code, or one behind a fixed address you already know.</p>
        <p class="h-quiet">Setting the agent up on that machine is a job in itself: install
          Python, download the Nimrod media agent, and leave it running. Then either run it
          once with <code>--pair</code> and use the box above, or type its address here.</p>
        <p class="h-quiet">Unlike a folder, this is remembered for <b>your whole account</b>.
          <b>${DEFAULT_URL}</b> is a special case: it means “whichever machine is showing the
          screen, ask the agent running on it” — so one entry covers every kiosk that runs its
          own agent. For one specific machine, give its address on the network instead.</p>
        <form class="h-new" data-new>
          <input type="text" data-label placeholder="Name it (e.g. the bedside screen)"
                 aria-label="source name" required>
          <input type="text" data-url placeholder="${DEFAULT_URL}" value="${DEFAULT_URL}"
                 aria-label="agent address" required>
          <button type="submit" class="h-btn">Connect</button>
        </form>
      </details>

      <div class="h-card h-presets">
        <div class="h-card-head"><h2>Presets</h2></div>
        <p class="h-quiet">Save a module's settings under a name, then point more than one
          dashboard at it — a YouTube playlist and schedule you set up once, reused everywhere,
          instead of re-entering it on every screen. Each dashboard can still keep its own
          settings instead, unchanged, if you never pick a preset for it.</p>
        <div class="h-msg" data-preset-msg></div>
        <div class="h-list" data-preset-list><p class="h-loading">Loading…</p></div>
        <form class="h-new h-preset-form" data-preset-form>
          <input type="text" data-preset-name placeholder="Name this preset (e.g. Saturday cartoons)"
                 aria-label="preset name" required>
          <select data-preset-type aria-label="preset type">
            <option value="youtube">YouTube</option>
          </select>
          <textarea data-preset-playlist rows="3" style="width:100%;flex:1 1 100%"
            placeholder="Videos, one per line: a YouTube link or id, optionally '| channel name'"></textarea>
          <input type="text" data-preset-playlist-id
                 placeholder="Playlist link or id (PL…) — optional, instead of / as well as videos above">
          <textarea data-preset-schedule rows="3" style="width:100%;flex:1 1 100%"
            placeholder="Time-of-day playlists, one per line (optional): name | HH:MM | HH:MM (optional) | playlist link or id"></textarea>
          <label class="chk"><input type="checkbox" data-preset-shuffle checked> shuffle (off = play in order)</label>
          <button type="submit" class="h-btn h-primary" data-preset-save>Save preset</button>
          <button type="button" class="h-btn" data-preset-cancel hidden>Cancel edit</button>
        </form>
      </div>
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

  // ------------------------------------------------------------- Presets (register #255)
  //
  // Reuses `youtube.js`'s own parsers (`parseVideoId`/`parsePlaylistId`) so a link pasted
  // here is accepted or refused exactly the way it is inside a YouTube instance's own panel
  // — one rule for "is this a video/playlist link", not two that can quietly disagree.
  const presetSay = (text, bad = false) => {
    const m = el('[data-preset-msg]');
    if (!m) return;
    m.textContent = text || '';
    m.classList.toggle('bad', !!bad);
  };

  // One video/playlist-id per line, optionally `<link or id> | <channel>` — the same two
  // fields `youtube.js`'s own "Add" row collects, folded onto one line so this form does not
  // need to grow a repeating widget for what is, for a first pass, a paste-a-list job.
  function parsePlaylistLines(text) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const [urlPart, channelPart] = line.split('|');
      const id = parseVideoId((urlPart || '').trim());
      if (!id) continue;               // silently skipped, the same way a bad add is refused
      out.push({ id, title: id, channel: (channelPart || '').trim() || undefined });
    }
    return out;
  }
  const formatPlaylistLines = (list) => (Array.isArray(list) ? list : [])
    .map((v) => (v && v.channel ? `${v.id} | ${v.channel}` : (v && v.id) || '')).filter(Boolean).join('\n');

  function hoursFromTime(v) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) ? h + mi / 60 : null;
  }
  function hhmm(h) {
    const n = Math.max(0, Math.min(24, Number(h) || 0));
    const hh = Math.floor(n);
    const mm = Math.round((n - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  // `name | from | to | playlist` (4 fields) or `name | from | playlist` (3, no end) — the
  // same optional-"to" `youtube.js`'s own schedule editor already allows, just one line per
  // entry instead of four separate inputs.
  function parseScheduleLines(text) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split('|').map((s) => s.trim());
      const name = parts[0];
      const from = hoursFromTime(parts[1]);
      const to = parts.length >= 4 ? hoursFromTime(parts[2]) : null;
      const listId = parsePlaylistId(parts.length >= 4 ? parts[3] : parts[2]);
      if (from == null || !listId) continue;
      const entry = { name: name || `from ${hhmm(from)}`, start: from, playlistId: listId };
      if (to != null) entry.end = to;
      out.push(entry);
    }
    return out;
  }
  const formatScheduleLines = (list) => (Array.isArray(list) ? list : [])
    .map((d) => `${d.name || ''} | ${hhmm(d.start)}`
      + `${Number.isFinite(Number(d.end)) ? ' | ' + hhmm(d.end) : ''} | ${d.playlistId}`).join('\n');

  function summarizePreset(p) {
    const s = p.settings || {};
    const n = Array.isArray(s.playlist) ? s.playlist.length : 0;
    const sched = Array.isArray(s.schedule) ? s.schedule.length : 0;
    const bits = [`${n} video${n === 1 ? '' : 's'}`];
    if (s.playlistId) bits.push('a playlist link');
    if (sched) bits.push(`${sched} schedule ${sched === 1 ? 'entry' : 'entries'}`);
    bits.push(s.shuffle === false ? 'shuffle off' : 'shuffle on');
    return bits.join(' · ');
  }

  function presetCard(p) {
    return `
      <div class="h-card">
        <div class="h-card-head">
          <b>${esc(p.name)}</b>
          <span>
            <button class="h-btn" data-edit-preset="${esc(p.id)}">Edit</button>
            <button class="h-btn" data-remove-preset="${esc(p.id)}">Delete</button>
          </span>
        </div>
        <div class="h-quiet">${esc(p.type)} · ${esc(summarizePreset(p))}</div>
      </div>`;
  }

  function renderPresets() {
    const box = el('[data-preset-list]');
    if (!box) return;
    if (!presetLib) {
      box.innerHTML = '<p class="h-loading">Presets need a signed-in account with a dashboard set up.</p>';
      return;
    }
    const rows = presetLib.listPresets();
    box.innerHTML = rows.length ? rows.map(presetCard).join('')
      : '<p class="h-loading">No presets saved yet.</p>';
    for (const b of root.querySelectorAll('[data-edit-preset]')) {
      b.addEventListener('click', () => startEditPreset(b.dataset.editPreset));
    }
    for (const b of root.querySelectorAll('[data-remove-preset]')) {
      b.addEventListener('click', () => removePreset(b.dataset.removePreset));
    }
  }

  let editingPresetId = null;

  function resetPresetForm() {
    editingPresetId = null;
    el('[data-preset-form]')?.reset();
    const cancel = el('[data-preset-cancel]');
    if (cancel) cancel.hidden = true;
    const save = el('[data-preset-save]');
    if (save) save.textContent = 'Save preset';
  }

  function startEditPreset(id) {
    const p = presetLib?.getPreset(id);
    if (!p) return;
    editingPresetId = id;
    el('[data-preset-name]').value = p.name;
    el('[data-preset-type]').value = p.type;
    el('[data-preset-playlist]').value = formatPlaylistLines(p.settings?.playlist);
    el('[data-preset-playlist-id]').value = p.settings?.playlistId || '';
    el('[data-preset-schedule]').value = formatScheduleLines(p.settings?.schedule);
    el('[data-preset-shuffle]').checked = p.settings?.shuffle !== false;
    el('[data-preset-cancel]').hidden = false;
    el('[data-preset-save]').textContent = 'Save changes';
    presetSay('');
  }

  async function savePresetFromForm() {
    if (!presetLib) {
      presetSay('Presets need a signed-in account with a dashboard set up.', true);
      return;
    }
    const name = el('[data-preset-name]').value.trim();
    if (!name) { presetSay('Give the preset a name.', true); return; }
    const type = el('[data-preset-type]').value;
    const settings = {
      playlist: parsePlaylistLines(el('[data-preset-playlist]').value),
      playlistId: parsePlaylistId(el('[data-preset-playlist-id]').value),
      schedule: parseScheduleLines(el('[data-preset-schedule]').value),
      shuffle: el('[data-preset-shuffle]').checked,
    };
    try {
      await presetLib.savePreset({ id: editingPresetId, type, name, settings });
      const wasEdit = !!editingPresetId;
      resetPresetForm();
      renderPresets();
      presetSay(wasEdit ? 'Preset updated.' : 'Preset saved.');
    } catch (err) {
      console.error(err);
      presetSay(err.message || 'That preset could not be saved.', true);
    }
  }

  async function removePreset(id) {
    if (!presetLib) return;
    try {
      await presetLib.deletePreset(id);
      if (editingPresetId === id) resetPresetForm();
      renderPresets();
      presetSay('Preset deleted.');
    } catch (err) {
      console.error(err);
      presetSay('That preset could not be deleted.', true);
    }
  }

  async function refreshPresets() {
    if (!presetLib) { renderPresets(); return; }
    try {
      await presetLib.load();
      renderPresets();
      presetLib.startPolling?.();
    } catch (err) {
      console.error(err);
      const box = el('[data-preset-list]');
      if (box) box.innerHTML = '<p class="h-loading">Could not load your presets.</p>';
    }
  }

  el('[data-preset-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    savePresetFromForm();
  });
  el('[data-preset-cancel]').addEventListener('click', () => resetPresetForm());
  // Kept live: a preset saved or deleted from a DIFFERENT screen (or this same section on
  // another tab) should not need a manual reload to show up here — the same expectation
  // `state.subscribe` already sets for every other saved setting in this codebase.
  presetLib?.subscribe?.(() => renderPresets());

  async function refresh() {
    try {
      list = await sources.list();
      render();
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<p class="h-loading">Could not load your connected photos.</p>';
    }
    await refreshPresets();
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

  // Type a code -> claim it -> find the address that answers -> save the source.
  //
  // The two failures are told apart on purpose. A code that will not claim is a problem
  // with the CODE (mistyped, used, expired) and the server's sentence says which. A code
  // that claims but whose agent cannot be reached is a problem with the NETWORK, and
  // sending someone back to retype six characters they got right would waste their
  // evening — so it says that instead, and names what to check.
  async function claim(rawCode) {
    if (busy) return;
    busy = true;
    const pm = el('[data-pairmsg]');
    const tell = (t, bad = false) => { pm.textContent = t; pm.classList.toggle('bad', !!bad); };
    tell('Connecting…');
    try {
      const pairing = await pairClient.claimPairing(normalizeCode(rawCode));
      tell('Found it. Checking how to reach it…');
      const hit = await findReachable(pairing.base_urls, pairing.agent_id, { fetchImpl: fetchAgent });
      if (!hit) {
        // The code was spent by the claim, so say so — otherwise they retype it and get
        // "already used", which reads as a bug on top of a failure.
        tell(`Paired with “${pairing.label}”, but this browser cannot reach it. `
          + 'Both machines need to be on the same network, and the agent has to be running. '
          + 'Restart the agent for a fresh code and try again.', true);
        return;
      }
      await sources.add({ label: pairing.label, base_url: hit.base_url, kind: 'agent' });
      el('[data-code]').value = '';
      await refresh();
      tell(`Connected “${pairing.label}”.`);
    } catch (err) {
      console.error(err);
      tell(err.message || 'That code did not work.', true);
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

  el('[data-pair]').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normalizeCode(el('[data-code]').value);
    const pm = el('[data-pairmsg]');
    if (code.length !== PAIR_CODE_LEN) {
      pm.textContent = `A pairing code is ${PAIR_CODE_LEN} characters.`;
      pm.classList.add('bad');
      return;
    }
    claim(code);
  });

  if (supported) el('[data-pick]').addEventListener('click', choose);

  el('[data-new]').addEventListener('submit', (e) => {
    e.preventDefault();
    const label = el('[data-label]').value.trim();
    const url = el('[data-url]').value.trim();
    if (label && url) add(label, url);
  });

  return {
    refresh,
    destroy() {
      // Only torn down when this call built the library itself — an injected `presets`
      // handle is the caller's own to manage (see `ownsPresetLib` above).
      if (ownsPresetLib) { try { presetLib?.destroy(); } catch { /* already gone */ } }
    },
  };
}
