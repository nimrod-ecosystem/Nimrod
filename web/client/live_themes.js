// live_themes.js — the live themes, as entries for theme.js's THEMES map.
//
// From Claude Design, 2026-09-22. Written in the ROLE vocabulary (--text, --surface, --accent …)
// introduced in theme.js on 2026-09-07, NOT the legacy brand names.
//
// HOW TO WIRE IT (theme.js):
//
//     import { liveThemes, BOARD_BASE } from './live_themes.js';
//     const BASE = { ...existing keys..., ...BOARD_BASE };        // (1) see BOARD_BASE below
//     export const THEMES = { default: …, dusk: …, …, ...liveThemes(BASE) };
//
// A live theme is an ordinary theme with two extra fields that applyTheme ignores and
// livescene.js's syncScene() reads: `scene` (which world) and `overlays` (which inhabitants).
//
// EVERY VALUE IS TAGGED:
//   // L  landed — the value Design tuned the world against. If it fails, Design re-tunes it in
//          the scene; do not swap it here, or the world stops matching its palette.
//   // P  proposed — a role the board never needed, filled from that world's own palette for
//          this handoff. Design pre-checked every P text role with theme.js's own contrast()
//          against the WORST of --bg, --surface and --surface-alt, and five failed the first
//          time round (cyberpunk/cozy/winter/ocean muted, ocean link); all five were changed
//          before this file was written. That pre-check is not Code's measurement pass.
//
// WHAT IS NOT OVERRIDDEN, on purpose: --highlight, --letterbox, --font. BASE's values stand.
//
// Pre-check results, worst case across bg/surface/surface-alt (4.5 floor):
//   fall       text 9.49  soft 7.32  muted 4.94  link 4.75   <- link is the tightest in the set
//   steampunk  text 10.13 soft 7.70  muted 5.17  link 5.88
//   cyberpunk  text 9.66  soft 6.90  muted 5.33  link 7.87
//   cozy       text 9.90  soft 6.84  muted 5.21  link 5.81
//   winter     text 11.15 soft 8.28  muted 5.85  link 8.97
//   ocean      text 10.43 soft 8.18  muted 6.14  link 7.07
//   night      text 13.05 soft 9.28  muted 6.30  link 10.70
// Not pre-checked, for Code: borders (3:1 non-text), the --on-* pairs onColor() will pick,
// ok/bad surfaces under --text, and every --board-* value over its moving scene.

/**
 * *** THE BOARD KEYS, which BASE must carry so switching away from a live theme clears them. ***
 * applyTheme only sets the keys a theme defines, and "switching always fully overwrites" is kept
 * by every theme defining every key. So these defaults go INTO BASE: they are the board's own
 * pinned values from modules.css, so no existing theme changes by one pixel.
 * The board only reads them in its new `surface: veil | clear` modes (see board_live.css).
 */
export const BOARD_BASE = {
  '--board-bg': '#12181c',
  '--board-card': '#1b2429',
  '--board-text': '#e8eef0',
  '--board-border': '#7d939d',
  '--board-lit': '#8fae63',
  '--board-veil': 'rgba(27,36,41,.72)',
  '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
  '--board-sym-yes': '#6abf69', '--board-sym-no': '#D3968C', '--board-sym-need': '#e2b45a',
  '--board-sym-hot': '#d98a5f', '--board-sym-cold': '#7fc6d8', '--board-sym-love': '#cf6f86',
};

