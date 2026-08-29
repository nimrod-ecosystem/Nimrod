"""Connections - the two-layer model, and the storage under it.

    python test_links.py

The rules are pure and live in links.py, so every authorisation question is answered
here with no server, no socket and no clock of its own. Same shape as test_grants.py,
and for the same reason: this is a file where a mistake means a stranger reaches a
bedside screen.

Design: docs/from_chat/connections_design.md (private repo), v4.
"""
import sys

import db
import links
from links import (
    ALWAYS_OFF_BY_DEFAULT, CAPABILITIES, DELEGATED, MODULE_SCOPED, NO_GROUP_CAPABILITIES,
    RESOLVED_KINDS, STORED_CAPABILITIES,
    SUBJECT_KINDS, UnknownCapability,
    canonical_pair, delegates, guardianship_active, is_expired, link_is_active, linked,
    may, may_act_as, may_manage_guardians, normalize_capability, normalize_kind,
    permission_allows,
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


NOW = "2026-08-28T12:00:00+00:00"
PAST = "2026-08-27T12:00:00+00:00"
FUTURE = "2026-09-28T12:00:00+00:00"

LINK = {"id": "L1", "account_lo": "dolly", "account_hi": "mike", "broken_at": None}


def perm(**kw):
    base = {"capability": "messages", "person_id": "P1", "subject_kind": "account",
            "subject_id": "dolly", "expires_at": None}
    base.update(kw)
    return base


# ---------------------------------------------------------------------------------------
section("the capability set is frozen and fails closed")
# ---------------------------------------------------------------------------------------
check("the capability set is exactly the agreed list, in order",
      CAPABILITIES == ("messages", "call_audio", "call_video",
                       "push_rotation", "push_video",
                       "see_screen", "see_progress", "drive_screen",
                       "read_messages", "manage_people",
                       "mutual_visible", "send_request"), CAPABILITIES)
check("*** 'add_media' IS GONE - renamed push_rotation, because 'add photos' sounded like "
      "filing something in an album and what it does is put your thing in FRONT of her ***",
      "add_media" not in CAPABILITIES and "push_rotation" in CAPABILITIES)
check("the old name is refused outright, so a stale caller fails loudly rather than silently "
      "writing a permission nothing reads",
      raises(UnknownCapability, normalize_capability, "add_media"))
check("normalize_capability accepts a known one", normalize_capability("Call_Audio") == "call_audio")
check("*** an unknown capability RAISES rather than defaulting ***",
      raises(UnknownCapability, normalize_capability, "call_everyone"))
check("empty raises too", raises(UnknownCapability, normalize_capability, ""))
check("drive_screen is delegated, the rest are stored", DELEGATED == {"drive_screen"})
check("STORED_CAPABILITIES is the set minus the delegated one",
      STORED_CAPABILITIES == tuple(c for c in CAPABILITIES if c != "drive_screen"),
      STORED_CAPABILITIES)
check("and drive_screen is the only thing missing from it",
      set(CAPABILITIES) - set(STORED_CAPABILITIES) == {"drive_screen"})
check("delegates() answers for one", delegates("drive_screen") and not delegates("messages"))
check("*** may() REFUSES drive_screen rather than answering it - a False here would be a lie "
      "and a True would be worse ***",
      raises(UnknownCapability, may, "drive_screen", actor="dolly", person_id="P1",
             owner="mike", link=LINK, permissions=[], now_iso=NOW))
check("*** A BARE LINK WITH NO GROUP GRANTS NOTHING. The old messages-only default was a "
      "placeholder for a question Mike dissolved rather than answered: the INVITATION CARRIES "
      "THE GROUP, so a link is never created blank ***",
      NO_GROUP_CAPABILITIES == (), NO_GROUP_CAPABILITIES)

section("the two that stay off even for the top role")
check("read_messages and manage_people are the always-off pair",
      ALWAYS_OFF_BY_DEFAULT == {"read_messages", "manage_people"}, ALWAYS_OFF_BY_DEFAULT)
check("both are real capabilities, not just names in a set",
      all(c in CAPABILITIES for c in ALWAYS_OFF_BY_DEFAULT))
check("*** they are ORTHOGONAL to the roles, not the top of a scale - which is what makes "
      "'add them to SuperUser' a survivable mistake ***",
      ALWAYS_OFF_BY_DEFAULT.isdisjoint(DELEGATED))
check("neither is granted by a bare link either",
      not set(NO_GROUP_CAPABILITIES) & ALWAYS_OFF_BY_DEFAULT)

section("see_screen is scoped by module, not all-or-nothing")
check("see_screen is the module-scoped one", MODULE_SCOPED == {"see_screen"}, MODULE_SCOPED)
check("and it is a real capability", all(c in CAPABILITIES for c in MODULE_SCOPED))
check("see_progress is SEPARATE from see_screen - a friend who may watch the photos has no "
      "business seeing a therapy score",
      "see_progress" in CAPABILITIES and "see_progress" not in MODULE_SCOPED)

# ---------------------------------------------------------------------------------------
section("the subject is polymorphic and only 'account' resolves")
# ---------------------------------------------------------------------------------------
check("three kinds are recorded", SUBJECT_KINDS == ("account", "group", "tag"))
check("one kind resolves", RESOLVED_KINDS == {"account"})
check("normalize_kind defaults to account", normalize_kind(None) == "account")
check("an unknown kind raises", raises(ValueError, normalize_kind, "coven"))
for kind in ("group", "tag"):
    check(f"*** a {kind!r} permission is stored and does NOTHING - the fail-closed line ***",
          not permission_allows(perm(subject_kind=kind), actor="dolly", person_id="P1",
                                capability="messages", now_iso=NOW))

# ---------------------------------------------------------------------------------------
section("a pair is one row, in one order")
# ---------------------------------------------------------------------------------------
check("canonical_pair sorts", canonical_pair("mike", "dolly") == ("dolly", "mike"))
check("and is stable whichever way round it is asked",
      canonical_pair("mike", "dolly") == canonical_pair("dolly", "mike"))
check("*** an account cannot link to itself - a self-link would be a second way to say yes "
      "on the owner's own people ***", raises(ValueError, canonical_pair, "mike", "mike"))
check("an empty side raises", raises(ValueError, canonical_pair, "mike", ""))

# ---------------------------------------------------------------------------------------
section("THE TWO LAYERS - a link is permanent, a permission is not")
# ---------------------------------------------------------------------------------------
check("a fresh link is active", link_is_active(LINK))
check("a broken one is not", not link_is_active(dict(LINK, broken_at=PAST)))
check("no link at all is not", not link_is_active(None))
check("*** a link has NO expiry term at all - Aunt Dolly does not stop being her aunt in "
      "thirty days ***", "expires_at" not in LINK and link_is_active(LINK))
check("linked() is order-independent", linked(LINK, "mike", "dolly") and linked(LINK, "dolly", "mike"))
check("a stranger is not linked", not linked(LINK, "mike", "stranger"))
check("a broken link means not linked", not linked(dict(LINK, broken_at=PAST), "mike", "dolly"))

# ---------------------------------------------------------------------------------------
section("permission_allows - one row, the whole rule")
# ---------------------------------------------------------------------------------------
check("the matching row allows",
      permission_allows(perm(), actor="dolly", person_id="P1", capability="messages", now_iso=NOW))
check("a different capability does not",
      not permission_allows(perm(), actor="dolly", person_id="P1", capability="call_video", now_iso=NOW))
check("*** a different PERSON does not - permissions are per person, not per link ***",
      not permission_allows(perm(), actor="dolly", person_id="P2", capability="messages", now_iso=NOW))
check("a different actor does not",
      not permission_allows(perm(), actor="stranger", person_id="P1", capability="messages", now_iso=NOW))
check("an expired one does not",
      not permission_allows(perm(expires_at=PAST), actor="dolly", person_id="P1",
                            capability="messages", now_iso=NOW))
check("one expiring later still does",
      permission_allows(perm(expires_at=FUTURE), actor="dolly", person_id="P1",
                        capability="messages", now_iso=NOW))
check("no expiry means no expiry", not is_expired(None, NOW))
check("an empty subject never matches",
      not permission_allows(perm(subject_id=""), actor="", person_id="P1",
                            capability="messages", now_iso=NOW))

# ---------------------------------------------------------------------------------------
section("may() - BOTH layers are required")
# ---------------------------------------------------------------------------------------
P = [perm()]
check("linked AND permitted -> yes",
      may("messages", actor="dolly", person_id="P1", owner="mike", link=LINK,
          permissions=P, now_iso=NOW))
check("*** permitted but NOT linked -> no. Breaking the link is a complete revocation "
      "without hunting down every permission row ***",
      not may("messages", actor="dolly", person_id="P1", owner="mike",
              link=dict(LINK, broken_at=PAST), permissions=P, now_iso=NOW))
check("linked but not permitted -> no",
      not may("call_video", actor="dolly", person_id="P1", owner="mike", link=LINK,
              permissions=P, now_iso=NOW))
check("no link row at all -> no",
      not may("messages", actor="dolly", person_id="P1", owner="mike", link=None,
              permissions=P, now_iso=NOW))
check("the owner reaches their own person with no link and no permission",
      may("call_video", actor="mike", person_id="P1", owner="mike", link=None,
          permissions=[], now_iso=NOW))
check("*** a person with no owner does not exist, and must be indistinguishable from one "
      "you have no permission for - or this is an id oracle ***",
      not may("messages", actor="dolly", person_id="P1", owner=None, link=LINK,
              permissions=P, now_iso=NOW))
check("a tombstoned permission on a deleted person is not honoured",
      not may("messages", actor="dolly", person_id="P1", owner=None, link=LINK,
              permissions=[perm()], now_iso=NOW))
check("no actor -> no", not may("messages", actor="", person_id="P1", owner="mike",
                                link=LINK, permissions=P, now_iso=NOW))
check("no person -> no", not may("messages", actor="dolly", person_id="", owner="mike",
                                 link=LINK, permissions=P, now_iso=NOW))

# ---------------------------------------------------------------------------------------
section("GUARDIAN - a different kind of thing, not a bigger permission")
# ---------------------------------------------------------------------------------------
BOTH = {"guardian_account": "mike", "guarded_account": "christine",
        "accepted_by_guardian": NOW, "accepted_by_guarded": NOW, "revoked_at": None}
ONE = dict(BOTH, accepted_by_guarded=None)

check("both ends accepted -> active", guardianship_active(BOTH))
check("*** one end is a pending OFFER and authorises nothing - it cannot be claimed "
      "unilaterally ***", not guardianship_active(ONE))
check("neither end -> not active",
      not guardianship_active(dict(BOTH, accepted_by_guardian=None, accepted_by_guarded=None)))
check("revoked -> not active", not guardianship_active(dict(BOTH, revoked_at=NOW)))

check("an active guardian may act as the account", may_act_as("mike", "christine", [BOTH]))
check("a pending one may not", not may_act_as("mike", "christine", [ONE]))
check("a stranger may not", not may_act_as("stranger", "christine", [BOTH]))
check("everybody may act as themselves", may_act_as("mike", "mike", []))
check("*** guardianship is DIRECTIONAL - being her guardian is not her being yours ***",
      not may_act_as("christine", "mike", [BOTH]))

check("*** may() DOES NOT CONSULT GUARDIANSHIP. A guardian does not hold a big permission "
      "on her screens; a guardian BECOMES the account, attributed and logged ***",
      not may("messages", actor="mike", person_id="P9", owner="christine", link=None,
              permissions=[], now_iso=NOW))

section("...and who may manage guardians")
check("the account itself may", may_manage_guardians("christine", "christine", [BOTH]))
check("an existing guardian may - they are legitimately inside the account",
      may_manage_guardians("mike", "christine", [BOTH]))
check("*** A THIRD PARTY MAY NOT. 'A guardian may revoke a guardian' as an EXTERNAL route "
      "is an unauthenticated claim and a hostile takeover wearing a safeguard's clothes ***",
      not may_manage_guardians("stranger", "christine", [BOTH]))
check("somebody with only a pending offer may not",
      not may_manage_guardians("mike", "christine", [ONE]))
check("managing is exactly acting-as and deliberately nothing more, so there is no extra "
      "external path to have a hole in",
      may_manage_guardians("mike", "christine", [BOTH]) == may_act_as("mike", "christine", [BOTH]))

# =======================================================================================
section("STORAGE - the rules above, through a real database")
# =======================================================================================
store = db.SQLiteStore(":memory:")
person = store.create_person("mike", "Christine")
PID = person["id"]

lk = store.create_link("mike", "dolly", created_by="mike")
check("a link is created canonically ordered",
      (lk["account_lo"], lk["account_hi"]) == ("dolly", "mike"), lk)
again = store.create_link("dolly", "mike", created_by="dolly")
check("*** creating it the other way round returns THE SAME ROW, not a second half-link ***",
      again["id"] == lk["id"], (lk, again))
check("get_link finds it either way",
      store.get_link("mike", "dolly")["id"] == store.get_link("dolly", "mike")["id"])
check("it shows in mike's friends list with the far end named",
      [l["other"] for l in store.list_links("mike")] == ["dolly"], store.list_links("mike"))
check("and in dolly's, pointing the other way",
      [l["other"] for l in store.list_links("dolly")] == ["mike"])

check("no permission yet, so no messages",
      not store.may_capability("messages", actor="dolly", person_id=PID))
store.add_link_permission(lk["id"], PID, "messages", subject_id="dolly")
check("switch on -> yes", store.may_capability("messages", actor="dolly", person_id=PID))
check("but only that switch",
      not store.may_capability("call_video", actor="dolly", person_id=PID))
check("the owner needs no link or permission for their own person",
      store.may_capability("call_video", actor="mike", person_id=PID))

dup = store.add_link_permission(lk["id"], PID, "messages", subject_id="dolly")
check("turning the same switch on twice is idempotent - one row, not two",
      len(store.list_link_permissions(lk["id"])) == 1, store.list_link_permissions(lk["id"]))
check("and it is the same row", dup["id"] == store.list_link_permissions(lk["id"])[0]["id"])

check("*** drive_screen is REFUSED by the link table - it lives in drive_grants, and one "
      "switch with two sources of truth is worse than the duplication looks ***",
      raises(links.UnknownCapability, store.add_link_permission, lk["id"], PID,
             "drive_screen", "dolly"))
check("a garbage capability never reaches storage",
      raises(links.UnknownCapability, store.add_link_permission, lk["id"], PID,
             "call_everyone", "dolly"))

expired = store.add_link_permission(lk["id"], PID, "call_audio", subject_id="dolly",
                                    expires_at=PAST)
check("an expired permission stores fine and resolves to no",
      expired["expires_at"] == PAST and
      not store.may_capability("call_audio", actor="dolly", person_id=PID))

grp = store.add_link_permission(lk["id"], PID, "see_screen", subject_id="her-kids",
                                subject_kind="group")
check("a group permission is STORED (the column is real)...", grp["subject_kind"] == "group")
check("...and resolves to nothing until groups exist",
      not store.may_capability("see_screen", actor="her-kids", person_id=PID))

section("breaking a link takes the permissions with it")
n = store.break_link("mike", "dolly", broken_by="mike")
check("break_link reports the one row it ended", n == 1)
check("the link is gone from the friends list", store.list_links("mike") == [])
check("messages stop immediately",
      not store.may_capability("messages", actor="dolly", person_id=PID))
check("*** and the permission ROWS are deleted, not left inert - otherwise a future "
      "re-link would silently restore everything they had before the fallout ***",
      store.list_link_permissions(lk["id"]) == [], store.list_link_permissions(lk["id"]))
check("breaking an already-broken link is a no-op, not an error",
      store.break_link("mike", "dolly", broken_by="mike") == 0)

revived = store.create_link("mike", "dolly", created_by="dolly")
check("re-linking reuses the row", revived["id"] == lk["id"])
check("and it is active again", store.list_links("mike") != [])
check("*** but starts with NO permissions - being re-invited is not being restored ***",
      not store.may_capability("messages", actor="dolly", person_id=PID))

section("guardianship, stored")
store.offer_guardianship("mike", "christine", accepted_by="mike")
check("one side accepted is not yet active",
      not links.guardianship_active(store.get_guardianship("mike", "christine")))
check("...and does not let him act as her",
      not links.may_act_as("mike", "christine", store.guardianships_of("christine")))
store.offer_guardianship("mike", "christine", accepted_by="christine")
g = store.get_guardianship("mike", "christine")
check("both sides accepted -> active", links.guardianship_active(g), g)
check("he may now act as her",
      links.may_act_as("mike", "christine", store.guardianships_of("christine")))
check("it shows in his account switcher",
      [x["guarded_account"] for x in store.guardianships_held_by("mike")] == ["christine"])
check("an account cannot be its own guardian",
      raises(ValueError, store.offer_guardianship, "mike", "mike", "mike"))
check("*** a third party cannot accept on somebody's behalf - that is the unauthenticated "
      "claim the whole model refuses ***",
      raises(ValueError, store.offer_guardianship, "mike", "christine", "stranger"))

check("*** a stranger cannot revoke it, however loudly they assert guardianship ***",
      store.revoke_guardianship("mike", "christine", revoked_by="stranger") == 0)
check("and it is still active after that attempt",
      links.guardianship_active(store.get_guardianship("mike", "christine")))
check("the account itself can revoke",
      store.revoke_guardianship("mike", "christine", revoked_by="christine") == 1)
check("and then he cannot act as her",
      not links.may_act_as("mike", "christine", store.guardianships_of("christine")))

section("the residual risk, tested so it is not a surprise")
store.offer_guardianship("mike", "christine", accepted_by="mike")
store.offer_guardianship("mike", "christine", accepted_by="christine")
store.offer_guardianship("sister", "christine", accepted_by="sister")
store.offer_guardianship("sister", "christine", accepted_by="christine")
check("two guardians, both active",
      links.guardianship_active(store.get_guardianship("mike", "christine")) and
      links.guardianship_active(store.get_guardianship("sister", "christine")))
check("*** ONE GUARDIAN CAN REMOVE ANOTHER - true of every co-administrator system, named "
      "as residual risk rather than badly solved. Acting-as is logged and visible on both "
      "accounts, which is the mitigation; the product must not arbitrate a family dispute ***",
      store.revoke_guardianship("sister", "christine", revoked_by="mike") == 1)
check("re-offering after a revocation needs BOTH ends to say yes again",
      (store.offer_guardianship("sister", "christine", accepted_by="sister") is not None) and
      not links.guardianship_active(store.get_guardianship("sister", "christine")))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
