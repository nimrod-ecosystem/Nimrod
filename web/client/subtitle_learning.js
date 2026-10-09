// subtitle_learning.js — SUBTITLES THAT LEARN FROM BEING CORRECTED (2026-10-09).
//
// Mike, 2026-10-09: *"Can the subtitles learn, if I correct what they're saying? Like 'What I/they said was...'"*
//
// ---------------------------------------------------------------------------------------
// THE CORRECTION: BY VOICE OR BY HAND, AND THE LINE IS REPLACED ON SCREEN
// ---------------------------------------------------------------------------------------
//
//   * BY VOICE: "computer please, what I said was Rosalind" (input_speech.js FIX_PHRASES: a prefix with free words
//     after it, like "make a note", said to the screen). 'fix-self' corrects the newest line in the speaker's OWN
//     voice; 'fix-other' ("what they / he / she said was") the newest line in somebody else's. The prefix ALONE
//     ("computer please, what I said was" ... a pause ... "Rosalind") opens a ONE-UTTERANCE window for the words,
//     the same as "ask <name>" alone - on an engine that can write a free sentence down. On one that cannot (a
//     Vosk-class grammar engine), the "Fix a line" panel opens instead, to type it.
//   * BY HAND: "Fix a subtitle line" (a menu item, and the `subtitles/fix` action a switch or key can be bound to).
//     The subtitles themselves never take a press (subtitles.js: pointer-events none, so they can never sit over a
//     game's answer and steal it), so the panel lists the last few lines; pick one, then type what it said or pick
//     one of the other readings the recognisers had for it (each pass and each ear: the nearest thing to an
//     engine's n-best that this pipeline has - faster-whisper is asked for one transcript, Vosk's alternatives are
//     not requested, and the browser's own are not carried to captions).
//   Either way the line is replaced IN PLACE (subtitles.js `fix`), and a later recogniser pass never draws over it.
//
// ---------------------------------------------------------------------------------------
// WHAT "LEARN" MEANS, IN LAYERS - WHAT EACH ONE DOES TODAY
// ---------------------------------------------------------------------------------------
//
//   (a) RIGHT AWAY - a list per PERSON, on this device:
//       * WORDS IT MISSED: the words a correction put in that the recogniser did not hear (names, places), minus
//         common little words. Sent to every recogniser that can USE them (speech_engines.js `setHints` ->
//         speech_service `hints`): faster-whisper's `hotwords` (a prompt, so likelier, never forced). Vosk gets
//         NOTHING (its API has no "lean towards"; its grammar LIMITS hearing to a list - backends.py says why), so
//         on the Pi the next layer is what helps.
//       * "HEARD X, MEANT Y": a replacement map applied to what is written on the screen, for the person whose line
//         it was (a named voice) or for everybody on this screen (a line nobody's voice was named on). Applied
//         after the same fix has been made `fixAfter` times (a setting; 2 by default, argued at LEARNING_DEFAULTS),
//         never for a lone common word. A person fixing a learned fix BACK un-learns it.
//   (b) OVER TIME: when that person's voice is being recorded for training (voice_recording.js - their own opt-in,
//       on this device, never the server), the recording the corrected line came from gets what was meant
//       (`withCorrection`), and goes out in the same Euphonia export (data/0..N-1) web/tools/train_my_voice.py
//       trains on. Only when the voice was named as that person; otherwise it waits in "To review" first.
//   (c) SPEAKER-AWARE: the corrected line's speaker (voice_id.js) decides whose list learns. "I" and "they" only
//       choose WHICH line.
//
// ---------------------------------------------------------------------------------------
// WHERE IT LIVES (row 2.58, the storage line)
// ---------------------------------------------------------------------------------------
//
// This browser's IndexedDB on this screen (`nimrod-learned-words`), one record per person - the same kind of home as
// voice recordings and play history. "Save a copy to my Nimrod folder" writes it to the Data subfolder (a press, so
// the browser lets the page write there). NEVER the server: the records carry `format: "nimrod-learned-words"`, and
// web/server/storage_line.py rule 6 refuses one anywhere (state, events, history) - names of the people in
// somebody's life and the way their speech is misheard are theirs. "Words it has learned" (the person's settings)
// shows every word and fix, each deletable, and "Forget everything it learned".

import {
  FIX_PHRASES, SPEECH_ASK_TARGET_TOPIC, SPEECH_ASK_TOPIC, SPEECH_GRAMMAR_TOPIC, SPEECH_ANSWER_TOPIC, UNKNOWN_WORD,
} from './input_speech.js';
import { withCorrection } from './voice_recording.js';
import { recallRoot, subfolder, allowAgain, ROOT_MODE } from './user_folders.js';

export const LEARNED_FORMAT = 'nimrod-learned-words';
export const LEARNED_DB = 'nimrod-learned-words';
export const LEARNED_VERSION = 1;
// The shared record: lines nobody's voice was named on. '' is a valid IndexedDB key.
export const ROOM_KEY = '';
// The id the speech layer knows this by (its ask and answer topics are `<topic>#<this>`).
export const FIX_TARGET = 'subtitles-fix';
export const FIX_SOURCE = 'subtitles';
export const SUBTITLES_FIX_TOPIC = 'subtitles/fix';
export const SUBTITLES_WORDS_TOPIC = 'subtitles/learned-words';
export const SUBTITLES_FIXED_TOPIC = 'subtitles/fixed';
// The action a switch or key can be bound to (the kiosk registers it beside subtitles.js's SUBTITLE_ACTIONS).
export const SUBTITLE_LEARNING_ACTIONS = [
  { id: 'subtitles/fix', label: 'Subtitles: fix a line', topic: SUBTITLES_FIX_TOPIC, group: 'Spoken' },
];

