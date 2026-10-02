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
    if kind == "ping":
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

    def driver_signal(self, room, sig) -> None:
        """A phone's signal, on its way to the screens. An offer opens (or keeps) a record."""
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
        self._recs[key] = _Offer(touched=self._now())   # new, or a fresh try after a no

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

    def __len__(self) -> int:
        return len(self._recs)
