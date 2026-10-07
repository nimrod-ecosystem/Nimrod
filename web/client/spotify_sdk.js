// spotify_sdk.js — "THIS SCREEN IS THE SPEAKER": SPOTIFY'S WEB PLAYBACK SDK, WRAPPED. (spotify sdk, 2026-10-07)
//
// Route (b) of docs/for_chat/spotify_on_a_screen_20261007.md (private repo). Spotify's own script
// (https://sdk.scdn.co/spotify-player.js) turns this page into a Spotify Connect device; the household's existing
// sign-in (music_spotify.js, PKCE, plus the `streaming` permission) hands it a token; the site's own weighted picker
// chooses the song; the Web API tells Spotify to play that song HERE. Only dev/spotify_sdk_try.html uses it so far
// (Mike's Test B on the bench). The Music panel takes it once Test B passes.
//
// WHAT SPOTIFY SAYS, read 2026-10-07 on developer.spotify.com/documentation/web-playback-sdk/reference:
//   window.onSpotifyWebPlaybackSDKReady is called when the script has loaded;
//   new Spotify.Player({ name, getOAuthToken(cb), volume, enableMediaSession });
//   connect() -> Promise<boolean>, disconnect(), getCurrentState() -> Promise<state|null>, setVolume(0..1),
//   pause(), resume(), activateElement();
//   events: ready / not_ready { device_id }, player_state_changed (state | null), autoplay_failed,
//   initialization_error / authentication_error / account_error / playback_error { message }.
//   It needs Premium. And "This SDK must not be used in commercial projects without Spotify's prior written
//   approval" - fine for a household; a question if Nimrod ever charges.
//
// *** IT NEVER NAVIGATES THE PAGE. *** Signing in is music_spotify.js `beginLogin`, behind a button somebody presses.
// Nothing here leaves the page, opens a window, or puts anything over it; a failure is a status line.
//
// *** IT REGISTERS WITH THE AUDIO BUS, AND PAUSES RATHER THAN DUCKS BY DEFAULT. *** Sound comes out of this page, so
// it is one more source on audio_bus.js (music group, video priority, media tier). `whenDucked: 'pause'` (the bus's
// per-source choice): Spotify's developer policy says "Do not permit any device or system to segue, mix, re-mix, or
// overlap" its content with other audio [developer.spotify.com/policy], so under a spoken cue it pauses and carries
// on after, instead of murmuring at half volume. A default, not a rule: `whenDucked: 'duck'` gives the usual bed.
// Exclusivity, hush and a call give it 0, which is also a pause. A missing bus never silences it (the bus's rule).
//
// What it reports (`state()`), for big plain status lines: the script loaded; ready with a device ID; each error
// Spotify raised, in Spotify's own words; playing or paused; the song; and whether sound has played past 0:30
// (a preview stops at 0:30, so past it means a full song).

import { MUSIC_GROUP, VIDEO_PRIORITY } from './audio_bus.js';
import { imageOf } from './music_spotify.js';
import { parseSpotifyUri } from './music_favourites.js';

export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
// Listed for Mike with the argument; none of these is a thing a household tunes.
export const SDK_LOAD_MS = 20000;      // a script that has not loaded in 20 s on a facility connection is not coming
export const PAST_MS = 30000;          // a preview is 30 s; past it is a full song (the test's whole question)
export const POLL_MS = 1000;           // while playing, ask the player where it is once a second (for the 0:30 line)
export const PLAYER_NAME = 'Nimrod (this screen)';   // what the Spotify app's device list shows; the caller may rename

