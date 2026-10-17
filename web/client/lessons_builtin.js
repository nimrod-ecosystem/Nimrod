// lessons_builtin.js - THE LESSONS THAT COME WITH NIMROD, as lesson files (lesson_file.js). Row 2.92.
//
// Mike, 2026-10-17: "Let's get two started: right to repair and Numbers 0 through 9." Numbers 0 to 9 is here, written
// from chat's draft (Nimrod_Ecosystem docs/from_chat/first_two_lessons_20261017.md). Right to repair is not: it is
// all research, and chat has invented no facts for it; it arrives when an AI runs the drafted prompt (Mike's call:
// chat now, or Cici on the desktop).
//
// NUMBERS 0 TO 9, as drafted: short classes so a session can stop anywhere; one beat for the numeral and one for
// that many things; five-frames from 5 up (so 7 reads as 5 and 2); zero as none; matching questions in the trivia
// shape (Quiz mix can mix them in); counting up and down; numbers around you. No citations: no facts beyond the
// numbers themselves (Mike: "Only facts" are cited).
// THE LOOK (grown-up / child) is chat's suggestion and still a question for Mike: the things counted change (cups
// and keys, or ducks and apples), never the lesson. Whether this level suits any one person is for the people who
// know them to judge - the draft says so, and so does this.

const GROWN = ['cup', 'key', 'coin', 'chair'];
const CHILD = ['duck', 'apple', 'ball', 'star'];
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const counting = (n) => WORDS.slice(1, n + 1).join(', ');

function meet(n) {
  const i = n % 4;
  return [
    { say: `${cap(WORDS[n])}.`, show: { kind: 'numeral', n }, move: 'title-rise' },
    { say: `${cap(counting(n))}.`, move: 'count-in',
      show: { kind: 'count', n, ...(n >= 5 ? { frame: 'five' } : {}), thing: GROWN[i], looks: { grownup: { thing: GROWN[i] }, child: { thing: CHILD[i] } } } },
  ];
}
const match = (n, wrong, i) => ({
  say: 'How many?',
  show: { kind: 'count', n, ...(n >= 5 ? { frame: 'five' } : {}), thing: GROWN[i], looks: { grownup: { thing: GROWN[i] }, child: { thing: CHILD[i] } } },
  ask: { question: 'How many are there?', answer: String(n), wrong: wrong.map(String), why: `Count them: ${counting(n)}.` },
});
const around = (grown, child, say) => ({ say, show: { kind: 'picture', of: grown, looks: { grownup: { of: grown }, child: { of: child } } }, move: 'fade' });

export const NUMBERS_0_9 = Object.freeze({
  about: { title: 'Numbers 0 to 9', subject: 'Numbers', for: 'anyone learning or relearning numbers',
    length: 'short classes; stop anywhere', language: 'en' },
  sources: [],
  classes: [
    { title: 'Meet 1 to 4', goal: 'Say and recognise 1, 2, 3 and 4, and count that many things.',
      beats: [{ say: 'Let’s meet some numbers.', show: { kind: 'heading', text: 'Meet 1 to 4' }, move: 'title-rise' },
        ...[1, 2, 3, 4].flatMap(meet)] },
    { title: 'Meet 5 to 9', goal: 'Say and recognise 5 to 9, seeing each as five and some more.',
      beats: [{ say: 'Now five to nine. A full row is five.', show: { kind: 'heading', text: 'Meet 5 to 9' }, move: 'title-rise' },
        ...[5, 6, 7, 8, 9].flatMap(meet)] },
    { title: 'Zero', goal: 'Know that zero means none.',
      beats: [
        { say: 'Zero.', show: { kind: 'numeral', n: 0 }, move: 'title-rise' },
        { say: 'Zero means none. There is nothing here.', show: { kind: 'count', n: 0, thing: 'cup', looks: { grownup: { thing: 'cup' }, child: { thing: 'apple' } } }, move: 'fade' },
      ] },
    { title: 'Match', goal: 'Match a number of things to its numeral.',
      beats: [match(3, [2, 5], 0), match(6, [4, 8], 1), match(2, [1, 3], 2), match(8, [6, 9], 3), match(5, [4, 7], 0)] },
    { title: 'In order', goal: 'Count from 0 up to 9, and back down.',
      beats: [
        { say: 'Count up with me: zero, one, two, three, four, five, six, seven, eight, nine.',
          show: { kind: 'row', items: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] }, move: 'light-in-turn' },
        { say: 'And back down: nine, eight, seven, six, five, four, three, two, one, zero.',
          show: { kind: 'row', items: ['9', '8', '7', '6', '5', '4', '3', '2', '1', '0'] }, move: 'light-in-turn' },
      ] },
    { title: 'Around you', goal: 'Notice numbers in everyday things.',
      beats: [
        around('a clock face', 'a die', 'Numbers are all around us.'),
        around('a phone keypad', 'a birthday cake with candles', 'Here are some more.'),
        around('a TV remote', 'a hopscotch grid', 'Can you see the numbers?'),
        around('a price tag', 'a row of numbered doors', 'Numbers tell us how many, and which one.'),
      ] },
  ],
  charts: [],
  notes: ['numbers', 'counting', 'zero'],
  questions: [
    { question: 'Which number means none?', answer: '0', wrong: ['1', '9'], why: 'Zero means none.' },
    { question: 'Which comes after 6?', answer: '7', wrong: ['5', '9'], why: 'Six, seven.' },
    { question: 'Which is the biggest?', answer: '9', wrong: ['6', '3'], why: 'Nine is the most of these.' },
  ],
});

/** The built-in lessons, by id: what the Lesson module offers before anybody adds their own. */
export const BUILTIN_LESSONS = Object.freeze([
  Object.freeze({ id: 'numbers-0-9', label: 'Numbers 0 to 9', lesson: NUMBERS_0_9 }),
]);
