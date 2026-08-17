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
- **Still true:** non-blocking, skippable, never requires input; photos-#1 and the calm dayparts always
  dominate low-energy times; short segments (fatigue).

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
