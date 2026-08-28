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
stop being Christine's aunt in thirty days.** So: revoking `call_video` does not un-relate
two people, and removing the link takes every permission with it.

FIVE RULES, each here because the alternative rots.

1. THE LINK IS UNDIRECTED; THE PERMISSIONS ARE DIRECTED.
   One row per pair, canonically ordered, so "are these two connected?" has exactly one
   answer and cannot drift between two half-rows. But *"Dolly may call Christine"* is not
   *"Christine may call Dolly"*, so every permission names its actor and its subject.

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

5. GUARDIANSHIP IS NOT A BIGGER PERMISSION - see below. It is deliberately NOT consulted
   by `may()`, and that separation is load-bearing.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# CAPABILITIES - the frozen set. Presented in the UI as settings on a friend,
# in this order, which is roughly least to most invasive.
# ---------------------------------------------------------------------------
CAPABILITIES = (
    "messages",      # may send messages through Nimrod
    "call_audio",    # may call, auto-answers
    "call_video",    # may call, auto-answers - stricter default than audio
    "see_screen",    # may watch what is on it
    "drive_screen",  # may control it - SEE BELOW, this one is not stored here
    "add_media",     # may put photos and messages on her screens
)

# *** drive_screen IS NOT STORED IN link_permissions, AND THAT IS DELIBERATE ***
#
# "May drive this screen" already exists, in `drive_grants`, live and tested, with a role
# column and an expiry model of its own. Storing it a second time here would give one
# switch two sources of truth - and the first time they disagreed, the safe reading and
# the displayed reading would be different things. Rule 1 of grants.py is that migrating
# a permissions table is the kind nobody enjoys; duplicating one is worse.
#
# So: the UI shows six switches on a friend, because that is the right thing for a person
# to look at. Five of them resolve here. `drive_screen` resolves through `grants.may_drive`
# and is written through the grant API, which is also where its ROLE comes from - a concept
# the other five do not have. `delegates(cap)` is the whole of that rule.
DELEGATED = frozenset({"drive_screen"})

#: Capabilities this module actually stores and resolves.
STORED_CAPABILITIES = tuple(c for c in CAPABILITIES if c not in DELEGATED)

# Only 'account' resolves. The other two are recorded shapes, not working features -
# same contract as grants.SUBJECT_KINDS, kept identical on purpose so the two tables
# can be reasoned about together.
SUBJECT_KINDS = ("account", "group", "tag")
RESOLVED_KINDS = frozenset({"account"})

# WHAT A BRAND-NEW LINK CAN DO BEFORE ANYBODY TOUCHES A SWITCH.
#
# *** THIS IS A CONSERVATIVE PLACEHOLDER, NOT A DECISION. *** The design says audio calls
# "auto-answer" and that video is "a stricter default than audio", but it does not say what
# a link starts with, and Mike has not been asked. Starting at messages-only is the choice
# that cannot hurt anybody while the question is open: a link that can do too little is a
# switch somebody flips, and a link that can do too much is a stranger's face on her screen.
# Raise it the moment Mike says what the defaults should be.
DEFAULT_CAPABILITIES = ("messages",)


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

    GUARDIANSHIP IS NOT CONSULTED HERE, ON PURPOSE. A guardian does not have a big
    permission on somebody's screens; a guardian may BECOME the account, and then asks
    this question AS that account, attributed and logged. Folding it in here would make
    every acting-as invisible at exactly the layer that decides access.

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


# ---------------------------------------------------------------------------
# GUARDIAN - a class above the grant model, not a bigger grant
# ---------------------------------------------------------------------------
#
# Mike: *"Let's make a connection class 'Guardian' where it would have to be selected on
# both our ends and then I could bounce between the accounts."*
#
# Every other permission is "may do X to this person's screen". Guardianship is
# ***"may act as this account"*** - the account switcher in the corner.
#
# *** NAMED HONESTLY, BECAUSE THE INTERFACE MUST NOT IMPLY A CONSENT THAT DID NOT HAPPEN ***
# Christine cannot meaningfully select a guardian, and cannot revoke one. In practice Mike
# clicks both ends. That is administration, not consent. It is still worth building - somebody
# has to be able to act for her, and today that is already true informally - but the data and
# the screen should say what it is. Acting-as is logged and shown on both accounts, because
# visibility is the only safeguard left when revocation is not available to the person concerned.
# Guardianship in the world is a LEGAL status; this product neither confers nor verifies one.

def guardianship_active(row: dict | None) -> bool:
    """Both ends selected it, and nobody has revoked it. PURE.

    BOTH ends is the whole point: it cannot be claimed unilaterally. A row with only one
    side accepted is a pending offer, and a pending offer authorises nothing.
    """
    if not row:
        return False
    if row.get("revoked_at"):
        return False
    return bool(row.get("accepted_by_guardian")) and bool(row.get("accepted_by_guarded"))


def may_act_as(actor: str, account: str, guardianships: list[dict]) -> bool:
    """May `actor` switch into `account`? PURE.

    Note this answers a different question from `may()` and returns a different KIND of
    answer: not "may you touch this screen" but "may you become this account". Everything
    done afterwards is attributed to the actor, not to the account.
    """
    if not actor or not account:
        return False
    if actor == account:
        return True
    return any(
        guardianship_active(g)
        and g.get("guardian_account") == actor
        and g.get("guarded_account") == account
        for g in guardianships or []
    )


def may_manage_guardians(actor: str, account: str, guardianships: list[dict]) -> bool:
    """Who may add or remove a guardian on `account`? PURE.

    *** THE RULE: FROM INSIDE THE ACCOUNT, AND BY NO OTHER ROUTE. ***

    Mike closed this one and my proposal had a hole in it. I had suggested "maybe a second
    guardian can revoke the first" as a safeguard for somebody who cannot act for themselves.

      Mike: *"They would need access to her account to revoke it. Her account can already do
      that. We can't let just any third party sever someone else's access. How would we know
      they're a guardian?"*

    ***THAT SUGGESTION WAS A HOSTILE-TAKEOVER MECHANISM WEARING A SAFEGUARD'S CLOTHES.***
    "A guardian may revoke a guardian" sounds like a check on power, but as an EXTERNAL route
    it is an unauthenticated claim: the product cannot adjudicate which of two people
    asserting guardianship is real, so it would hand anyone who asserts it the power to cut
    off somebody legitimate.

    So this is exactly `may_act_as` and deliberately nothing more - no extra external path
    exists to have a hole in.

    THE RESIDUAL RISK, NAMED RATHER THAN BADLY SOLVED: one guardian CAN remove another,
    because both are legitimately inside the account. That is true of every co-administrator
    system anywhere. The mitigation is the one already chosen - acting-as is logged and
    visible on both accounts, so it cannot happen quietly. Anything stronger would require
    the product to arbitrate a family dispute, which it must not attempt.
    """
    return may_act_as(actor, account, guardianships)
