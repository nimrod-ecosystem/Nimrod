// nimrod_guide_data.js — NIMROD, THE GUIDE, AS DATA: a choose-your-own-adventure tree, and the pure
// functions that walk it. The module that draws it is modules/nimrod.js; the suite that checks it
// is dev/nimrod_guide_test.html. Nothing in here touches a page.
//
// Mike, 2026-10-02: *"It should probably be like a choose your own adventure. Hover over anything and
// Nimrod tells you what it does ... Nimrod being a new module that would pretty much be our equivalent of
// a help/wiki. Have him there to suggest things for you to do. Kind of like an NPC ... The rest of the
// choices throughout the whole Nimrod module should mostly be decision trees like that. Each choice you
// select gives you information and choices. You should be able to go backwards however much you want.
// Maybe have an optional view of it like a file tree that is on by default."*
//
// *** THE SHAPE. *** A node is { id, title, say, choices, acts? }:
//   say       what he says on arriving (read aloud through the output bus when the module's Read aloud
//             setting is on). Plain words; never "her screen", never a person's name (site copy rule).
//   choices   [{ key, label, to }] — every node has at least one, and every `to` is a node (the suite
//             checks both: "each choice you select gives you information and choices"). A choice may
//             point back up the tree ("Back to the start"); the walk is a history, so that is fine.
//   acts      what he can DO from here, each a button: open a settings tab, show a settings page, open
//             the switch list... `auto: true` runs it on arriving FORWARD (never on Back, so walking
//             back does not re-open things). Only `settings-page` acts are auto anywhere: they show a page
//             in the settings PANEL beside him, which takes nothing from anybody. Opening the settings
//             MENU (`menu-tab`) is never automatic, because the open menu takes the switch scan — a
//             switch user walking his choices would find the scan taken from under them.
//
// *** THE TOP OF THE TREE IS MIKE'S, IN HIS ORDER, with game/learning mode moved to A as he suggested
// ("This one should probably be moved up to A"). *** His opening offered A device, B theme, C album, D
// other modules; his second list (under "other modules") offered module, dashboard, scene, editing a
// module, AI, then game/learning mode. "Moved up to A" is read here BOTH ways, since both are cheap and
// either could be what he meant: game/learning is A in the opening AND A in the "other modules" list.
//
// *** THE AI SEAM (Mike: "The Nimrod module should probably be the AI module. You wire up whatever AI you
// want"). *** Not built. What IS built is the place it goes: `wordsFor(node, { source })` asks `source`
// first and falls back to the node's own words, so an AI that answers later replaces the words without
// the tree, the module or the suite changing. A source that throws, returns nothing or takes longer than
// it is allowed falls back too — a guide that waits on a model is a guide that says nothing.

// The ids the walk starts from, and what Back-to-the-start means.
export const GUIDE_ROOT = 'hello';

// Topics the guide SAYS on its bus. Written out (actions.js's habit: this file imports nothing it does not
// need) and checked against their owners by the suite.
export const GUIDE_TOPICS = Object.freeze({
  menuTab: 'menu/tab',                     // actions.js MENU_TAB_TOPIC: the settings menu, on a tab
  settingsPage: 'settings-module/open',    // modules/settings.js SETTINGS_OPEN_TOPIC: the settings PANEL, on a page
  switchModule: 'shell/switch-module',     // actions.js SWITCH_MODULE_TOPIC: the switch list
  host: 'shell/host',                      // shell_verbs.js SHELL_HOST: Home's own buttons (picker, examples...)
  dashboardGo: 'dashboard/go',             // dashboards.js DASHBOARD_GO_TOPIC: a ready-made dashboard
  gameMode: 'nimrod/game-mode',            // what a game-mode act says (unlocks.js's hook in modules/nimrod.js sets the mode)
  info: 'nimrod/info',                     // what the pointer or the scan is on, explained (hover_info.js)
});
// The verbs a switch drives him with (actions.js MODULE_VERBS line, given to the coordinator).
export const GUIDE_VERB_TOPICS = Object.freeze({
  next: 'nimrod/next', prev: 'nimrod/prev', select: 'nimrod/select', back: 'nimrod/back',
});

