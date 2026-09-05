// steps.js — THE WALKTHROUGH, AS DATA. One list, five consumers.
//
// Mike, 2026-09-01, on the recorder: *"Can we use this as a guided tour of the site where they
// get walked through the script?"* Yes, and it is the better shape — so the tour is not written
// twice:
//
//     steps.js  ──┬── the RECORDER    performs each action while Playwright films it
//                 ├── PIPER           `say` is the narration input, one clip per step
//                 ├── the CAPTIONS    `say` plus real step timings becomes the WebVTT
//                 ├── the TRANSCRIPT  `say` rendered as text on the page
//                 └── the GUIDED TOUR highlights `target`, shows `say`, and WAITS for the
//                                     person instead of performing the action
//
// Same move `settings_fields.js` already makes — declare it as data and let each surface render
// it — and worth noticing that the pattern is now earning its keep somewhere it was not
// designed for.
//
// ---------------------------------------------------------------------------------------
// *** THE PROPERTY THAT MAKES THIS MORE THAN TIDINESS ***
// ---------------------------------------------------------------------------------------
//
// The recorder EXECUTES this list. A selector that goes stale therefore fails the recording,
// which makes **the video run a test of the guided tour**. A tour that silently points at a
// button that moved is the classic rot in this kind of feature, and this arrangement makes
// that failure loud and free.
//
// **Treat a failed recording as a failed suite.** Every `target` below was verified against the
// live markup on 2026-09-01; the point is that nobody has to remember to re-verify them.
//
// ---------------------------------------------------------------------------------------
// THE THREE-MINUTE BUDGET IS A HARD CONSTRAINT, NOT A TARGET
// ---------------------------------------------------------------------------------------
//
// A landing-page video that runs long is a video nobody finishes. At roughly 150 words a
// minute, three minutes is about 450 words of narration — for seven scenes, that is around
// sixty words each. `wordBudget()` at the bottom reports the real count so this cannot drift
// by a sentence at a time. Being under is fine; being over means cutting, not speeding up,
// because the audience includes people who need it slower rather than faster.
//
// ---------------------------------------------------------------------------------------
// WHAT THE TOUR INHERITS — from the product, not from tour convention
// ---------------------------------------------------------------------------------------
//
//   * **One button, one direction, wrapping.** `AGENTS.md`: everything reachable by one
//     switch, walked one way, and wrapping — a Next that stops dead at the last step strands
//     somebody there. That is the renderer's job, but `tour: false` below marks the steps it
//     must skip so the walk stays short enough to be walked.
//   * **Dismissable, and never a gate.** A tour overlay a person cannot leave is exactly the
//     shape the safety invariant forbids. Skip works from step one, and the tour never blocks
//     the thing it is describing.
//   * **Reduced motion** governs any highlight animation — the same setting `wallpaper.js`
//     reads, not a second one.
//
// ---------------------------------------------------------------------------------------
// THE DATA GATE
// ---------------------------------------------------------------------------------------
//
// This runs against the project's own demo account and its own seeded profile. Nothing here
// touches a real bedside instance: a recording of one would put a real person's photos, voice
// clips and names on a public landing page, which is a far worse exposure than anything the
// source-code scrub was ever about. `demoSeed()` below is the whole of what the video shows.

// ---------------------------------------------------------------------------------------
// SHAPE
// ---------------------------------------------------------------------------------------
//
//   id      stable, and it is the caption cue id — never renumber, only append
//   scene   which of the seven beats this belongs to
//   page    where the step runs; the recorder navigates when it changes
//   target  a CSS selector, verified against live markup
//   action  what the RECORDER does. The tour never performs it.
//   value   text to type, or a key to press
//   say     the narration. One or two sentences; this is also the caption and the transcript.
//   note    why the beat exists. For review, never shipped to a viewer.
//   tour    include in the guided tour (default true). false = recorder plumbing.
//   settle  ms to hold after the action, so the film has time to be looked at

export const ACTIONS = ['goto', 'click', 'type', 'press', 'wait', 'none'];

