"""A note left from somebody else's account - the rules, and the routes under them.

    py -3.13 test_notes.py

Two halves. The rules are pure and live in notes.py, so every "may this account write on
that person's note?" question is answered with no server and no clock. Then the HTTP routes,
through FastAPI's TestClient against a throwaway database, because the part that matters
most here - the server stamping who wrote a row, whatever the body claimed - only exists in
the route.
"""
import os
import sys
import tempfile

from notes import (
    MAX_NAME, MAX_TEXT, NOTE_STREAMS, SOMEONE, TAKEN_DOWN, RateLimit, build_row, clean_display_name,
    may_leave_note, visible_row, writers_from,
)

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


def raises(fn):
    try:
        fn()
        return False
    except ValueError:
        return True


NOW = "2026-10-01T12:00:00+00:00"
PAST = "2026-09-30T12:00:00+00:00"
FUTURE = "2026-11-01T12:00:00+00:00"


def g(**kw):
    base = {"subject_kind": "account", "subject_id": "vis", "expires_at": FUTURE}
    base.update(kw)
    return base


# ---------------------------------------------------------------- who may
section("who may leave a note - the owner, or a granted account the owner ticked")
ok = dict(account="vis", owner="own", now_iso=NOW)
check("the owner may, with no grant and no tick", may_leave_note("p1", account="own", owner="own",
      grants=[], writers=set(), now_iso=NOW))
check("*** a live grant AND a tick: may ***", may_leave_note("p1", grants=[g()], writers={"vis"}, **ok))
check("*** a live grant with NO tick: may not - driving is not leaving words on the screen ***",
      not may_leave_note("p1", grants=[g()], writers=set(), **ok))
check("a tick with NO grant: may not (the list cannot widen access on its own)",
      not may_leave_note("p1", grants=[], writers={"vis"}, **ok))
check("a tick whose grant has expired: may not",
      not may_leave_note("p1", grants=[g(expires_at=PAST)], writers={"vis"}, **ok))
check("a group grant does not count (groups are not implemented - fail closed)",
      not may_leave_note("p1", grants=[g(subject_kind="group")], writers={"vis"}, **ok))
check("a person with no owner (deleted, or never existed) - nobody may",
      not may_leave_note("p1", account="vis", owner=None, grants=[g()], writers={"vis"}, now_iso=NOW))
check("somebody else's tick does not let a stranger in",
      not may_leave_note("p1", account="stranger", owner="own", grants=[g()], writers={"vis"}, now_iso=NOW))
check("no account, no answer", not may_leave_note("p1", account="", owner="own", grants=[g()],
      writers={""}, now_iso=NOW))
check("*** the second way in: a links.py `messages` permission (made by a claim) - no grant, no tick needed ***",
      may_leave_note("p1", grants=[], writers=set(), messages=True, **ok))
check("...but never for a person who does not exist", not may_leave_note("p1", account="vis", owner=None, grants=[],
      writers=set(), messages=True, now_iso=NOW))

section("the ticked list, read from the person's row")
check("plain account names", writers_from({"noteWriters": ["a", " b ", "a"]}) == {"a", "b"})
check("the intercom list's shape ({account, name}) is understood too",
      writers_from({"noteWriters": [{"account": "a", "name": "Ann"}]}) == {"a"})
check("junk is ignored, not crashed on", writers_from({"noteWriters": [None, 3, {}, ""]}) == set()
      and writers_from({"noteWriters": "a"}) == set() and writers_from(None) == set() and writers_from({}) == set())

# ---------------------------------------------------------------- the row
section("*** the row the server writes - the author is the server's, never the body's ***")
r = build_row({"text": "  Back at 3.  ", "author": "Mom"}, display_name="Aunt Dolly")
check("*** a forged author is replaced by the account's own name ***", r["author"] == "Aunt Dolly", str(r))
check("the words are trimmed", r["text"] == "Back at 3.")
check("asking to be 'Someone' is honoured (the room is not told; the owner's log still is)",
      build_row({"text": "x", "author": SOMEONE}, display_name="Aunt Dolly")["author"] == SOMEONE)
check("no name set: 'Someone', whatever the body said",
      build_row({"text": "x", "author": "Mom"}, display_name="")["author"] == SOMEONE)
