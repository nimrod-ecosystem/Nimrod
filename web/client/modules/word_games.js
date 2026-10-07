// word_games.js — THE VOICE WORD GAMES: Opposites, Rhyming and a Yes/No quiz (row 2.31).
//
// Mike, 2026-09-30: *"Computer please play the whatever game. A couple options being opposites
// and rhyming. It would go into fullscreen and have a picture with the word and audibly say what
// is the opposite of... If she gets it right, there's a visual and audio celebration."* A yes/no
// quiz joined them the same day, and Design drew all of it (room-is-the-screen §5, voice.html;
// room-add-ons §10: the quiz "reuses their cue and their unsure, wrong + hint, two-misses and
// 'Another one?' screens exactly").
//
// ---------------------------------------------------------------------------------------
// SWITCH AND SCREEN FIRST, VOICE-READY
// ---------------------------------------------------------------------------------------
//
// Every question is answerable with a switch and with the on-screen buttons. By default (`answerBy`
// 'choices', 2026-10-02 late) nothing is offered: the three words are buttons, tapped or stepped through
// with one switch. The 'yesno' option offers one candidate at a time ("Is it COLD?"); Yes on the right
// one is right, No steps to the next. Voice arrives through ONE seam, `hear(result)`, which takes
//
//     { text, confidence, alternatives, reason }
//
// and is also reachable on the bus as `speech/answer` (or this instance's own `speech/answer#id`).
// `input_speech.js` publishes there (answer mode, row 2.31 hooks): while this game has an open
// grammar and the microphone is on, what is heard without a wake phrase comes here instead of
// going to the phrase table, and "computer please play opposites" arrives on `word_games/play`.
// The game publishes the words it can accept right now on
// `speech/grammar`, and *** THAT LIST ALWAYS CARRIES WRONG ANSWERS AND "[unk]" *** — row 2.28's
// bench measurement: a grammar made only of right answers ALWAYS hears a right answer.
// (Note AO made OPEN recognition the default: the list is then what an utterance is matched
// against, exactly, and a word one sound off exactly one of them arrives here as an UNSURE hearing
// (`nearMiss`). The wrong answers and "[unk]" still matter for somebody on grammar mode.)
//
// ---------------------------------------------------------------------------------------
// MIKE'S MISS FLOW, EXACTLY (row 2.31, 2026-09-30)
// ---------------------------------------------------------------------------------------
//
//   1. a CONFIDENT wrong answer: "It sounded like you said X. That is incorrect." Then a hint.
//      Then the question again.
//   2. BELOW THE CONFIDENCE THRESHOLD (a setting): "It sounds like you might be saying X, but
//      I'm not sure because Y" — instead of (1). NOT a miss, never scored: a recogniser being
//      unsure is not the person being wrong (the rule trivia.js wrote down before any recogniser
//      existed). Yes confirms X, No or "Say it again" asks again.
//   3. after the second miss: "Would you like to try again, or hear the answer?"
//   4. after a right answer, or after hearing the answer: THE NEXT QUESTION, by itself. Mike retired
//      "Would you like to do another one?" on 2026-10-02 ("it ruins the flow of the game. They can
//      just stop answering or ask the computer to stop") - the same change as quiz_flow.js, item 4:
//      a celebration for `celebrateMs`, a shown answer for `answerMs`, then the next question; "stop"
//      or "I'm done" (quiz_flow.js STOP_PHRASES, when it is not this question's own answer) ends it.
//      Mike, the same day: "Yes. Skip asking as default." - so "another one?" is the `askAnother`
//      setting (quiz_flow.js ASK_ANOTHER_FIELD), OFF; on, it is asked after the celebration and under
//      a revealed answer, exactly as before 2026-10-02.
//   5. every question can be answered by voice OR a switch yes/no.
//
// Every spoken line is an editable text setting whose default is Mike's wording. The number of
// misses before (3), the threshold in (2) and the points are settings too (Porting Rule 1).
//
// *** Y IS ONLY EVER A TRUE SIGNAL. *** "because it was very quiet / there was other noise / it
// was cut off / it could also be Z" is said only when the recogniser REPORTED that reason (or
// handed back an alternative Z). A recogniser that reports none gets the line without "because":
// a made-up reason is a lie told to somebody about their own voice.
//
// Points: School points through the shared ledger, once per question answered right, never for
// a miss, an unsure hearing or a revealed answer.

//
// ---------------------------------------------------------------------------------------
// LEVELS, AND EACH PLAYER AT THEIR OWN (row 2.63, 2026-10-07)
// ---------------------------------------------------------------------------------------
//
// Every word and question has a difficulty (word_games_words.js argues what "harder" is for each
// game), and the three games are on the shared ladder exactly as Brain games and Thinking games are:
// `adaptive_play.js` deals each question at the player's level and records how it went, the level is
// kept with the person on every screen of theirs (`openPersonLadder`), "Start this game at" and their
// usual starting level apply, and two or more players take turns, each at their own level. This module
// keeps its own engine (below) for its own screen; it only hands the dealing and the results to the
// ladder (`deal`, `onResult`). The same questions are asked inside Quiz mix through `WORD_ADAPTERS`,
// built from the same pure pieces the engine uses (`askLineOf`, `judgeWord`, ...), not a copy of them.

import { registerModule } from '../module.js';
import { createPointsLedger } from '../points.js';
import { symbolSvg } from '../aac_symbols.js';
import {
  OPPOSITES, RHYMING, YES_NO, YES_WORDS, NO_WORDS, PRONUNCIATIONS, RHYME_OFFER_POOL,
  rhymes, rhymesFor, hasPicture, itemLevel,
} from '../word_games_words.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openPersonLadder } from '../adaptive_play.js';
import { ensureQuizStyle } from '../quiz_view.js';
// *** THE PURE HELPERS LIVE IN quiz_flow.js NOW (row 2.45), and are re-exported below. *** Three
// more answer games arrived with "the same miss flow as row 2.31", so the wording, `reasonFor`
// (Y only ever a true signal), the chime and the stars have one home instead of four. Moved, not
// changed: word_games_test and quiz_flow_test both check these are the same functions.
import {
  ANSWER_TOPIC, GRAMMAR_TOPIC, UNKNOWN, FLOW_LINES, FLOW_LINE_LABELS, STOP_PHRASES, ANSWER_MS_FIELD, ASK_ANOTHER_FIELD,
  answerByField, normalize, fill, esc, fillHtml, shuffle, isYes, isNo, isAgain, isReveal, isDone, isStop, reasonFor,
  defaultChime as sharedChime, STARS, CAT_URL,
} from '../quiz_flow.js';

export { ANSWER_TOPIC, GRAMMAR_TOPIC, UNKNOWN, normalize, fill, shuffle, isYes, isNo, reasonFor };

export const GAME = 'word_games';
export const GAMES = ['opposites', 'rhyming', 'yesno'];
// The recogniser seam on the bus is ANSWER_TOPIC ('speech/answer'); the scoped bus also answers
// `speech/answer#<instanceId>`, so a recogniser that knows which panel asked can address that one
// panel only. GRAMMAR_TOPIC ('speech/grammar') is what this game can accept right now, for a
// grammar-limited recogniser (Vosk). Both are declared once, in quiz_flow.js.
// "Computer please play opposites" lands here (input_speech.js ROUTES): `{ game }`.
export const PLAY_TOPIC = `${GAME}/play`;

