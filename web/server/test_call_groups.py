"""Group calls (2026-10-09) - who may join a call, and where a group signal may go. drive.py CallGroups.

    python test_call_groups.py

Mike, 2026-10-09: "So for the group calls they'd need their own VPN or something?" No: a small call connects
every device straight to every other one, and the server only carries the setting-up. These are the rules
that decide who gets into such a call - pure first, with fake connections, then once more through the real
socket against a throwaway database.

The security invariants (drive.py "GROUP CALLS"): nobody joins a group they were not let into; a group signal
goes to one member of the same group, from a member, and nowhere else; the server carries signalling only;
and a signal never becomes a verb.
"""
import json
import os
import sys
import tempfile

from drive import (GROUP_MAX, GROUP_OPS, KNOCK_WAIT_S, MAX_KNOCKS_PER_GROUP, MAX_SIGNAL_BYTES, MESH_MAX_OTHERS,
                   PEER_ID_LEN, CallGroups, parse_message)

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


class Conn:
    def __init__(self, label):
        self.label = label

    def __repr__(self):
        return f"<{self.label}>"


def to(out, conn, op=None):
    """The messages in `out` addressed to `conn` (optionally only one op)."""
    return [m for c, m in out if c is conn and (op is None or m.get("op") == op)]


def offer(session, group, video=True):
    return {"kind": "offer", "sdp": "SDP", "purpose": "call", "session": session, "group": group,
            "from": {"name": "x", "video": video}}


ROOM_P = ("pat", "pid-robin")       # Robin's screens (Pat owns Robin)
ROOM_Q = ("quinn", "pid-gran")      # Gran's screens (Quinn owns Gran)
ROOM_R = ("rae", "pid-rae")


# ------------------------------------------------------------------------------------------- the message shape
section("parse_message: a `group` message is a fixed list of ops, each field checked")
check("the ops", GROUP_OPS == {"signal", "leave", "knock", "admit", "deny", "cancel"})
check("an unknown op is dropped", parse_message({"type": "group", "op": "join", "group": "call-1"}) is None)
check("an op that is not a string is dropped", parse_message({"type": "group", "op": ["signal"]}) is None)
sig_ok = parse_message({"type": "group", "op": "signal", "group": "call-abc", "to": "0123abcd",
                        "signal": {"kind": "offer", "sdp": "x"}})
check("a signal to one member parses", sig_ok == {"type": "group", "op": "signal", "group": "call-abc", "to": "0123abcd",
                                                  "signal": {"kind": "offer", "sdp": "x"}}, str(sig_ok))
check("a signal with no `to` is dropped",
      parse_message({"type": "group", "op": "signal", "group": "call-abc", "signal": {"kind": "offer"}}) is None)
check("...or a `to` that is not a peer id", parse_message({"type": "group", "op": "signal", "group": "call-abc",
                                                          "to": "../x", "signal": {"kind": "offer"}}) is None)
check("...or a signal kind off the list", parse_message({"type": "group", "op": "signal", "group": "call-abc",
                                                        "to": "0123abcd", "signal": {"kind": "verb"}}) is None)
check("...or a group id that is not a session", parse_message({"type": "group", "op": "signal", "group": "a b",
                                                              "to": "0123abcd", "signal": {"kind": "offer"}}) is None)
big = {"kind": "offer", "sdp": "x" * (MAX_SIGNAL_BYTES + 10)}
check("*** an oversized signal is dropped (the same cap as a call's) ***",
      parse_message({"type": "group", "op": "signal", "group": "call-abc", "to": "0123abcd", "signal": big}) is None)
kn = parse_message({"type": "group", "op": "knock", "name": "I AM THE OWNER", "group": "call-abc"})
check("*** a knock carries no name from the page (the server writes every name) ***", kn == {"type": "group", "op": "knock"}, str(kn))
check("admit needs a knock id", parse_message({"type": "group", "op": "admit", "group": "call-abc"}) is None)
check("a peer id is 8 hex", PEER_ID_LEN == 8)

section("the cap: 3 others on video, 5 with sound only - and the server's limit is the same number plus you")
check("video", MESH_MAX_OTHERS["video"] == 3 and GROUP_MAX["video"] == 4)
check("audio only", MESH_MAX_OTHERS["audio"] == 5 and GROUP_MAX["audio"] == 6)
# The client mirrors the numbers (call_group.js); a drift would let a page offer a fifth person the server refuses.
_js = open(os.path.join(os.path.dirname(__file__), "..", "client", "call_group.js"), encoding="utf-8").read()
check("*** call_group.js says the same numbers ***",
      "MESH_MAX_OTHERS = Object.freeze({ video: 3, audio: 5 })" in _js)


