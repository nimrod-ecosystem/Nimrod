// wordforge.js — the first GAME, and the first thing that writes to BOTH streams.
//
// A vocabulary game over a word bank. Three round types:
//   define  — here's a word, which meaning is it?
//   blank   — here's a sentence with a hole, which word fills it?
//   better  — two sentences, which one is better writing? (and why)
//
// WRONG ANSWERS PAY, AND THEY EXPLAIN. A wrong answer is not worth zero: it shows the
// right answer with the reason, and awards a smaller "for trying" amount when the player
// acknowledges the explanation. The point of a learning game is the correction, so the
// correction is the thing that is rewarded — not merely being wrong. Being wrong and
// clicking past it earns nothing until "Got it" is pressed, and each item appears once
// per round, so there is no wrong-answer farm to run.
//
// IT FEEDS BOTH STREAMS, which is the whole reason it exists as the first game:
//   points.js     -> the ECONOMY. An award per answer, so the quest board's balance moves.
//   telemetry.js  -> the MEASUREMENT. One trial per answer, with `concept` set to the WORD,
//                    so the progress dashboard can say which words he is getting and which
//                    he is struggling with — and, over sessions, whether that is improving.
// Neither stream knows about the other; this module simply writes to both, and the two
// dashboards pick it up with no wiring.
//
// CONTENT IS DATA. The word bank lives in per-profile state in the documented line format
// (`word | meaning | sentence`, and `better || weaker || why`), so it is editable — and in
// this curriculum, modding the bank is itself an assignment.
//
// TESTABILITY: ctx.rand (default Math.random) makes the deck and the distractors
// deterministic in tests, the same injection pattern director.js uses.

import { registerModule } from '../module.js';
import { createPointsLedger } from '../points.js';
import { createTelemetry } from '../telemetry.js';

export const GAME = 'wordforge';

// Seeded from the word bank in the documented format. Editable per profile.
export const DEFAULT_WORDS = [
  ['obsolete', 'no longer used because something newer exists', 'The old phone became obsolete the moment the new model shipped.'],
  ['refurbish', 'to clean up and repair something so it works like new', 'Volunteers refurbish old laptops and give them to families who need them.'],
  ['salvage', 'to save something usable from what would be thrown out', 'He managed to salvage the hard drive from the broken computer.'],
  ['tolerance', "the tiny allowed difference between a part's real size and its target", "If the tolerance is too tight, the printed parts won't fit together."],
  ['proportion', 'the relationship in size between two things', 'He kept the desk organizer in proportion so it matched his monitor.'],
  ['persuade', 'to convince someone to do or believe something', 'She wrote a letter to persuade the council to support the repair law.'],
  ['civic', 'relating to a city and the duties of its citizens', 'Voting is a basic civic responsibility.'],
  ['surplus', 'more than what is needed; extra', 'The company had a surplus of old monitors it planned to scrap.'],
  ['initiative', 'the drive to do something without being told', 'He showed initiative by building a tool that logged his points automatically.'],
  ['concise', 'saying a lot in few words', 'Her concise answer made the point without wasting a sentence.'],
  ['deliberate', 'done on purpose, carefully considered', 'Planned obsolescence is a deliberate choice, not an accident.'],
  ['tedious', 'boring and slow because it takes a long time', 'Copying the numbers by hand was tedious, so he wrote a script.'],
].map(([word, meaning, sentence]) => ({ word, meaning, sentence }));

export const DEFAULT_PAIRS = [
  ['Refurbished laptops give low-income families affordable computers.',
   "Refurbished laptops are a thing families who don't have much money can use to get computers that don't cost a lot.",
   'The first is concise; the second is wordy and repeats itself.'],
  ['He salvaged the drive and installed it in another machine.',
   'He salvaged the drive, and he installed it, into another machine.',
   'The second has a comma splice and an extra comma; the first flows.'],
  ['The council listened because her argument was specific and backed by numbers.',
   'The council listened because her argument was good and had stuff in it.',
   '"Specific and backed by numbers" says something real; "good and had stuff" is vague.'],
  ['Planned obsolescence keeps working devices out of circulation.',
   "Planned obsolescence is when they make it so working devices don't stay around to get used.",
   'The first is tight and precise; the second rambles.'],
].map(([better, weaker, why]) => ({ better, weaker, why }));

export const DEFAULTS = {
  correctPoints: 10,   // a right answer
  tryPoints: 3,        // a wrong answer, once the explanation is acknowledged
  streakEvery: 5,      // a bonus every N correct in a row
  streakBonus: 5,
  roundLength: 10,     // items per round; each appears at most once
};

export const CONCEPT_PAIRS = 'sentence quality';

// ---------- pure helpers ----------

