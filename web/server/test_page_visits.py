"""Who may see your page, which parts, and "See older messages". The rules, and the routes.

    py -3.13 test_page_visits.py

Two halves, like test_claims.py. The rules are pure and live in page_visits.py (and notes.history_entry). Then the
HTTP routes through FastAPI's TestClient against a throwaway database (DECISIONS.md 2026-10-04 night, items 7-9):
  * the owner sees everything; a connection sees only the parts opened to them (by default the card);
  * somebody not connected sees nothing; "Only me" shuts connections out; "people I pick" lets in only those picked;
  * the private parts (messages, recommended, your people, connect, Ask Nimrod) are never served, whatever is stored;
  * every option a visitor is sent is named (no media address, no unknown key, no non-YouTube link);
  * "See older messages": newest first, paged, who and when, take-downs left out, the owner's only.
"""
import os
import re
import sys
import tempfile

import page_visits as pv
from page_visits import (
    DEFAULT_SEEN, DEFAULT_WHO, OPENABLE_KINDS, PRIVATE_KINDS, REFUSAL_TEXT, page_refusal, picked_of, seen_by,
    visitor_options, visitor_view, who_of,
)
import notes

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


VID = "dQw4w9WgXcQ"

# ---------------------------------------------------------------- pure
section("who can see my page")
check("*** the default is the people you are connected with ***", DEFAULT_WHO == "connections" and who_of({}) == "connections"
      and who_of(None) == "connections" and who_of({"visitors": ""}) == "connections")
check("the three choices read as stored", [who_of({"visitors": w}) for w in ("me", "connections", "picked")] == ["me", "connections", "picked"])
check("*** a choice this version does not know reads as Only me (fail closed) ***", who_of({"visitors": "everyone"}) == "me"
      and who_of({"visitors": 7}) == "me")
check("picked: the row ids, junk ignored", picked_of({"picked": ["a", "", 3, None, "b"]}) == {"a", "b"} and picked_of({"picked": "a"}) == set())

section("who may open it")
check("*** a connection, by default ***", page_refusal({}, linked=True) == "")
check("*** nobody who is not connected, whatever the page says ***", page_refusal({}, linked=False) == "not-connected"
      and page_refusal({"visitors": "connections"}, linked=False) == "not-connected"
      and page_refusal({"visitors": "picked", "picked": ["r"]}, linked=False, visitor_rows={"r"}) == "not-connected")
check("*** Only me shuts connections out ***", page_refusal({"visitors": "me"}, linked=True) == "closed")
check("*** people I pick: only those picked ***", page_refusal({"visitors": "picked", "picked": ["r1"]}, linked=True, visitor_rows={"r1"}) == ""
      and page_refusal({"visitors": "picked", "picked": ["r1"]}, linked=True, visitor_rows={"r2"}) == "closed"
      and page_refusal({"visitors": "picked"}, linked=True, visitor_rows={"r1"}) == "closed")

section("which parts")
check("*** a part's default is Only me ***", DEFAULT_SEEN == "me" and seen_by({"kind": "about", "id": "a"}) == "me")
check("an openable part opened", seen_by({"kind": "about", "id": "a", "options": {"seenBy": "visitors"}}) == "visitors")
check("*** You follows the page (always shown when the page opens) ***", seen_by({"kind": "self", "id": "self"}) == "visitors")
check("*** the private parts are never shown, even marked open ***",
      all(seen_by({"kind": k, "id": k, "options": {"seenBy": "visitors"}}) == "me" for k in PRIVATE_KINDS))
check("*** a kind this version does not know is never shown ***", seen_by({"kind": "guestbook", "id": "g", "options": {"seenBy": "visitors"}}) == "me")
check("the openable and private sets", OPENABLE_KINDS == {"about", "clock", "photos", "video"}
      and PRIVATE_KINDS == {"messages", "recommended", "people", "connect", "nimrod"} and not OPENABLE_KINDS & PRIVATE_KINDS)

