// input_speech.js — SPOKEN COMMANDS AS A DEVICE ON THE INPUT BUS.
//
// PRIORITY.md #8: *"a fixed voice-command set for people who will never use Nimrod. Browser
// speech recognition, a phrase table, no AI. Many phrasings → one verb."*
//
// The people this is for are the ones in the room who did not set the screen up and never will:
// an aide, a visiting relative, somebody who needs the video to stop and does not know there is
// a transport bar. They get a handful of words that work and nothing to learn - the nine
// navigation verbs, plus play, pause, louder and quieter (row 2.28) - each said after the wake
// phrase, "computer please" or "nimrod please" by default (DECISIONS.md, 2026-08-30; Mike,
// 2026-09-30).
//
// ---------------------------------------------------------------------------------------
// *** READ THIS BEFORE TURNING IT ON: THE BROWSER'S RECOGNISER IS NOT ON THE MACHINE. ***
// ---------------------------------------------------------------------------------------
//
// `SpeechRecognition` in Chrome **streams audio to Google's servers** and returns text. It is
// not local, and no flag makes it local. Safari uses Apple's. Firefox does not implement it at
// all.
//
// That matters more here than almost anywhere else, and it has to be said plainly rather than
// left for somebody to discover:
//
//   * The product's own pitch is that *your photos, video and camera stay on your own
//     hardware*. A recogniser that uploads room audio is the first thing in this codebase that
//     would break that sentence.
//   * The room in question has somebody in it around the clock who **cannot consent and cannot
//     ask what the screen is doing.** The camera consent question was settled with a posted sign
//     and facility paperwork; **audio leaving the building is a different question and has not
//     been asked.**
//
// So THREE rules, and they are the design rather than caution bolted on:
//
//   1. **IT SHIPS OFF.** Nothing here starts until somebody calls `start()`. There is no
//      autostart, no "on by default for convenience".
//   2. **THE ENGINE IS A SEAM.** `recognizer` is injected. The browser one is the interim, the
//      same way `voice.js` says Piper is the target and the Web Speech API is what it builds
//      against. A local recogniser (Vosk, whisper.cpp) drops in behind `start`/`stop`/`onText`
//      with nothing else changing — which is the whole reason the matching below is a pure
//      function over TEXT rather than anything to do with audio.
//   3. **THE MATCHING IS LOCAL AND DUMB, ON PURPOSE.** A phrase table, exact after
//      normalisation. No model and no guessing: a command set that sometimes guesses is worse
//      than one that sometimes does not fire - this drives somebody's screen, and a wrong verb is
//      a video that stops or a board that jumps. *** A NEAR MISS ASKS; IT NEVER ACTS. *** (Mike,
//      2026-09-30, note AO.) When what was heard is one word off exactly one command, the screen
//      says "It sounded like 'pause'. Did you mean that?" and fires ONLY on a yes. See
//      `nearMiss()` for the rule and its argument.
//
// *** OPEN RECOGNITION IS THE DEFAULT, EVERYWHERE (note AO). *** Mike: *"Wouldn't what you're
// saying force it into picking one of the options on a multiple choice question and pretty much
// any answer for rhyming/opposites."* - yes, for a GRAMMAR: a recogniser limited to a list can only
// answer with something on the list (the bench turned "hello there" into "louder" at confidence
// 1.0). Open recognition writes down what was said, and the exact match above then matches
// nothing. Asked whether that should be only inside the pause after the wake phrase, Mike: *"Even
// without a pause."* So the recogniser is told OPEN on the one-breath path, in the armed window,
// and while a game waits for an answer. GRAMMAR mode stays as a per-person option (`speechHearing`)
// for somebody whose speech open recognition cannot write down and who only needs a few commands.
//
// ---------------------------------------------------------------------------------------
// WHY A TABLE AND NOT A MODEL
// ---------------------------------------------------------------------------------------
//
// Mike's line is *"many phrasings → one verb"*, and that is exactly a lookup. People say "go
// back", "back", "previous", "go to the last one" and mean one thing. Writing them down is
// cheap, reviewable, translatable, and cannot surprise anybody. It also degrades honestly: an
// unrecognised phrase does NOTHING, visibly, rather than doing its best guess.

import { verbTopic } from './actions.js';
import { createSoundChannel } from './output_channels.js';

export const SPEECH_DEVICE = 'speech';

// *** THE LISTENING WINDOW IS AN EVENT, NOT A UI (row 2.36). *** Mike: the "I heard you" cue is
// "a setting", "a visual que on the screen also", and "another thing you could set objects for.
// Lights and things that turn on for any sort of visual notification." So this file SAYS the
// window opened or closed and draws nothing: a tone, an on-screen cue, the video ducking, and one
// day a lamp in the room each subscribe on their own (`listening_cue.js` has the first three).
//
//   { on: true,  reason: 'wake',    ms }   the wake phrase was heard on its own; `ms` is how long
//                                          the window stays open, so a subscriber can time itself
//                                          out even if the closing event never reaches it
//   { on: false, reason: 'command' }      a command fired (one wake, one command)
//   { on: false, reason: 'timeout' }      nobody said a command in time
//   { on: false, reason: 'stopped' }      the microphone was turned off
export const LISTENING_TOPIC = 'speech/listening';

// *** THE VOICE GAMES' TWO TOPICS (row 2.31), named here so the input layer does not import a
// module. *** `modules/word_games.js` declares the same two strings (ANSWER_TOPIC, GRAMMAR_TOPIC)
// and the suite checks they agree.
//   speech/grammar   a game says what it can accept right now:
//                    { source, instanceId, open, words, phase }
//   speech/answer    what was heard, sent to that game (to `speech/answer#<instanceId>` when the
//                    game said which instance it is): { text, confidence?, alternatives?, reason? }
export const SPEECH_GRAMMAR_TOPIC = 'speech/grammar';
export const SPEECH_ANSWER_TOPIC = 'speech/answer';
// *** A VOICE GAME IS LISTENING FOR AN ANSWER (Mike, 2026-09-30, note AN: "Pause everything if you
// go into a voice activated game"). *** Announced ONLY while the microphone is on AND a game has an
// open grammar - a game played by switch is not a voice game, and pausing a video beside it would
// be a cost with no reason. `listening_cue.js` pauses media on it.
//   { on: true,  source, instanceId, phase }   (re-sent on every change, so a subscriber's
//                                               watchdog is re-armed while the game is live)
//   { on: false, reason: 'closed' | 'stopped' }
export const ANSWERING_TOPIC = 'speech/answering';
// A grammar-limited recogniser's "none of these" word (Vosk). Always in every grammar built here:
// row 2.28's bench found that a grammar without an out ALWAYS hears one of its phrases.
export const UNKNOWN_WORD = '[unk]';

/**
 * *** THE PHRASE TABLE. MANY PHRASINGS, ONE VERB. ***
 *
 * Ordinary English for each spoken verb, written for somebody who has never seen this
 * software and is saying the first thing that comes to mind.
 *
 * TWO RULES FOR ADDING TO IT:
 *
 *   * **No phrase may appear under two verbs.** `duplicatePhrases()` below is checked by the
 *     suite, because a table where "stop" means both `select` and `back` is a coin flip
 *     pointed at somebody's screen.
 *   * **Nothing shorter than three letters.** "up" and "go" survive as whole phrases, but a
 *     recogniser mis-hearing a syllable should not be able to fire a verb — and the shorter the
 *     phrase, the more often that happens.
 */
//
// *** ROW 2.28 ADDED PLAY, PAUSE AND VOLUME, AND MORE WAYS TO SAY THE OLD ONES. *** Mike asked
// for "a fuzzy search type thing where we just make other ways people might phrase it" - and
// that is exactly this table growing, not the matching getting loose. The matching stays exact
// (rule 3 in the header); the one fuzzy thing is the near-miss QUESTION, which never acts on its
// own. Every phrase here is plain, common, lowercase words, four at most - a phrase a small engine
// can know, and a grammar (the per-person option) can list.
//
// THE DANGEROUS WORDS, and where they went:
//   * "stop" -> pause. Said to a playing video it means pause, and pause cannot END anything.
//     "stop that" MOVED here from `back` for the same reason: on a call `back` is HANG UP, and
//     "stop that" ending somebody's call is the one reading of it nobody intends.
//   * "wait", "hold on", "hang on" -> pause. Nothing else claims them.
//   * NOT "start" or "go on" for play: "start"/"stop" and "go on"/"go ahead" (select) are each a
//     sound apart, and a recogniser confusing a pair would turn one command into its opposite.
export const PHRASES = {
  select: ['select', 'okay', 'ok', 'yes', 'choose', 'choose it', 'do it', 'press it',
           'that one', 'this one', 'go ahead'],
  back:   ['back', 'go back', 'cancel', 'undo that', 'never mind', 'nevermind'],
  next:   ['next', 'go next', 'forward', 'next one', 'move on', 'skip', 'skip it',
           'skip this', 'skip this one', 'next video', 'another one',
           'change it', 'something else'],
  prev:   ['previous', 'go previous', 'last one', 'previous one', 'back one', 'go backwards',
           'go back one', 'previous video', 'the one before'],
  up:     ['up', 'go up', 'move up'],
  down:   ['down', 'go down', 'move down'],
  left:   ['left', 'go left', 'move left'],
  right:  ['right', 'go right', 'move right'],
  menu:   ['menu', 'settings', 'open the menu', 'show the menu', 'options'],
  // The media four (MEDIA_VERBS in actions.js).
  // No 'unpause': measured 2026-09-30 on the bench Pi, it is not in the Vosk small model's
  // vocabulary, so the local recogniser can never return it — a dead row that only looks like
  // coverage. Every phrase here should be one the local model can actually hear.
  play:   ['play', 'play it', 'play the video', 'resume', 'keep going', 'carry on',
           'continue'],
  pause:  ['pause', 'pause it', 'pause the video', 'stop', 'stop it', 'stop that',
           'stop the video', 'wait', 'hold on', 'hang on'],
  'volume-up':   ['louder', 'volume up', 'turn it up', 'turn up', 'turn the volume up',
                  'turn up the volume', 'a bit louder', 'a little louder', 'make it louder',
                  'more volume', 'too quiet'],
  'volume-down': ['quieter', 'volume down', 'turn it down', 'turn down', 'turn the volume down',
                  'turn down the volume', 'a bit quieter', 'a little quieter', 'make it quieter',
                  'less volume', 'too loud', 'softer'],
  // *** THE ACTION VERBS (2026-10-02; ACTION_VERBS in actions.js). *** Mike, on brick breaker: "right,
  // left, stop (stops the paddle), launch, pause (pauses and brings up settings), resume". Right, left,
  // pause and resume ("resume" is a play phrase) were already here.
  //   * BARE "stop" STAYS PAUSE, on purpose (see the note above this table: said to a video it must not
  //     end anything). Brick breaker gets "stop" = stop the paddle through its manifest's `voice`, which
  //     wins only while brick breaker has focus (`moduleVoiceTable`, `attachSpeech`'s `scoped`). Here
  //     the stop verb gets phrases that cannot mean pause.
  //   * "close" is the menu's way out, and only out (actions.js says why it is not `menu`).
  launch: ['launch', 'launch it', 'launch the ball'],
  stop:   ['stop moving', 'stay there', 'stay still'],
  close:  ['close', 'close it', 'close the menu', 'close menu', 'close settings', 'close the settings'],
};

