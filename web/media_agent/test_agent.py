#!/usr/bin/env python3
"""End-to-end test for the local media agent — zero dependencies.

Spawns the real agent as a subprocess against a throwaway media tree, then hits it
over HTTP exactly as the browser client will: listing, file bytes, CORS, album
navigation, case-insensitivity, and a path-traversal probe. Run:

    python test_agent.py
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
AGENT = HERE / "agent.py"

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}   {detail}")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(url: str, headers: dict | None = None, method: str = "GET"):
    """Return (status, headers, body_bytes). Never raises on HTTP error codes."""
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}, method=method), timeout=5)
        return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def get_json(url: str, headers: dict | None = None):
    status, headers, body = get(url, headers)
    return status, headers, json.loads(body.decode("utf-8"))


EVIL = "https://evil.example"


def check_origin_rules():
    """PURE - no agent process. The agent's page check is a COPY of the speech program's (agent.py, "WHICH WEB
    PAGES", says why it is not imported); this runs both over one table and fails if they ever disagree."""
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(HERE.parent))
    import agent  # noqa: E402
    from speech_service import service as SP  # noqa: E402

    sites = ("https://nimrodecosystem.com", "https://nimrod.onrender.com")
    origins = [None, "", "https://nimrodecosystem.com", "https://nimrodecosystem.com/", "https://nimrod.onrender.com",
               "http://127.0.0.1:8680", "http://localhost:8000", "http://localhost", "http://[::1]:9", EVIL, "null",
               "http://127.0.0.1.evil.example", "http://localhost.evil.example:8000",
               "https://nimrodecosystem.com.evil.example", "http://nimrodecosystem.com", "https://localhost:8000",
               "https://www.nimrodecosystem.com"]
    hosts = [None, "", "127.0.0.1:8770", "localhost:8770", "LOCALHOST", "[::1]:8770", "evil.example:8770",
             "127.0.0.1.evil.example", "desk:8770"]
    differ = [(o, h, lb) for o in origins for h in hosts for lb in (True, False)
              if (agent.refusal(o, h, sites, lb) == "") != (SP.refusal(o, h, sites, lb) == "")]
    check("*** the agent and the speech program allow exactly the same pages and hosts (a table of "
          f"{len(origins) * len(hosts) * 2}) ***", not differ, detail=repr(differ[:6]))
    check("origins: another site, a look-alike, http for https and 'null' are refused",
          not any(agent.origin_allowed(o, sites) for o in (EVIL, "null", "http://nimrodecosystem.com",
                                                           "https://nimrodecosystem.com.evil.example")))
    check("origins: '*' (chosen on purpose) lets any site in, as the old open setting did",
          agent.origin_allowed(EVIL, ("*",)) and agent.origin_allowed("null", ("*",)))
    check("--origin values: comma-separated or repeated, no repeats, no trailing slash",
          agent.site_list(["https://a.example/, https://b.example", "https://a.example"])
          == ("https://a.example", "https://b.example") and agent.site_list([""]) == () and agent.site_list(None) == ())