section("what a visitor is sent")
check("*** never saved a page: the card only ***", visitor_view({}) == [{"kind": "self", "id": "self", "options": {}}])
doc = {"visitors": "connections", "sections": [
    {"kind": "messages", "id": "messages", "options": {"seenBy": "visitors"}},
    {"kind": "about", "id": "about-1", "options": {"seenBy": "visitors", "text": "Hi", "secret": "x"}},
    {"kind": "self", "id": "self", "options": {"secret": "y"}},
    "junk", {"id": "x"},
    {"kind": "about", "id": "about-2", "options": {"text": "private words"}},
    {"kind": "photos", "id": "photos-1", "options": {"seenBy": "visitors", "size": "large",
                                                     "settings": {"sourceId": "src1", "album": "Family"}}},
    {"kind": "video", "id": "video-1", "options": {"seenBy": "visitors", "link": f"https://youtu.be/{VID}"}},
    {"kind": "video", "id": "video-2", "options": {"seenBy": "visitors", "link": "https://evil.example/x"}},
    {"kind": "clock", "id": "clock-1", "options": {"seenBy": "visitors", "size": "huge",
                                                   "settings": {"hour12": False, "showDate": True, "tz": "x", "size": "large"}}},
    {"kind": "guestbook", "id": "g1", "options": {"seenBy": "visitors"}},
    {"kind": "about", "id": "about-1", "options": {"seenBy": "visitors", "text": "dup"}},
]}
vv = visitor_view(doc)
check("*** You first, then only the opened parts, in the page's order ***",
      [s["id"] for s in vv] == ["self", "about-1", "photos-1", "video-1", "video-2", "clock-1"], str([s["id"] for s in vv]))
check("*** the private part marked open, the closed About me and the unknown kind: none of them ***",
      not any(s["id"] in ("messages", "about-2", "g1") for s in vv) and "private words" not in repr(vv))
byid = {s["id"]: s for s in vv}
check("*** only the named options: About me's words, nothing else ***", byid["about-1"]["options"] == {"text": "Hi"} and byid["self"]["options"] == {})
check("*** Pictures: its size only - never the folder or album ***", byid["photos-1"]["options"] == {"size": "large"} and "src1" not in repr(vv))
check("*** a video: one YouTube video's link; any other link is dropped ***",
      byid["video-1"]["options"].get("link") == f"https://www.youtube.com/watch?v={VID}" and "link" not in byid["video-2"]["options"]
      and "evil" not in repr(vv), str(byid["video-1"]))
check("a clock: its own few settings, a size it knows", byid["clock-1"]["options"] == {"settings": {"hour12": False, "showDate": True, "size": "large"}})
check("About me is cut to the page's own limit", len(visitor_options("about", {"text": "x" * 5000})["text"]) == pv.ABOUT_MAX)
words = " ".join(REFUSAL_TEXT.values())
check("*** the refusals say no 'account', 'token' or 'grant', and name nobody ***",
      not any(w in words.lower() for w in ("account", "token", "grant")) and not re.search(r"her screen|christine|cici", words, re.I))

section("the page's own colours (2026-10-05)")
check("*** a theme id is sent as it is; nothing set is '' ***", pv.visitor_theme({"theme": "warm"}) == "warm" and pv.visitor_theme({}) == ""
      and pv.visitor_theme(None) == "" and pv.visitor_theme({"theme": ""}) == "")
check("*** anything that is not a short id is not sent (no markup, no address, no object) ***",
      pv.visitor_theme({"theme": "<b>x</b>"}) == "" and pv.visitor_theme({"theme": "https://x.example/a.css"}) == ""
      and pv.visitor_theme({"theme": {"vars": 1}}) == "" and pv.visitor_theme({"theme": "x" * 41}) == ""
      and pv.visitor_theme({"theme": "fall-woods_2"}) == "fall-woods_2")

section("*** the client says the same (page_sections.js) ***")
js = open(os.path.join(os.path.dirname(__file__), "..", "client", "page_sections.js"), encoding="utf-8").read()


def js_list(name):
    m = re.search(name + r"\s*=\s*Object\.freeze\(\[([^\]]*)\]", js)
    return set(re.findall(r"'([a-z]+)'", m.group(1))) if m else None


check("*** OPENABLE_KINDS and PRIVATE_KINDS are the same lists on both sides ***",
      js_list("OPENABLE_KINDS") == set(OPENABLE_KINDS) and js_list("PRIVATE_KINDS") == set(PRIVATE_KINDS),
      f"{js_list('OPENABLE_KINDS')} {js_list('PRIVATE_KINDS')}")
