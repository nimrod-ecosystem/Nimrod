// music_spotify.js — SPOTIFY, AS AN OPTIONAL CONNECTOR, OFF BY DEFAULT. Row 2.32, step 3.
//
// WHAT IT DOES: tells a Spotify speaker, phone or computer that is ALREADY ON to play something ("play
// on the kitchen speaker"). It does not play Spotify through this screen - that would need Spotify's
// Web Playback SDK, a script loaded from Spotify's own site into this page, and this connector does
// not load one. Controlling an existing device needs nothing but the Web API over fetch.
//
// WHO IT IS FOR, stated up front because it is the whole constraint [verified 2026-09-30 on
// developer.spotify.com - see the list below]:
//   * Starting and pausing playback "only works for users who have Spotify Premium".
//   * An app in Development Mode (which is what a household's own client ID is) needs its developer to
//     have Premium, and allows up to five authorised users. Fine for a family; not a public default.
// So it is OFF, and with no client ID it is UNAVAILABLE and says how to get one.
//
// *** THE HOUSEHOLD'S OWN CLIENT ID, AND NO CLIENT SECRET ANYWHERE. *** Authorization Code with PKCE,
// entirely in the browser: a random verifier stays on this device, Spotify is shown only its SHA-256
// hash, and the code that comes back is useless without the verifier. There is no secret to leak
// because there is none. Nimrod has no Spotify app of its own and pays for nobody's anything.
//
// *** TOKENS STAY ON THIS DEVICE. *** They are kept in this browser's local storage under a key per
// client ID, sent only to accounts.spotify.com and api.spotify.com, never to Nimrod's server, and never
// logged - nothing in this file passes a token, a code or a verifier to console.*.
//   THE ONE THING THE SERVER DOES SEE: Spotify returns the one-time authorisation CODE in the query of
//   the callback page's address, and a browser always sends the query to the server that serves the
//   page (spotify_callback.html, on this site), whose access log may write it down. With PKCE that code
//   cannot be turned into a token without the verifier, which never leaves the browser, and it is spent
//   within a second of arriving. Stated rather than hidden.
//
// WHAT WAS CHECKED, developer.spotify.com, 2026-09-30:
//   tutorials/code-pkce-flow      GET  https://accounts.spotify.com/authorize  response_type=code,
//                                  client_id, scope, code_challenge_method=S256, code_challenge,
//                                  redirect_uri, state; POST https://accounts.spotify.com/api/token
//                                  (x-www-form-urlencoded) grant_type=authorization_code, code,
//                                  redirect_uri, client_id, code_verifier - no secret. Verifier 43-128
//                                  chars; challenge = base64url(SHA-256(verifier)).
//   tutorials/refreshing-tokens   grant_type=refresh_token, refresh_token, client_id; a new refresh
//                                  token "might not be included" - keep the old one when it is not.
//   concepts/redirect_uri         HTTPS, except a loopback IP literal (http://127.0.0.1:PORT);
//                                  "localhost is not allowed".
//   reference/start-a-users-playback      PUT /v1/me/player/play?device_id=  body context_uri | uris;
//                                          scope user-modify-playback-state; 204; Premium only.
//   reference/pause-a-users-playback      PUT /v1/me/player/pause?device_id=  same scope; 204; Premium.
//   reference/get-a-users-available-devices  GET /v1/me/player/devices; scope user-read-playback-state;
//                                          devices[] { id, is_active, is_restricted, name, type, ... }.
// UNTESTED AGAINST REAL SPOTIFY: the suite drives all of it through a fake fetch. Nobody has signed in.

import { parseSpotifyUri } from './music_favourites.js';

export const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API = 'https://api.spotify.com/v1';
// The two scopes the three endpoints above need, and nothing else: no library, no profile, no email.
export const SPOTIFY_SCOPES = Object.freeze(['user-read-playback-state', 'user-modify-playback-state']);
export const CALLBACK_PAGE = 'spotify_callback.html';
export const PENDING_KEY = 'nimrod.spotify.pending';
export const tokenKey = (clientId) => `nimrod.spotify.tokens.${clientId}`;
// Refresh this long before Spotify says the token expires, so a request is never sent with one that
// dies on the way. Internal plumbing, not a thing anybody tunes.
const EXPIRY_SKEW_MS = 60000;
// How long a started sign-in may take before its saved verifier is thrown away.
const PENDING_TTL_MS = 15 * 60000;

