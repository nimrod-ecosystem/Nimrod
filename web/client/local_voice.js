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
// THE PROGRAM (2026-10-14, Mike: "Yes to Piper on the bench"): web/tts_service/tts_service.py, Piper with the
// en_US-ljspeech-medium voice, installed by install-linux.sh NIMROD_TTS=1 as the user unit nimrod-tts.
// MEASURED on the bench Pi 400 with the kiosk running (2026-10-14): a short sentence 0.85-1.66 s (about real time), a
// long one (130 characters, ~7 s of speech) 2.2-5.6 s. So a long message is SPOKEN A SENTENCE AT A TIME
// (`splitForVoice`): the first sentence starts as soon as it is made, and the next is made while it plays.
//
// TURNING IT ON (kiosk.js wires it; it stays off until asked): the launcher's `?localVoice=on` (kiosk-launch.sh, from
// NIMROD_LOCAL_VOICE=on in the kiosk's unit, only when Chromium's local-network policy is there - the lock helper's
// rule, so no "Block / Allow" box sits on a screen nobody can answer) is kept in this browser's storage, like
// `?lockHelper=`; `?localVoice=off` turns it off. `localVoiceFrom`.
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
// A sentence must start soon or the browser's voice should say it. 6 s, argued (was 4 s, from published figures, before
// anything was measured). MEASURED on the bench (above): one sentence takes 0.85-5.6 s with the kiosk busy. FOR 4 s: a
// voice slower than that makes the screen feel broken, and on a desktop the browser's voice is a good stand-in. FOR
// longer (chosen): the local voice is turned on where the browser has NO voice - on a Pi the "fallback" is silence -
// so waiting 6 s for the slowest sentence measured beats saying nothing; and with a sentence at a time only the first
// one is waited for. A setting (500 ms - 30 s).
export const DEFAULT_LOCAL_VOICE_TIMEOUT_MS = 6000;
export const LOCAL_VOICE_PARAM = 'localVoice';
// A message is spoken in pieces of about this many characters, never splitting a sentence unless it is longer than
// MAX_PIECE. 120, argued: two short sentences ("Good morning! Mike is calling you.") are one piece, about 1.5 s to
// make; a long narration is one sentence a piece, so the first sound comes after one sentence, not the whole page.
const JOIN_PIECE = 120;
const MAX_PIECE = 300;
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
 * The launcher's word, kept: `?localVoice=on` turns this device's local voice on, `?localVoice=off` off; anything else
 * (or nothing) leaves the saved setting as it is. Returns the settings now in force. Never throws.
 */
export function localVoiceFrom({ search = (typeof location !== 'undefined' ? location.search : ''), storage = defaultStorage() } = {}) {
  let asked = null;
  try { asked = new URLSearchParams(search || '').get(LOCAL_VOICE_PARAM); } catch { asked = null; }
  if (asked === 'on' || asked === 'off') return writeLocalVoice({ on: asked === 'on' }, storage);
  return readLocalVoice(storage);
}

/**
 * A message in pieces to speak one after another: sentences, joined while they fit in JOIN_PIECE characters; a
 * sentence longer than MAX_PIECE is split at a comma or a space. Pure. '' -> [].
 */
export function splitForVoice(text, { join = JOIN_PIECE, max = MAX_PIECE } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const sentences = t.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g)?.map((s) => s.trim()).filter(Boolean) || [t];
  const cut = [];
  for (let s of sentences) {
    while (s.length > max) {
      let at = s.lastIndexOf(', ', max);
      if (at < max / 3) at = s.lastIndexOf(' ', max);
      if (at < 1) at = max;
      cut.push(s.slice(0, at + (s[at] === ',' ? 1 : 0)).trim());
      s = s.slice(at + 1).trim();
    }
    if (s) cut.push(s);
  }
  const out = [];
  for (const s of cut) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + 1 + s.length <= join) out[last] = `${out[last]} ${s}`;
    else out.push(s);
  }
  return out;
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
    if (signal?.aborted) return { ok: false, cancelled: true, reason: 'Canceled.' };
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
      if (signal?.aborted) return { ok: false, cancelled: true, reason: 'Canceled.' };
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
      const parts = splitForVoice(item && item.text);
      if (!parts.length) return channel.present(item, { done });
      const ctl = new AbortController();
      let cancelled = false;
      let finished = false;
      let inner = null;
      let url = null;
      const made = [];   // the program's answer for each piece, asked for at most once
      const make = (i) => (made[i] ||= Promise.resolve(voice.speak(parts[i], { signal: ctl.signal, voice: item.data?.localVoice || '' }))
        .catch(() => ({ ok: false })));
      const release = () => { if (url) { revokeURL(url); url = null; } };
      const finish = () => { if (finished) return; finished = true; release(); done(); };
      // A sentence at a time: piece i plays while piece i+1 is made. A piece the program cannot make sends the rest
      // of the message to the browser's voice, in one go (the whole message, untouched, when it is the first).
      function play(i) {
        if (cancelled) return;
        if (i >= parts.length) { finish(); return; }
        make(i).then((r) => {
          if (cancelled) return;
          release();
          if (r && r.ok && r.blob) { try { url = createURL(r.blob); } catch { url = null; } }
          if (!url) {
            const c = channel.present(i === 0 ? item : { ...item, text: parts.slice(i).join(' ') }, { done: finish });
            inner = typeof c === 'function' ? c : null;
            return;
          }
          const piece = { ...item, ...(parts.length > 1 ? { text: parts[i] } : {}), data: { ...(item.data || {}), clips: [url] } };
          const c = channel.present(piece, { done: () => { if (cancelled) return; inner = null; release(); play(i + 1); } });
          inner = typeof c === 'function' ? c : null;
          if (i + 1 < parts.length && !cancelled) make(i + 1);   // the next sentence is made while this one plays
        });
      }
      play(0);
      return () => {
        cancelled = true;
        try { ctl.abort(); } catch { /* done */ }
        if (inner) { try { inner(); } catch { /* gone */ } }
        release();
      };
    },
  };
}
