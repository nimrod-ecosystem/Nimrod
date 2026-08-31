// theme.js — per-PROFILE themes (DECISIONS.md "Themes are per-PROFILE"). A theme
// is a render setting, not content: it lives on the profile and the renderer reads
// it, exactly the content-as-meaning split (content carries no styling; swapping a
// profile's theme re-renders everything for free).
//
// HOW IT WORKS — one trick, no per-module work. Every module already draws through
// a small set of CSS custom properties (--bg, --ink, --card, --moss, --midnight …;
// see index.html). A theme is just a full map of those variables to values, and
// applyTheme() sets them on a root element. Because the modules reference the
// variables (not hard-coded colors), setting them on the page root re-themes all
// four default modules — clock, camera, photos, youtube — at once. That is the
// whole point of routing color through variables.
//
// NOTE ON THE VARIABLE NAMES. The current palette variables carry legacy brand
// names (--darkgreen, --beige, --moss) rather than role names (--fg, --bg,
// --accent). They are nonetheless the theming surface — modules consume them — so a
// theme simply redefines them (in Dusk, --darkgreen holds a LIGHT value because
// modules use it as their primary text color). A future cleanup can rename them to
// roles; that is a mechanical refactor and out of scope for this slice. Themes
// define the FULL key set below, so switching themes always fully overwrites — no
// leftover variable from a previously-applied theme.

const SYSTEM_FONT =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

// The complete set of variables a theme controls. Values here are the current
// Nimrod light palette — the DEFAULT theme, so nothing changes visually until a
// profile picks another. Every other theme is BASE spread + overrides, which
// guarantees each theme defines every key.
const BASE = {
  '--bg': '#F7F4D5',
  '--ink': '#0A3323',
  '--ink-soft': '#3c5346',
  '--muted': '#5d7064',
  '--line': '#e4e0c2',
  '--card': '#FFFFFF',
  '--cream-soft': '#FBF9E9',
  '--darkgreen': '#0A3323', // modules' primary text color
  '--moss': '#839958',      // primary button / accent
  '--midnight': '#105666',  // links / secondary accent
  '--beige': '#F7F4D5',     // text-on-dark surfaces (letterboxed media overlays)
  '--rosy': '#D3968C',
  '--rosy-deep': '#a85f52',
  '--font': SYSTEM_FONT,
  // The hue the live wallpaper drifts around, so scenery and palette agree instead of
  // arguing. A NUMBER rather than a colour because the wallpaper varies lightness and
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
    vars: {
      ...BASE,
      '--bg': '#12181c',
      '--ink': '#e8eef0',
      '--ink-soft': '#b9c4c7',
      '--muted': '#8798a0',
      '--line': '#2a343a',
      '--card': '#1b2429',
      '--cream-soft': '#222c31',
      '--darkgreen': '#eef3f4', // primary text -> light
      '--moss': '#8fae63',
      '--midnight': '#63b9cb',
      '--beige': '#eef3f4',
      '--rosy': '#d8a89f',
      '--rosy-deep': '#e6b3a8',
    },
  },

  // Maximum legibility: near-black on white, a strong single accent, heavier line.
  // An accessibility choice, not an aesthetic one.
  contrast: {
    label: 'High contrast',
    vars: {
      ...BASE,
      '--bg': '#ffffff',
      '--ink': '#000000',
      '--ink-soft': '#111111',
      '--muted': '#333333',
      '--line': '#000000',
      '--card': '#ffffff',
      '--cream-soft': '#f2f2f2',
      '--darkgreen': '#000000',
      '--moss': '#005a9e',      // strong blue accent, high contrast on white
      '--midnight': '#005a9e',
      '--beige': '#ffffff',
      '--rosy': '#b3005a',
      '--rosy-deep': '#8a0046',
    },
  },

  // Warm, softer light theme — amber/terracotta instead of green/beige.
  warm: {
    label: 'Warm',
    vars: {
      ...BASE,
      '--bg': '#fbf1e4',
      '--ink': '#3a2417',
      '--ink-soft': '#5c4130',
      '--muted': '#8a6c56',
      '--line': '#ecd9c4',
      '--card': '#fffaf3',
      '--cream-soft': '#fff3e4',
      '--darkgreen': '#3a2417',
      '--moss': '#c07a3e',
      '--midnight': '#a85a2a',
      '--beige': '#fbf1e4',
      '--rosy': '#c98a6f',
      '--rosy-deep': '#a85f42',
    },
  },

  // Teal + amber, the look Oscar's game contract specifies for his learning tools.
  // It lives here rather than in his modules so the games stay content-as-meaning:
  // any profile can wear it, and his modules re-skin with every other theme for free.
  forge: {
    label: 'Forge (teal + amber)',
    vars: {
      ...BASE,
      '--bg': '#f2f6f6',
      '--ink': '#0d2f34',
      '--ink-soft': '#274a50',
      '--muted': '#5c777c',
      '--line': '#cfe0e1',
      '--card': '#ffffff',
      '--cream-soft': '#e8f1f1',
      '--darkgreen': '#0d2f34',
      '--moss': '#14636A',      // primary button / accent -> teal
      '--midnight': '#B5651D',  // links / secondary accent -> amber
      '--beige': '#f2f6f6',
      '--rosy': '#d9a05b',
      '--rosy-deep': '#8c4a12',
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
export function applyTheme(rootEl, id) {
  const resolved = resolveThemeId(id);
  const vars = THEMES[resolved].vars;
  for (const [k, v] of Object.entries(vars)) rootEl.style.setProperty(k, v);
  return resolved;
}

// [{id,label}] for building a picker.
export function listThemes() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
}