export const SCENES = [
  { id: 'room',    title: 'What it is for' },
  { id: 'compose', title: 'Make a screen' },
  { id: 'kiosk',   title: 'The screen itself' },
  { id: 'inputs',  title: 'However they can reach it' },
  { id: 'hold',    title: 'When somebody steps away' },
  { id: 'do',      title: 'Something to do' },
  { id: 'cost',    title: 'What it costs' },
];

export const STEPS = [
  // ---- 1 · THE ROOM ---------------------------------------------------------------------
  // The only beat that is argument rather than demonstration, so it is the shortest. It also
  // has no target: there is nothing to point at yet, and a tour that opens by highlighting a
  // nav bar has spent its first move on furniture.
  { id: 'room-1', scene: 'room', page: '/', target: null, action: 'none', tour: true,
    settle: 3200,
    say: 'Someone you love is in a bed, facing a wall, and cannot work a phone. This is a '
       + 'screen that gives them their people back — and gives you a way to reach them.',
    note: 'Concrete before abstract. No product name in the first sentence; the situation is '
        + 'what the viewer recognizes, and it is why they clicked.' },

  // ---- 2 · COMPOSE ----------------------------------------------------------------------
  { id: 'compose-1', scene: 'compose', page: '/home.html', target: '[data-name]',
    action: 'type', value: 'Demo', tour: true, settle: 900,
    say: 'A screen is a set of panels. Name one — a person, or a room.',
    note: 'Mike, 2026-09-01: "Demo". An earlier draft typed a relationship word on camera, on '
        + 'the theory that it would look like the viewer’s own life. Two things wrong with '
        + 'that: it is the demo account and calling it anything else is a small lie told in '
        + 'the first ten seconds, and a guessed relationship word is one more thing to get '
        + 'wrong about somebody. The narration already says "a person, or a room" — the '
        + 'viewer supplies their own.' },

  { id: 'compose-2', scene: 'compose', page: '/home.html', target: '[data-new] button[type=submit]',
    action: 'click', tour: false, settle: 700,
    say: null,
    note: 'Recorder plumbing. The tour does not perform actions, so it skips this and the '
        + 'person clicks Create themselves.' },

  { id: 'compose-3', scene: 'compose', page: '/home.html', target: '.h-add select',
    action: 'none', tour: true, settle: 1400,
    say: 'Add what they need. Their photos. A clock, because the day gets away from people. '
       + 'A board to talk with.',
    note: 'Names three and stops. The picker has twenty-one; listing them is a features page, '
        + 'and this is meant to sound like a decision somebody makes in a minute.' },

  { id: 'compose-4', scene: 'compose', page: '/home.html', target: '[data-add]',
    action: 'click', tour: false, settle: 500, say: null,
    note: 'Plumbing × 3 in the recorder — photos, clock, board. Kept as one step because '
        + 'three identical clicks on film is dead air.' },

  // MOVED HERE FROM THE KIOSK RUN, 2026-09-02, at Mike's instruction to "point at the input
  // bindings". They are not on the kiosk. `[data-settings]` was the kiosk's own options box
  // ("auto-advance when a video ends"), hidden by default, and even unhidden it would have
  // ringed the wrong thing while the line talked about per-person bindings.
  //
  // The bindings live on the composer's **Devices** tab, whose own tooltip in `home.js` reads
  // "the switches, controllers and keys you use — and what each one does" — which is this beat's
  // sentence, written by somebody else, in the UI. That is where it points.
  //
  // *** AND IT SITS IN THE HOME RUN NOW, WHICH SPLITS SCENE 4 ACROSS TWO PAGES. *** `inputs-1`
  // is still on the kiosk. That is a wrinkle in the script rather than in the code — the tour
  // walks `STEPS` order and reads fine, but `transcript()` groups by scene and will now show
  // these two out of sequence. Not smoothed over here, because the script needs Mike's pass
  // anyway: *"almost everyone will have left after the first 2 slides."*
  { id: 'inputs-2', scene: 'inputs', page: '/home.html', target: '[data-tab="inputs"]',
    action: 'none', tour: true, settle: 2400,
    say: 'What a switch or a key actually does is set here, for the person rather than for the '
       + 'device. Change it once and every screen they use follows.',
    note: 'Per-person bindings are a real differentiator and invisible on a screen recording, '
        + 'so this beat exists to say it while something relevant is on screen. Reworded when '
        + 'it moved: it used to open with "And what each one does", which only parsed if '
        + 'inputs-1 had just been said — and inputs-1 now comes after it.' },

  { id: 'compose-5', scene: 'compose', page: '/home.html', target: '[data-open]',
    action: 'click', tour: true, settle: 2600,
    say: 'Then open it. That is the screen made.',
    note: 'WAS "that is the whole setup", and it overclaimed. Composing a screen really is this '
        + 'short; the SETUP around it — an account, a folder of photos, a machine by the bed — '
        + 'is longer and nobody has timed one yet. Saying "the whole setup" over a ten-second '
        + 'clip would set an expectation the first real user finds out is wrong, which is the '
        + 'same failure the landing page leaves a hole for rather than committing.' },

  // ---- 3 · THE KIOSK --------------------------------------------------------------------
  { id: 'kiosk-1', scene: 'kiosk', page: '/kiosk.html', target: '[data-stage]',
    action: 'none', tour: true, settle: 3000,
    say: 'This is the screen they see. Their own photographs, full size, changing on their own. '
       + 'Nothing to press for it to keep going.',
    note: '"Nothing to press for it to keep going" is the safety invariant said in a sentence a '
        + 'caregiver understands. It is the single most important property of the product and '
        + 'it is stated here rather than at the end.' },

  // TARGET WAS `[data-mirror]`, WHICH IS `hidden` UNLESS A CAMERA PANEL IS CONFIGURED — and the
  // demo screen has none, so the most concrete beat in the script narrated over a screen with no
  // mirror on it. Found by walking the tour in a browser; `--check` had been returning early for
  // every `action: 'none'` step and never looked.
  //
  // *** MIKE, 2026-09-02: "point the mirror beat at the zoo cam quadrant." *** That is the
  // top-right cell of the seeded quad — `youtube` — per the 2026-08-27 layout decision, and the
  // same panel the landing page's poster labels "Live view". `[data-kind]` is new markup on the
  // layout cells (see `kiosk.js`); the alternative was `.k-cell:nth-child(2)`, which points at a
  // position rather than at that panel and would silently start ringing the wrong quadrant the
  // day somebody reorders the layout.
  //
  // *** AND THE LINE HAD TO CHANGE, BECAUSE IT WOULD NOW BE FALSE. *** "The corner IS a
  // rear-view mirror of the room" narrated over a zoo camera is a lie told in the first minute —
  // the same objection that already rewrote `compose-1`. It now says what that corner is FOR on
  // a bedside screen while describing what is actually on this one, which loses nothing: the
  // mirror is still the image the viewer takes away.
  //
  // Deliberately NOT said: "and the demo never asks for your camera." True, and a good line, but
  // it would need re-checking the day the zoo-cam stream id lands, and the privacy point already
  // has its own beat in `cost-1`. THE ZOO CAM IS STILL NOT WIRED — that panel runs the curated
  // starter schedule today — so this wording is true either way on purpose.
  { id: 'kiosk-2', scene: 'kiosk', page: '/kiosk.html', target: '[data-kind="youtube"]',
    action: 'none', tour: true, settle: 2600,
    say: 'A corner of the screen holds a live view. On a bedside screen that corner is a '
       + 'rear-view mirror of the room — for somebody who cannot turn their head, it is who '
       + 'just walked in.',
    note: 'The most concrete thing in the whole product and it used to be fifteen hundred words '
        + 'down the landing page. It goes early.' },

  // TARGET WAS `.k-mods` AND THE RECORDER CAUGHT IT ON ITS FIRST RUN. That element holds the
  // stage-switching dots, which only populate on a stage-based screen — on a laid-out screen
  // it is present, empty and zero-sized, so the tour would have drawn a ring around nothing.
  // `[data-controls]` is the row the narration is actually about and it is always there.
  { id: 'kiosk-3', scene: 'kiosk', page: '/kiosk.html', target: '[data-controls]',
    action: 'press', value: '2', tour: true, settle: 2600,
    say: 'Swap what is on the stage, and the mirror stays. It is not a slideshow with the '
       + 'camera bolted on — the panels are independent.',
    note: 'THE SINGLE MOST CONVINCING BEAT. Show it, do not describe it. Press 2 is also the '
        + 'quiet argument that a keyboard drives this as well as a mouse, which scene 4 then '
        + 'makes explicit.' },

  // ---- 4 · INPUTS -----------------------------------------------------------------------
  { id: 'inputs-1', scene: 'inputs', page: '/kiosk.html', target: '[data-controls]',
    action: 'none', tour: true, settle: 3000,
    say: 'However they can reach it. A switch, a key, a controller, or a bright sock in front '
       + 'of a webcam — all of them send the same handful of instructions.',
    note: 'THE POINT IS INTERCHANGEABILITY, not any one device. The sock is the honest detail '
        + 'that makes it land: it is what actually works for the person this was built for, '
        + 'and it costs nothing.' },

  // ---- 5 · A HOLD -----------------------------------------------------------------------
  { id: 'hold-1', scene: 'hold', page: '/kiosk.html', target: '[data-stage]',
    action: 'none', tour: true, settle: 3400,
    say: 'When somebody pauses a video to talk to them, the screen does not sit on a frozen '
       + 'face. It goes quiet and calm, and when you come back the film is where you left it.',
    note: 'THE THING NOBODY ELSE DOES. "A frozen face" is the concrete image — anybody who has '
        + 'sat in a hospital room recognizes a stalled screen and reads it as broken.' },

  // ---- 6 · SOMETHING TO DO --------------------------------------------------------------
  { id: 'do-1', scene: 'do', page: '/kiosk.html', target: '[data-stage]',
    action: 'none', tour: true, settle: 2800,
    say: 'There are things to do, at whatever level today is. A word game, a quiz, a board to '
       + 'say yes, no, or something else.',
    note: '"Whatever level today is" rather than "adapts to ability" — recovery is not '
        + 'monotonic and the honest phrasing is the one that says so.' },

  { id: 'do-2', scene: 'do', page: '/kiosk.html', target: '[data-stage]',
    action: 'none', tour: true, settle: 2800,
    say: 'And it is measured, quietly. Their therapist can see what changed over a month. '
       + 'They never see a score they did not ask for.',
    note: 'PRINCIPLES.md §3.C in one sentence. It matters here because "it measures things" '
        + 'sounds like surveillance until you say who it is NOT shown to.' },

  // ---- 7 · WHAT IT COSTS ----------------------------------------------------------------
  { id: 'cost-1', scene: 'cost', page: '/', target: null, action: 'none', tour: true,
    settle: 3600,
    // "There is nothing to buy and nothing to cancel" was REMOVED 2026-09-05, not reworded.
    // Mike struck that promise: hosted AI and hosted storage are a paid add-on, so the claim
    // stops being true. The sentence is deleted rather than replaced because C7 says the tour
    // script needs Mike's pass and is not to be rewritten alone - taking out something that has
    // become false is a correction; writing new narration in its place would be a rewrite.
    //
    // The note below is kept as written so the reasoning it records is not lost, with the part
    // that referred to the removed line marked. NEEDS MIKE'S PASS: the beat is now shorter, and
    // `settle` has not been retimed because how long a card sits is his call, not mine.
    say: 'It is free, it is open source, and your photographs never leave your machine.',
    note: 'One card, no music sting. (The old second sentence, "nothing to buy and nothing to '
        + 'cancel", was removed when that stopped being true — it answered the question the '
        + 'viewer had been holding, so something still needs to. Mike to write it.)' },
];

