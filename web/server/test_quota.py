"""How much one login may keep (quota.py) - the rules, the count, the routes.

    py -3.13 test_quota.py

Mike, 2026-10-14: *"Seems like we would need some limit to keep the site free."* This file proves: the limit comes
from the environment (0 turns it off), every table is either counted or says why not, a write under or exactly at the
limit is kept and one past it is refused with a sentence (and nothing is kept), a login already over the limit keeps
reading, re-saving and removing and loses nothing, removing history makes room again, a note left on somebody else's
screen counts against whoever left it, and the signed-in login can read its own count.
"""
import os
import sys
import tempfile

import quota as q

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


# ---------------------------------------------------------------- the rules alone
section("the limit, from the environment")
check(f"unset: the default, {q.DEFAULT_LIMIT_MB} MB", q.limit_bytes({}) == q.DEFAULT_LIMIT_MB * 1_000_000)
check("set: that many megabytes", q.limit_bytes({q.ENV: "250"}) == 250_000_000)
check("a decimal is allowed (0.5 MB)", q.limit_bytes({q.ENV: "0.5"}) == 500_000)
check("a decimal rounds to the byte, not down by one (0.012345 MB = 12,345 bytes)",
      q.limit_bytes({q.ENV: "0.012345"}) == 12_345)
check("*** 0 turns it off (None) ***", q.limit_bytes({q.ENV: "0"}) is None)
check("not a number, negative, NaN or infinite: the default, never 'no limit'",
      all(q.limit_bytes({q.ENV: v}) == q.DEFAULT_LIMIT_MB * 1_000_000 for v in ("lots", "-5", "nan", "inf", " ")))

section("under, at, over - the decision")
check("under the limit: allowed", q.allowed(90, 5, 100))
check("*** exactly at the limit: allowed ***", q.allowed(95, 5, 100))
check("*** one byte past it: refused ***", not q.allowed(95, 6, 100))
check("*** a write that adds nothing is allowed even far over the limit (rule 4) ***",
      q.allowed(10_000, 0, 100) and q.allowed(10_000, -50, 100))
check("no limit: everything allowed", q.allowed(10 ** 12, 10 ** 9, None))

section("the sentence")
tables = {"history": {"rows": 9000, "bytes": 3_000_000}, "state": {"rows": 40, "bytes": 200_000},
          "events": {"rows": 10, "bytes": 2_000}}
s = q.refusal(101_200_000, 100_000_000, tables)
check("*** it says it was not saved, how much is kept and what the limit is ***",
      "not saved" in s and "101 MB" in s and "100 MB" in s, s)
check("*** it says what uses the space, in words (largest first) ***", "history kept with us and settings" in s, s)
check("*** it says what to do: remove history, keep things in the Nimrod folder ***",
      "Remove what is kept with us" in s and "Nimrod folder" in s, s)
check("*** and that nothing is lost and everything can still be seen ***", "Nothing already kept is lost" in s, s)
check("no table names or jargon in it", not any(w in s for w in ("state", "events", "bytes", "quota", "507")), s)
s2 = q.refusal(101_000_000, 100_000_000, {"events": {"rows": 1, "bytes": 90_000_000}, "state": {"rows": 1, "bytes": 1}})
check("when the activity log fills it, it says that cannot be removed here and who can raise the limit",
      "activity log" in s2 and "raise the limit" in s2, s2)
check("sizes read like people say them", (q.say_size(840), q.say_size(12_400), q.say_size(3_420_000),
                                          q.say_size(100_000_000)) == ("840 bytes", "12 KB", "3.4 MB", "100 MB"))
check("the public line names the limit", "100 MB" in q.limit_sentence(100_000_000)
      and "no limit" in q.limit_sentence(None))
check("the account line says how much of how much, and says over plainly",
      "1.2 MB" in q.usage_sentence(1_200_000, 100_000_000) and "over the limit" in q.usage_sentence(2, 1))
