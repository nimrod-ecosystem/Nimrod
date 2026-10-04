"""People across accounts - a profile has a home, and appears on other accounts. The rules, and the routes.

    py -3.13 test_claims.py

Two halves, like test_notes.py. The rules are pure and live in claims.py. Then the HTTP routes, through
FastAPI's TestClient against a throwaway database, played as Mike's own trial (DECISIONS.md 2026-10-04 night):
  * CLAIM AS MERGE: Pat made "Mom"; Mom takes it over with her own login. Her copy becomes the main one, she can
    change everything, Pat keeps "Mom" as what he calls her and can no longer rename her or change her picture.
  * CONNECT LIKE FRIENDS: Pat and Oscar connect with nobody set up first; each gets a card for the other.
  * ONE PROFILE ON SEVERAL ACCOUNTS: the parents share one login with two people on it; both show on
    Christine's page and one on Oscar's, each called what that account calls them.
  * STOP SHARING from either side; a home deleting its person; the old claim rows carried over; the link
    machinery's old guarantees (hashed, single use, expiry, throttles, screens refused, no screen access).
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import claims
from claims import (
    DEFAULT_INVITE_DAYS, DEFAULT_MESSAGES, MAX_INVITE_DAYS, MAX_SHARES, MESSAGES_BACK, PROFILE_KEYS, REFUSAL_TEXT,
    accept_refusal, clamp_days, clean_shares, display_name, hash_token, invite_refusal, invite_state, new_token,
    reach_id, row_kind, state_target,
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
check("the defaults: messages yes on what you share, and back the other way", DEFAULT_MESSAGES is True and MESSAGES_BACK is True)

section("a link's state")
inv = {"owner_id": "own", "person_id": "p", "expires_at": FUTURE, "used_at": None, "cancelled_at": None, "kind": "claim"}
check("live", invite_state(inv, NOW) == "live")
check("*** expired ***", invite_state({**inv, "expires_at": PAST}, NOW) == "expired")
check("*** used beats expired (the more useful thing to say) ***", invite_state({**inv, "used_at": NOW, "expires_at": PAST}, NOW) == "used")
check("cancelled", invite_state({**inv, "cancelled_at": NOW}, NOW) == "cancelled")
check("no row: unknown; no expiry: expired (never live forever)", invite_state(None, NOW) == "unknown"
      and invite_state({**inv, "expires_at": None}, NOW) == "expired")

section("who may hand somebody over")
home = {"id": "p", "account_id": "own", "home_id": None}
check("the account that looks after them", invite_refusal(account="own", row=home, first_person_id="me") == "")
check("*** somebody else's person, or one that does not exist: not yours (the same answer) ***",
      invite_refusal(account="x", row=home, first_person_id="me") == "not-yours"
      and invite_refusal(account="own", row=None, first_person_id="me") == "not-yours")
check("*** already taken over: refused ***",
      invite_refusal(account="own", row={**home, "home_id": "h", "made_by": "claim"}, first_person_id="me") == "claimed")
check("*** a profile somebody shared with you is not yours to hand over ***",
      invite_refusal(account="own", row={**home, "home_id": "h", "made_by": "link"}, first_person_id="me") == "not-home")
check("*** your own first person (you) is not handed over ***", invite_refusal(account="own", row={**home, "id": "me"}, first_person_id="me") == "self")

section("who may accept")
acc = dict(account="mom", now_iso=NOW, target_ok=True, via_screen=False)
check("a signed-in login that is not the inviter's", accept_refusal(inv, **acc) == "")
check("*** the inviter's own login: refused ***", accept_refusal(inv, **{**acc, "account": "own"}) == "own")
check("*** a screen in a room: refused ***", accept_refusal(inv, **{**acc, "via_screen": True}) == "screen")
check("nobody signed in: refused", accept_refusal(inv, **{**acc, "account": ""}) == "signed-out")
check("*** used, expired, cancelled: refused, saying which ***",
      accept_refusal({**inv, "used_at": NOW}, **acc) == "used" and accept_refusal({**inv, "expires_at": PAST}, **acc) == "expired"
      and accept_refusal({**inv, "cancelled_at": NOW}, **acc) == "cancelled")
check("the person was deleted after the link was made: does not work", accept_refusal(inv, **{**acc, "target_ok": False}) == "unknown")

section("which people an invite shares")
own_rows = [{"id": "me", "home_id": None}, {"id": "r", "home_id": None}, {"id": "mom", "home_id": None},
            {"id": "lent", "home_id": "elsewhere"}]
check("*** by default: just you, with messages ***", clean_shares(None, own_rows=own_rows, first_person_id="me")
      == [{"person_id": "me", "messages": True}])
check("ids or {person_id, messages}, in order, once each, the handed-over person left out",
      clean_shares(["r", {"person_id": "me", "messages": False}, "r", "mom"], own_rows=own_rows, first_person_id="me", exclude="mom")
      == [{"person_id": "r", "messages": True}, {"person_id": "me", "messages": False}])
check("*** somebody else's person, or a profile you only hold, cannot be shared ***",
      raises(lambda: clean_shares(["x"], own_rows=own_rows, first_person_id="me"))
      and raises(lambda: clean_shares(["lent"], own_rows=own_rows, first_person_id="me")))
check("nothing is allowed (an invite that hands over one person and shares nobody)", clean_shares([], own_rows=own_rows, first_person_id="me") == [])
check(f"at most {MAX_SHARES} on one link; junk refused", raises(lambda: clean_shares(["me"] * (MAX_SHARES + 1), own_rows=own_rows, first_person_id="me"))
      and raises(lambda: clean_shares("me", own_rows=own_rows, first_person_id="me")) and raises(lambda: clean_shares([7], own_rows=own_rows, first_person_id="me")))

section("a row across accounts")
held = {"id": "row", "account_id": "pat", "name": "Mom", "home_id": "h", "call_name": "", "source_id": "h", "made_by": "claim"}
check("*** \"I call them\" first, else the home's name, else the row's own ***",
      display_name({**held, "call_name": "Mum"}, "Linda") == "Mum" and display_name(held, "Linda") == "Linda"
      and display_name(held, None) == "Mom")
check("kinds: you, mine, joined, connected, shared",
      row_kind({"id": "me"}, first_person_id="me") == "you" and row_kind({"id": "r"}, first_person_id="me") == "mine"
      and row_kind(held, first_person_id="me") == "joined"
      and row_kind({**held, "made_by": "link"}, first_person_id="me", source_is_their_first=True) == "connected"
      and row_kind({**held, "made_by": "link"}, first_person_id="me") == "shared")
check("*** reach: your own screen for them wins; else the row it came through; your own people: themselves ***",
      reach_id(held, own_screens=1) == "row" and reach_id(held, own_screens=0) == "h" and reach_id({"id": "r"}, own_screens=0) == "r")
hm = {"id": "h", "account_id": "mom"}
check("*** the profile is read from the home: picture through any row, the page through a claimed one ***",
      state_target("avatar", actor="pat", row=held, home=hm, write=False) == ("mom", "h")
      and state_target("page", actor="pat", row=held, home=hm, write=False) == ("mom", "h")
      and state_target("avatar", actor="pat", row={**held, "made_by": "link"}, home=hm, write=False) == ("mom", "h")
      and state_target("page", actor="pat", row={**held, "made_by": "link"}, home=hm, write=False) == "missing")
check("*** a profile key is written by the home's account only ***",
      state_target("avatar", actor="pat", row=held, home=hm, write=True) == "profile"
      and state_target("page", actor="mom", row={"id": "h", "account_id": "mom", "home_id": None}, home=None, write=True) == ("mom", "h"))
check("everything else stays the holding account's own row", state_target("input-bindings", actor="pat", row=held, home=hm, write=True) == ("pat", "row"))
check("*** nobody reaches another account's row at all ***", state_target("avatar", actor="mom", row=held, home=hm, write=False) == "missing"
      and state_target("avatar", actor="x", row=None, home=None, write=False) == "missing")
check("the profile is the picture and the page", PROFILE_KEYS == frozenset({"avatar", "page"}))
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
store = appmod.store


def H(u):
    return {"X-Dev-User": u}


def people(u):
    return {p["id"]: p for p in c.get("/api/people", headers=H(u)).json()["people"]}


def by_name(u):
    return {p["name"]: p for p in c.get("/api/people", headers=H(u)).json()["people"]}


def put_state(u, pid, key, data):
    v = c.get(f"/api/people/{pid}/state/{key}", headers=H(u)).json().get("version", 0)
    return c.put(f"/api/people/{pid}/state/{key}", json={"data": data, "base_version": v}, headers=H(u))


def face(u, pid):
    r = c.get(f"/api/people/{pid}/state/avatar", headers=H(u))
    return r.json()["data"].get("face") if r.status_code == 200 else r.status_code


OWN, MOM, OSC, CHR, PAR, STR = "own-mike", "acct-mom", "acct-oscar", "acct-chris", "acct-parents", "str-x"
me = c.get("/api/people", headers=H(OWN)).json()["people"][0]["id"]
c.patch(f"/api/people/{me}", json={"name": "Pat"}, headers=H(OWN))
robin = c.post("/api/people", json={"name": "Robin"}, headers=H(OWN)).json()["id"]
mom = c.post("/api/people", json={"name": "Mom"}, headers=H(OWN)).json()["id"]
dad = c.post("/api/people", json={"name": "Dad"}, headers=H(OWN)).json()["id"]
bed = c.post("/api/profiles", json={"name": "Bedside", "person_id": robin}, headers=H(OWN)).json()["id"]
c.post(f"/api/profiles/{bed}/modules", json={"type": "note"}, headers=H(OWN))
put_state(OWN, robin, "input-bindings", {"secret": "owner's"})
put_state(OWN, robin, "avatar", {"face": "robin"})
put_state(OWN, mom, "avatar", {"face": "drawn by Pat"})
put_state(OWN, mom, "page", {"sections": [{"id": "about-1", "kind": "about", "options": {"text": "Pat wrote this"}}]})
mom_me = c.get("/api/people", headers=H(MOM)).json()["people"][0]["id"]     # Mom's own login has its own "Me"

section("making a link to hand Mom over")
r = c.post(f"/api/people/{mom}/invites", json={}, headers=H(OWN))
j = r.json()
check("*** the default link: long, a path to join.html, 14 days, and it shares just you ***",
      r.status_code == 200 and len(j.get("token", "")) >= 43 and j["path"] == f"/join.html?invite={j['token']}"
      and j["invite"]["state"] == "live" and j["invite"]["kind"] == "claim"
      and [(s["person_id"], s["messages"], s["name"]) for s in j["invite"]["shares"]] == [(me, True, "Pat")], r.text)
exp = datetime.fromisoformat(j["invite"]["expires_at"])
check("...that runs out in about 14 days", timedelta(days=13, hours=23) < exp - datetime.now(timezone.utc) <= timedelta(days=14))
r = c.post(f"/api/people/{mom}/invites", json={"shares": [{"person_id": me, "messages": True}, {"person_id": robin, "messages": True}]},
           headers=H(OWN))
tok = r.json()["token"]
check("a new link for Mom, sharing Pat and Robin", r.status_code == 200 and [s["name"] for s in r.json()["invite"]["shares"]] == ["Pat", "Robin"], r.text)
check("*** the older link for the same person is cancelled ***",
      c.post("/api/invites/peek", json={"token": j["token"]}).json()["state"] == "cancelled")
row = store.invite_by_hash(hash_token(tok))
check("*** stored as a hash: the token itself is nowhere in the database ***", row and row["token_hash"] == hash_token(tok))
dump = "\n".join(sqlite3.connect(os.environ["NIMROD_DB"]).iterdump())
check("*** ...not in any table (a full dump does not contain it) ***", tok not in dump)
lst = c.get(f"/api/people/{mom}/invites", headers=H(OWN)).json()
check("the owner sees one waiting, without the link", len(lst["invites"]) == 1 and tok not in repr(lst) and lst["claimed"] is False, str(lst))
check("*** somebody else cannot make a link for your person (and cannot tell it exists) ***",
      c.post(f"/api/people/{mom}/invites", json={}, headers=H(STR)).status_code == 404
      and c.post("/api/people/doesnotexist1/invites", json={}, headers=H(STR)).status_code == 404)
r = c.post(f"/api/people/{me}/invites", json={}, headers=H(OWN))
check("*** your own first person (you) cannot be handed over ***", r.status_code == 409 and r.json()["error"] == "self", r.text)
check("days outside 1..30 are refused", c.post(f"/api/people/{dad}/invites", json={"days": 31}, headers=H(OWN)).status_code == 400)
check("*** sharing somebody who is not yours is refused ***",
      c.post(f"/api/people/{dad}/invites", json={"shares": [mom_me]}, headers=H(OWN)).status_code == 400)

section("the join page's first look (before signing in)")
p = c.post("/api/invites/peek", json={"token": tok}).json()
check("*** who sent it, which person, and who comes with it - in names ***",
      p["state"] == "live" and p["kind"] == "claim" and p["name"] == "Mom" and p["from"] == "Pat"
      and [(s["name"], s["sender"]) for s in p["shares"]] == [("Pat", True), ("Robin", False)], str(p))
check("*** no account ids in it ***", OWN not in repr(p) and "owner" not in p, str(p))
check("a wrong link: does not work, in words", c.post("/api/invites/peek", json={"token": "nope" * 12}).status_code == 404)
check("the inviter looking at their own link is told so", c.post("/api/invites/peek", json={"token": tok}, headers=H(OWN)).json()["is_inviter"] is True)

section("*** CLAIM AS MERGE: Mom makes it hers ***")
r = c.post("/api/invites/accept", json={"token": tok}, headers=H(OWN))
check("*** the inviter's own login cannot accept ***", r.status_code == 403 and r.json()["error"] == "own", r.text)
r = c.post("/api/invites/accept", json={"token": tok}, headers=H(MOM))
check("*** Mom accepts ***", r.status_code == 200 and r.json()["kind"] == "claim" and r.json()["name"] == "Mom" and r.json()["from"] == "Pat", r.text)
check("*** single use: the same link again is refused ***",
      c.post("/api/invites/accept", json={"token": tok}, headers=H(OSC)).json().get("error") == "used")
check("...and the first look says so", c.post("/api/invites/peek", json={"token": tok}).json()["state"] == "used")
pm = people(MOM)
check("*** her own profile (it was 'Me') takes the name she was invited as; she signs notes 'Mom' ***",
      pm[mom_me]["name"] == "Mom" and pm[mom_me]["kind"] == "you" and pm[mom_me]["home"] is True
      and c.get("/api/me", headers=H(MOM)).json()["display_name"] == "Mom", str(pm[mom_me]))
check("*** most of the work done: the picture and page Pat made are on HER profile now ***",
      face(MOM, mom_me) == "drawn by Pat"
      and c.get(f"/api/people/{mom_me}/state/page", headers=H(MOM)).json()["data"]["sections"][0]["options"]["text"] == "Pat wrote this")
bn = by_name(MOM)
check("*** Pat and Robin are on her page: Pat connected, Robin shared from Pat's people ***",
      set(bn) == {"Mom", "Pat", "Robin"} and bn["Pat"]["kind"] == "connected" and bn["Robin"]["kind"] == "shared"
      and bn["Robin"]["from"] == "Pat" and not bn["Robin"]["home"], str(bn))
r_mom, p_mom = bn["Robin"]["id"], bn["Pat"]["id"]
check("...rows on HER account (her own ids), reaching Pat's people through the connection",
      r_mom not in (robin, me) and bn["Robin"]["reach"] == robin and bn["Pat"]["reach"] == me)
pp = people(OWN)
check("*** Pat sees nothing change: still 'Mom', now 'joined', and no longer the one who looks after it ***",
      pp[mom]["name"] == "Mom" and pp[mom]["kind"] == "joined" and pp[mom]["home"] is False and pp[mom]["call_name"] == "Mom"
      and pp[mom]["from"] == "Mom" and pp[mom]["messages_from_them"] is True, str(pp[mom]))
check("no account ids on either side", OWN not in repr(people(MOM)) and MOM not in repr(people(OWN)))
check("the two logins are connected", links.link_is_active(store.get_link(OWN, MOM)))
r = c.post(f"/api/people/{mom}/invites", json={}, headers=H(OWN))
check("*** a person already taken over cannot be invited again ***", r.status_code == 409 and r.json()["error"] == "claimed", r.text)
check("*** ...nor claimed twice (the row joins only while it is its own home) ***",
      store.accept_invite(store.create_invite(OWN, mom, hash_token("x" * 40), "2099-01-01T00:00:00+00:00")["id"], OSC)[0] == "claimed")
check("*** a profile shared with Mom is not hers to hand over ***",
      c.post(f"/api/people/{r_mom}/invites", json={}, headers=H(MOM)).json().get("error") == "not-home")

section("*** she may change everything on her own profile; Pat may not ***")
check("*** Mom changes her picture ***", put_state(MOM, mom_me, "avatar", {"face": "mine now"}).status_code == 200)
check("*** ...and Pat's card for her shows it (read from her home) ***", face(OWN, mom) == "mine now")
r = put_state(OWN, mom, "avatar", {"face": "Pat again"})
check("*** Pat can no longer change her picture - 403, in words ***", r.status_code == 403 and "their own login" in r.text, r.text)
check("*** ...nor her page ***", put_state(OWN, mom, "page", {"sections": []}).status_code == 403)
# Pat's screen in her room: a device key on Pat's login (page_visits.py: a screen through a claimed card gets the
# whole page; Pat's own phone gets what a visitor gets).
store._conn.execute("INSERT INTO device_keys(key, user_id, label, created_at) VALUES('nk_test_pat_screen', ?, 'Mom room', ?)", (OWN, NOW))
store._conn.commit()
PAT_SCREEN = {"X-Device-Key": "nk_test_pat_screen"}
check("Pat's screen for her shows HER page (a claimed row reads the page from the home)",
      c.get(f"/api/people/{mom}/state/page", headers=PAT_SCREEN).json()["data"]["sections"][0]["options"]["text"] == "Pat wrote this")
check("*** ...but Pat's own phone reading it is a visit: her card only, About me not opened to visitors ***",
      [s["kind"] for s in c.get(f"/api/people/{mom}/state/page", headers=H(OWN)).json()["data"]["sections"]] == ["self"])
check("Mom changes her page too", put_state(MOM, mom_me, "page", {"sections": [{"id": "about-1", "kind": "about", "options": {"text": "Linda here"}}]}).status_code == 200
      and c.get(f"/api/people/{mom}/state/page", headers=PAT_SCREEN).json()["data"]["sections"][0]["options"]["text"] == "Linda here")
check("Pat still changes everything else on his own row for her (his screens' settings)",
      put_state(OWN, mom, "home", {"x": 1}).status_code == 200 and c.get(f"/api/people/{mom_me}/state/home", headers=H(MOM)).json()["data"] == {})
r = c.patch(f"/api/people/{mom}", json={"name": "Mother"}, headers=H(OWN))
check("*** Pat cannot rename her profile ***", r.status_code == 403 and "what you call them" in r.text, r.text)
check("*** Mom renames herself ***", c.patch(f"/api/people/{mom_me}", json={"name": "Linda"}, headers=H(MOM)).status_code == 200
      and people(MOM)[mom_me]["name"] == "Linda")
check("*** ...and Pat still sees 'Mom' (his 'I call them'), with her own name beside it ***",
      people(OWN)[mom]["name"] == "Mom" and people(OWN)[mom]["profile_name"] == "Linda")

section("*** I CALL THEM ***")
r = c.put(f"/api/people/{mom}/call-name", json={"name": "Mum"}, headers=H(OWN))
check("*** Pat calls her 'Mum' - only on his page ***", r.status_code == 200 and people(OWN)[mom]["name"] == "Mum"
      and people(MOM)[mom_me]["name"] == "Linda", r.text)
check("*** cleared: her own name shows ***", c.put(f"/api/people/{mom}/call-name", json={"name": ""}, headers=H(OWN)).status_code == 200
      and people(OWN)[mom]["name"] == "Linda")
c.put(f"/api/people/{mom}/call-name", json={"name": "Mom"}, headers=H(OWN))
check("*** Mom calls Robin 'Bobby' on hers; Pat's Robin is still Robin ***",
      c.put(f"/api/people/{r_mom}/call-name", json={"name": "Bobby"}, headers=H(MOM)).status_code == 200
      and people(MOM)[r_mom]["name"] == "Bobby" and people(OWN)[robin]["name"] == "Robin")
check("*** nobody else sets it; a profile you look after has a name, not an 'I call them' ***",
      c.put(f"/api/people/{r_mom}/call-name", json={"name": "x"}, headers=H(OWN)).status_code == 404
      and c.put(f"/api/people/{robin}/call-name", json={"name": "x"}, headers=H(OWN)).status_code == 409)
check("a name is a name (the usual characters)", c.put(f"/api/people/{r_mom}/call-name", json={"name": "<b>"}, headers=H(MOM)).status_code == 400)

section("*** what Mom reaches through her cards ***")
check("Robin's face, through her own row", face(MOM, r_mom) == "robin")
check("*** ...but not Robin's page (a shared card is the card), nor anything of Pat's rows directly ***",
      c.get(f"/api/people/{r_mom}/state/page", headers=H(MOM)).status_code == 404 and face(MOM, robin) == 404
      and c.get(f"/api/people/{robin}/state/input-bindings", headers=H(MOM)).status_code == 404)
check("*** she cannot write Robin's picture ***", put_state(MOM, r_mom, "avatar", {"face": "x"}).status_code == 403)
url = f"/api/people/{robin}/notes/{bed}/note"
r = c.post(url, json={"kind": "note", "data": {"text": "Love you, Robin", "author": "Pat"}}, headers=H(MOM))
check("*** Mom leaves Robin a message through Robin's reach (the invite allowed it), signed with her own name ***",
      r.status_code == 200 and r.json()["data"]["author"] == "Mom", r.text)
check("the owner's log knows it was Mom's login",
      c.get(f"/api/profiles/{bed}/events/note", headers=H(OWN)).json()["events"][-1]["principal_id"] == MOM)
check("*** Pat's card for Mom reaches HER (he has no screen for her): allowed, she said yes on the join page ***",
      pp[mom]["reach"] == mom_me and c.get(f"/api/people/{mom_me}/notes/screens", headers=H(OWN)).status_code == 200)

section("*** nothing reaches anybody's screens beyond that ***")
check("*** Mom cannot call or drive Robin's screen (no grant: calls only where already allowed) ***",
      c.post(f"/api/drive/ticket/{robin}", headers=H(MOM)).status_code == 403)
check("*** Pat's screens are not hers to open or list ***", c.get(f"/api/profiles/{bed}", headers=H(MOM)).status_code == 404
      and bed not in c.get("/api/profiles", headers=H(MOM)).text)
check("...nor the screen's own events, nor the person's", c.get(f"/api/profiles/{bed}/events/note", headers=H(MOM)).status_code == 404
      and c.get(f"/api/people/{robin}/events/remote", headers=H(MOM)).status_code == 404)
check("*** Pat cannot reach Mom's own settings ***", c.get(f"/api/people/{mom_me}/state/input-bindings", headers=H(OWN)).status_code == 404)
check("no drive grants were made", store.grants_for_subject("account", MOM) == [] and store.grants_for_subject("account", OWN) == [])
check("*** a stranger gets nothing ***", c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(STR)).status_code == 403
      and face(STR, mom) == 404)

section("messages: each side's switch")
check("Pat turns messages from Mom off (on his card for her)", c.put(f"/api/people/{mom}/messages", json={"on": False}, headers=H(OWN)).json()["messages"] is False)
check("*** Mom can no longer leave Robin a message ***", c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(MOM)).status_code == 403)
check("*** Mom cannot turn it back on: it is not her card ***", c.put(f"/api/people/{mom}/messages", json={"on": True}, headers=H(MOM)).status_code == 404)
c.put(f"/api/people/{mom}/messages", json={"on": True}, headers=H(OWN))
check("on again: allowed", c.post(url, json={"kind": "note", "data": {"text": "back"}}, headers=H(MOM)).status_code == 200)
check("*** Mom's own switch, on her card for Pat: Pat may not reach her ***",
      c.put(f"/api/people/{p_mom}/messages", json={"on": False}, headers=H(MOM)).status_code == 200
      and c.get(f"/api/people/{mom_me}/notes/screens", headers=H(OWN)).status_code == 403)
c.put(f"/api/people/{p_mom}/messages", json={"on": True}, headers=H(MOM))
newp = c.post("/api/people", json={"name": "Sis"}, headers=H(OWN)).json()["id"]
check("*** a person Pat adds later is NOT on Mom's page (an invite picks who) ***",
      newp not in [p["reach"] for p in people(MOM).values()] and not store.may_capability("messages", actor=MOM, person_id=newp))

section("*** CONNECT LIKE FRIENDS: Pat and Oscar, nobody set up first ***")
osc_me = c.get("/api/people", headers=H(OSC)).json()["people"][0]["id"]
c.patch(f"/api/people/{osc_me}", json={"name": "Oscar"}, headers=H(OSC))
r = c.post("/api/connect/invites", json={}, headers=H(OWN))
ctok = r.json()["token"]
check("*** a connect link: just you, with messages ***", r.status_code == 200 and r.json()["invite"]["kind"] == "connect"
      and [s["name"] for s in r.json()["invite"]["shares"]] == ["Pat"], r.text)
ctok2 = c.post("/api/connect/invites", json={}, headers=H(OWN)).json()["token"]
check("*** a second connect link does not cancel the first (one each for three friends) ***",
      c.post("/api/invites/peek", json={"token": ctok}).json()["state"] == "live"
      and len(c.get("/api/connect/invites", headers=H(OWN)).json()["invites"]) == 2)
p = c.post("/api/invites/peek", json={"token": ctok}, headers=H(OSC)).json()
check("the first look: Pat wants to connect", p["kind"] == "connect" and p["name"] == "Pat" and p["from"] == "Pat" and p["signed_in"] is True, str(p))
r = c.post("/api/invites/accept", json={"token": ctok, "messages_back": False}, headers=H(OSC))
check("*** Oscar connects (and does not let Pat leave him messages) ***", r.status_code == 200 and r.json()["kind"] == "connect", r.text)
bo = by_name(OSC)
check("*** Oscar's page: Pat, connected ***", set(bo) == {"Oscar", "Pat"} and bo["Pat"]["kind"] == "connected" and bo["Pat"]["reach"] == me, str(bo))
bp = by_name(OWN)
check("*** Pat's page: Oscar, connected, by his own name ***", "Oscar" in bp and bp["Oscar"]["kind"] == "connected"
      and bp["Oscar"]["reach"] == osc_me and bp["Oscar"]["messages_from_them"] is True, str(bp.get("Oscar")))
check("*** messages: Oscar may reach Pat; Pat may not reach Oscar (he unticked it) ***",
      store.may_capability("messages", actor=OSC, person_id=me) and not store.may_capability("messages", actor=OWN, person_id=osc_me))
check("Oscar's own name is still his", people(OSC)[osc_me]["name"] == "Oscar")
c.delete(f"/api/connect/invites/{c.get('/api/connect/invites', headers=H(OWN)).json()['invites'][0]['id']}", headers=H(OWN))
check("the other connect link taken back", c.post("/api/invites/peek", json={"token": ctok2}).json()["state"] == "cancelled")

section("*** ONE PROFILE ON SEVERAL ACCOUNTS: the parents' one login, on Christine's page and Oscar's ***")
par_me = c.get("/api/people", headers=H(PAR)).json()["people"][0]["id"]
c.patch(f"/api/people/{par_me}", json={"name": "Linda"}, headers=H(PAR))
gary = c.post("/api/people", json={"name": "Gary"}, headers=H(PAR)).json()["id"]
put_state(PAR, gary, "avatar", {"face": "gary"})
chr_me = c.get("/api/people", headers=H(CHR)).json()["people"][0]["id"]
c.patch(f"/api/people/{chr_me}", json={"name": "Christine"}, headers=H(CHR))
t = c.post("/api/connect/invites", json={"shares": [par_me, {"person_id": gary, "messages": False}]}, headers=H(PAR)).json()["token"]
check("Christine connects with both of them", c.post("/api/invites/accept", json={"token": t}, headers=H(CHR)).status_code == 200)
t = c.post("/api/connect/invites", json={"shares": [gary]}, headers=H(PAR)).json()["token"]
check("Oscar connects with Gary only", c.post("/api/invites/accept", json={"token": t}, headers=H(OSC)).status_code == 200)
bc, bo = by_name(CHR), by_name(OSC)
check("*** Christine has Linda and Gary; Oscar has Gary ***", {"Linda", "Gary"} <= set(bc) and "Gary" in bo and "Linda" not in bo, f"{list(bc)} {list(bo)}")
g_chr, g_osc = bc["Gary"]["id"], bo["Gary"]["id"]
check("*** each a row on its own account, both the same profile ***", len({gary, g_chr, g_osc}) == 3
      and face(CHR, g_chr) == "gary" and face(OSC, g_osc) == "gary")
c.put(f"/api/people/{g_chr}/call-name", json={"name": "Dad"}, headers=H(CHR))
c.put(f"/api/people/{g_osc}/call-name", json={"name": "Grandpa"}, headers=H(OSC))
check("*** 'Dad' on Christine's, 'Grandpa' on Oscar's, Gary on his own ***",
      people(CHR)[g_chr]["name"] == "Dad" and people(OSC)[g_osc]["name"] == "Grandpa" and people(PAR)[gary]["name"] == "Gary")
put_state(PAR, gary, "avatar", {"face": "gary, new"})
check("*** Gary changes his picture once: both pages show it ***", face(CHR, g_chr) == "gary, new" and face(OSC, g_osc) == "gary, new")
check("neither can change it", put_state(CHR, g_chr, "avatar", {"face": "x"}).status_code == 403
      and put_state(OSC, g_osc, "avatar", {"face": "x"}).status_code == 403)
check("*** per-person permissions held: messages for Linda, none for Gary ***",
      store.may_capability("messages", actor=CHR, person_id=par_me) and not store.may_capability("messages", actor=CHR, person_id=gary))

section("*** STOP SHARING ***")
check("a stranger cannot; nor on a person no connection made", c.delete(f"/api/people/{g_chr}/link", headers=H(STR)).status_code == 404
      and c.delete(f"/api/people/{robin}/link", headers=H(OWN)).status_code == 404)
check("*** Christine stops sharing (on Gary's card) ***", c.delete(f"/api/people/{g_chr}/link", headers=H(CHR)).status_code == 200)
check("*** Linda and Gary are gone from her page, and she from theirs; the connection and its switches with it ***",
      {"Linda", "Gary", "Dad"}.isdisjoint(by_name(CHR)) and "Christine" not in by_name(PAR)
      and not links.link_is_active(store.get_link(CHR, PAR)) and not store.may_capability("messages", actor=CHR, person_id=par_me))
check("*** the profiles themselves are untouched, and still on Oscar's page ***",
      people(PAR)[gary]["name"] == "Gary" and face(PAR, gary) == "gary, new" and people(OSC)[g_osc]["name"] == "Grandpa")
# A row the holder gave a screen of its own is kept, as theirs.
osc_pat = by_name(OSC)["Pat"]["id"]
c.post("/api/profiles", json={"name": "Pat's frame", "person_id": osc_pat}, headers=H(OSC))
check("*** Pat stops sharing with Oscar: Oscar's card for Pat had a screen, so it stays - as Oscar's own ***",
      c.delete(f"/api/people/{by_name(OWN)['Oscar']['id']}/link", headers=H(OWN)).status_code == 200
      and people(OSC)[osc_pat]["home"] is True and people(OSC)[osc_pat]["name"] == "Pat" and "Oscar" not in by_name(OWN))

section("*** stop sharing a person somebody took over ***")
check("*** Mom stops sharing (on her card for Pat) ***", c.delete(f"/api/people/{p_mom}/link", headers=H(MOM)).status_code == 200)
pp = people(OWN)
check("*** Pat's row is his own again: called what he called her, his picture from before ***",
      pp[mom]["home"] is True and pp[mom]["kind"] == "mine" and pp[mom]["name"] == "Mom" and face(OWN, mom) == "drawn by Pat", str(pp[mom]))
check("*** Mom keeps her own profile, picture and all; Pat's people are gone from her page ***",
      set(by_name(MOM)) == {"Linda"} and face(MOM, mom_me) == "mine now")
check("*** her login reaches nothing of Pat's any more ***", c.post(url, json={"kind": "note", "data": {"text": "x"}}, headers=H(MOM)).status_code == 403
      and not links.link_is_active(store.get_link(OWN, MOM)))
check("Pat can change the picture and rename the person again", put_state(OWN, mom, "avatar", {"face": "again"}).status_code == 200
      and c.patch(f"/api/people/{mom}", json={"name": "Mom"}, headers=H(OWN)).status_code == 200)
check("*** and invite somebody to it again ***", c.post(f"/api/people/{mom}/invites", json={}, headers=H(OWN)).status_code == 200)

section("*** a profile somebody looks after is deleted ***")
check("the parents delete Gary", c.delete(f"/api/people/{gary}", headers=H(PAR)).status_code == 200)
check("*** Oscar's card stays, his own now, called what he called him ***",
      people(OSC)[g_osc]["home"] is True and people(OSC)[g_osc]["name"] == "Grandpa" and people(OSC)[g_osc]["kind"] == "mine")
check("...and he may rename it now", c.patch(f"/api/people/{g_osc}", json={"name": "Grandad"}, headers=H(OSC)).status_code == 200)

section("a link from before shares existed (8908b2c) still works")
otok = new_token()
oid = "legacyinvite1"
_db = sqlite3.connect(os.environ["NIMROD_DB"])
_db.execute("INSERT INTO claim_invites(id, token_hash, owner_id, person_id, created_at, expires_at, see_people, messages, kind, shares) "
            "VALUES(?,?,?,?,?,?,1,0,'claim',NULL)", (oid, hash_token(otok), OWN, dad, NOW, "2099-01-01T00:00:00+00:00"))
_db.commit()
_db.close()
DAD = "acct-dad"
r = c.post("/api/invites/accept", json={"token": otok}, headers=H(DAD))
check("*** accepted: 'see your other people' meant everybody Pat looks after; messages no ***",
      r.status_code == 200 and {"Pat", "Robin", "Mom", "Sis"} <= set(by_name(DAD))
      and not store.may_capability("messages", actor=DAD, person_id=robin), f"{r.text} {list(by_name(DAD))}")
check("the person is his now", people(OWN)[dad]["kind"] == "joined")

section("cancel and expire")
t3 = c.post(f"/api/people/{robin}/invites", json={}, headers=H(OWN)).json()
check("*** the inviter cancels a waiting link ***",
      c.delete(f"/api/people/{robin}/invites/{t3['invite']['id']}", headers=H(OWN)).status_code == 200
      and c.post("/api/invites/accept", json={"token": t3["token"]}, headers=H(OSC)).json()["error"] == "cancelled")
check("nobody else can cancel it", c.delete(f"/api/people/{robin}/invites/{t3['invite']['id']}", headers=H(STR)).status_code == 404)
check("cancelling twice is a 404, not a pretend yes", c.delete(f"/api/people/{robin}/invites/{t3['invite']['id']}", headers=H(OWN)).status_code == 404)
etok = new_token()
store.create_invite(OWN, robin, hash_token(etok), PAST)
check("*** an expired link is refused, saying so ***",
      c.post("/api/invites/accept", json={"token": etok}, headers=H(OSC)).json()["error"] == "expired"
      and c.post("/api/invites/peek", json={"token": etok}).json()["state"] == "expired")
check("...and it made nothing", people(OWN)[robin]["home"] is True)

section("screens may not")
store._conn.execute("INSERT INTO device_keys(key, user_id, label, created_at) VALUES('nk_test_screen_key_1', ?, 'S', ?)", (OSC, NOW))
store._conn.commit()
t4 = c.post(f"/api/people/{robin}/invites", json={}, headers=H(OWN)).json()["token"]
r = c.post("/api/invites/accept", json={"token": t4}, headers={"X-Device-Key": "nk_test_screen_key_1"})
check("*** a screen in a room cannot accept ***", r.status_code == 403 and r.json()["error"] == "screen", r.text)
check("...nor make a link of either kind", c.post(f"/api/people/{osc_me}/invites", json={}, headers={"X-Device-Key": "nk_test_screen_key_1"}).status_code == 403
      and c.post("/api/connect/invites", json={}, headers={"X-Device-Key": "nk_test_screen_key_1"}).status_code == 403)

section("rate limits")
appmod._pair_misses.clear()
codes = [c.post("/api/invites/accept", json={"token": f"wrong{i}" * 8}, headers=H(STR)).status_code for i in range(appmod.PAIR_MAX_MISSES + 1)]
check(f"*** {appmod.PAIR_MAX_MISSES} wrong links, then refused for a while ***", codes[:-1] == [404] * appmod.PAIR_MAX_MISSES and codes[-1] == 429, str(codes))
check("...even with a right one", c.post("/api/invites/accept", json={"token": t4}, headers=H(STR)).status_code == 429)
appmod._pair_misses.clear()
appmod._invite_limit.reset()
codes = [c.post("/api/connect/invites", json={}, headers=H(OWN)).status_code for _ in range(appmod._invite_limit.limit + 1)]
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
_r = c.post("/api/connect/invites", json={}, headers=H(OWN))
check("(a fresh link is made)", _r.status_code == 200, _r.text)
_left = {r[0] for r in _db.execute("SELECT id FROM claim_invites WHERE id IN ('oldexp','oldcanc','newexp','oldused')")}
_db.close()
check("*** making a link deletes unused links dead for over 30 days (anybody's), keeps a recent one and a used one ***",
      _left == {"newexp", "oldused"}, str(_left))
appmod._invite_limit.reset()

section("the privacy page")
d = c.get("/api/what-we-store").json()
desc = {r["table"]: r["what"] for r in d["stores"]}
check("*** nothing undocumented; the old claims table is gone from the real list ***",
      d["undocumented"] == [] and "person_claims" not in desc and "claim_invites" in desc, str(d["undocumented"]))
check("*** the new columns are described: what you call them, which profile, which connection; what a link shares ***",
      "what you call them" in desc["people"] and "connection" in desc["people"] and "shares" in desc["claim_invites"], desc.get("people"))

section("*** the old claim rows (8908b2c) are carried over once, then the table goes ***")
import db as dbmod  # noqa: E402
mpath = os.path.join(tmp, "migrate.db")
s1 = dbmod.SQLiteStore(mpath)
o_me = s1.ensure_default_person("old-own")
s1.rename_person("old-own", o_me, "Pat2")
nana = s1.create_person("old-own", "Nana")["id"]
kid = s1.create_person("old-own", "Kid")["id"]
s1.put_state("old-own", dbmod.person_scope(nana), "avatar", {"face": "nana chose this"}, 0)
lk = s1.create_link("old-own", "old-acc", created_by="old-acc")
s1.add_link_permission(lk["id"], kid, "messages", "old-acc")
s1._conn.executescript(
    "CREATE TABLE person_claims (person_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, account_id TEXT NOT NULL, "
    "invite_id TEXT NOT NULL, see_people INTEGER NOT NULL DEFAULT 1, messages INTEGER NOT NULL DEFAULT 1, claimed_at TEXT NOT NULL);")
s1._conn.execute("INSERT INTO person_claims VALUES(?,?,?,?,1,1,?)", (nana, "old-own", "old-acc", "inv", NOW))
s1._conn.commit()
s1._conn.close()
s2 = dbmod.SQLiteStore(mpath)            # boot: the migration runs
acc_first = s2.first_person_id("old-acc")
nrow = s2.person_row(nana)
check("*** the table is gone ***", "person_claims" not in s2._table_names())
check("*** Nana's row joined the claimer's own profile; Pat2 keeps 'Nana' as what he calls her ***",
      nrow["home_id"] == acc_first and nrow["made_by"] == "claim" and nrow["call_name"] == "Nana" and nrow["link_id"] == lk["id"], str(nrow))
check("*** the picture the claimer chose came with her ***",
      s2.get_state("old-acc", dbmod.person_scope(acc_first), "avatar")["data"].get("face") == "nana chose this")
acc_rows = {r["home_id"]: r for r in s2.people_rows("old-acc") if r["home_id"]}
check("*** the people she could see are rows on her account now (Pat2 and Kid), and the old switches still work ***",
      set(acc_rows) == {o_me, kid} and s2.may_capability("messages", actor="old-acc", person_id=kid), str(list(acc_rows)))
s2._conn.close()
s3 = dbmod.SQLiteStore(mpath)
check("*** booting again changes nothing ***", len(s3.people_rows("old-acc")) == 3 and s3.person_row(nana)["home_id"] == acc_first)
s3._conn.close()

section("Postgres-safe SQL (a review, kept honest by a check)")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "db.py"), encoding="utf-8").read()
check("*** no SQLite-only syntax crept in (INSERT OR, IFNULL, GROUP_CONCAT, datetime('now')) ***",
      not any(w in src for w in ("INSERT OR ", "IFNULL(", "GROUP_CONCAT", "datetime('now')")))
check("both schema blocks carry every new column", src.count("ADD COLUMN IF NOT EXISTS home_id") == 1
      and all(f'"{col}"' in src for col in ("home_id", "call_name", "source_id", "link_id", "made_by"))
      and "ADD COLUMN IF NOT EXISTS shares" in src)

try:
    shutil.rmtree(tmp, ignore_errors=True)
except Exception:  # noqa: BLE001
    pass

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
