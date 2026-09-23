#!/usr/bin/env python3
"""Auth-seam test — device-secret + dev-override + fail-closed prod. Zero deps. Run:

    python test_identity.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import HTTPException  # noqa: E402
from identity import (DEV_USER, _device_keys, current_user,  # noqa: E402
                       set_device_key_lookup, set_device_key_touch)

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}   {detail}")


class FakeReq:
    def __init__(self, headers=None, query=None, session=None):
        self.headers = dict(headers or {})
        self.query_params = dict(query or {})
        self.session = dict(session or {})   # SessionMiddleware provides this in the real app


def user_of(headers=None, query=None, session=None):
    return current_user(FakeReq(headers, query, session))


def raises_401(headers=None, query=None, session=None):
    try:
        current_user(FakeReq(headers, query, session))
        return False
    except HTTPException as e:
        return e.status_code == 401


def setenv(**kw):
    for k in ("NIMROD_ENV", "DEVICE_KEYS"):
        os.environ.pop(k, None)
    for k, v in kw.items():
        os.environ[k] = v


def main():
    # --- dev, no keys: the existing stub behavior is unchanged --------------
    setenv()
    check("dev: X-Dev-User override", user_of({"X-Dev-User": "alice"}) == "alice")
    check("dev: ?user= override", user_of(query={"user": "bob"}) == "bob")
    check("dev: no override -> DEV_USER", user_of() == DEV_USER)

    # --- DEVICE_KEYS parsing -------------------------------------------------
    setenv(DEVICE_KEYS="robin:abc, mike:def , bad, :nouser, u:")
    check("parse maps secret->user, skips malformed", _device_keys() == {"abc": "robin", "def": "mike"})

    # --- dev + keys: a valid key wins; an invalid one falls back -------------
    setenv(DEVICE_KEYS="robin:abc")
    check("dev: a valid device key resolves to its user", user_of({"X-Device-Key": "abc"}) == "robin")
    check("dev: an invalid key falls back to the override",
          user_of({"X-Device-Key": "nope", "X-Dev-User": "alice"}) == "alice")

    # --- prod + keys: ONLY a valid device key; everything else 401 -----------
    setenv(NIMROD_ENV="prod", DEVICE_KEYS="robin:abc,mike:def")
    check("prod: valid key -> user", user_of({"X-Device-Key": "abc"}) == "robin")
    check("prod: a second valid key -> its user", user_of({"X-Device-Key": "def"}) == "mike")
    check("prod: an invalid key -> 401", raises_401({"X-Device-Key": "wrong"}))
    check("prod: a missing key -> 401", raises_401())
    check("prod: X-Dev-User is ignored (override disabled) -> 401", raises_401({"X-Dev-User": "alice"}))
    check("prod: ?user= is ignored -> 401", raises_401(query={"user": "alice"}))
    check("prod: one user's key never resolves to another user", user_of({"X-Device-Key": "def"}) != "robin")

    # --- OAuth session: a signed-in user, no device key needed ---------------
    check("prod: a login session resolves to its user", user_of(session={"user": "google:123"}) == "google:123")
    check("prod: session works with no key present", user_of(session={"user": "google:abc"}) == "google:abc")
    check("prod: an empty session still 401s", raises_401(session={}))
    check("prod: a device key takes precedence over the session",
          user_of({"X-Device-Key": "abc"}, session={"user": "google:zzz"}) == "robin")
    setenv()  # dev
    check("dev: a login session resolves to its user", user_of(session={"user": "google:9"}) == "google:9")
    setenv(NIMROD_ENV="prod", DEVICE_KEYS="robin:abc,mike:def")

    # --- prod, no DEVICE_KEYS: deny everything (fail closed) ------------------
    setenv(NIMROD_ENV="prod")
    check("prod: no DEVICE_KEYS -> everything 401 (fail closed)", raises_401({"X-Device-Key": "anything"}))

    # --- table-backed keys touch last_seen; env-var keys never do -----------
    #
    # §uptime-monitoring: `device_keys.last_seen` existed but nothing ever wrote to it after
    # creation, because the one place that authenticates a table-backed key never called
    # `touch_device_key`. Proven here with fakes — no real database — the same way `_key_lookup`
    # itself is proven, per this file's own header ("zero deps").
    setenv(NIMROD_ENV="prod", DEVICE_KEYS="robin:abc")
    touched = []
    set_device_key_lookup(lambda k: "family@example.com" if k == "nk_real" else None)
    set_device_key_touch(lambda k: touched.append(k))
    check("a table-backed key still resolves", user_of({"X-Device-Key": "nk_real"}) == "family@example.com")
    check("*** and it touches last_seen with the SAME key it authenticated ***",
          touched == ["nk_real"], str(touched))
    check("an env-var key resolves too", user_of({"X-Device-Key": "abc"}) == "robin")
    check("...but env-var keys have no row to touch, so they never do",
          touched == ["nk_real"], str(touched))
    check("a key that fails to resolve is not touched either",
          raises_401({"X-Device-Key": "nope"}) and touched == ["nk_real"], str(touched))

    # A touch failure must not turn a successful auth into a 401 — the same fail-open reasoning
    # the lookup's own except clause already gets.
    def _boom(k):
        raise RuntimeError("db hiccup")
    set_device_key_touch(_boom)
    check("*** a touch that throws does not break authentication ***",
          user_of({"X-Device-Key": "nk_real"}) == "family@example.com")

    set_device_key_lookup(None)
    set_device_key_touch(None)
    setenv()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
