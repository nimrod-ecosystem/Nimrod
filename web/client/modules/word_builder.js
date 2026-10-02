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

import { registerModule } from '../module.js';
import { ownScoreField } from '../score_source.js';
import { flowSettings, fill, esc, normalize, parseLetters, LETTER_WORDS } from '../quiz_flow.js';
import { quizModule, up } from '../quiz_view.js';
import { createAdaptiveSession, adaptiveSettings, ADAPTIVE_DEFAULTS, LADDER_KEY } from '../adaptive_play.js';
import { PUZZLES, TIER, canMake } from '../word_builder_words.js';

export const GAME = 'word_builder';
/** One game; listed so a spoken route's `{ game }` can be checked against it like the others. */
export const GAMES = Object.freeze([GAME]);
// THE SHORTEST WORD, ARGUED (not a setting): two-letter words are nearly all small joining words
// (at, to, of, an), which are poor finds and would crowd every set with near-free answers. Three is
// also where the hand-written list starts, so a setting below it would have nothing behind it.
export const MIN_WORD = 3;

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
});
const LINE_LABELS = {
  askLetters: 'Question: the letters', askMore: 'Question: after a word is found', hintFirst: 'Hint: the first letter',
  hintMore: 'Hint: more letters', explainWord: 'A word found', explainBonus: 'A bonus word found',
  explainLast: 'The last word found', alreadyLine: 'A word already found', notListedLine: 'A word not on the list',
  shortLine: 'Too short to be a word here', noMoreHintsLine: 'No more hints for this word',
};

export const DEFAULTS = Object.freeze({
  maxLetters: 5,
  wordsPerSet: 5,
  showBlanks: true,
  boardScan: 'rows',
  // Words are different lengths, so there is no "full": a word is checked when Check is pressed (or
  // the whole word is said). Not offered as a setting for that reason.
  checkWhenFull: false,
  ...ADAPTIVE_DEFAULTS,
  ...LINES,
});

