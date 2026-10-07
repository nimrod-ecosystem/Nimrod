"""Game rooms - playing together from more than one screen. The rules, then the socket.

    py -3.13 test_game_rooms.py

Two halves, like test_claims.py. The rules are pure and live in game_rooms.py; every security rule is checked
there with an injected clock. Then the real socket, through FastAPI's TestClient against a throwaway database:
the ticket, the same login, a connected login asking and being let in, a stranger refused, the call room's
invitation reaching the CALLERS and never a screen. Names are made up.
"""
import json
import os
import sys
import tempfile

import game_rooms as G
from game_rooms import (ADMIT_WAIT_S, CODE_ALPHABET, CODE_LEN, DEVICE_GONE_S, GAME_KINDS, HOST_GONE_S, JOIN_MISSES,
                        MAX_GAME_BYTES, MAX_POINTS, MAX_ROOMS_PER_ACCOUNT, MAX_SEATS, RATE_BURST, ROOM_IDLE_S,
                        ROOM_MAX_S, SEAT_AWAY_S, TURN_MAX_S, GameRooms, normalize_code, parse_game)

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
    """A stand-in socket: only its identity matters to game_rooms."""

    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return f"<{self.name}>"


J = json.dumps

# ---------------------------------------------------------------------------------------------- the wire
section("what may cross the wire: a fixed list of kinds, every field copied, nothing else")
check("*** the kinds are exactly these seven ***", GAME_KINDS == {"room", "join", "admit", "turn", "answer", "leave", "ping"},
      str(sorted(GAME_KINDS)))
from drive import DRIVE_VERBS, SIGNAL_KINDS  # noqa: E402
check("*** no drive verb is a game kind, and no game kind is 'verb', 'signal' or 'claim' (never a press) ***",
      not (GAME_KINDS & set(DRIVE_VERBS)) and not ({"verb", "signal", "claim"} & GAME_KINDS))
check("a call signal sent here is dropped (a signal's own shape is not a game message)",
      all(parse_game(J({"type": "signal", "signal": {"kind": k, "sdp": "x"}})) is None for k in SIGNAL_KINDS))
check("a drive verb sent here is dropped", parse_game(J({"type": "verb", "verb": "select"})) is None
      and parse_game(J({"kind": "verb", "verb": "select"})) is None and parse_game(J({"kind": "select"})) is None)
check("an unknown kind is dropped", parse_game(J({"kind": "offer", "sdp": "x"})) is None)
check("not JSON, not an object: dropped", parse_game("{nope") is None and parse_game(J([1, 2])) is None and parse_game(J("ping")) is None)
big = J({"kind": "join", "code": "ABCDEF", "seats": [{"name": "A"}], "pad": "x" * MAX_GAME_BYTES})
check(f"*** bigger than {MAX_GAME_BYTES} bytes: dropped before it is parsed ***", parse_game(big) is None)
wide = json.dumps({"kind": "join", "code": "ABCDEF", "seats": [{"name": "é" * 2500}]}, ensure_ascii=False)
check("the cap is on BYTES, not characters", len(wide) <= MAX_GAME_BYTES and len(wide.encode()) > MAX_GAME_BYTES
      and parse_game(wide) is None, str(len(wide.encode())))
p = parse_game(J({"kind": "answer", "seat": "d1.0", "serial": 3, "category": {"group": "math", "id": "math", "label": "x"},
                  "right": True, "points": 2, "level": 7, "rating": 1450, "question": "2+2", "verb": "select"}))
check("*** an answer carries exactly seat, serial, category, right, points - no level, rating or question ***",
      p == {"kind": "answer", "seat": "d1.0", "serial": 3, "category": {"group": "math", "id": "math"}, "right": True, "points": 2}, str(p))
check(f"points above {MAX_POINTS}: dropped", parse_game(J({"kind": "answer", "seat": "d1.0", "serial": 3,
      "category": {"group": "math", "id": "math"}, "right": True, "points": MAX_POINTS + 1})) is None)
w = parse_game(J({"kind": "answer", "seat": "d1.0", "serial": 3, "category": {"group": "math", "id": "math"}, "right": False, "points": 3}))
check("*** a wrong answer earns nothing, whatever the screen claims ***", w and w["points"] == 0, str(w))
check("true where a number belongs is not a number", parse_game(J({"kind": "answer", "seat": "d1.0", "serial": True,
      "category": {"group": "math", "id": "math"}, "right": True, "points": 1})) is None)