export const SPOTIFY_MESSAGES = Object.freeze({
  'no-client-id': 'Spotify is not set up here. It needs your household’s own Spotify client ID: '
    + 'make an app at developer.spotify.com (the account that makes it needs Spotify Premium), add this '
    + 'site’s Spotify callback address as a redirect URI, and paste the app’s client ID into this '
    + 'panel’s settings.',
  'signed-out': 'Spotify needs connecting on this device. Open the music panel’s settings and press '
    + 'Connect Spotify.',
  'premium-needed': 'Spotify only lets other apps start music for Premium accounts.',
  'no-device': 'No Spotify speaker, phone or computer is switched on. Open Spotify on one of them first.',
  'device-not-found': 'That Spotify speaker is not switched on, or is called something else.',
  busy: 'Spotify asked us to slow down. Try again in a minute.',
  failed: 'Could not reach Spotify.',
  'bad-uri': 'That is not a Spotify link.',
  'not-secure': 'Connecting Spotify needs this site on https, or opened as http://127.0.0.1 on this machine.',
  'state-mismatch': 'That Spotify sign-in did not match one started here. Try Connect Spotify again.',
  denied: 'Spotify was not connected.',
});

export const callbackUrl = (loc = (typeof location !== 'undefined' ? location : null)) =>
  (loc ? `${loc.origin}/${CALLBACK_PAGE}` : '');

// ---- small pure helpers ---------------------------------------------------------------------

export function base64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 64 characters from the unreserved set: inside the 43-128 the spec asks for.
export function makeVerifier(cryptoImpl = globalThis.crypto, length = 64) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(length);
  cryptoImpl.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHA[b % ALPHA.length];
  return out;
}

export async function challengeFor(verifier, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl || !cryptoImpl.subtle) throw Object.assign(new Error('not-secure'), { code: 'not-secure' });
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The body for PUT /me/player/play: a track or episode goes in `uris`, anything else is a context. */
export function playBody(uri) {
  const u = parseSpotifyUri(uri);
  if (!u) return null;
  const type = u.split(':')[1];
  return (type === 'track' || type === 'episode') ? { uris: [u] } : { context_uri: u };
}

/** A device by name, forgiving case and spacing; null for none. An empty name means "no preference". */
export function pickDevice(devices, name) {
  const list = (Array.isArray(devices) ? devices : []).filter((d) => d && d.id && !d.is_restricted);
  const want = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!want) return list.find((d) => d.is_active) || list[0] || null;
  return list.find((d) => String(d.name || '').toLowerCase().replace(/\s+/g, ' ').trim() === want)
    || list.find((d) => String(d.name || '').toLowerCase().includes(want)) || null;
}

