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
// HOW MANY STEPS (11) IS A DEFAULT, NOT A RULE: making the profile (Save), then the bar, Modules, Panel,
// the gear, the picture's rows, choosing the sign, its words, the room, Save again, goodbye. Each
// teaches one move. Fewer would put two moves in one sentence; the "lots" level is where extra words go.
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
const row = (id) => MENU_ROOTS.map((m) => `${m} .st-item[data-id="${id}"]`).join(', ');
// The page says whether the profile exists yet (modules.html paints it on <body>).
export const PROFILE_MADE = '[data-home-profile="made"]';

export const CAT_STEPS = [
  { id: 'cat-profile', page: HOME_PAGE, target: HOST('save'), action: 'click', doneWhen: PROFILE_MADE,
    brief: 'Press Save.',
    say: 'First, your profile. What you see is a preview: nothing is made yet. Press Save on the bar '
       + 'and choose a name, and it is made for real, with a picture frame and your name sign.',
    more: 'Saving again never makes a second profile. You can close me any time with Close or the '
        + 'Escape key.',
    note: 'The first step (no hello slide). Done as soon as the profile exists, so it is skipped for '
        + 'somebody who made theirs already.' },

  { id: 'cat-bar', page: HOME_PAGE, target: BAR, action: 'none',
    brief: 'This is the bar.',
    say: 'This is the bar. Every screen has one, with the same buttons in the same places. On Home it '
       + 'also carries Modules, Save, Save as and History.',
    more: 'In full screen it tucks itself away after a few seconds. Touch the screen, press a key or '
        + 'press a switch to bring it back.',
    note: 'The kiosk keeps the bar showing while he points at it (`holdBar`), placed bar included.' },

  { id: 'cat-modules', page: HOME_PAGE, target: HOST('picker'), action: 'none',
    brief: 'Modules chooses what you look at.',
    say: 'Modules, at the start of the bar, chooses what you are looking at: your profile, or any other '
       + 'part. Your profile is always first.',
    more: 'Looking at a part never adds it to anything. Save does.' },

  { id: 'cat-panel', page: HOME_PAGE, target: SHELL('panel'), action: 'click',
    brief: 'Press Panel until your picture is outlined.',
    say: 'Press Panel ▸ until your picture has the outline around it. That chooses which thing the '
       + 'other buttons work on.',
    more: 'Each press moves the outline on to the next thing on the screen.' },

  { id: 'cat-gear', page: HOME_PAGE, target: SHELL('settings'), action: 'click', doneWhen: MENU_OPEN,
    brief: 'Press ⚙ Edit.',
    say: 'Now press ⚙ Edit. That is the settings menu, and it changes whatever is outlined.',
    more: 'The M key opens it too. When it is already open, I skip this.' },

  { id: 'cat-picture-rows', page: HOME_PAGE, action: 'none',
    target: [row('set:image'), row('set:imageFrom'), MENU_PANEL, SHELL('settings')],
    brief: 'Choose Picture, then Frame.',
    say: 'In the menu, Picture from says where your photos are, and Picture picks one. Frame hangs '
       + 'it in a picture frame, on a TV or on a monitor.',
    more: 'Each press of a row steps to its next choice, so you can go round until you like it.' },

  { id: 'cat-sign', page: HOME_PAGE, action: 'none', target: SHELL('panel'),
    brief: 'Press Panel until your sign is outlined.',
    say: 'Now press Panel ▸ until your sign has the outline. The menu follows: it always shows what '
       + 'is outlined.',
    more: 'What you chose for the picture is waiting for Save, so moving on loses nothing.' },

  { id: 'cat-words', page: HOME_PAGE, action: 'none', target: [row('set:label'), SHELL('settings')],
    brief: 'Choose Words.',
    say: 'Choose Words in the menu. Type your name and press Enter.',
    more: 'Font, Colour of the words and Sign style are just below it, if you want to dress it up.' },

  { id: 'cat-room', page: HOME_PAGE, action: 'none', target: [row('set:theme'), SHELL('settings')],
    brief: 'Colours changes the room.',
    say: 'One more thing in that menu: Colours changes the room behind everything. Some of them move.',
    more: 'That one belongs to the whole screen, so it is there whichever thing is outlined.' },

  { id: 'cat-save', page: HOME_PAGE, action: 'none', target: HOST('save'),
    brief: 'Press Save to keep it.',
    say: 'Your changes wait for Save. Press Save to keep them, or Save as… to keep a copy under a new '
       + 'name. History has your last saves.',
    more: 'Restoring an old save deletes nothing: it opens as unsaved changes, and saving it adds a new '
        + 'one on top.' },

  { id: 'cat-done', page: HOME_PAGE, target: null, action: 'none', pose: 'happy',
    brief: 'That’s it. Ask me again any time.',
    say: 'That’s it. Modules chooses what, the bar moves between things, ⚙ changes how, and Save keeps it.',
    more: 'If you want me again, it is Show me how in the ⚙ menu, under This page.' },
];

/**
 * Where the cat sends somebody whose next step is on another page. Every step is on Home now, so the
 * link is always the profile on Home. (`storage` is kept in the signature: kiosk.html passes nothing.)
 */
export function catGoThere(storage = null) { // eslint-disable-line no-unused-vars
  return (page) => {
    if (page === HOME_PAGE || page === PROFILE_PAGE) {
      return { say: 'I show you around on Home, on your profile. Open it and I’ll carry on there.',
        label: 'Open my profile', href: HOME_PROFILE_URL };
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
