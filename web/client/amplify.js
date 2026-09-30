// amplify.js — AMPLIFY MODE: what a microphone hears, played louder through the screen's speaker.
//
// Row 2.42. Mike, 2026-09-30: *"an amplify mode where it takes from the mics and plays her speech
// through the speakers of your choice."* For somebody hard of hearing sitting with a person whose
// voice is quiet: the words come out of the screen, louder.
//
//     microphone -> gain (the setting x the mixer's level) -> limiter -> meter -> the speaker
//
// ---------------------------------------------------------------------------------------
// *** THE RISK, SAID PLAINLY: A MICROPHONE PLAYED THROUGH A SPEAKER NEAR IT CAN HOWL. ***
// ---------------------------------------------------------------------------------------
//
// The speaker's sound reaches the microphone, is amplified again, reaches it louder, and in a
// fraction of a second the room is a whistle. It is worst when the microphone and the speaker are
// THE SAME BOX - a USB speakerphone, which is exactly the device a bedside screen tends to have -
// and when the gain is high. So:
//
//   1. IT IS OFF BY DEFAULT. Nothing here opens a microphone until somebody turns it on.
//   2. THE GAIN IS CAPPED (`maxGain`), and a LIMITER sits after it, so it cannot get louder than
//      full scale however high somebody sets it.
//   3. A FEEDBACK GUARD listens to what it is about to play. A howl is loud AND steady (one tone,
//      holding); speech is loud in bursts. When the output stays loud and steady for `holdMs`, it
//      TURNS ITSELF OFF, says why on the output bus, and stays off until a person turns it on
//      again. Nobody-answers test: if nobody comes, it stays off - silence, the safe direction.
//   4. `sameDeviceWarning` says so when the microphone and the chosen speaker are one device.
//   5. THE BETTER FIX IS DISTANCE: a microphone close to the person and far from the speaker - the
//      phone by the pillow (phone_mic.js) - is the arrangement that least wants to howl. That is
//      why the source is a setting ('room' or 'phone').
//
// The guard's numbers are [inferred, not measured]: a howl on the bench speakerphone has not been
// recorded. They are options, and the bench numbers replace them (Mike's list).
//
// ---------------------------------------------------------------------------------------
// THE MIXER'S RULES APPLY
// ---------------------------------------------------------------------------------------
//
// It is a source on the audio bus like any other (`amplify`, on its own mixer channel `amplify`),
// so the MASTER and a FADER turn it down, a call ducks it, and the bus's level is multiplied into
// the gain. Registered on the `talk` tier with a duck depth of 1: while it plays, nothing under it
// is ducked or silenced - amplifying the room is not a reason for the video to go quiet.
// `audio_bus.js` does not list `amplify` among its CHANNELS yet, so the mixer menu shows no fader
// row for it; the bus handles a named channel it does not list (fader 1, no minimum). Adding the
// row is a one-line change there (for Mike's list).

import { PROFILES as MIC_PROFILES } from './mic_owner.js';

export const AMPLIFY_ID = 'amplify';
export const AMPLIFY_CHANNEL = 'amplify';
export const AMPLIFY_SOURCES = ['room', 'phone'];

export const AMPLIFY_DEFAULTS = Object.freeze({
  on: false,
  // Percent. 200% = twice as loud as the microphone delivers it (+6 dB).
  gain: 200,
  // The ceiling, whatever is asked for. 400% = +12 dB.
  maxGain: 400,
  source: 'room',
  guard: true,
  // THE GUARD'S NUMBERS [inferred; measure on the bench]. RMS of what is about to play, 0..1.
  // 0.3 RMS is loud - roughly -10 dBFS, a level speech touches in bursts and a howl sits at.
  threshold: 0.3,
  // Loud for this long without a break...
  holdMs: 600,
  // ...and steady: (loudest - quietest) / loudest across that time at or under this. Speech swings
  // far more than 25% between 50 ms frames; a feedback tone barely moves.
  steadiness: 0.25,
  sampleMs: 50,
});

