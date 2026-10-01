// brain_banks.js — THE QUESTIONS for the quick brain games (row 2.45), at five levels. Data, no DOM.
//
// Mike, 2026-10-01 (notes AQ/AR): a well-liked console brain-training game is the model; build OUR
// OWN "quick mini-games". Nothing here is copied from any game: the shapes are drawn here, the word
// sets are everyday words written for this file (some reuse `think_banks.js`'s groups), and the
// counts and number patterns are generated.
//
// Every question has a stable `id` (a rating is keyed by it): generated ones from a fixed seed, so
// they are the same on every load. Change a question, change its id. A `level` is where its rating
// STARTS; play moves it (`rating.js`).

// ---------------------------------------------------------------------------------------
// SHAPES — drawn here, `currentColor` only (the theme colours them; a printed one is plain ink).
// They differ by OUTLINE, never by colour, so nobody who cannot tell two colours apart loses a
// question.
// ---------------------------------------------------------------------------------------
const SHAPE_PATHS = {
  circle: '<circle cx="50" cy="50" r="38"/>',
  square: '<rect x="14" y="14" width="72" height="72" rx="6"/>',
  triangle: '<path d="M50 10 L91 86 L9 86 Z"/>',
  star: '<path d="M50 7 L61 38 L94 38 L67 57 L78 90 L50 70 L22 90 L33 57 L6 38 L39 38 Z"/>',
  heart: '<path d="M50 88 C20 66 7 48 7 32 C7 18 18 9 30 9 C39 9 46 14 50 22 C54 14 61 9 70 9 C82 9 93 18 93 32 C93 48 80 66 50 88 Z"/>',
};
export const SHAPE_NAMES = Object.freeze(Object.keys(SHAPE_PATHS));
const SHAPE_PLURAL = { circle: 'circles', square: 'squares', triangle: 'triangles', star: 'stars', heart: 'hearts' };
export const isShape = (name) => Object.prototype.hasOwnProperty.call(SHAPE_PATHS, name);
export function shapeSvg(name) {
  return isShape(name) ? `<svg viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">${SHAPE_PATHS[name]}</svg>` : '';
}