check("an empty note is refused", raises(lambda: build_row({"text": "   "}, display_name="")))
check("a missing note is refused", raises(lambda: build_row({}, display_name="")))
check(f"*** more than {MAX_TEXT} characters is refused, not quietly cut ***",
      raises(lambda: build_row({"text": "x" * (MAX_TEXT + 1)}, display_name="")))
check(f"exactly {MAX_TEXT} is fine", len(build_row({"text": "x" * MAX_TEXT}, display_name="")["text"]) == MAX_TEXT)
r2 = build_row({"text": "x", "via": "put back", "from": 7, "at": 1, "evil": "<script>", "author": "Mom"},
               display_name="Jo")
check("only the note's own fields are kept; anything else in the body is dropped",
      set(r2) == {"text", "author", "via", "from"}, str(r2))
check("'put back' and its source row survive", r2["via"] == "put back" and r2["from"] == 7)
check("an unknown 'via' becomes 'changed'", build_row({"text": "x", "via": "hax"}, display_name="")["via"] == "changed")
check("'from' must be a row number", build_row({"text": "x", "from": "1; drop"}, display_name="")["from"] is None
      and build_row({"text": "x", "from": True}, display_name="")["from"] is None)
check("the note streams are the module's three", NOTE_STREAMS == ("note", "note2", "note3"))

section("*** taking the note down - a row of its own, never a delete ***")
td = build_row({"via": TAKEN_DOWN, "from": 7, "author": "Mom"}, display_name="Jo")
check("*** a take-down needs no words, and is a row like any other ***",
      td == {"text": "", "author": "Jo", "via": TAKEN_DOWN, "from": 7}, str(td))
check("*** words sent with a take-down are dropped (it is 'no note showing', not a note) ***",
      build_row({"via": TAKEN_DOWN, "text": "sneaky"}, display_name="")["text"] == "")
check("a take-down is signed the same way as a note (the account's name, or 'Someone')",
      build_row({"via": TAKEN_DOWN, "author": SOMEONE}, display_name="Jo")["author"] == SOMEONE
      and build_row({"via": TAKEN_DOWN}, display_name="")["author"] == SOMEONE)
check("the words 'taken down' are the module's own (note.js TAKEN_DOWN)", TAKEN_DOWN == "taken down")
check("an empty note that is NOT a take-down is still refused",
      raises(lambda: build_row({"text": "", "via": "changed"}, display_name="")))

section("what a visitor reads back - the screen's view, not the log's")
full = {"id": 4, "kind": "note", "data": {"text": "hi", "author": "Jo", "via": "changed", "from": None,
        "at": 5, "x": 1}, "created_at": NOW, "principal_id": "google:123", "principal_type": "human",
        "session_id": "s", "producer_version": None, "attested_by": None, "attested_at": None}
v = visible_row(full)
check("*** no account ids: who the other writers ARE is the owner's business ***",
      "principal_id" not in v and "google:123" not in repr(v), str(v))
check("the words, the name, when, and the row id are there",
      v["id"] == 4 and v["data"]["text"] == "hi" and v["data"]["author"] == "Jo" and v["created_at"] == NOW)
check("stray data keys are not passed through", set(v["data"]) <= {"text", "author", "via", "from"})

section("display names")
check("trimmed, inner spaces collapsed", clean_display_name("  Aunt   Dolly ") == "Aunt Dolly")
check("empty is allowed (it clears the name -> 'Someone')", clean_display_name("") == "" and clean_display_name(None) == "")
check(f"over {MAX_NAME} is refused", raises(lambda: clean_display_name("x" * (MAX_NAME + 1))))
check("markup is refused", raises(lambda: clean_display_name("<b>Jo</b>")))
check("apostrophes and accents are fine", clean_display_name("Zoë O’Neil") == "Zoë O’Neil")

section("the rate limit")
t = [0.0]
rl = RateLimit(limit=3, window=60, clock=lambda: t[0])
check("three in a minute", all(rl.hit("k") for _ in range(3)))
check("*** the fourth is refused ***", not rl.hit("k"))
check("another key is not affected", rl.hit("other"))
t[0] = 61
check("and a minute later it is open again", rl.hit("k"))

# ---------------------------------------------------------------- HTTP
section("*** the routes, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_notes_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "notes_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)


def H(u):
    return {"X-Dev-User": u}


