// spotify_embed.js — SPOTIFY ON THIS SCREEN, THE WAY YOUTUBE PLAYS: SPOTIFY'S OWN EMBED IN A FRAME. Row 2.61, note BI.
//
// Mike, 2026-10-08: *"I want it to work like youtube does as much as possible."* The YouTube panel plays in YouTube's
// own frame with no app and no sign-in; this is the same for Spotify: Spotify's embed player, steered through its
// iFrame API (https://open.spotify.com/embed/iframe-api/v1). No Spotify app of the household's own is needed.
//
// MEASURED 2026-10-08 (dev/spotify_embed_frame_test.html, headless Chrome with the kiosk's autoplay flag, NOT signed in
// to Spotify): the API loads into a Nimrod page; the frame it draws asks for encrypted-media and autoplay itself; it
// plays with no press; `playback_update` carries { playingURI, isPaused, isBuffering, duration, position } (ms);
// `loadUri` switches songs in the same frame; `pause` reaches it. Signed out it plays 30-second PREVIEWS (duration
// 29713 ms). At a song's end it reports position === duration with isPaused still false, repeated: that is `atEnd`.
// There is no setVolume. NOT MEASURED HERE: full songs in a frame for a signed-in Premium browser (Mike's test; his
// signed-in desktop played full songs with the embed opened as its own page, row 2.55), and the bench Pi.
//
// *** IT IS VISIBLE, ALWAYS. *** Spotify's widget terms: shown "without alteration", and not obscured
// [developer.spotify.com/documentation/embeds/terms]. So it is drawn in the panel, at Spotify's compact size, and is
// its own song information (name, artist, cover); the site's song card is not drawn over or beside it.
//
// *** OUR WEIGHTED SHUFFLE CHOOSES THE SONG WHEN IT CAN (row 2.55), AND COUNTS EVERY SONG THAT PLAYS (Mike 2026-10-08:
// "count our shuffle"). *** With the household's Spotify app connected and the shuffle on, a playlist's or album's
// songs are read (music_spotify.js `tracks`), music_pick.js chooses one, `loadUri` plays it, and at its end the next
// is chosen. Without the app the embed has no song list to give, so the playlist plays in Spotify's own order - and
// each song that starts is still counted by the picker (`playingURI`), so the shuffle knows it when it can choose.
//
// *** IT REGISTERS WITH THE AUDIO BUS AND PAUSES UNDER A CUE. *** Its sound is in Spotify's frame, so the bus cannot turn
// it down (no setVolume); it can pause it. `whenDucked: 'pause'` as spotify_sdk.js argues (Spotify's developer policy:
// no overlapping its content with other audio). A call, hush, or another source winning the music group pause it too,
// and the bus - only the bus - starts it again.
//
// *** WHICH SPEAKER: the computer's default, always. *** Measured: the page cannot reach inside Spotify's frame to call
// setSinkId (speakers.js says it all). A chosen attached speaker is said, not silently ignored.

import { MUSIC_GROUP, VIDEO_PRIORITY } from './audio_bus.js';
import { parseSpotifyUri } from './music_favourites.js';

export const IFRAME_API_URL = 'https://open.spotify.com/embed/iframe-api/v1';
// Listed for Mike with the argument; none of these is a thing a household tunes.
export const API_LOAD_MS = 20000;      // the same 20 s spotify_sdk.js gives Spotify's other script on a facility connection
export const PREVIEW_MAX_MS = 31000;   // a preview reported 29713 ms; a real song shorter than 31 s is rare enough
export const END_SLACK_MS = 1000;      // "at the end": the position within a second of the duration
export const NEXT_WAIT_MS = 5000;      // Spotify's own order: after an end, how long to wait for it to move on by itself
export const EMBED_HEIGHT = 152;       // Spotify's compact player: name, artist, cover and its controls

