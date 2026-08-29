"""Who produced this row, and who was in the room.

    python test_provenance.py

The rules are pure and live in provenance.py. This is the file that decides whether, in two
years, somebody filtering for human trials gets an honest answer or a clean-looking one.

Design: docs/from_chat/for_code.md sections 9f and 9g (private repo).
"""
import sys

import db
import provenance
from provenance import (
    CORE_FIELDS, CUE_LEVELS, END_REASONS, MAX_PLAYERS, NON_ANSWERS, PRINCIPAL_TYPES,
    PROVENANCE_FIELDS, ROSTER_ROLES, SchemaCollision,
    auto_close, cue_rank, merge_extra, normalize_cue, normalize_principal_type,
    normalize_role, roster_problem,
)

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t):
    print(f"\n-- {t}")


def raises(exc, fn, *a, **kw):
    try:
        fn(*a, **kw)
    except exc:
        return True
    except Exception:
        return False
    return False


MIN = 60_000

# ---------------------------------------------------------------------------------------
section("the five columns exist, and that is the whole point")
# ---------------------------------------------------------------------------------------
check("the minimum set is the one section 9f specified",
      PROVENANCE_FIELDS == ("principal_id", "principal_type", "attested_by", "attested_at",
                            "producer_version"), PROVENANCE_FIELDS)
check("three principal types", PRINCIPAL_TYPES == ("human", "local_model", "cloud_service"))

check("a known type normalises", normalize_principal_type("Human") == "human")
check("*** AN UNRECOGNISED TYPE BECOMES NULL, NOT A DEFAULT. This column is a claim about who "
      "made the data, and a typo silently written as 'human' is a falsehood in a log that has "
      "no update ***", normalize_principal_type("robot") is None)
check("and None stays None - 'not captured' is an honest answer",
      normalize_principal_type(None) is None)

# ---------------------------------------------------------------------------------------
section("the four non-answers - collapsing any two corrupts every denominator")
# ---------------------------------------------------------------------------------------
check("all four are distinct",
      set(NON_ANSWERS) == {"", "prefer_not_to_say", "other", "unknown"}, sorted(NON_ANSWERS))
check("blank is 'nobody got to it', which is not the same as declining",
      NON_ANSWERS[""] != NON_ANSWERS["prefer_not_to_say"])
check("*** 'unknown' is NOT 'none' - asked and genuinely does not know is a real answer ***",
      "unknown" in NON_ANSWERS and "none" not in NON_ANSWERS)

# ---------------------------------------------------------------------------------------
section("the roster")
# ---------------------------------------------------------------------------------------
check("*** 'player' is a role, not just 'subject' - most people in a game are not subjects ***",
      "player" in ROSTER_ROLES and "subject" in ROSTER_ROLES, ROSTER_ROLES)
check("and the clinical roles are separate from family, which is what makes the CRS-R "
      "weighting question answerable at all",
      "clinician" in ROSTER_ROLES and "family" in ROSTER_ROLES)
check("an unknown role does not normalise", normalize_role("wizard") is None)
check("eight players", MAX_PLAYERS == 8)

check("an EMPTY roster is fine - 'nobody said who was there' is honest, and refusing to start "
      "a session over paperwork would stop a therapy session",
      roster_problem([]) is None and roster_problem(None) is None)
check("a roster entry with no principal is refused",
      roster_problem([{"role": "player"}]) is not None)
check("an unknown role is refused",
      roster_problem([{"principal_id": "a", "role": "wizard"}]) is not None)
check("the same principal twice is refused",
      roster_problem([{"principal_id": "a", "role": "player"},
                      {"principal_id": "a", "role": "moderator"}]) is not None)
check("nine players is refused - a roster of 200 is a runaway loop, not a therapy session",
      roster_problem([{"principal_id": f"p{i}", "role": "player"} for i in range(9)]) is not None)
