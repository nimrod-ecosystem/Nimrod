# Platform status & next steps

A resume-point for the `web/` platform rebuild. What's built, what's decided, what's next. See
`../DECISIONS.md` for the reasoning behind each decision and `architecture.md` for the shape.

## Built & validated
- **Slice 1 — shared systems.** Module bus (`sources → bindings → sinks`) + per-user server-side
  state boundary. `web/client/bus.js`, `state.js`, `module.js`; `web/server` (FastAPI + SQLite).
- **Slice 2 — profiles + module system.** Profiles as device-independent containers of module
  instances; module manifest registry; **two storage kinds** — overwrite state (last-write-wins +
  version / optimistic concurrency) and **append-only events** (DB-trigger enforced, never
  overwritten). `web/client/profile.js`, `events.js`; server profiles/state/events API.
- **Slice 3a — clock.** Display-only orientation; settings persist as per-profile overwrite state.
- **Slice 3b — camera.** Local self-view / rearview mirror. `getUserMedia → <video>` with **zero
  network egress** (no `RTCPeerConnection`, no frame upload) — the "camera stays on the device"
  invariant, enforced and tested. Tracks stopped on destroy.
- **Shared weighted picker** — `web/client/rng.js`: seedable PRNG (mulberry32) + Fisher–Yates +
  the weighted draw (freshness × recency × duration × **channel-diversity**). Pure /
  seed-injectable; **no `localStorage`** — the `{n,last}` stats derive from append-only events
  (`statsFromEvents`). 29 deterministic tests in `web/client/dev/rng_test.html` (coverage,
  fresh-surfacing, recency suppression, diversity: same-channel back-to-back 36% → 11%). First
  piece of the photos slice; built for photos AND youtube.
- **Slice 3c-1 — local media agent** (`web/media_agent/agent.py`). The BYO-storage half of the
  photos slice: a **zero-dependency, user-run** file server (stdlib `http.server`, `python
  agent.py --root <folder>`) that lists a chosen folder (`GET /list[?album=]`) and serves the
  bytes (`GET /files/<rel>`, Range-aware for video) with **CORS on every response** — so the
  browser client fetches media straight off the user's machine and **the platform server never
  sees a byte**. Returns relative paths (client prefixes with a runtime `base_url`, never in the
  repo); case-insensitive extension match incl. videos; read-only + path-traversal guarded. 18
  end-to-end checks in `web/media_agent/test_agent.py`, all green.
- **Slice 3c-2 — `media_sources` model + client resolver.** Per-user registry of connected
  folders on the server (`media_sources {id,label,base_url,kind}`, its own table modeled on
  `profiles`; `GET/POST /api/media-sources`, `DELETE /api/media-sources/{id}`; ownership-gated;
  `base_url` validated to http(s) only). Client `web/client/media_sources.js` = the registry
  client + the **resolver**: fetches a source's `/list` and builds `base_url + /files/<path>`
  image URLs **straight from the agent — the platform server never touches the bytes**. Validated
  two ways: 12 store-layer checks (`web/server/test_media_sources.py`, CRUD + per-user isolation)
  and a 14-check **browser** integration test (`web/client/dev/media_sources_test.html`) run
  against a live server + live agent — real cross-origin CORS fetch of image bytes and an `<img>`
  render, all green.
- **Slice 3c-3 — photos slideshow module** (`web/client/modules/photos.js`) — **completes Slice 3c
  (photos), the highest-priority default module.** Holds a `{sourceId, album}` reference → registry
  lookup → resolver → items; advances through the shared picker (`rng.js`), rendering images (and
  video, Range-backed). In-memory `recent` gives immediate anti-repeat; **play history is
  append-only events and the picker's stats derive from them** (`statsFromEvents`) — no mutable
  store of record. Inputs are interchangeable via bus sinks `photos/next` / `photos/prev` (own
  buttons + auto-advance timer + any other source). Source wiring is dev-seeded for now (config or
  `?photoSource=`); the real picker UI is the future Media/Sources tab. Validated by a 10-check
  **browser** integration test (`web/client/dev/photos_test.html`) mounting the real module against
  a live server + agent: renders, picker coverage + no-immediate-repeat over 24 advances,
  append-only play logging, `prev()` replay, clean destroy — all green.
- **Slice 3d — youtube** (`web/client/modules/youtube.js`) — **completes the four default modules**
  (clock ✓ camera ✓ photos ✓ youtube ✓). Photos' twin on the SAME shared picker (`rng.js`): a
  playlist of **public** video refs `[{id, channel, title, durationSec}]` lives in per-profile
  overwrite state (public refs, not patient data → no media agent), `channel` drives the
  diversity factor and `durationSec` the duration factor. Renders through an **injectable player
  adapter** — default is a `youtube-nocookie` IFrame-API embed; the module core (playlist → picker
  → advance → **append-only** play log, stats via `statsFromEvents`) never touches YouTube, so it's
  validated deterministically. Interchangeable inputs via bus sinks `youtube/next` / `youtube/prev`
  (own buttons + **video-ENDED auto-advance** + any source); playlist add/remove UI parses a URL or
  bare id; dev-seed `?ytVideos=ID:channel,…`. Validated two ways: a 17-check **browser** test
  (`web/client/dev/youtube_test.html`, live server + STUB player — parser units, first-load + play
  log, coverage + no-immediate-repeat over 24 advances, channel-diversity <40% back-to-back,
  ENDED auto-advance, `prev()` replay-no-log, clean destroy) **and** a live-embed smoke that mounted
  the REAL adapter and built an actual `youtube-nocookie.com/embed/` iframe over the network.
