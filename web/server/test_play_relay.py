"""Watching along (row 2.79): the `play` and `follow` messages - the rules, then the real socket.

    py -3.13 test_play_relay.py

A screen tells the people following it "this video, at this second, playing"; a signed-in page plays the same video
in step from its own copy. play_relay.py holds the rules; this file proves each one: a play goes from a screen to that
person's FOLLOWING drivers only (never to another screen, never from a driver), it is capped and rate-limited, a
following socket can only watch, the pong carries the server's clock, and NOTHING IS STORED.
"""
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
import time

from drive import parse_message
from play_relay import (MAX_PLAY_BYTES, MAX_SCREEN_NAME, PLAY_KINDS, RATE_BURST, RATE_PER_S, PlayRelay,
                        hex_is_text, is_photo_id, is_salt, parse_follow, parse_play)

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


GOOD = {"type": "play", "kind": "youtube", "item": "dQw4w9WgXcQ", "pos": 12.5, "playing": True}
# photos in step (2026-10-12): a picture by its opaque id - the same vector client/dev/photo_follow_test.html checks, so
# both ends are proved to make the same id from the same path and salt.
SALT = "a1b2c3d4e5f60718"
PHOTO_PATH = "Family/2024/IMG_0001.jpg"
PHOTO_ID = hashlib.sha256(f"nimrod-photo-v1\n{SALT}\n{PHOTO_PATH}".encode()).hexdigest()[:32]
PHOTO = {"type": "play", "kind": "photo", "item": PHOTO_ID, "salt": SALT, "pos": 3.0, "playing": True}

# ------------------------------------------------------------------------------------------- the message
section("a play message: what may cross the wire")
p = parse_play(GOOD)
check("*** a well-formed play is accepted, as a clean copy ***",
      p == {"type": "play", "kind": "youtube", "item": "dQw4w9WgXcQ", "pos": 12.5, "playing": True, "rate": 1.0}, str(p))
check("drive.py's parse_message hands `play` here", parse_message(GOOD) == p)
check("the copy is a new object (never relayed as given)", p is not GOOD)
check("extra fields are dropped, never carried",
      "x" not in parse_play({**GOOD, "x": "anything"}) and "at" not in parse_play({**GOOD, "at": 1})
      and "from" not in parse_play({**GOOD, "from": "forged"}))
check("*** `at` and `from` a page writes are NOT kept (the server stamps its own) ***",
      parse_play({**GOOD, "at": 5, "from": "abcd1234"}).keys() == p.keys())
check("nothing playing (item null) is a message too, and is never 'playing'",
      parse_play({**GOOD, "item": None, "playing": True}) == {**p, "item": None, "playing": False})
check("the kinds are a closed list: YouTube and (since 2026-10-12) photos by an opaque id", PLAY_KINDS == {"youtube", "photo"})
check("*** an unknown kind is dropped ***", parse_play({**GOOD, "kind": "files"}) is None)
check("*** an item that is not a YouTube id is dropped - a file name never crosses ***",
      all(parse_play({**GOOD, "item": bad}) is None
          for bad in ("Mom hospital 2024.jpg", "photos/p1.jpg", "dQw4w9WgXc", "dQw4w9WgXcQQ", "", 7, ["x"])))
check("a position that is not a number, negative, huge or not finite is dropped",
      all(parse_play({**GOOD, "pos": bad}) is None
          for bad in ("12", -1, 1e12, float("inf"), float("nan"), True, None)))
check("playing must be a real true/false", parse_play({**GOOD, "playing": "yes"}) is None
      and parse_play({**GOOD, "playing": 1}) is None)
check("a speed outside YouTube's 0.25-2 is dropped", parse_play({**GOOD, "rate": 3}) is None
      and parse_play({**GOOD, "rate": 0}) is None and parse_play({**GOOD, "rate": 1.5})["rate"] == 1.5)