export const LEARNING_DEFAULTS = Object.freeze({
  // ON, argued: it does nothing at all until somebody corrects a line, and a correction is a deliberate act. FOR
  // off: a screen's owner may not want anything about the way people talk kept, even on this device. A switch.
  learn: true,
  // A "heard X, meant Y" fix is applied once the same fix has been made this many times. 2, ARGUED: FOR 1 - Mike's
  // "learn" reads as "next time, get it right", and a name misheard once will be misheard again. FOR 2 (chosen): a
  // replacement map is a blunt rewrite of every line, and one correction cannot tell a SYSTEMATIC mishearing (a
  // name, the same way every time) from a one-off in a noisy moment ("top" for "shop" once rewrites every "top").
  // The same fix twice is cheap evidence it is systematic. Whisper's hint list (below) still takes the word at the
  // FIRST correction, so on a desktop recogniser the very next sentence already leans towards it.
  fixAfter: 2,
  // Send the learned words to the recognisers that can use them. ON: an empty list (nobody corrected anything)
  // sends nothing. FOR off: it is a prompt, and a prompt can pull words onto silence (measured 2026-09-30 for a
  // COMMAND prompt - see backends.hint_text); somebody who sees names appear from nowhere turns it off.
  hints: true,
});
export const FIX_AFTER_CHOICES = Object.freeze([1, 2, 3, 0]);

// NOT settings, argued (plumbing nobody in a room can judge):
// "What I said was" means something just said: the newest lines, and not older than this.
export const FIX_LOOKBACK_LINES = 12;
export const FIX_LOOKBACK_MS = 3 * 60 * 1000;
// A fix is a few words each side - a misheard name or phrase. Longer runs are a different sentence, not a mishearing.
export const FIX_SPAN_MAX = 4;
// Per person. 200 words / 200 fixes is a family's names and places many times over; past it the least used go.
// The recognisers are sent at most HINTS_MAX (speech_service HINTS_MAX keeps the same number).
export const WORDS_MAX = 200;
export const FIXES_MAX = 200;
export const HINTS_MAX = 40;
export const WORD_CHARS_MAX = 40;
// The one-utterance window for the words after "what I said was" alone, when the speech layer gives none (ms).
export const LISTEN_MS = 8000;
// The panels go by themselves after this long with nothing pressed: never a state only an input can leave.
export const PANEL_IDLE_MS = 60000;
// A recording is saved a moment AFTER its line is final; a correction that arrives first looks again.
export const PAIR_RETRY_MS = Object.freeze([3000, 10000, 30000]);

// The little words a list of names has no use for, and that a replacement map must never rewrite on its own: the
// ~120 most frequent English function words [training knowledge]. Not a lexicon - just the words that would do the
// most damage as a blanket rewrite.
export const COMMON_WORDS = new Set(('a an the and or but if so of to in on at by for from with about as into onto '
  + 'over under up down out off i me my mine you your yours he him his she her hers it its we us our they them their '
  + 'this that these those there here what which who whom whose when where why how is am are was were be been being '
  + 'do does did done have has had having will would shall should can could may might must not no yes ok okay oh '
  + "all any some each every much many more most few just only very too also then than now well good back again "
  + "go going went get got say said see saw know like want come came make made take took think let let's "
  + "i'm i've i'll i'd you're you've you'll it's that's there's don't didn't can't won't isn't wasn't um uh yeah"
).split(/\s+/).filter(Boolean));

export const SUBTITLE_LEARNING_FIELDS = [
  { key: 'subtitlesLearn', label: 'Subtitles: learn from corrections', kind: 'toggle',
    default: LEARNING_DEFAULTS.learn, level: 'standard',
    note: 'Say "what I said was ..." (or "what they said was ...") after the wake phrase, or use "Fix a subtitle line". '
        + 'The words it missed are kept on this screen, never on this site.' },
  { key: 'subtitlesFixAfter', label: 'Subtitles: fix a word it keeps mishearing', kind: 'choice',
    default: LEARNING_DEFAULTS.fixAfter, level: 'advanced',
    options: [
      { value: 1, label: 'After one correction' },
      { value: 2, label: 'After the same correction twice' },
      { value: 3, label: 'After the same correction three times' },
      { value: 0, label: 'Never: only fix the line I corrected' },
    ],
    note: 'Rewrites what it heard to what you said it was, from then on.' },
  { key: 'subtitlesHints', label: 'Subtitles: tell the recogniser the words it learned', kind: 'toggle',
    default: LEARNING_DEFAULTS.hints, level: 'advanced',
    note: 'Only recognisers that can use a word list (on this computer, or another computer chosen above).' },
];

/** A settings row -> { learn, fixAfter, hints }. Each unset or broken key is its default. Pure. */
export function learningOptionsFrom(values = {}) {
  const v = values || {};
  const n = Number(v.subtitlesFixAfter);
  return {
    learn: typeof v.subtitlesLearn === 'boolean' ? v.subtitlesLearn : LEARNING_DEFAULTS.learn,
    fixAfter: v.subtitlesFixAfter !== null && v.subtitlesFixAfter !== '' && typeof v.subtitlesFixAfter !== 'boolean'
      && FIX_AFTER_CHOICES.includes(n) ? n : LEARNING_DEFAULTS.fixAfter,
    hints: typeof v.subtitlesHints === 'boolean' ? v.subtitlesHints : LEARNING_DEFAULTS.hints,
  };
}

// ---------------------------------------------------------------------------------------
// THE PURE PARTS: what a correction teaches, and applying it
// ---------------------------------------------------------------------------------------
const keyOf = (w) => String(w || '').toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '');
const tokens = (s) => String(s || '').split(/\s+/).filter(Boolean).slice(0, 200);
const cleanWord = (w) => String(w || '').replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '').slice(0, WORD_CHARS_MAX);

/**
 * What the recogniser wrote against what was meant, as the runs that differ: [{ heard: [...], meant: [...] }].
 * A longest-common-subsequence alignment on lowercase words, so "I'm seeing Kristen today" against "I'm seeing
 * Rosalind today" is one run, ["Kristen"] -> ["Rosalind"]. Pure.
 */
