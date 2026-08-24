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


# A PERSON's scope in the state/events tables. Those tables are keyed
# (user_id, profile_id, key) where user_id is the ACCOUNT; per-person rows reuse the
# profile_id column with a reserved value. Real profile ids are uuid4().hex - 32 hex
# characters - so a value starting with an underscore can never collide, and neither
# table has a foreign key to profiles. That is the whole trick: per-person state needs
# no new table. 38 characters, so it still satisfies the server's id pattern.
LEGACY_PERSON_SCOPE = "_user"          # what per-user rows used before people existed


def person_scope(person_id: str) -> str:
    return f"_user_{person_id}"


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

    # ---------------------------------------------------------------- people
    # THE PERSON LAYER.  Account -> Person -> { Screens, Bindings, Output routing }.
    #
    # An ACCOUNT is who signs in (a Google sub, or a paired device key). A PERSON is who
    # the screen is FOR. They are not the same and conflating them was costing real
    # structure: a moderator running two residents' screens had one set of input bindings
    # between them, and "whose screen is this?" had no answer.
    #
    # NAMING, because it will otherwise confuse someone forever: the ``user_id`` column
    # on every other table is the ACCOUNT. It predates this layer, it is load-bearing on
    # live data, and renaming it across two engines is a mechanical pass worth doing on
    # its own day - not smuggled into the change that introduces the concept. So the new
    # thing is ``person``/``people`` throughout, and ``user_id`` keeps meaning account.
    # (The handoff calls this a "User"; the UI calls it a person, which is also the word
    # the AT field uses - Matching Person & Technology.)
    def create_person(self, account_id: str, name: str) -> dict:
        pid, ts = _new_id(), _now()
        with self._tx() as cur:
            cur.execute(self._q("INSERT INTO people(id, account_id, name, created_at) VALUES(?,?,?,?)"),
                        (pid, account_id, name, ts))
        return {"id": pid, "name": name, "created_at": ts}

    def list_people(self, account_id: str) -> list[dict]:
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, name, created_at FROM people WHERE account_id=? ORDER BY created_at"),
                        (account_id,))
            rows = cur.fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    def get_person(self, account_id: str, person_id: str) -> dict | None:
        """Ownership gate: only the owning account ever sees a person."""
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, name, created_at FROM people WHERE account_id=? AND id=?"),
                        (account_id, person_id))
            r = cur.fetchone()
        return None if r is None else {"id": r[0], "name": r[1], "created_at": r[2]}

    def rename_person(self, account_id: str, person_id: str, name: str) -> None:
        with self._tx() as cur:
            cur.execute(self._q("UPDATE people SET name=? WHERE id=? AND account_id=?"),
                        (name, person_id, account_id))

    def count_person_screens(self, account_id: str, person_id: str) -> int:
        with self._tx() as cur:
            cur.execute(self._q("SELECT COUNT(*) FROM profiles WHERE user_id=? AND person_id=?"),
                        (account_id, person_id))
            return cur.fetchone()[0]

    def delete_person(self, account_id: str, person_id: str) -> None:
        """Remove a person and their per-person settings (bindings, output routing).

        The CALLER must have refused this if they still have screens - see app.py. A
        delete that silently took N screens with it is exactly the destructive surprise
        this project avoids, so the refusal lives at the edge where it can explain
        itself. Their append-only events are left in place; the trigger forbids deleting
        them, and that is the point."""
        scope = person_scope(person_id)
        with self._tx() as cur:
            cur.execute(self._q("DELETE FROM state WHERE user_id=? AND profile_id=?"), (account_id, scope))
            cur.execute(self._q("DELETE FROM people WHERE id=? AND account_id=?"), (person_id, account_id))

    def ensure_default_person(self, account_id: str, name: str = "Me") -> str:
        """Return this account's first person, creating one if the account has none.

        LAZY, NOT A BOOT MIGRATION. Every account that predates this layer has data
        hanging off the account directly, and this is where it gets adopted - on the
        first request that needs a person, per account, idempotently. That works
        identically on the SQLite dev file and on the live Postgres without a separate
        migration script anyone has to remember to run.

        Two adoptions happen here:
          * every screen with no person becomes this person's;
          * legacy per-user STATE rows (scope "_user" - input bindings and output
            routing, the things that actually matter) are re-keyed to this person.

        Legacy per-user EVENTS are deliberately left behind. The append-only trigger
        forbids updating them, and the only per-user stream is the `remote` output
        channel's notification mailbox - transient messages, not a record worth
        contorting the schema to rescue.
        """
        with self._tx() as cur:
            cur.execute(self._q("SELECT id FROM people WHERE account_id=? ORDER BY created_at LIMIT 1"),
                        (account_id,))
            r = cur.fetchone()
            if r is not None:
                return r[0]
            pid, ts = _new_id(), _now()
            cur.execute(self._q("INSERT INTO people(id, account_id, name, created_at) VALUES(?,?,?,?)"),
                        (pid, account_id, name, ts))
            cur.execute(self._q(
                "UPDATE profiles SET person_id=? WHERE user_id=? AND (person_id IS NULL OR person_id='')"),
                (pid, account_id))
            # The target scope is brand new, so this can never collide with an existing
            # (user_id, profile_id, key) primary key.
            cur.execute(self._q("UPDATE state SET profile_id=? WHERE user_id=? AND profile_id=?"),
                        (person_scope(pid), account_id, LEGACY_PERSON_SCOPE))
        return pid

    # ---------------------------------------------------------------- profiles
    # A screen BELONGS TO A PERSON, and that is what lets the kiosk stay dumb: it is
    # opened as kiosk.html?profile=<id>, so if the screen names its person then the kiosk
    # needs no person-picking step at all. A shared device works with zero device-side UI.
    def create_profile(self, user_id: str, name: str, person_id: str = "") -> dict:
        pid, ts = _new_id(), _now()
        with self._tx() as cur:
            cur.execute(self._q("INSERT INTO profiles(id, user_id, person_id, name, created_at) VALUES(?,?,?,?,?)"),
                        (pid, user_id, person_id, name, ts))
        return {"id": pid, "name": name, "person_id": person_id, "created_at": ts}

    def list_profiles(self, user_id: str, person_id: str | None = None) -> list[dict]:
        """All the account's screens, or just one person's.

        The filter is OPTIONAL on purpose. The home shell asks per person; anything that
        legitimately wants the whole account (the kiosk's "any screen will do" fallback)
        still gets it, and every row names its person either way."""
        sql = "SELECT id, name, person_id, created_at FROM profiles WHERE user_id=?"
        params: tuple = (user_id,)
        if person_id:
            sql += " AND person_id=?"
            params = (user_id, person_id)
        with self._tx() as cur:
            cur.execute(self._q(sql + " ORDER BY created_at"), params)
            rows = cur.fetchall()
        return [{"id": r[0], "name": r[1], "person_id": r[2] or "", "created_at": r[3]} for r in rows]

    def get_profile(self, user_id: str, pid: str) -> dict | None:
        """Ownership is enforced here: only the owning user sees a profile."""
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, name, person_id, created_at FROM profiles WHERE user_id=? AND id=?"),
                        (user_id, pid))
            r = cur.fetchone()
            if r is None:
                return None
            cur.execute(self._q("SELECT id, type, position FROM profile_modules WHERE profile_id=? ORDER BY position"),
                        (pid,))
            mods = cur.fetchall()
        return {
            "id": r[0], "name": r[1], "person_id": r[2] or "", "created_at": r[3],
            "modules": [{"id": m[0], "type": m[1], "position": m[2]} for m in mods],
        }

    def rename_profile(self, user_id: str, pid: str, name: str) -> None:
        with self._tx() as cur:
            cur.execute(self._q("UPDATE profiles SET name=? WHERE id=? AND user_id=?"),
                        (name, pid, user_id))

    def move_profile(self, user_id: str, pid: str, person_id: str) -> None:
        with self._tx() as cur:
            cur.execute(self._q("UPDATE profiles SET person_id=? WHERE id=? AND user_id=?"),
                        (person_id, pid, user_id))

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
                CREATE TABLE IF NOT EXISTS people (
                    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS ix_people_account ON people(account_id);

                CREATE TABLE IF NOT EXISTS profiles (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
                    created_at TEXT NOT NULL, person_id TEXT NOT NULL DEFAULT ''
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
            # A database created before the person layer has `profiles` without the
            # column. CREATE TABLE IF NOT EXISTS will not add it, so do it here - guarded,
            # because SQLite has no ADD COLUMN IF NOT EXISTS. This must run BEFORE the
            # index on that column, which is why the index is not in the script above.
            cols = {r[1] for r in self._conn.execute("PRAGMA table_info(profiles)")}
            if "person_id" not in cols:
                self._conn.execute("ALTER TABLE profiles ADD COLUMN person_id TEXT NOT NULL DEFAULT ''")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_profiles_person ON profiles(person_id)")
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
            "CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, "
            "name TEXT NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_people_account ON people(account_id)",

            "CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
            "name TEXT NOT NULL, created_at TEXT NOT NULL, person_id TEXT NOT NULL DEFAULT '')",
            # The live database predates the person layer, so the column has to be added
            # to the existing table. Postgres has the guard built in; SQLite does not.
            "ALTER TABLE profiles ADD COLUMN IF NOT EXISTS person_id TEXT NOT NULL DEFAULT ''",
            "CREATE INDEX IF NOT EXISTS ix_profiles_user ON profiles(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_profiles_person ON profiles(person_id)",

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
