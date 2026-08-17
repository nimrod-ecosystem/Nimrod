// wordforge.js — the first GAME, and the first thing that writes to BOTH streams.
//
// A vocabulary game over a word bank. Three round types:
//   define  — here's a word, which meaning is it?
//   blank   — here's a sentence with a hole, which word fills it?
//   better  — two sentences, which one is better writing? (and why)
//
// POINTS ARE UNDERSTANDING, NOT TIME SERVED. The game pays for correct answers and never
// for minutes elapsed, so leaving it open on a second monitor earns nothing. Each point is
// ALSO a minute of credit toward its subject (see points.js) — understand it faster and
// you are done sooner, which is the entire point of the design.
//
// "I DON'T KNOW" IS A FIRST-CLASS ANSWER. There is a button for it, so nobody has to
// deliberately pick something wrong just to see the explanation. It pays the same as a
// wrong guess — honesty shouldn't cost more than guessing — and it is recorded
// DIFFERENTLY: a guess is `responded: true, correct: false` (a false alarm), while "I
// don't know" is `responded: false` (a miss). The progress dashboard already tells those
// apart, so "got it wrong" and "didn't know it" stop being the same number.
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
// TOPICS LEVEL UP. A bank entry may carry `topic: '<id>'`; those questions stay OUT of the
// deck until the matching lesson has been watched (see ../lessons.js). Entries with NO
// topic are always in play, so a bank written before this existed is unaffected. When
// something is being held back the game SAYS so — a silently shorter deck reads as "that's
// all there is", which is the opposite of a level-up.
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
import { createLessons, gate, lockedTopics, DEFAULT_TOPICS, LESSON_TOPIC } from '../lessons.js';

export const GAME = 'wordforge';

// Seeded from the word bank in the documented format. Editable per profile.
//
// The 4th column is a GRADE BAND. Read it for exactly what it is: **the bank's own label
// for how hard a word is**, so the progress dashboard can say "grade-8 words at 85%,
// grade-10 at 40%". It is NOT a normed score and not a comparison against other children
// — that would take a standardized instrument with a sampled population behind it, which
// this is not. These starting values are estimates in the spirit of the Dale-Chall
// familiar-word bands; correct them freely, they are data.
export const DEFAULT_WORDS = [
  ['obsolete', 'no longer used because something newer exists', 'The old phone became obsolete the moment the new model shipped.', 8],
  ['refurbish', 'to clean up and repair something so it works like new', 'Volunteers refurbish old laptops and give them to families who need them.', 8],
  ['salvage', 'to save something usable from what would be thrown out', 'He managed to salvage the hard drive from the broken computer.', 7],
  ['tolerance', "the tiny allowed difference between a part's real size and its target", "If the tolerance is too tight, the printed parts won't fit together.", 9],
  ['proportion', 'the relationship in size between two things', 'He kept the desk organizer in proportion so it matched his monitor.', 6],
  ['persuade', 'to convince someone to do or believe something', 'She wrote a letter to persuade the council to support the repair law.', 6],
  ['civic', 'relating to a city and the duties of its citizens', 'Voting is a basic civic responsibility.', 7],
  ['surplus', 'more than what is needed; extra', 'The company had a surplus of old monitors it planned to scrap.', 8],
  ['initiative', 'the drive to do something without being told', 'He showed initiative by building a tool that logged his points automatically.', 8],
  ['concise', 'saying a lot in few words', 'Her concise answer made the point without wasting a sentence.', 9],
  ['deliberate', 'done on purpose, carefully considered', 'Planned obsolescence is a deliberate choice, not an accident.', 8],
  ['tedious', 'boring and slow because it takes a long time', 'Copying the numbers by hand was tedious, so he wrote a script.', 9],
].map(([word, meaning, sentence, grade]) => ({ word, meaning, sentence, grade }));

// A grade number -> the label the dashboard groups by. One place, so it can't drift.
export function bandOf(grade) {
  const n = Number(grade);
  return Number.isFinite(n) && n > 0 ? `grade ${n}` : null;
}

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
].map(([better, weaker, why]) => ({ better, weaker, why, grade: 8 }));

