"""screen_access.py - WHO MAY SEE A SCREEN, WHO MAY DROP IN ON A CALL, AND THE GUARDIAN SET. Pure; tested alone.

Mike's rulings of 2026-10-12 (DECISIONS.md, "Mike's answers of 2026-10-12"; notes BS and BT):

  * A CALL WAITS FOR SOMEBODY TO ANSWER, BY DEFAULT. This changes the 2026-08-29 decision (a call answered by itself
    after a ten-second countdown). Answering by itself - "drop in" - is a permission given to NAMED people on a screen.
    "Who may drive" lets somebody CALL; it never lets a call answer by itself.
  * "WHO MAY SEE THIS SCREEN" IS ITS OWN LIST, EMPTY TO START, WITH "ASK FIRST" ON BY DEFAULT. Somebody on the list who
    starts seeing (watch along, row 2.79) makes the screen ask; if nobody answers, the seeing does not start - which is
    inaction, never a blocked screen (CLAUDE.md's gate test: the ask never stops what is playing and goes by itself).
  * THE GUARDIAN SET is a named bundle of the separate permissions - see without asking, drop in, drive - each still
    changeable per person. Giving somebody the set changes their DEFAULTS; anything set by hand for them still wins.
    (links.py rule 5 said "there is no guardian concept... do not rebuild it without asking". Mike asked, and this is
    the shape that rule itself named: "a role with every permission switched on", not a second mechanism. Nothing here
    lets anybody act AS an account.)
  * A TEMPORARY PERMISSION GIVEN DURING A CALL ("let this caller see this screen until the call ends"), which also ends
    after a set time. In memory only (SeeAccess below): a server restart ends calls anyway, and a lend must never outlive
    the call it was given on.

Mike's rulings of 2026-10-13 and 2026-10-14 (DECISIONS.md "Mike's site-text answers and new rules (2026-10-13)", notes
BW and BX), added here:

  * A CALL IS ONLY A CALL. Being able to call grants NO drive and NO see. "May call" is its own permission: a CALL_ONLY
    grant (grants.py) lets somebody reach the screens without driving them, and "May call" on this list can switch
    calling off for anybody. Drive and see are separate grants a screen can LEND during a call (below).
  * BRINGING OTHER PEOPLE INTO A CALL IS A PERMISSION ("May bring others into a call", `bringOthers`): checked on the
    server where a group call grows (drive.py CallGroups, app.py), for every other screen already in the call.
  * HOW LONG A PERMISSION LENT ON A CALL LASTS has choices: until the call ends (the default), a set time (which still
    ends with the call), or "always" - for a caller with the guardian set only, and then it is a REAL grant (the list's
    "may see" tick, or a drive grant) the owner sees on the Remote page and anybody at the screen can take back.
  * THE ACCOUNT OWNER CONTROLS EVERY SCREEN ON THEIR OWN ACCOUNT BY DEFAULT, drop-in included (still changeable).

WHERE THE LIST LIVES: on the person's own row (person state, key `input-bindings`, the same row the intercom's approved
list and the note writers already live in - notes.PERSON_ROW_KEY). Only the person's owner can write that row (app.py
`owned_person` on person state), which is what makes it safe to read as a permission here. A permission is a SETTING,
not content (storage_line.py): a few names and switches, nothing about a body.

    screenPeople: [{ account, name, guardian?, see?, seeAsk?, dropIn?, call?, bringOthers?, intercom?, checkIn? }]

A switch that is not set (missing, or not a real true/false) takes its DEFAULT:

                         ordinary person         with the guardian set     the account that owns the person
    may see              no                      yes                       yes
    ask first            yes                     no                        no
    may drop in          no                      yes                       YES (2026-10-14, was no)
    may call             yes if they hold a      yes                       yes
                         live grant (any kind)
    may bring others     no                      yes                       yes
    may drive            a drive grant (grants.py), never this row - the guardian set's UI makes one; or lent on a call
    may use the intercom no (yes if on the      yes                       yes (2026-10-14, was no)
                         intercom's older list `intercomAllowed`) - its own permission, separate from calls
    may check in quietly no                      yes                       yes
                         (`checkIn`, 2026-10-14: the silent check-in, "like baby monitor mode" - may_check_in argues it)

WHY THE OWNER SEES WITHOUT ASKING BY DEFAULT (argued; on Mike's list): the owner set the screen up and can already
change every one of its settings, including this list - an ask they could switch off from the same page is a speed
bump, not a protection. Who wants the opposite? An adult who owns their own login and would like to be asked even about
their own other devices - they add themselves to the list with "ask first" ticked, and that wins.
WHY THE OWNER DROPS IN BY DEFAULT (Mike, 2026-10-14, note BX: "the account owner controls every screen on the account by
default"): the owner calling their own account's screen is the household calling itself. Who wants the opposite? An
owner whose screens are in somebody else's room (a parent's) and who would rather the call waited - they untick it.

WHY AN EXISTING DRIVE GRANT KEEPS THE RIGHT TO CALL (argued, on Mike's list). Until 2026-10-14 a drive grant WAS the
permission to call. Taking that away on the day the rule changed would silently cut off every family member who calls
today, on a screen somebody depends on, with nobody told. So "may call" DEFAULTS to yes for anybody holding a live grant
(a drive grant, or the new call-only one), and the Remote page shows it as a ticked "May call" the owner can untick.
The case for migrating instead (an explicit tick for each, so nothing is implied): cleaner on paper, but it is a write
to every person's row for no change anybody can see, and "nothing implied" is already true - the tick is visible.

THE OUTER WALL IS A GRANT. Watching along rides the drive socket, which only opens for the owner or somebody holding a
live grant (grants.may_reach: a drive grant, or since 2026-10-14 a call-only one). So "may see" here narrows who of
those may watch; it does not let anybody new in. Seeing with NO grant at all ("see-only") needs the socket to admit
see-only logins - after the bench swap (Mike, 2026-10-14), not built here.
"""
from __future__ import annotations