/**
 * *** SPOKEN ROUTES: A PHRASE THAT OPENS SOMETHING RATHER THAN DRIVING A VERB (row 2.31). ***
 *
 * Mike, 2026-09-30: *"Computer please play the whatever game."* "Play opposites" is not a verb -
 * it names a thing, and a verb means "whatever is in front of you" - so it is not a row in
 * `PHRASES` (which the suite keeps to exactly the verb vocabulary). It is the SAME kind of row
 * all the same: exact whole-utterance match, after the wake phrase, through the input bus as a
 * press on `phrase:<id>`, so it is rebindable and gated exactly like "pause". Each route is an
 * ordinary action (`SPEECH_ACTIONS`, carrying its payload) that the host registers next to the
 * verb actions.
 *
 * *** NO PHRASE UNDER TWO MEANINGS, ACROSS BOTH TABLES. *** `duplicatePhrases()` checks the verbs
 * and the routes together by default. "play" is a verb and "play opposites" a route; both are
 * whole utterances, so neither can fire the other.
 *
 * Vocabulary [unverified on the bench]: every word here should be one the small Vosk model knows
 * ("unpause" was not); "rhyming" and "quiz" are the ones to check first.
 */
export const ROUTES = {
  'play-opposites': { topic: 'word_games/play', payload: { game: 'opposites' }, label: 'Play Opposites',
    phrases: ['play opposites', 'play the opposites game', 'the opposites game', 'opposites'] },
  'play-rhyming':   { topic: 'word_games/play', payload: { game: 'rhyming' }, label: 'Play Rhyming',
    phrases: ['play rhyming', 'play rhymes', 'play the rhyming game', 'the rhyming game', 'rhyming'] },
  'play-yesno':     { topic: 'word_games/play', payload: { game: 'yesno' }, label: 'Play Yes or No',
    phrases: ['play yes or no', 'play yes no', 'play the quiz', 'yes or no quiz'] },
  // ROW 2.45's "name that" games (public e42cc92): one module, a `game` setting, the same /play shape.
  'play-name-animal': { topic: 'name_that/play', payload: { game: 'animal' }, label: 'Play Name that animal',
    phrases: ['play name that animal', 'name that animal'] },
  'play-name-state':  { topic: 'name_that/play', payload: { game: 'state' }, label: 'Play Name that state',
    phrases: ['play name that state', 'name that state'] },
  'play-name-person': { topic: 'name_that/play', payload: { game: 'person' }, label: 'Play Name that person',
    phrases: ['play name that person', 'name that person'] },
  // Row 2.45, 2026-10-01: the thinking games (the SLP exercises).
  'play-thinking': { topic: 'think_games/play', payload: { game: 'mix' }, label: 'Play Thinking games',
    phrases: ['play thinking games', 'thinking games'] },
  'play-smallest': { topic: 'think_games/play', payload: { game: 'numbers' }, label: 'Play Smallest number',
    phrases: ['play smallest number', 'smallest number'] },
  'play-biggest': { topic: 'think_games/play', payload: { game: 'things' }, label: 'Play Biggest thing',
    phrases: ['play biggest thing', 'biggest thing'] },
  'play-groups': { topic: 'think_games/play', payload: { game: 'groups' }, label: 'Play Name the group',
    phrases: ['play name the group', 'name the group'] },
  'play-finish': { topic: 'think_games/play', payload: { game: 'finish' }, label: 'Play Finish the sentence',
    phrases: ['play finish the sentence', 'finish the sentence'] },
  // Row 2.45, 2026-10-01: the word builder and the brain games. Question-like names are "play ..." only,
  // so "what comes next?" said in passing does not start a game.
  'play-word-builder': { topic: 'word_builder/play', payload: { game: 'word_builder' }, label: 'Play Word builder',
    phrases: ['play word builder', 'word builder'] },
  'play-brain': { topic: 'brain_games/play', payload: { game: 'mix' }, label: 'Play Brain games',
    phrases: ['play brain games', 'brain games'] },
  'play-different': { topic: 'brain_games/play', payload: { game: 'odd' }, label: 'Play Which one is different',
    phrases: ['play odd one out', 'play which is different'] },
  'play-order': { topic: 'brain_games/play', payload: { game: 'order' }, label: 'Play Remember the order',
    phrases: ['play remember the order'] },
  'play-count': { topic: 'brain_games/play', payload: { game: 'count' }, label: 'Play Quick count',
    phrases: ['play quick count', 'quick count'] },
  'play-next': { topic: 'brain_games/play', payload: { game: 'next' }, label: 'Play What comes next',
    phrases: ['play what comes next'] },

  // *** THE SCREEN BY VOICE (2026-10-02). *** Mike: "We should probably add voice commands for the menus
  // and everything, if we don't already have them. Also, the cursor should have voice commands ... Other
  // general things like scroll up or down." WHAT ALREADY EXISTED: "menu" / "settings" / "open the menu"
  // (the menu verb, a toggle), and while the menu is open "next", "previous", "select", "back" walk it.
  // ADDED: "open settings" (OPENS, never closes - `system/settings`, which the kiosk answers with open-if-
  // closed), "close the menu" (the close verb, PHRASES above), and the cursor below. The menu's TABS
  // arrived the same day (settings.js "TABS"): "next tab" / "previous tab" and "<tab> settings", below,
  // press actions.js MENU_ACTIONS - routes, not verbs, for the cursor's reason: the menu is not a panel.
  //
  // *** A ROUTE MAY NAME AN EXISTING ACTION (`action`) instead of a topic. *** These press actions that
  // are already registered (actions.js SYSTEM_ACTIONS and CURSOR_ACTIONS), so a switch and a phrase
  // reach the SAME action id - one thing to bind, one thing to log - and SPEECH_ACTIONS does not
  // register a second copy of them.
  'open-settings': { action: 'system/settings', label: 'Open the settings',
    phrases: ['open settings', 'open the settings', 'show settings', 'show the settings'] },
  // The cursor (cursor_drive.js). "A bit" is the plain phrase as well; "a lot" goes further. How far
  // each goes is a setting there. Every phrase starts with "cursor" or "mouse" (or is "click" / "scroll"),
  // so none can be heard as the panel verbs "left" / "move left".
  'cursor-left':  { action: 'cursor/left', label: 'Cursor left a bit',
    phrases: ['cursor left', 'move cursor left', 'move the cursor left', 'cursor left a bit', 'mouse left'] },
  'cursor-right': { action: 'cursor/right', label: 'Cursor right a bit',
    phrases: ['cursor right', 'move cursor right', 'move the cursor right', 'cursor right a bit', 'mouse right'] },
  'cursor-up':    { action: 'cursor/up', label: 'Cursor up a bit',
    phrases: ['cursor up', 'move cursor up', 'move the cursor up', 'cursor up a bit', 'mouse up'] },
  'cursor-down':  { action: 'cursor/down', label: 'Cursor down a bit',
    phrases: ['cursor down', 'move cursor down', 'move the cursor down', 'cursor down a bit', 'mouse down'] },
  'cursor-left-far':  { action: 'cursor/left-far', label: 'Cursor left a lot',
    phrases: ['cursor left a lot', 'cursor far left', 'mouse left a lot'] },
  'cursor-right-far': { action: 'cursor/right-far', label: 'Cursor right a lot',
    phrases: ['cursor right a lot', 'cursor far right', 'mouse right a lot'] },
  'cursor-up-far':    { action: 'cursor/up-far', label: 'Cursor up a lot',
    phrases: ['cursor up a lot', 'cursor way up', 'mouse up a lot'] },
  'cursor-down-far':  { action: 'cursor/down-far', label: 'Cursor down a lot',
    phrases: ['cursor down a lot', 'cursor way down', 'mouse down a lot'] },
  'cursor-click': { action: 'cursor/click', label: 'Click where the cursor is',
    phrases: ['click', 'click it', 'click there', 'click here', 'click that'] },
  'scroll-up':    { action: 'cursor/scroll-up', label: 'Scroll up',
    phrases: ['scroll up', 'page up', 'scroll back up'] },
  'scroll-down':  { action: 'cursor/scroll-down', label: 'Scroll down',
    phrases: ['scroll down', 'page down', 'scroll further down'] },
  // THE SETTINGS MENU'S TABS (2026-10-02, actions.js MENU_ACTIONS). Each opens the menu if it is closed.
  // "<tab> settings" says which; every phrase ends in "tab" or "settings", so none is a panel verb, and
  // none is "settings" alone (that is the menu verb, a toggle).
  'menu-next-tab': { action: 'menu/next-tab', label: 'Settings menu: next tab',
    phrases: ['next tab', 'the next tab', 'go to next tab'] },
  'menu-prev-tab': { action: 'menu/prev-tab', label: 'Settings menu: previous tab',
    phrases: ['previous tab', 'the previous tab', 'last tab', 'go back a tab'] },
  'menu-tab-module': { action: 'menu/tab-module', label: 'Settings menu: the selected panel',
    phrases: ['panel settings', 'module settings', 'this panel settings'] },
  'menu-tab-audio': { action: 'menu/tab-audio', label: 'Settings menu: sound',
    phrases: ['sound settings', 'audio settings', 'volume settings'] },
  'menu-tab-display': { action: 'menu/tab-display', label: 'Settings menu: display',
    phrases: ['display settings', 'video settings', 'colour settings', 'color settings'] },
  'menu-tab-devices': { action: 'menu/tab-devices', label: 'Settings menu: devices',
    phrases: ['device settings', 'devices settings', 'switch settings', 'input settings'] },
  'menu-tab-people': { action: 'menu/tab-people', label: 'Settings menu: people',
    phrases: ['people settings', 'user settings', 'users settings', 'person settings'] },
  'menu-tab-screen': { action: 'menu/tab-screen', label: 'Settings menu: this screen',
    phrases: ['screen settings', 'this screen settings'] },
  // "Switch module" (2026-10-02): the selected panel's short list of other modules.
  'switch-module': { action: 'menu/switch-module', label: 'Switch the selected panel to another module',
    phrases: ['switch module', 'switch the module', 'change module', 'change the module', 'swap module'] },
  // Home's edit bar (2026-10-02): the same action a switch binds (actions.js `shell/host/editbar`), which
  // opens the bar holding the scan. Each phrase names the bar or "my home", so none is a panel verb.
  'home-edit-bar': { action: 'shell/host/editbar', label: 'Home: the edit bar',
    phrases: ['edit bar', 'open the edit bar', 'show the edit bar', 'edit my home'] },
};