export const AMPLIFY_FIELDS = [
  { key: 'amplifyOn', label: 'Amplify: play the microphone louder through this screen', kind: 'toggle',
    default: AMPLIFY_DEFAULTS.on, level: 'standard',
    note: 'For somebody hard of hearing. A microphone near a speaker can howl: this turns itself '
        + 'off if it does. A microphone close to the person and far from the speaker works best.' },
  { key: 'amplifyGain', label: 'Amplify: how much louder', kind: 'number', unit: '%',
    default: AMPLIFY_DEFAULTS.gain, min: 100, max: AMPLIFY_DEFAULTS.maxGain, step: 50, level: 'standard' },
  { key: 'amplifySource', label: 'Amplify: which microphone', kind: 'choice',
    default: AMPLIFY_DEFAULTS.source, level: 'standard',
    options: [
      { value: 'room', label: 'This screen’s microphone' },
      { value: 'phone', label: 'A phone joined as a microphone' },
    ] },
  { key: 'amplifyGuard', label: 'Amplify: turn itself off if it starts to howl', kind: 'toggle',
    default: AMPLIFY_DEFAULTS.guard, level: 'advanced' },
];

/** A settings row -> this file's options. Each unset or broken key is its default. */
export function amplifyOptionsFrom(values = {}) {
  const v = values || {};
  const g = Number(v.amplifyGain);
  return {
    on: typeof v.amplifyOn === 'boolean' ? v.amplifyOn : AMPLIFY_DEFAULTS.on,
    gain: v.amplifyGain !== null && v.amplifyGain !== '' && typeof v.amplifyGain !== 'boolean'
      && Number.isFinite(g) && g >= 0 ? Math.min(g, AMPLIFY_DEFAULTS.maxGain) : AMPLIFY_DEFAULTS.gain,
    source: AMPLIFY_SOURCES.includes(v.amplifySource) ? v.amplifySource : AMPLIFY_DEFAULTS.source,
    guard: typeof v.amplifyGuard === 'boolean' ? v.amplifyGuard : AMPLIFY_DEFAULTS.guard,
  };
}

/**
 * THE FEEDBACK GUARD. Pure: fed one RMS reading at a time with its time, answers whether the
 * output has run away. Trips when every reading across `holdMs` is at or above `threshold` AND
 * the readings are steady. Anything below the threshold starts the watch over.
 */
export function createFeedbackGuard({
  threshold = AMPLIFY_DEFAULTS.threshold,
  holdMs = AMPLIFY_DEFAULTS.holdMs,
  steadiness = AMPLIFY_DEFAULTS.steadiness,
} = {}) {
  let run = [];                                  // [{ t, v }] — consecutive loud readings
  return {
    sample(v, t) {
      const x = Number(v);
      if (!Number.isFinite(x) || x < threshold) { run = []; return false; }
      run.push({ t: Number(t) || 0, v: x });
      while (run.length > 2 && run[run.length - 1].t - run[1].t >= holdMs) run.shift();
      const span = run[run.length - 1].t - run[0].t;
      if (span < holdMs) return false;
      let hi = -Infinity, lo = Infinity;
      for (const r of run) { if (r.v > hi) hi = r.v; if (r.v < lo) lo = r.v; }
      return hi > 0 && (hi - lo) / hi <= steadiness;
    },
    reset() { run = []; },
  };
}

/** RMS of a block of samples (-1..1). */
export function rms(block) {
  if (!block || !block.length) return 0;
  let s = 0;
  for (let i = 0; i < block.length; i++) s += block[i] * block[i];
  return Math.sqrt(s / block.length);
}

/**
 * Microphone and speaker on ONE device (browsers give both halves of a device the same
 * `groupId`) - a speakerphone. Returns the warning to show, or null.
 */
export function sameDeviceWarning(input, output) {
  const a = input && input.groupId; const b = output && output.groupId;
  if (!a || !b || a !== b) return null;
  return 'The microphone and the speaker are the same device, so amplifying is likely to howl. '
    + 'A microphone closer to the person, or a separate speaker, works better.';
}

