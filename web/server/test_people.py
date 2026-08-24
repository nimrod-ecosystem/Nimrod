#!/usr/bin/env python3
"""The PERSON layer — Account -> Person -> { Screens, Bindings, Output routing }.

Like test_store.py, this drives the shared `_Store` logic through SQLiteStore, which
validates it for Postgres too (the engines differ only in the driver adapter).

THE TEST THAT MATTERS MOST is the LEGACY MIGRATION one at the bottom. The live database
already holds real data that predates people: screens with no person, and per-user state
rows under the reserved scope "_user" carrying somebody's input bindings and output
routing. `ensure_default_person` is the only thing standing between that data and
silently belonging to nobody, and it runs lazily on real traffic — so it is worth an
explicit test against a database built the OLD way, not just the new one.

Zero deps. Run:

    python test_people.py
"""
from __future__ import annotations

import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import LEGACY_PERSON_SCOPE, SQLiteStore, person_scope  # noqa: E402

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


def section(title: str):
    print(f"\n{title}")


def main():
    tmp = Path(tempfile.mkdtemp(prefix="nimrod_people_"))

    # ---- scope -------------------------------------------------------------
    section("scope strings")
    pid = "0123456789abcdef0123456789abcdef"          # a uuid4().hex, like the real thing
    check("a person's scope cannot be mistaken for a profile id",
          person_scope(pid).startswith("_"), person_scope(pid))
    check("a person's scope fits the server's 64-char id pattern",
          len(person_scope(pid)) <= 64, str(len(person_scope(pid))))
    check("two people get two scopes", person_scope("a") != person_scope("b"))

    # ---- people + ownership ------------------------------------------------
    section("people and ownership")
    s = SQLiteStore(str(tmp / "people.db"))
    check("a fresh account has no people", s.list_people("alice") == [])
    a1 = s.ensure_default_person("alice")
    check("ensure_default_person creates one", len(s.list_people("alice")) == 1)
    check("ensure_default_person is idempotent", s.ensure_default_person("alice") == a1)
    check("the default person is named something a human can rename",
          s.get_person("alice", a1)["name"] == "Me")

    chris = s.create_person("alice", "Christine")
    check("a second person is added, not swapped", len(s.list_people("alice")) == 2)
    check("people come back oldest first",
          [p["id"] for p in s.list_people("alice")] == [a1, chris["id"]])

    # The ownership gate. Bob must never see Alice's people, and — the case that would
    # otherwise leak everything under them — must not be able to name one by id.
    s.ensure_default_person("bob")
    check("another account sees only its own people", len(s.list_people("bob")) == 1)
    check("another account cannot fetch a person by id", s.get_person("bob", chris["id"]) is None)

    s.rename_person("alice", chris["id"], "Chris")
    check("rename works", s.get_person("alice", chris["id"])["name"] == "Chris")
    s.rename_person("bob", chris["id"], "Hijacked")
    check("another account cannot rename a person it does not own",
          s.get_person("alice", chris["id"])["name"] == "Chris")

    # ---- screens belong to a person ---------------------------------------
    section("screens belong to a person")
    bedside = s.create_profile("alice", "Bedside", chris["id"])
    desk = s.create_profile("alice", "Desk", a1)
    check("a screen names its person", bedside["person_id"] == chris["id"])
    check("get_profile names the person too",
          s.get_profile("alice", bedside["id"])["person_id"] == chris["id"])
    check("listing filtered by person narrows",
          [p["id"] for p in s.list_profiles("alice", chris["id"])] == [bedside["id"]])
    check("listing with no filter still returns the whole account",
          len(s.list_profiles("alice")) == 2)
    check("every row names its person even unfiltered",
          all(p["person_id"] for p in s.list_profiles("alice")))

    s.move_profile("alice", desk["id"], chris["id"])
    check("a screen can be handed to another person",
          len(s.list_profiles("alice", chris["id"])) == 2)
    check("...and leaves the old person's list", s.list_profiles("alice", a1) == [])
    s.move_profile("bob", desk["id"], "whoever")
    check("another account cannot move a screen it does not own",
          s.get_profile("alice", desk["id"])["person_id"] == chris["id"])

    # ---- per-person state is actually separate ----------------------------
    section("per-person state")
    s.put_state("alice", person_scope(a1), "input-bindings", {"hold": 0}, 0)
    s.put_state("alice", person_scope(chris["id"]), "input-bindings", {"hold": 400}, 0)
    check("two people's bindings do not collide",
          s.get_state("alice", person_scope(a1), "input-bindings")["data"]["hold"] == 0)
    check("...in both directions",
          s.get_state("alice", person_scope(chris["id"]), "input-bindings")["data"]["hold"] == 400)

    # Deleting a person takes their settings and nobody else's.
    s.delete_person("alice", chris["id"])
    check("deleting a person removes them", s.get_person("alice", chris["id"]) is None)
    check("...and their per-person settings",
          s.get_state("alice", person_scope(chris["id"]), "input-bindings")["data"] == {})
    check("...and leaves the other person's alone",
          s.get_state("alice", person_scope(a1), "input-bindings")["data"] == {"hold": 0})

    # ---- THE LEGACY MIGRATION ---------------------------------------------
    # Build a database the way it existed BEFORE people, with real data in it, then open
    # it with the current code and check that a person adopts all of it.
    section("legacy account, built with the pre-people schema")
    legacy = tmp / "legacy.db"
    con = sqlite3.connect(str(legacy))
    con.executescript(
        """
        CREATE TABLE profiles (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE state (
            user_id TEXT NOT NULL, profile_id TEXT NOT NULL, key TEXT NOT NULL,
            data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, profile_id, key)
        );
        INSERT INTO profiles VALUES ('oldpid', 'mike', 'Bedside', '2026-01-01');
        INSERT INTO state VALUES ('mike', '_user', 'input-bindings',
                                  '{"bindings": ["a switch"]}', 3, '2026-01-01');
        INSERT INTO state VALUES ('mike', 'oldpid', 'settings', '{"theme": "night"}', 1, '2026-01-01');
        """
    )
    con.commit()
    con.close()

    s2 = SQLiteStore(str(legacy))
    check("the old database still opens (the column was added, not recreated)",
          len(s2.list_profiles("mike")) == 1)
    check("the old screen starts with no person", s2.list_profiles("mike")[0]["person_id"] == "")
    check("legacy per-user state is readable at the old scope",
          s2.get_state("mike", LEGACY_PERSON_SCOPE, "input-bindings")["data"]["bindings"] == ["a switch"])

    mike = s2.ensure_default_person("mike")
    check("the orphaned screen is adopted",
          s2.list_profiles("mike")[0]["person_id"] == mike)
    check("legacy bindings move to the new person, contents intact",
          s2.get_state("mike", person_scope(mike), "input-bindings")["data"]["bindings"] == ["a switch"])
    check("...keeping their version, so an open editor's next save is not a false conflict",
          s2.get_state("mike", person_scope(mike), "input-bindings")["version"] == 3)
    check("nothing is left at the old scope",
          s2.get_state("mike", LEGACY_PERSON_SCOPE, "input-bindings")["data"] == {})
    check("per-SCREEN state is untouched by the migration",
          s2.get_state("mike", "oldpid", "settings")["data"]["theme"] == "night")

    # Running it twice must not create a second person or re-adopt anything.
    check("adoption is idempotent", s2.ensure_default_person("mike") == mike)
    check("...and does not multiply people", len(s2.list_people("mike")) == 1)

    # A NEGATIVE CONTROL. The suite above passes on a store that simply ignores the
    # person argument everywhere, so prove the separation is real: a person who was never
    # given anything must see nothing, not a shared blob.
    section("negative control")
    stranger = s2.create_person("mike", "Nobody")
    check("a brand-new person inherits no bindings",
          s2.get_state("mike", person_scope(stranger["id"]), "input-bindings")["data"] == {})
    check("...and no screens", s2.list_profiles("mike", stranger["id"]) == [])

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
