// voice_recording.js — RECORDING WHAT A PERSON SAYS, SO A RECOGNISER CAN LEARN THEIR VOICE (row 2.44).
//
// Mike, 2026-09-30: *"All of this would be a good way for the AI to learn her or anyone else's voice.
// Maybe leave voice recording off as default, but I would want it on for the AI to go through. It
// could be used for training."* Chat's note on the row: every corrected transcript - what was SAID
// and what was MEANT - is a training pair. Training itself runs later, on another computer with a GPU
// (not here); this file only COLLECTS the pairs.
//
// ---------------------------------------------------------------------------------------
// WHAT IT DOES, AND THE FOUR THINGS IT NEVER DOES
// ---------------------------------------------------------------------------------------
//
//   microphone ─▶ speech_engines.js cuts utterances (it already does, for the recognisers)
//                    │  onUtterance: begin · 16 kHz audio · end        onCaption: the transcripts
//                    ▼
//   createVoiceRecorder ─▶ one TRAINING PAIR per utterance group, when the transcript is final:
//        { said: { text, confidence, engine, others }, meant: '', clips: [room.wav, phone1.wav] }
//                    ▼
//   a pair store ON THIS DEVICE (IndexedDB) ─▶ the review panel: play it, read what the recogniser
//                                               wrote, type or confirm what was meant, or delete it
//                                          ─▶ "export to a folder" (fs_sink.js's folder discipline)
//
//   1. IT NEVER OPENS A MICROPHONE. It hears only what the recogniser already cut. With speech (or
//      subtitles) off there is no recogniser, and this records nothing - there is no code path here
//      that asks for a microphone at all.
//   2. IT IS OFF FOR EVERYBODY BY DEFAULT. `voiceRecording` is a per-PERSON setting (the person's row,
//      like speech and subtitles), false unless somebody turns it on for that one person. Mike means to
//      turn it on for one person himself; nothing here does.
//   3. NOTHING GOES TO OUR SERVER. The pairs live in this browser's own storage on this screen, and
//      leave it only when somebody at the screen presses Export and picks a folder. Argued below.
//   4. IT IS NEVER HIDDEN. While it is on and the recogniser is listening, the screen says
//      "Recording voice for training" (`mountRecordingIndicator`). NO SETTING HIDES IT - the same
//      standard as "Microphone on: <phone>" (phone_mic.js). If it cannot save (storage full), the
//      notice says that instead of quietly dropping.
//
// ---------------------------------------------------------------------------------------
// WHERE THE PAIRS ARE KEPT, ARGUED
// ---------------------------------------------------------------------------------------
//
//   (a) IndexedDB on this screen (CHOSEN, the default store). FOR: always there, no prompt, survives a
//       reload, never leaves the device. AGAINST: invisible to a file manager, and gone if the browser's
//       data is cleared - or if the kiosk's browser runs in a private/incognito profile [NOT CHECKED on
//       the Pis: on Mike's list]. So Export exists.
//   (b) A folder somebody picked (fs_sink.js). FOR: real files a training script can read. AGAINST: the
//       browser only lets a page write there after a PRESS on that page (permission does not survive a
//       reload by default - fs_sink.js measured it), so a kiosk that restarts overnight would stop
//       recording silently until somebody pressed a button. That is why it is the EXPORT, not the store.
//   (c) The speech service on this machine (web/speech_service) already receives every utterance and
//       could write files beside itself. FOR: files on disk, no browser storage. AGAINST: a protocol
//       change and Python work, and the transcripts are assembled HERE (the ranker), not there. A
//       later option, not built.
//
// ---------------------------------------------------------------------------------------
// WHAT IT RECORDS THAT IT SHOULD NOT, SAID PLAINLY
// ---------------------------------------------------------------------------------------
//
// The cut is an ENERGY gate (speech_engines.js says so): anybody speaking near the microphone - staff,
// visitors, a TV - is recorded too, and no speaker identification exists to tell them apart. Mike: the
// room has recording signs. The review panel is where somebody deletes what is not the person. A
// "record only when the speaker match says it is them" option needs the speaker engine that does not
// exist yet (subtitles.js lists what it needs).

