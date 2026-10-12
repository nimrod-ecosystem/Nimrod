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

WHERE THE LIST LIVES: on the person's own row (person state, key `input-bindings`, the same row the intercom's approved
list and the note writers already live in - notes.PERSON_ROW_KEY). Only the person's owner can write that row (app.py
`owned_person` on person state), which is what makes it safe to read as a permission here. A permission is a SETTING,
not content (storage_line.py): a few names and switches, nothing about a body.

    screenPeople: [{ account, name, guardian?, see?, seeAsk?, dropIn? }]

A switch that is not set (missing, or not a real true/false) takes its DEFAULT:

                         ordinary person     with the guardian set     the account that owns the person
    may see              no                  yes                       yes
    ask first            yes                 no                        no
    may drop in          no                  yes                       no
    may drive            a drive grant (grants.py), never this row - the guardian set's UI makes one

WHY THE OWNER SEES WITHOUT ASKING BY DEFAULT (argued; on Mike's list): the owner set the screen up and can already
change every one of its settings, including this list - an ask they could switch off from the same page is a speed
bump, not a protection. Who wants the opposite? An adult who owns their own login and would like to be asked even about
their own other devices - they add themselves to the list with "ask first" ticked, and that wins. WHY THE OWNER DOES
NOT DROP IN BY DEFAULT: the ruling is "a call waits by default" for everybody; the owner ticks it for themselves.

THE OUTER WALL STAYS THE DRIVE GRANT. Watching along rides the drive socket, which only opens for somebody who may
drive (grants.may_drive). So "may see" here narrows who of those may watch; it does not let anybody new in. Seeing
WITHOUT being allowed to drive needs the socket to admit see-only logins as watch-only - a real, separate step, on
Mike's list rather than smuggled in here.
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

# *** THE TEMPORARY PERMISSION: 60 MINUTES BY DEFAULT (`lendMinutes` on the person's row), and it ends with the call
# whichever comes first. *** Argued: it is for a helper on a call ("let me see what you are seeing"), and a call that
# needs the helper to see the screen rarely runs past an hour; ending with the call is the real limit and the time is
# the backstop for a call that somehow never says it ended. For 15 or 30: a shorter leash for somebody less trusted.
# For 120: a long support session. MAX_LEND_MIN bounds whatever a page sends.
LEND_CHOICES = (15, 30, 60, 120)
LEND_DEFAULT_MIN = 60
LEND_FIELD = "lendMinutes"
MAX_LEND_MIN = 240
LEND_WHAT = frozenset({"see"})      # see below: "drive" is argued out today, not forgotten

# WHY THE TEMPORARY PERMISSION IS "SEE" ONLY (pushback, on Mike's list). Mike asked for "drive / see". But a call can
# only be placed by somebody who may already drive the screen (ruling 3: "who may drive" allows calling - the drive
# ticket is the call's door). So every caller ALREADY may drive; a temporary "drive" would grant nothing. The moment
# calls get a permission of their own (links.py `call_video`), "drive" belongs in LEND_WHAT and the rest of this file
# already carries it.


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
        for k in ("guardian", "see", "seeAsk", "dropIn"):
            if isinstance(e.get(k), bool):
                ent[k] = e[k]
        out[a] = ent
    return out


def perms_for(row: dict | None, account: str, owner: str | None) -> dict:
    """What `account` may do on this person's screens, from the row alone. PURE.

    {guardian, see, ask_first, drop_in, listed}. A person with no owner does not exist, and is indistinguishable from
    one you may do nothing on (the same anti-oracle rule as grants.may_drive)."""
    none = {"guardian": False, "see": False, "ask_first": True, "drop_in": False, "listed": False}
    if not account or not owner:
        return none
    ent = entries_from(row).get(account)
    if ent is None:
        if account == owner:
            return {"guardian": False, "see": True, "ask_first": False, "drop_in": False, "listed": False}
        return none
    g = ent.get("guardian") is True
    is_owner = account == owner
    return {
        "guardian": g,
        "see": ent["see"] if "see" in ent else (g or is_owner),
        "ask_first": ent["seeAsk"] if "seeAsk" in ent else not (g or is_owner),
        "drop_in": ent["dropIn"] if "dropIn" in ent else g,
        "listed": True,
    }


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


def parse_lend(raw: dict) -> dict | None:
    """`{type: lend, what, session, on, minutes?}` from a SCREEN. PURE. The account it is lent to is never taken from
    the page: it is the account that placed that call, as the server recorded it."""
    from drive import _session_ok    # the same session rule as a call's (local import: drive imports this file)
    if not isinstance(raw, dict):
        return None
    what, session, on = raw.get("what"), raw.get("session"), raw.get("on")
    if what not in LEND_WHAT or not _session_ok(session) or not isinstance(on, bool):
        return None
    out = {"type": "lend", "what": what, "session": session, "on": on}
    m = raw.get("minutes")
    if isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= MAX_LEND_MIN:
        out["minutes"] = m
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
    def lend(self, room, session: str, account: str, screen, minutes: int) -> dict:
        until = self.now() + minutes * 60
        wall_until = int(self.wall() + minutes * 60 * 1000)
        self.lends[(room, session)] = _Lend(room=room, session=session, account=account, screen=screen,
                                            until=until, wall_until_ms=wall_until)
        return {"type": "lend-state", "what": "see", "session": session, "on": True, "until": wall_until,
                "minutes": minutes}

    def lent(self, room, account: str) -> bool:
        now = self.now()
        return any(l.room == room and l.account == account and l.until > now for l in self.lends.values())

    def end_lend(self, room, session: str) -> list[tuple]:
        """The call ended, or the screen took it back. Returns [(room, account)] whose lend went."""
        l = self.lends.pop((room, session), None)
        return [(l.room, l.account)] if l else []

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
                out.append((l.screen, {"type": "lend-state", "what": "see", "session": l.session, "on": False,
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
