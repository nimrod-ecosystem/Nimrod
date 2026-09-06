// input_speech.js — SPOKEN COMMANDS AS A DEVICE ON THE INPUT BUS.
//
// PRIORITY.md #8: *"a fixed voice-command set for people who will never use Nimrod. Browser
// speech recognition, a phrase table, no AI. Many phrasings → one verb."*
//
// The people this is for are the ones in the room who did not set the screen up and never will:
// an aide, a visiting relative, somebody who needs the video to stop and does not know there is
// a transport bar. They get nine words that work and nothing to learn.
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

export const SPEECH_DEVICE = 'speech';

/**
 * *** THE PHRASE TABLE. MANY PHRASINGS, ONE VERB. ***
 *
 * Ordinary English for each of the nine verbs, written for somebody who has never seen this
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
export const PHRASES = {
  select: ['select', 'okay', 'ok', 'yes', 'choose', 'choose it', 'do it', 'press it',
           'that one', 'this one', 'go ahead'],
  back:   ['back', 'go back', 'cancel', 'undo that', 'never mind', 'nevermind', 'stop that'],
  next:   ['next', 'go next', 'forward', 'next one', 'move on', 'skip', 'skip it',
           'change it', 'something else'],
  prev:   ['previous', 'go previous', 'last one', 'previous one', 'back one', 'go backwards'],
  up:     ['up', 'go up', 'move up'],
  down:   ['down', 'go down', 'move down'],
  left:   ['left', 'go left', 'move left'],
  right:  ['right', 'go right', 'move right'],
  menu:   ['menu', 'settings', 'open the menu', 'show the menu', 'options'],
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
} = {}) {
  if (!input) throw new Error('attachSpeech: an input bus is required');
  const rec = recognizer || browserRecognizer({ view, lang });

  function heard(text) {
    const verb = verbFor(text, table);
    try { onHeard?.({ text, verb }); } catch (err) { console.error('speech: onHeard', err); }
    if (!verb) return;
    const control = phraseControl(verb);
    // Down then straight up: a spoken phrase has no duration anybody is measuring, and holding
    // it open would arm the max-hold watchdog for something that is already over.
    input.down(device, control);
    input.up(device, control);
  }

  return {
    available: () => !!rec,
    get listening() { return !!rec && !!rec.running; },
    start() { if (!rec) return false; rec.start(heard); return true; },
    stop() { rec?.stop(); },
    destroy() { rec?.stop(); },
  };
}
