// adaptive_play.js — THE LADDER: players, turns, ratings and review, kept for any answer game.
//
// `rating.js` is the arithmetic and touches nothing. This is the part that remembers: every player's
// rating, level and review list per game, every question's rating, and whose turn it is. A game
// built on `quiz_view.js` hands it a bank and asks it what to deal; the engine's `onResult` tells it
// how the question went. Row 2.45 (Mike, 2026-10-01): difficulty PER PLAYER, so people with a skill
// gap can play each other, and two people on one screen taking turns, each at their own level.
//
// WHERE THE LADDER LIVES, and the guess in it. In ONE shared per-screen row,
// `ctx.makeState('ratings')`, the same kind of handle `bank` and `scoreboard` use. Every game on the
// screen shares it, which is what lets a question's rating learn from every player who meets it.
// AGAINST: it is per SCREEN, not per person, so somebody who plays on two screens has two ladders.
// Per-person state needs a person id for every player, and a second player typed in by name has
// none. 2026-10-06: the screen's person's rows are kept WITH THE PERSON (`splitLadderStore` below):
// Trivia's in their own `ratings_trivia`, every other game on the ladder in their own `ratings`
// (`openPersonLadder` below). Players typed in by name, and every question's rating, stay on the
// screen's row. With no `makeState` (a test, a bare host) it is kept in memory only. Saving merges
// entry by entry, so games sharing the row do not overwrite each other (`mergeLadder3` below).
//
// WHO THE PLAYERS ARE. The `players` setting: names in turn order ("Ann, Bob"). Empty is one player,
// the screen's own person, with nothing drawn about turns at all. Up to FOUR: a longer order is a
// long wait between one person's turns, and four is as many distinct colours as the theme has.

import {
  RATING_DEFAULTS, LADDER_DEFAULTS, THRESHOLD_DEFAULTS, REVIEW_SCHEDULES, rateAnswer, levelRating, poolFor, poolLevels,
  stepFloor, choose, scheduleReview, dueIds, outcomeOf, scoreOf, thresholdsAt,
} from './rating.js';
import { esc, fill, normalize } from './quiz_flow.js';

export const LADDER_KEY = 'ratings';
export const MAX_PLAYERS = 4;
// How many AI-written questions one game keeps on a screen. Old ones are dropped first. A bound,
// so a writer left on for a year cannot grow the shared row without limit.
export const EXTRA_CAP = 300;
// The person's own row for every game on the ladder but Trivia (which keeps `ratings_trivia`): the
// same name as the screen's row, in the person's scope (`openPersonLadder` below argues one row, not one per game).
export const PERSON_LADDER_KEY = 'ratings';
// The panel's copy of "Start games at" (the person's row is the truth; see `openPersonLadder`).
export const PERSON_START_KEY = 'personStart';
export const START_WORDS = Object.freeze(['easy', 'medium', 'hard']);

/**
 * "Easy" / "medium" / "hard" as a level, in a game whose hardest written level is `maxLevel`: the easiest,
 * the middle (rounded up), the hardest. With three levels that is 1 / 2 / 3, the same as Trivia's. Anything
 * else: null. Argued for "hard": FOR one below the top, a softer start. AGAINST, and it decides it: the
 * caregiver asked for hard, and a start that is too hard comes down by itself after a few answers.
 */
export function startWordLevel(word, maxLevel) {
  const top = Math.max(1, Math.floor(Number(maxLevel) || 1));
  if (word === 'easy') return 1;
  if (word === 'medium') return Math.max(1, Math.round((1 + top) / 2));
  if (word === 'hard') return top;
  return null;
}

export const ADAPTIVE_LINES = Object.freeze({
  turnLine: '{player}, your turn.',
});

