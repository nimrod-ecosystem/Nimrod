// recorder.js — TWO MICROPHONES, ONE UTTERANCE, WRITTEN DOWN TOGETHER.
//
// Mike, 2026-08-31:
//
//   *"It hears what she says more clearly in the phone by the pillow to determine WHAT she said,
//    and it hears it farther away in the webcam mic to know what it SOUNDS LIKE through the
//    device she'll be using daily."*
//
// That is a PAIRED CORPUS, and it is the thing that unblocks everything else. To make a
// recognizer work on the far microphone — the one that will actually be there every day — you
// need labeled far-microphone audio, and labeling it is hard for exactly the reason the far
// microphone is a problem in the first place: you cannot hear it well enough to know what was
// said. The close microphone supplies the label, the far one supplies the input, and being the
// same utterance at the same moment aligns them for free.
//
// ---------------------------------------------------------------------------------------
// *** IT DOES NOT LISTEN FOR SPEECH, AND THAT IS THE DESIGN, NOT A LIMITATION ***
// ---------------------------------------------------------------------------------------
//
// The obvious way to cut a corpus into utterances is voice activity detection: watch the level,
// start a clip when somebody speaks, end it when they stop. For this population that is a bad
// idea for the same reason the fallback ladder does not do it — a machine deciding when somebody
// has finished speaking will cut off the person who takes longest, which is the person the
// corpus is for.
//
// So there is no VAD here at all. Instead: **one continuous recording per device, plus a
// manifest of labeled MARKS.** Whatever is running the session already knows what it asked for
// — a trivia game knows it just asked for `paris`, a therapy session knows the target word — so
// it calls `mark('paris')` and the label is exact rather than inferred. Cutting the audio can
// happen later, offline, on a machine with time to spare.
//
// That also makes alignment trivial: both devices start from one clock, so a mark at 12.4s is
// the same moment in both files.
//
// ---------------------------------------------------------------------------------------
// *** WAV, NOT OPUS, AND THIS ONE IS NOT A PREFERENCE ***
// ---------------------------------------------------------------------------------------
//
// The easy way to record in a browser is `MediaRecorder`, which on Chromium gives you
// `audio/webm;codecs=opus`. **For this corpus that would be actively wrong.** Opus is a
// perceptual codec: it spends its bits on what a listener would notice and discards the rest,
// and at the far microphone the interesting signal IS the quiet, degraded, barely-there part
// that a perceptual codec is designed to throw away. Compressing the far channel would remove
// precisely the difference the recording exists to measure.
//
// So this writes uncompressed 16-bit PCM in a WAV container. It is about ten times bigger and
// it is honest.
//
// ---------------------------------------------------------------------------------------
// *** THE PRODUCER FIELD — DECIDED HERE BECAUSE THIS IS THE FIRST FILE ***
// ---------------------------------------------------------------------------------------
//
// `DECISIONS.md`, 2026-08-27, left exactly one thing open about writing into a user's folder:
//
//   "whatever file format Nimrod writes into a user's chosen folder has the same one-way
//    property a database schema had. A field absent at write time cannot be supplied afterwards.
//    If agents ever play the games, a file with no producer field cannot be filtered later.
//    This is now a file-format question rather than a migration, and it is cheap — but it is
//    still decided before the first file is written, not after."
//
// **This is that first file.** So the manifest carries `producer` from the very first byte, and
// `role`, and the device, and the sample rate — every field that cannot be reconstructed from
// the audio afterwards. A recording whose provenance was not written down at the moment of
// writing cannot be given one later, and a corpus you cannot filter is a corpus you cannot
// safely train on.

export const MANIFEST_VERSION = 1;

