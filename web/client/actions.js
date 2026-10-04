// actions.js — the ACTION CATALOG: the list of things an input can be bound TO.
//
// bus.js already makes inputs interchangeable: any source can feed any topic through a
// binding, with zero change downstream. What it does NOT have is a way to ASK what is
// bindable. Today a module's inputs exist only as string literals inside its own file
// ("photos/next", "youtube/prev", "sprint/control"), which is fine for code and useless
// for a person: an Overwatch-style binder needs a list of actions with human labels
// before it can say "press the thing you want to use for THIS".
//
// So this is the catalog. A declaration is:
//
//   { id, label, topic, payload?, group? }
//     id       stable, machine-safe, and the thing BINDINGS PERSIST AGAINST.
//     label    what a caregiver reads in the binder ("Next photo").
//     topic    where an activation is published — an existing bus topic, unchanged.
//     payload  what to publish (some topics carry a value: sprint/control takes a verb).
//     group    how the binder groups the list ("Photos", "System").
//
// WHY BINDINGS KEY OFF `id` AND NOT `topic`: a saved profile has to survive a module
// renaming its internal topics. The id is the contract with a caregiver's saved setup;
// the topic is an implementation detail behind it. Point an id at a different topic and
// every saved binding follows automatically.
//
// WHAT A PERSON ACTUALLY BINDS is not one of these directly — it is a VERB, see below.
// The catalog machinery stays because a verb IS an action ("Primary select" published
// on `verb/select`); the verb layer just means the list a person reads is nine items
// long instead of one entry per module feature.

const ID_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/;

// The gate control is itself an action, so a caregiver can put it on a physical switch
// instead of a keyboard — that was the point of the spec. input.js treats this id
// specially in one respect only: see ROLE_CYCLE_ACTION there.
export const ROLE_CYCLE_ACTION = 'system/role-cycle';
export const ROLE_CYCLE_TOPIC  = 'system/role-cycle';

// *** THE SCREEN'S OWN CONTROLS, AS TOPICS (2026-09-30, rows 2.33/2.34/2.37). *** A room's flower pot,
// door, bookshelf and picker publish these (room_scene.js ROOM_ACTIONS, with `payload.claim()`), and
// the kiosk answers them with the functions its own bar calls: full screen, the settings menu, the
// bar's panel buttons, the screen picker. Registered below as actions so a SWITCH can be bound to them
// too -- a decoration that is a control is an input device (room doc §3.1), and so is a switch.
// NOT on the remote-drive allowlist (drive.js stays frozen at eleven): "open this screen's menu" is not
// something a person at the far end of a socket gets by accident.
// The bar's Pause / Play, and promoting a panel (shell_verbs.js SHELL_PLAY_PAUSE / SHELL_PROMOTE /
// SHELL_DEMOTE, the same strings).
export const PLAY_PAUSE_TOPIC = 'shell/play-pause';
export const PROMOTE_TOPIC = 'shell/promote';
export const DEMOTE_TOPIC = 'shell/demote';
// edit_mode.js EDIT_PANEL_TOPIC, the same string (written out so this file imports nothing).
export const EDIT_PANEL_TOPIC = 'shell/edit-panel';
// *** THE BAR BY SWITCH (2026-10-02; transport_bar.js `createBarScan`). *** Pressed, the transport bar takes
// the switch: next / prev / select / back walk it (a group, then a button in it -- or one button at a time,
// the person's setting) instead of the panels. Pressed again, or back from the top, and the panels have it
// again. The way in for somebody who cannot point at the bar.
export const BAR_SCAN_TOPIC = 'shell/bar-scan';

// ---------------------------------------------------------------------------------------
// *** A LIVE CALL'S CONTROLS (2026-10-02). *** Mike: during a call the transport bar shows "volume, mute my
// microphone, mute the speaker, show/hide their video, show/hide my video", reachable by scan, switch and
// voice. modules/call.js answers CALL_CONTROL_TOPIC (only while a call is live) and says what it is set to
// on CALL_CONTROLS_TOPIC, which both bars and the menu draw from.
//   payload: { mic | speaker | theirVideo | myVideo: 'on' | 'off' | 'toggle' } or { volume: 1 | -1 }
// EACH THING HAS AN ON, AN OFF AND A TOGGLE, argued: "mute my mic" said twice must leave it muted (MEDIA_VERBS'
// rule: a spoken command is idempotent), so voice presses on/off; a single switch has one press, so it
// binds the toggle; the bar's button is a toggle that says which way it is.
// ---------------------------------------------------------------------------------------
export const CALL_CONTROL_TOPIC = 'call/control';
export const CALL_CONTROLS_TOPIC = 'call/controls';
const callAct = (id, label, payload) => ({ id: `call/${id}`, label, topic: CALL_CONTROL_TOPIC, payload, group: 'Calls' });
export const CALL_ACTIONS = [
  callAct('mic-off', 'Call: mute my microphone', { mic: 'off' }),
  callAct('mic-on', 'Call: unmute my microphone', { mic: 'on' }),
  callAct('mic-toggle', 'Call: my microphone on or off', { mic: 'toggle' }),
  callAct('speaker-off', 'Call: mute the speaker', { speaker: 'off' }),
  callAct('speaker-on', 'Call: unmute the speaker', { speaker: 'on' }),
  callAct('speaker-toggle', 'Call: the speaker on or off', { speaker: 'toggle' }),
  callAct('their-video-off', 'Call: hide their video', { theirVideo: 'off' }),
  callAct('their-video-on', 'Call: show their video', { theirVideo: 'on' }),
  callAct('their-video-toggle', 'Call: their video shown or hidden', { theirVideo: 'toggle' }),
  callAct('my-video-off', 'Call: stop sending my video', { myVideo: 'off' }),
  callAct('my-video-on', 'Call: send my video again', { myVideo: 'on' }),
  callAct('my-video-toggle', 'Call: my video on or off', { myVideo: 'toggle' }),
  callAct('louder', 'Call: louder', { volume: 1 }),
  callAct('quieter', 'Call: quieter', { volume: -1 }),
];

// *** ANSWER, DECLINE, HANG UP (2026-10-02, call_notice.js). *** The Call panel has always listened on these
// three (modules/call.js CALL_ANSWER / CALL_DECLINE / CALL_HANGUP, the same strings, written out here so this
// file imports nothing), and the screen's incoming-call notice listens on the first two - but nothing a person
// could bind or say ever pressed them: the panel's own hint says "Say decline to refuse this call" and there
// was no such phrase. Registered so a switch can be bound to each, and the spoken routes "answer", "decline"
// and "hang up" press them (input_speech.js ROUTES). With no call ringing or live, nothing answers them.
export const CALL_ANSWER_TOPIC = 'call/answer';
export const CALL_DECLINE_TOPIC = 'call/decline';
export const CALL_HANGUP_TOPIC = 'call/hangup';
export const CALL_RING_ACTIONS = [
  { id: 'call/answer', label: 'Call: answer', topic: CALL_ANSWER_TOPIC, group: 'Calls' },
  { id: 'call/decline', label: 'Call: decline', topic: CALL_DECLINE_TOPIC, group: 'Calls' },
  { id: 'call/hang-up', label: 'Call: hang up', topic: CALL_HANGUP_TOPIC, group: 'Calls' },
];

