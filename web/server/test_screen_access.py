"""Who may see a screen, drop-in calls, the guardian set, and a temporary permission on a call (Mike, 2026-10-12).

    py -3.13 test_screen_access.py

screen_access.py holds the rules; this proves each one alone, then through the real drive socket: seeing is refused
without "may see", the screen ASKS first by default and nobody answering means it does not start, the guardian set
changes the defaults and each permission is still changeable, a temporary permission ends with its call and after its
time, and an existing database keeps its grants - which do NOT turn into drop-in.
"""
import json
import os
import sys
import tempfile
import time

import screen_access as sa
from drive import Answerers, parse_message
from grants import may_drive
from screen_access import (ASK_CHOICES, ASK_DEFAULT_S, ASK_GRACE_S, LEND_CHOICES, LEND_DEFAULT_MIN, MAX_LEND_MIN,
                           YES_GRACE_S, SeeAccess, ask_seconds, entries_from, lend_minutes, name_for,
                           parse_lend, parse_see_answer, perms_for, see_decision)

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
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, s):
        self.t += s


def row(*people, **extra):
    return {"screenPeople": list(people), **extra}


# ------------------------------------------------------------------------------------------- the row
section("the list on the person's row")
r = row({"account": "mike", "name": "Mike"}, {"account": "mike", "name": "dup"}, {"name": "no account"}, "junk",
        {"account": "ann", "name": "Ann\x07 ", "see": "yes", "dropIn": 1, "guardian": True})
e = entries_from(r)
check("one entry per account; malformed ones are ignored", set(e) == {"mike", "ann"}, str(e))
check("a name is cleaned (no control characters, trimmed)", e["ann"]["name"] == "Ann", repr(e["ann"]["name"]))
check("*** a switch that is not a real true/false is NOT trusted as yes ***",
      "see" not in e["ann"] and "dropIn" not in e["ann"] and e["ann"]["guardian"] is True, str(e["ann"]))
check("no row, or a row with no list: nobody", entries_from(None) == {} and entries_from({"x": 1}) == {})
check("the name the owner gave", name_for(r, "mike") == "Mike" and name_for(r, "zed") == "")

section("*** the defaults: empty to start, ask first on ***")
OWN = "pat"
p = perms_for({}, "mike", OWN)
check("*** somebody not on the list may not see, and may not drop in ***", not p["see"] and not p["drop_in"], str(p))
p = perms_for(row({"account": "mike"}), "mike", OWN)
check("on the list with nothing ticked: still may not see (each permission is its own tick)", not p["see"], str(p))
p = perms_for(row({"account": "mike", "see": True}), "mike", OWN)
check("*** ticked 'may see': may see, and ASK FIRST is on by default ***", p["see"] and p["ask_first"], str(p))
p = perms_for(row({"account": "mike", "see": True, "seeAsk": False}), "mike", OWN)
check("'ask first' can be turned off for one person", p["see"] and not p["ask_first"], str(p))
p = perms_for(row({"account": "mike", "see": True}), "mike", None)
check("a person with no owner does not exist: nothing (no id oracle)", not p["see"] and not p["drop_in"])
p = perms_for({}, OWN, OWN)
check("the owner sees without asking by default, and does NOT drop in by default (a call waits for everybody)",
      p["see"] and not p["ask_first"] and not p["drop_in"], str(p))
p = perms_for(row({"account": OWN, "dropIn": True, "seeAsk": True}), OWN, OWN)
check("...and the owner can give themselves drop-in, and ask first, from the same list",
      p["drop_in"] and p["see"] and p["ask_first"], str(p))

section("*** the guardian set: a bundle of the separate permissions, each still changeable ***")
p = perms_for(row({"account": "mike", "guardian": True}), "mike", OWN)
check("*** the guardian set gives see WITHOUT asking and drop-in ***", p["guardian"] and p["see"] and not p["ask_first"]
      and p["drop_in"], str(p))
