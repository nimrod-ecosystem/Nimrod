#!/usr/bin/env python3
"""Nimrod local media agent — Bring-Your-Own storage, run on YOUR machine.

WHY THIS EXISTS (the architectural boundary):
The Nimrod platform server is a THIN coordination layer. It stores tiny per-user
text (config, playlists, a few hundred bytes per play) and NOTHING ELSE — no
media, ever (see ../../DECISIONS.md "BYO storage + BYO compute"). Your photos and
videos never touch it and are never uploaded to any cloud.

Instead, YOU run this small file server on the machine where your media lives (the
kiosk itself, a home PC, a NAS). It does two things and nothing more:

  1. GET /list[?album=sub]  -> a JSON listing of the media in a folder you chose.
  2. GET /files/<relpath>   -> the actual image / video bytes, served directly.

The browser client (loaded from the platform origin) fetches BOTH straight from
this agent, cross-origin — so the platform server never sees a single byte. That
is the whole point: you own the data and the machine it sits on; the platform only
holds a reference (a base_url + a folder name) that YOU type in at runtime and that
is NEVER committed to the repo.

DESIGN CHOICES:
  * Zero dependencies. Pure Python standard library, so `python agent.py --root
    <folder>` runs on any machine with Python 3.8+ — no pip install, no venv. The
    platform server is FastAPI; this agent deliberately is not, because a user-run
    BYO tool must be trivial to launch.
  * Serves RELATIVE paths only. The client prefixes them with the base_url it was
    given, so this agent never needs to know its own public address (localhost on
    the kiosk, a LAN IP, or a Tailscale name — all decided by the client's config).
  * Case-INSENSITIVE extension match, and videos are first-class (a real past bug
    hid ~497 `.JPG` files behind a case-sensitive filter — never again).
  * Read-only. It lists and serves; it never writes, deletes, or executes. Requests
    are path-traversal guarded to the root you chose.

RUN IT:
    python agent.py --root "D:/Christine/photos"
    python agent.py --root ~/Pictures --port 8770 --origin http://localhost:8000

Then point a Nimrod photos source at  http://<this-machine>:8770  (base_url), and
optionally an album (a subfolder name). Ctrl+C to stop.
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

# Media we recognise. Lower-cased comparison, so .JPG / .Jpg / .jpg all match.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif", ".avif"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".ogv"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS

# Set once in main(); the handler reads them. Kept as globals because
# BaseHTTPRequestHandler is instantiated per-request by the server.
ROOT: Path = Path(".")
ORIGIN: str = "*"


def kind_of(name: str) -> str | None:
    ext = os.path.splitext(name)[1].lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return None


def _within(child: Path, parent: Path) -> bool:
    """True iff `child` is inside `parent` (both already resolved)."""
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def list_album(album: str) -> dict:
    """Listing for one folder: its media files + its subfolders (as albums).

    `album` is a relative folder under ROOT ("" = the root itself). Traversal is
    guarded: a resolved path escaping ROOT yields an error dict the caller turns
    into a 403.
    """
    root = ROOT.resolve()
    target = (root / album).resolve() if album else root
    if not _within(target, root) and target != root:
        return {"error": "forbidden"}
    if not target.is_dir():
        return {"error": "not_found"}

    items: list[dict] = []
    albums: list[str] = []
    with os.scandir(target) as it:
        for entry in it:
            if entry.name.startswith("."):
                continue  # skip dotfiles / hidden system entries
            if entry.is_dir():
                rel = os.path.relpath(entry.path, root).replace(os.sep, "/")
                albums.append(rel)
                continue
            k = kind_of(entry.name)
            if not k:
                continue
            try:
                st = entry.stat()
            except OSError:
                continue
            rel = os.path.relpath(entry.path, root).replace(os.sep, "/")
            items.append({
                "id": rel,                 # stable id = path relative to ROOT
                "name": entry.name,
                "path": rel,               # client builds url = base_url + "/files/" + path
                "kind": k,
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            })

    # Deterministic order: newest first is what a photo wall wants, but the picker
    # re-weights anyway, so a stable name sort keeps listings reproducible for tests.
    items.sort(key=lambda i: i["name"].lower())
    albums.sort(key=str.lower)
    return {"album": album, "albums": albums, "items": items, "count": len(items)}


class Handler(SimpleHTTPRequestHandler):
    """Serves /list + /health as JSON and /files/<rel> as bytes.

    File serving (Range requests, content types, If-Modified-Since) is inherited
    from SimpleHTTPRequestHandler; we only route paths, add CORS, and keep every
    request read-only and inside ROOT.
    """

    server_version = "NimrodMediaAgent/1.0"

    # --- CORS on every response, including file bytes and errors ---------------
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Vary", "Origin")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def do_OPTIONS(self):  # CORS preflight
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    # --- Routing ---------------------------------------------------------------
    def _route(self):
        return urlparse(self.path).path

    def do_GET(self):
        path = self._route()
        if path == "/health":
            return self._json({"ok": True, "root": str(ROOT.resolve()), "origin": ORIGIN})
        if path == "/list":
            qs = parse_qs(urlparse(self.path).query)
            album = (qs.get("album", [""])[0] or "").strip("/")
            result = list_album(album)
            if result.get("error") == "forbidden":
                return self._json({"error": "forbidden"}, HTTPStatus.FORBIDDEN)
            if result.get("error") == "not_found":
                return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
            return self._json(result)
        if path == "/files" or path.startswith("/files/"):
            return self._serve_file(head=False)
        if path == "/":
            return self._json({
                "service": "nimrod-media-agent",
                "endpoints": ["/health", "/list?album=<sub>", "/files/<relpath>"],
            })
        return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)

    def do_HEAD(self):
        path = self._route()
        if path == "/files" or path.startswith("/files/"):
            return self._serve_file(head=True)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

    # --- Range-aware file serving ---------------------------------------------
    # stdlib SimpleHTTPRequestHandler does NOT honour Range, but <video> seeking
    # (and Safari playback at all) needs 206 partial responses, so we serve media
    # ourselves. translate_path (below) still does the traversal guard.
    def _serve_file(self, head: bool):
        fs_path = self.translate_path(self.path)
        if os.path.isdir(fs_path) or not os.path.isfile(fs_path):
            return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
        try:
            f = open(fs_path, "rb")
        except OSError:
            return self._json({"error": "not_found"}, HTTPStatus.NOT_FOUND)
        try:
            st = os.fstat(f.fileno())
            size = st.st_size
            ctype = self.guess_type(fs_path)
            rng = self._parse_range(self.headers.get("Range"), size)

            if rng is None and self.headers.get("Range"):
                # Unsatisfiable range.
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                return

            if rng:
                start, end = rng
                length = end - start + 1
                self.send_response(HTTPStatus.PARTIAL_CONTENT)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            else:
                start, length = 0, size
                self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Last-Modified", self.date_time_string(int(st.st_mtime)))
            self.end_headers()

            if head:
                return
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)
        finally:
            f.close()

    @staticmethod
    def _parse_range(header: str | None, size: int):
        """Parse a single 'bytes=start-end' range. Returns (start,end) inclusive,
        or None (no/invalid range -> caller serves full, or 416 if header present)."""
        if not header or not header.startswith("bytes="):
            return None
        spec = header[len("bytes="):].split(",")[0].strip()
        if "-" not in spec:
            return None
        lo, hi = spec.split("-", 1)
        try:
            if lo == "":                       # suffix: bytes=-N (last N bytes)
                n = int(hi)
                if n <= 0:
                    return None
                start = max(0, size - n)
                end = size - 1
            else:
                start = int(lo)
                end = int(hi) if hi else size - 1
        except ValueError:
            return None
        if start > end or start >= size:
            return None
        return start, min(end, size - 1)

    # --- Map /files/<rel> onto ROOT, with the inherited traversal guard --------
    def translate_path(self, path):
        # Only /files/* reaches here (do_GET routes everything else). Strip the
        # prefix, then defer to the parent's translate_path, which collapses "..",
        # drops leading slashes, and joins to `directory` (= ROOT) — the guard.
        parsed = urlparse(path).path
        if parsed.startswith("/files"):
            rest = parsed[len("/files"):]
        else:
            rest = parsed
        if not rest.startswith("/"):
            rest = "/" + rest
        # Reconstruct with the query stripped; parent re-parses.
        saved, self.path = self.path, rest
        try:
            return super().translate_path(rest)
        finally:
            self.path = saved

    # --- helpers ---------------------------------------------------------------
    def _json(self, obj, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))


def main(argv=None):
    global ROOT, ORIGIN
    ap = argparse.ArgumentParser(description="Nimrod local media agent (BYO storage).")
    ap.add_argument("--root", required=True, help="folder to serve (your photos/videos live here)")
    ap.add_argument("--host", default="0.0.0.0", help="bind address (default: all interfaces)")
    ap.add_argument("--port", type=int, default=8770, help="port (default: 8770)")
    ap.add_argument("--origin", default="*",
                    help="CORS Access-Control-Allow-Origin (default '*'; set to your "
                         "platform origin e.g. http://localhost:8000 to lock it down)")
    args = ap.parse_args(argv)

    root = Path(args.root).expanduser()
    if not root.is_dir():
        ap.error(f"--root is not a folder: {root}")
    ROOT = root
    ORIGIN = args.origin

    # SimpleHTTPRequestHandler serves relative to `directory`; point it at ROOT so
    # the inherited translate_path guard keeps every file request inside it.
    def make_handler(*a, **kw):
        return Handler(*a, directory=str(ROOT.resolve()), **kw)

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler)
    resolved = ROOT.resolve()
    print(f"Nimrod media agent serving:  {resolved}")
    print(f"  listening on  http://{args.host}:{args.port}  (CORS origin: {ORIGIN})")
    print(f"  try           http://localhost:{args.port}/list")
    print("  Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