export const SYSTEM_TOPICS = Object.freeze({
  fullscreen: 'system/fullscreen',
  settings: 'system/settings',
  modules: 'system/modules',
  dashboards: 'system/dashboards',
  // Row 2.38: the edit view (open it; pressed again, close it) and the map of the person's dashboards.
  edit: 'system/edit',
  map: 'system/map',
});

export const SYSTEM_ACTIONS = [
  {
    id: ROLE_CYCLE_ACTION,
    label: 'Cycle who may act (moderator / participant / both)',
    topic: ROLE_CYCLE_TOPIC,
    group: 'System',
  },
  { id: SYSTEM_TOPICS.fullscreen, label: 'Full screen on or off', topic: SYSTEM_TOPICS.fullscreen, group: 'System' },
  { id: SYSTEM_TOPICS.settings, label: 'Open the settings menu', topic: SYSTEM_TOPICS.settings, group: 'System' },
  { id: SYSTEM_TOPICS.modules, label: 'Show the panels on this screen (the bar)', topic: SYSTEM_TOPICS.modules, group: 'System' },
  { id: SYSTEM_TOPICS.dashboards, label: 'Choose a screen (Home)', topic: SYSTEM_TOPICS.dashboards, group: 'System' },
  // *** ROW 2.38: THE EDIT VIEW AND THE MAP, ON A SWITCH (Stage R left the way in unbuilt). *** `system/edit`
  // opens this dashboard's edit windows and, pressed again, closes them; while they are open they take the
  // scan (next / prev / select walk them, Close first; back closes). `system/map` opens the map of the
  // person's dashboards the same way; selecting a dashboard on it goes there. Not on the remote-drive
  // allowlist, for the reason the rest of this list is not.
  { id: SYSTEM_TOPICS.edit, label: 'Edit this dashboard (open or close the edit windows)', topic: SYSTEM_TOPICS.edit, group: 'System' },
  { id: SYSTEM_TOPICS.map, label: 'Map of your dashboards (open or close it)', topic: SYSTEM_TOPICS.map, group: 'System' },
  // *** HOME'S OWN BUTTONS, ON A SWITCH (Mike, 2026-10-01: "Is there some reason it shouldn't be able to?"
  // -- there wasn't one). *** The same `shell/host` press the bar, the ⚙ menu rows and the fallback bar
  // send (shell_verbs.js SHELL_HOST, written out here so this file imports nothing), so Save is one thing
  // however it is reached. On a screen that is not Home nothing answers them, which is harmless. Still NOT
  // on the remote-drive allowlist: binding is for the person's own switch, not a socket at the far end.
  { id: 'shell/host/save', label: 'Home: Save', topic: 'shell/host', payload: { act: 'save' }, group: 'System' },
  { id: 'shell/host/saveas', label: 'Home: Save as…', topic: 'shell/host', payload: { act: 'saveas' }, group: 'System' },
  { id: 'shell/host/picker', label: 'Home: choose a module', topic: 'shell/host', payload: { act: 'picker' }, group: 'System' },
  { id: 'shell/host/history', label: 'Home: history', topic: 'shell/host', payload: { act: 'history' }, group: 'System' },
  // 2026-10-02: Home's edit bar (Scene / Add / Change…), opened WITH the scan -- next / prev / select / back
  // walk it, Close first, back leaves a tray and then the bar. It opens the bar; back and Close put it away.
  { id: 'shell/host/editbar', label: 'Home: the edit bar (scene, add, change)', topic: 'shell/host', payload: { act: 'editbar' }, group: 'System' },
  // 2026-10-02 (room_flat.js): flatten Home's 3D room to a 2D picture of it, or bake it again. A `shell/host`
  // act like the rows above, NOT a system/* topic (kiosk_test holds SYSTEM_TOPICS equal to room_scene's ROOM_ACTIONS).
  { id: 'shell/host/flatten', label: 'Home: flatten the 3D room to 2D (or re-bake it)', topic: 'shell/host', payload: { act: 'flatten' }, group: 'System' },
  // *** ROW 2.34: A SWITCH STRAIGHT TO A READY-MADE DASHBOARD. *** The picker is `system/dashboards` above;
  // these skip it, the way "computer please go to my room" does. `dashboard/go` (dashboards.js
  // DASHBOARD_GO_TOPIC, written out here so this file imports nothing): the person's own if they have it,
  // made once if not. Not on the remote-drive allowlist, for the reason the rest of this list is not.
  { id: 'dashboard/go/room', label: 'Go to the room dashboard', topic: 'dashboard/go', payload: { prebuilt: 'room' }, group: 'System' },
  { id: 'dashboard/go/basic', label: 'Go to the basic dashboard', topic: 'dashboard/go', payload: { prebuilt: 'basic' }, group: 'System' },
  { id: 'dashboard/go/classic', label: 'Go to the classic 2D dashboard', topic: 'dashboard/go', payload: { prebuilt: 'classic' }, group: 'System' },
  { id: 'dashboard/go/tutorial', label: 'Go to the tutorial', topic: 'dashboard/go', payload: { prebuilt: 'tutorial' }, group: 'System' },
  // *** ROW 2.38: THE WAY BACK OUT, ON A SWITCH. *** Once an object can open another dashboard, a person can
  // be three dashboards deep; these are Back (one step along the trail) and Home (the dashboard this screen
  // started on), the same `kiosk/back` / `kiosk/home` the breadcrumb, the tray and "go back" / "go home"
  // send (dashboard_nest.js, written out here so this file imports nothing). Nothing to go back to: nothing
  // happens. Not on the remote-drive allowlist, for the reason the rest of this list is not.
  { id: 'kiosk/back', label: 'Back to the previous dashboard', topic: 'kiosk/back', group: 'System' },
  { id: 'kiosk/home', label: 'Home: the dashboard this screen started on', topic: 'kiosk/home', group: 'System' },
  { id: 'nimrod-cat/next', label: 'Nimrod the cat: next step', topic: 'nimrod-cat/next', group: 'System' },
  { id: 'nimrod-cat/prev', label: 'Nimrod the cat: back a step', topic: 'nimrod-cat/prev', group: 'System' },
  // *** 2026-10-02: THE BAR'S PAUSE / PLAY AND "MAKE IT BIGGER", ON A SWITCH. *** The same topics the bar's
  // button, the panel's corner button and the menu's rows say (shell_verbs.js; written out here so this file
  // imports nothing -- transport_test checks the two agree). Pause / Play toggles the SELECTED panel: the one
  // shape a single switch can use (the spoken "pause" and "play" stay the idempotent verbs above, for the
  // reason MEDIA_VERBS gives). Bigger fills the dashboard, then the screen; Smaller goes back one level.
  // Not on the remote-drive allowlist, for the reason the rest of this list is not.
  { id: 'shell/play-pause', label: 'Pause or play the selected panel', topic: PLAY_PAUSE_TOPIC, group: 'System' },
  { id: 'shell/promote', label: 'Make the selected panel bigger (its dashboard, then the screen)', topic: PROMOTE_TOPIC, group: 'System' },
  { id: 'shell/demote', label: 'Make it smaller again (one level)', topic: DEMOTE_TOPIC, group: 'System' },
  // 2026-10-02 (edit_mode.js): edit the chosen (focused) panel; pressed again, stop. `shell/edit-panel` with no
  // id means the focused panel and no `on` toggles (arrangement.js answers it).
  { id: 'shell/edit-panel', label: 'Edit the chosen panel', topic: EDIT_PANEL_TOPIC, payload: {}, group: 'System' },
  // 2026-10-02: the transport bar takes the switch (pressed again, or back from the top, it lets go). Not on
  // the remote-drive allowlist, for the reason the rest of this list is not.
  { id: BAR_SCAN_TOPIC, label: 'Walk the transport bar with the switch (press again to leave)', topic: BAR_SCAN_TOPIC, group: 'System' },
];

