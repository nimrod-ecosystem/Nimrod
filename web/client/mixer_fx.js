// mixer_fx.js — THE MIXER'S EFFECTS: a per-channel insert chain, two built-ins, a plugin slot.
//
// Row 2.35, Mike 2026-09-30: *"Reverbs to match your visual setting could be cool. Maybe just leave
// a hookup for people to use plugins? Could def be cool to have some out of the box though."*
//
// *** WHAT THIS CAN AND CANNOT REACH. *** An effect is a Web Audio node, so it only touches sound
// that Nimrod plays THROUGH Web Audio and connects to `input(channel)`:
//   CAN:    synthesised game sounds and ambient beds (game_music.js), earcons, and any recording
//           Nimrod plays itself - the AAC word clips, Piper voice files - once routed with
//           `routeElement` (same-origin files only, see there).
//   CANNOT: YouTube (its sound is inside a cross-origin iframe; the page can set its volume through
//           the player API and nothing else), the browser's own speech voice (speechSynthesis
//           has a volume and no audio output a page can reach), and a call (WebRTC audio through a
//           media element; routing a remote stream through Web Audio is possible but has been
//           unreliable in Chrome [training knowledge] and a call is the last thing to risk).
//           Those get the mixer's VOLUME (audio_bus.js) and no effects.
// On the kiosk today the AAC board speaks through the browser's voice, so its compressor setting
// changes nothing there until the clips are routed (see the report for row 2.35). Said here so a
// setting that does nothing is not mistaken for a broken one.
//
// *** VOLUME IS NOT DONE HERE. *** The audio bus already hands every source its level (fader x
// master x duck, lifted to the channel floor). The graph carries no fader and no master of its own;
// every plain gain node in it sits at 1. Doing volume twice is how a mixer ends up at 36% when every
// row says 60%.
//
// *** A FAILING EFFECT IS BYPASSED, NEVER SILENCING. *** The audio bus's rule, applied to nodes:
//   * an insert whose create() throws, hands back the wrong shape, belongs to another audio context,
//     or throws while being wired in is left out, and the chain is wired around it;
//   * a built-in the browser cannot make (no compressor on some engine) is left out the same way;
//   * *** A SILENCE WATCHDOG. *** A plugin can have a perfect shape and still eat the sound (its
//     input goes nowhere). Nothing short of listening can catch that, so each channel with effects
//     listens: sound going IN and nothing coming OUT, three checks running, takes the WHOLE chain
//     out and says why. Silence in and silence out is not a fault; one quiet gap is not a fault.
//     Changing that channel's effects is the retry.
//   * no Web Audio at all: `input()` is null and the caller plays direct, as it always did.
//
// *** PLUGINS ARE CODE ON THIS PAGE, NEVER A URL. *** `addPlugin` takes an object
// `{ id, label?, create(audioContext) -> { input, output, destroy? } }` - nothing is fetched,
// imported or evaluated from the network. Whoever can put a plugin object on the page could already
// run anything on it, so this adds no new door. A plugin format and a way to install one are later
// work (row 2.35: "build only the insert slot now").
//
// ORDER IN A CHAIN: compressor -> plugins (in the order added) -> reverb. The compressor evens the
// dry sound; the reverb goes last so its tail is not squashed by the compressor.

import { CHANNEL_IDS } from './audio_bus.js';

// *** REVERB PRESETS — TUNE HERE. *** seconds: impulse length. decay: how fast it dies (higher is
// faster). wet: how much reverb is ADDED to the untouched dry sound (the dry path is always 1).
// Unmeasured by ear; best guesses for "sounds like a room / a hall / outside", for Mike's list.
export const REVERB_PRESETS = Object.freeze({
  none: null,
  room: Object.freeze({ seconds: 0.7, decay: 3.5, wet: 0.18 }),
  hall: Object.freeze({ seconds: 2.4, decay: 2.2, wet: 0.28 }),
  // Outside there is almost no reverb: a short, fast, faint one, so it reads as air, not a room.
  outdoor: Object.freeze({ seconds: 0.4, decay: 7, wet: 0.08 }),
});
// `scene` is "match the screen's scene" - see SCENE_REVERB.
export const REVERB_CHOICES = Object.freeze(['none', 'room', 'hall', 'outdoor', 'scene']);

