// spotify_sdk_try.js — THE LOGIC OF dev/spotify_sdk_try.html, Mike's Test B. (spotify sdk, 2026-10-07)
//
// Does Spotify's Web Playback SDK make a page on this site a Spotify speaker on the bench Pi, and play FULL songs
// there? The page loads Spotify's player script, uses the household's own Spotify sign-in (music_spotify.js, PKCE)
// with the `streaming` permission, names the player "Nimrod (this screen)", moves playback to it, and plays one song
// the site's weighted picker chose (music_pick.js over rng.js). It shows big plain lines for each thing that can
// happen, in Spotify's own words where Spotify gave any.
//
// *** NOTHING HERE NAVIGATES BY ITSELF. *** Signing in is the "Connect Spotify" button. When the page opens with a
// sign-in already on this device, it starts the player by itself (Test B step 5: does it come back as a speaker
// after a reload?) - that is a script on this page, not a trip to Spotify.
// *** NOTHING IS SAVED TO THE SERVER. *** The Client ID is read from the server when this browser is signed in to
// the site, else from a Spotify sign-in already on this device, else typed into the box (it is public by design).
// The sign-in stays in this browser (music_spotify.js). Plays are not logged.
// *** IT REGISTERS WITH AN AUDIO BUS *** (its own, on this page), with "pause, not duck" as the default, and a
// "Say something over it" button that plays a spoken cue so the pause can be heard.
//
// Kept apart from the page so dev/spotify_sdk_test.html can drive all of it with a fake `Spotify` global and a fake
// fetch: nothing in the suite reaches Spotify.

import { createSpotify, callbackUrl, tokenKey, SPOTIFY_MESSAGES, scopesFor } from '../music_spotify.js';
import { loadSdk, createScreenPlayer, SDK_WORDS, ERROR_EVENTS, PLAYER_NAME, clock } from '../spotify_sdk.js';
import { createMusicPicker } from '../music_pick.js';
import { createAudioBus } from '../audio_bus.js';
import { parseSpotifyUri } from '../music_favourites.js';

export const TRY_FEATURES = Object.freeze({ shuffle: true, screen: true });
// The two Spotify's older quick-start asked for; offered as a box, off, for the test to prove either way.
export const PROFILE_SCOPES = Object.freeze(['user-read-email', 'user-read-private']);
export const TYPED_ID_KEY = 'nimrod.spotify.sdkTry.clientId';    // this browser only: the box's last Client ID
export const CUE_WORDS = 'This is a spoken cue. The music should pause, and carry on when I stop.';
export const CUE_MAX_MS = 8000;                                    // a cue whose "ended" never comes is ended anyway

const ID_RE = /^[0-9A-Fa-f]{32}$/;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A Client ID from a Spotify sign-in already kept in this browser (music_spotify.js `tokenKey`), or ''. PURE over storage. */
export function storedClientId(storage) {
  try {
    const prefix = tokenKey('');
    for (let i = 0; i < (storage?.length || 0); i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix) && ID_RE.test(k.slice(prefix.length))) return k.slice(prefix.length);
    }
  } catch { /* none */ }
  return '';
}

