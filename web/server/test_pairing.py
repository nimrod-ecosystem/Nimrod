#!/usr/bin/env python3
"""Pairing — six characters instead of an IP address.

Drives the shared `_Store` logic through SQLiteStore, which validates it for Postgres too.

WHAT THIS IS ACTUALLY GUARDING. A pairing code is a bearer token with a very small
alphabet, and a guessed one does something worse than it looks: it attaches somebody
ELSE's media agent to the guesser's account, handing them a folder of another person's
photographs. So the tests that matter here are not the happy path — they are single-use,
expiry, and the race between two claimers. Those three are the entire security story on
the store side; the rate limit is app.py's half.

Zero deps. Run:

    python test_pairing.py
"""
from __future__ import annotations

import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db import PAIR_ALPHABET, PAIR_CODE_LEN, SQLiteStore, normalize_code  # noqa: E402

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


def expire(store, code: str, seconds_ago: int = 60):
    """Reach into the row and move its deadline into the past.

    Faking the DEADLINE rather than the clock, because the clock is `datetime.now` inside
    db.py and the alternative is threading an injectable time source through a module that
    has no other use for one. What is being tested is "the server refuses a code whose
    expiry has passed", and this tests exactly that."""
    past = (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()
    with store._tx() as cur:                                   # noqa: SLF001 - test reaching in
        cur.execute(store._q("UPDATE pairings SET expires_at=? WHERE code=?"), (past, code))


def main():
    tmp = Path(tempfile.mkdtemp(prefix="nimrod_pair_"))
    s = SQLiteStore(str(tmp / "pair.db"))

    # ---- the code itself ---------------------------------------------------
    section("the code")
    codes = {s.create_pairing("agent1", "Bedside", ["http://localhost:8770"])["code"]
             for _ in range(200)}
    check("codes are the advertised length",
          all(len(c) == PAIR_CODE_LEN for c in codes))
    check("codes stay inside the alphabet",
          all(set(c) <= set(PAIR_ALPHABET) for c in codes))
    # Not a randomness test — a guard against someone "simplifying" the generator into
    # something sequential or seeded, which would make the whole scheme guessable.
    check("200 codes are 200 different codes", len(codes) == 200, str(len(codes)))

    # THE GLYPHS THAT GET MISREAD ARE NEVER GENERATED. That is the whole reason for a
    # custom alphabet, and it is stronger than "helpfully" mapping O to 0 on the way in —
    # which cannot work here, because neither is in the alphabet to map to.
    for bad in "01OILU":
        check(f"'{bad}' is never in a code", all(bad not in c for c in codes))

    section("what a person typed")
    check("case does not matter", normalize_code("ab23cd") == "AB23CD")
    check("spaces are how people write it down", normalize_code("AB2 3CD") == "AB23CD")
    check("so are dashes", normalize_code("AB2-3CD") == "AB23CD")
    check("both at once", normalize_code("  ab2 - 3cd ") == "AB23CD")
    check("nothing is silently substituted", normalize_code("O0IL") == "O0IL")
    check("empty is empty, not a crash", normalize_code(None) == "")

    # ---- claiming ----------------------------------------------------------
    section("claiming")
    p = s.create_pairing("agent-A", "Christine's bedside", ["http://localhost:8770", "http://10.0.0.5:8770"])
    got = s.get_pairing(p["code"])
    check("a fresh code is unclaimed", got["claimed_by"] is None)
    check("it carries every candidate address, in order",
          got["base_urls"] == ["http://localhost:8770", "http://10.0.0.5:8770"])

    status, claimed = s.claim_pairing(p["code"], "alice")
    check("claiming works", status == "ok", status)
    check("...and hands back the addresses for the CLIENT to probe",
          claimed["base_urls"] == ["http://localhost:8770", "http://10.0.0.5:8770"])
    check("...and the agent id, so the client can tell it apart from any other agent",
          claimed["agent_id"] == "agent-A")
    check("...and the label the device chose for itself",
          claimed["label"] == "Christine's bedside")

    # SINGLE USE. Without this a code left on a screen is a permanent key to that folder.
    status2, _ = s.claim_pairing(p["code"], "bob")
    check("a code cannot be claimed twice", status2 == "claimed", status2)
    check("...and the second claimer did not take it from the first",
          s.get_pairing(p["code"])["claimed_by"] == "alice")

    status3, _ = s.claim_pairing("ZZZZZZ", "alice")
    check("an unknown code is refused", status3 == "unknown", status3)
    # These three are DISTINCT because they send a person somewhere different: retype it,
    # restart the agent, or look for a code that is still good.
    check("...and 'unknown' is not the same answer as 'claimed'", status3 != status2)

    # EXPIRY. A code printed on a kiosk in a day room must stop working on its own.
    q = s.create_pairing("agent-B", "Spare tablet", ["http://localhost:8770"])
    expire(s, q["code"])
    status4, _ = s.claim_pairing(q["code"], "alice")
    check("an expired code is refused", status4 == "expired", status4)
    check("...and stays unclaimed rather than being consumed",
          s.get_pairing(q["code"])["claimed_by"] is None)

    # ---- the sweep ---------------------------------------------------------
    # /api/pair/request is unauthenticated, so anyone can create rows and something has to
    # bound the table.
    section("the sweep")
    junk = [s.create_pairing("j", "junk", ["http://localhost:8770"])["code"] for _ in range(5)]
    for c in junk:
        expire(s, c)
    live = s.create_pairing("live", "live", ["http://localhost:8770"])["code"]
    n = s.sweep_pairings()
    check("expired unclaimed codes are swept", n >= 5, str(n))
    check("...all of them", all(s.get_pairing(c) is None for c in junk))
    check("a live code survives the sweep", s.get_pairing(live) is not None)
    # Kept on purpose: a second attempt should say "already used", which is actionable,
    # rather than "no such code", which sends someone off to reinstall a working agent.
    check("a recently CLAIMED code is kept so it can still say 'already used'",
          s.get_pairing(p["code"]) is not None)

    # ---- negative control --------------------------------------------------
    # Everything above would also pass against a store that ignored the account entirely,
    # so prove a claim actually records WHO.
    section("negative control")
    r = s.create_pairing("agent-C", "Desk", ["http://localhost:8770"])
    s.claim_pairing(r["code"], "carol")
    check("a claim records the account that made it",
          s.get_pairing(r["code"])["claimed_by"] == "carol",
          str(s.get_pairing(r["code"])["claimed_by"]))
    check("...and not somebody else's",
          s.get_pairing(r["code"])["claimed_by"] != "alice")

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
