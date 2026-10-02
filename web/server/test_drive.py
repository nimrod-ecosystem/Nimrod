"""Store-layer test for remote drive - zero dependencies, no server, no socket.

    python test_drive.py

The rules here ARE the security story: what a ticket is worth, for how long, to whom, and
what a socket is allowed to carry. All of it is pure, so all of it is testable without
standing anything up.
"""
import sys

from drive import (ANSWERER_IDLE_S, ARBITRATED_PURPOSES, DRIVE_VERBS, MAX_SIGNAL_BYTES,
                   ROLES, SIGNAL_KINDS, Answerers, Rooms, Tickets, parse_message, stamp_signal)

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

section("who sent a signal is stamped by the server (row 2.44, the intercom)")
forged = parse_message({"type": "signal", "signal": {"kind": "offer", "sdp": "v=0", "by": "someone-else"}})
stamped = stamp_signal(forged, "alice@example.com")
check("*** the relay stamps the sender's own account as `by` ***",
      stamped["signal"]["by"] == "alice@example.com", str(stamped))
check("*** a `by` the client wrote is OVERWRITTEN, so it cannot be forged ***",
      stamped["signal"]["by"] != "someone-else")
check("the rest of the signal is carried unchanged",
      stamped["signal"]["kind"] == "offer" and stamped["signal"]["sdp"] == "v=0" and stamped["type"] == "signal")
check("the original message is not mutated (the stamp is a copy)", forged["signal"]["by"] == "someone-else")
check("a verb passes through untouched (nothing but signals is stamped)",
      stamp_signal({"type": "verb", "verb": "select"}, "alice") == {"type": "verb", "verb": "select"})
check("a pong passes through untouched", stamp_signal({"type": "pong"}, "alice") == {"type": "pong"})

# ---------------------------------------------------------------------------------------
# ONE ANSWERING SCREEN PER OFFER (row 2.44; Mike's list 2026-09-30 item 7). Two screens of one
# person both answered an intercom, and the loser's room microphone stayed open up to 30 s.
section("a claim: the one message a screen sends to the SERVER rather than through it")
check("a claim for an intercom offer is accepted, and only its two fields are kept",
      parse_message({"type": "claim", "purpose": "intercom", "session": "ic-0123456789abcdef", "x": 1})
      == {"type": "claim", "purpose": "intercom", "session": "ic-0123456789abcdef"})
check("*** a claim for a purpose that is not arbitrated (a call) is dropped ***",
      parse_message({"type": "claim", "purpose": "call", "session": "s1"}) is None
      and parse_message({"type": "claim", "session": "s1"}) is None)
check("a claim with no session, an empty one, a huge one or odd characters is dropped",
      all(parse_message({"type": "claim", "purpose": "intercom", "session": s}) is None
          for s in (None, "", "x" * 65, "ic 1", "ic/../1", 7)))
check("the intercom is the only arbitrated purpose (calls are untouched)", ARBITRATED_PURPOSES == {"intercom"})

section("*** the first screen to claim answers; every other screen is told no ***")
clk = Clock()
arb = Answerers(now=clk)
R = ("owner", "p1")
A, B, C = object(), object(), object()
OFFER = {"kind": "offer", "purpose": "intercom", "session": "ic-1", "sdp": "v=0"}
ANS = {"kind": "answer", "purpose": "intercom", "session": "ic-1", "sdp": "v=0"}
BYE = {"kind": "bye", "purpose": "intercom", "session": "ic-1"}
check("CONTROL: a claim on an offer the server never relayed is refused (fails closed)",
      arb.claim(R, "intercom", "ic-1", A) == (False, False))
arb.driver_signal(R, OFFER)
check("*** the first claim wins, and the server must now tell the others ***",
      arb.claim(R, "intercom", "ic-1", A) == (True, True))
check("*** the second claim loses ***", arb.claim(R, "intercom", "ic-1", B) == (False, False))
check("the winner claiming again is still the winner (a reconnect re-claims)",
      arb.claim(R, "intercom", "ic-1", A) == (True, False))
check("*** only the winner's answer reaches the phone ***",
      arb.screen_signal(R, ANS, A) == (True, False) and arb.screen_signal(R, ANS, B) == (False, False))
check("a loser's hang-up does not end the phone either", arb.screen_signal(R, BYE, B) == (False, False))
check("the same session in ANOTHER room is a different offer",
      arb.claim(("owner", "p2"), "intercom", "ic-1", C) == (False, False))
