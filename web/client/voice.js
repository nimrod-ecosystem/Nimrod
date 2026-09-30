// voice.js — per-PROFILE voice, the twin of theme.js. Voice is a render setting
// on the profile (content-as-meaning: content is text/meaning; the voice that
// speaks it is a per-user setting the renderer reads). Change the voice and every
// spoken segment re-speaks for free — no re-recording. See DECISIONS.md
// ("Content as MEANING") and docs/modules/interstitials.md (voice is a user setting).
//
// ENGINE: the target is Piper (local, OSS, on-device — doubles as Cici's own
// voice). The interim engine here is the browser Web Speech API (speechSynthesis),
// which is zero-install and good enough to build the settings + the speak() seam
// against. speak() takes an injectable synth/Utterance so it is unit-testable
// without actually vocalizing, and so a Piper engine can slot in behind the same
// call later.
//
// PER-DEVICE VOICE LISTS: Web Speech voices differ per machine/OS (the kiosk's set
// isn't the dev box's), exactly like camera deviceIds. So the profile stores a
// PREFERENCE ({uri, lang, rate, pitch}) and resolveVoice() degrades gracefully:
// exact voice by uri -> any voice in the right language -> the platform default ->
// the first available. A saved voice that doesn't exist here never throws.
//
// PREF SHAPE (a field on the per-profile `settings` blob, alongside `theme`):
//   voice: { uri?: string, lang?: string, rate?: number, pitch?: number }

function clamp(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

// The voices available from an engine. Web Speech loads them ASYNCHRONOUSLY (see
// waitForVoices), so a first synchronous call can return []. Injectable for tests.
export function listVoices(synth = (typeof window !== 'undefined' ? window.speechSynthesis : null)) {
  return synth && synth.getVoices ? synth.getVoices() : [];
}

// Web Speech populates voices asynchronously: getVoices() is often empty until a
// 'voiceschanged' event fires. Resolve once voices exist (or after a timeout, in
// case the engine has none). Returns the voice array.
export function waitForVoices(synth = (typeof window !== 'undefined' ? window.speechSynthesis : null), timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!synth || !synth.getVoices) return resolve([]);
    const have = synth.getVoices();
    if (have && have.length) return resolve(have);
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(synth.getVoices() || []); };
    try { synth.addEventListener('voiceschanged', finish, { once: true }); } catch { /* older API */ }
    setTimeout(finish, timeoutMs);
  });
}

// PURE: choose a concrete voice from `voices` for a preference. uri (exact) wins,
// then a language-prefix match, then the engine default, then the first voice.
// null only when there are no voices at all.
export function resolveVoice(pref, voices) {
  if (!voices || !voices.length) return null;
  const p = pref || {};
  if (p.uri) {
    const exact = voices.find((v) => v.voiceURI === p.uri);
    if (exact) return exact;
  }
  if (p.lang) {
    const byLang = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(String(p.lang).toLowerCase()));
    if (byLang) return byLang;
  }
  return voices.find((v) => v.default) || voices[0];
}

// *** ROW 2.27 (2026-09-29): THE AAC BOARD ON AN ANDROID PHONE SPOKE ONE WORD, THEN NOTHING UNTIL
// THE PAGE WAS RELOADED. *** Mike's tests ruled out our own queue (waiting 35 s past the channel's
// watchdog did not bring speech back; remounting the module did not; a fresh page gave exactly one
// more word), so the page's speech ENGINE was left stuck. Not reproduced here (no Android device);
// what this does is remove every known way this file could strand Chrome for Android's engine
// [training knowledge, all four], and dev/speech_probe.html lets the phone say which one mattered:
//   1. cancel() only when something is actually speaking or queued. It used to run before EVERY
//      word, idle or not;
//   2. after a real cancel, speak a moment later rather than in the same tick -- Chrome on Android
//      is known to drop a speak() that immediately follows cancel();
//   3. hold a reference to the live utterance, so it cannot be garbage-collected mid-sentence and
//      take its `onend` with it (the channel then waits for an end that never comes);
//   4. resume() an engine that reports itself paused.
// `opts.legacy: true` restores the old behaviour exactly -- the probe page's "old way" switch.
let heldUtterance = null;     // (3) the utterance in flight, kept reachable until it ends
let deferred = null;          // (2) { timer, u, clearTimer } -- a speak waiting out its cancel

