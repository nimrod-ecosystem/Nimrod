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
export const SYSTEM_TOPICS = Object.freeze({
  fullscreen: 'system/fullscreen',
  settings: 'system/settings',
  modules: 'system/modules',
  dashboards: 'system/dashboards',
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

export const verbTopic = (id) => `verb/${id}`;

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
const BUILT_IN_IDS = new Set([...VERBS, ...FOCUS_VERBS, ...MEDIA_VERBS].map((v) => v.id));

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
  photos:        { next: 'photos/next', prev: 'photos/prev' },
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
  algebra:       { select: 'algebra/submit' },
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
  sprint:        { select: { topic: 'sprint/control', payload: 'toggle' },
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
  // The weather: select reads now (or the lit day), next / prev walk the days, back returns to now.
  weather:       { next: 'weather/next', prev: 'weather/prev', select: 'weather/select', back: 'weather/back' },
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
  reg.registerAll(SYSTEM_ACTIONS);
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
