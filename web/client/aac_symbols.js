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
// Every established AAC symbol library is license-encumbered: ARASAAC is CC BY-NC-SA (no
// commercial use), PCS and SymbolStix are proprietary. These are original drawings authored
// in-repo, so they can go wherever this project goes with no strings — which for a free
// accessibility platform is not a nicety, it is the difference between shipping and not.
//
// PROVENANCE (2026-07-05): the sixteen care-board symbols came from a design session,
// direction 1C "Slate". They stay theme-agnostic — `currentColor` for neutral shapes so the
// card tints them, explicit hex only where color CARRIES meaning rather than decorating it.
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
//     color supports meaning, it never carries it alone. Somebody who cannot distinguish the
//     hues must lose nothing, which is why every card also carries its word.
//     *** `currentColor` STAYS NOW THAT THE BOARD NO LONGER FOLLOWS THE PROFILE THEME
//     (2026-09-02), and the reason it survives has changed. *** It is no longer about theming:
//     it is that a symbol EXPORTED OR PRINTED degrades to a monochrome drawing rather than to
//     a colour picked for a background that is not there. A neutral shape hard-coded to the
//     board's light ink would come off a printer as pale grey on white paper. The
//     meaning-bearing hexes are the opposite case — they carry meaning, so they travel with
//     the drawing on purpose. Those same hexes are now also the board's WORD colours (see the
//     `.ab-*` rules in modules.css), so the word under a symbol is the accent inside it and
//     the two cannot drift apart.
//   * big simple silhouettes: it has to read at a glance, from a bed, at one to two meters
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
      '<path d="M22 84 Q50 58 78 84" stroke="currentColor" ' + S + '/>'),

    // -------------------------------------------------------------------------------------
    // THE CORE VOCABULARY SET (2026-09-06) — thirty-two drawings for the words in
    // `UNIVERSAL` in aac_vocab.js. Nimrod's own, like everything else in this file.
    // -------------------------------------------------------------------------------------
    //
    // *** THESE ARE FIRST-PASS DRAWINGS AND THEY SAY SO, exactly like the five game-only ones
    // above. *** They follow the design rules — viewBox 100, ~7px strokes, `currentColor`,
    // silhouettes that read at a glance from a bed — but they have NOT been through a design
    // session the way the sixteen care-board symbols were, and core vocabulary is harder to
    // draw than care vocabulary because most of it is abstract. `Bedpan` is a picture of a
    // thing; `that` is not.
    //
    // WHAT MAKES THAT SHIPPABLE RATHER THAN SLOPPY is the rule this file already states: the
    // symbol SUPPORTS meaning, the word CARRIES it. Every card renders its word, and the board
    // drops the picture before it shrinks the word. A first-pass drawing beside a clear word is
    // a usable card; the same word with no picture at all is a worse one.
    //
    // Conventions, so a later pass has something to keep rather than a pile of glyphs:
    //   * PEOPLE are a head and shoulders. An arrow says which person: into the chest for `i`,
    //     away from the figure for `you`. `my` is the figure holding something.
    //   * QUESTIONS all carry the same question mark, with one element saying which question:
    //     nothing for `what`, a head for `who`, a clock for `when`, a map pin for `where`.
    //   * PLACE AND DIRECTION are arrows, with a box wherever the word is about the box —
    //     `in`, `out`, `on`, `off`, `put`.
    //
    // *** AND THE HONEST CAVEAT: confusability across a set this size is a real risk and is not
    // something a suite can measure. `okay` and `yes` were already flagged for it by the
    // designer. Somebody who reads AAC symbols for a living should look at these — that is a
    // question for the Ace Centre call, not a thing to keep guessing at in a comment. ***

    // people — head and shoulders, with an arrow saying which person
    // REDRAWN ONCE, BY LOOKING AT THE BOARD RATHER THAN AT THE CODE. The first version put a
    // small head over a shallow arc with the arrow crossing it, and at card size the figure
    // read as a dot and a swoosh with a tick through it. Bigger head, deeper shoulders, and
    // the arrow kept clear of the body: the person has to be a person before the arrow can say
    // anything about which person it is.
    i: svg('<circle cx="38" cy="32" r="16" stroke="currentColor" ' + S + '/>' +
      '<path d="M8 88 Q38 56 68 88" stroke="currentColor" ' + S + '/>' +
      '<path d="M92 44 L60 60" stroke="currentColor" ' + S + '/>' +
      '<path d="M74 46 L58 61 L74 66" stroke="currentColor" ' + S + '/>'),
    you: svg('<circle cx="30" cy="32" r="16" stroke="currentColor" ' + S + '/>' +
      '<path d="M2 88 Q30 56 58 88" stroke="currentColor" ' + S + '/>' +
      '<path d="M62 46 H92" stroke="currentColor" ' + S + '/>' +
      '<path d="M80 34 L94 46 L80 58" stroke="currentColor" ' + S + '/>'),
    my: svg('<circle cx="50" cy="26" r="15" stroke="currentColor" ' + S + '/>' +
      '<path d="M18 88 Q50 58 82 88" stroke="currentColor" ' + S + '/>' +
      '<rect x="37" y="52" width="26" height="22" rx="4" fill="currentColor"/>'),

    // things — a plain box is a thing; `that` is a thing over there, pointed at
    it: svg('<rect x="26" y="30" width="48" height="42" rx="7" stroke="currentColor" ' + S + '/>'),
    that: svg('<rect x="58" y="32" width="34" height="34" rx="6" stroke="currentColor" ' + S + '/>' +
      '<path d="M8 50 H46" stroke="currentColor" ' + S + '/>' +
      '<path d="M36 38 L48 50 L36 62" stroke="currentColor" ' + S + '/>'),

    // questions — the same mark every time, with one element saying which question
    what: svg('<path d="M35 34 Q35 18 50 18 Q66 18 66 33 Q66 46 50 50 V60" stroke="currentColor" ' + S + '/>' +
      '<circle cx="50" cy="78" r="6" fill="currentColor"/>'),
    who: svg('<circle cx="50" cy="34" r="21" stroke="currentColor" ' + S + '/>' +
      '<path d="M18 88 Q50 62 82 88" stroke="currentColor" ' + S + '/>' +
      '<path d="M43 29 Q43 21 50 21 Q58 21 58 28 Q58 34 50 36" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>' +
      '<circle cx="50" cy="45" r="3" fill="currentColor"/>'),
    when: svg('<circle cx="44" cy="54" r="28" stroke="currentColor" ' + S + '/>' +
      '<path d="M44 34 V54 L59 62" stroke="currentColor" ' + S + '/>' +
      '<path d="M72 22 Q72 12 81 12 Q90 12 90 21 Q90 28 81 30" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>' +
      '<circle cx="81" cy="40" r="3" fill="currentColor"/>'),
    where: svg('<path d="M42 88 C42 88 20 60 20 44 A22 22 0 0 1 64 44 C64 60 42 88 42 88 Z" stroke="currentColor" ' + S + '/>' +
      '<circle cx="42" cy="44" r="8" stroke="currentColor" ' + S + '/>' +
      '<path d="M74 24 Q74 14 83 14 Q92 14 92 23 Q92 30 83 32" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>' +
      '<circle cx="83" cy="42" r="3" fill="currentColor"/>'),

    // negation — the universal one, and the only symbol in the set that needs no explaining
    not: svg('<circle cx="50" cy="50" r="30" stroke="currentColor" ' + S + '/>' +
      '<path d="M29 71 L71 29" stroke="currentColor" ' + S + '/>'),

    // doing words
    go: svg('<path d="M26 50 H74" stroke="currentColor" ' + S + '/>' +
      '<path d="M60 34 L78 50 L60 66" stroke="currentColor" ' + S + '/>' +
      '<path d="M8 36 H22 M8 64 H22" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.55"/>'),
    get: svg('<path d="M50 12 V52" stroke="currentColor" ' + S + '/>' +
      '<path d="M34 38 L50 54 L66 38" stroke="currentColor" ' + S + '/>' +
      '<path d="M18 60 Q50 94 82 60" stroke="currentColor" ' + S + '/>'),
    // an action: something happening, in every direction at once
    do: svg('<circle cx="50" cy="50" r="11" fill="currentColor"/>' +
      '<path d="M50 26 V10 M50 90 V74 M26 50 H10 M90 50 H74" stroke="currentColor" ' + S + '/>' +
      '<path d="M32 32 L21 21 M79 79 L68 68 M68 32 L79 21 M21 79 L32 68" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>'),
    put: svg('<rect x="22" y="58" width="56" height="30" rx="6" stroke="currentColor" ' + S + '/>' +
      '<path d="M50 10 V44" stroke="currentColor" ' + S + '/>' +
      '<path d="M36 32 L50 46 L64 32" stroke="currentColor" ' + S + '/>'),
    make: svg('<rect x="14" y="58" width="30" height="28" rx="5" stroke="currentColor" ' + S + '/>' +
      '<rect x="56" y="58" width="30" height="28" rx="5" stroke="currentColor" ' + S + '/>' +
      '<rect x="35" y="18" width="30" height="28" rx="5" stroke="currentColor" ' + S + '/>'),
    turn: svg('<path d="M78 50 A28 28 0 1 1 50 22" stroke="currentColor" ' + S + '/>' +
      '<path d="M38 10 L52 22 L38 34" stroke="currentColor" ' + S + '/>'),
    open: svg('<path d="M22 54 H70 V86 H22 Z" stroke="currentColor" ' + S + '/>' +
      '<path d="M22 54 L44 30 H92 L70 54" stroke="currentColor" ' + S + '/>'),
    // two arrows converging: bring it to me
    want: svg('<path d="M8 50 H38" stroke="currentColor" ' + S + '/>' +
      '<path d="M28 38 L40 50 L28 62" stroke="currentColor" ' + S + '/>' +
      '<path d="M92 50 H62" stroke="currentColor" ' + S + '/>' +
      '<path d="M72 38 L60 50 L72 62" stroke="currentColor" ' + S + '/>'),
    like: svg('<path d="M18 44 H36 V86 H18 Z" stroke="currentColor" ' + S + '/>' +
      '<path d="M36 44 L52 14 Q62 14 60 26 L56 42 H78 Q88 42 86 53 L80 78 Q78 86 70 86 H36" stroke="currentColor" ' + S + '/>'),
    look: svg('<path d="M8 50 Q50 18 92 50 Q50 82 8 50 Z" stroke="currentColor" ' + S + '/>' +
      '<circle cx="50" cy="50" r="13" stroke="currentColor" ' + S + '/>' +
      '<circle cx="50" cy="50" r="4" fill="currentColor"/>'),

    // describing words
    some: svg('<circle cx="50" cy="50" r="29" stroke="currentColor" ' + S + '/>' +
      '<path d="M50 21 A29 29 0 0 1 50 79 Z" fill="currentColor"/>'),
    different: svg('<circle cx="30" cy="50" r="19" stroke="currentColor" ' + S + '/>' +
      '<rect x="56" y="30" width="38" height="38" rx="5" stroke="currentColor" ' + S + '/>'),
    good: svg('<path d="M50 14 L61 39 L88 42 L68 61 L74 88 L50 74 L26 88 L32 61 L12 42 L39 39 Z" stroke="currentColor" ' + S + '/>'),
    little: svg('<rect x="38" y="38" width="24" height="24" rx="4" stroke="currentColor" ' + S + '/>' +
      '<path d="M12 12 L28 28 M88 12 L72 28 M12 88 L28 72 M88 88 L72 72" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>'),

    // place and direction — arrows, with a box wherever the word is about the box
    up: svg('<path d="M50 86 V26" stroke="currentColor" ' + S + '/>' +
      '<path d="M28 48 L50 26 L72 48" stroke="currentColor" ' + S + '/>'),
    down: svg('<path d="M50 14 V74" stroke="currentColor" ' + S + '/>' +
      '<path d="M28 52 L50 74 L72 52" stroke="currentColor" ' + S + '/>'),
    in: svg('<rect x="46" y="24" width="44" height="52" rx="6" stroke="currentColor" ' + S + '/>' +
      '<path d="M6 50 H62" stroke="currentColor" ' + S + '/>' +
      '<path d="M50 38 L64 50 L50 62" stroke="currentColor" ' + S + '/>'),
    out: svg('<rect x="10" y="24" width="44" height="52" rx="6" stroke="currentColor" ' + S + '/>' +
      '<path d="M38 50 H92" stroke="currentColor" ' + S + '/>' +
      '<path d="M80 38 L94 50 L80 62" stroke="currentColor" ' + S + '/>'),
    on: svg('<path d="M10 74 H90" stroke="currentColor" ' + S + '/>' +
      '<rect x="34" y="40" width="32" height="28" rx="5" stroke="currentColor" ' + S + '/>'),
    off: svg('<path d="M10 82 H90" stroke="currentColor" ' + S + '/>' +
      '<rect x="34" y="14" width="32" height="26" rx="5" stroke="currentColor" ' + S + '/>' +
      '<path d="M50 72 V54" stroke="currentColor" ' + S + '/>' +
      '<path d="M40 62 L50 52 L60 62" stroke="currentColor" ' + S + '/>'),
    // *** A PAIR, AND THEY WERE REDRAWN BECAUSE `here` WAS INDISTINGUISHABLE FROM `get`. ***
    // Both were a down-arrow falling into a curved shape, which on a 44px card is one picture
    // with two words under it. On a communication board that is not an aesthetic complaint:
    // somebody reaching by shape reaches for the wrong word. They are now a TARGET, close and
    // far, so the two of them read as the pair they are and neither reads as anything else.
    here: svg('<circle cx="50" cy="64" r="21" stroke="currentColor" ' + S + '/>' +
      '<circle cx="50" cy="64" r="8" fill="currentColor"/>' +
      '<path d="M50 8 V28" stroke="currentColor" ' + S + '/>' +
      '<path d="M40 20 L50 32 L60 20" stroke="currentColor" ' + S + '/>'),
    there: svg('<circle cx="74" cy="56" r="16" stroke="currentColor" ' + S + '/>' +
      '<circle cx="74" cy="56" r="6" fill="currentColor"/>' +
      '<path d="M6 56 H44" stroke="currentColor" ' + S + '/>' +
      '<path d="M36 44 L50 56 L36 68" stroke="currentColor" ' + S + '/>')
};

/** Every symbol name, for a picker and for the vocabulary validator. */
export const SYMBOL_NAMES = Object.keys(SYMBOLS);

/** The markup for a symbol, or '' — a missing symbol renders as a word-only card, never as a
 *  broken box. A card with no picture still says what it says. */
export function symbolSvg(name) {
  return (name && SYMBOLS[name]) || '';
}
