// dashboards.js — THE READY-MADE DASHBOARDS (row 2.34), AS DATA; how one is made the first time a
// person picks it; and a person's dashboards as spoken routes ("computer please go to my room").
//
// Mike, 2026-09-30: *"We should just have multiple prebuilt dashboards. The room being one. Another
// being just a very basic like the original Nimrod theme. Another being like what we currently have
// before rooms. The 2d with options for transparency and live backgrounds. Maybe have a dashboard
// select part in the transport bar where you can jump between them."*
//
// *** OFFERED, NOT FORCED (Code's recommendation on row 2.34, question 2; no answer came, so it is the
// default). *** Nobody is given three dashboards they did not ask for. The picker (dashboard_picker.js,
// opened from the bar's Home button) offers each ready-made one that this person has not made yet
// ("+ Room"); picking it -- by a press, a switch or by voice -- makes it, once, and goes there.
//   FOR made-at-first-sign-in: everything is one press away from the first minute, with nothing to
//     wait for. AGAINST, and it wins: three screens appear in somebody's Dashboards list that they did
//     not make, each with panels that start (a YouTube schedule, a word game) on a screen they never
//     opened -- and "who made these?" is a question the product should never make anybody ask.
//
// *** A PLAIN COPY, NOT A PREFAB (the prefab question stays open, §setting-scope-prefabs). *** Making
// one copies the record below into an ordinary screen: its own modules, its own settings doc, its own
// layout. Changing this file later changes the ready-made one OFFERED, never one somebody already made.
//
// *** EACH CARRIES ITS OWN THEME (row 2.34 chat note (a); step 6 R3). *** On the dashboard path (Stage
// 4) the theme -- and since this change the panel backgrounds -- follow the dashboard that is showing.
// On today's path a swap keeps the boot screen's (kiosk.js `showScreen`: "only the arrangement is
// documented as belonging to the incoming screen"); see the report on Mike's list.
//
// WHAT IS STAMPED. A made dashboard's settings doc carries `prebuilt: '<key>'` (written FIRST, right
// after the screen is created), `prebuiltRefs` (each module's id as it is made) and `prebuiltDone: true`
// (written LAST, with the layout and the theme). So the maker is re-entrant the way game/game.js is: a
// page closed half-way leaves a stamped, unfinished dashboard that the next pick FINISHES rather than
// making a second one; and a screen somebody happened to NAME "My room" has no stamp and is never adopted.

import { normalizeLayout } from './layout.js';
import { THEMES, DEFAULT_THEME } from './theme.js';
import { ROOM_PRESETS, DEFAULT_PRESET as ROOM_DEFAULT_PRESET } from './room_presets.js';
// The 3D room's presets (data only; its renderer is loaded by the arrangement when a dashboard has one).
import { ROOM3D_PRESETS, ROOM3D_DEFAULT_PRESET } from './room3d.js';
import { STARTER_MODULES } from './modules_catalog.js';
import { STARTER_SCHEDULE } from './local_store.js';
import { profileSetup } from './game/game.js';
import { PHRASES, ROUTES, spokenTable, normalize, routeAction, phraseControl, SPEECH_DEVICE } from './input_speech.js';
import { SYSTEM_TOPICS } from './actions.js';
import { DASHBOARD_GO_TOPIC as NEST_GO_TOPIC, SCREEN_BACK_TOPIC, SCREEN_HOME_TOPIC } from './dashboard_nest.js';

export const PANEL_SURFACES = Object.freeze(['solid', 'veil', 'clear']);

// The settings-doc keys the maker writes. Exported so a suite, a diagnostic page and Home can read them.
export const PREBUILT_KEY = 'prebuilt';
export const PREBUILT_REFS_KEY = 'prebuiltRefs';
export const PREBUILT_DONE_KEY = 'prebuiltDone';
// The modules a dashboard keeps in place (2026-10-02, the tutorial): their INSTANCE ids, on the dashboard's
// settings doc. A record names them by ref (`locked: ['nimrod', 'settings']`); the maker writes the ids.
// What "locked" means is home_profile.js's to say (`isLocked`, and the Change tray that honours it).
export const LOCKED_KEY = 'locked';
// The panel a dashboard OPENS with being edited (2026-10-02, the builder; edit_mode.js reads it): its
// INSTANCE id, on the dashboard's settings doc. A record names it by ref (`editPanel: 'editing'`). The same
// string as edit_mode.js's own (dashboards_test checks the two agree); not imported, because edit_mode.js
// brings Nimrod's words (cat_help.js) and the settings reader with it, and every page reads this file.
export const EDIT_PANEL_KEY = 'editPanel';

// =====================================================================================================
// THE THREE, AS DATA. Every value below is a starting point (Rule 1), argued, and on Mike's list:
//
// ROOM ("+ Room")
//   scene     the room the room module calls its default (room_presets.js DEFAULT_PRESET, 'theRoom':
//             Design's room-is-the-screen room, whose furniture carries the controls). Design's four
//             other rooms are the same `scene.preset`, one value away.
//   modules   the profile game's own picture and name sign (game/game.js `profileSetup`: an empty
//             classic frame with no words, and Design's name plate with the person's name). Reused, not
//             copied, so the room and the profile cannot start different.
//   where     both hang on the BACK wall, the picture left of the window and the sign high on the right
//             -- x/y are the centre in % of the room, w/h in %. Code's guess: clear of the window
//             (x 50, y 26) and of the furniture below y 55.
//   theme     the default (cream and green). FOR: the room IS the backdrop, and a live theme would draw a
//             second moving world behind it that nobody sees but the Pi pays for (Design's Pi budget:
//             "one live scene"). AGAINST: the bar and the menu are drawn in the theme's colours, and
//             somebody may want them warmer in a room -- the menu's Colours row changes it.
//   panels    'clear': what hangs in the room should read as a thing ON the wall, not a card in front of it.
// BASIC ("+ Basic")
//   Mike: "a very basic like the original Nimrod theme". The default theme (cream and green), solid panels,
//   no live background; photos and a clock side by side (Design's own Basic: "Photos" and "Clock").
// CLASSIC 2D ("+ Classic 2D")
//   Mike: "what we currently have before rooms. The 2d with options for transparency and live
//   backgrounds." Today's starter screen, exactly (modules_catalog.js STARTER_MODULES in the same four-up
//   order local_store.js seeds, with the same YouTube schedule), see-through panels ('veil') over a live
//   background. WHICH live background: 'fall', the one Design's prototype draws behind its Classic 2D and
//   the first in Mike's own list ("fall, winter, castle..."). Guess.
// =====================================================================================================

