"""Nimrod platform server — the thin coordination layer.

Slice 2 adds profiles + the two storage kinds (overwrite state with versioning,
append-only events). Still NOT a media or AI server (see ../../DECISIONS.md).

Run from this directory:
    uvicorn app:app --reload --port 8000
Then open http://localhost:8000/.
"""
from __future__ import annotations

import logging
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlparse

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from db import PAIR_CODE_LEN, PostgresStore, SQLiteStore, normalize_code, person_scope
from identity import current_user, optional_user

log = logging.getLogger("nimrod")

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")      # ids, module types, state keys, streams
# Human names: screens, people, devices. \w is Unicode-aware in Python, so accented
# names already worked; APOSTROPHES DID NOT, which meant this panel's own placeholder
# ("Christine's bedside") was a name the server refused. Both the typed ' and the curly
# ’ that every phone and word processor substitutes for it are allowed now, plus the
# comma people put in "Bedside, upstairs". Still no <, >, & or quotes.
NAME_RE = re.compile(r"^[\w .,'’\-]{1,64}$")     # human profile names + source labels
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
    person_id: str = ""


class ProfileMove(BaseModel):
    person_id: str


class PersonCreate(BaseModel):
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


class PairRequest(BaseModel):
    label: str = "Media device"
    base_urls: list[str] = []
    agent_id: str = ""


class PairClaim(BaseModel):
    code: str


# THE ONE PIECE OF SECURITY THAT MAKES A SIX-CHARACTER CODE ACCEPTABLE.
#
# The code space is 30^6 = 729 million, which is only large enough if guessing is slow.
# The attack is not theoretical: a wrong guess that lands on somebody else's live code
# attaches THEIR media agent to the guesser's account, and that agent serves a folder of
# a person's photographs. So wrong guesses are counted and cut off. Right guesses are not
# counted - somebody pairing five devices in a row is not an attacker.
#
# THE ACCOUNT IS THE REAL LIMIT, AND THE IP IS DELIBERATELY LOOSE. Claiming requires a
# signed-in account, so the account is the identity an attacker must actually hold, and it
# is throttled hard. The per-IP limit is a crude second wall against one host grinding
# through codes, and it has to stay generous because EVERY DEVICE IN A CARE FACILITY SHARES
# ONE NAT ADDRESS - a tight IP limit means eight fat-fingered codes from anyone in the
# building locks pairing for everybody else in it. That is a denial of service against the
# exact users this feature exists for, done by our own defence, and it is the sort of thing
# that only shows up when somebody is standing in the building.
#
# HONEST LIMIT, WRITE IT DOWN: this lives in the process. It resets when Render restarts
# the dyno and it does not span workers. It raises the cost of a brute force by orders of
# magnitude, which is what it is for; it is not a distributed rate limiter, and if this
# ever runs multi-worker it belongs in the database.
PAIR_MAX_MISSES = 8              # per ACCOUNT - the identity an attacker must hold
PAIR_MAX_MISSES_IP = 60          # per address - a shared facility NAT must not lock out
PAIR_MISS_WINDOW = 10 * 60
_pair_misses: dict[str, deque] = defaultdict(deque)


def _pair_throttled(key: str, limit: int = PAIR_MAX_MISSES) -> bool:
    hits = _pair_misses[key]
    cutoff = time.monotonic() - PAIR_MISS_WINDOW
    while hits and hits[0] < cutoff:
        hits.popleft()
    return len(hits) >= limit


def _pair_miss(key: str) -> None:
    _pair_misses[key].append(time.monotonic())


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


def owned_person(account: str, person_id: str) -> dict:
    """Fetch a person or 404 - the ownership gate for everything under them."""
    person = store.get_person(account, person_id)
    if person is None:
        raise HTTPException(status_code=404, detail="no such person")
    return person


def owned_profile(user: str, pid: str) -> dict:
    """Fetch a profile or 404 — the ownership gate for everything under it."""
    profile = store.get_profile(user, pid)
    if profile is None:
        raise HTTPException(status_code=404, detail="no such profile")
    return profile


@app.get("/api/healthz")
def healthz():
    """Unauthenticated liveness probe: is the app up AND can it reach the database?

    Deliberately reports only the exception CLASS on failure, never the message — this
    endpoint is public, and a psycopg error text can carry host/DSN detail. The class
    name is enough to tell the two failure modes apart: OperationalError means the
    connection is gone (a suspended/unreachable database), while a ProgrammingError
    means the SQL itself is wrong. Full detail goes to the server log.
    """
    engine = "postgres" if DATABASE_URL else "sqlite"
    try:
        store.ping()
    except Exception as e:                                  # noqa: BLE001 - probe reports every failure
        log.exception("healthz: database unreachable")
        return JSONResponse(status_code=503,
                            content={"ok": False, "db": "down", "engine": engine,
                                     "error": type(e).__name__})
    return {"ok": True, "db": "up", "engine": engine}


