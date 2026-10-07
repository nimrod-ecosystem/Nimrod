// quiz_mix.js — QUIZ MIX: every kind of question in one game, round by round, each player at their own level.
//
// Mike, 2026-10-06: "I'd like a mode with all the different types of questions mixed in: Math, trivia, word forge,
// etc. There should be multiplayer that you can play local, online or over calls. It could pick a random category
// per round and then go through turns and ask each player their question for that round. We should be using the same
// randomizer we use for everything else for the games, but it also takes into account the difficulty of questions
// it asks any user."
//
// THE NAME, argued. "Quiz night" (the brief's first example): social and warm, but it names a time of day (a game at
// ten in the morning is not a quiz night) and reads as trivia only. "Mix it up": friendly, but in a list of games it
// does not say what it is. "Mixed questions": exactly what it is, and a mouthful to say ("play mixed questions").
// "QUIZ MIX": two short words, says it is questions and that they are mixed, and is easy to say to start it. Type
// `quiz_mix`. [Guess, on Mike's list.]
//
// A GAME, round by round:
//   1. A ROUND'S CATEGORY is drawn through rng.js - the same weighted picker photos and YouTube use (freshness: a
//      kind not played lately first; recency: not again too soon) - in two steps, so a game with many categories
//      (Trivia: a topic per pack) does not crowd out one with a single category (Math): first WHICH GAME, then
//      which of its categories. A different game every round by default (`repeatGame`, off).
//   2. EACH PLAYER IN TURN gets THEIR OWN question in that category, at THEIR level: dealt from that game's own
//      questions, off that player's own ladder in that game (question_kinds.js), drawn through the same picker with
//      how well each question fits them as one more factor (question_pick.js: weight = rng weight x fit).
//   3. THE ANSWER goes on that player's ladder in that game, exactly as playing the game itself would: a level won
//      here is a level in Brain games, Math or Trivia too, kept with the person on every screen of theirs.
//   4. THE TABLE: a right answer is worth more the harder it was for that player (question_pick.js `turnPoints`),
//      so two people with a skill gap can play each other. Plain points are one setting away.
// Everything between a question and the next - say it, tap it, step through it, yes / no, the hints, the miss
// flow, Start and Pause - is the shared quiz engine (quiz_flow.js, quiz_view.js), the same as every answer game.
//
// LOCAL FIRST (one screen, players taking turns). ONLINE AND OVER A CALL: planned, not built. The shape, so the next
// piece lands where it fits: a "game room" record on the server (one row: the room's code, the host screen, the
// seats - each seat local to one device - the round, whose turn, the question each seat was dealt, and the table),
// changed only by the host screen and read by every device in it through the server's live updates (push.js), each
// device showing the same round and answering its own seats' questions on its own screen. Over a call, the room's
// code rides the call's own signalling (the call has no data channel of its own today), so both screens show the
// game beside the video. The server push is per login today, which is why a room joined from ANOTHER login needs a
// new server piece and is not a few lines.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, answerByField, fill, esc } from '../quiz_flow.js';
import { quizModule } from '../quiz_view.js';
import { autostartFields, START_VOICE } from '../game_start.js';
import { pick, record as rngRecord } from '../rng.js';
import { ladderChooser, turnPoints } from '../question_pick.js';
import { resolvePlayers, MAX_PLAYERS } from '../adaptive_play.js';
import { packsFor } from '../pack_library.js';
import { createContests } from '../contests.js';
import { SOURCES, SOURCE_IDS, SOURCE_LABELS } from '../question_kinds.js';

export const GAME = 'quiz_mix';
// One game, so "play quiz mix" (input_speech.js) has a game to name.
export const GAMES = Object.freeze(['mix']);
export const USE_KEYS = Object.freeze({
  trivia: 'useTrivia', math: 'useMath', words: 'useWords', spelling: 'useSpelling', brain: 'useBrain', think: 'useThink',
});