check("a seat that is not a seat id: dropped", parse_game(J({"kind": "answer", "seat": "../x", "serial": 1,
      "category": {"group": "math", "id": "math"}, "right": True, "points": 1})) is None)
j = parse_game(J({"kind": "join", "code": "kx4-9pm", "seats": [{"name": "  Ann\u0007  Lee "}, "Bo"]}))
check("a join: the code read as typed, names cleaned of control characters", j == {"kind": "join", "code": "KX49PM",
      "seats": ["Ann Lee", "Bo"]}, str(j))
check(f"a join with more than {MAX_SEATS} seats, or none: dropped",
      parse_game(J({"kind": "join", "code": "KX49PM", "seats": ["a"] * (MAX_SEATS + 1)})) is None
      and parse_game(J({"kind": "join", "code": "KX49PM", "seats": []})) is None)
check("codes: six from the unambiguous alphabet (no I, L, O, 0, 1)", normalize_code("KX49PM") == "KX49PM"
      and normalize_code("KX49P0") is None and normalize_code("KX49P") is None and normalize_code(42) is None
      and CODE_LEN == 6 and not set("ILO01") & set(CODE_ALPHABET))
s = parse_game(J({"kind": "room", "state": {"phase": "playing", "round": 2, "rounds": 10, "turn": "d1.0",
                                             "category": {"group": "trivia", "id": "trivia:space", "label": "Space"},
                                             "totals": {"d0.0": 3}, "script": "<x>"}}))
check("the host's state: fields copied one by one, anything else gone", s and "script" not in s["state"]
      and s["state"]["totals"] == {"d0.0": 3} and s["state"]["category"]["label"] == "Space", str(s))
check("a state with an unknown phase: dropped", parse_game(J({"kind": "room", "state": {"phase": "hack"}})) is None)
check("a room message with nothing in it: dropped", parse_game(J({"kind": "room"})) is None)
check("open: only a game this server knows", parse_game(J({"kind": "room", "open": {"game": "poker", "seats": ["A"]}})) is None)


# ---------------------------------------------------------------------------------------------- a room
def rel_of(table):
    """relation(account, host, call_person) from a little table."""
    def relation(a, host, call_person):
        if a == host:
            return "same"
        if (a, host) in table.get("linked", set()) or (host, a) in table.get("linked", set()):
            return "connected"
        if call_person and (a, call_person) in table.get("may", set()):
            return "call"
        return None
    return relation


def mk(clock=None, table=None, codes=None):
    clock = clock or Clock()
    table = table or {}
    it = iter(codes or ["KX49PM", "QQ2345", "RR2345", "SS2345", "TT2345"])
    rooms = GameRooms(relation=rel_of(table), may_person=lambda a, p: (a, p) in table.get("may", set()),
                      name_of=lambda a: {"oscar": "Oscar Lane"}.get(a, ""), now=clock, code=lambda: next(it))
    return rooms, clock


def to(out, conn):
    return [m for c, m in out if c is conn]


def kinds(out, conn):
    return [m.get("kind") for m in to(out, conn)]


def op(rooms, conn, acct, seats=("Pat",), admit="ask", person=None):
    o = {"game": "quiz_mix", "seats": [{"name": n} for n in seats], "admit": admit}
    if person:
        o["person"] = person
    return rooms.handle(conn, acct, J({"kind": "room", "open": o}))


def jn(rooms, conn, acct, code="KX49PM", seats=("Ann",), key=None):
    m = {"kind": "join", "code": code, "seats": [{"name": n} for n in seats]}
    if key:
        m["key"] = key
    return rooms.handle(conn, acct, J(m))


CAT = {"group": "math", "id": "math", "label": "Numbers"}

section("opening a room, and the same login joining by code")
R, clk = mk()
host, phone = Conn("host"), Conn("phone")
out = op(R, host, "pat", seats=("Pat", "Robin"))
opened = to(out, host)[0]
check("the host is told its code and its own key", opened["kind"] == "opened" and opened["code"] == "KX49PM"
      and opened["you"] == "d0" and len(opened["key"]) >= 16, str(opened))