// Every spoken phrase, verbs and routes, as one table keyed by what it presses. Route keys are the
// route id; the suite checks no route id is also a verb id, so the two cannot collide.
export function spokenTable(table = PHRASES, routes = ROUTES) {
  const out = { ...table };
  for (const [id, r] of Object.entries(routes || {})) out[id] = Array.isArray(r?.phrases) ? r.phrases : [];
  return out;
}

/**
 * Normalise what a recogniser handed back so the table can be a plain lookup.
 *
 * Recognisers punctuate, capitalise and pad differently between engines and between releases,
 * and a table that only matched one engine's punctuation would look like a broken microphone.
 * Everything here is reversible and boring on purpose: lowercase, strip anything that is not a
 * letter or a space, collapse runs of space.
 */
export function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Which verb, if any, was said. `null` for anything not in the table — and NOTHING happening is
 * the correct outcome for an unrecognised phrase.
 *
 * Matched against the WHOLE utterance rather than by searching inside it. "I do not want to go
 * back" contains "go back", and a screen that jumps because somebody said a sentence with the
 * word in it is the failure this is built to avoid. A person giving a command says the command.
 */
export function verbFor(text, table = PHRASES) {
  const said = normalize(text);
  if (!said) return null;
  for (const [verb, phrases] of Object.entries(table)) {
    for (const p of phrases) if (normalize(p) === said) return verb;
  }
  return null;
}

/** Which spoken route, if any, was said: the route id or null. Same exact whole-utterance rule. */
export function routeFor(text, routes = ROUTES) {
  const said = normalize(text);
  if (!said) return null;
  for (const [id, r] of Object.entries(routes || {})) {
    for (const p of (r?.phrases || [])) if (normalize(p) === said) return id;
  }
  return null;
}

/**
 * Any phrase listed under more than one meaning. Must always be empty — see the table's note.
 * By default over the WHOLE spoken table: the verbs AND the routes.
 */
export function duplicatePhrases(table = spokenTable()) {
  const seen = new Map();
  const dupes = [];
  for (const [verb, phrases] of Object.entries(table)) {
    for (const p of phrases) {
      const k = normalize(p);
      if (seen.has(k) && seen.get(k) !== verb) dupes.push(`"${p}" is both ${seen.get(k)} and ${verb}`);
      else seen.set(k, verb);
    }
  }
  return dupes;
}

/** The control name a phrase produces. Stable, because bindings persist against it. */
export const phraseControl = (verb) => `phrase:${verb}`;

/**
 * The shipped bindings: each spoken verb drives the verb topic of the same name.
 *
 * They are ORDINARY bindings, exactly like the keyboard's — rebind them, or point "next" at
 * something else entirely, and nothing here needs to change. That is the whole reason this
 * emits onto the input bus as a device rather than publishing verbs directly.
 */
export const DEFAULT_BINDINGS = Object.keys(PHRASES).map((verb) => ({
  id: `default/speech-${verb}`,
  actionId: verbTopic(verb),
  device: SPEECH_DEVICE,
  control: phraseControl(verb),
  edge: 'press',
  role: 'universal',
  holdMs: 0, debounceMs: 0, lockoutMs: 0,
  label: `Say “${PHRASES[verb][0]}”`,
}));

/**
 * The action a spoken route presses. Stable, because bindings persist against it. A route that names
 * an existing action (`action`, 2026-10-02) presses THAT one.
 */
export const routeAction = (id, routes = ROUTES) => {
  const a = routes?.[id]?.action;
  return typeof a === 'string' && a ? a : `speech/${id}`;
};

/**
 * THE ROUTES AS ACTIONS, for the host to register next to the verbs:
 * `registry.registerAll(SPEECH_ACTIONS)`. Each carries its topic and payload (actions.js already
 * supports a payload), so "play opposites" publishes `word_games/play { game: 'opposites' }`.
 * An input bus refuses an unregistered action, so a host that adds `ROUTE_BINDINGS` without these
 * gets an `unknown-action` report per phrase, never a wrong action.
 */
export const SPEECH_ACTIONS = Object.entries(ROUTES).filter(([, r]) => !r.action).map(([id, r]) => ({
  id: routeAction(id), label: r.label, topic: r.topic, payload: r.payload, group: 'Spoken',
}));

/** The routes' shipped bindings, the same shape as the verbs'. */
export const ROUTE_BINDINGS = Object.entries(ROUTES).map(([id, r]) => ({
  id: `default/speech-${id}`,
  actionId: routeAction(id),
  device: SPEECH_DEVICE,
  control: phraseControl(id),
  edge: 'press',
  role: 'universal',
  holdMs: 0, debounceMs: 0, lockoutMs: 0,
  label: `Say “${r.phrases[0]}”`,
}));

/** Everything a host adds to the input bus for speech: the verbs, then the routes. */
export const SPEECH_BINDINGS = [...DEFAULT_BINDINGS, ...ROUTE_BINDINGS];

// ---------------------------------------------------------------------------------------
// *** A MODULE'S OWN SPOKEN COMMANDS, WHILE IT HAS FOCUS (2026-10-02). ***
// ---------------------------------------------------------------------------------------
//
// Mike, on brick breaker: "right, left, stop (stops the paddle), launch, pause (pauses and brings up
// settings), resume". Every one of those is already a verb - except that bare "stop" means PAUSE in the
// table above, deliberately, everywhere. A module therefore declares, in its manifest:
//
//     voice: { 'stop': 'stop', 'stop the paddle': 'stop', 'launch': 'launch', 'resume': 'play', ... }
//
// phrase -> one of its own verbs (MODULE_VERBS), and WHILE THAT MODULE HAS FOCUS its phrases are
// looked up FIRST. Everywhere else nothing changes. The rules, each checked by `moduleVoiceTable`:
//   * the verb must be one the module answers (`verbs`) AND one the speech layer can press (a key of
//     PHRASES: its `phrase:<verb>` control is bound to `verb/<verb>` in DEFAULT_BINDINGS) - otherwise
//     the phrase would fire nothing, and a command that does nothing is worse than no command;
//   * the phrase is plain lowercase words, four at most, at least two letters - the table's own rules;
//   * a phrase that is a wake phrase can never be one (usableWakePhrases refuses commands, and the
//     host's wake list comes first).
// It goes through the input bus as a press on `phrase:<verb>`, exactly like a table phrase, so the
// gate, the log and a person's own rebinding all apply. The host hands `attachSpeech` a `scoped()`
// that returns the focused module's table (kiosk.js: the router's focused type and its manifest).
// Read at the moment something is heard, so focus moving needs no restart of the recogniser.

