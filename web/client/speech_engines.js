// speech_engines.js — RANKED RECOGNISERS AND TWO EARS (rows 2.46, 2.47).
//
// Mike, 2026-09-30: *"If a phone is in the mix, would that be a better brain than the pi? Or maybe
// even a second brain. It has a mic and the pi will have a speakerphone. They could each say what
// they think was said with their confidence score and reach consensus or show both."* And: *"Her
// audio going here is fine"* (his desktop) - as an OPTION; Oscar's computer "when he's not using the
// GPU" is another. Both OFF by default. Recognisers work as a RANKED LIST: a fast guess first, then
// the desktop, then the GPU box when it is free; later passes correct earlier ones in place.
//
// This file implements the `makeRecognizer` seam `attachSpeech` (input_speech.js) already takes:
// `start(onText)`, `stop()`, `running`, `setMode(m)`. Nothing in the phrase table, the wake gate or
// the near-miss question moves. What is new is underneath:
//
//   microphone(s) ──▶ 16 kHz frames (speech_capture.js, an AudioWorklet)
//        │                  one capture per EAR: the room's microphone, and a phone joined as a
//        │                  microphone (phone_mic.js) - each cut into utterances HERE, once
//        ▼
//   segmenter ──▶ { begin, audio, end } per utterance, under one id
//        │
//        ├──▶ pass 1 ("this screen": a service on 127.0.0.1)   ─┐  the SAME utterance id goes to
//        ├──▶ pass 2 (another computer, if the person chose it) ├─ every engine, so their answers
//        └──▶ pass 3 (a second one, if chosen)                 ─┘  are answers to ONE question
//                                    │
//                                    ▼
//   ranker ──▶ onText(text, detail)  ONCE per utterance: the command path
//          └─▶ caption events        EVERY answer: the fast guess, then each revision (subtitles)
//
// *** WHY THE SCREEN, NOT THE SERVICE, DECIDES WHERE AN UTTERANCE STARTS AND ENDS. *** If each
// service found its own utterances, a fast guess from the Pi and a better one from the desktop would
// be two unrelated transcripts to be lined up by clock time, and two ears would be four. One cut,
// made once, gives every engine the same question.
//
// ---------------------------------------------------------------------------------------
// *** THE COMMAND RULE: THE FIRST SURE ANSWER ACTS; A LATER ONE ONLY CORRECTS THE WORDS. ***
// ---------------------------------------------------------------------------------------
//
// Per utterance, the command path (`onText`) is told exactly once:
//   * the first answer whose confidence is at or above `sureAt` (a person's setting), from any pass
//     and any ear, AND that means something to the command path (`actsOn`: a wake phrase or a
//     command) - the fast guess, when it is sure, costs nothing to wait for. A "sure" guess that means
//     nothing waits: Vosk on the bench wrote "computer please pass" for "pause" at 1.0 (2026-09-30);
//     or
//   * when nobody left can answer (every engine asked has answered or gone), the best answer: the
//     LATEST pass that answered, then the surer ear; or
//   * `waitMs` after the first answer, the best so far - an unsure guess waits for a better one, but
//     not forever (a desktop that has gone to sleep must not hold a command hostage).
//
// A REVISION THAT AGREES never reaches the command path again (no double fire).
// *** A REVISION THAT DISAGREES AFTER A COMMAND ACTED DOES NOTHING. THE COMMAND STANDS. *** Argued:
//   * FOR acting on it (undo the first, do the second): the later pass is usually right.
//   * AGAINST, and it wins: (1) most commands cannot be undone - a skipped video, a hung-up call, a
//     game answer already scored; (2) doing two things for one sentence is the one behaviour nobody in
//     the room could predict or explain; (3) the first answer only acted because it was sure BY THE
//     PERSON'S OWN THRESHOLD, and raising that threshold is the fix when it is wrong too often; (4)
//     the corrected words are on screen (subtitles), and anybody can say it again.
//   The revision still goes to the captions, and to `onRevision` (a host may log it: a disagreement
//   after a command is exactly the evidence for raising `sureAt`).
//
// ---------------------------------------------------------------------------------------
// *** TWO EARS: AGREE, OR SHOW BOTH. *** (kept minimal, argued)
// ---------------------------------------------------------------------------------------
//
// Two microphones hear one sentence at the same moment, so utterances from two ears that overlap in
// time (or start within `pairMs` of each other ending) are ONE group. Per group:
//   * COMMANDS: the rule above, across both ears - the first sure answer from either acts, once.
//   * CAPTIONS: when every ear's best words are the same (normalised), ONE line, marked as agreed;
//     when they differ, the surer ear's words with the other ear's underneath ("show both").
// NOT built: word-by-word voting between ears (ROVER) [training knowledge]. It needs word timings
// from both ears aligned, and it can invent a sentence neither ear heard; "show both" cannot. It is
// the next step if the two-line captions turn out to be noisy.

import { CAPTURE_RATE, FRAME_MS } from './speech_capture.js';

// Port 8797, not the more obvious 8765: 8765 is already the Cici session receiver on Mike's desktop
// (cici_receiver.py, bound 0.0.0.0), 8770-8773 the media agents, 8791 corpus_desk (all checked
// 2026-09-30). A setting (`speechLocalUrl`) and a flag on the service (`--port`).
export const LOCAL_URL = 'ws://127.0.0.1:8797/speech';
export const PASS_SLOTS = ['local', 'remote1', 'remote2'];
export const PASS_CHOICES = ['none', ...PASS_SLOTS];
export const EAR_CHOICES = ['room', 'both', 'phone'];

// Every number here is a DEFAULT and a person's setting (SPEECH_PASS_FIELDS), each argued.
export const ENGINE_DEFAULTS = Object.freeze({
  // A pass at or above this acts without waiting for a later one. 0.7, from the desktop run
  // (2026-09-30: faster-whisper small.en through web/speech_service, 42 SAPI clips, three voices):
  // right commands came back at 0.64-0.93 (most 0.75-0.93); every WRONG transcript of a command was
  // below 0.7 ("turn it up" -> "turn it off" 0.63, "play" -> "put it" 0.65, a hallucinated "please
  // like, comment and subscribe" 0.51). So 0.7 lets most right guesses act at once and makes the
  // plausible wrong ones wait for a better pass (or, with no better pass, go through the phrase
  // table, which refuses "turn it off" anyway). One synthetic measurement, hence a setting.
  sureAt: 0.7,
  // How long an unsure guess waits for a better pass. 4 s: faster-whisper on the desktop answered in
  // 2.0-2.4 s median, 3.9 s worst with the recommended settings (whisper_desktop_measure_20260930).
  waitMs: 4000,
  // A pause this long ends what was said. 900 ms: long enough for a breath between words, short
  // enough that "pause" acts before the person wonders whether it heard. Somebody who stops to think
  // mid-command (Mike, note AN) gets the two-step window after the wake phrase, and a longer value
  // here.
  endSilenceMs: 900,
  // The room's microphone and, when one is joined, a phone (row 2.44). Both, because a phone put
  // near somebody is there to hear them; a person can choose one.
  ears: 'both',
});