// =====================================================================================================
// *** THE STARTING POINTS FOR HOME (Mike, 2026-10-02). *** "I'm expecting the home page to be your profile,
// and you add whatever modules you want to make it your own. Maybe actually start with some premade example
// ones that people can edit however they want ... We want: Static 2D like Nimrod theme, live theme's like
// fall, some of the editable rooms/scenes design built, 3d if possible." So the same records are the
// examples Home offers up front (home_profile.js, modules.html): each is made ONCE, on the pick, as a plain
// copy the person then edits -- the same maker, the same stamp, the same "offered, not forced" rule.
//   `kind` says what sort of starting point it is, so Home can say it in words ('static' 2D, a 'live'
//   2D scene, a 'room'). `title` is what Home's card calls it; `label` stays the bar tray's short name.
//   Two more of Design's rooms (guide-and-rooms, 2026-09-29) join The room: the Study (its wall's own
//   module slot holds your photos) and the Fireside attic (night, snow out of the window, your name over
//   the fireplace). Code's picks of Design's five: three rooms that differ (the controls-in-furniture
//   room, a day room with a module slot, a night room), not three of a kind. Living room and Bedroom are
//   one Scene press away on Home. The positions are Code's, clear of each room's own furniture (checked
//   by picture, `run_suite.py --shot`), and the editor moves anything.
//   3D (2026-10-02): a CSS-3D room (room3d.js, scene kind 'room3d'), after the rooms -- see EXAMPLE_ORDER.
// *** THE BAR'S TRAY STILL OFFERS THREE (PREBUILT_ORDER). *** A tray is a scanning surface: five more stops
// is five more presses before "Close" comes round again for somebody with one switch. Home is where the
// choosing happens; every one made is in the tray afterwards like any dashboard. Guess, on Mike's list.
// =====================================================================================================
export const EXAMPLE_KINDS = Object.freeze({
  static: 'Flat and still',
  live: 'Flat, with a moving scene',
  room: 'A room',
  room3d: 'A room in 3D',
});
// *** THE ORDER EVERY LIST OF STARTING POINTS AND SCENES KEEPS (Mike, 2026-10-02): "The still themes like
// Nimrod light should come first: Still, live, rooms, 3d." *** Home's cards (EXAMPLE_ORDER), the bar's tray
// (PREBUILT_ORDER) and the Scene tray (home_profile.js sceneChoices / SCENE_KINDS) all follow it, and the
// suites check each against it (`inKindOrder`).
export const KIND_ORDER = Object.freeze(['static', 'live', 'room', 'room3d']);
/** True when `kinds` never goes back a step in KIND_ORDER (still, then live, then rooms, then 3D). */
export function inKindOrder(kinds) {
  const at = (k) => KIND_ORDER.indexOf(k);
  return (kinds || []).every((k, i, a) => at(k) >= 0 && (i === 0 || at(a[i - 1]) <= at(k)));
}
// The landing dashboard's key (2026-10-02): what everyone lands on (home_dashboard.js `openOn`).
export const LANDING_KEY = 'start';

export const ROOM_SPOTS = Object.freeze({
  picture: Object.freeze({ x: 28, y: 30, w: 16, h: 24 }),
  sign: Object.freeze({ x: 74, y: 12, w: 22, h: 10 }),
});
// The Fireside attic: the name over the fireplace (the room's own picture frame is below it at y 24),
// your picture to its left, between the left wall (x 16) and that frame.
export const FIRESIDE_SPOTS = Object.freeze({
  picture: Object.freeze({ x: 27, y: 26, w: 13, h: 19 }),
  sign: Object.freeze({ x: 50, y: 7, w: 22, h: 8 }),
});
export const CLASSIC_THEME = 'fall';

