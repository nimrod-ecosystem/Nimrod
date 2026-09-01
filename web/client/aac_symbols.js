// aac_symbols.js — the AAC symbol set. Original drawings, and that is the point.
//
// Ported verbatim from the private `aac_symbols.js` (the SVG strings below are byte-identical;
// they were extracted programmatically rather than retyped, because a hand-copied path is a
// symbol that quietly means something slightly different).
//
// ---------------------------------------------------------------------------------------
// WHY WE DRAW OUR OWN INSTEAD OF USING A STANDARD SET
// ---------------------------------------------------------------------------------------
//
// Every established AAC symbol library is licence-encumbered: ARASAAC is CC BY-NC-SA (no
// commercial use), PCS and SymbolStix are proprietary. These are original drawings authored
// in-repo, so they can go wherever this project goes with no strings — which for a free
// accessibility platform is not a nicety, it is the difference between shipping and not.
//
// PROVENANCE (2026-07-05): the sixteen care-board symbols came from a design session,
// direction 1C "Slate". They stay theme-agnostic — `currentColor` for neutral shapes so the
// card tints them, explicit hex only where colour CARRIES meaning rather than decorating it.
// The five game-only symbols (more, all_done, music, mom, dad) are earlier in-repo drawings
// still awaiting a design pass.
//
// WATCH ITEMS carried across from the designer's own note, because they are the kind of thing
// that is never rediscovered once it falls out of a file: `hi` and `thanks` are hand glyphs and
// the softest of the set; `okay` is a check-in-a-circle and wants watching for confusability
// with `yes`, which is a bare check.
//
// ---------------------------------------------------------------------------------------
// DESIGN RULES — keep new symbols consistent with these
// ---------------------------------------------------------------------------------------
//
//   * viewBox 0 0 100 100, stroke-based, ~7px strokes, round caps and joins
//   * `currentColor` for neutral shapes; explicit hex ONLY for meaning-bearing accents —
//     colour supports meaning, it never carries it alone. Somebody who cannot distinguish the
//     hues must lose nothing, which is why every card also carries its word.
//   * big simple silhouettes: it has to read at a glance, from a bed, at one to two metres
//
// A symbol here is a NAME, not a file. `aac_vocab.js` cells reference these by name, so a
// vocabulary is portable text and a renderer is free to draw it differently — which is also
// what makes importing somebody else's board possible later without adopting their artwork.

// The design-set wrapper: fill and cap/join at the svg level, per-path stroke-width. Matches
// the design session's exact output, which is why it is not "tidied".
function d(inner) {
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"'
    + ' aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    + inner + '</svg>';
}
// The legacy wrapper, for the symbols that have not had the design pass yet.
const S = 'stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"';
function svg(inner) {
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + inner + '</svg>';
}