export function diffRuns(heard, meant) {
  const a = tokens(heard), b = tokens(meant);
  const ka = a.map(keyOf), kb = b.map(keyOf);
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = ka[i] && ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const runs = [];
  let cur = null;
  const flush = () => { if (cur && (cur.heard.length || cur.meant.length)) runs.push(cur); cur = null; };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] && ka[i] === kb[j]) { flush(); i++; j++; continue; }
    cur = cur || { heard: [], meant: [] };
    if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { cur.meant.push(b[j]); j++; }
    else { cur.heard.push(a[i]); i++; }
  }
  flush();
  return runs;
}

/**
 * What one correction teaches: { words: [missed words], fixes: [{ from, to }] }. Pure.
 *   words  every word the correction put in that the recogniser did not hear, minus COMMON_WORDS and anything
 *          with no letter - so a name is learned and "the" is not;
 *   fixes  each run where the recogniser heard SOMETHING else (both sides non-empty, at most FIX_SPAN_MAX words
 *          each): the lowercase words it heard -> the words as the person gave them. A run where it heard nothing
 *          teaches only words (nothing to replace); a run where it heard words that were never said teaches
 *          nothing (a rule that deletes words is not one to apply to every line).
 */
export function lessonsFrom(heard, meant) {
  const words = [];
  const fixes = [];
  for (const r of diffRuns(heard, meant)) {
    for (const t of r.meant) {
      const w = cleanWord(t);
      if (w.length >= 2 && /\p{L}/u.test(w) && !COMMON_WORDS.has(w.toLowerCase())
          && !words.some((x) => x.toLowerCase() === w.toLowerCase())) words.push(w);
    }
    if (r.heard.length && r.meant.length && r.heard.length <= FIX_SPAN_MAX && r.meant.length <= FIX_SPAN_MAX) {
      const from = r.heard.map(keyOf).filter(Boolean).join(' ');
      const to = r.meant.map(cleanWord).filter(Boolean).join(' ');
      if (from && to && from !== to.toLowerCase()) fixes.push({ from, to });
    }
  }
  return { words, fixes };
}

/** An empty record for one person ('' = everybody on this screen whose voice was not named). */
export function emptyRecord(key = ROOM_KEY, name = '') {
  return { format: LEARNED_FORMAT, v: LEARNED_VERSION, key: String(key ?? ''), name: String(name || ''),
           words: [], fixes: [], updatedAt: 0 };
}

/** A stored record made safe to read (an older or damaged one never throws). Pure. */
export function cleanRecord(r, key = ROOM_KEY) {
  const out = emptyRecord(r && typeof r.key === 'string' ? r.key : key, r && r.name);
  if (!r || typeof r !== 'object') return out;
  out.updatedAt = Number(r.updatedAt) || 0;
  for (const x of Array.isArray(r.words) ? r.words : []) {
    const w = cleanWord(x && x.w);
    if (w && !out.words.some((y) => y.w.toLowerCase() === w.toLowerCase())) out.words.push({ w, n: Math.max(1, Math.round(Number(x.n) || 1)), at: Number(x.at) || 0 });
  }
  for (const x of Array.isArray(r.fixes) ? r.fixes : []) {
    const from = tokens(x && x.from).map(keyOf).filter(Boolean).join(' ');
    const to = String((x && x.to) || '').trim().slice(0, 200);
    if (from && to && !out.fixes.some((y) => y.from === from)) out.fixes.push({ from, to, n: Math.max(1, Math.round(Number(x.n) || 1)), at: Number(x.at) || 0 });
  }
  return out;
}

const trim = (list, max) => {
  if (list.length <= max) return list;
  // The least used, then the oldest, go first.
  return [...list].sort((p, q) => (q.n - p.n) || (q.at - p.at)).slice(0, max);
};

/**
 * A record after one correction. Pure. A fix to the same heard words with DIFFERENT meant words replaces the old
 * one and starts counting again (the person changed their mind, or the first was a slip). `unlearn`: the learned
 * fixes that were applied to the corrected line ([{ from, to }]); one the person turned back - their words have
 * the heard words again and not the learned ones - is forgotten.
 */
export function learn(record, heard, meant, { at = Date.now(), unlearn = [] } = {}) {
  const r = cleanRecord(record, record && record.key);
  const { words, fixes } = lessonsFrom(heard, meant);
  for (const w of words) {
    const had = r.words.find((x) => x.w.toLowerCase() === w.toLowerCase());
    if (had) { had.n += 1; had.at = at; if (/^\p{Lu}/u.test(w)) had.w = w; } else r.words.push({ w, n: 1, at });
  }
  for (const f of fixes) {
    const had = r.fixes.find((x) => x.from === f.from);
    if (had && had.to.toLowerCase() === f.to.toLowerCase()) { had.n += 1; had.at = at; had.to = f.to; }
    else if (had) Object.assign(had, { to: f.to, n: 1, at });
    else r.fixes.push({ ...f, n: 1, at });
  }
  const said = ` ${tokens(meant).map(keyOf).join(' ')} `;
  for (const u of Array.isArray(unlearn) ? unlearn : []) {
    const from = tokens(u && u.from).map(keyOf).join(' ');
    const to = tokens(u && u.to).map(keyOf).join(' ');
    if (from && said.includes(` ${from} `) && !(to && said.includes(` ${to} `))) r.fixes = r.fixes.filter((x) => x.from !== from);
  }
  r.words = trim(r.words, WORDS_MAX);
  r.fixes = trim(r.fixes, FIXES_MAX);
  r.updatedAt = at;
  return r;
}

