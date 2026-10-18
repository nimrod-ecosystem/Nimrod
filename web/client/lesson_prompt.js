// lesson_prompt.js - MAKING A LESSON: the prompt drafted for the person's own AI, and its answer read back. Row 2.92.
//
// Mike, 2026-10-17 (chat's first_two_lessons_20261017.md): the person connects their AI, ticks what they want back,
// types a short topic, and the full prompt is drafted for them. The prompt is chat's draft, filled in. PURE: no DOM, no
// network. modules/lesson_player.js ("Lessons", "Make a new lesson...") is the caller.
//
// TWO WAYS TO GET THE ANSWER, and why both:
//   * COPY THE PROMPT to any AI (claude.ai, ChatGPT, an AI at school) and paste its reply back. It costs Mike nothing
//     (CLAUDE.md: "the default must cost Mike nothing"), works with an AI that CAN look things up, and needs nothing
//     set up on the site.
//   * ASK THE AI ON THIS COMPUTER (ai.js: Ollama or any OpenAI-shaped server). No copying; but a model on a computer
//     cannot look anything up, so it writes from memory and may invent sources.
// SOURCES ARE NEVER PRESENTED AS CHECKED. Nothing here can tell whether a source an AI named exists, or says what the
// lesson says it says. A made lesson keeps `sourcesChecked: false` beside it, and the player says so wherever sources
// show ("as the AI gave them, not checked"). A lesson from this computer's AI is also told, in the prompt, to cite only
// what it is sure of and to leave a fact out rather than invent a source for it.
//
// WHAT CAN BE TICKED is only what the player can show today (Read, Slides, Watch): the lesson itself always, review
// questions, notes with [[topic]] links, charts. Chat's draft also asked for a two-voice script and a teacher's script;
// those forms are not built, so they are not offered yet (a box that changes nothing would be a lie). [Guess, listed.]

import { MOVES, SHOW_KINDS, CHART_KINDS, SAY_WHO, checkLesson } from './lesson_file.js';

export const LESSON_PARTS = Object.freeze([
  Object.freeze({ id: 'questions', label: 'Review questions', default: true,
    note: 'Questions at the end, also played in Trivia, Word Forge and Quiz mix.' }),
  Object.freeze({ id: 'notes', label: 'Notes with [[topic]] links', default: true,
    note: 'The topics it touches, so a notes folder can link them.' }),
  Object.freeze({ id: 'charts', label: 'Charts, with their numbers', default: false,
    note: 'Only where real numbers help; each row says where it came from.' }),
]);
// Class length: 0 = the AI decides (Mike, 2026-10-17: "Set your desired lengths or let the AI decide").
export const CLASS_MINUTES = Object.freeze([0, 10, 20, 30, 45]);
export const TOPIC_MAX = 200;
export const LEARNER_MAX = 120;

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The prompt, from what the person typed and ticked. `onComputer`: for this computer's AI, which cannot look things
 * up (the sources line changes). PURE.
 */
