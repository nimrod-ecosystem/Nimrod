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
import { parseBank as sharedBank } from '../bank.js';
import { BANK_STATE, BANK_TOPIC } from './bank.js';
import { loadPack } from '../packs.js';
import { packsFor, packById } from '../pack_library.js';

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

// A `nimrod.pack.v1` words item is `{word, definition, decoys?, example?, difficulty?}` — see
// `checkWordsItem` in packs.js. Mapped to this module's own row shape, the same small rename
// Trivia's own `packToTriviaBank` does against ITS pack (`question`/`answers` -> `q`/`wrong`):
// `definition` -> `meaning`, `example` -> `sentence` (this file's internal name predates the
// pack schema and stays that name internally, per packs.js's own comment on the choice).
//
// `decoys` IS NOT USED HERE, on purpose. `makeQuestion` already builds its wrong options by
// sampling OTHER words from the same deck (`words.filter(x => x.word !== w.word)`) — a
// mechanism that already works, is already tested, and needs at least 4 words in the deck to
// produce a 4-way choice, not per-word authored decoys. A pack that includes `decoys` anyway
// is still valid (the schema allows it) — they are just not read by this path. If a future pack
// kind ever needs per-word decoys specifically, that is a real reason to change this, not a gap
// to quietly work around here.
//
// `difficulty` (easy/medium/hard) -> a grade NUMBER, because `bandOf` and the progress
// dashboard both key off a number, not a three-way enum, and `DEFAULT_WORDS`' own numbers run
// roughly 6-9. Picked to land in that same range rather than invent a second scale: easy=6,
// medium=8, hard=10. A pack with no `difficulty` gets `medium` (8) — most useful default for
// content nobody has graded, since it neither locks a word away from an average learner nor
// pretends it is trivial.
const DIFFICULTY_GRADE = { easy: 6, medium: 8, hard: 10 };
export function packToWordBank(pack) {
  return (pack.items || []).map((it) => ({
    word: it.word,
    meaning: it.definition,
    sentence: it.example || `${it.word}.`,
    grade: DIFFICULTY_GRADE[it.difficulty] || DIFFICULTY_GRADE.medium,
  }));
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
  // A READY-MADE PACK, NOT JUST A WRITTEN/SHARED BANK — same additive shape Trivia's own
  // `contentSource` already ships (2026-09-08 MIKE_CHANGE_LIST §3). `bank` (unchanged) stays
  // the default; `pack` is for somebody with nobody to write a word list for them.
  contentSource: 'bank',
  packId: packsFor('words')[0]?.id || null,
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
      // Nothing to add per option here: `why` is already about the comparison, and both
      // options are the two halves it compares. A note repeating it would be noise.
      optionNotes: opts.map(() => null),
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
      // *** WHAT THE WORD YOU PICKED ACTUALLY MEANS. ***
      //
      // Chat's #11: the "I don't know, show me" option is good and should stay, and a wrong
      // guess should say what the word you picked actually means. That is the difference
      // between being told you are wrong and being told something: somebody who chose
      // "laconic" for a sentence about weather has a specific wrong idea, and the answer to it
      // is what "laconic" means, not a second reading of the right answer.
      //
      // Parallel to `options` by index, so nothing has to search a deck to explain a press.
      optionNotes: opts.map((o) => {
        const other = words.find((x) => x.word === o);
        return other && other.word !== w.word
          ? `“${other.word}” means ${other.meaning}.` : null;
      }),
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
    // Here the options are MEANINGS, so the useful note is whose meaning it was -- the person
    // has just learned a second word by getting the first one wrong, which is the best thing a
    // wrong answer can do.
    optionNotes: opts.map((o) => {
      const other = words.find((x) => x.meaning === o);
      return other && other.word !== w.word
        ? `That is what “${other.word}” means.` : null;
    }),
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

// ---------------------------------------------------------------------------------------
// WHAT THE SETTINGS MENU SHOWS — and why this was missing rather than deliberately absent
// ---------------------------------------------------------------------------------------
//
// *** F4 ASKED FOR THE DAILY CAP TO BE "AVAILABLE AS A PER-PROFILE SETTING DEFAULTING OFF",
// AND ONLY HALF OF THAT WAS TRUE. *** `dailyCap: 0` has been the default for a while and the
// row was marked done — but `registerModule` below passed no `settings` array at all, so the
// composer's menu had nothing to show and **there was no way to turn a cap on from anywhere**.
// A setting that defaults off and cannot be switched on is not a setting, it is a constant.
//
// The same was true of six other keys this module genuinely reads and acts on: `roundLength`
// (`buildDeck`), `correctPoints` / `tryPoints` / `streakEvery` / `streakBonus` (`award`), and
// `subject` (what a point of credit discharges). All of them were live config that no UI could
// write.
//
// **`topics` is NOT in this list, and A14 was slightly wrong to include it.** It is not module
// config: it arrives from the shared bank snapshot, alongside the words themselves. Putting it
// here would offer a control that the next bank refresh silently overwrites.
//
// KIND, AND THE ONE-SWITCH COST. `photos.js` states the rule and it decides most of the
// choices below: with one switch you walk a control one press at a time and can only travel
// one way, so THE NUMBER OF STOPS IS THE COST. `dailyCap` and `roundLength` are real ranges
// whose useful values are a short list, so they are choices — five presses instead of forty.
// The three point values are genuine small ranges where any integer is meaningful, so they are
// numbers, and they sit at `advanced` where a caregiver with a keyboard is the likely reader.
//
// LEVELS. Only the two things somebody actually changes are `standard`; everything that prices
// the economy is `advanced`, so the common case is a two-row menu rather than a nine-row one.
// Nothing here is `essential` — this is a game somebody chose to play, and none of these
// numbers is the difference between being able to use the screen and not.
// A words-kind pack, if any exist. Computed once at module load, same guard Trivia's own
// TRIVIA_PACKS uses — if PACK_LIBRARY ever ships zero words packs, these two rows quietly do
// not appear rather than offering a picker with nothing in it.
const WORD_PACKS = packsFor('words');

// Shared across every Word Forge instance on the page, not per-instance — two panels both set
// to the same pack should mean one fetch, not two. Its own cache, not Trivia's: two different
// modules, two different in-memory Maps, same reasoning as everything else that is duplicated
// rather than coupled across these files.
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
  ...(WORD_PACKS.length ? [
    { key: 'contentSource', label: 'Where words come from', kind: 'choice', default: 'bank',
      level: 'standard',
      options: [{ value: 'bank', label: 'Written words + shared bank' },
                { value: 'pack', label: 'A built-in pack' }],
      note: 'A pack is ready-made — nobody has to write a word list first.' },
    { key: 'packId', label: 'Which pack', kind: 'choice', default: WORD_PACKS[0].id,
      level: 'standard',
      options: WORD_PACKS.map((p) => ({ value: p.id, label: p.label })) },
  ] : []),
  // The F4 ask, reachable at last. 0 is off, and it is first so that the off state is one
  // press away from wherever somebody has got to.
  { key: 'dailyCap', label: 'Daily points cap', kind: 'choice', default: 0, level: 'standard',
    options: [
      { value: 0, label: 'No cap' },
      { value: 20, label: '20 a day' },
      { value: 40, label: '40 a day' },
      { value: 60, label: '60 a day' },
      { value: 100, label: '100 a day' },
    ],
    note: 'Off by default: this game pays for correct answers, never for time, so a window left open earns nothing.' },
  { key: 'roundLength', label: 'Questions in a round', kind: 'choice', default: 10,
    level: 'standard',
    options: [
      { value: 5, label: '5' },
      { value: 10, label: '10' },
      { value: 15, label: '15' },
      { value: 20, label: '20' },
    ] },
  { key: 'correctPoints', label: 'Points for a right answer', kind: 'number', default: 2,
    level: 'advanced', min: 0, max: 10, step: 1 },
  // Deliberately worth something. A wrong answer that has been read and acknowledged is the
  // part of this game that teaches, and paying zero for it would price learning at nothing.
  { key: 'tryPoints', label: 'Points for a wrong answer, once explained', kind: 'number',
    default: 1, level: 'advanced', min: 0, max: 10, step: 1 },
  { key: 'streakEvery', label: 'Streak bonus every', kind: 'choice', default: 5,
    level: 'advanced',
    options: [
      { value: 0, label: 'No streak bonus' },
      { value: 3, label: '3 in a row' },
      { value: 5, label: '5 in a row' },
      { value: 10, label: '10 in a row' },
    ] },
  { key: 'streakBonus', label: 'Streak bonus points', kind: 'number', default: 3,
    level: 'advanced', min: 0, max: 20, step: 1 },
  // TEXT, and therefore not cycleable — it says so rather than pretending, the same way
  // `photos.js` handles `album`. Nobody types a subject name with one switch, and a fake
  // affordance is worse than an absent one.
  { key: 'subject', label: 'Credit counts toward', kind: 'text',
    default: 'English language arts', level: 'advanced',
    note: 'which subject a point of credit discharges' },
];

