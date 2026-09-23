// input_facegesture.js — A SUSTAINED FACIAL GESTURE (mouth-open, by default) AS A SWITCH ON THE
// INPUT BUS.
//
// `MIKE_CHANGE_LIST.md`'s `§trackymouse-instructions`, part 1: "the smaller, better-fitting
// piece." Mike wants this as an ADDITION alongside `input_marker.js`'s color-marker tracker, not
// a replacement, and asked for it to work through the ordinary input bus like a physical switch
// — down on the edge the gesture starts, up on the edge it ends — so binding, holding, roles and
// the false-activation gate all apply exactly as they do to a real button. Nothing here invents a
// second switch mechanism; see `input_gamepad.js`'s own `edge()` helper, which this mirrors.
//
// ---------------------------------------------------------------------------------------
// *** THIS FILE IS ONE THIRD OF THE WHOLE PICTURE, AND IT IS THE SMALL THIRD. ***
// ---------------------------------------------------------------------------------------
//
// Three pieces, and only the middle one lives here:
//
//   1. A CAMERA STREAM.        Already solved — `camera_owner.js`, the same shared arbiter
//                               `input_marker.js` already acquires through. Confirmed this
//                               session (2026-09-23, read not guessed) that a second consumer
//                               coexists fine — no `getUserMedia` conflict.
//   2. A FACE-LANDMARK MODEL, run on that stream, producing a MediaPipe-FaceMesh-shaped
//      `annotations` object (named landmark groups: `lipsUpperInner`, `leftEyeUpper0`, etc. —
//      the classic `@tensorflow-models/face-landmarks-detection` MediaPipe-runtime shape, WITH
//      `refineLandmarks: true`, per `vendor/tracky_mouse_gestures.js`'s own comment on why that
//      flag is "100% necessary" for the blink math). **THIS DOES NOT EXIST IN THIS CODEBASE
//      YET, and is deliberately NOT built here.** It is a real new dependency (MediaPipe/TFJS,
//      tens of MB, a WASM-vs-WebGL backend choice) and a real performance question — the Pi
//      ceiling that ruled out landmark tracking for the smooth continuous CURSOR
//      (`input_marker.js`'s own ~6fps finding) does not obviously apply to a switch, which only
//      needs to notice a HELD gesture within a fraction of a second, but "obviously does not
//      apply" is not the same as measured, and this needs a real test on the bench Pi before
//      anyone trusts it. That is a decision (which library, what it costs the bundle, what it
//      costs a Pi) worth its own sign-off, not something to pick silently while building the
//      switch logic. Flagged in `MIKE_CHANGE_LIST.md`, not built blind.
//   3. THE GESTURE MATH AND THE SWITCH EDGE. This file. `detectGestures` (vendored, MIT,
//      `vendor/tracky_mouse_gestures.js`) turns one frame's `annotations` into whether the mouth
//      is open / an eye is blinking, with the hysteresis and the 100ms involuntary-blink
//      debounce tracky-mouse's own authors tuned — worth copying that tuning, not re-deriving
//      it. This file turns THAT into a down/up edge on the bus.
//
// EVERYTHING IS INJECTED (`detectFrame`), the same discipline `input_marker.js` states for its
// own `frames` callback: a test hands in a plain `annotations` object it built by hand, no
// camera and no model involved, so the switch logic (edges, per-person trigger choice, "release
// rather than hold on a dropped frame") is fully provable today even though piece 2 above is not
// built. Piece 2's own real integration test — a real camera against a real model on the real
// bench Pi — has to wait for that piece to exist; this file's tests do not.
//
// ---------------------------------------------------------------------------------------
// WHICH GESTURE IS THE TRIGGER — A PER-PERSON CHOICE, AND ONE DEFAULT NOT TO CHANGE LIGHTLY
// ---------------------------------------------------------------------------------------
//
// Mike, 2026-09-15: "could be a user option" — so `trigger` is a getter, read fresh every tick,
// stored the same place input bindings already live per person, exactly like `input_marker.js`'s
// `settings` getter.
//
// `'mouth'` is the default and tracky-mouse's own authors use mouth-open as their click gesture,
// eye-closure only as a MODIFIER never the trigger — almost certainly because blinking is
// involuntary and frequent while mouth-open is deliberate and rare. **Do not make blink-as-click
// the default if it ever ships at all; follow their choice, do not relitigate it from scratch**
// (their own comments show real iteration on exactly this question already).

import { detectGestures } from './vendor/tracky_mouse_gestures.js';

export const FACEGESTURE_DEVICE = 'facegesture';

// One stable control name regardless of which gesture is configured as the trigger, the same
// reason `input_speech.js`'s `phraseControl` is keyed by VERB rather than by phrase — a
// caregiver's binding to "this switch" should survive a later change of which gesture drives it.
export const FACEGESTURE_CONTROL = 'gesture';

export const GESTURE_TRIGGERS = ['mouth', 'blink-left', 'blink-right'];
export const DEFAULT_TRIGGER = 'mouth';