OWN, VIS, STR = "own-a", "vis-b", "str-c"
person = c.get("/api/people", headers=H(OWN)).json()["people"][0]["id"]
screen = c.post("/api/profiles", json={"name": "Bedside", "person_id": person}, headers=H(OWN)).json()["id"]
c.post(f"/api/profiles/{screen}/modules", json={"type": "note"}, headers=H(OWN))
other_person = c.post("/api/people", json={"name": "Second"}, headers=H(OWN)).json()["id"]
other_screen = c.post("/api/profiles", json={"name": "Kitchen", "person_id": other_person}, headers=H(OWN)).json()["id"]
str_person = c.get("/api/people", headers=H(STR)).json()["people"][0]["id"]
str_screen = c.post("/api/profiles", json={"name": "Theirs", "person_id": str_person}, headers=H(STR)).json()["id"]

base = f"/api/people/{person}/notes"
url = f"{base}/{screen}/note"
grant = c.post(f"/api/people/{person}/drive-grants", json={"subject_id": VIS}, headers=H(OWN)).json()
check("setup: a drive grant for the visitor", grant.get("subject_id") == VIS, str(grant))

r = c.get(f"{base}/screens", headers=H(VIS))
check("*** granted but not ticked: 403 on the screen list ***", r.status_code == 403, r.text)
r = c.post(url, json={"kind": "note", "data": {"text": "hi"}}, headers=H(VIS))
check("*** ...and 403 on writing ***", r.status_code == 403, r.text)
check("...and on reading", c.get(url, headers=H(VIS)).status_code == 403)

put = c.put(f"/api/people/{person}/state/input-bindings",
            json={"data": {"noteWriters": [VIS]}, "base_version": 0}, headers=H(OWN))
check("setup: the owner ticks them, on the person's own row", put.status_code == 200, put.text)
r = c.put(f"/api/people/{person}/state/input-bindings",
          json={"data": {"noteWriters": [VIS]}, "base_version": 0}, headers=H(VIS))
check("the visitor cannot tick themselves (the row is the owner's)", r.status_code == 404, r.text)

r = c.get(f"{base}/screens", headers=H(VIS))
scr = r.json().get("screens", []) if r.status_code == 200 else []
check("ticked: the screen list shows this person's screens only, and which has a note panel",
      r.status_code == 200 and [s["id"] for s in scr] == [screen] and scr[0]["has_note"] is True
      and scr[0]["name"] == "Bedside", r.text)
check("the list is names and ids, nothing else", all(set(s) == {"id", "name", "has_note"} for s in scr))

me = c.get("/api/me", headers=H(VIS)).json()
check("/api/me reports a display name, empty until one is set", me.get("display_name") == "", str(me))
r = c.post(url, json={"kind": "note", "data": {"text": "Before a name", "author": "Mom"}}, headers=H(VIS))
check("*** no name set: signed 'Someone', not the name in the body ***",
      r.status_code == 200 and r.json()["data"]["author"] == SOMEONE, r.text)

r = c.put("/api/me/display-name", json={"name": "  Aunt  Dolly "}, headers=H(VIS))
check("a name can be set", r.status_code == 200 and r.json()["display_name"] == "Aunt Dolly", r.text)
check("...and /api/me returns it", c.get("/api/me", headers=H(VIS)).json()["display_name"] == "Aunt Dolly")
check("a name with markup is refused", c.put("/api/me/display-name", json={"name": "<i>x</i>"}, headers=H(VIS)).status_code == 400)
check("a name that is too long is refused", c.put("/api/me/display-name", json={"name": "x" * 41}, headers=H(VIS)).status_code == 400)
check("names are per account (the owner's is still empty)", c.get("/api/me", headers=H(OWN)).json()["display_name"] == "")

r = c.post(url, json={"kind": "note", "data": {"text": "Thinking of you.", "author": "Mom", "at": 1}}, headers=H(VIS))
row = r.json()
check("*** FORGED AUTHOR: the body said 'Mom', the row says the account's own name ***",
      r.status_code == 200 and row["data"]["author"] == "Aunt Dolly", r.text)
check("the visitor's own copy back carries no account id", "principal_id" not in row, r.text)
check("the server's time, not the client's", row.get("created_at") and "at" not in row["data"])
r = c.post(url, json={"kind": "note", "data": {"text": "Anonymous", "author": "Someone"}}, headers=H(VIS))
check("asking to be 'Someone' works", r.status_code == 200 and r.json()["data"]["author"] == SOMEONE)