p = perms_for(row({"account": "mike", "guardian": True, "dropIn": False}), "mike", OWN)
check("*** ...and drop-in can still be turned off for a guardian ***", p["see"] and not p["drop_in"], str(p))
p = perms_for(row({"account": "mike", "guardian": True, "seeAsk": True}), "mike", OWN)
check("...ask first can be turned back on for a guardian", p["see"] and p["ask_first"], str(p))
p = perms_for(row({"account": "mike", "guardian": True, "see": False}), "mike", OWN)
check("...and seeing can be turned off for a guardian", not p["see"] and p["drop_in"], str(p))
p = perms_for(row({"account": "mike", "guardian": False, "dropIn": True}), "mike", OWN)
check("drop-in on its own, without the set (the bundle is not the only way in)", p["drop_in"] and not p["see"], str(p))
p = perms_for(row({"account": "mike", "guardian": True}), "ann", OWN)
check("one person's guardian set gives nobody else anything", not p["see"] and not p["drop_in"])

section("the decision when somebody starts seeing")
check("not allowed -> refused", see_decision({}, "mike", OWN) == ("refuse", "not-allowed"))
check("*** on the list, ask first -> ASK ***", see_decision(row({"account": "mike", "see": True}), "mike", OWN) == ("ask", "ask"))
check("on the list, not asking -> admitted",
      see_decision(row({"account": "mike", "see": True, "seeAsk": False}), "mike", OWN) == ("admit", "list"))
check("a guardian -> admitted without asking", see_decision(row({"account": "mike", "guardian": True}), "mike", OWN)[0] == "admit")
check("the owner -> admitted", see_decision({}, OWN, OWN) == ("admit", "owner"))
check("said yes a moment ago (a reconnect) -> admitted, not asked again",
      see_decision(row({"account": "mike", "see": True}), "mike", OWN, recent_yes=True) == ("admit", "yes"))
check("a recent yes does NOT let in somebody who may not see",
      see_decision({}, "mike", OWN, recent_yes=True) == ("refuse", "not-allowed"))
check("*** a temporary permission on a call lets the caller see, list or no list ***",
      see_decision({}, "mike", OWN, lent=True) == ("admit", "lent"))
check("no owner -> refused, even with a lend", see_decision({}, "mike", None, lent=True)[0] == "refuse")

section("the timings: each a setting with a default")
check(f"the ask stays {ASK_DEFAULT_S} s by default; 15/30/60 are the choices",
      ask_seconds({}) == 30 and ASK_CHOICES == (15, 30, 60) and ask_seconds({"seeAskSeconds": 60}) == 60)
check("a choice that is not one of them, or not a number, is the default",
      ask_seconds({"seeAskSeconds": 45}) == 30 and ask_seconds({"seeAskSeconds": "60"}) == 30
      and ask_seconds({"seeAskSeconds": True}) == 30)
check(f"the temporary permission lasts {LEND_DEFAULT_MIN} min by default; 15/30/60/120 are the choices",
      lend_minutes({}) == 60 and LEND_CHOICES == (15, 30, 60, 120) and lend_minutes({"lendMinutes": 15}) == 15)
check("what the screen asks for wins when it is in range, never past the cap",
      lend_minutes({}, 5) == 5 and lend_minutes({}, MAX_LEND_MIN + 1) == 60 and lend_minutes({}, 0) == 60
      and lend_minutes({}, True) == 60)

section("the wire")
check("a see-answer: an ask id and a real yes/no, nothing else",
      parse_see_answer({"type": "see-answer", "ask": "0123456789ab", "yes": True, "x": 1})
      == {"type": "see-answer", "ask": "0123456789ab", "yes": True})
check("a see-answer with a bad id or a 'yes' that is not a boolean is dropped",
      parse_see_answer({"ask": "nope", "yes": True}) is None and parse_see_answer({"ask": "0123456789ab", "yes": 1}) is None)
