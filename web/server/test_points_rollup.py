"""A points balance is the whole log, though a list read is capped (2026-11-08).

    py -3.13 test_points_rollup.py

The list read returns the newest 500 events whatever `limit` asks. points.js sums what it holds, so past that the oldest points
dropped out of every balance, silently. This is the other half: everything older than an id, added up, with no rules of its own.
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


tmp = tempfile.mkdtemp(prefix="nimrod_rollup_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "rollup.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
H = lambda u: {"X-Dev-User": u}  # noqa: E731

pid = c.post("/api/profiles", json={"name": "P"}, headers=H("pat")).json()["id"]
url = f"/api/profiles/{pid}/events/points"


def add(data, kind="points", who="pat", to=url):
    r = c.post(to, json={"kind": kind, "data": data}, headers=H(who))
    assert r.status_code == 200, r.text
    return r.json()["id"]


first = add({"amount": 2, "mult": 1, "type": "School", "source": "trivia", "note": "one", "minutes": 2, "subject": "Math", "tags": ["a", "step:x"]})
add({"amount": 3, "mult": 1, "type": "School", "source": "trivia", "note": "a different note", "minutes": 3, "subject": "Math", "tags": ["a", "b", None, {"no": 1}]})
add({"amount": 2, "mult": 1.5, "type": "School", "source": "trivia", "subject": "Math"})
add({"amount": 5, "mult": 1, "type": "Play", "source": "rhythm"})
add({"amount": -4, "mult": 1, "type": "Reward", "source": "quests", "currency": "play"})
add({"amount": 4, "mult": 1, "type": "Exchange", "source": "quests", "from": "school", "to": "play", "rate": 2})
add({"amount": -9, "mult": 1, "type": "Exchange", "source": "quests", "from": "school", "to": "play", "rate": 2})
add({"amount": "not a number", "type": "School", "source": "trivia"})
add({"anything": 1}, kind="note")
keep = add({"amount": 100, "mult": 1, "type": "School", "source": "trivia"})

r = c.get(f"{url}/rollup", params={"before": keep}, headers=H("pat"))
check("it answers", r.status_code == 200, r.text)
got = r.json()
groups = got["groups"]
check("every points event older than the id is counted, and only those", got["count"] == 8 and got["before"] == keep, json.dumps(got))
check("*** the newest event, at the id, is left out: the client holds it ***", not any(g["data"].get("amount") == 100 for g in groups), json.dumps(groups))
check("another kind on the stream is left out", all(g["kind"] == "points" for g in groups))


def find(**want):
    return [g for g in groups if all(g["data"].get(k) == v for k, v in want.items())]


school = find(type="School", mult=1)
check("*** rows with the same fields are added up, whatever else they carry ***", len(school) == 1 and school[0]["data"]["amount"] == 5 and school[0]["n"] == 2, json.dumps(school))
check("...their minutes too", school[0]["data"]["minutes"] == 5 and school[0]["data"]["subject"] == "Math")
check("a note and the like stay behind", "note" not in school[0]["data"])
check("*** every tag its events carried stays, once each (\"was this already paid\" reads them) ***",
      school[0]["data"].get("tags") == ["a", "b", "step:x"], json.dumps(school[0]["data"]))
check("a group whose events had no tags has none", "tags" not in find(type="Play")[0]["data"])
check("another multiplier is its own group: the client applies it", find(type="School", mult=1.5)[0]["data"]["amount"] == 2)
check("each type is its own group", find(type="Play")[0]["data"]["amount"] == 5 and find(type="Reward")[0]["data"]["currency"] == "play")
xs = find(type="Exchange")
check("*** a malformed negative exchange never cancels a good one ***", sorted(g["data"]["amount"] for g in xs) == [-9, 4] and all(g["data"]["rate"] == 2 for g in xs), json.dumps(xs))
check("a field an event did not have is not invented", "minutes" not in find(type="Play")[0]["data"] and "currency" not in find(type="Play")[0]["data"])
check("an amount that is not a number is worth nothing, as to points.js", sum(g["n"] for g in groups) == 7, sum(g["n"] for g in groups))
check("nothing older: an empty answer", c.get(f"{url}/rollup", params={"before": first}, headers=H("pat")).json() == {"groups": [], "before": first, "count": 0})
check("*** somebody else's profile is refused ***", c.get(f"{url}/rollup", params={"before": keep}, headers=H("sam")).status_code in (403, 404))
check("no id: refused", c.get(f"{url}/rollup", headers=H("pat")).status_code == 422)

people = c.get("/api/people", headers=H("pat")).json()
person = (people.get("people") if isinstance(people, dict) else people)[0]["id"]
purl = f"/api/people/{person}/events/points"
one = add({"amount": 7, "mult": 1, "type": "School", "source": "trivia"}, to=purl)
two = add({"amount": 1, "mult": 1, "type": "School", "source": "trivia"}, to=purl)
pr = c.get(f"{purl}/rollup", params={"before": two}, headers=H("pat"))
check("a person's stream has it too", pr.status_code == 200 and pr.json()["count"] == 1 and pr.json()["groups"][0]["data"]["amount"] == 7, pr.text)
check("...and it is theirs alone", c.get(f"{purl}/rollup", params={"before": two}, headers=H("sam")).status_code in (403, 404))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
