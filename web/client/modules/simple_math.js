// simple_math.js — THE OLD "SIMPLE MATH" PANEL, KEPT SO A SCREEN THAT HAS ONE KEEPS WORKING (row 2.45).
//
// Mike, 2026-10-01: *"The simple math isn't a separate game... the math module should have some
// questions for absolute beginners."* The game itself now lives in `../math_beginner.js` and is Math's
// Beginner level (`algebra.js`). This file only REGISTERS the `simple_math` type, for the panels that
// already exist: same game, same saved settings (the keys did not change), the same `simple_math/*`
// verbs and score source, and its sums stay FIXED where somebody set them (`mathLevel: 'fixed'`;
// the adaptive ladder is one setting away). Why this rather than rewriting saved screens to Math:
// `../math_beginner.js`'s header.
//
// It is no longer OFFERED: a page that should not offer it simply does not import this file (the
// composer, the parts page); the kiosk keeps importing it so an old screen still mounts.

import { registerModule } from '../module.js';
import { GAME, beginnerMath, beginnerSettings } from '../math_beginner.js';

export {
  GAME, LINES, DEFAULTS, OPS, MATH_LEVELS, MATH_LEVEL_MODES, RATING_GAME, makeProblems, padBoard, mathBank,
  mathAdapter, mathView, beginnerSettings, beginnerMath,
} from '../math_beginner.js';

// Read by a host that lists modules to ADD: this one is not offered any more (see the header).
export const FOLDED_INTO = 'algebra';

registerModule(
  { type: GAME, title: 'Simple math', core: 'new',
    description: 'Counting, plus, minus and times on small numbers. Now the Beginner level of Math; '
      + 'kept so a screen that already has this panel keeps working.',
    dependsOn: 'local', importance: 'optional', foldedInto: FOLDED_INTO,
    settings: beginnerSettings({ levelDefault: 'fixed' }) },
  beginnerMath({ type: GAME }),
);
