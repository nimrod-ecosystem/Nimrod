// layers.js — the depth scale, for the code that builds elements in JS.
//
// `layers.css` is the SOURCE OF TRUTH for anything written in a stylesheet, and it is static so
// there is no frame where a panel has no depth. This module is the same scale for JS that sets
// `style.zIndex` directly — the cursor, the press overlay, an ambient thing in flight.
//
// *** THE TWO COPIES ARE CHECKED AGAINST EACH OTHER. *** `dev/layers_test.html` reads the CSS
// file and asserts every band matches this object. Two sources of truth for one decision is
// exactly the shape that drifts, and the whole point of this file is to end drift; the check is
// what makes the duplication safe rather than a second opinion waiting to happen.
//
// Read the scale, and the one deliberate exception to it, in `layers.css`.

export const LAYERS = Object.freeze({
  world: 0,             // the live wallpaper; the back of the screen
  ambient: 100,         // drifting things, BETWEEN the world and the panels
  panels: 200,          // a module's own box
  panelContents: 300,   // what a module draws inside its box
  floating: 400,        // things in flight IN FRONT of panels
  transport: 500,       // the control bar
  menus: 600,           // the settings menu and anything modal
  cursor: 700,          // the pointer, drawn over what it points at
});

// The CSS variable name for a band, so JS that writes a style string can hand the browser the
// variable rather than a number — which keeps a theme or a future override in one place.
export const zVar = (band) => `var(--z-${String(band).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())})`;

/**
 * A depth WITHIN a band.
 *
 * The bands are 100 apart precisely so a module can order its own parts without inventing a
 * band: a gear above its own settings sheet is `within('panelContents', 10)`, and neither of
 * them has to know what a panel or a menu is worth.
 *
 * Bounded at 99 because 100 is the next band, and a module that silently lands in it would be
 * drawing itself over things it does not own — which is the failure this whole file exists to
 * prevent, arriving through the back door.
 */
export function within(band, offset = 0) {
  const base = LAYERS[band];
  if (base === undefined) throw new Error(`layers: no band named "${band}"`);
  const n = Math.trunc(Number(offset) || 0);
  if (n < 0 || n > 99) throw new Error(`layers: offset ${offset} leaves the "${band}" band`);
  return base + n;
}