export const EMBED_WORDS = Object.freeze({
  'api-load-failed': 'Spotify’s player did not load. It may be blocked (an ad blocker), or the connection is down.',
  preview: 'Spotify is playing 30-second previews here. Sign in to Spotify in this browser (open.spotify.com) for '
    + 'whole songs; that needs Spotify Premium.',
  'own-order': 'This plays in Spotify’s own order here. The site’s shuffle needs your own Spotify app connected, and a '
    + 'playlist you made or share.',
  'default-speaker': 'Spotify’s player always uses this computer’s own speaker; it cannot be sent to another one from '
    + 'this page.',
});

/** Load Spotify's iFrame API once: `{ ok: true, api }` or `{ ok: false, reason: 'api-load-failed' }`; never rejects. */
export function loadIframeApi({ win = (typeof window !== 'undefined' ? window : null),
  doc = (typeof document !== 'undefined' ? document : null), src = IFRAME_API_URL, timeoutMs = API_LOAD_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  if (!win || !doc) return Promise.resolve({ ok: false, reason: 'api-load-failed' });
  // MEASURED 2026-10-08: Spotify's script calls onSpotifyIframeApiReady ONCE per page; adding the script again does not
  // call it again. So the API it handed over is kept, and every later ask gets that.
  if (win.__nimrodSpotifyIframeApi) return Promise.resolve({ ok: true, api: win.__nimrodSpotifyIframeApi });
  if (win.__nimrodSpotifyIframe) return win.__nimrodSpotifyIframe;
  const p = new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } }
      if (!r.ok) win.__nimrodSpotifyIframe = null;     // a failed load may be tried again
      resolve(r);
    };
    const prev = win.onSpotifyIframeApiReady;
    win.onSpotifyIframeApiReady = (api) => {
      try { if (typeof prev === 'function') prev(api); } catch (err) { console.error('spotify embed: earlier ready', err); }
      if (api && typeof api.createController === 'function') win.__nimrodSpotifyIframeApi = api;
      finish(api && typeof api.createController === 'function' ? { ok: true, api } : { ok: false, reason: 'api-load-failed' });
    };
    timer = setTimer(() => finish({ ok: false, reason: 'api-load-failed' }), timeoutMs);
    try {
      const s = doc.createElement('script');
      s.src = src;
      s.async = true;
      s.onerror = () => finish({ ok: false, reason: 'api-load-failed' });
      (doc.head || doc.body || doc.documentElement).appendChild(s);
    } catch { finish({ ok: false, reason: 'api-load-failed' }); }
  });
  win.__nimrodSpotifyIframe = p;
  return p;
}

/** A playback_update at the song's end (measured: position reaches duration, still "playing"). PURE. */
export const atEnd = (u) => !!u && Number(u.duration) > 0 && Number(u.position) >= Number(u.duration) - END_SLACK_MS;
/** A song length that is a preview, not the whole song. PURE. */
export const isPreview = (ms) => Number(ms) > 0 && Number(ms) <= PREVIEW_MAX_MS;

/**
 * The player. `host()` returns the element the frame lives in (the panel's stage, made visible while it plays).
 * `picker` a music_pick.js picker; `tracksFor(uri)` the app route's song list (null without the app); `shuffle()` read
 * at each play; `elsewhere()` resolves the name of another Spotify device playing now, or null (app route only).
 * `onChange(state)` hears every change; `onEnded()` hears that the run is over.
 */
