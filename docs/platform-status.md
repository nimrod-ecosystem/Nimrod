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
1. **Shared weighted picker** — `web/client/rng.js` (seedable PRNG + Fisher–Yates + the weighted
   draw), unit-tested deterministically. First piece of the photos slice.
2. **Slice 3c — photos + local media agent** — the agent (folder listing + CORS), the
   `media_sources` model + resolver, and the slideshow driven by any input source, using the picker.
3. **Slice 3d — youtube (+ sing-along)** — `youtube-nocookie` embed, playlist (public refs) in
   state, transport via bus sinks, wired to the shared picker.
4. **Themes** slice (per-profile). Then the **dashboard composer**. Later: real-time/SSE + call sync;
   node-editor tab.
