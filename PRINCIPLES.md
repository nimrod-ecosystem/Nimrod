# PRINCIPLES.md — DRAFT, NOTHING HERE IS RATIFIED

> **Status: opened 2026-08-29. Every line below is a candidate.** Nothing in this file is binding
> until Mike marks it ratified with a date. Read §0 before reading anything else — it is the reason
> this file exists, and it governs how the rest of it works.
>
> This file is in the **public** repo. It carries no third-party names, no outreach material, and no
> clinical detail about any individual. Quotes sourced to private documents are principle statements
> only, reproduced without their surrounding context.

---

## §0 — GOVERNANCE: how something becomes a rule here

This section is first because it is the actual problem this document was opened to solve.

**The failure it fixes, in Mike's words (2026-08-29):**

> "Too many absolute statements were being dropped into the docs without my knowledge and then I'd
> get pushback for trying to do something reasonable."

That is a governance failure, not a design disagreement. An absolute written into a design doc by
whoever happened to be drafting it acquires the authority of a decision without ever having been
decided, and then it is quoted back at the person it was supposed to serve.

### The three rules that fix it

**1. Only Mike declares an absolute.** Anyone may propose one. Nobody else ratifies one. An absolute
is real only when it appears in §2 of this file with his sign-off and a date.

**2. An absolute-sounding sentence anywhere else is a draft opinion, not a rule.** `never`, `always`,
`must`, `must not`, `no exceptions`, `ever` appearing in a design doc, a decision log entry, a code
comment or a chat message carries no authority on its own. It is a proposal for §2 and should be read
as one. This is checkable: search a document for those words and every hit is either already in §2,
or it is a draft that needs softening or promoting.

**3. Every absolute names its scope.** An absolute with no scope is the most common way a reasonable
thing becomes forbidden. Scope is one of:

| scope | meaning |
|---|---|
| `project` | true everywhere Nimrod runs, including someone's garage |
| `deployment-class` | true for a named class of deployment — e.g. an unattended bedside kiosk in a care facility — and not elsewhere |
| `module` | true inside one module |

The reason scope is mandatory is the thing Mike raised, and it generalises past this project: **what
counts as contamination depends entirely on the job.** A surgeon's standard of clean would stop an
engineer working; an engineer's would kill a patient. Neither is wrong. A rule that is correct for a
screen sitting unattended in a care facility for days can be actively harmful applied to a hobbyist
wiring an ESP32 to a lamp — and this project serves both, deliberately.

*(Mike attributes the doctor/engineer formulation to Crowley. I could not verify the wording or the
source and have not reproduced it as a quotation. If the original turns up it belongs here.)*

### The default

**When in doubt, it is a setting with a sensible default — not a rule.** Standing preference,
long-established in this project, and the thing two separate corrections on 2026-08-27 were about.
Preserve the edge case and the less-obvious user. If you catch yourself writing "never," it is
probably a setting.

---

## §1 — THE RANKED PRINCIPLES

Ranking is the whole point. Principles that never conflict do no work; the ordering is what settles
a case where two of them pull in opposite directions. **Proposed ordering is Mike's, 2026-08-29.**

Each principle needs three things before it can be ratified: what it means, **what it costs** — the
attractive thing it makes you say no to — and where it already operates in the existing docs. A
principle that has never cost anything is decoration.

---

### 1. FIRST, DO NO HARM

**Mike's, 2026-08-29**, clarified by him the same day. This is **not** a principle about caution,
and it is worth saying so at the top, because read as "avoid risk" it would defeat every principle
below it forever — building nothing is always the lowest-risk option, and that reading would have
prevented this project existing. The person it was built for was harmed by *absence*, by a room with
nothing in it but a wall.

**What it actually means, in Mike's words:** *"not to give people seizures or steer them in an
inadvisable direction. I'd hate to end up in a situation like the movie The Jerk where he finds out a
design flaw in his glasses handle hurt a lot of people."*

So this is product safety, not prudence. Proposed wording:

> *The software must not injure the person using it, and must not steer them — including through a
> defect that looks harmless to everyone except the person it harms.*