# --------------------------------------------------------------------------------------- making a group
section("an untagged call is exactly as before")
G = CallGroups(now=Clock())
A = Conn("A-caller-on-P")
relay, out = G.driver_offer(A, "mike", ROOM_P, {"kind": "offer", "purpose": "call", "session": "call-1"})
check("relayed, nothing said, no group", relay and out == [] and len(G) == 0)
relay, out = G.driver_offer(A, "mike", ROOM_P, {"kind": "offer", "purpose": "intercom", "session": "ic-1", "group": "g1"})
check("a group tag on something that is not a call means nothing", relay and out == [] and len(G) == 0)

section("the first tagged offer makes the group; the caller is its first member")
clock = Clock()
names = {("mike", "driver"): "Mike", ("pat", "screen"): "Robin", ("quinn", "screen"): "Gran",
         ("sam", "driver"): "Sam", ("mal", "driver"): "Mal"}
G = CallGroups(now=clock, name_of=lambda u, r, room: names.get((u, r), u))
A = Conn("A")
relay, out = G.driver_offer(A, "mike", ROOM_P, offer("call-aaa", "call-aaa"))
j = to(out, A, "joined")
check("relayed (the screens ring as for any call)", relay)
check("the caller is told it is in, and who it is", len(j) == 1 and len(j[0]["you"]) == 8 and j[0]["members"] == [], str(out))
check("a video call's group holds 4", j[0]["kind"] == "video" and j[0]["max"] == 4)
a_peer = j[0]["you"]
G2 = CallGroups(now=Clock())
_, o2 = G2.driver_offer(Conn("x"), "mike", ROOM_P, offer("call-zzz", "call-zzz", video=False))
check("an audio call's group holds 6", to(o2, o2[0][0], "joined")[0]["kind"] == "audio" and to(o2, o2[0][0], "joined")[0]["max"] == 6)

section("*** a screen joins ONLY by being picked to answer a call rung into the group ***")
P1, P2 = Conn("P1-screen"), Conn("P2-screen")
check("a screen of ANOTHER call session is not let in", G.screen_won(P1, "pat", ROOM_P, "call-other") == [])
check("a screen of ANOTHER person, same session id, is not let in", G.screen_won(P1, "pat", ROOM_R, "call-aaa") == [])
out = G.screen_won(P1, "pat", ROOM_P, "call-aaa")
jp = to(out, P1, "joined")
check("the screen the server picked joins", len(jp) == 1, str(out))
check("it is told who rang it (its leg) and who else is there", jp[0]["leg"] == a_peer
      and [m["peer"] for m in jp[0]["members"]] == [a_peer], str(jp))
pj = to(out, A, "peer-joined")
check("the caller hears it joined, named by the SERVER (the person's name)", pj and pj[0]["peer"]["name"] == "Robin"
      and pj[0]["peer"]["role"] == "screen" and pj[0]["peer"]["leg"] == a_peer, str(pj))
p_peer = jp[0]["you"]
check("a re-claim of the same call (a reconnect) changes nothing", G.screen_won(P1, "pat", ROOM_P, "call-aaa") == [])
check("...and the other screen of the person, which lost the claim, never calls screen_won (nothing to test) - "
      "but if it did on the same session it would be a SECOND screen of one ring: the cap still holds",
      len(G.get("call-aaa").members) == 2)

section("another caller cannot ring into somebody else's group")
M = Conn("Mal")
relay, out = G.driver_offer(M, "mal", ROOM_Q, offer("call-mal", "call-aaa"))
check("*** a login that is not a caller in the group: the offer is NOT relayed - nothing rings ***", relay is False
      and to(out, M, "refused")[0]["reason"] == "not-in-call", str(out))
check("...and no invitation was recorded for it", G.screen_won(Conn("Q-screen"), "quinn", ROOM_Q, "call-mal") == [])

