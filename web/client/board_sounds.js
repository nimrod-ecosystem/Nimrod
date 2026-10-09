// board_sounds.js - A CARD'S OWN SOUND: a word somebody recorded, or a sound file they chose, for a board they made
// (own board clips, 2026-10-09).
//
// Mike, 2026-10-09: "There should be an easy way for people to do this with their own custom boards." The seventeen
// shipped clips (aac/audio, Piper) only cover seventeen words, and only in one voice. A person's own board has their
// own words. So, in the board editor, per card: "Record this word", "Use a sound file", "Remove the sound". The card
// then says its word in that sound in the room, and the same sound goes into a call (call_mix.js), the way a shipped
// clip does.
//
// ---------------------------------------------------------------------------------------
// *** WHERE A CARD'S SOUND LIVES, AND WHERE IT DOES NOT ***
// ---------------------------------------------------------------------------------------
//
//   1. ON THIS DEVICE, always: this browser's IndexedDB (`nimrod-board-sounds`), the same way device_pictures.js keeps
//      a picture added from this device. Works in every browser, needs no permission, never lapses after a restart.
//   2. IN THE PERSON'S NIMROD FOLDER, when there is one on this device: "Board sounds" (user_folders.js SUBFOLDERS),
//      written at the moment somebody presses Keep (a press is the only time the browser lets a page write there).
//      That copy is what lets ANOTHER device that has the same folder (a synced folder, a USB drive) play it.
//   3. NEVER ON OUR SERVER. The board itself is saved in the person's settings row, and what a card carries there is
//      a NAME - `sound: { file: 'thank_you-lq3k2a.webm', from: 'recorded' }` - never the sound. storage_line.py
//      refuses a sound inside a row (rule 2: `data:audio/`, or a long base64 run) and test_storage_line.py proves it
//      for a board row. There is no fetch, no FormData and no upload in this file; board_sounds_test.html checks the
//      source and counts requests.
//
// A SECOND DEVICE WITHOUT THE FILE (the board arrived through the settings row, the sound did not): the card is
// looked up in this device's store, then this device's Nimrod folder; not found, it falls back exactly as a card
// with no sound does today - the shipped clip if its word is one of the seventeen, else the browser's voice. Nothing
// errors and nothing is shown over the card. A file found in the folder is also copied into this device's store, so
// it keeps playing after a restart, when the folder's permission has lapsed.
//
// THE LOOKUP ORDER, one function (`clipChoices`) so the room and the call cannot disagree:
//   the card's own sound -> the shipped clip by the naming rule (aac_clips.js) -> the browser's voice.
//
// ---------------------------------------------------------------------------------------
// *** WHOSE VOICE ***
// ---------------------------------------------------------------------------------------
//
// voice_recording.js's rules, applied to a recorder somebody starts on purpose: nothing records until a press says so
// (there is no recording in the background, and nothing here listens unless "Start recording" was pressed); the
// screen says it is recording while it is, and it stops by itself (MAX_RECORD_MS) so a recorder nobody stops cannot
// keep a microphone open; nothing is kept until somebody presses Keep, after they have heard it back; nothing goes to
// our server. The editor says, next to the button that starts it, whose voice to record: the person the board speaks
// for, or somebody they have said may lend their voice. voice_recording.js's recorder itself is NOT reused, argued:
// it never opens a microphone (its rule 1) - it only keeps what the speech recogniser already cut - so it cannot do
// "press to start, press to stop". The microphone is opened through the screen's arbiter (mic_owner.js) when there
// is one, so a recogniser already listening shares it rather than losing it.

import { clipSlug, clipUrl } from './aac_clips.js';
import { SOUND_EXTS, SOUND_FROM, SOUND_NAME_MAX, cleanSoundRef } from './aac_vocab.js';
import { CLIP_MAX_MS } from './call_mix.js';
import { SUBFOLDERS, kindFolder, allowAgain, subfolder, handleStore } from './user_folders.js';

export const SOUND_KIND = 'boardSounds';
export const SOUND_FOLDER = SUBFOLDERS[SOUND_KIND] || 'Board sounds';

