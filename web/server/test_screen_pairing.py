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

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# The app is imported further down (the return trip, and device keys over HTTP). A throwaway
# database for it, so this suite never writes into the repo's own nimrod.db.
_TMP = tempfile.mkdtemp(prefix="nimrod_screen_pair_")
os.environ.setdefault("NIMROD_DB", os.path.join(_TMP, "app.db"))
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
        p = store.create_screen_pairing("Robin's screen")
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
              info["label"] == "Robin's screen", str(info))

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
        check("with the name it chose", screens[0]["label"] == "Robin's screen")
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

    # -----------------------------------------------------------------
    section("*** what we store - generated, so it cannot quietly go out of date ***")
    # -----------------------------------------------------------------
    # The written version HAD already gone out of date: the landing page said the server
    # holds an email, screen names and a few hundred bytes of settings, "that is all of it",
    # while the database had grown a person's NAME, append-only event streams, media-source
    # addresses and drive grants. This is the fix, and the fix is the mechanism.
    d = store.describe_storage()
    names = {r["table"] for r in d["stores"]}

    check("it lists the REAL tables, read out of the database rather than typed",
          "people" in names and "events" in names and "drive_grants" in names, str(sorted(names)))
    check("nothing in this build is undescribed", d["undocumented"] == [], str(d["undocumented"]))

    by = {r["table"]: r for r in d["stores"]}
    check("A PERSON'S NAME IS DECLARED PERSONAL - it is the most personal thing in the "
          "database and the old written list did not mention it at all",
          by["people"]["personal"] is True)
    check("and the description says so in words a person can read",
          "NAME" in by["people"]["what"], by["people"]["what"])
    check("the event log is declared personal AND declared to grow, which the old "
          "'a few hundred bytes' line hid",
          by["events"]["personal"] is True and "GROWS" in by["events"]["what"],
          by["events"]["what"])
    check("media sources are described as an ADDRESS pointing at your machine, never files",
          "Never the files" in by["media_sources"]["what"], by["media_sources"]["what"])
    check("a transient pairing code is NOT flagged personal, so the flag stays meaningful",
          by["screen_pairings"]["personal"] is False)

    check("it also says what is never stored", len(d["never"]) >= 4)
    check("and photos are top of that list, because it is the thing people actually fear",
          "photo" in d["never"][0].lower(), d["never"][0])

    # *** THE ANTI-DRIFT MECHANISM, which is the entire point. ***
    with store._tx() as cur:
        cur.execute("CREATE TABLE IF NOT EXISTS secret_new_thing (id TEXT PRIMARY KEY)")
    d2 = store.describe_storage()
    by2 = {r["table"]: r for r in d2["stores"]}
    check("*** A NEW TABLE NOBODY DESCRIBED SHOWS UP AS UNDOCUMENTED *** - adding storage "
          "without explaining it is not a silent act, it publishes its own omission",
          "secret_new_thing" in d2["undocumented"], str(d2["undocumented"]))
    check("it is LISTED rather than omitted, so the page can only drift towards admitting more",
          "secret_new_thing" in by2)
    check("and an undescribed table is assumed PERSONAL until somebody says otherwise",
          by2["secret_new_thing"]["personal"] is True)
    check("with text that points at the source rather than pretending to explain",
          "source" in by2["secret_new_thing"]["what"], by2["secret_new_thing"]["what"])

    # *** THE WEATHER TOWN (MIKE_LIST_20260930, Weather item 6). *** The Weather panel saves the
    # place somebody typed, the match they picked with its position rounded to about 11 km, and
    # the last forecast, all in that panel's settings (the `state` table). The page said none of
    # that, and its "never stored" list said "your location" flat out. A town is a location, so
    # the row has to say what is kept, where, and why, and the never-list must not contradict it.
    state_what = by["state"]["what"]
    check("*** the settings row names the weather town: what is kept ***",
          "Weather" in state_what and "town" in state_what, state_what)
    check("...that the position is rounded to about 11 km",
          "11 km" in state_what, state_what)
    check("...why it is kept (so the panel knows where to look)",
          "where to look" in state_what, state_what)
    check("...and that the place also goes to Open-Meteo, so nobody thinks it stays here",
          "Open-Meteo" in state_what, state_what)
    # 2026-10-06: a person's level in every question game is kept with the person (person state
    # `ratings_trivia` for Trivia, `ratings` for the others), with where their games start.
    check("the settings row says game levels are kept, and that a person's level in each game goes with them",
          "level" in state_what and "level in each game" in state_what and "kept with them" in state_what
          and "where their games start" in state_what, state_what)
    check("the never-stored list no longer says 'your location' with nothing after it",
          "your location" not in d["never"], str(d["never"]))
    check("...but still says the device is never asked where it is",
          any("location" in n and "never asked" in n for n in d["never"]), str(d["never"]))

    # ------------------------------------------------------------------ the return trip
    # THE OPEN-REDIRECT CHECK behind `/auth/login?next=`. It exists because scanning a QR
    # code on a bedside screen sends somebody here mid-task: they arrive at /pair.html
    # carrying a code, discover they are not signed in, and must come back to the SAME page
    # afterwards or the code is lost and they have to walk back and read it off the screen.
    #
    # Anything that is not a path on this site is dropped rather than followed, because the
    # value ends up in a Location header. Imported here rather than driven through HTTP so
    # the check itself is pinned, independently of how the route happens to call it.
    section("where you land after signing in")
    from app import _safe_next  # noqa: E402  (imported here: app.py pulls in the whole server)

    check("a normal path is kept", _safe_next("/pair.html?c=9K42QX") == "/pair.html?c=9K42QX")
    check("no next at all falls through to the default", _safe_next(None) is None)
    check("an empty next falls through", _safe_next("") is None)
    check("*** a protocol-relative //host is REFUSED *** - it looks like a path and is not",
          _safe_next("//evil.example/steal") is None)
    check("an absolute URL is refused", _safe_next("https://evil.example") is None)
    check("...including one dressed up as a path", _safe_next("http://evil.example/x") is None)
    check("a backslash is refused - some browsers read it as a slash in the authority",
          _safe_next("/\\\\evil.example") is None)
    check("a header-splitting newline is refused", _safe_next("/pair\\nLocation: /x") is None)
    check("a carriage return is refused", _safe_next("/pair\\rLocation: /x") is None)
    check("a relative path with no leading slash is refused", _safe_next("pair.html") is None)
    check("a javascript: url is refused", _safe_next("javascript:alert(1)") is None)
    check("a very long next is truncated rather than passed through whole",
          len(_safe_next("/" + "a" * 5000)) == 300)

    # -----------------------------------------------------------------
    section("*** device keys are kept as a FINGERPRINT, never as the key (2026-10-09) ***")
    # -----------------------------------------------------------------
    # A copy of the database (a backup, an export) used to hold a working, never-expiring login
    # to every adopted screen's account. Now it holds only sha256 fingerprints.
    fstore = SQLiteStore(":memory:")
    fp = fstore.create_screen_pairing("Hall")
    fstore.claim_screen_pairing(fp["code"], "family@example.com")
    _, fkey = fstore.screen_pairing_status(fp["code"], fp["poll_token"])
    with fstore._tx() as cur:
        cur.execute("SELECT key FROM device_keys")
        stored = [r[0] for r in cur.fetchall()]
    check("the screen still gets a working key", bool(fkey) and fkey.startswith("nk_"), str(fkey))
    check("*** THE KEY ITSELF IS NOT IN device_keys ***", fkey not in stored and stored, str(stored))
    check("what is stored is its fingerprint", stored == [SQLiteStore._key_fingerprint(fkey)], str(stored))
    check("...which says what it is", stored[0].startswith("sha256:"), stored[0])
    check("and the key still resolves to the account that claimed it",
          fstore.device_key_user(fkey) == "family@example.com")
    check("*** PRESENTING THE STORED FINGERPRINT AS IF IT WERE A KEY FINDS NOBODY *** - otherwise "
          "hashing would protect nothing", fstore.device_key_user(stored[0]) is None)
    fstore.touch_device_key(fkey)
    check("last seen still updates through the fingerprint",
          bool(fstore.list_device_keys("family@example.com")[0]["last_seen"]))
    fid = fstore.list_device_keys("family@example.com")[0]["id"]
    check("the id to revoke by is the end of the fingerprint, not of the key",
          stored[0].endswith(fid) and not fkey.endswith(fid), fid)
    check("revoking by that id works", fstore.revoke_device_key("family@example.com", fid) is True)
    check("...and the key stops working at once", fstore.device_key_user(fkey) is None)

    section("an OLD key, stored as itself before fingerprints, keeps working and is converted")
    with fstore._tx() as cur:
        cur.execute("INSERT INTO device_keys(key, user_id, label, created_at) VALUES(?,?,?,?)",
                    ("nk_old-screen-key-from-before", "old@example.com", "Old", "2026-10-01T00:00:00Z"))
    check("*** an unconverted old row still lets its screen in *** (a Postgres boot that skipped "
          "migrations must not lock every screen out)",
          fstore.device_key_user("nk_old-screen-key-from-before") == "old@example.com")
    fstore.touch_device_key("nk_old-screen-key-from-before")
    check("...and its last seen updates", bool(fstore.list_device_keys("old@example.com")[0]["last_seen"]))
    n = fstore._hash_device_keys()
    check("converting turns it into its fingerprint", n == 1, str(n))
    with fstore._tx() as cur:
        cur.execute("SELECT key FROM device_keys WHERE user_id='old@example.com'")
        conv = [r[0] for r in cur.fetchall()]
    check("...so the old key is no longer in the table",
          conv == [SQLiteStore._key_fingerprint("nk_old-screen-key-from-before")], str(conv))
    check("*** and the screen that holds it still gets in, with nothing done on the screen ***",
          fstore.device_key_user("nk_old-screen-key-from-before") == "old@example.com")
    check("converting again changes nothing (a boot cut short finishes on the next)",
          fstore._hash_device_keys() == 0)
    check("a key that does not look minted is never matched as itself",
          SQLiteStore._key_forms("sha256:abc") == (SQLiteStore._key_fingerprint("sha256:abc"),))

    section("the conversion runs at boot")
    bdir = tempfile.mkdtemp(prefix="nimrod_keyboot_")
    bpath = os.path.join(bdir, "boot.db")
    b1 = SQLiteStore(bpath)
    with b1._tx() as cur:
        cur.execute("INSERT INTO device_keys(key, user_id, label, created_at) VALUES(?,?,?,?)",
                    ("nk_boot-key", "boot@example.com", "Boot", "2026-10-01T00:00:00Z"))
        # A claimed pairing row two days old, still holding the working key it handed over.
        cur.execute("INSERT INTO screen_pairings(code, label, poll_token, created_at, expires_at, claimed_by, "
                    "claimed_at, device_key) VALUES(?,?,?,?,?,?,?,?)",
                    ("OLDONE", "Boot", "tok", db._later(-3 * 86400), db._later(-3 * 86400 + 600),
                     "boot@example.com", db._later(-2 * 86400), "nk_boot-key"))
    b1._conn.close()
    b2 = SQLiteStore(bpath)
    with b2._tx() as cur:
        cur.execute("SELECT key FROM device_keys")
        after_boot = [r[0] for r in cur.fetchall()]
    check("*** a database opened with old keys in it holds only fingerprints afterwards ***",
          after_boot == [SQLiteStore._key_fingerprint("nk_boot-key")], str(after_boot))
    check("...and the screen still gets in", b2.device_key_user("nk_boot-key") == "boot@example.com")
    with b2._tx() as cur:
        cur.execute("SELECT COUNT(*) FROM screen_pairings WHERE device_key IS NOT NULL")
        left = cur.fetchone()[0]
    check("*** a boot also sweeps a day-old claimed pairing row, the other place a working key sat *** "
          "(the sweep used to run only when somebody asked for a new code)", left == 0, str(left))
    b2._conn.close()
    check("what-we-store says only a scrambled form is kept",
          "scrambled" in {r["table"]: r for r in fstore.describe_storage()["stores"]}["device_keys"]["what"])

    # -----------------------------------------------------------------
    section("*** device keys over HTTP: a screen's own key, and /api/me's `screen` (?pair=key) ***")
    # -----------------------------------------------------------------
    import base64
    import json
    import app as appmod  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
    from itsdangerous import TimestampSigner  # noqa: E402

    def session_cookie(user):
        signer = TimestampSigner(os.environ.get("SESSION_SECRET", "dev-only-insecure-change-me"))
        return signer.sign(base64.b64encode(json.dumps({"user": user}).encode("utf-8"))).decode("utf-8")

    saved_env = os.environ.get("NIMROD_ENV")
    os.environ["NIMROD_ENV"] = "prod"      # read per request by identity.py: no dev stand-in user
    try:
        bare = TestClient(appmod.app)       # the screen, with NO sign-in
        owner = TestClient(appmod.app)      # the owner's phone, signed in
        owner.cookies.set("session", session_cookie("google:owner-1"))
        check("a bare screen is signed out (401), which is what puts ?pair= on the code",
              bare.get("/api/me").status_code == 401)
        r = bare.post("/api/screen-pair/request", json={"label": "Bedroom"})
        req = r.json()
        check("the bare screen may ask for a code", r.status_code == 200 and req.get("code"), r.text)
        r = owner.post("/api/screen-pair/claim", json={"code": req["code"]})
        check("the signed-in owner claims it", r.status_code == 200, r.text)
        r = bare.post("/api/screen-pair/status", json={"code": req["code"], "poll_token": req["poll_token"]})
        hk = r.json().get("device_key", "")
        check("the screen's next poll collects its key", r.json().get("state") == "claimed" and hk.startswith("nk_"))
        KEYH = {"X-Device-Key": hk}
        me = bare.get("/api/me", headers=KEYH)
        check("*** COLD BOOT, KEY AND NO SIGN-IN: the screen is the owner's account ***",
              me.status_code == 200 and me.json()["user"] == "google:owner-1", me.text)
        check("*** ...and /api/me says it was let in by its own key (`screen`) ***", me.json().get("screen") is True)
        check("...and that nobody is signed in on it", me.json().get("signed_in") is False)
        me2 = owner.get("/api/me")
        check("the owner's own sign-in, no key: `screen` is false (what ?pair=key pairs on)",
              me2.status_code == 200 and me2.json().get("screen") is False, me2.text)
        both = TestClient(appmod.app)
        both.cookies.set("session", session_cookie("google:owner-1"))
        me3 = both.get("/api/me", headers=KEYH)
        check("a screen holding its key AND the old sign-in: the key is what let it in", me3.json().get("screen") is True)
        lst = owner.get("/api/screens").json()["screens"]
        check("the owner's account lists the screen, without the key", len(lst) == 1 and hk not in json.dumps(lst), str(lst))
        check("the owner can turn it off", owner.delete(f"/api/screens/{lst[0]['id']}").status_code == 200)
        check("*** and the screen's very next request is signed out ***", bare.get("/api/me", headers=KEYH).status_code == 401)

        section("*** a database blip while checking a key is a 503, not a 401 ***")
        saved_lookup = appmod.store.device_key_user

        def _down(k):
            raise RuntimeError("database not answering")
        import identity  # noqa: E402
        identity.set_device_key_lookup(_down)
        try:
            r = bare.get("/api/me", headers={"X-Device-Key": "nk_any-key"})
            check("*** a screen whose key could not be checked hears 503 (Connecting...), not 401 (signed out) ***",
                  r.status_code == 503, f"{r.status_code} {r.text}")
            check("...and is still let in nowhere", "user" not in r.text)
            check("a request with no key at all is still a plain 401", bare.get("/api/me").status_code == 401)
            check("the owner's sign-in still works while the key lookup is down",
                  both.get("/api/me", headers={"X-Device-Key": "nk_any-key"}).status_code == 200)
        finally:
            identity.set_device_key_lookup(saved_lookup)
    finally:
        if saved_env is None:
            os.environ.pop("NIMROD_ENV", None)
        else:
            os.environ["NIMROD_ENV"] = saved_env

    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
