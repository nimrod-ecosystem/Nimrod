/* themeSurfaces.js: EVERYTHING THAT CHANGES WITH A THEME.
 *
 * When a theme is added, every row here needs an answer for it. The coverage card
 * (guidelines/theme-coverage.html) checks the rows it can check against the real data and marks
 * the rest for a person to tick. `need`:
 *   required  every theme must have its own
 *   shared    a theme may borrow another theme's (say which)
 *   optional  only if the theme calls for it
 *   process   a check somebody does, not a file
 */
export const themeSurfaces = [
  /* the look */
  { id: 'site', group: 'The look', label: 'Whole-site palette', need: 'required', where: 'theme.js (originals: handoff live-themes/live_themes.js; seasons: seasonScenes.jsx `site`)', what: 'bg, surface, surface-alt, text, text-soft, text-muted, border, accent, on-accent, link, on-link, and whether it is dark.' },
  { id: 'scene', group: 'The look', label: 'Live scene', need: 'required', where: 'AacGround.jsx / seasonScenes.jsx → livescene.js', what: 'The animated background, drawn in three depth bands, everything moving inside the reduced-motion guard.' },
  { id: 'still', group: 'The look', label: 'Still frame', need: 'process', where: 'the scene itself', what: 'With motion off, the scene still looks composed, not piled at a start position.' },
  { id: 'panels', group: 'The look', label: 'Menu and bar background default', need: 'optional', where: 'recipe.panels / theme default', what: 'Solid, see-through or fully clear. Falls back to see-through.' },
  { id: 'halo', group: 'The look', label: 'Halo direction', need: 'required', where: 'GROUND_THEMES[key].halo', what: 'dark or light: which way text halos run over the scene when a panel is fully clear.' },
  /* the board */
  { id: 'tokens', group: 'AAC board', label: 'Board tokens', need: 'required', where: 'GROUND_THEMES[key].tokens', what: '--ab-bg, --ab-card, --ab-ink, --ab-line, --ab-lit, --ab-veil, and the six --ab-sym-* word colours.' },
  { id: 'icons', group: 'AAC board', label: 'Symbol tint set', need: 'shared', where: 'assets/icons/<set>/, GROUND_THEMES[key].base', what: 'The 55 symbols tinted to match the word colours. A theme can borrow a set whose --ab-sym-* match its own.' },
  /* games */
  { id: 'cards', group: 'Games', label: 'Playing cards', need: 'required', where: 'components/games/playingCards.js', what: 'Back (pattern, frame, medallion, emblem), face stock, edge, four suit colours, court frame.' },
  { id: 'bricks', group: 'Games', label: 'Brick-breaker and rhythm tiles', need: 'required', where: 'oct-2-asks sheet (to move into a module)', what: 'Brick colours, paddle, ball with its contrasting ring, the four rhythm tile colours.' },
  { id: 'letters', group: 'Games', label: 'Letter tiles and brain-game shapes', need: 'shared', where: 'oct-2-asks sheet', what: 'Tile face, edge and press ledge; the four shape colours.' },
  { id: 'marks', group: 'Games', label: 'Right / wrong marks', need: 'required', where: 'oct-2-asks sheet, from --good / --bad', what: 'Circle-and-tick and diamond-and-cross in colours that pass on this theme.' },
  /* rooms and building */
  { id: 'materials', group: 'Rooms and bricks', label: 'Brick materials', need: 'required', where: 'oct-2-asks sheet', what: 'wall, wood, soft, accent: base colour, seam colour, finish (matte, satin, glow).' },
  { id: 'window', group: 'Rooms and bricks', label: 'Window view', need: 'optional', where: 'RoomScene view: auto', what: 'Whether this scene can show through a room window, and at what crop.' },
  { id: 'signs', group: 'Rooms and bricks', label: 'Name sign and frame defaults', need: 'optional', where: 'NameSign / PictureFrame', what: 'Which sign style and frame a new item gets in this theme.' },
  /* when it shows */
  { id: 'schedule', group: 'When it shows', label: 'Schedule', need: 'optional', where: 'themeSchedule.js', what: 'Which season or holiday picks it, the dates it shows, and whether it is on to start with.' },
  { id: 'overlays', group: 'When it shows', label: 'Suggested overlays', need: 'optional', where: 'live_themes.js `overlays`', what: 'Weather or calm overlays that suit it (fireflies on night, leaves on fall).' },
  /* checks */
  { id: 'contrast', group: 'Checks', label: 'Contrast measured', need: 'process', where: 'Code', what: 'Text on bg, surface and the board veil; panels see-through and clear over the scene. A warning, never a blocker.' },
  { id: 'flash', group: 'Checks', label: 'Photosensitivity', need: 'process', where: 'the scene', what: 'Anything that flashes (fireworks, neon) slows and softens under data-photosafe.' },
  { id: 'pi', group: 'Checks', label: 'Pi 400 performance', need: 'process', where: 'Code', what: 'Frame rate with the scene, a module and see-through panels running.' },
];

/* Where the data lives today, for the rows the coverage card can check. */
export const knownCoverage = {
  siteOriginals: ['nimrod', 'fall', 'steampunk', 'cyberpunk', 'cozy', 'winter', 'ocean', 'night'],
  iconSets: ['color', 'cozy', 'cyberpunk', 'fall', 'night', 'ocean', 'steampunk', 'winter', 'mono'],
  bricks: ['nimrod', 'steampunk', 'cyberpunk'],
  materials: ['nimrod', 'fall', 'steampunk', 'cyberpunk', 'cozy'],
  marks: ['nimrod'],
};

/* ---- Added by Code, 2026-10-10. Everything above this line is Design's file as handed over. ----
 *
 * WHY THIS FILE IS IN web/client AND NOT docs/: the thing that proves the list is a suite
 * (dev/theme_surfaces_test.html), and the suites run in a browser against the site's own server, which
 * serves web/client and nothing under docs/. Nothing on a page imports this file, so shipping it costs a
 * visitor nothing; an ES module is only fetched when something imports it.
 *
 * THE SITE'S THEMES, BY THEIR theme.js ID, AND THE ID DESIGN'S FILES USE FOR EACH. The suite fails when
 * theme.js has a theme this list does not name (a theme added without anybody walking this checklist for
 * it), and when this list names one theme.js no longer has. `null` is a site theme Design has not drawn:
 * the four still themes that came before Design's set. They borrow (cards: the Nimrod deck), and the suite
 * names every surface each one borrows rather than letting a fallback hide it.
 */
export const siteThemes = {
  default: 'nimrod',
  dusk: null, contrast: null, warm: null, forge: null,
  fall: 'fall', steampunk: 'steampunk', cyberpunk: 'cyberpunk', cozy: 'cozy', winter: 'winter', ocean: 'ocean',
  night: 'night',
  spring: 'spring', summer: 'summer', newYear: 'newYear', lunarNewYear: 'lunarNewYear', valentines: 'valentines',
  stPatricks: 'stPatricks', easter: 'easter', july4: 'july4', halloween: 'halloween', diwali: 'diwali',
  harvest: 'harvest', hanukkah: 'hanukkah', christmas: 'christmas',
};
