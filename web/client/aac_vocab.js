// aac_vocab.js — A BOARD IS A VOCABULARY A SCREEN RENDERS, NOT A SCREEN.
//
// The schema half of the AAC work. `modules/board.js` renders what this describes; nothing
// about layout, color or scanning lives here.
//
// ---------------------------------------------------------------------------------------
// *** POSITION IS SACRED, AND THE INDEX IS THE POSITION ***
// ---------------------------------------------------------------------------------------
//
// AAC users build MOTOR PLANS. "Yes" is *there* — reached without looking, the way you find a
// light switch in the dark. Software that silently reflows a layout as vocabulary grows takes
// that away, and it is the most common way well-meaning AAC software fails.
//
// An earlier draft of the rule said *"a symbol must never move"*, and Mike was right to push
// on it: it is too strong, because a person or a clinician deciding to rearrange is completely
// legitimate. `PRINCIPLES.md` §4 lists it among the retired absolutes. The rule that survived
// the hunt, from `aac_design.md`:
//
//   > **A layout never changes under someone without a decision.**
//
// So this file makes that structural rather than a promise:
//
//   * `cells` is an ORDERED array and the index IS the grid position. Adding a word APPENDS.
//   * `addWord` cannot reorder — there is no code path in this file that splices or sorts.
//   * Growing past the current tier does NOT auto-promote. It reports `needsTier` and stops.
//   * `promote` exists, is explicit, and RETURNS THE MOVES so the change has a before and an
//     after somebody can look at. A deliberate rearrangement is a versioned event; a silent
//     one is the bug.
//
// ---------------------------------------------------------------------------------------
// TIERS ARE SIZE CLASSES, NOT A GRID WITH CELLS HIDDEN
// ---------------------------------------------------------------------------------------
//
// An earlier design proposed a full grid from day one with most cells masked. Mike rejected
// it, and the reason is the whole geometry of this population: **target size is the binding
// constraint, not vocabulary count.** Someone with motor imprecision or low vision needs big
// targets, and a big target cannot also be one cell of a dense grid. So a starter board is
// genuinely 2 or 3 huge cells, and growth means MOVING UP A TIER — a milestone, decided by a
// person.
//
// *** AND MOVING UP PRESERVES DIRECTION. *** `promote` places each existing cell at the slot
// whose center points the same way from the middle of the board. If "Yes" was up-and-left in
// the 2-cell board it is up-and-left in the 8-cell one: the half becomes a quadrant, the
// quadrant a sub-quadrant. Absolute size changes; direction does not. Motor memory is
// substantially directional, so this turns a full relearn into a refinement — which is what
// makes the milestone cheap enough that people will actually take it.
//
// ---------------------------------------------------------------------------------------
// *** THE VOCABULARY BELOW IS ONE PERSON'S, AND THAT IS THE POINT RATHER THAN A CAVEAT ***
// ---------------------------------------------------------------------------------------
//
// The `care` set came from a real bedside board, and it has **no eat / drink / hungry /
// thirsty cards.** That is not an oversight — the person it was built for had no use for them,
// and a card somebody can never press is worse than an empty slot.
//
// Which is the general point rather than a caveat: **a vocabulary belongs to one person.** A
// good board omits what does not apply to them, and somebody in a care facility who CAN eat
// needs those cards more than almost anything else here. So this ships as a NAMED EXAMPLE, not
// as the default a new board inherits, and the software's job is to make a vocabulary easy to
// edit rather than to guess well.
//
// **Known gap, stated rather than hidden:** there are no eat / drink / hungry / thirsty symbols
// in `aac_symbols.js`, because the set was drawn for a board that did not need them. Adding
// them is a drawing job, not a coding one, and until it happens those cards would render
// word-only. That is a real limitation of shipping today and it is written down so it is not
// rediscovered by somebody's family.
//
// ---------------------------------------------------------------------------------------
// WHAT A CARD DOES, AND THE ONE THING IT MUST NOT DO
// ---------------------------------------------------------------------------------------
//
// A card SPEAKS, in the room, out of this device's own speaker. That is all.
//
// *** IT DOES NOT SUMMON ANYBODY. *** `PRINCIPLES.md` §2 carries, as a candidate absolute
// awaiting Mike, the boundary statement that Nimrod is not a nurse call system and **a board
// must never be the thing someone uses to summon help.** The `Help` and `Pain` cards say the
// words out loud to whoever is in the room; they do not notify, page, or reach the output bus's
// `remote` channel. Wiring them to it would be a two-line change and would turn a talking aid
// into a piece of safety equipment that nobody has tested, certified, or agreed to answer.
// See the same note in `modules/board.js`, which is where somebody would actually be tempted.

