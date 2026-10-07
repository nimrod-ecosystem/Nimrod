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
    python agent.py --root "D:/Photos"
    python agent.py --root ~/Pictures --port 8770 --platform https://my-nimrod.example

(A page on this computer - the dev server on localhost - is always allowed, so --origin is only for a
Nimrod served somewhere other than --platform.)

Then point a Nimrod photos source at  http://<this-machine>:8770  (base_url), and
optionally an album (a subfolder name). Ctrl+C to stop.
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs

# Media we recognize. Lower-cased comparison, so .JPG / .Jpg / .jpg all match.
# MIRRORED in web/client/folder_source.js (IMAGE_EXTS / VIDEO_EXTS / AUDIO_EXTS). test_agent.py
# reads that file and fails if the two drift, and both check web/client/dev/media_kinds.json.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif", ".avif"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".ogv"}
# Audio (2026-09-30), so a music folder is not listed as empty. .webm stays video (a container
# the listing cannot see inside); the list and its reasons are in folder_source.js. Every
# client consumer filters by kind - the photo slideshow shows image + video only.
AUDIO_EXTS = {".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS | AUDIO_EXTS

# Set once in main(); the handler reads them. Kept as globals because
# BaseHTTPRequestHandler is instantiated per-request by the server.
ROOT: Path = Path(".")
SITES: tuple = ()          # the sites whose pages may use the agent (--origin); see "WHICH WEB PAGES" below
CHECK_HOST: bool = True    # listening only on this computer: the Host header must name it too


# ------------------------------------------------------------------ which web pages may use it
# (found 2026-10-07: the agent answered any request, and sent its one CORS origin to every one of them.)
#
# *** THE SECURITY INVARIANT: a page from a site that is not on the list is refused (403) before the agent
# lists, serves or says anything. ***
#
# THE SAME RULES AS THE SPEECH PROGRAM AND THE HELPER'S STATUS PAGE (speech_service/service.py, "WHICH WEB
# PAGES"), so the three cannot disagree about which pages are the person's:
#   * the sites given with --origin (the person's Nimrod; the helper passes its own list),
#   * any page on this computer itself (http://127.0.0.1, localhost, [::1], any port: the dev server),
#   * no Origin header at all: allowed. A plain <img>/<video> load sends none, nor does a program (curl, the
#     helper's port check); a program can send any Origin it likes, so refusing it would guard nothing.
#   * the literal Origin "null" (a sandboxed frame, a file opened from disk): refused, it names no site.
#   * '*' in the list: any site (the old open setting, kept for anybody who chooses it; printed at start).
# HOST, while the agent listens only on this computer: the Host header must name this computer too. That
# stops DNS rebinding (a site pointing its own name at 127.0.0.1, so its page counts as same-site and sends
# no Origin). With --lan or another --host the name a screen uses cannot be known here, so Host is not checked.
#
# COPIED, NOT IMPORTED, from speech_service/service.py (origin_allowed, refusal), argued: this agent is ONE
# FILE with nothing to install - the helper ships only media_agent/agent.py, the Linux and Windows installers
# run it on its own, and it promises Python 3.8, which service.py cannot be imported on (it uses `str | None`
# at run time). test_agent.py runs both checks over the same table of origins and hosts and fails if they drift.
LOCAL_ORIGIN = re.compile(r"^http://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$")
LOCAL_HOST = re.compile(r"^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$", re.IGNORECASE)
LOOPBACK = ("127.0.0.1", "localhost", "::1")


def site_list(values) -> tuple:
    """--origin values (each may be comma-separated) as a clean tuple, no repeats, no trailing slashes."""
    out = []
    for v in values or ():
        for s in str(v).split(","):
            s = s.strip().rstrip("/")
            if s and s not in out:
                out.append(s)
    return tuple(out)


def origin_allowed(origin, sites) -> bool:
    """May a page from `origin` use the agent? None or '' (no header: not a CORS request) may."""
    if origin is None or origin == "":
        return True
    if "*" in (sites or ()):
        return True
    o = str(origin).rstrip("/")
    if LOCAL_ORIGIN.match(o):
        return True
    return o in {str(s).rstrip("/") for s in (sites or ()) if s}


def refusal(origin, host, sites, check_host: bool = True) -> str:
    """'' when the request may go on, else why not (said in the 403; never a file name or the folder)."""
    if not origin_allowed(origin, sites):
        return f"origin {str(origin)[:200]} is not allowed"
    if check_host and host and not LOCAL_HOST.match(str(host).strip()):
        return f"host {str(host)[:200]} is not this computer"
    return ""


def kind_of(name: str) -> str | None:
    ext = os.path.splitext(name)[1].lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    if ext in AUDIO_EXTS:
        return "audio"
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
    # The page's own Origin is echoed when it is allowed (several sites can be, so one fixed value no longer
    # fits); a request with no Origin needs no CORS header, and a refused one gets none.
    def end_headers(self):
        allow = getattr(self, "_allow", "")
        if allow:
            self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Vary", "Origin")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

    def _refused(self) -> bool:
        """Checks the page (WHICH WEB PAGES, above). Refused: answers 403 itself and returns True."""
        origin = self.headers.get("Origin")
        why = refusal(origin, self.headers.get("Host"), SITES, CHECK_HOST)
        if why:
            self._allow = ""
            self._json({"ok": False, "error": why}, HTTPStatus.FORBIDDEN)
            return True
        self._allow = origin or ""
        return False

    def do_OPTIONS(self):  # CORS preflight
        if self._refused():
            return
        # PRIVATE NETWORK ACCESS. Chrome treats a request from a public page (the Nimrod
        # site) to a private address (this agent, on a LAN IP or localhost) as something
        # that needs explicit consent, and sends this preflight to ask for it. Without the
        # header below, pairing works perfectly right up until the browser silently
        # refuses to fetch a single photo - which looks exactly like a broken agent.
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    # --- Routing ---------------------------------------------------------------
    def _route(self):
        return urlparse(self.path).path

    def do_GET(self):
        if self._refused():
            return
        path = self._route()
        if path == "/health":
            # AGENT_ID is what lets the client tell "something is answering on this
            # address" apart from "the thing I just paired with is answering". Without it a
            # different agent on the same port, on a machine that took the same DHCP lease,
            # silently becomes somebody's photo source.
            # ONLY WHAT THE SITE READS (media_sources.js: `ok` and `agent_id`). The folder's full path used
            # to be here too: it names a person's folders (often their name) and no page uses it. The agent
            # prints it when it starts, for the person running it.
            return self._json({"ok": True, "agent_id": AGENT_ID})
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
        if self._refused():
            return
        path = self._route()
        if path == "/files" or path.startswith("/files/"):
            return self._serve_file(head=True)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

    # --- Range-aware file serving ---------------------------------------------
    # stdlib SimpleHTTPRequestHandler does NOT honor Range, but <video> seeking
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


# ------------------------------------------------------------------ one copy per port
# TWO COPIES MUST NOT SHARE A PORT (found 2026-10-07). Python's HTTP server turns on SO_REUSEADDR, and on
# Windows that lets a second program bind a port another is already listening on: two agents started by
# hand, or one by hand and one by the Nimrod helper, both "start", and requests go to either one. So:
#   * On Windows the agent binds with SO_EXCLUSIVEADDRUSE (Windows' own answer), so the second bind fails.
#     Elsewhere SO_REUSEADDR is kept: there it never lets two programs listen on one port, and it lets an
#     agent that systemd just restarted bind again straight away.
#   * The second copy then asks whatever holds the port for /health, says in one line what it found, and
#     exits: 0 when it is this same agent on this same folder (nothing is wrong, it is already running),
#     EXIT_PORT_TAKEN when it is anything else (a person has something to fix).
# THE PORT IS THE LOCK, not a pid file: a pid file outlives a crash and its number gets reused by some
# other program; a port is let go by the system the moment its program ends, however it ends.
EXIT_PORT_TAKEN = 3


class AgentServer(ThreadingHTTPServer):
    if sys.platform == "win32":
        allow_reuse_address = False

    def server_bind(self):
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def who_holds(host: str, port: int, timeout: float = 1.5):
    """What answers /health on host:port: its JSON, {} when something answers but not as a media agent,
    or None when nothing answers at all."""
    ask = "127.0.0.1" if host in ("", "0.0.0.0") else ("::1" if host == "::" else host)
    try:
        with socket.create_connection((ask, int(port)), timeout=timeout):
            pass
    except OSError:
        return None
    url_host = f"[{ask}]" if ":" in ask else ask
    try:
        with urllib.request.urlopen(f"http://{url_host}:{port}/health", timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8"))
            return j if isinstance(j, dict) else {}
    except (OSError, ValueError):   # an HTTP error, no answer in time, not JSON: not a media agent
        return {}


def already_running(host: str, port: int, aid: str, err: OSError, probe=who_holds) -> tuple:
    """The bind failed: (exit code, the one line to print)."""
    there = probe(host, port)
    if there and there.get("agent_id") and there.get("agent_id") == aid:
        return 0, (f"media agent: not starting a second copy: this agent is already running for this folder "
                   f"on port {port}.")
    if there and there.get("agent_id"):
        return EXIT_PORT_TAKEN, (f"media agent: not starting: another media agent (for a different folder) is "
                                 f"already using port {port}. Stop it, or pass --port with a free one.")
    if there is not None:
        return EXIT_PORT_TAKEN, (f"media agent: not starting: port {port} is already in use by another program. "
                                 f"Stop it, or pass --port with a free one.")
    return EXIT_PORT_TAKEN, f"media agent: not starting: could not listen on {host}:{port} ({err})."


# The platform origin the browser loads Nimrod from. The agent is fetched cross-origin BY that page.
# (2026-10-07: nimrodecosystem.com, the address the site is served at today, NOT nimrod.onrender.com any
# more. The helper already started this agent with --platform nimrodecosystem.com; only the agent run by
# hand or by the Linux/Windows installers still allowed the older address alone, so a page loaded from the
# site's real address got a 403 that looks exactly like a broken agent.)
# MIRRORS nimrod_helper/settings.py DEFAULTS 'platform' + 'alsoAllow' and speech_service/service.py
# DEFAULT_SITES - the helper's settings are the one source; test_agent.py fails if these drift. Copied, not
# imported, for the reason in "WHICH WEB PAGES" above (one file, Python 3.8, runs without the helper).
DEFAULT_ORIGIN = "https://nimrodecosystem.com"
# The sites the default Nimrod is served at: the address above, and the older one that still serves the same
# site. www.nimrodecosystem.com is not here: it only redirects (nimrod_helper/settings.py says so).
DEFAULT_SITES = (DEFAULT_ORIGIN, "https://nimrod.onrender.com")
AGENT_ID = ""


def sites_for(origin_args, platform, env_origin: str = "") -> tuple:
    """The sites whose pages may use the agent. --origin (or NIMROD_MEDIA_ORIGIN) when given - it REPLACES the
    default; else --platform - and when that is the default Nimrod, every address it is served at (DEFAULT_SITES),
    the same list the helper passes. A self-hosted --platform allows only itself."""
    given = site_list(origin_args or [env_origin])
    if given:
        return given
    own = site_list([platform])
    return DEFAULT_SITES if own == (DEFAULT_ORIGIN,) else own


# ---------------------------------------------------------------------- pairing
# SIX CHARACTERS INSTEAD OF AN IP ADDRESS.
#
# The old instructions were: find this machine's address on the network, then go to
# another machine and type it into a box. That is a thing a systems administrator does. It
# is not a thing you ask of somebody setting up a screen for their mother, and it was the
# reason this agent was, in practice, unusable by the people it exists for.
#
# So the agent introduces ITSELF to the platform, gets a short code back, and prints it.
# Somebody signed in types those six characters and the two ends are joined. Nobody reads
# an address out loud. Plex, Chromecast and Tailscale all work this way.
#
# WHY IT OFFERS A LIST OF ADDRESSES AND DOES NOT PICK ONE. This agent genuinely cannot
# know which of its addresses the browser will be able to reach: `localhost` works only
# when they are the same machine, a LAN address only from the same network, and it has no
# way to test either from here. The browser is the thing doing the reaching, so it is the
# thing that gets to decide - the agent offers candidates and the client keeps whichever
# one answers.
AGENT_ID_FILE = ".nimrod-agent-id"


def agent_id(root: Path) -> str:
    """A stable id for this agent, kept beside the media it serves.

    Beside the media on purpose: it identifies THIS FOLDER ON THIS MACHINE, which is what
    a media source actually is. Move the folder to a new machine and the id should travel
    with it; serve a different folder and it should not."""
    f = root / AGENT_ID_FILE
    try:
        existing = f.read_text(encoding="utf-8").strip()
        if existing:
            return existing[:32]
    except OSError:
        pass
    new = uuid.uuid4().hex
    try:
        f.write_text(new, encoding="utf-8")
    except OSError:
        # A read-only folder is a fine thing to serve; it just means the id is per-run.
        pass
    return new


def local_addresses(port: int) -> list:
    """Every address this agent might be reachable at, best first.

    localhost leads because the commonest case by far is the kiosk serving itself. The
    LAN addresses follow for the case where the screen is a different machine. Nothing
    here is a guess about which one WORKS - that is the client's job."""
    urls = [f"http://localhost:{port}"]
    seen = {"127.0.0.1", "localhost"}
    try:
        # Does not send anything; asking the routing table which interface would be used
        # to reach the internet is how you find the address other machines can see, rather
        # than the loopback that gethostbyname often returns.
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect(("8.8.8.8", 80))
            ip = probe.getsockname()[0]
        finally:
            probe.close()
        if ip and ip not in seen:
            seen.add(ip)
            urls.append(f"http://{ip}:{port}")
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in seen and not ip.startswith("127."):
                seen.add(ip)
                urls.append(f"http://{ip}:{port}")
    except OSError:
        pass
    return urls[:8]


def _post_json(url: str, payload: dict, timeout: float = 15.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _get_json(url: str, timeout: float = 15.0) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def show_code(code: str, platform: str) -> None:
    """Big, spaced, and surrounded by whitespace. Somebody is going to read this off a
    console in a room with bad light and carry it to another machine.

    FLUSHED, because Python buffers stdout the moment it is not a terminal — and this
    agent is run as a service, from a shortcut, or piped to a log file at least as often
    as it is run in a console. An unflushed pairing code is an empty log and a person
    waiting for a number that already arrived."""
    spaced = " ".join(code)
    line = "=" * (len(spaced) + 12)
    print(f"\n{line}\n     {spaced}\n{line}", flush=True)
    print(f"\n  Type that code into Nimrod:  {platform}/home.html  ->  Media", flush=True)
    print("  Waiting... (Ctrl+C to stop)\n", flush=True)


def pair(platform: str, label: str, aid: str, urls: list, poll_seconds: float = 3.0,
         get_json=_get_json, post_json=_post_json, sleep=time.sleep) -> bool:
    """Ask for a code, print it, and wait until somebody claims it.

    Returns True when claimed. The network calls and the sleep are injectable so the test
    can run the whole handshake without a server and without waiting."""
    try:
        got = post_json(f"{platform}/api/pair/request",
                        {"label": label, "base_urls": urls, "agent_id": aid})
    except urllib.error.HTTPError as e:
        print(f"could not get a pairing code: {e.code} {e.reason}")
        return False
    except OSError as e:
        print(f"could not reach {platform}: {e}")
        return False

    code = got.get("code", "")
    if not code:
        print("the platform did not return a code")
        return False
    show_code(code, platform)

    while True:
        try:
            st = get_json(f"{platform}/api/pair/status/{code}")
        except OSError:
            # A dropped connection mid-wait is not a failed pairing. The code is still
            # good on the server; keep asking rather than sending someone back to the
            # start of a setup they already finished half of.
            sleep(poll_seconds)
            continue
        if st.get("claimed"):
            print(f'  Paired. This folder is now connected as "{label}".\n', flush=True)
            return True
        if not st.get("known"):
            print("  That code expired before anyone used it. Restart to get a new one.\n", flush=True)
            return False
        sleep(poll_seconds)


def main(argv=None):
    global ROOT, SITES, CHECK_HOST, AGENT_ID
    ap = argparse.ArgumentParser(description="Nimrod local media agent (BYO storage).")
    # CLI args take precedence; each falls back to an env var so the agent can run as
    # an always-on service (systemd / Windows task) configured from an env file.
    ap.add_argument("--root", default=os.environ.get("NIMROD_MEDIA_ROOT"),
                    help="folder to serve (your photos/videos live here; or set NIMROD_MEDIA_ROOT)")
    # CLOSED BY DEFAULT. This used to bind 0.0.0.0 with CORS "*", which on a care
    # facility's shared wifi meant a resident's entire photo folder was readable by
    # anything else on the network — no password, no prompt, nothing in the UI saying so.
    # Serving your own photos to your own screen does not require that, so it is now an
    # explicit choice: --lan, which prints what it is doing.
    ap.add_argument("--host", default=os.environ.get("NIMROD_MEDIA_HOST", "127.0.0.1"),
                    help="bind address (default: 127.0.0.1, this machine only; or NIMROD_MEDIA_HOST)")
    ap.add_argument("--lan", action="store_true",
                    help="serve to your whole local network (binds 0.0.0.0). Only for a screen "
                         "on a DIFFERENT machine, and only on a network you trust.")
    ap.add_argument("--port", type=int, default=int(os.environ.get("NIMROD_MEDIA_PORT", "8770")),
                    help="port (default: 8770; or NIMROD_MEDIA_PORT)")
    # DEFAULTS TO --platform, and that is the fix for a bug this would otherwise ship
    # with. The origin that needs to be allowed is exactly the site the browser loads
    # Nimrod from, which is what --platform already names. Pinning it to the hosted
    # instance instead meant a self-hosted Nimrod, or a local one, paired successfully and
    # then could not fetch a single photo — the browser blocking on CORS looks identical to
    # a broken agent, and there is nothing on either console to say otherwise.
    ap.add_argument("--origin", action="append", default=None, metavar="SITE[,SITE...]",
                    help="the sites whose pages may use this agent (comma-separated or given more than "
                         "once; defaults to --platform, which is the site the browser loads Nimrod from - "
                         "for the default Nimrod, both addresses it is served at; "
                         "or NIMROD_MEDIA_ORIGIN). Pages on this computer itself (http://127.0.0.1, "
                         "localhost) are always allowed; every other site is refused with 403. '*' allows "
                         "any site, which you should not need.")
    ap.add_argument("--pair", action="store_true",
                    help="show a pairing code and wait for someone to type it into Nimrod. "
                         "Do this once; afterwards just run the agent.")
    ap.add_argument("--platform", default=os.environ.get("NIMROD_PLATFORM", DEFAULT_ORIGIN),
                    help=f"where Nimrod is running (default {DEFAULT_ORIGIN}; or NIMROD_PLATFORM)")
    ap.add_argument("--name", default=os.environ.get("NIMROD_MEDIA_NAME", "Media device"),
                    help="what to call this device in Nimrod (e.g. \"the bedside screen\")")
    args = ap.parse_args(argv)

    if not args.root:
        ap.error("a folder to serve is required — pass --root or set NIMROD_MEDIA_ROOT")
    root = Path(args.root).expanduser()
    if not root.is_dir():
        ap.error(f"--root is not a folder: {root}")
    ROOT = root
    SITES = sites_for(args.origin, args.platform, os.environ.get("NIMROD_MEDIA_ORIGIN", ""))
    AGENT_ID = agent_id(root)
    host = "0.0.0.0" if args.lan else args.host
    CHECK_HOST = host in LOOPBACK

    # SimpleHTTPRequestHandler serves relative to `directory`; point it at ROOT so
    # the inherited translate_path guard keeps every file request inside it.
    def make_handler(*a, **kw):
        return Handler(*a, directory=str(ROOT.resolve()), **kw)

    try:
        httpd = AgentServer((host, args.port), make_handler)
    except OSError as err:
        code, line = already_running(host, args.port, AGENT_ID, err)
        print(line, file=sys.stderr, flush=True)
        return code

    # PAIR WHILE SERVING, NOT BEFORE IT. The browser probes the candidate addresses the
    # moment the code is claimed, so the agent has to be answering /health by then. Pair
    # first and every probe fails against a socket that is not listening yet.
    if args.pair:
        aid = agent_id(ROOT)
        urls = local_addresses(args.port)
        threading.Thread(target=pair, args=(args.platform.rstrip("/"), args.name, aid, urls),
                         daemon=True).start()
    resolved = ROOT.resolve()
    print(f"Nimrod media agent serving:  {resolved}")
    print(f"  listening on  http://{host}:{args.port}")
    print(f"  pages allowed from {', '.join(SITES)} and this computer; other sites get 403")
    print(f"  try           http://localhost:{args.port}/list")
    # Say the exposure out loud, every time. Someone who typed --lan months ago and left
    # it running in a facility should be reminded what that means whenever they look.
    if host == "0.0.0.0":
        print("  NOTE: reachable by ANY device on this network. Everything in the folder "
              "above is readable by them.")
    if "*" in SITES:
        print("  NOTE: open to any website (--origin '*'): any page you visit can list and read this folder.")
    print("  Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
