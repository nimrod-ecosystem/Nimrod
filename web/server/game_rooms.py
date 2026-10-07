"""game_rooms.py - PLAYING TOGETHER FROM MORE THAN ONE SCREEN: a game room held in this process.

Mike, 2026-10-06: *"There should be multiplayer that you can play local, online or over calls."* Local play
(several people taking turns on one screen) shipped with Quiz mix (bebe5b8). This is the other two: a room
that several screens join, so each player answers on their own screen, and the same room offered to the
person on the other end of a call.

WHAT THE ROOM IS. A code, a HOST device (the screen that opened it), the SEATS (each seat belongs to exactly
one device), the host's view of the game (round, whose turn, the table), and the one turn that is out at a
remote seat right now. ONLY THE HOST CHANGES THE GAME. Every other device can do three things: ask to join,
answer the turn the host gave one of ITS OWN seats, and leave.

*** NO PERSON'S LEVELS CROSS LOGINS. *** Each device deals its own seats' questions off its own login's
ladders and judges them there, and sends back exactly {seat, category, right, points}. The room never holds a
question, an answer, a rating or a level - so another login's screen cannot read them, and nothing here can
write another login's records (claims.state_target's rule: a screen never writes another login's rows).

WHY A SOCKET OF ITS OWN AND NOT THE DRIVE SOCKET (the brief said the drive socket; argued, both ways):
  FOR the drive socket: one connection per screen instead of two; it already authenticates, reconnects and
    carries the call's signalling.
  AGAINST, and it decides it: the drive socket's door is `grants.may_drive` - "may this login PRESS BUTTONS on
    this person's screens". A friend connected through `links.py` is not, and should not be, allowed that. To
    play a quiz with them over the drive socket they would need a drive grant, which hands them the screen's
    controls. A game door that requires a control grant is a security regression dressed as reuse. So this
    socket has its own door (signed in, any login), and WHO MAY JOIN WHICH ROOM is decided here, per room.
  AND IT MAKES "never a control press" STRUCTURAL rather than a rule somebody must remember: this handler
    holds no reference to the drive rooms' screens and no path to a verb or a bus topic. The ONE thing it
    puts on the drive socket is a server-built invitation to the people on a call (below), sent only to the
    DRIVERS of that person's room - the callers - never to a screen.
  The drive socket's discipline is copied, not loosened: a fixed list of message kinds, every field checked
  and copied (never relayed as given), a size cap measured before parsing, a per-connection rate limit, and
  rooms cleaned up on their own.

WHO MAY JOIN A ROOM (`relation`, supplied by app.py so this file stays pure):
  * 'same'       the same login (another of your own screens, your phone): joins by code at once.
  * 'connected'  a login connected to the host's through links.py (a friend, family): by code, and the host
                 sees who wants in and lets them in - unless the room says "anyone connected may join".
  * 'call'       a login that may use the screens of the person a CALL room was opened for (the people who
                 can call that screen at all - the same door the call page uses): joins at once. Argued: the
                 screen opening "on this call" IS the invitation, and the person at that screen may be unable
                 to press "Let them in" - a call game that needed that press would not work for them.
  * anybody else: refused, with exactly the words used for a code that does not exist, so the code space
    cannot be used to find out which rooms are real. Wrong codes are also counted per login and throttled.

THE WAITING STATES END BY THEMSELVES. A screen must never enter a state that only an input can leave when the
person in front of it cannot give that input (CLAUDE.md). Every wait here has a clock on the server, and the
client keeps its own backstop for a server it can no longer hear:
  a join nobody answers (ADMIT_WAIT_S), a host that dropped and did not come back (HOST_GONE_S), a seat whose
  screen dropped on its turn (SEAT_AWAY_S), a turn nobody answers (TURN_MAX_S), a device gone for good
  (DEVICE_GONE_S), a room nobody touches (ROOM_IDLE_S) and any room at all (ROOM_MAX_S).

IN-MEMORY, AND THEREFORE SINGLE-INSTANCE - exactly drive.py's honest limit, for the same reason: on one Render
web service that is correct; two instances need Redis pub/sub, not a bigger dict. Nothing is written to the
database, so there is nothing new to list on the privacy page.

PURE: no I/O. Every method returns an OUTBOX - a list of (target, payload) - and app.py does the sending. A
target is a connection object (only its identity is used) or ("call", person_id): the drivers of that
person's drive room.
"""

