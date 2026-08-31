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
// **There is no recogniser yet, and this does not pretend otherwise.** Today it is answered by
// pointer or by switch. What it also does — when a recorder is handed to it — is MARK the audio
// at every question with what was asked and what was chosen. So the labelled corpus builds
// itself while somebody plays a game they wanted to play, and the recogniser that needs it can
// arrive afterwards to find the data already there.
//
// *** AND THE ONE THING A MARK MUST NOT SAY. *** It records the question and the button. It does
// NOT claim what anybody said out loud — nobody knows that, and a fabricated label in training
// data is worse than no label, because it is confidently wrong in a file nobody re-checks. See
// `recorder.js`.
//
// **The rule for when a recogniser DOES arrive**, written down now so it is not discovered late:
// a recognition failure must never be scored as a wrong answer. She knows the answer is Paris,
// says Paris, the recogniser is unsure — marking that wrong tells her she does not know
// something she does, *because of her speech*, which is the judgment the trivia framing was
// chosen to avoid. It comes straight back in through the side door, harder to see because the
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
// Lines beginning `#` are comments, so a bank can be organised and annotated by whoever owns it.

import { registerModule } from '../module.js';
import { createPointsLedger } from '../points.js';
import { createTelemetry } from '../telemetry.js';

export const GAME = 'trivia';

export const DEFAULTS = {
  roundLength: 10,
  correctPoints: 2,
  tryingPoints: 1,        // for reading the answer after getting it wrong — the correction is
                          // the point of a learning game, so the correction is what pays
  choices: 4,
  // RECORDING IS OFF UNLESS SOMEBODY TURNED IT ON. A game that quietly opened a microphone
  // because it might be useful later would be exactly the thing this project does not do.
  record: false,
};

// `question | answer | wrong | wrong | wrong | topic?`
// Exported and pure, so a bank can be checked without mounting anything — and so the settings
// screen and the game cannot disagree about what a line means.
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
What colour do you get mixing blue and yellow? | Green | Purple | Orange | Brown
Which ocean is the largest? | Pacific | Atlantic | Indian | Arctic`;

registerModule(
  { type: 'trivia', title: 'Trivia',
    description: 'A quiz over questions you write yourself. Answerable with one switch.',
    dependsOn: 'none', importance: 'optional' },
  (ctx) => {
    const { mount, bus, state, events } = ctx;
    const rand = ctx.rand || Math.random;

    let cfg = { ...DEFAULTS };
    let bank = [];
    let deck = [];
    let at = 0;
    let q = null;
    let highlight = 0;          // which option a scanning switch is pointed at
    let answered = null;        // the index chosen, or null
    let streak = 0;
    let ledger = null, telemetry = null, session = null;
    let recorder = ctx.recorder || null;

    const el = (s) => mount.querySelector(s);

    function render() {
      if (!q) {
        mount.innerHTML = `<div class="tv"><p class="tv-empty">No questions yet. Add some in
          settings — one per line: <code>question | answer | wrong | wrong | wrong</code></p></div>`;
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
              const wrong = done && i === answered && i !== q.correctIndex;
              return `<li>
                <button type="button" class="tv-opt" data-opt="${i}"
                  ${i === highlight ? 'data-on="1"' : ''}
                  ${right ? 'data-right="1"' : ''}${wrong ? 'data-wrong="1"' : ''}
                  ${done ? 'disabled' : ''}>${esc(o)}</button></li>`;
            }).join('')}
          </ol>
          ${done ? `<p class="tv-said">${answered === q.correctIndex
              ? 'Correct.'
              : `The answer was <b>${esc(q.answer)}</b>.`}</p>
            <button type="button" class="tv-next" data-next>Next question</button>` : ''}
        </div>`;
    }

    function show(i) {
      at = Math.max(0, Math.min(deck.length - 1, i));
      q = makeQuestion(deck[at], bank, { choices: cfg.choices, rand });
      answered = null;
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
      highlight = ((highlight + delta) % n + n) % n;
      render();
    }

    function choose(i) {
      if (!q || answered !== null) return;
      answered = Number(i);
      const correct = answered === q.correctIndex;
      streak = correct ? streak + 1 : 0;

      // The corpus label: what was ASKED and what was PRESSED. Never a claim about what was
      // said aloud — see the header, and `recorder.js`.
      recorder?.mark?.(q.answer, {
        event: 'answered', question: q.question,
        chose: q.options[answered], correct,
      });

      if (correct) {
        // `source` is what the totals group by, so it is the game's name and nothing else.
        Promise.resolve(ledger?.award?.({ amount: cfg.correctPoints, source: GAME,
                                          note: q.question }))
          .catch((err) => console.error('trivia: points', err));
      }
      // The measurement stream, exactly as wordforge writes it, so the progress dashboard picks
      // this up with no wiring: `concept` is the ANSWER, so "which things does she know" is a
      // question the existing dashboard can already answer.
      Promise.resolve(telemetry?.log?.({
        game: GAME, session, mode: 'practice', concept: q.answer,
        responded: true, correct, prompt: q.question,
      })).catch((err) => console.error('trivia: telemetry', err));
      render();
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
      __probe: () => ({ at, answered, highlight, streak, deck: deck.length,
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

        state?.subscribe?.((s) => {
          cfg = { ...DEFAULTS, ...(s || {}) };
          const next = Array.isArray(cfg.bank) ? cfg.bank
                     : parseBank(cfg.bankText != null ? cfg.bankText : SEED);
          const changed = next.length !== bank.length;
          bank = next;
          if (!deck.length || changed) newRound();
        });
        // *** AN EMPTIED BANK STAYS EMPTIED. ***
        // This used to re-seed whenever the bank came out empty, which meant somebody who had
        // deliberately cleared the demo questions got them all back — their syllabus replaced by
        // mine, silently, every time the module mounted. The seed is for a profile that has
        // never had a bank, which is `bankText` being ABSENT, not `bankText` parsing to nothing.
        // Caught by a test that set the bank to a single comment line.
        if (!state?.subscribe) { bank = parseBank(SEED); newRound(); }
      },
      onResize() {},
      onHide() { state?.flush?.(); },
      destroy() { recorder = null; },
    };
  },
);
