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

    # -------------------------------------------------------------------------------
    # PER-PERSON SOURCES. NULL person_id means "the account's", never "orphaned" - which
    # is what let this column be added without rewriting a single existing row.
    # -------------------------------------------------------------------------------
    store2 = SQLiteStore(str(Path(tmp) / "people.db"))
    chris = store2.create_person("acct", "Robin")
    other = store2.create_person("acct", "Ray")

    shared = store2.create_source("acct", "Family", "http://localhost:8770", "agent")
    hers = store2.create_source("acct", "Her albums", "http://localhost:8771", "agent",
                                person_id=chris["id"])
    his = store2.create_source("acct", "His albums", "http://localhost:8772", "agent",
                               person_id=other["id"])

    check("a source with no person is the ACCOUNT'S, not orphaned", shared["person_id"] is None)
    check("an empty string is the same as none - not a person called empty",
          store2.create_source("acct", "Blank", "http://localhost:8773", "agent",
                               person_id="")["person_id"] is None)
    check("a source with a person carries it back", hers["person_id"] == chris["id"])

    mine = [x["label"] for x in store2.list_sources("acct", person_id=chris["id"])]
    check("HER SCREEN SEES HER OWN SOURCES", "Her albums" in mine, mine)
    check("...AND THE ACCOUNT-WIDE ONES - that union is the whole point, family photos "
          "plus her own", "Family" in mine, mine)
    check("...AND NOT ANOTHER RESIDENT'S. A person's screen is also their private life, and "
          '"everyone in the account sees everything" stops being acceptable the moment an '
          "account holds people who did not choose each other",
          "His albums" not in mine, mine)

    everything = [x["label"] for x in store2.list_sources("acct")]
    check("with no person named, the account sees everything it owns - the management view",
          set(everything) == {"Family", "Her albums", "His albums", "Blank"}, everything)
    check("shared_only narrows to the account-wide ones",
          {x["label"] for x in store2.list_sources("acct", shared_only=True)} == {"Family", "Blank"})

    # A different ACCOUNT still sees nothing, person or no person. The person layer narrows
    # WITHIN an account; it must never widen ACROSS one.
    check("another account sees none of it, whichever person it asks about",
          store2.list_sources("stranger", person_id=chris["id"]) == [])

    # MOVING, IN BOTH DIRECTIONS. Narrowing is the privacy fix; widening is the commoner
    # mistake - a family folder set up on one screen that everybody then wants.
    check("a source can be narrowed to one person",
          store2.set_source_person("acct", shared["id"], chris["id"]) is True)
    check("...and it leaves the other person's view",
          "Family" not in [x["label"] for x in store2.list_sources("acct", person_id=other["id"])])
    check("A NARROWING CAN BE UNDONE - it is not a one-way door",
          store2.set_source_person("acct", shared["id"], None) is True)
    check("...and it comes back for everybody",
          "Family" in [x["label"] for x in store2.list_sources("acct", person_id=other["id"])])
    check("another account cannot move a source it does not own",
          store2.set_source_person("stranger", hers["id"], None) is False)
    check("...and it did not move", store2.get_source("acct", hers["id"])["person_id"] == chris["id"])
    check("moving a source that does not exist is False, not a crash",
          store2.set_source_person("acct", "nope", None) is False)

    check("get_source carries the person too", store2.get_source("acct", hers["id"])["person_id"]
          == chris["id"])

    # THE MIGRATION, against a database written before the column existed.
    legacy = Path(tmp) / "legacy.db"
    import sqlite3
    con = sqlite3.connect(str(legacy))
    con.executescript(
        "CREATE TABLE media_sources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
        "label TEXT NOT NULL, base_url TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);"
        "INSERT INTO media_sources VALUES ('old1','acct','Old','http://x','agent','2020-01-01');")
    con.commit()
    con.close()
    migrated = SQLiteStore(str(legacy))
    rows = migrated.list_sources("acct")
    check("A ROW WRITTEN BEFORE THE COLUMN EXISTED SURVIVES THE MIGRATION",
          len(rows) == 1 and rows[0]["label"] == "Old", rows)
    check("...and it reads as the ACCOUNT'S, which is exactly what it already was",
          rows[0]["person_id"] is None)
    check("...so it is still visible on a person's screen - nothing was taken away from a "
          "screen that was showing it",
          len(migrated.list_sources("acct", person_id="anyone")) == 1)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