const VOICE_WORDS_MAX = 4;
/** A manifest's `voice` -> `{ normalised phrase: verb }`, with every row that could not work dropped. */
export function moduleVoiceTable(voice, { verbs = null, table = PHRASES } = {}) {
  const out = {};
  if (!voice || typeof voice !== 'object') return out;
  const speakable = new Set(Object.keys(table || {}));
  const allowed = Array.isArray(verbs) ? new Set(verbs) : null;
  for (const [raw, verb] of Object.entries(voice)) {
    const p = normalize(raw);
    if (!p || p !== String(raw) || p.split(' ').length > VOICE_WORDS_MAX) continue;
    if (p.replace(/\s/g, '').length < 2) continue;
    if (typeof verb !== 'string' || !speakable.has(verb)) continue;
    if (allowed && !allowed.has(verb)) continue;
    out[p] = verb;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// WHAT A RECOGNISER MAY SAY BESIDES THE TEXT (row 2.31)
// ---------------------------------------------------------------------------------------
//
// `onText(text, detail)`. `detail` is optional and every field in it is optional:
//
//   confidence    0..1, how sure the engine was of `text`
//   alternatives  other readings it considered, best first (strings)
//   reason        WHY it is unsure: 'quiet' | 'noise' | 'cutoff' | 'alternative' — ONLY when the
//                 engine actually knows. A voice game reads this back to a person ("because it was
//                 very quiet"), so a guessed reason is a lie told to somebody about their own
//                 voice. Anything outside the four is dropped here rather than passed on.
export const RECOGNITION_REASONS = ['quiet', 'noise', 'cutoff', 'alternative'];

/** Keep only what a recogniser really said, in the shape the games take. Never invents a field. */
export function cleanDetail(detail) {
  const out = {};
  if (!detail || typeof detail !== 'object') return out;
  const c = Number(detail.confidence);
  if (detail.confidence != null && Number.isFinite(c)) out.confidence = Math.max(0, Math.min(1, c));
  if (Array.isArray(detail.alternatives)) {
    const alts = detail.alternatives.map((a) => (typeof a === 'string' ? a : a?.text ?? a?.transcript))
      .filter((a) => typeof a === 'string' && a.trim());
    if (alts.length) out.alternatives = alts;
  }
  const r = String(detail.reason || '').toLowerCase().replace(/[\s_-]+/g, '');
  if (RECOGNITION_REASONS.includes(r)) out.reason = r;
  return out;
}

// The browser's result list, read as a `detail`. Chrome reports a confidence of 0 when it has none
// [training knowledge], so 0 is treated as "not reported" - a game then asks to confirm, which is
// what it does for any engine that cannot say how sure it is.
function detailFromBrowser(r) {
  const d = {};
  const c = Number(r?.[0]?.confidence);
  if (Number.isFinite(c) && c > 0) d.confidence = c;
  const alts = [];
  for (let k = 1; k < (r?.length || 0); k++) if (r[k]?.transcript) alts.push(r[k].transcript);
  if (alts.length) d.alternatives = alts;
  return d;
}

/**
 * The browser's recogniser, wrapped to the seam `attachSpeech` wants: `start`, `stop`, and an
 * `onText` callback. Returns null where the API does not exist, which is Firefox and every
 * browser with the feature disabled — the caller reports that rather than throwing.
 */
export function browserRecognizer({ view = typeof window !== 'undefined' ? window : null,
                                    lang = 'en-US' } = {}) {
  const Ctor = view && (view.SpeechRecognition || view.webkitSpeechRecognition);
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  // FINAL RESULTS ONLY. Interim results change as somebody keeps talking, so acting on them
  // fires a verb from half a word and then possibly a second from the rest.
  rec.interimResults = false;
  // A few alternatives, so a voice game can say "it could also be Z" when the engine offered one.
  rec.maxAlternatives = 3;
  let onText = null;
  let want = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r.isFinal || !onText) continue;
      onText(r[0]?.transcript || '', detailFromBrowser(r));
    }
  };
  // No grammar here: Chrome ignores `SpeechGrammarList` [training knowledge], so the browser's
  // engine is always OPEN recognition - which is the default `recognitionMode()` asks for anyway
  // (note AO). It has no `setMode`, and `attachSpeech` does not need one.
  // A continuous recogniser stops itself on silence, on a network hiccup, and on some engines
  // every minute or so. Without this it dies quietly and the microphone appears to stop working
  // for no reason anybody in the room can see.
  rec.onend = () => { if (want) { try { rec.start(); } catch { /* already starting */ } } };
  return {
    start(cb) { onText = cb; want = true; try { rec.start(); } catch { /* already started */ } },
    stop() { want = false; onText = null; try { rec.stop(); } catch { /* already stopped */ } },
    get running() { return want; },
  };
}

// ---------------------------------------------------------------------------------------
// THE WAKE PHRASE AND THE CONFIRMATION (row 2.28; DECISIONS.md "Voice commands", 2026-08-30)
// ---------------------------------------------------------------------------------------
//
// Every value here is a DEFAULT that `attachSpeech` takes as an option, and each carries its
// argument, because a hard-coded number is an absolute wearing a disguise.
export const CONFIRM_MODES = ['tone', 'word', 'off'];
// How the recogniser is asked to listen: 'open' (any words, the engine's whole vocabulary) or
// 'grammar' (only a list - Vosk's grammar mode). See `recognitionMode()` in attachSpeech.
export const RECOGNITION_MODES = ['open', 'grammar'];
export const ANSWER_MATCHES = ['exact', 'any'];

export const SPEECH_DEFAULTS = Object.freeze({
  // *** "COMPUTER PLEASE" AND "NIMROD PLEASE". *** DECISIONS 08-30 made "Computer please" the
  // default and a setting; Mike, 2026-09-30 (register 276): "Nimrod please will be a default for
  // everyone else. Computer please will also be a default." Neither is a person's name, so neither
  // collides with somebody in the room, and both are settings (SPEECH_FIELDS below).
  //   * A PERSON'S OWN PHRASE GOES ON THEIR OWN PROFILE, NEVER HERE. A name somebody calls the
  //     screen is set as that person's second phrase; a site default everybody gets must never
  //     carry one (the suite checks).
  //   * TWO KNOWN COLLISIONS, both answered by the setting rather than by dropping a default:
  //     "Nimrod" is the name of Mike's own household cat, so his profile changes it; and Amazon
  //     Echo devices can be set to wake on "Computer" [training knowledge, not verified here], so
  //     in a room with such an Echo "computer please" would wake it too.
  wake: Object.freeze(['computer please', 'nimrod please']),
  // *** REQUIRED BY DEFAULT. *** The screen's own speaker is in the room: without a gate, a
  // video in which somebody says "stop" or "next" drives the screen it is playing on, and so
  // does any conversation that happens to be a bare command. The person who wants the opposite
  // - a quiet room, one user, no preamble - turns it off; nothing else changes.
  requireWake: true,
  // *** THE TWO-STEP PATH: THE WAKE PHRASE ON ITS OWN, THEN THE COMMAND. ON BY DEFAULT. ***
  // The bench (row 2.28) recommended one breath only, because the armed window was the only
  // source of false fires. Mike, 2026-09-30 (note AN), overruled it for the right reason: *"I can't
  // get her to always say everything in one breath in her condition. She'll probably stop to think
  // a lot."* So the window stays, and the false fire is fixed where it came from - the GRAMMAR (see
  // `recognition`). The person who wants one breath only (a busy room, a TV that talks a lot)
  // turns this off; the wake phrase alone then opens nothing.
  twoStep: true,
  // How long after the wake phrase ON ITS OWN a command may follow as a separate utterance.
  // Eight seconds: long enough for somebody who needs a moment between "computer please" and
  // the word (a recogniser also ends an utterance at the pause, so "computer please ... pause"
  // arrives as two), short enough that a command-shaped word in a later, unrelated sentence
  // is not taken as one. One wake, one command: the window closes the moment a command fires.
  // A SETTING (`speechWindowMs`): somebody who stops to think wants longer on their own profile
  // (her profile: try 15 s - Code's suggestion, not measured).
  wakeWindowMs: 8000,
  // *** HOW THE RECOGNISER LISTENS: OPEN, EVERYWHERE, BY DEFAULT (note AO). *** The bench fault,
  // exactly: with the recogniser limited to the command list, "hello there" came back as "louder"
  // at confidence 1.0 - a grammar can only answer with one of its own phrases, and [unk] did not
  // reliably stop it; a grammar of a game's words hears one of the game's words in every cough
  // (row 2.31's trap). OPEN recognition writes "hello there" down as it is, and the exact match
  // then matches nothing. Mike: "Even without a pause" - so this covers the one-breath path, the
  // armed window, a game's answer and the "did you mean" answer alike.
  //   * 'grammar' is the PER-PERSON option: somebody whose speech the open model cannot write down
  //     and who only needs a few commands. It keeps every grammar this file builds.
  //   * [inferred - measure on the bench]: the small open model is slower and less accurate on
  //     short single words than the same engine given a grammar. That cost is what the near-miss
  //     question below is for: a command heard one sound off is asked about, not lost.
  //   * `attachSpeech` still takes `armedRecognition` / `answerRecognition` to override one state
  //     for a host that needs to; they follow this unless set, and are not menu fields - a way of
  //     hearing belongs to a person, not to a moment.
  recognition: 'open',
  // *** WHAT COUNTS AS AN ANSWER: 'exact' BY DEFAULT. *** Open recognition hears the whole room, so
  // only an utterance that IS one of the words the game said it can accept (after normalising) goes
  // to the game; "no, she's asleep" said to a nurse is not an answer. 'any' sends every utterance,
  // which lets the game's own "I don't know that word" and "I didn't catch that" lines speak - the
  // option for a quiet room with one player in it.
  answerMatch: 'exact',
  // *** A TONE, NOT A WORD, BY DEFAULT. *** DECISIONS 08-30: confirm with a tone or a short word,
  // never read content back. The tone wins the default because it is honest about what is known
  // - the phrase was HEARD, not that the panel did it (a panel with no pause ignores the verb) -
  // it needs no language, and it says nothing aloud into a room with somebody in it.
  confirm: 'tone',
  // In `word` mode, the ONE thing said, for every command. Deliberately not "Paused"/"Louder":
  // a per-verb word claims the thing happened, which is not known here. And never a word in the
  // phrase table or a wake phrase, or the screen's own speaker could command it (checked).
  confirmWord: 'Got it',
  // A confirmation more than a few seconds late confirms nothing, so it expires rather than
  // queueing behind a long sentence on the output bus.
  confirmTtlMs: 3000,
  // *** A NEAR MISS ASKS (note AO). ON by default. *** Mike's wording for the question; `{phrase}`
  // is the command it thinks it heard. Off: a near miss does nothing at all, exactly like any other
  // unrecognised phrase - for the person who finds being asked worse than saying it again.
  nearMiss: true,
  nearMissLine: "It sounded like '{phrase}'. Did you mean that?",
  // How long the question waits for a yes. The same eight seconds as the command window, for the
  // same reason (somebody may need a moment); a setting, longer on a profile that needs it. Nobody
  // answering is INACTION: the question closes and nothing fires.
  nearMissWindowMs: 8000,
});

/**
 * *** THE ANSWERS TO "DID YOU MEAN THAT?" ***
 *
 * A yes fires the command asked about. A no, or anything else, drops it (Mike: "anything else to
 * drop it"); the no words are listed only so they are CONSUMED - "never mind" and "cancel" said to
 * the question mean "not that", not "go back" - and so a grammar (the per-person option) can hear
 * them. "yes" is also a select phrase: while a question is up, the question has it, so it cannot
 * fire twice. No yes word is a wake phrase or any other command (the suite checks).
 */
export const NEAR_MISS_YES = ['yes', 'yeah', 'yep', 'yup', 'yes please', 'correct', 'that is right',
  "that's right"];
export const NEAR_MISS_NO = ['no', 'nope', 'no thanks', 'no thank you', 'wrong', 'not that', 'cancel',
  'never mind', 'nevermind'];
// A switch can answer the question too: an ordinary binding to one of these actions publishes the
// topic, and `attachSpeech` answers on it. Nothing here binds a switch by default - which switch is
// Yes is the person's own binding - so the host registers the actions and the binder offers them.
export const NEAR_MISS_YES_TOPIC = 'speech/near-miss/yes';
export const NEAR_MISS_NO_TOPIC = 'speech/near-miss/no';
export const NEAR_MISS_ACTIONS = [
  { id: 'speech/near-miss-yes', label: 'Yes, I meant that', topic: NEAR_MISS_YES_TOPIC, group: 'Spoken' },
  { id: 'speech/near-miss-no', label: 'No, I did not mean that', topic: NEAR_MISS_NO_TOPIC, group: 'Spoken' },
];