/** The status lines, as [{ id, label, value, tone }] - tone 'good' | 'bad' | 'wait' | ''. PURE. */
export function statusLines({ sdk = 'idle', player = null, clientId = '', connected = false, hasStreaming = false } = {}) {
  const p = player || {};
  const lines = [];
  lines.push({ id: 'signin', label: 'Spotify sign-in on this device',
    value: !clientId ? 'No Client ID yet (see below).' : !connected ? 'Not signed in. Press “Connect Spotify”.'
      : !hasStreaming ? SDK_WORDS['no-streaming'] : 'Signed in, with permission to play here.',
    tone: clientId && connected && hasStreaming ? 'good' : 'bad' });
  lines.push({ id: 'sdk', label: 'Spotify’s player script',
    value: sdk === 'loaded' ? SDK_WORDS.loaded : sdk === 'loading' ? SDK_WORDS.loading
      : sdk === 'failed' ? SDK_WORDS['sdk-load-failed'] : 'Not loaded yet.',
    tone: sdk === 'loaded' ? 'good' : sdk === 'failed' ? 'bad' : 'wait' });
  lines.push({ id: 'ready', label: 'Ready as a speaker',
    value: p.status === 'ready' ? `${SDK_WORDS.ready} Device ID ${p.deviceId}` : p.status === 'connecting' ? SDK_WORDS.connecting
      : p.status === 'offline' ? SDK_WORDS.not_ready : p.status === 'failed' ? 'No - see the lines below.' : 'Not yet.',
    tone: p.status === 'ready' ? 'good' : p.status === 'failed' || p.status === 'offline' ? 'bad' : 'wait' });
  for (const ev of ERROR_EVENTS) {
    const has = p.errors && Object.prototype.hasOwnProperty.call(p.errors, ev);
    lines.push({ id: ev, label: ev, value: has ? `${SDK_WORDS[ev]}${p.errors[ev] ? ` Spotify said: “${p.errors[ev]}”` : ''}` : 'None.',
      tone: has ? 'bad' : 'good' });
  }
  for (const k of ['autoplay_failed', 'connect-refused', 'sdk-missing']) {
    if (p.errors && Object.prototype.hasOwnProperty.call(p.errors, k)) lines.push({ id: k, label: k, value: SDK_WORDS[k], tone: 'bad' });
  }
  const t = p.track;
  lines.push({ id: 'song', label: 'Playing here',
    value: t ? `${t.name}${t.artists?.length ? ` - ${t.artists.join(', ')}` : ''} (${p.busPaused ? SDK_WORDS['bus-paused']
      : p.paused ? 'paused' : 'playing'}, ${clock(p.positionMs)} of ${clock(p.durationMs)})` : 'Nothing yet.',
    tone: t && !p.paused ? 'good' : 'wait' });
  lines.push({ id: 'past', label: 'Sound past 0:30',
    value: p.pastThirty ? `YES. ${SDK_WORDS.past}` : t ? `Not yet (${clock(p.positionMs)}).` : 'Not yet.',
    tone: p.pastThirty ? 'good' : 'wait' });
  return lines;
}

/**
 * Mount the try page into `root`. Every outside thing is a seam: `getClientId()` (the server's answer; null when it
 * cannot say), `storage`, `fetchFn`, `loadSdkFn`, `audio`, `speak(text, onEnd)`, timers, `navigate`.
 */