export function createEmbedPlayer({
  host,
  loadApi = loadIframeApi,
  audio = null,
  audioId = 'spotify:embed',
  picker = null,
  tracksFor = null,
  shuffle = () => true,
  elsewhere = null,
  onChange = null,
  onEnded = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let ctl = null;
  let making = null;
  let dead = false;
  let registered = false;
  let level = null;
  let gen = 0;
  let waitTimer = null;
  const st = { status: 'idle', uri: null, playing: false, busPaused: false, durationMs: 0, positionMs: 0,
    preview: false, ours: false, note: '', reason: null };
  let run = null;          // { ours, pool, current, endedFor }
  const read = (f, d) => { try { const v = typeof f === 'function' ? f() : f; return v ?? d; } catch { return d; } };
  const tell = () => { try { onChange?.(state()); } catch (err) { console.error('spotify embed: onChange', err); } };
  const clearWait = () => { if (waitTimer != null) { try { clearTimer(waitTimer); } catch { /* gone */ } waitTimer = null; } };

  function busActive(on) {
    if (!audio) return;
    try {
      if (!registered) {
        audio.register?.(audioId, { tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY, whenDucked: 'pause', onGain });
        registered = true;
      }
      audio.setActive?.(audioId, on);
    } catch (err) { console.error('spotify embed: audio bus', err); }   // advice: a broken bus never silences it
  }
  function onGain(l) {
    level = l;
    if (!ctl) return;
    if (!(l > 0)) {
      if (st.playing && !st.busPaused) { st.busPaused = true; try { ctl.pause(); } catch { /* gone */ } tell(); }
      return;
    }
    if (st.busPaused) { st.busPaused = false; try { ctl.resume(); } catch { /* gone */ } tell(); }
  }

  function finished() {
    const g = gen;
    clearWait();
    run = null;
    st.playing = false;
    busActive(false);
    tell();
    if (g === gen) { try { onEnded?.(); } catch (err) { console.error('spotify embed: onEnded', err); } }
  }

  function nextOurs() {
    if (!run || !run.ours || !picker) return false;
    const pool = run.pool.filter((t) => t.id !== run.current);
    const nxt = picker.next(pool.length ? pool : run.pool);
    if (!nxt) return false;
    run.current = nxt;
    try { ctl.loadUri(nxt); ctl.play(); } catch { return false; }
    return true;
  }

  function onUpdate(u) {
    if (dead || !u) return;
    const uri = parseSpotifyUri(u.playingURI) || st.uri;
    const playing = !u.isPaused;
    st.durationMs = Number(u.duration) || 0;
    st.positionMs = Number(u.position) || 0;
    // A NEW SONG STARTED: count it (the shuffle's memory, every song that plays - ours or Spotify's own order).
    if (uri && uri !== st.uri && playing) {
      st.uri = uri;
      if (picker && /^spotify:(track|episode):/.test(uri)) { try { picker.played(uri); } catch { /* the picker's own log */ } }
      if (run) run.endedFor = null;
      clearWait();
    }
    st.preview = isPreview(st.durationMs);
    if (playing && level === 0 && audio) {
      // The bus says silent (a cue, a call, hush): the bus is the authority; it carries it on.
      st.busPaused = true;
      try { ctl.pause(); } catch { /* gone */ }
    }
    if (playing !== st.playing) {
      st.playing = playing;
      if (playing) busActive(true); else if (!st.busPaused) busActive(false);
    }
    if (run && atEnd(u) && run.endedFor !== st.uri) {
      run.endedFor = st.uri;
      if (run.ours) { if (!nextOurs()) finished(); }
      else {
        // Spotify's own order: a playlist moves on by itself; one song, or the last of a list, does not.
        const g = gen;
        const was = st.uri;
        clearWait();
        waitTimer = setTimer(() => { waitTimer = null; if (g === gen && st.uri === was) finished(); }, NEXT_WAIT_MS);
      }
    }
    tell();
  }

  async function ensure(firstUri) {
    if (ctl) return { ok: true };
    if (making) return making;
    making = (async () => {
      const r = await loadApi();
      if (dead) return { ok: false, reason: 'gone' };
      if (!r || !r.ok) { st.status = 'failed'; st.reason = 'api-load-failed'; tell(); return { ok: false, reason: 'api-load-failed' }; }
      const el = read(host, null);
      if (!el) return { ok: false, reason: 'api-load-failed' };
      el.hidden = false;
      // The API puts its frame IN PLACE OF the element it is given, so it gets a slot of its own inside the stage.
      const slot = (el.ownerDocument || document).createElement('div');
      el.innerHTML = '';
      el.appendChild(slot);
      const made = await new Promise((resolve) => {
        let settled = false;
        const t = setTimer(() => { if (!settled) { settled = true; resolve(null); } }, API_LOAD_MS);
        try {
          r.api.createController(slot, { uri: firstUri, width: '100%', height: EMBED_HEIGHT }, (c) => {
            c.addListener?.('playback_update', (e) => onUpdate(e?.data || {}));
            c.addListener?.('ready', () => { if (!settled) { settled = true; try { clearTimer(t); } catch { /* gone */ } resolve(c); } });
          });
        } catch { if (!settled) { settled = true; try { clearTimer(t); } catch { /* gone */ } resolve(null); } }
      });
      if (dead) { try { made?.destroy?.(); } catch { /* gone */ } return { ok: false, reason: 'gone' }; }
      if (!made) { st.status = 'failed'; st.reason = 'api-load-failed'; tell(); return { ok: false, reason: 'api-load-failed' }; }
      ctl = made;
      st.status = 'ready';
      return { ok: true };
    })();
    const r = await making;
    making = null;
    return r;
  }

  const api = {
    /** Play a Spotify link here: `{ ok, order: 'ours'|'spotify', note }` or `{ ok: false, reason, device? }`. */
    async play({ uri, force = false } = {}) {
      const g = ++gen;
      clearWait();
      run = null;
      const u = parseSpotifyUri(uri);
      if (!u) return { ok: false, reason: 'bad-uri' };
      // (note BK item 4) Another device on the connected account playing now: ask, do not take over.
      if (!force && typeof elsewhere === 'function') {
        let name = null;
        try { name = await elsewhere(); } catch { name = null; }
        if (g !== gen || dead) return { ok: false, reason: 'superseded' };
        if (name) return { ok: false, reason: 'playing-elsewhere', device: name };
      }
      const type = u.split(':')[1];
      let first = u;
      let ours = false;
      let chosen = null;
      st.note = '';
      if (picker && typeof tracksFor === 'function' && read(shuffle, true) && (type === 'playlist' || type === 'album')) {
        let t = null;
        try { t = await tracksFor(u); } catch { t = null; }
        if (g !== gen || dead) return { ok: false, reason: 'superseded' };
        if (t && t.ok && t.tracks?.length) {
          const pick = picker.next(t.tracks);
          if (pick) { first = pick; ours = true; chosen = { ours: true, pool: t.tracks, current: pick, endedFor: null }; }
        }
        if (!chosen) st.note = EMBED_WORDS['own-order'];
      } else if (type === 'playlist' || type === 'album' || type === 'artist' || type === 'show') {
        st.note = EMBED_WORDS['own-order'];
      }
      const e = await ensure(first);
      if (g !== gen || dead) return { ok: false, reason: 'superseded' };
      if (!e.ok) return e;
      run = chosen || { ours: false, pool: [], current: first, endedFor: null };
      st.uri = null;           // the first report of the song counts it
      st.ours = ours;
      try { const h = read(host, null); if (h) h.hidden = false; ctl.loadUri(first); ctl.play(); }
      catch { return { ok: false, reason: 'failed' }; }
      tell();
      return { ok: true, order: ours ? 'ours' : 'spotify', note: st.note };
    },
    async pause() { st.busPaused = false; try { ctl?.pause(); } catch { /* gone */ } return { ok: true }; },
    async resume() { try { ctl?.resume(); } catch { /* gone */ } return { ok: true }; },
    /** Finished with: pause, stop steering, and put the frame away. */
    async stop() {
      gen++; clearWait(); run = null;
      try { ctl?.pause(); } catch { /* gone */ }
      st.playing = false; st.busPaused = false;
      busActive(false);
      try { const h = read(host, null); if (h) h.hidden = true; } catch { /* gone */ }
      tell();
      return { ok: true };
    },
    state,
    available: () => true,
    destroy() {
      dead = true; gen++; clearWait(); run = null;
      try { ctl?.destroy?.(); } catch { /* gone */ }
      ctl = null;
      try { if (registered) { audio?.setActive?.(audioId, false); audio?.unregister?.(audioId); } } catch { /* gone */ }
      registered = false;
    },
  };
  function state() { return { ...st, steering: !!run, timer: waitTimer != null, current: run?.current || null }; }
  return api;
}
