// brick_colours.js — THE BRICK COLOURS OF EACH THEME (row 2.76; Mike, 2026-10-09: "there should be brick colors
// to match each theme").
//
// Five colours a theme, named, for anything drawn as a Nimrod brick: the Bricks panel (modules/bricks.js), and
// for whoever else wants them (play_objects' stack, Brick breaker, a falling-bricks game) -- they are EXPORTED, and
// theme.js puts them on the page as `--brick-1` .. `--brick-5`, so a drawing that says `var(--brick-2)` follows the
// theme the way every other colour on the site does (a panel wearing its own theme included).
//
// *** HOW THEY WERE CHOSEN (argued; numbers measured by dev/bricks_module_test.html on every run). ***
//   LOOK LIKE THE THEME: each set starts from the theme's own palette -- its accent first, then its link, its warm
//   accents and (live themes) Design's board symbol colours, which were drawn for that world -- and only reaches for
//   a hue outside it where the theme's own could not be told apart (Denim in Harvest: overalls, and the one blue a
//   red-brown-gold barn palette can be read against under red-green colour blindness).
//   READ AS SHAPES: every colour clears 3:1 (WCAG 1.4.11, a graphical object) against the theme's --bg, --surface and
//   --surface-alt, with normal vision AND simulated deuteranopia (theme.js `contrast`, Machado 2009) -- and so do
//   the two shaded faces the drawn brick puts beside it (BRICK_SHADES: 12% and 24% black over the colour), since
//   on a dark theme the darker face is the one that would fade into the page.
//   TOLD APART: every two colours in a set are at least BRICK_MIN_DE (CIEDE2000) apart, with normal vision AND under
//   simulated deuteranopia. Where a theme's own colour failed, it was moved lighter or darker (never to another hue)
//   by the least that passed -- which is why some are a shade off the theme's token (default's Moss is darker
//   than its accent: at the accent's own lightness it sat 6.6 from Rose once red-green was taken away).
//
// *** THE CASE FOR THE OPPOSITE, said: *** ΔE 10 is a judgement ("clearly different at a glance" in the usual
// reading of CIEDE2000; 2-3 is "just noticeable side by side"). A higher floor gives fewer, starker colours; a lower
// one lets more of each theme's exact tokens through. And five is a count, not a law: four would pass everywhere with
// more room, six would fail several dark themes. Both numbers are below, one line each.
//
// No imports on purpose: theme.js imports this file to put the colours on the page, and a file theme.js depends on
// must not depend on theme.js back (the measuring lives in the suite, which may import both).

export const BRICK_COLOUR_COUNT = 5;
/** The floor two colours of one set are held to, CIEDE2000, normal vision and deuteranopia both. */
export const BRICK_MIN_DE = 10;
/** The drawn brick's three faces: top, the left side, the right side -- black laid over the colour at these. */
export const BRICK_SHADES = Object.freeze([0, 0.12, 0.24]);

