// simple_math.js — SIMPLE MATH (row 2.45). Mike, 2026-09-30: *"Simple version of math."*
//
// `algebra.js` already exists and is the other end of the scale: solve for x, with a calculator on
// screen. This is the near end — plus, minus and times on small numbers — for somebody for whom
// "what is 3 plus 4?" is the right-sized question today. Which sums and how big the numbers get are
// settings (Porting Rule 1), and the defaults are on Mike's list.
//
// THREE WAYS TO ANSWER, the row's three:
//   * a switch: one number offered at a time, "Is it 7?" — Yes on the right one, No for the next.
//     The same shape as word games, so a person who has learned one has learned both.
//   * a number pad on screen (a setting, `answerWith`), touched or scanned like spelling's board.
//   * aloud: "seven", "it's seven", "7" — through the shared `hear()` seam.
//
// THE HINTS, in order: HOW TO COUNT IT ("start at 3 and count on 4 more"), with DOTS to count on
// screen (a setting: with the hint, always, or never); then A RANGE that never names the answer.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, fill, esc, parseNumber, numberWords, shuffle } from '../quiz_flow.js';
import { quizModule } from '../quiz_view.js';

export const GAME = 'simple_math';

export const LINES = Object.freeze({
  askAdd: 'What is {a} plus {b}?',
  askSub: 'What is {a} minus {b}?',
  askMul: 'What is {a} times {b}?',
  offerLine: 'Is it {candidate}?',
  hintAdd: 'start at {a} and count on {b} more',
  hintSub: 'start at {a} and count back {b}',
  hintMul: 'think of {a} groups of {b}',
  hintRange: 'it is more than {lo} and less than {hi}',
  explainAdd: '{a} plus {b} is {answer}.',
  explainSub: '{a} minus {b} is {answer}.',
  explainMul: '{a} times {b} is {answer}.',
});
const LINE_LABELS = {
  askAdd: 'Question: plus', askSub: 'Question: minus', askMul: 'Question: times',
  offerLine: 'Offering one number', hintAdd: 'First hint: plus', hintSub: 'First hint: minus',
  hintMul: 'First hint: times', hintRange: 'Second hint: a range', explainAdd: 'The answer: plus',
  explainSub: 'The answer: minus', explainMul: 'The answer: times',
};

export const OPS = ['add', 'sub', 'addsub', 'mul', 'all'];
export const DEFAULTS = Object.freeze({
  // Plus and minus within ten: the smallest sums that are still two kinds of question. Times is a
  // step up and is one setting away. A GUESS, on Mike's list.
  ops: 'addsub',
  maxNumber: 10,
  // "Is it 7?" by default: it works on one switch, on touch and alongside a voice. The pad is for
  // somebody who wants to work the number out rather than recognise it.
  answerWith: 'offer',
  // The dots arrive WITH the hint, so a first try is a real try.
  dots: 'hint',
  checkWhenFull: true,
  boardScan: 'rows',
  ...LINES,
});

const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'How many are right. A Scoreboard on the same screen can show it instead.' }),
  { key: 'ops', label: 'Which sums', kind: 'choice', default: 'addsub', level: 'essential',
    options: [{ value: 'add', label: 'Plus' }, { value: 'sub', label: 'Minus' },
              { value: 'addsub', label: 'Plus and minus' }, { value: 'mul', label: 'Times' },
              { value: 'all', label: 'Plus, minus and times' }] },
  { key: 'maxNumber', label: 'Numbers up to', kind: 'choice', default: 10, level: 'essential',
    options: [5, 10, 12, 20].map((v) => ({ value: v, label: String(v) })),
    note: 'Plus stays within this total; minus starts from no more than this; times multiplies numbers up to it.' },
  { key: 'answerWith', label: 'Answer by', kind: 'choice', default: 'offer', level: 'standard',
    options: [{ value: 'offer', label: 'Yes or no to one number at a time' },
              { value: 'pad', label: 'A number pad' }] },
  { key: 'dots', label: 'Dots to count', kind: 'choice', default: 'hint', level: 'standard',
    options: [{ value: 'hint', label: 'With the hint' }, { value: 'always', label: 'Always' },
              { value: 'never', label: 'Never' }] },
  { key: 'checkWhenFull', label: 'Check a typed number', default: true, level: 'advanced',
    onLabel: 'As soon as it has enough digits', offLabel: 'Only when Check is pressed' },
  { key: 'boardScan', label: 'Number pad with a switch', kind: 'choice', default: 'rows', level: 'advanced',
    options: [{ value: 'rows', label: 'A row, then a number' }, { value: 'keys', label: 'One key at a time' }] },
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

const int = (lo, hi, rand) => lo + Math.floor(rand() * (hi - lo + 1));

