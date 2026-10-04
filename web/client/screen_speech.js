// screen_speech.js — WHEN IS THE SCREEN ITSELF TALKING? (2026-10-04)
//
// The screen's speaker and its microphone are in the same room. While the screen reads a question
// and four answers aloud, the microphone hears it, and two things downstream take that sound as a
// PERSON'S:
//
//   * voice_recording.js keeps it as a training pair - the screen's synthetic voice, labelled as the
//     person, in the data a recogniser is meant to learn THEIR voice from;
//   * input_speech.js hears it as an answer, a dictation or a command - a quiz answering itself.
//
// This is the one place that knows. The speech channel (output_channels.js) marks it at the same two
// points it marks the audio bus's voice tier: `begin` when a sentence starts, `end` on every way out
// (finished, cancelled, the watchdog). Both readers ask it the same question - "was the screen talking
// at any moment from t0 to t1?" - with the same tail, so the recorder and the recogniser can never
// disagree about when the screen was speaking.
//
// IT DOES NOT TURN ANYTHING OFF. Speech carries on; recording carries on. It only says when.
//
// ---------------------------------------------------------------------------------------
// THE TAIL, ARGUED (default 400 ms; `tailMs`, and `setTail`)
// ---------------------------------------------------------------------------------------
// "Stopped" is what the speech engine SAYS, and the sound outlives it:
//   * the audio output's buffer: the voice is still leaving the speaker when the engine's end event
//     fires - tens of ms on a USB speaker, 100-250 ms on a Bluetooth one [training knowledge, not
//     measured here];
//   * the room: an ordinary furnished room's echo dies away over a few hundred ms, and the first
//     hundred or two of that is loud enough for an energy gate to call it speech [training knowledge].
// The microphone's own delay is already on the screen's side of the line: a frame is stamped when it
// ARRIVES, which is after it was heard, so the screen's last word arrives stamped late, inside the tail.
// Longer costs something real: the first part of a reply that starts the moment the screen stops is
// treated as the screen's. 400 ms covers a USB speaker plus the echo with room to spare and is still
// shorter than most people take to start answering a question. A Bluetooth speaker may want more.
// [A guess, on Mike's list: measure it on the bench Pi - play a sentence and watch the segmenter's level
// fall back to the room's floor.] Not a menu setting yet: it is a fact about the speaker and the room,
// not about a person, and there is no per-device row to put it on.
export const SCREEN_SPEECH_TAIL_MS = 400;

// Plumbing, argued: how much history is kept. A reader asks about an utterance AFTER it ends, and the
// longest wait before it asks is the recorder's 30 s for a transcript (voice_recording.js PENDING_MS) on
// top of the longest utterance (speech_engines.js maxUtteranceMs). Two minutes is past both; 200 spans
// is far more sentences than a screen says in two minutes.
export const KEEP_MS = 120000;
export const KEEP_SPANS = 200;

