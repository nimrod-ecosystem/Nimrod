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

// Speak `text` in the profile's voice. synth + Utterance are injectable so a test
// passes a fake recorder instead of vocalizing; in the app they default to the
// browser's. Cancels any in-flight utterance first (a new segment supersedes the
// old). Returns the utterance (or null if there's no engine / no text).
export function speak(text, pref = {}, opts = {}) {
  const synth = opts.synth || (typeof window !== 'undefined' ? window.speechSynthesis : null);
  const Utterance = opts.Utterance || (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null);
  if (!synth || !Utterance || !text) return null;

  const voices = opts.voices || listVoices(synth);
  const voice = resolveVoice(pref, voices);

  try { synth.cancel(); } catch { /* some engines lack cancel */ }
  const u = new Utterance(String(text));
  if (voice) { u.voice = voice; if (voice.lang) u.lang = voice.lang; }
  else if (pref.lang) { u.lang = pref.lang; }
  u.rate = clamp(pref.rate, 0.5, 2, 1);
  u.pitch = clamp(pref.pitch, 0, 2, 1);
  synth.speak(u);
  return u;
}

export function cancel(synth = (typeof window !== 'undefined' ? window.speechSynthesis : null)) {
  try { synth?.cancel?.(); } catch { /* noop */ }
}
