# Nimrod

**Free, open-source technology for quality of life, recovery, and care.**

Nimrod is a platform built to improve daily life and support recovery for people with
TBI, stroke, and other serious conditions — and to give the people caring for them real
tools. It is private by design, modular, and made to run on equipment you probably
already own. The first product built on it is **Cici**, a local, private care companion.

> The project's primary goal is helping one patient recover and live better. It is being
> built so it can help everyone.

---

## Status

Early and active. A working dashboard has been in use for months at a bedside; the public
platform is being **rebuilt from scratch** here as a clean, device-independent codebase.
See [`DECISIONS.md`](DECISIONS.md) for the choices that shape it and
[`docs/architecture.md`](docs/architecture.md) for the principles.

## What's here

| Path | What it is |
|------|------------|
| `index.html` | The public landing page (served free via GitHub Pages). |
| `web/` | The platform web app — rebuilt fresh. See `web/README.md`. |
| `docs/` | Architecture notes and a per-module documentation convention. |
| `docs/modules/` | One markdown walkthrough per module (for people **and** their AI tools). |
| `claude-setup/` | A context pack you can load into an AI assistant to get guided setup help. |
| `DECISIONS.md` | The running log of locked decisions. |
| `CONTRIBUTING.md` | How to help. Developers welcome. |

## Principles (short version)

1. **Private by design.** Cameras, files, recordings, and any AI that touches a patient's
   private data stay on the user's own machine. The site brokers connections; it is never
   the middleman for private data.
2. **Device-independent.** State lives with the user's account, not on any one machine —
   open your setup on any device; replace a screen and everything comes back. No hardware
   swaps, no machine-specific setup.
3. **Modular and open.** Everything is a module. Anyone can build one. Every module gets
   plain-language docs so people and their AI tools can understand and extend it.
4. **Runs on what you have.** A web app that opens in any modern browser — phone, tablet,
   computer, or an inexpensive Raspberry Pi.

## License

[MIT](LICENSE). Free to use, modify, and build on — including commercially. Your free
version always exists; nobody can close it.

## Links

- Website: _(GitHub Pages URL — add once Pages is enabled)_
- Community: _(Discord / subreddit — add once created)_
- Videos: _(YouTube channel — add once created)_
