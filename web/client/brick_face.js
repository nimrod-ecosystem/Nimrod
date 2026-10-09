// brick_face.js — THE NIMROD BRICK, DRAWN FLAT, FOR THE GAMES (brick games, 2026-10-09).
//
// Mike, 2026-10-09: "I think the Brick Breaker game should be made of Nimrod bricks and you can have it follow
// your theme. Maybe a Tetris with our bricks." (Row 2.76.) Both brick games draw the same brick, so it is drawn
// here, once, and each game puts the classes on its own elements.
//
// *** WHAT IS DRAWN: THE FRONT FACE OF THE PRINTED BRICK. *** The published brick (design-assets/bricks,
// bricks.json: "every brick is W x D x H in multiples of 40 mm, with a 10 mm socket at the centre of every 40 mm
// cell on every face") seen straight on: a block with ONE ROUND SOCKET PER 40 MM CELL, each socket keyed by two
// small slots either side (the render, renders/brick_40x40x40_v1.png). No studs: ours is a socket brick, and a
// stud brick is somebody else's look. A 1x3 brick is one block with three sockets; two bricks side by side are two
// blocks with a seam between them, so a piece made of two bricks reads as two bricks.
//   FOR drawing it rather than using the 40 mm render: the render is a three-quarter view, which does not tile into a
//   wall or a grid, and a picture cannot take the theme's colour without the multiply-and-mask trick brick_builds.js
//   uses (fine for one piece of furniture, a lot of layers for a wall of fifty bricks on a Pi). A flat face is a few
//   CSS gradients, takes any colour, and stays legible at the size a game draws a brick (often 30 px).
//   AGAINST: it is a drawing of the brick, not the brick. The socket and its two slots are what make it ours, and
//   they are drawn from the render's own proportions (below).
//
// *** THE COLOURS ARE THE THEME'S. *** A brick's colour is `--nb-c`. The palette a game picks from is `--nb-1` ..
// `--nb-5`, declared on `.nb-bricks` (a game's root), each one the THEME'S BRICK COLOUR first and a theme role second:
//     --nb-N: var(--brick-N, <a theme role>)
// `--brick-1` .. `--brick-5` are each theme's five brick colours (brick_colours.js, put on the page by theme.js, chosen
// and measured there to read against the theme's surfaces and to be told apart, red-green colour blindness included).
// The variable names come from brick_colours.js itself (`brickColourVar`), so there is one name. The fallbacks (the
// theme's accent, link and warm colours) are for a page that has not applied a theme at all - a preview, a test.
// A room or a scene can still set one colour for everything (brick breaker's `--wall-brick`).
//
// *** THE PROPORTIONS, ARGUED CONSTANTS (not settings - nobody's play changes with them): ***
//   socket   a hole 36% of the cell across (the real one is 25%: 10 mm in 40). Drawn larger on purpose - at 30 px a
//            true-scale socket is 7 px, a dot; at 36% it reads as a hole. The rim around it is the next 10%.
//   slots    each side of the hole, together 52% of the cell across and 10% high: the render's keyed socket.
//   bevel    a 2 px light edge top-left and a dark one bottom-right, so a brick reads as a block, not a tile.

import { BRICK_COLOUR_COUNT, brickColourVar } from './brick_colours.js';

export const PALETTE_SIZE = BRICK_COLOUR_COUNT;
/** The theme's brick colours this file reads (`--brick-1` .. `--brick-5`, brick_colours.js). */
export const THEME_BRICK_PROPS = Object.freeze(Array.from({ length: PALETTE_SIZE }, (_, i) => brickColourVar(i)));
// Where a page has applied no theme: the theme's own roles, in the order brick_colours.js starts its sets from.
const FALLBACKS = ['var(--accent, #839958)', 'var(--link, #105666)', 'var(--accent-warm, #D3968C)',
  'var(--accent-warm-deep, #a85f52)', 'var(--text-soft, #3c5346)'];

/** The palette entry for a colour index (0-based, wrapping): `var(--nb-1)` .. `var(--nb-5)`. */
export const paletteVar = (i) => `var(--nb-${1 + (((Math.round(Number(i)) || 0) % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE})`;

/** How many 40 mm cells a brick `w` long and `h` high is: the nearest whole number, at least one. */
export function cellsAlong(w, h) {
  const a = Number(w), b = Number(h);
  if (!(a > 0) || !(b > 0)) return 1;
  return Math.max(1, Math.round(a / b));
}

// The face. Two background layers, tiled once per cell along the brick: the slots (an ellipse) over the socket
// (a disc with a rim). `--nb-cells` is the cell count; `data-dir="v"` tiles them down instead of across.
export const BRICK_FACE_CSS = `
.nb-bricks{
${THEME_BRICK_PROPS.map((p, i) => `  --nb-${i + 1}: var(${p}, ${FALLBACKS[i] || FALLBACKS[0]});`).join('\n')}
}
.nb-face{
  --nb-hole: color-mix(in srgb, var(--nb-c, var(--nb-1)) 42%, black);
  --nb-rim: color-mix(in srgb, var(--nb-c, var(--nb-1)) 72%, black);
  --nb-lit: color-mix(in srgb, var(--nb-c, var(--nb-1)) 60%, white);
  --nb-dark: color-mix(in srgb, var(--nb-c, var(--nb-1)) 62%, black);
  box-sizing:border-box;
  background-color: var(--nb-c, var(--nb-1));
  background-image:
    radial-gradient(26% 5% at 50% 50%, var(--nb-hole) 90%, transparent 100%),
    radial-gradient(circle closest-side at 50% 50%, var(--nb-hole) 0 36%, var(--nb-rim) 38% 46%, transparent 48%);
  background-size: calc(100% / var(--nb-cells, 1)) 100%;
  background-repeat: repeat-x;
  background-position: 0 0;
  border: 1px solid var(--nb-dark);
  border-radius: 3px;
  box-shadow: inset 2px 2px 0 var(--nb-lit), inset -2px -2px 0 var(--nb-dark);
}
.nb-face[data-dir="v"]{background-size: 100% calc(100% / var(--nb-cells, 1)); background-repeat: repeat-y}
.nb-face[data-c="0"]{--nb-c: var(--nb-1)}
.nb-face[data-c="1"]{--nb-c: var(--nb-2)}
.nb-face[data-c="2"]{--nb-c: var(--nb-3)}
.nb-face[data-c="3"]{--nb-c: var(--nb-4)}
.nb-face[data-c="4"]{--nb-c: var(--nb-5)}
`;

const STYLE_ID = 'nimrod-brick-face-style';
/** Put the face's style into a document once (the game_start.js shape). */
export function ensureBrickFaceStyle(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = BRICK_FACE_CSS;
  (doc.head || doc.documentElement).append(el);
}