- **Themes — per-profile (first half of the theme+voice slice)** (`web/client/theme.js`). A theme is
  a **render setting on the profile**, not content (content-as-meaning): a full map of the palette
  CSS variables the modules already draw through (`--bg`, `--ink`, `--card`, `--moss`, `--midnight`
  …), applied to the page root by `applyTheme(root, id)`. Because every module references the
  variables, **all four re-theme for free** — no per-module work. Four themes ship (Nimrod-light
  default, **Dusk** dark/calm, **High-contrast**, **Warm**). Storage needed **zero server change**:
  the per-profile settings blob `{theme[, voice]}` rides the existing versioned overwrite-state store
  under the reserved key `settings` (module ids are 32-hex UUIDs, so no collision). `app.js` loads +
  applies each profile's theme before mounting its modules and persists picker changes; switching
  profiles re-applies. Validated by a 15-check **browser** test (`web/client/dev/theme_test.html`,
  live server): pure apply/resolve + default fallback + full-overwrite, computed-`:root` change,
  and **per-profile persistence + isolation** (two profiles keep different themes). Live-verified in
  the app: the Default dashboard switched light↔Dusk and the choice persisted server-side.
- **Voice — per-profile (second half; the theme+voice slice is now COMPLETE)** (`web/client/voice.js`).
  Voice is a per-profile render setting on the SAME `settings` blob (`{theme, voice:{uri,lang,rate,
  pitch}}`) — content-as-meaning: change the voice and spoken content re-speaks for free.
  Interim engine = the browser **Web Speech API** (`speechSynthesis`); **Piper** (local/OSS, doubles
  as Cici's voice) is the target and slots in behind the same `speak()`. `speak(text, pref, {synth,
  Utterance})` is injectable (unit-tested without vocalizing); `resolveVoice()` degrades gracefully —
  exact voice by `uri` → language match → engine default → first — so a saved voice absent on another
  device (voices are per-machine, like camera deviceIds) never throws. Shell adds a voice picker +
  rate + Test-speak button; `waitForVoices()` handles Web Speech's async load. Validated by a
  17-check **browser** test (`web/client/dev/voice_test.html`, stub engine): resolution + fallbacks,
  the `speak()` seam (chosen voice, cancel-first, rate/pitch clamp, no-voices path), and per-profile
  persistence + isolation + **theme/voice coexisting in one blob without clobber**. Live-verified: 7
  real system voices populated and Test spoke.

- **Interstitials — sub-slice 1: the generated kind** (`web/client/modules/interstitials.js`). The
  first between-video segment module (docs/modules/interstitials.md), generated/educational content
  only (recorded personal messages + `R`-capture are sub-slice 2). Built on the same spine: a
  **data-driven content library** of generated items (`{kind, graphic:{type,value}, speak}`; ships a
  default alphabet/counting/vocab set) → the **shared picker** (`rng.js`, `kind` = the diversity axis
  so it won't show three counting items in a row) → **2×2 renderer** (TL Cici presenter · **TR
  self-view camera — the invariant, never covered** · BL subject+name · BR the **live graphic drawn
  from the value in the profile's theme**, themed for free via the shell's CSS vars) → **TTS in the
  profile's voice** through `voice.js` `speak()`. Non-blocking + skippable (`interstitial/next` /
  `/skip` bus sinks + an optional auto-advance timer); append-only play log, picker stats derive.
  Two injection seams keep it deterministic — `ctx.speak` (a test records calls; no audio) and
  `cfg.selfView=false` (skip `getUserMedia`). It reads the profile **voice** from the `settings` blob
  via a self-contained read handle (`/api/profiles/{pid}/state/settings`) — a "module reads profile
  settings" pattern to formalize via `ctx` when a second speaking module needs it. Validated by a
  16-check **browser** test (`web/client/dev/interstitials_test.html`, live server): pure graphic
  renderer (number+dots / letters / spelled word / none), first render+speak+play, **speak uses the
  profile voice** (proves the settings read), coverage + no-immediate-repeat over 18 advances,
  kind-diversity <50% back-to-back, append-only log, skip advances, clean destroy.
  - **RE-SHAPED (see DECISIONS.md):** "interstitial" is retired as a module. This module's generated
    flow becomes the **Educational** module; the recorded track becomes **Personal videos**; the
    between-videos sequencing moves to the **content director** below. Keep this file as the reference
    for the generated flow.

- **State-machine engine + daypart clock** (`web/client/statemachine.js`, `web/client/daypart.js`).
  The reusable runtime Mike asked for ("shouldn't the scheduler be a state machine module that can do
  other things?") — a declarative machine over the bus: states with `enter` actions, transitions
  triggered by **bus events / timers / a `segment/done` signal**, optional guards, and a target chosen
  by a fixed `to` **or a weighted `pick`** (`rng.js`) among daypart-gated candidates. Pure + injectable
  (`now`, `rand`, timers), DOM-free. `daypart.js` is the **single time-of-day source** (morning /
  daytime / primetime / sleepytime) feeding both the director's gate and YouTube's daypart playlists.
  Its first config is the **content director** — one state per segment provider (youtube ·
  personal-videos · educational · word-game · trivia · sing-along); on `segment/done`
  (`ended` | `skipped` | `timeout`, all equivalent — the seam that fixes the missing youtube-skip
  path) it weighted-picks the next provider gated by daypart (**morning & sleepytime = youtube only**).
  A second config (Today card: clock → weather → calendar on a timer) proves the engine generalizes.
  Validated headless by a **30-check** browser test (`web/client/dev/statemachine_test.html`, seeded
  PRNG + fake timers): daypart boundaries incl. midnight wrap, entry+segment-done activation for all
  three reasons, daytime variety with no back-to-back repeat + always daypart-legal, morning/sleepytime
  youtube-only, primetime excludes the word game, the Today-card timer cycle + loop, guards +
  local-over-global transition order, and clean unsubscribe on stop.

- **Content director — container module** (`web/client/modules/director.js`, "Lineup"). The thin
  MODULE over the engine: a **container** that owns its placed window and hands its inner region to
  **one segment provider at a time** (Mike: "drop the state machine into the window… it hands its
  inner region to one child provider"). It mounts the real **youtube** module as a child in its own
  slot and renders the not-yet-built providers (personal / educational / word-game / trivia /
  sing-along) as **labelled placeholders** — the same "stub the missing half" pattern youtube used for
  its player. The engine picks on `segment/done`; the container shows that provider's slot. **Big Skip
  button skips the whole segment** (`segment/done{skipped}`); within-segment controls stay in the
  child. **youtube wiring:** youtube now emits `segment/done` on ENDED (and error) alongside its
  existing behaviour — harmless standalone (no subscriber), and when directed it's seeded
  `autoAdvance=false` so the director advances it. **Child-mount seam:** the app passes container ctx
  (`rootBus`, `instanceId`, `makeState`/`makeEvents`); child storage lives under `<instanceId>-youtube`
  (server key rule `[A-Za-z0-9_-]{1,64}`; a 32-hex instanceId + dash can't collide with a sibling id or
  the reserved `settings` key). Validated by a **15-check** browser test (`dev/director_test.html`,
  live server + stub player + injected clock/timers): starts on youtube, rotates off it on
  segment/done(ended), placeholder auto-finish (timeout) and the Skip button both advance with no
  immediate repeat, every shown provider is daypart-legal, re-activating youtube advances it, morning
  shows youtube only, and clean destroy stops the machine. Live-verified in the app (added "Lineup" →
  youtube slot shown, others hidden, child mounted). youtube's own 17-check test still green (no
  regression from the segment/done line).

- **Personal videos — the recorded provider** (`web/client/modules/personal.js`). The interstitials
  *recorded* track re-homed as its own module and photos' video twin: holds a `{sourceId, album,
  subjectName}` reference → the `media_sources` resolver (`/list`) → **video** items → shared picker
  (`rng.js`) → plays one clip in a `<video>` **straight from the user's media agent** (bytes never
  touch the platform server) with a **name caption**. Director-ready like youtube: a clip ENDING is a
  `segment/done{provider:'personal'}` (standalone it also auto-advances); an **empty/unconfigured**
  source hands back with `segment/done{empty}` instead of freezing. A **`directed`** flag (seeded by
  the container) suppresses autostart so a hidden child never fires a spurious segment/done — the
  director drives every activation. The first clips are **Oscar's messages** (`…/Voice
  messages/Oscar`). Validated by an **11-check** browser test (`dev/personal_test.html`, live server +
  the Oscar agent): lists exactly Oscar's two mp4s (the .amr / extensionless files skipped), renders a
  `<video>` from the agent, name caption, append-only play log, coverage over advances, ENDED →
  segment/done + auto-advance, `prev()` replay-no-log, empty provider hands back, clean destroy.
  Live-verified in the app (added Personal videos with the Oscar source → "Oscar singing ABC's.mp4"
  playing, caption "From Oscar"). It's now a **real provider in the director** (youtube's placeholder
  neighbour is gone); the director's 15-check test still green with two real providers.

- **Educational — the generated provider** (`web/client/modules/educational.js`). The nimrod_95
  interstitials *generated* flow re-homed as its own module and reworked from the retired 2×2 layout to
  a **single in-stage live graphic** (no camera/presenter quadrants). Content-as-meaning: an item is
  semantic data (`{kind, graphic:{type,value}, speak}`; ships an alphabet/counting/vocab seed) → shared
  picker (`rng.js`, `kind` = diversity axis) → **graphic drawn live in the profile theme** (exported
  pure `graphicHTML`) + **TTS in the profile voice** (`voice.js speak()`, reading the profile's
  `settings` blob). Director-ready: a generated item has no natural end, so it ends on a **display
  timer** → `segment/done{provider:'educational'}` (standalone it also auto-advances); `directed`
  suppresses autostart. Two injection seams keep it deterministic — `ctx.speak` (test records, no audio)
  and `ctx.setTimer`/`ctx.clearTimer` (the container forwards its own, so the director's tests stay
  deterministic). Validated by a **17-check** browser test (`dev/educational_test.html`, live server,
  stub speak + fake timer): pure renderer (number+dots / letters / spelled word / none), directed
  no-autostart, advance renders+speaks+logs, **speak uses the profile voice**, display-timer fires
  segment/done+auto-advance, coverage + no-immediate-repeat + kind-diversity <50% over a run, skip,
  clean destroy. It's now a **real provider in the director** (its placeholder is gone); the director's
  15-check test still green with **three** real providers.

- **Kiosk shell — the full-screen product surface** (`web/client/kiosk.html`, `web/client/kiosk.js`,
  shared `web/client/modules.css`). The first cut of the dashboard for actual bedside use, distinct from
  `index.html` (the dev harness). Caregiver-driven by keyboard + mouse (the patient isn't controlling it
  yet). Opens ONE profile full-screen with: a **STAGE** that shows one module at a time
  (photos / youtube / the Lineup director / …), switchable by number keys or on-screen dots; a
  persistent **MIRROR** — the camera self-view pinned in a corner, mounted once and left running while
  the stage changes (her orientation anchor — never covered); and an auto-hiding control bar. Stage
  modules are mounted **lazily** (only the visible one is live, so a hidden youtube/director isn't
  playing audio behind the scenes); the camera is the one exception. Reuses the exact runtime + container
  ctx the harness uses, so a Lineup director works here. `kiosk.html` auto-seeds a starter *Bedside*
  profile (photos · camera · director) for a fresh user. Validated by a **19-check** browser test
  (`dev/kiosk_test.html`, live server): partition (camera → mirror, rest → stage), photos is the default
  primary, one module in the stage at a time, lazy teardown on switch, the mirror survives switches,
  keyboard select, mirror toggle, clean destroy. Live-verified in `kiosk.html` (photos stage + camera
  mirror + dots; pressing `2` swapped the stage to the director, mirror intact).
  **Mirror mode** = pressing `M` makes the camera **full-screen** (the corner mirror expands over the
  stage; press again to return) — the camera stream stays mounted.
  - **Default layout (2026-08-13):** one content surface + a small HUD, not the old four-quadrant split.
    The camera **mirror** and a translucent **clock** are persistent HUD overlays (mounted once, left
    running while the stage changes); everything else cycles in the stage. The mirror's **size + corner**
    and the clock's **corner** are **per-profile settings** (on the `settings` blob with theme + voice),
    so they re-render for free and are tunable live at the bedside — `[`/`]` resize the mirror, `\` cycles
    its corner, persisted to the profile. Defaults: large mirror top-right, clock bottom-left. The
    kiosk's test is now **24 checks** (HUD partition, default layout from settings, lazy switch with the
    HUD surviving, live tuning + `setMirror`, mirror mode, clean destroy).

- **Offline resilience — last-known-good cache** (`web/client/cache.js`; opt-in on `state.js` +
  `media_sources.js`; wired into the kiosk). A tiny localStorage JSON mirror so a brief
  coordination-server outage (or a boot before the network is up) doesn't blank her screen — her
  **photos/videos come from the LOCAL media agent**, so with the config cached they keep playing. The
  server stays the source of truth: the cache is written on every successful read and only READ when a
  read fails. `createState({cacheKey})` serves the cached config on a failed load (handles without a
  cacheKey are unchanged — still throw); `createMediaSourcesClient({cache:true})` (enabled in photos +
  personal) keeps the folder→base_url registry through an outage; the kiosk caches the profile list +
  the profile's module layout + every module's config. NOT a store of record (DECISIONS.md). Validated
  by an **11-check** browser test (`dev/resilience_test.html`, live server + a dead endpoint): cache
  primitives, `createState` serves last-known config when the server is unreachable + a non-cached
  handle still fails, and the media registry serves its cached source when the server is down. The
  kiosk's 19-check test still green (incl. the mirror-mode fix). **Still open for real deploy:** kiosk
  auto-auth as her (identity is a `dev-user` stub).

- **Postgres backend for deploy** (`web/server/db.py`). Both engines now share one `_Store` logic class;
  `app.py` selects `PostgresStore` when `DATABASE_URL` is set (Neon/any Postgres — durable, external,
  backed up), else `SQLiteStore` for local dev. Standard SQL throughout; the only dialect deltas are the
  id column (AUTOINCREMENT vs BIGSERIAL), reading a new id back (lastrowid vs RETURNING), and the
  append-only trigger syntax. The shared business rules — optimistic concurrency, append-only trigger
  enforcement, per-user ownership, module-removal-keeps-events — are validated by `test_store.py`
  (**23 checks**) + `test_media_sources.py` (12) via SQLite (the same code path Postgres runs) and by an
  HTTP round-trip. The Postgres driver adapter's live smoke is the deploy itself (docs/deploy.md Part B).
  `requirements.txt` adds `psycopg[binary]` + `psycopg-pool` (used only when `DATABASE_URL` is set). This
  is ⚙️ #1 of the four deploy prerequisites; next: device-secret auth, env config + render.yaml,
  media-agent-as-a-service.
- **Device-secret auth** (`web/server/identity.py`, `web/client/auth.js`). ⚙️ #2 of the deploy
  prerequisites. A per-device secret sent as `X-Device-Key` is matched (constant-time) against the env
  `DEVICE_KEYS` (`user:secret,…`) → the user id; the kiosk pairs once via `?key=<secret>` (stored
  locally, sent on every request through the shared client `auth.js` — the four fetch modules now route
  through it). With `NIMROD_ENV=prod` it's **fail-closed**: only a valid key is accepted (no dev
  override, no shared default; a prod server with no keys denies everything). The dev `X-Dev-User`/`?user`
  override still works with `NIMROD_ENV` unset, so the harness + tests are unchanged. Validated:
  `test_identity.py` (**14 checks**) + a prod HTTP smoke (valid → 200; missing/wrong key + `X-Dev-User`
  → 401) + a client refactor round-trip. Env config + a repo-root **`render.yaml`** blueprint ✓ (⚙️ #3;
  declares the service + `NIMROD_ENV=prod`, keeps `DATABASE_URL`/`DEVICE_KEYS` as dashboard secrets out
  of git; parse-validated). **Media-agent-as-a-service ✓** (⚙️ #4, `web/media_agent/deploy/`): the agent
  reads env config (`NIMROD_MEDIA_*`) and runs as a systemd unit (Pi, `install-linux.sh`) or a
  Task-Scheduler logon task (Windows, `install-windows.ps1` + `run-agent.ps1`); validated (test_agent 18
  green, env-config serves, the Windows env parser handles spaces + the origin URL). **All four deploy
  prerequisites are now built — docs/deploy.md is fully executable.** The bigger
  security picture (HTTPS in transit, per-user ownership on every
  query, parameterized SQL, append-only tamper-proofing; residual = operator + Cloudflare/Render/Neon
  see the small config text) is in the deploy discussion.

- **Points ledger + Sprint (focus) timer** (2026-08-17) — the platform's first POINT SOURCE and the
  shared record every later one writes to. `client/points.js` defines the seam: the RECORD is a
  **profile-scoped append-only stream** named `points` (reached with `ctx.makeEvents('points')` — no
  server change needed, the API's stream key is just a string), and the live NUDGE is the bus topic
  `points/award`. **Only the source appends**, so a consumer listening on the bus can't double-count;
  consumers read the stream for truth and the bus for immediacy. Event shape
  `{amount, mult, source, tags, note}` with the server stamping `id`/`created_at`.
  `client/modules/sprint.js` is the first source: work/break/long-break phases, a persisted deadline
  (a reload resumes mid-sprint), a task label, stacking multipliers, spoken phase changes in the
  profile voice, ONE bus sink (`sprint/control`) so any input can drive it, and the rule that
  **finishing a work block pays and skipping one doesn't**. A deadline that passed while the tab was
  shut still pays inside a grace window and expires unpaid beyond it. Supporting changes: `events.js`
  takes a `limit`, `makeState`/`makeEvents` take per-handle options, and a `forge` (teal + amber)
  theme so learning tools get their look as a THEME, not as code. Validated by a **54-check** browser
  test (`dev/sprint_test.html`, live server + injected clock) plus live dev-harness verification with
  real time (countdown ticks, full reload resumes mid-sprint with the task intact, clean console).
  Doc: `docs/modules/sprint.md`.

- **Quest board + ledger categories** (2026-08-17) — the CONSUMER end of the points seam,
  modelled on the household points-tracker spreadsheet (Task Menu / Daily Log / Rewards Store /
  Weekly Hours / Dashboard) so the two stay portable. `client/modules/quests.js`: balance with
  earned/spent broken out, a tappable task catalog (data, per-profile, `x2` only on double-eligible
  tasks, negative-point penalties), a reward store with **confirm-to-buy**, the recent log, and the
  week's school hours against target with the x1 / x1.5 stretch / x2 overtime band. `points.js`
  gained the spreadsheet's `type` column (`Obligatory/Bonus/Idea/Penalty/School/Reward`), `spend()`
  (a purchase is a NEGATIVE append — one stream, so it can't be edited away either), `minutes` on
  school-time events, and `sumEarned`/`sumSpent`/`sumMinutes`/`weekStart`.
  **Two engines, never double-counted:** a sprint pays the base rate once and records its minutes;
  the weekly banding's top-up (the EXTRA 0.5x/1.0x, never the base) is **displayed as unpaid** until
  the weekly job lands. The dashboard **only refreshes** on the `points/award` nudge — it never
  appends, and there's a check for exactly that. Validated by a **40-check** browser test
  (`dev/quests_test.html`) including the end-to-end seam — a real `sprint` module on the same
  profile finishing a sprint and this board picking it up with no reload — plus live harness
  verification. Docs: `docs/modules/quests.md`, `docs/points-sheet.md`.

- **`progress` — the measurement dashboard** (2026-08-17) — datadash.js ported and generalised.
  `client/telemetry.js` adds the second shared stream, `gameplay`: ONE `trial` shape whose three
  outcomes (hit / false alarm / miss) express a go/no-go cue and a school answer alike, so ONE
  PERSON CAN PLAY GAMES FROM BOTH SETS and the viewer filters by GAME, never by persona.
  `client/modules/progress.js` renders accuracy per session (inline themed SVG), per-CONCEPT
  mastery hardest-first with improving/slipping trends, a sessions table, and CSV export. Two
  accuracy measures kept apart (misses counted vs excluded); "when answered" and "missed" cards
  appear only where misses exist. Read-only — games are the only writers. Validated by a
  **54-check** browser test seeded with a reaction game AND a learning game on one profile, plus
  live harness verification. Docs: `docs/modules/progress.md`. NOTE: no game writes to the stream
  yet — producers land with the Cici game ports and the first learning game.

- **The front door: landing + home** (2026-08-17) — the site had no coherent way in. `/` redirected
  straight to `/kiosk.html`, so signing in with Google dropped you on a full-screen kiosk that
  auto-seeded a bedside profile and gave you **no way to add anything to it** — which is exactly why
  the games weren't playable: there was nowhere to put them. Meanwhile the real landing page sat at
  the repo root, unserved by the app, with every CTA an `href="#"`.
  Now three surfaces: **`landing.html`** (public, moved into the app, CTAs wired to `/auth/login`,
  and it reports a failed sign-in instead of silently re-rendering), **`home.html` + `home.js`**
  (NEW — your screens: create, add/remove modules from the live registry, Open), and
  **`kiosk.html`** (unchanged; still the `?key=` pairing target, and it already accepted
  `?profile=`). `/` serves the landing when signed out and redirects to `/home.html` when signed in
  (`identity.optional_user`, a non-raising counterpart to `current_user`); `/auth/callback` now
  lands on home. The repo-root `index.html` became a pointer to the live site so GitHub Pages
  can't serve a second, drifting landing page. Validated by a **34-check** browser test
  (`dev/home_test.html`) covering the routing and the page, plus an end-to-end walk: compose a
  screen with quests/progress/sprint/clock → Open → the kiosk mounts it → a task logs and the
  balance moves 0 → 15. Docs: `web/README.md`.

- **Word Forge — the first game, writing to BOTH streams** (2026-08-17) — `client/modules/wordforge.js`.
  A vocabulary game over the word bank (define / fill-the-blank / which-sentence-is-better), content
  as editable data in the documented line formats. **A wrong answer explains itself and still pays**:
  it reveals the right answer with the reason (the meaning + a real sentence, or the actual *why* for
  a sentence pair) and awards `tryPoints` (3 vs 10) — **banked on "Got it", not on being wrong**, so
  the reward attaches to taking the correction in, and each item appears once per round so there is
  no farm. Streak bonus +5 every 5, never on a miss. It writes an award to `points` (source
  `wordforge`) AND a trial to `gameplay` with `concept` = the WORD, so the quest board's balance and
  the progress dashboard's per-concept ranking both update with **no wiring**. Validated by a
  **47-check** test that mounts the real `quests` and `progress` modules on the same profile and
  plays a full round. Docs: `docs/modules/wordforge.md`.
- **Screens can be renamed and deleted** (2026-08-17) — `PATCH`/`DELETE /api/profiles/{pid}` plus
  `profiles.rename`/`remove` and the buttons on home. Deleting drops the profile, its modules and its
  settings; **its append-only events survive** (a DB trigger forbids deleting them), so deleting a
  screen can never quietly erase a score — and the confirm dialog says exactly that, including that
  a new screen won't show the old history. 43 checks (`dev/home_test.html`).

- **Balance, bands, and a daily cap** (2026-08-17) — Mike caught that Word Forge at 10 points a
  correct answer was paying **30-40 points per MINUTE** against an economy that runs at ~1/min.
  Repriced to 2/1/+3, anchored on the Task Menu's own price for "look up a word's meaning" (2), and
  the rates for every source are now tracked in **`docs/points-balance.md`** with the rule: estimate
  the minutes, divide, and cap anything repeatable. Added a **`dailyCap` (40)** — Mike's use case is
  a game parked on a second monitor between other things, which is a good way to learn and a
  terrible way to price an economy. Past the cap the game keeps playing and **keeps recording
  trials**; only the currency stops (capping the currency must not cap the measurement).
  `points.js` gained `todayFrom(source)`.
  **Grade bands:** word-bank entries carry a `grade`, telemetry gained an optional `band` field and
  `byBand()`, and `progress` has a **Bands tab** that appears only when the data has bands. It is
  the content's OWN label, never a percentile or national comparison — deriving one needs a normed
  instrument, and inventing one would fabricate a number about a child's education.
  **`educational` gained a text format** (`itemsText`, `kind | graphicType:value | spoken line`) —
  it already read its library from per-profile state, so this makes it editable without hand-writing
  JSON. Word Forge 59 checks, progress 54, both green.

- **The live wallpaper — a held screen that looks like it is waiting, not broken** (2026-08-31).
  Mike, 2026-08-30: build it as a module a container swaps in, not a feature inside the video
  modules, *"implemented per module it would be written three times and drift."* Three new files:
  `held.js` (the `held/begin` · `held/end` signal, idempotent, and **it releases on destroy** — a
  module torn down while held would otherwise strand whatever reacted to it in a state only the
  destroyed module could have left), `wallpaper.js` (the pure content half) and
  `modules/wallpaper.js` (a real module, addable to a screen on its own, needing no server and no
  files). `youtube.js` and `personal.js` now publish the signal from their existing `setHeld()`.
  `module.js` gained the `onShow` the lifecycle never had opposite `onHide`.
  **It is an OVERLAY, not a machine state, and that turned out to matter:** the director's
  `activate()` for a real child is `publish('<id>/next')` — the verb means ADVANCE — so a
  `wallpaper` state with a `$back` transition would have come back and skipped the clip somebody
  stepped away from, which is the exact thing a hold exists to prevent. Long note in `director.js`.
  **The flash-rate floor is checked rather than claimed:** the ambient is a pure function of time,
  `peakLumRate()` samples a full cycle, and the suite asserts it against `MAX_LUM_RATE` (0.02/s,
  ~three orders of magnitude under the 3 Hz threshold). The first version of that check measured
  the frame AVERAGE, which the 120°-apart gradient stops hold constant by construction — it
  reported 0.0 for every setting and read as perfectly safe while measuring nothing. Only a
  relational assertion (`calm` must move less than `gentle`) caught it. 67 checks green.
  **Not covered:** the media path against a live agent, and anything on real hardware.
  **Not built:** a screen with no director around it still shows its frozen frame — this container
  is the only thing that can mount a child, and doing it everywhere means the shell owning an
  overlay per pane.

- **Dwell — holding still is the click** (2026-08-31), `input_dwell.js`, 35 checks green.
  Found by running the audit against the private tree rather than porting blind: the colour
  tracker's DETECTION half came across faithfully (same DET_W/H, gain, smooth, hueTol, satMin,
  valMin, minPx) and its **ACTIVATION half never did**. Nothing in this repo turned `input/aim`
  into a press, so the public tracker could point at things and never select one — not a stale
  copy of the private one, an incomplete one, incomplete in exactly the half that decides
  whether she can do anything.
  It is a device on the input bus rather than part of the tracker, so it serves any aim
  producer — marker, head pointer, or a mouse belonging to somebody who can move a pointer but
  not click. The private build's numbers carried across unchanged: 1800 ms, 70 px, a 1.5× re-arm
  band.
  **The safety property is the re-arm** (`mustLeave`): after a press, nothing fires again until
  the aim has genuinely left. Without it somebody who is still gets a click every 1.8 seconds
  forever — a screen operated at random by a person who has stopped moving, which for the person
  this is for is worse than no input at all. Verified by **negative control**: disabling
  `mustLeave` fails exactly the five checks that guard it and nothing else, so the suite is not
  vacuous. `down` and `up` are the same instant, so a dwell can never satisfy a `holdMs` binding
  — said out loud because a binding that silently never fires is miserable to debug.
  **Not built:** a repeat mode (somebody scrolling by holding a head-pointer still has a real
  want; it would be its own off-by-default setting). **Not run:** anything with a real camera or
  a real person — whether 1800 ms and 70 px suit anybody but the one person they were tuned for
  is a bench question.

- **Scanning extracted into the input layer** (2026-08-31), `input_scan.js`, 39 checks green.
  It was living inside the private `scan_yesno.js`; a scan loop written inside an AAC board is a
  scan loop the trivia game, the settings menu and the photo picker each have to write again.
  This file owns an ordered list, an index and a clock, and knows nothing about cards, speech or
  the DOM. The board on top of it is Tier 2 and is not written.
  **The 15-second default is carried, not re-derived** — the reason came across verbatim from
  the private source (*"she understands the task but needs time to process the cue before
  signaling"*) because it is a statement about one person's processing that nothing here could
  reconstruct. `settings_audit.js` already prices it: twelve presses is three minutes.
  **Hybrid, and neither half is a mode:** the clock advances, and `next()` also advances for
  anybody who can hit a second switch — a setup that never binds it simply never calls it.
  `next()` restarts the clock rather than keeping the remainder, because jumping to an option
  and then getting a third of a second to decide about it is worse than not jumping.
  **It wraps** (one switch travels one way) and **it never stops on its own** — a scanner that
  gave up after N laps would take away the one thing the person can operate at exactly the
  moment they were taking longer than expected. Laps are counted; nothing acts on the count.
  Verified by **negative control**: shortening the step and disabling the lap count fails 16 of
  the 39 checks.
  **`dwell` → `step`.** The glossary had recorded that collision the same day with a plan
  attached — the scanning sense moves, and it moves inside the extraction rather than as a
  separate churn. This is that change; `settings_audit.js`'s prose moved with it (59 green), and
  the collision is now closed rather than open.

- **The communication board — the first real AAC surface in the public repo** (2026-08-31),
  `aac_symbols.js` + `aac_vocab.js` + `modules/board.js`, **72 checks green**. Ported from the
  private `aac_board.js` / `scan_yesno.js` / `aac_vocab.js` / `aac_symbols.js` after a
  check-first audit found the public repo had nothing AAC at all.
  **Symbols** came across programmatically rather than retyped — 23 original SVGs, in-repo and
  unencumbered, which is the whole reason they exist (ARASAAC is CC BY-NC-SA, PCS and
  SymbolStix are proprietary).
  **Position is sacred, and it is structural rather than promised.** The cell index IS the grid
  position; `addWord` appends or fills a hole and there is no code path that splices or sorts;
  a full board reports `needsTier` rather than growing itself. `promote` is the only thing that
  moves a card, it is explicit, and it **returns the moves** so a deliberate rearrangement has a
  before and an after. Moving up a tier **preserves direction**: a corner of a 2×2 lands in the
  matching corner of a 4×4, so a reach up-and-left stays up-and-left.
  **`say`, never `notify`** — the verb is the boundary between a talking aid and a nurse call,
  and the suite asserts nothing reaches the `remote` channel.
  **It measures and shows her nothing**: selections are appended with enough to tell later
  whether the board works; no timing, lap count or score is rendered.
  **Two bugs found and fixed in the writing.** `normalizeBoard` FILTERED empty cells out, which
  silently closed every hole `removeWord` had deliberately left — the exact reflow the file
  exists to prevent, committed by the safe-looking function. And the card sizing was in `vmin`,
  so a board in a dashboard quadrant overflowed; the private build's container-derived `--u`
  came across with it, including the hidden-card-measures-zero bug its own comment records.
  A card with no room for both now drops the PICTURE, never the word.
  **Not built:** recorded audio clips. The private build speaks every card from a `.wav`
  because **a Pi often has no TTS voice installed at all** — this board would be silent on the
  one machine it most needs to work on. That is the largest open gap.
  **Not built:** eat / drink / hungry / thirsty symbols. The set was drawn for a board that did
  not need them; the `care` set ships as one person's example with its origin attached, not as
  a default anybody inherits.

- **A call that does not need a VPN** (2026-09-01). `call_transport.js` + signalling on the
  existing drive socket. **46 client checks, 49 server checks**, both green; negative-control
  verified.
  **What was actually VPN-only was one line.** The validated private call is
  `new RTCPeerConnection({ iceServers: [] })` — host candidates only, which works on a
  Tailscale mesh and nowhere else. That was a shortcut to prove the media path, not a design
  decision, and `DECISIONS.md` (2026-08-09) already said the opposite. Filling the array with
  public STUN is most of the fix.
  **Signalling rides the socket that already exists** rather than opening a second one: the
  drive relay already authenticates, already knows which two devices belong to one person, and
  already reconnects on facility wifi. The relay's rule was *a driver drives screens, a screen
  drives nothing*; signalling has to be bidirectional (the answer must get home), so it is a
  SEPARATE message type that is never turned into a verb or a bus topic at either end, with a
  fixed set of kinds and a 64 KB cap. The invariant is now two sentences: **verbs go one way,
  signals go both ways, and a signal can never become a verb.**
  **No TURN relay is configured, deliberately.** A relayed call is roughly a gigabyte an hour
  of somebody's bandwidth; a public default would mean this project paying for strangers'
  video. Calls work wherever a direct path exists and fail honestly where one does not.
  **`direct` mode is still there** — the Tailscale path, named in DECISIONS as "max privacy",
  where not even a STUN lookup leaves the machine.
  **The kiosk now supplies the transport**, so the Call panel can finally ring. Found a TDZ
  bug doing it — the second in this file: anything a `childCtx` getter reads must be declared
  with the early state, or the first mount throws before the async lookup has built it.
  **Not run:** anything on a real network. No real `RTCPeerConnection`, no NAT, no relay. The
  suite proves the state machine and the signalling rules; **whether two real devices connect
  is a bench test with two machines and it has not been done.**

## Decided (see DECISIONS.md)
- **Server = the store of record.** FastAPI + SQLite (Postgres-swappable) on a small always-on host
  (~$5/mo) or self-host; dev runs it locally. GitHub Pages only serves the static landing page and
  cannot store user data. Only tiny text lives on the server (KB of config, ~150 B/play); **big
  media never touches it** (BYO media agent). Google Sheets / CSV-to-user-folder are optional
  export/sync layers, not the store of record.
- **One shared weighted picker** (freshness × recency × duration + channel diversity; hard-exclude
  recent; pure + seed-injectable) for photos AND youtube, reimplemented clean from the proven old
  engine. Play stats are per-video, global across playlists; history is append-only events.
- **Media = BYO storage** via a user-run local media agent (listing API + CORS), referenced by link.
- **Server push = SSE** (not WebSocket), built when the first real-time feature needs it.
- **Themes = per-profile** (visiting a profile shows its theme); own slice after the four modules.
- **Cross-device sync during calls** (shared pick + playhead) is the feature that pulls real-time
  forward; picker is built seed-ready so it's a small add later.

## Next
1. **Personal videos — enhancements.** Base provider ✓ (above). Add **audio-only** messages (the .amr /
   voice notes), a **still + name** fallback when there's no video, an optional **TTS lead-in** ("A
   message from Oscar") in the profile voice, and **`R`-key capture** with local-STT intent cues
   ("message for <name>" tags + becomes the lead-in; "restart please"; "never mind delete that").
   Recordings **local-only/private** (may include staff → consent-based).
2. **★ Minimal usable bedside dashboard.** Kiosk layout ✓ · kiosk resilience ✓ (above). Remaining for
   "she's using it": (a) **deploy** — static client on **Cloudflare Pages** (free CDN) + the thin FastAPI
   server on a **managed host** (Render primary; ~$7/mo always-on + managed Postgres — it holds only KB
   of config, so cheap + reliable, beats self-hosting for uptime), the media agent running where her
   media lives, **scripted source config** (stand-in for the Media/Sources UI); (b) **kiosk auto-auth**
   as her (identity is a `dev-user` stub today). Input is keyboard/mouse for now (she isn't controlling
   it yet). Bar per Mike = her current lock screen: mirror ✓, singalong = a curated youtube karaoke
   playlist (content, not code), **record = still owed** (the R-capture personal-video recorder). Old
   site stays the fallback for anything not yet rebuilt.
3. **Today card**: clock → weather → calendar on the same engine. **iCal (`.ics`) URL first** (no
   OAuth), then **Google Calendar** read-only when login lands (server never stores events; pick which
   calendar shows). **Deferred:** agency/check-in, on-this-day/memories.
4. **Sharing / permissions model** (Mike, 2026-08-13). Today profiles are single-owner (404 to anyone
   else). To let family view/share info (e.g. a medication schedule as a normal structured-state module,
   so it's already device-independent — open your login on a phone and it's there), add a grant model:
   a profile or specific modules shared read/edit to another account. Then, optional follow-on:
   **client-side encryption** for sensitive server-state fields so "on the cloud" ≠ "cloud-readable"
   (keeps the operator/providers from reading it). Deep clinical data (recordings, AI analysis) stays
   local-only regardless. Medications = structured state (shareable), not a file.
5. **Media/Sources tab + full dashboard composer.** The real source-picker UI (personal + photos both
   need it — dev-seeded today) over `media_sources`; a youtube playlist UI; an educational content
   editor; **Piper** replacing Web Speech. Later: real-time/SSE + call sync; node-editor tab (the
   visual authoring surface over this same state-machine engine); role-name refactor of the palette CSS
   vars.
6. **Deferred from 3c/3d** (fold into the Media/Sources tab + a playlist UI): a real source-picker
   for photos; exercise the picker's cross-album/cross-channel diversity end-to-end (only
   single-source pools were driven in the module tests); **sing-along** (curated karaoke playlist +
   lyric/caption overlay) is a youtube fast-follow; audio ducking/arbitration is its own concern.
7. **Cici ↔ scheduler & media** (needs the Cici-AI layer first; ideas captured in DECISIONS.md). Cici
   plugs into the existing seams — as a bus **source** (voice/intent → play/skip) and a **content
   generator** for the generated track (authoring the semantic data the renderer already presents), while
   the deterministic pick stays pure. **Retroactive cue-spotting** (Mike, 2026-08-14): a local-Whisper
   pass over room recordings that spots spoken cues — "Cici …", "make a note of …", "delete this" — a
   retroactive wake word; doubles as a review queue + training data; always surfaces commands for a human
   confirm before anything destructive. Local only. Slices: **AI photo-tagging** (local VLM suggests tags/caption/people,
   human confirms — enriches metadata + doubles as training data; her photos stay local); **trivia about
   the upcoming song/video** (read the committed next-pick, generate-ahead); the **"answer is the next
   video" game** (director passes the pending target to a trivia segment; reveal = the video). Generate
   ahead, never block; her-data → local Companion Cici, generic → cloud-eligible Helper Cici.