// The segmenter's numbers: options with defaults, not settings - nobody in a room can judge them,
// and each is argued. They move only with a measurement.
export const SEGMENT_DEFAULTS = Object.freeze({
  frameMs: FRAME_MS,
  // Speech is this many dB over the room's own noise floor. 10 dB: comfortably above the flutter of
  // a quiet room, well below a voice at conversational distance (typically 20-30 dB over a quiet
  // room [training knowledge]). The floor ADAPTS (a TV on raises it), so this is relative.
  startDb: 10,
  // Once talking, it stays talking until the level drops below floor + startDb * this. Hysteresis,
  // so a soft word in the middle does not end the utterance.
  holdRatio: 0.6,
  // Below this absolute level nothing is speech however quiet the room: a dead-silent room would
  // otherwise make its own hiss "speech".
  minLevelDb: -55,
  // Two frames over the threshold to start: one frame is a click.
  onsetFrames: 2,
  // Shorter than this, it was a knock or a cough: cancelled, never transcribed.
  minSpeechMs: 200,
  // What is kept from before the start, so the first consonant is not cut off.
  preRollMs: 300,
  // Nobody's command is this long. Past it the utterance is ended and a new one starts, so a TV
  // talking for an hour is never one utterance.
  maxUtteranceMs: 20000,
});

/** Normalise words the way the phrase table does, so "Pause." and "pause" agree. */
export function sameWords(a, b) {
  const n = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n(a) === n(b);
}

// ---------------------------------------------------------------------------------------
// THE SETTINGS (person level, beside SPEECH_ON_FIELDS)
// ---------------------------------------------------------------------------------------
const passOptions = [
  { value: 'none', label: 'Nothing more' },
  { value: 'local', label: 'The recogniser on this screen (the room’s sound stays here)' },
  { value: 'remote1', label: 'Another computer (sends the room’s sound there)' },
  { value: 'remote2', label: 'A second other computer (sends the room’s sound there)' },
];
export const SPEECH_PASS_FIELDS = [
  { key: 'speechPass2', label: 'Then check what it heard with', kind: 'choice', default: 'none',
    level: 'standard', options: passOptions,
    note: 'A slower, better recogniser corrects the first guess. Off: only the first.' },
  { key: 'speechPass3', label: 'And then with', kind: 'choice', default: 'none', level: 'advanced',
    options: passOptions },
  { key: 'speechRemote1Name', label: 'Another computer: its name', kind: 'text', default: 'Another computer',
    level: 'advanced' },
  { key: 'speechRemote1Url', label: 'Another computer: its address', kind: 'text', default: '',
    level: 'advanced', note: 'For example ws://100.64.0.2:8797/speech. The room’s sound is sent there.' },
  { key: 'speechRemote1Key', label: 'Another computer: its pass phrase', kind: 'text', default: '',
    level: 'advanced' },
  { key: 'speechRemote2Name', label: 'Second other computer: its name', kind: 'text',
    default: 'A second other computer', level: 'advanced' },
  { key: 'speechRemote2Url', label: 'Second other computer: its address', kind: 'text', default: '',
    level: 'advanced', note: 'The room’s sound is sent there.' },
  { key: 'speechRemote2Key', label: 'Second other computer: its pass phrase', kind: 'text', default: '',
    level: 'advanced' },
  { key: 'speechLocalUrl', label: 'The recogniser on this screen: its address', kind: 'text',
    default: LOCAL_URL, level: 'advanced' },
  // A WAKE-WORD DETECTOR (openWakeWord through web/speech_service --wake): it hears the wake phrase
  // itself, within a fraction of a second, so "Listening" and the duck happen while the person is
  // still talking; the command is still read by the recognisers above. EMPTY = off: no trained model
  // for "computer please" exists yet (openwakeword_measure_20261001.md), so there is nothing to
  // point it at by default.
  { key: 'speechWakeUrl', label: 'Wake-phrase detector on this screen: its address', kind: 'text',
    default: '', level: 'advanced',
    note: 'For example ws://127.0.0.1:8798/speech. Empty: the recogniser hears the wake phrase itself (slower).' },
  { key: 'speechSureAt', label: 'How sure the first guess must be to act at once', kind: 'choice',
    default: ENGINE_DEFAULTS.sureAt, level: 'advanced',
    options: [
      { value: 0.5, label: 'Fairly sure (faster, more mistakes)' },
      { value: 0.7, label: 'Sure' },
      { value: 0.85, label: 'Very sure (waits for the next check more often)' },
      { value: 1.01, label: 'Always wait for the last check' },
    ] },
  { key: 'speechWaitMs', label: 'How long an unsure guess waits for a better one', kind: 'number',
    default: ENGINE_DEFAULTS.waitMs, level: 'advanced', min: 1000, max: 15000, step: 1000,
    displayScale: 1000, unit: 'seconds', unitOne: 'second' },
  { key: 'speechEndMs', label: 'A pause this long ends what was said', kind: 'choice',
    default: ENGINE_DEFAULTS.endSilenceMs, level: 'standard',
    options: [
      { value: 600, label: 'Short (0.6 seconds)' },
      { value: 900, label: 'Usual (0.9 seconds)' },
      { value: 1500, label: 'Long (1.5 seconds)' },
      { value: 2500, label: 'Very long (2.5 seconds)' },
    ] },
  { key: 'speechEars', label: 'Which microphones it listens to', kind: 'choice',
    default: ENGINE_DEFAULTS.ears, level: 'standard',
    options: [
      { value: 'room', label: 'This screen’s microphone' },
      { value: 'both', label: 'This screen’s, and a phone when one is joined' },
      { value: 'phone', label: 'Only a phone joined as a microphone' },
    ] },
];

/**
 * The ranked plan from a settings row. `speechEngine` (input_speech.js) is the FIRST pass; the two
 * pass fields add later ones. A pass naming another computer with no address is left out and listed
 * in `skipped` (the menu says why), duplicates are dropped, and 'browser' as the first pass returns
 * `{ browser: true }` - the browser's own recogniser takes no audio from here, so it cannot be in a
 * ranked list (it listens to the default microphone and hands back text with no utterance to match).
 */
