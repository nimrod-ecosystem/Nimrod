"""claims.py - PEOPLE ACROSS ACCOUNTS: a profile has a home, and appears on other accounts. The rules, pure.

Mike, 2026-10-04 (DECISIONS.md "People across accounts: a profile has a home, and appears on other accounts"),
after trying the first linking build (8908b2c), which left a claimed profile on the inviter's account and let the
inviter keep the name. His rulings, in short:
  1. a claimed profile is on the claimer's account too, and THAT copy is the main one;
  2. the person can change whatever they want on their own profile;
  3. "I call them": each account can have its own name for somebody ("Mom" on one, "Grandma" on another);
  4. one profile can be on several accounts;
  5. connecting works without setting anybody up first ("connected like friends on Facebook");
  6. an invite picks which profiles to share, and the permissions.

Same shape as grants.py, links.py and notes.py: every question here is answered with no server, no socket and no
clock of its own, and tested alone (test_claims.py). db.py stores; app.py is the door.

*** THE MODEL (DECISIONS.md item 11, Code's design) ***

  * Every person row is on ONE account and stays there. Screens, settings, events and grants are keyed by the
    account that holds the row, so a row is never moved: moving it would orphan that account's screens.
  * A row may point at a HOME row (`people.home_id`). The home is the main instance of that profile; a row with no
    home_id is its own home. The pointer is kept FLAT: it always names a row that is itself a home.
  * THE PROFILE - name, picture (`avatar`), page (`page`, About me lives in it) - is read from the home and written
    only by the home's account (PROFILE_KEYS). Every other person-state key stays the holding account's own.
  * Any row may carry "I call them" (`people.call_name`): the holding account's own name for that person. Empty,
    the profile's name shows (the home's, for a row whose home is elsewhere). It never changes the profile's name.
    Mike, 2026-10-05: *"I call them" can be added at any time, on any card* - so a person you made yourself can
    carry one too, as your private label beside the name on their card; handed over later, that label is already
    the "I call them" the claim keeps (db.accept_invite keeps a label that is there rather than overwriting it).
  * `people.source_id` is the row on the OTHER account this one reaches through (where its messages go when it
    has no screen of its own), `people.link_id` the connection (links.py) that put it here, and `people.made_by`
    how: 'claim' (an existing row joined to a claimer's own profile) or 'link' (a row made by a connection).

*** THE TWO WAYS IN ***

  CONNECT LIKE FRIENDS (the main one). "Connect with someone" makes a link. Accepted, the two logins are connected
  (a `links` row), and each side gets a row for the other's "you" (their first person), pointing at it as home.
  CLAIM (the second). "Invite them to use this" on one of your people: accepted, that row is joined to the
  claimer's own "you" - its home becomes the claimer's - and the inviter's row keeps the name it had as "I call
  them", so nothing visibly changes for the inviter. "Most of the work already done": a picture or page the
  inviter made is copied to the claimer's own profile if theirs is still empty (db.copy_profile_if_empty).

  BOTH CAN SHARE PROFILES: the inviter ticks which of the people they look after the other side gets a row for
  (default: just themselves - DEFAULT_SHARES argues it), and for each whether the other side may leave messages
  (a links.py `messages` permission on the inviter's row). Calls stay on the drive-grant path: an invite grants no
  call and reaches no screen. The person accepting decides, on the join page, whether the inviter may leave
  messages for THEM (MESSAGES_BACK).

*** WHAT ENDS IT ***

  "Stop sharing", from either side, ends the connection: rows that connection MADE are removed (a row with screens
  of its own is kept as a plain row instead, so nobody's screen loses its person), a claimed row goes back to being
  the inviter's own plain row with the name it was called and whatever picture it had before, and links.py drops
  every permission on the link. The home row is never removed by it.

*** ONE CARD AT A TIME (2026-10-04, later the same night: the three things 63f3d72 left unbuilt) ***

  "SHARED WITH" (2026-10-05; first built as "Who has this card", renamed because Mike found that confusing - the
  words people know from shared documents and photo albums), for the account that looks after a profile (the
  home): which logins hold a row for it. Each
  is shown by THAT LOGIN'S OWN NAME, never by what they call the person (`call_name`). Argued: FOR showing it, it is
  warm ("Oscar calls you Grandpa") and it is a name for the home's own person. AGAINST, and it decides it: the "I
  call them" window already promises "Only you see this", and a promise the site has made is not ours to break in a
  later build. A holder the home is not connected with (somebody shared the profile with them before it was taken
  over) is "Someone, through Pat" - they never agreed to be named to the home. (A GUESS - Mike's list.)
  "STOP SHARING WITH OSCAR", from that list: Oscar's row for this one profile goes (kept as Oscar's own plain row
  if he gave it a screen, as "Stop sharing" does), with the permissions that came with that row - and the
  connection stays. A row Oscar's login had made and somebody then took over (made_by 'claim') is Oscar's own
  original: it is not removed, it goes back to being his own plain row, as "Stop sharing" treats it.
  "REMOVE JUST THIS CARD", on the holder's side: the holder's row for one profile goes, same permissions, the
  connection stays. Not on a row taken over by a claim: that is the holder's own original, with their screens and
  settings, and removing it would remove what they set up; Stop sharing gives it back to them instead.
  BOTH LEAVE AT LEAST ONE CARD FROM A CONNECTION ON EACH SIDE (`LAST_CARD_STAYS`, argued there).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

# --------------------------------------------------------------------------- the invitation
#
# THE TOKEN. 32 random bytes (256 bits), URL-safe: unguessable by any amount of trying, so the rate
# limit in app.py is belt and braces, not the security. ONLY ITS SHA-256 IS STORED: a database dump (or
# a log of one) holds nothing that opens an invitation. Not salted, and not slow, ON PURPOSE: a slow
# salted hash defends a LOW-entropy secret (a password) against guessing; a 256-bit random token has
# nothing to guess, and the lookup has to be an indexed equality on the hash.
TOKEN_BYTES = 32

# HOW LONG AN INVITATION WORKS. 14 days, argued:
#   FOR 7: a link in a text thread is a standing key to a profile, and shorter is safer.
#   FOR 30: grandparents check messages when they check them; a link that died before Sunday dinner
#           is a call to the person who sent it.
#   14, and it decides it: two weekends - long enough for somebody who is not online every day, short
#   enough that a forgotten link dies by itself. The inviter can take it back at any moment.
# A caller may ask for 1..MAX_INVITE_DAYS; the page uses the default.
DEFAULT_INVITE_DAYS = 14
MAX_INVITE_DAYS = 30
# HOW LONG A DEAD LINK IS KEPT. A link that ran out or was taken back stays this many days, so the
# person holding it reads "this link has run out - ask Pat for a new one" rather than a bare "not
# found" (which also counts against their address as a wrong guess). After that it is deleted. 30: the
# longest a link can live, again. A used link is kept: it is the record of who joined.
KEEP_DEAD_INVITE_DAYS = 30

INVITE_KINDS = ("claim", "connect")
INVITE_STATES = ("live", "used", "expired", "cancelled")

# WHICH OF YOUR PEOPLE AN INVITE SHARES, BY DEFAULT: JUST YOU. A GUESS (Mike's list), argued:
#   FOR everybody you look after (what 8908b2c did with "see your other people", on by default): a family -
#            Mom joins and expects to see her daughter, her husband and her son.
#   FOR just you, and it decides the default: the commonest invite is now "connect like friends", and a
#            friend from work does not expect your mother's card on their page; an account holding a
#            caseload (a therapist, a facility) would hand one resident's daughter every resident. The
#            family case is three ticks away, on the same window, in plain words.
DEFAULT_SHARES = "self"
# LEAVE MESSAGES, per shared person - default ON. The invite IS the specific yes notes.py asks for, made
# by the one account that may give it, for named people, with the box in front of them. Unticked, a
# message needs that account's usual yes (the Remote tab's tick), exactly as before.
DEFAULT_MESSAGES = True
# THE OTHER WAY: may whoever SENT the link leave messages for the person accepting it - default ON, asked
# on the join page. Connecting "like friends" is two-way; somebody who only wants to receive unticks it.
MESSAGES_BACK = True
# At most this many people on one invite. A family is a handful; this bounds one request, not a person.
MAX_SHARES = 50

# THE PROFILE: the person-state keys read from the home and written only by the home's account.
PROFILE_KEYS = frozenset({"avatar", "page"})
# Which of them another account can READ through the row it holds:
#   * the picture, through any row - a card on your page shows their face (Mike, item 8: by default a
#     visitor sees the card, picture and name, and no more);
#   * the page too, through a row joined by a CLAIM: that row's screens are the person's own (a screen in
#     their room, set up by the account that made them), so the page they show is the person's own page.
#     A row made by a connection does not show the page: "who can see my page" is a later setting
#     (item 7), and until it exists the default is the card.
READ_THROUGH_ANY = frozenset({"avatar"})
READ_THROUGH_CLAIM = frozenset({"avatar", "page"})


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


def is_home(row: dict | None) -> bool:
    """Is this row its own home (the main instance of its profile)? PURE."""
    return bool(row) and not row.get("home_id")


def invite_refusal(*, account: str, row: dict | None, first_person_id: str | None) -> str:
    """Why `account` may NOT invite somebody to take over this row, or '' if it may. PURE.

    `row` None means the person does not exist - the same answer as not yours (no id oracle)."""
    if not account or not row or row.get("account_id") != account:
        return "not-yours"
    if row.get("home_id"):
        # Joined by a claim: they already use it. Made by a connection: it is somebody else's profile,
        # and only whoever looks after a profile hands it over.
        return "claimed" if row.get("made_by") == "claim" else "not-home"
    # THE ACCOUNT'S FIRST PERSON IS YOU ("Me", the card at the top of your page). Handing it over would
    # let another login change your own picture and show up on your people's pages as you. A DEFAULT rather
    # than a law of nature (a parent who made the account FOR a teenager is the case that wants the
    # opposite), so it is on Mike's list; the way round it today is to add the teenager as a person.
    if first_person_id and row.get("id") == first_person_id:
        return "self"
    return ""


def accept_refusal(inv: dict | None, *, account: str, now_iso: str, target_ok: bool, via_screen: bool) -> str:
    """Why `account` may NOT accept this invitation, or ''. PURE. Order is the order a person meets it.

    `target_ok`: for a claim, the person still exists and is still its own home on the inviter's account
    (False after it was deleted - 'unknown' - or already taken over - the caller says which); for a connect,
    the inviter still exists."""
    state = invite_state(inv, now_iso)
    if state != "live":
        return state
    if not target_ok:
        return "unknown"
    if via_screen:
        return "screen"             # a screen in a room is not somebody's own login
    if not account:
        return "signed-out"
    if account == inv.get("owner_id"):
        return "own"                # you cannot accept your own link
    return ""


def clean_shares(raw, *, own_rows: list[dict], first_person_id: str | None, exclude: str | None = None) -> list[dict]:
    """The people an invite shares, checked: [{person_id, messages}], in the order asked. PURE.

    `raw` None -> the default (just you, messages DEFAULT_MESSAGES). Each entry may be a person id or
    {person_id, messages}. Only people this account LOOKS AFTER (home rows on it) can be shared: a profile
    you only hold came from somebody else, and passing it on is theirs to do (a GUESS - Mike's list; the
    case for the opposite is a grandparent who would like their grandchild to pass their card along).
    `exclude` (the person being handed over) is left out. Raises ValueError naming the first problem."""
    homes = {r["id"]: r for r in own_rows or [] if r.get("id") and is_home(r)}
    if raw is None:
        return [{"person_id": first_person_id, "messages": DEFAULT_MESSAGES}] \
            if first_person_id and first_person_id in homes and first_person_id != exclude else []
    if not isinstance(raw, list):
        raise ValueError("shares must be a list")
    if len(raw) > MAX_SHARES:
        raise ValueError(f"at most {MAX_SHARES} people on one invitation")
    out, seen = [], set()
    for e in raw:
        if isinstance(e, str):
            pid, msg = e, DEFAULT_MESSAGES
        elif isinstance(e, dict):
            pid, msg = e.get("person_id"), e.get("messages", DEFAULT_MESSAGES)
        else:
            raise ValueError("each shared person is an id or {person_id, messages}")
        if not isinstance(pid, str) or pid not in homes:
            raise ValueError("you can only share people you look after")
        if pid == exclude or pid in seen:
            continue
        seen.add(pid)
        out.append({"person_id": pid, "messages": bool(msg)})
    return out


# --------------------------------------------------------------------------- rows across accounts

def display_name(row: dict | None, home_name: str | None) -> str:
    """What the holding account sees: its "I call them", else the home's name, else the row's own. PURE."""
    if not row:
        return ""
    call = (row.get("call_name") or "").strip()
    if call:
        return call
    return profile_name(row, home_name)


def profile_name(row: dict | None, home_name: str | None) -> str:
    """The name on the person's card, as ANYBODY ELSE sees it: the home's name, else the row's own - never the
    holding account's "I call them". PURE. *** A SECURITY INVARIANT: "I call them" is only ever shown to the
    account that set it *** - so whatever a page shows another login (an invitation's first look, the people a
    link shares, a screen shared through a drive grant, a login's own name) reads this, never display_name."""
    if not row:
        return ""
    return (home_name or row.get("name") or "").strip()


def row_kind(row: dict, *, first_person_id: str | None, source_is_their_first: bool = False) -> str:
    """What a row is TO THE ACCOUNT HOLDING IT. PURE.
      'you'       the account's first person
      'mine'      a profile this account looks after (its own home)
      'joined'    one of this account's people that somebody took over with their own login
      'connected' somebody this account connected with (their own "you")
      'shared'    somebody another account shared with this one"""
    if first_person_id and row.get("id") == first_person_id:
        return "you"
    if not row.get("home_id"):
        return "mine"
    if row.get("made_by") == "claim":
        return "joined"
    return "connected" if source_is_their_first else "shared"


def reach_id(row: dict, *, own_screens: int) -> str:
    """Where a message, a recommendation or a call for this row goes: the row itself when this account has a
    screen for it (or it is this account's own profile), else the row it came through on the other account
    (whose permissions say whether it may). PURE.

    A GUESS for a claimed row (Mike's list): the inviter's own screen for the person (a screen in their room,
    which the inviter set up) wins over the person's own login, because it is the one that is on the wall."""
    if own_screens > 0 or not row.get("home_id") or not row.get("source_id"):
        return row["id"]
    return row["source_id"]


def state_target(key: str, *, actor: str, row: dict | None, home: dict | None, write: bool):
    """Which (account, person) person-state `key` on `row` is read from or written to by `actor`, or a
    refusal: 'missing' (the same 404 as no such person) | 'profile' (a profile key written by an account
    that does not look after the profile). PURE.

    *** A SECURITY INVARIANT: only the account holding a row reaches anything through it, and only the
    home's account writes a profile key. *** No other account's person state is reachable here at all -
    not for reading, not for writing."""
    if not actor or not row or row.get("account_id") != actor:
        return "missing"
    if key not in PROFILE_KEYS or not row.get("home_id"):
        return (row["account_id"], row["id"])
    if write:
        return "profile"
    allowed = READ_THROUGH_CLAIM if row.get("made_by") == "claim" else READ_THROUGH_ANY
    if key not in allowed:
        return "missing"
    if not home:
        return (row["account_id"], row["id"])      # a home that went away: the row's own, until it is tidied
    return (home["account_id"], home["id"])


# --------------------------------------------------------------------------- one card at a time
#
# THE LAST CARD FROM A CONNECTION STAYS. Removing one card ("Remove just this card", or the home's "Stop sharing
# with Oscar") is refused when it is the only row that connection put on that login's page; Stop sharing ends the
# connection instead. A DEFAULT, argued (Mike's list):
#   FOR allowing it: somebody who wants Oscar to keep seeing their page, but not Oscar's face on their own.
#   AGAINST, and it decides it for now: with no card left, nothing on that page shows the connection is there -
#            Oscar can still see their page and leave them messages, and there is no card left to press Stop
#            sharing on. A connection you cannot see from your own page is the surprise this project avoids.
# True: refuse the last one. False would allow it (and leave such a connection to be ended from the other side).
LAST_CARD_STAYS = True


def holder_refusal(holder: dict | None, *, link_rows: int) -> str:
    """Why this one row on another login may NOT be taken away by itself, or ''. PURE.
    `link_rows`: how many rows the same connection put on that login's page (this one included)."""
    if not holder:
        return "missing"
    if LAST_CARD_STAYS and holder.get("link_id") and link_rows <= 1:
        return "last"
    return ""


def unshare_refusal(*, actor: str, home: dict | None, holder: dict | None, link_rows: int) -> str:
    """Why `actor` may NOT stop sharing this one profile (`home`) with the login holding `holder`, or ''. PURE.

    *** A SECURITY INVARIANT: only the account that looks after a profile sees or takes away who holds it. ***
    'missing' (the same 404 as no such person: not your profile, or that row is not a copy of it) | 'not-home'
    (yours, but somebody else looks after the profile) | 'last' | ''."""
    if not actor or not home or home.get("account_id") != actor:
        return "missing"
    if home.get("home_id"):
        return "not-home"
    if not holder or holder.get("home_id") != home.get("id") or holder.get("account_id") == actor:
        return "missing"
    return holder_refusal(holder, link_rows=link_rows)


def remove_card_refusal(*, actor: str, row: dict | None, first_person_id: str | None, screens: int,
                        link_rows: int) -> str:
    """Why `actor` may NOT remove this one card from their own page with "Remove just this card", or ''. PURE.

    *** A SECURITY INVARIANT: only the account holding a row removes it. ***
    'missing' | 'own-card' (your own card) | 'mine' (somebody you look after: that is Delete, not this) | 'joined' (a
    row you made that somebody took over: Stop sharing gives it back) | 'screens' (it has a screen of its own, the
    same refusal as deleting a person) | 'last-here' (LAST_CARD_STAYS) | ''."""
    if not actor or not row or row.get("account_id") != actor:
        return "missing"
    if first_person_id and row.get("id") == first_person_id:
        return "own-card"
    if not row.get("home_id"):
        return "mine"
    if row.get("made_by") == "claim":
        return "joined"
    if screens > 0:
        return "screens"
    return "last-here" if holder_refusal(row, link_rows=link_rows) == "last" else ""


# What the join page and the invite window say for each refusal, in plain words (no "account", "token" or
# "grant").
REFUSAL_TEXT = {
    "unknown": "This link does not work. Ask whoever sent it for a new one.",
    "used": "This link has already been used. Ask whoever sent it for a new one if you need it.",
    "expired": "This link has run out. Ask whoever sent it for a new one.",
    "cancelled": "Whoever sent this link took it back. Ask them for a new one.",
    "screen": "Open this on your own phone or computer, not on a screen in a room.",
    "signed-out": "Sign in first, with your own login.",
    "own": "This came from your own login. Send it to the person it is for.",
    "claimed": "Somebody already uses this with their own login.",
    "not-home": "Only whoever looks after this person can invite somebody to it.",
    "self": "That is you. Use Connect with someone to send somebody a link to you.",
    "not-yours": "Only whoever made this person can invite somebody to it.",
    "shares": "Only the people you look after can be shared.",
    # one card at a time
    "last": "It is the only card they have from this connection. Stop sharing ends the connection instead.",
    "last-here": "It is the only card from them on your page. Stop sharing ends the connection instead.",
    "screens": "This card has a screen of its own. Move or delete that screen first.",
    "joined": "You made this card, and they took it over with their own login. Stop sharing gives it back to you.",
    "own-card": "This is your own card.",
    "mine": "This is somebody you look after. Remove them from your people instead.",
    "not-home-list": "Only whoever looks after this person can see who they are shared with.",
}