export const liveThemes = (BASE) => ({
  fall: {
    label: 'Fall — a path into the woods',
    dark: true,
    scene: 'fall',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#2a2a1e',                      // L
      '--text': '#f0e6e2',                    // L
      '--text-soft': '#d6cbc4',               // P
      '--text-muted': '#b3a79a',              // P
      '--border': '#a89c8e',                  // L
      '--surface': '#2f3524',                 // L
      '--surface-alt': '#383a28',             // P
      '--text-strong': '#f0e6e2',             // P
      '--accent': '#dcc08a',                  // L
      '--link': '#8fa9bd',                    // P
      '--on-dark': '#f0e6e2',                 // P
      '--accent-warm': '#e0bfc4',             // P
      '--accent-warm-deep': '#e0bfc4',        // P
      '--ok-surface': '#27331f',              // P
      '--bad-surface': '#3a2622',             // P
      '--wallpaper-hue': '38',                // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#2a2a1e',
      '--board-card': '#2f3524',
      '--board-text': '#f0e6e2',
      '--board-border': '#a89c8e',
      '--board-lit': '#dcc08a',
      '--board-veil': 'rgba(42,42,30,.8)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#cfdcc4',
      '--board-sym-no': '#e0bfc4',
      '--board-sym-need': '#dcc08a',
      '--board-sym-hot': '#dba179',
      '--board-sym-cold': '#8fa9bd',
      '--board-sym-love': '#e0bfc4',
    },
  },
  steampunk: {
    label: 'Steampunk — brass and machinery',
    dark: true,
    scene: 'steampunk',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#2b1d14',                      // L
      '--text': '#f5e3db',                    // L
      '--text-soft': '#dcc6bb',               // P
      '--text-muted': '#bba192',              // P
      '--border': '#AA7F66',                  // L
      '--surface': '#3a281e',                 // L
      '--surface-alt': '#432f22',             // P
      '--text-strong': '#f5e3db',             // P
      '--accent': '#F2CF2A',                  // L
      '--link': '#EC9C9D',                    // P
      '--on-dark': '#f5e3db',                 // P
      '--accent-warm': '#EC9C9D',             // P
      '--accent-warm-deep': '#EC9C9D',        // P
      '--ok-surface': '#2e3320',              // P
      '--bad-surface': '#402420',             // P
      '--wallpaper-hue': '30',                // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#2b1d14',
      '--board-card': '#3a281e',
      '--board-text': '#f5e3db',
      '--board-border': '#AA7F66',
      '--board-lit': '#F2CF2A',
      '--board-veil': 'rgba(46,32,25,.6)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#c8d8a8',
      '--board-sym-no': '#EC9C9D',
      '--board-sym-need': '#F2CF2A',
      '--board-sym-hot': '#e8a87c',
      '--board-sym-cold': '#a8c4cf',
      '--board-sym-love': '#EC9C9D',
    },
  },
  cyberpunk: {
    label: 'Cyberpunk — a street at night',
    dark: true,
    scene: 'cyberpunk',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#15191E',                      // L
      '--text': '#cfd6c4',                    // L
      '--text-soft': '#aeb6a6',               // P
      '--text-muted': '#98a090',              // P
      '--border': '#766DA7',                  // L
      '--surface': '#1b2026',                 // L
      '--surface-alt': '#232a36',             // P
      '--text-strong': '#cfd6c4',             // P
      '--accent': '#7A9663',                  // L
      '--link': '#a9c3d6',                    // P
      '--on-dark': '#cfd6c4',                 // P
      '--accent-warm': '#d6a0b8',             // P
      '--accent-warm-deep': '#d6a0b8',        // P
      '--ok-surface': '#1c2a22',              // P
      '--bad-surface': '#2c1d26',             // P
      '--wallpaper-hue': '250',               // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#15191E',
      '--board-card': '#1b2026',
      '--board-text': '#cfd6c4',
      '--board-border': '#766DA7',
      '--board-lit': '#7A9663',
      '--board-veil': 'rgba(21,25,30,.68)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#c3ceb4',
      '--board-sym-no': '#d6a0b8',
      '--board-sym-need': '#e0d39a',
      '--board-sym-hot': '#e3a98a',
      '--board-sym-cold': '#a9c3d6',
      '--board-sym-love': '#b3a8d9',
    },
  },
  cozy: {
    label: 'Cozy — a window seat and books',
    scene: 'cozy',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#f5f6f4',                      // L
      '--text': '#2f3a33',                    // L
      '--text-soft': '#46524a',               // P
      '--text-muted': '#56645b',              // P
      '--border': '#6f8676',                  // L
      '--surface': '#ffffff',                 // L
      '--surface-alt': '#ecebe3',             // P
      '--text-strong': '#2f3a33',             // P
      '--accent': '#4d6730',                  // L
      '--link': '#14636A',                    // P
      '--on-dark': '#f5f6f4',                 // P
      '--accent-warm': '#D3968C',             // P
      '--accent-warm-deep': '#9e5449',        // P
      '--ok-surface': '#eef3e6',              // P
      '--bad-surface': '#f8eceb',             // P
      '--wallpaper-hue': '90',                // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#f5f6f4',
      '--board-card': '#ffffff',
      '--board-text': '#2f3a33',
      '--board-border': '#6f8676',
      '--board-lit': '#4d6730',
      '--board-veil': 'rgba(255,255,255,.9)',
      '--board-halo': '0 1px 2px rgba(255,255,255,.95), 0 0 7px rgba(255,255,255,.85)',
      '--board-sym-yes': '#2c6e49',
      '--board-sym-no': '#9e5449',
      '--board-sym-need': '#8a5a12',
      '--board-sym-hot': '#a0461b',
      '--board-sym-cold': '#14636A',
      '--board-sym-love': '#9c3357',
    },
  },
  winter: {
    label: 'Winter — snow woods at dusk',
    dark: true,
    scene: 'winter',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#1b2130',                      // L
      '--text': '#eef3f6',                    // L
      '--text-soft': '#c9d4dd',               // P
      '--text-muted': '#a3b4c2',              // P
      '--border': '#8fa9bd',                  // L
      '--surface': '#232a3a',                 // L
      '--surface-alt': '#2b3447',             // P
      '--text-strong': '#eef3f6',             // P
      '--accent': '#c9d4dd',                  // L
      '--link': '#bfe0ee',                    // P
      '--on-dark': '#eef3f6',                 // P
      '--accent-warm': '#e8c0c4',             // P
      '--accent-warm-deep': '#e8c0c4',        // P
      '--ok-surface': '#1f2e2c',              // P
      '--bad-surface': '#33232c',             // P
      '--wallpaper-hue': '214',               // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#1b2130',
      '--board-card': '#232a3a',
      '--board-text': '#eef3f6',
      '--board-border': '#8fa9bd',
      '--board-lit': '#c9d4dd',
      '--board-veil': 'rgba(27,33,48,.78)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  ocean: {
    label: 'Aquarium — fish in a lit tank',
    dark: true,
    scene: 'ocean',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#08222f',                      // L
      '--text': '#e4f4f8',                    // L
      '--text-soft': '#bfdce4',               // P
      '--text-muted': '#98c2cd',              // P
      '--border': '#7fc6d8',                  // L
      '--surface': '#0e3242',                 // L
      '--surface-alt': '#123c4e',             // P
      '--text-strong': '#e4f4f8',             // P
      '--accent': '#a8e6c4',                  // L
      '--link': '#8fd3e3',                    // P
      '--on-dark': '#e4f4f8',                 // P
      '--accent-warm': '#f0b8b0',             // P
      '--accent-warm-deep': '#f0b8b0',        // P
      '--ok-surface': '#0f3a34',              // P
      '--bad-surface': '#35222a',             // P
      '--wallpaper-hue': '192',               // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#08222f',
      '--board-card': '#0e3242',
      '--board-text': '#e4f4f8',
      '--board-border': '#7fc6d8',
      '--board-lit': '#a8e6c4',
      '--board-veil': 'rgba(8,34,47,.76)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#a8e6b4',
      '--board-sym-no': '#f0b8b0',
      '--board-sym-need': '#f0dca0',
      '--board-sym-hot': '#f4b894',
      '--board-sym-cold': '#bfeaf4',
      '--board-sym-love': '#f0b4c8',
    },
  },
  night: {
    label: 'Night — stars and an aurora',
    dark: true,
    scene: 'night',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#070a12',                      // L
      '--text': '#e6ecf6',                    // L
      '--text-soft': '#c0c9d8',               // P
      '--text-muted': '#9aa6ba',              // P
      '--border': '#5b6f8c',                  // L
      '--surface': '#131a2a',                 // L
      '--surface-alt': '#1b2438',             // P
      '--text-strong': '#e6ecf6',             // P
      '--accent': '#8fa9bd',                  // L
      '--link': '#b8dcee',                    // P
      '--on-dark': '#e6ecf6',                 // P
      '--accent-warm': '#e8bcc0',             // P
      '--accent-warm-deep': '#e8bcc0',        // P
      '--ok-surface': '#142420',              // P
      '--bad-surface': '#2a1a22',             // P
      '--wallpaper-hue': '226',               // P
      // the board, when its surface is veil or clear — Design's board tokens for this world, all L
      '--board-bg': '#070a12',
      '--board-card': '#131a2a',
      '--board-text': '#e6ecf6',
      '--board-border': '#5b6f8c',
      '--board-lit': '#8fa9bd',
      '--board-veil': 'rgba(7,10,18,.72)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#b4e0c0',
      '--board-sym-no': '#e8bcc0',
      '--board-sym-need': '#e8dca8',
      '--board-sym-hot': '#e8b498',
      '--board-sym-cold': '#b8dcee',
      '--board-sym-love': '#dcb4dc',
    },
  },
});

