// aac_themed.js - CLAUDE DESIGN'S THEMED AAC SYMBOL SETS (delivered 2026-11-01, row 2.146; credited in ATTRIBUTIONS.md).
// Copied as delivered from Design's themedSymbols.js (Nimrod_Ecosystem docs/from_design/themed_symbols_20261101/), not edited:
// to change a picture, change Design's file and copy it again. The board uses it in modules/board.js (THEMED PICTURES).
// Design's own note below says 'animated: off to start'; Mike ruled it ON by default on 2026-11-02 (row 2.146), and that
// default lives in the board's setting, not here. The base sets (aac_sets.js) are unchanged.

/* themedSymbols.js: themed AAC symbol sets, built from pieces (Mike, 2026-11-01).
 *
 * Mike's ruling: the base symbols stay simple (assets/icons/, color/, mono/ and the per-theme tints).
 * Each THEMED set uses pictures that fit the theme, and may be richer and animated, because a themed
 * set doesn't assume low vision. The plain symbols setting still swaps a board back to the simple set.
 *
 * Nothing is pre-drawn per word. A themed symbol is composed from three separate things:
 *   GLYPHS[word]       the word's own simple drawing (the base set's art), so the meaning carries over
 *   PIECES[id]         a theme piece that carries the glyph: a carved pumpkin, a ghost, a snow globe…
 *                      Each piece is its own thing, with a window where the glyph sits, and can be
 *                      reused by any theme (the lantern is in Night and Steampunk; the mug in Winter
 *                      and Cozy; the pumpkin in Halloween and Fall)
 *   THEMES[theme]      which piece carries which kind of word, the palette, and per-word choices
 *
 *   symbolSvg(word, theme, { animated }) → '<svg …>'   100×100, like every Nimrod symbol
 *   THEME_SET_IDS, PIECES, ACCENTS, THEMES, GLYPHS, ROLES        the data, for an editor or a build script
 *
 * Settings, each with a starting value:
 *   animated   off to start. Motion runs only inside prefers-reduced-motion: no-preference, and the
 *              still frame is the finished picture. Nothing flashes.
 *   accents    on to start: a small bat, star or snowflake in a corner the piece leaves free.
 *   per-word   THEMES[theme].words[word] = { piece, art } chooses another piece, or the word's own
 *              themed art (Halloween's pumpkin, ghost, bat… are their own pictures).
 */

