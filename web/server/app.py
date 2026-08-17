"""Nimrod platform server — the thin coordination layer.

Slice 2 adds profiles + the two storage kinds (overwrite state with versioning,
append-only events). Still NOT a media or AI server (see ../../DECISIONS.md).

Run from this directory:
    uvicorn app:app --reload --port 8000
Then open http://localhost:8000/.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlparse

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from db import PostgresStore, SQLiteStore
from identity import current_user, optional_user

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")      # ids, module types, state keys, streams
NAME_RE = re.compile(r"^[\w .\-]{1,64}$")          # human profile names + source labels
SOURCE_KINDS = {"agent"}                            # media-source adapters (extensible)

CLIENT_DIR = Path(__file__).resolve().parent.parent / "client"
DB_PATH = os.environ.get("NIMROD_DB", str(Path(__file__).resolve().parent / "nimrod.db"))

# Postgres in deploy (DATABASE_URL, e.g. Neon — durable, external, backed up),
# SQLite for local dev. Same logic runs on both (db._Store). See docs/deploy.md.
DATABASE_URL = os.environ.get("DATABASE_URL")
store = PostgresStore(DATABASE_URL) if DATABASE_URL else SQLiteStore(DB_PATH)
app = FastAPI(title="Nimrod platform server", version="0.2.0")

# --- sessions + Google login (OAuth) ---------------------------------------
# A signed-cookie session carries the logged-in user (and holds the OAuth CSRF
# state during the flow). SESSION_SECRET must be a long random string in prod.
_PROD = os.environ.get("NIMROD_ENV", "dev") == "prod"
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET", "dev-only-insecure-change-me"),
    same_site="lax",          # survives the round-trip back from Google
    https_only=_PROD,
    max_age=60 * 60 * 24 * 30,  # 30 days — a bedside kiosk stays signed in
)

# Google is registered only when its credentials are present, so the app still
# boots (and dev/device-key auth still works) with OAuth unconfigured.
oauth = OAuth()
GOOGLE_OK = bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))
if GOOGLE_OK:
    oauth.register(
        name="google",
        client_id=os.environ["GOOGLE_CLIENT_ID"],
        client_secret=os.environ["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


class ProfileCreate(BaseModel):
    name: str


class ModuleAdd(BaseModel):
    type: str


class StatePut(BaseModel):
    data: dict
    base_version: int = 0


class EventPost(BaseModel):
    kind: str
    data: dict = {}


class SourceCreate(BaseModel):
    label: str
    base_url: str
    kind: str = "agent"


def _check(value: str, rx: re.Pattern, what: str) -> None:
    if not rx.match(value):
        raise HTTPException(status_code=400, detail=f"invalid {what}")


def _clean_base_url(raw: str) -> str:
    """Validate + normalize a media-source base_url. Only http(s) with a host is
    allowed — this URL is fetched by the browser, so file://, javascript:, and
    friends must never round-trip. Returns the URL with any trailing slash stripped."""
    url = (raw or "").strip()
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise HTTPException(status_code=400, detail="invalid base_url (must be http(s)://host)")
    return url.rstrip("/")


def owned_profile(user: str, pid: str) -> dict:
    """Fetch a profile or 404 — the ownership gate for everything under it."""
    profile = store.get_profile(user, pid)
    if profile is None:
        raise HTTPException(status_code=404, detail="no such profile")
    return profile


@app.get("/api/whoami")
def whoami(user: str = Depends(current_user)):
    return {"user": user}


# ---------------------------------------------------------------- profiles
@app.get("/api/profiles")
def list_profiles(user: str = Depends(current_user)):
    return {"profiles": store.list_profiles(user)}


@app.post("/api/profiles")
def create_profile(body: ProfileCreate, user: str = Depends(current_user)):
    _check(body.name, NAME_RE, "profile name")
    return store.create_profile(user, body.name)


@app.get("/api/profiles/{pid}")
def get_profile(pid: str, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    return owned_profile(user, pid)


@app.post("/api/profiles/{pid}/modules")
def add_module(pid: str, body: ModuleAdd, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(body.type, ID_RE, "module type")
    owned_profile(user, pid)
    return store.add_module(pid, body.type)


@app.delete("/api/profiles/{pid}/modules/{mid}")
def remove_module(pid: str, mid: str, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(mid, ID_RE, "module id")
    owned_profile(user, pid)
    store.remove_module(user, pid, mid)
    return {"ok": True}


# ------------------------------------------------------------- media sources
# Per-user registry of connected media folders (each a user-run media agent). The
# server stores only the reference {label, base_url, kind}; the client resolver
# fetches listings + bytes straight from base_url. The server never sees the bytes.
@app.get("/api/media-sources")
def list_sources(user: str = Depends(current_user)):
    return {"sources": store.list_sources(user)}


@app.post("/api/media-sources")
def create_source(body: SourceCreate, user: str = Depends(current_user)):
    _check(body.label, NAME_RE, "source label")
    if body.kind not in SOURCE_KINDS:
        raise HTTPException(status_code=400, detail="invalid source kind")
    base_url = _clean_base_url(body.base_url)
    return store.create_source(user, body.label, base_url, body.kind)


@app.delete("/api/media-sources/{sid}")
def remove_source(sid: str, user: str = Depends(current_user)):
    _check(sid, ID_RE, "source id")
    if not store.remove_source(user, sid):
        raise HTTPException(status_code=404, detail="no such source")
    return {"ok": True}


# ------------------------------------------------- overwrite state (LWW + version)
@app.get("/api/profiles/{pid}/state/{key}")
def get_state(pid: str, key: str, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(key, ID_RE, "state key")
    owned_profile(user, pid)
    return store.get_state(user, pid, key)


@app.put("/api/profiles/{pid}/state/{key}")
def put_state(pid: str, key: str, body: StatePut, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(key, ID_RE, "state key")
    owned_profile(user, pid)
    status, result = store.put_state(user, pid, key, body.data, body.base_version)
    if status == "conflict":
        # Stale write. Hand back the current truth so the client can rebase + retry.
        return JSONResponse(status_code=409, content={"error": "version_conflict", **result})
    return result


# ------------------------------------------------------------ append-only events
@app.get("/api/profiles/{pid}/events/{stream}")
def list_events(pid: str, stream: str, limit: int = 50, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(stream, ID_RE, "event stream")
    owned_profile(user, pid)
    return store.list_events(user, pid, stream, max(1, min(limit, 500)))


@app.post("/api/profiles/{pid}/events/{stream}")
def append_event(pid: str, stream: str, body: EventPost, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(stream, ID_RE, "event stream")
    _check(body.kind, ID_RE, "event kind")
    owned_profile(user, pid)
    return store.append_event(user, pid, stream, body.kind, body.data)


# Serve the client app from the same origin. Registered LAST so /api/* wins.
# --------------------------------------------------------------- auth (login)
# Who am I? The client checks this on boot: 200 -> signed in (mount the dashboard),
# 401 -> show "Sign in with Google". A device key or an OAuth session both satisfy it.
@app.get("/api/me")
def api_me(request: Request, user: str = Depends(current_user)):
    return {"user": user, "email": request.session.get("email"), "google": GOOGLE_OK}


@app.get("/auth/login")
async def auth_login(request: Request):
    if not GOOGLE_OK:
        raise HTTPException(status_code=503, detail="Google login is not configured")
    # OAUTH_REDIRECT_URI is an escape hatch if the proxy-built URL is ever wrong;
    # otherwise build it from the request (needs uvicorn --proxy-headers behind TLS).
    redirect_uri = os.environ.get("OAUTH_REDIRECT_URI") or str(request.url_for("auth_callback"))
    return await oauth.google.authorize_redirect(request, redirect_uri)


@app.get("/auth/callback", name="auth_callback")
async def auth_callback(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception:
        return RedirectResponse(url="/?login=failed")
    info = token.get("userinfo") or {}
    sub = info.get("sub")
    if not sub:
        return RedirectResponse(url="/?login=failed")
    request.session["user"] = f"google:{sub}"   # stable per-Google-account id
    request.session["email"] = info.get("email")
    # Land on HOME: a person who just signed in needs their screens, not a
    # full-screen kiosk they have no way to compose.
    return RedirectResponse(url="/home.html")


@app.get("/auth/logout")
def auth_logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/")


# THE FRONT DOOR. Three surfaces, and "/" picks between the first two:
#   landing.html  public — what Nimrod is, and a way in
#   home.html     signed in — your screens: compose them, then open one
#   kiosk.html    the running screen (also the device-key pairing target, ?key=...)
# Previously "/" went straight to the kiosk, so signing in dropped you on a full-screen
# display with no way to add anything to it. index.html stays the DEV HARNESS, reachable
# at /index.html and unchanged.
@app.get("/")
def root(request: Request):
    if optional_user(request):
        return RedirectResponse(url="/home.html")
    return FileResponse(CLIENT_DIR / "landing.html")


app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="client")