// *** THE SPOKEN LINES. *** Mike's wording where he gave it (wrongLine, unsureLine, twoMissLine;
// his anotherLine is said only with the askAnother setting on, see item 4 above), Design's copy for the rest (voice.html). `{placeholders}` are filled per question;
// an unknown one is left empty rather than read out as a brace.
// The shared lines are read from FLOW_LINES (one copy of Mike's wording); the order here is the
// order the settings menu lists them in, unchanged.
const F = FLOW_LINES;
export const LINES = Object.freeze({
  askOpposites: 'What is the opposite of {word}?',
  askRhyming: 'Which word rhymes with {word}?',
  candidateOpposites: 'Is it {candidate}?',
  candidateRhyming: 'Does {candidate} rhyme with {word}?',
  wrongLine: F.wrongLine,
  switchWrongLine: F.switchWrongLine,
  unsureLine: F.unsureLine,
  unsureNoReasonLine: F.unsureNoReasonLine,
  reasonQuiet: F.reasonQuiet,
  reasonNoise: F.reasonNoise,
  reasonCutoff: F.reasonCutoff,
  reasonAlternative: F.reasonAlternative,
  hintLine: F.hintLine,
  hintRhyming: 'it ends with the same sound: {sound}',
  twoMissLine: F.twoMissLine,
  rightLine: F.rightLine,
  explainOpposites: '{answer} is the opposite of {word}.',
  explainRhyming: '{answer} rhymes with {word}.',
  answerLine: F.answerLine,
  anotherLine: F.anotherLine,
  doneLine: F.doneLine,
  notCaughtLine: F.notCaughtLine,
  unknownWordLine: "I heard {heard}, but I don't know that word well enough to check it. Try another word.",
  yesNoOnlyLine: 'I heard {heard}. This one is a yes or a no.',
});

