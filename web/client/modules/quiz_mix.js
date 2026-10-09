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
// PLAYING TOGETHER (2026-10-06): ON THIS SCREEN (players taking turns, as it always was), WITH ANOTHER SCREEN, or ON
// THIS CALL. "Play together" on the panel opens a game room (game_room.js; the server half and every rule's argument
// is web/server/game_rooms.py). This screen is then the HOST: it draws each round's category, keeps the turn order
// and the table, and is the only screen that changes them. Another screen joins with the room's code (or a phone by
// scanning it: /play.html?room=CODE); a login other than this one must be connected to this one, and this screen lets
// them in (or "Anyone connected may join"). "On this call" offers the room to whoever is calling this screen: their
// call page shows the game beside the video, and they join without being let in - the screen offering it to the call
// is the invitation.
//   * EACH SCREEN PLAYS ITS OWN SEATS. When a turn belongs to a seat on another screen, the host sends that screen the
//     turn (the round's category); it deals the question off ITS OWN login's ladder for that player, asks it, judges
//     it, records it on that ladder, and sends back only { seat, category, right, points }. No level, rating or
//     question crosses to another login.
//   * THE WAITS END BY THEMSELVES (CLAUDE.md: a screen never enters a state only an input can leave when the person in
//     front of it cannot give that input). A turn on another screen: "Skip their turn" here at any time, the server
//     skips it if that screen drops (20 s) or nobody answers (150 s), and this screen's own backstop (165 s) if the
//     server cannot be heard. A lobby nobody starts closes after ten minutes. A screen that joined goes back to its own
//     game the moment the room ends, the host disappears (30 s), or it loses the site (45 s). None of it is a modal:
//     the rest of the screen carries on, and every waiting view has its way out on it.

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
import { personWhoField } from './name_that.js';
import { connectGameRoom, createRoomClient, codeWords, normalizeCode, endWords, CODE_LEN } from '../game_room.js';
import { elsewhereQR, themeQrColours, pageAddress } from '../page_links.js';

// THE PLAYING-TOGETHER NUMBERS, each argued:
//   LOBBY_MS 10 min        a room opened and never started closes: long enough to fetch a phone and type a code,
//                          short enough that a forgotten lobby does not sit on a screen all afternoon.
//   REMOTE_TURN_MS 165 s   the host's own backstop for a turn on another screen: the server skips it at 150 s
//                          (game_rooms.py TURN_MAX_S); this only fires when the server cannot be heard.
//   NOTE_MS 20 s           how long "the game together has ended" stays in the corner: read, then gone by itself.
export const LOBBY_MS = 10 * 60 * 1000;
export const REMOTE_TURN_MS = 165000;
export const NOTE_MS = 20000;
// The page a phone opens to join (the QR code on the lobby, and the call page's "Join" beside the video).
export const PLAY_PAGE = '/play.html';
export const playPath = (code) => `${PLAY_PAGE}?room=${encodeURIComponent(code)}`;

