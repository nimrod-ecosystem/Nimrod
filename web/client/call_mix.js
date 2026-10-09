// call_mix.js — A BOARD WORD'S RECORDED CLIP, MIXED INTO A LIVE CALL'S OUTGOING SOUND (call loadouts,
// 2026-10-09).
//
// Mike, 2026-10-09: "Don't I have Piper set up on both ends already?" Piper is on the DESKTOP and made the
// seventeen board clips in web/client/aac/audio; it is not running live on either Pi. So the clips are real
// audio we hold, and THEY can go into the call - which the browser's own voice (speechSynthesis) cannot:
// it has no stream and no buffer a page can reach (ee74d82's header, call_transport.js WORDS).
//
// HOW (all inside this browser; nothing new goes to any server):
//
//     room microphone ──▶ gain (held to 0 while a clip plays) ──┐
//                                                                ├──▶ MediaStreamDestination ──▶ the call's audio sender
//     the word's clip (an AudioBuffer) ──────────────────────────┘          (RTCRtpSender.replaceTrack)
//
// While no clip plays, the call sends the room microphone's OWN track, exactly as before: nothing here is in
// the call's path until a word with a clip is chosen. Then the mixed track replaces it (replaceTrack: no new
// offer, the far end keeps the same sound slot), the clip plays into it, and when it ends the microphone's
// own track goes back. So a page whose audio context will not run - a browser that has not been touched yet,
// no Web Audio - never loses its call sound: the clip is simply not sent and the word goes as text, as it did.
//
// *** ECHO, AND WHY THE ROOM MICROPHONE IS HELD WHILE THE CLIP GOES. *** The far end hears the clip because
// it is IN the call's audio, not because the room's microphone picked it up off a speaker - echo cancellation
// is built to remove exactly what this screen plays, so a word that only came out of the speaker would be
// cancelled or garbled. But the room ALSO hears the word (the board speaks it in the room, output.say), and
// that sound reaches the microphone. The browser's own voice is not part of what echo cancellation removes
// (call_page.js WORDS_HOLD_MAX_MS says the same about the caller's side), so the far end would hear the word
// twice, a moment apart. So, by default, the microphone's share of the mix is held at zero while the clip
// plays and for a short tail after (CLIP_TAIL_MS); the clip itself is untouched. MIC_DURING_CLIP 'keep' turns
// that off (a room where somebody talks over the board on purpose). The person's own MUTE is never undone:
// a muted microphone track feeds silence into the mix, and its own track goes back muted.
//
// Every number is argued where it is declared. None is a menu row: nobody can judge them from a menu.

// How long a word waits for its clip to load before it goes as text only. 1500 ms, argued: the seventeen
// clips are 20-60 KB each and load from the same server in tens of ms (once; they are kept); a clip slower
// than this is on a link where the word arriving late is worse than it arriving without its sound. The load
// carries on, so the next time the same word is chosen it is ready.
export const CLIP_WAIT_MS = 1500;
// How long the room microphone stays held after the clip ends. 250 ms, argued: the room's own copy of the word
// (the speaker, then the room, then the microphone) arrives a few tens of ms after the clip, and a synthesised
// voice in the room can run a little longer than the clip. Short enough that nobody notices the room cut out.
export const CLIP_TAIL_MS = 250;
// The longest a clip is let play into a call. 8000 ms, argued: the longest shipped clip is under 2 s; this is
// the same ceiling call_page.js holds a caller's microphone for (WORDS_HOLD_MAX_MS), so neither side of a call
// can be held off the call for longer than the other. A longer file is cut, not refused.
export const CLIP_MAX_MS = 8000;
// What the room microphone does while a clip goes into the call: 'hold' (the default, see ECHO above) or 'keep'.
export const MIC_DURING_CLIP = Object.freeze(['hold', 'keep']);

const defaultContext = () => {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  return AC ? new AC() : null;
};
const defaultFetch = (url) => (typeof fetch === 'function'
  ? fetch(url).then((r) => (r && r.ok ? r.arrayBuffer() : null)).catch(() => null)
  : Promise.resolve(null));

