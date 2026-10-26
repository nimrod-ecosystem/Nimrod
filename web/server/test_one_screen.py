"""Ringing ONE screen (2026-10-25, drive.py ScreenTargets): the real socket, end to end.

    py -3.13 test_one_screen.py

Mike: "In this case I would be calling a different device on my account." A screen socket may say which device it is
(`?screenId=<id>&screenName=<name>`); the account that owns the person may ask which screens are online; an offer with
`toScreen` rings that screen alone, and the rest of the call follows it. An offer without it rings every screen, as
before. A target that is not online rings nothing, and the caller is told.
"""
import json
import os
import sys
import tempfile
from urllib.parse import quote

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


tmp = tempfile.mkdtemp(prefix="nimrod_one_screen_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "one_screen.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
H_ = lambda u: {"X-Dev-User": u}  # noqa: E731
J = json.dumps
robin = c.post("/api/people", json={"name": "Robin"}, headers=H_("pat")).json()["id"]
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "mike"}, headers=H_("pat"))


def drive_ws(u, role, extra=""):
    t = c.post(f"/api/drive/ticket/{robin}", headers=H_(u)).json()["ticket"]
    return c.websocket_connect(f"/api/drive/{robin}?t={t}&role={role}{extra}")


def drain(ws, n=0):
    ws.send_text(J({"type": "ping", "n": n}))
    got = []
    for _ in range(200):
        m = ws.receive_json()
        if m.get("type") == "pong" and m.get("n") == n:
            return got
        got.append(m)
    return got


def signals(msgs, session):
    return [m["signal"] for m in msgs if m.get("type") == "signal" and m["signal"].get("session") == session]


with drive_ws("pat", "screen", f"&screenId=bench-pi-01&screenName={quote('Bench Pi')}") as S1, \
        drive_ws("pat", "screen", "&screenId=facility-01&screenName=Room%2012") as S2, \
        drive_ws("pat", "screen") as S3:
    for s in (S1, S2, S3):
        drain(s)
    with drive_ws("pat", "driver") as P, drive_ws("mike", "driver") as M:
        drain(P)
        drain(M)
        got = c.get(f"/api/drive/screens/{robin}", headers=H_("pat")).json()
        check("*** the owner asks which screens are online (plain HTTP): the two named ones, by name ***",
              got.get("screens") == [{"id": "bench-pi-01", "name": "Bench Pi"}, {"id": "facility-01", "name": "Room 12"}], str(got))
        got = c.get(f"/api/drive/screens/{robin}", headers=H_("mike")).json()
        check("*** somebody else (a granted caller) hears an empty list: the screens are the owner's ***", got.get("screens") == [], str(got))
        r = c.get(f"/api/drive/screens/{robin}", headers=H_("stranger"))
        check("somebody who may not reach the person: the ticket's same 403", r.status_code == 403, str(r.status_code))

        P.send_text(J({"type": "signal", "signal": {"kind": "offer", "purpose": "call", "session": "c-all", "sdp": "x"}}))
        drain(P)
        check("*** an ordinary call (no toScreen) rings EVERY screen, as before ***",
              all(signals(drain(s), "c-all") for s in (S1, S2, S3)))

        P.send_text(J({"type": "signal", "signal": {"kind": "offer", "purpose": "call", "session": "c-one", "sdp": "x", "toScreen": "bench-pi-01"}}))
        drain(P)
        g1, g2, g3 = drain(S1), drain(S2), drain(S3)
        check("*** a call to the bench rings the bench alone ***", signals(g1, "c-one") and not signals(g2, "c-one") and not signals(g3, "c-one"),
              str((g1, g2, g3)))
        P.send_text(J({"type": "signal", "signal": {"kind": "ice", "purpose": "call", "session": "c-one", "candidate": "x"}}))
        P.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "call", "session": "c-one"}}))
        drain(P)
        g1, g2 = drain(S1), drain(S2)
        check("...and the rest of the call (ice, bye) goes there alone", len(signals(g1, "c-one")) == 2 and not signals(g2, "c-one"), str((g1, g2)))

        P.send_text(J({"type": "signal", "signal": {"kind": "offer", "purpose": "call", "session": "c-gone", "sdp": "x", "toScreen": "not-online-1"}}))
        mine = signals(drain(P), "c-gone")
        check("*** a screen not online: nothing rings, and the caller is told (bye, not-here) ***",
              mine and mine[-1]["kind"] == "bye" and mine[-1]["reason"] == "not-here"
              and not any(signals(drain(s), "c-gone") for s in (S1, S2, S3)), str(mine))
    S1.close()
got = c.get(f"/api/drive/screens/{robin}", headers=H_("pat")).json()
check("screens gone: none listed, nothing left behind", got.get("screens") == [] and not appmod._screen_targets._who, str(got))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
