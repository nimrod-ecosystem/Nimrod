// lessons.js (module) — the LEVEL-UP screen: watch a lesson, unlock its questions.
//
// Each topic is a card. Locked ones say what's waiting behind them; watching the lesson
// unlocks it, and from then on that topic's words are in the game's pool. The unlock is
// appended to the `lessons` stream (see ../lessons.js) so it can't be lost or undone by a
// concurrent save on another device.
//
// ABOUT THE "I'VE WATCHED IT" BUTTON. There is no reliable way to know a video was
// actually absorbed, and gating on elapsed seconds would be exactly the time-serving this
// curriculum is built to avoid. So the button is a light nudge, not a lock: it enables
// after `minWatchSec` with the remaining count shown, and the REAL check is downstream —
// unlocking puts the questions in play, and getting them wrong is visible in progress.
// Skipping the video only means facing the questions without it.

// *** TRANSCRIPT LESSONS (row 2.24) AND THE §0h REVIEW QUEUE, 2026-09-28. *** An open card also
// offers "Quiz me from the transcript": paste the video's transcript, a model on this device writes
// questions whose answer key comes FROM the transcript (checked deterministically, see
// ../transcript_quiz.js), they are asked right away, and once enough are answered the video's
// points are paid (School, a point per minute of video) — once per topic+transcript. Checked
// questions wait in a review list (§0h: queue ON by default, auto-approve OFF by default, a "this
// looks wrong" flag for player and caregiver) and approved ones join the pool through the SAME
// `questionsTo` routing a pack's own questions already use. Unused, every card behaves as before.
// *** 2026-09-28, Mike: "Flip review." *** Auto-approve is now ON by default: a question that passes
// `grounded` (and, when the fact check is on, is not flagged by it) joins the pool with no person;
// anything flagged still waits. The setting stays, so a caregiver can turn review back on. The
// player's flag became "I think this question is wrong" — a CONTEST (../contests.js), offered in
// this quiz, in Trivia and in Word Forge, and listed here as "Contested while playing".
// THE FACT CHECK (register 258, Wikipedia — Mike's pick, 2026-09-28) runs after the questions are
// written, in the background while the quiz is already being asked: each checked question is looked
// up (../wikipedia.js), and one Wikipedia seems to contradict is FLAGGED — held out of the pool
// until a person clears it. It never changes an answer key. Setting `factCheck`.
// NOT in this pass: checkpoints for long videos, notes-first (253), books (2.23), an API-key field.

import { registerModule } from '../module.js';
import { readWithLegacy } from '../settings_fields.js';
import { createLessons, DEFAULT_TOPICS, LESSON_TOPIC,
         TRIVIA_LESSON_QUESTIONS, WORDFORGE_LESSON_QUESTIONS } from '../lessons.js';
import { loadPack } from '../packs.js';
import { packsFor, packById } from '../pack_library.js';
import { createAI, isChatModel } from '../ai.js';
import { createWikipedia } from '../wikipedia.js';
import { createPointsLedger } from '../points.js';
import {
  videoMinutes, requiredAnswers, splitTranscript, buildPrompt, parseQuestions, checkQuestions, toLessonQuestion,
  toRoutedQuestion, questionId, transcriptKey, lengthTellsFor, startQuiz, quizCurrent, quizAnswer,
  quizProgress, quizDrop, reviewItems, poolFrom, isPaid, TRANSCRIPT_STREAM, REVIEW_KINDS, MINUTE_CHOICES,
  factCheck, FACT,
} from '../transcript_quiz.js';
import { createContests, contestKey, CONTEST_STATUS, CONTEST_TOPIC } from '../contests.js';