**Why this population makes it sharper than it sounds.** The ordinary defence against a defect like
that is that users report it. Here, many of them structurally cannot. Somebody who cannot press a
button also cannot tell you the screen is hurting them, and a caregiver watching from across the room
sees nothing. **Absence of complaint is not evidence of absence of harm**, which means the checks have
to be proactive rather than reactive — this is the one principle that cannot be enforced by listening.

**Concrete instances already in the docs, which is what makes this real rather than a slogan:**

- **Seizures.** Photosensitivity is already a functional-profile field. Flash-rate and contrast limits
  belong in the shell where every module inherits them, not in each module's good intentions.
- **Steering.** *"It shapes what people say. Offer 'fine' after 'I'm' and people say fine. AAC users
  have written about being steered by their own devices toward the easy sentence rather than the true
  one."* — word prediction, default off. That is this principle already operating.
- **Steering, second case.** *"AI is not the default source for medical terms — in a care context an
  invented definition is a harm, not a bad search result."* — `DECISIONS.md`, 2026-08-27.
- **The exact Opti-Grab shape, already found once.** From the private connections design, on the
  spoken prompt "say decline": *"a prompt that is safe for the general case can be an INSTRUCTION to
  the specific person the product was built for."* Automatic command following after brain injury
  turns a helpful prompt into a trap aimed precisely at the intended user. **That is the failure mode
  this principle exists to catch, and it was caught by someone thinking about it rather than by a
  test.** Which is the argument for making it principle 1.

**Where it already operates:**

> "A SCREEN MUST NEVER ENTER A STATE THAT ONLY AN INPUT CAN LEAVE, WHEN THE PERSON IN FRONT OF IT
> CANNOT GIVE THAT INPUT." — `AGENTS.md`, signed off 2026-08-28

That is this principle in its enforceable form, and it is the best example in the repo of a real
absolute: it is scoped, it was declared deliberately, it has caught actual bugs, and it was
*narrowed* once already when a stronger version turned out to forbid reasonable things (a game where
blowing into a straw keeps a windmill turning; a person who wants an "are you still watching?"
prompt). That narrowing is the model for how every absolute in §2 should be treated.

**What it costs:** _(Mike to fill — what has this made you refuse?)_

---

### 2. KEEP FAITH WITH THE PERSON WHO CANNOT OBJECT

**Mike's second, 2026-08-29, given as "retaining ethics" — this is a proposed reading of it and the
wording is his to correct.**

The population this serves includes people who cannot consent, cannot complain, cannot leave, and
cannot check what was done in their name. Nearly every ethical position already recorded in this
project is a specific case of not taking advantage of that.

**Where it already operates:**

> "A guardian has legal authority over a person's care. That is not the same as moral authority over
> that person's public representation." — private design context, §15

> "The person on the screen can see what is happening. … Someone who cannot object still deserves to
> know." — private design context, §15

> "A refusal signal always works. Whatever access method a user has … one of the things it must
> always be able to say is *stop*, and that has to work even when nothing else is configured."
> — private design context, §15

> "Everything done while acting-as is attributed to the guardian, not to the guarded account." …
> "Acting-as is logged and shown, because visibility is the only safeguard left when revocation is
> not available to the person concerned." — private connections design

> "The screen can report what it is showing; nobody can report how she is without being in the room.
> A product that guessed would be lying to the people who care most." — private connections design

**A correction that belongs here, Mike's, 2026-08-29.** The existing rule that no image or recording
of one named person is ever used to demonstrate or promote the project is **withdrawn as a
person-specific rule** and generalised:

> **Anything afforded her is afforded to any user.**

This is strictly better and it is a principle rather than an exception. No user gets a protection
that others do not. The operative rule that replaces it is the general one already written:

> "the software should never be the reason a private moment became public" — private design context, §15

with demonstration material made using people who understood the question and said yes.

**What it costs:** _(Mike to fill)_

---

### 3. BUILD EVERYTHING, WITHHOLD NOTHING

**Kept, Mike's explicit instruction 2026-08-29.** The oldest principle in the project and the one he
has defended most often.

