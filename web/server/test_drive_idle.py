"""Connected, not pressing (row 2.83, Mike at the bench 2026-10-14): the `driving` flag on a drive socket.

    py -3.13 test_drive_idle.py

"Someone is helping from another screen" stayed on the screen after "Send what I press" was unticked on the Remote
page, because every open driver socket counted as helping. A driver may now say it is not pressing (`?idle=1` on the
address, or `{type: driving, on: false}`): presence leaves it out of `drivers`. Its first press marks it driving again,
and the screen is told BEFORE the press is passed on. Everything else about the socket is unchanged.
"""
import json
import os
import sys
import tempfile

from drive import parse_message

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


section("the message")
check("on / off are accepted, as just the flag",
      parse_message({"type": "driving", "on": False, "x": 1}) == {"type": "driving", "on": False}
      and parse_message({"type": "driving", "on": True}) == {"type": "driving", "on": True})
check("anything but a real true/false is dropped",
      parse_message({"type": "driving", "on": "no"}) is None and parse_message({"type": "driving"}) is None)

section("*** the real socket, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_idle_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "idle_test.db")
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
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "mike"}, headers=H_("pat"))


def drive_ws(u, person, role, extra=""):
    t = c.post(f"/api/drive/ticket/{person}", headers=H_(u)).json()["ticket"]
    return c.websocket_connect(f"/api/drive/{person}?t={t}&role={role}{extra}")


def drain(ws, n=0):
    """Ping, then read until the pong: everything that arrived before it."""
    ws.send_text(J({"type": "ping", "n": n}))
    got = []
    for _ in range(200):
        m = ws.receive_json()
        if m.get("type") == "pong" and m.get("n") == n:
            return got
        got.append(m)
    return got


def presence(msgs):
    ps = [m for m in msgs if m.get("type") == "presence"]
    return ps[-1] if ps else None


def presences(msgs):
    return [m for m in msgs if m.get("type") == "presence"]


with drive_ws("pat", robin, "screen") as S:
    drain(S)
    with drive_ws("mike", robin, "driver", "&idle=1") as R:
        got = drain(S)
        ps = presences(got)
        check("*** a page opened not pressing (?idle=1): the screen never hears it counted as helping ***",
              ps and all(p["drivers"] == 0 for p in ps), str(ps))
        drain(R)

        R.send_text(J({"type": "driving", "on": True}))
        drain(R)
        pr = presence(drain(S))
        check("*** 'Send what I press' ticked: the screen hears 1 driver (the notice goes up) ***",
              pr and pr["drivers"] == 1, str(pr))

        R.send_text(J({"type": "driving", "on": False}))
        drain(R)
        pr = presence(drain(S))
        check("*** unticked: the screen hears 0 drivers (the notice goes away) ***", pr and pr["drivers"] == 0, str(pr))

        R.send_text(J({"type": "driving", "on": False}))
        drain(R)
        check("saying it again changes nothing, and nothing is announced", presence(drain(S)) is None)

        # A press from a socket that said it is not driving: it IS driving now, and the screen is told first.
        R.send_text(J({"type": "verb", "verb": "next"}))
        drain(R)
        got = drain(S)
        kinds = [m.get("type") for m in got]
        check("*** a press while not driving still reaches the screen ***", "verb" in kinds, str(got))
        check("*** ...and the screen hears 'helping' BEFORE the press ***",
              "presence" in kinds and kinds.index("presence") < kinds.index("verb")
              and got[kinds.index("presence")]["drivers"] == 1, str(got))

        R.send_text(J({"type": "verb", "verb": "prev"}))
        drain(R)
        got = drain(S)
        check("a press while driving is not announced again", presence(got) is None and any(m.get("type") == "verb" for m in got), str(got))

        R.send_text(J({"type": "driving", "on": False}))
        drain(R)
        check("off again after the press: 0 drivers", (presence(drain(S)) or {}).get("drivers") == 0)

        with drive_ws("mike", robin, "driver") as D:
            pr = presence(drain(S))
            check("*** an ordinary driver (no idle on its address) still counts as helping, as before ***",
                  pr and pr["drivers"] == 1, str(pr))
            drain(D)
        pr = presence(drain(S))
        check("it goes: 0 again (the idle one is still not counted)", pr and pr["drivers"] == 0, str(pr))

        S.send_text(J({"type": "driving", "on": True}))
        drain(S)
        check("a SCREEN saying it is driving changes nothing (only drivers drive)", presence(drain(S)) is None)
    pr = presence(drain(S))
    check("the idle page closes: still 0, and nothing left behind",
          pr and pr["drivers"] == 0 and not appmod._idle_drivers, str((pr, appmod._idle_drivers)))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
