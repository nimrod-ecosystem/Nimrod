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

// From Claude Design's live-themes handoff, 2026-09-22 -- seven animated themes and the scene
// system they ride on. `syncScene` is a no-op on anything but <html> or an element carrying
// `data-scene-host` (see below), so every existing call site is unaffected.
import { liveThemes, BOARD_BASE, seasonThemes } from './live_themes.js';
import { syncScene } from './livescene.js';
// "With the seasons" (2026-10-05): a choice that is a rule for picking a theme by the date, not a palette.
import { FOLLOW_THEMES, isFollowThemeId, resolveSeasonal, seasonContext } from './seasons.js';
// User folders (867a7ff): a font the device's own folder supplies goes in front of the theme's stack.
import { userFontStack, USER_FONTS_EVENT } from './user_fonts.js';

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
  // The theme's default subtitles style (subtitles.js SUBTITLE_STYLES), read by subtitles.js; the
  // person's own choice overrides it. Rolling up, newest at the bottom (row 2.47).
  '--subtitles-style': 'flow',
  // The board's own pinned values (modules.css), carried here so "every theme defines every
  // key" still holds for the new `--board-*` roles a live theme's `surface: veil|clear` reads.
  // Spread LAST -- see BOARD_BASE's own comment in live_themes.js. Without this, switching from
  // a live theme back to Default would leave the live theme's board tokens inline on the root.
  ...BOARD_BASE,
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
      // The legibility theme takes the most conventional captions: a box per line, nothing gliding.
      '--subtitles-style': 'plain',
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
      // Was #8a6c56: 4.31:1 on its own --bg, 4.20 at worst with deuteranopia, under AA's 4.5
      // (MIKE_LIST_20260930). Moved 10% toward --text, the smallest step that clears it with room:
      // 4.66 at worst. Same brown, a shade deeper.
      '--text-muted': '#826550',
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
      // Was #5c777c: 4.17:1 at worst (on --surface-alt), under AA's 4.5 (MIKE_LIST_20260930).
      // Moved 10% toward --text, as warm's was: 4.63 at worst. Same teal-grey, a shade deeper.
      '--text-muted': '#547075',
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
  ...liveThemes(BASE),
  // Spring, Summer and a look for each holiday (Design's seasons-holidays handoff, 2026-10-05). The holiday
  // ones carry `group: 'holiday'`; since 2026-10-06 listThemes offers them too (see there). THEMES has them all, so
  // every check that walks THEMES measures them, and applyTheme can paint one when its day comes.
  ...seasonThemes(BASE),
};

export const DEFAULT_THEME = 'default';

// Resolve an id to a known theme CHOICE, falling back to default for null/unknown. A choice is a theme
// in THEMES or a follow theme ("With the seasons", seasons.js FOLLOW_THEMES) - kept as itself, so it is
// what gets saved and what a picker shows. What it PAINTS today is `paintedThemeId` / `paintedTheme`.
export function resolveThemeId(id) {
  return id && (THEMES[id] || isFollowThemeId(id)) ? id : DEFAULT_THEME;
}

/** Is `id` a choice that picks a theme by a rule (the date), rather than a theme itself? */
export const isFollowTheme = (id) => isFollowThemeId(id);

/**
 * *** WHAT A CHOICE PAINTS, NOW. *** For an ordinary theme, that theme. For "With the seasons", the
 * season's or holiday's theme on this date (seasons.js `resolveSeasonal`), or its stated fallback while
 * Design's art for it does not exist yet - with the fallback's overlays added to the theme's own, which
 * is how Halloween can be Night plus the black cat until it has a world of its own.
 *   `now` (ms), `lat`, `holidays`: override the page's own context (seasons.js), for a suite.
 * Returns the THEMES entry as a new object, plus `id` (the painted theme) and, for a follow choice,
 * `follows` (the choice) and `season` (what resolveSeasonal said). Always a real theme: `.vars` is there.
 */