> "build everything, withhold nothing; restrictions are per-deployment configuration, never removed
> capability." — `decision_log.md`, 2026-08-26

**Consequences that follow from it, already recorded:**

> "Local is the default; cloud is always available; the choice is explicit and per-job."
> — `decision_log.md`, 2026-08-26

> "Users may do whatever they want with their own data — restated and final."
> — `decision_log.md`, 2026-08-27

> "The third-party teacher bot is governed by architecture and warning, not by a ban."
> — `decision_log.md`, 2026-08-27

**What it costs:** it makes the project harder to explain, harder to certify, and it means shipping
capabilities that some deployments will have to switch off rather than never building them.

**Note on its rank.** Placing it third is a real decision with a real consequence, and it resolves a
live contradiction in the current docs — see §3, Conflict A. Below principles 1 and 2, "withhold
nothing" yields when a capability would harm the person on the screen or would let someone act on
them invisibly. That is what makes the existing "no one-tap share to social platforms" survivable as
a rule rather than being a straight violation of this principle.

---

### 4. TAKE ONLY WHAT IS GIVEN FREELY, AND KEEP IT INTACT

**Mike's, 2026-08-29:** *"Data integrity and only taking what is given freely for the sake of helping
others."*

Two halves that reinforce each other. **Given freely** — nothing is collected as a condition of using
the software, nothing rides in on a permission granted for something else, and the purpose is other
people's benefit rather than the project's. **Kept intact** — what is recorded is what happened, not
a tidied version of it, because the whole value of the record is that it is honest.

**Where it already operates:**

> "Nimrod does nothing with anyone's data. No research handling, no repository, no instance to run,
> no telemetry, no aggregation. Not smaller versions of those — none of them." — `DECISIONS.md`,
> 2026-08-27

> "Store only what a preference needs in order to be a preference." — `DECISIONS.md`, 2026-08-27

> "Anything added later arrives switched off and needs its own separate opt-in." — `DECISIONS.md`,
> 2026-08-27

**Restated by Mike 2026-08-29, and this is the sharper version:** users decide where their data goes
by picking folders, and **Nimrod should not have anywhere to save it.** The local media agent is the
built precedent — the platform server never receives the bytes.

**The integrity half, already operating:**

> "`unknown` … must be distinct from `none`. Not recorded and recorded-as-independent are different
> facts, and collapsing them inflates every independence number in the dataset." — private session model

> "Collapsing any two of these corrupts every denominator built on top." — `decision_log.md`,
> 2026-08-27, on the four distinct non-answers

> "'Anonymous' is not a property you can promise." — private session model

> "Structure is not correctness. Ask what your test would still pass on if the code were wrong."
> — `AGENTS.md`

**What it costs:** _(Mike to fill)_

---

## §2 — THE REGISTER OF ABSOLUTES

This is the only place in the project where a hard rule lives. An absolute enters this table when
Mike says so, with a date and a scope, and it leaves it only by being explicitly retired here.

| # | the rule, verbatim | scope | declared by | date | what it costs |
|---|---|---|---|---|---|
| 1 | **If a module probes judgment, being wrong must not be degrading.** | `project` | Mike | 2026-08-30 | The sharpest tests. A wrong option that is absurd or unpleasant separates judgment from command-following more cleanly than one where both choices are dignified. This trades some discriminating power for not humiliating anyone, and that trade is accepted. |
### An absolute 2 was recorded here and then WITHDRAWN — 2026-08-31

*"Being wrong must not be invisible"* was entered in this table on the strength of Mike saying
*"that sounds good"* to a phrasing. He then read it back and said he was not clear what it was or
whether it was necessary — **which settles it.** An absolute nobody can restate cannot be checked
against, and §0 says only Mike declares one. "That sounds good" to a sentence is not a declaration.
Withdrawn, and the entry number is not reused.

**On the merits it also failed the test**, which is worth recording so it is not re-proposed
unchanged: a reasonable module could want a wrong input to pass quietly, so a case against it exists.
That makes it **a good default, not an absolute** — which is this project's own standing rule about
what belongs in a register at all.

