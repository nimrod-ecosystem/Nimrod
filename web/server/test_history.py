"""History kept with us, opted in and capped - the rules, the routes, the cap and the roll-up.

    py -3.13 test_history.py

Mike, 2026-10-07 (row 2.58): *"maybe make having us save it as an option if it's not going to take a lot of
space or cost us anything. It has to be scalable though."* So: the person's own device is the default, "with
us" is an opt-in in the person's own row, and the server holds each person to a cap, rolling the oldest rows
into totals. This file proves the opt-in is read by the server (not trusted from the request), that the event
log still refuses play history whatever was chosen, that the cap holds and nothing past it is silently lost,
and that a person can remove it all.
"""
import os
import sys
import tempfile

import storage_line as sl

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


def refused(fn):
    try:
        fn()
        return None
    except sl.Refused as e:
        return (e.status, e.detail)


PLAY = {"kind": "play", "data": {"source": "youtube", "id": "dQw4w9WgXcQ", "panel": "yt-1"}, "at": "2026-10-07T10:00:00Z"}
TRIAL = {"kind": "trial", "data": {"game": "trivia", "session": "s1", "concept": "rivers", "responded": True,
                                   "correct": True, "latencyMs": 2400}}
WORD = {"kind": "select", "data": {"at": 1, "word": "drink", "id": "c-1", "board": "core", "index": 3, "via": "touch"}}

# ---------------------------------------------------------------- the rules alone
section("the rules alone (storage_line.py)")
check("the three history streams and the names the person's row uses for them",
      sl.history_kind("plays") == "plays" and sl.history_kind("gameplay") == "games" and sl.history_kind("words") == "words")
r = refused(lambda: sl.history_kind("notes"))
check("*** any other stream is not history: 400 (the table is not a general store) ***", r and r[0] == 400, r)
check("opted in only when the person's row says \"us\" for THAT kind",
      sl.opted_in({"plays": "us"}, "plays") and not sl.opted_in({"plays": "us"}, "gameplay")
      and not sl.opted_in({"plays": "device"}, "plays") and not sl.opted_in({}, "plays") and not sl.opted_in(None, "plays"))
r = refused(lambda: sl.check_history("plays", [PLAY], {}))
check("*** not opted in: refused 403, with a sentence naming where it stays instead ***",
      r and r[0] == 403 and "With us" in r[1] and "Nimrod folder" in r[1], r)
r = refused(lambda: sl.check_history("plays", [PLAY], {"plays": "folder"}))
check("...a different place chosen is not \"with us\" either", r and r[0] == 403, r)
check("opted in: a play passes", refused(lambda: sl.check_history("plays", [PLAY], {"plays": "us"})) is None)
check("...a trial on gameplay, a select on words",
      refused(lambda: sl.check_history("gameplay", [TRIAL], {"games": "us"})) is None
      and refused(lambda: sl.check_history("words", [WORD], {"words": "us"})) is None)
r = refused(lambda: sl.check_history("plays", [TRIAL], {"plays": "us"}))
check("*** a kind the stream does not take is refused (no game result smuggled in as a play) ***", r and r[0] == 400, r)
check("an entry with no data, or not an object, is refused",
      refused(lambda: sl.check_history("plays", [{"kind": "play"}], {"plays": "us"}))
      and refused(lambda: sl.check_history("plays", ["play"], {"plays": "us"})))