import { noticeStack } from './live_notices.js';

export const VOICE_RECORDING_TOPIC = 'voice-recording/state';
export const PAIR_VERSION = 1;
export const CLIP_RATE = 16000;          // what speech_capture.js hands every recogniser

export const VOICE_RECORDING_DEFAULTS = Object.freeze({
  // OFF for everybody. A profile can carry it on; this file never turns it on.
  on: false,
  // Days a pair is kept. 30, the same default recorder.js argued for recordings: long enough for a
  // family member to get round to reviewing a batch and for the pairs to be exported to the training
  // computer; short enough that a forgotten store does not become a year of somebody's room. 0 = keep
  // until somebody deletes it (the right choice while actively training; a choice, not the default).
  keepDays: 30,
  // A ceiling on how many pairs this screen holds. A 5-second utterance is ~160 KB (16 kHz, 16-bit),
  // two ears double it; 1000 pairs is roughly 160-320 MB, which a Pi's SD card can spare and a phone's
  // browser may not. At the ceiling it PAUSES and says so - it never deletes somebody's unreviewed
  // recordings to make room. [A guess at the right size; a setting.]
  maxPairs: 1000,
  // Keep utterances nobody could make out (no words). ON: the recogniser failing on this person's
  // speech is exactly what training is for - those are the most valuable clips, and "some things will
  // be missed" was Mike's worry (row 2.42). Off for somebody who only wants the clear ones.
  keepUnclear: true,
});

export const KEEP_DAY_CHOICES = Object.freeze([7, 30, 90, 0]);

// Not settings, argued: plumbing nobody in a room can judge.
// A group whose transcript never became final (an engine went away) is saved with what it has after
// this long - the ranker itself gives up after 15 s (GIVE_UP_MS), so this only catches a recogniser
// that stopped mid-group.
export const PENDING_MS = 30000;
// How often an attached recorder tidies expired pairs. The sweep also runs at every attach.
export const SWEEP_EVERY_MS = 6 * 3600 * 1000;

export const VOICE_RECORDING_FIELDS = [
  { key: 'voiceRecording', label: 'Record this person’s voice for training', kind: 'toggle',
    default: VOICE_RECORDING_DEFAULTS.on, level: 'standard',
    note: 'Off unless you turn it on. When speech is listening, each thing said is kept ON THIS SCREEN '
        + 'with what the recogniser wrote, so somebody can add what was meant and a recogniser can '
        + 'learn this voice. The screen shows when it is recording. Anybody near the microphone is '
        + 'recorded too.' },
  { key: 'voiceRecordingKeepDays', label: 'Voice recordings: keep for', kind: 'choice',
    default: VOICE_RECORDING_DEFAULTS.keepDays, level: 'standard',
    options: [
      { value: 7, label: 'A week' },
      { value: 30, label: 'A month' },
      { value: 90, label: 'Three months' },
      { value: 0, label: 'Until somebody deletes them' },
    ],
    note: 'Tidied up whenever this screen is running. Each recording carries its own keep-until date.' },
  { key: 'voiceRecordingMaxPairs', label: 'Voice recordings: most to keep on this screen', kind: 'number',
    default: VOICE_RECORDING_DEFAULTS.maxPairs, min: 50, max: 20000, step: 50, level: 'advanced',
    note: 'At this many it pauses and says so. It never deletes recordings to make room.' },
  { key: 'voiceRecordingKeepUnclear', label: 'Voice recordings: keep what could not be made out', kind: 'toggle',
    default: VOICE_RECORDING_DEFAULTS.keepUnclear, level: 'advanced',
    note: 'The recogniser missing somebody’s words is what training is for.' },
];

