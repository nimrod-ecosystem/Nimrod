// local_voice.js — THE SEAM FOR A VOICE PROGRAM ON THIS COMPUTER (text to speech), the CLIENT side only.
//
// Mike, 2026-10-12: *"Don't know if we can have text to speech on the pi."* Today the screen speaks with the
// browser's own voice: output.js routes `say` to the speech channel (output_channels.js createSpeechChannel),
// which calls voice.js `speak()` -> `speechSynthesis`. On a Raspberry Pi, Chromium's `speechSynthesis` speaks only
// through speech-dispatcher, and the bench Pi has none installed (checked 2026-10-12: no piper, espeak or
// speech-dispatcher), so `say` there is silent.
//
// *** THE SEAM, THE SAME SHAPE AS THE SPEECH PROGRAM FOR LISTENING. *** Recognition already works this way: a
// program on the same computer, on a loopback address, that the https page may reach (a secure page may talk to
// 127.0.0.1 over plain http/ws; never to another computer by name). Speaking is the mirror of it:
//
//   GET  <base>/health  -> { ok: true, engine: 'piper:en_US-ljspeech-medium', voices?: [ids] }
//   POST <base>/speak   { text, voice?, rate? } -> the sound, `audio/wav` (or any type an <audio> can play)
//
// The program checks the page's Origin against its own allow-list (the speech program's rule) and answers with CORS
// headers for it; it binds 127.0.0.1 only, so nothing on the house's network can make the screen talk.
// THE PROGRAM IS NOT BUILT OR INSTALLED: Piper and a voice are downloads, and a download is Mike's call. This file
// and its suite (dev/local_voice_test.html, a stub program) are the half that can be built now.
//
// *** IT REUSES THE SPEECH CHANNEL'S OWN "RECORDED SOUND" PATH. *** `withLocalVoice(channel, voice)` wraps the
// speech channel: when the local voice is on and answers, the sound it makes is handed to the channel as the
// message's clip (`data.clips`, the board's "a word with a recorded sound is said in that sound", 2026-10-09). So a
// sentence in the local voice gets everything a spoken one gets: one at a time, the music ducked, the mixer's voice
// level, the screen marked as talking (the microphone does not hear it as the person), the 30 s watchdog, and -
// if the sound will not play - the browser's voice instead. When the local voice is off, missing, slow or broken,
// the message goes straight to the channel as before. Nothing ever waits on it longer than `timeoutMs`.
//
// PER DEVICE, NOT PER PERSON: the program is on the computer in front of you, like ai.js's address. Kept in this
// browser's localStorage (`LOCAL_VOICE_KEY`), read in try/catch. OFF BY DEFAULT: no screen reaches for a local
// address until somebody turns this on (a Chrome that asks before a site reaches the local network would otherwise
// put a question on a screen nobody is there to answer).

export const LOCAL_VOICE_KEY = 'nimrod.voice.local';
// 8794: free beside the other Nimrod programs (8790 the helper, 8796 my-voice, 8797 the speech program, 8798 the
// example wake-phrase engine, 8770-8773 the media agents, 8791 corpus_desk). A setting.
export const DEFAULT_LOCAL_VOICE_URL = 'http://127.0.0.1:8794';
// A sentence must start soon or the browser's voice should say it. 4 s, argued: Piper's "medium" voices are reported
// at roughly 1-3 s for a short sentence on a Pi 4 (no measured figure published); 4 s covers that with a margin,
// and anything slower is a voice that makes the screen feel broken. A setting.
export const DEFAULT_LOCAL_VOICE_TIMEOUT_MS = 4000;
export const LOCAL_VOICE_DEFAULTS = Object.freeze({ on: false, url: DEFAULT_LOCAL_VOICE_URL, voice: '', timeoutMs: DEFAULT_LOCAL_VOICE_TIMEOUT_MS });
const MAX_TEXT = 1000;

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** Only a loopback address is accepted: this program is on THIS computer, by design (see the top). */
export function cleanLocalVoiceUrl(v) {
  const s = typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!(h === '127.0.0.1' || h === 'localhost' || h === '::1')) return '';
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
}

export function readLocalVoice(storage = defaultStorage()) {
  let raw = null;
  try { raw = storage ? JSON.parse(storage.getItem(LOCAL_VOICE_KEY) || 'null') : null; } catch { raw = null; }
  const o = raw && typeof raw === 'object' ? raw : {};
  const t = Number(o.timeoutMs);
  return {
    on: o.on === true,
    url: cleanLocalVoiceUrl(o.url) || DEFAULT_LOCAL_VOICE_URL,
    voice: typeof o.voice === 'string' ? o.voice.trim().slice(0, 80) : '',
    timeoutMs: t >= 500 && t <= 30000 ? t : DEFAULT_LOCAL_VOICE_TIMEOUT_MS,
  };
}

export function writeLocalVoice(patch = {}, storage = defaultStorage()) {
  const next = { ...readLocalVoice(storage), ...(patch && typeof patch === 'object' ? patch : {}) };
  next.on = next.on === true;
  next.url = cleanLocalVoiceUrl(next.url) || DEFAULT_LOCAL_VOICE_URL;
  try { storage?.setItem(LOCAL_VOICE_KEY, JSON.stringify(next)); } catch { /* read-only storage */ }
  return readLocalVoice(storage);
}