/**
 * The mixer. One per call transport; it holds one audio context (made on the first clip, never at load: one
 * made before anybody touched the page starts suspended) and the clips it has loaded.
 *
 *   play(url, { getTrack, swap })   mix the clip at `url` into the call. `getTrack()` is the track the call's
 *                                   audio sender has now (the room microphone, or this mixer's own mixed track
 *                                   while a clip plays); `swap(track)` puts a track on that sender and resolves
 *                                   true when it did. Resolves { ok, why, ms }: ok = the clip is going into the
 *                                   call now; why when not ('no-clip' | 'slow' | 'no-audio' | 'suspended' |
 *                                   'no-sender' | 'no-mic' | 'failed').
 *   stop({ swapBack })              the call ended (swapBack false: its connection is gone) or a word must stop.
 *   load(url)                       the clip's AudioBuffer, or null (a missing file is cached as missing).
 */
export function createClipMixer({
  makeContext = defaultContext,
  fetchClip = defaultFetch,
  Stream = (typeof MediaStream !== 'undefined' ? MediaStream : null),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  waitMs = CLIP_WAIT_MS,
  tailMs = CLIP_TAIL_MS,
  maxMs = CLIP_MAX_MS,
  micDuringClip = 'hold',
  onLog = null,
} = {}) {
  const log = (...a) => { try { onLog?.(...a); } catch { /* a logger must not break a call */ } };
  const hold = micDuringClip !== 'keep';
  let ctx = null;
  let ctxFailed = false;
  const buffers = new Map();         // url -> Promise<AudioBuffer|null>
  let active = null;                 // { dest, mixed, micTrack, micSrc, micGain, clip, timer, swap }
  let destroyed = false;
  let seq = 0;

  function context() {
    if (ctx || ctxFailed) return ctx;
    try { ctx = makeContext(); } catch (e) { log('mix: no audio context', e); ctx = null; }
    if (!ctx) ctxFailed = true;
    return ctx;
  }

  function load(url) {
    if (!url) return Promise.resolve(null);
    if (buffers.has(url)) return buffers.get(url);
    const p = (async () => {
      const c = context();
      if (!c || typeof c.decodeAudioData !== 'function') return null;
      let data = null;
      try { data = await fetchClip(url); } catch { data = null; }
      if (!data) return null;
      try { return await c.decodeAudioData(data); } catch (e) { log('mix: could not decode', url, e); return null; }
    })();
    buffers.set(url, p);
    return p;
  }

  const within = (p, ms) => new Promise((resolve) => {
    let done = false;
    const t = setTimer(() => { if (!done) { done = true; resolve({ late: true }); } }, ms);
    Promise.resolve(p).then((v) => { if (!done) { done = true; try { clearTimer(t); } catch { /* gone */ } resolve({ value: v }); } },
      () => { if (!done) { done = true; try { clearTimer(t); } catch { /* gone */ } resolve({ value: null }); } });
  });

  // The context must be RUNNING, or the mixed track carries silence - and the call would lose its sound.
  async function running(c) {
    if (c.state === 'running') return true;
    try { const r = c.resume?.(); if (r && r.then) await within(r, waitMs); } catch { /* reported below */ }
    return c.state === 'running';
  }

  function teardown(a) {
    if (!a) return;
    if (a.timer != null) { try { clearTimer(a.timer); } catch { /* gone */ } a.timer = null; }
    for (const n of [a.clip, a.micSrc, a.micGain]) { try { n?.disconnect?.(); } catch { /* gone */ } }
    try { a.clip?.stop?.(); } catch { /* not started, or already stopped */ }
    try { a.mixed?.stop?.(); } catch { /* gone */ }
  }

  // The clip is over: the microphone's own track goes back on the sender, then the graph goes.
  async function finish(a, { swapBack = true } = {}) {
    if (!a || active !== a) return;
    active = null;
    if (swapBack && a.swap) {
      try { await a.swap(a.micTrack); } catch (e) { log('mix: could not put the microphone back', e); }
    }
    teardown(a);
  }

  async function play(url, { getTrack = () => null, swap = null } = {}) {
    if (destroyed) return { ok: false, why: 'failed' };
    const my = ++seq;
    const c = context();
    if (!c || typeof c.createMediaStreamDestination !== 'function' || typeof c.createBufferSource !== 'function') {
      return { ok: false, why: 'no-audio' };
    }
    // The clip, within the wait; the context, running. Either missing: text only, the call untouched.
    const got = await within(load(url), waitMs);
    if (got.late) return { ok: false, why: 'slow' };
    const buf = got.value;
    if (!buf) return { ok: false, why: 'no-clip' };
    if (!(await running(c))) return { ok: false, why: 'suspended' };
    if (destroyed || my !== seq) return { ok: false, why: 'failed' };   // a newer word took over meanwhile
    if (typeof swap !== 'function') return { ok: false, why: 'no-sender' };
    let a = active;
    if (!a) {
      const now = (() => { try { return getTrack() || null; } catch { return null; } })();
      if (!now) return { ok: false, why: 'no-sender' };     // no microphone on the call: nothing to mix into
      try {
        const dest = c.createMediaStreamDestination();
        let micSrc = null, micGain = null;
        if (Stream) {
          micSrc = c.createMediaStreamSource(new Stream([now]));
          micGain = c.createGain();
          micSrc.connect(micGain);
          micGain.connect(dest);
        }
        const mixed = dest.stream?.getAudioTracks?.()?.[0] || null;
        if (!mixed) { for (const n of [micSrc, micGain]) { try { n?.disconnect?.(); } catch { /* gone */ } } return { ok: false, why: 'failed' }; }
        a = { dest, mixed, micTrack: now, micSrc, micGain, clip: null, timer: null, swap };
      } catch (e) { log('mix: could not build the mix', e); return { ok: false, why: 'failed' }; }
      let swapped = false;
      try { swapped = await swap(a.mixed); } catch { swapped = false; }
      if (!swapped || destroyed || my !== seq) { teardown(a); return { ok: false, why: swapped ? 'failed' : 'no-sender' }; }
      active = a;
    }
    // A newer word stops the one still playing: a board where two words overlap says a third thing.
    if (a.clip) { try { a.clip.stop?.(); } catch { /* done */ } try { a.clip.disconnect?.(); } catch { /* gone */ } a.clip = null; }
    if (a.timer != null) { try { clearTimer(a.timer); } catch { /* gone */ } a.timer = null; }
    try {
      if (a.micGain?.gain) a.micGain.gain.value = hold ? 0 : 1;
      const clip = c.createBufferSource();
      clip.buffer = buf;
      clip.connect(a.dest);
      clip.start();
      a.clip = clip;
    } catch (e) { log('mix: could not play the clip', e); await finish(a); return { ok: false, why: 'failed' }; }
    const ms = Math.min(Math.max(0, Number(buf.duration) || 0) * 1000, maxMs);
    a.timer = setTimer(() => {
      a.timer = null;
      if (a.micGain?.gain) a.micGain.gain.value = 1;
      finish(a).catch(() => {});
    }, Math.round(ms + tailMs));
    return { ok: true, ms: Math.round(ms) };
  }

  return {
    play,
    load,
    /** True while a clip is going into the call (the mixed track is on the sender). */
    playing: () => !!active,
    /** The mixed track while a clip plays, else null - so the transport can tell it from the microphone's. */
    mixedTrack: () => active?.mixed || null,
    /** The microphone track this mixer will put back. */
    micTrack: () => active?.micTrack || null,
    async stop({ swapBack = true } = {}) { seq += 1; await finish(active, { swapBack }); },
    destroy() {
      destroyed = true;
      seq += 1;
      const a = active; active = null;
      teardown(a);
      buffers.clear();
      if (ctx) { try { ctx.close?.(); } catch { /* gone */ } }
      ctx = null;
    },
  };
}