check("drive.py's parse_message hands both new types here",
      parse_message({"type": "see-answer", "ask": "0123456789ab", "yes": False})["yes"] is False
      and parse_message({"type": "lend", "what": "see", "session": "s1", "on": True})["what"] == "see")
check("*** a lend never carries an account from the page (the server knows who called) ***",
      parse_lend({"type": "lend", "what": "see", "session": "s1", "on": True, "to": "mal", "minutes": 30})
      == {"type": "lend", "what": "see", "session": "s1", "on": True, "minutes": 30})
check("*** a lend of 'drive' is refused today: every caller may already drive (argued in screen_access.py) ***",
      parse_lend({"what": "drive", "session": "s1", "on": True}) is None)
check("a lend with a bad session or no on/off is dropped",
      parse_lend({"what": "see", "session": "bad session", "on": True}) is None
      and parse_lend({"what": "see", "session": "s1"}) is None)

section("the call's caller, as the server recorded it")
A = Answerers()
A.driver_signal(("pat", "R"), {"kind": "offer", "purpose": "call", "session": "s1"}, "mike")
check("an offer records who placed it", A.caller(("pat", "R"), "call", "s1") == "mike")
A.driver_signal(("pat", "R"), {"kind": "offer", "purpose": "call", "session": "s2"})
check("an older caller with no user: unknown, never guessed", A.caller(("pat", "R"), "call", "s2") is None)
check("no such call: None", A.caller(("pat", "R"), "call", "nope") is None)

# ------------------------------------------------------------------------------------------- the state
section("asking: the first answer decides, and nobody answering means it does not start")
clk = Clock()
S = SeeAccess(now=clk, wall=lambda: 5_000_000.0)
ROOM, OTHER = ("pat", "R"), ("quinn", "G")
D, s1, s2 = object(), object(), object()
aid, out = S.open_ask(D, ROOM, "mike", "Mike", 30, [s1, s2])
check("the question goes to every screen of the person, with the name and the seconds",
      [(c, m["type"], m["name"], m["seconds"]) for c, m in out[:2]] == [(s1, "see-ask", "Mike", 30), (s2, "see-ask", "Mike", 30)], str(out))
check("the one asking is told it is waiting", out[-1] == (D, {"type": "follow-state", "state": "asking", "seconds": 30}))
check("it is asking", S.asking(D) and len(S.pending_for(ROOM)) == 1 and S.pending_for(OTHER) == [])
conn, out = S.answer(OTHER, aid, True, [])
check("*** an answer from ANOTHER person's screen does nothing ***", conn is None and out == [] and S.asking(D))
conn, out = S.answer(ROOM, aid, True, [s1, s2])
check("*** a yes lets them in, and every screen is told the question is gone ***",
      conn is D and {c for c, m in out if m["type"] == "see-ask-ended"} == {s1, s2})
conn, out = S.answer(ROOM, aid, False, [s1, s2])
check("a second answer to the same question does nothing (the first decided)", conn is None and out == [])
check("a yes is remembered while they see", S.recent_yes(ROOM, "mike"))
S.seeing(D, ROOM, "mike", "Mike", "yes")
check("who is seeing, by name, for 'Sharing your screen with ...'", S.names(ROOM, [D]) == ["Mike"] and S.names(OTHER, [D]) == [])
S.stopped(D)
check("stopping keeps the yes a little longer, for a reconnect", S.recent_yes(ROOM, "mike"))
clk.advance(YES_GRACE_S + 1)
check(f"*** ...and after {YES_GRACE_S} s it is asked again ***", not S.recent_yes(ROOM, "mike"))

aid, _ = S.open_ask(D, ROOM, "ann", "Ann", 30, [s1])
_, out = S.answer(ROOM, aid, False, [s1])
check("a no: the one asking is told 'declined'", (D, {"type": "follow-state", "state": "refused", "reason": "declined"}) in out)

