// brain_games.js — QUICK BRAIN GAMES (row 2.45): short rounds of four kinds of question.
//
// Mike, 2026-10-01 (notes AQ/AR): a console brain-training game was well liked; build OUR OWN
// "quick mini-games", on the rating ladder, playable by one switch. Our own: the kinds are common
// exercise types, and every question is drawn or written here (`brain_banks.js`).
//
// THE FOUR, AND WHY THESE FOUR (asked to argue the picks). One for each of the skills the request
// names, plus one that nothing else on the site practises:
//   * WHICH ONE IS DIFFERENT (attention, then reasoning): three alike and one not. Starts as shapes
//     (pure looking), ends as a shared property (things that are hot), so the same game climbs from
//     seeing to thinking.
//   * REMEMBER THE ORDER (memory): two to five things shown and said, then hidden; pick them in the
//     same order. The working-memory drill, and the only memory game here.
//   * QUICK COUNT (attention, number sense): how many dots. NO time pressure by default: the dots
//     stay until it is answered. Rows of five past ten, so counting in fives works.
//   * WHAT COMES NEXT (reasoning): 2, 4, 6 ... ? The rule is the hint ("each one is 2 more").
// LEFT OUT, with the reason: "bigger or smaller" (two numbers or amounts) — the thinking games'
// "smallest of three numbers" already practises exactly that comparison, with three to choose from
// rather than two, so a second copy would add a game and no skill. It is one bank away if wanted.
//
// QUICK, NOT TIMED. A ROUND is a few questions (`roundSize`, 5 by default, per player); its score is
// said at the end ("That is the end of the round: 4 of 5 right."). In "a mix", each round is one
// kind and the next round the next kind. NOTHING ENDS A TURN ON A TIMER: the only clock is
// `quickLookMs`, OFF by default, which hides the dots (or the things to remember) after a moment,
// for somebody who wants the pressure. Hiding is one change per question, far below any flash limit,
// and is held to the screen's limit anyway (`flash_limit.js`).
//
// EVERYTHING between the questions is the shared miss flow (`quiz_flow.js`, `quiz_view.js`): one
// switch walks "Is it the square?", touch answers a tile, voice answers anything. Each player at
// their own level, turns, points and the scoreboard, exactly as in the thinking games.

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, fill, esc, normalize, parseNumber, numberWord, shuffle } from '../quiz_flow.js';
import { quizModule } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, LADDER_KEY } from '../adaptive_play.js';
import { BANKS, shapeSvg } from '../brain_banks.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';

export const GAME = 'brain_games';
export const GAMES = Object.freeze(['mix', 'odd', 'order', 'count', 'next']);
export const MIX_ORDER = Object.freeze(['odd', 'order', 'count', 'next']);
/** The ladder's name for one kind: prefixed, because every game on a screen shares one ladder. */
export const ladderGame = (kind) => `brain_${kind}`;

