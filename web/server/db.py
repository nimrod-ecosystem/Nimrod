"""Persistence for the platform.

TWO storage kinds, deliberately locked into the schema (see ../../DECISIONS.md):

1. OVERWRITE state — config / layout / settings. Last-write-wins, but every row
   carries a ``version`` for optimistic concurrency: a writer sends the version it
   read; the server rejects a stale write (409) and the client re-reads + retries.
   Table ``state``, one row per (user, profile, key).

2. APPEND-ONLY events — event / log / progress / clinical data. NEVER overwritten
   or deleted. This is a by-design guard against the class of bug where re-saving
   config clobbered accumulated activity data. Enforced with DB TRIGGERS that abort
   any UPDATE or DELETE on the table — teeth, not just convention. Table ``events``.

Profiles group a user's module instances; a user may have several ("Room screen",
"Bedside") and open any on any device. SQLite here, Postgres-swappable: the SQL is
standard and ``INSERT ... ON CONFLICT ... DO UPDATE`` works in both engines.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class SQLiteStore:
    def __init__(self, path: str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock, self._conn as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS profiles (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    name       TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_profiles_user ON profiles(user_id);

                -- Per-USER media sources: a folder the user connected via a local
                -- media agent (or later, another adapter). NOT per-profile — one
                -- connected folder is reusable across modules and profiles. A photos
                -- instance references {sourceId, album}; the client resolver fetches
                -- the listing + bytes straight from base_url (the server never sees
                -- the bytes — it only stores this tiny reference).
                CREATE TABLE IF NOT EXISTS media_sources (
                    id         TEXT PRIMARY KEY,
                    user_id    TEXT NOT NULL,
                    label      TEXT NOT NULL,
                    base_url   TEXT NOT NULL,
                    kind       TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_media_sources_user ON media_sources(user_id);

                CREATE TABLE IF NOT EXISTS profile_modules (
                    id         TEXT PRIMARY KEY,
                    profile_id TEXT NOT NULL,
                    type       TEXT NOT NULL,
                    position   INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_pm_profile ON profile_modules(profile_id);

                -- OVERWRITE kind: last-write-wins + version for optimistic concurrency
                CREATE TABLE IF NOT EXISTS state (
                    user_id    TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    key        TEXT NOT NULL,
                    data       TEXT NOT NULL,   -- JSON blob, opaque to the store
                    version    INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, profile_id, key)
                );

                -- APPEND-ONLY kind: immutable. Triggers below make it impossible to
                -- mutate or remove a row, so progress/clinical data can't be clobbered.
                CREATE TABLE IF NOT EXISTS events (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    stream     TEXT NOT NULL,
                    kind       TEXT NOT NULL,
                    data       TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_events_stream
                    ON events(user_id, profile_id, stream, id);
                CREATE TRIGGER IF NOT EXISTS events_no_update
                    BEFORE UPDATE ON events
                    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS events_no_delete
                    BEFORE DELETE ON events
                    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
                """
            )

    # ---------------------------------------------------------------- profiles
    def create_profile(self, user_id: str, name: str) -> dict:
        pid, ts = _new_id(), _now()
        with self._lock, self._conn as c:
            c.execute(
                "INSERT INTO profiles(id, user_id, name, created_at) VALUES(?,?,?,?)",
                (pid, user_id, name, ts),
            )
        return {"id": pid, "name": name, "created_at": ts}

    def list_profiles(self, user_id: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, name, created_at FROM profiles WHERE user_id=? ORDER BY created_at",
                (user_id,),
            ).fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    def get_profile(self, user_id: str, pid: str) -> dict | None:
        """Ownership is enforced here: only the owning user sees a profile."""
        with self._lock:
            r = self._conn.execute(
                "SELECT id, name, created_at FROM profiles WHERE user_id=? AND id=?",
                (user_id, pid),
            ).fetchone()
            if r is None:
                return None
            mods = self._conn.execute(
                "SELECT id, type, position FROM profile_modules WHERE profile_id=? ORDER BY position",
                (pid,),
            ).fetchall()
        return {
            "id": r[0], "name": r[1], "created_at": r[2],
            "modules": [{"id": m[0], "type": m[1], "position": m[2]} for m in mods],
        }

    def add_module(self, pid: str, type_: str) -> dict:
        mid, ts = _new_id(), _now()
        with self._lock, self._conn as c:
            pos = c.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM profile_modules WHERE profile_id=?",
                (pid,),
            ).fetchone()[0]
            c.execute(
                "INSERT INTO profile_modules(id, profile_id, type, position, created_at) VALUES(?,?,?,?,?)",
                (mid, pid, type_, pos, ts),
            )
        return {"id": mid, "type": type_, "position": pos}

    def remove_module(self, user_id: str, pid: str, mid: str) -> None:
        # Removes the instance and its OVERWRITE config state. Its append-only
        # events are deliberately LEFT INTACT — progress/clinical data outlives the
        # module that produced it.
        with self._lock, self._conn as c:
            c.execute("DELETE FROM profile_modules WHERE id=? AND profile_id=?", (mid, pid))
            c.execute(
                "DELETE FROM state WHERE user_id=? AND profile_id=? AND key=?",
                (user_id, pid, mid),
            )

    # ---------------------------------------------------------- media sources
    # Per-user registry of connected media folders. The `base_url` points at a
    # user-run media agent; the platform stores only this reference and never the
    # bytes. Ownership is enforced by user_id on every read/write.
    def create_source(self, user_id: str, label: str, base_url: str, kind: str) -> dict:
        sid, ts = _new_id(), _now()
        with self._lock, self._conn as c:
            c.execute(
                "INSERT INTO media_sources(id, user_id, label, base_url, kind, created_at) VALUES(?,?,?,?,?,?)",
                (sid, user_id, label, base_url, kind, ts),
            )
        return {"id": sid, "label": label, "base_url": base_url, "kind": kind, "created_at": ts}

    def list_sources(self, user_id: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, label, base_url, kind, created_at FROM media_sources "
                "WHERE user_id=? ORDER BY created_at",
                (user_id,),
            ).fetchall()
        return [
            {"id": r[0], "label": r[1], "base_url": r[2], "kind": r[3], "created_at": r[4]}
            for r in rows
        ]

    def get_source(self, user_id: str, sid: str) -> dict | None:
        with self._lock:
            r = self._conn.execute(
                "SELECT id, label, base_url, kind, created_at FROM media_sources WHERE user_id=? AND id=?",
                (user_id, sid),
            ).fetchone()
        if r is None:
            return None
        return {"id": r[0], "label": r[1], "base_url": r[2], "kind": r[3], "created_at": r[4]}

    def remove_source(self, user_id: str, sid: str) -> bool:
        with self._lock, self._conn as c:
            cur = c.execute(
                "DELETE FROM media_sources WHERE user_id=? AND id=?", (user_id, sid)
            )
        return cur.rowcount > 0

    # ----------------------------------------------- overwrite state (LWW + version)
    def get_state(self, user_id: str, pid: str, key: str) -> dict:
        with self._lock:
            r = self._conn.execute(
                "SELECT data, version FROM state WHERE user_id=? AND profile_id=? AND key=?",
                (user_id, pid, key),
            ).fetchone()
        if r is None:
            return {"data": {}, "version": 0}
        return {"data": json.loads(r[0]), "version": r[1]}

    def put_state(self, user_id: str, pid: str, key: str, data: dict, base_version: int):
        """Optimistic concurrency. Returns ("ok", {...}) or ("conflict", {...})."""
        payload, ts = json.dumps(data), _now()
        with self._lock, self._conn as c:
            r = c.execute(
                "SELECT data, version FROM state WHERE user_id=? AND profile_id=? AND key=?",
                (user_id, pid, key),
            ).fetchone()
            current = r[1] if r else 0
            if base_version != current:
                current_data = json.loads(r[0]) if r else {}
                return ("conflict", {"data": current_data, "version": current})
            new_version = current + 1
            c.execute(
                """
                INSERT INTO state(user_id, profile_id, key, data, version, updated_at)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(user_id, profile_id, key)
                DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at
                """,
                (user_id, pid, key, payload, new_version, ts),
            )
        return ("ok", {"data": data, "version": new_version})

    # ------------------------------------------------------ append-only events
    def append_event(self, user_id: str, pid: str, stream: str, kind: str, data: dict) -> dict:
        payload, ts = json.dumps(data), _now()
        with self._lock, self._conn as c:
            cur = c.execute(
                "INSERT INTO events(user_id, profile_id, stream, kind, data, created_at) VALUES(?,?,?,?,?,?)",
                (user_id, pid, stream, kind, payload, ts),
            )
            eid = cur.lastrowid
        return {"id": eid, "kind": kind, "data": data, "created_at": ts}

    def list_events(self, user_id: str, pid: str, stream: str, limit: int = 50) -> dict:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT id, kind, data, created_at FROM events
                WHERE user_id=? AND profile_id=? AND stream=?
                ORDER BY id DESC LIMIT ?
                """,
                (user_id, pid, stream, limit),
            ).fetchall()
            total = self._conn.execute(
                "SELECT COUNT(*) FROM events WHERE user_id=? AND profile_id=? AND stream=?",
                (user_id, pid, stream),
            ).fetchone()[0]
        events = [
            {"id": r[0], "kind": r[1], "data": json.loads(r[2]), "created_at": r[3]}
            for r in rows
        ][::-1]  # chronological (oldest first) for display
        return {"events": events, "total": total}
