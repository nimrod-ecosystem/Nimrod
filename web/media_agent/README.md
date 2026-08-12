# Nimrod local media agent

A tiny **user-run** file server that lets a Nimrod photos/video module read media
**straight off your own machine** — the platform server never sees the bytes.

This is the storage half of **BYO storage + BYO compute** (see `../../DECISIONS.md`).
Your media never uploads to the platform and never goes to any cloud. The platform
only stores a *reference* you type in at runtime: a `base_url` (where this agent is
listening) and an optional album (a subfolder name). Neither is ever committed.

## Run it

Zero dependencies — just Python 3.8+. No `pip install`, no venv.

```bash
python agent.py --root "D:/Christine/photos"
```

Options:

| flag | default | meaning |
| --- | --- | --- |
| `--root` | *(required)* | the folder whose media you want to serve |
| `--host` | `0.0.0.0` | bind address (all interfaces; use `127.0.0.1` for local-only) |
| `--port` | `8770` | port to listen on |
| `--origin` | `*` | CORS `Access-Control-Allow-Origin`; set to your platform origin (e.g. `http://localhost:8000`) to lock it down |

Then point a photos source at `http://<this-machine>:8770` as its `base_url`
(localhost on the kiosk itself; a LAN IP or Tailscale name from another device).

## What it exposes

| endpoint | returns |
| --- | --- |
| `GET /health` | `{ok, root, origin}` — liveness + what it's serving |
| `GET /list` | media in the root folder + subfolders as albums (see below) |
| `GET /list?album=<sub>` | media inside subfolder `<sub>` |
| `GET /files/<relpath>` | the raw image/video bytes (Range-aware, so video seeks) |

`/list` response shape:

```json
{
  "album": "trip",
  "albums": ["trip/2019", "trip/beach"],
  "items": [
    { "id": "trip/cliff.png", "name": "cliff.png", "path": "trip/cliff.png",
      "kind": "image", "size": 20480, "mtime": 1723400000 }
  ],
  "count": 1
}
```

The client builds a media URL as **`base_url + "/files/" + item.path`**. Paths are
relative, so the agent never needs to know its own public address — the client's
`base_url` config decides that. `id` equals `path` and is stable, so it's what the
shared picker (`../client/rng.js`) keys play-stats on.

## Recognised media

Case-**insensitive** extension match (a past bug hid hundreds of `.JPG` files behind
a case-sensitive filter — fixed here by design):

- **images:** jpg jpeg png gif webp bmp heic heif avif
- **videos:** mp4 mov webm m4v ogv

Dotfiles and non-media files are skipped.

## Safety

- **Read-only.** Lists and serves; never writes, deletes, or executes.
- **Traversal-guarded.** Every `/files` request and every `?album=` is resolved and
  confined to `--root`; `..` escapes are rejected.
- **CORS on every response**, including preflight and file bytes, so a browser loaded
  from the platform origin can fetch cross-origin.

## Test

```bash
python test_agent.py
```

Spawns the real agent against a throwaway media tree and checks listing,
case-insensitivity, album navigation, file bytes, CORS, Range/206, and two
path-traversal probes. 18 checks, all green.
