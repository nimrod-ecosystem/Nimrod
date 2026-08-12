#!/usr/bin/env python3
"""Store-layer test for the per-user media_sources registry — zero dependencies.

Exercises db.SQLiteStore directly (no HTTP, no FastAPI needed), focusing on the
two things that matter: correct CRUD and per-user OWNERSHIP isolation. The HTTP
validation (base_url scheme, kind allowlist) is covered by the browser integration
test against the running server. Run:

    python test_media_sources.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import SQLiteStore  # noqa: E402

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


def main():
    tmp = Path(tempfile.mkdtemp(prefix="nimrod_ms_"))
    store = SQLiteStore(str(tmp / "test.db"))

    # empty to start
    check("new user has no sources", store.list_sources("alice") == [])

    # create
    s1 = store.create_source("alice", "Home photos", "http://localhost:8770", "agent")
    check("create returns id + fields",
          bool(s1["id"]) and s1["label"] == "Home photos" and s1["kind"] == "agent")
    s2 = store.create_source("alice", "NAS", "http://192.168.1.9:8770", "agent")

    # list (ordered by creation)
    lst = store.list_sources("alice")
    check("list returns both, in creation order",
          [s["label"] for s in lst] == ["Home photos", "NAS"], detail=repr([s["label"] for s in lst]))

    # get + ownership
    check("owner can get its source", store.get_source("alice", s1["id"])["base_url"] == "http://localhost:8770")
    check("non-owner cannot get another's source", store.get_source("bob", s1["id"]) is None)
    check("bob's registry is independent + empty", store.list_sources("bob") == [])

    # ownership on delete: bob cannot delete alice's source
    check("non-owner delete is a no-op", store.remove_source("bob", s1["id"]) is False)
    check("...and the source still exists", store.get_source("alice", s1["id"]) is not None)

    # owner delete
    check("owner delete succeeds", store.remove_source("alice", s1["id"]) is True)
    check("deleted source is gone", store.get_source("alice", s1["id"]) is None)
    check("other source untouched", [s["label"] for s in store.list_sources("alice")] == ["NAS"])
    check("deleting a missing id returns False", store.remove_source("alice", "nope") is False)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
