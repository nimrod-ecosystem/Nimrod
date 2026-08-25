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
    grant_allows, is_expired, may_drive, normalize_kind,
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

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
