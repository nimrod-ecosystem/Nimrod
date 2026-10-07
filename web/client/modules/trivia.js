// trivia.js — a QUIZ over a bank somebody wrote, and the reason it exists is not the quiz.
//
// ---------------------------------------------------------------------------------------
// *** THE SCORE IS ABOUT KNOWING THINGS, NEVER ABOUT HOW CLEARLY SOMEBODY SPEAKS ***
// ---------------------------------------------------------------------------------------
//
// This started as a proposal for a speech-therapy game — say this word, and be told how well you
// said it. Mike killed it, 2026-08-30:
//
//   *"I don't think it should necessarily be scored, or at least patient-facing score… what
//    would be interesting would be a trivia game. So then the score is based on the trivia and
//    not the pronunciation, but it still sort of carries the same method, because you know what
//    word you're expecting them to say."*
//
// He is right on both axes at once, which is rare enough to be worth spelling out.
//
// **Ethically**, it moves the score onto something anybody can be wrong about. Getting a trivia
// answer wrong is ordinary. Being told your pronunciation was unclear is a verdict about your
// body, delivered by a machine, on the screen you cannot walk away from. `PRINCIPLES.md` §3.C
// is exactly this line — *the software does not render a judgment about a person to that person
// unless they asked for it* — and choosing to play a quiz is asking in a way that a clarity
// score never is.
//
// **Technically it is the stronger design too.** Four choices is not open speech recognition, it
// is a four-way classification: never "what was said", only "which of four known answers is this
// closest to". That is a far easier question and far more robust to atypical speech, because
// even a very impaired rendition of *Paris* is more like that person's own *Paris* than like
// their own *London*. And the system never has to declare a pronunciation verdict at all,
// because it is never asked for one.
//
// ---------------------------------------------------------------------------------------
// WHAT IT DOES TODAY, AND WHAT IT IS FOR LATER
// ---------------------------------------------------------------------------------------
//
// **There is no recognizer yet, and this does not pretend otherwise.** Today it is answered by
// pointer or by switch. What it also does — when a recorder is handed to it — is MARK the audio
// at every question with what was asked and what was chosen. So the labeled corpus builds
// itself while somebody plays a game they wanted to play, and the recognizer that needs it can
// arrive afterwards to find the data already there.
//
// *** AND THE ONE THING A MARK MUST NOT SAY. *** It records the question and the button. It does
// NOT claim what anybody said out loud — nobody knows that, and a fabricated label in training
// data is worse than no label, because it is confidently wrong in a file nobody re-checks. See
// `recorder.js`.
//
// **The rule for when a recognizer DOES arrive**, written down now so it is not discovered late:
// a recognition failure must never be scored as a wrong answer. Somebody knows the answer is
// Paris, says Paris, and the recognizer is unsure — marking that wrong tells them they do not
// know something they do, *because of how they sound*, which is exactly the judgment the trivia
// framing was chosen to avoid. It comes straight back in through the side door, harder to see because the
// score now looks like it is about knowledge. When no candidate is clearly ahead: say it was not
// caught, and offer the question again. Not right, not wrong, not scored.
//
// ---------------------------------------------------------------------------------------
// THE BANK IS SOMEBODY ELSE'S, AND THAT IS THE POINT (Mike, 2026-08-31)
// ---------------------------------------------------------------------------------------
//
//   *"The trivia game should be like word forge where people can build their own syllabus or
//    whatever into it."*
//
// So it deliberately copies `wordforge.js` rather than inventing a second content model: a
// documented pipe-delimited line format, stored in per-profile state, editable as text, with an
// array form accepted for anything generating it. One idea, one shape, and somebody who has
// written a word bank already knows how to write a question bank.
//
//     question | answer | wrong | wrong | wrong | topic?
//
// Lines beginning `#` are comments, so a bank can be organized and annotated by whoever owns it.

import { registerModule } from '../module.js';
import { createPointsLedger } from '../points.js';
import { createTelemetry } from '../telemetry.js';
import { worth as mcqWorth } from '../mcq_scoring.js';
import { triviaPool } from '../bank.js';
import { BANK_STATE, BANK_TOPIC } from './bank.js';
import { loadPack, itemSources, difficultyLevel, DIFFICULTY_LEVELS } from '../packs.js';
import { createAdaptiveSession, adaptiveSettings, openLadderStore, splitLadderStore, LADDER_STATE_OPTIONS,
  PERSON_LADDER_KEY, START_WORDS, resolvePlayers } from '../adaptive_play.js';
import { RATING_DEFAULTS, LADDER_DEFAULTS, expected, levelOf, levelRating } from '../rating.js';
import { ensureQuizStyle } from '../quiz_view.js';
import { answerSourceField, answerSourceHtml, answerSourceMode, answerSourceText, ANSWER_SOURCE_DEFAULT,
         answerExplainField, answerExplainHtml, answerExplainOn, answerExplainText, ANSWER_EXPLAIN_DEFAULT } from '../answer_source.js';
import { packsFor, packById } from '../pack_library.js';
import { createLessons, gate, lockedTopics, DEFAULT_TOPICS, LESSON_TOPIC,
         TRIVIA_LESSON_QUESTIONS, createQuestMode, ALL_UNLOCKED } from '../lessons.js';
import { createContests, contestKey, CONTEST_TOPIC } from '../contests.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { answerMarkHtml } from '../answer_mark.js';
import { createPackReviews, isReviewPackId, playableBank, REVIEW_STATUS, REVIEW_TOPIC,
         REVIEW_FLAG_TOPIC, REVIEW_PASS_TOPIC, sourceHtml } from '../pack_reviews.js';
import { linksOpenHere } from '../page_links.js';
import { spellPaceField, spellPace, spellsAloud, spellAloud, spelledOptions, SPELL_PACE_DEFAULT } from '../spell_aloud.js';

export const GAME = 'trivia';

export const DEFAULTS = {
  roundLength: 10,
  // *** A SCORE ON SCREEN, ON BY DEFAULT. *** Reversed 2026-09-22 -- Mike: "Why should a screen
  // someone can't walk away from not show a score? Games have scores. That's pretty standard."
  // The earlier off-by-default was itself already a correction of a misquote (see the SETTINGS
  // row below) -- this is a second, later, direct ruling on top of that, not a reopening of
  // the misquote question. Still a real setting either way, so anyone who wants it off still can.
  //
  // *** 2026-09-30 (row 2.40): THE SCORE IS PUBLISHED, AND A SCOREBOARD CAN TAKE IT OVER. *** Mike:
  // "we probably have a bunch of modules drawing their own scoreboards. We shouldn't have that."
  // The row is now `ownScore` (auto / always / off, `../score_source.js`); `auto` keeps the score on
  // screen by default — the 09-22 ruling — and steps it aside the moment a Scoreboard on the same
  // screen shows it. A saved `showScore: false` still means off (`ownScoreMode`). DELIBERATELY NOT
  // a key in DEFAULTS: `cfg` spreads DEFAULTS under the saved state, and a default `ownScore` here
  // would hide an old saved `showScore: false` from `ownScoreMode` and turn the score back on.
  // *** ONE POINT, QUARTERED BY GUESS: 1 / 0.75 / 0.5 / 0.25. *** Chat's #5, and the
  // calibration behind it is Mike's atom -- "a point is roughly a minute of effort", which is
  // what `points.js` already means by one point. Two points for answering a four-choice
  // question was paying double the atom for something that takes seconds.
  correctPoints: 1,
  // `tryingPoints` is GONE. It existed so that reading the answer after a miss still paid, and
  // the quartering does that better: the last remaining option is worth a quarter rather than a
  // separate number nobody could relate to the first one. A saved settings row may still carry
  // the old key; nothing reads it, so it is inert rather than migrated.
  quarterFloor: 0.25,     // never worth nothing — attempting always pays something
  choices: 4,
  // *** DRAW ON THE WORD BANK TOO (Mike, 2026-08-31: "I could see word forge and trivia drawing
  // from the same pool for a lot of people"). *** A vocabulary row already contains everything a
  // multiple-choice question needs, so somebody who wrote sixty words does not have to write
  // sixty questions as well. Written questions still come first — see `bank.js`.
  includeWords: true,
  // RECORDING IS OFF UNLESS SOMEBODY TURNED IT ON. A game that quietly opened a microphone
  // because it might be useful later would be exactly the thing this project does not do.
  record: false,
  // *** A READY-MADE PACK, DEFAULT SINCE 2026-09-22. *** PRIORITY.md #5 / MIKE_CHANGE_LIST D26:
  // "questions must be hand-authored... which defeats the game, since the author knows the
  // answers." Held back once already (see git history) over a real risk: `readBank()` treats
  // `contentSource` as a strict switch, so flipping the default could silently replace an
  // EXISTING written bank for anyone who wrote one without ever touching "Where questions come
  // from." Mike, told exactly that: "There should be default packs, so people can play the
  // games without setting anything up." That is a real, explicit ask a caution can't override —
  // and the one real account checked this session (`dev-user`/Bedside) has zero saved state for
  // this module either way, so the actual risk today is to content nobody in this room can see.
  // Flipped. If a written bank is later found broken by this, the fix is the settings row
  // itself ("Where questions come from" -> "Written questions"), not reverting this.
  //
  // *** EVERY PACK TOGETHER, DEFAULT SINCE 2026-10-06 (Mike: "There should be a choice to have the questions
  // come from all of the pools."). *** 'all' deals from every pack this panel may play at once, by level (see
  // ALL THE PACKS below). Made the default, argued:
  //   FOR: the first pack in the list, which a panel nobody set up played until now, is basic arithmetic (300
  //   sums), which is a thin idea of trivia; with levels, one big mixed pool gives every player variety at their
  //   own level. Mike's ask reads as the way he wants to play.
  //   AGAINST: it is not only new panels. A panel that never chose a source reads this default too, so it moves
  //   from the maths pack to every pack (there is no telling a new panel from one nobody configured). Anybody who
  //   wants the one pack picks "One pack". [Guess, on Mike's list.]
  contentSource: 'all',
  packId: packsFor('trivia')[0]?.id || null,
  // *** REVIEW BY PLAYING (Mike, 2026-10-03; ../pack_reviews.js). OFF BY DEFAULT. *** Off, an unreviewed
  // question is never dealt and an unreviewed pack is not even offered; only questions somebody already
  // passed play (as "<topic> — N reviewed questions"). On, the review packs join "Which pack" and their
  // open questions carry a quiet ✓ fine / ✗ wrong for whoever is reviewing.
  includeUnreviewed: false,
  // *** "SHOW WHERE THE ANSWER COMES FROM", ON BY DEFAULT (Mike, 2026-10-04: "Maybe even have an option to
  // always show the source when the answer is given that's on by default."). *** A question's own source, in
  // one quiet line under "Correct.", once the answer is given. 'on' | 'all' (also says "common knowledge") |
  // 'off'. Every choice is argued in ../answer_source.js.
  showSource: ANSWER_SOURCE_DEFAULT,
  // *** "SAY WHY AFTER THE ANSWER", ON BY DEFAULT (2026-10-04). *** The item's own `explain` sentence, under
  // "Correct." and above the source line, once the answer is given. Argued in ../answer_source.js. Read aloud
  // after "Correct." too, while "Say the questions aloud" is on (below) — one row for both, since its label
  // already says "say".
  showExplain: ANSWER_EXPLAIN_DEFAULT,
  // *** TRIVIA READS ALOUD NOW (2026-10-04), THE WAY THE OTHER QUIZ GAMES DO. *** Same key, default and
  // wording as ../quiz_flow.js `flowSettings` ("Say the questions aloud", on), through the person's own
  // output routing (`ctx.output.say`, which reaches the speech channel — the one registered on the audio
  // bus, so music ducks under it and the master volume applies; output_channels.js). What is read, and when,
  // is argued at "SPEECH" inside the factory below.
  speak: true,
  // "Say the switch choice too" — the answer the scan lands on, as it lands. quiz_flow's key and default.
  sayChoice: true,
  // "Say where the answer comes from" — OFF, argued at its SETTINGS row.
  speakSource: false,
  // A spelling question's answers, read letter by letter: how fast (2026-10-07; argued in ../spell_aloud.js).
  spellPace: SPELL_PACE_DEFAULT,
};

// `question | answer | wrong | wrong | wrong | topic?`
//
// *** SUPERSEDED BY `bank.js` AS THE READER, AND KEPT AS THE FORMAT'S DEFINITION. *** The shared
// bank now parses both shapes out of one document, because Word Forge and Trivia turned out to
// want the same content. This stays exported because it is the smallest possible statement of
// what a question row IS, and because anything already calling it keeps working.
export function parseBank(text) {
  return String(text || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('|'))
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter((p) => p.length >= 2 && p[0] && p[1])
    .map((p) => {
      const [question, answer, ...rest] = p;
      // A trailing field written as `topic:something` is pulled out rather than treated as a
      // wrong answer — the same tag `bank.js`'s own shared `## questions` parser reads, so a
      // question can be gated by lesson topic the same way a word row already can (lessons.js).
      // Anything else trailing is a plausible distractor, kept generous on purpose: somebody
      // hand-writing a hundred lines will not be consistent, and a bank that silently drops a
      // third of its rows because of a spacing habit is infuriating to debug and looks like the
      // game is broken.
      let topic;
      const wrong = [];
      for (const r of rest) {
        if (!r) continue;
        const m = /^topic:\s*(.+)$/i.exec(r);
        if (m) { topic = m[1].trim(); continue; }
        wrong.push(r);
      }
      const item = { question, answer, wrong };
      if (topic) item.topic = topic;
      return item;
    });
}

