// shared_words.js — THE WORDS PACKS AS A WORD LIST THE GAMES SHARE (2026-11-23, note GM 3; Mike: "yes to shared words").
//
// research/words__level*.json hold the site's researched words: each with a level (1 everyday to 6 hardest), a meaning and an
// example. Until now only Did you know read them. This file turns the same index (research_load.js, one fetch per page) into
// what a word game needs: `word -> { word, level, definition, example, partOfSpeech, id }`, plain a-z words only.
//
// THE RULE FOR ADDING A WORD TO A GAME: research it once, into a words pack, and every game that reads this gets it (the word
// builder asks for it by its level, Spelling asks the everyday ones, Did you know shows its meaning). A word a game must not use
// is held back by that game with word_filter.js, not left out of the pack: "The words we use will be used for multiple things"
// (Mike, 2026-11-23).
//
// LOADED, NOT WAITED FOR. A game starts from its own list and adds these when they arrive (`whenSharedWords`), so a board is
// never empty while 1 MB of packs is fetched on a Pi. `sharedWordsNow()` is the list as it stands (empty until then).

import { mayShow } from './research_index.js';
import { sharedResearch } from './research_load.js';

/** A research index's word items as `Map(word -> entry)`: shown ones only (never flagged), plain a-z. PURE. */
export function wordsFromIndex(index) {
  const out = new Map();
  for (const it of (index && index.items) || []) {
    if (!it || it.kind !== 'word' || !mayShow(it)) continue;
    const word = String(it.word || it.text || '').trim().toLowerCase();
    if (!/^[a-z]+$/.test(word) || out.has(word)) continue;
    out.set(word, Object.freeze({ word, level: it.level || null, definition: it.definition || '', example: it.example || '',
      partOfSpeech: it.partOfSpeech || '', id: it.id }));
  }
  return out;
}

let now = new Map();
let loading = null;
const waiting = new Set();

/** The shared words as they stand: an empty Map until the packs have arrived. */
export const sharedWordsNow = () => now;

/** Start loading (once per page) and resolve with the Map. Never rejects: no packs is an empty Map. */
export function loadSharedWords({ getIndex = sharedResearch } = {}) {
  if (loading) return loading;
  loading = (async () => {
    let index = null;
    try { index = await getIndex(); } catch { index = null; }
    now = wordsFromIndex(index);
    for (const fn of [...waiting]) { try { fn(now); } catch (err) { console.error('shared words: listener', err); } }
    return now;
  })();
  return loading;
}

/** Call `fn(map)` once the words are here (at once, after this turn, if they already are). Returns a stop function. */
export function whenSharedWords(fn, opts) {
  waiting.add(fn);
  loadSharedWords(opts);   // still loading: the loader calls `fn` when it is done
  if (now.size) Promise.resolve().then(() => { if (waiting.has(fn)) { try { fn(now); } catch (err) { console.error('shared words: listener', err); } } });
  return () => { waiting.delete(fn); };
}

/** A word's meaning ("the room where food is cooked"), or '' when it has none yet. */
export function meaningOf(word, map = now) {
  const e = map.get(String(word || '').toLowerCase());
  return e ? e.definition : '';
}

/** The word builder's tier for a pack level: 1-2 -> 1, 3-4 -> 2, 5-6 -> 3 (the GM 3 proposal). PURE. */
export function tierOfLevel(level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(3, Math.ceil(n / 2));
}

/** For the suites: a page's worth again. */
export function forgetSharedWordsForTest() { now = new Map(); loading = null; waiting.clear(); }
