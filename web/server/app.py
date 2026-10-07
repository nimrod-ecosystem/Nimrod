"""Nimrod platform server — the thin coordination layer.

Slice 2 adds profiles + the two storage kinds (overwrite state with versioning,
append-only events). Still NOT a media or AI server (see ../../DECISIONS.md).

Run from this directory:
    uvicorn app:app --reload --port 8000
Then open http://localhost:8000/.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlparse

import asyncio

from authlib.integrations.starlette_client import OAuth
from fastapi import Body, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from db import PAIR_CODE_LEN, PostgresStore, SQLiteStore, normalize_code, person_scope
from drive import ROLES, Answerers, Rooms, Tickets, parse_message, stamp_signal
from push import PushHub, StreamTickets
from grants import (DEFAULT_TTL_DAYS, GRANT_ROLES, MAX_TTL_DAYS, may_drive,
                    normalize_kind, normalize_role)
from identity import current_user, optional_user, set_device_key_lookup, set_device_key_touch, via_device_key
import claims
import claude_ai
import links
import notes
import pack_reviews
import page_visits
import recommend
from version import deploy_commit, safe_code_version

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

# Postgres in deploy (DATABASE_URL, Render's own managed Postgres — durable, external,
# backed up), SQLite for local dev. Same logic runs on both (db._Store). See docs/deploy.md.
DATABASE_URL = os.environ.get("DATABASE_URL")
store = PostgresStore(DATABASE_URL) if DATABASE_URL else SQLiteStore(DB_PATH)

# The database half of X-Device-Key. Installed here rather than imported inside identity.py,
# because identity must not depend on db - db already depends on the pure rules modules and a
# cycle through the auth layer is the last place anybody wants one.
set_device_key_lookup(store.device_key_user)
# `device_keys.last_seen`, kept live rather than frozen at creation — MIKE_CHANGE_LIST.md's own
# `§uptime-monitoring` finding, the prerequisite for a screen list ever being able to say which
# one has gone quiet.
set_device_key_touch(store.touch_device_key)
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
        # *** `openid` ALONE. Decided 2026-08-27. ***
        #
        # The subject id is the whole of what the account system needs: it says "this is the
        # same person who signed in last time" and nothing else. The name a screen displays is
        # typed in by whoever set it up, and the email was never read for anything.
        #
        # Asking for less is the point rather than a side effect. It is what supports the
        # strongest sentence on the public page — *Google tells me you are the same person who
        # signed in last time, and nothing else* — and a claim like that is only worth making
        # if the consent screen agrees with it.
        #
        # `request.session["email"]` therefore goes empty for new sign-ins. Nothing reads it
        # except `/api/me`, which reports it for display and already tolerates None.
        client_kwargs={"scope": "openid"},
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
# exact users this feature exists for, done by our own defense, and it is the sort of thing
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


# WHAT VERSION OF THE SITE THIS IS (2026-10-04, version.py says why it is a hash of the client code and
# not the commit). Computed ONCE, at startup: a deploy is a new process, so a new deploy is a new value.
SITE_VERSION = safe_code_version(CLIENT_DIR)
DEPLOY_COMMIT = deploy_commit()


@app.get("/api/version")
def site_version(request: Request):
    """Unauthenticated, tiny and cacheable: every screen polls it (client: version_watch.js).

    Public on purpose - a screen that has lost its sign-in still needs to pick up the fix for that -
    and it says nothing a visitor cannot already read: the repo is public. An ETag lets a poll that
    finds nothing new cost a 304 with no body; `no-cache` makes the browser ask rather than guess.
    """
    etag = f'"{SITE_VERSION}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    asked = [t.strip().removeprefix("W/") for t in (request.headers.get("if-none-match") or "").split(",")]
    if etag in asked or "*" in asked:
        return Response(status_code=304, headers=headers)
    return JSONResponse({"version": SITE_VERSION, "commit": DEPLOY_COMMIT}, headers=headers)


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
def put_state(pid: str, key: str, body: StatePut, request: Request, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(key, ID_RE, "state key")
    owned_profile(user, pid)
    status, result = store.put_state(user, pid, key, body.data, body.base_version)
    if status == "conflict":
        # Stale write, rejected — nothing actually changed, so nobody is told it did.
        # Hand back the current truth so the client can rebase + retry.
        return JSONResponse(status_code=409, content={"error": "version_conflict", **result})
    # request.url.path is exactly the GET this same data lives at — self-referential on
    # purpose, so this can never drift out of sync with the URL a poller actually uses.
    _push.publish(user, request.url.path)
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
def list_people(viewer: str = "", user: str = Depends(current_user)):
    """Every account has at least one person; this is where a legacy account grows one.

    Each row is as THIS account knows them (2026-10-04 night, claims.py): `name` is what you see - your
    "I call them" for somebody whose profile lives on another login, else their own name - and the rest says
    what the row is to you (`kind`), where a call or a message for them goes (`reach`), and, for somebody you
    are connected with, who it came through (`from`) and whether they may leave messages for your people.
    Names only: no account id is in it.

    `viewer` (2026-10-05, claims.seen_name): the person on this login the page is FOR. Given, `name` is what THEY
    see - their own label, else the login's, else the name on the card; their own card is named by the name on
    it - and each row carries `viewer_call_name`. *** Only one of this login's own people may be the viewer: any
    other id is the same 404 as no such person (a security invariant - a person's labels are read for nobody
    else). *** Left out, every name is the login's, as before (screens' menus, notes, the call page)."""
    store.ensure_default_person(user)
    if viewer:
        _check(viewer, ID_RE, "person id")
        if store.person_owner(viewer) != user:
            raise HTTPException(status_code=404, detail="no such person")
    return {"people": _people_view(user, viewer or None)}


def _people_view(user: str, viewer: str | None = None) -> list[dict]:
    rows = store.people_rows(user)
    if not rows:
        return []
    first = rows[0]["id"]
    labels = store.person_labels(user, viewer) if viewer else {}
    screens = store.screens_by_person(user)
    held = store.holder_counts(user)
    per_link: dict[str, int] = {}
    for r in rows:
        if r["link_id"]:
            per_link[r["link_id"]] = per_link.get(r["link_id"], 0) + 1
    names: dict[str, str] = {}
    firsts: dict[str, str | None] = {}
    out = []
    for r in rows:
        source = store.person_row(r["source_id"]) if r["source_id"] else None
        other = source["account_id"] if source and source["account_id"] != user else None
        if other and other not in firsts:
            firsts[other] = store.first_person_id(other)
        kind = claims.row_kind(r, first_person_id=first,
                               source_is_their_first=bool(other and source["id"] == firsts.get(other)))
        v = {"id": r["id"], "created_at": r["created_at"],
             "name": claims.seen_name(r, r["home_name"], viewer_id=viewer, own_label=labels.get(r["id"])),
             "home": not r["home_id"], "kind": kind,
             "reach": claims.reach_id(r, own_screens=screens.get(r["id"], 0)),
             # "I call them" on ANY card (2026-10-05), and the name on the card beside it.
             "call_name": r["call_name"] or "",
             "profile_name": claims.profile_name(r, r["home_name"] if r["home_id"] else None)}
        if viewer:
            # ...and the viewer's own label for it. Neither label rides on the viewer's own card: no window there
            # shows one, and the page for somebody carries no name anybody gave them.
            v["viewer_call_name"] = "" if r["id"] == viewer else labels.get(r["id"], "")
            if r["id"] == viewer:
                v["call_name"] = ""
        if other and r["link_id"]:
            link = store.get_link(user, other)
            if link and links.link_is_active(link) and link["id"] == r["link_id"]:
                if other not in names:
                    names[other] = _inviter_name(other)
                v.update({"linked": True, "from": names[other],
                          "messages_from_them": store.link_messages(link["id"], user, other)})
        if r["home_id"]:
            # "See their page": '' when it opens for you, else why not (page_visits.REFUSAL_TEXT's codes).
            v["page"] = _visit_check(user, r)[0]
            # "Remove just this card": '' when it may, else why not (claims.remove_card_refusal's codes).
            v["remove"] = claims.remove_card_refusal(actor=user, row=r, first_person_id=first,
                                                     screens=screens.get(r["id"], 0),
                                                     link_rows=per_link.get(r["link_id"], 0))
        else:
            # "Shared with": how many other logins hold this profile you look after (the names: GET .../holders).
            v["holders"] = held.get(r["id"], 0)
        out.append(v)
    return out


# ------------------------------------------------- SOMEBODY'S PAGE, AS A VISITOR SEES IT (page_visits.py)
# Mike, 2026-10-04 (night), items 7-9: who can see your page is the people you are connected with plus a setting,
# and which parts they see is yours to open (by default your card and nothing more). The rules are page_visits.py
# (pure, test_page_visits.py). Every answer here is reached through a row on the VISITOR's own page (their card for
# that person) and is filtered on the server, part by part and field by field - never by trusting the client.
def _visit_check(user: str, row: dict | None) -> tuple[str, dict | None, dict]:
    """(why not - '' if they may | 'missing' | 'yours' | page_visits' codes, the profile's home row, its page)."""
    if not row or row.get("account_id") != user:
        return "missing", None, {}
    if not row.get("home_id"):
        return "yours", None, {}
    home = store.person_row(row["home_id"])
    if not home:
        return "missing", None, {}
    owner = home["account_id"]
    if owner == user:
        return "yours", home, {}
    doc = store.get_state(owner, person_scope(home["id"]), page_visits.PAGE_KEY).get("data") or {}
    linked = links.linked(store.get_link(user, owner), user, owner)
    rows = set(store.rows_through(owner, user)) if page_visits.who_of(doc) == "picked" else set()
    return page_visits.page_refusal(doc, linked=linked, visitor_rows=rows), home, doc


@app.get("/api/people/{person_id}/visit")
def visit_page(person_id: str, user: str = Depends(current_user)):
    """"See their page": the page of the person behind one of YOUR cards, showing only what they opened to you.
    Not yours to see: 403, in words. Not a card of yours: the same 404 as no such person."""
    _check(person_id, ID_RE, "person id")
    row = store.person_row(person_id)
    reason, home, doc = _visit_check(user, row)
    if reason == "missing":
        raise HTTPException(status_code=404, detail="no such person")
    name = (home or {}).get("name") or (row or {}).get("name") or ""
    if reason:
        return JSONResponse(status_code=409 if reason == "yours" else 403,
                            content={"error": reason, "text": page_visits.refusal_text(reason, claims.display_name(row, name))})
    return {"name": name, "call_name": row.get("call_name") or "", "sections": page_visits.visitor_view(doc),
            "theme": page_visits.visitor_theme(doc)}


@app.post("/api/people")
def create_person(body: PersonCreate, user: str = Depends(current_user)):
    _check(body.name, NAME_RE, "person name")
    store.ensure_default_person(user)   # never let the second person be the first
    return store.create_person(user, body.name)


@app.patch("/api/people/{person_id}")
def rename_person(person_id: str, body: PersonCreate, user: str = Depends(current_user)):
    """A profile's name is changed by the account that looks after it. Somebody whose profile lives on their
    own login keeps the name they chose; you set what YOU call them instead (PUT .../call-name)."""
    _check(person_id, ID_RE, "person id")
    _check(body.name, NAME_RE, "person name")
    owned_person(user, person_id)
    row = store.person_row(person_id)
    if row and row.get("home_id"):
        raise HTTPException(status_code=403,
                            detail="They look after their own name now. You can change what you call them.")
    store.rename_person(user, person_id, body.name)
    return store.get_person(user, person_id)


class CallNamePut(BaseModel):
    name: str = ""
    # 2026-10-05: '' sets the login's label (everyone on the login sees it, as before); a person id on this login
    # sets THAT person's own label, shown only while the page is for them (claims.seen_name).
    viewer: str = ""


@app.put("/api/people/{person_id}/call-name")
def put_call_name(person_id: str, body: CallNamePut, user: str = Depends(current_user)):
    """"I call them": your own name for one of the people on your page - any of them, at any time (Mike,
    2026-10-05), including somebody you made yourself, where it is your private label beside the name on their
    card. Empty: the name on their card shows again. It never changes that name, and only your login sees it
    (claims.profile_name is what every other login reads).

    With `viewer` (Mike, 2026-10-05: "an option to set I call them at account vs user levels"): the label is that
    person's own - both must be people on this login (else 404, as for no such person), and not the same person
    (400: nobody labels their own card). The login's label is left as it is, and the other way round."""
    _check(person_id, ID_RE, "person id")
    row = store.person_row(person_id)
    if not row or row["account_id"] != user:
        raise HTTPException(status_code=404, detail="no such person")
    viewer = (body.viewer or "").strip()
    if viewer:
        _check(viewer, ID_RE, "person id")
        if store.person_owner(viewer) != user:
            raise HTTPException(status_code=404, detail="no such person")
        if viewer == person_id:
            raise HTTPException(status_code=400, detail="Your own card shows the name on it.")
    name = re.sub(r"\s+", " ", body.name or "").strip()
    if name:
        _check(name, NAME_RE, "name")
    if viewer:
        store.set_person_label(user, viewer, person_id, name)
    else:
        store.set_call_name(user, person_id, name)
    fresh = store.person_row(person_id) or {}
    home = store.person_row(fresh["home_id"]) if fresh.get("home_id") else None
    own = store.person_labels(user, viewer).get(person_id, "") if viewer else ""
    out = {"id": person_id, "call_name": fresh.get("call_name") or "",
           "name": claims.seen_name(fresh, home["name"] if home else None, viewer_id=viewer or None, own_label=own)}
    if viewer:
        out["viewer_call_name"] = own
    return out