check("`every` (seconds between heartbeats) is kept when sane, dropped when not",
      parse_play({**GOOD, "every": 2})["every"] == 2 and parse_play({**GOOD, "every": 0}) is None
      and parse_play({**GOOD, "every": 600}) is None)
check(f"the screen's name is cleaned and cut to {MAX_SCREEN_NAME} characters, never refused",
      parse_play({**GOOD, "screen": "Living\x00 room" + "x" * 60})["screen"] == ("Living room" + "x" * 60)[:MAX_SCREEN_NAME])
check("an empty screen name is left out", "screen" not in parse_play({**GOOD, "screen": "  \x01 "}))
real = {**GOOD, "rate": 1, "every": 2, "screen": "x" * MAX_SCREEN_NAME}
size = len(json.dumps(real, separators=(",", ":")))
check(f"a real message is about 150 bytes ({size}), far inside the {MAX_PLAY_BYTES}-byte cap",
      size < 200 and parse_play(real) is not None, str(size))
check("*** a message bigger than the cap is refused whole (measured as it arrived) ***",
      parse_play({**GOOD, "pad": "x" * MAX_PLAY_BYTES}) is None)
check("...and the cap is a real bound", MAX_PLAY_BYTES == 1024)


section("photos in step (2026-10-12): a picture by an opaque id, never a name")
check("the reference id is the one the client computes (photo_follow_test.html checks the same string)",
      PHOTO_ID == "9a84340173189b88516d67eb9a7675f9", PHOTO_ID)
pp = parse_play(PHOTO)
check("*** a photo play with a 32-hex id and its 16-hex salt is accepted, salt carried ***",
      pp == {"type": "play", "kind": "photo", "item": PHOTO_ID, "salt": SALT, "pos": 3.0, "playing": True, "rate": 1.0}, str(pp))
check("drive.py's parse_message hands it here too", parse_message(PHOTO) == pp)
check("*** a photo item that looks like a file name is refused ***",
      all(parse_play({**PHOTO, "item": bad}) is None
          for bad in ("Mom hospital 2024.jpg", "Family/2024/IMG_0001.jpg", "IMG_0001.jpg", "dQw4w9WgXcQ")))
check("*** a short name dressed as hex is refused (its bytes are all printable text) ***",
      parse_play({**PHOTO, "item": "Mom hospital 24!".encode().hex()}) is None
      and hex_is_text("Mom hospital 24!".encode().hex()) and not hex_is_text(PHOTO_ID))
check("anything but exactly 32 lowercase hex is refused",
      all(parse_play({**PHOTO, "item": bad}) is None
          for bad in (PHOTO_ID[:31], PHOTO_ID + "0", PHOTO_ID.upper(), "g" * 32, 7, ["x"], ""))
      and not is_photo_id(PHOTO_ID.upper()) and is_photo_id(PHOTO_ID))
check("*** a photo id without its salt, or with a bad one, is refused ***",
      parse_play({k: v for k, v in PHOTO.items() if k != "salt"}) is None
      and all(parse_play({**PHOTO, "salt": bad}) is None
              for bad in (SALT[:15], SALT + "0", SALT.upper(), "secret!!".encode().hex(), 5, None)))
check("a salt whose bytes spell text is refused (8 printable bytes)", not is_salt("secret!!".encode().hex()) and is_salt(SALT))
check("nothing showing (item null) needs no salt", parse_play({**PHOTO, "item": None, "salt": None}) == {
      "type": "play", "kind": "photo", "item": None, "pos": 3.0, "playing": False, "rate": 1.0})
check("*** a salt on a YouTube play is refused (nothing extra rides along) ***", parse_play({**GOOD, "salt": SALT}) is None)
check("a YouTube id is not a photo id, nor the other way round",
      parse_play({**PHOTO, "kind": "youtube"}) is None and parse_play({**GOOD, "kind": "photo", "salt": SALT}) is None)
psize = len(json.dumps({**PHOTO, "rate": 1, "every": 2, "screen": "x" * MAX_SCREEN_NAME}, separators=(",", ":")))
check(f"a real photo message is about 200 bytes ({psize}), far inside the cap", psize < 240, str(psize))