export const LINES = Object.freeze({
  // The gentler miss words the thinking and brain games use: a mixed table often has somebody young at it.
  wrongLine: 'It sounded like you said {heard}. Not that one.',
  switchWrongLine: 'Not that one.',
  turnLine: '{player}, your turn.',
  roundLine: 'Round {round} of {rounds}: {category}.',
  roundLineNoEnd: 'Round {round}: {category}.',
  scoresLine: 'The scores: {scores}.',
  endLine: 'That is the end of the game. {scores}.',
  noQuestionsLine: 'There are no questions to ask. Turn on another kind of question in the settings.',
});
const LINE_LABELS = {
  turnLine: 'Whose turn (said before the question)', roundLine: 'A new round', roundLineNoEnd: 'A new round (no end set)',
  scoresLine: 'The scores, between rounds', endLine: 'The end of the game', noQuestionsLine: 'Nothing to ask',
};

// EACH DEFAULT, ARGUED (the ones a caregiver would ask about; the shared rows are argued where they live):
//   rounds 10         about ten to fifteen minutes for two players at the shared flow's pace: long enough that the
//                     table means something, short enough to finish before attention goes. 5 to 20, or no end.
//   every game on     "Default all available" (the brief). One row each turns a game off.
//   triviaFrom all    "Every question pack", as Trivia's own default (2026-10-06).
//   repeatGame off    variety is the point of a mix; somebody who likes trivia can turn it on, or turn others off.
//   boards on         spelling and "remember the order" are answered on a letter board; most people can use one,
//                     and somebody who cannot turns them off here without losing the rest.
//   answerTime 0      no timer (the brief, and Code's proposal): a timer is pressure, and a mixed table often has
//                     somebody slow at it on purpose. 20, 30 or 60 seconds for those who want one.
//   scoring harder    a right answer is worth more the harder it was FOR THAT PLAYER (question_pick.js argues it).
//   pointsFor first   the screen's points are the screen's person's (adaptive_play.js argues it): their right
//                     answers earn, a visitor's do not, unless "Every player".
export const DEFAULTS = Object.freeze({
  game: 'mix',
  rounds: 10,
  useTrivia: true, useMath: true, useWords: true, useSpelling: true, useBrain: true, useThink: true,
  triviaFrom: 'all',
  repeatGame: false,
  boards: true,
  answerTime: 0,
  scoring: 'harder',
  pointsFor: 'first',
  players: '',
  answerBy: 'choices',
  autostart: false,
  autostartAlone: 'same',
  ...LINES,
});

