// answer_mark.js — a right or a wrong answer said by SHAPE and by WORD, not by colour alone.
//
// MIKE_LIST_20260930, the colour-blindness check of the themes: under simulated deuteranopia the
// right (--ok-surface) and wrong (--bad-surface) washes cannot be told apart in any theme, and
// lessons marked a wrong answer with the wash and nothing else. Trivia had a ✓ drawn by CSS on the
// right answer only (in a hardcoded green no theme could reach) and nothing on a wrong pick; Word
// Forge had the washes and a coloured edge.
//
// So every answered option now carries a mark beside its colour: a ✓ or a ✗ that anybody can see,
// hidden from a screen reader, plus a word that only a screen reader hears. The colour stays; it is
// just no longer the only signal. The mark draws in the option's own text colour (currentColor),
// which the theme suite already holds to 4.5:1 on both washes, so it needs no colour of its own.
//
// THE LOOK IS A PLACEHOLDER. Design was asked for the mark's look (NOTES_FOR_DESIGN.md item 30);
// the glyphs and words here are the contract the suites check, and the drawing can change under
// them. The CSS lives in modules.css, beside the three answer rules that use it.
//
// The words are gentle on purpose, the same register as the games' own "Not that one": "not the
// answer" rather than "wrong" or "incorrect".

export const ANSWER_MARKS = Object.freeze({
  right: Object.freeze({ glyph: '✓', word: 'right answer' }),
  wrong: Object.freeze({ glyph: '✗', word: 'not the answer' }),
});

/** The mark for `kind` ('right' | 'wrong') as HTML, to go INSIDE the option after its text. '' otherwise. */
export function answerMarkHtml(kind) {
  const m = Object.prototype.hasOwnProperty.call(ANSWER_MARKS, kind) ? ANSWER_MARKS[kind] : null;
  if (!m) return '';
  return `<span class="ans-mark" data-mark="${kind}" aria-hidden="true">${m.glyph}</span>`
    + `<span class="ans-mark-word">, ${m.word}</span>`;
}