// `minWatchMs` is milliseconds - the house rule for every stored duration. It was
// `minWatchSec`; the key changed rather than the meaning of the old one. The countdown a
// person READS is still in seconds, which is the point of the rule: store one unit, display
// the one a human thinks in.
export const DEFAULTS = {
  minWatchMs: 30000,
  // *** THE VIDEO-SELECTION MECHANISM (change list §3), MIRRORING WORD FORGE'S OWN
  // contentSource/packId RATHER THAN A SECOND ONE. *** The gap this closes, named in this
  // file's own header until now: a topic's video lived in `state.topics[]` per topic, and
  // "choosing videos needs a small editor... or the shared content source this keeps
  // arriving at from every direction." `packs.js` already validates a `lesson`-kind pack
  // (topic + optional video + optional questions) — it was declared and unconsumed. This is
  // the consuming half.
  // DEFAULT FLIPPED TO 'pack', 2026-09-22, same reason and same day as its two siblings
  // (trivia.js/wordforge.js): Mike, "There should be default packs, so people can play the
  // games without setting anything up." Kept consistent with the two modules this mechanism
  // was explicitly built to mirror rather than fork from — see trivia.js's own DEFAULTS
  // comment for the risk this was weighed against.
  contentSource: 'pack',
  packId: packsFor('lesson')[0]?.id || null,
  // *** RULED, 2026-09-23: "both" (not "neither"). *** `it.questions` (trivia-shaped, per the
  // schema) used to be deliberately unread — wiring a lesson's own questions into Trivia's or
  // Word Forge's pool was "the SAME per-module decision packs.js's own header already declines
  // to make on any consumer's behalf," left for whoever got asked. Mike answered directly:
  // "both" — a pack's questions feed Trivia's bank and Word Forge's deck by default. Still a
  // real per-pack choice, not forced: see the `questionsTo` setting below.
  questionsTo: 'both',
  // ---- transcript lessons (row 2.24). Each is a revisable default, argued at its settings row. ----
  requireBy: 'correct',
  // Mike, 2026-09-29: one per minute for the first 5 minutes, then one per 2.5 (transcript_quiz.js).
  firstMinutes: 5,
  firstEvery: 1,
  perMinutes: 2.5,
  minAnswers: 1,
  // How many questions are WRITTEN is not tied to the requirement (Mike, same day). 0 = no limit.
  maxQuestions: 0,
  pieceWords: 900,
  autoApprove: true,     // flipped 2026-09-28 (Mike: "Flip review."); see its settings row
  factCheck: false,
  aiModel: '',
  aiTimeoutMs: 15 * 60 * 1000,
  subject: 'General',
};
const LEGACY_MIN_WATCH = { key: 'minWatchSec', scale: 1000 };
const LESSON_PACKS = packsFor('lesson');
const QUESTIONS_TO_VALUES = ['both', 'trivia', 'wordforge', 'none'];
//
// `id` IS SYNTHESIZED FROM THE TOPIC TEXT, NOT FROM POSITION, and that is load-bearing. The
// schema carries no `id` field — only `topic`, `video`, `questions` — but `topics[].id` is
// what an unlock event names forever (`lessons.watch(t.id, ...)`, an append-only stream).
// An index-based id would silently re-identify every already-unlocked topic the moment a
// pack's item order changes — reordering a JSON file is not supposed to un-earn anything.
// Slugging the topic text keeps the id stable across reordering, as long as the topic's own
// wording does not change (renaming a topic changing its id is the same tradeoff `packById`
// already accepts for a pack's own `id` field, one level up).
function slugify(text) {
  return String(text || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'topic';
}

export function packToTopics(pack) {
  return (pack.items || []).map((it) => ({
    id: slugify(it.topic),
    label: it.topic,
    video: it.video ? { kind: 'url', value: it.video } : null,
  }));
}

// Pull every topic's own bundled `questions[]` (trivia-shaped, per packs.js's own
// `checkLessonItem`) into ONE flat list, each tagged with its PARENT topic's id — the same
// `slugify(it.topic)` `packToTopics` uses, so a question and its topic's own unlock event
// name the same id. A topic with no `questions` contributes nothing; that is not an error,
// most lesson packs will have none.
export function questionsFromPack(pack) {
  const out = [];
  for (const it of pack.items || []) {
    if (!Array.isArray(it.questions) || !it.questions.length) continue;
    const topic = slugify(it.topic);
    for (const q of it.questions) {
      if (!q || !q.question || !q.correct) continue;
      out.push({
        question: q.question,
        answer: q.correct,
        wrong: (q.answers || []).filter((a) => a !== q.correct),
        topic,
      });
    }
  }
  return out;
}

// Module-scope, not per-instance — two Lessons panels on the same screen reading the same
// pack should share one fetch, same as Word Forge's own `loadPackCached`.
const packCache = new Map();
function loadPackCached(id) {
  if (packCache.has(id)) return packCache.get(id);
  const entry = packById(id);
  const p = entry ? loadPack(entry.url) : Promise.reject(new Error(`no such pack: ${id}`));
  // A failed fetch is not cached — a network blip should not permanently doom every
  // instance that asks for this pack for the rest of the page's life.
  p.catch(() => packCache.delete(id));
  packCache.set(id, p);
  return p;
}

// ---------------------------------------------------------------------------------------
// *** IT DECLARED NO SETTINGS, AND ITS OWN EMPTY-STATE COPY USED TO POINT AT THE MENU. ***
// ---------------------------------------------------------------------------------------
//
// That was G12: the "no topics" line said *"add some in this module's settings"* and this
// module declares none, so it sent somebody looking for a panel that was never built. The copy
// was fixed then; the missing panel was not, and `minWatchMs` has been live config that no
// surface could reach ever since.
//
// *** VIDEO SELECTION, CLOSED 2026-09-16 \u2014 BY A PACK, NOT AN EDITOR. ***
//
// Chat: Lessons *"says no video chosen and does not say where to choose one."* A topic's video
// lives in `state.topics[]` as `{kind, value}` PER TOPIC, and a list of objects was never going
// to be one settings row \u2014 a `videoUrl` row could only ever set the first topic's video, a
// control that lies about what it does. The two live options this file's own comment already
// named were a bespoke per-topic editor (the `board_editor.js` shape) or "the shared content
// source this keeps arriving at from every direction" \u2014 a `lesson`-kind pack was already
// declared and validated in `packs.js`, unconsumed by anything. This is that consuming half,
// mirroring Word Forge's own `contentSource`/`packId` rather than inventing a second mechanism
// for the same idea. A pack supplies topic + video (and optionally per-topic questions this
// file does not read \u2014 see `packToTopics`'s own note) ready-made; a caregiver with topics of
// their own still writes `state.topics[]` directly via `contentSource: 'bank'`, unchanged.
const SETTINGS = [
  // ESSENTIAL, and it is the only knob that changes what a person is asked to DO here: how long
  // the unlock button stays disabled after a lesson is opened. Too long and somebody who
  // genuinely watched is told to wait; too short and the honour button means nothing.
  { key: 'minWatchMs', label: 'Wait before the unlock button works', kind: 'choice',
    default: 30000, level: 'essential',
    options: [
      { value: 0,      label: 'No wait \u2014 trust them' },
      { value: 15000,  label: '15 seconds' },
      { value: 30000,  label: '30 seconds' },
      { value: 120000, label: 'Two minutes' },
    ],
    note: 'Unlocking a topic puts its questions into the game whether or not a video was '
      + 'watched, so this is a nudge rather than a gate.' },
  ...(LESSON_PACKS.length ? [
    { key: 'contentSource', label: 'Where topics come from', kind: 'choice', default: 'pack',
      level: 'standard',
      options: [{ value: 'bank', label: 'Written topics' },
                { value: 'pack', label: 'A built-in pack' }],
      note: 'A pack is ready-made, video included where one exists \u2014 nobody has to write '
        + 'topics or find videos first.' },
    { key: 'packId', label: 'Which pack', kind: 'choice', default: LESSON_PACKS[0].id,
      level: 'standard',
      options: LESSON_PACKS.map((p) => ({ value: p.id, label: p.label })) },
    // Also carries APPROVED transcript questions (row 2.24) — one routing for both, rather than
    // a second path for generated questions to drift away from.
    { key: 'questionsTo', label: 'Send lesson questions to', kind: 'choice',
      default: 'both', level: 'standard',
      options: [
        { value: 'both', label: 'Trivia and Word Forge' },
        { value: 'trivia', label: 'Trivia only' },
        { value: 'wordforge', label: 'Word Forge only' },
        { value: 'none', label: 'Neither' },
      ],
      note: 'A pack’s own questions, and transcript questions once they are approved.' },
  ] : []),
  // ---- transcript lessons (row 2.24) ----
  // Mike, 2026-09-28: "I would think answered correctly as the default. Make it a user setting.
  // You could go by number of correct answers or number of points." Points mode prices each right
  // answer with the same ladder Trivia uses (1, 0.75, 0.5, 0.25 by misses) — see transcript_quiz.js.
  { key: 'requireBy', label: 'A video’s points need', kind: 'choice', default: 'correct',
    level: 'standard',
    options: [{ value: 'correct', label: 'Correct answers' },
              { value: 'points', label: 'Points (less after a miss)' }] },
  // *** CHOSEN BY MIKE, 2026-09-29 (row 2.24): *** "default to 1 per minute for the first 5 minutes
  // and one for every two and a half minutes after that." Four settings, because each number is his
  // default rather than a rule; the requirement is also capped at however many checked questions
  // the model managed to write, so it is always reachable.
  { key: 'firstMinutes', label: 'For the first', kind: 'choice', default: 5, level: 'advanced',
    options: [{ value: 0, label: 'no separate start' }, { value: 3, label: '3 minutes' },
              { value: 5, label: '5 minutes' }, { value: 10, label: '10 minutes' }] },
  { key: 'firstEvery', label: '…one needed for every', kind: 'choice', default: 1, level: 'advanced',
    options: [{ value: 1, label: 'minute' }, { value: 2, label: '2 minutes' }] },
  { key: 'perMinutes', label: 'After that, one for every', kind: 'choice', default: 2.5, level: 'advanced',
    options: [{ value: 1, label: 'minute' }, { value: 2, label: '2 minutes' }, { value: 2.5, label: '2½ minutes' },
              { value: 3, label: '3 minutes' }, { value: 5, label: '5 minutes' }] },
  { key: 'minAnswers', label: 'But never fewer than', kind: 'choice', default: 1, level: 'advanced',
    options: [1, 2, 3, 5].map((n) => ({ value: n, label: String(n) })) },
  // *** HOW MANY ARE WRITTEN is its own thing (Mike, 2026-09-29: "I didn't want a number like that
  // put on the amount of questions made"). *** The model is asked for as many good questions as each
  // piece of the transcript supports. This ceiling exists only for someone who wants one — e.g. a
  // slow computer and a long lecture — and defaults to none. It replaced a hard-coded 40.
  { key: 'maxQuestions', label: 'Most questions to write', kind: 'choice', default: 0, level: 'advanced',
    options: [{ value: 0, label: 'No limit' }, { value: 10, label: '10' }, { value: 20, label: '20' },
              { value: 40, label: '40' }] },
  // The transcript goes to the model in pieces it can read whole (transcript_quiz.js
  // `splitTranscript`: measured, the local model here reads about 4,096 tokens at once, and a longer
  // transcript was silently cut). A setting because a bigger model reads bigger pieces.
  { key: 'pieceWords', label: 'Send the transcript in pieces of', kind: 'choice', default: 900, level: 'advanced',
    options: [{ value: 600, label: '600 words' }, { value: 900, label: '900 words' },
              { value: 1500, label: '1,500 words' }, { value: 3000, label: '3,000 words' }] },
  // §0h, agreed 2026-09-17: the review queue is ON by default; skipping it is opt-in.
  // *** FLIPPED 2026-09-28 — Mike: "Flip review." *** Auto-approve is the DEFAULT now: a question that
  // passes `grounded` (and, when the fact check is on, is not flagged by it) joins the games with no
  // person; anything flagged — by the fact check, a caregiver, or a player's contest — still waits.
  // The row stays, so a caregiver can turn review back on. What the flip gives up, stated rather than
  // hidden: by default nobody reads a generated question's WRONG options before they are asked, and
  // `grounded` checks only the right one (trivia.js's `makeQuestion` note says what is left).
  // Recorded AT GENERATION (transcript_quiz.js `reviewItems`), so neither turning this on later nor
  // the default changing approves an old backlog: questions generated before this change on an
  // account that never touched the setting were recorded "not auto-approved" and stay in the review
  // list until somebody approves them. That is deliberate — nobody chose to skip review for them.
  { key: 'autoApprove', label: 'Add checked questions to the games without review', kind: 'toggle',
    default: true, level: 'standard',
    note: 'Checked means the answer was found in the transcript line it quotes. It does not mean the video is right. '
      + 'Anything flagged still waits for a person.' },
  // *** THE FACT CHECK (register 258). DEFAULT ON — A DEFAULT, ARGUED BOTH WAYS, FLAGGED FOR MIKE. ***
  // For OFF: it is a request to a third party (the Wikimedia Foundation) from what may be a child's
  // device, and the device's address goes with any web request. `live_weather.js`, the nearest
  // precedent, is off by default. And the landing page says "Anything I add later arrives switched
  // off and needs its own separate yes" — written about what the SERVER stores (this stores nothing
  // new there beyond rows in an existing log), but a reader could fairly take it to cover this too.
  // For ON: the weather precedent is off because it sends a LOCATION, on a timer; this sends only
  // the question and answer a model wrote about a public video (see wikipedia.js), and only when a
  // person has just pressed "Make questions". Its only possible effect is holding a question back
  // for a person to look at — it cannot change an answer, block the quiz or cost a point. And Mike
  // asked for the lookup (register 258); off by default, it runs only for somebody who turns it on.
  // *** OFF, DECIDED IN REVIEW 2026-09-28, AND WHY. *** The landing page promises, publicly:
  // "Anything I add later arrives switched off and needs its own separate yes." A lookup that sends
  // question text to a third party and stores what it found (check events) is what a reader would
  // take that to cover, so it ships off and this row IS the separate yes (level 'standard', so it is
  // not hidden). If Mike reads the promise as covering only server storage, flip this default --
  // his call, logged as a change-list row.
  // *** RULED 2026-09-28 — Mike: "off for now, but try to make it obvious to the user rather than
  // just having it buried in settings." *** So it stays OFF, and the transcript panel carries a plain
  // checkbox right beside "Make questions" bound to THIS key (written through this module's own
  // state, exactly as this row writes it, so the two can never disagree). That checkbox is the
  // separate yes the landing page promises. Questions made with it off say "Not checked on
  // Wikipedia" once, in the quiz, with the same checkbox beside it.
  { key: 'factCheck', label: 'Look questions up on Wikipedia', kind: 'toggle', default: false,
    level: 'standard',
    note: 'Sends only each question and its answer to Wikipedia. A question Wikipedia seems to '
      + 'disagree with is held back until a person checks it; nothing else changes.' },
  // A LIVE choice (photos.js `sourceId`'s pattern): the options are whatever the model server on
  // THIS device lists, fetched only once somebody opens the transcript panel (see ai.js on why
  // nothing reaches for the model server on its own). '' = automatic. A model this device does not
  // have falls back to automatic, and the panel says so. The ADDRESS of the model server is not
  // here because it belongs to the DEVICE, not to this module's saved settings (a Pi and a desktop
  // run different servers), so it is a plain input in this module's own panel, stored per device by
  // ai.js. (The menu can edit text since 2026-09-28; that is no longer the reason.)
  { key: 'aiModel', label: 'AI model', kind: 'choice', default: '', level: 'advanced',
    emptyLabel: 'Automatic (best one on this device)' },
  // Measured 2026-09-28: qwen2.5:7b on this CPU-only desktop took 55-218s to write 3 questions
  // from a 2-3 minute transcript (five runs). A longer video sends more text and asks for more, so
  // 15 minutes is the default and longer is offered; a timeout that kills a job at 95% is worse
  // than a long wait with Cancel on screen.
  { key: 'aiTimeoutMs', label: 'Give the AI up to', kind: 'choice', default: 15 * 60 * 1000,
    level: 'advanced',
    options: [5, 15, 30, 60].map((m) => ({ value: m * 60 * 1000, label: `${m} minutes` })) },
  // algebra.js's own `subject` field, same shape. A topic that names its own subject (the written
  // DEFAULT_TOPICS do) is credited to that instead — it is the more specific fact; this is for
  // topics that say nothing, which is every pack topic today.
  { key: 'subject', label: 'Credit counts toward', kind: 'text', default: 'General',
    level: 'advanced', note: 'which subject a transcript lesson’s minutes count toward, when its topic names none' },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A topic's video, as an embeddable element. YouTube ids become a privacy-mode embed;
// a plain url becomes a <video>. No video at all is fine — the card still unlocks.
export function videoHTML(video) {
  if (!video || !video.value) return '';
  if (video.kind === 'youtube') {
    return `<iframe class="l-video" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.value)}"
      title="lesson video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }
  return `<video class="l-video" src="${esc(video.value)}" controls playsinline></video>`;
}

registerModule(
    // `network`, not `server`, and the distinction is the point of having both. MEASURED
    // 2026-09-05 with every handle rejecting: it still renders its list, gating and titles from
    // the built-in defaults - 284 characters of real content, better than any other content
    // module degraded. **But a lesson IS a video, and the videos are YouTube embeds** (see
    // `videoEl` above). So the platform being down leaves it useful and the INTERNET being down
    // leaves it a list of things it cannot play. That is exactly what `network` means, and
    // calling it `server` would have understated how well it survives a platform outage.
  { type: 'lessons', title: 'Lessons',
    dependsOn: 'network', description: 'Watch a short lesson, then answer questions about it',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    // The two rows this instance writes for Trivia/Word Forge to read — see lessons.js's own
    // comment on the two constants for why two separate, fully-OWNED-and-regenerated keys
    // rather than one shared, filtered one.
    const triviaQ = ctx.makeState ? ctx.makeState(TRIVIA_LESSON_QUESTIONS) : null;
    const wordforgeQ = ctx.makeState ? ctx.makeState(WORDFORGE_LESSON_QUESTIONS) : null;

    let lessons = null;
    let topics = DEFAULT_TOPICS;
    let cfg = { ...DEFAULTS };
    let openId = null;        // the topic whose lesson is showing
    let openedAt = 0;
    let ticker = null;
    // Guards against a stale pack fetch landing after a NEWER settings change (switch to a
    // different pack, or back to written topics) already superseded it — same shape as
    // Word Forge's own `wordGen`.
    let topicsGen = 0;

    // ---- transcript lessons (row 2.24) ----
    const rand = ctx.rand || Math.random;
    // `ctx.ai` is a TEST SEAM (like `ctx.now`/`ctx.rand`): anything with ai.js's createAI()
    // shape. Created lazily, so a Lessons panel nobody asks for a quiz never touches ai.js's
    // client at all.
    let aiClient = null;
    const ai = () => aiClient || (aiClient = ctx.ai || createAI());
    // `ctx.wikipedia`, the same kind of test seam: anything with wikipedia.js's `lookup`. Created
    // lazily too — nothing here reaches for Wikipedia until a fact check runs.
    let wikiClient = null;
    const wiki = () => wikiClient || (wikiClient = ctx.wikipedia || createWikipedia());
    const factJobs = new Set();               // running fact checks, so destroy() can stop them
    // The review log: ONE well-known, per-PROFILE events stream (transcript_quiz.js explains why
    // a log and not a state document). Per profile, not per instance, because the pool it feeds
    // is per profile — the routed rows are profile-wide — and two Lessons panels, or a phone and
    // a desktop, must see one queue. Polled slowly: a review is not a race.
    let tlog = null;
    let tlogReady = Promise.resolve();
    let contests = null;                      // the per-profile contests log (../contests.js)
    let ledger = null;                        // points, made when first needed
    let lastPack = null;
    let routedOnce = false;
    let poolSig = null;
    let reviewSig = null;
    let liveModels = [];                      // this device's model list, once somebody asked
    let aiStatus = '';
    let tq = null;                            // the one transcript-quiz session on this panel
    const tqEl = document.createElement('div');
    tqEl.className = 'l-tq';
    let lastListHtml = null;

    const el = (sel) => mount.querySelector(sel);
    const unlocked = () => (lessons ? lessons.unlocked() : new Set());
    const waited = () => Math.max(0, Math.floor((now() - openedAt) / 1000));
    const remaining = () => Math.max(0, Math.ceil(cfg.minWatchMs / 1000) - waited());

    const generatedItems = () => (tlog ? reviewItems(tlog.get().events || []) : []);
    const poolSignature = () => poolFrom(generatedItems()).map((q) => q.id).join(',');

    // Route this pack's own bundled questions to whichever game(s) `cfg.questionsTo` names,
    // fully REPLACING what this instance last wrote — never appending. Each game's own row is
    // this instance's alone to write, so there is no caregiver edit to protect against, but a
    // switch to a different pack (or to written topics, or `questionsTo: 'none'`) must not
    // leave a previous pack's questions playable forever; an empty write is exactly as real a
    // statement as a full one.
    //
    // APPROVED TRANSCRIPT QUESTIONS RIDE THE SAME ROUTE (row 2.24, §0h): the pool from the review
    // log is added to the pack's own questions here, so `questionsTo` governs both and the games
    // never learn a second source exists. Each carries its topic, so quest mode gates it exactly
    // like a pack question.
    function routeQuestions(pack) {
      lastPack = pack || null;
      routedOnce = true;
      poolSig = poolSignature();
      const generated = poolFrom(generatedItems()).map((q) => toRoutedQuestion(q, q.topic));
      const all = [...(pack ? questionsFromPack(pack) : []), ...generated];
      const toTrivia = all.length && (cfg.questionsTo === 'both' || cfg.questionsTo === 'trivia') ? all : [];
      const toWordforge = all.length && (cfg.questionsTo === 'both' || cfg.questionsTo === 'wordforge') ? all : [];
      // No `.load()` first: `set()`+`flush()` PUTs against `base_version` (0 if never loaded),
      // and state.js's own 409 handler already rebases onto server truth and retries — the
      // same guarantee every other caller of `flush()` relies on, not a shortcut unique to this.
      try { triviaQ?.set?.({ items: toTrivia }); triviaQ?.flush?.(); }
      catch (err) { console.error('lessons: could not route questions to trivia', err); }
      try { wordforgeQ?.set?.({ items: toWordforge }); wordforgeQ?.flush?.(); }
      catch (err) { console.error('lessons: could not route questions to wordforge', err); }
    }

    // Written topics resolve synchronously; a pack needs a fetch, so this is async either
    // way and guarded by `topicsGen` the same way Word Forge guards `resolveWords` — a
    // settings change mid-fetch (switch packs, or switch back to written topics) must not
    // have an in-flight older fetch land last and silently win.
    async function resolveTopics(snap) {
      const gen = ++topicsGen;
      if (cfg.contentSource === 'pack' && cfg.packId) {
        try {
          const pack = await loadPackCached(cfg.packId);
          if (gen !== topicsGen) return;           // superseded while the fetch was in flight
          const fromPack = packToTopics(pack);
          topics = fromPack.length ? fromPack : DEFAULT_TOPICS;
          render();
          await tlogReady;                         // route once, with the approved pool in it
          if (gen !== topicsGen) return;
          routeQuestions(pack);
          return;
        } catch (err) {
          console.error(`lessons: pack "${cfg.packId}" failed to load, falling back to written topics`, err);
          // fall through — an unreachable pack reads as no topics chosen, not a dead panel
        }
      }
      if (gen !== topicsGen) return;
      topics = Array.isArray(snap.topics) && snap.topics.length ? snap.topics : DEFAULT_TOPICS;
      render();
      await tlogReady;
      if (gen !== topicsGen) return;
      // Not a pack (or the fetch above failed) -- nothing bundled to route, and any earlier
      // pack's questions must not keep playing once this instance has moved off it.
      routeQuestions(null);
    }

    // *** THE COUNTDOWN IS NOT PART OF THE CARD'S MARKUP ANY MORE, and the list is only rebuilt
    // when what it SHOWS changed. *** Found 2026-09-28 while building row 2.24: the list was
    // rebuilt with innerHTML on every poll of the unlock log (every 4s, whether or not anything
    // changed) and every second of the countdown — and rebuilding recreates the lesson's <video>
    // or YouTube <iframe>, restarting it. Nobody saw it because no topic had a video yet; the
    // first one would have been unwatchable. So the button's disabled state and the "available in
    // Ns" text are applied in place (`applyCountdown`), and `render()` skips an identical rebuild.
    function card(t) {
      const isOpen = openId === t.id;
      const done = unlocked().has(t.id);
      return `
        <section class="l-card${done ? ' is-done' : ''}">
          <div class="l-head">
            <div>
              <h3>${esc(t.label)}${done ? '<span class="l-badge">unlocked</span>' : ''}</h3>
              ${t.blurb ? `<p class="l-blurb">${esc(t.blurb)}</p>` : ''}
            </div>
            <button class="l-btn${done ? '' : ' l-primary'}" data-open="${esc(t.id)}">
              ${isOpen ? 'Close' : (done ? 'Watch again' : 'Start lesson')}
            </button>
          </div>
          ${isOpen ? `
            <div class="l-body">
              ${videoHTML(t.video) || `<p class="l-none">No video has been chosen for
                <b>${esc(t.label)}</b> yet. Unlocking still puts its questions in the game.</p>`}
              <div class="l-actions">
                <button class="l-btn l-primary" data-watched="${esc(t.id)}">
                  ${done ? 'Already unlocked' : 'I’ve watched it — unlock the questions'}
                </button>
                <span class="l-wait" data-wait hidden></span>
                <button class="l-btn" data-tq-open="${esc(t.id)}">Quiz me from the transcript</button>
              </div>
              <div data-tq-slot="${esc(t.id)}"></div>
            </div>` : ''}
        </section>`;
    }

    function applyCountdown() {
      const b = el('[data-watched]');
      const w = el('[data-wait]');
      const r = remaining();
      if (b && !b.dataset.busy) b.disabled = r > 0;
      if (w) { w.textContent = r ? `available in ${r}s` : ''; w.hidden = !r; }
    }

    // The transcript panel is ONE element that lives across rebuilds, moved into its topic's slot
    // after each one — so a half-pasted transcript, a running job, or a question on screen
    // survives the list changing around it.
    function placeTq() {
      const slot = tq ? mount.querySelector(`[data-tq-slot="${CSS.escape(tq.topicId)}"]`) : null;
      if (slot) { if (tqEl.parentNode !== slot) slot.append(tqEl); } else if (tqEl.parentNode) tqEl.remove();
    }

    function render() {
      const host = el('[data-list]');
      if (!host) return;
      const n = unlocked().size;
      // *** SAY "NOT FINISHED YET" ONCE, AT THE TOP, RATHER THAN "BROKEN" ON EVERY CARD. ***
      //
      // G12, Mike off the live site: Lessons *"renders as broken rather than unfinished to
      // anybody who lands on it."* He is right, and both halves of why were copy:
      //
      //   * every opened card said "No video attached to this topic yet", which reads as a
      //     card that failed to load rather than a card nobody has filled in; and
      //   * the empty-topics line said "add some in this module's settings" — and this module
      //     DECLARES NO SETTINGS, so it pointed at a panel that does not exist. That is the
      //     same shape as A14, and a sentence sending somebody to look for a control that was
      //     never built is worse than saying nothing.
      //
      // What is true, and is now what it says: the topics ship with no videos chosen, and the
      // cards still do their real job — unlocking a topic puts its questions into the game
      // whether or not a video was watched, which is stated at the top of this file as a
      // deliberate design decision rather than a gap.
      const noVideos = topics.length && topics.every((t) => !(t.video && t.video.value));
      const note = el('[data-unfinished]');
      if (note) {
        note.hidden = !noVideos;
        note.textContent = 'No lesson videos have been chosen yet. The topics below still '
          + 'work: unlocking one puts its questions into the game.';
      }
      el('[data-count]').textContent = topics.length
        ? `${n} of ${topics.length} unlocked`
        : 'No topics on this screen yet.';

      const html = topics.map(card).join('');
      if (html === lastListHtml) { placeTq(); applyCountdown(); return; }
      // Keep whatever has focus inside the transcript panel (the paste box) focused across the
      // rebuild, with its selection.
      const active = document.activeElement;
      const keep = active && tqEl.contains(active)
        ? { node: active, s: active.selectionStart, e: active.selectionEnd } : null;
      if (tqEl.parentNode) tqEl.remove();
      host.innerHTML = html;
      lastListHtml = html;

      for (const b of host.querySelectorAll('[data-open]')) {
        b.addEventListener('click', () => {
          const id = b.dataset.open;
          openId = openId === id ? null : id;
          openedAt = now();
          render();
        });
      }
      for (const b of host.querySelectorAll('[data-watched]')) {
        b.addEventListener('click', async () => {
          const t = topics.find((x) => x.id === b.dataset.watched);
          if (!t) return;
          b.disabled = true;
          b.dataset.busy = '1';
          // How long the card stayed open before she pressed it — `openedAt` is stamped the
          // moment the card opens, above, already, for the countdown. This was the missing
          // half: the number existed on screen (`remaining()`'s countdown reads off it) and
          // was never carried into the durable record. See lessons.js's own note on why this
          // is NOT a reaction-time test the way board's or call's latency is — the minimum
          // wait is a stated nudge, not a gate — recorded anyway as real engagement time, the
          // same spirit as board.js's own header: it measures, and shows her nothing about it.
          // This button only ever exists in the DOM for the currently-open card (see `card`
          // above), so `openId === t.id` is already guaranteed here, not re-checked.
          const latencyMs = Math.max(0, now() - openedAt);
          await lessons.watch(t.id, { label: t.label, subject: t.subject, latencyMs })
            .catch((e) => console.error('lessons: watch', e));
          openId = null;
          render();
        });
      }
      for (const b of host.querySelectorAll('[data-tq-open]')) {
        b.addEventListener('click', () => openTq(b.dataset.tqOpen));
      }
      placeTq();
      if (keep && tqEl.contains(keep.node)) {
        try { keep.node.focus({ preventScroll: true }); keep.node.setSelectionRange?.(keep.s, keep.e); } catch { /* not a text field */ }
      }
      applyCountdown();
    }

    // =========================================================================================
    // TRANSCRIPT LESSONS (row 2.24)
    // =========================================================================================

    const TARGETS = { both: 'Trivia and Word Forge', trivia: 'Trivia', wordforge: 'Word Forge', none: null };
    const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
    const topicOf = (id) => topics.find((x) => x.id === id) || { id, label: id };
    const shuffled = (list) => {
      const a = [...list];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const getLedger = () => ledger || (ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus }));

    function rememberModels(models) {
      if (Array.isArray(models) && models.length) liveModels = models.filter(isChatModel);
    }

    // Asks the model server what it has — only ever because somebody opened the panel or pressed
    // Check (see ai.js on why nothing here reaches for it unasked).
    async function refreshModels() {
      const r = await ai().resolveModel(cfg.aiModel);
      rememberModels(r.models);
      aiStatus = r.ok
        ? `Connected. ${liveModels.length ? `Models here: ${liveModels.join(', ')}. ` : ''}Using ${r.model}`
          + (r.fellBack ? ` (the model chosen in settings, ${cfg.aiModel}, is not on this device).` : '.')
        : r.reason;
      const s = tqEl.querySelector('[data-ai-status]');
      if (s) s.textContent = aiStatus;
    }

    function openTq(topicId) {
      if (!tq || tq.topicId !== topicId) {
        if (tq && tq.controller) tq.controller.abort();
        tq = { topicId, stage: 'paste', draft: '', minutesChosen: null };
      }
      renderTq();
      placeTq();
      tqEl.querySelector('[data-tq-text]')?.focus({ preventScroll: true });
      refreshModels().catch(() => {});
    }

    function closeTq() {
      if (tq && tq.controller) tq.controller.abort();
      tq = null;
      tqEl.innerHTML = '';
      placeTq();
    }

    function pasteMinutes() {
      const auto = videoMinutes(tq.draft);
      return { auto, minutes: auto ?? tq.minutesChosen };
    }

    function needFor(minutes) {
      return requiredAnswers(minutes, { firstMinutes: cfg.firstMinutes, firstEvery: cfg.firstEvery,
        perMinutes: cfg.perMinutes, minimum: cfg.minAnswers });
    }

    // Only the parts that depend on what was pasted — never the textarea itself.
    function updatePasteInfo() {
      if (!tq || tq.stage !== 'paste') return;
      const has = !!tq.draft.trim();
      const { auto, minutes } = pasteMinutes();
      const mBox = tqEl.querySelector('[data-tq-minutes]');
      if (mBox) {
        mBox.innerHTML = has && auto == null
          ? `<p class="l-tq-help">No timestamps in this transcript. How long was the video?</p>
             <div class="l-tq-mins">${MINUTE_CHOICES.map((m) => `<button type="button" class="l-btn${tq.minutesChosen === m ? ' l-primary' : ''}"
               data-tq-minute="${m}">${m} min</button>`).join('')}</div>`
          : '';
        for (const b of mBox.querySelectorAll('[data-tq-minute]')) {
          b.addEventListener('click', () => { tq.minutesChosen = Number(b.dataset.tqMinute); updatePasteInfo(); });
        }
      }
      const need = tqEl.querySelector('[data-tq-need]');
      if (need) {
        const unit = cfg.requireBy === 'points' ? 'points' : 'correct answers';
        need.textContent = has && minutes
          ? `This video: ${plural(minutes, 'minute')} · ${needFor(minutes)} ${unit} needed · pays ${plural(minutes, 'School point')}`
          : '';
      }
      const make = tqEl.querySelector('[data-tq-make]');
      if (make) make.disabled = !(has && minutes);
    }

    function updateElapsed() {
      const e = tqEl.querySelector('[data-tq-elapsed]');
      if (!e || !tq || tq.stage !== 'working') return;
      const s = Math.max(0, Math.floor((now() - tq.startedAt) / 1000));
      e.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    function aiPanelHTML() {
      const { baseUrl } = ai().settings();
      return `<details class="l-ai" data-ai>
          <summary>AI on this device</summary>
          <p class="l-tq-help">Questions are written by a model running on this device, not on the
            website. The address of its server (Ollama's is filled in):</p>
          <div class="l-actions">
            <input class="l-ai-url" data-ai-url type="url" spellcheck="false" value="${esc(baseUrl)}"
              aria-label="Address of the AI server">
            <button type="button" class="l-btn" data-ai-save>Save</button>
            <button type="button" class="l-btn" data-ai-check>Check</button>
          </div>
          <p class="l-tq-help" data-ai-status>${esc(aiStatus)}</p>
        </details>`;
    }

    function renderTq() {
      if (!tq) { tqEl.innerHTML = ''; return; }
      const s = tq;
      const t = topicOf(s.topicId);
      const fl = factLineHTML(s);
      const factLine = `<p class="l-tq-help l-fc" data-fc role="status"${fl ? '' : ' hidden'}>${fl}</p>`;
      let body = '';
      if (s.stage === 'paste') {
        body = `
          <p class="l-tq-help">Paste the video's transcript. On YouTube it is under the description:
            <b>Show transcript</b>, then select it all and copy. A model on this device writes
            questions from it, and each one is checked against the transcript before it is asked.</p>
          <textarea class="l-tq-text" data-tq-text rows="7" placeholder="Paste the transcript here"
            aria-label="Transcript of ${esc(t.label)}"></textarea>
          <div data-tq-minutes></div>
          <p class="l-tq-need" data-tq-need></p>
          <div class="l-actions">
            <button type="button" class="l-btn l-primary" data-tq-make disabled>Make questions</button>
            ${factBoxHTML()}
            <button type="button" class="l-btn" data-tq-close>Close</button>
          </div>
          ${aiPanelHTML()}`;
      } else if (s.stage === 'working') {
        body = `
          <p class="l-tq-working" role="status">Writing questions${s.modelName ? ` with ${esc(s.modelName)}` : ''}…
            ${s.parts > 1 && s.part ? `<span data-tq-part>part ${s.part} of ${s.parts}</span> · ` : ''}<span data-tq-elapsed>0:00</span></p>
          <p class="l-tq-help">A model on a computer without a graphics card can take several minutes.
            Everything else here keeps working while it runs.</p>
          <div class="l-actions"><button type="button" class="l-btn" data-tq-cancel>Cancel</button></div>`;
      } else if (s.stage === 'error') {
        body = `
          <p class="l-tq-error" data-tq-error role="alert">${esc(s.error)}</p>
          <div class="l-actions">
            <button type="button" class="l-btn l-primary" data-tq-retry>Try again</button>
            <button type="button" class="l-btn" data-tq-close>Close</button>
          </div>
          ${aiPanelHTML()}`;
      } else if (s.stage === 'quiz') {
        const q = quizCurrent(s.quiz);
        const a = s.answered;
        const shown = s.shown || { options: [] };
        const head = `
          <p class="l-tq-progress" data-tq-progress>${esc(quizProgress(s.quiz).text)}</p>
          <p class="l-tq-help" data-tq-rejected>${s.rejected
            ? `${plural(s.rejected, 'question was', 'questions were')} dropped because the answer could not be checked against the transcript.`
            : `All ${plural(s.kept, 'question')} checked out against the transcript.`}</p>
          ${s.piecesFailed ? `<p class="l-tq-help" data-tq-pieces-failed>${plural(s.piecesFailed, 'part')} of the transcript
            could not be read by the model, so there are no questions from ${s.piecesFailed === 1 ? 'it' : 'them'}.</p>` : ''}
          ${s.paidAlready ? '<p class="l-tq-help">This video’s points were already earned, so this round is practice.</p>' : ''}
          ${s.fellBack ? `<p class="l-tq-help">The model chosen in settings is not on this device, so ${esc(s.modelName)} was used.</p>` : ''}
          ${factLine}
          ${s.fact ? '' : `<p class="l-tq-help l-fc-off" data-fc-off>Not checked on Wikipedia. ${factBoxHTML()}</p>`}`;
        if (a) {
          const contestedNow = s.contested && s.contested.has(a.id);
          body = `${head}
            <p class="l-tq-q">${esc(a.question)}</p>
            <ol class="l-tq-opts">${shown.options.map((o) => `<li><button type="button" class="l-btn l-tq-opt" disabled
              ${o === a.correctAnswer ? 'data-right="1"' : ''}${o === a.chosen && !a.correct ? 'data-wrong="1"' : ''}>${esc(o)}</button></li>`).join('')}</ol>
            <p class="l-tq-said ${a.correct ? 'is-right' : 'is-wrong'}" data-tq-feedback>${a.correct
              ? 'Right!'
              : `Not quite. The answer is <b>${esc(a.correctAnswer)}</b>. This one will come back later.`}</p>
            <blockquote class="l-tq-src" data-tq-source>From the transcript: “${esc(a.source)}”</blockquote>
            ${factNoteHTML(s, a.id, true)}
            <div class="l-actions">
              <button type="button" class="l-btn l-primary" data-tq-next>${a.met || s.quiz.met ? 'See how you did' : 'Next question'}</button>
              ${contestedNow ? '' : '<button type="button" class="l-btn" data-tq-contest>I think this question is wrong</button>'}
            </div>
            ${contestedNow ? `<p class="l-tq-help l-tq-contested" role="status" data-tq-contested>${s.contestFailed
              ? 'Thanks. It could not be saved just now, so it may come up again.'
              : 'Thanks — it’s held back until someone looks at it.'}</p>` : ''}`;
        } else if (q) {
          body = `${head}
            <p class="l-tq-q" data-tq-q>${esc(q.question)}</p>
            ${factNoteHTML(s, q.id, false)}
            <ol class="l-tq-opts">${shown.options.map((o, i) => `<li><button type="button" class="l-btn l-tq-opt"
              data-tq-opt="${i}">${esc(o)}</button></li>`).join('')}</ol>`;
        } else {
          body = `${head}<p class="l-tq-help">No questions are left to ask here.</p>
            <div class="l-actions"><button type="button" class="l-btn" data-tq-close>Close</button></div>`;
        }
      } else if (s.stage === 'done') {
        const target = TARGETS[cfg.questionsTo] ?? TARGETS.both;
        const pay = {
          paying: 'Recording the points…',
          paid: `You earned ${plural(s.minutes, 'School point')} for this video.`,
          already: 'This video’s points were already earned, so this round was practice.',
          failed: `The points could not be recorded${s.payError ? ` (${esc(s.payError)})` : ''}.`,
        }[s.payState] || '';
        const where = !target
          ? 'They are kept for review, but this screen sends lesson questions to neither game.'
          : s.autoApproved
            ? (s.factCheckOn
              ? `They join ${target} as each one’s Wikipedia check finishes; one Wikipedia seems to disagree with waits for a person.`
              : `The questions were added to ${target}.`)
            : `The questions are waiting below for a person to check them before they join ${target}.`;
        body = `
          <div data-tq-done>
            <p class="l-tq-progress"><b>Done.</b> ${esc(quizProgress(s.quiz).text.replace(' needed', ''))}.</p>
            <p>${pay}</p>
            <p class="l-tq-help">${where}</p>
            ${(s.tells || []).map((w) => `<p class="l-tq-warn">Worth a look: ${esc(w)}.</p>`).join('')}
            ${factLine}
          </div>
          <div class="l-actions">
            ${s.payState === 'failed' ? '<button type="button" class="l-btn l-primary" data-tq-pay>Try recording the points again</button>' : ''}
            <button type="button" class="l-btn" data-tq-close>Close</button>
          </div>`;
      } else if (s.stage === 'exhausted') {
        body = `<p class="l-tq-help" data-tq-error>Every question in this set was marked as looking wrong, so
            there is nothing left to ask. Making new ones from the same transcript often gives better ones.</p>
          <div class="l-actions">
            <button type="button" class="l-btn l-primary" data-tq-retry>Make new questions</button>
            <button type="button" class="l-btn" data-tq-close>Close</button>
          </div>`;
      }
      tqEl.innerHTML = `<h4 class="l-tq-title">Quiz from the transcript: ${esc(t.label)}</h4>${body}`;
      bindTq();
    }

    function bindTq() {
      const s = tq;
      const on = (sel, fn) => { for (const b of tqEl.querySelectorAll(sel)) b.addEventListener('click', fn); };
      const ta = tqEl.querySelector('[data-tq-text]');
      if (ta) {
        ta.value = s.draft;
        ta.addEventListener('input', () => { s.draft = ta.value; updatePasteInfo(); });
        updatePasteInfo();
      }
      on('[data-tq-close]', closeTq);
      on('[data-tq-make]', () => { makeQuestions(s).catch((e) => failWith(s, { reason: String(e?.message || e) })); });
      on('[data-tq-cancel]', () => s.controller?.abort());
      on('[data-tq-retry]', () => { s.stage = 'paste'; s.error = null; renderTq(); });
      on('[data-tq-pay]', () => { s.payState = null; pay(s); });
      for (const b of tqEl.querySelectorAll('[data-tq-opt]')) {
        b.addEventListener('click', () => answer(s, Number(b.dataset.tqOpt)));
      }
      on('[data-tq-next]', () => next(s));
      on('[data-tq-contest]', (ev) => { ev.currentTarget.disabled = true; contestFromQuiz(s); });
      for (const b of tqEl.querySelectorAll('[data-tq-factcheck]')) {
        b.addEventListener('change', () => setFactCheck(b.checked, s));
      }
      on('[data-fc-stop]', () => s.fact?.controller.abort());
      const url = tqEl.querySelector('[data-ai-url]');
      on('[data-ai-save]', () => {
        ai().setSettings?.({ baseUrl: url ? url.value : '' });
        if (url) url.value = ai().settings().baseUrl;
        refreshModels().catch(() => {});
      });
      on('[data-ai-check]', () => {
        const st = tqEl.querySelector('[data-ai-status]');
        if (st) st.textContent = 'Checking…';
        refreshModels().catch(() => {});
      });
      updateElapsed();
    }

    function failWith(session, r) {
      if (r.cancelled) session.stage = 'paste';
      else { session.stage = 'error'; session.error = r.reason || 'Something went wrong.'; }
      session.controller = null;
      if (tq === session) renderTq();
    }

    async function makeQuestions(session) {
      const text = session.draft;
      const { minutes } = pasteMinutes();
      if (!text.trim() || !minutes) return;
      const t = topicOf(session.topicId);
      const required = needFor(minutes);
      // *** HOW MANY TO WRITE IS NOT DERIVED FROM `required` (Mike, 2026-09-29). *** It used to be
      // `min(40, required + headroom)`. Now each piece of the transcript is asked for as many good
      // questions as it supports; `maxQuestions` is an optional ceiling (0 = none, the default).
      const ceiling = Number(cfg.maxQuestions) > 0 ? Math.floor(Number(cfg.maxQuestions)) : 0;
      const pieces = splitTranscript(text, { maxWords: cfg.pieceWords });
      Object.assign(session, { stage: 'working', error: null, startedAt: now(), modelName: '',
        controller: new AbortController(), payState: null, answered: null, part: 0, parts: pieces.length });
      renderTq();
      const { signal } = session.controller;
      const m = await ai().resolveModel(cfg.aiModel, { signal });
      if (tq !== session) return;
      rememberModels(m.models);
      if (!m.ok) { failWith(session, m); return; }
      session.modelName = m.model;
      session.fellBack = !!m.fellBack;
      renderTq();
      // One piece at a time: a CPU-only machine runs one model turn at once anyway, and a failure in
      // one piece keeps what the others wrote rather than throwing the whole video away.
      const parsed = [];
      let lastFail = null;
      let piecesFailed = 0;
      const r = { ms: 0 };
      for (let i = 0; i < pieces.length; i++) {
        if (ceiling && parsed.length >= ceiling) break;
        session.part = i + 1;
        if (tq === session) renderTq();
        const left = ceiling ? ceiling - parsed.length : null;
        const one = await ai().chat(buildPrompt(pieces[i], left, { part: i + 1, parts: pieces.length }),
          { model: m.model, json: true, temperature: 0.2, timeoutMs: cfg.aiTimeoutMs, signal });
        if (tq !== session) return;
        if (!one.ok) {
          if (one.cancelled) { failWith(session, one); return; }
          lastFail = one; piecesFailed += 1; continue;
        }
        r.ms += Number(one.ms) || 0;
        parsed.push(...parseQuestions(one.text));
      }
      if (!parsed.length && lastFail) { failWith(session, lastFail); return; }
      if (ceiling && parsed.length > ceiling) parsed.length = ceiling;
      session.piecesFailed = piecesFailed;

      const { passed, rejected } = checkQuestions(parsed, text);
      if (!passed.length) {
        failWith(session, { reason: parsed.length
          ? `The model wrote ${plural(parsed.length, 'question')}, but none could be checked against the transcript `
            + '(each answer has to be in the transcript line it quotes), so none are used. Trying again often works.'
          : 'The model answered, but no questions could be read from what it wrote. Trying again often works.' });
        return;
      }
      const seen = new Set();
      const lqs = [];
      for (const p of passed) {
        const lq = toLessonQuestion(p, rand);
        const id = questionId(t.id, lq);
        if (seen.has(id)) continue;
        seen.add(id);
        lqs.push({ ...lq, id });
      }
      const key = transcriptKey(t.id, text);
      Object.assign(session, {
        key, minutes, label: t.label,
        // The topic's own subject when it names one (the more specific fact), else the setting.
        subject: t.subject || cfg.subject,
        rejected: rejected.length, kept: lqs.length, tells: lengthTellsFor(lqs),
        autoApproved: !!cfg.autoApprove, factCheckOn: !!cfg.factCheck, controller: null,
        lqs, model: m.model,
      });
      try { await getLedger().load(); } catch { /* checked again, fresh, before paying */ }
      session.paidAlready = isPaid(tlog ? tlog.get().events || [] : [], key, ledger ? ledger.events() : []);
      try {
        // `factCheck` is recorded beside `autoApproved`, AT GENERATION, for the same reason: with
        // both on, a question joins the pool only once its check lands and did not flag it
        // (transcript_quiz.js `reviewItems`), and that must not change if the setting does later.
        await tlog?.append(REVIEW_KINDS.QUESTIONS, { topic: t.id, topicLabel: t.label, key,
          autoApproved: !!cfg.autoApprove, factCheck: !!cfg.factCheck, items: lqs, rejected: rejected.length,
          model: m.model, ms: r.ms, minutes });
      } catch (err) { console.error('lessons: could not record the generated questions', err); }
      if (tq !== session) return;
      session.quiz = startQuiz(lqs, { required, mode: cfg.requireBy, rand });
      session.stage = 'quiz';
      showQuestion(session);
      renderTq();
      if (session.factCheckOn) startFactCheck(session, lqs, m.model).catch((err) => console.error('lessons: fact check', err));
    }

    // =========================================================================================
    // THE FACT CHECK (register 258) — each question looked up on Wikipedia
    // =========================================================================================
    //
    // *** WHEN IT RUNS, ARGUED: after the questions are written, IN THE BACKGROUND, while the quiz
    // is already being asked. *** Measured 2026-09-28 on this desktop (qwen2.5:7b, CPU only): a
    // check costs 15-50 s a question (two Wikipedia searches ~1 s, then one model turn, and a second
    // short one only when the answers' words differ) — about two minutes for three questions,
    // after a generation that already took one to four. Holding the quiz for that would double the
    // wait for the part the person came for, and the check's only output is a flag, which only
    // matters to the LONG-TERM pool: a question stays in the review queue (pending by default)
    // long after these checks finish. The cost: a question can be asked before its check lands.
    //
    // *** A QUESTION FLAGGED MID-QUIZ STAYS IN THE QUIZ, CARRYING THE FLAG. *** Taking it out would
    // move the requirement under the player because of a background job, on the say-so of a 7B
    // model's reading — a suspicion, not a ruling. The quiz is about what the VIDEO said (its answer
    // key is the transcript's, by design), so the question is asked as the video put it, marked
    // "Wikipedia may disagree", and after answering the player sees Wikipedia's sentence and the
    // article's name. The player's own "This looks wrong" still takes it out, as before.
    //
    // ONE MODEL TURN PER QUESTION, NOT ONE FOR ALL: measured, batching would save almost nothing —
    // the fixed part (the instructions) is ~100 tokens that Ollama already reuses from its cache
    // between calls, while the per-question passages and answers cost the same either way. Per
    // question, a Stop lands between questions, progress is real, and one malformed reply costs one
    // question's check rather than all of them.
    //
    // It belongs to the MODULE, not the panel: closing the panel leaves it running (it only writes to
    // the review log); "Stop checking" and removing the module stop it. A question that already has
    // a finished check (the same question made again from the same video) is not looked up again.
    async function startFactCheck(session, lqs, model) {
      const prior = new Map(generatedItems().map((i) => [i.id, i.check]));
      const job = { total: lqs.length, current: 0, done: 0, results: {}, running: true,
        controller: new AbortController() };
      session.fact = job;
      factJobs.add(job);
      const { signal } = job.controller;
      const chat = (messages) => ai().chat(messages, { model, json: true, temperature: 0,
        timeoutMs: cfg.aiTimeoutMs, signal });
      const lookup = (q, a) => wiki().lookup(q, a, { signal });
      try {
        for (const q of lqs) {
          job.current += 1;
          showFact(session);
          const known = prior.get(q.id);
          let res;
          if (known && known.verdict !== FACT.NOT_CHECKED) {
            res = known;
          } else {
            const t0 = Date.now();
            res = await factCheck({ question: q.question, answer: q.correct }, { lookup, chat, signal });
            const rec = { id: q.id, verdict: res.verdict, reason: res.reason, quote: res.quote, title: res.title,
              url: res.url, wikipediaAnswer: res.wikipediaAnswer, model, ms: Date.now() - t0 };
            try {
              await tlog?.append(REVIEW_KINDS.CHECK, rec);
              // THE EXISTING FLAG MECHANISM, reused: this is what holds it out of the pool.
              if (res.verdict === FACT.CONTRADICTS) {
                await tlog?.append(REVIEW_KINDS.FLAG, { id: q.id, by: 'fact-check', reason: res.reason,
                  quote: res.quote, title: res.title, url: res.url });
              }
            } catch (err) { console.error('lessons: could not record the fact check', err); }
          }
          job.results[q.id] = res;
          job.done += 1;
          showFact(session, q.id);
        }
      } finally {
        job.running = false;
        factJobs.delete(job);
        showFact(session);
      }
    }

    const SAFE_WIKI = /^https:\/\/[a-z-]+\.wikipedia\.org\//;
    const wikiName = (r) => (r && r.title ? r.title : 'Wikipedia');

    // The progress/summary line for a session's check, or ''.
    function factLineHTML(session) {
      const job = session && session.fact;
      if (!job) return '';
      if (job.running && !job.controller.signal.aborted) {
        return `<span>Checking ${Math.min(job.current, job.total)} of ${job.total} on Wikipedia…</span>
          <button type="button" class="l-btn" data-fc-stop>Stop checking</button>`;
      }
      if (job.running) return '<span>Stopping the Wikipedia check…</span>';
      const rs = Object.values(job.results);
      const n = (v) => rs.filter((r) => r.verdict === v).length;
      const agree = n(FACT.SUPPORTS); const against = n(FACT.CONTRADICTS);
      const none = n(FACT.NOT_COVERED); const unchecked = n(FACT.NOT_CHECKED) + (job.total - rs.length);
      if (unchecked === job.total) {
        const why = rs.find((r) => r.verdict === FACT.NOT_CHECKED)?.reason || 'Stopped before it was checked.';
        return `<span>Not checked on Wikipedia. ${esc(why)}</span>`;
      }
      const parts = [
        agree ? `${agree} ${agree === 1 ? 'agrees' : 'agree'}` : '',
        against ? `${against} ${against === 1 ? 'seems' : 'seem'} to disagree (held back until a person checks)` : '',
        none ? `${none} not covered` : '',
        unchecked ? `${unchecked} not checked` : '',
      ].filter(Boolean);
      return `<span>Checked on Wikipedia: ${esc(parts.join(', '))}.</span>`;
    }

    // Update the check's line in place; re-render the quiz only when the question on screen is the
    // one whose result just landed (so its note appears), never otherwise — the paste box and a
    // question being answered are not rebuilt by a background job.
    function showFact(session, justId) {
      if (tq !== session) return;
      if (justId && session.stage === 'quiz' && (session.shown?.id === justId || session.answered?.id === justId)) {
        renderTq();
        return;
      }
      const line = tqEl.querySelector('[data-fc]');
      if (line) {
        line.innerHTML = factLineHTML(session);
        line.hidden = !line.innerHTML;
        line.querySelector('[data-fc-stop]')?.addEventListener('click', () => session.fact?.controller.abort());
      }
    }

    // What the quiz shows about one question's check. Before answering, only that Wikipedia may
    // disagree (its sentence could give an answer away); after, the sentence and the article.
    function factNoteHTML(session, id, answered) {
      const r = session.fact && session.fact.results[id];
      if (!r) return '';
      if (r.verdict === FACT.CONTRADICTS) {
        return answered
          ? `<p class="l-tq-warn" data-tq-fact="contradicts">Wikipedia may disagree with the video here: “${esc(r.quote)}” (${esc(wikiName(r))}).
              This question is held back from the games until a person checks it.</p>`
          : `<p class="l-tq-warn" data-tq-fact="contradicts">Wikipedia may disagree with the video on this one.
              Answer with what the video said; a person will check it.</p>`;
      }
      if (r.verdict === FACT.SUPPORTS && answered) {
        return `<p class="l-tq-help" data-tq-fact="supports">Wikipedia agrees (${esc(wikiName(r))}).</p>`;
      }
      return '';
    }

    function showQuestion(session) {
      const q = quizCurrent(session.quiz);
      // Options reshuffled every time a question is shown, so one that comes back after a miss
      // cannot be answered by remembering where the right one sat.
      session.shown = q ? { id: q.id, options: shuffled(q.answers) } : null;
      session.answered = null;
    }

    function answer(session, i) {
      if (!session.shown || session.answered) return;
      const chosen = session.shown.options[i];
      const q = quizCurrent(session.quiz);
      const res = quizAnswer(session.quiz, chosen);
      session.answered = { ...res, chosen, question: q ? q.question : '' };
      renderTq();
      if (res.met) pay(session);
    }

    function next(session) {
      if (session.quiz.met) { session.stage = 'done'; renderTq(); return; }
      if (session.quiz.exhausted) { session.stage = 'exhausted'; renderTq(); return; }
      showQuestion(session);
      renderTq();
    }

    // The PLAYER's "I think this question is wrong" — a CONTEST (../contests.js; it was §0h's
    // "this looks wrong" flag until 2026-09-28, and still IS that flag underneath). Offered only
    // after the question is answered. It:
    //   * leaves THIS quiz — the requirement shrinks with it, so contesting never strands anyone —
    //     while a right answer already given still counts and no points move (quizDrop keeps both);
    //   * is recorded in the per-profile contests log (module 'lessons', the question, its source
    //     line, its id) AND flags the question in the review log, which is what keeps it out of the
    //     pool until a person clears it in the review list below;
    //   * says thank you, and waits for Next like any other answer — it does not advance on its own.
    async function contestFromQuiz(session) {
      const a = session.answered;
      if (!a || !a.id || (session.contested && session.contested.has(a.id))) return;
      const lq = session.quiz.items[a.id] || { question: a.question, correct: a.correctAnswer, source: a.source };
      (session.contested ||= new Set()).add(a.id);
      session.contestFailed = false;
      pendingFlags.add(a.id);                       // so the contests sync does not flag it a second time
      quizDrop(session.quiz, a.id);
      if (tq === session) renderTq();
      if (session.quiz.met && session.payState == null) pay(session);
      const rec = await Promise.resolve(contests?.contest?.({ module: 'lessons', question: lq.question,
        answer: lq.correct, source: lq.source || '', qid: a.id, chosen: a.chosen })).catch(() => null);
      try {
        await tlog?.append(REVIEW_KINDS.FLAG, { id: a.id, by: 'player', contest: true,
          contestId: rec ? rec.cid : null, module: 'lessons' });
      } catch (err) {
        console.error('lessons: contest flag', err);
        if (!rec) session.contestFailed = true;
      } finally { pendingFlags.delete(a.id); }
      if (!rec && !tlog) session.contestFailed = true;
      if (tq === session && session.stage === 'quiz') renderTq();
    }

    // ---- THE FACT-CHECK CHECKBOX (Mike, 2026-09-28: "off for now, but ... obvious") ----
    // ONE control, drawn wherever it is offered (beside "Make questions"; in a quiz whose questions
    // were not checked). It writes the module's own `factCheck` through `state` — exactly what the
    // gear-menu row writes — and every copy of it follows `cfg` (see `syncFactBoxes`), so the two
    // can never disagree. A real <input type="checkbox"> inside its <label>: pointer, keyboard and
    // screen readers get it for free; a switch user reaches the same setting through the gear row.
    function factBoxHTML() {
      return `<label class="l-fc-opt"><input type="checkbox" data-tq-factcheck${cfg.factCheck ? ' checked' : ''}>
        Also check the answers on Wikipedia
        <span class="l-fc-note">(sends only each question and its answer to Wikipedia; a question it disagrees with waits for a person)</span></label>`;
    }

    function syncFactBoxes() {
      for (const b of tqEl.querySelectorAll('[data-tq-factcheck]')) b.checked = !!cfg.factCheck;
    }

    function setFactCheck(on, session) {
      try {
        state.set({ factCheck: !!on });
        Promise.resolve(state.flush && state.flush()).catch(() => {});
      } catch (err) { console.error('lessons: could not save the fact-check setting', err); }
      // Ticked beside questions that were NOT checked: that is a yes for these too, so check them
      // now. Unticked while a check runs: stop it — the same as "Stop checking".
      if (!session || tq !== session || !(session.stage === 'quiz' || session.stage === 'done')) return;
      if (on && !session.fact && session.lqs && session.lqs.length) {
        startFactCheck(session, session.lqs, session.model).catch((err) => console.error('lessons: fact check', err));
        renderTq();
      } else if (!on && session.fact && session.fact.running) {
        session.fact.controller.abort();
      }
    }

    // ---- CONTESTS FROM THE GAMES (../contests.js) ----
    // A transcript question contested in Trivia or Word Forge must be FLAGGED here too — the pool is
    // built from this log, and a flag is the one mechanism every hold already goes through. The
    // games cannot write this log (it is Lessons'), so whichever Lessons panel is open does it.
    // Each contest raises AT MOST ONE flag, ever: the flag carries the contest's id, and a contest
    // whose id is already on a flag (cleared or not) is not flagged again — so a device that has not
    // yet seen a Clear cannot put back a flag a person just removed.
    const pendingFlags = new Set();
    function syncContestFlags() {
      if (!tlog || !contests) return;
      const byKey = new Map(contests.list().filter((c) => c.status === CONTEST_STATUS.HELD).map((c) => [c.key, c]));
      if (!byKey.size) return;
      for (const i of generatedItems()) {
        const c = byKey.get(contestKey(i.question, i.correct));
        if (!c || i.status === 'rejected' || pendingFlags.has(i.id)) continue;
        const used = new Set(i.flags.map((f) => f.contestId).filter(Boolean));
        const fresh = c.contests.filter((x) => x.cid && !used.has(x.cid));
        if (!fresh.length || i.flagged) continue;
        const last = fresh[fresh.length - 1];
        pendingFlags.add(i.id);
        tlog.append(REVIEW_KINDS.FLAG, { id: i.id, by: 'player', contest: true, contestId: last.cid, module: last.module })
          .catch((err) => console.error('lessons: contest flag', err))
          .finally(() => pendingFlags.delete(i.id));
      }
    }

    // PAY ONCE per topic+transcript. The points ledger is the record (tagged with the key) and the
    // review log gets a `paid` marker after it; either one, found fresh right before paying,
    // blocks a second payment — after a reload, on another device, or from a second panel.
    // A point is a minute of subject credit (points.js header), so a video pays its minutes.
    async function pay(session) {
      if (session.payState) return;
      session.payState = 'paying';
      try {
        const lg = getLedger();
        await Promise.all([lg.load().catch(() => {}), tlog ? tlog.load().catch(() => {}) : null]);
        if (isPaid(tlog ? tlog.get().events || [] : [], session.key, lg.events())) {
          session.payState = 'already';
        } else {
          const done = await lg.award({ amount: session.minutes, type: 'School', minutes: session.minutes,
            source: 'lessons', subject: session.subject, note: session.label,
            tags: ['transcript', `transcript:${session.key}`] });
          session.payState = done ? 'paid' : 'failed';
          if (done) {
            await tlog?.append(REVIEW_KINDS.PAID, { topic: session.topicId, key: session.key,
              amount: session.minutes, subject: session.subject })
              .catch((err) => console.error('lessons: paid marker', err));
          }
        }
      } catch (err) {
        session.payState = 'failed';
        session.payError = String((err && err.message) || err);
      }
      // Answering the questions is a stronger proof than the honour button, so it also unlocks
      // the topic (a default; it only ever adds an unlock, never removes one).
      if (lessons && !unlocked().has(session.topicId)) {
        await lessons.watch(session.topicId, { label: session.label, subject: session.subject })
          .catch((e) => console.error('lessons: watch', e));
      }
      if (tq === session && session.stage === 'done') renderTq();
    }

    // ---- §0h: the review list ----
    // Also lists every question CONTESTED while playing (../contests.js) — transcript questions in
    // their own rows (they are flagged, so they wait here already), and any other question (a
    // Trivia bank row, a pack question, a Word Forge word) in a "Contested while playing" group.
    // Both get the same two answers: Clear (put it back) and Keep out.
    const SCREEN_NAMES = { trivia: 'Trivia', wordforge: 'Word Forge', lessons: 'the Lessons quiz' };
    const screens = (mods) => [...new Set(mods)].map((m) => SCREEN_NAMES[m] || m).join(' and ');
    function renderReview() {
      const box = el('[data-review]');
      if (!box) return;
      const items = generatedItems();
      const cList = contests ? contests.list() : [];
      const sig = JSON.stringify([cfg.questionsTo, items.map((i) => [i.id, i.status, i.flagged, i.flags.length,
        i.check && i.check.verdict, i.awaitingCheck]), cList.map((c) => [c.key, c.status, c.contests.length])]);
      if (sig === reviewSig) return;
      reviewSig = sig;
      const keyOf = (i) => contestKey(i.question, i.correct);
      const itemKeys = new Set(items.map(keyOf));
      const contestOf = new Map(cList.map((c) => [c.key, c]));
      const others = cList.filter((c) => !itemKeys.has(c.key));
      const othersHeld = others.filter((c) => c.status === CONTEST_STATUS.HELD);
      const othersOut = others.filter((c) => c.status === CONTEST_STATUS.KEPT_OUT);
      if (!items.length && !othersHeld.length && !othersOut.length) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      const waiting = items.filter((i) => i.status !== 'rejected' && (i.status === 'pending' || i.flagged));
      const inGames = poolFrom(items);
      const target = TARGETS[cfg.questionsTo] ?? TARGETS.both;
      const byBatch = new Map();
      for (const i of items) { if (!byBatch.has(i.key)) byBatch.set(i.key, []); byBatch.get(i.key).push(i); }
      // The fact check's verdict and the Wikipedia link, beside the question. The link only when it
      // really is a Wikipedia address — the log is shared, and a row is data, not trusted markup.
      const factHTML = (c) => {
        if (!c) return '';
        const link = c.url && SAFE_WIKI.test(c.url)
          ? ` <a class="l-rq-wiki" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title || 'Wikipedia')}</a>`
          : (c.title ? ` (${esc(c.title)})` : '');
        const quote = c.quote ? `<blockquote class="l-rq-src">Wikipedia: “${esc(c.quote)}”</blockquote>` : '';
        switch (c.verdict) {
          case FACT.CONTRADICTS:
            return `<p class="l-rq-fact is-contradicts" data-rq-fact="contradicts">Wikipedia seems to disagree. ${esc(c.reason)}${link}</p>${quote}`;
          case FACT.SUPPORTS:
            return `<p class="l-rq-fact is-supports" data-rq-fact="supports">Wikipedia agrees.${link}</p>${quote}`;
          case FACT.NOT_COVERED:
            return `<p class="l-rq-fact" data-rq-fact="not-covered">Wikipedia does not settle this one. ${esc(c.reason)}${link}</p>`;
          default:
            return `<p class="l-rq-fact" data-rq-fact="not-checked">Not checked on Wikipedia. ${esc(c.reason)}</p>`;
        }
      };
      const contestedLine = (mods) => `<p class="l-rq-flag l-rq-contested">Contested while playing${mods.length
        ? ` (in ${esc(screens(mods))})` : ''}. It stays out of the games until someone clears it.</p>`;
      const row = (i, { review }) => {
        const current = i.flags.slice(i.flagsCleared || 0);
        const c = contestOf.get(keyOf(i));
        const heldContest = c && c.status === CONTEST_STATUS.HELD ? c : null;
        const contestFlags = current.filter((f) => f.contest);
        const contested = i.flagged && (contestFlags.length > 0 || !!heldContest);
        const people = [...new Set(current.filter((f) => !f.contest).map((f) => f.by).filter((b) => b !== 'fact-check'))];
        const byCheck = current.some((f) => f.by === 'fact-check');
        const mods = [...contestFlags.map((f) => f.module).filter(Boolean), ...(heldContest ? heldContest.modules : [])];
        return `
        <div class="l-rq${i.flagged ? ' is-flagged' : ''}" data-rq="${esc(i.id)}">
          <p class="l-rq-q">${esc(i.question)}</p>
          <p class="l-rq-a">Answer: <b>${esc(i.correct)}</b> · also offered: ${esc((i.answers || []).filter((x) => x !== i.correct).join(', '))}</p>
          <blockquote class="l-rq-src">“${esc(i.source)}”</blockquote>
          ${factHTML(i.check)}
          ${i.awaitingCheck ? '<p class="l-rq-fact" data-rq-awaiting>Waiting for its Wikipedia check. It joins the games when the check finishes; Approve adds it now.</p>' : ''}
          ${contested ? contestedLine(mods) : ''}
          ${i.flagged && (people.length || byCheck) ? `<p class="l-rq-flag">${people.length ? `Marked “this looks wrong” by ${esc(people.join(' and '))}. ` : ''}${byCheck
            ? 'Held back because Wikipedia seems to disagree with the video. ' : ''}It stays out of the games until someone clears the mark.</p>` : ''}
          <div class="l-actions">
            ${review && i.status === 'pending' ? `<button type="button" class="l-btn l-primary" data-rq-approve>Approve</button>
              <button type="button" class="l-btn" data-rq-reject>Reject</button>` : ''}
            ${contested ? `<button type="button" class="l-btn" data-rq-clear>Clear (put it back)</button>
              <button type="button" class="l-btn" data-rq-keepout>Keep out</button>`
              : i.flagged ? '<button type="button" class="l-btn" data-rq-unflag>Clear the mark</button>'
                : '<button type="button" class="l-btn" data-rq-flag>This looks wrong</button>'}
          </div>
        </div>`;
      };
      const groups = [...byBatch.entries()].map(([key, batch]) => {
        const shown = batch.filter((i) => waiting.includes(i));
        if (!shown.length) return '';
        const tells = lengthTellsFor(batch);
        // "Not checked on Wikipedia", ONCE per set, only when the set was made with the check off
        // and nothing in it has been checked since — not on every row, and not a nag.
        const unchecked = !batch[0].factChecked && batch.every((i) => !i.check);
        return `<div class="l-rv-group">
            <p class="l-rv-topic">${esc(batch[0].topicLabel || batch[0].topic)}</p>
            ${unchecked ? '<p class="l-tq-help" data-rv-unchecked>Not checked on Wikipedia.</p>' : ''}
            ${tells.map((w) => `<p class="l-tq-warn">Worth a look: ${esc(w)}.</p>`).join('')}
            ${shown.map((i) => row(i, { review: true })).join('')}
          </div>`;
      }).join('');
      // Questions contested in a game that are not transcript questions: a bank row, a pack question.
      const otherRow = (c, { out }) => `
        <div class="l-rq is-flagged" data-contested-key="${esc(c.key)}">
          <p class="l-rq-q">${esc(c.question)}</p>
          ${c.answer ? `<p class="l-rq-a">Answer: <b>${esc(c.answer)}</b></p>` : ''}
          ${c.source ? `<blockquote class="l-rq-src">“${esc(c.source)}”</blockquote>` : ''}
          ${out ? '<p class="l-rq-flag">Kept out of the games.</p>' : contestedLine(c.modules)}
          <div class="l-actions">
            <button type="button" class="l-btn" data-rq-clear>Clear (put it back)</button>
            ${out ? '' : '<button type="button" class="l-btn" data-rq-keepout>Keep out</button>'}
          </div>
        </div>`;
      const contestedGroup = othersHeld.length ? `<div class="l-rv-group" data-rv-contested>
          <p class="l-rv-topic">Contested while playing</p>
          ${othersHeld.map((c) => otherRow(c, { out: false })).join('')}
        </div>` : '';
      box.innerHTML = `
        <h3 class="l-rv-title">Questions to check (${waiting.length + othersHeld.length})</h3>
        ${items.length ? `<p class="l-tq-help">A model wrote the transcript questions, and each one passed a check: its
          answer is in the transcript line shown. That does not mean the video is right; where a question was
          looked up on Wikipedia, what was found is shown with it.
          ${target ? `Approved questions join ${target}.` : 'This screen sends lesson questions to neither game.'}</p>` : ''}
        ${othersHeld.length || othersOut.length || cList.length ? `<p class="l-tq-help">A question somebody contested while playing is
          held out of every game on this profile until someone clears it.</p>` : ''}
        ${contestedGroup}
        ${groups || (contestedGroup ? '' : '<p class="l-tq-help">Nothing is waiting.</p>')}
        ${inGames.length ? `<details class="l-rv-in"><summary>In the games (${inGames.length})</summary>
          ${inGames.map((i) => row(i, { review: false })).join('')}</details>` : ''}
        ${othersOut.length ? `<details class="l-rv-in"><summary>Kept out (${othersOut.length})</summary>
          ${othersOut.map((c) => otherRow(c, { out: true })).join('')}</details>` : ''}`;
      const act = (sel, kind, data) => {
        for (const b of box.querySelectorAll(sel)) {
          b.addEventListener('click', () => {
            const id = b.closest('[data-rq]')?.dataset.rq;
            if (!id || !tlog) return;
            b.disabled = true;
            tlog.append(kind, { id, ...data }).catch((err) => { b.disabled = false; console.error('lessons: review', err); });
          });
        }
      };
      act('[data-rq-approve]', REVIEW_KINDS.REVIEW, { verdict: 'approved' });
      act('[data-rq-reject]', REVIEW_KINDS.REVIEW, { verdict: 'rejected' });
      // No accounts or roles exist to tell a caregiver from a player (row 2.21's guardian lock is
      // unbuilt), so `by` records WHICH SURFACE raised the flag: the review list, or the quiz.
      act('[data-rq-flag]', REVIEW_KINDS.FLAG, { by: 'caregiver' });
      // Clear / Keep out / Clear the mark. For a transcript question the CONTEST is settled FIRST and
      // the review log second, so no panel can see "unflagged but still contested" and flag it again.
      const itemById = new Map(items.map((i) => [i.id, i]));
      for (const b of box.querySelectorAll('[data-rq-clear], [data-rq-keepout], [data-rq-unflag]')) {
        b.addEventListener('click', async () => {
          const keep = b.hasAttribute('data-rq-keepout');
          const tRow = b.closest('[data-rq]');
          const i = tRow ? itemById.get(tRow.dataset.rq) : null;
          const key = i ? keyOf(i) : b.closest('[data-contested-key]')?.dataset.contestedKey;
          const c = key ? contestOf.get(key) : null;
          b.disabled = true;
          try {
            if (c && contests && (keep || c.status !== CONTEST_STATUS.CLEARED)) {
              await (keep ? contests.keepOut(key) : contests.clear(key));
            }
            if (i && tlog) {
              await tlog.append(keep ? REVIEW_KINDS.REVIEW : REVIEW_KINDS.UNFLAG,
                keep ? { id: i.id, verdict: 'rejected' } : { id: i.id });
            }
          } catch (err) { b.disabled = false; console.error('lessons: review', err); }
        });
      }
    }

    function onLog() {
      syncContestFlags();
      if (routedOnce && poolSignature() !== poolSig) routeQuestions(lastPack);
      renderReview();
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="lessons">
            <div class="l-top"><span data-count></span></div>
            <p class="l-unfinished" data-unfinished hidden></p>
            <div class="l-list" data-list></div>
            <section class="l-review" data-review hidden></section>
          </div>`;

        lessons = createLessons({ makeEvents: ctx.makeEvents, bus });
        lessons.subscribe(() => render());
        lessons.load().then(() => lessons.startPolling()).catch(() => {});

        if (typeof ctx.makeEvents === 'function') {
          tlog = ctx.makeEvents(TRANSCRIPT_STREAM, { limit: 1000, pollMs: 15000 });
          tlog.subscribe(onLog);
          tlogReady = tlog.load().catch(() => {});
          tlogReady.then(() => tlog && tlog.startPolling());
          // Contests raised in any game on this profile: listed in the review list, and a contested
          // transcript question is flagged here (`syncContestFlags`). Polled as slowly as the review
          // log; a contest from a panel on this same screen arrives at once through the bus.
          try {
            contests = createContests({ makeEvents: ctx.makeEvents, bus });
            contests.subscribe(onLog);
            contests.load().catch(() => {}).then(() => contests && contests.startPolling());
            bus.subscribe(CONTEST_TOPIC, () => { contests?.load().catch(() => {}); });
          } catch (err) { contests = null; console.error('lessons: no contests log', err); }
        }

        // Another device unlocked something — reflect it.
        bus.subscribe(LESSON_TOPIC, () => { lessons.load().catch(() => {}); });

        state.subscribe((s) => {
          const snap = s || {};
          const saved = readWithLegacy(snap, 'minWatchMs', LEGACY_MIN_WATCH);
          const num = (k, ok) => { const n = Number(snap[k]); return Number.isFinite(n) && ok(n) ? n : DEFAULTS[k]; };
          cfg = {
            minWatchMs: Number(saved) >= 0 ? Number(saved) : DEFAULTS.minWatchMs,
            // Same fix as wordforge.js's identical line, same day: this only ever checked FOR
            // 'pack', so an explicitly saved 'bank' fell through to DEFAULTS.contentSource too
            // — harmless while the default WAS 'bank', silently wrong the moment it flipped to
            // 'pack'. Now treats both saved values as real, defaulting only when neither was set.
            contentSource: (snap.contentSource === 'pack' || snap.contentSource === 'bank')
              ? snap.contentSource : DEFAULTS.contentSource,
            packId: typeof snap.packId === 'string' && snap.packId ? snap.packId : DEFAULTS.packId,
            // *** `questionsTo` WAS NEVER READ HERE (found 2026-09-28). *** This object replaced
            // `{ ...DEFAULTS }` without it, so after the first state delivery `cfg.questionsTo`
            // was undefined and `routeQuestions` routed NOTHING, whatever the setting said. It
            // went unseen because the one shipped lesson pack carries no questions, and the suite
            // proved the consuming half by writing the routed rows directly.
            questionsTo: QUESTIONS_TO_VALUES.includes(snap.questionsTo) ? snap.questionsTo : DEFAULTS.questionsTo,
            requireBy: snap.requireBy === 'points' ? 'points' : DEFAULTS.requireBy,
            // 0 is a real value for these two ("no separate start", "no limit"), so an unset null or
            // '' — which Number() also reads as 0 — must fall to the default, not to 0.
            firstMinutes: snap.firstMinutes == null || snap.firstMinutes === '' ? DEFAULTS.firstMinutes
              : num('firstMinutes', (n) => n >= 0),
            firstEvery: num('firstEvery', (n) => n > 0),
            perMinutes: num('perMinutes', (n) => n > 0),
            minAnswers: num('minAnswers', (n) => n >= 1),
            maxQuestions: snap.maxQuestions == null || snap.maxQuestions === '' ? DEFAULTS.maxQuestions
              : num('maxQuestions', (n) => n >= 0),
            pieceWords: num('pieceWords', (n) => n >= 50),
            // Default ON since 2026-09-28, so — like `factCheck` below — only an explicit false
            // turns it off, and never set reads as the default.
            autoApprove: snap.autoApprove === false || snap.autoApprove === 'false' ? false
              : snap.autoApprove === true || snap.autoApprove === 'true' ? true : DEFAULTS.autoApprove,
            // Only an explicit false turns it off; never set reads as the default.
            factCheck: snap.factCheck === false || snap.factCheck === 'false' ? false
              : snap.factCheck === true || snap.factCheck === 'true' ? true : DEFAULTS.factCheck,
            aiModel: typeof snap.aiModel === 'string' ? snap.aiModel : DEFAULTS.aiModel,
            aiTimeoutMs: num('aiTimeoutMs', (n) => n > 0),
            subject: typeof snap.subject === 'string' && snap.subject.trim() ? snap.subject.trim() : DEFAULTS.subject,
          };
          resolveTopics(snap);
          if (tq && tq.stage === 'paste') updatePasteInfo();
          syncFactBoxes();                        // the gear row changed it: every checkbox follows
          renderReview();
        });

        // Once a second, IN PLACE: the countdown, and the transcript job's elapsed time. Neither
        // rebuilds anything (see `card` on why that matters for an open video).
        ticker = setInterval(() => {
          if (openId) applyCountdown();
          if (tq && tq.stage === 'working') updateElapsed();
        }, 1000);
        render();
      },
      onResize() {},
      onHide() { state.flush(); },
      destroy() {
        if (ticker != null) { clearInterval(ticker); ticker = null; }
        if (tq && tq.controller) tq.controller.abort();
        for (const job of factJobs) job.controller.abort();
        tq = null;
        if (lessons) { lessons.destroy(); lessons = null; }
        if (tlog) { tlog.destroy(); tlog = null; }
        if (contests) { contests.destroy(); contests = null; }
        if (ledger) { ledger.destroy(); ledger = null; }
      },
      // LIVE OPTIONS for `aiModel` — photos.js's `settingsChoices` pattern. Empty until somebody
      // opened the transcript panel (or pressed Check) and this device's model server answered;
      // until then the row shows "Automatic" and says there is nothing to choose from yet.
      settingsChoices: () => (liveModels.length
        ? { aiModel: [{ value: '', label: 'Automatic (best one on this device)' },
                      ...liveModels.map((id) => ({ value: id, label: id }))] }
        : {}),
    };
  },
);