**The substance survives as a decision, where it belongs**, in the *Acknowledgement is not
communication* entry in `DECISIONS.md`: an unmapped input does nothing, a mapped-but-wrong input
still gets a response, and the reason is that for someone learning what a button is, the mistimed
press *is* the learning event.

**The lesson for whoever maintains this file.** The register's failure mode is not that a bad rule
gets in. It is that a **plausible** one does, on an agreeable noise rather than a decision, and then
gets quoted back at people. That happened here within one day of the register existing, and it was
caught only because Mike read his own entry and said he did not understand it.

### Notes on absolute 1

**Where it came from.** Mike's example, offered as a hypothetical: testing whether someone at the
command-following stage has judgment by giving them something they ought to refuse — food that is
obviously not food. **Correction, 2026-08-30: an earlier version of this note said the example was
drawn from a real practice. That was not established, and it should not have been written down as
fact.** No such practice has been verified. The example stands on its own as an illustration, and
the rule does not depend on it having happened.

What *is* documented, and is the nearest real thing, is that standardised assessment of disorders
of consciousness includes deliberately noxious stimulation — the CRS-R and the Glasgow Coma Scale
both score response to pain, and there is an active clinical literature on pain and nociception in
this population. That is a genuine ethical tension in the field, but it is not the same thing as
degradation, and conflating them would weaken the rule rather than support it.

The underlying clinical question is legitimate and already recorded in this project as *command
following is not comprehension*.
Distinguishing "does what it is told" from "has judgment" genuinely matters. **The degradation is
not required by the question.** Offer the empty cup and the full one, the shoe and the sandwich —
the person who reaches wrong has told you the same thing, and nobody was humiliated to find out.

**The applicability test**, so this is checkable rather than decorative. For any path where a person
can be wrong, ask: *would someone who chose it feel foolish, exposed, or diminished — in front of
whoever is in the room?* Degradation is social, not private, which is why the room matters and why
the session roster is the right place to reason about it. A reviewer can walk every wrong-answer
path and answer that question.

**It extends to agent principals.** Baiting an agent into refusing by constructing a task it ought
to refuse is the same shape: using something as an instrument in a way it cannot decline. See the
2026-08-30 entry in `DECISIONS.md`.

**Candidates awaiting a ruling.** A sweep of the existing documents on 2026-08-29 found roughly 320
statements written in absolute form across the design docs and decision logs. They are being
assembled into an inventory for Mike to rule on rather than listed here, because most will turn out
to be settings and this file should end up short.

The three strongest candidates, all of which look like genuine `project`-scope absolutes:

1. The safety invariant, quoted in §1.1 above. Already declared and signed off, and the only one in
   the project that arrived through anything resembling this process.
2. The boundary statement — that Nimrod is not a medical device, not a nurse call system, not for
   emergencies, and does not summon help; that environmental control is a convenience rather than a
   safety system; and that a board must never be the thing someone uses to summon help.
3. "Never auto-detect or interpret an alarm." — private design context, §7.

Everything else is a candidate like any other, including things that read as obviously correct. Mike
has asked to see all of them rather than a filtered subset.

---

## §3 — LIVE CONFLICTS

Named, not resolved. A conflict here means two statements currently in the docs that cannot both be
followed. Resolving one means editing or retiring a document, which is Mike's call.

**A. "Withhold nothing" versus permanently removed capabilities.**

> "build everything, withhold nothing; restrictions are per-deployment configuration, never removed
> capability." — `decision_log.md`, 2026-08-26

> "No one-tap share to social platforms. Ever. Not as a convenience, not as a setting."
> — private design context, §15

The second is a removed capability and explicitly not a setting, which is exactly what the first
forbids. **The proposed ranking in §1 resolves this** — principle 2 outranks principle 3, so a
capability that would make it frictionless to expose someone who cannot object is one of the few
things "withhold nothing" yields to. Needs Mike's confirmation that this is the intended reading.

**B. Two decision logs, same date, opposite answers on data.**

