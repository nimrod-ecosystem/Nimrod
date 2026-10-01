// question_writer.js — MORE QUESTIONS FROM AN OPEN MODEL, AS A PLAYER IMPROVES (row 2.45). OFF UNLESS
// A PANEL TURNS IT ON.
//
// Mike, 2026-10-01: the AI keeps generating questions as the player improves. Note AS / row 2.50: if
// Claude wrote the questions, no chat model may be trained on them, so the writer is an OPEN model
// reached through this device's own AI address (`ai.js`: one OpenAI-compatible adapter, Ollama by
// default). `isOpenModel` refuses a model whose name says it is Claude, and every question written
// carries `writtenBy`, so anything that later trains on game data can see where each one came from.
//
// This file is the HOOK: the prompt, a tolerant reader of the reply, and a strict check of every
// question before it can be asked. Whether a written question is any good is then decided the way a
// hand-written one's level is: by play (`rating.js` gives it a rating from everybody's answers).
//
// What it writes, per game (numbers are generated, never written):
//   things   three things in size order, smallest first          { things: [s, m, b] }
//   groups   three things and the group they belong to             { things, group, accept, cue }
//   finish   the start of an everyday sentence and endings that fit { stem, accept, wrong, cue }

import { normalize } from './quiz_flow.js';

export const WRITABLE = Object.freeze(['things', 'groups', 'finish']);

/** A model this hook may use. Claude's output must not become another chat model's training data. */
export function isOpenModel(id) {
  const s = String(id || '');
  return !!s && !/(claude|anthropic)/i.test(s);
}

const SHAPES = {
  things: 'Each question is three everyday things of clearly different sizes, smallest first: '
    + '{"things": ["ant", "dog", "house"]}.',
  groups: 'Each question is three everyday things that all belong to one group, the group, every word '
    + 'that names the group, and a short hint that does not use the group word: '
    + '{"things": ["apple", "banana", "pear"], "group": "fruit", "accept": ["fruit", "fruits"], '
    + '"cue": "they grow on trees and plants"}.',
  finish: 'Each question is the start of an everyday sentence with its last word missing, every word '
    + 'that would finish it well, two words that clearly would not, and a short hint: '
    + '{"stem": "I brush my", "accept": ["teeth", "hair"], "wrong": ["cloud", "soup"], '
    + '"cue": "you do it in the bathroom"}.',
};

const LEVEL_WORDS = ['', 'very easy: the most common words there are',
  'easy: common everyday words', 'medium: everyday words that need a moment of thought',
  'harder: less common words, or things closer together', 'hard: less common words and finer differences'];

/** The chat messages for one request. */
export function buildWriterPrompt(game, level = 1, examples = [], count = 8) {
  const lv = LEVEL_WORDS[Math.max(1, Math.min(5, Math.floor(level)))] || LEVEL_WORDS[5];
  const ex = (examples || []).slice(0, 3).map((q) => JSON.stringify(exampleOf(game, q))).join('\n');
  return [
    { role: 'system', content: 'You write short practice questions for adults relearning everyday language and '
      + 'thinking skills. Use plain, everyday English words only. No brand names, no names of real people, no '
      + 'song lyrics or quotations, nothing frightening or sad. Reply with JSON only.' },
    { role: 'user', content: `${SHAPES[game] || ''}\nDifficulty: ${lv} (level ${Math.floor(level)}).\n`
      + (ex ? `Examples at this level:\n${ex}\n` : '')
      + `Write ${Math.max(1, Math.min(20, Math.floor(count)))} new questions, none the same as the examples. `
      + 'Reply as {"questions": [...]}.' },
  ];
}

function exampleOf(game, q) {
  if (game === 'things') return { things: q.things };
  if (game === 'groups') return { things: q.things, group: q.group, accept: q.accept, cue: q.cue };
  return { stem: q.stem, accept: q.accept, wrong: q.wrong, cue: q.cue };
}

