# Glossary — one name, one meaning

**Opened 2026-08-30. Draft.** The rule this file exists to enforce, from `PRINCIPLES.md`:

> **One name, one meaning; one meaning, one name.**

Two failure directions. **Synonyms** — several names for one idea — make the vocabulary tedious.
**Overloading** — one name covering several unrelated ideas — makes it *wrong*, and invisibly, because
there is only one copy of the word so nothing shows you the disagreement. Overloading is the dangerous
one. It is what `createWatchdog` and `createState` already did to us.

**Reserving a word is as much of a decision as using one.** A word listed in §3 is spent even though
nothing uses it yet.

---

## §1 — Terms in use

| term | means | does NOT mean |
|---|---|---|
| **module** | An instance of a feature inside a profile — clock, photos, a board. Registers itself via `module.js`. | An ES module / source file. The file sense is unavoidable in prose; never use it in an identifier. |
| **profile** | A named container of module instances belonging to a person. `profile.js`. | Anything describing a person's abilities — see **access profile** below. |
| **channel (output)** | A way of reaching a person: `screen`, `speech`, `sound`, `light`, `remote`. `output.js`. | See **diversity axis**. |
| **diversity axis** | The grouping the shuffler avoids repeating — an album path for photos, an uploader for videos. **Renamed from `channels` in `rng.js`** because it was a third meaning. | An output channel. |
| **board** | An AAC communication board: a vocabulary a screen renders. | A points board — see **quest board**. |
| **quest board** | The points/task surface. `quests.js`, `adulting.js`. | An AAC board. |
| **session (roster)** | Who was in the room for a sitting, and the id trials carry. `provenance.py`, `telemetry.js`. | See **login session**. |
| **login session** | The browser/auth cookie session. `app.py`. **Renamed from `session`** — it collided in one file. | A roster. |
| **store** | Persistent per-profile overwrite storage. **Renamed from `state` / `createState`** because the word was needed elsewhere and because the name suggested a state machine, which it is not. | A state machine. |
| **machine state** | A node in the state machine. `statemachine.js`. | Stored settings. |
| **view** | An arrangement of modules on one display. `view.js`. | A read-only UI panel — those are `*_view.js` and that is a second sense worth watching. |
| **scene** | **Reserved, not built.** One verb setting many views across many devices — the Home-Assistant sense. Claimed in `view.js`. | The old `scene.js`, which is now `view.js`. The file was freed; the word was not. |
| **the small bang** | The one thing that is not a module: whatever boots and mounts the first module, and hands out the bus. Kept as small as possible. | The bus, the kiosk, or the shell's features — all of those are modules. |
| **aim** | Where on the screen somebody is pointing, normalised 0..1 of the viewport, from whatever is driving it — a mouse, a head pointer, a hand in front of a camera. `aim.js`, topic `input/aim`. **Claimed 2026-08-30.** | An action. It carries no binding, no timing and no role gate; what somebody DOES at that spot is a press and still goes through `input.js`. |
| **marker** | A brightly coloured object somebody wears or holds — a sock, a wristband, a glove — that the camera finds by hue. `input_marker.js`, device `marker:colour`. **Claimed 2026-08-30.** | A landmark, a skeleton joint, or anything a model recognises. The whole point of a marker is that nothing has to recognise it. |
| **bank** | The content somebody wrote for the games to draw on — words and questions, in one document, per person. `bank.js`. **Claimed 2026-08-31.** | The verb in `algebra.js` (`bank(award)` = to bank points). A second, unrelated sense that happens not to collide; see §4. |
| **cursor** | The thing drawn on screen at the aim. `cursor.js`. **Claimed 2026-08-30**, which is why `inputs.js`'s row-walking `cursor` was renamed to `highlight` in the same change. | The system mouse pointer, and no longer a row in a list. |
| **dwell** | Holding still on purpose, as a selection: rest the aim inside a radius for `dwellMs` and it becomes a press. `input_dwell.js`, device `dwell`. **Claimed 2026-08-31** for this sense because it is where the AT field puts the word — eye-gaze and head-pointer software all call this "dwell click". | The time a scanner leaves each option lit. That is **step**. |
| **step** | How long a scanner leaves each option lit before moving on. `input_scan.js`, `stepMs`, default 15000. **Renamed from `dwell` 2026-08-31**, in the change that extracted scanning — see §4. | A step in a state machine, and not the `stepValue` in `settings_fields.js`, which computes a control's next value. Worth watching; the two never meet. |
| **held** | A stop that somebody is understood to be present for and coming back from — the subset of "paused" that gets a clock in hours instead of seconds. `held.js`, topics `held/begin` · `held/end`. **Claimed 2026-08-31**, and it was already the word in `youtube.js`, `personal.js` and the `held` event kind, so nothing new was spent. | A pause. Buffering, an OS audio-focus change and a screen lock are pauses and are NOT held — a screen that swapped to a wallpaper every time the network hiccuped would be worse than the frozen frame it replaced. |
| **wallpaper** | Ambient content shown while a screen is waiting — the built-in generative drift, or a folder the person chose. `wallpaper.js`, `modules/wallpaper.js`. **Claimed 2026-08-31.** The marketing page `wallpapers.html` already used the word in exactly this sense, which is why claiming it costs nothing. | A screensaver. A screensaver replaces what was on screen; this is raised OVER a paused segment that is still mounted and still marked paused, and lowering it returns to exactly where she was. |
| **capability** | Something a module declares it can do — *contains modules*, *provides a bus*. How a kiosk is a module rather than a special case. | A permission on a link between people. |