arb.driver_signal(R, OFFER)
check("a re-offer on the same session (the phone reconnecting) keeps the same answerer",
      arb.answerer(R, "intercom", "ic-1") is A and arb.claim(R, "intercom", "ic-1", B) == (False, False))
check("the winner's hang-up reaches the phone and the record goes",
      arb.screen_signal(R, BYE, A) == (True, False) and arb.answerer(R, "intercom", "ic-1") is None and len(arb) == 0)

section("*** the first response decides, even when it is a no ***")
arb = Answerers(now=clk)
arb.driver_signal(R, OFFER)
check("a screen's refusal (a bye) before anybody claims reaches the phone", arb.screen_signal(R, BYE, A) == (True, False))
check("*** ...and a later claim is told no: nobody opens a microphone for a phone that gave up ***",
      arb.claim(R, "intercom", "ic-1", B) == (False, False))
check("...nor is a later answer relayed", arb.screen_signal(R, ANS, B) == (False, False))
check("...nor a second refusal (the phone already has one)", arb.screen_signal(R, BYE, B) == (False, False))

section("an older page that answers without claiming")
arb = Answerers(now=clk)
arb.driver_signal(R, OFFER)
check("*** an answer with no claim, first, counts as the claim - and the others must be told ***",
      arb.screen_signal(R, ANS, A) == (True, True) and arb.answerer(R, "intercom", "ic-1") is A)
check("a claim after it loses", arb.claim(R, "intercom", "ic-1", B) == (False, False))
check("ICE (or anything else) from nobody-yet is not relayed",
      Answerers(now=clk).screen_signal(R, {"kind": "ice", "purpose": "intercom", "session": "ic-9"}, A) == (False, False))
check("a hang-up for an offer the server holds no record of is still carried (it can only end something)",
      Answerers(now=clk).screen_signal(R, {"kind": "bye", "purpose": "intercom", "session": "ic-9"}, A) == (True, False))
check("an answer for an offer the server never saw is not",
      Answerers(now=clk).screen_signal(R, {"kind": "answer", "purpose": "intercom", "session": "ic-9"}, A) == (False, False))

section("calls, phone microphones and verbs are untouched")
arb = Answerers(now=clk)
check("a call's answer (no purpose) is relayed exactly as before, by anybody",
      arb.screen_signal(R, {"kind": "answer", "sdp": "v=0"}, A) == (True, False)
      and arb.screen_signal(R, {"kind": "answer", "sdp": "v=0"}, B) == (True, False))
check("a phone-microphone answer too", arb.screen_signal(R, {"kind": "answer", "purpose": "phone-mic", "session": "pm-1"}, B) == (True, False))
arb.driver_signal(R, {"kind": "offer", "sdp": "v=0"})
check("and a call's offer opens no record", len(arb) == 0)

section("the records end")
arb = Answerers(now=clk)
arb.driver_signal(R, OFFER)
arb.claim(R, "intercom", "ic-1", A)
arb.left(R, B)
check("a LOSER leaving changes nothing", arb.answerer(R, "intercom", "ic-1") is A)
arb.left(R, A)
check("*** the answerer's socket closing frees the offer (its next re-offer starts fresh) ***",
      arb.answerer(R, "intercom", "ic-1") is None and len(arb) == 0)
arb.driver_signal(R, OFFER)
arb.driver_signal(R, BYE)
check("the phone hanging up drops the record", len(arb) == 0)
arb.driver_signal(R, OFFER)
clk.advance(ANSWERER_IDLE_S + 1)
arb.driver_signal(R, {**OFFER, "session": "ic-2"})
check("an offer nobody answered is forgotten after the idle window", arb.claim(R, "intercom", "ic-1", A) == (False, False)
      and ANSWERER_IDLE_S >= 4 * 30, str(ANSWERER_IDLE_S))
arb.claim(R, "intercom", "ic-2", A)
clk.advance(10 * ANSWERER_IDLE_S)
arb.driver_signal(R, {**OFFER, "session": "ic-3"})
check("...but one WITH an answerer is kept while that screen is connected (an hour-long intercom)",
      arb.answerer(R, "intercom", "ic-2") is A)
small = Answerers(now=clk, max_records=10)
for i in range(50):
    small.driver_signal(R, {**OFFER, "session": f"ic-{i}"})
check("a flood of fresh offers cannot grow the records without bound", len(small) <= 10, str(len(small)))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