own_view = c.get(f"/api/profiles/{screen}/events/note", headers=H(OWN)).json()["events"]
check("*** the OWNER's log knows which account wrote each row, whatever name it shows ***",
      [e["principal_id"] for e in own_view] == [VIS, VIS, VIS] and all(e["principal_type"] == "human" for e in own_view),
      str([(e["principal_id"], e["data"].get("author")) for e in own_view]))
check("including the anonymous one", own_view[-1]["data"]["author"] == SOMEONE and own_view[-1]["principal_id"] == VIS)

vis_view = c.get(url, headers=H(VIS)).json()
check("*** the visitor reads the same note and history the screen shows ***",
      [e["data"]["text"] for e in vis_view["events"]] == ["Before a name", "Thinking of you.", "Anonymous"]
      and vis_view["total"] == 3, str(vis_view))
check("*** ...with no account ids in it ***", "principal_id" not in repr(vis_view) and VIS not in repr(vis_view))

# The owner's kiosk writes through its own route, and the visitor sees that too.
c.post(f"/api/profiles/{screen}/events/note", json={"kind": "note", "data": {"text": "From the kiosk", "author": "Mike"}},
       headers=H(OWN))
check("a note left on the screen itself shows up for the visitor",
      c.get(url, headers=H(VIS)).json()["events"][-1]["data"]["text"] == "From the kiosk")