/** A person's row -> this file's options. Each unset or broken key is its default. */
export function voiceRecordingOptionsFrom(values = {}) {
  const v = values || {};
  const k = Number(v.voiceRecordingKeepDays);
  const m = Number(v.voiceRecordingMaxPairs);
  return {
    on: v.voiceRecording === true,
    keepDays: v.voiceRecordingKeepDays !== null && v.voiceRecordingKeepDays !== '' && typeof v.voiceRecordingKeepDays !== 'boolean'
      && Number.isFinite(k) && k >= 0 ? Math.round(k) : VOICE_RECORDING_DEFAULTS.keepDays,
    maxPairs: typeof v.voiceRecordingMaxPairs !== 'boolean' && Number.isFinite(m) && m >= 1
      ? Math.round(m) : VOICE_RECORDING_DEFAULTS.maxPairs,
    keepUnclear: typeof v.voiceRecordingKeepUnclear === 'boolean' ? v.voiceRecordingKeepUnclear : VOICE_RECORDING_DEFAULTS.keepUnclear,
  };
}

// ---------------------------------------------------------------------------------------
// WAV from the 16-bit frames the recogniser already has. Pure. (recorder.js's encodeWav takes floats;
// these are integers already, and converting twice would only lose the last bit.)
// ---------------------------------------------------------------------------------------
export function encodeWav16(samples, sampleRate = CLIP_RATE) {
  const n = samples ? samples.length : 0;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, samples[i], true);
  return buf;
}

export function newPairId(at, rand = Math.random) {
  let s = '';
  for (let i = 0; i < 3; i++) s += Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `vp-${Math.round(Number(at) || 0).toString(36)}-${s}`;
}

/**
 * One training pair, as it is written. Pure. EVERY FIELD THAT CANNOT BE RECONSTRUCTED LATER is here
 * from the first write - who it is for, when, which engine wrote the words and how sure it was, and
 * when it should be gone (recorder.js's argument: a field absent at write time cannot be supplied).
 * `meant` starts EMPTY: only a person may say what was meant. Nothing here guesses it.
 */
export function buildPair({
  id, personId = null, at = 0, caption = null, clips = [], keepDays = VOICE_RECORDING_DEFAULTS.keepDays,
  finalTranscript = true,
} = {}) {
  const c = caption || {};
  const text = String(c.text || '').trim();
  const conf = Number(c.confidence);
  const kd = Math.max(0, Number(keepDays) || 0);
  return {
    v: PAIR_VERSION,
    kind: 'voice-training-pair',
    id: id || newPairId(at),
    personId: personId || null,
    at,
    producer: 'human',
    said: {
      text,
      confidence: c.confidence != null && Number.isFinite(conf) ? conf : null,
      engine: c.engine || null,
      slot: c.slot || null,
      ear: c.ear || null,
      final: !!finalTranscript,
      // The other ear's words when two ears disagreed (row 2.46): a reviewer sees both.
      others: Array.isArray(c.others) ? c.others.map((o) => ({ ear: o.ear || null, text: String(o.text || ''),
        confidence: Number.isFinite(Number(o.confidence)) && o.confidence != null ? Number(o.confidence) : null })) : [],
      words: Array.isArray(c.words) ? c.words.slice(0, 200) : [],
    },
    unclear: !text,
    meant: '',
    meantAt: null,
    reviewed: false,
    clips: clips.map((k) => ({ ear: String(k.ear || 'room'), file: `${String(k.ear || 'room')}.wav`,
                               sampleRate: Number(k.sampleRate) || CLIP_RATE,
                               durationMs: Math.round(Number(k.durationMs) || 0),
                               offsetMs: Math.round(Number(k.offsetMs) || 0) })),
    keepDays: kd,
    keepUntil: kd > 0 && at ? at + kd * 86400000 : null,
  };
}

/** Past its own keep-until date? A pair with none is KEPT (the safe direction; fs_sink.js). Pure. */
export function pairExpired(pair, now = Date.now()) {
  const u = pair && pair.keepUntil;
  return typeof u === 'number' && u > 0 && now >= u;
}

/** What a reviewer typed (or confirmed). Pure: trims, bounds, and marks it reviewed. */
export function withMeant(pair, meant, at = Date.now()) {
  const m = String(meant ?? '').trim().slice(0, 1000);
  return { ...pair, meant: m, meantAt: at, reviewed: true };
}

