// spell_aloud.js — READING A SPELLING QUESTION'S ANSWERS LETTER BY LETTER.
//
// Mike, 2026-10-07: "Which spelling is right should have the audio spell out each option instead of
// pronouncing it. Saying the word makes it obvious bc the answer is the one it pronounces right."
// A voice reading "Rythm" and "Rhythm" says the same word for both, or stumbles on the wrong one, so
// hearing them is either useless or a give-away. Spelled, each option is what is on its tile: "R, H, Y,
// T, H, M."
//
// HOW A QUESTION SAYS IT IS ONE: AN EXPLICIT `spell: true` ON THE ITEM (packs.js checks it is true or
// false). Argued:
//   FOR guessing from the words ("Which spelling is right", the "Words & spelling" category): nothing to
//   write on new items. AGAINST, and it decides it: the words miss real cases ("How do you spell the
//   number 2?" — Too / Two / To / Tow, which all sound alike) and catch wrong ones ("how does Samantha
//   cast her spells?"); a category holds opposites and rhymes too, which must be said, not spelled. A
//   field is what the pack writer meant, checked by the pack loader, and costs one line per item.
//   A hand-typed bank row (`question | answer | wrong...`) has no field and is read as words. [Guess:
//   a bank-row marker is a later piece if anybody writes spelling questions by hand.]
//
// WHAT IS SPELLED: each option, while the question is open — the read of the question and its answers,
// and the answer the scan lands on. Once the answer is shown it may be said as a word ("Correct.
// Rhythm."): nothing is left to give away. A hint or anything on screen is untouched: this is only the
// words the voice says.
//
// *** THE PACE, ARGUED — A ROW, BECAUSE IT IS NOT OBVIOUS. *** The speech path takes text (output.js
// `say`), and the only pause every voice honours is punctuation [training knowledge, to be heard on the
// bench: the browser's voice and the helper's both pause at a comma, longer at a full stop].
//   'steady' (the default): commas between letters, "R, H, Y, T, H, M" — the way a person spells aloud,
//     and the cadence the Spelling game already uses ("cat is spelled C, A, T"), so one rhythm across games.
//   'slow': a full stop after each letter, "R. H. Y. T. H. M." — about twice the gap, for a listener who
//     needs time to hold each letter.
//   Why not 'slow' by default: four options of up to thirteen letters ("Conscientious") is fifty letters
//   before the first press; at the slow pace that read runs close to a minute, and the voice's own speed
//   (the person's voice settings) already slows everything for a listener who needs it. [Guess.]
// BETWEEN OPTIONS: "or" before every option after the first ("R, H, Y, T, H, M. Or R, Y, T, H, M."). At
// the slow pace every gap is a full stop, so without a word between them nobody could hear where one
// option ends; at the steady pace it costs one short word and reads the way a person asks.
//
// Letters are said as capitals (a voice reads a lone capital as the letter's name [training knowledge; the
// one to listen for on the bench is "A", which some voices may read as the word "a"]). A space, a hyphen and
// an apostrophe are said as words, because "a lot" and "alot" differ only there; anything else that is not
// a letter or a digit is left out.

export const SPELL_PACE_KEY = 'spellPace';
export const SPELL_PACES = Object.freeze(['steady', 'slow']);
export const SPELL_PACE_DEFAULT = 'steady';

const SAID = Object.freeze({ ' ': 'space', '-': 'hyphen', '‐': 'hyphen', "'": 'apostrophe', '’': 'apostrophe' });

/** The settings row a game that reads spelling questions aloud declares. */
export function spellPaceField({ level = 'advanced', appliesWhen = null } = {}) {
  return {
    key: SPELL_PACE_KEY, label: 'Spelling questions: how fast the letters are said', kind: 'choice',
    default: SPELL_PACE_DEFAULT, level,
    options: [
      { value: 'steady', label: 'Steady (R, H, Y, T, H, M)' },
      { value: 'slow', label: 'Slow (a pause after every letter)' },
    ],
    note: 'On a question that asks which spelling is right, each answer is read letter by letter instead of '
      + 'said as a word, since saying it would give the answer away.',
    ...(appliesWhen ? { appliesWhen } : {}),
  };
}

/** What the saved settings mean: 'steady' unless 'slow' was chosen. */
export function spellPace(saved = {}) {
  const v = (saved || {})[SPELL_PACE_KEY];
  return SPELL_PACES.includes(v) ? v : SPELL_PACE_DEFAULT;
}

/** Is this item (a pack item, a bank row or a dealt question) one whose answers are spelled aloud? */
export function spellsAloud(item) {
  return !!item && item.spell === true;
}

/** One word as the voice should say it, letter by letter: "R, H, Y, T, H, M" or "R. H. Y. T. H. M". */
export function spellAloud(word, { pace = SPELL_PACE_DEFAULT } = {}) {
  const parts = [];
  for (const ch of String(word == null ? '' : word).trim()) {
    if (SAID[ch]) parts.push(SAID[ch]);
    else if (/[\p{L}\p{N}]/u.test(ch)) parts.push(ch.toUpperCase());
  }
  return parts.join(pace === 'slow' ? '. ' : ', ');
}

/**
 * A question's answers as the voice should read them after the question: spelled, with "Or" before every
 * one after the first. Each is its own sentence (the caller ends each line with a full stop).
 */
export function spelledOptions(options, { pace = SPELL_PACE_DEFAULT } = {}) {
  return (Array.isArray(options) ? options : []).map((o, i) => {
    const s = spellAloud(o, { pace });
    return s && i > 0 ? `Or ${s}` : s;
  }).filter(Boolean);
}
