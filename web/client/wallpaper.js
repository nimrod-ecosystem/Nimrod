// wallpaper.js — AMBIENT CONTENT FOR A SCREEN THAT IS WAITING.
//
// Mike, 2026-08-30: *"a held screen shows the live wallpaper."* Today it shows a frozen
// frame and a ⏸ chip. A stopped picture of a face reads as a broken screen, and this one
// sits in a room for hours.
//
// This file is the CONTENT half — the pure parts, testable without a canvas. The module
// wrapper is `modules/wallpaper.js`; the container that raises it over a held segment is
// `director.js`. Splitting it that way is the same reason `bank.js` and `bank_panel.js` are
// separate: the thing worth testing here is a safety property, and a safety property tested
// through a DOM is a safety property nobody re-runs.
//
// ---------------------------------------------------------------------------------------
// *** THE ONE THING THIS FILE HAS TO GET RIGHT: IT MUST NOT FLASH. ***
// ---------------------------------------------------------------------------------------
//
// Of everything in this codebase, a full-screen animation that runs unattended for hours in
// front of somebody with a brain injury is where photosensitivity actually bites.
// `pressgame.js` already carries a floor for this (`SAFETY_FLOOR_MS = 1500`, "full-screen
// cycling stays well under flash rates"). A wallpaper needs a stronger one, and — more
// usefully — needs it in a form a test can check rather than a comment claiming it.
//
// So the built-in ambient is a PURE FUNCTION OF TIME. `ambientFrame(t)` returns a
// description of the frame, including its mean luminance, and a test samples it across a
// full cycle and asserts the rate of change. The renderer is then a dumb consumer of that
// description and cannot introduce a rate the test did not see.
//
//   MAX_LUM_RATE  the ceiling the frames must stay under: 2% of full scale per second.
//                 The clinical threshold people design against is 3 Hz of substantial
//                 luminance change; this is roughly three orders of magnitude below it,
//                 which is the margin you want for something nobody is supervising.
//
// The rate is measured PER STOP, not on the frame average — see `peakLumRate`, where the
// first version of this measured the average, reported zero for every setting, and looked
// green while checking nothing.
//
// *** WHAT THIS CANNOT CHECK, said plainly. *** A stop's `l` is a lightness in a CSS colour.
// It is not a photometric measurement, it knows nothing about the display, and it
// says nothing whatever about a VIDEO the person supplied — a user's own clip can flash
// however it likes and no code here can see it. That is the actual reason the motion ladder
// below governs whether video is used at all, rather than a preference about taste.
//
// ---------------------------------------------------------------------------------------
// MOTION IS THE PERSON'S, NOT THE MODULE'S
// ---------------------------------------------------------------------------------------
//
// Three settings, cycling in one direction because that is what one switch can do:
//
//   gentle  the default. A slow drift; a full brightness cycle takes 90 seconds.
//   calm    slower and shallower. What the system's `prefers-reduced-motion` asks for.
//   still   no animation at all. One frame, held.
//
// The system preference is kept SEPARATE from the saved setting, the way `comet.js` and
// `pond.js` already keep them apart: folding the machine's request into the person's choice
// makes the settings row lie — it would read "gentle" while the screen ran calm, and whoever
// changed it would see nothing happen.
//
// ---------------------------------------------------------------------------------------
// WHETHER TO PLAY SOMEBODY'S VIDEO — a DEFAULT, and here is who wants the opposite
// ---------------------------------------------------------------------------------------
//
// `allowVideo: 'auto'` plays video only at `gentle`, because nothing here can see what is
// inside a clip and a reduced-motion request is a request about motion.
//
// **The person who wants the opposite is easy to name and their want is legitimate:**
// somebody whose wallpaper is a fireplace or an aquarium, who turned reduced-motion on for
// UI animation and did not mean "never show me moving pictures". Withholding the one thing
// they set this up for, on their behalf, would be the smaller product. So `always` and
// `never` are both there, `auto` is only the default, and none of this is a rule.
//
// ---------------------------------------------------------------------------------------
// SILENT, AND THE REASON IS A BUILD FACT RATHER THAN A PRINCIPLE
// ---------------------------------------------------------------------------------------
//
// Video is muted and there is no unmute. Not because a wallpaper with sound is wrong — an
// aquarium with bubbling is a reasonable thing to want — but because `director.js` does not
// hand `audio` down to its children (it says so in its own comment), so anything sounding
// here would play over a game's music with nothing to arbitrate it. When the container
// carries the arbiter down, this becomes a setting. Recorded so it reads as unfinished
// rather than as decided.

