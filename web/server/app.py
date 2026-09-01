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
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlparse

from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from db import PAIR_CODE_LEN, PostgresStore, SQLiteStore, normalize_code, person_scope
from drive import ROLES, Rooms, Tickets, parse_message
from grants import (DEFAULT_TTL_DAYS, GRANT_ROLES, MAX_TTL_DAYS, may_drive,
                    normalize_kind, normalize_role)
from identity import current_user, optional_user, set_device_key_lookup

log = logging.getLogger("nimrod")

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")      # ids, module types, state keys, streams
# "pressgame@2.4". Looser than ID_RE only in allowing the @ and dots a version needs, and
# still a closed shape - this string is read years later to decide whether a missing field
# predates the field or was simply not captured, so free text in it would be useless.
PRODUCER_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}@[A-Za-z0-9._-]{1,24}$")
# Human names: screens, people, devices. \w is Unicode-aware in Python, so accented
# names already worked; APOSTROPHES DID NOT, which meant this panel's own placeholder
# ("the bedside screen") was a name the server refused. Both the typed ' and the curly
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

# The database half of X-Device-Key. Installed here rather than imported inside identity.py,
# because identity must not depend on db - db already depends on the pure rules modules and a
# cycle through the auth layer is the last place anybody wants one.
set_device_key_lookup(store.device_key_user)
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
    # *** THE PROVENANCE COLUMNS SHIPPED WITH NO WAY TO FILL THEM. ***
    # db.append_event has taken these since the migration, and no caller passed one - so every
    # event written through the API was unattributed BY CONSTRUCTION rather than by honesty,
    # which is not what the empty column was supposed to mean.
    #
    # ONLY TWO OF THE SIX ARE HERE, AND THE SPLIT IS THE POINT:
    #   * `session_id` is a join key the client generates. It names a sitting, not a person.
    #   * `producer_version` is which build wrote the row - a fact about SOFTWARE, and the
    #     thing that later tells "this row predates the field" from "this row had the field
    #     and nobody filled it in" (see provenance.py).
    # `principal_id`, `principal_type`, `attested_by` and `attested_at` are CLAIMS ABOUT
    # PEOPLE - "a clinician attested this" is exactly the assertion the CRS-R work turns on -
    # and letting a client post one unchecked would make attestation self-declared. That
    # needs a decided trust model, not a passthrough, so they stay unreachable for now.
    session_id: str | None = None
    producer_version: str | None = None


class SourceCreate(BaseModel):
    label: str
    base_url: str
    kind: str = "agent"
    # Absent means the ACCOUNT'S, which is what every source was before the person layer.
    # Most accounts hold one person and will never set this.
    person_id: str | None = None


class SourceMove(BaseModel):
    # Empty or absent moves a source back to being the account's - it is how you UNDO a
    # narrowing, so it has to be expressible rather than a one-way door.
    person_id: str | None = None


class ScreenPairRequest(BaseModel):
    label: str = "Screen"


class ScreenPairPoll(BaseModel):
    code: str
    poll_token: str


class ScreenPairClaim(BaseModel):
    code: str


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


