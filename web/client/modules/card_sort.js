// modules/card_sort.js — CARD SORT: name the suit, then say where the card goes among the ones you've done.
//
// Mike, 2026-10-02: "Her OT & PT were having her name card suits. That could actually be a good game to
// mix with the higher lower numbers. A card sort game. Pick the suit. Then you get two other cards you've
// already done (assuming you've done two already) and you say if your card is higher/lower/in the middle.
// Maybe that would be like the levels. Start out with just one card and say higher/lower work your way up
// to having to sort with all the cards you've already done."
//
// EVERY CARD IS TWO QUESTIONS, in this order:
//   1. THE SUIT. "What suit is this card?" - say it ("hearts"), tap it, or walk the four with a switch.
//   2. WHERE IT GOES, among cards already done this hand (`refs`, shown in order, lowest first, with a
//      place to put it between each pair): "higher or lower" against one card, "lower, in the middle or
//      higher" against two, "where does it go" against more. Say it ("higher", "in the middle", "between
//      the four and the nine", "after the jack"), tap the place, or walk the places with a switch.
// A card of the same rank as one it is placed against goes either side of it: both places are right.
//
// THE LEVELS (the ladder: rating.js / adaptive_play.js, each player at their own, the per-level step-up
// and step-down Mike set on 2026-10-02 - 90% right / 75% wrong at the easiest, lower further up):
//   1  the suit only
//   2  the suit, then higher or lower than one card done
//   3  ... among two (lower / in the middle / higher)
//   4  ... among three
//   5  ... among five
//   6  ... among every card done this hand (up to `handSize` - 1)
// FOR these steps: Mike's own ("start out with just one card ... work your way up to ... all the cards");
// 3 and 5 are the numbers a person can hold in view at once and still read as a row. AGAINST: a jump from
// five to "all" can be a jump to seven. That is the hand size's job (a setting, 8 by default: the last
// level is then at most seven cards to sort among - a row that still fits a quarter of a screen).
// A card whose hand does not yet hold enough done cards asks what it can (the first card of a hand is the
// suit only) and is NOT rated: an easier question than the level must not count as that level's.
//
// THE CARDS: klondike.js's deck and names ("7 of hearts"), solitaire.css's suit colour tokens (card_sort.css):
// every suit is its COLOUR, its SYMBOL and its NAME, never one alone. Big cards. Aces are low by default
// (`aces`, argued at DEFAULTS).
//
// IT WAITS FOR START (quiz_view.js start gate, game_start.js), says nothing until then, and "start" said
// aloud starts it. No demo yet, so no "While nobody is playing" row.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, answerByField, fill, esc, normalize, parseNumber } from '../quiz_flow.js';
import { quizModule } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openLadderStore } from '../adaptive_play.js';
import { SUITS, RANK_LABEL, RANK_NAME, cardName, shuffled } from '../klondike.js';
import { autostartFields, START_VOICE } from '../game_start.js';

export const GAME = 'card_sort';
/** One game; listed so a spoken route's `{ game }` can be checked against it like the others. */
export const GAMES = Object.freeze([GAME]);

// How many done cards a level places against. 'all' = every card done this hand.
export const LEVEL_REFS = Object.freeze({ 1: 0, 2: 1, 3: 2, 4: 3, 5: 5, 6: 'all' });
export const MAX_LEVEL = 6;
// The ladder's questions: a few per level, so each level's "question" has a rating of its own to learn.
const PER_LEVEL = 4;
export const BANK = Object.freeze(Array.from({ length: MAX_LEVEL }, (_, i) => i + 1)
  .flatMap((level) => Array.from({ length: PER_LEVEL }, (_, n) => Object.freeze({ id: `cs-l${level}-${n + 1}`, level }))));