// A word or a short phrase of plain letters. Anything else (markup, digits, a paragraph) is refused.
const WORD = /^[a-z][a-z' -]{0,30}$/;
const word = (s) => { const n = normalize(s); return WORD.test(n) ? n : null; };
const words = (list, min, max) => {
  if (!Array.isArray(list)) return null;
  const out = [...new Set(list.map(word).filter(Boolean))];
  return out.length >= min ? out.slice(0, max) : null;
};
const slug = (s) => normalize(s).replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** One written question, checked. Null when anything about it is wrong. */
export function checkWritten(game, raw, level = 1, writtenBy = '') {
  if (!raw || typeof raw !== 'object') return null;
  const base = { level: Math.max(1, Math.floor(level)), source: 'ai', writtenBy: String(writtenBy || '') };
  if (game === 'things') {
    const t = words(raw.things, 3, 3);
    if (!t || t.length !== 3) return null;
    return { ...base, id: `ai-things-${slug(t.join(' '))}`, kind: 'things', things: t };
  }
  if (game === 'groups') {
    const t = words(raw.things, 3, 3);
    const g = word(raw.group);
    if (!t || t.length !== 3 || !g) return null;
    const accept = [...new Set([g, ...(words(raw.accept, 0, 6) || [])])];
    if (t.some((x) => accept.includes(x))) return null;
    const cue = typeof raw.cue === 'string' ? raw.cue.trim().slice(0, 80) : '';
    // A hint that says the answer is not a hint.
    if (!cue || accept.some((a) => normalize(cue).split(' ').includes(a))) return null;
    return { ...base, id: `ai-groups-${slug(t.join(' '))}`, kind: 'groups', things: t, group: g, accept, cue };
  }
  if (game === 'finish') {
    const stem = typeof raw.stem === 'string' ? raw.stem.replace(/_+|\.\.\.|…/g, '').trim() : '';
    if (!stem || stem.length > 60 || !/^[A-Za-z][A-Za-z' ,-]*$/.test(stem)) return null;
    const accept = words(raw.accept, 1, 8);
    const wrong = words(raw.wrong, 2, 3);
    if (!accept || !wrong || wrong.some((w) => accept.includes(w))) return null;
    const cue = typeof raw.cue === 'string' ? raw.cue.trim().slice(0, 80) : '';
    if (!cue || accept.some((a) => normalize(cue).split(' ').includes(a))) return null;
    return { ...base, id: `ai-finish-${slug(stem)}`, kind: 'finish', stem, accept, wrong, cue };
  }
  return null;
}

/** The reply, read tolerantly (fences, prose, a bare array), every question checked. */
export function parseWritten(game, text, level = 1, writtenBy = '') {
  const s = String(text || '');
  let body = null;
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  body = tryParse(s.trim());
  if (!body) { const m = /```(?:json)?\s*([\s\S]*?)```/.exec(s); if (m) body = tryParse(m[1]); }
  if (!body) { const a = s.indexOf('{'); const b = s.lastIndexOf('}'); if (a >= 0 && b > a) body = tryParse(s.slice(a, b + 1)); }
  if (!body) { const a = s.indexOf('['); const b = s.lastIndexOf(']'); if (a >= 0 && b > a) body = tryParse(s.slice(a, b + 1)); }
  const list = Array.isArray(body) ? body : (Array.isArray(body?.questions) ? body.questions : []);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const q = checkWritten(game, raw, level, writtenBy);
    if (q && !seen.has(q.id)) { seen.add(q.id); out.push(q); }
  }
  return out;
}

/**
 * ONE REQUEST. `ai` is `createAI()` from ai.js (or anything with `resolveModel` and `chat`).
 * Returns the checked questions (possibly none). Never throws; a refusal or a failure is an empty list
 * plus `reason`, because a writer that fails must leave the game exactly as it was.
 */
export async function writeQuestions({ ai, game, level = 1, examples = [], count = 8, existing = [] } = {}) {
  if (!ai || !WRITABLE.includes(game)) return { ok: false, items: [], reason: 'nothing to write with' };
  try {
    const m = await ai.resolveModel('');
    if (!m?.ok) return { ok: false, items: [], reason: m?.reason || 'no model' };
    if (!isOpenModel(m.model)) return { ok: false, items: [], reason: `"${m.model}" is not an open model` };
    const r = await ai.chat(buildWriterPrompt(game, level, examples, count),
      { model: m.model, json: true, temperature: 0.7, maxTokens: 1500 });
    if (!r?.ok) return { ok: false, items: [], reason: r?.reason || 'no reply' };
    const have = new Set((existing || []).map((q) => q.id));
    const items = parseWritten(game, r.text, level, m.model).filter((q) => !have.has(q.id));
    return { ok: true, items, model: m.model };
  } catch (err) {
    return { ok: false, items: [], reason: String(err?.message || err) };
  }
}
