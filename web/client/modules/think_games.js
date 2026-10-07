// think_games.js — THINKING GAMES (row 2.45): a speech therapist's exercises, our own versions.
//
// Mike, 2026-10-01: build games from the exercises: (1) name the smallest of three numbers, or the
// biggest of three things; (2) name the group three things belong to (fruit, animals, buildings);
// (3) finish a simple sentence with no example given ("I wash my ___"). Voice, a switch or touch;
// read aloud; big. And quick, varied rounds (the "mix", in the spirit of the brain-training games he
// says were liked: short drills, one after another — our own, nothing copied).
//
// EVERYTHING A PERSON MEETS between the questions is `quiz_view.js` and `quiz_flow.js`, the same as
// word games, spelling, simple math and name that: the answers to say, tap or step through ("Is it 3?"
// is the `answerBy` option), the hints, "Would you like to try
// again, or hear the answer?", the celebration. This file is the four adapters and the pictures.
//
// WHAT IS NEW HERE, and lives in shared files so the next game gets it for one line:
//   * DIFFICULTY PER PLAYER (`adaptive_play.js`, `rating.js`): each player has their own level per
//     game; above 80% right (a setting) the harder level comes in and the easiest goes out; every
//     question has its own rating from everybody's answers; missed questions come back on an
//     expanding schedule.
//   * TWO OR MORE PLAYERS on one screen, taking turns, each at their own level. Whose turn it is is
//     on screen (a name with a coloured initial) and said before the question.
//   * TOUCH: the three numbers or things are big tiles; touching one answers.
//   * MORE QUESTIONS FROM AN OPEN MODEL (`question_writer.js`), off unless turned on.
//
// THE MISS, GENTLER BY DEFAULT. The approved gentler default is name-that-person's. Its literal shape
// (show whose message it was, offer to play it again) needs a clip to play again, and dropping
// straight to the answer would also drop the HINTS, which in these exercises are the therapy (a
// meaning cue, then a sound cue). So here the flow is Mike's, hints and all, and only the WORDS are
// gentler: "Not that one." instead of "That is incorrect." Both are editable lines in the settings,
// and Mike's own words are one edit away. [A judgement call, on Mike's list.]

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, answerByField, fill, esc, normalize, parseNumber, numberWord, shuffle } from '../quiz_flow.js';
import { quizModule } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openPersonLadder } from '../adaptive_play.js';
import { BANKS, GROUP_NAMES, GROUPS, shownOrder } from '../think_banks.js';
import { createAI } from '../ai.js';
import { writeQuestions } from '../question_writer.js';
// 2026-10-02 late (Mike: "When a game is in the dashboard. It shouldn't start right away."): it opens
// waiting for Start, says nothing until then, and "start" said aloud starts it (quiz_view.js start gate,
// game_start.js). No demo yet - so no "While nobody is playing" row: a row that does nothing is a lie.
import { autostartFields, START_VOICE } from '../game_start.js';

export const GAME = 'think_games';
export const GAMES = Object.freeze(['mix', 'numbers', 'things', 'groups', 'finish']);
// The order the mix deals them in: one of each, round and round.
export const MIX_ORDER = Object.freeze(['numbers', 'things', 'groups', 'finish']);

export const LINES = Object.freeze({
  // Gentler than Mike's "That is incorrect." — see the header.
  wrongLine: 'It sounded like you said {heard}. Not that one.',
  switchWrongLine: 'Not that one.',
  askSmallest: 'Which is the smallest: {list}?',
  askBiggest: 'Which is the biggest: {list}?',
  askGroup: '{list}. What group do they all belong to?',
  askFinish: 'Finish the sentence. {stem} …',
  offerNumber: 'Is it {candidate}?',
  offerThing: 'Is it the {candidate}?',
  offerGroup: 'Is it {candidate}?',
  offerFinish: '{stem} {candidate}?',
  hintNotNumber: 'it is not {x}',
  hintNotThing: 'it is not the {x}',
  hintFirst: 'it starts with {letter}',
  explainNumber: '{answer} is the {want}.',
  explainThing: 'The {answer} is the {want}.',
  explainGroup: '{list} are all {group}.',
  explainFinish: '{sentence}.',
  notAnOption: '{heard} is not one of the three.',
  notSure: 'I’m not sure about {heard}. Can you think of another word?',
});
const LINE_LABELS = {
  askSmallest: 'Question: the smallest', askBiggest: 'Question: the biggest', askGroup: 'Question: the group',
  askFinish: 'Question: finish the sentence', offerNumber: 'Offering a number', offerThing: 'Offering a thing',
  offerGroup: 'Offering a group', offerFinish: 'Offering an ending', hintNotNumber: 'Hint: a number it is not',
  hintNotThing: 'Hint: a thing it is not', hintFirst: 'Hint: the first letter', explainNumber: 'The answer: a number',
  explainThing: 'The answer: a thing', explainGroup: 'The answer: the group', explainFinish: 'The answer: the sentence',
  notAnOption: 'Said something that is not one of the three', notSure: 'Said an ending it does not know',
};

