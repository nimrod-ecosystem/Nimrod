// research_index.js — FACTS, QUOTES AND WORDS, RESEARCHED ONCE AND READ BY EVERY MODULE (row 2.223, notes FE 5 and FH).
//
// Mike, 2026-11-06: *"whenever anything is researched, it can be saved in the proper format for everything."* Chat writes the
// packs (`nimrod.research.v1`, one file per pack, docs/from_chat/research/), a second pass checks every fact and quote against
// a source, and each item's `status` says how that went. This file is the ONE place a module asks: it reads packs into one index
// in memory and answers `find(...)`. A module never reads a pack itself, so the rules below (what may be shown) live once.
//
// WHAT MAY BE SHOWN, ARGUED:
//   * `flagged` and `disputed` NEVER: the check found a problem, and a wrong fact on a screen is read aloud as true.
//   * Facts and quotes: only `verified`, by default ("Only checked ones" on). Turning it off shows `unverified` too, never flagged.
//   * Words: no source to check a plain definition against (chat checks facts and quotes only, FH 2), so a word is shown unless
//     flagged. Requiring `verified` for words would hide all of them for good.
// SAME QUESTION, SAME ANSWER: `find` is pure. With a `seed` the order is a seeded shuffle (rng.js mulberry32), so two screens with
// the same seed agree and a screen can walk a list without repeating; `exclude` (ids already shown) is how a "seen" log, as
// trivia keeps one, leaves them out.

import { mulberry32, shuffle } from './rng.js';

export const RESEARCH_SCHEMA = 'nimrod.research.v1';
export const RESEARCH_KINDS = Object.freeze(['fact', 'quote', 'word']);
/** The kinds the second pass checks against a source: "Only checked ones" applies to these. */
export const CHECKED_KINDS = Object.freeze(['fact', 'quote']);
export const NEVER_SHOWN = Object.freeze(['flagged', 'disputed']);
// Caps, argued: the longest fact in the first packs is under 300 characters and the longest quote under 400; 1000 leaves room
// and stops a broken file from putting a page of text on a card. 2000 items a pack: the largest has 50.
export const TEXT_MAX = 1000;
export const PACK_ITEMS_MAX = 2000;

const str = (v, max = TEXT_MAX) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const strList = (v, max = 40) => (Array.isArray(v) ? v.map((x) => str(x, 80).toLowerCase()).filter(Boolean).slice(0, max) : []);

function cleanSources(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const s of v.slice(0, 10)) {
    const url = str(s && s.url, 500);
    if (!/^https?:\/\//i.test(url)) continue;               // a link that is not a web address is not a source
    // `licence` (2026-11-08): a CC BY source must be credited with its licence (note FV: Open English WordNet).
    out.push({ url, title: str(s.title, 300), publisher: str(s.publisher, 200), ...(s.licence ? { licence: str(s.licence, 60) } : {}) });
  }
  return out;
}

/** One item as the index keeps it, or null with the reason. PURE. */
export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return { item: null, problem: 'not an object' };
  const kind = str(raw.kind, 20);
  if (!RESEARCH_KINDS.includes(kind)) return { item: null, problem: `kind "${kind}" is not one of ${RESEARCH_KINDS.join(', ')}` };
  const id = str(raw.id, 120);
  if (!id) return { item: null, problem: 'no id' };
  const text = str(raw.text);
  if (!text) return { item: null, problem: `${id}: no text` };
  const status = ['unverified', 'verified', 'flagged', 'disputed'].includes(raw.status) ? raw.status : 'unverified';
  const item = {
    id, kind, text, status,
    tags: strList(raw.tags), difficulty: str(raw.difficulty, 20), sources: cleanSources(raw.sources),
    aiWritten: raw.ai_written !== false,
  };
  if (kind === 'fact') { item.topic = str(raw.topic, 80).toLowerCase(); item.note = str(raw.note); }
  if (kind === 'quote') {
    item.speaker = str(raw.speaker, 200);
    if (!item.speaker) return { item: null, problem: `${id}: a quote with nobody who said it` };
    item.work = str(raw.work, 300); item.year = str(raw.year, 20); item.context = str(raw.context);
  }
  if (kind === 'word') {
    item.word = str(raw.word, 80) || text;
    item.partOfSpeech = str(raw.part_of_speech, 40);
    const lv = Number(raw.level);
    item.level = Number.isInteger(lv) && lv >= 1 && lv <= 6 ? lv : null;
    item.definition = str(raw.definition); item.example = str(raw.example); item.aacCore = raw.aac_core === true;
  }
  if (raw.check && typeof raw.check === 'object') item.problemFound = str(raw.check.problem);
  return { item, problem: '' };
}

