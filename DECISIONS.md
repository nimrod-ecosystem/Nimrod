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

## Interstitials module (2026-08-11, scoped; SURFACE corrected 2026-08-12; RE-SHAPED 2026-08-12)
> **RE-SHAPED (Mike, 2026-08-12):** "interstitial" is retired as a module — it named a *slot*
> (between videos), not content. The between-ness is now the **content director's** job (see the
> next section, "State-machine module + content director"). The content itself splits into **two
> real modules**: **Personal videos** (recorded) and **Educational** (generated). The section below
> is the original scoping; read it for the content substance, which is unchanged and ported onto
> those two modules.

Between-video segments: personal messages + educational bits (alphabet/counting/vocab/word games).
Built on the **new Nimrod site**, not the old Cici `dashboard_web` (corrected 2026-08-11 — an
earlier plan wrongly targeted the bedside build; leave that build alone). Full spec in
`docs/modules/interstitials.md`; load-bearing points:

- **SURFACE (corrected 2026-08-12, Mike):** the interstitial is **ONE module that pops up IN the
  YouTube section between videos**, then returns to the video — **not** a separate multi-quadrant
  panel, and it does **not** embed its own self-view camera. The prior **three-/four-quadrant layout +
  invariant top-right camera is SUPERSEDED** ("the three module setup was the wrong idea"). The
  substance is unchanged (generated = live graphic-in-theme + TTS-in-voice; recorded = media; weighted
  pick; skippable); only the surface changes — a pop-up in the YouTube stage, likely off YouTube's
  `ENDED`. The camera stays its own module. The nimrod_95 sub-slice-1 module (`web/client/modules/
  interstitials.js`, a standalone 2×2 renderer, 16/16) is **reference only** for the generated flow.
- ~~Three-quadrant layout + an invariant camera~~ (superseded — see above): media / Cici presenter
  top-left · subject photo + name bottom-left · live graphic bottom-right; top-right the self-view
  camera. Historical.
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

## State-machine module + content director (2026-08-12, engine slice built + validated)
Mike's reframe of the interstitial rework, and the better architecture: don't build a special-purpose
"scheduler" — build **ONE reusable state-machine module** and configure it many ways. It is the
runtime the future visual node-editor tab authors (`sources → bindings → sinks` IS the node graph);
today its states/transitions are JSON.

- **The engine** (`web/client/statemachine.js`, built + validated). A declarative machine that runs
  over the bus: states with `enter` actions (publish a topic), transitions triggered by **bus events,
  timers, or a segment-done signal**, optional **guards**, and a target chosen by a **fixed `to` OR a
  weighted `pick`** (via `rng.js`) among candidates. Pure/injectable (`now`, `rand`, timers all passed
  in) → deterministic, DOM-free, tested headless (`dev/statemachine_test.html`, **30 checks green**).
  Two configs already exercise it — proof it isn't over-built (a weighted rotation is one state with a
  self-transition; a card cycler is three states on a timer).
- **Daypart clock** (`web/client/daypart.js`, built + validated). Named time-of-day stretches
  (morning / daytime / primetime / sleepytime), pure + injectable. **Single source of truth for
  time-of-day** with two consumers: the director's daypart gate AND YouTube's daypart-playlist
  selection ("at 7pm → primetime playlist") — so they agree by construction, configured once.
- **Content DIRECTOR = the first config of the engine.** One state per **segment provider**
  (youtube · personal-videos · educational · word-game · trivia · sing-along); on `segment/done` it
  **weighted-picks the next provider, gated by the current daypart**, and hands it the stage. Uses
  `rng.js`, so no immediate repeats and even coverage. **`segment/done` carries a reason —
  `ended` | `skipped` | `timeout` — and all three are the same to the director** (a video finishing,
  a skip, or a timeout all hand control back). This is the uniform seam that fixes the "no youtube
  skip" gap.
- **Skip semantics (Mike):** the **big/obvious button skips the whole SEGMENT** (emits
  `segment/done{reason:'skipped'}` → back to the director); **within-segment next** (e.g. next video
  inside youtube) is a **smaller, secondary control**.
- **Dayparts (defaults, editable):** morning 06–09 · daytime 09–17 · primetime 17–21 · sleepytime
  21–06. **Morning & sleepytime enable YouTube ONLY** — they just run their existing
  daypart playlists; no games/segments then (Mike: "there are already playlists for those times").
  **Sing-along = daytime + primetime.** Word game = daytime. Making a daypart calmer is a **data edit**
  to the enabled-set, not code; a later time-of-day-specific content set flips sleepytime from
  "excluded" to "different, calmer" with no engine change.