// *** HOLDING ON A ROOM OBJECT (pet an animal, room-add-ons §9) IS ITS OWN ACTION, NOT A LONG PRESS. ***
// Argued both ways (2026-09-30):
//   * FOR turning a held switch on a focused room into `room/hold`: it is the gesture Design drew, and
//     it needs no binding.
//   * AGAINST, and it wins: on the dashboard path a long press is ALREADY the plain bar -- the way back
//     when a dashboard has gone wrong (input_longpress.js), which must mean one thing on every screen.
//     One hold meaning "pet the dog" on a room and "give me my controls back" everywhere else is the
//     gesture a switch user cannot predict; and when Stage 4 moves every screen onto the dashboard path
//     the two would fire together. So the long press stays the plain bar, and petting is a separate,
//     bindable action -- off until somebody binds it, like every other one.
export const ROOM_HOLD_ACTION = Object.freeze({
  id: 'room/hold', label: 'Hold on a room object (pet an animal)', topic: 'room/hold', group: 'Room',
});

// ---------------------------------------------------------------------------------
// THE VERB VOCABULARY - the thing a person binds to.
//
// Unity's model, and Mike is right that it is the correct one here. You do not bind a
// key to "fire the rifle in the player's right hand"; you bind it to PRIMARY FIRE, and
// whatever you are holding decides what that means. Here you bind your switch to
// PRIMARY SELECT once, and whatever is in front of you decides what that means.
//
// I ARGUED AGAINST THIS IN SLICE 1 AND I WAS WRONG, so the reasoning is worth recording
// rather than quietly reversing. My objection was that nine modules can be on screen at
// once, so a global "next" is ambiguous and would need a focus concept that did not
// exist. Both halves were true and the conclusion was still wrong: I was picturing
// someone with a mouse, who can simply click the panel they mean. A person with ONE
// SWITCH cannot. They cannot have nine switches either. So a small global vocabulary
// plus a way to move focus is not a complication to avoid - it is the only shape that
// works for the person this is for, and it is how a TV remote and every AAC scanner
// already behave. The focus concept had to be invented; that is `input_router.js`.
//
// WHAT THIS BUYS, beyond tone:
//   * The binder lists NINE things, not twenty grouped into nine collapsible headings.
//   * A binding stops referring to a screen's contents, so it can be PER USER: set your
//     switch up once, ever, and it follows you to any screen on any machine.
//   * A module written by someone else works with everybody's existing switches on the
//     day it ships, without anyone rebinding anything.
export const VERBS = [
  { id: 'select', label: 'Primary select', hint: 'the main "do it" — the one everybody needs' },
  { id: 'back',   label: 'Back or cancel', hint: '' },
  { id: 'next',   label: 'Next',           hint: 'forward through whatever is in front of you' },
  { id: 'prev',   label: 'Previous',       hint: '' },
  { id: 'up',     label: 'Up',             hint: '' },
  { id: 'down',   label: 'Down',           hint: '' },
  { id: 'left',   label: 'Left',           hint: '' },
  { id: 'right',  label: 'Right',          hint: '' },
  { id: 'menu',   label: 'Menu',           hint: '' },
];

// Moving the focus is itself bindable, because with one switch it has to be. These are
// the scanning controls, and they are the reason a single switch can reach a whole screen.
export const FOCUS_VERBS = [
  { id: 'focus-next', label: 'Move to the next panel', hint: 'with one switch, this is how you get anywhere' },
  { id: 'focus-prev', label: 'Move to the previous panel', hint: '' },
];

// ---------------------------------------------------------------------------------------
// THE MEDIA VERBS — row 2.28, voice commands. Mike, 2026-09-30: *"Pause, play, skip, volume
// up, volume down. Things like that. Mostly for Youtube right now."* Skip was already `next`.
//
// *** A SEPARATE SHIPPED LIST, LIKE FOCUS_VERBS, NOT FOUR MORE ROWS IN `VERBS`. *** Argued both
// ways, because both are real:
//
//   * FOR putting them in `VERBS`: they are shipped, they are global, and a switch user may well
//     want a dedicated pause switch. Being in the nine is what gets a verb onto every surface
//     that lists verbs (binder, remote, press overlay) for free.
//   * AGAINST, and it wins for now: the binder lists nine things ON PURPOSE (see the note above
//     and `inputs_test`'s "the list a person reads is short"), and the remote-drive wire list
//     is frozen at the eleven names (`drive.js`) - four more rows in `VERBS` would grow the one
//     and put pressure on the other, for verbs whose first customer is a SPOKEN phrase that
//     needs neither. Kept apart they are real actions (registered below, so a binding to one
//     fires), routed to the focused panel exactly like the nine, and shadow-proof against custom
//     verbs - and nothing that lists "the nine" changes.
//
// *** THEY ARE ALSO IN THE BINDER'S FLAT LIST NOW (Mike, 2026-09-30, row 2.28 call 1: "Adding
// audio shouldn't take away any other controls. It's just in addition to them.") *** So a switch
// can be bound to Pause or Louder from the page; the list grew from twelve to sixteen. `VERBS`
// itself is unchanged, so every surface that lists "the nine" (the remote, the press overlay, the
// keyboard module) and the remote-drive wire list (`drive.js`, frozen at eleven) are untouched.
//
// *** NO `toggle-play`. *** Considered and left out: a spoken command should be IDEMPOTENT.
// "Pause" said twice (or heard twice, or echoed by the room) leaves it paused; "toggle" heard
// twice leaves it PLAYING, which is the opposite of what was said. The person who wants the
// opposite is real - a one-switch user who wants play/pause on one switch - and that is served
// by `select` meaning play/pause on a module (the `sprint` shape: `select -> toggle`), which
// needs no new verb. Not built for YouTube here; flagged.
export const MEDIA_VERBS = [
  { id: 'play',        label: 'Play',    hint: 'carry on with whatever is paused' },
  { id: 'pause',       label: 'Pause',   hint: '' },
  { id: 'volume-up',   label: 'Louder',  hint: 'one step, on the whole screen’s volume' },
  { id: 'volume-down', label: 'Quieter', hint: 'one step, on the whole screen’s volume' },
];