import re
import secrets
import time
from dataclasses import dataclass, field

LIST_FIELD = "screenPeople"
MAX_PEOPLE = 50                 # a bound on one row, not on anybody's family: nobody has fifty guardians
MAX_NAME = 60
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

# *** HOW LONG THE ASK STAYS ON THE SCREEN: 30 SECONDS BY DEFAULT (`seeAskSeconds` on the person's row). *** Argued:
# long enough for somebody in the room to notice a line at the edge of the screen and press Allow; short enough that a
# question nobody is there to answer is gone quickly, and the person asking is not left waiting long for a "no".
# For 60: a carer across the room. For 15: a screen in a busy room where a stray question is noise. A setting because
# the room is the household's; the choices are fixed so the screen and the server agree on the number.
ASK_CHOICES = (15, 30, 60)
ASK_DEFAULT_S = 30
ASK_FIELD = "seeAskSeconds"
# The server's own clock on an ask runs a little past the screen's, so the screen's "gone" always lands first and the
# person asking is never told "nobody answered" while the question is still showing.
ASK_GRACE_S = 3

# *** A "YES" OUTLASTS A DROPPED CONNECTION BY 2 MINUTES. *** Facility wifi drops; the follower's page reconnects by
# itself. Without this every reconnect would put the question on the screen again. Two minutes covers the page's own
# reconnect back-off (drive.js: 1, 2, 4, 8 s) many times over and is still short: somebody who stopped following and
# comes back later is asked again. Not a person's setting: nobody can judge it from a menu.
YES_GRACE_S = 120

