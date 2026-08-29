// game_music.js — a quiet bed under a game. Shared, because more than one module wants one.
//
// *** WHY THIS EXISTS AT ALL: THE PORT DROPPED THE MUSIC AND SHOULD NOT HAVE. ***
// Cici's pressgame streamed meditation tracks off the external drive through a manifest. That
// exact mechanism could not come across — there is no drive here, no `meditation.json`, and a
// module that fetches a missing file on every mount logs errors forever — and "so it has no
// music" was the wrong conclusion to draw from that. Mike, 2026-08-29: *"The games should
// still have music."*
//
// TWO SOURCES, AND THE ORDER MATTERS:
//
//   1. A LINKED FOLDER, exactly like photos. `{sourceId, album}` → the registry → a listing →
//      audio files, shuffled. THE PLATFORM NEVER HOLDS THE BYTES; it holds a label and an
//      address, which is the same promise made on the privacy page about photos and video.
//   2. *** SYNTHESISED AMBIENT, WHICH NEEDS NOTHING. *** Two detuned oscillators under a slow
//      filter sweep. No files, no folder, no configuration, nothing to 404 — so a game has
//      music the first time anybody opens it, on a machine that has never been set up. That
//      is the difference between a feature and a feature somebody has to earn.
//
// FALLING BACK IS NOT FAILING. A folder that is unreachable, empty, or full of photos rather
// than music drops to ambient rather than to silence, and says so through `state()`. Silence
// is indistinguishable from "music is broken", and the person sitting in front of it cannot
// tell you which.
//
// AUTOPLAY IS BLOCKED UNTIL SOMEBODY TOUCHES SOMETHING, on every browser, by design. So
// `play()` can be refused, and that is not an error — it records `blocked` and the caller
// tries again on the first press. Cici's did the same thing for the same reason.
//
// IT IS A BED, NOT A PERFORMANCE. Default volume is low and there is no track display, no
// skip button and no "now playing". A game that draws attention to its soundtrack is a game
// competing with itself.

import { resolveListing } from './media_sources.js';
import { MUSIC_GROUP, GAME_MUSIC_PRIORITY } from './audio_bus.js';

export const MUSIC_MODES = ['ambient', 'folder', 'off'];

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
export const isAudioPath = (p) => AUDIO_EXT.test(String(p || ''));

