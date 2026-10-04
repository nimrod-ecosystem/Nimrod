"""Invite somebody to take over a profile you made - the rules, and the routes under them.

    py -3.13 test_claims.py

Two halves, like test_notes.py. The rules are pure and live in claims.py. Then the HTTP routes,
through FastAPI's TestClient against a throwaway database: invite, peek, accept, expire, reuse,
cancel, stop sharing, what each side may and may not do afterwards, and the rate limits.
"""
import os
import sys
import tempfile

import claims
from claims import (
    CLAIMER_KEYS, DEFAULT_INVITE_DAYS, DEFAULT_MESSAGES, DEFAULT_SEE_PEOPLE, MAX_INVITE_DAYS, REFUSAL_TEXT,
    accept_refusal, clamp_days, hash_token, invite_refusal, invite_state, may_read_state, may_write_state,
    message_people, new_token, visible_people,
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


NOW = "2026-10-04T12:00:00+00:00"
PAST = "2026-10-01T12:00:00+00:00"
FUTURE = "2026-10-18T12:00:00+00:00"

# ---------------------------------------------------------------- pure
section("the token")
t1, t2 = new_token(), new_token()
check("two tokens differ, and are long (32 random bytes, url-safe)", t1 != t2 and len(t1) >= 43, str(len(t1)))
check("*** only a hash is stored: sha-256 hex, and not the token ***", len(hash_token(t1)) == 64 and t1 not in hash_token(t1))
check("the same token hashes the same; spaces around a pasted link do not matter",
      hash_token(t1) == hash_token(f"  {t1}\n") and hash_token(t1) != hash_token(t2))
check("an empty token hashes to nothing (never matches a row)", hash_token("") == "" and hash_token(None) == "")

section("how long a link works")
check("*** 14 days by default ***", DEFAULT_INVITE_DAYS == 14 and clamp_days(None) == 14)
check("1..30 may be asked for", clamp_days(1) == 1 and clamp_days(MAX_INVITE_DAYS) == 30)
check("0, 31, junk are refused", raises(lambda: clamp_days(0)) and raises(lambda: clamp_days(31)) and raises(lambda: clamp_days("x")))
check("the defaults for a family: see the others, leave messages", DEFAULT_SEE_PEOPLE is True and DEFAULT_MESSAGES is True)

section("a link's state")
inv = {"owner_id": "own", "person_id": "p", "expires_at": FUTURE, "used_at": None, "cancelled_at": None}
check("live", invite_state(inv, NOW) == "live")
check("*** expired ***", invite_state({**inv, "expires_at": PAST}, NOW) == "expired")
check("*** used beats expired (the more useful thing to say) ***", invite_state({**inv, "used_at": NOW, "expires_at": PAST}, NOW) == "used")
check("cancelled", invite_state({**inv, "cancelled_at": NOW}, NOW) == "cancelled")
check("no row: unknown; no expiry: expired (never live forever)", invite_state(None, NOW) == "unknown"
      and invite_state({**inv, "expires_at": None}, NOW) == "expired")

section("who may invite")
ok = dict(account="own", owner="own", person_id="p", first_person_id="me", claimed=False)
check("the owner, for one of their people", invite_refusal(**ok) == "")
check("*** somebody else's person, or one that does not exist: not yours (the same answer) ***",
      invite_refusal(**{**ok, "account": "x"}) == "not-yours" and invite_refusal(**{**ok, "owner": None}) == "not-yours")
check("*** already taken over: refused ***", invite_refusal(**{**ok, "claimed": True}) == "claimed")
check("*** your own first person (you) is not handed over ***", invite_refusal(**{**ok, "person_id": "me"}) == "self")

section("who may accept")
acc = dict(account="mom", now_iso=NOW, claimed=False, person_exists=True, via_screen=False)
check("a signed-in login that is not the inviter's", accept_refusal(inv, **acc) == "")
check("*** the inviter's own login: refused ***", accept_refusal(inv, **{**acc, "account": "own"}) == "own")
check("*** a screen in a room: refused ***", accept_refusal(inv, **{**acc, "via_screen": True}) == "screen")
check("nobody signed in: refused", accept_refusal(inv, **{**acc, "account": ""}) == "signed-out")
check("*** already claimed: refused ***", accept_refusal(inv, **{**acc, "claimed": True}) == "claimed")
check("*** used, expired, cancelled: refused, saying which ***",
      accept_refusal({**inv, "used_at": NOW}, **acc) == "used" and accept_refusal({**inv, "expires_at": PAST}, **acc) == "expired"
      and accept_refusal({**inv, "cancelled_at": NOW}, **acc) == "cancelled")
check("the person was deleted after the link was made: does not work", accept_refusal(inv, **{**acc, "person_exists": False}) == "unknown")

section("what a claimer sees, reads, writes")
people = [{"id": "me", "name": "Pat"}, {"id": "c", "name": "Robin"}, {"id": "mom", "name": "Mom"}, {"id": "dad", "name": "Dad"}]
check("see_people: everybody", [p["id"] for p in visible_people(people, see_people=True, claimed_person_id="mom", first_person_id="me")]
      == ["me", "c", "mom", "dad"])
check("*** not see_people: only whoever sent it, and themselves ***",
      [p["id"] for p in visible_people(people, see_people=False, claimed_person_id="mom", first_person_id="me")] == ["me", "mom"])
cl = {"person_id": "mom", "owner_id": "own", "account_id": "MOM", "see_people": True, "messages": True}
args = dict(owner="own", claims_on_owner=[cl], owner_people=people, first_person_id="me")
check("the picture is the only key a claimer reads on themselves", CLAIMER_KEYS == frozenset({"avatar"})
      and may_read_state("avatar", actor="MOM", person_id="mom", **args)
      and not may_read_state("input-bindings", actor="MOM", person_id="mom", **args))
check("a claimer reads the faces of the people they can see, nothing else of theirs",
      may_read_state("avatar", actor="MOM", person_id="c", **args) and not may_read_state("home", actor="MOM", person_id="c", **args))
check("*** ...and not the faces of people they cannot see ***",
      not may_read_state("avatar", actor="MOM", person_id="c", **{**args, "claims_on_owner": [{**cl, "see_people": False}]})
      and may_read_state("avatar", actor="MOM", person_id="me", **{**args, "claims_on_owner": [{**cl, "see_people": False}]}))
check("a stranger reads nothing; the owner reads everything",
      not may_read_state("avatar", actor="x", person_id="mom", **args) and may_read_state("anything", actor="own", person_id="c", **args))
check("*** claimed: the claimer writes the picture, the owner may not ***",
      may_write_state("avatar", actor="MOM", person_id="mom", owner="own", claim=cl)
      and not may_write_state("avatar", actor="own", person_id="mom", owner="own", claim=cl))
check("claimed: the owner still writes everything else; the claimer nothing else",
      may_write_state("input-bindings", actor="own", person_id="mom", owner="own", claim=cl)
      and not may_write_state("input-bindings", actor="MOM", person_id="mom", owner="own", claim=cl))
check("unclaimed: the owner, as before", may_write_state("avatar", actor="own", person_id="c", owner="own", claim=None)
      and not may_write_state("avatar", actor="MOM", person_id="c", owner="own", claim=None))
check("messages: the people they can see, when allowed; none when not",
      message_people(cl, people, "me") == ["me", "c", "mom", "dad"] and message_people({**cl, "messages": False}, people, "me") == []
      and message_people({**cl, "see_people": False}, people, "me") == ["me", "mom"])
words = " ".join(REFUSAL_TEXT.values())
check("*** the words a person reads say no 'account', 'token' or 'grant' ***",
      not any(w in words.lower() for w in ("account", "token", "grant")), words)

# ---------------------------------------------------------------- HTTP
section("*** the routes, end to end ***")
tmp = tempfile.mkdtemp(prefix="nimrod_claims_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "claims_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402
import links  # noqa: E402

c = TestClient(appmod.app)


def H(u):
    return {"X-Dev-User": u}


OWN, MOM, DAD, STR = "own-mike", "acct-mom", "acct-dad", "str-x"
me = c.get("/api/people", headers=H(OWN)).json()["people"][0]["id"]
c.patch(f"/api/people/{me}", json={"name": "Pat"}, headers=H(OWN))
robin = c.post("/api/people", json={"name": "Robin"}, headers=H(OWN)).json()["id"]
mom = c.post("/api/people", json={"name": "Mom"}, headers=H(OWN)).json()["id"]
dad = c.post("/api/people", json={"name": "Dad"}, headers=H(OWN)).json()["id"]
bed = c.post("/api/profiles", json={"name": "Bedside", "person_id": robin}, headers=H(OWN)).json()["id"]
c.post(f"/api/profiles/{bed}/modules", json={"type": "note"}, headers=H(OWN))
c.put(f"/api/people/{robin}/state/input-bindings", json={"data": {"secret": "owner's"}, "base_version": 0}, headers=H(OWN))
c.put(f"/api/people/{mom}/state/avatar", json={"data": {"face": "drawn by Pat"}, "base_version": 0}, headers=H(OWN))
c.get("/api/people", headers=H(MOM))     # Mom's own login has its own "Me"

section("making a link")
r = c.post(f"/api/people/{mom}/invites", json={}, headers=H(OWN))
j = r.json()
check("*** the owner makes one: a long link, a path to join.html, 14 days ***",
      r.status_code == 200 and len(j.get("token", "")) >= 43 and j["path"] == f"/join.html?invite={j['token']}"
      and j["invite"]["state"] == "live" and j["invite"]["see_people"] and j["invite"]["messages"], r.text)
tok = j["token"]
from datetime import datetime, timedelta, timezone  # noqa: E402
exp = datetime.fromisoformat(j["invite"]["expires_at"])
check("...that runs out in about 14 days", timedelta(days=13, hours=23) < exp - datetime.now(timezone.utc) <= timedelta(days=14))
row = appmod.store.invite_by_hash(hash_token(tok))
check("*** stored as a hash: the token itself is nowhere in the database ***", row and row["token_hash"] == hash_token(tok))
import sqlite3  # noqa: E402
dump = "\n".join(sqlite3.connect(os.environ["NIMROD_DB"]).iterdump())
check("*** ...not in any table (a full dump does not contain it) ***", tok not in dump)
lst = c.get(f"/api/people/{mom}/invites", headers=H(OWN)).json()
check("the owner sees it waiting, without the link", len(lst["invites"]) == 1 and "token" not in repr(lst) and tok not in repr(lst)
      and lst["claimed"] is False, str(lst))
check("*** somebody else cannot make a link for your person (and cannot tell it exists) ***",
      c.post(f"/api/people/{mom}/invites", json={}, headers=H(STR)).status_code == 404
      and c.post("/api/people/doesnotexist1/invites", json={}, headers=H(STR)).status_code == 404)
r = c.post(f"/api/people/{me}/invites", json={}, headers=H(OWN))
check("*** your own first person (you) cannot be handed over ***", r.status_code == 409 and r.json()["error"] == "self", r.text)
check("days outside 1..30 are refused", c.post(f"/api/people/{dad}/invites", json={"days": 31}, headers=H(OWN)).status_code == 400)

section("a new link replaces the old one")
old = c.post(f"/api/people/{dad}/invites", json={}, headers=H(OWN)).json()["token"]
new = c.post(f"/api/people/{dad}/invites", json={"see_people": False, "messages": False}, headers=H(OWN)).json()["token"]
check("*** the older link for the same person is cancelled ***",
      c.post("/api/invites/peek", json={"token": old}).json()["state"] == "cancelled"
      and c.post("/api/invites/peek", json={"token": new}).json()["state"] == "live")
check("one link waiting per person", len(c.get(f"/api/people/{dad}/invites", headers=H(OWN)).json()["invites"]) == 1)

section("the join page's first look (before signing in)")
p = c.post("/api/invites/peek", json={"token": tok}).json()
check("*** who sent it and which person, in names ***", p["state"] == "live" and p["name"] == "Mom" and p["from"] == "Pat", str(p))
check("*** no account ids in it ***", OWN not in repr(p) and "owner" not in p, str(p))
check("a wrong link: does not work, in words", c.post("/api/invites/peek", json={"token": "nope" * 12}).status_code == 404)
check("the inviter looking at their own link is told so", c.post("/api/invites/peek", json={"token": tok}, headers=H(OWN)).json()["is_inviter"] is True)

section("accepting")
r = c.post("/api/invites/accept", json={"token": tok}, headers=H(OWN))
check("*** the inviter's own login cannot accept ***", r.status_code == 403 and r.json()["error"] == "own", r.text)
r = c.post("/api/invites/accept", json={"token": tok}, headers=H(MOM))
check("*** Mom accepts: it is hers ***", r.status_code == 200 and r.json()["name"] == "Mom" and r.json()["from"] == "Pat", r.text)
check("*** single use: the same link again is refused ***",
      c.post("/api/invites/accept", json={"token": tok}, headers=H(DAD)).json().get("error") == "used")
check("...and the first look says so", c.post("/api/invites/peek", json={"token": tok}).json()["state"] == "used")
r = c.post(f"/api/people/{mom}/invites", json={}, headers=H(OWN))
check("*** a person already taken over cannot be invited again ***", r.status_code == 409 and r.json()["error"] == "claimed", r.text)
check("*** ...and so cannot be claimed twice (the database's own key) ***",
      appmod.store.accept_invite(appmod.store.create_invite(OWN, mom, hash_token("x" * 40), FUTURE.replace("2026-10-18", "2099-01-01"))["id"], DAD)[0] == "claimed")
check("Mom's login now signs its notes 'Mom' (it had no name of its own)", c.get("/api/me", headers=H(MOM)).json()["display_name"] == "Mom")
check("the two logins are connected", links.link_is_active(appmod.store.get_link(OWN, MOM)))

section("*** what each side sees ***")
mine = c.get("/api/claims", headers=H(MOM)).json()
m = mine["mine"][0] if mine["mine"] else {}
check("*** Mom: 'you are Mom on Pat's people', and Pat's people as her connections ***",
      m.get("name") == "Mom" and m.get("from") == "Pat" and [x["name"] for x in m.get("people", [])] == ["Pat", "Robin", "Mom", "Dad"], str(mine))
check("...herself marked as her, Pat as whoever sent it", [x["name"] for x in m["people"] if x["you"]] == ["Mom"]
      and [x["name"] for x in m["people"] if x["sender"]] == ["Pat"])
check("no account ids on her side", OWN not in repr(mine))
given = c.get("/api/claims", headers=H(OWN)).json()["given"]
check("*** Pat: Mom has joined, by her name ***", len(given) == 1 and given[0]["person_id"] == mom and given[0]["by"] == "Mom", str(given))
check("no account ids on his side", MOM not in repr(given))
check("the owner's list says taken over", c.get(f"/api/people/{mom}/invites", headers=H(OWN)).json()["claimed"] is True)

section("*** what the claimer may do ***")
r = c.get(f"/api/people/{mom}/state/avatar", headers=H(MOM))
check("Mom reads her picture (the one Pat drew)", r.status_code == 200 and r.json()["data"].get("face") == "drawn by Pat", r.text)
v = r.json()["version"]
r = c.put(f"/api/people/{mom}/state/avatar", json={"data": {"face": "mine now"}, "base_version": v}, headers=H(MOM))
check("*** Mom changes her own picture ***", r.status_code == 200, r.text)
check("*** ...and Pat's account sees it (it is still stored on the person, on his account) ***",
      c.get(f"/api/people/{mom}/state/avatar", headers=H(OWN)).json()["data"].get("face") == "mine now")
r = c.put(f"/api/people/{mom}/state/avatar", json={"data": {"face": "Pat again"}, "base_version": v + 1}, headers=H(OWN))
check("*** Pat can no longer change her picture ***", r.status_code == 403 and "their own login" in r.text, r.text)
check("Pat still changes everything else about the person",
      c.put(f"/api/people/{mom}/state/home", json={"data": {"x": 1}, "base_version": 0}, headers=H(OWN)).status_code == 200)
check("Mom sees Robin's face (she can see Robin)", c.get(f"/api/people/{robin}/state/avatar", headers=H(MOM)).status_code == 200)
check("*** ...but nothing else of Robin's ***", c.get(f"/api/people/{robin}/state/input-bindings", headers=H(MOM)).status_code == 404
      and c.put(f"/api/people/{robin}/state/avatar", json={"data": {}, "base_version": 0}, headers=H(MOM)).status_code == 404)
check("*** ...nor anything else of her own person but the picture ***",
      c.get(f"/api/people/{mom}/state/input-bindings", headers=H(MOM)).status_code == 404
      and c.put(f"/api/people/{mom}/state/input-bindings", json={"data": {}, "base_version": 0}, headers=H(MOM)).status_code == 404)
url = f"/api/people/{robin}/notes/{bed}/note"
r = c.post(url, json={"kind": "note", "data": {"text": "Love you, Robin", "author": "Pat"}}, headers=H(MOM))
check("*** Mom leaves Robin a message (the invite said yes), signed with her own name ***",
      r.status_code == 200 and r.json()["data"]["author"] == "Mom", r.text)
check("the owner's log knows it was Mom's login",
      c.get(f"/api/profiles/{bed}/events/note", headers=H(OWN)).json()["events"][-1]["principal_id"] == MOM)

section("*** nothing reaches the inviter's screens beyond that ***")
check("*** Mom cannot call or drive Robin's screen (no grant: calls only where already allowed) ***",
      c.post(f"/api/drive/ticket/{robin}", headers=H(MOM)).status_code == 403)
check("...nor her own person's screens", c.post(f"/api/drive/ticket/{mom}", headers=H(MOM)).status_code == 403)
check("*** Pat's screens are not hers to open or list ***", c.get(f"/api/profiles/{bed}", headers=H(MOM)).status_code == 404
      and bed not in c.get("/api/profiles", headers=H(MOM)).text)
check("...nor the screen's own events", c.get(f"/api/profiles/{bed}/events/note", headers=H(MOM)).status_code == 404)
check("...nor the person's events", c.get(f"/api/people/{robin}/events/remote", headers=H(MOM)).status_code == 404)
check("*** Pat's people are not in Mom's own list ***", all(p["id"] not in (me, robin, mom, dad) for p in c.get("/api/people", headers=H(MOM)).json()["people"]))
check("no drive grants were made", appmod.store.grants_for_subject("account", MOM) == [])
check("*** a stranger gets nothing ***", c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(STR)).status_code == 403
      and c.get(f"/api/people/{mom}/state/avatar", headers=H(STR)).status_code == 404)
r = c.post(f"/api/people/{robin}/drive-grants", json={"subject_id": MOM}, headers=H(OWN))
check("*** once Pat shares Robin's screen with Mom, the call is allowed - the existing rule, unchanged ***",
      r.status_code == 200 and c.post(f"/api/drive/ticket/{robin}", headers=H(MOM)).status_code == 200)
c.delete(f"/api/people/{robin}/drive-grants/{r.json()['id']}", headers=H(OWN))

section("messages: the inviter's switch")
check("Pat turns messages off for Mom", c.put(f"/api/claims/{mom}/messages", json={"on": False}, headers=H(OWN)).status_code == 200)
check("*** Mom can no longer leave Robin a message ***",
      c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(MOM)).status_code == 403)