check("the stored names and defaults match", all(re.search(p, js) for p in (
    r"WHO_KEY\s*=\s*'visitors'", r"PICKED_KEY\s*=\s*'picked'", r"SEEN_KEY\s*=\s*'seenBy'",
    r"DEFAULT_WHO\s*=\s*'connections'", r"DEFAULT_SEEN\s*=\s*'me'")))
check("the page's colours are stored under the same key on both sides", re.search(r"THEME_KEY\s*=\s*'theme'", js) and pv.THEME_KEY == "theme")

section("a line of older messages")
row = {"id": 5, "kind": "note", "created_at": "2026-10-04T10:00:00+00:00", "data": {"text": " Hello ", "author": "Sam"}}
check("words, who, when, which screen", notes.history_entry(row, "Kitchen") == {"id": 5, "text": "Hello", "author": "Sam",
      "at": "2026-10-04T10:00:00+00:00", "screen": "Kitchen"})
check("*** a take-down and a put-back are left out; no author says Someone ***",
      notes.history_entry({**row, "data": {"via": "taken down"}}) is None
      and notes.history_entry({**row, "data": {"text": "x", "via": "put back"}}) is None
      and notes.history_entry({**row, "data": {"text": "x"}})["author"] == "Someone"
      and notes.history_entry({**row, "kind": "other"}) is None)

# ---------------------------------------------------------------- HTTP
section("*** the routes, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_visits_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "visits_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
store = appmod.store


def H(u):
    return {"X-Dev-User": u}


def people(u):
    return {p["id"]: p for p in c.get("/api/people", headers=H(u)).json()["people"]}


def put_page(u, pid, data):
    v = c.get(f"/api/people/{pid}/state/page", headers=H(u)).json().get("version", 0)
    return c.put(f"/api/people/{pid}/state/page", json={"data": data, "base_version": v}, headers=H(u))


PAT, OSC, STR = "acct-pat", "acct-oscar", "acct-stranger"
pat = c.get("/api/people", headers=H(PAT)).json()["people"][0]["id"]
c.patch(f"/api/people/{pat}", json={"name": "Pat"}, headers=H(PAT))
robin = c.post("/api/people", json={"name": "Robin"}, headers=H(PAT)).json()["id"]
osc = c.get("/api/people", headers=H(OSC)).json()["people"][0]["id"]
c.patch(f"/api/people/{osc}", json={"name": "Oscar"}, headers=H(OSC))
stranger = c.get("/api/people", headers=H(STR)).json()["people"][0]["id"]
tok = c.post("/api/connect/invites", json={}, headers=H(PAT)).json()["token"]
check("(setup) Pat and Oscar connect", c.post("/api/invites/accept", json={"token": tok}, headers=H(OSC)).status_code == 200)
osc_pat = next(p["id"] for p in people(OSC).values() if p["kind"] == "connected")      # Oscar's card for Pat
pat_osc = next(p["id"] for p in people(PAT).values() if p["kind"] == "connected")      # Pat's card for Oscar

check("*** by default: Oscar's card for Pat says the page opens ***", people(OSC)[osc_pat].get("page") == "", str(people(OSC)[osc_pat]))
check("a card for somebody you look after carries no visit answer", "page" not in people(PAT)[robin])
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** a connection visiting a page nobody edited sees the card, and no more ***",
      r.status_code == 200 and [s["kind"] for s in r.json()["sections"]] == ["self"] and r.json()["name"] == "Pat", r.text)

full = {"visitors": "connections", "sections": [
    {"kind": "self", "id": "self", "options": {}},
    {"kind": "messages", "id": "messages", "options": {"seenBy": "visitors"}},
    {"kind": "recommended", "id": "recommended", "options": {"seenBy": "visitors"}},
    {"kind": "people", "id": "people", "options": {"seenBy": "visitors"}},
    {"kind": "about", "id": "about-open", "options": {"seenBy": "visitors", "text": "I like tea."}},
    {"kind": "about", "id": "about-shut", "options": {"text": "Just for me."}},
    {"kind": "photos", "id": "photos-1", "options": {"seenBy": "visitors", "settings": {"sourceId": "srcX"}}},
    {"kind": "video", "id": "video-1", "options": {"seenBy": "visitors", "link": f"https://youtu.be/{VID}"}},
]}
check("(setup) Pat saves his page", put_page(PAT, pat, full).status_code == 200)
check("*** the owner reads all of it ***", c.get(f"/api/people/{pat}/state/page", headers=H(PAT)).json()["data"] == full)
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
kinds = [s["id"] for s in r.json().get("sections", [])]
check("*** Oscar sees You, the opened About me, Pictures and the video - and only those ***",
      r.status_code == 200 and kinds == ["self", "about-open", "photos-1", "video-1"], r.text)
