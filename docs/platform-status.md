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
1. **Interstitials — sub-slice 2: recorded personal segments.** Generated kind ✓ (above). Add the
   `recorded` mode (real voice/face IS the content): audio/video + still + name, played as media; and
   **`R`-key capture** with local-STT intent cues ("message for Christine" tags + becomes the lead-in;
   "restart please"; "never mind delete that"). Recordings are **local-only/private** (may include
   staff → consent-based). Then: a real content-library editor UI, the daypart/"between videos"
   trigger wired to youtube's ENDED, and **Piper** replacing Web Speech for the local voice.
2. **Dashboard composer** + **Media/Sources tab** (surface over `media_sources`; also photos' real
   source-picker UI + a youtube playlist UI). Later: real-time/SSE + call sync; node-editor tab;
   role-name refactor of the palette CSS vars.
2. **Educational interstitials** (generated kind: scheduler + three-quadrant renderer + live graphic
   + Piper TTS), then personal/recorded segments. Then the **dashboard composer**; **Media/Sources
   tab** (surface over `media_sources` — also where photos gets its real source-picker UI). Later:
   real-time/SSE + call sync; node-editor tab.
3. **Deferred from 3c/3d** (fold into the Media/Sources tab + a playlist UI): a real source-picker
   for photos; exercise the picker's cross-album/cross-channel diversity end-to-end (only
   single-source pools were driven in the module tests); **sing-along** (curated karaoke playlist +
   lyric/caption overlay) is a youtube fast-follow; audio ducking/arbitration is its own concern.
