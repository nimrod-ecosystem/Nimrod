// shell_verbs.js — WHAT THE BAR'S BUTTONS SAY, AS TOPICS. Step 6 Stage 3b (2026-09-30).
//
// Mike, 2026-09-30: the transport bar, the settings menu and the edit menus are MODULES PLACED in a
// dashboard -- "They're not being drawn by a module. They're being placed in the dashboard." So a
// placed bar cannot call into the kiosk's closure the way the kiosk's own buttons do. It says what
// was pressed, on the bus, and the SHELL does it -- with the very same functions its own plain bar
// calls. One implementation of Next, Back, Hush, Settings and Full screen, however many things can
// press them: a placed bar, the plain bar, and later a flower pot or a door in a room (room doc §3.1,
// "a decoration that is a control is an input device").
//
// NOT ON THE DRIVE ALLOWLIST and not in the verb map: these are the screen's own chrome, not verbs a
// module answers, and a person on the far end of a socket does not get them by accident.

export const SHELL_NEXT = 'shell/next';            // Next: the focused panel's next thing
export const SHELL_PREV = 'shell/prev';            // Back
export const SHELL_PANEL = 'shell/panel';          // Panel ▸: move focus to the next panel
export const SHELL_HUSH = 'shell/hush';            // Hush on/off
export const SHELL_MENU = 'shell/menu';            // the settings menu, open/closed
export const SHELL_FULLSCREEN = 'shell/fullscreen';
export const SHELL_HOME = 'shell/home';            // the screen picker
export const SHELL_MIRROR = 'shell/mirror';        // the camera full screen
// Nimrod, the context help (row 2.37): the shell's one cat explains whatever is picked. One cat per
// screen, whichever bar was pressed -- two bars each bringing their own would be two cats.
export const SHELL_HELP = 'shell/help';

// What the shell tells placed chrome after it acted, so a placed bar can show the same state the
// plain bar shows (Hush lit while it is on). Payload: { hushed } and/or { help } (whether the Nimrod
// button is offered: the person's "Cat help" setting, read by the shell) and/or { barHeld } (something
// above the modules -- Nimrod the cat -- is pointing at the bar, so a placed bar must not tuck away).
export const SHELL_STATE = 'shell/state';

// *** A HOST PAGE'S OWN ACTIONS, ON THE ONE BAR (Home, rows 2.29/2.30 follow-up, 2026-09-30). ***
// Design's home-dashboard handoff put Modules, Save, Save as and History INSIDE the real transport bar,
// not on a page bar above it. The page that hosts an embedded kiosk hands it a `host` (kiosk.js); the
// placed bar draws the host's buttons and, like every other button on it, SAYS what was pressed. The
// shell answers by calling the host's `press(act)` -- the same function the page's own fallback bar
// and the ⚙ menu's rows call, so Save is one thing however it is reached. Payload: { act, from }.
export const SHELL_HOST = 'shell/host';

// *** IN FULL SCREEN, A PLACED BAR TUCKS ITSELF AWAY (Design: "the bar hides itself after 6 seconds").
// Any press, key, switch edge or pointer near it brings it back; a tucked bar hides nothing behind it
// and waits on nobody, so there is no state here only an input can leave -- the content goes on
// showing whether the bar ever comes back or not. The delay is a person's setting (Home: "Hide the bar
// in full screen"); 0 = never tuck. 6 s is Design's number, argued in home_dashboard.js.
export const FULLSCREEN_BAR_HIDE_DEFAULT_MS = 6000;
export const FULLSCREEN_BAR_HIDE_CHOICES_MS = Object.freeze([0, 3000, 6000, 10000, 30000]);

// *** THE PLAIN BAR. *** The screen's own bar, which no dashboard can restyle or remove (Design,
// room-is-the-screen, "The plain bar (the invariant)"). Published to summon it: by Escape, by a long
// switch press (`input_longpress.js`), or by anything else that has a reason to. Payload: { via }.
export const PLAIN_BAR_SHOW = 'shell/plain-bar';
// The long press, while it is being held: the ring starts after 250 ms ("Keep holding for the plain
// bar"), and ends -- fired or let go -- with RING_END. Payloads: { pressId, holdMs, ringAfterMs } and
// { pressId, fired }.
export const PLAIN_BAR_RING = 'shell/plain-bar-ring';
export const PLAIN_BAR_RING_END = 'shell/plain-bar-ring-end';

// The long-press length (Design: 1.5 s by default, settable from 1 to 3 s).
export const PLAIN_BAR_HOLD_DEFAULT_MS = 1500;
export const PLAIN_BAR_HOLD_MIN_MS = 1000;
export const PLAIN_BAR_HOLD_MAX_MS = 3000;
export const PLAIN_BAR_RING_AFTER_MS = 250;
// A placed bar that has not mounted after this long counts as not carrying the bar (Design).
export const PLAIN_BAR_MOUNT_GRACE_MS = 2000;
