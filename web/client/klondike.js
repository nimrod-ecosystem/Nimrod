// klondike.js — THE RULES OF KLONDIKE SOLITAIRE, AND NOTHING ELSE. Pure: no DOM, no bus, no clock.
//
// Row 2.37 (docs/for_chat/MIKE_CHANGE_LIST.md, private repo) and Design's room-add-ons spec §10:
// *"Cards: Klondike first, then FreeCell, Go Fish, War. Cards are 110px+ wide on the kiosk. The
// suits use four colours AND their symbols. A move is pick a card → pick where, with the legal
// places listed. One switch can play."* `modules/solitaire.js` is the table; this file is the rules
// it asks. Split so the rules are tested alone (`dev/solitaire_test.html`), and so FreeCell can be a
// second rules file beside this one rather than a branch inside it.
//
// THE GAME IS A SEED, A DRAW COUNT AND A LIST OF MOVES. `deal(seed)` is deterministic (a seeded
// shuffle, `rng` below), and `replay()` rebuilds any position from the moves made since the deal.
// That is what makes undo UNLIMITED and still cheap to keep: the module stores a few kilobytes of
// move strings, not a snapshot per move, and a reload comes back to the same game with every undo
// still available.
//
// WHERE A CARD CAN GO, and the one place this file chooses rather than follows the rules:
//   * `destinations()` lists every legal place for a card EXCEPT moving a King that is already the
//     whole of its column into another empty column. That is legal and changes nothing, and on one
//     switch every listed place is a press somebody walks past. Nothing else is left out.
//   * Each suit has its OWN foundation (spades, hearts, diamonds, clubs, in that order), rather than
//     "any empty foundation takes an ace". A place called "the hearts pile" can be said, listed and
//     scanned; "the second empty pile" cannot.
//   * A face-down card left on top of a column is turned over as part of the move that uncovered it
//     — every digital Klondike does this, and a separate "turn it over" press is a press for nothing.
//   * The stock recycles without limit. A limit is how a game ends in a fail screen, and this one
//     has none (spec: the person is offered Undo or New game, never told they lost).

export const SUITS = Object.freeze([
  Object.freeze({ id: 'S', name: 'spades', symbol: '♠', color: 'black' }),
  Object.freeze({ id: 'H', name: 'hearts', symbol: '♥', color: 'red' }),
  Object.freeze({ id: 'D', name: 'diamonds', symbol: '♦', color: 'red' }),
  Object.freeze({ id: 'C', name: 'clubs', symbol: '♣', color: 'black' }),
]);
const SUIT = Object.fromEntries(SUITS.map((s) => [s.id, s]));
export const suitOf = (id) => SUIT[id] || null;

export const RANK_LABEL = Object.freeze([null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
export const RANK_NAME = Object.freeze([null, 'ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king']);
const RANK_CHAR = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

export const isRed = (c) => SUIT[c.s]?.color === 'red';
/** "7 of hearts", "king of spades" — what is said aloud and what a screen reader reads. */
export const cardName = (c) => (c ? `${RANK_NAME[c.r]} of ${SUIT[c.s].name}` : '');
/** "7♥" — rank AND symbol, never colour alone. */
export const cardShort = (c) => (c ? `${RANK_LABEL[c.r]}${SUIT[c.s].symbol}` : '');

// ---------------------------------------------------------------------------------------
// THE DEAL
// ---------------------------------------------------------------------------------------

/** mulberry32: a small, well-mixed seeded generator. The same seed is the same deal, everywhere. */
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r += 1) d.push({ s: s.id, r, up: false });
  return d;
}