`DECISIONS.md` (public repo) records that Nimrod does nothing with anyone's data — no telemetry, no
aggregation. `decision_log.md` (private) records session rosters, cue level as a recorded field, five
provenance columns on every trial, and a local-aggregate pipe. Both dated 2026-08-27.

**Mike ruled on 2026-08-29 in favour of the `DECISIONS.md` line**, extended: users pick folders and
Nimrod has nowhere to save anything. The private decision log needs a superseding entry so the
contradiction does not resurface.

**One piece survives the ruling and needs a decision of its own:** whatever file format Nimrod writes
into a user's chosen folder has the same one-way property a database schema had. A field absent at
write time cannot be supplied afterwards. If agents ever play the games, a file with no producer
field cannot be filtered later. This is now a file-format question rather than a migration, and it is
cheap — but it is still decided before the first file is written, not after.

**C. "Nothing patient-facing" — withdrawn by Mike, 2026-08-29, and it needs replacing.**

The existing wording is absolute and wrong:

> "And nothing patient-facing. No score, no streak, no right/wrong chime, nothing on the board that
> turns talking into a test the person can see themselves failing." — private AAC design, §1

It collides directly with a decision made two weeks earlier that player comparison is a good feature
that should be built, with leaderboards and shared score screens.

**Mike's correction:** *"Nothing patient facing is wrong and shouldn't have been written. The idea is
more that a person shouldn't feel judged about how long it takes them to make a selection on an AAC
board in regular use."*

The distinction that actually does the work is **who asked**. A score in a game somebody chose to
play is the point of the game. A latency readout on the board somebody uses to talk is a verdict
nobody asked for, rendered on the surface they cannot avoid. Proposed replacement, for Mike's
wording:

> *The software does not render a judgment about a person to that person unless they asked for it.
> Choosing to play a scored game is asking. Using your own board to speak is not.*

**D. "Ephemeral by default" versus "append-only, never deleted."**

Both are written as project-wide, and they govern different data — facility response-time records
versus board selections — but neither document says so. This is a scope failure of exactly the kind
§0.3 exists to prevent, and it resolves by giving each one a scope rather than by choosing between
them.

---

## §4 — RETIRED ABSOLUTES

Kept so they do not come back. Each of these was written as a rule, applied as a rule, and turned out
to be wrong.

| the retired rule | why it failed | retired |
|---|---|---|
| "nothing may require an input in order to keep doing what it is already doing" | Too strong. A game where blowing into a straw keeps a windmill turning stops when you stop — the input *is* the content. And somebody who wants an "are you still watching?" prompt should have it. Replaced by the narrower invariant in §1.1. | 2026-08-28 |
| "a symbol must never move" | Too strong; Mike pushed back. Replaced by: within a layout, adding words never rearranges existing words, and moving between layouts is a deliberate versioned milestone. | in `aac_design.md` |
| companion data is local "with no exceptions for convenience" | Contradicted "build everything, withhold nothing." Replaced by: local is the default, cloud is always available, the choice is explicit and per-job. | 2026-08-26 |
| the teacher bot is "never for patient or child data" | A hard rule where a setting belonged. Replaced by architecture, a warning at the file picker, and logged routing. | 2026-08-27 |
| comparison between the people in the room "must never render" | A hard rule where a setting belonged. Two friends may well want to compare scores. Player comparison is a feature; moderator comparison ships off by default. | 2026-08-27 |
| the board "doesn't measure at all" | Wrong. It measures plenty; the question was only ever what gets shown to whom. | 2026-08-26 |
| "nothing patient-facing" | See §3.C. Withdrawn by Mike. | 2026-08-29 |
| no image or recording of one named person is ever used to promote the project | Withdrawn as a person-specific rule and generalised: anything afforded her is afforded to any user. The general protection is stronger than the exception was. | 2026-08-29 |

**The pattern across all eight is the same, and it is the argument for §0.** Every one was written by
someone reasoning carefully about a real risk. Every one was correct about the risk and wrong about
the remedy, because it stated as a prohibition something that was really a default. Six of the eight
were caught by Mike pushing back on his own documentation.

---

*Opened 2026-08-29. Nothing ratified.*