class _Unserialisable:
    pass


check("something unserialisable is dropped rather than thrown", parse_play({**GOOD, "pad": _Unserialisable()}) is None)
check("not a dict: dropped", parse_play("play") is None and parse_play(None) is None)

section("follow: a driver says it is only watching")
check("on / off are accepted, as just the flag", parse_follow({"type": "follow", "on": True, "x": 1}) == {"type": "follow", "on": True}
      and parse_message({"type": "follow", "on": False}) == {"type": "follow", "on": False})
check("anything but a real true/false is dropped", parse_follow({"type": "follow", "on": "yes"}) is None
      and parse_follow({"type": "follow"}) is None)

section("ping: a number to match the answer by")
check("a plain ping is still a plain pong (nothing that used it changes)", parse_message({"type": "ping"}) == {"type": "pong"})
check("a ping with a small whole number gets it back", parse_message({"type": "ping", "n": 41}) == {"type": "pong", "n": 41})
check("anything else in `n` is ignored, not echoed",
      all(parse_message({"type": "ping", "n": bad}) == {"type": "pong"} for bad in (-1, 2 ** 31, 1.5, "7", True, None)))

# ------------------------------------------------------------------------------------------- routing
section("*** where a play goes: a screen's, to following drivers, and nowhere else ***")
clk = Clock()
R = PlayRelay(now=clk, wall=lambda: 1_700_000_000_000.0)
S1, S2, D1, D2 = object(), object(), object(), object()
msg = parse_play(GOOD)
check("nobody following: nowhere", R.route("screen", S1, msg, [D1, D2]) == ([], None))
check("follow() reports a change, and only a change", R.follow(D1, True) is True and R.follow(D1, True) is False)
targets, out = R.route("screen", S1, msg, [D1, D2])
check("*** a screen's play reaches the FOLLOWING driver only ***", targets == [D1], str(targets))
check("*** stamped with the server's clock (`at`) and an id the server made for that screen (`from`) ***",
      out["at"] == 1_700_000_000_000 and isinstance(out["from"], str) and len(out["from"]) == 8, str(out))
check("the same screen keeps the same id; another screen gets another",
      R.route("screen", S1, msg, [D1])[1]["from"] == out["from"] and R.route("screen", S2, msg, [D1])[1]["from"] != out["from"])
check("*** a DRIVER's play goes nowhere (so it can never reach a screen) ***", R.route("driver", D2, msg, [D1]) == ([], None))
check("a screen is never sent its own message even if it were in the list", R.route("screen", S1, msg, [S1, D1])[0] == [D1])
check("the routing never names a screen as a target: only the drivers list is read",
      R.route("screen", S1, msg, [])[0] == [])
check("anything that is not a play goes nowhere", R.route("screen", S1, {"type": "verb", "verb": "next"}, [D1]) == ([], None))
check("count() counts followers in a list", R.count([D1, D2]) == 1)
ptargets, pout = R.route("screen", S1, parse_play(PHOTO), [D1, D2])
check("*** a screen's PHOTO play reaches the following driver the same way, stamped, its id and salt as sent ***",
      ptargets == [D1] and pout["item"] == PHOTO_ID and pout["salt"] == SALT and pout["kind"] == "photo"
      and "at" in pout and "from" in pout, str(pout))
R.follow(D1, False)
check("unfollowing stops it", R.route("screen", S1, msg, [D1, D2]) == ([], None) and R.count([D1, D2]) == 0)

section(f"the rate limit: {RATE_PER_S:g} a second, bursts of {RATE_BURST}, per socket")
clk = Clock()
R = PlayRelay(now=clk)
R.follow(D1, True)
sent = sum(1 for _ in range(50) if R.route("screen", S1, msg, [D1])[0])
check(f"*** a flood gets the burst ({RATE_BURST}) through and no more ***", sent == RATE_BURST, str(sent))
check("another screen has its own allowance", R.route("screen", S2, msg, [D1])[0] == [D1])
clk.advance(1.0)
sent = sum(1 for _ in range(10) if R.route("screen", S1, msg, [D1])[0])
check(f"a second later, {RATE_PER_S:g} more", sent == int(RATE_PER_S), str(sent))
clk.advance(60)
beat_ok = True
for _ in range(100):
    clk.advance(2)
    beat_ok &= bool(R.route("screen", S1, msg, [D1])[0])