section("the caller rings Gran's screen into the call (a second socket, the same login)")
AQ = Conn("A-on-Q")
relay, out = G.driver_offer(AQ, "mike", ROOM_Q, offer("call-bbb", "call-aaa"))
check("relayed: Gran's screens ring", relay and out == [], str(out))
Q1 = Conn("Q-screen")
out = G.screen_won(Q1, "quinn", ROOM_Q, "call-bbb")
jq = to(out, Q1, "joined")
check("Gran's screen joins, its leg is Mike (who rang it)", jq and jq[0]["leg"] == a_peer, str(out))
check("*** Mike's group socket hears it - not the second socket it rang on ***",
      to(out, A, "peer-joined") and not to(out, AQ), str(out))
check("Robin's screen hears it, with the leg, so it knows to connect to Gran itself",
      to(out, P1, "peer-joined")[0]["peer"]["leg"] == a_peer)
q_peer = jq[0]["you"]

section("*** a group signal goes to ONE member, from a member, with the server's `from` ***")
out = G.signal(P1, {"group": "call-aaa", "to": q_peer, "signal": {"kind": "offer", "sdp": "S", "by": "forged"}})
check("Robin's screen -> Gran's screen: only Gran's screen gets it", [c for c, _ in out] == [Q1], str(out))
check("`from` is the sender's peer id, written by the server; a page's `by` is dropped",
      out[0][1]["from"] == p_peer and "by" not in out[0][1]["signal"], str(out))
X = Conn("stranger")
check("*** a socket in no group cannot signal anybody ***",
      G.signal(X, {"group": "call-aaa", "to": q_peer, "signal": {"kind": "offer"}}) == [])
check("a member naming ANOTHER group's id is dropped",
      G.signal(P1, {"group": "call-zzz", "to": q_peer, "signal": {"kind": "offer"}}) == [])
check("a member signalling a peer id not in the group is dropped",
      G.signal(P1, {"group": "call-aaa", "to": "deadbeef", "signal": {"kind": "offer"}}) == [])
check("...or itself", G.signal(P1, {"group": "call-aaa", "to": p_peer, "signal": {"kind": "offer"}}) == [])

section("knocking: a second caller of Robin asks to join; a caller in the call decides")
S = Conn("Sam-on-P")
out = G.knock(S, "sam", ROOM_P, "driver")
kn = to(out, A, "knock")
check("Mike (a caller in the call) is asked, with Sam's name from the server", kn and kn[0]["name"] == "Sam", str(out))
check("*** the screens are NOT asked (a screen never decides) ***", not to(out, P1) and not to(out, Q1), str(out))
check("Sam is told he is waiting", to(out, S, "knocking"))
kid = kn[0]["knock"]
check("*** a SCREEN cannot let a knock in ***", G.answer_knock(P1, "call-aaa", kid, True) == [])
check("*** nor can a socket in no group ***", G.answer_knock(X, "call-aaa", kid, True) == [])
out = G.knock(Conn("scr2"), "pat", ROOM_P, "screen")
check("a screen cannot knock: refused", out and out[0][1]["reason"] == "not-allowed", str(out))
out = G.knock(Conn("w"), "wes", ROOM_R, "driver")
check("*** a knock on a person who is in no group call: refused, nothing reaches anybody ***",
      [m.get("reason") for _, m in out] == ["no-call"], str(out))
out = G.answer_knock(A, "call-aaa", kid, True)
js = to(out, S, "joined")
check("Mike lets Sam in: Sam joins, with no leg (he connects to everybody)", js and js[0]["leg"] is None
      and len(js[0]["members"]) == 3, str(out))
check("everybody else hears Sam joined", all(to(out, c, "peer-joined") for c in (A, P1, Q1)))
s_peer = js[0]["you"]
check("the group is full now (4 on video)", len(G.get("call-aaa").members) == 4)

section("the cap")
out = G.knock(Conn("Tia"), "tia", ROOM_P, "driver")
check("a knock on a full call: refused 'full'", [m.get("reason") for _, m in out] == ["full"], str(out))
relay, out = G.driver_offer(AQ, "mike", ROOM_R, offer("call-ccc", "call-aaa"))
check("*** ringing a fifth person into a full video call: NOT relayed ***", relay is False
      and to(out, AQ, "refused")[0]["reason"] == "full", str(out))

section("leaving")
out = G.leave(S)
check("Sam leaves: the others are told", all(to(out, c, "peer-left") for c in (A, P1, Q1)) and not to(out, S), str(out))
check("a group signal to Sam's old id goes nowhere", G.signal(P1, {"group": "call-aaa", "to": s_peer, "signal": {"kind": "offer"}}) == [])
check("*** and Sam, out, cannot signal in ***", G.signal(S, {"group": "call-aaa", "to": p_peer, "signal": {"kind": "offer"}}) == [])