view = to(out, host)[1]
check("...and sees the room: its two seats, d0.0 and d0.1, in the lobby", [s["id"] for s in view["seats"]] == ["d0.0", "d0.1"]
      and view["state"]["phase"] == "lobby" and view["waiting"] == [], str(view))
out = jn(R, phone, "pat", seats=("Sam",))
check("*** the same login joins at once ***", kinds(out, phone)[:1] == ["joined"] and to(out, phone)[0]["you"] == "d1", str(out))
hv = [m for m in to(out, host) if m["kind"] == "room"][-1]
check("...and every screen sees the seats and where they are", [(s["id"], s["device"]) for s in hv["seats"]]
      == [("d0.0", "d0"), ("d0.1", "d0"), ("d1.0", "d1")], str(hv["seats"]))
check("a guest's view does not carry the host's waiting list", "waiting" not in [m for m in to(out, phone) if m["kind"] == "room"][-1])
check("one room per connection: the host opening another is ignored", op(R, host, "pat") == [] and len(R) == 1)

section("*** a login that is not connected is refused - in the words used for a code that does not exist ***")
stranger = Conn("stranger")
o1 = jn(R, stranger, "mallory")
o2 = jn(R, Conn("s2"), "mallory", code="ZZ2345")
check("refused, and the refusal is the same as for a code nobody holds", to(o1, stranger) == [{"kind": "refused", "why": "no-room"}]
      and [m for _, m in o2] == [{"kind": "refused", "why": "no-room"}], f"{o1} {o2}")
check("the room is untouched: still two devices", len(R.room("KX49PM").devices) == 2)
for i in range(JOIN_MISSES):
    jn(R, Conn(f"g{i}"), "mallory", code="ZZ2345")
o3 = jn(R, Conn("late"), "mallory")
check(f"*** after {JOIN_MISSES} wrong codes, that login gets nothing for a while - even for a live code ***",
      [m for _, m in o3] == [{"kind": "refused", "why": "no-room"}], str(o3))
clk.advance(G.JOIN_MISS_WINDOW_S + 1)
R.handle(host, "pat", J({"kind": "ping"}))     # keep the room touched
check("...and the throttle wears off", not R._throttled("mallory"))

section("a connected login asks; the host sees who, and lets them in (or not)")
R, clk = mk(table={"linked": {("oscar", "pat"), ("una", "pat")}})
host, osc, una = Conn("host"), Conn("osc"), Conn("una")
op(R, host, "pat")
out = jn(R, osc, "oscar", seats=("Oscar",))
check("*** a connected login waits for the host ***", kinds(out, osc) == ["waiting"], str(out))
hv = to(out, host)[0]
check("the host sees who wants in: their seat names AND the login's own name (which they cannot type)",
      hv["waiting"] == [{"id": "w1", "names": ["Oscar"], "how": "connected", "from": "Oscar Lane"}], str(hv))
out = R.handle(osc, "oscar", J({"kind": "admit", "id": "w1", "yes": True}))
check("*** a guest cannot let itself in ***", out == [] and "w1" in R.room("KX49PM").waiting)
out = R.handle(host, "pat", J({"kind": "admit", "id": "w1", "yes": True}))
check("the host lets them in: joined, with a seat of their own", kinds(out, osc)[0] == "joined"
      and [s["id"] for s in R.room("KX49PM").seats] == ["d0.0", "d1.0"], str(out))
jn(R, una, "una")
out = R.handle(host, "pat", J({"kind": "admit", "id": "w2", "yes": False}))
check("the host says not now: refused, in plain terms", to(out, una) == [{"kind": "refused", "code": "KX49PM", "why": "declined"}])
R2, _ = mk(table={"linked": {("oscar", "pat")}})
h2, o2c = Conn("h2"), Conn("o2")
op(R2, h2, "pat", admit="connected")
check("*** with \"anyone connected may join\", a connected login joins at once ***", kinds(jn(R2, o2c, "oscar"), o2c)[0] == "joined")
R2.handle(h2, "pat", J({"kind": "room", "admit": "ask"}))
check("the host can change that while the room is open", R2.room("KX49PM").admit == "ask")

section("the seats fill up")
R, clk = mk()
host = Conn("host")
op(R, host, "pat", seats=("A", "B", "C"))
out = jn(R, Conn("p"), "pat", seats=("D", "E"))
check(f"*** a join that would make more than {MAX_SEATS} seats is refused, saying how many are free ***",
      [m for _, m in out] == [{"kind": "refused", "code": "KX49PM", "why": "full", "free": 1}], str(out))