import { pick } from './rng.js';

export const MOTIONS = ['gentle', 'calm', 'still'];

// The ceiling the built-in ambient must stay under, in units of mean lightness per second.
export const MAX_LUM_RATE = 0.02;

// Per-motion drift. `cycleMs` is a FULL brightness cycle; `amp` is how far lightness moves
// either side of `base`. The rate a sinusoid reaches is `amp * 2π / cycleMs`, so these two
// numbers are what MAX_LUM_RATE is a statement about — change either and re-run the suite.
const DRIFT = {
  gentle: { cycleMs:  90000, amp: 0.080, spinMs: 1200000, hueSwing: 20, hueMs: 300000 },
  calm:   { cycleMs: 240000, amp: 0.040, spinMs: 2400000, hueSwing: 10, hueMs: 600000 },
  still:  { cycleMs:      0, amp: 0,     spinMs:       0, hueSwing:  0, hueMs:      0 },
};

export function motionOf(saved, systemReducedMotion) {
  const m = MOTIONS.includes(saved) ? saved : 'gentle';
  // The machine can only ever ask for LESS motion than the person chose, never more.
  if (systemReducedMotion && m === 'gentle') return 'calm';
  return m;
}

/**
 * One frame of the built-in ambient, as data.
 *
 * Pure: same `tMs` in, same frame out, no clock and no canvas. `hueBase` comes from the
 * theme so the wallpaper is not a second palette competing with the one the profile chose.
 *
 * Returns `{ angleDeg, stops: [{ pos, h, s, l }], lum }`. `lum` is the mean lightness of the
 * stops — the WHOLE SCREEN's brightness, which the 120°-apart phases hold essentially still
 * on purpose. It is NOT the flash-rate check; see `peakLumRate`, which measures each stop.
 */
export function ambientFrame(tMs = 0, { motion = 'gentle', hueBase = 210, base = 0.32 } = {}) {
  const d = DRIFT[MOTIONS.includes(motion) ? motion : 'gentle'];
  const t = Number.isFinite(tMs) ? tMs : 0;

  const hueW = d.hueMs ? Math.sin((2 * Math.PI * t) / d.hueMs) : 0;
  const angleDeg = d.spinMs ? ((t / d.spinMs) * 360) % 360 : 35;
  const h = (hueBase + hueW * d.hueSwing + 360) % 360;

  // Three stops, a third of a cycle apart. That spacing is the design: the gradient has depth
  // and visibly shifts, while the three lightnesses sum to a constant — so the amount of light
  // leaving the screen does not change, only where it is. The gentlest thing a full-screen
  // animation can do in a room somebody is trying to rest in.
  const stops = [0, 1 / 3, 2 / 3].map((phase, i) => {
    const w = d.cycleMs ? Math.sin((2 * Math.PI * (t / d.cycleMs + phase))) : 0;
    return {
      pos: i / 2,
      h: (h + i * 12) % 360,
      s: 0.34,
      l: Math.min(0.62, Math.max(0.06, base + w * d.amp)),
    };
  });

  return { angleDeg, stops, lum: stops.reduce((a, s) => a + s.l, 0) / stops.length };
}

/** The CSS a frame draws as. Kept next to the frame so nothing else invents a second one. */
export function frameToCss(frame) {
  const stops = frame.stops
    .map((s) => `hsl(${s.h.toFixed(1)} ${(s.s * 100).toFixed(0)}% ${(s.l * 100).toFixed(1)}%) ${(s.pos * 100).toFixed(0)}%`)
    .join(', ');
  return `linear-gradient(${frame.angleDeg.toFixed(1)}deg, ${stops})`;
}