check("a new login is told it keeps nothing yet, not '0 bytes'", "nothing" in q.usage_sentence(0, 100_000_000)
      and "0 bytes" not in q.usage_sentence(0, 100_000_000))

section("the cache: never refuses on an old count")
calls = []
truth = {"bytes": 900}


def counter(acct):
    calls.append(acct)
    return {"bytes": truth["bytes"], "rows": 1, "tables": {"state": {"rows": 1, "bytes": truth["bytes"]}}}


cache = q.UsageCache(recount_s=300, fresh_s=30, near=0.9)
ok, seen = cache.check("a", 10, 10_000, counter, now=0)
check("first write: counted once", ok and len(calls) == 1 and seen["bytes"] == 900)
cache.added("a", 10)
ok, seen = cache.check("a", 10, 10_000, counter, now=10)
check("comfortably under: no new count, the accepted write is added", ok and len(calls) == 1 and seen["bytes"] == 910)
ok, _ = cache.check("a", 10, 10_000, counter, now=301)
check("after RECOUNT_S: counted again", ok and len(calls) == 2)
truth["bytes"] = 9_500                                      # meanwhile the login grew (another server, say)
ok, seen = cache.check("a", 8_200, 10_000, counter, now=302)
check("near the limit with a count under FRESH_S old: decided on that count + what was added", ok and len(calls) == 2)
cache.added("a", 8_200)
ok, seen = cache.check("a", 600, 10_000, counter, now=340)
check("*** near the limit with an older count: counted fresh before deciding (and refused on the fresh count) ***",
      not ok and len(calls) == 3 and seen["bytes"] == 9_500, seen)
truth["bytes"] = 100
cache.forget("a")
ok, _ = cache.check("a", 600, 10_000, counter, now=341)
check("*** forget (room was made): the next write counts afresh and goes ahead ***", ok and len(calls) == 4)
check("a write that adds nothing never even counts", cache.check("b", 0, 1, counter, now=0)[0] and len(calls) == 4)