@app.delete("/api/people/{person_id}")
def delete_person(person_id: str, user: str = Depends(current_user)):
    """Refuses while they still have screens, and refuses the last person.

    Both refusals are deliberate. Cascading the screens would make deleting a name a way
    to silently destroy someone's whole setup, and an account with no people has no valid
    state at all - every other endpoint would have to invent one back.

    A profile other logins hold too: their rows stay, as their own (db.delete_person says why)."""
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
    # A card a connection put here goes the same way as "Remove just this card" (claims.LAST_CARD_STAYS: the last
    # card from a connection stays, so the connection can still be seen and ended from this page).
    row = store.person_row(person_id) or {}
    if row.get("home_id") and row.get("made_by") == "link" and \
            claims.holder_refusal(row, link_rows=store.count_link_rows(user, row.get("link_id"))) == "last":
        raise HTTPException(status_code=409, detail=claims.REFUSAL_TEXT["last-here"])
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
def _person_state_target(user: str, person_id: str, key: str, *, write: bool) -> tuple[str, str]:
    """(account, person) whose row person state `key` lives in, for `user` reaching it through `person_id`.

    Only through a row on your own account (claims.state_target - a security invariant). The PROFILE keys
    (picture, page) of somebody whose profile lives on another login are read from that home, and are theirs
    alone to write: 403, in words, rather than a pretend save. Everything else - bindings, routing, who may
    leave notes - is your own row's, as it always was."""
    row = store.person_row(person_id)
    home = store.person_row(row["home_id"]) if row and row.get("home_id") and row["account_id"] == user else None
    t = claims.state_target(key, actor=user, row=row, home=home, write=write)
    if t == "profile":
        raise HTTPException(status_code=403,
                            detail="They look after their own picture and page now, on their own login.")
    if t == "missing":
        raise HTTPException(status_code=404, detail="no such person")
    return t


