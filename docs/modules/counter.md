# Module: counter

> One line: a throwaway module that validates the shared-systems boundary (the bus + per-user
> server-side state). Not a product feature.

## Purpose
It exists to prove the platform's spine works end to end before any real module is built:
a module that talks to the world *only* through the bus and the state handle, with the server
as the single source of truth. If the counter behaves, the boundary is right.

## How it looks / behaves
A big number with **+** / **–** buttons. In the dev harness (`web/client/index.html`) it can
also be driven by the keyboard (`+` `–` or `↑` `↓`) and a simulated switch/remote button.
Those extra inputs live in `app.js`, **not** in the module — that's the point: any input
method can drive it. Accessibility-wise this is exactly the pattern a real module uses (a
switch, scan, gaze, or voice source feeds the same topic with no module change).

## Inputs → outputs (on the bus)
- **Sources:** the module's own on-screen buttons (`counter-buttons`). The harness adds two
  more — `keyboard` and `switch` — with zero edits to this module.
- **Bindings:** each source maps to the topic `counter/delta` and reshapes its raw event into a
  numeric delta (buttons → `±1`; keys → `+1/-1` for `+`/`↑` and `-`/`↓`; switch → `+1`).
- **Sinks:** one — `counter/delta`. The handler adds the delta to the current value and writes
  it to state. This is the module's entire downstream contract and never changes.

## State & storage
Server-side, keyed to the account, via the state handle: `{ "count": <number> }` under module
`counter`. Reads on open (`GET /api/state/counter`), writes debounced (`PUT`). The client holds
an in-memory mirror only — **no `localStorage`/IndexedDB**. Two devices as the same user
converge (interim: dirty-guarded polling); different users are fully isolated.

## Privacy notes
Touches no private/clinical data — just an integer. No cloud AI, no media. (A real patient
module that touched clinical data would run against local, open-source models only; that rule
lives in `../../DECISIONS.md`.)

## How to extend
- **Add an input method:** register a source and a binding to `counter/delta` in `app.js`.
  Don't touch `counter.js`.
- **Change what's stored:** edit the state shape in `counter.js`; the server and store are
  schema-agnostic (opaque JSON), so nothing server-side changes.

## Status
**Tested.** Validated 2026-08-10: two-tab same-user convergence, per-user isolation, no local
store of record, and three independent sources driving one unchanged sink. Zero console errors.
Throwaway — will be removed or kept purely as a reference once real modules land.