// Every status sentence, in one place so the suite can hold them to the house rules (plain words, nobody named).
export const SDK_WORDS = Object.freeze({
  loading: 'Loading Spotify’s player…',
  loaded: 'Spotify’s player loaded.',
  'sdk-load-failed': 'Spotify’s player did not load. It may be blocked (an ad blocker), or the connection is down.',
  'sdk-missing': 'Spotify’s player is not on this page.',
  connecting: 'Asking Spotify to make this page a speaker…',
  'connect-refused': 'Spotify would not connect the player on this page.',
  ready: 'Ready. Spotify lists this page as a speaker.',
  not_ready: 'Spotify says this page went offline as a speaker (not_ready). It tries again by itself.',
  initialization_error: 'Spotify says this browser cannot play its music (initialization_error).',
  authentication_error: 'Spotify did not accept the sign-in for playing here (authentication_error). Sign in again with “Connect Spotify”.',
  account_error: 'Spotify says this account cannot play here: it needs Premium (account_error).',
  playback_error: 'Spotify could not play that (playback_error).',
  autoplay_failed: 'The browser stopped the music starting by itself (autoplay_failed). Press Play here once.',
  'signed-out': 'Spotify is not signed in on this device. Press “Connect Spotify”.',
  'no-streaming': 'This device’s Spotify sign-in was made without permission to play through this page. Press “Connect Spotify” to sign in again with it.',
  'not-ready': 'The player is not ready yet.',
  playing: 'Playing.',
  paused: 'Paused.',
  'bus-paused': 'Paused while something else speaks; it carries on after.',
  past: 'Sound has played past 0:30, so this is a full song, not a preview.',
});
export const ERROR_EVENTS = Object.freeze(['initialization_error', 'authentication_error', 'account_error', 'playback_error']);

/**
 * Load Spotify's script once. Resolves `{ ok: true, Spotify }` or `{ ok: false, reason: 'sdk-load-failed' }`; never
 * rejects. An earlier `onSpotifyWebPlaybackSDKReady` is still called.
 */
export function loadSdk({ win = (typeof window !== 'undefined' ? window : null),
  doc = (typeof document !== 'undefined' ? document : null), src = SDK_URL, timeoutMs = SDK_LOAD_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  if (win?.Spotify?.Player) return Promise.resolve({ ok: true, Spotify: win.Spotify });
  if (!win || !doc) return Promise.resolve({ ok: false, reason: 'sdk-load-failed' });
  if (win.__nimrodSpotifySdk) return win.__nimrodSpotifySdk;
  const p = new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } }
      if (!r.ok) win.__nimrodSpotifySdk = null;      // a failed load may be tried again
      resolve(r);
    };
    const prev = win.onSpotifyWebPlaybackSDKReady;
    win.onSpotifyWebPlaybackSDKReady = (...a) => {
      try { if (typeof prev === 'function') prev(...a); } catch (err) { console.error('spotify sdk: earlier ready', err); }
      finish(win.Spotify?.Player ? { ok: true, Spotify: win.Spotify } : { ok: false, reason: 'sdk-load-failed' });
    };
    timer = setTimer(() => finish({ ok: false, reason: 'sdk-load-failed' }), timeoutMs);
    try {
      const s = doc.createElement('script');
      s.src = src;
      s.async = true;
      s.onerror = () => finish({ ok: false, reason: 'sdk-load-failed' });
      (doc.head || doc.body || doc.documentElement).appendChild(s);
    } catch { finish({ ok: false, reason: 'sdk-load-failed' }); }
  });
  win.__nimrodSpotifySdk = p;
  return p;
}

const clamp01 = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; };

/** What Spotify's player state says about the song, plainly. PURE. */
export function trackOf(st) {
  const t = st?.track_window?.current_track;
  if (!t) return null;
  return {
    uri: String(t.uri || ''),
    name: String(t.name || ''),
    artists: (Array.isArray(t.artists) ? t.artists : []).map((a) => String(a?.name || '')).filter(Boolean),
    image: imageOf(t.album?.images),
    durationMs: Number(t.duration_ms) || Number(st.duration) || 0,
  };
}

