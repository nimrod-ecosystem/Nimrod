# Module: quests

> The points dashboard: balance, the task catalog you earn from, the reward store you
> spend into, the log, and the week's school hours — all read from the shared ledger.

## Not to be confused with `progress`
`progress` is a **different** module: the measurement dashboard over the `gameplay`
telemetry stream — accuracy, reaction time, per-concept mastery, session over session,
for **any** game and any player. This one is an **economy**: a balance you earn and
spend, where the number exists to motivate. They share the substrate (a profile-scoped
append-only stream) and nothing else; merging them would force each to pretend to be the
other. See [`progress.md`](progress.md).

## Purpose
`sprint` and every learning game after it append to one shared, profile-scoped `points`
stream. This module is the consumer end of that seam — the thing that makes the points
mean something. It is modelled on the points-tracker spreadsheet a household already
keeps (Task Menu · Daily Log · Rewards Store · Weekly Hours · Dashboard), so the two
stay portable and the spreadsheet can remain the family-readable mirror.

## How it looks / behaves
A balance header (with earned / spent broken out), a week's-hours bar against the target,
then three tabs:

- **Tasks** — the catalog as tappable rows (`name · note · +points`). Tapping one logs it.
  A single **x2** toggle applies only to `double`-eligible tasks (helping family / for
  Mom) and resets after use. Penalty rows carry negative points and subtract.
- **Rewards** — the store. Unaffordable rewards are disabled. Buying takes **two taps**
  (the second confirms) — one misclick should not cost 800 points.
- **Log** — the recent ledger, newest first: when · what (+ which source) · base · x ·
  points. Purchases show negative.

**Nothing here edits or deletes a past entry.** The ledger is append-only, which is the
whole reason a points score can be trusted. A mistake is corrected by logging its
opposite, and the correction stays visible.

**Accessibility / input:** every action is a plain button, and `progress/log` on the bus
logs a task by name — so a switch, a keyboard, a game, or a companion can award points
without touching this module.

## Inputs → outputs (on the bus)
- **Sinks:**
  - `points/award` — the ledger's live nudge. This module **only refreshes** on it. It
    must never append in response, or every point would be counted twice.
  - `quests/log` — `"<task name>"` or `{ task }`; logs that task from the catalog.
- **Emits:** ledger appends only (task logs, purchases), which themselves publish
  `points/award`.

## State & storage
Points live in the shared `points` stream (see `points.js`), **not** here. What this
module owns in its per-instance state is the *catalog*, as data:

| key | meaning |
| --- | --- |
| `tasks` | `[{task, type, base, double, note}]` — the Task Menu. `type` is `Obligatory / Bonus / Idea / Penalty`; negative `base` is a penalty |
| `rewards` | `[{reward, kind, cost, note}]` — the store. `kind` is `Need / Want` |
| `hoursPerDay`, `schoolDays`, `stretchHours` | the weekly X / Y / Z (4 / 5 / 5 → 25-hour target) |
| `pointsPerHour` | school-time rate (60 ≈ 1 point per focused minute) |

Both lists are seeded from the spreadsheet model and are meant to be edited per profile —
a learner modding their own catalog is part of the curriculum, not a config chore.

## Two engines, never double-counted
The spreadsheet model is explicit that discrete tasks and school **hours** are separate
engines "so nothing double-counts". Here:

- A finished sprint pays the **base** rate once, immediately, and records its `minutes`.
- This module sums those minutes for the current week (Monday 00:00 local) and shows the
  band: **base** → **stretch (x1.5 zone)** past `X*Y` hours → **overtime (x2 zone)** past
  the target.
- `hoursBand()` computes the **top-up** the banding would still owe — the *extra* 0.5x on
  stretch hours and 1.0x on overtime, never the base again. That top-up is **displayed as
  unpaid**, not silently added. Paying it automatically at week's end is the next slice.

## Privacy notes
No clinical or private data — task labels, purchases, and point records are ordinary
per-user server state. Optional Google Sheets mirroring is described in
[`../points-sheet.md`](../points-sheet.md); it is opt-in, one-way out, and needs the
owner's own Google account.

## How to extend
- **Weekly top-up job** — apply `hoursBand().topUp` as a single `School` award at week
  close, tagged so it can't be applied twice. That closes the two-engine loop.
- **Points Bank** (savings interest / borrowing) and **purchase history** are further tabs
  over the same stream; the spreadsheet has the math.
- **Sheets sync** — see `../points-sheet.md`. Blocked on Google OAuth.
- **New point sources** need nothing here: build a ledger from `ctx.makeEvents` and
  `award()` with your own `source`. This board picks it up on the next nudge.

## Status
**Tested.** `client/dev/quests_test.html` — 40 checks against a live dev server: the
weekly hours engine (bands, and that the top-up never re-pays the base), catalog and store
rendered from data, task logging, the x2 toggle applying *only* to eligible tasks,
penalties, confirm-to-buy, earned/spent reported apart, the log, and the end-to-end seam —
a **real `sprint` module on the same profile finishing a sprint and this dashboard picking
it up with no manual reload**, plus an explicit check that a bare `points/award` nudge
never creates a record. Live-verified in the dev harness (mounts, 12 tasks, teal `forge`
accent, logging a task moved the balance, clean console).