def check_default_sites():
    """PURE - no agent process. (2026-10-07.) The agent's default Nimrod is the helper's: nimrod_helper/settings.py
    DEFAULTS is the one source, and the agent (one file, run on its own by the installers) keeps a copy. These fail
    if the copy drifts from it, or from the speech program's (which test_helper.py already holds to the same)."""
    sys.path.insert(0, str(HERE))
    sys.path.insert(0, str(HERE.parent))
    import agent  # noqa: E402
    from nimrod_helper import settings as HS  # noqa: E402
    from speech_service import service as SP  # noqa: E402

    want = tuple([HS.DEFAULTS["platform"]] + list(HS.DEFAULTS["alsoAllow"]))
    check("*** the agent's default --platform is the helper's platform (nimrodecosystem.com) ***",
          agent.DEFAULT_ORIGIN == HS.DEFAULTS["platform"], detail=f"{agent.DEFAULT_ORIGIN} vs {HS.DEFAULTS['platform']}")
    check("*** ...and its default sites are the helper's platform + alsoAllow, and the speech program's ***",
          agent.DEFAULT_SITES == want == tuple(SP.DEFAULT_SITES), detail=f"{agent.DEFAULT_SITES} vs {want} vs {SP.DEFAULT_SITES}")
    check("nothing given: the default Nimrod's addresses (the helper's list), never '*'",
          agent.sites_for(None, agent.DEFAULT_ORIGIN) == want and "*" not in agent.sites_for(None, agent.DEFAULT_ORIGIN)
          and agent.sites_for(None, agent.DEFAULT_ORIGIN + "/") == want)
    check("a self-hosted --platform allows only itself",
          agent.sites_for(None, "https://my-nimrod.example") == ("https://my-nimrod.example",))
    check("--origin, or NIMROD_MEDIA_ORIGIN, replaces the default; --origin wins over the variable",
          agent.sites_for(["https://a.example"], agent.DEFAULT_ORIGIN) == ("https://a.example",)
          and agent.sites_for(None, agent.DEFAULT_ORIGIN, "https://b.example") == ("https://b.example",)
          and agent.sites_for(["https://a.example"], agent.DEFAULT_ORIGIN, "https://b.example") == ("https://a.example",))
    check("an empty NIMROD_MEDIA_ORIGIN (the installer's unset line) is the default, not 'no site'",
          agent.sites_for(None, agent.DEFAULT_ORIGIN, "") == want)
    sh = (HERE / "deploy" / "install-linux.sh").read_bytes()
    check("*** the Linux installer no longer defaults to '*' (any website) ***",
          b'ORIGIN="${2:-*}"' not in sh and b'ORIGIN="${2:-}"' in sh)
    check("the Linux installer keeps LF line endings (CRLF breaks the shebang on a Pi)", b"\r" not in sh)
    fx = (HERE / "make_test_fixtures.py").read_text(encoding="utf-8")
    check("the fixtures hint no longer asks for --origin http://localhost:8000 (this computer is always allowed)",
          "--origin http://localhost:8000" not in fx)


CLIENT = HERE.parent / "client"
KINDS_TABLE = CLIENT / "dev" / "media_kinds.json"
FOLDER_SOURCE = CLIENT / "folder_source.js"


def js_exts(src: str, name: str) -> set:
    """The extensions in `export const NAME = [...]` in folder_source.js, as '.ext' strings."""
    m = re.search(r"export const " + name + r"\s*=\s*\[([^\]]*)\]", src)
    if not m:
        return set()
    return {"." + e for e in re.findall(r"'([a-z0-9]+)'", m.group(1))}


def check_kinds_agree():
    """PURE - no agent process. The media agent and the browser's folder lister must classify
    every file the same way, or a song plays from one kind of source and not the other.

    Two checks: the agent's `kind_of` against the ONE shared table (which the browser side,
    dev/media_sources_test.html, checks `kindOf` against too), and the agent's extension sets
    against the arrays in folder_source.js itself, so an extension added on one side only fails
    here even if nobody added it to the table."""
    sys.path.insert(0, str(HERE))
    import agent  # noqa: E402  (the module, not the process; main() is not run)

    table = json.loads(KINDS_TABLE.read_text(encoding="utf-8"))
    wrong = [f"{n}: want {k}, got {agent.kind_of(n)}" for n, k in table["cases"] if agent.kind_of(n) != k]
    check(f"agent kind_of agrees with every row of media_kinds.json ({len(table['cases'])})",
          not wrong, detail="; ".join(wrong))

    src = FOLDER_SOURCE.read_text(encoding="utf-8")
    for js_name, py_set in (("IMAGE_EXTS", agent.IMAGE_EXTS), ("VIDEO_EXTS", agent.VIDEO_EXTS),
                            ("AUDIO_EXTS", agent.AUDIO_EXTS)):
        js_set = js_exts(src, js_name)
        check(f"{js_name}: agent.py and folder_source.js list the same extensions",
              bool(js_set) and js_set == py_set,
              detail=f"only in js={sorted(js_set - py_set)} only in agent={sorted(py_set - js_set)}")
    check("the agent lists audio as media (MEDIA_EXTS includes AUDIO_EXTS)",
          agent.AUDIO_EXTS <= agent.MEDIA_EXTS)