import { SYMBOLS } from './aac_symbols.js';

export const VOCAB_VERSION = 1;

// Color cue classes. Color SUPPORTS meaning; the word carries it. Somebody who cannot
// distinguish these loses nothing.
export const KINDS = ['plain', 'yes', 'no', 'social', 'need', 'hot', 'cold', 'love', 'nav'];

// ---------------------------------------------------------------------------------------
// TIERS
// ---------------------------------------------------------------------------------------
//
// Deliberately few and deliberately not every number: a tier is a milestone somebody moves to,
// and offering fourteen of them turns a decision into a slider.
export const TIERS = [
  { cells: 2,  cols: 2, rows: 1, label: 'Two — the largest targets there are' },
  { cells: 3,  cols: 3, rows: 1, label: 'Three — a yes / no with a way out' },
  { cells: 4,  cols: 2, rows: 2, label: 'Four' },
  { cells: 6,  cols: 3, rows: 2, label: 'Six' },
  { cells: 8,  cols: 4, rows: 2, label: 'Eight' },
  { cells: 12, cols: 4, rows: 3, label: 'Twelve' },
  { cells: 16, cols: 4, rows: 4, label: 'Sixteen — a full care board' },
];

export const tierOf = (cells) => TIERS.find((t) => t.cells === cells) || null;

/** The smallest tier that holds `n` cells, or the largest tier if nothing does. */
export function tierFor(n) {
  return TIERS.find((t) => t.cells >= n) || TIERS[TIERS.length - 1];
}

/** Where cell `i` sits in a tier's grid. The index IS the position — see the header. */
export function cellPosition(i, tier) {
  const t = tierOf(tier) || TIERS[0];
  return { col: i % t.cols, row: Math.floor(i / t.cols) };
}

/** A slot's center in 0..1 of the board, which is what direction is measured from. */
export function slotCenter(i, tier) {
  const t = tierOf(tier) || TIERS[0];
  const { col, row } = cellPosition(i, tier);
  return { x: (col + 0.5) / t.cols, y: (row + 0.5) / t.rows };
}

// ---------------------------------------------------------------------------------------
// BOARDS
// ---------------------------------------------------------------------------------------

/**
 * Fill in what a hand-written or imported board left out, without changing what it said.
 *
 * Never reorders. A board that arrives with its cells in an order is a board somebody may
 * already have learned, and "tidying" it here would be the exact failure this file exists to
 * prevent.
 */
