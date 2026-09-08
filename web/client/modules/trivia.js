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
import { triviaPool } from '../bank.js';
import { BANK_STATE, BANK_TOPIC } from './bank.js';
import { loadPack } from '../packs.js';
import { packsFor, packById } from '../pack_library.js';

export const GAME = 'trivia';

export const DEFAULTS = {
  roundLength: 10,
  // *** A SCORE ON SCREEN, OFF BY DEFAULT. See the SETTINGS row, which carries the correction
  // to what this file used to claim Mike had said. ***
  showScore: false,
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
  // *** A READY-MADE PACK, NOT JUST A WRITTEN BANK. *** PRIORITY.md #5 / MIKE_CHANGE_LIST D26:
  // "questions must be hand-authored... which defeats the game, since the author knows the
  // answers." `bank` (unchanged, still the default) stays what it was; `pack` is additive — a
  // built-in, pre-written syllabus for somebody who has nobody to write one. See `PACK_LIBRARY`.
  contentSource: 'bank',
  packId: packsFor('trivia')[0]?.id || null,
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
      // A trailing field that is not a plausible distractor is read as a topic. Being generous
      // here matters: somebody hand-writing a hundred lines will not be consistent, and a bank
      // that silently drops a third of its rows because of a spacing habit is infuriating to
      // debug and looks like the game is broken.
      const wrong = rest.filter(Boolean);
      const item = { question, answer, wrong };
      return item;
    });
}