function lcg(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function hashOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
/** A stable mixed order for a list, the same every time this id comes up. */
export function mixedOrder(id, list) {
  const out = list.slice();
  let h = hashOf(id) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const slug = (xs) => xs.join('-').replace(/[^a-z0-9-]+/gi, '_').toLowerCase();

// ---------------------------------------------------------------------------------------
// WHICH ONE IS DIFFERENT — three alike and one not. `same` finishes "the others are ...".
//   1 shapes (three circles and a square)
//   2 everyday words from groups far apart
//   3 closer groups
//   4 close groups where knowing matters more than looking (a bat is not a bird)
//   5 a shared PROPERTY rather than a kind (things that are hot)
// ---------------------------------------------------------------------------------------
const ODD_WORDS = {
  2: [
    [['apple', 'banana', 'pear'], 'dog', 'fruit'], [['dog', 'cat', 'cow'], 'chair', 'animals'],
    [['shirt', 'sock', 'hat'], 'apple', 'clothes'], [['milk', 'juice', 'water'], 'shoe', 'drinks'],
    [['car', 'bus', 'train'], 'banana', 'vehicles'], [['red', 'blue', 'green'], 'spoon', 'colours'],
    [['chair', 'table', 'bed'], 'fish', 'furniture'], [['one', 'two', 'three'], 'bread', 'numbers'],
    [['eye', 'nose', 'mouth'], 'car', 'parts of the face'], [['bread', 'cheese', 'eggs'], 'bike', 'food'],
  ],
  3: [
    [['dog', 'cat', 'horse'], 'robin', 'animals with four legs'], [['apple', 'banana', 'grape'], 'carrot', 'fruit'],
    [['car', 'bus', 'truck'], 'boat', 'things that drive on roads'], [['piano', 'drum', 'guitar'], 'radio', 'instruments'],
    [['hammer', 'saw', 'drill'], 'spoon', 'tools'], [['rose', 'daisy', 'tulip'], 'oak', 'flowers'],
    [['bee', 'ant', 'fly'], 'frog', 'insects'], [['spring', 'summer', 'winter'], 'monday', 'seasons'],
    [['doctor', 'teacher', 'farmer'], 'hospital', 'jobs'], [['cup', 'mug', 'glass'], 'plate', 'things you drink from'],
  ],
  4: [
    [['robin', 'eagle', 'duck'], 'bat', 'birds'], [['carrot', 'potato', 'peas'], 'apple', 'vegetables'],
    [['gold', 'silver', 'iron'], 'wood', 'metals'], [['mars', 'venus', 'jupiter'], 'moon', 'planets'],
    [['march', 'july', 'october'], 'friday', 'months'], [['france', 'japan', 'brazil'], 'paris', 'countries'],
    [['tennis', 'golf', 'soccer'], 'chess', 'sports played with a ball'], [['knife', 'fork', 'spoon'], 'plate', 'cutlery'],
    [['oak', 'maple', 'pine'], 'rose', 'trees'],
  ],
  5: [
    [['sun', 'fire', 'oven'], 'snow', 'hot'], [['car', 'bike', 'skateboard'], 'sled', 'things with wheels'],
    [['bird', 'plane', 'kite'], 'car', 'things that fly'], [['ice', 'snow', 'frost'], 'steam', 'cold'],
    [['lemon', 'banana', 'corn'], 'grass', 'yellow'], [['glass', 'window', 'water'], 'brick', 'things you can see through'],
    [['feather', 'cotton', 'pillow'], 'rock', 'soft'], [['book', 'letter', 'newspaper'], 'radio', 'things you read'],
    [['clock', 'watch', 'timer'], 'ruler', 'things that measure time'], [['piano', 'bell', 'drum'], 'pillow', 'things that make a sound'],
    [['milk', 'snow', 'paper'], 'grass', 'white'],
  ],
};
function oddBank() {
  const out = [];
  for (const a of SHAPE_NAMES) {
    for (const b of SHAPE_NAMES) {
      if (a === b) continue;
      const id = `bb-odd-1-${a}-${b}`;
      out.push(Object.freeze({ id, kind: 'odd', level: 1, odd: b, same: SHAPE_PLURAL[a], shapes: true,
        tiles: Object.freeze(mixedOrder(id, [a, a, a, b])) }));
    }
  }
  for (const [level, rows] of Object.entries(ODD_WORDS)) {
    for (const [three, odd, same] of rows) {
      const id = `bb-odd-${level}-${slug([...three, odd])}`;
      out.push(Object.freeze({ id, kind: 'odd', level: Number(level), odd, same, shapes: false,
        tiles: Object.freeze(mixedOrder(id, [...three, odd])) }));
    }
  }
  return out;
}
export const ODD = Object.freeze(oddBank());

// ---------------------------------------------------------------------------------------
// QUICK COUNT — how many dots, in rows (`rows` is the dots per row). No time limit by default.
//   1 one to four   2 four to six, dice-like   3 seven to nine   4 ten to fourteen   5 fifteen to twenty
// Rows of five past ten, so they can be counted in fives.
// ---------------------------------------------------------------------------------------
const COUNT_ROWS = {
  1: [[1], [2], [1, 1], [3], [2, 1], [1, 1, 1], [4], [2, 2], [3, 1]],
  2: [[2, 2, 1], [1, 2, 1], [3, 2], [2, 1, 2], [5], [3, 3], [2, 2, 2], [6], [1, 3, 1]],
  3: [[4, 3], [3, 1, 3], [2, 3, 2], [4, 4], [3, 2, 3], [2, 2, 2, 2], [3, 3, 3], [5, 4], [4, 1, 4]],
  4: [[5, 5], [4, 2, 4], [4, 3, 4], [4, 4, 4], [6, 6], [3, 3, 3, 3], [5, 3, 5], [5, 4, 5], [5, 5, 1]],
  5: [[5, 5, 5], [4, 4, 4, 4], [6, 4, 6], [5, 5, 5, 2], [6, 6, 6], [5, 4, 4, 5], [5, 5, 5, 4], [5, 5, 5, 5],
    [4, 4, 4, 4, 4], [5, 5, 5, 3]],
};
export const COUNT = Object.freeze(Object.entries(COUNT_ROWS).flatMap(([level, list]) => list.map((rows) => {
  const n = rows.reduce((a, b) => a + b, 0);
  return Object.freeze({ id: `bb-count-${level}-${rows.join('_')}`, kind: 'count', level: Number(level), n, rows: Object.freeze(rows.slice()) });
})));

// ---------------------------------------------------------------------------------------
// WHAT COMES NEXT — a number pattern, and the rule said as a hint.
//   1 counting on by one   2 twos, tens, counting down   3 fives, threes, take away two
//   4 bigger steps either way   5 doubling, halving, gaps that grow
// ---------------------------------------------------------------------------------------
const step = (by) => (by > 0 ? `each one is ${by} more` : `each one is ${-by} less`);
function arith(level, starts, by, len = 3) {
  return starts.map((s) => {
    const seq = Array.from({ length: len }, (_, i) => s + i * by);
    return { level, seq, answer: s + len * by, rule: step(by) };
  });
}
const NEXT_ROWS = [
  ...arith(1, [1, 2, 3, 4, 5, 6, 7, 8, 9], 1),
  ...arith(2, [2, 1, 3, 4], 2), ...arith(2, [10, 20], 10), ...arith(2, [9, 6, 10, 8], -1),
  ...arith(3, [5, 10, 15], 5), ...arith(3, [3, 1, 2], 3), ...arith(3, [10, 12], -2), ...arith(3, [13, 7], 10),
  ...arith(4, [4, 1], 4), ...arith(4, [6], 6), ...arith(4, [15, 20], -3), ...arith(4, [30], -5), ...arith(4, [9], 9),
  ...arith(4, [11], 11), ...arith(4, [90], -10), ...arith(4, [25], 25),
  { level: 5, seq: [1, 2, 4, 8], answer: 16, rule: 'each one is double the one before' },
  { level: 5, seq: [3, 6, 12], answer: 24, rule: 'each one is double the one before' },
  { level: 5, seq: [5, 10, 20], answer: 40, rule: 'each one is double the one before' },
  { level: 5, seq: [64, 32, 16], answer: 8, rule: 'each one is half the one before' },
  { level: 5, seq: [80, 40, 20], answer: 10, rule: 'each one is half the one before' },
  { level: 5, seq: [1, 2, 4, 7], answer: 11, rule: 'the jump gets one bigger each time' },
  { level: 5, seq: [1, 3, 6, 10], answer: 15, rule: 'the jump gets one bigger each time' },
  { level: 5, seq: [1, 4, 9, 16], answer: 25, rule: 'one times one, two times two, three times three, and on' },
  { level: 5, seq: [2, 3, 5, 6, 8], answer: 9, rule: 'it goes up one, then up two, then up one again' },
  { level: 5, seq: [10, 20, 15, 25, 20], answer: 30, rule: 'it goes up ten, then down five' },
];
export const NEXT = Object.freeze(NEXT_ROWS.map((r) => Object.freeze({
  id: `bb-next-${r.level}-${r.seq.join('_')}`, kind: 'next', level: r.level,
  seq: Object.freeze(r.seq.slice()), answer: r.answer, rule: r.rule,
})));

// ---------------------------------------------------------------------------------------
// REMEMBER THE ORDER — shown and said, then hidden; pick them in the same order.
//   1 two shapes   2 three shapes   3 three words and one that was not there
//   4 four words and one extra       5 five words and one extra
// The extra is the one to leave out: remembering WHICH as well as in what order.
// ---------------------------------------------------------------------------------------
export const ORDER_WORDS = Object.freeze(['cat', 'dog', 'sun', 'cup', 'hat', 'bed', 'car', 'tree', 'fish', 'bird',
  'ball', 'book', 'cake', 'shoe', 'key', 'bus', 'moon', 'star', 'boat', 'bell', 'apple', 'chair', 'clock', 'frog', 'house']);
const ORDER_LEVELS = [
  { level: 1, len: 2, extra: 0, from: SHAPE_NAMES },
  { level: 2, len: 3, extra: 0, from: SHAPE_NAMES },
  { level: 3, len: 3, extra: 1, from: ORDER_WORDS },
  { level: 4, len: 4, extra: 1, from: ORDER_WORDS },
  { level: 5, len: 5, extra: 1, from: ORDER_WORDS },
];
function orderBank() {
  const out = [];
  for (const L of ORDER_LEVELS) {
    const r = lcg(2000 + L.level);
    const seen = new Set();
    let guard = 0;
    while (out.filter((q) => q.level === L.level).length < 10 && guard++ < 2000) {
      const pool = L.from.slice();
      const pick = [];
      while (pick.length < L.len + L.extra) pick.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
      const seq = pick.slice(0, L.len);
      const extra = pick.slice(L.len);
      const id = `bb-order-${L.level}-${slug(seq)}${extra.length ? `-x-${slug(extra)}` : ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(Object.freeze({ id, kind: 'order', level: L.level, seq: Object.freeze(seq), extra: Object.freeze(extra),
        // The board's order: everything, mixed, the same every time.
        picks: Object.freeze(mixedOrder(id, [...seq, ...extra])) }));
    }
  }
  return out;
}
export const ORDER = Object.freeze(orderBank());

export const BANKS = Object.freeze({ odd: ODD, order: ORDER, count: COUNT, next: NEXT });