export function normalizeBoard(raw) {
  const b = raw || {};
  // *** A HOLE STAYS A HOLE. *** The first version of this FILTERED empty entries out, which
  // silently closed up every gap `removeWord` had deliberately left — the exact reflow this
  // whole file exists to prevent, committed by the function that is supposed to be the safe
  // one. Caught by the suite's "the next add fills the hole" check, which was watching the
  // symptom rather than the cause. An entry that cannot render becomes `null` and KEEPS ITS
  // SLOT; only trailing nulls go, because a hole at the end is just a shorter board.
  const cells = (Array.isArray(b.cells) ? b.cells : []).map((c, i) => {
    if (!c || (c.word == null && c.say == null)) return null;
    return {
      id: c.id || `c${i}`,
      word: String(c.word == null ? c.say : c.word),
      // What is SPOKEN, when it differs from what is shown. A card can read "Bedpan" and say
      // something a person would rather have said aloud in a corridor.
      say: c.say != null && c.say !== c.word ? String(c.say) : null,
      symbol: c.symbol && SYMBOLS[c.symbol] ? c.symbol : null,
      // *** A PICTURE THE PERSON CHOSE, WHICH `symbol` COULD NEVER BE. ***
      //
      // `symbol` is deliberately restricted to the drawn set -- an unknown name becomes null, so
      // a board cannot reference art that does not exist. That is right for the built-ins and it
      // is exactly why authoring needed a second field: the whole point of a board somebody made
      // is that the picture can be their own kitchen, their own dog, their own daughter.
      //
      // Stored as {sourceId, path}, the same pair `photos` and `wallpaper` already use, so the
      // image resolves through `mediaUrl` on whatever folder is connected and NOTHING IS
      // UPLOADED. There is no upload path in this client and there must not be one; a card holds
      // a reference to a file on the person's own machine, never a copy of it.
      image: (c.image && c.image.path)
        ? { sourceId: String(c.image.sourceId || ''), path: String(c.image.path) }
        : null,
      kind: KINDS.includes(c.kind) ? c.kind : 'plain',
    };
  });
  while (cells.length && cells[cells.length - 1] == null) cells.pop();
  const tier = tierOf(b.tier) ? b.tier : tierFor(cells.length).cells;
  // *** A BOARD SOMEBODY MADE CHOOSES ITS OWN SHAPE. ***
  //
  // `TIERS` is a fixed list of cell counts, each with one grid -- right for the built-ins,
  // which are designed shapes rather than preferences. But authoring means "set rows and
  // columns", and 5x3 is not in that list and should not have to be.
  //
  // So `cols`/`rows` are OPTIONAL and override the tier when present. Absent, every existing
  // board behaves exactly as before, which is what keeps this from being a migration. Bounded
  // at 1..8 because a 12-column board on a bedside screen is a grid of targets nobody can hit,
  // and the whole file exists to keep targets large.
  const dim = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 8 ? n : null;
  };
  const cols = dim(b.cols);
  const rows = dim(b.rows);
  return {
    version: Number(b.version) || VOCAB_VERSION,
    id: b.id || 'board',
    name: b.name || 'Talk',
    tier,
    // Both or neither: half a grid is not a shape, and one of the two would silently pair with
    // whatever the tier said and produce a board nobody asked for.
    ...(cols && rows ? { cols, rows } : {}),
    cells,
  };
}

/**
 * The grid a board should draw in: its own if it states one, otherwise its tier's.
 *
 * One place, because `board.js` needs it to lay out and the editor needs it to know how many
 * cards to offer, and those two disagreeing is a board that loses a card on save.
 */
export function gridOf(board) {
  const b = board || {};
  if (b.cols && b.rows) return { cols: b.cols, rows: b.rows, cells: b.cols * b.rows };
  return tierOf(b.tier) || tierOf(3);
}

/** What the board has to say about itself. Same shape as `checkBank` and for the same reason. */
export function checkBoard(raw) {
  const b = normalizeBoard(raw);
  // `gridOf`, not `tierOf`: a board that states its own cols/rows holds cols*rows, and asking
  // its tier would report a 6x6 board of 36 words as an overfull board of 16. Every board
  // WITHOUT a stated grid still gets its tier, so nothing existing changes.
  const t = gridOf(b);
  const problems = [];
  const seen = new Set();
  b.cells.forEach((c, i) => {
    if (!c) return;                         // a hole is not a problem, it is a decision
    if (seen.has(c.word.toLowerCase())) {
      problems.push({ index: i, word: c.word, severity: 'note',
        why: 'the same word twice — harmless, but probably not meant' });
    }
    seen.add(c.word.toLowerCase());
    if (!c.symbol) {
      problems.push({ index: i, word: c.word, severity: 'note',
        why: 'no symbol, so this card is word-only' });
    }
  });
  if (b.cells.length > t.cells) {
    problems.push({ index: t.cells, word: b.cells[t.cells]?.word || '',
      why: `more words than this size holds (${b.cells.length} in a board of ${t.cells})` });
  }
  const filled = b.cells.filter(Boolean).length;
  return { cells: filled, slots: b.cells.length, holes: b.cells.length - filled,
           tier: b.tier, capacity: t.cells,
           free: Math.max(0, t.cells - b.cells.length), problems };
}