export const GAME = 'quiz_mix';
// One game, so "play quiz mix" (input_speech.js) has a game to name.
export const GAMES = Object.freeze(['mix']);
export const USE_KEYS = Object.freeze({
  trivia: 'useTrivia', math: 'useMath', words: 'useWords', spelling: 'useSpelling', brain: 'useBrain', think: 'useThink',
  // Row 2.63 (Mike, 2026-10-07: Name that, Opposites, Rhyming "should be included in the overall pool").
  name: 'useNameThat', wordgames: 'useWordGames',
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
  useNameThat: true, useWordGames: true,
  // Name that person asks about known people and characters, not each player's own (row 2.63, Mike 2026-10-07:
  // "Naming someone from their own pictures wouldn't be a challenge for most people"). 'both' is one row away.
  personWho: 'known',
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
  onOff('useNameThat', 'Name that (animals, states, people)',
    'Name that person asks about known people and characters; with our own people turned on, each player also gets '
      + 'their own recorded messages at the easiest level.'),
  personWhoField({ on: 'known', appliesWhen: (v) => v.useNameThat !== false }),
  onOff('useWordGames', 'Word games (Opposites/Logic, rhyming, yes or no)'),   // opposites/logic (row 2.63)
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

/** "Ann 7, Bob 5" (a player with no name: "You"). Playing together, the points are kept by seat (`p.seat`). */
export function scoreWords(players, points) {
  return (players || []).map((p) => `${p.name || 'You'} ${points?.[p.seat || p.id] || 0}`).join(', ');
}

const STYLE_ID = 'quiz-mix-style';
const CSS = `
.qz-pick.qm-opt{font-size:clamp(13px,3.6cqmin,42px);max-width:44cqw;white-space:normal;line-height:1.2}
.wg-pair.qm-pair{font-size:clamp(16px,5cqmin,60px);text-transform:none}
.qm-pts{display:inline-block;margin-inline-start:.4em;font-weight:800;color:var(--text)}
.qm-means{display:grid;gap:.3em;margin-top:.5em;text-align:start;color:var(--text)}
.qm-mean{display:block}
.qm-mean b{font-weight:800}
.qm-opt .qm-mean{margin-top:.2em;font-size:.8em;font-weight:400;line-height:1.25}
.qm-round{font-weight:700}
.qm-table{margin:0 auto 1.5cqmin;padding:0;list-style:none;display:grid;gap:.6cqmin;font-size:clamp(14px,4.5cqmin,52px)}
.qm-table li{display:flex;gap:1em;justify-content:space-between;min-width:12em}
.qm-table li[data-top] b{text-decoration:underline}
.qm-bar{position:absolute;top:clamp(4px,1.2cqmin,14px);right:clamp(4px,1.2cqmin,14px);z-index:5;display:flex;gap:.5em;
  align-items:center;flex-wrap:wrap;justify-content:flex-end;max-width:72%;font-size:clamp(12px,2.6cqmin,28px)}
.qm-bar .wg-btn{font-size:inherit;min-height:max(36px,7cqmin)}
.qm-chip{background:var(--surface);color:var(--text);border:max(1px,.3cqmin) solid var(--border);border-radius:1em;padding:.2em .7em}
.qm-sheet{position:absolute;inset:0;z-index:6;overflow:auto;background:var(--bg);color:var(--text);box-sizing:border-box;
  padding:clamp(10px,3cqmin,36px);display:flex;flex-direction:column;gap:clamp(6px,1.6cqmin,20px);font-size:clamp(13px,3.4cqmin,36px)}
.qm-sheet h3{margin:0;font-size:1.3em}
.qm-sheet p{margin:0}
.qm-sheet .wg-btns{display:flex;flex-wrap:wrap;gap:.5em}
.qm-sheet .wg-btn[data-on="1"]{outline:max(3px,.8cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(2px,.4cqmin)}
.qm-code{font:800 clamp(28px,12cqmin,140px)/1 var(--font);letter-spacing:.12em}
.qm-lobby{display:flex;flex-wrap:wrap;gap:clamp(8px,2.5cqmin,30px);align-items:flex-start}
.qm-qr{width:clamp(90px,26cqmin,260px)}
.qm-qr svg{width:100%;height:auto;display:block}
.qm-seats{margin:0;padding:0;list-style:none;display:grid;gap:.3em}
.qm-seats li[data-away] {color:var(--text-soft)}
.qm-sheet input{font:inherit;padding:.3em .5em;border-radius:.4em;border:max(2px,.4cqmin) solid var(--border);background:var(--surface);
  color:var(--text);letter-spacing:.15em;text-transform:uppercase;width:8em;max-width:100%}
.qm-soft{color:var(--text-soft)}
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
    description: 'Every kind of question in one game: trivia, math, words, spelling, brain and thinking games, name '
      + 'that, and the word games. Each round a new kind; each player answers their own question at their own level.',
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

    // ---- playing together: the room this screen is in, if any (game_room.js) ----
    let link = null;              // the game socket: opened only when somebody chooses to play together
    let room = null;              // createRoomClient
    const inRoom = () => !!room && room.phase() === 'in';
    const isHost = () => inRoom() && room.role() === 'host';
    const isGuest = () => inRoom() && room.role() === 'guest';
    const roomBusy = () => !!room && ['opening', 'joining', 'asking', 'in'].includes(room.phase());

    // ---- the game ----
    const localPlayers = () => {
      try { return resolvePlayers(cfgNow.players, { personId: ctx.personId || null, host: ctx.screenPlayers || null }); }
      catch { return [{ id: 'player', name: '', index: 0 }]; }
    };
    // Playing together, the turn order is the ROOM's seats, wherever they sit. A seat on this screen is this screen's
    // own player (their ladder id, their name) at the same place in this screen's list; a seat elsewhere is a name and
    // where it is. `seat` is the room's id for it, and what the table is kept by.
    const players = () => {
      const local = localPlayers();
      if (!inRoom()) return local;
      const me = room.you();
      const seats = room.seats();
      const mine = seats.filter((s) => s.device === me);
      return seats.map((s, i) => {
        if (s.device === me) {
          const k = mine.findIndex((m) => m.id === s.id);
          const p = local[k] || { id: `seat:${s.id}`, name: s.name };
          return { ...p, name: p.name || s.name, seat: s.id, index: i, localIndex: k, here: true };
        }
        return { id: `seat:${s.id}`, seat: s.id, name: s.name, index: i, remote: s.device, away: !!s.away };
      });
    };
    const tkey = (p) => p?.seat || p?.id;
    // The table: this screen's own, or - on a screen that joined somebody else's game - the host's.
    const totalsNow = () => (isGuest() ? (room.state().totals || {}) : totals);
    const roundNow = () => (isGuest() ? Number(room.state().round) || 0 : round);
    let lastTable = null;         // a game together that just ended on a screen that joined: its last table
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
      round = 0; turn = 0; roundCat = null; totals = {}; ended = false; current = null; lastTable = null;
      stopClock();
      stopRemoteTimer();
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
        if (round > 1 && ps.length > 1) parts.push(fill(c.scoresLine, { scores: scoreWords(ps, totalsNow()) }));
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
      if (isGuest()) return guestItems();       // a screen that joined: its turns come from the host
      const ps = players();
      if (current) {                            // the last turn is over
        if (current.remote && !current.done) return null;   // ...unless it is still being played on another screen
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
      if (player.remote) return remoteTurn(player, ps, fresh);
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
      publish();
      return [d.item];
    }

    /** Asked before the next question: was that the last turn of the last round? */
    function over() {
      if (isGuest()) return false;              // the host says when a game together is over
      const n = roundsSet();
      if (!current || !n) return false;
      if (round >= n && turn >= players().length - 1) { ended = true; stopClock(); publish(); return true; }
      return false;
    }

    // ---- THE HOST: a turn that belongs to a seat on another screen ----
    let remoteSerial = 0;
    let remoteTimer = null;
    const catWire = (c) => (c ? { group: String(c.group || ''), id: String(c.id || ''), label: String(c.label || '').slice(0, 60) } : null);
    function stopRemoteTimer() {
      if (remoteTimer != null) { try { roomClear(remoteTimer); } catch { /* gone */ } }
      remoteTimer = null;
    }
    function remoteTurn(player, ps, fresh) {
      remoteSerial += 1;
      const serial = remoteSerial;
      const intro = introFor(player, ps, fresh);
      current = { player, remote: true, done: false, serial, cat: roundCat, item: null, intro, points: null };
      room.turn({ seat: player.seat, serial, round: Math.min(999, round), category: catWire(roundCat) });
      publish();
      // The round and whose turn it is, said here too: the people at this screen are in the same game.
      try { api?.say?.(intro.full); } catch { /* silent */ }
      stopRemoteTimer();
      remoteTimer = roomSet(() => { remoteTimer = null; remoteDone({ seat: player.seat, serial, right: false, points: 0, skipped: true, why: 'time' }); }, REMOTE_TURN_MS);
      return null;
    }
    /** A result for the turn out at another screen (from the room, the server's skip, "Skip their turn", or the backstop). */
    function remoteDone(a) {
      if (!current?.remote || current.done || !a || a.seat !== current.player.seat || a.serial !== current.serial) return;
      stopRemoteTimer();
      current.done = true;
      const pts = a.right === true ? Math.max(0, Math.min(3, Math.floor(Number(a.points) || 0))) : 0;
      current.points = pts;
      current.result = { right: a.right === true, skipped: !!a.skipped, why: String(a.why || '') };
      const k = tkey(current.player);
      totals = { ...totals, [k]: (totals[k] || 0) + pts };
      const n = roundsSet();
      const last = !!n && round >= n && turn >= players().length - 1;
      if (last) { ended = true; stopClock(); publish(); api?.engine.end(); }
      else { publish(); api?.engine.refresh(); }
      api?.render();
    }
    /** The host's view of the game, to every screen in the room. Only the host sends it; the server checks. */
    function publish() {
      if (!isHost()) return;
      const ph = phase();
      const c = current?.cat || roundCat;
      const tot = {};
      for (const p of players()) if (p.seat) tot[p.seat] = Math.min(99999, totals[p.seat] || 0);
      room.update({
        phase: ended || ph === 'done' ? 'done' : (api?.begun?.() ? 'playing' : 'lobby'),
        round: Math.min(999, round), rounds: Math.min(99, roundsSet()),
        category: c ? catWire(c) : null, turn: current?.player?.seat || null, totals: tot,
      });
    }

    // ---- A SCREEN THAT JOINED: its turns come from the host ----
    let guestTurn = null;         // { seat, serial, round, category, dealt }
    function guestAnswer(t, { right = false, points = 0, cat = null } = {}) {
      const c = cat || t.category || {};
      try { room?.answer({ seat: t.seat, serial: t.serial, category: { group: String(c.group || ''), id: String(c.id || '') },
        right: !!right, points: right ? Math.max(0, Math.min(3, points | 0)) : 0 }); } catch { /* gone */ }
    }
    function guestItems() {
      // A turn that ended with no answer (skipped before any try, or its clock ran out): still answered, as nothing.
      if (current?.guest && !current.answered) { current.answered = true; guestAnswer(current.guest, { cat: current.cat }); }
      current = null;
      const t = guestTurn;
      if (!t || t.dealt) return null;
      t.dealt = true;
      const player = players().find((p) => p.here && p.seat === t.seat);
      if (!player) { guestAnswer(t); return null; }
      // The host's category if this screen has it; else another of the same game (this login's packs differ); else
      // anything this screen can ask (its own settings - letter boards left out, say - still hold here).
      const av = available();
      let d = null;
      const want = av.find((a) => a.id === t.category?.id);
      if (want) d = dealTurn(player, want);
      if (!d) {
        const same = av.filter((a) => a.group === t.category?.group && a.id !== t.category?.id);
        const alt = pickRound(same.length ? same : av, { ...roundHist, now: now(), rand, repeatGame: true });
        d = alt ? dealTurn(player, alt) : null;
      }
      if (!d) { guestAnswer(t); return null; }
      round = Number(t.round) || round;
      owner.set(d.item, d.source);
      const line = players().length > 1 ? fill(cfgNow.turnLine, { player: player.name || 'Player' }) : '';
      current = { player, source: d.source, cat: d.cat, item: d.item, game: d.game, chance: d.chance,
        intro: { full: line, turn: line }, said: false, points: null, guest: t, answered: false };
      return [d.item];
    }
    function onRoomTurn(t) {
      if (!isGuest() || !t || !t.seat) return;
      guestTurn = { ...t, dealt: false };
      if (!api) return;
      if (!api.begun()) { api.start(); return; }
      if (phase() === 'done') api.engine.press('restart');
      else api.engine.refresh();
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
      doneLine: (c) => {
        publish();                              // the host's "done" (the end, or a "stop") reaches every screen
        const fin = ended || (isGuest() && room.state().phase === 'done');
        const ps = players();
        return fin ? fill(c.endLine, { scores: ps.length > 1 ? scoreWords(ps, totalsNow()) : `${totalsNow()[tkey(ps[0])] || 0} points` }) : '';
      },
      empty: (c) => c.noQuestionsLine,
      entry: () => { const s = current?.source; const f = s?.adapter?.entry; return typeof f === 'function' ? (f(kcfg(s)) || null) : null; },
      ask: (it) => prefixFor(it) + String(call(it, 'ask', it, kcfg(srcOf(it))) || '').trim(),
      candidates: (it, c, r) => call(it, 'candidates', it, kcfg(srcOf(it)), r) || [],
      offer: (it, cand) => String(call(it, 'offer', it, cand, kcfg(srcOf(it))) || ''),
      judge: (it, v) => { const r = call(it, 'judge', it, v); return r === undefined ? null : r; },
      hint: (it, n) => String(call(it, 'hint', it, n, kcfg(srcOf(it))) || ''),
      answer: (it) => call(it, 'answer', it),
      explain: (it, answer) => String(call(it, 'explain', it, answer, kcfg(srcOf(it))) || ''),
      // A source's least time for its answer (quiz_flow.js `holdMs`). None has one since row 2.66: the one wait follows the words.
      holdMs: (it) => Number(call(it, 'holdMs', it, kcfg(srcOf(it)))) || 0,
      maxEntry: (it) => call(it, 'maxEntry', it, kcfg(srcOf(it))),
      vocab: (it) => call(it, 'vocab', it, kcfg(srcOf(it))) || [],
      heardText: (v) => { const s = current?.source; const f = s?.adapter?.heardText; return typeof f === 'function' ? f(v) : String(v); },
      fromVoice: (it, heard) => call(it, 'fromVoice', it, heard, kcfg(srcOf(it))) ?? null,
      command: (cmd, it) => call(it, 'command', cmd, it, kcfg(srcOf(it))),
      // The question on screen goes along as a third argument (Word games tells "not a yes or a no" from "a word it
      // does not know" by it).
      unknownLine: (v) => { const s = current?.source; const f = s?.adapter?.unknownLine; return typeof f === 'function' ? f(v, kcfg(s), current?.item || null) : ''; },
      choiceLabel: (it, v) => call(it, 'choiceLabel', it, v, kcfg(srcOf(it))) ?? String(v),
      // ROW 2.63: Name that person (a clip that can be played again, a gentle miss) and the yes / no quiz. A source
      // may answer `canReplay` and `missStyle` per question (question_kinds.js header); the mix asks with the question
      // on screen. A getter, because the engine reads `canReplay` as a property.
      get canReplay() {
        const v = current?.source?.adapter?.canReplay;
        try { return typeof v === 'function' ? !!v(current.item) : !!v; } catch { return false; }
      },
      missStyle: () => {
        const s = current?.source;
        const f = s?.adapter?.missStyle;
        try { return typeof f === 'function' ? (f(kcfg(s), current.item) || 'standard') : 'standard'; } catch { return 'standard'; }
      },
      gentle: (it) => String(call(it, 'gentle', it, kcfg(srcOf(it))) || ''),
      yesNo: (it) => !!call(it, 'yesNo', it),
      // The after-answer button (row 2.66): with several players taking turns, the next one is somebody else's.
      nextLabel: () => (players().length > 1 ? 'Next player' : ''),
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
      if (s.phase === 'done') return '';
      // Playing together and waiting: the round, and whose turn it is elsewhere, from the room.
      const st = isGuest() ? room.state() : null;
      const whoP = current?.player || (st ? players().find((p) => p.seat === st.turn) : null);
      if (!current && !(st && st.round > 0)) return '';
      const rn = roundNow();
      const n = st ? Number(st.rounds) || 0 : roundsSet();
      const cat = current?.cat || st?.category || null;
      const roundBit = `<span class="qz-turn qm-round" data-round="${rn}">${esc(n ? `Round ${rn} of ${n}` : `Round ${rn}`)}`
        + `${cat?.label ? ` · ${esc(cat.label)}` : ''}</span>`;
      const who = players().length > 1 && whoP ? chip(whoP) : '';
      const time = clock ? `<span class="qz-turn qm-clock" data-clock="${clock.left}">${clock.left} s</span>` : '';
      return roundBit + who + time;
    }
    const tableHtml = (ps, tot = totalsNow()) => {
      const sorted = [...ps].sort((a, b) => (tot[tkey(b)] || 0) - (tot[tkey(a)] || 0));
      const top = sorted.length ? (tot[tkey(sorted[0])] || 0) : 0;
      return `<ol class="qm-table" data-table>${sorted.map((p) => `<li data-player="${esc(p.id)}"${(tot[tkey(p)] || 0) === top && top > 0 ? ' data-top' : ''}>`
        + `<b>${esc(p.name || 'You')}</b><span>${tot[tkey(p)] || 0}</span></li>`).join('')}</ol>`;
    };
    const pointsHtml = () => {
      const n = current?.points;
      if (!(n > 0)) return '';
      const who = players().length > 1 && current.player.name ? ` for ${current.player.name}` : '';
      return ` <span class="qm-pts" data-points="${n}">+${n} ${n === 1 ? 'point' : 'points'}${esc(who)}</span>`;
    };
    // ---------------------------------------------------------------------------------------------------
    // PLAYING TOGETHER: the way in ("Play together"), the lobby, and the waiting views
    // ---------------------------------------------------------------------------------------------------
    // The room's clocks run on their own timer seam (`ctx.roomTimers`), not the panel's: a suite flushing the game's
    // timers must not also fire a ten-minute lobby clock.
    const roomSet = (fn, ms) => (typeof ctx.roomTimers?.set === 'function' ? ctx.roomTimers.set(fn, ms) : setTimeout(fn, ms));
    const roomClear = (id) => (typeof ctx.roomTimers?.clear === 'function' ? ctx.roomTimers.clear(id) : clearTimeout(id));
    let sheet = null;             // null | 'choose' | 'join': the "Play together" layer when no room is open
    let sheetLit = 0;             // the lit button, for a switch
    let showLobby = false;        // the host looking at the room again during a game
    let joinError = '';
    let note = '';                // why the last game together ended, in the corner for NOTE_MS
    let noteTimer = null;
    let lobbyTimer = null;
    const redraw = () => { try { api?.render(); } catch { /* gone */ } };
    const canTogether = () => ctx.gameRooms !== false
      && (typeof ctx.gameLink === 'function' || (typeof WebSocket !== 'undefined' && typeof fetch !== 'undefined'));
    const callLive = () => { try { return !!ctx.personId && !!ctx.callTransport?.isLive?.(); } catch { return false; } };
    function setNote(text) {
      note = text || '';
      if (noteTimer != null) { try { roomClear(noteTimer); } catch { /* gone */ } }
      noteTimer = note ? roomSet(() => { noteTimer = null; note = ''; redraw(); }, NOTE_MS) : null;
    }
    function clearLobby() { if (lobbyTimer != null) { try { roomClear(lobbyTimer); } catch { /* gone */ } } lobbyTimer = null; }
    // This screen's players, as the room shows them: a name for each (the screen's person by their own name).
    function seatNames() {
      let self = '';
      try { self = String(ctx.screenPlayers?.self?.()?.name || ctx.playerName || ''); } catch { self = ''; }
      return localPlayers().map((p, i) => p.name || (i === 0 && self) || `Player ${i + 1}`);
    }
    function ensureRoom() {
      if (room) { try { room.destroy(); } catch { /* gone */ } }
      if (link) { try { link.close(); } catch { /* gone */ } }
      link = typeof ctx.gameLink === 'function' ? ctx.gameLink() : connectGameRoom({ user: ctx.user || null, base: ctx.gameBase || '' });
      room = createRoomClient({
        link,
        setTimer: roomSet, clearTimer: roomClear,
        onChange: () => onRoomChange(),
        onTurn: (t) => onRoomTurn(t),
        onAnswer: (a) => remoteDone(a),
        onEnd: (why) => onRoomEnd(why),
      });
    }
    function startRoom({ call = false } = {}) {
      if (roomBusy() || dead) return false;
      ensureRoom();
      sheet = null; sheetLit = 0; joinError = ''; setNote('');
      room.open({ game: GAME, seats: seatNames(), admit: 'ask', person: call ? ctx.personId || null : null });
      clearLobby();
      lobbyTimer = roomSet(() => { lobbyTimer = null; if (isHost() && !api?.begun?.()) stopTogether('unstarted'); }, LOBBY_MS);
      redraw();
      return true;
    }
    function joinRoom(code) {
      if (roomBusy() || dead) return false;
      const c = normalizeCode(code);
      if (!c) { joinError = `That is not a game code. A code is ${CODE_LEN} letters and numbers, like KX4 9PM.`; sheet = 'join'; redraw(); return false; }
      ensureRoom();
      sheet = null; sheetLit = 0; joinError = ''; setNote('');
      room.join(c, seatNames());
      redraw();
      return true;
    }
    function stopTogether(why = 'stopped') {
      if (!room) return;
      room.leave(why);              // ends here at once (onRoomEnd), and tells the room
    }
    function onRoomChange() {
      if (dead || !room) return;
      if (isGuest()) {
        const st = room.state();
        // The host pressed Start: this screen's game starts with it (it waits for its turns from here on).
        if (st.phase === 'playing' && api && !api.begun()) api.start();
        if (st.phase === 'done' && api?.begun?.() && phase() !== 'done') { current = null; guestTurn = null; api.engine.end(); }
      }
      if (isHost() && current?.remote && !current.done && !players().some((p) => p.seat === current.player.seat)) {
        // The screen holding this turn's seat is gone from the room: the turn passes on.
        remoteDone({ seat: current.player.seat, serial: current.serial, right: false, points: 0, skipped: true, why: 'left' });
      }
      redraw();
    }
    function onRoomEnd(why) {
      const wasGuest = room?.role() === 'guest';
      // A game this screen joined: keep its last table to show, and stop waiting for turns.
      if (wasGuest) {
        try {
          const ps = players();
          lastTable = { players: ps, totals: room.state().totals || {} };
        } catch { lastTable = null; }
      }
      clearLobby();
      stopRemoteTimer();
      showLobby = false;
      setNote(why === 'stopped' || why === 'left' ? '' : endWords(why));
      const r = room;
      const l = link;
      room = null; link = null;
      guestTurn = null;
      // The other screens' seats are gone with the room; a turn out at one of them is over.
      if (current?.remote && !current.done) { current.done = true; current.points = 0; }
      queueMicrotask(() => {
        try { r?.destroy(); } catch { /* gone */ }
        try { l?.close(); } catch { /* gone */ }
        if (dead || !api) return;
        if (wasGuest) {
          current = null;
          if (api.begun() && phase() !== 'done') api.engine.end();     // back to this screen's own game: Play again
        } else if (api.begun() && phase() === 'loading') {
          api.engine.refresh();          // the host carries on with its own players
        }
        redraw();
      });
      redraw();
    }

    // ---- the words ----
    const firstSeatOf = (device) => room?.seats().find((s) => s.device === device) || null;
    const hostName = () => firstSeatOf('d0')?.name || 'the other screen';
    function whereOf(p) {
      if (!p || p.here) return 'this screen';
      const first = firstSeatOf(p.remote);
      return first ? `${first.name}'s screen` : 'another screen';
    }
    const tableLine = () => {
      const ps = players();
      return ps.length > 1 ? `<p class="wg-count" data-score>${esc(scoreWords(ps, totalsNow()).replace(/, /g, ' · '))}</p>` : '';
    };
    function waitingHtml() {
      if (!inRoom()) return '';
      if (isHost() && current?.remote && !current.done) {
        const p = current.player;
        const away = room.seats().find((s) => s.id === p.seat)?.away;
        return `<p class="wg-say" data-remote-turn="${esc(p.seat)}">${esc(`${p.name}'s turn, on ${whereOf(p)}.`)}</p>`
          + (away ? '<p class="wg-say wg-soft" data-away>That screen has dropped off. If it does not come back soon, the turn passes on by itself.</p>' : '')
          + `<div class="wg-btns"><button type="button" class="wg-btn" data-qm="skip">Skip their turn</button></div>${tableLine()}`;
      }
      if (isGuest()) {
        const st = room.state();
        if (room.hostAway()) return `<p class="wg-say" data-host-away>${esc(`Waiting for ${hostName()}'s screen to come back…`)}</p>${tableLine()}`;
        if (st.phase === 'lobby') return `<p class="wg-say" data-lobby>${esc(`Waiting for ${hostName()} to start the game.`)}</p>`;
        const p = players().find((x) => x.seat === st.turn);
        const line = p && !p.here ? `${p.name}'s turn, on ${whereOf(p)}.` : 'Waiting for the next turn.';
        return `<p class="wg-say" data-remote-turn="${esc(p?.seat || '')}">${esc(line)}</p>${tableLine()}`;
      }
      return '';
    }

    // ---- the layer: the corner bar, and the sheet over the panel ----
    // The sheet's buttons, in order, so a switch can step through them (`onMove`) as a finger taps them.
    function sheetButtons(s) {
      if (dead) return [];
      const b = [];
      if (room && ['opening', 'joining', 'asking'].includes(room.phase())) {
        b.push({ act: 'stop', label: room.phase() === 'opening' ? 'Never mind' : 'Stop asking' });
        return b;
      }
      if (isHost() && (!api?.begun?.() || showLobby)) {
        for (const w of room.waiting()) {
          b.push({ act: 'admit', arg: w.id, label: `Let ${w.names.join(' and ')} in` });
          b.push({ act: 'deny', arg: w.id, label: 'Not now' });
        }
        b.push(api?.begun?.() ? { act: 'hide', label: 'Back to the game' } : { act: 'start', label: 'Start the game' });
        b.push({ act: 'admitmode', label: room.admit() === 'connected' ? 'Ask me before each one joins' : 'Let anyone connected join without asking' });
        b.push({ act: 'stop', label: 'Stop playing together' });
        return b;
      }
      if (isGuest() && room.state().phase === 'lobby') { b.push({ act: 'stop', label: 'Leave the game' }); return b; }
      if (inRoom()) return b;
      if (sheet === 'choose') {
        b.push({ act: 'local', label: 'On this screen' });
        b.push({ act: 'host', label: 'With another screen' });
        b.push({ act: 'joinform', label: 'Join a game' });
        if (callLive()) b.push({ act: 'call', label: 'On this call' });
        b.push({ act: 'close', label: 'Back' });
      } else if (sheet === 'join') {
        b.push({ act: 'join', label: 'Join' });
        b.push({ act: 'close', label: 'Back' });
      }
      return b;
    }
    const btnHtml = (list) => `<div class="wg-btns">${list.map((x, i) => `<button type="button" class="wg-btn" data-qm="${esc(x.act)}"`
      + `${x.arg ? ` data-qm-arg="${esc(x.arg)}"` : ''}${i === sheetLit ? ' data-on="1"' : ''}>${esc(x.label)}</button>`).join('')}</div>`;
    const seatList = () => `<ul class="qm-seats" data-seats>${room.seats().map((st) => {
      const p = { here: st.device === room.you(), remote: st.device };
      return `<li data-seat="${esc(st.id)}"${st.away ? ' data-away' : ''}><b>${esc(st.name)}</b> <span class="qm-soft">on ${esc(whereOf(p))}${st.away ? ' (dropped off)' : ''}</span></li>`;
    }).join('')}</ul>`;
    function barHtml(s) {
      if (inRoom() && !(isHost() && (!api?.begun?.() || showLobby)) && !(isGuest() && room.state().phase === 'lobby')) {
        const label = isHost() ? 'Stop playing together' : 'Leave the game';
        return `<div class="qm-bar" data-qm-bar><span class="qm-chip" data-qm-code="${esc(room.code())}">Playing together · ${esc(codeWords(room.code()))}</span>`
          + (isHost() ? '<button type="button" class="wg-btn" data-qm="lobby">Who is playing</button>' : '')
          + `<button type="button" class="wg-btn" data-qm="stop">${esc(label)}</button></div>`;
      }
      if (roomBusy() || sheet) return '';
      const offer = canTogether() && (!api?.begun?.() || s.phase === 'done');
      if (!offer && !note) return '';
      return `<div class="qm-bar" data-qm-bar>${note ? `<span class="qm-chip" data-qm-note role="status">${esc(note)}</span>` : ''}`
        + (offer ? '<button type="button" class="wg-btn" data-qm="open">Play together</button>' : '') + '</div>';
    }
    function sheetBody(s) {
      const btns = sheetButtons(s);
      if (sheetLit >= btns.length) sheetLit = 0;
      const wrap = (kind, inner) => `<div class="qm-sheet" data-qm-sheet="${kind}" role="dialog" aria-label="Play together">${inner}${btnHtml(btns)}</div>`;
      if (room && ['opening', 'joining', 'asking'].includes(room.phase())) {
        const ph = room.phase();
        const line = ph === 'opening' ? 'Opening a game for other screens to join…'
          : ph === 'joining' ? 'Asking to join…' : 'Asked to join. Somebody at that screen needs to let you in.';
        return wrap(ph, `<h3>Play together</h3><p data-qm-status>${esc(line)}</p>`);
      }
      if (isHost() && (!api?.begun?.() || showLobby)) {
        const code = room.code();
        const path = playPath(code);
        let qr = '';
        try { qr = elsewhereQR(path, { colours: themeQrColours(ctx.mount || null) }); } catch { qr = ''; }
        const waiting = room.waiting().map((w) => `<li data-waiting="${esc(w.id)}"><b>${esc(w.names.join(', '))}</b>`
          + `${w.from ? ` <span class="qm-soft">(${esc(w.from)})</span>` : ''} would like to join.</li>`).join('');
        const how = room.call()
          ? '<p data-qm-call>Offered to the call: they can join from their call page, beside the video.</p>' : '';
        return wrap('lobby', `<h3>Play together</h3><div class="qm-lobby"><div><p>The game's code</p>
          <p class="qm-code" data-qm-code="${esc(code)}" aria-label="${esc([...code].join(' '))}">${esc(codeWords(code))}</p>
          <p class="qm-soft">On another screen with Quiz mix: Play together, then Join a game, and enter this code.</p>
          <p class="qm-soft">On a phone: scan the square, or open ${esc(pageAddress(path))}</p>${how}</div>
          ${qr ? `<div class="qm-qr" data-qm-qr>${qr}</div>` : ''}</div>
          <p><b>Playing</b></p>${seatList()}
          ${waiting ? `<ul class="qm-seats" data-qm-waiting>${waiting}</ul>` : ''}`);
      }
      if (isGuest() && room.state().phase === 'lobby') {
        return wrap('joined', `<h3>Play together</h3><p data-qm-status>${esc(`You are in ${hostName()}'s game. It starts when they press Start.`)}</p>${seatList()}`);
      }
      if (inRoom()) return '';
      if (sheet === 'choose') {
        return wrap('choose', `<h3>Play together</h3><p class="qm-soft">Take turns on this screen, play with somebody on their own screen, or join a game somebody else started.</p>`);
      }
      if (sheet === 'join') {
        return wrap('join', `<h3>Join a game</h3><p>The code on the other screen:</p>
          <input type="text" data-qm-input inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" aria-label="Game code" value="">
          ${joinError ? `<p class="wg-say" data-qm-error role="alert">${esc(joinError)}</p>` : ''}`);
      }
      return '';
    }
    const sheetHtml = (s) => barHtml(s) + sheetBody(s);

    function act(a, arg = '') {
      switch (a) {
        case 'open': sheet = 'choose'; sheetLit = 0; setNote(''); break;
        case 'close': case 'local': sheet = null; joinError = ''; break;
        case 'host': startRoom({ call: false }); return;
        case 'call': startRoom({ call: true }); return;
        case 'joinform': sheet = 'join'; sheetLit = 0; joinError = ''; break;
        case 'join': {
          const el = ctx.mount?.querySelector?.('[data-qm-input]');
          joinRoom(el ? el.value : '');
          return;
        }
        case 'admit': room?.admitOne(arg, true); break;
        case 'deny': room?.admitOne(arg, false); break;
        case 'admitmode': room?.setAdmit(room.admit() === 'connected' ? 'ask' : 'connected'); break;
        case 'start': clearLobby(); showLobby = false; sheetLit = 0; api?.start(); publish(); break;
        case 'hide': showLobby = false; break;
        case 'lobby': showLobby = true; sheetLit = 0; break;
        case 'stop': stopTogether(isHost() || !inRoom() ? 'stopped' : 'left'); break;
        case 'skip':
          if (isHost() && current?.remote && !current.done) {
            remoteDone({ seat: current.player.seat, serial: current.serial, right: false, points: 0, skipped: true, why: 'skipped' });
          }
          return;
        default: return;
      }
      redraw();
    }
    function onTogetherClick(e) {
      const t = e?.target;
      if (t?.closest?.('[data-qm-input]')) return true;        // typing the code is not Start
      const b = t?.closest?.('[data-qm]');
      if (b) { act(b.dataset.qm, b.dataset.qmArg || ''); return true; }
      // A tap on the sheet itself (not a button) does nothing underneath it.
      return !!t?.closest?.('[data-qm-sheet]');
    }
    function onTogetherMove(m) {
      const btns = sheetButtons();
      const sheetUp = !!ctx.mount?.querySelector?.('[data-qm-sheet]') && btns.length > 0;
      if (!sheetUp) {
        // Waiting on another screen: the switch's "skip" passes their turn on, as the button does.
        if (m === 'skip' && isHost() && current?.remote && !current.done) { act('skip'); return true; }
        return false;
      }
      if (m === 'next') sheetLit = (sheetLit + 1) % btns.length;
      else if (m === 'prev') sheetLit = (sheetLit - 1 + btns.length) % btns.length;
      else if (m === 'select') { const x = btns[sheetLit]; if (x) act(x.act, x.arg || ''); return true; }
      else return true;
      redraw();
      return true;
    }

    // THE LEFT OF THE PANEL (row 2.63): the current game's own `leftEl` when it has one (Name that person's clip,
    // which must not be rebuilt or it would restart under the person watching), else its `left` markup. When the
    // game drawing it changes, the left starts over, so one game's leftovers never show under another's question.
    let leftBy = null;
    let leftHtml = null;
    const view = {
      askHtml: (s) => (kview().askHtml ? kview().askHtml(s, kcfg(current?.source))
        : esc(String(call(s.item, 'ask', s.item, kcfg(srcOf(s.item))) || ''))),
      leftEl(el, s, c, a) {
        const src = current?.source || null;
        if (src !== leftBy) {
          leftBy = src;
          leftHtml = null;
          el.innerHTML = '';
          delete el.dataset.kind;
          try { src?.view?.onLeftReset?.(); } catch { /* none */ }
        }
        const v = kview();
        if (v.leftEl) { try { return !!v.leftEl(el, s, kcfg(src), a); } catch (err) { console.error('quiz mix: left', err); return false; } }
        const q = s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss';
        const html = s.item && q && v.left ? String(v.left(s, kcfg(src)) || '') : '';
        if (html !== leftHtml) { el.innerHTML = html; leftHtml = html; }
        return !!html;
      },
      speechGate: () => { try { return !!kview().speechGate?.(); } catch { return false; } },
      onReplay: (item, a) => { try { kview().onReplay?.(item, a); } catch (err) { console.error('quiz mix: replay', err); } },
      onHide: () => { for (const s of sources.values()) { try { s.view?.onHide?.(); } catch { /* gone */ } } },
      onShow: (a) => { try { kview().onShow?.(a); } catch { /* gone */ } },
      board: (s) => (kview().board ? kview().board(s, kcfg(current?.source)) : []),
      entryHtml: (s) => (kview().entryHtml ? kview().entryHtml(s, kcfg(current?.source)) : ''),
      pairHtml: (s) => (kview().pairHtml ? kview().pairHtml(s, kcfg(current?.source))
        : `<div class="wg-pair" data-pair>${esc(String(s.pair?.answer ?? '').toUpperCase())}</div>`),
      explainHtml: (s) => (kview().explainHtml ? kview().explainHtml(s, kcfg(current?.source)) : esc(s.pair?.explain || '')),
      // The after-answer screen's other parts, each where every game puts it (quiz_view.js afterAnswerHtml, row 2.66):
      // the other answers' meanings and the source from the game the question came from; the turn's points here.
      moreHtml: (s) => (kview().moreHtml ? kview().moreHtml(s, kcfg(current?.source)) : ''),
      sourceHtml: (s) => (kview().sourceHtml ? kview().sourceHtml(s, kcfg(current?.source)) : ''),
      pointsHtml: () => pointsHtml().trim(),
      onKey: (k, a) => kview().onKey?.(k, a),
      onDeal: (item, a) => {
        // Every other game hears that its turn is over (a clip still playing from one stops).
        for (const s of sources.values()) {
          if (s === current?.source) continue;
          try { s.view?.onAway?.(); } catch { /* gone */ }
        }
        try { kview().onDeal?.(item, a); } catch (err) { console.error('quiz mix: deal view', err); }
        startClock();
      },
      turnHtml,
      onResult(r) {
        stopClock();
        if (!current || r.item !== current.item) return;
        // On THIS screen's player's ladder, whoever's game it is: this login's records, written by this login.
        try { current.source.record(r); } catch (err) { console.error('quiz mix: ladder', err); }
        const pts = turnPoints({ ...r, chance: current.chance, scoring: cfgNow.scoring });
        current.points = pts;
        if (current.guest) {
          // A game this screen joined: the host keeps the table. Only the result goes back - never the level.
          if (!current.answered) { current.answered = true; guestAnswer(current.guest, { right: r.right === true, points: pts, cat: current.cat }); }
          return;
        }
        const k = tkey(current.player);
        totals = { ...totals, [k]: (totals[k] || 0) + pts };
        publish();
      },
      allowAward: () => {
        if (cfgNow.pointsFor === 'all') return true;
        // "The first player only" is this SCREEN's first player - in a game together, too.
        return !current || (current.player.localIndex ?? current.player.index) === 0;
      },
      scoreDetail: () => scoreWords(players(), totalsNow()),
      scoreLine: () => (players().length > 1 ? scoreWords(players(), totalsNow()).replace(/, /g, ' · ')
        : `${totalsNow()[tkey(players()[0])] || 0} points so far.`),
      doneHtml: () => (lastTable ? tableHtml(lastTable.players, lastTable.totals) : (roundNow() > 0 ? tableHtml(players()) : '')),
      waitingHtml: () => waitingHtml(),
      sheetHtml: (s) => sheetHtml(s),
      onClick: (e) => onTogetherClick(e),
      onMove: (m) => onTogetherMove(m),
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
        // The join page (play.html?room=CODE): straight into that room.
        if (ctx.autoJoin) { try { joinRoom(ctx.autoJoin); } catch (err) { console.error('quiz mix: join', err); } }
      },
      destroy: () => {
        dead = true;
        stopClock();
        stopRemoteTimer();
        clearLobby();
        if (noteTimer != null) { try { roomClear(noteTimer); } catch { /* gone */ } noteTimer = null; }
        try { room?.destroy(); } catch { /* gone */ }
        try { link?.close(); } catch { /* gone */ }
        room = null; link = null;
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
      sources, history: { ...roundHist }, errors: errors.slice(-5), available: available(),
      // Playing together: the room as this screen sees it, and the together layer.
      room: room ? { phase: room.phase(), role: room.role(), code: room.code(), you: room.you(), seats: room.seats(),
        state: room.state(), waiting: room.waiting() } : null,
      sheet, note, showLobby, guestTurn, totalsNow: { ...totalsNow() },
      act: (a, arg) => act(a, arg), join: (c) => joinRoom(c), open: (o) => startRoom(o), stop: () => stopTogether() });
    return inner;
  },
);
