// theme.js — per-PROFILE themes (DECISIONS.md "Themes are per-PROFILE"). A theme
// is a render setting, not content: it lives on the profile and the renderer reads
// it, exactly the content-as-meaning split (content carries no styling; swapping a
// profile's theme re-renders everything for free).
//
// HOW IT WORKS — one trick, no per-module work. Every module already draws through
// a small set of CSS custom properties (--bg, --text, --surface, --accent, --link …;
// see index.html). A theme is just a full map of those variables to values, and
// applyTheme() sets them on a root element. Because the modules reference the
// variables (not hard-coded colors), setting them on the page root re-themes all
// four default modules — clock, camera, photos, youtube — at once. That is the
// whole point of routing color through variables.
//
// *** THE VARIABLES ARE NAMED FOR THEIR ROLE. Renamed 2026-09-07. ***
//
// This note used to defer the job: *"The current palette variables carry legacy brand names
// (--darkgreen, --beige, --moss) rather than role names... A future cleanup can rename them to
// roles; that is a mechanical refactor and out of scope for this slice."*
//
// Mike ended the deferral, and the reason is sharper than tidiness: **`--darkgreen` held a LIGHT
// value in Dusk.** A variable whose name contradicts its contents is not a naming preference, it
// is a trap for whoever reads the theme next -- and it was about to be a trap for a designer
// writing new themes against it. Done BEFORE Design's themes land, so those arrive written in
// this vocabulary instead of one that needs translating.
//
//     --ink        -> --text                 --card        -> --surface
//     --ink-soft   -> --text-soft            --cream-soft  -> --surface-alt
//     --muted      -> --text-muted           --line        -> --border
//     --darkgreen  -> --text-strong          --moss        -> --accent
//     --beige      -> --on-dark              --midnight    -> --link
//     --rosy       -> --accent-warm          --rosy-deep   -> --accent-warm-deep
//     --on-moss    -> --on-accent            --on-midnight -> --on-link
//
// `--bg`, `--font` and `--wallpaper-hue` were already honest and did not move -- Mike, on the
// last: *"leave it alone, it is honestly named."* Module-scoped variables (`--ab-*` on the
// board, `--tk-*`, `--u`) are not part of this surface and were not touched.
//
// 1053 occurrences across 23 files. Every replacement was bounded on BOTH sides with `-` treated
// as a word character, which is what kept `--ink` out of the board's `--ab-ink` and stopped
// `--rosy` eating half of `--rosy-deep`. The script then asserts that NO legacy name survives,
// because a half-done rename is worse than none: the old name resolves to nothing and the colour
// silently falls back to whatever the `var()` fallback said, which is a bug you see only in the
// one theme where the fallback is wrong.
//
// `--text-strong` deserves its own line. It is "the modules' primary text colour" and it is a
// SEPARATE key from `--text` even though the default theme gives them the same value -- Dusk
// sets them differently, and that is exactly the case the old name hid.
//
// Themes define the FULL key set below, so switching themes always fully overwrites — no
// leftover variable from a previously-applied theme.

const SYSTEM_FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

// The complete set of variables a theme controls. Values here are the current
// Nimrod light palette — the DEFAULT theme, so nothing changes visually until a
// profile picks another. Every other theme is BASE spread + overrides, which
// guarantees each theme defines every key.
const BASE = {
  '--bg': '#F7F4D5',
  '--text': '#0A3323',
  '--text-soft': '#3c5346',
  '--text-muted': '#5d7064',
  '--border': '#e4e0c2',
  '--surface': '#FFFFFF',
  '--surface-alt': '#FBF9E9',
  '--text-strong': '#0A3323', // modules' primary text color
  '--accent': '#839958',      // primary button / accent
  '--link': '#105666',  // links / secondary accent
  '--on-dark': '#F7F4D5',     // text-on-dark surfaces (letterboxed media overlays)
  '--accent-warm': '#D3968C',
  '--accent-warm-deep': '#a85f52',
  // *** THE ACTIVE-CONTROL COLOUR, WHICH NO THEME COULD REACH UNTIL NOW. ***
  //
  // `kiosk.css` drew the pressed/active transport button as `var(--gold, #ffd36e)` and NOTHING
  // DEFINED `--gold`. So every theme -- including the dark ones and the accessibility one --
  // got the same hardcoded amber, and the `var()` fallback is what hid it: the page rendered
  // correctly, so nobody had a symptom to chase. Found by `dev/undefined_vars.py`.
  //
  // Given the value it already had, so nothing moves today; what changes is that a theme can
  // now say otherwise. Named for the role rather than the colour, because "gold" is exactly the
  // kind of name this whole rename existed to remove.
  '--highlight': '#ffd36e',
  // *** RIGHT AND WRONG ARE SURFACES, AND THEY WERE HARDCODED PALES. ***
  //
  // The games mark a correct answer with a pale green wash and a wrong one with a pale pink, and
  // both were literals. The TEXT on them is inherited from the panel, which is themed -- so in
  // dusk and contrast, where `--text` is a near-white, every right and wrong answer in Word
  // Forge, Algebra, Trivia and Bank rendered as near-white on a pale wash. Nobody developing in
  // the default theme could see it, because there the literal and the themed surface agree.
  //
  // Given the values they already had, so nothing moves today; what changes is that a dark theme
  // can finally say otherwise. Roles, not colours -- "pale green" would be the same mistake this
  // file spent the morning renaming away from.
  // *** THE LETTERBOX BEHIND A PHOTO OR A VIDEO. ***
  //
  // `.photos .stage`, `.camera .stage`, `.youtube .stage` and `.personal .stage` each hardcoded
  // the same near-black. It is a good colour for the job -- a bright surround competes with the
  // picture -- but four modules each deciding it privately is the thing Mike's third seam names:
  // *"no module hardcodes its own background."* A theme could not touch it, and the four could
  // drift apart with nothing noticing.
  //
  // Given the value they already had, so nothing moves. `--on-dark` is already the text role
  // used over this surface, so the pair is complete.
  '--letterbox': '#0c1a14',
  '--ok-surface': '#f0f4e8',
  '--bad-surface': '#fbecea',
  '--font': SYSTEM_FONT,
  // The hue the live wallpaper drifts around, so scenery and palette agree instead of
  // arguing. A NUMBER rather than a color because the wallpaper varies lightness and
  // saturation itself; a theme that wants a different mood changes this one line.
  '--wallpaper-hue': '158',      // the green the rest of this palette is built on
};