check("Mom cannot turn it back on herself", c.put(f"/api/claims/{mom}/messages", json={"on": True}, headers=H(MOM)).status_code == 404)
c.put(f"/api/claims/{mom}/messages", json={"on": True}, headers=H(OWN))
check("on again: allowed", c.post(url, json={"kind": "note", "data": {"text": "back"}}, headers=H(MOM)).status_code == 200)
newp = c.post("/api/people", json={"name": "Sis"}, headers=H(OWN)).json()["id"]
check("*** a person Pat adds later is reachable too (synced) ***", appmod.store.may_capability("messages", actor=MOM, person_id=newp))

section("a family: Dad joins too, with fewer choices")
r = c.post("/api/invites/accept", json={"token": new}, headers=H(DAD))
check("Dad accepts his own link", r.status_code == 200, r.text)
dm = c.get("/api/claims", headers=H(DAD)).json()["mine"][0]
check("*** Dad's link said 'not the others': he sees Pat and himself only ***", [x["name"] for x in dm["people"]] == ["Pat", "Dad"], str(dm))
check("*** ...and no messages (the link said no) ***", not appmod.store.may_capability("messages", actor=DAD, person_id=robin))
check("Mom sees Dad has joined", [x["joined"] for x in c.get("/api/claims", headers=H(MOM)).json()["mine"][0]["people"] if x["name"] == "Dad"] == [True])
check("Dad cannot see Robin's face", c.get(f"/api/people/{robin}/state/avatar", headers=H(DAD)).status_code == 404)