export const LINES = Object.freeze({
  // The gentler words the thinking games use; Mike's own are one edit away.
  wrongLine: 'It sounded like you said {heard}. Not that one.',
  switchWrongLine: 'Not that one.',
  askOdd: 'Which one is different: {list}?',
  askCount: 'How many dots are there?',
  askNext: 'What comes next: {list}?',
  askStudy: 'Remember these, in order: {list}. Say ready, or press Ready, when you have them.',
  askPick: 'Now pick them in the same order.',
  offerOdd: 'Is it the {candidate}?',
  offerNumber: 'Is it {candidate}?',
  hintSame: 'three of them are {same}',
  hintLetter: 'it starts with {letter}',
  hintNot: 'it is not {x}',
  hintFirst: 'the first one was the {x}',
  hintFirstTwo: 'it started with the {x}, then the {y}',
  explainOdd: 'The {odd} is the different one. The others are {same}.',
  explainCount: 'There are {n}.',
  explainNext: '{answer} comes next: {rule}.',
  explainOrder: 'The order was {list}.',
  roundLine: 'That is the end of the round: {right} of {asked} right.',
  notAnOption: '{heard} is not one of them.',
  studyFirstLine: 'Have a good look, then say ready.',
});
const LINE_LABELS = {
  askOdd: 'Question: which is different', askCount: 'Question: how many', askNext: 'Question: what comes next',
  askStudy: 'Question: remember the order', askPick: 'Question: now pick them', offerOdd: 'Offering a thing',
  offerNumber: 'Offering a number', hintSame: 'Hint: what three have in common', hintLetter: 'Hint: the first letter',
  hintNot: 'Hint: a wrong one taken away', hintFirst: 'Hint: the first in the order', hintFirstTwo: 'Hint: the first two',
  explainOdd: 'The answer: the different one', explainCount: 'The answer: how many', explainNext: 'The answer: what comes next',
  explainOrder: 'The answer: the order', roundLine: 'The end of a round', notAnOption: 'Said something that is not one of them',
  studyFirstLine: 'Answered before saying ready',
};