# ---------------------------------------------------------------- the count, on a real database
section("the count")
tmp = tempfile.mkdtemp(prefix="nimrod_quota_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "quota_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
os.environ.pop(q.ENV, None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402
import storage_line as sl  # noqa: E402

store = appmod.store
tables_now = set(store._table_names())
check("*** every table is counted or says why not (a new table cannot be left out by forgetting it) ***",
      tables_now <= set(q.USAGE_TABLES) | set(q.NOT_COUNTED),
      sorted(tables_now - set(q.USAGE_TABLES) - set(q.NOT_COUNTED)))
check("...and every counted table exists", set(q.USAGE_TABLES) <= tables_now, sorted(set(q.USAGE_TABLES) - tables_now))
check("every counted table has words for the person", set(q.USAGE_TABLES) <= set(q.WORDS))
check("the event log's who-wrote-it index exists (rule 2's count goes through it)",
      any(r[1] == "ix_events_principal_id" for r in store._conn.execute("PRAGMA index_list(events)")))

c = TestClient(appmod.app)


def H(u):
    return {"X-Dev-User": u}


def setlimit(nbytes):
    """The limit, in bytes, through the environment variable the server reads (megabytes, decimal)."""
    if nbytes is None:
        os.environ.pop(q.ENV, None)
    else:
        os.environ[q.ENV] = f"{nbytes / 1_000_000:.6f}"


U = "quota-user"
person = c.get("/api/people", headers=H(U)).json()["people"][0]["id"]
screen = c.post("/api/profiles", json={"name": "Bedside", "person_id": person}, headers=H(U)).json()["id"]
r = c.put(f"/api/profiles/{screen}/state/photos", json={"data": {"interval": 10, "order": "shuffle"},
                                                         "base_version": 0}, headers=H(U))
check("setup: a setting saved", r.status_code == 200, r.text)
u = store.account_usage(U)
check("the count names what it found: people, screens, settings",
      {"people", "profiles", "state"} <= set(u["tables"]) and u["rows"] == sum(v["rows"] for v in u["tables"].values()), u)
row = store._conn.execute("SELECT * FROM state WHERE user_id=?", (U,)).fetchone()
want = sum(len(str(x).encode()) for x in row if x is not None) + q.ROW_OVERHEAD
check("*** a row counts every column's bytes plus ROW_OVERHEAD ***", u["tables"]["state"]["bytes"] == want,
      (u["tables"]["state"], want))
check("state_bytes is the stored size of that row's data", store.state_bytes(U, screen, "photos")
      == len(q.stored({"interval": 10, "order": "shuffle"})))
check("a row that does not exist: None", store.state_bytes(U, screen, "nope") is None)

section("the usage endpoint")
calls_before = []
real_count = store.account_usage
store.account_usage = lambda a: (calls_before.append(a), real_count(a))[1]
c.get("/api/me/storage", headers=H("reload-user"))
c.get("/api/me/storage", headers=H("reload-user"))
store.account_usage = real_count
check(f"a page reloaded within {appmod.MY_STORAGE_FRESH_S:.0f} s does not count again (one count, not two)",
      calls_before.count("reload-user") == 1, calls_before)
appmod.MY_STORAGE_FRESH_S = 0          # from here on, every read of the page is a fresh count (the tests compare it)
me = c.get("/api/me/storage", headers=H(U))
d = me.json()
check("*** GET /api/me/storage: the login's total, the limit, what uses it, and a sentence ***",
      me.status_code == 200 and d["used"] == store.account_usage(U)["bytes"] and d["limit"] == 100_000_000
      and d["over"] is False and d["parts"] and d["parts"][0]["what"] and "of the 100 MB" in d["text"], d)
check("...largest first", [p["bytes"] for p in d["parts"]] == sorted((p["bytes"] for p in d["parts"]), reverse=True))
check("...only the signed-in login's: another login sees its own, smaller count",
      c.get("/api/me/storage", headers=H("someone-new")).json()["used"] < d["used"])
w = c.get("/api/what-we-store").json()
check("*** the public 'what we keep' list says the limit, in a sentence ***",
      w["limit"]["bytes"] == 100_000_000 and "100 MB" in w["limit"]["text"] and w["undocumented"] == [], w.get("limit"))

section("under, at and over the limit, on the routes")
ev_url = f"/api/profiles/{screen}/events/scores"
EV = {"kind": "points", "data": {"game": "trivia", "points": 3}}
used = c.get("/api/me/storage", headers=H(U)).json()["used"]
adding = appmod._event_size(U, screen, "scores", EV["kind"], EV["data"])
setlimit(used + adding)
n0 = store.list_events(U, screen, "scores")["total"]
r = c.post(ev_url, json=EV, headers=H(U))
check("*** a write that lands EXACTLY on the limit is kept ***", r.status_code == 200, r.text)
r = c.post(ev_url, json=EV, headers=H(U))
check("*** the next one, past it, is refused: 507 ***", r.status_code == q.STATUS, (r.status_code, r.text))
detail = r.json().get("detail", "")
check("*** ...with the sentence: not saved, the limit, what uses it, what to do ***",
      "not saved" in detail and "the most one login can keep" in detail and "Remove what is kept with us" in detail,
      detail)
check("*** ...and nothing was kept (never a pretend save) ***", store.list_events(U, screen, "scores")["total"] == n0 + 1)
setlimit(None)
r = c.post(ev_url, json=EV, headers=H(U))
check("the limit raised back to the default (the variable unset): the same write is kept", r.status_code == 200, r.text)

section("a login already over the limit: read-only for the excess, nothing lost")
big = {"notes": ["a few words about the day " * 20] * 30}
r = c.put(f"/api/people/{person}/state/scrapbook", json={"data": big, "base_version": 0}, headers=H(U))
check("setup: a larger setting saved under the default limit", r.status_code == 200, r.text)
before = store.account_usage(U)
setlimit(before["bytes"] // 2)                          # the limit is lowered under it: this login is now over
c.get("/api/me/storage", headers=H(U))                  # (the page reads the count; the next write is decided on it)
me = c.get("/api/me/storage", headers=H(U)).json()
check("*** the account page says it is over, plainly ***", me["over"] is True and "over the limit" in me["text"], me)
check("*** reads still work: a setting, the event log, the people ***",
      c.get(f"/api/profiles/{screen}/state/photos", headers=H(U)).json()["data"]["interval"] == 10
      and c.get(ev_url, headers=H(U)).json()["total"] == n0 + 2
      and c.get(f"/api/people/{person}/state/scrapbook", headers=H(U)).json()["data"] == big)
v = c.get(f"/api/profiles/{screen}/state/photos", headers=H(U)).json()["version"]
r = c.put(f"/api/profiles/{screen}/state/photos", json={"data": {"interval": 10, "order": "shuffle"},
                                                         "base_version": v}, headers=H(U))
check("*** saving a setting again, no bigger, still works (a screen keeps working) ***", r.status_code == 200, r.text)
r = c.put(f"/api/profiles/{screen}/state/photos", json={"data": {"interval": 30, "order": "name!"},
                                                         "base_version": v + 1}, headers=H(U))
check("...changing a setting to something the same size still works", r.status_code == 200, r.text)
r = c.put(f"/api/profiles/{screen}/state/photos", json={"data": {"interval": 5}, "base_version": v + 2}, headers=H(U))
check("...and making one smaller", r.status_code == 200, r.text)
r = c.put(f"/api/profiles/{screen}/state/photos", json={"data": {"interval": 5, "order": "shuffle", "fade": 2},
                                                         "base_version": v + 3}, headers=H(U))
check("*** making a setting BIGGER is refused, 507 ***", r.status_code == q.STATUS, r.text)
r = c.put(f"/api/profiles/{screen}/state/newthing", json={"data": {"x": 1}, "base_version": 0}, headers=H(U))
check("*** a new setting is refused ***", r.status_code == q.STATUS, r.text)
check("*** an event is refused ***", c.post(ev_url, json=EV, headers=H(U)).status_code == q.STATUS)
check("*** a new screen, a new person, a new module are refused ***",
      c.post("/api/profiles", json={"name": "Kitchen", "person_id": person}, headers=H(U)).status_code == q.STATUS
      and c.post("/api/people", json={"name": "Second"}, headers=H(U)).status_code == q.STATUS
      and c.post(f"/api/profiles/{screen}/modules", json={"type": "clock"}, headers=H(U)).status_code == q.STATUS)
after = store.account_usage(U)
check("*** nothing already kept was touched: the same rows ***",
      after["rows"] == before["rows"] and c.get(f"/api/people/{person}/state/scrapbook", headers=H(U)).json()["data"] == big,
      (before["rows"], after["rows"]))
r = c.put(f"/api/people/{person}/state/scrapbook", json={"data": {"notes": []}, "base_version": 1}, headers=H(U))
check("*** removing things works over the limit (a setting emptied) ... ***", r.status_code == 200, r.text)
r = c.post(ev_url, json=EV, headers=H(U))
check("*** ... and once there is room, writes are kept again at once (a setting saved smaller counts as room) ***",
      r.status_code == 200, (r.status_code, r.text))

section("history kept with us: removing it makes room at once")
setlimit(None)
c.put(f"/api/people/{person}/state/{sl.HISTORY_KEY}", json={"data": {"games": "us"}, "base_version": 0}, headers=H(U))
TRIAL = {"kind": "trial", "data": {"game": "trivia", "concept": "rivers", "correct": True, "latencyMs": 2400,
                                   "prompt": "Which river runs through Cairo? " * 10}}
r = c.post(f"/api/people/{person}/history/gameplay", json={"rows": [TRIAL] * 50}, headers=H(U))
check("setup: fifty game results kept with us", r.status_code == 200 and r.json()["kept"] == 50, r.text)
c.get("/api/me/storage", headers=H(U))
setlimit(store.account_usage(U)["bytes"] + 100)
r = c.post(f"/api/people/{person}/history/gameplay", json={"rows": [TRIAL] * 5}, headers=H(U))
check("*** history past the limit: 507 (a 5xx, so the screen keeps the entries and tries again later) ***",
      r.status_code == q.STATUS and r.status_code >= 500, r.text)
check("...and nothing of the batch was kept",
      c.get(f"/api/people/{person}/history/gameplay", headers=H(U)).json()["total"] == 50)
r = c.delete(f"/api/people/{person}/history?stream=gameplay", headers=H(U))
check("\"Remove what is kept with us\" works over the limit", r.status_code == 200, r.text)
r = c.post(f"/api/people/{person}/history/gameplay", json={"rows": [TRIAL] * 5}, headers=H(U))
check("*** and the very next write is kept: removing forgot the old count ***", r.status_code == 200, r.text)

section("a note left on somebody else's screen counts against whoever left it (rule 2)")
setlimit(None)
OWN, VIS = "quota-own", "quota-vis"
op = c.get("/api/people", headers=H(OWN)).json()["people"][0]["id"]
os_ = c.post("/api/profiles", json={"name": "Bedside", "person_id": op}, headers=H(OWN)).json()["id"]
c.post(f"/api/profiles/{os_}/modules", json={"type": "note"}, headers=H(OWN))
c.post(f"/api/people/{op}/drive-grants", json={"subject_id": VIS}, headers=H(OWN))
c.put(f"/api/people/{op}/state/input-bindings", json={"data": {"noteWriters": [VIS]}, "base_version": 0}, headers=H(OWN))
c.get("/api/people", headers=H(VIS))
own0, vis0 = store.account_usage(OWN), store.account_usage(VIS)
note_url = f"/api/people/{op}/notes/{os_}/note"
r = c.post(note_url, json={"kind": "note", "data": {"text": "Thinking of you today " * 10}}, headers=H(VIS))
check("setup: the visitor leaves a note", r.status_code == 200, r.text)
own1, vis1 = store.account_usage(OWN), store.account_usage(VIS)
check("*** the note counts against the visitor who left it ... ***",
      vis1["bytes"] > vis0["bytes"] and vis1["tables"]["events"]["rows"] == vis0["tables"].get("events", {}).get("rows", 0) + 1,
      (vis0, vis1))
check("*** ... and not against the person it was left for ***", own1["bytes"] == own0["bytes"], (own0, own1))
setlimit(own1["bytes"] - 1)                    # the RECIPIENT is over the limit; the visitor is far under it
c.get("/api/me/storage", headers=H(OWN))
c.get("/api/me/storage", headers=H(VIS))
r = c.post(note_url, json={"kind": "note", "data": {"text": "Still thinking of you"}}, headers=H(VIS))
check("*** a full recipient still receives notes: it is the sender's room that is asked ***", r.status_code == 200, r.text)
setlimit(store.account_usage(VIS)["bytes"] + 10)
c.get("/api/me/storage", headers=H(VIS))
r = c.post(note_url, json={"kind": "note", "data": {"text": "One more"}}, headers=H(VIS))
check("*** a full sender cannot leave one, with the sentence ***", r.status_code == q.STATUS and "not saved" in r.text,
      r.text)

section("turned off")
os.environ[q.ENV] = "0"
r = c.post(ev_url, json=EV, headers=H(U))
check("*** NIMROD_ACCOUNT_LIMIT_MB=0: no limit, the write is kept ***", r.status_code == 200, r.text)
me = c.get("/api/me/storage", headers=H(U)).json()
check("...and the account page says there is none", me["limit"] is None and me["over"] is False
      and "no limit" in me["text"], me)
check("...and so does the public list", c.get("/api/what-we-store").json()["limit"]["bytes"] is None)
os.environ.pop(q.ENV, None)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