/**
 * The client. `fetchImpl`, `storage` and `now` are injectable. `speak(text)` resolves
 * `{ ok: true, blob, type, ms }` or `{ ok: false, reason, timedOut?, off? }`; it never throws.
 */
export function createLocalVoice({ fetchImpl = (...a) => fetch(...a), storage = defaultStorage(), now = () => Date.now() } = {}) {
  const cfg = () => readLocalVoice(storage);
  let lastHealth = null;

  async function call(path, init, { signal, timeoutMs } = {}) {
    const c = cfg();
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, Number(timeoutMs) > 0 ? Number(timeoutMs) : c.timeoutMs);
    const onCancel = () => ctl.abort();
    signal?.addEventListener?.('abort', onCancel);
    try {
      // credentials 'omit': a local program never gets the site's cookies.
      const res = await fetchImpl(`${c.url}${path}`, { ...init, credentials: 'omit', signal: ctl.signal });
      if (res.status === 403) return { ok: false, status: 403, reason: `The voice program at ${c.url} refused this website. It must list this website as allowed.` };
      if (!res.ok) return { ok: false, status: res.status, reason: `The voice program answered with an error (${res.status}).` };
      return { ok: true, res };
    } catch {
      if (timedOut) return { ok: false, timedOut: true, reason: 'The voice program took too long, so the browser’s voice was used.' };
      if (signal?.aborted) return { ok: false, cancelled: true, reason: 'Cancelled.' };
      return { ok: false, reason: `No voice program answered at ${c.url}.` };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onCancel);
    }
  }

  return {
    settings: cfg,
    setSettings: (patch) => writeLocalVoice(patch, storage),
    enabled: () => cfg().on,
    lastHealth: () => lastHealth,
    /** Ask whether the program is there. Only from a press (a settings page's "Check"), never on load. */
    async check({ signal } = {}) {
      const r = await call('/health', { method: 'GET' }, { signal, timeoutMs: Math.max(cfg().timeoutMs, 3000) });
      if (!r.ok) { lastHealth = { ok: false, reason: r.reason }; return lastHealth; }
      let body = null;
      try { body = await r.res.json(); } catch { body = null; }
      lastHealth = body && body.ok ? { ok: true, engine: String(body.engine || ''), voices: Array.isArray(body.voices) ? body.voices.map(String) : [] }
        : { ok: false, reason: 'The voice program answered, but not as expected.' };
      return lastHealth;
    },
    async speak(text, { signal, voice = '', rate = null } = {}) {
      const c = cfg();
      if (!c.on) return { ok: false, off: true, reason: 'The voice program is turned off on this device.' };
      const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      if (!t) return { ok: false, reason: 'Nothing to say.' };
      const t0 = now();
      const body = { text: t, ...((voice || c.voice) ? { voice: voice || c.voice } : {}), ...(Number(rate) > 0 ? { rate: Number(rate) } : {}) };
      const r = await call('/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { signal });
      if (!r.ok) return r;
      let blob;
      try { blob = await r.res.blob(); } catch { return { ok: false, reason: 'The voice program’s sound could not be read.' }; }
      const type = String(blob?.type || r.res.headers?.get?.('content-type') || '');
      if (!blob || !blob.size || (type && !/^audio\//i.test(type))) return { ok: false, reason: 'The voice program did not send a sound.' };
      return { ok: true, blob, type, ms: now() - t0 };
    },
  };
}

/**
 * The speech channel, with the local voice first. Returns a channel with the same contract (output_channels.js):
 * `present(item, { done })` -> a cancel function. `createURL`/`revokeURL` are injectable (a suite has no blobs to
 * play). Messages that already carry their own clips (the board's recorded words) are left exactly as they were.
 */
export function withLocalVoice(channel, voice, { createURL = (b) => URL.createObjectURL(b), revokeURL = (u) => { try { URL.revokeObjectURL(u); } catch { /* gone */ } } } = {}) {
  if (!channel || typeof channel.present !== 'function' || !voice || typeof voice.speak !== 'function') return channel;
  return {
    ...channel,
    present(item, { done }) {
      const own = item && item.data && Array.isArray(item.data.clips) && item.data.clips.length;
      if (own || !voice.enabled?.()) return channel.present(item, { done });
      const ctl = new AbortController();
      let cancelled = false;
      let inner = null;
      let url = null;
      const finish = () => { if (url) { revokeURL(url); url = null; } done(); };
      voice.speak(item.text, { signal: ctl.signal, voice: item.data?.localVoice || '' }).then((r) => {
        if (cancelled) return;
        let next = item;
        if (r && r.ok && r.blob) {
          try { url = createURL(r.blob); } catch { url = null; }
          if (url) next = { ...item, data: { ...(item.data || {}), clips: [url] } };
        }
        const c = channel.present(next, { done: finish });
        inner = typeof c === 'function' ? c : null;
      }, () => {
        if (cancelled) return;
        const c = channel.present(item, { done });
        inner = typeof c === 'function' ? c : null;
      });
      return () => {
        cancelled = true;
        try { ctl.abort(); } catch { /* done */ }
        if (inner) { try { inner(); } catch { /* gone */ } }
        if (url) { revokeURL(url); url = null; }
      };
    },
  };
}
