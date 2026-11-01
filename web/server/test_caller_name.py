"""Who is calling, as the screen shows it (row 2.167, 2026-10-31).

    py -3.13 test_caller_name.py

Mike called a screen from his phone and the ring showed a word that was not his name. The ring carried only what the
caller's page said about itself; the screen never looked the caller up among its own people. Now the SERVER, which
knows the caller's login for certain (`by`), stamps a call's offer with the caller's card on the owning login's people
list (`byPerson`, for the picture) and that card's name as the screen's own person knows them (`byName`). Neither is
ever taken from the page. The rule is claims.caller_card (pure); the stamp is app.py `_caller_on_screen`.
"""
import json
import os
import sys
import tempfile

from claims import caller_card

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


# ---------------------------------------------------------------- pure
section("the rule: which card on the owner's list is the caller")
rows = [
    {"id": "you", "home_id": None},                 # the owner's own first person
    {"id": "kid", "home_id": None},                 # somebody the owner looks after
    {"id": "friend-mom", "home_id": "h-mom"},       # a card the friend shares (their parent), not the friend
    {"id": "friend", "home_id": "h-friend"},        # the friend's own card
]
check("*** the owner calling their own screens: their own first person ***",
      caller_card(rows, owner="o", caller="o", caller_home=None)["id"] == "you")
check("*** somebody else: the card whose profile is their own ***",
      caller_card(rows, owner="o", caller="f", caller_home="h-friend")["id"] == "friend")
check("*** never another card they share with the owner ***",
      caller_card(rows, owner="o", caller="f", caller_home="h-friend")["id"] != "friend-mom")
check("no card for them: None (the screen falls back to the list's name, then their display name)",
      caller_card(rows, owner="o", caller="s", caller_home="h-stranger") is None)
check("...and nothing known about them at all: None",
      caller_card(rows, owner="o", caller="s", caller_home=None) is None)
check("a card the owner looks after is never matched by a missing home",
      caller_card([{"id": "kid", "home_id": None}], owner="o", caller="s", caller_home=None) is None)
check("no rows, no caller, no owner: None",
      caller_card([], owner="o", caller="o", caller_home=None) is None
      and caller_card(rows, owner="o", caller="", caller_home=None) is None
      and caller_card(rows, owner="", caller="o", caller_home=None) is None)

