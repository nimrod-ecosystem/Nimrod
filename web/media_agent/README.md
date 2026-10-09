# Nimrod local media agent

A tiny **user-run** file server that lets a Nimrod photos/video module read media
**straight off your own machine** — the platform server never sees the bytes.

This is the storage half of **BYO storage + BYO compute** (see `../../DECISIONS.md`).
Your media never uploads to the platform and never goes to any cloud. The platform
only stores a *reference* you type in at runtime: a `base_url` (where this agent is
listening) and an optional album (a subfolder name). Neither is ever committed.

## Run it

Zero dependencies — just Python 3.8+. No `pip install`, no venv.

**The first time**, pair it with your Nimrod account:

```bash
python agent.py --root "D:/Photos" --pair --name "Robin's bedside"
```

It prints a six-character code:

```
=======================
     K K G J F T
=======================

  Type that code into Nimrod:  https://nimrodecosystem.com/home.html  ->  Media
```

Type those six characters into **Media** on the Nimrod site, signed in. That is the whole
setup — **you never need to know this machine's address.** The agent offers the addresses
it might be reachable at, and your browser works out which one actually answers, because
it is the only thing that can: `localhost` only works if it is the same machine, a LAN
address only from the same network, and the agent has no way to test either from here.

**Every time after that**, just run it:

```bash
python agent.py --root "D:/Photos"
```

Leave it running. On a machine that should serve media unattended, make it a service
(systemd, a Windows scheduled task) and set `NIMROD_MEDIA_ROOT` instead of passing `--root`.

## Options

| flag | default | meaning |
| --- | --- | --- |
| `--root` | *(required)* | the folder whose media you want to serve |
| `--pair` | off | show a pairing code and wait for someone to type it in. Do this once. |
| `--name` | `Media device` | what this device is called in Nimrod |
| `--platform` | `https://nimrodecosystem.com` | where Nimrod is running (a self-hosted one goes here) |
| `--host` | `127.0.0.1` | bind address. **This machine only, by default.** |
| `--lan` | off | serve to your whole local network. Needed only when the screen is a *different* machine. |
| `--port` | `8770` | port to listen on |
| `--origin` | *(follows `--platform`)* | the sites whose pages may use it; pages on this computer always may, every other site gets 403 |
| `--data-dir` | off | the Data folder of your Nimrod folder: a page on this computer may append history there (see Safety) |

Each also has an environment variable (`NIMROD_MEDIA_ROOT`, `NIMROD_MEDIA_HOST`,
`NIMROD_MEDIA_PORT`, `NIMROD_MEDIA_ORIGIN`, `NIMROD_MEDIA_NAME`, `NIMROD_PLATFORM`,
`NIMROD_MEDIA_DATA`) so it
can run as a service configured from an env file.

### About those defaults

**It listens on this machine only unless you say otherwise.** It used to bind every
interface with CORS open to any site, which on a care facility's shared wifi meant a
resident's photo folder was readable by anything else on the network — no password, no
prompt, and nothing anywhere saying so. Serving your own photos to your own screen does
not need that. Pass `--lan` when the screen really is a different machine, and the agent
prints what it is exposing every time it starts.

**`--origin` follows `--platform`.** The only site that ever needs to be allowed is the
one your browser loads Nimrod from, and `--platform` already names it. Point `--platform`
at a self-hosted Nimrod and CORS follows automatically. For the default Nimrod both
addresses it is served at are allowed (`https://nimrodecosystem.com` and the older
`https://nimrod.onrender.com`), the same list the Nimrod helper allows.

### The pairing code, and what it is worth

A code lasts fifteen minutes, works once, and is worthless on its own — it grants nothing
until somebody signed in claims it. Six characters from a 30-character alphabet with no
ambiguous glyphs in it (no `0`/`O`, no `1`/`I`/`L`, no `U`), so nothing you can misread
off a console is ever generated. Type it in any case, with or without spaces or dashes.

The agent writes a small `.nimrod-agent-id` file in the folder it serves. That is how your
browser tells *this* agent apart from any other one answering on the same address later —
without it, a machine that inherits the same DHCP lease silently becomes your photo source.
It is not listed as media and contains nothing but a random id.

## What it exposes

| endpoint | returns |
| --- | --- |
| `GET /health` | `{ok, agent_id}` — liveness, and which agent this is (no folder path) |
| `GET /list` | media in the root folder + subfolders as albums (see below) |
| `GET /list?album=<sub>` | media inside subfolder `<sub>` |
| `GET /files/<relpath>` | the raw image/video bytes (Range-aware, so video seeks) |
| `GET /history/status` | only with `--data-dir`: `{enabled, ready, folder_id, streams}` - can history be written now |
| `POST /history/<stream>` | only with `--data-dir`: `{scope, rows: [{at, kind, data}], folder_id?}` appended to `Data/History/<stream>-<scope>-<YYYY-MM>.jsonl` |

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

## Recognized media

Case-**insensitive** extension match (a past bug hid hundreds of `.JPG` files behind
a case-sensitive filter — fixed here by design):

- **images:** jpg jpeg png gif webp bmp heic heif avif svg (an SVG can carry script, so every
  file is served with a `Content-Security-Policy: sandbox` header: opened on its own it runs nothing)
- **videos:** mp4 mov webm m4v ogv
- **audio:** mp3 m4a aac ogg oga opus wav flac (listed as `kind: "audio"`; the photo
  slideshow skips them, the music players use them)

Dotfiles and non-media files are skipped.

## Safety

- **Read-only.** Lists and serves; never writes, deletes, or executes. The one exception
  is opt-in: with `--data-dir`, history is **appended** under that folder's `History/`
  and nowhere else - never a delete or an overwrite, only from this computer, only JSON,
  at most 256 KiB at once, and the Data folder itself is never created (a drive not
  plugged in waits).
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
