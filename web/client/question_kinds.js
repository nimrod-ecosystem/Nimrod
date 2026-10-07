// question_kinds.js — WHERE QUIZ MIX'S QUESTIONS COME FROM: one small source per game, over that game's own
// questions (Mike, 2026-10-06: "a mode with all the different types of questions mixed in: Math, trivia, word
// forge, etc.").
//
// *** NOTHING HERE WRITES A QUESTION. *** Each source deals the game's OWN questions, judged, hinted and drawn by the
// game's own code: Brain games and Thinking games through `createBrainPlay` / `createThinkPlay` (lifted out of those
// modules for this), Math through `mathAdapter` / `mathView`, Spelling through its adapter and view, Trivia through
// `triviaPackRows` / `makeQuestion` / its ladder rows, Word Forge through `wordPackRows` / `makeQuestion`. What is
// new is the part a mix needs and a single game did not: deal to A GIVEN PLAYER in A GIVEN CATEGORY, through the
// shared randomizer with difficulty (question_pick.js), and record the answer on that player's own ladder in that
// game, exactly as playing the game itself would.
//
// A SOURCE (one per game):
//   id, label             'brain', 'Brain games'
//   categories()          [{ id, label, board }] what a round can be; `board`: answered on a letter board
//   loading()             true while its questions are still arriving (Trivia's and Word Forge's packs)
//   has(catId)            something to deal in that category right now
//   dealFor(player, catId) -> { item, game, chance } | null   a question at THIS player's level ("chance": their
//                         expected chance of getting it right, for the table's points)
//   record(result)        the answer, onto that player's ladder in that game (quiz_flow.js `onResult`)
//   adapter, view, cfg()  quiz_flow.js's adapter (no `items`: the mix deals), quiz_view.js's view pieces, and the
//                         settings those read (the game's own DEFAULTS, with the mix's choices over them)
//   onConfig(cfg), destroy()
//
// THE HOST each source is handed (modules/quiz_mix.js builds it):
//   ctx         the panel's ctx (bus, makeEvents, makePackReviews, personId, screenPlayers)
//   ladderCtx   the same, with ONE handle per row shared by every source (the screen's `ratings` row is one row,
//               not five), and no panel settings row (a game's "Start this game at" copy is its own panel's)
//   cfg()       the mix's settings;  overrides()  what the mix sets over every game's own (players, voice, shape)
//   rand, now   injected;  getApi()  quiz_view.js's api;  changed()  redraw
//   chooser(pid, game)    the draw (question_pick.js `ladderChooser`) with this player's history in this game
//   noteDeal(pid, game, id), stats(pid, game)   that history (asked when, how often), kept for the panel's life
//   contests    the "I think this question is wrong" log (contests.js), or null: a held question is not dealt

import { FLOW_DEFAULTS, fill, esc, normalize, parseNumber } from './quiz_flow.js';
import {
  createAdaptiveSession, openPersonLadder, openLadderStore, splitLadderStore, LADDER_STATE_OPTIONS, ADAPTIVE_DEFAULTS,
  PERSON_LADDER_KEY, resolvePlayers,
} from './adaptive_play.js';
import { levelOf } from './rating.js';
import { pickQuestion, chanceOf } from './question_pick.js';
import { packById } from './pack_library.js';
import { topicName } from './pack_reviews.js';
import { contestKey } from './contests.js';
import { spelledOptions, spellPace } from './spell_aloud.js';
import * as Brain from './modules/brain_games.js';
import { BANKS as BRAIN_BANKS } from './brain_banks.js';
import { BANKS as THINK_BANKS } from './think_banks.js';
import * as Think from './modules/think_games.js';
import * as Spell from './modules/spelling.js';
import * as Trivia from './modules/trivia.js';
import * as Forge from './modules/wordforge.js';
import { mathAdapter, mathView, mathBank, RATING_GAME as MATH_GAME, GAME as MATH_KEY, DEFAULTS as MATH_DEFAULTS } from './math_beginner.js';

export const SOURCE_IDS = Object.freeze(['trivia', 'math', 'words', 'spelling', 'brain', 'think']);