/**
 * Add a word. It goes on the END, always.
 *
 * If the board is full this does NOT quietly move up a tier — it returns the board unchanged
 * with `needsTier` set to what would hold it. Growing the board is a decision somebody makes,
 * with a before and an after; see `promote`.
 */
export function addWord(board, cell) {
  const b = normalizeBoard(board);
  const slot = firstFree(b);
  if (slot < 0) {
    // A board with its OWN grid does not have a next tier to move up to -- it grows by somebody
    // changing its rows and columns, which is a different decision with a different control.
    // Reporting a tier here would send the editor down a path that does not apply.
    return { board: b, added: null,
             needsTier: (b.cols && b.rows) ? null : tierFor(b.cells.length + 1).cells,
             needsGrid: (b.cols && b.rows) ? { cols: b.cols, rows: b.rows } : null };
  }
  const cells = b.cells.slice();
  cells[slot] = cell;                       // a hole first, the end otherwise
  const next = normalizeBoard({ ...b, cells });
  return { board: next, added: next.cells[slot], needsTier: null };
}

/**
 * Remove a word — and this is the one operation that is genuinely awkward, so it says so.
 *
 * Deleting cell 3 of 8 would shift cells 4-8 back by one, which is exactly the silent reflow
 * the whole file forbids. So a removal leaves a HOLE: the cell becomes null and the positions
 * after it do not move. The board renders an empty slot, which is honest, and a later add fills
 * the first hole rather than appending past it.
 */
export function removeWord(board, index) {
  const b = normalizeBoard(board);
  if (index < 0 || index >= b.cells.length) return b;
  const cells = b.cells.slice();
  cells[index] = null;
  // Trailing holes are not holes, they are just a shorter board.
  while (cells.length && cells[cells.length - 1] == null) cells.pop();
  return { ...b, cells };
}

/** The first empty slot an add should fill, or the end. Keeps `addWord`'s promise honest. */
export function firstFree(board) {
  const b = normalizeBoard(board);
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i] == null) return i;
  return b.cells.length < gridOf(b).cells ? b.cells.length : -1;
}

/**
 * Move a board to a different size class, preserving DIRECTION.
 *
 * Each existing cell claims the free slot in the new grid whose center points the same way from
 * the middle of the board. Ties — and there are many, because a 2-cell board says nothing about
 * rows — go to the slot that is FURTHER in the same direction, because the thing being
 * preserved is a reach, not a coordinate. Up-and-left stays up-and-left.
 *
 * Returns `{ board, moves }`. The moves list is not diagnostics: a deliberate rearrangement is
 * a versioned event with a before and an after, and the after is only meaningful if somebody
 * can see what changed.
 */