/**
 * THE AMPLIFIER.
 *
 *   audio          the audio bus (audio_bus.js): the master, a fader, ducks
 *   micOwner       the screen's microphone arbiter, for source 'room'
 *   phoneStream    () => MediaStream | null — a phone joined as a microphone (phone_mic.js)
 *   output         the output bus, to say why it turned itself off
 *   makeContext    () => AudioContext (injected; a test needs no sound card)
 */
export function createAmplifier({
  audio = null,
  micOwner = null,
  phoneStream = () => null,
  output = null,
  settings = {},
  makeContext = () => {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    return AC ? new AC() : null;
  },
  // A remote WebRTC stream fed into Web Audio can come out SILENT in Chrome unless the stream is
  // also attached to a media element [training knowledge; confirm on the bench]. A muted element
  // plays nothing and keeps it flowing. Only used for the phone.
  makeKeepAlive = (stream) => {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    el.play?.().catch?.(() => {});
    return el;
  },
  guardOptions = {},
  sampleMs = AMPLIFY_DEFAULTS.sampleMs,
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTick = (fn, ms) => setInterval(fn, ms),
  clearTick = (id) => clearInterval(id),
  onChange = null,
} = {}) {
  let opts = amplifyOptionsFrom(settings);
  let state = 'off';                 // off | starting | running | tripped | no-source
  let ctx = null;
  let nodes = null;                  // { src, gain, limiter, meter, keep }
  let busLevel = 1;
  let tick = null;
  let micHeld = false;
  let sinkId = '';
  let startSeq = 0;
  const guard = createFeedbackGuard(guardOptions);

  const tell = () => { try { onChange?.(api.status()); } catch (err) { console.error('amplify onChange', err); } };

  function effectiveGain() {
    if (state !== 'running') return 0;
    const g = Math.min(Math.max(0, opts.gain), AMPLIFY_DEFAULTS.maxGain) / 100;
    const b = Number.isFinite(busLevel) ? Math.max(0, Math.min(1, busLevel)) : 1;
    return g * b;
  }
  function applyGain() {
    if (!nodes?.gain) return;
    const v = effectiveGain();
    try {
      if (nodes.gain.gain.setTargetAtTime && ctx) nodes.gain.gain.setTargetAtTime(v, ctx.currentTime || 0, 0.02);
      else nodes.gain.gain.value = v;
    } catch { try { nodes.gain.gain.value = v; } catch { /* gone */ } }
  }

  try {
    audio?.register?.(AMPLIFY_ID, {
      tier: 'talk', channel: AMPLIFY_CHANNEL, duck: 1,
      onGain: (level) => { busLevel = Number(level); applyGain(); },
    });
  } catch (err) { console.error('amplify: register', err); }

  function teardown() {
    if (tick != null) { try { clearTick(tick); } catch { /* gone */ } tick = null; }
    if (nodes) {
      for (const n of [nodes.src, nodes.gain, nodes.limiter, nodes.meter]) { try { n?.disconnect?.(); } catch { /* gone */ } }
      if (nodes.keep) { try { nodes.keep.pause?.(); nodes.keep.srcObject = null; } catch { /* gone */ } }
      nodes = null;
    }
    if (ctx) { try { ctx.close?.(); } catch { /* gone */ } ctx = null; }
    try { audio?.setActive?.(AMPLIFY_ID, false); } catch { /* gone */ }
    if (micHeld) { micHeld = false; try { micOwner?.release?.(AMPLIFY_ID); } catch { /* gone */ } }
    guard.reset();
  }

  function trip() {
    teardown();
    state = 'tripped';
    try {
      output?.notify?.('Amplify turned itself off because it started to howl. Move the microphone '
        + 'away from the speaker or turn it down, then turn it on again.', { source: 'amplify' });
    } catch { /* an output bus is optional */ }
    tell();
  }

  function sample() {
    if (!nodes?.meter || state !== 'running' || !opts.guard) return;
    let level = 0;
    try {
      const m = nodes.meter;
      const buf = new Float32Array(m.fftSize || 2048);
      m.getFloatTimeDomainData(buf);
      level = rms(buf);
    } catch { return; }
    if (guard.sample(level, now())) trip();
  }

  async function sourceStream() {
    if (opts.source === 'phone') return phoneStream?.() || null;
    if (!micOwner) return null;
    micHeld = true;
    try { return await micOwner.acquire(AMPLIFY_ID, MIC_PROFILES.raw); }
    catch (err) { micHeld = false; console.error('amplify: no microphone', err); return null; }
  }

  async function start() {
    if (state === 'running' || state === 'starting') return state === 'running';
    const my = ++startSeq;
    state = 'starting';
    const stream = await sourceStream();
    if (my !== startSeq || state !== 'starting') {             // stopped while opening
      if (micHeld) { micHeld = false; try { micOwner?.release?.(AMPLIFY_ID); } catch { /* gone */ } }
      return false;
    }
    if (!stream) { state = 'no-source'; teardown(); tell(); return false; }
    ctx = makeContext();
    if (!ctx) { state = 'no-source'; teardown(); tell(); return false; }
    try { if (ctx.state === 'suspended') ctx.resume?.().catch?.(() => {}); } catch { /* fine */ }
    try {
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const limiter = ctx.createDynamicsCompressor();
      // A brick wall near full scale: however high the gain, it does not clip or grow past this.
      try {
        limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20;
        limiter.attack.value = 0.003; limiter.release.value = 0.1;
      } catch { /* a fake or an old engine: the gain cap still holds */ }
      const meter = ctx.createAnalyser();
      meter.fftSize = 2048;
      src.connect(gain); gain.connect(limiter); limiter.connect(meter); meter.connect(ctx.destination);
      const keep = opts.source === 'phone' ? makeKeepAlive(stream) : null;
      nodes = { src, gain, limiter, meter, keep };
    } catch (err) {
      console.error('amplify: could not build the audio path', err);
      state = 'no-source'; teardown(); tell(); return false;
    }
    if (sinkId) { try { await ctx.setSinkId?.(sinkId); } catch { /* keep the default speaker */ } }
    state = 'running';
    try { audio?.setActive?.(AMPLIFY_ID, true); } catch { /* the bus is advice */ }
    applyGain();
    guard.reset();
    try { tick = setTick(sample, sampleMs); } catch { tick = null; }
    tell();
    return true;
  }

  function stop(next = 'off') {
    startSeq++;
    teardown();
    state = next;
    tell();
  }

  const api = {
    start,
    stop: () => stop('off'),
    /** The mode. Turning it on again is also how a person resets a guard that tripped. */
    async setOn(on) {
      opts = { ...opts, on: !!on };
      if (opts.on) return start();
      stop('off');
      return false;
    },
    async update(values = {}) {
      const before = opts;
      opts = amplifyOptionsFrom(values);
      if (!opts.on) { if (state !== 'off' && state !== 'tripped') stop('off'); return api.status(); }
      if (state === 'running' && before.source !== opts.source) { stop('off'); await start(); }
      else if (state === 'off' || state === 'no-source') await start();
      applyGain();
      return api.status();
    },
    /** A phone joined or left: a running phone-sourced amplifier follows it. */
    async sourceChanged() {
      if (!opts.on || opts.source !== 'phone') return api.status();
      if (state === 'running') stop('off');
      if (state !== 'tripped') await start();
      return api.status();
    },
    /** The speaker of the person's choice. False where the browser cannot choose one. */
    async setSink(id) {
      sinkId = id ? String(id) : '';
      if (!ctx) return api.canChooseSpeaker();            // applied when it next starts
      if (typeof ctx.setSinkId !== 'function') return false;
      try { await ctx.setSinkId(sinkId); return true; } catch { return false; }
    },
    canChooseSpeaker: () => {
      try {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        return !!(AC && AC.prototype && 'setSinkId' in AC.prototype);
      } catch { return false; }
    },
    status: () => ({ on: opts.on, state, source: opts.source, gain: effectiveGain(), busLevel }),
    destroy() {
      stop('off');
      try { audio?.unregister?.(AMPLIFY_ID); } catch { /* gone */ }
    },
  };
  return api;
}
