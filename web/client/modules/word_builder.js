// word_builder.js — THE WORD BUILDER (row 2.45): a few big letters, find the words they make.
//
// Mike, 2026-10-01 (notes AQ/AR): a favourite was a letters-to-words game, too visual now; build OUR
// OWN, "made for her (fewer letters, big, read aloud, voice or switch)". Our own version, nothing
// copied: the words are hand-written (`word_builder_words.js`, MIT, sources stated there), the sets
// are generated from them, and there is no wheel, no crossword and no timer.
//
// HOW IT PLAYS. Three to five big letters are shown and read aloud ("Make a word from C, A, T").
// An answer is a word made from them, each letter used once:
//   * VOICE: say the word ("cat"), or spell it ("C A T").
//   * ONE SWITCH: walk the letters, select to add one; then the Check stop; Undo takes the last
//     letter back. Hint, Hear it and New letters are stops on the same row. The module's `back` verb
//     is Undo as well.
//   * TOUCH: the same letters and stops, touched.
// Each word found is one answer on the shared miss flow (`quiz_flow.js`): "Yes! CAT. 2 more to
// find.", the chime, a point, then straight on to the next word (no "another one?" since 2026-10-02). The same letters stay until every
// word they ask for is found, then new ones come.
//
// WHAT IS A MISS, AND WHAT IS NOT. Only an answer that CANNOT be made from these letters is a miss
// (said aloud: "dog" from C, A, T). A word made from them that is not on the list is NOT called wrong
// ("TCA is not on this list"), and neither is one already found: the list is small and English is
// not, so the game never tells somebody a real word is not a word.
//
// A LIST, NOT A CROSSWORD GRID (argued, as asked). FOR the grid: it is the familiar look, and the
// crossing letters are free hints. AGAINST: a grid is a visual-spatial puzzle laid on top of the word
// puzzle (where does this word go, which squares cross), which is the "too visual" part of the game
// this is replacing; it has to be drawn small to fit, and on a switch or by voice nobody places
// words anyway. So: one big list, found words written out, the ones still to find shown as blanks
// with their length (a setting), which keeps the "how long is it" clue the grid gave.
//
// DIFFICULTY: the shared ladder (`adaptive_play.js`, `rating.js`). A letter set is the "question";
// every word found (or not) is one answer against it, so the set's own rating learns how hard it is,
// and a player who finds more than 80% of words cleanly moves up a level (more letters, rarer words).
// Two to four players take turns, one word each, each with their OWN letters at their own level.
//
// PLAYING TOGETHER, AND FROM A CALL (2026-10-12; Mike: Word Builder is the next game playable together from a call).
// "Play together" works as Quiz mix's does - the room, the lobby, "On this call", and the caller's one-press ask are
// the layer the two games share (game_together.js; the server half is web/server/game_rooms.py). What a TURN is here:
// ONE WORD FROM THE PLAYER'S OWN LETTERS. Each screen deals its own players' letters off its own login's ladder,
// judges the word there, and sends back only { seat, right, points } (one point a word; the server holds a Word
// Builder room to that and to one fixed category, so neither the letters nor the word typed or said ever crosses).
// The host keeps the turn order (every seat, wherever it sits) and the table; a game together is `togetherRounds`
// rounds of one word each, then the table and Play again. Alone, the game is as it was: it goes on until stopped.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, fill, esc, normalize, parseLetters, LETTER_WORDS } from '../quiz_flow.js';
import { quizModule, up } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, openPersonLadder, MAX_PLAYERS } from '../adaptive_play.js';
import { createTogether, scoreWords, REMOTE_TURN_MS } from '../game_together.js';
import { PUZZLES, TIER, canMake } from '../word_builder_words.js';
// 2026-10-02 late: opens waiting for Start, silent until then (quiz_view.js start gate, game_start.js).
// No demo yet, so no "While nobody is playing" row.
import { autostartFields, START_VOICE } from '../game_start.js';

export const GAME = 'word_builder';
/** One game; listed so a spoken route's `{ game }` can be checked against it like the others. */
export const GAMES = Object.freeze([GAME]);
// THE SHORTEST WORD, ARGUED (not a setting): two-letter words are nearly all small joining words
// (at, to, of, an), which are poor finds and would crowd every set with near-free answers. Three is
// also where the hand-written list starts, so a setting below it would have nothing behind it.
export const MIN_WORD = 3;
// PLAYING TOGETHER: every word found is one point on the table, as on one screen ("a point"), and a Word Builder
// room's one category. Both are mirrored by the server (game_rooms.py GAME_POINTS, GAME_CATEGORY), which holds a
// room to them whatever a screen sends.
export const WORD_POINTS = 1;
export const TOGETHER_CATEGORY = Object.freeze({ group: 'words', id: 'word_builder', label: 'Word builder' });

