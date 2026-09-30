// speech_misses.js — WHAT WAS SAID TO THE SCREEN AND NOT UNDERSTOOD. The "miss log".
//
// Row 2.28 (b). Mike, 2026-09-30: yes, in principle - "only the words after a heard wake phrase
// that matched nothing, text only, on the device, deleted on a schedule." Its job is to answer a
// real question with evidence instead of a guess: is the fixed phrase table enough for the people
// using this screen, or do they need a recogniser that can "actually think about what she's
// saying" (register 274)? A list of what people actually said after "computer please" and got
// nothing is also exactly where the next rows of the phrase table come from - Mike's "other ways
// people might phrase it".
//
// *** WHAT IT MAY HOLD, AND WHAT MAKES THAT TRUE. *** Every rule below is enforced somewhere a
// test can see it, not just written here:
//   * ONLY WORDS THAT FOLLOWED A WAKE PHRASE. This file cannot know that - `input_speech.js`
//     decides what reaches `add()`, and `speech_test` proves a sentence with no wake phrase never
//     does, not even with the wake gate switched off.
//   * TEXT, NEVER AUDIO. `add()` takes a string and refuses anything else, so a recording cannot
//     end up in here by somebody passing the wrong thing.
//   * THIS DEVICE ONLY. localStorage, under one key. Nothing here makes a request, and the suite
//     fails if anything touches the network while it runs. Not the server, not "other devices":
//     the words somebody says in a room are about as personal as data gets.
//   * DELETED ON A SCHEDULE. Anything older than `keepDays` is removed on every read and write,
//     AND by a timer (`startSchedule`), because a quiet room that never hears another miss would
//     otherwise keep the old ones forever.
//   * A CAREGIVER CAN READ IT AND CLEAR IT (`readMisses` / `clearMisses`; the screen UI is later).
//
// *** OFF UNLESS SOMEBODY TURNS IT ON (MISS_FIELDS). *** Argued both ways:
//   * FOR on by default: it only ever holds what somebody said TO the screen (after its wake
//     phrase), it stays on the device, it deletes itself, and it is how anyone - not only one
//     family - finds out which phrasings their household uses.
//   * AGAINST, and it wins for a SITE default: it writes down words spoken in a room, by
//     visitors and staff as well as the owner, and none of them were asked. A false wake (a TV
//     saying "computer, please...") puts a stranger's sentence in it. Recording speech is the kind
//     of thing that should be a choice somebody made, not a thing that was on. The person it was
//     built for gets it turned on on their own profile, which is one setting.
// That is a default, so it is Mike's call (row 2.28 (b)); the store itself does not care.
//
// No 'log' in the file name on purpose: ad-block lists refuse first-party files with tracking-ish
// names (see tools/check_blocked_names.py), and a blocked module takes the whole page down.

export const MISSES_KEY = 'nimrod.speech.misses';

export const MISS_DEFAULTS = Object.freeze({
  // *** FOURTEEN DAYS. *** Long enough to span two weekly visits by whoever reviews it, which is
  // how often somebody is realistically going to look; short enough that a stray sentence from a
  // visitor is gone within a fortnight. A setting (MISS_FIELDS) from a day to three months.
  keepDays: 14,
  // A bound on size, not a policy: at a few dozen misses a day this is weeks of them, and a
  // runaway recogniser cannot fill the device's storage.
  maxEntries: 500,
  // A miss is a COMMAND somebody tried, a handful of words. Anything much longer is a
  // conversation that happened to start with the wake phrase, and keeping all of it would be
  // keeping far more than the log needs.
  maxChars: 160,
  // How often the timer prunes. Hourly: old entries are never more than an hour past their date.
  pruneEveryMs: 60 * 60 * 1000,
});

const DAY_MS = 24 * 60 * 60 * 1000;

// *** THE SETTINGS, declared for the host's menu (the PERSON level: it is about who is talking to
// this screen, and turns on for them wherever they are). ***
export const MISS_FIELDS = [
  { key: 'speechMissLog', label: 'Keep a list of spoken commands that were not understood',
    kind: 'toggle', default: false, level: 'advanced',
    note: 'Only the words said after the wake phrase. Text only, kept on this screen, never sent anywhere.' },
  { key: 'speechMissKeepDays', label: 'Delete them after', kind: 'choice',
    default: MISS_DEFAULTS.keepDays, level: 'advanced',
    options: [
      { value: 1, label: 'a day' },
      { value: 3, label: '3 days' },
      { value: 7, label: 'a week' },
      { value: 14, label: 'two weeks' },
      { value: 30, label: 'a month' },
      { value: 90, label: 'three months' },
    ] },
];

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

function readRaw(storage, key) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e.text === 'string' && Number.isFinite(e.at))
      : [];
  } catch { return []; }
}

function writeRaw(storage, key, list) {
  if (!storage) return false;
  try {
    if (list.length) storage.setItem(key, JSON.stringify(list));
    else storage.removeItem(key);
    return true;
  } catch { return false; }
}

const positive = (v, dflt) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : dflt; };

/**
 * The store. Every call re-reads storage, so two copies (the kiosk's and a caregiver page's)
 * never disagree about what is there.
 */
export function createMissStore({
  storage = defaultStorage(),
  now = () => Date.now(),
  keepDays = MISS_DEFAULTS.keepDays,
  maxEntries = MISS_DEFAULTS.maxEntries,
  maxChars = MISS_DEFAULTS.maxChars,
  key = MISSES_KEY,
  setInterval: setIv = (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: clearIv = (id) => globalThis.clearInterval(id),
} = {}) {
  const days = positive(keepDays, MISS_DEFAULTS.keepDays);
  const cap = Math.floor(positive(maxEntries, MISS_DEFAULTS.maxEntries));
  const chars = Math.floor(positive(maxChars, MISS_DEFAULTS.maxChars));

  const fresh = (list) => {
    const cutoff = now() - days * DAY_MS;
    return list.filter((e) => e.at >= cutoff);
  };

  // Drop what is past its date, and write back only if that changed anything.
  function prune() {
    const all = readRaw(storage, key);
    const kept = fresh(all);
    if (kept.length !== all.length) writeRaw(storage, key, kept);
    return kept;
  }

  return {
    keepDays: () => days,
    /** Add one miss. Text only: anything that is not a string - a recording above all - is refused. */
    add(text) {
      if (typeof text !== 'string') return false;
      const t = text.replace(/\s+/g, ' ').trim().slice(0, chars).trim();
      if (!t) return false;
      const list = fresh(readRaw(storage, key));
      list.push({ at: now(), text: t });
      return writeRaw(storage, key, list.slice(-cap));
    },
    /** Everything still inside the keep time, oldest first. */
    list: () => prune().map((e) => ({ at: e.at, text: e.text })),
    prune: () => { prune(); },
    clear: () => writeRaw(storage, key, []),
    /** Prune on a timer too. Returns the function that stops it. */
    startSchedule(everyMs = MISS_DEFAULTS.pruneEveryMs) {
      let id = null;
      try { id = setIv(() => { try { prune(); } catch { /* a failed prune waits for the next */ } },
                       positive(everyMs, MISS_DEFAULTS.pruneEveryMs)); } catch { id = null; }
      return () => { if (id !== null) { try { clearIv(id); } catch { /* already gone */ } id = null; } };
    },
  };
}

/** For a caregiver: what this device has kept. Pruned first, so it never shows an expired one. */
export function readMisses(opts = {}) { return createMissStore(opts).list(); }

/** For a caregiver: delete every one of them, now. */
export function clearMisses(opts = {}) { return createMissStore(opts).clear(); }
