"""Identity seam — who is this request?

The API is per-user from day one, so auth plugs in HERE and nothing downstream
changes; callers only ever see ``current_user()``.

Two mechanisms:

- **Device secret** (this slice): a patient's own screen (the kiosk) holds a long
  random secret and sends it as the ``X-Device-Key`` header. ``DEVICE_KEYS`` maps
  ``user:secret`` pairs; a matching secret resolves to that user. This is the
  bedside auth — one secret per device, revocable independently, sent over HTTPS.
  Google OAuth for visitors/caregivers plugs in here later, alongside.

- **Dev override**: so multi-user behaviour is testable before real auth, dev mode
  (``NIMROD_ENV`` != ``prod``) honours an ``X-Dev-User`` header or ``?user=`` query.

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


def set_device_key_lookup(fn) -> None:
    """Install "given a key, which account owns it" - the database half of X-Device-Key."""
    global _key_lookup
    _key_lookup = fn


def _match_device_key(provided: str | None) -> str | None:
    """Which account this device key belongs to, or None.

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
    timing is free to avoid. The table lookup is an indexed primary-key match on a
    high-entropy secret, where a timing signal would have to leak a hash comparison inside
    the database - not a realistic path, and the alternative is loading every key on every
    request.
    """
    if not provided:
        return None
    for secret, user in _device_keys().items():
        if hmac.compare_digest(provided, secret):
            return user
    if _key_lookup is not None:
        try:
            return _key_lookup(provided) or None
        except Exception:
            # A DATABASE HICCUP MUST NOT LOOK LIKE A REVOKED SCREEN. Returning None here
            # would 401 a bedside kiosk over a blip; falling through leaves it to the
            # session/dev paths, which will also fail, so the request errors honestly
            # rather than telling the screen it is no longer trusted.
            return None
    return None


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


def current_user(request: Request) -> str:
    # A valid device secret (unattended kiosk) always wins — works in dev + prod.
    user = _match_device_key(request.headers.get("X-Device-Key"))
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

    # Prod with no key and no session: fail closed.
    raise HTTPException(status_code=401, detail="sign in, or provide a valid device key")