aid, _ = S.open_ask(D, ROOM, "ann", "Ann", 30, [s1])
clk.advance(30)
out, _ = S.sweep(lambda room: [s1])
check("not before the screen's own time has passed (the server waits a few seconds longer)", out == [] and S.asking(D))
clk.advance(ASK_GRACE_S)
out, _ = S.sweep(lambda room: [s1])
check("*** NOBODY ANSWERED: the question goes from the screen by itself, and the seeing does not start ***",
      (s1, {"type": "see-ask-ended", "ask": aid}) in out
      and (D, {"type": "follow-state", "state": "refused", "reason": "unanswered"}) in out and not S.asking(D), str(out))

aid, _ = S.open_ask(D, ROOM, "ann", "Ann", 30, [s1])
out = S.withdraw(D, lambda room: [s1])
check("the one asking gives up (closes): the question goes from the screens", out == [(s1, {"type": "see-ask-ended", "ask": aid})])

section("*** a temporary permission: ends with the call, and after its time ***")
st = S.lend(ROOM, "c1", "mike", s1, 60)
check("lent: the caller may see", S.lent(ROOM, "mike") and not S.lent(ROOM, "ann") and not S.lent(OTHER, "mike"))
check("the screen is told until when (its clock, ms)", st["on"] and st["until"] == 5_000_000 + 3_600_000 and st["minutes"] == 60, str(st))
S.seeing(D, ROOM, "mike", "Mike", "lent")
check("the ones seeing only because of it are known", S.lent_followers(ROOM, "mike", [D]) == [D])
check("*** the call ends: the lend goes ***", S.end_lend(ROOM, "c1") == [(ROOM, "mike")] and not S.lent(ROOM, "mike"))
S.stopped(D)
S.lend(ROOM, "c2", "mike", s1, 15)
check("next due: the lend's time", abs(S.next_due() - 15 * 60) < 0.01, str(S.next_due()))
clk.advance(15 * 60)
out, gone = S.sweep(lambda room: [s1])
check("*** after its time it ends by itself, and the screen is told ***", gone == [(ROOM, "mike")] and
      (s1, {"type": "lend-state", "what": "see", "session": "c2", "on": False, "reason": "time"}) in out)
S.lend(ROOM, "c3", "mike", s1, 60)
check("the screen that lent it closes: the lend goes with it", S.screen_left(s1) == [(ROOM, "mike")] and not S.lent(ROOM, "mike"))
check("nothing left over", len(S) == 0 and S.next_due() is None, str(len(S)))

# ------------------------------------------------------------------------------------------- the real socket
section("*** the real socket, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_see_")
DB = os.path.join(tmp, "see_test.db")
os.environ["NIMROD_DB"] = DB
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

c = TestClient(appmod.app)
clk = Clock(time.monotonic())
appmod._see.now = clk


def H_(u):
    return {"X-Dev-User": u}


def J(o):
    return json.dumps(o)


robin = c.post("/api/people", json={"name": "Robin"}, headers=H_("pat")).json()["id"]
for who in ("mike", "ann"):
    c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": who}, headers=H_("pat"))
version = [0]


def set_row(data):
    r_ = c.put(f"/api/people/{robin}/state/input-bindings", headers=H_("pat"),
               json={"data": data, "base_version": version[0]})
    version[0] = r_.json().get("version", version[0] + 1)
    return r_


def ws_for(u, role, follow=False):
    t = c.post(f"/api/drive/ticket/{robin}", headers=H_(u)).json()["ticket"]
    return c.websocket_connect(f"/api/drive/{robin}?t={t}&role={role}" + ("&follow=1" if follow else ""))


def drain(ws, n=0):
    ws.send_text(J({"type": "ping", "n": n}))
    got = []
    for _ in range(200):
        m = ws.receive_json()
        if m.get("type") == "pong" and m.get("n") == n:
            return got
        got.append(m)
    return got


def of(msgs, t):
    return [m for m in msgs if m.get("type") == t]