/* ---------- the base glyphs, and what kind of word each is ---------- */
export const GLYPHS = {
"all_done": "<g><path d=\"M28 12 V88\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M28 16 H78 V52 H28\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><rect x=\"28\" y=\"16\" width=\"25\" height=\"18\" fill=\"currentColor\" opacity=\"0.85\"></rect><rect x=\"53\" y=\"34\" width=\"25\" height=\"18\" fill=\"currentColor\" opacity=\"0.85\"></rect></g>",
"bat": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 40c-6-12-20-16-40-10 8 6 10 14 6 22 8-4 14-2 18 6 4-8 10-12 16-12s12 4 16 12c4-8 10-10 18-6-4-8-2-16 6-22-20-6-34-2-40 10z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"5\"></path><path d=\"M42 34l-4-10 8 6M58 34l4-10-8 6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"4\"></path><circle cx=\"45\" cy=\"44\" r=\"3.5\" fill=\"none\"></circle><circle cx=\"55\" cy=\"44\" r=\"3.5\" fill=\"none\"></circle></g>",
"bedpan": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><ellipse cx=\"48\" cy=\"50\" rx=\"24\" ry=\"8\" stroke=\"currentColor\" stroke-width=\"6\"></ellipse><path d=\"M24 50 Q26 66 48 68 Q68 66 72 54\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M72 50 L84 47\" stroke=\"currentColor\" stroke-width=\"6\"></path></g>",
"candy": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M30 50l-18-14v28zM70 50l18-14v28z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"5\"></path><ellipse cx=\"50\" cy=\"50\" rx=\"24\" ry=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\"></ellipse><path d=\"M38 40l-6 20M50 34l-4 32M62 40l-6 20\" stroke=\"none\" stroke-width=\"4\" opacity=\".8\"></path></g>",
"change": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M27 44 A24 24 0 0 1 71 37\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M71 23 L73 39 L57 36\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M73 56 A24 24 0 0 1 29 63\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M29 77 L27 61 L43 64\" stroke=\"currentColor\" stroke-width=\"7\"></path></g>",
"cold": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 18 L50 82 M24 32 L76 68 M76 32 L24 68\" stroke=\"#7fc6d8\" stroke-width=\"7\"></path><path d=\"M43 22 L50 18 L57 22 M43 78 L50 82 L57 78\" stroke=\"#7fc6d8\" stroke-width=\"5\"></path></g>",
"dad": "<g><circle cx=\"50\" cy=\"36\" r=\"15\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M37 28 Q42 18 54 20\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M22 84 Q50 58 78 84\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"different": "<g><circle cx=\"30\" cy=\"50\" r=\"19\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><rect x=\"56\" y=\"30\" width=\"38\" height=\"38\" rx=\"5\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect></g>",
"do": "<g><circle cx=\"50\" cy=\"50\" r=\"11\" fill=\"currentColor\"></circle><path d=\"M50 26 V10 M50 90 V74 M26 50 H10 M90 50 H74\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M32 32 L21 21 M79 79 L68 68 M68 32 L79 21 M21 79 L32 68\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\"></path></g>",
"down": "<g><path d=\"M50 14 V74\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M28 52 L50 74 L72 52\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"get": "<g><path d=\"M50 12 V52\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M34 38 L50 54 L66 38\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M18 60 Q50 94 82 60\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"ghost": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M24 86V46c0-18 12-32 26-32s26 14 26 32v40l-9-7-8 7-9-7-9 7-8-7z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\"></path><ellipse cx=\"40\" cy=\"44\" rx=\"5\" ry=\"7\" fill=\"currentColor\"></ellipse><ellipse cx=\"60\" cy=\"44\" rx=\"5\" ry=\"7\" fill=\"currentColor\"></ellipse><ellipse cx=\"50\" cy=\"62\" rx=\"6\" ry=\"7\" fill=\"currentColor\"></ellipse></g>",
"go": "<g><path d=\"M26 50 H74\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M60 34 L78 50 L60 66\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M8 36 H22 M8 64 H22\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0.55\"></path></g>",
"good": "<g><path d=\"M50 14 L61 39 L88 42 L68 61 L74 88 L50 74 L26 88 L32 61 L12 42 L39 39 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"help": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 20 L83 78 L17 78 Z\" stroke=\"#e2b45a\" stroke-width=\"7\"></path><path d=\"M50 42 L50 58\" stroke=\"#e2b45a\" stroke-width=\"7\"></path><path d=\"M50 66 L50 67\" stroke=\"#e2b45a\" stroke-width=\"7\"></path></g>",
"here": "<g><circle cx=\"50\" cy=\"64\" r=\"21\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><circle cx=\"50\" cy=\"64\" r=\"8\" fill=\"currentColor\"></circle><path d=\"M50 8 V28\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M40 20 L50 32 L60 20\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"hi": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M36 54 L36 66 Q36 77 47 77 L57 77 Q68 77 68 66 L68 52\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M40 54 L40 36\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M48 54 L48 31\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M56 54 L56 33\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M64 54 L64 40\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M36 57 L27 50\" stroke=\"currentColor\" stroke-width=\"7\"></path></g>",
"hot": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 26 L50 62\" stroke=\"#d98a5f\" stroke-width=\"8\"></path><circle cx=\"50\" cy=\"70\" r=\"9\" fill=\"#d98a5f\"></circle><path d=\"M62 34 Q69 40 62 46\" stroke=\"#d98a5f\" stroke-width=\"5\"></path><path d=\"M62 50 Q69 56 62 62\" stroke=\"#d98a5f\" stroke-width=\"5\"></path></g>",
"i": "<g><circle cx=\"38\" cy=\"32\" r=\"16\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M8 88 Q38 56 68 88\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M92 44 L60 60\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M74 46 L58 61 L74 66\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"in": "<g><rect x=\"46\" y=\"24\" width=\"44\" height=\"52\" rx=\"6\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><path d=\"M6 50 H62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M50 38 L64 50 L50 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"it": "<g><rect x=\"26\" y=\"30\" width=\"48\" height=\"42\" rx=\"7\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect></g>",
"keyboard": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"14\" y=\"32\" width=\"72\" height=\"40\" rx=\"7\" stroke=\"currentColor\" stroke-width=\"6\"></rect><path d=\"M26 45 h3 M38 45 h3 M50 45 h3 M62 45 h3 M74 45 h3\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M26 56 h3 M38 56 h3 M50 56 h3 M62 56 h3 M74 56 h3\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M36 66 h28\" stroke=\"currentColor\" stroke-width=\"6\"></path></g>",
"like": "<g><path d=\"M18 44 H36 V86 H18 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M36 44 L52 14 Q62 14 60 26 L56 42 H78 Q88 42 86 53 L80 78 Q78 86 70 86 H36\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"little": "<g><rect x=\"38\" y=\"38\" width=\"24\" height=\"24\" rx=\"4\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><path d=\"M12 12 L28 28 M88 12 L72 28 M12 88 L28 72 M88 88 L72 72\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\"></path></g>",
"look": "<g><path d=\"M8 50 Q50 18 92 50 Q50 82 8 50 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><circle cx=\"50\" cy=\"50\" r=\"13\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><circle cx=\"50\" cy=\"50\" r=\"4\" fill=\"currentColor\"></circle></g>",
"love": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 75 C25 57 19 43 29 33 C37 25 48 29 50 39 C52 29 63 25 71 33 C81 43 75 57 50 75 Z\" stroke=\"#cf6f86\" stroke-width=\"7\"></path></g>",
"make": "<g><rect x=\"14\" y=\"58\" width=\"30\" height=\"28\" rx=\"5\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><rect x=\"56\" y=\"58\" width=\"30\" height=\"28\" rx=\"5\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><rect x=\"35\" y=\"18\" width=\"30\" height=\"28\" rx=\"5\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect></g>",
"mom": "<g><circle cx=\"50\" cy=\"36\" r=\"15\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M36 30 Q30 44 33 58 M64 30 Q70 44 67 58\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M22 84 Q50 58 78 84\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"more": "<g><circle cx=\"50\" cy=\"50\" r=\"36\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M50 32 V68 M32 50 H68\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"music": "<g><path d=\"M38 72 V26 L70 30 V76\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M38 26 L70 30\" stroke=\"currentColor\" stroke-width=\"10\" stroke-linecap=\"round\" fill=\"none\"></path><ellipse cx=\"31\" cy=\"74\" rx=\"9\" ry=\"7\" fill=\"currentColor\"></ellipse><ellipse cx=\"63\" cy=\"78\" rx=\"9\" ry=\"7\" fill=\"currentColor\"></ellipse></g>",
"my": "<g><circle cx=\"50\" cy=\"26\" r=\"15\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M18 88 Q50 58 82 88\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><rect x=\"37\" y=\"52\" width=\"26\" height=\"22\" rx=\"4\" fill=\"currentColor\"></rect></g>",
"no": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M30 30 L70 70 M70 30 L30 70\" stroke=\"#D3968C\" stroke-width=\"10\"></path></g>",
"not": "<g><circle cx=\"50\" cy=\"50\" r=\"30\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M29 71 L71 29\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"off": "<g><path d=\"M10 82 H90\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><rect x=\"34\" y=\"14\" width=\"32\" height=\"26\" rx=\"5\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><path d=\"M50 72 V54\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M40 62 L50 52 L60 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"okay": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"50\" cy=\"50\" r=\"30\" stroke=\"currentColor\" stroke-width=\"7\"></circle><path d=\"M37 51 L46 61 L64 39\" stroke=\"currentColor\" stroke-width=\"7\"></path></g>",
"on": "<g><path d=\"M10 74 H90\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><rect x=\"34\" y=\"40\" width=\"32\" height=\"28\" rx=\"5\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect></g>",
"open": "<g><path d=\"M22 54 H70 V86 H22 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M22 54 L44 30 H92 L70 54\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"out": "<g><rect x=\"10\" y=\"24\" width=\"44\" height=\"52\" rx=\"6\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><path d=\"M38 50 H92\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M80 38 L94 50 L80 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"pain": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"50,16 57.6,31.5 74,26 68.5,42.3 84,50 68.5,57.6 74,74 57.6,68.5 50,84 42.3,68.5 26,74 31.5,57.6 16,50 31.5,42.3 26,26 42.3,31.5\" stroke=\"#D3968C\" stroke-width=\"6\"></polygon><path d=\"M50 40 L50 54\" stroke=\"#D3968C\" stroke-width=\"6\"></path><path d=\"M50 62 L50 63\" stroke=\"#D3968C\" stroke-width=\"6\"></path></g>",
"pumpkin": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 26c-24 0-38 14-38 34s16 30 38 30 38-10 38-30-14-34-38-34z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M50 28c-10 6-14 18-14 32s4 24 14 30M50 28c10 6 14 18 14 32s-4 24-14 30\" stroke=\"currentColor\" stroke-width=\"4\"></path><path d=\"M50 26c0-8 4-14 12-16\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M32 54l7-9 7 9zM54 54l7-9 7 9z\" fill=\"currentColor\" stroke=\"currentColor\" stroke-width=\"3\"></path><path d=\"M34 66q16 12 32 0\" stroke=\"currentColor\" stroke-width=\"5\"></path></g>",
"put": "<g><rect x=\"22\" y=\"58\" width=\"56\" height=\"30\" rx=\"6\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><path d=\"M50 10 V44\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M36 32 L50 46 L64 32\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"rephrase": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M26 28 H74 A9 9 0 0 1 83 37 V57 A9 9 0 0 1 74 66 H44 L30 78 V66 H26 A9 9 0 0 1 17 57 V37 A9 9 0 0 1 26 28 Z\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M60 42 A12 12 0 1 0 62 54\" stroke=\"currentColor\" stroke-width=\"5\"></path><path d=\"M61 36 L62 44 L54 43\" stroke=\"currentColor\" stroke-width=\"5\"></path></g>",
"some": "<g><circle cx=\"50\" cy=\"50\" r=\"29\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M50 21 A29 29 0 0 1 50 79 Z\" fill=\"currentColor\"></path></g>",
"stop": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"36,17 64,17 83,36 83,64 64,83 36,83 17,64 17,36\" stroke=\"#D3968C\" stroke-width=\"7\"></polygon><path d=\"M34 50 L66 50\" stroke=\"#D3968C\" stroke-width=\"9\"></path></g>",
"suction": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M40 22 L52 22 M46 22 L46 50 Q46 64 60 69 L69 72\" stroke=\"currentColor\" stroke-width=\"7\"></path><circle cx=\"74\" cy=\"76\" r=\"3\" fill=\"currentColor\"></circle></g>",
"thanks": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 46 C47 40 39 41 39 47 C39 52 46 55 50 60 C54 55 61 52 61 47 C61 41 53 40 50 46 Z\" stroke=\"#cf6f86\" stroke-width=\"5\"></path><path d=\"M30 66 Q50 58 70 66\" stroke=\"currentColor\" stroke-width=\"7\"></path><path d=\"M31 66 L30 74 M40 62 L39 71 M50 60 L50 70 M60 62 L61 71 M69 66 L70 74\" stroke=\"currentColor\" stroke-width=\"7\"></path></g>",
"that": "<g><rect x=\"58\" y=\"32\" width=\"34\" height=\"34\" rx=\"6\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></rect><path d=\"M8 50 H46\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M36 38 L48 50 L36 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"there": "<g><circle cx=\"74\" cy=\"56\" r=\"16\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><circle cx=\"74\" cy=\"56\" r=\"6\" fill=\"currentColor\"></circle><path d=\"M6 56 H44\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M36 44 L50 56 L36 68\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"tired": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M63 24 A28 28 0 1 0 63 76 A21 21 0 1 1 63 24 Z\" fill=\"currentColor\"></path><path d=\"M64 32 L74 32 L64 43 L74 43\" stroke=\"currentColor\" stroke-width=\"4\" fill=\"none\"></path></g>",
"treatPail": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M26 34q24-26 48 0\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M20 40h60l-6 46H26z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M34 54l6-7 6 7zM54 54l6-7 6 7z\" fill=\"currentColor\"></path><path d=\"M36 68q14 10 28 0\" stroke=\"currentColor\" stroke-width=\"5\"></path></g>",
"turn": "<g><path d=\"M78 50 A28 28 0 1 1 50 22\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M38 10 L52 22 L38 34\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"up": "<g><path d=\"M50 86 V26\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M28 48 L50 26 L72 48\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"wait": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M32 20 L68 20 M32 80 L68 80 M35 21 Q35 34 50 50 Q35 66 35 79 M65 21 Q65 34 50 50 Q65 66 65 79\" stroke=\"currentColor\" stroke-width=\"7\"></path></g>",
"want": "<g><path d=\"M8 50 H38\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M28 38 L40 50 L28 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M92 50 H62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M72 38 L60 50 L72 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"what": "<g><path d=\"M35 34 Q35 18 50 18 Q66 18 66 33 Q66 46 50 50 V60\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><circle cx=\"50\" cy=\"78\" r=\"6\" fill=\"currentColor\"></circle></g>",
"when": "<g><circle cx=\"44\" cy=\"54\" r=\"28\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M44 34 V54 L59 62\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M72 22 Q72 12 81 12 Q90 12 90 21 Q90 28 81 30\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\"></path><circle cx=\"81\" cy=\"40\" r=\"3\" fill=\"currentColor\"></circle></g>",
"where": "<g><path d=\"M42 88 C42 88 20 60 20 44 A22 22 0 0 1 64 44 C64 60 42 88 42 88 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><circle cx=\"42\" cy=\"44\" r=\"8\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M74 24 Q74 14 83 14 Q92 14 92 23 Q92 30 83 32\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\"></path><circle cx=\"83\" cy=\"42\" r=\"3\" fill=\"currentColor\"></circle></g>",
"who": "<g><circle cx=\"50\" cy=\"34\" r=\"21\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M18 88 Q50 62 82 88\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M43 29 Q43 21 50 21 Q58 21 58 28 Q58 34 50 36\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\"></path><circle cx=\"50\" cy=\"45\" r=\"3\" fill=\"currentColor\"></circle></g>",
"witchHat": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 80q36-14 72 0\" stroke=\"currentColor\" stroke-width=\"7\" fill=\"none\"></path><path d=\"M28 76L48 16q4-6 8 0l10 30 4-6-4 34z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"6\"></path><path d=\"M30 64q20 6 38 0\" stroke=\"none\" stroke-width=\"8\"></path></g>",
"yes": "<g fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M22 53 L42 73 L80 29\" stroke=\"#6abf69\" stroke-width=\"10\"></path></g>",
"you": "<g><circle cx=\"30\" cy=\"32\" r=\"16\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></circle><path d=\"M2 88 Q30 56 58 88\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M62 46 H92\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path><path d=\"M80 34 L94 46 L80 58\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"></path></g>",
"eat": "<g><path d=\"M16 54 H84 Q82 84 50 84 Q18 84 16 54 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M61 41 L82 14\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><ellipse cx=\"55\" cy=\"46\" rx=\"10\" ry=\"6.5\" transform=\"rotate(-52 55 46)\" fill=\"currentColor\"/></g>",
"drink": "<g><path d=\"M28 30 H72 L65 86 H35 Z\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M56 30 L62 10 H76\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M34 50 H66\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" opacity=\"0.55\"/></g>",
"please": "<g><circle cx=\"50\" cy=\"20\" r=\"12\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M10 94 Q50 18 90 94\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M60 79 A10 10 0 1 1 50 69\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M44 63 L51 69 L44 75\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g>",
"bye": "<g><g transform=\"translate(-12 0)\"><path d=\"M36 54 L36 66 Q36 77 47 77 L57 77 Q68 77 68 66 L68 52\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M40 54 L40 36\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M48 54 L48 31\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M56 54 L56 33\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M64 54 L64 40\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M36 57 L27 50\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g><path d=\"M66 46 H88\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M78 36 L90 46 L78 56\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g>",
"bad": "<g><g transform=\"translate(-5 2) rotate(-7 50 74)\"><path d=\"M50 14 L39 39 L12 42 L32 61 L26 88 L50 74 L45 62 L54 50 L45 38 L52 26 Z\" stroke=\"#D3968C\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g><g transform=\"translate(5 2) rotate(7 50 74)\"><path d=\"M50 14 L52 26 L45 38 L54 50 L45 62 L50 74 L74 88 L68 61 L88 42 L61 39 Z\" stroke=\"#D3968C\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g></g>",
"come": "<g><path d=\"M74 50 H26\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M40 34 L22 50 L40 66\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M78 36 H92 M78 64 H92\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" fill=\"none\" opacity=\"0.55\"/></g>",
"other": "<g><circle cx=\"28\" cy=\"64\" r=\"16\" fill=\"currentColor\"/><circle cx=\"72\" cy=\"64\" r=\"16\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M30 38 Q50 16 68 34\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M57 33 L68 36 L70 25\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g>",
"hungry": "<g><circle cx=\"50\" cy=\"54\" r=\"22\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><circle cx=\"50\" cy=\"54\" r=\"10\" stroke=\"currentColor\" stroke-width=\"5\" fill=\"none\" opacity=\"0.55\"/><path d=\"M10 16 V32 M16 16 V32 M22 16 V32 M10 32 Q16 40 22 32\" stroke=\"currentColor\" stroke-width=\"4.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M16 38 V86\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M80 50 V16 Q90 24 89 50 Z\" stroke=\"currentColor\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M84 52 V86\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></g>",
"thirsty": "<g><path d=\"M30 36 L37 88 H63 L70 36\" stroke=\"currentColor\" stroke-width=\"7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/><path d=\"M50 6 C57 15 59 20 59 23 A9 9 0 0 1 41 23 C41 20 43 15 50 6 Z\" fill=\"currentColor\"/></g>"
};
/* A action or object · P person, social or question · C care need · W wanting · N meaning colour
   (yes, no, stop, pain, hot, cold, bad) · words drawn for one theme (pumpkin, ghost…) are N too */