// ---------------------------------------------------------------------------------------
// THE NEAR-MISS RULE (note AO)
// ---------------------------------------------------------------------------------------
//
// *** ONE WORD OFF, FROM EXACTLY ONE MEANING. *** What was said (normalised) is a near miss of a
// phrase when it differs by exactly ONE of:
//
//   * ONE WORD MORE OR LESS    "pause please", "please pause" -> "pause"; "more" -> "more volume"
//   * ONE WORD SOUNDING ALIKE  the same words but one, and that one `soundsAlike`: same first
//                              letter, both at least three letters, and at most 1 letter edit
//                              apart (2 when the longer word has five letters or more) -
//                              "paws" -> "pause", "lauder" -> "louder"
//
// ...and it counts ONLY when every phrase it is near belongs to ONE meaning (a verb or a route).
// Near two meanings is near none: "go" is one word short of go up / go down / go back, "loud" is
// near both "louder" and "too loud", "play opposite" is near both "play" and "play opposites" -
// and the screen asks about none of them. (Mike: never when it is close to two.)
//
// WHY THIS AND NOT A SCORE. Open recognisers write REAL WORDS, so their mistakes are a word that
// sounds like the right one, a filler word added ("please pause"), or a word dropped - and those
// are exactly the two shapes above. A similarity score would need a threshold nobody can argue
// for; "one word off" is something anybody can check by reading it. The costs, stated:
//   * Spelling is a rough stand-in for sound: "necks" is NOT near "next" (3 letters apart) and
//     "text" is not either (a different first letter, on purpose - a first sound is rarely the one
//     misheard, and allowing it makes every rhyme a near miss). The miss log catches what this
//     misses; a phrasing that keeps turning up goes into the table as an exact phrase.
//   * Two-letter words ("up", "ok") never count as alike: one letter changed is a different word.
//   * A near miss is only ever ASKED about, and only when it was said to the screen (after the
//     wake phrase, or inside the window) - so a loose rule costs a question, never an action.
//
// Letter edit distance (insert, delete or change one letter), small and exact.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Two different words that could be one misheard as the other (the rule above). */
export function soundsAlike(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y || x === y || x.includes(' ') || y.includes(' ')) return false;
  if (x[0] !== y[0] || Math.min(x.length, y.length) < 3) return false;
  return editDistance(x, y) <= (Math.max(x.length, y.length) >= 5 ? 2 : 1);
}

// `said` and `phrase` as word arrays: exactly one word added, dropped, or sounding alike.
function oneWordOff(said, phrase) {
  if (said.length === phrase.length) {
    let at = -1;
    for (let i = 0; i < said.length; i++) {
      if (said[i] === phrase[i]) continue;
      if (at >= 0) return false;
      at = i;
    }
    return at >= 0 && soundsAlike(said[at], phrase[at]);
  }
  const [long, short] = said.length > phrase.length ? [said, phrase] : [phrase, said];
  if (long.length - short.length !== 1 || !short.length) return false;
  const target = short.join(' ');
  for (let i = 0; i < long.length; i++) {
    if ([...long.slice(0, i), ...long.slice(i + 1)].join(' ') === target) return true;
  }
  return false;
}

/**
 * Is `text` a near miss of exactly one meaning in `table` (`{ id: [phrases] }`, the spoken table by
 * default)? `{ id, phrase }` - the meaning and the phrase it was near, for the question - or null:
 * for an exact phrase (that is a match, not a miss), for nothing near, and for near two meanings.
 */
export function nearMiss(text, table = spokenTable()) {
  const said = normalize(text);
  if (!said) return null;
  const words = said.split(' ');
  const hits = new Map();
  for (const [id, phrases] of Object.entries(table || {})) {
    for (const p of Array.isArray(phrases) ? phrases : []) {
      const k = normalize(p);
      if (!k) continue;
      if (k === said) return null;
      if (!hits.has(id) && oneWordOff(words, k.split(' '))) hits.set(id, k);
    }
  }
  if (hits.size !== 1) return null;
  const [[id, phrase]] = [...hits];
  return { id, phrase };
}

// The question with its phrase filled in; a blank template is the default question.
function nearMissQuestion(template, phrase) {
  const t = typeof template === 'string' && template.trim() ? template : SPEECH_DEFAULTS.nearMissLine;
  return t.replace(/\{phrase\}/g, phrase).replace(/\s{2,}/g, ' ').trim();
}

/**
 * THE SETTINGS, declared the way every module declares its own (settings_fields.js), for the
 * host to put in the menu at the PERSON level: a wake phrase somebody says is theirs, and follows
 * them to any screen. One field per phrase because a field is one value; `wakeFrom` turns them
 * back into the list `attachSpeech` takes. Text fields need a keyboard to edit, which is right for
 * these: nobody sets a wake phrase with one switch, and the defaults work without anybody doing so.
 */
export const SPEECH_FIELDS = [
  { key: 'speechWake1', label: 'Wake phrase', kind: 'text', default: SPEECH_DEFAULTS.wake[0],
    level: 'advanced' },
  { key: 'speechWake2', label: 'Second wake phrase', kind: 'text', default: SPEECH_DEFAULTS.wake[1],
    level: 'advanced' },
  { key: 'speechConfirm', label: 'When a spoken command is heard', kind: 'choice',
    default: SPEECH_DEFAULTS.confirm, level: 'standard',
    options: [
      { value: 'tone', label: 'Play a short tone' },
      { value: 'word', label: `Say “${SPEECH_DEFAULTS.confirmWord}”` },
      { value: 'off', label: 'Nothing' },
    ] },
  { key: 'speechTwoStep', label: 'The wake phrase on its own waits for a command', kind: 'toggle',
    default: SPEECH_DEFAULTS.twoStep, level: 'standard', onLabel: 'On', offLabel: 'Off',
    note: 'Off: the command has to be said in the same breath as the wake phrase.' },
  { key: 'speechWindowMs', label: 'How long it waits for the command', kind: 'number',
    default: SPEECH_DEFAULTS.wakeWindowMs, level: 'standard', min: 3000, max: 30000, step: 1000,
    displayScale: 1000, unit: 'seconds', unitOne: 'second' },
  { key: 'speechHearing', label: 'How it listens', kind: 'choice',
    default: SPEECH_DEFAULTS.recognition, level: 'advanced',
    options: [
      { value: 'open', label: 'Writes down anything said, then matches it exactly' },
      { value: 'grammar', label: 'Listens only for its own words' },
    ],
    note: '“Only its own words” is for speech it cannot write down, when only a few commands are needed. '
      + 'It can turn other talk into a command, and it cannot ask “did you mean”.' },
  { key: 'speechNearMiss', label: 'When what it heard is one word off a command', kind: 'toggle',
    default: SPEECH_DEFAULTS.nearMiss, level: 'standard', onLabel: 'Ask “did you mean”', offLabel: 'Do nothing',
    note: 'It only ever acts after a yes.' },
  { key: 'speechNearMissLine', label: 'The question it asks', kind: 'text',
    default: SPEECH_DEFAULTS.nearMissLine, level: 'advanced',
    note: '{phrase} is the command it thinks it heard.' },
  { key: 'speechNearMissWindowMs', label: 'How long it waits for the yes', kind: 'number',
    default: SPEECH_DEFAULTS.nearMissWindowMs, level: 'standard', min: 3000, max: 30000, step: 1000,
    displayScale: 1000, unit: 'seconds', unitOne: 'second' },
  { key: 'speechAnswerMatch', label: 'What a voice game treats as an answer', kind: 'choice',
    default: SPEECH_DEFAULTS.answerMatch, level: 'advanced',
    options: [
      { value: 'exact', label: 'Only one of the game’s words' },
      { value: 'any', label: 'Anything said' },
    ] },
];

const pickChoice = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

// ---------------------------------------------------------------------------------------
// *** ON OR OFF, AND WHAT WRITES IT DOWN (2026-09-30, the kiosk wiring). ***
// ---------------------------------------------------------------------------------------
//
// Rule 1 of this file's header ("IT SHIPS OFF") as two settings a host reads, at the PERSON level
// beside SPEECH_FIELDS. The kiosk opens no microphone for speech until `speechOn` is true.
//
// *** THE RECOGNISER DEFAULTS TO 'local': ONE ON THIS SCREEN. *** Argued, because it means that
// today, turning spoken commands on does nothing at all on most screens:
//   * FOR 'browser' as the default: it exists in Chrome now, so "turn it on" would simply work.
//   * AGAINST, and it wins: the browser's engine sends the ROOM'S SOUND to the browser's maker
//     (this file's header), the room may hold somebody who cannot consent, and the product's
//     promise is that it stays on your own hardware (CICI spec: her audio stays fully local). A
//     default that uploads a room is not a default anybody chose. So 'browser' is one explicit
//     choice, labelled with where the sound goes, and 'local' is honest about not existing yet: the
//     kiosk says "no recogniser on this screen yet" rather than quietly listening elsewhere.
//   * The local engine plugs in behind the same seam (a Vosk or whisper service on the device, or
//     the desktop Mike ruled acceptable as an OPTION for her audio, row 2.46) with nothing here moving.
//
// *** ROWS 2.46/2.47: 'local' NOW WORKS WHEN A SERVICE ANSWERS ON THIS MACHINE. *** speech_engines.js
// connects to web/speech_service on 127.0.0.1 and opens no microphone until it says hello; nothing
// answering, the kiosk still says "no recogniser on this screen". 'remote1' / 'remote2' are ANOTHER
// COMPUTER as the first pass (Mike: her audio to his desktop "is fine for an option", Oscar's GPU box
// another) - labelled with where the sound goes, OFF unless chosen, and doing nothing until an address
// is set. The later passes of the ranked list are speech_engines.js's SPEECH_PASS_FIELDS.
export const SPEECH_ENGINES = ['local', 'remote1', 'remote2', 'browser'];
export const SPEECH_ON_FIELDS = [
  { key: 'speechOn', label: 'Spoken commands', kind: 'toggle', default: false, level: 'standard',
    onLabel: 'On', offLabel: 'Off',
    note: 'Say the wake phrase, then a command. Off: no microphone is opened for this.' },
  { key: 'speechEngine', label: 'What writes down what is said', kind: 'choice', default: 'local',
    level: 'standard',
    options: [
      { value: 'local', label: 'A recogniser on this screen (the room’s sound stays here)' },
      { value: 'remote1', label: 'Another computer (sends the room’s sound there)' },
      { value: 'remote2', label: 'A second other computer (sends the room’s sound there)' },
      { value: 'browser', label: 'The browser’s own (sends the room’s sound to the browser’s maker)' },
    ] },
];