check("...nobody is dropped silently: the room still has three", len(R.room("KX49PM").seats) == 3)

section("*** only the host changes the game ***")
R, clk = mk()
host, phone = Conn("host"), Conn("phone")
op(R, host, "pat")
jn(R, phone, "pat")
before = json.dumps(R.room("KX49PM").state)
st = {"kind": "room", "state": {"phase": "playing", "round": 9, "rounds": 10, "totals": {"d1.0": 999}, "turn": "d1.0"}}
check("a guest sending the table: dropped, nothing changes", R.handle(phone, "pat", J(st)) == []
      and json.dumps(R.room("KX49PM").state) == before)
check("a guest giving out a turn: dropped", R.handle(phone, "pat", J({"kind": "turn", "seat": "d1.0", "serial": 1, "category": CAT})) == [])
check("a guest removing the host or another screen: dropped", R.handle(phone, "pat", J({"kind": "leave", "id": "d0"})) != []
      and "KX49PM" in R._rooms and R.room("KX49PM").devices.get("d0") is not None)
# (the leave above removed the PHONE itself - a guest's leave is always its own; rejoin for the rest)
phone = Conn("phone2")
jn(R, phone, "pat")
out = R.handle(host, "pat", J({"kind": "room", "state": {"phase": "playing", "round": 1, "rounds": 10,
                                                         "totals": {"d0.0": 2, "d7.0": 5}, "turn": "d7.0"}}))
check("the host's table: seats that are not in the room are taken out, and a turn for nobody is no turn",
      R.room("KX49PM").state["totals"] == {"d0.0": 2} and R.room("KX49PM").state["turn"] is None, str(R.room("KX49PM").state))
check("...and every screen sees the host's table", all(m["state"]["round"] == 1 for _, m in out if m["kind"] == "room") and len(out) == 2)

section("a turn goes to ONE screen; the answer comes back to the host only")
seat = R.room("KX49PM").seats[-1]["id"]
out = R.handle(host, "pat", J({"kind": "turn", "seat": seat, "serial": 5, "round": 1, "category": CAT}))
check("*** the turn goes to the seat's own screen and nowhere else ***", [c for c, _ in out] == [phone]
      and to(out, phone)[0] == {"kind": "turn", "seat": seat, "serial": 5, "round": 1, "category": CAT}, str(out))
check("the host giving a turn to its own seat: nothing sent (it plays those itself)",
      R.handle(host, "pat", J({"kind": "turn", "seat": "d0.0", "serial": 6, "round": 1, "category": CAT})) == [])
R.handle(host, "pat", J({"kind": "turn", "seat": seat, "serial": 5, "round": 1, "category": CAT}))
ans = {"kind": "answer", "seat": seat, "serial": 4, "category": {"group": "math", "id": "math"}, "right": True, "points": 2}
check("an answer for an old turn: dropped", R.handle(phone, "pat", J(ans)) == [])
other = Conn("other")
jn(R, other, "pat", seats=("Zed",))
check("*** an answer from a screen that does not hold the seat: dropped ***",
      R.handle(other, "pat", J({**ans, "serial": 5})) == [])
check("an answer from the host for a guest's seat: dropped", R.handle(host, "pat", J({**ans, "serial": 5})) == [])
out = R.handle(phone, "pat", J({**ans, "serial": 5}))
check("*** the right screen, the right turn: to the host only, exactly the five fields ***",
      [c for c, _ in out] == [host] and to(out, host)[0] == {"kind": "answer", "seat": seat, "serial": 5,
                                                             "category": {"group": "math", "id": "math"}, "right": True, "points": 2}, str(out))
check("a second answer to the same turn: dropped", R.handle(phone, "pat", J({**ans, "serial": 5})) == [])

section("*** a seat whose screen dropped on its turn is skipped after a while; nobody waits on a dead screen ***")
R.handle(host, "pat", J({"kind": "turn", "seat": seat, "serial": 7, "round": 1, "category": CAT}))
out = R.dropped(phone)
check("its screen drops: every screen sees the seat as away", any(s["away"] for _, m in out if m["kind"] == "room"
                                                                  for s in m["seats"] if s["id"] == seat))
