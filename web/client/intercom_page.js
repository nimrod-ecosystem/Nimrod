// intercom_page.js — the page a family member's phone opens to talk to a room (intercom.html). Row 2.44.
//
// The phone's half of intercom.js. Like the phone-microphone page (phone_mic_page.js), the one thing it
// must get right is that it is OBVIOUS whether this phone is talking to the room: while it is, a bar
// across the top in the browser's top layer says "Intercom open" and names the room, with Stop beside
// it - one press ends it at both ends. The room shows its own notice the whole time (intercom.js).
//
// WHO CAN USE IT: somebody signed in who may use that person's screens (a drive grant, checked by the
// server) AND whom the room has added to its intercom list (checked by the ROOM, against the account the
// server stamps on the offer). A phone that is not on the list is told so in plain words.
//
// It plays the room's sound on this phone - that is the point of an intercom - and never opens a camera.

import { connectDrive } from './drive.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createIntercomSender, newSession, END_REASONS } from './intercom.js';
import { createWakeHold, wakeNote } from './phone_mic_show.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PERSON_KEY = 'nimrod:intercom:person';

const STATE_TEXT = {
  opening: 'Asking this phone for its microphone…',
  asking: 'Asking the room — it hears a chime first',
  open: 'Intercom open',
  reconnecting: 'Intercom open — reconnecting',
};