// ---------------------------------------------------------------------------------------
// HELPERS — small, pure, and shared by all five consumers so they cannot disagree.
// ---------------------------------------------------------------------------------------

/**
 * HOW LONG A STEP MUST STAY ON SCREEN.
 *
 * *** ADDED AFTER THE FIRST REAL RECORDING, WHICH CAME OUT 39 SECONDS LONG AGAINST 126 SECONDS
 * OF NARRATION. *** The `settle` values were hand-picked for how long a shot wants to be looked
 * at, and every one of them was shorter than the line spoken over it — so the film would have
 * ended while the narrator was still on scene four.
 *
 * A hold is therefore the LONGER of the two: how long the picture wants, and how long the words
 * take. Deriving it means the film cannot fall out of sync with its own script when somebody
 * edits a sentence, which is the failure that would otherwise be found at mux time.
 *
 * The recorder and the caption builder both use this, so they cannot disagree about when a step
 * ends.
 */
export function holdMs(step, { wpm = 145, padMs = 450 } = {}) {
  const words = step.say ? step.say.trim().split(/\s+/).length : 0;
  const speech = words ? (words / wpm) * 60000 + padMs : 0;
  return Math.round(Math.max(step.settle || 0, speech));
}

/** What the tour walks. Recorder plumbing and silent steps are not stops on a tour. */
export const tourSteps = (steps = STEPS) => steps.filter((s) => s.tour !== false && s.say);