check("...but nine people are fine when only eight are playing",
      roster_problem([{"principal_id": f"p{i}", "role": "player"} for i in range(8)]
                     + [{"principal_id": "obs", "role": "observer"}]) is None)

# ---------------------------------------------------------------------------------------
section("cue level - the distance between unaided and cued IS the progress measure")
# ---------------------------------------------------------------------------------------
check("cue levels run least to most help", CUE_LEVELS[0] == "none")
check("'unknown' is accepted and kept distinct from 'none'",
      normalize_cue("unknown") == "unknown" and normalize_cue("none") == "none")
check("*** an unknown cue level has NO rank, so it can never sort as 'no help given' ***",
      cue_rank("unknown") is None and cue_rank("none") == 0)
check("more help ranks higher", cue_rank("physical_full") > cue_rank("verbal_general"))

# ---------------------------------------------------------------------------------------
section("*** THE SCHEMA IS A FLOOR, NOT A CEILING - and extensions may not shadow it ***")
# ---------------------------------------------------------------------------------------
check("a game's own fields ride along",
      merge_extra({"kind": "trial"}, {"target_x": 0.3, "assist": 0.9})["extra"]["assist"] == 0.9)
check("no extra is fine", "extra" not in merge_extra({"kind": "trial"}, None))
check("*** an extension that redefines a core field RAISES - the day a module writes its own "
      "principal_type is the day the column stops meaning one thing ***",
      raises(SchemaCollision, merge_extra, {"kind": "trial"}, {"principal_type": "human"}))
check("it raises rather than dropping the key, because a study that thinks it recorded "
      "something and did not is worse off than one that failed at write time",
      raises(SchemaCollision, merge_extra, {}, {"session_id": "x"}))
check("every provenance field is protected", all(f in CORE_FIELDS for f in PROVENANCE_FIELDS))

# ---------------------------------------------------------------------------------------
section("*** SESSIONS END THEMSELVES - and elapsed time must NEVER be what ends one ***")
# ---------------------------------------------------------------------------------------
START = 0
check("a fresh, active session stays open",
      auto_close(started_at_ms=START, last_event_ms=5 * MIN, now_ms=6 * MIN) is None)
check("*** a session PAST its expected length but still being used stays OPEN. A therapy "
      "session that is going well is exactly the one you must not cut at minute 31 ***",
      auto_close(started_at_ms=START, last_event_ms=35 * MIN, now_ms=36 * MIN) is None)

idle = auto_close(started_at_ms=START, last_event_ms=20 * MIN, now_ms=36 * MIN)
check("sixteen minutes of silence closes it", idle and idle["reason"] == "ended_by_inactivity")
check("*** and it is BACKDATED to the last event, not the timer moment - otherwise every "
      "inactivity-closed session carries fifteen minutes of phantom duration ***",
      idle["ended_at_ms"] == 20 * MIN, idle)
check("the timer moment is kept separately, because the gap is itself informative",
      idle["detected_at_ms"] == 36 * MIN)

cap = auto_close(started_at_ms=START, last_event_ms=60 * MIN, now_ms=61 * MIN)
check("a session still active past expected+overshoot hits the cap",
      cap and cap["reason"] == "ended_by_cap", cap)
check("and ran_over_by is recorded - a population that routinely runs over is telling you the "
      "default is wrong", cap["ran_over_by_ms"] > 0)
check("three end reasons, not two - the capped one has the least trustworthy roster and "
      "anything reading it should know",
      END_REASONS == ("ended_by_person", "ended_by_inactivity", "ended_by_cap"))
check("the overshoot floor protects a SHORT expected length: a 10-minute session gets 15 "
      "minutes of grace, not 5",
      auto_close(started_at_ms=START, last_event_ms=20 * MIN, now_ms=20 * MIN,
                 expected_min=10) is None)

# =======================================================================================
section("STORAGE - the columns exist on a real database")
# =======================================================================================
store = db.SQLiteStore(":memory:")