// ---------------------------------------------------------------------------------------
// *** HOW LONG IT IS KEPT — Mike, 2026-08-31: "how long the files are kept is an issue." ***
//
// He is right, and it is sharper here than for most data, for three reasons that all point the
// same way: this is INTELLIGIBLE SPEECH, recorded in a room that is not private (a care facility
// has staff and other visitors in it — `docs/modules/interstitials.md` already says recordings
// can include staff), belonging to somebody who cannot consent to keeping it. And it is
// VALUABLE, which is the pressure that erodes every retention limit ever written.
//
// *** THE EXPIRY IS WRITTEN INTO THE FILE, NOT ONLY INTO A SETTING. ***
// Same argument as `producer` directly below: a setting changed next month cannot reach a file
// written today. A recording that does not carry its own expiry has no expiry, whatever a
// settings row says — so every session states, in its own manifest, when it should be gone.
// Then any tool that can read the folder can act on it: this app, a later version of it, a
// script, or a person with a file manager.
//
// *** AND THE THING NIMROD MUST NOT CLAIM. ***
// It CANNOT promise "deleted after thirty days". The files live in a folder the user picked, on
// their machine, and this software is not running on day thirty. What it can honestly say is
// "cleaned up whenever this is opened", and that is what `fs_sink.js` does. Claiming the
// stronger thing would be a promise enforced by nothing — the same species of mistake as a test
// that passes for an adjacent reason, applied to a policy instead of to code.
//
// 0 = keep until somebody deletes it. A DEFAULT, not a rule: for a corpus somebody is actively
// training on, deleting it on a timer would destroy the work. The proposal is a short default
// with keeping being the deliberate choice, and the number is Mike's to set.
export const DEFAULT_KEEP_DAYS = 30;
export const KEEP_OPTIONS = [7, 30, 90, 0];

// Who or what produced this audio. A CLOSED set, for the same reason `input.js`'s rejection
// list is closed: something downstream will filter on it, and free text cannot be filtered.
export const PRODUCERS = ['human', 'agent', 'synthetic', 'unknown'];

// What a channel is FOR. This is the whole point of a paired recording and it must not be
// guessable from the filename alone.
export const ROLES = [
  'label',   // the close microphone. Clear enough to know what was said.
  'input',   // the far microphone. What the daily device actually hears.
  'other',
];

// ---------------------------------------------------------------------------------------
// WAV, written by hand. Pure, so it is testable — and it IS tested against the browser's own
// decoder rather than against my own reading of the header, because a wrong WAV header has
// exactly the same STRUCTURE as a right one. That is the QR lesson in AGENTS.md, and this is
// the same shape of mistake waiting to be made.
// ---------------------------------------------------------------------------------------
export function encodeWav(samples, sampleRate = 48000) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);      // everything after this field
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);             // PCM fmt chunk length
  view.setUint16(20, 1, true);              // 1 = uncompressed PCM
  view.setUint16(22, 1, true);              // mono. A microphone is one thing.
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate: rate * channels * bytesPerSample
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  str(36, 'data');
  view.setUint32(40, n * 2, true);

  // CLAMP BEFORE SCALING. Web Audio hands out floats that can sit slightly outside -1..1, and
  // an unclamped conversion WRAPS — a loud sample becomes a loud sample of the opposite sign,
  // which sounds like a click and looks, in a spectrogram, like exactly the kind of artefact
  // somebody would later blame on the microphone.
  let off = 44;
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7FFF, true);
    off += 2;
  }
  return buf;
}