export const LINES = Object.freeze({
  // Not "That is incorrect.": the only miss here is a word these letters cannot make, so say that.
  wrongLine: 'It sounded like you said {heard}. That is not in these letters.',
  switchWrongLine: 'That is not in these letters.',
  askLetters: 'Make a word from {letters}.',
  askMore: 'Make another word from {letters}. {left} to find.',
  hintFirst: 'one word starts with {letter}',
  hintMore: 'one word starts {letters}, then {more} more',
  explainWord: '{word}. {left} to find.',
  explainBonus: '{word}, a bonus word.',
  explainLast: '{word}. That is all of them!',
  alreadyLine: 'You have found {heard} already.',
  notListedLine: '{heard} is not on this list. Try another one.',
  shortLine: 'Words here have at least three letters.',
  noMoreHintsLine: 'That is every letter but the last.',
  // Playing together (2026-10-12): a new round, and the end of a game together.
  roundLine: 'Round {round} of {rounds}.',
  roundLineNoEnd: 'Round {round}.',
  endLine: 'That is the end of the game. {scores}.',
});
const LINE_LABELS = {
  askLetters: 'Question: the letters', askMore: 'Question: after a word is found', hintFirst: 'Hint: the first letter',
  hintMore: 'Hint: more letters', explainWord: 'A word found', explainBonus: 'A bonus word found',
  explainLast: 'The last word found', alreadyLine: 'A word already found', notListedLine: 'A word not on the list',
  shortLine: 'Too short to be a word here', noMoreHintsLine: 'No more hints for this word',
  roundLine: 'Playing together: a new round', roundLineNoEnd: 'Playing together: a new round (no end set)',
  endLine: 'Playing together: the end of the game',
};

