# web/ — the Nimrod platform web app

This is where the platform web app is **rebuilt from scratch** — a clean, device-independent
codebase, not a copy of the old bedside dashboard. The old app is a design reference for
*what* the modules do, not a source to paste from.

## Layout
- `server/` — the thin coordination layer (FastAPI + SQLite). Per-user state only; no media,
  no AI. `app.py`, `db.py` (the `StateStore` seam), `identity.py` (the auth seam).
- `client/` — framework-light ES modules: `bus.js` (sources→bindings→sinks), `state.js`
  (server-backed per-user state handle), `module.js` (the module contract), `app.js` (wiring),
  `modules/` (one file per module), and `index.html` (a dev harness).

## Run it (shared-systems slice)
```
cd web/server
py -3.13 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app:app --reload --port 8000
```
Open `http://localhost:8000/` — the server also serves the client. `?user=alice` acts as a
chosen user (dev only). See `../docs/modules/counter.md` for what the demo proves.

## Build order (one validated slice at a time)
1. **Shared systems** — the module bus and the client/server boundary (see
   `../docs/architecture.md`). Get per-user, server-side state right first so no
   device-specific assumptions creep in.
2. **Profiles + modules** — the per-user profile layer and the module system.
3. **The four default-dashboard modules**, rebuilt clean: **photos · self-view camera ·
   YouTube (+ sing-along) · clock**. (Milestone: these land in the public repo before any
   funding channel opens.)
4. **Dashboard** — the device composer (compose a layout, open it on any device).

## Non-negotiables
- Per-user state is server-side; devices are interchangeable clients.
- Camera stays on the patient's device; media is peer-to-peer; the server brokers only.
- No patient data or personal media in this repo (see the root `.gitignore`).