function dropDeferred() {
  if (!deferred) return;
  const { timer, u, clearTimer } = deferred;
  deferred = null;
  try { clearTimer(timer); } catch { /* noop */ }
  // It was superseded before it ever spoke. Say so the way a cancelled utterance does, so a
  // channel waiting on it is freed now rather than by its watchdog. Next microtask, not now: the
  // caller is mid-speak(), and a freed channel may start its next item straight away.
  Promise.resolve().then(() => { try { u.onerror?.({ error: 'interrupted' }); } catch { /* noop */ } });
}

// Speak `text` in the profile's voice. synth + Utterance are injectable so a test
// passes a fake recorder instead of vocalizing; in the app they default to the
// browser's. A new segment supersedes the old (cancelling it first when one is
// actually in flight). Returns the utterance (or null if there's no engine / no text).
//   opts.afterCancelMs  the pause between a real cancel and the next speak (default 100;
//                       unmeasured -- see row 2.27; 0 speaks in the same tick)
//   opts.setTimer / opts.clearTimer  injectable for tests
export function speak(text, pref = {}, opts = {}) {
  const synth = opts.synth || (typeof window !== 'undefined' ? window.speechSynthesis : null);
  const Utterance = opts.Utterance || (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
  if (!synth || !Utterance || !text) return null;

  const voices = opts.voices || listVoices(synth);
  const voice = resolveVoice(pref, voices);

  dropDeferred();
  // (1) An engine that does not report `speaking` (older engines, test fakes) is cancelled as before.
  const reports = typeof synth.speaking === 'boolean';
  const busy = opts.legacy || !reports || synth.speaking || synth.pending;
  if (busy) { try { synth.cancel(); } catch { /* some engines lack cancel */ } }
  if (!opts.legacy && synth.paused) { try { synth.resume(); } catch { /* noop */ } }   // (4)

  const u = new Utterance(String(text));
  if (voice) { u.voice = voice; if (voice.lang) u.lang = voice.lang; }
  else if (pref.lang) { u.lang = pref.lang; }
  u.rate = clamp(pref.rate, 0.5, 2, 1);
  u.pitch = clamp(pref.pitch, 0, 2, 1);
  // The audio bus's MASTER (row 2.28/2.35), handed in by the speech channel. Only when given, so
  // a caller that knows nothing of it leaves the engine's own volume alone; a broken value is
  // full volume, never silence.
  if (opts.volume !== undefined) u.volume = clamp(opts.volume, 0, 1, 1);

  if (!opts.legacy) {
    heldUtterance = u;                                                         // (3)
    if (typeof u.addEventListener === 'function') {
      const release = () => { if (heldUtterance === u) heldUtterance = null; };
      u.addEventListener('end', release);
      u.addEventListener('error', release);
    }
  }

  const wait = opts.legacy ? 0 : Math.max(0, Number(opts.afterCancelMs ?? 100) || 0);
  if (busy && reports && wait > 0) {                                           // (2)
    const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = opts.clearTimer || ((id) => clearTimeout(id));
    const timer = setTimer(() => {
      if (!deferred || deferred.u !== u) return;
      deferred = null;
      try { synth.speak(u); } catch { u.onerror?.({ error: 'synthesis-failed' }); }
    }, wait);
    deferred = { timer, u, clearTimer };
  } else {
    synth.speak(u);
  }
  return u;
}

export function cancel(synth = (typeof window !== 'undefined' ? window.speechSynthesis : null)) {
  dropDeferred();
  heldUtterance = null;
  try { synth?.cancel?.(); } catch { /* noop */ }
}
