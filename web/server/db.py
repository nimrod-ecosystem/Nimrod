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
"Bedside") and open any on any device.

TWO ENGINES, ONE LOGIC. All the business rules — optimistic concurrency, append-only
enforcement, per-user ownership — live ONCE in ``_Store`` and run identically on
SQLite (local dev) and Postgres (deploy). The subclasses supply only the driver: a
transaction cursor, the new-row id, the placeholder style, and the DDL. The store is
selected in app.py by ``DATABASE_URL`` (Postgres when set, else SQLite). Standard SQL
throughout (``INSERT ... ON CONFLICT ... DO UPDATE`` works in both); the only real
dialect deltas are the id column (AUTOINCREMENT vs BIGSERIAL), how you read a new id
back (lastrowid vs RETURNING), and the append-only trigger syntax.
"""
from __future__ import annotations

import contextlib
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex


class _Store:
    """Engine-agnostic logic shared by SQLiteStore and PostgresStore."""

    _pg = False   # subclass flag: True -> convert '?' placeholders to '%s'

    def _q(self, sql: str) -> str:
        return sql.replace("?", "%s") if self._pg else sql

    # ---- driver hooks (subclass provides these) ----
    def _tx(self):                                   # contextmanager -> DB cursor
        raise NotImplementedError

    def _returning_id(self, cur, sql, params):       # INSERT + return the new id
        raise NotImplementedError

    def _migrate(self) -> None:
        raise NotImplementedError

    # ---------------------------------------------------------------- health
    def ping(self) -> None:
        """Cheapest possible round-trip to the database. Raises if it is unreachable.

        Exists so /api/healthz can distinguish "the app is up" from "the app is up but
        the database is not" WITHOUT a login. Every real endpoint needs auth, so before
        this the only way to see a DB outage was to sign in and watch the UI break."""
        with self._tx() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()

    # ---------------------------------------------------------------- profiles
    def create_profile(self, user_id: str, name: str) -> dict:
        pid, ts = _new_id(), _now()
        with self._tx() as cur:
            cur.execute(self._q("INSERT INTO profiles(id, user_id, name, created_at) VALUES(?,?,?,?)"),
                        (pid, user_id, name, ts))
        return {"id": pid, "name": name, "created_at": ts}

    def list_profiles(self, user_id: str) -> list[dict]:
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, name, created_at FROM profiles WHERE user_id=? ORDER BY created_at"),
                        (user_id,))
            rows = cur.fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    def get_profile(self, user_id: str, pid: str) -> dict | None:
        """Ownership is enforced here: only the owning user sees a profile."""
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, name, created_at FROM profiles WHERE user_id=? AND id=?"),
                        (user_id, pid))
            r = cur.fetchone()
            if r is None:
                return None
            cur.execute(self._q("SELECT id, type, position FROM profile_modules WHERE profile_id=? ORDER BY position"),
                        (pid,))
            mods = cur.fetchall()
        return {
            "id": r[0], "name": r[1], "created_at": r[2],
            "modules": [{"id": m[0], "type": m[1], "position": m[2]} for m in mods],
        }

    def rename_profile(self, user_id: str, pid: str, name: str) -> None:
        with self._tx() as cur:
            cur.execute(self._q("UPDATE profiles SET name=? WHERE id=? AND user_id=?"),
                        (name, pid, user_id))

    def delete_profile(self, user_id: str, pid: str) -> None:
        """Delete a profile, its module instances, and their overwrite state.

        EVENTS ARE NOT TOUCHED — a DB trigger forbids deleting them, and that is the
        point: the points ledger and gameplay telemetry are the RECORD, and deleting a
        screen must not be a way to quietly erase a score. The rows are left in place,
        keyed to a profile id that no longer resolves. Callers should tell the user this
        before they confirm, because it also means the history is not coming back when
        they make a new screen.
        """
        with self._tx() as cur:
            cur.execute(self._q("DELETE FROM profile_modules WHERE profile_id=?"), (pid,))
            cur.execute(self._q("DELETE FROM state WHERE user_id=? AND profile_id=?"), (user_id, pid))
            cur.execute(self._q("DELETE FROM profiles WHERE id=? AND user_id=?"), (pid, user_id))

    def add_module(self, pid: str, type_: str) -> dict:
        mid, ts = _new_id(), _now()
        with self._tx() as cur:
            cur.execute(self._q("SELECT COALESCE(MAX(position), -1) + 1 FROM profile_modules WHERE profile_id=?"),
                        (pid,))
            pos = cur.fetchone()[0]
            cur.execute(self._q("INSERT INTO profile_modules(id, profile_id, type, position, created_at) VALUES(?,?,?,?,?)"),
                        (mid, pid, type_, pos, ts))
        return {"id": mid, "type": type_, "position": pos}

    def remove_module(self, user_id: str, pid: str, mid: str) -> None:
        # Removes the instance and its OVERWRITE config state. Its append-only
        # events are deliberately LEFT INTACT — progress/clinical data outlives the
        # module that produced it.
        with self._tx() as cur:
            cur.execute(self._q("DELETE FROM profile_modules WHERE id=? AND profile_id=?"), (mid, pid))
            cur.execute(self._q("DELETE FROM state WHERE user_id=? AND profile_id=? AND key=?"), (user_id, pid, mid))

    # ---------------------------------------------------------- media sources
    # Per-user registry of connected media folders. The `base_url` points at a
    # user-run media agent; the platform stores only this reference and never the
    # bytes. Ownership is enforced by user_id on every read/write.
    def create_source(self, user_id: str, label: str, base_url: str, kind: str) -> dict:
        sid, ts = _new_id(), _now()
        with self._tx() as cur:
            cur.execute(self._q("INSERT INTO media_sources(id, user_id, label, base_url, kind, created_at) VALUES(?,?,?,?,?,?)"),
                        (sid, user_id, label, base_url, kind, ts))
        return {"id": sid, "label": label, "base_url": base_url, "kind": kind, "created_at": ts}

    def list_sources(self, user_id: str) -> list[dict]:
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, label, base_url, kind, created_at FROM media_sources WHERE user_id=? ORDER BY created_at"),
                        (user_id,))
            rows = cur.fetchall()
        return [{"id": r[0], "label": r[1], "base_url": r[2], "kind": r[3], "created_at": r[4]} for r in rows]

    def get_source(self, user_id: str, sid: str) -> dict | None:
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, label, base_url, kind, created_at FROM media_sources WHERE user_id=? AND id=?"),
                        (user_id, sid))
            r = cur.fetchone()
        if r is None:
            return None
        return {"id": r[0], "label": r[1], "base_url": r[2], "kind": r[3], "created_at": r[4]}

    def remove_source(self, user_id: str, sid: str) -> bool:
        with self._tx() as cur:
            cur.execute(self._q("DELETE FROM media_sources WHERE user_id=? AND id=?"), (user_id, sid))
            n = cur.rowcount
        return n > 0

    # ----------------------------------------------- overwrite state (LWW + version)
    def get_state(self, user_id: str, pid: str, key: str) -> dict:
        with self._tx() as cur:
            cur.execute(self._q("SELECT data, version FROM state WHERE user_id=? AND profile_id=? AND key=?"),
                        (user_id, pid, key))
            r = cur.fetchone()
        if r is None:
            return {"data": {}, "version": 0}
        return {"data": json.loads(r[0]), "version": r[1]}

    def put_state(self, user_id: str, pid: str, key: str, data: dict, base_version: int):
        """Optimistic concurrency. Returns ("ok", {...}) or ("conflict", {...})."""
        payload, ts = json.dumps(data), _now()
        with self._tx() as cur:
            cur.execute(self._q("SELECT data, version FROM state WHERE user_id=? AND profile_id=? AND key=?"),
                        (user_id, pid, key))
            r = cur.fetchone()
            current = r[1] if r else 0
            if base_version != current:
                current_data = json.loads(r[0]) if r else {}
                return ("conflict", {"data": current_data, "version": current})
            new_version = current + 1
            cur.execute(self._q(
                "INSERT INTO state(user_id, profile_id, key, data, version, updated_at) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(user_id, profile_id, key) "
                "DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at"),
                (user_id, pid, key, payload, new_version, ts))
        return ("ok", {"data": data, "version": new_version})

    # ------------------------------------------------------ append-only events
    def append_event(self, user_id: str, pid: str, stream: str, kind: str, data: dict) -> dict:
        payload, ts = json.dumps(data), _now()
        with self._tx() as cur:
            eid = self._returning_id(cur, self._q(
                "INSERT INTO events(user_id, profile_id, stream, kind, data, created_at) VALUES(?,?,?,?,?,?)"),
                (user_id, pid, stream, kind, payload, ts))
        return {"id": eid, "kind": kind, "data": data, "created_at": ts}

    def list_events(self, user_id: str, pid: str, stream: str, limit: int = 50) -> dict:
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, kind, data, created_at FROM events "
                "WHERE user_id=? AND profile_id=? AND stream=? ORDER BY id DESC LIMIT ?"),
                (user_id, pid, stream, limit))
            rows = cur.fetchall()
            cur.execute(self._q("SELECT COUNT(*) FROM events WHERE user_id=? AND profile_id=? AND stream=?"),
                        (user_id, pid, stream))
            total = cur.fetchone()[0]
        events = [
            {"id": r[0], "kind": r[1], "data": json.loads(r[2]), "created_at": r[3]} for r in rows
        ][::-1]  # chronological (oldest first) for display
        return {"events": events, "total": total}


class SQLiteStore(_Store):
    """Local-dev engine. One connection + a lock (the coordination server is tiny)."""

    _pg = False

    def __init__(self, path: str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    @contextlib.contextmanager
    def _tx(self):
        with self._lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            except BaseException:
                self._conn.rollback()
                raise
            finally:
                cur.close()

    def _returning_id(self, cur, sql, params):
        cur.execute(sql, params)
        return cur.lastrowid

    def _migrate(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS profiles (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_profiles_user ON profiles(user_id);

                CREATE TABLE IF NOT EXISTS media_sources (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
                    base_url TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_media_sources_user ON media_sources(user_id);

                CREATE TABLE IF NOT EXISTS profile_modules (
                    id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, type TEXT NOT NULL,
                    position INTEGER NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_pm_profile ON profile_modules(profile_id);

                CREATE TABLE IF NOT EXISTS state (
                    user_id TEXT NOT NULL, profile_id TEXT NOT NULL, key TEXT NOT NULL,
                    data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, profile_id, key)
                );

                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL, profile_id TEXT NOT NULL, stream TEXT NOT NULL,
                    kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_events_stream ON events(user_id, profile_id, stream, id);
                CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
                    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
                    BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
                """
            )
            self._conn.commit()