// =====================================================================================================
// *** THE LANDING HOME AND THE TUTORIAL (Mike, 2026-10-02, DECISIONS.md second set, item 3). ***
// "The home dashboard that the site lands on clockwise from top left: pictures, settings (launches on
// themes tab), devices, Nimrod." A quad's slots are TL, TR, BL, BR (STARTER_MODULES' order), so clockwise
// from the top left is TL photos, TR settings, BR devices, BL Nimrod: slots [photos, settings, nimrod,
// devices]. (2026-10-02 evening: the PROFILE replaces the pictures top left -- see the record.) It is the FIRST example (EXAMPLE_ORDER), so it is what a new person's Home shows on the stage,
// TRIED, not made -- "offered, not forced" stands: nothing is made on an account by looking, and one press
// (Make this my Home, or Save on the bar) makes it. Code's guess, on Mike's list:
// the other reading, making it at first sign-in, would put a dashboard on every account that signs in once.
//   settings   the settings PANEL (modules/settings.js), opened on its Theme page (`startPage`).
//   devices    modules/devices.js: every device, and where each one is set up.
//   Nimrod     modules/nimrod.js, saying Mike's words (`intro: 'landing'`).
//   look       the plain Nimrod look: the default theme, solid panels. FOR: it is the first thing anybody
//              sees, and four solid panels read as four things. AGAINST: it is the least pretty example;
//              the rooms are one press away and Nimrod's first choices include the theme.
//
// "Have there be a special tutorial dashboard you can always go to that has Nimrod and settings locked into
// the bottom two slots." The same four, with Nimrod BL and the settings BR, both LOCKED (`locked`: on the
// dashboard's settings doc, as instance ids). Locked, argued (home_profile.js has the rest): the edit bar
// does not remove, switch or move them while on this dashboard, and says why. NOT a lock with no key: the
// Change tray offers Unlock, one press, because the person who wants the opposite -- somebody who has
// learned the site and wants this dashboard for something else -- has a perfectly good reason, and a lock
// with no way out is the undismissable-gate failure in a smaller coat. The top two are the pictures and
// the devices, Code's pick (the two things a first visit most often sets up).
//   It is in the bar's tray (PREBUILT_ORDER, LAST, so the three before it keep their places and a switch
//   user's habits) and spoken as "tutorial"; it is not one of Home's cards (Nimrod and the ⚙ menu reach it).
// =====================================================================================================
export const PREBUILT_DASHBOARDS = Object.freeze({
  // *** PROFILE, NOT PICTURES, TOP LEFT (Mike, 2026-10-02 evening: "Four modules clockwise from top left:
  // Profile (I know I said photos before. Changing it.), settings, Devices, Nimrod/AI.") *** Clockwise from the
  // top left is TL profile, TR settings, BR devices, BL Nimrod: slots [profile, settings, nimrod, devices].
  // The profile panel is stored with NO subject on purpose: modules/profile.js then shows whoever is looking
  // (`defaultSubject`), so the one record serves every person rather than naming one.
  start: Object.freeze({
    key: 'start', label: 'Start', name: 'My Home', kind: 'static', title: 'Start here',
    blurb: 'Four to begin with: your profile, the settings, your devices, and Nimrod, who shows you around.',
    modules: [
      { ref: 'profile', type: 'profile' },
      { ref: 'settings', type: 'settings', state: { startPage: 'sc-theme' } },
      { ref: 'nimrod', type: 'nimrod', state: { intro: 'landing' } },
      { ref: 'devices', type: 'devices' },
    ],
    layout: { preset: 'quad', slots: ['profile', 'settings', 'nimrod', 'devices'] },
    settings: { theme: DEFAULT_THEME, panelSurface: 'solid' },
  }),
  tutorial: Object.freeze({
    key: 'tutorial', label: 'Tutorial', name: 'Tutorial', kind: 'static', title: 'The tutorial',
    blurb: 'Nimrod and the settings, always in the bottom two places, with your pictures and your devices above.',
    modules: [
      { ref: 'photos', type: 'photos' },
      { ref: 'devices', type: 'devices' },
      { ref: 'nimrod', type: 'nimrod', state: { intro: 'tutorial' } },
      { ref: 'settings', type: 'settings' },
    ],
    layout: { preset: 'quad', slots: ['photos', 'devices', 'nimrod', 'settings'] },
    locked: ['nimrod', 'settings'],
    settings: { theme: DEFAULT_THEME, panelSurface: 'solid' },
  }),
  room: Object.freeze({
    key: 'room', label: 'Room', name: 'My room', kind: 'room', title: 'The room',
    blurb: 'A room to furnish. Your picture and your name sign hang on its wall.',
    modules: [
      { ref: 'picture', type: 'button', start: 'picture' },
      { ref: 'sign', type: 'button', start: 'sign' },
    ],
    layout: {
      preset: 'full', slots: [null],
      scene: { kind: 'room', preset: ROOM_DEFAULT_PRESET },
      placed: [
        { ref: 'picture', place: 'scene', surface: 'back', ...ROOM_SPOTS.picture },
        { ref: 'sign', place: 'scene', surface: 'back', ...ROOM_SPOTS.sign },
      ],
    },
    settings: { theme: DEFAULT_THEME, panelSurface: 'clear' },
  }),
  basic: Object.freeze({
    key: 'basic', label: 'Basic', name: 'Basic', kind: 'static', title: 'Plain Nimrod',
    blurb: 'The original Nimrod look: cream and green, solid panels, photos and a clock.',
    modules: [
      { ref: 'photos', type: 'photos' },
      { ref: 'clock', type: 'clock' },
    ],
    layout: { preset: 'side', slots: ['photos', 'clock'] },
    settings: { theme: DEFAULT_THEME, panelSurface: 'solid' },
  }),
  classic: Object.freeze({
    key: 'classic', label: 'Classic 2D', name: 'Classic 2D', kind: 'live', title: 'Fall, moving',
    blurb: 'See-through panels over a moving background: photos, videos, a word game and a clock.',
    // STARTER_MODULES is [photos, youtube, wordforge, clock] -- the quad's TL, TR, BL, BR, as seeded.
    modules: STARTER_MODULES.map((type) => (type === 'youtube'
      ? { ref: type, type, state: { schedule: STARTER_SCHEDULE.map((d) => ({ ...d })) } }
      : { ref: type, type })),
    layout: { preset: 'quad', slots: [...STARTER_MODULES] },
    settings: { theme: CLASSIC_THEME, panelSurface: 'veil' },
  }),
  study: Object.freeze({
    key: 'study', label: 'Study', name: 'My study', kind: 'room', title: 'Study',
    blurb: 'Design’s study: brick walls, a desk and an autumn window. Your photos show on the screen on its wall.',
    modules: [{ ref: 'photos', type: 'photos' }],
    layout: {
      preset: 'full', slots: [null],
      scene: { kind: 'room', preset: 'study' },
      // `slot`: the room's own module slot (room_presets.js, the study's `photos` item), so the photos sit
      // exactly where Design drew the screen on the wall.
      placed: [{ ref: 'photos', place: 'scene', slot: 'photos' }],
    },
    settings: { theme: DEFAULT_THEME, panelSurface: 'clear' },
  }),
  fireside: Object.freeze({
    key: 'fireside', label: 'Fireside', name: 'Fireside attic', kind: 'room', title: 'Fireside attic',
    blurb: 'Design’s attic at night: a fire, snow out of the window, your picture and your name on the wall.',
    modules: [
      { ref: 'picture', type: 'button', start: 'picture' },
      { ref: 'sign', type: 'button', start: 'sign' },
    ],
    layout: {
      preset: 'full', slots: [null],
      scene: { kind: 'room', preset: 'fireside' },
      placed: [
        { ref: 'picture', place: 'scene', surface: 'back', ...FIRESIDE_SPOTS.picture },
        { ref: 'sign', place: 'scene', surface: 'back', ...FIRESIDE_SPOTS.sign },
      ],
    },
    settings: { theme: DEFAULT_THEME, panelSurface: 'clear' },
  }),
  // THE 3D ROOM (2026-10-02, Mike's "3d if possible"). room3d.js's box room: CSS 3D transforms, no library.
  // Photos in the back wall's slot and a clock in the left wall's -- the two things the bench Pi was measured
  // with (photos + clock on its walls, 1080p, drift on and off: the table is on Mike's list). The camera
  // drift is OFF here (room3d.js argues why); `layout.scene.options.drift: 'on'` turns it on. The theme
  // is the default: every colour of the room is a theme token, so this one is cream and green.
  room3d: Object.freeze({
    key: 'room3d', label: '3D room', name: 'My 3D room', kind: 'room3d', title: 'A room in 3D',
    blurb: 'A room drawn in 3D, in your colours. Your photos hang on its back wall and a clock on the side wall.',
    modules: [
      { ref: 'photos', type: 'photos' },
      { ref: 'clock', type: 'clock' },
    ],
    layout: {
      preset: 'full', slots: [null],
      scene: { kind: 'room3d', preset: ROOM3D_DEFAULT_PRESET },
      placed: [
        { ref: 'photos', place: 'scene', slot: 'back' },
        { ref: 'clock', place: 'scene', slot: 'left' },
      ],
    },
    settings: { theme: DEFAULT_THEME, panelSurface: 'clear' },
  }),
  // ===================================================================================================
  // *** THE BUILDER (Mike, 2026-10-02). *** "The profile/dashboard/module builder could all be one dashboard
  // clockwise from top left: The module you're editing, settings, modules, Nimrod/AI." A quad's slots are
  // TL, TR, BL, BR, so clockwise from the top left is TL editing, TR settings, BR modules, BL Nimrod:
  // slots [editing, options, nimrod, library].
  //   editing   the module being edited, OPENED IN EDIT MODE (`editPanel`): press a thing in it and its
  //             options show top right. It starts as your name sign (the profile game's sign, with your
  //             name) -- Code's pick: "your profile top left" is Mike's other sentence, and the sign is the
  //             profile piece with the most to choose on it (words, font, colour, sign). Switch module puts
  //             any other module there to edit it instead. On Mike's list.
  //   options   modules/edit_options.js: the options of what is chosen (the settings panel's place, see
  //             that file for why it is its own module this round).
  //   library   modules/library_slot.js: the modules library, mounted inside it once it is registered.
  //   Nimrod    the guide, as on the landing dashboard and the tutorial (`intro: 'tutorial'`: his tutorial
  //             hello, the nearest of his two to "you are building something").
  //   look      the plain Nimrod look, solid panels: options are read, and read best on solid.
  // Nothing locked: it is a workbench, and everything on it is somebody's to change. Not a Home card (it is
  // not a Home); reached from Home's ⚙ menu ("The builder…") and by voice ("open the builder").
  // ===================================================================================================
  builder: Object.freeze({
    key: 'builder', label: 'Builder', name: 'Builder', kind: 'static', title: 'The builder',
    blurb: 'Edit one thing at a time: what you are editing top left, its options top right, the modules library bottom right and Nimrod bottom left.',
    modules: [
      { ref: 'editing', type: 'button', start: 'sign' },
      { ref: 'options', type: 'options' },
      { ref: 'nimrod', type: 'nimrod', state: { intro: 'tutorial' } },
      { ref: 'library', type: 'library_slot' },
    ],
    layout: { preset: 'quad', slots: ['editing', 'options', 'nimrod', 'library'] },
    editPanel: 'editing',
    settings: { theme: DEFAULT_THEME, panelSurface: 'solid' },
  }),
});

