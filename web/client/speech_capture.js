// speech_capture.js — THE MICROPHONE, AS 16 kHz 16-BIT FRAMES, FOR A RECOGNISER (rows 2.46, 2.47).
//
// This one file is two things, on purpose, so the maths that runs in the audio thread is the maths
// the suite tests:
//
//   * On the page: `createDownsampler` is an ordinary export (speech_engines_test checks it).
//   * As an AudioWorklet module (`audioWorklet.addModule(<this file>)`): it registers the
//     'speech-capture' processor, which downsamples whatever rate the sound card runs at to 16 kHz
//     and posts one Int16Array per FRAME to the page.
//
// Every recogniser behind speech_engines.js (Vosk on a Pi, faster-whisper on a desktop) wants the
// same thing: 16 kHz mono 16-bit PCM. Converting ONCE here, and sending that to every engine in the
// ranked list, is what "capture the mic once, fan it out" means.

export const CAPTURE_RATE = 16000;
// 20 ms frames (320 samples). Speech detectors conventionally look at 10-30 ms frames [training
// knowledge]; 20 ms is 50 small messages a second to each engine, and fine enough that the end of
// an utterance is found within one frame. A worklet option (`frameMs`) if anything wants other.
export const FRAME_MS = 20;

/**
 * A streaming downsampler: Float32 blocks at `inRate` in, Int16 at `outRate` out, with the
 * fractional position carried from block to block so nothing clicks at block edges. Each output
 * sample is the MEAN of the input samples it covers - a box filter, the crudest low-pass there is,
 * which keeps most of what is above 8 kHz from folding back into the speech band. Speech
 * recognisers are trained on far worse telephone audio [training knowledge]; a proper polyphase
 * filter is a later refinement if a measurement ever says it matters.
 */
export function createDownsampler(inRate, outRate = CAPTURE_RATE) {
  const inR = Math.round(Number(inRate));
  const outR = Math.round(Number(outRate));
  if (!(inR >= outR && outR > 0)) throw new Error(`createDownsampler: cannot upsample ${inRate} -> ${outRate}`);
  // WHOLE-NUMBER BOOKKEEPING: output sample n covers input samples [floor(n*in/out), floor((n+1)*in/out))
  // counted from the very first sample, so where a block happens to end can never move a window by one
  // sample (a float position carried from block to block did, measurably).
  const edge = (n) => Math.floor((n * inR) / outR);
  let carry = new Float32Array(0);
  let base = 0;    // the absolute index of carry[0]
  let made = 0;    // output samples made so far
  return function downsample(input) {
    const src = input instanceof Float32Array ? input : Float32Array.from(input || []);
    const buf = new Float32Array(carry.length + src.length);
    buf.set(carry, 0);
    buf.set(src, carry.length);
    const out = new Int16Array(Math.floor((buf.length * outR) / inR) + 2);
    let k = 0;
    for (;;) {
      const a = edge(made) - base;
      const b = edge(made + 1) - base;
      if (b > buf.length) break;
      let s = 0;
      for (let i = a; i < b; i += 1) s += buf[i];
      const v = Math.max(-1, Math.min(1, s / (b - a)));
      out[k] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
      k += 1;
      made += 1;
    }
    const keep = edge(made) - base;
    carry = buf.slice(keep);
    base += keep;
    return out.slice(0, k);
  };
}

// ---- the AudioWorklet half. Guarded, so importing this file on a page (the suites, imports_test)
// is harmless: there is no AudioWorkletProcessor or registerProcessor outside the audio thread.
const Base = typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {};

class SpeechCaptureProcessor extends Base {
  constructor(options) {
    super(options);
    const o = (options && options.processorOptions) || {};
    // `sampleRate` is a global inside the audio thread.
    const inRate = typeof sampleRate !== 'undefined' ? sampleRate : 48000;   // eslint-disable-line no-undef
    this.down = createDownsampler(inRate, CAPTURE_RATE);
    this.frame = Math.round(CAPTURE_RATE * (Number(o.frameMs) || FRAME_MS) / 1000);
    this.buf = new Int16Array(this.frame);
    this.fill = 0;
    this.on = true;
    if (this.port) this.port.onmessage = (e) => { if (e.data && e.data.type === 'stop') this.on = false; };
  }

  process(inputs) {
    if (!this.on) return false;
    const ch = inputs && inputs[0] && inputs[0][0];
    if (!ch) return true;
    const pcm = this.down(ch);
    for (let i = 0; i < pcm.length; i += 1) {
      this.buf[this.fill] = pcm[i];
      this.fill += 1;
      if (this.fill === this.frame) {
        const f = this.buf;
        this.port.postMessage(f, [f.buffer]);
        this.buf = new Int16Array(this.frame);
        this.fill = 0;
      }
    }
    return true;
  }
}

if (typeof registerProcessor === 'function') {
  try { registerProcessor('speech-capture', SpeechCaptureProcessor); } catch { /* already registered */ }
}