// What an act may be. A closed set, so the suite can say an act is wrong rather than a press doing nothing.
export const ACT_KINDS = Object.freeze(['menu-tab', 'settings-page', 'switch', 'host', 'tutorial', 'link', 'game-mode']);
// The settings PANEL's own pages (modules/settings.js). `type:<module>` = that module's settings page.
// 'sc-game' is the "Nimrod Game" page (unlocks.js draws it; modules/settings.js lists it).
export const SETTINGS_PAGES = Object.freeze(['sc-theme', 'sc-mode', 'sc-device', 'sc-game']);
// The modes (unlocks.js reads this list: one list, two files).
export const GAME_MODES = Object.freeze(['game', 'learning', 'sandbox']);
// *** MIKE'S WORDS, KEPT EXACT IN MEANING: "When introducing points say that they have no real world value and
// we do not sell any form of coins or other microtransactions." *** One sentence, said wherever points are
// introduced (node A, the points node, the Nimrod Game page); the suites check it is present verbatim.
export const POINTS_DISCLAIMER = 'Points have no real-world value, and we do not sell any form of coins or other microtransactions.';

// ---------------------------------------------------------------------------------------------------
// THE DEVICES, as data: shared by the guide's "Set up a device" branch and the devices module, so the two
// can never describe the same thing differently. `tab`: the settings menu's tab it lives on, if any.
// `href`: the page that sets it up (opened in a new tab: a screen nobody is at must not navigate away).
// ---------------------------------------------------------------------------------------------------
export const DEVICE_KINDS = Object.freeze([
  Object.freeze({ id: 'voice', label: 'Voice commands', lead: 'Say “computer please”, then what you want.',
    say: 'You can talk to the screen. Say “computer please”, then a command: “next”, “go home”, “play music”. '
      + 'Every command it knows is listed on the voice commands page. Listening is off until somebody turns it '
      + 'on in the settings menu, and the screen shows when it is listening.',
    tab: 'devices', href: '/voice_commands.html', hrefLabel: 'Every voice command' }),
  Object.freeze({ id: 'tracking', label: 'Tracking', lead: 'Your head, your eyes, a face gesture or a marker, as a pointer.',
    say: 'Tracking lets a movement be the pointer: a head, a gaze, a face gesture, or a marker somebody wears. '
      + 'Each one is calibrated once, on the Devices tab of My dashboards, and then works on every screen.',
    tab: 'devices', href: '/home.html', hrefLabel: 'My dashboards: Devices' }),
  Object.freeze({ id: 'keys', label: 'Mouse, keyboard and switches', lead: 'Which key, button or switch does what.',
    say: 'A mouse and a keyboard work as they always do. A switch, a game controller or any key can be given a '
      + 'job: next, back, select, or one of yours. Bindings belong to the person, so they follow you to every '
      + 'screen. Set them up on the Devices tab of My dashboards; the settings menu’s Devices tab shows what '
      + 'each one does right now.',
    tab: 'devices', href: '/home.html', hrefLabel: 'My dashboards: Devices' }),
  Object.freeze({ id: 'phones', label: 'Phones', lead: 'A phone as a microphone, a remote, or for a call.',
    say: 'A phone can be the microphone in the room, which often hears far better than one across it. It can '
      + 'also drive a screen from somewhere else, or call it. None of that needs an app: it is a web page.',
    tab: null, href: '/phone_mic.html', hrefLabel: 'Use this phone as a microphone' }),
  Object.freeze({ id: 'computers', label: 'Computers, and screens in other rooms', lead: 'Another screen, set up from here.',
    say: 'A screen that nobody signs into, like one in another room, is set up by showing a code on it and '
      + 'typing that code here. After that it comes back by itself whenever it restarts.',
    tab: null, href: '/pair.html', hrefLabel: 'Set up a screen somewhere else' }),
]);

const devNode = (d) => ({
  id: `dev-${d.id}`, title: d.label, say: d.say,
  choices: [
    { key: 'A', label: 'Another kind of device', to: 'devices' },
    { key: 'B', label: 'Back to the start', to: GUIDE_ROOT },
  ],
  acts: [
    ...(d.tab ? [{ kind: 'menu-tab', tab: d.tab, label: 'Open the settings menu on Devices' }] : []),
    { kind: 'link', href: d.href, label: d.hrefLabel },
  ],
});