section("the person cannot be deleted from under them")
r = c.delete(f"/api/people/{mom}", headers=H(OWN))
check("*** Pat cannot delete Mom while she uses it ***", r.status_code == 409 and "stop sharing" in r.text, r.text)

section("*** stop sharing ***")
check("a stranger cannot", c.delete(f"/api/claims/{mom}", headers=H(STR)).status_code == 404)
check("*** Mom stops sharing ***", c.delete(f"/api/claims/{mom}", headers=H(MOM)).status_code == 200)
check("*** the person stays on Pat's account, picture and all ***",
      any(p["id"] == mom for p in c.get("/api/people", headers=H(OWN)).json()["people"])
      and c.get(f"/api/people/{mom}/state/avatar", headers=H(OWN)).json()["data"].get("face") == "mine now")
check("*** Mom's login reaches nothing any more ***", c.get(f"/api/people/{mom}/state/avatar", headers=H(MOM)).status_code == 404
      and c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(MOM)).status_code == 403
      and c.get("/api/claims", headers=H(MOM)).json()["mine"] == [])
check("*** the connection is broken, and its permissions gone ***", not links.link_is_active(appmod.store.get_link(OWN, MOM))
      and not appmod.store.may_capability("messages", actor=MOM, person_id=robin))
check("Pat can change her picture again", c.put(f"/api/people/{mom}/state/avatar",
      json={"data": {"face": "again"}, "base_version": c.get(f"/api/people/{mom}/state/avatar", headers=H(OWN)).json()["version"]},
      headers=H(OWN)).status_code == 200)