export function mountSdkTry(root, {
  getClientId = async () => null,
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  fetchFn = undefined,
  loadSdkFn = loadSdk,
  audio = createAudioBus(),
  speak = null,
  navigate = undefined,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  returnTo = '/dev/spotify_sdk_try.html',
  autoStart = true,
} = {}) {
  let clientId = '';
  let idFrom = '';
  let spotify = null;
  let player = null;
  let sdk = 'idle';
  let picker = createMusicPicker({ log: null });
  let pool = [];
  let poolUri = '';
  const logLines = [];
  let dead = false;
  let SdkGlobal = null;          // Spotify's `Spotify` global, once its script has loaded
  let pastLogged = false;

  root.innerHTML = `
    <section class="try-status" data-status aria-live="polite"></section>
    <section class="try-box">
      <h2>1. Sign in</h2>
      <p data-id-line></p>
      <label for="try-id">Client ID (only if the line above says none was found)</label>
      <div class="try-row"><input id="try-id" data-id-box maxlength="64" autocomplete="off" spellcheck="false" placeholder="32 letters and numbers">
        <button type="button" data-act="use-id">Use this Client ID</button></div>
      <label class="try-check"><input type="checkbox" data-profile> Also ask for the account type and email (older Spotify
        guides say the player needs them; leave it off unless the player refuses without them)</label>
      <p><button type="button" data-act="connect">Connect Spotify</button>
        <button type="button" data-act="start">Start the player</button>
        <button type="button" data-act="disconnect">Disconnect Spotify on this device</button></p>
    </section>
    <section class="try-box">
      <h2>2. Play one song here</h2>
      <label for="try-uri">A Spotify playlist, album or song link</label>
      <input id="try-uri" data-uri placeholder="https://open.spotify.com/playlist/...">
      <p><button type="button" data-act="play">Play one song here</button>
        <button type="button" data-act="next">Another song (our pick)</button>
        <button type="button" data-act="pause">Pause</button>
        <button type="button" data-act="resume">Resume</button></p>
    </section>
    <section class="try-box">
      <h2>3. A spoken cue over it</h2>
      <label for="try-duck">When something speaks over Spotify</label>
      <select id="try-duck" data-duck><option value="pause">Pause Spotify, carry on after (the default)</option>
        <option value="duck">Turn Spotify down under it</option></select>
      <p><button type="button" data-act="cue">Say something over it</button></p>
    </section>
    <h2>Log</h2>
    <div class="try-log" data-log></div>`;
  const $ = (sel) => root.querySelector(sel);

  function log(s) {
    const t = new Date().toLocaleTimeString();
    logLines.unshift(`${t}  ${s}`);
    if (logLines.length > 200) logLines.length = 200;
    const el = $('[data-log]');
    if (el) el.textContent = logLines.join('\n');
  }
  const hasStreaming = () => !!spotify?.connected?.() && (spotify.granted?.() || []).includes('streaming');
  function draw() {
    if (dead) return;
    const lines = statusLines({ sdk, player: player?.state?.() || null, clientId, connected: !!spotify?.connected?.(),
      hasStreaming: hasStreaming() });
    $('[data-status]').innerHTML = lines.map((l) => `<p class="try-line ${l.tone}" data-line="${esc(l.id)}">`
      + `<b>${esc(l.label)}:</b> ${esc(l.value)}</p>`).join('');
    $('[data-id-line]').textContent = clientId
      ? `Using the Client ID ${idFrom}, ending …${clientId.slice(-4)}. The return address Spotify must list: ${callbackUrl()}`
      : 'No Client ID found: this browser is not signed in to this site, and has no Spotify sign-in yet. Paste the household’s Client ID below.';
  }
  function useId(id, from) {
    const v = String(id || '').trim();
    if (!ID_RE.test(v)) return false;
    if (v === clientId && spotify) return true;
    clientId = v; idFrom = from;
    try { player?.destroy(); } catch { /* gone */ }
    player = null;
    spotify = createSpotify({ clientId, redirectUri: callbackUrl(), wants: () => ({ ...TRY_FEATURES }),
      ...(storage !== undefined ? { storage } : {}), ...(fetchFn ? { fetchFn } : {}), ...(navigate ? { navigate } : {}) });
    draw();
    return true;
  }

  async function startPlayer() {
    if (!spotify) { log('No Client ID yet.'); draw(); return { ok: false, reason: 'no-client-id' }; }
    if (!spotify.connected()) { log(SDK_WORDS['signed-out']); draw(); return { ok: false, reason: 'signed-out' }; }
    if (!hasStreaming()) { log(SDK_WORDS['no-streaming']); draw(); return { ok: false, reason: 'no-streaming' }; }
    if (player) { draw(); return { ok: player.state().status === 'ready' }; }
    if (sdk !== 'loaded') {
      sdk = 'loading'; draw(); log(SDK_WORDS.loading);
      const r = await loadSdkFn({ setTimer, clearTimer });
      if (dead) return { ok: false, reason: 'gone' };
      if (!r.ok) { sdk = 'failed'; log(SDK_WORDS['sdk-load-failed']); draw(); return { ok: false, reason: 'sdk-load-failed' }; }
      sdk = 'loaded'; log(SDK_WORDS.loaded);
      SdkGlobal = r.Spotify;
    }
    let lastStatus = '';
    let lastErr = null;
    player = createScreenPlayer({
      spotify, Sdk: SdkGlobal, name: PLAYER_NAME, audio, whenDucked: $('[data-duck]').value === 'duck' ? 'duck' : 'pause',
      setTimer, clearTimer,
      onChange: (s) => {
        if (s.status !== lastStatus) { lastStatus = s.status; log(`player: ${s.status}${s.deviceId && s.status === 'ready' ? ` (device ID ${s.deviceId})` : ''}`); }
        if (s.lastError && s.lastError !== lastErr) { lastErr = s.lastError; log(`${s.lastError}: ${s.errors[s.lastError] || SDK_WORDS[s.lastError] || ''}`); }
        if (s.pastThirty && !pastLogged) { pastLogged = true; log(SDK_WORDS.past); }
        draw();
      },
    });
    const r = await player.start();
    if (!r.ok) log(`The player did not start: ${SDK_WORDS[r.reason] || r.reason}`);
    draw();
    return r;
  }

  async function playOne(fresh) {
    if (!player || player.state().status !== 'ready') { log(SDK_WORDS['not-ready']); return { ok: false, reason: 'not-ready' }; }
    const uri = parseSpotifyUri($('[data-uri]').value);
    if (!uri) { log(SPOTIFY_MESSAGES['bad-uri']); return { ok: false, reason: 'bad-uri' }; }
    const type = uri.split(':')[1];
    let pick = uri;
    let how = 'that song';
    if (type === 'playlist' || type === 'album') {
      if (fresh || uri !== poolUri || !pool.length) {
        const t = await spotify.tracks(uri);
        if (t.ok) { pool = t.tracks; poolUri = uri; log(`Read ${pool.length} songs from that ${type}.`); }
        else { pool = []; poolUri = ''; log(`${SPOTIFY_MESSAGES[t.reason] || t.reason} (so it plays in Spotify’s own order).`); }
      }
      if (pool.length) {
        const cur = player.state().track?.uri;
        const choices = pool.filter((p) => p.id !== cur);
        pick = picker.next(choices.length ? choices : pool);
        how = 'our pick';
      } else how = 'Spotify’s own order';
    }
    pastLogged = false;
    const r = await player.play(pick);
    if (r.ok) {
      if (how === 'our pick') picker.played(pick, pool.find((p) => p.id === pick)?.channel || null);
      log(`Playing ${how}: ${pick}`);
    } else log(`Could not play: ${SPOTIFY_MESSAGES[r.reason] || SDK_WORDS[r.reason] || r.reason}`);
    draw();
    return r;
  }

  function cue() {
    try { audio?.register?.('try:cue', { tier: 'voice' }); audio?.setActive?.('try:cue', true); } catch { /* advice */ }
    log('Spoken cue: started.');
    let done = false;
    let t = null;
    const end = () => {
      if (done) return; done = true;
      if (t != null) { try { clearTimer(t); } catch { /* gone */ } }
      try { audio?.setActive?.('try:cue', false); } catch { /* advice */ }
      log('Spoken cue: ended.');
      draw();
    };
    t = setTimer(end, CUE_MAX_MS);
    try {
      if (typeof speak === 'function') speak(CUE_WORDS, end);
      else if (typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
        const u = new SpeechSynthesisUtterance(CUE_WORDS);
        u.onend = end; u.onerror = end;
        speechSynthesis.speak(u);
      }
    } catch { /* the timer still ends it */ }
    draw();
    return end;
  }

  async function onClick(e) {
    const b = e.target.closest?.('[data-act]');
    if (!b || !root.contains(b)) return;
    const a = b.dataset.act;
    if (a === 'use-id') {
      const v = $('[data-id-box]').value;
      if (useId(v, 'typed here')) { try { storage?.setItem?.(TYPED_ID_KEY, v.trim()); } catch { /* fine */ } log('Using the typed Client ID.'); }
      else log('That does not look like a Spotify Client ID (32 letters and numbers).');
    } else if (a === 'connect') {
      if (!spotify) { log('No Client ID yet.'); return; }
      const extra = $('[data-profile]').checked ? [...PROFILE_SCOPES] : [];
      log(`Going to Spotify to sign in, asking for: ${[...scopesFor(TRY_FEATURES), ...extra].join(' ')}`);
      const r = await spotify.beginLogin({ returnTo, features: { ...TRY_FEATURES }, extraScopes: extra });
      if (!r.ok) log(SPOTIFY_MESSAGES[r.reason] || r.reason);
    } else if (a === 'start') await startPlayer();
    else if (a === 'disconnect') {
      try { player?.destroy(); } catch { /* gone */ }
      player = null;
      spotify?.disconnect?.();
      log('Spotify is disconnected on this device.');
      draw();
    } else if (a === 'play') await playOne(true);
    else if (a === 'next') await playOne(false);
    else if (a === 'pause') { await player?.pause(); log('Paused.'); }
    else if (a === 'resume') { await player?.resume(); log('Resumed.'); }
    else if (a === 'cue') cue();
  }
  function onChange(e) {
    if (e.target.matches?.('[data-duck]')) {
      const m = player?.setWhenDucked?.(e.target.value) || e.target.value;
      log(`A spoken cue now ${m === 'duck' ? 'turns Spotify down' : 'pauses Spotify'}.`);
    }
  }
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  const ready = (async () => {
    let fromServer = null;
    try { fromServer = await getClientId(); } catch { fromServer = null; }
    if (dead) return;
    if (fromServer && useId(fromServer, 'saved on this site for this account')) { /* used */ }
    else if (useId(storedClientId(storage), 'of the Spotify sign-in already in this browser')) { /* used */ }
    else {
      let typed = '';
      try { typed = storage?.getItem?.(TYPED_ID_KEY) || ''; } catch { typed = ''; }
      if (useId(typed, 'typed here before')) $('[data-id-box]').value = typed;
    }
    draw();
    // Test B step 5: with a sign-in already here, the player starts by itself after a reload. No navigation.
    if (autoStart && spotify?.connected?.() && hasStreaming()) { log('Signed in already: starting the player.'); await startPlayer(); }
  })();
  draw();

  return {
    ready,
    startPlayer,
    playOne,
    cue,
    state: () => ({ clientId, idFrom, sdk, player: player?.state?.() || null, logs: [...logLines], spotify }),
    destroy() {
      dead = true;
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      try { player?.destroy(); } catch { /* gone */ }
      try { picker.destroy?.(); } catch { /* gone */ }
      picker = null;
    },
  };
}
