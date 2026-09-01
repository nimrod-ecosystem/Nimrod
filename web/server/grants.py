"""grants.py - WHO MAY DRIVE SOMEBODY ELSE'S SCREEN.

Remote drive shipped able to do exactly one thing: let an account drive its own people's
screens. That is the demo, not the feature. **An OT on their own login could not drive a
resident's screen at all**, which is the same gap the person layer closed for bindings, one
level up: the thing being described belongs to a PERSON, and the people who need access to
it are not the person who happens to own the database row.

A GRANT is one row: *these screens, may be driven by that subject, until then.*

FOUR RULES, and each one is here because the alternative rots.

1. THE SUBJECT IS POLYMORPHIC FROM DAY ONE, AND ONLY ONE KIND RESOLVES TODAY.
   Mike asked for groups, classes and tags. Those are the right shape and they are not
   built - but a grant row whose subject cannot ever be anything but an account is a
   migration later, and a migration on a permissions table is the kind nobody enjoys. So
   the column exists now. **What does NOT exist is any code that says yes to it.** An
   unresolved subject kind returns False. A permissions system that fails OPEN on a
   concept it has not implemented yet is not a permissions system.

2. EXPIRY IS THE DEFAULT, "FOREVER" IS A CHOICE SOMEBODY MAKES.
   A permission granted for one therapy block and never revoked is how every access-control
   system decays into "everyone can do everything". But forever is a real case too - Mike
   driving somebody's screen should not need renewing every month - so it is allowed, and
   it has to be asked for. Absent an expiry, the API picks a bounded one.

3. A GRANT IS NEVER A SECRET FROM THE PEOPLE IT AFFECTS. The owner can list and revoke.
   The grantee can list and hand back. And on the screen itself, being driven is visible
   while it happens - which matters MORE once access is standing rather than per-session,
   because seeing it is the only signal left.

4. REVOCATION IS IMMEDIATE, BECAUSE THE TICKET IS SHORT.
   There is no long-lived credential to chase. A socket that is open stays open until it
   drops, but no new one can be established the moment the grant is gone - which is what
   the thirty-second ticket bought us without knowing it would matter here.
"""

from __future__ import annotations

# Only 'account' resolves. The other two are recorded shapes, not working features.
SUBJECT_KINDS = ("account", "group", "tag")
RESOLVED_KINDS = frozenset({"account"})

# What an unspecified expiry becomes. Thirty days is long enough not to be nagging and
# short enough that a forgotten grant dies on its own.
DEFAULT_TTL_DAYS = 30
MAX_TTL_DAYS = 3650

# WHAT A GRANT LETS SOMEBODY BE, not just whether it lets them in. Mike:
#   "Role column and Moderator as default, if a role isn't already set in their person tabs."
#
# This is the fifth rule, and it arrived because the input gate started judging remote drivers
# by the same rules it judges a switch by. A driver has to HAVE a role or the gate cannot
# apply to them - and hardcoding one was the wrong answer, because the two real cases want
# different ones: somebody helping needs to be a moderator, and two people playing a game
# together both need to be participants.
#
# MODERATOR IS THE DEFAULT because it matches both cases Mike named - him driving from home,
# and family showing her a video. A grant that could not do anything a caregiver can do would
# be a grant nobody would issue.
#
# THE PERSON'S OWN SETTINGS WIN, which is Mike's "if a role isn't already set in their person
# tabs" - so this is a DEFAULT the person layer overrides, not a ceiling. `role_for` is the
# whole of that rule and it is pure.
GRANT_ROLES = ("moderator", "participant")
DEFAULT_GRANT_ROLE = "moderator"


def normalize_role(role: str | None) -> str:
    """An unknown role becomes the default rather than raising.

    A permissions system fails CLOSED on a concept it has not implemented - that is rule 1 -
    but a ROLE is not an authorisation, it is what somebody already authorised gets to be.
    Refusing the whole grant over a typo in a field that only narrows what they can do would
    lock out a clinician for no safety gain.
    """
    r = (role or "").strip().lower()
    return r if r in GRANT_ROLES else DEFAULT_GRANT_ROLE


def role_for(grant: dict | None, *, person_default: str | None = None) -> str:
    """What role does this grant confer? PURE.

    Order: the person's own setting, then the grant, then moderator. Mike's rule in one line -
    the person tab is where somebody says "anyone driving this screen is a participant", and
    that has to beat whatever an individual grant happens to say, because it is the more
    specific statement about THIS person's screen.
    """
    if person_default:
        p = str(person_default).strip().lower()
        if p in GRANT_ROLES:
            return p
    return normalize_role((grant or {}).get("role"))


def normalize_kind(kind: str | None) -> str:
    k = (kind or "account").strip().lower()
    if k not in SUBJECT_KINDS:
        raise ValueError(f"unknown subject kind {kind!r}")
    return k


def is_expired(expires_at: str | None, now_iso: str) -> bool:
    """`expires_at` of None means no expiry. Comparison is on ISO-8601 strings.

    That is safe ONLY because every timestamp in this project is written by `_now()` in the
    same UTC ISO format, where lexical order is chronological order. Written down because
    it stops being true the moment somebody stores a local-time or offset-bearing string.
    """
    if not expires_at:
        return False
    return str(expires_at) <= str(now_iso)


def grant_allows(grant: dict, *, account: str, now_iso: str) -> bool:
    """Does this one grant let `account` drive? PURE - the whole rule, testable alone."""
    if not grant:
        return False
    kind = grant.get("subject_kind")
    # THE FAIL-CLOSED LINE. A 'group' grant is stored and does nothing until groups exist.
    if kind not in RESOLVED_KINDS:
        return False
    if is_expired(grant.get("expires_at"), now_iso):
        return False
    subject = grant.get("subject_id")
    return bool(subject) and subject == account


def may_drive(person_id: str, *, account: str, owner: str | None,
              grants: list[dict], now_iso: str) -> bool:
    """The whole authorisation question in one call.

    `owner` is the account that owns the person, or None if the person does not exist -
    and a person who does not exist must be indistinguishable from one you have no grant
    for, or this endpoint becomes a way to enumerate which person ids are real.
    """
    if not person_id or not account:
        return False
    # NO OWNER MEANS NO PERSON. Deleting a person can leave grant rows behind as
    # tombstones, and honouring one would let somebody hold a socket in the room of
    # somebody who no longer exists. It also keeps "does not exist" and "not allowed"
    # indistinguishable from outside, which is what stops this being an id oracle.
    if not owner:
        return False
    if owner == account:
        return True
    return any(grant_allows(g, account=account, now_iso=now_iso) for g in grants or [])
