/* medievalTheme.js: the village as the Medieval theme's live backdrop (Mike, 2026-11-01, answer 2).
 *
 * The Medieval theme had no live scene; its town window looked out on Fall. This gives it one: a
 * village recipe from villageKit.js, drawn by sceneSvg. It's a GROUND_THEMES-shaped entry, so the
 * board, the site palette and the theme schedule read it like any other theme.
 *
 *   MEDIEVAL_THEME                          → { label, scene, tokens, halo, base, site, … }
 *   MEDIEVAL_DEFAULTS                       → the settings and what each one starts at
 *   lightAt(date, hours)                    → 'day' | 'evening' | 'night'
 *   medievalBackdropSvg(settings, { castSvg, assetBase, date }) → '<svg …>'
 *
 * Everything here is a setting with a starting value, never a fixed rule. */
import { fitStageSvg, STAGE_FIT_DEFAULTS } from './stage_fit.js';
import { sceneSvg, VILLAGE_SCENES } from './village_kit.js';

/* What each setting starts at. A person or a dashboard can change any of them. */
export const MEDIEVAL_DEFAULTS = {
  /* which village recipe is the backdrop: any VILLAGE_SCENES key, or a person's own recipe */
  recipe: 'village',
  /* 'crafted' (paper and felt) or 'toon'. Crafted is the village's own default; on the Pi 400,
     render it once to a bitmap (villageKit LOOKS has the cost of each) */
  look: 'crafted',
  /* 'auto' follows the real clock, the same hours RoomScene uses; or pin 'day', 'evening', 'night' */
  time: 'auto',
  hours: { day: 7, evening: 17, night: 20 },
  /* the cardboard diorama frame around the stage. On by default because it is part of the crafted
     look; turn it off where the backdrop runs to the screen edge */
  frame: true,
  /* the cast who live in the village. Off leaves an empty village behind the board */
  cast: true,
  /* a screen that is not 16:9 (stageFit.js): crop or letterbox past the bleed; the bleed itself is
     the frame's card when the frame is on, or the village's mirrored edges when it is off */
  ...STAGE_FIT_DEFAULTS,
  frameCard: '#d9c6a2', // the crafted look's card colour, the same as villageKit's BASE.crafted.card
  /* the ground colour below the stage on a tall screen with the frame off (null: the look's dark grass) */
  bleedBottom: null,
};

export function lightAt(date = new Date(), hours = MEDIEVAL_DEFAULTS.hours) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= hours.day && h < hours.evening) return 'day';
  if (h >= hours.evening && h < hours.night) return 'evening';
  return 'night';
}

/* Design's proposal, measured by Design (not by Code yet). The board keeps a dark surface so the
   symbol word colours hold. The veil is derived from the brightest thing that crosses the card
   band, the clouds and cottage plaster (#fbf7ee): at .8 the lowest pair, the hot word, is 5.09:1. */
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
export const MEDIEVAL_THEME = {
  label: 'Medieval', group: 'style',
  scene: { kit: 'village' },
  ground: 'linear-gradient(180deg,#a8d4ec,#e6f2f0)',
  tokens: {
    '--ab-bg': '#1f1912', '--ab-card': '#2a2219', '--ab-ink': '#f4ecd8', '--ab-line': '#c9a46a', '--ab-lit': '#e8b84a',
    '--ab-sym-yes': '#bfe0c4', '--ab-sym-no': '#e8c0c4', '--ab-sym-need': '#e8d6a0',
    '--ab-sym-hot': '#e8b394', '--ab-sym-cold': '#bfe0ee', '--ab-sym-love': '#e4b8cc',
    '--ab-veil': hexA('#1f1912', 0.8),
  },
  halo: 'dark',
  /* the dark-board tint set whose word colours match the --ab-sym-* above */
  base: 'winter',
  /* whole-site palette, in the role names. Text 13.8:1 on bg; link 5.85:1 and accent 5.11:1 on bg;
     white on accent 6.02:1 and on link 6.89:1 */
  site: {
    dark: false, bg: '#f4ecd8', surface: '#fffaf0', 'surface-alt': '#efe3c8', text: '#2a1e12', 'text-soft': '#4a3a28',
    border: '#dccaa4', accent: '#b03a2e', 'on-accent': '#ffffff', link: '#2f5a9a', 'on-link': '#ffffff',
  },
};

export function medievalBackdropSvg(settings = {}, { castSvg, assetBase, date = new Date(), aspect } = {}) {
  const s = { ...MEDIEVAL_DEFAULTS, ...settings };
  const base = typeof s.recipe === 'string' ? (VILLAGE_SCENES[s.recipe] || VILLAGE_SCENES.village).recipe : s.recipe;
  const time = s.time === 'auto' ? lightAt(date, s.hours) : s.time;
  const pieces = s.cast ? base.pieces : base.pieces.filter((x) => !x.cast);
  const svg = sceneSvg({ ...base, pieces, look: s.look, time, frame: s.frame, label: 'Medieval village' }, { castSvg, assetBase });
  /* A screen that is not 16:9 (Mike, 2026-11-02): with the diorama frame on, the frame's card fills the
     extra space, like a box around a diorama; with it off, the village's edges are mirrored outward. */
  const framed = s.look === 'crafted' && s.frame !== false;
  return fitStageSvg(svg, { aspect, fit: s.fit, bleed: s.bleed, bleedArt: framed ? 'none' : s.bleedArt, barColour: framed ? s.frameCard : s.barColour, bleedBottom: s.bleedBottom ?? (s.look === 'toon' ? '#58b244' : '#7fa35a') });
}