// *** LOUDER AND QUIETER ARE THE MASTER'S, NOT A PANEL'S (Mike, 2026-09-30, row 2.28 call 4:
// "louder" "would control the audio busses master volume"). *** The router does not send these
// to the focused panel; `master_volume.js` answers them by moving the audio bus's master, so
// "louder" works whichever panel has focus - including a clock, or nothing. A panel's own volume
// (YouTube's "How loud the video is") stays a per-source level in that panel's settings.
export const MASTER_VERBS = ['volume-up', 'volume-down'];

// ---------------------------------------------------------------------------------------
// THE ACTION VERBS (2026-10-02). Mike, playing brick breaker on the live site: *"It'd be good for
// voice control: right, left, stop (stops the paddle), launch, pause (pauses and brings up settings),
// resume."* Right and left were already verbs, pause is a media verb and resume is `play` ("carry on
// with whatever is paused"). Three were missing, and each is a thing more than one module can mean:
//   launch  start the thing that goes: the ball, a round. Not `select`: in a one-switch game select
//           already means the ONE press (brick breaker: stop / start the gliding paddle), and a spoken
//           "launch" that stopped the paddle instead would be a command that does something else.
//   stop    stop what is MOVING, without pausing anything: the paddle. Not `pause`, which freezes the
//           whole game. The spoken word "stop" still means pause everywhere (input_speech.js PHRASES,
//           and the reason is there: said to a video it must not end anything) - except on a module
//           that declares "stop" as its own command while it has focus (a manifest's `voice`).
//   close   close the settings menu - IDEMPOTENT, unlike `menu`, which opens it when it is closed.
//           "Close the menu" said twice must not open it again. When no menu is open it goes to the
//           focused panel like any verb, and a panel with nothing for it is told nothing.
// A SHIPPED LIST, LIKE MEDIA_VERBS and for MEDIA_VERBS' reason: the binder's everyday list stays the
// nine plus focus plus media, and these are offered under their own heading (inputs.js); the router
// routes them to the focused panel exactly like the nine; remote drive (drive.js) is untouched.
export const ACTION_VERBS = [
  { id: 'launch', label: 'Launch', hint: 'start the ball (or whatever goes)' },
  { id: 'stop',   label: 'Stop moving', hint: 'stop what is moving, without pausing the game' },
  { id: 'close',  label: 'Close the menu', hint: 'closes it; never opens it' },
];

export const verbTopic = (id) => `verb/${id}`;

// ---------------------------------------------------------------------------------------
// THE CURSOR, BY COMMAND (2026-10-02). Mike: *"the cursor should have voice commands kind of like I
// just described for the brick breaker. Other general things like scroll up or down."* These are
// SCREEN actions, not verbs: the cursor is not a panel, so nothing here goes through focus. A switch
// can be bound to any of them (they are registered below and offered in the binder under "The
// cursor"), and input_speech.js ROUTES speaks them ("cursor left", "click", "scroll down").
// `cursor_drive.js` answers the topics: it moves the AIM (aim.js), so the big cursor (cursor.js)
// draws it and anything that follows the aim follows it; a click lands on whatever is under it.
// How far "a bit" and "a lot" go, and how far a scroll goes, are its settings (CURSOR_DRIVE_FIELDS).
export const CURSOR_TOPICS = Object.freeze({ move: 'cursor/move', click: 'cursor/click', scroll: 'cursor/scroll' });
const cursorMove = (dir, size, label) => ({ id: `cursor/${dir}${size === 'large' ? '-far' : ''}`, label,
  topic: CURSOR_TOPICS.move, payload: { dir, size }, group: 'Cursor' });
export const CURSOR_ACTIONS = [
  cursorMove('left', 'small', 'Cursor: left a bit'),
  cursorMove('right', 'small', 'Cursor: right a bit'),
  cursorMove('up', 'small', 'Cursor: up a bit'),
  cursorMove('down', 'small', 'Cursor: down a bit'),
  cursorMove('left', 'large', 'Cursor: left a lot'),
  cursorMove('right', 'large', 'Cursor: right a lot'),
  cursorMove('up', 'large', 'Cursor: up a lot'),
  cursorMove('down', 'large', 'Cursor: down a lot'),
  { id: 'cursor/click', label: 'Cursor: click where it is', topic: CURSOR_TOPICS.click, group: 'Cursor' },
  { id: 'cursor/scroll-up', label: 'Scroll up (where the cursor is)', topic: CURSOR_TOPICS.scroll, payload: { dir: 'up' }, group: 'Cursor' },
  { id: 'cursor/scroll-down', label: 'Scroll down (where the cursor is)', topic: CURSOR_TOPICS.scroll, payload: { dir: 'down' }, group: 'Cursor' },
];

// ---------------------------------------------------------------------------------------
// THE SETTINGS MENU'S TABS, AND "SWITCH MODULE" (2026-10-02). Mike: "The settings menu needs to be
// broken up into tabs" and "modules on a dashboard should be as hot swappable as possible. Maybe a
// switch module button on the transport bar for the selected module." SCREEN actions, like the cursor's:
// the menu and the bar are not panels, so nothing here goes through focus. A switch can be bound to any
// of them (registered below, offered in the binder under "The settings menu"), and input_speech.js
// ROUTES speaks them ("next tab", "sound settings", "switch module").
//   menu/tab            { dir: 1 | -1 } steps the tabs; { tab } goes to one. Opens the menu when it is
//                       closed (settings.js answers it).
//   shell/switch-module  "switch the selected panel to another module": the kiosk opens the Modules
//                       library IN THAT PANEL'S PLACE (library.js; `{ type }` names the panel by its
//                       module), or a host page's own chooser where it has one.
// The tab ids are the kiosk's (kiosk.js MENU_TAB_DEFS); a host without one of them shows nothing for it.
export const MENU_TAB_TOPIC = 'menu/tab';
export const SWITCH_MODULE_TOPIC = 'shell/switch-module';
// THE MODULES LIBRARY'S TWO SCREEN TOPICS (2026-10-02, library.js). Not bindable actions: each carries
// what no switch can supply.
//   shell/panel-list     { reply(list) } -- the kiosk answers AT ONCE with the panels on the screen,
//                        [{ id, type, title }]: how the AI's place / swap name a panel that is really there.
//   shell/place-module   { id, type } -- that panel becomes that module, through the library in its place
//                        (so the Nimrod Game's lock is asked exactly as for a press).
export const PANEL_LIST_TOPIC = 'shell/panel-list';
export const PLACE_MODULE_TOPIC = 'shell/place-module';
export const MENU_TAB_IDS = Object.freeze(['module', 'audio', 'display', 'devices', 'people', 'screen']);
const menuTab = (tab, label) => ({ id: `menu/tab-${tab}`, label, topic: MENU_TAB_TOPIC, payload: { tab }, group: 'Settings menu' });
export const MENU_ACTIONS = [
  { id: 'menu/next-tab', label: 'Settings menu: next tab', topic: MENU_TAB_TOPIC, payload: { dir: 1 }, group: 'Settings menu' },
  { id: 'menu/prev-tab', label: 'Settings menu: previous tab', topic: MENU_TAB_TOPIC, payload: { dir: -1 }, group: 'Settings menu' },
  menuTab('module', 'Settings menu: the selected panel'),
  menuTab('audio', 'Settings menu: sound'),
  menuTab('display', 'Settings menu: display'),
  menuTab('devices', 'Settings menu: devices'),
  menuTab('people', 'Settings menu: people'),
  menuTab('screen', 'Settings menu: this screen'),
  { id: 'menu/switch-module', label: 'Switch the selected panel to another module', topic: SWITCH_MODULE_TOPIC, group: 'Settings menu' },
];

