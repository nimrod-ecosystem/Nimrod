"""links.py - HOW TWO ACCOUNTS COME TO SHARE A PERSON.

The rules are pure and live here, so every question this file answers can be answered
with no server, no socket and no clock of its own - the same shape as `grants.py`,
and for the same reason: this is a file where a mistake means a stranger reaches a
bedside screen.

Design: `docs/from_chat/connections_design.md` (private repo), v4. Read it before
changing anything here; the model was corrected twice and the corrections are the
valuable part.

*** THERE ARE TWO LAYERS, AND CONFLATING THEM IS THE BUG THIS FILE EXISTS TO AVOID ***

    LINK        "these two people are connected"      permanent until someone breaks it
                one per pair                          feels like a friends list

    PERMISSION  "and this one may do that"            revocable, expirable, granular
                many per link                         feels like settings on a friend

v1 of the design made a relationship out of a grant, which gave relationships an expiry.
Mike: *"I would expect a connection to a relative to be permanent."* **Aunt Dolly does not
stop being somebody’s aunt in thirty days.** So: revoking `call_video` does not un-relate
two people, and removing the link takes every permission with it.

FIVE RULES, each here because the alternative rots.

1. THE LINK IS UNDIRECTED; THE PERMISSIONS ARE DIRECTED.
   One row per pair, canonically ordered, so "are these two connected?" has exactly one
   answer and cannot drift between two half-rows. But *"Dolly may call Robin"* is not
   *"Robin may call Dolly"*, so every permission names its actor and its subject.

2. THE PERSON IS THE HUB, NOT THE ACCOUNT.
   A link is account-to-account, but a permission is always ABOUT A PERSON - because the
   thing being reached is a person's screens, and the people who need to reach them are
   not the account that happens to own the database row. Same lesson the person layer
   taught bindings, one level up.

3. THE CAPABILITY SET IS FROZEN AND FAILS CLOSED.
   An unrecognised capability is not stored and never resolves. A permissions system that
   fails OPEN on a concept it has not implemented is not a permissions system.

4. THE SUBJECT IS POLYMORPHIC FROM DAY ONE, AND ONLY ONE KIND RESOLVES TODAY.
   Mike: *"Groups and tags will be important for permissions."* *"Her children may call,
   her grandchildren may message"* is one rule, not eight. Those columns exist now and
   nothing says yes to them yet, because a migration on a permissions table is the kind
   nobody enjoys.

5. THERE IS NO GUARDIAN CONCEPT, AND THAT IS A DECISION, NOT AN OMISSION.
   A guardianships table, its CRUD and ~20 tests were built and then REMOVED on 2026-08-28.
   Mike: *"Guardian is kind of moot anyway, they'd just be a super user."* An account that
   may do everything for somebody is a role with every permission switched on - it does not
   need a second mechanism above the permission model.
   ***DO NOT REBUILD IT WITHOUT ASKING.*** If "may act as this account" (an account switcher,
   as opposed to "may do X to this person's screen") is ever genuinely wanted, it is a real
   and different feature - but it is not a permission, and the last version of it was deleted
   because nothing used it and `describe_storage` was publishing an empty table to users as
   something we store about them.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# CAPABILITIES - the frozen set. Presented in the UI as settings on a friend,
# in this order, which is roughly least to most invasive.
# ---------------------------------------------------------------------------
CAPABILITIES = (
    # --- reaching her -------------------------------------------------------
    "messages",       # may send messages, which JOIN HER ROTATION
    "call_audio",     # may place an audio call
    "call_video",     # may place a video call - shows the room, not just a face
    # --- putting things on her screens --------------------------------------
    "push_rotation",  # may put photos/messages IN FRONT OF HER, between the photos
    "push_video",     # may send a recommended video with a note from the sender
    # --- looking at her screens ---------------------------------------------
    "see_screen",     # may watch what is on it - SCOPED BY MODULE, see MODULE_SCOPED
    "see_progress",   # may see therapy scores and game results
    "drive_screen",   # may control it - NOT STORED HERE, see DELEGATED
    # --- the two that start OFF for everybody, including the top role -------
    "read_messages",  # may read her messages
    "manage_people",  # may add and remove her connections
    # --- how she appears to other people's networks -------------------------
    "mutual_visible", # may see her as a connection in common
    "send_request",   # may introduce her to somebody / send a request on her behalf
)

# *** `push_rotation` WAS CALLED `add_media`, AND THE RENAME IS THE POINT ***
#
# Mike's phrasing, and it is the honest one. "Add photos" sounds like filing something in an
# album that somebody might later browse. WHAT IT ACTUALLY DOES IS PUT YOUR THING IN FRONT OF
# HER, between the photos, whether or not she wanted it - because a message that waits to be
# opened is never seen by somebody who cannot open one. The permission should be named after
# what the person granting it is actually agreeing to.

# *** THE TWO THAT ARE OFF EVEN FOR THE TOP ROLE ***
#
# Mike, on read_messages: "a guardian like me might need it for someone in that situation...
# Whereas the average parent shouldn't see all of their kids' messages."
#
# These are not "high" permissions on a scale that SuperUser sits at the top of. They are
# ORTHOGONAL to the roles: somebody can legitimately have every ordinary permission and still
# have no business reading the messages or editing the connection list. Keeping them off by
# default for every role is what makes "add them to SuperUser" a survivable mistake.
#
# `manage_people` is the sharper of the two, because it is the permission that GROWS every
# other permission - whoever holds it decides who else is in the network at all.
ALWAYS_OFF_BY_DEFAULT = frozenset({"read_messages", "manage_people"})

# *** see_screen IS SCOPED BY MODULE, NOT ALL-OR-NOTHING (Mike) ***
#
# "View screen options could be per module as well, if you just want someone to see your
# photos, video, game you're playing."
#
# All-or-nothing is too blunt to be safe: somebody who may see the photo she is looking at
# should not thereby see a video call, an AAC board mid-sentence, or a therapy score. The
# permission carries a module scope; an EMPTY scope means every module, which is the only
# reading that keeps an un-scoped legacy row meaning what it meant when it was written.
MODULE_SCOPED = frozenset({"see_screen"})

# *** drive_screen IS NOT STORED IN link_permissions, AND THAT IS DELIBERATE ***
#
# "May drive this screen" already exists, in `drive_grants`, live and tested, with a role
# column and an expiry model of its own. Storing it a second time here would give one
# switch two sources of truth - and the first time they disagreed, the safe reading and
# the displayed reading would be different things. Rule 1 of grants.py is that migrating
# a permissions table is the kind nobody enjoys; duplicating one is worse.
#
# So: the UI shows drive_screen as one more switch on a friend, because that is the right
# thing for a person to look at. It resolves through `grants.may_drive` and is written
# through the grant API, which is also where its ROLE comes from - a concept the others do
# not have. `delegates(cap)` is the whole of that rule.
DELEGATED = frozenset({"drive_screen"})

#: Capabilities this module actually stores and resolves.
STORED_CAPABILITIES = tuple(c for c in CAPABILITIES if c not in DELEGATED)

# Only 'account' resolves. The other two are recorded shapes, not working features -
# same contract as grants.SUBJECT_KINDS, kept identical on purpose so the two tables
# can be reasoned about together.
SUBJECT_KINDS = ("account", "group", "tag")
RESOLVED_KINDS = frozenset({"account"})

# *** THERE IS NO LONGER A "DEFAULT CAPABILITY SET" FOR A BARE LINK, AND THAT IS THE FIX ***
#
# This used to be DEFAULT_CAPABILITIES = ("messages",), flagged in the source as a placeholder
# because the design never said what a brand-new link could do. Mike dissolved the question
# rather than answering it: *** THE INVITATION CARRIES THE GROUP. *** The sender already knows
# whether they are inviting a sister or a plumber, so a link is never created blank - it is
# created IN a group, with that group's permissions, and there is no moment where somebody
# holds a link that looks broken until they find the switches.
#
# A bare link with no group therefore grants NOTHING. That is not a conservative default
# standing in for a decision; it is the absence of one, and it is now unreachable through the
# invitation flow.
NO_GROUP_CAPABILITIES: tuple[str, ...] = ()


class UnknownCapability(ValueError):
    """Raised on the way IN. Nothing unrecognised reaches storage."""


def normalize_capability(cap: str | None) -> str:
    """Validate a capability on the way in. Raises rather than defaulting.

    Contrast `grants.normalize_role`, which quietly defaults: a ROLE only narrows what
    an already-authorised person may be, so a typo there is harmless. A CAPABILITY is
    the authorisation itself, and silently turning a typo into a working permission -
    or into a different one - is exactly the failure this set is frozen to prevent.
    """
    c = (cap or "").strip().lower()
    if c not in CAPABILITIES:
        raise UnknownCapability(f"unknown capability {cap!r}")
    return c


def delegates(cap: str) -> bool:
    """Does this capability resolve somewhere other than here? PURE."""
    return normalize_capability(cap) in DELEGATED


def normalize_kind(kind: str | None) -> str:
    k = (kind or "account").strip().lower()
    if k not in SUBJECT_KINDS:
        raise ValueError(f"unknown subject kind {kind!r}")
    return k


def canonical_pair(a: str, b: str) -> tuple[str, str]:
    """One pair, one row, one answer - see rule 1.

    Sorting the two account ids means `link(A, B)` and `link(B, A)` are the same row and
    a UNIQUE index can enforce it. Without this you get two half-links that can be broken
    independently, and "are these two connected?" starts depending on who is asking.
    """
    x, y = (a or "").strip(), (b or "").strip()
    if not x or not y:
        raise ValueError("a link needs two accounts")
    if x == y:
        # Not a harmless no-op: a self-link would make every self-permission check take
        # the linked path instead of the owner path, which is a second way to say yes.
        raise ValueError("an account cannot link to itself")
    return (x, y) if x <= y else (y, x)


def is_expired(expires_at: str | None, now_iso: str) -> bool:
    """`expires_at` of None means no expiry. Comparison is on ISO-8601 strings.

    Safe ONLY because every timestamp in this project is written by `_now()` in the same
    UTC ISO format, where lexical order is chronological order. Written down here (as in
    grants.py) because it stops being true the moment somebody stores a local-time string.
    """
    if not expires_at:
        return False
    return str(expires_at) <= str(now_iso)


# ---------------------------------------------------------------------------
# THE LINK
# ---------------------------------------------------------------------------

def link_is_active(link: dict | None) -> bool:
    """A link is active until somebody breaks it. PURE.

    Deliberately has no expiry term. That absence IS the model - see the header.
    """
    if not link:
        return False
    return not link.get("broken_at")


def linked(link: dict | None, a: str, b: str) -> bool:
    """Are these two connected right now? PURE."""
    if not link_is_active(link):
        return False
    try:
        lo, hi = canonical_pair(a, b)
    except ValueError:
        return False
    return (link.get("account_lo"), link.get("account_hi")) == (lo, hi)


# ---------------------------------------------------------------------------
# THE PERMISSION
# ---------------------------------------------------------------------------

def permission_allows(perm: dict, *, actor: str, person_id: str,
                      capability: str, now_iso: str) -> bool:
    """Does this ONE permission row let `actor` do `capability` to `person_id`? PURE."""
    if not perm:
        return False
    kind = perm.get("subject_kind")
    # THE FAIL-CLOSED LINE. A 'group' permission is stored and does nothing until
    # groups exist. Same line, same reason, as grants.grant_allows.
    if kind not in RESOLVED_KINDS:
        return False
    if perm.get("capability") != capability:
        return False
    if perm.get("person_id") != person_id:
        return False
    if is_expired(perm.get("expires_at"), now_iso):
        return False
    subject = perm.get("subject_id")
    return bool(subject) and subject == actor


def may(capability: str, *, actor: str, person_id: str, owner: str | None,
        link: dict | None, permissions: list[dict], now_iso: str) -> bool:
    """The whole authorisation question for the five stored capabilities. PURE.

    `owner` is the account that owns the person, or None if the person does not exist -
    and a person who does not exist must be indistinguishable from one you have no
    permission for, or this becomes a way to enumerate which person ids are real. Same
    rule as `grants.may_drive`, and it has to be the same or the two endpoints leak
    different things about the same id.

    `drive_screen` is refused rather than answered - see DELEGATED. Returning False would
    be a lie (the grant may well allow it) and returning True would be worse.
    """
    cap = normalize_capability(capability)
    if cap in DELEGATED:
        raise UnknownCapability(
            f"{cap!r} is not resolved by links.may() - ask grants.may_drive")
    if not actor or not person_id:
        return False
    # NO OWNER MEANS NO PERSON. Deleting a person can leave permission rows behind as
    # tombstones, and honouring one would let somebody reach the screens of a person who
    # no longer exists.
    if not owner:
        return False
    # Your own person. The owner path never touches a link, so an account is never
    # dependent on a link row to reach its own people.
    if owner == actor:
        return True
    # Everyone else needs BOTH layers: connected at all, and allowed this specifically.
    # Checking the link first is what makes "break the link" a complete revocation
    # without having to find and delete every permission row it implied.
    if not linked(link, actor, owner):
        return False
    return any(
        permission_allows(p, actor=actor, person_id=person_id, capability=cap, now_iso=now_iso)
        for p in permissions or []
    )