class PostgresStore(_Store):
    """Deploy engine (Neon / any Postgres). A small pooled connection; the SAME
    ``_Store`` logic runs on top. Its live smoke is the deploy step (docs/deploy.md
    Part B) — there is no local Postgres in dev to run it against here."""

    _pg = True

    def __init__(self, dsn: str):
        # Lazy import so this module still imports (and SQLite dev/tests still run)
        # when psycopg isn't installed. psycopg[binary] + psycopg-pool ship on Render.
        from psycopg_pool import ConnectionPool
        # `check` is NOT optional against a serverless Postgres. Neon suspends an idle
        # database and drops its connections; without a check the pool keeps handing out
        # dead ones and EVERY DB request 500s until the process restarts. check_connection
        # validates (and silently replaces) a connection before it is handed over.
        # `max_idle` retires connections before they rot, so the check rarely has to fire.
        self._pool = ConnectionPool(
            conninfo=dsn, min_size=1, max_size=5,
            kwargs={"autocommit": False},
            check=ConnectionPool.check_connection,
            max_idle=120.0,
        )
        self._pool.wait()
        self._migrate()

    @contextlib.contextmanager
    def _tx(self):
        # psycopg3: the connection block commits on clean exit, rolls back on error.
        with self._pool.connection() as conn:
            with conn.cursor() as cur:
                yield cur

    def _returning_id(self, cur, sql, params):
        cur.execute(sql + " RETURNING id", params)
        return cur.fetchone()[0]

    def _migrate(self) -> None:
        stmts = [
            "CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
            "name TEXT NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_profiles_user ON profiles(user_id)",

            "CREATE TABLE IF NOT EXISTS media_sources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
            "label TEXT NOT NULL, base_url TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_media_sources_user ON media_sources(user_id)",

            "CREATE TABLE IF NOT EXISTS profile_modules (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, "
            "type TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_pm_profile ON profile_modules(profile_id)",

            "CREATE TABLE IF NOT EXISTS state (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, key TEXT NOT NULL, "
            "data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, "
            "PRIMARY KEY (user_id, profile_id, key))",

            "CREATE TABLE IF NOT EXISTS events (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, "
            "profile_id TEXT NOT NULL, stream TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, "
            "created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_events_stream ON events(user_id, profile_id, stream, id)",

            # append-only teeth: a trigger function that aborts any UPDATE/DELETE
            "CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger AS $$ "
            "BEGIN RAISE EXCEPTION 'events are append-only'; END; $$ LANGUAGE plpgsql",
            "DROP TRIGGER IF EXISTS events_no_update ON events",
            "CREATE TRIGGER events_no_update BEFORE UPDATE ON events "
            "FOR EACH ROW EXECUTE FUNCTION events_append_only()",
            "DROP TRIGGER IF EXISTS events_no_delete ON events",
            "CREATE TRIGGER events_no_delete BEFORE DELETE ON events "
            "FOR EACH ROW EXECUTE FUNCTION events_append_only()",
        ]
        with self._tx() as cur:
            for s in stmts:
                cur.execute(s)
