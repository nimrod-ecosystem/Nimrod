# Module: presslog

> One line: an append-only press log — the demo module that validates the immutable
> event/log/progress storage kind. Not a product feature.

## Purpose
It exists to prove the platform's **append-only** storage kind end to end. Each press records an
immutable event that nothing can overwrite or delete. This is the press-game-data-loss bug made
impossible by design: even if config is re-saved or the module is removed, accumulated activity
survives.

## How it looks / behaves
A running total of presses, a **Press** button, and the most recent few events with timestamps.
It also logs presses that arrive over the shared bus (keyboard, switch, the counter's buttons),
so it demonstrates that the same inputs can feed more than one module. Accessibility-wise it's a
single-action target — exactly what a switch/scan/gaze source drives.

## Inputs → outputs (on the bus)
- **Sources:** its own **Press** button (direct append) and any source feeding `counter/delta`
  (keyboard, switch, counter buttons — wired in `app.js`, not here).
- **Bindings:** none of its own; it reuses the shared `counter/delta` topic.
- **Sinks:** subscribes to `counter/delta` and appends an event per signal.

## State & storage
**Append-only kind** (event/log/progress/clinical): server-side, keyed to
`(user, profile, instance)`. `POST /api/profiles/:pid/events/:stream` appends; `GET` lists
(most recent first, with a total). The server assigns the id and timestamp — the client clock is
never trusted for the record. **Immutability is enforced by DB triggers** that abort any
UPDATE/DELETE; the client `events` handle offers no mutate operation at all. Removing the module
from a profile deletes its config state but **not** these events.

## Privacy notes
The demo logs only trivial `{via}` markers. In a real progress/clinical module this is the kind
that would hold patient data — which stays local and, where AI is involved, runs against local
open-source models only (see `../../DECISIONS.md`). The append-only guarantee is what makes it
safe as a record.

## How to extend
- **Richer events:** pass a `data` object to `events.append(kind, data)`; it's stored verbatim
  as JSON. Add new `kind`s freely.
- **Derived views:** compute over the event list in the module (counts, streaks, last-seen).
  Never mutate history — append a correcting event instead.

## Status
**Tested.** Validated 2026-08-10: append accumulates, ids monotonic, UPDATE/DELETE blocked by DB
triggers, events survive module removal while config is deleted, per-user/per-profile isolation.
Zero console errors. Throwaway demo — a reference for building real event-based modules.
