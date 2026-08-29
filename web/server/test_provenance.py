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
    auto_close, cue_rank, is_solo, merge_extra, normalize_cue, normalize_principal_type,
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

section("*** SOLO IS AN ASSERTION, NOT AN INFERENCE FROM A SHORT LIST ***")
# Mike inverted this one: unassisted solo play is the MAIN use case and the CLEANEST data the
# system produces, because you know for sure nobody assisted them. It deletes the biggest
# confound - the person in the room - at the source instead of modelling it.
SOLO = [{"principal_id": "her", "role": "player"}]
check("*** one player and NOBODY SAID whether that is everybody is NOT solo - it is one "
      "person we happen to know about ***", is_solo(SOLO) is False)
check("confirmed complete makes it solo", is_solo(SOLO, roster_complete=True) is True)
check("explicitly INCOMPLETE is not solo, and is different from nobody saying",
      is_solo(SOLO, roster_complete=False) is False)
check("*** a module that DECLARES one player is structurally solo - it could never have had a "
      "second, so nobody has to attest it ***", is_solo(SOLO, max_players=1) is True)
check("a moderator in the room is never solo, however complete the roster",
      is_solo(SOLO + [{"principal_id": "mike", "role": "moderator"}],
              roster_complete=True, max_players=1) is False)
check("a clinician counts as help too",
      is_solo(SOLO + [{"principal_id": "dr", "role": "clinician"}], roster_complete=True) is False)
check("an OBSERVER does not - watching is not assisting",
      is_solo(SOLO + [{"principal_id": "gran", "role": "observer"}],
              roster_complete=True) is True)
check("two players is not solo", is_solo(
    [{"principal_id": "a", "role": "player"}, {"principal_id": "b", "role": "player"}],
    roster_complete=True) is False)
check("an empty roster is not solo - absent is not the same as alone", is_solo([], roster_complete=True) is False)

sess3 = store.start_session("u", "p", roster=SOLO, max_players=1)
check("a single-player module's session reads solo straight out of storage",
      store.session_is_solo(sess3["id"]) is True)
sess4 = store.start_session("u", "p", roster=SOLO, max_players=4)
check("a four-player module's session with nobody attesting is NOT solo",
      store.session_is_solo(sess4["id"]) is False)
check("...until somebody says the roster is everybody",
      store.set_roster_complete(sess4["id"], True) and store.session_is_solo(sess4["id"]) is True)
check("*** and it is CORRECTABLE, because this is a sessions field rather than an append-only "
      "one - somebody remembering the aide was there for ten minutes can say so ***",
      store.set_roster_complete(sess4["id"], False) and store.session_is_solo(sess4["id"]) is False)
check("the three states survive storage",
      store.set_roster_complete(sess4["id"], None)
      and store.get_session(sess4["id"])["roster_complete"] is None)
check("max_players is stored, so a reader knows what shape the roster COULD have been",
      store.get_session(sess3["id"])["max_players"] == 1)

section("the privacy page knows about the new tables")
d = store.describe_storage()
names = {r["table"] for r in d["stores"]}
check("sessions and session_roster exist", {"sessions", "session_roster"} <= names)
check("*** and nothing is undescribed - adding a table without explaining it publishes its own "
      "omission on the public page ***", d["undocumented"] == [], d["undocumented"])

section("*** the columns are REACHABLE over HTTP - they shipped without a way to fill them ***")
# db.append_event took these from the migration onward and NOBODY PASSED ONE, so every event
# written through the API was unattributed by construction rather than by honesty. That is not
# what an empty column was supposed to mean.
import app  # noqa: E402

check("a producer version is a closed shape, not free text",
      bool(app.PRODUCER_RE.match("pressgame@2.4")) and not app.PRODUCER_RE.match("whatever I like"))
check("...and it must name a version, not just a module",
      not app.PRODUCER_RE.match("pressgame"))

store.append_event("u", "p", "clinical", "trial", {"hit": True},
                   session_id="sess-abc", producer_version="pressgame@2.4")
row = store.list_events("u", "p", "clinical")["events"][-1]
check("a trial can be written WITH the sitting it belongs to and the build that made it",
      row.get("session_id") == "sess-abc" and row.get("producer_version") == "pressgame@2.4",
      str({k: row.get(k) for k in ("session_id", "producer_version")}))

store.append_event("u", "p", "clinical", "trial", {"hit": False})
plain = store.list_events("u", "p", "clinical")["events"][-1]
check("*** and omitting them still writes NULL rather than a guess - every existing caller is "
      "unchanged and its rows stay visibly unattributed ***",
      plain.get("session_id") is None and plain.get("producer_version") is None)

