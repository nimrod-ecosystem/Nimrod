"""push.py — server push over SSE: "this URL has new data," nothing more.

Companion to drive.py's WebSocket, and deliberately not the same mechanism. drive.py
carries live, bidirectional, low-latency verbs and WebRTC signaling between two specific
parties (a driver and a screen) — see its own header for why that needs two-way traffic on
one socket. This is the opposite shape: one-directional, server-to-client only, fanning out
to potentially several idle tabs/kiosks that all belong to the same signed-in account. That
is exactly what docs/architecture.md's 2026-08-10 decision ("server push = SSE, not
WebSocket") described, and this is the first thing to actually need it — state.js's and
events.js's polling loops have said "interim... until server push (SSE) lands" since the
day they were written.

WHAT IT DOES NOT CARRY: no data, only a URL. A client that receives one does exactly what a
successful poll would have done anyway — refetches that URL through the same authenticated,
authorized REST endpoint it already calls. So this file duplicates no authorization logic;
a push naming a URL a receiving tab does not care about is simply ignored, client-side, and
a push arriving for data the account is not actually entitled to is harmless for the same
reason — the refetch it triggers is checked exactly as it already would be.

SCOPED BY ACCOUNT, NOT BY CONNECTION — deliberately. Two tabs signed into the same account
(a laptop composing a setup and a paired kiosk showing it) are meant to converge on each
other's writes; that is the literal feature state.js's own comment names ("cross-device
convergence"). A write from either reaches every open connection for that account,
including, harmlessly, the one that made the write — it already has the new data from its
own optimistic update, so a redundant refetch costs one extra request, not a correctness
bug.

IN-PROCESS ONLY — THE SAME LIMITATION drive.py's Rooms ALREADY NAMES FOR ITSELF. This works
correctly with exactly the one uvicorn worker this app runs today (render.yaml sets no
--workers). The moment a second worker or a second instance exists, an account's two
connections could land on different processes and stop seeing each other's pushes — the fix
then is a shared pub/sub layer (Redis, the same answer drive.py's own header already gives
for its own Rooms), not a bigger dict. Not built now because there is exactly one process
to serve.
"""
from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass

TICKET_TTL_S = 30           # matches drive.py's own Tickets — long enough to open one
                             # connection right after asking for the ticket, short enough
                             # that one leaked into a log line is worthless quickly.
MAX_TICKETS = 10_000         # matches drive.py's own flood guard
MAX_QUEUE = 64               # a subscriber this far behind is not "slow," it is gone —
                             # see PushHub.publish for why a full queue is dropped, not blocked


@dataclass
class _Ticket:
    user: str
    expires: float


class StreamTickets:
    """Single-use, short-lived proof that somebody already authenticated over HTTP.

    EventSource cannot set the X-Device-Key header a kiosk normally authenticates with (it
    sends no custom headers at all), so — exactly like drive.py's own Tickets, which solves
    the identical problem for its WebSocket — this trades an already-proven identity for a
    token an EventSource CAN carry, in its URL, that is worthless within seconds rather than
    for as long as the real key lives.

    Deliberately NOT drive.py's own Tickets, reused: those are bound to a person_id (a
    driving session is about ONE screen); this is scoped to an ACCOUNT (the stream covers
    everything that account owns). Different enough security semantics that sharing the
    class would blur what a ticket actually proves.
    """

    def __init__(self, ttl_s: int = TICKET_TTL_S, now=time.monotonic):
        self._by_id: dict[str, _Ticket] = {}
        self._ttl = ttl_s
        self._now = now

    def issue(self, user: str) -> str:
        self._sweep()
        if len(self._by_id) >= MAX_TICKETS:
            # Oldest first — a flood evicts its own earlier attempts rather than anybody's
            # live session, because a live one is seconds old and a flood's are not.
            for tid in sorted(self._by_id, key=lambda k: self._by_id[k].expires)[:MAX_TICKETS // 10]:
                self._by_id.pop(tid, None)
        tid = secrets.token_urlsafe(24)
        self._by_id[tid] = _Ticket(user=user, expires=self._now() + self._ttl)
        return tid

    def redeem(self, tid: str) -> str | None:
        """Returns the user this ticket was issued to, or None. ALWAYS consumes it."""
        self._sweep()
        t = self._by_id.pop(tid or "", None)
        if t is None:
            return None
        if t.expires < self._now():
            return None
        return t.user

    def _sweep(self) -> None:
        now = self._now()
        for tid in [k for k, v in self._by_id.items() if v.expires < now]:
            self._by_id.pop(tid, None)


class PushHub:
    """Who is listening, and what to tell them. See the module docstring for scope and
    the single-process limitation."""

    def __init__(self):
        self._subs: dict[str, set[asyncio.Queue]] = {}

    def subscribe(self, account: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE)
        self._subs.setdefault(account, set()).add(q)
        return q

    def unsubscribe(self, account: str, q: asyncio.Queue) -> None:
        subs = self._subs.get(account)
        if not subs:
            return
        subs.discard(q)
        if not subs:
            self._subs.pop(account, None)

    def subscriber_count(self, account: str) -> int:
        return len(self._subs.get(account, ()))

    def publish(self, account: str, url: str) -> None:
        """Tell every open connection for this account that `url` has new data.

        Never raises, never blocks the write that triggered it. A subscriber whose queue
        is already full (a backgrounded tab the OS stopped scheduling, say) simply misses
        this one push — its own poll-with-backoff is what actually guarantees
        correctness; this is only the fast path, never the only path.
        """
        for q in self._subs.get(account, ()):
            try:
                q.put_nowait(url)
            except asyncio.QueueFull:
                pass