section("two rings at once cannot both get past the cap")
H = CallGroups(now=Clock())
h = Conn("h")
_, o = H.driver_offer(h, "mike", ROOM_P, offer("s1", "g-h"))
H.screen_won(Conn("p"), "pat", ROOM_P, "s1")
H.driver_offer(Conn("hq"), "mike", ROOM_Q, offer("s2", "g-h"))         # 3rd, ringing
r3, _ = H.driver_offer(Conn("hr"), "mike", ROOM_R, offer("s3", "g-h"))  # 4th, ringing
r4, o4 = H.driver_offer(Conn("hx"), "mike", ("x", "y"), offer("s4", "g-h"))
check("members + screens still ringing count: the 4th is rung, a 5th is not", r3 and r4 is False, str(o4))
H.call_ended(("x", "y"), "s3")
H.call_ended(ROOM_R, "s3")
r5, _ = H.driver_offer(Conn("hy"), "mike", ("x", "y"), offer("s5", "g-h"))
check("a ring that ended (declined, unanswered) frees its place", r5)

section("knocks end by themselves")
clock2 = Clock()
K = CallGroups(now=clock2)
kh = Conn("kh")
K.driver_offer(kh, "mike", ROOM_P, offer("s1", "g-k"))
K.screen_won(Conn("kp"), "pat", ROOM_P, "s1")
ks = Conn("ks")
K.knock(ks, "sam", ROOM_P, "driver")
clock2.advance(KNOCK_WAIT_S + 1)
out = K.sweep()
check("*** a knock nobody answers: the knocker is told 'unanswered', and the prompt goes from the caller's page ***",
      to(out, ks, "refused") and to(out, ks, "refused")[0]["reason"] == "unanswered" and to(out, kh, "knock-ended"), str(out))
check("a bounded number of knocks per group", MAX_KNOCKS_PER_GROUP == 4)
outs = [K.knock(Conn(f"k{i}"), f"u{i}", ROOM_P, "driver") for i in range(MAX_KNOCKS_PER_GROUP + 1)]
check("the one past the bound is refused 'busy'", [m.get("reason") for _, m in outs[-1] if m.get("op") == "refused"] == ["busy"])
out = K.left(kh)
check("the last caller leaves: every waiting knock is told 'ended', not left to wait",
      sum(1 for _, m in out if m.get("op") == "refused" and m.get("reason") == "ended") == MAX_KNOCKS_PER_GROUP, str(out))

section("a socket closing takes it out; an empty group is gone")
L = CallGroups(now=Clock())
la, lp = Conn("la"), Conn("lp")
L.driver_offer(la, "mike", ROOM_P, offer("s1", "g-l"))
L.screen_won(lp, "pat", ROOM_P, "s1")
out = L.left(la)
check("the caller's socket closed: the screen is told", to(out, lp, "peer-left"))
out = L.left(lp)
check("the last one leaves: no group left, no invitation left", len(L) == 0 and L.pending() == 0)
section("a new call on the same socket leaves the old group first")
N = CallGroups(now=Clock())
na = Conn("na")
N.driver_offer(na, "mike", ROOM_P, offer("s1", "g-1"))
N.screen_won(Conn("np"), "pat", ROOM_P, "s1")
_, out = N.driver_offer(na, "mike", ROOM_P, offer("s2", "g-2"))
check("...the screen in the old one hears the caller left; the caller is in the new one only",
      any(m.get("op") == "peer-left" for _, m in out) and N.group_of(na)[0].gid == "g-2", str(out))


# ------------------------------------------------------------------------------------------- the real socket
section("*** the real socket, end to end: three people, one call ***")
tmp = tempfile.mkdtemp(prefix="nimrod_groups_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "groups_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)


def H_(u):
    return {"X-Dev-User": u}


def J(o):
    return json.dumps(o)


robin = c.post("/api/people", json={"name": "Robin"}, headers=H_("pat")).json()["id"]
gran = c.post("/api/people", json={"name": "Gran"}, headers=H_("quinn")).json()["id"]
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "mike"}, headers=H_("pat"))
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "sam"}, headers=H_("pat"))
c.post(f"/api/people/{gran}/drive-grants", json={"subject_id": "mike"}, headers=H_("quinn"))
c.put("/api/me/display-name", json={"name": "Mike"}, headers=H_("mike"))
c.put("/api/me/display-name", json={"name": "Sam"}, headers=H_("sam"))


