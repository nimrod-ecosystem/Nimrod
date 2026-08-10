"""Per-user state store.

The whole platform rests on one rule (see ../../DECISIONS.md and
../../docs/architecture.md): **per-user state is server-side, keyed to the
account** — never per-device, never localStorage-as-source-of-truth. This module
is that store.

`StateStore` is the seam. SQLite backs it today; a Postgres implementation drops
in later by implementing the same two methods — callers never change. The SQL we
use here (``INSERT ... ON CONFLICT ... DO UPDATE``) is valid in both engines, so
the port is genuinely mechanical.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional, Protocol


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StateStore(Protocol):
    """The contract every backend implements. Data is an opaque JSON object;
    the store never interprets a module's shape."""

    def get_state(self, user_id: str, module: str) -> Optional[dict]:
        """Return {"data": dict, "updated_at": iso} or None if nothing saved."""
        ...

    def put_state(self, user_id: str, module: str, data: dict) -> dict:
        """Upsert and return {"data": dict, "updated_at": iso}."""
        ...


class SQLiteStateStore:
    """SQLite-backed StateStore. One row per (user, module)."""

    def __init__(self, path: str):
        self._path = path
        self._lock = threading.Lock()  # serialize writes; one process, low volume
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                CREATE TABLE IF NOT EXISTS state (
                    user_id    TEXT NOT NULL,
                    module     TEXT NOT NULL,
                    data       TEXT NOT NULL,   -- JSON blob, opaque to the store
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, module)
                )
                """
            )

    def get_state(self, user_id: str, module: str) -> Optional[dict]:
        with self._lock:
            cur = self._conn.execute(
                "SELECT data, updated_at FROM state WHERE user_id=? AND module=?",
                (user_id, module),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return {"data": json.loads(row[0]), "updated_at": row[1]}

    def put_state(self, user_id: str, module: str, data: dict) -> dict:
        payload = json.dumps(data)
        ts = _now_iso()
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO state (user_id, module, data, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, module)
                DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
                """,
                (user_id, module, payload, ts),
            )
        return {"data": data, "updated_at": ts}
