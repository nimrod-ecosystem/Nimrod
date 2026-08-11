# Nimrod — locked decisions

A running log so decisions aren't re-litigated or lost. Everything here is reopenable if
there's a real reason, but treat it as settled by default. Dates are when decided.

## Identity & licensing
- **Name:** Nimrod Ecosystem (GitHub org: `nimrod-ecosystem`). Core repo: **Nimrod**
  (the platform — web now, desktop/other apps later). **Cici** = the local AI care
  companion, a first-class product/module on Nimrod, not the platform. (2026-08-09)
- **License:** MIT — free to use/modify/build on, including commercially. The free version
  always exists. License covers code, not the name. (2026-08-09)
- **Copyright holder in LICENSE:** set to the correct name/entity (personal name, or an LLC
  if one is formed later). Placeholder is "Nimrod Ecosystem". _(open — set before launch)_

## Scope & focus
- Public focus is **patient care**: quality of life, recovery, and communication/advocacy
  for TBI, stroke, and other patients — and tools for the families and (later) therapists,
  nurses, and other caregivers who support them. Built to be useful to everyone; wider
  adoption means more people building modules. (2026-08-09)
- **Not selling anything** right now — this is an open-source project. No product
  Kickstarter, no hardware sales. Light GitHub Sponsors possible later; not a driving
  campaign. No medical crowdfunding on the public site. (2026-08-09)
- **3D-printing / physical hardware line is PAUSED** — separate from this site for now.
- Demo videos feature the developer on the bench, not the patient.

## Architecture principles
- **Rebuild from scratch.** Do not copy/scrub the old private codebase. Reimplement clean
  so no private data or addresses live in the code or git history. The old `dashboard_web`
  is a **design reference only**. (2026-08-09)
- **Device-independent / no swaps.** Per-user state lives server-side, tied to the account,
  not to any machine. Open a setup on any device; replace a screen and it returns exactly.
  No machine-specific setup, no "swap" dependency. (This is the whole point.)
- **Privacy boundary = per data, not per name.** Anything touching a patient's private /
  clinical data runs **locally on open-source models**, never a cloud service. Generic help
  (setup, onboarding, "how does X work") **may** use a cloud assistant, and never touches
  patient data.
- **Media is peer-to-peer.** Camera stays on the patient's device; video/audio flow
  directly between devices; the server only brokers signaling. TURN relays *encrypted*
  media when a direct connection isn't possible — the server never sees the video.
- **BYO storage + BYO compute.** Files live in a folder the user owns; the platform
  references them, never hosts or locks them in. AI runs on the user's own machine.

## Platform server & state store (2026-08-10)
First slice built + validated in `web/`. Settles what `architecture.md` had left open:
- **Server = Python + FastAPI** (uvicorn), one language with the rest of the tooling. It's
  the thin coordination layer only — serves the client on the same origin, no media, no AI.
- **State store = SQLite now, Postgres-swappable** behind a two-method `StateStore` interface
  (`web/server/db.py`). One row per `(user_id, module)`; `data` is an opaque JSON blob.
- **Per-user state API:** `GET/PUT /api/state/:module`, keyed to the account. Client keeps an
  in-memory mirror only — **no localStorage/IndexedDB as the store of record** (verified).
- **Identity is a stub with a seam:** `current_user()` returns `dev-user` today, honours an
  `X-Dev-User`/`?user=` override in dev; Google OAuth / kiosk tokens plug in there later with
  no downstream change.
- **Bus** (`web/client/bus.js`) is sources → bindings → sinks; new input methods are new
  sources, nothing downstream touched.
- **Interim cross-device sync = dirty-guarded GET polling** in the client; a stopgap for real
  server push, superseded by the SSE decision below.

## Profiles, storage kinds & server push (2026-08-10)
Second slice built + validated in `web/`.
- **Profiles** are the device-independent container: a user has one or more, each an ordered
  set of module instances. Everything under a profile is ownership-gated (404 otherwise).
