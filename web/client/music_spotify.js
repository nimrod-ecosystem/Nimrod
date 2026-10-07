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
// ADDED 2026-10-07 for row 2.55 (the weighted picker and the song-info card), read that day:
//   reference/get-playlists-items         GET /v1/playlists/{id}/items  limit 1-50, offset; each row's song is
//                                          `item` (it was `track` before Spotify's February 2026 rename; both
//                                          are read). ONLY for a playlist the user owns or collaborates on: 403
//                                          otherwise, and the old /tracks path is gone for Development Mode apps.
//   reference/get-an-albums-tracks        GET /v1/albums/{id}/tracks  limit 1-50, offset.
//   reference/add-to-queue                POST /v1/me/player/queue?uri=&device_id=  204; Premium.
//   reference/get-information-about-the-users-current-playback  GET /v1/me/player  (user-read-playback-state)
//                                          item { uri, name, duration_ms, artists[], album.images[] },
//                                          progress_ms, is_playing; 204 when nothing is playing anywhere.
//   An artist's "top tracks" was removed in February 2026, so an artist favourite plays in Spotify's order.
// UNTESTED AGAINST REAL SPOTIFY: the suite drives all of it through a fake fetch. Nobody has signed in.

import { parseSpotifyUri } from './music_favourites.js';
import { screenLockedHere } from './screen_lock.js';
import { thumbOk } from './recommend.js';

export const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
export const SPOTIFY_API = 'https://api.spotify.com/v1';
// The scopes the endpoints above need, and nothing else: no library, no profile, no email. The third,
// `playlist-read-private`, is for row 2.55's weighted picker: Spotify lists a playlist's songs only to its
// owner or a collaborator, and asks for this scope to do it [developer.spotify.com get-playlists-items, read
// 2026-10-07]. A device connected before it was added is simply not given the list, and its playlists play in
// Spotify's own order until somebody presses Disconnect and Connect again.
export const SPOTIFY_SCOPES = Object.freeze(['user-read-playback-state', 'user-modify-playback-state',
  'playlist-read-private']);
export const CALLBACK_PAGE = 'spotify_callback.html';
export const PENDING_KEY = 'nimrod.spotify.pending';
export const tokenKey = (clientId) => `nimrod.spotify.tokens.${clientId}`;
// Refresh this long before Spotify says the token expires, so a request is never sent with one that
// dies on the way. Internal plumbing, not a thing anybody tunes.
const EXPIRY_SKEW_MS = 60000;
// How long a started sign-in may take before its saved verifier is thrown away.
const PENDING_TTL_MS = 15 * 60000;
// Songs read per request (Spotify's own most, 50), and the most read for one playlist: ten requests. A playlist
// longer than 500 songs is picked from its first 500. A bound, so a huge playlist is not a hundred requests
// before anything plays; listed for Mike rather than made a setting (nobody is served by tuning it).
export const TRACK_PAGE = 50;
export const MAX_TRACKS = 500;

