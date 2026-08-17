# Module: wordforge

> A vocabulary game where a wrong answer explains itself — and still pays.

## Purpose
The first **game** on the platform, and the first module that writes to **both** streams.
It exists to prove the architecture end to end: one game plays, and two dashboards that
know nothing about it update themselves.

| stream | what it gets | who reads it |
| --- | --- | --- |
| `points` | an award per answer | [`quests`](quests.md) — the balance moves |
| `gameplay` | one trial per answer, `concept` = the word | [`progress`](progress.md) — what's hard |

Neither stream knows about the other. This module simply writes to both.

## How a round works
Three round types, mixed and capped at `roundLength` (10), each source item used at most
once per round:

- **define** — here's a word, which of four meanings is it?
- **blank** — here's its sentence with the word cut out, which word fills it?
- **better** — two sentences, which is better writing?

## Wrong answers pay, and they explain
This is the design rule the module is built around.

A miss is not worth zero. It reveals the right answer **with the reason** — for a word,
its meaning plus a real sentence using it; for a sentence pair, the actual *why* from the
bank ("the second has a comma splice"). Then it offers `tryPoints` (3, vs 10 for a
correct answer).

**The try points are banked on "Got it", not on being wrong.** The correction is the
thing being rewarded, so the reward is attached to taking it in. Combined with each item
appearing at most once per round, there is no wrong-answer farm to run.

A streak bonus (+5 every 5 correct in a row) is shown live and never applies to a miss.

## Inputs → outputs (on the bus)
- **Sinks:** `wordforge/answer` (option index) and `wordforge/next` — so a keypad, a
  switch, or a companion can play it without touching this module.
- **Emits:** ledger awards (which publish `points/award`) and telemetry trials (which
  publish `gameplay/logged`).

## State & storage
Per-instance state, all editable:

| key | meaning |
| --- | --- |
| `words` / `wordsText` | the bank, as objects or as text in `word \| meaning \| sentence` lines |
| `pairs` / `pairsText` | sentence pairs, as objects or `better \|\| weaker \|\| why` lines |
| `correctPoints` `tryPoints` | 10 / 3 |
| `streakEvery` `streakBonus` | 5 / 5 |
| `roundLength` | 10 |

Both banks fall back to the seeded defaults, and `words` needs at least 4 entries (a
four-way choice needs three distractors). **Editing the bank is itself an assignment** in
this curriculum, which is why the line format is documented rather than hidden behind a
schema.

## What `concept` is set to
- word rounds → **the word itself**, so `progress` can rank which words are shaky.
- sentence-pair rounds → `sentence quality`.

This is what makes "what is he getting and what is he struggling with" answerable.

## How to extend
- **More round types** — synonym/antonym, use-it-in-a-sentence (needs judging).
- **Weight the deck** toward concepts `progress` reports as weak — the data is already
  there; it's a query away.
- **Speak the prompt** through the profile voice, as `sprint` and `educational` do.
- **New games** need nothing new: build a ledger and a telemetry handle from
  `ctx.makeEvents`, use your own `game`/`source` name, and both dashboards pick you up.

## Status
**Tested.** `client/dev/wordforge_test.html` — 47 checks against a live dev server: the
line formats, the scoring rules (a miss pays, pays less than a hit, and never earns a
streak bonus), all three round types and their explanations, and a full played round with
**the real `quests` and `progress` modules mounted on the same profile** — the quest
board's balance matches the ledger exactly, and the progress dashboard lists the game,
counts its trials, and ranks its concepts. Also asserts the try points are **not** banked
until the explanation is acknowledged.

Test note: the harness uses a **seeded** PRNG, not a constant one. A constant `rand` is
deterministic but degenerate — it pins the correct option to the same slot every time, so
"always click the first option" would never once be right and the scoring path for a
correct answer would go untested.