@app.get("/api/whoami")
def whoami(user: str = Depends(current_user)):
    return {"user": user}


# ---------------------------------------------------------------- profiles
@app.get("/api/profiles")
def list_profiles(person: str = "", user: str = Depends(current_user)):
    """`?person=<id>` narrows to one person's screens; without it, the whole account's.

    The default stays "everything" so the kiosk's any-screen-will-do fallback and any
    older client keep working; every row names its person either way."""
    store.ensure_default_person(user)
    if person:
        _check(person, ID_RE, "person id")
        owned_person(user, person)
    return {"profiles": store.list_profiles(user, person or None)}


@app.post("/api/profiles")
def create_profile(body: ProfileCreate, user: str = Depends(current_user)):
    _check(body.name, NAME_RE, "profile name")
    # A screen with no person has no answer to "whose is this?", so one is always
    # assigned - the caller's choice, or the account's default person.
    person_id = body.person_id or store.ensure_default_person(user)
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    return store.create_profile(user, body.name, person_id)


@app.get("/api/profiles/{pid}")
def get_profile(pid: str, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    return owned_profile(user, pid)


@app.patch("/api/profiles/{pid}")
def rename_profile(pid: str, body: ProfileCreate, user: str = Depends(current_user)):
    owned_profile(user, pid)
    _check(body.name, NAME_RE, "profile name")
    store.rename_profile(user, pid, body.name)
    return store.get_profile(user, pid)


@app.put("/api/profiles/{pid}/person")
def move_profile(pid: str, body: ProfileMove, user: str = Depends(current_user)):
    """Hand a screen to a different person. The screen keeps its modules and its own
    settings; what changes is whose bindings and whose output routing drive it."""
    _check(pid, ID_RE, "profile id")
    _check(body.person_id, ID_RE, "person id")
    owned_profile(user, pid)
    owned_person(user, body.person_id)
    store.move_profile(user, pid, body.person_id)
    return store.get_profile(user, pid)


@app.delete("/api/profiles/{pid}")
def delete_profile(pid: str, user: str = Depends(current_user)):
    """Remove a screen. Its append-only events SURVIVE by design (see db.delete_profile)."""
    owned_profile(user, pid)
    store.delete_profile(user, pid)
    return {"ok": True}


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


# ------------------------------------------------------------------- pairing
# HOW A DEVICE JOINS AN ACCOUNT WITHOUT ANYBODY TRANSCRIBING A URL.
#
# Before this, connecting a bedside kiosk meant reading an IP address off one machine and
# typing it into a browser on another - an IT task wearing the clothes of a product, and
# the reason the media agent was unusable by the people it exists for. Mike's question was
# "walk me through what someone's grandma has to do", and there was no acceptable answer.
#
# Now: the agent prints six characters, the person types them in, done. Same shape as
# Plex, Chromecast and Tailscale, and none of those make anyone transcribe an address.
#
# THE ADDRESS PROBLEM, AND WHERE IT IS SOLVED. The agent cannot know which of its
# addresses the browser can reach - `localhost` works only when they are the same machine,
# a LAN address only from the same network, and it has no way to test either. The BROWSER
# knows, because it is the thing doing the reaching. So the agent offers CANDIDATES here,
# and the client probes them and keeps the one that answers (see media.js). The server
# never guesses, and "which address do I type" stops existing as a question.
@app.post("/api/pair/request")
def pair_request(body: PairRequest, request: Request):
    """UNAUTHENTICATED, and it has to be: the agent has no account. That is the whole
    problem it is solving.

    What it can do is therefore deliberately tiny - mint a short-lived code that is
    worthless until a signed-in person claims it. It grants nothing, reveals nothing, and
    reaches nothing."""
    _check(body.label, NAME_RE, "device label")
    if body.agent_id:
        _check(body.agent_id, ID_RE, "agent id")
    # Validated here rather than at claim time, so a mistyped --platform or a bad
    # interface guess fails on the machine where somebody can still see the console.
    urls = [_clean_base_url(u) for u in (body.base_urls or [])][:8]
    if not urls:
        raise HTTPException(status_code=400, detail="at least one base_url is required")
    store.sweep_pairings()
    pairing = store.create_pairing(body.agent_id or "", body.label, urls)
    log.info("pairing requested for %r from %s", body.label, request.client.host if request.client else "?")
    return pairing


@app.get("/api/pair/status/{code}")
def pair_status(code: str):
    """The agent polls this to know when to stop showing the code.

    It answers ONE BIT - claimed or not - and never who claimed it. The agent has no
    account and is not entitled to learn whose it just joined; it only needs to know it
    can stop printing six characters at a wall."""
    pairing = store.get_pairing(normalize_code(code))
    if pairing is None:
        return {"claimed": False, "known": False}
    return {"claimed": bool(pairing["claimed_by"]), "known": True}


@app.post("/api/pair/claim")
def pair_claim(body: PairClaim, request: Request, user: str = Depends(current_user)):
    """Signed in, someone types the six characters. This consumes the code and hands back
    the candidate addresses for the CLIENT to probe.

    It deliberately does NOT create the media source. The winning address is whichever one
    the browser can actually reach, the browser is the only thing that can find that out,
    and it already has an endpoint for creating a source. A server that guessed here would
    save a round trip and be wrong at a bedside."""
    code = normalize_code(body.code)
    client_ip = request.client.host if request.client else "?"
    if _pair_throttled(user) or _pair_throttled(f"ip:{client_ip}", PAIR_MAX_MISSES_IP):
        raise HTTPException(status_code=429, detail="too many wrong codes - wait a few minutes")
    if len(code) != PAIR_CODE_LEN:
        raise HTTPException(status_code=400, detail=f"a pairing code is {PAIR_CODE_LEN} characters")

    status, pairing = store.claim_pairing(code, user)
    if status != "ok":
        _pair_miss(user)
        _pair_miss(f"ip:{client_ip}")
        # Three distinct messages, because they send a person to three different places.
        # "Already used" tells them to look for a code that is working; "expired" tells
        # them to restart the agent; "no such code" tells them to check what they typed.
        # Collapsing these into one polite failure is how someone ends up reinstalling
        # something that was never broken.
        detail = {
            "unknown": "we don't have that code - check the characters and try again",
            "expired": "that code has expired - restart the agent to get a new one",
            "claimed": "that code has already been used",
        }[status]
        raise HTTPException(status_code=404 if status == "unknown" else 409, detail=detail)
    return pairing


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


# ------------------------------------------------------- PEOPLE (the person layer)
# Account -> Person -> { Screens, Bindings, Output routing }.  A DEVICE is cross-cutting:
# it is merely where a person is right now, which is why nothing here is keyed by one.
#
# The account is what signs in; the person is who the screen is FOR. Before this, one
# moderator running two residents' screens shared a single set of input bindings between
# them, and "whose screen is this?" had no answer at all.
#
# THE SIMPLIFICATION THAT MAKES IT CHEAP: a SCREEN IMPLIES ITS PERSON. The kiosk is
# already opened as kiosk.html?profile=<id>, so a screen that names its person means the
# kiosk needs no person-selection step - a shared device works with zero device-side UI.
# The picker is only ever needed on the home side, where a moderator chooses who they are
# configuring.
@app.get("/api/people")
def list_people(user: str = Depends(current_user)):
    """Every account has at least one person; this is where a legacy account grows one."""
    store.ensure_default_person(user)
    return {"people": store.list_people(user)}


@app.post("/api/people")
def create_person(body: PersonCreate, user: str = Depends(current_user)):
    _check(body.name, NAME_RE, "person name")
    store.ensure_default_person(user)   # never let the second person be the first
    return store.create_person(user, body.name)


@app.patch("/api/people/{person_id}")
def rename_person(person_id: str, body: PersonCreate, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(body.name, NAME_RE, "person name")
    owned_person(user, person_id)
    store.rename_person(user, person_id, body.name)
    return store.get_person(user, person_id)


@app.delete("/api/people/{person_id}")
def delete_person(person_id: str, user: str = Depends(current_user)):
    """Refuses while they still have screens, and refuses the last person.

    Both refusals are deliberate. Cascading the screens would make deleting a name a way
    to silently destroy someone's whole setup, and an account with no people has no valid
    state at all - every other endpoint would have to invent one back.
    """
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    if len(store.list_people(user)) <= 1:
        raise HTTPException(status_code=409, detail="an account needs at least one person")
    n = store.count_person_screens(user, person_id)
    if n:
        raise HTTPException(
            status_code=409,
            detail="this person still has %d screen%s - move or delete them first"
                   % (n, "" if n == 1 else "s"))
    store.delete_person(user, person_id)
    return {"ok": True}


# ---------------------------------------------- per-PERSON state (not per screen)
# Stored in the ordinary state/events tables under a reserved profile_id (see
# db.person_scope). Real profile ids are 32 hex characters, so a value starting with an
# underscore cannot collide, and neither table has a foreign key to profiles. That is the
# whole trick: the person layer needs exactly one new table (`people`), not three.
#
# WHY IT EXISTS: input bindings above all. "My switch means Primary select, and I need to
# hold it 300ms" is a fact about a BODY. It does not change between someone's bedside
# screen and their living-room screen, and re-entering it per screen is precisely the
# per-device toil this project exists to remove.
@app.get("/api/people/{person_id}/state/{key}")
def get_person_state(person_id: str, key: str, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(key, ID_RE, "state key")
    owned_person(user, person_id)
    return store.get_state(user, person_scope(person_id), key)


@app.put("/api/people/{person_id}/state/{key}")
def put_person_state(person_id: str, key: str, body: StatePut, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(key, ID_RE, "state key")
    owned_person(user, person_id)
    status, result = store.put_state(user, person_scope(person_id), key, body.data, body.base_version)
    if status == "conflict":
        return JSONResponse(status_code=409, content={"error": "version_conflict", **result})
    return result


# The per-person mailbox the `remote` output channel posts into, and that every other
# device of theirs polls. Per person, not per screen, because "tell me on whatever device
# I am near" is a statement about a person and not about a screen.
@app.get("/api/people/{person_id}/events/{stream}")
def list_person_events(person_id: str, stream: str, limit: int = 50, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(stream, ID_RE, "event stream")
    owned_person(user, person_id)
    return store.list_events(user, person_scope(person_id), stream, max(1, min(limit, 500)))


@app.post("/api/people/{person_id}/events/{stream}")
def append_person_event(person_id: str, stream: str, body: EventPost, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(stream, ID_RE, "event stream")
    _check(body.kind, ID_RE, "event kind")
    owned_person(user, person_id)
    return store.append_event(user, person_scope(person_id), stream, body.kind, body.data)


# ------------------------------------------------------- legacy per-USER aliases
# What /api/user-state and /api/user-events meant before people existed. They now resolve
# to the account's DEFAULT person, so a kiosk still running older cached code keeps
# working across the deploy instead of silently losing its bindings until someone
# refreshes it. Delete them once nothing in the wild calls them.
@app.get("/api/user-state/{key}")
def get_user_state(key: str, user: str = Depends(current_user)):
    _check(key, ID_RE, "state key")
    return store.get_state(user, person_scope(store.ensure_default_person(user)), key)


@app.put("/api/user-state/{key}")
def put_user_state(key: str, body: StatePut, user: str = Depends(current_user)):
    _check(key, ID_RE, "state key")
    scope = person_scope(store.ensure_default_person(user))
    status, result = store.put_state(user, scope, key, body.data, body.base_version)
    if status == "conflict":
        return JSONResponse(status_code=409, content={"error": "version_conflict", **result})
    return result


@app.get("/api/user-events/{stream}")
def list_user_events(stream: str, limit: int = 50, user: str = Depends(current_user)):
    _check(stream, ID_RE, "event stream")
    return store.list_events(user, person_scope(store.ensure_default_person(user)), stream, limit)


@app.post("/api/user-events/{stream}")
def append_user_event(stream: str, body: EventPost, user: str = Depends(current_user)):
    _check(stream, ID_RE, "event stream")
    return store.append_event(user, person_scope(store.ensure_default_person(user)),
                              stream, body.kind, body.data)


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


# Make the browser REVALIDATE code and pages instead of guessing.
# StaticFiles sends ETag + Last-Modified but no Cache-Control, so a browser applies
# heuristic freshness and can keep serving a cached ES module after a deploy — the page
# looks unchanged and the old module quietly keeps running. That is expensive to diagnose
# (it cost a chunk of one night) and much worse on a kiosk that stays open for weeks.
# `no-cache` does NOT mean "don't cache": it means "ask first", which with an ETag is a
# cheap 304 when nothing changed. Media keeps normal caching — those bytes are immutable
# and big.
CODE_TYPES = ('.html', '.js', '.css', '.json')


@app.middleware("http")
async def revalidate_code(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.endswith(CODE_TYPES) or path.endswith('/'):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="client")