# *** A PERMISSION LENT DURING A CALL: HOW LONG IT LASTS (Mike, 2026-10-13: "options, default the length of the call,
# plus an 'always' option for parents/guardians"). ***
#   "call"   - UNTIL THE CALL ENDS. The default. Ends at the call's bye, when the screen that lent it leaves, or - only for a
#              call whose end the server never hears - after MAX_LEND_MIN (4 hours, the backstop; argued: the server does
#              hear a bye or a socket closing in every ordinary case, so this only bounds a lost one).
#   minutes  - A SET TIME (15, 30, 60, 120 offered), WHICH STILL ENDS WITH THE CALL: a shorter leash inside the call, never
#              longer than it. Argued: a set time that OUTLIVED the call would leave somebody seeing or pressing a screen
#              after everybody hung up, with no call card left on the screen to stop it from. The case for letting it
#              outlive the call: a helper who hangs up and keeps fixing something. That wants a notice with Stop on the
#              screen after the call - a later step, on Mike's list, not smuggled in here.
#   "always" - A REAL GRANT, for a caller with the GUARDIAN SET only (below). Not held here: written where every other
#              standing permission lives (the list's "may see", or a drive grant), so it is seen and taken back there.
# `lendLength` on the person's row picks which one the screen offers first ("call" unless somebody chose otherwise).
# `lendMinutes` (the old "at most N minutes") is still honoured from an older page: a lend with minutes and no length is a
# set time that ends with the call - exactly what it always was.
LEND_CHOICES = (15, 30, 60, 120)
LEND_DEFAULT_MIN = 60
LEND_FIELD = "lendMinutes"
LENGTH_FIELD = "lendLength"
LENGTH_DEFAULT = "call"
MAX_LEND_MIN = 240
LEND_WHAT = frozenset({"see", "drive"})
LENGTHS = frozenset({"call", "time", "always"})

# WHY "ALWAYS" IS FOR GUARDIANS ONLY, AND WHAT IT WRITES (argued, on Mike's list). "Always" pressed on a screen in the
# middle of a call is a standing permission given by whoever is in front of that screen, to whoever is on the call. For
# a household's own adult that is their right; for somebody who cannot weigh it, a call is exactly where they could be
# talked into it. The guardian set is the owner's own statement "this person may do everything", made on the Remote page
# - so "always" is offered for those callers and refused for everybody else, who are given "always" on the Remote page by
# the owner. With the set's defaults a guardian already sees without asking and holds a drive grant, so "always" mostly
# RESTORES what somebody narrowed by hand (a see turned off, a drive grant taken back); it writes it explicitly:
#   see   -> their line on the list: see: true, seeAsk: false
#   drive -> a drive grant "as long as I allow it" (label ALWAYS_LABEL), made only when they hold no live one
# Taking it back from the screen writes see: false, or removes their live drive grants on this person - the person at the
# screen can take back what was given there; the owner sees both on the Remote page.
ALWAYS_LABEL = "always, given on a call"


def clean_name(raw) -> str:
    s = _CONTROL.sub("", str(raw or "")).strip()
    return s[:MAX_NAME]


def entries_from(row: dict | None) -> dict[str, dict]:
    """The list on a person's row, account -> entry. PURE. Anything malformed is ignored rather than trusted:
    a switch that is not a real true/false is treated as not set (its default), never as yes."""
    raw = (row or {}).get(LIST_FIELD) if isinstance(row, dict) else None
    out: dict[str, dict] = {}
    if not isinstance(raw, list):
        return out
    for e in raw[:MAX_PEOPLE]:
        if not isinstance(e, dict):
            continue
        a = e.get("account")
        if not isinstance(a, str) or not a.strip() or a.strip() in out:
            continue
        a = a.strip()
        ent = {"account": a, "name": clean_name(e.get("name"))}
        for k in SWITCHES:
            if isinstance(e.get(k), bool):
                ent[k] = e[k]
        out[a] = ent
    return out


SWITCHES = ("guardian", "see", "seeAsk", "dropIn", "call", "bringOthers", "intercom", "checkIn")