// Which of `detectGestures`'s own outputs counts as "the switch is down" for a given trigger
// choice. Pure and exported, because a settings panel showing "is it seeing your gesture right
// now" wants the identical read the switch itself uses, not a second interpretation of the same
// numbers that could quietly disagree with it — the same reasoning `input_marker.js`'s `onFrame`
// callback is given for, not scanned separately by the calibration preview.
export function isTriggerActive(result, gestureTrigger) {
  if (!result) return false;
  if (gestureTrigger === 'mouth') return !!result.mouthInfo?.thresholdMet;
  if (gestureTrigger === 'blink-left') return !!result.blinkInfo?.leftEye?.active;
  if (gestureTrigger === 'blink-right') return !!result.blinkInfo?.rightEye?.active;
  return false;
}

/**
 * The runtime. `detectFrame()` is called once per tick and must return either a
 * MediaPipe-FaceMesh-shaped `annotations` object for the current frame, or a falsy value when no
 * face was found — the seam piece 2 (this file's own header) plugs into, and what a test hands in
 * directly.
 */
export function createFaceGestureSwitch({
  input,
  device = FACEGESTURE_DEVICE,
  control = FACEGESTURE_CONTROL,
  // A getter, so a caregiver changing which gesture drives the switch takes effect on the next
  // frame rather than on the next remount — same pattern as `input_marker.js`'s `settings`.
  trigger = () => DEFAULT_TRIGGER,
  detectFrame = null,
  // tracky-mouse's own default for how long eyes must stay closed to trigger their (unrelated,
  // unused-here) sleep gesture. `detectGestures` requires SOME value; this switch never reads
  // `sleepGestureTriggered`, so the number only affects an output field nothing here looks at.
  sleepGestureEyesClosedDuration = 700,
  requestFrame = (fn) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(fn) : setTimeout(fn, 16)),
  cancelFrame = (id) => (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame(id) : clearTimeout(id)),
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
} = {}) {
  if (!input) throw new Error('createFaceGestureSwitch: an input bus is required');
  if (typeof detectFrame !== 'function') {
    throw new Error('createFaceGestureSwitch: a detectFrame() source is required — see this file’s own header on why nothing supplies one yet');
  }

  let running = false;
  let rafId = 0;
  let destroyed = false;
  let lastTime = null;
  // detectGestures' own input+output state, carried tick to tick for hysteresis — the same shape
  // its upstream caller (tracky-mouse's own runtime loop) threads through.
  let blinkInfo = null, mouthInfo = null;
  let sleepGestureProgress = 0;
  let mouseButtonUntilMouthCloses = 0;
  let lastResult = null;
  let held = false;              // the RAW edge already reported to the bus

  // `auto` marks a release the DEVICE forced (no face this tick — see `tick()`'s `else` branch),
  // never one a real gesture ended, the same distinction `input_gamepad.js` draws between a
  // button lifted and a controller unplugged. A real close of the mouth is an ordinary release.
  function edge(active, auto = false) {
    if (active === held) return;
    held = active;
    active ? input.down(device, control) : input.up(device, control, { auto });
  }

  // One tick. Exported through the returned object so a test can step it deliberately rather
  // than racing a frame loop — the same reason `input_marker.js` exposes `step`.
  function tick() {
    if (!running || destroyed) return;
    try {
      const t = now();
      const deltaTime = lastTime == null ? 16 : Math.max(1, t - lastTime);
      lastTime = t;
      const annotations = detectFrame();
      if (annotations) {
        lastResult = detectGestures({
          blinkInfo, mouthInfo, sleepGestureProgress, sleepGestureEyesClosedDuration,
          mouseButtonUntilMouthCloses, annotations, deltaTime,
          // tracky-mouse's own MOUSE-click vocabulary. Irrelevant here — this switch reads
          // `mouthInfo`/`blinkInfo` directly (via `isTriggerActive`) and never looks at
          // `clickButton`, so which mode is named costs nothing and changes nothing.
          s: { clickingMode: 'open-mouth-ignoring-eyes', closeEyesToToggle: false },
        });
        blinkInfo = lastResult.blinkInfo; mouthInfo = lastResult.mouthInfo;
        sleepGestureProgress = lastResult.sleepGestureProgress;
        mouseButtonUntilMouthCloses = lastResult.mouseButtonUntilMouthCloses;
        edge(isTriggerActive(lastResult, trigger()));
      } else {
        // *** NO FACE THIS TICK RELEASES, IT DOES NOT HOLD. *** A dropped frame — somebody
        // turned their head, a camera glitch — must not leave a switch stuck down on a channel
        // that drives somebody's screen. `auto: true` marks it as the device letting go, not
        // a real release edge, matching `input_gamepad.js`'s own unplug handling.
        edge(false, true);
      }
    } catch (err) {
      // A tracker that throws must not take the switch down with it and must not stop trying —
      // the identical reasoning `input_marker.js`'s own `loop` states for a camera glitch.
      console.error('facegesture: frame', err);
    }
    rafId = requestFrame(tick);
  }

  function start() {
    if (running || destroyed) return false;
    running = true;
    lastTime = null;
    rafId = requestFrame(tick);
    return true;
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId) { cancelFrame(rafId); rafId = 0; }
    // Stopping is the device letting go, not a gesture ending — `auto: true`, same as the
    // no-face-this-tick case above.
    edge(false, true);
  }

  return {
    start, stop, tick,
    isRunning: () => running,
    // WHAT IT SAW LAST TICK, for a calibration/preview panel — same reasoning as
    // `input_marker.js`'s `found()`: one detection per frame, read by both the switch and
    // whatever draws the preview, so the two can never disagree about what happened.
    lastResult: () => lastResult,
    destroy() { destroyed = true; stop(); },
  };
}