registerModule(
  { type: 'wordforge', title: 'Word Forge', description: 'A word game. A wrong answer explains itself and still counts for something.',
    // `dependsOn` and `importance` are deliberately still absent. Both feed the recovery
    // ladder's fallback RANKING, so guessing at them would change which module a broken screen
    // swaps to — a behaviour change wearing a metadata costume. Absent `dependsOn` is already
    // read as `server`, which is the pessimistic answer and the safe one.
    // `local`, MEASURED RATHER THAN GUESSED (2026-09-05). Mounted with every handle rejecting -
    // a dead platform, with the factories still present the way a real kiosk supplies them -
    // this module still renders a playable question, from its built-in words. It runs; it just stops being evidence.
    //
    // That is exactly `pressgame`'s stated precedent, and the reason this matters is the
    // RECOVERY LADDER: `dependsOn` feeds its fallback ranking, and an ABSENT value is read as
    // the pessimistic `server`. So leaving it off made a screen that lost the platform swap
    // AWAY from a game that would have kept working - which is the opposite of what a fallback
    // is for.
    dependsOn: 'local', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;

    let ledger = null;
    let sharedRow = null;                 // the shared bank row Trivia reads too
    let applyState = () => {};            // named so a shared-bank change re-runs it
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
    let highlight = 0;      // which option a scanning switch is pointed at
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
      highlight = 0;
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

      // *** `data-on` IS THE SWITCH CURSOR, AND IT IS WHY THIS GAME IS PLAYABLE AT ALL. ***
      // Until 2026-09-02 there was no cursor: `actions.js` pointed BOTH `next` and `select` at
      // `wordforge/next`, which skips to another question, and nothing reached
      // `wordforge/answer`. Somebody driving this with one switch could skip questions forever
      // and never answer one — in a game whose whole premise is that a wrong answer teaches you
      // something. Mike found it by trying to play it.
      //
      // Copied from `trivia.js` rather than invented: same `data-on="1"` attribute, same
      // wrap-around stepping, same "next advances once you have answered". Two quizzes that
      // behaved differently under the same switch would be a defect of its own.
      const opts = q.options.map((o, i) => {
        let cls = 'wf-opt';
        if (answered) {
          if (i === q.answer) cls += ' is-right';
          else if (i === answered.picked) cls += ' is-wrong';
        }
        const on = !answered && i === highlight ? ' data-on="1"' : '';
        return `<button class="${cls}" data-opt="${i}"${on} ${answered ? 'disabled' : ''}>${esc(o)}</button>`;
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
          // *** AND WHAT THEY PICKED, WHEN THEY PICKED SOMETHING. ***
          //
          // Only on a real guess: somebody who said "I don't know" did not choose a word, and
          // telling them what the word they did not pick means would be answering a question
          // they were honest enough not to ask.
          const note = !answered.declared && answered.picked != null
            ? (q.optionNotes || [])[answered.picked] : null;
          feedback = `<div class="wf-fb is-wrong">
               <b>${answered.declared ? 'Fair enough — here it is.' : 'Not quite.'}</b> ${esc(q.explain)}
               ${note ? `<span class="wf-picked">You picked: ${esc(note)}</span>` : ''}
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

    // Wraps, because a cursor that stops at the last option strands somebody on it.
    function moveHighlight(delta) {
      if (!q || answered) return;
      const n = q.options.length;
      if (!n) return;
      highlight = ((highlight + delta) % n + n) % n;
      render();
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

        try {
          sharedRow = ctx.makeState ? ctx.makeState(BANK_STATE) : null;
          if (sharedRow) {
            sharedRow.load().catch(() => {}).then(() => sharedRow.startPolling?.());
            sharedRow.subscribe?.(() => state?.get && applyState(state.get()));
          }
        } catch (err) { sharedRow = null; console.error('wordforge: no shared bank', err); }
        bus.subscribe(BANK_TOPIC, () => {
          sharedRow?.load?.().catch(() => {}).then(() => state?.get && applyState(state.get()));
        });
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
        // `next` steps the options while a question is open and moves on once it is answered —
        // trivia's shape, so one switch behaves the same way in both games.
        bus.subscribe('wordforge/next', () => (answered ? advance() : moveHighlight(1)));
        bus.subscribe('wordforge/prev', () => moveHighlight(-1));
        bus.subscribe('wordforge/select', () => (answered ? advance() : answer(highlight)));
        // Skipping outright still has a home, so the old behaviour is not lost — it is just no
        // longer the only thing a switch can do.
        bus.subscribe('wordforge/skip', () => advance());

        // NAMED rather than inline, so a change to the SHARED bank row can re-run exactly the
        // same interpretation. Two code paths that both decide what a bank means is how they
        // end up disagreeing.
        //
        // *** THE PACK PATH IS ASYNC; EVERYTHING ELSE HERE STAYS SYNC. *** Same split Trivia's
        // own `readBank` makes, for the same reason: a pack is a network fetch, and `cfg` (plus
        // `topics`/`pairs`) must not wait on it. `wordGen` guards against a slow pack response
        // landing after a NEWER settings change already picked a different source — the stale
        // one must not overwrite it, exactly `bankGen`'s job in trivia.js.
        let wordGen = 0;
        function resolveNonPackWords(snap) {
          // *** ALSO READS THE SHARED BANK (2026-08-31). *** One document that Trivia reads
          // too, so a syllabus is written once. It comes from this instance's own state where
          // somebody set it, otherwise from the shared row the Questions module edits.
          // `wordsText` still wins where it exists, so nothing anybody already wrote changes
          // meaning — see bank.js on why that matters more than tidiness.
          const bankText = snap.bankText != null ? snap.bankText
                         : (sharedRow?.get?.() || {}).bankText;
          const shared = bankText ? sharedBank(bankText, { defaultKind: 'words' }).words : null;
          const w = Array.isArray(snap.words) ? snap.words
                  : (snap.wordsText ? parseWords(snap.wordsText) : (shared && shared.length ? shared : null));
          return (w && w.length >= 4) ? w : DEFAULT_WORDS;   // need 4 for a 4-way choice
        }
        async function resolveWords(snap) {
          const gen = ++wordGen;
          if (cfg.contentSource === 'pack' && cfg.packId) {
            try {
              const pack = await loadPackCached(cfg.packId);
              if (gen !== wordGen) return;         // superseded while the fetch was in flight
              const fromPack = packToWordBank(pack);
              const next = fromPack.length >= 4 ? fromPack : DEFAULT_WORDS;
              // LENGTH, not reference — `resolveNonPackWords` below builds a fresh array on
              // every call even when nothing meaningful changed, and comparing references would
              // redeal the round on an unrelated settings tweak (roundLength, say). Trivia's own
              // `applyBank` makes the identical tradeoff (`next.length !== bank.length`) for the
              // identical reason.
              const changed = next.length !== words.length;
              words = next;
              // A pack switch should take effect promptly, matching Trivia's own `applyBank` —
              // otherwise "which pack" reads as applied while the round in progress keeps
              // dealing from whatever was there before.
              if (changed) newRound();
              return;
            } catch (err) {
              console.error(`wordforge: pack "${cfg.packId}" failed to load, falling back to the bank`, err);
              // fall through — an unreachable pack should read as an empty syllabus, not a
              // dead panel; resolveNonPackWords still needs `snap` sourced correctly below.
            }
          }
          const next = resolveNonPackWords(snap);
          if (gen !== wordGen) return;
          const changed = next.length !== words.length;
          words = next;
          if (changed) newRound();
        }
        applyState = (s) => {
          const snap = s || {};
          const p = Array.isArray(snap.pairs) ? snap.pairs : (snap.pairsText ? parsePairs(snap.pairsText) : null);
          topics = Array.isArray(snap.topics) && snap.topics.length ? snap.topics : DEFAULT_TOPICS;
          pairs = (p && p.length) ? p : DEFAULT_PAIRS;
          cfg = {
            contentSource: snap.contentSource === 'pack' ? 'pack' : DEFAULTS.contentSource,
            packId: typeof snap.packId === 'string' && snap.packId ? snap.packId : DEFAULTS.packId,
            correctPoints: Number(snap.correctPoints) > 0 ? Number(snap.correctPoints) : DEFAULTS.correctPoints,
            tryPoints: Number(snap.tryPoints) >= 0 ? Number(snap.tryPoints) : DEFAULTS.tryPoints,
            streakEvery: Number(snap.streakEvery) >= 0 ? Number(snap.streakEvery) : DEFAULTS.streakEvery,
            streakBonus: Number(snap.streakBonus) >= 0 ? Number(snap.streakBonus) : DEFAULTS.streakBonus,
            roundLength: Number(snap.roundLength) > 0 ? Number(snap.roundLength) : DEFAULTS.roundLength,
            dailyCap: Number(snap.dailyCap) >= 0 ? Number(snap.dailyCap) : DEFAULTS.dailyCap,
            subject: typeof snap.subject === 'string' && snap.subject ? snap.subject : DEFAULTS.subject,
          };
          // Fire-and-forget, same as Trivia's bare `readBank()` inside its own subscribe
          // callback — nothing here needs to await a network fetch.
          resolveWords(snap).catch(() => {});
        };
        state.subscribe(applyState);

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