clk.advance(SEAT_AWAY_S - 1)
check("not yet skipped (a blip is not a leaving)", not [m for _, m in R.sweep() if m.get("kind") == "answer"])
clk.advance(2)
out = R.sweep()
sk = [m for c, m in out if m.get("kind") == "answer"]
check(f"*** after {SEAT_AWAY_S} s: the host is told the turn is skipped ***", sk and sk[0]["skipped"] is True
      and sk[0]["why"] == "away" and sk[0]["points"] == 0 and sk[0]["seat"] == seat, str(out))
key = None
# The phone comes back with its key: its seats are its own again.
dev = R.room("KX49PM").devices["d1"] if "d1" in R.room("KX49PM").devices else None
devs = {d.id: d for d in R.room("KX49PM").devices.values()}
back_dev = next(d for d in devs.values() if d.conn is None)
phone3 = Conn("phone3")
out = jn(R, phone3, "pat", key=back_dev.key)
check("*** a dropped screen comes back with its key: its seats again, not new ones ***", to(out, phone3)[0]["kind"] == "joined"
      and to(out, phone3)[0]["you"] == back_dev.id and to(out, phone3)[0].get("resumed") is True, str(out))
out = jn(R, Conn("thief"), "mallory", key=back_dev.key)
check("another login holding that key gets nothing", [m for _, m in out] == [{"kind": "refused", "why": "no-room"}])
R.handle(host, "pat", J({"kind": "turn", "seat": seat, "serial": 8, "round": 1, "category": CAT}))
clk.advance(TURN_MAX_S + 1)
sk = [m for _, m in R.sweep() if m.get("kind") == "answer"]
check(f"*** a turn nobody answers is skipped after {TURN_MAX_S} s ***", sk and sk[0]["why"] == "time", str(sk))

section("the host drops, comes back; or does not, and the room closes")
R, clk = mk()
host, phone = Conn("host"), Conn("phone")
hkey = to(op(R, host, "pat"), host)[0]["key"]
jn(R, phone, "pat")
R.handle(host, "pat", J({"kind": "turn", "seat": "d1.0", "serial": 1, "round": 1, "category": CAT}))
out = R.dropped(host)
check("the host drops: the others are told", to(out, phone)[0]["hostAway"] is True)
R.handle(phone, "pat", J({"kind": "answer", "seat": "d1.0", "serial": 1, "category": CAT, "right": True, "points": 1}))
host2 = Conn("host2")
out = R.handle(host2, "pat", J({"kind": "room", "resume": {"code": "KX49PM", "key": "x" * 24}}))
check("a wrong key does not take the room", [m for _, m in out] == [{"kind": "refused", "why": "no-room"}])
out = R.handle(host2, "pat", J({"kind": "room", "resume": {"code": "KX49PM", "key": hkey}}))
check("*** the host comes back with its key; the answer that arrived meanwhile is handed over ***",
      kinds(out, host2)[0] == "opened" and "answer" in kinds(out, host2), str(kinds(out, host2)))
R.dropped(host2)
clk.advance(HOST_GONE_S + 1)
out = R.sweep()
check(f"*** the host gone more than {HOST_GONE_S} s: the room closes and every screen is told ***",
      to(out, phone) == [{"kind": "closed", "code": "KX49PM", "why": "host-gone"}] and len(R) == 0 and R.connections() == 0, str(out))

section("the host ends it; a guest leaves mid-turn")
R, clk = mk(table={"linked": {("oscar", "pat")}})
host, phone, osc = Conn("host"), Conn("phone"), Conn("osc")
op(R, host, "pat")
jn(R, phone, "pat")
jn(R, osc, "oscar")
R.handle(host, "pat", J({"kind": "turn", "seat": "d1.0", "serial": 3, "round": 1, "category": CAT}))
out = R.handle(phone, "pat", J({"kind": "leave"}))
check("*** a guest leaving on its turn: the host is told the turn is skipped ***",
      any(m.get("kind") == "answer" and m.get("why") == "left" for _, m in out) and to(out, phone)[0]["kind"] == "closed", str(out))
out = R.handle(host, "pat", J({"kind": "leave"}))
check("*** the host ends it: every screen (and every one still asking) is told, the room is gone ***",
      to(out, osc) == [{"kind": "refused", "code": "KX49PM", "why": "closed"}] and len(R) == 0 and R.connections() == 0, str(out))