// *** THE NUMBERS, ARGUED (Rule 1). None is a menu row: nobody can judge them from a menu. ***
//
// The longest a recording runs before it stops by itself: 8 seconds, THE SAME NUMBER the call mixer cuts a clip at
// (call_mix.js CLIP_MAX_MS, imported, so the two cannot drift). A card is a word or a short phrase; the longest
// shipped clip is under 2 s. For longer: somebody's whole sentence ("Can you call my sister, please") - it would
// still play in full in the room, but a call would cut it at 8 s, so a recording longer than a call carries would be
// a promise the call breaks. For shorter: a person whose speech is slow and effortful needs the time. It is also the
// one thing that makes sure a microphone somebody forgot to stop is closed again.
export const MAX_RECORD_MS = CLIP_MAX_MS;
// The biggest sound file "Use a sound file" takes: 5 MB. Eight seconds of the largest ordinary file (uncompressed
// 48 kHz stereo 24-bit WAV) is 2.3 MB; an 8-second MP3 is about 130 KB. 5 MB takes any of those with room to spare
// and refuses what is plainly not a word - a whole song or an album track (40-60 MB) - before it fills this
// device's storage. For bigger: a long sound effect somebody really wants on a card (it would play in the room; a call
// would still cut it at 8 s). For smaller: a phone's storage. One number.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
// The longest name a card's sound may carry (aac_vocab.js SOUND_NAME_MAX): a word's slug (60 at most) plus a stamp and
// an extension.
export const FILE_NAME_MAX = SOUND_NAME_MAX;
const SLUG_MAX = 60;

// What counts as a sound file, by extension (aac_vocab.js SOUND_EXTS): what browsers play - the music extensions, plus
// the two a browser's own recorder makes (webm, ogg/opus) and what a phone's voice memo app makes (m4a).
export { SOUND_EXTS, cleanSoundRef };
const TYPE_EXT = Object.freeze({
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/vnd.wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
});
export const FROM = SOUND_FROM;

const extOfName = (name) => {
  const s = String(name || '').toLowerCase();
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(dot + 1) : '';
};

/** Is this file a sound? By its type first, then by its name. */
export function isSoundFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.toLowerCase().startsWith('audio/')) return true;
  return SOUND_EXTS.includes(extOfName(file.name));
}

/** The extension a sound is kept under: its name's when that is a sound's, else its type's, else webm. Pure. */
export function soundExt({ type = '', name = '' } = {}) {
  const fromName = extOfName(name);
  if (SOUND_EXTS.includes(fromName)) return fromName;
  const base = String(type || '').toLowerCase().split(';')[0].trim();
  return TYPE_EXT[base] || 'webm';
}

/**
 * The file a card's sound is kept as: the word's slug (the shipped clips' own naming rule, aac_clips.js), a stamp,
 * and the extension. "Thank you" -> "thank_you-lq3k2a.webm". Pure.
 * THE STAMP, argued: two cards with the same word (on two people's boards on one screen, or a re-recording) must not
 * overwrite each other's sound in a shared folder; the slug keeps it readable in a file manager.
 */
export function soundFileName(word, ext = 'webm', now = Date.now()) {
  const slug = (clipSlug(word) || 'word').slice(0, SLUG_MAX).replace(/_+$/, '') || 'word';
  const e = SOUND_EXTS.includes(String(ext).toLowerCase()) ? String(ext).toLowerCase() : 'webm';
  return `${slug}-${Math.max(0, Math.floor(Number(now) || 0)).toString(36)}.${e}`;
}

/** Every sound file a board's cards name (a Set). Pure. */
export function soundFilesOf(board) {
  const out = new Set();
  for (const c of (board && Array.isArray(board.cells) ? board.cells : [])) {
    const r = c && cleanSoundRef(c.sound);
    if (r) out.add(r.file);
  }
  return out;
}

/**
 * THE LOOKUP ORDER, the one place it is written. The clips to try for a card, best first; the browser's voice is what
 * is left when none of them plays. Pure.
 *   own        the card's own sound as a URL this page can play (from `createBoardSounds().url`), or null.
 *   base       where the shipped clips are (aac_clips.js). '' or null: no shipped clips.
 *   shipped    false: skip the shipped clips (the board's `shippedClips` setting).
 */
export function clipChoices({ text = '', own = null, base = null, shipped = true } = {}) {
  const out = [];
  if (typeof own === 'string' && own) out.push({ url: own, from: 'own' });
  const s = shipped !== false ? clipUrl(text, base) : null;
  if (s) out.push({ url: s, from: 'shipped' });
  return out;
}

// ---------------------------------------------------------------------------------------
// THE STORE: this device, then the Nimrod folder.
// ---------------------------------------------------------------------------------------

const DB_NAME = 'nimrod-board-sounds';
const STORE = 'sounds';
const idbOf = (idb) => idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);