from __future__ import annotations

import json
import re
import secrets
import time
from collections import deque
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------------------------------
# WHAT MAY CROSS THE WIRE
# ---------------------------------------------------------------------------------------------------
# The kinds a device may SEND. Mirrored in game_room.js, and duplicated rather than shared, for the reason
# drive.py gives for its verbs: a boundary that widens because another file grew an entry is not a boundary.
GAME_KINDS = frozenset({"room", "join", "admit", "turn", "answer", "leave", "ping"})
# The games a room may be for. One today.
GAMES = frozenset({"quiz_mix"})
ADMIT_MODES = frozenset({"ask", "connected"})
PHASES = frozenset({"lobby", "playing", "done"})

# 4 KB, measured on the raw text BEFORE it is parsed. The largest legitimate message is the host's table for
# four seats with a sixty-character category - a few hundred bytes. Without a cap the room is a broadcast pipe.
MAX_GAME_BYTES = 4096
# = adaptive_play.js MAX_PLAYERS: a game's turn order holds four, wherever the four are sitting.
MAX_SEATS = 4
MAX_WAITING = 6            # asking to join at once; a family is a handful, a loop is hundreds
MAX_NAME = 40
MAX_LABEL = 60
MAX_POINTS = 3             # question_pick.js turnPoints: 1 + round(2 x (1 - chance)), at most 3

# A code people read off a screen and type: no I/L/1, no O/0. 31^6 is about 887 million, and a code alone
# is not a key (the join door above still applies).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 6

# ---------------------------------------------------------------------------------------------------
# THE CLOCKS (seconds), each argued
# ---------------------------------------------------------------------------------------------------
# A join waits this long for the host's yes or no: long enough for somebody to walk over to the screen,
# short enough that the asking screen is not left saying "waiting" through dinner.
ADMIT_WAIT_S = 120
# The host's socket dropped: the room waits this long for it to come back (facility wifi blips) before it
# closes and every other screen goes back to its own game.
HOST_GONE_S = 30
# A seat's screen dropped ON ITS TURN: the turn is skipped after this, so nobody waits on a dead screen.
SEAT_AWAY_S = 20
# A dropped screen that does not come back is taken out of the room (its seats too) after this.
DEVICE_GONE_S = 120
# A turn out at another screen and never answered is skipped after this. The longest time limit a player
# can set is 60 s (quiz_mix.js answerTime); with no limit set, a slow player still gets two and a half
# minutes - and the host can skip sooner by hand.
TURN_MAX_S = 150
# A room the host has not touched for this long (a lobby left open, a game abandoned) closes.
ROOM_IDLE_S = 30 * 60
# And no room lives longer than this, touched or not.
ROOM_MAX_S = 6 * 3600
# How often app.py's socket loops wake to run the clocks when nothing is arriving.
SWEEP_S = 5

# ---------------------------------------------------------------------------------------------------
# THE BOUNDS
# ---------------------------------------------------------------------------------------------------
MAX_ROOMS = 1000
MAX_ROOMS_PER_ACCOUNT = 3
# Per connection: four messages a second, bursts of twenty. A host sends one message per turn change; a
# guest one per answer. Anything near this is a loop.
RATE_PER_S = 4.0
RATE_BURST = 20
# Wrong or refused codes per login: ten in ten minutes, the same shape as the pairing-code throttle.
JOIN_MISSES = 10
JOIN_MISS_WINDOW_S = 600

_SEAT_RE = re.compile(r"^d\d{1,2}\.\d$")
_DEVICE_RE = re.compile(r"^d\d{1,2}$")
_WAITER_RE = re.compile(r"^w\d{1,4}$")
_GROUP_RE = re.compile(r"^[a-z]{1,16}$")
_CAT_RE = re.compile(r"^[a-z0-9:_.-]{1,64}$")
_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
_PERSON_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


# ---------------------------------------------------------------------------------------------------
# VALIDATION - pure; the rules here ARE the security story, so they are testable without a socket
# ---------------------------------------------------------------------------------------------------
def normalize_code(code) -> str | None:
    """'kx4-9pm' -> 'KX49PM'; None when it cannot be a code."""
    if not isinstance(code, str) or len(code) > 32:
        return None
    c = "".join(ch for ch in code.upper() if ch.isalnum())
    if len(c) != CODE_LEN or any(ch not in CODE_ALPHABET for ch in c):
        return None
    return c


