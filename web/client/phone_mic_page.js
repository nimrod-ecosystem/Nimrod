// phone_mic_page.js — the page a phone opens to become a microphone for a screen (phone_mic.html).
//
// Row 2.42 / 2.44. The phone's half of `phone_mic.js`, with the one thing a phone page has to get
// right above everything else: IT MUST BE OBVIOUS, AT A GLANCE FROM ACROSS A ROOM, WHETHER THIS
// PHONE'S MICROPHONE IS ON. So the whole page changes when it is - a full-screen "Microphone on"
// state naming the screen that can hear it, and one large Stop.
//
// WHO CAN USE IT: somebody signed in on this phone who owns the person or holds a drive grant for
// them - the same people who can drive that person's screens, checked by the server when the
// socket's ticket is bought. The list of screens offered here IS that set (/api/people plus
// /api/drive/shared); nobody else's appear, and a ticket the server refuses is said plainly.
//
// WHAT IT NEVER DOES: open the camera, or play anything. There is no audio or video element on
// this page.
//
// KEEPING IT ALIVE: a browser takes the microphone away when the phone locks or the page goes to
// the background [training knowledge]. So it asks for a screen wake lock while live, and says so
// when the page is hidden. Row 2.44's stand-by-the-monitor arrangement (charging, screen on, this
// page pinned) is what keeps it alive for days; on Android, "screen pinning" holds one app in front.

import { connectDrive } from './drive.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createPhoneMicSender, newSession } from './phone_mic.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAME_KEY = 'nimrod:phoneMic:name';
const NEAR_KEY = 'nimrod:phoneMic:near';
const PERSON_KEY = 'nimrod:phoneMic:person';

const STATE_TEXT = {
  opening: 'Asking this phone for its microphone…',
  waiting: 'Microphone on — waiting for the screen to answer',
  live: 'Microphone on',
  reconnecting: 'Microphone on — reconnecting to the screen',
};
const END_TEXT = {
  busy: 'The screen already has a phone joined as its microphone.',
  'video-refused': 'The screen refused: this page only ever sends sound.',
  stopped: 'The screen turned this microphone off.',
  screen: 'The screen turned this microphone off.',
  'no-mic': 'This phone did not allow its microphone. Check the browser’s permission for this site.',
};