export const DEFAULTS = Object.freeze({
  game: 'opposites',
  // Below this, a heard answer gets the unsure line instead of a verdict. 0.7 is a GUESS: the
  // bench numbers Design asked for (README "What Design needs back" #3) do not exist yet, and
  // Vosk handed 'hello there' back as 'louder' at 1.0 — confidence alone is not trustworthy,
  // which is why the grammar must carry wrong answers too.
  unsureBelow: 0.7,
  // Mike: "After the second time ask if they'd like to try again, or hear the answer."
  missesBeforeOffer: 2,
  // One point per right answer: points.js's atom is "roughly a minute of effort", and one short
  // question is less than that — the same one trivia pays for a first-guess answer.
  correctPoints: 1,
  celebrateMs: 3000,
  // How long a revealed answer stays before the next question comes by itself (quiz_flow.js argues it).
  answerMs: ANSWER_MS_FIELD.default,
  // "Would you like to do another one?" between questions: off (item 4).
  askAnother: ASK_ANOTHER_FIELD.default,
  sound: true,
  speak: true,
  // Say the switch candidate ("Is it COLD?") after the question. A voice player hears one
  // possible answer as a result; a switch player cannot play without it.
  sayChoice: true,
  showScore: true,
  // 'scan': next moves the highlight, select presses it (one switch with a scan, or two).
  // 'yesno': select is Yes and next is No (two switches, one each).
  twoSwitch: 'scan',
  // SAY THE WORD, NOT "IS IT COLD?", BY DEFAULT (Mike's brain-games ruling, 2026-10-02 late, carried here:
  // "You should be able to say the answer. Yes/no should be an option though."). 'choices': the question
  // is asked and nothing is offered; the word is said, tapped, or stepped to with one switch. FOR: finding
  // the opposite or the rhyme IS the exercise, and "Is it COLD?" said after "the opposite of hot" gives it
  // away to anybody listening. Every word is in the open vocabulary (every opposites word, the whole rhyme
  // table). AGAINST: somebody who can only nod or shake - one row away, and two Yes / No switches get it
  // whatever this says. The Yes or no QUIZ is yes / no either way: its answers are the two (no row there).
  answerBy: 'choices',
  // The ladder's own defaults (adaptive_play.js argues each): one player, the screen's person, starting
  // at the easiest level and moving by their answers.
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

const LINE_LABELS = {
  askOpposites: 'Opposites question', askRhyming: 'Rhyming question',
  candidateOpposites: 'Opposites: offering one answer', candidateRhyming: 'Rhyming: offering one answer',
  wrongLine: 'A heard answer that is wrong', switchWrongLine: 'A switch answer that is wrong',
  unsureLine: 'Not sure what was heard (with a reason)', unsureNoReasonLine: 'Not sure what was heard (no reason known)',
  reasonQuiet: 'Reason: very quiet', reasonNoise: 'Reason: other noise', reasonCutoff: 'Reason: cut off',
  reasonAlternative: 'Reason: another word it could be', hintLine: 'The hint', hintRhyming: 'Rhyming hint',
  twoMissLine: 'After the misses', rightLine: 'A right answer', explainOpposites: 'Opposites: the pair',
  explainRhyming: 'Rhyming: the pair', answerLine: 'Hearing the answer',
  anotherLine: FLOW_LINE_LABELS.anotherLine, doneLine: 'Finished', notCaughtLine: "Didn't catch it", unknownWordLine: 'Rhyming: a word it does not know',
  yesNoOnlyLine: 'Yes/no quiz: not a yes or a no',
};

const SETTINGS = [
  { key: 'game', label: 'Which game', kind: 'choice', default: DEFAULTS.game, level: 'essential',
    options: [{ value: 'opposites', label: 'Opposites' }, { value: 'rhyming', label: 'Rhyming' },
              { value: 'yesno', label: 'Yes or no' }] },
  answerByField({ on: 'choices', example: 'Is it COLD?',
    appliesWhen: (v) => ((v && v.game) || DEFAULTS.game) !== 'yesno' }),
  { key: 'showScore', label: 'Score', default: true, level: 'standard',
    onLabel: 'Show how many are right so far', offLabel: 'No score on screen' },
  { key: 'speak', label: 'Say the questions aloud', default: true, level: 'standard',
    onLabel: 'On', offLabel: 'Off' },
  { key: 'sayChoice', label: 'Say the switch choice too', default: true, level: 'standard',
    onLabel: 'Yes ("Is it COLD?")', offLabel: 'Only the question',
    note: 'Somebody on a switch needs it; somebody answering aloud hears one possible answer.' },
  { key: 'sound', label: 'Chime for a right answer', default: true, level: 'standard',
    onLabel: 'On', offLabel: 'Off' },
  { ...ASK_ANOTHER_FIELD },
  { key: 'twoSwitch', label: 'Switches', kind: 'choice', default: 'scan', level: 'standard',
    options: [{ value: 'scan', label: 'Next moves, Select chooses' },
              { value: 'yesno', label: 'Select is Yes, Next is No' }] },
  { key: 'missesBeforeOffer', label: 'Misses before offering the answer', kind: 'choice',
    default: 2, level: 'advanced',
    options: [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }] },
  { key: 'unsureBelow', label: 'Ask to confirm when the hearing is less sure than', kind: 'choice',
    default: 0.7, level: 'advanced',
    options: [0.5, 0.6, 0.7, 0.8, 0.9].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` })),
    note: 'Below this, it says what it thinks it heard and asks, instead of marking it wrong.' },
  { key: 'correctPoints', label: 'Points for a right answer', kind: 'number', default: 1,
    level: 'advanced', min: 0, max: 5, step: 1, note: 'A miss never costs anything.' },
  { key: 'celebrateMs', label: 'How long the celebration stays', kind: 'number', default: 3000,
    level: 'advanced', min: 1000, max: 6000, step: 500, displayScale: 1000,
    unit: 'seconds', unitOne: 'second' },
  { ...ANSWER_MS_FIELD },
  // Players, "Start this game at", and how the level moves: the same rows every ladder game has. Four
  // starting levels, the four difficulties.
  ...adaptiveSettings({ ai: false, startLevels: 4 }),
  ...Object.keys(LINES).map((key) => ({ key, label: LINE_LABELS[key] || key, kind: 'text',
    default: LINES[key], level: 'advanced' })),
];

// ---------------------------------------------------------------------------------------
// THE QUESTIONS, PURE: what each game asks, offers, hints, accepts and says (shared by the engine
// below and by Quiz mix, `WORD_ADAPTERS`)
// ---------------------------------------------------------------------------------------
const LISTS = Object.freeze({ opposites: OPPOSITES, rhyming: RHYMING, yesno: YES_NO });
/** The game's name on the ladder (the `ratings` row): its own, so it never shares a level with another game. */
export const ladderGame = (g) => `wg_${g}`;
const slug = (s) => normalize(s).replace(/\s+/g, '-');
const BANK_CACHE = {};
/**
 * The ladder's bank for one game: every item as written, with an `id` (stable across releases: the word, or the
 * question's words), its `level` (its difficulty, packs.js DIFFICULTY_LEVELS) and its `game`.
 */
export function wordBank(game) {
  if (!LISTS[game]) return [];
  if (!BANK_CACHE[game]) {
    BANK_CACHE[game] = Object.freeze(LISTS[game].map((it) => Object.freeze({
      ...it, game, level: itemLevel(it), id: `wg:${game}:${slug(game === 'yesno' ? it.q : it.word)}`,
    })));
  }
  return BANK_CACHE[game];
}
const yesNoOf = (t) => (isYes(t) ? 'yes' : isNo(t) ? 'no' : null);

export function askLineOf(game, it, k) {
  if (!it) return '';
  if (game === 'opposites') return fill(k.askOpposites, { word: it.word });
  if (game === 'rhyming') return fill(k.askRhyming, { word: it.word });
  return it.q || '';
}
export function candLineOf(game, it, cand, k) {
  if (!cand || !it) return '';
  if (game === 'opposites') return fill(k.candidateOpposites, { candidate: cand, word: it.word });
  if (game === 'rhyming') return fill(k.candidateRhyming, { candidate: cand, word: it.word });
  return '';
}
export function hintOf(game, it, k) {
  if (game === 'rhyming') return fill(k.hintRhyming, { sound: it.sound });
  return it.hint || '';
}
export function answerWordOf(game, it) {
  if (game === 'opposites') return it.accept[0];
  if (game === 'rhyming') return it.example;
  return it.answer;
}
export function explainOf(game, it, answer, k) {
  if (game === 'opposites') return fill(k.explainOpposites, { answer, word: it.word });
  if (game === 'rhyming') return fill(k.explainRhyming, { answer, word: it.word });
  return it.explain || '';
}
/**
 * The words offered (the switch's candidates, the tiles): the answer and two wrong ones. A rhyme with
 * `decoys` (the near misses, word_games_words.js) offers exactly those; otherwise two non-rhymes, pictured first.
 */
export function candidatesOf(game, it, rand = Math.random) {
  if (game === 'opposites') return shuffle([it.accept[0], ...(it.wrong || [])], rand);
  if (game === 'rhyming') {
    const all = rhymesFor(it.word);
    const pictured = all.filter(hasPicture);
    const pool = pictured.length ? pictured : all;
    const r = pool.length ? pool[Math.floor(rand() * pool.length)] : it.example;
    const decoys = (it.decoys || []).filter((w) => rhymes(it.word, w) === false);
    if (decoys.length >= 2) return shuffle([r, ...shuffle(decoys, rand).slice(0, 2)], rand);
    const nots = RHYME_OFFER_POOL.filter((w) => w !== it.word && rhymes(it.word, w) === false);
    const pic = shuffle(nots.filter(hasPicture), rand);
    const rest = shuffle(nots.filter((w) => !hasPicture(w)), rand);
    return shuffle([r, ...[...pic, ...rest].slice(0, 2)], rand);
  }
  if (game === 'yesno') return ['yes', 'no'];
  return [];
}
/** true / false, or null when it cannot be judged (a word the rhyme table does not know; not a yes or a no). */
export function judgeWord(game, it, word) {
  if (game === 'yesno') { const a = yesNoOf(word); return a ? a === it.answer : null; }
  if (game === 'opposites') return it.accept.includes(word);
  return rhymes(it.word, word);
}
/**
 * The answer word in an utterance: an accepted word anywhere in it first ("it's cold"), then a known
 * word, then the last word. `text` is already normalized.
 */
export function extractWord(game, it, text) {
  const toks = text.split(' ').filter(Boolean);
  if (game === 'opposites') {
    if (it.accept.includes(text)) return text;
    const hit = toks.find((t) => it.accept.includes(t));
    return hit || (toks.length === 1 ? text : toks[toks.length - 1] || text);
  }
  if (game === 'rhyming') {
    const hit = toks.find((t) => rhymes(it.word, t) === true);
    if (hit) return hit;
    const known = toks.filter((t) => PRONUNCIATIONS[t]);
    return known.length ? known[known.length - 1] : (toks[toks.length - 1] || text);
  }
  return text;
}
/** Every word the game can hear as an answer (right AND wrong; a grammar-limited recogniser needs both). */
export function vocabOf(game) {
  if (game === 'opposites') return [...new Set(OPPOSITES.flatMap((o) => [o.word, ...o.accept, ...(o.wrong || [])]))];
  if (game === 'rhyming') return Object.keys(PRONUNCIATIONS);
  return [...YES_WORDS, ...NO_WORDS];
}

// ---------------------------------------------------------------------------------------
// SMALL PURE HELPERS — normalize, fill, fillHtml, esc, shuffle, isYes/isNo/isAgain/isReveal/
// isDone and reasonFor (THE REASON Y: only a reason the recogniser reported, never made up) are
// imported from quiz_flow.js above. `reasonFor`'s default lines are the same shared wording.
// ---------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------
// THE ENGINE — the states and the miss flow, with no DOM. The module below draws it.
// ---------------------------------------------------------------------------------------
//
// Phases: 'asking' (question up; a wrong answer's feedback and hint shown here too), 'unsure',
// 'twoMiss', 'celebrate', 'answer' (a revealed answer, then the next question), 'another' ("another
// one?" - only with `askAnother` on), 'done' (said stop).
//
// THE LADDER'S THREE SEAMS (row 2.63), each optional, absent = the engine as before (its own shuffled deck):
//   deal(game)       the next question, dealt off the ladder at the player's level; null: the deck instead
//   onResult(r)      one finished question, once: `{ game, item, right, misses, hintsGiven, revealed, skipped }`
//                    (quiz_flow.js `onResult`'s shape, so adaptive_play.js `record` takes it as it is)
//   prefix()         said in front of every question ("Ann, your turn. "), '' with one player
export function createEngine({
  cfg = () => DEFAULTS, rand = Math.random,
  say = () => {}, award = () => {}, chime = () => {}, onChange = () => {}, publishGrammar = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
  deal = null, onResult = () => {}, prefix = () => '',
} = {}) {
  const c = () => ({ ...DEFAULTS, ...(cfg() || {}) });
  let game = null;
  let deck = [];
  let at = -1;
  let item = null;
  let serial = 0;           // which question this is; points are paid at most once per serial
  let paidSerial = -1;
  let phase = 'idle';
  let misses = 0;
  let cands = [];           // the switch path's candidates for this question
  let ci = 0;
  let highlight = 0;
  let feedback = null;      // { kind: 'wrong'|'notCaught'|'unknown'|'yesNoOnly', text, hint? }
  let unsure = null;        // { heard, reason }
  let revealed = false;
  let pair = null;          // { word, answer, explain } — what the right screen shows
  let rightCount = 0;
  let asked = 0;
  let voiceSeen = false;
  let timer = null;
  let dead = false;
  let hintsGiven = 0;
  let resultSerial = -1;

  const itemsFor = (g) => (g === 'rhyming' ? RHYMING : g === 'yesno' ? YES_NO : OPPOSITES);

  // The yes/no QUIZ offers nothing to walk here (its two answers are the Yes / No stops).
  function buildCands(it) { return game === 'yesno' ? [] : candidatesOf(game, it, rand); }

  // ONCE PER QUESTION (the serial guard), as quiz_flow.js reports: right; the answer shown after the
  // misses; or skipped / stopped after at least one miss (a skip before any try is not a result).
  function report(extra) {
    if (!item || resultSerial === serial) return;
    resultSerial = serial;
    try { onResult({ game, item, misses, hintsGiven, revealed, skipped: false, right: false, ...extra }); }
    catch (err) { console.error('word_games: result', err); }
  }

  const candidate = () => cands[ci] || null;
  const isRightCandidate = (w) => (game === 'opposites' ? item.accept.includes(w)
    : game === 'rhyming' ? rhymes(item.word, w) === true : false);
  // The switch path's shape (`answerBy`, DEFAULTS; quiz_flow.js has the same two): 'choices' walks the
  // words themselves, 'yesno' offers one ("Is it COLD?"). The yes/no QUIZ is always yes / no, and two
  // switches that ARE yes and no have nothing to walk.
  const offers = () => (game !== 'yesno' && c().answerBy === 'choices' && c().twoSwitch !== 'yesno' ? 'choices' : 'yesno');
  // In the yes/no shape a spoken yes / no answers the offer - unless it is one of THIS question's own
  // words ("the opposite of stop"), which is an answer, the same guard as the stop phrases.
  const ownWord = (t) => (game === 'opposites' ? [item.word, ...item.accept, ...(item.wrong || [])].includes(t)
    : game === 'rhyming' ? rhymes(item.word, t) === true : false);
  const offerByVoice = () => !!item && game !== 'yesno' && offers() === 'yesno' && !!candidate();

  function askLine() {
    let pre = '';
    try { pre = String(prefix() || ''); } catch { pre = ''; }
    return item ? pre + askLineOf(game, item, c()) : '';
  }
  function candLine() {
    if (offers() === 'choices') return '';
    return candLineOf(game, item, candidate(), c());
  }
  const hintText = () => hintOf(game, item, c());
  const answerWord = () => answerWordOf(game, item);
  const explain = (answer) => explainOf(game, item, answer, c());

  function grammar() {
    const words = new Set();
    const add = (list) => list.forEach((w) => w && words.add(w));
    const answers = () => add(vocabOf(game));
    if (phase === 'asking') { answers(); if (offerByVoice()) { add(YES_WORDS); add(NO_WORDS); } }
    else if (phase === 'unsure') { answers(); add(YES_WORDS); add(NO_WORDS); add(['again', 'say it again']); }
    else if (phase === 'twoMiss') add(['try again', 'again', 'hear the answer', 'answer', 'tell me']);
    else if (phase === 'another') { add(YES_WORDS); add(NO_WORDS); add(['done', "i'm done"]); }
    else if (phase === 'done') { add(YES_WORDS); add(['play again', 'again']); }
    else return [];
    // The ways to say stop, wherever a question waits (quiz_flow.js STOP_PHRASES).
    if (phase !== 'done') add(STOP_PHRASES);
    // *** ALWAYS. *** Without it a grammar-limited recogniser snaps every sound to a listed word.
    words.add(UNKNOWN);
    return [...words];
  }

  function changed() {
    if (dead) return;
    try { publishGrammar({ open: grammar().length > 0, words: grammar(), phase }); }
    catch (err) { console.error('word_games: grammar', err); }
    onChange();
  }
  const speak = (...lines) => { if (!dead) say(lines.filter(Boolean)); };
  function stopTimer() { if (timer !== null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; } }

  function nextItem() {
    stopTimer();
    // Skipped after trying: a result (it was hard). Skipped before any try: nothing to report.
    if (item && phase === 'asking' && misses > 0) report({ skipped: true });
    // Off the ladder when there is one; else the game's own shuffled deck, as before.
    let dealt = null;
    if (typeof deal === 'function') { try { dealt = deal(game) || null; } catch (err) { dealt = null; console.error('word_games: deal', err); } }
    if (dealt) {
      item = dealt;
    } else {
      const items = itemsFor(game);
      if (at + 1 >= deck.length) {
        const prev = item;
        deck = shuffle(items, rand);
        // A fresh deal never opens on the question that just closed the last one.
        if (deck.length > 1 && deck[0] === prev) deck.push(deck.shift());
        at = 0;
      } else at += 1;
      item = deck[at];
    }
    serial += 1;
    asked += 1;
    misses = 0;
    hintsGiven = 0;
    feedback = null;
    unsure = null;
    revealed = false;
    pair = null;
    cands = buildCands(item);
    ci = 0;
    highlight = 0;
    phase = 'asking';
    speak(askLine(), c().sayChoice ? candLine() : '');
    changed();
  }

  function setGame(g) {
    if (!GAMES.includes(g)) return false;
    game = g;
    deck = [];
    at = -1;
    item = null;
    rightCount = 0;
    nextItem();
    return true;
  }

  function reAsk() {
    phase = 'asking';
    unsure = null;
    highlight = 0;
    feedback = null;
    speak(askLine(), c().sayChoice ? candLine() : '');
    changed();
  }

  function onRight(answer) {
    if (phase !== 'asking' && phase !== 'unsure') return;
    stopTimer();
    phase = 'celebrate';
    feedback = null;
    unsure = null;
    pair = { word: item.word || null, answer, explain: explain(answer) };
    // *** ONCE PER QUESTION. *** The serial guard is what makes a double press, a second hearing
    // or a replayed event unable to pay twice.
    if (paidSerial !== serial) {
      paidSerial = serial;
      rightCount += 1;
      try { award({ amount: Number(c().correctPoints) || 0, game, item, answer }); }
      catch (err) { console.error('word_games: award', err); }
    }
    report({ right: true, answer });
    speak(fill(c().rightLine, { explain: pair.explain }));
    try { chime(); } catch (err) { console.error('word_games: chime', err); }
    const ms = Math.max(0, Number(c().celebrateMs) || DEFAULTS.celebrateMs);
    timer = setTimer(() => { timer = null; onward(); }, ms);
    changed();
  }

  // Item 4: after the celebration, or a shown answer, THE NEXT QUESTION - or "Would you like to do
  // another one?" first, when the `askAnother` setting is on.
  const asksAnother = () => c().askAnother === true;
  function onward() {
    stopTimer();
    if (asksAnother() && phase !== 'another') { toAnother(); return; }
    nextItem();
  }

  function toAnother() {
    stopTimer();
    phase = 'another';
    highlight = 0;
    feedback = null;
    unsure = null;
    speak(c().anotherLine);
    changed();
  }

  function reveal() {
    const answer = answerWord();
    revealed = true;
    pair = { word: item.word || null, answer, explain: explain(answer) };
    report({ right: false });
    stopTimer();
    // Asking "another one?": the answer shown with the question under it, and no clock running.
    if (asksAnother()) {
      phase = 'another';
      highlight = 0;
      feedback = null;
      speak(fill(c().answerLine, { explain: pair.explain }), c().anotherLine);
      changed();
      return;
    }
    phase = 'answer';
    highlight = 0;
    feedback = null;
    speak(fill(c().answerLine, { explain: pair.explain }));
    const ms = Math.max(0, Number(c().answerMs) || DEFAULTS.answerMs);
    timer = setTimer(() => { timer = null; onward(); }, ms);
    changed();
  }

  // Somebody said stop: "Thanks for playing." and Play again.
  function finish() {
    stopTimer();
    if (item && (phase === 'asking' || phase === 'unsure' || phase === 'twoMiss') && misses > 0) report({ skipped: true });
    phase = 'done';
    highlight = 0;
    feedback = null;
    unsure = null;
    speak(c().doneLine);
    changed();
  }
  // A stop phrase that is one of this game's own answers ("stop", the opposite of "go") is an answer.
  function answerVocab() {
    return new Set(vocabOf(game).map((w) => normalize(w)));
  }
  const saidStop = (text) => isStop(text) && !answerVocab().has(normalize(text));

  function onMiss({ heard, via }) {
    const k = c();
    misses += 1;
    const line = via === 'voice' ? fill(k.wrongLine, { heard }) : fill(k.switchWrongLine, { heard });
    unsure = null;
    highlight = 0;
    if (misses >= Math.max(1, Number(k.missesBeforeOffer) || DEFAULTS.missesBeforeOffer)) {
      phase = 'twoMiss';
      feedback = { kind: 'wrong', text: line, heard, via };
      speak(line, k.twoMissLine);
    } else {
      phase = 'asking';
      const hint = hintText();
      if (hint) hintsGiven += 1;
      feedback = { kind: 'wrong', text: line, heard, via, hint };
      speak(line, hint ? fill(k.hintLine, { hint }) : '', askLine(), k.sayChoice ? candLine() : '');
    }
    changed();
  }

  // Something said about a hearing that is NOT a verdict (an unknown word, a non-yes/no, nothing
  // caught): the question stays open and no miss is counted.
  function note(kind, text) {
    phase = 'asking';
    unsure = null;
    feedback = { kind, text };
    speak(text);
    changed();
  }

  function notCaught() {
    const text = c().notCaughtLine;
    if (phase === 'asking') note('notCaught', text);
    else { speak(text); changed(); }
  }

  function toUnsure(heard, result) {
    const k = c();
    const reason = reasonFor(result, heard, k);
    phase = 'unsure';
    unsure = { heard, reason };
    highlight = 0;
    feedback = null;
    speak(reason ? fill(k.unsureLine, { heard, reason }) : fill(k.unsureNoReasonLine, { heard }));
    changed();
  }

  // A word heard with confidence (or confirmed by the person), judged (`judgeWord`, shared with Quiz mix).
  function judge(word, via) {
    if (game === 'yesno') {
      const ans = yesNoOf(word);
      if (!ans) return note('yesNoOnly', fill(c().yesNoOnlyLine, { heard: word }));
      return judgeWord(game, item, ans) ? onRight(ans) : onMiss({ heard: ans, via });
    }
    const r = judgeWord(game, item, word);
    if (r === true) return onRight(word);
    if (r === false) return onMiss({ heard: word, via });
    // NOT IN THE TABLE: not judged, not a miss. "I don't know" is not "wrong".
    phase = 'asking';
    unsure = null;
    return note('unknown', fill(c().unknownWordLine, { heard: word }));
  }

  // Pull the answer word out of an utterance (`extractWord`).
  const extract = (text) => extractWord(game, item, text);

  function answerFrom(text, result, confident) {
    if (game === 'yesno') {
      const ans = yesNoOf(text);
      if (!ans) return confident ? note('yesNoOnly', fill(c().yesNoOnlyLine, { heard: text })) : notCaught();
      return confident ? judge(ans, 'voice') : toUnsure(ans, result);
    }
    // "Is it COLD?" - "yes" (the yes/no shape): the offer is answered, not judged as the word "yes".
    if (phase === 'asking' && offerByVoice() && yesNoOf(text) && !ownWord(text)) {
      return confident ? press(yesNoOf(text)) : notCaught();
    }
    const word = extract(text);
    return confident ? judge(word, 'voice') : toUnsure(word, result);
  }

  /**
   * THE RECOGNISER SEAM. `{ text, confidence, alternatives, reason, nearMiss, heard }`.
   *   confidence  0..1; MISSING COUNTS AS UNSURE — a recogniser that cannot say how sure it is
   *               gets asked to confirm, never a verdict.
   *   reason      'quiet' | 'noise' | 'cutoff' | 'alternative', only when the recogniser knows.
   *   nearMiss    true when `text` is the game word that what was heard (`heard`) was one sound
   *               off (input_speech.js, note AO). Always unsure: asked about, never judged.
   */
  function hear(result = {}) {
    if (dead || !game || !result || typeof result !== 'object') return;
    voiceSeen = true;
    // Celebrating: not listening (the grammar is empty too), so nothing is said over the chime.
    if (phase === 'celebrate' || phase === 'answer' || phase === 'idle') { changed(); return; }
    const raw = String(result.text == null ? '' : result.text).trim();
    const text = normalize(raw);
    if (!text || raw.toLowerCase() === UNKNOWN || text === 'unk') return notCaught();
    const conf = Number(result.confidence);
    // A NEAR MISS (note AO: what was heard was one sound off one of this game's words, and
    // input_speech.js sent the word it was near) is never sure, whatever the engine said.
    const confident = !result.nearMiss && result.confidence != null && Number.isFinite(conf)
      && conf >= Number(c().unsureBelow);
    // "Stop" / "I'm done" with confidence, while a question waits: the sitting ends (item 4).
    if (confident && phase !== 'done' && saidStop(text)) return finish();
    switch (phase) {
      case 'asking': return answerFrom(text, result, confident);
      case 'unsure':
        if (confident && isYes(text)) return press('confirm');
        if (confident && (isNo(text) || isAgain(text))) return press('reject');
        return answerFrom(text, result, confident);
      case 'twoMiss':
        if (!confident) return notCaught();
        if (isAgain(text)) return press('again');
        if (isReveal(text)) return press('reveal');
        return notCaught();
      case 'another':
        if (!confident) return notCaught();
        if (isYes(text)) return press('more');
        if (isNo(text) || isDone(text)) return press('finish');
        return notCaught();
      case 'done':
        if (confident && (isYes(text) || isAgain(text))) return press('restart');
        return undefined;
      default: return undefined;   // celebrating: not listening
    }
  }

  function stops() {
    switch (phase) {
      case 'asking':
        // 'choices': the words themselves are the stops - next lights one, select answers it.
        if (offers() === 'choices') return cands.map((v) => ({ act: 'pick', value: v, label: v }));
        return [{ act: 'yes', label: 'Yes' }, { act: 'no', label: 'No' }];
      case 'unsure': return [{ act: 'confirm', label: 'Yes', heard: unsure?.heard || '' },
                             { act: 'reject', label: 'No' }, { act: 'again', label: 'Say it again' }];
      case 'twoMiss': return [{ act: 'again', label: 'Try again' }, { act: 'reveal', label: 'Hear the answer' }];
      case 'another': return [{ act: 'more', label: 'Yes' }, { act: 'finish', label: "No, I'm done" }];
      case 'done': return [{ act: 'restart', label: 'Play again' }];
      default: return [];
    }
  }

  function press(act, stop = null) {
    if (dead || !item) return;
    switch (act) {
      // A walked-to word ('choices'): judged like a heard one; wrong says the switch line, never "It
      // sounded like you said".
      case 'pick':
        if (phase !== 'asking' || game === 'yesno' || !stop || !stop.value) return;
        judge(stop.value, 'switch');
        return;
      case 'yes':
        if (phase !== 'asking') return;
        if (game === 'yesno') { judge('yes', 'switch'); return; }
        {
          const cand = candidate();
          if (isRightCandidate(cand)) { onRight(cand); return; }
          // A wrong candidate is spent: the next offer is a different one.
          ci = (ci + 1) % Math.max(1, cands.length);
          onMiss({ heard: cand, via: 'switch' });
        }
        return;
      case 'no':
        if (phase !== 'asking') return;
        if (game === 'yesno') { judge('no', 'switch'); return; }
        if (isRightCandidate(candidate())) { onMiss({ heard: candidate(), via: 'switch' }); return; }
        // Right to say no to a wrong one: not a miss, just the next offer.
        ci = (ci + 1) % Math.max(1, cands.length);
        highlight = 0;
        feedback = null;
        speak(candLine());
        changed();
        return;
      case 'confirm':
        if (phase !== 'unsure' || !unsure) return;
        judge(unsure.heard, 'voice');
        return;
      case 'reject':
      case 'again':
        if (phase === 'unsure' || phase === 'twoMiss') reAsk();
        return;
      case 'reveal':
        if (phase === 'twoMiss') reveal();
        return;
      // A press during the celebration or a shown answer: on now (to the next question, or to
      // "another one?" when that is asked). `more` is also "Yes" to "another one?".
      case 'continue':
      case 'more':
        if (phase === 'another') { if (act === 'more') nextItem(); return; }
        if (phase === 'celebrate' || phase === 'answer') onward();
        return;
      case 'finish':
        if (phase === 'done' || phase === 'idle') return;
        finish();
        return;
      case 'restart':
        if (phase === 'done') { rightCount = 0; nextItem(); }
        return;
      default:
    }
  }

  // ONE SWITCH, WALKED ONE WAY AND WRAPPING (module-input-spec). In 'yesno' switch mode the two
  // switches ARE the first and second stop.
  function move(delta) {
    if (dead) return;
    if (phase === 'celebrate' || phase === 'answer') { press('continue'); return; }
    const s = stops();
    if (c().twoSwitch === 'yesno' && delta > 0) { if (s[1]) press(s[1].act); else if (s[0]) press(s[0].act); return; }
    if (!s.length) return;
    highlight = ((highlight + delta) % s.length + s.length) % s.length;
    // Walking the words: the lit one is said (with "Say the switch choice too"), so somebody who cannot
    // see the buttons still knows where they are.
    const lit = s[highlight];
    if (phase === 'asking' && lit && lit.act === 'pick' && c().sayChoice) speak(lit.label);
    changed();
  }
  function select() {
    if (dead) return;
    if (phase === 'celebrate' || phase === 'answer') { press('continue'); return; }
    const s = stops();
    if (!s.length) return;
    const i = c().twoSwitch === 'yesno' ? 0 : Math.min(highlight, s.length - 1);
    press(s[i].act, s[i]);
  }

  /** A word chosen directly (a touched button), judged like a heard one but with the switch line. */
  function answer(value, via = 'touch') {
    if (dead || !item || phase !== 'asking' || game === 'yesno' || value == null || value === '') return;
    judge(normalize(value), via);
  }

  return {
    start: () => setGame(c().game),
    setGame, hear, press, stops, grammar, select, answer,
    next: () => move(1),
    prev: () => move(-1),
    skip: () => { if (item && !dead) nextItem(); },
    snapshot: () => ({
      game, phase, item, misses, candidate: candidate(), candidates: cands.slice(), highlight,
      feedback: feedback ? { ...feedback } : null, unsure: unsure ? { ...unsure } : null,
      revealed, pair: pair ? { ...pair } : null, rightCount, asked, serial, voiceSeen,
      askLine: item ? askLine() : '', candLine: item ? candLine() : '', timerPending: timer !== null,
      offers: game ? offers() : 'yesno',
      // The word the switch has lit, in the 'choices' shape (null otherwise).
      lit: (() => { if (phase !== 'asking') return null; const s = stops()[highlight]; return s && s.act === 'pick' ? s.value : null; })(),
    }),
    destroy() { stopTimer(); dead = true; },
  };
}

// ---------------------------------------------------------------------------------------
// THE CHIME — warm, two notes, once, scaled by the audio bus's master volume so a screen
// somebody turned down stays down — and the celebration's six STARS and happy cat (CAT_URL):
// shared with the row 2.45 games, from quiz_flow.js.
// ---------------------------------------------------------------------------------------
const defaultChime = (level = 1) => sharedChime(level, 'word_games');

const up = (w) => String(w == null ? '' : w).toUpperCase();

// The word with its picture (where the AAC set draws one), and the pair shown after an answer: one
// markup for this module's screen and for Quiz mix.
export function picHtml(word, cls = 'wg-pic') {
  const svg = hasPicture(word) ? symbolSvg(word) : '';
  return `<figure class="${cls}"${svg ? ' data-has-pic' : ''}>${svg}<b>${esc(up(word))}</b></figure>`;
}
export function pairMarkup(game, word, answer) {
  if (game === 'yesno') return `<div class="wg-pair" data-pair>${esc(up(answer))}</div>`;
  const sep = game === 'opposites' ? ' ↔ ' : ' · ';
  const img = (w) => (hasPicture(w) ? symbolSvg(w) : '');
  return `<div class="wg-pair" data-pair>${img(word)}<span>${esc(up(word))}${sep}${esc(up(answer))}</span>${img(answer)}</div>`;
}

// ---------------------------------------------------------------------------------------
// FOR QUIZ MIX (row 2.63): the three games as ONE quiz_flow.js adapter and view, over the ladder's bank
// items (`wordBank`, each carrying its `game`). No `items`: the mix deals. Built from the same pure pieces
// as the engine above, so a question asked inside the mix is asked, judged and hinted exactly as here.
//   yesNo(item)   the quiz_flow.js hook for a question whose own answers ARE yes and no: the Yes / No
//                 switches answer it directly, rather than saying yes or no to an offered candidate.
// ---------------------------------------------------------------------------------------
const gameOfItem = (it) => (it && LISTS[it.game] ? it.game : 'opposites');
const lines = (c) => ({ ...LINES, ...(c || {}) });
export const WORD_ADAPTER = Object.freeze({
  empty: () => 'There are no questions here yet.',
  ask: (it, c) => askLineOf(gameOfItem(it), it, lines(c)),
  candidates: (it, c, r) => candidatesOf(gameOfItem(it), it, r || Math.random),
  offer: (it, cand, c) => candLineOf(gameOfItem(it), it, cand, lines(c)),
  judge(it, v) {
    const g = gameOfItem(it);
    const t = normalize(v);
    if (!t) return null;
    return judgeWord(g, it, g === 'yesno' ? t : extractWord(g, it, t));
  },
  hint: (it, n, c) => (n === 1 ? hintOf(gameOfItem(it), it, lines(c)) : ''),
  answer: (it) => answerWordOf(gameOfItem(it), it),
  explain: (it, answer, c) => explainOf(gameOfItem(it), it, answer || answerWordOf(gameOfItem(it), it), lines(c)),
  vocab: (it) => vocabOf(gameOfItem(it)),
  heardText: (v) => String(v),
  fromVoice(it, { text }) {
    if (!text) return null;
    const g = gameOfItem(it);
    if (g === 'yesno') return { value: yesNoOf(text) || text };
    return { value: extractWord(g, it, text) };
  },
  choiceLabel: (it, v) => (gameOfItem(it) === 'yesno' ? (v === 'yes' ? 'Yes' : 'No') : up(v)),
  // `it`: the question on screen (quiz_mix.js hands it; quiz_flow.js's own call has none, and this game
  // is never on that path).
  unknownLine: (v, c, it) => (gameOfItem(it) === 'yesno' ? fill(lines(c).yesNoOnlyLine, { heard: v })
    : fill(lines(c).unknownWordLine, { heard: v })),
  yesNo: (it) => gameOfItem(it) === 'yesno',
});
export const WORD_VIEW = Object.freeze({
  askHtml(s, c) {
    const it = s.item;
    const g = gameOfItem(it);
    if (g === 'yesno') return esc(it.q);
    return fillHtml(g === 'opposites' ? lines(c).askOpposites : lines(c).askRhyming, { word: `<em>${esc(up(it.word))}</em>` });
  },
  left(s) {
    const it = s.item;
    const g = gameOfItem(it);
    if (g === 'yesno') return it.picture ? picHtml(it.picture) : '';
    return picHtml(it.word);
  },
  pairHtml: (s) => pairMarkup(gameOfItem(s.item), s.item?.word || '', s.pair?.answer ?? ''),
});

registerModule(
  { type: GAME, title: 'Word games', core: 'new',
    description: 'Opposites, Rhyming and a Yes/No quiz, asked aloud with a picture. Answer with '
      + 'a switch, the screen, or (later) your voice.',
    // `local`: the words, pictures and rules are all in this build; nothing is fetched.
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;
    let cfg = { ...DEFAULTS };
    let ledger = null;
    let lastSpeech = null;
    let dead = false;
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
      catch { return false; }
    };

    function say(lines) {
      if (!cfg.speak) return;
      const text = lines.filter(Boolean).join(' ');
      if (!text || !ctx.output?.say) return;
      // The newest line supersedes the last one still queued (row 2.27): an answer given while
      // the question is still being read should not wait behind it.
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: GAME });
      } catch (err) { console.error('word_games: say', err); }
    }

    // *** A HIDDEN OR REMOVED GAME IS NOT LISTENING. *** `input_speech.js` sends answers to the
    // game that most recently opened a grammar, and while one is open (and the microphone is on)
    // the screen's media is paused (listening_cue.js). A game left open on a page nobody is
    // looking at would take every word said in the room and keep the video silent, so hiding it
    // and destroying it both say "closed", and showing it again says what it can hear.
    let hidden = false;
    function announceGrammar(g) {
      const closed = hidden || dead;
      try {
        bus.publish(GRAMMAR_TOPIC, { source: GAME, instanceId: ctx.instanceId || null, ...g,
          ...(closed ? { open: false, words: [] } : {}) });
      } catch { /* nobody listening */ }
    }
    function reannounce() {
      const words = engine.grammar();
      announceGrammar({ open: words.length > 0, words, phase: engine.snapshot().phase });
    }

    function award({ amount, game, item, answer }) {
      if (!ledger || !(amount > 0)) return;
      Promise.resolve(ledger.award({ amount, source: GAME, type: 'School', tags: [GAME, game],
        note: `${game}: ${item.word || item.q} -> ${answer}` }))
        .catch((err) => console.error('word_games: points', err));
    }

    function chime() {
      if (!cfg.sound) return;
      const level = Number(ctx.audio?.master?.());
      const lv = Number.isFinite(level) ? level : 1;
      (typeof ctx.chime === 'function' ? ctx.chime : defaultChime)(lv);
    }

    // THE LADDER (row 2.63), opened exactly as Thinking games opens it: the screen's person's level kept
    // with them on every screen of theirs, their own start in this game, else their usual one; everybody
    // else's on this screen's row (adaptive_play.js openPersonLadder).
    let engine = null;
    const redraw = () => { if (engine) render(); };
    const ladderRows = openPersonLadder(ctx, { gameKey: GAME, onChange: redraw });
    const session = createAdaptiveSession({
      cfg: () => cfg,
      bankFor: (g) => wordBank(String(g).replace(/^wg_/, '')),
      store: ladderRows.store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      startFor: ladderRows.startFor, startMark: ladderRows.startMark,
      playersHost: ladderRows.playersHost,
      onChange: redraw,
    });
    ladderRows.attach(session);

    engine = createEngine({
      cfg: () => cfg, rand, say,
      award: (p) => { if (session.allowAward()) award(p); },
      chime,
      onChange: () => render(),
      publishGrammar: (g) => announceGrammar(g),
      setTimer: typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms),
      clearTimer: typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (id) => clearTimeout(id),
      deal: (g) => session.deal(ladderGame(g)),
      onResult: (r) => { try { session.record(r); } catch (err) { console.error('word_games: ladder', err); } },
      prefix: () => session.askPrefix(),
    });

    const pic = picHtml;
    const btn = (s, i, on) => `<button type="button" class="wg-btn" data-act="${esc(s.act)}" data-stop="${i}"${on ? ' data-on="1"' : ''}>${
      s.heard ? `${esc(s.label)}, <q>${esc(s.heard)}</q>` : esc(s.label)}</button>`;
    const btns = (s, hl) => `<div class="wg-btns">${s.map((x, i) => btn(x, i, i === hl)).join('')}</div>`;

    function render() {
      if (dead) return;
      const s = engine.snapshot();
      const it = s.item;
      if (!it) { mount.innerHTML = '<div class="wg" data-state="idle"></div>'; return; }
      const stops = engine.stops();
      const motion = reducedMotion() ? 'reduce' : 'full';
      const q = (w) => `<q>${esc(w)}</q>`;
      const askHtml = s.game === 'yesno' ? esc(it.q)
        : fillHtml(s.game === 'opposites' ? cfg.askOpposites : cfg.askRhyming, { word: `<em>${esc(up(it.word))}</em>` });
      const picWord = s.game === 'yesno' ? it.picture : it.word;
      const left = s.game === 'yesno' ? (it.picture ? pic(it.picture) : '') : pic(picWord);
      // With two or more players, each one's tally ("Ann 3 · Bob 2"), as every ladder game shows it.
      const score = cfg.showScore ? `<p class="wg-count" data-score>${esc(session.scoreDetail() || `${s.rightCount} right so far.`)}</p>` : '';
      // Whose turn it is, in front of the question (nothing with one player, unless levels are shown).
      let turn = '';
      try { turn = s.game ? String(session.turnHtml(s, ladderGame(s.game)) || '') : ''; } catch { turn = ''; }
      let ask = askHtml;
      let mid = '';
      let foot = '';
      let extra = '';
      if (s.phase === 'asking') {
        const f = s.feedback;
        const fb = !f ? (s.voiceSeen ? '<p class="wg-say wg-soft">Say your answer.</p>' : '')
          : f.kind === 'wrong'
            ? `<p class="wg-say" data-feedback="wrong">${f.via === 'voice'
              ? fillHtml(cfg.wrongLine, { heard: q(f.heard) }) : esc(f.text)}</p>${
              f.hint ? `<p class="wg-hint" data-hint>${fillHtml(cfg.hintLine, { hint: esc(f.hint) })}</p>` : ''}`
            : `<p class="wg-say" data-feedback="${esc(f.kind)}">${esc(f.text)}</p>`;
        mid = `${left}<div class="wg-st" aria-live="polite">${fb}</div>`;
        if (s.offers === 'choices') {
          // The words are the stops (answerBy 'choices'): tapped, or lit by the switch. Capitals on screen,
          // as every word here is; the value (and what is said) stays lower case.
          const lead = s.voiceSeen ? 'Or step through them with your switch.' : 'Say it, tap it, or step through with your switch.';
          const picks = stops.map((x, i) => `<button type="button" class="wg-btn" data-pick="${esc(x.value)}" data-stop="${i}"${
            i === s.highlight ? ' data-on="1"' : ''}>${esc(up(x.label))}</button>`).join('');
          foot = `<div class="wg-foot"><span>${lead}</span><div class="wg-btns">${picks}</div></div>`;
        } else {
          const lead = s.voiceSeen ? 'Or press your switch.' : 'Press your switch, or tap.';
          const offer = s.candidate
            ? ` ${fillHtml(s.game === 'opposites' ? cfg.candidateOpposites : cfg.candidateRhyming,
              { candidate: `<b>${esc(up(s.candidate))}</b>`, word: `<b>${esc(up(it.word))}</b>` })}` : '';
          foot = `<div class="wg-foot"><span>${lead}${offer}</span>${btns(stops, s.highlight)}</div>`;
        }
      } else if (s.phase === 'unsure') {
        const line = s.unsure.reason
          ? fillHtml(cfg.unsureLine, { heard: q(s.unsure.heard), reason: esc(s.unsure.reason) })
          : fillHtml(cfg.unsureNoReasonLine, { heard: q(s.unsure.heard) });
        mid = `${left}<div class="wg-st" aria-live="polite"><p class="wg-say" data-unsure>${line}</p>${btns(stops, s.highlight)}</div>`;
      } else if (s.phase === 'twoMiss') {
        const f = s.feedback;
        const wrong = f ? `<p class="wg-say wg-soft" data-feedback="wrong">${f.via === 'voice'
          ? fillHtml(cfg.wrongLine, { heard: q(f.heard) }) : esc(f.text)}</p>` : '';
        mid = `${left}<div class="wg-st" aria-live="polite">${wrong}<p class="wg-say" data-offer>${esc(cfg.twoMissLine)}</p>${btns(stops, s.highlight)}</div>`;
      } else if (s.phase === 'celebrate') {
        ask = 'Yes!';
        mid = `<div class="wg-st wg-right" aria-live="polite"><div class="wg-ring" data-ring></div>${pairHtml(s)}<p class="wg-say wg-soft">${explainHtml(s)}</p>${score}</div>`;
        extra = STARS.map(([l, t], i) => `<span class="wg-star" style="left:${l}%;top:${t}%;animation-delay:${i * 60}ms"></span>`).join('')
          + `<img class="wg-cat" src="${CAT_URL}" alt="">`;
      } else if (s.phase === 'answer') {
        // The revealed answer, up for `answerMs`; the next question follows by itself (item 4).
        mid = `<div class="wg-st wg-right" aria-live="polite">${pairHtml(s)}<p class="wg-say wg-soft" data-revealed>${explainHtml(s)}</p>${score}</div>`;
      } else if (s.phase === 'another') {
        // "Would you like to do another one?" (the `askAnother` setting, off by default), with a
        // revealed answer kept on screen above it.
        ask = esc(cfg.anotherLine);
        const shown = s.revealed && s.pair
          ? `${pairHtml(s)}<p class="wg-say wg-soft" data-revealed>${explainHtml(s)}</p>` : '';
        mid = `<div class="wg-st wg-right" aria-live="polite" data-another>${shown}${btns(stops, s.highlight)}${score}</div>`;
      } else if (s.phase === 'done') {
        ask = esc(cfg.doneLine);
        mid = `<div class="wg-st wg-right" aria-live="polite">${score}${btns(stops, s.highlight)}</div>`;
      }
      mount.innerHTML = `<div class="wg" data-state="${s.phase}" data-game="${s.game}" data-motion="${motion}">
        <h2 class="wg-ask">${turn}${ask}</h2>
        <div class="wg-mid${left && (s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss') ? '' : ' wg-one'}">${mid}</div>
        ${foot}${extra}</div>`;
    }

    // The same sentence that was spoken, with the words in capitals as they are everywhere else
    // on screen ("COLD is the opposite of HOT.") — spoken lines keep them lower case, because
    // some voices spell out a word written in capitals.
    function explainHtml(s) {
      if (s.game === 'yesno') return esc(s.pair.explain);
      return fillHtml(s.game === 'opposites' ? cfg.explainOpposites : cfg.explainRhyming,
        { answer: esc(up(s.pair.answer)), word: esc(up(s.pair.word)) });
    }

    function pairHtml(s) {
      const p = s.pair;
      if (!p) return '';
      return pairMarkup(s.game, p.word, p.answer);
    }

    return {
      __engine: engine,
      // The ladder, the same object the module plays with (quiz_test_rig.js personLadderChecks).
      __session: session,
      __probe: () => engine.snapshot(),
      hear: (result) => engine.hear(result),
      init() {
        ensureQuizStyle(mount.ownerDocument || (typeof document !== 'undefined' ? document : null));
        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('word_games: no points ledger', err); }
        bus.subscribe(`${GAME}/next`, () => engine.next());
        bus.subscribe(`${GAME}/prev`, () => engine.prev());
        bus.subscribe(`${GAME}/select`, () => engine.select());
        bus.subscribe(`${GAME}/skip`, () => engine.skip());
        bus.subscribe(PLAY_TOPIC, (p) => { const g = typeof p === 'string' ? p : p?.game; if (engine.setGame(g)) state?.set?.({ game: g }); });
        bus.subscribe(ANSWER_TOPIC, (r) => engine.hear(r));
        mount.addEventListener('click', (e) => {
          const t = e.target.closest?.('button[data-act]');
          if (t) { engine.press(t.dataset.act); return; }
          const p = e.target.closest?.('button[data-pick]');
          if (p) engine.answer(p.dataset.pick, 'touch');
        });
        let started = false;
        if (state?.subscribe) {
          state.subscribe((snap) => {
            const prevGame = cfg.game;
            cfg = { ...DEFAULTS, ...(snap || {}) };
            if (!GAMES.includes(cfg.game)) cfg.game = DEFAULTS.game;
            ladderRows.onConfig(cfg);
            if (!started) { started = true; engine.start(); }
            else if (cfg.game !== prevGame && cfg.game !== engine.snapshot().game) engine.setGame(cfg.game);
            else render();
          });
        }
        if (!started) { started = true; engine.start(); }
      },
      onResize() {},
      onHide() { hidden = true; reannounce(); state?.flush?.(); },
      onShow() { hidden = false; reannounce(); },
      destroy() {
        dead = true;
        reannounce();
        engine.destroy();
        try { session.destroy(); } catch { /* gone */ }
        try { ladderRows.destroy(); } catch { /* gone */ }
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
        lastSpeech = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  },
);