// ---------------------------------------------------------------------------------------------------
// THE TREE.
// ---------------------------------------------------------------------------------------------------
const BACK_TO_START = { label: 'Back to the start', to: GUIDE_ROOT };
const withKeys = (choices) => choices.map((c, i) => ({ key: String.fromCharCode(65 + i), ...c }));

// Mike's own words, with "pictures, settings, devices, Nimrod" in his order. Only said where it is true
// (the dashboard the site lands on); anywhere else he introduces himself with `INTROS` instead.
export const LANDING_INTRO = 'Hi, I’m Nimrod. I’m here to show you around and help out whenever you want. '
  + 'This is your default home dashboard. You will be able to modify it however you want. It currently has '
  + 'four modules: pictures, settings, devices, and me, Nimrod. You can feel free to mess around with anything '
  + 'you want as we go through. Would you like to:';

// What he says first, by where he is. A dashboard says which with its guide's `intro` state (dashboards.js
// records seed it); a guide added anywhere else has none and gets the plain one.
export const INTROS = Object.freeze({
  landing: LANDING_INTRO,
  tutorial: 'Hi, I’m Nimrod. This is the tutorial dashboard. I live here with the settings, in the bottom two '
    + 'places, so you can always find us: say “tutorial”, or choose it from your dashboards. Everything here '
    + 'is safe to try. Would you like to:',
  plain: 'Hi, I’m Nimrod. I’m here to show you around and help out whenever you want. Point at anything and '
    + 'I will tell you what it does. Would you like to:',
});
export const introFor = (key) => INTROS[key] || INTROS.plain;

