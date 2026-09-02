# AGENTS.md — read this first

Notes for anyone arriving cold, human or AI. **Skim all of it before changing anything**; it
is short, and most of it is things that have already gone wrong once.

---

## What this is, and who it is for

Nimrod is free, private software for people recovering from brain injury, stroke and similar
conditions — and for the families and clinicians around them. A **screen** is a set of
**modules** (photos, a clock, videos, games) that runs full-screen at somebody's bedside.

**The person it was built for cannot reach for the screen.** She cannot press a button, hold a
phone, or ask for help. Almost every rule below follows from that, and if you only remember one
thing, remember this:

> ### A SCREEN MUST NEVER ENTER A STATE THAT ONLY AN INPUT CAN LEAVE, WHEN THE PERSON IN FRONT OF IT CANNOT GIVE THAT INPUT.
>
> Starting something can need a press. **Being stranded must not be possible.**

That is a safety invariant, not a preference — **edge cases hunted, and signed off by Mike on
2026-08-28.** It is why a paused video shows a marker, why a call countdown connects on its
own, and why a stalled video moves on by itself. It has caught real bugs.

**It used to be phrased as *"nothing may require an input in order to keep doing what it is
already doing"*, and that was too strong.** Two counterexamples killed it:

- **A game where you blow into a straw to keep a windmill turning.** It stops when you stop —
  and that is the entire point. **The input IS the content**, not a gate in front of it.
- **Somebody who actively wants an "are you still watching?" prompt.** For a person who can
  answer it, that is a preference, and refusing to offer it is us overriding them.

**So the two questions to ask, in this order:**

1. **Is the input the content itself, or a gate on content that was already running?** The
   windmill is content. *"Press OK to keep watching"* is a gate.
2. **Can this gate be dismissed by whoever is in front of it — and if not, does anything else
   open it?** A countdown that expires, a watchdog that moves on, somebody else in the room.

***A GATE IS NOT THE PROBLEM. AN UNDISMISSABLE GATE IS.*** Somebody who wants an "are you still
watching?" check for themselves should have it — that is a preference, and it is theirs to make.
The failure this product exists to prevent is narrower and worse: **a gate in front of somebody
who cannot dismiss it, with nothing else that will.** Everything else is a setting.

---

## Where things live

    web/client/            the whole front end. Plain ES modules, no build step, no bundler.
      index.html           landing → what Nimrod is
      home.html  home.js   signed in: your screens, media, inputs, people
      kiosk.html kiosk.js  THE RUNNING SCREEN. Full-screen, calm, unattended for days.
      modules/             one file per module; each registers itself (see module.js)
      dev/                 EVERY TEST. Browser pages; open them in a browser.
    web/server/            FastAPI + SQLite. app.py is the API; db.py owns the schema.
    web/media_agent/       optional local file server for a user's own photos/video.
    docs/                  architecture, deploy, module specs
    firmware/  tools/      microcontroller input devices and their host-side helpers

**Read `docs/architecture.md` before proposing anything structural.** It is the principles
document — the client/server boundary, what may touch private data, and the rules that keep
those apart. `DECISIONS.md` records choices already made *with their reasoning*.

---

## Running it

    # server + site  →  http://localhost:8000
    cd web/server
    .venv/Scripts/python -m uvicorn app:app --port 8000     # Windows
    .venv/bin/python -m uvicorn app:app --port 8000         # macOS/Linux

Media-backed suites need two small local file servers. This prints the exact commands:

    cd web/media_agent && python make_test_fixtures.py

---

## Tests — and the one thing to understand about them

    web/client/dev/<name>_test.html      one suite, open it in a browser
    web/client/dev/run_all.html          all of them
    cd web/server && python test_*.py    server suites

**`run_all.html` needs its browser tab VISIBLE.** Hidden tabs throttle timers hard enough that
healthy suites look like hangs.

### *** THE MOST EXPENSIVE LESSON IN THIS REPO ***

