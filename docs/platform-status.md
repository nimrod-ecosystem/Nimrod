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
1. **Slice 3c — photos** (highest-priority default module). Sub-slices, one validated per session:
   - **3c-1 — local media agent** (folder listing + CORS): **DONE** — `web/media_agent/`.
   - **3c-2 — `media_sources` model + client resolver** — NEXT. Per-user `media_sources
     {id,label,base_url,kind}` in overwrite state; a client resolver that fetches an agent's
     `/list` and builds `base_url + "/files/" + path` image URLs. Server still never sees bytes.
   - **3c-3 — photos slideshow module** — a module driven by any input source through the shared
     picker (`rng.js`), rendering resolved images; play history → append-only events (the picker's
     stats derive from them via `statsFromEvents`).
2. **Slice 3d — youtube (+ sing-along)** — `youtube-nocookie` embed, playlist (public refs) in
   state, transport via bus sinks, wired to the same shared picker.
3. **Themes + voice settings** slice (per-profile) — the foundation piece the interstitials module
   needs; see `docs/modules/interstitials.md`.
4. **Educational interstitials** (generated kind: scheduler + three-quadrant renderer + live graphic
   + Piper TTS), then personal/recorded segments. Then the **dashboard composer**; **Media/Sources
   tab** (surface over `media_sources`). Later: real-time/SSE + call sync; node-editor tab.
