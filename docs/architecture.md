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

## Server + per-user state — settled 2026-08-10

The first slice (`web/`) is built and validated. What it locks in:

- **Server:** Python + **FastAPI**, run under uvicorn. Chosen to stay one language with
  the rest of the ecosystem's Python tooling. It serves the client app on the same origin
  (no CORS to reason about) and is, by design, *only* the coordination layer — no media,
  no AI.
- **State store:** **SQLite** now, behind a `StateStore` interface (`web/server/db.py`) with
  exactly two methods (`get_state`, `put_state`). A Postgres implementation drops in by
  satisfying that interface; the SQL already uses `INSERT … ON CONFLICT … DO UPDATE`, valid
  in both engines, so the port is mechanical. One row per `(user_id, module)`; `data` is an
  opaque JSON blob the store never interprets.
- **State API:** `GET /api/state/:module` and `PUT /api/state/:module`, keyed to the account.
  The client keeps only an in-memory mirror (`web/client/state.js`): loads the server copy on
  open, writes back debounced. **No `localStorage`/IndexedDB store of record** — verified.
- **Identity seam:** one dependency, `current_user()` (`web/server/identity.py`), returns a
  stubbed `dev-user` today and honours an `X-Dev-User`/`?user=` override in dev so multi-user
  behaviour is testable now. Google OAuth / kiosk tokens plug in *here* later; nothing
  downstream changes.
- **Bus:** implemented in `web/client/bus.js` exactly as described above — sources emit,
  bindings route+reshape onto a topic, modules open sinks. Adding an input method is adding a
  source + binding, with nothing downstream touched (validated with keyboard and switch
  sources driving the counter module unmodified).
- **Interim live-sync:** clients converge across devices by polling `GET` with a dirty-guard.
  This is a stopgap for real server push (SSE) — see below.

> Slice 2 evolved the state store and API from the flat `(user, module)` shape above to
> profile-scoped keys and **two distinct storage kinds**. Details next.

## Profiles, module instances & the two storage kinds — settled 2026-08-10 (slice 2)

- **Profiles** are the device-independent container. A user has one or more (`profiles`
  table); each holds an ordered set of **module instances** (`profile_modules`). Opening a
  profile mounts its instances on any device — this is what "replace a screen and it comes
  back" means concretely. Everything under a profile is ownership-gated: a request for a
  profile you don't own is a 404.
- **Module system:** a module registers a manifest `{type, title, description}` + a factory
  (`web/client/module.js`). The runtime mounts each instance with its **own** scoped bus and
  its **own** per-instance `state`/`events` handles, all released on destroy. Instances are
  keyed by a generated id, so a profile can hold several of the same type.
- **Two storage kinds — locked into the schema on purpose:**
  - **Overwrite state** (config / layout / settings): `state` table, one row per
    `(user, profile, key)`, **last-write-wins with a `version` column** for optimistic
    concurrency. A `PUT` carries the `base_version` it read; a stale write gets **409** + the
    current truth; the client rebases its still-pending keys and retries (`web/client/state.js`)
    — no lost update.
  - **Append-only events** (event / log / progress / clinical): `events` table, immutable.
    Append + read only; **DB triggers abort any UPDATE/DELETE**. Removing a module deletes its
    overwrite state but **leaves its events intact**. This is the by-design guard against the
    class of bug where re-saving config clobbered accumulated activity data.
- **Store is still Postgres-swappable** — standard SQL, `ON CONFLICT … DO UPDATE`, and the
  append-only guarantee expressed as triggers a Postgres port reproduces.

## Open questions to settle as we build
- **Server push = SSE** (decided: SSE, not WebSocket; WebRTC signaling later rides SSE+POST,
  media stays P2P). *Build it when the first real-time feature needs it* (device composer /
  presence), and retire the interim polling then — not speculatively.
- Auth: Google OAuth for visitors; device token / kiosk auth for a patient's own screen
  (the `current_user()` seam is where it lands).
- The storage-link abstraction (BYO storage) — design early; modules depend on it.