// A `nimrod.pack.v1` trivia item is `{question, answers[], correct, difficulty?}`; this bank's
// shape is `{question, answer, wrong[]}` — same information, different field names, because the
// pack schema names the CORRECT one out of a set while a bank writes the wrong ones directly.
// `answers` includes `correct` (packs.js requires it), so `wrong` is everything else in order —
// which matters for `makeQuestion`'s degrading-option rule below: a pack's distractors are
// somebody's real, written wrong answers, exactly like a bank's, never generated here.
//
// `sources` (2026-10-04): the item's own source (packs.js PER-ITEM SOURCES), normalised, for "Show where the
// answer comes from". Only when it names one — an item from a pack written before per-item sources carries
// nothing, and shows nothing. NOT `source`: that field is a lesson question's transcript line (below).
export function packToTriviaBank(pack) {
  return (pack.items || []).map((it) => {
    const row = {
      question: it.question,
      answer: it.correct,
      wrong: (it.answers || []).filter((a) => a !== it.correct),
    };
    const sources = itemSources(it.source);
    if (sources.length) row.sources = sources;
    // `explain` (2026-10-04): the item's own sentence saying why, for "Say why after the answer". Only when
    // there is one.
    const why = answerExplainText(it.explain);
    if (why) row.explain = why;
    // `level` (2026-10-05): the item's `difficulty` as the level its rating starts at (packs.js
    // difficultyLevel: very easy 1, easy 2, medium 3, hard 4). Only when it has one; see QUESTIONS AT EVERY LEVEL below.
    const level = difficultyLevel(it.difficulty);
    if (level) row.level = level;
    // `spell` (2026-10-07, ../spell_aloud.js): its answers are spellings, read aloud letter by letter.
    if (it.spell === true) row.spell = true;
    return row;
  });
}

// ---------------------------------------------------------------------------------------
// *** QUESTIONS AT EVERY LEVEL (Mike, 2026-10-05: "a lot of questions at pretty much every level") ***
// ---------------------------------------------------------------------------------------
// The packs mark each item easy / medium / hard, and Trivia used to drop it: every question was dealt
// at random to everybody. Now, when the bank carries levels, Trivia plays on THE LADDER the other
// question games use (../adaptive_play.js, ../rating.js): each player has a rating and a floor, each
// question a rating that STARTS at its level (levelRating over TRIVIA_RATING: very easy 850, easy 1000, medium
// 1150, hard 1300) and is moved by every answer, and Mike's per-level thresholds move the floor (rating.js
// thresholdsAt: 90% right to step up / 75% wrong to step down at the easiest level, 70/50 at the hardest).
//
// WHAT IS NOT THE LADDER'S `deal`: the pick. `choose` there ranks questions by expected success and breaks
// ties by id, which on a pack of several hundred questions with fresh (equal) ratings would deal the same
// handful every sitting. So the pick is here (pickNear), by LEVEL, at random inside a level:
//   1. Questions this player has not answered or skipped this sitting (the panel's life), and not already
//      in this round.
//   2. Of those, the level inside the player's window (poolLevels: floor .. floor + levelsAtOnce - 1) whose
//      expected success for this player is nearest the ladder's target (80%). A new player at level 1 meets
//      the easy ones first; their own rating decides when medium is nearer.
//   3. When the window has nothing fresh left (a strong player who has seen every hard question), the
//      NEAREST LEVEL OUTSIDE IT, by distance from the window; a tie goes to the level below. At the top that
//      is simply the level below. ARGUED: below on a tie keeps the success rate up, which is the ladder's
//      whole stance (aim at 80%, not 50%). AGAINST: somebody who emptied their window is clearly doing well,
//      and a harder question would tell the ladder more. [Guess, on Mike's list.]
//   4. Everything seen: the same order again over every question (repeats, nearest level first), so a
//      round is never short because the player has been at it a while.
// A question's level is read from its CURRENT rating (rating.js levelOf), so a "hard" question everybody
// gets right drifts down a level by itself, which is the "play still moves questions" half.
//
// WHEN THE LADDER IS NOT USED, and the deal is exactly what it always was (a shuffled round):
//   * a bank with no levels at all (a written bank, the word bank, an old pack). Nothing is rated either:
//     ratings nobody reads would only grow the row.
//   * while REVIEWING (../pack_reviews.js): with "Include unreviewed questions" on and open questions in
//     play, the round is dealt open-first as before. A reviewer has to meet the hard questions too, and a
//     floor at level 1 would hold them back. Who sees an unreviewed question does not change.
// An unlevelled question in a levelled bank (a lesson-routed one) is easy (UNLEVELLED): level 1, the ladder's own
// convention, until very easy came in below it (2026-10-06). Argued: nobody said it was very easy, and easy is
// where it always started.
//
// *** ITS OWN ROW, `ratings_trivia`, NOT THE SHARED `ratings` (adaptive_play.js LADDER_KEY). *** Argued:
//   FOR sharing: one place for every game's ladder, which is what adaptive_play.js describes.
//   AGAINST, and it decides it: what sharing buys is a question's rating learning from every game that
//   meets it, and no other game meets a trivia question. What it costs: a few hundred (now over a thousand)
//   pack questions' ratings would ride in the row every other game rewrites on every answer. A player's trivia
//   level is per game in either row. [Guess, on Mike's list.] (The other cost argued here on 2026-10-05, two
//   games overwriting each other's progress, is fixed in adaptive_play.js: saving merges entry by entry.)
//
// ---------------------------------------------------------------------------------------
// *** THE LEVEL FOLLOWS THE PERSON (2026-10-06) ***
// ---------------------------------------------------------------------------------------
// Until now a player's trivia level was a row on one screen: the same person on another screen started over.
// Now the screen's own person (`person:<id>`) keeps their trivia row WITH THEM, in their own `ratings_trivia`
// (ctx.makePersonState), so it is the same on every screen of theirs; adaptive_play.js `splitLadderStore`
// argues the split and the one-time move. What stays on the screen's row: every question's rating (a fact
// about the question, learned from everybody who meets it here), and players typed into "Players", who have
// no person to keep it with. A host with no per-person rows (a test, the modules page) keeps everything on the
// screen's row, as before.
//
// *** "START TRIVIA AT" (Mike, 2026-10-06: an older player should not start at the easy end), kept with the person
// too (`start`: very easy / easy / medium / hard, or 'same'). *** It is Trivia's own start for that person: the same
// thing as "Start this game at" in the other games (adaptive_play.js openPersonLadder), on Trivia's own row.
// CHANGING IT starts them again at that level, up OR down (adaptive_play.js `startAt`: floor and rating there,
// the answers being judged cleared, everything else kept). Argued: FOR only for a new player, which the word
// "start" suggests: a setting changed on somebody who has already played would otherwise change nothing,
// which reads as broken. A caregiver who picks it is saying where they should be now. [Guess, on Mike's list.]
// THE MENU ROW IS THE PANEL'S (settings rows are kept per panel), so the panel keeps a copy and the person's row
// is the truth: a change made in the menu is written to the person; a change made on another of their screens
// is copied back into the row so the menu shows it. A screen with no person: the row applies to its one
// unnamed player, on the panel.
//
// *** "THEIR USUAL STARTING LEVEL" ('same'): THE FIRST CHOICE, AND THE DEFAULT. *** The person's usual start for
// every question game (adaptive_play.js usualStartField, `start` on their `ratings` row, set on the People tab of
// the screen's menu). Default 'same', argued: FOR a start of Trivia's own: quiz questions are a different kind of
// hard. AGAINST, and it decides it: a caregiver who set the usual one once is not surprised that Trivia ignored it,
// and Trivia's own is one choice away. A person whose row already says a word keeps it. Following it, a change to the
// usual start starts them again in Trivia too (the same mark the other games read). [Guess, on Mike's list.]
//
// *** NOTHING SET ANYWHERE: VERY EASY (2026-10-06), the bottom ("A new player starts at level" 1). *** Argued:
//   FOR easy: a capable teenager or adult answers about ten very easy questions before the floor moves (90% of
//   ten at the easiest level), which is a dull first few minutes, and the packs hold few very easy questions.
//   AGAINST, and it decides it: the ladder aims at 80% success, and a start that is too hard for a young child or
//   somebody recovering from an injury is discouraging in a way ten easy questions are not; the bottom two levels
//   are dealt together from the start ("Levels mixed together", 2), so easy questions come too; and a person who
//   should start higher is one setting away, once, for every game. [Guess, on Mike's list.]
//
// *** VERY EASY MOVED EVERY LEVEL NUMBER UP ONE, AND NOBODY'S PROGRESS MOVES (2026-10-06). *** packs.js now counts
// very easy 1, easy 2, medium 3, hard 4 (it argues why not a level 0). Two things were stored on the old numbers:
//   * every question's RATING (an Elo number: an easy question started at 1000). TRIVIA_RATING reads ratings on a
//     scale whose level 1 is 150 lower (850), so 1000 is still easy, 1150 medium, 1300 hard: no stored rating is
//     touched, and a player's rating keeps its meaning against them. Only Trivia reads these questions' ratings.
//   * every player's FLOOR (a level number). A row saved before this carries no `lv`; it is read with its floor up
//     one (easy 1 -> 2), and saved with `lv: 2` at their next answer (createAdaptiveSession `rowVersion`). The
//     same on a screen's row and a person's, so the one-time move between them still compares like with like.
//   What does change: with four levels the threshold curve runs over four, so easy now steps up at 83% right (it
//   was 90%), and very easy has the 90%. Also a panel that saved "A new player starts at level" 2 or 3 now means
//   easy or medium for players typed in by name (it meant medium or hard); 1, the default, now means very easy.
export const TRIVIA_LADDER_KEY = 'ratings_trivia';
export const PERSON_START_KEY = 'personStart';
export const START_LEVELS = START_WORDS;
export const START_SAME = 'same';
export const START_CHOICES = Object.freeze([START_SAME, ...START_LEVELS]);
// Ratings read so that easy (level 2) sits where level 1 always sat (rating.js levelRating / levelOf).
export const TRIVIA_RATING = Object.freeze({
  start: RATING_DEFAULTS.start - (DIFFICULTY_LEVELS.easy - 1) * RATING_DEFAULTS.bandWidth,
});
// The level a question with no difficulty starts at (QUESTIONS AT EVERY LEVEL, above).
export const UNLEVELLED = DIFFICULTY_LEVELS.easy;
// The `lv` a player row saved on the four-level count carries; one without it is moved up (above).
export const TRIVIA_LEVELS_VERSION = 2;
/** A player row saved before "very easy": its floor moved up by the levels added below easy. PURE. */
export function upgradeTriviaRow(row) {
  if (!row || typeof row !== 'object') return row;
  const f = Math.max(1, Math.floor(Number(row.floor) || 1));
  return { ...row, floor: f + (DIFFICULTY_LEVELS.easy - 1) };
}
export const triviaId = (item) => `trivia:${contestKey(item?.question, item?.answer)}`;

/** The level an item was written for: its `level`, else its `difficulty` (packs.js), else null. */
export function itemLevel(item) {
  const n = Math.floor(Number(item?.level));
  if (Number.isFinite(n) && n >= 1) return n;
  return difficultyLevel(item?.difficulty);
}

export const hasLevels = (bank) => (bank || []).some((b) => itemLevel(b) != null);

/**
 * ONE QUESTION FOR ONE PLAYER (steps 1-4 above). PURE.
 *   cands         [{ id, item, level }]  level = the question's level NOW (from its rating)
 *   lo, hi        the player's window (rating.js poolLevels)
 *   playerRating  the player's rating, for which in-window level is nearest `target`
 *   avoid         ids not to repeat if anything else is left (seen this sitting)
 *   never         ids not to repeat unless nothing else exists at all (already in this round)
 *   poolOf(c)     which pack a candidate came from (ALL THE PACKS): inside the chosen level, a pack is picked
 *                 first, evenly, then a question in it. Left out, or one pack: one pick, as before.
 * Returns one of `cands`, or null when there are none.
 */
export function pickNear(cands = [], { lo = 1, hi = 1, playerRating = RATING_DEFAULTS.start, avoid = new Set(),
  never = new Set(), target = LADDER_DEFAULTS.target, rand = Math.random, rating = {}, poolOf = null } = {}) {
  const list = (cands || []).filter((c) => c && c.item);
  if (!list.length) return null;
  const R = { ...RATING_DEFAULTS, ...(rating || {}) };
  const notRound = list.filter((c) => !never.has(c.id));
  const fresh = notRound.filter((c) => !avoid.has(c.id));
  const from = fresh.length ? fresh : (notRound.length ? notRound : list);
  const rank = (L) => (L >= lo && L <= hi
    ? [0, Math.abs(expected(playerRating, levelRating(L, R), R.scale) - target), L]
    : [1, L < lo ? lo - L : L - hi, L < lo ? 0 : 1]);
  const cmp = (a, b) => { const x = rank(a), y = rank(b); return (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]) || (a - b); };
  const best = [...new Set(from.map((c) => c.level))].sort(cmp)[0];
  let group = from.filter((c) => c.level === best);
  const at = (n) => { const i = Math.floor(Number(rand()) * n); return Math.max(0, Math.min(n - 1, Number.isFinite(i) ? i : 0)); };
  // ALL THE PACKS (below): a pack first, then a question in it, so 300 sums do not crowd out a pack of ten.
  if (typeof poolOf === 'function') {
    const pools = [...new Set(group.map((c) => poolOf(c)))];
    if (pools.length > 1) {
      const pool = pools[at(pools.length)];
      group = group.filter((c) => poolOf(c) === pool);
    }
  }
  return group[at(group.length)];
}