// ---------------------------------------------------------------------------------------------
// SEASONS AND HOLIDAYS (Claude Design's seasons-holidays handoff, 2026-10-05). Thirteen more live themes:
// Spring and Summer (beside Fall and Winter), and a theme for each holiday theme_schedule.js knows. Each
// is an ordinary theme whose `scene` is the drawing of the same name in livescene.js.
//
//   group: 'season' | 'holiday'. They arrive by date through "With the seasons" (theme_schedule.js), AND since
//   2026-10-06 every one is in the Theme list too (Mike: "You should also be able to choose any of the seasonal
//   ones at any time"). The old reason to leave the holidays out - a list every press walks one step through,
//   doubled in length - went when a long list became a gallery with a "Holidays" filter (theme.js listThemes).
//
// TAGS, as above, with one more:
//   // L  Design's value: season_palettes.json for the page, the scene's own board tokens for --board-*.
//   // C  Code's fill, for a role Design's palette does not carry. Each is chosen, not invented:
//          --text-muted   walked from halfway between --text and --bg toward --text until it clears
//                         4.6:1 on --bg, --surface and --surface-alt, normal vision and deuteranopia
//                         (theme.js worstContrast), so it is as soft as the floor allows and no softer;
//          --text-strong  = --text, as every live theme above has it;
//          --on-dark      = --text on a dark page, --bg on a light one (as night and cozy);
//          --accent-warm(-deep), --ok-surface, --bad-surface   Night's on a dark page, Cozy's on a light one;
//          --wallpaper-hue  the hue of the theme's own --accent.
//   Design's `on-accent` / `on-link` are NOT copied: theme.js derives text on an accent (onColor), and on
//   every palette but one the two agree. Hanukkah's accent (#4a7ad0) is the exception: Design gave white
//   (4.21:1), the derivation picks the dark (4.25:1) - neither clears 4.5, because the blue sits in the
//   middle, like forge's link.
//   Reported to Design (NOTES_FOR_DESIGN, 2026-10-05); theme_test holds it at its measured floor.
// ---------------------------------------------------------------------------------------------
export const seasonThemes = (BASE) => ({
  spring: {
    label: "Spring — blossom trees and tulips",
    group: 'season',
    scene: 'spring',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#f4f7ee',                    // L
      '--text': '#24392b',                  // L
      '--text-soft': '#3e5444',             // L
      '--text-muted': '#5f6f62',            // C
      '--border': '#d4e2cc',                // L
      '--surface': '#ffffff',               // L
      '--surface-alt': '#eaf2e2',           // L
      '--text-strong': '#24392b',           // C
      '--accent': '#4d7a3a',                // L
      '--link': '#2f6d6a',                  // L
      '--on-dark': '#f4f7ee',               // C
      '--accent-warm': '#D3968C',           // C
      '--accent-warm-deep': '#9e5449',      // C
      '--ok-surface': '#eef3e6',            // C
      '--bad-surface': '#f8eceb',           // C
      '--wallpaper-hue': '102',             // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#f5f6f4',
      '--board-card': '#ffffff',
      '--board-text': '#2f3a33',
      '--board-border': '#6f8676',
      '--board-lit': '#4d7a3a',
      '--board-veil': 'rgba(255,255,255,0.9)',
      '--board-halo': '0 1px 2px rgba(255,255,255,.95), 0 0 7px rgba(255,255,255,.85)',
      '--board-sym-yes': '#2c6e49',
      '--board-sym-no': '#9e5449',
      '--board-sym-need': '#8a5a12',
      '--board-sym-hot': '#a0461b',
      '--board-sym-cold': '#14636A',
      '--board-sym-love': '#9c3357',
    },
  },
  summer: {
    label: "Summer — a lake and a sailboat",
    group: 'season',
    scene: 'summer',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#f1f8fb',                    // L
      '--text': '#17323d',                  // L
      '--text-soft': '#38535d',             // L
      '--text-muted': '#586d76',            // C
      '--border': '#cfe2ea',                // L
      '--surface': '#ffffff',               // L
      '--surface-alt': '#e2f0f5',           // L
      '--text-strong': '#17323d',           // C
      '--accent': '#14636A',                // L
      '--link': '#0f5a7a',                  // L
      '--on-dark': '#f1f8fb',               // C
      '--accent-warm': '#D3968C',           // C
      '--accent-warm-deep': '#9e5449',      // C
      '--ok-surface': '#eef3e6',            // C
      '--bad-surface': '#f8eceb',           // C
      '--wallpaper-hue': '185',             // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#f5f6f4',
      '--board-card': '#ffffff',
      '--board-text': '#2f3a33',
      '--board-border': '#6f8676',
      '--board-lit': '#14636A',
      '--board-veil': 'rgba(255,255,255,0.9)',
      '--board-halo': '0 1px 2px rgba(255,255,255,.95), 0 0 7px rgba(255,255,255,.85)',
      '--board-sym-yes': '#2c6e49',
      '--board-sym-no': '#9e5449',
      '--board-sym-need': '#8a5a12',
      '--board-sym-hot': '#a0461b',
      '--board-sym-cold': '#14636A',
      '--board-sym-love': '#9c3357',
    },
  },
  newYear: {
    label: "New Year's — fireworks over the city",
    group: 'holiday',
    dark: true,
    scene: 'newYear',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#0c0e1c',                    // L
      '--text': '#f4f4fa',                  // L
      '--text-soft': '#d2d4e6',             // L
      '--text-muted': '#8c8c96',            // C
      '--border': '#30365a',                // L
      '--surface': '#161a2c',               // L
      '--surface-alt': '#1e2338',           // L
      '--text-strong': '#f4f4fa',           // C
      '--accent': '#d9b34a',                // L
      '--link': '#9ad4e8',                  // L
      '--on-dark': '#f4f4fa',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '44',              // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#0c0e1c',
      '--board-card': '#161a2c',
      '--board-text': '#eef3f6',
      '--board-border': '#8a92c0',
      '--board-lit': '#ffd36e',
      '--board-veil': 'rgba(12,14,28,0.82)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  lunarNewYear: {
    label: "Lunar New Year — a street of red lanterns",
    group: 'holiday',
    dark: true,
    scene: 'lunarNewYear',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#1a0e14',                    // L
      '--text': '#f8f0ea',                  // L
      '--text-soft': '#e2d2cc',             // L
      '--text-muted': '#928888',            // C
      '--border': '#4a2a34',                // L
      '--surface': '#26141c',               // L
      '--surface-alt': '#321a24',           // L
      '--text-strong': '#f8f0ea',           // C
      '--accent': '#c9302b',                // L
      '--link': '#ffc457',                  // L
      '--on-dark': '#f8f0ea',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '2',               // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#1a0e14',
      '--board-card': '#26141c',
      '--board-text': '#eef3f6',
      '--board-border': '#c98a8a',
      '--board-lit': '#ffc457',
      '--board-veil': 'rgba(26,14,20,0.82)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  valentines: {
    label: "Valentine's Day — hearts at a pink dusk",
    group: 'holiday',
    scene: 'valentines',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#fdf3f5',                    // L
      '--text': '#3a1e28',                  // L
      '--text-soft': '#5c3a46',             // L
      '--text-muted': '#786168',            // C
      '--border': '#efd2da',                // L
      '--surface': '#ffffff',               // L
      '--surface-alt': '#f8e4ea',           // L
      '--text-strong': '#3a1e28',           // C
      '--accent': '#9c3357',                // L
      '--link': '#8a2a4a',                  // L
      '--on-dark': '#fdf3f5',               // C
      '--accent-warm': '#D3968C',           // C
      '--accent-warm-deep': '#9e5449',      // C
      '--ok-surface': '#eef3e6',            // C
      '--bad-surface': '#f8eceb',           // C
      '--wallpaper-hue': '339',             // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#f5f6f4',
      '--board-card': '#ffffff',
      '--board-text': '#2f3a33',
      '--board-border': '#9c6a7a',
      '--board-lit': '#9c3357',
      '--board-veil': 'rgba(255,255,255,0.9)',
      '--board-halo': '0 1px 2px rgba(255,255,255,.95), 0 0 7px rgba(255,255,255,.85)',
      '--board-sym-yes': '#2c6e49',
      '--board-sym-no': '#9e5449',
      '--board-sym-need': '#8a5a12',
      '--board-sym-hot': '#a0461b',
      '--board-sym-cold': '#14636A',
      '--board-sym-love': '#9c3357',
    },
  },
  stPatricks: {
    label: "St Patrick's Day — green hills and a rainbow",
    group: 'holiday',
    scene: 'stPatricks',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#f2f8f2',                    // L
      '--text': '#173a24',                  // L
      '--text-soft': '#365a42',             // L
      '--text-muted': '#55705f',            // C
      '--border': '#cfe2d2',                // L
      '--surface': '#ffffff',               // L
      '--surface-alt': '#e2f0e4',           // L
      '--text-strong': '#173a24',           // C
      '--accent': '#2c6e49',                // L
      '--link': '#1f6a52',                  // L
      '--on-dark': '#f2f8f2',               // C
      '--accent-warm': '#D3968C',           // C
      '--accent-warm-deep': '#9e5449',      // C
      '--ok-surface': '#eef3e6',            // C
      '--bad-surface': '#f8eceb',           // C
      '--wallpaper-hue': '146',             // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#f5f6f4',
      '--board-card': '#ffffff',
      '--board-text': '#2f3a33',
      '--board-border': '#6f8676',
      '--board-lit': '#2c6e49',
      '--board-veil': 'rgba(255,255,255,0.9)',
      '--board-halo': '0 1px 2px rgba(255,255,255,.95), 0 0 7px rgba(255,255,255,.85)',
      '--board-sym-yes': '#2c6e49',
      '--board-sym-no': '#9e5449',
      '--board-sym-need': '#8a5a12',
      '--board-sym-hot': '#a0461b',
      '--board-sym-cold': '#14636A',
      '--board-sym-love': '#9c3357',
    },
  },
  easter: {
    label: "Easter — painted eggs in a meadow",
    group: 'holiday',
    scene: 'easter',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#f8f6ee',                    // L
      '--text': '#2a3424',                  // L
      '--text-soft': '#485440',             // L
      '--text-muted': '#676d60',            // C
      '--border': '#dfe2cf',                // L
      '--surface': '#ffffff',               // L
      '--surface-alt': '#eef0e2',           // L
      '--text-strong': '#2a3424',           // C
      '--accent': '#6a5aa8',                // L
      '--link': '#3e6a8a',                  // L
      '--on-dark': '#f8f6ee',               // C
      '--accent-warm': '#D3968C',           // C
      '--accent-warm-deep': '#9e5449',      // C
      '--ok-surface': '#eef3e6',            // C
      '--bad-surface': '#f8eceb',           // C
      '--wallpaper-hue': '252',             // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#f5f6f4',
      '--board-card': '#ffffff',
      '--board-text': '#2f3a33',
      '--board-border': '#6f8676',
      '--board-lit': '#4d7a3a',
      '--board-veil': 'rgba(255,255,255,0.9)',
      '--board-halo': '0 1px 2px rgba(255,255,255,.95), 0 0 7px rgba(255,255,255,.85)',
      '--board-sym-yes': '#2c6e49',
      '--board-sym-no': '#9e5449',
      '--board-sym-need': '#8a5a12',
      '--board-sym-hot': '#a0461b',
      '--board-sym-cold': '#14636A',
      '--board-sym-love': '#9c3357',
    },
  },
  july4: {
    label: "Fourth of July — fireworks over a lake",
    group: 'holiday',
    dark: true,
    scene: 'july4',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#10142a',                    // L
      '--text': '#f4f6fa',                  // L
      '--text-soft': '#d2d8e8',             // L
      '--text-muted': '#90939e',            // C
      '--border': '#323c64',                // L
      '--surface': '#1a2038',               // L
      '--surface-alt': '#222a46',           // L
      '--text-strong': '#f4f6fa',           // C
      '--accent': '#c9483b',                // L
      '--link': '#8ab8ff',                  // L
      '--on-dark': '#f4f6fa',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '5',               // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#10142a',
      '--board-card': '#1a2038',
      '--board-text': '#eef3f6',
      '--board-border': '#8a9ac8',
      '--board-lit': '#ff6b5a',
      '--board-veil': 'rgba(16,20,42,0.82)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  halloween: {
    label: "Halloween — a lit house and smiling pumpkins",
    group: 'holiday',
    dark: true,
    scene: 'halloween',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#16121f',                    // L
      '--text': '#f4eee6',                  // L
      '--text-soft': '#d8cfe0',             // L
      '--text-muted': '#928d8e',            // C
      '--border': '#4a3c5c',                // L
      '--surface': '#221a2e',               // L
      '--surface-alt': '#2c2238',           // L
      '--text-strong': '#f4eee6',           // C
      '--accent': '#f2a03c',                // L
      '--link': '#c9a8f0',                  // L
      '--on-dark': '#f4eee6',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '33',              // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#16121f',
      '--board-card': '#221a2e',
      '--board-text': '#eef3f6',
      '--board-border': '#a08ab8',
      '--board-lit': '#f2a03c',
      '--board-veil': 'rgba(22,18,31,0.8)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  diwali: {
    label: "Diwali — rows of lamps and a rangoli",
    group: 'holiday',
    dark: true,
    scene: 'diwali',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#170e22',                    // L
      '--text': '#faf2ea',                  // L
      '--text-soft': '#e6d6dc',             // L
      '--text-muted': '#928a8f',            // C
      '--border': '#48304e',                // L
      '--surface': '#24162e',               // L
      '--surface-alt': '#2e1c3a',           // L
      '--text-strong': '#faf2ea',           // C
      '--accent': '#e8833a',                // L
      '--link': '#f2c4e8',                  // L
      '--on-dark': '#faf2ea',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '25',              // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#170e22',
      '--board-card': '#24162e',
      '--board-text': '#eef3f6',
      '--board-border': '#c9a0c8',
      '--board-lit': '#ffc457',
      '--board-veil': 'rgba(23,14,34,0.82)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  harvest: {
    label: "Harvest — a red barn and hay bales",
    group: 'holiday',
    scene: 'harvest',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#fbf3e6',                    // L
      '--text': '#3a2414',                  // L
      '--text-soft': '#5c3f28',             // L
      '--text-muted': '#756354',            // C
      '--border': '#e6d2b4',                // L
      '--surface': '#ffffff',               // L
      '--surface-alt': '#f4e6cf',           // L
      '--text-strong': '#3a2414',           // C
      '--accent': '#a8561e',                // L
      '--link': '#7a4a1a',                  // L
      '--on-dark': '#fbf3e6',               // C
      '--accent-warm': '#D3968C',           // C
      '--accent-warm-deep': '#9e5449',      // C
      '--ok-surface': '#eef3e6',            // C
      '--bad-surface': '#f8eceb',           // C
      '--wallpaper-hue': '24',              // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#2a1c10',
      '--board-card': '#3a2818',
      '--board-text': '#eef3f6',
      '--board-border': '#c9a070',
      '--board-lit': '#f2c46a',
      '--board-veil': 'rgba(42,28,16,0.82)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  hanukkah: {
    label: "Hanukkah — a menorah in a snowy window",
    group: 'holiday',
    dark: true,
    scene: 'hanukkah',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#141b30',                    // L
      '--text': '#f2f5fa',                  // L
      '--text-soft': '#d0d8e8',             // L
      '--text-muted': '#969ba6',            // C
      '--border': '#36426a',                // L
      '--surface': '#1e2740',               // L
      '--surface-alt': '#26304c',           // L
      '--text-strong': '#f2f5fa',           // C
      '--accent': '#4a7ad0',                // L
      '--link': '#ffd36e',                  // L
      '--on-dark': '#f2f5fa',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '219',             // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#141b30',
      '--board-card': '#1e2740',
      '--board-text': '#eef3f6',
      '--board-border': '#8fa9d6',
      '--board-lit': '#ffd36e',
      '--board-veil': 'rgba(20,27,48,0.82)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
  christmas: {
    label: "Christmas — a snowy village and a lit tree",
    group: 'holiday',
    dark: true,
    scene: 'christmas',
    overlays: [],
    vars: {
      ...BASE,
      '--bg': '#141a2c',                    // L
      '--text': '#f4f6f8',                  // L
      '--text-soft': '#d4dce4',             // L
      '--text-muted': '#9598a1',            // C
      '--border': '#3a4660',                // L
      '--surface': '#1e2638',               // L
      '--surface-alt': '#252f44',           // L
      '--text-strong': '#f4f6f8',           // C
      '--accent': '#c9483b',                // L
      '--link': '#9fd4b0',                  // L
      '--on-dark': '#f4f6f8',               // C
      '--accent-warm': '#e8bcc0',           // C
      '--accent-warm-deep': '#e8bcc0',      // C
      '--ok-surface': '#142420',            // C
      '--bad-surface': '#2a1a22',           // C
      '--wallpaper-hue': '5',               // C
      // the board over this world, Design's tokens (L)
      '--board-bg': '#141a2c',
      '--board-card': '#1e2638',
      '--board-text': '#eef3f6',
      '--board-border': '#8fa9bd',
      '--board-lit': '#f2c94c',
      '--board-veil': 'rgba(20,26,44,0.8)',
      '--board-halo': '0 1px 2px rgba(0,0,0,.85), 0 0 6px rgba(0,0,0,.6)',
      '--board-sym-yes': '#bfe0c4',
      '--board-sym-no': '#e8c0c4',
      '--board-sym-need': '#e8d6a0',
      '--board-sym-hot': '#e8b394',
      '--board-sym-cold': '#bfe0ee',
      '--board-sym-love': '#e4b8cc',
    },
  },
});

// *** NIMROD IS NOT HERE, and that is the design. *** Its colours are Dusk's. The black-cat look is
// Dusk plus the `cat` overlay — which is exactly what the overlays field is for:
//
//     dusk: { ...existing, scene: 'nimrod', overlays: ['cat'] }   // opt-in, see README step 7