// ---------------------------------------------------------------------------------------
// THE STORES. Same interface, all async:
//   add(pair, clips: [{ ear, wav }])   list({ personId })   audio(id, ear)   update(id, patch)
//   remove(id)   count({ personId })   sweep(now) -> ids removed   clear()
// ---------------------------------------------------------------------------------------

export function createMemoryPairStore() {
  const pairs = new Map();
  const audio = new Map();
  const mine = (p, personId) => personId === undefined || p.personId === (personId || null);
  return {
    kind: 'memory',
    async add(pair, clips = []) {
      for (const c of clips) audio.set(`${pair.id}|${c.ear}`, c.wav);
      pairs.set(pair.id, JSON.parse(JSON.stringify(pair)));
      return pair.id;
    },
    async list({ personId } = {}) {
      return [...pairs.values()].filter((p) => mine(p, personId)).sort((a, b) => b.at - a.at).map((p) => ({ ...p }));
    },
    async get(id) { const p = pairs.get(id); return p ? { ...p } : null; },
    async audio(id, ear) { return audio.get(`${id}|${ear}`) || null; },
    async update(id, patch = {}) {
      const p = pairs.get(id);
      if (!p) return null;
      const next = { ...p, ...patch, id: p.id };
      pairs.set(id, next);
      return { ...next };
    },
    async remove(id) {
      const p = pairs.get(id);
      if (!p) return false;
      for (const c of p.clips || []) audio.delete(`${id}|${c.ear}`);
      pairs.delete(id);
      return true;
    },
    async count({ personId } = {}) { return [...pairs.values()].filter((p) => mine(p, personId)).length; },
    async sweep(now = Date.now()) {
      const gone = [];
      for (const p of [...pairs.values()]) if (pairExpired(p, now)) { await this.remove(p.id); gone.push(p.id); }
      return gone;
    },
    async clear() { pairs.clear(); audio.clear(); },
  };
}

export const IDB_NAME = 'nimrod-voice-training';

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

/**
 * The default store: this browser's IndexedDB, on this screen. Pairs and audio in two object stores,
 * so listing never loads audio. A deletion removes the pair AND its clips in ONE transaction - a
 * half-deleted pair (a transcript with its audio gone, or audio nobody can find) is worse than either
 * (fs_sink.js: "a session is deleted whole").
 */
