// screen_pair.js — HOW A FAMILY ADOPTS A BEDSIDE SCREEN.
//
// A screen that nobody signs into needs a credential of its own: it reboots at 3am and has
// to come back by itself, and it cannot type a password. Until now those credentials lived
// only in the server's `DEVICE_KEYS` environment variable — so creating one required the
// hosting dashboard, and the whole unattended-kiosk feature was founder-only. Anybody else
// who wanted a screen for their own relative had to email us.
//
// THE DANCE IS THE MEDIA-AGENT PAIRING FLOW'S, deliberately, because it is already proven:
//
//   1. the screen, WITH NO ACCOUNT, asks for a code
//   2. it shows the code and polls
//   3. a signed-in person types the code on their phone
//   4. the screen's next poll returns a key that is now bound to that account
//
// *** THE POLL TOKEN IS THE PART THAT IS NOT OBVIOUS. *** The CODE is displayed on a screen
// in a room, so anybody who walks past can read it — which is fine for CLAIMING, because
// claiming requires being signed in. It is NOT fine for COLLECTING: if the code alone could
// fetch the minted key, whoever glimpsed it could take the credential the moment somebody
// claimed it. So the request also returns a secret the screen keeps to itself, and the key
// is handed back only to something that can present it.
//
// THE SECRET NEVER GOES IN A URL. Not the poll token, not the key. Secrets in query strings
// land in access logs, proxies and browser history — the same reasoning as the drive ticket.
//
// ---------------------------------------------------------------------------------------
// WHAT THE SCREEN LOOKS LIKE WHILE THIS HAPPENS, and it is most of the design.
//
// Somebody is standing in a room holding a phone, probably for the first time, possibly a
// long way from anybody who could help. So: ONE instruction, ONE code, in the largest type
// that fits. No branding, no progress bar, no spinner competing with the number they are
// trying to read. The code is grouped and spaced because it is being copied by eye.
//
// AND IT NEVER DEAD-ENDS. A code that expires replaces itself automatically rather than
// leaving somebody staring at a number that has quietly stopped working — the failure that
// would send them looking for a support address that does not exist.
//
// ---------------------------------------------------------------------------------------
// THE QR CODE, and why the printed code stays next to it.
//
// Scanning is the Netflix-TV model and it is plainly better: point a phone at the screen and
// land on a page with the code already filled in, having typed nothing. So the QR comes
// first and is the larger of the two.
//
// *** BUT THE PRINTED CODE IS NOT A FALLBACK HIDDEN BEHIND A "TROUBLE SCANNING?" LINK. ***
// A camera that will not focus in a dim room at 3am is not an edge case, it is a Tuesday —
// and so is a phone too old to scan from the camera app, and a person who does not know
// that pointing the camera IS the scanner. All three of those people are standing in the
// room with nobody to ask. So both routes are on screen at the same time, always, and the
// six characters stay big enough to read from where somebody is actually standing.
//
// The QR is generated on this machine (`qr.js`) rather than fetched from an image service.
// A screen that needs the network to display its own setup code has it backwards: pairing
// is the moment the network is least likely to be working.

import { setDeviceKey } from './auth.js';
import { qrSVG } from './qr.js';

export const POLL_MS = 3000;
// Long enough that a person can walk to a phone, find the page and sign in; short enough
// that a code read off a screen is not useful an hour later.
export const CODE_TTL_HINT = '10 minutes';

// WHERE TO TELL SOMEBODY TO GO, taken from where this page is actually being served rather
// than written down.
//
// The first version hardcoded the current hosting provider's URL, which is wrong for three
// separate reasons and Mike caught it: it breaks the moment there is a custom domain, it is
// simply false on a self-hosted install, and it is a lie in local development. A screen that
// tells somebody to go somewhere the screen itself is not is worse than saying nothing -
// they will go there, sign in to a different install, and the code will not be found.
//
// `location.host` is the truth, always, on every deployment, with no configuration.
export function siteHost(loc = (typeof location !== 'undefined' ? location : null)) {
  const host = loc && loc.host ? String(loc.host) : '';
  // Strip the default ports so it reads as an address somebody would type.
  return host.replace(/:80$|:443$/, '') || 'this site';
}

