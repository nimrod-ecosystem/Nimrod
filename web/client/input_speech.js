// input_speech.js — SPOKEN COMMANDS AS A DEVICE ON THE INPUT BUS.
//
// PRIORITY.md #8: *"a fixed voice-command set for people who will never use Nimrod. Browser
// speech recognition, a phrase table, no AI. Many phrasings → one verb."*
//
// The people this is for are the ones in the room who did not set the screen up and never will:
// an aide, a visiting relative, somebody who needs the video to stop and does not know there is
// a transport bar. They get a handful of words that work and nothing to learn - the nine
// navigation verbs, plus play, pause, louder and quieter (row 2.28) - each said after the wake
// phrase, "computer please" by default (DECISIONS.md, 2026-08-30).
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
//      normalisation. No model, no fuzzy scoring, no "did you mean". A command set that
//      sometimes guesses is worse than one that sometimes does not fire: this drives somebody's
//      screen, and a wrong verb is a video that stops or a board that jumps.
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
// (rule 3 in the header). The fuzzy half belongs to the RECOGNISER: a local engine limited to
// a grammar of exactly these phrases snaps whatever it heard to the nearest one. So every phrase
// here is plain, common, lowercase words, four at most - a phrase a small engine can know.
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
  play:   ['play', 'play it', 'play the video', 'resume', 'unpause', 'keep going', 'carry on',
           'continue'],
  pause:  ['pause', 'pause it', 'pause the video', 'stop', 'stop it', 'stop that',
           'stop the video', 'wait', 'hold on', 'hang on'],
  'volume-up':   ['louder', 'volume up', 'turn it up', 'turn up', 'turn the volume up',
                  'turn up the volume', 'a bit louder', 'a little louder', 'make it louder',
                  'more volume', 'too quiet'],
  'volume-down': ['quieter', 'volume down', 'turn it down', 'turn down', 'turn the volume down',
                  'turn down the volume', 'a bit quieter', 'a little quieter', 'make it quieter',
                  'less volume', 'too loud', 'softer'],
};

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

/** Any phrase listed under more than one verb. Must always be empty — see the table's note. */
export function duplicatePhrases(table = PHRASES) {
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
  let onText = null;
  let want = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal && onText) onText(r[0]?.transcript || '');
    }
  };
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

export const SPEECH_DEFAULTS = Object.freeze({
  // *** "COMPUTER PLEASE", AND ONLY THAT. *** DECISIONS 08-30: the default wake phrase, and a
  // setting. "Computer" is nobody's name, so it cannot collide with a person in the room, and it
  // cleared the parroting check recorded there. A SECOND phrase is supported and ships EMPTY: a
  // person's own second phrase belongs on their own profile, not in a site default everybody
  // gets (Mike's open question, row 2.28 (a)).
  wake: Object.freeze(['computer please']),
  // *** REQUIRED BY DEFAULT. *** The screen's own speaker is in the room: without a gate, a
  // video in which somebody says "stop" or "next" drives the screen it is playing on, and so
  // does any conversation that happens to be a bare command. The person who wants the opposite
  // - a quiet room, one user, no preamble - turns it off; nothing else changes.
  requireWake: true,
  // How long after the wake phrase ON ITS OWN a command may follow as a separate utterance.
  // Eight seconds: long enough for somebody who needs a moment between "computer please" and
  // the word (a recogniser also ends an utterance at the pause, so "computer please ... pause"
  // arrives as two), short enough that a command-shaped word in a later, unrelated sentence
  // is not taken as one. One wake, one command: the window closes the moment a command fires.
  wakeWindowMs: 8000,
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
});

/**
 * The wake phrases that can actually work, normalised: empties dropped (a blank second phrase
 * is simply no second phrase), duplicates dropped, and ANY PHRASE THAT IS ALSO A COMMAND REFUSED
 * - "okay" cannot both wake the screen and select, or every "okay" would do one of them at random.
 */
export function usableWakePhrases(list, table = PHRASES) {
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
 */
export function attachSpeech(input, {
  recognizer = null,
  table = PHRASES,
  device = SPEECH_DEVICE,
  onHeard = null,          // told every utterance, matched or not — for a settings panel
  view = typeof window !== 'undefined' ? window : null,
  lang = 'en-US',
  // Row 2.28 — see SPEECH_DEFAULTS for the argument behind each default.
  wake = SPEECH_DEFAULTS.wake,
  requireWake = SPEECH_DEFAULTS.requireWake,
  wakeWindowMs = SPEECH_DEFAULTS.wakeWindowMs,
  confirm = SPEECH_DEFAULTS.confirm,
  confirmWord = SPEECH_DEFAULTS.confirmWord,
  confirmTtlMs = SPEECH_DEFAULTS.confirmTtlMs,
  output = null,           // the output bus, for `word` mode (it ducks the video for the word)
  tone = null,             // injected for tests; default is the output layer's status earcon
  now = () => Date.now(),
} = {}) {
  if (!input) throw new Error('attachSpeech: an input bus is required');
  const rec = recognizer || browserRecognizer({ view, lang });
  // A wake list with nothing usable in it leaves the gate SHUT - nothing fires - rather than
  // falling open. Inaction is the safe failure for a thing that drives somebody's screen.
  const wakes = usableWakePhrases(wake, table);
  const mode = CONFIRM_MODES.includes(confirm) ? confirm : 'tone';
  const playTone = typeof tone === 'function' ? tone : defaultTone;
  let armedUntil = null;   // set by the wake phrase said on its own

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

  function heard(text) {
    const w = splitWake(text, wakes);
    let rest = w.rest;
    if (requireWake && !w.woke) {
      const inWindow = armedUntil !== null && now() <= armedUntil;
      if (!inWindow) { report({ text, verb: null, woke: false }); return; }
    }
    if (w.woke && !rest) {
      // The wake phrase on its own: the command may follow as its own utterance.
      armedUntil = now() + Math.max(0, Number(wakeWindowMs) || 0);
      report({ text, verb: null, woke: true });
      return;
    }
    const verb = verbFor(rest, table);
    report({ text, verb, woke: w.woke });
    // An unrecognised phrase does nothing - and does not close an open window, so somebody who
    // is mis-heard once can simply say it again.
    if (!verb) return;
    armedUntil = null;     // one wake, one command
    const control = phraseControl(verb);
    // Down then straight up: a spoken phrase has no duration anybody is measuring, and holding
    // it open would arm the max-hold watchdog for something that is already over.
    input.down(device, control);
    input.up(device, control);
    confirmed(verb);
  }

  return {
    available: () => !!rec,
    get listening() { return !!rec && !!rec.running; },
    wakePhrases: () => [...wakes],
    start() { if (!rec) return false; rec.start(heard); return true; },
    stop() { rec?.stop(); armedUntil = null; },
    destroy() { rec?.stop(); armedUntil = null; },
  };
}
