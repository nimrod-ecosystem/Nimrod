# Architecture — principles & the client/server boundary

Status: living notes. This is the "how it's built" companion to `../DECISIONS.md`. The
point of writing it early is to keep the old hardware-specific assumptions **out** of the
new codebase.

## The shape

Three layers, with a hard line between what's shared and what's private:

1. **The thin coordination layer (the site / server).** Small and always-on. Handles
   accounts, presence ("who's online"), signaling (pairing two devices for a call),
   per-user state, and the module registry. It is **not** a media server and **not** an
   AI server. This is the piece that lives on a small host (~$5/mo) or a home desktop.

2. **The clients (any device).** The web app, opened in a browser on a phone, tablet, PC,
   Mac, or Raspberry Pi. Clients render the user's dashboard/profile and capture camera/mic
   locally. A client is disposable — all state comes from the account, so any device
   reproduces the same setup.

3. **The private local services (the user's own machine).** Camera capture, recordings,
   the clinical store, and any AI that touches private data (Whisper, local LLM/VLM). These
   never leave the machine and never go to a cloud service.

## Rules that keep it clean (do not violate)

- **Per-user state is server-side, keyed to the account — never per-device, never in
  `localStorage`/IndexedDB as the source of truth.** This is what makes devices
  interchangeable and kills the "swap" problem by construction.
- **The server brokers signaling only.** Video/audio is peer-to-peer between clients
  (WebRTC). A TURN relay passes *encrypted* media through when a direct path is blocked;
  the server still never sees the content.
- **Camera stays on the patient's device.** A client may *view* a remote camera over a
  call; it must never become the camera source for someone else's device.
- **Privacy boundary = per data, not per name.** Private/clinical → local + open-source
  models. Generic/help → may use cloud, never touches private data.
- **No platform-specific plumbing in the app.** Kiosk scripts, systemd units, and
  OS-specific launchers belong (if anywhere) in optional deployment helpers, never baked
  into modules.

## Reach

Default is any-network: a hosted signaling server + TURN so a caller just opens a link.
Tailscale is an **optional** zero-cloud mode, not a requirement.

## The bus

Modules communicate over a shared in-app bus (inputs are *sources*, logic is a *binding*,
outputs are *sinks*). New input methods (switch, scan, gaze, voice, hand/color tracking)
become additional sources with nothing downstream changing. Device control (lights,
thermostat) plugs in as sinks/integrations on the same bus.

## Open questions to settle as we build
- Exact server tech + per-user state store.
- Auth: Google OAuth for visitors; device token / kiosk auth for a patient's own screen.
- The storage-link abstraction (BYO storage) — design early; modules depend on it.