export const DEFAULTS = Object.freeze({
  // The mix first: short and varied, and every exercise turns up. One setting picks a single one.
  game: 'mix',
  numbersAsk: 'smallest',
  thingsAsk: 'biggest',
  // SAY THE ANSWER, NOT "IS IT 3?", BY DEFAULT (Mike's brain-games ruling, 2026-10-02 late, carried here:
  // "You should be able to say the answer. Yes/no should be an option though."). FOR: these ARE speech
  // exercises - naming the smallest number, the group, the end of the sentence is the therapy, and "Is it
  // fruit?" hands over the word the person was meant to find. Every answer is in the open vocabulary (the
  // three numbers or things, every group name, every listed ending). AGAINST: somebody whose only signals
  // are a yes and a no; for them it is one row away, and two Yes / No switches get it whatever this says.
  answerBy: 'choices',
  autostart: false,
  autostartAlone: 'same',
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

const SETTINGS = [
  ...autostartFields({ on: false }),
  { key: 'game', label: 'Which game', kind: 'choice', default: 'mix', level: 'essential',
    options: [{ value: 'mix', label: 'A mix of all four' }, { value: 'numbers', label: 'Smallest of three numbers' },
              { value: 'things', label: 'Biggest of three things' }, { value: 'groups', label: 'Name the group' },
              { value: 'finish', label: 'Finish the sentence' }] },
  answerByField({ on: 'choices', example: 'Is it 3?' }),
  ownScoreField({ level: 'essential', note: 'How many are right (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  // The exercise as given is "the smallest number" and "the biggest thing". The other way round is a
  // second exercise on the same questions, so it is a choice rather than a second game.
  { key: 'numbersAsk', label: 'Numbers: ask for', kind: 'choice', default: 'smallest', level: 'standard',
    options: [{ value: 'smallest', label: 'The smallest' }, { value: 'biggest', label: 'The biggest' },
              { value: 'both', label: 'Either, mixed' }] },
  { key: 'thingsAsk', label: 'Things: ask for', kind: 'choice', default: 'biggest', level: 'standard',
    options: [{ value: 'biggest', label: 'The biggest' }, { value: 'smallest', label: 'The smallest' },
              { value: 'both', label: 'Either, mixed' }] },
  ...adaptiveSettings({ ai: true }),
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

// ---------------------------------------------------------------------------------------
// JUDGING — pure, exported for the suite
// ---------------------------------------------------------------------------------------
const toks = (s) => normalize(s).split(' ').filter(Boolean);
const sing = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
/** Does `phrase` appear in `text` as whole words (plural or not)? */
export function saysPhrase(text, phrase) {
  const t = toks(text).map(sing);
  const p = toks(phrase).map(sing);
  if (!p.length || t.length < p.length) return false;
  for (let i = 0; i + p.length <= t.length; i++) if (p.every((w, j) => t[i + j] === w)) return true;
  return false;
}
const longestFirst = (list) => [...list].sort((a, b) => toks(b).length - toks(a).length || b.length - a.length);

/** The target of a "which" question: the number or thing that is smallest / biggest. */
export function targetOf(it) {
  if (it.kind === 'numbers') {
    const s = [...it.nums].sort((a, b) => a - b);
    return it.want === 'biggest' ? s[2] : s[0];
  }
  if (it.kind === 'things') return it.want === 'smallest' ? it.things[0] : it.things[2];
  return null;
}
/** The three, as they are shown and said (mixed, the same order every time). */
export const shownOf = (it) => (it.kind === 'numbers' ? shownOrder(it.id, it.nums) : shownOrder(it.id, it.things));
/** Which of the three things `text` names, or null. */
export function thingIn(it, text) {
  return longestFirst(it.things).find((t) => saysPhrase(text, t)) || null;
}

const otherGroups = (it) => GROUP_NAMES.filter((g) => !it.accept.some((a) => saysPhrase(g, a) || saysPhrase(a, g)));

/** true / false / null (null: cannot say — never a miss). */
export function judgeItem(it, value) {
  if (value == null) return null;
  if (it.kind === 'numbers') {
    const n = typeof value === 'number' ? value : parseNumber(String(value));
    if (n == null || !it.nums.includes(n)) return null;
    return n === targetOf(it);
  }
  if (it.kind === 'things') {
    const t = thingIn(it, value);
    return t == null ? null : t === targetOf(it);
  }
  if (it.kind === 'groups') {
    if (it.accept.some((a) => saysPhrase(value, a))) return true;
    if (otherGroups(it).some((g) => saysPhrase(value, g))) return false;
    return null;
  }
  if (it.kind === 'finish') {
    if (longestFirst(it.accept).some((a) => saysPhrase(value, a))) return true;
    if (it.wrong.some((w) => saysPhrase(value, w))) return false;
    return null;
  }
  return null;
}

const listWords = (xs) => (xs.length < 2 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const andWords = (xs) => (xs.length < 2 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------
registerModule(
  { type: GAME, title: 'Thinking games', core: 'new',
    description: 'Smallest or biggest of three, name the group, finish the sentence. Each player gets '
      + 'questions at their own level, and it gets harder as they get better.',
    // Nothing to fetch: the questions are built in. The AI writer is an extra, off by default, and the
    // game is complete without it.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: START_VOICE },
  (ctx) => {
    const rand = ctx.rand || Math.random;
    let cfgNow = { ...DEFAULTS };
    let mixAt = 0;
    let dealt = null;              // the item on screen (a dealt copy, with `want`)
    let api = null;
    // The screen's person's level is kept WITH THEM, the same on each of their screens, with their own
    // start in this game, else their usual one; everybody else's stays on this screen's row; a refused save merges, entry by
    // entry (adaptive_play.js openPersonLadder).
    const ladderRows = openPersonLadder(ctx, { gameKey: GAME, onChange: () => api?.render() });
    const store = ladderRows.store;
    let ai = null;
    const getAI = () => (ai = ai || ctx.questionAI || createAI());
    const session = createAdaptiveSession({
      cfg: () => cfgNow,
      bankFor: (g) => BANKS[g] || [],
      store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      startFor: ladderRows.startFor, startMark: ladderRows.startMark,
      onChange: () => api?.render(),
      writer: async (req) => (await writeQuestions({ ai: getAI(), ...req })).items,
    });
    ladderRows.attach(session);

    function deal(game) {
      const q = session.deal(game);
      if (!q) { dealt = null; return []; }
      const k = cfgNow;
      const askFor = q.kind === 'numbers' ? k.numbersAsk : k.thingsAsk;
      const want = askFor === 'both' ? (rand() < 0.5 ? 'smallest' : 'biggest') : (askFor === 'biggest' ? 'biggest' : 'smallest');
      dealt = Object.freeze({ ...q, want: q.kind === 'numbers' || q.kind === 'things' ? want : null });
      return [dealt];
    }

    const shownWords = (it) => shownOf(it).map(String);
    const adapterFor = (gameId) => ({
      items: () => deal(gameId === 'mix' ? MIX_ORDER[(mixAt++) % MIX_ORDER.length] : gameId),
      empty: () => 'There are no questions for this game yet.',
      ask(it, c) {
        const pre = session.askPrefix();
        if (it.kind === 'numbers' || it.kind === 'things') {
          return pre + fill(it.want === 'biggest' ? c.askBiggest : c.askSmallest, { list: listWords(shownWords(it)) });
        }
        if (it.kind === 'groups') return pre + fill(c.askGroup, { list: cap(listWords(it.things).replace(/ or /, ', ')) });
        return pre + fill(c.askFinish, { stem: it.stem });
      },
      candidates(it, c, r) {
        if (it.kind === 'numbers' || it.kind === 'things') return shownWords(it);
        if (it.kind === 'groups') {
          const others = shuffle(otherGroups(it), r).slice(0, 2);
          return shuffle([it.group, ...others], r);
        }
        return shuffle([it.accept[0], ...it.wrong.slice(0, 2)], r);
      },
      offer(it, cand, c) {
        if (it.kind === 'numbers') return fill(c.offerNumber, { candidate: cand });
        if (it.kind === 'things') return fill(c.offerThing, { candidate: cand });
        if (it.kind === 'groups') return fill(c.offerGroup, { candidate: cand });
        return fill(c.offerFinish, { stem: it.stem, candidate: cand });
      },
      judge: (it, v) => judgeItem(it, v),
      hint(it, n, c) {
        if (it.kind === 'numbers' || it.kind === 'things') {
          // Take a wrong one away each time: two hints leave only the answer.
          const t = targetOf(it);
          const wrong = shownOf(it).filter((x) => x !== t);
          const x = wrong[n - 1];
          if (x == null) return '';
          return fill(it.kind === 'numbers' ? c.hintNotNumber : c.hintNotThing, { x });
        }
        // A meaning cue first, then a sound cue.
        if (n === 1) return it.cue || '';
        if (n === 2) {
          const a = it.kind === 'groups' ? it.group : it.accept[0];
          return fill(c.hintFirst, { letter: a.charAt(0).toUpperCase() });
        }
        return '';
      },
      answer(it) {
        if (it.kind === 'numbers' || it.kind === 'things') return String(targetOf(it));
        if (it.kind === 'groups') return it.group;
        return it.accept[0];
      },
      explain(it, answer, c) {
        if (it.kind === 'numbers') return fill(c.explainNumber, { answer: targetOf(it), want: it.want });
        if (it.kind === 'things') return fill(c.explainThing, { answer: targetOf(it), want: it.want });
        if (it.kind === 'groups') return fill(c.explainGroup, { list: cap(andWords(it.things)), group: it.group });
        const said = longestFirst(it.accept).find((a) => saysPhrase(answer, a)) || it.accept[0];
        return fill(c.explainFinish, { sentence: `${it.stem} ${said}` });
      },
      vocab(it) {
        if (it.kind === 'numbers') return it.nums.map((n) => numberWord(n));
        if (it.kind === 'things') return [...it.things];
        if (it.kind === 'groups') return [...new Set([...it.accept, ...GROUP_NAMES])];
        return [...it.accept, ...it.wrong];
      },
      heardText: (v) => String(v),
      fromVoice(it, { text, raw }) {
        if (it.kind === 'numbers') { const n = parseNumber(raw); return n == null ? null : { value: String(n) }; }
        return text ? { value: text } : null;
      },
      unknownLine(value, c) {
        const it = dealt;
        const heard = String(value);
        return it && (it.kind === 'numbers' || it.kind === 'things') ? fill(c.notAnOption, { heard }) : fill(c.notSure, { heard });
      },
    });
    const games = Object.fromEntries(GAMES.map((g) => [g, adapterFor(g)]));

    // ---- the view: the three as tiles, the things as cards, the sentence with its gap ----
    const tile = (v, small = false) => `<button type="button" class="qz-pick" data-pick="${esc(v)}"${small ? ' data-small' : ''}>${esc(v)}</button>`;
    const view = {
      askHtml(s, c) {
        const it = s.item;
        if (it.kind === 'numbers' || it.kind === 'things') return esc(it.want === 'biggest' ? 'Which is the biggest?' : 'Which is the smallest?');
        if (it.kind === 'groups') return esc('What group do they all belong to?');
        return `${esc(it.stem)} <span class="qz-blank" data-gap>___</span>`;
      },
      left(s) {
        const it = s.item;
        if (it.kind === 'numbers' || it.kind === 'things') {
          return `<div class="qz-picks" data-three>${shownWords(it).map((v) => tile(v, it.kind === 'things')).join('')}</div>`;
        }
        const picks = `<div class="qz-picks" data-choices>${(s.candidates || []).map((v) => tile(v, true)).join('')}</div>`;
        if (it.kind === 'groups') {
          return `<div class="qz-left-stack"><div class="qz-things" data-things>${it.things.map((t) => `<p class="qz-card">${esc(t)}</p>`).join('')}</div>${picks}</div>`;
        }
        // The sentence itself is the question line above; here are only the endings to touch.
        return picks;
      },
      pairHtml(s) {
        const it = s.item;
        if (it.kind === 'finish') return `<div class="wg-pair" data-pair>${esc(s.pair.explain)}</div>`;
        return `<div class="wg-pair" data-pair>${esc(String(s.pair.answer).toUpperCase())}</div>`;
      },
      turnHtml: (s) => session.turnHtml(s, s.item?.kind || null),
      onResult: (r) => { session.record(r); },
      allowAward: () => session.allowAward(),
      scoreDetail: (s) => session.scoreDetail() || (s.asked ? `${s.rightCount} of ${s.asked}` : ''),
      scoreLine: (s) => session.scoreDetail() || `${s.rightCount} right so far.`,
      pointNote: (game, item) => `thinking games: ${item.kind}`,
      onConfig: (c) => { cfgNow = c; ladderRows.onConfig(c); },
      init: (a) => { api = a; },
      destroy: () => { session.destroy(); ladderRows.destroy(); },
    };

    const inner = quizModule({ type: GAME, title: 'Thinking games', scoreLabel: 'Thinking games: right answers',
      games, defaults: DEFAULTS, gameKey: 'game', view, startGate: true, autostart: DEFAULTS.autostart })(ctx);
    // The test escape hatch: the ladder, the same object the module plays with.
    inner.__session = session;
    return inner;
  },
);