/** Is a fix ready to apply? Made `fixAfter` times (0 = never), and not a lone common word. Pure. */
export function fixApplies(f, fixAfter = LEARNING_DEFAULTS.fixAfter) {
  if (!f || !fixAfter || (Number(f.n) || 0) < fixAfter) return false;
  const from = tokens(f.from);
  return !(from.length === 1 && COMMON_WORDS.has(from[0]));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The words with the ready fixes applied: { text, words, learned: [{ from, to }] }. Whole words only, any case,
 * the longest heard phrase first. `words` (the engine's per-word confidences) is rebuilt for the new words, keeping
 * a word's confidence where it is unchanged and none (not "unsure") where a fix put it. Pure.
 */
export function applyFixes(text, fixes = [], { fixAfter = LEARNING_DEFAULTS.fixAfter, words = null } = {}) {
  let out = String(text ?? '');
  const learned = [];
  const ready = (fixes || []).filter((f) => fixApplies(f, fixAfter))
    .sort((p, q) => tokens(q.from).length - tokens(p.from).length);
  for (const f of ready) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}'])(${tokens(f.from).map(escapeRe).join('\\s+')})(?=$|[^\\p{L}\\p{N}'])`, 'giu');
    let hit = false;
    out = out.replace(re, (m, pre) => { hit = true; return `${pre}${f.to}`; });
    if (hit) learned.push({ from: f.from, to: f.to });
  }
  if (!learned.length) return { text: String(text ?? ''), words, learned };
  let rebuilt = null;
  if (Array.isArray(words) && words.length) {
    const pool = words.map((x) => ({ k: keyOf(x?.w ?? x?.word), conf: x?.conf ?? x?.confidence ?? null }));
    rebuilt = tokens(out).map((w) => {
      const i = pool.findIndex((p) => p.k && p.k === keyOf(w));
      const conf = i >= 0 ? pool.splice(i, 1)[0].conf : null;
      return { w, conf };
    });
  }
  return { text: out, words: rebuilt, learned };
}

/** The words to lean the recognisers towards: every record's, most used then newest, at most `max`. Pure. */
export function hintsFor(records = [], { max = HINTS_MAX } = {}) {
  const all = [];
  for (const r of records || []) for (const x of (r && r.words) || []) all.push(x);
  all.sort((p, q) => ((q.n || 0) - (p.n || 0)) || ((q.at || 0) - (p.at || 0)));
  const out = [];
  for (const x of all) {
    if (!out.some((w) => w.toLowerCase() === String(x.w).toLowerCase())) out.push(String(x.w));
    if (out.length >= max) break;
  }
  return out;
}

/** Whose record a line's speaker is: the named person's id (or name), else the shared one. Pure. */
export function personKeyOf(speaker) {
  if (!speaker || typeof speaker !== 'object' || speaker.self) return ROOM_KEY;
  const who = typeof speaker.who === 'string' ? speaker.who.trim() : '';
  const person = typeof speaker.person === 'string' || typeof speaker.person === 'number' ? String(speaker.person).trim() : '';
  // NAMED only (`who` set by the speech program). A "maybe" is a guess, and a guess must not file one person's
  // corrections under another's name: those go to the shared record.
  if (!who) return ROOM_KEY;
  return person || who;
}
const personName = (speaker) => (speaker && typeof speaker.who === 'string' ? speaker.who.trim() : '');

/** Does this line's text carry a correction prefix (the "what I said was ..." utterance itself)? Pure. */
export function isCorrectionLine(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return Object.values(FIX_PHRASES).flat().some((p) => t.includes(` ${p} `));
}

/**
 * WHICH LINE "what I said was" / "what they said was" means. Pure. `lines` oldest first (subtitles `history()`);
 * `by` the speaker of the correction itself ({ who, person } or null). Only room lines (never the screen's own words,
 * never the correction utterance), the newest FIX_LOOKBACK_LINES and not older than FIX_LOOKBACK_MS.
 *   'fix-self'   the newest line in the corrector's own named voice; with nobody named, the newest line.
 *   'fix-other'  the newest line in a voice that is NOT the corrector's; with nobody named, the newest line.
 * null when there is none.
 */
export function pickLine(lines = [], kind = 'fix-self', { by = null, now = Date.now(), lookbackLines = FIX_LOOKBACK_LINES,
                                                         lookbackMs = FIX_LOOKBACK_MS } = {}) {
  const ok = (lines || []).filter((l) => l && l.source !== 'screen' && !isCorrectionLine(l.text)
    && String(l.text || '').trim() && (!lookbackMs || !Number.isFinite(Number(l.at)) || now - Number(l.at) <= lookbackMs))
    .slice(-lookbackLines).reverse();
  if (!ok.length) return null;
  const me = personKeyOf(by);
  const keyLine = (l) => personKeyOf(l.speaker);
  if (me === ROOM_KEY) return ok[0];
  if (kind === 'fix-other') return ok.find((l) => keyLine(l) !== me) || ok[0];
  return ok.find((l) => keyLine(l) === me) || ok[0];
}

// ---------------------------------------------------------------------------------------
// THE STORES: one record per person. Same interface, all async: get(key) all() put(record) remove(key) clear()
// ---------------------------------------------------------------------------------------
export function memoryLearnedStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(key) { const r = m.get(String(key ?? '')); return r ? JSON.parse(JSON.stringify(r)) : null; },
    async all() { return [...m.values()].map((r) => JSON.parse(JSON.stringify(r))); },
    async put(r) { m.set(String(r.key ?? ''), JSON.parse(JSON.stringify(r))); return r.key; },
    async remove(key) { return m.delete(String(key ?? '')); },
    async clear() { m.clear(); },
  };
}

function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

/** This browser's IndexedDB on this screen (`nimrod-learned-words`, one store `people`, one record per person). */
export function idbLearnedStore({ idb = (typeof indexedDB !== 'undefined' ? indexedDB : null), name = LEARNED_DB } = {}) {
  if (!idb) throw new Error('idbLearnedStore: this browser has no IndexedDB');
  let dbp = null;
  const open = () => {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = idb.open(name, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('people')) r.result.createObjectStore('people', { keyPath: 'key' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    return dbp;
  };
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(['people'], mode);
      let out;
      Promise.resolve(fn(t.objectStore('people'))).then((v) => { out = v; }, (e) => { try { t.abort(); } catch { /* gone */ } rej(e); });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('aborted'));
    });
  };
  return {
    kind: 'indexeddb',
    get: (key) => tx('readonly', (s) => req(s.get(String(key ?? '')))).then((r) => r || null),
    all: () => tx('readonly', (s) => req(s.getAll())),
    put: (r) => tx('readwrite', (s) => { s.put(r); return r.key; }),
    remove: (key) => tx('readwrite', (s) => { s.delete(String(key ?? '')); return true; }),
    clear: () => tx('readwrite', (s) => { s.clear(); return true; }),
    close() { if (dbp) dbp.then((db) => db.close()).catch(() => {}); dbp = null; },
  };
}

/**
 * A copy of every record, as one file in the person's Nimrod folder's Data subfolder (user_folders.js `subfolder`),
 * so the words outlive this browser. `dir` is that folder's handle; the browser only lets a page write there after a
 * press on it. Returns the file name.
 */
export const LEARNED_FILE = 'learned words.json';
export async function saveLearnedToFolder(dir, records = []) {
  if (!dir || typeof dir.getFileHandle !== 'function') throw new Error('no folder');
  const fh = await dir.getFileHandle(LEARNED_FILE, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(JSON.stringify({ format: LEARNED_FORMAT, v: LEARNED_VERSION, savedAt: Date.now(),
                                   people: (records || []).map((r) => cleanRecord(r, r && r.key)) }, null, 2));
  } finally { await w.close(); }
  return LEARNED_FILE;
}

/** The Data subfolder of the person's Nimrod folder, asked for from a PRESS (the browser prompts only then). */
export async function dataFolder() {
  const r = await recallRoot();
  const root = r && r.handle;
  if (!root) throw new Error('no Nimrod folder chosen on this device');
  if (await allowAgain(root, ROOT_MODE) !== 'granted') throw new Error('the Nimrod folder was not allowed');
  const dir = await subfolder(root, 'data');
  if (!dir) throw new Error('the Nimrod folder has no Data folder');
  return dir;
}

// ---------------------------------------------------------------------------------------
// THE LEARNING: subtitles, the speech layer, the recognisers and the recordings, joined up
// ---------------------------------------------------------------------------------------
/**
 *   rewrite(c)          subtitles.js's `rewrite`: the ready fixes for that line's speaker (and the shared ones)
 *   correct({ kind, text, speaker, by })   a correction by voice: finds the line (pickLine), fixes it, learns
 *   fixLine(id, text, { by })              the same, for a line already chosen (the panel)
 *   attach(recognizer)  the running recogniser, for its `setHints`
 *   update(row)         the person's row: SUBTITLE_LEARNING_FIELDS, and whether subtitles are on
 *   openFix() / openWords()   the two panels
 *   records() / forgetWord(key, w) / forgetFix(key, from) / forgetAll(key)
 * Results go to `onResult` and the bus (SUBTITLES_FIXED_TOPIC): { ok, line?, why?, key, learned, pair? }.
 */
export function createSubtitleLearning({
  subtitles,
  store = memoryLearnedStore(),
  bus = null,
  host = null,                     // where the panels go (the screen's root)
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
  // The voice recordings (voice_recording.js): () => the pair store, and () => whose recordings they are. Either
  // returning null means "not recording": layer (b) is skipped.
  pairStore = () => null,
  pairPerson = () => null,
  folder = null,                   // async () => the Data subfolder handle, for "Save a copy to my Nimrod folder"
  onResult = null,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  idleMs = PANEL_IDLE_MS,
} = {}) {
  if (!subtitles || typeof subtitles.fix !== 'function') throw new Error('createSubtitleLearning: subtitles with fix() are required');
  let opts = learningOptionsFrom({});
  let subsOn = false;
  let announced = false;
  let rec = null;
  let torn = false;
  const cache = new Map();          // key -> record (loaded at start; every change written through)
  const offs = [];
  const timers = new Set();
  let listening = null;             // { kind, speaker, timer } while a one-utterance window is open
  let fixPanel = null;
  let wordsPanel = null;
  let lastHintSig = '';

  const later = (fn, ms) => {
    let id = null;
    try { id = setTimer(() => { timers.delete(id); if (!torn) fn(); }, ms); timers.add(id); } catch { id = null; }
    return id;
  };
  const cancel = (id) => { if (id != null) { timers.delete(id); try { clearTimer(id); } catch { /* gone */ } } };
  const publish = (topic, payload) => { try { bus?.publish?.(topic, payload); } catch (err) { console.error(`subtitle learning: ${topic}`, err); } };
  const sub = (topic, fn) => { try { const off = bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
  const tell = (r) => {
    try { onResult?.(r); } catch (err) { console.error('subtitle learning: onResult', err); }
    publish(SUBTITLES_FIXED_TOPIC, r);
    return r;
  };

  const ready = Promise.resolve()
    .then(() => store.all())
    .then((list) => { for (const r of list || []) { const c = cleanRecord(r, r && r.key); cache.set(c.key, c); } pushHints(); })
    .catch((err) => { console.error('subtitle learning: load', err); });

  function pushHints() {
    if (!rec || typeof rec.setHints !== 'function') return;
    const words = opts.hints && opts.learn ? hintsFor([...cache.values()]) : [];
    const sig = words.join('\u0001');
    if (sig === lastHintSig) return;
    lastHintSig = sig;
    try { rec.setHints(words); } catch (err) { console.error('subtitle learning: hints', err); }
  }

  // ---- the speech layer: "what I said was ..." -------------------------------------------
  function announce() {
    publish(SPEECH_ASK_TARGET_TOPIC, { source: FIX_SOURCE, instanceId: FIX_TARGET, open: subsOn && !torn,
                                       names: [], notes: false, fixes: true });
  }
  function closeListening() {
    if (!listening) return;
    cancel(listening.timer);
    listening = null;
    publish(SPEECH_GRAMMAR_TOPIC, { source: FIX_SOURCE, instanceId: FIX_TARGET, open: false });
  }
  function onAsk(p) {
    if (torn || !p || typeof p !== 'object' || (p.kind !== 'fix-self' && p.kind !== 'fix-other')) return;
    const text = String(p.text || '').trim();
    if (text) { closeListening(); correct({ kind: p.kind, text, speaker: p.speaker || null, by: 'voice' }); return; }
    if (p.listen) {
      // The prefix alone: the NEXT thing said is the words. One utterance, then it shuts.
      closeListening();
      const ms = Math.max(1000, Number(p.ms) || LISTEN_MS);
      listening = { kind: p.kind, speaker: p.speaker || null, timer: null };
      listening.timer = later(() => closeListening(), ms);
      publish(SPEECH_GRAMMAR_TOPIC, { source: FIX_SOURCE, instanceId: FIX_TARGET, open: true, words: [],
                                      dictation: true, phase: 'fix' });
      return;
    }
    // A recogniser that cannot write a free sentence down: type it instead, on the line it meant.
    const line = pickLine(subtitles.history(), p.kind, { by: p.speaker || null, now: now() });
    openFix({ lineId: line ? line.id : null, note: 'This screen’s voice can only hear its own commands: type what was said.' });
  }
  function onAnswer(p) {
    if (torn || !listening || !p || typeof p !== 'object') return;
    const text = String(p.text || '').trim();
    const l = listening;
    closeListening();
    if (!text || text.toLowerCase() === UNKNOWN_WORD) return;
    correct({ kind: l.kind, text, speaker: l.speaker, by: 'voice' });
  }

  // ---- correcting ---------------------------------------------------------------------
  function correct({ kind = 'fix-self', text = '', speaker = null, by = 'voice' } = {}) {
    const line = pickLine(subtitles.history(), kind, { by: speaker, now: now() });
    if (!line) {
      // Nothing it could mean: the panel, so the person can see why and pick.
      openFix({ note: 'There was no recent line to fix.' });
      return tell({ ok: false, why: 'no-line', kind, by });
    }
    return fixLine(line.id, text, { by, kind });
  }

  function fixLine(id, text, { by = 'hand', kind = null } = {}) {
    const before = subtitles.history().find((l) => l.id === id || l.caption === id) || null;
    const t = String(text ?? '').trim();
    if (!before || !t) return tell({ ok: false, why: before ? 'no-words' : 'no-line', kind, by });
    const line = subtitles.fix(before.id, t, { by });
    if (!line) return tell({ ok: false, why: 'not-fixed', kind, by });
    const heard = before.heard || (before.fixed && before.fixed.heard) || before.text;
    const key = personKeyOf(before.speaker);
    let learned = { words: [], fixes: [] };
    if (opts.learn && !isCorrectionLine(t)) {
      learned = lessonsFrom(heard, t);
      const had = cache.get(key) || emptyRecord(key, personName(before.speaker));
      const next = learn(had, heard, t, { at: now(), unlearn: before.learned || [] });
      if (!next.name && personName(before.speaker)) next.name = personName(before.speaker);
      cache.set(key, next);
      Promise.resolve().then(() => store.put(next)).catch((err) => console.error('subtitle learning: save', err));
      pushHints();
      if (wordsPanel) drawWords();
    }
    const result = { ok: true, line, key, by, kind, learned };
    if (opts.learn && line.caption) trainPair(line, t, by, 0);
    return tell(result);
  }

  // ---- (b) the recording the line came from --------------------------------------------
  async function trainPair(line, meant, by, attempt) {
    const ps = (() => { try { return pairStore(); } catch { return null; } })();
    if (!ps || typeof ps.list !== 'function') return;
    let person = null;
    try { person = pairPerson(); } catch { person = null; }
    try {
      const list = await ps.list({ personId: person || null });
      const pair = (list || []).find((p) => p && p.said && p.said.caption === line.caption);
      if (!pair) {
        if (attempt < PAIR_RETRY_MS.length) later(() => trainPair(line, meant, by, attempt + 1), PAIR_RETRY_MS[attempt]);
        return;
      }
      const sp = line.speaker || null;
      const own = !!(sp && sp.who && person != null && String(sp.person ?? '') === String(person));
      const next = withCorrection(pair, meant, { by, ownVoice: own, at: now() });
      if (next === pair) return;
      await ps.update(pair.id, { meant: next.meant, meantAt: next.meantAt, meantFrom: next.meantFrom,
                                 meantBy: next.meantBy, reviewed: next.reviewed });
      publish(SUBTITLES_FIXED_TOPIC, { ok: true, pair: { id: pair.id, reviewed: next.reviewed }, line: { id: line.id } });
    } catch (err) { console.error('subtitle learning: recording', err); }
  }

  // ---- applying what was learned --------------------------------------------------------
  function rewrite(c) {
    if (!opts.learn || !opts.fixAfter || !c) return null;
    const keys = [ROOM_KEY];
    const k = personKeyOf(c.speaker);
    if (k !== ROOM_KEY) keys.push(k);
    const fixes = keys.flatMap((x) => (cache.get(x)?.fixes || []));
    if (!fixes.length) return null;
    const r = applyFixes(c.text, fixes, { fixAfter: opts.fixAfter, words: Array.isArray(c.words) ? c.words : null });
    if (!r.learned.length) return null;
    return { text: r.text, words: r.words, learned: r.learned };
  }

  // ---- forgetting -------------------------------------------------------------------------
  function save(key, r) {
    cache.set(key, r);
    Promise.resolve().then(() => store.put(r)).catch((err) => console.error('subtitle learning: save', err));
    pushHints();
    if (wordsPanel) drawWords();
  }
  function forgetWord(key, w) {
    const r = cache.get(String(key ?? ''));
    if (!r) return false;
    const n = r.words.length;
    save(r.key, { ...r, words: r.words.filter((x) => x.w.toLowerCase() !== String(w || '').toLowerCase()), updatedAt: now() });
    return cache.get(r.key).words.length !== n;
  }
  function forgetFix(key, from) {
    const r = cache.get(String(key ?? ''));
    if (!r) return false;
    const n = r.fixes.length;
    save(r.key, { ...r, fixes: r.fixes.filter((x) => x.from !== from), updatedAt: now() });
    return cache.get(r.key).fixes.length !== n;
  }
  function forgetAll(key = null) {
    const keys = key == null ? [...cache.keys()] : [String(key)];
    for (const k of keys) {
      cache.delete(k);
      Promise.resolve().then(() => store.remove(k)).catch((err) => console.error('subtitle learning: forget', err));
    }
    pushHints();
    if (wordsPanel) drawWords();
  }

  // ---- the panels ---------------------------------------------------------------------------
  function ensureStyle() {
    if (!doc || doc.getElementById('subtitle-learning-style')) return;
    const style = doc.createElement('style');
    style.id = 'subtitle-learning-style';
    style.textContent = CSS;
    (doc.head || doc.documentElement).append(style);
  }
  function panel(kind, title, onClose) {
    ensureStyle();
    const el = doc.createElement('div');
    el.className = 'sl-panel';
    el.dataset.subtitleLearning = kind;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', title);
    const h = doc.createElement('p'); h.className = 'sl-title'; h.textContent = title;
    const body = doc.createElement('div'); body.className = 'sl-body';
    const close = button('Close', () => onClose());
    close.classList.add('sl-close');
    el.append(h, body, close);
    // GOES BY ITSELF after `idleMs` with nothing pressed or typed; any press or key starts the wait again.
    let idle = null;
    const wake = () => { cancel(idle); idle = idleMs > 0 ? later(() => onClose(), idleMs) : null; };
    el.addEventListener('pointerdown', wake);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { onClose(); return; } wake(); });
    wake();
    (host || doc.body).append(el);
    return { el, body, stop: () => cancel(idle), wake };
  }
  function button(label, fn, cls = '') {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => { try { fn(); } catch (err) { console.error('subtitle learning: button', err); } });
    return b;
  }

  function closeFix() { if (!fixPanel) return; fixPanel.stop(); fixPanel.el.remove(); fixPanel = null; }
  /** "Fix a subtitle line": the newest lines to pick from, then the words. `lineId` opens straight on that line. */
  function openFix({ lineId = null, note = '' } = {}) {
    if (torn || !doc) return null;
    closeFix();
    fixPanel = panel('fix', 'Fix a subtitle line', closeFix);
    const draw = (chosen = null) => {
      const b = fixPanel.body;
      b.textContent = '';
      if (note) { const n = doc.createElement('p'); n.className = 'sl-note'; n.textContent = note; b.append(n); }
      const lines = subtitles.history().filter((l) => l.source !== 'screen' && !isCorrectionLine(l.text)).slice(-5).reverse();
      const line = chosen ? lines.find((l) => l.id === chosen) || subtitles.history().find((l) => l.id === chosen) : null;
      if (!line) {
        if (!lines.length) {
          const p = doc.createElement('p'); p.className = 'sl-note';
          p.textContent = subtitles.isOn?.() === false ? 'Subtitles are off.' : 'Nothing has been written down yet.';
          b.append(p);
          return;
        }
        const p = doc.createElement('p'); p.className = 'sl-step'; p.textContent = 'Which line?'; b.append(p);
        const list = doc.createElement('div'); list.className = 'sl-list';
        for (const l of lines) list.append(button(`${l.who?.label || 'Unknown'}: ${l.text}`, () => draw(l.id), 'sl-line'));
        b.append(list);
        list.querySelector('button')?.focus?.();
        return;
      }
      const p = doc.createElement('p'); p.className = 'sl-step'; p.textContent = `${line.who?.label || 'Unknown'} said:`; b.append(p);
      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'sl-input';
      input.value = line.text;
      input.setAttribute('aria-label', 'What was said');
      input.maxLength = 1000;
      b.append(input);
      const others = [line.heard, ...(line.alts || [])].filter((x, i, a) => x && x !== line.text
        && a.findIndex((y) => String(y).toLowerCase() === String(x).toLowerCase()) === i);
      if (others.length) {
        const q = doc.createElement('p'); q.className = 'sl-note'; q.textContent = 'Or what else it heard:'; b.append(q);
        const alts = doc.createElement('div'); alts.className = 'sl-list';
        for (const o of others.slice(0, 6)) alts.append(button(o, () => { input.value = o; input.focus?.(); fixPanel?.wake(); }, 'sl-alt'));
        b.append(alts);
      }
      const row = doc.createElement('div'); row.className = 'sl-row';
      const done = () => {
        const r = fixLine(line.id, input.value, { by: 'hand' });
        if (r.ok) closeFix();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(); });
      row.append(button('Save', done, 'sl-save'), button('Another line', () => draw(null)));
      b.append(row);
      try { input.focus(); input.select?.(); } catch { /* not focusable here */ }
    };
    draw(lineId);
    return fixPanel.el;
  }

  function closeWords() { if (!wordsPanel) return; wordsPanel.stop(); wordsPanel.el.remove(); wordsPanel = null; }
  function drawWords() {
    if (!wordsPanel) return;
    const b = wordsPanel.body;
    b.textContent = '';
    const list = [...cache.values()].filter((r) => r.words.length || r.fixes.length)
      .sort((p, q) => (p.key === ROOM_KEY) - (q.key === ROOM_KEY) || String(p.name).localeCompare(String(q.name)));
    if (!list.length) {
      const p = doc.createElement('p'); p.className = 'sl-note';
      p.textContent = 'Nothing yet. Correct a subtitle ("what I said was ...") and the words it missed show here.';
      b.append(p);
    }
    for (const r of list) {
      const h = doc.createElement('p'); h.className = 'sl-step';
      h.textContent = r.key === ROOM_KEY ? 'Anybody on this screen' : (r.name || 'A person whose voice is set up');
      b.append(h);
      const ul = doc.createElement('div'); ul.className = 'sl-list';
      for (const w of r.words) {
        const row = doc.createElement('div'); row.className = 'sl-item';
        const s = doc.createElement('span'); s.textContent = w.w; row.append(s, button(`Forget ${w.w}`, () => forgetWord(r.key, w.w)));
        ul.append(row);
      }
      for (const f of r.fixes) {
        const row = doc.createElement('div'); row.className = 'sl-item';
        const s = doc.createElement('span');
        const on = fixApplies(f, opts.fixAfter);
        s.textContent = `Heard “${f.from}”, means “${f.to}”${on ? '' : ` (not yet: corrected ${f.n} time${f.n === 1 ? '' : 's'})`}`;
        row.append(s, button('Forget this', () => forgetFix(r.key, f.from)));
        ul.append(row);
      }
      b.append(ul, button('Forget everything it learned here', () => forgetAll(r.key), 'sl-forget-all'));
    }
    const row = doc.createElement('div'); row.className = 'sl-row';
    if (typeof folder === 'function' && list.length) {
      const note = doc.createElement('p'); note.className = 'sl-note';
      row.append(button('Save a copy to my Nimrod folder', async () => {
        try { const dir = await folder(); const f = await saveLearnedToFolder(dir, list); note.textContent = `Saved as “${f}” in Data.`; }
        catch (err) { note.textContent = 'Could not save it there. Choose your Nimrod folder first.'; console.error('subtitle learning: folder', err); }
      }));
      b.append(row, note);
    }
  }
  /** "Words it has learned": every word and fix, by person, each deletable. */
  function openWords() {
    if (torn || !doc) return null;
    closeWords();
    wordsPanel = panel('words', 'Words it has learned', closeWords);
    drawWords();
    return wordsPanel.el;
  }

  sub(`${SPEECH_ASK_TOPIC}#${FIX_TARGET}`, onAsk);
  sub(`${SPEECH_ANSWER_TOPIC}#${FIX_TARGET}`, onAnswer);
  // A press says it was handled (`claim`), as the subtitles' own scroll-back actions do in the kiosk.
  const claim = (p) => { try { p?.claim?.(); } catch { /* a publisher's claim must not stop the press */ } };
  sub(SUBTITLES_FIX_TOPIC, (p) => { claim(p); openFix(); });
  sub(SUBTITLES_WORDS_TOPIC, (p) => { claim(p); openWords(); });

  return {
    ready,
    rewrite,
    correct,
    fixLine,
    attach(recognizer) { rec = recognizer || null; lastHintSig = ''; pushHints(); },
    // Tell the speech layer again whether corrections are taken: the bus keeps no last message, so a speech layer
    // attached AFTER the last update would otherwise never hear it (the kiosk calls this once speech has started).
    announce() { announce(); },
    detach() { rec = null; lastHintSig = ''; },
    update(row = {}) {
      opts = learningOptionsFrom(row);
      const was = subsOn;
      subsOn = !!row && row.subtitlesOn === true;
      // Told on the first update and on every change, so the speech layer knows whether "what I said was" means
      // anything right now (a subtitle mode that is off has no line to fix).
      if (!announced || was !== subsOn) { announced = true; announce(); }
      if (!subsOn) { closeListening(); closeFix(); }
      pushHints();
    },
    options: () => ({ ...opts }),
    hints: () => (opts.hints && opts.learn ? hintsFor([...cache.values()]) : []),
    records: () => [...cache.values()].map((r) => JSON.parse(JSON.stringify(r))),
    record: (key) => { const r = cache.get(String(key ?? '')); return r ? JSON.parse(JSON.stringify(r)) : null; },
    forgetWord,
    forgetFix,
    forgetAll,
    openFix,
    openWords,
    closeFix,
    closeWords,
    listening: () => (listening ? { kind: listening.kind } : null),
    destroy() {
      torn = true;
      closeListening();
      announce();
      closeFix();
      closeWords();
      for (const id of [...timers]) cancel(id);
      for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
      try { store.close?.(); } catch { /* gone */ }
    },
  };
}

