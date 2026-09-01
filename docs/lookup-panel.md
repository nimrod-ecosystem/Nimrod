# Word lookup — spec

A search bar inside Word Forge, several sources behind it. Decided 27 Aug 2026; not built.

See [`module-input-spec.md`](module-input-spec.md) for the module contract this sits inside.
Longer version with the full evidence:
<https://claude.ai/code/artifact/d7cbc692-e2d4-4f59-ac49-22c52b979982>

---

## Two users want opposite things

This is the finding that shapes everything else, and a single dictionary cannot serve both.

| | The patient | The family member |
| --- | --- | --- |
| Looking up | everyday words — *cold, swallow, tired* | terms heard from a clinician — *vasospasm, dysphagia* |
| Needs | short, plain, one clear meaning | accurate and complete, jargon explained |
| Input | possibly a single switch | a phone keyboard, at 2am |
| Privacy stake | high — these are their deficits | their family's diagnosis |
| Right source | **local, offline** | **network, opt-in** |

## What the data showed

Run against Open English WordNet 2024 and the live APIs, not assumed.

- **OEWN returns zero senses for `vasospasm`.** Zero for `subarachnoid`. It is a general-English
  lexicon and was never a medical vocabulary. Bundling it alone ships something that breaks on
  the first word a family member types.
- **Its glosses are the wrong register.** `water` → *"binary compound that occurs at room
  temperature as a clear colorless odorless tasteless liquid; freezes into ice below 0 degrees
  centigrade…"*. `cold` has 16 senses; the third is the head cold.
- **The sense ordering is actively misleading.** `swallow` returns, in order: a small amount of
  liquid food; the act of swallowing; **a migratory songbird**; and only fourth, *"pass through
  the esophagus as part of eating or drinking."* In a care setting where dysphagia is a live
  concern, the meaning anyone wants is behind a bird.
- **Wikipedia's REST summary API answers the medical case cleanly** — CORS-open, no key, works
  from the browser, returns a good paragraph on cerebral vasospasm.
- **MedlinePlus does not.** Its health-topic search returns 0 for `vasospasm`, sends no CORS
  header (so it needs a server-side proxy, putting families' medical searches through our
  server), caps at 100 requests/minute per IP, and its terms say not to copy its pages.

> **Never display `synsets(word)[0]`.** Rank by part of speech first, then sense frequency —
> `lemma.count()` carries SemCor tallies. Where confidence is low, show two or three senses
> rather than guessing at one.

## Sources

Each source is **a folder you point at**, exactly like media sources and symbol sets — a label
and an address on the user's own machine. No registry, no plugin system, no install flow. This
matches what `module-input-spec.md` already anticipates under *Distribution*: the platform stores
a reference rather than hosting bytes.

The picker is a **filter, not a dropdown** — check as many as you want. Someone looking up
*vasospasm* plausibly wants the dictionary *and* Wikipedia: one tells them the word, the other
tells them the thing.

| Source | Where it runs | Role |
| --- | --- | --- |
| **Simple English Wiktionary** | on device | **default.** Restricted defining vocabulary — the right register |
| **Open English WordNet** | on device | fallback for words Simple English misses |
| **Wikipedia summary** | network, opt-in | the family member's source; the medical case |
| MedlinePlus | network, opt-in | **link-out only**, to a condition page. Not a definition source |
| Your own AI | depends | the catch-all; the only one with no coverage gaps |

**Stack results with a heading per source. Never merge them** — a blended definition assembled
from a dictionary and a language model is unattributable, and in a medical context that is the
one property it cannot lack.

**AI answers are labeled as AI-generated wherever they appear**, and AI is not the default for
medical terms. In a care context an invented definition is a real harm, not a bad search result.
Both are defaults, not rules — anyone who wants it first can set that.

## Licensing

| Source | License | Requires |
| --- | --- | --- |
| Princeton WordNet | WordNet License | keep the notice; don't use Princeton's name to promote Nimrod |
| Open English WordNet | CC BY 4.0 | attribution only, no share-alike |
| Wiktionary / Wikipedia | CC BY-SA 4.0 | attribution; the **data** stays share-alike if redistributed |

**Share-alike attaches to the data file, not to the code that reads it.** Ship dictionary data in
its own folder with its own `LICENSE`; the repo's top-level `LICENSE` stays MIT; one sentence in
the README says which is which.

## Getting the data shippable

Full English Wiktionary extracted is 22.9 GB uncompressed / 2.6 GB compressed — but that is the
wrong file. It carries every language section with etymologies, translations, pronunciations,
inflection tables and quotations, almost none of which is a definition. Simple English is a
separate, far smaller wiki.

Preprocess once, as a repeatable script in the repo rather than a manual pass: English entries
only; keep headword, part of speech, and glosses; drop everything else; cap at three senses per
word; emit **SQLite FTS**.

