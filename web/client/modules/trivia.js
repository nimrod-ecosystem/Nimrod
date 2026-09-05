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

export const GAME = 'trivia';

export const DEFAULTS = {
  roundLength: 10,
  correctPoints: 2,
  tryingPoints: 1,        // for reading the answer after getting it wrong — the correction is
                          // the point of a learning game, so the correction is what pays
  choices: 4,
  // *** DRAW ON THE WORD BANK TOO (Mike, 2026-08-31: "I could see word forge and trivia drawing
  // from the same pool for a lot of people"). *** A vocabulary row already contains everything a
  // multiple-choice question needs, so somebody who wrote sixty words does not have to write
  // sixty questions as well. Written questions still come first — see `bank.js`.
  includeWords: true,
  // RECORDING IS OFF UNLESS SOMEBODY TURNED IT ON. A game that quietly opened a microphone
  // because it might be useful later would be exactly the thing this project does not do.
  record: false,
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
const SETTINGS = [
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
  { key: 'correctPoints', label: 'Points for a right answer', kind: 'number', default: 2,
    level: 'advanced', min: 0, max: 10, step: 1 },
  // Deliberately worth something: the correction is the point of a learning game, so the
  // correction is what pays. Zero here prices reading the answer at nothing.
  { key: 'tryingPoints', label: 'Points for reading the answer after a miss', kind: 'number',
    default: 1, level: 'advanced', min: 0, max: 10, step: 1 },
];

registerModule(
  { type: 'trivia', title: 'Trivia',
    description: 'A quiz over questions you write yourself. Answerable with one switch.',
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events } = ctx;
    const rand = ctx.rand || Math.random;

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
          <p class="tv-count">${at + 1} of ${deck.length}</p>
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
            // NOT "the answer was X", and NO score on screen. The question is still open, so
            // telling them the answer would end it for them; and the header of this file
            // records Mike's position that a patient-facing score is the thing to avoid. What
            // partial credit is worth goes to the ledger, not to the person guessing.
            : (misses.length
              ? '<p class="tv-said">Not that one — try again.</p>'
              : '')}
        </div>`;
    }

    function show(i) {
      at = Math.max(0, Math.min(deck.length - 1, i));
      q = makeQuestion(deck[at], bank, { choices: cfg.choices, rand });
      answered = null;
      misses = [];
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
      return Math.max(Number(cfg.tryingPoints) || 0,
                      (Number(cfg.correctPoints) || 0) - spent);
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
    function readBank() {
      const own = cfg.bankText;
      const share = (sharedBank?.get?.() || {}).bankText;
      const text = own != null ? own : (share != null ? share : SEED);
      const next = Array.isArray(cfg.bank) ? cfg.bank
                 : triviaPool(text, { includeWords: cfg.includeWords !== false, choices: cfg.choices });
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
      __probe: () => ({ at, answered, misses: [...misses], worth: worth(misses.length),
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
