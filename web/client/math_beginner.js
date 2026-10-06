// math_beginner.js — MATH FOR ABSOLUTE BEGINNERS (row 2.45): the game both `modules/algebra.js`
// ("Math", at its Beginner level) and `modules/simple_math.js` (the old panel) mount.
//
// Mike, 2026-09-30: *"Simple version of math."* Then, 2026-10-01: *"The simple math isn't a separate
// game... the math module should have some questions for absolute beginners."* So this is now THE
// BEGINNER LEVEL OF MATH (`algebra.js`, labelled "Math": its "Which problems" setting gains
// "Beginner"), and this file holds what that level is: counting dots, then plus, minus and times on
// small numbers, asked one at a time with the shared miss flow.
//
// WHY A FILE OF ITS OWN, NOT INSIDE `modules/simple_math.js`: importing a module file registers it.
// If Math imported simple_math.js, every page that has Math would register — and so offer — the
// retired Simple math panel too. Here, it registers nothing; simple_math.js is the one-line
// registration a screen that still has that panel loads.
//
// *** WHAT HAPPENS TO A `simple_math` PANEL SOMEBODY ALREADY HAS ***
// It keeps working, exactly as it did. The type stays registered (a saved screen names its panels by
// type, the switch bindings in actions.js are keyed `simple_math/...`, and points and scores already
// recorded say `simple_math`), and it mounts THIS SAME beginner game with its own saved settings,
// which use the same keys as Math's beginner level. It stays on the FIXED sums it was set to
// (`mathLevel: 'fixed'`): somebody chose "plus and minus within ten", and a panel that started
// counting dots by itself would be the software overruling them. The adaptive ladder is one setting
// away on it. What changes is only that it is no longer OFFERED: the catalog lists it as folded into
// Math (like `interstitials`), and the composer stops adding new ones. The other ways were worse:
//   * rewriting saved screens to `algebra` needs a migration in the layout loader (not this module's
//     to change), breaks every `simple_math/*` binding, and splits its score and points history;
//   * deleting the type turns the panel into "no module registered" on somebody's screen.
//
// THREE WAYS TO ANSWER: aloud ("seven", "it's seven", "7"), three numbers to tap or step through on a
// switch, or a number pad (`answerWith`). With the numbers, "Is it 7?" one at a time is the `answerBy`
// option (2026-10-02 late; see DEFAULTS).
//
// HINTS, in order: HOW TO COUNT IT, with DOTS to count (with the hint, always, or never); then A RANGE
// that never names the answer.
//
// LEVELS (`mathLevel`): 'adaptive' — each player climbs the beginner ladder below on `rating.js`'s
// rules (Math's default); 'fixed' — the sums and the size set by hand (the old panel's default).

import { ownScoreField } from './score_source.js';
import { flowSettings, answerByField, fill, esc, parseNumber, numberWords, shuffle } from './quiz_flow.js';
import { quizModule } from './quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openPersonLadder } from './adaptive_play.js';

export const GAME = 'simple_math';
// The ladder's name for this game. ONE rating per player for beginner math, whichever panel (Math at
// its beginner level, or an old Simple math panel) they play it on.
export const RATING_GAME = 'math';

export const LINES = Object.freeze({
  askAdd: 'What is {a} plus {b}?',
  askSub: 'What is {a} minus {b}?',
  askMul: 'What is {a} times {b}?',
  askCount: 'How many dots are there?',
  offerLine: 'Is it {candidate}?',
  hintAdd: 'start at {a} and count on {b} more',
  hintSub: 'start at {a} and count back {b}',
  hintMul: 'think of {a} groups of {b}',
  hintCount: 'count them one at a time',
  hintRange: 'it is more than {lo} and less than {hi}',
  explainAdd: '{a} plus {b} is {answer}.',
  explainSub: '{a} minus {b} is {answer}.',
  explainMul: '{a} times {b} is {answer}.',
  explainCount: 'There are {answer} dots.',
});
const LINE_LABELS = {
  askAdd: 'Question: plus', askSub: 'Question: minus', askMul: 'Question: times', askCount: 'Question: counting',
  offerLine: 'Offering one number', hintAdd: 'First hint: plus', hintSub: 'First hint: minus',
  hintMul: 'First hint: times', hintCount: 'First hint: counting', hintRange: 'Second hint: a range',
  explainAdd: 'The answer: plus', explainSub: 'The answer: minus', explainMul: 'The answer: times',
  explainCount: 'The answer: counting',
};