def drive_ws(u, person, role):
    t = c.post(f"/api/drive/ticket/{person}", headers=H_(u)).json()["ticket"]
    return c.websocket_connect(f"/api/drive/{person}?t={t}&role={role}")


def until(ws, pred, n=16):
    for _ in range(n):
        m = ws.receive_json()
        if pred(m):
            return m
    return None


def op_is(o):
    return lambda m: m.get("type") == "group" and m.get("op") == o


def quiet(ws):
    ws.send_text(J({"type": "ping"}))
    for _ in range(8):
        m = ws.receive_json()
        if m.get("type") == "pong":
            return True, None
        if m.get("type") != "presence":
            return False, m
    return False, "no pong"


check("a stranger cannot even get a ticket for Robin's screens",
      c.post(f"/api/drive/ticket/{robin}", headers=H_("mal")).status_code == 403)

with drive_ws("pat", robin, "screen") as P, drive_ws("mike", robin, "driver") as A, \
        drive_ws("quinn", gran, "screen") as Q, drive_ws("mike", gran, "driver") as AQ, \
        drive_ws("sam", robin, "driver") as S:
    # Mike calls Robin, tagged as a group.
    A.send_text(J({"type": "signal", "signal": offer("call-aaa", "call-aaa")}))
    ja = until(A, op_is("joined"))
    check("Mike's call made a group; he is told", ja is not None and ja["max"] == 4, str(ja))
    o = until(P, lambda m: m.get("type") == "signal")
    check("Robin's screen rings as for any call (the offer, with the group on it)",
          o and o["signal"]["kind"] == "offer" and o["signal"]["group"] == "call-aaa", str(o))
    P.send_text(J({"type": "claim", "purpose": "call", "session": "call-aaa"}))
    check("the screen is picked", until(P, lambda m: m.get("type") == "answerer")["you"] is True)
    jp = until(P, op_is("joined"))
    check("*** ...and joins the group, told its leg is Mike ***", jp and jp["leg"] == ja["you"], str(jp))
    pj = until(A, op_is("peer-joined"))
    check("Mike hears Robin's screen joined, named 'Robin' by the server", pj and pj["peer"]["name"] == "Robin", str(pj))

    # Sam (another caller of Robin) knocks.
    S.send_text(J({"type": "group", "op": "knock"}))
    kn = until(A, op_is("knock"))
    check("*** Sam knocks: Mike is asked, with Sam's own display name ***", kn and kn["name"] == "Sam", str(kn))
    check("Sam is told he is waiting", until(S, op_is("knocking")) is not None)
    ok, m = quiet(P)
    check("*** Robin's screen hears nothing of the knock ***", ok, str(m))
    P.send_text(J({"type": "group", "op": "admit", "group": "call-aaa", "knock": kn["knock"]}))
    ok, m = quiet(S)
    check("*** the screen tries to let him in: nothing happens ***", ok, str(m))
    A.send_text(J({"type": "group", "op": "admit", "group": "call-aaa", "knock": kn["knock"]}))
    js = until(S, op_is("joined"))
    check("Mike lets Sam in: Sam joins, with no leg", js and js["leg"] is None and len(js["members"]) == 2, str(js))
    until(A, op_is("knock-ended"))
    pj = until(P, op_is("peer-joined"))
    check("Robin's screen hears Sam joined (and connects to him itself)", pj and pj["peer"]["name"] == "Sam", str(pj))
    until(A, op_is("peer-joined"))

    # Robin's screen offers to Sam - through the server, to Sam only.
    P.send_text(J({"type": "group", "op": "signal", "group": "call-aaa", "to": js["you"],
                   "signal": {"kind": "offer", "sdp": "P-TO-S"}}))
    gs = until(S, op_is("signal"))
    check("*** the screen's offer reaches Sam, `from` the screen's id ***",
          gs and gs["signal"]["sdp"] == "P-TO-S" and gs["from"] == jp["you"], str(gs))
    ok, m = quiet(A)
    check("...and nobody else", ok, str(m))
    ok, m = quiet(Q)
    check("...not Gran's screen, in no group yet", ok, str(m))

    # Mike rings Gran's screen into the call.
    AQ.send_text(J({"type": "signal", "signal": offer("call-bbb", "call-aaa")}))
    o = until(Q, lambda m: m.get("type") == "signal")
    check("Gran's screen rings", o and o["signal"]["kind"] == "offer", str(o))
    Q.send_text(J({"type": "claim", "purpose": "call", "session": "call-bbb"}))
    until(Q, lambda m: m.get("type") == "answerer")
    jq = until(Q, op_is("joined"))
    check("*** Gran's screen joins: its leg is Mike, and it sees Robin's screen and Sam ***",
          jq and jq["leg"] == ja["you"] and sorted(x["name"] for x in jq["members"]) == ["Mike", "Robin", "Sam"], str(jq))
    check("the group is full", len(appmod._groups.get("call-aaa").members) == 4)

    # A verb from a group member is still only a driver's to send, and a group signal never becomes one.
    Q.send_text(J({"type": "group", "op": "signal", "group": "call-aaa", "to": jp["you"],
                   "signal": {"kind": "offer", "sdp": "Q-TO-P", "verb": "select"}}))
    gm = until(P, lambda m: m.get("type") == "verb" or (m.get("type") == "group" and m.get("op") == "signal"))
    check("*** a group signal arrives as a group signal - never as a verb ***",
          gm and gm["type"] == "group" and gm["op"] == "signal", str(gm))

    # A fifth: refused, nothing rings.
    AQ.send_text(J({"type": "signal", "signal": offer("call-ccc", "call-aaa")}))
    rf = until(AQ, op_is("refused"))
    check("*** a fifth person rung into the full video call: refused 'full' ***", rf and rf["reason"] == "full", str(rf))
    ok, m = quiet(Q)
    check("...and nothing rang", ok, str(m))
    S.send_text(J({"type": "group", "op": "leave"}))
    until(A, op_is("peer-left"))
    until(P, op_is("peer-left"))
    # Sam left: three in the call now. Mal cannot use any of this.
    with drive_ws("pat", robin, "driver") as owner_phone:
        owner_phone.send_text(J({"type": "group", "op": "signal", "group": "call-aaa", "to": jp["you"],
                                 "signal": {"kind": "offer", "sdp": "x"}}))
        ok, m = quiet(P)
        check("*** even the screen's OWNER, not in the call, cannot signal into it ***", ok, str(m))
    A.send_text(J({"type": "group", "op": "leave"}))
    pl = until(P, lambda m: op_is("peer-left")(m) and m.get("peer") == ja["you"])
    check("Mike leaves: Robin's screen is told", pl and pl["peer"] == ja["you"], str(pl))