def run_agent(root: Path, port: int, timeout: float = 20):
    """Start a copy of the agent and wait for it to end: (exit code, what it printed). None when it kept running
    (a second copy that started instead of stepping aside - the bug)."""
    p = subprocess.Popen([sys.executable, str(AGENT), "--root", str(root), "--host", "127.0.0.1",
                          "--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, out
    except subprocess.TimeoutExpired:
        p.kill()
        out, _ = p.communicate()
        return None, out


def double_start_tests(root: Path, tmp: Path, port: int, base: str, origin: str):
    """ONE COPY PER PORT. A first agent is running on `port` for `root`."""
    sys.path.insert(0, str(HERE))
    import agent  # noqa: E402

    code, out = run_agent(root, port)
    check("*** double start: a second copy for the same folder steps aside (exit 0), saying it is already running ***",
          code == 0 and "already running for this folder" in out, detail=f"code={code} out={out[-300:]!r}")
    s, h, j = get_json(f"{base}/health", {"Origin": origin})
    check("double start: ...and the first copy still answers, unchanged",
          s == 200 and h.get("Access-Control-Allow-Origin") == origin, detail=f"status={s}")

    other = tmp / "other"
    other.mkdir(exist_ok=True)
    code, out = run_agent(other, port)
    check("double start: another media agent (a different folder) on the port -> exit 3, said plainly",
          code == agent.EXIT_PORT_TAKEN and "another media agent" in out, detail=f"code={code} out={out[-300:]!r}")

    holder = socket.socket()
    holder.bind(("127.0.0.1", 0))
    holder.listen(1)
    hport = holder.getsockname()[1]
    try:
        code, out = run_agent(root, hport, timeout=30)
    finally:
        holder.close()
    check("double start: a port another program holds -> exit 3, 'in use by another program'",
          code == agent.EXIT_PORT_TAKEN and "in use by another program" in out, detail=f"code={code} out={out[-300:]!r}")

    # The decision on its own, with what answers on the port made up.
    err = OSError("taken")
    same = agent.already_running("127.0.0.1", 1, "abc", err, probe=lambda h, p: {"ok": True, "agent_id": "abc"})
    diff = agent.already_running("127.0.0.1", 1, "abc", err, probe=lambda h, p: {"ok": True, "agent_id": "xyz"})
    some = agent.already_running("127.0.0.1", 1, "abc", err, probe=lambda h, p: {})
    none = agent.already_running("10.9.9.9", 1, "abc", err, probe=lambda h, p: None)
    check("double start: same agent -> 0; another agent, another program, nothing at all -> 3, each said differently",
          same[0] == 0 and diff[0] == some[0] == none[0] == agent.EXIT_PORT_TAKEN
          and len({same[1], diff[1], some[1], none[1]}) == 4 and "could not listen on 10.9.9.9:1" in none[1],
          detail=repr((same, diff, some, none)))


def page_tests(base: str, origin: str):
    """WHICH WEB PAGES, over HTTP. The agent was started with --origin `origin` (a site that is not on this
    computer), so --platform's default is NOT allowed: --origin replaces it."""
    for path in ("/health", "/list", "/files/apple.jpg"):
        s, h, body = get(f"{base}{path}", {"Origin": EVIL})
        check(f"*** {path}: a page from another site -> 403, no CORS header, nothing listed or served ***",
              s == 403 and "Access-Control-Allow-Origin" not in h and b"apple" not in body and b"JPEGDATA" not in body,
              detail=f"status={s} {body[:120]!r}")
    s, h, _ = get(f"{base}/list", {"Origin": EVIL, "Access-Control-Request-Private-Network": "true"}, method="OPTIONS")
    check("the private-network preflight from another site -> 403, not answered",
          s == 403 and "Access-Control-Allow-Private-Network" not in h, detail=f"status={s}")
    s, h, _ = get(f"{base}/list", {"Origin": origin, "Access-Control-Request-Private-Network": "true"}, method="OPTIONS")
    check("...and from the person's Nimrod it is answered, its Origin echoed",
          s == 204 and h.get("Access-Control-Allow-Private-Network") == "true"
          and h.get("Access-Control-Allow-Origin") == origin, detail=f"status={s} {h}")
    s, h, _ = get(f"{base}/list", {"Origin": "http://localhost:8000"})
    check("a page on this computer (the dev server) may, its Origin echoed",
          s == 200 and h.get("Access-Control-Allow-Origin") == "http://localhost:8000", detail=f"status={s}")
    s1, _, _ = get(f"{base}/list", {"Origin": "https://nimrodecosystem.com"})
    s2, _, _ = get(f"{base}/list", {"Origin": "https://nimrod.onrender.com"})
    check("--origin replaces the --platform default (neither default address is allowed here)",
          s1 == 403 and s2 == 403, detail=f"status={s1},{s2}")
    s, h, _ = get(f"{base}/files/apple.jpg")
    check("no Origin (an <img> load, a program) is served, with no CORS header needed",
          s == 200 and "Access-Control-Allow-Origin" not in h, detail=f"status={s}")
    s, _, body = get(f"{base}/list", {"Host": "evil.example:8770"})
    check("*** listening on this computer: a Host naming another site -> 403 (DNS rebinding) ***",
          s == 403 and b"apple" not in body, detail=f"status={s}")
    s, _, _ = get(f"{base}/files/apple.jpg", {"Host": f"localhost:{base.rsplit(':', 1)[1]}"})
    check("...a Host naming this computer goes on", s == 200, detail=f"status={s}")
    s, h, _ = get(f"{base}/files/apple.jpg", {"Origin": EVIL}, method="HEAD")
    check("HEAD from another site -> 403 too", s == 403, detail=f"status={s}")


def main():
    check_kinds_agree()
    check_origin_rules()
    check_default_sites()

    tmp = Path(tempfile.mkdtemp(prefix="nimrod_media_"))
    root = tmp / "photos"
    root.mkdir()

    # A representative tree: mixed-case extensions, a video, a subfolder album, a
    # non-media file, a dotfile, and a "secret" OUTSIDE the root for the traversal probe.
    (root / "apple.jpg").write_bytes(b"\xff\xd8\xff\xe0JPEGDATA")           # image
    (root / "Banana.JPG").write_bytes(b"\xff\xd8\xff\xe0UPPERCASE")         # image, upper ext
    (root / "clip.MP4").write_bytes(b"\x00\x00\x00\x18ftypmp42")            # video, upper ext
    (root / "song.MP3").write_bytes(b"ID3\x03\x00MP3DATA")                  # audio, upper ext
    (root / "notes.txt").write_bytes(b"not media")                         # excluded
    (root / ".hidden.jpg").write_bytes(b"hidden")                          # excluded (dotfile)
    album = root / "trip"
    album.mkdir()
    (album / "cliff.png").write_bytes(b"\x89PNG\r\n\x1a\nPNGDATA")         # image in album
    (tmp / "secret.txt").write_bytes(b"TOP SECRET should never be served") # outside root
    # folder art (2026-10-07): an SVG drawing that tries everything - a script, an onload, a picture from elsewhere.
    art = root / "art"
    art.mkdir()
    (art / "Hostile.SVG").write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script>'
                                      b'<image href="http://evil.example/x.png"/></svg>')

    port = free_port()
    origin = "https://self.example"    # a site that is NOT on this computer: those are always allowed anyway
    proc = subprocess.Popen(
        [sys.executable, str(AGENT), "--root", str(root),
         "--host", "127.0.0.1", "--port", str(port), "--origin", origin],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        # wait for /health to come up
        up = False
        for _ in range(50):
            try:
                s, _, _ = get(f"{base}/health")
                if s == 200:
                    up = True
                    break
            except Exception:
                time.sleep(0.1)
        check("agent starts and answers /health", up)
        if not up:
            out = proc.stdout.read() if proc.stdout else ""
            print("---- agent output ----\n" + out)
            return

        # /health
        s, h, j = get_json(f"{base}/health", {"Origin": origin})
        check("/health: ok and the agent's id - what the site reads (media_sources.js)",
              s == 200 and j.get("ok") is True and bool(j.get("agent_id")), detail=repr(j))
        check("*** /health does not say the folder's path (nor anything else the site does not use) ***",
              set(j) == {"ok", "agent_id"} and str(root) not in json.dumps(j) and "photos" not in json.dumps(j),
              detail=repr(j))
        check("/health carries CORS origin", h.get("Access-Control-Allow-Origin") == origin,
              detail=repr(h.get("Access-Control-Allow-Origin")))

        # /list (root)
        s, h, j = get_json(f"{base}/list")
        names = sorted(i["name"] for i in j.get("items", []))
        check("/list returns exactly the 4 media files (case-insensitive)",
              names == ["Banana.JPG", "apple.jpg", "clip.MP4", "song.MP3"], detail=repr(names))
        check("/list excludes non-media and dotfiles", "notes.txt" not in names and ".hidden.jpg" not in names)
        kinds = {i["name"]: i["kind"] for i in j["items"]}
        check("kinds classified (image/video/audio)",
              kinds.get("apple.jpg") == "image" and kinds.get("clip.MP4") == "video"
              and kinds.get("song.MP3") == "audio", detail=repr(kinds))
        s, _, body = get(f"{base}/files/song.MP3")
        check("/files serves an audio file's bytes", s == 200 and body.startswith(b"ID3"), detail=f"status={s}")
        check("/list surfaces the subfolder as an album", "trip" in j.get("albums", []), detail=repr(j.get("albums")))
        check("items carry relative path as id", all(i["id"] == i["path"] for i in j["items"]))

        # CORS preflight
        req = urllib.request.Request(f"{base}/list", method="OPTIONS", headers={"Origin": origin})
        r = urllib.request.urlopen(req, timeout=5)
        check("OPTIONS preflight returns CORS + 204",
              r.status == 204 and "GET" in (r.headers.get("Access-Control-Allow-Methods") or ""))

        # /list?album=trip
        s, h, j = get_json(f"{base}/list?album=trip")
        anames = sorted(i["name"] for i in j.get("items", []))
        check("/list?album=trip lists the album's media", anames == ["cliff.png"], detail=repr(anames))
        check("album item path is nested", j["items"] and j["items"][0]["path"] == "trip/cliff.png")

        # folder art: an .svg is listed as a picture, and served so it can never run as a page of the agent
        s, h, j = get_json(f"{base}/list?album=art")
        check("folder art: an .svg (any case) is listed as an image",
              [(i["name"], i["kind"]) for i in j.get("items", [])] == [("Hostile.SVG", "image")], detail=repr(j))
        s, h, body = get(f"{base}/files/art/Hostile.SVG", {"Origin": origin})
        check("folder art: an .svg is served as image/svg+xml (what an <img> needs to show it)",
              s == 200 and (h.get("Content-Type") or "").startswith("image/svg+xml"), detail=repr(h.get("Content-Type")))
        csp = h.get("Content-Security-Policy") or ""
        check("*** folder art: ...inside a sandbox - opened on its own it runs no script and loads nothing ***",
              "sandbox" in csp and "default-src 'none'" in csp and "script-src" not in csp, detail=repr(csp))
        s, h, _ = get(f"{base}/files/apple.jpg")
        check("folder art: every file gets the same sandbox, not only an .svg",
              "sandbox" in (h.get("Content-Security-Policy") or ""), detail=repr(h.get("Content-Security-Policy")))

        # /files/<rel> serves the real bytes with CORS
        s, h, body = get(f"{base}/files/apple.jpg", {"Origin": origin})
        check("/files/apple.jpg serves the bytes", s == 200 and body == b"\xff\xd8\xff\xe0JPEGDATA")
        check("/files carries CORS origin", h.get("Access-Control-Allow-Origin") == origin)
        s, h, body = get(f"{base}/files/trip/cliff.png")
        check("/files/trip/cliff.png serves nested media", s == 200 and body.startswith(b"\x89PNG"))

        # Range request (video seeking relies on this; inherited from SimpleHTTPRequestHandler)
        req = urllib.request.Request(f"{base}/files/clip.MP4", headers={"Range": "bytes=0-3"})
        try:
            r = urllib.request.urlopen(req, timeout=5)
            rbody, rstatus = r.read(), r.status
        except urllib.error.HTTPError as e:
            rbody, rstatus = e.read(), e.code
        check("Range request honored (206, partial body)", rstatus == 206 and rbody == b"\x00\x00\x00\x18",
              detail=f"status={rstatus} body={rbody!r}")

        # Path traversal: percent-encoded ../../secret.txt must NOT escape root
        s, _, body = get(f"{base}/files/%2e%2e%2f%2e%2e%2fsecret.txt")
        check("path traversal blocked (secret not served)",
              s in (403, 404) and b"SECRET" not in body, detail=f"status={s}")
        s2, _, body2 = get(f"{base}/files/../secret.txt")
        check("path traversal (client-normalized) also blocked",
              b"SECRET" not in body2)

        # /list?album with traversal is rejected
        s, _, j = get_json(f"{base}/list?album=../")
        check("/list traversal album rejected", s in (403, 404), detail=f"status={s}")

        page_tests(base, origin)
        double_start_tests(root, tmp, port, base, origin)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