// Fisher–Yates with an injectable rand, so a test can pin the order.
export function shuffle(items, rand = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A round is a shuffled mix of word items (two kinds) and sentence pairs, capped at
// roundLength, with each source item used at most once.
export function buildDeck(words, pairs, { roundLength = DEFAULTS.roundLength, rand = Math.random } = {}) {
  const items = [
    ...words.map((w) => ({ kind: rand() < 0.5 ? 'define' : 'blank', word: w })),
    ...pairs.map((p) => ({ kind: 'better', pair: p })),
  ];
  return shuffle(items, rand).slice(0, roundLength);
}

// Turn one deck item into a question: prompt, options, which is right, what concept it
// exercises, and the explanation shown when it is missed.
export function makeQuestion(item, words, rand = Math.random) {
  if (item.kind === 'better') {
    const p = item.pair;
    const opts = rand() < 0.5 ? [p.better, p.weaker] : [p.weaker, p.better];
    return {
      kind: 'better',
      prompt: 'Which sentence is better writing?',
      options: opts,
      answer: opts.indexOf(p.better),
      concept: CONCEPT_PAIRS,
      explain: p.why,
    };
  }

  const w = item.word;
  const others = shuffle(words.filter((x) => x.word !== w.word), rand).slice(0, 3);

  if (item.kind === 'blank') {
    // Blank the word out of its own sentence; the options are words.
    const hole = w.sentence.replace(new RegExp(w.word, 'i'), '_____');
    const opts = shuffle([w.word, ...others.map((o) => o.word)], rand);
    return {
      kind: 'blank',
      prompt: hole,
      options: opts,
      answer: opts.indexOf(w.word),
      concept: w.word,
      explain: `“${w.word}” means ${w.meaning}.`,
    };
  }

  const opts = shuffle([w.meaning, ...others.map((o) => o.meaning)], rand);
  return {
    kind: 'define',
    prompt: `What does “${w.word}” mean?`,
    options: opts,
    answer: opts.indexOf(w.meaning),
    concept: w.word,
    explain: `“${w.word}” means ${w.meaning}. For example: ${w.sentence}`,
  };
}

// What an answer is worth. A wrong answer is NOT zero — see the header.
export function scoreFor({ correct, streak = 0, cfg = DEFAULTS }) {
  if (!correct) return { base: cfg.tryPoints, bonus: 0, total: cfg.tryPoints };
  const bonus = (cfg.streakEvery > 0 && streak > 0 && streak % cfg.streakEvery === 0) ? cfg.streakBonus : 0;
  return { base: cfg.correctPoints, bonus, total: cfg.correctPoints + bonus };
}

// The documented line formats, so a profile's bank can be edited as text.
export function parseWords(text) {
  return String(text || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('|') && !l.includes('||'))
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter((p) => p.length >= 3 && p[0] && p[1])
    .map(([word, meaning, sentence]) => ({ word, meaning, sentence }));
}

export function parsePairs(text) {
  return String(text || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('||'))
    .map((l) => l.split('||').map((x) => x.trim()))
    .filter((p) => p.length >= 3 && p[0] && p[1])
    .map(([better, weaker, why]) => ({ better, weaker, why }));
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- the module ----------

registerModule(
  { type: 'wordforge', title: 'Word Forge', description: 'vocabulary game — wrong answers explain themselves and still count' },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;

    let ledger = null;
    let tel = null;
    let session = null;
    let words = DEFAULT_WORDS;
    let pairs = DEFAULT_PAIRS;
    let cfg = { ...DEFAULTS };

    let deck = [];
    let at = 0;
    let q = null;
    let streak = 0;
    let earned = 0;
    let answered = null;      // null = unanswered; else {picked, correct, award}
    let askedAt = 0;

    const el = (sel) => mount.querySelector(sel);

    function newRound() {
      deck = buildDeck(words, pairs, { roundLength: cfg.roundLength, rand });
      at = 0; streak = 0; earned = 0;
      next();
    }

    function next() {
      answered = null;
      if (at >= deck.length) { q = null; render(); return; }
      q = makeQuestion(deck[at], words, rand);
      askedAt = Date.now();
      render();
    }

    // Answering does three things: score it, record it in BOTH streams, and — when it's
    // wrong — hold the round open on the explanation until it's acknowledged.
    async function answer(i) {
      if (answered || !q) return;
      const correct = i === q.answer;
      if (correct) streak += 1; else streak = 0;
      const award = scoreFor({ correct, streak, cfg });
      answered = { picked: i, correct, award };
      render();

      // The MEASUREMENT: one trial, concept = the word, so Progress can rank what's hard.
      tel.log({
        game: GAME,
        session: session.id,
        mode: 'practice',
        concept: q.concept,
        responded: true,
        correct,
        latencyMs: Date.now() - askedAt,
        prompt: q.prompt,
      }).catch((e) => console.error('wordforge: telemetry', e));

      // The ECONOMY: a right answer pays now. A wrong one pays on "Got it" instead —
      // the points are for engaging with the correction, not for being wrong.
      if (correct) await bank(award, q.concept, 'correct');
    }

    async function bank(award, concept, note) {
      earned += award.total;
      try {
        await ledger.award({
          amount: award.total,
          mult: 1,
          type: 'Bonus',
          source: GAME,
          tags: ['wordforge', concept],
          note: `${note}: ${concept}`,
        });
      } catch (e) { console.error('wordforge: award', e); }
      render();
    }

    async function acknowledge() {
      if (!answered || answered.correct) return;
      const { award } = answered;
      answered.banked = true;
      await bank(award, q.concept, 'learned from a miss');
      at += 1;
      next();
    }

    function advance() {
      if (!answered) return;
      if (!answered.correct && !answered.banked) return acknowledge();
      at += 1;
      next();
    }

    // ---------- render ----------
    function render() {
      const host = el('[data-body]');
      if (!host) return;
      el('[data-score]').textContent = `${earned} this round`;
      el('[data-streak]').textContent = streak >= 2 ? `${streak} in a row` : '';
      el('[data-progress]').textContent = deck.length ? `${Math.min(at + 1, deck.length)} / ${deck.length}` : '';

      if (!q) {
        host.innerHTML = `
          <div class="wf-done">
            <div class="wf-done-n">${earned}</div>
            <p>points this round.</p>
            <button class="wf-btn wf-primary" data-again>Play again</button>
          </div>`;
        el('[data-again]').addEventListener('click', newRound);
        return;
      }

      const opts = q.options.map((o, i) => {
        let cls = 'wf-opt';
        if (answered) {
          if (i === q.answer) cls += ' is-right';
          else if (i === answered.picked) cls += ' is-wrong';
        }
        return `<button class="${cls}" data-opt="${i}" ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('');

      let feedback = '';
      if (answered) {
        feedback = answered.correct
          ? `<div class="wf-fb is-right">
               <b>Right.</b> +${answered.award.total}
               ${answered.award.bonus ? `<span class="wf-bonus">includes a +${answered.award.bonus} streak bonus</span>` : ''}
             </div>
             <button class="wf-btn wf-primary" data-next>Next</button>`
          // A miss is a teaching moment: the explanation, then the points for taking it in.
          : `<div class="wf-fb is-wrong">
               <b>Not quite.</b> ${esc(q.explain)}
               <span class="wf-try">+${answered.award.total} for the try — press “Got it” to bank it.</span>
             </div>
             <button class="wf-btn wf-primary" data-next>Got it</button>`;
      }

      host.innerHTML = `
        <p class="wf-kind">${q.kind === 'better' ? 'Which is better?' : q.kind === 'blank' ? 'Fill the blank' : 'What does it mean?'}</p>
        <p class="wf-prompt">${esc(q.prompt)}</p>
        <div class="wf-opts">${opts}</div>
        ${feedback}`;

      for (const b of host.querySelectorAll('[data-opt]')) {
        b.addEventListener('click', () => answer(Number(b.dataset.opt)));
      }
      const nx = host.querySelector('[data-next]');
      if (nx) nx.addEventListener('click', advance);
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="wordforge">
            <div class="wf-top">
              <span class="wf-score" data-score>0 this round</span>
              <span class="wf-streak" data-streak></span>
              <span class="wf-progress" data-progress></span>
            </div>
            <div class="wf-body" data-body></div>
          </div>`;

        ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus });
        tel = createTelemetry({ makeEvents: ctx.makeEvents, bus });
        session = tel.session({ game: GAME, mode: 'practice' });
        ledger.load().catch(() => {});
        tel.load().catch(() => {});

        // Anything on the bus can answer — a keypad, a switch, a companion.
        bus.subscribe('wordforge/answer', (i) => answer(Number(i)));
        bus.subscribe('wordforge/next', () => advance());

        state.subscribe((s) => {
          const snap = s || {};
          const w = Array.isArray(snap.words) ? snap.words : (snap.wordsText ? parseWords(snap.wordsText) : null);
          const p = Array.isArray(snap.pairs) ? snap.pairs : (snap.pairsText ? parsePairs(snap.pairsText) : null);
          words = (w && w.length >= 4) ? w : DEFAULT_WORDS;   // need 4 for a 4-way choice
          pairs = (p && p.length) ? p : DEFAULT_PAIRS;
          cfg = {
            correctPoints: Number(snap.correctPoints) > 0 ? Number(snap.correctPoints) : DEFAULTS.correctPoints,
            tryPoints: Number(snap.tryPoints) >= 0 ? Number(snap.tryPoints) : DEFAULTS.tryPoints,
            streakEvery: Number(snap.streakEvery) >= 0 ? Number(snap.streakEvery) : DEFAULTS.streakEvery,
            streakBonus: Number(snap.streakBonus) >= 0 ? Number(snap.streakBonus) : DEFAULTS.streakBonus,
            roundLength: Number(snap.roundLength) > 0 ? Number(snap.roundLength) : DEFAULTS.roundLength,
          };
        });

        newRound();
      },

      onResize() {},
      onHide() { state.flush(); },
      destroy() {
        if (ledger) { ledger.destroy(); ledger = null; }
        if (tel) { tel.destroy(); tel = null; }
      },
    };
  },
);
