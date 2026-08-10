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

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import SQLiteStore
from identity import current_user

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")      # ids, module types, state keys, streams
NAME_RE = re.compile(r"^[\w .\-]{1,64}$")          # human profile names

CLIENT_DIR = Path(__file__).resolve().parent.parent / "client"
DB_PATH = os.environ.get("NIMROD_DB", str(Path(__file__).resolve().parent / "nimrod.db"))

store = SQLiteStore(DB_PATH)
app = FastAPI(title="Nimrod platform server", version="0.2.0")


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


def _check(value: str, rx: re.Pattern, what: str) -> None:
    if not rx.match(value):
        raise HTTPException(status_code=400, detail=f"invalid {what}")


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
app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="client")