section("what the route will NOT do")
check("another stream (not a note) is refused",
      c.post(f"{base}/{screen}/points", json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 400)
check("...and cannot be read either", c.get(f"{base}/{screen}/points", headers=H(VIS)).status_code == 400)
check("the second and third notes are allowed",
      c.post(f"{base}/{screen}/note2", json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 200)
check("another kind of row is refused",
      c.post(url, json={"kind": "points", "data": {"text": "x"}}, headers=H(VIS)).status_code == 400)
check("an empty note is refused", c.post(url, json={"kind": "note", "data": {"text": " "}}, headers=H(VIS)).status_code == 400)
check(f"*** {MAX_TEXT + 1} characters is refused ***",
      c.post(url, json={"kind": "note", "data": {"text": "x" * (MAX_TEXT + 1)}}, headers=H(VIS)).status_code == 400)
check("*** a screen belonging to ANOTHER of the owner's people is refused ***",
      c.post(f"{base}/{other_screen}/note", json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 404)
check("*** a screen of a different account entirely is refused ***",
      c.post(f"{base}/{str_screen}/note", json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 404)
check("there is no edit", c.put(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 405)
check("there is no delete", c.delete(url, headers=H(VIS)).status_code == 405)
check("the owner's own event routes are still closed to the visitor",
      c.get(f"/api/profiles/{screen}/events/note", headers=H(VIS)).status_code == 404
      and c.post(f"/api/profiles/{screen}/events/note", json={"kind": "note", "data": {"text": "x"}},
                 headers=H(VIS)).status_code == 404)
check("...and so is any other of the person's streams",
      c.get(f"/api/people/{person}/events/remote", headers=H(VIS)).status_code == 404)

section("strangers, and ids that do not exist")
r1 = c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(STR))
r2 = c.post(f"/api/people/doesnotexist123/notes/{screen}/note", json={"kind": "note", "data": {"text": "x"}}, headers=H(STR))
check("*** a stranger is refused ***", r1.status_code == 403, r1.text)
check("*** and a person that does not exist looks EXACTLY the same (no id oracle) ***",
      r2.status_code == 403 and r1.json() == r2.json(), f"{r1.text} vs {r2.text}")
check("a stranger cannot read either", c.get(url, headers=H(STR)).status_code == 403)
check("a malformed id is a 400, not a lookup", c.get("/api/people/bad!id/notes/screens", headers=H(VIS)).status_code in (400, 404))

section("the owner")
r = c.post(url, json={"kind": "note", "data": {"text": "Owner here", "author": "Whoever"}}, headers=H(OWN))
check("the owner may use the same route, with no grant and no tick, signed by their own name rule",
      r.status_code == 200 and r.json()["data"]["author"] == SOMEONE, r.text)
check("...and sees the screen list", c.get(f"{base}/screens", headers=H(OWN)).status_code == 200)

section("*** taking the note down, through the route ***")
before_td = c.get(url, headers=H(OWN)).json()
on_show = before_td["events"][-1]
r = c.post(url, json={"kind": "note", "data": {"via": TAKEN_DOWN, "from": on_show["id"], "text": "sneaky"}},
           headers=H(VIS))
check("*** a ticked visitor may take the note down - the same permission as writing one ***",
      r.status_code == 200 and r.json()["data"]["via"] == TAKEN_DOWN and r.json()["data"]["text"] == ""
      and r.json()["data"]["from"] == on_show["id"], r.text)
check("the take-down is signed by the server, like a note", r.status_code == 200 and r.json()["data"]["author"] == "Aunt Dolly")
after_td = c.get(url, headers=H(OWN)).json()
check("*** nothing is deleted: the history grew by one, every earlier note still there ***",
      after_td["total"] == before_td["total"] + 1
      and [e["id"] for e in after_td["events"][:-1]] == [e["id"] for e in before_td["events"]], str(after_td["total"]))
check("the take-down is the newest entry (the screen reads it as 'no note showing')",
      after_td["events"][-1]["data"]["via"] == TAKEN_DOWN)
check("the owner's log knows who took it down",
      c.get(f"/api/profiles/{screen}/events/note", headers=H(OWN)).json()["events"][-1].get("principal_id") == VIS)
check("*** a stranger cannot take it down ***",
      c.post(url, json={"kind": "note", "data": {"via": TAKEN_DOWN}}, headers=H(STR)).status_code == 403)
r = c.post(f"/api/profiles/{screen}/events/note", json={"kind": "note", "data": {"via": TAKEN_DOWN, "text": ""}},
           headers=H(OWN))
check("the screen itself takes it down through its own route", r.status_code == 200, r.text)
r = c.post(url, json={"kind": "note", "data": {"text": "Back again", "via": "put back", "from": on_show["id"]}}, headers=H(VIS))
check("a note can go up again after a take-down", r.status_code == 200 and r.json()["data"]["text"] == "Back again")

section("rate limit")
appmod._note_limit.reset()
before = c.get(url, headers=H(OWN)).json()["total"]
codes = [c.post(url, json={"kind": "note", "data": {"text": f"n{i}"}}, headers=H(VIS)).status_code
         for i in range(appmod._note_limit.limit + 1)]
check(f"*** {appmod._note_limit.limit} in the window are fine, the next is a 429 ***",
      codes[:-1] == [200] * appmod._note_limit.limit and codes[-1] == 429, str(codes))
check("a refused write wrote nothing",
      c.get(url, headers=H(OWN)).json()["total"] == before + appmod._note_limit.limit)
check("the limit is per writer: the owner is not held up by the visitor's flood",
      c.post(url, json={"kind": "note", "data": {"text": "owner"}}, headers=H(OWN)).status_code == 200)
appmod._note_limit.reset()

section("taking it back")
c.put(f"/api/people/{person}/state/input-bindings",
      json={"data": {"noteWriters": []}, "base_version": 1}, headers=H(OWN))
check("*** unticked: refused at once ***",
      c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 403)
check("*** ...and cannot take the note down either ***",
      c.post(url, json={"kind": "note", "data": {"via": TAKEN_DOWN}}, headers=H(VIS)).status_code == 403)
c.put(f"/api/people/{person}/state/input-bindings",
      json={"data": {"noteWriters": [VIS]}, "base_version": 2}, headers=H(OWN))
check("ticked again: allowed", c.post(url, json={"kind": "note", "data": {"text": "back"}}, headers=H(VIS)).status_code == 200)
c.delete(f"/api/people/{person}/drive-grants/{grant['id']}", headers=H(OWN))
check("*** the grant revoked: refused, though still ticked ***",
      c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(VIS)).status_code == 403)

section("the privacy page")
d = c.get("/api/what-we-store").json()
blob = repr(d)
check("the state row's description mentions the name you sign notes with", "sign notes" in blob, blob[:300])
# 2026-10-07 (row 2.54): the guide's notes and the walkthrough wrap-up are said, with what goes to the AI.
check("...and the guide's notes, the walkthrough wrap-up, and that only the chosen notes go to the AI",
      "Nimrod guide" in blob and "wrap up a walkthrough" in blob and "sends only the notes you chose" in blob, blob[:300])

try:  # the throwaway database; a held SQLite file on Windows is left for the OS to clear
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
except Exception:  # noqa: BLE001
    pass

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