def perms_for(row: dict | None, account: str, owner: str | None, *, reach: bool = False) -> dict:
    """What `account` may do on this person's screens, from the row alone (plus `reach`: they hold a live grant of any
    kind - app.py knows, this file does not read grants). PURE.

    {guardian, see, ask_first, drop_in, call, bring_others, intercom, check_in, listed}. A person with no owner does not
    exist, and is indistinguishable from one you may do nothing on (the same anti-oracle rule as grants.may_drive)."""
    none = {"guardian": False, "see": False, "ask_first": True, "drop_in": False, "call": False,
            "bring_others": False, "intercom": False, "check_in": False, "listed": False}
    if not account or not owner:
        return none
    is_owner = account == owner
    ent = entries_from(row).get(account)
    if ent is None:
        if is_owner:
            return {"guardian": False, "see": True, "ask_first": False, "drop_in": True, "call": True,
                    "bring_others": True, "intercom": True, "check_in": True, "listed": False}
        return {**none, "call": bool(reach), "intercom": _on_intercom_list(row, account)}
    g = ent.get("guardian") is True
    return {
        "guardian": g,
        "see": ent["see"] if "see" in ent else (g or is_owner),
        "ask_first": ent["seeAsk"] if "seeAsk" in ent else not (g or is_owner),
        "drop_in": ent["dropIn"] if "dropIn" in ent else (g or is_owner),
        "call": ent["call"] if "call" in ent else (g or is_owner or bool(reach)),
        "bring_others": ent["bringOthers"] if "bringOthers" in ent else (g or is_owner),
        "intercom": ent["intercom"] if "intercom" in ent else (g or is_owner or _on_intercom_list(row, account)),
        "check_in": ent["checkIn"] if "checkIn" in ent else (g or is_owner),
        "listed": True,
    }


INTERCOM_LIST_FIELD = "intercomAllowed"     # the intercom's own list (row 2.44, intercom.js), older than this one


def _on_intercom_list(row, account: str) -> bool:
    raw = (row or {}).get(INTERCOM_LIST_FIELD) if isinstance(row, dict) else None
    return isinstance(raw, list) and any(isinstance(e, dict) and e.get("account") == account for e in raw)


def may_intercom(row: dict | None, account: str, owner: str | None, *, reach: bool) -> bool:
    """MAY USE THE INTERCOM (Mike, 2026-10-13: "handled like a call, with its own permission separate from calls").
    PURE. Who wants it by default, argued:
      * THE OWNER - yes (2026-10-14, "the account owner controls every screen on the account by default"; and Mike's
        "any device in someone's household can announce something": the household's own devices are the owner's login).
        Until now the owner had to tick themselves; an owner who would rather not (a screen in somebody else's room)
        unticks it.
      * THE GUARDIAN SET - yes: the set is "every permission switched on", and a guardian may already drop in on a VIDEO
        call; the intercom is sound only by default. Unticked per person like everything else in the set.
      * ANYBODY ELSE - only when ticked: the intercom's own older list (`intercomAllowed`) still counts as ticked, so
        nobody already approved loses it, and an explicit untick on this list wins over it.
    Like a call, it needs a socket: the owner, or a live grant of any kind."""
    if not account or not owner:
        return False
    if account != owner and not reach:
        return False
    return perms_for(row, account, owner, reach=reach).get("intercom") is True


def may_call(row: dict | None, account: str, owner: str | None, *, reach: bool) -> bool:
    """May `account` ring this person's screens? The owner, or somebody who can reach them (a live grant) and whose
    "May call" is not switched off. PURE. A guardian with no grant at all cannot open a socket, so cannot call."""
    if not account or not owner:
        return False
    if account != owner and not reach:
        return False
    return perms_for(row, account, owner, reach=reach)["call"] is True