def _is_int(v, lo: int, hi: int) -> bool:
    # bool is an int in Python; a `true` where a number belongs is not a number.
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def clean_name(s) -> str:
    """A seat's name as another screen will show it: printable characters only, trimmed, capped."""
    if not isinstance(s, str):
        return ""
    t = "".join(ch for ch in s if ch.isprintable())
    t = " ".join(t.split())
    return t[:MAX_NAME]


def _names(seats) -> list | None:
    if not isinstance(seats, list) or not (1 <= len(seats) <= MAX_SEATS):
        return None
    out = []
    for s in seats:
        raw = s.get("name") if isinstance(s, dict) else s
        out.append(clean_name(raw) or f"Player {len(out) + 1}")
    return out


def _category(c, *, label: bool = True) -> dict | None:
    if not isinstance(c, dict):
        return None
    g, i = c.get("group"), c.get("id")
    if not isinstance(g, str) or not _GROUP_RE.match(g) or not isinstance(i, str) or not _CAT_RE.match(i):
        return None
    out = {"group": g, "id": i}
    if label:
        lab = c.get("label", "")
        if not isinstance(lab, str):
            return None
        out["label"] = clean_name(lab[:4 * MAX_LABEL])[:MAX_LABEL]
    return out


def _state(st) -> dict | None:
    """The host's view of the game: what every screen in the room shows. Fields copied one by one."""
    if not isinstance(st, dict):
        return None
    phase = st.get("phase")
    if phase not in PHASES:
        return None
    out = {"phase": phase, "round": 0, "rounds": 0, "category": None, "turn": None, "totals": {}}
    if "round" in st:
        if not _is_int(st["round"], 0, 999):
            return None
        out["round"] = st["round"]
    if "rounds" in st:
        if not _is_int(st["rounds"], 0, 99):
            return None
        out["rounds"] = st["rounds"]
    if st.get("category") is not None:
        cat = _category(st["category"])
        if cat is None:
            return None
        out["category"] = cat
    if st.get("turn") is not None:
        if not isinstance(st["turn"], str) or not _SEAT_RE.match(st["turn"]):
            return None
        out["turn"] = st["turn"]
    tot = st.get("totals")
    if tot is not None:
        if not isinstance(tot, dict) or len(tot) > MAX_SEATS:
            return None
        for k, v in tot.items():
            if not isinstance(k, str) or not _SEAT_RE.match(k) or not _is_int(v, 0, 99999):
                return None
            out["totals"][k] = v
    return out


