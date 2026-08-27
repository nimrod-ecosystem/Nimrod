#!/usr/bin/env python3
"""Screen pairing — how a family adopts a bedside screen without emailing anybody.

A screen that nobody signs into needs a credential of its own: it reboots at 3am and has
to come back by itself, and it cannot type a password. Those credentials used to live only
in the server's DEVICE_KEYS environment variable, which meant creating one required the
hosting dashboard — so the whole unattended-kiosk feature was founder-only.

Store-layer test, zero dependencies. The dance is the media-agent pairing flow's, and the
part that is not obvious is the POLL TOKEN: the code is displayed on a screen in a room, so
anybody walking past can read it. That is fine for claiming, which needs a sign-in. It is
not fine for collecting the key.

    python test_screen_pairing.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402
from db import SQLiteStore  # noqa: E402

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t: str):
    print(f"\n-- {t}")


def main() -> None:
    # In memory: on Windows a SQLite file still open at teardown makes TemporaryDirectory
    # raise, which turns a green suite into a traceback that looks like a real failure.
    store = SQLiteStore(":memory:")
    if True:

        # -----------------------------------------------------------------
        section("the request — unauthenticated, and worth nothing on its own")
        # -----------------------------------------------------------------
        p = store.create_screen_pairing("Christine's screen")
        check("a code is minted", bool(p["code"]))
        check("and a poll token with it", bool(p["poll_token"]) and len(p["poll_token"]) > 20)
        check("the code is short enough to read off a screen and type on a phone",
              4 <= len(p["code"]) <= 8, p["code"])
        check("it carries an expiry", bool(p["expires_at"]))

        state, key = store.screen_pairing_status(p["code"], p["poll_token"])
        check("it starts PENDING", state == "pending", state)
        check("AND NO KEY EXISTS YET — an unclaimed row must never contain a usable "
              "credential, so there is nothing in it to steal", key is None)

        # -----------------------------------------------------------------
        section("*** THE POLL TOKEN — the security of the whole flow ***")
        # -----------------------------------------------------------------
        # The CODE is on a screen in a room. Anybody walking past can read it.
        wrong, _ = store.screen_pairing_status(p["code"], "not-the-token")
        check("THE CODE ALONE IS NOT ENOUGH TO POLL — otherwise whoever glimpsed it could "
              "take the key the instant it was minted", wrong == "unknown", wrong)
        blank, _ = store.screen_pairing_status(p["code"], "")
        check("and neither is no token at all", blank == "unknown", blank)

        # A wrong token answers exactly as a nonexistent code does.
        missing, _ = store.screen_pairing_status("ZZZZZZ", "anything")
        check("A WRONG TOKEN AND A CODE THAT NEVER EXISTED GIVE THE SAME ANSWER — "
              "distinguishing them would make this an oracle for 'is that code real', "
              "which is exactly what somebody who read a code off a screen wants to know",
              wrong == missing == "unknown")

        # -----------------------------------------------------------------
        section("the claim — a signed-in person adopts it")
        # -----------------------------------------------------------------
        st, info = store.claim_screen_pairing(p["code"], "family@example.com")
        check("claiming works", st == "ok", st)
        check("and it remembers what the screen called itself",
              info["label"] == "Christine's screen", str(info))

        state, key = store.screen_pairing_status(p["code"], p["poll_token"])
        check("the screen's next poll says CLAIMED", state == "claimed", state)
        check("and hands over a key", bool(key) and len(key) > 20)
        check("THE KEY RESOLVES TO THE ACCOUNT THAT CLAIMED IT — which is the entire point",
              store.device_key_user(key) == "family@example.com")
        check("a key nobody minted resolves to nobody",
              store.device_key_user("nk_made-up") is None)
        check("and neither does an empty one", store.device_key_user("") is None)

        # Claiming is once.
        again, _ = store.claim_screen_pairing(p["code"], "someone-else@example.com")
        check("A CODE CANNOT BE CLAIMED TWICE — the second person does not get a key to "
              "somebody else's screen", again == "claimed", again)
        check("and the key still belongs to the first claimer",
              store.device_key_user(key) == "family@example.com")

        # And the token still gates collection even after the claim.
        after, _ = store.screen_pairing_status(p["code"], "wrong")
        check("the poll token still gates the key AFTER the claim, which is when there is "
              "finally something worth taking", after == "unknown", after)

        # -----------------------------------------------------------------
        section("codes that should not work")
        # -----------------------------------------------------------------
        st, _ = store.claim_screen_pairing("NOPE99", "family@example.com")
        check("an unknown code cannot be claimed", st == "unknown", st)

        expired = store.create_screen_pairing("Old", ttl_s=-1)
        est, _ = store.screen_pairing_status(expired["code"], expired["poll_token"])
        check("an expired code reads as expired to the screen", est == "expired", est)
        cst, _ = store.claim_screen_pairing(expired["code"], "family@example.com")
        check("AND CANNOT BE CLAIMED — a code somebody wrote down last week must not still "
              "adopt a screen", cst == "expired", cst)

        # -----------------------------------------------------------------
        section("the list — and it must never hand back a secret")
        # -----------------------------------------------------------------
        screens = store.list_device_keys("family@example.com")
        check("the account can see the screen it adopted", len(screens) == 1, str(screens))
        check("with the name it chose", screens[0]["label"] == "Christine's screen")
        check("*** THE SECRET IS NOT IN THE LIST *** — a list that hands back credentials "
              "is a list that leaks them into logs and screenshots",
              "key" not in screens[0] and key not in str(screens))
        check("but there IS an id to revoke by", bool(screens[0]["id"]))
        check("another account sees none of it",
              store.list_device_keys("stranger@example.com") == [])

        # -----------------------------------------------------------------
        section("revocation — the only way to turn a lost screen off")
        # -----------------------------------------------------------------
        check("a stranger cannot revoke somebody else's screen",
              store.revoke_device_key("stranger@example.com", screens[0]["id"]) is False)
        check("...and the key still works", store.device_key_user(key) == "family@example.com")

        check("the owner can revoke it",
              store.revoke_device_key("family@example.com", screens[0]["id"]) is True)
        check("REVOCATION BITES IMMEDIATELY — the next request that screen makes is a 401",
              store.device_key_user(key) is None)
        check("and it is gone from the list", store.list_device_keys("family@example.com") == [])
        check("revoking twice is a no-op rather than an error",
              store.revoke_device_key("family@example.com", screens[0]["id"]) is False)
        check("revoking nothing is refused", store.revoke_device_key("family@example.com", "") is False)

        # -----------------------------------------------------------------
        section("two screens, one account")
        # -----------------------------------------------------------------
        a = store.create_screen_pairing("Bedroom")
        b = store.create_screen_pairing("Day room")
        check("two requests get different codes", a["code"] != b["code"])
        check("and different poll tokens", a["poll_token"] != b["poll_token"])
        store.claim_screen_pairing(a["code"], "family@example.com")
        store.claim_screen_pairing(b["code"], "family@example.com")
        _, ka = store.screen_pairing_status(a["code"], a["poll_token"])
        _, kb = store.screen_pairing_status(b["code"], b["poll_token"])
        check("each screen gets its OWN key, so one can be revoked without the other",
              ka != kb)
        both = store.list_device_keys("family@example.com")
        check("both are listed", len(both) == 2, str(both))
        store.revoke_device_key("family@example.com", both[0]["id"])
        check("revoking one leaves the other working",
              store.device_key_user(kb) is not None or store.device_key_user(ka) is not None)
        check("and exactly one is gone", len(store.list_device_keys("family@example.com")) == 1)

        # -----------------------------------------------------------------
        section("the sweep — /screen-pair/request is unauthenticated, so bound the table")
        # -----------------------------------------------------------------
        for _ in range(3):
            store.create_screen_pairing("junk", ttl_s=-1)
        n = store.sweep_screen_pairings()
        check("expired unclaimed codes are swept", n >= 3, str(n))
        live = store.create_screen_pairing("keep me")
        store.sweep_screen_pairings()
        st2, _ = store.screen_pairing_status(live["code"], live["poll_token"])
        check("a live one is NOT swept out from under a screen that is still showing it",
              st2 == "pending", st2)

        # -----------------------------------------------------------------
        section("last seen — so a list of screens can say which has gone quiet")
        # -----------------------------------------------------------------
        store.touch_device_key(kb)
        rows = store.list_device_keys("family@example.com")
        check("a touched key records when it was last seen",
              any(r["last_seen"] for r in rows), str(rows))
        store.touch_device_key("nk_not-real")
        check("touching a key that does not exist is a no-op rather than a crash", True)

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