def may_check_in(row: dict | None, account: str, owner: str | None, *, reach: bool) -> bool:
    """MAY CHECK IN QUIETLY (Mike, 2026-10-13: "a silent check-in, 'like baby monitor mode', where by default the screen
    still shows who is checking in"; client/checkin.js has the whole design). A one-way look and/or listen into the
    room: nothing rings, nothing is heard in the room, and the screen shows who is checking in the whole time. PURE.
    ITS OWN PERMISSION, like the intercom - being able to call gives no check-in, and a check-in gives no call. Who has it
    by default, argued:
      * THE OWNER - yes ("the account owner controls every screen on the account by default", 2026-10-14): the household
        looking in on its own room. Who wants the opposite? An owner whose screens are in someone else's room (a
        parent's, a grown child's) who would rather nobody could look in unannounced - they untick themselves.
      * THE GUARDIAN SET - yes: the set is "every permission switched on", and a guardian may already drop in on a VIDEO
        call (which opens the room's camera after a countdown with no press). A check-in is that, minus the ring and
        minus anything the room hears. Who wants the opposite? A family where the guardian is the one to call, not the
        one to watch - they untick it on that person's line.
      * ANYBODY ELSE - NO until ticked. A silent look into somebody's room is the most private thing on this list; an
        ordinary caller (a friend, a therapist with a call-only grant) does not get it by being able to call.
    Like a call, it needs a socket: the owner, or a live grant of any kind. Fails closed (no owner, no account: no)."""
    if not account or not owner:
        return False
    if account != owner and not reach:
        return False
    return perms_for(row, account, owner, reach=reach).get("check_in") is True


def with_switches(row: dict | None, account: str, name: str = "", **switches) -> list:
    """The list on `row` with `account`'s switches set (added to the list if absent). PURE: returns a new list in the
    row's own shape, for "always" written from a call. Only real switches and real true/false are written."""
    raw = (row or {}).get(LIST_FIELD) if isinstance(row, dict) else None
    out = [dict(e) for e in (raw if isinstance(raw, list) else [])[:MAX_PEOPLE] if isinstance(e, dict)]
    ent = next((e for e in out if e.get("account") == account), None)
    if ent is None:
        if len(out) >= MAX_PEOPLE:
            return out
        ent = {"account": account, "name": clean_name(name) or account.split("@")[0]}
        out.append(ent)
    for k, v in switches.items():
        if k in SWITCHES and isinstance(v, bool):
            ent[k] = v
    return out


def may_bring_others(row: dict | None, account: str, owner: str | None) -> bool:
    """May `account` bring other people into a call this person's screen is on? PURE."""
    return perms_for(row, account, owner)["bring_others"] is True


def name_for(row: dict | None, account: str) -> str:
    """The name the owner gave somebody on the list, or ''. The screen shows THIS, never what a page says."""
    ent = entries_from(row).get(account)
    return ent["name"] if ent else ""


def _choice(row, key, choices, default):
    v = (row or {}).get(key) if isinstance(row, dict) else None
    if isinstance(v, bool):
        return default
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return n if n in choices and n == v else default


def ask_seconds(row: dict | None) -> int:
    return _choice(row, ASK_FIELD, ASK_CHOICES, ASK_DEFAULT_S)


def lend_minutes(row: dict | None, asked=None) -> int:
    """The temporary permission's length: what the screen asked for if it is a whole number of minutes in range,
    else the row's choice, else the default. Never more than MAX_LEND_MIN."""
    if isinstance(asked, int) and not isinstance(asked, bool) and 1 <= asked <= MAX_LEND_MIN:
        return asked
    return _choice(row, LEND_FIELD, LEND_CHOICES, LEND_DEFAULT_MIN)


def lend_length(row: dict | None):
    """The length the screen offers first: "call" (the default), "always", or one of LEND_CHOICES minutes. PURE."""
    v = (row or {}).get(LENGTH_FIELD) if isinstance(row, dict) else None
    if v in ("call", "always"):
        return v
    if isinstance(v, int) and not isinstance(v, bool) and v in LEND_CHOICES:
        return v
    return LENGTH_DEFAULT


