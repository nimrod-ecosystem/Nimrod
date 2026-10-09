// account_screens.js — "SCREENS ON THIS ACCOUNT": every screen added with a code, on My dashboards -> Devices.
//
// WHY (2026-10-09). Commit 64a44f7 gave a screen in a room its own key, which never runs out. The server could
// already list those screens (GET /api/screens) and turn one off (DELETE /api/screens/{id}), but no page used either:
// the only off switch was the browser console, and every screen added was called "This screen". Mike, 2026-10-08:
// "Can't I set up the Pis as devices on my Nimrod account? ... so you could control everything from wherever you
// want." This list is step 1 of that.
//
// WHAT IT SHOWS, one row per screen: its name, when it was last heard from in plain words ("a minute ago", "3 days
// ago — gone quiet"), when it was added, Rename and Remove. The row for the screen this page is open on says
// "(this one)" — the SERVER decides that (it matches the key this browser sent against what it keeps), so the key
// itself is never handed to this page.
//
// WHERE: a section of the Devices tab, under its heading, rather than its own sidebar entry. Argued:
//   ITS OWN ENTRY: screens are the ACCOUNT's, while the rest of Devices is per person (the people bar changes it);
//     and Devices is already long (bindings, microphones, the marker camera).
//   DEVICES, and it wins: Mike's own words were "set up the Pis as devices", so Devices is where he will look; a
//     screen in a room is a device in exactly the sense the tab means; and an eighth sidebar entry named "Screens"
//     beside "Dashboards" (renamed FROM "Screens", PRIORITY.md #4) brings back the very confusion that rename
//     removed. The section says it is for the whole account. Moving it is one `mount` in home.js.
//
// REMOVE IS TWO PRESSES ON THE ROW, NOT A MODAL. The first press shows the sentence and "Yes, remove" / "Keep it" in
// place; nothing times out and nothing blocks the page, so if nobody answers, nothing happens and the screen keeps
// working. (A browser confirm() is a modal a switch user cannot always leave.)
//
// A SCREEN MAY LIST BUT NOT CHANGE. The server refuses rename/remove from a request let in only by a screen's own
// key (app.py SCREEN_CHANGE_REFUSAL) and says so in `can_change`; this page then hides the buttons and says where
// to do it instead, rather than offering buttons that will be refused.
//
// HARD-CODED, argued (Rule 1):
//   QUIET_AFTER_MS = 24 h   when "gone quiet" is added. A screen that is on checks in many times a minute, so any
//                           real silence is long; a day is past a screen switched off overnight (about 12 h), which
//                           is ordinary and must not look like trouble. An option of mountAccountScreens
//                           (`quietAfterMs`), not a setting on the page: nobody has asked to tune it, and a setting
//                           nobody asked for is clutter. Make it one if a family turns a screen off for weekends.
//   60 characters           the longest name, the server's SCREEN_NAME_MAX (app.py), mirrored on the input so a
//                           long name is stopped while typing instead of refused after.

import { authHeaders, setDeviceKey } from './auth.js';

export const QUIET_AFTER_MS = 24 * 3600 * 1000;
export const SCREEN_NAME_MAX = 60;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A server timestamp ("2026-10-09T12:00:00.123456+00:00") as ms, or NaN. Python writes six fractional digits;
 *  cut to three so every browser parses it the same way. */
export function parseWhen(iso) {
  if (!iso) return NaN;
  return Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1'));
}

/** How long ago, in words: "just now", "a minute ago", "3 hours ago", "yesterday", "3 days ago", "2 weeks ago",
 *  "4 months ago", "over a year ago". Pure. */
export function agoWords(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 365) return `${Math.floor(d / 30)} months ago`;
  return 'over a year ago';
}

/** The "last seen" line for a screen: { text, quiet }. `lastSeen` null means it has not checked in since it was
 *  added (it is quiet too once that was more than `quietAfterMs` ago). Pure given `now`. */
