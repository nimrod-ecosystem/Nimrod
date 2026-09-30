// game_tones.js — SHORT SYNTHESISED GAME SOUNDS (a click on the beat, a blip off a brick), played
// THROUGH the speaker arbiter rather than beside it.
//
// Row 2.37 item 10 (rhythm and brick-breaker, MIKE_CHANGE_LIST.md, private repo). Both games make
// sound all the time they are running: a metronome is continuous by definition, and a ball in play
// is a stream of bounces. `audio_bus.js` says anything making continuous sound MUST register or it
// plays over everything - pressgame's own tones predate that rule and make their own AudioContext
// straight to the speakers. This file is the registered version, shared so the next game does not
// write a third.
//
// WHAT THE BUS SEES: one source per game instance, tier `sfx`, on the mixer's "Game sounds"
// channel. `setActive(true)` while the game is running (a beat going, a ball in play), `false` when
// it rests. The level the arbiter hands back (duck, fader, master) scales every tone after that; a
// level of 0 (somebody else has the speaker, or the fader is down) plays nothing at all.
//
// *** KNOWN INTERACTION, FLAGGED RATHER THAN FIXED HERE (audio_bus.js is not this file's): *** the
// `sfx` tier sits BELOW `media`, so while any media source is active - a video, OR THE GAME'S OWN
// MUSIC BED - these tones duck to DUCK_TO (0.5). Brick-breaker's ambient bed therefore halves
// brick-breaker's own blips. Audible, not silent, so it is not a fault; it is on Mike's list.
//
// DEFENSIVE BY CONSTRUCTION, the same rule as audio_bus.js: no bus means full level, no audio
// hardware means silence without an exception, and a broken context never throws into a game.
//
// NO SOUND BEFORE A GESTURE is the CALLER's rule (both games arm their tones on the first press):
// a browser refuses audio until somebody touches something anyway, and a game nobody has touched
// yet is a game nobody asked to hear.

const clamp01 = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0; };

function defaultMakeContext() {
  const A = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  return A ? new A() : null;
}

/**
 * const tones = createGameTones({ audio: ctx.audio, audioId: `rhythm:${ctx.instanceId}` });
 * tones.setActive(true);             // the game is making sound now
 * tones.tone(880, 40, { inSec: 0.05, type: 'square', level: 0.6 });
 * tones.destroy();                   // stops everything, closes a context it made, unregisters
 */
