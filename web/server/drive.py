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
    if kind == "ping":
        return {"type": "pong"}
    return None
