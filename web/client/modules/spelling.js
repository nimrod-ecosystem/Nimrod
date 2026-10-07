// spelling.js — SPELLING (row 2.45). Mike, 2026-09-30: *"Spelling should be another game."*
//
// A word is SAID (with its picture, where the board's own drawings have one) and the player spells
// it: on a scanned letter board with one switch, by touching the letters, or by saying them one at
// a time ("C, A, T") through the same `hear()` seam every voice game uses. Mike's miss flow from
// row 2.31, on the shared engine (`quiz_flow.js`); the hints, in the order the row gives them: the
// FIRST LETTER, then HOW MANY LETTERS (with a blank for each).
//
// *** THE WORD IS NOT ON SCREEN BY DEFAULT. *** Showing it turns spelling into copying, which is a
// different exercise — a real one for somebody relearning letters, so it is one setting away
// (`showWord`). And when speech is OFF the word is shown whatever that setting says: nobody can
// spell a word nobody gave them.
//
// *** SAYING THE WORD IS NOT SPELLING IT. *** A recogniser that hears "cat" gets a gentle "spell it
// one letter at a time" — not a miss, and never counted as a right answer.
//
// The letter board is a new thing: nothing in the client was one (`keyboard.js` is a viewer of key
// bindings, not something to type with). It is scanned by `createScanBoard` in quiz_flow.js, rows
// first by default (the usual AAC shape) or one key at a time — a setting.

import { registerModule } from '../module.js';
import { symbolSvg } from '../aac_symbols.js';
import { hasPicture } from '../word_games_words.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, fill, esc, parseLetters, LETTER_WORDS } from '../quiz_flow.js';
import { quizModule, up } from '../quiz_view.js';

export const GAME = 'spelling';

// The board's own drawings first (every one of them three to six letters), then everyday words the
// board does not draw, which are shown as a picture-less card. Two-letter words (go, up, no) are
// left out: there is nothing to spell in them after the first-letter hint.
const PICTURED = ['hot', 'cold', 'stop', 'wait', 'help', 'love', 'more', 'music', 'mom', 'dad', 'down',
  'out', 'off', 'here', 'there', 'open', 'look', 'like', 'good', 'tired', 'pain', 'yes', 'okay', 'want',
  'make', 'turn', 'get', 'put', 'some', 'what', 'who', 'when', 'where', 'you', 'that', 'not', 'little',
  'change', 'thanks'];
const PLAIN = ['cat', 'dog', 'sun', 'bed', 'cup', 'hat', 'book', 'tree', 'fish', 'bird', 'milk', 'home',
  'rain', 'ball', 'cake', 'door', 'hand', 'moon', 'star', 'shoe'];
export const WORDS = Object.freeze([...PICTURED, ...PLAIN].map((word) => Object.freeze({ word })));

export const LINES = Object.freeze({
  askSpelling: 'Spell {word}.',
  hintFirst: 'it starts with {letter}',
  hintCount: 'it has {count} letters',
  explainSpelling: '{word} is spelled {letters}.',
  notLettersLine: 'I heard {heard}. Spell it one letter at a time.',
});
const LINE_LABELS = {
  askSpelling: 'The question', hintFirst: 'First hint (the first letter)', hintCount: 'Second hint (how many letters)',
  explainSpelling: 'The answer, spelled out', notLettersLine: 'A whole word said instead of letters',
};

export const DEFAULTS = Object.freeze({
  // Hidden by default: see the header. A setting, because copying is a real exercise too.
  showWord: false,
  // Check as soon as there are enough letters, which saves a press on every word. Off for
  // somebody who wants to look at it before committing, who then presses Check.
  checkWhenFull: true,
  boardScan: 'rows',
  // Up to four letters by default: the first sitting should be winnable. Longer words (up to six)
  // are one setting away.
  wordLength: 'short',
  ...LINES,
});

const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'How many are right. A Scoreboard on the same screen can show it instead.' }),
  { key: 'wordLength', label: 'Words', kind: 'choice', default: 'short', level: 'essential',
    options: [{ value: 'short', label: 'Short (up to four letters)' }, { value: 'longer', label: 'Up to six letters' }] },
  { key: 'showWord', label: 'Show the word on screen', default: false, level: 'standard',
    onLabel: 'Yes: copy it', offLabel: 'No: spell it from hearing it',
    note: 'With speech off, the word is always shown.' },
  { key: 'checkWhenFull', label: 'Check the spelling', default: true, level: 'standard',
    onLabel: 'As soon as it has enough letters', offLabel: 'Only when Check is pressed' },
  { key: 'boardScan', label: 'Letter board with a switch', kind: 'choice', default: 'rows', level: 'standard',
    options: [{ value: 'rows', label: 'A row, then a letter' }, { value: 'keys', label: 'One key at a time' }] },
  ...flowSettings({ lines: LINES, labels: LINE_LABELS, sayChoice: false }),
];

