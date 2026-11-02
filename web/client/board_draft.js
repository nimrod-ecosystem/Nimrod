// board_draft.js - THE CHANGES TO A BOARD DRAFT, for making a board in the one editor (row 2.184; Mike, 2026-11-02:
// "The make an AAC board setup is not useable. We should switch it to the same editor as everything else.").
// docs/for_chat/proposal_board_in_editor_20261102.md, after its Goldfish gate.
//
// PURE: every function takes a board and returns a new one; nothing here touches the screen or storage. modules/board.js
// keeps the draft (`boardDraft` on the panel's row, as the board maker always did) and makes it the board only on "Use
// this board" - a board somebody is talking with is never half-made.
//
// The rules are the board maker's own (board_editor.js), moved here so the one editor and the old form cannot differ:
//   * A CARD WITH NO WORD IS NOT A CARD: emptying the word empties the slot.
//   * A SMALLER GRID IS REFUSED WHILE THE SLOTS IT WOULD DROP STILL HOLD WORDS; changing the columns moves cards, which
//     is the one reflow allowed (a person deliberately reshaping their own board, seeing it as they do).
//   * A HOLE STAYS A HOLE: removing a word leaves its slot empty, so no other card moves (aac_vocab.js).

import { normalizeBoard, gridOf, firstFree } from './aac_vocab.js';

export const MAX_DIM = 12;               // aac_vocab.js's bound on a stored board (board_editor.js MAX_DIM)
// How many steps Undo remembers. 50, argued: more than a person makes in one sitting on one board, and a draft of a 12 × 12
// board is small enough that fifty copies cost nothing. Not a setting: nobody chooses it in advance.
export const DRAFT_UNDO_MAX = 50;

const clampDim = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= MAX_DIM ? n : fallback;
};
let seq = 0;
const newId = () => `c-${Date.now().toString(36)}-${(++seq).toString(36)}`;
const lastFilled = (b) => { for (let i = b.cells.length - 1; i >= 0; i--) if (b.cells[i]) return i; return -1; };

/** A deep copy of a board as a draft to work on (its own id kept, so "Use this board" replaces what it came from). */
export function draftOf(board) {
  return normalizeBoard(JSON.parse(JSON.stringify(board || {})));
}

/** Change one card. A patch that leaves it with no word empties the slot. */
export function setCell(board, i, patch) {
  const b = normalizeBoard(board);
  const cells = b.cells.slice();
  while (cells.length <= i) cells.push(null);
  const was = cells[i] || { id: newId(), word: '' };
  const next = { ...was, ...(patch || {}) };
  const word = String(next.word ?? '').trim();
  cells[i] = word ? { ...next, word } : null;
  return normalizeBoard({ ...b, cells });
}

/** Change the grid. Returns { board, note }: `note` says why when it is refused (the board is then unchanged). */
export function setGrid(board, cols, rows) {
  const b = normalizeBoard(board);
  const g = gridOf(b);
  const c = clampDim(cols, b.cols || g.cols);
  const r = clampDim(rows, b.rows || g.rows);
  const need = lastFilled(b) + 1;
  if (c * r < need) {
    return { board: b, note: `That size holds ${c * r} cards, and ${need} are in use. Empty the last cards first.` };
  }
  return { board: normalizeBoard({ ...b, cols: c, rows: r }), note: '' };
}

export const MOVES = Object.freeze({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] });

/** Move card `i` one slot (`left`, `right`, `up`, `down`), trading places with whatever is there (a card or a hole).
 *  Returns { board, to }; `to` is null when there is no slot that way (the board is then unchanged). */
export function moveCell(board, i, dir) {
  const b = normalizeBoard(board);
  const step = MOVES[dir];
  const g = gridOf(b);
  const cols = b.cols || g.cols;
  const size = (b.cols && b.rows) ? b.cols * b.rows : g.cells;
  if (!step || !b.cells[i]) return { board: b, to: null };
  const col = i % cols, row = Math.floor(i / cols);
  const nc = col + step[0], nr = row + step[1];
  const to = nr * cols + nc;
  if (nc < 0 || nc >= cols || nr < 0 || to >= size) return { board: b, to: null };
  const cells = b.cells.slice();
  while (cells.length <= Math.max(i, to)) cells.push(null);
  [cells[i], cells[to]] = [cells[to], cells[i]];
  return { board: normalizeBoard({ ...b, cells }), to };
}

/** A new card, in slot `at` if it is empty, else the first empty slot. Returns { board, at, note }. */
export function addCell(board, at = -1, word = 'New word') {
  const b = normalizeBoard(board);
  const g = gridOf(b);
  const size = (b.cols && b.rows) ? b.cols * b.rows : g.cells;
  const slot = (Number.isInteger(at) && at >= 0 && at < size && !b.cells[at]) ? at : firstFree(b);
  if (slot < 0 || slot >= size) return { board: b, at: -1, note: 'The board is full. Make it bigger, or empty a card first.' };
  return { board: setCell(b, slot, { id: newId(), word }), at: slot, note: '' };
}

/** Take a card off, leaving its slot empty (no other card moves). */
export function removeCell(board, i) {
  const b = normalizeBoard(board);
  if (i < 0 || i >= b.cells.length || !b.cells[i]) return b;
  const cells = b.cells.slice();
  cells[i] = null;
  return normalizeBoard({ ...b, cells });
}

/** An undo stack: push the board before a change; `back()` gives the one before, or null. */
export function createUndo(max = DRAFT_UNDO_MAX) {
  const stack = [];
  return {
    push(board) { stack.push(JSON.stringify(board)); while (stack.length > max) stack.shift(); },
    back() { const s = stack.pop(); return s ? normalizeBoard(JSON.parse(s)) : null; },
    size: () => stack.length,
    clear() { stack.length = 0; },
  };
}