- **Module system:** modules register a manifest `{type,title,description}` + factory; the
  runtime mounts each instance with its own scoped bus + own `state`/`events` handles.
- **Two storage kinds, locked in the schema:**
  - **Overwrite state** (config/layout/settings): last-write-wins **with a version** for
    optimistic concurrency — write carries the version it read, server rejects a stale write
    (409), client re-reads + rebases pending keys + retries. No lost update.
  - **APPEND-ONLY events** (event/log/progress/clinical): never overwritten or deleted;
    enforced by **DB triggers**. Removing a module deletes its config but keeps its events.
    This exists specifically to prevent the press-game data-loss class of bug **by design**.
- **Server push = SSE, not WebSocket** (server→client: state-changed, push-to-device,
  presence; client keeps sending changes via the state PUT; WebRTC signaling later rides
  SSE+POST, media stays P2P). **Don't build it speculatively** — implement SSE when the first
  real-time feature needs it (device composer / presence) and retire the interim polling then.

## Default modules & media sources (2026-08-10)
Slice 3 = the four default-dashboard modules (**photos · camera · YouTube · clock**), the
milestone that must land before any funding channel opens. Scoped, not yet built.
- **Build order = sub-slices, easy→hard: clock → camera → photos → youtube**, one validated +
  committed per session (like slices 1–2).
- **Camera = local self-view / rearview mirror ONLY, not a call.** `getUserMedia → <video>`,
  **zero network egress** — this hard-encodes the "camera stays on the patient's device"
  invariant before the later WebRTC-call slice. Config stores a camera *preference* (label),
  with graceful fallback since `deviceId` differs per screen.
- **YouTube:** playlists are **public** video refs → safe in overwrite state (not patient
  data). Use `youtube-nocookie`. Sing-along MVP = a curated karaoke playlist; lyric/caption
  overlay is a fast-follow. Audio arbitration/ducking is out of scope for this slice.
- **Photos media = user-owned, referenced by link — never hosted by the platform, never cloud
  (Drive is non-sensitive assets only).** A **media-source abstraction**: per-user
  `media_sources {id, label, base_url, kind}`; a photos instance references `{sourceId, album}`;
  a client resolver fetches the listing + images straight from the user's origin — **the server
  never sees the bytes.**
- **Decision: build the LOCAL MEDIA AGENT first** (full BYO storage + compute now), not a
  url-list stopgap. The agent is a small **user-run** file server (an optional mode of `server/`
  or a sibling) that serves a chosen folder with a listing endpoint + CORS to the platform
  origin. `base_url` is entered by the user at runtime (localhost on the kiosk; their
  LAN/Tailscale address remotely) — **never committed to the repo.**

## Randomization, storage model & themes (2026-08-10, scoped — not yet built)
Design decisions from the pre-photos planning pass. Build order impact: a shared **weighted
picker** comes just before/with photos; the rest are recorded so they aren't re-litigated.

- **One shared weighted picker** for photos AND youtube, reimplemented clean from the proven old
  engine (`Cici/dashboard_web/modules/yt_select.js` in the private repo — reference only, don't
  copy). Weight = **freshness × recency × duration**, with a **hard-exclusion of the last k plays**,
  and a new **channel/source-diversity** factor (down-weight the channel just played) to kill the
  "run of same-channel videos" problem — including the burst you get right after adding many
  new videos from one channel. Pure + **seed-injectable** (`rand`/`now` passed in) so it's unit-
  testable and, later, seedable for cross-device sync. NOT a shuffle bag (a bag gives refill-runs).
- **Play stats are per-video, GLOBAL across playlists** (already true in the old engine): one
  `{count,last}` per video id, so "weight by how often it's played on *any* playlist" is the
  default. **Play history is stored as append-only events; the counts derive from it** (never lost).