// ---------------------------------------------------------------------------------------
// REVIEWING QUESTIONS (2026-10-03, pack_reviews.js). Mike: "Can I just play through and pass them? ... and
// just say if any are wrong?" SCREEN actions, like the cursor's: whichever Trivia panel is showing a
// question not yet reviewed answers them; with none showing, nothing does. A switch can be bound to either
// (a spare switch, or a long press) — deliberately NOT a stop in the player's own walk, so the person
// playing never spends a press on the reviewer's control. "That one is wrong" (input_speech.js ROUTES) and
// the W / O keys (pack_reviews.js REVIEW_KEY_BINDINGS) press these same two.
export const REVIEW_FLAG_TOPIC = 'review/flag';
export const REVIEW_PASS_TOPIC = 'review/pass';
export const REVIEW_ACTIONS = [
  { id: 'review/wrong', label: 'Reviewing questions: this question is wrong', topic: REVIEW_FLAG_TOPIC,
    group: 'Reviewing questions' },
  { id: 'review/fine', label: 'Reviewing questions: this question is fine', topic: REVIEW_PASS_TOPIC,
    group: 'Reviewing questions' },
];

// ---------------------------------------------------------------------------------------
// CUSTOM VERBS — Mike: *"a verb is just a variable. You bind something to verb X and then
// verb X performs this action in your module."*
//
// THAT IS EXACTLY WHAT IT IS, and nothing in the machinery ever assumed otherwise. `VERBS` is
// a list, `verbTopic` is string concatenation, and `verbTarget` is a lookup in a plain table.
// The nine shipped verbs are a curated DEFAULT, not a closed set - so this adds a registry
// rather than a mechanism.
//
// WHAT IT UNLOCKS, and Mike named both:
//   * HOME ASSISTANT. A bridge module that answers `verb/lights-dim` turns her switch into a
//     light switch with NO new input plumbing - same bus, same bindings, same gate, same
//     diagnostics. Remote drive proved the pattern: it is the same control path with a longer
//     wire, and so is this.
//   * THE STATE MACHINE / DIRECTOR. A screen can declare its own vocabulary instead of
//     borrowing `next` and hoping.
//
// AND THE REFRAME THAT MATTERS MOST: for somebody who cannot speak, A CUSTOM VERB IS A
// SENTENCE SHE CAN SAY WITH A SWITCH. `i-want-music` is not a control, it is an utterance -
// which puts this much closer to the AAC board than to a keybinding screen.
//
// *** THE ONE BOUNDARY IT MUST NOT CROSS, and it is the reason this is a registry and not
// just a spread operator: THE REMOTE-DRIVE WIRE ALLOWLIST STAYS FROZEN. ***
// `drive.js` and `drive.py` each hold their own copy of the eleven names deliberately, so
// that a boundary cannot widen because another file grew an entry. A custom verb is LOCAL BY
// DEFAULT and does not become remotely drivable by existing - if it ever should, that is an
// explicit decision on both sides of the wire, not a side effect of somebody adding a row.
// There is a test.
//
// TWO COSTS, both real:
//   * The binder lists nine things on purpose. Twenty custom verbs would undo that, so they
//     are grouped separately and belong behind the `advanced` complexity level.
//   * A custom verb means nothing on a module that has no mapping for it, exactly like a
//     built-in one. `respondsToVerbs` already handles that and the router already skips
//     panels with nothing to say.

// A custom id may not shadow a built-in. `select` meaning something else on one screen is the
// single worst thing this feature could do: every binding a person owns is keyed to that name.
const BUILT_IN_IDS = new Set([...VERBS, ...FOCUS_VERBS, ...MEDIA_VERBS, ...ACTION_VERBS].map((v) => v.id));

export function normalizeVerb(raw) {
  const id = String(raw?.id || '').trim();
  if (!ID_RE.test(id)) return null;
  if (BUILT_IN_IDS.has(id)) return null;      // never shadow a shipped verb
  return {
    id,
    label: String(raw.label || id),
    hint: String(raw.hint || ''),
    group: String(raw.group || 'Custom'),
    custom: true,
  };
}

