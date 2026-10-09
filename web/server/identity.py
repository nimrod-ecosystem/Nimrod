"""Identity seam — who is this request?

The API is per-user from day one, so auth plugs in HERE and nothing downstream
changes; callers only ever see ``current_user()``.

Two mechanisms:

- **Device secret** (this slice): a patient's own screen (the kiosk) holds a long
  random secret and sends it as the ``X-Device-Key`` header. ``DEVICE_KEYS`` maps
  ``user:secret`` pairs; a matching secret resolves to that user. This is the
  bedside auth — one secret per device, revocable independently, sent over HTTPS.
  Google OAuth for visitors/caregivers plugs in here later, alongside.

- **Dev override**: so multi-user behavior is testable before real auth, dev mode
  (``NIMROD_ENV`` != ``prod``) honors an ``X-Dev-User`` header or ``?user=`` query.

FAIL CLOSED in prod: with ``NIMROD_ENV=prod``, ONLY a valid device key is accepted —
no override, and no shared default user. A request without a valid key gets 401. A
prod server with no ``DEVICE_KEYS`` configured therefore denies everything (safer than
silently sharing one account).
"""
from __future__ import annotations

import hmac
import os

from fastapi import HTTPException, Request

DEV_USER = "dev-user"


def _is_prod() -> bool:
    return os.environ.get("NIMROD_ENV", "dev") == "prod"


def _device_keys() -> dict[str, str]:
    """Parse ``DEVICE_KEYS`` ("user1:secret1,user2:secret2") into {secret: user}."""
    keys: dict[str, str] = {}
    for pair in os.environ.get("DEVICE_KEYS", "").split(","):
        pair = pair.strip()
        if ":" not in pair:
            continue
        user, secret = pair.split(":", 1)
        user, secret = user.strip(), secret.strip()
        if user and secret:
            keys[secret] = user
    return keys


# Set by the app at import time so this module can resolve DATABASE-BACKED keys without
# importing db (which imports this). A callable rather than the store itself, so a test can
# hand in whatever it likes and the production path stays one line.
_key_lookup = None

# Same shape, for `device_keys.last_seen` — see `set_device_key_touch`'s own docstring for why
# this exists as a second seam rather than folded into `_key_lookup` itself.
_key_touch = None


def set_device_key_lookup(fn) -> None:
    """Install "given a key, which account owns it" - the database half of X-Device-Key."""
    global _key_lookup
    _key_lookup = fn


def set_device_key_touch(fn) -> None:
    """Install "mark this table-backed key as seen just now".

    `MIKE_CHANGE_LIST.md`'s own `§uptime-monitoring` finding: `device_keys.last_seen` exists in
    the schema for exactly this (so a caregiver's screen list can eventually say which one has
    gone quiet), but nothing ever called `touch_device_key` from the one place that authenticates
    a request with one — so the column was frozen at key-creation time, not a live signal.
    A SEPARATE seam from `_key_lookup` rather than one function doing both: the env-var keys
    (checked first, see `_match_device_key`) have no row to touch at all, and a lookup succeeding
    or failing is a different question from whether seeing it succeed should be recorded.
    """
    global _key_touch
    _key_touch = fn


def _match_device_key(provided: str | None) -> str | None:
    """Which account this device key belongs to, or None. See `_resolve_device_key`."""
    return _resolve_device_key(provided)[0]