- **Store of record = the platform's server-side per-user store** (slices 1–2): config/playlists/
  themes/game-saves → overwrite state; history → append-only events. This is the "cloud save"
  model. **GitHub Pages only serves the static landing page — it cannot run the server or store
  user data.** The server (FastAPI) runs on a small always-on host (~$5/mo) or self-host; in dev it
  runs on the developer's own machine. Only **tiny text** lives there (KB of config, ~150 B/play) —
  **big media never touches the server** (BYO media agent), so it stays small and cheap (SQLite now,
  Postgres later). **Google Sheets and CSV-to-a-user-folder are OPTIONAL export/sync layers** (human-
  editable playlists, therapist-reviewable data, BYO backup) — never the store of record.
- **Themes are per-PROFILE** (2026-08-10, corrected): a theme belongs to a profile, so visiting
  someone's profile shows *their* theme. Hints at profiles being visitable later (a small social
  dimension). A theme may also attach to a dashboard layout. Own slice, after the four default modules.
- **Cross-device sync (calling)** — sharing the current pick + playhead so both ends watch the same
  thing to talk about it — is the feature that pulls **real-time forward** (WebRTC data channel during
  a call; SSE generally). Its own slice on the call infra; the picker is built seed-ready so this is a
  small add, not a rewrite. Mike sees this as a potential signature feature.
- **Node-editor / state-machine tab** (direction, future): a visual authoring UI over the bus we
  already have — `sources → bindings → sinks` IS a node graph; the youtube daypart schedule is a
  time-trigger node. It would author rules like "at 7pm → playlist X", "button B → switch to Y".

## Media / Sources tab (2026-08-11, scoped — not yet built)
A first-class **settings surface over the per-user `media_sources` registry**: one place that lists
every folder/source the user has connected (local media-agent folders, a Drive folder, …) and lets
them **assign each source to a use** — this folder → photos, that one → interstitial recordings,
another → music. **One connected folder can serve multiple modules;** the tab is where `source → use`
gets wired. Generalizes the existing media-source abstraction (`media_sources {id,label,base_url,kind}`)
into a user-managed surface, and fits BYO storage (the platform references folders, never hosts them).
Modules reference a **source + selector**, not a hard path — consistent with content-as-meaning (folders
are sources the renderer reads). Mike's idea 2026-08-11; reopenable.

## Content as MEANING, not pixels (site-wide, 2026-08-11)
Cross-cutting principle for the **content-library + user-settings schema**, applied across
every module (AAC, vision probe, word games, interstitials, …). Generalizes the pattern the
vision-probe stimuli registry already proves (source-agnostic renderer: photo → img → emoji).

- **Store content as semantic data (meaning), not as rendered pixels/authored art.** A word,
  a prompt, a card, an interstitial subject = its *meaning* + references, not a baked image or
  a pre-rendered frame.
- **Theme / font / colors / Cici character / voice are PER-USER settings the renderer reads at
  render time.** Content carries no styling. Swapping a user's theme or voice re-renders all
  their content with zero per-theme / per-voice re-authoring — theme + voice selection work
  everywhere **for free**.
- **Fall back to recorded / authored media ONLY when a real human voice or a specific image IS
  the content** — e.g. a personal recorded message, or a real photo of a specific person. Those
  are content, not styling, so they're stored as media and are exempt from re-rendering.
- **Implication for the schema:** content items need a first-class **content-type discriminator**
  — _generated/semantic_ (live-rendered + TTS in the user's voice) vs _recorded/authored_ (media
  is the content). This two-track distinction is designed in from the start, not bolted on.
- **Load-bearing dependency:** the "voice works everywhere for free" promise rests on per-user
  local TTS/voice being good enough. Until it is, the recorded-media track is the fallback that
  covers the gap. Voice selection is a per-user setting like theme.
- **Scope: Nimrod site only.** The existing Cici bedside build (`dashboard_web` in the private
  repo) is left as-is — do NOT retrofit this into it.