def last_presence(msgs):
    ps = of(msgs, "presence")
    return ps[-1] if ps else None


with ws_for("pat", "screen") as P:
    drain(P)
    with ws_for("mike", "driver", follow=True) as M:
        got = drain(M)
        fs = of(got, "follow-state")
        check("*** following WITHOUT 'may see' is refused (the list starts empty) ***",
              fs and fs[-1]["state"] == "refused" and fs[-1]["reason"] == "not-allowed", str(got))
        got = drain(P)
        pr = last_presence(got)
        check("*** the screen never counts somebody refused as helping, and there is no question on it ***",
              pr and pr["drivers"] == 0 and pr["followers"] == 0 and not of(got, "see-ask"), str(got))
        M.send_text(J({"type": "verb", "verb": "next"}))
        drain(M)
        check("...and a refused watch-only socket presses nothing", not of(drain(P), "verb"))

    with ws_for("pat", "driver", follow=True) as O:
        drain(O)
        got = drain(P)
        pr = last_presence(got)
        check("the owner sees without being asked", pr and pr["followers"] == 1 and not of(got, "see-ask"), str(got))
        check("...and with no name known, `watchers` is empty (the screen says 'someone')", pr and pr["watchers"] == [], str(pr))
    drain(P)

    set_row({"screenPeople": [{"account": "mike", "name": "Mike", "see": True},
                              {"account": "ann", "name": "Ann", "see": True}]})
    with ws_for("mike", "driver", follow=True) as M:
        got_m = drain(M)
        got = drain(P)
        asks = of(got, "see-ask")
        check("*** on the list: the screen ASKS FIRST (by default), naming who asks ***",
              len(asks) == 1 and asks[0]["name"] == "Mike" and asks[0]["seconds"] == 30, str(got))
        check("the one asking is told it is waiting", of(got_m, "follow-state")[-1]["state"] == "asking", str(got_m))
        check("while it waits it is not seeing and not helping", last_presence(got) and last_presence(got)["drivers"] == 0
              and last_presence(got)["followers"] == 0, str(got))
        with ws_for("pat", "screen") as P2:
            got2 = drain(P2)
            check("a screen that joins mid-ask is shown the question too", of(got2, "see-ask") and
                  of(got2, "see-ask")[0]["ask"] == asks[0]["ask"], str(got2))
            P.send_text(J({"type": "see-answer", "ask": asks[0]["ask"], "yes": True}))
            drain(P)
            got_m = drain(M)
            check("*** a yes on the screen: they see now ***", of(got_m, "follow-state")[-1]["state"] == "on", str(got_m))
            got = drain(P2)
            check("the other screen is told the question is gone", of(got, "see-ask-ended"), str(got))
            pr = last_presence(got)
            check("*** 'Sharing your screen with Mike': the screens get the name ***",
                  pr and pr["followers"] == 1 and pr["watchers"] == ["Mike"], str(pr))
        got = drain(P)
    check("the yes outlasts the socket a moment (a reconnect is not asked again)",
          appmod._see.recent_yes((appmod._person_owner(robin), robin), "mike"))
    with ws_for("mike", "driver", follow=True) as M:
        got_m = drain(M)
        check("...reconnecting straight away: no second question", of(got_m, "follow-state")[-1]["state"] == "on"
              and not of(drain(P), "see-ask"), str(got_m))
    drain(P)

    with ws_for("ann", "driver", follow=True) as A_:
        drain(A_)
        asks = of(drain(P), "see-ask")
        P.send_text(J({"type": "see-answer", "ask": asks[0]["ask"], "yes": False}))
        drain(P)
        fs = of(drain(A_), "follow-state")
        check("*** 'Not now' on the screen: refused, declined ***", fs[-1] == {"type": "follow-state", "state": "refused",
              "reason": "declined"}, str(fs))
    drain(P)

    with ws_for("ann", "driver", follow=True) as A_:
        drain(A_)
        asks = of(drain(P), "see-ask")
        check("(setup) asked again on a new socket", len(asks) == 1)
        clk.advance(ASK_DEFAULT_S + ASK_GRACE_S + 1)
        got_a = drain(A_)
        fs = of(got_a, "follow-state")
        check("*** NOBODY ANSWERED: the seeing does not start ***", fs and fs[-1]["reason"] == "unanswered", str(got_a))
        got = drain(P)
        check("*** ...and the question went from the screen by itself (never a blocked screen) ***",
              of(got, "see-ask-ended") and of(got, "see-ask-ended")[0]["ask"] == asks[0]["ask"], str(got))
    drain(P)

    set_row({"screenPeople": [{"account": "ann", "name": "Ann", "guardian": True}]})
    with ws_for("ann", "driver", follow=True) as A_:
        got_a = drain(A_)
        got = drain(P)
        check("*** the guardian set: sees without asking, and the screen still SAYS so ***",
              of(got_a, "follow-state")[-1]["state"] == "on" and not of(got, "see-ask")
              and last_presence(got)["watchers"] == ["Ann"], str(got))
    drain(P)
    set_row({"screenPeople": [{"account": "ann", "name": "Ann", "guardian": True, "seeAsk": True}]})
    with ws_for("ann", "driver", follow=True) as A_:
        drain(A_)
        check("a guardian with 'ask first' turned back on is asked", of(drain(P), "see-ask"))
    drain(P)
    set_row({"screenPeople": [{"account": "ann", "name": "Ann", "guardian": True, "see": False}]})
    with ws_for("ann", "driver", follow=True) as A_:
        fs = of(drain(A_), "follow-state")
        check("a guardian with seeing turned off is refused", fs[-1]["reason"] == "not-allowed", str(fs))
    drain(P)

    section("*** a temporary permission during a call ***")
    set_row({"screenPeople": []})
    with ws_for("mike", "driver") as CALL, ws_for("pat", "screen") as P2:
        drain(CALL)
        drain(P2)
        drain(P)
        CALL.send_text(J({"type": "signal", "signal": {"kind": "offer", "sdp": "v=0", "purpose": "call", "session": "c1"}}))
        drain(CALL)
        drain(P)
        drain(P2)
        P2.send_text(J({"type": "lend", "what": "see", "session": "c1", "on": True}))
        ls = of(drain(P2), "lend-state")
        check("a screen that did NOT answer the call cannot lend anything on it",
              ls and ls[-1]["on"] is False and ls[-1]["reason"] == "not-this-call", str(ls))
        P.send_text(J({"type": "claim", "purpose": "call", "session": "c1"}))
        drain(P)
        with ws_for("mike", "driver", follow=True) as F:
            fs = of(drain(F), "follow-state")
            check("(before the lend) the caller is not on the list: refused", fs[-1]["reason"] == "not-allowed", str(fs))
        drain(P)
        P.send_text(J({"type": "lend", "what": "see", "session": "c1", "on": True}))
        ls = of(drain(P), "lend-state")
        check("*** the screen that answered lends 'see this screen' to the caller, for 60 minutes by default ***",
              ls and ls[-1]["on"] is True and ls[-1]["minutes"] == 60, str(ls))
        with ws_for("mike", "driver", follow=True) as F:
            fs = of(drain(F), "follow-state")
            check("*** the caller may see now, list or no list ***", fs[-1]["state"] == "on" and fs[-1]["via"] == "lent", str(fs))
            drain(P)
            with ws_for("ann", "driver", follow=True) as A_:
                fs = of(drain(A_), "follow-state")
                check("...and only the caller: somebody else still may not", fs[-1]["reason"] == "not-allowed", str(fs))
            drain(P)
            CALL.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "call", "session": "c1"}}))
            drain(CALL)
            fs = of(drain(F), "follow-state")
            check("*** THE CALL ENDS: so does the seeing ***", fs and fs[-1] == {"type": "follow-state", "state": "refused",
                  "reason": "ended"}, str(fs))
            pr = last_presence(drain(P))
            check("...and the screen stops saying it is shared", pr and pr["followers"] == 0, str(pr))
        drain(P)
        drain(P2)
        CALL.send_text(J({"type": "signal", "signal": {"kind": "offer", "sdp": "v=0", "purpose": "call", "session": "c2"}}))
        drain(CALL)
        drain(P2)
        P.send_text(J({"type": "claim", "purpose": "call", "session": "c2"}))
        drain(P)
        P.send_text(J({"type": "lend", "what": "see", "session": "c2", "on": True, "minutes": 15}))
        ls = of(drain(P), "lend-state")
        check("a shorter time can be asked for", ls and ls[-1]["minutes"] == 15, str(ls))
        with ws_for("mike", "driver", follow=True) as F:
            drain(F)
            drain(P)
            clk.advance(15 * 60 + 1)
            fs = of(drain(F), "follow-state")
            check("*** AFTER ITS TIME the temporary permission ends by itself, call or no call ***",
                  fs and fs[-1]["reason"] == "ended", str(fs))
            ls = of(drain(P), "lend-state")
            check("...and the screen is told", ls and ls[-1]["on"] is False and ls[-1]["reason"] == "time", str(ls))
        drain(P)
        P.send_text(J({"type": "lend", "what": "see", "session": "c2", "on": False}))
        check("taking it back is answered", of(drain(P), "lend-state")[-1]["on"] is False)

    section("the outer wall is still the drive grant")
    set_row({"screenPeople": [{"account": "mike", "name": "Mike", "guardian": True}]})
    gid = next(g["id"] for g in c.get(f"/api/people/{robin}/drive-grants", headers=H_("pat")).json()["grants"]
               if g["subject_id"] == "mike")
    c.delete(f"/api/people/{robin}/drive-grants/{gid}", headers=H_("pat"))
    check("*** on the list as a guardian but with no drive grant: no socket at all ***",
          c.post(f"/api/drive/ticket/{robin}", headers=H_("mike")).status_code == 403)