check("*** every socket closed: no group left, no invitation left ***",
      len(appmod._groups) == 0 and appmod._groups.pending() == 0, f"{len(appmod._groups)} {appmod._groups.pending()}")

section("the relay hookup: an account setting, off, and not connected to anything")
r = c.get("/api/me/call-relay", headers=H_("mike"))
check("it reads, and is off by default", r.status_code == 200 and r.json()["enabled"] is False, r.text)
r = c.put("/api/me/call-relay", json={"enabled": True, "url": "wss://relay.example.org", "token_from": "own-server",
                                      "token_url": "https://relay.example.org/token"}, headers=H_("mike"))
check("a household's own relay and token address are saved", r.status_code == 200 and r.json()["url"] == "wss://relay.example.org", r.text)
r = c.put("/api/me/call-relay", json={"enabled": True, "url": "http://relay.example.org"}, headers=H_("mike"))
check("*** an address that is not wss:// (or https://) is refused - media setup never goes in the clear ***", r.status_code == 400, r.text)
r = c.put("/api/me/call-relay", json={"enabled": True, "url": "wss://r.example.org", "token_from": "own-server",
                                      "token_url": "javascript:alert(1)"}, headers=H_("mike"))
check("a token address that is not https:// is refused", r.status_code == 400, r.text)
r = c.put("/api/me/call-relay", json={"enabled": True, "url": "wss://r.example.org", "api_secret": "s3cr3t"},
          headers=H_("mike"))
check("*** an API secret sent to this route is NOT kept (no field for it) ***",
      r.status_code == 200 and "s3cr3t" not in json.dumps(r.json())
      and "s3cr3t" not in json.dumps(appmod.store.get_state("mike", appmod.ACCOUNT_SCOPE, "call-relay")), r.text)
check("it is one account's: another login reads its own (off)", c.get("/api/me/call-relay", headers=H_("sam")).json()["enabled"] is False)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
