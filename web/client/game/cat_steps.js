// game/cat_steps.js — NIMROD THE CAT'S WALK THROUGH YOUR PROFILE, ON HOME, AS DATA.
//
// Change list row 2.26 (d) and §cat-walkthrough. Mike, 2026-09-29, "Yes" to: Nimrod the cat is the
// guide; the walk teaches the SETTINGS MENU and the TRANSPORT BAR, on the name sign and the picture;
// the cat appears only when asked ("Show me how") or at a quest step, never uninvited; always
// dismissible; how chatty it is is a setting; and its words also go through the output bus so someone
// who cannot read the bubble hears them.
//
// *** IT WALKS HOME NOW, NOT THE GAME PAGE (rows 2.29/2.30 follow-up, 2026-09-30). *** Your profile
// lives on Home (the modules page): it opens there as a preview and Save makes it, so the four buttons
// the walk used to point at on `/game/` (Make it, Hang it, Put it up, Open it) did the same thing a
// second way, and are gone. Every target below is one of HOME's real controls: the transport bar the
// profile's embedded kiosk places (`modules/transport_bar.js`), the page's own buttons on it
// (`data-host`, drawn from the page's host: Save, Modules...), and the one ⚙ menu, docked beside the
// stage. `dev/cat_guide_test.html` mounts a real embedded kiosk with Home's host and checks each one.
//
// SAME SHAPE AS `steps.js` — id, page, target, action, say, note — because it runs on the same engine
// (`tour.js`, via `cat_guide.js`). The cat's own fields:
//
//   brief / say / more   the words at each chattiness level: "a few words" shows `brief`, "some"
//                        (the default) shows `say`, "lots" shows `say` and then `more`.
//   pose                 'wave' | 'talking' | 'thinking' | 'happy' | 'point' (default 'point'
//                        when there is a target: the paw turns toward the ring, see poseToward).
//   doneWhen             a selector; when it matches, the person has done this step, and the cat
//                        moves on by itself (and skips it on arrival if it is already done).
//
// A `target` may be a LIST: the first selector that is on the page with a size wins, so a step points
// at a row inside the settings menu while the menu is open and at the gear while it is not.
//
// *** THE NEW FLOW (Mike, 2026-10-02: "The profiles are wrong ... I'm expecting the home page to be your
// profile, and you add whatever modules you want to make it your own"). *** The walk no longer dresses a
// picture frame and a name sign. It starts at the starting points (pick one: Make this my Home), then the
// bar, Modules, Panel ▸, ⚙ Edit, what the menu changes, and Design's edit bar: Scene, Add, and Switch
// module (the hot swap). The step ids that stayed keep their ids, so a walk saved half-way resumes.
//
// HOW MANY STEPS (11) IS A DEFAULT, NOT A RULE: make your Home, the bar, Modules, Panel, the gear, the
// menu, Scene, Add, Switch module, Save, goodbye. Each teaches one move. Fewer would put two moves in one
// sentence; the "lots" level is where extra words go.
//
// *** WHAT MIKE ASKED OF THE WALK, AND WHERE IT IS KEPT: *** no hello slide -- it opens on making the
// profile (2026-09-29: "That first slide is kind of unnecessary. Start with the make my profile");
// a Back button (`cat_guide.js` `backButton`); and the bar showing whenever he points at it (the host's
// `holdBar`: the kiosk's seam, which also holds the PLACED bar, which tucks itself away in full screen).
// The walk is started from Home's ⚙ menu (This page -> Show me how) and the welcome card, both reachable
// by a switch; Next alone always ends it, and nobody touching the page closes him after his rest time.