// ---------------------------------------------------------------------------------------------------
// THE LADDER, for a game kept on the `ratings` row (everything but Trivia)
// ---------------------------------------------------------------------------------------------------
function ladderParts(host, { gameKey, bankFor, defaults }) {
  const cfg = () => ({ ...FLOW_DEFAULTS, ...defaults, ...host.overrides() });
  const rows = openPersonLadder(host.ladderCtx, { gameKey, onChange: () => host.changed() });
  const session = createAdaptiveSession({
    cfg, bankFor, store: rows.store, rand: host.rand, now: host.now,
    personId: () => host.ctx.personId || null,
    startFor: rows.startFor, startMark: rows.startMark, playersHost: rows.playersHost,
    onChange: () => host.changed(),
  });
  rows.attach(session);
  return { cfg, rows, session };
}

/** This player's expected chance at the question just dealt in `game` (for the table's points). */
function dealtChance(session, game, item) {
  try {
    const d = session.dealt();
    if (!d) return null;
    return chanceOf(session.playerRow(d.player.id, game).rating, session.questionRow(item).rating);
  } catch { return null; }
}

/** Deal `game` to `player` through the shared draw, noting it in the player's history. */
function dealLadder(host, session, game, player, dealOne = (opts) => session.deal(game, opts)) {
  const item = dealOne({ player, chooser: host.chooser(player.id, game) });
  if (!item) return null;
  host.noteDeal(player.id, game, item.id);
  return { item, game, chance: dealtChance(session, game, item) };
}

// ---------------------------------------------------------------------------------------------------
// BRAIN GAMES and THINKING GAMES: the four kinds each are the categories
// ---------------------------------------------------------------------------------------------------
export const BRAIN_CATEGORIES = Object.freeze([
  { id: 'odd', label: 'Which one is different' }, { id: 'order', label: 'Remember the order', board: true },
  { id: 'count', label: 'Quick count' }, { id: 'next', label: 'What comes next' },
]);
export function brainSource(host) {
  const { cfg, rows, session } = ladderParts(host, { gameKey: Brain.GAME, defaults: Brain.DEFAULTS,
    bankFor: (g) => BRAIN_BANKS[String(g).replace(/^brain_/, '')] || [] });
  const play = Brain.createBrainPlay({ session, cfg, rand: host.rand, getApi: host.getApi, ctx: host.ctx });
  const kindOf = (cat) => String(cat).replace(/^brain:/, '');
  return {
    id: 'brain', label: 'Brain games', session,
    categories: () => BRAIN_CATEGORIES.map((c) => ({ ...c, id: `brain:${c.id}` })),
    loading: () => false,
    has: (cat) => (BRAIN_BANKS[kindOf(cat)] || []).length > 0,
    dealFor(player, cat) {
      const kind = kindOf(cat);
      return dealLadder(host, session, Brain.ladderGame(kind), player, (opts) => play.dealKind(kind, opts));
    },
    record: (r) => session.record(r),
    adapter: play.adapter, view: play.view, cfg,
    init: (doc) => play.ensureStyle(doc),
    onConfig: (c) => rows.onConfig(c),
    destroy() { play.stopLook(); session.destroy(); rows.destroy(); },
  };
}

export const THINK_CATEGORIES = Object.freeze([
  { id: 'numbers', label: 'Smallest or biggest number' }, { id: 'things', label: 'Smallest or biggest thing' },
  { id: 'groups', label: 'Name the group' }, { id: 'finish', label: 'Finish the sentence' },
]);
export function thinkSource(host) {
  const { cfg, rows, session } = ladderParts(host, { gameKey: Think.GAME, defaults: Think.DEFAULTS,
    bankFor: (g) => THINK_BANKS[g] || [] });
  const play = Think.createThinkPlay({ session, cfg, rand: host.rand });
  const kindOf = (cat) => String(cat).replace(/^think:/, '');
  return {
    id: 'think', label: 'Thinking games', session,
    categories: () => THINK_CATEGORIES.map((c) => ({ ...c, id: `think:${c.id}` })),
    loading: () => false,
    has: (cat) => (THINK_BANKS[kindOf(cat)] || []).length > 0,
    dealFor(player, cat) {
      const kind = kindOf(cat);
      return dealLadder(host, session, kind, player, (opts) => play.dealKind(kind, opts));
    },
    record: (r) => session.record(r),
    adapter: play.adapter, view: play.view, cfg,
    onConfig: (c) => rows.onConfig(c),
    destroy() { session.destroy(); rows.destroy(); },
  };
}