check("a real screen's heartbeat (one every 2 s) is never limited", beat_ok)
clk.advance(60)
burst_ok = True
for _ in range(20):
    # a person scrubbing: four changes in one second, then quiet for four
    burst_ok &= all(R.route("screen", S1, msg, [D1])[0] for _ in range(4))
    clk.advance(5)
check("...nor a person scrubbing (four changes a second, now and then)", burst_ok)

section("the relay forgets a socket when it closes")
R.left(S1)
R.left(S2)
R.left(D1)
check("*** nothing is held about closed sockets ***", len(R) == 0, str(len(R)))

# ------------------------------------------------------------------------------------------- the real socket
section("*** the real socket, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_play_")
DB = os.path.join(tmp, "play_test.db")
os.environ["NIMROD_DB"] = DB
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

c = TestClient(appmod.app)


def H_(u):
    return {"X-Dev-User": u}


def J(o):
    return json.dumps(o)


robin = c.post("/api/people", json={"name": "Robin"}, headers=H_("pat")).json()["id"]
gran = c.post("/api/people", json={"name": "Gran"}, headers=H_("quinn")).json()["id"]
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "mike"}, headers=H_("pat"))
# Since 2026-10-12 (screen_access.py) a driver sees a screen only from "who may see this screen", and the screen asks
# first by default. Mike is put on Robin's list with "ask first" off, so this file keeps testing the relay itself;
# test_screen_access.py tests the list, the ask and the refusals.
c.put(f"/api/people/{robin}/state/input-bindings", headers=H_("pat"),
      json={"data": {"screenPeople": [{"account": "mike", "name": "Mike", "see": True, "seeAsk": False}]},
            "base_version": 0})


def drive_ws(u, person, role):
    t = c.post(f"/api/drive/ticket/{person}", headers=H_(u)).json()["ticket"]
    return c.websocket_connect(f"/api/drive/{person}?t={t}&role={role}")


def drain(ws, n=0):
    """Ping, then read until the pong: everything that arrived before it. (n = the ping's number)"""
    ws.send_text(J({"type": "ping", "n": n}))
    got = []
    for _ in range(200):
        m = ws.receive_json()
        if m.get("type") == "pong" and m.get("n") == n:
            return got, m
        got.append(m)
    return got, None


def plays(msgs):
    return [m for m in msgs if m.get("type") == "play"]


def presence(msgs):
    ps = [m for m in msgs if m.get("type") == "presence"]
    return ps[-1] if ps else None


def snapshot():
    """Every row of every table, read with a separate connection: what the database actually holds."""
    con = sqlite3.connect(DB)
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {t: con.execute(f'SELECT * FROM "{t}"').fetchall() for t in tables}
    finally:
        con.close()


class Recorder:
    """Stands in for the store and writes down every method anybody touches."""

    def __init__(self, real):
        self._real, self.calls = real, []

    def __getattr__(self, name):
        self.calls.append(name)
        return getattr(self._real, name)


check("a stranger cannot even get a ticket for Robin's screens (auth unchanged)",
      c.post(f"/api/drive/ticket/{robin}", headers=H_("mal")).status_code == 403)
try:
    with c.websocket_connect(f"/api/drive/{robin}?t=not-a-ticket&role=driver") as bad:
        bad.receive_json()
    check("a socket with no real ticket is closed", False)
except WebSocketDisconnect as e:
    check("a socket with no real ticket is closed (4401: get a fresh ticket)", e.code == 4401, str(e.code))

