# Module: sprint

> A focus timer (Pomodoro) whose finished work blocks bank points into a shared,
> profile-wide ledger — the first point SOURCE on the platform.

## Purpose
Some users run their day as a points game: a block of focused work earns points, points
buy rewards, and a dashboard shows the totals. That only works if every point source —
a timer, a learning game, a chore, a tagged photo — writes the same record. `sprint` is
the smallest honest source, so it is where that shared record (`client/points.js`) gets
proven by something real instead of a stub.

For a learner this is also the day's spine: pick a task, run a sprint, take the break the
timer gives you, and the points arrive without anyone tallying them by hand.

## How it looks / behaves
A phase label, a large countdown, a task field, and three buttons — **Start/Pause**,
**Skip**, **Reset** — plus a multiplier picker and a footer showing the cycle position
and today's total.

- **Phases:** `work` → `break` → `work` … with a `long` break every *N*th sprint
  (default 4). Breaks start automatically; nothing needs clicking between phases.
- **Finishing a work block awards points. Skipping one does not.** A skipped sprint
  emits `sprint/done` with `points: 0` — quietly paying for work that didn't happen
  would make the whole ledger untrustworthy.
- **Phase changes are spoken** in the profile's voice (`voice.js`), so the timer works
  without watching it.
- **Accessibility / input:** the module opens ONE sink, `sprint/control`. Its own
  buttons are just one source bound to that topic, so a keyboard, a switch, a physical
  button, a scan/gaze setup, or an AI companion can drive it by publishing
  `start` / `pause` / `toggle` / `skip` / `reset` — no change here.

## Inputs → outputs (on the bus)
- **Sources:** `sprint-buttons` (its own three buttons) — and anything else that
  publishes to the topic below.
- **Bindings:** `sprint-buttons/press → sprint/control` (payload = the action string).
- **Sinks:** `sprint/control` — `start | pause | toggle | skip | reset`. Accepts a bare
  string or `{ action }`.
- **Emits:**
  - `sprint/done` — `{ phase, reason: 'ended'|'skipped', points, task, cycle }`
  - `points/award` — via the ledger, on every finished work block (see below).

## The points ledger (shared, and why it lives outside this module)
`client/points.js` defines the platform's points seam. It is **not** part of this module,
because games and other sources will use exactly the same one.

- **The record** is a **profile-scoped append-only stream** named `points`, reached with
  `ctx.makeEvents('points')`. Per-instance handles (`ctx.events`) are keyed to a single
  module instance, so a source's points would be invisible to a dashboard instance; a
  well-known shared stream key fixes that with **no server change** (the API's stream key
  is just a string). Append-only means points can't be silently edited away.
- **The nudge** is the bus topic `points/award`, so a mounted dashboard can react
  instantly rather than waiting for its next poll.
- **The rule:** only the SOURCE appends. A consumer that both listened on the bus and
  appended would double-count. Consumers read the stream for truth, the bus for
  immediacy. `ledger.award()` does both halves exactly once.
- **Event shape** — kind `points`, data `{ amount, mult, source, tags, note }`. The
  server stamps `id` and `created_at`; the client clock is never the record.

## State & storage
Per-instance overwrite state (`ctx.state`, server-side, per user+profile):

| key | meaning |
| --- | --- |
| `workMin`, `breakMin`, `longBreakMin` | phase lengths in minutes (25 / 5 / 15) |
| `cyclesBeforeLong` | sprints per long break (4) |
| `pointsPerMin` | points per work minute (1 — one point ≈ one minute of focus) |
| `mult` | current multiplier (1, 1.5, 2) |
| `task` | the current task label, carried into the ledger record |
| `phase`, `endsAt`, `remainMs`, `cycle` | the live run |
| `resumeGraceMin` | how stale a passed deadline may be and still pay (60) |

The **deadline (`endsAt`) is persisted**, so a reload mid-sprint resumes where it was
instead of restarting. A deadline that passed while the tab was closed still counts if it
ended within `resumeGraceMin`; older than that the sprint **expires with no points** and
says so on screen — the timer measures focused work, and a sprint abandoned yesterday
wasn't that.

Points themselves are **not** stored here; they go to the shared `points` stream.

## Privacy notes
No clinical or private data. Task labels and point records are ordinary per-user state on
the coordination server, same as any other module's. No media, no audio recording; speech
is local synthesis (Web Speech now, Piper later).

## How to extend
- **A points/quest dashboard** is the natural next module: read the same shared stream
  with `createPointsLedger` (or plain `ctx.makeEvents('points')`), subscribe to
  `points/award` for live updates, and render totals, goal lines, and a reward store.
  `sumPoints` / `sumBySource` / `sumPointsOn` in `points.js` are the math, already tested.
- **Learning games** become point sources by doing exactly what this module does: build a
  ledger from `ctx.makeEvents`, and `award()` on a correct answer with their own `source`.
- **Config UI** — phase lengths and `pointsPerMin` are already state keys with sane
  defaults; they just have no settings panel yet.
- **Director segment** — the timer is a leaf module today. Making it a segment provider
  (emitting `segment/done`) would let the Lineup surface it during a school-day daypart.

## Status
**Tested.** `client/dev/sprint_test.html` — 54 checks against a live dev server with an
injected clock: the pure phase/points math, the ledger (append, live nudge, shared-stream
visibility, no double-write to the instance stream), the full phase machine over the bus,
pause/resume, skip-earns-nothing, the multiplier, and remount behavior (resume mid-sprint,
grace-window payout, stale expiry). Live-verified in the dev harness with real time: the
countdown ticks, a full page reload resumes mid-sprint with the task label intact, and the
`forge` theme re-skins it with no module change.

Known bound: ledger totals are derived from the most-recent `limit` events (default 1000).
That is months of real use, but it IS a window — when it's outgrown, the fix is a
server-side rollup endpoint, not a cached client total (a cached total can drift from an
immutable log; a derived one can't).
