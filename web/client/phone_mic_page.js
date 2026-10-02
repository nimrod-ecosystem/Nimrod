// phone_mic_page.js — the page a phone opens to become a microphone for a screen (phone_mic.html).
//
// Row 2.42 / 2.44. The phone's half of `phone_mic.js`, with the one thing a phone page has to get
// right above everything else: IT MUST BE OBVIOUS, AT A GLANCE FROM ACROSS A ROOM, WHETHER THIS
// PHONE'S MICROPHONE IS ON. So while it is:
//
//   * A BAR ACROSS THE TOP says "Microphone on" and names the screen that can hear it, with Stop
//     beside it - ONE press turns the microphone off. The bar and a frame around the whole screen
//     sit in the browser's TOP LAYER (a manual popover), which nothing a module draws can cover.
//   * THE WHOLE PAGE turns the theme's warm accent; only the module's own box (if one is shown)
//     keeps an ordinary surface, so the phone reads as "on" from across the room either way.
//
// ROW 2.44 ADDITION (Mike, 2026-09-30: "put the clock or some other module on it while it charges"):
// below the bar, the phone can show a module - the clock by default - through `phone_mic_show.js`.
// Why the page hosts the module rather than a "phone microphone" module sitting in a dashboard is
// argued there. The microphone never depends on the module: a module that fails is replaced by a
// plain message and the microphone carries on.
//
// WHO CAN USE IT: somebody signed in on this phone who owns the person or holds a drive grant for
// them - the same people who can drive that person's screens, checked by the server when the
// socket's ticket is bought. The list of screens offered here IS that set (/api/people plus
// /api/drive/shared); nobody else's appear, and a ticket the server refuses is said plainly.
//
// WHAT IT NEVER DOES: open the camera, or play anything. There is no audio or video element on
// this page, and a module shown here is handed camera and microphone owners that refuse.
//
// KEEPING IT ALIVE: a browser takes the microphone away when the phone locks or the page goes to
// the background [training knowledge]. So it holds a screen wake lock while the microphone is on
// (`createWakeHold`), says so when it cannot, and the setup page explains the stand arrangement
// (charging, screen timeout, Android screen pinning) that keeps it alive for days.

