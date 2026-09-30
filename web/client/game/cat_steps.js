// game/cat_steps.js — NIMROD THE CAT'S WALK THROUGH GAME STEP 1, AS DATA.
//
// Change list row 2.26 (d) and §cat-walkthrough. Mike, 2026-09-29, "Yes" to: Nimrod the cat is the
// guide; the walk teaches the SETTINGS MENU and the TRANSPORT BAR, on the name sign and the picture;
// the cat appears only when asked (the "Show me how" button on the game page) or at a quest step,
// never uninvited; always dismissible; how chatty it is is a setting; and its words also go through
// the output bus so someone who cannot read the bubble hears them.
//
// SAME SHAPE AS `steps.js` — id, page, target, action, say, note — because it runs on the same
// engine (`tour.js`, via `cat_guide.js`) and so that the recorder that films `steps.js` could film
// this one too without a second format. The extra fields are the cat's:
//
//   brief / say / more   the words at each chattiness level: "a few words" shows `brief`, "some"
//                        (the default) shows `say`, "lots" shows `say` and then `more`.
//   pose                 'wave' | 'talking' | 'thinking' | 'happy' | 'point' (default 'point'
//                        when there is a target: the paw turns toward the ring, see poseToward).
//   doneWhen             a selector; when it matches, the person has done this step, and the cat
//                        moves on by itself (and skips it on arrival if it is already done).
//   advanceOn: 'click'   pressing the target itself moves the cat on — used where pressing it
//                        leaves the page, so the position is saved before the page goes.
//
// A `target` may be a LIST: the first selector that is on the page with a size wins, so a step
// points at a row inside the settings menu while the menu is open and at the gear while it is not.
//
// *** EVERY TARGET IS THE REAL CONTROL. *** The game page's own buttons (`game/index.html`) and the
// kiosk's own bar and menu (`kiosk.js`, `settings.js`); `dev/cat_guide_test.html` mounts a real
// kiosk on a real profile and checks each one resolves.
//
// HOW MANY STEPS (12) IS A DEFAULT, NOT A RULE: four on the game page (its four buttons, which
// auto-skip when already done) and eight on the profile (the bar, choosing a panel, the gear, the
// picture's rows, closing, the sign's words, the room, goodbye). Each teaches one move. Fewer would
// put two moves in one sentence; the "lots" level is where the extra words go.
//
// *** NO HELLO SLIDE (Mike, 2026-09-29, live): *** "He says every screen has a menu and bar and
// there is no menu or bar. That first slide is kind of unnecessary. Start with the make my
// profile." The opening line promised "the two controls every screen shares" on the one page that
// has neither. So the walk opens on the first thing to press, and every line is said where it is
// true: the bar and the menu are only named once he is on the profile, where they are.
// `dev/cat_guide_test.html` checks no game-page line talks about the bar or menu as if it were here.

import { kioskURL } from './game.js';

export const GAME_PAGE = '/game/';
// A PAGE TOKEN, not a path: "the kiosk, showing THIS person's profile". The kiosk host works out
// whether it is (`catPathOnKiosk`) and passes this or '/kiosk.html'. On any other screen the cat
// waits and offers a link to the profile, rather than pointing at a picture that is not there.
export const PROFILE_PAGE = 'profile';
// The profile's screen id, remembered in this browser by the game page so the kiosk can tell.
export const CAT_PROFILE_KEY = 'nimrod:catProfile';

const BAR = '[data-controls]';
const PANEL_BTN = '[data-act="panel"]';
const GEAR = '[data-act="settings"]';
// The shell's own menu, open. `:scope`-less on purpose: `kiosk.js` mounts it as a direct child of
// `.kiosk`, and the camera module's own inline `[data-settings]` is never a direct child.
const MENU_OPEN = '.kiosk > [data-settings] > [data-scrim]:not([hidden])';
const MENU_PANEL = `${MENU_OPEN} [data-panel]`;
const row = (id) => `${MENU_OPEN} .st-item[data-id="${id}"]`;