// ---------------------------------------------------------------------------------------------------
// MATH: the beginner ladder Math itself plays (counting, then plus and minus, then times)
// ---------------------------------------------------------------------------------------------------
export function mathSource(host) {
  const { cfg, rows, session } = ladderParts(host, { gameKey: MATH_KEY, defaults: { ...MATH_DEFAULTS, mathLevel: 'adaptive' },
    bankFor: (g) => (g === MATH_GAME ? mathBank() : []) });
  return {
    id: 'math', label: 'Math', session,
    categories: () => [{ id: 'math', label: 'Numbers' }],
    loading: () => false,
    has: () => true,
    dealFor: (player) => dealLadder(host, session, MATH_GAME, player),
    record: (r) => session.record(r),
    adapter: mathAdapter({ items: () => [], prefix: () => '' }), view: mathView, cfg,
    onConfig: (c) => rows.onConfig(c),
    destroy() { session.destroy(); rows.destroy(); },
  };
}

// ---------------------------------------------------------------------------------------------------
// SPELLING: Spelling's own words, on a ladder by length
// ---------------------------------------------------------------------------------------------------
// *** SPELLING ITSELF HAS NO LADDER YET; THE MIX GIVES IT ONE. *** Its words are levelled by length (three letters
// level 1, four 2, five 3, six 4), the one measure of a spelling word's difficulty the words carry. Kept on the
// person's `ratings` row as the game "spelling", where Spelling can read it the day it gets levels of its own.
// [Guess, on Mike's list: the case against is that length is a weak measure ("eye" is harder than "cat").]
export const SPELLING_GAME = 'spelling';
export const spellingLevel = (word) => Math.max(1, Math.min(4, String(word || '').length - 2));
let SPELL_BANK = null;
export function spellingBank() {
  if (!SPELL_BANK) {
    SPELL_BANK = Object.freeze(Spell.WORDS.map((w) => Object.freeze({ ...w, id: `spelling:${w.word}`, level: spellingLevel(w.word) })));
  }
  return SPELL_BANK;
}
export function spellingSource(host) {
  const { cfg, rows, session } = ladderParts(host, { gameKey: Spell.GAME, defaults: { ...Spell.DEFAULTS, showWord: false },
    bankFor: (g) => (g === SPELLING_GAME ? spellingBank() : []) });
  return {
    id: 'spelling', label: 'Spelling', session,
    categories: () => [{ id: 'spelling', label: 'Spelling', board: true }],
    loading: () => false,
    has: () => true,
    dealFor: (player) => dealLadder(host, session, SPELLING_GAME, player),
    record: (r) => session.record(r),
    adapter: Spell.SPELLING_ADAPTER, view: Spell.SPELLING_VIEW, cfg,
    onConfig: (c) => rows.onConfig(c),
    destroy() { session.destroy(); rows.destroy(); },
  };
}