export function enginePlanFrom(values = {}) {
  const v = values || {};
  const num = (x, lo, hi, d) => {
    const n = Number(x);
    return x !== null && x !== '' && typeof x !== 'boolean' && Number.isFinite(n) && n >= lo && n <= hi ? n : d;
  };
  const common = {
    sureAt: num(v.speechSureAt, 0, 1.01, ENGINE_DEFAULTS.sureAt),
    waitMs: num(v.speechWaitMs, 0, 60000, ENGINE_DEFAULTS.waitMs),
    endSilenceMs: num(v.speechEndMs, 200, 10000, ENGINE_DEFAULTS.endSilenceMs),
    ears: EAR_CHOICES.includes(v.speechEars) ? v.speechEars : ENGINE_DEFAULTS.ears,
  };
  const first = typeof v.speechEngine === 'string' ? v.speechEngine : 'local';
  if (first === 'browser') return { browser: true, passes: [], skipped: [], ...common };
  const text = (x, d = '') => (typeof x === 'string' ? x.trim() : d);
  const slotInfo = (slot) => {
    if (slot === 'local') {
      return { slot, name: 'This screen', url: text(v.speechLocalUrl) || LOCAL_URL, key: '', remote: false };
    }
    const n = slot === 'remote1' ? '1' : '2';
    const dflt = SPEECH_PASS_FIELDS.find((f) => f.key === `speechRemote${n}Name`).default;
    return { slot, name: text(v[`speechRemote${n}Name`]) || dflt, url: text(v[`speechRemote${n}Url`]),
             key: text(v[`speechRemote${n}Key`]), remote: true };
  };
  const want = [PASS_SLOTS.includes(first) ? first : 'local', v.speechPass2, v.speechPass3]
    .filter((s) => PASS_SLOTS.includes(s));
  const passes = [];
  const skipped = [];
  for (const s of want) {
    if (passes.some((p) => p.slot === s)) continue;
    const info = slotInfo(s);
    if (!/^wss?:\/\//i.test(info.url)) { skipped.push({ ...info, why: 'no address' }); continue; }
    passes.push(info);
  }
  const wakeUrl = text(v.speechWakeUrl);
  const wake = /^wss?:\/\//i.test(wakeUrl) ? { url: wakeUrl } : null;
  return { browser: false, passes, skipped, wake, ...common };
}

// ---------------------------------------------------------------------------------------
// THE SEGMENTER: frames in, utterances out. Pure (no clock of its own: every frame carries its time).
// ---------------------------------------------------------------------------------------
export function levelDb(frame) {
  let s = 0;
  const n = frame?.length || 0;
  for (let i = 0; i < n; i += 1) s += frame[i] * frame[i];
  const rms = n ? Math.sqrt(s / n) / 32768 : 0;
  return 20 * Math.log10(Math.max(rms, 1e-9));
}

export function createSegmenter(options = {}) {
  const o = { ...SEGMENT_DEFAULTS, endSilenceMs: ENGINE_DEFAULTS.endSilenceMs, idPrefix: 'u', ...options };
  const preFrames = Math.max(0, Math.round(o.preRollMs / o.frameMs));
  let floor = null;
  let pre = [];
  let over = 0;
  let cur = null;       // { id, startT, lastVoice, voicedMs }
  let seq = 0;

  function push(frame, t) {
    const ev = [];
    const db = levelDb(frame);
    if (floor === null) floor = db;
    const startAt = Math.max(floor + o.startDb, o.minLevelDb);
    if (!cur) {
      // The floor follows the room while nobody talks: down fast (a noise stopped), up slowly (a TV
      // came on - slowly, so a person's first word does not become the floor).
      floor += (db - floor) * (db < floor ? 0.3 : 0.02);
      if (db > startAt) over += 1; else over = 0;
      pre.push(frame);
      if (pre.length > preFrames + o.onsetFrames) pre.shift();
      if (over >= o.onsetFrames) {
        seq += 1;
        cur = { id: `${o.idPrefix}${seq}`, startT: t - (pre.length - 1) * o.frameMs, lastVoice: t, voicedMs: over * o.frameMs };
        ev.push({ type: 'begin', id: cur.id, t: cur.startT });
        for (const f of pre) ev.push({ type: 'audio', id: cur.id, pcm: f });
        pre = [];
        over = 0;
      }
      return ev;
    }
    ev.push({ type: 'audio', id: cur.id, pcm: frame });
    // While "talking" the floor still creeps up, very slowly (a time constant of ~5 s at 20 ms frames):
    // a fan or a hum that switched on is not a person, and without this it would be one endless
    // utterance. A real voice rises and falls far faster than this follows. (THIS IS AN ENERGY GATE,
    // NOT A SPEECH DETECTOR: a TV talking is "talking" here. The service's own VAD - Whisper's Silero
    // filter - is what drops non-speech, and the wake phrase is what keeps a TV from commanding.)
    if (db > floor) floor += (db - floor) * 0.004;
    const holdAt = Math.max(floor + o.startDb * o.holdRatio, o.minLevelDb);
    if (db > holdAt) { cur.lastVoice = t; cur.voicedMs += o.frameMs; }
    const ended = t - cur.lastVoice >= o.endSilenceMs;
    const tooLong = t - cur.startT >= o.maxUtteranceMs;
    if (ended || tooLong) {
      if (cur.voicedMs >= o.minSpeechMs) ev.push({ type: 'end', id: cur.id, t, ms: t - cur.startT, cut: !ended });
      else ev.push({ type: 'cancel', id: cur.id, t });
      cur = null;
      over = 0;
    }
    return ev;
  }
  return {
    push,
    /** End whatever is open (the microphone went away). */
    flush(t) {
      if (!cur) return [];
      const c = cur; cur = null;
      return [c.voicedMs >= o.minSpeechMs ? { type: 'end', id: c.id, t, ms: t - c.startT, cut: true } : { type: 'cancel', id: c.id, t }];
    },
    get speaking() { return !!cur; },
    get floorDb() { return floor; },
  };
}

// ---------------------------------------------------------------------------------------
// ONE ENGINE: a WebSocket to a speech service (web/speech_service), reconnecting on its own.
// ---------------------------------------------------------------------------------------
// Back-off between reconnects. The first retry is quick (a service restarting); after that it
// slows to one try every 30 s, so a desktop that is switched off costs almost nothing.
export const RETRY_MS = Object.freeze([1000, 3000, 10000, 30000]);
// Audio queued on a slow link past this is dropped rather than held (~16 s of audio): a link that
// far behind cannot answer in time to matter, and memory must not grow with it.
export const MAX_BUFFERED_BYTES = 512 * 1024;

export function connectEngine({
  slot, name = slot, url, key = '',
  WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
  retryMs = RETRY_MS,
  maxBuffered = MAX_BUFFERED_BYTES,
  onResult = null, onState = null,
  // A WAKE connection: after hello it asks for the service's wake stream, `stream(pcm)` sends every
  // frame (no utterances), and `onWake` hears { word, score, atMs, ... }. A service with no detector
  // leaves it 'refused' (why: 'no wake detector') - said in the status, nothing streamed.
  wake = false, onWake = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let ws = null;
  let state = 'connecting';
  let info = null;
  let tries = 0;
  let retry = null;
  let closed = false;
  let mode = null;
  let current = null;   // the utterance id begun on THIS socket, so audio for one begun elsewhere is not sent

  const set = (s, why = null) => {
    if (s === state && !why) return;
    state = s;
    try { onState?.(s, why); } catch (err) { console.error('speech engine: onState', err); }
  };
  const sendJson = (m) => { try { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } } catch { /* a socket closing */ } return false; };

  function schedule() {
    if (closed || retry !== null) return;
    const list = Array.isArray(retryMs) && retryMs.length ? retryMs : RETRY_MS;
    const ms = list[Math.min(tries, list.length - 1)];
    tries += 1;
    try { retry = setTimer(() => { retry = null; open(); }, ms); } catch { retry = null; }
  }

  function open() {
    if (closed) return;
    if (!WebSocketImpl) { set('down', 'no WebSocket'); return; }
    let sock;
    try { sock = new WebSocketImpl(url); } catch (err) { set('down', String(err?.message || err)); schedule(); return; }
    ws = sock;
    current = null;
    try { sock.binaryType = 'arraybuffer'; } catch { /* a fake */ }
    set('connecting');
    sock.onopen = () => {
      if (ws !== sock) return;
      sendJson({ type: 'hello', rate: CAPTURE_RATE, ...(key ? { secret: key } : {}) });
    };
    sock.onmessage = (e) => {
      if (ws !== sock || typeof e.data !== 'string') return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.kind === 'hello') {
        info = { engine: m.engine || null, grammar: !!m.grammar, partials: !!m.partials,
                 wake: Array.isArray(m.wake) ? m.wake.slice() : [] };
        tries = 0;
        if (wake) {
          if (!info.wake.length) { set('refused', 'no wake detector'); return; }
          sendJson({ type: 'wake', on: true });
        } else if (mode) sendJson({ type: 'mode', mode: mode.mode, grammar: mode.grammar || null });
        set('ready');
        return;
      }
      if (m.kind === 'error' && m.error === 'secret') { set('refused', 'secret'); return; }
      if (m.kind === 'wake') {
        if (wake) { try { onWake?.({ ...m, slot, name }); } catch (err) { console.error('speech engine: onWake', err); } }
        return;
      }
      if (m.kind === 'partial' || m.kind === 'final') {
        try { onResult?.({ ...m, slot, name }); } catch (err) { console.error('speech engine: onResult', err); }
      }
    };
    sock.onerror = () => { /* onclose follows, and says it */ };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      current = null;
      if (closed) return;
      if (state !== 'refused') set('down');
      schedule();
    };
  }

  open();
  return {
    slot, name, url,
    state: () => state,
    info: () => (info ? { ...info } : null),
    ready: () => state === 'ready',
    begin(id) { if (state !== 'ready') return false; current = id; return sendJson({ type: 'begin', utteranceId: id }); },
    audio(id, pcm) {
      if (state !== 'ready' || current !== id || !ws) return false;
      try {
        if (typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > maxBuffered) return false;
        ws.send(pcm.buffer.byteLength === pcm.byteLength ? pcm.buffer : pcm.slice().buffer);
        return true;
      } catch { return false; }
    },
    /** A wake connection: every frame, utterance or not. */
    stream(pcm) {
      if (!wake || state !== 'ready' || !ws) return false;
      try {
        if (typeof ws.bufferedAmount === 'number' && ws.bufferedAmount > maxBuffered) return false;
        ws.send(pcm.buffer.byteLength === pcm.byteLength ? pcm.buffer : pcm.slice().buffer);
        return true;
      } catch { return false; }
    },
    end(id) { if (current !== id) return false; current = null; return sendJson({ type: 'end', utteranceId: id }); },
    cancel(id) { if (current !== id) return false; current = null; return sendJson({ type: 'cancel', utteranceId: id }); },
    setMode(m) {
      mode = m && typeof m === 'object' ? { mode: m.mode, grammar: Array.isArray(m.grammar) ? m.grammar : null } : null;
      if (state === 'ready' && mode) sendJson({ type: 'mode', mode: mode.mode, grammar: mode.grammar });
    },
    close() {
      closed = true;
      if (retry !== null) { try { clearTimer(retry); } catch { /* gone */ } retry = null; }
      const s = ws; ws = null;
      try { s?.close(); } catch { /* closed */ }
      set('closed');
    },
  };
}

