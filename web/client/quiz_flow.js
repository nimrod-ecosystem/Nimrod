// quiz_flow.js — MIKE'S MISS FLOW, ONCE, FOR EVERY ANSWER GAME (row 2.45).
//
// Row 2.31 built the flow inside `modules/word_games.js`. Row 2.45 (Mike, 2026-09-30: *"Spelling
// should be another game. Simple version of math. Name that state, animal, person ... Karaoke."*)
// adds three more games that ask a question and wait, and the row says they use "the same miss
// flow as row 2.31". Written three more times it would drift three more ways, so the flow lives
// here and each game is an ADAPTER: what to ask, how to offer an answer, how to judge one, what
// the hints are. The engine owns the states.
//
// `word_games.js` imports its pure helpers from here too (normalize, fill, reasonFor, the chime,
// the celebration's stars), so Mike's wording and the "Y is only ever a true signal" rule have
// ONE home. Its own engine is not yet moved onto `createQuizEngine` — that is a behaviour-neutral
// follow-up with 176 checks to keep green, and it was not this row's job.
//
// ---------------------------------------------------------------------------------------
// THE FLOW (row 2.31, exactly)
// ---------------------------------------------------------------------------------------
//   1. a CONFIDENT wrong answer: "It sounded like you said X. That is incorrect." Then a hint.
//      Then the question again.
//   2. BELOW THE CONFIDENCE THRESHOLD: "It sounds like you might be saying X, but I'm not sure
//      because Y" — never a miss, never scored.
//   3. after `missesBeforeOffer` misses: "Would you like to try again, or hear the answer?"
//      Trying again gives the NEXT hint, if the game has one (spelling: the first letter, then how
//      many letters).
//   4. after a right answer, or after hearing the answer: THE NEXT QUESTION, by itself.
//      *** "WOULD YOU LIKE TO DO ANOTHER ONE?" IS GONE (Mike, 2026-10-02): "I don't think we should
//      be asking if you want to do another one after each question. I think that was my original
//      idea, but it ruins the flow of the game. They can just stop answering or ask the computer to
//      stop." *** So a right answer celebrates for `celebrateMs` and the next question follows; a
//      revealed answer stays up for `answerMs` and the next question follows; a press on either
//      skips the wait. To stop: stop answering (the question simply waits - a game waiting for its
//      input is the game, not a gate), or say a STOP_PHRASES phrase ("stop", "I'm done"), which ends
//      the sitting with "Thanks for playing." and a Play again button.
//      *** AND "ANOTHER ONE?" IS BACK AS A SETTING, OFF (Mike, 2026-10-02, the same day): "Yes. Skip
//      asking as default." *** `askAnother` (per game, off): on, a right answer celebrates and then
//      asks "Would you like to do another one?" (`anotherLine`), and a revealed answer is shown
//      with that question under it - Yes / No, I'm done (and Listen again for a clip). Somebody
//      who likes a breath between questions, or a caregiver pacing a session, turns it on; the
//      default is Mike's "it ruins the flow". Nobody answering leaves the question waiting, as
//      any question does - the input is the game, not a gate on something already running.
//   5. every question can be answered by voice OR a switch.
//
// *** AND ONE GAME MAY BE GENTLER, AS A SETTING. *** Name that person (row 2.45): missing a loved
// one's name can hit harder than missing an opposite, so its adapter can declare `missStyle`
// 'gentle' — a miss then says whose message it was and offers to listen again, and never says
// "incorrect". Mike's flow stays the default everywhere else, and is one setting away there too.
//
// ---------------------------------------------------------------------------------------
// THREE WAYS TO ANSWER, ONE JUDGE
// ---------------------------------------------------------------------------------------
//   offer    the switch path: one candidate at a time ("Is it 7?"), Yes on the right one is
//            right, No steps to the next. The same shape word_games uses.
//   entry    a letter or number board the person builds an answer on (spelling; math's number
//            pad). The board is scanned by `createScanBoard` below; the buffer lives here, so a
//            voice "C" and a switch "C" land in the same place.
//   voice    `hear({ text, confidence, alternatives, reason, nearMiss })`, the seam
//            `input_speech.js` already sends `speech/answer` to.
// All three end in `judgeValue`, so a right answer is right however it arrived, and paid once.
//
// *** THE SWITCH PATH HAS TWO SHAPES, AND A GAME PICKS ITS DEFAULT (`answerBy`, 2026-10-02 late). ***
// Mike: "Brain games shouldn't be yes/no by default. You should be able to say the answer. Yes/no should
// be an option though. That could be good to have yes/no head tracking for people that download head
// tracking." The two:
//   'yesno'    (FLOW_DEFAULTS, so every game that does not choose is unchanged) "Is it the square?" -
//              said, and answered Yes / No. Two answers, whatever the question: the shape for somebody
//              whose only signals are a yes and a no (a nod and a shake, two switches).
//   'choices'  the question is asked and NOTHING is offered: say the answer, tap it, or walk the choices
//              themselves with a switch (next / prev light one, select answers it). Brain games' default.
// `twoSwitch: 'yesno'` (Select is Yes, Next is No) means the yes/no shape whatever `answerBy` says: two
// switches that ARE yes and no have nothing to walk.

import { YES_WORDS, NO_WORDS } from './word_games_words.js';

export const ANSWER_TOPIC = 'speech/answer';
export const GRAMMAR_TOPIC = 'speech/grammar';
export const UNKNOWN = '[unk]';

// *** MIKE'S WORDING. *** The lines he gave (wrongLine, unsureLine, twoMissLine, and the flow around
// them) are his, 2026-09-30; the rest is Design's copy from voice.html. His fourth, anotherLine
// ("Would you like to do another one?"), he retired as the default on 2026-10-02 and kept as the
// `askAnother` setting (off) - see THE FLOW, item 4. Said only when that setting is on.
export const FLOW_LINES = Object.freeze({
  wrongLine: 'It sounded like you said {heard}. That is incorrect.',
  switchWrongLine: 'That is incorrect.',
  unsureLine: "It sounds like you might be saying {heard}, but I'm not sure because {reason}.",
  unsureNoReasonLine: "It sounds like you might be saying {heard}, but I'm not sure.",
  reasonQuiet: 'it was very quiet',
  reasonNoise: 'there was other noise',
  reasonCutoff: 'it was cut off',
  reasonAlternative: 'it could also be {alt}',
  hintLine: 'Here is a hint: {hint}.',
  twoMissLine: 'Would you like to try again, or hear the answer?',
  rightLine: 'Yes! {explain}',
  answerLine: 'Here is the answer. {explain}',
  anotherLine: 'Would you like to do another one?',
  doneLine: 'Thanks for playing.',
  notCaughtLine: "I didn't catch that. Say it again, or press your switch.",
});