/** `{ on, engine }` from a settings row. Only a real `true` turns it on; a broken engine is 'local'. */
export function speechSwitchFrom(values = {}) {
  const v = values || {};
  return { on: v.speechOn === true, engine: pickChoice(v.speechEngine, SPEECH_ENGINES, 'local') };
}

/**
 * `attachSpeech` options from a settings row (SPEECH_FIELDS), each unset key its default. The one
 * call a host makes, so the field keys and the option names cannot drift apart.
 */
export function speechOptionsFrom(values = {}) {
  const v = values || {};
  const ms = Number(v.speechWindowMs);
  const nms = Number(v.speechNearMissWindowMs);
  return {
    wake: wakeFrom(v),
    confirm: pickChoice(v.speechConfirm, CONFIRM_MODES, SPEECH_DEFAULTS.confirm),
    twoStep: typeof v.speechTwoStep === 'boolean' ? v.speechTwoStep : SPEECH_DEFAULTS.twoStep,
    wakeWindowMs: Number.isFinite(ms) && ms > 0 ? ms : SPEECH_DEFAULTS.wakeWindowMs,
    recognition: pickChoice(v.speechHearing, RECOGNITION_MODES, SPEECH_DEFAULTS.recognition),
    answerMatch: pickChoice(v.speechAnswerMatch, ANSWER_MATCHES, SPEECH_DEFAULTS.answerMatch),
    nearMiss: typeof v.speechNearMiss === 'boolean' ? v.speechNearMiss : SPEECH_DEFAULTS.nearMiss,
    nearMissLine: typeof v.speechNearMissLine === 'string' && v.speechNearMissLine.trim()
      ? v.speechNearMissLine : SPEECH_DEFAULTS.nearMissLine,
    nearMissWindowMs: Number.isFinite(nms) && nms > 0 ? nms : SPEECH_DEFAULTS.nearMissWindowMs,
  };
}

/**
 * The wake list from a settings row. A field never set is its default; a field set to blank is
 * NO phrase in that slot. Both blank falls back to the defaults, because a screen whose owner
 * turned voice on and cleared every phrase cannot be woken at all - and "the setting ate the
 * wake phrase" is not a state anybody in the room could diagnose.
 */
export function wakeFrom(values = {}) {
  const v = values || {};
  const pick = (key, dflt) => (typeof v[key] === 'string' ? v[key] : dflt);
  const list = usableWakePhrases([pick('speechWake1', SPEECH_DEFAULTS.wake[0]),
                                  pick('speechWake2', SPEECH_DEFAULTS.wake[1])]);
  return list.length ? list : [...SPEECH_DEFAULTS.wake];
}

/**
 * The wake phrases that can actually work, normalised: empties dropped (a blank second phrase
 * is simply no second phrase), duplicates dropped, and ANY PHRASE THAT IS ALSO A COMMAND REFUSED
 * - "okay" cannot both wake the screen and select, or every "okay" would do one of them at random.
 */