export const ADAPTIVE_DEFAULTS = Object.freeze({
  players: '',
  startLevel: 1,
  adapt: true,
  moveUpAbove: LADDER_DEFAULTS.moveUpAbove,
  moveDownBelow: LADDER_DEFAULTS.moveDownBelow,
  ...THRESHOLD_DEFAULTS,
  judgeOver: LADDER_DEFAULTS.judgeOver,
  levelsAtOnce: LADDER_DEFAULTS.levelsAtOnce,
  review: 'standard',
  showLevel: false,
  pointsFor: 'first',
  aiWrite: 'off',
  aiWhenFewer: 6,
  ...ADAPTIVE_LINES,
});

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * The settings rows. `ai` adds the question-writer rows (games whose questions are WRITTEN; Math's
 * are generated and need none). `appliesWhen` is passed through to every row, so a module that only
 * uses these in one mode (Math's beginner level) can hide them in the others.
 *
 * EACH DEFAULT, ARGUED:
 *   moveUpAbove / moveDownBelow 'auto'   BY LEVEL (Mike, 2026-10-02: "different defaults depending on
 *                     your difficulty level. For easier levels it should be like 90% ... right or 75%
 *                     wrong"). The curve's four ends are rows below; rating.js `thresholdsAt` argues it.
 *                     A number is still offered: one threshold at every level, the old rule.
 *   upEasy 90% / upHard 70%, downEasy 75% / downHard 50%   rating.js THRESHOLD_DEFAULTS argues each.
 *   judgeOver 10      Fewer is noise: at 5 answers, somebody who really gets 60% right shows 4 of 5
 *                     about a third of the time. More is slow: 20 answers can be twenty minutes.
 *   levelsAtOnce 2    The level being worked on plus the one below it, so most questions in a
 *                     sitting are ones the player can already do. One is harder going; three is
 *                     a wide spread for one person.
 *   startLevel 1      Everybody starts at the easiest, and a good player leaves it in ten answers.
 *   showLevel off     A level number that goes DOWN reads as a verdict. Names only by default.
 *   pointsFor first   Points are the screen's own person's economy (School points buy play time).
 *                     A visitor's right answers paying into it is not that person's work. "Everyone"
 *                     is one setting away. A GUESS, on Mike's list.
 *   aiWrite off       Mike's terms (row 2.50, note AS): questions come from an OPEN model on this
 *                     device's AI address, never Claude, and nothing is written unless turned on.
 *   aiWhenFewer 6     Ask for more when a player's levels hold fewer than six questions they have
 *                     not just seen; at about a question a minute that is several minutes' warning.
 */
export function adaptiveSettings({ ai = false, appliesWhen = null, startLevels = 5, personStart = true,
  personStartLevel = 'standard' } = {}) {
  const w = (row) => (appliesWhen ? { ...row, appliesWhen } : row);
  return [
    w({ key: 'players', label: 'Players, in turn order', kind: 'text', default: '', level: 'standard',
      placeholder: 'One player',
      note: 'Names separated by commas ("Ann, Bob"). Each takes a turn and gets questions at their own level. Up to four.' }),
    // THE PERSON'S OWN START, shared by every game on the ladder (openPersonLadder below). Standard: it is
    // the one a caregiver setting up somebody new reaches for; "A new player starts at level" stays advanced.
    // Trivia passes `personStart: false`: it has its own row, "Start trivia at", which can follow this one.
    // `personStartLevel`: Math passes 'advanced' (its menu is at the press budget; see math_beginner.js).
    ...(personStart ? [w({ key: PERSON_START_KEY, label: 'Start games at', kind: 'choice', default: 'easy', level: personStartLevel,
      options: [{ value: 'easy', label: 'Easy questions' }, { value: 'medium', label: 'Medium questions' },
                { value: 'hard', label: 'Hard questions' }],
      note: 'For the person this screen is for, and kept with them: the same in every game like this one, and on '
        + 'each of their screens. Changing it starts them again there in every game; after that, their answers '
        + 'move them. Players typed in by name start at "A new player starts at level".' })] : []),
    w({ key: 'adapt', label: 'Questions get harder and easier by themselves', default: true, level: 'standard',
      onLabel: 'Yes, for each player', offLabel: 'No, stay at the starting level' }),
    w({ key: 'startLevel', label: 'A new player starts at level', kind: 'choice', default: 1, level: 'advanced',
      options: Array.from({ length: Math.max(2, startLevels) }, (_, i) => ({ value: i + 1, label: String(i + 1) })) }),
    w({ key: 'moveUpAbove', label: 'Harder questions when the last answers are', kind: 'choice',
      default: 'auto', level: 'advanced', options: [{ value: 'auto', label: 'By level (the four rows below)' },
        ...[0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map((v) => ({ value: v, label: `More than ${pct(v)} right, at every level` }))] }),
    w({ key: 'moveDownBelow', label: 'Easier questions when the last answers are', kind: 'choice',
      default: 'auto', level: 'advanced',
      options: [{ value: 'auto', label: 'By level (the four rows below)' }, { value: 0, label: 'Never easier' },
        ...[0.3, 0.4, 0.5, 0.6].map((v) => ({ value: v, label: `Less than ${pct(v)} right, at every level` }))] }),
    w({ key: 'upEasy', label: 'By level: harder, at the easiest level, from', kind: 'choice', default: THRESHOLD_DEFAULTS.upEasy,
      level: 'advanced', options: [0.8, 0.85, 0.9, 0.95, 1].map((v) => ({ value: v, label: `${pct(v)} right` })),
      note: 'The levels between the easiest and the hardest go in even steps between this and the next row.' }),
    w({ key: 'upHard', label: 'By level: harder, at the hardest level, from', kind: 'choice', default: THRESHOLD_DEFAULTS.upHard,
      level: 'advanced', options: [0.6, 0.65, 0.7, 0.75, 0.8, 0.9].map((v) => ({ value: v, label: `${pct(v)} right` })) }),
    w({ key: 'downEasy', label: 'By level: easier, at the easiest level, from', kind: 'choice', default: THRESHOLD_DEFAULTS.downEasy,
      level: 'advanced', options: [0.5, 0.6, 0.7, 0.75, 0.8, 0.9].map((v) => ({ value: v, label: `${pct(v)} wrong` })) }),
    w({ key: 'downHard', label: 'By level: easier, at the hardest level, from', kind: 'choice', default: THRESHOLD_DEFAULTS.downHard,
      level: 'advanced', options: [0.3, 0.4, 0.5, 0.6, 0.75].map((v) => ({ value: v, label: `${pct(v)} wrong` })) }),
    w({ key: 'judgeOver', label: 'Judged over the last', kind: 'choice', default: 10, level: 'advanced',
      options: [5, 10, 15, 20].map((v) => ({ value: v, label: `${v} answers` })) }),
    w({ key: 'levelsAtOnce', label: 'Levels mixed together', kind: 'choice', default: 2, level: 'advanced',
      options: [{ value: 1, label: 'Just the current level' }, { value: 2, label: 'This level and the one below' },
                { value: 3, label: 'This level and the two below' }] }),
    w({ key: 'review', label: 'Missed questions come back', kind: 'choice', default: 'standard', level: 'advanced',
      options: [{ value: 'standard', label: 'Soon, then after 1, 3, 7, 14 and 30 days' },
                { value: 'days', label: 'After 1, 3, 7, 14 and 30 days' },
                { value: 'off', label: 'Never on purpose' }],
      note: '"Soon" is two questions later, then five: short gaps first, longer ones as it sticks.' }),
    w({ key: 'showLevel', label: 'Show each player’s level', default: false, level: 'advanced',
      onLabel: 'Yes', offLabel: 'Names only' }),
    w({ key: 'pointsFor', label: 'Right answers earn points for', kind: 'choice', default: 'first', level: 'advanced',
      options: [{ value: 'first', label: 'The first player only' }, { value: 'all', label: 'Every player' }] }),
    ...(ai ? [
      w({ key: 'aiWrite', label: 'Write more questions with AI', kind: 'choice', default: 'off', level: 'advanced',
        options: [{ value: 'off', label: 'Off' }, { value: 'local', label: 'With this device’s own AI' }],
        note: 'Uses the AI address set on this device (an open model such as one in Ollama). Questions are kept on this screen.' }),
      w({ key: 'aiWhenFewer', label: 'Write more when a player has fewer than', kind: 'choice', default: 6,
        level: 'advanced', options: [3, 6, 10].map((v) => ({ value: v, label: `${v} questions left` })) }),
    ] : []),
    w({ key: 'turnLine', label: 'Whose turn (said before the question)', kind: 'text',
      default: ADAPTIVE_LINES.turnLine, level: 'advanced' }),
  ];
}

/** "Ann, Bob" -> [{ id, name, index }]. Empty -> one unnamed player: the screen's own person. */
export function parsePlayers(text, { personId = null } = {}) {
  const names = String(text == null ? '' : text).split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const name of names) {
    const id = `name:${normalize(name).replace(/\s+/g, '-') || name.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, index: out.length });
    if (out.length >= MAX_PLAYERS) break;
  }
  if (out.length) return out;
  return [{ id: personId ? `person:${personId}` : 'player', name: '', index: 0 }];
}

export const emptyLadder = () => ({ v: 1, players: {}, questions: {}, extra: {} });

// ---------------------------------------------------------------------------------------------------
// *** TWO GAMES ON ONE SCREEN NO LONGER OVERWRITE EACH OTHER (2026-10-06). ***
// ---------------------------------------------------------------------------------------------------
// Found 2026-10-05 (bdc1d1a, "Found, not fixed"): a session saved its WHOLE ladder on every answer, from
// what it loaded when it opened. Brain games and Thinking games share the screen's `ratings` row, so
// whichever answered last wrote the other's progress out of it; two Trivia panels did the same to
// `ratings_trivia`. The fix is a MERGE, not a lock: a lock would leave one game waiting on the other,
// and a game left open is exactly the thing nobody comes back to close.
//
// THE MERGE IS THREE-WAY, ONE ENTRY AT A TIME. An entry is one player's row in one game, one question's
// rating, or one game's written questions. For each: if this session changed it since it last saw the
// row (`base`), its own copy wins; otherwise the newer copy (`theirs`) does. So two games never touch
// each other's entries, and the only thing that can still be lost is the same player in the same game
// answered on two panels at the same moment, where the last answer wins. Written questions are a union.
// It runs in two places: before every save, against the newest copy this page has (two games sharing
// one handle), and when the server refuses a save as out of date (two handles, two screens:
// `ladderDocMerge`, state.js's `merge` option, passed by `openLadderStore`).
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const pick3 = (b, m, t) => (same(m, b) ? t : m);
function merge3Keys(b, m, t, inner = null) {
  const B = b && typeof b === 'object' ? b : {};
  const M = m && typeof m === 'object' ? m : {};
  const T = t && typeof t === 'object' ? t : {};
  const out = {};
  for (const k of new Set([...Object.keys(B), ...Object.keys(M), ...Object.keys(T)])) {
    const v = inner && M[k] !== undefined && T[k] !== undefined && !same(M[k], B[k])
      ? inner(B[k], M[k], T[k]) : pick3(B[k], M[k], T[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
function mergePlayer3(b, m, t) {
  const B = b && typeof b === 'object' ? b : {};
  return { name: pick3(B.name, m.name, t.name) || '', games: merge3Keys(B.games, m.games, t.games) };
}

/** `base` -> `mine` and `base` -> `theirs`, entry by entry (above). PURE; never throws on missing parts. */
export function mergeLadder3(base, mine, theirs) {
  const b = base && typeof base === 'object' ? base : emptyLadder();
  const m = mine && typeof mine === 'object' ? mine : emptyLadder();
  const t = theirs && typeof theirs === 'object' ? theirs : emptyLadder();
  const extra = {};
  for (const g of new Set([...Object.keys(t.extra || {}), ...Object.keys(m.extra || {})])) {
    const have = new Set((t.extra?.[g] || []).map((q) => q && q.id));
    extra[g] = [...(t.extra?.[g] || []), ...(m.extra?.[g] || []).filter((q) => q && !have.has(q.id))].slice(-EXTRA_CAP);
  }
  return { v: 1, players: merge3Keys(b.players, m.players, t.players, mergePlayer3),
    questions: merge3Keys(b.questions, m.questions, t.questions), extra };
}

/** state.js `merge(base, mine, theirs)` for a row holding a `ladder`: the ladder entry by entry, any other key whole. */
export function ladderDocMerge(base, mine, theirs) {
  const b = base || {}, m = mine || {}, t = theirs || {};
  const data = merge3Keys(b, m, t);
  if (m.ladder || t.ladder) data.ladder = mergeLadder3(b.ladder, m.ladder, t.ladder);
  return { data, lost: [] };
}
export const LADDER_STATE_OPTIONS = Object.freeze({ merge: ladderDocMerge });

/** The screen's ladder row (`key`, default the shared `ratings`), opened so a refused save merges. null when there is none. */
export function openLadderStore(ctx, key = LADDER_KEY) {
  if (!ctx || typeof ctx.makeState !== 'function') return null;
  try { return ctx.makeState(key, { ...LADDER_STATE_OPTIONS }) || null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------
// *** A PLAYER'S ROW CAN BE KEPT WITH THE PLAYER (2026-10-06, Trivia first). ***
// ---------------------------------------------------------------------------------------------------
// Mike's 2026-10-05 ask (questions at every level, for several people) found the gap the header names: a level kept on
// a screen's row starts over on the person's next screen. This keeps the rows of the players a game
// names in their OWN row (Trivia: the screen's person, `person:<id>`, in `ctx.makePersonState`), and the
// rest where they were: the questions' ratings, and players typed in by name, who have no person to keep
// them with. To a session it is one state handle (`load`, `get`, `set`, `subscribe`).
//
// MOVED ONCE: a row of theirs already on the screen's row is moved to their own the first time both are
// loaded. If both hold one for the same game, the one with MORE ANSWERS stays (`n`, how many answers the
// level rests on: the better-founded of the two; a tie keeps their own). Then it is taken off the
// screen's row, so the move does not happen again.
//
// Until their own row has loaded, a player's answers stay on the screen's row and move with the rest,
// so nothing written in the first moment is lost and nothing better on their own row is overwritten.
/**
 *   shared       the screen's row (a state handle)
 *   ownIds()     the player ids kept in a row of their own right now
 *   ownFor(id)   that row's handle (the caller keeps one per id and closes it), or null
 *   pollOwn      keep listening to their own rows once loaded (another screen of theirs may play too)
 */
export function splitLadderStore({ shared = null, ownIds = () => [], ownFor = () => null, pollOwn = true } = {}) {
  const subs = new Set();
  const own = new Map();            // id -> { handle, loaded, ready, off }
  let sharedReady = null;
  let sharedLoaded = false;
  let dead = false;
  const ladderOf = (h) => { try { return h?.get?.()?.ladder || null; } catch { return null; } };
  const ids = () => { try { return (ownIds() || []).filter(Boolean); } catch { return []; } };
  function notify() {
    if (dead) return;
    const snap = { ladder: combined() };
    for (const fn of [...subs]) { try { fn(snap); } catch (err) { console.error('ladder: subscriber', err); } }
  }
  function entry(pid) {
    if (own.has(pid)) return own.get(pid);
    let handle = null;
    try { handle = ownFor(pid) || null; } catch { handle = null; }
    if (!handle) return null;
    const e = { handle, loaded: false, ready: null, off: null };
    own.set(pid, e);
    try { e.off = handle.subscribe?.(() => { if (e.loaded) notify(); }) || null; } catch { e.off = null; }
    e.ready = Promise.resolve().then(() => handle.load?.()).catch(() => {}).then(() => {
      if (dead) return;
      e.loaded = true;
      migrate(pid);
      if (pollOwn) { try { handle.startPolling?.(); } catch { /* none */ } }
      notify();
    });
    return e;
  }
  function combined() {
    const s = ladderOf(shared) || emptyLadder();
    const players = { ...(s.players || {}) };
    for (const pid of ids()) {
      const e = own.get(pid);
      const mine = e && e.loaded ? ladderOf(e.handle)?.players?.[pid] : null;
      if (mine) players[pid] = mine;
    }
    return { v: 1, players, questions: s.questions || {}, extra: s.extra || {} };
  }
  function migrate(pid) {
    const e = own.get(pid);
    if (dead || !sharedLoaded || !e?.loaded) return;
    const s = ladderOf(shared);
    const there = s?.players?.[pid];
    if (!there) return;
    const mine = ladderOf(e.handle) || emptyLadder();
    const cur = mine.players?.[pid] || { name: there.name || '', games: {} };
    const games = { ...(cur.games || {}) };
    let took = false;
    for (const [g, row] of Object.entries(there.games || {})) {
      const have = games[g];
      if (!have || !Number.isFinite(have.rating) || (Number(row?.n) || 0) > (Number(have.n) || 0)) { games[g] = row; took = true; }
    }
    try {
      if (took) {
        e.handle.set({ ladder: { ...emptyLadder(), ...mine,
          players: { ...(mine.players || {}), [pid]: { name: cur.name || there.name || '', games } } } });
      }
      const rest = { ...(s.players || {}) };
      delete rest[pid];
      shared.set({ ladder: { ...emptyLadder(), ...s, players: rest } });
    } catch (err) { console.error('ladder: moving a row', err); }
  }
  let offShared = null;
  try { offShared = shared?.subscribe?.(() => { if (sharedLoaded) notify(); }) || null; } catch { offShared = null; }
  return {
    load() {
      if (!sharedReady) {
        sharedReady = Promise.resolve().then(() => shared?.load?.()).catch(() => {}).then(() => {
          sharedLoaded = true;
          for (const pid of own.keys()) migrate(pid);
        });
      }
      const waits = [sharedReady, ...ids().map((pid) => entry(pid)?.ready).filter(Boolean)];
      return Promise.all(waits).then(() => ({ ladder: combined() }));
    },
    get: () => ({ ladder: combined() }),
    set(patch = {}) {
      const lad = patch.ladder;
      if (!lad || typeof lad !== 'object') { shared?.set?.(patch); return; }
      const routed = new Set(ids());
      const sharedPlayers = {};
      for (const [pid, row] of Object.entries(lad.players || {})) {
        const e = routed.has(pid) ? entry(pid) : null;
        if (e && e.loaded) {
          const mine = ladderOf(e.handle) || emptyLadder();
          if (!same(mine.players?.[pid], row)) {
            e.handle.set({ ladder: { ...emptyLadder(), ...mine, players: { ...(mine.players || {}), [pid]: row } } });
          }
        } else {
          sharedPlayers[pid] = row;
        }
      }
      shared?.set?.({ ...patch, ladder: { ...lad, players: sharedPlayers } });
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    flush: () => Promise.all([shared?.flush?.(), ...[...own.values()].map((e) => e?.handle?.flush?.())]).catch(() => {}),
    /** A player's own row's handle, once there is one (Trivia reads and sets "Start trivia at" on it). */
    ownHandle: (pid) => entry(pid)?.handle || null,
    ownReady: (pid) => entry(pid)?.ready || Promise.resolve(),
    destroy() {
      dead = true;
      subs.clear();
      try { offShared?.(); } catch { /* none */ }
      for (const e of own.values()) { try { e?.off?.(); } catch { /* none */ } }
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// *** EVERY GAME ON THE LADDER: THE LEVEL FOLLOWS THE PERSON (2026-10-06, after Trivia) ***
// ---------------------------------------------------------------------------------------------------
// Trivia's "guess 9" left Brain games, Thinking games, Card sort, Word builder and Math keeping a level
// per screen, so somebody's level on one screen started over on their next. This is Trivia's model for
// all of them, in one place: the screen's person's rows go in the person's own `ratings` row (moved there
// once by `splitLadderStore`, the one with more answers winning), and everything else stays on the
// screen's row, as before.
//
// *** ONE PERSON ROW FOR ALL THESE GAMES, NOT ONE PER GAME. *** Argued:
//   FOR one per game: a row a game alone writes, so no game ever has to merge with another.
//   AGAINST, and it decides it: the merge (mergeLadder3) already makes sharing safe, entry by entry; the
//   screen's own row is already shared the same way; one row is one place to look for a person's levels
//   (and one row to name on the privacy page), and "Start games at" below is one value about all of
//   them, which belongs beside the rows it moves. Trivia keeps `ratings_trivia`: it already shipped there,
//   and moving it would be a second one-time move for no gain. [Guess, on Mike's list.]
//
// *** ONE "START GAMES AT" PER PERSON, NOT ONE PER GAME; TRIVIA'S CAN FOLLOW IT OR OVERRIDE IT. *** Argued:
//   FOR one per game: somebody can be quick at sums and slow at remembering an order.
//   AGAINST, and it decides it: a caregiver setting up somebody new should answer "how hard should their
//   games start?" once, not in six menus; the row shows the same value in every game's menu, so it reads
//   as one setting; and the ladder moves each game apart from there after ten answers anyway. Trivia
//   keeps "Start trivia at" (it shipped first, and quiz questions are a different kind of hard), now with
//   "Where the other games start" as its first choice. [Guess, on Mike's list.]
//   The words, not a level number: games have different numbers of levels (three to six), so "medium" is
//   the middle of each (`startWordLevel`).
//
// CHANGING IT STARTS THEM AGAIN THERE, IN EVERY ONE OF THESE GAMES, as Trivia's does. The person's row
// gets the new start and a new `startMark`; any game row of theirs carrying an older mark (or none) is
// read as starting at the new level, the next time that game deals to them, wherever it is open
// (`createAdaptiveSession` `startMark`). Kept: how many they have answered, and what is due to come back.
// A row moved in from a screen after the change carries no mark, so it starts at the chosen level too:
// the caregiver's choice is the newer word. [Guess, on Mike's list.]
//
// THE MENU ROW IS THE PANEL'S (settings rows are kept per panel), so, as in Trivia, the panel keeps a copy
// and the person's row is the truth: a change made in the menu is written to the person; a change made on
// another of their screens or games is copied back into the row so the menu shows it. A screen with no
// person (or a host with no per-person rows): the row applies to its one unnamed player, on the panel,
// in this game only.
let MARKS = 0;
/** A start mark no other change has used (the time plus a count in this page). */
export const newStartMark = () => `${Date.now().toString(36)}-${(MARKS += 1).toString(36)}`;

/**
 * The ladder's store for one game panel, with the screen's person's rows kept with them.
 * Returns { store, startFor, startMark, attach(session), onConfig(cfg), flush, destroy }: hand `store`,
 * `startFor` and `startMark` to createAdaptiveSession, `attach` the session, call `onConfig` with every
 * settings snapshot, and `destroy` when the panel goes.
 *   key         the screen's row (default the shared `ratings`)
 *   personKey   the person's own row (default `ratings`, in their scope)
 *   settingKey  the panel's copy of "Start games at"
 *   onChange()  the person's start changed (to redraw a level shown on screen)
 */
export function openPersonLadder(ctx, { key = LADDER_KEY, personKey = PERSON_LADDER_KEY, settingKey = PERSON_START_KEY,
  onChange = () => {} } = {}) {
  const shared = openLadderStore(ctx, key);
  const handles = new Map();      // person id -> { handle, off }
  let session = null;
  let raw;                        // the panel's copy, as saved (undefined: never chosen)
  let seenRaw = false;
  let lastSeen = '|';
  let dead = false;
  const me = () => (ctx?.personId ? `person:${ctx.personId}` : null);
  const solo = () => me() || 'player';
  function ownFor(pid) {
    const id = ctx?.personId;
    if (!id || pid !== `person:${id}` || typeof ctx.makePersonState !== 'function') return null;
    if (handles.has(id)) return handles.get(id).handle;
    let handle = null;
    try { handle = ctx.makePersonState(id, personKey, { ...LADDER_STATE_OPTIONS }) || null; } catch { handle = null; }
    const e = { handle, off: null };
    handles.set(id, e);
    if (handle) { try { e.off = handle.subscribe?.(() => heard()) || null; } catch { e.off = null; } }
    return handle;
  }
  const split = ctx && typeof ctx.makePersonState === 'function'
    ? splitLadderStore({ shared, ownIds: () => (me() ? [me()] : []), ownFor }) : null;
  const handle = () => (ctx?.personId ? handles.get(ctx.personId)?.handle || null : null);
  const doc = () => { try { return handle()?.get?.() || null; } catch { return null; } };
  const personStart = () => { const s = doc()?.start; return START_WORDS.includes(s) ? s : null; };
  const personMark = () => { const m = doc()?.startMark; return m == null || m === '' ? null : String(m); };
  const rawWord = () => (START_WORDS.includes(raw) ? raw : null);
  const kept = () => !!(split && me() && handle());

  function heard() {
    if (dead) return;
    syncToPanel();
    const now = `${personStart() || ''}|${personMark() || ''}`;
    if (now !== lastSeen) { lastSeen = now; try { onChange(); } catch (err) { console.error('ladder: start', err); } }
  }
  // The person's row is the truth; the panel's copy is what the menu shows. A copy the person's row has never
  // had (chosen on this panel before it knew the person) is given to the person, without starting them again.
  function syncToPanel() {
    const h = handle();
    if (!h) return;
    const s = personStart();
    if (!s) {
      if (rawWord() && split && me()) {
        split.ownReady(me()).then(() => {
          if (!dead && !personStart() && rawWord() && handle()) { try { handle().set({ start: raw }); } catch { /* next time */ } }
        });
      }
      return;
    }
    if (s === raw || typeof ctx.state?.set !== 'function') return;
    raw = s;   // first, so the panel's own echo of this is not read as somebody changing it
    try { ctx.state.set({ [settingKey]: s }); } catch (err) { console.error('ladder: start copy', err); }
  }
  // Somebody changed "Start games at" in the menu.
  async function apply(v) {
    if (kept()) {
      const pid = me();
      await split.ownReady(pid);
      if (dead || !handle()) return;
      if (personStart() === v) return;     // a copy coming back from the person's row: nobody changed it
      try { handle().set({ start: v, startMark: newStartMark() }); } catch (err) { console.error('ladder: start', err); }
      return;
    }
    // No row of their own here: the panel's, for its one player, in the games this panel deals.
    if (!session || dead) return;
    const pid = solo();
    for (const g of Object.keys(session.ladder()?.players?.[pid]?.games || {})) {
      if ((session.allQuestions(g) || []).length) session.startAt(pid, g, v);
    }
  }
  return {
    store: split || shared,
    /** The level word this player starts at: the person's own, else the panel's for its one player. */
    startFor(pid) {
      if (!pid) return null;
      if (pid === me() && handle()) return personStart() || rawWord();
      if (pid === solo()) return rawWord();
      return null;
    },
    startMark: (pid) => (pid && pid === me() && handle() ? personMark() : null),
    attach(s) { session = s || null; },
    onConfig(cfg) {
      const v = cfg ? cfg[settingKey] : undefined;
      if (!seenRaw) { seenRaw = true; raw = v; syncToPanel(); return; }
      if (v === raw) return;
      raw = v;
      if (START_WORDS.includes(v)) apply(v).catch((err) => console.error('ladder: start', err));
    },
    /** The person's own row's handle, once there is one (a suite reads it). */
    ownHandle: () => handle(),
    flush: () => Promise.resolve().then(() => (split ? split.flush() : shared?.flush?.())).catch(() => {}),
    destroy() {
      dead = true;
      session = null;
      const quiet = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch { /* gone */ } };
      try { split?.destroy(); } catch { /* gone */ }
      quiet(() => shared?.flush?.());
      quiet(() => shared?.destroy?.());
      for (const { handle: h, off } of handles.values()) {
        try { off?.(); } catch { /* none */ }
        quiet(() => h?.flush?.());
        quiet(() => h?.destroy?.());
      }
      handles.clear();
    },
  };
}

/** Two ladders into one: the saved one, with anything this page has recorded since laid over it. */
export function mergeLadder(saved, local) {
  const a = saved && typeof saved === 'object' ? saved : emptyLadder();
  const b = local && typeof local === 'object' ? local : emptyLadder();
  const players = { ...(a.players || {}) };
  for (const [pid, row] of Object.entries(b.players || {})) {
    players[pid] = { ...(players[pid] || {}), ...row, games: { ...(players[pid]?.games || {}), ...(row?.games || {}) } };
  }
  const extra = { ...(a.extra || {}) };
  for (const [g, list] of Object.entries(b.extra || {})) {
    const ids = new Set((extra[g] || []).map((q) => q.id));
    extra[g] = [...(extra[g] || []), ...(list || []).filter((q) => !ids.has(q.id))].slice(-EXTRA_CAP);
  }
  return { v: 1, players, questions: { ...(a.questions || {}), ...(b.questions || {}) }, extra };
}

/**
 * ONE SESSION PER GAME PANEL.
 *   cfg()            the panel's settings (ADAPTIVE_DEFAULTS underneath)
 *   bankFor(game)    the seed questions: [{ id, level, ... }]
 *   store            a state handle ({ load, get, set }) or null for memory only
 *   writer           async ({ game, level, examples, count, existing }) -> [{ id, level, ... }], or null
 *   personId()       the screen's person, for the one-player id
 *   startFor(pid, game)  where this player starts in this game: a level, a word ('easy' / 'medium' /
 *                    'hard', `startWordLevel` over the game's written levels), or null for the
 *                    `startLevel` setting (the screen's person's own start, kept with them)
 *   startMark(pid)   the mark of this player's last "start again" (openPersonLadder), or null. A row of
 *                    theirs with a different mark is read as starting again at `startFor`.
 */
export function createAdaptiveSession({ cfg = () => ({}), bankFor = () => [], store = null, writer = null,
  now = () => Date.now(), rand = Math.random, personId = () => null, onChange = () => {}, rating = {},
  startFor = () => null, startMark = () => null } = {}) {
  const R = { ...RATING_DEFAULTS, ...(rating || {}) };
  let data = emptyLadder();
  // The row as this session last saw it (loaded, adopted or saved): the `base` of the merge above.
  let synced = emptyLadder();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  let turn = 0;
  let asked = 0;
  let current = null;          // { player, game, id, item, review }
  let lastPlayer = null;
  let lastMove = null;         // { player, game, moved } the last time a floor moved
  let dead = false;
  const tally = {};            // pid -> right answers this sitting
  const recent = {};           // pid -> ids dealt lately
  const writing = {};          // game -> true while the writer runs
  const sitting = `s${now()}`;
  const c = () => ({ ...ADAPTIVE_DEFAULTS, ...(cfg() || {}) });

  // A newer copy of the row (loaded, or written by another game on this screen or another screen):
  // whatever this session has not changed since it last saw the row is taken from it.
  function adopt(saved) {
    if (!saved || typeof saved !== 'object') return false;
    const before = JSON.stringify(data);
    data = mergeLadder3(synced, data, saved);
    synced = clone(saved);
    return JSON.stringify(data) !== before;
  }
  if (store && typeof store.load === 'function') {
    Promise.resolve(store.load()).then(() => {
      if (dead) return;
      const saved = store.get?.()?.ladder;
      if (saved) { adopt(saved); onChange(); }
    }).catch(() => {});
  }
  let offStore = null;
  if (store && typeof store.subscribe === 'function') {
    try {
      offStore = store.subscribe((snap) => {
        if (dead || !snap?.ladder) return;
        if (adopt(snap.ladder)) onChange();
      });
    } catch { offStore = null; }
  }
  // READ, MERGE, WRITE: never the whole ladder as this session loaded it (see the merge above).
  function persist() {
    if (!store?.set) return;
    try {
      const latest = store.get?.()?.ladder;
      if (latest) data = mergeLadder3(synced, data, latest);
      synced = clone(data);
      store.set({ ladder: data });
    } catch (err) { console.error('ladder: save', err); }
  }

  const players = () => parsePlayers(c().players, { personId: personId() });
  const currentPlayer = () => { const ps = players(); return ps[turn % ps.length]; };
  // A word is read over the game's WRITTEN levels (its bank), not any AI-written above them, so "hard" is
  // the hardest level somebody wrote, the same on every screen.
  const writtenTop = (game) => {
    const seed = (bankFor(game) || []).filter((q) => q && q.id);
    return maxLevelOf(seed.length ? seed : allQuestions(game));
  };
  const asLevel = (v, game) => (typeof v === 'string' && !Number.isFinite(Number(v)) ? startWordLevel(v, writtenTop(game)) : v);
  const startLevel = (pid = null, game = null) => {
    let own = null;
    try { own = pid ? asLevel(startFor(pid, game), game) : null; } catch { own = null; }
    const v = own != null && Number.isFinite(Number(own)) && Number(own) >= 1 ? own : c().startLevel;
    return Math.max(1, Math.floor(Number(v) || 1));
  };
  const markOf = (pid) => {
    let m = null;
    try { m = pid ? startMark(pid) : null; } catch { m = null; }
    return m == null || m === '' ? null : String(m);
  };

  function allQuestions(game) {
    const seed = (bankFor(game) || []).filter((q) => q && q.id);
    const extra = (data.extra?.[game] || []).filter((q) => q && q.id);
    return [...seed, ...extra];
  }
  const maxLevelOf = (list) => list.reduce((m, q) => Math.max(m, Math.floor(Number(q.level) || 1)), 1);
  function questionRow(q) {
    const r = data.questions[q.id];
    return r && Number.isFinite(r.rating) ? r : { rating: levelRating(q.level || 1, R), n: 0 };
  }
  function playerRow(pid, game) {
    const r = data.players[pid]?.games?.[game];
    const mark = markOf(pid);
    if (r && Number.isFinite(r.rating)) {
      if (mark == null || r.mark === mark) return r;
      // THEIR START WAS CHANGED since this row was last played (openPersonLadder): it starts again there,
      // as `startAt` does. Saved with the mark at their next answer, so this happens once per change.
      const s = startLevel(pid, game);
      return { ...r, rating: levelRating(s, R), floor: s, recent: [], mark };
    }
    const s = startLevel(pid, game);
    return { rating: levelRating(s, R), n: 0, floor: s, recent: [], review: {}, ...(mark != null ? { mark } : {}) };
  }
  function savePlayer(p, game, row) {
    const was = data.players[p.id] || { name: p.name, games: {} };
    data.players[p.id] = { ...was, name: p.name || was.name || '', games: { ...(was.games || {}), [game]: row } };
  }

  // 'auto' (by level) passes through as 'auto'; a number is the old flat rule (rating.js thresholdsAt).
  const auto = (v) => (v === 'auto' || v == null || v === '' ? 'auto' : Number(v));
  const share = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1 ? Number(v) : d);
  function ladderOpts(maxLevel) {
    const k = c();
    return { moveUpAbove: auto(k.moveUpAbove), moveDownBelow: auto(k.moveDownBelow),
      upEasy: share(k.upEasy, THRESHOLD_DEFAULTS.upEasy), upHard: share(k.upHard, THRESHOLD_DEFAULTS.upHard),
      downEasy: share(k.downEasy, THRESHOLD_DEFAULTS.downEasy), downHard: share(k.downHard, THRESHOLD_DEFAULTS.downHard),
      judgeOver: Number(k.judgeOver) || LADDER_DEFAULTS.judgeOver,
      levelsAtOnce: Number(k.levelsAtOnce) || LADDER_DEFAULTS.levelsAtOnce, maxLevel, ...R };
  }

  /** The window of levels this player is on in this game right now. */
  function windowFor(pid, game) {
    const list = allQuestions(game);
    const maxLevel = maxLevelOf(list);
    const row = playerRow(pid, game);
    const floor = c().adapt === false ? startLevel(pid, game) : row.floor;
    return { ...poolLevels(floor, Number(c().levelsAtOnce) || 2, maxLevel), maxLevel, floor };
  }

  /**
   * The next question for whoever's turn it is. Due reviews first, then the pool.
   * `again`: deal THIS question again (row 2.45's word builder: one set of letters is several answers,
   * each rated on its own, so the same question is dealt once per word until it is used up).
   */
  function deal(game, { again = null } = {}) {
    const list = allQuestions(game);
    if (!list.length) return null;
    const p = currentPlayer();
    const row = playerRow(p.id, game);
    const rated = list.map((q) => ({ id: q.id, rating: questionRow(q).rating, item: q }));
    const byId = new Map(rated.map((q) => [q.id, q]));
    const mine = recent[p.id] || [];
    let pick = again != null && byId.has(again) ? byId.get(again) : null;
    let review = false;
    if (!pick && c().review !== 'off') {
      const due = dueIds(row.review, { now: now(), asked, sitting })
        .filter((id) => byId.has(id) && id !== mine[mine.length - 1]);
      if (due.length) { pick = byId.get(due[0]); review = true; }
    }
    const win = windowFor(p.id, game);
    const pool = poolFor(rated, win.floor, ladderOpts(win.maxLevel));
    if (!pick) {
      pick = choose(pool.length ? pool : rated, { playerRating: row.rating, recentIds: mine, rand, ...R,
        target: LADDER_DEFAULTS.target, spread: LADDER_DEFAULTS.spread, avoidRecent: LADDER_DEFAULTS.avoidRecent });
    }
    asked += 1;
    recent[p.id] = [...mine, pick.id].slice(-8);
    current = { player: p, game, id: pick.id, item: pick.item, review };
    maybeWrite(game, pool.filter((q) => !recent[p.id].includes(q.id)).length, win);
    return pick.item;
  }

  /** One finished question (the engine's `onResult`). Returns what changed, for a test or a host. */
  function record(result = {}) {
    if (!current) return null;
    const id = result.item?.id;
    if (id && id !== current.id) return null;
    const { player: p, game } = current;
    const q = current.item;
    current = null;
    const outcome = result.skipped ? 'missed' : outcomeOf(result);
    const score = scoreOf(outcome, R);
    const prow = playerRow(p.id, game);
    const qrow = questionRow(q);
    const r = rateAnswer(prow, qrow, score, R);
    const maxLevel = maxLevelOf(allQuestions(game));
    const step = c().adapt === false
      ? { floor: prow.floor, recent: prow.recent || [], moved: null }
      : stepFloor({ floor: prow.floor, recent: prow.recent }, score, ladderOpts(maxLevel));
    const review = { ...(prow.review || {}) };
    const entry = scheduleReview(review[q.id], outcome, { now: now(), asked, sitting,
      steps: REVIEW_SCHEDULES[c().review] ? c().review : 'standard' });
    if (entry) review[q.id] = entry; else delete review[q.id];
    savePlayer(p, game, { rating: r.player.rating, n: r.player.n, floor: step.floor, recent: step.recent, review,
      ...(prow.mark != null ? { mark: prow.mark } : {}) });
    data.questions[q.id] = r.question;
    if (result.right) tally[p.id] = (tally[p.id] || 0) + 1;
    lastPlayer = p;
    if (step.moved) lastMove = { player: p, game, moved: step.moved, floor: step.floor };
    const ps = players();
    turn = ps.length > 1 ? (ps.findIndex((x) => x.id === p.id) + 1) % ps.length : 0;
    persist();
    return { player: p, outcome, score, rating: r, floor: step.floor, moved: step.moved, review: entry };
  }

  // ---- the question writer: an open model, off unless turned on ----
  function maybeWrite(game, freshLeft, win) {
    const k = c();
    if (k.aiWrite !== 'local' || typeof writer !== 'function' || writing[game]) return;
    if (freshLeft >= (Number(k.aiWhenFewer) || ADAPTIVE_DEFAULTS.aiWhenFewer)) return;
    // At the top of what the bank holds, write the NEXT level up: that is how the questions keep
    // getting harder after the hand-written ones run out ("the AI keeps generating questions").
    const level = win.hi >= win.maxLevel ? Math.min(10, win.maxLevel + 1) : win.hi;
    const all = allQuestions(game);
    const examples = all.filter((q) => (q.level || 1) === Math.min(level, win.maxLevel)).slice(0, 3);
    writing[game] = true;
    Promise.resolve()
      .then(() => writer({ game, level, examples, count: 8, existing: all }))
      .then((items) => {
        if (dead || !Array.isArray(items) || !items.length) return;
        const have = new Set(allQuestions(game).map((q) => q.id));
        const fresh = items.filter((q) => q && q.id && !have.has(q.id)).map((q) => ({ ...q, level: q.level || level }));
        if (!fresh.length) return;
        data.extra[game] = [...(data.extra[game] || []), ...fresh].slice(-EXTRA_CAP);
        persist();
        onChange();
      })
      .catch((err) => console.error('ladder: writer', err))
      .finally(() => { writing[game] = false; });
  }

  // ---- what a view shows ----
  function chip(p, { next = false, game = null } = {}) {
    if (!p) return '';
    const k = c();
    const many = players().length > 1;
    if (!many && !k.showLevel) return '';
    const name = p.name || '';
    const initial = esc((name.trim()[0] || '•').toUpperCase());
    const lvl = k.showLevel && game ? ` · level ${windowFor(p.id, game).floor}` : '';
    const label = `${next ? 'Next: ' : ''}${name}${lvl}`;
    return `<span class="qz-turn" data-turn="${esc(p.id)}"${next ? ' data-next' : ''}>`
      + `<span class="qz-token" data-p="${p.index % MAX_PLAYERS}" aria-hidden="true">${initial}</span>${esc(label)}</span>`;
  }

  return {
    deal,
    record,
    players,
    currentPlayer,
    playerRow,
    questionRow,
    windowFor,
    allQuestions,
    /** The step-up / step-down this player has right now in this game (rating.js `thresholdsAt`). */
    thresholds(game, pid = currentPlayer().id) {
      const w = windowFor(pid, game);
      return thresholdsAt(w.floor, w.maxLevel, ladderOpts(w.maxLevel));
    },
    /**
     * Put this player at `level` in this game NOW: the floor there, the rating that level's, the answers
     * being judged cleared (they were judged at the old level). Kept: how many they have answered, and
     * what is due to come back. For an explicit change by a person (Trivia's "Start trivia at"), never by play.
     * `level` may be a word ('easy' / 'medium' / 'hard'), read over this game's written levels.
     */
    startAt(pid, game, level) {
      if (!pid || !game) return null;
      const L = Math.max(1, Math.floor(Number(asLevel(level, game)) || 1));
      const prow = playerRow(pid, game);
      const mark = markOf(pid);
      const row = { ...prow, rating: levelRating(L, R), floor: L, recent: [], ...(mark != null ? { mark } : {}) };
      const p = players().find((x) => x.id === pid) || { id: pid, name: data.players[pid]?.name || '' };
      savePlayer(p, game, row);
      persist();
      onChange();
      return row;
    },
    tally: () => ({ ...tally }),
    lastPlayer: () => lastPlayer,
    lastMove: () => lastMove,
    dealt: () => current,
    asked: () => asked,
    ladder: () => data,
    isWriting: (game) => !!writing[game],
    /** "Ann, your turn. " in front of a question when there is more than one player. */
    askPrefix() {
      if (players().length < 2) return '';
      const p = current?.player || currentPlayer();
      return `${fill(c().turnLine, { player: p.name })} `;
    },
    /** The chip in front of the question: who is answering, who just answered, or who is next. */
    turnHtml(s = {}, game = null) {
      const ph = s.phase;
      if (ph === 'celebrate' || ph === 'gentle' || ph === 'answer') return chip(lastPlayer || currentPlayer(), { game });
      // 'another' is the "another one?" question (askAnother, 4c6f166): who's next shows there too.
      if (ph === 'another' || ph === 'done') {
        return players().length > 1 ? chip(currentPlayer(), { next: true, game }) : chip(lastPlayer, { game });
      }
      return chip(current?.player || currentPlayer(), { game });
    },
    /** "Ann 3 · Bob 2", or '' with one player. */
    scoreDetail() {
      const ps = players();
      if (ps.length < 2) return '';
      return ps.map((p) => `${p.name} ${tally[p.id] || 0}`).join(' · ');
    },
    /** Points for this right answer? The first player only, unless `pointsFor` says everyone. */
    allowAward() {
      if (c().pointsFor === 'all') return true;
      // The engine pays BEFORE it reports the result, so the question is still dealt here.
      const p = current?.player || lastPlayer;
      return !p || p.index === 0;
    },
    destroy() { dead = true; try { offStore?.(); } catch { /* a store without unsubscribe */ } offStore = null; },
  };
}