with drive_ws("pat", robin, "screen") as P, drive_ws("pat", robin, "screen") as P2, \
        drive_ws("mike", robin, "driver") as M, drive_ws("mike", robin, "driver") as D, \
        drive_ws("quinn", gran, "screen") as Q, drive_ws("pat", robin, "driver") as F2:
    for ws in (P, P2, M, D, Q, F2):
        drain(ws)
    before_t = time.time() * 1000
    _, pong = drain(M, 7)
    check("*** the pong carries the server's clock (`t`, ms) and the ping's number ***",
          pong and pong["n"] == 7 and abs(pong["t"] - before_t) < 5000, str(pong))

    M.send_text(J({"type": "follow", "on": True}))
    drain(M)        # M's own pong comes after its follow was handled (the list is read first, since 2026-10-12)
    got, _ = drain(P)
    pr = presence(got)
    check("*** following is announced: presence counts 1 follower (and still 3 drivers) ***",
          pr and pr["followers"] == 1 and pr["drivers"] == 3 and pr["screens"] == 2, str(pr))
    P.send_text(J({"type": "follow", "on": True}))
    got, _ = drain(P)
    check("a SCREEN saying it follows changes nothing (only drivers follow)", presence(got) is None, str(got))
    for ws in (P2, M, D, Q, F2):
        drain(ws)

    # ---- the relay, with the store watched -----------------------------------------------------------------
    db_before = snapshot()
    real_store = appmod.store
    rec = Recorder(real_store)
    appmod.store = rec
    try:
        P.send_text(J({**GOOD, "screen": "Living room", "every": 2, "at": 1, "from": "forged00"}))
        drain(P)
        got, _ = drain(M)
        pl = plays(got)
        check("*** the screen's play reaches the following driver ***", len(pl) == 1 and pl[0]["item"] == GOOD["item"], str(got))
        if pl:
            check("...stamped by the server: `at` is its clock, `from` is not what the page wrote",
                  abs(pl[0]["at"] - time.time() * 1000) < 5000 and pl[0]["from"] != "forged00" and len(pl[0]["from"]) == 8,
                  str(pl[0]))
            check("...with the screen's name and heartbeat carried", pl[0]["screen"] == "Living room" and pl[0]["every"] == 2)
        got, _ = drain(D)
        check("*** a driver that is NOT following hears nothing ***", plays(got) == [], str(got))
        got, _ = drain(P2)
        check("*** the person's OTHER SCREEN hears nothing (screens never talk to screens) ***", plays(got) == [], str(got))
        got, _ = drain(Q)
        check("another person's screen hears nothing", plays(got) == [], str(got))
        got, _ = drain(F2)
        check("the owner's own driver page, not following, hears nothing either", plays(got) == [], str(got))

        D.send_text(J(GOOD))
        drain(D)
        got_p, _ = drain(P)
        got_p2, _ = drain(P2)
        got_m, _ = drain(M)
        check("*** a DRIVER's play reaches no screen and no follower ***",
              plays(got_p) == [] and plays(got_p2) == [] and plays(got_m) == [], str(got_p + got_p2 + got_m))

        P.send_text(J({**GOOD, "pad": "x" * MAX_PLAY_BYTES}))
        P.send_text(J({**GOOD, "item": "Mom hospital 2024.jpg"}))
        drain(P)
        got, _ = drain(M)
        check("*** an oversized play, and one naming a file, are dropped - the follower hears neither ***",
              plays(got) == [], str(got))

        # photos in step (2026-10-12): a picture by its opaque id, through the real socket.
        P.send_text(J({**PHOTO, "screen": "Living room", "every": 2}))
        drain(P)
        got, _ = drain(M)
        pl = plays(got)
        check("*** a screen's PHOTO play reaches the following driver: the opaque id and its salt, stamped ***",
              len(pl) == 1 and pl[0]["kind"] == "photo" and pl[0]["item"] == PHOTO_ID and pl[0]["salt"] == SALT
              and len(pl[0]["from"]) == 8, str(got))
        check("...and the path it was made from appears nowhere in what crossed",
              PHOTO_PATH not in json.dumps(got) and "IMG_0001" not in json.dumps(got))
        got, _ = drain(D)
        got2, _ = drain(P2)
        check("*** nobody else hears the picture: not a driver who is not following, not the other screen ***",
              plays(got) == [] and plays(got2) == [], str(got + got2))
        P.send_text(J({**PHOTO, "item": "IMG_0001.jpg"}))
        P.send_text(J({**PHOTO, "item": "Mom hospital 24!".encode().hex()}))
        P.send_text(J({**PHOTO, "salt": None}))
        drain(P)
        got, _ = drain(M)
        check("*** a photo play naming a file, a name dressed as hex, or an id with no salt: all dropped ***",
              plays(got) == [], str(got))

        for i in range(40):
            P.send_text(J({**GOOD, "pos": float(i)}))
        drain(P)
        got, _ = drain(M)
        n = len(plays(got))
        check(f"*** the rate limit holds on the real socket: 40 sent at once, {n} passed (burst {RATE_BURST}) ***",
              RATE_BURST - 4 <= n <= RATE_BURST + 2, str(n))

        # A following socket only watches.
        M.send_text(J({"type": "verb", "verb": "next"}))
        M.send_text(J({"type": "signal", "signal": {"kind": "offer", "sdp": "v=0"}}))
        drain(M)
        got, _ = drain(P)
        check("*** a FOLLOWING socket's verb and signal reach no screen (watching is not helping) ***",
              not any(m.get("type") in ("verb", "signal") for m in got), str(got))
        D.send_text(J({"type": "verb", "verb": "next"}))
        drain(D)
        got, _ = drain(P)
        check("CONTROL: an ordinary driver's verb still does", any(m.get("type") == "verb" for m in got), str(got))
        drain(P2)
    finally:
        appmod.store = real_store
    check("*** NOTHING TOUCHED THE STORE while plays were relayed (no read, no write) ***", rec.calls == [], str(rec.calls))
    check("*** ...and the database holds exactly what it held before: nothing was stored ***", snapshot() == db_before)

    M.send_text(J({"type": "follow", "on": False}))
    got, _ = drain(P)
    check("unfollowing is announced too", presence(got) and presence(got)["followers"] == 0, str(got))
    drain(M)
    P.send_text(J({**GOOD, "pos": 99.0}))
    drain(P)
    got, _ = drain(M)
    check("and an unfollowed page hears no more plays", plays(got) == [], str(got))
    M.send_text(J({"type": "follow", "on": True}))
    drain(M)