export function draftLessonPrompt({ topic = '', learner = '', minutes = 0, parts = null, onComputer = false } = {}) {
  const t = clean(topic, TOPIC_MAX);
  const who = clean(learner, LEARNER_MAX);
  const m = CLASS_MINUTES.includes(Number(minutes)) ? Number(minutes) : 0;
  const want = new Set(Array.isArray(parts) ? parts : LESSON_PARTS.filter((p) => p.default).map((p) => p.id));
  const lines = [
    'You are writing a lesson for Nimrod. Return ONE JSON object in the shape below and nothing else: no words before or after it.',
    `Topic: ${t || '(not given)'}.`,
    `Learner: ${who || 'anyone'}. Plain words and short sentences, at the learner's level. Explain any special word in one line the first time it is used.`,
    m ? `Length: classes of about ${m} minutes. Decide how many classes the subject needs; each may run longer or shorter if the material calls for it. Say why you chose that number in "about.length_note".`
      : 'Length: you decide how many classes the subject needs and how long each is. Say why in "about.length_note".',
    onComputer
      ? 'Sources: you cannot look anything up, so write only what you are sure of. Cite a source only if you are sure it exists and says this; leave a fact out rather than invent a source for it. Every fact you keep carries the ids of its sources. Narration and jokes need no citation.'
      : 'Research: use current, reliable sources. Every fact carries the ids of its sources. Narration and jokes need no citation. Prefer primary sources (laws, official reports, the makers\' own statements) and say when sources disagree. Record each source\'s title, author or publisher, date, link, and the date you read it.',
    'Each class is a list of beats. A beat is one thing on screen and/or said:',
    `  "say": the words said (a string, or { "text": "...", "who": one of ${SAY_WHO.map((w) => `"${w}"`).join(', ')} });`,
    `  "show": what appears, one of: ${showKindsLine()};`,
    '  "cite": a list of source ids behind any fact in the beat;',
    `  "move": one animation name from this list, or none: ${MOVES.join(', ')};`,
    '  "ask": an optional question: { "question": "...", "answer": "the right answer", "wrong": [three wrong answers], "why": "one line" }.',
  ];
  if (want.has('questions')) lines.push('Also return review questions in "questions", in the same shape as "ask", a few for each class.');
  if (want.has('notes')) lines.push('Also return "notes": the topics the lesson touches, each as "[[topic]]".');
  if (want.has('charts')) lines.push(`Also return "charts" where real numbers help: { "id", "kind" (${CHART_KINDS.join(' or ')}), "title", "rows": [ { "label", "value" (a number), "source" (a source id) } ] }, shown by a beat with { "kind": "chart", "chart": "<id>" }.`);
  else lines.push('Do not return charts.');
  lines.push('Do not include colours, fonts, voices, pictures as files, or animation code; the screen supplies those. A picture is described in words.');
  lines.push('Shape: { "about": { "title", "subject", "for", "length_note" }, "sources": [ { "id", "title", "author", "date", "link", "read" } ], '
    + '"classes": [ { "title", "minutes", "goal", "beats": [] } ]'
    + `${want.has('charts') ? ', "charts": []' : ''}${want.has('notes') ? ', "notes": []' : ''}${want.has('questions') ? ', "questions": []' : ''} }`);
  return lines.join('\n');
}
function showKindsLine() {
  const say = {
    heading: '{ "kind": "heading", "text" }', word: '{ "kind": "word", "text" }', quote: '{ "kind": "quote", "text", "by" }',
    picture: '{ "kind": "picture", "of": "what it shows, in words" }', numeral: '{ "kind": "numeral", "n" }',
    count: '{ "kind": "count", "n", "thing" }', chart: '{ "kind": "chart", "chart": "<chart id>" }',
    row: '{ "kind": "row", "items": [ ... ] }',
  };
  return SHOW_KINDS.map((k) => say[k] || `{ "kind": "${k}" }`).join(', ');
}

/** Every piece of `text` that might be the JSON object: the whole, a ```json fence, the first "{" to the last "}". PURE. */
export function jsonPieces(text) {
  const t = String(text || '');
  const out = [t.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) out.push(fence[1].trim());
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) out.push(t.slice(a, b + 1));
  return [...new Set(out.filter(Boolean))];
}

/**
 * An AI's reply, read as a lesson: { lesson, problems, sources } (`lesson` null when none could be read; `problems`
 * every reason, in plain words). PURE.
 */
export function lessonFromReply(text) {
  if (!String(text || '').trim()) return { lesson: null, problems: ['Nothing was pasted.'] };
  for (const piece of jsonPieces(text)) {
    let data;
    try { data = JSON.parse(piece); } catch { continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    // Some AIs wrap it: { "lesson": { ... } }.
    const raw = data.lesson && typeof data.lesson === 'object' && !data.classes ? data.lesson : data;
    return checkLesson(raw);
  }
  return { lesson: null, problems: ['The reply has no lesson in it that could be read (it should be one JSON object). Ask the AI to return only the JSON.'] };
}

/** An id for a made lesson, from its title, not one of `taken`. PURE. */
export function madeLessonId(title, taken = []) {
  const base = `made-${String(title || 'lesson').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lesson'}`;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}
