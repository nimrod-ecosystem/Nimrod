#!/usr/bin/env python3
"""push.py — server push over SSE. Store-layer test, zero dependencies (no FastAPI, no
event loop needed for the queue itself; asyncio.Queue works fine constructed outside a
running loop and only needs one for put/get, which this drives directly with
asyncio.run()).

Run:
    python test_push.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from push import PushHub, StreamTickets  # noqa: E402

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t: str):
    print(f"\n-- {t}")


def main() -> None:
    # ==========================================================================
    section("StreamTickets — single-use, short-lived, and bound to nothing but the account")
    t = 0.0
    tickets = StreamTickets(ttl_s=30, now=lambda: t)

    tid = tickets.issue("alice")
    check("a fresh ticket redeems to the user it was issued for", tickets.redeem(tid) == "alice")

    tid2 = tickets.issue("alice")
    tickets.redeem(tid2)   # the first redeem — spends it
    check("*** redeeming CONSUMES it — a second redeem of the same ticket fails ***",
          tickets.redeem(tid2) is None)

    tid3 = tickets.issue("bob")
    t = 31.0   # past the 30s ttl
    check("an expired ticket does not redeem, even though it was never used",
          tickets.redeem(tid3) is None)

    t = 0.0
    check("a garbage/unknown ticket id redeems to nothing", tickets.redeem("not-a-real-ticket") is None)
    check("an empty ticket id redeems to nothing", tickets.redeem("") is None)
    check("None as a ticket id does not raise", tickets.redeem(None) is None)  # type: ignore[arg-type]

    # ==========================================================================
    section("PushHub — fans out to every subscriber for an account, nobody else's")
    hub = PushHub()

    async def basic_fanout():
        qa1 = hub.subscribe("alice")
        qa2 = hub.subscribe("alice")
        qb = hub.subscribe("bob")

        hub.publish("alice", "/api/profiles/p1/events/e1")

        got_a1 = await asyncio.wait_for(qa1.get(), timeout=1)
        got_a2 = await asyncio.wait_for(qa2.get(), timeout=1)
        check("*** every one of alice's OWN subscribers gets the push ***",
              got_a1 == "/api/profiles/p1/events/e1" and got_a2 == "/api/profiles/p1/events/e1")
        check("bob's queue is empty — a push to alice never reaches another account's subscriber",
              qb.empty())

        hub.unsubscribe("alice", qa1)
        check("count reflects the unsubscribe", hub.subscriber_count("alice") == 1)
        hub.unsubscribe("alice", qa2)
        check("*** the account itself is cleaned up once its last subscriber leaves — no leak ***",
              hub.subscriber_count("alice") == 0)
        hub.unsubscribe("bob", qb)

    asyncio.run(basic_fanout())

    async def publish_to_nobody():
        # An account with zero open connections is the common case (nobody has this
        # screen open right now) — publishing must be a complete no-op, not an error.
        try:
            hub.publish("nobody-home", "/api/profiles/x/state/y")
            ok = True
        except Exception as e:  # noqa: BLE001
            ok = False
            check("publishing to an account with no subscribers does not raise", ok, str(e))
            return
        check("publishing to an account with no subscribers does not raise", ok)

    asyncio.run(publish_to_nobody())

    async def full_queue_does_not_block():
        # *** THE WRITE THAT TRIGGERED THIS MUST NEVER BE SLOWED DOWN BY A STUCK
        # SUBSCRIBER. *** A backgrounded tab the OS stopped scheduling looks, from here,
        # exactly like a subscriber that stopped reading — its queue fills up and stays
        # full. publish() must still return immediately rather than raise or hang.
        q = hub.subscribe("carol")
        for _ in range(200):   # comfortably past MAX_QUEUE
            hub.publish("carol", "/api/profiles/p/events/e")
        check("*** publishing far past the queue's capacity never raises ***", True)
        check("the queue itself is capped, not unbounded", q.qsize() <= 64, q.qsize())
        hub.unsubscribe("carol", q)

    asyncio.run(full_queue_does_not_block())

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