export const LINES = Object.freeze({
  askWhichSuit: 'What suit is this card?',
  askOne: 'Is the {card} higher or lower than the {ref}?',
  askTwo: 'Is the {card} lower, in the middle, or higher?',
  askMany: 'Where does the {card} go?',
  offerSuit: 'Is it {candidate}?',
  offerPlace: 'Does it go {candidate}?',
  hintColour: 'it is a {colour} card',
  hintNotSuit: 'it is not {x}',
  hintAces: 'aces count as {ace}, jacks as 11, queens as 12 and kings as 13',
  hintSide: 'it is {side} than the {ref}',
  explainSuit: 'It is the {name}.',
  explainHigher: 'The {card} is higher than the {ref}.',
  explainLower: 'The {card} is lower than the {ref}.',
  explainSame: 'The {card} and the {ref} are the same, so either way is right.',
  explainBetween: 'The {card} goes between the {lo} and the {hi}.',
  explainFirst: 'The {card} goes first: it is the lowest.',
  explainLast: 'The {card} goes last: it is the highest.',
  newHand: 'That is a full hand. A new one starts.',
  notAPlace: '{heard} is not one of the places.',
});
const LINE_LABELS = {
  askWhichSuit: 'Question: the suit', askOne: 'Question: higher or lower', askTwo: 'Question: lower, middle or higher',
  askMany: 'Question: where it goes', offerSuit: 'Offering a suit', offerPlace: 'Offering a place',
  hintColour: 'Hint: the colour', hintNotSuit: 'Hint: a suit taken away', hintAces: 'Hint: what the picture cards count as',
  hintSide: 'Hint: one side of it', explainSuit: 'The answer: the suit', explainHigher: 'The answer: higher',
  explainLower: 'The answer: lower', explainSame: 'The answer: the same rank', explainBetween: 'The answer: between two',
  explainFirst: 'The answer: first', explainLast: 'The answer: last', newHand: 'A full hand', notAPlace: 'Said something that is not a place',
};