def see_decision(row: dict | None, account: str, owner: str | None, *, lent: bool = False,
                 recent_yes: bool = False) -> tuple[str, str]:
    """('admit' | 'ask' | 'refuse', why). PURE - the whole rule for somebody who starts seeing.

    why: 'lent' (a temporary permission on a call), 'owner', 'list' (on the list, not asked), 'yes' (said yes a moment
    ago), 'ask', or 'not-allowed'."""
    if not account or not owner:
        return "refuse", "not-allowed"
    if lent:
        return "admit", "lent"
    p = perms_for(row, account, owner)
    if not p["see"]:
        return "refuse", "not-allowed"
    if not p["ask_first"]:
        return "admit", "owner" if account == owner and not p["listed"] else "list"
    if recent_yes:
        return "admit", "yes"
    return "ask", "ask"


# ---------------------------------------------------------------------------------------------- the wire
ANSWER_ID_LEN = 12          # hex


def _id_ok(s) -> bool:
    return isinstance(s, str) and len(s) == ANSWER_ID_LEN and all(c in "0123456789abcdef" for c in s)


def parse_see_answer(raw: dict) -> dict | None:
    """`{type: see-answer, ask, yes}` from a SCREEN. Only the two fields; anything else is dropped. PURE."""
    if not isinstance(raw, dict) or not _id_ok(raw.get("ask")) or not isinstance(raw.get("yes"), bool):
        return None
    return {"type": "see-answer", "ask": raw["ask"], "yes": raw["yes"]}


def _minutes_ok(m) -> bool:
    return isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= MAX_LEND_MIN


def parse_lend(raw: dict) -> dict | None:
    """`{type: lend, what, session, on, length?, minutes?}` from a SCREEN. PURE. The account it is lent to is never taken
    from the page: it is the account that placed that call, as the server recorded it.

    `length`: "call" | "always" | a whole number of minutes. Out comes `length` as "call" | "time" | "always" (with
    `minutes` for "time"). No `length` (an older page): `minutes` alone is a set time ending with the call, and nothing
    at all is "until the call ends"."""
    from drive import _session_ok    # the same session rule as a call's (local import: drive imports this file)
    if not isinstance(raw, dict):
        return None
    what, session, on = raw.get("what"), raw.get("session"), raw.get("on")
    if what not in LEND_WHAT or not _session_ok(session) or not isinstance(on, bool):
        return None
    out = {"type": "lend", "what": what, "session": session, "on": on}
    ln, m = raw.get("length"), raw.get("minutes")
    if ln == "always":
        out["length"] = "always"
    elif ln == "call":
        out["length"] = "call"
    elif _minutes_ok(ln):
        out["length"], out["minutes"] = "time", ln
    elif ln is not None:
        return None                     # a length nobody offers: not trusted as anything
    elif _minutes_ok(m):
        out["length"], out["minutes"] = "time", m
    else:
        out["length"] = "call"
    return out


# ---------------------------------------------------------------------------------------------- the state
@dataclass
class _Ask:
    aid: str
    room: tuple
    conn: object                 # the driver socket waiting to see
    account: str
    name: str
    seconds: int
    deadline: float


@dataclass
class _Lend:
    room: tuple
    session: str
    account: str
    screen: object               # the screen that answered the call and lent it
    until: float
    wall_until_ms: int = 0
    what: str = "see"            # "see" | "drive" (2026-10-14)
    length: str = "call"         # "call" | "time" - both end with the call; "always" is never held here


@dataclass
class _Follower:
    room: tuple
    account: str
    name: str
    via: str