export function createGameMusic({
  sources = null,                 // a media-sources client, or null for ambient only
  resolve = resolveListing,
  volume = 0.3,
  // *** THE SPEAKER ARBITER. *** Optional, and the module keeps working without one - but
  // WITHOUT it this bed plays at full volume under a spoken cue and alongside a video, which
  // is the exact failure audio_bus.js exists to stop. Pass one.
  audio = null,
  audioId = 'game-music',
  // Injectable so the whole file is testable with no audio hardware and no network.
  makeContext = () => {
    const A = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    return A ? new A() : null;
  },
  makeAudio = (src) => (typeof Audio === 'function' ? new Audio(src) : null),
} = {}) {
  let mode = 'ambient';
  let vol = clamp01(volume);
  // What the arbiter last told us to play at. 1 until it says otherwise, so a missing bus
  // means full volume rather than silence - a broken coordinator must never mute a game.
  let gain = 1;
  let playing = false;
  let blocked = false;            // autoplay refused; retry on the next gesture
  let note = '';                  // why we are on ambient when a folder was asked for

  // ---- the folder path -------------------------------------------------------------
  let playlist = [];
  let current = null;
  let el = null;

  // ---- the synthesised path --------------------------------------------------------
  let ac = null, master = null, voices = [], lfo = null, filter = null;

  function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; }

  // Returns whether it actually started. IT DOES NOT WRITE `note` ITSELF, and that is the
  // point: `fallback` has already recorded WHY we are here, and having the rescue overwrite
  // the reason for the rescue is how "your folder is empty" turns into "this browser has no
  // audio" - a true sentence about a different problem, which is worse than no sentence.
  function ambientStart() {
    if (ac) return true;
    try {
      ac = makeContext();
      if (!ac) return false;
      master = ac.createGain();
      master.gain.value = vol * 0.28 * gain;   // a BED. Loud ambient is not ambient.
      filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 0.6;
      filter.connect(master);
      master.connect(ac.destination);

      // A low fifth, slightly detuned so it beats gently instead of sitting still. Chosen
      // to sit UNDER speech rather than compete with it - the cues have to stay audible.
      for (const f of [110, 164.81, 110.6]) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.value = 0.33;
        o.connect(g); g.connect(filter);
        o.start();
        voices.push({ o, g });
      }
      // The slow sweep that keeps it from being a test tone.
      lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.frequency.value = 0.045;         // ~22s, well below anything that reads as rhythm
      lg.gain.value = 240;
      lfo.connect(lg); lg.connect(filter.frequency);
      lfo.start();
      return true;
    } catch (err) {
      ac = null;
      return false;
    }
  }

  function ambientStop() {
    try { voices.forEach(({ o }) => o.stop()); } catch { /* already stopped */ }
    try { lfo?.stop(); } catch { /* already stopped */ }
    voices = []; lfo = null; filter = null; master = null;
    try { ac?.close?.(); } catch { /* already closed */ }
    ac = null;
  }

  // ---- the folder path -------------------------------------------------------------

  // Never the same track twice running, which is the one thing a listener notices.
  function pick() {
    if (playlist.length <= 1) return playlist[0] || null;
    let t;
    do { t = playlist[Math.floor(Math.random() * playlist.length)]; } while (t === current);
    return t;
  }

  function fileStart() {
    const track = pick();
    if (!track) return;
    current = track;
    el = makeAudio(track.url);
    if (!el) { fallback('this browser cannot play audio files'); return; }
    el.volume = vol * gain;
    el.addEventListener('ended', () => { if (playing) fileStart(); });
    // A single unplayable file must not end the music. Drop it and move on; if they are ALL
    // unplayable the playlist empties and we fall back rather than looping on errors.
    el.addEventListener('error', () => {
      playlist = playlist.filter((t) => t !== track);
      if (!playlist.length) fallback('none of those files would play');
      else if (playing) fileStart();
    });
    const p = el.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { blocked = true; });
    }
  }

  function fileStop() {
    try { el?.pause?.(); } catch { /* already stopped */ }
    el = null;
  }

  // Drop to ambient WITH A REASON. Silence would be indistinguishable from "broken".
  function fallback(why) {
    mode = 'ambient';
    fileStop();
    const ok = playing ? ambientStart() : true;
    // Set LAST, and say both things when both are true. A person told "your folder is empty"
    // can fix it; a person told "this browser has no audio" when their folder is the problem
    // goes looking in the wrong place.
    note = ok ? why : `${why}, and this device has no audio either`;
  }

  // Push the current volume x arbiter gain at whatever is actually making the sound.
  function enact() {
    if (master) master.gain.value = vol * 0.28 * gain;
    if (el) el.volume = vol * gain;
  }

  // JOIN THE MUSIC GROUP. `media` tier, so a voice cue ducks this; group `music` at game
  // priority, so a video outranks it and a second game preempts the first.
  if (audio) {
    audio.register(audioId, {
      tier: 'media', group: MUSIC_GROUP, groupPriority: GAME_MUSIC_PRIORITY,
      onGain: (level) => {
        gain = level;
        enact();
        // LEVEL 0 IS "SOMEBODY ELSE HAS THE SPEAKER" - a video is playing, or a hush is on.
        // Stop rather than play silently: an <audio> element grinding through a track nobody
        // can hear still burns a Pi's CPU and still ends, so the playlist would march on
        // while she heard none of it.
        if (level === 0) { fileStop(); ambientStop(); }
        else if (playing && !ac && !el) { if (mode === 'folder' && playlist.length) fileStart(); else ambientStart(); }
      },
    });
  }

  return {
    // Point at a linked folder. Returns what it found, and falls back on its own if that is
    // nothing usable.
    async useFolder(sourceId, album = '') {
      mode = 'folder'; note = ''; playlist = []; current = null;
      if (!sources || !sourceId) { fallback('no music folder chosen'); return { tracks: 0 }; }
      try {
        const all = await sources.list();
        const source = (all || []).find((s) => s.id === sourceId);
        if (!source) { fallback('that music folder is not connected'); return { tracks: 0 }; }
        const listing = await resolve(source, album);
        playlist = (listing.items || []).filter((it) => isAudioPath(it.path || it.url));
        if (!playlist.length) { fallback('no music in that folder'); return { tracks: 0 }; }
      } catch (err) {
        fallback('that music folder could not be reached');
        return { tracks: 0, error: String(err) };
      }
      if (playing) { ambientStop(); fileStart(); }
      return { tracks: playlist.length };
    },

    useAmbient() {
      mode = 'ambient'; note = ''; fileStop();
      if (playing && !ambientStart()) note = 'this device has no audio';
    },
    off() { mode = 'off'; this.pause(); },

    play() {
      if (mode === 'off') return;
      playing = true; blocked = false;
      audio?.setActive?.(audioId, true);
      if (mode === 'folder' && playlist.length) { ambientStop(); fileStart(); }
      else {
        fileStop();
        if (!ambientStart() && !note) note = 'this device has no audio';
        try { ac?.resume?.(); } catch { /* fine */ }
      }
    },

    pause() {
      playing = false;
      audio?.setActive?.(audioId, false);
      fileStop();
      ambientStop();
    },

    setVolume(v) {
      vol = clamp01(v);
      enact();
      return vol;
    },

    // Everything a caller might want to SAY to somebody, including why it is not doing what
    // they asked. `note` is the difference between "music is off" and "your folder is empty".
    state: () => ({ mode, playing, blocked, note, tracks: playlist.length, volume: vol,
                    gain, ducked: gain > 0 && gain < 1, yielded: gain === 0 }),

    destroy() { this.pause(); audio?.unregister?.(audioId); playlist = []; current = null; },
  };
}
