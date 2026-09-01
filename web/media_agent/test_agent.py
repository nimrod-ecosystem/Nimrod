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


def get(url: str):
    """Return (status, headers, body_bytes). Never raises on HTTP error codes."""
    try:
        r = urllib.request.urlopen(url, timeout=5)
        return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def get_json(url: str):
    status, headers, body = get(url)
    return status, headers, json.loads(body.decode("utf-8"))


def main():
    tmp = Path(tempfile.mkdtemp(prefix="nimrod_media_"))
    root = tmp / "photos"
    root.mkdir()

    # A representative tree: mixed-case extensions, a video, a subfolder album, a
    # non-media file, a dotfile, and a "secret" OUTSIDE the root for the traversal probe.
    (root / "apple.jpg").write_bytes(b"\xff\xd8\xff\xe0JPEGDATA")           # image
    (root / "Banana.JPG").write_bytes(b"\xff\xd8\xff\xe0UPPERCASE")         # image, upper ext
    (root / "clip.MP4").write_bytes(b"\x00\x00\x00\x18ftypmp42")            # video, upper ext
    (root / "notes.txt").write_bytes(b"not media")                         # excluded
    (root / ".hidden.jpg").write_bytes(b"hidden")                          # excluded (dotfile)
    album = root / "trip"
    album.mkdir()
    (album / "cliff.png").write_bytes(b"\x89PNG\r\n\x1a\nPNGDATA")         # image in album
    (tmp / "secret.txt").write_bytes(b"TOP SECRET should never be served") # outside root

    port = free_port()
    origin = "http://localhost:8000"
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
        s, h, j = get_json(f"{base}/health")
        check("/health ok + reports root", s == 200 and j.get("ok") and "photos" in j.get("root", ""))
        check("/health carries CORS origin", h.get("Access-Control-Allow-Origin") == origin,
              detail=repr(h.get("Access-Control-Allow-Origin")))

        # /list (root)
        s, h, j = get_json(f"{base}/list")
        names = sorted(i["name"] for i in j.get("items", []))
        check("/list returns exactly the 3 media files (case-insensitive)",
              names == ["Banana.JPG", "apple.jpg", "clip.MP4"], detail=repr(names))
        check("/list excludes non-media and dotfiles", "notes.txt" not in names and ".hidden.jpg" not in names)
        kinds = {i["name"]: i["kind"] for i in j["items"]}
        check("kinds classified (image/video)",
              kinds.get("apple.jpg") == "image" and kinds.get("clip.MP4") == "video", detail=repr(kinds))
        check("/list surfaces the subfolder as an album", "trip" in j.get("albums", []), detail=repr(j.get("albums")))
        check("items carry relative path as id", all(i["id"] == i["path"] for i in j["items"]))

        # CORS preflight
        req = urllib.request.Request(f"{base}/list", method="OPTIONS")
        r = urllib.request.urlopen(req, timeout=5)
        check("OPTIONS preflight returns CORS + 204",
              r.status == 204 and "GET" in (r.headers.get("Access-Control-Allow-Methods") or ""))

        # /list?album=trip
        s, h, j = get_json(f"{base}/list?album=trip")
        anames = sorted(i["name"] for i in j.get("items", []))
        check("/list?album=trip lists the album's media", anames == ["cliff.png"], detail=repr(anames))
        check("album item path is nested", j["items"] and j["items"][0]["path"] == "trip/cliff.png")

        # /files/<rel> serves the real bytes with CORS
        s, h, body = get(f"{base}/files/apple.jpg")
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