@app.get("/api/people/{person_id}/state/{key}")
def get_person_state(person_id: str, key: str, request: Request, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(key, ID_RE, "state key")
    acct, pid = _person_state_target(user, person_id, key, write=False)
    got = store.get_state(acct, person_scope(pid), key)
    # SOMEBODY ELSE'S PAGE, read from a phone or computer through a card that reads it from their home (a person
    # who took over one you made - claims.READ_THROUGH_CLAIM): that is a visit, and gets only what a visit gets
    # (page_visits.py). A SCREEN reading it through that card gets the whole page: that card's screens are the
    # person's own, in their room, set up for them - the same page they see on their own login.
    if key == page_visits.PAGE_KEY and acct != user and not via_device_key(request):
        reason, _home, _doc = _visit_check(user, store.person_row(person_id))
        doc = got.get("data") or {}
        data = {"sections": page_visits.card_only() if reason else page_visits.visitor_view(doc)}
        # "Colours for my page" (2026-10-05) goes with the page when it is open to them, never with the card alone.
        if not reason and page_visits.visitor_theme(doc):
            data["theme"] = page_visits.visitor_theme(doc)
        got = {"data": data, "version": got.get("version", 0)}
    return got


@app.put("/api/people/{person_id}/state/{key}")
def put_person_state(person_id: str, key: str, body: StatePut, request: Request,
                      user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(key, ID_RE, "state key")
    acct, pid = _person_state_target(user, person_id, key, write=True)
    status, result = store.put_state(acct, person_scope(pid), key, body.data, body.base_version)
    if status == "conflict":
        return JSONResponse(status_code=409, content={"error": "version_conflict", **result})
    _push.publish(acct, request.url.path)
    # A profile key: every login that holds this profile reads it through its own row - tell each.
    if key in claims.PROFILE_KEYS:
        for h in store.holders_of(pid):
            _push.publish(h["account_id"], f"/api/people/{h['id']}/state/{key}")
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
def append_person_event(person_id: str, stream: str, body: EventPost, request: Request,
                        user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(stream, ID_RE, "event stream")
    _check(body.kind, ID_RE, "event kind")
    owned_person(user, person_id)
    result = store.append_event(user, person_scope(person_id), stream, body.kind, body.data)
    # request.url.path is exactly the GET this same data lives at — self-referential on
    # purpose, so this can never drift out of sync with the URL a poller actually uses.
    _push.publish(user, request.url.path)
    return result


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
def append_user_event(stream: str, body: EventPost, request: Request,
                      user: str = Depends(current_user)):
    _check(stream, ID_RE, "event stream")
    result = store.append_event(user, person_scope(store.ensure_default_person(user)),
                                stream, body.kind, body.data)
    # Found 2026-09-17: this alias never published at all, so the kiosk's own mailbox
    # channel (defaultChannels' `events`, see kiosk.js) was one of the few remaining
    # state/events handles still stuck on the raw poll interval regardless of whether
    # push was up. Same self-referential path as append_event above.
    _push.publish(user, request.url.path)
    return result


# ------------------------------------------------------------ append-only events
@app.get("/api/profiles/{pid}/events/{stream}")
def list_events(pid: str, stream: str, limit: int = 50, user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(stream, ID_RE, "event stream")
    owned_profile(user, pid)
    return store.list_events(user, pid, stream, max(1, min(limit, 500)))


@app.post("/api/profiles/{pid}/events/{stream}")
def append_event(pid: str, stream: str, body: EventPost, request: Request,
                 user: str = Depends(current_user)):
    _check(pid, ID_RE, "profile id")
    _check(stream, ID_RE, "event stream")
    _check(body.kind, ID_RE, "event kind")
    if body.session_id is not None:
        _check(body.session_id, ID_RE, "session id")
    if body.producer_version is not None:
        _check(body.producer_version, PRODUCER_RE, "producer version")
    owned_profile(user, pid)
    result = store.append_event(
        user, pid, stream, body.kind, body.data,
        session_id=body.session_id, producer_version=body.producer_version,
    )
    # request.url.path is exactly the GET this same data lives at — self-referential on
    # purpose, so this can never drift out of sync with the URL a poller actually uses.
    _push.publish(user, request.url.path)
    return result


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
_answerers = Answerers()        # one answering screen per intercom or family-call offer (drive.py, row 2.44)


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
    # An unknown value normalizes rather than 400s - see grants.normalize_role for why a role
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
    grayed out: a list of things that will not work is not a useful list.
    """
    now = _now_iso()
    out = []
    for g in store.grants_for_subject("account", user):
        if g.get("expires_at") and str(g["expires_at"]) <= now:
            continue
        # The name on their card, never what the owner calls them ("I call them" is the owner's alone).
        person = store.get_person(g["owner_id"], g["person_id"], profile=True)
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
            arb_key = (room_key, person_id)
            if msg["type"] == "claim":
                # A SCREEN asks to be the one that answers (drive.py Answerers). A driver cannot
                # claim anything. The losers are told in the same turn as the winner, so a screen
                # that somehow has a microphone open for this offer closes it on that one message.
                if role != "screen":
                    continue
                won, newly = _answerers.claim(arb_key, msg["purpose"], msg["session"], ws)
                if newly:
                    await _tell([c for c in room.screens if c is not ws],
                                {"type": "answerer", "purpose": msg["purpose"], "session": msg["session"], "you": False})
                await ws.send_json({"type": "answerer", "purpose": msg["purpose"], "session": msg["session"], "you": won})
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
                # `by` = the account this socket's ticket was issued to, stamped here so a room can
                # trust who sent it (the intercom's approved list, row 2.44). drive.py stamp_signal.
                sig = msg["signal"]
                if role == "screen":
                    # Only the chosen screen's signals reach the phone (drive.py Answerers). `newly`: this
                    # signal decided the offer (an unclaimed answer, or a refusal first), so the other
                    # screens are told no - a family call still ringing on them stops.
                    relay, newly = _answerers.screen_signal(arb_key, sig, ws)
                    if newly:
                        await _tell([c for c in room.screens if c is not ws],
                                    {"type": "answerer", "purpose": sig.get("purpose"), "session": sig.get("session"), "you": False})
                    if relay:
                        await _tell(room.drivers, stamp_signal(msg, user))
                else:
                    _answerers.driver_signal(arb_key, sig)
                    await _tell(room.screens, stamp_signal(msg, user))
            elif role == "driver":
                await _tell(room.screens, msg)
    except WebSocketDisconnect:
        pass
    except Exception as exc:                   # a malformed frame must not kill the room
        log.info("drive socket ended: %s", exc)
    finally:
        _rooms.leave(room_key, person_id, role, ws)
        if role == "screen":
            _answerers.left((room_key, person_id), ws)
        await announce()


# ------------------------------------------------- a note left from another account
# Mike, 2026-10-01: a visitor CAN leave the "note from someone" from their own account. The
# rule (owner, or a live drive grant AND the owner's tick) is pure and lives in notes.py, with
# the argument for it. These routes reach ONE thing: the note streams of a screen that belongs
# to the person. Append and read only - there is no edit and no delete, because the note's
# history is the note. Every refusal for "not allowed" and "no such person" is the SAME 403, so
# this cannot be used to find out which person ids are real.
_note_limit = notes.RateLimit()

# A display name lives in the ordinary state table under a reserved scope, like per-person
# rows do (db.person_scope). Real profile ids are 32 hex characters, so `_account` cannot
# collide; it is one small row, and only for an account that chose to set a name.
ACCOUNT_SCOPE = "_account"
DISPLAY_NAME_KEY = "display-name"


def _display_name(account: str) -> str:
    try:
        v = (store.get_state(account, ACCOUNT_SCOPE, DISPLAY_NAME_KEY).get("data") or {}).get("name")
        return notes.clean_display_name(v)
    except ValueError:
        return ""


def _note_gate(user: str, person_id: str) -> str:
    """The owner's account if `user` may leave notes for this person, else the one 403."""
    _check(person_id, ID_RE, "person id")
    owner = _person_owner(person_id)
    row = (store.get_state(owner, person_scope(person_id), notes.PERSON_ROW_KEY).get("data")
           if owner else None)
    # The second way in (notes.py): a links.py `messages` permission - made by an invitation (claims.py).
    linked_ok = bool(owner) and owner != user and store.may_capability("messages", actor=user, person_id=person_id)
    if not notes.may_leave_note(person_id, account=user, owner=owner,
                                grants=store.grants_on_person(person_id) if owner else [],
                                writers=notes.writers_from(row), now_iso=_now_iso(), messages=linked_ok):
        raise HTTPException(status_code=403, detail="not allowed to leave notes for this person")
    return owner


def _note_screen(owner: str, person_id: str, pid: str, stream: str) -> dict:
    """The screen, if it is THIS person's; 404 otherwise (another person's, another account's)."""
    _check(pid, ID_RE, "profile id")
    if stream not in notes.NOTE_STREAMS:
        raise HTTPException(status_code=400, detail="only a note can be left here")
    profile = store.get_profile(owner, pid)
    if profile is None or profile.get("person_id") != person_id:
        raise HTTPException(status_code=404, detail="no such screen")
    return profile


class DisplayNamePut(BaseModel):
    name: str = ""


@app.put("/api/me/display-name")
def put_display_name(body: DisplayNamePut, user: str = Depends(current_user)):
    """The name your notes are signed with. Empty clears it, and your notes say "Someone"."""
    try:
        name = notes.clean_display_name(body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    cur = store.get_state(user, ACCOUNT_SCOPE, DISPLAY_NAME_KEY)
    store.put_state(user, ACCOUNT_SCOPE, DISPLAY_NAME_KEY, {"name": name}, cur.get("version", 0))
    return {"display_name": name}


@app.get("/api/people/{person_id}/notes/screens")
def note_screens(person_id: str, user: str = Depends(current_user)):
    """Which of this person's screens a note can be left on - names and ids only."""
    owner = _note_gate(user, person_id)
    out = []
    for p in store.list_profiles(owner, person_id):
        full = store.get_profile(owner, p["id"]) or {}
        out.append({"id": p["id"], "name": p["name"],
                    "has_note": any(m.get("type") == "note" for m in full.get("modules", []))})
    return {"screens": out}


@app.get("/api/people/{person_id}/notes/history")
def note_history(person_id: str, before: int | None = None, limit: int = notes.HISTORY_PAGE,
                 user: str = Depends(current_user)):
    """"See older messages": every note left on this person's screens, newest first, a page at a time
    (notes.history_entry says what is listed). THE PERSON'S OWN: only the login that holds them (owned_person - the
    same 404 for not yours and no such person). `next` is the `before` that brings the page after this one."""
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    names = {s["id"]: s["name"] for s in store.list_profiles(user, person_id)}
    want = max(1, min(int(limit), notes.HISTORY_MAX))
    out: list[dict] = []
    cursor = before
    while len(out) <= want:
        chunk = store.events_before(user, list(names), notes.NOTE_STREAMS, notes.NOTE_KIND, before=cursor, limit=100)
        for e in chunk:
            cursor = e["id"]
            h = notes.history_entry(e, names.get(e["profile_id"], ""))
            if h:
                out.append(h)
                if len(out) > want:
                    break
        if len(chunk) < 100:
            break
    more = len(out) > want
    out = out[:want]
    return {"messages": out, "more": more, "next": out[-1]["id"] if more and out else None}


@app.get("/api/people/{person_id}/notes/{pid}/{stream}")
def list_person_notes(person_id: str, pid: str, stream: str, limit: int = 50,
                      user: str = Depends(current_user)):
    """The note and its history, as the screen shows them - no account ids."""
    owner = _note_gate(user, person_id)
    _note_screen(owner, person_id, pid, stream)
    got = store.list_events(owner, pid, stream, max(1, min(limit, 200)))
    return {"events": [notes.visible_row(e) for e in got["events"] if e.get("kind") == notes.NOTE_KIND],
            "total": got["total"]}


@app.post("/api/people/{person_id}/notes/{pid}/{stream}")
def leave_person_note(person_id: str, pid: str, stream: str, body: EventPost, request: Request,
                      user: str = Depends(current_user)):
    """Append one note. The author is stamped HERE, from the signed-in account."""
    owner = _note_gate(user, person_id)
    _note_screen(owner, person_id, pid, stream)
    if body.kind != notes.NOTE_KIND:
        raise HTTPException(status_code=400, detail="only a note can be left here")
    try:
        data = notes.build_row(body.data, display_name=_display_name(user))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not _note_limit.hit(f"{user}|{person_id}"):
        raise HTTPException(status_code=429, detail="that is a lot of notes - try again in a few minutes")
    row = store.append_event(owner, pid, stream, notes.NOTE_KIND, data,
                             principal_id=user, principal_type="human")
    # The screen listens on its OWN url for this stream; tell it, so the note changes at once.
    _push.publish(owner, f"/api/profiles/{pid}/events/{stream}")
    _push.publish(user, request.url.path)
    return notes.visible_row(row)


# ------------------------------------------------------------ RECOMMEND A SONG OR VIDEO (recommend.py)
# Mike, 2026-10-04: "Share" on Your people means recommending a YouTube or Spotify song or video. The rules
# - which links, what oEmbed's answers mean, what the recipient sees - are in recommend.py, tested alone
# (test_recommend.py). WHO MAY SEND is `_note_gate`: exactly who may leave a note (Mike: the same permission).
# WHO READS AND CLEARS is the person's owner (`owned_person`): the person's own page, on a screen or signed in.
# A refused send for "not allowed" and "no such person" is the note's one 403, so no id oracle here either.
#
# `_rec_fetch` is looked up when a route runs, so test_recommend.py swaps in a fake and nothing it does
# reaches the network. Only ever called with recommend.oembed_endpoint's two addresses.
_rec_fetch = recommend.http_fetch
# TWELVE IN TEN MINUTES per sender per person: the note's own limit and reasoning (notes.RateLimit). Counted
# BEFORE the provider is asked, so a flood never becomes a flood of requests to YouTube or Spotify.
_rec_limit = notes.RateLimit()
# The dialog's preview (title and picture before Send): thirty a minute per account, enough for somebody
# pasting and re-pasting, not enough to use this site as somebody's oEmbed proxy.
_rec_preview_limit = notes.RateLimit(limit=30, window=60.0)


class RecommendPost(BaseModel):
    link: str = ""
    message: str = ""
    from_person: str | None = None


class RecommendPreview(BaseModel):
    link: str = ""


def _rec_about(link: str) -> tuple[dict, dict]:
    try:
        ref = recommend.parse_link(link)
        return ref, recommend.describe(ref, lambda u: _rec_fetch(u))
    except recommend.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/recommend/preview")
def recommend_preview(body: RecommendPreview, user: str = Depends(current_user)):
    """What a pasted link is, before Send: {provider, kind, id, title, thumb, url}, or the 400 saying why not."""
    try:
        ref = recommend.parse_link(body.link)
    except recommend.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not _rec_preview_limit.hit(user):
        raise HTTPException(status_code=429, detail="That is a lot of links in a minute - wait a moment.")
    _, about = _rec_about(body.link)
    return {**ref, **about, "url": recommend.canonical_url(ref)}


@app.post("/api/people/{person_id}/recommendations")
def send_recommendation(person_id: str, body: RecommendPost, user: str = Depends(current_user)):
    """Recommend one song or video to this person. Who sent it is stamped HERE, from the signed-in account."""
    owner = _note_gate(user, person_id)
    try:
        ref = recommend.parse_link(body.link)
        message = recommend.clean_message(body.message)
    except recommend.Refused as e:
        raise HTTPException(status_code=400, detail=str(e))
    from_name, from_person = "", None
    if body.from_person and ID_RE.match(body.from_person):
        me = store.get_person(user, body.from_person)     # one of the SENDER's own people, or ignored
        if me:
            from_person, from_name = me["id"], (me.get("name") or "").strip()
    if not from_name:
        from_name = _display_name(user)
    if not _rec_limit.hit(f"{user}|{person_id}"):
        raise HTTPException(status_code=429, detail="That is a lot of recommendations - try again in a few minutes.")
    _, about = _rec_about(body.link)
    data = recommend.build_row(ref, about, message=message, from_name=from_name, from_person=from_person)
    row = store.append_event(owner, person_scope(person_id), recommend.STREAM, recommend.REC_KIND, data,
                             principal_id=user, principal_type="human")
    _push.publish(owner, f"/api/people/{person_id}/recommendations")
    return recommend.visible(row.get("id"), row.get("created_at"), row.get("data") or data)


@app.get("/api/people/{person_id}/recommendations")
def list_recommendations(person_id: str, limit: int = 20, user: str = Depends(current_user)):
    """The person's own: newest first, dismissed ones left out, each with `seen`. Owner only."""
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    got = store.list_events(user, person_scope(person_id), recommend.STREAM, 500)
    return {"recommendations": recommend.fold(got["events"], max(1, min(limit, 50)))}


@app.post("/api/people/{person_id}/recommendations/{rid}/{mark}")
def mark_recommendation(person_id: str, rid: int, mark: str, user: str = Depends(current_user)):
    """`seen` (it was played or opened) or `dismissed` (take it off the page). Appended, never deleted. Owner only."""
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    kind = recommend.MARKS.get(mark)
    if not kind:
        raise HTTPException(status_code=400, detail="only seen or dismissed")
    got = store.list_events(user, person_scope(person_id), recommend.STREAM, 500)
    if not any(e.get("id") == rid and e.get("kind") == recommend.REC_KIND for e in got["events"]):
        raise HTTPException(status_code=404, detail="no such recommendation")
    store.append_event(user, person_scope(person_id), recommend.STREAM, kind, {"of": rid},
                       principal_id=user, principal_type="human")
    _push.publish(user, f"/api/people/{person_id}/recommendations")
    return {"ok": True, "of": rid, "mark": mark}


import recommend_search  # noqa: E402 - search by name on the account's own YouTube / Spotify keys (its own file)
app.include_router(recommend_search.make_router(store))


# ------------------------------------- PEOPLE ACROSS ACCOUNTS: connect, hand a profile over, share profiles
# Mike, 2026-10-04 (night): a profile has a home and appears on other accounts (DECISIONS.md, items 1-11).
# Two ways in, one link machinery: "Connect with someone" (connect like friends - the main one) and "Invite
# them to use this" on one of your people (hand over a profile you made). Either can share chosen profiles.
# The rules are claims.py (pure, test_claims.py); the page is join.html. Every route here takes the account
# from the sign-in, never from a URL or a body, and no route hands back an account id - only names.
#
# RATE LIMITS. Making links: 20 an hour per account (a family is a handful; a stuck loop is hundreds).
# Wrong links: the same throttle and numbers as pairing codes (8 misses per account, 60 per address, in
# ten minutes - PAIR_MAX_MISSES' argument, including the shared facility NAT). A 256-bit token cannot
# be guessed anyway; this is so nothing can grind at the door. Same honest limit: in process.
_invite_limit = notes.RateLimit(limit=20, window=3600.0)


class InviteCreate(BaseModel):
    days: int | None = None
    # [{person_id, messages}] or [person_id]: which of the people you look after the other side gets.
    # Absent: just you (claims.DEFAULT_SHARES), with `messages` for it.
    shares: list | None = None
    messages: bool = claims.DEFAULT_MESSAGES
    # 8908b2c's "see your other people": absent `shares`, True shares everybody you look after.
    see_people: bool | None = None


class InviteToken(BaseModel):
    token: str = ""
    # The join page's own tick: may whoever sent the link leave messages for you (claims.MESSAGES_BACK).
    messages_back: bool = claims.MESSAGES_BACK


class MessagesPut(BaseModel):
    on: bool


def _inviter_name(owner: str) -> str:
    """What a page calls another login: their display name, else their own first person's name - unless that
    is still the default "Me", which would read as the visitor."""
    name = _display_name(owner)
    if name:
        return name
    first = store.first_person_id(owner)
    p = store.get_person(owner, first, profile=True) if first else None
    n = (p or {}).get("name", "").strip()
    return "" if not n or n.lower() == "me" else n


def _invite_view(inv: dict, now: str, names: dict[str, str] | None = None) -> dict:
    shares = inv.get("shares") or []
    return {"id": inv["id"], "kind": inv.get("kind", "claim"), "created_at": inv["created_at"],
            "expires_at": inv["expires_at"], "state": claims.invite_state(inv, now),
            "shares": [{"person_id": s.get("person_id"), "messages": bool(s.get("messages")),
                        "name": (names or {}).get(s.get("person_id"), "")} for s in shares]}


def _refused(reason: str, status: int) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": reason, "text": claims.REFUSAL_TEXT.get(reason, "")})


def _invite_throttle_keys(request: Request, user: str | None) -> list[tuple[str, int]]:
    ip = request.client.host if request.client else "?"
    keys = [(f"invite-ip:{ip}", PAIR_MAX_MISSES_IP)]
    if user:
        keys.append((f"invite-acct:{user}", PAIR_MAX_MISSES))
    return keys


def _shares_for(user: str, body: InviteCreate, *, exclude: str | None) -> tuple[list[dict], dict[str, str]]:
    """The invite's shares, checked (claims.clean_shares), and the names of your people by id."""
    rows = store.people_rows(user)
    first = rows[0]["id"] if rows else None
    names = {r["id"]: claims.display_name(r, r["home_name"]) for r in rows}
    raw = body.shares
    if raw is None and body.see_people:
        raw = [r["id"] for r in rows if not r["home_id"]]
    try:
        shares = claims.clean_shares(raw, own_rows=rows, first_person_id=first, exclude=exclude)
    except ValueError:
        raise HTTPException(status_code=400, detail=claims.REFUSAL_TEXT["shares"])
    if body.shares is None and not body.see_people:
        shares = [{**s, "messages": bool(body.messages)} for s in shares]
    return shares, names


def _make_invite(user: str, person_id: str, kind: str, body: InviteCreate, request: Request, *,
                 exclude: str | None) -> dict:
    if via_device_key(request):
        raise HTTPException(status_code=403, detail=claims.REFUSAL_TEXT["screen"])
    try:
        days = claims.clamp_days(body.days)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    shares, names = _shares_for(user, body, exclude=exclude)
    if not _invite_limit.hit(user):
        raise HTTPException(status_code=429, detail="That is a lot of invitations - try again in a while.")
    token = claims.new_token()
    inv = store.create_invite(user, person_id, claims.hash_token(token), _iso_in_days(days), kind=kind,
                              shares=shares, sweep_before=_iso_in_days(-claims.KEEP_DEAD_INVITE_DAYS))
    return {"invite": _invite_view({**inv, "used_at": None, "cancelled_at": None}, _now_iso(), names),
            "token": token, "path": f"/join.html?invite={token}"}


@app.post("/api/people/{person_id}/invites")
def create_invite(person_id: str, body: InviteCreate, request: Request, user: str = Depends(current_user)):
    """"Invite them to use this": a link that hands one of your people over. The token is in THIS response
    and nowhere else, ever."""
    _check(person_id, ID_RE, "person id")
    if via_device_key(request):
        raise HTTPException(status_code=403, detail=claims.REFUSAL_TEXT["screen"])
    row = store.person_row(person_id)
    reason = claims.invite_refusal(account=user, row=row, first_person_id=store.first_person_id(user))
    if reason == "not-yours":
        raise HTTPException(status_code=404, detail="no such person")
    if reason:
        return _refused(reason, 409)
    return _make_invite(user, person_id, "claim", body, request, exclude=person_id)


@app.get("/api/people/{person_id}/invites")
def list_invites(person_id: str, user: str = Depends(current_user)):
    """The links still waiting for this person (no tokens), and whether somebody uses it with their own login."""
    _check(person_id, ID_RE, "person id")
    owned_person(user, person_id)
    now = _now_iso()
    names = {p["id"]: p["name"] for p in store.list_people(user)}
    waiting = [_invite_view(i, now, names) for i in store.list_invites(user, person_id, kind="claim")]
    row = store.person_row(person_id) or {}
    joined = row.get("made_by") == "claim" and bool(row.get("home_id"))
    home = store.person_row(row["home_id"]) if joined else None
    return {"invites": [i for i in waiting if i["state"] == "live"], "claimed": joined,
            "by": _inviter_name(home["account_id"]) if home else ""}


@app.delete("/api/people/{person_id}/invites/{invite_id}")
def cancel_invite(person_id: str, invite_id: str, user: str = Depends(current_user)):
    _check(person_id, ID_RE, "person id")
    _check(invite_id, ID_RE, "invite id")
    owned_person(user, person_id)
    if not store.cancel_invite(user, invite_id):
        raise HTTPException(status_code=404, detail="no such invitation waiting")
    return {"ok": True}


@app.post("/api/connect/invites")
def create_connect_invite(body: InviteCreate, request: Request, user: str = Depends(current_user)):
    """"Connect with someone": a link that connects whoever opens it with you, like friends. Nobody needs
    setting up first. The token is in THIS response and nowhere else."""
    first = store.ensure_default_person(user)
    return _make_invite(user, first, "connect", body, request, exclude=None)


@app.get("/api/connect/invites")
def list_connect_invites(user: str = Depends(current_user)):
    """Your connect links still waiting (no tokens)."""
    now = _now_iso()
    names = {p["id"]: p["name"] for p in store.list_people(user)}
    waiting = [_invite_view(i, now, names) for i in store.list_invites(user, kind="connect")]
    return {"invites": [i for i in waiting if i["state"] == "live"]}


@app.delete("/api/connect/invites/{invite_id}")
def cancel_connect_invite(invite_id: str, user: str = Depends(current_user)):
    _check(invite_id, ID_RE, "invite id")
    if not store.cancel_invite(user, invite_id):
        raise HTTPException(status_code=404, detail="no such invitation waiting")
    return {"ok": True}


def _invite_target(inv: dict) -> tuple[dict | None, str]:
    """(the row handed over or the inviter's "you", '' | 'unknown' | 'claimed')."""
    row = store.person_row(inv["person_id"])
    if not row or row["account_id"] != inv["owner_id"]:
        return None, "unknown"
    if inv.get("kind") == "claim" and row.get("home_id"):
        return row, "claimed"
    return row, ""


@app.post("/api/invites/peek")
def peek_invite(body: InviteToken, request: Request):
    """What the join page shows BEFORE anybody signs in: who sent it, what kind, and which people it shares.
    Holding the link is what lets you see this - names only, never an account. Wrong links count against the
    address."""
    viewer = optional_user(request)
    keys = _invite_throttle_keys(request, viewer)
    if any(_pair_throttled(k, lim) for k, lim in keys):
        raise HTTPException(status_code=429, detail="Too many tries - wait a few minutes.")
    inv = store.invite_by_hash(claims.hash_token(body.token))
    row, why = _invite_target(inv) if inv else (None, "unknown")
    if not inv or why == "unknown":
        for k, _ in keys:
            _pair_miss(k)
        return _refused("unknown", 404)
    state = claims.invite_state(inv, _now_iso())
    out = {"state": state, "text": claims.REFUSAL_TEXT.get(state, ""), "signed_in": bool(viewer),
           "screen": via_device_key(request), "kind": inv.get("kind", "claim")}
    if state == "live":
        owner = inv["owner_id"]
        # Names as the person opening the link may see them: the names on the cards, never the inviter's labels.
        names = {p["id"]: p["name"] for p in store.list_people(owner, profile=True)}
        sender = _inviter_name(owner)
        shares = [{"name": names.get(s["person_id"], ""), "messages": bool(s.get("messages")),
                   "sender": s["person_id"] == store.first_person_id(owner)}
                  for s in store.invite_shares(inv) if s.get("person_id") in names]
        out.update({"name": names.get(row["id"], "") if out["kind"] == "claim" else (sender or names.get(row["id"], "")),
                    "from": sender, "expires_at": inv["expires_at"], "shares": shares,
                    "is_inviter": viewer == owner, "claimed": why == "claimed"})
    return out


@app.post("/api/invites/accept")
def accept_invite(body: InviteToken, request: Request, user: str = Depends(current_user)):
    """"Make this mine" (a claim) or "Connect" (a connect link). Signed in, on your own login (not a screen,
    not the inviter's)."""
    keys = _invite_throttle_keys(request, user)
    if any(_pair_throttled(k, lim) for k, lim in keys):
        raise HTTPException(status_code=429, detail="Too many tries - wait a few minutes.")
    inv = store.invite_by_hash(claims.hash_token(body.token))
    if not inv:
        for k, _ in keys:
            _pair_miss(k)
        return _refused("unknown", 404)
    row, why = _invite_target(inv)
    reason = claims.accept_refusal(inv, account=user, now_iso=_now_iso(), target_ok=why != "unknown",
                                   via_screen=via_device_key(request)) or ("claimed" if why == "claimed" else "")
    if reason:
        return _refused(reason, {"unknown": 404, "screen": 403, "own": 403, "signed-out": 401}.get(reason, 409))
    owner = inv["owner_id"]
    # The name on the card (not what the inviter calls them): it may become the claimer's own name just below.
    claimed_name = (store.get_person(owner, inv["person_id"], profile=True) or {}).get("name", "")
    status, made = store.accept_invite(inv["id"], user, messages_back=bool(body.messages_back))
    if status != "ok":
        return _refused("claimed" if status == "claimed" else "used", 409)
    sender = _inviter_name(owner)
    if made["kind"] == "claim":
        # MOST OF THE WORK ALREADY DONE. A login with no name of its own yet signs its notes with the name it
        # was invited as ("Mom"), rather than "Someone"; its own profile, still called "Me", takes that name
        # too; and the picture and page the inviter made are copied over if it has none. Never over anything
        # somebody chose.
        if not _display_name(user):
            try:
                nm = notes.clean_display_name(claimed_name)
                if nm:
                    cur = store.get_state(user, ACCOUNT_SCOPE, DISPLAY_NAME_KEY)
                    store.put_state(user, ACCOUNT_SCOPE, DISPLAY_NAME_KEY, {"name": nm}, cur.get("version", 0))
            except ValueError:
                pass
        mine = store.get_person(user, made["first"]) or {}
        if (mine.get("name") or "").strip().lower() in ("", "me"):
            nm = _display_name(user) or claimed_name
            if nm and NAME_RE.match(nm):
                store.rename_person(user, made["first"], nm)
        store.copy_profile_if_empty(owner, inv["person_id"], user, made["first"])
    return {"ok": True, "kind": made["kind"], "name": claimed_name if made["kind"] == "claim" else sender,
            "from": sender}


def _linked_row(user: str, person_id: str) -> tuple[dict, str, dict]:
    """(your row, the other account, the active connection) for a row a connection put on your page - or the
    404 a row that is not yours, or not from a connection, gets."""
    _check(person_id, ID_RE, "person id")
    row = store.person_row(person_id)
    source = store.person_row(row["source_id"]) if row and row.get("source_id") else None
    if not row or row["account_id"] != user or not row.get("link_id") or not source or source["account_id"] == user:
        raise HTTPException(status_code=404, detail="nothing shared here")
    link = store.get_link(user, source["account_id"])
    if not link or not links.link_is_active(link) or link["id"] != row["link_id"]:
        raise HTTPException(status_code=404, detail="nothing shared here")
    return row, source["account_id"], link


@app.delete("/api/people/{person_id}/link")
def stop_sharing(person_id: str, user: str = Depends(current_user)):
    """"Stop sharing" on the card of somebody a connection put on your page - either side. It ends the
    connection with that login: what it made goes, on both pages; a person somebody had taken over goes back
    to being the inviter's own (db.unlink)."""
    _row, other, _link = _linked_row(user, person_id)
    store.unlink(user, other, broken_by=user)
    return {"ok": True}


@app.put("/api/people/{person_id}/messages")
def link_messages(person_id: str, body: MessagesPut, user: str = Depends(current_user)):
    """"Messages from them: on / off": may the login behind this card leave messages for the people of yours
    they have on their page. Yours to switch; theirs is on their card for you."""
    _row, other, link = _linked_row(user, person_id)
    store.set_link_messages(link["id"], user, other, bool(body.on))
    return {"ok": True, "messages": store.link_messages(link["id"], user, other)}


# ---- ONE CARD AT A TIME (claims.py, the section of that name) ---------------------------------------------------
# "Shared with" (first built as "Who has this card") and "Stop sharing with Oscar" for the account that looks after a profile; "Remove just this
# card" for an account holding one. Each refuses a screen in a room (they are a phone's or computer's), and each
# answers somebody else's person with the same 404 as no person at all.
def _holders_view(user: str, home: dict) -> list[dict]:
    """Who holds this profile: each by THAT login's own name, never what they call the person (claims.py argues
    it); a login this account is not connected with is nameless, with who it came through."""
    out = []
    names: dict[str, str] = {}

    def name_of(acct: str) -> str:
        if acct not in names:
            names[acct] = _inviter_name(acct)
        return names[acct]

    for h in store.holders_of(home["id"]):
        acct = h["account_id"]
        if acct == user:
            continue
        source = store.person_row(h["source_id"]) if h.get("source_id") else None
        via = source["account_id"] if source and source["account_id"] not in (acct, user) else None
        connected = links.linked(store.get_link(user, acct), user, acct)
        stop = claims.holder_refusal(h, link_rows=store.count_link_rows(acct, h.get("link_id")))
        out.append({"id": h["id"], "name": name_of(acct) if connected else "", "through": name_of(via) if via else "",
                    "joined": h.get("made_by") == "claim", "stop": stop, "text": claims.REFUSAL_TEXT.get(stop, "")})
    out.sort(key=lambda x: (not x["name"], x["name"].lower(), x["through"].lower()))
    return out


@app.get("/api/people/{person_id}/holders")
def list_holders(person_id: str, request: Request, user: str = Depends(current_user)):
    """"Shared with": the other logins holding this profile you look after. Readable only by you."""
    _check(person_id, ID_RE, "person id")
    if via_device_key(request):
        return _refused("screen", 403)
    row = store.person_row(person_id)
    if not row or row["account_id"] != user:
        raise HTTPException(status_code=404, detail="no such person")
    if row.get("home_id"):
        return _refused("not-home-list", 409)
    return {"holders": _holders_view(user, row)}


@app.delete("/api/people/{person_id}/holders/{holder_id}")
def unshare_holder(person_id: str, holder_id: str, request: Request, user: str = Depends(current_user)):
    """"Stop sharing with Oscar": Oscar's card for this one profile comes off his page, with the permissions that
    came with it. The connection stays (db.drop_held_row)."""
    _check(person_id, ID_RE, "person id")
    _check(holder_id, ID_RE, "card id")
    if via_device_key(request):
        return _refused("screen", 403)
    home, holder = store.person_row(person_id), store.person_row(holder_id)
    rows = store.count_link_rows(holder["account_id"], holder.get("link_id")) if holder else 0
    reason = claims.unshare_refusal(actor=user, home=home, holder=holder, link_rows=rows)
    if reason == "missing":
        raise HTTPException(status_code=404, detail="no such card")
    if reason:
        return _refused("not-home-list" if reason == "not-home" else reason, 409)
    store.drop_held_row(holder_id, keep_if_screens=True)
    return {"ok": True}


@app.delete("/api/people/{person_id}/card")
def remove_card(person_id: str, request: Request, user: str = Depends(current_user)):
    """"Remove just this card": one card a connection put on your page goes, with the permissions that came with
    it; the connection stays."""
    _check(person_id, ID_RE, "person id")
    if via_device_key(request):
        return _refused("screen", 403)
    row = store.person_row(person_id)
    mine = bool(row) and row["account_id"] == user
    reason = claims.remove_card_refusal(
        actor=user, row=row, first_person_id=store.first_person_id(user),
        screens=store.count_person_screens(user, person_id) if mine else 0,
        link_rows=store.count_link_rows(user, row.get("link_id")) if mine else 0)
    if reason == "missing":
        raise HTTPException(status_code=404, detail="no such person")
    if reason:
        return _refused(reason, 409)
    if store.drop_held_row(person_id, keep_if_screens=False) != "removed":
        return _refused("screens", 409)
    return {"ok": True}


# ------------------------------------------------------------ CLAUDE, ON THIS ACCOUNT
# Mike, 2026-10-03: an optional Claude backend for ONE account's own use, "not something where I have
# to pay for everyone". The rules - the key box, the cap, the request and reply shapes - are in
# claude_ai.py and tested alone (test_claude_ai.py); these routes are the doors.
#
# WHO: `current_user` - the account. Its screens (device keys) and its own sign-ins may READ the status
# and TALK; only a signed-in device may CHANGE the key or settings (`_not_a_screen`). Another account
# has its own (empty) rows and can never name this one's: nothing here takes an account id from a URL
# or a body, so there is no id to guess.
_claude = claude_ai.ClaudeAccounts(store, keybox=claude_ai.KeyBox.from_env())
# A STUCK LOOP MUST NOT SPEND THE DAY IN A MINUTE. Twenty messages a minute per account: a person
# talking manages perhaps six; a retry loop or a screen answering itself would do hundreds. The daily
# cap still bounds the money; this bounds the speed. In process, same honest limit as notes.RateLimit.
_claude_limit = notes.RateLimit(limit=20, window=60.0)


class ClaudeKeyPut(BaseModel):
    key: str = ""


class ClaudeSettingsPut(BaseModel):
    chat_model: str | None = None
    quiz_model: str | None = None
    daily_cap_usd: float | None = None


def _not_a_screen(request: Request) -> None:
    if via_device_key(request):
        raise HTTPException(status_code=403, detail="Change the Claude settings from your own phone or "
                                                    "computer, signed in - not from a screen.")


def _claude_do(fn):
    try:
        return fn()
    except claude_ai.NotSetUp as e:
        raise HTTPException(status_code=404, detail=str(e))
    except claude_ai.Refused as e:
        raise HTTPException(status_code=e.status, detail=e.detail)


@app.get("/api/ai/claude")
def claude_status(user: str = Depends(current_user)):
    """Set or not, the key's last four characters, the models, today's spend against the cap. NEVER
    the key itself - not here, not anywhere, once it is saved."""
    return _claude_do(lambda: _claude.status(user))


@app.put("/api/ai/claude/key")
def claude_set_key(body: ClaudeKeyPut, request: Request, user: str = Depends(current_user)):
    _not_a_screen(request)
    return _claude_do(lambda: _claude.set_key(user, body.key))


@app.delete("/api/ai/claude/key")
def claude_clear_key(request: Request, user: str = Depends(current_user)):
    _not_a_screen(request)
    return _claude_do(lambda: _claude.clear_key(user))


@app.put("/api/ai/claude/settings")
def claude_set_settings(body: ClaudeSettingsPut, request: Request, user: str = Depends(current_user)):
    _not_a_screen(request)
    return _claude_do(lambda: _claude.set_settings(user, body.model_dump()))


@app.post("/api/ai/claude/check")
def claude_check(user: str = Depends(current_user)):
    """Does the saved key work? Asks Anthropic for one model's details, which is not billed."""
    return _claude_do(lambda: _claude.check_key(user))


@app.post("/api/ai/claude/chat")
def claude_chat(body: dict = Body(...), user: str = Depends(current_user)):
    """nimrod_ai.js's request (messages with the system prompt first, plus `actions`: the allow-list)
    -> `{ok, text, ...}`, the same shape ai.js's `chat` resolves to. Text only. Actions come back as
    `[[name arg]]` lines and still only run on a press in the browser."""
    if not _claude_limit.hit(user):
        raise HTTPException(status_code=429, detail="That is a lot of messages in a minute - wait a moment.")
    return _claude_do(lambda: _claude.chat(user, body))


# ------------------------------------------------------------ review by playing (pack_reviews.py)
# Mike, 2026-10-03, about AI-written question packs: "Can I just play through and pass them?"
# Which packs wait for review (packs_review/, then packs_local/), and the ACCOUNT's review log: one
# append-only stream in the reserved `_account` scope, so a question passed on a phone counts on every
# screen of the account - and on no other account's. Screens may write (reviewing is done at a screen,
# often beside the person playing); WHO and WHEN are stamped here, never taken from the browser.
REVIEW_FOLDERS = [CLIENT_DIR / "packs_review", CLIENT_DIR / "packs_local"]
REVIEWS_PATH = "/api/account/reviews"
REVIEWS_MAX_LIMIT = 5000      # a few rows per question, 200-question packs: room for several packs' history


@app.get("/api/packs/unreviewed")
def packs_unreviewed(user: str = Depends(current_user)):
    return {"packs": pack_reviews.list_unreviewed(REVIEW_FOLDERS)}


@app.get(REVIEWS_PATH)
def list_reviews(limit: int = 1000, user: str = Depends(current_user)):
    return store.list_events(user, ACCOUNT_SCOPE, pack_reviews.REVIEW_STREAM,
                             max(1, min(int(limit), REVIEWS_MAX_LIMIT)))


@app.post(REVIEWS_PATH)
def append_review(body: EventPost, request: Request, user: str = Depends(current_user)):
    try:
        data = pack_reviews.clean_review(body.kind, body.data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if data.get("person"):
        # "Who is reviewing" (the review page): one of THIS login's people, named from the server's row.
        who = store.get_person(user, data["person"])
        if who is None:
            raise HTTPException(status_code=400, detail="that person is not on this login")
        data["by"] = (who.get("name") or "").strip() or "somebody on this login"
        if via_device_key(request):
            data["via"] = "a screen"
    else:
        data["by"] = "a screen" if via_device_key(request) else (_display_name(user) or "the account owner")
    data["at"] = _now_iso()
    result = store.append_event(user, ACCOUNT_SCOPE, pack_reviews.REVIEW_STREAM, body.kind, data)
    _push.publish(user, REVIEWS_PATH)
    return result


# --------------------------------------------------------------------- server push (SSE)
# "This URL has new data" — nothing more. See push.py for the full reasoning: the
# 2026-08-10 decision was "server push = SSE, not WebSocket," and state.js/events.js's
# polling loops have said "interim... until this lands" since the day they were written.
_push = PushHub()
_stream_tickets = StreamTickets()


@app.post("/api/stream/ticket")
def stream_ticket(user: str = Depends(current_user)):
    """Trade ordinary HTTP auth for something an EventSource CAN carry — it sends no
    custom headers at all, so a kiosk's X-Device-Key has no way onto the connection
    directly. Same shape as /api/drive/ticket/{person_id}, scoped to the account instead
    of one person — see push.py's StreamTickets for why that is a different class."""
    return {"ticket": _stream_tickets.issue(user), "expires_in": 30}


@app.get("/api/stream")
async def stream(request: Request, t: str = ""):
    user = _stream_tickets.redeem(t)
    if not user:
        # Same reasoning as drive_socket's 4401: a plain 401 lets the client tell "the
        # ticket went stale, get another" apart from "the network died," and retry the
        # right one instead of guessing.
        raise HTTPException(status_code=401, detail="stream ticket invalid or expired")
    q = _push.subscribe(user)
    async def gen():
        try:
            # A retry hint up front, and a comment line whenever nothing has happened for
            # a while — EventSource ignores lines starting with `:`, but an entirely
            # silent response is indistinguishable from a dead one to a proxy in between,
            # and some will close an idle connection they assume nobody is using.
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    url = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {url}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            _push.unsubscribe(user, q)
    return StreamingResponse(gen(), media_type="text/event-stream")


# --------------------------------------------------------------- the demo photo listing
#
# *** THE SAMPLE PHOTOS ARE WHATEVER IS IN THE FOLDER. ***
#
# G13, Mike: the samples should be *"pictures of Nimrod the cat, not abstract dots. Mike has
# them, and it explains the name."* The photos are his to add and I do not have them — but the
# only reason adding them was more than a drag-and-drop is that `demo-media/list` was a JSON file
# somebody had to hand-edit alongside the images, with a `name`, a `size` and a `count` that
# nothing checked. A listing written by hand next to the files it describes is a listing that
# goes stale, and the way anybody finds out is a demo photo that 404s in front of a stranger.
#
# So it is generated by walking the directory, exactly like `/api/dev/client-modules` and for
# the same reason. **Dropping `nimrod-01.jpg` into `web/client/demo-media/files/` is now the
# whole job**, and the caption comes from the filename: `nimrod-on-the-windowsill.jpg` reads as
# "Nimrod on the windowsill".
#
# Registered before the static mount so it wins over the checked-in `list` file, and it FALLS
# BACK to that file if the directory cannot be read — a demo kiosk on the landing page losing
# its pictures because of a filesystem error would be the first thing a stranger sees.
DEMO_MEDIA = CLIENT_DIR / "demo-media"
DEMO_EXT = {
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image",
    ".gif": "image", ".svg": "image", ".avif": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video",
}


# *** NO CAPTIONS. Mike, 2026-09-06, and he is right. ***
#
# This used to turn `nimrod-on-the-windowsill` into "Nimrod on the windowsill", so that naming a
# file captioned the photo. It was a nice idea and it met reality immediately: the photos he
# actually had are `20260313_003702.jpg` off a phone, and filename-as-caption would have put
# "20260313 003702" under a picture of his cat. **His answer was to turn the behaviour off
# rather than rename his files**, which is the correct trade — a demo should not make somebody
# do clerical work, and a caption nobody wrote is worse than no caption.
#
# `name` is deliberately empty rather than the filename. Nothing on screen renders it today
# (`photos.js` uses it only for `alt`), and an `alt` of "20260313 003702" is noise read aloud to
# somebody using a screen reader. `photos.js` falls back to a plain "Photo".


# The bundled SVGs. They are the OFFLINE FALLBACK, not the sample set -- Mike left them in place
# deliberately when he added the photos, and the distinction is the whole of the rule below.
FALLBACK_EXT = {".svg"}


@app.get("/demo-media/list")
def demo_media_list():
    """*** PHOTOGRAPHS ARE THE SAMPLES; THE DRAWINGS ARE THE FALLBACK. ***

    Mike put four photographs of Nimrod -- the cat the project is named after -- in this folder,
    and left the six abstract SVGs beside them on purpose: *"the cat photos are the sample set,
    the SVGs remain the fallback."*

    So this is not "list everything in the directory". If there is a photograph, the demo shows
    photographs; the drawings appear only when there is nothing else, which is the case a fresh
    clone with no media is in. Showing both together would put a cat next to a gradient and make
    the demo look like a folder rather than somebody's screen -- and *"it explains the name"* is
    the entire argument for the photographs being there.
    """
    files_dir = DEMO_MEDIA / "files"
    try:
        every = sorted(
            (f for f in files_dir.iterdir()
             if f.is_file() and f.suffix.lower() in DEMO_EXT),
            key=lambda f: f.name,
        )
        real = [f for f in every if f.suffix.lower() not in FALLBACK_EXT]
        entries = real or every
        items = [{
            "id": f.name,
            # Empty on purpose -- see the note above `demo_media_list`. No caption is better
            # than one nobody wrote.
            "name": "",
            "path": f.name,
            "kind": DEMO_EXT[f.suffix.lower()],
            "size": f.stat().st_size,
            # 0, not the real mtime: a checkout changes every timestamp, and a demo that
            # reordered itself per machine would make two visits disagree for no reason.
            "mtime": 0,
        } for f in entries]
        return {"album": "", "albums": [], "items": items, "count": len(items)}
    except Exception:
        log.exception("demo-media: could not list %s", files_dir)
        try:
            return json.loads((DEMO_MEDIA / "list").read_text(encoding="utf-8"))
        except Exception:
            return {"album": "", "albums": [], "items": [], "count": 0}


# --------------------------------------------------------------- dev: what is in web/client
#
# *** THE FILE LIST FOR `dev/imports_test.html`, AND IT IS DELIBERATELY NOT HARDCODED THERE. ***
#
# That suite imports every client module to prove each one still parses. It exists because the
# same mistake — a backtick inside an HTML comment inside a template literal — was made twice in
# one session, and the symptom both times was a DIFFERENT suite hanging with no summary, naming
# nothing. A parse error should name its own file.
#
# The list is walked rather than written down because a stale list's failure mode is the worst
# one available: the newest file, which is the one somebody is editing and the one most likely to
# be broken, is the one it would not cover.
#
# READ-ONLY, and it exposes only names that are already served publicly from this same directory
# — every one of these is fetchable at `/<name>` by anybody, so listing them tells nobody
# anything they could not get from the page source. `.venv`, `__pycache__` and `demo-media` are
# skipped as noise, not as secrets.
@app.get("/api/dev/client-modules")
def api_dev_client_modules():
    skip = {"__pycache__", "node_modules", ".venv", "demo-media"}
    out: list[str] = []
    for path in sorted(CLIENT_DIR.rglob("*.js")):
        rel = path.relative_to(CLIENT_DIR)
        if any(part in skip for part in rel.parts):
            continue
        out.append(rel.as_posix())
    return out


# *** THE SUITE LIST FOR `dev/run_all.html`, WALKED FOR THE SAME REASON AS THE ONE ABOVE. ***
#
# `run_all.html` names its suites by hand, and on 2026-09-30 that hand list had 103 names against
# 148 `dev/*_test.html` files on disk: 45 suites, including `auth`, `bus` and `keyboard`, had
# never once run on that page, and nothing said so. A browser cannot list a directory, so the
# check that catches this (`dev/suite_list.js`, run by `run_all.html` and `suite_list_test.html`)
# needs the server to do it. Same exposure as `client-modules`: bare names of files this
# directory already serves to anybody.
@app.get("/api/dev/test-pages")
def api_dev_test_pages():
    return sorted(p.name for p in (CLIENT_DIR / "dev").glob("*_test.html"))


# Serve the client app from the same origin. Registered LAST so /api/* wins.
# --------------------------------------------------------------- auth (login)
# Who am I? The client checks this on boot: 200 -> signed in (mount the dashboard),
# 401 -> show "Sign in with Google". A device key or an OAuth session both satisfy it.
@app.get("/api/me")
def api_me(request: Request, user: str = Depends(current_user)):
    # `display_name`: what this account's notes are signed with ('' = "Someone"). See notes.py.
    return {"user": user, "email": request.session.get("email"), "google": GOOGLE_OK,
            "display_name": _display_name(user)}


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
async def auth_login(request: Request, next: str | None = None, switch: int = 0):
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
    # *** `?switch=1` IS THE ONLY WAY TO SIGN IN AS SOMEBODY ELSE. ***
    #
    # PRIORITY.md #6: "Mike cannot test as anybody else, and every test he runs pollutes the
    # record." `/auth/logout` clears OUR session and nothing else -- Google's is untouched -- so
    # signing in again silently picks the same account back up with no prompt. There was no
    # account switch anywhere in the product; logging out and back in looked like one and was
    # not.
    #
    # `prompt=select_account` makes Google ask. It is NOT the default, deliberately: forcing an
    # account chooser on every ordinary sign-in buys nothing and costs a click each time, and
    # the person who needs it knows they need it. The sidebar link passes it.
    extra = {"prompt": "select_account"} if switch else {}
    return await oauth.google.authorize_redirect(request, redirect_uri, **extra)


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
    # full-screen kiosk they have no way to compose. Home is the modules page since
    # 2026-09-30 (row 2.29: "what is currently the modules tab should just be the home
    # page"); it opens on the person's profile. Their screens are one link away.
    return RedirectResponse(url=dest or HOME_PAGE)


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
#
# Row 2.29 (2026-09-30): a SIGNED-IN visitor's Home is the modules page (a dashboard: the module
# you are looking at, Save, history, full screen), not the list of screens -- that list,
# home.html, is still one link away ("My dashboards"). A signed-OUT visitor keeps the landing
# page: Mike's question (a) is open, and the landing is what explains the product to somebody
# who has never seen it.
#
# 2026-10-02 evening (Mike: "The dashboard should be the whole screen"): the same address, but a plain
# arrival there is the landing DASHBOARD filling the browser window (modules.html's land view, the
# person's "When I arrive, show" row); its bar's Edit is the editing page, /modules.html?edit=1. No
# route changed: the page decides, because only the page knows the person's row.
HOME_PAGE = "/modules.html"


@app.get("/")
def root(request: Request):
    if optional_user(request):
        return RedirectResponse(url=HOME_PAGE)
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