export const FLOW_LINE_LABELS = Object.freeze({
  wrongLine: 'A heard answer that is wrong', switchWrongLine: 'A switch answer that is wrong',
  unsureLine: 'Not sure what was heard (with a reason)', unsureNoReasonLine: 'Not sure what was heard (no reason known)',
  reasonQuiet: 'Reason: very quiet', reasonNoise: 'Reason: other noise', reasonCutoff: 'Reason: cut off',
  reasonAlternative: 'Reason: another word it could be', hintLine: 'The hint',
  twoMissLine: 'After the misses', rightLine: 'A right answer', answerLine: 'Hearing the answer',
  anotherLine: 'Another one? (when it asks)', doneLine: 'Finished', notCaughtLine: "Didn't catch it",
});

/**
 * *** WHAT ENDS A SITTING, SAID ALOUD (2026-10-02). *** With "another one?" gone, "ask the computer
 * to stop" (Mike) is how somebody playing by voice says they are finished. Whole utterances only,
 * like every other spoken list: "stop" said ALONE ends it; "stop" inside a sentence does not.
 *
 * *** A STOP PHRASE THAT IS ONE OF THIS QUESTION'S OWN WORDS IS AN ANSWER, NOT A STOP. ***
 * "What is the opposite of go?" - "stop". The engine checks the question's own vocabulary first, so
 * the person answering is never told "Thanks for playing" for the right answer. "I'm done" and
 * "stop playing" still end that game.
 *
 * Not a setting, argued: it is a list of the ways people say one thing, the same kind of table as
 * input_speech.js PHRASES and YES_WORDS, and it grows by adding a row, not by a person tuning it.
 * NOT "done": the letter and number boards use "done" to check what was entered.
 */
export const STOP_PHRASES = Object.freeze(['stop', 'stop it', 'stop playing', 'stop the game', "i'm done",
  'im done', 'i am done', "i'm finished", 'im finished', 'i am finished', "that's enough", 'thats enough',
  'enough', 'no more', 'quit', 'end the game']);
export const isStop = (t) => STOP_PHRASES.includes(normalize(t));

// The same numbers word_games ships, for the same reasons (its DEFAULTS say why each one is what
// it is). Shared keys keep their word_games KIND too: `settings_audit` fails a key declared as two
// kinds in two modules, and a caregiver who learned the row in one game finds it in the next.
export const FLOW_DEFAULTS = Object.freeze({
  unsureBelow: 0.7,
  missesBeforeOffer: 2,
  correctPoints: 1,
  celebrateMs: 3000,
  // How long a revealed answer ("Here is the answer. COLD is the opposite of HOT.") stays before the
  // next question comes by itself. Longer than the celebration: it is a sentence to hear and a pair
  // to look at, not a chime. A press moves on sooner. A setting (below), 2-15 seconds.
  answerMs: 5000,
  // Ask "Would you like to do another one?" between questions. OFF (Mike, 2026-10-02: "Skip asking
  // as default"); THE FLOW, item 4.
  askAnother: false,
  sound: true,
  speak: true,
  sayChoice: true,
  twoSwitch: 'scan',
  answerBy: 'yesno',
  ownScore: 'auto',
  ...FLOW_LINES,
});

/**
 * The "how a switch answers" row, for a game that offers the choice (brain games). `on` is the game's
 * default. The yes/no shape is the one a head tracker's nod and shake can drive.
 */
export function answerByField({ on = 'choices', level = 'standard' } = {}) {
  return { key: 'answerBy', label: 'Answering', kind: 'choice', default: on, level,
    options: [{ value: 'choices', label: 'Say it, tap it, or step through the answers' },
              { value: 'yesno', label: 'Yes / no questions ("Is it the square?")' }],
    note: 'Yes / no suits two switches, or a nod and a shake. Saying the answer works either way.' };
}

/** The "how long the answer stays" row, shared with word_games.js (its own SETTINGS list). */
export const ANSWER_MS_FIELD = Object.freeze({ key: 'answerMs', label: 'How long a shown answer stays before the next question',
  kind: 'number', default: 5000, level: 'advanced', min: 2000, max: 15000, step: 1000, displayScale: 1000,
  unit: 'seconds', unitOne: 'second', note: 'A press moves on sooner.' });

/**
 * The "another one?" row, shared with word_games.js. ADVANCED, argued. FOR standard: it changes the
 * shape of a whole sitting, which a caregiver setting up the game should meet without digging. AGAINST,
 * and it wins: the standard menus are held to a press budget (simple_math_test: 12 presses to change
 * any one thing), Math's standard menu was at 12 and this row made it 13, and the default is Mike's own
 * ruling - the row is for the fewer people who want the pause back. [On Mike's list.]
 */
export const ASK_ANOTHER_FIELD = Object.freeze({ key: 'askAnother', label: 'Between questions', default: false,
  level: 'advanced', onLabel: 'Ask "Would you like to do another one?"', offLabel: 'Go straight on to the next one',
  note: 'Off: the next question comes by itself; saying "stop" or "I\'m done" ends the game.' });

/** The settings rows every answer game shares. `lines` adds a game's own spoken lines. */
export function flowSettings({ lines = {}, labels = {}, sayChoice = true } = {}) {
  const allLines = { ...FLOW_LINES, ...lines };
  return [
    { key: 'speak', label: 'Say the questions aloud', default: true, level: 'standard',
      onLabel: 'On', offLabel: 'Off' },
    ...(sayChoice ? [{ key: 'sayChoice', label: 'Say the switch choice too', default: true, level: 'standard',
      onLabel: 'Yes ("Is it this one?")', offLabel: 'Only the question',
      note: 'Somebody on a switch needs it; somebody answering aloud hears one possible answer.' }] : []),
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
    ...Object.keys(allLines).map((key) => ({ key, label: labels[key] || FLOW_LINE_LABELS[key] || key,
      kind: 'text', default: allLines[key], level: 'advanced' })),
  ];
}