const CSS = `
.sl-panel{position:fixed;left:50%;bottom:6vh;transform:translateX(-50%);z-index:61;width:min(92vw,56rem);max-height:80vh;
  overflow:auto;box-sizing:border-box;padding:1.1rem 1.4rem;border-radius:14px;background:var(--letterbox,rgba(0,0,0,.88));
  color:var(--on-dark,#fff);font-size:clamp(18px,3vmin,34px);line-height:1.35;box-shadow:0 6px 30px rgba(0,0,0,.4)}
.sl-title{font-weight:700;margin:0 0 .5em}
.sl-step{margin:.6em 0 .3em;font-weight:600}
.sl-note{font-size:.75em;margin:.3em 0 .5em}
.sl-list{display:flex;flex-direction:column;gap:.35em;margin:0 0 .5em}
.sl-item{display:flex;gap:.6em;align-items:center;justify-content:space-between;flex-wrap:wrap}
.sl-row{display:flex;gap:.6em;flex-wrap:wrap;margin:.5em 0 0}
.sl-input{font:inherit;width:100%;box-sizing:border-box;padding:.35em .5em;border-radius:10px;border:2px solid currentColor;
  background:transparent;color:inherit}
.sl-panel button{font:inherit;font-size:.8em;padding:.35em .9em;border-radius:10px;border:2px solid currentColor;
  background:transparent;color:inherit;cursor:pointer;text-align:left}
.sl-panel button:focus-visible,.sl-input:focus-visible{outline:3px solid currentColor;outline-offset:3px}
.sl-close{margin-top:.6em}
`;
