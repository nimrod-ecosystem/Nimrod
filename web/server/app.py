"""Nimrod platform server — the thin coordination layer.

Scope of this slice: per-user state only (accounts are stubbed). This process is
deliberately NOT a media server and NOT an AI server (see ../../DECISIONS.md).

Run from this directory:
    uvicorn app:app --reload --port 8000
Then open http://localhost:8000/ — the server also serves the client app so the
whole loop is one origin (no CORS to reason about).
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import SQLiteStateStore
from identity import current_user

MODULE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

CLIENT_DIR = Path(__file__).resolve().parent.parent / "client"
DB_PATH = os.environ.get("NIMROD_DB", str(Path(__file__).resolve().parent / "nimrod.db"))

store = SQLiteStateStore(DB_PATH)
app = FastAPI(title="Nimrod platform server", version="0.1.0")


class StatePut(BaseModel):
    data: dict


def _check_module(module: str) -> None:
    if not MODULE_RE.match(module):
        raise HTTPException(status_code=400, detail="invalid module name")


@app.get("/api/whoami")
def whoami(user: str = Depends(current_user)):
    return {"user": user}


@app.get("/api/state/{module}")
def get_state(module: str, user: str = Depends(current_user)):
    _check_module(module)
    rec = store.get_state(user, module)
    if rec is None:
        # No row yet is a normal empty state, not an error.
        return {"module": module, "user": user, "data": {}, "updated_at": None}
    return {"module": module, "user": user, **rec}


@app.put("/api/state/{module}")
def put_state(module: str, body: StatePut, user: str = Depends(current_user)):
    _check_module(module)
    rec = store.put_state(user, module, body.data)
    return {"module": module, "user": user, **rec}


# Serve the client app from the same origin. Registered LAST so /api/* wins.
app.mount("/", StaticFiles(directory=str(CLIENT_DIR), html=True), name="client")