---

## §2 — Words that are FREE

Verified unused as a concept across code and docs on 2026-08-30. Claim deliberately; do not spend
these by accident.

- **`situation`** — cleanest available. Three occurrences repo-wide, all ordinary prose, no identifier.
- **`aspect`** — free as a concept, but the literal string appears ~15 times as the CSS `aspect-ratio`
  property, so searching for it is noisy.

**Spent since this list was written:** `aim` (2026-08-30) — it had three repo-wide occurrences, one
of which was `pond.js` using it for exactly the meaning it now carries, which is the best possible
sign a word is the right one. It is in §1; do not reuse it.

---

## §3 — Words that are SPENT, and must not be reused

| word | why it is unavailable |
|---|---|
| **condition** | **Medical.** `README.md` and `AGENTS.md` both use it for the people this project serves — "brain injury, stroke and similar conditions". It is a clinical term in the two files every reader and every agent opens first. |
| **mode** | Overloaded five ways already: restart target, QR encoding mode, game variant (calm/challenge/practice), mirror mode, file/agent modes. |
| **phase** | Overloaded three ways: sprint work/break, pressgame round, input press phase. |
| **scene** | Reserved for the multi-device Home-Assistant sense in `view.js`. Taking it rebuilds the exact collision that file was written to dissolve. |
| **state** | See §1. Being narrowed to the state machine; storage is moving to **store**. |
| **session** | See §1. Being split into **session (roster)** and **login session**. |

---

## §4 — Open collisions, ranked

Not yet resolved. Ranked by whether the two meanings ever meet in one file, because a collision across
contexts that never touch is far less urgent than one inside a single call path.

1. **`session`** — two meanings inside `web/server/app.py`. Same file, same call path.
2. **`heartbeat`** — **added 2026-08-30, and it belongs this high because the two senses meet on
   one topic.** `health.js` says *"A HEARTBEAT IS ANY PUBLISH ON A TOPIC THE MODULE OWNS"* — it
   means *this panel is not dead*. `watchdog.js` means something narrower and stronger: *this
   content is still advancing*, which is why `beat()` and `ok()` are two functions. The two can
   disagree about the same panel at the same moment — a module can publish plenty while its video
   is frozen — and `health.js` consumes `segment/progress`, so the watchdog's heartbeat is read as
   health's kind in that file. Nothing is wrong today; the words are.
3. **`board`** — AAC board and leaderboard argue past each other four lines apart in `PRINCIPLES.md`.
4. **`state`** — storage and machine-state meet in `kiosk.js` and `rules.js`.
5. **`bank`** — **added 2026-08-31.** A noun in `bank.js`, `wordforge.js` and `trivia.js` (the
   content somebody wrote), and a verb in `algebra.js` (`bank(award)` — to bank points). They
   never meet in one file and the parts of speech differ, so this is the least dangerous kind of
   collision. Recorded because the count of them is itself the signal, not because it is urgent.
6. **`channel`** — three meanings that never touch. Least urgent, still worth fixing.
7. **`module`** — pervasive, conventional, probably tolerable. Keep out of identifiers.

**Opened and closed the same day, 2026-08-31: `dwell`.** Two senses arrived within hours of each
other — *hold still to click* (`input_dwell.js`, 1800 ms) and *how long a scanner leaves each
option lit* (15 SECONDS on Cici's yes/no board). Both are spoken aloud to a caregiver, so the
`cursor` rule — the word goes to whichever meaning has to be said to a user — did not separate
them. It was settled on the field's own usage instead: eye-gaze and head-pointer software
universally say "dwell click", while scanning is more often "scan rate" or "step time". So the
SCANNING sense moved, to **`step`**, and it moved inside the change that extracted scanning
(`input_scan.js`) rather than as a separate churn through a module about to be rewritten.

**The reason it is worth recording as a pattern:** the collision was written down *before* the
rename was possible, with the plan attached and the moment named. The alternative — renaming
immediately — would have touched `scan_yesno.js` twice, and doing nothing would have left the
extraction to re-argue it from scratch. `settings_audit.js` still says "scan dwell" in its
prose; that is the remaining tail and it is one string.

**Closed 2026-08-30: `cursor`.** It was added to this list the same day as an open collision — a
row in `inputs.js`, a pointer in `comet.js` — and closed a few hours later rather than left,
because the aim work spent the word on the pointer sense and leaving both would have been
knowingly making it worse. `inputs.js` now says `highlight`; the CSS class went from `i-cursor` to
`i-highlight`; the panel keeps a `cursor()` accessor as an alias so nothing outside it broke.
**This is the pattern to copy: the word went to whichever meaning needed to be spoken aloud to a
user, and the internal one moved.**

---

## §5 — How to use this file

Before naming anything, look here. If the word is in §1 with a different meaning or in §3, pick
another. If you claim a word from §2, move it to §1 in the same change that uses it — a word claimed
in code but not recorded here is how §4 happened.

If you find a collision this file does not list, add it to §4 rather than fixing it silently. The
count of open collisions is itself a signal; a rising one means the naming discipline is not holding.