export function paintedTheme(id, { now, lat, holidays } = {}) {
  const choice = resolveThemeId(id);
  if (!isFollowThemeId(choice)) return { ...THEMES[choice], id: choice };
  const ctx = { ...seasonContext(), ...(lat !== undefined ? { lat } : {}), ...(holidays !== undefined ? { holidays } : {}) };
  // (seasons) `ctx.at`: the moment whose look a screen is showing, held still while a change waits for a
  // calm moment (sky.js). Null on a page with no screen: now.
  const season = resolveSeasonal(new Date(now ?? ctx.at ?? Date.now()), { ...ctx, has: (t) => !!THEMES[t], last: DEFAULT_THEME });
  const base = THEMES[season.theme] || THEMES[DEFAULT_THEME];
  const overlays = [...(base.overlays || [])];
  for (const o of season.overlays) if (!overlays.includes(o)) overlays.push(o);
  return { ...base, overlays, id: THEMES[season.theme] ? season.theme : DEFAULT_THEME, follows: choice, season };
}
export const paintedThemeId = (id, opts) => paintedTheme(id, opts).id;

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

// *** DEUTERANOPIA, SIMULATED, so the floors below hold for red-green colour blindness too. ***
// Machado, Oliveira & Fernandes (2009), deuteranopia at severity 1.0, applied to linear RGB. The
// MIKE_LIST_20260930 check found Warm's focus ring passing 3:1 with normal vision (3.09) and failing
// it once simulated (2.88), so a floor that only checks normal vision misses exactly the people
// that check was for. Each row sums to 1, so greys (and white and black) are left alone.
const DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.011820, 0.042940, 0.968881],
];

/** #rgb / #rrggbb (/ #rrggbbaa, alpha ignored, as before) -> [r, g, b] in 0..1, or null for
 *  anything else (a keyword, rgba(), a typo). */