// The order the bar's tray offers them in. 2026-10-02 (Mike: "Still, live, rooms, 3d"): Basic (still),
// Classic 2D (moving), the room -- then the tutorial, LAST ("a special tutorial dashboard you can always go
// to"), which is a place to go rather than a look. It was the room first (row 2.34: "the new thing"); Mike's
// order replaces that, so a switch user's habit of the room being the first stop changes once.
// (Not the rooms or the builder: see the block above EXAMPLE_KINDS -- a tray is a scanning surface.)
export const PREBUILT_ORDER = Object.freeze(['basic', 'classic', 'room', 'tutorial']);

// The order HOME offers its starting points in: Mike's own list, in his order (static 2D, a live theme,
// Design's rooms, then 3D). 3D is the CSS-3D room (room3d.js), appended after the rooms once the bench Pi
// held it at 1080p with drift on (2026-10-02, the numbers on Mike's list). A WebGL room would need three.js
// vendored (~650 KB) -- still Mike's call, and not what this card is.
// 2026-10-02 (second set): the landing Home ('start') goes FIRST -- it is what the site lands on.
// 2026-10-02 (third set): "Still, live, rooms, 3d" -- which this already is: the two still ones (the landing
// and Plain Nimrod, both the Nimrod light theme), the moving one, Design's rooms, the 3D room. Checked by
// `inKindOrder` in the suites so a new card cannot quietly land out of place.
export const EXAMPLE_ORDER = Object.freeze(['start', 'basic', 'classic', 'room', 'study', 'fireside', 'room3d']);