// The words of a sentence, for comparing what was heard with what the screen said. Same shape as
// input_speech.js `normalize` (lower case, letters only, runs of space), digits kept as well.
export function words(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * The tracker. `begin(text)` -> an id; `end(id)`. Then, for any moment or stretch:
 *   speaking(t)           the screen is talking at t, or it stopped less than the tail ago
 *   firstBusy(t0, t1)     the earliest moment in [t0, t1] that is screen speech (or its tail), or null
 *   overlaps(t0, t1)      firstBusy !== null
 *   saidBetween(t0, t1)   what the screen was saying in that stretch (the sentences' text)
 * Times are `now()`'s clock (Date.now by default) - the same clock the recogniser stamps frames with.
 */
export function createScreenSpeech({ now = () => Date.now(), tailMs = SCREEN_SPEECH_TAIL_MS,
                                     keepMs = KEEP_MS, keepSpans = KEEP_SPANS } = {}) {
  let tail = tailOf(tailMs);
  let seq = 0;
  const live = new Map();          // id -> { from, text }
  const spans = [];                // finished: { from, to, text }, oldest first
  const subs = new Set();

  function tailOf(v) {
    const n = Number(v);
    return v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(n) && n >= 0 ? n : SCREEN_SPEECH_TAIL_MS;
  }
  function tell() {
    const on = live.size > 0;
    for (const fn of [...subs]) { try { fn({ speaking: on }); } catch (err) { console.error('screen speech', err); } }
  }
  function prune(t) {
    while (spans.length > keepSpans) spans.shift();
    while (spans.length && spans[0].to + tail < t - keepMs) spans.shift();
  }
  // Every busy stretch, tail included: [from, to + tail], or [from, Infinity] while still talking.
  function windows() {
    const out = spans.map((s) => ({ from: s.from, to: s.to + tail, text: s.text }));
    for (const s of live.values()) out.push({ from: s.from, to: Infinity, text: s.text });
    return out;
  }
  function hits(t0, t1) {
    const a = Number(t0); const b = Number(t1);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
    const lo = Math.min(a, b); const hi = Math.max(a, b);
    return windows().filter((w) => w.from <= hi && w.to >= lo);
  }

  return {
    /** The screen started saying `text`. Returns the id `end` takes. */
    begin(text = '', t = now()) {
      seq += 1;
      const id = `s${seq}`;
      const wasOn = live.size > 0;
      live.set(id, { from: Number(t) || now(), text: String(text || '') });
      if (!wasOn) tell();
      return id;
    },
    /** It stopped (finished, cancelled, or given up on). An unknown or repeated id is ignored. */
    end(id, t = now()) {
      const s = live.get(id);
      if (!s) return;
      live.delete(id);
      const to = Math.max(s.from, Number(t) || now());
      spans.push({ from: s.from, to, text: s.text });
      prune(to);
      if (!live.size) tell();
    },
    speaking(t = now()) { return hits(t, t).length > 0; },
    talkingNow: () => live.size > 0,
    firstBusy(t0, t1) {
      const lo = Math.min(Number(t0), Number(t1));
      const hs = hits(t0, t1);
      if (!hs.length) return null;
      return Math.min(...hs.map((w) => Math.max(lo, w.from)));
    },
    overlaps(t0, t1) { return hits(t0, t1).length > 0; },
    saidBetween(t0, t1) { return hits(t0, t1).map((w) => w.text).filter(Boolean); },
    /** Its clock (the recogniser's question for an utterance that came with no times uses it). */
    now: () => now(),
    get tailMs() { return tail; },
    setTail(ms) { tail = tailOf(ms); return tail; },
    /** fn({ speaking }) when the screen starts or stops talking (the tail is not announced). */
    onChange(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => { subs.delete(fn); }; },
    reset() { live.clear(); spans.length = 0; tell(); },
  };
}

// ---------------------------------------------------------------------------------------
// THE RECOGNISER'S QUESTION: was this the screen hearing itself?
// ---------------------------------------------------------------------------------------
// An utterance heard from t0 to t1 that touches the screen's speech (or its tail) is the screen's,
// and is not taken as an answer, a dictation or a command - EXCEPT a wake-phrase command whose words
// the screen did not just say: that is a person talking over the screen ("computer please stop"), and
// it must still work. A wake-phrase line the screen DID say ("say computer please pause to stop") is
// the screen's own and does nothing.
//
// Why not keep a no-wake utterance that overlaps: on a raw microphone the energy gate cuts the screen's
// sentence and anything said over it as ONE utterance, so its transcript is the screen's words with the
// person's mixed in - "London Paris Berlin" is not an answer, and sent to an AI as dictation it is
// garbage. Dropping it costs a person who talked over the screen one repeat, after it stops.
//
// "The screen said those words": at least ECHO_SHARE of the heard words are among the screen's. Not
// every word: a recogniser mishears a synthetic voice now and then (row 2.28's bench wrote "pass" for
// "pause"), and "every word" would let a lightly misheard echo through. Three in four, so a person's
// own command - whose verb the screen did not just say - stays under the line. [A guess; on Mike's list.]
export const ECHO_SHARE = 0.75;

/**
 * { echo, overlapped } for one heard utterance. `woke`: it began with a wake phrase (the caller knows
 * its phrases; this file does not). No tracker, or no overlap: not an echo.
 */
export function heardOverScreen(tracker, { text = '', from = null, to = null, woke = false, share = ECHO_SHARE } = {}) {
  if (!tracker || typeof tracker.overlaps !== 'function') return { echo: false, overlapped: false };
  const a = Number.isFinite(Number(from)) && from !== null ? Number(from) : null;
  const b = Number.isFinite(Number(to)) && to !== null ? Number(to) : null;
  let t0 = a ?? b; let t1 = b ?? a;
  if (t0 === null) {
    // A recogniser that says nothing about WHEN (the browser's own): only "is it talking now".
    let t = Date.now();
    try { if (typeof tracker.now === 'function') t = Number(tracker.now()); } catch { t = Date.now(); }
    t0 = t; t1 = t;
  }
  let overlapped = false;
  try { overlapped = !!tracker.overlaps(t0, t1); } catch { overlapped = false; }
  if (!overlapped) return { echo: false, overlapped: false };
  if (!woke) return { echo: true, overlapped: true };
  const heard = words(text);
  if (!heard.length) return { echo: true, overlapped: true };
  let said = [];
  try { said = tracker.saidBetween(t0, t1) || []; } catch { said = []; }
  const pool = new Set(said.flatMap(words));
  const inPool = heard.filter((w) => pool.has(w)).length;
  const s = Number.isFinite(Number(share)) ? Number(share) : ECHO_SHARE;
  return { echo: inPool / heard.length >= s, overlapped: true };
}