import { connectDrive } from './drive.js';
import { authHeaders, isAuthError, httpError } from './auth.js';
import { createPhoneMicSender, newSession } from './phone_mic.js';
import {
  SHOW_CHOICES, DEFAULT_SHOW, showChoice, mountShownModule, createWakeHold, wakeNote, KEEP_ON_HELP,
} from './phone_mic_show.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAME_KEY = 'nimrod:phoneMic:name';
const NEAR_KEY = 'nimrod:phoneMic:near';
const PERSON_KEY = 'nimrod:phoneMic:person';
// What this phone shows while it is the microphone. Kept on the phone: it is about this device.
const SHOW_KEY = 'nimrod:phoneMic:show';

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
  // The module beside the microphone. Injectable so a test can hand it a module that fails.
  mountShown = mountShownModule,
  showOpts = {},
} = {}) {
  if (!root) throw new Error('mountPhoneMic: a root element is required');
  const get = (k, d = '') => { try { return storage?.getItem(k) ?? d; } catch { return d; } };
  const put = (k, v) => { try { storage?.setItem(k, v); } catch { /* private mode */ } };

  let people = [];
  let link = null;
  let sender = null;
  let presence = { screens: 0, drivers: 0 };
  let target = null;
  let ended = null;
  let show = 'none';
  let shown = null;             // the mounted module's handle, once it has mounted
  let run = 0;                  // bumped on every start and finish, so late arrivals know they are late
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

  // ---- rendering ------------------------------------------------------------------------
  function renderSignIn() {
    root.dataset.live = '0';
    root.dataset.view = 'setup';
    body().innerHTML = `<h1>Use this phone as a microphone</h1>
      <p>Sign in on this phone first, with an account that is allowed to use the screen.</p>
      <p><a class="pm-btn pm-primary" href="/auth/login">Sign in</a></p>`;
  }

  function renderSetup() {
    root.dataset.live = '0';
    root.dataset.view = 'setup';
    const want = new URLSearchParams(search || '').get('person') || get(PERSON_KEY, '');
    const pick = people.find((p) => p.id === want) || (people.length === 1 ? people[0] : null);
    const wantShow = showChoice(get(SHOW_KEY, DEFAULT_SHOW));
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
      <label class="pm-field"><span>What this phone shows while it is the microphone</span>
        <select data-show>${SHOW_CHOICES.map((c) => `<option value="${esc(c.value)}"${c.value === wantShow ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      </label>
      <button type="button" class="pm-btn pm-primary pm-big" data-start>Turn the microphone on</button>
      <details class="pm-help" data-help><summary>Keeping a phone on as a microphone</summary>${KEEP_ON_HELP}</details>
      <p class="pm-note" data-intercom-link>To talk to the room and hear it back, <a href="./intercom.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">open the intercom</a> instead, or <a data-call-link href="./call.html${pick ? `?person=${encodeURIComponent(pick.id)}` : ''}">place a call</a>.</p>`
      : '<p>This account has no screens it may use. The screen’s owner can share one from the Remote tab.</p>'}`;
  }

  // Built ONCE per start; later state changes only repaint its words, so a module shown in it is
  // never torn down by the microphone reconnecting.
  function buildLive() {
    root.dataset.view = 'live';
    root.dataset.show = show;
    body().innerHTML = `
      <div class="pm-onair" data-onair popover="manual">
        <div class="pm-bar" role="status" aria-live="polite">
          <span class="pm-dot" aria-hidden="true"></span>
          <span class="pm-bar-text"><b class="pm-bar-word" data-word></b><span class="pm-bar-who" data-who></span></span>
          <button type="button" class="pm-btn pm-stop" data-stop>Stop</button>
        </div>
      </div>
      <div class="pm-stage">
        ${show === 'none'
          ? '<div class="pm-live"><div class="pm-live-word" data-big-word></div><div class="pm-live-who" data-big-who></div></div>'
          : '<div class="pm-show" data-show-box><p class="pm-note">Loading…</p></div>'}
        <div class="pm-notes">
          <p class="pm-live-note" data-noscreen hidden>That screen is not open right now. This phone keeps trying.</p>
          <p class="pm-live-note" data-hidden-note hidden>Keep this page open and the phone unlocked, or the microphone stops.</p>
          <p class="pm-live-note" data-wake-note hidden></p>
        </div>
      </div>`;
    const onair = q('[data-onair]');
    // THE TOP LAYER. Where it is supported, nothing a module draws - at any z-index, even appended
    // to <body> against the module contract - can sit above this. Where it is not, the stylesheet
    // pins it fixed at the highest band, and the module's box still contains its own paint.
    // If it did not go up there, the attribute comes off: a `[popover]` that is not open is
    // `display:none` to a browser that knows popovers, and a bar that is not drawn is the one
    // failure this page cannot have.
    let top = false;
    try {
      if (typeof onair.showPopover === 'function') { onair.showPopover(); top = onair.matches(':popover-open'); }
    } catch { top = false; }
    if (!top) onair.removeAttribute('popover');
    measureBar();
  }

  function measureBar() {
    const bar = q('.pm-bar');
    if (!bar) return;
    const h = Math.ceil(bar.getBoundingClientRect().height);
    if (h > 0) root.style.setProperty('--pm-bar-h', `${h}px`);
  }

  function paintLive() {
    if (root.dataset.view !== 'live') return;
    const st = sender ? sender.state() : 'opening';
    root.dataset.live = st === 'opening' ? '0' : '1';
    const who = target ? target.name : 'the screen';
    const word = STATE_TEXT[st] || 'Microphone on';
    const whoText = st === 'live' ? `${who}’s screen can hear this phone` : who;
    const set = (sel, text) => { const el = q(sel); if (el) el.textContent = text; };
    set('[data-word]', word); set('[data-who]', whoText);
    set('[data-big-word]', word); set('[data-big-who]', whoText);
    const noScreen = q('[data-noscreen]');
    if (noScreen) noScreen.hidden = !(link && presence.screens === 0 && st !== 'live');
    const wn = q('[data-wake-note]');
    if (wn) { const t = sender ? wakeNote(wake.status()) : ''; wn.textContent = t; wn.hidden = !t; }
    const hn = q('[data-hidden-note]');
    if (hn) hn.hidden = !doc?.hidden;
  }

  // ---- the module beside the microphone -------------------------------------------------
  function showModule(my) {
    const box = q('[data-show-box]');
    if (!box || show === 'none') return;
    Promise.resolve()
      .then(() => mountShown(box, show, showOpts))
      .then((h) => {
        if (my !== run) { try { h?.destroy?.(); } catch { /* gone */ } return; }
        shown = h;
      })
      .catch((err) => {
        // `mountShownModule` does not throw; an injected one might. The microphone is untouched.
        console.error('phone mic: module', err);
        if (my === run && box.isConnected) box.innerHTML = '<p class="pm-mod-failed" role="status">This could not be shown. The microphone is not affected.</p>';
      });
  }

  // ---- the microphone ------------------------------------------------------------------
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
    const personId = q('[data-person]')?.value;
    target = people.find((p) => p.id === personId) || null;
    if (!target) return;
    const name = (q('[data-name]')?.value || '').trim() || 'Phone';
    const near = (q('[data-near]')?.value || '').trim();
    show = showChoice(q('[data-show]')?.value || get(SHOW_KEY, DEFAULT_SHOW));
    put(NAME_KEY, name); put(NEAR_KEY, near); put(PERSON_KEY, target.id); put(SHOW_KEY, show);
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
      onPresence: (p) => { presence = { ...p }; if (sender) paintLive(); },
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
        paintLive();
      },
    });
    sender = me;
    // The module is started alongside, never ahead of, the microphone - and never awaited by it.
    showModule(my);
    await wake.hold();
    if (my !== run) return;
    if (!link.state || link.state() === 'connected') await sender.start();
  }

  function finish(message = null) {
    run++;
    wake.release();
    const h = shown; shown = null;
    try { h?.destroy?.(); } catch (err) { console.error('phone mic: module destroy', err); }
    const s = sender; sender = null;
    const l = link; link = null;
    try { if (s && s.state() !== 'ended') s.stop('stopped'); } catch { /* gone */ }
    try { s?.destroy?.(); } catch { /* gone */ }
    try { l?.close?.(); } catch { /* gone */ }
    ended = message;
    root.style.removeProperty('--pm-bar-h');
    delete root.dataset.show;
    renderSetup();
  }

  on(root, 'click', (e) => {
    if (e.target.closest('[data-start]')) { startMic(); return; }
    if (e.target.closest('[data-stop]')) finish('The microphone is off.');
  });
  if (doc) on(doc, 'visibilitychange', () => paintLive());
  if (doc?.defaultView) on(doc.defaultView, 'resize', () => measureBar());

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
    /** The module shown beside the microphone: `{ type, ok, why }`, or null. */
    shown: () => (shown ? { type: shown.type, ok: shown.ok(), why: shown.why() } : null),
    wake: () => wake.status(),
    stop: () => finish('The microphone is off.'),
    destroy() { finish(null); wake.destroy(); ac.abort(); },
  };
}