// PRICED AGAINST THE REST OF THE ECONOMY, not invented.
//
// The economy runs at roughly ONE POINT PER MINUTE of real effort: a school hour is 60,
// dishes are 15 (~10 min), mowing is 60 (~1 hr) — and, the anchor that matters here, the
// Task Menu already prices **"look up a word's meaning" at 2 points**. Answering a word
// question correctly is that same act, so it is worth about the same: 2.
//
// Do the arithmetic before changing these. A question takes ~15-20s, so a player answers
// ~3 per minute. At 2 points a correct answer that is ~6 points/minute — already several
// times the base rate, which is defensible for concentrated learning but is the ceiling,
// not the floor. The original 10/3 worked out near 30-40 points per minute: a module that
// simply sprays points and devalues every other way of earning them.
export const DEFAULTS = {
  correctPoints: 2,    // a right answer — the Task Menu's price for looking a word up
  tryPoints: 1,        // a wrong answer, once the explanation is acknowledged
  streakEvery: 5,      // a bonus every N correct in a row
  streakBonus: 3,
  roundLength: 10,     // items per round; each appears at most once
  // A daily cap, OFF by default (0 = no cap).
  //
  // An earlier version capped this at 40/day on the theory that a game left open on a
  // second monitor would print money. That reasoning was wrong for this economy: the game
  // pays NOTHING for time — only for correct answers — so an idle window earns zero no
  // matter how long it sits there. And since a point is also a minute of subject credit,
  // capping the points would cap the ability to demonstrate understanding, which is the
  // opposite of the goal. The knob stays for a game that ever does need one.
  dailyCap: 0,
  // Which subject a point of credit discharges.
  subject: 'English language arts',
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
      band: bandOf(p.grade),
      explain: p.why,
    };
  }

  const w = item.word;
  const others = shuffle(words.filter((x) => x.word !== w.word), rand).slice(0, 3);
  const band = bandOf(w.grade);

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
      band,
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
    band,
    explain: `“${w.word}” means ${w.meaning}. For example: ${w.sentence}`,
  };
}

// What an answer is worth. A wrong answer is NOT zero — see the header. Saying "I don't
// know" is worth the same as guessing wrong: honesty should not cost more than a guess.
export function scoreFor({ correct, streak = 0, cfg = DEFAULTS }) {
  if (!correct) return { base: cfg.tryPoints, bonus: 0, total: cfg.tryPoints };
  const bonus = (cfg.streakEvery > 0 && streak > 0 && streak % cfg.streakEvery === 0) ? cfg.streakBonus : 0;
  return { base: cfg.correctPoints, bonus, total: cfg.correctPoints + bonus };
}