# The four that are NOT reachable, and it is deliberate: they are claims about PEOPLE.
check("attestation is NOT postable - 'a clinician attested this' cannot be self-declared",
      not any(f in app.EventPost.model_fields
              for f in ("principal_id", "principal_type", "attested_by", "attested_at")),
      str(list(app.EventPost.model_fields)))

section("*** ATTESTATION - somebody looked and vouched, as their own append-only row ***")

# The trial being vouched for.
trial = store.append_event("u", "p", "clinical", "trial", {"hit": True},
                           session_id="sess-att", producer_version="pressgame@1.0")
check("the trial starts unattested, and that is honest rather than a gap",
      trial.get("attested_by") is None)

att = store.attest_event("u", "p", "clinical", trial["id"], attester="dr-smith",
                         note="reviewed on the ward round")
check("attesting appends a NEW row rather than touching the trial",
      att["id"] != trial["id"] and att["kind"] == "attestation")
check("*** and the attester is stamped from the caller, never from a body ***",
      att["attested_by"] == "dr-smith" and att["principal_id"] == "dr-smith")
check("the attestation is a human claim, typed as one", att["principal_type"] == "human")
check("attested_at is when the ROW was written - when somebody actually looked",
      bool(att["attested_at"]) and att["attested_at"] >= trial["created_at"])
check("it cites the row it vouches for", att["data"]["attests"] == trial["id"])
check("it inherits the sitting, so an attestation is findable with its trial",
      att["session_id"] == "sess-att")

after = store.list_events("u", "p", "clinical")["events"]
target = [e for e in after if e["id"] == trial["id"]][0]
check("*** THE TRIAL ROW IS UNCHANGED - append-only survived being vouched for ***",
      target["attested_by"] is None and target["data"] == {"hit": True})
check("who vouched is derived by reading, not by a flag on the trial",
      provenance.attesters_of(after, trial["id"]) == ["dr-smith"])

# Two people, and the same person twice.
store.attest_event("u", "p", "clinical", trial["id"], attester="brother-tom")
after = store.list_events("u", "p", "clinical")["events"]
check("*** two people can vouch, and WHO is a list rather than a boolean - 'a clinician "
      "attested this' and 'her brother did' are the whole point ***",
      provenance.attesters_of(after, trial["id"]) == ["dr-smith", "brother-tom"],
      str(provenance.attesters_of(after, trial["id"])))
store.attest_event("u", "p", "clinical", trial["id"], attester="dr-smith")
after = store.list_events("u", "p", "clinical")["events"]
check("a second look months later is its own row, not deduplicated away",
      len(provenance.attestations_for(after, trial["id"])) == 3)
check("...while WHO stays distinct", provenance.attesters_of(after, trial["id"]) == ["dr-smith", "brother-tom"])

# What it refuses.
def raises(fn):
    try:
        fn()
        return False
    except ValueError:
        return True

check("attesting a row that is not there is refused",
      raises(lambda: store.attest_event("u", "p", "clinical", 99999, attester="dr-smith")))
check("*** an attestation cannot be attested - vouching for a vouching is not a claim about "
      "the observation ***",
      raises(lambda: store.attest_event("u", "p", "clinical", att["id"], attester="dr-smith")))
check("attesting needs somebody making it",
      raises(lambda: store.attest_event("u", "p", "clinical", trial["id"], attester="")))
check("*** and another account cannot vouch for a row it cannot even read ***",
      raises(lambda: store.attest_event("someone-else", "p", "clinical", trial["id"],
                                        attester="someone-else")))

# Presence is not attestation - the roster answers the other question, and separately.
sess_att = store.start_session("u", "p", roster=[
    {"principal_id": "christine", "role": "subject"},
    {"principal_id": "dr-smith", "role": "clinician"},
])
check("a clinician in the room is recorded by the ROSTER, truthfully and for free",
      any(r["role"] == "clinician" for r in store.session_roster(sess_att["id"])))
solo_trial = store.append_event("u", "p", "clinical", "trial", {"hit": True},
                                session_id=sess_att["id"])
rows = store.list_events("u", "p", "clinical")["events"]
check("*** but that does NOT attest their trials - presence is not vouching, and auto-filling "
      "it would empty the field ***",
      provenance.attesters_of(rows, solo_trial["id"]) == [])

# The endpoint shape.
check("the attest endpoint takes no attested_by - there is nothing to forge",
      "attested_by" not in app.AttestPost.model_fields,
      str(list(app.AttestPost.model_fields)))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
