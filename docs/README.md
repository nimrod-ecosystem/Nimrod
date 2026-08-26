# Nimrod docs

- [`architecture.md`](architecture.md) — principles and the client/server boundary. Read
  this before building.
- [`module-input-spec.md`](module-input-spec.md) — the contract for building a module,
  including from Unity or Godot. **Read this before building anything somebody will drive
  with a switch** — the input half is one function, and it is the whole qualification.
- [`modules/`](modules/) — one markdown walkthrough per module. These are written so both
  **people and AI assistants** can understand a module well enough to use, fix, or extend
  it. Copy [`modules/_TEMPLATE.md`](modules/_TEMPLATE.md) when you add a module.

Keeping module docs current is part of "done" — a module without a doc is unfinished.