export function promote(board, toTier) {
  const b = normalizeBoard(board);
  const from = tierOf(b.tier) || TIERS[0];
  const to = tierOf(toTier);
  if (!to) return { board: b, moves: [] };

  const taken = new Set();
  const placed = new Array(to.cells).fill(null);
  const moves = [];

  b.cells.forEach((cell, i) => {
    if (cell == null) return;
    const src = slotCenter(i, from.cells);
    const want = { x: src.x - 0.5, y: src.y - 0.5 };
    let best = -1, bestD = Infinity, bestDot = -Infinity;
    for (let j = 0; j < to.cells; j++) {
      if (taken.has(j)) continue;
      const c = slotCenter(j, to.cells);
      const dx = c.x - src.x, dy = c.y - src.y;
      const dist = Math.hypot(dx, dy);
      // The tie-break IS the design: further in the same direction wins.
      const dot = (c.x - 0.5) * want.x + (c.y - 0.5) * want.y;
      if (dist < bestD - 1e-9 || (Math.abs(dist - bestD) <= 1e-9 && dot > bestDot + 1e-9)) {
        best = j; bestD = dist; bestDot = dot;
      }
    }
    if (best < 0) return;                       // more words than the new size holds
    taken.add(best);
    placed[best] = cell;
    if (best !== i) moves.push({ word: cell.word, from: i, to: best });
  });

  while (placed.length && placed[placed.length - 1] == null) placed.pop();
  return { board: { ...b, tier: to.cells, cells: placed }, moves };
}

// ---------------------------------------------------------------------------------------
// THE SETS THAT SHIP
// ---------------------------------------------------------------------------------------

/**
 * *** YES / NO / SOMETHING ELSE — and the third card is the whole reason this is three. ***
 *
 * A yes/no board with no third option is a FORCED CHOICE. Somebody who was asked the wrong
 * question, or who did not follow it, or who means "neither", has only two wrong answers
 * available — and whichever they pick is then acted on as if they had meant it. The escape is
 * not a nicety; it is the difference between a board that takes an answer and one that takes
 * dictation.
 *
 * It is also why this is the starter tier rather than the 2-cell one, even though 2 gives the
 * biggest targets. Two cells is available (`TIERS[0]`) for somebody who genuinely needs targets
 * that size; it is not the default.
 *
 * **Open, and Mike's to say:** the third card reads "Other", which is what the build map called
 * it. "Something else" may read better on a card somebody is scanning past. One-line change.
 */
export const YESNO = {
  version: VOCAB_VERSION,
  id: 'yesno',
  name: 'Yes or no',
  tier: 3,
  cells: [
    { id: 'yes',   word: 'Yes',   symbol: 'yes',  kind: 'yes' },
    { id: 'no',    word: 'No',    symbol: 'no',   kind: 'no' },
    // No symbol for this one yet — it renders word-only, which the card supports. A drawing is
    // a design job; shipping the escape without it beats shipping a forced choice with one.
    { id: 'other', word: 'Other', symbol: null,   kind: 'plain' },
  ],
};

/**
 * The care set — ONE PERSON'S BOARD, included as an example with its origin attached.
 *
 * Read the header before treating this as a default. It has no eat / drink / hungry / thirsty
 * cards because they did not apply to the person it was built for; for anybody else that is a
 * hole in the middle of their vocabulary rather than a considered omission.
 *
 * Ordered for a 4-across grid, and the order is load-bearing — see the top of the file.
 * "Keyboard" replaced "Suction" here: it SPEAKS "Keyboard" like any other card, a request for
 * somebody to switch this screen to the typing module. There is no auto-navigation, so nobody
 * can be stranded on a screen with no way back. **Suction is a card its owner may urgently
 * need**, so that swap is a real trade: if it should be reachable again, put it back and drop
 * something less critical.
 */