export const GAME_PAGE = '/game/';
// HOME, looking at your profile. The page passes this as the cat's path only while the profile is what
// is on the stage; looking at any other module it passes something else, and he waits with a link back.
export const HOME_PAGE = '/modules.html';
// Where "Open my profile" goes: Home, with the profile asked for by name (`home_dashboard.js`
// `homeLanding`: `?m=profile` is the profile).
export const HOME_PROFILE_URL = '/modules.html?m=profile';
// A PAGE TOKEN the real kiosk (`kiosk.html`) passes on the profile's own screen (`catPathOnKiosk`).
// No step lives there any more, so on a kiosk he waits with a link to Home.
export const PROFILE_PAGE = 'profile';
// The profile's screen id, remembered in this browser so the kiosk can tell.
export const CAT_PROFILE_KEY = 'nimrod:catProfile';
// What "inside the bar" means for holding it (`mountCat`'s `barSelector`): Home's placed bar, or a
// kiosk's own bar.
export const CAT_BAR_SELECTOR = '.tb-bar, [data-controls]';

const IN = '#stage';
const BAR = `${IN} .tb-bar`;
const HOST = (act) => `${IN} .tb-bar [data-host="${act}"]`;
const SHELL = (act) => `${IN} .tb-bar [data-act="${act}"]`;
// The one menu, open: docked beside the stage (settings_menu.js moves it into `.sm-dock`), or the
// shell's own overlay if no menu module is placed.
const MENU_ROOTS = [`${IN} .sm-dock > [data-settings] > [data-scrim]:not([hidden])`,
  `${IN} .kiosk > [data-settings] > [data-scrim]:not([hidden])`];
const MENU_OPEN = MENU_ROOTS.join(', ');
const MENU_PANEL = MENU_ROOTS.map((m) => `${m} [data-panel]`).join(', ');
// The page says whether your Home exists yet (modules.html paints it on <body>).
export const PROFILE_MADE = '[data-home-profile="made"]';
// Home's starting points (up front on the page) and Design's edit bar (above the stage, in edit view).
const EXAMPLE_MAKE = '#examples:not([hidden]) [data-ex-make]';
const EDIT = (act) => `#home-edit:not([hidden]) [data-edit="${act}"]`;