export const DEFAULTS = Object.freeze({
  maxLetters: 5,
  wordsPerSet: 5,
  showBlanks: true,
  boardScan: 'rows',
  // Words are different lengths, so there is no "full": a word is checked when Check is pressed (or
  // the whole word is said). Not offered as a setting for that reason.
  checkWhenFull: false,
  togetherRounds: 5,
  autostart: false,
  autostartAlone: 'same',
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

// EACH SETTING'S DEFAULT, ARGUED:
//   maxLetters 5   the ruling's "fewer letters": the ladder starts at three and climbs to five. Six
//                  and more is a visual search again, the thing that made the original too hard.
//   wordsPerSet 5  a five-letter set can make fifteen words; asking for all of them is a long sitting
//                  on one set. Five is a few minutes; the rest still count, as bonus words.
//   showBlanks on  the length of each word still to find is the clue a grid gives for free.
//   togetherRounds 5  a game played together (another screen, or a call) is this many rounds of one word each.
//                  FOR more (Quiz mix plays 10): a longer game, and the table means more. FOR fewer: a word takes
//                  far longer than a Quiz mix question - finding one in four or five letters is often half a
//                  minute or more, with hints - so ten rounds for two players would be twenty words, a long
//                  stretch of a call spent on one game. Five rounds for two is ten words: about Quiz mix's
//                  length in minutes, and over while attention holds. 3, 5, 10, or no end ("keep going");
//                  Play again for another. It changes nothing on one screen, where the game goes on until stopped.
//                  [A guess: on Mike's list.]
const SETTINGS = [
  ...autostartFields({ on: false }),
  ownScoreField({ level: 'essential', note: 'How many words are found (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  { key: 'maxLetters', label: 'Letters, at most', kind: 'choice', default: 5, level: 'essential',
    options: [3, 4, 5].map((v) => ({ value: v, label: `${v} letters` })),
    note: 'It starts with 3 letters. It adds more as the words come easily.' },
  { key: 'wordsPerSet', label: 'Words to find in each set of letters', kind: 'choice', default: 5, level: 'standard',
    options: [3, 5, 8].map((v) => ({ value: v, label: String(v) })),
    note: 'Any other word the letters make still counts, as a bonus.' },
  { key: 'showBlanks', label: 'Show the words still to find as blanks', default: true, level: 'standard',
    onLabel: 'Yes, with their length', offLabel: 'No, only the words found' },
  { key: 'boardScan', label: 'Picking letters with a switch (one big button)', kind: 'choice', default: 'rows', level: 'standard',
    options: [{ value: 'rows', label: 'A row, then a letter' }, { value: 'keys', label: 'One key at a time' }] },
  { key: 'togetherRounds', label: 'Rounds when playing together', kind: 'choice', default: 5, level: 'standard',
    options: [3, 5, 10].map((v) => ({ value: v, label: String(v) })).concat([{ value: 0, label: 'No end: keep going' }]),
    note: 'With another screen, or on a call. A round is one word for every player. On this screen alone, the game goes on until it is stopped.' },
  ...adaptiveSettings({ ai: false, startLevels: 5 }),
  ...flowSettings({ lines: LINES, labels: LINE_LABELS, sayChoice: false }),
];

// ---------------------------------------------------------------------------------------
// PURE PIECES — exported for the suite
// ---------------------------------------------------------------------------------------
export const lettersOnly = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z]/g, '');
export const spaced = (letters) => letters.map((l) => l.toUpperCase()).join(', ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The letters not yet used by what has been typed (each letter once). */
export function remaining(letters, typed) {
  const left = letters.slice();
  for (const ch of lettersOnly(typed)) {
    const i = left.indexOf(ch);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

/** A set as it is played: the words it asks for, the bonus words, and what has been found. */
export function newSet(q, { wordsPerSet = DEFAULTS.wordsPerSet } = {}) {
  const n = Math.max(1, Math.floor(Number(wordsPerSet) || DEFAULTS.wordsPerSet));
  const required = q.pool.slice(0, n);
  return { id: q.id, kind: 'letters', level: q.level, letters: q.letters.slice(), required,
    bonus: q.all.filter((w) => !required.includes(w)), found: [], bonusFound: [], revealed: [], done: false };
}
export const toFind = (st) => st.required.filter((w) => !st.found.includes(w));
/** The word hints are about: the first one still to find. */
export const target = (st) => toFind(st)[0] || st.required[0] || '';

/** true (a word to find, or a bonus), false (these letters cannot make it), null (cannot say). */
export function judgeWord(st, value) {
  const w = lettersOnly(value);
  if (!w || w.length < MIN_WORD) return null;
  if (!canMake(w, st.letters)) return false;
  if (st.found.includes(w) || st.bonusFound.includes(w)) return null;
  if (st.required.includes(w) || st.bonus.includes(w)) return true;
  return null;
}

/** The nth hint about the target word: its first letter, then one more each time, never all. */
export function hintText(st, n, c = DEFAULTS) {
  const w = target(st);
  if (!w || n < 1) return '';
  if (n === 1) return fill(c.hintFirst, { letter: w[0].toUpperCase() });
  const k = Math.min(n, w.length - 1);
  return fill(c.hintMore, { letters: spaced(w.slice(0, k).split('')), more: w.length - k });
}

// Whole utterances that are commands, not words. Checked first, and only as the whole thing said.
const COMMANDS = {
  hint: 'hint', clue: 'hint', help: 'hint', 'give me a hint': 'hint', 'a hint': 'hint',
  'new letters': 'new', 'different letters': 'new', 'next letters': 'new',
  check: 'check', enter: 'check', done: 'check',
  undo: 'erase', back: 'erase', delete: 'erase',
  'start over': 'clear', clear: 'clear',
  repeat: 'repeat', 'say it again': 'repeat', 'say the letters': 'repeat',
};
const LETTER_SET = new Set(LETTER_WORDS);

/** What a recogniser heard, as an answer: a command, a whole word, letters spelled, or nothing. */
export function readVoice(st, text) {
  const t = normalize(text);
  if (!t) return null;
  if (COMMANDS[t]) return { command: COMMANDS[t] };
  const toks = t.split(' ');
  const known = (w) => !!TIER[w] || st.required.includes(w) || st.bonus.includes(w);
  if (toks.length >= 2 && toks.every((x) => LETTER_SET.has(x))) {
    const l = parseLetters(t);
    if (l) return l.length >= MIN_WORD ? { value: l } : { append: l };
  }
  if (toks.length === 1) {
    if (known(t)) return { value: t };
    const l = parseLetters(t);
    if (l) return { append: l };
    return { value: t };
  }
  const words = toks.filter(known);
  return words.length ? { value: words[words.length - 1] } : null;
}

// ---------------------------------------------------------------------------------------
// THE LOOK — only the theme's own variables
// ---------------------------------------------------------------------------------------
const STYLE_ID = 'word-builder-style';
const CSS = `
.wg[data-quiz="word_builder"] .qz-key[data-letter]{min-width:max(52px,13cqmin);min-height:max(52px,13cqmin);
  font-size:clamp(22px,9cqmin,110px);border-radius:2.4cqmin}
.wb-found{display:grid;gap:1cqmin;justify-items:center;margin:0;padding:0;list-style:none}
.wb-word{margin:0;font:800 clamp(16px,6cqmin,72px)/1.1 var(--font);letter-spacing:.08em;color:var(--text)}
.wb-word[data-blank]{color:var(--text-soft);letter-spacing:.3em}
.wb-word[data-revealed]{color:var(--text-soft)}
.wb-bonus{margin:0;font-size:clamp(12px,3.4cqmin,40px);color:var(--text-soft)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------
registerModule(
  { type: GAME, title: 'Word builder', core: 'new',
    description: 'A few big letters: find the words they make. The letters are read aloud. Answer by voice, with a switch '
      + '(one big button), or by touch. Each player gets more letters and harder words as the words come easily.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: START_VOICE },
  (ctx) => {
    const rand = ctx.rand || Math.random;
    let cfgNow = { ...DEFAULTS };
    let api = null;
    let current = null;          // the set on screen (one player's)
    let keyHints = 0;            // hints asked for with the Hint stop / "hint", this word
    let engineHints = 0;         // hints the miss flow gave, this word
    let unsubBack = null;
    let unsubPlay = null;
    const sets = new Map();      // player id -> their set

    // ---- PLAYING TOGETHER (2026-10-12; the header): rounds of one word each, over a game room ----
    let round = 0;               // this game together's round, from 1 (0: none yet)
    let turnIdx = 0;             // whose turn in the round (an index into players())
    let totals = {};             // seat -> words found, this game together
    let ended = false;           // the last round is over
    let playedIn = '';           // the room this game's rounds belong to (a new room is a new game)
    let turnNow = null;          // { player, item, intro, said } here; { player, remote, done, serial } elsewhere;
                                 // { player, item, guest, answered } on a screen that joined
    let lastTable = null;        // { players, totals }: the table of the game together that just ended
    let guestTurn = null;        // { seat, serial, round, category, dealt }: the host's turn for one of this screen's seats
    let remoteSerial = 0;
    let remoteTimer = null;
    const phase = () => { try { return api?.engine.snapshot().phase || 'idle'; } catch { return 'idle'; } };
    const together = createTogether(ctx, {
      game: GAME, title: 'Word builder',
      getApi: () => api, phase: () => phase(),
      localPlayers: () => session.players(),
      onTurn: (t) => onRoomTurn(t),
      onAnswer: (a) => remoteDone(a),
      remoteNow: () => (turnNow?.remote && !turnNow.done
        ? { seat: turnNow.player.seat, serial: turnNow.serial, name: turnNow.player.name } : null),
      skipRemote: (why) => {
        if (turnNow?.remote && !turnNow.done) remoteDone({ seat: turnNow.player.seat, serial: turnNow.serial, right: false, points: 0, skipped: true, why });
      },
      publish: () => publish(),
      tableLine: () => {
        const ps = players();
        return ps.length > 1 ? `<p class="wg-count" data-score>${esc(scoreWords(ps, totalsNow()).replace(/, /g, ' · '))}</p>` : '';
      },
      onGuestDone: () => { turnNow = null; guestTurn = null; },
      beforeEnd: () => {
        // Keep the table to show under Play again (on the host and on a screen that joined alike).
        try { if (roundNow() > 0) lastTable = { players: players(), totals: { ...totalsNow() } }; } catch { lastTable = null; }
        stopRemoteTimer();
        guestTurn = null;
        if (turnNow?.remote && !turnNow.done) turnNow.done = true;     // the seat is gone with the room
      },
      afterEnd: ({ wasGuest }) => { if (wasGuest) turnNow = null; },
    });
    const R = () => together.room();
    const inRoom = () => together.inRoom();
    const isHost = () => together.isHost();
    const isGuest = () => together.isGuest();
    // The turn order: the room's seats, wherever they sit; this screen's own players when not in a room.
    const players = () => together.players(session.players());
    const tkey = (p) => p?.seat || p?.id;
    const totalsNow = () => (isGuest() ? (R().state().totals || {}) : totals);
    const roundNow = () => (isGuest() ? Number(R().state().round) || 0 : round);
    const roundsSet = () => {
      const n = Math.floor(Number(cfgNow.togetherRounds));
      return Number.isFinite(n) && n >= 0 ? n : DEFAULTS.togetherRounds;
    };

    // The screen's person's level is kept WITH THEM, the same on each of their screens, with their own
    // start in this game, else their usual one; everybody else's stays on this screen's row; a refused save merges, entry by
    // entry (adaptive_play.js openPersonLadder).
    const ladderRows = openPersonLadder(ctx, { gameKey: GAME, onChange: () => api?.render() });
    const store = ladderRows.store;
    let ladderSeen = false;
    const maxLetters = () =>Math.max(3, Math.floor(Number(cfgNow.maxLetters) || DEFAULTS.maxLetters));
    const session = createAdaptiveSession({
      cfg: () => cfgNow,
      bankFor: () => PUZZLES.filter((p) => p.letters.length <= maxLetters()),
      store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      startFor: ladderRows.startFor, startMark: ladderRows.startMark,
      playersHost: ladderRows.playersHost,   // players: the screen's players (player_picker.js)
      onChange: () => { if (!ladderSeen) { ladderSeen = true; ladderArrived(); } api?.render(); },
    });
    ladderRows.attach(session);
    // THE SAVED LEVELS ARRIVE A MOMENT AFTER THE FIRST DEAL (the state handle loads asynchronously),
    // so the first letters were picked as if everybody were new. A set nobody has found a word in yet
    // is put back, and the one on screen is dealt again if nothing has been typed into it: otherwise
    // a level-4 player would spend a whole set on three letters after every reload.
    function ladderArrived() {
      for (const [pid, st] of [...sets]) if (!st.found.length && !st.bonusFound.length) sets.delete(pid);
      // Playing together, a skip would pass the turn on: the set on screen stays as it was dealt.
      if (together.roomBusy()) return;
      const s = api?.engine.snapshot();
      if (s && s.phase === 'asking' && !s.entry && !s.misses && current && !current.found.length && !keyHints) api.engine.skip();
    }

    // A word somebody gave up on after using the Hint stop (no miss, so the engine reports nothing):
    // it was hard, and the ladder should hear so.
    function flushPending() {
      const d = session.dealt();
      if (d && current && d.id === current.id && keyHints > 0) session.record({ item: current, right: false, skipped: true });
    }

    // THIS player's letters, on their own ladder: the set they have going, else a new one. (`player`: one of this
    // screen's players - their ladder id finds them in the session's own list, so a seat's room index never reaches
    // the ladder.) Call flushPending() first.
    function dealFor(p) {
      let st = sets.get(p.id);
      const q = st && !st.done ? session.deal(GAME, { again: st.id, player: p }) : session.deal(GAME, { player: p });
      if (!q) { current = null; return null; }
      if (!st || st.done || q.id !== st.id) {
        st = newSet(q, { wordsPerSet: cfgNow.wordsPerSet });
        sets.set(p.id, st);
      }
      keyHints = 0;
      engineHints = 0;
      current = st;
      return st;
    }
    function deal() {
      flushPending();
      // On one screen again after a game together: its table is not this game's.
      lastTable = null;
      const st = dealFor(session.currentPlayer());
      return st ? [st] : [];
    }

    // ---- PLAYING TOGETHER: the turns (the layer itself is game_together.js) ----
    function newGame() {
      round = 0; turnIdx = 0; totals = {}; ended = false; turnNow = null; lastTable = null;
      stopRemoteTimer();
    }
    // The words before a word: the round when it starts, then whose turn it is.
    function introFor(player, ps, fresh) {
      const c = cfgNow;
      const parts = [];
      if (fresh && turnIdx === 0) {
        const n = roundsSet();
        parts.push(fill(n ? c.roundLine : c.roundLineNoEnd, { round, rounds: n }));
      }
      const turnLine = ps.length > 1 ? fill(c.turnLine, { player: player.name || `Player ${player.index + 1}` }) : '';
      return { full: [...parts, turnLine].filter(Boolean).join(' '), turn: turnLine };
    }
    function prefixFor(st) {
      if (!inRoom() || !turnNow || turnNow.item !== st) return session.askPrefix();
      if (turnNow.said) return turnNow.intro.turn ? `${turnNow.intro.turn} ` : '';
      turnNow.said = true;
      return turnNow.intro.full ? `${turnNow.intro.full} ` : '';
    }
    /** THE HOST: the next turn - the next seat, wherever it sits (a new round when it is due). */
    function hostItems() {
      flushPending();
      const code = R()?.code?.() || '';
      if (phase() === 'done' || playedIn !== code) { newGame(); playedIn = code; }
      const ps = players();
      let fresh = false;
      if (turnNow) {                            // the last turn is over...
        if (turnNow.remote && !turnNow.done) return null;   // ...unless it is still being played on another screen
        turnNow = null;
        turnIdx += 1;
        if (turnIdx >= ps.length) { turnIdx = 0; round += 1; fresh = true; }
      }
      if (round === 0) { round = 1; turnIdx = 0; fresh = true; }
      const player = ps[turnIdx % ps.length];
      if (player.remote) return remoteTurn(player, ps, fresh);
      const st = dealFor(player);
      if (!st) return [];
      turnNow = { player, item: st, intro: introFor(player, ps, fresh), said: false };
      publish();
      return [st];
    }
    /** Asked before the next word: was that the last turn of the last round? (The host's; a game alone never ends.) */
    function over() {
      if (!isHost() || !turnNow) return false;
      const n = roundsSet();
      if (!n) return false;
      if (round >= n && turnIdx >= players().length - 1) { ended = true; publish(); return true; }
      return false;
    }
    function stopRemoteTimer() {
      if (remoteTimer != null) { try { together.roomClear(remoteTimer); } catch { /* gone */ } }
      remoteTimer = null;
    }
    // A turn that belongs to a seat on another screen: sent there, with this room's one category and nothing else.
    function remoteTurn(player, ps, fresh) {
      remoteSerial += 1;
      const serial = remoteSerial;
      const intro = introFor(player, ps, fresh);
      turnNow = { player, remote: true, done: false, serial, intro };
      R().turn({ seat: player.seat, serial, round: Math.min(999, round), category: { ...TOGETHER_CATEGORY } });
      publish();
      // The round and whose turn it is, said here too: the people at this screen are in the same game.
      try { api?.say?.(intro.full); } catch { /* silent */ }
      stopRemoteTimer();
      remoteTimer = together.roomSet(() => { remoteTimer = null; remoteDone({ seat: player.seat, serial, right: false, points: 0, skipped: true, why: 'time' }); }, REMOTE_TURN_MS);
      return null;
    }
    /** A result for the turn out at another screen (the room, the server's skip, "Skip their turn", or the backstop). */
    function remoteDone(a) {
      if (!turnNow?.remote || turnNow.done || !a || a.seat !== turnNow.player.seat || a.serial !== turnNow.serial) return;
      stopRemoteTimer();
      turnNow.done = true;
      const pts = a.right === true ? Math.max(0, Math.min(WORD_POINTS, Math.floor(Number(a.points) || 0))) : 0;
      const k = tkey(turnNow.player);
      totals = { ...totals, [k]: (totals[k] || 0) + pts };
      const n = roundsSet();
      const last = !!n && round >= n && turnIdx >= players().length - 1;
      if (last) { ended = true; publish(); api?.engine.end(); }
      else { publish(); api?.engine.refresh(); }
      api?.render();
    }
    /** The host's view of the game, to every screen in the room. Only the host sends it; the server checks it. */
    function publish() {
      if (!isHost()) return;
      const ph = phase();
      const tot = {};
      for (const p of players()) if (p.seat) tot[p.seat] = Math.min(99999, totals[p.seat] || 0);
      R().update({
        phase: ended || ph === 'done' ? 'done' : (api?.begun?.() ? 'playing' : 'lobby'),
        round: Math.min(999, round), rounds: Math.min(99, roundsSet()),
        category: round > 0 ? { ...TOGETHER_CATEGORY } : null, turn: turnNow?.player?.seat || null, totals: tot,
      });
    }
    // ---- A SCREEN THAT JOINED: its turns come from the host; only the result goes back ----
    function guestAnswer(t, { right = false } = {}) {
      try {
        R()?.answer({ seat: t.seat, serial: t.serial, category: { group: TOGETHER_CATEGORY.group, id: TOGETHER_CATEGORY.id },
          right: !!right, points: right ? WORD_POINTS : 0 });
      } catch { /* gone */ }
    }
    function guestItems() {
      flushPending();
      // A turn that ended with no word (new letters before any try): still answered, as nothing found.
      if (turnNow?.guest && !turnNow.answered) { turnNow.answered = true; guestAnswer(turnNow.guest); }
      turnNow = null;
      const t = guestTurn;
      if (!t || t.dealt) return null;
      t.dealt = true;
      const player = players().find((p) => p.here && p.seat === t.seat);
      if (!player) { guestAnswer(t); return null; }
      const st = dealFor(player);
      if (!st) { guestAnswer(t); return null; }
      const line = players().length > 1 ? fill(cfgNow.turnLine, { player: player.name || 'Player' }) : '';
      turnNow = { player, item: st, guest: t, answered: false, intro: { full: line, turn: line }, said: false };
      return [st];
    }
    function onRoomTurn(t) {
      if (!isGuest() || !t || !t.seat) return;
      guestTurn = { ...t, dealt: false };
      if (!api) return;
      if (!api.begun()) { api.start(); return; }
      if (phase() === 'done') api.engine.press('restart');
      else api.engine.refresh();
    }
    function items() {
      if (!inRoom()) return deal();
      return isGuest() ? guestItems() : hostItems();
    }
    // The chips in front of the word, playing together: the round, and whose turn (here or elsewhere).
    function chip(p) {
      if (!p) return '';
      const initial = esc((String(p.name || '').trim()[0] || '•').toUpperCase());
      return `<span class="qz-turn" data-turn="${esc(p.id)}"><span class="qz-token" data-p="${p.index % MAX_PLAYERS}" aria-hidden="true">${initial}</span>${esc(p.name)}</span>`;
    }
    function turnHtml(s) {
      if (!inRoom()) return session.turnHtml(s, GAME);
      if (s.phase === 'done') return '';
      const st = isGuest() ? R().state() : null;
      const rn = roundNow();
      if (!rn) return '';
      const whoP = turnNow?.player || (st ? players().find((p) => p.seat === st.turn) : null);
      const n = st ? Number(st.rounds) || 0 : roundsSet();
      const roundBit = `<span class="qz-turn qm-round" data-round="${rn}">${esc(n ? `Round ${rn} of ${n}` : `Round ${rn}`)}</span>`;
      return roundBit + (players().length > 1 && whoP ? chip(whoP) : '');
    }
    const tableHtml = (ps, tot) => {
      const sorted = [...ps].sort((a, b) => (tot[tkey(b)] || 0) - (tot[tkey(a)] || 0));
      const top = sorted.length ? (tot[tkey(sorted[0])] || 0) : 0;
      return `<ol class="qm-table" data-table>${sorted.map((p) => `<li data-player="${esc(p.id)}"${(tot[tkey(p)] || 0) === top && top > 0 ? ' data-top' : ''}>`
        + `<b>${esc(p.name || 'You')}</b><span>${tot[tkey(p)] || 0}</span></li>`).join('')}</ol>`;
    };

    const totalHints = () => keyHints + engineHints;
    function askHint() {
      if (!current) return;
      const w = target(current);
      if (totalHints() < Math.max(1, w.length - 1)) keyHints += 1;
    }
    function newLetters() {
      if (!current) return;
      current.done = true;
      api?.engine.skip();
    }

    const adapter = {
      items: () => items(),
      over: () => over(),
      // The end of a game together: the table, said. (A game alone ends with the usual words.)
      doneLine: (c) => {
        publish();                              // the host's "done" (the end, or a "stop") reaches every screen
        const fin = inRoom() && (ended || (isGuest() && R().state().phase === 'done'));
        return fin ? fill(c.endLine, { scores: scoreWords(players(), totalsNow()) }) : '';
      },
      empty: () => 'There are no letters for this game yet.',
      entry: () => 'letters',
      ask(st, c) {
        const letters = spaced(st.letters);
        const left = toFind(st).length;
        const begun = st.found.length + st.bonusFound.length > 0;
        let line = begun ? fill(c.askMore, { letters, left: plural(left, 'word', 'words') }) : fill(c.askLetters, { letters });
        if (keyHints > 0) line += ` ${fill(c.hintLine, { hint: hintText(st, totalHints(), c) })}`;
        return prefixFor(st) + line;
      },
      judge: (st, v) => judgeWord(st, v),
      hint(st, n, c) {
        engineHints = Math.max(engineHints, n);
        return hintText(st, n + keyHints, c);
      },
      answer: (st) => target(st),
      explain(st, answer, c) {
        const w = lettersOnly(answer);
        const word = up(w);
        if (st.bonus.includes(w)) return fill(c.explainBonus, { word });
        const left = toFind(st).filter((x) => x !== w).length;
        return left ? fill(c.explainWord, { word, left: plural(left, 'more', 'more') }) : fill(c.explainLast, { word });
      },
      maxEntry: (st) => st.letters.length,
      vocab: (st) => [...st.required, ...st.bonus, ...Object.keys(COMMANDS), ...LETTER_WORDS],
      heardText: (v) => up(lettersOnly(v)),
      fromVoice: (st, { text }) => readVoice(st, text),
      command(cmd) {
        if (cmd === 'hint') { askHint(); return 'ask'; }
        if (cmd === 'new') { newLetters(); return true; }
        return null;
      },
      unknownLine(value, c) {
        const w = lettersOnly(value);
        const st = current;
        // Whatever was typed is taken away, so the next try starts from all the letters.
        Promise.resolve().then(() => api?.engine.clearEntry());
        if (!w || w.length < MIN_WORD) return c.shortLine;
        if (st && (st.found.includes(w) || st.bonusFound.includes(w))) return fill(c.alreadyLine, { heard: up(w) });
        return fill(c.notListedLine, { heard: up(w) });
      },
    };

    // The letters still to use, then the stops. A used-up letter row is left out rather than sent
    // empty: the board drops empty rows when it draws, and a touched key is found by its row number.
    const keyBoard = (s) => {
      const st = s.item;
      const letters = remaining(st.letters, s.entry).map((l) => ({ key: l, label: l.toUpperCase() }));
      const stops = [{ cmd: 'check', label: 'Check' }, { cmd: 'erase', label: 'Undo' }, { view: 'hint', label: 'Hint' },
        { cmd: 'repeat', label: 'Hear it' }, { view: 'new', label: 'New letters' }];
      return letters.length ? [letters, stops] : [stops];
    };

    const view = {
      askHtml(s) {
        const st = s.item;
        const left = toFind(st).length;
        const begun = st.found.length + st.bonusFound.length > 0;
        return `${esc(begun ? 'Make another word' : 'Make a word')} <span class="qz-note" data-left>${esc(plural(left, 'word', 'words'))} to find</span>`;
      },
      left(s, c) {
        const st = s.item;
        const rows = st.required.map((w) => {
          if (st.found.includes(w)) {
            return `<li class="wb-word" data-word="${esc(w)}"${st.revealed.includes(w) ? ' data-revealed' : ''}>${esc(up(w))}</li>`;
          }
          return c.showBlanks === false ? '' : `<li class="wb-word" data-blank aria-label="${w.length} letters">${'_ '.repeat(w.length).trim()}</li>`;
        }).join('');
        const bonus = st.bonusFound.length ? `<li class="wb-bonus" data-bonus>Bonus: ${esc(st.bonusFound.map(up).join(', '))}</li>` : '';
        return `<ul class="wb-found" data-found>${rows}${bonus}</ul>`;
      },
      entryHtml(s, c) {
        const typed = up(s.entry).split('');
        const cells = typed.map((l) => `<span>${esc(l)}</span>`).join(' ') || '<span class="qz-blank">…</span>';
        const hint = keyHints > 0 ? `<p class="wg-hint" data-key-hint>${esc(hintText(s.item, totalHints(), c))}</p>` : '';
        return `<p class="qz-entry" data-entry aria-label="typed so far">${cells}</p>${hint}`;
      },
      board: (s) => keyBoard(s),
      onKey(k, a) {
        if (k.view === 'hint') { askHint(); a.engine.press('repeat'); return; }
        if (k.view === 'new') newLetters();
      },
      pairHtml: (s) => `<div class="wg-pair" data-pair>${esc(up(lettersOnly(s.pair.answer)))}</div>`,
      turnHtml: (s) => turnHtml(s),
      onResult(r) {
        const st = r.item;
        if (st && st === current) {
          const w = lettersOnly(r.right ? r.answer : (r.revealed ? target(st) : ''));
          if (w && r.right && st.bonus.includes(w)) { if (!st.bonusFound.includes(w)) st.bonusFound.push(w); }
          else if (w && (r.right || r.revealed)) {
            if (!st.found.includes(w)) st.found.push(w);
            if (r.revealed && !st.revealed.includes(w)) st.revealed.push(w);
          }
          if (!toFind(st).length) st.done = true;
        }
        session.record({ ...r, hintsGiven: (r.hintsGiven || 0) + keyHints });
        keyHints = 0;
        // Playing together: the word is this turn's. On the host it goes on the table; on a screen that joined, only
        // { seat, right, points } goes back (game_rooms.py holds it to that) - never the word or the letters.
        if (inRoom() && turnNow && !turnNow.remote && st === turnNow.item) {
          const pts = r.right === true ? WORD_POINTS : 0;
          if (turnNow.guest) {
            if (!turnNow.answered) { turnNow.answered = true; guestAnswer(turnNow.guest, { right: r.right === true }); }
          } else {
            const k = tkey(turnNow.player);
            totals = { ...totals, [k]: (totals[k] || 0) + pts };
            publish();
          }
        }
      },
      allowAward: () => session.allowAward(),
      scoreDetail: (s) => (inRoom() ? scoreWords(players(), totalsNow())
        : session.scoreDetail() || (s.rightCount ? plural(s.rightCount, 'word', 'words') : '')),
      scoreLine: (s) => (inRoom() ? scoreWords(players(), totalsNow()).replace(/, /g, ' · ')
        : session.scoreDetail() || `${plural(s.rightCount, 'word', 'words')} found.`),
      // Playing together (game_together.js): the table under Play again, the waiting lines, the lobby and its sheet.
      doneHtml: () => (lastTable ? tableHtml(lastTable.players, lastTable.totals)
        : (inRoom() && roundNow() > 0 ? tableHtml(players(), totalsNow()) : '')),
      waitingHtml: () => together.waitingHtml(),
      sheetHtml: (s) => together.sheetHtml(s),
      onClick: (e) => together.onClick(e),
      onMove: (m) => together.onMove(m),
      pointNote: (game, item, answer) => `word builder: ${lettersOnly(answer)}`,
      onConfig: (c) => { cfgNow = c; ladderRows.onConfig(c); },
      init(a) {
        api = a;
        ensureStyle(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null));
        // The `back` verb is Undo here: one switch's way to take a letter back.
        try { unsubBack = a.bus.subscribe(`${GAME}/back`, () => a.engine.erase()); } catch { unsubBack = null; }
        // A spoken "play word builder" (a route) with the game already on screen: carry on playing.
        try {
          unsubPlay = a.bus.subscribe(`${GAME}/play`, () => {
            const ph = a.engine.snapshot().phase;
            a.engine.press(ph === 'done' ? 'restart' : ph === 'another' ? 'more'
              : (ph === 'celebrate' || ph === 'answer') ? 'continue' : 'repeat');
          });
        } catch { unsubPlay = null; }
        // Playing together: the join page's room (ctx.autoJoin), and the call's asks (ctx.onGameAsk).
        together.init();
      },
      destroy: () => {
        stopRemoteTimer();
        together.destroy();
        session.destroy();
        try { if (typeof unsubBack === 'function') unsubBack(); } catch { /* gone */ }
        try { if (typeof unsubPlay === 'function') unsubPlay(); } catch { /* gone */ }
        ladderRows.destroy();
      },
    };

    const inner = quizModule({ type: GAME, title: 'Word builder', scoreLabel: 'Word builder: words found',
      // `gameKey`: so "play word builder" said aloud (input_speech.js ROUTES, `word_builder/play`) reaches it -
      // one game, but asking for it by name is pressing Start (2026-10-02; before, nothing answered that topic).
      games: { [GAME]: adapter }, defaults: DEFAULTS, gameKey: 'game', view, startGate: true, autostart: DEFAULTS.autostart })(ctx);
    inner.__session = session;
    inner.__sets = sets;
    inner.__current = () => current;
    // For the suites: the game together as this screen sees it (the same shape as Quiz mix's __mix where it overlaps).
    inner.__together = () => ({ round, turnIdx, totals: { ...totals }, ended, turnNow, players: players(), lastTable,
      room: R() ? { phase: R().phase(), role: R().role(), code: R().code(), you: R().you(), seats: R().seats(),
        state: R().state(), waiting: R().waiting() } : null,
      sheet: together.sheet(), note: together.note(), showLobby: together.showLobby(), guestTurn,
      totalsNow: { ...totalsNow() }, asked: together.asked(),
      act: (a, arg) => together.act(a, arg), join: (c) => together.joinRoom(c), open: (o) => together.startRoom(o),
      stop: () => together.stop() });
    // Asked from the call, handed straight in (the kiosk's call view opens this panel for an ask, then gives it the ask).
    inner.askTogether = (a) => together.onAsk(a);
    return inner;
  },
);