The QR encoder shipped with a test suite that checked finder patterns, timing patterns, module
counts and format bits. **All of it passed. No phone could read the output.**

**A wrong QR symbol has exactly the same *structure* as a right one.** Worse: the test's own
format reader had the same bit-reversal bug as the encoder, so the two agreed with each other
and the suite stayed green.

Then the *oracle* turned out to be wrong too — two well-known reference libraries disagreed
with each other, and ours was right.

**So:**

- **Structure is not correctness.** Ask what your test would still pass on if the code were
  wrong.
- **When a test disagrees with the code, the test is a suspect too.**
- **A test that passes for a reason adjacent to the one you care about is worse than no test**,
  because it converts a guess into a reported fact.
- Where a second implementation exists, **compare against it** — see `dev/gen_qr_fixtures.py`
  and `dev/qr_oracle_test.html` for the pattern.

---

## Conventions that are not obvious

- **No build step.** Plain ES modules, served as-is. Do not introduce a bundler.
- **Every stored duration is in milliseconds and its key ends in `Ms`.** Changing a unit means
  **renaming the key**, so an un-migrated value reads as absent rather than as absurd. (`8`
  under a key that silently became milliseconds is a slideshow advancing 125×/second.)
- **Modules declare their settings as DATA** (`settings_fields.js`), never as markup. The shell
  renders them, which is the only way a cursor driven by one switch can reach them. *A control
  that cannot be reached by the only input somebody has is not a control.*
- **Modules must not assume a pointer.** On the **bedside screen**, everything reachable by one
  button, walked in one direction, and **wrapping** — a control that stops at its maximum strands
  somebody there.
  **This is a goal for the bedside screen, not a rule for the whole product** (Mike, 2026-09-02:
  *"It's not a goal. Ideally as much as possible could be done with one button, but there are
  complicated things that will need to be done in the background that will need more than one
  button."*). It was previously stated flatly, and flatly it was false — the composer, the
  bindings editor and the guided tour all need a keyboard and a pointer, and the landing page was
  claiming otherwise to the one audience that would check. Build the person's own screen so one
  switch reaches it. Do not contort the caregiver's tooling to the same bar, and do not claim it.
- **Verbs are local by default.** Anything arriving over the network is checked against a
  frozen allowlist. Adding a verb does **not** put it on the wire; that stays deliberate.
  A remote driver is judged by the same gate as a switch in the room.
- **Private data stays on the user's machine.** Photos and video are read from a local folder
  or media agent; the server never receives them. Do not add an upload path.
- **Pi shell scripts must have LF line endings.** CRLF breaks the shebang on Linux.

---

## Things that are deliberate, so please do not "fix" them

- **The server is not a media server and not an AI server.** It brokers; it does not hold
  content. See `docs/architecture.md`.
- **We do not send email.** No pipeline, no address book, no unsubscribe. Invitations are
  handed over out of band by the person inviting. This removes an entire class of problem and
  is treated as a feature.
- **The BEDSIDE kiosk is deliberately sparse** — it may sit unattended in a care facility for
  days, so it is not also a management UI, and configuration lives in `home.html`. **This is a
  property of that use, not a law about kiosks.**
- **The signed-out path cannot be exercised in local development** — the dev server answers
  `/api/me` with a stub user. Anything built for signed-out visitors needs an injectable seam
  and its own test, or it will rot unnoticed. `demo_strip.js` is the worked example.

---

## Before you open a pull request

1. **Run the suites**, including the ones near what you touched. Say plainly if something did
   not run — "not run" is a fine report; "assumed green" is not.
2. **Ask the invariant question:** can this module end up waiting for a person?
3. **Ask who it is for.** A control an aide can reach at 3am beats a clever one. If a change
   makes the bedside screen busier, argue for it.
4. **Keep the reasoning.** Comments here explain *why*, often at length, because the same
   wrong idea keeps coming back. Preserve that when you edit around it.

Thank you for being here. This exists because somebody's fiancée woke up in a room where she
could only see a wall.