// A `nimrod.pack.v1` trivia item is `{question, answers[], correct, difficulty?}`; this bank's
// shape is `{question, answer, wrong[]}` — same information, different field names, because the
// pack schema names the CORRECT one out of a set while a bank writes the wrong ones directly.
// `answers` includes `correct` (packs.js requires it), so `wrong` is everything else in order —
// which matters for `makeQuestion`'s degrading-option rule below: a pack's distractors are
// somebody's real, written wrong answers, exactly like a bank's, never generated here.
export function packToTriviaBank(pack) {
  return (pack.items || []).map((it) => ({
    question: it.question,
    answer: it.correct,
    wrong: (it.answers || []).filter((a) => a !== it.correct),
  }));
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
  return { question: item.question, answer: item.answer, options,
           correctIndex: options.indexOf(item.answer) };
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

const SETTINGS = [
  ...(TRIVIA_PACKS.length ? [
    { key: 'contentSource', label: 'Where questions come from', kind: 'choice', default: 'bank',
      level: 'standard',
      options: [{ value: 'bank', label: 'Written questions + word bank' },
                { value: 'pack', label: 'A built-in pack' }],
      note: 'A pack is ready-made — nobody has to write questions first, and nobody playing '
        + 'already knows the answers.' },
    { key: 'packId', label: 'Which pack', kind: 'choice', default: TRIVIA_PACKS[0].id,
      level: 'standard',
      options: TRIVIA_PACKS.map((p) => ({ value: p.id, label: p.label })) },
  ] : []),
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
  // *** OFF BY DEFAULT ANYWAY, and that is not hedging. *** `comet` already carries exactly
  // this row with exactly this default, for the same reason: a screen somebody cannot walk away
  // from should not keep a running tally in front of them unless somebody decided it should.
  // Matching an existing precedent rather than inventing a second answer to one question.
  { key: 'showScore', label: 'Score', default: false, level: 'essential',
    onLabel: 'Show how many are right so far', offLabel: 'No score on screen',
    note: 'How many trivia answers were right — never anything about how somebody spoke.' },
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

    const el = (s) => mount.querySelector(s);

    function render() {
      if (!q) {
        // *** THE LINK BACK. *** A tab is discoverable by existing; a module is not, and this
        // is where that cost is paid. When there is nothing to ask, the game says exactly where
        // questions come from and what to add — loudest at the moment somebody most needs it.
        mount.innerHTML = `<div class="tv"><div class="tv-empty">
          <p><b>No questions yet.</b></p>
          <p>These come from your bank — the <b>Questions</b> module. Add it to this screen and
            write some, and anything you write there shows up here.</p>
          <p class="tv-fmt">One per line:
            <code>question | answer | wrong | wrong | wrong</code></p>
        </div></div>`;
        return;
      }
      const done = answered !== null;
      mount.innerHTML = `
        <div class="tv">
          <p class="tv-count">${at + 1} of ${deck.length}${cfg.showScore
            ? ` <span class="tv-score">· ${rightCount} right</span>` : ''}</p>
          <h3 class="tv-q">${esc(q.question)}</h3>
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
                  ${done || wrong ? 'disabled' : ''}>${esc(o)}</button></li>`;
            }).join('')}
          </ol>
          ${done
            ? `<p class="tv-said">Correct.</p>
               <button type="button" class="tv-next" data-next>Next question</button>`
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
        </div>`;
    }

    function show(i) {
      // Counted when a question GOES UP, not when it is answered: a question somebody walked
      // away from was still asked, and a tally that only counted finished ones would read
      // "3 of 3" on a round with two abandoned questions in it.
      askedCount += 1;
      at = Math.max(0, Math.min(deck.length - 1, i));
      q = makeQuestion(deck[at], bank, { choices: cfg.choices, rand });
      answered = null;
      misses = [];
      askedAt = now();
      highlight = 0;
      render();
      // *** THE MARK GOES IN AT THE MOMENT THE QUESTION APPEARS ***, not when it is answered,
      // because the audio that matters is what happens between the two.
      recorder?.mark?.(q ? q.answer : '', { event: 'asked', question: q?.question || '' });
    }

    // ONE SWITCH, WALKED IN ONE DIRECTION, WRAPPING — the rule from module-input-spec, and the
    // reason a quiz is reachable at all for somebody with one button. A highlight that stopped
    // at the last option would strand them there.
    function moveHighlight(delta) {
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
    function worth(spent) {
      const full = Number(cfg.correctPoints);
      const max = Number.isFinite(full) ? full : 1;
      // A QUARTER OF THE MAXIMUM PER GUESS, floored at a quarter -- so a four-choice question
      // pays 1, 0.75, 0.5, 0.25 and never nothing. Derived from `max` rather than hardcoded, so
      // somebody who prices a question at 2 gets 2 / 1.5 / 1 / 0.5 and the same shape.
      const step = max / 4;
      return Math.max(step, max - step * spent);
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
        if (misses.includes(highlight)) moveHighlight(1); else render();
        return;
      }

      answered = chosen;
      rightCount += 1;
      // A first-guess answer extends the streak; one found after a miss does not, because
      // `streak` was already reset above on the press that missed.
      if (!misses.length) streak += 1;
      // `source` is what the totals group by, so it is the game's name and nothing else.
      Promise.resolve(ledger?.award?.({ amount: worth(misses.length), source: GAME,
                                        note: q.question }))
        .catch((err) => console.error('trivia: points', err));
      render();
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
    async function readBank() {
      const gen = ++bankGen;
      if (cfg.contentSource === 'pack' && cfg.packId) {
        try {
          const pack = await loadPackCached(cfg.packId);
          if (gen !== bankGen) return;         // superseded while the fetch was in flight
          applyBank(packToTriviaBank(pack));
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
      if (gen === bankGen) applyBank(next);
    }

    function applyBank(next) {
      const changed = next.length !== bank.length;
      bank = next;
      if (!deck.length || changed) newRound();
    }

    function advance() {
      if (at + 1 < deck.length) show(at + 1);
      else newRound();
    }

    function newRound() {
      deck = buildDeck(bank, { roundLength: cfg.roundLength, rand });
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
        highlight, streak, deck: deck.length,
                        question: q ? { ...q } : null, bank: bank.length }),
      init() {
        // Both streams, exactly as `wordforge` opens them — same constructors, same arguments,
        // so the points board and the progress dashboard pick this game up with no wiring at all.
        try { ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus }); }
        catch (err) { ledger = null; console.error('trivia: no points ledger', err); }
        try {
          telemetry = createTelemetry({ makeEvents: ctx.makeEvents, bus });
          session = telemetry.session({ game: GAME, mode: 'practice' });
          telemetry.load().catch(() => {});
        } catch (err) { telemetry = null; console.error('trivia: no telemetry', err); }

        // Scan with `next`, choose with `select` — so the whole game is one button.
        bus.subscribe('trivia/next', () => (answered === null ? moveHighlight(1) : advance()));
        bus.subscribe('trivia/prev', () => moveHighlight(-1));
        bus.subscribe('trivia/select', () => (answered === null ? choose(highlight) : advance()));
        bus.subscribe('trivia/skip', () => advance());

        mount.addEventListener('click', (e) => {
          const t = e.target.closest('button');
          if (!t) return;
          if (t.dataset.opt != null) return choose(Number(t.dataset.opt));
          if (t.hasAttribute('data-next')) return advance();
          return undefined;
        });

        // THE SHARED ROW, opened by name — the same document the Questions module edits and
        // Word Forge reads. A game's own state still wins where somebody set it, so nothing
        // written before this changes meaning.
        try {
          sharedBank = ctx.makeState ? ctx.makeState(BANK_STATE) : null;
          if (sharedBank) {
            sharedBank.load().catch(() => {}).then(() => { readBank(); sharedBank.startPolling?.(); });
            sharedBank.subscribe?.(() => readBank());
          }
        } catch (err) { sharedBank = null; console.error('trivia: no shared bank', err); }
        // An edit on the same screen lands without a remount, so somebody can write questions
        // beside somebody else playing them.
        bus.subscribe(BANK_TOPIC, () => { sharedBank?.load?.().catch(() => {}).then(readBank); });

        state?.subscribe?.((s) => {
          cfg = { ...DEFAULTS, ...(s || {}) };
          readBank();
        });
        // *** AN EMPTIED BANK STAYS EMPTIED. ***
        // This used to re-seed whenever the bank came out empty, which meant somebody who had
        // deliberately cleared the demo questions got them all back — their syllabus replaced by
        // mine, silently, every time the module mounted. The seed is for a profile that has
        // never had a bank, which is `bankText` being ABSENT, not `bankText` parsing to nothing.
        // Caught by a test that set the bank to a single comment line.
        if (!state?.subscribe) { bank = triviaPool(SEED); newRound(); }
      },
      onResize() {},
      onHide() { state?.flush?.(); },
      destroy() { recorder = null; },
    };
  },
);
