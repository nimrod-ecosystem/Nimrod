"""drive.py - REMOTE DRIVE: one person's screen, driven from another machine.

Mike's case: *"A clinician tweaking the input device setting while the patient uses it on
another device as if they were two screens for the same device."* The SETTINGS half of that
already works and needed nothing new - bindings are per-person, they live on the server, and
the kiosk's input runtime re-reads them when they change. This is the other half: pressing
something over there and having it happen over here, now rather than in a second and a half.

WHY A WEBSOCKET RELAY AND NOT WEBRTC. I said WebRTC first and then went and looked: this
project has no WebRTC anywhere (the validated video call is in the Cici repo, a different
codebase) and no WebSocket either. WebRTC would need signalling, STUN, and a TURN server for
the NATs that defeat it - and the signalling channel is a WebSocket anyway. So the first
honest version is the relay, and the peer-to-peer optimisation can reuse this socket to
signal itself later if the latency ever proves to matter. The server is already in the path
of every other thing these two devices share.

THE TICKET, AND WHY THE DEVICE KEY IS NOT IN THE URL. A browser cannot set headers on a
WebSocket handshake, so `X-Device-Key` - which is how an unattended kiosk authenticates -
simply cannot be sent. The cookie session can, but only for a signed-in human. Putting the
device secret in the query string would work and is exactly the thing not to do: query
strings land in access logs, proxies and browser history.

So: POST for a TICKET over ordinary authenticated HTTP, then present the ticket on the
socket. It is single-use, it expires in thirty seconds, and it is worthless afterwards. That
is a token in a URL rather than a secret in a URL, which is the distinction that matters.

WHAT MAY CROSS THE WIRE IS AN ALLOWLIST, NOT A TOPIC. A driver sends a VERB ID - one of the
eleven the vocabulary defines - and the receiving screen turns it into a bus topic locally.
If the wire carried topics, anybody with a socket could publish anything onto a bedside
screen's bus. It carries a name from a fixed list instead, and an unknown name is dropped.

IN-MEMORY, AND THEREFORE SINGLE-INSTANCE. Rooms live in this process. On one Render web
service that is correct; the day there are two, a driver and a screen could land on
different instances and never see each other. Written down rather than discovered later:
the fix then is Redis pub/sub between instances, not a bigger dict.
"""

from __future__ import annotations

import json
import secrets
import time
from dataclasses import dataclass, field

from play_relay import parse_follow, parse_play   # watching along (row 2.79): the `play` and `follow` messages
from screen_access import parse_lend, parse_see_answer   # who may see a screen; a temporary permission (2026-10-12)
from game_rooms import parse_call_ask   # "play this game together", asked from a call (2026-10-12)

# The verb vocabulary, mirrored from the client's actions.js. Deliberately duplicated as a
# frozen set rather than imported from anywhere: this is a security boundary, and a
# boundary that widens because some other file grew an entry is not a boundary.
DRIVE_VERBS = frozenset({
    "select", "back", "next", "prev", "up", "down", "left", "right", "menu",
    "focus-next", "focus-prev",
})

ROLES = frozenset({"screen", "driver"})

# ---------------------------------------------------------------------------------------
# SIGNALLING - added 2026-09-01, and it is the one thing on this socket that goes BOTH WAYS.
#
# The header above says a peer-to-peer call "can reuse this socket to signal itself later".
# This is that. A WebRTC call needs the two ends to swap an offer and an answer before any
# media flows, and the server has to carry those - it is the one part of a call that cannot
# be peer-to-peer, because the peers cannot reach each other yet.
#
# *** WHY THIS DOES NOT WIDEN THE VERB BOUNDARY. ***
#
# The rule that makes this file safe is that a driver drives screens and a screen drives
# nothing - so no bedside screen can ever press another's buttons. Signalling has to be
# bidirectional (the callee's ANSWER must get back to the caller), so it would break that
# rule if it were carried as a verb. It is not:
#
#   * a signal is a SEPARATE message type with its own path, and it is never turned into a
#     verb, a bus topic, or anything the receiving screen acts on. The client hands it
#     straight to the call transport and nowhere else.
#   * `kind` is a name from a fixed list, the same discipline the verbs use. An unknown
#     kind is dropped rather than relayed.
#   * the SDP itself is OPAQUE and this file never parses it. It is a bounded blob.
#
# So the invariant is now two sentences instead of one: verbs go one way, signals go both
# ways, and a signal can never become a verb.
#
# THE SIZE CAP IS THE PART THAT IS EASY TO FORGET. An SDP with a lot of candidates is a few
# kilobytes; nothing legitimate is anywhere near this. Without a cap the relay is a free
# broadcast pipe for anybody holding a socket, and the room fans it out to every member.
SIGNAL_KINDS = frozenset({"offer", "answer", "bye", "ice"})
MAX_SIGNAL_BYTES = 64 * 1024

TICKET_TTL_S = 30
MAX_TICKETS = 2000          # a bound, so a loop cannot grow this without limit


@dataclass
class _Ticket:
    user: str
    person_id: str
    expires: float