const c = (name, hex) => Object.freeze({ name, hex });
export const BRICK_COLOURS = Object.freeze({
  default: [c('Moss', '#4f5c35'), c('Teal', '#105666'), c('Rose', '#a85f52'), c('Gold', '#a78328'), c('Forest', '#0a3323')],
  dusk: [c('Moss', '#8fae63'), c('Sky', '#b1dce5'), c('Rose', '#e2beb7'), c('Sand', '#e3cc90'), c('Lilac', '#b6a3d9')],
  contrast: [c('Blue', '#005a9e'), c('Magenta', '#b70d62'), c('Black', '#1a1a1a'), c('Gold', '#8a6d00'), c('Green', '#1a6b2a')],
  warm: [c('Amber', '#b6743b'), c('Brick red', '#752c20'), c('Olive', '#6f6a2a'), c('Plum', '#7d4560'), c('Brown', '#3a2417')],
  forge: [c('Deep teal', '#0a3235'), c('Amber', '#b5651d'), c('Navy', '#1f3f63'), c('Slate', '#547075'), c('Maroon', '#7a2a2a')],
  fall: [c('Wheat', '#e8d6b3'), c('Mist', '#b1c3d1'), c('Pumpkin', '#e1a172'), c('Cream', '#f2e8e5'), c('Lavender', '#afa4e8')],
  steampunk: [c('Brass', '#f2cf2a'), c('Ivory', '#f5e3db'), c('Copper', '#e8a87c'), c('Silver', '#d8e4e9'), c('Verdigris', '#8fc8b8')],
  cyberpunk: [c('Green', '#87a073'), c('Ice', '#d8e4ed'), c('Pink', '#d6a0b8'), c('Yellow', '#e0d39a'), c('Violet', '#b3a8d9')],
  cozy: [c('Moss', '#49622e'), c('Teal', '#14636a'), c('Rose', '#a8655b'), c('Walnut', '#452d09'), c('Berry', '#752641')],
  winter: [c('Snow', '#f9fafc'), c('Ice', '#bfe0ee'), c('Dusty pink', '#c5a3a7'), c('Straw', '#e8d6a0'), c('Mint', '#bfe0c4')],
  ocean: [c('Seafoam', '#d3f2e2'), c('Aqua', '#8fd3e3'), c('Coral', '#e4afa7'), c('Sand', '#f0dca0'), c('Reef blue', '#7fb0f0')],
  night: [c('Steel', '#8198aa'), c('Ice', '#e6f3f9'), c('Rose', '#e8bcc0'), c('Moon', '#e8dca8'), c('Orchid', '#dcb4dc')],
  spring: [c('Leaf', '#3a5c2c'), c('Teal', '#2f6d6a'), c('Rose', '#ad6e64'), c('Ochre', '#8a5a12'), c('Berry', '#a13d5f')],
  summer: [c('Lake', '#377a80'), c('Navy', '#0f5a7a'), c('Driftwood', '#5a3b0c'), c('Brick', '#a0461b'), c('Pine', '#2c6e49')],
  newYear: [c('Gold', '#d9b34a'), c('Steel blue', '#7baaba'), c('Pink', '#e8bcc0'), c('Silver', '#c0c4d0'), c('Champagne', '#e8d6a0')],
  lunarNewYear: [c('Red', '#dc7875'), c('Gold', '#ffc457'), c('Dusty pink', '#ba969a'), c('Jade', '#bfe0c4'), c('Sky', '#bfe0ee')],
  valentines: [c('Wine', '#4e1a2c'), c('Rose', '#9e5449'), c('Plum', '#6a3a6a'), c('Pink', '#b5607c'), c('Berry', '#8a2a4a')],
  stPatricks: [c('Shamrock', '#568b6d'), c('Teal', '#1f6a52'), c('Gold', '#8a5a12'), c('Chestnut', '#572e28'), c('Sea', '#14636a')],
  easter: [c('Violet', '#887bb9'), c('Blue', '#3e6a8a'), c('Leaf', '#3a5c2c'), c('Rose', '#a8655b'), c('Ochre', '#8a5a12')],
  july4: [c('Red', '#dc8880'), c('Blue', '#8ab8ff'), c('Silver', '#d0d4e0'), c('Gold', '#e8d6a0'), c('Mint', '#cce6d0')],
  halloween: [c('Pumpkin', '#f2a03c'), c('Violet', '#c9a8f0'), c('Bone', '#aea078'), c('Slime', '#bfe0a0'), c('Rose', '#e8bcc0')],
  diwali: [c('Saffron', '#e8833a'), c('Mauve', '#b593ae'), c('Gold', '#ffc457'), c('Teal', '#9fd4d0'), c('Pearl', '#f8ebec')],
  harvest: [c('Chestnut', '#6a3a12'), c('Barn red', '#b16155'), c('Hay', '#836511'), c('Denim', '#3e5a8a'), c('Bark', '#3a2414')],
  hanukkah: [c('Blue', '#89a9e0'), c('Gold', '#ffd36e'), c('Pewter', '#a1aab1'), c('Sky', '#bfe0ee'), c('Rose', '#e8bcc0')],
  christmas: [c('Red', '#df9189'), c('Pine', '#b2ddc0'), c('Gold', '#f2c94c'), c('Snow', '#e0e6ee'), c('Blue', '#8ab0e8')],
});

/** The CSS variable for brick colour `i` (0-based): '--brick-1' .. '--brick-5'. */
export const brickColourVar = (i) => `--brick-${(Number(i) | 0) + 1}`;
/** `var(--brick-N)` for colour `i` (0-based), clamped to the set: what a drawing puts in its fill. */
export const brickColourCss = (i) => `var(${brickColourVar(Math.max(0, Math.min(BRICK_COLOUR_COUNT - 1, Number(i) | 0)))})`;

/** A theme's set, or the default theme's for an id with none of its own (a theme added before its bricks were). */
export function brickColoursFor(themeId) {
  return Object.prototype.hasOwnProperty.call(BRICK_COLOURS, themeId) ? BRICK_COLOURS[themeId] : BRICK_COLOURS.default;
}

/** The set as CSS variables, for theme.js to put beside the theme's own: { '--brick-1': '#...', ... }. */
export function brickVars(themeId) {
  const out = {};
  brickColoursFor(themeId).forEach((col, i) => { out[brickColourVar(i)] = col.hex; });
  return out;
}