export async function mountIntercomPage(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  connect = connectDrive,
  makeSender = createIntercomSender,
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  makeAudio = () => (typeof Audio !== 'undefined' ? new Audio() : null),
  base = '',
} = {}) {
  if (!root) throw new Error('mountIntercomPage: a root element is required');
  const get = (k, d = '') => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };

  let people = [];
  let link = null;
  let sender = null;
  let target = null;
  let ended = null;
  let player = null;
  let run = 0;
  const ac = new AbortController();
  const on = (el, type, fn) => el.addEventListener(type, fn, { signal: ac.signal });
  const wake = createWakeHold({ nav, doc, onChange: () => paintLive() });

  root.innerHTML = '<main class="pm" data-body><p class="pm-note">Loading…</p></main>';
  const body = () => root.querySelector('[data-body]');
  const q = (sel) => root.querySelector(sel);

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

  function renderSignIn() {
    root.dataset.live = '0'; root.dataset.view = 'setup';
    body().innerHTML = `<h1>Talk to a room</h1>
      <p>Sign in on this phone first, with an account the room has added to its intercom.</p>
      <p><a class="pm-btn pm-primary" href="/auth/login">Sign in</a></p>`;
  }

  function renderSetup() {
    root.dataset.live = '0'; root.dataset.view = 'setup';
    const want = new URLSearchParams(search || '').get('person') || get(PERSON_KEY, '');
    const pick = people.find((p) => p.id === want) || (people.length === 1 ? people[0] : null);
    body().innerHTML = `
      <h1>Talk to a room</h1>
      <p class="pm-lead">An intercom: you hear the room, and the room hears you. The room hears a chime and
        your name first, shows that the intercom is open the whole time, and can end it with one press.</p>
      ${ended ? `<p class="pm-ended" role="status">${esc(ended)}</p>` : ''}
      ${people.length ? `
      <label class="pm-field"><span>Which room</span>
        <select data-person>${people.map((p) => `<option value="${esc(p.id)}"${pick && pick.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
      <button type="button" class="pm-btn pm-primary pm-big" data-start>Open the intercom</button>
      <p class="pm-note">Only people the room has added can open it. Whoever looks after the screen adds people.</p>
      <p class="pm-note" data-call-link>To see each other as well, <a href="./call.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">place a call</a> instead.</p>`
      : '<p>This account has no screens it may use. The screen’s owner can share one from the Remote tab.</p>'}`;
  }

  function buildLive() {
    root.dataset.view = 'live';
    body().innerHTML = `
      <div class="pm-onair" data-onair popover="manual">
        <div class="pm-bar" role="status" aria-live="polite">
          <span class="pm-dot" aria-hidden="true"></span>
          <span class="pm-bar-text"><b class="pm-bar-word" data-word></b><span class="pm-bar-who" data-who></span></span>
          <button type="button" class="pm-btn pm-stop" data-stop>Stop</button>
        </div>
      </div>
      <div class="pm-live"><div class="pm-live-word" data-big-word></div><div class="pm-live-who" data-big-who></div></div>
      <div class="pm-notes">
        <p class="pm-live-note" data-hidden-note hidden>Keep this page open and the phone unlocked, or the intercom stops.</p>
        <p class="pm-live-note" data-wake-note hidden></p>
      </div>`;
    const onair = q('[data-onair]');
    let top = false;
    try { if (typeof onair.showPopover === 'function') { onair.showPopover(); top = onair.matches(':popover-open'); } } catch { top = false; }
    if (!top) onair.removeAttribute('popover');
  }

  function paintLive() {
    if (root.dataset.view !== 'live') return;
    const st = sender ? sender.state() : 'opening';
    root.dataset.live = st === 'opening' ? '0' : '1';
    const word = STATE_TEXT[st] || 'Intercom open';
    const who = target ? target.name : 'the room';
    const whoText = st === 'open' ? `You and ${who}’s room can hear each other` : who;
    const set = (sel, text) => { const el = q(sel); if (el) el.textContent = text; };
    set('[data-word]', word); set('[data-who]', whoText);
    set('[data-big-word]', word); set('[data-big-who]', whoText);
    const wn = q('[data-wake-note]');
    if (wn) { const t = sender ? wakeNote(wake.status()) : ''; wn.textContent = t; wn.hidden = !t; }
    const hn = q('[data-hidden-note]');
    if (hn) hn.hidden = !doc?.hidden;
  }

  async function allowed(personId) {
    try {
      const res = await fetchImpl(`${base}/api/drive/ticket/${encodeURIComponent(personId)}`,
        { method: 'POST', headers: authHeaders(null), credentials: 'same-origin' });
      if (res.status === 401 || res.status === 403) return false;
      return true;
    } catch { return true; }
  }

  function playRoom(stream) {
    if (!stream) { if (player) { try { player.pause?.(); player.srcObject = null; } catch { /* gone */ } } return; }
    if (!player) player = makeAudio();
    if (!player) return;
    try { player.srcObject = stream; player.play?.()?.catch?.(() => {}); } catch (err) { console.error('intercom: play', err); }
  }

  async function start() {
    const personId = q('[data-person]')?.value;
    target = people.find((p) => p.id === personId) || null;
    if (!target) return;
    put(PERSON_KEY, target.id);
    ended = null;
    if (!(await allowed(target.id))) {
      ended = 'This account is not allowed to use that screen. Its owner can share it from the Remote tab.';
      renderSetup();
      return;
    }
    const my = ++run;
    buildLive();
    paintLive();
    link = connect({
      personId: target.id, role: 'driver', user: null, base,
      onState: (s) => {
        if (s === 'connected' && sender && ['asking', 'reconnecting', 'open'].includes(sender.state())) sender.reconnect();
        else if (s === 'connected' && sender && sender.state() === 'idle') sender.start();
      },
    });
    let me = null;
    me = makeSender({
      link, session: newSession(), from: {},
      onRemote: (stream) => { if (sender === me) playRoom(stream); },
      onState: (st, why) => {
        if (!me || sender !== me) return;
        if (st === 'ended' || st === 'no-mic') {
          finish(st === 'no-mic' ? 'This phone did not allow its microphone. Check the browser’s permission for this site.' : (END_REASONS[why] || null));
          return;
        }
        paintLive();
      },
    });
    sender = me;
    await wake.hold();
    if (my !== run) return;
    if (!link.state || link.state() === 'connected') await sender.start();
  }

  function finish(message = null) {
    run++;
    wake.release();
    playRoom(null);
    player = null;
    const s = sender; sender = null;
    const l = link; link = null;
    try { if (s && s.state() !== 'ended') s.stop('stopped'); } catch { /* gone */ }
    try { s?.destroy?.(); } catch { /* gone */ }
    try { l?.close?.(); } catch { /* gone */ }
    ended = message;
    renderSetup();
  }

  on(root, 'click', (e) => {
    if (e.target.closest('[data-start]')) { start(); return; }
    if (e.target.closest('[data-stop]')) finish('The intercom is closed.');
  });
  if (doc) on(doc, 'visibilitychange', () => paintLive());

  try {
    people = await loadPeople();
    renderSetup();
  } catch (err) {
    if (isAuthError(err)) renderSignIn();
    else body().innerHTML = '<h1>Talk to a room</h1><p>Could not reach the site. Check the phone’s connection and reload.</p>';
  }

  return {
    state: () => (sender ? sender.state() : 'idle'),
    live: () => root.dataset.live === '1',
    ended: () => ended,
    stop: () => finish('The intercom is closed.'),
    destroy() { finish(null); wake.destroy(); ac.abort(); },
  };
}