function safeStorage(storage) {
  const s = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
  return {
    get(k) { try { const v = s?.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { s?.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { s?.removeItem(k); } catch { /* fine */ } },
  };
}

// Only a same-site path may be returned to after signing in - never another site.
export function safeReturn(path) {
  const p = String(path || '');
  return p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') ? p : '/';
}

// ---- the connector --------------------------------------------------------------------------

export function createSpotify({
  clientId = '',
  redirectUri = callbackUrl(),
  storage = undefined,
  fetchFn = (...a) => fetch(...a),
  cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
  navigate = (url) => { location.assign(url); },
} = {}) {
  const id = String(clientId || '').trim();
  const store = safeStorage(storage);
  const tokens = () => (id ? store.get(tokenKey(id)) : null);

  async function form(body) {
    let res;
    try {
      res = await fetchFn(SPOTIFY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
    } catch { return { error: 'failed' }; }
    if (!res || !res.ok) return { error: res && (res.status === 400 || res.status === 401) ? 'signed-out' : 'failed' };
    try { return { body: await res.json() }; } catch { return { error: 'failed' }; }
  }

  function keep(body, prev = null) {
    const t = {
      access: body.access_token,
      // "When a refresh token is not returned, continue using the existing token."
      refresh: body.refresh_token || prev?.refresh || null,
      expiresAt: now() + Math.max(0, Number(body.expires_in) || 3600) * 1000,
    };
    store.set(tokenKey(id), t);
    return t;
  }

  async function accessToken(force = false) {
    const t = tokens();
    if (!t || !t.access) return null;
    if (!force && now() < (t.expiresAt || 0) - EXPIRY_SKEW_MS) return t.access;
    if (!t.refresh) return null;
    const r = await form({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: id });
    if (r.error) { if (r.error === 'signed-out') store.del(tokenKey(id)); return null; }
    return keep(r.body, t).access;
  }

  // One Web API call, refreshing once on a 401. Returns { ok, status, body?, reason? }.
  async function api(method, path, body = null) {
    if (!id) return { ok: false, reason: 'no-client-id' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(attempt > 0);
      if (!token) return { ok: false, reason: 'signed-out' };
      let res;
      try {
        res = await fetchFn(`${SPOTIFY_API}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch { return { ok: false, reason: 'failed' }; }
      if (res.status === 401 && attempt === 0) continue;
      if (res.status === 401) return { ok: false, status: 401, reason: 'signed-out' };
      if (res.status === 403) return { ok: false, status: 403, reason: 'premium-needed' };
      if (res.status === 404) return { ok: false, status: 404, reason: 'no-device' };
      if (res.status === 429) return { ok: false, status: 429, reason: 'busy' };
      if (!res.ok) return { ok: false, status: res.status, reason: 'failed' };
      let json = null;
      if (res.status !== 204) { try { json = await res.json(); } catch { json = null; } }
      return { ok: true, status: res.status, body: json };
    }
    return { ok: false, reason: 'failed' };
  }

  async function deviceFor(name) {
    const r = await api('GET', '/me/player/devices');
    if (!r.ok) return { reason: r.reason };
    const devices = (r.body && Array.isArray(r.body.devices)) ? r.body.devices : [];
    if (!devices.length) return { reason: 'no-device' };
    const d = pickDevice(devices, name);
    return d ? { device: d } : { reason: name ? 'device-not-found' : 'no-device' };
  }
  const q = (deviceId) => (deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '');
  let lastDeviceId = null;

  return {
    available: () => !!id,
    connected: () => !!(id && tokens()?.access),
    clientId: () => id,
    redirectUri: () => redirectUri,

    /** Start signing in: remember a verifier on this device, then go to Spotify. */
    async beginLogin({ returnTo = '/' } = {}) {
      if (!id) return { ok: false, reason: 'no-client-id' };
      let verifier, challenge;
      try {
        verifier = makeVerifier(cryptoImpl);
        challenge = await challengeFor(verifier, cryptoImpl);
      } catch { return { ok: false, reason: 'not-secure' }; }
      const state = makeVerifier(cryptoImpl, 24);
      store.set(PENDING_KEY, { clientId: id, redirectUri, verifier, state, returnTo: safeReturn(returnTo), at: now() });
      const url = `${SPOTIFY_AUTHORIZE_URL}?${new URLSearchParams({
        response_type: 'code', client_id: id, scope: SPOTIFY_SCOPES.join(' '),
        code_challenge_method: 'S256', code_challenge: challenge, redirect_uri: redirectUri, state,
      }).toString()}`;
      navigate(url);
      return { ok: true, url };
    },

    /** Forget this device's Spotify sign-in. Spotify's own "remove access" is on the account page. */
    disconnect() { if (id) store.del(tokenKey(id)); store.del(PENDING_KEY); lastDeviceId = null; },

    async devices() {
      const r = await api('GET', '/me/player/devices');
      if (!r.ok) return { ok: false, reason: r.reason, devices: [] };
      return { ok: true, devices: (r.body?.devices || []).map((d) => ({ id: d.id, name: d.name, type: d.type,
        active: !!d.is_active, restricted: !!d.is_restricted })) };
    },

    /** Play a Spotify URI on a named device (or the account's active one). */
    async play({ uri, device = '' } = {}) {
      const body = playBody(uri);
      if (!body) return { ok: false, reason: 'bad-uri' };
      const d = await deviceFor(device);
      if (!d.device) return { ok: false, reason: d.reason };
      const r = await api('PUT', `/me/player/play${q(d.device.id)}`, body);
      if (r.ok) lastDeviceId = d.device.id;
      return r.ok ? { ok: true, device: d.device.name } : { ok: false, reason: r.reason };
    },
    async pause() {
      const r = await api('PUT', `/me/player/pause${q(lastDeviceId)}`);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    async resume() {
      const r = await api('PUT', `/me/player/play${q(lastDeviceId)}`);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
  };
}

/**
 * THE CALLBACK HALF, run by spotify_callback.html. Reads `?code=&state=` (or `?error=`), checks the
 * state against the one saved by `beginLogin` on THIS device, and trades the code for tokens. Returns
 * `{ ok, reason?, returnTo }`. Kept here, not in the page, so the suite can drive it with a fake fetch.
 */
export async function completeLogin(search, { storage = undefined, fetchFn = (...a) => fetch(...a),
                                              now = () => Date.now() } = {}) {
  const store = safeStorage(storage);
  const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const pending = store.get(PENDING_KEY);
  store.del(PENDING_KEY);        // one use, whatever happens next
  const returnTo = safeReturn(pending?.returnTo);
  if (p.get('error')) return { ok: false, reason: 'denied', returnTo };
  const code = p.get('code');
  const state = p.get('state');
  if (!pending || !code || !state || state !== pending.state || !pending.clientId || !pending.verifier
      || now() - (Number(pending.at) || 0) > PENDING_TTL_MS) {
    return { ok: false, reason: 'state-mismatch', returnTo };
  }
  let res;
  try {
    res = await fetchFn(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri,
        client_id: pending.clientId, code_verifier: pending.verifier }).toString(),
    });
  } catch { return { ok: false, reason: 'failed', returnTo }; }
  if (!res || !res.ok) return { ok: false, reason: 'failed', returnTo };
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!body || !body.access_token) return { ok: false, reason: 'failed', returnTo };
  store.set(tokenKey(pending.clientId), {
    access: body.access_token, refresh: body.refresh_token || null,
    expiresAt: now() + Math.max(0, Number(body.expires_in) || 3600) * 1000,
  });
  return { ok: true, returnTo };
}