// *** WHICH SCENE SOUNDS LIKE WHAT — A BEST GUESS, FOR MIKE'S LIST. *** Keys are livescene.js and
// wallpaper.js scene ids (and Design's 'room' look). Indoor, furnished looks -> a room; the big
// mechanical/neon ones -> a hall; the outdoor ones -> outdoors. Anything not listed (the default
// 'nimrod' scene, 'theme', 'dusk', ...) is NO reverb, because an unknown scene must never make a
// voice sound like it is in a cathedral. A host can pass its own map.
export const SCENE_REVERB = Object.freeze({
  room: 'room', cozy: 'room', ocean: 'room',
  steampunk: 'hall', cyberpunk: 'hall',
  fall: 'outdoor', winter: 'outdoor', night: 'outdoor', forest: 'outdoor', sea: 'outdoor',
});

export function reverbForScene(sceneId, map = SCENE_REVERB) {
  const p = sceneId && map && Object.prototype.hasOwnProperty.call(map, sceneId) ? map[sceneId] : null;
  return p && REVERB_PRESETS[p] ? p : 'none';
}

const RESERVED = ['compressor', 'reverb'];
const ID_RX = /^[A-Za-z0-9][\w.-]{0,39}$/;

/** Is this a plugin the slot will take? `{ ok, why }` - `why` is a sentence a person can act on. */
export function checkPlugin(p) {
  if (!p || typeof p !== 'object') {
    return { ok: false, why: 'a plugin is an object { id, create(audioContext) }; nothing is loaded from a URL' };
  }
  if (typeof p.id !== 'string' || !ID_RX.test(p.id)) {
    return { ok: false, why: 'a plugin needs a short plain id (letters, digits, . _ -)' };
  }
  if (RESERVED.includes(p.id)) return { ok: false, why: `"${p.id}" is a built-in effect's name` };
  if (typeof p.create !== 'function') {
    return { ok: false, why: 'create must be a function on this page; plugins are never fetched' };
  }
  return { ok: true, why: '' };
}

// A deterministic impulse: decaying noise, the same every time (seeded), so a reverb never changes
// character between loads and a test can measure it.
export function makeImpulse(ctx, preset, seed = 0x2350) {
  const sr = Number(ctx.sampleRate) || 48000;
  const len = Math.max(1, Math.round(preset.seconds * sr));
  const buf = ctx.createBuffer(2, len, sr);
  let s = seed >>> 0;
  const rand = () => {                      // mulberry32
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, preset.decay);
  }
  return buf;
}

// ---- the two built-ins -------------------------------------------------------------------------

// *** THE COMPRESSOR — TUNE HERE. *** Gentle, for speech: evens a soft word and a loud one so both
// land. Measured in dev/mixer_test.html (a quiet and a loud tone through it, OfflineAudioContext):
// the engine's own makeup gain lifts the quiet sound rather than only pushing the loud one down.
export const COMPRESSOR = Object.freeze({ threshold: -30, knee: 20, ratio: 4, attack: 0.005, release: 0.2 });

function makeCompressor(ctx) {
  const n = ctx.createDynamicsCompressor();
  for (const [k, v] of Object.entries(COMPRESSOR)) if (n[k] && 'value' in n[k]) n[k].value = v;
  return { input: n, output: n, destroy() { try { n.disconnect(); } catch { /* gone */ } } };
}

function makeReverb(ctx, preset) {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const output = ctx.createGain();
  const conv = ctx.createConvolver();
  try { dry.role = 'dry'; wet.role = 'wet'; } catch { /* a frozen node is fine */ }
  dry.gain.value = 1;
  wet.gain.value = preset.wet;
  conv.buffer = makeImpulse(ctx, preset);
  input.connect(dry); dry.connect(output);
  input.connect(conv); conv.connect(wet); wet.connect(output);
  return {
    input, output,
    destroy() { for (const n of [input, dry, wet, conv, output]) { try { n.disconnect(); } catch { /* gone */ } } },
  };
}

// ---- the chain ---------------------------------------------------------------------------------