export function createIdbPairStore({ idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), name = IDB_NAME,
  storage = (typeof navigator !== 'undefined' ? navigator.storage : null) } = {}) {
  if (!idb) throw new Error('createIdbPairStore: this browser has no IndexedDB');
  let dbp = null;
  // *** ASK THE BROWSER TO KEEP THIS DATA (2026-10-02). *** Checked on the bench: the kiosk's profile is on the
  // SD card and recordings survive a reboot. But without `persist()` the browser counts them as data it may
  // evict under disk pressure. So before the FIRST save, ask once. The answer (true/false/null when the browser
  // has no such call) is kept for `persisted()`. A refusal saves anyway: "Export to a folder" stays the backup.
  let persistAsk = null;
  const askPersist = () => {
    if (!persistAsk) {
      persistAsk = Promise.resolve()
        .then(() => (typeof storage?.persist === 'function' ? storage.persist() : null))
        .then((v) => (v == null ? null : !!v), () => false);
    }
    return persistAsk;
  };
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = idb.open(name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('pairs')) db.createObjectStore('pairs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  };
  const tx = async (stores, mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then((v) => { out = v; }, (e) => { try { t.abort(); } catch { /* gone */ } rej(e); });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('aborted'));
    });
  };
  const all = () => tx(['pairs'], 'readonly', (t) => req(t.objectStore('pairs').getAll()));
  const mine = (p, personId) => personId === undefined || p.personId === (personId || null);
  const api = {
    kind: 'indexeddb',
    /** Whether the browser agreed to keep this data: true / false / null (no such call), or undefined before any save. */
    persisted() { return persistAsk ? persistAsk : Promise.resolve(undefined); },
    async add(pair, clips = []) {
      await askPersist();
      return tx(['pairs', 'audio'], 'readwrite', (t) => {
        const a = t.objectStore('audio');
        for (const c of clips) a.put(c.wav, `${pair.id}|${c.ear}`);
        t.objectStore('pairs').put(pair);
        return pair.id;
      });
    },
    async list({ personId } = {}) { return (await all()).filter((p) => mine(p, personId)).sort((a, b) => b.at - a.at); },
    get(id) { return tx(['pairs'], 'readonly', (t) => req(t.objectStore('pairs').get(id))).then((p) => p || null); },
    audio(id, ear) { return tx(['audio'], 'readonly', (t) => req(t.objectStore('audio').get(`${id}|${ear}`))).then((a) => a || null); },
    update(id, patch = {}) {
      return tx(['pairs'], 'readwrite', async (t) => {
        const s = t.objectStore('pairs');
        const p = await req(s.get(id));
        if (!p) return null;
        const next = { ...p, ...patch, id: p.id };
        s.put(next);
        return next;
      });
    },
    remove(id) {
      return tx(['pairs', 'audio'], 'readwrite', async (t) => {
        const s = t.objectStore('pairs');
        const p = await req(s.get(id));
        if (!p) return false;
        const a = t.objectStore('audio');
        for (const c of p.clips || []) a.delete(`${id}|${c.ear}`);
        s.delete(id);
        return true;
      });
    },
    async count({ personId } = {}) { return (await all()).filter((p) => mine(p, personId)).length; },
    async sweep(now = Date.now()) {
      const gone = [];
      for (const p of await all()) {
        if (!pairExpired(p, now)) continue;
        try { if (await api.remove(p.id)) gone.push(p.id); } catch { /* reported by being still there */ }
      }
      return gone;
    },
    clear() { return tx(['pairs', 'audio'], 'readwrite', (t) => { t.objectStore('pairs').clear(); t.objectStore('audio').clear(); return true; }); },
    close() { if (dbp) dbp.then((db) => db.close()).catch(() => {}); dbp = null; },
  };
  return api;
}

// ---------------------------------------------------------------------------------------
// THE RECORDER
// ---------------------------------------------------------------------------------------
/**
 * `attach(recognizer)` - a ranked recogniser (speech_engines.js) with onUtterance / onCaption /
 * onStatus. `update(row)` - the person's row (or options). While the options say off, events are
 * ignored and nothing is buffered; turning it off drops anything half-heard.
 *
 * state(): { on, attached, listening, recording, saved, paused: null | 'full' | 'failed', pending }
 *   `recording` is what the notice shows: on AND attached to a recogniser that has not stopped.
 */