@dataclass
class SeeAccess:
    """Asks waiting for an answer, recent yeses, temporary permissions, and who is seeing by which way. In memory.

    PURE like drive.py's CallGroups: every method returns a list of (connection, message) for app.py to send, so all of
    it is tested without a socket (test_screen_access.py), then once more through the real socket. `room` is app.py's
    (owner, person_id); `conn` is any object - only its identity is used."""
    now: object = time.monotonic
    wall: object = (lambda: time.time() * 1000.0)
    asks: dict = field(default_factory=dict)          # aid -> _Ask
    yes: dict = field(default_factory=dict)           # (room, account) -> None while seeing | expiry after
    lends: dict = field(default_factory=dict)         # (room, session) -> _Lend
    followers: dict = field(default_factory=dict)     # id(conn) -> _Follower

    # ---- asking ------------------------------------------------------------------------------------------------
    def open_ask(self, conn, room, account: str, name: str, seconds: int, screens) -> tuple[str, list]:
        """Put the question on every screen of the person. Returns (ask id, out). The driver is told it is asking."""
        aid = secrets.token_hex(ANSWER_ID_LEN // 2)
        a = _Ask(aid=aid, room=room, conn=conn, account=account, name=name, seconds=int(seconds),
                 deadline=self.now() + int(seconds) + ASK_GRACE_S)
        self.asks[aid] = a
        out = [(s, self._ask_msg(a)) for s in (screens or [])]
        out.append((conn, {"type": "follow-state", "state": "asking", "seconds": a.seconds}))
        return aid, out

    def _ask_msg(self, a: _Ask) -> dict:
        left = max(1, int(round(a.deadline - ASK_GRACE_S - self.now())))
        return {"type": "see-ask", "ask": a.aid, "name": a.name, "seconds": min(a.seconds, left)}

    def asking(self, conn) -> bool:
        return any(a.conn is conn for a in self.asks.values())

    def answer(self, room, aid: str, yes: bool, screens) -> tuple[object | None, list]:
        """A screen's answer. The FIRST answer decides; the others are told it is gone. Returns (driver conn if the
        answer was a yes, out). An answer for another person's ask, or one already decided, does nothing."""
        a = self.asks.get(aid)
        if a is None or a.room != room:
            return None, []
        self.asks.pop(aid, None)
        out = [(s, {"type": "see-ask-ended", "ask": aid}) for s in (screens or [])]
        if not yes:
            out.append((a.conn, {"type": "follow-state", "state": "refused", "reason": "declined"}))
            return None, out
        self.yes[(room, a.account)] = None
        return a.conn, out

    def withdraw(self, conn, screens_of) -> list:
        """The driver stopped asking (closed, or said follow off): the question goes from the screens."""
        out = []
        for aid, a in list(self.asks.items()):
            if a.conn is conn:
                self.asks.pop(aid, None)
                out += [(s, {"type": "see-ask-ended", "ask": aid}) for s in (screens_of(a.room) or [])]
        return out

    def pending_for(self, room) -> list[dict]:
        """A screen that joins mid-ask is shown the questions still open for its person."""
        return [self._ask_msg(a) for a in self.asks.values() if a.room == room]

    def recent_yes(self, room, account: str) -> bool:
        if (room, account) not in self.yes:
            return False
        until = self.yes[(room, account)]
        if until is None or until > self.now():
            return True
        self.yes.pop((room, account), None)
        return False

    # ---- lending -----------------------------------------------------------------------------------------------
    def lend(self, room, session: str, account: str, screen, minutes: int, *, what: str = "see",
             length: str = "call") -> dict:
        """Lend `what` to the call's caller. `minutes`: the set time, or the backstop for "until the call ends"."""
        until = self.now() + minutes * 60
        wall_until = int(self.wall() + minutes * 60 * 1000)
        self.lends[(room, session, what)] = _Lend(room=room, session=session, account=account, screen=screen,
                                                  until=until, wall_until_ms=wall_until, what=what, length=length)
        return {"type": "lend-state", "what": what, "session": session, "on": True, "until": wall_until,
                "minutes": minutes, "length": length}

    def lent(self, room, account: str, what: str = "see") -> bool:
        now = self.now()
        return any(l.room == room and l.account == account and l.what == what and l.until > now
                   for l in self.lends.values())

    def end_lend(self, room, session: str, what: str | None = None) -> list[tuple]:
        """The call ended (`what` None: everything lent on it), or the screen took one back. Returns [(room, account)]
        whose lend went. Every length ends with the call: a set time is a shorter leash INSIDE the call."""
        gone = []
        for k in [k for k in self.lends if k[0] == room and k[1] == session and (what is None or k[2] == what)]:
            l = self.lends.pop(k)
            gone.append((l.room, l.account))
        return gone

    def screen_left(self, conn) -> list[tuple]:
        """The screen that lent it closed: the call it was lent on is over for that screen."""
        gone = []
        for k, l in list(self.lends.items()):
            if l.screen is conn:
                self.lends.pop(k, None)
                gone.append((l.room, l.account))
        return gone

    # ---- who is seeing, and by which way ----------------------------------------------------------------------
    def seeing(self, conn, room, account: str, name: str, via: str) -> None:
        self.followers[id(conn)] = _Follower(room=room, account=account, name=name, via=via)
        if via == "yes":
            self.yes[(room, account)] = None        # held open while they see; YES_GRACE_S starts when they stop

    def follower(self, conn) -> _Follower | None:
        return self.followers.get(id(conn))

    def names(self, room, conns) -> list[str]:
        """The names of the people seeing this person's screens: what "Sharing your screen with ..." says.
        A follower with no name the owner gave and no display name is left out - the screen then says "someone"."""
        out = []
        for c in conns or []:
            f = self.followers.get(id(c))
            if f and f.room == room and f.name and f.name not in out:
                out.append(f.name)
        return out

    def stopped(self, conn) -> None:
        """A follower stopped (closed, or follow off). A yes it rode on lasts YES_GRACE_S more, for a reconnect."""
        f = self.followers.pop(id(conn), None)
        if f is None:
            return
        key = (f.room, f.account)
        if key in self.yes and self.yes[key] is None and not any(
                o.room == f.room and o.account == f.account for o in self.followers.values()):
            self.yes[key] = self.now() + YES_GRACE_S

    def lent_followers(self, room, account: str, conns) -> list:
        """The sockets seeing ONLY because of a lend to `account` - the ones to stop when the lend ends."""
        return [c for c in conns or [] if (f := self.followers.get(id(c))) and f.room == room
                and f.account == account and f.via == "lent"]

    # ---- the clock ----------------------------------------------------------------------------------------------
    def sweep(self, screens_of) -> tuple[list, list[tuple]]:
        """Asks past their time, lends past theirs, yeses past their grace. Returns (out, [(room, account)] lends gone)."""
        now = self.now()
        out = []
        for aid, a in list(self.asks.items()):
            if a.deadline <= now:
                self.asks.pop(aid, None)
                out += [(s, {"type": "see-ask-ended", "ask": aid}) for s in (screens_of(a.room) or [])]
                out.append((a.conn, {"type": "follow-state", "state": "refused", "reason": "unanswered"}))
        gone = []
        for k, l in list(self.lends.items()):
            if l.until <= now:
                self.lends.pop(k, None)
                gone.append((l.room, l.account))
                out.append((l.screen, {"type": "lend-state", "what": l.what, "session": l.session, "on": False,
                                       "reason": "time"}))
        for k, until in list(self.yes.items()):
            if until is not None and until <= now:
                self.yes.pop(k, None)
        return out, gone

    def next_due(self) -> float | None:
        """Seconds until the next thing this holds comes due (an ask or a lend), or None. For app.py's timer."""
        times = [a.deadline for a in self.asks.values()] + [l.until for l in self.lends.values()]
        return max(0.0, min(times) - self.now()) if times else None

    def __len__(self) -> int:
        return len(self.asks) + len(self.lends) + len(self.followers)