/** The letter board: A to Z in rows of six, then Delete, Check and Hear it. */
export function lettersBoard() {
  const L = 'abcdefghijklmnopqrstuvwxyz'.split('').map((key) => ({ key, label: key.toUpperCase() }));
  const rows = [];
  for (let i = 0; i < L.length; i += 6) rows.push(L.slice(i, i + 6));
  rows.push([{ cmd: 'erase', label: 'Delete' }, { cmd: 'check', label: 'Check' }, { cmd: 'repeat', label: 'Hear it' }]);
  return rows;
}
const BOARD = lettersBoard();

const spelledOut = (w) => up(w).split('').join(', ');
const lettersOnly = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');

// Whole utterances that are commands, not letters. Checked BEFORE letters, and only as the whole
// thing said, so "be" (the letter B) can never be mistaken for one.
const COMMANDS = {
  delete: 'erase', back: 'erase', backspace: 'erase', undo: 'erase',
  'start over': 'clear', clear: 'clear',
  check: 'check', done: 'check', finished: 'check',
  'say it again': 'repeat', repeat: 'repeat', again: 'repeat',
};

const adapter = {
  items: (c) => WORDS.filter((w) => w.word.length <= (c.wordLength === 'longer' ? 6 : 4)),
  entry: () => 'letters',
  ask: (it, c) => fill(c.askSpelling, { word: it.word }),
  judge: (it, v) => { const s = lettersOnly(v); return s ? s === it.word : null; },
  hint: (it, n, c) => (n === 1 ? fill(c.hintFirst, { letter: it.word[0].toUpperCase() })
    : n === 2 ? fill(c.hintCount, { count: it.word.length }) : ''),
  answer: (it) => it.word,
  explain: (it, answer, c) => fill(c.explainSpelling, { word: it.word, letters: spelledOut(it.word) }),
  maxEntry: (it) => it.word.length + 3,
  vocab: () => LETTER_WORDS,
  heardText: (v) => spelledOut(lettersOnly(v)),
  fromVoice(it, { text }, c) {
    if (COMMANDS[text]) return { command: COMMANDS[text] };
    const letters = parseLetters(text);
    if (letters) return { append: letters };
    return text ? { note: fill(c.notLettersLine, { heard: text }) } : null;
  },
};

// ---------------------------------------------------------------------------------------
// THE VIEW — the picture, the heading, the typed letters, the board
// ---------------------------------------------------------------------------------------
const showsWord = (c) => !!c.showWord || c.speak === false;

const view = {
  askHtml(s, c) {
    return showsWord(c) ? `Spell <em>${esc(up(s.item.word))}</em>` : 'Spell the word you hear.';
  },
  left(s) {
    const w = s.item.word;
    if (!hasPicture(w)) return '';
    return `<figure class="wg-pic" data-has-pic>${symbolSvg(w)}</figure>`;
  },
  entryHtml(s) {
    const typed = up(s.entry).split('');
    const counted = s.hintsGiven >= 2;
    const cells = counted
      ? Array.from({ length: Math.max(s.item.word.length, typed.length) }, (_, i) => (typed[i]
        ? `<span>${esc(typed[i])}</span>` : '<span class="qz-blank">_</span>'))
      : typed.map((l) => `<span>${esc(l)}</span>`);
    return `<p class="qz-entry" data-entry aria-label="typed so far">${cells.join(' ') || '<span class="qz-blank">…</span>'}</p>`;
  },
  board: () => BOARD,
  pairHtml: (s) => `<div class="wg-pair" data-pair>${hasPicture(s.pair.answer) ? symbolSvg(s.pair.answer) : ''}<span>${esc(up(s.pair.answer))}</span></div>`,
  explainHtml: (s) => esc(`${up(s.pair.answer)}: ${spelledOut(s.pair.answer)}`),
  pointNote: (game, item) => `spelling: ${item.word}`,
};
// The question and its pictures, for another host to ask the same words (Quiz mix, modules/quiz_mix.js).
export { adapter as SPELLING_ADAPTER, view as SPELLING_VIEW };

registerModule(
  { type: GAME, title: 'Spelling', core: 'new',
    description: 'A word is said with its picture, and the player spells it on a letter board: '
      + 'one switch, touch, or saying the letters.',
    // `local`: the words, pictures and rules are all in this build; nothing is fetched.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  quizModule({ type: GAME, title: 'Spelling', scoreLabel: 'Spelling: right answers',
    games: { spelling: adapter }, defaults: DEFAULTS, view }),
);