export function createVoiceRecorder({
  store,
  personId = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  pendingMs = PENDING_MS,
  sweepEveryMs = SWEEP_EVERY_MS,
  rand = Math.random,
  bus = null,
  onChange = null,
  onSaved = null,
} = {}) {
  if (!store) throw new Error('createVoiceRecorder: a store is required');
  let opts = voiceRecordingOptionsFrom({});
  let rec = null;
  let offs = [];
  let listening = false;
  let saved = 0;
  let count = null;                 // pairs in the store for this person, once known
  let paused = null;
  let sweepTimer = null;
  let destroyed = false;
  // *** HELD: SOMETHING ELSE IS TALKING THROUGH THIS ROOM'S SPEAKER. *** (Kiosk wiring, 2026-09-30.)
  // While an intercom is open the recogniser hears the CALLER through the speaker, and a training
  // pair of somebody who is not the person - somebody who never agreed to be recorded - is exactly the
  // pair this file must not keep. `hold(reason, on)`: while any reason holds, nothing new is begun and
  // anything half-heard is DROPPED (not saved - it may already have the caller in it). Reasons, so two
  // holders (an intercom, later a call) cannot release each other's hold.
  const holds = new Set();
  const clips = new Map();          // uid -> { ear, group, frames: [], samples, t0, done, endT }
  const groups = new Map();         // gid -> { caption, final, firstT, uids: Set }
  const writes = new Set();

  const state = () => ({
    on: opts.on, attached: !!rec, listening, recording: opts.on && !!rec && listening && !paused && !holds.size,
    saved, paused, pending: groups.size, count, held: holds.size ? [...holds] : null,
  });
  let lastSig = '';
  function changed() {
    const s = state();
    const sig = JSON.stringify(s);
    if (sig === lastSig) return;
    lastSig = sig;
    try { onChange?.(s); } catch (err) { console.error('voice recording onChange', err); }
    try { bus?.publish?.(VOICE_RECORDING_TOPIC, s); } catch (err) { console.error('voice recording publish', err); }
  }

  function dropAll() { clips.clear(); groups.clear(); }

  function groupOf(gid, t) {
    let g = groups.get(gid);
    if (!g) { g = { caption: null, final: false, firstT: t, uids: new Set() }; groups.set(gid, g); }
    return g;
  }

  function onUtterance(u) {
    if (destroyed || !opts.on || !u || !u.uid) return;
    // Held: nothing begun now is kept, and an utterance that began before the hold was dropped by it.
    if (holds.size) return;
    if (u.type === 'begin') {
      const gid = u.group || `solo:${u.uid}`;
      clips.set(u.uid, { ear: u.ear || 'room', group: gid, frames: [], samples: 0, t0: Number(u.t) || now(), done: false, endT: null });
      groupOf(gid, Number(u.t) || now()).uids.add(u.uid);
      return;
    }
    const c = clips.get(u.uid);
    if (!c) return;
    if (u.type === 'audio' && u.pcm && !c.done) {
      // COPIED: the frame belongs to the audio thread's message and the engines' sockets.
      const f = u.pcm instanceof Int16Array ? u.pcm.slice() : Int16Array.from(u.pcm);
      c.frames.push(f);
      c.samples += f.length;
      return;
    }
    if (u.type === 'cancel') {
      clips.delete(u.uid);
      const g = groups.get(c.group);
      if (g) { g.uids.delete(u.uid); if (!g.uids.size) groups.delete(c.group); }
      return;
    }
    if (u.type === 'end') {
      c.done = true;
      c.endT = Number(u.t) || now();
      maybeSave(c.group);
    }
    staleCheck();
  }

  function onCaption(c) {
    if (destroyed || !opts.on || !c || !c.id || holds.size) return;
    const g = groups.get(c.id);
    if (!g) return;                     // a group begun before recording came on, or already saved
    g.caption = c;
    if (c.final) { g.final = true; maybeSave(c.id); }
    staleCheck();
  }

  function onStatus(s) {
    const was = listening;
    listening = !!s && ['listening', 'blocked'].includes(s.state);
    if (s && s.state === 'stopped') flushPending();
    if (was !== listening) changed();
  }

  function maybeSave(gid, force = false) {
    const g = groups.get(gid);
    if (!g) return;
    const members = [...g.uids].map((uid) => clips.get(uid)).filter(Boolean);
    if (!force && (!g.final || members.some((m) => !m.done))) return;
    groups.delete(gid);
    for (const uid of g.uids) clips.delete(uid);
    const done = members.filter((m) => m.done && m.samples > 0);
    if (!done.length) return;
    const text = String(g.caption?.text || '').trim();
    if (!text && !opts.keepUnclear) return;
    save(g, done, !!g.final);
  }

  function staleCheck() {
    const t = now();
    for (const [gid, g] of [...groups]) {
      const members = [...g.uids].map((uid) => clips.get(uid)).filter(Boolean);
      const allDone = members.length && members.every((m) => m.done);
      const last = Math.max(...members.map((m) => m.endT || 0));
      if (allDone && t - last >= pendingMs) maybeSave(gid, true);
    }
  }

  function flushPending() { for (const gid of [...groups.keys()]) maybeSave(gid, true); dropAll(); }

  function save(g, members, final) {
    if (count !== null && count >= opts.maxPairs) {
      if (paused !== 'full') { paused = 'full'; changed(); }
      return;
    }
    const at = Math.min(...members.map((m) => m.t0));
    const pairClips = [];
    const wavs = [];
    const seenEar = new Map();
    for (const m of members) {
      // One clip per ear; a second utterance from the same ear in one group gets its own name.
      const n = (seenEar.get(m.ear) || 0) + 1;
      seenEar.set(m.ear, n);
      const ear = n > 1 ? `${m.ear}-${n}` : m.ear;
      const flat = new Int16Array(m.samples);
      let o = 0;
      for (const f of m.frames) { flat.set(f, o); o += f.length; }
      pairClips.push({ ear, sampleRate: CLIP_RATE, durationMs: (m.samples / CLIP_RATE) * 1000, offsetMs: m.t0 - at });
      wavs.push({ ear, wav: encodeWav16(flat, CLIP_RATE) });
    }
    const pair = buildPair({ id: newPairId(at, rand), personId, at, caption: g.caption, clips: pairClips,
                             keepDays: opts.keepDays, finalTranscript: final });
    if (count !== null) count += 1;
    const w = Promise.resolve()
      .then(() => store.add(pair, wavs))
      .then(() => {
        saved += 1;
        if (paused === 'failed') paused = null;
        try { onSaved?.(pair); } catch (err) { console.error('voice recording onSaved', err); }
        changed();
      })
      .catch((err) => {
        console.error('voice recording: could not save', err);
        if (count !== null) count -= 1;
        // SAID, not swallowed: the notice changes to "could not save" (a full disk, storage refused).
        paused = 'failed';
        changed();
      })
      .finally(() => writes.delete(w));
    writes.add(w);
  }

  function sweepNow() {
    return Promise.resolve()
      .then(() => store.sweep(now()))
      .then(async (gone) => {
        try { count = await store.count({ personId }); } catch { /* unknown stays unknown */ }
        if (paused === 'full' && count !== null && count < opts.maxPairs) paused = null;
        changed();
        return gone || [];
      })
      .catch((err) => { console.error('voice recording: sweep', err); return []; });
  }
  function armSweep() {
    if (sweepTimer != null || !rec || !opts.on) return;
    sweepTimer = setTimer(() => { sweepTimer = null; sweepNow().finally(armSweep); }, sweepEveryMs);
  }
  function disarmSweep() { if (sweepTimer != null) { try { clearTimer(sweepTimer); } catch { /* gone */ } sweepTimer = null; } }

  function unhook() {
    for (const off of offs) { try { off?.(); } catch { /* gone */ } }
    offs = [];
  }
  function hook() {
    unhook();
    if (!rec || !opts.on) return;
    if (typeof rec.onUtterance === 'function') offs.push(rec.onUtterance(onUtterance));
    if (typeof rec.onCaption === 'function') offs.push(rec.onCaption(onCaption));
    if (typeof rec.onStatus === 'function') offs.push(rec.onStatus(onStatus));
    try { onStatus(rec.status?.()); } catch { listening = false; }
    sweepNow();
    armSweep();
  }

  return {
    /** The person's row (or already-made options). Turning it off drops anything half-heard. */
    update(row = {}) {
      const was = opts.on;
      opts = voiceRecordingOptionsFrom(row);
      if (paused === 'full' && count !== null && count < opts.maxPairs) paused = null;
      if (was && !opts.on) { unhook(); disarmSweep(); dropAll(); listening = false; paused = null; }
      if (!was && opts.on) hook();
      changed();
    },
    /** A recogniser to listen to. Only a ranked recogniser has utterances; any other is ignored. */
    attach(recognizer) {
      if (rec === recognizer) return;
      this.detach();
      rec = recognizer && typeof recognizer.onUtterance === 'function' ? recognizer : null;
      hook();
      changed();
    },
    detach() {
      if (!rec) return;
      flushPending();
      unhook();
      disarmSweep();
      rec = null;
      listening = false;
      changed();
    },
    /**
     * Stop keeping anything while `reason` holds (an open intercom: the recogniser would hear the
     * caller). Taking a hold DROPS whatever is half-heard; releasing the last one resumes. The notice
     * goes while held - it is not recording - and comes back by itself.
     */
    hold(reason = 'hold', on = true) {
      const r = String(reason || 'hold');
      const had = holds.size;
      if (on) holds.add(r); else holds.delete(r);
      if (!had && holds.size) dropAll();
      changed();
      return holds.size > 0;
    },
    /** Whose recordings these are (the screen learns its person after it starts). */
    setPersonId(id) {
      if ((id || null) === personId) return;
      personId = id || null;
      count = null;
      if (rec && opts.on) sweepNow();
    },
    state,
    options: () => ({ ...opts }),
    sweep: sweepNow,
    /** Resolves when every write in flight has landed (tests; a page about to close). */
    settle: () => Promise.allSettled([...writes]),
    destroy() { this.detach(); destroyed = true; dropAll(); },
  };
}