def parse_game(raw) -> dict | None:
    """One inbound frame, validated. Returns a CLEAN copy (only the fields named here), or None to drop it.

    The size is checked on the raw text before anything is parsed, because that is what crossed the wire.
    """
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            return None
    if not isinstance(raw, str) or len(raw) > MAX_GAME_BYTES or len(raw.encode("utf-8")) > MAX_GAME_BYTES:
        return None
    try:
        m = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    if not isinstance(m, dict):
        return None
    kind = m.get("kind")
    if not isinstance(kind, str) or kind not in GAME_KINDS:
        return None

    if kind == "ping":
        return {"kind": "ping"}

    if kind == "room":
        if "open" in m:
            o = m["open"]
            if not isinstance(o, dict) or o.get("game") not in GAMES:
                return None
            names = _names(o.get("seats"))
            admit = o.get("admit", "ask")
            person = o.get("person")
            if names is None or admit not in ADMIT_MODES:
                return None
            if person is not None and (not isinstance(person, str) or not _PERSON_RE.match(person)):
                return None
            return {"kind": "room", "open": {"game": o["game"], "seats": names, "admit": admit, "person": person}}
        if "resume" in m:
            r = m["resume"]
            if not isinstance(r, dict):
                return None
            code, key = normalize_code(r.get("code")), r.get("key")
            if code is None or not isinstance(key, str) or not _KEY_RE.match(key):
                return None
            return {"kind": "room", "resume": {"code": code, "key": key}}
        out = {"kind": "room"}
        if "state" in m:
            st = _state(m["state"])
            if st is None:
                return None
            out["state"] = st
        if "admit" in m:
            if m["admit"] not in ADMIT_MODES:
                return None
            out["admit"] = m["admit"]
        return out if len(out) > 1 else None

    if kind == "join":
        code = normalize_code(m.get("code"))
        names = _names(m.get("seats"))
        if code is None or names is None:
            return None
        out = {"kind": "join", "code": code, "seats": names}
        key = m.get("key")
        if key is not None:
            if not isinstance(key, str) or not _KEY_RE.match(key):
                return None
            out["key"] = key
        return out

    if kind == "admit":
        w, yes = m.get("id"), m.get("yes")
        if not isinstance(w, str) or not _WAITER_RE.match(w) or not isinstance(yes, bool):
            return None
        return {"kind": "admit", "id": w, "yes": yes}

    if kind == "turn":
        seat, cat = m.get("seat"), _category(m.get("category"))
        if not isinstance(seat, str) or not _SEAT_RE.match(seat) or cat is None:
            return None
        if not _is_int(m.get("serial"), 0, 10 ** 9) or not _is_int(m.get("round", 0), 0, 999):
            return None
        return {"kind": "turn", "seat": seat, "serial": m["serial"], "round": m.get("round", 0), "category": cat}

    if kind == "answer":
        seat, cat = m.get("seat"), _category(m.get("category"), label=False)
        if not isinstance(seat, str) or not _SEAT_RE.match(seat) or cat is None:
            return None
        if not _is_int(m.get("serial"), 0, 10 ** 9) or not isinstance(m.get("right"), bool):
            return None
        if not _is_int(m.get("points"), 0, MAX_POINTS):
            return None
        # A wrong answer earns nothing: a screen claiming points for a miss is not believed.
        pts = m["points"] if m["right"] else 0
        return {"kind": "answer", "seat": seat, "serial": m["serial"], "category": cat, "right": m["right"], "points": pts}

    if kind == "leave":
        d = m.get("id")
        if d is None:
            return {"kind": "leave"}
        if not isinstance(d, str) or not (_DEVICE_RE.match(d) or _WAITER_RE.match(d)):
            return None
        return {"kind": "leave", "id": d}

    return None


# ---------------------------------------------------------------------------------------------------
# THE ROOMS
# ---------------------------------------------------------------------------------------------------
HOST = "d0"


@dataclass
class _Device:
    id: str
    conn: object
    account: str
    how: str                 # 'host' | 'same' | 'connected' | 'call'
    key: str
    seats: list
    away_since: float | None = None


@dataclass
class _Waiter:
    id: str
    conn: object
    account: str
    how: str
    names: list
    since: float
    frm: str


@dataclass
class _Room:
    code: str
    game: str
    host_account: str
    admit: str
    call_person: str | None
    created: float
    touched: float
    devices: dict = field(default_factory=dict)     # id -> _Device, in joining order (HOST first)
    seats: list = field(default_factory=list)       # [{id, name, device}], in turn order
    waiting: dict = field(default_factory=dict)     # id -> _Waiter
    state: dict = field(default_factory=lambda: {"phase": "lobby", "round": 0, "rounds": 0, "category": None,
                                                 "turn": None, "totals": {}})
    turn: dict | None = None                        # {seat, device, serial, round, category, since}
    held: list = field(default_factory=list)        # answers that arrived while the host was away
    next_dev: int = 1
    next_wait: int = 1


