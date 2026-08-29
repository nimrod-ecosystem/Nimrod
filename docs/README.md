# Nimrod docs

- [`architecture.md`](architecture.md) — principles and the client/server boundary. Read
  this before building.
- [`module-input-spec.md`](module-input-spec.md) — the contract for building a module,
  including from Unity or Godot. **Read this before building anything somebody will drive
  with a switch** — the input half is one function, and it is the whole qualification.
- [`modules/`](modules/) — one markdown walkthrough per module. These are written so both
  **people and AI assistants** can understand a module well enough to use, fix, or extend
  it. Copy [`modules/_TEMPLATE.md`](modules/_TEMPLATE.md) when you add a module.
- [`landing-page.md`](landing-page.md) — decisions and open items for the public site.
  **Read this before editing the landing page.** Two sections are blocked on Mike's own
  words and must not be invented.
- [`lookup-panel.md`](lookup-panel.md) — spec for word lookup inside Word Forge: two users
  with opposite needs, sources as folders, scoring, and where the weights live.

Keeping module docs current is part of "done" — a module without a doc is unfinished.