section("the clocks: a join nobody answers, a screen gone for good, a room nobody touches")
R, clk = mk(table={"linked": {("oscar", "pat")}})
host, osc, phone = Conn("host"), Conn("osc"), Conn("phone")
op(R, host, "pat")
jn(R, osc, "oscar")
clk.advance(ADMIT_WAIT_S + 1)
out = R.sweep()
check(f"*** asked to join and nobody answered in {ADMIT_WAIT_S} s: told so, and the asking ends ***",
      to(out, osc) == [{"kind": "refused", "code": "KX49PM", "why": "no-answer"}] and not R.room("KX49PM").waiting, str(out))
R.handle(host, "pat", J({"kind": "ping"}))
jn(R, phone, "pat")
R.dropped(phone)
R.handle(host, "pat", J({"kind": "room", "admit": "ask"}))
clk.advance(DEVICE_GONE_S + 1)
R.handle(host, "pat", J({"kind": "room", "admit": "ask"}))
check(f"a screen gone more than {DEVICE_GONE_S} s is taken out, its seats too", "d1" not in R.room("KX49PM").devices
      and [s["id"] for s in R.room("KX49PM").seats] == ["d0.0"])
clk.advance(ROOM_IDLE_S + 1)
out = R.sweep()
check(f"*** a room the host has not touched for {ROOM_IDLE_S // 60} minutes closes ***", len(R) == 0
      and to(out, host) == [{"kind": "closed", "code": "KX49PM", "why": "idle"}], str(out))
R, clk = mk()
h = Conn("h")
op(R, h, "pat")
for _ in range(int(ROOM_MAX_S / 600) + 1):
    clk.advance(600)
    R.handle(h, "pat", J({"kind": "room", "admit": "ask"}))
check(f"and no room lives longer than {ROOM_MAX_S // 3600} hours, touched or not", len(R) == 0)

section("bounds: the rate, the rooms per login")
R, clk = mk()
c = Conn("c")
pongs = sum(1 for _ in range(RATE_BURST + 15) for m in [R.handle(c, "pat", J({"kind": "ping"}))] if m)
check(f"*** a flood: at most {RATE_BURST} in a burst are answered ***", pongs == RATE_BURST, str(pongs))
clk.advance(2)
check("...and a moment later it answers again", R.handle(c, "pat", J({"kind": "ping"})) != [])
R, clk = mk(codes=[f"A{i}2345"[:6].replace("1", "2").replace("0", "3") for i in range(10)])
for i in range(MAX_ROOMS_PER_ACCOUNT):
    op(R, Conn(f"h{i}"), "pat")
out = op(R, Conn("extra"), "pat")
check(f"one login holds at most {MAX_ROOMS_PER_ACCOUNT} rooms", len(R) == MAX_ROOMS_PER_ACCOUNT
      and [m for _, m in out] == [{"kind": "refused", "why": "busy"}], str(out))
check("a dropped connection leaves nothing behind in the rate table", (R.dropped(c), c not in R._buckets)[1])

section("a room offered on a call")
R, clk = mk(table={"may": {("pat", "robin"), ("dana", "robin")}})
host, dana, mal = Conn("host"), Conn("dana"), Conn("mal")
out = op(R, Conn("nope"), "mallory", person="robin")
check("*** opening a call room for a person this login may not use: refused ***", [m for _, m in out]
      == [{"kind": "refused", "why": "not-allowed"}] and len(R) == 0, str(out))
out = op(R, host, "pat", seats=("Robin",), person="robin")
inv = [(t, m) for t, m in out if isinstance(t, tuple)]
check("*** the invitation goes to the people calling that person - built by the server, never a verb ***",
      inv == [(("call", "robin"), {"type": "game-invite", "code": "KX49PM", "game": "quiz_mix", "name": "Robin"})], str(inv))
check("*** somebody who may call that person joins at once (the screen choosing \"on this call\" is the invitation) ***",
      kinds(jn(R, dana, "dana", seats=("Dana",)), dana)[0] == "joined")
check("anybody else: refused, as for any room", [m for _, m in jn(R, mal, "mallory")] == [{"kind": "refused", "why": "no-room"}])
R2, _ = mk(table={"may": {("dana", "robin")}})
op(R2, Conn("h"), "pat")
check("the same login-that-may-call, at a room NOT opened on a call: refused", [m for _, m in jn(R2, Conn("d"), "dana")]
      == [{"kind": "refused", "why": "no-room"}])