/** Home's cards: one per starting point, in EXAMPLE_ORDER, in words (`kindLabel`). */
export function exampleCards(order = EXAMPLE_ORDER) {
  return order.filter((k) => PREBUILT_DASHBOARDS[k]).map((k) => {
    const r = PREBUILT_DASHBOARDS[k];
    return { key: k, title: r.title || r.label, blurb: r.blurb, kind: r.kind, kindLabel: EXAMPLE_KINDS[r.kind] || '', name: r.name };
  });
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** One ready-made dashboard as a concrete record (a deep copy, so nothing edits the table): the picture
 *  and the sign get the profile game's starting settings, the sign with `personName` on it. */
export function prebuiltRecord(key, { personName = '' } = {}) {
  const base = PREBUILT_DASHBOARDS[key];
  if (!base) return null;
  const rec = clone(base);
  const setup = profileSetup(personName);
  for (const m of rec.modules) {
    if (m.start === 'picture') m.state = { ...setup.picture };
    else if (m.start === 'sign') m.state = { ...setup.sign };
    delete m.start;
  }
  return rec;
}

/** The record's layout with module REFS turned into instance ids (`refs`: ref -> id), normalised the way
 *  every saved layout is -- so what is saved is exactly what layout.js would keep. */
export function layoutFor(rec, refs = {}) {
  const L = rec.layout || {};
  const raw = {
    preset: L.preset,
    slots: (L.slots || []).map((r) => (r ? refs[r] || null : null)),
    ...(L.scene ? { scene: clone(L.scene) } : {}),
    ...(Array.isArray(L.placed) ? {
      placed: L.placed.map(({ ref, ...e }) => ({ ...e, id: refs[ref] })).filter((e) => e.id),
    } : {}),
  };
  return normalizeLayout(raw, Object.values(refs));
}

/** The record's locked refs as instance ids (`refs`: ref -> id); refs with no id are left out. */
export function lockedIds(rec, refs = {}) {
  return (Array.isArray(rec?.locked) ? rec.locked : []).map((r) => refs[r]).filter(Boolean);
}

/** The record's settings doc as made, with its refs turned into instance ids: the lock list and the panel
 *  it opens with being edited. What the maker writes, and what a preview of it is seeded with. */
export function recordSettings(rec, refs = {}) {
  const out = { ...(rec?.settings || {}) };
  if (Array.isArray(rec?.locked)) out[LOCKED_KEY] = lockedIds(rec, refs);
  if (rec?.editPanel && refs[rec.editPanel]) out[EDIT_PANEL_KEY] = refs[rec.editPanel];
  return out;
}

/** A settings row's instance ids renamed by `map` (oldId -> newId): what a preview's ids become when it is
 *  made. Only the keys that hold ids (the lock list, the panel being edited); the rest is left as it is. */
export function remapSettingsIds(row, map = {}) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (Array.isArray(out[LOCKED_KEY])) out[LOCKED_KEY] = out[LOCKED_KEY].map((id) => map[id] || id);
  if (typeof out[EDIT_PANEL_KEY] === 'string' && map[out[EDIT_PANEL_KEY]]) out[EDIT_PANEL_KEY] = map[out[EDIT_PANEL_KEY]];
  return out;
}

/**
 * WHAT IS WRONG WITH A RECORD, as sentences (empty = valid). The suite runs it over all three, so a
 * record that names a module nobody registered, a theme that is gone, a room that is not a room, or a
 * layout that would silently drop one of its own modules fails a check rather than a person's screen.
 * `knownTypes` (optional): the registered module types.
 */