export const DEFAULTS = Object.freeze({
  game: 'mix',
  roundSize: 5,
  quickLookMs: 0,
  boardScan: 'rows',
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

// EACH DEFAULT, ARGUED:
//   game mix        varied, and every kind turns up; one setting picks a single kind.
//   roundSize 5     about a minute at the shared flow's pace (a question, a celebration, "another?"):
//                   the "short" the request asks for. 3 to 10 is offered.
//   quickLookMs 0   no time pressure unless somebody turns it on (the request: off by default).
const SETTINGS = [
  { key: 'game', label: 'Which game', kind: 'choice', default: 'mix', level: 'essential',
    options: [{ value: 'mix', label: 'A mix, one kind each round' }, { value: 'odd', label: 'Which one is different' },
              { value: 'order', label: 'Remember the order' }, { value: 'count', label: 'Quick count' },
              { value: 'next', label: 'What comes next' }] },
  ownScoreField({ level: 'essential', note: 'How many are right (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  { key: 'roundSize', label: 'Questions in a round (for each player)', kind: 'choice', default: 5, level: 'standard',
    options: [3, 5, 8, 10].map((v) => ({ value: v, label: String(v) })) },
  { key: 'quickLookMs', label: 'Hide the dots, or the things to remember, after', kind: 'choice', default: 0, level: 'advanced',
    options: [{ value: 0, label: 'Never: take your time' }, { value: 2000, label: '2 seconds' },
              { value: 4000, label: '4 seconds' }, { value: 8000, label: '8 seconds' }],
    note: 'A little time pressure, for somebody who wants it. Nothing ever ends a turn.' },
  { key: 'boardScan', label: 'Picking with a switch', kind: 'choice', default: 'rows', level: 'standard',
    options: [{ value: 'rows', label: 'A row, then a key' }, { value: 'keys', label: 'One key at a time' }] },
  ...adaptiveSettings({ ai: false, startLevels: 5 }),
  ...flowSettings({ lines: LINES, labels: LINE_LABELS }),
];

// ---------------------------------------------------------------------------------------
// PURE PIECES — exported for the suite
// ---------------------------------------------------------------------------------------
const toks = (s) => normalize(s).split(' ').filter(Boolean);
const sing = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
/** Does `text` say `name` as whole words (plural or not)? */
export function says(text, name) {
  const t = toks(text).map(sing);
  const p = toks(name).map(sing);
  if (!p.length || t.length < p.length) return false;
  for (let i = 0; i + p.length <= t.length; i++) if (p.every((w, j) => t[i + j] === w)) return true;
  return false;
}
const uniq = (xs) => [...new Set(xs)];
const listWords = (xs) => (xs.length < 2 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/** The number choices: the answer and its neighbours (never below 1). */
export function numberOptions(answer) {
  const a = Number(answer);
  return a <= 1 ? [1, 2, 3] : [a - 1, a, a + 1];
}
export const codeOf = (i) => String.fromCharCode(97 + i);
/** The order question's answer as the board's codes ('bca'): position in `picks`. */
export const orderAnswer = (it) => it.seq.map((x) => codeOf(it.picks.indexOf(x))).join('');
export const namesOf = (it, codes) => String(codes || '').split('').map((ch) => it.picks[ch.charCodeAt(0) - 97]).filter(Boolean);

/** The right answer, as the engine compares it. */
export function answerOf(it) {
  if (it.kind === 'odd') return it.odd;
  if (it.kind === 'count') return String(it.n);
  if (it.kind === 'next') return String(it.answer);
  return orderAnswer(it);
}

/** true / false / null (null: cannot say — never a miss). */
export function judgeItem(it, value) {
  if (value == null || value === '') return null;
  if (it.kind === 'odd') {
    const names = uniq(it.tiles).sort((a, b) => b.length - a.length);
    const said = names.find((n) => says(value, n));
    return said == null ? null : said === it.odd;
  }
  if (it.kind === 'count' || it.kind === 'next') {
    const n = typeof value === 'number' ? value : parseNumber(String(value));
    if (n == null) return null;
    return n === Number(answerOf(it));
  }
  if (it.kind === 'order') {
    const v = String(value).toLowerCase().replace(/[^a-z]/g, '');
    if (v.length !== it.seq.length) return null;
    return v === orderAnswer(it);
  }
  return null;
}

/** Spoken names for the order game -> the board's codes, in the order said. */
export function codesFromSpeech(it, text) {
  const out = [];
  const t = toks(text);
  for (let i = 0; i < t.length; i++) {
    const idx = it.picks.findIndex((p) => sing(p) === sing(t[i]));
    if (idx >= 0) out.push(codeOf(idx));
  }
  return out.join('');
}

const READY = new Set(['ready', "i'm ready", 'im ready', 'ok', 'okay', 'go', 'yes', 'done', 'got it']);

// ---------------------------------------------------------------------------------------
// THE LOOK — only the theme's own variables
// ---------------------------------------------------------------------------------------
const STYLE_ID = 'brain-games-style';
const CSS = `
.bb-tiles{display:flex;flex-wrap:wrap;gap:2cqmin;justify-content:center;align-items:stretch}
.bb-tile{display:grid;justify-items:center;align-content:center;gap:.6cqmin}
.bb-tile svg{width:clamp(36px,15cqmin,160px);height:auto;aspect-ratio:1;color:var(--accent)}
.bb-tile span{font-size:clamp(12px,3.4cqmin,40px);font-weight:700}
.bb-seq{display:flex;flex-wrap:wrap;gap:2cqmin;justify-content:center;align-items:center;margin:0;padding:0;list-style:none}
.bb-seq li{display:grid;justify-items:center;gap:.4cqmin;padding:1.2cqmin 2cqmin;border-radius:2cqmin;
  border:max(2px,.5cqmin) solid var(--border);background:var(--surface);color:var(--text);
  font:800 clamp(16px,6cqmin,72px)/1.1 var(--font);min-width:max(48px,12cqmin)}
.bb-seq li svg{width:clamp(32px,12cqmin,130px);height:auto;aspect-ratio:1;color:var(--accent)}
.bb-seq li small{font-size:.45em;color:var(--text-soft)}
.bb-seq li[data-empty]{color:var(--text-soft);border-style:dashed}
.bb-stack{display:grid;gap:2cqmin;justify-items:center}
.bb-hidden{font:800 clamp(28px,16cqmin,180px)/1 var(--font);color:var(--text-soft)}
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
  { type: GAME, title: 'Brain games', core: 'new',
    description: 'Quick rounds: which one is different, remember the order, how many dots, what comes '
      + 'next. Each player at their own level; nothing is timed unless that is turned on.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const rand = ctx.rand || Math.random;
    let cfgNow = { ...DEFAULTS };
    let api = null;
    let dealt = null;            // the question on screen
    let studied = false;         // the order question: has the person said they are ready?
    let hidden = false;          // quick look: the dots / things are hidden
    let lookTimer = null;
    let lastGame = null;
    let roundNo = -1;
    let roundAsked = 0;
    let roundRight = 0;
    const store = typeof ctx.makeState === 'function' ? (() => { try { return ctx.makeState(LADDER_KEY); } catch { return null; } })() : null;
    const session = createAdaptiveSession({
      cfg: () => cfgNow,
      bankFor: (g) => BANKS[String(g).replace(/^brain_/, '')] || [],
      store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      onChange: () => api?.render(),
    });
    const roundTotal = () => Math.max(1, Math.floor(Number(cfgNow.roundSize) || DEFAULTS.roundSize)) * session.players().length;

    function stopLook() {
      if (lookTimer !== null) { try { api?.clearTimer(lookTimer); } catch { /* gone */ } lookTimer = null; }
    }

    function deal(gameId) {
      stopLook();
      if (gameId !== lastGame) { lastGame = gameId; roundNo = -1; roundAsked = roundTotal(); }
      if (roundAsked >= roundTotal()) { roundNo += 1; roundAsked = 0; roundRight = 0; }
      const kind = gameId === 'mix' ? MIX_ORDER[roundNo % MIX_ORDER.length] : gameId;
      const q = session.deal(ladderGame(kind));
      if (!q) { dealt = null; return []; }
      roundAsked += 1;
      studied = false;
      hidden = false;
      dealt = Object.freeze({ ...q });
      return [dealt];
    }

    function markStudied() {
      if (!dealt || dealt.kind !== 'order' || studied) return false;
      studied = true;
      stopLook();
      return true;
    }

    // QUICK LOOK: off by default. Never shorter than the screen's flash limit allows for one change.
    function startLook(item) {
      const ms = Number(cfgNow.quickLookMs) || 0;
      if (!(ms > 0) || !api || (item.kind !== 'count' && item.kind !== 'order')) return;
      let floor = 0;
      try { floor = minFlashPeriodMs(flashLimit(ctx)) || 0; } catch { floor = 0; }
      lookTimer = api.setTimer(() => {
        lookTimer = null;
        if (dealt !== item) return;
        if (item.kind === 'order') { if (markStudied()) api.engine.press('repeat'); return; }
        hidden = true;
        api.render();
      }, Math.max(ms, floor));
    }

    const isRevealing = () => { try { return !!api?.engine.snapshot().revealed; } catch { return false; } };
    const pickedNames = (it, entry) => namesOf(it, entry);

    const adapterFor = (gameId) => ({
      items: () => deal(gameId),
      empty: () => 'There are no questions for this game yet.',
      entry: () => (dealt && dealt.kind === 'order' ? 'letters' : null),
      ask(it, c) {
        const pre = session.askPrefix();
        if (it.kind === 'odd') return pre + fill(c.askOdd, { list: listWords(it.tiles) });
        if (it.kind === 'count') return pre + c.askCount;
        if (it.kind === 'next') return pre + fill(c.askNext, { list: it.seq.join(', ') });
        return pre + (studied ? c.askPick : fill(c.askStudy, { list: it.seq.join(', ') }));
      },
      candidates(it, c, r) {
        if (it.kind === 'odd') return uniq(it.tiles);
        if (it.kind === 'count' || it.kind === 'next') return shuffle(numberOptions(answerOf(it)).map(String), r);
        return [];
      },
      offer(it, cand, c) {
        return it.kind === 'odd' ? fill(c.offerOdd, { candidate: cand }) : fill(c.offerNumber, { candidate: cand });
      },
      judge: (it, v) => judgeItem(it, v),
      hint(it, n, c) {
        if (it.kind === 'odd') {
          if (n === 1) return fill(c.hintSame, { same: it.same });
          if (n === 2) return fill(c.hintLetter, { letter: it.odd.charAt(0).toUpperCase() });
          return '';
        }
        if (it.kind === 'count' || it.kind === 'next') {
          const a = Number(answerOf(it));
          const wrong = numberOptions(a).filter((x) => x !== a);
          if (it.kind === 'next' && n === 1) return it.rule;
          const x = wrong[it.kind === 'next' ? n - 2 : n - 1];
          return x == null ? '' : fill(c.hintNot, { x });
        }
        if (n === 1) return fill(c.hintFirst, { x: it.seq[0] });
        if (n === 2 && it.seq.length > 2) return fill(c.hintFirstTwo, { x: it.seq[0], y: it.seq[1] });
        return '';
      },
      answer: (it) => answerOf(it),
      explain(it, answer, c) {
        let line;
        if (it.kind === 'odd') line = fill(c.explainOdd, { odd: it.odd, same: it.same });
        else if (it.kind === 'count') line = fill(c.explainCount, { n: it.n });
        else if (it.kind === 'next') line = fill(c.explainNext, { answer: it.answer, rule: it.rule });
        else line = fill(c.explainOrder, { list: it.seq.join(', ') });
        // The last question of a round: its score, counting this answer if it was right.
        if (roundAsked >= roundTotal()) {
          const right = roundRight + (judgeItem(it, answer) === true && !isRevealing() ? 1 : 0);
          line += ` ${fill(c.roundLine, { right, asked: roundAsked })}`;
        }
        return line;
      },
      maxEntry: (it) => (it.kind === 'order' ? it.seq.length : 0),
      vocab(it) {
        if (it.kind === 'odd') return uniq(it.tiles);
        if (it.kind === 'count' || it.kind === 'next') {
          const a = Number(answerOf(it));
          const out = [];
          for (let x = Math.max(0, a - 5); x <= a + 5; x++) out.push(numberWord(x));
          return out;
        }
        return studied ? [...it.picks, 'undo', 'back'] : [...READY];
      },
      heardText: (v) => {
        const it = dealt;
        if (it && it.kind === 'order') return namesOf(it, String(v)).join(', ');
        return String(v);
      },
      fromVoice(it, { text, raw }, c) {
        if (it.kind === 'count' || it.kind === 'next') { const n = parseNumber(raw); return n == null ? null : { value: String(n) }; }
        if (it.kind === 'odd') return text ? { value: text } : null;
        if (!studied) return READY.has(text) ? { command: 'ready' } : { note: c.studyFirstLine };
        if (text === 'undo' || text === 'back') return { command: 'erase' };
        const codes = codesFromSpeech(it, text);
        if (!codes) return null;
        return codes.length >= it.seq.length ? { value: codes.slice(0, it.seq.length) } : { append: codes };
      },
      command(cmd) {
        if (cmd === 'ready') return markStudied() ? 'ask' : true;
        return null;
      },
      unknownLine(value, c) {
        if (dealt && dealt.kind === 'odd') return fill(c.notAnOption, { heard: value });
        return c.notCaughtLine;
      },
    });
    const games = Object.fromEntries(GAMES.map((g) => [g, adapterFor(g)]));

    // ---- the view ----
    const label = (name) => `${shapeSvg(name)}<span>${esc(name)}</span>`;
    const tileBtn = (v, inner) => `<button type="button" class="qz-pick bb-tile" data-pick="${esc(v)}">${inner}</button>`;
    const numberTiles = (s) => `<div class="qz-picks" data-choices>${(s.candidates || []).map((v) => `<button type="button" class="qz-pick" data-pick="${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
    const seqItem = (name, i, empty = false) => `<li${empty ? ' data-empty' : ''} data-slot="${i}">${empty ? '' : shapeSvg(name)}${empty ? '?' : esc(name)}<small>${i + 1}</small></li>`;

    const view = {
      askHtml(s) {
        const it = s.item;
        if (it.kind === 'odd') return esc('Which one is different?');
        if (it.kind === 'count') return esc('How many dots?');
        if (it.kind === 'next') return esc('What comes next?');
        return esc(studied ? 'Pick them in the same order' : 'Remember these, in order');
      },
      left(s) {
        const it = s.item;
        if (it.kind === 'odd') {
          return `<div class="bb-tiles" data-tiles>${it.tiles.map((t) => tileBtn(t, it.shapes ? label(t) : esc(t))).join('')}</div>`;
        }
        if (it.kind === 'count') {
          const dots = hidden ? '<p class="bb-hidden" data-hidden>?</p>'
            : `<div class="qz-dots" data-count data-dots>${it.rows.map((n) => `<div class="qz-dotrow">${'<span class="qz-dot"></span>'.repeat(n)}</div>`).join('')}</div>`;
          return `<div class="bb-stack">${dots}${numberTiles(s)}</div>`;
        }
        if (it.kind === 'next') {
          const seq = it.seq.map((x) => `<li>${esc(x)}</li>`).join('');
          return `<div class="bb-stack"><ul class="bb-seq" data-seq>${seq}<li data-empty>?</li></ul>${numberTiles(s)}</div>`;
        }
        if (!studied) return `<ul class="bb-seq" data-study>${it.seq.map((x, i) => seqItem(x, i)).join('')}</ul>`;
        const got = pickedNames(it, s.entry);
        return `<ul class="bb-seq" data-slots>${it.seq.map((_, i) => seqItem(got[i] || '', i, !got[i])).join('')}</ul>`;
      },
      board(s) {
        const it = s.item;
        if (!it || it.kind !== 'order') return [];
        if (!studied) return [[{ view: 'ready', label: 'Ready' }]];
        const used = new Set(String(s.entry || '').split(''));
        const rows = it.picks.map((p, i) => ({ key: codeOf(i), label: p })).filter((k) => !used.has(k.key)).map((k) => [k]);
        return [...rows, [{ cmd: 'erase', label: 'Undo' }]];
      },
      entryHtml: () => '',
      onKey(k, a) {
        if (k.view === 'ready' && markStudied()) a.engine.press('repeat');
      },
      onDeal(item) { startLook(item); },
      pairHtml(s) {
        const it = s.item;
        if (it.kind === 'odd') return `<div class="wg-pair" data-pair>${shapeSvg(it.odd)}<span>${esc(it.odd.toUpperCase())}</span></div>`;
        if (it.kind === 'order') return `<div class="wg-pair" data-pair>${esc(it.seq.join(', ').toUpperCase())}</div>`;
        return `<div class="wg-pair" data-pair>${esc(answerOf(it))}</div>`;
      },
      turnHtml: (s) => session.turnHtml(s, s.item ? ladderGame(s.item.kind) : null),
      onResult(r) {
        if (r.right) roundRight += 1;
        session.record(r);
      },
      allowAward: () => session.allowAward(),
      scoreDetail: (s) => session.scoreDetail() || (roundAsked ? `${roundRight} of ${roundAsked} this round` : ''),
      scoreLine: () => session.scoreDetail() || `${roundRight} of ${roundAsked} right this round.`,
      pointNote: (game, item) => `brain games: ${item.kind}`,
      onConfig: (c) => { cfgNow = c; },
      init(a) { api = a; ensureStyle(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null)); },
      destroy: () => { stopLook(); session.destroy(); try { store?.destroy?.(); } catch { /* gone */ } },
    };

    const inner = quizModule({ type: GAME, title: 'Brain games', scoreLabel: 'Brain games: right answers',
      games, defaults: DEFAULTS, gameKey: 'game', view })(ctx);
    inner.__session = session;
    inner.__state = () => ({ studied, hidden, roundNo, roundAsked, roundRight, dealt });
    return inner;
  },
);