// EACH SETTING'S DEFAULT, ARGUED:
//   maxLetters 5   the ruling's "fewer letters": the ladder starts at three and climbs to five. Six
//                  and more is a visual search again, the thing that made the original too hard.
//   wordsPerSet 5  a five-letter set can make fifteen words; asking for all of them is a long sitting
//                  on one set. Five is a few minutes; the rest still count, as bonus words.
//   showBlanks on  the length of each word still to find is the clue a grid gives for free.
const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'How many words are found (for each player, when there are several). A Scoreboard on the same screen can show it instead.' }),
  { key: 'maxLetters', label: 'Letters, at most', kind: 'choice', default: 5, level: 'essential',
    options: [3, 4, 5].map((v) => ({ value: v, label: `${v} letters` })),
    note: 'Everybody starts with three; it adds letters as the words come easily.' },
  { key: 'wordsPerSet', label: 'Words to find in each set of letters', kind: 'choice', default: 5, level: 'standard',
    options: [3, 5, 8].map((v) => ({ value: v, label: String(v) })),
    note: 'Any other word the letters make still counts, as a bonus.' },
  { key: 'showBlanks', label: 'Show the words still to find as blanks', default: true, level: 'standard',
    onLabel: 'Yes, with their length', offLabel: 'No, only the words found' },
  { key: 'boardScan', label: 'Letters with a switch', kind: 'choice', default: 'rows', level: 'standard',
    options: [{ value: 'rows', label: 'A row, then a letter' }, { value: 'keys', label: 'One key at a time' }] },
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
    description: 'A few big letters: find the words they make. Read aloud; answer by voice, one switch '
      + 'or touch. More letters and harder words as the words come easily, for each player.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS },
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
    const store = typeof ctx.makeState === 'function' ? (() => { try { return ctx.makeState(LADDER_KEY); } catch { return null; } })() : null;
    let ladderSeen = false;
    const maxLetters = () =>Math.max(3, Math.floor(Number(cfgNow.maxLetters) || DEFAULTS.maxLetters));
    const session = createAdaptiveSession({
      cfg: () => cfgNow,
      bankFor: () => PUZZLES.filter((p) => p.letters.length <= maxLetters()),
      store,
      rand,
      now: typeof ctx.now === 'function' ? ctx.now : () => Date.now(),
      personId: () => ctx.personId || null,
      onChange: () => { if (!ladderSeen) { ladderSeen = true; ladderArrived(); } api?.render(); },
    });
    // THE SAVED LEVELS ARRIVE A MOMENT AFTER THE FIRST DEAL (the state handle loads asynchronously),
    // so the first letters were picked as if everybody were new. A set nobody has found a word in yet
    // is put back, and the one on screen is dealt again if nothing has been typed into it: otherwise
    // a level-4 player would spend a whole set on three letters after every reload.
    function ladderArrived() {
      for (const [pid, st] of [...sets]) if (!st.found.length && !st.bonusFound.length) sets.delete(pid);
      const s = api?.engine.snapshot();
      if (s && s.phase === 'asking' && !s.entry && !s.misses && current && !current.found.length && !keyHints) api.engine.skip();
    }

    // A word somebody gave up on after using the Hint stop (no miss, so the engine reports nothing):
    // it was hard, and the ladder should hear so.
    function flushPending() {
      const d = session.dealt();
      if (d && current && d.id === current.id && keyHints > 0) session.record({ item: current, right: false, skipped: true });
    }

    function deal() {
      flushPending();
      const p = session.currentPlayer();
      let st = sets.get(p.id);
      let q = st && !st.done ? session.deal(GAME, { again: st.id }) : session.deal(GAME);
      if (!q) { current = null; return []; }
      if (!st || st.done || q.id !== st.id) {
        st = newSet(q, { wordsPerSet: cfgNow.wordsPerSet });
        sets.set(p.id, st);
      }
      keyHints = 0;
      engineHints = 0;
      current = st;
      return [st];
    }

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
      items: () => deal(),
      empty: () => 'There are no letters for this game yet.',
      entry: () => 'letters',
      ask(st, c) {
        const letters = spaced(st.letters);
        const left = toFind(st).length;
        const begun = st.found.length + st.bonusFound.length > 0;
        let line = begun ? fill(c.askMore, { letters, left: plural(left, 'word', 'words') }) : fill(c.askLetters, { letters });
        if (keyHints > 0) line += ` ${fill(c.hintLine, { hint: hintText(st, totalHints(), c) })}`;
        return session.askPrefix() + line;
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
      turnHtml: (s) => session.turnHtml(s, GAME),
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
      },
      allowAward: () => session.allowAward(),
      scoreDetail: (s) => session.scoreDetail() || (s.rightCount ? plural(s.rightCount, 'word', 'words') : ''),
      scoreLine: (s) => session.scoreDetail() || `${plural(s.rightCount, 'word', 'words')} found.`,
      pointNote: (game, item, answer) => `word builder: ${lettersOnly(answer)}`,
      onConfig: (c) => { cfgNow = c; },
      init(a) {
        api = a;
        ensureStyle(ctx.mount?.ownerDocument || (typeof document !== 'undefined' ? document : null));
        // The `back` verb is Undo here: one switch's way to take a letter back.
        try { unsubBack = a.bus.subscribe(`${GAME}/back`, () => a.engine.erase()); } catch { unsubBack = null; }
        // A spoken "play word builder" (a route) with the game already on screen: carry on playing.
        try {
          unsubPlay = a.bus.subscribe(`${GAME}/play`, () => {
            const ph = a.engine.snapshot().phase;
            a.engine.press(ph === 'done' ? 'restart' : (ph === 'celebrate' || ph === 'answer') ? 'continue' : 'repeat');
          });
        } catch { unsubPlay = null; }
      },
      destroy: () => {
        session.destroy();
        try { if (typeof unsubBack === 'function') unsubBack(); } catch { /* gone */ }
        try { if (typeof unsubPlay === 'function') unsubPlay(); } catch { /* gone */ }
        try { store?.destroy?.(); } catch { /* gone */ }
      },
    };

    const inner = quizModule({ type: GAME, title: 'Word builder', scoreLabel: 'Word builder: words found',
      games: { [GAME]: adapter }, defaults: DEFAULTS, view })(ctx);
    inner.__session = session;
    inner.__sets = sets;
    inner.__current = () => current;
    return inner;
  },
);
