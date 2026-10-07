"""Review by playing - the pack listing and the account's review log (pack_reviews.py, app.py routes).

    py -3.13 test_pack_reviews.py

Packs here are written into a temp folder by this file; the shipped packs_review/ is only read, to
check the listing finds what is really there and that the static mount serves it.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import pack_reviews as R

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


def raises(fn, exc=ValueError):
    try:
        fn()
        return False
    except exc:
        return True


def pack(name, status="unreviewed", items=None, schema="nimrod.pack.v1"):
    return {"schema": schema, "kind": "trivia", "name": name, "source": {"name": "test"},
            "review": {"status": status},
            "items": items if items is not None else [
                {"question": "Q1?", "answers": ["a", "b", "c"], "correct": "a"}]}


tmp = Path(tempfile.mkdtemp())
first, second = tmp / "packs_review", tmp / "packs_local"
first.mkdir()
second.mkdir()
(first / "Birds_AI.json").write_text(json.dumps(pack("Birds (AI-written, not yet reviewed)")), encoding="utf-8")
(first / "done.json").write_text(json.dumps(pack("Done", status="reviewed")), encoding="utf-8")
(first / "broken.json").write_text("{not json", encoding="utf-8")
(first / "noitems.json").write_text(json.dumps(pack("Empty", items=[])), encoding="utf-8")
(first / "oldschema.json").write_text(json.dumps(pack("Old", schema="x")), encoding="utf-8")
(second / "birds_ai.json").write_text(json.dumps(pack("Birds, the local copy")), encoding="utf-8")
(second / "fish.json").write_text(json.dumps(pack("Fish")), encoding="utf-8")
(second / "share_alike.json").write_text(json.dumps({**pack("CC-BY-SA thing"), "review": None}), encoding="utf-8")

section("which packs wait for review")
got = R.list_unreviewed([first, second])
ids = [p["id"] for p in got]
check("only packs that SAY unreviewed are listed (reviewed, broken, empty, wrong schema, no review: skipped)",
      ids == ["review:birds_ai", "review:fish"], ids)
check("each row says where it is served: /<folder>/<file>",
      got[0]["url"] == "/packs_review/Birds_AI.json" and got[1]["url"] == "/packs_local/fish.json", got)
check("...with its name, kind and question count",
      got[0]["name"].startswith("Birds") and got[0]["kind"] == "trivia" and got[0]["count"] == 1)
check("*** the same id in a later folder is skipped: moving a draft to packs_review keeps its id (and reviews) ***",
      sum(1 for p in got if p["id"] == "review:birds_ai") == 1 and got[0]["file"] == "Birds_AI.json")
check("a missing folder is not an error", R.list_unreviewed([tmp / "nope"]) == [])
check("one folder can be passed bare", [p["id"] for p in R.list_unreviewed(second)] == ["review:birds_ai", "review:fish"])

client = Path(__file__).resolve().parent.parent / "client"
real = R.list_unreviewed([client / "packs_review"])
check("the shipped packs_review/ folder lists real unreviewed packs (the starter packs)",
      len(real) >= 1 and all(p["url"].startswith("/packs_review/") for p in real), [p["id"] for p in real])
check("pack_library.js still names none of them (claude_questions' own rule)",
      all(p["file"] not in (client / "pack_library.js").read_text(encoding="utf-8") for p in real)
      and "packs_review" not in (client / "pack_library.js").read_text(encoding="utf-8"))

section("*** every question waiting in packs_review/ names its own source (Mike, 2026-10-04) ***")
from claude_questions import clean_source  # noqa: E402  (the server side of packs.js's per-item rule)

items = []
for p in real:
    shipped = json.loads((client / "packs_review" / p["file"]).read_text(encoding="utf-8"))
    items += [(p["file"], it) for it in shipped["items"]]
unsourced = [f"{f}: {it.get('question', '')[:50]}" for f, it in items if clean_source(it.get("source")) is None]
check(f"all {len(items)} questions carry a real source (a link, a reference, or 'common knowledge' with a reason)",
      len(items) >= 192 and not unsourced, unsourced[:5])
check("...and none still keeps the old checked.sources list beside it (moved, not copied)",
      all("sources" not in (it.get("checked") or {}) for _, it in items))

section("a review row")
ok = R.clean_review("pass", {"key": "c-abc123", "pack": "review:birds_ai", "question": "  Q1?  ", "answer": "a",
                             "place": "Bedside", "by": "forged", "at": "1999"})
check("a pass keeps key, pack, question, answer and place - and drops a browser's 'by' and 'at'",
      ok == {"key": "c-abc123", "pack": "review:birds_ai", "question": "Q1?", "answer": "a", "place": "Bedside"}, ok)
check("a flag may carry a note", R.clean_review("flag", {"key": "c-1", "question": "Q", "note": "wrong year"})["note"] == "wrong year")
check("a note needs words", raises(lambda: R.clean_review("note", {"key": "c-1", "note": "  "})))
check("unflag needs only the key", R.clean_review("unflag", {"key": "c-1"}) == {"key": "c-1"})
check("an unknown kind is refused", raises(lambda: R.clean_review("delete", {"key": "c-1"})))
check("a key that is not a question key is refused", raises(lambda: R.clean_review("pass", {"key": "../x", "question": "Q"})))
check("a pack id that is not a review pack is refused",
      raises(lambda: R.clean_review("pass", {"key": "c-1", "question": "Q", "pack": "maths_basic"})))
check("a pass needs the question it passes", raises(lambda: R.clean_review("pass", {"key": "c-1"})))
check("a novel is refused", raises(lambda: R.clean_review("note", {"key": "c-1", "note": "x" * (R.MAX_NOTE + 1)})))
check("text must be text", raises(lambda: R.clean_review("flag", {"key": "c-1", "question": ["Q"]})))
check("a person id rides along (who is reviewing: app.py checks and names them)",
      R.clean_review("pass", {"key": "c-1", "question": "Q", "person": "p_abc-1"})["person"] == "p_abc-1")
check("...an empty one is the same as none",
      "person" not in R.clean_review("pass", {"key": "c-1", "question": "Q", "person": ""}))
check("...and anything that is not an id is refused",
      raises(lambda: R.clean_review("pass", {"key": "c-1", "question": "Q", "person": "../x"}))
      and raises(lambda: R.clean_review("pass", {"key": "c-1", "question": "Q", "person": 7})))

section("the routes")
DB = str(tmp / "reviews_test.db")
os.environ["NIMROD_DB"] = DB
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
os.environ["DEVICE_KEYS"] = "acct-a:screen-secret-for-review-tests-only"
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
A = {"X-Dev-User": "acct-a"}
B = {"X-Dev-User": "acct-b"}
SCREEN = {"X-Device-Key": "screen-secret-for-review-tests-only"}

r = c.get("/api/packs/unreviewed", headers=A)
check("GET /api/packs/unreviewed lists the shipped review packs",
      r.status_code == 200 and any(p["url"].startswith("/packs_review/") for p in r.json()["packs"]), r.text[:200])
if real:
    s = c.get(real[0]["url"])
    check("*** and the static mount actually serves that path ***",
          s.status_code == 200 and s.json().get("review", {}).get("status") == "unreviewed", s.status_code)

row = {"kind": "pass", "data": {"key": "c-q1", "pack": "review:birds_ai", "question": "Q1?", "answer": "a"}}
r = c.post("/api/account/reviews", json=row, headers=A)
check("a signed-in pass is stored, stamped by the server", r.status_code == 200
      and r.json()["data"]["by"] == "the account owner" and r.json()["data"]["at"], r.text[:200])
c.put("/api/me/display-name", json={"name": "Mike"}, headers=A)
r = c.post("/api/account/reviews", json={"kind": "flag", "data": {"key": "c-q2", "question": "Q2?", "note": "two answers"}},
           headers=A)
check("...signed with the account's display name once it has one", r.json()["data"]["by"] == "Mike", r.text[:200])
r = c.post("/api/account/reviews", json={"kind": "note", "data": {"key": "c-q2", "note": "it is 1803"}}, headers=SCREEN)
check("*** a screen may review too, and is recorded as a screen, not as the owner ***",
      r.status_code == 200 and r.json()["data"]["by"] == "a screen", r.text[:200])
r = c.post("/api/account/reviews", json={"kind": "pass", "data": {"key": "nope", "question": "Q"}}, headers=A)
check("a bad row is a 400 in plain words", r.status_code == 400 and "key" in r.json()["detail"], r.text[:200])
got = c.get("/api/account/reviews", headers=A).json()
check("the account reads its log back, oldest first",
      [e["kind"] for e in got["events"]] == ["pass", "flag", "note"], got)
check("*** per account: another account sees none of it ***",
      c.get("/api/account/reviews", headers=B).json()["events"] == [])
check("the screen (same account) reads the same log",
      len(c.get("/api/account/reviews", headers=SCREEN).json()["events"]) == 3)
check("the review log is not a person's or a screen's stream (the claude key's scope is untouched)",
      c.get("/api/user-events/question-reviews", headers=A).json()["events"] == [])

section("*** who is reviewing: one of the login's own people, named by the server ***")
teen = c.post("/api/people", json={"name": "Robin"}, headers=A).json()
r = c.post("/api/account/reviews", json={"kind": "pass", "data": {"key": "c-q3", "question": "Q3?", "answer": "b",
                                                                  "person": teen["id"]}}, headers=A)
check("a review for a person on this login is signed with THAT person's name, not the account's",
      r.status_code == 200 and r.json()["data"]["by"] == "Robin" and r.json()["data"]["person"] == teen["id"]
      and "via" not in r.json()["data"], r.text[:300])
other = c.post("/api/people", json={"name": "Elsewhere"}, headers=B).json()
r = c.post("/api/account/reviews", json={"kind": "pass", "data": {"key": "c-q4", "question": "Q4?",
                                                                  "person": other["id"]}}, headers=A)
check("*** another login's person is refused (400, plain words), and nothing is written ***",
      r.status_code == 400 and "not on this login" in r.json()["detail"]
      and not any(e["data"].get("key") == "c-q4" for e in c.get("/api/account/reviews", headers=A).json()["events"]),
      r.text[:300])
r = c.post("/api/account/reviews", json={"kind": "flag", "data": {"key": "c-q5", "question": "Q5?",
                                                                  "person": teen["id"], "by": "forged"}}, headers=SCREEN)
check("a screen choosing a person: their name, and the row still says it came from a screen",
      r.status_code == 200 and r.json()["data"]["by"] == "Robin" and r.json()["data"]["via"] == "a screen", r.text[:300])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