def _resolve_device_key(provided: str | None) -> tuple[str | None, bool]:
    """(the account this device key belongs to or None, whether the lookup itself FAILED).

    TWO SOURCES, AND THE ENVIRONMENT ONE IS THE OLDER OF THEM.

      DEVICE_KEYS env var   the original. Editable only by whoever has the hosting
                            dashboard, which made unattended screens a founder-only
                            feature. Kept because it works and because a key that does
                            not depend on the database is a genuine last resort if the
                            database is the thing that is broken.
      the device_keys table minted by the screen-pairing flow, so a family can adopt a
                            screen without asking anybody for anything.

    The env var is checked FIRST and deliberately: it is the smaller, more privileged set,
    it needs no query, and it must keep working even if the database is unreachable.

    compare_digest for the env keys because we are iterating over a handful of secrets and
    timing is free to avoid. The table lookup is an indexed primary-key match on the key's
    fingerprint (db.py `_key_fingerprint`), so there is no secret-dependent comparison to time.

    *** "THE LOOKUP FAILED" IS RETURNED, NOT SWALLOWED (2026-10-09). *** A DATABASE HICCUP MUST
    NOT LOOK LIKE A REVOKED SCREEN. The old version returned None here and its comment said the
    request would then "error honestly" - but with no sign-in on the screen, the next stop in prod
    is a 401, and a 401 is exactly "this screen is no longer trusted": the kiosk takes it as
    signed out, and a `?pair=` screen puts up a pairing code while any other one falls to the
    signed-out demo. `current_user` now answers a failed lookup with a 503, which the kiosk reads
    as "Connecting..." and retries - the truth.
    """
    if not provided:
        return (None, False)
    for secret, user in _device_keys().items():
        if hmac.compare_digest(provided, secret):
            return (user, False)
    if _key_lookup is None:
        return (None, False)
    try:
        user = _key_lookup(provided) or None
    except Exception:
        return (None, True)
    if user and _key_touch is not None:
        try:
            _key_touch(provided)
        except Exception:
            # SEEING THE SCREEN DOES NOT DEPEND ON REMEMBERING THAT WE SAW IT. A failed
            # touch must not turn a request that just authenticated successfully into a
            # 401 - the same reasoning as the lookup's own failure above, applied to a
            # write instead of a read.
            pass
    return (user, False)


def _session_user(request: Request) -> str | None:
    # request.session exists only when SessionMiddleware is installed (the app) —
    # guard so unit tests / middleware-less contexts don't crash.
    try:
        return request.session.get("user")
    except (AssertionError, AttributeError):
        return None


def optional_user(request: Request) -> str | None:
    """Who is this, or None — never raises.

    ``current_user`` fails closed with a 401, which is right for the API but wrong for a
    PAGE: the landing page has to render for a stranger. This answers "should I show the
    landing, or send them home?".

    Deliberately does NOT fall back to the dev stub user. If it did, the landing page
    would be unreachable in dev (everyone would look signed in) and so would never get
    tested. An explicit ``?user=``/``X-Dev-User`` in dev still counts, because that is a
    deliberate act of impersonation.
    """
    user = _match_device_key(request.headers.get("X-Device-Key"))
    if user:
        return user
    sess = _session_user(request)
    if sess:
        return sess
    if not _is_prod():
        override = request.headers.get("X-Dev-User") or request.query_params.get("user")
        if override and override.strip():
            return override.strip()
    return None


def via_device_key(request: Request) -> bool:
    """True when THIS request authenticated as an unattended screen (a valid X-Device-Key).

    For the few things a screen may USE but not CHANGE - the account's stored Claude key above all
    (app.py, /api/ai/claude/*). A screen in a shared room can be pressed by anybody who walks past;
    pasting, replacing or removing a paid key is for the account owner's own signed-in device.
    """
    return _match_device_key(request.headers.get("X-Device-Key")) is not None


def signed_in_here(request: Request, user: str) -> bool:
    """True when this browser ALSO carries a signed-in session for the same account `user`.

    Row 2.57 (2026-10-07). A browser that once opened a screen page keeps that screen's key and sends it on
    every request, so `via_device_key` alone cannot tell a care-room screen nobody signs in on from the owner's
    own computer showing a screen page. A sign-in can: somebody typed their way in on this browser. A session
    for a DIFFERENT account than the screen's is not the owner of this one, so it does not count.
    """
    sess = _session_user(request)
    return bool(sess) and sess == user


def current_user(request: Request) -> str:
    # A valid device secret (unattended kiosk) always wins — works in dev + prod.
    user, lookup_failed = _resolve_device_key(request.headers.get("X-Device-Key"))
    if user:
        return user

    # A Google-login session (a regular signed-in user) — works in dev + prod.
    sess = _session_user(request)
    if sess:
        return sess

    # Dev convenience: header/query override, then the stub user.
    if not _is_prod():
        override = request.headers.get("X-Dev-User") or request.query_params.get("user")
        return override.strip() if override else DEV_USER

    # A screen's key could not be checked (the database did not answer): say so, rather than
    # telling the screen it is signed out. See `_resolve_device_key`. Still closed - nothing is served.
    if lookup_failed:
        raise HTTPException(status_code=503, detail="could not check this screen's key just now - try again")

    # Prod with no key and no session: fail closed.
    raise HTTPException(status_code=401, detail="sign in, or provide a valid device key")
