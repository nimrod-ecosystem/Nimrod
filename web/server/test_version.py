#!/usr/bin/env python3
"""version.py + GET /api/version - the string a screen polls to notice a deploy.

The pure half against a scratch folder (what is hashed, what is not, what changes it), then the route
end to end through FastAPI's TestClient against a throwaway database.

Run:
    py -3.13 test_version.py
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from version import code_files, code_version, deploy_commit, safe_code_version  # noqa: E402

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t: str):
    print(f"\n-- {t}")


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def main() -> None:
    section("what the version is made of")
    tmp = Path(tempfile.mkdtemp(prefix="nimrod_version_"))
    try:
        write(tmp, "kiosk.html", "<p>screen</p>")
        write(tmp, "kiosk.js", "export const a = 1;")
        write(tmp, "modules/photos.js", "export const b = 2;")
        write(tmp, "kiosk.css", "body{}")
        write(tmp, "dev/kiosk_test.html", "<p>a test page</p>")
        write(tmp, ".hidden/x.js", "secret")
        write(tmp, "demo-media/a.jpg", "not code")
        names = [p.relative_to(tmp).as_posix() for p in code_files(tmp)]
        check("code files: html/js/css under the folder, in path order",
              names == ["kiosk.css", "kiosk.html", "kiosk.js", "modules/photos.js"], str(names))
        check("the dev/ test pages are NOT part of it (no screen loads them)", "dev/kiosk_test.html" not in names)
        check("nor a dot-folder, nor media", all(not n.startswith(".") and not n.endswith(".jpg") for n in names))

        v1 = code_version(tmp)
        check("a short hex string", len(v1) == 16 and all(c in "0123456789abcdef" for c in v1), v1)
        check("the same files give the same version", code_version(tmp) == v1)

        write(tmp, "dev/kiosk_test.html", "<p>a changed test page</p>")
        check("*** changing a test page does not change it (no screen reloads for it) ***", code_version(tmp) == v1)
        write(tmp, "demo-media/a.jpg", "a new photo")
        check("nor does new media", code_version(tmp) == v1)

        write(tmp, "modules/photos.js", "export const b = 3;")
        v2 = code_version(tmp)
        check("*** changing served code changes it ***", v2 != v1)
        write(tmp, "modules/photos.js", "export const b = 2;")
        check("and putting it back gives the old version back (content, not time)", code_version(tmp) == v1)

        (tmp / "modules" / "photos.js").rename(tmp / "modules" / "photos2.js")
        check("renaming a file changes it (the path is part of it)", code_version(tmp) != v1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    import version as V
    orig = V.code_version

    def unreadable(_root):
        raise PermissionError("a file that cannot be read")

    V.code_version = unreadable
    try:
        check("files that cannot be read fall back to the start time, never no version",
              safe_code_version(Path("."), clock=lambda: 1234) == "start-1234")
    finally:
        V.code_version = orig

    section("the deploy's commit, reported beside it")
    check("Render's RENDER_GIT_COMMIT, shortened to 12",
          deploy_commit({"RENDER_GIT_COMMIT": "0123456789abcdef0123"}) == "0123456789ab")
    check("no commit when the host does not say", deploy_commit({}) is None and deploy_commit({"RENDER_GIT_COMMIT": " "}) is None)

    section("*** GET /api/version, end to end ***")
    dbdir = tempfile.mkdtemp(prefix="nimrod_version_db_")
    os.environ["NIMROD_DB"] = os.path.join(dbdir, "version_test.db")
    os.environ.pop("DATABASE_URL", None)
    os.environ.pop("NIMROD_ENV", None)
    from fastapi.testclient import TestClient  # noqa: E402
    import app as appmod  # noqa: E402

    c = TestClient(appmod.app)
    r = c.get("/api/version")
    check("200, with no sign-in (a screen that lost its sign-in still needs the fix)", r.status_code == 200, r.text)
    body = r.json()
    check("it says the version: the hash of the client code this server serves",
          body.get("version") == code_version(appmod.CLIENT_DIR), str(body))
    check("and the commit when the host gives one (null here)", "commit" in body and body["commit"] is None, str(body))
    check("Cache-Control no-cache (ask, do not guess)", r.headers.get("cache-control") == "no-cache", str(r.headers))
    etag = r.headers.get("etag")
    check("an ETag that is the version", etag == f'"{body.get("version")}"', str(etag))
    r2 = c.get("/api/version", headers={"If-None-Match": etag})
    check("*** a poll that finds nothing new is a 304 with no body ***", r2.status_code == 304 and not r2.content,
          f"{r2.status_code} {r2.content!r}")
    r3 = c.get("/api/version", headers={"If-None-Match": '"something-older"'})
    check("an older ETag gets the full answer", r3.status_code == 200 and r3.json().get("version") == body["version"])
    r4 = c.get("/api/version", headers={"If-None-Match": f'W/{etag}, "x"'})
    check("a weak or listed ETag still matches", r4.status_code == 304, str(r4.status_code))
    check("it is the same answer every time (computed once, at startup)",
          c.get("/api/version").json()["version"] == body["version"])
    try:
        shutil.rmtree(dbdir, ignore_errors=True)
    except Exception:  # noqa: BLE001 - a locked scratch file is not a failure of the route
        pass

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