# ---------------------------------------------------------------------------------------------- HTTP
section("*** the real socket, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_games_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "games_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)


def H(u):
    return {"X-Dev-User": u}


def ticket(u):
    r = c.post("/api/game/ticket", headers=H(u))
    return r.json()["ticket"]


def until(ws, kind, n=12):
    for _ in range(n):
        m = ws.receive_json()
        if m.get("kind") == kind or m.get("type") == kind:
            return m
    return None


def quiet(ws, *, drive=False):
    """Nothing is queued for this socket: a ping's pong is the very next thing it hears."""
    ws.send_text(J({"type": "ping"} if drive else {"kind": "ping"}))
    m = ws.receive_json()
    return m.get("kind") == "pong" or m.get("type") == "pong", m


try:
    with c.websocket_connect("/api/game?t=nonsense") as ws:
        ws.receive_json()
    check("no ticket: no socket", False)
except WebSocketDisconnect as e:
    check("*** no ticket: no socket (4401, \"get a fresh ticket\") ***", e.code == 4401, str(e.code))
tk = ticket("pat")
with c.websocket_connect(f"/api/game?t={tk}") as ws:
    ws.send_text(J({"kind": "ping"}))
    check("a ticket opens one socket", ws.receive_json() == {"kind": "pong"})
try:
    with c.websocket_connect(f"/api/game?t={tk}") as ws:
        ws.receive_json()
    check("a ticket used twice", False)
except WebSocketDisconnect as e:
    check("*** and only one: a replayed ticket buys nothing ***", e.code == 4401)

robin = c.post("/api/people", json={"name": "Robin"}, headers=H("pat")).json()["id"]
with c.websocket_connect(f"/api/game?t={ticket('pat')}") as hostws, \
        c.websocket_connect(f"/api/game?t={ticket('pat')}") as phonews, \
        c.websocket_connect(f"/api/game?t={ticket('oscar')}") as oscws:
    hostws.send_text(J({"kind": "room", "open": {"game": "quiz_mix", "seats": [{"name": "Pat"}]}}))
    op_ = until(hostws, "opened")
    code = op_["code"]
    until(hostws, "room")
    check("Pat's screen opens a room and is told its code", op_ and len(code) == 6)
    phonews.send_text(J({"kind": "join", "code": code, "seats": [{"name": "Sam"}]}))
    check("*** Pat's phone (same login) joins by code ***", until(phonews, "joined") is not None)
    until(hostws, "room")
    oscws.send_text(J({"kind": "join", "code": code, "seats": [{"name": "Oscar"}]}))
    m = oscws.receive_json()
    check("*** Oscar, not connected to Pat: refused as for a code that does not exist ***",
          m == {"kind": "refused", "why": "no-room"}, str(m))
    ok, m = quiet(hostws)
    check("...and Pat's screen hears nothing about it", ok, str(m))
    # Pat and Oscar connect (claims.py's "Connect with someone").
    tok = c.post("/api/connect/invites", json={}, headers=H("pat")).json()["token"]
    c.post("/api/invites/accept", json={"token": tok}, headers=H("oscar"))
    oscws.send_text(J({"kind": "join", "code": code, "seats": [{"name": "Oscar"}]}))
    check("connected now: Oscar waits for Pat", until(oscws, "waiting") is not None)
    hv = until(hostws, "room")
    check("*** Pat's screen sees who wants in ***", hv and hv["waiting"] and hv["waiting"][0]["names"] == ["Oscar"], str(hv))
    oscws.send_text(J({"kind": "room", "state": {"phase": "done", "round": 99}}))
    ok, _ = quiet(oscws)
    ok2, m = quiet(hostws)
    check("*** a guest's attempt to change the table reaches nobody ***", ok and ok2, str(m))
    oscws.send_text("x" * (MAX_GAME_BYTES + 10))
    ok, m = quiet(oscws)
    check("an oversized frame is dropped, and the socket carries on", ok, str(m))
    hostws.send_text(J({"kind": "admit", "id": hv["waiting"][0]["id"], "yes": True}))
    j_ = until(oscws, "joined")
    check("*** Pat lets Oscar in ***", j_ is not None and j_["you"] == "d2", str(j_))
    rv = until(hostws, "room")
    check("three seats, three where-they-are", [s["device"] for s in rv["seats"]] == ["d0", "d1", "d2"], str(rv["seats"]))
    hostws.send_text(J({"kind": "turn", "seat": "d2.0", "serial": 1, "round": 1, "category": CAT}))
    t_ = until(oscws, "turn")
    check("the turn reaches Oscar's screen", t_ and t_["seat"] == "d2.0", str(t_))
    until(phonews, "room")
    until(phonews, "room")
    ok, m = quiet(phonews)
    check("...and not Pat's phone", ok, str(m))
    oscws.send_text(J({"kind": "answer", "seat": "d2.0", "serial": 1, "category": {"group": "math", "id": "math"},
                       "right": True, "points": 3, "rating": 1500}))
    a_ = until(hostws, "answer")
    check("*** Oscar's answer reaches Pat's screen: the five fields, nothing of Oscar's ladder ***",
          a_ == {"kind": "answer", "seat": "d2.0", "serial": 1, "category": {"group": "math", "id": "math"},
                 "right": True, "points": 3}, str(a_))
    hostws.send_text(J({"kind": "leave"}))
    check("Pat ends it: Oscar's screen is told", until(oscws, "closed") is not None)
    check("...and Pat's phone", until(phonews, "closed") is not None)

