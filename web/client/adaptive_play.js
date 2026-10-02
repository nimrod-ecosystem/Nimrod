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
// none. On Mike's list. With no `makeState` (a test, a bare host) it is kept in memory only.
//
// WHO THE PLAYERS ARE. The `players` setting: names in turn order ("Ann, Bob"). Empty is one player,
// the screen's own person, with nothing drawn about turns at all. Up to FOUR: a longer order is a
// long wait between one person's turns, and four is as many distinct colours as the theme has.

import {
  RATING_DEFAULTS, LADDER_DEFAULTS, REVIEW_SCHEDULES, rateAnswer, levelRating, poolFor, poolLevels,
  stepFloor, choose, scheduleReview, dueIds, outcomeOf, scoreOf,
} from './rating.js';
import { esc, fill, normalize } from './quiz_flow.js';

export const LADDER_KEY = 'ratings';
export const MAX_PLAYERS = 4;
// How many AI-written questions one game keeps on a screen. Old ones are dropped first. A bound,
// so a writer left on for a year cannot grow the shared row without limit.
export const EXTRA_CAP = 300;

export const ADAPTIVE_LINES = Object.freeze({
  turnLine: '{player}, your turn.',
});

export const ADAPTIVE_DEFAULTS = Object.freeze({
  players: '',
  startLevel: 1,
  adapt: true,
  moveUpAbove: LADDER_DEFAULTS.moveUpAbove,
  moveDownBelow: LADDER_DEFAULTS.moveDownBelow,
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
 *   moveUpAbove 80%   Mike's number. Strictly above: with the last 10 judged, that is 9 of 10.
 *   moveDownBelow 50% Not asked for, and a GUESS on Mike's list. Without it somebody moved up by a
 *                     lucky streak is stuck on questions they keep missing. Half is clearly above
 *                     chance on three choices (33%) and clearly struggling. "Never" is a choice.
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
export function adaptiveSettings({ ai = false, appliesWhen = null, startLevels = 5 } = {}) {
  const w = (row) => (appliesWhen ? { ...row, appliesWhen } : row);
  return [
    w({ key: 'players', label: 'Players, in turn order', kind: 'text', default: '', level: 'standard',
      placeholder: 'One player',
      note: 'Names separated by commas ("Ann, Bob"). Each takes a turn and gets questions at their own level. Up to four.' }),
    w({ key: 'adapt', label: 'Questions get harder and easier by themselves', default: true, level: 'standard',
      onLabel: 'Yes, for each player', offLabel: 'No, stay at the starting level' }),
    w({ key: 'startLevel', label: 'A new player starts at level', kind: 'choice', default: 1, level: 'advanced',
      options: Array.from({ length: Math.max(2, startLevels) }, (_, i) => ({ value: i + 1, label: String(i + 1) })) }),
    w({ key: 'moveUpAbove', label: 'Harder questions when the last answers are more than', kind: 'choice',
      default: 0.8, level: 'advanced', options: [0.6, 0.7, 0.75, 0.8, 0.85, 0.9].map((v) => ({ value: v, label: `${pct(v)} right` })) }),
    w({ key: 'moveDownBelow', label: 'Easier questions when the last answers are less than', kind: 'choice',
      default: 0.5, level: 'advanced',
      options: [{ value: 0, label: 'Never easier' }, ...[0.3, 0.4, 0.5, 0.6].map((v) => ({ value: v, label: `${pct(v)} right` }))] }),
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
 */
export function createAdaptiveSession({ cfg = () => ({}), bankFor = () => [], store = null, writer = null,
  now = () => Date.now(), rand = Math.random, personId = () => null, onChange = () => {}, rating = {} } = {}) {
  const R = { ...RATING_DEFAULTS, ...(rating || {}) };
  let data = emptyLadder();
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

  if (store && typeof store.load === 'function') {
    Promise.resolve(store.load()).then(() => {
      if (dead) return;
      const saved = store.get?.()?.ladder;
      if (saved) { data = mergeLadder(saved, data); onChange(); }
    }).catch(() => {});
  }
  function persist() {
    if (!store?.set) return;
    try { store.set({ ladder: data }); } catch (err) { console.error('ladder: save', err); }
  }

  const players = () => parsePlayers(c().players, { personId: personId() });
  const currentPlayer = () => { const ps = players(); return ps[turn % ps.length]; };
  const startLevel = () => Math.max(1, Math.floor(Number(c().startLevel) || 1));

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
    if (r && Number.isFinite(r.rating)) return r;
    const s = startLevel();
    return { rating: levelRating(s, R), n: 0, floor: s, recent: [], review: {} };
  }
  function savePlayer(p, game, row) {
    const was = data.players[p.id] || { name: p.name, games: {} };
    data.players[p.id] = { ...was, name: p.name || was.name || '', games: { ...(was.games || {}), [game]: row } };
  }

  function ladderOpts(maxLevel) {
    const k = c();
    return { moveUpAbove: Number(k.moveUpAbove), moveDownBelow: Number(k.moveDownBelow),
      judgeOver: Number(k.judgeOver) || LADDER_DEFAULTS.judgeOver,
      levelsAtOnce: Number(k.levelsAtOnce) || LADDER_DEFAULTS.levelsAtOnce, maxLevel, ...R };
  }

  /** The window of levels this player is on in this game right now. */
  function windowFor(pid, game) {
    const list = allQuestions(game);
    const maxLevel = maxLevelOf(list);
    const row = playerRow(pid, game);
    const floor = c().adapt === false ? startLevel() : row.floor;
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
    savePlayer(p, game, { rating: r.player.rating, n: r.player.n, floor: step.floor, recent: step.recent, review });
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
      if (ph === 'done') {
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
    destroy() { dead = true; },
  };
}