check("*** and invite somebody to it again ***", c.post(f"/api/people/{mom}/invites", json={}, headers=H(OWN)).status_code == 200)
check("the inviter can stop sharing too", c.delete(f"/api/claims/{dad}", headers=H(OWN)).status_code == 200
      and c.get("/api/claims", headers=H(DAD)).json()["mine"] == [])
check("Dad's link is gone with it", not links.link_is_active(appmod.store.get_link(OWN, DAD)))

section("cancel and expire")
t3 = c.post(f"/api/people/{dad}/invites", json={}, headers=H(OWN)).json()
check("*** the inviter cancels a waiting link ***",
      c.delete(f"/api/people/{dad}/invites/{t3['invite']['id']}", headers=H(OWN)).status_code == 200
      and c.post("/api/invites/accept", json={"token": t3["token"]}, headers=H(DAD)).json()["error"] == "cancelled")
check("nobody else can cancel it", c.delete(f"/api/people/{dad}/invites/{t3['invite']['id']}", headers=H(STR)).status_code == 404)
check("cancelling twice is a 404, not a pretend yes", c.delete(f"/api/people/{dad}/invites/{t3['invite']['id']}", headers=H(OWN)).status_code == 404)
etok = new_token()
appmod.store.create_invite(OWN, dad, hash_token(etok), PAST)
check("*** an expired link is refused, saying so ***",
      c.post("/api/invites/accept", json={"token": etok}, headers=H(DAD)).json()["error"] == "expired"
      and c.post("/api/invites/peek", json={"token": etok}).json()["state"] == "expired")