class GameRooms:
    """Every game room in this process.

    relation(account, host_account, call_person) -> 'same' | 'connected' | 'call' | None
    may_person(account, person_id) -> bool        may this login open a call room for that person
    name_of(account) -> str                       what a host sees for another login asking to join
    """

    def __init__(self, *, relation, may_person=lambda a, p: False, name_of=lambda a: "",
                 now=time.monotonic, code=None):
        self._relation = relation
        self._may_person = may_person
        self._name_of = name_of
        self._now = now
        self._code = code or (lambda: "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN)))
        self._rooms: dict[str, _Room] = {}
        self._where: dict = {}                     # conn -> (code, device id or waiter id)
        self._buckets: dict = {}                   # conn -> [tokens, last]
        self._misses: dict[str, deque] = {}
        self._last_sweep = 0.0

    # ---- bookkeeping ------------------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self._rooms)

    def connections(self) -> int:
        return len(self._where)

    def room(self, code: str) -> _Room | None:
        return self._rooms.get(code)

    def _rate_ok(self, conn) -> bool:
        now = self._now()
        b = self._buckets.get(conn)
        if b is None:
            b = self._buckets[conn] = [float(RATE_BURST), now]
        b[0] = min(float(RATE_BURST), b[0] + (now - b[1]) * RATE_PER_S)
        b[1] = now
        if b[0] < 1.0:
            return False
        b[0] -= 1.0
        return True

    def _missed(self, account: str) -> None:
        q = self._misses.setdefault(account, deque())
        q.append(self._now())

    def _throttled(self, account: str) -> bool:
        q = self._misses.get(account)
        if not q:
            return False
        cut = self._now() - JOIN_MISS_WINDOW_S
        while q and q[0] <= cut:
            q.popleft()
        if not q:
            self._misses.pop(account, None)
            return False
        return len(q) >= JOIN_MISSES

    def _view(self, room: _Room, dev_id: str) -> dict:
        v = {
            "kind": "room", "code": room.code, "game": room.game, "host": HOST, "you": dev_id,
            "seats": [{"id": s["id"], "name": s["name"], "device": s["device"],
                       "away": room.devices[s["device"]].away_since is not None} for s in room.seats],
            "state": room.state, "admit": room.admit, "call": room.call_person is not None,
            "hostAway": room.devices[HOST].away_since is not None,
        }
        if dev_id == HOST:
            v["waiting"] = [{"id": w.id, "names": list(w.names), "how": w.how, "from": w.frm}
                            for w in room.waiting.values()]
        return v

    def _broadcast(self, room: _Room) -> list:
        return [(d.conn, self._view(room, d.id)) for d in room.devices.values() if d.conn is not None]

    def _to_host(self, room: _Room, payload: dict) -> list:
        h = room.devices[HOST]
        if h.conn is None:
            if payload.get("kind") == "answer":
                room.held.append(payload)
            return []
        return [(h.conn, payload)]

    def _close(self, room: _Room, why: str) -> list:
        out = []
        for d in room.devices.values():
            if d.conn is not None:
                out.append((d.conn, {"kind": "closed", "code": room.code, "why": why}))
                self._where.pop(d.conn, None)
        for w in room.waiting.values():
            out.append((w.conn, {"kind": "refused", "code": room.code, "why": "closed"}))
            self._where.pop(w.conn, None)
        self._rooms.pop(room.code, None)
        return out

    def _skip_turn(self, room: _Room, why: str) -> list:
        t = room.turn
        room.turn = None
        if not t:
            return []
        return self._to_host(room, {"kind": "answer", "seat": t["seat"], "serial": t["serial"],
                                    "category": {"group": t["category"]["group"], "id": t["category"]["id"]},
                                    "right": False, "points": 0, "skipped": True, "why": why})

    def _remove_device(self, room: _Room, dev_id: str, why: str) -> list:
        d = room.devices.pop(dev_id, None)
        if d is None:
            return []
        out = []
        if d.conn is not None:
            out.append((d.conn, {"kind": "closed", "code": room.code, "why": why}))
            self._where.pop(d.conn, None)
        room.seats = [s for s in room.seats if s["device"] != dev_id]
        room.state["totals"] = {k: v for k, v in room.state.get("totals", {}).items() if not k.startswith(dev_id + ".")}
        if room.turn and room.turn["device"] == dev_id:
            out += self._skip_turn(room, "left")
        return out + self._broadcast(room)

    def _free_seats(self, room: _Room) -> int:
        return MAX_SEATS - len(room.seats)

    def _add_device(self, room: _Room, conn, account: str, how: str, names: list) -> tuple[_Device, list]:
        dev_id = f"d{room.next_dev}"
        room.next_dev += 1
        key = secrets.token_urlsafe(18)
        seats = []
        for i, n in enumerate(names):
            sid = f"{dev_id}.{i}"
            seats.append(sid)
            room.seats.append({"id": sid, "name": n, "device": dev_id})
        d = _Device(id=dev_id, conn=conn, account=account, how=how, key=key, seats=seats)
        room.devices[dev_id] = d
        self._where[conn] = (room.code, dev_id)
        out = [(conn, {"kind": "joined", "code": room.code, "key": key, "you": dev_id})]
        return d, out + self._broadcast(room)

    # ---- the one entry point for a frame ------------------------------------------------------------
    def handle(self, conn, account: str, raw) -> list:
        if not self._rate_ok(conn):
            return []
        msg = parse_game(raw)
        if msg is None:
            return []
        out = self.sweep() if self._now() - self._last_sweep >= 1.0 else []
        k = msg["kind"]
        if k == "ping":
            return out + [(conn, {"kind": "pong"})]
        if k == "room":
            if "open" in msg:
                return out + self._open(conn, account, msg["open"])
            if "resume" in msg:
                return out + self._resume_host(conn, account, msg["resume"])
            return out + self._update(conn, msg)
        if k == "join":
            return out + self._join(conn, account, msg)
        if k == "admit":
            return out + self._admit(conn, msg)
        if k == "turn":
            return out + self._turn(conn, msg)
        if k == "answer":
            return out + self._answer(conn, msg)
        if k == "leave":
            return out + self._leave(conn, msg)
        return out

    # ---- host ---------------------------------------------------------------------------------------
    def _host_room(self, conn) -> _Room | None:
        w = self._where.get(conn)
        if not w or w[1] != HOST:
            return None
        room = self._rooms.get(w[0])
        if room is None or room.devices[HOST].conn is not conn:
            return None
        return room

    def _open(self, conn, account: str, o: dict) -> list:
        if conn in self._where:
            return []                               # one room per connection
        out = self.sweep()
        if len(self._rooms) >= MAX_ROOMS or sum(1 for r in self._rooms.values() if r.host_account == account) >= MAX_ROOMS_PER_ACCOUNT:
            return out + [(conn, {"kind": "refused", "why": "busy"})]
        call_person = None
        if o.get("person"):
            # A CALL ROOM is only for the screens this login may use: otherwise anybody could open a room
            # "for" a stranger's person and hand its door to everyone who may call that person.
            if not self._may_person(account, o["person"]):
                return out + [(conn, {"kind": "refused", "why": "not-allowed"})]
            call_person = o["person"]
        code = None
        for _ in range(20):
            c = self._code()
            if c not in self._rooms:
                code = c
                break
        if code is None:
            return out + [(conn, {"kind": "refused", "why": "busy"})]
        now = self._now()
        room = _Room(code=code, game=o["game"], host_account=account, admit=o["admit"], call_person=call_person,
                     created=now, touched=now)
        key = secrets.token_urlsafe(18)
        host = _Device(id=HOST, conn=conn, account=account, how="host", key=key, seats=[])
        room.devices[HOST] = host
        for i, n in enumerate(o["seats"]):
            sid = f"{HOST}.{i}"
            host.seats.append(sid)
            room.seats.append({"id": sid, "name": n, "device": HOST})
        self._rooms[code] = room
        self._where[conn] = (code, HOST)
        out += [(conn, {"kind": "opened", "code": code, "key": key, "you": HOST})]
        out += self._broadcast(room)
        if call_person:
            # THE INVITATION, built here from the server's own record (never relayed from the page), and sent
            # only to the DRIVERS of that person's drive room - the people calling - never to a screen.
            out.append((("call", call_person), {"type": "game-invite", "code": code, "game": room.game,
                                                "name": room.seats[0]["name"] if room.seats else ""}))
        return out

    def _resume_host(self, conn, account: str, r: dict) -> list:
        if conn in self._where:
            return []
        room = self._rooms.get(r["code"])
        h = room.devices.get(HOST) if room else None
        if not room or h is None or h.account != account or not secrets.compare_digest(h.key, r["key"]):
            self._missed(account)
            return [(conn, {"kind": "refused", "why": "no-room"})]
        if h.conn is not None:
            self._where.pop(h.conn, None)
        h.conn = conn
        h.away_since = None
        room.touched = self._now()
        self._where[conn] = (room.code, HOST)
        out = [(conn, {"kind": "opened", "code": room.code, "key": h.key, "you": HOST, "resumed": True})]
        out += self._broadcast(room)
        for a in room.held:
            out.append((conn, a))
        room.held = []
        return out

    def _update(self, conn, msg: dict) -> list:
        room = self._host_room(conn)
        if room is None:
            return []                               # *** only the host changes the game ***
        room.touched = self._now()
        if "admit" in msg:
            room.admit = msg["admit"]
        if "state" in msg:
            st = dict(msg["state"])
            ids = {s["id"] for s in room.seats}
            st["totals"] = {k: v for k, v in st["totals"].items() if k in ids}
            if st.get("turn") not in ids:
                st["turn"] = None
            room.state = st
        return self._broadcast(room)

    def _admit(self, conn, msg: dict) -> list:
        room = self._host_room(conn)
        if room is None:
            return []
        w = room.waiting.pop(msg["id"], None)
        if w is None:
            return []
        self._where.pop(w.conn, None)
        if not msg["yes"]:
            return [(w.conn, {"kind": "refused", "code": room.code, "why": "declined"})] + self._broadcast(room)
        if len(w.names) > self._free_seats(room):
            return [(w.conn, {"kind": "refused", "code": room.code, "why": "full", "free": self._free_seats(room)})] \
                + self._broadcast(room)
        _, out = self._add_device(room, w.conn, w.account, w.how, w.names)
        return out

    def _turn(self, conn, msg: dict) -> list:
        room = self._host_room(conn)
        if room is None:
            return []
        seat = next((s for s in room.seats if s["id"] == msg["seat"]), None)
        if seat is None or seat["device"] == HOST:
            return []                               # the host plays its own seats itself
        room.touched = self._now()
        dev = room.devices[seat["device"]]
        room.turn = {"seat": seat["id"], "device": dev.id, "serial": msg["serial"], "round": msg["round"],
                     "category": msg["category"], "since": self._now()}
        if dev.conn is None:
            return []                               # away: the clock skips it (SEAT_AWAY_S)
        return [(dev.conn, {"kind": "turn", "seat": seat["id"], "serial": msg["serial"], "round": msg["round"],
                            "category": msg["category"]})]

    # ---- guests -------------------------------------------------------------------------------------
    def _join(self, conn, account: str, msg: dict) -> list:
        if conn in self._where:
            return []
        if self._throttled(account):
            return [(conn, {"kind": "refused", "why": "no-room"})]
        room = self._rooms.get(msg["code"])
        if room is None:
            self._missed(account)
            return [(conn, {"kind": "refused", "why": "no-room"})]
        # A screen coming back (its socket dropped): the same login, holding its own key, takes its seats back.
        key = msg.get("key")
        if key:
            for d in room.devices.values():
                if d.id != HOST and d.account == account and secrets.compare_digest(d.key, key):
                    if d.conn is not None:
                        self._where.pop(d.conn, None)
                    d.conn = conn
                    d.away_since = None
                    self._where[conn] = (room.code, d.id)
                    out = [(conn, {"kind": "joined", "code": room.code, "key": d.key, "you": d.id, "resumed": True})]
                    out += self._broadcast(room)
                    if room.turn and room.turn["device"] == d.id:
                        t = room.turn
                        out.append((conn, {"kind": "turn", "seat": t["seat"], "serial": t["serial"],
                                           "round": t["round"], "category": t["category"]}))
                    return out
        how = None
        try:
            how = self._relation(account, room.host_account, room.call_person)
        except Exception:
            how = None
        if how not in ("same", "connected", "call"):
            # *** THE SAME WORDS AS A CODE THAT DOES NOT EXIST. *** Otherwise this is an oracle for live codes.
            self._missed(account)
            return [(conn, {"kind": "refused", "why": "no-room"})]
        if len(msg["seats"]) > self._free_seats(room):
            return [(conn, {"kind": "refused", "code": room.code, "why": "full", "free": self._free_seats(room)})]
        if how in ("same", "call") or room.admit == "connected":
            _, out = self._add_device(room, conn, account, how, msg["seats"])
            return out
        if len(room.waiting) >= MAX_WAITING:
            return [(conn, {"kind": "refused", "code": room.code, "why": "busy"})]
        wid = f"w{room.next_wait}"
        room.next_wait += 1
        frm = ""
        try:
            frm = clean_name(self._name_of(account) or "")
        except Exception:
            frm = ""
        room.waiting[wid] = _Waiter(id=wid, conn=conn, account=account, how=how, names=msg["seats"],
                                    since=self._now(), frm=frm)
        self._where[conn] = (room.code, wid)
        out = [(conn, {"kind": "waiting", "code": room.code, "id": wid})]
        h = room.devices[HOST]
        if h.conn is not None:
            out.append((h.conn, self._view(room, HOST)))
        return out

    def _answer(self, conn, msg: dict) -> list:
        w = self._where.get(conn)
        if not w or w[1] == HOST or not _DEVICE_RE.match(w[1]):
            return []
        room = self._rooms.get(w[0])
        if room is None:
            return []
        t = room.turn
        # *** ONLY THE SEAT'S OWN SCREEN, ONLY ITS TURN, ONLY THAT TURN. *** Anything else is dropped.
        if not t or t["device"] != w[1] or t["seat"] != msg["seat"] or t["serial"] != msg["serial"]:
            return []
        room.turn = None
        room.touched = self._now()
        return self._to_host(room, {"kind": "answer", "seat": msg["seat"], "serial": msg["serial"],
                                    "category": msg["category"], "right": msg["right"], "points": msg["points"]})

    def _leave(self, conn, msg: dict) -> list:
        w = self._where.get(conn)
        if not w:
            return []
        room = self._rooms.get(w[0])
        if room is None:
            self._where.pop(conn, None)
            return []
        me = w[1]
        if me == HOST:
            target = msg.get("id")
            if not target:
                return self._close(room, "host-left")
            if target in room.waiting:
                wt = room.waiting.pop(target)
                self._where.pop(wt.conn, None)
                return [(wt.conn, {"kind": "refused", "code": room.code, "why": "declined"})] + self._broadcast(room)
            if target != HOST and target in room.devices:
                return self._remove_device(room, target, "removed")
            return []
        if me in room.waiting:
            room.waiting.pop(me)
            self._where.pop(conn, None)
            h = room.devices[HOST]
            return [(conn, {"kind": "closed", "code": room.code, "why": "left"})] + \
                ([(h.conn, self._view(room, HOST))] if h.conn is not None else [])
        return self._remove_device(room, me, "left")

    # ---- a socket went away -------------------------------------------------------------------------
    def dropped(self, conn) -> list:
        self._buckets.pop(conn, None)
        w = self._where.pop(conn, None)
        if not w:
            return []
        room = self._rooms.get(w[0])
        if room is None:
            return []
        me = w[1]
        if me in room.waiting:
            room.waiting.pop(me)
            h = room.devices[HOST]
            return [(h.conn, self._view(room, HOST))] if h.conn is not None else []
        d = room.devices.get(me)
        if d is None or d.conn is not conn:
            return []
        d.conn = None
        d.away_since = self._now()
        return self._broadcast(room)

    # ---- the clocks ---------------------------------------------------------------------------------
    def sweep(self) -> list:
        now = self._now()
        self._last_sweep = now
        out = []
        for room in list(self._rooms.values()):
            if now - room.created > ROOM_MAX_S or now - room.touched > ROOM_IDLE_S:
                out += self._close(room, "idle")
                continue
            h = room.devices[HOST]
            if h.away_since is not None and now - h.away_since > HOST_GONE_S:
                out += self._close(room, "host-gone")
                continue
            changed = False
            for wid, wt in list(room.waiting.items()):
                if now - wt.since > ADMIT_WAIT_S:
                    room.waiting.pop(wid)
                    self._where.pop(wt.conn, None)
                    out.append((wt.conn, {"kind": "refused", "code": room.code, "why": "no-answer"}))
                    changed = True
            t = room.turn
            if t:
                d = room.devices.get(t["device"])
                if d is None:
                    out += self._skip_turn(room, "left")
                elif d.away_since is not None and now - d.away_since > SEAT_AWAY_S:
                    out += self._skip_turn(room, "away")
                elif now - t["since"] > TURN_MAX_S:
                    out += self._skip_turn(room, "time")
            for dev_id, d in list(room.devices.items()):
                if dev_id != HOST and d.away_since is not None and now - d.away_since > DEVICE_GONE_S:
                    out += self._remove_device(room, dev_id, "gone")
                    changed = False      # _remove_device already told everyone, the host's waiting list included
            if changed and h.conn is not None:
                out.append((h.conn, self._view(room, HOST)))
        return out