export const CARE = {
  version: VOCAB_VERSION,
  id: 'care',
  name: 'Talk',
  tier: 16,
  cells: [
    // row 1 — answers and social openers
    { id: 'yes',    word: 'Yes',       symbol: 'yes',      kind: 'yes' },
    { id: 'no',     word: 'No',        symbol: 'no',       kind: 'no' },
    { id: 'okay',   word: 'Okay',      symbol: 'okay',     kind: 'social' },
    { id: 'hi',     word: 'Hi',        symbol: 'hi',       kind: 'social' },
    // row 2 — social
    { id: 'thanks', word: 'Thank you', symbol: 'thanks',   kind: 'social' },
    { id: 'love',   word: 'Love you',  symbol: 'love',     kind: 'love' },
    { id: 'stop',   word: 'Stop',      symbol: 'stop',     kind: 'no' },
    { id: 'wait',   word: 'Wait',      symbol: 'wait',     kind: 'social' },
    // row 3 — body and comfort
    { id: 'pain',   word: 'Pain',      symbol: 'pain',     kind: 'need' },
    { id: 'help',   word: 'Help',      symbol: 'help',     kind: 'need' },
    { id: 'hot',    word: 'Hot',       symbol: 'hot',      kind: 'hot' },
    { id: 'cold',   word: 'Cold',      symbol: 'cold',     kind: 'cold' },
    // row 4 — care needs, and the keyboard request
    { id: 'kbd',    word: 'Keyboard',  symbol: 'keyboard', kind: 'nav' },
    { id: 'change', word: 'Change me', symbol: 'change',   kind: 'need' },
    { id: 'bedpan', word: 'Bedpan',    symbol: 'bedpan',   kind: 'need' },
    { id: 'tired',  word: 'Tired',     symbol: 'tired',    kind: 'social' },
  ],
};