check("an empty batch is refused", refused(lambda: sl.check_history("plays", [], {"plays": "us"})))
r = refused(lambda: sl.check_history("plays", [PLAY] * (sl.HISTORY_POST_MAX + 1), {"plays": "us"}))
check(f"*** more than {sl.HISTORY_POST_MAX} in one batch is refused, 413 ***", r and r[0] == 413, r)
big = {"kind": "play", "data": {"source": "folder", "id": "x", "title": "t " * 600}}
r = refused(lambda: sl.check_history("plays", [big], {"plays": "us"}))
check(f"*** an entry over {sl.HISTORY_ROW_MAX_BYTES:,} bytes is refused, 413 ***", r and r[0] == 413, r)
pic = {"kind": "play", "data": {"source": "photos", "id": "data:image/png;base64,iVBOR"}}
r = refused(lambda: sl.check_history("plays", [pic], {"plays": "us"}))
check("*** the storage line's picture rule holds here too (no picture inside an entry) ***", r and r[0] == 400, r)
check("the largest entries the site writes fit: a trial with a long prompt, a folder play with title and artist",
      refused(lambda: sl.check_history("gameplay", [{"kind": "trial", "data": dict(TRIAL["data"], prompt="p" * 200,
                                                                                band="grade 8", mode="challenge")}],
                                        {"games": "us"})) is None
      and refused(lambda: sl.check_history("plays", [{"kind": "play", "data": {"source": "folder", "id": "M/" + "a" * 300,
                                                                               "title": "t" * 200, "by": "b" * 200}}],
                                        {"plays": "us"})) is None)
check("totals are grouped by what it was about: source and id; game and topic; board and word",
      sl.group_of("plays", "play", PLAY["data"]) == "youtube:dQw4w9WgXcQ"
      and sl.group_of("gameplay", "trial", TRIAL["data"]) == "trivia|rivers"
      and sl.group_of("words", "select", WORD["data"]) == "core|drink")
check("...a row naming nothing is counted under its kind, and a long name is capped",
      sl.group_of("plays", "play", {}) == "play"
      and len(sl.group_of("plays", "play", {"source": "folder", "id": "x" * 900})) == sl.HISTORY_GROUP_MAX)

section("rule 4 on the EVENT routes is unchanged by any choice (the log cannot be capped)")
r = refused(lambda: sl.check_event("yt-1", "play", {"id": "a", "at": 1}))
check("*** `play` on an event route is still refused, and says where it is kept instead ***",
      r and r[0] == 400 and "screen that played it" in r[1] and "Where your history is kept" in r[1], r)

