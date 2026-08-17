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


def _match_device_key(provided: str | None) -> str | None:
    """Constant-time compare against each configured secret (high-entropy secrets,
    but compare_digest avoids leaking via timing). Returns the user, or None."""
    if not provided:
        return None
    for secret, user in _device_keys().items():
        if hmac.compare_digest(provided, secret):
            return user
    return None


def _session_user(request: Request) -> str | None:
    # request.session exists only when SessionMiddleware is installed (the app) —
    # guard so unit tests / middleware-less contexts don't crash.
    try:
        return request.session.get("user")
    except (AssertionError, AttributeError):
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