## Interstitials module (2026-08-11, scoped — sequences AFTER the foundation, NOT now)
Between-video segments: personal messages + educational bits (alphabet/counting/vocab/word games).
Built on the **new Nimrod site**, not the old Cici `dashboard_web` (corrected 2026-08-11 — an
earlier plan wrongly targeted the bedside build; leave that build alone). **Sequences after the
foundation is in place:** profiles + module system + media/storage + theme/voice settings. Full
spec in `docs/modules/interstitials.md`; load-bearing points:

- **Three-quadrant layout + an invariant camera:** media / Cici presenter top-left · subject
  photo + name bottom-left · live-rendered graphic (numeral/letters/word) bottom-right. **Top-right
  is the self-view camera and NEVER changes** — for Christine that rearview "mirror" is her constant
  orientation anchor; never cover it.
- **Two content kinds.** _Generated_ (educational) = semantic data only: BR graphic drawn live in
  the user's theme + audio via **TTS in the user's selected voice** — never pre-rendered, never
  recorded, so a voice change re-speaks everything for free. _Recorded_ (personal) = the real human
  voice + face ARE the content; play as media. Recordings are an **optional enhancement, never
  required** — generic default is TTS + live render.
- **Voice engine = Piper** (local, OSS, runs on a Pi; doubles as Cici's voice). Web Speech API is
  an interim fallback. Voice is a per-user setting.
- **Recording via `R` key** (matches the printable sign for staff/visitors), Cici edits takes
  locally, local STT watches for **three intent cues** — start "message for Christine" (tag+route,
  becomes the lead-in), "restart please" (redo), "never mind delete that" (discard). **Match intent,
  not exact words.** Recordings stored **local-only/private** (may include staff → confidential,
  consent-based).
- **Non-blocking, skippable, never requires input;** short (fatigue), auto-returns to video,
  weighted pick avoiding immediate repeats.
- **Content-gathering can start NOW, independently of the build:** audio Mike already has + greetings
  collected with the sign are portable data the module plays later.

## Reach & hosting
- **Any-network by default** — "open a link and it works." Uses a small always-on host
  (~$5/mo) for presence/signaling + a TURN relay. **Tailscale is optional** (an advanced
  "max privacy / zero-cloud" mode), never required. (2026-08-09)
- **GitHub Pages** hosts the static landing page (`index.html`) for free once enabled.

## Cici — the assistant, two data planes
- **Helper Cici** (onboarding/setup): cloud-OK; can read the **public** repo so answers
  stay current; a non-sensitive cloud store (FAQs, public docs, AAC references). Ends every
  response with the disclaimer in `claude-setup/setup-guide.md`. "Learning" limited to
  non-sensitive / aggregate improvements — never individual patient info.
- **Companion Cici** (anything about a patient): fully local, offline, open-source models.
- Setup is intentionally light (a simple profile shouldn't need much help) — YouTube
  walkthroughs + a modest in-site helper. The downloadable `claude-setup/` pack is the
  stopgap until in-site Cici exists.

## Integrations (planned)
- Home Assistant, Alexa, Google Home. The setup assistant is itself one such integration.
- Docs to integrate other popular AI tools.
- Per-module markdown walkthroughs (`docs/modules/`) so people and their AI tools can
  understand and extend each module.
- **Direct device control through the shared bus** — so a patient can control their own
  environment (lights, thermostat, fan) using whatever input they can.

## Accounts & assets
- **Google:** a dedicated project account anchors YouTube + Drive (non-sensitive assets
  only — never patient data) + the Google OAuth the site's login uses.
- **AAC symbols** are AI-generated (Claude) — no third-party symbol-set license to honor;
  free to ship. (US: purely AI-generated images generally aren't copyrightable, which is
  fine for a free/open project.)

## Community / pre-launch
- Reserve the name across GitHub org, domain, YouTube, Reddit, Discord, and major socials
  **before** going public. Open the community later; nothing needs to be active until
  there's something to show.

## Context (not public-site items)
- Patient is transferring facility-to-facility (not home soon) — caregiver-pay income path
  stays gated; tracked in the private repo / project, not here.