check("*** every socket closed: the relay holds nothing about any of them ***", len(appmod._plays) == 0, str(len(appmod._plays)))

section("?follow=1: counted as a follower from the very first presence")
with drive_ws("pat", robin, "screen") as P3:
    drain(P3)
    t = c.post(f"/api/drive/ticket/{robin}", headers=H_("mike")).json()["ticket"]
    with c.websocket_connect(f"/api/drive/{robin}?t={t}&role=driver&follow=1") as F:
        drain(F)    # F's pong comes after its connect (and the first presence) was handled
        got, _ = drain(P3)
        ps = [m for m in got if m.get("type") == "presence"]
        check("*** the screen never sees that driver counted as helping, not even for one message ***",
              ps and all(m["drivers"] == m["followers"] == 1 for m in ps), str(ps))
    t = c.post(f"/api/drive/ticket/{robin}", headers=H_("pat")).json()["ticket"]
    with c.websocket_connect(f"/api/drive/{robin}?t={t}&role=screen&follow=1") as S3:
        got, _ = drain(P3)
        ps = [m for m in got if m.get("type") == "presence"]
        check("a SCREEN asking ?follow=1 is not a follower", ps and ps[-1]["followers"] == 0 and ps[-1]["screens"] == 2, str(ps))
        drain(S3)
check("...and those sockets are forgotten too", len(appmod._plays) == 0, str(len(appmod._plays)))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