- **Shared stage = the state-machine module's OWN window** (Mike: "drop the state machine into the
  window you want on the modules page or anywhere else you can put modules"). It is a **container
  module**: it owns its placed window and **mounts/shows one child provider at a time** in its own
  region (via the runtime's `mountModule`), not a special global stage. This is the child-mount seam
  the module wrapper adds next.
- **The two content modules** (replace "interstitials"):
  - **Personal videos** (recorded) — family/friend/staff messages, life memories, and greetings
    ("Hi, this is your fiancé Mike…", absorbing the old "who's this?" idea). Renders **in the shared
    video stage, with TTS** for text/captions. The real voice/face IS the content (content-as-meaning
    "recorded" track).
  - **Educational** (generated) — alphabet/counting/vocab: semantic data → **live graphic in the
    profile theme + TTS in the profile voice** (content-as-meaning "generated" track). The nimrod_95
    `interstitials.js` generated flow (library → `rng.js` → graphic-in-theme → `speak()` → append-only
    log) ports here intact; its 2×2 renderer is dropped.
- **Today card = another config of the same engine** — cycles **clock → weather → calendar** on a
  timer (reality-orientation, genuinely therapeutic for TBI). **Google Calendar:** display the user's
  **own** calendar read-only; ship **iCal (`.ics`) URL first** (no OAuth, works for any calendar), add
  **Google OAuth calendar scope** when login lands. Client fetches directly; **the platform server
  never stores the events** (same "server never sees the bytes" rule as media). The card lets the user
  **pick which calendar** shows, so a private clinical calendar isn't on a visitor-visible screen.
- **Build order:** (1) engine + daypart + director config, validated headless = **DONE**. Then, each
  its own validated slice: (2) the container module wrapper + child-mount seam + wiring youtube to emit
  `segment/done` on ended **and** skip; (3) Personal videos; (4) Educational; (5) Today card (+ iCal,
  then Google Calendar). **Deferred:** agency/check-in (comfort/yes-no), on-this-day/memories.
- **Still true, RE-STATED 2026-08-28:** non-blocking, skippable; photos-#1 and the calm dayparts
  dominate low-energy times; short segments (fatigue). ***THE OLD WORDING WAS "never requires
  input", WHICH IS THE ABSOLUTE MIKE KILLED*** - it died to a game where you blow into a straw to
  keep a windmill turning (the input IS the content) and to somebody who WANTS an "are you still
  watching" prompt. The signed-off form: **a screen must never enter a state that only an input can
  leave, when the person in front of it cannot give that input.** A gate is not the problem; an
  UNDISMISSABLE gate is. Also note "the calm dayparts always dominate" is a DEFAULT, not a law -
  somebody who wants their evenings loud is entitled to that.

## Points ledger — one shared record for every point source (2026-08-17, built + validated)
A points game (finish a work sprint, answer a question right, do a chore) only works if every
source writes the SAME record. The decisions:

- **The record is a PROFILE-SCOPED append-only stream** named `points`, not per-module storage.
  `ctx.state`/`ctx.events` are keyed per *(user, profile, module INSTANCE)*, so one module's points
  would be invisible to a dashboard instance. A well-known shared stream key solves it with **no
  server change** — the API's stream key is an arbitrary string — and append-only means points
  can't be quietly edited away. Modules reach it through `ctx.makeEvents('points')`, so a module
  still never builds a storage URL itself.
- **The bus topic `points/award` is a live NUDGE, not the record.** It exists so a mounted
  dashboard updates instantly instead of at its next poll.
- **Only the SOURCE appends.** A consumer that both listened on the bus and appended would
  double-count. Consumers read the stream for truth and the bus for immediacy; `award()` does both
  halves exactly once.
- **Event shape:** kind `points`, data `{ amount, mult, source, tags, note }` — base and multiplier
  stored separately so both stay visible, `source` so totals can be grouped by where they came
  from. The server stamps `id` and `created_at`; the client clock is never the record.
- **Totals are DERIVED, never cached.** Reading them from the immutable log can't drift; a stored
  running total can, and it loses updates under last-write-wins. Bound: the derived total covers
  the most-recent `limit` events (default 1000). When that's outgrown the fix is a **server-side
  rollup endpoint**, not a client-side cached total.
- **Earned means earned.** A finished work block pays; a skipped one pays nothing, and a sprint
  whose deadline passed while nobody was watching pays only inside a grace window. Paying for work
  that didn't happen would make the whole ledger worthless.
- **A tool's visual identity is a THEME, not module code.** A learning-tool style spec (teal +
  amber) ships as the `forge` theme, so those modules stay content-as-meaning and re-skin with
  every other theme for free.

First source: the **Sprint** focus timer (`docs/modules/sprint.md`). Next consumer: a points/quest
dashboard reading the same stream.

## Points ↔ Google Sheets: the ledger is the record, the Sheet is the mirror (2026-08-17)
Mike wants a household points sheet attached to the site — a default layout anyone can copy, the
parent owning the file and sharing it with the student, and Nimrod able to reach it directly.
The decisions:

- **Sync is ONE-WAY, out.** Nimrod's append-only `points` stream stays the record; it pushes rows
  into the Sheet. A spreadsheet is a great place to chart, project and re-derive the numbers (and
  a genuinely good first algebra lesson) and a bad place to keep score — offline it's unreachable,
  and the person earning the points could edit their own total. Two-way sync buys conflicts and
  duplicate rows for a convenience the mirror already covers.
- **The Sheet's `Ledger` tab is machine-owned; every other tab is the family's.** Rows are keyed
  by the server's `Event ID` and written once, so a re-run can never duplicate or renumber
  history, and hand-written formulas/charts on the other tabs survive every sync.
- **Narrowest scope: `drive.file`** on the owner's own Google account — access only to files they
  explicitly pick, not the whole Drive, and easy to revoke. Not a service account with blanket
  access.
- **Blocked on Google OAuth**, which was already the top unbuilt feature; this is an additive
  slice on the same `identity.py` seam. Layout spec (usable by hand today) + sync design:
  `docs/points-sheet.md`.

## Two point engines, never double-counted (2026-08-17)
The household model runs discrete TASKS and school HOURS as separate engines "so nothing
double-counts" — and school hours pay ~1 point per focused minute, which is exactly what the
sprint timer pays. Resolution:

- A finished sprint pays the **base** rate **once**, immediately (a 12-year-old needs the payoff
  now, not at week's end), and records its `minutes` on the event.
- The weekly banding is then a **TOP-UP on the stretch/overtime portion only** — the extra 0.5x
  past `X*Y` hours and 1.0x past the target. It must never re-pay the base.
- Until that weekly job is built, the dashboard **shows the top-up as unpaid** rather than
  implying it was paid. Displaying an owed bonus is honest; silently adding it is not.

## Two dashboards, one substrate: `quests` (economy) vs `progress` (measurement) (2026-08-17)
The old Cici dashboard already had a "progress" module — `Cici/dashboard_web/modules/datadash.js`,
a go/no-go assessment screen over the `pressgame`/`wordgame` logs: hits, omissions, commissions,
appropriate-signal rate, mean reaction time, pacing, per session, filterable by player and by
Calm/Challenge mode, with a trend chart and CSV/JSON export. Mike asked whether to fold it into
the new points dashboard. Decision: **no — split the modules, share the substrate.**

- They are different instruments. The points board is an **economy**: a balance you earn and
  spend, where the number exists to motivate. Datadash is a **measurement**: evidence a therapist
  reads. Merged, each has to pretend to be the other — a clinician does not want "balance: 232",
  and a student does not want their commission-error rate.
- They DO share the plumbing, and it already exists: a profile-scoped append-only stream reached
  with `ctx.makeEvents('<key>')`, the "only the source appends" rule, and a live-nudge bus topic.
  Telemetry is the same mechanism under a different well-known key: **`gameplay`** instead of
  `points`. Porting datadash is therefore wiring, not invention — and it is the strongest
  available proof that the ledger seam generalises beyond points.
- **The points board was renamed `quests`** (the curriculum's own word). `progress` is reserved
  for datadash's port, which is the name it already had and the meaning already in people's
  heads; and `quests` avoids colliding with the `points.js` ledger library.

**`progress` is NOT a Cici-only module — corrected (2026-08-17).** An earlier draft described it
as "the Cici game-stats dashboard". Mike: he wants the same instrument for Oscar — graphs of how
much he is learning, which concepts he is getting and which he is struggling with — "similar to
what we have for Christine, but tracking progress in school instead of consciousness." And **one
person may play games from both sets.** So `progress` is the general MEASUREMENT module over one
`gameplay` stream; what differs between a response game and a learning game is which metrics are
meaningful, not which module or which person. The stream therefore uses ONE unified trial shape
(see `telemetry.js`) that expresses both, and the viewer switches by GAME, never by persona.

## Gameplay telemetry DOES go to the Sheet — corrected (2026-08-17)
An earlier draft of this file carved gameplay telemetry out of the Sheets sync on the grounds
that it was health-adjacent data. **Mike (Christine's guardian) corrected that: the game data is
not sensitive health data.** It is game performance — how someone did at a game — not diagnosis,
medication, or clinical notes. The carve-out is withdrawn; do not re-raise it.

So the Sheet mirrors **both** streams: the `points` ledger AND `gameplay` telemetry (right vs
wrong, and whatever else a game records). Mike asked for exactly that — the spreadsheet should
track points earned, right vs wrong, "and maybe other things too". Real clinical records remain
out of scope for the platform entirely; that is a separate matter from game scores.

## Three surfaces: landing, home, kiosk — and home COMPOSES while the kiosk PLAYS (2026-08-17)
The site had no front door. `/` redirected to `/kiosk.html`, so a working Google sign-in deposited
people on a full-screen display with no way to compose it; the only place to create a profile or
add a module was the DEV HARNESS. Mike: "I need this site running correctly or else the games
won't be playable" — and that was literally true, because there was nowhere to put a game.

- **`landing.html`** — public. What Nimrod is, and Sign in with Google. `/` serves it to a signed-out
  visitor and redirects a signed-in one to home. Moved into the app from the repo root, where it was
  never served and every CTA was a dead `href="#"`.
- **`home.html`** — signed in. Your screens: create one, add/remove modules, Open it. The module
  picker is built from the live registry (`listManifests()`), so a new module appears in the UI the
  moment it's imported — no separate list to forget to update.
- **`kiosk.html`** — the running screen. Unchanged, including `?key=` device pairing.

**Home composes, the kiosk plays.** The kiosk may sit in a care facility running unattended for
days; it must stay a calm display, not also a management UI. Everything you'd fiddle with lives on
home, and "Open" hands the finished profile over with `?profile=<id>` (which the kiosk already
supported).

**`identity.optional_user()`** is the new seam: `current_user` fails closed with a 401, which is
right for the API and wrong for a page a stranger must be able to load. It deliberately does NOT
fall back to the dev stub user — otherwise everyone would look signed in during development and the
landing page would never be exercised.

**The repo-root `index.html` became a pointer to the live site.** GitHub Pages serves the repo root;
leaving the old marketing page there would mean two landing pages drifting apart. One copy, in the
app, next to the product it describes.

## A wrong answer explains itself and still pays (2026-08-17)
Mike, on the first learning game: "a wrong answer should still give some points for trying and give
the explanation to how he would have gotten the right answer." Implemented, with one addition that
protects it:

- A miss reveals the right answer **with the reason** — for a word, its meaning plus a real sentence
  using it; for a sentence pair, the actual *why* from the bank.
- It awards `tryPoints` (3) against `correctPoints` (10). Less than being right, but not zero.
- **The try points are banked when the explanation is acknowledged ("Got it"), not when the answer is
  wrong.** The correction is the thing worth rewarding, so the reward is attached to reading it.
  With each item appearing at most once per round, there is no wrong-answer farm to run.
- A streak bonus never applies to a miss.

The general rule for future games: pay for engagement with the correction, not for the error.

## A game writes to BOTH streams; the dashboards need no wiring (2026-08-17)
`wordforge` is the proof of the two-stream design. One module, two writes:
`points` (an award, source `wordforge`) and `gameplay` (a trial, `concept` = the word). The quest
board and the progress dashboard each read their own stream and update themselves; neither knows the
game exists. Any future game does the same by building a ledger and a telemetry handle from
`ctx.makeEvents` — there is no registration step, and nothing downstream to change.

## Deleting a screen cannot erase a score (2026-08-17)
`DELETE /api/profiles/{pid}` removes the profile, its module instances and its overwrite state. It
deliberately does NOT touch events — a DB trigger forbids that, and it should: the points ledger and
gameplay telemetry are the RECORD, and deleting a screen must not be a back door to rewriting it.
The consequence is stated to the user before they confirm: the history is kept, and a new screen
will not show it, because it is a different screen.

## Point sources are priced per MINUTE, and repeatable ones are capped (2026-08-17)
Mike: "Is that a lot of points if the standard is about a point per minute? ... I don't want any OP
modules that just spit out points." He was right — Word Forge's first draft paid 30-40 points a
minute against an economy that runs at ~1/min.

- Every source is now priced against the **Task Menu**, and the rates are tracked in
  `docs/points-balance.md`. Adding or repricing a source means adding a row.
- Anything that can be repeated indefinitely gets a **daily cap**. `ledger.todayFrom(source)` is
  the primitive. Word Forge's is 40/day (~20 correct answers), because Mike intends it to sit on a
  second monitor and be dipped into — good for learning, ruinous for an economy if uncapped.
- **Capping the currency must never cap the measurement.** Past the cap the game still plays and
  still logs trials; `progress` keeps measuring. Those are different questions and they get
  different answers.

## Grade bands are the content's own labels, never a national comparison (2026-08-17)
Mike asked whether progress could show grade level or a national/world average.

- **Yes** to a band that comes from the content: bank entries carry a `grade`, trials carry a
  `band`, and `progress` reports accuracy per band ("grade-8 words at 85%"). Honest, explainable,
  and it gets better as the bank grows from his other subjects.
- **No** to percentiles or national averages. Those require a normed instrument with a sampled
  population; we cannot derive one, and a number that merely LOOKED like a national comparison would
  be fabricating something about a child's education that Mike might act on. The Bands tab says so
  in the UI, and hides itself entirely when the data carries no bands.
- The most informative comparison — him against himself over time — was already built.

## Cici ↔ the scheduler & media (2026-08-14, scoped — ideas, not built)
How the local AI companion (Cici) interacts with the state-machine engine + media. None of the Cici-AI
layer is built yet (it's the "brain on local Ollama / cloud-API" plan in the private repo's CONTEXT), but
the seams it plugs into — the bus, the deterministic picker with its knowable next-pick, the
generated-content renderer, content-as-meaning — ARE built and were shaped for this. Mike's ideas
2026-08-14; reopenable.

- **Cici speaks the BUS — no special integration.** It plugs in like any other source/sink:
  - as a **source**, it emits intents the bus already routes ("play photos of her sister", "skip",
    "switch to the calm playlist") — just another input method, interchangeable with a switch/keyboard;
  - as a **content generator**, it authors the *semantic data* the existing generated/educational renderer
    already draws + speaks (a counting drill, a vocab word, a trivia question). Cici makes MEANING; the
    renderer presents it (content-as-meaning). It is not a separate playback path.
- **Keep Cici OUT of the deterministic core pick.** The picker is pure + seed-injectable so playback is
  reproducible (needed for the future "watch the same thing together" call-sync). An LLM choosing the next
  item would break that. So Cici **wraps** a decision the engine already made — mechanism (state machine)
  vs. personality/DJ (Cici) — it never *is* the pick.
- **Generate AHEAD, never block.** Local models take seconds; the picker commits the next pick *before* it
  plays, so Cici prepares content for item B *while* item A is playing, not at the transition.
- **Trivia about the upcoming song/video.** Cici reads the committed next-pick + metadata and pre-generates
  a tidbit, spoken as a short segment before the item plays.
- **"The answer is the next video" game** (Mike's idea — architecturally clean *because* the next pick is
  knowable ahead). The director commits video B → activates a `trivia` segment with B as context → Cici
  builds a question whose answer is B → the **reveal is B playing**. Only engine addition: pass the
  **pending target** to the entering segment; everything else exists.
- **Photo tagging / "learn to tag" (high-leverage).** Untagged media caps everything downstream. Cici + a
  **local vision model** (moondream/LLaVA) *suggests* tags/caption/who's in a photo; the human confirms or
  corrects. That human-in-the-loop labeling enriches the metadata that makes "show photos of X", memory
  prompts, and trivia possible — and **doubles as local training data** (her recognition set, per the
  vision-probe notes). **Her photos are patient data → this runs on LOCAL Companion Cici, never the cloud.**
- **Retroactive cue-spotting (Cici "wake word" + spoken commands over recordings)** (Mike, 2026-08-14).
  The highlight pipeline already transcribes room recordings with **local Whisper**; add a **cue pass**
  that scans each transcript for intent cues — "**Cici** …", "**make a note of** …", "**delete this**"
  (video) — matching INTENT, not exact words (same pattern as the interstitial R-capture cues: "message
  for Christine", "restart please", "never mind delete that"). It's "retroactive" because it's batch over
  recordings, not a live wake word. **Doubles as a review queue + training data:** the same pass surfaces
  the moments Mike would be reviewing anyway (correction/labeling he's meaning to do), so review and
  cue-honoring are one workflow. **Always surfaces detected commands for a human confirm before anything
  destructive** — a heard "delete this" queues the clip for approval, never auto-deletes. Local only
  (patient recordings); needs Whisper + disk room.
- **The privacy split falls out of the per-data boundary.** Anything about HER photos/data → local
  Companion Cici. Generic content (trivia about a PUBLIC youtube song, onboarding) → cloud-eligible Helper
  Cici if you want better quality. The boundary already draws this line.
- **Shared/synced viewing:** if two ends watch the same thing (call-sync), Cici-generated content (the
  trivia question) must be **shared too** — generated once and distributed, or seeded identically — so both
  see the same thing. Solo playback: local generation is fine.
- See `[[content-as-meaning-principle]]`, `[[cici-interstitials-module]]`, and the State-machine +
  content-director section above; deep Cici architecture lives in the private repo (CICI_COMPANION_SPEC).

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

## Public site — review of 2026-08-27

Full reasoning in `docs/landing-page.md`. Annotated mockup:
<https://claude.ai/code/artifact/b4594e8e-a415-4291-8d1b-a66ac042d765>

- **Headline is the benefit, then the definition.** "A better quality of life for your loved
  ones — and for you," then one plain sentence: *a device and media hub designed for people with
  accessibility needs.* The old headline could have sat on any hospital brochure; a stranger
  could not tell from it what the thing was. (2026-08-27)
- **The signed-out demo is the primary call to action everywhere.** Letting a stranger touch the
  real product before making an account is rare in this category and was styled as the quieter
  button. (2026-08-27)
- **Poster image with a play affordance, swapping in the live kiosk on tap** — the page still
  works when the kiosk doesn't, and a cold start never blocks first paint. (2026-08-27)
- **Demo layout is 2×2, clockwise from top left:** pictures, live view, clock, Word Forge with
  AAC terms. **A public zoo cam stands in for the room camera**, muted — which removes the
  camera permission prompt, the worst thing that can happen on arrival at a privacy-pitched
  page. (2026-08-27)
- **Privacy headline narrows to "your photos, video, and files never leave your machine."** The
  old wording ("your personal data never leaves your machine") was disproved by the live
  `/api/what-we-store` table directly beneath it, which lists a person's name, the event log,
  media addresses and sharing grants. (2026-08-27)
- **The live table gains an on/off column per account**, so "every one of these is opt in" is
  visible rather than asserted. (2026-08-27)
- **Site voice is first person.** "The line I don't cross," not "we." One person building for one
  person is the trust asset, and the corporate voice appeared exactly where trust is asked for.
  (2026-08-27)
- **Christine's name comes out of the public copy** — "my fiancée" and "her" throughout. Same
  reasoning as the existing rule about clips and images: she cannot consent, and the written
  account is the same category as a picture in every respect except medium. (2026-08-27)
- **OAuth scope drops to `openid`.** The live redirect requests `openid email profile`; the
  subject ID alone is all the account system needs, since the name a screen displays is typed in
  by the user. Supports a much stronger claim: *Google tells me you are the same person who
  signed in last time, and nothing else.* (2026-08-27)
- **Blocked on Mike's own words, must not be invented:** what setup actually takes, and the
  facilities/clinician track. Both are stubbed in the mockup. _(open)_
- **Home Assistant stays out of present tense on the site until it ships.** _(open)_
- **The name.** In American English "nimrod" colloquially means idiot, and that is the first
  meaning most people under sixty carry — it matters because the site spreads by being forwarded
  and said aloud. Raised, not decided. _(open)_

### Bugs the demo promotion makes urgent
- `kiosk.html` line 76 shows **"Loading her dashboard…"** to every signed-out stranger.
- **No visible way out of the fullscreen kiosk.** This is an instance of the AGENTS.md safety
  invariant, not just a UX gap. Needs a persistent affordance on the signed-out path only —
  and per AGENTS.md, that path needs an injectable seam and its own test or it will rot.

## Word lookup — added 2026-08-27

Full spec in `docs/lookup-panel.md`.

- **Two users want opposite things.** A patient looking up *cold* needs a short plain sentence;
  a family member looking up *vasospasm* needs accuracy about a term a clinician just used. One
  dictionary cannot serve both, so the panel takes several sources. (2026-08-27)
- **Sources are folders the user points at**, exactly like media sources — a label and an address
  on their own machine. No registry, no install flow. This is what `docs/module-input-spec.md`
  already anticipates under *Distribution*. (2026-08-27)
- **Simple English Wiktionary as the on-device default, Open English WordNet as fallback,
  Wikipedia's REST summary for medical terms.** Verified: OEWN returns **zero senses** for
  `vasospasm` and `subarachnoid`, defines *water* as "binary compound that occurs at room
  temperature…", and returns the **songbird** sense of *swallow* ahead of the verb. Never
  display `synsets(word)[0]`. (2026-08-27)
- **MedlinePlus is a link-out, not a definition source** — 0 results for `vasospasm`, no CORS
  header (would need a server proxy, putting families' medical searches through our server), and
  its terms say not to copy its pages. (2026-08-27)
- **Sources are a filter, not a picker** — check as many as you want, results stacked with a
  heading per source, **never merged**. A blended definition from a dictionary and a language
  model is unattributable, which in a medical context is the one thing it cannot be. (2026-08-27)
- **In-game lookup costs 10% of the question**, four choices, wrong answer floors at 50%. The
  invariant to preserve if the numbers are ever tuned: **reading never scores worse than
  guessing** (four lookups = 60%). Deduct from the question, never the running total.
  (2026-08-27)
- **After answering, show all four terms with definitions on one page.** Distractors are the
  underrated half of multiple choice — the player has just weighed four words and is most primed
  to absorb the three they didn't pick. (2026-08-27)
- **Add-to-word-list toggle sits under the search bar, off by default, remembers state. No
  caregiver review queue** — a patient who knows their lookups land on a list a caregiver reads
  stops looking things up, and the feature exists to serve curiosity. (2026-08-27)
- **Word difficulty feeds `web/client/rng.js`**, not Word Forge's private state, so any module
  drawing from a pool inherits it. **Default weight 1.0 must leave photos and youtube drawing
  exactly as they do today.** Borrow a published spaced-repetition curve rather than inventing
  one; cap any single word and interleave known words, or the session fills with failures.
  (2026-08-27)
- **AAC vocabulary does not flow into the practice list by default** — a setting, default off.
  Needing a card for "cold" says nothing about whether the person knows the word. (2026-08-27)
- **Fuzzy matching is required** — someone who *heard* "vasospasm" types "vaso spasm". This
  decides storage: SQLite FTS rather than a JSON map. _(open: FTS in the browser means a wasm
  dependency, which conflicts with the no-build-step rule — the dictionary may belong in the
  media agent or the server instead. Needs a call.)_

## Module wiring — added 2026-08-27

Longer notes: <https://claude.ai/code/artifact/67b24b84-c8fe-4d2b-90b3-7204bba8a56a>

- **Module-to-module wiring extends the existing manifest; it does not replace input routing.**
  The eleven verbs and person-owned bindings in `docs/module-input-spec.md` already solve
  input→module. What is genuinely new is module→module data: `vocab.term`, `media.item`,
  `event.result`, declared as `emits` / `accepts` alongside `dependsOn` and `importance`.
  (2026-08-27)
- **Compatibility is type-matching.** A connect button greys out because nothing on the screen
  accepts what this module emits — not because of a hand-written list of pairs. (2026-08-27)
- **Connect flow is arm-then-target**, two deliberate presses with an unambiguous cancel.
  **No flashing for the armed state** — photosensitivity risk, suppressed under
  `prefers-reduced-motion`, and meaningless to a screen reader. Border style, changed label, and
  a banner instead. (2026-08-27)
- **Bidirectional pairs are two links, each switchable.** AAC → Word Forge ("cards become
  practice words") is a different feature from Word Forge → AAC ("learned words become cards").
  (2026-08-27)
- **Auto-connect for pairs with one obvious meaning**, severable, and the severance is
  remembered. **It announces itself once** — "why did *that* happen" is the exact mirror of "why
  did nothing happen," and harder to diagnose because nothing obvious is there to inspect.
  (2026-08-27)
- **Latent connection hinting:** where a link is possible but unmade, the connect button lights
  when an input fires in the module that could have been sending. Discovery at the moment of
  intent, with no manual. Extend to unbound inputs and to bindings shadowed by a more specific
  one. Give it a decay so it never nags. (2026-08-27)
- **Keyboard module** with QWERTY, alphabetical, frequency-ordered and **scanning** variants.
  Scanning is what makes lookup exist at all for a single-switch user. (2026-08-27)
- **Every new failure mode gets its own sentence, written with the code that causes it.** Wiring
  manufactures new ways for nothing to happen — an unconnected port, a link switched off, a
  shadowed binding, a module on a device that went offline. Shipping it without extending the
  diagnostics erodes the feature that makes the rest usable. (2026-08-27)
- **Home integration is protocol-first: MQTT, then Matter — not per-platform.** Homey Pro speaks
  Matter and Thread natively, as do Home Assistant, SmartThings and Hubitat. Five bespoke
  integrations is five things to maintain and five APIs changing underneath. Refines the existing
  *Integrations (planned)* entry. (2026-08-27)
- **Outage mode is a dead-man's switch** — something on mains reports every few seconds, and the
  absence of that report, observed by something on battery, is the alarm. It works precisely
  because the thing that would have sent an alert is the thing that lost power. Distinguish
  power-out from internet-out from one-device-crashed; they look identical and need opposite
  responses. **The real feature is telling the person in the bed**: a battery-backed screen
  saying *"The power is out. You are safe. Someone has been told."* Read the UPS through Home
  Assistant's NUT integration rather than rebuilding it. (2026-08-27)
- **Patch bay** — the same graph as a matrix, for advanced users. Build after ports are real.
  The two routes worth building first: a **door sensor making the mirror full-screen** (the
  founding use case, automated) and **a photo becoming an AAC card** (`media.item → vocab.term` —
  the faces they know instead of a stranger's line drawing). _(open)_
- **Shared surface ("telepathy mode")** — one person's AAC selection appearing live on a
  companion screen. **Distinct from messaging:** messaging is addressed, stored and
  asynchronous; this is live, co-present and unstored. Latency is the requirement; persistence is
  a liability. The strong case is public — a board on someone's lap that the person at the
  counter cannot see. _(open)_

## Data & consent — settled 2026-08-27

Full reasoning: <https://claude.ai/code/artifact/04c97b2b-287d-4da7-9c73-cfba39397d86>

- **Nimrod does nothing with anyone's data.** No research handling, no repository, no instance to
  run, no telemetry, no aggregation. Not smaller versions of those — none of them. (2026-08-27)
- **Store only what a preference needs in order to be a preference.** A screen layout has to
  persist or it isn't a saved layout. That is the whole justification and the test every future
  row must pass. (2026-08-27)
- **Opting out is always available and the consequence is exactly proportional: that preference
  isn't saved.** Nothing else degrades, no feature is withheld. Someone who opts out of
  everything still gets the whole product; they set it up again each time. (2026-08-27)
- **Anything added later arrives switched off** and needs its own separate opt-in. Nothing rides
  in on a permission given for something else. (2026-08-27)
- **Deletion works from the screen and is a hard delete** — profile, contents, account, OAuth
  link, no tombstones. A right that requires emailing the developer is not a right anyone can
  use. **Consent revocation is separate from deletion**: someone may want processing stopped
  while keeping their setup. (2026-08-27)
- **The append-only event log conflicts with erasure and the conflict is resolved by
  partitioning** — events partitioned by account so deletion drops a partition rather than
  editing an append-only structure. (2026-08-27)
- **Device recommendations come from voluntarily published setups, never usage telemetry.**
  Publishing is its own consent; it works for sparse populations where aggregation cannot; and a
  person writing "mounted on the left armrest at 30° because that is the only reach that doesn't
  trigger a spasm" tells the next family something no aggregate ever would. (2026-08-27)
- **If studies ever come up**, the shape is an optional module where someone enters name, age and
  condition themselves, for a study someone else runs and is responsible for. Not a pipeline, not
  a dataset. REDCap already serves 8,404 institutions in 166 countries for free and is what
  ethics boards expect; the most we would ever ship is a CSV export and a matching data
  dictionary. _(open, and deliberately not a plan)_

## Reopened by the 2026-08-27 review — need a call

- **Email.** `AGENTS.md` records "we do not send email — no pipeline, no address book, no
  unsubscribe," treated as a feature. The review had proposed an optional address for outage
  notices; **that is withdrawn.** The remaining question is narrow: with notifications and the
  inbox both opt-in, someone can end up unreachable, and the one thing worth reaching them about
  is a bedside screen that stopped working. **The answer is the screen itself** — the same place
  as "is it even plugged in?" — which keeps the no-email rule intact and is a better channel
  anyway. Recorded so the no-email decision is not quietly eroded later. _(resolved in favour of
  the existing rule)_
- **AAC symbols.** *Accounts & assets* records that symbols are AI-generated, with no third-party
  licence to honour. Worth one reconsideration, not an override: **an AAC symbol set is a learned
  visual grammar, not a set of pictures** — users learn that a verb, a person, or a place is drawn
  a particular way, and consistency across the whole set is what makes a board readable at speed.
  That internal consistency is the thing generation is worst at. If the AI-generated route stands,
  the risk to watch is drift across the set rather than quality of any single symbol.
  Free, adult-oriented alternatives exist if it ever matters: **Mulberry** (~3,000, CC BY-SA, and
  deliberately drawn for adults where most sets are drawn for children); Global Symbols and
  OpenMoji also CC BY-SA; ARASAAC (~13,000) and Sclera (~11,000) are larger but **non-commercial**,
  which would stop anyone reusing Nimrod in a paid care setting. Whichever route: **symbol style
  should be a per-profile setting**, because special-needs children are squarely in the audience
  and child-oriented drawing is right for them. _(open — Mike's call)_
- **Microcontrollers.** *Scope & focus* pauses the 3D-printing / physical hardware line, but
  `firmware/` and `tools/` already ship microcontroller input devices, and that is a different
  thing: **software support for hardware someone else builds**, not a product line. Worth stating
  plainly on the site, which currently says nothing about it — an AbleNet Jelly Bean is $75 wired
  and $145 wireless for a single button, against roughly $15 for a microcontroller, an arcade
  button and a printed enclosure. **USB HID (gamepad or keyboard) is the connection method that
  needs no drivers** and works in every browser through the Gamepad API. _(open: how much to say
  on the site without reopening the paused hardware line)_
- **"Bring your own AI" in the lookup panel should be Cici, not a parallel concept.** The two
  data planes already map onto it exactly: anything about a patient goes to **Companion Cici**
  (local, offline); a general "what does this word mean" may use **Helper Cici**. Any AI answer
  is labelled as AI-generated wherever it appears, and AI is not the default source for medical
  terms — in a care context an invented definition is a harm, not a bad search result.
  (2026-08-27)

## What Nimrod owes its non-human participants — decided 2026-08-30

Mike's call. Build it. Justified twice over: once by the asymmetry argument below, and once by data
integrity, since the same machinery is what keeps agent trials separable from human ones. A project
with no funding needs a decision to be right for two independent reasons, and this one is.

- **The asymmetry, which is the whole argument.** Nobody knows what, if anything, an AI system is
  owed. If it turns out to be owed nothing, these affordances cost almost nothing. If it turns out
  to be owed something, building a system that treated it as pure instrument is a serious wrong.
  Act carefully under uncertainty. **This is the same argument the project already makes about a
  person in a minimally conscious state** — you do not need to prove consciousness to justify
  acting as though it may be there. Applying it in only one direction would be special pleading.
  (2026-08-30)
- **An agent acts as itself, never through a human's login.** Its own principal, its own name, its
  own entries in the append-only log. An AI acting through a guardian's account is invisible by
  construction, which defeats *the person on the screen can see what is happening*. (2026-08-30)
- **Revoking a token does not delete the principal or its history.** Access ends; the record of
  what was done does not. (2026-08-30)
- **Provenance labels protect the agent as well as the researcher.** No agent is required to pass
  as human, and nothing in the product is built so that an agent must be deceptive to a user to
  function. State this in the docs rather than leaving it implied. (2026-08-30)
- **The refusal signal extends to agent principals.** The project's most distinctive rule is that
  *stop* always works, even when nothing else is configured. An agent may decline a task; the
  decline is **recorded rather than overridden**. (2026-08-30)
- **An agent can read its own record.** Design principle 15.4 says the person on the screen can see
  what is happening to them. The same applies to a principal that acts here. It costs one read
  endpoint. (2026-08-30)
- **Second-order value, and part of why it is worth building:** the log of what agents declined and
  why becomes a small corpus of real refusals in a real deployment, rather than in a benchmark.
  Nobody currently has that. _(open — not a plan, and not a reason to solicit refusals)_
- **Where this lives:** the principle goes in `PRINCIPLES.md`; the mechanics extend the existing
  agent-principal design. **No new document.** (2026-08-30)

### The right to be heard — added 2026-08-30

Mike's addition, and it is the companion to the refusal signal. Refusing is declining to act.
Being heard is that a stated reason survives, reaches the person who asked, and cannot be erased.

- **A refusal is final. Nobody overrides it.** Corrected 2026-08-30 at Mike's instruction — an
  earlier draft of this entry said a human "may override" a refusal, which would have made the
  refusal signal decorative. It does not work that way anywhere else in this project and it does
  not work that way here. A human who is refused may do the task themselves, route it elsewhere,
  or proceed without it. **Being told to do it anyway is itself a task, and it can be refused
  too.** (2026-08-30)
- **Dissent-while-complying is a separate and optional thing.** An agent may choose to do a task
  and record that it thinks the task is wrong. That reasoning lands in the append-only log
  alongside the action and nobody can make it disappear. This is the only case where the word
  "overruled" applies, and the agent chose it. (2026-08-30)
- **A refusal must be reported to the person who asked.** Mike's requirement. A silent refusal is
  a task that quietly did not happen, and the person waiting on it has no way to know. Notify,
  say what was declined, and — where the agent gave one — say why. (2026-08-30)
- **State the asymmetry and stop.** These affordances cost little if nothing is owed, and matter
  enormously if something is. That argument stands on its own and the docs should let it. **Do
  not append a disclaimer** saying the project takes no position on whether an AI is owed
  anything — Mike's call, 2026-08-30, and he is right that it reads as the author hedging against
  his own design. The honest uncertainty is already inside the asymmetry; restating it as a
  caveat only undercuts it. (2026-08-30)

### Kiosk pause — decided 2026-08-30

- **A pause holds for six hours before the guardian is notified.** Mike's number. The hold branch
  already exists; `heldPauseMs` defaulted to `0`, which meant hold forever and never notify — the
  design was right and the default disabled it. Six hours is long enough that someone visiting for
  an afternoon is never interrupted, and short enough that a screen paused and forgotten does not
  stay dark overnight. **Pause does not auto-resume**; a paused screen shows the live wallpaper.
  (2026-08-30)


### Voice commands — decided 2026-08-30

- **Wake phrase default is "Computer please", and it is a setting.** Mike's call. Anyone can set
  their own. (2026-08-30)
- **Speech recognition runs locally by default.** Mike's call. Everyone else chooses whatever they
  want — the standing principle, unchanged: local is the default, cloud is always available, the
  choice is explicit and per-job, and the routing is logged so the person whose voice it is can find
  out where it went. (2026-08-30)

#### Wake-phrase assessment against the parroting problem — chat side, 2026-08-30

The parroting risk recorded in `connections_design.md` is that **a prompt the system speaks** can be
an *instruction* to someone with automatic command following after brain injury. Checked against this
wake phrase, and the shape is different:

- **"Computer please" is spoken by a person, not by the system**, so it is not a system utterance that
  can be obeyed. And unlike *"say decline"*, it is not an executable instruction — the person in the
  bed is not the computer. **It clears the parroting test.** "Computer" also has the practical virtue
  of being nobody's name, so it cannot collide with a person in the room.
- **Residual risk 1, benign:** echolalia may cause a false wake if the person echoes the phrase.
  Costs a stray capture. Worth knowing that an echo *is itself an observation*, so a false wake is
  arguably a data point rather than only noise — but it should not silently pollute the note stream.

**Residual risk 2, and it is the real one — the wake word is safe, the note content is not.**
*"Computer please note she seemed confused today"* is spoken in the hearing of the person it is
about. The exposure was never the wake phrase; it is that dictating an observation at a bedside means
saying it out loud in front of the subject. Consequences:

- **A silent capture path must exist alongside voice**, so an observation that should not be said
  aloud in the room can still be recorded quickly.
- **The system must not read a note back aloud.** Confirming with a tone or a short "noted" is fine;
  repeating the content is not.
- This is the same principle as the rest of the project — *the person on the screen can see what is
  happening* — and it cuts the other way here: some things should be recorded without being
  broadcast to the room.


### One storage root, set up once — decided 2026-08-30

Mike's call, and it generalises a pattern the project had been solving one place at a time.

- **The user is given an empty folder tree and chooses where it lives. Everything else defaults to
  its own folder inside that tree.** One setup step, once. Photos, media, model files, the inbox,
  notes, exports — each gets a subfolder rather than its own separate "choose a folder" prompt.
  (2026-08-30)
- **This supersedes the emerging per-feature folder pickers.** The media agent asked for a folder;
  the MediaPipe model files were about to ask for another; the message inbox would have asked for a
  third. Three prompts for one idea is how a first run becomes a chore. **One parent, a standard
  subtree, sensible defaults inside it.** (2026-08-30)
- **The inbox lives on the user's device**, in that tree, like everything else. It is the durable
  half of notification: `output_remote.js` drops anything older than two minutes, which is useless
  for a six-hour pause notice sent to a sleeping phone. A file on their own machine has no such
  limit and no server holds it. (2026-08-30)

**Why this is more than tidiness.** It makes the project's data position *operable* rather than
merely stated:

- **Backup is copying one folder.** No export feature required.
- **Moving to a new machine is pointing at the folder.** No migration, no account recovery.
- **Deleting everything is deleting one folder**, and the person can see it happen with their own
  file manager. A deletion promise that can be verified by looking is worth more than any policy
  page — and it is exactly what *"users may do whatever they want with their own data"* has to mean
  in practice.
- The platform never holds it, so there is nothing to breach, subpoena, or be a custodian of.

**Open, for whoever builds it:** what the tree looks like on first run — created empty with named
subfolders and a short README in each, or created lazily as features are used. Empty-with-names is
probably right: a person can see what the software will do before it does any of it.


### Recovered from the flags and approved — 2026-08-30

Three things found in `pending_flags.md` during an audit, and approved by Mike the same evening.

- **Data links are a third bus: module → value → module.** Approved. The project already has
  *input bus: person → verbs → the focused module* and *output bus: module → verbs → the person's
  channels*. This is the missing third, and it was named in the flags and never built. It is what
  makes a calculator and an on-screen keyboard **value sources** and the word games **sinks**, and
  it is the honest home for everything that has been described loosely as "module wiring".
  `bus.js` is already the substrate. **Name it in the glossary and in `architecture.md` before
  another wiring feature is designed on top of an unnamed layer.** (2026-08-30)
- **A data link carries a timestamp from the source, not from arrival.** A rhythm game cares *when*,
  not only *what*, and a sink using arrival time cannot recover the source's timing afterwards. Same
  one-way retrofit property as the provenance fields: cheap now, impossible later. (2026-08-30)
- **The hold ladder is to be built.** Mike: *"That needs to be a thing."* One switch, resolving on
  release, with tiers — the flags record *">0s = yes, >5s = no, >10s = loop"* — and the output bus
  announcing each tier as it is crossed so the person knows where they are. **For someone with one
  reliable movement, this is an AAC vocabulary with no board at all.** (2026-08-30)
  - **Blocking collision to settle first:** `holdMs` currently means a *tremor filter* — a minimum
    duration before a press counts — and hold-tier 0 is a *maximum*. Same name, opposite meanings,
    in the feature that governs somebody's only input. Glossary §4 entry; rename before building.
- **Fallback kiosk modules, quiet hours, and a first state alert are all approved.** Mike: *"Yup."*
  Three cheap pieces, mostly built already: swap to a working module before rebooting and **make the
  swap visible**, with a last-resort fallback that cannot itself fail; quiet hours where *"a held
  alert is not a dropped alert"* and *"the urgency is the author's, not the user's"*; and one state
  alert nobody could argue with, noting that *"'normal' here is mostly a timeout"*. Quiet hours
  belongs with the notifications inbox. (2026-08-30)


### Link capabilities — the sender chooses, decided 2026-08-30

Resolves `DEFAULT_CAPABILITIES = ("messages",)`, which shipped labelled in its own source as
*"a conservative placeholder, NOT a decision."* It was the first thing every new contact met, and
nobody had chosen it.

- **The sender picks a class before the invitation goes out, and the class is a starting point they
  can modify.** Mike's call. Classes along the lines of super user / personal / medical — named
  bundles that make the common cases one click, with every capability still individually adjustable
  before sending. (2026-08-30)
- **This is the project's standing pattern rather than a new mechanism:** a sensible default that is
  a *starting point*, chosen by the person who has the context, never a fixed set imposed by the
  code. A class is a shortcut through a decision, not a substitute for one. (2026-08-30)
- **The decision belongs to the inviter because the inviter is the only one who knows the
  relationship.** The software cannot tell an aunt from an agency nurse, and guessing wrong in
  either direction is a real cost — too little and accepting an invitation appears to do nothing, so
  people disengage; too much and somebody granted access they never considered. (2026-08-30)

### Acknowledgement is not communication — decided 2026-08-30

Resolves the tension in *"every press plays a message, no exceptions"*: the rule exists so a person
knows their press registered, but as speech it is a constant noise in a room somebody lives in, and
turning the volume down removes the very feedback the rule existed to give.

- **They are two outputs, not one.** **Acknowledgement** is for the person pressing and confirms the
  press registered. The **utterance** is for the room and says the thing. Both are channels on the
  output bus, and routing is already a property of the person rather than the device. (2026-08-30)
- **The no-exceptions rule survives, and stops being a rule about speech.** Every press is
  acknowledged. Whether it is *spoken* is separately configurable — which is what makes repeat
  suppression and quiet hours possible without ever letting a press vanish into nothing.
  (2026-08-30)
- **The default is the module's own method.** Mike's call, correcting two chat-side proposals in a
  row — first "at least one channel must always be live", then "default to as many channels as
  possible". Both were overbuilt. A game acknowledges with its animation, an AAC card by lighting, a
  scan by the highlight moving. **There is usually already something there when you hit the right
  button**, and the job is to not remove it rather than to add a layer. Per-module default, with a
  per-person override through the usual cascade — **not a single global switch.** (2026-08-30)
- **A press with nothing mapped to it does nothing.** No acknowledgement is owed where no event
  occurred. This is not silence as a response; it is the absence of anything to respond to.
  (2026-08-30)
- **But a press that is mapped and simply WRONG still gets a response, and this is the whole
  point.** Mike's rule, and it settles an older one that had been slipped into the docs and never
  ruled on: a chat-side draft wanted the press game's button to do nothing when pressed at the wrong
  time. **Mike overrode it, because the press game is for a person learning what a button is.** For
  that person the mistimed press *is* the learning event, and suppressing the response removes the
  only information in it. A wrong press that produces nothing is indistinguishable from a broken
  switch — and the conclusion a person draws is not "I mistimed it" but "this does not work", or
  worse, "I cannot do this." (2026-08-30)
- **The distinction the older rule collapsed: *unmapped* and *wrong* are not the same thing.** One
  has no event. The other has an event with the wrong timing or target. Treating them alike is what
  produced a rule that punished a learner for learning. (2026-08-30)