// ---------------------------------------------------------------------------------------
// THE RANKER: answers in, one command and many captions out. Pure apart from its injected timers.
// ---------------------------------------------------------------------------------------
// Two ears' utterances are one group when one begins while the other is speaking or within this of
// it ending. 500 ms: a phone's audio arrives over WebRTC a few hundred ms late [training knowledge,
// unmeasured here], and two people rarely answer each other inside half a second.
export const PAIR_MS = 500;
// One wake from two ears inside this is one wake (see wakeHeard).
export const WAKE_DEDUPE_MS = 1500;
// A group whose engines never all answered is closed this long after its last ear ended, so a
// caption is not left "still checking" by a computer that went away mid-sentence.
export const GIVE_UP_MS = 15000;
// Groups kept for captions and late answers; older ones are forgotten.
const KEEP_GROUPS = 40;

export function createRanker({
  passes = ['local'],            // slot ids, in pass order: later = more trusted
  sureAt = ENGINE_DEFAULTS.sureAt,
  waitMs = ENGINE_DEFAULTS.waitMs,
  pairMs = PAIR_MS,
  giveUpMs = GIVE_UP_MS,
  onCommand = null,              // (text, detail, meta) once per group
  onCaption = null,              // (caption) on every answer
  onRevision = null,             // (meta) a later pass disagreed after the command acted
  // (text) => would the command path do anything with it? A SURE guess that means nothing waits for a
  // better pass (row 2.28's bench: Vosk wrote "computer please pass" for "pause" at confidence 1.0, so
  // confidence alone would let the wrong fast guess act). null = every sure guess acts.
  actsOn = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const rank = (slot) => { const i = passes.indexOf(slot); return i < 0 ? -1 : i; };
  const groups = new Map();      // gid -> group
  const byUtt = new Map();       // `${ear}|${uttId}` -> gid
  let gseq = 0;

  function newGroup(t) {
    gseq += 1;
    const g = { id: `g${gseq}`, ears: new Map(), decided: null, timer: null, giveUp: null, firstAt: null,
                shown: null, done: false, t };
    groups.set(g.id, g);
    while (groups.size > KEEP_GROUPS) {
      const [oldId, old] = groups.entries().next().value;
      clear(old);
      groups.delete(oldId);
      for (const [k, v] of byUtt) if (v === oldId) byUtt.delete(k);
    }
    return g;
  }
  function clear(g) {
    if (g.timer !== null) { try { clearTimer(g.timer); } catch { /* gone */ } g.timer = null; }
    if (g.giveUp !== null) { try { clearTimer(g.giveUp); } catch { /* gone */ } g.giveUp = null; }
  }

  /** An ear started an utterance. `asked` = the slots it was sent to. Returns the group id. */
  function begin(ear, uttId, t = now(), asked = passes) {
    let g = null;
    for (const cand of [...groups.values()].reverse()) {
      if (cand.done || cand.ears.has(ear)) continue;
      const near = [...cand.ears.values()].some((e) => e.endedAt === null || t - e.endedAt <= pairMs);
      if (near) { g = cand; break; }
    }
    if (!g) g = newGroup(t);
    g.ears.set(ear, { ear, uttId, begunAt: t, endedAt: null, asked: new Set(asked), results: new Map() });
    byUtt.set(`${ear}|${uttId}`, g.id);
    return g.id;
  }

  function end(ear, uttId, t = now()) {
    const g = groups.get(byUtt.get(`${ear}|${uttId}`));
    const e = g?.ears.get(ear);
    if (!e) return;
    e.endedAt = t;
    armGiveUp(g);
    settle(g);
  }

  function cancel(ear, uttId) {
    const key = `${ear}|${uttId}`;
    const g = groups.get(byUtt.get(key));
    byUtt.delete(key);
    if (!g) return;
    g.ears.delete(ear);
    if (!g.ears.size) { clear(g); groups.delete(g.id); }
  }

  /** An engine went away (for one ear's connection, or all): it will not answer what it was asked. */
  function lost(slot, ear = null) {
    for (const g of groups.values()) {
      if (g.done) continue;
      let touched = false;
      for (const e of g.ears.values()) {
        if (ear !== null && e.ear !== ear) continue;
        if (e.asked.has(slot) && !e.results.get(slot)?.final) { e.asked.delete(slot); touched = true; }
      }
      if (touched) settle(g);
    }
  }

  function armGiveUp(g) {
    if (g.giveUp !== null || g.done) return;
    try { g.giveUp = setTimer(() => { g.giveUp = null; finish(g, 'gave-up'); }, giveUpMs); } catch { g.giveUp = null; }
  }

  // The best answer an ear has: the latest pass with a final, else the latest partial.
  function earBest(e) {
    let best = null;
    for (const r of e.results.values()) {
      const score = (r.final ? 1000 : 0) + rank(r.slot) * 10;
      if (!best || score > best.score) best = { ...r, score };
    }
    return best;
  }
  const conf = (r) => (r && Number.isFinite(r.confidence) ? r.confidence : null);
  const allAnswered = (g) => [...g.ears.values()].every((e) => e.endedAt !== null
    && [...e.asked].every((s) => e.results.get(s)?.final));

  function caption(g) {
    const bests = [...g.ears.values()].map((e) => ({ ear: e.ear, r: earBest(e) })).filter((x) => x.r);
    if (!bests.length) return;
    // The primary ear: finals over partials, later pass over earlier, then the surer.
    bests.sort((a, b) => (b.r.score - a.r.score) || ((conf(b.r) ?? -1) - (conf(a.r) ?? -1)));
    const p = bests[0];
    const withText = bests.filter((x) => String(x.r.text || '').trim());
    const others = withText.slice(1).filter((x) => !sameWords(x.r.text, p.r.text))
      .map((x) => ({ ear: x.ear, text: x.r.text, confidence: conf(x.r) }));
    const agreed = withText.length > 1 && !others.length;
    const text = String(p.r.text || '');
    const revised = !!g.shown && g.shown.final && !sameWords(g.shown.text, text);
    const c = {
      id: g.id, ear: p.ear, text, words: Array.isArray(p.r.words) ? p.r.words : [],
      confidence: conf(p.r), engine: p.r.engine || null, slot: p.r.slot, pass: rank(p.r.slot),
      passes: passes.length, partial: !p.r.final, final: g.done, revised: revised || !!g.shown?.revised,
      agreed, others, ears: bests.map((x) => x.ear), decided: g.decided ? g.decided.text : null,
    };
    g.shown = { text, final: !!p.r.final, revised: c.revised };
    try { onCaption?.(c); } catch (err) { console.error('speech ranker: onCaption', err); }
  }

  function decide(g, pick, why) {
    if (g.decided || !pick) return;
    if (g.timer !== null) { try { clearTimer(g.timer); } catch { /* gone */ } g.timer = null; }
    const text = String(pick.text || '').trim();
    g.decided = { text, slot: pick.slot, ear: pick.ear, why };
    if (!text) return;   // nothing was said after all (a cough the engines heard as silence)
    const alts = [];
    for (const e of g.ears.values()) {
      for (const r of e.results.values()) {
        if (r.final && r.text && !sameWords(r.text, text) && !alts.some((a) => sameWords(a, r.text))) alts.push(r.text);
      }
    }
    const detail = { ...(conf(pick) !== null ? { confidence: conf(pick) } : {}), ...(alts.length ? { alternatives: alts } : {}) };
    try { onCommand?.(text, detail, { group: g.id, slot: pick.slot, ear: pick.ear, why }); }
    catch (err) { console.error('speech ranker: onCommand', err); }
  }

  function bestFinal(g) {
    let best = null;
    for (const e of g.ears.values()) {
      for (const r of e.results.values()) {
        if (!r.final) continue;
        const k = [rank(r.slot), conf(r) ?? -1];
        if (!best || k[0] > best.k[0] || (k[0] === best.k[0] && k[1] > best.k[1])) best = { r: { ...r, ear: e.ear }, k };
      }
    }
    return best?.r || null;
  }

  function settle(g) {
    if (g.done) return;
    if (!g.decided && allAnswered(g)) decide(g, bestFinal(g), 'all-answered');
    if (allAnswered(g)) finish(g, 'answered');
  }

  function finish(g, why) {
    if (g.done) return;
    if (!g.decided) decide(g, bestFinal(g), why);
    g.done = true;
    clear(g);
    caption(g);
  }

  /** An answer from an engine: { slot, utteranceId, kind: 'partial'|'final', text, confidence, words, engine } for one ear. */
  function result(ear, r) {
    const g = groups.get(byUtt.get(`${ear}|${r.utteranceId}`));
    const e = g?.ears.get(ear);
    if (!e) return;
    const final = r.kind === 'final';
    const prev = e.results.get(r.slot);
    if (prev?.final) return;                       // one final per engine per utterance
    const c = Number(r.confidence);
    e.results.set(r.slot, { slot: r.slot, final, text: String(r.text || ''), engine: r.engine || null,
                            confidence: r.confidence != null && Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : null,
                            words: Array.isArray(r.words) ? r.words : [], at: now() });
    if (!final) { if (!g.done) caption(g); return; }
    if (g.decided) {
      const again = e.results.get(r.slot);
      if (again.text && !sameWords(again.text, g.decided.text)) {
        try { onRevision?.({ group: g.id, acted: g.decided.text, heard: again.text, slot: r.slot, ear }); }
        catch (err) { console.error('speech ranker: onRevision', err); }
      }
    } else {
      const mine = { ...e.results.get(r.slot), ear };
      let means = true;
      if (typeof actsOn === 'function') { try { means = !!actsOn(mine.text); } catch { means = true; } }
      const sure = conf(mine) !== null && conf(mine) >= sureAt && mine.text.trim() && means;
      const lastPass = rank(r.slot) === passes.length - 1 || ![...e.asked].some((s) => rank(s) > rank(r.slot));
      if (sure) decide(g, mine, 'sure');
      else if (lastPass && e.endedAt !== null && g.ears.size === 1) decide(g, mine, 'last-pass');
      else if (g.timer === null) {
        g.firstAt = g.firstAt ?? now();
        try { g.timer = setTimer(() => { g.timer = null; decide(g, bestFinal(g), 'waited'); }, Math.max(0, waitMs)); }
        catch { g.timer = null; }
      }
    }
    caption(g);
    settle(g);
  }

  return {
    begin, end, cancel, result, lost,
    groupOf: (ear, uttId) => byUtt.get(`${ear}|${uttId}`) || null,
    groups: () => [...groups.values()].map((g) => ({ id: g.id, done: g.done, decided: g.decided ? { ...g.decided } : null,
                                                     ears: [...g.ears.keys()] })),
    destroy() { for (const g of groups.values()) clear(g); groups.clear(); byUtt.clear(); },
  };
}

// ---------------------------------------------------------------------------------------
// THE RECOGNISER: microphones + segmenters + engines + ranker, behind attachSpeech's seam.
// ---------------------------------------------------------------------------------------
/**
 * `plan` is `enginePlanFrom(row)`. Nothing opens a microphone until an engine has said hello: a screen
 * with no recogniser answering never records the room (its status says "waiting").
 *
 * The seam:  start(onText) · stop() · running · setMode(m)
 * And more:  status() / onStatus(fn)  { state: 'waiting'|'listening'|'blocked'|'no-mic'|'stopped', engines, ears,
 *                                        wake: { state } | null }
 *            onWake(fn)               the wake-phrase detector (plan.wake) heard its phrase - see `wakeSays`
 *                                      (blocked: the browser holds sound until the page is touched)
 *            onCaption(fn)            every answer, for subtitles (see createRanker's caption shape)
 *            onRevision(fn)           a later pass disagreed with a command that already acted
 *            sourcesChanged()         a phone joined or left (phone_mic.js); re-reads `phoneStreams`
 *            feed(ear, frame, t)      frames straight in, for the suites (no microphone)
 */
export function rankedRecognizer({
  plan = enginePlanFrom({}),
  micOwner = null,
  getUserMedia = null,
  phoneStreams = () => [],
  makeContext = () => {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    return AC ? new AC() : null;
  },
  workletUrl = new URL('./speech_capture.js', import.meta.url).href,
  WebSocketImpl = typeof WebSocket !== 'undefined' ? WebSocket : null,
  segment = {},
  pairMs = PAIR_MS,
  retryMs = RETRY_MS,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  micId = 'speech',
  // false: open no microphone and no audio context at all - frames come only through `feed` (the
  // suites). The gate on an engine answering still applies.
  capture = true,
  // See createRanker. The kiosk passes input_speech.js's `meansSomething` with the person's wake phrases.
  actsOn = null,
  // THE WAKE HOOK (plan.wake set). What a wake event hands the command path: the person's own wake
  // phrase as if it had been heard ALONE, so input_speech.js opens its listening window exactly as it
  // does for a transcribed one - cue, tone, duck, and the window the command lands in - seconds before
  // the recogniser's transcript arrives. That transcript then lands in the open window ("computer
  // please pause" fires and closes it; "computer please" alone re-opens it). null = tell `onWake`
  // listeners only.
  wakeSays = null,
} = {}) {
  const captionFns = new Set();
  const statusFns = new Set();
  const revisionFns = new Set();
  // Row 2.44: the utterances as they are cut ({ type, ear, uid, group, t, pcm? }), for voice_recording.js.
  // Nothing listens unless a person turned recording on; this opens nothing and sends nothing anywhere.
  const utteranceFns = new Set();
  const wakeFns = new Set();
  let lastWakeAt = -Infinity;
  const emit = (set, x) => { for (const fn of [...set]) { try { fn(x); } catch (err) { console.error('speech recogniser', err); } } };

  let onText = null;
  let running = false;
  // *** ONE CONNECTION PER ENGINE PER EAR. *** A connection carries ONE microphone's audio (one
  // utterance at a time, which is what keeps the protocol plain PCM). Two ears talk at the same moment,
  // so each ear gets its own socket to each engine; the room's is made at start (it is the one that
  // says whether anything answers), a phone's when the phone joins.
  const conns = new Map();         // `${slot}|${ear}` -> connectEngine handle
  let ranker = null;
  let ctx = null;
  let micStream = null;
  let micState = 'closed';         // closed | opening | open | failed
  const ears = new Map();          // ear -> { seg, node, src, keep, stream, open: {uid, asked}|null }
  let mode = null;
  const firstEar = plan.ears === 'phone' ? 'phone1' : 'room';

  const slots = () => plan.passes.map((p) => p.slot);
  const connsOf = (slot) => [...conns.entries()].filter(([k]) => k.startsWith(`${slot}|`)).map(([, c]) => c);
  const anyReady = () => [...conns.entries()].some(([k, c]) => !k.startsWith('wake|') && c.ready());

  function status() {
    const es = plan.passes.map((p) => {
      const cs = connsOf(p.slot);
      const ready = cs.some((c) => c.ready());
      const primary = conns.get(`${p.slot}|${firstEar}`) || cs[0];
      return { slot: p.slot, name: p.name, state: ready ? 'ready' : (primary ? primary.state() : 'closed') };
    });
    let state = 'stopped';
    if (running) {
      if (micState === 'failed') state = 'no-mic';
      else if (anyReady() && micState === 'open') {
        // Sound blocked until somebody touches the page (a browser's autoplay rule): the microphone is
        // open but nothing reaches the recogniser. Said, not left silent.
        state = ctx && ctx.state === 'suspended' ? 'blocked' : 'listening';
      } else state = 'waiting';
    }
    const w = plan.wake ? conns.get(`wake|${firstEar}`) : null;
    return { state, engines: es, skipped: (plan.skipped || []).map((s) => ({ slot: s.slot, name: s.name, why: s.why })),
             ears: [...ears.keys()], wake: plan.wake ? { state: w ? w.state() : 'closed' } : null };
  }
  let lastSig = '';
  function tellStatus() {
    const s = status();
    const sig = JSON.stringify(s);
    if (sig === lastSig) return;
    lastSig = sig;
    emit(statusFns, s);
  }

  // ---- frames -> utterances -> engines -------------------------------------------------
  function earState(ear) {
    let e = ears.get(ear);
    if (!e) {
      e = { seg: createSegmenter({ endSilenceMs: plan.endSilenceMs, ...segment, idPrefix: `${ear}-` }), open: null };
      ears.set(ear, e);
    }
    return e;
  }
  function onFrame(ear, frame, t = now()) {
    if (!running || !ranker || micState !== 'open') return;
    const e = earState(ear);
    e.frames = (e.frames || 0) + 1;
    connectEar(ear);
    // The wake detector hears EVERY frame, not only the segmenter's utterances: it keeps its own
    // rolling context, and a phrase must not lose its first syllable to the segmenter's onset.
    if (plan.wake) conns.get(`wake|${ear}`)?.stream(frame);
    for (const ev of e.seg.push(frame, t)) {
      const uid = `${ear}:${ev.id}`;
      if (ev.type === 'begin') {
        // Asked: this ear's connection to each engine that is up right now. One still connecting is
        // not waited for - it will be there for the next utterance.
        const asked = plan.passes.map((p) => conns.get(`${p.slot}|${ear}`)).filter((c) => c && c.ready());
        e.open = { uid, asked };
        ranker.begin(ear, uid, ev.t, asked.map((x) => x.slot));
        for (const en of asked) en.begin(uid);
      } else if (ev.type === 'audio') {
        if (e.open?.uid === uid) for (const en of e.open.asked) en.audio(uid, ev.pcm);
      } else if (ev.type === 'end') {
        if (e.open?.uid === uid) for (const en of e.open.asked) en.end(uid);
        e.open = null;
        ranker.end(ear, uid, ev.t);
      } else if (ev.type === 'cancel') {
        if (e.open?.uid === uid) for (const en of e.open.asked) en.cancel(uid);
        e.open = null;
        ranker.cancel(ear, uid);
      }
      if (utteranceFns.size) tapUtterance(ear, uid, ev);
    }
  }
  function tapUtterance(ear, uid, ev) {
    const u = { type: ev.type, ear, uid, group: ranker?.groupOf(ear, uid) || null, t: ev.t ?? now(),
                ...(ev.type === 'audio' ? { pcm: ev.pcm } : {}) };
    emit(utteranceFns, u);
  }
  // ---- the connections ------------------------------------------------------------------
  function connectEar(ear) {
    if (!running) return;
    for (const p of plan.passes) {
      const key = `${p.slot}|${ear}`;
      if (conns.has(key)) continue;
      const c = connectEngine({ slot: p.slot, name: p.name, url: p.url, key: p.key, WebSocketImpl, retryMs,
                                setTimer, clearTimer,
                                onResult: (r) => ranker?.result(ear, r),
                                onState: (s) => engineState(p.slot, ear, s) });
      conns.set(key, c);
      if (mode) c.setMode(mode);
    }
    const wk = `wake|${ear}`;
    if (plan.wake && !conns.has(wk)) {
      // Its own state handler: a wake detector answering does NOT open the microphone - with no
      // recogniser up, a heard wake phrase would open a window no command could ever land in.
      conns.set(wk, connectEngine({ slot: 'wake', name: 'Wake phrase', url: plan.wake.url, key: plan.wake.key || '',
                                    WebSocketImpl, retryMs, setTimer, clearTimer, wake: true,
                                    onWake: (w) => wakeHeard(ear, w), onState: () => tellStatus() }));
    }
  }
  // Two microphones hear one phrase: one wake, not two. 1.5 s - the same phrase through a phone and the
  // room's microphone arrives within a few hundred ms [training knowledge]; the service already keeps
  // one ear from firing twice inside 2 s.
  function wakeHeard(ear, w) {
    if (!running) return;
    const t = now();
    if (t - lastWakeAt < WAKE_DEDUPE_MS) return;
    lastWakeAt = t;
    emit(wakeFns, { word: w.word, score: w.score, ear, atMs: w.atMs, detector: w.detector || null, t });
    if (typeof wakeSays === 'string' && wakeSays.trim()) {
      const c = Number(w.score);
      try { onText?.(wakeSays, { ...(Number.isFinite(c) ? { confidence: Math.max(0, Math.min(1, c)) } : {}), wake: true }); }
      catch (err) { console.error('speech: onText (wake)', err); }
    }
  }
  function disconnectEar(ear) {
    for (const [k, c] of [...conns]) {
      if (!k.endsWith(`|${ear}`)) continue;
      try { c.close(); } catch { /* gone */ }
      conns.delete(k);
    }
  }

  // ---- the microphones -----------------------------------------------------------------
  async function ensureContext() {
    if (ctx) return ctx;
    ctx = makeContext();
    if (!ctx) throw new Error('no audio context');
    // NOT awaited: under a browser's autoplay rule `resume()` stays pending until somebody touches the
    // page, and awaiting it would hang here. The status says 'blocked' meanwhile (a kiosk is started
    // with sound allowed, so it never is there).
    try { if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {}); } catch { /* reported by status */ }
    try { ctx.onstatechange = () => tellStatus(); } catch { /* a fake */ }
    await ctx.audioWorklet.addModule(workletUrl);
    return ctx;
  }
  function attachStream(ear, stream, { keepAlive = false } = {}) {
    if (!ctx || !stream) return;
    const e = earState(ear);
    if (e.node) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'speech-capture', { numberOfInputs: 1, numberOfOutputs: 1,
                                                                 processorOptions: { frameMs: SEGMENT_DEFAULTS.frameMs } });
      // A worklet is only pulled when it reaches the destination; through a silent gain it does.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      src.connect(node); node.connect(mute); mute.connect(ctx.destination);
      node.port.onmessage = (m) => { if (m.data instanceof Int16Array) onFrame(ear, m.data); };
      let keep = null;
      if (keepAlive) {
        // A REMOTE (WebRTC) stream can reach Web Audio as silence unless a media element also plays it
        // [training knowledge; amplify.js does the same]. Muted: nothing is heard in the room.
        try { keep = new Audio(); keep.muted = true; keep.srcObject = stream; keep.play?.()?.catch?.(() => {}); } catch { keep = null; }
      }
      Object.assign(e, { src, node, mute, keep, stream });
    } catch (err) { console.error(`speech: capture ${ear}`, err); }
  }
  function detachEar(ear) {
    const e = ears.get(ear);
    if (!e) return;
    for (const ev of e.seg.flush(now())) {
      const uid = `${ear}:${ev.id}`;
      if (e.open?.uid === uid) for (const en of e.open.asked) (ev.type === 'end' ? en.end(uid) : en.cancel(uid));
      if (ev.type === 'end') ranker?.end(ear, uid, ev.t); else ranker?.cancel(ear, uid);
      if (utteranceFns.size) tapUtterance(ear, uid, ev);
    }
    try { e.node?.port?.postMessage({ type: 'stop' }); } catch { /* gone */ }
    for (const n of [e.src, e.node, e.mute]) { try { n?.disconnect?.(); } catch { /* gone */ } }
    if (e.keep) { try { e.keep.pause?.(); e.keep.srcObject = null; } catch { /* gone */ } }
    ears.delete(ear);
    if (ear !== firstEar) disconnectEar(ear);
  }

  async function openMic() {
    if (micState !== 'closed' || !running) return;
    micState = 'opening';
    if (!capture) { micState = 'open'; tellStatus(); return; }
    try {
      await ensureContext();
      if (plan.ears !== 'phone') {
        if (micOwner && typeof micOwner.acquire === 'function') {
          micStream = await micOwner.acquire(micId, { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
        } else {
          const gum = getUserMedia || ((c) => navigator.mediaDevices.getUserMedia(c));
          micStream = await gum({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        }
        if (!running) { releaseMic(); return; }
        attachStream('room', micStream);
      }
      micState = 'open';
      syncPhones();
    } catch (err) {
      console.error('speech: microphone', err);
      micState = 'failed';
    }
    tellStatus();
  }
  function releaseMic() {
    if (micOwner && typeof micOwner.release === 'function') { try { micOwner.release(micId); } catch { /* gone */ } }
    else if (micStream) { for (const t of micStream.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } }
    micStream = null;
  }
  function syncPhones() {
    if (micState !== 'open' || plan.ears === 'room') return;
    let list = [];
    try { list = (phoneStreams() || []).filter(Boolean); } catch { list = []; }
    const want = new Map(list.map((s, i) => [`phone${i + 1}`, s]));
    for (const ear of [...ears.keys()]) {
      if (!ear.startsWith('phone')) continue;
      if (!want.has(ear) || ears.get(ear).stream !== want.get(ear)) detachEar(ear);
    }
    for (const [ear, s] of want) {
      if (!ears.get(ear)?.node) { connectEar(ear); attachStream(ear, s, { keepAlive: true }); }
    }
    tellStatus();
  }

  // ---- engines ---------------------------------------------------------------------------
  function engineState(slot, ear, s) {
    if (s !== 'ready') ranker?.lost(slot, ear);
    if (s === 'ready' && running && micState === 'closed') openMic();
    tellStatus();
  }

  return {
    start(cb) {
      if (running) { onText = cb; return; }
      onText = cb;
      running = true;
      ranker = createRanker({
        passes: slots(), sureAt: plan.sureAt, waitMs: plan.waitMs, pairMs, now, setTimer, clearTimer, actsOn,
        onCommand: (text, detail) => { try { onText?.(text, detail); } catch (err) { console.error('speech: onText', err); } },
        onCaption: (c) => emit(captionFns, c),
        onRevision: (r) => emit(revisionFns, r),
      });
      connectEar(firstEar);
      tellStatus();
    },
    stop() {
      if (!running) return;
      running = false;
      for (const ear of [...ears.keys()]) detachEar(ear);
      for (const c of conns.values()) { try { c.close(); } catch { /* gone */ } }
      conns.clear();
      ranker?.destroy();
      ranker = null;
      releaseMic();
      micState = 'closed';
      if (ctx) { try { ctx.close?.(); } catch { /* gone */ } ctx = null; }
      onText = null;
      tellStatus();
    },
    get running() { return running; },
    setMode(m) { mode = m; for (const c of conns.values()) c.setMode(m); },
    status,
    onStatus(fn) { statusFns.add(fn); return () => statusFns.delete(fn); },
    onCaption(fn) { captionFns.add(fn); return () => captionFns.delete(fn); },
    onRevision(fn) { revisionFns.add(fn); return () => revisionFns.delete(fn); },
    /** Row 2.44: each utterance as it is cut - begin, its 16 kHz audio frames, end or cancel. */
    onUtterance(fn) { utteranceFns.add(fn); return () => utteranceFns.delete(fn); },
    /** The wake-phrase detector heard its phrase: { word, score, ear, atMs, detector, t }. */
    onWake(fn) { wakeFns.add(fn); return () => wakeFns.delete(fn); },
    sourcesChanged() { syncPhones(); },
    feed(ear, frame, t) { onFrame(ear, frame, t); },
    /** Per ear: frames heard, the room's noise floor (dB), whether somebody is talking. Never audio. */
    stats: () => Object.fromEntries([...ears].map(([k, e]) => [k, { frames: e.frames || 0,
      floorDb: e.seg.floorDb, speaking: e.seg.speaking, capturing: !!e.node }])),
    /** Every connection: which engine, which ear, its state and what the service said it is. */
    connections: () => [...conns.entries()].map(([k, c]) => ({ slot: c.slot, ear: k.split('|')[1], name: c.name,
                                                               state: c.state(), info: c.info() })),
    plan: () => plan,
  };
}
