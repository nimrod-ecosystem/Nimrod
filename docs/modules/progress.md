# Module: progress

> How someone is actually doing, over time — accuracy per session, and accuracy per
> concept so you can see what they're getting and what they're struggling with.

## Purpose
Ported from the old Cici dashboard's `datadash.js` (a go/no-go assessment over the
`pressgame`/`wordgame` logs) and generalised. It reads the shared `gameplay` telemetry
stream and answers two questions:

1. **Is this getting better?** — accuracy per session, oldest to newest.
2. **What is hard?** — accuracy per **concept**, hardest first, each with a trend arrow so
   *"bad but improving"* reads differently from *"bad and stuck"*.

**This is not a persona-specific screen.** The same instrument serves a response game (a
cue appears, press in time) and a learning game (a question appears, answer it), because
`telemetry.js` gives both the same trial shape. **One person may play games from both
sets** — so the filter is by **game**, never by who someone is. A profile holding a
reaction game and an algebra game shows both in one picker and can view either alone.

It is the counterpart to [`quests`](quests.md): that module is an **economy** (a balance
earned and spent, where the number motivates), this one is a **measurement** (evidence,
where the number informs). They share a substrate and nothing else.

## How it looks / behaves
- **Game / Mode filters** — discovered from the data, so a game appears the moment it logs
  its first trial. Mode chips only appear when the selected game actually has modes.
- **Stat cards** — sessions, trials, accuracy, avg response. Two more appear *only when
  they mean something*: **missed** and **when answered** show up only if misses exist
  (with no misses, "when answered" is identical to accuracy and would be noise).
- **Accuracy per session** — an inline SVG bar chart, themed through CSS variables. Bars
  rather than a line: sessions are discrete sittings, and a line would imply values in
  between that don't exist.
- **Concepts tab** — a bar per concept, hardest first, with `▲ improving / ▼ slipping / –
  flat` and the trial count. Capped at `CONCEPT_LIMIT` (12) with a note saying how many
  were hidden — a truncated list that doesn't say it's truncated reads as "that's all".
- **Bands tab** — accuracy by the content's own difficulty label ("grade 8", a unit name),
  easiest first. **It only appears when the data actually carries bands**, because an empty
  tab teaches nothing. This is explicitly *not* a percentile or a national comparison —
  those need a normed instrument with a sampled population behind them, and inventing one
  would be fabricating a number about a child's education that someone might act on. It
  says only what it knows: how they did on material this content labelled that hard.
- **Sessions tab** — one row per sitting: when, which game, trials, right, wrong, missed,
  accuracy, avg response, length.
- **Export CSV** — the current filter's trials, for handing a teacher or clinician a file.

**Read-only, on purpose.** This module never appends a trial. It refreshes on the
`gameplay/logged` nudge and otherwise polls; games are the only writers, and there's a test
asserting a bare nudge can't invent a trial.

## Inputs → outputs (on the bus)
- **Sinks:** `gameplay/logged` — the live nudge. Refresh only.
- **Emits:** nothing.

## State & storage
No per-instance state of its own; everything derives from the shared `gameplay` stream
(`telemetry.js`). Filters and the selected tab are view state, deliberately not persisted —
they're a question you're asking right now, not a setting.

## The trial shape (what games must log)
One `trial` event per attempt. See `telemetry.js` for the full contract.

| field | meaning |
| --- | --- |
| `game` | which game — the viewer's primary filter. Required. |
| `session` | groups trials into one sitting. Use `tel.session({game, mode})` and it's handled. |
| `mode` | optional variant (`calm` / `challenge` / `practice`) |
| `concept` | **the skill or topic exercised.** This is the field that answers "what's hard" — always set it. |
| `responded` | did they act at all |
| `correct` | was it right (`null` when they didn't respond — "wrong" and "no answer" must never blur) |
| `band` | optional difficulty label the game supplies (a grade, a unit). Drives the Bands tab. |
| `latencyMs` | cue/question → response |
| `waitMs` | how long the game made them wait (pacing) |
| `prompt` | optional human label of the item |

The three outcomes: `responded && correct` → **hit**, `responded && !correct` → **false
alarm**, `!responded` → **miss**. That one vocabulary carries both a go/no-go cue and a
school answer, which is what lets both live in one stream.

For a game author:
```js
const tel = createTelemetry({ makeEvents: ctx.makeEvents, bus });
const s = tel.session({ game: 'wordforge', mode: 'practice' });
await s.trial({ concept: 'salvage', responded: true, correct: false, latencyMs: 2400 });
```

## Two accuracy measures
`accuracy` = hits / **all** trials (a miss counts against you). `whenAnswered` = hits /
trials answered (misses excluded). A wide gap between them means the problem isn't
knowing — it's not responding. That distinction is the reason the old go/no-go screen
tracked omissions separately, and it's preserved here.

## Sort order for concepts
Lowest accuracy first; ties broken by **trend urgency** (slipping before flat before
improving), then by trial count, then alphabetically so the list doesn't jitter between
renders. "50% and falling" needs attention before "50% and climbing", and the list is read
top-down.

Trends stay `null` until there are at least 3 trials per half — a confident arrow drawn on
3 data points is a lie.

## Privacy notes
Game performance, not clinical data — this platform holds no diagnoses, medications, or
notes. The `gameplay` stream mirrors to a Google Sheet alongside the points ledger; see
[`../points-sheet.md`](../points-sheet.md).

## How to extend
- **Port the Cici games** (`pressgame`, `wordgame`) to log trials here — their existing
  hit/omission/commission vocabulary maps straight onto the trial shape.
- **Concept drill-down** — click a concept to see its trials and prompts.
- **Per-concept sparklines** in the concept rows, once there's enough history.
- **Server-side rollup** when the 1000-trial window is outgrown.

## Status
**Tested.** `client/dev/progress_test.html` — 54 checks against a live dev server, seeded
with a **reaction game and a learning game on the same profile** (the both-sets case): the
unified trial shape and its three outcomes, both accuracy measures, concept trends
(improving / slipping / flat / not-enough-data), the urgency sort, session grouping, game
and mode filters, the chart, the sessions table, that a bare nudge never creates a trial,
and that telemetry never leaks into the points ledger. Live-verified in the dev harness
with real logged trials: `salvage 33%` sorted above `tolerance 100%` and `obsolete 100%`.

**`wordforge` writes to this stream** (see [wordforge.md](wordforge.md)); the Cici games
(`pressgame`, `wordgame`) are still to be ported.