function openDb({ idb, dbName = DB_NAME } = {}) {
  const db = idbOf(idb);
  if (!db) return Promise.reject(new Error('This browser has no storage for sounds.'));
  return new Promise((resolve, reject) => {
    const req = db.open(dbName, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'file' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn, opts) {
  const db = await openDb(opts);
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

/**
 * The sounds of the boards on this device.
 *
 *   keep(blob, { word, from, name })  keep a sound for a card; FROM A PRESS (it may ask the browser to let this page
 *                                     write into the Nimrod folder again). Resolves
 *                                     { file, from, device: true, folder: 'saved' | 'no-folder' | 'not-allowed' | 'failed' }.
 *                                     Throws (with a sentence) only when this device could not keep it.
 *   url(file)                         { url, release, where: 'device' | 'folder' } or null. NEVER PROMPTS.
 *   has(file)                         on this device?
 *   remove(file)                      off this device. The Nimrod folder's copy is left alone (see `remove`).
 *
 * `store` is user_folders.js's handle store (a Map-backed fake in the suite), `folder: false` turns the Nimrod folder
 * off entirely (a page with no folders), `makeUrl`/`dropUrl` are URL.createObjectURL/revokeObjectURL.
 */
export function createBoardSounds({
  idb, dbName,
  store = null,
  folder = true,
  names = SUBFOLDERS,
  now = () => Date.now(),
  makeUrl = (b) => URL.createObjectURL(b),
  dropUrl = (u) => { try { URL.revokeObjectURL(u); } catch { /* gone */ } },
} = {}) {
  const opts = { idb, dbName };
  let handles = store;
  const handlesNow = () => {
    if (handles || !folder) return handles;
    try { handles = handleStore(); } catch { handles = null; }
    return handles;
  };

  async function deviceRow(file) {
    try { return (await run('readonly', (s) => s.get(String(file || '')), opts)) || null; } catch { return null; }
  }
  async function putDevice(row) {
    await run('readwrite', (s) => s.put(row), opts);
  }

  // The folder to READ from now, or null. Never prompts (kindFolder never does).
  async function readDir() {
    const h = handlesNow();
    if (!h) return null;
    try { const k = await kindFolder(SOUND_KIND, { store: h, names }); return k.dir || null; } catch { return null; }
  }

  // The folder to WRITE into. From a press: asks the browser again when it has to.
  async function writeDir() {
    const h = handlesNow();
    if (!h) return { why: 'no-folder' };
    let k;
    try { k = await kindFolder(SOUND_KIND, { store: h, names }); } catch { return { why: 'no-folder' }; }
    if (!k || k.source === 'none' || !k.holder) return { why: 'no-folder' };
    const permission = await allowAgain(k.holder, 'readwrite');
    if (permission !== 'granted') return { why: 'not-allowed' };
    if (k.source === 'own') return { dir: k.holder };
    let dir = await subfolder(k.holder, SOUND_KIND, { names });
    if (!dir) {
      try { dir = await k.holder.getDirectoryHandle(names[SOUND_KIND] || SOUND_FOLDER, { create: true }); } catch { dir = null; }
    }
    return dir ? { dir } : { why: 'failed' };
  }

  async function writeFolder(file, blob) {
    if (!folder) return 'no-folder';
    try {
      const w = await writeDir();
      if (!w.dir) return w.why || 'failed';
      const fh = await w.dir.getFileHandle(file, { create: true });
      const out = await fh.createWritable();
      try { await out.write(blob); } finally { await out.close(); }
      return 'saved';
    } catch { return 'failed'; }
  }

  return {
    async keep(blob, { word = '', from = 'recorded', name = '' } = {}) {
      if (!blob || !(Number(blob.size) > 0)) throw new Error('There is no sound to keep.');
      if (Number(blob.size) > MAX_FILE_BYTES) {
        throw new Error(`That sound is ${Math.round(blob.size / 1024 / 1024)} MB; the most a card can have is ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
      }
      const file = soundFileName(word, soundExt({ type: blob.type, name }), now());
      const how = FROM.includes(from) ? from : 'recorded';
      try {
        await putDevice({ file, word: String(word || ''), from: how, name: String(name || ''), type: blob.type || '',
          size: Number(blob.size) || 0, blob, added_at: Number(now()) });
      } catch (err) {
        throw new Error(`This device could not keep it${err && err.name === 'QuotaExceededError' ? ': its storage is full' : ''}.`);
      }
      // The folder copy, started here (still inside the press) so the browser lets it ask.
      const where = await writeFolder(file, blob);
      return { file, from: how, device: true, folder: where };
    },

    async url(file) {
      const f = cleanSoundRef({ file })?.file;
      if (!f) return null;
      const row = await deviceRow(f);
      if (row && row.blob) {
        const url = makeUrl(row.blob);
        return { url, where: 'device', release: () => dropUrl(url) };
      }
      const dir = await readDir();
      if (!dir) return null;
      let blob = null;
      try { blob = await (await dir.getFileHandle(f)).getFile(); } catch { blob = null; }
      if (!blob) return null;
      // Kept on this device too, so it still plays after a restart when the folder's permission has lapsed.
      try { await putDevice({ file: f, word: '', from: 'file', name: f, type: blob.type || '', size: Number(blob.size) || 0, blob, added_at: Number(now()) }); }
      catch { /* storage full: it still plays now */ }
      const url = makeUrl(blob);
      return { url, where: 'folder', release: () => dropUrl(url) };
    },

    async has(file) { return !!(await deviceRow(file)); },

    // *** ONLY THIS DEVICE'S COPY. *** The Nimrod folder is the person's own: another device may have a board that
    // still uses the same file, and a site deleting files from somebody's folder is a surprise nobody asked for.
    // A sound nobody uses any more stays there until somebody deletes it by hand (a few KB each).
    async remove(file) {
      try { await run('readwrite', (s) => s.delete(String(file || '')), opts); return { ok: true }; }
      catch { return { ok: false }; }
    },
  };
}

// ---------------------------------------------------------------------------------------
// THE RECORDER: press to start, press to stop, and it stops by itself.
// ---------------------------------------------------------------------------------------

const CONSUMER = 'board-word';

/**
 * One word, recorded. `micOwner` (mic_owner.js) when the page has the screen's arbiter, else `getUserMedia`;
 * `Recorder` is MediaRecorder (a fake in the suite).
 *   start({ onStop })  opens the microphone and records; resolves true, or throws with a sentence.
 *   stop()             resolves the recording (a Blob) or null.
 *   cancel()           stops and throws the recording away.
 *   state()            'idle' | 'starting' | 'recording' | 'done' | 'failed'
 * It stops by itself after `maxMs` and calls `onStop(blob)`. Either way the microphone is let go.
 */
export function createWordRecorder({
  micOwner = null,
  getUserMedia = () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
  Recorder = (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null),
  maxMs = MAX_RECORD_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  let state = 'idle';
  let rec = null;
  let stream = null;
  let viaOwner = false;
  let chunks = [];
  let timer = null;
  let finished = null;
  let onDone = null;
  let keep = true;

  function letGo() {
    if (viaOwner) { try { micOwner.release(CONSUMER, true); } catch { /* gone */ } }
    else if (stream) { for (const t of stream.getTracks?.() || []) { try { t.stop(); } catch { /* stopped */ } } }
    stream = null; viaOwner = false;
  }

  const api = {
    state: () => state,
    async start({ onStop = null } = {}) {
      if (state === 'starting' || state === 'recording') return false;
      if (!Recorder) { state = 'failed'; throw new Error('This browser cannot record sound. Use a sound file instead.'); }
      state = 'starting';
      onDone = onStop; keep = true; chunks = [];
      try {
        if (micOwner && typeof micOwner.acquire === 'function') { stream = await micOwner.acquire(CONSUMER, null); viaOwner = true; }
        else stream = await getUserMedia();
      } catch {
        letGo(); state = 'failed';
        throw new Error('The microphone could not be opened. Check that this browser may use it, or use a sound file.');
      }
      if (state !== 'starting') { letGo(); return false; }      // cancelled while it was opening
      try {
        rec = new Recorder(stream);
        rec.ondataavailable = (e) => { if (e && e.data && e.data.size) chunks.push(e.data); };
        finished = new Promise((resolve) => {
          rec.onstop = () => {
            if (timer != null) { clearTimer(timer); timer = null; }
            const type = (rec && rec.mimeType) || (chunks[0] && chunks[0].type) || 'audio/webm';
            const blob = keep && chunks.length ? new Blob(chunks, { type }) : null;
            letGo();
            state = 'done';
            resolve(blob);
            const cb = onDone; onDone = null;
            if (cb && keep) { try { cb(blob); } catch (err) { console.error('board word recorder', err); } }
          };
        });
        rec.start();
      } catch {
        letGo(); state = 'failed';
        throw new Error('This browser could not start recording. Use a sound file instead.');
      }
      state = 'recording';
      timer = setTimer(() => { timer = null; api.stop(); }, maxMs);
      return true;
    },
    stop() {
      if (state === 'starting') { state = 'idle'; letGo(); return Promise.resolve(null); }
      if (state !== 'recording') return finished || Promise.resolve(null);
      if (timer != null) { clearTimer(timer); timer = null; }
      try { rec.stop(); } catch { letGo(); state = 'done'; return Promise.resolve(null); }
      return finished;
    },
    cancel() { keep = false; onDone = null; return api.stop(); },
  };
  return api;
}