/** What Piper narrates, in order. One clip per step keeps re-recording one line cheap. */
export const narration = (steps = STEPS) =>
  steps.filter((s) => s.say).map((s) => ({ id: s.id, text: s.say }));

/** The transcript, as text on the page — grouped by scene so it can be read rather than scanned. */
export function transcript(steps = STEPS, scenes = SCENES) {
  return scenes.map((sc) => ({
    title: sc.title,
    lines: steps.filter((s) => s.scene === sc.id && s.say).map((s) => s.say),
  })).filter((s) => s.lines.length);
}

/**
 * THE BUDGET, COUNTED RATHER THAN ASSUMED.
 *
 * A landing-page video that runs long is one nobody finishes, and narration grows a sentence
 * at a time. `wpm` is deliberately slow: the audience includes people who need it slower, and
 * pacing a script for them is the product's own argument.
 */
export function wordBudget(steps = STEPS, { wpm = 145, capSeconds = 180 } = {}) {
  const words = steps.reduce((n, s) => n + (s.say ? s.say.trim().split(/\s+/).length : 0), 0);
  const settle = steps.reduce((n, s) => n + (s.settle || 0), 0) / 1000;
  const speech = (words / wpm) * 60;
  return {
    words,
    speechSeconds: Math.round(speech),
    settleSeconds: Math.round(settle),
    // Narration runs DURING the settle, so the film is as long as the slower of the two per
    // step — not the sum. This is the honest estimate rather than the flattering one.
    estimateSeconds: Math.round(Math.max(speech, settle)),
    capSeconds,
    overBudget: Math.max(speech, settle) > capSeconds,
  };
}

