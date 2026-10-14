"""The silent check-in, "like baby monitor mode" (Mike, 2026-10-13; client/checkin.js has the design).

    py -3.13 test_check_in.py

"May check in quietly" is its own permission (screen_access.may_check_in): the owner and the guardian set by default,
nobody else until ticked; an untick wins. The SERVER checks it on every check-in offer (app.py), read fresh, so unticking
somebody stops their next look; a refused offer is a `bye` with reason 'not-allowed' and nothing reaches the screen. A
check-in is arbitrated like the intercom (one screen answers), its offer carries the server's stamp (`by`, `byOwner`,
`byName`), and nothing about it is stored: the server only relays the setup.
"""
import json
import os
import sys
import tempfile

from screen_access import may_call, may_check_in, may_intercom, perms_for

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


OWN = "pat"


def row(*people, **extra):
    return {"screenPeople": list(people), **extra}


section("the rule, pure")
check("*** the owner may check in on their own screens by default ***", may_check_in({}, OWN, OWN, reach=False))
check("...and can switch it off for themselves", not may_check_in(row({"account": OWN, "checkIn": False}), OWN, OWN, reach=False))
check("*** the guardian set includes it ***", may_check_in(row({"account": "ann", "guardian": True}), "ann", OWN, reach=True))
check("...each part of the set still changeable: a guardian unticked has no check-in",
      not may_check_in(row({"account": "ann", "guardian": True, "checkIn": False}), "ann", OWN, reach=True))
check("*** an ordinary caller does NOT get it by being able to call ***",
      may_call({}, "mike", OWN, reach=True) and not may_check_in({}, "mike", OWN, reach=True))
check("...nor somebody on the list with other ticks (see, drop in, the intercom)",
      not may_check_in(row({"account": "mike", "see": True, "dropIn": True, "intercom": True}), "mike", OWN, reach=True))
check("*** ticked, anybody who can reach the screens may ***",
      may_check_in(row({"account": "mike", "checkIn": True}), "mike", OWN, reach=True))
check("*** ticked but with no grant at all: no socket, no check-in ***",
      not may_check_in(row({"account": "mike", "checkIn": True}), "mike", OWN, reach=False))
check("no owner (no such person) or no account: no", not may_check_in({}, "mike", None, reach=True)
      and not may_check_in({}, "", OWN, reach=True))
check("a switch that is not a real true/false is its default, never yes",
      not may_check_in(row({"account": "mike", "checkIn": "yes"}), "mike", OWN, reach=True)
      and not may_check_in(row({"account": "mike", "checkIn": 1}), "mike", OWN, reach=True))
check("the check-in gives no intercom and no call",
      not may_intercom(row({"account": "mike", "checkIn": True}), "mike", OWN, reach=True)
      and may_call(row({"account": "mike", "checkIn": True, "call": False}), "mike", OWN, reach=True) is False)
p = perms_for({}, "nobody", OWN)
check("perms_for names it (check_in), off for somebody unknown", p.get("check_in") is False and "check_in" in p)

section("*** the real socket, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_checkin_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "checkin_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)


def H_(u):
    return {"X-Dev-User": u}


def J(o):
    return json.dumps(o)


robin = c.post("/api/people", json={"name": "Robin"}, headers=H_(OWN)).json()["id"]
for who in ("mike", "ann"):
    c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": who}, headers=H_(OWN))
c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": "carl", "role": "caller", "days": 0}, headers=H_(OWN))
version = [0]


def set_row(data):
    r_ = c.put(f"/api/people/{robin}/state/input-bindings", headers=H_(OWN), json={"data": data, "base_version": version[0]})
    version[0] = r_.json().get("version", version[0] + 1)
    return r_


def ws_for(u, role, extra=""):
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


def sigs(msgs):
    return [m["signal"] for m in msgs if m.get("type") == "signal"]


SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly\r\n"


def offer(ws, session):
    ws.send_text(J({"type": "signal", "signal": {"kind": "offer", "sdp": SDP, "purpose": "checkin", "session": session}}))


section("what this login may do (GET /api/drive/may) - the pages' buttons")
m_own = c.get(f"/api/drive/may/{robin}", headers=H_(OWN)).json()
check("*** the owner: may check in ***", m_own.get("checkIn") is True and m_own.get("call") is True, str(m_own))
m_mike = c.get(f"/api/drive/may/{robin}", headers=H_("mike")).json()
check("*** a drive grant alone: may call, may NOT check in ***", m_mike.get("checkIn") is False and m_mike.get("call") is True, str(m_mike))
r_ = c.get(f"/api/drive/may/{robin}", headers=H_("stranger"))
check("somebody with no grant: the same 403 as the ticket", r_.status_code == 403, str(r_.status_code))
r2 = c.get("/api/drive/may/p_doesnotexist0", headers=H_("stranger"))
check("...and the same answer for a person who does not exist (no oracle)", r2.status_code in (400, 403), str(r2.status_code))

