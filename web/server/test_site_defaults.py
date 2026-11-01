"""The site's owners, and what they may save as the site's defaults (row 2.145 step 5, 2026-10-31).

    py -3.13 test_site_defaults.py

site_owner.py: NIMROD_SITE_OWNERS names the owners; unset is nobody; a screen's device key alone never counts. The
database is a NEW TEMPORARY FILE (NIMROD_DB), DATABASE_URL and NIMROD_ENV are taken out before the app is imported -
this never touches a production database. The owner ids here are made up and have no colon in them, because
DEVICE_KEYS (identity.py) splits "account:secret" on the first colon.
"""
import os
import sys
import tempfile
from pathlib import Path

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(name):
    print(f"\n--- {name}")


tmp = tempfile.mkdtemp(prefix="nimrod_site_defaults_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "site_defaults.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
os.environ.pop("NIMROD_SITE_OWNERS", None)
os.environ["DEVICE_KEYS"] = "ownerone:screenkey-ownerone,someone:screenkey-someone"
sys.path.insert(0, str(Path(__file__).resolve().parent))

import site_owner  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
H = lambda u: {"X-Dev-User": u}  # noqa: E731
KEY = {"X-Device-Key": "screenkey-ownerone"}


class FakeReq:
    """identity.py's own test request (test_identity.py): headers, a query and a session."""

    def __init__(self, headers=None, session=None):
        self.headers = dict(headers or {})
        self.query_params = {}
        self.session = dict(session or {})


def set_owners(v):
    if v is None:
        os.environ.pop("NIMROD_SITE_OWNERS", None)
    else:
        os.environ["NIMROD_SITE_OWNERS"] = v


# ------------------------------------------------------------------------------------------------ who the owners are
section("*** the owners list: NIMROD_SITE_OWNERS ***")
check("*** unset: nobody is an owner (fails closed) ***", site_owner.owners({}) == frozenset())
check("empty, or only spaces and commas: nobody", site_owner.owners({"NIMROD_SITE_OWNERS": " , ,  "}) == frozenset())
check("comma or space separated, trimmed",
      site_owner.owners({"NIMROD_SITE_OWNERS": " ownerone, ownertwo  google:12345\tauth0|abc "})
      == frozenset({"ownerone", "ownertwo", "google:12345", "auth0|abc"}))
check("what is not an account id is dropped, not guessed at (quotes, <tags>, too long)",
      site_owner.owners({"NIMROD_SITE_OWNERS": "\"ownerone\", <b>x</b>, ok, " + "a" * (site_owner.ID_MAX + 1)})
      == frozenset({"ok"}))
check("an id at the longest allowed is kept", site_owner.owners({"NIMROD_SITE_OWNERS": "a" * site_owner.ID_MAX})
      == frozenset({"a" * site_owner.ID_MAX}))

section("*** is_site_owner: in the list, and a person, not a screen's key alone ***")
env = {"NIMROD_SITE_OWNERS": "ownerone"}
check("an owner signed in (a session) is the owner",
      site_owner.is_site_owner(FakeReq(session={"user": "ownerone"}), "ownerone", env))
check("somebody not in the list is not", not site_owner.is_site_owner(FakeReq(session={"user": "someone"}), "someone", env))
check("*** the owner's account on a SCREEN'S DEVICE KEY alone is not the owner ***",
      not site_owner.is_site_owner(FakeReq(headers=KEY), "ownerone", env))
check("...the same key with the owner's own sign-in in this browser is (a person: identity.signed_in_here)",
      site_owner.is_site_owner(FakeReq(headers=KEY, session={"user": "ownerone"}), "ownerone", env))
check("...the key with a DIFFERENT account's sign-in is not",
      not site_owner.is_site_owner(FakeReq(headers=KEY, session={"user": "someone"}), "ownerone", env))
check("no user, or the list unset: never", not site_owner.is_site_owner(FakeReq(), None, env)
      and not site_owner.is_site_owner(FakeReq(session={"user": "ownerone"}), "ownerone", {}))

# ------------------------------------------------------------------------------------------------ the flag on the routes
section("*** site_owner on /api/me and /api/whoami ***")
set_owners(None)
me = c.get("/api/me", headers=H("ownerone")).json()
check("*** NIMROD_SITE_OWNERS unset: /api/me says site_owner false ***", me.get("site_owner") is False, str(me))
set_owners("ownerone, ownertwo")
me = c.get("/api/me", headers=H("ownerone")).json()
check("*** an owner (dev sign-in, no screen key): /api/me site_owner true ***", me.get("site_owner") is True, str(me))
check("...and /api/whoami says the same", c.get("/api/whoami", headers=H("ownerone")).json() == {"user": "ownerone", "site_owner": True})
check("somebody else: false on both", c.get("/api/me", headers=H("someone")).json().get("site_owner") is False
      and c.get("/api/whoami", headers=H("someone")).json().get("site_owner") is False)
me = c.get("/api/me", headers=KEY).json()
check("*** the owner's own account on a screen's device key: false ***", me.get("user") == "ownerone" and me.get("site_owner") is False, str(me))
check("...and /api/whoami on that key: false", c.get("/api/whoami", headers=KEY).json().get("site_owner") is False)
set_owners("")
check("set but empty: nobody", c.get("/api/me", headers=H("ownerone")).json().get("site_owner") is False)
set_owners(None)

# ------------------------------------------------------------------------------------------------ 5c: the outbox
import site_defaults as rules  # noqa: E402

CLIENT = Path(__file__).resolve().parents[1] / "client" / "nimrod_defaults.js"
shipped_bytes = CLIENT.read_bytes()
shipped_served = c.get("/nimrod_defaults.js").text
ROOM = {"walls": "plaster", "items": [{"id": "desk1", "part": "desk", "x": 40, "y": 80}]}
OWN = H("ownerone")

section("*** 5c: only an owner may save, list or withdraw; every route asks ***")
r = c.post("/api/site-defaults", json={"kind": "rooms", "path": ["theRoom"], "body": ROOM}, headers=OWN)
check("*** NIMROD_SITE_OWNERS unset: even the would-be owner is refused, in plain words (403) ***",
      r.status_code == 403 and r.json().get("detail") == rules.SAY_NOT_OWNER, r.text)
set_owners("ownerone")
check("somebody not an owner: 403 on save, list and withdraw",
      c.post("/api/site-defaults", json={"kind": "rooms", "path": ["theRoom"], "body": ROOM}, headers=H("someone")).status_code == 403
      and c.get("/api/site-defaults", headers=H("someone")).status_code == 403
      and c.post("/api/site-defaults/abc/withdraw", headers=H("someone")).status_code == 403)
check("*** the owner's account on a screen's device key alone: 403 ***",
      c.post("/api/site-defaults", json={"kind": "rooms", "path": ["theRoom"], "body": ROOM}, headers=KEY).status_code == 403
      and c.get("/api/site-defaults", headers=KEY).status_code == 403)

section("*** 5c: a save is checked again and QUEUED, never applied ***")
r = c.post("/api/site-defaults", json={"kind": "rooms", "path": ["theRoom"], "body": ROOM}, headers=OWN)
check("*** the owner saves a room: kept, waiting (1) ***", r.status_code == 200 and r.json() == {"ok": True, "saved": 1, "replaced": 0, "waiting": 1}, r.text)
g = c.get("/api/site-defaults", headers=OWN).json()
check("*** the list: that one, not in the site yet; the copy text holds it as a nimrod_defaults entry ***",
      len(g["saves"]) == 1 and g["saves"][0]["kind"] == "rooms" and g["saves"][0]["path"] == ["theRoom"] and g["saves"][0]["in_site"] is False
      and g["saves"][0]["by"] == "ownerone" and '"theRoom"' in g["copy"] and g["copy"].startswith(rules.DEFAULTS_HEAD), str(g)[:400])
check("*** the shipped defaults are untouched: the file on disk and what the site serves ***",
      CLIENT.read_bytes() == shipped_bytes and c.get("/nimrod_defaults.js").text == shipped_served)
r = c.post("/api/site-defaults", json={"kind": "rooms", "path": ["theRoom"], "body": {**ROOM, "walls": "wood"}}, headers=OWN)
check("*** the same room saved again replaces it: still one waiting ***", r.json().get("replaced") == 1 and r.json().get("waiting") == 1, r.text)
check("...the list has the newer one", '"wood"' in c.get("/api/site-defaults", headers=OWN).json()["copy"])
r = c.post("/api/site-defaults", json={"kind": "words", "rows": [{"page": "/home", "old": "Start  here", "new": "Begin here"},
                                                               {"page": "/modules", "old": "Try it", "new": "Try this one"}]}, headers=OWN)
check("*** words: each line kept (spaces tidied), 3 waiting ***", r.status_code == 200 and r.json().get("saved") == 2 and r.json().get("waiting") == 3, r.text)
cp = c.get("/api/site-defaults", headers=OWN).json()["copy"]
check("...in the copy text as wording_edit.js's own lines", rules.WORDS_HEAD in cp and "/home\tStart here\tBegin here" in cp, cp)
village = c.post("/api/site-defaults", json={"kind": "village", "path": ["village"], "body": {"pieces": []}}, headers=OWN)
town = c.post("/api/site-defaults", json={"kind": "town", "path": ["nimrod", "kingHall"], "body": {"items": []}}, headers=OWN)
check("a village scene and a Town place are kinds it keeps", village.status_code == 200 and town.status_code == 200, village.text + town.text)
# (step 5d) A ready-made dashboard, as dashboards.js reads it: its layout by ref, its panels' starts, its look.
DASH = {"layout": {"preset": "full", "slots": ["people"], "placed": [{"ref": "helper", "place": "overlay", "x": 70, "y": 80, "w": 36, "h": 11}]},
        "modules": {"people": {"show": "big"}}, "settings": {"panelSurface": "solid"}}
dash = c.post("/api/site-defaults", json={"kind": "dashboards", "path": ["people"], "body": DASH}, headers=OWN)
check("*** 5d: a ready-made dashboard is a kind it keeps (`dashboards` [its key]) ***", dash.status_code == 200, dash.text)
check("...in the copy text under `dashboards`", '"dashboards"' in c.get("/api/site-defaults", headers=OWN).json()["copy"])


def refused_save(payload, status=400):
    r = c.post("/api/site-defaults", json=payload, headers=OWN)
    return r.status_code == status and isinstance(r.json().get("detail"), str)


section("*** 5c: each refusal ***")
check("a kind nothing reads (backdrops), or one made up: refused",
      refused_save({"kind": "backdrops", "path": ["x"], "body": ROOM}) and refused_save({"kind": "screens", "path": ["x"], "body": ROOM}))
check("*** 5d: a ready-made dashboard not shaped as one is refused, in its own words ***",
      refused_save({"kind": "dashboards", "path": ["people"], "body": ROOM})
      and c.post("/api/site-defaults", json={"kind": "dashboards", "path": ["people"], "body": ROOM}, headers=OWN).json().get("detail") == rules.SAY_DASHBOARD)
check("...a slot that is not a ref, a placed panel by instance id, a panel's start that is not an object, a look that is not plain values: each refused",
      refused_save({"kind": "dashboards", "path": ["people"], "body": {"layout": {"preset": "full", "slots": ["no way!"]}}})
      and refused_save({"kind": "dashboards", "path": ["people"], "body": {"layout": {"preset": "full", "slots": [], "placed": [{"id": "m-1", "ref": "helper"}]}}})
      and refused_save({"kind": "dashboards", "path": ["people"], "body": {"modules": {"people": "big"}}})
      and refused_save({"kind": "dashboards", "path": ["people"], "body": {"settings": {"theme": {"a": 1}}}}))
check("a path that is not an id, or too short or long for its kind: refused",
      refused_save({"kind": "rooms", "path": ["the room!"], "body": ROOM}) and refused_save({"kind": "town", "path": ["nimrod"], "body": ROOM})
      and refused_save({"kind": "rooms", "path": ["a", "b"], "body": ROOM}) and refused_save({"kind": "rooms", "path": "theRoom", "body": ROOM}))
check("a body that is not an object (or is empty): refused",
      refused_save({"kind": "rooms", "path": ["theRoom"], "body": [1, 2]}) and refused_save({"kind": "rooms", "path": ["theRoom"], "body": {}}))
deep = {}
node = deep
for _ in range(rules.DEPTH_MAX + 2):
    node["a"] = {}
    node = node["a"]
check(f"nested deeper than {rules.DEPTH_MAX}: refused", refused_save({"kind": "rooms", "path": ["theRoom"], "body": deep}))
check(f"bigger than {rules.ENTRY_MAX_BYTES // 1024} KB: refused (413)",
      refused_save({"kind": "rooms", "path": ["theRoom"], "body": {"n": "x" * (rules.ENTRY_MAX_BYTES + 10)}}, 413))
check("a picture inside it: refused (storage_line's content rules)",
      refused_save({"kind": "rooms", "path": ["theRoom"], "body": {"img": "data:image/png;base64,iVBORw0KGgo"}}))
W = lambda new, old="Start here", page="/home": {"kind": "words", "rows": [{"page": page, "old": old, "new": new}]}  # noqa: E731
check("*** words with < > or a backtick: refused ***", refused_save(W("<b>Hi</b>")) and refused_save(W("a > b")) and refused_save(W("`x`")))
check("*** words with ${ or a data: address: refused ***", refused_save(W("Hi ${name}")) and refused_save(W("see data:text/html,x")))
check("a control character: refused; a line break is one line (kept as a space)",
      refused_save(W("a\x07b")) and c.post("/api/site-defaults", json=W("two\nlines"), headers=OWN).status_code == 200)
check(f"longer than {rules.LINE_MAX} letters, empty, or the same as before: refused",
      refused_save(W("x" * (rules.LINE_MAX + 1))) and refused_save(W("   ")) and refused_save(W("Start here")))
check("a page that is not a path on this site: refused",
      refused_save(W("Hi", page="https://example.com/")) and refused_save(W("Hi", page="/a/../b")) and refused_save(W("Hi", page="home")))
check("no rows, or not a list: refused", refused_save({"kind": "words", "rows": []}) and refused_save({"kind": "words", "rows": "x"}))
check("not JSON object at all: refused (422)", c.post("/api/site-defaults", json=[1], headers=OWN).status_code == 422)

section("*** 5c: the waiting list has a limit, and a withdraw ***")
saved_max = appmod.site_defaults.WAITING_MAX
appmod.site_defaults.WAITING_MAX = c.get("/api/site-defaults", headers=OWN).json()["saves"].__len__()
r = c.post("/api/site-defaults", json={"kind": "rooms", "path": ["study"], "body": ROOM}, headers=OWN)
check("*** at the limit: a NEW thing is refused with a sentence (507) ***", r.status_code == 507 and r.json()["detail"] == rules.SAY_FULL, r.text)
check("...a thing already waiting may still be saved again (it takes no more room)",
      c.post("/api/site-defaults", json={"kind": "rooms", "path": ["theRoom"], "body": ROOM}, headers=OWN).status_code == 200)
appmod.site_defaults.WAITING_MAX = saved_max
g = c.get("/api/site-defaults", headers=OWN).json()
sid = next(s["id"] for s in g["saves"] if s["kind"] == "rooms")
check("withdraw: a bad id is refused (400), somebody else's press 403",
      c.post("/api/site-defaults/not an id/withdraw", headers=OWN).status_code in (400, 404)
      and c.post(f"/api/site-defaults/{sid}/withdraw", headers=H("someone")).status_code == 403)
r = c.post(f"/api/site-defaults/{sid}/withdraw", headers=OWN)
check("*** the owner withdraws one: it is gone from the list ***", r.status_code == 200
      and all(s["id"] != sid for s in c.get("/api/site-defaults", headers=OWN).json()["saves"]), r.text)
check("...again: 404", c.post(f"/api/site-defaults/{sid}/withdraw", headers=OWN).status_code == 404)
orig_shipped = appmod._shipped_defaults
appmod._shipped_defaults = lambda: {"rooms": {}, "village": {"village": {"pieces": []}}}
g = c.get("/api/site-defaults", headers=OWN).json()
check("*** an entry the deploy already ships exactly is marked in the site (so it can be withdrawn) ***",
      any(s["kind"] == "village" and s["in_site"] is True for s in g["saves"])
      and any(s["kind"] == "town" and s["in_site"] is False for s in g["saves"])
      and all(s["in_site"] is None for s in g["saves"] if s["kind"] == "words"), str(g["saves"])[:400])
appmod._shipped_defaults = orig_shipped
check("*** after every save, the shipped defaults are still untouched ***",
      CLIENT.read_bytes() == shipped_bytes and c.get("/nimrod_defaults.js").text == shipped_served)
notes = appmod.store.describe_storage()
check("the storage register says what the outbox keeps, in words", "site_default_saves" not in notes["undocumented"]
      and any(r["table"] == "site_default_saves" for r in notes["stores"]))
set_owners(None)
check("*** owners unset again: the list is closed too ***", c.get("/api/site-defaults", headers=OWN).status_code == 403)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
