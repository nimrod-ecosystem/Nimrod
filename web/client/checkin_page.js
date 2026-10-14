// checkin_page.js — the page a family member opens to CHECK IN QUIETLY on a screen (checkin.html). 2026-10-14.
//
// The checker's half of checkin.js (which has the whole design). In one line: you see and/or hear the room, the room
// hears nothing from you, and the screen shows that you are checking in the whole time.
//
// WHAT THIS PAGE NEVER DOES: open this device's microphone or camera. There is no getUserMedia here or in
// createCheckInSender - the offer asks to receive only, and the room refuses any offer that would send. So "the room
// hears nothing" does not depend on a mute button somebody could forget.
//
// WHO CAN USE IT: somebody signed in who may reach that person's screens (the owner, or a grant of any kind) AND who
// "May check in quietly" - its own permission (the owner and the guardian set by default). The page asks the site
// first (`/api/drive/may/<person>`) and says so in plain words when the answer is no; the SERVER refuses the offer
// anyway, and the room checks the server's stamp too.
//
// It ends when Stop is pressed, when the page is closed or navigated away (`pagehide`), and whenever the room ends it
// (its time limit, a press at the screen, End) - and then it says why.

import { connectDrive } from './drive.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createCheckInSender, newSession, END_REASONS, MEDIA_CHOICES, mediaWords, allowedKinds } from './checkin.js';
import { createWakeHold } from './phone_mic_show.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PERSON_KEY = 'nimrod:checkin:person';
// What this device asks for (remembered here). The room's own setting is the ceiling; asking for more is refused in
// words, never quietly widened.
const WANT_KEY = 'nimrod:checkin:want';

const WANT_LABELS = Object.freeze({ both: 'Sound and picture', sound: 'Sound only', picture: 'Picture only' });

const STATE_TEXT = {
  asking: 'Looking in…',
  open: 'Checking in',
  reconnecting: 'Checking in — reconnecting',
};

