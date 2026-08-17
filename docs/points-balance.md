# Points balance — what every source pays, per minute

> Update this table when you add or reprice a point source. An economy only means
> something if the exchange rate is roughly consistent; one generous module quietly
> devalues every other way of earning.

## The base rate
**~1 point per minute of real effort.** That comes from the household tracker, not from
nowhere: a school hour is 60 points, mowing the lawn is 60, a bike ride is 30 for ~30
minutes. Anything that pays far above that needs a reason, and anything unbounded needs
a cap.

## The table

| Source | Pays | Realistic rate | Notes |
| --- | --- | --- | --- |
| `sprint` (focus timer) | `workMin × 1` | **1.0 / min** | The reference. A 25-min sprint = 25 points. Paid once, on completion. |
| Task Menu — mow the lawn | 60 | **1.0 / min** | ~1 hour |
| Task Menu — bike ride | 30 | **1.0 / min** | ~30 min |
| Task Menu — dishes | 15 | **~1.5 / min** | ~10 min |
| Task Menu — look up a word | 2 | **~2.0 / min** | The anchor for vocabulary work |
| Task Menu — scan & tag a photo | 1 (×2 for Mom) | **1–2 / min** | ~1 min each |
| Task Menu — Guild Game session | 60 | **~0.7 / min** | ~90 min; a commitment, not an earner |
| `wordforge` | 2 right / 1 try, +3 streak per 5 | **~5 / min**, **capped 40/day** | See below |
| Weekly stretch/overtime top-up | +0.5× / +1.0× on banded hours | tops the base up to 1.5–2.0 / min | Not built yet |

## Why `wordforge` is allowed to pay ~5×
Concentrated recall is worth more per minute than washing dishes, and the Task Menu already
prices "look up a word's meaning" at 2 points — a correct answer is that same act. At ~3
questions a minute that lands near 5 points/minute.

**That rate is the ceiling, and it only works because of the cap.** It is designed to be
parked on a second monitor and dipped into between other things — which is a good way to
learn and a terrible way to price an economy, because left open for six hours it would
out-earn a full day of real work. So:

- **`dailyCap: 40`** — about 20 correct answers, ~8 minutes of play. Roughly 1.5 sprints.
- Past the cap **the game keeps playing and keeps recording trials.** Only the currency
  stops; the learning still counts and `progress` still measures it. The header says
  "daily points reached — still counts for practice."

Capping the currency must never cap the measurement. Those are different questions.

## The rule for a new source
1. Estimate how long the activity really takes, in minutes.
2. Divide the payout by it. If the answer is far above ~2/min, either lower the payout or
   justify it here.
3. If the activity can be repeated indefinitely without effort, **it needs a daily cap**.
   `ledger.todayFrom(source)` gives you what it has already paid today.
4. Add a row to this table.

## Open question: the sprint/hours top-up
`sprint` pays the base rate once per sprint and records its minutes. The weekly banding
(stretch ×1.5 past `X*Y` hours, overtime ×2 past the target) is **displayed as unpaid** in
`quests` and has no job paying it yet. When that lands, school time rises to ~1.5–2.0/min
in the upper bands — still the intended shape, since the whole point of the bands is to
reward pushing past the target.
