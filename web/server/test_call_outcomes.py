"""Calls that connected directly, and that could not (2026-10-26, chat's note CV): counts only.

    py -3.13 test_call_outcomes.py

Mike's ruling (2026-09-08): no relay server; revisit only if calls that cannot connect are most calls, so measure
first. The end that placed a call reports once per call - the caller page, or (row 2.167) a screen's Call panel calling
out; the site keeps two numbers a day and nothing about who called whom.
"""
import json
import os
import sys
import tempfile

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


tmp = tempfile.mkdtemp(prefix="nimrod_outcomes_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "outcomes.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
H = lambda u: {"X-Dev-User": u}  # noqa: E731

r = c.post("/api/call/outcome", json={"outcome": "direct", "session": "call-1"}, headers=H("pat"))
check("*** a call that connected directly is counted ***", r.status_code == 200 and r.json() == {"ok": True, "counted": True}, r.text)
r = c.post("/api/call/outcome", json={"outcome": "direct", "session": "call-1"}, headers=H("pat"))
check("...the same call reported twice is counted once", r.json() == {"ok": True, "counted": False}, r.text)
for i in range(3):
    c.post("/api/call/outcome", json={"outcome": "failed", "session": f"call-f{i}"}, headers=H("mike"))
c.post("/api/call/outcome", json={"outcome": "direct", "session": "call-2"}, headers=H("mike"))
check("an outcome that is neither, or no session: refused", c.post("/api/call/outcome", json={"outcome": "relay", "session": "x"}, headers=H("pat")).status_code == 400
      and c.post("/api/call/outcome", json={"outcome": "direct"}, headers=H("pat")).status_code == 400)
g = c.get("/api/call/outcomes", headers=H("someone")).json()
check("*** the totals: 2 direct, 3 that could not, a share of 0.6 ***", g["direct"] == 2 and g["failed"] == 3 and g["failedShare"] == 0.6, json.dumps(g))
check("*** only counts are kept: one row per day and outcome, no logins, no sessions ***",
      len(g["days"]) == 1 and set(g["days"][0]) == {"day", "direct", "failed"}, json.dumps(g["days"]))
# Row 2.167 (2026-11-01): a screen's Call panel now places calls too, and reports exactly as the caller page does
# (client/call_outcome.js). The end that PLACED a call reports; the end that answered never does. The server keeps one
# report per call session WHOEVER sends it, so a call between two screens - or any second end reporting by mistake -
# is still one count.
r = c.post("/api/call/outcome", json={"outcome": "direct", "session": "call-screen-1"}, headers=H("screen-owner"))
check("*** a call placed from a screen's Call panel is counted like any other ***", r.json() == {"ok": True, "counted": True}, r.text)
r = c.post("/api/call/outcome", json={"outcome": "direct", "session": "call-screen-1"}, headers=H("other-screen-owner"))
check("*** the same call reported by its other end (another login) is NOT counted again ***", r.json() == {"ok": True, "counted": False}, r.text)
r = c.post("/api/call/outcome", json={"outcome": "failed", "session": "call-screen-1"}, headers=H("other-screen-owner"))
check("...nor turned into a failure by a different word for it", r.json() == {"ok": True, "counted": False}, r.text)
g = c.get("/api/call/outcomes", headers=H("someone")).json()
check("*** the totals: 3 direct, 3 that could not ***", g["direct"] == 3 and g["failed"] == 3 and g["failedShare"] == 0.5, json.dumps(g))
with appmod.store._tx() as cur:
    cur.execute("SELECT * FROM call_outcomes")
    rows = cur.fetchall()
check("the table itself holds day, outcome and a number, nothing else", all(len(row) == 3 for row in rows) and "pat" not in json.dumps([list(x) for x in rows]), rows)
notes = appmod.store.describe_storage()
check("the storage register says what this is, in words", "call_outcomes" in json.dumps(notes), json.dumps(notes)[:200])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