export const ROLES = {"all_done": "A", "bat": "N", "bedpan": "C", "candy": "N", "change": "C", "cold": "N", "dad": "P", "different": "A", "do": "A", "down": "A", "get": "A", "ghost": "N", "go": "A", "good": "W", "help": "C", "here": "A", "hi": "P", "hot": "N", "i": "P", "in": "A", "it": "A", "keyboard": "A", "like": "W", "little": "A", "look": "A", "love": "W", "make": "A", "mom": "P", "more": "W", "music": "A", "my": "P", "no": "N", "not": "P", "off": "A", "okay": "P", "on": "A", "open": "A", "out": "A", "pain": "N", "pumpkin": "N", "put": "A", "rephrase": "P", "some": "A", "stop": "N", "suction": "C", "thanks": "W", "that": "A", "there": "A", "tired": "C", "treatPail": "N", "turn": "A", "up": "A", "wait": "C", "want": "W", "what": "P", "when": "P", "where": "P", "who": "P", "witchHat": "N", "yes": "N", "you": "P", "eat": "A", "drink": "A", "please": "P", "bye": "P", "bad": "N", "come": "A", "other": "A", "hungry": "C", "thirsty": "C"};
const THEMED_ART = {"pumpkin": "<svg viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 26c-24 0-38 14-38 34s16 30 38 30 38-10 38-30-14-34-38-34z\" fill=\"#f2a03c\" stroke=\"#16121f\" stroke-width=\"6\"></path><path d=\"M50 28c-10 6-14 18-14 32s4 24 14 30M50 28c10 6 14 18 14 32s-4 24-14 30\" stroke=\"#16121f\" stroke-width=\"4\"></path><path d=\"M50 26c0-8 4-14 12-16\" stroke=\"#9cc485\" stroke-width=\"7\"></path><path d=\"M32 54l7-9 7 9zM54 54l7-9 7 9z\" fill=\"#16121f\" stroke=\"#16121f\" stroke-width=\"3\"></path><path d=\"M34 66q16 12 32 0\" stroke=\"#16121f\" stroke-width=\"5\"></path></svg>", "ghost": "<svg viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M24 86V46c0-18 12-32 26-32s26 14 26 32v40l-9-7-8 7-9-7-9 7-8-7z\" fill=\"#f4eee6\" stroke=\"#16121f\" stroke-width=\"6\"></path><ellipse cx=\"40\" cy=\"44\" rx=\"5\" ry=\"7\" fill=\"#16121f\"></ellipse><ellipse cx=\"60\" cy=\"44\" rx=\"5\" ry=\"7\" fill=\"#16121f\"></ellipse><ellipse cx=\"50\" cy=\"62\" rx=\"6\" ry=\"7\" fill=\"#16121f\"></ellipse></svg>", "bat": "<svg viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M50 40c-6-12-20-16-40-10 8 6 10 14 6 22 8-4 14-2 18 6 4-8 10-12 16-12s12 4 16 12c4-8 10-10 18-6-4-8-2-16 6-22-20-6-34-2-40 10z\" fill=\"#c9a8f0\" stroke=\"#16121f\" stroke-width=\"5\"></path><path d=\"M42 34l-4-10 8 6M58 34l4-10-8 6\" fill=\"#c9a8f0\" stroke=\"#16121f\" stroke-width=\"4\"></path><circle cx=\"45\" cy=\"44\" r=\"3.5\" fill=\"#f4eee6\"></circle><circle cx=\"55\" cy=\"44\" r=\"3.5\" fill=\"#f4eee6\"></circle></svg>", "candy": "<svg viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M30 50l-18-14v28zM70 50l18-14v28z\" fill=\"#f2a03c\" stroke=\"#16121f\" stroke-width=\"5\"></path><ellipse cx=\"50\" cy=\"50\" rx=\"24\" ry=\"18\" fill=\"#c9a8f0\" stroke=\"#16121f\" stroke-width=\"6\"></ellipse><path d=\"M38 40l-6 20M50 34l-4 32M62 40l-6 20\" stroke=\"#f4eee6\" stroke-width=\"4\" opacity=\".8\"></path></svg>", "witchHat": "<svg viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14 80q36-14 72 0\" stroke=\"#16121f\" stroke-width=\"7\" fill=\"#c9a8f0\"></path><path d=\"M28 76L48 16q4-6 8 0l10 30 4-6-4 34z\" fill=\"#c9a8f0\" stroke=\"#16121f\" stroke-width=\"6\"></path><path d=\"M30 64q20 6 38 0\" stroke=\"#f2a03c\" stroke-width=\"8\"></path></svg>", "treatPail": "<svg viewBox=\"0 0 100 100\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\" fill=\"none\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M26 34q24-26 48 0\" stroke=\"#16121f\" stroke-width=\"6\"></path><path d=\"M20 40h60l-6 46H26z\" fill=\"#f2a03c\" stroke=\"#16121f\" stroke-width=\"6\"></path><path d=\"M34 54l6-7 6 7zM54 54l6-7 6 7z\" fill=\"#16121f\"></path><path d=\"M36 68q14 10 28 0\" stroke=\"#16121f\" stroke-width=\"5\"></path></svg>"};