/** `n` problems for these settings. Pure: the suite checks every range on hundreds of them. */
export function makeProblems(c = {}, rand = Math.random, n = 20) {
  const ops = OPS.includes(c.ops) ? c.ops : DEFAULTS.ops;
  const max = [5, 10, 12, 20].includes(Number(c.maxNumber)) ? Number(c.maxNumber) : DEFAULTS.maxNumber;
  const kinds = ops === 'addsub' ? ['add', 'sub'] : ops === 'all' ? ['add', 'sub', 'mul'] : [ops];
  const out = [];
  for (let i = 0; i < n; i++) {
    const op = kinds[Math.min(kinds.length - 1, Math.floor(rand() * kinds.length))];
    let a; let b; let answer;
    if (op === 'add') { a = int(1, max - 1, rand); b = int(1, max - a, rand); answer = a + b; }
    else if (op === 'sub') { a = int(2, max, rand); b = int(1, a - 1, rand); answer = a - b; }
    else { a = int(1, max, rand); b = int(1, max, rand); answer = a * b; }
    out.push(Object.freeze({ op, a, b, answer }));
  }
  return out;
}

/** The number pad: 1-9, then 0, Delete, Check. */
export function padBoard() {
  const d = (key) => ({ key, label: key });
  return [['1', '2', '3'].map(d), ['4', '5', '6'].map(d), ['7', '8', '9'].map(d),
    [d('0'), { cmd: 'erase', label: 'Delete' }, { cmd: 'check', label: 'Check' }]];
}
const PAD = padBoard();

const WORD = { add: 'plus', sub: 'minus', mul: 'times' };
const SYM = { add: '+', sub: '−', mul: '×' };
const lineFor = (c, kind, op) => c[`${kind}${op === 'add' ? 'Add' : op === 'sub' ? 'Sub' : 'Mul'}`];

const adapter = {
  items: (c, rand) => makeProblems(c, rand, 20),
  entry: (c) => (c.answerWith === 'pad' ? 'digits' : null),
  ask: (it, c) => fill(lineFor(c, 'ask', it.op), it),
  candidates(it, c, rand) {
    const near = [it.answer - 2, it.answer - 1, it.answer + 1, it.answer + 2].filter((v) => v >= 0);
    return shuffle([it.answer, ...shuffle(near, rand).slice(0, 2)], rand).map(String);
  },
  offer: (it, cand, c) => fill(c.offerLine, { candidate: cand }),
  judge(it, v) {
    const n = typeof v === 'number' ? v : parseNumber(String(v));
    return n == null ? null : n === it.answer;
  },
  hint(it, n, c) {
    if (n === 1) return fill(lineFor(c, 'hint', it.op), it);
    if (n === 2) return fill(c.hintRange, { lo: Math.max(0, it.answer - 2), hi: it.answer + 2 });
    return '';
  },
  answer: (it) => String(it.answer),
  explain: (it, answer, c) => fill(lineFor(c, 'explain', it.op), it),
  maxEntry: () => 3,
  vocab: (it) => numberWords(Math.max(it.answer + 2, 20)),
  heardText: (v) => String(v),
  fromVoice(it, { raw }) {
    const n = parseNumber(raw);
    return n == null ? null : { value: String(n) };
  },
};

// ---------------------------------------------------------------------------------------
// THE VIEW — the sum as symbols, and dots to count
// ---------------------------------------------------------------------------------------
function dotsHtml(it) {
  const row = (n, away = 0) => `<div class="qz-dotrow">${Array.from({ length: n }, (_, i) =>
    `<span class="qz-dot"${i >= n - away ? ' data-away' : ''}></span>`).join('')}</div>`;
  if (it.op === 'add') return `<div class="qz-dots" data-dots>${row(it.a)}${row(it.b)}</div>`;
  if (it.op === 'sub') return `<div class="qz-dots" data-dots>${row(it.a, it.b)}</div>`;
  return `<div class="qz-dots" data-dots>${Array.from({ length: it.a }, () => row(it.b)).join('')}</div>`;
}
// Dots are for counting, so a sum too big to count on screen does not get them.
const countable = (it) => (it.op === 'mul' ? it.a * it.b <= 40 : it.a + it.b <= 40);

const view = {
  askHtml: (s) => `<span data-sum>${esc(s.item.a)} ${SYM[s.item.op]} ${esc(s.item.b)} = ?</span>`,
  left(s, c) {
    if (c.dots === 'never' || !countable(s.item)) return '';
    if (c.dots === 'hint' && s.hintsGiven < 1) return '';
    return dotsHtml(s.item);
  },
  entryHtml: (s) => `<p class="qz-entry" data-entry aria-label="typed so far">${s.entry ? esc(s.entry) : '<span class="qz-blank">?</span>'}</p>`,
  board: () => PAD,
  pairHtml: (s) => `<div class="wg-pair" data-pair>${esc(s.item.a)} ${SYM[s.item.op]} ${esc(s.item.b)} = ${esc(s.pair.answer)}</div>`,
  pointNote: (game, item) => `simple math: ${item.a} ${WORD[item.op]} ${item.b}`,
};

registerModule(
  { type: GAME, title: 'Simple math', core: 'new',
    description: 'Plus, minus and times on small numbers. Answer yes or no to one number at a time, '
      + 'on a number pad, or aloud.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  quizModule({ type: GAME, title: 'Simple math', scoreLabel: 'Simple math: right answers',
    games: { math: adapter }, defaults: DEFAULTS, view }),
);