export const DEFAULTS = Object.freeze({
  game: GAME,
  // HAND SIZE 8: the top level then sorts among up to seven, which is a row that still reads on a quarter
  // of a 1080p screen; a hand is about five minutes at the flow's pace. 4 to 10 offered.
  handSize: 8,
  // ACES LOW: an ace is the "A" that is one - the reading that needs no rule. FOR high: most card games
  // play them high. The hint says which, and the other is one setting away.
  aces: 'low',
  // THE SUIT EVERY CARD (Mike's order: "Pick the suit. Then ..."). FOR "only on level 1": the higher
  // levels are about order, and a suit question every card halves the pace. AGAINST, and it wins: naming
  // suits is the exercise the game came from; one setting drops it.
  askSuit: 'always',
  answerBy: 'choices',
  autostart: false,
  autostartAlone: 'same',
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

const SETTINGS = [
  ...autostartFields({ on: false }),
  answerByField({ on: 'choices' }),
  ownScoreField({ level: 'essential', note: 'How many are right (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  { key: 'askSuit', label: 'Name the suit', kind: 'choice', default: 'always', level: 'standard',
    options: [{ value: 'always', label: 'For every card, then where it goes' },
              { value: 'first', label: 'Only at the first level' }] },
  { key: 'handSize', label: 'Cards in a hand', kind: 'choice', default: 8, level: 'standard',
    options: [4, 6, 8, 10].map((v) => ({ value: v, label: String(v) })),
    note: 'At the top level the card is placed among every card done this hand.' },
  { key: 'aces', label: 'Aces', kind: 'choice', default: 'low', level: 'standard',
    options: [{ value: 'low', label: 'Low: an ace is 1' }, { value: 'high', label: 'High: above the king' }] },
  ...adaptiveSettings({ ai: false, startLevels: MAX_LEVEL }),
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

// ---------------------------------------------------------------------------------------------------
// PURE PIECES - exported for the suite
// ---------------------------------------------------------------------------------------------------
const SUIT = Object.fromEntries(SUITS.map((s) => [s.id, s]));
export const suitName = (id) => SUIT[id]?.name || '';
/** The value a card sorts by. Aces 1 (low) or 14 (high). */
export const rankValue = (c, aces = 'low') => (c.r === 1 && aces === 'high' ? 14 : c.r);
/** "7", "jack", "ace": what a card is called without its suit. */
export const rankWord = (c) => RANK_NAME[c.r];
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** How many done cards a level wants (all: every card done). */
export function refsWanted(level, done) {
  const w = LEVEL_REFS[Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)))];
  return w === 'all' ? done : w;
}

/** `k` of the done cards, chosen with `rand`, in sorting order (lowest first; a tie in suit order). */
export function pickRefs(done, k, rand = Math.random, aces = 'low') {
  const pool = done.slice();
  const out = [];
  while (out.length < k && pool.length) out.push(pool.splice(Math.floor((Number(rand()) || 0) * pool.length) % pool.length, 1)[0]);
  const so = (c) => SUITS.findIndex((s) => s.id === c.s);
  return out.sort((a, b) => rankValue(a, aces) - rankValue(b, aces) || so(a) - so(b));
}

/** Is place `i` (0 = before every ref, refs.length = after every ref) right for `card`? Ties go either side. */
export function placeOk(card, refs, i, aces = 'low') {
  const v = rankValue(card, aces);
  const k = refs.length;
  if (!Number.isInteger(i) || i < 0 || i > k) return false;
  const lo = i > 0 ? rankValue(refs[i - 1], aces) : -Infinity;
  const hi = i < k ? rankValue(refs[i], aces) : Infinity;
  return lo <= v && v <= hi;
}
/** The first right place. */
export function rightPlace(card, refs, aces = 'low') {
  for (let i = 0; i <= refs.length; i++) if (placeOk(card, refs, i, aces)) return i;
  return refs.length;
}

const SUIT_WORDS = Object.fromEntries(SUITS.flatMap((s) => [[s.name, s.id], [s.name.replace(/s$/, ''), s.id]]));
/** "hearts", "a heart", "it's hearts" -> 'H' (whole words), or null. */
export function suitFromText(text) {
  const t = normalize(text).split(' ');
  for (const w of t) if (SUIT_WORDS[w]) return SUIT_WORDS[w];
  return null;
}

const RANK_WORDS = { ace: 1, jack: 11, queen: 12, king: 13, one: 1 };
/** A rank said aloud: "seven", "7", "the jack" -> 7 / 11, or null. */
export function rankFromText(text) {
  const t = normalize(text);
  for (const w of t.split(' ')) if (RANK_WORDS[w]) return RANK_WORDS[w];
  const n = parseNumber(text);
  return n != null && n >= 1 && n <= 13 ? n : null;
}

/**
 * WHERE IT GOES, SAID ALOUD -> a place index, or null when it cannot be told.
 *   one ref     "higher" / "bigger" / "above" -> 1; "lower" / "smaller" / "below" -> 0
 *   two refs    "lower" -> 0, "in the middle" / "middle" / "between" -> 1, "higher" -> 2
 *   any         "first" / "lowest" -> 0; "last" / "highest" -> k; "between the 4 and the 9" -> the place
 *               between those two (next to each other); "after the jack" / "before the 4"
 * Exact words, whole utterance read; nothing guessed. A rank named twice in the row reads the first one.
 */
export function placeFromText(text, refs, aces = 'low') {
  const t = normalize(text);
  if (!t) return null;
  const k = refs.length;
  const has = (re) => re.test(` ${t} `);
  const between = /\bbetween\b(.*)\band\b(.*)/.exec(t);
  if (between) {
    const a = rankFromText(between[1]);
    const b = rankFromText(between[2]);
    if (a != null && b != null) {
      for (let i = 1; i < k; i++) {
        const x = refs[i - 1].r, y = refs[i].r;
        if ((x === a && y === b) || (x === b && y === a)) return i;
      }
      return null;
    }
    if (k === 2) return 1;
  }
  const after = /\b(after|above|past|higher than|bigger than|more than)\b(.*)/.exec(t);
  const before = /\b(before|below|under|lower than|smaller than|less than)\b(.*)/.exec(t);
  const named = (rest) => { const r = rankFromText(rest || ''); return r == null ? -1 : refs.findIndex((c) => c.r === r); };
  if (after && named(after[2]) >= 0) return named(after[2]) + 1;
  if (before && named(before[2]) >= 0) return named(before[2]);
  if (has(/ (first|lowest|at the start|lowest one) /)) return 0;
  if (has(/ (last|highest|at the end|highest one) /)) return k;
  if (k === 2 && has(/ (middle|in the middle|between) /)) return 1;
  if (has(/ (higher|bigger|more|above|up|high) /)) return k;
  if (has(/ (lower|smaller|less|below|down|low) /)) return 0;
  return null;
}

/** What place `i` is called (a button, a switch's spoken step). */
export function placeLabel(i, refs) {
  const k = refs.length;
  const short = (c) => `${RANK_LABEL[c.r]}${SUIT[c.s].symbol}`;
  if (k === 1) return i === 0 ? 'Lower' : 'Higher';
  if (k === 2 && i === 1) return 'In the middle';
  if (i === 0) return `Lower than ${short(refs[0])}`;
  if (i === k) return `Higher than ${short(refs[k - 1])}`;
  return `Between ${short(refs[i - 1])} and ${short(refs[i])}`;
}
/** The same place, as it is said aloud. */
export function placeWords(i, refs) {
  const k = refs.length;
  if (k === 1) return i === 0 ? 'lower' : 'higher';
  if (k === 2 && i === 1) return 'in the middle';
  if (i === 0) return `lower than the ${rankWord(refs[0])}`;
  if (i === k) return `higher than the ${rankWord(refs[k - 1])}`;
  return `between the ${rankWord(refs[i - 1])} and the ${rankWord(refs[i])}`;
}

/** true / false / null for one question. */
export function judgeItem(it, value, aces = 'low') {
  if (value == null || value === '') return null;
  if (it.kind === 'suit') {
    const s = typeof value === 'string' && SUIT[value] ? value : suitFromText(String(value));
    return s == null ? null : s === it.card.s;
  }
  const m = /^s(\d+)$/.exec(String(value));
  const i = m ? Number(m[1]) : placeFromText(String(value), it.refs, aces);
  if (i == null || !Number.isInteger(i) || i < 0 || i > it.refs.length) return null;
  return placeOk(it.card, it.refs, i, aces);
}

// ---------------------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------------------
registerModule(
  { type: GAME, title: 'Card sort', core: 'new',
    description: 'Name the suit of a card, then say whether it is higher or lower than cards you have already '
      + 'done. More cards to sort among as it gets easy, for each player. Say it, tap it, or use one switch.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: START_VOICE },
  (ctx) => {
    const rand = ctx.rand || Math.random;
    let cfgNow = { ...DEFAULTS };
    let api = null;
    let deck = [];
    let done = [];               // the cards done this hand
    let dealt = null;            // the question on screen
    let pending = null;          // a card whose suit is asked and whose place is next
    const aces = () => (cfgNow.aces === 'high' ? 'high' : 'low');
    const store = openLadderStore(ctx);   // a refused save merges, entry by entry (adaptive_play.js)
    const session = createAdaptiveSession({
      cfg: () => cfgNow,
      bankFor: () => BANK,
      store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      onChange: () => api?.render(),
    });

    function draw() {
      if (!deck.length) {
        const held = new Set(done.map((c) => `${c.s}${c.r}`));
        deck = shuffled(Math.floor((Number(rand()) || 0) * 2 ** 31) + 1).filter((c) => !held.has(`${c.s}${c.r}`));
      }
      const c = deck.pop();
      return { s: c.s, r: c.r };
    }

    function deal() {
      // The second question about the same card: where it goes.
      if (pending) {
        const p = pending;
        pending = null;
        session.deal(GAME, { again: p.tmpl.id });
        dealt = Object.freeze({ ...p, kind: 'place', final: true });
        return [dealt];
      }
      const tmpl = session.deal(GAME);
      if (!tmpl) { dealt = null; return []; }
      const level = Math.max(1, Math.min(MAX_LEVEL, Number(tmpl.level) || 1));
      const want = refsWanted(level, done.length);
      const refs = pickRefs(done, Math.min(want, done.length), rand, aces());
      const card = draw();
      const full = level === 1 || refs.length >= (LEVEL_REFS[level] === 'all' ? Math.max(1, done.length) : want);
      // `id` is the ladder question's id: that is what the ladder rates (adaptive_play.js `record`).
      const base = { id: tmpl.id, tmpl, level, card: Object.freeze(card), refs: Object.freeze(refs), rated: full };
      const suitFirst = cfgNow.askSuit !== 'first' || level === 1 || !refs.length;
      if (suitFirst) {
        if (refs.length) pending = { ...base };
        dealt = Object.freeze({ ...base, kind: 'suit', final: !refs.length });
      } else dealt = Object.freeze({ ...base, kind: 'place', final: true });
      return [dealt];
    }

    // One finished question. The card joins the hand when its LAST question is done (right, or the answer
    // shown); only a card that asked its level's whole question is rated (the header says why).
    function finished(r) {
      const it = r.item;
      if (!it) return;
      // The suit, with the place still to come (`pending`, set when it was dealt): not rated - the level's
      // question is the place. A suit missed and shown still goes on to its place.
      if (it.kind === 'suit' && !it.final) return;
      if (it.rated) session.record(r);
      done.push(it.card);
      if (done.length >= Math.max(2, Number(cfgNow.handSize) || DEFAULTS.handSize)) done = [];
    }

    const short = (c) => `${RANK_LABEL[c.r]}${SUIT[c.s].symbol}`;
    const adapter = {
      items: () => deal(),
      empty: () => 'There are no cards to sort.',
      ask(it, c) {
        const pre = session.askPrefix();
        if (it.kind === 'suit') return pre + c.askWhichSuit;
        const card = rankWord(it.card);
        if (it.refs.length === 1) return pre + fill(c.askOne, { card, ref: rankWord(it.refs[0]) });
        if (it.refs.length === 2) return pre + fill(c.askTwo, { card });
        return pre + fill(c.askMany, { card });
      },
      candidates(it) {
        if (it.kind === 'suit') return SUITS.map((s) => s.id);
        return Array.from({ length: it.refs.length + 1 }, (_, i) => `s${i}`);
      },
      choiceLabel(it, v) {
        if (it.kind === 'suit') return capital(suitName(v));
        const i = Number(String(v).slice(1));
        return placeWords(i, it.refs);
      },
      offer(it, cand, c) {
        if (it.kind === 'suit') return fill(c.offerSuit, { candidate: suitName(cand) });
        return fill(c.offerPlace, { candidate: placeWords(Number(String(cand).slice(1)), it.refs) });
      },
      judge: (it, v) => judgeItem(it, v, aces()),
      hint(it, n, c) {
        if (it.kind === 'suit') {
          if (n === 1) return fill(c.hintColour, { colour: SUIT[it.card.s].color });
          if (n === 2) {
            const other = SUITS.find((s) => s.id !== it.card.s && s.color === SUIT[it.card.s].color);
            return other ? fill(c.hintNotSuit, { x: other.name }) : '';
          }
          return '';
        }
        const faces = [it.card, ...it.refs].some((x) => x.r === 1 || x.r > 10);
        if (n === 1 && faces) return fill(c.hintAces, { ace: aces() === 'high' ? 14 : 1 });
        const k = n - (faces ? 2 : 1);
        if (k === 0 && it.refs.length >= 2) {
          const v = rankValue(it.card, aces());
          const lo = it.refs[0];
          return v >= rankValue(lo, aces()) ? fill(c.hintSide, { side: 'higher', ref: rankWord(lo) })
            : fill(c.hintSide, { side: 'lower', ref: rankWord(it.refs[it.refs.length - 1]) });
        }
        return '';
      },
      answer: (it) => (it.kind === 'suit' ? it.card.s : `s${rightPlace(it.card, it.refs, aces())}`),
      explain(it, answer, c) {
        const card = rankWord(it.card);
        let line;
        if (it.kind === 'suit') line = fill(c.explainSuit, { name: cardName(it.card) });
        else {
          const i = rightPlace(it.card, it.refs, aces());
          const k = it.refs.length;
          const v = rankValue(it.card, aces());
          if (k === 1) {
            const rv = rankValue(it.refs[0], aces());
            const ref = rankWord(it.refs[0]);
            line = v === rv ? fill(c.explainSame, { card, ref }) : fill(v > rv ? c.explainHigher : c.explainLower, { card, ref });
          } else if (i === 0) line = fill(c.explainFirst, { card });
          else if (i === k) line = fill(c.explainLast, { card });
          else line = fill(c.explainBetween, { card, lo: rankWord(it.refs[i - 1]), hi: rankWord(it.refs[i]) });
        }
        // The card that fills the hand: said once, as its own last line.
        const last = it.kind === 'place' || it.final;
        const fills = last && done.length + 1 >= Math.max(2, Number(cfgNow.handSize) || DEFAULTS.handSize);
        return fills ? `${line} ${c.newHand}` : line;
      },
      vocab(it) {
        if (it.kind === 'suit') return SUITS.flatMap((s) => [s.name, s.name.replace(/s$/, '')]);
        const ranks = [...new Set(it.refs.map((x) => rankWord(x)))];
        const pairs = it.refs.slice(1).map((x, i) => `between the ${rankWord(it.refs[i])} and the ${rankWord(x)}`);
        return ['higher', 'lower', 'in the middle', 'middle', 'first', 'last', 'bigger', 'smaller',
          ...ranks.flatMap((r) => [`after the ${r}`, `before the ${r}`]), ...pairs];
      },
      heardText: (v) => {
        const it = dealt;
        const m = /^s(\d+)$/.exec(String(v));
        if (it && it.kind === 'place' && m) return placeWords(Number(m[1]), it.refs);
        if (it && it.kind === 'suit' && SUIT[v]) return suitName(v);
        return String(v);
      },
      fromVoice(it, { text, raw }) {
        if (it.kind === 'suit') { const s = suitFromText(raw || text); return s ? { value: s } : (text ? { value: text } : null); }
        const i = placeFromText(raw || text, it.refs, aces());
        return i == null ? null : { value: `s${i}` };
      },
      unknownLine(value, c) {
        if (dealt && dealt.kind === 'place') return fill(c.notAPlace, { heard: value });
        return c.notCaughtLine;
      },
    };

    // ---- the view ----
    const cardHtml = (c, { small = false, name = false } = {}) => `<div class="cs-card" data-suit="${c.s}"${small ? ' data-small' : ''} `
      + `role="img" aria-label="${esc(cardName(c))}"><span class="cs-rank" aria-hidden="true">${esc(RANK_LABEL[c.r])}</span>`
      + `<span class="cs-pip" aria-hidden="true">${SUIT[c.s].symbol}</span>`
      + `${name ? `<span class="cs-name" aria-hidden="true">${esc(SUIT[c.s].name)}</span>` : '<span></span>'}</div>`;
    const handLine = () => `<p class="cs-hand" data-hand>${done.length} of ${Math.max(2, Number(cfgNow.handSize) || DEFAULTS.handSize)} done this hand</p>`;

    const view = {
      askHtml(s) {
        const it = s.item;
        if (it.kind === 'suit') return esc('What suit is this card?');
        if (it.refs.length === 1) return esc(`Higher or lower than ${short(it.refs[0])}?`);
        if (it.refs.length === 2) return esc('Lower, in the middle, or higher?');
        return esc('Where does it go?');
      },
      left(s) {
        const it = s.item;
        if (it.kind === 'suit') {
          // The suits: colour AND symbol AND name, each a tile that answers when tapped.
          const suits = SUITS.map((x) => `<button type="button" class="cs-suit" data-suit="${x.id}" data-pick="${x.id}">`
            + `<b aria-hidden="true">${x.symbol}</b>${esc(capital(x.name))}</button>`).join('');
          return `<div class="cs-wrap" data-cs>${cardHtml(it.card)}<div class="cs-suits" data-suits>${suits}</div>${handLine()}</div>`;
        }
        // The row: a place, a card, a place, ... - lowest first. Every place is a tile that answers.
        const parts = [];
        it.refs.forEach((r, i) => {
          parts.push(`<button type="button" class="cs-slot" data-pick="s${i}">${esc(placeLabel(i, it.refs))}</button>`);
          parts.push(cardHtml(r, { small: true, name: true }));
        });
        parts.push(`<button type="button" class="cs-slot" data-pick="s${it.refs.length}">${esc(placeLabel(it.refs.length, it.refs))}</button>`);
        return `<div class="cs-wrap" data-cs>${cardHtml(it.card, { name: true })}<div class="cs-row" data-row>${parts.join('')}</div>${handLine()}</div>`;
      },
      pairHtml(s) {
        const it = s.item;
        return `<div class="wg-pair" data-pair>${esc(short(it.card))} <small>${esc(cardName(it.card))}</small></div>`;
      },
      turnHtml: (s) => session.turnHtml(s, GAME),
      onResult(r) { finished(r); },
      allowAward: () => session.allowAward(),
      scoreDetail: (s) => session.scoreDetail() || (s.asked ? `${s.rightCount} of ${s.asked}` : ''),
      pointNote: (game, item) => `card sort: ${item.kind}`,
      onConfig: (c) => { cfgNow = c; },
      init(a) {
        api = a;
        const doc = ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null);
        try {
          const href = new URL('../card_sort.css', import.meta.url).href;
          if (doc && !doc.querySelector('link[data-card-sort-css]')) {
            const link = doc.createElement('link');
            link.rel = 'stylesheet'; link.href = href; link.dataset.cardSortCss = '';
            (doc.head || doc.documentElement).append(link);
          }
        } catch { /* unstyled, still works */ }
      },
      destroy: () => { session.destroy(); try { store?.destroy?.(); } catch { /* gone */ } },
    };

    const inner = quizModule({ type: GAME, title: 'Card sort', scoreLabel: 'Card sort: right answers',
      games: { [GAME]: adapter }, defaults: DEFAULTS, gameKey: 'game', view, startGate: true,
      autostart: DEFAULTS.autostart })(ctx);
    inner.__session = session;
    inner.__state = () => ({ done: done.slice(), dealt, pending, deckLeft: deck.length });
    return inner;
  },
);