export const CAT_STEPS = [
  // ---- on the game page ----------------------------------------------------------------------
  { id: 'cat-profile', page: GAME_PAGE, target: '[data-do="profile"]', action: 'click',
    doneWhen: '[data-step="profile"][data-done]',
    brief: 'Press Make it.',
    say: 'First, your profile. Press Make it and you get an empty screen of your own, with a room '
       + 'behind it.',
    more: 'Every button here is safe to press twice. It finds what it made instead of making another. '
        + 'You can close me any time with Close or the Escape key.',
    note: 'The first step now. The "lots" line carries what the old hello slide said about leaving.' },

  { id: 'cat-picture', page: GAME_PAGE, target: '[data-do="picture"]', action: 'click',
    doneWhen: '[data-step="picture"][data-done]',
    brief: 'Press Hang it.',
    say: 'Now hang a picture frame on the wall. You choose the picture yourself in a minute.',
    more: 'The frame and the sign are both buttons. Later you can decide what pressing them does.' },

  { id: 'cat-sign', page: GAME_PAGE, target: '[data-do="sign"]', action: 'click',
    doneWhen: '[data-step="sign"][data-done]',
    brief: 'Press Put it up.',
    say: 'And put up your name sign.',
    more: 'It starts with your name, or with “Your name” if we have not been introduced. You change '
        + 'it on the screen.' },

  { id: 'cat-open', page: GAME_PAGE, target: '[data-open]', action: 'click', advanceOn: 'click',
    brief: 'Press Open it.',
    say: 'Now open your profile. I’ll meet you there.',
    more: 'It opens on the real screen, the same one everybody uses, with the bar along the bottom.',
    note: 'advanceOn: pressing Open leaves the page, so the cat moves on (and saves where it is) '
        + 'in the same click, before the page goes.' },

  // ---- on the profile (the real kiosk) ------------------------------------------------------
  { id: 'cat-bar', page: PROFILE_PAGE, target: BAR, action: 'none',
    brief: 'This is the bar. Every one of your screens has it.',
    say: 'This is the bar. Every one of your screens has one, with the same buttons in the same '
       + 'places. When nobody is using it, it tucks itself away: touch the screen, press a key or '
       + 'move the mouse near it to bring it back.',
    more: 'Most of its buttons have a key as well. Rest the mouse on one to see which.',
    note: 'The kiosk keeps the bar showing while he points at it (`holdBar`), so "this is the bar" '
        + 'never rings empty space; the tucking-away line is about afterwards, and it is true.' },

  { id: 'cat-panel', page: PROFILE_PAGE, target: PANEL_BTN, action: 'click',
    brief: 'Press Panel until your picture is outlined.',
    say: 'Press Panel ▸ until your picture has the outline around it. That chooses which thing the '
       + 'other buttons work on.',
    more: 'Each press moves the outline on to the next thing on the screen.' },

  { id: 'cat-gear', page: PROFILE_PAGE, target: GEAR, action: 'click', doneWhen: MENU_OPEN,
    brief: 'Press the gear.',
    say: 'Now press the gear, ⚙. That is the settings menu, and it changes whatever is outlined.',
    more: 'The M key opens it too.' },

  { id: 'cat-picture-rows', page: PROFILE_PAGE, action: 'none',
    target: [row('set:image'), row('set:imageFrom'), MENU_PANEL, GEAR],
    brief: 'Choose Picture, then Frame.',
    say: 'In the menu, Picture from says where your photos are, and Picture picks one. Frame hangs '
       + 'it in a picture frame, on a TV or on a monitor.',
    more: 'Each press of a row steps to its next choice, so you can go round until you like it.' },

  { id: 'cat-close', page: PROFILE_PAGE, action: 'none', target: [row('close'), PANEL_BTN],
    brief: 'Close the menu, then choose your sign.',
    say: 'When you are done, close the menu with Close menu or Escape. Then press Panel ▸ until your '
       + 'sign has the outline.',
    more: 'The picture and the frame were kept the moment you chose them, so closing loses nothing.' },

  { id: 'cat-words', page: PROFILE_PAGE, action: 'none', target: [row('set:label'), GEAR],
    brief: 'Open the gear and choose Words.',
    say: 'Open the gear again and choose Words. Type your name and press Enter.',
    more: 'Font, Colour of the words and Sign style are just below it, if you want to dress it up.' },

  { id: 'cat-room', page: PROFILE_PAGE, action: 'none', target: [row('set:theme'), GEAR],
    brief: 'Colours changes the room.',
    say: 'One more thing in that menu: Colours changes the room behind everything. Some of them move.',
    more: 'That one belongs to the whole screen, so it is there whichever thing is outlined.' },

  { id: 'cat-done', page: PROFILE_PAGE, target: null, action: 'none', pose: 'happy',
    brief: 'That’s it. Ask me again any time.',
    say: 'That’s it. The bar chooses what, and the gear changes how. It works the same on every screen.',
    more: 'If you want me again, press Show me how on the game page.' },
];

/**
 * Where the cat sends somebody whose next step is on another page. Keyed by the page token; the
 * profile's link needs the profile's id, which only the game page knows (and remembers).
 */
export function catGoThere(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  return (page) => {
    if (page === PROFILE_PAGE) {
      let id = null;
      try { id = storage?.getItem(CAT_PROFILE_KEY) || null; } catch { id = null; }
      return id
        ? { say: 'Open your profile and I’ll carry on there.', label: 'Open my profile', href: kioskURL(id) }
        : { say: 'Make your profile on the game page first, then open it.', label: 'The game', href: GAME_PAGE };
    }
    if (page === GAME_PAGE) {
      // "This part", not "the next part": Back from the profile's first step lands here too.
      return { say: 'This part is on the game page.', label: 'The game', href: GAME_PAGE };
    }
    return null;
  };
}

/**
 * On the kiosk: is this screen the profile the walk is about? No remembered profile means the walk
 * was started without one, and any screen will do.
 */
export function catPathOnKiosk(screenId, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  let want = null;
  try { want = storage?.getItem(CAT_PROFILE_KEY) || null; } catch { want = null; }
  return !want || want === screenId ? PROFILE_PAGE : '/kiosk.html';
}

/** Remember the profile's screen, so the kiosk knows it and the link can open it. */
export function rememberCatProfile(profileId, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try {
    if (profileId) storage?.setItem(CAT_PROFILE_KEY, profileId);
    else storage?.removeItem(CAT_PROFILE_KEY);
  } catch { /* private mode: the link falls back to the game page */ }
}