# ---------------------------------------------------------------- the real socket
tmp = tempfile.mkdtemp(prefix="nimrod_callername_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "callername_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
OWN, FRIEND, CALLONLY, FRESH = "acct-owner", "acct-friend", "acct-callonly", "acct-fresh"


def H(u):
    return {"X-Dev-User": u}


def J(o):
    return json.dumps(o)


def first(u):
    return c.get("/api/people", headers=H(u)).json()["people"][0]["id"]


section("(setup) the owner (Pat) with a screen for Robin; a friend (Sam) connected; a call-only login")
pat = first(OWN)
c.patch(f"/api/people/{pat}", json={"name": "Pat"}, headers=H(OWN))
robin = c.post("/api/people", json={"name": "Robin"}, headers=H(OWN)).json()["id"]
sam = first(FRIEND)
c.patch(f"/api/people/{sam}", json={"name": "Sam"}, headers=H(FRIEND))
tok = c.post("/api/connect/invites", json={"shares": [robin]}, headers=H(OWN)).json()["token"]
check("(setup) Sam accepts Pat's connect link", c.post("/api/invites/accept", json={"token": tok}, headers=H(FRIEND)).status_code == 200)
own_people = c.get("/api/people", headers=H(OWN)).json()["people"]
sam_card = next((p["id"] for p in own_people if p["name"] == "Sam"), None)
check("(setup) Sam's card is on Pat's list", bool(sam_card), json.dumps(own_people))
for who, role in ((FRIEND, None), (CALLONLY, "caller")):
    body = {"subject_id": who, **({"role": role, "days": 0} if role else {})}
    check(f"(setup) a grant for {who}", c.post(f"/api/people/{robin}/drive-grants", json=body, headers=H(OWN)).status_code == 200)


def ws_for(u, role, extra=""):
    t = c.post(f"/api/drive/ticket/{robin}", headers=H(u)).json()["ticket"]
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


def offers(msgs):
    return [m["signal"] for m in msgs if m.get("type") == "signal" and m["signal"].get("kind") == "offer"]


SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n"
n = [0]


def ring(screen, caller, extra_sig=None, purpose="call"):
    """One call offer from `caller`, and what the screen got."""
    n[0] += 1
    session = f"cl-{n[0]:016d}"
    with ws_for(caller, "driver", "&idle=1") as D:
        drain(D)
        sig = {"kind": "offer", "sdp": SDP, "session": session, "from": {"name": "Other", "video": True}, **(extra_sig or {})}
        if purpose:
            sig["purpose"] = purpose
        D.send_text(J({"type": "signal", "signal": sig}))
        drain(D)
        got = offers(drain(screen))
        D.send_text(J({"type": "signal", "signal": {"kind": "bye", "session": session, **({"purpose": purpose} if purpose else {})}}))
        drain(D)
        drain(screen)
    return got[-1] if got else {}


with ws_for(OWN, "screen") as S:
    drain(S)

    section("*** the owner calling their own screen: their own card, by the name on it ***")
    g = ring(S, OWN)
    check("*** byName is the owner's card's name, not what the page said ***", g.get("byName") == "Pat", J(g))
    check("*** byPerson is that card, for its picture ***", g.get("byPerson") == pat, J(g))
    check("the page's own words are still there, untouched (from.name), but are not what the screen shows",
          (g.get("from") or {}).get("name") == "Other")

    section("*** the screen's person's own name for them wins ***")
    r = c.put(f"/api/people/{pat}/call-name", json={"name": "Dad", "viewer": robin}, headers=H(OWN))
    check("(setup) Robin's own label for Pat", r.status_code == 200, r.text)
    g = ring(S, OWN)
    check("*** Robin's screen says 'Dad' ***", g.get("byName") == "Dad" and g.get("byPerson") == pat, J(g))

    section("*** a friend connected to the owner: their card on the owner's list ***")
    g = ring(S, FRIEND)
    check("*** Sam's card, by its name ***", g.get("byName") == "Sam" and g.get("byPerson") == sam_card, J(g))
    c.put(f"/api/people/{sam_card}/call-name", json={"name": "Uncle Sam"}, headers=H(OWN))
    g = ring(S, FRIEND)
    check("*** the login's 'I call them' for Sam ***", g.get("byName") == "Uncle Sam", J(g))

    section("somebody with no card: the owner's name for them on the screen's list, else their display name, else nothing")
    g = ring(S, CALLONLY)
    check("no card, no list name, no display name: byName '' and no card (the screen says 'Someone')",
          g.get("byName") == "" and g.get("byPerson") == "", J(g))
    c.put("/api/me/display-name", json={"name": "Casey"}, headers=H(CALLONLY))
    g = ring(S, CALLONLY)
    check("...their own display name", g.get("byName") == "Casey", J(g))
    cur = c.get(f"/api/people/{robin}/state/input-bindings", headers=H(OWN)).json()
    c.put(f"/api/people/{robin}/state/input-bindings", headers=H(OWN),
          json={"data": {"screenPeople": [{"account": CALLONLY, "name": "Nurse Casey"}]}, "base_version": cur.get("version", 0)})
    g = ring(S, CALLONLY)
    check("...the owner's name for them on the list first", g.get("byName") == "Nurse Casey", J(g))

    section("*** a page cannot say who it is ***")
    g = ring(S, CALLONLY, {"byName": "Pat", "byPerson": pat, "byOwner": True})
    check("*** a forged byName, byPerson and byOwner are replaced by the server's ***",
          g.get("byName") == "Nurse Casey" and g.get("byPerson") == "" and g.get("byOwner") is False, J(g))
    g = ring(S, CALLONLY, {"byName": "Pat"}, purpose=None)
    check("a purpose-less offer (an older caller page) is a call, and stamped the same way", g.get("byName") == "Nurse Casey", J(g))

    # 2026-11-01: the intercom and the silent check-in named the caller the older way (the owner's list name, else the
    # display name) and carried no card, so one person read "Dad" on a call and "Pat" on the intercom, with no picture.
    section("*** the intercom and the silent check-in name the caller exactly as a call does ***")
    for kind in ("intercom", "checkin"):
        g = ring(S, OWN, purpose=kind)
        check(f"*** {kind}: the owner, by Robin's own name for them, with their card ***",
              g.get("purpose") == kind and g.get("byName") == "Dad" and g.get("byPerson") == pat, J(g))
    cur = c.get(f"/api/people/{robin}/state/input-bindings", headers=H(OWN)).json()
    c.put(f"/api/people/{robin}/state/input-bindings", headers=H(OWN), json={"data": {"screenPeople": [
        {"account": CALLONLY, "name": "Nurse Casey", "intercom": True, "checkIn": True},
        {"account": FRIEND, "name": "Sammy", "intercom": True, "checkIn": True}]}, "base_version": cur.get("version", 0)})
    for kind in ("intercom", "checkin"):
        g = ring(S, FRIEND, purpose=kind)
        check(f"*** {kind}: a friend with a card - the card's name (the login's 'I call them') wins over the list's ***",
              g.get("byName") == "Uncle Sam" and g.get("byPerson") == sam_card, J(g))
        g = ring(S, CALLONLY, purpose=kind)
        check(f"{kind}: no card - the fallback kept: the owner's name for them on the list, and no card",
              g.get("byName") == "Nurse Casey" and g.get("byPerson") == "", J(g))
        g = ring(S, CALLONLY, {"byName": "Pat", "byPerson": pat, "byOwner": True}, purpose=kind)
        check(f"*** {kind}: a forged byName, byPerson and byOwner are the server's again ***",
              g.get("byName") == "Nurse Casey" and g.get("byPerson") == "" and g.get("byOwner") is False, J(g))

section("*** a screen calling from its Call panel calls AS the person it is for (`as`) ***")
kim = c.post("/api/people", json={"name": "Kim"}, headers=H(OWN)).json()["id"]
check("(pure) the owner calling as one of their own people: that card",
      caller_card([{"id": "you"}, {"id": "r"}], owner="o", caller="o", caller_home=None, caller_person="r")["id"] == "r")
check("(pure) ...a person not on the list: their first person",
      caller_card([{"id": "you"}, {"id": "r"}], owner="o", caller="o", caller_home=None, caller_person="zz")["id"] == "you")


def ring_kim(caller, as_=None):
    n[0] += 1
    session = f"cl-{n[0]:016d}"
    tk = c.post(f"/api/drive/ticket/{kim}", headers=H(OWN)).json()["ticket"]
    with c.websocket_connect(f"/api/drive/{kim}?t={tk}&role=screen") as K:
        drain(K)
        td = c.post(f"/api/drive/ticket/{kim}", headers=H(caller)).json()["ticket"]
        with c.websocket_connect(f"/api/drive/{kim}?t={td}&role=driver&idle=1" + (f"&as={as_}" if as_ else "")) as D:
            drain(D)
            D.send_text(J({"type": "signal", "signal": {"kind": "offer", "sdp": SDP, "purpose": "call", "session": session}}))
            drain(D)
            got = offers(drain(K))
            D.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "call", "session": session}}))
            drain(D)
    return got[-1] if got else {}