// ---------------------------------------------------------------------------------------------------
// MULTIPLE CHOICE: the shape Trivia's and Word Forge's questions are asked in here
// ---------------------------------------------------------------------------------------------------
// An item: { id, kind: 'mcq', prompt, options: [text], answer: text, explain }. Asked with the same miss flow as
// every other kind (say it, tap it, step through it, or yes / no), so a table of mixed rounds plays one way.
// Trivia's own screen (its partial-credit guesses, the review strip, the contest stop) is Trivia's; here a question
// is just a question. [Guess: the review strip is not here, so unreviewed questions never are either.]
export const MCQ_LINES = Object.freeze({
  offerOption: 'Is it {candidate}?',
  hintNotOption: 'it is not {x}',
  notAnOption: '{heard} is not one of the answers.',
});
const asLine = (s) => { const t = String(s == null ? '' : s).trim(); return !t ? '' : (/[.?!…:;"”'’)]$/.test(t) ? t : `${t}.`); };
// quiz_flow.js `normalize` keeps letters only; an answer here can be a number ("12") or carry one ("1969").
const normOpt = (s) => String(s == null ? '' : s).toLowerCase().replace(/[‘’]/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Which option `value` names: the whole thing said, else the longest option said inside it; null if none. */
export function optionIn(it, value) {
  const v = normOpt(value);
  if (!v) return null;
  // A number said in words ("twelve") names the option that is that number.
  const said = parseNumber(String(value));
  if (said != null) {
    const num = (it?.options || []).find((o) => /^\s*-?\d+(\.\d+)?\s*$/.test(String(o)) && Number(o) === said);
    if (num != null) return num;
  }
  const opts = (it?.options || []).map((o) => ({ o, n: normOpt(o) })).filter((x) => x.n);
  const exact = opts.find((x) => x.n === v);
  if (exact) return exact.o;
  const inside = opts.filter((x) => ` ${v} `.includes(` ${x.n} `)).sort((a, b) => b.n.length - a.n.length);
  return inside.length ? inside[0].o : null;
}
export const mcqAdapter = Object.freeze({
  empty: () => 'There are no questions here yet.',
  // The answers are read after the question (Trivia reads them too): without them, a question is open-ended to
  // somebody who cannot read the tiles. In the yes / no shape each is offered on its own instead.
  // A spelling question (`spell`, Trivia's pack items; spell_aloud.js, 2026-10-07) reads its answers letter by
  // letter: said as words, the right one is the one the voice pronounces right. [Only this read: the yes / no
  // offer and the switch walk say a candidate through lines that are also shown on screen; not yet split.]
  ask: (it, c) => (c.answerBy === 'yesno' || c.twoSwitch === 'yesno' ? asLine(it.prompt)
    : [it.prompt, ...(it.spell ? spelledOptions(it.options, { pace: spellPace(c) }) : it.options)].map(asLine).join(' ')),
  candidates: (it) => it.options.slice(),
  offer: (it, cand, c) => fill(c.offerOption || MCQ_LINES.offerOption, { candidate: cand }),
  judge(it, v) { const said = optionIn(it, v); return said == null ? null : said === it.answer; },
  // A wrong answer taken away each time, always leaving one wrong one beside the right answer.
  hint(it, n, c) {
    const wrong = it.options.filter((o) => o !== it.answer);
    if (n < 1 || n > wrong.length - 1) return '';
    return fill(c.hintNotOption || MCQ_LINES.hintNotOption, { x: wrong[n - 1] });
  },
  answer: (it) => it.answer,
  explain: (it) => it.explain || asLine(it.answer),
  vocab: (it) => it.options.slice(),
  heardText: (v) => String(v),
  fromVoice: (it, { text }) => (text ? { value: text } : null),
  choiceLabel: (it, v) => String(v),
  unknownLine: (v, c) => fill(c.notAnOption || MCQ_LINES.notAnOption, { heard: v }),
});
export const mcqView = Object.freeze({
  askHtml: (s) => esc(s.item.prompt),
  left: (s) => `<div class="qz-picks qm-opts" data-choices>${s.item.options.map((o) =>
    `<button type="button" class="qz-pick qm-opt" data-pick="${esc(o)}" data-small>${esc(o)}</button>`).join('')}</div>`,
  pairHtml: (s) => `<div class="wg-pair qm-pair" data-pair>${esc(s.pair.answer)}</div>`,
});

// ---------------------------------------------------------------------------------------------------
// TRIVIA: every question pack, a topic a category, on Trivia's own ladder (`ratings_trivia`)
// ---------------------------------------------------------------------------------------------------
/** A topic's name for a pack id: a review pack's name, else the built-in pack's label, without its state tail. */
export function topicOf(poolId, reviews = null) {
  const r = reviews?.packById?.(poolId);
  if (r) return topicName(r.name || poolId);
  const p = packById(poolId);
  return topicName(p?.label || String(poolId || 'Trivia'));
}
const catKey = (label) => `trivia:${normalize(label).replace(/\s+/g, '-') || 'questions'}`;

export function triviaSource(host) {
  const ctx = host.ctx;
  let rows = [];                // Trivia's rows (triviaPackRows), each with `pool`
  let ladderBank = [];          // what the ladder rates: { id, level }
  const byId = new Map();       // id -> row
  let cats = [];                // [{ id, label }]
  const inCat = new Map();      // category id -> [row]
  let loading = true;
  let dead = false;
  let reviews = null;
  try { reviews = typeof ctx.makePackReviews === 'function' ? ctx.makePackReviews() : null; } catch { reviews = null; }

  // The ladder, exactly where Trivia keeps it: the screen's `ratings_trivia`, each picked person's own row with
  // them, and their usual start read from their `ratings` row (Trivia's `triviaStartLevel`).
  const L = host.ladderCtx;
  const people = () => {
    const ids = new Set(ctx.personId ? [`person:${ctx.personId}`] : []);
    let ps = [];
    try { ps = resolvePlayers(host.cfg().players, { personId: ctx.personId || null, host: ctx.screenPlayers || null }); } catch { ps = []; }
    for (const p of ps) if (String(p.id).startsWith('person:')) ids.add(p.id);
    return [...ids];
  };
  const idOf = (pid) => (typeof pid === 'string' && pid.startsWith('person:') ? pid.slice(7) : null);
  const handle = (pid, key) => {
    const id = idOf(pid);
    if (!id || typeof L.makePersonState !== 'function') return null;
    try { return L.makePersonState(id, key, { ...LADDER_STATE_OPTIONS }) || null; } catch { return null; }
  };
  const docOf = (pid, key) => { try { return handle(pid, key)?.get?.() || null; } catch { return null; } };
  const shared = openLadderStore(L, Trivia.TRIVIA_LADDER_KEY);
  const store = typeof L.makePersonState === 'function'
    ? splitLadderStore({ shared, ownIds: people, ownFor: (pid) => (people().includes(pid) ? handle(pid, Trivia.TRIVIA_LADDER_KEY) : null) })
    : shared;
  const session = createAdaptiveSession({
    cfg: () => ({ ...ADAPTIVE_DEFAULTS, ...host.overrides(), review: 'off', aiWrite: 'off' }),
    bankFor: () => ladderBank, store, rand: host.rand, now: host.now,
    rating: Trivia.TRIVIA_RATING, rowVersion: Trivia.TRIVIA_LEVELS_VERSION, upgradeRow: Trivia.upgradeTriviaRow,
    personId: () => ctx.personId || null,
    startFor: (pid) => (idOf(pid) ? Trivia.triviaStartLevel(docOf(pid, Trivia.TRIVIA_LADDER_KEY), docOf(pid, PERSON_LADDER_KEY)) : null),
    startMark: (pid) => (idOf(pid) ? Trivia.triviaStartMark(docOf(pid, Trivia.TRIVIA_LADDER_KEY), docOf(pid, PERSON_LADDER_KEY)) : null),
    playersHost: ctx.screenPlayers || null,
    onChange: () => host.changed(),
  });
  // Their usual-start rows load beside the ladder (the ladder's own rows load through the store).
  const readUsual = () => { for (const pid of people()) { const h = handle(pid, PERSON_LADDER_KEY); try { h?.load?.()?.then?.(() => host.changed()); } catch { /* next time */ } } };
  readUsual();

  function load() {
    loading = true;
    const from = host.cfg().triviaFrom || 'all';
    return Trivia.triviaPackRows({ reviews, includeUnreviewed: false }).then((all) => {
      if (dead) return;
      const keep = from === 'all' ? all : all.filter((r) => r.pool === from);
      rows = keep.map((r) => ({ ...r, __id: Trivia.triviaId(r) }));
      byId.clear();
      inCat.clear();
      for (const r of rows) {
        byId.set(r.__id, r);
        const label = topicOf(r.pool, reviews);
        const id = catKey(label);
        if (!inCat.has(id)) inCat.set(id, { label, rows: [] });
        inCat.get(id).rows.push(r);
      }
      cats = [...inCat.entries()].map(([id, v]) => ({ id, label: v.label }));
      ladderBank = rows.map((r) => ({ id: r.__id, level: Trivia.itemLevel(r) || Trivia.UNLEVELLED }));
    }).catch((err) => { console.error('quiz mix: trivia questions', err); })
      .finally(() => { if (!dead) { loading = false; host.changed(); } });
  }
  let loaded = load();
  let lastFrom = host.cfg().triviaFrom || 'all';

  const held = (r) => {
    try { const h = host.contests?.held?.(); return !!(h && h.size && h.has(contestKey(r.question, r.answer))); } catch { return false; }
  };
  const playable = (cat) => (inCat.get(cat)?.rows || []).filter((r) => !held(r));

  return {
    id: 'trivia', label: 'Trivia', session,
    ready: () => loaded,
    categories: () => cats.slice(),
    loading: () => loading,
    has: (cat) => playable(cat).length > 0,
    dealFor(player, cat) {
      const list = playable(cat);
      if (!list.length) return null;
      const pid = player.id;
      const win = session.windowFor(pid, Trivia.GAME);
      const prow = session.playerRow(pid, Trivia.GAME);
      const cands = list.map((r) => {
        const q = session.questionRow({ id: r.__id, level: Trivia.itemLevel(r) || Trivia.UNLEVELLED });
        return { id: r.__id, row: r, rating: q.rating, level: Math.min(levelOf(q.rating, Trivia.TRIVIA_RATING), win.maxLevel) };
      });
      // The player's levels first (the ladder's window), as Trivia deals; nothing there, the whole topic.
      const inWin = cands.filter((c) => c.level >= win.lo && c.level <= win.hi);
      const pick = pickQuestion(inWin.length ? inWin : cands, {
        expectedOf: (c) => chanceOf(prow.rating, c.rating),
        stats: host.stats(pid, Trivia.GAME), recent: host.recent(pid, Trivia.GAME), now: host.now(), rand: host.rand,
      });
      if (!pick) return null;
      session.deal(Trivia.GAME, { again: pick.id, player });
      host.noteDeal(pid, Trivia.GAME, pick.id);
      const pool = rows.filter((r) => r.pool === pick.row.pool);
      const q = Trivia.makeQuestion(pick.row, pool.length >= 4 ? pool : rows, { choices: 4, rand: host.rand });
      const item = Object.freeze({ id: pick.id, kind: 'mcq', prompt: q.question, options: q.options, answer: q.answer,
        explain: q.explain || '', source: 'trivia', ...(q.spell ? { spell: true } : {}) });
      return { item, game: Trivia.GAME, chance: chanceOf(prow.rating, pick.rating) };
    },
    record: (r) => session.record({ ...r, item: { id: r.item?.id } }),
    adapter: mcqAdapter, view: mcqView,
    cfg: () => ({ ...FLOW_DEFAULTS, ...MCQ_LINES, ...host.overrides() }),
    onConfig(c) {
      readUsual();
      try { store.load?.(); } catch { /* next time */ }
      const from = c?.triviaFrom || 'all';
      if (from !== lastFrom) { lastFrom = from; loaded = load(); }
    },
    destroy() {
      dead = true;
      session.destroy();
      try { store.destroy?.(); } catch { /* gone */ }
      try { reviews?.destroy?.(); } catch { /* gone */ }
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// WORD FORGE: what words mean, from every words pack, on a ladder by the word's grade
// ---------------------------------------------------------------------------------------------------
// *** WORD FORGE ITSELF HAS NO LADDER YET; THE MIX GIVES IT ONE, as for Spelling. *** A word's level is its grade
// (packs.js difficulty: very easy 4, easy 6, medium 8, hard 10 -> levels 1..4). Asked as Word Forge asks it: what a
// word means, or which word fills the gap in its sentence, with the other words' meanings as the wrong answers.
// Kept as the game "wordforge" on the person's `ratings` row. [Guess, on Mike's list.]
export const WORDS_GAME = 'wordforge';
export const gradeLevel = (grade) => { const g = Number(grade) || 8; return g <= 4 ? 1 : g <= 6 ? 2 : g <= 8 ? 3 : 4; };

// *** WHAT EVERY ANSWER MEANT, AFTER A WORD FORGE QUESTION (row 2.59). *** Word Forge shows each option's meaning on
// its button once the question is over; here the buttons are gone by then (the celebration or the shown answer takes
// their place), so the same meanings are listed under the explanation, one line per answer, and the other answers'
// meanings are read after the explanation, since this game reads its answers aloud. An item carries them as
// `meanings`, parallel to `options` ({ word, meaning } each, Word Forge's `optionMeanings`), and `others`, the
// sentence that is said.
//
// SPEAKING PACE, for how long the answer stays up while that is read: 145 words a minute and 450 ms to finish, the
// numbers steps.js `holdMs` uses for the tour's narration ("deliberately slow: the audience includes people who need
// it slower"). Not a setting, argued: the person's own knobs are already there (how long the celebration and the
// shown answer stay, and a press moves on at once); this only stops the next question cutting a sentence off half way.
// The case against: a fast listener waits a few seconds more on a word question unless they press.
export const SPEAK_WPM = 145;
export const SPEAK_PAD_MS = 450;
export function speakingMs(text) {
  const n = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return n ? Math.round((n / SPEAK_WPM) * 60000 + SPEAK_PAD_MS) : 0;
}
export const wordsAdapter = Object.freeze({
  ...mcqAdapter,
  explain: (it) => [mcqAdapter.explain(it), it.others || ''].filter(Boolean).join(' '),
  holdMs: (it, c) => speakingMs(wordsAdapter.explain(it, null, c)),
});
export const wordsView = Object.freeze({
  ...mcqView,
  explainHtml: (s) => {
    const it = s.item || {};
    const kind = it.wfKind || 'blank';
    const lines = (it.meanings || []).map((m, i) => (m ? `<span class="qm-mean" data-mean="${i}"><b>${esc(it.options[i])}</b>: ${
      esc(Forge.meaningLine(kind, m))}</span>` : '')).join('');
    return `${esc(it.explain || '')}${lines ? `<span class="qm-means" data-means>${lines}</span>` : ''}`;
  },
});
export function wordsSource(host) {
  let words = [];
  let bank = [];
  let loading = true;
  let dead = false;
  const held = (w) => {
    try { const h = host.contests?.held?.(); return !!(h && h.size && h.has(contestKey(w.word, w.meaning))); } catch { return false; }
  };
  // A word somebody said is wrong ("I think this question is wrong", in Word Forge) is held out here too.
  const { cfg: base, rows, session } = ladderParts(host, { gameKey: Forge.GAME, defaults: {},
    bankFor: (g) => (g === WORDS_GAME ? bank.filter((b) => !held(b.word)) : []) });
  const loaded = Forge.wordPackRows().then((list) => {
    if (dead) return;
    words = list;
    bank = list.map((w) => Object.freeze({ id: `wordforge:${String(w.word).toLowerCase()}`, level: gradeLevel(w.grade), word: w }));
  }).catch((err) => { console.error('quiz mix: words', err); }).finally(() => { if (!dead) { loading = false; host.changed(); } });
  // The gap question needs a sentence the word is really in; a pack word with no example is asked what it means.
  const canBlank = (w) => { const s = String(w.sentence || ''); return s.length > String(w.word).length + 2 && new RegExp(String(w.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(s); };
  return {
    id: 'words', label: 'Word Forge', session,
    ready: () => loaded,
    categories: () => [{ id: 'words', label: 'What words mean' }],
    loading: () => loading,
    has: () => bank.some((b) => !held(b.word)),
    dealFor(player) {
      const dealt = dealLadder(host, session, WORDS_GAME, player);
      if (!dealt) return null;
      const w = dealt.item.word;
      const kind = canBlank(w) && host.rand() < 0.5 ? 'blank' : 'define';
      const q = Forge.makeQuestion({ kind, word: w }, words, host.rand);
      const item = Object.freeze({ id: dealt.item.id, level: dealt.item.level, kind: 'mcq', prompt: q.prompt,
        options: q.options, answer: q.options[q.answer], explain: q.explain || '', source: 'wordforge',
        wfKind: q.kind, meanings: Object.freeze((q.optionMeanings || []).map((m) => (m ? Object.freeze({ ...m }) : null))),
        others: Forge.othersSaid(q) });
      return { ...dealt, item };
    },
    record: (r) => session.record({ ...r, item: { id: r.item?.id } }),
    adapter: wordsAdapter, view: wordsView,
    cfg: () => ({ ...base(), ...MCQ_LINES, ...host.overrides() }),
    onConfig: (c) => rows.onConfig(c),
    destroy() { dead = true; session.destroy(); rows.destroy(); },
  };
}

/** Every source, by id. */
export const SOURCES = Object.freeze({
  trivia: triviaSource, math: mathSource, words: wordsSource, spelling: spellingSource, brain: brainSource, think: thinkSource,
});
export const SOURCE_LABELS = Object.freeze({
  trivia: 'Trivia', math: 'Math', words: 'Word Forge', spelling: 'Spelling', brain: 'Brain games', think: 'Thinking games',
});