export function createGameTones({
  audio = null,
  audioId = 'game-tones',
  channel = 'sfx',
  volume = 0.5,
  makeContext = defaultMakeContext,
  // The screen's effects chain (mixer_fx.js), as game_music.js uses it: its context, its channel
  // input. Absent or broken, the tones make their own context and play direct.
  fx = undefined,
} = {}) {
  let vol = clamp01(volume);
  let gain = 1;                 // the arbiter's word; 1 until it says otherwise (a missing bus is full level)
  let ac = null;
  let out = null;
  let ownsContext = false;
  let active = false;
  let dead = false;
  const live = new Set();       // oscillators started and not yet ended

  const effectsOf = () => {
    if (fx !== undefined) return fx;
    try { return typeof audio?.effects === 'function' ? audio.effects() || null : null; } catch { return null; }
  };
  const enact = () => { try { if (out) out.gain.value = vol * gain; } catch { /* nothing to set */ } };

  if (audio && typeof audio.register === 'function') {
    try {
      audio.register(audioId, { tier: 'sfx', channel, onGain: (level) => { gain = clamp01(level); enact(); } });
    } catch (err) { console.error('game_tones: register', err); }
  }

  function ensure() {
    if (ac) return true;
    if (dead) return false;
    try {
      let dest = null;
      const chain = effectsOf();
      let shared = null;
      try { shared = chain?.context?.() || null; } catch { shared = null; }
      if (shared) {
        try { dest = chain.input?.(channel) || null; } catch { dest = null; }
        if (dest) { ac = shared; ownsContext = false; }
      }
      if (!ac) { ac = makeContext(); ownsContext = true; dest = null; }
      if (!ac) return false;
      out = ac.createGain();
      out.gain.value = vol * gain;
      out.connect(dest || ac.destination);
      return true;
    } catch (err) {
      try { out?.disconnect?.(); } catch { /* never connected */ }
      if (ownsContext) { try { ac?.close?.(); } catch { /* already closed */ } }
      ac = null; out = null; ownsContext = false;
      return false;
    }
  }

  return {
    /** "This game is making sound now" - what the arbiter ducks, fades and hushes. */
    setActive(on) {
      const next = !!on && !dead;
      if (next === active) return;
      active = next;
      try { audio?.setActive?.(audioId, active); } catch { /* advice only */ }
    },

    /**
     * One short tone. `inSec`: when, from now, in seconds (so a beat can be scheduled ahead of the
     * frame that noticed it). `level`: 0..1 relative to this game's volume. Returns whether a tone
     * was actually started - false with no audio, a silenced level, or after destroy.
     */
    tone(freq, ms = 60, { type = 'sine', level = 1, inSec = 0 } = {}) {
      if (dead || !(vol > 0) || !(gain > 0)) return false;
      const f = Number(freq);
      const dur = Math.max(0.005, Number(ms) / 1000 || 0.06);
      if (!Number.isFinite(f) || f <= 0) return false;
      if (!ensure()) return false;
      try {
        const t0 = (Number(ac.currentTime) || 0) + Math.max(0, Number(inSec) || 0);
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.value = f;
        const peak = Math.max(0.0002, clamp01(level));
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.008, dur / 4));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(out);
        live.add(o);
        o.onended = () => { live.delete(o); try { g.disconnect(); } catch { /* gone */ } };
        o.start(t0);
        o.stop(t0 + dur + 0.02);
        return true;
      } catch (err) {
        return false;
      }
    },

    /** Browsers start a context suspended until a gesture; call this from one. */
    resume() { try { ac?.resume?.(); } catch { /* fine */ } },

    setVolume(v) { vol = clamp01(v); enact(); return vol; },

    state: () => ({ volume: vol, gain, active, hasContext: !!ac, ownsContext, live: live.size, dead }),

    destroy() {
      if (dead) return;
      dead = true;
      for (const o of live) { try { o.onended = null; o.stop(); } catch { /* already stopped */ } }
      live.clear();
      try { out?.disconnect?.(); } catch { /* already disconnected */ }
      out = null;
      // A SHARED context belongs to the screen: closing it would silence everything else on it.
      if (ownsContext) { try { ac?.close?.(); } catch { /* already closed */ } }
      ac = null; ownsContext = false;
      try { audio?.setActive?.(audioId, false); } catch { /* advice only */ }
      try { audio?.unregister?.(audioId); } catch { /* gone */ }
      active = false;
    },
  };
}

/**
 * A stand-in AudioContext for suites: records every oscillator, never makes a sound. Exported so the
 * two game suites (and anything after them) share one fake rather than each growing its own.
 */
export function createFakeAudioContext() {
  const made = { oscillators: [], gains: [], closed: false, resumed: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const ctx = {
    currentTime: 0,
    destination: { connect() {} },
    state: 'running',
    createGain() { const g = { gain: param(), connect() {}, disconnect() { g.disconnected = true; } }; made.gains.push(g); return g; },
    createOscillator() {
      const o = { type: 'sine', frequency: param(), started: null, stopped: null, onended: null,
        connect() {}, disconnect() {},
        start(t) { o.started = t ?? ctx.currentTime; },
        stop(t) { o.stopped = t ?? ctx.currentTime; } };
      made.oscillators.push(o);
      return o;
    },
    createBiquadFilter() { return { type: 'lowpass', frequency: param(), Q: param(), connect() {}, disconnect() {} }; },
    resume() { made.resumed++; return Promise.resolve(); },
    close() { made.closed = true; ctx.state = 'closed'; return Promise.resolve(); },
    made,
  };
  return ctx;
}