export const THEMES = {
  default: {
    label: 'Nimrod (light)',
    vars: { ...BASE },
  },

  // Calm, low-stimulation dark theme. For a bedside screen at night, and gentler
  // for eyes on a screen that's up ~24/7. Text vars flip to light values.
  dusk: {
    label: 'Dusk (dark, calm)',
    // *** `dark: true`, READ BY `applyTheme` BELOW. *** Found live (Mike, 2026-09-08): a native
    // browser control this codebase's own CSS cannot fully restyle -- `<input type="time">`'s
    // built-in spinner and clock icon -- was rendering in the BROWSER'S OWN light-mode default,
    // sitting inside Dusk's dark-styled box, because nothing ever told the browser this page was
    // dark. `color-scheme` is the actual fix for exactly this: it asks the browser to render its
    // own native chrome (time/date pickers, scrollbars, the works) to match, not just this one
    // input. Dusk is the ONLY theme this is true for -- the other four are all light backgrounds
    // (`default`, `highContrast`, `warm`, `forge` all have a light `--bg`) -- so this is a
    // per-theme flag, not a global one -- `default`, `contrast`, `warm`, `forge` are all light
    // backgrounds; setting `color-scheme: dark` unconditionally would have broken the SAME
    // controls on every one of those instead.
    dark: true,
    vars: {
      ...BASE,
      '--bg': '#12181c',
      '--text': '#e8eef0',
      '--text-soft': '#b9c4c7',
      '--text-muted': '#8798a0',
      '--border': '#2a343a',
      '--surface': '#1b2429',
      // *** THE RIGHT/WRONG WASHES HAVE TO BE DARK HERE, and defining the role was not enough. ***
      // BASE gives them pale green and pale pink, which is correct wherever the text is dark.
      // Dusk is the ONLY theme whose text is light (#e8eef0), so it is the only one where a pale
      // wash puts near-white on near-white -- which is exactly what the screenshot showed after
      // the roles were introduced. Same hues, moved to the dark end, so "right" still reads as
      // green and "wrong" still reads as red without anybody having to learn a new signal.
      '--ok-surface': '#1e2a22',
      '--bad-surface': '#2c1f22',
      '--surface-alt': '#222c31',
      '--text-strong': '#eef3f4', // primary text -> light
      '--accent': '#8fae63',
      '--link': '#63b9cb',
      '--on-dark': '#eef3f4',
      '--accent-warm': '#d8a89f',
      '--accent-warm-deep': '#e6b3a8',
    },
  },

  // Maximum legibility: near-black on white, a strong single accent, heavier line.
  // An accessibility choice, not an aesthetic one.
  contrast: {
    label: 'High contrast',
    vars: {
      ...BASE,
      '--bg': '#ffffff',
      '--text': '#000000',
      '--text-soft': '#111111',
      '--text-muted': '#333333',
      '--border': '#000000',
      '--surface': '#ffffff',
      '--surface-alt': '#f2f2f2',
      '--text-strong': '#000000',
      '--accent': '#005a9e',      // strong blue accent, high contrast on white
      '--link': '#005a9e',
      '--on-dark': '#ffffff',
      '--accent-warm': '#b3005a',
      '--accent-warm-deep': '#8a0046',
    },
  },

  // Warm, softer light theme — amber/terracotta instead of green/beige.
  warm: {
    label: 'Warm',
    vars: {
      ...BASE,
      '--bg': '#fbf1e4',
      '--text': '#3a2417',
      '--text-soft': '#5c4130',
      '--text-muted': '#8a6c56',
      '--border': '#ecd9c4',
      '--surface': '#fffaf3',
      '--surface-alt': '#fff3e4',
      '--text-strong': '#3a2417',
      '--accent': '#c07a3e',
      '--link': '#a85a2a',
      '--on-dark': '#fbf1e4',
      '--accent-warm': '#c98a6f',
      '--accent-warm-deep': '#a85f42',
    },
  },

  // Teal + amber, the look the learning-tool modules were specified in. It lives here
  // rather than inside those modules so the games stay content-as-meaning: any profile
  // can wear it, and those modules re-skin with every other theme for free.
  forge: {
    label: 'Forge (teal + amber)',
    vars: {
      ...BASE,
      '--bg': '#f2f6f6',
      '--text': '#0d2f34',
      '--text-soft': '#274a50',
      '--text-muted': '#5c777c',
      '--border': '#cfe0e1',
      '--surface': '#ffffff',
      '--surface-alt': '#e8f1f1',
      '--text-strong': '#0d2f34',
      '--accent': '#14636A',      // primary button / accent -> teal
      '--link': '#B5651D',  // links / secondary accent -> amber
      '--on-dark': '#f2f6f6',
      '--accent-warm': '#d9a05b',
      '--accent-warm-deep': '#8c4a12',
    },
  },
};