/* ---------- helpers ---------- */
const STROKE_BOOST = 1.35; // a glyph is drawn smaller inside a piece, so its strokes are thickened
function glyph(word, ink, s, cx, cy, extra = '') {
  const g = GLYPHS[word];
  if (!g) return '';
  const recol = g
    .replace(/(stroke|fill)="(?!none)[^"]*"/g, (m, k) => `${k}="${ink}"`)
    .replace(/stroke-width="([\d.]+)"/g, (m, v) => `stroke-width="${(+v * STROKE_BOOST).toFixed(2)}"`);
  const top = recol.replace(/^<g/, `<g stroke="${ink}"`);
  return `<g transform="translate(${cx - 50 * s} ${cy - 50 * s}) scale(${s})"${extra}>${top}</g>`;
}
/* a glyph drawn twice: a wide dark pass under a bright one (carved, or a neon tube) */
const twoPass = (word, under, over, s, cx, cy) =>
  glyph(word, under, s, cx, cy).replace(/stroke-width="([\d.]+)"/g, (m, v) => `stroke-width="${(+v * 1.9).toFixed(2)}"`)
  + glyph(word, over, s, cx, cy, ' class="ts-glow"');

/* ---------- the pieces ----------
   Each piece: { label, draw(pal, word) → svg, glyph(pal, word) → svg, motion: css }. Pieces never
   know which theme they're in; the theme hands them a palette. */