/** A pack file's parsed JSON: `{ name, kind, items, problems }`. A file that is not a research pack: no items, said. PURE. */
export function readPack(json, { fileName = '' } = {}) {
  const where = fileName ? `${fileName}: ` : '';
  if (!json || typeof json !== 'object' || json.schema !== RESEARCH_SCHEMA) {
    return { name: '', kind: '', items: [], problems: [`${where}not a ${RESEARCH_SCHEMA} pack`] };
  }
  const problems = [];
  const raw = Array.isArray(json.items) ? json.items : [];
  if (raw.length > PACK_ITEMS_MAX) problems.push(`${where}${raw.length} items; only the first ${PACK_ITEMS_MAX} are read`);
  const items = [];
  for (const r of raw.slice(0, PACK_ITEMS_MAX)) {
    const { item, problem } = cleanItem(r);
    if (item) items.push(item); else problems.push(where + problem);
  }
  return { name: str(json.name, 120), kind: str(json.kind, 20), items, problems };
}

/** One index over many packs (already read). An id seen twice: the first is kept, and it is said. PURE. */
export function buildIndex(packs) {
  const byId = new Map();
  const problems = [];
  for (const p of packs || []) {
    problems.push(...(p.problems || []));
    for (const it of p.items || []) {
      if (byId.has(it.id)) { problems.push(`${it.id} is in more than one pack; the first is used`); continue; }
      byId.set(it.id, { ...it, pack: p.name || '' });
    }
  }
  const items = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items, byId, problems };
}

/** May this item be shown? `onlyChecked` (default true) is the modules' "Only checked ones". PURE. */
export function mayShow(item, { onlyChecked = true } = {}) {
  if (!item || NEVER_SHOWN.includes(item.status)) return false;
  if (onlyChecked && CHECKED_KINDS.includes(item.kind)) return item.status === 'verified';
  return true;
}

/**
 * The one question: `find(index, { kind, tags, topic, level, difficulty, onlyChecked, exclude, limit, seed })`.
 *   kind        one kind or a list ('fact', ['fact','quote'])
 *   tags        a list: an item matches when it has ANY of them (a fact's topic counts as a tag)
 *   level       a word's level, a number or a list
 *   exclude     ids already shown
 *   seed        a number: the order is a seeded shuffle; none: the index's own order (by id)
 * PURE: the same index and question give the same answer.
 */
export function find(index, q = {}) {
  const kinds = q.kind == null ? null : [].concat(q.kind);
  const tags = Array.isArray(q.tags) ? q.tags.map((t) => String(t).toLowerCase()) : [];
  const levels = q.level == null ? null : [].concat(q.level).map(Number);
  const skip = new Set(q.exclude || []);
  const onlyChecked = q.onlyChecked !== false;
  let out = (index?.items || []).filter((it) => {
    if (skip.has(it.id) || !mayShow(it, { onlyChecked })) return false;
    if (kinds && !kinds.includes(it.kind)) return false;
    if (q.topic && it.topic !== String(q.topic).toLowerCase()) return false;
    if (q.difficulty && it.difficulty !== q.difficulty) return false;
    if (levels && !levels.includes(it.level)) return false;
    if (tags.length && !tags.some((t) => it.tags.includes(t) || it.topic === t)) return false;
    return true;
  });
  if (Number.isFinite(q.seed)) out = shuffle(out, mulberry32(q.seed));
  const limit = Number.isInteger(q.limit) && q.limit > 0 ? q.limit : out.length;
  return out.slice(0, limit);
}

/** What a screen says or shows for an item, in one line: a quote with who said it, a word with its meaning. PURE. */
export function itemLine(item) {
  if (!item) return '';
  if (item.kind === 'quote') return `“${item.text}” (${item.speaker}${item.work ? `, ${item.work}` : ''})`;
  if (item.kind === 'word') return item.definition ? `${item.word}: ${item.definition}` : item.word;
  return item.text;
}

/** The topics and tags present, for a "Which topics" choice: `[{ tag, count }]`, most first. PURE. */
export function topicsOf(index, { kind = null, onlyChecked = true } = {}) {
  const n = new Map();
  for (const it of index?.items || []) {
    if ((kind && it.kind !== kind) || !mayShow(it, { onlyChecked })) continue;
    for (const t of new Set([it.topic, ...it.tags].filter(Boolean))) n.set(t, (n.get(t) || 0) + 1);
  }
  return [...n].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
}