/** The 52 cards in the order `seed` shuffles them (Fisher-Yates). */
export function shuffled(seed) {
  const d = newDeck();
  const rand = rng(seed);
  for (let i = d.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export const drawCount = (d) => (d === 3 || d === 'three' ? 3 : 1);

/**
 * A fresh game. Seven columns of 1..7 cards, the last of each face up; the other 24 are the stock,
 * face down, whose TOP is the END of the array (so a draw is a pop).
 */
export function deal(seed, { draw = 1 } = {}) {
  const deck = shuffled(seed);
  const tableau = [];
  let k = 0;
  for (let col = 0; col < 7; col += 1) {
    const pile = [];
    for (let i = 0; i <= col; i += 1) pile.push({ ...deck[k++], up: i === col });
    tableau.push(pile);
  }
  return {
    seed: Number(seed) >>> 0,
    draw: drawCount(draw),
    tableau,
    foundations: { S: [], H: [], D: [], C: [] },
    stock: deck.slice(k).map((c) => ({ ...c, up: false })),
    waste: [],
    moves: 0,
    recycles: 0,
  };
}

const cloneCards = (a) => a.map((c) => ({ ...c }));
export function clone(g) {
  return {
    ...g,
    tableau: g.tableau.map(cloneCards),
    foundations: { S: cloneCards(g.foundations.S), H: cloneCards(g.foundations.H),
      D: cloneCards(g.foundations.D), C: cloneCards(g.foundations.C) },
    stock: cloneCards(g.stock),
    waste: cloneCards(g.waste),
  };
}

// ---------------------------------------------------------------------------------------
// WHERE THINGS ARE
//   from: { pile: 'waste' } | { pile: 'tableau', col, idx } | { pile: 'foundation', suit }
//   to:   { pile: 'tableau', col } | { pile: 'foundation', suit }
//   move: { kind: 'draw' } | { kind: 'move', from, to }
// ---------------------------------------------------------------------------------------

const top = (a) => (a.length ? a[a.length - 1] : null);

/** The run of cards `from` names (one card, or a face-up run from a column), or [] if none. */
export function cardsAt(g, from) {
  if (!g || !from) return [];
  if (from.pile === 'waste') return g.waste.length ? [top(g.waste)] : [];
  if (from.pile === 'foundation') {
    const f = g.foundations[from.suit];
    return f && f.length ? [top(f)] : [];
  }
  if (from.pile === 'tableau') {
    const p = g.tableau[from.col];
    if (!p || !(from.idx >= 0 && from.idx < p.length)) return [];
    const run = p.slice(from.idx);
    return run.every((c) => c.up) && validRun(run) ? run : [];
  }
  return [];
}

/** Each card one lower than the one above it and the other colour. */
export function validRun(run) {
  for (let i = 1; i < run.length; i += 1) {
    if (run[i].r !== run[i - 1].r - 1 || isRed(run[i]) === isRed(run[i - 1])) return false;
  }
  return true;
}

/** Can this run be put on `to`? The whole of Klondike's placing rules. */
export function canPlace(g, run, to) {
  if (!run.length || !to) return false;
  if (to.pile === 'foundation') {
    const f = g.foundations[to.suit];
    return !!f && run.length === 1 && run[0].s === to.suit && run[0].r === f.length + 1;
  }
  if (to.pile === 'tableau') {
    const p = g.tableau[to.col];
    if (!p) return false;
    const t = top(p);
    if (!t) return run[0].r === 13;
    return t.up && run[0].r === t.r - 1 && isRed(run[0]) !== isRed(t);
  }
  return false;
}

const sameFrom = (a, b) => a.pile === b.pile && (a.pile !== 'tableau' || a.col === b.col);

/** Every legal place for the card(s) at `from`, foundation first, then columns left to right. */
export function destinations(g, from) {
  const run = cardsAt(g, from);
  if (!run.length) return [];
  const out = [];
  if (run.length === 1 && from.pile !== 'foundation') {
    const to = { pile: 'foundation', suit: run[0].s };
    if (canPlace(g, run, to)) out.push(to);
  }
  for (let col = 0; col < 7; col += 1) {
    const to = { pile: 'tableau', col };
    if (from.pile === 'tableau' && from.col === col) continue;
    // A King that is already a whole column, into another empty column: legal, changes nothing.
    if (from.pile === 'tableau' && from.idx === 0 && !g.tableau[col].length) continue;
    if (canPlace(g, run, to)) out.push(to);
  }
  return out;
}

/** Every card that has somewhere to go: the waste's top, foundation tops, then each column. */
export function sources(g) {
  const out = [];
  const consider = (from) => { if (destinations(g, from).length) out.push(from); };
  if (g.waste.length) consider({ pile: 'waste' });
  for (const s of SUITS) if (g.foundations[s.id].length) consider({ pile: 'foundation', suit: s.id });
  g.tableau.forEach((p, col) => {
    p.forEach((c, idx) => { if (c.up) consider({ pile: 'tableau', col, idx }); });
  });
  return out;
}

/** Every card that is face up and could be picked at all (for the "offer every card" setting). */
export function pickable(g) {
  const out = [];
  if (g.waste.length) out.push({ pile: 'waste' });
  for (const s of SUITS) if (g.foundations[s.id].length) out.push({ pile: 'foundation', suit: s.id });
  g.tableau.forEach((p, col) => p.forEach((c, idx) => {
    if (c.up && cardsAt(g, { pile: 'tableau', col, idx }).length) out.push({ pile: 'tableau', col, idx });
  }));
  return out;
}

export const canDraw = (g) => g.stock.length > 0 || g.waste.length > 0;

export function legalMoves(g) {
  const out = [];
  if (canDraw(g)) out.push({ kind: 'draw' });
  for (const from of sources(g)) for (const to of destinations(g, from)) out.push({ kind: 'move', from, to });
  return out;
}

export function isLegal(g, m) {
  if (!g || !m) return false;
  if (m.kind === 'draw') return canDraw(g);
  if (m.kind !== 'move' || !m.from || !m.to) return false;
  if (sameFrom(m.from, m.to)) return false;
  if (m.from.pile === 'foundation' && m.to.pile === 'foundation') return false;
  const run = cardsAt(g, m.from);
  if (m.from.pile === 'foundation' && run.length !== 1) return false;
  return canPlace(g, run, m.to);
}

/** The game after `m`, or null if `m` is not legal here. Never changes `g`. */
export function applyMove(g, m) {
  if (!isLegal(g, m)) return null;
  const n = clone(g);
  n.moves += 1;
  if (m.kind === 'draw') {
    if (n.stock.length) {
      const k = Math.min(n.draw, n.stock.length);
      for (let i = 0; i < k; i += 1) n.waste.push({ ...n.stock.pop(), up: true });
    } else {
      // Turn the waste back over: its first card is the stock's top again.
      n.stock = n.waste.reverse().map((c) => ({ ...c, up: false }));
      n.waste = [];
      n.recycles += 1;
    }
    return n;
  }
  let run;
  const { from, to } = m;
  if (from.pile === 'waste') run = [n.waste.pop()];
  else if (from.pile === 'foundation') run = [n.foundations[from.suit].pop()];
  else {
    run = n.tableau[from.col].splice(from.idx);
    const t = top(n.tableau[from.col]);
    if (t && !t.up) t.up = true;
  }
  if (to.pile === 'foundation') n.foundations[to.suit].push(...run);
  else n.tableau[to.col].push(...run);
  return n;
}

export const homeCount = (g) => SUITS.reduce((n, s) => n + g.foundations[s.id].length, 0);
export const isWon = (g) => homeCount(g) === 52;
/** Nothing face down and nothing left to draw: the rest can be put home without a choice. */
export const allRevealed = (g) => !g.stock.length && !g.waste.length && g.tableau.every((p) => p.every((c) => c.up));

// ---------------------------------------------------------------------------------------
// AUTO-MOVE TO THE FOUNDATIONS
// ---------------------------------------------------------------------------------------

/**
 * A card is SAFE to put home when no card could ever need to go on it in a column: aces and twos
 * always, otherwise when both foundations of the other colour are at least one below it. This is
 * the usual digital-solitaire rule; it never takes a card the player might still want.
 */
export function isSafeHome(g, c) {
  if (c.r <= 2) return true;
  const other = SUITS.filter((s) => s.color !== SUIT[c.s].color);
  return other.every((s) => g.foundations[s.id].length >= c.r - 1);
}

export const AUTO_MODES = ['off', 'safe', 'all'];

/** The next card to put home automatically under `mode`, or null. */
export function nextAutoMove(g, mode) {
  if (mode !== 'safe' && mode !== 'all') return null;
  const every = mode === 'all' || allRevealed(g);
  const tops = [];
  if (g.waste.length) tops.push({ pile: 'waste' });
  g.tableau.forEach((p, col) => { if (p.length) tops.push({ pile: 'tableau', col, idx: p.length - 1 }); });
  for (const from of tops) {
    const c = cardsAt(g, from)[0];
    if (!c) continue;
    const to = { pile: 'foundation', suit: c.s };
    if (canPlace(g, [c], to) && (every || isSafeHome(g, c))) return { kind: 'move', from, to };
  }
  return null;
}

/** Apply auto-moves until there are none. Returns the game and the moves made. */
export function settle(g, mode) {
  const made = [];
  let cur = g;
  for (let guard = 0; guard < 60; guard += 1) {
    const m = nextAutoMove(cur, mode);
    if (!m) break;
    cur = applyMove(cur, m);
    made.push(m);
  }
  return { game: cur, moves: made };
}

/** Every card left, home, in order — for "Put them all home" once nothing is hidden. */
export function finishMoves(g) {
  if (!allRevealed(g)) return [];
  return settle(g, 'all').moves;
}

// ---------------------------------------------------------------------------------------
// STUCK — an OFFER, never a verdict
// ---------------------------------------------------------------------------------------

/**
 * Does this move get anywhere? Putting a card home, playing from the waste, turning a card over,
 * emptying a column, or letting the card underneath go home all do. Shuffling a run between two
 * equal cards, or taking a card back off a foundation, might — `isStuck` looks one move further
 * for those rather than calling them progress outright.
 */
function isProgress(g, m) {
  if (m.kind !== 'move') return false;
  if (m.to.pile === 'foundation') return true;
  if (m.from.pile === 'waste') return true;
  if (m.from.pile === 'foundation') return false;
  const p = g.tableau[m.from.col];
  if (m.from.idx === 0) return g.tableau[m.to.col].length > 0;
  const under = p[m.from.idx - 1];
  if (!under.up) return true;
  return canPlace(g, [under], { pile: 'foundation', suit: under.s });
}

// Every position drawing can reach from here. One full turn of the stock (and one more) shows every
// card the waste will ever offer, because turning the pile over keeps the order.
function stockPositions(g) {
  const out = [g];
  let cur = g;
  const limit = (g.stock.length + g.waste.length + 2) * 2;
  for (let i = 0; i < limit && canDraw(cur); i += 1) {
    cur = applyMove(cur, { kind: 'draw' });
    out.push(cur);
  }
  return out;
}
const progressHere = (pos) => legalMoves(pos).some((m) => m.kind === 'move' && isProgress(pos, m));

/**
 * True when it looks as though nothing helps from here. The module uses this ONLY to offer "Undo"
 * and "New game" beside the cards; the table stays playable and nothing is taken away. It looks
 * one sideways move ahead, so it can be wrong in a long enough chain — which is why the words the
 * module shows say "it looks like", and why it is never allowed to block anything.
 * Cheap in the usual case (some progress is found at once); the sideways look-ahead only runs when
 * nothing direct is left.
 */
export function isStuck(g) {
  if (isWon(g) || allRevealed(g)) return false;
  const positions = stockPositions(g);
  if (positions.some(progressHere)) return false;
  for (const pos of positions) {
    for (const m of legalMoves(pos)) {
      if (m.kind !== 'move') continue;
      const n = applyMove(pos, m);
      if (n && stockPositions(n).some(progressHere)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------
// SAVING A GAME: moves as short strings, and replay
// ---------------------------------------------------------------------------------------

function encodeWhere(w) {
  if (w.pile === 'waste') return 'w';
  if (w.pile === 'foundation') return `f${w.suit}`;
  return w.idx == null ? `t${w.col}` : `t${w.col}.${w.idx}`;
}
function decodeWhere(s) {
  if (s === 'w') return { pile: 'waste' };
  let m = /^f([SHDC])$/.exec(s);
  if (m) return { pile: 'foundation', suit: m[1] };
  m = /^t([0-6])(?:\.(\d{1,2}))?$/.exec(s);
  if (m) return m[2] == null ? { pile: 'tableau', col: Number(m[1]) } : { pile: 'tableau', col: Number(m[1]), idx: Number(m[2]) };
  return null;
}
export function encodeMove(m) {
  if (!m) return '';
  if (m.kind === 'draw') return 'd';
  const to = m.to.pile === 'tableau' ? { pile: 'tableau', col: m.to.col } : m.to;
  return `${encodeWhere(m.from)}>${encodeWhere(to)}`;
}
export function decodeMove(s) {
  if (s === 'd') return { kind: 'draw' };
  const [a, b] = String(s || '').split('>');
  const from = decodeWhere(a);
  const to = decodeWhere(b);
  if (!from || !to || (from.pile === 'tableau' && from.idx == null)) return null;
  return { kind: 'move', from, to };
}
/** A TURN is what one press did: the player's move, plus any cards that then went home by themselves. */
export const encodeTurn = (moves) => moves.map(encodeMove).join(' ');
export const decodeTurn = (s) => String(s || '').split(' ').filter(Boolean).map(decodeMove);

/**
 * Rebuild a game from its seed, draw count and turns. Stops at the first turn that does not apply
 * (a corrupted save keeps everything before it, rather than losing the whole game).
 */
export function replay(seed, draw, turns = []) {
  let g = deal(seed, { draw });
  const snapshots = [g];
  const kept = [];
  for (const t of Array.isArray(turns) ? turns : []) {
    let cur = g;
    let ok = true;
    const moves = decodeTurn(t);
    if (!moves.length) break;
    for (const m of moves) {
      const n = m && applyMove(cur, m);
      if (!n) { ok = false; break; }
      cur = n;
    }
    if (!ok) break;
    g = cur;
    snapshots.push(g);
    kept.push(t);
  }
  return { game: g, snapshots, turns: kept };
}

// ---------------------------------------------------------------------------------------
// A SMALL SOLVER — used by the suite to prove a known deal can be finished on one switch.
// ---------------------------------------------------------------------------------------

const cardKey = (c) => `${c.s}${RANK_CHAR[c.r]}${c.up ? '' : '?'}`;
function stateKey(g) {
  const cols = g.tableau.map((p) => p.map(cardKey).join('')).sort().join('|');
  const f = SUITS.map((s) => g.foundations[s.id].length).join(',');
  return `${cols}#${f}#${g.stock.map(cardKey).join('')}#${g.waste.map(cardKey).join('')}`;
}

function solverMoves(g) {
  const home = [];
  const reveal = [];
  const fromWaste = [];
  const empties = [];
  const helpful = [];
  for (const from of sources(g)) {
    if (from.pile === 'foundation') continue;
    for (const to of destinations(g, from)) {
      const m = { kind: 'move', from, to };
      if (to.pile === 'foundation') { home.push(m); continue; }
      if (from.pile === 'waste') { fromWaste.push(m); continue; }
      const p = g.tableau[from.col];
      if (from.idx === 0) { empties.push(m); continue; }
      const under = p[from.idx - 1];
      if (!under.up) reveal.push({ m, depth: from.idx });
      else if (canPlace(g, [under], { pile: 'foundation', suit: under.s })) helpful.push(m);
    }
  }
  reveal.sort((a, b) => b.depth - a.depth);
  const out = [...home, ...reveal.map((x) => x.m), ...fromWaste, ...helpful, ...empties];
  if (canDraw(g)) out.push({ kind: 'draw' });
  return out;
}

/** A list of moves that wins from `g`, or null if none was found within `maxNodes` positions. */
export function solve(g, { maxNodes = 200000 } = {}) {
  const seen = new Set();
  const path = [];
  let nodes = 0;
  const dfs = (cur) => {
    if (isWon(cur)) return true;
    if (nodes >= maxNodes) return false;
    nodes += 1;
    const k = stateKey(cur);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const m of solverMoves(cur)) {
      const n = applyMove(cur, m);
      if (!n) continue;
      path.push(m);
      if (dfs(n)) return true;
      path.pop();
      if (nodes >= maxNodes) return false;
    }
    return false;
  };
  return dfs(g) ? path.slice() : null;
}