FTS rather than a JSON map because **fuzzy matching is required** — someone who *heard*
"vasospasm" will type "vaso spasm" or "vasospazm", and exact match fails them at the moment they
are least able to cope with failure.

Measure before committing: run the filter, then check coverage against the AAC core vocabulary
plus fifty terms from discharge paperwork. Coverage on the real list decides this, not file size.

---

## Lookup inside the game

A lookup control beside each multiple-choice answer, opening the panel with that word already in
the box — no typing, which matters when typing is the barrier. The question is then worth 10% less
per term looked up.

| What the player does | Score |
| --- | --- |
| Correct, no lookups | 100% |
| Looks up 1, correct | 90% |
| Looks up 3, correct | 70% |
| Looks up all 4, correct | **60%** |
| Guesses wrong | 50% |

> **The invariant that makes this work: reading never scores worse than guessing.** Even maximum
> lookup use beats a wrong answer. Keep that property if the numbers are ever tuned — it is what
> is doing the work, not the 10%.

- Deduct from **the question, never the running total.** A total that goes down reads as
  punishment for curiosity.
- The rate is a setting; 10% default, zero permitted. Early in recovery, looking a word up *is*
  the learning.
- **After answering, show all four terms with definitions on one page** — brief summary or full,
  user's choice. Distractors are the underrated half of multiple choice: the player has just spent
  real attention weighing four words and is most primed to absorb the three they didn't pick.

## Adding to the word list

- Toggle sits **directly under the search bar, off by default, and remembers its state.**
- **No caregiver review queue.** A patient who knows their lookups land on a list a caregiver
  reads will stop looking things up; embarrassment is a stronger force than curiosity, and the
  feature exists to serve curiosity. Anyone able to run a search can work one toggle beneath it.
- Dedupe on a normalized, lemmatized key so *running* doesn't land beside *run*. If it's already
  there, **say so** — silence reads as a broken button — and **bump its review order**, because
  reaching for a word twice means it hasn't stuck.

## Weights belong to the shared picker

`web/client/rng.js` already exists — the seedable weighted draw over freshness × recency ×
duration × channel-diversity, with stats derived from append-only events. **Word difficulty feeds
that, rather than living in Word Forge**, so any module selecting from a pool inherits the
behavior.

| Signal | Weight |
| --- | --- |
| answered wrong | up |
| answered right | down |
| looked up | up — reaching for it means it isn't known |
| right several times running | down sharply |
| time since last seen | up slowly |

**Default weight 1.0 must leave existing behavior identical** — photos and youtube draw exactly
as they do today unless something sets a weight.

Don't invent the curve. Spaced repetition is solved ground — Leitner, SM-2, or FSRS — and any of
them expresses as a weight the existing picker consumes.

> **One adjustment for this population.** Pure "wrong means more often" fills the session with
> words the person keeps failing, which is demoralising exactly where confidence matters most.
> Cap any single word's weight and deliberately interleave words they reliably know.

---

## The AAC board's search is a different search

Not "search my cards" — **search a symbol dictionary to build a card.** Pull a symbol, attach it
to a button. That's making vocabulary, not looking words up, and it wants its own source list.

| Symbol set | License | Approx | Note |
| --- | --- | --- | --- |
| **Mulberry** | CC BY-SA | ~3,000 | **default** — freely redistributable *and drawn for adults* |
| Global Symbols | CC BY-SA | — | aggregator, multilingual |
| OpenMoji | CC BY-SA | ~3,000 | open and broad, not AAC-specific |
| ARASAAC | CC BY-NC-SA | ~13,000 | largest; **non-commercial** |
| Sclera | CC BY-NC | ~11,000 | **non-commercial** |

Mulberry is the default because most symbol sets are drawn for children, and an adult stroke
patient handed a cartoon meant for a preschooler is being told something about how they are seen.
NC licensing would also quietly stop anyone reusing Nimrod in a paid care setting.

**This is a default, not an exclusion.** Special-needs children are squarely in the audience, and
for them ARASAAC's 13,000 child-oriented symbols are an asset rather than a fallback. **Symbol set
is a per-profile setting**, with NC terms stated when such a set is connected.

## AAC vocabulary does not flow into the practice list by default

A setting, default off. Needing an AAC card for "cold" says nothing about whether the person knows
the word — auto-flowing would stuff the game with vocabulary they already have and read as
condescending. One vocabulary store with per-surface flags, not separate lists.

## Still open

- Lemmatizer for the dedupe key — small and offline. WordNet's morphy if OEWN ships anyway.
- Whether looked-up words are **re-queued at full value** in a later round instead of only being
  deducted. Ends the loop in earning points rather than losing them, which is a better shape for
  someone rebuilding confidence. Worth trying both on a real session.
- Whether lookup history is stored at all. Currently: an option, off by default — off keeps the
  no-review-queue promise structurally true rather than merely policy.
