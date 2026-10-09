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
import shutil
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


HISTORY_PLACE = CLIENT / "history_place.js"


def check_syntax_38():
    """PURE. The agent promises Python 3.8 (the installers run it on whatever python3 a machine has): its grammar
    must still parse as 3.8 - no `match`, no parenthesised context managers - after every change (agent history)."""
    import ast
    src = AGENT.read_text(encoding="utf-8")
    try:
        ast.parse(src, filename="agent.py", feature_version=(3, 8))
        ok, why = True, ""
    except SyntaxError as e:
        ok, why = False, f"line {e.lineno}: {e.msg}"
    check("*** agent.py still parses as Python 3.8 ***", ok, detail=why)
    check("...and uses nothing from 3.9+ by name (removeprefix, is_relative_to, functools.cache)",
          not any(w in src for w in (".removeprefix(", ".removesuffix(", ".is_relative_to(", "functools.cache\n")))


def check_history_pure():
    """PURE - the functions, no agent process. AGENT HISTORY: append-only, never outside the data dir, the page's
    own file names and rotation."""
    sys.path.insert(0, str(HERE))
    import agent  # noqa: E402

    js = HISTORY_PLACE.read_text(encoding="utf-8")
    m = re.search(r"fileMax:\s*(\d+)\s*\*\s*(\d+)", js)
    check("the agent rotates history files at the page's own size (history_place.js fileMax)",
          m and int(m.group(1)) * int(m.group(2)) == agent.HISTORY_FILE_MAX, detail=repr(m and m.group(0)))
    m = re.search(r"postBytes:\s*(\d+)\s*\*\s*(\d+)", js)
    check("the page's biggest post fits under the agent's cap (AGENT_HISTORY_DEFAULTS.postBytes < HISTORY_BODY_MAX)",
          m and int(m.group(1)) * int(m.group(2)) < agent.HISTORY_BODY_MAX, detail=repr(m and m.group(0)))
    check("from this computer: 127.x and ::1 only (a LAN peer, an empty peer are not)",
          all(agent.from_this_computer(p) for p in ("127.0.0.1", "127.0.1.1", "::1", "::ffff:127.0.0.1"))
          and not any(agent.from_this_computer(p) for p in ("192.168.1.5", "100.97.79.13", "", None, "::ffff:10.0.0.2",
                                                               "1270.0.0.1")))

    sh = (HERE / "deploy" / "install-linux.sh").read_text(encoding="utf-8")
    check("the Linux installer takes NIMROD_MEDIA_DATA, and still writes agent.env only when there is none "
          "(one '>' to it; the history line is only ever appended)",
          'DATA="${NIMROD_MEDIA_DATA:-}"' in sh and sh.count("> /etc/nimrod/agent.env") - sh.count(">> /etc/nimrod/agent.env") == 1
          and "cat > /etc/nimrod/agent.env" in sh)

    tmp = Path(tempfile.mkdtemp(prefix="nimrod_hist_"))
    data = tmp / "Nimrod" / "Data"
    row = lambda i, at="2026-10-08T10:00:00.000Z": {"at": at, "kind": "play", "data": {"id": f"p{i}", "panel": "ph-1"}}  # noqa: E731

    off = agent.history_status(None)
    a, s = agent.history_append(None, "plays", "ph-1", [row(0)])
    check("off (no --data-dir): status says so, a write is refused", off == {"ok": True, "enabled": False}
          and s == 404 and a["why"] == "off")
    st = agent.history_status(data)
    a, s = agent.history_append(data, "plays", "ph-1", [row(0)])
    check("*** the Data folder not there (a drive not plugged in): 'missing', and it is NOT created ***",
          st.get("ready") is False and st.get("why") == "missing" and s == 503 and not data.exists()
          and not (tmp / "Nimrod").exists(), detail=repr((st, a)))

    data.mkdir(parents=True)
    st = agent.history_status(data)
    hdir = data / "History"
    fid = st.get("folder_id", "")
    check("with it: ready, History made inside it, an id made in folder-id.txt (the page's id shape)",
          st.get("ready") is True and hdir.is_dir() and re.match(r"^[A-Za-z0-9-]{6,64}$", fid or "")
          and (hdir / "folder-id.txt").read_text(encoding="utf-8").strip() == fid, detail=repr(st))
    check("...the same id the next time (it names the folder)", agent.history_status(data).get("folder_id") == fid)
    check("a README says what the files are and that Nimrod does not delete them",
          "does not delete" in (hdir / "README.txt").read_text(encoding="utf-8"))
    check("status never says the folder's path", str(tmp) not in json.dumps(st) and "Nimrod" not in json.dumps(st))

    a, s = agent.history_append(data, "plays", "ph-1", [row(0), row(1, "2026-10-08T10:00:01.000Z")])
    f1 = hdir / "plays-ph-1-2026-10.jsonl"
    lines = f1.read_text(encoding="utf-8").splitlines() if f1.exists() else []
    check("*** appended as JSON lines: History/plays-ph-1-2026-10.jsonl, the page's own line ({at, kind, data}) ***",
          s == 200 and a["written"] == 2 and len(lines) == 2
          and lines[0] == '{"at":"2026-10-08T10:00:00.000Z","kind":"play","data":{"id":"p0","panel":"ph-1"}}',
          detail=repr((a, lines)))
    agent.history_append(data, "plays", "ph-1", [row(2)])
    check("*** a second write APPENDS (the first two are still there, unchanged) ***",
          f1.read_text(encoding="utf-8").splitlines()[:2] == lines and len(f1.read_text(encoding="utf-8").splitlines()) == 3)
    small = 400
    for i in range(3, 9):
        agent.history_append(data, "plays", "ph-1", [row(i)], file_max=small)
    check("*** past its size the next part is started (.part2.jsonl), nothing in the first rewritten ***",
          (hdir / "plays-ph-1-2026-10.part2.jsonl").exists()
          and f1.read_text(encoding="utf-8").splitlines()[:3] == (lines + [f1.read_text(encoding="utf-8").splitlines()[2]]))
    a, s = agent.history_append(data, "gameplay", "scr-1",
                                [row(1, "2026-10-31T23:59:59Z"), row(2, "2026-11-01T00:00:00Z"), row(3, "no date")])
    check("rows of two months go to two files, a row with no date to '-undated'",
          s == 200 and (hdir / "gameplay-scr-1-2026-10.jsonl").exists() and (hdir / "gameplay-scr-1-2026-11.jsonl").exists()
          and (hdir / "gameplay-scr-1-undated.jsonl").exists(), detail=repr(a))
    a, s = agent.history_append(data, "words", "b-1", [row(1), {"at": 5, "kind": "x", "data": {}}, "junk",
                                                       {"at": "2026-10-08", "kind": "../x", "data": {}},
                                                       {"at": "2026-10-08", "kind": "select", "data": [1]}])
    check("a row that is not an entry is skipped and counted; the good ones are still written",
          s == 200 and a["written"] == 1 and a["skipped"] == 4, detail=repr(a))

    before = sorted(p.name for p in tmp.rglob("*"))
    bad = [("../plays", "ph-1"), ("plays", "../../x"), ("plays/..", "ph-1"), ("plays", "a/b"), ("plays", "..\\x"),
           ("plays", ""), ("", "ph-1"), ("Plays", "ph-1"), ("plays.jsonl", "x"), ("plays", "x" * 65),
           ("plays-x", "ph-1"), ("plays", "C:"), ("plays", "ph 1"), (None, "ph-1"), ("plays", None)]
    refused = [(k, sc) for k, sc in bad if agent.history_append(data, k, sc, [row(9)])[1] != 400]
    after = sorted(p.name for p in tmp.rglob("*"))
    check(f"*** traversal: every bad stream or scope ({len(bad)}) is refused with 400 and nothing is written ***",
          not refused and before == after and not (tmp / "x").exists(), detail=repr(refused))
    check("rows that are not a list: 400", agent.history_append(data, "plays", "ph-1", {"a": 1})[1] == 400)

    a, s = agent.history_append(data, "plays", "ph-1", [row(1)], expect_id="some-other-folder")
    check("*** a page that counted on a different folder (a drive swapped) is refused with 409, nothing written ***",
          s == 409 and a["why"] == "changed" and a["folder_id"] == fid, detail=repr(a))
    a, s = agent.history_append(data, "plays", "ph-1", [row(1)], expect_id=fid)
    check("...and its own folder's id is taken", s == 200, detail=repr(a))

    # folder-id.txt: an empty one is appended to, one with something else is never overwritten
    d2 = tmp / "D2"
    (d2 / "History").mkdir(parents=True)
    (d2 / "History" / "folder-id.txt").write_text("", encoding="utf-8")
    got = agent.history_status(d2)
    check("an EMPTY folder-id.txt gets an id (appended, not replaced)", got.get("ready") is True
          and (d2 / "History" / "folder-id.txt").read_text(encoding="utf-8").strip() == got.get("folder_id"))
    d3 = tmp / "D3"
    (d3 / "History").mkdir(parents=True)
    (d3 / "History" / "folder-id.txt").write_text("not an id!\n", encoding="utf-8")
    got = agent.history_status(d3)
    a, s = agent.history_append(d3, "plays", "ph-1", [row(1)])
    check("*** a folder-id.txt holding something else is never overwritten: not ready, said plainly, nothing written ***",
          got.get("ready") is False and got.get("why") == "id" and s == 503
          and (d3 / "History" / "folder-id.txt").read_text(encoding="utf-8") == "not an id!\n"
          and not (d3 / "History" / "plays-ph-1-2026-10.jsonl").exists(), detail=repr(got))

    # a symlink pointing out of History (where this computer lets a test make one)
    outside = tmp / "outside.jsonl"
    outside.write_text("", encoding="utf-8")
    link = hdir / "plays-evil-2026-10.jsonl"
    try:
        os.symlink(str(outside), str(link))
        made = True
    except (OSError, NotImplementedError):
        made = False
    if made:
        a, s = agent.history_append(data, "plays", "evil", [row(1)])
        check("*** a history file that is a symlink pointing outside is refused; the outside file is untouched ***",
              s == 500 and outside.read_text(encoding="utf-8") == "", detail=repr(a))
    else:
        print("  SKIP  symlink escape (this computer does not let a test make a symlink)")
    hlink_dir = tmp / "D4"
    hlink_dir.mkdir()
    try:
        os.symlink(str(tmp / "D3"), str(hlink_dir / "History"), target_is_directory=True)
        made = True
    except (OSError, NotImplementedError):
        made = False
    if made:
        got = agent.history_status(hlink_dir)
        check("*** a History folder that is a symlink to somewhere else is refused ('write') ***",
              got.get("ready") is False and got.get("why") == "write", detail=repr(got))
    st = agent.history_status(data)
    check("status counts files and bytes per stream", st["streams"]["plays"]["files"] >= 2
          and st["streams"]["gameplay"]["files"] == 3 and st["streams"]["words"]["bytes"] > 0, detail=repr(st["streams"]))
    return tmp