export const OPS = ['add', 'sub', 'addsub', 'mul', 'all', 'count'];
export const MATH_LEVEL_MODES = ['adaptive', 'fixed'];
export const DEFAULTS = Object.freeze({
  // Plus and minus within ten: the smallest sums that are still two kinds of question. A GUESS, on
  // Mike's list. (Used when `mathLevel` is 'fixed'.)
  ops: 'addsub',
  maxNumber: 10,
  // A few numbers to choose from (not the pad) by default: it works on one switch, on touch and
  // alongside a voice.
  answerWith: 'offer',
  // ...AND THE NUMBER IS SAID, TAPPED OR STEPPED TO, NOT "IS IT 7?" (Mike's brain-games ruling, 2026-10-02
  // late, carried here: "You should be able to say the answer. Yes/no should be an option though."). FOR:
  // working the sum out and saying it is the exercise; "Is it 7?" turns it into checking somebody else's
  // answer, and a voice player heard a possible answer before giving their own. Every number is in the open
  // vocabulary. AGAINST: somebody whose only signals are a yes and a no - one row away, and two Yes / No
  // switches get it whatever this says. An OLD Simple math panel changes too (the same DEFAULTS): nobody
  // chose yes / no there - it was the only shape there was - unlike its sums, which somebody did choose.
  // [A guess, on Mike's list.]
  answerBy: 'choices',
  // The dots arrive WITH the hint, so a first try is a real try. (Counting always shows them: there
  // the dots ARE the question.)
  dots: 'hint',
  checkWhenFull: true,
  boardScan: 'rows',
  // THE OLD PANEL STAYS WHERE IT WAS SET (see the header). Math's beginner level defaults to
  // 'adaptive' (algebra.js passes its own default).
  mathLevel: 'fixed',
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

// ---------------------------------------------------------------------------------------
// THE BEGINNER LADDER — every problem at every level, each with a stable id (a rating is keyed by it)
// ---------------------------------------------------------------------------------------
//
// THE LEVELS, ARGUED. "Absolute beginner" starts BEFORE sums: counting a few dots is the first number
// skill there is, and it needs no symbols at all. Then plus inside five (fingers on one hand), then
// plus and minus inside ten, then inside twenty, then times. Times is last because it needs plus to
// be automatic first. Six levels; a player who already knows their sums leaves level 1 in ten answers.
// AGAINST: somebody who once did algebra may find dots condescending for those ten answers;
// `startLevel` starts a player higher.
export const MATH_LEVELS = Object.freeze([
  Object.freeze({ level: 1, ops: ['count'], max: 5, label: 'Counting up to 5' }),
  Object.freeze({ level: 2, ops: ['add'], max: 5, label: 'Plus within 5' }),
  Object.freeze({ level: 3, ops: ['add', 'sub'], max: 10, label: 'Plus and minus within 10' }),
  Object.freeze({ level: 4, ops: ['add', 'sub'], max: 20, label: 'Plus and minus within 20' }),
  Object.freeze({ level: 5, ops: ['mul'], max: 5, label: 'Times up to 5' }),
  Object.freeze({ level: 6, ops: ['mul'], max: 10, label: 'Times up to 10' }),
]);

const SYM_ID = { add: '+', sub: '-', mul: 'x' };
const problemId = (p) => (p.op === 'count' ? `count:${p.a}` : `${p.op}:${p.a}${SYM_ID[p.op]}${p.b}`);
function every(op, max) {
  const out = [];
  if (op === 'count') for (let a = 1; a <= max; a++) out.push({ op, a, b: 0, answer: a });
  if (op === 'add') for (let a = 1; a < max; a++) for (let b = 1; a + b <= max; b++) out.push({ op, a, b, answer: a + b });
  if (op === 'sub') for (let a = 2; a <= max; a++) for (let b = 1; b < a; b++) out.push({ op, a, b, answer: a - b });
  if (op === 'mul') for (let a = 1; a <= max; a++) for (let b = 1; b <= max; b++) out.push({ op, a, b, answer: a * b });
  return out;
}
let BANK = null;
/** Every beginner problem, each at the FIRST level that asks it. */
export function mathBank() {
  if (BANK) return BANK;
  const seen = new Set();
  const out = [];
  for (const L of MATH_LEVELS) {
    for (const op of L.ops) {
      for (const p of every(op, L.max)) {
        const id = problemId(p);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(Object.freeze({ ...p, id, level: L.level }));
      }
    }
  }
  BANK = Object.freeze(out);
  return BANK;
}

const int = (lo, hi, rand) => lo + Math.floor(rand() * (hi - lo + 1));

/** `n` problems for FIXED settings. Pure: the suite checks every range on hundreds of them. */
export function makeProblems(c = {}, rand = Math.random, n = 20) {
  const ops = OPS.includes(c.ops) ? c.ops : DEFAULTS.ops;
  const max = [5, 10, 12, 20].includes(Number(c.maxNumber)) ? Number(c.maxNumber) : DEFAULTS.maxNumber;
  const kinds = ops === 'addsub' ? ['add', 'sub'] : ops === 'all' ? ['add', 'sub', 'mul'] : [ops];
  const out = [];
  for (let i = 0; i < n; i++) {
    const op = kinds[Math.min(kinds.length - 1, Math.floor(rand() * kinds.length))];
    let a; let b; let answer;
    if (op === 'count') { a = int(1, max, rand); b = 0; answer = a; }
    else if (op === 'add') { a = int(1, max - 1, rand); b = int(1, max - a, rand); answer = a + b; }
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
const SUFFIX = { add: 'Add', sub: 'Sub', mul: 'Mul', count: 'Count' };
const lineFor = (c, kind, op) => c[`${kind}${SUFFIX[op] || 'Add'}`];

/** The adapter, for a host that supplies `items` (fixed or adaptive) and an optional ask prefix. */
export function mathAdapter({ items, prefix = () => '' } = {}) {
  return {
    items,
    entry: (c) => (c.answerWith === 'pad' ? 'digits' : null),
    ask: (it, c) => prefix() + fill(lineFor(c, 'ask', it.op), it),
    candidates(it, c, rand) {
      const floor = it.op === 'count' ? 1 : 0;
      const near = [it.answer - 2, it.answer - 1, it.answer + 1, it.answer + 2].filter((v) => v >= floor);
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
}

// ---------------------------------------------------------------------------------------
// THE VIEW — the sum as symbols, and dots to count
// ---------------------------------------------------------------------------------------
function dotsHtml(it) {
  const row = (n, away = 0) => `<div class="qz-dotrow">${Array.from({ length: n }, (_, i) =>
    `<span class="qz-dot"${i >= n - away ? ' data-away' : ''}></span>`).join('')}</div>`;
  // Counting: the dots ARE the question, so they are drawn big.
  if (it.op === 'count') return `<div class="qz-dots" data-dots data-count>${row(it.a)}</div>`;
  if (it.op === 'add') return `<div class="qz-dots" data-dots>${row(it.a)}${row(it.b)}</div>`;
  if (it.op === 'sub') return `<div class="qz-dots" data-dots>${row(it.a, it.b)}</div>`;
  return `<div class="qz-dots" data-dots>${Array.from({ length: it.a }, () => row(it.b)).join('')}</div>`;
}
// Dots are for counting, so a sum too big to count on screen does not get them.
const countable = (it) => (it.op === 'mul' ? it.a * it.b <= 40 : it.a + it.b <= 40);

export const mathView = Object.freeze({
  askHtml: (s) => (s.item.op === 'count' ? '<span data-sum>How many?</span>'
    : `<span data-sum>${esc(s.item.a)} ${SYM[s.item.op]} ${esc(s.item.b)} = ?</span>`),
  left(s, c) {
    if (s.item.op === 'count') return dotsHtml(s.item);
    if (c.dots === 'never' || !countable(s.item)) return '';
    if (c.dots === 'hint' && s.hintsGiven < 1) return '';
    return dotsHtml(s.item);
  },
  entryHtml: (s) => `<p class="qz-entry" data-entry aria-label="typed so far">${s.entry ? esc(s.entry) : '<span class="qz-blank">?</span>'}</p>`,
  board: () => PAD,
  pairHtml: (s) => (s.item.op === 'count' ? `<div class="wg-pair" data-pair>${esc(s.pair.answer)}</div>`
    : `<div class="wg-pair" data-pair>${esc(s.item.a)} ${SYM[s.item.op]} ${esc(s.item.b)} = ${esc(s.pair.answer)}</div>`),
  pointNote: (game, item) => (item.op === 'count' ? `math: counting ${item.a}` : `math: ${item.a} ${WORD[item.op]} ${item.b}`),
});

// ---------------------------------------------------------------------------------------
// THE SETTINGS — shared with Math's beginner level, which hides them unless it is AT that level
// ---------------------------------------------------------------------------------------
/**
 * The beginner rows. `when(values)` gates them all (Math: only at its beginner level); `levelDefault`
 * is what an unset `mathLevel` means on this panel ('fixed' here, 'adaptive' on Math).
 */
export function beginnerSettings({ when = null, levelDefault = 'fixed', withScore = true } = {}) {
  const on = (v) => { try { return when ? when(v || {}) !== false : true; } catch { return true; } };
  const levelOf = (v) => (MATH_LEVEL_MODES.includes(v?.mathLevel) ? v.mathLevel : levelDefault);
  const fixed = (v) => on(v) && levelOf(v) === 'fixed';
  const adaptive = (v) => on(v) && levelOf(v) === 'adaptive';
  const w = (row, gate = on) => ({ ...row, appliesWhen: gate });
  return [
    ...(withScore ? [w(ownScoreField({ level: 'essential', note: 'How many are right. A Scoreboard on the same screen can show it instead.' }))] : []),
    w({ key: 'mathLevel', label: 'How hard', kind: 'choice', default: levelDefault, level: 'essential',
      options: [{ value: 'adaptive', label: 'Starts with counting, and moves up and down by itself' },
                { value: 'fixed', label: 'The sums chosen below' }] }),
    w({ key: 'ops', label: 'Which sums', kind: 'choice', default: 'addsub', level: 'essential',
      options: [{ value: 'count', label: 'Counting dots' }, { value: 'add', label: 'Plus' }, { value: 'sub', label: 'Minus' },
                { value: 'addsub', label: 'Plus and minus' }, { value: 'mul', label: 'Times' },
                { value: 'all', label: 'Plus, minus and times' }] }, fixed),
    w({ key: 'maxNumber', label: 'Numbers up to', kind: 'choice', default: 10, level: 'essential',
      options: [5, 10, 12, 20].map((v) => ({ value: v, label: String(v) })),
      note: 'Plus stays within this total; minus starts from no more than this; times multiplies numbers up to it.' }, fixed),
    w({ key: 'answerWith', label: 'Answer by', kind: 'choice', default: 'offer', level: 'standard',
      options: [{ value: 'offer', label: 'A few numbers to choose from' },
                { value: 'pad', label: 'A number pad' }] }),
    // Only with the numbers: the pad has no offer to say yes or no to. ADVANCED here (standard in the other
    // games), argued: Math's standard menu is held to the 12-press budget (simple_math_test) and this row
    // made Beginner 13 - the same reason `askAnother` is advanced. The default is the ruling, and the
    // standard "Switches" row (Select is Yes, Next is No) already gives two-switch users yes / no.
    // [On Mike's list.]
    w(answerByField({ on: 'choices', example: 'Is it 7?', level: 'advanced' }), (v) => on(v) && v?.answerWith !== 'pad'),
    w({ key: 'dots', label: 'Dots to count', kind: 'choice', default: 'hint', level: 'standard',
      options: [{ value: 'hint', label: 'With the hint' }, { value: 'always', label: 'Always' },
                { value: 'never', label: 'Never' }] }),
    w({ key: 'checkWhenFull', label: 'Check a typed number', default: true, level: 'advanced',
      onLabel: 'As soon as it has enough digits', offLabel: 'Only when Check is pressed' }),
    w({ key: 'boardScan', label: 'Number pad with a switch', kind: 'choice', default: 'rows', level: 'advanced',
      options: [{ value: 'rows', label: 'A row, then a number' }, { value: 'keys', label: 'One key at a time' }] }),
    // "Start games at" ADVANCED here (standard in the other games), for the same 12-press budget: it made
    // Beginner 13. Nothing is lost by it: the row is ONE value for the person across every game on the
    // ladder, so it can be set from any of their other games' menus, and Math follows it either way.
    // [On Mike's list.]
    ...adaptiveSettings({ appliesWhen: adaptive, startLevels: MATH_LEVELS.length, personStartLevel: 'advanced' }),
    ...flowSettings({ lines: LINES, labels: LINE_LABELS }).map((row) => w(row)),
  ];
}

/**
 * THE BEGINNER GAME, as a module factory, for any type: `simple_math` (the old panel) and `algebra`
 * (Math, at its beginner level) both mount it. `type` is its bus prefix and score source.
 */
export function beginnerMath({ type = GAME, title = 'Simple math', scoreLabel = 'Simple math: right answers',
  defaults = DEFAULTS, extraTopics = {} } = {}) {
  return (ctx) => {
    const rand = ctx.rand || Math.random;
    let cfgNow = { ...defaults };
    let api = null;
    const adaptive = () => (MATH_LEVEL_MODES.includes(cfgNow.mathLevel) ? cfgNow.mathLevel : defaults.mathLevel) === 'adaptive';
    // The screen's person's level is kept WITH THEM, the same on each of their screens, with their own
    // "Start games at"; everybody else's stays on this screen's row; a refused save merges, entry by
    // entry (adaptive_play.js openPersonLadder).
    const ladderRows = openPersonLadder(ctx, { onChange: () => api?.render() });
    const store = ladderRows.store;
    const session = createAdaptiveSession({
      cfg: () => cfgNow, bankFor: (g) => (g === RATING_GAME ? mathBank() : []), store, rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null, onChange: () => api?.render(),
      startFor: ladderRows.startFor, startMark: ladderRows.startMark,
    });
    ladderRows.attach(session);
    const adapter = mathAdapter({
      items: (c, r) => {
        if (!adaptive()) return makeProblems(c, r, 20);
        const q = session.deal(RATING_GAME);
        return q ? [q] : [];
      },
      prefix: () => (adaptive() ? session.askPrefix() : ''),
    });
    const view = {
      ...mathView,
      turnHtml: (s) => (adaptive() ? session.turnHtml(s, RATING_GAME) : ''),
      onResult: (r) => { if (adaptive()) session.record(r); },
      allowAward: () => (adaptive() ? session.allowAward() : true),
      scoreDetail: (s) => (adaptive() && session.scoreDetail()) || (s.asked ? `${s.rightCount} of ${s.asked}` : ''),
      scoreLine: (s) => (adaptive() && session.scoreDetail()) || `${s.rightCount} right so far.`,
      onConfig: (c) => { cfgNow = c; ladderRows.onConfig(c); },
      init: (a) => { api = a; },
      destroy: () => { session.destroy(); ladderRows.destroy(); },
    };
    const inner = quizModule({ type, title, scoreLabel, games: { math: adapter }, defaults, view, extraTopics })(ctx);
    inner.__session = session;
    return inner;
  };
}