export const SYMBOLS = {
    // ---- care-board set (Claude Design, direction 1C Slate) ----
    yes: d('<path d="M22 53 L42 73 L80 29" stroke="#6abf69" stroke-width="10"/>'),

    no: d('<path d="M30 30 L70 70 M70 30 L30 70" stroke="#D3968C" stroke-width="10"/>'),

    okay: d('<circle cx="50" cy="50" r="30" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M37 51 L46 61 L64 39" stroke="currentColor" stroke-width="7"/>'),

    hi: d('<path d="M36 54 L36 66 Q36 77 47 77 L57 77 Q68 77 68 66 L68 52" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M40 54 L40 36" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M48 54 L48 31" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M56 54 L56 33" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M64 54 L64 40" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M36 57 L27 50" stroke="currentColor" stroke-width="7"/>'),

    thanks: d('<path d="M50 46 C47 40 39 41 39 47 C39 52 46 55 50 60 C54 55 61 52 61 47 C61 41 53 40 50 46 Z" stroke="#cf6f86" stroke-width="5"/>' +
      '<path d="M30 66 Q50 58 70 66" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M31 66 L30 74 M40 62 L39 71 M50 60 L50 70 M60 62 L61 71 M69 66 L70 74" stroke="currentColor" stroke-width="7"/>'),

    love: d('<path d="M50 75 C25 57 19 43 29 33 C37 25 48 29 50 39 C52 29 63 25 71 33 C81 43 75 57 50 75 Z" stroke="#cf6f86" stroke-width="7"/>'),

    stop: d('<polygon points="36,17 64,17 83,36 83,64 64,83 36,83 17,64 17,36" stroke="#D3968C" stroke-width="7"/>' +
      '<path d="M34 50 L66 50" stroke="#D3968C" stroke-width="9"/>'),

    wait: d('<path d="M32 20 L68 20 M32 80 L68 80 M35 21 Q35 34 50 50 Q35 66 35 79 M65 21 Q65 34 50 50 Q65 66 65 79" stroke="currentColor" stroke-width="7"/>'),

    pain: d('<polygon points="50,16 57.6,31.5 74,26 68.5,42.3 84,50 68.5,57.6 74,74 57.6,68.5 50,84 42.3,68.5 26,74 31.5,57.6 16,50 31.5,42.3 26,26 42.3,31.5" stroke="#D3968C" stroke-width="6"/>' +
      '<path d="M50 40 L50 54" stroke="#D3968C" stroke-width="6"/>' +
      '<path d="M50 62 L50 63" stroke="#D3968C" stroke-width="6"/>'),

    help: d('<path d="M50 20 L83 78 L17 78 Z" stroke="#e2b45a" stroke-width="7"/>' +
      '<path d="M50 42 L50 58" stroke="#e2b45a" stroke-width="7"/>' +
      '<path d="M50 66 L50 67" stroke="#e2b45a" stroke-width="7"/>'),

    hot: d('<path d="M50 26 L50 62" stroke="#d98a5f" stroke-width="8"/>' +
      '<circle cx="50" cy="70" r="9" fill="#d98a5f"/>' +
      '<path d="M62 34 Q69 40 62 46" stroke="#d98a5f" stroke-width="5"/>' +
      '<path d="M62 50 Q69 56 62 62" stroke="#d98a5f" stroke-width="5"/>'),

    cold: d('<path d="M50 18 L50 82 M24 32 L76 68 M76 32 L24 68" stroke="#7fc6d8" stroke-width="7"/>' +
      '<path d="M43 22 L50 18 L57 22 M43 78 L50 82 L57 78" stroke="#7fc6d8" stroke-width="5"/>'),

    suction: d('<path d="M40 22 L52 22 M46 22 L46 50 Q46 64 60 69 L69 72" stroke="currentColor" stroke-width="7"/>' +
      '<circle cx="74" cy="76" r="3" fill="currentColor"/>'),

    change: d('<path d="M27 44 A24 24 0 0 1 71 37" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M71 23 L73 39 L57 36" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M73 56 A24 24 0 0 1 29 63" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M29 77 L27 61 L43 64" stroke="currentColor" stroke-width="7"/>'),

    bedpan: d('<ellipse cx="48" cy="50" rx="24" ry="8" stroke="currentColor" stroke-width="6"/>' +
      '<path d="M24 50 Q26 66 48 68 Q68 66 72 54" stroke="currentColor" stroke-width="7"/>' +
      '<path d="M72 50 L84 47" stroke="currentColor" stroke-width="6"/>'),

    tired: d('<path d="M63 24 A28 28 0 1 0 63 76 A21 21 0 1 1 63 24 Z" fill="currentColor"/>' +
      '<path d="M64 32 L74 32 L64 43 L74 43" stroke="currentColor" stroke-width="4" fill="none"/>'),

    // rephrase - "say that a different way", for anybody whose words come out in the
    // wrong order. A speech
    // bubble with a reword/refresh arrow inside. First draft; design-pass later.
    rephrase: d('<path d="M26 28 H74 A9 9 0 0 1 83 37 V57 A9 9 0 0 1 74 66 H44 L30 78 V66 H26 A9 9 0 0 1 17 57 V37 A9 9 0 0 1 26 28 Z" stroke="currentColor" stroke-width="6"/>' +
      '<path d="M60 42 A12 12 0 1 0 62 54" stroke="currentColor" stroke-width="5"/>' +
      '<path d="M61 36 L62 44 L54 43" stroke="currentColor" stroke-width="5"/>'),

    // keyboard (in-repo; a NAV affordance - "I want to type", opens typing)
    keyboard: d('<rect x="14" y="32" width="72" height="40" rx="7" stroke="currentColor" stroke-width="6"/>' +
      '<path d="M26 45 h3 M38 45 h3 M50 45 h3 M62 45 h3 M74 45 h3" stroke="currentColor" stroke-width="6"/>' +
      '<path d="M26 56 h3 M38 56 h3 M50 56 h3 M62 56 h3 M74 56 h3" stroke="currentColor" stroke-width="6"/>' +
      '<path d="M36 66 h28" stroke="currentColor" stroke-width="6"/>'),

    // ---- match-game-only set (in-repo drawings; awaiting a design pass) ----
    // plus in circle
    more: svg('<circle cx="50" cy="50" r="36" stroke="currentColor" ' + S + '/>' +
      '<path d="M50 32 V68 M32 50 H68" stroke="currentColor" ' + S + '/>'),

    // checkered finish flag (deliberately NOT a checkmark - "Yes" owns that,
    // and the match game needs the two to look nothing alike)
    all_done: svg('<path d="M28 12 V88" stroke="currentColor" ' + S + '/>' +
      '<path d="M28 16 H78 V52 H28" stroke="currentColor" ' + S + '/>' +
      '<rect x="28" y="16" width="25" height="18" fill="currentColor" opacity="0.85"/>' +
      '<rect x="53" y="34" width="25" height="18" fill="currentColor" opacity="0.85"/>'),

    // double eighth-note
    music: svg('<path d="M38 72 V26 L70 30 V76" stroke="currentColor" ' + S + '/>' +
      '<path d="M38 26 L70 30" stroke="currentColor" stroke-width="10" stroke-linecap="round" fill="none"/>' +
      '<ellipse cx="31" cy="74" rx="9" ry="7" fill="currentColor"/>' +
      '<ellipse cx="63" cy="78" rx="9" ry="7" fill="currentColor"/>'),

    // person with shoulder-length hair
    mom: svg('<circle cx="50" cy="36" r="15" stroke="currentColor" ' + S + '/>' +
      '<path d="M36 30 Q30 44 33 58 M64 30 Q70 44 67 58" stroke="currentColor" ' + S + '/>' +
      '<path d="M22 84 Q50 58 78 84" stroke="currentColor" ' + S + '/>'),

    // person with short hair
    dad: svg('<circle cx="50" cy="36" r="15" stroke="currentColor" ' + S + '/>' +
      '<path d="M37 28 Q42 18 54 20" stroke="currentColor" ' + S + '/>' +
      '<path d="M22 84 Q50 58 78 84" stroke="currentColor" ' + S + '/>')
};

/** Every symbol name, for a picker and for the vocabulary validator. */
export const SYMBOL_NAMES = Object.keys(SYMBOLS);

/** The markup for a symbol, or '' — a missing symbol renders as a word-only card, never as a
 *  broken box. A card with no picture still says what it says. */
export function symbolSvg(name) {
  return (name && SYMBOLS[name]) || '';
}
