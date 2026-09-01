"""Store-layer test for remote drive - zero dependencies, no server, no socket.

    python test_drive.py

The rules here ARE the security story: what a ticket is worth, for how long, to whom, and
what a socket is allowed to carry. All of it is pure, so all of it is testable without
standing anything up.
"""
import sys

from drive import (DRIVE_VERBS, MAX_SIGNAL_BYTES, ROLES, SIGNAL_KINDS, Rooms,
                   Tickets, parse_message)

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t):
    print(f"\n-- {t}")


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


# ---------------------------------------------------------------- tickets
section("tickets: single use, short life, bound to one person")

clock = Clock()
tk = Tickets(ttl_s=30, now=clock)

t1 = tk.issue("acct", "p1")
check("a ticket is issued", isinstance(t1, str) and len(t1) > 20)
check("it is not guessable-short", len(t1) >= 24, f"len={len(t1)}")
check("it redeems to the account it was issued to", tk.redeem(t1, "p1") == "acct")
check("AND IT IS GONE - a replayed ticket buys nothing", tk.redeem(t1, "p1") is None)

t2 = tk.issue("acct", "p1")
clock.advance(31)
check("an expired ticket is refused", tk.redeem(t2, "p1") is None)

t3 = tk.issue("acct", "p1")
check(
    "a ticket for one person does NOT open a socket onto another",
    tk.redeem(t3, "p2") is None,
)
check("and that attempt consumed it too, so it cannot be retried", tk.redeem(t3, "p1") is None)

check("garbage is refused", tk.redeem("not-a-ticket", "p1") is None)
check("so is an empty string", tk.redeem("", "p1") is None)
check("and so is None", tk.redeem(None, "p1") is None)

t4 = tk.issue("acct", "p1")
t5 = tk.issue("acct", "p1")
check("two tickets are different", t4 != t5)

before = len(tk)
clock.advance(31)
check("expired tickets are swept, not hoarded", len(tk) == 0, f"{before} -> {len(tk)}")

big = Tickets(ttl_s=30, now=clock)
for i in range(2500):
    big.issue("acct", "p1")
check("a flood cannot grow the table without bound", len(big) <= 2000, f"{len(big)}")

# ---------------------------------------------------------------- messages
section("what may cross the wire")

check("a known verb is relayed", parse_message({"type": "verb", "verb": "next"}) ==
      {"type": "verb", "verb": "next"})
check("every verb in the vocabulary is accepted",
      all(parse_message({"type": "verb", "verb": v}) for v in DRIVE_VERBS))
check("an unknown verb is DROPPED", parse_message({"type": "verb", "verb": "rm-rf"}) is None)

# THE POINT OF THE ALLOWLIST. If topics crossed the wire, anyone with a socket could
# publish anything at all onto a bedside screen's bus.
check("a bus TOPIC is not a verb and is refused",
      parse_message({"type": "verb", "verb": "photos/next"}) is None)
check("an unknown message type is refused", parse_message({"type": "exec", "cmd": "x"}) is None)
check("a verb that is not a string is refused",
      parse_message({"type": "verb", "verb": {"toString": 1}}) is None)
check("a missing verb is refused", parse_message({"type": "verb"}) is None)
check("a bare string is not a message", parse_message("next") is None)
check("nor is None", parse_message(None) is None)
check("nor is a list", parse_message(["verb", "next"]) is None)
check("ping is answered with pong", parse_message({"type": "ping"}) == {"type": "pong"})
check("the vocabulary is exactly eleven", len(DRIVE_VERBS) == 11, f"{sorted(DRIVE_VERBS)}")
check("roles are exactly two", ROLES == {"screen", "driver"})

# ---------------------------------------------------------------- rooms
section("rooms: who can reach whom")

rooms = Rooms()
s1, s2, d1 = object(), object(), object()

rooms.join("acct", "p1", "screen", s1)
rooms.join("acct", "p1", "driver", d1)
check("a room counts both sides", rooms.counts("acct", "p1") == {"screens": 1, "drivers": 1})

rooms.join("acct", "p2", "screen", s2)
check("a different person is a different room",
      rooms.counts("acct", "p2") == {"screens": 1, "drivers": 0})