def history_http_tests(base: str, origin: str, data: Path):
    """AGENT HISTORY over HTTP: the agent was started with --data-dir `data`."""
    import http.client
    port = int(base.rsplit(":", 1)[1])

    def post(path, body, headers=None, raw=None):
        h = {"Content-Type": "application/json", "Origin": origin}
        h.update(headers or {})
        data_bytes = raw if raw is not None else json.dumps(body).encode("utf-8")
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            c.request("POST", path, body=data_bytes, headers=h)
            r = c.getresponse()
            return r.status, dict(r.getheaders()), r.read()
        finally:
            c.close()

    s, h, j = get_json(f"{base}/history/status", {"Origin": origin})
    fid = j.get("folder_id")
    check("GET /history/status: ready, the folder's id, its Origin echoed",
          s == 200 and j.get("enabled") is True and j.get("ready") is True and fid
          and h.get("Access-Control-Allow-Origin") == origin, detail=repr(j))
    rows = [{"at": "2026-10-08T12:00:00.000Z", "kind": "play", "data": {"id": "x1"}}]
    s, h, b = post("/history/plays", {"scope": "ph-7", "rows": rows, "folder_id": fid})
    f = data / "History" / "plays-ph-7-2026-10.jsonl"
    check("*** POST /history/plays from the person's Nimrod: appended, its Origin echoed ***",
          s == 200 and f.exists() and len(f.read_text(encoding="utf-8").splitlines()) == 1
          and h.get("Access-Control-Allow-Origin") == origin, detail=f"status={s} {b[:200]!r}")
    size = f.stat().st_size

    def unchanged():
        return f.stat().st_size == size

    s, h, b = post("/history/plays", {"scope": "ph-7", "rows": rows}, {"Origin": EVIL})
    check("*** a page from another site: 403, no CORS header, nothing written ***",
          s == 403 and "Access-Control-Allow-Origin" not in h and unchanged(), detail=f"status={s}")
    s, _, _ = post("/history/plays", {"scope": "ph-7", "rows": rows}, {"Host": "evil.example:8770"})
    check("*** a Host naming another site (DNS rebinding): 403, nothing written ***", s == 403 and unchanged())
    s, _, _ = post("/history/plays", None, {"Content-Type": "text/plain"},
                   raw=json.dumps({"scope": "ph-7", "rows": rows}).encode())
    check("*** not JSON (what a plain form can send without asking first): 415, nothing written ***",
          s == 415 and unchanged(), detail=f"status={s}")
    s, _, _ = post("/history/plays", None, {"Content-Length": str(10 * 1024 * 1024)}, raw=b"{}")
    check("*** a body over the cap: 413 before it is read, nothing written ***", s == 413 and unchanged(),
          detail=f"status={s}")
    for path in ("/history/..%2f..%2fx", "/history/%2e%2e", "/history/plays/../../x", "/history/Plays"):
        s, _, _ = post(path, {"scope": "ph-7", "rows": rows})
        check(f"traversal in the address ({path}) is refused, nothing written", s in (400, 404) and unchanged(),
              detail=f"status={s}")
    s, _, _ = post("/history/plays", {"scope": "../ph-7", "rows": rows})
    check("traversal in the scope: 400", s == 400 and unchanged())
    s, _, b = post("/history/plays", {"scope": "ph-7", "rows": rows, "folder_id": "another-folder"})
    check("a page that counted on another folder: 409, nothing written", s == 409 and unchanged(), detail=f"status={s}")
    for method in ("PUT", "DELETE", "PATCH"):
        st, _, _ = get(f"{base}/history/plays", {"Origin": origin}, method=method)
        check(f"*** append-only: {method} does not exist (501), the file is unchanged ***",
              st == 501 and unchanged(), detail=f"status={st}")
    s, h, _ = get(f"{base}/history/plays", {"Origin": origin, "Access-Control-Request-Method": "POST",
                                            "Access-Control-Request-Headers": "content-type",
                                            "Access-Control-Request-Private-Network": "true"}, method="OPTIONS")
    check("the POST preflight: 204, POST allowed, Content-Type allowed, private network answered, Origin echoed",
          s == 204 and "POST" in (h.get("Access-Control-Allow-Methods") or "")
          and "Content-Type" in (h.get("Access-Control-Allow-Headers") or "")
          and h.get("Access-Control-Allow-Private-Network") == "true" and h.get("Access-Control-Allow-Origin") == origin,
          detail=repr(h))
    s, h, _ = get(f"{base}/list", {"Origin": origin}, method="OPTIONS")
    check("...while /list's preflight still offers no POST", s == 204 and "POST" not in (h.get("Access-Control-Allow-Methods") or ""))
    s, _, _ = get(f"{base}/history/plays", {"Origin": EVIL, "Access-Control-Request-Method": "POST"}, method="OPTIONS")
    check("the preflight from another site: 403", s == 403)
    s, _, _ = post("/list", {"scope": "x", "rows": []})
    check("POST anywhere else: 404", s == 404)
    check("*** nothing was ever written into the media folder ***",
          not any(p.suffix == ".jsonl" for p in data.parent.parent.joinpath("photos").rglob("*")))


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
    check_syntax_38()
    shutil.rmtree(check_history_pure(), ignore_errors=True)

    tmp = Path(tempfile.mkdtemp(prefix="nimrod_media_"))
    root = tmp / "photos"
    root.mkdir()
    data = tmp / "Nimrod" / "Data"     # agent history: beside the media folder, as on a drive
    data.mkdir(parents=True)

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
         "--host", "127.0.0.1", "--port", str(port), "--origin", origin, "--data-dir", str(data)],
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
        history_http_tests(base, origin, data)
        double_start_tests(root, tmp, port, base, origin)

    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