const TRIVIA_PACKS = packsFor('trivia');
const onOff = (key, label, note) => ({ key, label, default: true, level: 'standard', onLabel: 'In the mix', offLabel: 'Left out', ...(note ? { note } : {}) });
const SETTINGS = [
  ...autostartFields({ on: false }),
  { key: 'players', label: 'Players', kind: 'players', default: '', level: 'essential', max: MAX_PLAYERS,
    note: 'Each takes a turn every round, with a question at their own level. Somebody picked from this login plays as '
      + 'themselves; a guest is a name. Up to four.' },
  { key: 'rounds', label: 'Rounds in a game', kind: 'choice', default: 10, level: 'essential',
    options: [5, 10, 15, 20].map((v) => ({ value: v, label: String(v) })).concat([{ value: 0, label: 'No end: keep going' }]),
    note: 'A round is one question for every player.' },
  ownScoreField({ level: 'essential', note: 'Each player\'s points. A Scoreboard on the same screen can show it instead.' }),
  answerByField({ on: 'choices', example: 'Is it Paris?' }),
  onOff('useTrivia', 'Trivia questions'),
  { key: 'triviaFrom', label: 'Trivia questions from', kind: 'choice', default: 'all', level: 'standard',
    options: [{ value: 'all', label: 'Every question pack' }, ...TRIVIA_PACKS.map((p) => ({ value: p.id, label: p.label }))],
    note: 'Each pack\'s topic is a round of its own. Only questions somebody has checked are asked.',
    appliesWhen: (v) => v.useTrivia !== false },
  onOff('useMath', 'Math'),
  onOff('useWords', 'Word Forge (what words mean)'),
  onOff('useSpelling', 'Spelling'),
  onOff('useBrain', 'Brain games'),
  onOff('useThink', 'Thinking games'),
  { key: 'boards', label: 'Questions answered on a letter board', default: true, level: 'standard',
    onLabel: 'In the mix', offLabel: 'Left out', note: 'Spelling, and remembering the order of things.' },
  { key: 'repeatGame', label: 'The same game two rounds running', default: false, level: 'standard',
    onLabel: 'Can happen', offLabel: 'A different game each round' },
  { key: 'scoring', label: 'Points on the table', kind: 'choice', default: 'harder', level: 'standard',
    options: [{ value: 'harder', label: 'More for a question that was harder for that player' },
              { value: 'plain', label: 'One for every right answer' }],
    note: 'Harder: one point for a question they were expected to get, two for a toss-up, three for a stretch. A right '
      + 'answer after a hint is one.' },
  { key: 'answerTime', label: 'Time to answer', kind: 'choice', default: 0, level: 'standard',
    options: [{ value: 0, label: 'No time limit' }, ...[20, 30, 60].map((v) => ({ value: v, label: `${v} seconds` }))],
    note: 'When the time is up, the turn passes to the next player.' },
  { key: 'pointsFor', label: 'Right answers earn points for', kind: 'choice', default: 'first', level: 'advanced',
    options: [{ value: 'first', label: 'The first player only' }, { value: 'all', label: 'Every player' }],
    note: 'Points as every question game pays them: game points, or School points while Learning is on.' },
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

// ---------------------------------------------------------------------------------------------------
// THE ROUND'S CATEGORY - rng.js, in two steps (the header)
// ---------------------------------------------------------------------------------------------------
// tau 0.25 h: rng.js's recency recovery, in hours. Its own default (48 h) is for photos across days; a game is
// minutes long, so a game played fifteen minutes ago is about two-thirds recovered and one played a minute ago is
// near the floor. Argued, not a setting: nobody playing would know what to set it to.
export const ROUND_TAU_HOURS = 0.25;
/**
 * The next round's category. PURE (rand and now injected).
 *   available   [{ id, group, label }]   categories with something to ask right now
 *   last        the previous round's { id, group }, or null
 *   groupStats, catStats   id -> { n, last } (rng.js); groupRecent, catRecent  ids, oldest first
 *   repeatGame  false: not the previous round's game when another is available, nor its category
 */
export function pickRound(available, { last = null, groupStats = {}, catStats = {}, groupRecent = [], catRecent = [],
  now = 0, rand = Math.random, repeatGame = false } = {}) {
  const list = (available || []).filter((a) => a && a.id != null && a.group);
  if (!list.length) return null;
  const opts = { now, rand, excludeLast: 0, excludeFrac: 0, tau: ROUND_TAU_HOURS };
  let groups = [...new Set(list.map((a) => a.group))];
  if (!repeatGame && last && groups.length > 1) groups = groups.filter((g) => g !== last.group);
  const g = pick(groups, groupStats, { ...opts, recent: groupRecent });
  let cats = list.filter((a) => a.group === g);
  if (!repeatGame && last && cats.length > 1) cats = cats.filter((a) => a.id !== last.id);
  const id = pick(cats.map((a) => a.id), catStats, { ...opts, recent: catRecent });
  return cats.find((a) => a.id === id) || cats[0] || null;
}

/** "Ann 7, Bob 5" (a player with no name: "You"). */
export function scoreWords(players, points) {
  return (players || []).map((p) => `${p.name || 'You'} ${points?.[p.id] || 0}`).join(', ');
}

const STYLE_ID = 'quiz-mix-style';
const CSS = `
.qz-pick.qm-opt{font-size:clamp(13px,3.6cqmin,42px);max-width:44cqw;white-space:normal;line-height:1.2}
.wg-pair.qm-pair{font-size:clamp(16px,5cqmin,60px);text-transform:none}
.qm-pts{display:inline-block;margin-inline-start:.4em;font-weight:800;color:var(--text)}
.qm-round{font-weight:700}
.qm-table{margin:0 auto 1.5cqmin;padding:0;list-style:none;display:grid;gap:.6cqmin;font-size:clamp(14px,4.5cqmin,52px)}
.qm-table li{display:flex;gap:1em;justify-content:space-between;min-width:12em}
.qm-table li[data-top] b{text-decoration:underline}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

// ONE HANDLE PER ROW for every source (question_kinds.js header): the screen's `ratings` row is one row, so it is
// opened once, not once per game; likewise each person's. No panel settings row (`state: null`): a game's own
// "Start this game at" copy belongs to that game's panel, not to this one.
function sharedRows(ctx) {
  const made = new Map();
  const memo = (k, open) => {
    if (made.has(k)) return made.get(k).view;
    let real = null;
    try { real = open() || null; } catch { real = null; }
    const view = real ? { ...real, destroy() {} } : null;
    made.set(k, { real, view });
    return view;
  };
  const L = Object.create(ctx || {});
  L.state = null;
  L.makeState = typeof ctx?.makeState === 'function' ? (key, opts) => memo(`s:${key}`, () => ctx.makeState(key, opts)) : undefined;
  L.makePersonState = typeof ctx?.makePersonState === 'function'
    ? (pid, key, opts) => memo(`p:${pid}:${key}`, () => ctx.makePersonState(pid, key, opts)) : undefined;
  return {
    ctx: L,
    close() {
      for (const { real } of made.values()) {
        if (!real) continue;
        try { Promise.resolve(real.flush?.()).catch(() => {}).then(() => real.destroy?.()); } catch { /* gone */ }
      }
      made.clear();
    },
  };
}

registerModule(
  { type: GAME, title: 'Quiz mix', core: 'new',
    description: 'Every kind of question in one game: trivia, math, words, spelling, brain and thinking games. Each '
      + 'round a new kind; each player answers their own question at their own level.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: START_VOICE },
  (ctx) => {
    const rand = ctx.rand || Math.random;
    const now = typeof ctx.now === 'function' ? ctx.now : () => Date.now();
    let cfgNow = { ...DEFAULTS };
    let api = null;
    let dead = false;
    const rows = sharedRows(ctx);
    let contests = null;
    try {
      contests = typeof ctx.makeEvents === 'function' ? createContests({ makeEvents: ctx.makeEvents, bus: ctx.bus }) : null;
      contests?.load?.()?.catch?.(() => {});
    } catch { contests = null; }

    // ---- each player's history per game (what was asked, when), for the draw ----
    const hist = new Map();       // `${pid}|${game}` -> { stats, recent }
    const histOf = (pid, game) => {
      const k = `${pid}|${game}`;
      if (!hist.has(k)) hist.set(k, { stats: {}, recent: [] });
      return hist.get(k);
    };
    const phase = () => { try { return api?.engine.snapshot().phase || 'idle'; } catch { return 'idle'; } };
    const host = {
      ctx, ladderCtx: rows.ctx, rand, now, contests,
      cfg: () => cfgNow,
      overrides: () => ({
        players: cfgNow.players ?? '', speak: cfgNow.speak, sayChoice: cfgNow.sayChoice, answerBy: cfgNow.answerBy,
        twoSwitch: cfgNow.twoSwitch,
        // Each game says nothing of whose turn it is (the mix says it once, with the round), and plays with its
        // own usual choices: no quick look, the numbers to choose from (not the pad), Math on its ladder.
        turnLine: '', quickLookMs: 0, answerWith: 'offer', mathLevel: 'adaptive', dots: 'hint', showWord: false,
        adapt: true, review: 'standard', aiWrite: 'off', showLevel: false,
      }),
      getApi: () => api,
      changed: () => {
        if (dead) return;
        try { if (['loading', 'empty'].includes(phase()) && api?.begun?.()) api.engine.refresh(); } catch { /* next time */ }
        api?.render();
      },
      chooser: (pid, game) => ladderChooser({ statsFor: () => histOf(pid, game).stats, now, rand }),
      stats: (pid, game) => histOf(pid, game).stats,
      recent: (pid, game) => histOf(pid, game).recent.slice(),
      noteDeal(pid, game, id) {
        const h = histOf(pid, game);
        h.stats = rngRecord(h.stats, id, now());
        h.recent = [...h.recent, id].slice(-20);
      },
    };
    const sources = new Map();    // id -> source, made when that game is first in the mix
    const wanted = () => SOURCE_IDS.filter((id) => cfgNow[USE_KEYS[id]] !== false);
    function ensureSources() {
      for (const id of wanted()) {
        if (sources.has(id)) continue;
        try {
          const s = SOURCES[id](host);
          sources.set(id, s);
          s.init?.(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null));
        } catch (err) { console.error(`quiz mix: ${id}`, err); errors.push(`${id}: ${String(err?.stack || err)}`); }
      }
    }

    // ---- the game ----
    const players = () => {
      try { return resolvePlayers(cfgNow.players, { personId: ctx.personId || null, host: ctx.screenPlayers || null }); }
      catch { return [{ id: 'player', name: '', index: 0 }]; }
    };
    const roundsSet = () => Math.max(0, Math.floor(Number(cfgNow.rounds) || 0));
    let round = 0;                // this game's round, from 1 (0: none yet)
    let turn = 0;                 // whose turn in the round (an index into players())
    let roundCat = null;          // { id, group, label }
    let lastCat = null;
    let totals = {};              // player id -> points this game
    let ended = false;            // the last round is over
    let current = null;           // { player, source, cat, item, game, chance, intro, said, points, serial }
    const owner = new WeakMap();  // a dealt item -> its source
    const errors = [];            // what went wrong dealing, for the suite (and anybody reading the console)
    const roundHist = { groupStats: {}, catStats: {}, groupRecent: [], catRecent: [] };

    function newGame() {
      round = 0; turn = 0; roundCat = null; totals = {}; ended = false; current = null;
      stopClock();
    }
    const available = () => {
      const out = [];
      for (const id of wanted()) {
        const s = sources.get(id);
        if (!s) continue;
        for (const c of s.categories()) {
          if (c.board && cfgNow.boards === false) continue;
          let ok = false;
          try { ok = s.has(c.id); } catch { ok = false; }
          if (ok) out.push({ ...c, group: id });
        }
      }
      return out;
    };
    const anyLoading = () => wanted().some((id) => { try { return !!sources.get(id)?.loading(); } catch { return false; } });

    function startRound() {
      const cat = pickRound(available(), { last: lastCat, ...roundHist, now: now(), rand, repeatGame: cfgNow.repeatGame === true });
      if (!cat) return false;
      round += 1;
      turn = 0;
      roundCat = cat;
      lastCat = cat;
      const t = now();
      roundHist.groupStats = rngRecord(roundHist.groupStats, cat.group, t);
      roundHist.catStats = rngRecord(roundHist.catStats, cat.id, t);
      roundHist.groupRecent = [...roundHist.groupRecent, cat.group].slice(-12);
      roundHist.catRecent = [...roundHist.catRecent, cat.id].slice(-24);
      return true;
    }

    // The words before a question: the round (and the scores so far) when it starts, then whose turn it is.
    function introFor(player, ps, fresh) {
      const c = cfgNow;
      const parts = [];
      if (fresh && turn === 0) {
        if (round > 1 && ps.length > 1) parts.push(fill(c.scoresLine, { scores: scoreWords(ps, totals) }));
        const n = roundsSet();
        parts.push(fill(n ? c.roundLine : c.roundLineNoEnd, { round, rounds: n, category: roundCat?.label || '' }));
      }
      const turnLine = ps.length > 1 ? fill(c.turnLine, { player: player.name || `Player ${player.index + 1}` }) : '';
      return { full: [...parts, turnLine].filter(Boolean).join(' '), turn: turnLine };
    }

    function dealTurn(player, cat) {
      const s = sources.get(cat.group);
      if (!s) return null;
      let d = null;
      try { d = s.dealFor(player, cat.id); } catch (err) { console.error('quiz mix: deal', err); errors.push(String(err?.stack || err)); d = null; }
      return d ? { ...d, source: s, cat } : null;
    }

    /** The engine asks for the next question: the next player's turn (and a new round when it is due). */
    function items() {
      if (phase() === 'done') newGame();        // Play again, after the end or a "stop": a new game
      const ps = players();
      if (current) {                            // the last turn is over
        turn += 1;
        current = null;
        if (turn >= ps.length) { roundCat = null; turn = 0; }
      }
      let fresh = false;
      if (!roundCat) {
        if (!startRound()) return anyLoading() ? null : [];
        fresh = true;
      }
      const player = ps[turn % ps.length];
      let d = dealTurn(player, roundCat);
      if (!d) {
        // Nothing in the round's category for THIS player now (a small topic, everything held): another category
        // for this turn only, the round staying what it is.
        const others = available().filter((a) => a.id !== roundCat.id);
        const alt = pickRound(others, { ...roundHist, now: now(), rand, repeatGame: true });
        d = alt ? dealTurn(player, alt) : null;
      }
      if (!d) return anyLoading() ? null : [];
      owner.set(d.item, d.source);
      current = { player, source: d.source, cat: d.cat, item: d.item, game: d.game, chance: d.chance,
        intro: introFor(player, ps, fresh), said: false, points: null };
      return [d.item];
    }

    /** Asked before the next question: was that the last turn of the last round? */
    function over() {
      const n = roundsSet();
      if (!current || !n) return false;
      if (round >= n && turn >= players().length - 1) { ended = true; stopClock(); return true; }
      return false;
    }

    // ---- the one adapter the engine sees: each call handed to the game the question came from ----
    const srcOf = (it) => (it && owner.get(it)) || current?.source || null;
    const kcfg = (s) => { try { return s?.cfg?.() || cfgNow; } catch { return cfgNow; } };
    const call = (it, fn, ...args) => {
      const s = srcOf(it);
      const f = s?.adapter?.[fn];
      return typeof f === 'function' ? f(...args) : undefined;
    };
    function prefixFor(it) {
      if (!current || current.item !== it) return '';
      if (current.said) return current.intro.turn ? `${current.intro.turn} ` : '';
      current.said = true;
      return current.intro.full ? `${current.intro.full} ` : '';
    }
    const mixAdapter = {
      items: () => items(),
      over: () => over(),
      doneLine: (c) => (ended ? fill(c.endLine, { scores: players().length > 1 ? scoreWords(players(), totals)
        : `${totals[players()[0]?.id] || 0} points` }) : ''),
      empty: (c) => c.noQuestionsLine,
      entry: () => { const s = current?.source; const f = s?.adapter?.entry; return typeof f === 'function' ? (f(kcfg(s)) || null) : null; },
      ask: (it) => prefixFor(it) + String(call(it, 'ask', it, kcfg(srcOf(it))) || '').trim(),
      candidates: (it, c, r) => call(it, 'candidates', it, kcfg(srcOf(it)), r) || [],
      offer: (it, cand) => String(call(it, 'offer', it, cand, kcfg(srcOf(it))) || ''),
      judge: (it, v) => { const r = call(it, 'judge', it, v); return r === undefined ? null : r; },
      hint: (it, n) => String(call(it, 'hint', it, n, kcfg(srcOf(it))) || ''),
      answer: (it) => call(it, 'answer', it),
      explain: (it, answer) => String(call(it, 'explain', it, answer, kcfg(srcOf(it))) || ''),
      maxEntry: (it) => call(it, 'maxEntry', it, kcfg(srcOf(it))),
      vocab: (it) => call(it, 'vocab', it, kcfg(srcOf(it))) || [],
      heardText: (v) => { const s = current?.source; const f = s?.adapter?.heardText; return typeof f === 'function' ? f(v) : String(v); },
      fromVoice: (it, heard) => call(it, 'fromVoice', it, heard, kcfg(srcOf(it))) ?? null,
      command: (cmd, it) => call(it, 'command', cmd, it, kcfg(srcOf(it))),
      unknownLine: (v) => { const s = current?.source; const f = s?.adapter?.unknownLine; return typeof f === 'function' ? f(v, kcfg(s)) : ''; },
      choiceLabel: (it, v) => call(it, 'choiceLabel', it, v, kcfg(srcOf(it))) ?? String(v),
    };

    // ---- the time to answer (off by default) ----
    let clock = null;             // { left, serial, timer }
    function stopClock() {
      if (clock?.timer != null) { try { api?.clearTimer(clock.timer); } catch { /* gone */ } }
      clock = null;
    }
    function startClock() {
      stopClock();
      const secs = Math.floor(Number(cfgNow.answerTime) || 0);
      if (!(secs > 0) || !api) return;
      const serial = api.engine.snapshot().serial;
      clock = { left: secs, serial, timer: null };
      const tick = () => {
        if (!clock || dead) return;
        const s = api.engine.snapshot();
        if (s.serial !== clock.serial || !['asking', 'unsure', 'twoMiss'].includes(s.phase)) { stopClock(); api.render(); return; }
        if (!api.paused?.()) clock.left -= 1;
        if (clock.left <= 0) { stopClock(); api.engine.skip(); return; }
        clock.timer = api.setTimer(tick, 1000);
        api.render();
      };
      clock.timer = api.setTimer(tick, 1000);
    }

    // ---- the view: each question drawn by its own game; the round, turns and table drawn here ----
    const kview = () => current?.source?.view || {};
    const chip = (p, { next = false } = {}) => {
      if (!p) return '';
      const initial = esc((String(p.name || '').trim()[0] || '•').toUpperCase());
      return `<span class="qz-turn" data-turn="${esc(p.id)}"${next ? ' data-next' : ''}>`
        + `<span class="qz-token" data-p="${p.index % MAX_PLAYERS}" aria-hidden="true">${initial}</span>${esc(`${next ? 'Next: ' : ''}${p.name}`)}</span>`;
    };
    function turnHtml(s) {
      if (s.phase === 'done' || !current) return '';
      const n = roundsSet();
      const roundBit = `<span class="qz-turn qm-round" data-round="${round}">${esc(n ? `Round ${round} of ${n}` : `Round ${round}`)}`
        + `${current.cat?.label ? ` · ${esc(current.cat.label)}` : ''}</span>`;
      const who = players().length > 1 ? chip(current.player) : '';
      const time = clock ? `<span class="qz-turn qm-clock" data-clock="${clock.left}">${clock.left} s</span>` : '';
      return roundBit + who + time;
    }
    const tableHtml = (ps) => {
      const sorted = [...ps].sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));
      const top = sorted.length ? (totals[sorted[0].id] || 0) : 0;
      return `<ol class="qm-table" data-table>${sorted.map((p) => `<li data-player="${esc(p.id)}"${(totals[p.id] || 0) === top && top > 0 ? ' data-top' : ''}>`
        + `<b>${esc(p.name || 'You')}</b><span>${totals[p.id] || 0}</span></li>`).join('')}</ol>`;
    };
    const pointsHtml = () => {
      const n = current?.points;
      if (!(n > 0)) return '';
      const who = players().length > 1 && current.player.name ? ` for ${current.player.name}` : '';
      return ` <span class="qm-pts" data-points="${n}">+${n} ${n === 1 ? 'point' : 'points'}${esc(who)}</span>`;
    };
    const view = {
      askHtml: (s) => (kview().askHtml ? kview().askHtml(s, kcfg(current?.source))
        : esc(String(call(s.item, 'ask', s.item, kcfg(srcOf(s.item))) || ''))),
      left: (s) => (kview().left ? kview().left(s, kcfg(current?.source)) : ''),
      board: (s) => (kview().board ? kview().board(s, kcfg(current?.source)) : []),
      entryHtml: (s) => (kview().entryHtml ? kview().entryHtml(s, kcfg(current?.source)) : ''),
      pairHtml: (s) => (kview().pairHtml ? kview().pairHtml(s, kcfg(current?.source))
        : `<div class="wg-pair" data-pair>${esc(String(s.pair?.answer ?? '').toUpperCase())}</div>`),
      explainHtml: (s) => (kview().explainHtml ? kview().explainHtml(s, kcfg(current?.source)) : esc(s.pair?.explain || '')) + pointsHtml(),
      onKey: (k, a) => kview().onKey?.(k, a),
      onDeal: (item, a) => { try { kview().onDeal?.(item, a); } catch (err) { console.error('quiz mix: deal view', err); } startClock(); },
      turnHtml,
      onResult(r) {
        stopClock();
        if (!current || r.item !== current.item) return;
        try { current.source.record(r); } catch (err) { console.error('quiz mix: ladder', err); }
        const pts = turnPoints({ ...r, chance: current.chance, scoring: cfgNow.scoring });
        current.points = pts;
        const pid = current.player.id;
        totals = { ...totals, [pid]: (totals[pid] || 0) + pts };
      },
      allowAward: () => {
        if (cfgNow.pointsFor === 'all') return true;
        return !current || current.player.index === 0;
      },
      scoreDetail: () => scoreWords(players(), totals),
      scoreLine: () => (players().length > 1 ? scoreWords(players(), totals).replace(/, /g, ' · ')
        : `${totals[players()[0]?.id] || 0} points so far.`),
      doneHtml: () => (round > 0 ? tableHtml(players()) : ''),
      pointNote: (game, item) => `quiz mix: ${current?.cat?.label || 'a question'}`,
      onConfig: (c) => {
        cfgNow = c;
        ensureSources();
        for (const s of sources.values()) { try { s.onConfig?.(c); } catch (err) { console.error('quiz mix: config', err); } }
      },
      init(a) {
        api = a;
        ensureStyle(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null));
        ensureSources();          // a host with no settings row still has every game in the mix
      },
      destroy: () => {
        dead = true;
        stopClock();
        for (const s of sources.values()) { try { s.destroy(); } catch { /* gone */ } }
        sources.clear();
        rows.close();
        try { contests?.destroy?.(); } catch { /* gone */ }
      },
    };

    const inner = quizModule({ type: GAME, title: 'Quiz mix', scoreLabel: 'Quiz mix: right answers',
      games: { mix: mixAdapter }, defaults: DEFAULTS, gameKey: 'game', view, startGate: true, autostart: DEFAULTS.autostart })(ctx);
    // For the suite: the game's own state, the sources and their ladders.
    inner.__mix = () => ({ round, turn, roundCat, totals: { ...totals }, ended, current, players: players(),
      sources, history: { ...roundHist }, errors: errors.slice(-5), available: available() });
    return inner;
  },
);