// WHERE THE PHONE LANDS. `pair.html` reads `?c=` and fills the box in, so the person who
// scanned types nothing at all.
//
// It is an ABSOLUTE url built from this screen's own origin, for the same reason `siteHost`
// exists: a relative path is meaningless inside a QR code, and a hardcoded host sends
// somebody to a different install where their code does not exist.
export function pairURL(code, loc = (typeof location !== 'undefined' ? location : null)) {
  const origin = (loc && loc.origin && loc.origin !== 'null') ? loc.origin : '';
  const path = `/pair.html?c=${encodeURIComponent(String(code || '').toUpperCase())}`;
  return origin ? origin + path : path;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Grouped for reading aloud and typing: "9K4 — 2QX" is copied correctly far more often
// than "9K42QX", and somebody is doing this across a room from the screen.
export function groupCode(code) {
  const c = String(code || '').toUpperCase();
  if (c.length < 6) return c;
  const half = Math.ceil(c.length / 2);
  return `${c.slice(0, half)} ${c.slice(half)}`;
}

// ---------------------------------------------------------------------------------------
// The state machine, PURE, so every branch can be asserted without a network.
//
// `asking` and `waiting` are separated on purpose: they look the same to the code, and they
// are completely different to the person standing there. One means "nothing is on screen
// yet", the other means "your part is done, go and type it".
// ---------------------------------------------------------------------------------------
export const PAIR_STATES = ['asking', 'waiting', 'claimed', 'failed'];

export function pairMessage(state, { code = '', label = '', error = '',
                                     host = siteHost() } = {}) {
  if (state === 'asking') return { title: 'Setting this screen up…', body: '', code: '' };
  if (state === 'waiting') {
    return {
      title: 'Add this screen to your account',
      // The instruction names the whole task, because somebody who has never done it before
      // needs to know where they are going before they are given a number to remember.
      //
      // TWO SENTENCES, TWO ROUTES, IN THE ORDER THEY WILL BE TRIED. Scanning first, because
      // it is the one that asks least of the person; typing second, in the same voice and
      // the same size, because it is the one that always works. Neither is described as the
      // fallback — a person reading this in a dim room should not have to work out which
      // one they are allowed to use.
      body: `Point your phone's camera at the square above. `
        + `Or open <b>${esc(host)}</b> on any phone or computer, sign in, and type the code. `
        + `It lasts about ${CODE_TTL_HINT}.`,
      code: groupCode(code),
    };
  }
  if (state === 'claimed') {
    return {
      title: 'Done',
      // SAY THAT IT IS PERMANENT. The code expiring in ten minutes is the loudest thing on
      // the previous screen, and somebody who has just read that reasonably wonders whether
      // the pairing expires too. It does not: the code is a doorbell, the key is a key, and
      // the key lasts until somebody removes the screen from the account.
      body: `${esc(label) || 'This screen'} is set up for good. It will come back on its own `
        + `after a restart. Starting…`,
      code: '',
    };
  }
  return {
    title: 'Could not reach the server',
    // NOT "an error occurred". The repair is almost always the wifi, and saying so is the
    // difference between somebody fixing it and somebody phoning for help.
    body: `${esc(error) || 'No connection.'} Check the wifi. This will keep trying.`,
    code: '',
  };
}

// ---------------------------------------------------------------------------------------
// mountScreenPairing — the DOM half. Returns when the screen has a key.
// ---------------------------------------------------------------------------------------
export function mountScreenPairing(root, {
  label = 'Screen',
  base = '',
  fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onPaired = null,
  pollMs = POLL_MS,
} = {}) {
  if (!root) throw new Error('mountScreenPairing: a root element is required');
  if (!fetchImpl) throw new Error('mountScreenPairing: no fetch available');

  let state = 'asking';
  let code = '';
  let pollToken = '';
  let timer = null;
  let stopped = false;
  let lastError = '';
  let claimedLabel = '';

  root.innerHTML = '<div class="sp-wrap"><div class="sp-card" data-card></div></div>';
  const card = root.querySelector('[data-card]');

  // LEVEL Q, not the usual M. This symbol is read off a lit screen at an angle, in a room
  // with whatever lighting a care facility has at 3am, by a phone that may be held by
  // somebody with unsteady hands. Q corrects about 25% damage against M's 15%, and the cost
  // is one version step — a slightly denser square, still enormous at this size. The trade
  // is worth taking every time here, where a failed scan means a person gives up.
  function qrHTML() {
    if (!code) return '';
    try {
      return `<div class="sp-qr">${qrSVG(pairURL(code), {
        level: 'Q', quiet: 4, dark: '#0A3323', light: '#ffffff',
        title: 'Scan to set this screen up',
      })}</div>`;
    } catch (err) {
      // A QR that will not generate must never take the CODE down with it. The six
      // characters are the thing that always works; the square is the convenience.
      console.error('screen pairing: qr', err);
      return '';
    }
  }

  function paint() {
    const m = pairMessage(state, { code, label: claimedLabel, error: lastError, host: siteHost() });
    card.innerHTML = `<h1 class="sp-title">${esc(m.title)}</h1>`
      + (m.code ? qrHTML() : '')
      + (m.code ? `<div class="sp-code" aria-label="pairing code">${esc(m.code)}</div>` : '')
      + (m.body ? `<p class="sp-body">${m.body}</p>` : '');
    card.dataset.state = state;
  }

  async function post(path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  async function ask() {
    const r = await post('/api/screen-pair/request', { label });
    code = r.code;
    pollToken = r.poll_token;
    state = 'waiting';
    lastError = '';
    paint();
  }

  async function poll() {
    const r = await post('/api/screen-pair/status', { code, poll_token: pollToken });
    if (r.state === 'claimed' && r.device_key) {
      setDeviceKey(r.device_key);
      claimedLabel = label;
      state = 'claimed';
      paint();
      stopped = true;
      onPaired?.(r.device_key);
      return true;
    }
    // A CODE THAT HAS EXPIRED REPLACES ITSELF rather than leaving somebody staring at a
    // number that has quietly stopped working. `unknown` lands here too: if the server
    // forgot the code (a sweep, a restart), asking for a new one is the only useful move.
    if (r.state === 'expired' || r.state === 'unknown') await ask();
    return false;
  }

  async function tick() {
    if (stopped) return;
    try {
      if (!code) await ask();
      else await poll();
    } catch (err) {
      // KEEP TRYING, VISIBLY. A screen at a bedside may come up before the wifi does, and
      // one that gave up would need somebody to power-cycle it — which is exactly the
      // person who cannot.
      state = 'failed';
      lastError = String(err.message || err);
      paint();
      code = '';
    }
    if (!stopped) timer = setTimer(tick, pollMs);
  }

  paint();
  tick();

  return {
    state: () => state,
    code: () => code,
    stop() { stopped = true; clearTimer(timer); },
    destroy() { this.stop(); root.innerHTML = ''; },
    // For the test and for a host that wants to drive it by hand.
    tick,
  };
}