export function seenWords(lastSeen, createdAt, now = Date.now(), { quietAfterMs = QUIET_AFTER_MS } = {}) {
  const seen = parseWhen(lastSeen);
  if (Number.isNaN(seen)) {
    const added = parseWhen(createdAt);
    const quiet = !Number.isNaN(added) && now - added > quietAfterMs;
    return { text: 'Has not checked in since it was added', quiet };
  }
  const gap = now - seen;
  return { text: `Last seen ${agoWords(gap)}`, quiet: gap > quietAfterMs };
}

/** "Added 3 Oct 2026" in the reader's own date order. */
export function addedWords(createdAt, locale = undefined) {
  const t = parseWhen(createdAt);
  if (Number.isNaN(t)) return '';
  try {
    return `Added ${new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } catch { return `Added ${new Date(t).toISOString().slice(0, 10)}`; }
}

/** The sentence a first press on Remove shows. */
export function removeQuestion(label) {
  return `Remove “${label || 'this screen'}”? It will show a code until it’s added again.`;
}

const STYLE_ID = 'as-style';
const STYLE = `
.as{margin:0 0 22px;padding:14px 16px;background:var(--surface,#fff);border:1px solid var(--border,#e4e0c2);
  border-radius:var(--radius,16px);max-width:900px;min-width:0}
.as h2{font-size:1.15rem;margin:0 0 4px}
.as-intro{margin:0 0 10px;color:var(--text-soft,#3c5346);font-size:.9rem;max-width:60ch}
.as-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.as-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;
  padding:10px 12px;border:1px solid var(--border,#e4e0c2);border-radius:12px;min-width:0}
.as-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 220px}
.as-name{font-weight:700;overflow-wrap:anywhere}
.as-this{font-weight:600;color:var(--text-muted,#5d7064)}
.as-seen,.as-added{font-size:.85rem;color:var(--text-muted,#5d7064)}
.as-seen.quiet{color:var(--accent-warm-deep,#a85f52);font-weight:600}
.as-actions{display:flex;flex-wrap:wrap;gap:6px}
.as-actions .h-btn,.as-ask .h-btn,.as-rename .h-btn{min-height:44px}
.as-ask,.as-rename{flex:1 1 100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
.as-ask p{margin:0;flex:1 1 220px;font-weight:600;overflow-wrap:anywhere}
.as-rename label{display:flex;flex-direction:column;gap:2px;flex:1 1 220px;min-width:0;font-size:.85rem;
  color:var(--text-muted,#5d7064)}
.as-rename input{min-width:0;width:100%;padding:9px 11px;border:1px solid var(--border,#e4e0c2);border-radius:10px;
  background:var(--surface,#fff);color:var(--text,#0A3323);font:inherit;font-size:.95rem}
.as .h-btn:focus-visible,.as input:focus-visible,.as a:focus-visible{outline:3px solid var(--focus,var(--accent,#839958));
  outline-offset:2px}
.as-foot{margin:10px 0 0;font-size:.82rem;color:var(--text-muted,#5d7064);overflow-wrap:anywhere}
.as-foot a{color:var(--link,#105666)}
`;

function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID; s.textContent = STYLE;
  (doc.head || doc.documentElement).append(s);
}

/**
 * Mount the list into `root`. Options:
 *   fetchImpl     fetch (a suite passes a fake)
 *   headers       () => the auth headers (default auth.js authHeaders(user))
 *   user          the dev user, for those headers
 *   base          URL prefix ('' on the site)
 *   now           () => ms, for "how long ago"
 *   quietAfterMs  see QUIET_AFTER_MS
 *   forgetThis    called after the screen this page is ON is removed (default: forget its key, auth.js), so this
 *                 browser stops sending a key that no longer works
 */
export function mountAccountScreens(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  user = null,
  headers = () => authHeaders(user),
  base = '',
  now = () => Date.now(),
  quietAfterMs = QUIET_AFTER_MS,
  forgetThis = () => setDeviceKey(''),
  origin = (typeof location !== 'undefined' ? location.origin : ''),
} = {}) {
  if (!root) throw new Error('mountAccountScreens: a root element is required');
  ensureStyle(root.ownerDocument);
  const listeners = new AbortController();
  let rows = [];
  let canChange = true;
  let loaded = false;
  let failed = false;
  let busy = false;
  // Per row: 'renaming' | 'asking' (the first press on Remove). Absent = the plain row.
  const mode = new Map();

  root.innerHTML = `
    <section class="as" aria-labelledby="as-h" data-account-screens>
      <h2 id="as-h">Screens on this account</h2>
      <p class="as-intro">The screens you added with a code. Each one stays on by itself, after a restart too, until
        you remove it here. This list is for the whole account, whoever is picked above.</p>
      <div class="h-msg" data-as-msg role="status" aria-live="polite"></div>
      <div data-as-body><p class="h-loading">Loading…</p></div>
      <p class="as-foot" data-as-readonly hidden>This page is open on one of the screens, so it can only look. To
        rename or remove a screen, use your own phone or computer, signed in.</p>
      <p class="as-foot">To add a screen, open <b>${esc(origin)}/kiosk.html?pair=key</b> on it. It shows a code; enter
        the code on <a href="/pair.html">Add a screen</a>, where you can give it a name.</p>
    </section>`;

  const el = (sel) => root.querySelector(sel);
  const msgEl = el('[data-as-msg]');
  const body = el('[data-as-body]');
  const say = (text, bad = false) => { msgEl.textContent = text || ''; msgEl.classList.toggle('bad', !!bad); };

  function rowHTML(r) {
    const seen = seenWords(r.last_seen, r.created_at, now(), { quietAfterMs });
    const m = mode.get(r.id);
    const name = `<span class="as-name">${esc(r.label)}</span>${r.this ? ' <span class="as-this" data-as-this>(this one)</span>' : ''}`;
    const main = `<div class="as-main">
        <div>${name}</div>
        <span class="as-seen${seen.quiet ? ' quiet' : ''}" data-as-seen>${esc(seen.text)}${seen.quiet ? ' — gone quiet' : ''}</span>
        <span class="as-added" data-as-added>${esc(addedWords(r.created_at))}</span>
      </div>`;
    let tail = '';
    if (canChange && m === 'renaming') {
      tail = `<form class="as-rename" data-as-renameform="${esc(r.id)}">
          <label>New name for “${esc(r.label)}”
            <input type="text" data-as-name maxlength="${SCREEN_NAME_MAX}" value="${esc(r.label)}" autocomplete="off"></label>
          <button type="submit" class="h-btn h-primary">Save</button>
          <button type="button" class="h-btn" data-as-cancel="${esc(r.id)}">Cancel</button>
        </form>`;
    } else if (canChange && m === 'asking') {
      tail = `<div class="as-ask" data-as-ask="${esc(r.id)}">
          <p>${esc(removeQuestion(r.label))}</p>
          <button type="button" class="h-btn h-danger" data-as-yes="${esc(r.id)}">Yes, remove</button>
          <button type="button" class="h-btn" data-as-keep="${esc(r.id)}">Keep it</button>
        </div>`;
    } else if (canChange) {
      tail = `<div class="as-actions">
          <button type="button" class="h-btn h-quiet" data-as-rename="${esc(r.id)}">Rename</button>
          <button type="button" class="h-btn h-quiet h-danger" data-as-remove="${esc(r.id)}">Remove</button>
        </div>`;
    }
    return `<li class="as-row" data-as-id="${esc(r.id)}">${main}${tail}</li>`;
  }

  function render(focus = null) {
    el('[data-as-readonly]').hidden = !(loaded && !canChange && rows.length);
    if (!loaded) {
      body.innerHTML = failed
        ? '<p class="h-none">The screens on this account could not be loaded. Check your connection and open this tab again.</p>'
        : '<p class="h-loading">Loading…</p>';
      return;
    }
    body.innerHTML = rows.length
      ? `<ul class="as-list" data-as-list>${rows.map(rowHTML).join('')}</ul>`
      : '<p class="h-none" data-as-empty>No screens on this account yet.</p>';
    if (focus) {
      const f = root.querySelector(focus);
      if (f) { try { f.focus(); if (f.select) f.select(); } catch { /* not focusable */ } }
    }
  }

  async function call(method, path, payload) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(headers() || {}) },
      credentials: 'same-origin',
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function refresh() {
    try {
      const { res, data } = await call('GET', '/api/screens');
      if (!res.ok) throw new Error(`screens -> ${res.status}`);
      rows = Array.isArray(data.screens) ? data.screens : [];
      canChange = data.can_change !== false;
      loaded = true; failed = false;
      for (const id of [...mode.keys()]) if (!rows.some((r) => r.id === id)) mode.delete(id);
    } catch (err) {
      console.error('account screens: list', err);
      failed = !loaded;
    }
    render();
    return api;
  }

  const sel = (attr, id) => `[${attr}="${CSS.escape(id)}"]`;

  async function guard(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); } finally { busy = false; }
  }

  function failWith(res, data) {
    if (res && res.status === 403 && data && data.detail) say(String(data.detail), true);
    else if (res && res.status === 400) say('That name has a character a screen name cannot have. Use letters, numbers, spaces and . , \' -', true);
    else if (res && res.status === 404) say('That screen is not on this account any more.', true);
    else say('That didn’t save — check your connection and try again.', true);
  }

  async function rename(id, raw) {
    const name = String(raw || '').trim();
    const r = rows.find((x) => x.id === id);
    if (!name) { say('A screen needs a name.', true); return; }
    if (r && name === r.label) { mode.delete(id); render(sel('data-as-rename', id)); return; }
    await guard(async () => {
      let out;
      try { out = await call('PATCH', `/api/screens/${encodeURIComponent(id)}`, { label: name }); }
      catch { failWith(null); return; }
      if (!out.res.ok) { failWith(out.res, out.data); if (out.res.status === 404) await refresh(); return; }
      mode.delete(id);
      await refresh();
      say(`Renamed to “${out.data.label || name}”.`);
      render(sel('data-as-rename', id));
    });
  }

  async function remove(id) {
    const r = rows.find((x) => x.id === id);
    await guard(async () => {
      let out;
      try { out = await call('DELETE', `/api/screens/${encodeURIComponent(id)}`); }
      catch { failWith(null); return; }
      if (!out.res.ok && out.res.status !== 404) { failWith(out.res, out.data); return; }
      mode.delete(id);
      if (r && r.this) { try { forgetThis(); } catch (e) { console.error(e); } }
      await refresh();
      say(`“${r ? r.label : 'The screen'}” is removed. It will show a code until it is added again.`);
      // Focus lands somewhere real, not on a button that no longer exists.
      const first = root.querySelector('[data-as-rename], [data-as-empty], h2');
      if (first) { if (!first.hasAttribute('tabindex') && first.tagName !== 'BUTTON') first.setAttribute('tabindex', '-1'); try { first.focus(); } catch { /* fine */ } }
    });
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    if (d.asRename) { say(''); mode.set(d.asRename, 'renaming'); render(`${sel('data-as-renameform', d.asRename)} [data-as-name]`); return; }
    if (d.asCancel) { mode.delete(d.asCancel); say(''); render(sel('data-as-rename', d.asCancel)); return; }
    if (d.asRemove) { say(''); mode.set(d.asRemove, 'asking'); render(sel('data-as-keep', d.asRemove)); return; }
    if (d.asKeep) { mode.delete(d.asKeep); render(sel('data-as-remove', d.asKeep)); return; }
    if (d.asYes) { remove(d.asYes); }
  }, { signal: listeners.signal });

  root.addEventListener('submit', (e) => {
    const f = e.target.closest?.('[data-as-renameform]');
    if (!f) return;
    e.preventDefault();
    rename(f.dataset.asRenameform, f.querySelector('[data-as-name]')?.value);
  }, { signal: listeners.signal });

  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const f = e.target.closest?.('[data-as-renameform], [data-as-ask]');
    if (!f) return;
    const id = f.dataset.asRenameform || f.dataset.asAsk;
    mode.delete(id);
    render(sel(f.dataset.asRenameform ? 'data-as-rename' : 'data-as-remove', id));
  }, { signal: listeners.signal });

  const api = {
    refresh,
    rows: () => rows.map((r) => ({ ...r })),
    canChange: () => canChange,
    destroy() { listeners.abort(); root.innerHTML = ''; },
  };
  return api;
}
