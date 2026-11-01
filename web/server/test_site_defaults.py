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

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