check("*** never the private parts, the shut About me, or the folder behind the pictures ***",
      not any(k in kinds for k in ("messages", "recommended", "people", "about-shut"))
      and "Just for me" not in r.text and "srcX" not in r.text)
check("*** Oscar cannot read Pat's page through his card the ordinary way (a connection's card is the card) ***",
      c.get(f"/api/people/{osc_pat}/state/page", headers=H(OSC)).status_code == 404)
check("*** ...nor write it ***", put_page(OSC, osc_pat, {"sections": []}).status_code == 403)
check("*** nor reach Pat's own row by its id ***", c.get(f"/api/people/{pat}/visit", headers=H(OSC)).status_code == 404
      and c.get(f"/api/people/{pat}/state/page", headers=H(OSC)).status_code == 404)

section("*** somebody not connected sees nothing ***")
check("a stranger cannot visit through anybody's card (the same 404 as no such person)",
      c.get(f"/api/people/{osc_pat}/visit", headers=H(STR)).status_code == 404
      and c.get("/api/people/doesnotexist01/visit", headers=H(STR)).status_code == 404)
r = c.get(f"/api/people/{stranger}/visit", headers=H(STR))
check("a card for somebody you look after is yours, not a visit (409, in words)", r.status_code == 409 and r.json()["error"] == "yours", r.text)

section("*** Only me ***")
check("(setup) Pat: Only me", put_page(PAT, pat, {**full, "visitors": "me"}).status_code == 200)
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** Oscar is refused, in words, naming Pat; nothing of the page is in the answer ***",
      r.status_code == 403 and r.json()["error"] == "closed" and r.json()["text"] == "Pat has not opened their page to you."
      and "tea" not in r.text, r.text)
check("...and his card says so before he presses", people(OSC)[osc_pat]["page"] == "closed")

section("*** people I pick ***")
put_page(PAT, pat, {**full, "visitors": "picked", "picked": [robin]})
check("picked somebody else: refused", c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC)).status_code == 403)
put_page(PAT, pat, {**full, "visitors": "picked", "picked": [pat_osc]})
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** picked Oscar (Pat's card for him): it opens ***", r.status_code == 200 and "about-open" in r.text, r.text)
check("*** a value a newer site wrote reads as Only me ***",
      put_page(PAT, pat, {**full, "visitors": "everyone"}).status_code == 200
      and c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC)).status_code == 403)
put_page(PAT, pat, full)

section("*** the page's colours go with the page (2026-10-05) ***")
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("no colours chosen: '' (the visitor's own)", r.status_code == 200 and r.json()["theme"] == "", r.text)
put_page(PAT, pat, {**full, "theme": "warm", "olderMessages": False})
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** Pat picks Warm: Oscar's visit carries 'warm' ***", r.status_code == 200 and r.json()["theme"] == "warm", r.text)
check("*** ...but not whether Pat's page shows older messages: that is Pat's own ***", "olderMessages" not in r.text, r.text)
put_page(PAT, pat, {**full, "theme": "warm", "visitors": "me"})
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** a page that is not open to Oscar sends no colours (nothing of the page) ***", r.status_code == 403 and "warm" not in r.text, r.text)
put_page(PAT, pat, {**full, "theme": "javascript:alert(1)"})
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** a stored value that is not a theme id is not sent ***", r.status_code == 200 and r.json()["theme"] == "" and "alert" not in r.text, r.text)
put_page(PAT, pat, full)

section("*** the connection ends without tidying (a broken link): nothing ***")
store.break_link(PAT, OSC, broken_by=PAT)
r = c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC))
check("*** not connected: refused, in words ***", r.status_code == 403 and r.json()["error"] == "not-connected" and "tea" not in r.text, r.text)
store.create_link(PAT, OSC, created_by=PAT)
check("connected again, it opens again", c.get(f"/api/people/{osc_pat}/visit", headers=H(OSC)).status_code == 200)