section("*** on a call: the invitation reaches the CALLER on the drive socket, never a screen ***")
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "dana"}, headers=H("pat"))


def drive_ws(u, role):
    t = c.post(f"/api/drive/ticket/{robin}", headers=H(u)).json()["ticket"]
    return c.websocket_connect(f"/api/drive/{robin}?t={t}&role={role}")


with drive_ws("pat", "screen") as screenws, drive_ws("dana", "driver") as callerws, \
        c.websocket_connect(f"/api/game?t={ticket('pat')}") as hostws, \
        c.websocket_connect(f"/api/game?t={ticket('dana')}") as danaws, \
        c.websocket_connect(f"/api/game?t={ticket('mallory')}") as malws:
    until(screenws, "presence")
    until(callerws, "presence")
    until(screenws, "presence")
    hostws.send_text(J({"kind": "room", "open": {"game": "quiz_mix", "seats": [{"name": "Robin"}], "person": robin}}))
    code = until(hostws, "opened")["code"]
    until(hostws, "room")
    inv = until(callerws, "game-invite")
    check("*** the caller's page is told: a game, its code, who it is with ***",
          inv == {"type": "game-invite", "code": code, "game": "quiz_mix", "name": "Robin"}, str(inv))
    ok, m = quiet(screenws, drive=True)
    check("*** the screen in that room hears nothing (no verb, no signal, no invitation) ***", ok, str(m))
    danaws.send_text(J({"kind": "join", "code": code, "seats": [{"name": "Dana"}]}))
    check("*** the caller joins at once: may call that screen, and the screen offered the game to the call ***",
          until(danaws, "joined") is not None)
    until(hostws, "room")
    malws.send_text(J({"kind": "join", "code": code, "seats": [{"name": "M"}]}))
    check("somebody who may not call it: refused", malws.receive_json() == {"kind": "refused", "why": "no-room"})
    hostws.send_text(J({"kind": "room", "open": {"game": "quiz_mix", "seats": [{"name": "X"}], "person": "nobodyatall1"}}))
    ok, m = quiet(hostws)
    check("(a second open on the same socket is ignored)", ok, str(m))
with c.websocket_connect(f"/api/game?t={ticket('mallory')}") as malws:
    malws.send_text(J({"kind": "room", "open": {"game": "quiz_mix", "seats": [{"name": "M"}], "person": robin}}))
    m = malws.receive_json()
    check("*** a login that may not use that person's screens cannot open a call room for it ***",
          m == {"kind": "refused", "why": "not-allowed"}, str(m))
check("every socket closed: no connections left behind", appmod._games.connections() == 0, str(appmod._games.connections()))
check("...the call room waits for its host to come back (a wifi blip), so it is still there for now", len(appmod._games) == 1)
import time as _time  # noqa: E402
appmod._games._now = lambda: _time.monotonic() + HOST_GONE_S + 1
appmod._games.sweep()
check("*** and once the host has been gone long enough, nothing is left at all ***", len(appmod._games) == 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
