"""Identity seam.

Today: a stubbed dev user. Because the API is per-user from day one, real auth
(Google OAuth for visitors; a device/kiosk token for a patient's own screen — see
../../docs/architecture.md) plugs in *here* later and nothing downstream changes.
Callers only ever see ``current_user()``.

So multi-user behaviour is testable *before* auth exists, dev mode honours an
``X-Dev-User`` header (or ``?user=`` query). Set ``NIMROD_ENV=prod`` to disable
the override; in prod this function is where the OAuth-verified subject gets
returned instead.
"""
from __future__ import annotations

import os

from fastapi import Request

DEV_USER = "dev-user"


def _allow_override() -> bool:
    return os.environ.get("NIMROD_ENV", "dev") != "prod"


def current_user(request: Request) -> str:
    if _allow_override():
        override = request.headers.get("X-Dev-User") or request.query_params.get("user")
        if override:
            return override.strip()
    return DEV_USER