// ---------------------------------------------------------------------------------------
// *** THE CORE SET — thirty-six words, and the first board here written for NOBODY. ***
// ---------------------------------------------------------------------------------------
//
// This is the answer to the hole named at the top of this file. `CARE` is one person's board
// and says so; `YESNO` is three cards that are complete for what they are. Neither is a
// STARTER VOCABULARY — something a person who does not yet have a board can be handed on the
// first day and actually build language with. That gap has been open since the module shipped
// and it was, until today, the honest reason the AAC work could not be given to a stranger.
//
// *** WHY IT WAS BLOCKED, AND WHY IT IS NOT ANY MORE. ***
//
// The set of ~36 high-frequency core words is long-established in AAC practice and appears in
// several published starter vocabularies. This was parked for weeks over whether using it
// meant taking somebody else's work. Mike's ruling, 2026-09-06: **individual words cannot be
// copyrighted and a word list is thin ground for a claim.** What IS somebody else's is their
// artwork, their labels and their layout, and none of that is here — the drawings are Nimrod's
// own (`aac_symbols.js`), the labels are written here, and the arrangement below is ours.
//
// So: no third-party assets, no licence question, and nothing invented either. The words are
// the ordinary high-frequency core of English, which is exactly what makes them the right
// thirty-six.
//
// *** WHAT IS STILL UNANSWERED, STATED RATHER THAN HIDDEN. ***
//
//   1. THE ARRANGEMENT IS OURS, WHICH MEANS IT IS UNTESTED. Grouped by function — people and
//      pointing words first, then wanting and doing, then describing, then place, then the
//      questions — so that a motor plan has some logic to hang on. Published core boards use
//      other arrangements for reasons somebody has thought about harder than this.
//   2. THE DRAWINGS ARE FIRST-PASS. See the note in `aac_symbols.js`. Abstract words are hard
//      to draw and confusability across a set this size is real.
//   3. IT IS 6x6 AND CORE BOARDS ARE OFTEN WIDER. Wider means smaller targets, and target size
//      is the binding constraint for the people this project is for (see TIERS above). 6x6 is
//      a judgement, and `cols`/`rows` mean anybody can change it in the editor.
//
// All three are questions for somebody who does the speech-and-language work — the Ace Centre
// call is the place for them, not another round of guessing in a comment. Recorded as such
// rather than shipped as though settled.
//
// *** IT IS NOT THE DEFAULT. *** `yesno` still is. A thirty-six-cell board in front of somebody
// on their first day is the opposite of a starter set, and which board a person begins on is a
// decision for whoever is with them.
export const UNIVERSAL = {
  version: VOCAB_VERSION,
  id: 'core',
  name: 'Core words',
  // 36 is not one of the TIERS, and does not need to be: this board states its own grid, which
  // is the same thing a board somebody builds in the editor does.
  cols: 6,
  rows: 6,
  tier: 16,
  cells: [
    // people and pointing — top-left, because they start the most sentences
    { id: 'i',    word: 'I',     symbol: 'i',    kind: 'plain' },
    { id: 'you',  word: 'You',   symbol: 'you',  kind: 'plain' },
    { id: 'my',   word: 'My',    symbol: 'my',   kind: 'plain' },
    { id: 'it',   word: 'It',    symbol: 'it',   kind: 'plain' },
    { id: 'that', word: 'That',  symbol: 'that', kind: 'plain' },
    // `not` is grammar, not refusal. Colouring it like `no` would make "I do not like it" look
    // like an alarm, and this board has no `no` card for it to be confused with anyway.
    { id: 'not',  word: 'Not',   symbol: 'not',  kind: 'plain' },

    // wanting and doing
    { id: 'want', word: 'Want',  symbol: 'want', kind: 'plain' },
    { id: 'like', word: 'Like',  symbol: 'like', kind: 'plain' },
    { id: 'go',   word: 'Go',    symbol: 'go',   kind: 'plain' },
    { id: 'get',  word: 'Get',   symbol: 'get',  kind: 'plain' },
    { id: 'do',   word: 'Do',    symbol: 'do',   kind: 'plain' },
    { id: 'make', word: 'Make',  symbol: 'make', kind: 'plain' },

    { id: 'put',  word: 'Put',   symbol: 'put',  kind: 'plain' },
    { id: 'turn', word: 'Turn',  symbol: 'turn', kind: 'plain' },
    { id: 'open', word: 'Open',  symbol: 'open', kind: 'plain' },
    { id: 'look', word: 'Look',  symbol: 'look', kind: 'plain' },
    // The one card on this board that says something urgent, and it SAYS IT IN THE ROOM. It
    // does not notify, page or reach the output bus's `remote` channel — see the boundary
    // note at the top of this file and in `modules/board.js`.
    { id: 'help', word: 'Help',  symbol: 'help', kind: 'need' },
    { id: 'stop', word: 'Stop',  symbol: 'stop', kind: 'no' },

    // describing
    { id: 'more', word: 'More',  symbol: 'more', kind: 'plain' },
    { id: 'done', word: 'All done', symbol: 'all_done', kind: 'plain' },
    { id: 'some', word: 'Some',  symbol: 'some', kind: 'plain' },
    { id: 'diff', word: 'Different', symbol: 'different', kind: 'plain' },
    { id: 'good', word: 'Good',  symbol: 'good', kind: 'plain' },
    { id: 'little', word: 'Little', symbol: 'little', kind: 'plain' },

    // direction — `nav`, which is the one place colour is doing real work here: these six are
    // a group somebody learns as a group, and they are the cards most often reached for in a
    // hurry.
    { id: 'up',   word: 'Up',    symbol: 'up',   kind: 'nav' },
    { id: 'down', word: 'Down',  symbol: 'down', kind: 'nav' },
    { id: 'in',   word: 'In',    symbol: 'in',   kind: 'nav' },
    { id: 'out',  word: 'Out',   symbol: 'out',  kind: 'nav' },
    { id: 'on',   word: 'On',    symbol: 'on',   kind: 'nav' },
    { id: 'off',  word: 'Off',   symbol: 'off',  kind: 'nav' },

    // place, and the questions
    { id: 'here', word: 'Here',  symbol: 'here', kind: 'nav' },
    { id: 'there', word: 'There', symbol: 'there', kind: 'nav' },
    { id: 'what', word: 'What',  symbol: 'what', kind: 'social' },
    { id: 'who',  word: 'Who',   symbol: 'who',  kind: 'social' },
    { id: 'where', word: 'Where', symbol: 'where', kind: 'social' },
    { id: 'when', word: 'When',  symbol: 'when', kind: 'social' },
  ],
};

export const BUILTIN_BOARDS = { yesno: YESNO, core: UNIVERSAL, care: CARE };