/** m:ss for a status line. PURE. */
export function clock(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The player. `spotify` is a music_spotify.js connector (signed in, with `streaming`); `Sdk` the `Spotify` global
 * from `loadSdk`. `audio` an audio_bus.js bus, or null. `onChange(state)` hears every change.
 */
export function createScreenPlayer({
  spotify,
  Sdk,
  name = PLAYER_NAME,
  volume = 1,
  audio = null,
  audioId = 'spotify:screen',
  whenDucked = 'pause',
  onChange = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const st = {
    status: 'idle',          // idle | connecting | ready | offline | failed
    deviceId: null,
    errors: {},              // kind -> Spotify's own message ('' when it gave none)
    lastError: null,         // the latest kind
    paused: true,
    busPaused: false,
    positionMs: 0,
    durationMs: 0,
    track: null,
    pastThirty: false,
    level: null,             // what the bus last said
  };
  let player = null;
  let poll = null;
  let dead = false;
  let registered = false;
  const base = clamp01(volume);

  const tell = () => { try { onChange?.(state()); } catch (err) { console.error('spotify sdk: onChange', err); } };
  function fail(kind, message = '') {
    st.errors[kind] = String(message || '');
    st.lastError = kind;
    tell();
  }
  function stopPoll() { if (poll != null) { try { clearTimer(poll); } catch { /* gone */ } poll = null; } }
  function startPoll() {
    stopPoll();
    if (dead || !player) return;
    poll = setTimer(async () => {
      poll = null;
      let s = null;
      try { s = await player.getCurrentState(); } catch { s = null; }
      if (dead) return;
      if (s) onState(s, true); else if (!st.paused) startPoll();
    }, POLL_MS);
  }

  // ---- the audio bus -------------------------------------------------------------------------------------------
  function busActive(on) {
    if (!audio) return;
    try {
      if (!registered) {
        audio.register?.(audioId, { tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY, whenDucked, onGain });
        registered = true;
      }
      audio.setActive?.(audioId, on);
    } catch (err) { console.error('spotify sdk: audio bus', err); }   // advice: a broken bus never silences it
  }
  function onGain(level) {
    st.level = level;
    if (!player) return;
    if (!(level > 0)) {
      // Silenced by the bus (a spoken cue with `pause`, a call, hush, another source winning the music group):
      // pause, and remember it was the bus, so the bus - and only the bus - starts it again.
      if (!st.paused && !st.busPaused) {
        st.busPaused = true;
        Promise.resolve().then(() => player?.pause?.()).catch(() => {});
        tell();
      }
      return;
    }
    Promise.resolve().then(() => player?.setVolume?.(clamp01(level * base))).catch(() => {});
    if (st.busPaused) {
      st.busPaused = false;
      Promise.resolve().then(() => player?.resume?.()).catch(() => {});
      tell();
    }
  }

  function onState(s, fromPoll = false) {
    if (dead) return;
    if (!s) {
      // Playback moved to another device (somebody chose a speaker on their phone): this page is quiet.
      st.paused = true; st.track = null; st.positionMs = 0; st.durationMs = 0;
      stopPoll();
      if (!st.busPaused) busActive(false);
      tell();
      return;
    }
    st.paused = !!s.paused;
    st.positionMs = Number(s.position) || 0;
    const t = trackOf(s);
    if (t) { st.track = t; st.durationMs = t.durationMs; }
    if (!st.paused && st.positionMs >= PAST_MS) st.pastThirty = true;
    if (!st.paused) {
      busActive(true);
      // While the bus says silent (a cue, a call, hush, another source won the music group), the bus is the
      // authority on this page: a "playing" report - a poll that crossed the pause in flight, or a press on a phone -
      // is paused again, and the bus carries it on when it says so.
      if (st.level === 0 && audio) {
        st.busPaused = true;
        stopPoll();
        Promise.resolve().then(() => player?.pause?.()).catch(() => {});
        tell();
        return;
      }
      startPoll();
    } else {
      stopPoll();
      // Paused by the bus: stay active, so the bus can carry it on when the cue ends. Paused by anybody else: quiet.
      if (!st.busPaused) busActive(false);
    }
    if (!fromPoll || !st.paused) tell();
  }

  const api = {
    /** Make the player and ask Spotify to connect it. Resolves `{ ok, reason? }`. */
    async start() {
      if (dead) return { ok: false, reason: 'gone' };
      if (!Sdk || typeof Sdk.Player !== 'function') { fail('sdk-missing'); st.status = 'failed'; tell(); return { ok: false, reason: 'sdk-missing' }; }
      if (!spotify?.connected?.()) { fail('signed-out'); return { ok: false, reason: 'signed-out' }; }
      const granted = typeof spotify.granted === 'function' ? spotify.granted() : [];
      if (!granted.includes('streaming')) { fail('no-streaming'); return { ok: false, reason: 'no-streaming' }; }
      if (player) return { ok: st.status === 'ready' };
      st.status = 'connecting';
      tell();
      try {
        player = new Sdk.Player({
          name,
          volume: base,
          getOAuthToken: (cb) => {
            Promise.resolve().then(() => spotify.token()).then((tok) => {
              if (!tok) fail('signed-out');
              cb(tok || '');
            }).catch(() => cb(''));
          },
        });
      } catch (err) {
        player = null;
        st.status = 'failed';
        fail('initialization_error', String(err?.message || err || ''));
        return { ok: false, reason: 'initialization_error' };
      }
      player.addListener('ready', ({ device_id: id } = {}) => {
        st.deviceId = id || null; st.status = 'ready'; tell();
      });
      player.addListener('not_ready', () => { st.status = 'offline'; fail('not_ready'); });
      for (const ev of ERROR_EVENTS) {
        player.addListener(ev, ({ message } = {}) => {
          if (ev !== 'playback_error') st.status = 'failed';
          fail(ev, message);
        });
      }
      player.addListener('autoplay_failed', () => fail('autoplay_failed'));
      player.addListener('player_state_changed', (s) => onState(s));
      let ok = false;
      try { ok = await player.connect(); } catch { ok = false; }
      if (!ok) { st.status = 'failed'; fail('connect-refused'); return { ok: false, reason: 'connect-refused' }; }
      return { ok: true };
    },

    /**
     * Play here: move this account's playback to this page, then play `uri` (one song, or a playlist/album/artist in
     * Spotify's order). Press-driven, so the browser's "a person pressed something" unlocks sound first.
     */
    async play(uri) {
      if (!player || !st.deviceId || st.status !== 'ready') return { ok: false, reason: 'not-ready' };
      const u = parseSpotifyUri(uri);
      if (!u) return { ok: false, reason: 'bad-uri' };
      try { await player.activateElement?.(); } catch { /* only some browsers need it */ }
      const tr = await spotify.transfer(st.deviceId, { play: false });
      if (!tr.ok) return tr;
      const isSong = /^spotify:(track|episode):/.test(u);
      const r = await spotify.playOn(isSong ? { uris: [u], deviceId: st.deviceId } : { uri: u, deviceId: st.deviceId });
      if (r.ok) { st.pastThirty = false; st.busPaused = false; }
      return r;
    },
    async pause() { st.busPaused = false; try { await player?.pause?.(); return { ok: true }; } catch { return { ok: false }; } },
    async resume() {
      try { await player?.activateElement?.(); } catch { /* fine */ }
      try { await player?.resume?.(); return { ok: true }; } catch { return { ok: false }; }
    },
    /** Change what a spoken cue does to it: 'pause' (default) or 'duck'. */
    setWhenDucked(mode) {
      if (mode !== 'pause' && mode !== 'duck') return whenDucked;
      whenDucked = mode;
      try { if (registered) audio?.setWhenDucked?.(audioId, mode); } catch { /* advice */ }
      return whenDucked;
    },
    whenDucked: () => whenDucked,
    state,
    destroy() {
      dead = true;
      stopPoll();
      try { player?.disconnect?.(); } catch { /* gone */ }
      player = null;
      try { if (registered) { audio?.setActive?.(audioId, false); audio?.unregister?.(audioId); } } catch { /* gone */ }
      registered = false;
    },
  };
  function state() {
    return { ...st, errors: { ...st.errors }, track: st.track ? { ...st.track, artists: [...st.track.artists] } : null,
      whenDucked };
  }
  return api;
}