// ---------------------------------------------------------------------------------------
// THE NOTICE. "Recording voice for training", while it is. Non-modal, no presses. NO SETTING HIDES IT.
// ---------------------------------------------------------------------------------------

/** The words, from the recorder's state. Pure. '' = nothing to show. */
export function recordingText(s = {}) {
  if (!s.on || !s.attached) return '';
  if (s.paused === 'full') return 'Voice recording paused: this screen has kept as many as it may';
  if (s.paused === 'failed') return 'Voice recording could not save';
  // Held (an intercom is open): not recording, so nothing to say - the intercom's own notice is up.
  if (s.held && s.held.length) return '';
  if (!s.listening) return '';
  return 'Recording voice for training';
}

export function mountRecordingIndicator(host, {
  recorder = null,
  bus = null,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!host || !doc) throw new Error('mountRecordingIndicator: a host element is required');
  const el = doc.createElement('div');
  el.className = 'live-note rec-live';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const dot = doc.createElement('span');
  dot.className = 'ml-dot';
  dot.setAttribute('aria-hidden', 'true');
  const word = doc.createElement('span');
  word.className = 'ml-word';
  el.append(dot, word);
  noticeStack(host, doc).append(el);
  function show(s) {
    const t = recordingText(s || {});
    word.textContent = t;
    el.hidden = !t;
    el.dataset.phase = s && s.paused ? 'paused' : 'live';
  }
  show(recorder ? recorder.state() : {});
  const offBus = bus && typeof bus.subscribe === 'function' ? bus.subscribe(VOICE_RECORDING_TOPIC, (s) => show(s)) : () => {};
  return {
    shown: () => !el.hidden,
    text: () => word.textContent,
    refresh() { show(recorder ? recorder.state() : {}); },
    destroy() { try { offBus(); } catch { /* gone */ } el.remove(); },
  };
}