class Tickets:
    """Single-use, short-lived proof that somebody already authenticated over HTTP."""

    def __init__(self, ttl_s: int = TICKET_TTL_S, now=time.monotonic):
        self._by_id: dict[str, _Ticket] = {}
        self._ttl = ttl_s
        self._now = now

    def issue(self, user: str, person_id: str) -> str:
        self._sweep()
        if len(self._by_id) >= MAX_TICKETS:
            # Oldest first. A flood evicts its own earlier attempts rather than anybody's
            # live session, because a live one is seconds old and a flood's are not.
            for tid in sorted(self._by_id, key=lambda k: self._by_id[k].expires)[:MAX_TICKETS // 10]:
                self._by_id.pop(tid, None)
        tid = secrets.token_urlsafe(24)
        self._by_id[tid] = _Ticket(user=user, person_id=person_id,
                                   expires=self._now() + self._ttl)
        return tid

    def redeem(self, tid: str, person_id: str) -> str | None:
        """Returns the user this ticket was issued to, or None. ALWAYS consumes it."""
        self._sweep()
        t = self._by_id.pop(tid or "", None)
        if t is None:
            return None
        if t.expires < self._now():
            return None
        # A ticket is bound to the person it was asked for. Otherwise one ticket would open
        # a socket onto any screen in the account, which is not what was authorised.
        if t.person_id != person_id:
            return None
        return t.user

    def _sweep(self) -> None:
        now = self._now()
        for tid in [k for k, v in self._by_id.items() if v.expires < now]:
            self._by_id.pop(tid, None)

    def __len__(self) -> int:
        self._sweep()
        return len(self._by_id)


@dataclass
class Room:
    screens: list = field(default_factory=list)
    drivers: list = field(default_factory=list)

    def members(self, role: str) -> list:
        return self.screens if role == "screen" else self.drivers


class Rooms:
    """Who is connected to whose screen. Keyed by (account, person)."""

    def __init__(self):
        self._rooms: dict[tuple[str, str], Room] = {}

    # The account is part of the key on purpose. Person ids are unguessable, but "the id
    # was hard to guess" is not an authorisation model.
    def join(self, user: str, person_id: str, role: str, conn) -> Room:
        room = self._rooms.setdefault((user, person_id), Room())
        room.members(role).append(conn)
        return room

    def leave(self, user: str, person_id: str, role: str, conn) -> None:
        key = (user, person_id)
        room = self._rooms.get(key)
        if not room:
            return
        try:
            room.members(role).remove(conn)
        except ValueError:
            pass
        if not room.screens and not room.drivers:
            self._rooms.pop(key, None)

    def get(self, user: str, person_id: str) -> Room | None:
        return self._rooms.get((user, person_id))

    def counts(self, user: str, person_id: str) -> dict:
        room = self.get(user, person_id)
        return {
            "screens": len(room.screens) if room else 0,
            "drivers": len(room.drivers) if room else 0,
        }

    def __len__(self) -> int:
        return len(self._rooms)


def parse_message(raw: dict) -> dict | None:
    """Validate one inbound message. Returns what should be relayed, or None to drop.

    PURE, so the rules can be tested without a socket - and the rules are the whole
    security story of this file.
    """
    if not isinstance(raw, dict):
        return None
    kind = raw.get("type")
    if kind == "verb":
        verb = raw.get("verb")
        if not isinstance(verb, str) or verb not in DRIVE_VERBS:
            return None
        return {"type": "verb", "verb": verb}
    if kind == "signal":
        sig = raw.get("signal")
        if not isinstance(sig, dict):
            return None
        if sig.get("kind") not in SIGNAL_KINDS:
            return None
        # Bounded, and measured on the SERIALISED form because that is what actually
        # crosses the wire and what the room has to fan out.
        try:
            size = len(json.dumps(sig))
        except (TypeError, ValueError):
            return None                     # not JSON-serialisable: not ours to relay
        if size > MAX_SIGNAL_BYTES:
            return None
        return {"type": "signal", "signal": sig}
    if kind == "claim":
        # A screen asking to be THE ONE that answers an offer (row 2.44 - see Answerers below).
        # Only the two fields, both checked; anything else on the message is dropped.
        purpose, session = raw.get("purpose"), raw.get("session")
        if purpose not in ARBITRATED_PURPOSES or not _session_ok(session):
            return None
        return {"type": "claim", "purpose": purpose, "session": session}
    if kind == "group":
        # group calls (2026-10-09): see CallGroups below. Only the fields each op needs, each checked; a name
        # is never taken from the page (the server writes every name a group shows).
        return _parse_group(raw)
    if kind == "play":
        # watching along (row 2.79, play_relay.py): what a screen is playing, checked and copied there. Where it may
        # go (a screen's, to following drivers only) is decided in app.py with PlayRelay.route - never here.
        return parse_play(raw)
    if kind == "follow":
        return parse_follow(raw)
    if kind == "driving":
        # row 2.83: a driver saying it is (or is not) pressing right now (app.py `_idle_drivers`). Only the flag.
        return {"type": "driving", "on": raw["on"]} if isinstance(raw.get("on"), bool) else None
    if kind == "see-answer":
        # who may see a screen (2026-10-12, screen_access.py): a SCREEN's answer to "may <name> see this screen?".
        # Only from a screen, only for an ask on its own person - decided in app.py, never here.
        return parse_see_answer(raw)
    if kind == "lend":
        # a temporary permission given during a call (2026-10-12): a SCREEN's "let this caller see until the call
        # ends". The account is the call's own caller as the server recorded it (Answerers.caller), never the page's.
        return parse_lend(raw)
    if kind == "game-ask":
        # "play this game together", from a call (2026-10-12, game_rooms.py CallAsks): a DRIVER asks the person's
        # screens to open a game on the call. Only the game is kept; who may send it and how often is decided in
        # app.py with CallAsks.ask - never here, and it is never relayed as given.
        return parse_call_ask(raw)
    if kind == "ping":
        # A page may tag its ping with a number (`n`) so it can match the answer to the question and time the round
        # trip (play_sync.js, the clock difference). Only a small whole number is echoed; anything else is ignored.
        n = raw.get("n")
        if isinstance(n, int) and not isinstance(n, bool) and 0 <= n < 2 ** 31:
            return {"type": "pong", "n": n}
        return {"type": "pong"}
    return None


def stamp_signal(msg: dict, user: str) -> dict:
    """Stamp WHO sent a signal, as the server knows it (the account the ticket was issued to).

    Row 2.44, the intercom. Until now `from` on a signal was whatever the sending page said about
    itself, which is fine for a label and useless for a permission. The intercom admits only the
    people on a room's approved list, so the room needs a sender it can TRUST: `by`, written here,
    OVERWRITING anything the client put in that field. A client cannot forge it, because the relay
    always replaces it. PURE; a non-signal passes through untouched.
    """
    if not isinstance(msg, dict) or msg.get("type") != "signal" or not isinstance(msg.get("signal"), dict):
        return msg
    sig = dict(msg["signal"])
    sig["by"] = user
    return {"type": "signal", "signal": sig}


# ---------------------------------------------------------------------------------------
# ONE ANSWERING SCREEN PER OFFER - added 2026-10-02 (row 2.44, the intercom; Mike's list
# 2026-09-30 item 7).
#
# A phone's offer is fanned out to EVERY screen of the person. Before this, two open screens
# both answered an intercom: the phone kept the first answer, and the other screen sat "open"
# with ITS ROOM'S MICROPHONE ON, talking to nobody, until its 30-second stall clock ran out.
# That is a listening device left on in a room, which is a privacy failure, not a glitch.
#
# THE RULE: the server picks, and the FIRST RESPONSE WINS - whether it is a yes or a no.
#   * A screen that wants to answer sends {type: "claim", purpose, session} BEFORE it chimes,
#     warns or opens anything. The first claim on an offer wins; the server tells the winner
#     {type: "answerer", you: true} and, in the same breath, every other screen of the person
#     `you: false`. A later claim is told `you: false`. A screen opens no microphone without
#     `you: true` (intercom.js).
#   * A screen that says NO first (a `bye`: not on the list, already busy, on a call) decides it
#     too: the phone is told, and a later claim on that offer is told `you: false` - otherwise a
#     second screen could chime and open its microphone for a phone that has already given up.
#   * Once there is an answerer, only ITS signals for that offer reach the phone. Anything from
#     another screen (an older page that answers without claiming, say) is dropped, and an answer
#     sent WITHOUT a claim counts as the claim if it is first (so an older page still works, and
#     the others are still told to close).
#
# ARGUED, not absolute: "first response wins, even a no" means a screen on a call can turn a phone
# away that another screen of the same person would have taken. The alternative - wait for every
# screen - needs to know how many screens will answer, and one silent screen (an older page, a
# broken one) would then hold every refusal until the phone's own 30-second timeout. Mike's list.
#
# ONLY THE PURPOSES NAMED HERE. A FAMILY CALL joined on 2026-10-02 (call_transport.js): its caller now
# tags the offer `purpose: 'call'` and a session, every screen of the person RINGS, and the screen
# that answers claims first - the others are told no and stop ringing. Unlike the intercom, which
# claims before it chimes, a call claims at ANSWER, not at ring: the person picks up wherever they
# are, so ringing everywhere until somebody does is the point. A call with NO purpose or no session (an
# older caller page) is not arbitrated at all - it rings and answers exactly as it always did.
#
# A REFUSAL TELLS THE OTHERS TOO (2026-10-02). When the first response is a no (a decline, a busy), the
# other screens are told `you: false` in the same turn - otherwise a second screen keeps ringing (up to
# two minutes, for a call) for a caller who has already been told no, and then answers into nothing.
ARBITRATED_PURPOSES = frozenset({"intercom", "call"})
_SESSION_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
MAX_SESSION_LEN = 64            # an intercom session is "ic-" + 16 hex; 64 is room to spare, not a limit anyone meets

# A record with NO answerer yet (nobody has responded, or the answer was a no) is forgotten after
# this. 120 s, argued: the phone gives up on its own after 30 s (intercom.js answerMs), so four times
# that is never in the way of a real offer; a record WITH an answerer is never swept while that
# screen is connected - it goes when the answerer or the phone says bye, or the answerer leaves.
ANSWERER_IDLE_S = 120
# A CALL RINGS LONGER. The Call panel's longest "Ring for" choice is 120 s (modules/call.js SETTINGS,
# "A long time"); with the intercom's 120 s window a call answered at the very end of a long ring
# could find its record swept and be told no. So a call's window is the longest ring TWICE over -
# room for a slow claim, and still minutes, not hours, for a record nobody answered. If call.js ever
# offers a longer ring, raise CALL_RING_MAX_S with it (test_drive.py checks the ratio, not the value).
CALL_RING_MAX_S = 120
ANSWERER_IDLE_BY_PURPOSE = {"call": 2 * CALL_RING_MAX_S + 60}
# A bound, so a driver looping fresh offers cannot grow this without limit (the same reason
# Tickets has MAX_TICKETS). Oldest first.
MAX_ANSWERER_RECORDS = 2000


def _session_ok(session) -> bool:
    return (isinstance(session, str) and 0 < len(session) <= MAX_SESSION_LEN
            and all(c in _SESSION_CHARS for c in session))


def _arbitrated(sig) -> tuple[str, str] | None:
    """(purpose, session) when this signal belongs to an arbitrated offer, else None."""
    if not isinstance(sig, dict):
        return None
    purpose, session = sig.get("purpose"), sig.get("session")
    if purpose in ARBITRATED_PURPOSES and _session_ok(session):
        return purpose, session
    return None


@dataclass
class _Offer:
    answerer: object = None      # the winning screen's connection, once there is one
    declined: bool = False       # the first response was a no
    touched: float = 0.0
    # The account that placed the call (the server's own record, from the drive ticket). 2026-10-12: a temporary
    # permission given during a call goes to THIS account, never to one a page names (screen_access.py).
    caller: str | None = None


class Answerers:
    """Which ONE screen answers each arbitrated offer. Keyed by (room, purpose, session).

    No I/O: the caller (app.py) does the sending, so every rule here is testable without a socket.
    `room` is any hashable key (app.py uses (owner, person_id)); `conn` is any object - only its
    identity is used.
    """

    def __init__(self, idle_s: float = ANSWERER_IDLE_S, now=time.monotonic,
                 max_records: int = MAX_ANSWERER_RECORDS, idle_by_purpose: dict | None = None):
        self._recs: dict[tuple, _Offer] = {}
        self._idle = idle_s
        self._idle_by = dict(ANSWERER_IDLE_BY_PURPOSE if idle_by_purpose is None else idle_by_purpose)
        self._now = now
        self._max = max_records

    def _sweep(self) -> None:
        now = self._now()
        # A key is (room, purpose, session); each purpose has its own window (a call rings longer).
        for k in [k for k, r in self._recs.items()
                  if r.answerer is None and r.touched < now - self._idle_by.get(k[1], self._idle)]:
            self._recs.pop(k, None)
        if len(self._recs) >= self._max:
            for k in sorted(self._recs, key=lambda k: self._recs[k].touched)[:max(1, self._max // 10)]:
                self._recs.pop(k, None)

    def driver_signal(self, room, sig, user: str | None = None) -> None:
        """A phone's signal, on its way to the screens. An offer opens (or keeps) a record. `user`: who sent it."""
        ps = _arbitrated(sig)
        if ps is None:
            return
        key = (room, *ps)
        kind = sig.get("kind")
        if kind == "bye":
            self._recs.pop(key, None)
            return
        if kind != "offer":
            return
        self._sweep()
        rec = self._recs.get(key)
        if rec is not None and rec.answerer is not None:
            rec.touched = self._now()           # a reconnect: the same screen keeps it
            return
        self._recs[key] = _Offer(touched=self._now(), caller=user)   # new, or a fresh try after a no

    def claim(self, room, purpose: str, session: str, conn) -> tuple[bool, bool]:
        """(won, newly) - `newly` means the caller must now tell every OTHER screen `you: false`.

        No record (the server never relayed that offer, or it was forgotten) is a no: there is
        nothing to answer. Fails closed.
        """
        rec = self._recs.get((room, purpose, session))
        if rec is None or rec.declined:
            return False, False
        rec.touched = self._now()
        if rec.answerer is None:
            rec.answerer = conn
            return True, True
        return rec.answerer is conn, False

    def screen_signal(self, room, sig, conn) -> tuple[bool, bool]:
        """(relay, newly) for a screen's signal on its way to the phone.

        `newly`: this signal just DECIDED the offer - an answer sent without a claim made `conn` the
        answerer, or a refusal came first - so the other screens must be told `you: false`.
        """
        ps = _arbitrated(sig)
        if ps is None:
            return True, False                  # not arbitrated: exactly as before
        key = (room, *ps)
        kind = sig.get("kind")
        rec = self._recs.get(key)
        if rec is None:
            # A late hang-up from a screen whose record went with its old socket is still carried
            # (it can only END something); anything else for an offer the server never saw is not.
            return kind == "bye", False
        rec.touched = self._now()
        if rec.declined:
            return False, False                 # already answered "no" by somebody
        if rec.answerer is None:
            if kind == "answer":
                rec.answerer = conn             # an older page, answering without claiming
                return True, True
            if kind == "bye":
                # The first response was a no: the phone hears it, and so do the other screens - a
                # call still ringing elsewhere stops, rather than ringing on for a caller already gone.
                rec.declined = True
                return True, True
            return False, False
        if rec.answerer is not conn:
            return False, False                 # a loser: nothing of it reaches the phone
        if kind == "bye":
            self._recs.pop(key, None)
        return True, False

    def left(self, room, conn) -> None:
        """A screen's socket closed: the offers it was answering have no answerer any more."""
        for k in [k for k, r in self._recs.items() if k[0] == room and r.answerer is conn]:
            self._recs.pop(k, None)

    def answerer(self, room, purpose: str, session: str):
        rec = self._recs.get((room, purpose, session))
        return rec.answerer if rec else None

    def caller(self, room, purpose: str, session: str) -> str | None:
        """The account that placed this offer, as the server recorded it (None if unknown)."""
        rec = self._recs.get((room, purpose, session))
        return rec.caller if rec else None

    def __len__(self) -> int:
        return len(self._recs)


# ---------------------------------------------------------------------------------------
# GROUP CALLS - added 2026-10-09.
#
# Mike, 2026-10-09: "So for the group calls they'd need their own VPN or something?" No. A small call
# connects every device straight to every other one (a MESH), the way a two-person call already does:
# each person holds one connection per other person, and this server carries only the few kilobytes that
# set each connection up. No media passes through here, now or with this change. (A relay server for
# BIGGER calls is a separate, optional hookup - see call_relay.py; nothing here uses one.)
#
# WHAT THIS ADDS TO THE SOCKET. One message type, `group`, with a fixed list of ops (GROUP_OPS), and one
# in-memory table of who is in which call (CallGroups). A group is a two-person call that more people
# joined, so it is BUILT ON the call that already exists rather than beside it:
#
#   * A caller page tags its call's offer with `group: <id>` (call_transport.js). The first such offer
#     makes the group, with that caller as its first member, and records that the person it rang may join.
#   * A SCREEN JOINS ONLY BY ANSWERING. When the server picks a screen to answer a call (Answerers, the
#     claim) and that call was rung INTO a group, the screen is added - exactly once, by the server. A
#     screen never asks to join anything, and there is no op for it to try.
#   * A caller already in the group may ring ANOTHER person's screen into it: an offer on that person's
#     socket, tagged with the group. The server only accepts the tag from a login that is already a
#     caller in that group, and the socket it arrives on was itself only opened because that login may
#     call that person (the drive ticket, `may_drive`). So "may add Q to the call" = "is in the call" AND
#     "may call Q", which are both checks that already existed.
#   * ANOTHER CALLER (a second family member who may call the same person) cannot ring into a call in
#     progress - the screen is busy. They KNOCK instead, and a caller already in the call lets them in or
#     not. Screens never decide (the person at a bedside screen may not be able to). A knock nobody
#     answers ends by itself (KNOCK_WAIT_S): the knocker is told, and nothing waits on anybody.
#
# *** SECURITY INVARIANTS (these are the absolutes; everything else here is a default, argued) ***
#   1. NOBODY JOINS A GROUP THEY WERE NOT LET INTO. The three ways in are the three above (made it,
#      answered a call rung into it, knocked and was let in by a caller already in it), and each is
#      decided HERE from what the server itself knows (which socket, which login, which answer won).
#   2. A GROUP SIGNAL GOES TO ONE MEMBER OF THE SAME GROUP, FROM A MEMBER, AND NOWHERE ELSE. `from` is
#      written by the server, so a member cannot pose as another.
#   3. THE SERVER STILL CARRIES ONLY SIGNALLING. The SDP stays opaque and bounded (MAX_SIGNAL_BYTES).
#   4. A SIGNAL NEVER BECOMES A VERB. Group messages are a separate type; drive.js hands them to the
#      group, never to the bus. Two screens in one group can set up a connection to each other - that is
#      what a three-way call IS - but neither can press the other's buttons.
#
# PURE, like Answerers: every method returns a list of (connection, message) for app.py to send, so all of
# it is tested without a socket (test_call_groups.py), and then once more through the real socket.

# HOW MANY OTHER PEOPLE ONE DEVICE IS IN A MESH CALL WITH. A default, argued, not a law of nature:
#   * VIDEO: 3 others (4 people). Every device decodes one picture per other person and encodes its own
#     once per connection. A Raspberry Pi 400 that is also drawing the screen can decode two or three
#     small videos before the picture stutters [training knowledge - NOT measured on the bench Pi yet];
#     a phone uploading three copies of itself on a mobile network is at its edge too. So 3, not 5.
#     The case for more: a laptop on fibre could do 5 or 6. The case for fewer: a Pi on facility wifi
#     might struggle at 3 - the first real 3-way call on the bench Pi is the test that settles it.
#   * AUDIO ONLY: 5 others (6 people). Sound is cheap to decode and small to send (tens of kilobits per
#     connection), so the limit is how many voices a room can follow, not the hardware.
# A call bigger than this is what a relay server is for (call_relay.py) - with one set, nobody sends more
# than one copy of themselves. Mirrored in call_group.js MESH_MAX_OTHERS; test_call_groups.py checks they agree.
MESH_MAX_OTHERS = {"video": 3, "audio": 5}
GROUP_MAX = {k: n + 1 for k, n in MESH_MAX_OTHERS.items()}       # people in one group, you included
GROUP_KINDS = frozenset(MESH_MAX_OTHERS)
GROUP_OPS = frozenset({"signal", "leave", "knock", "admit", "deny", "cancel"})
# How long a knock waits for a caller to let it in. 90 s, argued: long enough for somebody mid-sentence to
# finish and press "Let in"; short enough that a knock nobody sees does not sit for ever. The knocker can
# give up sooner (cancel). Not a person's setting: nobody can judge it from a menu.
KNOCK_WAIT_S = 90
MAX_KNOCKS_PER_GROUP = 4            # a bound: a page looping knocks cannot fill a caller's screen
# How long the server remembers "this screen may join that group when it answers": the longest a call
# can ring and be answered (Answerers' own window for a call), so an invitation lasts exactly as long as
# the ring it rode on.
GROUP_PENDING_S = ANSWERER_IDLE_BY_PURPOSE["call"]
MAX_GROUPS = 2000                   # a bound, the same reason Tickets has MAX_TICKETS
PEER_ID_LEN = 8                     # hex: who's who inside one group, written by the server
_HEX = frozenset("0123456789abcdef")


def _peer_ok(s) -> bool:
    return isinstance(s, str) and len(s) == PEER_ID_LEN and all(c in _HEX for c in s)


def _parse_group(raw: dict) -> dict | None:
    op = raw.get("op")
    if not isinstance(op, str) or op not in GROUP_OPS:
        return None
    out = {"type": "group", "op": op}
    gid = raw.get("group")
    if op in ("signal", "admit", "deny"):
        if not _session_ok(gid):
            return None
        out["group"] = gid
    elif op == "leave" and _session_ok(gid):
        out["group"] = gid
    if op == "signal":
        to, sig = raw.get("to"), raw.get("signal")
        if not _peer_ok(to) or not isinstance(sig, dict) or sig.get("kind") not in SIGNAL_KINDS:
            return None
        try:
            if len(json.dumps(sig)) > MAX_SIGNAL_BYTES:
                return None
        except (TypeError, ValueError):
            return None
        out["to"], out["signal"] = to, sig
    if op in ("admit", "deny"):
        if not _peer_ok(raw.get("knock")):
            return None
        out["knock"] = raw["knock"]
    return out


@dataclass
class _Member:
    peer: str
    conn: object
    user: str
    room: tuple
    role: str                       # 'driver' (a caller page) | 'screen'
    name: str
    leg: str | None = None          # the member whose call brought this screen in (they are already connected)
    session: str | None = None      # ...and that call's id

    def view(self) -> dict:
        v = {"peer": self.peer, "name": self.name, "role": self.role, "leg": self.leg}
        if self.session:
            v["session"] = self.session
        return v


@dataclass
class _Knock:
    kid: str
    conn: object
    user: str
    name: str
    at: float
    room: tuple | None = None


@dataclass
class _Group:
    gid: str
    kind: str
    created: float
    members: dict = field(default_factory=dict)     # peer -> _Member
    knocks: dict = field(default_factory=dict)      # kid -> _Knock

    @property
    def max(self) -> int:
        return GROUP_MAX[self.kind]


def _g(op: str, **kw) -> dict:
    return {"type": "group", "op": op, **kw}


class CallGroups:
    """Who is in which group call. See the block above for the rules; app.py does the sending.

    `room` is app.py's (owner, person_id) for the socket; `conn` is any object (only its identity is used);
    `name_of(user, role, room)` is what the group calls a member - the server's own names, never the page's.
    """

    def __init__(self, now=time.monotonic, name_of=None, max_groups: int = MAX_GROUPS, may_bring=None):
        self._groups: dict[str, _Group] = {}
        self._pending: dict[tuple, list] = {}     # (room, session) -> [gid, inviter peer, touched]
        self._now = now
        self._name = name_of or (lambda user, role, room: user)
        self._max = max_groups
        # BRINGING OTHERS INTO A CALL IS A PERMISSION (Mike, 2026-10-13: "This sounds like something that should be a
        # permission."). `may_bring(user, room)`: may this login bring somebody new in front of that room's person? app.py
        # answers from the person's own list (screen_access.may_bring_others). Asked for EVERY OTHER screen in the call -
        # the people who would meet somebody their owner did not choose - when a caller rings somebody into a call and when
        # a caller lets a knock in. None (a test, an older caller of this class): allowed, as before.
        self._may_bring = may_bring

    def _bring_ok(self, user: str, g: _Group, but_room) -> bool:
        """`user` may bring somebody into `g`: allowed by every OTHER screen's person in it (members, and screens rung
        in that have not answered yet). `but_room`: the newcomer's own person - who already lets them call."""
        if self._may_bring is None:
            return True
        rooms = {m.room for m in g.members.values() if m.role == "screen"}
        rooms |= {k[0] for k, p in self._pending.items() if p[0] == g.gid}
        rooms.discard(but_room)
        try:
            return all(self._may_bring(user, r) for r in rooms)
        except Exception:
            return False                     # cannot tell: fails closed (nobody new is brought in)

    # ---- reading -------------------------------------------------------------------------------
    def __len__(self) -> int:
        return len(self._groups)

    def get(self, gid: str) -> _Group | None:
        return self._groups.get(gid)

    def group_of(self, conn):
        for g in self._groups.values():
            for m in g.members.values():
                if m.conn is conn:
                    return g, m
        return None, None

    def pending(self) -> int:
        return len(self._pending)

    # ---- helpers -------------------------------------------------------------------------------
    def _new_id(self, taken) -> str:
        while True:
            pid = secrets.token_hex(PEER_ID_LEN // 2)
            if pid not in taken:
                return pid

    def _joined(self, g: _Group, m: _Member) -> dict:
        return _g("joined", group=g.gid, you=m.peer, kind=g.kind, max=g.max, leg=m.leg,
                  members=[x.view() for x in g.members.values() if x is not m])

    def _add(self, g: _Group, m: _Member) -> list:
        g.members[m.peer] = m
        out = [(m.conn, self._joined(g, m))]
        out += [(x.conn, _g("peer-joined", group=g.gid, peer=m.view())) for x in g.members.values() if x is not m]
        return out

    def _drivers(self, g: _Group) -> list:
        return [m for m in g.members.values() if m.role == "driver"]

    def _remove(self, g: _Group, m: _Member) -> list:
        out = []
        g.members.pop(m.peer, None)
        out += [(x.conn, _g("peer-left", group=g.gid, peer=m.peer)) for x in g.members.values()]
        # Invitations this member made that nobody has answered yet go with them.
        for k in [k for k, p in self._pending.items() if p[0] == g.gid and p[1] == m.peer
                  and not any(x.session == k[1] for x in g.members.values())]:
            self._pending.pop(k, None)
        if not self._drivers(g) or not g.members:
            # Nobody left who could let a knock in: every knock is told no, rather than waiting it out.
            for k in list(g.knocks.values()):
                out.append((k.conn, _g("refused", group=g.gid, reason="ended")))
            g.knocks.clear()
        if not g.members:
            self._groups.pop(g.gid, None)
            for k in [k for k, p in self._pending.items() if p[0] == g.gid]:
                self._pending.pop(k, None)
        return out

    def _end_knock(self, g: _Group, k: _Knock) -> list:
        g.knocks.pop(k.kid, None)
        return [(d.conn, _g("knock-ended", group=g.gid, knock=k.kid)) for d in self._drivers(g)]

    def _counted(self, g: _Group) -> int:
        """Members, plus screens rung into the group that have not answered yet - so two rings at once
        cannot both get in past the cap."""
        waiting = {k for k, p in self._pending.items()
                   if p[0] == g.gid and not any(x.session == k[1] for x in g.members.values())}
        return len(g.members) + len(waiting)

    def sweep(self) -> list:
        now = self._now()
        out = []
        for g in list(self._groups.values()):
            for k in [k for k in g.knocks.values() if k.at < now - KNOCK_WAIT_S]:
                out += self._end_knock(g, k)
                out.append((k.conn, _g("refused", group=g.gid, reason="unanswered")))
        for key, p in list(self._pending.items()):
            g = self._groups.get(p[0])
            live = g is not None and any(x.session == key[1] for x in g.members.values())
            if live:
                p[2] = now                       # a member is on that call: kept, for a reconnect
            elif g is None or p[2] < now - GROUP_PENDING_S:
                self._pending.pop(key, None)
        return out

    # ---- the call's own signals (app.py calls these from the existing signal path) -------------
    def driver_offer(self, conn, user: str, room, sig: dict) -> tuple[bool, list]:
        """A caller's offer on its way to a person's screens. Returns (relay, out).

        No `group` on it: (True, []) - exactly as before. Tagged: makes the group (its first offer) or
        rings another screen into it (a caller already in it); a tag on an offer from a login that is not
        a caller in that group, or into a full group, is NOT relayed - nothing rings."""
        gid = sig.get("group") if isinstance(sig, dict) else None
        if gid is None:
            return True, []
        session = sig.get("session")
        if (sig.get("kind") != "offer" or sig.get("purpose") != "call" or not _session_ok(gid)
                or not _session_ok(session)):
            return True, []                  # not a group offer: the tag means nothing, the call is as before
        out = self.sweep()
        g = self._groups.get(gid)
        if g is None:
            if len(self._groups) >= self._max:
                return False, out + [(conn, _g("refused", group=gid, reason="busy"))]
            old, om = self.group_of(conn)
            if old is not None:
                out += self._remove(old, om)  # one group per socket: a new call leaves the last one
            frm = sig.get("from")
            kind = "audio" if isinstance(frm, dict) and frm.get("video") is False else "video"
            g = _Group(gid=gid, kind=kind, created=self._now())
            self._groups[gid] = g
            m = _Member(peer=self._new_id(()), conn=conn, user=user, room=room, role="driver",
                        name=self._name(user, "driver", room))
            out += self._add(g, m)
            inviter = m
        else:
            inviter = next((x for x in self._drivers(g) if x.user == user), None)
            if inviter is None:
                return False, out + [(conn, _g("refused", group=gid, reason="not-in-call"))]
            if (room, session) not in self._pending and self._counted(g) >= g.max:
                return False, out + [(conn, _g("refused", group=gid, reason="full"))]
            if (room, session) not in self._pending and not self._bring_ok(user, g, room):
                # 2026-10-13: a permission, decided here where the group grows - nothing rings.
                return False, out + [(conn, _g("refused", group=gid, reason="no-bring"))]
        self._pending[(room, session)] = [gid, inviter.peer, self._now()]
        return True, out

    def call_ended(self, room, session) -> None:
        """A `bye` for a call in this room: a screen that has not joined by now never will through it."""
        key = (room, session)
        p = self._pending.get(key)
        if p is None:
            return
        g = self._groups.get(p[0])
        if g is None or not any(x.session == session for x in g.members.values()):
            self._pending.pop(key, None)

    def screen_won(self, conn, user: str, room, session) -> list:
        """The server picked this screen to answer `session`. If that call was rung into a group, the screen
        joins it - the ONLY way a screen ever joins one."""
        p = self._pending.get((room, session))
        if not p:
            return []
        g = self._groups.get(p[0])
        if g is None or p[1] not in g.members:
            return []                        # the group, or whoever rang, has gone: a plain call
        cur, cm = self.group_of(conn)
        if cur is g:
            return []                        # a re-claim on a reconnect: already in
        out = []
        if cur is not None:
            out += self._remove(cur, cm)
        if len(g.members) >= g.max:
            return out + [(conn, _g("refused", group=g.gid, reason="full"))]
        m = _Member(peer=self._new_id(g.members), conn=conn, user=user, room=room, role="screen",
                    name=self._name(user, "screen", room), leg=p[1], session=session)
        p[2] = self._now()
        return out + self._add(g, m)

    # ---- the `group` ops ------------------------------------------------------------------------
    def handle(self, conn, user: str, room, role: str, msg: dict) -> list:
        op = msg.get("op")
        if op == "signal":
            return self.signal(conn, msg)
        if op == "leave":
            return self.leave(conn)
        if op == "knock":
            return self.knock(conn, user, room, role)
        if op in ("admit", "deny"):
            return self.answer_knock(conn, msg.get("group"), msg.get("knock"), op == "admit")
        if op == "cancel":
            return self.cancel(conn)
        return []

    def signal(self, conn, msg: dict) -> list:
        g, m = self.group_of(conn)
        if g is None or g.gid != msg.get("group"):
            return []
        to = g.members.get(msg.get("to"))
        if to is None or to is m:
            return []
        sig = dict(msg.get("signal") or {})
        sig.pop("by", None)
        return [(to.conn, _g("signal", group=g.gid, signal=sig, **{"from": m.peer}))]

    def leave(self, conn) -> list:
        g, m = self.group_of(conn)
        return self._remove(g, m) if g is not None else []

    def knock(self, conn, user: str, room, role: str) -> list:
        if role != "driver":
            return [(conn, _g("refused", reason="not-allowed"))]
        out = self.sweep() + self.cancel(conn)
        old, om = self.group_of(conn)
        if old is not None:
            out += self._remove(old, om)
        # The call this socket's person is in: a group with one of THIS room's screens in it. The socket was
        # only opened because this login may call this person, so this is "may call them" and nothing wider.
        found = [g for g in self._groups.values()
                 if any(m.role == "screen" and m.room == room for m in g.members.values()) and self._drivers(g)]
        if not found:
            return out + [(conn, _g("refused", reason="no-call"))]
        g = max(found, key=lambda x: x.created)
        if self._counted(g) >= g.max:
            return out + [(conn, _g("refused", group=g.gid, reason="full"))]
        if len(g.knocks) >= MAX_KNOCKS_PER_GROUP:
            return out + [(conn, _g("refused", group=g.gid, reason="busy"))]
        k = _Knock(kid=self._new_id(g.knocks), conn=conn, user=user, name=self._name(user, "driver", room),
                   at=self._now(), room=room)
        g.knocks[k.kid] = k
        out += [(d.conn, _g("knock", group=g.gid, knock=k.kid, name=k.name)) for d in self._drivers(g)]
        out.append((conn, _g("knocking", group=g.gid)))
        return out

    def answer_knock(self, conn, gid, kid, yes: bool) -> list:
        g, m = self.group_of(conn)
        if g is None or g.gid != gid or m.role != "driver":
            return []                        # only a CALLER already in this group decides
        k = g.knocks.get(kid)
        if k is None:
            return []
        if yes and not self._bring_ok(m.user, g, k.room):
            # The caller pressing "Let in" may not bring others into this call (2026-10-13). The knock STAYS, so another
            # caller in the call who may can still let it in; it ends by itself after KNOCK_WAIT_S like any knock.
            return [(conn, _g("refused", group=g.gid, reason="no-bring", knock=k.kid))]
        out = self._end_knock(g, k)
        if not yes:
            return out + [(k.conn, _g("refused", group=g.gid, reason="declined"))]
        if self._counted(g) >= g.max:
            return out + [(k.conn, _g("refused", group=g.gid, reason="full"))]
        old, om = self.group_of(k.conn)
        if old is not None:
            out += self._remove(old, om)
        nm = _Member(peer=self._new_id(g.members), conn=k.conn, user=k.user, room=k.room, role="driver", name=k.name)
        return out + self._add(g, nm)

    def cancel(self, conn) -> list:
        out = []
        for g in list(self._groups.values()):
            for k in [k for k in g.knocks.values() if k.conn is conn]:
                out += self._end_knock(g, k)
        return out

    def left(self, conn) -> list:
        """A socket closed: out of its group, and its knocks withdrawn."""
        return self.cancel(conn) + self.leave(conn)