# ---------------------------------------------------------------- the routes
section("the routes")
tmp = tempfile.mkdtemp(prefix="nimrod_history_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "history_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
U = "history-user"
H = {"X-Dev-User": U}
person = c.get("/api/people", headers=H).json()["people"][0]["id"]
screen = c.post("/api/profiles", json={"name": "Bedside", "person_id": person}, headers=H).json()["id"]
base = f"/api/people/{person}/history"

r = c.post(f"{base}/plays", json={"rows": [PLAY]}, headers=H)
check("*** a play for a person who never chose \"with us\" is refused, 403 ***", r.status_code == 403, r.text)
check("...and nothing was kept", c.get(f"{base}/plays", headers=H).json()["total"] == 0)
r = c.get(base, headers=H).json()
check("the summary says nothing is kept and what the cap is", r["kept"] == {} and r["cap"]["rows"] == sl.HISTORY_MAX_ROWS, r)

ok = c.put(f"/api/people/{person}/state/{sl.HISTORY_KEY}", json={"data": {"plays": "us"}, "base_version": 0}, headers=H)
check("the person chooses \"with us\" for what played (their own row, the ordinary state route)", ok.status_code == 200, ok.text)
rows = [dict(PLAY, data=dict(PLAY["data"], id=f"v{i}"), at=f"2026-10-07T10:{i:02d}:00Z", scope="yt-1") for i in range(5)]
rows.append(dict(PLAY, data={"source": "photos", "id": "IMG_1.jpg", "panel": "ph-1"}, scope="ph-1"))
r = c.post(f"{base}/plays", json={"rows": rows}, headers=H)
check("*** opted in: the batch is kept ***", r.status_code == 200 and r.json()["kept"] == 6, r.text)
got = c.get(f"{base}/plays", headers=H).json()
check("read back oldest first, with when it happened (the device's time) and what it was filed under",
      got["total"] == 6 and [x["data"]["id"] for x in got["rows"]][:2] == ["v0", "v1"]
      and got["rows"][0]["at"] == "2026-10-07T10:00:00Z" and got["rows"][0]["scope"] == "yt-1", got)
got = c.get(f"{base}/plays?scope=ph-1", headers=H).json()
check("...one panel's alone (what a fresh device asks for to fill its picker's memory)",
      [x["data"]["id"] for x in got["rows"]] == ["IMG_1.jpg"], got)
r = c.post(f"{base}/gameplay", json={"rows": [TRIAL]}, headers=H)
check("*** game results are still refused: \"with us\" was chosen for what played only ***", r.status_code == 403, r.text)
r = c.post(f"/api/profiles/{screen}/events/yt-1", json={"kind": "play", "data": {"id": "a", "at": 1}}, headers=H)
check("*** and the EVENT log still refuses a play for this person, opted in or not ***", r.status_code == 400, r.text)
r = c.post(f"{base}/notes", json={"rows": [PLAY]}, headers=H)
check("a stream that is not history is refused on the route", r.status_code == 400, r.text)
check("reading a stream that is not history is refused too", c.get(f"{base}/notes", headers=H).status_code == 400)
other = {"X-Dev-User": "someone-else"}
check("*** somebody else's login cannot read, write or remove this person's history (404) ***",
      c.get(f"{base}/plays", headers=other).status_code == 404
      and c.post(f"{base}/plays", json={"rows": [PLAY]}, headers=other).status_code == 404
      and c.delete(base, headers=other).status_code == 404)
summary = c.get(base, headers=H).json()
check("the summary counts what is kept, per kind", summary["kept"].get("plays", {}).get("rows") == 6
      and summary["place"] == {"plays": "us"}, summary)

c.put(f"/api/people/{person}/state/{sl.HISTORY_KEY}", json={"data": {"plays": "device"}, "base_version": 1}, headers=H)
r = c.post(f"{base}/plays", json={"rows": [PLAY]}, headers=H)
check("*** switched back to this device: new plays are refused at once (read from the row, every write) ***",
      r.status_code == 403, r.text)
check("...and what was kept can still be read (so it can be looked at before removing it)",
      c.get(f"{base}/plays", headers=H).json()["total"] == 6)
r = c.delete(f"{base}?stream=plays", headers=H)
check("*** \"Remove what is kept with us\" deletes it: rows and totals ***",
      r.status_code == 200 and r.json()["rows"] == 6 and c.get(f"{base}/plays", headers=H).json()["total"] == 0, r.text)

# ---------------------------------------------------------------- the cap and the roll-up
section("the cap and the roll-up (db.py history_append), with small numbers")
store = appmod.store
P = person


def add(stream, rows, **kw):
    opts = dict(group_of=sl.group_of, max_rows=50, roll_batch=10, totals_max=3)
    opts.update(kw)
    return store.history_append(U, P, stream, rows, **opts)


def counts():
    return store.history_counts(U, P)


plays = [{"kind": "play", "data": {"source": "youtube", "id": f"v{i % 4}"}, "at": f"2026-10-01T00:{i // 60:02d}:{i % 60:02d}Z"}
         for i in range(50)]
r = add("plays", plays)
check("50 rows at a cap of 50: all kept, nothing rolled", r == {"kept": 50, "rolled": 0, "rows": 50}, r)
r = add("plays", [{"kind": "play", "data": {"source": "youtube", "id": "v9"}, "at": "2026-10-02T00:00:00Z"}])
check("*** one over: the oldest 11 (1 over + a batch of 10) are rolled into totals at once ***",
      r == {"kept": 1, "rolled": 11, "rows": 40}, r)
lst = store.history_list(U, P, "plays", limit=1000)
check("*** ...the OLDEST went, the newest stayed ***",
      lst["total"] == 40 and lst["rows"][0]["at"] == "2026-10-01T00:00:11Z" and lst["rows"][-1]["data"]["id"] == "v9",
      (lst["rows"][0]["at"], lst["rows"][-1]))
tot = {t["group"]: t for t in lst["totals"]}
check("*** ...and nothing is lost: the totals count exactly what was rolled (11), by what it was ***",
      sum(t["n"] for t in lst["totals"]) == 11 and tot["youtube:v0"]["n"] == 3 and tot["youtube:v2"]["n"] == 3, tot)
check("...with the first and last time each was played",
      tot["youtube:v0"]["first_at"] == "2026-10-01T00:00:00Z" and tot["youtube:v0"]["last_at"] == "2026-10-01T00:00:08Z", tot)
check("history_counts says how many are kept and how many are counted",
      counts().get("plays") == {"rows": 40, "counted": 11}, counts())
for k in range(30):                      # push the same four videos through again: the totals add up
    add("plays", [{"kind": "play", "data": {"source": "youtube", "id": f"v{k % 4}"}, "at": f"2026-10-03T00:00:{k:02d}Z"}])
lst = store.history_list(U, P, "plays", limit=1000)
check("*** never more than the cap once a write returns, however many writes ***",
      lst["total"] <= 50 and counts()["plays"]["rows"] + counts()["plays"]["counted"] == 81, counts())
check("*** totals are bounded: at most totals_max names (3), the rest counted under \"(other)\" ***",
      len(lst["totals"]) <= 4 and any(t["group"] == sl.OTHER_GROUP for t in lst["totals"]),
      [t["group"] for t in lst["totals"]])

trials = [{"kind": "trial", "data": {"game": "trivia", "concept": "rivers", "responded": True, "correct": i % 3 != 0},
           "at": f"2026-10-04T00:00:{i:02d}Z"} for i in range(30)]
add("gameplay", trials)
check("the cap is per PERSON, every kind together (plays + game results over 50 rolls the oldest of both)",
      counts()["plays"]["rows"] + counts()["gameplay"]["rows"] <= 50, counts())
gl = store.history_list(U, P, "gameplay", limit=1000)
pl = store.history_list(U, P, "plays", limit=1000)
check("...oldest first across kinds: the plays went before any game result",
      counts().get("gameplay", {}).get("counted", 0) == 0 and pl["total"] < 40, (counts(), pl["total"]))
add("gameplay", trials * 2)
gl = store.history_list(U, P, "gameplay", limit=1000)
g = next((t for t in gl["totals"] if t["group"] == "trivia|rivers"), None)
check("*** a rolled-up game result keeps how many were right (hits), not just how many ***",
      g is not None and 0 < g["hits"] < g["n"], g)

other_p = store.create_person(U, "Guest")["id"]
store.history_append(U, other_p, "plays", plays[:5], group_of=sl.group_of, max_rows=50, roll_batch=10, totals_max=3)
check("another person's rows are theirs: not counted against this person's cap",
      store.history_counts(U, other_p)["plays"]["rows"] == 5)
r = store.history_delete(U, P, "gameplay")
check("removing one kind leaves the others", r["rows"] > 0 and "gameplay" not in counts()
      and counts().get("plays", {}).get("counted", 0) > 0, (r, counts()))
store.delete_person(U, other_p)
check("*** removing a person removes their history kept here (rows and totals) ***",
      store.history_counts(U, other_p) == {})
r = store.history_delete(U, P)
check("removing all of it leaves nothing, totals included", counts() == {} and r["totals"] > 0, r)

# ---------------------------------------------------------------- the privacy page agrees
section("the privacy page says it, with the server's own number")
page = c.get("/api/what-we-store").json()
rows_by = {row["table"]: row for row in page["stores"]}
check("*** both tables are described (none undocumented) ***",
      "history" in rows_by and "history_totals" in rows_by and not page["undocumented"], page["undocumented"])
check("*** the history line is opt-in in words and states the cap the server enforces ***",
      "Only if you choose" in rows_by["history"]["what"] and f"{sl.HISTORY_MAX_ROWS:,}" in rows_by["history"]["what"],
      rows_by["history"]["what"][:200])
check("...and says what act creates it", "With us" in (rows_by["history"]["when"] or ""))
check("the never-stored line about what played now says \"unless you choose to keep it with us\"",
      any("screen that played" in n and "unless you choose" in n for n in page["never"]), page["never"])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