export function createMixerFx({
  context = null,
  makeContext = () => {
    const A = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    return A ? new A() : null;
  },
  destination = null,
  channels = CHANNEL_IDS,
  sceneMap = SCENE_REVERB,
  // The silence watchdog. `minLevel`: the RMS that counts as "sound is going in". `strikes`: how many
  // checks running before the chain is taken out. `watchMs`: how often it checks (0 = only when
  // checkSilence() is called).
  minLevel = 0.003,
  strikes: strikeLimit = 3,
  watchMs = 1000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onEvent = null,
} = {}) {
  let ctx = context;
  let ownContext = false;
  let triedContext = !!context;
  let scene = null;
  let timer = null;
  let destroyed = false;
  const chans = new Map();
  const routed = new WeakMap();
  const known = new Set(channels);

  const safe = (fn) => { try { return fn(); } catch { return undefined; } };
  const emit = (e) => { try { onEvent?.(e); } catch { /* a listener must not break the mixer */ } };
  const msg = (err) => String((err && err.message) || err || 'failed');

  function getContext() {
    if (ctx || triedContext || destroyed) return ctx;
    triedContext = true;
    try { ctx = makeContext() || null; ownContext = !!ctx; } catch { ctx = null; }
    return ctx;
  }

  function settingsOf(id) {
    if (!chans.has(id)) {
      chans.set(id, { id, compressor: false, reverb: 'none', plugins: [], inserts: new Map(),
        bypassed: [], chain: [], silenced: false, strikes: 0, input: null, output: null,
        probeIn: null, probeOut: null });
    }
    return chans.get(id);
  }

  // The channel's two ends, made once. null when there is no audio here.
  function nodesOf(ch) {
    const c = getContext();
    if (!c) return null;
    if (ch.input) return ch;
    try {
      ch.input = c.createGain();
      ch.output = c.createGain();
      ch.output.connect(destination || c.destination);
      if (typeof c.createAnalyser === 'function') {
        ch.probeIn = c.createAnalyser();
        ch.probeOut = c.createAnalyser();
        ch.probeIn.fftSize = 2048; ch.probeOut.fftSize = 2048;
        ch.output.connect(ch.probeOut);
      }
    } catch (err) {
      console.error('mixer: channel', err);
      ch.input = null; ch.output = null;
      return null;
    }
    return ch;
  }

  const reverbName = (ch) => (ch.reverb === 'scene' ? reverbForScene(scene, sceneMap) : ch.reverb);

  function bypass(ch, id, why) {
    ch.bypassed = ch.bypassed.filter((b) => b.id !== id);
    ch.bypassed.push({ id, why });
    emit({ type: 'bypass', channel: ch.id, id, why });
  }

  function dropInsert(ch, id) {
    const inst = ch.inserts.get(id);
    if (!inst) return;
    ch.inserts.delete(id);
    safe(() => inst.output.disconnect());
    try { inst.destroy?.(); } catch (err) { console.error(`mixer: "${id}" destroy`, err); }
  }

  // Make (or reuse) one insert, and prove it can be wired before trusting it.
  function insertFor(ch, id) {
    const c = ctx;
    const rev = reverbName(ch);
    const key = id === 'reverb' ? `reverb:${rev}` : id;
    const have = ch.inserts.get(id);
    if (have && have.key === key) return have;
    if (have) dropInsert(ch, id);
    let inst = null;
    try {
      if (id === 'compressor') inst = makeCompressor(c);
      else if (id === 'reverb') inst = makeReverb(c, REVERB_PRESETS[rev]);
      else {
        const p = ch.plugins.find((x) => x.id === id);
        inst = p ? p.create(c) : null;
      }
    } catch (err) {
      bypass(ch, id, `threw while being made: ${msg(err)}`);
      return null;
    }
    const ok = inst && typeof inst === 'object'
      && inst.input && typeof inst.input.connect === 'function'
      && inst.output && typeof inst.output.connect === 'function';
    if (!ok) { bypass(ch, id, 'did not hand back { input, output } audio nodes'); return null; }
    if ((inst.input.context && inst.input.context !== c) || (inst.output.context && inst.output.context !== c)) {
      bypass(ch, id, 'was built in another audio context');
      safe(() => inst.destroy?.());
      return null;
    }
    // Wire it to the channel's own ends and back off again: a node that throws here would throw
    // in the chain, and finding out now means the chain can be built without it.
    try {
      ch.input.connect(inst.input); ch.input.disconnect(inst.input);
      inst.output.connect(ch.output); inst.output.disconnect(ch.output);
    } catch (err) {
      safe(() => ch.input.disconnect(inst.input));
      bypass(ch, id, `could not be wired in: ${msg(err)}`);
      safe(() => inst.destroy?.());
      return null;
    }
    inst.key = key;
    ch.inserts.set(id, inst);
    return inst;
  }

  function wanted(ch) {
    if (ch.silenced) return [];
    const ids = [];
    if (ch.compressor) ids.push('compressor');
    for (const p of ch.plugins) ids.push(p.id);
    if (REVERB_PRESETS[reverbName(ch)]) ids.push('reverb');
    return ids;
  }

  // Tear the links down and wire the chain again. Every step is guarded; if the wiring itself
  // fails, the channel falls back to input -> output, which is the sound untouched.
  function rebuild(ch) {
    if (!nodesOf(ch)) { ch.chain = []; return; }
    safe(() => ch.input.disconnect());
    for (const inst of ch.inserts.values()) safe(() => inst.output.disconnect());
    if (ch.probeIn) safe(() => ch.input.connect(ch.probeIn));
    const ids = wanted(ch);
    const live = [];
    for (const id of ids) { const inst = insertFor(ch, id); if (inst) live.push([id, inst]); }
    // Built-ins no longer wanted are taken apart; plugins keep their instance while registered.
    for (const id of [...ch.inserts.keys()]) {
      if (!live.some(([x]) => x === id)) {
        if (RESERVED.includes(id) || !ch.plugins.some((p) => p.id === id)) dropInsert(ch, id);
      }
    }
    try {
      let prev = ch.input;
      for (const [, inst] of live) { prev.connect(inst.input); prev = inst.output; }
      prev.connect(ch.output);
      ch.chain = live.map(([id]) => id);
    } catch (err) {
      safe(() => ch.input.disconnect());
      for (const [, inst] of live) safe(() => inst.output.disconnect());
      if (ch.probeIn) safe(() => ch.input.connect(ch.probeIn));
      safe(() => ch.input.connect(ch.output));
      for (const [id] of live) bypass(ch, id, `the chain could not be wired: ${msg(err)}`);
      ch.chain = [];
    }
    ch.strikes = 0;
    arm();
  }

  function touched(chId) {
    if (!known.has(chId)) return null;
    const ch = settingsOf(chId);
    ch.silenced = false;             // changing a channel's effects is the retry
    return ch;
  }

  // ---- the silence watchdog ---------------------------------------------------------------------
  const buf = new Float32Array(2048);
  function rmsOf(an) {
    try {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return Math.sqrt(s / buf.length);
    } catch { return null; }
  }
  function checkSilence() {
    for (const ch of chans.values()) {
      if (!ch.chain.length || !ch.probeIn || !ch.probeOut) { ch.strikes = 0; continue; }
      const a = rmsOf(ch.probeIn), b = rmsOf(ch.probeOut);
      if (a == null || b == null) { ch.strikes = 0; continue; }
      if (a > minLevel && b < a * 0.01) ch.strikes += 1;
      else ch.strikes = 0;
      if (ch.strikes >= strikeLimit) {
        const ids = [...ch.chain];
        ch.silenced = true;
        for (const id of ids) bypass(ch, id, 'silent: sound went in and nothing came out, so the whole chain was taken out');
        rebuild(ch);
      }
    }
  }
  function arm() {
    if (destroyed || timer != null || !(watchMs > 0) || typeof setTimer !== 'function') return;
    if (![...chans.values()].some((c) => c.chain.length)) return;
    timer = setTimer(() => { timer = null; try { checkSilence(); } catch (err) { console.error('mixer: watchdog', err); } arm(); }, watchMs);
  }

  // ---- routing a media element ------------------------------------------------------------------
  function sameOrigin(el) {
    try {
      if (el.crossOrigin) return true;               // CORS asked for: a refusal fails the load, loudly
      const url = el.currentSrc || el.src;
      if (!url) return false;
      const u = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
      if (u.protocol === 'data:') return false;
      return typeof location !== 'undefined' && u.origin === location.origin;
    } catch { return false; }
  }

  return {
    context: () => getContext(),

    /** Where a Web Audio source connects to play on `channel`. null: play direct, as before. */
    input(chId) {
      if (!known.has(chId)) return null;
      const ch = settingsOf(chId);
      if (!ch.input) { if (!nodesOf(ch)) return null; rebuild(ch); }
      return ch.input;
    },

    /**
     * Send an <audio>/<video> element's sound through `channel`. REFUSES (returns false, and the
     * element keeps playing direct) whenever routing could silence it:
     *   * the audio context is not running - a routed element is silent until it resumes, and
     *     before the first tap on a page it will not [training knowledge: autoplay policy];
     *   * the file is from another origin without CORS - Web Audio hears such media as silence
     *     [training knowledge: the spec's cross-origin rule], which is the likeliest case for a
     *     linked photo folder.
     * An element can only be routed once (the browser allows one source per element); once routed
     * it is heard only through the mixer, for as long as the page lives.
     */
    routeElement(el, chId) {
      if (!el || !known.has(chId)) return false;
      const c = getContext();
      if (!c || typeof c.createMediaElementSource !== 'function') return false;
      const inp = this.input(chId);
      if (!inp) return false;
      if (routed.has(el)) {
        const src = routed.get(el);
        try { src.disconnect(); src.connect(inp); return true; } catch { return false; }
      }
      if (c.state !== 'running') return false;
      if (!sameOrigin(el)) return false;
      try {
        const src = c.createMediaElementSource(el);
        src.connect(inp);
        routed.set(el, src);
        return true;
      } catch (err) {
        console.error('mixer: route element', err);
        return false;
      }
    },

    setCompressor(chId, on) {
      const ch = touched(chId); if (!ch) return null;
      ch.compressor = !!on;
      ch.bypassed = ch.bypassed.filter((b) => b.id !== 'compressor');
      rebuild(ch);
      return ch.compressor;
    },

    /** 'none' | 'room' | 'hall' | 'outdoor' | 'scene'. Anything else is 'none'. */
    setReverb(chId, choice) {
      const ch = touched(chId); if (!ch) return null;
      ch.reverb = REVERB_CHOICES.includes(choice) ? choice : 'none';
      ch.bypassed = ch.bypassed.filter((b) => b.id !== 'reverb');
      rebuild(ch);
      return ch.reverb;
    },

    /** The screen's scene, for every channel whose reverb is 'scene'. */
    setScene(sceneId) {
      scene = sceneId == null ? null : String(sceneId);
      for (const ch of chans.values()) if (ch.reverb === 'scene') rebuild(ch);
      return reverbForScene(scene, sceneMap);
    },

    /** The insert slot. `{ ok, why }`: ok is false when it was refused or bypassed. */
    addPlugin(chId, plugin) {
      if (!known.has(chId)) return { ok: false, why: 'no such channel' };
      const chk = checkPlugin(plugin);
      if (!chk.ok) return chk;
      const ch = touched(chId);
      if (ch.plugins.some((p) => p.id === plugin.id)) this.removePlugin(chId, plugin.id);
      ch.bypassed = ch.bypassed.filter((b) => b.id !== plugin.id);
      ch.plugins.push(plugin);
      if (!getContext()) return { ok: false, why: 'this device has no Web Audio' };
      rebuild(ch);
      if (ch.chain.includes(plugin.id)) return { ok: true, why: '' };
      // Bypassed: it stays out of the chain and off the list, with the reason on record.
      ch.plugins = ch.plugins.filter((p) => p !== plugin);
      const b = ch.bypassed.find((x) => x.id === plugin.id);
      return { ok: false, why: b ? b.why : 'bypassed' };
    },

    removePlugin(chId, id) {
      if (!known.has(chId) || !chans.has(chId)) return false;
      const ch = chans.get(chId);
      const had = ch.plugins.some((p) => p.id === id);
      ch.plugins = ch.plugins.filter((p) => p.id !== id);
      ch.bypassed = ch.bypassed.filter((b) => b.id !== id);
      dropInsert(ch, id);
      ch.silenced = false;
      rebuild(ch);
      return had;
    },

    checkSilence,

    state() {
      const out = {};
      for (const id of known) {
        const ch = chans.get(id);
        out[id] = ch
          ? { chain: [...ch.chain], bypassed: ch.bypassed.map((b) => ({ ...b })), compressor: ch.compressor,
              reverbChoice: ch.reverb, reverb: reverbName(ch), plugins: ch.plugins.map((p) => p.id),
              silenced: ch.silenced }
          : { chain: [], bypassed: [], compressor: false, reverbChoice: 'none', reverb: 'none', plugins: [], silenced: false };
      }
      return out;
    },

    destroy() {
      destroyed = true;
      if (timer != null) { safe(() => clearTimer(timer)); timer = null; }
      for (const ch of chans.values()) {
        for (const id of [...ch.inserts.keys()]) dropInsert(ch, id);
        for (const n of [ch.input, ch.output, ch.probeIn, ch.probeOut]) if (n) safe(() => n.disconnect());
      }
      chans.clear();
      // Only a context this file made is closed; a shared one belongs to whoever passed it in.
      if (ownContext) safe(() => ctx.close?.());
      ctx = null;
    },
  };
}
