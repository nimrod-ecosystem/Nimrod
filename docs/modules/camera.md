# Module: camera

> One line: a local self-view / rearview mirror — the patient's own webcam on their own screen,
> never leaving the device.

## Purpose
The original bedside need: a webcam as a rearview mirror so a patient whose head is turned (or who
simply can't see the door) can see the room and who's coming and going. It's reassurance and
orientation, not surveillance — the feed stays on the patient's own machine.

## How it looks / behaves
A live video panel. A gear (⚙) reveals settings: which camera, mirror (horizontal flip — mirror-
like by default), rotation (0/90/180/270° for an oddly-mounted camera), and fit (cover/contain).
If the camera is blocked or missing it shows a clear message ("Camera permission needed" + Retry,
or "No camera found") instead of failing silently. Display-only; no bus input.

## Inputs → outputs (on the bus)
- **Sources / bindings / sinks:** none. The camera neither listens to nor publishes on the bus.

## State & storage
**Overwrite kind** (settings): `{ cameraLabel, mirror, rotation, fit }`, server-side, keyed to
`(user, profile, instance)`, versioned. The chosen camera is stored by **label**, not `deviceId`
— a concrete device id differs per screen, so the preference stays portable and falls back to the
default camera when the labelled one isn't present. In-memory mirror only — **no
`localStorage`/IndexedDB**.

## Privacy notes
**This is the "camera stays on the patient's device" invariant, enforced in code.** The module is
`getUserMedia → <video>` and nothing else: it opens **no `RTCPeerConnection`**, makes **no network
request carrying frames**, and never becomes a source for another device. The only thing that
leaves the module is its small config, via the state round-trip. (A later video-call slice may
*view* a remote camera, but must never repurpose this local one.) Camera tracks are **stopped on
destroy**, so switching away or removing the module releases the device and turns the light off.
Note: `getUserMedia` needs a secure context — fine on `localhost`/kiosk; over a LAN/phone it needs
HTTPS.

## How to extend
- **More adjustments** (zoom/pan, brightness) are new config keys + CSS/track constraints; they
  persist automatically.
- **Do not** add any code path that sends frames off-device. If a future feature needs a remote
  view, that belongs in the call module against its own peer connection — not here.

## Status
**Tested.** Validated 2026-08-10 (stream mocked via a canvas `getUserMedia` for determinism):
stream attaches locally; device list enumerates; mirror/rotation apply as CSS and persist per
profile; a camera change restarts the stream and stops the previous track while pure-CSS changes
do not; graceful permission-denied UI with a working Retry; tracks stopped on destroy; and the
invariant — **`RTCPeerConnection` constructions = 0, network traffic only the state/events
round-trip, no media egress.** Zero console errors.