/**
 * The demo profile the whole thing runs against.
 *
 * THE DATA GATE, as data. Nothing here came off anybody's real media agent, and the recorder
 * seeds exactly this and nothing else — so "was a real person's photo in frame?" is answered
 * by reading one list rather than by watching the film again.
 */
// *** IT SAID `['photos', 'clock', 'board']` AND THE DEMO SCREEN HAS NO BOARD. ***
// `seedStarterScreen` in `local_store.js` builds photos · youtube · wordforge · clock in a quad,
// and that is the code that actually runs when a stranger opens the kiosk. This list was a
// hand-written description of it, and descriptions drift — two of the three entries were wrong.
//
// That matters more than tidiness, because this list is the DATA GATE's answer: "was anything
// real in frame?" is meant to be answerable by reading it instead of watching the film again. A
// stale list answers a safety question with a guess. `walkthrough_test.html` now RUNS the seed
// and compares, rather than reading this and nodding.
export const demoSeed = () => ({
  // MISSED IN THE FIRST PASS. `compose-1` was changed to type "Demo" — Mike: *"'Mum's room', not
  // 'Demo' — change to demo, and watch out for the British. I'm American and wouldn't call her
  // mum."* — and this line, which names the same screen, was left behind. Two names for one
  // screen is also a defect on its own terms: the recorder seeds this and then films somebody
  // typing something else. The suite now asserts they agree so it cannot drift again.
  screenName: 'Demo',
  modules: ['photos', 'youtube', 'wordforge', 'clock'],
  // Generated fixtures, never real media. `make_test_fixtures.py` is the existing precedent.
  mediaLabel: 'demo photos',
});