/**
 * The fastest luminance change the ambient reaches, per second, sampled across a full cycle.
 *
 * This is the check itself rather than a claim about the check: the suite calls it and
 * compares against MAX_LUM_RATE, so changing a number in DRIFT cannot quietly raise the flash
 * rate without the suite noticing.
 *
 * *** IT MEASURES EACH STOP, NOT THE FRAME AVERAGE, AND THAT DISTINCTION IS THE WHOLE POINT.
 * *** The first version of this measured `frame.lum`, and reported ZERO for every motion —
 * which read as "perfectly safe" and was actually "measuring nothing". The three stops sit a
 * third of a cycle apart, so their mean is constant by construction and cancels exactly the
 * signal the check exists to find. The suite caught it only because `calm` was asserted to
 * move LESS than `gentle` and 0 < 0 is false; without that one relational check a vacuous
 * safety measurement would have shipped looking green.
 *
 * A person is not looking at the average of the screen. They are looking at a REGION, and a
 * region is one stop. So: the worst rate any single stop reaches.
 */
export function peakLumRate(motion = 'gentle', { stepMs = 250, spanMs = null } = {}) {
  const d = DRIFT[MOTIONS.includes(motion) ? motion : 'gentle'];
  const span = spanMs != null ? spanMs : (d.cycleMs || 1000);
  let worst = 0;
  let prev = ambientFrame(0, { motion }).stops.map((x) => x.l);
  for (let t = stepMs; t <= span; t += stepMs) {
    const cur = ambientFrame(t, { motion }).stops.map((x) => x.l);
    for (let i = 0; i < cur.length; i++) {
      worst = Math.max(worst, Math.abs(cur[i] - prev[i]) / (stepMs / 1000));
    }
    prev = cur;
  }
  return worst;
}

/**
 * How much the WHOLE SCREEN's average brightness moves, per second.
 *
 * The 120°-apart stops make this ~0 by construction, and that is a property worth keeping
 * rather than an accident: the gradient shifts across the screen while the total light coming
 * off it stays put, which is the gentlest thing a full-screen animation can do in a room
 * somebody is trying to rest in. Kept as its own function so the suite can assert it, because
 * the moment it stops being true nobody would notice by looking.
 */
export function meanLumRate(motion = 'gentle', { stepMs = 250, spanMs = null } = {}) {
  const d = DRIFT[MOTIONS.includes(motion) ? motion : 'gentle'];
  const span = spanMs != null ? spanMs : (d.cycleMs || 1000);
  let worst = 0;
  let prev = ambientFrame(0, { motion }).lum;
  for (let t = stepMs; t <= span; t += stepMs) {
    const lum = ambientFrame(t, { motion }).lum;
    worst = Math.max(worst, Math.abs(lum - prev) / (stepMs / 1000));
    prev = lum;
  }
  return worst;
}

// ---------------------------------------------------------------------------------------
// WHAT TO SHOW, WHEN SOMEBODY HAS GIVEN US A FOLDER
// ---------------------------------------------------------------------------------------

export const VIDEO_POLICIES = ['auto', 'always', 'never'];

/** Whether a video item may be used, given the motion in force and the person's setting. */
export function videoAllowed(policy, motion) {
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  return motion === 'gentle';            // 'auto' — see the header
}

/**
 * The items a wallpaper may draw from, filtered by what the motion setting permits.
 *
 * A listing from the media agent classifies by extension into `image` / `video` (see
 * `media_sources.js`); anything else is not wallpaper material and is dropped rather than
 * rendered as a broken box.
 */
export function usableItems(items, { policy = 'auto', motion = 'gentle' } = {}) {
  const ok = videoAllowed(policy, motion);
  return (items || []).filter((it) => it && (it.kind === 'image' || (ok && it.kind === 'video')));
}

/**
 * The next thing to show. Same weighted picker photos and personal use, for the same reason:
 * a wallpaper that showed the same four images in the same order for six hours is a
 * different kind of frozen frame.
 */
export function nextItem(items, { stats = {}, recent = [], rand = Math.random, now = 0 } = {}) {
  const ids = (items || []).map((it) => it.id);
  if (!ids.length) return null;
  const id = pick(ids, stats, { rand, recent, now });
  return items.find((it) => it.id === id) || null;
}

/**
 * What the module should be doing right now, as one value.
 *
 * `'ambient'` when there is nothing to draw from, which is the case a bedside screen is
 * actually in on day one — nobody has configured a wallpaper folder, and the frozen frame
 * this exists to replace is still there unless the fallback needs no files at all. That is
 * why the built-in is generative and not a bundled video.
 */
export function wallpaperMode(items, { policy = 'auto', motion = 'gentle' } = {}) {
  return usableItems(items, { policy, motion }).length ? 'media' : 'ambient';
}