with ws_for(OWN, "screen") as S:
    drain(S)
    with ws_for(OWN, "driver", "&idle=1") as OW:
        drain(OW)
        offer(OW, "ck-00000000000000a1")
        drain(OW)
        got = sigs(drain(S))
        check("*** the owner's own check-in reaches the screen, stamped by the SERVER (by, byOwner, byName) ***",
              got and got[-1].get("purpose") == "checkin" and got[-1].get("by") == OWN and got[-1].get("byOwner") is True
              and "byName" in got[-1], str(got))
        S.send_text(J({"type": "claim", "purpose": "checkin", "session": "ck-00000000000000a1"}))
        ans = [m for m in drain(S) if m.get("type") == "answerer"]
        check("*** a check-in is arbitrated: the screen that claims it is told it is the one ***",
              ans and ans[-1]["you"] is True and ans[-1]["purpose"] == "checkin", str(ans))
        OW.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "checkin", "session": "ck-00000000000000a1"}}))
        drain(OW)
        drain(S)

    with ws_for("mike", "driver", "&idle=1") as MK:
        drain(MK)
        offer(MK, "ck-00000000000000b1")
        got_m = drain(MK)
        byes = [s for s in sigs(got_m) if s.get("kind") == "bye"]
        check("*** a drive grant without the tick: the SERVER refuses the check-in, 'not-allowed' ***",
              byes and byes[-1]["reason"] == "not-allowed" and byes[-1]["purpose"] == "checkin"
              and byes[-1]["session"] == "ck-00000000000000b1", str(got_m))
        check("...and nothing reached the screen", not sigs(drain(S)))

        set_row({"screenPeople": [{"account": "mike", "name": "Mike", "checkIn": True}]})
        offer(MK, "ck-00000000000000b2")
        drain(MK)
        got = sigs(drain(S))
        check("*** ticked 'May check in quietly': it reaches the screen, named by the owner's name for him ***",
              got and got[-1].get("by") == "mike" and got[-1].get("byOwner") is False and got[-1].get("byName") == "Mike", str(got))
        MK.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "checkin", "session": "ck-00000000000000b2"}}))
        drain(MK)
        drain(S)

        set_row({"screenPeople": [{"account": "mike", "name": "Mike", "checkIn": False}]})
        offer(MK, "ck-00000000000000b3")
        byes = [s for s in sigs(drain(MK)) if s.get("kind") == "bye"]
        check("*** unticked again: read fresh, the very next look is refused ***",
              byes and byes[-1]["reason"] == "not-allowed" and not sigs(drain(S)), str(byes))

    set_row({"screenPeople": [{"account": "ann", "name": "Ann", "guardian": True}]})
    with ws_for("ann", "driver", "&idle=1") as AN:
        drain(AN)
        offer(AN, "ck-00000000000000c1")
        drain(AN)
        got = sigs(drain(S))
        check("*** the guardian set may check in by default ***", got and got[-1].get("by") == "ann", str(got))
        AN.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "checkin", "session": "ck-00000000000000c1"}}))
        drain(AN)
        drain(S)

    set_row({"screenPeople": [{"account": "carl", "name": "Carl", "checkIn": True}]})
    with ws_for("carl", "driver", "&idle=1") as CL:
        drain(CL)
        offer(CL, "ck-00000000000000d1")
        drain(CL)
        got = sigs(drain(S))
        check("*** a call-only grant ticked for it may check in (calling and checking in are separate ticks) ***",
              got and got[-1].get("by") == "carl", str(got))
        CL.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "checkin", "session": "ck-00000000000000d1"}}))
        drain(CL)
        drain(S)
        CL.send_text(J({"type": "verb", "verb": "next"}))
        drain(CL)
        check("...and it still presses nothing (a check-in is no drive)", not [m for m in drain(S) if m.get("type") == "verb"])

section("nothing is stored")
row_now = c.get(f"/api/people/{robin}/state/input-bindings", headers=H_(OWN)).json().get("data") or {}
check("*** the person's row holds only the ticks - no session, no sdp, no record of who looked when ***",
      set(row_now.keys()) == {"screenPeople"} and "ck-" not in json.dumps(row_now) and "sdp" not in json.dumps(row_now),
      json.dumps(row_now))
check("the server keeps no check-in afterwards (no answering record left for a closed screen)",
      not any(k[1] == "checkin" for k in getattr(appmod._answerers, "_recs", {}).keys()),
      str(list(getattr(appmod._answerers, "_recs", {}).keys())))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
