"""Who may drive somebody else's screen - the rules, and the storage under them.

    python test_grants.py

The rules are pure and live in grants.py, so every authorisation question is answered here
with no server, no socket and no clock of its own. That is deliberate: this is the file
where a mistake means a stranger drives a bedside screen.
"""
import sys

import db
from grants import (
    DEFAULT_TTL_DAYS, MAX_TTL_DAYS, RESOLVED_KINDS, SUBJECT_KINDS,
    GRANT_ROLES, DEFAULT_GRANT_ROLE,
    grant_allows, is_expired, may_drive, normalize_kind, normalize_role, role_for,
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


NOW = "2026-08-25T12:00:00+00:00"
PAST = "2026-08-24T12:00:00+00:00"
FUTURE = "2026-09-25T12:00:00+00:00"


def grant(**kw):
    base = {"subject_kind": "account", "subject_id": "ot", "expires_at": FUTURE}
    base.update(kw)
    return base


# ---------------------------------------------------------------- fail closed
section("the fail-closed rules - the ones that matter")

check("a live account grant allows", grant_allows(grant(), account="ot", now_iso=NOW))
check("a grant to somebody else does not",
      not grant_allows(grant(), account="stranger", now_iso=NOW))

# THE LINE THIS FILE EXISTS FOR. Groups and tags are recorded shapes with no resolver.
# A permissions system that fails OPEN on a concept it has not implemented is not one.
check("a GROUP grant does NOT allow - groups are not implemented",
      not grant_allows(grant(subject_kind="group", subject_id="ot"), account="ot", now_iso=NOW))
check("nor does a TAG grant",
      not grant_allows(grant(subject_kind="tag", subject_id="ot"), account="ot", now_iso=NOW))
check("nor does an unknown kind invented by a malformed row",
      not grant_allows(grant(subject_kind="everyone"), account="ot", now_iso=NOW))
check("only 'account' resolves today", RESOLVED_KINDS == {"account"})
check("but all three shapes are recorded", SUBJECT_KINDS == ("account", "group", "tag"))

check("an expired grant does not allow",
      not grant_allows(grant(expires_at=PAST), account="ot", now_iso=NOW))
check("a grant expiring exactly now does not allow - the boundary is closed",
      not grant_allows(grant(expires_at=NOW), account="ot", now_iso=NOW))
check("no expiry means forever, which is a real case (family, not staff)",
      grant_allows(grant(expires_at=None), account="ot", now_iso=NOW))
check("an empty subject never matches",
      not grant_allows(grant(subject_id=""), account="", now_iso=NOW))
check("an empty grant never matches", not grant_allows({}, account="ot", now_iso=NOW))
check("None never matches", not grant_allows(None, account="ot", now_iso=NOW))

check("is_expired: None is never expired", not is_expired(None, NOW))
check("is_expired: empty string is never expired", not is_expired("", NOW))
check("is_expired: past is expired", is_expired(PAST, NOW))
check("is_expired: future is not", not is_expired(FUTURE, NOW))

# ---------------------------------------------------------------- may_drive
section("the whole question in one call")

check("the owner may always drive their own person",
      may_drive("p1", account="me", owner="me", grants=[], now_iso=NOW))
check("a stranger with no grant may not",
      not may_drive("p1", account="stranger", owner="me", grants=[], now_iso=NOW))
check("a grantee may",
      may_drive("p1", account="ot", owner="me", grants=[grant()], now_iso=NOW))
check("one live grant among expired ones is enough",
      may_drive("p1", account="ot", owner="me",
                grants=[grant(expires_at=PAST), grant()], now_iso=NOW))
check("expired grants alone are not enough",
      not may_drive("p1", account="ot", owner="me",
                    grants=[grant(expires_at=PAST)], now_iso=NOW))

# A person that does not exist must look EXACTLY like one you have no grant for, or this
# becomes a way to find out which person ids are real.
check("a person that does not exist is refused, not crashed",
      not may_drive("p1", account="me", owner=None, grants=[], now_iso=NOW))
check("no account is refused", not may_drive("p1", account="", owner="me", grants=[], now_iso=NOW))
check("no person id is refused", not may_drive("", account="me", owner="me", grants=[], now_iso=NOW))
# A grant row can outlive the person it names. Honouring one would put somebody in the
# room of a person who no longer exists.
check("owner=None with a live grant STILL refuses - no orphan back door",
      not may_drive("p1", account="ot", owner=None, grants=[grant()], now_iso=NOW))

# ---------------------------------------------------------------- kinds
section("kind normalisation")

check("default is account", normalize_kind(None) == "account")
check("case and whitespace are forgiven", normalize_kind("  Group ") == "group")
# An EMPTY kind is treated as unspecified and becomes "account" - the same as a missing
# field. Safe because account is the only kind that resolves at all and it still demands
# an exact subject match; refusing it would only punish a client that sent "" for "default".
check("an empty kind means unspecified, which means account", normalize_kind("") == "account")
for bad in ("owner", "accounts", "*"):
    try:
        normalize_kind(bad)
        check(f"{bad!r} is refused", False)
    except ValueError:
        check(f"{bad!r} is refused", True)

check("the default TTL is bounded and sane", 1 <= DEFAULT_TTL_DAYS <= 90)
check("and there is a ceiling", MAX_TTL_DAYS >= DEFAULT_TTL_DAYS)

# ---------------------------------------------------------------- storage
section("storage")

store = db.SQLiteStore(":memory:")
me = store.create_person("me", "Christine")
check("a person has an owner", store.person_owner(me["id"]) == "me")
check("a person that does not exist has no owner", store.person_owner("nope") is None)

g = store.add_grant("me", me["id"], "account", "ot", label="Day-room OT", expires_at=FUTURE)
check("a grant is stored", g["id"] and g["subject_id"] == "ot")
check("the owner sees it", len(store.list_grants("me", me["id"])) == 1)
check("ANOTHER account does not see it in the owner view",
      len(store.list_grants("someone-else", me["id"])) == 0)

mine = store.grants_for_subject("account", "ot")
check("the grantee sees it", len(mine) == 1)
check("and it carries the OWNER, which the grantee needs to address anything",
      mine[0]["owner_id"] == "me")
check("a different subject sees nothing", store.grants_for_subject("account", "nobody") == [])

check("the auth read finds it regardless of who asks",
      len(store.grants_on_person(me["id"])) == 1)

# End to end through the real rule.
check("STORAGE + RULE: the grantee may drive",
      may_drive(me["id"], account="ot", owner=store.person_owner(me["id"]),
                grants=store.grants_on_person(me["id"]), now_iso=NOW))
check("STORAGE + RULE: a stranger may not",
      not may_drive(me["id"], account="stranger", owner=store.person_owner(me["id"]),
                    grants=store.grants_on_person(me["id"]), now_iso=NOW))

# Revocation, from both ends.
check("a stranger cannot revoke", store.delete_grant(g["id"], owner_id="stranger") == 0)
check("the GRANTEE can hand it back", store.delete_grant(g["id"], subject_id="ot") == 1)
check("and then it is gone", store.grants_on_person(me["id"]) == [])
check("revoking twice is a no-op, not an error", store.delete_grant(g["id"], owner_id="me") == 0)
check("a delete naming nobody is refused", store.delete_grant(g["id"]) == 0)

g2 = store.add_grant("me", me["id"], "account", "ot2")
check("the OWNER can take it back", store.delete_grant(g2["id"], owner_id="me") == 1)

# A stored group grant must still be inert.
g3 = store.add_grant("me", me["id"], "group", "ot-team")
check("a GROUP grant stores happily...", len(store.grants_on_person(me["id"])) == 1)
check("...and still does not let anybody in",
      not may_drive(me["id"], account="ot-team", owner="me",
                    grants=store.grants_on_person(me["id"]), now_iso=NOW))

# ---------------------------------------------------------------------------------------
section("THE ROLE A GRANT CONFERS - Mike: moderator by default, the person tab wins")
# ---------------------------------------------------------------------------------------
# This arrived because the input gate started judging remote drivers by the same rules it
# judges a switch by. A driver has to HAVE a role or the gate cannot apply to them.

check("an absent role is moderator - a grant that could do less than a caregiver is one "
      "nobody would issue", role_for({}) == "moderator")
check("and so is a missing grant entirely", role_for(None) == "moderator")
check("a declared role is honoured", role_for({"role": "participant"}) == "participant")
check("case and padding do not matter", role_for({"role": "  PARTICIPANT "}) == "participant")

# A ROLE IS NOT AN AUTHORISATION. Rule 1 fails CLOSED on an unresolved subject KIND, because
# that decides whether somebody gets in at all. A role only narrows what an already-authorised
# person may do, so a typo there must not lock out a clinician for no safety gain.
check("AN UNKNOWN ROLE FALLS BACK rather than failing the grant - it is not an authorisation, "
      "it is what somebody already authorised gets to be", role_for({"role": "admin"}) == "moderator")
check("normalize_role agrees on its own", normalize_role("nonsense") == "moderator")
check("the vocabulary is exactly two", set(GRANT_ROLES) == {"moderator", "participant"})
check("and the default is named rather than spelled out twice", DEFAULT_GRANT_ROLE == "moderator")

# MIKE'S RULE: "...if a role isn't already set in their person tabs."
check("THE PERSON'S OWN SETTING BEATS THE GRANT - it is the more specific statement about "
      "THIS screen", role_for({"role": "moderator"}, person_default="participant") == "participant")
check("a person default of nonsense is ignored, and the grant still decides",
      role_for({"role": "participant"}, person_default="wizard") == "participant")
check("no person default leaves the grant in charge",
      role_for({"role": "participant"}, person_default=None) == "participant")

# The role must not be able to leak into whether somebody gets in AT ALL.
check("CONTROL: a role does not make an unresolved subject kind resolve",
      not grant_allows({"subject_kind": "group", "subject_id": "ot", "role": "moderator"},
                       account="ot", now_iso=NOW))
check("CONTROL: a role does not revive an expired grant",
      not grant_allows({"subject_kind": "account", "subject_id": "ot",
                        "role": "moderator", "expires_at": PAST},
                       account="ot", now_iso=NOW))

# ---------------------------------------------------------------------------------------
section("the role survives storage")
# ---------------------------------------------------------------------------------------
store2 = db.SQLiteStore(":memory:")
p2 = store2.create_person("me2", "Christine")
gr = store2.add_grant("me2", p2["id"], "account", "ot", role="participant")
check("a stored grant carries its role back", gr.get("role") == "participant", gr)
rows2 = store2.grants_on_person(p2["id"])
check("and the auth read sees it too", rows2 and rows2[0].get("role") == "participant", rows2)
check("role_for reads it straight off the stored row", role_for(rows2[0]) == "participant")

dflt = store2.add_grant("me2", p2["id"], "account", "ot3")
check("a grant created without a role stores the default rather than an empty string",
      dflt.get("role") == "moderator", dflt)
check("a garbage role is normalised on the way IN, so storage never holds one",
      store2.add_grant("me2", p2["id"], "account", "ot4", role="wizard").get("role") == "moderator")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
