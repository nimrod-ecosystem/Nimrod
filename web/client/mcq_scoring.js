// mcq_scoring.js -- the ONE partial-credit ladder for a multiple-choice question that
// conceals the answer and allows repeated guesses, shared so pricing a guess means the
// same thing everywhere it happens rather than being invented again per module.
//
// Born in trivia.js (Mike: "partial credit -- full point for a first-guess answer, less
// for each subsequent guess, so attempting is still rewarded"), then asked for again as
// Word Forge's own default (Mike, 2026-09-23: "Trivia allows repeated guesses with partial
// credit, Word Forge reveals the answer and ends the round on the first miss - I like
// Trivia's system better for this. Make that the default with the other method as an
// option."). See docs/for_chat/multiple_choice_engine_proposal_20260923.md (private repo)
// for why this extraction stops here rather than merging the two games' rendering or
// scoring wholesale -- the choice-set is common, multi-guess-vs-one-shot and how a guess
// gets scored are each game's own honest design choice.

/**
 * `max` on a clean first guess, one quarter less per guess already spent, floored at a
 * quarter of `max` -- so a four-choice question pays max, 0.75*max, 0.5*max, 0.25*max and
 * never nothing. Attempting always pays something.
 */
export function worth(spent, max = 1) {
  const full = Number(max);
  const top = Number.isFinite(full) ? full : 1;
  const step = top / 4;
  return Math.max(step, top - step * Number(spent || 0));
}