export function recordProblems(rec, { knownTypes = null } = {}) {
  const out = [];
  if (!rec || typeof rec !== 'object') return ['not a record'];
  if (!rec.key || !PREBUILT_DASHBOARDS[rec.key]) out.push(`unknown key ${rec.key}`);
  for (const k of ['label', 'name', 'blurb', 'title']) if (typeof rec[k] !== 'string' || !rec[k].trim()) out.push(`no ${k}`);
  if (!EXAMPLE_KINDS[rec.kind]) out.push(`kind ${rec.kind} is not one of ${Object.keys(EXAMPLE_KINDS).join('/')}`);
  const refs = {};
  const mods = Array.isArray(rec.modules) ? rec.modules : [];
  if (!mods.length) out.push('no modules');
  for (const m of mods) {
    if (!m || !m.ref || !m.type) { out.push('a module without a ref or a type'); continue; }
    if (refs[m.ref]) out.push(`ref ${m.ref} twice`);
    if (knownTypes && !knownTypes.has(m.type)) out.push(`${m.type} is not a registered module`);
    refs[m.ref] = `id-${m.ref}`;
  }
  const L = rec.layout || {};
  const usedRefs = [...(L.slots || []).filter(Boolean), ...(L.placed || []).map((p) => p.ref)];
  for (const r of usedRefs) if (!refs[r]) out.push(`the layout names ${r}, which is not one of its modules`);
  // A lock names modules that are ON the dashboard (a lock on something not shown keeps nothing in place).
  if (rec.locked !== undefined) {
    if (!Array.isArray(rec.locked)) out.push('locked is not a list');
    else for (const r of rec.locked) if (!usedRefs.includes(r)) out.push(`locked names ${r}, which is not on the dashboard`);
  }
  // The panel it opens with being edited is one of its own, ON the dashboard.
  if (rec.editPanel !== undefined && !(typeof rec.editPanel === 'string' && usedRefs.includes(rec.editPanel))) {
    out.push(`editPanel names ${rec.editPanel}, which is not on the dashboard`);
  }
  const lay = layoutFor(rec, refs);
  const kept = [...lay.slots.filter(Boolean), ...(lay.placed || []).map((p) => p.id)];
  if (kept.length !== usedRefs.length) out.push(`the layout keeps ${kept.length} of its ${usedRefs.length} modules`);
  if (L.scene && L.scene.kind === 'room3d') {
    // The 3D room: a preset room3d.js has, a scene that survives normalizeLayout, slots it really has.
    if (!ROOM3D_PRESETS[L.scene.preset]) out.push(`3D room ${L.scene.preset} does not exist`);
    if (!lay.scene || lay.scene.kind !== 'room3d') out.push('the scene does not survive normalizeLayout');
    const slots = ROOM3D_PRESETS[L.scene.preset]?.recipe?.slots || [];
    for (const p of L.placed || []) {
      if (p.slot && !slots.some((s) => s.id === p.slot)) out.push(`the 3D room has no slot called ${p.slot}`);
    }
  } else if (L.scene) {
    if (L.scene.kind !== 'room') out.push(`scene ${L.scene.kind} is not a room`);
    else if (!ROOM_PRESETS[L.scene.preset]) out.push(`room ${L.scene.preset} does not exist`);
    if (!lay.scene) out.push('the scene does not survive normalizeLayout');
    // A module placed IN one of the room's slots: that slot has to be an item of that room.
    const items = ROOM_PRESETS[L.scene.preset]?.recipe?.items || [];
    for (const p of L.placed || []) {
      if (p.slot && !items.some((it) => it.id === p.slot)) out.push(`the room has no slot called ${p.slot}`);
    }
  } else if ((L.placed || []).some((p) => p.slot)) {
    out.push('a module is placed in a room slot, but there is no room');
  }
  if (rec.kind === 'room' && !(L.scene && L.scene.kind === 'room')) out.push('a room with no room scene');
  if (rec.kind === 'room3d' && !(L.scene && L.scene.kind === 'room3d')) out.push('a 3D room with no 3D room scene');
  const s = rec.settings || {};
  if (!s.theme || !THEMES[s.theme]) out.push(`theme ${s.theme} does not exist`);
  if (!PANEL_SURFACES.includes(s.panelSurface)) out.push(`panel backgrounds ${s.panelSurface} is not one of ${PANEL_SURFACES.join('/')}`);
  return out;
}

/**
 * MAKING ONE, THE FIRST TIME IT IS PICKED. Over the four factories every page shares (the same ones
 * game/game.js takes), so signed in and signed out run this identical code:
 *   profiles                  the screens client: list, get, create, addModule
 *   makeSettings(pid)         a screen's settings doc
 *   makeInstanceState(pid, id) one module instance's state
 *   personId(), personName()  whose they are (read when used; a kiosk learns them after it boots)
 * Returns { made(list), offered(list), ensure(key), stampOf(pid) }.
 */
