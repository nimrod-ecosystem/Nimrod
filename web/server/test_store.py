#!/usr/bin/env python3
"""Store-layer test — the SHARED `_Store` logic, exercised via SQLiteStore.

Because the business rules (optimistic concurrency, append-only enforcement, per-user
ownership, module removal keeping events) live in `_Store` and run IDENTICALLY on
Postgres, validating them here validates them for both engines. The Postgres driver
adapter's own live smoke is the deploy step (docs/deploy.md Part B). Zero deps. Run:

    python test_store.py
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
    tmp = Path(tempfile.mkdtemp(prefix="nimrod_store_"))
    s = SQLiteStore(str(tmp / "test.db"))

    # ---- profiles + ownership ----------------------------------------------
    check("new user has no profiles", s.list_profiles("alice") == [])
    p = s.create_profile("alice", "Bedside")
    check("create_profile returns an id + name", bool(p["id"]) and p["name"] == "Bedside")
    p2 = s.create_profile("alice", "Room")
    check("list_profiles returns both, in create order", [x["name"] for x in s.list_profiles("alice")] == ["Bedside", "Room"])
    check("profiles are per-user isolated", s.list_profiles("bob") == [])
    check("get_profile enforces ownership (bob can't read alice's)", s.get_profile("bob", p["id"]) is None)
    check("get_profile of a missing id is None", s.get_profile("alice", "nope") is None)

    # ---- modules ------------------------------------------------------------
    m0 = s.add_module(p["id"], "photos")
    m1 = s.add_module(p["id"], "camera")
    m2 = s.add_module(p["id"], "clock")
    check("modules get increasing positions", (m0["position"], m1["position"], m2["position"]) == (0, 1, 2))
    prof = s.get_profile("alice", p["id"])
    check("get_profile lists modules in position order",
          [m["type"] for m in prof["modules"]] == ["photos", "camera", "clock"])

    # ---- overwrite state: optimistic concurrency ----------------------------
    check("missing state -> empty + version 0", s.get_state("alice", p["id"], m0["id"]) == {"data": {}, "version": 0})
    st, res = s.put_state("alice", p["id"], m0["id"], {"n": 1}, 0)
    check("first put succeeds -> version 1", st == "ok" and res["version"] == 1)
    got = s.get_state("alice", p["id"], m0["id"])
    check("get_state returns the data + new version", got["data"] == {"n": 1} and got["version"] == 1)
    st, res = s.put_state("alice", p["id"], m0["id"], {"n": 2}, 0)   # stale base_version
    check("a stale write is rejected as a conflict", st == "conflict" and res["version"] == 1)
    check("conflict hands back the current server data", res["data"] == {"n": 1})
    st, res = s.put_state("alice", p["id"], m0["id"], {"n": 2}, 1)   # correct base_version
    check("a write with the current version succeeds -> version 2", st == "ok" and res["version"] == 2)
    check("state is per-user isolated", s.get_state("bob", p["id"], m0["id"]) == {"data": {}, "version": 0})

    # ---- append-only events -------------------------------------------------
    e1 = s.append_event("alice", p["id"], m0["id"], "play", {"id": "v1"})
    e2 = s.append_event("alice", p["id"], m0["id"], "play", {"id": "v2"})
    check("append_event returns an id + data", bool(e1["id"]) and e2["id"] != e1["id"])
    lst = s.list_events("alice", p["id"], m0["id"])
    check("list_events is chronological (oldest first)", [e["data"]["id"] for e in lst["events"]] == ["v1", "v2"])
    check("list_events reports the total", lst["total"] == 2)

    # the triggers make UPDATE/DELETE impossible — teeth, not convention
    def blocked(sql):
        try:
            s._conn.execute(sql)
            s._conn.commit()
            return False
        except Exception as ex:
            s._conn.rollback()
            return "append-only" in str(ex)
    check("UPDATE on events is blocked by the trigger", blocked("UPDATE events SET kind='x'"))
    check("DELETE on events is blocked by the trigger", blocked("DELETE FROM events"))

    # ---- module removal drops config but KEEPS events -----------------------
    s.remove_module("alice", p["id"], m0["id"])
    check("remove_module drops the module from the profile",
          "photos" not in [m["type"] for m in s.get_profile("alice", p["id"])["modules"]])
    check("remove_module drops its overwrite state", s.get_state("alice", p["id"], m0["id"]) == {"data": {}, "version": 0})
    check("remove_module KEEPS its append-only events (progress/clinical outlive it)",
          s.list_events("alice", p["id"], m0["id"])["total"] == 2)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