section("*** See older messages ***")
kit = c.post("/api/profiles", json={"name": "Kitchen", "person_id": pat}, headers=H(PAT)).json()["id"]
bed = c.post("/api/profiles", json={"name": "Bedside", "person_id": pat}, headers=H(PAT)).json()["id"]
for i in range(15):
    c.post(f"/api/profiles/{kit}/events/note", json={"kind": "note", "data": {"text": f"kitchen {i}", "author": "Sam"}}, headers=H(PAT))
    c.post(f"/api/profiles/{bed}/events/note2", json={"kind": "note", "data": {"text": f"bed {i}", "author": "Lee"}}, headers=H(PAT))
c.post(f"/api/profiles/{kit}/events/note", json={"kind": "note", "data": {"via": "taken down"}}, headers=H(PAT))
c.post(f"/api/profiles/{kit}/events/note", json={"kind": "note", "data": {"text": "kitchen 3", "author": "Sam", "via": "put back"}}, headers=H(PAT))
c.post(f"/api/profiles/{kit}/events/other", json={"kind": "note", "data": {"text": "not a note stream"}}, headers=H(PAT))
r = c.get(f"/api/people/{pat}/notes/history", headers=H(PAT))
j = r.json()
check("*** the first page: 20, newest first, with who, when and which screen ***",
      r.status_code == 200 and len(j["messages"]) == 20 and j["messages"][0] == {**j["messages"][0], "text": "bed 14", "author": "Lee", "screen": "Bedside"}
      and j["messages"][1]["text"] == "kitchen 14" and all(m["at"] for m in j["messages"])
      and [m["id"] for m in j["messages"]] == sorted((m["id"] for m in j["messages"]), reverse=True), str(j["messages"][:3]))
check("*** a take-down, a put-back and another stream are not in it ***",
      not any(m["text"] in ("", "not a note stream") for m in j["messages"]) and sum(m["text"] == "kitchen 3" for m in j["messages"]) <= 1)
check("there is more, and where it starts", j["more"] is True and j["next"] == j["messages"][-1]["id"])
c.post(f"/api/profiles/{kit}/events/note", json={"kind": "note", "data": {"text": "new while reading", "author": "Sam"}}, headers=H(PAT))
j2 = c.get(f"/api/people/{pat}/notes/history?before={j['next']}", headers=H(PAT)).json()
check("*** Show more: the next 10, older still; a note arriving meanwhile does not shift them ***",
      len(j2["messages"]) == 10 and j2["more"] is False and j2["next"] is None
      and max(m["id"] for m in j2["messages"]) < min(m["id"] for m in j["messages"])
      and j2["messages"][-1]["text"] == "kitchen 0" and "new while reading" not in repr(j2), str(j2)[:300])
check("*** all 30 notes, each once, across the two pages ***",
      len({m["id"] for m in j["messages"] + j2["messages"]}) == 30)
check("a limit is a limit (at most 50)", len(c.get(f"/api/people/{pat}/notes/history?limit=500", headers=H(PAT)).json()["messages"]) == 31)
check("*** no login ids in it ***", PAT not in r.text and "principal" not in r.text)
check("*** the person's own: a connection and a stranger get the same 404 ***",
      c.get(f"/api/people/{pat}/notes/history", headers=H(OSC)).status_code == 404
      and c.get(f"/api/people/{pat}/notes/history", headers=H(STR)).status_code == 404
      and c.get(f"/api/people/{osc_pat}/notes/history", headers=H(OSC)).json()["messages"] == [])
check("somebody with no screens: none, and nothing more", c.get(f"/api/people/{osc}/notes/history", headers=H(OSC)).json()
      == {"messages": [], "more": False, "next": None})

section("*** what we store: nothing new to describe ***")
check("*** no undocumented table (the choices live in the page record, which the state row now names) ***",
      c.get("/api/what-we-store").json()["undocumented"] == []
      and "who can see your page" in next(s["what"] for s in c.get("/api/what-we-store").json()["stores"] if s["table"] == "state"))

print(f"\n{'ALL PASS' if not failed else 'FAILED'}: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