export const SPOTIFY_MESSAGES = Object.freeze({
  // (row 2.55) Names the row it means, so nobody has to hunt the settings for it.
  'no-client-id': 'Spotify is not set up here. It needs your household’s own Spotify client ID: '
    + 'make an app at developer.spotify.com (the account that makes it needs Spotify Premium), add this '
    + 'site’s Spotify callback address as a redirect URI, and paste the app’s client ID into the '
    + '“Your household’s Spotify client ID” row of this panel’s settings.',
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
  // (2026-10-05, screen_lock.js: signing in leaves this page for Spotify's, and a locked screen does not leave.)
  locked: 'This screen is locked, so connecting Spotify waits until it is unlocked.',
  denied: 'Spotify was not connected.',
  // (row 2.55) Why a playlist played in Spotify's own order rather than through the site's weighted picker.
  'not-listable': 'Spotify only lists the songs of playlists you made or share, so this one plays in Spotify’s '
    + 'own order.',
  'no-tracks': 'Spotify gave no songs for this, so it plays in Spotify’s own order.',
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

/**
 * The cover to show for a song: the smallest of Spotify's pictures that is at least 200 pixels wide (or the
 * largest when none is), and only from Spotify's own image hosts (recommend.js `thumbOk`). '' for none.
 */
export function imageOf(images) {
  const list = (Array.isArray(images) ? images : []).filter((i) => i && thumbOk(i.url));
  if (!list.length) return '';
  const wide = list.filter((i) => Number(i.width) >= 200).sort((a, b) => Number(a.width) - Number(b.width));
  return (wide[0] || list.sort((a, b) => Number(b.width || 0) - Number(a.width || 0))[0]).url;
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
  // (2026-10-05, screen_lock.js) A LOCKED SCREEN DOES NOT START A SIGN-IN: `beginLogin` navigates this page to
  // Spotify's sign-in page, which is a way out of the screen and in to an account. A seam for the suites.
  isLocked = () => { try { return screenLockedHere(); } catch { return false; } },
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

  async function start(body, device) {
    const d = await deviceFor(device);
    if (!d.device) return { ok: false, reason: d.reason };
    const r = await api('PUT', `/me/player/play${q(d.device.id)}`, body);
    if (r.ok) lastDeviceId = d.device.id;
    return r.ok ? { ok: true, device: d.device.name } : { ok: false, reason: r.reason };
  }

  return {
    available: () => !!id,
    connected: () => !!(id && tokens()?.access),
    clientId: () => id,
    redirectUri: () => redirectUri,

    /** Start signing in: remember a verifier on this device, then go to Spotify. */
    async beginLogin({ returnTo = '/' } = {}) {
      if (!id) return { ok: false, reason: 'no-client-id' };
      if (isLocked()) return { ok: false, reason: 'locked' };   // (2026-10-05, screen_lock.js)
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
      return start(body, device);
    },

    /** Play these songs, in this order, on a named device (row 2.55: the site's picker chose them). */
    async playTracks({ uris = [], device = '' } = {}) {
      const list = (Array.isArray(uris) ? uris : []).map(parseSpotifyUri)
        .filter((u) => /^spotify:(track|episode):/.test(u));
      if (!list.length) return { ok: false, reason: 'bad-uri' };
      return start({ uris: list }, device);
    },

    /** One song after the one playing now, on the device it was started on. */
    async queue(uri) {
      const u = parseSpotifyUri(uri);
      if (!/^spotify:(track|episode):/.test(u)) return { ok: false, reason: 'bad-uri' };
      const dev = lastDeviceId ? `&device_id=${encodeURIComponent(lastDeviceId)}` : '';
      const r = await api('POST', `/me/player/queue?uri=${encodeURIComponent(u)}${dev}`);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },

    /**
     * The songs of a playlist or an album, for the site's own picker: `{ ok, tracks: [{ id, channel,
     * durationSec }] }` - `id` is the song's URI, `channel` its first artist (the diversity factor, as a
     * YouTube channel is). A playlist somebody else made is refused by Spotify ('not-listable').
     */
    async tracks(uri) {
      const u = parseSpotifyUri(uri);
      if (!u) return { ok: false, reason: 'bad-uri' };
      const [, type, sid] = u.split(':');
      const path = type === 'playlist' ? `/playlists/${sid}/items` : type === 'album' ? `/albums/${sid}/tracks` : '';
      if (!path) return { ok: false, reason: 'no-tracks' };
      const out = [];
      const seen = new Set();
      for (let offset = 0; offset < MAX_TRACKS; offset += TRACK_PAGE) {
        const r = await api('GET', `${path}?limit=${TRACK_PAGE}&offset=${offset}`);
        if (!r.ok) {
          if (out.length) break;       // a later page failing still leaves a pool to pick from
          return { ok: false, reason: r.status === 403 || r.status === 404 ? 'not-listable' : r.reason };
        }
        const items = Array.isArray(r.body?.items) ? r.body.items : [];
        for (const it of items) {
          const t = type === 'playlist' ? (it?.item || it?.track) : it;
          const id = parseSpotifyUri(t?.uri);
          if (!t || it?.is_local || t.is_local || !/^spotify:(track|episode):/.test(id) || seen.has(id)) continue;
          seen.add(id);
          out.push({ id, channel: t.artists?.[0]?.id || t.show?.id || null,
            durationSec: Number(t.duration_ms) > 0 ? Number(t.duration_ms) / 1000 : 0 });
        }
        if (!r.body?.next || items.length < TRACK_PAGE) break;
      }
      return out.length ? { ok: true, tracks: out } : { ok: false, reason: 'no-tracks' };
    },

    /**
     * What the account is playing now, anywhere: `{ ok, uri, name, artists, image, durationMs, progressMs,
     * isPlaying }`, with `uri: null` when nothing is. The song-info card and the picker's watch both read it.
     */
    async nowPlaying() {
      const r = await api('GET', '/me/player');
      if (!r.ok) return { ok: false, reason: r.reason };
      const it = r.body?.item;
      if (!it || !it.uri) return { ok: true, uri: null, isPlaying: false };
      return {
        ok: true, uri: it.uri, name: String(it.name || ''),
        artists: (Array.isArray(it.artists) ? it.artists : []).map((a) => String(a?.name || '')).filter(Boolean),
        image: imageOf(it.album?.images || it.images),
        durationMs: Number(it.duration_ms) || 0, progressMs: Number(r.body.progress_ms) || 0,
        isPlaying: !!r.body.is_playing,
      };
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

// ---- the site's own order, and what is playing (row 2.55) -------------------------------------
//
// Mike, 2026-10-07: *"Are we using our randomizer for a Spotify option? I like ours better for it's weights."*
// So a Spotify PLAYLIST or ALBUM favourite, with the panel's "shuffle" on, is not handed to Spotify whole. Its
// songs are read (`tracks`), the site's weighted picker (music_pick.js over rng.js, exactly YouTube's) chooses
// one, Spotify is told to play that one song, and the next pick is put in Spotify's queue. Each time the queued
// song starts, it is counted as played and another is queued: ONE AHEAD, so the change from song to song is
// Spotify's own, with no gap, and stopping leaves at most one song of ours in that account's queue.
//
// HOW IT KNOWS A SONG HAS CHANGED: it asks Spotify what is playing (`nowPlaying`) once per song, just after
// that song should have ended - not on a steady tick. Paused or stopped somewhere else, it looks again once a
// minute, and after half an hour of that it stops steering. When something that is not ours is playing,
// somebody chose it on their phone or speaker: the run ends there and their choice is left alone.
//
// Spotify's own order is used when the shuffle is off, for a single song, an artist (Spotify removed the call
// that listed an artist's top songs in February 2026), an episode or a show, and when Spotify will not list a
// playlist's songs (only its owner or a collaborator may read them) - and the panel says why.
//
// THE SONG-INFO CARD reads the same `nowPlaying`. With the site steering, the look per song is already made;
// in Spotify's own order the card turns the same once-a-song look on, and with the card off nothing looks.
//
// These waits are plumbing, not settings (nobody is served by tuning them); listed for Mike with the argument.
export const FIRST_LOOK_MS = 3000;     // after starting: long enough for Spotify to report the new song
export const END_SLACK_MS = 1500;      // after a song should have ended, so the next one has begun
export const IDLE_LOOK_MS = 60000;     // paused or stopped elsewhere: look again a minute later
export const RETRY_MS = 30000;         // a look that failed (offline, a busy minute): try again
export const GIVE_UP_AFTER = 5;        // failed looks in a row before it stops steering
export const IDLE_LIMIT = 30;          // idle looks in a row (half an hour) before it stops steering

/**
 * A Spotify player for the music router: `{ available, play, pause, resume, stop, state, destroy }`, over a
 * `createSpotify` connector. `picker` is a music_pick.js picker (null: always Spotify's own order);
 * `shuffle()` and `songInfo()` are read at each play. `onNow(info|null)` hears what is playing, for the card;
 * `onEnded()` hears that somebody chose something else on Spotify and the run is over.
 */
export function createSpotifyPlayer({
  spotify,
  picker = null,
  shuffle = () => true,
  songInfo = () => false,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onNow = null,
  onEnded = null,
} = {}) {
  let run = null;        // { ours, pool, current, queued, fails, idles }
  let gen = 0;
  let timer = null;
  let info = null;
  let note = '';
  let dead = false;
  const read = (f, d) => { try { const v = typeof f === 'function' ? f() : f; return v ?? d; } catch { return d; } };
  const tell = (next) => {
    info = next;
    try { onNow?.(info ? { ...info } : null); } catch (err) { console.error('spotify: onNow', err); }
  };
  function clear() { if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; } }
  function later(ms, g) {
    clear();
    if (dead || g !== gen) return;
    timer = setTimer(() => { timer = null; look(g); }, Math.max(250, ms));
  }
  function quit(ended = false) {
    gen++; clear(); run = null;
    if (ended) { try { onEnded?.(); } catch (err) { console.error('spotify: onEnded', err); } }
  }

  async function queueNext(g) {
    if (!run || !run.ours || run.queued || !picker) return;
    const pool = run.pool.filter((t) => t.id !== run.current);
    const nxt = picker.next(pool.length ? pool : run.pool);
    if (!nxt) return;
    const r = await spotify.queue(nxt);
    if (run && g === gen && r.ok) run.queued = nxt;
  }

  async function look(g) {
    if (!run || g !== gen || dead) return;
    let r;
    try { r = await spotify.nowPlaying(); } catch { r = { ok: false }; }
    if (!run || g !== gen || dead) return;
    if (!r.ok) {
      run.fails += 1;
      if (run.fails >= GIVE_UP_AFTER) { quit(false); return; }
      later(RETRY_MS, g);
      return;
    }
    run.fails = 0;
    if (!r.uri || !r.isPlaying) {
      if (read(songInfo, false)) tell(r.uri ? { uri: r.uri, name: r.name, artists: r.artists, image: r.image } : null);
      run.idles += 1;
      if (run.idles >= IDLE_LIMIT) { quit(false); return; }
      later(IDLE_LOOK_MS, g);
      return;
    }
    run.idles = 0;
    if (run.ours) {
      if (r.uri === run.queued) {
        picker.played(r.uri);
        run.current = r.uri;
        run.queued = null;
      } else if (r.uri !== run.current) {
        // Something we did not choose: somebody picked it on their phone or speaker. Theirs now.
        tell(null);
        quit(true);
        return;
      }
    }
    if (read(songInfo, false)) tell({ uri: r.uri, name: r.name, artists: r.artists, image: r.image });
    if (run.ours && !run.queued) await queueNext(g);
    if (!run || g !== gen) return;
    // A queue that failed is tried again within RETRY_MS, before the song it should follow has ended.
    const left = Math.max(0, r.durationMs - r.progressMs) + END_SLACK_MS;
    later(run.ours && !run.queued ? Math.min(left, RETRY_MS) : left, g);
  }

  return {
    available: () => !!spotify?.available?.(),
    connected: () => !!spotify?.connected?.(),

    /** Start a favourite: `{ ok, device, order: 'ours'|'spotify', note }` or `{ ok: false, reason }`. */
    async play({ uri, device = '' } = {}) {
      quit(false);
      tell(null);
      note = '';
      const g = gen;
      const u = parseSpotifyUri(uri);
      if (!u) return { ok: false, reason: 'bad-uri' };
      const type = u.split(':')[1];
      if (picker && read(shuffle, true) && (type === 'playlist' || type === 'album')) {
        const t = await spotify.tracks(u);
        if (g !== gen || dead) return { ok: false, reason: 'superseded' };
        if (t.ok && t.tracks.length) {
          const first = picker.next(t.tracks);
          const r = await spotify.playTracks({ uris: [first], device });
          if (g !== gen || dead) return { ok: false, reason: 'superseded' };
          if (!r.ok) return r;
          picker.played(first);
          run = { ours: true, pool: t.tracks, current: first, queued: null, fails: 0, idles: 0 };
          later(FIRST_LOOK_MS, g);
          return { ok: true, device: r.device, order: 'ours', note: '' };
        }
        note = SPOTIFY_MESSAGES[t.reason] || '';
      }
      const r = await spotify.play({ uri: u, device });
      if (g !== gen || dead) return { ok: false, reason: 'superseded' };
      if (!r.ok) return r;
      run = { ours: false, pool: [], current: null, queued: null, fails: 0, idles: 0 };
      if (read(songInfo, false)) later(FIRST_LOOK_MS, g);
      return { ok: true, device: r.device, order: 'spotify', note };
    },
    /** Hold: Spotify pauses, and nothing looks until it carries on. */
    async pause() { clear(); return spotify.pause(); },
    async resume() {
      const r = await spotify.resume();
      if (run && (run.ours || read(songInfo, false))) later(FIRST_LOOK_MS, gen);
      return r;
    },
    /** Finished with: stop steering, then pause Spotify. */
    async stop() { quit(false); tell(null); return spotify.pause(); },
    state: () => ({ steering: !!run, ours: !!run?.ours, current: run?.current || null, queued: run?.queued || null,
      timer: timer != null, note, info: info ? { ...info } : null }),
    destroy() { dead = true; quit(false); },
  };
}