// ---------------------------------------------------------------------------------------
// EXPORT: the pairs, as files, into a folder somebody picked (fs_sink.js's discipline: a folder per
// pair, the audio first and the manifest LAST, so an interrupted export leaves audio with no manifest
// rather than a manifest promising files that are not there).
// ---------------------------------------------------------------------------------------
export function pairFolderName(pair) {
  const d = new Date(Number(pair.at) || 0);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `voice-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(pair.id).slice(-8)}`;
}

export async function exportPairs(dir, store, { personId, onlyReviewed = false } = {}) {
  if (!dir) throw new Error('exportPairs: no folder');
  const pairs = (await store.list({ personId })).filter((p) => !onlyReviewed || p.reviewed);
  const written = [];
  const failed = [];
  for (const p of pairs) {
    try {
      const sub = await dir.getDirectoryHandle(pairFolderName(p), { create: true });
      for (const c of p.clips || []) {
        const wav = await store.audio(p.id, c.ear);
        if (!wav) continue;
        const fh = await sub.getFileHandle(c.file, { create: true });
        const w = await fh.createWritable();
        try { await w.write(wav); } finally { await w.close(); }
      }
      const fh = await sub.getFileHandle('pair.json', { create: true });
      const w = await fh.createWritable();
      try { await w.write(JSON.stringify(p, null, 2)); } finally { await w.close(); }
      written.push(p.id);
    } catch (err) { console.error('voice export', err); failed.push(p.id); }
  }
  return { written, failed };
}
