// play_page.js — THE PAGE A PHONE OPENS TO JOIN A GAME (play.html?room=CODE). 2026-10-06.
//
// Quiz mix's "Play together" shows a code and a square to scan; the square opens this page, and so does the call
// page's "Play" beside the video (Quiz mix's "On this call"). It mounts Quiz mix for whoever is signed in here, joins
// the room, and plays THEIR OWN seat on THEIR OWN levels: the player's level is read from and written to their own
// person's row on this login (the same row every screen of theirs uses), never the host's. Nothing about them
// crosses to the host but each turn's { seat, category, right, points } (game_rooms.py).
//
// WHO: the signed-in login's own first person ("Me", or their name). Signed out: a Sign in link that comes back here.
// No code, or a mistyped one: a box to type it in. The page is a phone's page, not a screen's, so it opens nothing
// by itself and leaves nothing running when it is closed (pagehide destroys the game, which leaves the room).

import { createBus } from './bus.js';
import { mountModule } from './module.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createState } from './state.js';
import { normalizeCode, codeWords } from './game_room.js';
import './modules/quiz_mix.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A state handle that lives only in this page (the questions' own ratings, the panel's settings). */
export function memoryState(init = {}) {
  let d = { ...init };
  const subs = new Set();
  return {
    get: () => d,
    set: (p) => { d = { ...d, ...p }; for (const f of [...subs]) { try { f(d); } catch { /* listener */ } } },
    load: async () => d, flush: async () => {}, startPolling() {}, destroy() {},
    subscribe: (fn) => { subs.add(fn); try { fn(d); } catch { /* listener */ } return () => subs.delete(fn); },
  };
}

export async function mountPlayPage(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  win = (typeof window !== 'undefined' ? window : null),
  user = null,
  base = '',
  gameLink = null,                     // a suite's fake game socket (game_room.js shape)
} = {}) {
  if (!root) throw new Error('mountPlayPage: a root element is required');
  const code = normalizeCode(new URLSearchParams(search || '').get('room') || '');
  let inst = null;
  root.innerHTML = '<main class="pp" data-body><p class="pp-note">Loading…</p></main>';
  const body = () => root.querySelector('[data-body]');

  async function getJSON(path) {
    const res = await fetchImpl(`${base}${path}`, { headers: authHeaders(user), credentials: 'same-origin' });
    if (!res.ok) throw httpError(res, `${path} -> ${res.status}`);
    return res.json();
  }

  function renderSignIn() {
    const next = `/play.html${code ? `?room=${encodeURIComponent(code)}` : ''}`;
    body().innerHTML = `<h1>Play together</h1><p>Sign in first, then you join the game with your own levels.</p>
      <p><a class="pp-btn" href="/auth/login?next=${encodeURIComponent(next)}">Sign in</a></p>`;
  }
  function renderAsk(wrong = false) {
    body().innerHTML = `<h1>Play together</h1>
      <form data-code-form><label>The game's code <input data-code inputmode="text" autocomplete="off" autocapitalize="characters"
        spellcheck="false" maxlength="9" required></label> <button class="pp-btn" type="submit">Join</button></form>
      ${wrong ? '<p role="alert">That is not a game code. A code is six letters and numbers, like KX4 9PM.</p>' : ''}`;
    body().querySelector('[data-code-form]')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = normalizeCode(body().querySelector('[data-code]')?.value || '');
      if (!c) { renderAsk(true); return; }
      try { win?.history?.replaceState?.(null, '', `/play.html?room=${c}`); } catch { /* fine */ }
      start(c, me);
    });
  }

  let me = null;
  function start(c, person) {
    body().innerHTML = `<h1 class="pp-title">Quiz mix <span class="pp-code">· ${esc(codeWords(c))}</span></h1><div class="pp-game" data-game></div>`;
    const host = body().querySelector('[data-game]');
    const personId = person?.id || null;
    const makePersonState = (pid, key, opts = {}) => (pid
      ? createState({ url: `${base}/api/people/${pid}/state/${key}`, user, cacheKey: `person:${user}:${pid}:${key}`, ...opts })
      : null);
    const rows = new Map();
    inst = mountModule('quiz_mix', {
      mount: host, bus: createBus(), user, personId, instanceId: 'quiz_mix-play',
      // The panel's own settings live only here (autostart off: the host's Start starts it).
      state: memoryState({ autostart: false }),
      // The questions' ratings: this page only. The PLAYER's level: their own row, on the server.
      makeState: (key) => { if (!rows.has(key)) rows.set(key, memoryState()); return rows.get(key); },
      makePersonState,
      playerName: person?.name && person.name.toLowerCase() !== 'me' ? person.name : '',
      autoJoin: c,
      ...(gameLink ? { gameLink } : {}),
    });
    inst.init();
  }

  win?.addEventListener?.('pagehide', () => { try { inst?.destroy(); } catch { /* gone */ } inst = null; });

  try {
    const people = (await getJSON('/api/people')).people || [];
    me = people.find((p) => p.kind === 'you') || people[0] || null;
  } catch (err) {
    if (isAuthError(err)) { renderSignIn(); return { state: () => 'signin' }; }
    body().innerHTML = '<h1>Play together</h1><p>Could not reach the site. Check the connection and reload.</p>';
    return { state: () => 'offline' };
  }
  if (!code) renderAsk(false); else start(code, me);
  return {
    state: () => (inst ? 'playing' : 'asking'),
    instance: () => inst,
    destroy() { try { inst?.destroy(); } catch { /* gone */ } inst = null; },
  };
}