# THE ACCOUNT IS PART OF THE KEY. Person ids are unguessable, but "hard to guess" is not
# an authorisation model.
check("another account sees an empty room for the same person id",
      rooms.counts("other", "p1") == {"screens": 0, "drivers": 0})

room = rooms.get("acct", "p1")
check("a driver's message goes to screens", room.members("screen") == [s1])
check("and a screen would only ever reach drivers", room.members("driver") == [d1])

rooms.leave("acct", "p1", "driver", d1)
check("leaving decrements", rooms.counts("acct", "p1") == {"screens": 1, "drivers": 0})
rooms.leave("acct", "p1", "driver", d1)
check("leaving twice is not an error", rooms.counts("acct", "p1")["drivers"] == 0)
rooms.leave("acct", "p1", "screen", s1)
check("an empty room is dropped, not left behind", rooms.get("acct", "p1") is None)
check("but other rooms survive", rooms.get("acct", "p2") is not None)

rooms.leave("acct", "nope", "screen", s1)
check("leaving a room that never existed is not an error", True)

# =====================================================================================
# SIGNALLING - the one message on this socket that travels BOTH ways.
#
# A call cannot be set up peer-to-peer, because the peers cannot reach each other yet; the
# offer and the answer have to be carried. That makes signalling bidirectional, and the rule
# that keeps this file safe is that a screen never drives anything. These checks are the seam
# between those two facts.
section("signalling: the message that goes both ways")

check("*** an offer is relayed ***",
      parse_message({"type": "signal", "signal": {"kind": "offer", "sdp": "v=0"}})
      == {"type": "signal", "signal": {"kind": "offer", "sdp": "v=0"}})
check("...and an answer, which is the half that has to travel BACK",
      parse_message({"type": "signal", "signal": {"kind": "answer", "sdp": "v=0"}}) is not None)
check("...and a bye, so the far end is not left watching a frozen frame",
      parse_message({"type": "signal", "signal": {"kind": "bye"}}) is not None)

# `kind` is a name from a fixed list, exactly like the verbs. Same discipline, same reason.
check("*** an unknown signal kind is DROPPED, not relayed ***",
      parse_message({"type": "signal", "signal": {"kind": "whatever", "sdp": "x"}}) is None)
check("a signal with no kind at all is dropped",
      parse_message({"type": "signal", "signal": {"sdp": "x"}}) is None)
check("a signal that is not an object is dropped",
      parse_message({"type": "signal", "signal": "offer"}) is None)
check("and the kinds are a closed set", SIGNAL_KINDS == {"offer", "answer", "bye", "ice"})

# *** A SIGNAL CAN NEVER BECOME A VERB. *** This is the whole security argument for letting
# signals travel both ways: the two message types share a socket and nothing else.
sig = parse_message({"type": "signal", "signal": {"kind": "offer", "verb": "select"}})
check("*** a signal carrying a verb is still only a signal ***",
      sig["type"] == "signal" and "verb" not in sig, str(sig))
check("...and a verb cannot smuggle a signal either",
      parse_message({"type": "verb", "verb": "select", "signal": {"kind": "offer"}})
      == {"type": "verb", "verb": "select"})

# THE SIZE CAP. Without it the relay is a free broadcast pipe, and the room fans it out to
# every member. A real SDP with plenty of candidates is a few kilobytes.
check("a realiztic SDP is comfortably within the cap",
      parse_message({"type": "signal",
                     "signal": {"kind": "offer", "sdp": "a=candidate:x\r\n" * 500}}) is not None)
check("*** an oversized blob is refused ***",
      parse_message({"type": "signal",
                     "signal": {"kind": "offer", "sdp": "x" * (MAX_SIGNAL_BYTES + 1)}}) is None)
check("...and the cap is a real bound rather than a comment",
      MAX_SIGNAL_BYTES == 64 * 1024, str(MAX_SIGNAL_BYTES))


# Something unserialisable cannot be relayed, and finding that out HERE is better than an
# exception part-way through the room's fan-out, with some members already sent to.
class _Unserialisable:
    pass


check("something unserialisable is dropped rather than thrown",
      parse_message({"type": "signal",
                     "signal": {"kind": "offer", "sdp": _Unserialisable()}}) is None)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