export const PIECES = {
  pumpkin: {
    label: 'Pumpkin (carved, or plain)',
    draw: (p) => `<g class="ts-glowbg"><ellipse cx="50" cy="60" rx="40" ry="31" fill="${p.glow || 'none'}" opacity=".35"/></g>
      <path d="M50 28c-26 0-42 13-42 32s16 31 42 31 42-12 42-31-16-32-42-32z" fill="${p.body}"/>
      <path d="M50 30c-9 0-14 13-14 30s5 30 14 30 14-13 14-30-5-30-14-30z" fill="${p.rib}" opacity=".55"/>
      <path d="M26 33c-7 6-10 15-10 27s3 21 10 27M74 33c7 6 10 15 10 27s-3 21-10 27" stroke="${p.rib}" stroke-width="3" fill="none" opacity=".7"/>
      <path d="M47 30c0-8 2-14 7-18" stroke="${p.stem}" stroke-width="7" stroke-linecap="round" fill="none"/>
      <path d="M55 16c8-6 18-4 20 2-6 5-15 5-20-2z" fill="${p.leaf}"/>`,
    glyph: (p, w) => (p.carved ? twoPass(w, p.carve, p.ink, 0.5, 50, 62) : glyph(w, p.ink, 0.5, 50, 62)),
    motion: '@keyframes tsGlow{from{opacity:.75}to{opacity:1}} .ts-glow{animation:tsGlow 2.8s ease-in-out infinite alternate} .ts-glowbg{animation:tsGlow 2.8s ease-in-out infinite alternate}',
  },
  ghost: {
    accentAt: [70, 2],
    label: 'Ghost',
    draw: (p) => `<g class="ts-bob"><path d="M18 92V48c0-21 14-38 32-38s32 17 32 38v44l-8-7-8 7-8-7-8 7-8-7-8 7-8-7z" fill="${p.body}" stroke="${p.edge}" stroke-width="4" stroke-linejoin="round"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.52, 50, 52) + '</g>',
    motion: '@keyframes tsBob{from{transform:translateY(0)}to{transform:translateY(-4px)}} .ts-bob{animation:tsBob 2.6s ease-in-out infinite alternate}',
  },
  cauldron: {
    accentAt: [70, 4],
    label: 'Cauldron',
    draw: (p) => `<path d="M10 40h80" stroke="${p.rim}" stroke-width="8" stroke-linecap="round"/>
      <path d="M14 42h72c0 26-14 46-36 46S14 68 14 42z" fill="${p.body}"/>
      <path d="M26 88l-6 8M74 88l6 8" stroke="${p.body}" stroke-width="6" stroke-linecap="round"/>
      <g class="ts-rise">${[[30, 30, 5], [46, 22, 7], [66, 28, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.bubble}"/>`).join('')}</g>`,
    glyph: (p, w) => glyph(w, p.ink, 0.42, 50, 64),
    motion: '@keyframes tsRise{0%{transform:translateY(4px);opacity:.4}100%{transform:translateY(-6px);opacity:1}} .ts-rise{animation:tsRise 2.4s ease-in-out infinite alternate}',
  },
  lantern: {
    accentAt: [8, 8],
    label: 'Lantern',
    draw: (p) => `<path d="M38 12h24M50 6v6" stroke="${p.frame}" stroke-width="5" stroke-linecap="round"/>
      <path d="M30 18h40l6 10H24z" fill="${p.frame}"/>
      <g class="ts-glowbg"><rect x="24" y="28" width="52" height="56" rx="6" fill="${p.glass}"/></g>
      <rect x="24" y="28" width="52" height="56" rx="6" fill="none" stroke="${p.frame}" stroke-width="5"/>
      <path d="M22 86h56l-4 8H26z" fill="${p.frame}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.46, 50, 56),
    motion: '@keyframes tsGlow{from{opacity:.8}to{opacity:1}} .ts-glowbg{animation:tsGlow 3s ease-in-out infinite alternate}',
  },
  moon: {
    accentAt: [78, 4],
    label: 'Full moon',
    draw: (p) => `<circle cx="50" cy="50" r="42" fill="${p.body}"/>${[[30, 30, 6], [70, 64, 8], [62, 26, 4], [28, 70, 5]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.crater}" opacity=".5"/>`).join('')}`,
    glyph: (p, w) => glyph(w, p.ink, 0.56, 50, 50),
    motion: '',
  },
  cloud: {
    label: 'Cloud',
    draw: (p) => `<g class="ts-drift"><path d="M22 78a16 16 0 0 1 2-32 22 22 0 0 1 42-8 18 18 0 0 1 14 40z" fill="${p.body}" stroke="${p.edge}" stroke-width="3"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.42, 50, 58) + '</g>',
    motion: '@keyframes tsDrift{from{transform:translateX(-2px)}to{transform:translateX(2px)}} .ts-drift{animation:tsDrift 4s ease-in-out infinite alternate}',
  },
  leaf: {
    label: 'Leaf',
    draw: (p) => `<g class="ts-sway"><path d="M50 8C24 22 12 46 18 72c6 18 22 22 32 22s26-4 32-22C88 46 76 22 50 8z" fill="${p.body}"/>
      <path d="M50 14v80" stroke="${p.vein}" stroke-width="3" opacity=".55"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.46, 50, 58) + '</g>',
    motion: '@keyframes tsSway{from{transform:rotate(-3deg)}to{transform:rotate(3deg)}} .ts-sway{transform-origin:50px 94px;animation:tsSway 3.2s ease-in-out infinite alternate}',
  },
  apple: {
    label: 'Apple',
    draw: (p) => `<path d="M50 30c-12-8-38-6-38 22 0 22 16 42 30 42 4 0 6-2 8-2s4 2 8 2c14 0 30-20 30-42 0-28-26-30-38-22z" fill="${p.body}"/>
      <path d="M50 30c0-8 2-14 6-18" stroke="${p.stem}" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path d="M56 18c8-6 18-2 18 2-6 5-14 4-18-2z" fill="${p.leaf}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.48, 50, 60),
    motion: '',
  },
  snowGlobe: {
    accentAt: [76, 4],
    label: 'Snow globe',
    draw: (p) => `<circle cx="50" cy="44" r="38" fill="${p.glass}" stroke="${p.rim}" stroke-width="4"/>
      <g class="ts-snow">${[[30, 24], [62, 18], [72, 40], [24, 50], [44, 14], [56, 62]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="#fff"/>`).join('')}</g>
      <path d="M22 82h56l-6 14H28z" fill="${p.base}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.46, 50, 46),
    motion: '@keyframes tsSnow{from{transform:translateY(-6px)}to{transform:translateY(6px)}} .ts-snow{animation:tsSnow 3.6s linear infinite alternate}',
  },
  snowman: {
    label: 'Snowman',
    draw: (p) => `<circle cx="50" cy="26" r="16" fill="${p.body}" stroke="${p.edge}" stroke-width="3"/>
      <path d="M36 12h28M42 12V2h16v10" stroke="${p.hat}" stroke-width="5" fill="${p.hat}"/>
      <circle cx="44" cy="24" r="2.4" fill="${p.ink}"/><circle cx="56" cy="24" r="2.4" fill="${p.ink}"/><path d="M50 29l8 2-8 2z" fill="#e8833a"/>
      <circle cx="50" cy="68" r="30" fill="${p.body}" stroke="${p.edge}" stroke-width="3"/>
      <path d="M32 42c6 4 30 4 36 0" stroke="${p.scarf}" stroke-width="7" stroke-linecap="round" fill="none"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.42, 50, 70),
    motion: '',
  },
  mug: {
    accentAt: [80, 6],
    label: 'Mug',
    draw: (p) => `<g class="ts-steam"><path d="M38 20q-6-6 0-12M52 20q-6-6 0-12M66 20q-6-6 0-12" stroke="${p.steam}" stroke-width="4" stroke-linecap="round" fill="none"/></g>
      <path d="M18 28h60v50a14 14 0 0 1-14 14H32a14 14 0 0 1-14-14z" fill="${p.body}"/>
      <path d="M78 40h6a10 10 0 0 1 0 20h-6" stroke="${p.body}" stroke-width="7" fill="none"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.46, 48, 60),
    motion: '@keyframes tsSteam{from{opacity:.25;transform:translateY(3px)}to{opacity:.9;transform:translateY(-2px)}} .ts-steam{animation:tsSteam 2.4s ease-in-out infinite alternate}',
  },
  fish: {
    label: 'Fish',
    draw: (p) => `<g class="ts-swim"><path d="M8 50c14-26 52-30 72 0-20 30-58 26-72 0z" fill="${p.body}"/>
      <path d="M78 50l16-16v32z" fill="${p.fin}"/><circle cx="22" cy="46" r="3" fill="${p.ink}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.36, 48, 52) + '</g>',
    motion: '@keyframes tsSwim{from{transform:translateX(-2px) rotate(-2deg)}to{transform:translateX(2px) rotate(2deg)}} .ts-swim{transform-origin:50px 50px;animation:tsSwim 1.8s ease-in-out infinite alternate}',
  },
  bubble: {
    label: 'Bubble',
    draw: (p) => `<g class="ts-float"><circle cx="50" cy="50" r="42" fill="${p.body}" stroke="${p.edge}" stroke-width="3"/>
      <path d="M26 34a28 28 0 0 1 16-14" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none" opacity=".8"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.56, 50, 52) + '</g>',
    motion: '@keyframes tsFloat{from{transform:translateY(2px)}to{transform:translateY(-3px)}} .ts-float{animation:tsFloat 3s ease-in-out infinite alternate}',
  },
  lifeRing: {
    label: 'Life ring',
    draw: (p) => `<circle cx="50" cy="50" r="40" fill="none" stroke="${p.body}" stroke-width="20"/>
      ${[0, 90, 180, 270].map((a) => `<path d="M50 10v20" stroke="${p.band}" stroke-width="20" transform="rotate(${a + 45} 50 50)"/>`).join('')}
      <circle cx="50" cy="50" r="28" fill="${p.inner}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.4, 50, 50),
    motion: '',
  },
  gear: {
    label: 'Gear',
    draw: (p) => `<g class="ts-spin"><path d="${Array.from({ length: 10 }, (_, i) => { const a = (i * 36) * Math.PI / 180, b = a + 0.32; const pt = (r, t) => `${(50 + r * Math.cos(t)).toFixed(1)} ${(50 + r * Math.sin(t)).toFixed(1)}`; return `M${pt(36, a - 0.12)}L${pt(46, a - 0.06)}L${pt(46, b - 0.06)}L${pt(36, b)}Z`; }).join('')}" fill="${p.teeth}"/>
      <circle cx="50" cy="50" r="38" fill="${p.body}"/></g><circle cx="50" cy="50" r="28" fill="${p.hub}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.42, 50, 50),
    motion: '@keyframes tsSpin{to{transform:rotate(360deg)}} .ts-spin{transform-origin:50px 50px;animation:tsSpin 24s linear infinite}',
  },
  brassPlate: {
    label: 'Brass plate',
    draw: (p) => `<rect x="8" y="8" width="84" height="84" rx="16" fill="${p.body}" stroke="${p.edge}" stroke-width="4"/>
      ${[[18, 18], [82, 18], [18, 82], [82, 82]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="${p.edge}"/>`).join('')}`,
    glyph: (p, w) => glyph(w, p.ink, 0.58, 50, 50),
    motion: '',
  },
  screen: {
    label: 'Neon screen',
    draw: (p) => `<rect x="8" y="14" width="84" height="64" rx="8" fill="${p.body}" stroke="${p.edge}" stroke-width="4"/>
      <path d="M38 88h24M50 78v10" stroke="${p.edge}" stroke-width="5" stroke-linecap="round"/>
      <g class="ts-scan"><rect x="12" y="18" width="76" height="4" fill="${p.ink}" opacity=".18"/></g>`,
    glyph: (p, w) => twoPass(w, p.halo, p.ink, 0.46, 50, 46),
    motion: '@keyframes tsScan{from{transform:translateY(0)}to{transform:translateY(54px)}} .ts-scan{animation:tsScan 3.4s linear infinite} @keyframes tsGlow{from{opacity:.8}to{opacity:1}} .ts-glow{animation:tsGlow 2.2s ease-in-out infinite alternate}',
  },
  hexChip: {
    label: 'Chip',
    draw: (p) => `<path d="M50 6l38 22v44L50 94 12 72V28z" fill="${p.body}" stroke="${p.edge}" stroke-width="4" stroke-linejoin="round"/>
      ${[30, 50, 70].map((y) => `<path d="M2 ${y}h10M88 ${y}h10" stroke="${p.edge}" stroke-width="4" stroke-linecap="round"/>`).join('')}`,
    glyph: (p, w) => glyph(w, p.ink, 0.5, 50, 50),
    motion: '',
  },
  cushion: {
    label: 'Cushion',
    draw: (p) => `<path d="M14 18q36-8 72 0 6 32 0 64-36 8-72 0-6-32 0-64z" fill="${p.body}" stroke="${p.edge}" stroke-width="3"/>
      ${[[14, 18], [86, 18], [14, 82], [86, 82]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${p.edge}"/>`).join('')}`,
    glyph: (p, w) => glyph(w, p.ink, 0.54, 50, 50),
    motion: '',
  },
  frame: {
    label: 'Picture frame',
    draw: (p) => `<rect x="8" y="8" width="84" height="84" rx="6" fill="${p.body}"/><rect x="18" y="18" width="64" height="64" rx="3" fill="${p.inner}"/>`,
    glyph: (p, w) => glyph(w, p.ink, 0.52, 50, 50),
    motion: '',
  },
};


/* ---------- accents ----------
   A small decoration a theme can add to a piece, in a corner the piece leaves free (accentAt), so it
   never covers the glyph. Each is its own thing and reusable. A theme turns them on per piece. */
export const ACCENTS = {
  bat: {
    label: 'Bat',
    /* a dark bat on a dark card needs a rim to be seen: c is the body, rim the edge */
    draw: (c, rim = '#c9a8f0') => `<g transform="scale(1.3)"><g class="ts-flap"><path d="M0 4C3 0 6 1 8 4c1-2 3-2 4 0 2-3 5-4 8 0-2 0-3 2-4 4-1-1-3-1-4 1-1-1-2-2-4-1-1-2-3-2-4-1-1-2-2-4-4-4z" fill="${c}" stroke="${rim}" stroke-width="1.1" stroke-linejoin="round"/></g></g>`,
    size: [20, 9],
    motion: '@keyframes tsFlap{from{transform:scaleY(1)}to{transform:scaleY(.55)}} .ts-flap{transform-box:fill-box;transform-origin:50% 50%;animation:tsFlap .9s ease-in-out infinite alternate}',
  },
  star: {
    label: 'Star',
    draw: (c) => `<g class="ts-twinkle"><path d="M6 0l1.6 4.4L12 6 7.6 7.6 6 12 4.4 7.6 0 6l4.4-1.6z" fill="${c}"/></g>`,
    size: [12, 12],
    motion: '@keyframes tsTwinkle{from{opacity:.4}to{opacity:1}} .ts-twinkle{animation:tsTwinkle 2s ease-in-out infinite alternate}',
  },
  snowflake: {
    label: 'Snowflake',
    draw: (c) => `<g class="ts-twinkle"><path d="M7 0v14M1 3.5l12 7M13 3.5l-12 7" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/></g>`,
    size: [14, 14],
    motion: '@keyframes tsTwinkle{from{opacity:.4}to{opacity:1}} .ts-twinkle{animation:tsTwinkle 2.4s ease-in-out infinite alternate}',
  },
};

/* ---------- the themes ----------
   by: which piece carries each kind of word. palette: per piece. words: per-word choices. */
const H_ART = (w) => ({ art: w });
export const THEMES = {
  halloween: {
    label: 'Halloween',
    by: { A: 'pumpkin', W: 'pumpkin', N: 'pumpkin', P: 'ghost', C: 'cauldron' },
    palette: {
      pumpkin: { body: '#e8832a', rib: '#b8561a', stem: '#5a6b2c', leaf: '#7fa35a', carved: true, carve: '#4a1c06', ink: '#ffe08a', glow: '#ffb84a' },
      ghost: { body: '#f4f1ea', edge: '#c9bfd8', ink: '#4a3870' },
      cauldron: { body: '#2a2236', rim: '#4a3c5c', bubble: '#9cf08a', ink: '#b8f4a8' },
    },
    accents: { cauldron: { id: 'bat', color: '#3a2a5a', rim: '#c9a8f0' }, ghost: { id: 'bat', color: '#3a2a5a', rim: '#c9a8f0' } },
    words: { pumpkin: H_ART('pumpkin'), ghost: H_ART('ghost'), bat: H_ART('bat'), candy: H_ART('candy'), witchHat: H_ART('witchHat'), treatPail: H_ART('treatPail') },
  },
  night: {
    label: 'Night',
    by: { A: 'lantern', W: 'lantern', N: 'lantern', P: 'moon', C: 'cloud' },
    palette: {
      lantern: { frame: '#2a3450', glass: '#ffd98a', ink: '#2a2010' },
      moon: { body: '#f2ecd2', crater: '#c9c0a0', ink: '#1b2a4a' },
      cloud: { body: '#c9d4e8', edge: '#8fa0c0', ink: '#1b2a4a' },
    },
    accents: { lantern: { id: 'star', color: '#ffe08a' }, moon: { id: 'star', color: '#ffe08a' } },
  },
  fall: {
    label: 'Fall',
    by: { A: 'leaf', W: 'apple', N: 'leaf', P: 'apple', C: 'pumpkin' },
    palette: {
      leaf: { body: '#a8541a', vein: '#6a3010', ink: '#fff4e0' },
      apple: { body: '#b8322a', stem: '#5a3a1a', leaf: '#6a8a3a', ink: '#fff4e0' },
      pumpkin: { body: '#e0902e', rib: '#b8641e', stem: '#5a4a2a', leaf: '#6a8a3a', ink: '#3a1a08' },
    },
  },
  winter: {
    label: 'Winter',
    by: { A: 'snowGlobe', W: 'snowGlobe', N: 'snowGlobe', P: 'snowman', C: 'mug' },
    palette: {
      snowGlobe: { glass: '#cfe4f2', rim: '#8fb0c8', base: '#9e4a3a', ink: '#1b2a40' },
      snowman: { body: '#f6f9fb', edge: '#a9bccb', hat: '#26303f', scarf: '#c9483b', ink: '#1b2a40' },
      mug: { body: '#c9483b', steam: '#eef3f6', ink: '#fff4ec' },
    },
    accents: { mug: { id: 'snowflake', color: '#eef3f6' }, snowGlobe: { id: 'snowflake', color: '#eef3f6' } },
  },
  ocean: {
    label: 'Ocean',
    by: { A: 'fish', W: 'fish', N: 'bubble', P: 'bubble', C: 'lifeRing' },
    palette: {
      fish: { body: '#f0b24a', fin: '#e07a3a', ink: '#0e3242' },
      bubble: { body: '#bfeaf4', edge: '#7fc6d8', ink: '#0e3242' },
      lifeRing: { body: '#f4f1e8', band: '#e05a4a', inner: '#0e3242', ink: '#f4f1e8' },
    },
  },
  steampunk: {
    label: 'Steampunk',
    by: { A: 'gear', W: 'gear', N: 'brassPlate', P: 'brassPlate', C: 'lantern' },
    palette: {
      gear: { teeth: '#8a5a2a', body: '#b8803a', hub: '#f2dcae', ink: '#3a2414' },
      brassPlate: { body: '#d9a85a', edge: '#7a4f24', ink: '#2b1d14' },
      lantern: { frame: '#5a3a24', glass: '#f2cf6a', ink: '#2b1d14' },
    },
  },
  cyberpunk: {
    label: 'Cyberpunk',
    by: { A: 'screen', W: 'screen', N: 'screen', P: 'hexChip', C: 'hexChip' },
    palette: {
      screen: { body: '#10141a', edge: '#766da7', halo: '#3a2e6a', ink: '#9ff0d8' },
      hexChip: { body: '#1b2026', edge: '#7a9663', ink: '#e8f0d8' },
    },
  },
  cozy: {
    label: 'Cozy',
    by: { A: 'frame', W: 'cushion', N: 'frame', P: 'cushion', C: 'mug' },
    palette: {
      frame: { body: '#a87a4a', inner: '#fbf6ec', ink: '#2f3a33' },
      cushion: { body: '#e8c9a8', edge: '#a8805a', ink: '#2f3a33' },
      mug: { body: '#6f8676', steam: '#a8b4ac', ink: '#ffffff' },
    },
  },
};
export const THEME_SET_IDS = Object.keys(THEMES);

export function symbolSvg(word, theme, { animated = false, accents = true } = {}) {
  const t = THEMES[theme];
  if (!t) return '';
  const choice = (t.words && t.words[word]) || {};
  if (choice.art && THEMED_ART[choice.art]) return THEMED_ART[choice.art];
  const id = choice.piece || t.by[ROLES[word] || 'A'];
  const piece = PIECES[id], pal = t.palette[id];
  if (!piece || !pal || !GLYPHS[word]) return '';
  const a = accents && t.accents && t.accents[id], acc = a && ACCENTS[a.id] && piece.accentAt ? ACCENTS[a.id] : null;
  const css = [piece.motion, acc && acc.motion].filter(Boolean).join(' ');
  const motion = animated && css ? `<style>@media (prefers-reduced-motion: no-preference){${css}}</style>` : '';
  const accent = acc ? `<g transform="translate(${piece.accentAt[0]} ${piece.accentAt[1]})">${acc.draw(a.color, a.rim)}</g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true">${motion}${piece.draw(pal, word)}${piece.glyph(pal, word)}${accent}</svg>`;
}