function parseHex(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/**
 * Relative luminance, WCAG's definition. Accepts #rgb and #rrggbb.
 * `{ deutan: true }`: as somebody with deuteranopia sees it (the simulation above).
 */
export function luminance(hex, { deutan = false } = {}) {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let [r, g, b] = rgb.map(f);
  if (deutan) {
    [r, g, b] = DEUTAN.map(([x, y, z]) => Math.min(1, Math.max(0, x * r + y * g + z * b)));
  }
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1..21. `opts` as luminance's. */
export function contrast(a, b, opts) {
  const [hi, lo] = [luminance(a, opts), luminance(b, opts)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// *** THE AA FLOORS, as numbers the suite reads rather than retypes. *** WCAG 2.x AA: 4.5:1 for
// body text (1.4.3), 3:1 for a focus indicator or any other non-text signal (1.4.11). Floors, not
// targets: a theme is free to go higher, and nothing here caps it.
export const TEXT_MIN = 4.5;
export const FOCUS_MIN = 3;

// The surfaces a ring or a muted line can sit on. The worst of the three is what counts.
const SURFACE_VARS = ['--bg', '--surface', '--surface-alt'];

/**
 * The WORST contrast `fg` makes against a theme's surfaces, with normal vision AND simulated
 * deuteranopia. `vars` is a theme's map (or any object with some of `--bg`/`--surface`/
 * `--surface-alt`; a missing one is skipped). Infinity when there is nothing to measure against.
 */
export function worstContrast(fg, vars) {
  let worst = Infinity;
  for (const k of SURFACE_VARS) {
    const bg = vars?.[k];
    if (!parseHex(bg)) continue;
    worst = Math.min(worst, contrast(fg, bg), contrast(fg, bg, { deutan: true }));
  }
  return worst;
}

const toHex = (rgb) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;

/**
 * *** THE FOCUS RING IS DERIVED FROM THE THEME, LIKE THE TEXT ON AN ACCENT. ***
 *
 * MIKE_LIST_20260930: the rings drawn in `--accent` measured 2.83:1 in default (on its own --bg)
 * and 2.88:1 in warm once deuteranopia was simulated, against AA's 3:1 for a focus indicator.
 *
 * The accents themselves are NOT moved: they are also the buttons, the ON tabs and the dots, and
 * which green this product wears is Design's (the reasoning at `onColor` below). So the ring gets
 * its own role, `--focus`: the theme's own `--focus` if it names one, else its `--accent`, kept
 * EXACTLY as it is when it already clears 3:1 on every surface (both visions) - which is ten of the
 * twelve themes today - and otherwise stepped toward the theme's own `--text` until it does. Default
 * moves #839958 -> #7c9355, warm #c07a3e -> #bb773c: the same hue, a shade deeper.
 *
 * Toward `--text` because that is the one colour every theme already guarantees reads on its own
 * surfaces, so the walk always lands, in light themes and dark ones alike. A value that is not a
 * hex colour (a keyword like Highlight) is passed through untouched: it cannot be measured, and
 * guessing at it would be worse.
 */
export function focusColor(vars) {
  const start = vars?.['--focus'] || vars?.['--accent'];
  const from = parseHex(start);
  const to = parseHex(vars?.['--text']);
  if (!from || !to) return start;
  if (worstContrast(start, vars) >= FOCUS_MIN) return start;
  for (let i = 1; i <= 50; i++) {
    const t = i / 50;
    const c = toHex(from.map((x, k) => x + (to[k] - x) * t));
    if (worstContrast(c, vars) >= FOCUS_MIN) return c;
  }
  return vars['--text'];
}

/**
 * *** THE SWITCH-SCAN RING: THE THEME'S GOLD WHERE IT READS, ITS FOCUS RING WHERE IT DOES NOT. ***
 *
 * Five modules (nimrod guide, devices, profile, what's new, library) and the button face (`.nbtn`)
 * drew the ring that says "the next press acts on THIS" in `--highlight`, a pale gold. On a dark
 * theme it reads beautifully. On a light one it measured about 1.2:1 against the page, against AA's
 * 3:1 for a focus indicator - the scan ring, of all the signals on the screen, was the one somebody
 * driving it with a switch could not see.
 *
 * `--highlight` itself does NOT move: it is also the pressed transport button's fill, the word games'
 * stars and the rhythm floor, all of which want the gold. The ring gets its own role, `--scan-ring`:
 * the theme's own `--scan-ring` if it names one, else its `--highlight`, kept EXACTLY when it clears
 * 3:1 on every surface (both visions, as `focusColor`) - and otherwise the theme's `--focus`.
 *
 * WHY `--focus` AND NOT THE GOLD DARKENED UNTIL IT PASSES. Walking #ffd36e toward a light theme's dark
 * `--text` does reach 3:1, but only about half way, and the colour there is a khaki-olive that is no
 * longer gold and was never in anybody's palette - the look is lost either way, so it may as well be
 * lost to a colour a designer chose. `--focus` is that colour: the theme's accent, already proven at
 * 3:1, and already the ring on every other focusable thing in that theme, so the scan and the keyboard
 * draw the same ring. The cost, named: on a light theme the scan ring and the kiosk's focused-panel
 * ring are the same colour. They sit at different scales (a panel vs a button inside it), and the scan
 * ring is the inner one. A value that is not a hex colour is passed through untouched, as focusColor.
 */
export function scanRingColor(vars) {
  const own = vars?.['--scan-ring'] || vars?.['--highlight'];
  if (own && !parseHex(own)) return own;
  if (own && worstContrast(own, vars) >= FOCUS_MIN) return own;
  return focusColor(vars);
}

/** Whichever of light or dark text reads better on `bg`. Pure, so the suite can check it. */
export function onColor(bg) {
  return contrast(ON_LIGHT, bg) >= contrast(ON_DARK, bg) ? ON_LIGHT : ON_DARK;
}

// The accents that carry text. Each gets an `--on-*` companion computed from it.
export const ACCENT_VARS = ['--accent', '--link', '--accent-warm-deep'];

// `flashLimit` (a number or a getter, flash_limit.js): the host's flash limit for the live scene's own
// flicker. A kiosk passes its `flashLimitNow`. OMITTED, it is not sent at all: a scene mounted fresh
// gets flash_limit.js's default (no limit, since 8a89e31), and a scene already running KEEPS the limit its host
// gave it - so a settings panel re-applying the theme on the same page cannot loosen a stricter one.
// (2026-10-05) A follow choice ("With the seasons") paints today's theme for it (`paintedTheme`), and the
// id RETURNED is that painted theme's, so every caller's `THEMES[applyTheme(...)]` is still a real theme.
// `now`/`lat`/`holidays` pass through to paintedTheme, for a suite.
export function applyTheme(rootEl, id, { flashLimit, now, lat, holidays } = {}) {
  const theme = paintedTheme(id, { now, lat, holidays });
  const resolved = theme.id;
  const vars = theme.vars;
  for (const [k, v] of Object.entries(vars)) rootEl.style.setProperty(k, v);
  rootEl.style.setProperty('--font', userFontStack(vars['--font']));
  rememberThemeFont(rootEl, vars['--font']);
  // Derived AFTER the theme's own values, and from them, so a theme that overrides an accent
  // gets matching text with no extra bookkeeping.
  for (const accent of ACCENT_VARS) {
    const value = vars[accent];
    if (value) rootEl.style.setProperty(`--on${accent.slice(1)}`, onColor(value));
  }
  // The focus ring, derived the same way (see focusColor). Set on EVERY apply, so switching themes
  // always overwrites it - the "every theme defines every key" guarantee, kept by computing it.
  rootEl.style.setProperty('--focus', focusColor(vars));
  // The switch-scan ring (see scanRingColor), the same way and for the same reason.
  rootEl.style.setProperty('--scan-ring', scanRingColor(vars));
  // *** `color-scheme`, NOT JUST OUR OWN CSS VARS. *** This is the one thing a theme controls
  // that our own stylesheet cannot override: the browser's OWN chrome for native form controls
  // (`<input type="time">`'s spinner and clock icon, scrollbars, and everything else this
  // codebase does not draw itself). Without it, every one of those renders in the browser's
  // light-mode default regardless of which theme is active -- which on Dusk looked exactly like
  // a broken control sitting inside a dark box, because that is what it was.
  rootEl.style.setProperty('color-scheme', theme.dark ? 'dark' : 'light');
  // A live theme's animated world, behind whatever `rootEl` is -- <html> for the whole page, or
  // any element carrying `data-scene-host` for a single panel wearing its own theme. Safe on
  // every other call site: `syncScene` itself checks for that marker and no-ops otherwise.
  syncScene(rootEl, theme, flashLimit !== undefined ? { flashLimit } : {});
  return resolved;
}

// ---------------------------------------------------------------------------------------------
// THE DEVICE'S OWN FONT, CHANGED WHILE THE PAGE IS UP (2026-10-02, user_folders_page.js). `--font` is
// the theme's font with this device's chosen user font in front (`userFontStack`, set above). Choosing
// a different one must not wait for the next theme change or a reload, so every element a theme was
// applied to is remembered (weakly: a panel that goes away is not kept alive) with the theme's OWN
// font, and `refreshUserFont` re-sets its `--font` from that. `themeFont` is the theme's own font,
// without the user's in front: what the "the theme's own" option previews.
// ---------------------------------------------------------------------------------------------
const THEMED = [];   // [{ ref: WeakRef(rootEl), base }]
const deref = (e) => { try { return e.ref.deref(); } catch { return undefined; } };
function rememberThemeFont(rootEl, base) {
  if (typeof WeakRef !== 'function' || !rootEl) return;
  for (let i = THEMED.length - 1; i >= 0; i--) {
    const el = deref(THEMED[i]);
    if (!el || el === rootEl) THEMED.splice(i, 1);
  }
  THEMED.push({ ref: new WeakRef(rootEl), base: String(base || '') });
}

/** The theme's own font for `rootEl` (default: <html>, else the last element a theme was applied to), or ''. */
export function themeFont(rootEl = null) {
  const live = THEMED.filter((e) => deref(e));
  const hit = rootEl ? live.find((e) => deref(e) === rootEl)
    : (live.find((e) => typeof document !== 'undefined' && deref(e) === document.documentElement) || live[live.length - 1]);
  return hit ? hit.base : '';
}

/**
 * Re-set `--font` on every element a theme is applied to, from this device's choice now. Returns how
 * many. Tells the page (USER_FONTS_EVENT) so words fitted to a box refit in the new face.
 */
export function refreshUserFont({ storage } = {}) {
  let n = 0;
  for (let i = THEMED.length - 1; i >= 0; i--) {
    const el = deref(THEMED[i]);
    if (!el || !el.isConnected) { if (!el) THEMED.splice(i, 1); continue; }
    el.style.setProperty('--font', userFontStack(THEMED[i].base, storage));
    n++;
  }
  try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(USER_FONTS_EVENT)); } catch { /* nobody listening */ }
  return n;
}

// [{id,label}] for building a picker. The follow choices ("With the seasons") come LAST, after every real
// theme, marked `follows: true` - last so a list's first entry is still a real theme, and marked so a
// picker that draws a theme's colours can ask `paintedTheme` for today's instead of THEMES.
// (2026-10-06, Mike: "You should also be able to choose any of the seasonal ones at any time.") EVERY theme is
// listed, the holiday ones included - they used to come only by date, through "With the seasons" (commit 71a3fa1,
// guess 4), which kept a stepped list short. The list is no longer stepped by default (a long choice opens the
// theme gallery, choice_picker.js, with a "Holidays" filter), so its length costs nobody a press; somebody who
// wants Christmas all December, or the Halloween look all October, now just picks it. "With the seasons" stays,
// last, as the choice that follows the date. A holiday theme picked by hand is that theme every day: it does not
// switch itself off when the holiday ends (that is what "With the seasons" is for).
export function listThemes() {
  return [
    ...Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label })),
    ...Object.entries(FOLLOW_THEMES).map(([id, t]) => ({ id, label: t.label, follows: true })),
  ];
}