export function createDashboardMaker({ profiles, makeSettings, makeInstanceState,
                                       personId = () => '', personName = () => '' } = {}) {
  if (!profiles || typeof makeSettings !== 'function' || typeof makeInstanceState !== 'function') {
    throw new Error('createDashboardMaker: profiles, makeSettings and makeInstanceState are required');
  }
  const read = (v) => { try { return (typeof v === 'function' ? v() : v) || ''; } catch { return ''; } };
  const stamps = new Map();          // pid -> { key, refs, done } | null   (read once per screen)
  const inflight = new Map();        // key -> Promise: a second pick while the first is making it waits

  async function withDoc(handle, fn) {
    await Promise.resolve(handle?.load?.()).catch(() => {});
    try {
      const out = await fn(handle);
      await Promise.resolve(handle?.flush?.()).catch(() => {});
      return out;
    } finally { try { handle?.destroy?.(); } catch { /* gone */ } }
  }
  const readDoc = (pid) => withDoc(makeSettings(pid), (h) => ({ ...(h?.get?.() || {}) }));
  const patchDoc = (pid, fn) => withDoc(makeSettings(pid), (h) => { h.set(fn(h.get?.() || {})); });

  async function stampOf(pid) {
    if (stamps.has(pid)) return stamps.get(pid);
    let s = {};
    try { s = await readDoc(pid); } catch { s = {}; }
    const st = typeof s[PREBUILT_KEY] === 'string' && PREBUILT_DASHBOARDS[s[PREBUILT_KEY]]
      ? { key: s[PREBUILT_KEY], refs: { ...(s[PREBUILT_REFS_KEY] || {}) }, done: s[PREBUILT_DONE_KEY] === true }
      : null;
    stamps.set(pid, st);
    return st;
  }
  // This person's screens only: a room made for somebody else on the account is not this person's room.
  const mine = (s) => !read(personId) || !s.person_id || s.person_id === read(personId);

  /** key -> { id, name, done } for each ready-made one this person already has (the first, if two). */
  async function made(list) {
    const out = {};
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || !s.id || !mine(s)) continue;
      const st = await stampOf(s.id);
      if (st && !out[st.key]) out[st.key] = { id: s.id, name: s.name, done: st.done };
    }
    return out;
  }
  /** The keys still to offer, in PREBUILT_ORDER. Reads; never makes anything. */
  async function offered(list) {
    const m = await made(list);
    return PREBUILT_ORDER.filter((k) => !m[k]);
  }

  async function build(key) {
    let list = [];
    try { list = (await profiles.list()) || []; } catch { list = []; }
    const have = (await made(list))[key];
    if (have && have.done) return { id: have.id, created: false };
    const rec = prebuiltRecord(key, { personName: read(personName) });
    let pid = have ? have.id : null;
    let created = false;
    if (!pid) {
      const s = await profiles.create(rec.name, read(personId));
      pid = s.id; created = true;
      // STAMP FIRST: from here on, a page that dies half-way leaves a screen the next pick finishes.
      await patchDoc(pid, () => ({ [PREBUILT_KEY]: key, [PREBUILT_REFS_KEY]: {} }));
      stamps.set(pid, { key, refs: {}, done: false });
    }
    const screen = await profiles.get(pid);
    const ids = new Set(((screen && screen.modules) || []).map((m) => m.id));
    const doc = await readDoc(pid);
    const refs = { ...(doc[PREBUILT_REFS_KEY] || {}) };
    for (const m of rec.modules) {
      if (refs[m.ref] && ids.has(refs[m.ref])) continue;
      const mod = await profiles.addModule(pid, m.type);
      // Its starting settings go in BEFORE anything can mount it (game/game.js's order).
      if (m.state) await withDoc(makeInstanceState(pid, mod.id), (h) => { h.set({ ...m.state }); });
      refs[m.ref] = mod.id;
      await patchDoc(pid, () => ({ [PREBUILT_REFS_KEY]: { ...refs } }));
    }
    const layout = layoutFor(rec, refs);
    // DONE LAST, with the arrangement and the look, in one write.
    await patchDoc(pid, (cur) => ({
      ...recordSettings(rec, refs),
      kiosk: { ...(cur.kiosk || {}), layout },
      [PREBUILT_KEY]: key, [PREBUILT_REFS_KEY]: { ...refs }, [PREBUILT_DONE_KEY]: true,
    }));
    stamps.set(pid, { key, refs: { ...refs }, done: true });
    return { id: pid, created };
  }

  /** The ready-made dashboard `key` for this person: found if they have it, made (once) if not.
   *  Resolves { id, created }. Two picks at once make ONE (the second waits on the first). */
  function ensure(key) {
    if (!PREBUILT_DASHBOARDS[key]) return Promise.reject(new Error(`no ready-made dashboard called "${key}"`));
    if (inflight.has(key)) return inflight.get(key);
    const p = build(key).finally(() => { inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  return { made, offered, ensure, stampOf, forget: (pid) => stamps.delete(pid) };
}

// =====================================================================================================
// SPOKEN: "computer please go to my room" -- input_speech.js's ROUTES shape, added at runtime the way the
// music favourites are (kiosk.js `applyDashboards`), never written into anybody's bindings.
// =====================================================================================================

/** Payload `{ id }` (a dashboard) or `{ prebuilt: '<key>' }` (a ready-made one: found, or made once).
 *  Defined in dashboard_nest.js since row 2.38 (the room, the arrangement and the dashboard module publish
 *  it too, and that file imports nothing); re-exported here, where it has always been imported from. */
export const DASHBOARD_GO_TOPIC = NEST_GO_TOPIC;
// "go to" / "open" + the dashboard's name. A setting would be the next step (music's are); argued: two
// starters cover what people say, and a third ("show") collides with "show the menu"-shaped commands.
export const DEFAULT_GO_STARTERS = Object.freeze(['go to', 'open']);

// The ready-made ones, by phrase, whether or not they exist yet ("go to my room" makes it the first time:
// that IS picking it). Four words at most, plain lowercase (speech_test's rule for every route).
// [unverified on the bench: "dashboards" and "classic" in the small Vosk model.]
export const PREBUILT_ROUTES = Object.freeze({
  'dashboard-room': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'room' }, label: 'Go to the room',
    phrases: ['go to my room', 'go to the room', 'show me my room', 'open my room'] },
  'dashboard-basic': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'basic' }, label: 'Go to the basic dashboard',
    phrases: ['go to basic', 'basic dashboard', 'open basic'] },
  'dashboard-classic': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'classic' }, label: 'Go to the classic dashboard',
    phrases: ['go to classic', 'classic dashboard', 'open classic'] },
  // 2026-10-02: Mike, "a special tutorial dashboard you can always go to", reached "by voice 'tutorial'".
  // The bare word is a phrase on purpose: it is the one word somebody lost on the site will say.
  // [unverified on the bench: "tutorial" in the small Vosk model.]
  'dashboard-tutorial': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'tutorial' }, label: 'Go to the tutorial',
    phrases: ['tutorial', 'go to the tutorial', 'open the tutorial', 'show me the tutorial'] },
  // 2026-10-02: the builder. Never the bare word "builder": "word builder" is a game, and a recogniser that
  // hears half of it must not open the wrong thing. [unverified on the bench: "builder" in the small model.]
  'dashboard-builder': { topic: DASHBOARD_GO_TOPIC, payload: { prebuilt: 'builder' }, label: 'Go to the builder',
    phrases: ['open the builder', 'go to the builder', 'show me the builder', 'module builder'] },
  // The picker itself: the same `system/dashboards` a switch or a room's object sends.
  'dashboard-picker': { topic: SYSTEM_TOPICS.dashboards, payload: {}, label: 'Choose a dashboard',
    phrases: ['my dashboards', 'show my dashboards', 'choose a dashboard', 'change dashboard'] },
});