check("...and it made nothing", appmod.store.get_claim(dad) is None)

section("screens may not")
appmod.store._conn.execute("INSERT INTO device_keys(key, user_id, label, created_at) VALUES('nk_test_screen_key_1', ?, 'S', ?)",
                           (DAD, NOW))
appmod.store._conn.commit()
t4 = c.post(f"/api/people/{dad}/invites", json={}, headers=H(OWN)).json()["token"]
r = c.post("/api/invites/accept", json={"token": t4}, headers={"X-Device-Key": "nk_test_screen_key_1"})
check("*** a screen in a room cannot accept ***", r.status_code == 403 and r.json()["error"] == "screen", r.text)
check("...nor make a link", c.post(f"/api/people/{dad}/invites", json={}, headers={"X-Device-Key": "nk_test_screen_key_1"}).status_code == 403)

section("rate limits")
appmod._pair_misses.clear()
codes = [c.post("/api/invites/accept", json={"token": f"wrong{i}" * 8}, headers=H(STR)).status_code for i in range(appmod.PAIR_MAX_MISSES + 1)]
check(f"*** {appmod.PAIR_MAX_MISSES} wrong links, then refused for a while ***", codes[:-1] == [404] * appmod.PAIR_MAX_MISSES and codes[-1] == 429, str(codes))
check("...even with a right one", c.post("/api/invites/accept", json={"token": t4}, headers=H(STR)).status_code == 429)
appmod._pair_misses.clear()
appmod._invite_limit.reset()
codes = [c.post(f"/api/people/{robin}/invites", json={}, headers=H(OWN)).status_code for _ in range(appmod._invite_limit.limit + 1)]
check(f"*** {appmod._invite_limit.limit} links an hour, then 429 ***", codes[:-1] == [200] * appmod._invite_limit.limit and codes[-1] == 429, str(codes))
appmod._invite_limit.reset()

