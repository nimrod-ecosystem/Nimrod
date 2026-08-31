# Nimrod

**Free, open-source technology for quality of life, recovery, and care.**

Nimrod is a platform built to improve daily life and support recovery for people with TBI, stroke, and
other serious conditions — and to give the people caring for them real tools. It is private by design,
modular, and made to run on equipment you probably already own.

Its primary goal will always be helping one patient recover and live better. It is being built so that
it can help everyone.

**Website:** https://nimrodecosystem.com · **License:** [MIT](LICENSE)

---

## What it does

Most technology built for hospital rooms and care settings assumes a person who can speak or reliably
touch a screen. Nimrod is built the other way around: **how someone gives input is a setting, not an
assumption.**

- **Remappable input.** Bind a switch, a gamepad, a mouse or a keyboard to whatever you want it to
  do — the way a game lets you remap controls. Most of it is plug and play. That includes the 3.5 mm
  adaptive switch jack the Xbox Adaptive Controller made standard, so the DIY switch ecosystem works
  here too. Adding a new input method means adding a source; nothing downstream changes.
  **Planned:** hand and colour tracking, and voice as an input. Neither is in this codebase yet, so
  they are listed here the way the table below lists everything else rather than in the sentence
  above it.
- **One session, many screens.** A phone, a TV, and a bedside tablet are clients on the same session,
  not three separate installs. Replace a screen and everything comes back.
- **Games — word, math, life-skills and others.** All of them do capability testing underneath: which
  input method a person can actually use, and whether that is changing over time.
- **Media and connection.** Personal photos and video, curated playlists, a daypart scheduler, and
  video calls on the same device the person uses to communicate.
- **Kiosk mode.** Locks the screen to Nimrod and nothing else, and comes back where it was after a
  power flash, so nobody is stranded by a reboot.
- **Runs signed-out.** No account required to try it.

## Status

Early and active. A working dashboard has been in use for months at a bedside; the public platform is
being **rebuilt from scratch** here as a clean, device-independent codebase, with no code copied from
the private one.

Module docs use the same four labels as the website:

| Label | Means |
|---|---|
| **Live today** | Working in the public platform right now |
| **Tested with a real patient** | Proven in use, not yet a default |
| **On the build path** | Being built now |
| **Planned** | Decided, not started |

## Try it

**<https://nimrodecosystem.com>** — no install, no account. It runs in any modern browser: phone,
tablet, computer, or a Raspberry Pi.

## Run your own

You don't have to. The hosted version above is the same software. Run your own if you want the data on
your own machine, or if you want to change something.

Requires **Python 3.13**.

```bash
cd web/server
python -m venv .venv

# Windows
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --reload --port 8000

# macOS / Linux
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app:app --reload --port 8000
```

Then open <http://localhost:8000/>.

## Principles

1. **Private by design.** Cameras, files, recordings, and any AI that touches a patient's private data
   stay on the user's own machine. The site brokers connections; it is never the middleman for private
   data.
2. **Device-independent.** State lives with the user's account, not on any one machine. No hardware
   swaps, no machine-specific setup.
3. **Modular and open.** Everything is a module. Anyone can build one. Every module gets plain-language
   docs so people and their AI tools can understand and extend it.
4. **Runs on what you have.** A web app that opens in any modern browser.

## Digging deeper

- [`DECISIONS.md`](DECISIONS.md) — the running log of locked decisions and why they were made
- [`docs/architecture.md`](docs/architecture.md) — the principles in full
- [`docs/modules/`](docs/modules/) — one plain-language walkthrough per module
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to help

## What this is not

Nimrod is not a medical device. It is not a nurse call system. It is not for emergencies. It does not
replace certified life-safety equipment. Anyone in a care setting must use the facility's call system
for any need requiring staff assistance.

## License

[MIT](LICENSE). Free to use, modify, and build on — including commercially. Your free version always
exists; nobody can close it.

## Getting help, and helping

This is one person's project and there is no support desk. Replies may be slow.

**The most useful thing anyone can do right now is try it and tell me where it fails** — especially if
you work with people who can't use ordinary interfaces.

- **Questions, bugs, and ideas:** open an [issue](../../issues) or start a thread in
  [Discussions](../../discussions). Use these rather than email — they're public, so an answer helps
  the next person, and they don't get lost.
- **Guided setup:** [`assistant-setup/`](assistant-setup/) is a context pack you can load into any AI
  assistant so it can walk you through setting the system up and answer questions about it in plain
  language. It's plain markdown and isn't tied to any one product. That is deliberately the main path
  for help here — it works at any hour and doesn't depend on one person being available.