// Turn a bank into a round. Deterministic under an injected `rand`, the same way `wordforge`
// and `director` are, so a test can assert an exact deck rather than a statistical one.
export function shuffle(items, rand = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildDeck(bank, { roundLength = DEFAULTS.roundLength, rand = Math.random } = {}) {
  return shuffle(bank.filter((b) => b && b.question && b.answer), rand).slice(0, roundLength);
}

/**
 * One question, with its options in a shuffled order.
 *
 * DISTRACTORS COME FROM THE ITEM FIRST, then from other answers in the bank. The bank's own
 * wrong answers are better than anything drawn at random — somebody writing a syllabus chooses
 * distractors that teach — so they are used before falling back.
 *
 * *** AND A WRONG OPTION IS NEVER ALLOWED TO BE ABSURD OR DEGRADING. *** That is the one
 * ratified absolute in `PRINCIPLES.md` §2: *if a module probes judgment, being wrong must not be
 * degrading.* Nothing here generates an option — every one of them was written by a person for
 * this bank — which is what keeps that true by construction rather than by filtering.
 */
export function makeQuestion(item, bank, { choices = DEFAULTS.choices, rand = Math.random } = {}) {
  if (!item) return null;
  const opts = [item.answer];
  for (const w of (item.wrong || [])) {
    if (opts.length >= choices) break;
    if (w && !opts.includes(w)) opts.push(w);
  }
  if (opts.length < choices) {
    const pool = shuffle(bank.filter((b) => b !== item).map((b) => b.answer), rand);
    for (const a of pool) {
      if (opts.length >= choices) break;
      if (a && !opts.includes(a)) opts.push(a);
    }
  }
  const options = shuffle(opts, rand);
  // `source` (2026-09-28, row 2.24 / §0h): a transcript-lesson question routed here by Lessons
  // carries the transcript line its answer came from, and Mike's own §0h addition is that the
  // player SEES it alongside the answer. Empty for every hand-written row, which shows nothing.
  //
  // *** A TENSION WITH THE HEADER ABOVE, STATED RATHER THAN HIDDEN. *** "Nothing here generates
  // an option" stays true of this function — but a routed transcript question's wrong options
  // were written by a model, not a person. What kept PRINCIPLES.md §2 true for those was the
  // review queue in Lessons (ON by default until 2026-09-28: a person read every option before it
  // reached this bank). *** 2026-09-28, Mike: "Flip review." *** Auto-approve is now the default,
  // so by default NO person reads a generated question's wrong options before they are asked here.
  // What is left: `grounded` (the right answer is in the transcript line it quotes — it says
  // nothing about the wrong ones), the optional Wikipedia check, the "I think this question is
  // wrong" contest after every answer (../contests.js), and the setting to turn review back on.
  // Stated here because this function's header still says "nothing here generates an option".
  // `sources` (2026-10-04): what the answer rests on, for "Show where the answer comes from" — a pack item's
  // own (packToTriviaBank), or a review-pack item's (pack_reviews.js playableBank keeps it under `review`).
  const sources = Array.isArray(item.sources) ? item.sources
    : (Array.isArray(item.review?.sources) ? item.review.sources : []);
  // `explain` (2026-10-04): why the answer is right, for "Say why after the answer" — a pack item's (packToTriviaBank)
  // or a review-pack item's (playableBank). '' for a written bank row, which shows nothing.
  // `spell` (2026-10-07): a spelling question, whose answers the voice reads letter by letter (SPEECH).
  return { question: item.question, answer: item.answer, options,
           correctIndex: options.indexOf(item.answer), source: item.source || '', sources,
           explain: answerExplainText(item.explain), spell: spellsAloud(item) };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SEED = `# question | answer | wrong | wrong | wrong
What is the capital of France? | Paris | London | Rome | Madrid
Which planet is closest to the Sun? | Mercury | Venus | Mars | Earth
How many legs does a spider have? | Eight | Six | Ten | Four
What color do you get mixing blue and yellow? | Green | Purple | Orange | Brown
Which ocean is the largest? | Pacific | Atlantic | Indian | Arctic`;


// WHAT THE SETTINGS MENU SHOWS.
//
// Added 2026-09-05. This module read six config keys and declared NONE of them, so every one was
// live config that no UI could write - the same defect F4 turned out to be. It matters more than
// it did last week: the transport bar now makes the settings menu reachable on a grid kiosk, so
// an undeclared panel is one somebody can select and then find nothing to change.
//
// KIND follows the rule `photos.js` states: with one switch you walk a control one press at a
// time and can only travel one way, so THE NUMBER OF STOPS IS THE COST. Short lists of
// known-good values are choices; genuine ranges where any value means something are numbers.
//
// LEVEL: only what somebody actually changes is `standard`. Everything that prices the economy
// is `advanced`, so the common case is a short menu rather than a long one.
// A trivia-kind pack, if any exist. Computed once at module load, same as the rest of SETTINGS —
// if `PACK_LIBRARY` ever ships zero trivia packs, these two rows quietly do not appear rather
// than offering a picker with nothing in it.
const TRIVIA_PACKS = packsFor('trivia');

// Shared across every Trivia instance on the page, not per-instance -- two panels both set to
// the same pack should mean one fetch, not two, and a pack file does not change under a running
// session the way a hand-edited bank does.
const packCache = new Map();
function loadPackCached(id) {
  if (packCache.has(id)) return packCache.get(id);
  const entry = packById(id);
  const p = entry ? loadPack(entry.url) : Promise.reject(new Error(`no such pack: ${id}`));
  // A failed fetch is not cached — a network blip should not permanently doom every instance
  // that asked for this pack for the rest of the page's life.
  p.catch(() => packCache.delete(id));
  packCache.set(id, p);
  return p;
}

/**
 * EVERY PACK'S QUESTIONS, as rows (Trivia's "Every question pack"; also Quiz mix's trivia rounds). Each row carries
 * `pool`, the pack it came from. Built-in packs always; a review pack (../pack_reviews.js, `reviews` is the
 * account's handle or null) only as `playableBank` allows: passed questions, and open ones only with
 * `includeUnreviewed`. The same question in two packs is one question.
 */
export async function triviaPackRows({ reviews = null, includeUnreviewed = false } = {}) {
  const built = await Promise.all(packsFor('trivia').map((p) => loadPackCached(p.id)
    .then((pack) => packToTriviaBank(pack).map((r) => ({ ...r, pool: p.id })))
    .catch((err) => { console.error(`trivia: pack "${p.id}" did not load`, err); return []; })));
  const out = built.flat();
  if (reviews) {
    // The packs this needs (a lazy handle fetches them now; pack_reviews.js `want`), else the first load.
    await (typeof reviews.want === 'function' ? reviews.want({ includeUnreviewed: !!includeUnreviewed }) : reviews.ready);
    const m = reviews.map();
    for (const entry of (typeof reviews.listing === 'function' ? reviews.listing() : []) || []) {
      if (!entry || entry.kind !== 'trivia') continue;
      const pack = reviews.packById(entry.id);
      if (!pack) continue;
      out.push(...playableBank(pack, m, { includeUnreviewed: !!includeUnreviewed, packId: entry.id })
        .map((r) => ({ ...r, pool: entry.id })));
    }
  }
  const seen = new Set();
  return out.filter((r) => { const id = triviaId(r); if (seen.has(id)) return false; seen.add(id); return true; });
}

/**
 * WHERE SOMEBODY STARTS IN TRIVIA, from their two rows (THE LEVEL FOLLOWS THE PERSON, above): `own` their
 * `ratings_trivia` row ("Start trivia at"), `games` their `ratings` row (their usual start). Their own word, else
 * (following) their usual one, as a Trivia level; null when neither says. PURE.
 */
export function triviaStartLevel(own, games) {
  const mine = own?.start;
  if (START_LEVELS.includes(mine)) return difficultyLevel(mine);
  const usual = games?.start;
  return START_LEVELS.includes(usual) ? difficultyLevel(usual) : null;
}
/** The mark a change to their usual start leaves, while they follow it (else null). PURE. */
export function triviaStartMark(own, games) {
  if (START_LEVELS.includes(own?.start)) return null;
  const m = games?.startMark;
  return m == null || m === '' ? null : String(m);
}

const SETTINGS = [
  ...(TRIVIA_PACKS.length ? [
    // 'all' FIRST: it is the default, and a switch walks a choice from the top.
    { key: 'contentSource', label: 'Where questions come from', kind: 'choice', default: 'all',
      level: 'standard',
      options: [{ value: 'all', label: 'Every question pack' },
                { value: 'pack', label: 'A built-in pack' },
                { value: 'bank', label: 'Written questions + word bank' }],
      note: 'A pack is ready-made — nobody has to write questions first, and nobody playing '
        + 'already knows the answers. "Every question pack" mixes them all, each player at their own level.' },
    { key: 'packId', label: 'Which pack', kind: 'choice', default: TRIVIA_PACKS[0].id,
      level: 'standard',
      options: TRIVIA_PACKS.map((p) => ({ value: p.id, label: p.label })),
      appliesWhen: (v) => (v.contentSource ?? DEFAULTS.contentSource) === 'pack' },
  ] : []),
  // *** WHERE THIS SETTING LIVES, ARGUED: THIS PANEL, ON THIS SCREEN — not the account, not the person. ***
  //   FOR the account (or the person): turn it on once and review anywhere. AGAINST, and it decides it: on
  //   the account it would put unchecked questions on EVERY screen at once — including a screen where
  //   somebody is playing alone, with nobody beside them to catch a wrong "right answer", which is the one
  //   case this whole feature exists to prevent. The person's level has the same problem across their
  //   screens. A panel setting is on exactly where the reviewer is sitting. The cost: it stays on there
  //   until somebody turns it off (stated in the note), and reviewing on a second screen means turning it on
  //   there too. "Every Trivia panel" (the menu's own module level) still covers a screen with several.
  //   WHAT IS NOT PER SCREEN: the reviews themselves are the account's, so a question passed here is passed
  //   everywhere (../pack_reviews.js).
  { key: 'includeUnreviewed', label: 'Include unreviewed questions (review as you play)', default: false,
    level: 'standard', onLabel: 'On', offLabel: 'Off',
    note: 'Adds the packs waiting for review to "Which pack", and their questions to "Every question pack". '
      + 'Each unreviewed question shows a small ✓ fine / ✗ wrong '
      + '(or press W / O, or say "that one is wrong"). Playing a question through passes it; ✗ keeps it out '
      + 'for good. Only for this panel — turn it off when you have finished reviewing.' },
  { key: 'roundLength', label: 'Questions in a round', kind: 'choice', default: 10,
    level: 'standard',
    options: [{ value: 5, label: '5' }, { value: 10, label: '10' },
              { value: 15, label: '15' }, { value: 20, label: '20' }] },
  { key: 'choices', label: 'Answers to choose from', kind: 'choice', default: 4,
    level: 'standard',
    // FEWER IS EASIER, AND IT IS THE FIRST THING TO REACH FOR. With one switch and a scan,
    // four options is four times as long to reach the last one as two is.
    options: [{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }] },
  { key: 'includeWords', label: 'Also ask about the word bank', default: true,
    level: 'standard', onLabel: 'Yes', offLabel: 'Only written questions',
    note: 'a vocabulary row already holds everything a multiple-choice question needs' },
  // *** THE LADDER'S ROWS (2026-10-05, QUESTIONS AT EVERY LEVEL above), the same rows, words and defaults as
  // every other question game (../adaptive_play.js adaptiveSettings), so a caregiver who set them in Thinking
  // games finds them here. Four starting levels, because a pack's words are four (very easy, 2026-10-06). Two left out: "Missed
  // questions come back" (Trivia's pick does not use the ladder's spaced review, so the row would change
  // nothing) and the AI-writer rows (Trivia's questions come from packs). Hidden for "Written questions",
  // which carry no levels.
  // (Its "Start this game at" row is left out too: Trivia has its own, below, which works the same way.)
  ...adaptiveSettings({ startLevels: 4, appliesWhen: (v) => v.contentSource !== 'bank', personStart: false })
    .filter((row) => row.key !== 'review'),
  // THE PERSON'S OWN START (THE LEVEL FOLLOWS THE PERSON, above). Standard, because it is the one a caregiver
  // setting up somebody new reaches for; the per-panel "A new player starts at level" stays advanced.
  { key: PERSON_START_KEY, label: 'Start trivia at', kind: 'choice', default: START_SAME, level: 'standard',
    options: [{ value: START_SAME, label: 'Their usual starting level' },
              { value: 'very easy', label: 'Very easy questions' }, { value: 'easy', label: 'Easy questions' },
              { value: 'medium', label: 'Medium questions' }, { value: 'hard', label: 'Hard questions' }],
    note: 'For the person this screen is for, in Trivia only, and kept with them on each of their screens. '
      + '"Their usual starting level" is the person\'s own, set in this screen\'s settings on the People tab. '
      + 'Changing it starts them again there; after that, their answers move them. Players typed in by name '
      + 'start at "A new player starts at level".',
    appliesWhen: (v) => v.contentSource !== 'bank' },
  // Mike, 2026-10-04. Per game (this panel's settings, like the score row), not per account: the same quiz on
  // a shared screen and on somebody's phone may want different amounts under the answer.
  // 2026-10-04: the item's own explanation, above the source line — so its row is above the source's row too.
  answerExplainField(),
  answerSourceField(),
  // *** READING ALOUD (2026-10-04). *** The first row is quiz_flow.js's, word for word (key, label, default,
  // level), so a caregiver who learned it in Brain games finds it here.
  { key: 'speak', label: 'Say the questions aloud', default: true, level: 'standard',
    onLabel: 'On', offLabel: 'Off',
    note: 'The question and its answers, then "Correct." and why. Nothing is said until somebody first presses '
      + 'or taps the game.' },
  // quiz_flow.js's key and label; the words under it are Trivia's, because here the switch walks the answers
  // themselves (no "Is it this one?"). Hidden while nothing is said at all.
  { key: 'sayChoice', label: 'Say the switch choice too', default: true, level: 'standard',
    onLabel: 'Yes (the answer it lands on)', offLabel: 'Only the question',
    note: 'Somebody on a switch needs it to know where the scan is.',
    appliesWhen: (v) => v.speak !== false },
  // *** "SAY WHERE THE ANSWER COMES FROM": OFF BY DEFAULT, AND ADVANCED. *** Argued:
  //   FOR on (matching "Show where the answer comes from", which is on): the same honesty, for somebody who
  //   cannot read the line.
  //   AGAINST, and it decides the default: a source is an address or a host ("NASA (science.nasa.gov)"), which
  //   a voice reads as letters and dots; it adds a sentence to every answer that names one; and the line is
  //   already on screen. Off costs a reader nothing. Advanced, because few will turn it on and the standard
  //   menu is held to a press budget. It reads only what the shown line shows (so it is hidden while "Show
  //   where the answer comes from" is off, or while nothing is said), plus a lesson question's "From the
  //   lesson" line, which is the same kind of thing. [Guess, on Mike's list.]
  { key: 'speakSource', label: 'Say where the answer comes from', default: false, level: 'advanced',
    onLabel: 'On', offLabel: 'Off',
    note: 'Reads the source line under the answer aloud, after why.',
    appliesWhen: (v) => v.speak !== false && answerSourceMode(v) !== 'off' },
  // A spelling question's answers are read letter by letter (Mike, 2026-10-07); how fast is a row because the
  // right gap depends on the listener. Advanced: the default is the way a person spells aloud. ../spell_aloud.js.
  spellPaceField({ appliesWhen: (v) => v.speak !== false }),
  // *** RECORDING IS OFF UNLESS SOMEBODY TURNED IT ON, and this row is why it is `standard`
  // rather than buried. A microphone that a person cannot easily find the switch for is a
  // microphone they cannot easily turn off. ***
  { key: 'record', label: 'Record answers aloud', default: false, level: 'standard',
    onLabel: 'On', offLabel: 'Off',
    note: 'off unless you turn it on' },
  // *** THIS FILE HAS BEEN CITING MIKE FOR A POSITION HE DID NOT TAKE. ***
  //
  // The render used to carry: *"NO score on screen... the header of this file records Mike's
  // position that a patient-facing score is the thing to avoid."* Read the quote at the top
  // again — it is about PRONUNCIATION scoring, in the act of killing a speech-therapy game:
  //
  //     *"the score is based on the trivia and not the pronunciation"*
  //
  // That sentence PROPOSES a trivia score. It moves the score OFF the thing that would be a
  // verdict about somebody's body and ONTO something anybody can be wrong about, which is the
  // whole argument the header spends three paragraphs making. And the same paragraph cites
  // `PRINCIPLES.md` §3.C to say that *choosing to play a quiz is asking* in a way a clarity
  // score never is. The file talked itself into the opposite of its own reasoning.
  //
  // That matters beyond one control: `CLAUDE.md` warns against citing a doc to shut down
  // reconsideration, and this was worse — citing a quote for something it does not say, in a
  // comment that reads as settled.
  //
  // *** ON BY DEFAULT, REVERSED 2026-09-22. *** Mike: "Why should a screen someone can't walk
  // away from not show a score? Games have scores. That's pretty standard." Direct ruling,
  // overriding the "off by default anyway" reasoning that used to be here (a screen somebody
  // cannot walk away from should not keep a running tally unless somebody decided it should) --
  // he decided it should. `comet` gets the identical reversal for the identical reason; see
  // its own SETTINGS row.
  //
  // *** 2026-09-30, row 2.40: `showScore` (on/off) became `ownScore` (auto/always/off). *** See
  // DEFAULTS. Same label, same level, so the row is where it always was.
  ownScoreField({ note: 'How many trivia answers were right — never anything about how somebody '
    + 'spoke. A Scoreboard on the same screen can show it instead.' }),
  { key: 'correctPoints', label: 'Points for a first-guess answer', kind: 'number', default: 1,
    level: 'advanced', min: 0, max: 10, step: 1,
    note: 'Each further guess is worth a quarter less, down to a quarter of this.' },
  // The `tryingPoints` row is gone with the value it set -- see DEFAULTS. What it bought is now
  // the floor of the quartering, which is one number a caregiver can reason about instead of two
  // that had to be held in the right order.'
];

registerModule(
  { type: 'trivia', title: 'Trivia',
    description: 'A quiz over questions you write yourself. Answerable with one switch.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events } = ctx;
    const rand = ctx.rand || Math.random;
    // Injectable, like `rand` beside it and like `now` in algebra, pressgame and the
    // director -- a latency the suite cannot control is a latency the suite cannot check.
    const now = ctx.now || (() => Date.now());

    let cfg = { ...DEFAULTS };
    let bank = [];
    let deck = [];
    let at = 0;
    let q = null;
    let highlight = 0;          // which option a scanning switch is pointed at
    let answered = null;        // the index of the CORRECT option, once it has been found
    // *** THE GUESSES ALREADY SPENT ON THIS QUESTION. ***
    //
    // G13, Mike: *"partial credit — full point for a first-guess answer, less for each
    // subsequent guess, so attempting is still rewarded. Same principle as blind-answer
    // trivia."* A wrong press no longer ends the question; it marks that option and hands the
    // question back.
    let misses = [];
    // THE SESSION'S TALLY. Counted here rather than derived from the ledger: the ledger is the
    // durable record of what happened and it spans days, and "3 of 5" is about the round
    // somebody is sitting in front of right now.
    let rightCount = 0;
    let askedCount = 0;
    // *** WHEN THE QUESTION WENT UP. ***
    //
    // Trivia was the ONLY game logging no `latencyMs` at all -- wordforge, algebra and
    // pressgame all stamp one -- so "how quickly answers come", which chat calls the single
    // most important number in the measurement thesis, had a hole in it exactly where the
    // quiz is.
    //
    // Measured from the QUESTION APPEARING rather than from the previous guess, and that
    // matters now a question can take several: the second guess legitimately reads longer
    // than the first, because it did take longer. Time-since-last-press would hide the
    // thinking, which is the thing being measured.
    let askedAt = 0;
    let streak = 0;
    let ledger = null, telemetry = null, session = null;
    let recorder = ctx.recorder || null;
    let sharedBank = null;
    let lessonQ = null;    // what lessons.js has routed here, see lessonItems() below
    // *** TOPICS LEVEL UP, THE SAME WAY THEY ALREADY DO IN WORD FORGE. ***
    // A bank/pack question may carry `topic: '<id>'`; those stay OUT of the deck until the
    // matching lesson has been watched (../lessons.js). A question with NO topic is always in
    // play, so a bank written before this existed is unaffected.
    let lessons = null;
    // Quest (gating enforced, today's behavior) vs sandbox (everything open) — a per-PROFILE
    // choice read the same way `lessons` itself is, see ../lessons.js's own "mode" section.
    let mode = null;
    let topics = DEFAULT_TOPICS;
    let held = [];             // topics still holding questions back, for the "waiting behind" note
    // *** "I THINK THIS QUESTION IS WRONG" (Mike, 2026-09-28) — see ../contests.js. *** Offered once
    // the question is answered, as a SECOND STOP in the post-answer highlight: `after` 0 is Next (the
    // default, so the ordinary path is still one `select`), 1 is the contest. `prev` walks the two;
    // `next` ADVANCES, as it always did (Mike, 2026-09-29: "I'd have it go to the next question" —
    // a 2026-09-28 version had `next` step onto the contest instead). A contest writes one row to the
    // per-profile contests log and nothing else: no points, no trial, no change to the answer.
    let contests = null;
    let after = 0;
    let contested = false;       // the question on screen was contested
    let contestFailed = false;   // ...but the row could not be saved
    const isHeldItem = (item, set) => !!item && set.has(contestKey(item.question, item.answer));
    // *** REVIEW BY PLAYING (../pack_reviews.js). *** `reviews` is the account's review log plus the packs
    // waiting for review — made only where the host offers it (`ctx.makePackReviews`, the kiosk), so a
    // harness or page without it behaves exactly as before. Per question on screen: `reviewing` (it was
    // OPEN when it went up and the setting is on — the control shows), `reviewMark` (what the reviewer did
    // this time: null | 'fine' | 'wrong'), `noteSaved`, `reviewFailed` (a verdict that could not be saved).
    let reviews = null;
    let offReviews = null;
    let reviewMark = null;
    let noteSaved = false;
    let reviewFailed = false;
    const isFlaggedItem = (item) => !!(reviews && item?.review
      && reviews.map().get(item.review.key)?.status === REVIEW_STATUS.FLAGGED);
    // *** SET BY destroy(), AND CHECKED BY EVERY CALLBACK THAT CAN LAND AFTER IT. *** (Stage 4
    // bench soak, 2026-10-01: ~40 DOM nodes kept alive per destroyed Trivia.) The shared bank row
    // and the lesson-routed row are handles THIS module opens with ctx.makeState, so the runtime
    // never disposes them, and nothing here did either: each one kept polling (and holding a push
    // subscription) forever, and its subscriber closure held this panel's mount. A load that
    // resolves after destroy() would also call startPolling() and bring a destroyed handle back.
    let dead = false;
    let onClick = null;
    // *** THE LADDER (QUESTIONS AT EVERY LEVEL, above). *** `ladder` is made in init(). `levelled`: this round
    // is dealt by level (the bank has levels and nobody is reviewing). Then `deck` is the round's SLOTS, each
    // filled as it goes up for whoever's turn it is (pickNext), from `roundPool`. `ladderBank` is what the
    // ladder rates ({ id, level }), `idOf` a row's ladder id, `seenBy` each player's ids answered or skipped
    // this sitting.
    let ladder = null;
    let ladderStore = null;
    let levelled = false;
    let roundPool = [];
    let ladderBank = [];
    let idOf = new Map();
    const seenBy = {};
    // THE LEVEL FOLLOWS THE PERSON (above). `splitStore`: the screen's row plus the person's own, as one row to
    // the ladder (null on a host with no per-person rows). `personHandles`: the person's own row, one per person
    // id this panel has met. `rawPersonStart`: the panel's copy of "Start trivia at", as saved (undefined: never).
    let splitStore = null;
    const personHandles = new Map();
    let rawPersonStart;
    let seenRawStart = false;
    // players (2026-10-06): EVERYBODY PICKED FROM THIS LOGIN plays as themselves (player_picker.js), each one's row kept
    // with them as the screen's person's is (on this login's row for them). Their `person:<id>`s, and the screen's
    // person's always (a row of theirs on the screen's row still moves to them).
    function triviaPeople() {
      const ids = new Set(ctx.personId ? [`person:${ctx.personId}`] : []);
      let ps = [];
      try { ps = resolvePlayers(cfg.players, { personId: ctx.personId || null, host: ctx.screenPlayers || null }); } catch { ps = []; }
      for (const p of ps) if (String(p.id).startsWith('person:')) ids.add(p.id);
      return [...ids];
    }
    function personHandleFor(playerId) {
      const id = typeof playerId === 'string' && playerId.startsWith('person:') ? playerId.slice(7) : null;
      if (!id || !triviaPeople().includes(playerId) || typeof ctx.makePersonState !== 'function') return null;
      if (personHandles.has(id)) return personHandles.get(id).handle;
      let handle = null;
      try { handle = ctx.makePersonState(id, TRIVIA_LADDER_KEY, { ...LADDER_STATE_OPTIONS }) || null; } catch { handle = null; }
      let off = null;
      // (players) The menu's "Start trivia at" is the screen's person's: only their row is copied back to it.
      if (handle) { try { off = handle.subscribe?.(() => { if (!dead && id === ctx.personId) syncStartToPanel(); }) || null; } catch { off = null; } }
      // "THEIR USUAL STARTING LEVEL" (above): it is on the person's other ladder row (`start`, `startMark`).
      // Read here, never written; listened to, so a change made on the People tab reaches this one.
      let games = null;
      let gamesReady = null;
      try { games = ctx.makePersonState(id, PERSON_LADDER_KEY, { ...LADDER_STATE_OPTIONS }) || null; } catch { games = null; }
      if (games) {
        gamesReady = Promise.resolve().then(() => games.load?.()).catch(() => {})
          .then(() => { if (!dead) { try { games.startPolling?.(); } catch { /* none */ } } });
      }
      personHandles.set(id, { handle, off, games, gamesReady });
      return handle;
    }
    const personDoc = () => {
      const h = ctx.personId ? personHandles.get(ctx.personId)?.handle : null;
      try { return h?.get?.() || null; } catch { return null; }
    };
    const gamesDoc = () => {
      const h = ctx.personId ? personHandles.get(ctx.personId)?.games : null;
      try { return h?.get?.() || null; } catch { return null; }
    };
    const personStartNow = () => { const s = personDoc()?.start; return START_CHOICES.includes(s) ? s : null; };
    // Follows their usual start: the person's row says 'same', or nothing yet (the row's default).
    const followsGames = () => !START_LEVELS.includes(personStartNow());
    const gamesStartNow = () => { const s = gamesDoc()?.start; return START_LEVELS.includes(s) ? s : null; };
    const gamesMarkNow = () => { const m = gamesDoc()?.startMark; return m == null || m === '' ? null : String(m); };
    // (players) Somebody else picked from this login: their own "Start trivia at" (on their Trivia row), else, following,
    // their usual start (their games row). Read, never written from here: theirs is set on their own screen.
    const otherDoc = (pid, which) => {
      const h = typeof pid === 'string' && pid.startsWith('person:') ? personHandles.get(pid.slice(7))?.[which] : null;
      try { return h?.get?.() || null; } catch { return null; }
    };
    const otherStart = (pid) => triviaStartLevel(otherDoc(pid, 'handle'), otherDoc(pid, 'games'));
    const otherMark = (pid) => triviaStartMark(otherDoc(pid, 'handle'), otherDoc(pid, 'games'));
    // Who is playing changed (the panel's Players row, or the screen's Players tab): their own rows are read in.
    let seenTriviaPeople = null;
    function triviaPlayersMoved() {
      const sig = triviaPeople().join(',');
      if (sig === seenTriviaPeople) return;
      const first = seenTriviaPeople === null;
      seenTriviaPeople = sig;
      if (first || !splitStore) return;
      try { splitStore.load()?.then?.(() => { if (!dead) firstAgainNow?.(); }); } catch { /* next time */ }
    }
    let firstAgainNow = null;
    let offScreenPlayers = null;
    // The person's row is the truth; the panel's copy is what the menu shows. A copy the person's row has never
    // had (a value chosen on this panel before it knew the person) is given to the person, without moving them.
    function syncStartToPanel() {
      const h = ctx.personId ? personHandles.get(ctx.personId)?.handle : null;
      const s = personStartNow();
      if (!s) {
        if (h && START_CHOICES.includes(rawPersonStart) && splitStore) {
          splitStore.ownReady(`person:${ctx.personId}`).then(() => {
            if (!dead && !personStartNow()) { try { h.set({ start: rawPersonStart }); } catch { /* next time */ } }
          });
        }
        return;
      }
      if (s === rawPersonStart || typeof state?.set !== 'function') return;
      rawPersonStart = s;   // set first, so the panel's own echo of this is not read as somebody changing it
      try { state.set({ [PERSON_START_KEY]: s }); } catch (err) { console.error('trivia: start copy', err); }
    }
    // Somebody changed "Start trivia at" in the menu: the person's row says so, and they start again there.
    // 'same': their usual starting level, else "A new player starts at level".
    async function applyPersonStart(v) {
      if (!START_CHOICES.includes(v) || !ladder) return;
      const pid = ctx.personId ? `person:${ctx.personId}` : null;
      const h = pid && splitStore ? splitStore.ownHandle(pid) : null;
      if (h) {
        await splitStore.ownReady(pid);
        if (dead || !ladder) return;
        if (personStartNow() === v) return;     // a copy coming back from the person's row: nobody changed it
        try { h.set({ start: v }); } catch (err) { console.error('trivia: start', err); }
      }
      const lvl = v === START_SAME ? (difficultyLevel(h ? gamesStartNow() : null) || Number(cfg.startLevel) || 1)
        : difficultyLevel(v);
      ladder.startAt(pid || 'player', GAME, lvl);
    }

    // ---------------------------------------------------------------------------------------
    // *** SPEECH (2026-10-04): READ ALOUD THE WAY THE OTHER QUIZ GAMES DO (../quiz_view.js). ***
    // ---------------------------------------------------------------------------------------
    // THROUGH `ctx.output.say`, the person's own routing, with the newest line cancelling one still queued
    // (quiz_view.js's rule: the last press is the one worth hearing). That is also how it respects the
    // speaker arbiter: the speech channel is the source registered on the audio bus (output_channels.js), so
    // music ducks under it and the master volume applies. No `ctx.output` (a harness, the modules page): silent.
    //
    // WHAT IS READ, AND WHEN:
    //   * A QUESTION GOING UP: the question, then its answers, each its own sentence ("…France? Paris. London.
    //     Rome. Madrid."). THE ANSWERS ARE READ, argued: FOR leaving them out — a switch user hears each one as
    //     the scan lands, and a reader can see them. AGAINST, and it wins: without them a question like "Which
    //     planet is closest to the Sun?" is open-ended to somebody who cannot read the tiles, and a pointer
    //     user who cannot read has no scan to hear them on. The sentence breaks are the short pause (the Web
    //     Speech voice pauses at a full stop; there is no other pause it honours everywhere). Not a row of its
    //     own: "the questions" of a multiple-choice quiz include the choices. [Guess, on Mike's list.]
    //   * THE SCAN LANDING ("Say the switch choice too"): the answer it is now on. After an answer, the stop it
    //     is on ("Next question." / "I think this question is wrong.").
    //   * A WRONG PRESS: the words on screen ("Not that one — try again."), then where the scan moved to.
    //   * A RIGHT ANSWER: "Correct.", then the explanation ("Say why after the answer"), then — only with "Say
    //     where the answer comes from" on — the source line as shown.
    //   * A CONTEST: the thank-you on screen. A person who cannot read pressed it and should hear it landed.
    //   * A SPELLING QUESTION (`spell: true` on the pack item, 2026-10-07): every answer above is read letter by
    //     letter, not said, until the answer is shown; then "Correct." and the word. ../spell_aloud.js.
    //
    // *** NOTHING IS SAID UNTIL SOMEBODY FIRST PRESSES OR TAPS THE GAME — ITS "START". *** game_start.js's
    // reason, exactly: a game that talks by itself talks to an empty room, and a home screen comes up at boot
    // and after every power cut ("a quiz starting to talk at 3 a.m. is exactly the bug"). Trivia has no Start
    // button (it has always shown its first question at once, silently, and that stays), so its first press is
    // the start: that press does what it always did, AND opens the voice. A first press that moves the scan
    // reads the question and answers before the lit one, since nothing has been read yet. [Guess, on Mike's
    // list: the alternative is the full game_start.js gate — a Start overlay, the autostart rows, Pause.]
    //
    // *** WHILE REVIEWING (../pack_reviews.js): THE REVIEWER'S ✓ / ✗ SAYS NOTHING AND CUTS NOTHING. ***
    // Argued: cutting the line in flight on ✗ would land the reviewer's verdict on the player, which is the
    // same reason ✗ leaves the question on screen (reviewWrong). So the question keeps being read. What
    // changes is AFTER a ✗: a right answer says only "Correct." — not the explanation and not the source,
    // because a question marked wrong may be wrong exactly there, and "a wrong 'why' taught as fact is as bad
    // as a wrong answer" (reviewHtml). The screen still shows both, labelled, in the reviewer's strip. The
    // review strip's own words ("Not yet reviewed", "Marked wrong") are never read: they are for the reviewer.
    // A ✓ / ✗ press does not open the voice either (it is not the player starting the game).
    //
    // HIDDEN AND QUIET HOURS: the same as the other quiz games, because the speech is theirs. A hidden panel
    // still speaks on a press (quiz_view.js does not stop it; "When this panel is hidden: Mute it" mutes the
    // sources a panel registered, and the speech channel is the screen's, not the panel's). Quiet hours do not
    // exist yet (output_panel.js "WHAT IS NOT HERE YET"); when they do, they mute the speech channel, and this
    // goes quiet with every other caller of `say`.
    let lastSpeech = null;
    let voiceOpen = false;
    const speaks = () => cfg.speak !== false;
    // A line ends in punctuation, so each answer is its own sentence and the voice pauses between them.
    const asLine = (s) => {
      const t = String(s == null ? '' : s).trim();
      return !t ? '' : (/[.?!…:;"”'’)]$/.test(t) ? t : `${t}.`);
    };
    function say(lines) {
      if (dead || !voiceOpen || !speaks()) return;
      const text = (Array.isArray(lines) ? lines : [lines]).map(asLine).filter(Boolean).join(' ');
      const out = ctx.output;
      if (!text || !out || typeof out.say !== 'function') return;
      try {
        if (lastSpeech && typeof out.cancel === 'function') out.cancel(lastSpeech);
        lastSpeech = out.say(text, { source: GAME });
      } catch (err) { console.error('trivia: say', err); }
    }
    // The player's press opens the voice. True when THIS press opened it.
    function openVoice() {
      if (voiceOpen) return false;
      voiceOpen = true;
      return true;
    }
    // The question and the answers still in play (one already guessed is out of play, and out of the read).
    // With more than one player, "Ann, your turn." first (the ladder's own line, as in the other quiz games).
    // *** A SPELLING QUESTION (q.spell; Mike, 2026-10-07): EACH ANSWER IS SPELLED, NOT SAID. *** "Saying the word
    // makes it obvious bc the answer is the one it pronounces right." Letter by letter at the row's pace, "Or"
    // between them, while the question is open: here and where the scan lands. ../spell_aloud.js argues it.
    const spoken = (o) => (q && q.spell ? spellAloud(o, { pace: spellPace(cfg) }) : o);
    const questionLines = () => {
      if (!q) return [];
      const open = q.options.filter((_, i) => !misses.includes(i));
      return [levelled && ladder ? ladder.askPrefix() : '', q.question,
        ...(q.spell ? spelledOptions(open, { pace: spellPace(cfg) }) : open)];
    };
    const litLine = () => (q && cfg.sayChoice !== false ? spoken(q.options[highlight]) : '');
    const AFTER_LINES = ['Next question', 'I think this question is wrong'];
    function rightLines() {
      const lines = ['Correct.'];
      // Once the answer is on screen nothing is left to give away: a spelling question's answer is said as the
      // word it is ("Correct. Rhythm."), which is what the letters were spelling.
      if (q.spell) lines.push(q.answer);
      if (reviewMark === 'wrong') return lines;
      if (answerExplainOn(cfg)) lines.push(q.explain);
      if (cfg.speakSource === true) {
        if (q.source) lines.push(`From the lesson: “${q.source}”`);
        lines.push(answerSourceText(q.sources, { mode: answerSourceMode(cfg) }));
      }
      return lines;
    }

    const el = (s) => mount.querySelector(s);

    // *** THE SCORE, PUBLISHED (row 2.40, `../score_source.js`). *** The same count `.tv-score`
    // draws, so a Scoreboard following Trivia and this panel can never disagree. Made in init();
    // when a Scoreboard starts or stops showing it, this panel redraws to step its own aside.
    let score = null;
    function publishScore() {
      score?.set?.(rightCount, { detail: askedCount ? `${askedCount} asked` : '' });
    }

    // Never let the deck just be quietly shorter (or, at the extreme, entirely empty) —
    // name what's waiting and why, the same rule Word Forge follows for the same reason.
    const heldNote = () => held.length
      ? `${held.reduce((n, h) => n + h.count, 0)} more waiting behind: ${held.map((h) => esc(h.label)).join(', ')}`
      : '';

    function render() {
      if (!q) {
        // *** THE LINK BACK, UNLESS EVERYTHING IS SIMPLY GATED. *** A deck that is empty because
        // a lesson has not been watched yet is not a bank that was never written — saying "add
        // the Questions module" here would be actively wrong, and would read as the game not
        // knowing its own state.
        mount.innerHTML = held.length
          ? `<div class="tv"><div class="tv-empty">
              <p><b>Questions are waiting on a lesson.</b></p>
              <p class="tv-held">${heldNote()}</p>
            </div></div>`
          : `<div class="tv"><div class="tv-empty">
              <p><b>No questions yet.</b></p>
              <p>These come from your bank — the <b>Questions</b> module. Add it to this screen and
                write some, and anything you write there shows up here.</p>
              <p class="tv-fmt">One per line:
                <code>question | answer | wrong | wrong | wrong</code></p>
            </div></div>`;
        return;
      }
      const done = answered !== null;
      // THE SCORE GOES OUT FIRST, drawn here or not: a Scoreboard shows it from this (row 2.40).
      publishScore();
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore, showScore: cfg.showScore }),
        !!score?.shownElsewhere());
      mount.innerHTML = `
        <div class="tv">
          <p class="tv-count">${at + 1} of ${deck.length}${own
            ? ` <span class="tv-score">· ${rightCount} right</span>` : ''}</p>
          ${held.length ? `<p class="tv-held" data-held>${heldNote()}</p>` : ''}
          <h3 class="tv-q">${turnChip(done)}${esc(q.question)}</h3>
          <ol class="tv-opts" data-opts>
            ${q.options.map((o, i) => {
              const right = done && i === q.correctIndex;
              // A wrong one STAYS marked and stays out of play for the rest of the question.
              // Letting it be pressed again would let somebody spend guesses on the same
              // mistake, and a scan would keep stopping on it.
              const wrong = misses.includes(i);
              return `<li>
                <button type="button" class="tv-opt" data-opt="${i}"
                  ${i === highlight ? 'data-on="1"' : ''}
                  ${right ? 'data-right="1"' : ''}${wrong ? 'data-wrong="1"' : ''}
                  ${done || wrong ? 'disabled' : ''}>${esc(o)}${answerMarkHtml(right ? 'right' : (wrong ? 'wrong' : ''))}</button></li>`;
            }).join('')}
          </ol>
          ${done
            ? `<p class="tv-said">Correct.</p>
               ${q.source ? `<p class="tv-src" data-source>From the lesson: “${esc(q.source)}”</p>` : ''}
               ${answerExplainLine()}
               ${answerSourceLine()}
               <div class="tv-after">
                 <button type="button" class="tv-next" data-next${after === 0 ? ' data-on="1"' : ''}>Next question</button>
                 ${contested ? '' : `<button type="button" class="tv-contest" data-contest${after === 1 ? ' data-on="1"' : ''}>I think this question is wrong</button>`}
               </div>
               ${contested ? `<p class="tv-contested" role="status" data-contested>${contestFailed
                 ? 'Thanks. It could not be saved just now, so it may come up again.'
                 : 'Thanks — it’s held back until someone looks at it.'}</p>` : ''}`
            // NOT "the answer was X". The question is still open, so telling them the answer
            // would end it for them.
            //
            // WHAT A GUESS COST is still not shown, and that part was always right: partial
            // credit goes to the ledger, not to the person mid-question. "You have already
            // spent half a point" is a running commentary on somebody's guessing, which is the
            // judgement `PRINCIPLES.md` §3.C is about — unlike a plain count of right answers,
            // which is the game's score and is what a quiz is.
            : (misses.length
              ? '<p class="tv-said">Not that one — try again.</p>'
              : '')}
          ${reviewHtml()}
        </div>`;
    }

    // WHOSE TURN (the ladder's chip, as in the other quiz games): drawn only with more than one player, or with
    // "Show each player's level" on. Before the answer it is whoever is answering; after, whoever just did.
    function turnChip(done) {
      if (!levelled || !ladder) return '';
      const html = ladder.turnHtml({ phase: done ? 'answer' : 'ask' }, GAME);
      if (html) ensureQuizStyle(mount.ownerDocument);
      return html;
    }

    // *** "SHOW WHERE THE ANSWER COMES FROM" (Mike, 2026-10-04; ../answer_source.js). *** Drawn only in the
    // answered branch above, so never before the answer, nor after a wrong guess (the question is still open).
    // NOT WHILE THE REVIEW STRIP IS SHOWING: the strip already names the source, in full, in every state — the
    // same words twice in one panel is clutter, and the strip's version is the one with the reviewer's detail.
    function answerSourceLine() {
      if (!q || q.reviewing || answered === null) return '';
      return answerSourceHtml(q.sources, { mode: answerSourceMode(cfg), onScreen: !linksHere });
    }

    // *** WHERE A SOURCE IS A LINK (Mike, 2026-10-07: "something I can click on that opens it in a new
    // window"). *** Off a screen, always. On a screen page, only when page_links.js `linksOpenHere` says this
    // browser is signed in with the screen's account AND is an ordinary window — Mike's computer showing a
    // screen page, not a care-room kiosk, which keeps the words and the address (and a code to scan in the
    // strip). Starts as "not here" on a screen and is redrawn once the answer comes back. `ctx.pageLinks`
    // ({ signedIn, browserWindow }) lets a harness answer for the browser.
    let linksHere = ctx.isScreen !== true;
    function checkLinksHere() {
      if (linksHere) return;
      const seam = ctx.pageLinks || {};
      Promise.resolve(linksOpenHere({ isScreen: true,
        ...(typeof seam.signedIn === 'function' ? { signedIn: seam.signedIn } : {}),
        ...(typeof seam.browserWindow === 'function' ? { browserWindow: seam.browserWindow } : {}) }))
        .then((yes) => { if (yes === true && !dead && !linksHere) { linksHere = true; if (q) render(); } })
        .catch(() => { /* stays as words and an address */ });
    }

    // *** "SAY WHY AFTER THE ANSWER" (2026-10-04; ../answer_source.js). *** The item's own explanation, between
    // "Correct." and the source line — drawn in the same answered-only branch, so never before the answer nor
    // after a wrong guess (an explanation names the answer). Steps aside for the review strip exactly as the
    // source does: while reviewing, the strip shows it (labelled, once answered), so it is never on screen twice.
    function answerExplainLine() {
      if (!q || q.reviewing || !answerExplainOn(cfg)) return '';
      return answerExplainHtml(q.explain);
    }

    // *** THE REVIEW CONTROL: SMALL, QUIET, AND OUT OF THE PLAYER'S WAY. *** At the foot of the panel, in
    // muted text, after everything the player reads. Not one of the highlight's stops (`highlight` walks the
    // answers, `after` walks Next and the contest — neither knows this exists), so the person playing never
    // spends a press on it. A reviewer reaches it by pointer, by the W / O keys, by voice ("that one is
    // wrong"), or by a switch bound to "Reviewing questions" in Devices (../pack_reviews.js REVIEW_ACTIONS).
    // THE SOURCE (Mike, 2026-10-04) is part of the strip, in every state: what the question rests on is what
    // the reviewer checks it against — full address, the note, and "none given" when there is none. (The
    // player's own, shorter line after the answer is answerSourceLine above, and steps aside for this.)
    function reviewHtml() {
      if (!q || !q.reviewing) return '';
      // (On a real screen, ctx.isScreen, a source link is plain words with its host and an address to open
      // elsewhere — unless `linksHere`, above: a signed-in computer in an ordinary window gets the link.)
      // THE EXPLANATION, FOR THE REVIEWER: once the question is answered (it names the answer), above the source,
      // labelled — it is one of the things being checked (the fact-check pass corrected ten). Shown whatever the
      // player's "Say why after the answer" says: reviewing is opted into, and a wrong "why" taught as fact is as
      // bad as a wrong answer. The player's own line (answerExplainLine) steps aside, so it is shown once.
      // *** THE SOURCE, TOO, ONLY ONCE THE ANSWER IS SHOWN (Mike, 2026-10-07: "Don't show the source until it
      // says what the correct answer is ... the source gives away the answer"). *** It used to show in every
      // state, so a reviewer could check it before answering — but the player is at the same panel, and
      // "science.nasa.gov/jupiter" under "Which planet has the Great Red Spot?" answers it. Not after ✗ either:
      // ✗ leaves the question open on screen for the player (reviewWrong). Before the answer the strip is
      // "Not yet reviewed ✓ fine ✗ wrong" and nothing else.
      const src = answered !== null
        ? answerExplainHtml(q.explain, { cls: 'tv-review-explain', attr: 'data-review-explain', label: 'Explanation:' })
          + sourceHtml(q.review?.sources, { onScreen: !linksHere })
        : '';
      if (reviewMark === 'wrong') {
        return `<div class="tv-review" data-review data-review-state="wrong">
            <p class="tv-review-said" role="status">${reviewFailed
              ? 'Marked wrong here, but it could not be saved just now.'
              : 'Marked wrong — it will not be asked again until it is fixed.'}</p>
            ${noteSaved
              ? '<p class="tv-review-said" data-review-note-saved>Note saved.</p>'
              : `<label class="tv-review-note">What is wrong? (optional)
                   <input type="text" data-review-note maxlength="1000" autocomplete="off"></label>
                 <button type="button" class="tv-review-btn" data-review-save>Save note</button>`}
            ${src}
          </div>`;
      }
      if (reviewMark === 'fine') {
        return `<div class="tv-review" data-review data-review-state="fine">
            <p class="tv-review-said" role="status">${reviewFailed ? 'Marked fine here, but it could not be saved just now.'
              : 'Marked fine.'}</p>
            <button type="button" class="tv-review-btn" data-review-wrong>✗ wrong after all</button>
            ${src}
          </div>`;
      }
      return `<div class="tv-review" data-review data-review-state="open">
          <span class="tv-review-tag">Not yet reviewed</span>
          <button type="button" class="tv-review-btn" data-review-fine aria-label="This question is fine">✓ fine</button>
          <button type="button" class="tv-review-btn" data-review-wrong aria-label="This question is wrong">✗ wrong</button>
          ${src}
        </div>`;
    }

    const reviewPlace = () => {
      try { return String(ctx.noteContext?.()?.dashboard || ''); } catch { return ''; }
    };

    // ✓ — passes it now. The question stays on screen and the game goes on.
    function reviewFine() {
      if (!q || !q.reviewing || reviewMark || !reviews) return;
      reviewMark = 'fine';
      reviewFailed = false;
      render();
      const shown = q;
      reviews.pass({ question: shown.question, answer: shown.answer, packId: shown.review.packId, place: reviewPlace() })
        .then((ok) => { if (!ok && q === shown) { reviewFailed = true; render(); } });
    }

    // ✗ — flagged at once (so it is never lost), the note follows if somebody types one. The question stays
    // on screen: yanking it away mid-answer would be the reviewer's verdict landing on the player. `back`
    // (Skip) moves on as always; it is never dealt again (advance / newRound leave flagged ones out).
    function reviewWrong() {
      if (!q || !q.reviewing || reviewMark === 'wrong' || !reviews) return;
      reviewMark = 'wrong';
      reviewFailed = false;
      noteSaved = false;
      render();
      const shown = q;
      reviews.flag({ question: shown.question, answer: shown.answer, packId: shown.review.packId, place: reviewPlace() })
        .then((ok) => { if (!ok && q === shown) { reviewFailed = true; render(); } });
    }

    function saveReviewNote() {
      if (!q || reviewMark !== 'wrong' || !reviews) return;
      const text = String(mount.querySelector('[data-review-note]')?.value || '').trim();
      if (!text) return;
      noteSaved = true;
      render();
      reviews.note(q.review.key, text);
    }

    // PLAYED THROUGH = PASSED: leaving an ANSWERED question nobody marked passes it. Skipping one unanswered
    // passes nothing — it was not looked at.
    function passIfPlayedThrough() {
      if (!q || !q.reviewing || reviewMark || answered === null || !reviews) return;
      reviews.pass({ question: q.question, answer: q.answer, packId: q.review.packId, place: reviewPlace() });
    }

    // ---- THE LADDER: the pick, the deal, the record (QUESTIONS AT EVERY LEVEL, above) ----
    // A row's level NOW: from its rating (moved by play), capped at the top of what this bank has.
    function candidates(pool, maxLevel) {
      const out = contests ? contests.held() : null;
      return pool.filter((b) => !(out && out.size && isHeldItem(b, out)) && !isFlaggedItem(b)).map((b) => {
        const id = idOf.get(b) || triviaId(b);
        const r = ladder.questionRow({ id, level: itemLevel(b) || UNLEVELLED }).rating;
        return { id, item: b, level: Math.min(levelOf(r, TRIVIA_RATING), maxLevel) };
      });
    }
    function pickNext() {
      const p = ladder.currentPlayer();
      const win = ladder.windowFor(p.id, GAME);
      const never = new Set(deck.filter(Boolean).map((b) => idOf.get(b)));
      const pick = pickNear(candidates(roundPool, win.maxLevel), { lo: win.lo, hi: win.hi,
        playerRating: ladder.playerRow(p.id, GAME).rating, avoid: seenBy[p.id] || new Set(), never, rand,
        rating: TRIVIA_RATING, poolOf: (c) => c.item?.pool || '' });
      return pick ? pick.item : null;
    }
    // Tells the ladder which question is up and for whom (its `deal`, handed the id: "deal THIS question").
    function dealToLadder(row) {
      const id = idOf.get(row);
      if (id) ladder.deal(GAME, { again: id });
    }
    // One finished question: a right answer (clean, or after misses: "helped"), or a skip (counted as missed,
    // as in every game on the ladder). Moves both ratings and, by Mike's thresholds, the player's floor.
    // "Seen this sitting" is marked HERE, not when it went up: a question put up and replaced before anybody
    // touched it (a round rebuilt as the screen's rows arrive) was not asked.
    function recordToLadder(result) {
      if (!levelled || !ladder) return;
      const id = idOf.get(deck[at]);
      const pid = ladder.dealt()?.player?.id;
      if (!id || ladder.dealt()?.id !== id) return;
      if (pid) (seenBy[pid] ||= new Set()).add(id);
      try { ladder.record({ ...result, item: { id } }); } catch (err) { console.error('trivia: ladder', err); }
    }

    // `count: false` puts a question up again without counting it as asked (the ladder's saved rows arriving
    // before anybody has touched the first question: see init()).
    function show(i, { count = true } = {}) {
      // Counted when a question GOES UP, not when it is answered: a question somebody walked
      // away from was still asked, and a tally that only counted finished ones would read
      // "3 of 3" on a round with two abandoned questions in it.
      if (count) askedCount += 1;
      at = Math.max(0, Math.min(deck.length - 1, i));
      if (levelled && ladder) {
        if (!deck[at]) deck[at] = pickNext();
        if (deck[at]) dealToLadder(deck[at]);
      }
      q = makeQuestion(deck[at], bank, { choices: cfg.choices, rand });
      // Review: the control shows only for a question still OPEN on this account, with the setting on.
      // Read once, as it goes up, so a pass written elsewhere mid-question does not pull it out from under
      // the reviewer.
      reviewMark = null;
      noteSaved = false;
      reviewFailed = false;
      if (q && deck[at]?.review) {
        q.review = { ...deck[at].review };
        q.reviewing = !!(cfg.includeUnreviewed && reviews
          && (reviews.map().get(q.review.key)?.status || REVIEW_STATUS.OPEN) === REVIEW_STATUS.OPEN);
      }
      answered = null;
      misses = [];
      askedAt = now();
      highlight = 0;
      after = 0;
      contested = false;
      contestFailed = false;
      render();
      // *** THE MARK GOES IN AT THE MOMENT THE QUESTION APPEARS ***, not when it is answered,
      // because the audio that matters is what happens between the two.
      recorder?.mark?.(q ? q.answer : '', { event: 'asked', question: q?.question || '' });
      // Read once it is up (SPEECH, above). Silent until somebody has pressed the game once.
      if (q) say(questionLines());
    }

    // ONE SWITCH, WALKED IN ONE DIRECTION, WRAPPING — the rule from module-input-spec, and the
    // reason a quiz is reachable at all for somebody with one button. A highlight that stopped
    // at the last option would strand them there.
    // `fresh`: this press just opened the voice, so the question has not been heard yet — it is read first.
    // `quiet`: the caller says something itself (a wrong press says "Not that one" and then where it moved).
    function moveHighlight(delta, { fresh = false, quiet = false } = {}) {
      if (!q || answered !== null) return;
      const n = q.options.length;
      // SKIP THE ONES ALREADY GUESSED. They are disabled, and a scan that kept stopping on a
      // dead button would spend a switch user's presses on options that cannot be chosen —
      // which is the same cost the module-input-spec rule about wrapping exists to avoid.
      // Bounded by `n` so a question with nothing left to try cannot spin forever.
      for (let step = 0; step < n; step++) {
        highlight = ((highlight + delta) % n + n) % n;
        if (!misses.includes(highlight)) break;
      }
      render();
      if (!quiet) say(fresh ? [...questionLines(), litLine()] : [litLine()]);
    }

    // The post-answer highlight: Next, then the contest while it is still offered. With only Next
    // left there is nothing to walk, so `next` advances, exactly as it always did.
    function moveAfter(delta) {
      if (!q || answered === null) return;
      const stops = contested ? 1 : 2;
      if (stops === 1) { advance(); return; }
      after = ((after + delta) % stops + stops) % stops;
      render();
      if (cfg.sayChoice !== false) say([AFTER_LINES[after]]);
    }

    function pressAfter() {
      if (after === 1 && !contested) contest(); else advance();
    }

    // Records the contest and says thank you. Nothing else changes: the answer stays recorded, the
    // points stay paid, the round does not move. The row is what holds the question out of the next
    // deck (and every other game's on this profile).
    function contest() {
      if (!q || answered === null || contested) return;
      contested = true;
      contestFailed = false;
      after = 0;
      render();
      say(['Thanks — it’s held back until someone looks at it.']);
      const shown = q;
      Promise.resolve(contests?.contest?.({ module: GAME, question: shown.question, answer: shown.answer,
        source: shown.source || '' }))
        .then((rec) => { if (!rec && q === shown) { contestFailed = true; render(); } })
        .catch(() => {});
    }

    /**
     * *** WHAT A RIGHT ANSWER IS WORTH, AFTER N WRONG ONES. ***
     *
     * `correctPoints` on the first press, one less for each guess already spent, and never
     * below `tryingPoints` — so attempting always pays something, which is the whole of what
     * Mike asked for. On the shipped defaults (2 and 1) that reads: two for a first-guess
     * answer, one for any answer after that.
     *
     * BOTH NUMBERS WERE ALREADY SETTINGS, and this is the first thing that awards
     * `tryingPoints`. It has been declared, defaulted to 1, and offered to a caregiver as
     * *"Points for reading the answer after a miss"* since the module was written, and nothing
     * anywhere ever paid it — a setting somebody can change that changes nothing. Reaching the
     * last remaining option after missing the others IS reading the answer after a miss, so
     * the label was true all along and is now true of the behaviour as well.
     */
    // *** EXTRACTED TO mcq_scoring.js, 2026-09-23 ***, so Word Forge's own multi-guess mode
    // (Mike: "I like Trivia's system better for this. Make that the default...") prices a
    // guess by the identical rule rather than a second, independently-drifting formula. This
    // wrapper is unchanged in behaviour -- it just reads `cfg.correctPoints` for the shared fn.
    function worth(spent) {
      return mcqWorth(spent, cfg.correctPoints);
    }

    function choose(i) {
      if (!q || answered !== null) return;
      const chosen = Number(i);
      if (misses.includes(chosen)) return;       // already spent; the button is disabled anyway
      const correct = chosen === q.correctIndex;

      // The corpus label: what was ASKED and what was PRESSED. Never a claim about what was
      // said aloud — see the header, and `recorder.js`.
      //
      // *** EVERY GUESS IS ITS OWN RECORD, WHICH IS WHY RETRYING DOES NOT BREAK THE OLD RULE.
      // *** The rule was "the answer cannot be taken back — the trial and the corpus mark are
      // already written, and letting somebody silently overwrite an answer would make both of
      // them lie." That reasoning is exactly right and it is preserved: nothing is overwritten
      // here. A second guess APPENDS a second mark and a second trial. What changed is only
      // that a wrong press no longer ends the question.
      recorder?.mark?.(q.answer, {
        event: 'answered', question: q.question,
        chose: q.options[chosen], correct, attempt: misses.length + 1,
      });
      Promise.resolve(telemetry?.log?.({
        game: GAME, session, mode: 'practice', concept: q.answer,
        responded: true, correct, prompt: q.question,
        // Guarded, not always sent. `fmtMs` renders a missing value as an em-dash and a zero as
        // "0 ms" -- one says "not measured" and the other is a claim about somebody's reaction
        // time. A fabricated zero is the worse of the two.
        latencyMs: askedAt ? Math.max(0, now() - askedAt) : undefined,
      })).catch((err) => console.error('trivia: telemetry', err));

      if (!correct) {
        // The question stays open. A streak is a run of CLEAN answers, so one miss ends it
        // whether or not the next press is right.
        misses.push(chosen);
        streak = 0;
        // Leave the highlight somewhere pressable, or a switch user's next press lands on the
        // button they just spent.
        const moved = misses.includes(highlight);
        if (moved) moveHighlight(1, { quiet: true }); else render();
        // The screen's own words, then where the scan went (only if it moved — otherwise it is where it was).
        say(['Not that one — try again.', moved ? litLine() : '']);
        return;
      }

      answered = chosen;
      rightCount += 1;
      // A first-guess answer extends the streak; one found after a miss does not, because
      // `streak` was already reset above on the press that missed.
      if (!misses.length) streak += 1;
      // `source` is what the totals group by, so it is the game's name and nothing else.
      // With players on the ladder, "Right answers earn points for" decides whose answers pay (asked before
      // the record below, while the question is still the ladder's dealt one).
      if (!levelled || !ladder || ladder.allowAward()) {
        Promise.resolve(ledger?.award?.({ amount: worth(misses.length), source: GAME,
                                          note: q.question }))
          .catch((err) => console.error('trivia: points', err));
      }
      recordToLadder({ right: true, misses: misses.length });
      render();
      say(rightLines());
    }

    // ONE DOCUMENT, TWO GAMES. The bank text comes from this instance's own state if somebody
    // set it there, otherwise from the shared row the Questions module edits. Word Forge reads
    // the word rows out of the same document; this reads the question rows AND may derive
    // questions from the words. An array form is still accepted for anything generating content.
    // Async now, for the pack path's fetch -- every caller already fires it and moves on
    // (`.then(readBank)`, a bare `readBank()` inside a subscribe callback), so nothing here
    // needs to await it. `bankGen` guards against a slow pack response landing after a NEWER
    // settings change already picked a different source — the stale one must not overwrite it.
    let bankGen = 0;
    // Whatever a lesson pack elsewhere on this profile has routed here (lessons.js's
    // `questionsTo` setting, ruled "both" by default 2026-09-23) -- ADDITIVE to whichever
    // source below is otherwise in play, own pack or own bank, since a lesson's questions are
    // a second, independent source, not a replacement for this instance's own. Each item
    // already carries `.topic`, so the existing gate()/lockedTopics() call in newRound() below
    // holds it back exactly like a hand-written topic-tagged bank row would.
    const lessonItems = () => lessonQ?.get?.()?.items || [];

    // ---------------------------------------------------------------------------------------
    // *** ALL THE PACKS ("Every question pack", Mike 2026-10-06: "a choice to have the questions come from
    // all of the pools") ***
    // ---------------------------------------------------------------------------------------
    // WHAT IS IN IT: every pack "A built-in pack" lists (pack_library.js: the built-in packs cleared to ship,
    // plus any this browser has loaded itself), and every question of the account's review packs that somebody
    // has PASSED (pack_reviews.js). With "Include unreviewed questions" on, the review packs' open questions
    // join too; flagged ones never. Plus whatever a lesson routes here, as for any source.
    // WHAT IS NOT: the written questions and the word bank. Argued: FOR including them, Mike said "all". AGAINST,
    // and it decides it for now: a written bank is usually somebody's syllabus for one purpose, the word bank
    // turns every vocabulary row into a question, and with nothing written the bank is five demo questions, so
    // "all" would quietly mean "packs plus the demo". They have no levels either. [Guess, on Mike's list.]
    // HOW IT IS DEALT: by level, exactly as one pack is (pickNear). Inside a level a PACK is picked first, evenly,
    // then a question in it, so the 300 sums of the maths pack do not make "every pack" mostly sums.
    // While reviewing (the setting on, open questions in play): open ones first, no levels, as for one review
    // pack. Argued: FOR levels while reviewing (a reviewer could meet the easy ones of every pack first). AGAINST,
    // and it keeps today's: a reviewer has to meet the hard questions too, and over a thousand open questions are
    // more rounds than anybody plays in a sitting, so dealing open-first is what gets them through.
    // A "pick which packs" choice is NOT here: the settings menu has no many-of-a-list row, and a row per pack
    // (about thirty) would swamp a menu walked one press at a time. [On Mike's list.]
    const allPacksBank = () => triviaPackRows({ reviews, includeUnreviewed: !!cfg.includeUnreviewed });

    async function readBank() {
      if (dead) return;
      const gen = ++bankGen;
      // Reviewing (the setting on): every review pack, whatever plays now, so "Which pack" can offer each one
      // with its count (settingsChoices). A lazy handle fetches them once (pack_reviews.js `want`).
      if (reviews && cfg.includeUnreviewed) reviews.want?.({ includeUnreviewed: true });
      if (cfg.contentSource === 'all') {
        const rows = await allPacksBank();
        if (gen !== bankGen || dead) return;
        if (rows.length) { applyBank([...rows, ...lessonItems()]); return; }
        // Nothing loaded at all: the bank plays, as for one unreachable pack.
      }
      // A REVIEW PACK (../pack_reviews.js): flagged questions never; passed ones always; open ones only with
      // "Include unreviewed questions" on. Nothing playable (the setting off and nothing passed yet, or no
      // reviews on this host) falls through to the bank, the same way an unreachable pack does.
      if (cfg.contentSource === 'pack' && isReviewPackId(cfg.packId)) {
        if (reviews) {
          await (typeof reviews.want === 'function' ? reviews.want({ includeUnreviewed: !!cfg.includeUnreviewed }) : reviews.ready);
          if (gen !== bankGen || dead) return;
          const pack = reviews.packById(cfg.packId);
          const items = pack ? playableBank(pack, reviews.map(),
            { includeUnreviewed: !!cfg.includeUnreviewed, packId: cfg.packId }) : [];
          if (items.length) { applyBank([...items, ...lessonItems()]); return; }
        }
      } else if (cfg.contentSource === 'pack' && cfg.packId) {
        try {
          const pack = await loadPackCached(cfg.packId);
          if (gen !== bankGen || dead) return; // superseded while the fetch was in flight
          applyBank([...packToTriviaBank(pack), ...lessonItems()]);
          return;
        } catch (err) {
          console.error(`trivia: pack "${cfg.packId}" failed to load, falling back to the bank`, err);
          // fall through -- an unreachable pack should read as an empty syllabus, not a dead panel
        }
      }
      const own = cfg.bankText;
      const share = (sharedBank?.get?.() || {}).bankText;
      const text = own != null ? own : (share != null ? share : SEED);
      const next = Array.isArray(cfg.bank) ? cfg.bank
                 : triviaPool(text, { includeWords: cfg.includeWords !== false, choices: cfg.choices });
      if (gen === bankGen && !dead) applyBank([...next, ...lessonItems()]);
    }

    function applyBank(next) {
      const changed = next.length !== bank.length;
      bank = next;
      // What the ladder rates: every row with its id and the level it was written for (1 when none).
      idOf = new Map(bank.map((b) => [b, triviaId(b)]));
      ladderBank = bank.map((b) => ({ id: idOf.get(b), level: itemLevel(b) || UNLEVELLED }));
      if (!deck.length || changed) newRound();
    }

    function advance() {
      // A question contested during this round is not asked again in it (a bank can carry the same
      // question twice, or a pack question can also arrive from a lesson).
      const out = contests ? contests.held() : null;
      passIfPlayedThrough();
      // Left unanswered (Skip): the ladder hears it as missed.
      if (q && answered === null) recordToLadder({ skipped: true });
      let i = at + 1;
      // ...nor is one flagged wrong while reviewing (here, or on another device of the account).
      while (i < deck.length && ((out && out.size && isHeldItem(deck[i], out)) || isFlaggedItem(deck[i]))) i++;
      if (i < deck.length) show(i);
      else newRound();
    }

    // *** WHILE REVIEWING, QUESTIONS NOT YET REVIEWED ARE DEALT FIRST. *** Argued: a 32-question pack dealt
    // at random ten at a time keeps re-asking questions already passed, and "play through and pass them"
    // becomes many more rounds than the pack has questions. Open ones first (shuffled among themselves),
    // then the round is filled from the rest as usual. With the setting off, nothing changes.
    const openTest = () => {
      const m = reviews.map();
      return (b) => !!b?.review && (m.get(b.review.key)?.status || REVIEW_STATUS.OPEN) === REVIEW_STATUS.OPEN;
    };
    // Somebody is reviewing: the setting is on and open questions are in play (newRound deals by level otherwise).
    const reviewingOpen = (pool) => !!(cfg.includeUnreviewed && reviews && pool.some(openTest()));

    function dealDeck(pool) {
      const opts = { roundLength: cfg.roundLength, rand };
      if (cfg.includeUnreviewed && reviews) {
        const isOpen = openTest();
        const first = buildDeck(pool.filter(isOpen), opts);
        if (first.length) {
          return [...first, ...buildDeck(pool.filter((b) => !isOpen(b)),
            { ...opts, roundLength: Math.max(0, cfg.roundLength - first.length) })];
        }
      }
      return buildDeck(pool, opts);
    }

    function newRound() {
      // Only what's unlocked goes in the deck. Same threshold Word Forge uses (`>= 4`) before
      // falling back to the whole bank -- a round built from fewer than four open questions
      // reads as broken rather than as a level gate, so an under-populated open set plays the
      // full bank instead of a degenerate one.
      // SANDBOX hands gate() a stand-in that says everything is unlocked, rather than reading
      // the real unlock log at all — the log is never touched by being in sandbox mode (see
      // ../lessons.js). No `mode` handle (an older harness with no ctx.makeState) falls back
      // to quest — the same "absent mechanism means today's behavior" rule `lessons ? ... :
      // new Set()` already follows on the line below.
      const sandbox = mode ? mode.isSandbox() : false;
      const unlocked = sandbox ? ALL_UNLOCKED : (lessons ? lessons.unlocked() : new Set());
      // CONTESTED QUESTIONS ARE LEFT OUT FIRST (../contests.js), before the "fewer than four open"
      // fallback — otherwise a small bank would deal the whole bank, contested ones included.
      const out = contests ? contests.held() : null;
      const playable = (out && out.size ? bank.filter((b) => !isHeldItem(b, out)) : bank)
        .filter((b) => !isFlaggedItem(b));
      const open = gate(playable, unlocked).open;
      held = lockedTopics(playable, unlocked, topics);
      const pool = open.length >= 4 ? open : playable;
      // BY LEVEL when the bank has levels and nobody is reviewing (QUESTIONS AT EVERY LEVEL, above): the
      // round's slots, filled one by one as each goes up. Otherwise the shuffled round, exactly as before.
      levelled = !!ladder && hasLevels(pool) && !reviewingOpen(pool);
      if (levelled) {
        roundPool = pool;
        deck = new Array(Math.min(Math.max(0, Math.floor(Number(cfg.roundLength) || 0)), pool.length)).fill(null);
      } else {
        roundPool = [];
        deck = dealDeck(pool);
      }
      if (!deck.length) { q = null; render(); return; }
      show(0);
    }

    return {
      // Exposed so the suite can assert the WHOLE ladder rather than the one step a given run
      // happens to reach. Without it the ladder check had to guard against its own absence,
      // which made it unfailable -- the fault this session keeps finding in its own work.
      __score: () => ({ right: rightCount, asked: askedCount }),
      __worth: (spent) => worth(spent),
      __probe: () => ({ at, answered, misses: [...misses], worth: worth(misses.length), askedAt,
        highlight, streak, deck: deck.length, after, contested, reviewMark, linksHere,
                        question: q ? { ...q } : null, bank: bank.length,
                        levelled, level: levelled && deck[at] ? itemLevel(deck[at]) : null }),
      __reviews: () => reviews,
      __ladder: () => ladder,
      // THE LIVE "WHICH PACK" LIST (settings_fields.js `fieldsFor` reads this when the menu opens): the
      // built-in and loaded packs, then this ACCOUNT's review packs — only those with passed questions while
      // the setting is off, every one while it is on. Nothing until the reviews have loaded (the declared
      // list stands meanwhile).
      settingsChoices() {
        if (!reviews || !TRIVIA_PACKS.length) return {};
        const extra = reviews.options({ includeUnreviewed: !!cfg.includeUnreviewed });
        if (!extra.length) return {};
        return { packId: [...TRIVIA_PACKS.map((p) => ({ value: p.id, label: p.label })), ...extra] };
      },
      init() {
        // THE LADDER, FIRST (QUESTIONS AT EVERY LEVEL, above), so the first round can be dealt by level. Its
        // row is this screen's `ratings_trivia` (TRIVIA_LADDER_KEY, argued above), shared by every Trivia panel
        // on it, with each player under their own id (adaptive_play.js parsePlayers: the screen's person, or a
        // name from "Players").
        // No spaced review and no writer here (see the settings rows). Its saved rows load in the background;
        // if they land before anybody has touched the first question, that question is picked again from them,
        // so a returning player's first question is at their level rather than a new player's.
        // THE LEVEL FOLLOWS THE PERSON (above): the screen's person's row goes in their own `ratings_trivia`,
        // where the host has per-person rows; everything else stays on this screen's.
        // Whether a source may be a link on this screen page (answerSourceLine, above): asked once, in the background.
        checkLinksHere();
        ladderStore = openLadderStore(ctx, TRIVIA_LADDER_KEY);
        let store = ladderStore;
        if (typeof ctx.makePersonState === 'function') {
          splitStore = splitLadderStore({ shared: ladderStore, ownIds: () => triviaPeople(),   // players: everybody picked
            ownFor: (pid) => personHandleFor(pid) });
          store = splitStore;
        }
        // A newer copy of somebody's level arrived before anybody touched the first question: pick it again.
        const firstAgain = () => {
          if (dead || !levelled || !q || answered !== null || misses.length || voiceOpen) return;
          deck[at] = null;
          show(at, { count: false });
        };
        try {
          ladder = createAdaptiveSession({
            cfg: () => ({ ...cfg, review: 'off', aiWrite: 'off' }),
            bankFor: () => ladderBank,
            store, rand, now,
            // VERY EASY MOVED EVERY LEVEL NUMBER UP ONE (above): ratings read on Trivia's scale, and a row saved
            // before it has its floor moved up once.
            rating: TRIVIA_RATING, rowVersion: TRIVIA_LEVELS_VERSION, upgradeRow: upgradeTriviaRow,
            personId: () => ctx.personId || null,
            // "Start trivia at": the person's own; on a screen with no person, the panel's, for its one player.
            // Their own word; else, following, their usual starting level.
            startFor: (pid) => {
              if (ctx.personId && pid === `person:${ctx.personId}`) {
                return difficultyLevel(followsGames() ? gamesStartNow() : personStartNow());
              }
              if (pid === 'player') return difficultyLevel(rawPersonStart);
              return otherStart(pid);   // players: somebody else picked from this login
            },
            // Following their usual start, a change to it starts them again here too (adaptive_play.js `startMark`).
            startMark: (pid) => (ctx.personId && pid === `person:${ctx.personId}` ? (followsGames() ? gamesMarkNow() : null)
              : otherMark(pid)),
            playersHost: ctx.screenPlayers || null,   // players: the screen's players (player_picker.js)
            onChange: () => firstAgain(),
          });
        } catch (err) { ladder = null; console.error('trivia: no ladder', err); }
        // players: somebody picked (here, or on the screen's Players tab) has their own row read in when they join.
        firstAgainNow = firstAgain;
        triviaPlayersMoved();
        try { offScreenPlayers = ctx.screenPlayers?.subscribe?.(() => { if (!dead) triviaPlayersMoved(); }) || null; } catch { offScreenPlayers = null; }
        // The person's row loads with the ladder (splitLadderStore.load); once it is in, the menu's copy of their
        // "Start trivia at" is brought in line with it (the person's row is the truth).
        if (splitStore && ctx.personId) {
          const pid = `person:${ctx.personId}`;
          splitStore.ownReady(pid).then(() => { if (!dead) syncStartToPanel(); });
          // Their usual start is on another row, which may land after the ladder: the first question is picked
          // again from it, as it is when the ladder lands.
          const games = personHandles.get(ctx.personId)?.gamesReady;
          if (games) games.then(() => { if (!dead && followsGames() && gamesStartNow()) firstAgain(); });
        }
        // THE REVIEWS, where the host offers them (the kiosk: ctx.makePackReviews). Loaded once and polled
        // slowly; a deck already dealt is not reshuffled when they land — the next round reads them.
        try {
          reviews = typeof ctx.makePackReviews === 'function' ? ctx.makePackReviews() : null;
          if (reviews) {
            reviews.ready.then(() => { if (!dead) { reviews.startPolling?.(); readBank(); } });
            offReviews = bus.subscribe(REVIEW_TOPIC, () => { reviews?.reload?.(); });
          }
        } catch (err) { reviews = null; console.error('trivia: no pack reviews', err); }
        bus.subscribe(REVIEW_FLAG_TOPIC, () => reviewWrong());
        bus.subscribe(REVIEW_PASS_TOPIC, () => reviewFine());
        // Before anything renders, so the first render already knows whether a Scoreboard on this
        // screen is showing Trivia (a Scoreboard that is already here answers the source's ask).
        score = createScoreSource(bus, { source: GAME, label: 'Trivia: right answers',
          instance: ctx.instanceId || null, onShownChange: () => { if (q) render(); } });
        // FIRST, so the very first round is dealt without contested questions in it.
        try {
          contests = typeof ctx.makeEvents === 'function' ? createContests({ makeEvents: ctx.makeEvents, bus }) : null;
          // Another panel on this screen contested something: fetch now; it applies from the next round.
          if (contests) bus.subscribe(CONTEST_TOPIC, () => { contests.load().catch(() => {}); });
        } catch (err) { contests = null; console.error('trivia: no contests log', err); }
        // Both streams, exactly as `wordforge` opens them — same constructors, same arguments,
        // so the points board and the progress dashboard pick this game up with no wiring at all.
        try { ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus }); }
        catch (err) { ledger = null; console.error('trivia: no points ledger', err); }
        // REVIEW POINTS (../review_points.js, Mike 2026-10-06): a ✓ / ✗ here, and opening a question's source, pay
        // THIS screen's points the way a right answer does — once per question. The reviews handle owns it, and its
        // destroy() (below) takes it off again.
        if (reviews && ledger) { try { reviews.payInto?.({ ledger, makeState: ctx.makeState, root: mount }); } catch (err) { console.error('trivia: review points', err); } }
        try {
          telemetry = createTelemetry({ makeEvents: ctx.makeEvents, bus });
          session = telemetry.session({ game: GAME, mode: 'practice' });
          telemetry.load().catch(() => {});
        } catch (err) { telemetry = null; console.error('trivia: no telemetry', err); }

        // Scan with `next`, choose with `select` — so the whole game is one button. After an
        // answer the same two verbs walk and press the post-answer stops (Next, then the contest).
        // *** Mike, 2026-09-29: after an answer, Next goes to the NEXT QUESTION (the transport bar's
        // Next included) — it no longer steps onto the contest stop. `prev` walks the two post-answer
        // stops instead, and `select` presses whichever is lit, so a switch still reaches Contest.
        // Each of them is the player's press, so each opens the voice (SPEECH: the first press is the start).
        bus.subscribe('trivia/next', () => {
          const fresh = openVoice();
          return answered === null ? moveHighlight(1, { fresh }) : advance();
        });
        bus.subscribe('trivia/prev', () => {
          const fresh = openVoice();
          return answered === null ? moveHighlight(-1, { fresh }) : moveAfter(-1);
        });
        bus.subscribe('trivia/select', () => { openVoice(); return answered === null ? choose(highlight) : pressAfter(); });
        bus.subscribe('trivia/skip', () => { openVoice(); advance(); });

        // Named so destroy() can take it off again: the mount is the HOST's element, and a host
        // that reuses it for the next module must not inherit a Trivia click handler.
        onClick = (e) => {
          const t = e.target.closest('button');
          if (!t) return;
          // The player's taps open the voice; the reviewer's ✓ / ✗ / Save note below do not (SPEECH).
          if (t.dataset.opt != null) { openVoice(); return choose(Number(t.dataset.opt)); }
          if (t.hasAttribute('data-next')) { openVoice(); return advance(); }
          if (t.hasAttribute('data-contest')) { openVoice(); return contest(); }
          if (t.hasAttribute('data-review-fine')) return reviewFine();
          if (t.hasAttribute('data-review-wrong')) return reviewWrong();
          if (t.hasAttribute('data-review-save')) return saveReviewNote();
          return undefined;
        };
        mount.addEventListener('click', onClick);

        // THE SHARED ROW, opened by name — the same document the Questions module edits and
        // Word Forge reads. A game's own state still wins where somebody set it, so nothing
        // written before this changes meaning.
        try {
          sharedBank = ctx.makeState ? ctx.makeState(BANK_STATE) : null;
          if (sharedBank) {
            sharedBank.load().catch(() => {}).then(() => { if (dead) return; readBank(); sharedBank.startPolling?.(); });
            sharedBank.subscribe?.(() => readBank());
          }
        } catch (err) { sharedBank = null; console.error('trivia: no shared bank', err); }
        // WHATEVER A LESSON PACK HAS ROUTED HERE — a second, independent, per-profile row a
        // Lessons instance elsewhere on this screen owns entirely (see lessons.js's own
        // comment on TRIVIA_LESSON_QUESTIONS). Polled and subscribed the same as the shared
        // bank, so a topic unlocking or a caregiver switching lesson packs reaches an
        // already-open Trivia panel without a remount.
        try {
          lessonQ = ctx.makeState ? ctx.makeState(TRIVIA_LESSON_QUESTIONS) : null;
          if (lessonQ) {
            lessonQ.load().catch(() => {}).then(() => { if (dead) return; readBank(); lessonQ.startPolling?.(); });
            lessonQ.subscribe?.(() => readBank());
          }
        } catch (err) { lessonQ = null; console.error('trivia: no lesson-routed questions', err); }
        // An edit on the same screen lands without a remount, so somebody can write questions
        // beside somebody else playing them.
        bus.subscribe(BANK_TOPIC, () => { sharedBank?.load?.().catch(() => {}).then(readBank); });

        state?.subscribe?.((s) => {
          const snap = s || {};
          cfg = { ...DEFAULTS, ...snap };
          // "Start trivia at", changed in the menu (not the first read, and not the copy syncStartToPanel wrote).
          const rs = snap[PERSON_START_KEY];
          if (!seenRawStart) { seenRawStart = true; rawPersonStart = rs; }
          else if (rs !== rawPersonStart) {
            rawPersonStart = rs;
            if (START_CHOICES.includes(rs)) applyPersonStart(rs).catch((err) => console.error('trivia: start', err));
          }
          topics = Array.isArray(snap.topics) && snap.topics.length ? snap.topics : DEFAULT_TOPICS;
          triviaPlayersMoved();   // players
          readBank();
        });
        // *** AN EMPTIED BANK STAYS EMPTIED. ***
        // This used to re-seed whenever the bank came out empty, which meant somebody who had
        // deliberately cleared the demo questions got them all back — their syllabus replaced by
        // mine, silently, every time the module mounted. The seed is for a profile that has
        // never had a bank, which is `bankText` being ABSENT, not `bankText` parsing to nothing.
        // Caught by a test that set the bank to a single comment line.
        if (!state?.subscribe) { bank = triviaPool(SEED); newRound(); }

        // *** THE FIRST ROUND WAITS FOR THE UNLOCK LOG, THE SAME FIX WORD FORGE NEEDED. ***
        // `state.subscribe` above fires its own `readBank` -> `applyBank` -> `newRound()`
        // SYNCHRONOUSLY if state is already loaded, well before this `lessons.load()` (a real
        // network fetch) has any chance to resolve — so that first `newRound()` always sees an
        // EMPTY unlocked set and deals a deck missing every gated question, non-empty just
        // wrong. UNCONDITIONAL, not guarded behind `if (!deck.length)`: once the unlock log is
        // actually in, the deck is rebuilt regardless of what an earlier, necessarily-incomplete
        // build already produced (0b, "lessons/wordforge deck doesn't grow on unlock").
        // *** MODE LOADS ALONGSIDE LESSONS, IN THE SAME PROMISE CHAIN, FOR THE SAME REASON. ***
        // `mode`'s default (sandbox) is the OPPOSITE risk from `lessons`'s (quest-strict): a
        // round dealt before `mode.load()` resolves would read "not sandbox" and gate as quest
        // even for a profile that has actually chosen sandbox, then narrow-then-widen once the
        // real value is in — the mirror image of the already-fixed "first round ignores the
        // unlock log" bug (0b). Both loads gate the one unconditional rebuild below.
        try {
          lessons = createLessons({ makeEvents: ctx.makeEvents, bus });
          mode = ctx.makeState ? createQuestMode({ makeState: ctx.makeState }) : null;
          // `if (!dead)` on each: a load that lands after destroy() must not restart a poll that
          // destroy() already stopped (see `dead`).
          Promise.all([
            lessons.load().then(() => { if (!dead) lessons.startPolling(); }).catch(() => {}),
            mode ? mode.load().then(() => { if (!dead) mode.startPolling(); }).catch(() => {}) : Promise.resolve(),
            // The contests log gates the deck the same way, so it joins the same wait.
            contests ? contests.load().then(() => { if (!dead) contests.startPolling(); }).catch(() => {}) : Promise.resolve(),
          ]).then(() => { if (!dead) newRound(); });
          // A lesson finished elsewhere — the new questions join the pool at the START of the
          // next round, not mid-question (same rule Word Forge follows for the same reason).
          bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });
          // A mode switched elsewhere (the settings module, another device) reaches here on
          // `mode`'s own poll (`startPolling()` above) with no extra wiring — every `newRound()`
          // reads `mode.isSandbox()` fresh, the same way it already reads `lessons.unlocked()`
          // fresh, so nothing needs to force a rebuild the moment the poll lands.
        } catch (err) { lessons = null; mode = null; console.error('trivia: no lessons handle', err); }
      },
      onResize() {},
      onHide() { state?.flush?.(); },
      destroy() {
        dead = true;
        recorder = null;
        // A line still queued or being said goes with the panel.
        try { if (lastSpeech && typeof ctx.output?.cancel === 'function') ctx.output.cancel(lastSpeech); } catch { /* gone */ }
        lastSpeech = null;
        if (onClick) { mount.removeEventListener('click', onClick); onClick = null; }
        if (score) { score.destroy(); score = null; }
        if (contests) { contests.destroy(); contests = null; }
        if (reviews) { reviews.destroy?.(); reviews = null; }
        if (offReviews) { try { offReviews(); } catch { /* a bus without unsubscribe */ } offReviews = null; }
        if (lessons) { lessons.destroy(); lessons = null; }
        if (mode) { mode.destroy(); mode = null; }
        // THE TWO THAT LEAKED (see `dead`): rows this module opened itself, polling until now.
        if (sharedBank) { sharedBank.destroy?.(); sharedBank = null; }
        if (lessonQ) { lessonQ.destroy?.(); lessonQ = null; }
        // The ladder's row is opened here too (init), so it goes the same way. Saved on every answer already.
        if (ladder) { ladder.destroy(); ladder = null; }
        if (offScreenPlayers) { try { offScreenPlayers(); } catch { /* gone */ } offScreenPlayers = null; }   // players
        if (splitStore) { splitStore.destroy(); splitStore = null; }
        if (ladderStore) { ladderStore.flush?.(); ladderStore.destroy?.(); ladderStore = null; }
        // ...and the person's own row (THE LEVEL FOLLOWS THE PERSON), opened here too.
        for (const { handle, off, games } of personHandles.values()) {
          try { off?.(); } catch { /* none */ }
          try { handle?.flush?.(); handle?.destroy?.(); } catch { /* gone */ }
          try { games?.destroy?.(); } catch { /* gone (read only: nothing to flush) */ }
        }
        personHandles.clear();
        // And the two streams Word Forge already closed and Trivia never did.
        if (ledger) { ledger.destroy?.(); ledger = null; }
        if (telemetry) { telemetry.destroy?.(); telemetry = null; }
      },
    };
  },
);