export const CAT_STEPS = [
  { id: 'cat-profile', page: HOME_PAGE, target: [EXAMPLE_MAKE, HOST('save')], action: 'click', doneWhen: PROFILE_MADE,
    brief: 'Pick an example: Make this my Home.',
    say: 'First, your Home. It is your profile: a dashboard you make your own. Pick one of the examples '
       + 'and press Make this my Home. Try it here shows one on the stage first.',
    more: 'Picking one again never makes a second copy. If the examples are closed, Save on the bar makes '
        + 'the one on the stage. You can close me any time with Close or the Escape key.',
    note: 'The first step (no hello slide). Done as soon as a Home exists, so it is skipped for somebody '
        + 'who has one already. Points at the first "Make this my Home", or at Save when the examples are shut.' },

  { id: 'cat-bar', page: HOME_PAGE, target: BAR, action: 'none',
    brief: 'This is the bar.',
    say: 'This is the bar. Every screen has one, with the same buttons in the same places. On Home it '
       + 'also carries Modules, Save, Save as, History and Switch module.',
    more: 'In full screen it tucks itself away after a few seconds. Touch the screen, press a key or '
        + 'press a switch to bring it back.',
    note: 'The kiosk keeps the bar showing while he points at it (`holdBar`), placed bar included.' },

  { id: 'cat-modules', page: HOME_PAGE, target: HOST('picker'), action: 'none',
    brief: 'Modules chooses what you look at.',
    say: 'Modules, at the start of the bar, chooses what you are looking at: your Home, or any other '
       + 'part on its own. Your Home is always first.',
    more: 'Looking at a part never adds it to anything. Save does.' },

  { id: 'cat-panel', page: HOME_PAGE, target: SHELL('panel'), action: 'click',
    brief: 'Press Panel to outline a thing.',
    say: 'Press Panel ▸ to move the outline from one thing on your Home to the next. That chooses which '
       + 'thing the other buttons work on.',
    more: 'Each press moves the outline on to the next thing on the screen, and round again.' },

  { id: 'cat-gear', page: HOME_PAGE, target: SHELL('settings'), action: 'click', doneWhen: MENU_OPEN,
    brief: 'Press ⚙ Edit.',
    say: 'Now press ⚙ Edit. It opens the settings menu, and the editing tools above your Home.',
    more: 'The M key opens it too. When it is already open, I skip this.' },

  { id: 'cat-settings', page: HOME_PAGE, action: 'none', target: [MENU_PANEL, SHELL('settings')],
    brief: 'The menu changes what is outlined.',
    say: 'The menu changes whatever is outlined. On a picture, Picture opens your pictures: the ones you used '
       + 'last, one from this device, or a folder; Frame hangs it in a picture frame, on a TV or on a monitor. '
       + 'On a sign, Words changes what it says.',
    more: 'Each press of a row steps to its next choice. What you change here waits for Save, so trying '
        + 'things costs nothing.' },

  { id: 'cat-scene', page: HOME_PAGE, action: 'none', target: [EDIT('scene'), SHELL('settings')],
    brief: 'Scene changes what is behind everything.',
    say: 'Scene changes what is behind everything: one of the rooms, a moving scene like Fall, or a still '
       + 'one. A room has its own walls, floor and light to change.',
    more: 'Things on the screen come along: going to a room hangs them on its wall.' },

  { id: 'cat-add', page: HOME_PAGE, action: 'none', target: [EDIT('add'), SHELL('settings')],
    brief: 'Add puts a module on.',
    say: 'Add puts a module on your Home: photos, a clock, a game, a picture frame or a name sign. That is '
       + 'how it becomes yours.',
    more: 'Change, next to it, moves a thing, makes it bigger or smaller, or takes it off. Transform types '
        + 'the numbers.' },

  { id: 'cat-switch', page: HOME_PAGE, action: 'none', target: [HOST('switch'), EDIT('change')],
    brief: 'Switch module swaps the outlined thing.',
    say: 'Switch module, on the bar, swaps the outlined thing for another module in exactly the same place. '
       + 'Choose the new one, and it is done.',
    more: 'Undo puts the old one back, with its settings.' },

  { id: 'cat-save', page: HOME_PAGE, action: 'none', target: HOST('save'),
    brief: 'Press Save to keep settings.',
    say: 'What is on your Home, and where, keeps as you change it. Settings wait for Save: press Save to '
       + 'keep them, or Save as… for a copy under a new name. History has your last saves.',
    more: 'Restoring an old save deletes nothing: it opens as unsaved changes, and saving it adds a new '
        + 'one on top.' },

  { id: 'cat-done', page: HOME_PAGE, target: null, action: 'none', pose: 'happy',
    brief: 'That’s it. Ask me again any time.',
    say: 'That’s it. Modules chooses what, the bar moves between things, ⚙ Edit changes how, and Switch '
       + 'module swaps one thing for another.',
    more: 'If you want me again, it is Show me how in the ⚙ menu, under This page.' },
];

/**
 * Where the cat sends somebody whose next step is on another page. Every step is on Home now, so the
 * link is always the profile on Home. (`storage` is kept in the signature: kiosk.html passes nothing.)
 */
export function catGoThere(storage = null) { // eslint-disable-line no-unused-vars
  return (page) => {
    if (page === HOME_PAGE || page === PROFILE_PAGE) {
      return { say: 'I show you around on Home, on your own Home. Open it and I’ll carry on there.',
        label: 'Open my Home', href: HOME_PROFILE_URL };
    }
    if (page === GAME_PAGE) return { say: 'This part is on the game page.', label: 'The game', href: GAME_PAGE };
    return null;
  };
}

/**
 * On the kiosk (`kiosk.html`): which page token this screen is. The walk lives on Home now, so neither
 * answer matches a step, and the cat waits there with the link to Home; kept so kiosk.html is unchanged.
 */
export function catPathOnKiosk(screenId, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  let want = null;
  try { want = storage?.getItem(CAT_PROFILE_KEY) || null; } catch { want = null; }
  return !want || want === screenId ? PROFILE_PAGE : '/kiosk.html';
}

/** Remember the profile's screen, so the kiosk knows it. */
export function rememberCatProfile(profileId, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    if (profileId) storage?.setItem(CAT_PROFILE_KEY, profileId);
    else storage?.removeItem(CAT_PROFILE_KEY);
  } catch { /* private mode: nothing to remember it by */ }
}