export const DEFAULT_THEME = 'default';

// Resolve an id to a known theme id, falling back to default for null/unknown.
export function resolveThemeId(id) {
  return id && THEMES[id] ? id : DEFAULT_THEME;
}

// Apply a theme by setting its CSS variables on `rootEl` (usually
// document.documentElement, so the whole page — shell + every module — re-themes).
// Unknown/empty id => the default theme. Returns the resolved id.
/**
 * *** TEXT ON AN ACCENT IS DERIVED, NEVER TYPED. ***
 *
 * Thirteen rules across `modules.css` and `kiosk.css` put a literal `#fff` on a themed accent --
 * the primary buttons, the ON tabs, the algebra `=` key, and `.k-dot.on`, which is how somebody
 * driving the screen with a switch knows which panel they are about to act on. Measured, white
 * on `--accent` was **3.15 in default, 2.50 in dusk, 3.45 in warm** against a 4.5 floor, and white
 * on `--link` was **2.25 in dusk**. Two of those are unreadable by any standard.
 *
 * *** THIS IS NOT A PALETTE CHANGE AND NO THEME'S COLOURS MOVE. *** `PRIORITY.md` #2 gives the
 * themes to Claude Design, and it should: which greens and ambers this product wears is taste.
 * WHICH OF BLACK OR WHITE IS LEGIBLE ON A GIVEN GREEN IS NOT TASTE, it is a ratio, and leaving
 * text at 2.25:1 on a bedside screen because the fix looked like somebody else's job would be
 * the wrong call.
 *
 * So the accent colours are untouched and the text ON them is computed: whichever of light or
 * dark contrasts better with that theme's own accent. **The gift to whoever does the palettes
 * is that this keeps working** -- a new theme gets legible button text without anybody
 * remembering to pick it.
 *
 * WHAT THIS DOES NOT FIX, named rather than buried: **forge's `--link` (#B5651D) reaches
 * only 4.34 with white and 4.13 with dark.** No choice of text clears 4.5 on that amber, because
 * the accent itself sits in the middle. That one IS a palette value and it is Claude Design's --
 * see D19. Everything else lands between 4.75 and 9.70.
 */
const ON_LIGHT = '#ffffff';
// Not an invented colour: this is dusk's own `--bg`, already in the palette.
const ON_DARK = '#12181c';

/** Relative luminance, WCAG's definition. Accepts #rgb and #rrggbb. */
export function luminance(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length < 6) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Contrast ratio between two colours, 1..21. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of light or dark text reads better on `bg`. Pure, so the suite can check it. */
export function onColor(bg) {
  return contrast(ON_LIGHT, bg) >= contrast(ON_DARK, bg) ? ON_LIGHT : ON_DARK;
}

// The accents that carry text. Each gets an `--on-*` companion computed from it.
export const ACCENT_VARS = ['--accent', '--link', '--accent-warm-deep'];

export function applyTheme(rootEl, id) {
  const resolved = resolveThemeId(id);
  const theme = THEMES[resolved];
  const vars = theme.vars;
  for (const [k, v] of Object.entries(vars)) rootEl.style.setProperty(k, v);
  // Derived AFTER the theme's own values, and from them, so a theme that overrides an accent
  // gets matching text with no extra bookkeeping.
  for (const accent of ACCENT_VARS) {
    const value = vars[accent];
    if (value) rootEl.style.setProperty(`--on${accent.slice(1)}`, onColor(value));
  }
  // *** `color-scheme`, NOT JUST OUR OWN CSS VARS. *** This is the one thing a theme controls
  // that our own stylesheet cannot override: the browser's OWN chrome for native form controls
  // (`<input type="time">`'s spinner and clock icon, scrollbars, and everything else this
  // codebase does not draw itself). Without it, every one of those renders in the browser's
  // light-mode default regardless of which theme is active -- which on Dusk looked exactly like
  // a broken control sitting inside a dark box, because that is what it was.
  rootEl.style.setProperty('color-scheme', theme.dark ? 'dark' : 'light');
  return resolved;
}

// [{id,label}] for building a picker.
export function listThemes() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
}