// --- anonymous theme choice -------------------------------------------------------
// "Themes are per-PROFILE" (DECISIONS.md) still holds for anyone signed in -- see
// profile.js's resolveTheme, which is the real, cross-device, per-person store. This is
// the ONE case that has no profile to hold it: a visitor with no account at all, on
// landing.html / wallpapers.html / index.html. Mike, 2026-09-21: "Pre-sign-in pages...
// it would be nice if they could change themes without signing in." Per-browser,
// localStorage, same injectable-storage/try-catch shape as people.js's readLastPerson
// and talk.js's own settings store (a page with no sign-in has nowhere else to put it).
const LOCAL_KEY = 'nimrod:theme';

export function getStoredTheme(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { return storage?.getItem(LOCAL_KEY) || null; } catch { return null; }
}

export function setStoredTheme(id, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { storage?.setItem(LOCAL_KEY, resolveThemeId(id)); } catch { /* private mode / quota */ }
}

// A minimal, reusable picker for any page that has nobody signed in to hold a theme on a
// profile -- one <select>, wired to apply + persist immediately. Deliberately plain: the
// real, permanent home for changing a theme is the Settings module (once it exists as a
// placeable module/tab, per Mike 2026-09-21), which signed-in pages should link to rather
// than growing a second bespoke control. This one is for the pages that have no such
// module to place it in.
export function mountThemePicker(selectEl, { onChange = null } = {}) {
  if (!selectEl) return;
  const current = resolveThemeId(getStoredTheme());
  selectEl.innerHTML = '';
  for (const { id, label } of listThemes()) {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = label;
    if (id === current) opt.selected = true;
    selectEl.append(opt);
  }
  selectEl.addEventListener('change', () => {
    const id = resolveThemeId(selectEl.value);
    setStoredTheme(id);
    applyTheme(document.documentElement, id);
    onChange?.(id);
  });
}
