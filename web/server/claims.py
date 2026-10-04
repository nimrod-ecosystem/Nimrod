"""claims.py - "INVITE SOMEBODY TO TAKE OVER A PROFILE YOU MADE". The rules, pure.

Mike, 2026-10-04: *"I was thinking about making users for her parents and sister on my account and
hoping they could link their own accounts to it, so most of the work could already be done for
them."* This is that, and it is the first real form of linking: a person on your account, made by
you, becomes somebody else's - THEIR sign-in acts as that person - while the work you did stays put.

Same shape as grants.py, links.py and notes.py: every question here is answered with no server, no
socket and no clock of its own, and tested alone (test_claims.py). db.py stores; app.py is the door.

*** THE MODEL, ARGUED ***

  A. MOVE THE PERSON to the claimer's account. FOR: it is theirs, so it lives with them. AGAINST, and
     it decides it: the person's screens, settings, history and every grant on them are keyed by the
     OWNING account (`user_id` everywhere, the room a call joins, the note streams). Moving the row
     means moving all of that across accounts, or leaving it dangling - and "most of the work already
     done for them" is precisely that work.
  B. LEAVE THE PERSON WHERE IT IS and give the claimer's account a CLAIM on it: one row,
     {person_id, owner, account}, i.e. "this login IS that person" (role 'self'). Chosen. Nothing
     moves, so nothing breaks; ending the claim deletes one row and the person is exactly as it was.

  A claim also CONNECTS the two accounts (a `links` row, links.py): the relationship layer, which is
  what "they show on each other's page" is. The claim is the reason for the link; a link outlives no
  claim it was made for (db.end_claim breaks it when the last claim between the pair ends).

*** WHAT A CLAIM LETS THE CLAIMER DO - and nothing else ***

  1. Change the person's PICTURE (person state key 'avatar' - CLAIMER_KEYS). It is their face; it is
     the one thing on the person that most plainly IS them.
  2. SEE the inviter's other people, if the invite said so (`see_people`, default on - argued at
     DEFAULT_SEE_PEOPLE). Names and faces only.
  3. LEAVE MESSAGES (the note from someone, notes.py) for those people, if the invite said so
     (`messages`, default on - argued at DEFAULT_MESSAGES). Stored as links.py `messages`
     permissions, which is exactly the "second way in" notes.py left room for.
  4. CALL - only where calls are already allowed (a drive grant, grants.py). A claim creates no grant.

  *** NOTHING GRANTS ACCESS TO THE INVITER'S SCREENS BEYOND WHAT THE PERSON ALREADY HAD. *** A claim
  never writes a drive grant, never ticks a note writer, never reaches screen state. A message is the
  one thing it can put on a screen, it is a choice the inviter makes on the invite, and it is signed
  by the claimer's own name (notes.build_row), never the person's.

*** WHAT CHANGES FOR THE INVITER ("can no longer impersonate them in ways that matter") ***

  * The PICTURE becomes the claimer's: the inviter can no longer change it (`may_write_state`). A face
    is what everybody else reads as "this is Mom"; letting the account that made the record keep
    rewriting it after Mom took it over is the impersonation that matters.
  * The person cannot be DELETED while claimed - "Stop sharing" first. Deleting would pull somebody's
    identity out from under their own login with no word to them.
  * What stays the inviter's: the NAME (it is how the inviter's own screens address them - "Mom" on
    Mike's account and "Linda" on her own are both true), the person's screens, their settings and
    who may drive them. Those are the inviter's work, and the person was never a login before.
  * Notes the inviter leaves are signed with the INVITER's name, as they always were (notes.py), so a
    claim does not add a way to speak as the person - there never was one.

Either side ends a claim ("Stop sharing", two presses on the page). The person stays on the inviter's
account, exactly as it is; the claimer's account keeps nothing of it.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

# --------------------------------------------------------------------------- the invitation
#
# THE TOKEN. 32 random bytes (256 bits), URL-safe: unguessable by any amount of trying, so the rate
# limit below is belt and braces, not the security. ONLY ITS SHA-256 IS STORED: a database dump (or
# a log of one) holds nothing that opens an invitation. Not salted, and not slow, ON PURPOSE: a slow
# salted hash defends a LOW-entropy secret (a password) against guessing; a 256-bit random token has
# nothing to guess, and the lookup has to be an indexed equality on the hash.
TOKEN_BYTES = 32

# HOW LONG AN INVITATION WORKS. 14 days, argued:
#   FOR 7: a link in a text thread is a standing key to a profile, and shorter is safer.
#   FOR 30: grandparents check messages when they check them; a link that died before Sunday dinner
#           is a call to the person who sent it.
#   14, and it decides it: two weekends - long enough for somebody who is not online every day, short
#   enough that a forgotten link dies by itself. The inviter can cancel at any moment, and a new link
#   cancels the old one, so the length only matters for a link nobody is watching.
# A caller may ask for 1..MAX_INVITE_DAYS; the page uses the default.
DEFAULT_INVITE_DAYS = 14
MAX_INVITE_DAYS = 30

# SEE THE INVITER'S OTHER PEOPLE - default ON, argued:
#   FOR off: an account holding a caseload (a therapist, a facility) would show one resident's
#            daughter every other resident's name.
#   FOR on, and it decides the DEFAULT: the case this exists for is a family - Mom joins and expects to
#            see her daughter, her husband and her son, which is the whole point of "your people".
#   So it is a choice on the invite, on by default, named in plain words where the link is made; a
#   caseload account unticks it. Off, the claimer still sees the inviter (whoever sent the link).
DEFAULT_SEE_PEOPLE = True

# LEAVE MESSAGES FOR THOSE PEOPLE - default ON, argued:
#   FOR off: notes.py's own argument - typing words onto somebody's screen from anywhere at any hour is
#            a different thing to consent to than driving it, and needs a specific yes.
#   FOR on, and it decides the default: the invite IS that specific yes, made by the one account that
#            may give it (the owner), on purpose, for one named relative, with the box in front of them.
#            "Allow notes both ways" is what a family claim is for. Unticked, messages need the owner's
#            usual yes (the Remote tab's tick), exactly as before.
#   Every message is signed with the claimer's own name and the owner's log knows which login wrote it.
DEFAULT_MESSAGES = True

# The person-state keys a claimer may read and write on the person they claimed. The picture only.
CLAIMER_KEYS = frozenset({"avatar"})
# The person-state keys a CONNECTED account may READ on the inviter's visible people: faces, so a card
# shows a face rather than an initial. Read only.
FACE_KEYS = frozenset({"avatar"})

INVITE_STATES = ("live", "used", "expired", "cancelled")


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str | None) -> str:
    """The stored form. '' for an empty token, which never matches a stored hash."""
    t = (token or "").strip()
    if not t:
        return ""
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def same_hash(a: str, b: str) -> bool:
    return bool(a) and bool(b) and hmac.compare_digest(str(a), str(b))


def clamp_days(days) -> int:
    """The lifetime asked for, or the default. Raises ValueError outside 1..MAX_INVITE_DAYS."""
    if days is None:
        return DEFAULT_INVITE_DAYS
    try:
        d = int(days)
    except (TypeError, ValueError):
        raise ValueError("days must be a whole number")
    if d < 1 or d > MAX_INVITE_DAYS:
        raise ValueError(f"days must be 1..{MAX_INVITE_DAYS}")
    return d


def invite_state(inv: dict | None, now_iso: str) -> str:
    """'live' | 'used' | 'expired' | 'cancelled' - or 'unknown' for no row. PURE.

    Used and cancelled are checked BEFORE expiry, so a link that was used says "already used" rather
    than "expired" - the more useful thing to tell somebody holding it. ISO strings compare as times
    (the same contract as grants.is_expired)."""
    if not inv:
        return "unknown"
    if inv.get("used_at"):
        return "used"
    if inv.get("cancelled_at"):
        return "cancelled"
    if not inv.get("expires_at") or str(inv["expires_at"]) <= str(now_iso):
        return "expired"
    return "live"


def invite_refusal(*, account: str, owner: str | None, person_id: str, first_person_id: str | None,
                   claimed: bool) -> str:
    """Why `account` may NOT invite somebody to take over `person_id`, or '' if it may. PURE.

    `owner` None means the person does not exist - the same answer as not yours (no id oracle)."""
    if not account or not person_id or not owner or owner != account:
        return "not-yours"
    if claimed:
        return "claimed"
    # THE ACCOUNT'S FIRST PERSON IS YOU ("Me", the card at the top of your page). Handing it over would
    # let another login change your own picture and show up on your people's pages as you. A DEFAULT rather
    # than a law of nature (a parent who made the account FOR a teenager is the case that wants the
    # opposite), so it is on Mike's list; the way round it today is to add the teenager as a person.
    if first_person_id and person_id == first_person_id:
        return "self"
    return ""


def accept_refusal(inv: dict | None, *, account: str, now_iso: str, claimed: bool,
                   person_exists: bool, via_screen: bool) -> str:
    """Why `account` may NOT accept this invitation, or ''. PURE. Order is the order a person meets it."""
    state = invite_state(inv, now_iso)
    if state != "live":
        return state
    if not person_exists:
        return "unknown"            # the person was deleted after the link was made
    if via_screen:
        return "screen"             # a screen in a room is not somebody's own login
    if not account:
        return "signed-out"
    if account == inv.get("owner_id"):
        return "own"                # you cannot take over a profile on your own account
    if claimed:
        return "claimed"
    return ""


# --------------------------------------------------------------------------- after a claim

def visible_people(owner_people: list[dict], *, see_people: bool, claimed_person_id: str,
                   first_person_id: str | None) -> list[dict]:
    """The inviter's people a claimer sees, in the owner's order. PURE.

    With `see_people`: all of them. Without: only the inviter's first person (whoever sent the link) -
    the one connection a claim always makes. The claimed person itself is in the list either way (the
    page draws it as "you", not as somebody to call)."""
    out = []
    for p in owner_people or []:
        pid = p.get("id")
        if not pid:
            continue
        if see_people or pid == first_person_id or pid == claimed_person_id:
            out.append(p)
    return out


def claim_of(claims: list[dict], person_id: str) -> dict | None:
    return next((c for c in claims or [] if c.get("person_id") == person_id), None)


def may_read_state(key: str, *, actor: str, person_id: str, owner: str | None,
                   claims_on_owner: list[dict], owner_people: list[dict],
                   first_person_id: str | None) -> bool:
    """May `actor` READ person state `key` on `person_id`? PURE. The owner always; otherwise:
      * the claimer of THIS person, for CLAIMER_KEYS;
      * a claimer of ANOTHER person on the same account, for FACE_KEYS, on the people they can see.
    Nothing else - every other key on another account's person stays the owner's alone."""
    if not actor or not person_id or not owner:
        return False
    if actor == owner:
        return True
    mine = [c for c in claims_on_owner or [] if c.get("account_id") == actor]
    if not mine:
        return False
    if key in CLAIMER_KEYS and any(c.get("person_id") == person_id for c in mine):
        return True
    if key in FACE_KEYS:
        for c in mine:
            seen = visible_people(owner_people, see_people=bool(c.get("see_people")),
                                  claimed_person_id=c.get("person_id"), first_person_id=first_person_id)
            if any(p.get("id") == person_id for p in seen):
                return True
    return False


def may_write_state(key: str, *, actor: str, person_id: str, owner: str | None,
                    claim: dict | None) -> bool:
    """May `actor` WRITE person state `key` on `person_id`? PURE.

    Unclaimed: the owner, any key (as before). Claimed: the CLAIMER for CLAIMER_KEYS, and the owner for
    everything EXCEPT those - the picture is theirs now."""
    if not actor or not person_id or not owner:
        return False
    if claim:
        if key in CLAIMER_KEYS:
            return actor == claim.get("account_id")
        return actor == owner
    return actor == owner


def message_people(claim: dict, owner_people: list[dict], first_person_id: str | None) -> list[str]:
    """The person ids a claimer may leave messages for: the people they can see, if the invite allowed
    messages; none otherwise. PURE. What db syncs into links.py `messages` permissions."""
    if not claim or not claim.get("messages"):
        return []
    return [p["id"] for p in visible_people(owner_people, see_people=bool(claim.get("see_people")),
                                             claimed_person_id=claim.get("person_id"),
                                             first_person_id=first_person_id)]


# What the join page says for each refusal, in plain words (no "account", "token" or "grant").
REFUSAL_TEXT = {
    "unknown": "This link does not work. Ask whoever sent it for a new one.",
    "used": "This link has already been used. Ask whoever sent it for a new one if you need it.",
    "expired": "This link has run out. Ask whoever sent it for a new one.",
    "cancelled": "Whoever sent this link took it back. Ask them for a new one.",
    "screen": "Open this on your own phone or computer, not on a screen in a room.",
    "signed-out": "Sign in first, with your own login.",
    "own": "This came from your own login, so it is already yours. Send it to the person it is for.",
    "claimed": "Somebody has already made this theirs.",
    "self": "That is you. Invite somebody to one of your other people instead.",
    "not-yours": "Only whoever made this person can invite somebody to it.",
}