// *** ROW 2.38: THE WAY BACK, SPOKEN. *** Once an object can open another dashboard a person can be several
// dashboards deep, and "the way back is always there" (chat's §7.3.4) has to include the voice.
//   "go back" ALREADY EXISTS -- it is the `back` verb (input_speech.js PHRASES), and it is reused: kiosk.js
//     sends an UNANSWERED `back` (the panel in front of you has nothing to cancel) back along the trail. So
//     these are only the phrases that cannot mean anything else: "previous dashboard", "go home".
//   "go home" is new: nothing else said it. Home = the dashboard this screen started on.
// [unverified on the bench: "dashboard" in the small Vosk model, as for the routes above.]
export const NAV_ROUTES = Object.freeze({
  'dashboard-back': { topic: SCREEN_BACK_TOPIC, payload: {}, label: 'Back to the previous dashboard',
    phrases: ['previous dashboard', 'last dashboard', 'back a dashboard', 'go back a dashboard'] },
  'dashboard-home': { topic: SCREEN_HOME_TOPIC, payload: {}, label: 'Home: the dashboard this screen started on',
    phrases: ['go home', 'go to home', 'take me home', 'home dashboard'] },
});

const ACTION_SAFE = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 36);

/**
 * THE PERSON'S DASHBOARDS AS SPOKEN ROUTES, plus the ready-made ones. Returns `{ routes, skipped }`
 * (music_favourites.js's shape). `list` is what the picker lists ([{ id, name }]).
 *
 * *** A DASHBOARD'S OWN NAME WINS OVER A READY-MADE PHRASE. *** The person's dashboards are made first;
 * a ready-made phrase already taken by one of them is dropped from the ready-made route. So somebody
 * who has their own screen called "My room" goes to THEIRS on "go to my room", never to a new room made
 * behind their back. (A made room is itself called "My room", so the two then agree.)
 * `taken`: every phrase already spoken for (default: input_speech's verbs and routes). Nothing made here
 * can duplicate one -- `duplicatePhrases` over the combined table stays empty.
 */
export function dashboardSpeechRoutes(list, { starters = DEFAULT_GO_STARTERS, taken = spokenTable(PHRASES, ROUTES),
                                              prebuilt = true, nav = true } = {}) {
  const used = new Map();
  for (const [id, phrases] of Object.entries(taken || {})) {
    for (const p of Array.isArray(phrases) ? phrases : []) { const k = normalize(p); if (k) used.set(k, `taken:${id}`); }
  }
  const routes = {};
  const skipped = [];
  const starts = (Array.isArray(starters) ? starters : [starters]).map(normalize).filter(Boolean);
  const seenIds = new Set();
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || !d.id) continue;
    let rid = `dashboard-go-${ACTION_SAFE(d.id)}`;
    if (seenIds.has(rid)) continue;
    seenIds.add(rid);
    const n = String(d.name || '').trim();
    if (!n) continue;
    if (/\d/.test(n)) { skipped.push({ name: n, phrase: null, why: 'digits' }); continue; }
    const nn = normalize(n);
    if (nn.replace(/ /g, '').length < 3) { skipped.push({ name: n, phrase: null, why: 'short' }); continue; }
    const phrases = [];
    for (const st of starts) {
      const p = `${st} ${nn}`;
      const owner = used.get(p);
      if (owner === rid) continue;
      if (owner) { skipped.push({ name: n, phrase: p, why: owner.startsWith('taken:') ? 'taken' : 'twice' }); continue; }
      used.set(p, rid);
      phrases.push(p);
    }
    if (phrases.length) routes[rid] = { topic: DASHBOARD_GO_TOPIC, payload: { id: d.id, name: n }, label: `Go to ${n}`, phrases };
  }
  const tables = [...(prebuilt ? [PREBUILT_ROUTES] : []), ...(nav ? [NAV_ROUTES] : [])];
  for (const table of tables) {
    for (const [rid, r] of Object.entries(table)) {
      const phrases = r.phrases.filter((p) => { const k = normalize(p); if (used.has(k)) return false; used.set(k, rid); return true; });
      if (phrases.length) routes[rid] = { ...r, payload: { ...r.payload }, phrases };
    }
  }
  return { routes, skipped };
}

/** The routes as actions (input_speech's SPEECH_ACTIONS shape), for `registry.registerAll`. */
export function dashboardSpeechActions(routes) {
  return Object.entries(routes || {}).map(([id, r]) => ({
    id: routeAction(id), label: r.label, topic: r.topic, payload: r.payload, group: 'Spoken',
  }));
}

/** The routes' bindings (input_speech's ROUTE_BINDINGS shape): runtime extras, never saved. */
export function dashboardSpeechBindings(routes) {
  return Object.entries(routes || {}).map(([id, r]) => ({
    id: `default/speech-${id}`,
    actionId: routeAction(id),
    device: SPEECH_DEVICE,
    control: phraseControl(id),
    edge: 'press',
    role: 'universal',
    holdMs: 0, debounceMs: 0, lockoutMs: 0,
    label: `Say “${r.phrases[0]}”`,
  }));
}

/** What the routes make speakable, so a host re-attaches speech only when it changed. */
export function dashboardsSignature(routes) {
  return JSON.stringify(Object.entries(routes || {}).map(([id, r]) => [id, r.phrases]).sort());
}

// =====================================================================================================
// THE ONE SETTING (Rule 1): whether the picker offers the ready-made ones at all. ON by default -- they
// are how anybody finds them; OFF for a screen whose person scans by switch and does not want three more
// stops in the tray (each made one is still in the list, as any dashboard is).
// =====================================================================================================
export const DASHBOARD_OFFERS_KEY = 'dashboardOffers';
export const DASHBOARD_OFFERS_FIELD = Object.freeze({
  key: DASHBOARD_OFFERS_KEY, label: 'Offer the ready-made dashboards (Basic, Classic 2D, Room, Tutorial) under Home',
  kind: 'toggle', level: 'advanced', default: true, onLabel: 'Yes', offLabel: 'No',
});
export const offersOn = (row) => !(row && row[DASHBOARD_OFFERS_KEY] === false);