check("every socket closed: nothing held about any of them", len(appmod._see) == 0 and len(appmod._plays) == 0,
      f"{len(appmod._see)} {len(appmod._plays)}")

# ------------------------------------------------------------------------------------------- migration
section("*** an existing database: grants keep working, and none of them becomes drop-in ***")
from db import SQLiteStore, person_scope  # noqa: E402

DB2 = os.path.join(tmp, "existing.db")
s = SQLiteStore(DB2)
pid = s.create_person("owner1", "Robin")["id"]
g =s.add_grant("owner1", pid, "account", "family1", label="", expires_at=None, role="moderator")
s.put_state("owner1", person_scope(pid), "input-bindings",
            {"intercomAllowed": [{"account": "family1", "name": "Fam"}], "noteWriters": ["family1"]}, 0)
try:
    s.close()
except Exception:
    pass
s2 = SQLiteStore(DB2)          # opening again runs every migration on the existing file
grants = s2.grants_on_person(pid)
check("the existing grant is still there, unchanged", len(grants) == 1 and grants[0]["subject_id"] == "family1"
      and grants[0]["id"] == g["id"], str(grants))
check("*** ...and it still lets them drive (and so call) ***",
      may_drive(pid, account="family1", owner=s2.person_owner(pid), grants=grants, now_iso="2026-10-12T00:00:00+00:00"))
old_row = s2.get_state("owner1", person_scope(pid), "input-bindings").get("data")
p = perms_for(old_row, "family1", s2.person_owner(pid))
check("*** an existing drive grant does NOT become drop-in, and does not become 'may see' (both start empty) ***",
      not p["drop_in"] and not p["see"], str(p))
check("the row's other lists are untouched", old_row.get("intercomAllowed") == [{"account": "family1", "name": "Fam"}])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