export async function mountCheckInPage(root, {
  fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null),
  connect = connectDrive,
  makeSender = createCheckInSender,
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  search = (typeof location !== 'undefined' ? location.search : ''),
  nav = (typeof navigator !== 'undefined' ? navigator : null),
  doc = root?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  win = (typeof window !== 'undefined' ? window : null),
  makeAudio = () => (typeof Audio !== 'undefined' ? new Audio() : null),
  user = null,                         // the dev/test account override (auth.js); null on the real site
  base = '',
} = {}) {
  if (!root) throw new Error('mountCheckInPage: a root element is required');
  const get = (k, d = '') => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };

  let people = [];
  let link = null;
  let sender = null;
  let target = null;
  let ended = null;
  let player = null;
  let may = null;                      // { checkIn, call, ... } for the picked person, or null (not known)
  let run = 0;
  const ac = new AbortController();
  const on = (el, type, fn) => el?.addEventListener?.(type, fn, { signal: ac.signal });
  const wake = createWakeHold({ nav, doc });

  root.innerHTML = '<main class="pm" data-body><p class="pm-note">Loading…</p></main>';
  const body = () => root.querySelector('[data-body]');
  const q = (sel) => root.querySelector(sel);

  async function getJSON(path) {
    const res = await fetchImpl(`${base}${path}`, { headers: authHeaders(user), credentials: 'same-origin' });
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
  /** What this login may do on that person's screens; null when the site could not say (the server still checks). */
  async function loadMay(personId) {
    try { return await getJSON(`/api/drive/may/${encodeURIComponent(personId)}`); }
    catch (err) { return err && (err.status === 403 || err.status === 401) ? { checkIn: false, call: false } : null; }
  }

  const want = () => { const w = get(WANT_KEY, 'both'); return MEDIA_CHOICES.includes(w) ? w : 'both'; };

  function renderSignIn() {
    root.dataset.live = '0'; root.dataset.view = 'setup';
    body().innerHTML = `<h1>Check in quietly</h1>
      <p>Sign in first, with an account that may check in on the screen.</p>
      <p><a class="pm-btn pm-primary" href="/auth/login?next=${encodeURIComponent('/checkin.html')}">Sign in</a></p>`;
  }

  function renderSetup() {
    root.dataset.live = '0'; root.dataset.view = 'setup';
    const wantId = new URLSearchParams(search || '').get('person') || get(PERSON_KEY, '');
    const pick = target && people.some((p) => p.id === target.id) ? target
      : (people.find((p) => p.id === wantId) || (people.length === 1 ? people[0] : people[0] || null));
    target = pick;
    const blocked = may && may.checkIn === false;
    body().innerHTML = `
      <h1>Check in quietly</h1>
      <p class="pm-lead">See and hear the room without making a sound there, to see if someone is asleep before you
        call. This page never turns on your microphone or camera, so nothing reaches the room. The screen shows that
        you are checking in the whole time, and anyone there can end it with one press. Nothing is recorded.</p>
      ${ended ? `<p class="pm-ended" role="status" data-ended>${esc(ended)}</p>` : ''}
      ${people.length ? `
      <label class="pm-field"><span>Whose screen</span>
        <select data-person>${people.map((p) => `<option value="${esc(p.id)}"${pick && pick.id === p.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </label>
      <label class="pm-field"><span>What you see and hear</span>
        <select data-want>${MEDIA_CHOICES.map((w) => `<option value="${w}"${w === want() ? ' selected' : ''}>${esc(WANT_LABELS[w])}</option>`).join('')}</select>
      </label>
      <button type="button" class="pm-btn pm-primary pm-big" data-start${blocked ? ' disabled' : ''}>Check in quietly</button>
      ${blocked ? `<p class="pm-note" data-blocked>${esc(END_REASONS['not-allowed'])}</p>` : ''}
      <p class="pm-note" data-call-link>To talk, <a href="./call.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">place a call</a> instead.</p>`
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
      <div class="pm-live">
        <video data-room-video muted autoplay playsinline hidden style="width:100%;max-width:40em;border-radius:.5em"></video>
        <div class="pm-live-word" data-big-word></div><div class="pm-live-who" data-big-who></div>
      </div>
      <div class="pm-notes">
        <p class="pm-live-note">The room can’t hear you. Their screen says you are checking in.</p>
        <p class="pm-live-note"><a data-call-now href="./call.html${target ? `?person=${encodeURIComponent(target.id)}` : ''}">Call now</a></p>
      </div>`;
    const onair = q('[data-onair]');
    let top = false;
    try { if (typeof onair.showPopover === 'function') { onair.showPopover(); top = onair.matches(':popover-open'); } } catch { top = false; }
    if (!top) onair.removeAttribute('popover');
  }

  function paintLive() {
    if (root.dataset.view !== 'live') return;
    const st = sender ? sender.state() : 'asking';
    root.dataset.live = st === 'open' ? '1' : '0';
    const word = STATE_TEXT[st] || 'Checking in';
    const who = target ? target.name : 'the room';
    const what = mediaWords(sender ? sender.want() : allowedKinds(want()));
    const whoText = `${who} · ${what}`;
    const set = (sel, text) => { const el = q(sel); if (el) el.textContent = text; };
    set('[data-word]', word); set('[data-who]', whoText);
    set('[data-big-word]', word); set('[data-big-who]', whoText);
  }

  function showRoom(stream) {
    const v = q('[data-room-video]');
    if (v) {
      const has = !!stream && (stream.getVideoTracks?.() || []).length > 0;
      try { v.srcObject = has ? stream : null; if (has) v.play?.()?.catch?.(() => {}); } catch { /* no video here */ }
      v.hidden = !has;
    }
    if (!stream) { if (player) { try { player.pause?.(); player.srcObject = null; } catch { /* gone */ } } return; }
    if (!(stream.getAudioTracks?.() || []).length) return;
    if (!player) player = makeAudio();
    if (!player) return;
    try { player.srcObject = stream; player.play?.()?.catch?.(() => {}); } catch (err) { console.error('checkin: play', err); }
  }

  async function start() {
    const personId = q('[data-person]')?.value;
    target = people.find((p) => p.id === personId) || null;
    if (!target) return;
    put(PERSON_KEY, target.id);
    const w = MEDIA_CHOICES.includes(q('[data-want]')?.value) ? q('[data-want]').value : want();
    put(WANT_KEY, w);
    ended = null;
    may = await loadMay(target.id);
    if (may && may.checkIn === false) { renderSetup(); return; }
    const my = ++run;
    buildLive();
    link = connect({
      // `idle`: connected, not pressing - checking in never makes the screen say somebody is helping (row 2.83).
      personId: target.id, role: 'driver', user, base, idle: true,
      onState: (s) => {
        if (s === 'connected' && sender && ['asking', 'reconnecting', 'open'].includes(sender.state())) sender.reconnect();
        else if (s === 'connected' && sender && sender.state() === 'idle') sender.start();
      },
    });
    let me = null;
    me = makeSender({
      link, session: newSession(), want: w,
      onRemote: (stream) => { if (sender === me) showRoom(stream); },
      onState: (st, why) => {
        if (!me || sender !== me) return;
        if (st === 'ended') { finish(END_REASONS[why] || END_REASONS.stopped); return; }
        paintLive();
      },
    });
    sender = me;
    paintLive();
    await wake.hold();
    if (my !== run) return;
    if (!link.state || link.state() === 'connected') await sender.start();
  }

  function finish(message = null) {
    run++;
    wake.release();
    showRoom(null);
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
    if (e.target.closest('[data-stop]')) finish(END_REASONS.stopped);
  });
  on(root, 'change', async (e) => {
    if (e.target.matches('[data-want]')) { put(WANT_KEY, e.target.value); return; }
    if (!e.target.matches('[data-person]')) return;
    target = people.find((p) => p.id === e.target.value) || null;
    may = target ? await loadMay(target.id) : null;
    renderSetup();
  });
  // Closing the tab or navigating away ends it at both ends (the room's notice goes at once, not at the stall clock).
  on(win, 'pagehide', () => { if (sender) finish(null); });

  try {
    people = await loadPeople();
    renderSetup();
    if (target) { may = await loadMay(target.id); renderSetup(); }
  } catch (err) {
    if (isAuthError(err)) renderSignIn();
    else body().innerHTML = '<h1>Check in quietly</h1><p>Could not reach the site. Check the connection and reload.</p>';
  }

  return {
    state: () => (sender ? sender.state() : 'idle'),
    live: () => root.dataset.view === 'live',
    ended: () => ended,
    may: () => (may ? { ...may } : null),
    stop: () => finish(END_REASONS.stopped),
    destroy() { finish(null); wake.destroy(); ac.abort(); },
  };
}