// The documented line formats, so a profile's bank can be edited as text.
// `word | meaning | sentence | grade? | topic?` — the last two are optional, so every
// bank written to the original three-column format still parses unchanged.
export function parseWords(text) {
  return String(text || '').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('|') && !l.includes('||'))
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter((p) => p.length >= 3 && p[0] && p[1])
    .map(([word, meaning, sentence, grade, topic]) => {
      const it = { word, meaning, sentence };
      if (Number(grade) > 0) it.grade = Number(grade);
      if (topic) it.topic = topic;
      return it;
    });
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
    let lessons = null;
    let topics = DEFAULT_TOPICS;
    let held = [];            // topics still holding words back, for the note
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
    let capped = false;       // today's payout for this game is spent
    let askedAt = 0;

    const el = (sel) => mount.querySelector(sel);

    function newRound() {
      // Only what's unlocked goes in the deck. Pairs are ungated for now — they carry no
      // topic — so `gate` passes them straight through.
      const unlocked = lessons ? lessons.unlocked() : new Set();
      const openWords = gate(words, unlocked).open;
      held = lockedTopics(words, unlocked, topics);
      deck = buildDeck(openWords.length >= 4 ? openWords : words, pairs,
        { roundLength: cfg.roundLength, rand });
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
    // `i === null` means "I don't know" — no option was picked.
    async function answer(i) {
      if (answered || !q) return;
      const declared = i === null;
      const correct = !declared && i === q.answer;
      if (correct) streak += 1; else streak = 0;
      const award = scoreFor({ correct, streak, cfg });
      answered = { picked: declared ? null : i, correct, declared, award };
      render();

      // The MEASUREMENT: one trial, concept = the word, so Progress can rank what's hard.
      tel.log({
        game: GAME,
        session: session.id,
        mode: 'practice',
        concept: q.concept,
        band: q.band || null,
        // A guess is a response; "I don't know" is not. Keeping them apart is what lets
        // progress distinguish "answered it wrong" from "didn't know it".
        responded: !declared,
        correct,
        latencyMs: Date.now() - askedAt,
        prompt: q.prompt,
      }).catch((e) => console.error('wordforge: telemetry', e));

      // The ECONOMY: a right answer pays now. A wrong one pays on "Got it" instead —
      // the points are for engaging with the correction, not for being wrong.
      if (correct) await bank(award, q.concept, 'correct');
    }

    // Pay, unless today's cap for this game is already spent. The trial was logged either
    // way — capping the currency must not cap the measurement.
    async function bank(award, concept, note) {
      const spentToday = ledger.todayFrom(GAME);
      const room = cfg.dailyCap > 0 ? Math.max(0, cfg.dailyCap - spentToday) : award.total;
      const pay = Math.min(award.total, room);
      capped = cfg.dailyCap > 0 && room <= 0;
      if (pay <= 0) { render(); return; }
      earned += pay;
      try {
        await ledger.award({
          amount: pay,
          mult: 1,
          // School credit, not a chore bonus: each point is also a MINUTE of this
          // subject. Understanding discharges the requirement; time alone does not.
          type: 'School',
          minutes: pay,
          subject: cfg.subject,
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
      el('[data-streak]').textContent = capped
        ? 'daily points reached — still counts for practice'
        : (streak >= 2 ? `${streak} in a row` : '');
      el('[data-progress]').textContent = deck.length ? `${Math.min(at + 1, deck.length)} / ${deck.length}` : '';
      // Never let the deck just be quietly shorter — name what's waiting and why.
      const heldEl = el('[data-held]');
      if (heldEl) {
        heldEl.textContent = held.length
          ? `${held.reduce((n, h) => n + h.count, 0)} more waiting behind: ${held.map((h) => h.label).join(', ')}`
          : '';
      }

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
        if (answered.correct) {
          feedback = `<div class="wf-fb is-right">
               <b>Right.</b> +${answered.award.total}
               ${answered.award.bonus ? `<span class="wf-bonus">includes a +${answered.award.bonus} streak bonus</span>` : ''}
             </div>
             <button class="wf-btn wf-primary" data-next>Next</button>`;
        } else {
          // A miss is a teaching moment: the explanation, then the points for taking it in.
          // Saying so plainly gets a different opening line from a wrong guess, but the
          // same explanation and the same points.
          feedback = `<div class="wf-fb is-wrong">
               <b>${answered.declared ? 'Fair enough — here it is.' : 'Not quite.'}</b> ${esc(q.explain)}
               <span class="wf-try">+${answered.award.total} for ${answered.declared ? 'asking' : 'the try'} — press “Got it” to bank it.</span>
             </div>
             <button class="wf-btn wf-primary" data-next>Got it</button>`;
        }
      }

      host.innerHTML = `
        <p class="wf-kind">${q.kind === 'better' ? 'Which is better?' : q.kind === 'blank' ? 'Fill the blank' : 'What does it mean?'}</p>
        <p class="wf-prompt">${esc(q.prompt)}</p>
        <div class="wf-opts">${opts}</div>
        ${answered ? '' : '<button class="wf-btn wf-idk" data-idk>I don’t know — show me</button>'}
        ${feedback}`;

      for (const b of host.querySelectorAll('[data-opt]')) {
        b.addEventListener('click', () => answer(Number(b.dataset.opt)));
      }
      const nx = host.querySelector('[data-next]');
      if (nx) nx.addEventListener('click', advance);
      const idk = host.querySelector('[data-idk]');
      if (idk) idk.addEventListener('click', () => answer(null));
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
            <div class="wf-held" data-held></div>
          </div>`;

        ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus });
        tel = createTelemetry({ makeEvents: ctx.makeEvents, bus });
        lessons = createLessons({ makeEvents: ctx.makeEvents, bus });
        // The FIRST round waits for the unlock log, so it can't deal a deck that ignores
        // what's been unlocked and then silently change shape one round later. Deal it on
        // failure too — an unreachable server must not leave a blank game.
        lessons.load()
          .then(() => lessons.startPolling())
          .catch(() => {})
          .then(() => { if (!deck.length) newRound(); });
        // A lesson finished elsewhere (the Lessons module, another device) — the new words
        // join the pool at the START of the next round, not mid-question.
        bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });
        session = tel.session({ game: GAME, mode: 'practice' });
        ledger.load().catch(() => {});
        tel.load().catch(() => {});

        // Anything on the bus can answer — a keypad, a switch, a companion.
        bus.subscribe('wordforge/answer', (i) => answer(i === null || i === 'idk' ? null : Number(i)));
        bus.subscribe('wordforge/next', () => advance());

        state.subscribe((s) => {
          const snap = s || {};
          const w = Array.isArray(snap.words) ? snap.words : (snap.wordsText ? parseWords(snap.wordsText) : null);
          const p = Array.isArray(snap.pairs) ? snap.pairs : (snap.pairsText ? parsePairs(snap.pairsText) : null);
          words = (w && w.length >= 4) ? w : DEFAULT_WORDS;   // need 4 for a 4-way choice
          topics = Array.isArray(snap.topics) && snap.topics.length ? snap.topics : DEFAULT_TOPICS;
          pairs = (p && p.length) ? p : DEFAULT_PAIRS;
          cfg = {
            correctPoints: Number(snap.correctPoints) > 0 ? Number(snap.correctPoints) : DEFAULTS.correctPoints,
            tryPoints: Number(snap.tryPoints) >= 0 ? Number(snap.tryPoints) : DEFAULTS.tryPoints,
            streakEvery: Number(snap.streakEvery) >= 0 ? Number(snap.streakEvery) : DEFAULTS.streakEvery,
            streakBonus: Number(snap.streakBonus) >= 0 ? Number(snap.streakBonus) : DEFAULTS.streakBonus,
            roundLength: Number(snap.roundLength) > 0 ? Number(snap.roundLength) : DEFAULTS.roundLength,
            dailyCap: Number(snap.dailyCap) >= 0 ? Number(snap.dailyCap) : DEFAULTS.dailyCap,
            subject: typeof snap.subject === 'string' && snap.subject ? snap.subject : DEFAULTS.subject,
          };
        });

      },

      onResize() {},
      onHide() { state.flush(); },
      destroy() {
        if (ledger) { ledger.destroy(); ledger = null; }
        if (tel) { tel.destroy(); tel = null; }
        if (lessons) { lessons.destroy(); lessons = null; }
      },
    };
  },
);