export async function mountPhoneMic(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  connect = connectDrive,
  makeSender = createPhoneMicSender,
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  base = '',
} = {}) {
  if (!root) throw new Error('mountPhoneMic: a root element is required');
  const get = (k, d = '') => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };

  let people = [];
  let link = null;
  let sender = null;
  let lock = null;
  let presence = { screens: 0, drivers: 0 };
  let target = null;
  let ended = null;
  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });

  root.innerHTML = '<main class="pm" data-body><p class="pm-note">Loading…</p></main>';
  const body = () => root.querySelector('[data-body]');

  async function getJSON(path) {
    const res = await fetchImpl(`${base}${path}`, { headers: authHeaders(null), credentials: 'same-origin' });
    if (!res.ok) throw httpError(res, `${path} -> ${res.status}`);
    return res.json();
  }

  async function loadPeople() {
    const mine = await getJSON('/api/people');
    let shared = { people: [] };
    try { shared = await getJSON('/api/drive/shared'); } catch { /* none shared is fine */ }
    const out = [];
    for (const p of mine.people || []) if (p && p.id) out.push({ id: p.id, name: p.name || 'My screen' });
    for (const p of shared.people || []) {
      if (p && p.person_id && !out.some((x) => x.id === p.person_id)) out.push({ id: p.person_id, name: p.name || 'A shared screen' });
    }
    return out;
  }

  // ---- rendering ------------------------------------------------------------------------
  function renderSignIn() {
    root.dataset.live = '0';
    body().innerHTML = `<h1>Use this phone as a microphone</h1>
      <p>Sign in on this phone first, with an account that is allowed to use the screen.</p>
      <p><a class="pm-btn pm-primary" href="/auth/login">Sign in</a></p>`;
  }

  function renderSetup() {
    root.dataset.live = '0';
    const want = new URLSearchParams(search || '').get('person') || get(PERSON_KEY, '');
    const pick = people.find((p) => p.id === want) || (people.length === 1 ? people[0] : null);
    body().innerHTML = `
      <h1>Use this phone as a microphone</h1>
      <p class="pm-lead">This phone sends what it hears to a screen, and nothing else: no camera,
        and no sound comes back. The screen shows when this microphone is on.</p>
      ${ended ? `<p class="pm-ended" role="status">${esc(ended)}</p>` : ''}
      ${people.length ? `
      <label class="pm-field"><span>Which screen</span>
        <select data-person>${people.map((p) => `<option value="${esc(p.id)}"${pick && pick.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
      <label class="pm-field"><span>What to call this phone</span>
        <input data-name maxlength="40" value="${esc(get(NAME_KEY, 'Phone'))}"></label>
      <label class="pm-field"><span>Who is it usually with? <i>(optional — subtitles show it as a guess)</i></span>
        <input data-near maxlength="40" value="${esc(get(NEAR_KEY, ''))}"></label>
      <button type="button" class="pm-btn pm-primary pm-big" data-start>Turn the microphone on</button>`
      : '<p>This account has no screens it may use. The screen’s owner can share one from the Remote tab.</p>'}`;
  }

  function renderLive() {
    const st = sender ? sender.state() : 'opening';
    root.dataset.live = st === 'opening' ? '0' : '1';
    const who = target ? target.name : 'the screen';
    const noScreen = link && presence.screens === 0 && st !== 'live';
    body().innerHTML = `
      <div class="pm-live" role="status" aria-live="polite">
        <div class="pm-live-word">${esc(STATE_TEXT[st] || 'Microphone on')}</div>
        <div class="pm-live-who">${st === 'live' ? `${esc(who)}’s screen can hear this phone` : esc(who)}</div>
        ${noScreen ? '<div class="pm-live-note">That screen is not open right now. This phone keeps trying.</div>' : ''}
        <div class="pm-live-note" data-hidden-note hidden>Keep this page open and the phone unlocked, or the microphone stops.</div>
      </div>
      <button type="button" class="pm-btn pm-stop pm-big" data-stop>Stop — turn the microphone off</button>`;
  }

  // ---- the microphone ------------------------------------------------------------------
  async function holdAwake() {
    try { lock = await nav?.wakeLock?.request?.('screen'); } catch { lock = null; }
  }
  function letSleep() { try { lock?.release?.(); } catch { /* gone */ } lock = null; }

  async function allowed(personId) {
    // Buys one ticket and throws it away: the one question the socket itself will not answer
    // (it retries quietly on a refusal). A 403 is "this account may not use that screen".
    try {
      const res = await fetchImpl(`${base}/api/drive/ticket/${encodeURIComponent(personId)}`,
        { method: 'POST', headers: authHeaders(null), credentials: 'same-origin' });
      if (res.status === 401 || res.status === 403) return false;
      return true;
    } catch { return true; }             // offline: let the socket's own retry deal with it
  }

  async function startMic() {
    const personId = root.querySelector('[data-person]')?.value;
    target = people.find((p) => p.id === personId) || null;
    if (!target) return;
    const name = (root.querySelector('[data-name]')?.value || '').trim() || 'Phone';
    const near = (root.querySelector('[data-near]')?.value || '').trim();
    put(NAME_KEY, name); put(NEAR_KEY, near); put(PERSON_KEY, target.id);
    ended = null;
    if (!(await allowed(target.id))) {
      ended = 'This account is not allowed to use that screen. Its owner can share it from the Remote tab.';
      renderSetup();
      return;
    }
    renderLive();
    link = connect({
      personId: target.id, role: 'driver', user: null, base,
      onPresence: (p) => { presence = { ...p }; if (sender) renderLive(); },
      onState: (s) => {
        // The socket came back after a drop: offer again on the same session.
        if (s === 'connected' && sender && ['waiting', 'reconnecting', 'live'].includes(sender.state())) sender.reconnect();
        else if (s === 'connected' && sender && sender.state() === 'idle') sender.start();
      },
    });
    let me = null;
    me = makeSender({
      link, session: newSession(), from: { name, ...(near ? { near } : {}) },
      onState: (st, why) => {
        // Only the sender this page is still holding may change the page. A Stop pressed here
        // ends it first and then lets it go; its own "ended" must not repaint over that.
        if (!me || sender !== me) return;
        if (st === 'ended' || st === 'no-mic') { finish(st === 'no-mic' ? END_TEXT['no-mic'] : (END_TEXT[why] || null)); return; }
        renderLive();
      },
    });
    sender = me;
    await holdAwake();
    if (!link.state || link.state() === 'connected') await sender.start();
  }

  function finish(message = null) {
    letSleep();
    const s = sender; sender = null;
    const l = link; link = null;
    try { if (s && s.state() !== 'ended') s.stop('stopped'); } catch { /* gone */ }
    try { s?.destroy?.(); } catch { /* gone */ }
    try { l?.close?.(); } catch { /* gone */ }
    ended = message;
    renderSetup();
  }

  on(root, 'click', (e) => {
    if (e.target.closest('[data-start]')) { startMic(); return; }
    if (e.target.closest('[data-stop]')) finish('The microphone is off.');
  });
  if (doc) {
    on(doc, 'visibilitychange', () => {
      const n = root.querySelector('[data-hidden-note]');
      if (n) n.hidden = !doc.hidden;
      if (!doc.hidden && sender && lock == null) holdAwake();
    });
  }

  try {
    people = await loadPeople();
    renderSetup();
  } catch (err) {
    if (isAuthError(err)) renderSignIn();
    else body().innerHTML = '<h1>Use this phone as a microphone</h1><p>Could not reach the site. Check the phone’s connection and reload.</p>';
  }

  return {
    state: () => (sender ? sender.state() : 'idle'),
    live: () => root.dataset.live === '1',
    stop: () => finish('The microphone is off.'),
    destroy() { finish(null); ac.abort(); },
  };
}