// Everything that cannot be reconstructed from the audio afterwards. Built as a pure function so
// the SHAPE is testable without recording anything — and because this is the file format, which
// is the one thing here that cannot be changed retroactively.
export function buildManifest({
  producer = 'unknown',
  startedAt = 0,
  durationMs = 0,
  sampleRate = 48000,
  tracks = [],
  marks = [],
  note = '',
  keepDays = DEFAULT_KEEP_DAYS,
} = {}) {
  return {
    v: MANIFEST_VERSION,
    // *** PROVENANCE, WRITTEN AT WRITE TIME. *** See the header: a field absent now cannot be
    // supplied later, and `unknown` is deliberately distinct from absent — "we did not record
    // it" and "nobody said" are different facts, and collapsing them corrupts any count built
    // on top. Same argument as the four distinct non-answers in the private session model.
    producer: PRODUCERS.includes(producer) ? producer : 'unknown',
    startedAt,
    durationMs,
    sampleRate,
    // ONE ENTRY PER MICROPHONE, each saying what it was FOR. Without `role`, a pair of files is
    // just two recordings and the whole point is lost the first time somebody renames one.
    tracks: tracks.map((t) => ({
      role: ROLES.includes(t.role) ? t.role : 'other',
      file: t.file || '',
      deviceId: t.deviceId || '',
      label: t.label || '',
      // How far into the recording this track's audio actually begins. Two microphones do not
      // start at the same instant, and a corpus that assumed they did would be misaligned by
      // however long the second `getUserMedia` took — silently, and differently every time.
      offsetMs: Number(t.offsetMs) || 0,
    })),
    // WHAT WAS ASKED FOR, AND WHEN. The labels come from whatever ran the session, never from
    // listening to the audio — see the header on why there is no voice activity detection here.
    // Extra fields a session attached are carried through — see `mark` for the one thing they
    // may never contain.
    marks: marks.map((m) => {
      const o = { atMs: Number(m.atMs) || 0, label: String(m.label || '') };
      for (const [k, v] of Object.entries(m || {})) {
        if (k === 'atMs' || k === 'label') continue;
        if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
      }
      return o;
    }),
    // WHEN THIS SHOULD BE GONE, as an absolute time rather than a duration — because a duration
    // is meaningless to anything reading the folder later without also knowing the write time,
    // and because an absolute date is something a person can read and act on themselves.
    // `keepDays: 0` means keep, and `keepUntil: null` says so explicitly rather than by omission.
    keepDays: Math.max(0, Number(keepDays) || 0),
    keepUntil: (Number(keepDays) > 0 && startedAt)
      ? startedAt + Math.max(0, Number(keepDays)) * 86400000
      : null,
    note: String(note || ''),
  };
}

// Should this recording be gone by now? Pure and exported so the rule lives in one place and a
// sweeper, a diagnostic and a settings preview cannot disagree about it.
//
// A manifest with NO expiry is kept. That is the safe direction: deleting somebody's recording
// because a field was missing is not recoverable, and keeping one that should have gone is.
export function isExpired(manifest, now = Date.now()) {
  const until = manifest && manifest.keepUntil;
  return typeof until === 'number' && until > 0 && now >= until;
}

/**
 * The recorder.
 *
 * `sources` is [{ role, deviceId, label }]. Everything else is injected: `capture` turns a
 * device id into something that hands over Float32 blocks, and `now` is the clock. So the whole
 * of the sequencing, alignment and manifest is exercised with no microphone and no audio.
 */