const NODES = [
  {
    id: GUIDE_ROOT, title: 'Hi, I’m Nimrod', say: LANDING_INTRO,
    choices: withKeys([
      { label: 'Play it as a game, or learn with it', to: 'mode' },
      { label: 'Set up a device', to: 'devices' },
      { label: 'Set your theme, and learn about the settings', to: 'theme' },
      { label: 'Choose a photo album', to: 'album' },
      { label: 'See some other modules', to: 'other' },
    ]),
  },

  // ---- A. game or learning mode. The mechanics are unlocks.js; modules/nimrod.js hands `game-mode` acts
  // and every forward step to its hook (a new step pays, once, in game or learning mode). Every node here
  // shows the "Nimrod Game" page in the settings PANEL by itself (a settings-page act, which takes nothing
  // from anybody); if no panel answers, the hook suggests the settings menu or the tutorial — the two acts
  // on `mode` below (Mike: "If it's closed suggest opening it again or going to the tutorial dashboard").
  {
    id: 'mode', title: 'Game or learning mode',
    say: 'You can use the site as a game, or for learning. Game mode puts a scoreboard on your dashboard and '
      + 'gives you points for doing things, starting with this tour. Learning mode keeps its own education '
      + `points, apart from the game’s. ${POINTS_DISCLAIMER} In game and learning mode, not everything you can `
      + 'build with is unlocked at the start. That is only for the game’s sake: sandbox mode unlocks everything, '
      + 'and you can unlock things one at a time, free or with your points. Nothing already on your screen is '
      + 'ever locked away. The game’s settings open beside me.',
    choices: withKeys([
      { label: 'Game mode', to: 'mode-game' },
      { label: 'Learning mode', to: 'mode-learning' },
      { label: 'Sandbox: everything unlocked', to: 'mode-sandbox' },
      { label: 'What are points for?', to: 'points' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'settings-page', page: 'sc-game', label: 'Show the game settings', auto: true },
      { kind: 'menu-tab', tab: 'screen', label: 'Open the settings menu (This screen: Nimrod Game)' },
      { kind: 'tutorial', label: 'Go to the tutorial dashboard' },
    ],
  },
  {
    id: 'mode-game', title: 'Game mode',
    say: 'In game mode you earn Play points for what you do here, this tour included: each new step pays once. '
      + 'A “Nimrod Game” card on the scoreboard keeps the score. The things you can build with unlock as you go: '
      + 'that is only for the game, and sandbox mode or a single unlock opens anything sooner. Press Start game '
      + 'mode to begin.',
    choices: withKeys([
      { label: 'Sandbox instead', to: 'mode-sandbox' },
      { label: 'What are points for?', to: 'points' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'settings-page', page: 'sc-game', label: 'Show the game settings', auto: true },
      { kind: 'game-mode', mode: 'game', label: 'Start game mode' },
    ],
  },
  {
    id: 'mode-learning', title: 'Learning mode',
    say: 'Learning mode is game mode with education points: the tour and the lessons pay School points, kept '
      + 'apart from the game’s Play points, and things to build with unlock the same way. Whether lesson topics '
      + 'open as you go (Quest) or all at once is a separate setting, on the settings panel’s Lesson topics page.',
    choices: withKeys([
      { label: 'Game mode instead', to: 'mode-game' },
      { label: 'What are points for?', to: 'points' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'settings-page', page: 'sc-game', label: 'Show the game settings', auto: true },
      { kind: 'game-mode', mode: 'learning', label: 'Start learning mode' },
      { kind: 'settings-page', page: 'sc-mode', label: 'Show the lesson-topic setting' },
    ],
  },
  {
    id: 'mode-sandbox', title: 'Sandbox',
    say: 'Sandbox mode unlocks everything you can build with. Games still pay points as they always have; the '
      + 'tour pays only in game or learning mode. Nothing you have already unlocked is lost if you switch back.',
    choices: withKeys([
      { label: 'Game mode', to: 'mode-game' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'settings-page', page: 'sc-game', label: 'Show the game settings', auto: true },
      { kind: 'game-mode', mode: 'sandbox', label: 'Use sandbox mode' },
    ],
  },
  {
    id: 'points', title: 'Points',
    say: `Points keep score of what you do: a game finished, a lesson watched, a step of this tour. ${POINTS_DISCLAIMER} `
      + 'They cannot be bought, sold or cashed in. In game and learning mode they unlock things to build with, '
      + 'and the scoreboard shows them; in learning mode they are education points, kept apart from the game’s.',
    choices: withKeys([
      { label: 'Game mode', to: 'mode-game' },
      { label: 'Learning mode', to: 'mode-learning' },
      BACK_TO_START,
    ]),
  },

  // ---- B. devices ---------------------------------------------------------------------------------
  {
    id: 'devices', title: 'Set up a device',
    say: 'A device is anything you use to tell the screen what to do, or that it talks through. The devices '
      + 'panel lists them too. Which kind?',
    choices: withKeys([
      ...DEVICE_KINDS.map((d) => ({ label: d.label, to: `dev-${d.id}` })),
      BACK_TO_START,
    ]),
    acts: [{ kind: 'menu-tab', tab: 'devices', label: 'Open the settings menu on Devices' }],
  },
  ...DEVICE_KINDS.map(devNode),

  // ---- C. theme and the settings ------------------------------------------------------------------
  {
    id: 'theme', title: 'Your theme',
    say: 'Your theme is the colours and the look of everything: the background, the panels and the words. The '
      + 'settings beside me are open on Theme: pick one and the whole dashboard changes. There are many more '
      + 'settings in the settings menu, in tabs: sound, display, devices, people. Point at any setting and I '
      + 'will tell you what it does.',
    choices: withKeys([
      { label: 'Show me the settings menu’s tabs', to: 'settings-tabs' },
      { label: 'Make the panels see-through or solid', to: 'look' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'settings-page', page: 'sc-theme', label: 'Show the themes', auto: true },
      { kind: 'menu-tab', tab: 'display', label: 'Open the settings menu on Display' },
    ],
  },
  {
    id: 'settings-tabs', title: 'The settings menu',
    say: 'The settings menu opens from the gear on the bar. Its first tab is the panel you picked; then Sound, '
      + 'Display, Devices and People. At the top, “Settings for” chooses which panel, and “How much this menu '
      + 'shows” keeps the rarer settings out of the way until you want them. A switch steps through the tabs '
      + 'from the Tab row, and you can say “next tab”.',
    choices: withKeys([
      { label: 'Sound', to: 'tab-audio' },
      { label: 'Display', to: 'tab-display' },
      { label: 'Devices', to: 'devices' },
      { label: 'People', to: 'tab-people' },
      BACK_TO_START,
    ]),
    acts: [{ kind: 'menu-tab', tab: 'module', label: 'Open the settings menu' }],
  },
  {
    id: 'tab-audio', title: 'Sound',
    say: 'The Sound tab has the master volume, how loud each kind of sound is, and what a hidden panel does with '
      + 'its sound: keep playing, go quiet, or ask.',
    choices: withKeys([{ label: 'Another tab', to: 'settings-tabs' }, BACK_TO_START]),
    acts: [{ kind: 'menu-tab', tab: 'audio', label: 'Open the Sound tab' }],
  },
  {
    id: 'tab-display', title: 'Display',
    say: 'The Display tab has the colours, the panel backgrounds, and the slow drift that keeps a screen left on '
      + 'all day from burning in.',
    choices: withKeys([{ label: 'Another tab', to: 'settings-tabs' }, BACK_TO_START]),
    acts: [{ kind: 'menu-tab', tab: 'display', label: 'Open the Display tab' }],
  },
  {
    id: 'tab-people', title: 'People',
    say: 'The People tab says who the screen is for right now, and who may talk to it from a phone.',
    choices: withKeys([{ label: 'Another tab', to: 'settings-tabs' }, BACK_TO_START]),
    acts: [{ kind: 'menu-tab', tab: 'people', label: 'Open the People tab' }],
  },
  {
    id: 'look', title: 'See-through or solid',
    say: 'Each panel can sit on a solid card, a see-through one, or nothing at all, so a moving scene or a room '
      + 'shows behind it. It is on the Display tab, as “Panel backgrounds”.',
    choices: withKeys([{ label: 'Back to your theme', to: 'theme' }, BACK_TO_START]),
    acts: [{ kind: 'menu-tab', tab: 'display', label: 'Open the Display tab' }],
  },

  // ---- D. a photo album ---------------------------------------------------------------------------
  {
    id: 'album', title: 'A photo album',
    say: 'Your pictures come from a folder: on this computer, on a drive plugged into it, or from your media '
      + 'agent. They are never uploaded. The pictures panel’s settings choose which folder, as “Photos from”, '
      + 'and which album in it. They are open beside me.',
    choices: withKeys([
      { label: 'How do I connect a folder?', to: 'album-connect' },
      { label: 'How fast the pictures change', to: 'album-speed' },
      BACK_TO_START,
    ]),
    acts: [{ kind: 'settings-page', page: 'type:photos', label: 'Show the pictures’ settings', auto: true }],
  },
  {
    id: 'album-connect', title: 'Connecting a folder',
    say: 'Folders are connected once, on the Media tab of My dashboards. After that, every pictures panel can '
      + 'choose one, and an album inside it.',
    choices: withKeys([{ label: 'Back to the album', to: 'album' }, BACK_TO_START]),
    acts: [{ kind: 'link', href: '/home.html', label: 'My dashboards: Media' }],
  },
  {
    id: 'album-speed', title: 'How fast they change',
    say: 'The pictures panel’s “Change photo every” sets how long each picture stays: from four seconds to a '
      + 'minute. A new pictures panel starts at the speed of the one already there.',
    choices: withKeys([{ label: 'Back to the album', to: 'album' }, BACK_TO_START]),
    acts: [{ kind: 'settings-page', page: 'type:photos', label: 'Show the pictures’ settings', auto: true }],
  },

  // ---- E. other modules ---------------------------------------------------------------------------
  {
    id: 'other', title: 'Other modules',
    say: 'There are lots of other modules: games, videos, music, a clock, the weather, an AAC board and more. Try '
      + 'replacing the pictures with something else: pick them, then press Switch module. You can replace any '
      + 'module whenever you want, including me. Do you want to change:',
    choices: withKeys([
      { label: 'Play it as a game, or learn with it', to: 'mode' },
      { label: 'A module', to: 'change-module' },
      { label: 'A dashboard', to: 'change-dashboard' },
      { label: 'A scene (a collection of dashboards)', to: 'change-scene' },
      { label: 'How a module works (editing a module)', to: 'edit-module' },
      { label: 'Connect the AI of your choice', to: 'ai' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'switch', type: 'photos', label: 'Replace the pictures' },
      { kind: 'host', act: 'picker', label: 'See every module' },
    ],
  },
  {
    id: 'change-module', title: 'Changing a module',
    say: 'To change a module, pick it (Panel on the bar, or point at it), then press Switch module. The new one '
      + 'takes exactly its place and nothing else moves; Undo puts the old one back. Any module can be '
      + 'switched, me included. If you switch me away, say “tutorial” to find me again.',
    choices: withKeys([
      { label: 'A dashboard instead', to: 'change-dashboard' },
      { label: 'The tutorial dashboard', to: 'tutorial' },
      BACK_TO_START,
    ]),
    acts: [
      { kind: 'switch', type: 'photos', label: 'Switch module' },
      { kind: 'host', act: 'picker', label: 'See every module' },
    ],
  },
  {
    id: 'change-dashboard', title: 'Changing a dashboard',
    say: 'A dashboard is one screenful: the modules on it, where they sit, and what is behind them. Change this '
      + 'one with the edit bar (Scene, Add, Change), or start another from an example. Your dashboards are '
      + 'one press away from the Home button on the bar.',
    choices: withKeys([
      { label: 'A scene (a collection of dashboards)', to: 'change-scene' },
      { label: 'The tutorial dashboard', to: 'tutorial' },
      BACK_TO_START,
    ]),
    acts: [{ kind: 'host', act: 'examples', label: 'Show the examples' }],
  },
  {
    id: 'change-scene', title: 'Scenes',
    say: 'A scene is a collection of dashboards you can move between: a door in a room, a picture frame or a '
      + 'button can open another dashboard, and Back and Home always bring you back. The map of your '
      + 'dashboards shows what opens what.',
    choices: withKeys([
      { label: 'A dashboard', to: 'change-dashboard' },
      BACK_TO_START,
    ]),
    acts: [{ kind: 'menu-tab', tab: 'screen', label: 'Open the map (This screen tab)' }],
  },
  {
    id: 'edit-module', title: 'Editing a module',
    say: 'Every module has its own settings. Pick it and open the settings menu: the first tab is that module. '
      + 'Point at a setting and I will tell you what it does. A change you make here waits for Save.',
    choices: withKeys([
      { label: 'Changing a module for another', to: 'change-module' },
      BACK_TO_START,
    ]),
    acts: [{ kind: 'menu-tab', tab: 'module', label: 'Open this module’s settings' }],
  },
  {
    id: 'ai', title: 'Your own AI',
    say: 'I can be your AI. Press “Talk to” at my bottom (it carries your AI’s name once you give it one) to talk '
      + 'things over, typed or spoken. Connect whichever AI you like under “About”: one that runs free on your own '
      + 'computer, a free online one, or your own key. It can walk this guide with you, and anything it wants to do '
      + 'is a button you press first.',
    choices: withKeys([
      { label: 'Other modules', to: 'other' },
      BACK_TO_START,
    ]),
  },
  {
    id: 'tutorial', title: 'The tutorial dashboard',
    say: 'There is a tutorial dashboard you can always go to. It keeps me and the settings in its bottom two '
      + 'places, so you can always find us. Say “tutorial”, or choose it from your dashboards.',
    choices: withKeys([
      { label: 'Changing a module', to: 'change-module' },
      BACK_TO_START,
    ]),
    acts: [{ kind: 'tutorial', label: 'Go to the tutorial' }],
  },
];

export const GUIDE_NODES = Object.freeze(Object.fromEntries(NODES.map((n) => [n.id, Object.freeze(n)])));

// ---------------------------------------------------------------------------------------------------
// WHAT IS WRONG WITH A TREE, as sentences (empty = valid). The suite runs it over GUIDE_NODES.
// `knownTypes` (optional): registered module types, for `type:` settings pages and switch acts.
// `menuTabs` (optional): the settings menu's tab ids (actions.js MENU_TAB_IDS).
// ---------------------------------------------------------------------------------------------------
export function treeProblems(nodes = GUIDE_NODES, { root = GUIDE_ROOT, knownTypes = null, menuTabs = null } = {}) {
  const out = [];
  const ids = Object.keys(nodes || {});
  if (!nodes || !nodes[root]) return [`no root node "${root}"`];
  for (const id of ids) {
    const n = nodes[id];
    if (!n || n.id !== id) { out.push(`node ${id} is filed under the wrong id`); continue; }
    if (typeof n.title !== 'string' || !n.title.trim()) out.push(`${id}: no title`);
    if (typeof n.say !== 'string' || !n.say.trim()) out.push(`${id}: says nothing`);
    if (/\bher screen|christine|cici/i.test(`${n.title} ${n.say}`)) out.push(`${id}: site copy names a person or says "her screen"`);
    const ch = Array.isArray(n.choices) ? n.choices : [];
    if (!ch.length) out.push(`${id}: no choices (every choice gives information AND choices)`);
    const keys = new Set();
    for (const c of ch) {
      if (!c || typeof c.label !== 'string' || !c.label.trim()) out.push(`${id}: a choice with no label`);
      if (!c || !nodes[c.to]) out.push(`${id}: choice "${c?.label}" leads to ${c?.to}, which is not a node`);
      if (c?.key) { if (keys.has(c.key)) out.push(`${id}: key ${c.key} twice`); keys.add(c.key); }
    }
    for (const a of Array.isArray(n.acts) ? n.acts : []) {
      if (!a || !ACT_KINDS.includes(a.kind)) { out.push(`${id}: an act of unknown kind ${a?.kind}`); continue; }
      if (typeof a.label !== 'string' || !a.label.trim()) out.push(`${id}: a ${a.kind} act with no label`);
      if (a.kind === 'menu-tab' && (!a.tab || (menuTabs && !menuTabs.includes(a.tab)))) out.push(`${id}: menu tab ${a.tab} is not a tab`);
      if (a.kind === 'settings-page') {
        const p = String(a.page || '');
        const ok = SETTINGS_PAGES.includes(p) || (p.startsWith('type:') && (!knownTypes || knownTypes.has(p.slice(5))));
        if (!ok) out.push(`${id}: settings page ${p} does not exist`);
      }
      if (a.kind === 'menu-tab' && a.auto) out.push(`${id}: opening the settings MENU by itself would take the switch scan`);
      if (a.kind === 'switch' && knownTypes && a.type && !knownTypes.has(a.type)) out.push(`${id}: switch names ${a.type}, not a module`);
      if (a.kind === 'link' && !/^\/[a-z0-9_./-]*$/i.test(String(a.href || ''))) out.push(`${id}: link ${a.href} is not a page on this site`);
      if (a.kind === 'game-mode' && !GAME_MODES.includes(a.mode)) out.push(`${id}: game mode ${a.mode} is not one of ${GAME_MODES.join('/')}`);
      if (a.auto && a.kind !== 'settings-page') out.push(`${id}: only a settings-page act may run by itself`);
    }
  }
  // Everything reachable from the root: a node nobody can get to is a page nobody will read.
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const n = nodes[queue.shift()];
    for (const c of n?.choices || []) if (nodes[c.to] && !seen.has(c.to)) { seen.add(c.to); queue.push(c.to); }
  }
  for (const id of ids) if (!seen.has(id)) out.push(`${id} cannot be reached from ${root}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// THE TREE VIEW ("like a file tree", on by default). Each node's PLACE in the tree is where it is first
// reached from the root, breadth first (a node offered in two places — game mode — lives under the first).
// The view shows the root's children, and opens every node on the way to where you are, like a file
// explorer with that folder open. Pressing a row goes there (it is a choice like any other).
// ---------------------------------------------------------------------------------------------------
export function treeParents(nodes = GUIDE_NODES, root = GUIDE_ROOT) {
  const parent = { [root]: null };
  const queue = [root];
  while (queue.length) {
    const id = queue.shift();
    for (const c of nodes[id]?.choices || []) {
      if (nodes[c.to] && !(c.to in parent)) { parent[c.to] = id; queue.push(c.to); }
    }
  }
  return parent;
}

/** Root first, `id` last: where `id` sits in the tree. Unknown -> [root]. */
export function treePath(id, nodes = GUIDE_NODES, root = GUIDE_ROOT) {
  const parent = treeParents(nodes, root);
  if (!(id in parent)) return [root];
  const out = [];
  for (let at = id; at != null; at = parent[at]) out.unshift(at);
  return out;
}

/** The rows of the tree view: [{ id, title, depth, current, open, hasChildren }]. */
export function treeRows(currentId, nodes = GUIDE_NODES, root = GUIDE_ROOT) {
  const parent = treeParents(nodes, root);
  const kids = (id) => (nodes[id]?.choices || []).map((c) => c.to).filter((to) => parent[to] === id);
  const onPath = new Set(treePath(currentId, nodes, root));
  const rows = [];
  const walk = (id, depth) => {
    const open = onPath.has(id);
    const children = kids(id);
    rows.push({ id, title: nodes[id].title, depth, current: id === currentId, open: open && children.length > 0, hasChildren: children.length > 0 });
    if (open) for (const k of children) walk(k, depth + 1);
  };
  walk(root, 0);
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// THE WALK: a history, so Back goes back any number of steps, exactly the way you came.
// ---------------------------------------------------------------------------------------------------
export function createGuideNav({ nodes = GUIDE_NODES, root = GUIDE_ROOT, start = null } = {}) {
  let stack = [nodes[start] ? start : root];
  const here = () => stack[stack.length - 1];
  return {
    current: () => nodes[here()],
    id: here,
    /** Every step taken, root first (what Back walks). */
    history: () => [...stack],
    depth: () => stack.length - 1,
    canBack: () => stack.length > 1,
    /** Go to a node: by a choice, a tree row or a jump. Returns the node, or null (and stays) if unknown. */
    go(id) {
      if (!nodes[id]) return null;
      if (id !== here()) stack.push(id);
      return nodes[id];
    },
    /** Choose the current node's choice by index or by key ('A'...). */
    choose(which) {
      const ch = nodes[here()]?.choices || [];
      const c = typeof which === 'number' ? ch[which] : ch.find((x) => x.key === which);
      return c ? this.go(c.to) : null;
    },
    /** Back `n` steps (default 1), never past the start. Returns the node you are on. */
    back(n = 1) {
      const k = Math.max(0, Math.min(stack.length - 1, Math.floor(Number(n) || 0)));
      if (k) stack = stack.slice(0, stack.length - k);
      return nodes[here()];
    },
    /** Start over: the walk is just the root again. */
    restart() { stack = [root]; return nodes[root]; },
  };
}

// ---------------------------------------------------------------------------------------------------
// THE WORDS, and THE AI SEAM. `source(node, info)` may return a string or a promise of one; anything else,
// a throw, or no answer within `waitMs` falls back to the node's own words. 1500 ms, argued: long enough
// for a local model's first sentence on a desktop, short enough that a person pressing a choice is not
// left looking at the old words wondering whether the press landed. A setting when there is an AI to wait
// for (it is the AI task's to add).
// ---------------------------------------------------------------------------------------------------
export const AI_WAIT_MS = 1500;
export async function wordsFor(node, { source = null, intro = null, waitMs = AI_WAIT_MS, info = {} } = {}) {
  if (!node) return '';
  const own = node.id === GUIDE_ROOT ? introFor(intro) : node.say;
  if (typeof source !== 'function') return own;
  try {
    const timeout = new Promise((res) => { setTimeout(() => res(null), Math.max(0, waitMs)); });
    const said = await Promise.race([Promise.resolve(source(node, { intro, ...info })), timeout]);
    return typeof said === 'string' && said.trim() ? said.trim() : own;
  } catch { return own; }
}

/**
 * What an act SAYS on the bus: [{ topic, payload }] (a link says nothing: it is an anchor). The tutorial
 * says two things because two different hosts answer it: a real screen goes to the ready-made dashboard
 * (`dashboard/go`, kiosk.js), and Home, whose embedded screen has no other dashboards, tries it on its stage
 * (`shell/host` tutorial, modules.html). Each host ignores the one it does not answer.
 */
export function actMessages(a) {
  if (!a) return [];
  switch (a.kind) {
    case 'menu-tab': return [{ topic: GUIDE_TOPICS.menuTab, payload: { tab: a.tab } }];
    case 'settings-page': return [{ topic: GUIDE_TOPICS.settingsPage, payload: { page: a.page } }];
    case 'switch': return [{ topic: GUIDE_TOPICS.switchModule, payload: { type: a.type || null } }];
    case 'host': return [{ topic: GUIDE_TOPICS.host, payload: { act: a.act } }];
    case 'tutorial': return [
      { topic: GUIDE_TOPICS.dashboardGo, payload: { prebuilt: 'tutorial' } },
      { topic: GUIDE_TOPICS.host, payload: { act: 'tutorial' } },
    ];
    case 'game-mode': return [{ topic: GUIDE_TOPICS.gameMode, payload: { mode: a.mode } }];
    default: return [];
  }
}