section("*** old links are tidied away; recent dead ones and used ones stay ***")
_db = sqlite3.connect(os.environ["NIMROD_DB"])
_old = (datetime.now(timezone.utc) - timedelta(days=claims.KEEP_DEAD_INVITE_DAYS + 2)).isoformat()
_recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
_cols = "id, token_hash, owner_id, person_id, created_at, expires_at, used_at, used_by, cancelled_at, see_people, messages"
for _id, _exp, _used, _canc in [("oldexp", _old, None, None), ("oldcanc", FUTURE, None, _old),
                                ("newexp", _recent, None, None), ("oldused", _old, _old, None)]:
    _db.execute(f"INSERT INTO claim_invites({_cols}) VALUES(?,?,?,?,?,?,?,?,?,1,1)",
                (_id, "h-" + _id, "someone-else", "p-" + _id, _old, _exp, _used, "x" if _used else None, _canc))
_db.commit()
appmod._invite_limit.reset()
_gran = c.post("/api/people", json={"name": "Gran"}, headers=H(OWN)).json()["id"]
_r = c.post(f"/api/people/{_gran}/invites", json={}, headers=H(OWN))
check("(a fresh person's link is made)", _r.status_code == 200, _r.text)
_left = {r[0] for r in _db.execute("SELECT id FROM claim_invites WHERE id IN ('oldexp','oldcanc','newexp','oldused')")}
_db.close()
check("*** making a link deletes unused links dead for over 30 days (anybody's), keeps a recent one and a used one ***",
      _left == {"newexp", "oldused"}, str(_left))
appmod._invite_limit.reset()

section("the privacy page")
d = c.get("/api/what-we-store").json()
check("*** both new tables are described (none undocumented) ***",
      not set(d["undocumented"]) & {"claim_invites", "person_claims"} and any(r["table"] == "claim_invites" for r in d["stores"]), str(d["undocumented"]))

try:
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)
except Exception:  # noqa: BLE001
    pass

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
