// bank.js — ONE PLACE THE CONTENT LIVES, so two games can draw from it.
//
// Mike, 2026-08-31:
//
//   *"I could see word forge and trivia drawing from the same pool for a lot of people."*
//
// He is right, and the reason is about the person doing the writing rather than about the code.
// Somebody building a syllabus writes sixty vocabulary words once. Making them write those same
// sixty words again in a second format so a second game can use them is the kind of tax that
// makes people stop after the first game.
//
// ---------------------------------------------------------------------------------------
// TWO SHAPES, ONE DOCUMENT — and the sections are what makes it unambiguous
// ---------------------------------------------------------------------------------------
//
// A word row and a question row are both pipe-delimited with three or more fields, so they
// cannot be told apart by looking at them. Guessing — "it ends in a question mark, so it must be
// a question" — would work most of the time, which is the worst possible amount, because the
// rows it got wrong would fail silently and look like the game losing content.
//
// So the document says which is which, using a heading that is ALSO a comment in the format both
// games already have:
//
//     ## words
//     sanguine | cheerfully optimistic | She stayed sanguine about the delay. | 9
//
//     ## questions
//     What is the capital of France? | Paris | London | Rome | Madrid
//
// A bank with NO heading is read as whatever the reader asked for, so **every bank written
// before this file existed still parses exactly as it did.** That is not politeness; a format
// change that silently emptied somebody's word bank would be unrecoverable for anybody who had
// not kept a copy.
//
// ---------------------------------------------------------------------------------------
// *** A WORD ROW CAN BECOME A QUESTION. A QUESTION ROW CANNOT BECOME A WORD. ***
// ---------------------------------------------------------------------------------------
//
// The conversion only runs one way, and pretending otherwise is the trap here. *"sanguine means
// cheerfully optimistic"* contains everything a multiple-choice question needs: a stem, a right
// answer, and — from the rest of the bank — plausible wrong ones that are all real meanings of
// real words rather than invented nonsense. *"What is the capital of France?"* contains nothing
// that would make it a vocabulary entry.
//
// So Word Forge reads the words, Trivia reads the questions AND may draw on the words, and
// nothing tries to run it backwards.

export const KINDS = ['words', 'questions'];

// `## words` / `## questions`. Written as a comment so an older reader skips it rather than
// choking on it.
const HEADING = /^#{1,3}\s*(words?|questions?|vocab(ulary)?|quiz)\s*$/i;

function headingKind(line) {
  const m = line.match(HEADING);
  if (!m) return null;
  return /^(q|quiz)/i.test(m[1]) ? 'questions' : 'words';
}

/**
 * Read a bank.
 *
 * `defaultKind` is what un-headed rows are taken to be — so Word Forge passes `words` and Trivia
 * passes `questions`, and a document that says nothing keeps working for whoever is reading it.
 *
 * Returns `{ words, questions }`, always both, so a caller never has to check whether a key
 * exists before mapping over it.
 */
export function parseBank(text, { defaultKind = 'words' } = {}) {
  const words = [], questions = [];
  let kind = KINDS.includes(defaultKind) ? defaultKind : 'words';
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = headingKind(line);
    if (h) { kind = h; continue; }
    if (line.startsWith('#')) continue;                       // an ordinary comment
    if (!line.includes('|')) continue;
    const p = line.split('|').map((x) => x.trim());
    if (p.length < 2 || !p[0] || !p[1]) continue;             // a half-written row is skipped
    if (kind === 'questions') {
      const [question, answer, ...rest] = p;
      questions.push({ question, answer, wrong: rest.filter(Boolean) });
    } else {
      const [word, meaning, sentence, grade, topic] = p;
      const it = { word, meaning, sentence: sentence || '' };
      if (Number(grade) > 0) it.grade = Number(grade);
      if (topic) it.topic = topic;
      words.push(it);
    }
  }
  return { words, questions };
}

/**
 * Turn vocabulary into quiz questions.
 *
 * *** THE DISTRACTORS ARE OTHER REAL MEANINGS FROM THE SAME BANK, and that is the whole design.
 * *** They are plausible because they are real, they are at the right level because they came
 * from the same syllabus, and — the part that matters most here — **nothing is generated**, so
 * the project's one ratified absolute holds by construction: *if a module probes judgment, being
 * wrong must not be degrading* (`PRINCIPLES.md` §2). An invented wrong answer is exactly where
 * something absurd or belittling would get in.
 *
 * A bank with fewer than two words yields nothing rather than a question with one option. A
 * "multiple choice" with no choice is not a question, and shipping one would look like a bug to
 * the person it was asked of.
 */
export function questionsFromWords(words, { choices = 4, ask = (w) => `What does “${w}” mean?` } = {}) {
  const usable = (words || []).filter((w) => w && w.word && w.meaning);
  if (usable.length < 2) return [];
  return usable.map((w) => ({
    question: ask(w.word),
    answer: w.meaning,
    wrong: usable.filter((o) => o !== w && o.meaning !== w.meaning)
      .slice(0, Math.max(0, choices - 1))
      .map((o) => o.meaning),
    ...(w.topic ? { topic: w.topic } : {}),
    from: w.word,          // so a later reader can tell a derived question from a written one
  }));
}

/**
 * Everything Trivia can ask, given one document.
 *
 * Questions somebody WROTE come first, and derived ones fill in behind them — because a written
 * question is always better than a generated stem, and somebody who wrote fifty questions should
 * see those rather than a vocabulary drill.
 */
export function triviaPool(text, { includeWords = true, choices = 4 } = {}) {
  const { words, questions } = parseBank(text, { defaultKind: 'questions' });
  if (!includeWords) return questions;
  return [...questions, ...questionsFromWords(words, { choices })];
}

// ---------------------------------------------------------------------------------------
// TELLING SOMEBODY WHAT THEY JUST WROTE
// ---------------------------------------------------------------------------------------
//
// A bank is a document somebody edits by hand, at length, probably late, and the failure mode is
// always the same: a row that does not parse is silently absent, and the game looks broken. So
// the editor reports what it read AND what it skipped, with line numbers.
//
// Pure, so the wording is testable — which for the only feedback a hand-edited format has is the
// whole point.
export function checkBank(text, { defaultKind = 'words' } = {}) {
  const problems = [];
  let kind = KINDS.includes(defaultKind) ? defaultKind : 'words';
  let n = 0;
  const lines = String(text || '').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const at = i + 1;
    if (!line) return;
    if (headingKind(line)) { kind = headingKind(line); return; }
    if (line.startsWith('#')) return;
    if (!line.includes('|')) {
      problems.push({ line: at, text: line, why: 'no “|” — a row needs its parts separated by |' });
      return;
    }
    const p = line.split('|').map((x) => x.trim());
    if (p.length < 2 || !p[0] || !p[1]) {
      problems.push({ line: at, text: line, why: kind === 'questions'
        ? 'needs at least a question and an answer' : 'needs at least a word and a meaning' });
      return;
    }
    if (kind === 'questions' && p.length < 3) {
      // Not an error — the game borrows distractors — but worth saying, because somebody who
      // meant to write three wrong answers and typed the wrong separator would never find out.
      problems.push({ line: at, text: line, severity: 'note',
                      why: 'no wrong answers given, so the game will borrow some' });
    }
    n += 1;
  });
  const parsed = parseBank(text, { defaultKind });
  return { rows: n, words: parsed.words.length, questions: parsed.questions.length, problems };
}
