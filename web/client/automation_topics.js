// automation_topics.js — THE MESSAGES AN AUTOMATION RULE CAN SENSIBLY LISTEN TO, each with a plain label.
//
// The gap (6114bb1, automation by switch): "a message (a sensor, a game, a score)" offered only the names
// this screen's rules already used, so a NEW message rule still needed a keyboard once. This is the list the
// edit view hands the Automation window (dashboard_editor.js `topics`), so the name is a choice a switch can
// make. The box stays for a keyboard and a name that is not listed.
//
// *** "SENSIBLY" IS THE FILTER: A MESSAGE IS LISTED ONLY IF ITS PAYLOAD CARRIES A NUMBER. *** A bus rule reads
// a number out of what a topic carries (automation.js `readNumber`: a bare number, a `{ value }` envelope, a
// yes/no, or a named field -- `path`). A topic that carries no number makes a rule that never moves, which
// looks set up and does nothing. So, of the sources this list was asked to cover:
//   * BUTTONS, SWITCHES, KEYS, THE GAMEPAD: a press publishes its verb's topic (`verb/select`, ...) with NO
//     payload, so as a message it is nothing. A switch already drives a setting through "a switch or key (a
//     verb)", which is a choice today. What a press DOES carry as a number is how long it was held: the
//     input bus's measurement channel (input.js EDGE_TOPIC, `heldMs` on every let-go, any device). Listed.
//   * THE AtomS3R BUTTON AND THE DIAL: neither has an adapter on this site (Cici's dashboard has them). An
//     AtomS3R reaching the site as a keyboard or a switch is covered by the hold-time line above; a dial has
//     nothing to list until something publishes its position.
//   * SPEECH ROUTES (input_speech.js ROUTES): each presses an action whose payload is `{ game }` or nothing --
//     no number. What speech does carry is two on/off states (listening after the wake phrase; waiting for a
//     spoken answer), read through their `on` field as 1 / 0. Listed.
//   * MODULE STATE THAT CARRIES A NUMBER: a module's declared number OUTPUT is "another panel's output" (the
//     `link` kind, links.js portsFor), already chosen by name, not here. The screen-wide ones are here: a
//     game's score (score_source.js, `{ value }`) and points as they are earned (points.js, `{ value }`).
//   * WHERE SOMEBODY IS POINTING (aim.js): x and y, 0..1 of the screen, from a mouse, a touch, a head pointer
//     or a colour marker -- the most dial-like thing the site has. Listed.
//   NOT listed: `tempo/value` (nothing on the site sends it yet), weather (a whole room-scene import for one
//   temperature), and the per-press activation log (a yes/no per decision, nobody's idea of a dial).
//
// EVERY TOPIC NAME COMES FROM ITS OWNER'S EXPORTED CONSTANT, so a renamed topic renames here. The labels are
// copy, written for the person setting a screen up. Each `range` is what the number spans, filled into "Its
// lowest" / "Its highest" when the message is chosen (the person can still nudge them): exact where the
// producer says (aim and the on/off states are 0..1), a GUESS where it does not -- held 0..2 seconds, a score
// 0..10, points 0..10 -- each on Mike's list (Rule 1: a default, never a limit; the engine clamps, nothing
// refuses a bigger number).
//
// Shape of an entry: { topic, path?, label, hint, range? } -- what mountAutomationPanel's `topics` takes
// (it takes bare strings too).

import { AIM_TOPIC } from './aim.js';
import { EDGE_TOPIC } from './input.js';
import { SCORE_TOPIC } from './score_source.js';
import { POINTS_TOPIC } from './points.js';
import { LISTENING_TOPIC, ANSWERING_TOPIC } from './input_speech.js';

/** The guesses, named, so a test and Mike's list can point at them. */
export const AUTOMATION_TOPIC_RANGES = Object.freeze({
  heldMs: Object.freeze([0, 2000]),   // a press held two seconds is "all the way"; a quick tap is near 0
  score: Object.freeze([0, 10]),      // ten right answers is "all the way"
  points: Object.freeze([0, 10]),     // one award of ten points is "all the way"
});

const freeze = (e) => Object.freeze({ path: null, ...e, range: e.range ? Object.freeze([...e.range]) : null });

export const AUTOMATION_TOPICS = Object.freeze([
  freeze({ topic: AIM_TOPIC, path: 'x', range: [0, 1], label: 'Where the pointer is, left to right',
    hint: 'a mouse, a touch, a head pointer or a colour marker: the left edge is lowest' }),
  freeze({ topic: AIM_TOPIC, path: 'y', range: [0, 1], label: 'Where the pointer is, top to bottom',
    hint: 'a mouse, a touch, a head pointer or a colour marker: the top edge is lowest' }),
  freeze({ topic: EDGE_TOPIC, path: 'heldMs', range: AUTOMATION_TOPIC_RANGES.heldMs, label: 'How long a switch was held',
    hint: 'any switch, key, button or gamepad, each time it is let go (in thousandths of a second)' }),
  freeze({ topic: SCORE_TOPIC, range: AUTOMATION_TOPIC_RANGES.score, label: 'A game’s score',
    hint: 'whichever game on the screen last changed its score' }),
  freeze({ topic: POINTS_TOPIC, range: AUTOMATION_TOPIC_RANGES.points, label: 'Points just earned',
    hint: 'each award as it is made' }),
  freeze({ topic: LISTENING_TOPIC, path: 'on', range: [0, 1], label: 'Listening for a spoken command',
    hint: 'on after the wake phrase, off when it stops listening' }),
  freeze({ topic: ANSWERING_TOPIC, path: 'on', range: [0, 1], label: 'Waiting for a spoken answer',
    hint: 'on while a game listens for an answer, off when it stops' }),
]);