// ---------------------------------------------------------------------------------------
// SMALL PURE HELPERS (moved here from word_games.js, which re-exports them)
// ---------------------------------------------------------------------------------------

export function normalize(text) {
  return String(text == null ? '' : text).toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Fill `{name}` placeholders. Missing values become empty, and the spacing is tidied. */
export function fill(template, vals = {}) {
  return String(template == null ? '' : template)
    .replace(/\{(\w+)\}/g, (_, k) => (vals[k] == null ? '' : String(vals[k])))
    .replace(/\s+([.,?!])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The same fill, for the SCREEN: template text escaped, values given as ready HTML. */
export function fillHtml(template, htmlVals = {}) {
  const parts = String(template == null ? '' : template).split(/(\{\w+\})/);
  return parts.map((p) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return m ? (htmlVals[m[1]] == null ? '' : htmlVals[m[1]]) : esc(p);
  }).join('').replace(/\s{2,}/g, ' ').trim();
}

export function shuffle(items, rand = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const firstToken = (t) => t.split(' ')[0] || '';
export const isYes = (t) => YES_WORDS.includes(t) || YES_WORDS.includes(firstToken(t));
export const isNo = (t) => NO_WORDS.includes(t) || NO_WORDS.includes(firstToken(t));
export const isAgain = (t) => /\b(again|try|repeat)\b/.test(t);
export const isReveal = (t) => /\b(answer|tell me|hear it)\b/.test(t);
export const isDone = (t) => /\b(done|finished|stop|enough)\b/.test(t);
export const isListen = (t) => /\b(listen|replay|play it|watch)\b/.test(t);

/**
 * THE REASON Y, OR NULL. Only a reason the recogniser reported: `reason` of quiet / noise /
 * cutoff, or an alternative word it handed back that differs from what it heard. Anything else
 * — no reason, an unknown one, an "alternative" with no word to name — is null, and the unsure
 * line is said without "because". A made-up reason is a lie told to somebody about their voice.
 */
export function reasonFor(result = {}, heard = '', lines = FLOW_LINES) {
  const r = String(result?.reason || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (r === 'quiet') return lines.reasonQuiet;
  if (r === 'noise') return lines.reasonNoise;
  if (r === 'cutoff') return lines.reasonCutoff;
  const alts = Array.isArray(result?.alternatives) ? result.alternatives : [];
  const alt = alts.map((a) => normalize(typeof a === 'string' ? a : a?.text))
    .find((a) => a && a !== normalize(heard) && a !== normalize(UNKNOWN));
  if (alt && (r === '' || r === 'alternative')) return fill(lines.reasonAlternative, { alt });
  return null;
}

// ---------------------------------------------------------------------------------------
// THE CHIME and THE CELEBRATION'S PIECES — warm, two notes, once, scaled by the bus master.
// ---------------------------------------------------------------------------------------
let chimeCtx = null;
export function defaultChime(level = 1, tag = 'quiz') {
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return;
    chimeCtx = chimeCtx || new AC();
    const a = chimeCtx;
    if (a.state === 'suspended') a.resume?.().catch(() => {});
    const peak = 0.1 * Math.max(0, Math.min(1, Number(level)));
    if (!(peak > 0)) return;
    for (const [freq, at] of [[523.25, 0], [659.25, 0.16]]) {
      const o = a.createOscillator();
      const v = a.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      const s = a.currentTime + at;
      v.gain.setValueAtTime(0, s);
      v.gain.linearRampToValueAtTime(peak, s + 0.02);
      v.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      o.connect(v).connect(a.destination);
      o.start(s);
      o.stop(s + 0.52);
    }
  } catch (err) { console.error(`${tag}: chime`, err); }
}

// Six stars, placed once (Design: "about 6 stars ... over 1.6 s"), as % of the game's box.
// Kept off the top centre, where "Yes!" is.
export const STARS = [[9, 14], [85, 17], [16, 74], [78, 70], [28, 42], [92, 48]];
export const CAT_URL = '/design-assets/nimrod-cat/happy.svg';

// ---------------------------------------------------------------------------------------
// SPOKEN LETTERS AND NUMBERS — what a recogniser hands back, turned into an answer
// ---------------------------------------------------------------------------------------

// Every name a letter goes by out loud, as a recogniser is likely to write it. "you", "are",
// "why", "see", "be", "oh" are words in every other game; in a SPELLING answer they are letters.
const LETTER_NAMES = {
  a: ['a', 'ay', 'eh'], b: ['b', 'be', 'bee'], c: ['c', 'see', 'sea', 'cee'], d: ['d', 'dee'],
  e: ['e'], f: ['f', 'ef', 'eff'], g: ['g', 'gee', 'jee'], h: ['h', 'aitch', 'haitch'],
  i: ['i', 'eye', 'aye'], j: ['j', 'jay'], k: ['k', 'kay'], l: ['l', 'el', 'ell'], m: ['m', 'em'],
  n: ['n', 'en'], o: ['o', 'oh'], p: ['p', 'pee', 'pea'], q: ['q', 'cue', 'queue'],
  r: ['r', 'are', 'ar'], s: ['s', 'es', 'ess'], t: ['t', 'tee', 'tea'], u: ['u', 'you'],
  v: ['v', 'vee'], w: ['w', 'doubleyou'], x: ['x', 'ex'], y: ['y', 'why', 'wye'],
  z: ['z', 'zee', 'zed'],
};
const LETTER_OF = Object.fromEntries(Object.entries(LETTER_NAMES)
  .flatMap(([l, names]) => names.map((n) => [n, l])));
/** Every spoken letter name, for a grammar. */
export const LETTER_WORDS = Object.freeze(Object.keys(LETTER_OF));

/**
 * "C A T", "see ay tee", "c. a. t." -> 'cat'. Null unless EVERY word is a letter: a whole word
 * said ("cat") is not a spelling, and pretending it was would make the game say the answer for
 * somebody who never spelled it.
 */
export function parseLetters(text) {
  const t = normalize(text).replace(/\bdouble (u|you)\b/g, 'doubleyou');
  if (!t) return null;
  const toks = t.split(' ').filter(Boolean);
  let out = '';
  for (const tok of toks) {
    const l = LETTER_OF[tok];
    if (!l) return null;
    out += l;
  }
  return out || null;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// A recogniser with no number grammar writes the sound. Only ever as the WHOLE utterance: "for"
// inside a sentence is a word, "four" said alone is a number.
const NUMBER_HOMOPHONES = { to: 2, too: 2, for: 4, fore: 4, ate: 8, won: 1 };

/** Number words or digits -> a non-negative integer, or null. "it's twenty one" -> 21. */
export function parseNumber(raw) {
  const s = String(raw == null ? '' : raw);
  const dm = /(^|[^\d])(\d{1,4})(?!\d)/.exec(s);
  if (dm) return Number(dm[2]);
  const t = normalize(s).replace(/-/g, ' ');
  if (!t) return null;
  if (Object.prototype.hasOwnProperty.call(NUMBER_HOMOPHONES, t)) return NUMBER_HOMOPHONES[t];
  const toks = t.split(' ');
  let total = null;
  let started = false;
  for (const tok of toks) {
    const one = ONES.indexOf(tok);
    if (one >= 0) { total = (total || 0) + one; started = true; continue; }
    if (TENS[tok]) { total = (total || 0) + TENS[tok]; started = true; continue; }
    if (tok === 'hundred' && started) { total = (total || 1) * 100; continue; }
    if (tok === 'and' && started) continue;
    if (started) break;
  }
  return started ? total : null;
}

/** 0..n as words, for a grammar ("seven", "twenty one"). */
export function numberWords(max) {
  const out = [];
  for (let n = 0; n <= Math.max(0, Math.min(999, max)); n++) out.push(numberWord(n));
  return out;
}
export function numberWord(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Object.keys(TENS).find((k) => TENS[k] === Math.floor(n / 10) * 10);
    return n % 10 ? `${t} ${ONES[n % 10]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  return n % 100 ? `${h} ${numberWord(n % 100)}` : h;
}

// ---------------------------------------------------------------------------------------
// THE SCAN BOARD — one switch over a letter board or a number pad
// ---------------------------------------------------------------------------------------
//
// 'rows' (the default, and the usual AAC shape): Next walks the ROWS; Select goes into one; Next
// then walks its keys and a last "back to the rows" stop; Select presses a key and returns to the
// rows, on the SAME row, so two letters that sit together cost one press less. 'keys': Next walks
// every key in order — simpler to understand, slower to use. Which one is a setting.
export function createScanBoard(getRows, { mode = () => 'rows' } = {}) {
  let level = 'rows';
  let r = 0;
  let c = 0;
  let i = 0;
  const rows = () => (getRows() || []).filter((row) => Array.isArray(row) && row.length);
  const flat = () => rows().flat();
  const linear = () => mode() === 'keys';
  function clamp() {
    const rs = rows();
    if (!rs.length) { r = 0; c = 0; i = 0; level = 'rows'; return; }
    if (r >= rs.length) r = 0;
    if (c > rs[r].length) c = 0;
    if (i >= flat().length) i = 0;
  }
  function step(d) {
    clamp();
    const rs = rows();
    if (!rs.length) return;
    if (linear()) { const n = flat().length; i = ((i + d) % n + n) % n; return; }
    if (level === 'rows') { r = ((r + d) % rs.length + rs.length) % rs.length; return; }
    const n = rs[r].length + 1;      // + the "back to the rows" stop
    c = ((c + d) % n + n) % n;
  }
  return {
    next: () => step(1),
    prev: () => step(-1),
    /** Returns the key pressed, or null when Select only moved between levels. */
    select() {
      clamp();
      const rs = rows();
      if (!rs.length) return null;
      if (linear()) return flat()[i] || null;
      if (level === 'rows') {
        if (rs[r].length === 1) return rs[r][0];
        level = 'keys'; c = 0; return null;
      }
      if (c >= rs[r].length) { level = 'rows'; return null; }
      const key = rs[r][c];
      level = 'rows';
      return key;
    },
    reset() { level = 'rows'; r = 0; c = 0; i = 0; },
    snapshot() { clamp(); return { mode: linear() ? 'keys' : 'rows', level, row: r, col: c, index: i }; },
  };
}

// ---------------------------------------------------------------------------------------
// THE ENGINE — the states and the miss flow, with no DOM.
// ---------------------------------------------------------------------------------------
//
// Phases: 'idle', 'loading' (a game whose items are still arriving), 'empty' (nothing to ask —
// the game says so plainly), 'asking', 'unsure', 'twoMiss', 'celebrate', 'answer' (a revealed
// answer on screen for `answerMs`, then the next question), 'gentle' (the gentle miss: "That was
// X's message. Let's listen again?"), 'another' ("Would you like to do another one?" - only when
// the `askAnother` setting is on, off by default since 2026-10-02), 'done' (somebody said stop).
//
// AN ADAPTER (one per game) — only `items`, `ask`, `judge` and `answer` are required:
//   items(cfg, rand)          the questions; null while still loading, [] when there are none
//   empty(cfg)                what to show when there are none
//   entry(cfg)                null (offer one candidate at a time) | 'letters' | 'digits'
//   ask(item, cfg)            the spoken question
//   candidates(item, cfg, rand)  the switch path's offers (one of them right)
//   offer(item, cand, cfg)    "Is it {cand}?"
//   judge(item, value)        true | false | null (null: cannot judge it — not a miss)
//   hint(item, n, cfg)        the nth hint, '' when there is no nth
//   answer(item)              the right answer
//   explain(item, answer, cfg)  "COLD is the opposite of HOT."
//   vocab(item, cfg)          the words a recogniser may hear right now (right AND wrong)
//   fromVoice(item, {text, raw}, cfg)  -> {value} | {append} | {command} | {note} | null
//   heardText(value)          how a heard answer is said back ("C, A, T")
//   missStyle(cfg)            'standard' (Mike's flow) | 'gentle'
//   gentle(item, cfg)         the gentle line
//   canReplay                 true when the question is a clip that can be played again
//   unknownLine(value, cfg)   what to say for a value `judge` could not judge
//   command(cmd, item, cfg)   a spoken command `fromVoice` returned that the engine does not know:
//                             'ask' (re-ask), another truthy value (handled), or falsy (not caught)
//   choiceLabel(item, value, cfg)  how a candidate reads (and is said) when the switch walks the answers
//                             ('choices', the header); absent: the value itself
//   demo(rand)                (quiz_view.js, not the engine) a question for the computer's demo, dealt
//                             WITHOUT touching the ladder or anything else the real game keeps
//
// `onResult` (added for row 2.45's adaptive games): called ONCE per question when it is finished —
// `{ game, item, right, misses, hintsGiven, revealed, skipped, via }`. Right; answer heard after the
// misses; the gentle miss; or skipped after at least one miss (a skip before any try is not a
// result: nothing was attempted). Rating and spaced review hang off this; a game that does not
// pass one is unchanged.
export function createQuizEngine({
  games = {}, cfg = () => ({}), rand = Math.random,
  say = () => {}, award = () => {}, chime = () => {}, onChange = () => {}, publishGrammar = () => {},
  onReplay = () => {}, onDeal = () => {}, onResult = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
} = {}) {
  const c = () => ({ ...FLOW_DEFAULTS, ...(cfg() || {}) });
  let gameId = null;
  let A = null;                // the adapter
  let deck = [];
  let at = -1;
  let item = null;
  let serial = 0;
  let paidSerial = -1;
  let resultSerial = -1;
  let phase = 'idle';
  let misses = 0;
  let hintsGiven = 0;
  let cands = [];
  let ci = 0;
  let highlight = 0;
  let feedback = null;
  let unsure = null;           // { heard, reason, pending: {value}|{append} }
  let revealed = false;
  let pair = null;
  let rightCount = 0;
  let asked = 0;
  let voiceSeen = false;
  let entry = '';
  let timer = null;
  let dead = false;

  const call = (fn, ...args) => (A && typeof A[fn] === 'function' ? A[fn](...args) : undefined);
  const entryMode = () => (A && typeof A.entry === 'function' ? A.entry(c()) || null : null);
  const heardText = (v) => (A && typeof A.heardText === 'function' ? A.heardText(v) : String(v));
  const style = () => (A && typeof A.missStyle === 'function' ? A.missStyle(c()) : 'standard');
  const canReplay = () => !!(A && A.canReplay);

  const candidate = () => cands[ci] ?? null;
  // The switch path's shape (`answerBy`, the header): 'choices' walks the answers; 'yesno' offers one.
  const offers = () => (c().answerBy === 'choices' && c().twoSwitch !== 'yesno' ? 'choices' : 'yesno');
  function askLine() { return item ? String(call('ask', item, c()) || '') : ''; }
  function candLine() {
    const cand = candidate();
    if (cand == null || entryMode() || offers() === 'choices') return '';
    return String(call('offer', item, cand, c()) || '');
  }
  const answerOf = () => String(call('answer', item) ?? '');
  const explainOf = (answer) => String(call('explain', item, answer, c()) || '');
  function hintAt(n) { return n >= 1 ? String(call('hint', item, n, c()) || '') : ''; }
  function nextHint() {
    const h = hintAt(hintsGiven + 1);
    if (h) hintsGiven += 1;
    return h;
  }

  function grammar() {
    if (!item) return [];
    const words = new Set();
    const add = (list) => (list || []).forEach((w) => w && words.add(String(w)));
    const answers = () => {
      add(call('vocab', item, c()));
      if (entryMode()) add(['delete', 'back', 'start over', 'check', 'done', 'say it again']);
      if (canReplay()) add(['listen again', 'play it again']);
    };
    if (phase === 'asking') answers();
    else if (phase === 'unsure') { answers(); add(YES_WORDS); add(NO_WORDS); add(['again', 'say it again']); }
    else if (phase === 'twoMiss') add(['try again', 'again', 'hear the answer', 'answer', 'tell me']);
    else if (phase === 'gentle') { add(YES_WORDS); add(NO_WORDS); add(['listen again', 'again']); }
    else if (phase === 'another') {
      add(YES_WORDS); add(NO_WORDS); add(['done', "i'm done"]);
      if (canReplay()) add(['listen again', 'again']);
    } else if (phase === 'done') { add(YES_WORDS); add(['play again', 'again']); }
    else return [];
    // The ways to say stop, in every phase that is waiting on somebody (a grammar-limited recogniser
    // can only hear what is listed). Done excepted: it has already stopped.
    if (phase !== 'done') add(STOP_PHRASES);
    // *** ALWAYS. *** Without it a grammar-limited recogniser snaps every sound to a listed word.
    words.add(UNKNOWN);
    return [...words];
  }

  function changed() {
    if (dead) return;
    try { const w = grammar(); publishGrammar({ open: w.length > 0, words: w, phase }); }
    catch (err) { console.error('quiz: grammar', err); }
    onChange();
  }
  const speak = (...lines) => { if (!dead) say(lines.filter(Boolean)); };
  function stopTimer() { if (timer !== null) { try { clearTimer(timer); } catch { /* gone */ } timer = null; } }

  function resetQuestion() {
    misses = 0; hintsGiven = 0; feedback = null; unsure = null; revealed = false; pair = null;
    ci = 0; highlight = 0; entry = '';
  }

  // ONCE PER QUESTION, like the points: the serial guard means a second hearing cannot report twice.
  function report(extra) {
    if (!item || resultSerial === serial) return;
    resultSerial = serial;
    try { onResult({ game: gameId, item, misses, hintsGiven, revealed, skipped: false, right: false, ...extra }); }
    catch (err) { console.error('quiz: result', err); }
  }

  function nextItem() {
    stopTimer();
    // Skipped after trying: a result (it was hard). Skipped before any try: nothing to report.
    if (item && phase === 'asking' && misses > 0) report({ skipped: true });
    const items = call('items', c(), rand);
    if (items == null) { item = null; phase = 'loading'; feedback = null; changed(); return; }
    if (!items.length) {
      item = null; phase = 'empty';
      feedback = { kind: 'empty', text: String(call('empty', c()) || '') };
      changed();
      return;
    }
    if (at + 1 >= deck.length || !deck.every((d) => items.includes(d))) {
      const prev = item;
      deck = shuffle(items, rand);
      // A fresh deal never opens on the question that just closed the last one.
      if (deck.length > 1 && deck[0] === prev) deck.push(deck.shift());
      at = 0;
    } else at += 1;
    item = deck[at];
    serial += 1;
    asked += 1;
    resetQuestion();
    cands = entryMode() ? [] : (call('candidates', item, c(), rand) || []);
    phase = 'asking';
    try { onDeal(item); } catch (err) { console.error('quiz: deal', err); }
    speak(askLine(), c().sayChoice ? candLine() : '');
    changed();
  }

  function setGame(id) {
    if (!Object.prototype.hasOwnProperty.call(games, id)) return false;
    gameId = id;
    A = games[id];
    deck = []; at = -1; item = null; rightCount = 0; asked = 0;
    nextItem();
    return true;
  }

  // Items arrived (or changed) for a game that was waiting on them. A question already being
  // asked is left alone: new people arriving must not snatch the clip somebody is watching.
  function refresh() {
    if (dead || !A) return;
    if (phase === 'loading' || phase === 'empty' || phase === 'idle') { deck = []; at = -1; nextItem(); }
  }

  function reAsk() {
    const fromTwoMiss = phase === 'twoMiss';
    phase = 'asking';
    unsure = null;
    highlight = 0;
    entry = '';
    const hint = fromTwoMiss ? nextHint() : '';
    feedback = hint ? { kind: 'hint', hint } : null;
    speak(hint ? fill(c().hintLine, { hint }) : '', askLine(), c().sayChoice ? candLine() : '');
    changed();
  }

  function onRight(answer) {
    if (phase !== 'asking' && phase !== 'unsure') return;
    stopTimer();
    phase = 'celebrate';
    feedback = null;
    unsure = null;
    pair = { answer, explain: explainOf(answer) };
    // *** ONCE PER QUESTION. *** The serial guard is what makes a double press, a second hearing
    // or a replayed event unable to pay twice.
    if (paidSerial !== serial) {
      paidSerial = serial;
      rightCount += 1;
      try { award({ amount: Number(c().correctPoints) || 0, game: gameId, item, answer }); }
      catch (err) { console.error('quiz: award', err); }
    }
    report({ right: true, answer });
    speak(fill(c().rightLine, { explain: pair.explain }));
    try { chime(); } catch (err) { console.error('quiz: chime', err); }
    const ms = Math.max(0, Number(c().celebrateMs) || FLOW_DEFAULTS.celebrateMs);
    timer = setTimer(() => { timer = null; onward(); }, ms);
    changed();
  }

  // After a celebration, a shown answer or the gentle miss: THE NEXT QUESTION - or, with the
  // `askAnother` setting on, "Would you like to do another one?" first.
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
    const answer = answerOf();
    revealed = true;
    pair = { answer, explain: explainOf(answer) };
    report({ right: false });
    stopTimer();
    // Asking "another one?": the answer is shown with the question under it, and no clock runs.
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
    const ms = Math.max(0, Number(c().answerMs) || FLOW_DEFAULTS.answerMs);
    timer = setTimer(() => { timer = null; onward(); }, ms);
    changed();
  }

  // Somebody said stop: "Thanks for playing." and a Play again button. A question that was being
  // tried counts as skipped (it was hard), exactly as a skip after a miss does.
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

  // The words that ANSWER this question (its vocabulary and the board's commands) - so a stop phrase
  // that is one of them ("stop", the opposite of "go") is judged as an answer, not taken as stop.
  function answerVocab() {
    const words = new Set();
    const add = (list) => (list || []).forEach((w) => w && words.add(normalize(w)));
    if (item) add(call('vocab', item, c()));
    if (entryMode()) add(['delete', 'back', 'start over', 'check', 'done', 'say it again']);
    if (canReplay()) add(['listen again', 'play it again']);
    return words;
  }
  const saidStop = (text) => isStop(text) && !answerVocab().has(normalize(text));

  function gentleMiss() {
    const answer = answerOf();
    revealed = true;
    pair = { answer, explain: explainOf(answer) };
    report({ right: false });
    phase = 'gentle';
    highlight = 0;
    unsure = null;
    entry = '';
    const text = String(call('gentle', item, c()) || '');
    feedback = { kind: 'gentle', text };
    speak(text);
    changed();
  }

  function onMiss({ heard, via }) {
    const k = c();
    misses += 1;
    // THE GENTLE FLOW: no "incorrect", no hint-and-again. It says whose it was and offers it again.
    if (style() === 'gentle') { gentleMiss(); return; }
    const said = heardText(heard);
    const line = via === 'voice' ? fill(k.wrongLine, { heard: said }) : fill(k.switchWrongLine, { heard: said });
    unsure = null;
    highlight = 0;
    entry = '';
    if (misses >= Math.max(1, Number(k.missesBeforeOffer) || FLOW_DEFAULTS.missesBeforeOffer)) {
      phase = 'twoMiss';
      feedback = { kind: 'wrong', text: line, heard: said, via };
      speak(line, k.twoMissLine);
    } else {
      phase = 'asking';
      const hint = nextHint();
      feedback = { kind: 'wrong', text: line, heard: said, via, hint };
      speak(line, hint ? fill(k.hintLine, { hint }) : '', askLine(), k.sayChoice ? candLine() : '');
    }
    changed();
  }

  // Said about a hearing that is NOT a verdict: the question stays open and no miss is counted.
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

  function toUnsure(value, result, pending) {
    const k = c();
    const heard = heardText(value);
    const reason = reasonFor(result, heard, k);
    phase = 'unsure';
    unsure = { heard, reason, pending };
    highlight = 0;
    feedback = null;
    speak(reason ? fill(k.unsureLine, { heard, reason }) : fill(k.unsureNoReasonLine, { heard }));
    changed();
  }

  function judgeValue(value, via) {
    const v = call('judge', item, value);
    if (v === true) return onRight(value);
    if (v === false) return onMiss({ heard: value, via });
    // NOT JUDGEABLE: not a miss. "I don't know" is not "wrong".
    const line = String(call('unknownLine', value, c()) || c().notCaughtLine);
    return note('unknown', line);
  }

  // ---- the entry buffer (spelling's letters, math's number pad) ----
  function maxEntry() {
    const n = Number(call('maxEntry', item, c()));
    return Number.isFinite(n) && n > 0 ? n : Math.max(1, answerOf().length + 3);
  }
  function type(ch, via = 'switch') {
    if (dead || phase !== 'asking' || !entryMode() || ch == null) return;
    const s = String(ch);
    if (!s) return;
    for (const one of s) {
      if (entry.length >= maxEntry()) break;
      entry += one;
    }
    if (feedback && feedback.kind !== 'wrong' && feedback.kind !== 'hint') feedback = null;
    // Long enough to be the answer: check it (a setting — somebody who wants to look before
    // committing turns it off and presses Check). A voice "C A T S" for CAT is checked too.
    if (c().checkWhenFull !== false && entry.length >= answerOf().length) { check(via); return; }
    changed();
  }
  function erase() { if (phase === 'asking' && entry) { entry = entry.slice(0, -1); changed(); } }
  function clearEntry() { if (phase === 'asking' && entry) { entry = ''; changed(); } }
  function check(via = 'switch') {
    if (dead || phase !== 'asking' || !entry) return;
    judgeValue(entry, via);
  }
  function repeat() { if (phase === 'asking') { speak(askLine(), c().sayChoice ? candLine() : ''); changed(); } }

  function runCommand(cmd) {
    if (cmd === 'erase') return erase();
    if (cmd === 'clear') return clearEntry();
    if (cmd === 'check') return check('voice');
    if (cmd === 'repeat') return repeat();
    if (cmd === 'replay') return press('replay');
    // A command the GAME owns (row 2.45: the word builder's "hint" and "new letters", the order
    // game's "ready"), said with confidence. 'ask' re-asks the question; any other truthy answer
    // means the game handled it itself; nothing means it was not one, as before.
    const own = call('command', cmd, item, c());
    if (own === 'ask') return repeat();
    if (own) return undefined;
    return notCaught();
  }

  function answerFrom(text, raw, result, confident) {
    const r = call('fromVoice', item, { text, raw }, c());
    if (!r) return notCaught();
    if (r.command) return confident ? runCommand(r.command) : notCaught();
    if (r.note) return note('other', r.note);
    if (r.append != null) {
      if (!confident) return toUnsure(r.append, result, { append: r.append });
      type(r.append, 'voice');
      return undefined;
    }
    return confident ? judgeValue(r.value, 'voice') : toUnsure(r.value, result, { value: r.value });
  }

  /**
   * THE RECOGNISER SEAM. `{ text, confidence, alternatives, reason, nearMiss }`.
   *   confidence  0..1; MISSING COUNTS AS UNSURE — a recogniser that cannot say how sure it is
   *               gets asked to confirm, never a verdict.
   *   nearMiss    what was heard was one sound off one of this game's words: always unsure.
   */
  function hear(result = {}) {
    if (dead || !A || !result || typeof result !== 'object') return;
    voiceSeen = true;
    if (phase === 'celebrate' || phase === 'answer' || phase === 'idle' || phase === 'loading' || phase === 'empty') { changed(); return; }
    const raw = String(result.text == null ? '' : result.text).trim();
    const text = normalize(raw);
    if (!raw || raw.toLowerCase() === UNKNOWN || (!text && !/\d/.test(raw)) || text === 'unk') return notCaught();
    const conf = Number(result.confidence);
    const confident = !result.nearMiss && result.confidence != null && Number.isFinite(conf)
      && conf >= Number(c().unsureBelow);
    // "Stop" / "I'm done", said with confidence while a question waits: the sitting ends. Unsure,
    // it is not caught (a stop is not worth a "did you mean" - saying it again costs nothing).
    if (confident && phase !== 'done' && saidStop(text)) return finish();
    switch (phase) {
      case 'asking':
        if (confident && canReplay() && isListen(text)) return press('replay');
        return answerFrom(text, raw, result, confident);
      case 'unsure':
        if (confident && isYes(text)) return press('confirm');
        if (confident && (isNo(text) || isAgain(text))) return press('reject');
        return answerFrom(text, raw, result, confident);
      case 'twoMiss':
        if (!confident) return notCaught();
        if (isAgain(text)) return press('again');
        if (isReveal(text)) return press('reveal');
        return notCaught();
      case 'gentle':
        if (!confident) return notCaught();
        if (isYes(text) || isAgain(text) || isListen(text)) return press('replay');
        if (isNo(text) || isDone(text)) return press('onward');
        return notCaught();
      case 'another':
        if (!confident) return notCaught();
        if (canReplay() && (isListen(text) || isAgain(text))) return press('replay');
        if (isYes(text)) return press('more');
        if (isNo(text) || isDone(text)) return press('finish');
        return notCaught();
      case 'done':
        if (confident && (isYes(text) || isAgain(text))) return press('restart');
        return undefined;
      default: return undefined;
    }
  }

  function stops() {
    switch (phase) {
      case 'asking':
        if (entryMode()) return [];
        // 'choices': the answers themselves are the stops - next lights one, select answers it.
        if (offers() === 'choices') {
          return [...cands.map((v) => ({ act: 'pick', value: v, label: String(call('choiceLabel', item, v, c()) || v) })),
            ...(canReplay() ? [{ act: 'replay', label: 'Listen again' }] : [])];
        }
        return [{ act: 'yes', label: 'Yes' }, { act: 'no', label: 'No' },
          ...(canReplay() ? [{ act: 'replay', label: 'Listen again' }] : [])];
      case 'unsure': return [{ act: 'confirm', label: 'Yes', heard: unsure?.heard || '' },
                             { act: 'reject', label: 'No' }, { act: 'again', label: 'Say it again' }];
      case 'twoMiss': return [{ act: 'again', label: 'Try again' }, { act: 'reveal', label: 'Hear the answer' }];
      case 'gentle': return [{ act: 'replay', label: 'Listen again' }, { act: 'onward', label: 'Next one' }];
      case 'another': return [{ act: 'more', label: 'Yes' },
        ...(canReplay() ? [{ act: 'replay', label: 'Listen again' }] : []),
        { act: 'finish', label: "No, I'm done" }];
      case 'done': return [{ act: 'restart', label: 'Play again' }];
      default: return [];
    }
  }

  function press(act, stop = null) {
    if (dead || !item) return;
    switch (act) {
      // A walked-to answer ('choices'): judged exactly like a heard or touched one; wrong says the
      // switch line, never "It sounded like you said".
      case 'pick': {
        if (phase !== 'asking' || entryMode()) return;
        const v = stop && stop.value != null ? stop.value : null;
        if (v == null || v === '') return;
        judgeValue(v, 'switch');
        return;
      }
      case 'yes': {
        if (phase !== 'asking' || entryMode()) return;
        const cand = candidate();
        if (cand == null) return;
        if (call('judge', item, cand) === true) { onRight(cand); return; }
        // A wrong candidate is spent: the next offer is a different one.
        ci = (ci + 1) % Math.max(1, cands.length);
        onMiss({ heard: cand, via: 'switch' });
        return;
      }
      case 'no': {
        if (phase !== 'asking' || entryMode()) return;
        const cand = candidate();
        if (cand == null) return;
        if (call('judge', item, cand) === true) { onMiss({ heard: cand, via: 'switch' }); return; }
        // Right to say no to a wrong one: not a miss, just the next offer.
        ci = (ci + 1) % Math.max(1, cands.length);
        highlight = 0;
        feedback = null;
        speak(candLine());
        changed();
        return;
      }
      case 'confirm':
        if (phase !== 'unsure' || !unsure) return;
        if (unsure.pending?.append != null) {
          const letters = unsure.pending.append;
          phase = 'asking'; unsure = null; feedback = null;
          type(letters, 'voice');
          return;
        }
        judgeValue(unsure.pending ? unsure.pending.value : unsure.heard, 'voice');
        return;
      case 'reject':
      case 'again':
        if (phase === 'unsure' || phase === 'twoMiss') reAsk();
        return;
      case 'reveal':
        if (phase === 'twoMiss') reveal();
        return;
      case 'replay':
        if (!canReplay()) return;
        if (phase === 'asking') { try { onReplay(item); } catch (err) { console.error('quiz: replay', err); } speak(askLine(), c().sayChoice ? candLine() : ''); changed(); return; }
        // After the gentle miss: play it again and STAY on the gentle choice (Listen again / Next one),
        // so the next question never starts over the person on screen.
        if (phase === 'gentle') { try { onReplay(item); } catch (err) { console.error('quiz: replay', err); } changed(); }
        // On "another one?": play it again, then ask again (the host holds the line until the clip
        // has finished, so it is never said over the person on screen).
        if (phase === 'another') { try { onReplay(item); } catch (err) { console.error('quiz: replay', err); } toAnother(); }
        return;
      case 'onward':
        if (phase === 'gentle') onward();
        return;
      // A press during the celebration or a shown answer: on now, not after the wait (to the next
      // question, or to "another one?" when that is asked). `more` is also "Yes" to "another one?".
      case 'continue':
      case 'more':
        if (phase === 'another') { if (act === 'more') nextItem(); return; }
        if (phase === 'celebrate' || phase === 'answer') onward();
        return;
      case 'finish':
        if (phase === 'done' || phase === 'idle' || phase === 'loading' || phase === 'empty') return;
        finish();
        return;
      case 'restart':
        if (phase === 'done') { rightCount = 0; asked = 0; nextItem(); }
        return;
      case 'check': check('switch'); return;
      case 'erase': erase(); return;
      case 'clear': clearEntry(); return;
      case 'repeat': repeat(); return;
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
    // Walking the answers: the lit one is said (with "Say the switch choice too", the same row that says
    // "Is it 7?" in the yes/no shape), so somebody who cannot see the tiles still knows where they are.
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

  /**
   * A WHOLE ANSWER CHOSEN DIRECTLY — a touched tile ("the smallest is 3"), not an offer walked to.
   * Judged exactly as a heard or offered answer is; `via` is anything but 'voice', so a wrong one
   * gets the switch line ("That is incorrect."), never "It sounded like you said".
   */
  function answer(value, via = 'touch') {
    if (dead || !item || phase !== 'asking' || value == null || value === '') return;
    judgeValue(value, via);
  }

  return {
    start: (id) => setGame(id != null ? id : Object.keys(games)[0]),
    setGame, refresh, hear, press, stops, grammar, select, answer,
    type, erase, clearEntry, check,
    next: () => move(1),
    prev: () => move(-1),
    skip: () => { if (A && !dead && phase !== 'loading' && phase !== 'empty') nextItem(); },
    game: () => gameId,
    entryMode,
    snapshot: () => ({
      game: gameId, phase, item, misses, candidate: candidate(), candidates: cands.slice(), highlight,
      feedback: feedback ? { ...feedback } : null, unsure: unsure ? { ...unsure } : null,
      revealed, pair: pair ? { ...pair } : null, rightCount, asked, serial, voiceSeen,
      askLine: item ? askLine() : '', candLine: item ? candLine() : '', timerPending: timer !== null,
      entry, entryMode: entryMode(), hintsGiven,
      hints: Array.from({ length: hintsGiven }, (_, i) => hintAt(i + 1)),
      canReplay: canReplay(),
      offers: offers(),
      // The answer the switch has lit, in the 'choices' shape (null otherwise).
      lit: (() => { if (phase !== 'asking') return null; const s = stops()[highlight]; return s && s.act === 'pick' ? s.value : null; })(),
    }),
    destroy() { stopTimer(); dead = true; },
  };
}