g = ring_kim(OWN, robin)
check("*** Robin's screen calling Kim's: Kim's screen says Robin, with Robin's card ***",
      g.get("byName") == "Robin" and g.get("byPerson") == robin, J(g))
g = ring_kim(OWN)
check("...the same login with no `as` (a phone): the login's own first person, as before", g.get("byPerson") == pat, J(g))
g = ring_kim(OWN, sam_card)
check("*** `as` a card a connection put on this login (somebody else): ignored, never shown as them ***",
      g.get("byPerson") == pat and g.get("byName") != "Uncle Sam", J(g))
g = ring_kim(OWN, sam)
check("*** `as` another login's person: ignored ***", g.get("byPerson") == pat, J(g))
g = ring_kim(OWN, "bad id!")
check("...a malformed one: ignored, and the call still rings", g.get("byPerson") == pat, J(g))

section("a fresh login whose first person is still the default 'Me': not a name")
fresh_robin = c.post("/api/people", json={"name": "Robin"}, headers=H(FRESH)).json()["id"]
t = c.post(f"/api/drive/ticket/{fresh_robin}", headers=H(FRESH)).json()["ticket"]
with c.websocket_connect(f"/api/drive/{fresh_robin}?t={t}&role=screen") as S2:
    drain(S2)
    t2 = c.post(f"/api/drive/ticket/{fresh_robin}", headers=H(FRESH)).json()["ticket"]
    with c.websocket_connect(f"/api/drive/{fresh_robin}?t={t2}&role=driver&idle=1") as D2:
        drain(D2)
        D2.send_text(J({"type": "signal", "signal": {"kind": "offer", "sdp": SDP, "purpose": "call", "session": "cl-fresh00000000001"}}))
        drain(D2)
        got = offers(drain(S2))
        g = got[-1] if got else {}
        check("*** 'Me' is never shown as the caller's name (it would read as the person at the screen) ***",
              g.get("byName") == "" and bool(g.get("byPerson")), J(g))
        D2.send_text(J({"type": "signal", "signal": {"kind": "bye", "purpose": "call", "session": "cl-fresh00000000001"}}))
        drain(D2)

section("only an offer carries it")
check("the stamp helper fails empty on nonsense rather than stopping a ring",
      appmod._caller_on_screen("no-such-owner", "no-such-person", "nobody") == {"byPerson": "", "byName": ""})

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