ev = store.append_event("u", "p", "s", "trial", {"hit": True})
check("*** EVERY EXISTING CALLER STILL WORKS AND WRITES NULLS - which is exactly the intended "
      "outcome: the founding period is visibly unattributed rather than silently assumed "
      "human ***", ev["principal_id"] is None and ev["principal_type"] is None, ev)

ev2 = store.append_event("u", "p", "s", "trial", {"hit": True},
                         principal_id="mike", principal_type="human",
                         attested_by="dr-ruiz", attested_at="2026-08-28T10:00:00+00:00",
                         producer_version="pressgame@2.1", session_id="S1")
check("and provenance is stored when it is supplied", ev2["principal_type"] == "human", ev2)
check("*** attested_by is a PRINCIPAL, not a boolean - which is what makes 'a clinician "
      "attested this' and 'her brother observed it' different values in one field ***",
      ev2["attested_by"] == "dr-ruiz")
check("attested_at is WHEN, because attesting from memory months later is recollection",
      ev2["attested_at"].startswith("2026-08-28"))
check("a garbage principal_type is nulled on the way in rather than stored",
      store.append_event("u", "p", "s", "t", {}, principal_type="wizard")["principal_type"] is None)

rows = store.list_events("u", "p", "s")["events"] if isinstance(
    store.list_events("u", "p", "s"), dict) else store.list_events("u", "p", "s")
check("reading events back does not crash on the widened row", rows is not None)

section("sessions and the roster, stored")
sess = store.start_session("u", "p", roster=[
    {"principal_id": "christine", "role": "subject"},
    {"principal_id": "mike", "role": "moderator"},
    {"principal_id": "dr-ruiz", "role": "clinician"},
], label="Tuesday PT")
check("a session starts with its roster", sess["id"] and sess["expected_min"] == 30, sess)
check("the roster reads back with roles intact",
      {r["role"] for r in store.session_roster(sess["id"])} == {"subject", "moderator", "clinician"})

check("an empty roster is allowed", store.start_session("u", "p")["id"] is not None)
check("a bad roster is refused at the door",
      raises(ValueError, store.start_session, "u", "p",
             [{"principal_id": "a", "role": "wizard"}]))

store.amend_roster(sess["id"], "aide-jo", role="aide")
check("*** somebody arriving mid-session is added, not merged - 'who was in the room WHEN THIS "
      "TRIAL HAPPENED' has to stay answerable months later ***",
      len(store.session_roster(sess["id"])) == 4)
store.amend_roster(sess["id"], "dr-ruiz", leaving=True)
left = [r for r in store.session_roster(sess["id"]) if r["principal_id"] == "dr-ruiz"][0]
check("and leaving is timestamped rather than deleting the row", left["left_at"] is not None)
check("the row is still there, so a trial from earlier still has its clinician",
      left["role"] == "clinician")

check("ending it records the reason",
      store.end_session(sess["id"], "ended_by_person") is True
      and store.get_session(sess["id"])["end_reason"] == "ended_by_person")
check("ending an already-ended session is a no-op rather than an overwrite",
      store.end_session(sess["id"], "ended_by_cap") is False)
check("an unknown end reason is refused",
      raises(ValueError, store.end_session, sess["id"], "gave_up"))

s2 = store.start_session("u", "p")
store.end_session(s2["id"], "ended_by_inactivity", ended_at="2026-08-28T10:00:00+00:00",
                  detected_at="2026-08-28T10:15:00+00:00", ran_over_ms=0)
got = store.get_session(s2["id"])
check("*** the backdated end and the detection moment are stored SEPARATELY ***",
      got["ended_at"] != got["detected_at"], got)

section("the privacy page knows about the new tables")
d = store.describe_storage()
names = {r["table"] for r in d["stores"]}
check("sessions and session_roster exist", {"sessions", "session_roster"} <= names)
check("*** and nothing is undescribed - adding a table without explaining it publishes its own "
      "omission on the public page ***", d["undocumented"] == [], d["undocumented"])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
