# Hooking up a face-tracking library

Nimrod ships one camera-based input device by default: **the colour-marker tracker**
(`input_marker.js`) — a person wears or holds something brightly coloured, and the camera
follows it. Face tracking (mouth-open / blink as a switch, `input_facegesture.js`) and any
form of head-tracking-as-a-pointer are **not bundled**. This is Mike's own decision
(2026-09-26): *"Color tracker built in sounds good. Maybe give links for the other trackers
and make them easy to hook up to Nimrod."* This page is that hookup.

## Why the colour tracker ships and face tracking doesn't

Not a guess — measured, and written up in `input_marker.js`'s own header:

- The colour tracker runs **~30 fps on a Pi 400** doing per-pixel colour matching on a
  downscaled frame. It needs **no model file at all** — nothing to download, nothing to point
  at a folder.
- A hand/pose landmark model, tried first on the original bedside build, ran **~6 fps** on the
  same class of hardware and **failed in the room** for reasons specific to the person it was
  for (atypical geometry, unreliable landmarks for that body part, low contrast against a
  hospital sheet) — none of which are obvious from a desk, which is exactly why it's worth
  reading that file's own header before assuming a landmark model is the answer for someone
  else.
- A face-landmark model (what this page is about) hasn't been measured on Pi-class hardware by
  this project, but it uses the same family of ML model as the hand/pose case above, and is a
  genuine tens-of-megabytes download. Bundling something that size, for a capability most
  people setting up a screen will never turn on, is the wrong default — see the "will this run
  on my machine" section below for how to find out on YOUR OWN hardware before deciding.

So: the colour tracker ships built in. Face tracking is a **hookup** — a seam already built and
tested, that a real face-tracking library plugs into.

## The seam: `createFaceGestureSwitch`

`web/client/input_facegesture.js` is a complete, tested switch — down/up edges on the ordinary
input bus, the same as a physical button — for a **sustained facial gesture** (mouth open, by
default; blink is also supported, though tracky-mouse's own authors treat blink as a modifier
rather than the trigger, since blinking is involuntary and mouth-open is deliberate — see that
file's own header for the full reasoning, and don't relitigate it from scratch).

What it does NOT include: a camera, or a face-landmark model. Those don't exist anywhere in
this codebase yet, on purpose. The one thing it needs from you:

```js
import { createFaceGestureSwitch } from './input_facegesture.js';

const sw = createFaceGestureSwitch({
  input,              // the input bus (same one attachKeyboard/attachSpeech take)
  detectFrame: () => {
    // Called once per tick. Return a MediaPipe-FaceMesh-shaped `annotations` object for
    // the CURRENT frame (see below), or a falsy value when no face was found this tick.
    // This is where your chosen library's own per-frame result goes.
  },
});
sw.start();
```

`detectFrame()`'s return value, when a face IS found, needs exactly these six named point
groups (each an array of `[x, y]` points) — the same shape the classic
`@tensorflow-models/face-landmarks-detection` package returns in its `annotations` field, run
in **MediaPipe mode with `refineLandmarks: true`** (the vendored gesture math's own comment
says this flag is "100% necessary" for the eye math to work at all):

```
lipsUpperInner, lipsLowerInner       — the inner mouth contour
leftEyeUpper0,  leftEyeLower0        — the left eye contour
rightEyeUpper0, rightEyeLower0       — the right eye contour
```

Whatever library you use, the adapter code you write is: run the model on a video frame, pull
those six point groups out of its result, hand them to `detectFrame()` in this shape. Nothing
else in `input_facegesture.js` needs to change.

For the camera stream itself, acquire it through `camera_owner.js` (the same shared arbiter
`input_marker.js` already uses) rather than calling `getUserMedia` directly — confirmed this
session that a second consumer coexists fine alongside the colour tracker or a video call, with
no conflict.

## The two candidate libraries

Neither has been tried against this seam yet. Both produce (or can be made to produce) the
annotation shape above.

- **[`@tensorflow-models/face-landmarks-detection`](https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection)**
  (TensorFlow.js). The library the classic `annotations` shape above comes from natively — run
  it with `runtime: 'mediapipe'` (or `'tfjs'`) and `refineLandmarks: true`, and its own result
  object already has `annotations` in the exact shape `detectFrame()` needs, no reshaping
  required. Independent benchmarks (not this project's own) put comparable landmark/pose
  workloads around 5 fps on a Raspberry Pi 4 without hardware acceleration, and note that WASM
  tuning is needed just to be "on par" on weak CPUs — worth knowing before assuming it will
  simply work.
- **[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)**
  (Google's newer Tasks API). Returns raw numbered landmarks rather than named groups like
  `lipsUpperInner` — your adapter needs to pick the specific landmark indices for the mouth and
  eye contours and assemble them into the six named arrays above. More setup work than the TFJS
  package, but is the actively-maintained successor API and may have better mobile/edge
  performance — untested here.

Both are free, open-source, and run entirely in the browser — no server, no API key, nothing
leaves the device.

## "Will this run on my machine?"

Don't take either library's own claims, or this page's, on faith for your specific hardware —
test it. `web/client/dev/input_facegesture_test.html` proves the switch logic works with no
camera or model at all (hand-built landmark data). Once you've wired a real library in via
`detectFrame`, the honest way to know if it's fast enough is to watch it run:

1. Open your adapter's page with the browser's performance/FPS tooling open (or just watch
   `performance.now()` deltas between successive `detectFrame()` calls, logged to the console).
2. A face-tracking SWITCH has a much lower bar than a smooth pointer would — it only needs to
   notice a HELD gesture within a fraction of a second, not drive continuous movement. Several
   frames per second is likely enough; this has not been measured on Pi-class hardware by this
   project, so "likely" is doing real work in that sentence — confirm it on the actual device
   this will run on before relying on it.
3. If it's too slow on a given machine, that's the answer, not a bug — this is exactly why
   neither library is bundled by default.

## Hand tracking

No hookup exists yet for hand-landmark tracking specifically — the only hand-model history in
this codebase is the bedside build's own earlier attempt, described in `input_marker.js`'s
header as the thing the colour tracker replaced. If hand tracking is wanted as its own switch or
pointer (distinct from the colour tracker, which already works on a hand wearing something
bright), that needs its own seam built first, the same shape as `input_facegesture.js` — not
started, not scoped here.