// The effective vocabulary: the shipped nine, plus whatever this screen or person adds.
// Built-ins always come first and always win, so a saved binding can never be re-pointed by
// somebody adding a verb.
export function mergeVerbs(custom = [], base = VERBS) {
  const out = [...base];
  const seen = new Set(out.map((v) => v.id));
  for (const c of Array.isArray(custom) ? custom : []) {
    const v = normalizeVerb(c);
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

// The effective verb table. A per-type overlay merges OVER the shipped defaults, which is
// what lets a screen say "here, Primary select means Skip" - the thing MODULE_VERBS was
// always documented as allowing and had no way to express.
export function mergeVerbMaps(overlay = {}, base = MODULE_VERBS) {
  const out = {};
  for (const [type, map] of Object.entries(base)) out[type] = { ...map };
  for (const [type, map] of Object.entries(overlay || {})) {
    if (!map || typeof map !== 'object') continue;
    out[type] = { ...(out[type] || {}), ...map };
  }
  return out;
}

// The DEFAULT meaning of each verb, per module type. Defaults, not rules: the intent is
// that a module's own settings can re-point them ("on this screen, Primary select should
// mean Skip"), which is why this is a plain data table and not logic.
//
// A verb absent from a type means that module has nothing to say to it - Photos does not
// answer "select", the clock answers nothing at all. That is not an error, and the router
// uses it to decide which panels are worth stopping on while scanning.
//
// Every topic here is one a shipped module ALREADY subscribes to. Nothing was rewired.
export const MODULE_VERBS = {
  // *** THE COMMUNICATION BOARD, AND IT WAS MISSING ENTIRELY. ***
  //
  // Found 2026-09-05 by generating the module anatomy table: `board` was absent from this map,
  // which meant `verbTarget('board', 'select')` returned nothing and a switch press reached
  // NOTHING. `board.js` subscribes to `board/select` and `board/next` and says in its own
  // comment that "a single-switch setup binds only `board/select` and lets the clock do the
  // advancing" - and no verb could ever arrive there.
  //
  // WORSE THAN THAT: `input_router.js reachable()` filters by `respondsToVerbs`, so the board
  // could not be FOCUSED either. On a screen with a board and anything else, focus skipped it
  // entirely - so it could not be selected on the transport bar, and the settings menu could
  // never be about it.
  //
  // *** THIS IS THE MODULE THAT MATTERS MOST TO SOMEBODY WHO CANNOT SPEAK, AND IT WAS THE ONE
  // MODULE A SWITCH COULD NOT REACH. *** Touch always worked, which is exactly why it went
  // unnoticed: every test of it, and every look at it, used a mouse or a finger.
  //
  // `next` advances the scan and `select` takes whatever is lit - the two the module already
  // documents. Deliberately NO `back`: leaving is not a thing a board does, and a verb that
  // does nothing is a press somebody spent effort on for no result (see `call` below for the
  // same reasoning). `board/aim` and `board/pick` are not here either - they carry a position
  // or an index, which is not something a verb can supply.
  board:         { next: 'board/next', select: 'board/select' },
  // PLAY AND PAUSE (2026-10-02): a slideshow can wait for Start (its "When it opens" row) and be paused, so
  // the bar's one Pause / Play, Space and a switch reach it as they reach a video.
  photos:        { next: 'photos/next', prev: 'photos/prev', play: 'photos/play', pause: 'photos/pause' },
  personal:      { next: 'personal/next', prev: 'personal/prev' },
  educational:   { next: 'educational/next', prev: 'educational/prev', back: 'educational/skip' },
  // PLAY AND PAUSE (row 2.28). NOT volume-up/volume-down any more: Mike ruled 2026-09-30 that
  // "louder" moves the audio bus's MASTER (see MASTER_VERBS), so no panel answers them. The
  // video's own volume is still a setting, and `youtube/volume` still steps it for anything that
  // publishes it directly (a screen's own verb map can point a verb there).
  youtube:       { next: 'youtube/next', prev: 'youtube/prev',
                   play: 'youtube/play', pause: 'youtube/pause' },
  // THE DIRECTOR WAS MISSING, and it is on a real bedside screen — the starter
  // "Bedside" profile is photos + camera + clock + director. Absent from this table it is
  // never focusable and answers no verb, so a switch could not skip a segment on the one
  // screen that ships by default. Its "next" is the SEGMENT skip: the director advances by
  // being told the segment ended, and `reason` is what separates "she skipped it" from
  // "it finished" downstream.
  director:      { next: { topic: 'segment/done', payload: { reason: 'skipped' } },
                   select: { topic: 'segment/done', payload: { reason: 'skipped' } } },
  interstitials: { next: 'interstitial/next', prev: 'interstitial/prev', back: 'interstitial/skip' },
  // *** BOTH OF THESE USED TO SAY `wordforge/next`, WHICH SKIPS THE QUESTION. ***
  // Nothing reached `wordforge/answer`, so a one-switch player could skip forever and never
  // answer — the game was unplayable by exactly the person it is for. Now the same shape as
  // `trivia` on the line below: step the options, select the one you are on, and skip is its
  // own verb rather than the only one.
  wordforge:     { next: 'wordforge/next', prev: 'wordforge/prev',
                   select: 'wordforge/select', back: 'wordforge/skip' },
  // TRIVIA IS ANSWERABLE WITH ONE BUTTON, which is the whole reason it is shaped as four
  // choices with a walking highlight rather than as free recall. `next` moves the highlight and
  // wraps; `select` takes whatever it is on. `back` skips a question somebody does not want.
  trivia:        { next: 'trivia/next', prev: 'trivia/prev', select: 'trivia/select',
                   back: 'trivia/skip' },
  algebra:       { next: 'algebra/next', prev: 'algebra/prev', select: 'algebra/submit', back: 'algebra/skip' },
  // THE STANDALONE CALCULATOR (2026-09-28). `algebra` above has a calculator keypad inside it and
  // answers only `select` (Submit) - no verb ever reached its keys, so somebody with one switch could
  // submit an answer but not work one out. This one is a keypad and nothing else, so the verbs are
  // the keypad's: `next`/`prev` walk a highlight through the keys in a fixed reading order (the same
  // order they are drawn in, wrapping) and `select` presses whichever is lit. Deliberately NO `back`,
  // `menu` or the arrow verbs: a calculator has nowhere to go back to and no menu, and a verb that
  // does nothing is a press somebody spent effort on for no result (see `call` below).
  calculator:    { next: 'calculator/next', prev: 'calculator/prev', select: 'calculator/select' },
  // THE BUTTON (2026-09-28, change list row 2.26 — the game's name sign and picture). One face,
  // so one verb: `select` presses it, exactly as a click does. No `next`/`prev`: there is nothing
  // inside it to walk, and a verb that does nothing is a press spent for no result.
  button:        { select: 'button/select' },
  // 2026-10-02: the guide walks its choices; devices and What's new walk their lists.
  nimrod:        { next: 'nimrod/next', prev: 'nimrod/prev', select: 'nimrod/select', back: 'nimrod/back' },
  devices:       { next: 'devices/next', prev: 'devices/prev', select: 'devices/select' },
  whats_new:     { next: 'whats_new/next', prev: 'whats_new/prev', select: 'whats_new/select' },
  // THE SETTINGS PANEL (2026-10-03): it IS the screen's settings menu, drawn in a panel (modules/settings.js),
  // so a switch walks it with the menu's own four moves - next / prev the rows, select presses one (or steps
  // the tab row), back leaves a page or a list. Missing before, so a switch could not reach the panel at all.
  settings:      { next: 'settings/next', prev: 'settings/prev', select: 'settings/select', back: 'settings/back' },
  // THE MODULES LIBRARY (2026-10-02, library.js): next/prev walk its stops (one at a time, or a row at a time
  // with "Switch scanning: rows"), up/down a row of cards, select shows a thing then puts it here, back closes
  // the details (and, in another panel's place, puts that panel back).
  library:       { next: 'library/next', prev: 'library/prev', select: 'library/select', back: 'library/back',
                   up: 'library/up', down: 'library/down', left: 'library/left', right: 'library/right' },
  sprint:       { select: { topic: 'sprint/control', payload: 'toggle' },
                   next:   { topic: 'sprint/control', payload: 'start' },
                   back:   { topic: 'sprint/control', payload: 'pause' } },
  // The pond answers a switch, which is the whole reason it was worth porting: cursor and
  // click meant somebody who cannot reach could only ever watch it.
  pond:          { select: 'pond/splash', next: 'pond/stir' },
  // THE COMET'S VERBS ARE THE REASON IT WAS WORTH PORTING AT ALL. Cici's version moved only
  // with a pointer, so a switch user watched hearts drift past and could never touch one.
  // `next` steers the comet to the nearest heart; `select` blooms where it already is.
  comet:         { select: 'comet/spark', next: 'comet/seek', back: 'comet/exit' },
  // ONE GAMEPLAY VERB, AND THAT IS THE WHOLE GAME. Press. Everything clinical about this
  // module - latency, commissions, perseveration - is WHEN that one verb arrives relative
  // to the invite, so a second GAMEPLAY verb would be a second thing to get wrong for no
  // gain. That reasoning stands and is unchanged.
  //
  // *** `back` IS NOT A SECOND GAMEPLAY VERB — IT IS THE WAY OUT (Mike, 2026-09-03: they
  // should be able to set whatever they want to exit the game). *** It leaves the sitting and
  // returns the panel to its own start screen; it is never read as a press and never reaches
  // the trial record. It is deliberately `back` rather than a tenth verb in the vocabulary:
  // `back` is already "Back or cancel", it is already bindable to whatever somebody likes,
  // and `call` already uses it for exactly this shape (`back: 'call/hangup'` — leave the
  // thing you are in). A tenth verb would grow the binder for every module in the product to
  // give this one a word it already had.
  pressgame:     { select: 'pressgame/press', back: 'pressgame/exit' },
  // ANSWER and HANG UP, and nothing else. A call is not a thing to browse: `next` on a
  // call has no meaning, and a verb that does nothing is a press somebody spent effort on
  // for no result.
  call:          { select: 'call/answer', back: 'call/hangup' },
  counter:       { select: { topic: 'counter/delta', payload: 1 },
                   up:     { topic: 'counter/delta', payload: 1 },
                   down:   { topic: 'counter/delta', payload: -1 } },
  // THE SCOREBOARD (row 2.40). `next`/`prev` walk a highlight through every button on it and
  // `select` presses the lit one - the calculator's shape, so every button (−1, +1, Set the target,
  // Show as overlay, Remove, Follow ...) is reachable by one switch. `up`/`down` are the counter's
  // own +1 / −1 on whichever counter is in front of you, the `counter` shape above, so the thing a
  // switch user does most costs one press instead of a walk. No `back`: there is nothing to leave.
  scoreboard:    { next: 'scoreboard/next', prev: 'scoreboard/prev', select: 'scoreboard/select',
                   up:   { topic: 'scoreboard/delta', payload: 1 },
                   down: { topic: 'scoreboard/delta', payload: -1 } },
  // THE ROOM (rows 2.33/2.37, 2026-09-30). Missing, so a switch could not reach a room at all: absent
  // from this table it is never focused (`respondsToVerbs`), and a press went nowhere. `next`/`prev`
  // walk its objects in Design's scan order, `select` presses the one the cursor is on, `back` puts a
  // lifted panel back (or closes the reactions editor) -- the four the module already subscribes to.
  // Holding on an animal is NOT here: see ROOM_HOLD_ACTION above.
  room:          { next: 'room/next', prev: 'room/prev', select: 'room/select', back: 'room/back' },
  // ROW 2.38. A dashboard placed INSIDE another (a billboard, a TV) is one thing to a switch: `select` goes
  // in (modules/view.js answers `dashboard/open`; the kiosk swaps the screen). `view` is its old name.
  // And a placed module that is a DOOR (`opens` on its placement) is routed as type `opens`
  // (arrangement.js `focusRing`), whose `select` opens it -- so even a clock that is a door is reachable.
  dashboard:     { select: 'dashboard/open' },
  view:          { select: 'dashboard/open' },
  opens:         { select: 'opens/press' },
  // A PIECE OF A DASHBOARD'S ROOM (2026-10-02, Mike's list 09-30): each pressable piece of the room the
  // dashboard is drawn in -- a 2D room's objects, a 3D room's doors, a flattened room's door hotspots -- is
  // one stop in the lap (arrangement.js `focusRing`, ROOM_PIECE_TYPE), and `select` on it is a click on it.
  // Only select: `back` on a piece stays unanswered, so it still goes back a dashboard (kiosk `backUnhandled`);
  // a close-up's or a lifted panel's own way back is a stop of its own, first.
  'room-piece':  { select: 'room-piece/press' },
  // THE WORD GAMES (row 2.31). Also missing: `word_games.js` answers next / prev / select / skip and no
  // verb could reach them. `back` is skip, exactly as trivia's is. (The spoken routes --
  // SPEECH_ACTIONS / SPEECH_BINDINGS -- are the speech wiring's, not this table's.)
  word_games:    { next: 'word_games/next', prev: 'word_games/prev', select: 'word_games/select',
                   back: 'word_games/skip' },
  // THE ROW 2.45 GAMES (public e42cc92). The three quiz games share word games' view (quiz_view.js), so
  // they answer the same four: next / prev walk the choices, select answers, back skips. Karaoke is a
  // sing-along over the video player: next / prev move through songs, play / pause are the media verbs.
  spelling:      { next: 'spelling/next', prev: 'spelling/prev', select: 'spelling/select',
                   back: 'spelling/skip' },
  simple_math:   { next: 'simple_math/next', prev: 'simple_math/prev', select: 'simple_math/select',
                   back: 'simple_math/skip' },
  name_that:     { next: 'name_that/next', prev: 'name_that/prev', select: 'name_that/select',
                   back: 'name_that/skip' },
  karaoke:       { next: 'karaoke/next', prev: 'karaoke/prev', play: 'karaoke/play', pause: 'karaoke/pause' },
  // ROW 2.37. Solitaire: next / prev walk the list (cards that can move + Draw / Undo / New game, or a picked
  // card's legal places + Put it back), select takes the lit one, back puts a picked card back.
  solitaire:     { next: 'solitaire/next', prev: 'solitaire/prev', select: 'solitaire/select', back: 'solitaire/back' },
  // The note: next / prev walk its buttons, select presses the lit one, back closes the change form or the history.
  note:          { next: 'note/next', prev: 'note/prev', select: 'note/select', back: 'note/back' },
  // ROW 2.37 item 10. Brick breaker: next / prev move the paddle a step (follow mode: aim right / left), select launches,
  // stops or starts the gliding paddle (follow: changes the angle), back pauses. Rhythm: every press verb is a tap on the beat.
  // 2026-10-02 (Mike: "right, left, stop, launch, pause, resume"): left / right move the paddle a step (as prev / next),
  // stop stops the gliding paddle, launch sends a resting ball, pause pauses (and opens this panel's settings, a
  // setting), play resumes. Every one of them is a switch binding as well as a spoken command.
  brickbreaker:  { next: 'brickbreaker/next', prev: 'brickbreaker/prev', select: 'brickbreaker/select', back: 'brickbreaker/back',
                   left: 'brickbreaker/left', right: 'brickbreaker/right', stop: 'brickbreaker/stop',
                   launch: 'brickbreaker/launch', pause: 'brickbreaker/pause', play: 'brickbreaker/resume' },
  // 2026-10-02 (games wait for Start; Space is Pause / Play): play / pause start-or-resume and pause, on every
  // game below. The quiz games answer `<type>/resume`, not `/play` (quiz_view.js: `/play` names a game).
  rhythm:        { next: 'rhythm/next', prev: 'rhythm/prev', select: 'rhythm/select', back: 'rhythm/back',
                   play: 'rhythm/play', pause: 'rhythm/pause' },
  // Row 2.45: the thinking games. next / prev walk the offered answers, select answers, back skips.
  think_games:   { next: 'think_games/next', prev: 'think_games/prev', select: 'think_games/select', back: 'think_games/skip',
                   play: 'think_games/resume', pause: 'think_games/pause' },
  // Row 2.45: word builder. next/prev walk the letters and stops, select adds a letter or presses a stop, back undoes a letter.
  word_builder:  { next: 'word_builder/next', prev: 'word_builder/prev', select: 'word_builder/select', back: 'word_builder/back',
                   play: 'word_builder/resume', pause: 'word_builder/pause' },
  // Row 2.45: brain games. next/prev walk the offered answers (or things to pick), select answers, back skips.
  brain_games:   { next: 'brain_games/next', prev: 'brain_games/prev', select: 'brain_games/select', back: 'brain_games/skip',
                   play: 'brain_games/resume', pause: 'brain_games/pause' },
  // Card sort (a quiz_view game): next / prev walk the piles, select sorts the card, back skips it.
  card_sort:     { next: 'card_sort/next', prev: 'card_sort/prev', select: 'card_sort/select', back: 'card_sort/skip',
                   play: 'card_sort/resume', pause: 'card_sort/pause' },
  // A profile card (a person or an AI character): next / prev walk its buttons, select presses one, back closes.
  profile:       { next: 'profile/next', prev: 'profile/prev', select: 'profile/select', back: 'profile/back' },
  // Row 2.37 item 5. Avatar maker: next / prev walk the parts (or a part's options), select opens / keeps, back undoes / cancels.
  avatar:        { next: 'avatar/next', prev: 'avatar/prev', select: 'avatar/select', back: 'avatar/back' },
  // Row 2.32. Music: next / prev walk the favourites, select plays the lit one, back stops; play/pause resume/pause.
  music:         { next: 'music/next', prev: 'music/prev', select: 'music/select', back: 'music/back', play: 'music/resume', pause: 'music/pause' },
  // The weather: select reads now (or the lit day), next / prev walk the days, back returns to now.
  weather:       { next: 'weather/next', prev: 'weather/prev', select: 'weather/select', back: 'weather/back' },
  // 2026-10-04, the Voice model module (modules/voice_model.js): next / prev walk its buttons (the walk's own Back /
  // Skip this step / Done, next among them), select presses the lit one, back is the walk's Back.
  voice_model:   { next: 'voice_model/next', prev: 'voice_model/prev', select: 'voice_model/select', back: 'voice_model/back' },
};

// What a verb does on a given module type, normalized to {topic, payload}.
export function verbTarget(type, verb, maps = MODULE_VERBS) {
  const hit = maps[type]?.[verb];
  if (!hit) return null;
  return typeof hit === 'string' ? { topic: hit, payload: undefined } : { ...hit };
}

export const verbsFor = (type, maps = MODULE_VERBS) => Object.keys(maps[type] || {});
export const respondsToVerbs = (type, maps = MODULE_VERBS) => verbsFor(type, maps).length > 0;

// Everything a person can bind, in one call. VERBS and FOCUS_VERBS are the whole list -
// deliberately flat and short, because the binder is read by someone holding a stopwatch
// and a participant, not browsing a menu.
export function createDefaultRegistry() {
  const reg = createActionRegistry();
  reg.registerAll(VERBS.map((v) => ({
    id: verbTopic(v.id), label: v.label, topic: verbTopic(v.id), group: 'Controls',
  })));
  reg.registerAll(FOCUS_VERBS.map((v) => ({
    id: verbTopic(v.id), label: v.label, topic: verbTopic(v.id), group: 'Controls',
  })));
  // Registered so a binding to one ACTUALLY FIRES (input.js refuses an unknown action) - the
  // spoken bindings in input_speech.js point at these. Not in the binder's flat list; see
  // MEDIA_VERBS above.
  reg.registerAll(MEDIA_VERBS.map((v) => ({
    id: verbTopic(v.id), label: v.label, topic: verbTopic(v.id), group: 'Media',
  })));
  // The action verbs (launch / stop / close) and the cursor's commands: registered so a switch binding
  // or a spoken phrase bound to one fires (input.js refuses an unknown action).
  reg.registerAll(ACTION_VERBS.map((v) => ({
    id: verbTopic(v.id), label: v.label, topic: verbTopic(v.id), group: 'Games and menus',
  })));
  reg.registerAll(CURSOR_ACTIONS);
  reg.registerAll(MENU_ACTIONS);
  reg.registerAll(SYSTEM_ACTIONS);
  reg.registerAll(CALL_ACTIONS);
  reg.registerAll(CALL_RING_ACTIONS);
  reg.registerAll(REVIEW_ACTIONS);
  reg.register(ROOM_HOLD_ACTION);
  return reg;
}

export function createActionRegistry() {
  const actions = new Map();   // id -> frozen declaration

  function register(decl) {
    const { id, label, topic, payload, group = 'Other' } = decl || {};
    if (!ID_RE.test(String(id || ''))) {
      throw new Error(`registerAction: bad id ${JSON.stringify(id)} — must match ${ID_RE}`);
    }
    if (!topic || typeof topic !== 'string') {
      throw new Error(`registerAction "${id}": topic is required`);
    }
    if (!label || typeof label !== 'string') {
      throw new Error(`registerAction "${id}": label is required — the binder shows it to a person`);
    }
    if (actions.has(id)) console.warn(`action "${id}" re-registered`);

    const entry = Object.freeze({ id, label, topic, payload, group: String(group) });
    actions.set(id, entry);
    // Unregister only if OUR entry is still the one installed — a re-registration
    // (module remount) must not be undone by the old instance's cleanup.
    return () => { if (actions.get(id) === entry) actions.delete(id); };
  }

  function registerAll(list) {
    const offs = (list || []).map(register);
    return () => offs.forEach((off) => off());
  }

  // Sorted for display: by group, then label. The binder renders this directly.
  function list() {
    return [...actions.values()].sort(
      (a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label),
    );
  }

  function groups() {
    const out = new Map();
    for (const a of list()) {
      if (!out.has(a.group)) out.set(a.group, []);
      out.get(a.group).push(a);
    }
    return out;
  }

  return {
    register,
    registerAll,
    get: (id) => actions.get(id) || null,
    has: (id) => actions.has(id),
    list,
    groups,
    size: () => actions.size,
  };
}