export function createPairedRecorder({
  capture,                       // async (deviceId) => { sampleRate, onData(cb), stop() }
  now = () => Date.now(),
  producer = 'human',
  keepDays = DEFAULT_KEEP_DAYS,
} = {}) {
  if (typeof capture !== 'function') throw new Error('createPairedRecorder: capture is required');

  let running = false;
  let startedAt = 0;
  let marks = [];
  let chans = [];                // { role, deviceId, label, blocks, sampleRate, offsetMs, cap }

  async function start(sources = []) {
    if (running) throw new Error('recorder: already running');
    if (!sources.length) throw new Error('recorder: nothing to record from');
    marks = [];
    chans = [];
    startedAt = now();
    running = true;

    // OPENED IN PARALLEL, and the offset of each is RECORDED rather than assumed to be zero.
    // Two microphones never start at the same instant; pretending they do would misalign the
    // corpus by however long the slower open took, silently, and by a different amount each
    // session.
    await Promise.all(sources.map(async (src) => {
      const cap = await capture(src.deviceId);
      const ch = {
        role: src.role || 'other',
        deviceId: src.deviceId || '',
        label: src.label || '',
        blocks: [],
        sampleRate: cap.sampleRate || 48000,
        offsetMs: Math.max(0, now() - startedAt),
        cap,
      };
      cap.onData((block) => { if (running) ch.blocks.push(block); });
      chans.push(ch);
    }));
    return chans.length;
  }

  // WHAT WAS ASKED FOR, AT THIS MOMENT. Called by whatever is running the session — a game that
  // has just asked a question knows the answer it is expecting, which is a far better label than
  // anything that could be inferred from the audio.
  //
  // *** AND WHAT A MARK MAY AND MAY NOT CLAIM. ***
  // `extra` carries whatever the session knows — for a trivia game, the question, which option
  // was chosen, whether it was right. It must NOT carry an assertion about what the person
  // SAID. A game knows what it asked and what button was pressed; it does not know whether
  // anybody spoke, or what words came out if they did. Writing "said: paris" into a corpus
  // because somebody pressed the Paris button would be a fabricated label, and a fabricated
  // label in training data is worse than no label — it is confidently wrong, forever, in a file
  // nobody will re-check.
  function mark(label, extra = null) {
    if (!running) return null;
    const m = { atMs: now() - startedAt, label: String(label || '') };
    if (extra && typeof extra === 'object') {
      for (const [k, v] of Object.entries(extra)) {
        if (k === 'atMs' || k === 'label') continue;
        // Primitives only. A mark is a fact in a file that outlives this program, so it holds
        // things that survive JSON without surprises.
        if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) m[k] = v;
      }
    }
    marks.push(m);
    return { ...m };
  }

  function stop({ note = '' } = {}) {
    if (!running) return null;
    running = false;
    const durationMs = now() - startedAt;
    const out = chans.map((ch, i) => {
      try { ch.cap.stop(); } catch { /* already stopped */ }
      const total = ch.blocks.reduce((n, b) => n + b.length, 0);
      const flat = new Float32Array(total);
      let at = 0;
      for (const b of ch.blocks) { flat.set(b, at); at += b.length; }
      return {
        role: ch.role,
        deviceId: ch.deviceId,
        label: ch.label,
        offsetMs: ch.offsetMs,
        sampleRate: ch.sampleRate,
        // Named by ROLE, not by index. `label.wav` and `input.wav` survive being moved,
        // re-sorted and looked at a year later; `track-0.wav` does not.
        file: `${ch.role}${chans.filter((c) => c.role === ch.role).length > 1 ? `-${i}` : ''}.wav`,
        samples: flat,
        wav: encodeWav(flat, ch.sampleRate),
      };
    });
    const manifest = buildManifest({
      producer,
      startedAt,
      durationMs,
      sampleRate: out[0]?.sampleRate || 48000,
      tracks: out,
      marks,
      note,
      keepDays,
    });
    chans = [];
    return { manifest, tracks: out };
  }

  return {
    start, mark, stop,
    isRunning: () => running,
    marks: () => marks.map((m) => ({ ...m })),
    channels: () => chans.map((c) => ({ role: c.role, deviceId: c.deviceId, offsetMs: c.offsetMs })),
  };
}

/**
 * The default capture: Web Audio, because `MediaRecorder` cannot give uncompressed PCM.
 *
 * One `AudioContext` is shared across devices deliberately — it is a common clock, so two
 * streams are comparable rather than each having its own idea of time.
 *
 * `ScriptProcessorNode` is deprecated in favour of `AudioWorklet`, and this uses it anyway, for
 * one reason worth writing down: an AudioWorklet needs a separate module file fetched by URL,
 * and this repo has no build step, so that file has to be served and found at runtime. That is
 * a real dependency for a first cut of a feature nobody has used yet. **If this survives contact
 * with a real recording it should move to an AudioWorklet**, because a deprecated node running
 * on the main thread will drop blocks under load — on a Pi, exactly when a game is also drawing.
 */
export function webAudioCapture({ micOwner, context = null, bufferSize = 4096 } = {}) {
  let ctx = context;
  return async function capture(deviceId) {
    if (!micOwner) throw new Error('webAudioCapture: a mic owner is required');
    const stream = await micOwner.acquire(`recorder:${deviceId || 'chosen'}`, null, deviceId);
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(bufferSize, 1, 1);
    let onBlock = null;
    node.onaudioprocess = (e) => {
      if (!onBlock) return;
      // COPIED, not referenced. The buffer is reused by the audio thread on the next block, so
      // keeping the reference would hand back a corpus of the same few milliseconds repeated.
      onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(node);
    // Connected to the destination with no gain, because some browsers will not run a
    // ScriptProcessor that is not connected to anything — and nothing should be audible.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
    return {
      sampleRate: ctx.sampleRate,
      onData(cb) { onBlock = cb; },
      stop() {
        onBlock = null;
        try { node.onaudioprocess = null; src.disconnect(); node.disconnect(); mute.disconnect(); }
        catch { /* already torn down */ }
        try { micOwner.release(`recorder:${deviceId || 'chosen'}`); } catch { /* already gone */ }
      },
    };
  };
}