# Timestamps here MUST match the format db.py writes (`_now()`): UTC, ISO-8601, with the
# same offset suffix. grants.py compares expiry as STRINGS, which is only correct while
# every writer agrees on the format - so both live in one place rather than being spelled
# out at each call site.
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso_in_days(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


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


# ------------------------------------------------------- screen pairing
# HOW A FAMILY ADOPTS A BEDSIDE SCREEN, without anybody having to email us.
#
# A screen that nobody signs into needs a credential of its own - it reboots at 3am and
# has to come back by itself. Until now those credentials lived only in a server
# environment variable, so creating one required the hosting dashboard, so the whole
# unattended-kiosk feature was founder-only.
#
# The dance is the media-agent pairing flow's, proven and deliberately copied.


@app.post("/api/screen-pair/request")
def screen_pair_request(body: ScreenPairRequest, request: Request):
    """UNAUTHENTICATED, and it has to be: the screen has no account yet. That is the whole
    problem it is solving.

    What it can do is therefore tiny - mint a short-lived code that is worthless until a
    signed-in person claims it. No key exists at this point; there is nothing in the row
    to steal."""
    _check(body.label, NAME_RE, "screen name")
    store.sweep_screen_pairings()
    return store.create_screen_pairing(body.label.strip()[:60])


@app.post("/api/screen-pair/status")
def screen_pair_status(body: ScreenPairPoll):
    """Has somebody claimed it yet, and if so here is the key.

    A POST rather than a GET, because the poll token is a secret and secrets do not belong
    in a URL - they land in access logs, proxies and browser history. Same reasoning as the
    drive ticket.

    THE POLL TOKEN IS WHAT MAKES THIS SAFE. The CODE is displayed on a screen in a room, so
    anybody walking past can read it; that is fine for claiming, which needs a sign-in. It
    is NOT fine for collecting. Without the token, whoever glimpsed the code could take the
    key the instant it was minted."""
    _check(body.code, ID_RE, "code")
    state, key = store.screen_pairing_status(body.code.strip().upper(), body.poll_token or "")
    if state == "claimed":
        return {"state": "claimed", "device_key": key}
    return {"state": state}


@app.post("/api/screen-pair/claim")
def screen_pair_claim(body: ScreenPairClaim, user: str = Depends(current_user)):
    """A signed-in person adopts the screen. Requires an account - that IS the security."""
    _check(body.code, ID_RE, "code")
    state, info = store.claim_screen_pairing(body.code.strip().upper(), user)
    if state == "ok":
        return {"ok": True, **(info or {})}
    detail = {
        "unknown": "no such code - check it and try again",
        "expired": "that code has expired; the screen can show a new one",
        "claimed": "that code has already been used",
    }[state]
    raise HTTPException(status_code=404 if state == "unknown" else 409, detail=detail)


@app.get("/api/what-we-store")
def what_we_store():
    """EVERYTHING THIS SERVER HOLDS, generated from the real schema.

    UNAUTHENTICATED ON PURPOSE. A privacy claim you have to sign in to read is a privacy
    claim nobody checks, and the whole value of this one is that it is checkable.

    IT IS GENERATED RATHER THAN WRITTEN because the written version had already gone out of
    date: the landing page said the server holds an email, screen names and a few hundred
    bytes of settings, "that is all of it", while the database had quietly grown a person's
    NAME, append-only event streams, media-source addresses and drive grants. A table with
    no description is reported as undocumented rather than omitted, so this page can only
    ever drift in the direction of admitting more.

    It describes the SHAPE of the storage - table names and what they are for - and returns
    nobody's data.
    """
    return store.describe_storage()


@app.get("/api/screens")
def list_screens(user: str = Depends(current_user)):
    """The screens this account has adopted. NEVER returns the secrets."""
    return {"screens": store.list_device_keys(user)}


@app.delete("/api/screens/{key_id}")
def revoke_screen(key_id: str, user: str = Depends(current_user)):
    """Unadopt a screen. Immediate - the next request it makes is a 401.

    THE ONLY WAY TO TURN A LOST SCREEN OFF, so it matters that it exists before anybody
    has a screen to lose."""
    if not store.revoke_device_key(user, key_id):
        raise HTTPException(status_code=404, detail="no such screen")
    return {"ok": True}


# ------------------------------------------------------------- media sources
# Per-user registry of connected media folders (each a user-run media agent). The
# server stores only the reference {label, base_url, kind}; the client resolver
# fetches listings + bytes straight from base_url. The server never sees the bytes.
@app.get("/api/media-sources")
def list_sources(person_id: str | None = None, user: str = Depends(current_user)):
    """With `person_id`, what THAT PERSON'S screens may use: their own sources plus the
    account-wide ones. Without it, everything the account owns - the management view.

    THE OWNERSHIP CHECK IS NOT DECORATION. Without it this endpoint would take any person
    id and answer, which turns a media list into a way of asking whether a person id is
    real. `owned_person` raises the same 404 for "does not exist" and "not yours", which is
    what keeps the two indistinguishable from outside.
    """
    if person_id:
        _check(person_id, ID_RE, "person id")
        owned_person(user, person_id)
    return {"sources": store.list_sources(user, person_id=person_id)}


@app.post("/api/media-sources")
def create_source(body: SourceCreate, user: str = Depends(current_user)):
    _check(body.label, NAME_RE, "source label")
    if body.kind not in SOURCE_KINDS:
        raise HTTPException(status_code=400, detail="invalid source kind")
    base_url = _clean_base_url(body.base_url)
    # No person means the account's, which is what every source was before this existed.
    pid = (body.person_id or "").strip()
    if pid:
        _check(pid, ID_RE, "person id")
        owned_person(user, pid)
    return store.create_source(user, body.label, base_url, body.kind, person_id=pid or None)


@app.patch("/api/media-sources/{sid}")
def move_source(sid: str, body: SourceMove, user: str = Depends(current_user)):
    """Move a source between "the account's" and "one person's".

    BOTH DIRECTIONS MATTER. Narrowing is the privacy fix - a resident's albums stop being
    on everybody's screens. WIDENING is the commoner mistake: a family photo folder set up
    on one person's screen, which everybody then wants, and which without this is stuck.
    """
    _check(sid, ID_RE, "source id")
    pid = (body.person_id or "").strip()
    if pid:
        _check(pid, ID_RE, "person id")
        owned_person(user, pid)
    if not store.set_source_person(user, sid, pid or None):
        raise HTTPException(status_code=404, detail="no such source")
    return store.get_source(user, sid)


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
    if body.session_id is not None:
        _check(body.session_id, ID_RE, "session id")
    if body.producer_version is not None:
        _check(body.producer_version, PRODUCER_RE, "producer version")
    owned_profile(user, pid)
    return store.append_event(
        user, pid, stream, body.kind, body.data,
        session_id=body.session_id, producer_version=body.producer_version,
    )


class AttestPost(BaseModel):
    # NOTE WHAT IS NOT HERE: there is no `attested_by`. The attester is the signed-in user and
    # nothing else, which is what makes an attestation worth anything - see provenance.py.
    note: str = ""


@app.post("/api/profiles/{pid}/events/{stream}/{event_id}/attest")
def attest_event(pid: str, stream: str, event_id: int, body: AttestPost = AttestPost(),
                 user: str = Depends(current_user)):
    """Vouch for one row. Appends a NEW event citing it; the original is never touched."""
    _check(pid, ID_RE, "profile id")
    _check(stream, ID_RE, "event stream")
    owned_profile(user, pid)
    try:
        return store.attest_event(user, pid, stream, event_id, attester=user, note=body.note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ------------------------------------------------------------- remote drive
# One person's screen, driven from another machine. See drive.py for why this is a relay
# and not WebRTC, and why the socket is opened with a ticket rather than a device key.
_tickets = Tickets()
_rooms = Rooms()


def _person_owner(person_id: str) -> str | None:
    """Which account owns this person, or None. Deliberately NOT scoped to the caller -
    a grantee has to be able to reach a person they do not own."""
    return store.person_owner(person_id)


def _may_drive(user: str, person_id: str) -> bool:
    return may_drive(
        person_id,
        account=user,
        owner=_person_owner(person_id),
        grants=store.grants_on_person(person_id),
        now_iso=_now_iso(),
    )


class GrantCreate(BaseModel):
    subject_id: str
    subject_kind: str = "account"
    label: str = ""
    days: int | None = None          # None -> DEFAULT_TTL_DAYS. 0 -> never expires.
    # WHAT THE GRANT LETS THEM BE, not whether it lets them in. `moderator` by default
    # (Mike), which matches both real cases: somebody helping from another house, and family
    # showing her a video. `participant` is what two people sharing one screen would want.
    # An unknown value normalises rather than 400s - see grants.normalize_role for why a role
    # is treated differently from a subject KIND, which fails closed.
    role: str | None = None


@app.get("/api/drive-roles")
def drive_roles():
    """What a grant may confer. Served so a client renders the choices rather than
    hardcoding them - the same reason the verb vocabulary is not duplicated by hand."""
    return {"roles": list(GRANT_ROLES), "default": normalize_role(None)}


@app.get("/api/people/{person_id}/drive-grants")
def list_drive_grants(person_id: str, user: str = Depends(current_user)):
    """The owner's view: who may drive this person's screens."""
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    return {"grants": store.list_grants(user, person_id)}


@app.post("/api/people/{person_id}/drive-grants")
def create_drive_grant(person_id: str, body: GrantCreate, user: str = Depends(current_user)):
    """Only the OWNER may hand out access to a person's screens."""
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    subject = (body.subject_id or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="who is this for?")
    try:
        kind = normalize_kind(body.subject_kind)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Granting to yourself is not an error worth a stack trace, but it IS a mistake worth
    # naming: it does nothing, and a row that does nothing in a permissions table is a
    # future reader's wasted hour.
    if kind == "account" and subject == user:
        raise HTTPException(status_code=400, detail="you already own these screens")

    days = DEFAULT_TTL_DAYS if body.days is None else int(body.days)
    if days < 0 or days > MAX_TTL_DAYS:
        raise HTTPException(status_code=400, detail=f"days must be 0..{MAX_TTL_DAYS}")
    expires = None if days == 0 else _iso_in_days(days)
    return store.add_grant(user, person_id, kind, subject,
                           label=(body.label or "").strip()[:120], expires_at=expires,
                           role=normalize_role(body.role))


@app.delete("/api/people/{person_id}/drive-grants/{grant_id}")
def revoke_drive_grant(person_id: str, grant_id: str, user: str = Depends(current_user)):
    """EITHER side may end it - the owner takes it back, the grantee hands it back."""
    _check(person_id, ID_RE, "person id")
    _check(grant_id, ID_RE, "grant id")
    gone = store.delete_grant(grant_id, owner_id=user)
    if not gone:
        gone = store.delete_grant(grant_id, subject_id=user)
    if not gone:
        raise HTTPException(status_code=404, detail="no such grant")
    return {"ok": True}


@app.get("/api/drive/shared")
def shared_with_me(user: str = Depends(current_user)):
    """The grantee's view: whose screens may I drive?

    Without this the feature is unusable by the person it was built for - they would have
    to be told a person id out of band. Expired rows are filtered here rather than shown
    greyed out: a list of things that will not work is not a useful list.
    """
    now = _now_iso()
    out = []
    for g in store.grants_for_subject("account", user):
        if g.get("expires_at") and str(g["expires_at"]) <= now:
            continue
        person = store.get_person(g["owner_id"], g["person_id"])
        if not person:
            continue                      # the person was deleted; the row is a tombstone
        out.append({
            "grant_id": g["id"], "person_id": g["person_id"], "name": person["name"],
            "owner_id": g["owner_id"], "label": g["label"], "expires_at": g["expires_at"],
        })
    return {"people": out}


@app.post("/api/drive/ticket/{person_id}")
def drive_ticket(person_id: str, user: str = Depends(current_user)):
    """Trade ordinary HTTP auth for something a browser CAN put on a socket."""
    _check(person_id, ID_RE, "person id")
    # NO LONGER `owned_person`. Owning the person is now one of two ways in; the other is
    # holding a live grant. 403 either way, and the SAME 403 for "no such person" - or this
    # endpoint becomes a way to find out which person ids are real.
    if not _may_drive(user, person_id):
        raise HTTPException(status_code=403, detail="not allowed to drive this person's screens")
    return {"ticket": _tickets.issue(user, person_id), "expires_in": 30}


async def _tell(conns, payload):
    """Send to everyone in a list, dropping any socket that has gone away."""
    dead = []
    for c in list(conns):
        try:
            await c.send_json(payload)
        except Exception:
            dead.append(c)
    return dead


@app.websocket("/api/drive/{person_id}")
async def drive_socket(ws: WebSocket, person_id: str, t: str = "", role: str = "driver"):
    if not ID_RE.match(person_id or "") or role not in ROLES:
        await ws.close(code=4400)
        return
    user = _tickets.redeem(t, person_id)
    if user and not _may_drive(user, person_id):
        # Revoked between buying the ticket and using it. Thirty seconds is a small window
        # and it is not zero, so it is closed here too.
        await ws.close(code=4403)
        return
    if not user:
        # 4401 rather than a generic close, so the client can tell "your ticket went stale,
        # get another" from "the network died" and retry the right one.
        await ws.close(code=4401)
        return

    # THE ROOM IS KEYED BY THE OWNER, NOT BY WHOEVER CONNECTED. An owner's kiosk and a
    # granted clinician's laptop must land in the same room or they will never see each
    # other - which was the entire point of grants.
    room_key = _person_owner(person_id) or user

    await ws.accept()
    _rooms.join(room_key, person_id, role, ws)

    async def announce():
        counts = _rooms.counts(room_key, person_id)
        room = _rooms.get(room_key, person_id)
        if room:
            await _tell(room.screens + room.drivers, {"type": "presence", **counts})

    await announce()
    try:
        while True:
            raw = await ws.receive_json()
            msg = parse_message(raw)
            if msg is None:
                continue                       # unknown verb or shape: dropped, not relayed
            if msg["type"] == "pong":
                await ws.send_json(msg)
                continue
            room = _rooms.get(room_key, person_id)
            if not room:
                continue
            # A driver drives screens. A screen never drives anything - it only reports -
            # so there is no path by which one bedside screen could press another's buttons.
            #
            # A SIGNAL IS THE EXCEPTION, AND IT IS A DELIBERATE ONE. Setting up a call means
            # the callee's ANSWER has to reach the caller, so signalling is the one message
            # that travels both ways. It is safe because it is never turned into a verb or a
            # bus topic at either end - `drive.py` explains the whole argument. It goes to
            # THE OTHER ROLE only: two screens cannot signal each other, and neither can two
            # drivers, so this adds no path between bedside screens.
            if msg["type"] == "signal":
                await _tell(room.drivers if role == "screen" else room.screens, msg)
            elif role == "driver":
                await _tell(room.screens, msg)
    except WebSocketDisconnect:
        pass
    except Exception as exc:                   # a malformed frame must not kill the room
        log.info("drive socket ended: %s", exc)
    finally:
        _rooms.leave(room_key, person_id, role, ws)
        await announce()


# Serve the client app from the same origin. Registered LAST so /api/* wins.
# --------------------------------------------------------------- auth (login)
# Who am I? The client checks this on boot: 200 -> signed in (mount the dashboard),
# 401 -> show "Sign in with Google". A device key or an OAuth session both satisfy it.
@app.get("/api/me")
def api_me(request: Request, user: str = Depends(current_user)):
    return {"user": user, "email": request.session.get("email"), "google": GOOGLE_OK}


def _safe_next(path: str | None) -> str | None:
    """Where to land after signing in, if the caller asked for somewhere specific.

    THIS IS AN OPEN-REDIRECT CHECK and it is the whole reason this is a function. The value
    arrives in a query string and ends up in a Location header, so anything that is not a
    path on THIS site is a way to bounce a freshly signed-in person somewhere else. A
    protocol-relative "//evil.example" is the one that catches people out: it starts with a
    slash and is not a path at all.

    Anything suspicious is dropped rather than rejected — a bad `next` should still sign you
    in, just to the default page."""
    if not path or not path.startswith("/") or path.startswith("//"):
        return None
    # A backslash is treated as a slash by some browsers when parsing authority components.
    if any(c in path for c in ("\\", "\n", "\r")):
        return None
    return path[:300]


@app.get("/auth/login")
async def auth_login(request: Request, next: str | None = None):
    if not GOOGLE_OK:
        raise HTTPException(status_code=503, detail="Google login is not configured")
    # WHERE THE PERSON WAS GOING, remembered across the round trip.
    #
    # Google sends the browser back to /auth/callback, which knows nothing about what the
    # person was in the middle of. Before this, everybody landed on /home.html — fine for
    # somebody who came to sign in, wrong for somebody who scanned a QR code on a bedside
    # screen and was carrying a pairing code: the code was silently dropped and they had to
    # walk back and read it off the screen again.
    #
    # The session is the right place for it (not the OAuth `state`, which authlib owns).
    dest = _safe_next(next)
    if dest:
        request.session["after_login"] = dest
    else:
        request.session.pop("after_login", None)
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
    # Back to whatever they were doing, if they were doing something (see /auth/login).
    # Re-checked here rather than trusted from the session: the check is cheap and a value
    # that only gets validated on the way in is a value somebody will eventually set some
    # other way.
    dest = _safe_next(request.session.pop("after_login", None))
    # Otherwise land on HOME: a person who just signed in needs their screens, not a
    # full-screen kiosk they have no way to compose.
    return RedirectResponse(url=dest or "/home.html")


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