export function usableWakePhrases(list, table = spokenTable()) {
  const commands = new Set(Object.values(table).flat().map(normalize));
  const out = [];
  for (const raw of Array.isArray(list) ? list : [list]) {
    const w = normalize(raw);
    if (!w || commands.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * Did this utterance START with a wake phrase, and what followed it? `rest` is '' when the wake
 * phrase was the whole utterance. At the START and as whole words only: "I told the computer
 * please stop" and "computer pleased me" are not somebody waking the screen.
 */
export function splitWake(text, wakes) {
  const said = normalize(text);
  const list = usableWakePhrases(wakes, {}).sort((a, b) => b.length - a.length);
  for (const w of list) {
    if (said === w) return { woke: true, rest: '' };
    if (said.startsWith(`${w} `)) return { woke: true, rest: said.slice(w.length + 1) };
  }
  return { woke: false, rest: said };
}

/**
 * WOULD THESE WORDS DO ANYTHING? The wake phrase alone, a command after a wake phrase, or a bare
 * command (the armed window's case). For a ranked recogniser (speech_engines.js, row 2.46): a fast
 * guess that is "sure" but means nothing - Vosk on the bench wrote "computer please pass" for "pause"
 * at confidence 1.0 - waits for the better pass instead of acting, because acting on it could only
 * ever be a "did you mean" or nothing. Pure, and deliberately generous: it errs toward acting.
 */
export function meansSomething(text, wakes = SPEECH_DEFAULTS.wake, table = PHRASES, routes = ROUTES, scopedTable = null) {
  const w = splitWake(text, wakes);
  if (w.woke && !w.rest) return true;
  const rest = w.rest;
  // `scopedTable`: the focused module's own phrases (`moduleVoiceTable`), when the host has them.
  const own = scopedTable && typeof scopedTable === 'object' && rest
    && Object.prototype.hasOwnProperty.call(scopedTable, normalize(rest));
  return !!(rest && (own || verbFor(rest, table) || routeFor(rest, routes)));
}

// ---------------------------------------------------------------------------------------
// THE GRAMMARS A GRAMMAR-LIMITED RECOGNISER LOADS (Vosk; row 2.28)
// ---------------------------------------------------------------------------------------

const uniq = (list) => [...new Set(list.filter(Boolean))];

/**
 * THE COMMAND GRAMMAR, for the one-breath path: every wake phrase alone, every wake phrase +
 * every phrase, every phrase ALONE, and [unk].
 *
 * *** THE BARE PHRASES ARE IN IT ON PURPOSE. *** Leave them out and a video saying "pause" has
 * nowhere to land but "computer please pause" - the grammar would ADD the wake phrase the gate
 * relies on. With them in, a bare "pause" comes back bare and the gate refuses it.
 */
export function commandGrammar(wakes = SPEECH_DEFAULTS.wake, table = spokenTable()) {
  const ws = usableWakePhrases(wakes, table);
  const phrases = uniq(Object.values(table).flat().map(normalize));
  return uniq([...ws, ...ws.flatMap((w) => phrases.map((p) => `${w} ${p}`)), ...phrases, UNKNOWN_WORD]);
}

/** Inside the armed window, when somebody chose 'grammar' there: the phrases alone, and [unk]. */
export function armedGrammar(wakes = SPEECH_DEFAULTS.wake, table = spokenTable()) {
  const ws = usableWakePhrases(wakes, table);
  return uniq([...ws, ...Object.values(table).flat().map(normalize), UNKNOWN_WORD]);
}

/**
 * While a game waits, when somebody chose 'grammar' there: the game's own words (which it already
 * fills with wrong answers and [unk]), plus the wake phrase and wake + command, so "computer please
 * back" still leaves the game. [unk] is added even if the game forgot it.
 */
export function answerGrammar(words = [], wakes = SPEECH_DEFAULTS.wake, table = spokenTable()) {
  const ws = usableWakePhrases(wakes, table);
  const phrases = uniq(Object.values(table).flat().map(normalize));
  const game = (Array.isArray(words) ? words : []).map((w) => (w === UNKNOWN_WORD ? w : normalize(w)));
  return uniq([...game, ...ws, ...ws.flatMap((w) => phrases.map((p) => `${w} ${p}`)), UNKNOWN_WORD]);
}

/**
 * While "did you mean" waits, when somebody chose 'grammar': the yes and no words, [unk], and the
 * wake phrase + every command, so a fresh command can still be given instead of answering.
 */
export function confirmGrammar(wakes = SPEECH_DEFAULTS.wake, table = spokenTable()) {
  const ws = usableWakePhrases(wakes, table);
  const phrases = uniq(Object.values(table).flat().map(normalize));
  return uniq([...NEAR_MISS_YES.map(normalize), ...NEAR_MISS_NO.map(normalize), ...ws,
    ...ws.flatMap((w) => phrases.map((p) => `${w} ${p}`)), UNKNOWN_WORD]);
}

// The tone: the output layer's own `status` earcon (output_channels.js), the shortest and
// quietest sound the product already makes. Reused rather than a new sound invented.
let sharedSound = null;
function defaultTone() {
  try {
    sharedSound = sharedSound || createSoundChannel();
    if (!sharedSound.available()) return;
    sharedSound.present({ verb: 'status' }, { done() {} });
  } catch (err) { console.error('speech: confirm tone', err); }
}

/**
 * Attach spoken commands to an input bus.
 *
 * `input` is the same bus `attachKeyboard` takes, and this makes the same two calls into it —
 * `down` then `up` — so a phrase is a momentary press like any other. Everything downstream
 * (edges, holds, roles, the gate, the false-activation numbers) then applies identically,
 * which is the point of going through the bus rather than publishing a verb directly.
 *
 * IT DOES NOT START. `start()` is the caller's to call, and `available()` says whether there is
 * anything to start.
 *
 * THE RECOGNISER SEAM: `start(onText)`, `stop()`, `running`, and optionally `setMode(mode)`.
 * `onText(text, detail?)` - see `cleanDetail` for what `detail` may carry. `setMode` is told
 * `{ mode: 'open' | 'grammar', grammar: string[] | null, why: 'command' | 'armed' | 'answer' | 'confirm' }`
 * every time how it should listen changes; an engine without it can read `recognitionMode()` or
 * `currentGrammar()` (null = open) whenever it likes. OPEN in every state by default (note AO);
 * `recognition: 'grammar'` (a person's setting) gives each state its grammar.
 *
 * FOUR STATES, in the order they win:
 *   confirm  a near miss was asked about ("It sounded like 'pause'. Did you mean that?"): a yes
 *            fires it, a no or anything else drops it, nobody answering drops it too.
 *   armed    the wake phrase was said on its own; the next utterance is matched EXACTLY against
 *            the phrase table (and a near miss is asked about).
 *   answer   a voice game has an open grammar (SPEECH_GRAMMAR_TOPIC on `bus`): anything that does
 *            not start with a wake phrase goes to THAT game as `speech/answer`, not to the phrase
 *            table - exactly one of its words, or a near miss of exactly one sent as an UNSURE
 *            hearing for the game's own "did you mean". A wake phrase still means a command, so
 *            "computer please back" leaves a game.
 *   command  otherwise: the one-breath path.
 */
export function attachSpeech(input, {
  recognizer = null,
  table = PHRASES,
  routes = ROUTES,
  device = SPEECH_DEVICE,
  onHeard = null,          // told every utterance, matched or not — for a settings panel
  view = typeof window !== 'undefined' ? window : null,
  lang = 'en-US',
  // Row 2.28 — see SPEECH_DEFAULTS for the argument behind each default.
  wake = SPEECH_DEFAULTS.wake,
  requireWake = SPEECH_DEFAULTS.requireWake,
  twoStep = SPEECH_DEFAULTS.twoStep,
  wakeWindowMs = SPEECH_DEFAULTS.wakeWindowMs,
  recognition = SPEECH_DEFAULTS.recognition,
  armedRecognition = null,  // null = follow `recognition`
  answerRecognition = null, // null = follow `recognition`
  answerMatch = SPEECH_DEFAULTS.answerMatch,
  nearMiss: askNearMiss = SPEECH_DEFAULTS.nearMiss,
  nearMissLine = SPEECH_DEFAULTS.nearMissLine,
  nearMissWindowMs = SPEECH_DEFAULTS.nearMissWindowMs,
  confirm = SPEECH_DEFAULTS.confirm,
  confirmWord = SPEECH_DEFAULTS.confirmWord,
  confirmTtlMs = SPEECH_DEFAULTS.confirmTtlMs,
  output = null,           // the output bus, for `word` mode (it ducks the video for the word)
  tone = null,             // injected for tests; default is the output layer's status earcon
  now = () => Date.now(),
  // The pub/sub bus the listening window is announced on (LISTENING_TOPIC), the games' grammars
  // are heard on and their answers sent on. Optional: with no bus the gate works exactly as
  // before, tells nobody, and there is no answer mode (no game can be heard announcing itself).
  bus = null,
  // THE MISS LOG (row 2.28 (b), Mike: yes). Anything with `add(text)` - `speech_misses.js` is
  // the real one. Told ONLY the words that followed a wake phrase and matched no command; null
  // (the default) logs nothing. Which screens pass one is the host's setting, not this file's.
  misses = null,
  // THE FOCUSED MODULE'S OWN COMMANDS (`moduleVoiceTable`): a function returning `{ phrase: verb }`
  // (or null), asked each time something is heard, so focus moving needs no restart. Looked up BEFORE
  // the table. Null (the default): no module phrases, exactly as before.
  scoped = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (!input) throw new Error('attachSpeech: an input bus is required');
  const rec = recognizer || browserRecognizer({ view, lang });
  const spoken = spokenTable(table, routes);
  // A wake list with nothing usable in it leaves the gate SHUT - nothing fires - rather than
  // falling open. Inaction is the safe failure for a thing that drives somebody's screen.
  const wakes = usableWakePhrases(wake, spoken);
  const mode = CONFIRM_MODES.includes(confirm) ? confirm : 'tone';
  const how = RECOGNITION_MODES.includes(recognition) ? recognition : SPEECH_DEFAULTS.recognition;
  const armedHow = RECOGNITION_MODES.includes(armedRecognition) ? armedRecognition : how;
  const answerHow = RECOGNITION_MODES.includes(answerRecognition) ? answerRecognition : how;
  const matchHow = ANSWER_MATCHES.includes(answerMatch) ? answerMatch : SPEECH_DEFAULTS.answerMatch;
  const asking = askNearMiss !== false;
  const askMs = Math.max(0, Number(nearMissWindowMs) || 0);
  const yesWords = new Set(NEAR_MISS_YES.map(normalize));
  const noWords = new Set(NEAR_MISS_NO.map(normalize));
  const playTone = typeof tone === 'function' ? tone : defaultTone;
  const canPush = () => !!rec && typeof rec.setMode === 'function';
  let armedUntil = null;   // set by the wake phrase said on its own
  let closeTimer = null;   // closes the window as an EVENT; `armedUntil` stays the gate itself
  let open = false;
  // THE "DID YOU MEAN" QUESTION: { id, phrase, question, until } while one is up. `until` is the
  // gate (a timer that never fires cannot keep it up); `askTimer` only announces its end.
  let pending = null;
  let askTimer = null;
  let running = false;     // start() called and not stopped: the answer event needs a live microphone
  // THE GAMES THAT HAVE SAID WHAT THEY CAN HEAR, by instance. The newest OPEN one is the one an
  // answer goes to: the game somebody most recently started or moved on is the one being played.
  const games = new Map();   // key -> { source, instanceId, words, phase, seq }
  let gameSeq = 0;
  let answering = null;      // the key the last `on: true` answering event was about, or null
  let lastModeKey = '';

  function publish(topic, payload) {
    if (!bus || typeof bus.publish !== 'function') return;
    try { bus.publish(topic, payload); } catch (err) { console.error(`speech: ${topic}`, err); }
  }
  const announce = (payload) => publish(LISTENING_TOPIC, payload);
  function clearClose() {
    if (closeTimer !== null) { try { clearTimer(closeTimer); } catch { /* already gone */ } closeTimer = null; }
  }
  function openWindow(ms) {
    clearAsk();
    pending = null;
    armedUntil = now() + ms;
    open = true;
    clearClose();
    // The timer only ANNOUNCES the close. The gate itself is `armedUntil` against `now()`, so a
    // timer that never fires cannot keep the gate open - and every subscriber has its own
    // watchdog from `ms` in case this announcement never arrives. It also tells a recogniser that
    // takes `setMode` to go back to the command grammar.
    if (bus || canPush()) {
      try { closeTimer = setTimer(() => { closeTimer = null; closeWindow('timeout'); }, ms); }
      catch { closeTimer = null; }
    }
    announce({ on: true, reason: 'wake', ms });
    pushMode();
  }
  function closeWindow(reason) {
    armedUntil = null;
    clearClose();
    if (open) {
      open = false;
      announce({ on: false, reason });
    }
    pushMode();
  }

  // ---- the near-miss question --------------------------------------------------------
  function clearAsk() {
    if (askTimer !== null) { try { clearTimer(askTimer); } catch { /* already gone */ } askTimer = null; }
  }
  const pendingLive = () => !!pending && now() <= pending.until;
  // Ask. The command window (if one was open) becomes the question's window: one wake, one
  // command - or one question. Announced as a listening window carrying the question, so the
  // on-screen cue can show it to somebody who did not hear it.
  function ask(nm) {
    armedUntil = null;
    clearClose();
    clearAsk();
    const question = nearMissQuestion(nearMissLine, nm.phrase);
    pending = { id: nm.id, phrase: nm.phrase, question, until: now() + askMs };
    open = true;
    if (bus || canPush()) {
      try { askTimer = setTimer(() => { askTimer = null; endPending('timeout'); }, askMs); }
      catch { askTimer = null; }
    }
    announce({ on: true, reason: 'confirm', ms: askMs, phrase: nm.phrase, question });
    pushMode();
    if (output && typeof output.say === 'function') {
      try { output.say(question, { source: 'speech', ttlMs: confirmTtlMs }); }
      catch (err) { console.error('speech: near-miss question', err); }
    }
  }
  function endPending(reason) {
    clearAsk();
    if (!pending) return;
    pending = null;
    if (open) { open = false; announce({ on: false, reason }); }
    pushMode();
  }
  // Answer the question: true fires what was asked about, false drops it. False when there was
  // nothing to answer.
  function answerNearMiss(yes, text = null, woke = false) {
    if (pending && !pendingLive()) endPending('timeout');
    if (!pending) return false;
    const p = pending;
    endPending(yes ? 'confirmed' : 'declined');
    if (yes) {
      const isVerb = Object.prototype.hasOwnProperty.call(table || {}, p.id);
      report({ text, verb: isVerb ? p.id : null, ...(isVerb ? {} : { route: p.id }), woke,
               nearMiss: p.phrase, confirmed: true });
      fire(p.id);
    } else report({ text, verb: null, woke, nearMiss: p.phrase, declined: true });
    return true;
  }
  // THE SCREEN HEARING ITS OWN QUESTION. Its speaker is in the room and an open recogniser writes
  // the question down; a run of the question's own words is not somebody answering it.
  function isEcho(t) {
    return !!t && !!pending && ` ${normalize(pending.question)} `.includes(` ${t} `);
  }
  // An utterance while the question is up. True when it was the answer (and is used up).
  function heardWhileAsking(text, w) {
    const t = w.rest;
    if (w.woke && !t) { endPending('other'); return false; }   // the wake phrase alone: start over
    if (yesWords.has(t)) return answerNearMiss(true, text, w.woke);
    if (noWords.has(t)) return answerNearMiss(false, text, w.woke);
    if (!w.woke && isEcho(t)) { report({ text, verb: null, woke: false, echo: true }); return true; }
    // Anything else drops it, and is then heard as itself - "computer please next" still works.
    endPending('other');
    return false;
  }

  const sub = (topic, fn) => (bus && typeof bus.subscribe === 'function' ? bus.subscribe(topic, fn) : () => {});
  const offYes = sub(NEAR_MISS_YES_TOPIC, () => { answerNearMiss(true); });
  const offNo = sub(NEAR_MISS_NO_TOPIC, () => { answerNearMiss(false); });

  // ---- answer mode ------------------------------------------------------------------
  function currentGame() {
    let best = null;
    for (const g of games.values()) if (!best || g.seq > best.seq) best = g;
    return best;
  }
  function answerTopic(g) {
    if (!g.instanceId) return SPEECH_ANSWER_TOPIC;
    return typeof bus?.instanceTopic === 'function'
      ? bus.instanceTopic(g.instanceId, SPEECH_ANSWER_TOPIC)
      : `${SPEECH_ANSWER_TOPIC}#${g.instanceId}`;
  }
  function syncAnswering() {
    const g = running ? currentGame() : null;
    if (g) {
      answering = g.key;
      publish(ANSWERING_TOPIC, { on: true, source: g.source, instanceId: g.instanceId, phase: g.phase });
    } else if (answering !== null) {
      answering = null;
      publish(ANSWERING_TOPIC, { on: false, reason: running ? 'closed' : 'stopped' });
    }
  }
  function onGrammar(p) {
    if (!p || typeof p !== 'object') return;
    const key = p.instanceId ? `#${p.instanceId}` : `@${p.source || ''}`;
    const words = Array.isArray(p.words) ? p.words.filter((w) => typeof w === 'string' && w) : [];
    const isOpen = p.open !== false && words.length > 0;
    if (isOpen) {
      const had = games.get(key);
      // A game re-announcing (a new phase) keeps its place; a newly opened one goes to the front.
      games.set(key, { key, source: p.source || null, instanceId: p.instanceId || null, words,
                       phase: p.phase || null, seq: had ? had.seq : ++gameSeq });
    } else games.delete(key);
    syncAnswering();
    pushMode();
  }
  const offGrammar = bus && typeof bus.subscribe === 'function'
    ? bus.subscribe(SPEECH_GRAMMAR_TOPIC, onGrammar) : () => {};

  function answer(g, text, detail) {
    const said = normalize(text);
    const unk = String(text || '').trim().toLowerCase() === UNKNOWN_WORD;
    const known = unk || g.words.some((w) => (w === UNKNOWN_WORD ? false : normalize(w) === said));
    // *** A NEAR MISS OF EXACTLY ONE OF THE GAME'S WORDS (note AO) goes to the game as an UNSURE
    // hearing - it is not decided here. *** The game already has "It sounds like you might be
    // saying X... Yes / No". It goes WITHOUT the engine's confidence: the answer seam's rule is that
    // no confidence means "ask", so even a game that has never heard of `nearMiss` cannot treat
    // "colt" heard at 0.95 as a sure "cold". What was really heard travels as `heard`.
    if (said && !known && matchHow === 'exact' && asking) {
      const words = {};
      for (const w of g.words) { const k = w === UNKNOWN_WORD ? '' : normalize(w); if (k) words[k] = [k]; }
      const nm = nearMiss(said, words);
      if (nm) {
        report({ text, verb: null, woke: false, answer: true, sent: true, nearMiss: nm.phrase });
        const { confidence, ...rest } = detail;   // eslint-disable-line no-unused-vars
        publish(answerTopic(g), { text: nm.phrase, heard: text, nearMiss: true, ...rest });
        return;
      }
    }
    const sent = !!said && (matchHow === 'any' || known);
    report({ text, verb: null, woke: false, answer: true, sent });
    // Not one of the game's words, with exact matching: room talk, not an answer. Nothing is sent
    // and nothing is logged - an answer to a game is not a command anybody missed.
    if (!sent && !unk) return;
    publish(answerTopic(g), { text: unk ? UNKNOWN_WORD : text, ...detail });
  }

  // ---- how the recogniser should listen -------------------------------------------------
  // The spoken table plus the focused module's own phrases, for a grammar (a grammar-limited engine can
  // only hear what is listed). The key cannot collide with a verb or a route id (both are [a-z-]).
  const spokenNow = () => {
    const own = Object.keys(scopedTable());
    return own.length ? { ...spoken, '#focused': own } : spoken;
  };
  function recognitionMode() {
    if (pendingLive()) {
      return how === 'grammar'
        ? { mode: 'grammar', grammar: confirmGrammar(wakes, spokenNow()), why: 'confirm' }
        : { mode: 'open', grammar: null, why: 'confirm' };
    }
    const armed = armedUntil !== null && now() <= armedUntil;
    if (armed) {
      return armedHow === 'grammar'
        ? { mode: 'grammar', grammar: armedGrammar(wakes, spokenNow()), why: 'armed' }
        : { mode: 'open', grammar: null, why: 'armed' };
    }
    const g = currentGame();
    if (g) {
      return answerHow === 'grammar'
        ? { mode: 'grammar', grammar: answerGrammar(g.words, wakes, spokenNow()), why: 'answer' }
        : { mode: 'open', grammar: null, why: 'answer' };
    }
    return how === 'grammar'
      ? { mode: 'grammar', grammar: commandGrammar(wakes, spokenNow()), why: 'command' }
      : { mode: 'open', grammar: null, why: 'command' };
  }
  function pushMode() {
    if (!canPush()) return;
    const m = recognitionMode();
    const key = `${m.why}|${m.mode}|${m.grammar ? m.grammar.join('\u0001') : ''}`;
    if (key === lastModeKey) return;
    lastModeKey = key;
    try { rec.setMode(m); } catch (err) { console.error('speech: setMode', err); }
  }

  function logMiss(text) {
    if (!misses || typeof misses.add !== 'function' || !text) return;
    try { misses.add(text); } catch (err) { console.error('speech: miss log', err); }
  }

  function confirmed(verb) {
    if (mode === 'off') return;
    try {
      if (mode === 'word' && output && typeof output.say === 'function') {
        output.say(confirmWord, { source: 'speech', ttlMs: confirmTtlMs });
        return;
      }
      // `word` with no output bus falls back to the tone: some confirmation beats none.
      playTone(verb);
    } catch (err) { console.error('speech: confirm', err); }
  }

  function report(h) {
    try { onHeard?.(h); } catch (err) { console.error('speech: onHeard', err); }
  }

  // The focused module's table right now ({} when there is none, or it throws).
  function scopedTable() {
    if (typeof scoped !== 'function') return {};
    try { const t = scoped(); return t && typeof t === 'object' ? t : {}; }
    catch (err) { console.error('speech: scoped', err); return {}; }
  }
  function scopedVerb(rest) {
    const said = normalize(rest);
    if (!said) return null;
    const v = scopedTable()[said];
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(table || {}, v) ? v : null;
  }

  // A spoken phrase as a momentary press, and its confirmation.
  function fire(id) {
    const control = phraseControl(id);
    // Down then straight up: a spoken phrase has no duration anybody is measuring, and holding
    // it open would arm the max-hold watchdog for something that is already over.
    input.down(device, control);
    input.up(device, control);
    confirmed(id);
  }

  function heard(text, rawDetail) {
    const detail = cleanDetail(rawDetail);
    const w = splitWake(text, wakes);
    const rest = w.rest;
    // A QUESTION IS UP: this may be its answer, and the answer comes before anything else.
    if (pending) {
      if (!pendingLive()) endPending('timeout');
      else if (heardWhileAsking(text, w)) return;
    }
    const inWindow = armedUntil !== null && now() <= armedUntil;
    // A window whose time is up is closed now, whether or not its timer has fired yet.
    if (armedUntil !== null && !inWindow) closeWindow('timeout');
    // ANSWER MODE: a game is waiting, and this was not said to the screen as a command (no wake
    // phrase, no command window open). It goes to the game, not the phrase table - "next" said to
    // a quiz is an answer, and with the gate turned off it would otherwise skip the video too.
    const g = !w.woke && !inWindow ? currentGame() : null;
    if (g) { answer(g, text, detail); return; }
    if (requireWake && !w.woke && !inWindow) { report({ text, verb: null, woke: false }); return; }
    if (w.woke && !rest) {
      // The wake phrase on its own: the command may follow as its own utterance - unless the
      // two-step path is turned off, when it opens nothing (and nothing is announced or ducked).
      if (twoStep) openWindow(Math.max(0, Number(wakeWindowMs) || 0));
      report({ text, verb: null, woke: true });
      return;
    }
    // The focused module's own phrase first (brick breaker's "stop" is the paddle, not pause).
    const own = scopedVerb(rest);
    if (own) {
      report({ text, verb: own, woke: w.woke, scoped: true });
      closeWindow('command');
      fire(own);
      return;
    }
    const verb = verbFor(rest, table);
    const route = verb ? null : routeFor(rest, routes);
    // An unrecognised phrase does nothing - and does not close an open window, so somebody who
    // is mis-heard once can simply say it again. It is logged ONLY when it followed a wake
    // phrase (in the same breath, or inside the window): with the gate turned off, a bare
    // sentence still is not a thing anybody said to the screen, and it is not written down.
    // *** A NEAR MISS ASKS, and only when it was said to the screen, for the same reason. ***
    if (!verb && !route) {
      const toScreen = w.woke || inWindow;
      if (toScreen) logMiss(rest);
      const nm = toScreen && asking ? nearMiss(rest, spoken) : null;
      report(nm ? { text, verb: null, woke: w.woke, nearMiss: nm.phrase } : { text, verb: null, woke: w.woke });
      if (nm) ask(nm);
      return;
    }
    report(route ? { text, verb: null, route, woke: w.woke } : { text, verb, woke: w.woke });
    closeWindow('command');    // one wake, one command
    fire(verb || route);
  }

  function halt() {
    rec?.stop();
    running = false;
    endPending('stopped');
    closeWindow('stopped');
    syncAnswering();
  }

  return {
    available: () => !!rec,
    get listening() { return !!rec && !!rec.running; },
    wakePhrases: () => [...wakes],
    get windowOpen() { return open; },
    // How the recogniser should listen right now, and the grammar to load (null = open).
    recognitionMode,
    currentGrammar: () => recognitionMode().grammar,
    // The game an answer would go to right now, or null.
    answerTarget: () => { const x = currentGame(); return x ? { source: x.source, instanceId: x.instanceId, phase: x.phase } : null; },
    // The "did you mean" question up right now ({ id, phrase, question }), or null.
    nearMissPending: () => (pendingLive() ? { id: pending.id, phrase: pending.phrase, question: pending.question } : null),
    // Answer it from a host's own control (an on-screen Yes, a switch the host wired itself):
    // true = yes, fire it; false = no, drop it. Returns false when there was nothing to answer.
    answerNearMiss: (yes) => answerNearMiss(!!yes),
    start() {
      if (!rec) return false;
      running = true;
      lastModeKey = '';
      pushMode();
      rec.start(heard);
      syncAnswering();
      return true;
    },
    stop() { halt(); },
    destroy() {
      halt();
      for (const off of [offGrammar, offYes, offNo]) { try { off(); } catch { /* gone */ } }
      games.clear();
    },
  };
}
