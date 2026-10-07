"""Remove the play history already on the server: one time, by Mike, after a dry run. Row 2.58.

Mike, 2026-10-07: "This is the kind of data people should keep on their own system though." Which photo, video
or song played when now stays on the device that played it (client/plays.js), and the server refuses it
(storage_line.py rule 4). This removes the rows that arrived before that: event kind `play`.

*** NOTHING HERE RUNS BY ITSELF. *** It is not called by the app, at boot or anywhere else. It changes nothing
unless it is given --apply AND --expect with the count its own dry run printed.

WHAT IT REMOVES, AND ONLY THAT:
  * rows of kind `play` whose data is a play log: `{id, at}` (what the six players appended to their panels'
    events), or plays.js's shape on stream `plays` (`{source, id, panel?, screen?, title?, by?}`, never written
    to the server, listed for completeness);
  * a `play` row of any other shape is NOT removed; the dry run counts it and says so;
  * nothing of any other kind: game results, the talk board's words, `held` notices, notes - all stay.

THE APPEND-ONLY TRIGGER (`events_no_delete`, db.py) IS NOT CHANGED FOR ANYTHING ELSE, EVER. Inside ONE
transaction, the script:
  1. reads the trigger's own definition as the database has it (so it puts back exactly what was there);
  2. replaces it with a NARROW one that still refuses every delete EXCEPT a row of kind `play` - so even a
     mistake in step 3 cannot remove anything else (the database itself refuses);
  3. deletes the chosen rows by id (and kind `play`, again), and checks the count is exactly what was chosen;
  4. puts the original trigger back, from step 1, and checks the definition matches;
  5. commits. Any failure anywhere rolls the whole thing back: rows AND trigger, as if it never ran.
On Postgres the transaction holds the events table's lock from step 2 to 5, so nothing else can write or delete
an event while the narrow trigger exists; the site's own reads and writes of events wait a few seconds.
`lock_timeout` makes the script give up (and change nothing) rather than wait behind a long request.

USAGE (from web/server, with the same connection the site uses; never put the address on the command line,
where it lands in shell history - export it first, as migrate_neon_to_render.py says):

    export DATABASE_URL="postgresql://..."          # production: Render's Postgres
    py -3.13 remove_play_history.py                  # DRY RUN: counts only, changes nothing
    py -3.13 remove_play_history.py --save plays_backup.jsonl --apply --expect 12345

    py -3.13 remove_play_history.py --sqlite path/to/nimrod.db      # a SQLite file instead (dev)

`--save FILE` (optional) first writes the rows being removed to FILE on this machine, one JSON object a line, so
the history is kept on Mike's own system rather than nowhere. The order that matters (row 2.58's report):
deploy the refusal first, let each screen open once so it brings its rows down, then the dry run, then --apply.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys

PLAY_KIND = "play"
PLAYS_STREAM = "plays"
TRIGGER = "events_no_delete"
# The play log the six players appended to a panel's own events, and plays.js's shape (stream `plays`).
PANEL_PLAY_KEYS = frozenset({"id", "at"})
STREAM_PLAY_KEYS = frozenset({"source", "id", "panel", "screen", "title", "by"})
CHUNK = 500                      # ids per DELETE: well under both engines' parameter limits

SQLITE_NARROW = (f"CREATE TRIGGER {TRIGGER} BEFORE DELETE ON events WHEN OLD.kind <> '{PLAY_KIND}' "
                 "BEGIN SELECT RAISE(ABORT, 'events are append-only'); END")
PG_NARROW = (f"CREATE TRIGGER {TRIGGER} BEFORE DELETE ON events FOR EACH ROW WHEN (OLD.kind <> '{PLAY_KIND}') "
             "EXECUTE FUNCTION events_append_only()")
PG_TRIGGER_DEF = ("SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid "
                  f"WHERE c.relname = 'events' AND t.tgname = '{TRIGGER}' AND NOT t.tgisinternal")


class Stop(Exception):
    """A reason to change nothing, said in a sentence."""


def is_play_history(stream: str, data) -> bool:
    """Is this `play` row a play log (and so play history), by its shape? A dict with an `id`, and only the keys
    one of the two writers ever wrote."""
    if not isinstance(data, dict) or data.get("id") in (None, ""):
        return False
    keys = set(data)
    if stream == PLAYS_STREAM:
        return "source" in keys and keys <= STREAM_PLAY_KEYS
    return keys <= PANEL_PLAY_KEYS


def survey(rows) -> dict:
    """What a dry run says, from (id, user_id, profile_id, stream, data_text, created_at) rows of kind `play`.
    Counts only: no account, screen or item is named."""
    chosen, odd_shapes = [], {}
    users, screens, streams, times = set(), set(), set(), []
    for rid, user, pid, stream, text, created in rows:
        try:
            data = json.loads(text)
        except (TypeError, ValueError):
            data = None
        if is_play_history(stream, data):
            chosen.append(rid)
            users.add(user)
            screens.add((user, pid))
            streams.add((user, pid, stream))
            if created:
                times.append(created)
        else:
            shape = ",".join(sorted(data)) if isinstance(data, dict) else type(data).__name__
            odd_shapes[shape] = odd_shapes.get(shape, 0) + 1
    return {"ids": sorted(chosen), "count": len(chosen), "accounts": len(users), "screens": len(screens),
            "panels": len(streams), "oldest": min(times) if times else None, "newest": max(times) if times else None,
            "left_alone": odd_shapes}


def report(s: dict, other_on_plays: int, engine: str) -> str:
    lines = [f"Database: {engine}",
             f"Play history rows to remove: {s['count']:,}"]
    if s["count"]:
        lines.append(f"  from {s['panels']:,} panels on {s['screens']:,} screens, {s['accounts']:,} accounts")
        lines.append(f"  oldest {s['oldest']}, newest {s['newest']}")
    if s["left_alone"]:
        lines.append("Rows of kind 'play' LEFT ALONE because they are not shaped like a play log:")
        for shape, n in sorted(s["left_alone"].items()):
            lines.append(f"  {n:,} with keys [{shape}]")
    if other_on_plays:
        lines.append(f"Rows on stream 'plays' of another kind, left alone: {other_on_plays:,}")
    return "\n".join(lines)


# ---------------------------------------------------------------- the two engines
class SQLiteDB:
    engine = "sqlite"

    def __init__(self, path: str):
        if not os.path.exists(path):
            raise Stop(f"No database file at {path}.")
        self.path = path
        self.conn = sqlite3.connect(path, isolation_level=None)   # transactions are begun and ended here, by hand

    def label(self):
        return f"SQLite file {self.path}"

    def begin(self):
        self.conn.execute("BEGIN IMMEDIATE")      # the write lock now: nothing else writes until COMMIT/ROLLBACK

    def commit(self):
        self.conn.execute("COMMIT")

    def rollback(self):
        try:
            self.conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass

    def rows(self, sql, params=()):
        return self.conn.execute(sql.replace("%s", "?"), params).fetchall()

    def execute(self, sql, params=()):
        return self.conn.execute(sql.replace("%s", "?"), params).rowcount

    def trigger_def(self):
        r = self.conn.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?", (TRIGGER,)).fetchone()
        return r[0] if r else None

    def narrow(self):
        self.conn.execute(f"DROP TRIGGER {TRIGGER}")
        self.conn.execute(SQLITE_NARROW)

    def restore(self, definition):
        self.conn.execute(f"DROP TRIGGER {TRIGGER}")
        self.conn.execute(definition)

    def close(self):
        self.conn.close()


class PostgresDB:
    engine = "postgres"

    def __init__(self, dsn: str, connect=None):
        if connect is None:
            import psycopg          # the driver db.py uses on Render; imported only when Postgres is asked for
            connect = psycopg.connect
        self.conn = connect(dsn, autocommit=False)
        self.cur = self.conn.cursor()

    def label(self):
        return "Postgres (DATABASE_URL)"

    def begin(self):
        # psycopg begins a transaction with the first statement; this bounds how long the script waits for the
        # events table's lock before giving up (and changing nothing).
        self.cur.execute("SET LOCAL lock_timeout = '5s'")

    def commit(self):
        self.conn.commit()

    def rollback(self):
        try:
            self.conn.rollback()
        except Exception:  # noqa: BLE001 - the connection is gone; nothing was committed
            pass

    def rows(self, sql, params=()):
        self.cur.execute(sql, params)
        return self.cur.fetchall()

    def execute(self, sql, params=()):
        self.cur.execute(sql, params)
        return self.cur.rowcount

    def trigger_def(self):
        self.cur.execute(PG_TRIGGER_DEF)
        r = self.cur.fetchone()
        return r[0] if r else None

    def narrow(self):
        self.cur.execute(f"DROP TRIGGER {TRIGGER} ON events")
        self.cur.execute(PG_NARROW)

    def restore(self, definition):
        self.cur.execute(f"DROP TRIGGER {TRIGGER} ON events")
        self.cur.execute(definition)

    def close(self):
        self.conn.close()


# ---------------------------------------------------------------- the two steps
def look(db) -> tuple[dict, int]:
    rows = db.rows("SELECT id, user_id, profile_id, stream, data, created_at FROM events WHERE kind = %s", (PLAY_KIND,))
    other = db.rows("SELECT COUNT(*) FROM events WHERE stream = %s AND kind <> %s", (PLAYS_STREAM, PLAY_KIND))[0][0]
    return survey(rows), other


def dry_run(db) -> tuple[dict, int]:
    """Count, in a transaction that is rolled back: reads only."""
    db.begin()
    try:
        return look(db)
    finally:
        db.rollback()


def save_rows(db, ids, path) -> int:
    """The rows being removed, to a file on this machine (one JSON object a line). Never overwrites one."""
    n = 0
    with open(path, "x", encoding="utf-8") as f:
        for i in range(0, len(ids), CHUNK):
            part = ids[i:i + CHUNK]
            marks = ",".join(["%s"] * len(part))
            for rid, user, pid, stream, kind, text, created in db.rows(
                    f"SELECT id, user_id, profile_id, stream, kind, data, created_at FROM events WHERE id IN ({marks})",
                    tuple(part)):
                f.write(json.dumps({"id": rid, "user_id": user, "profile_id": pid, "stream": stream, "kind": kind,
                                    "data": json.loads(text), "created_at": created}) + "\n")
                n += 1
    return n


def remove(db, expect: int, save: str | None = None, _ids_for_test=None) -> dict:
    """Steps 1-5 of the header, in one transaction. Raises Stop (or the database's own error) having changed
    nothing; returns what it did."""
    if save and os.path.exists(save):
        raise Stop(f"{save} already exists; choose another name. Nothing was changed.")
    db.begin()
    try:
        s, _ = look(db)
        if s["count"] != expect:
            raise Stop(f"The dry run said {expect:,} rows; there are {s['count']:,} now. Nothing was changed. If plays "
                       "are still arriving, the deploy that refuses them is not live yet; run the dry run again.")
        ids = list(_ids_for_test) if _ids_for_test is not None else s["ids"]
        if not ids:
            db.rollback()
            return {"removed": 0, "saved": None}
        original = db.trigger_def()
        if not original:
            raise Stop(f"The database has no {TRIGGER} trigger, which every Nimrod database has. Nothing was changed; "
                       "check this is the right database.")
        saved = save_rows(db, ids, save) if save else None
        db.narrow()                                                                      # 2
        gone = 0
        for i in range(0, len(ids), CHUNK):                                              # 3
            part = ids[i:i + CHUNK]
            marks = ",".join(["%s"] * len(part))
            gone += db.execute(f"DELETE FROM events WHERE kind = %s AND id IN ({marks})", (PLAY_KIND, *part))
        if gone != len(ids):
            raise Stop(f"{gone:,} rows were deleted where {len(ids):,} were chosen. Rolled back; nothing was changed.")
        db.restore(original)                                                             # 4
        if db.trigger_def() != original:
            raise Stop("The trigger did not come back exactly as it was. Rolled back; nothing was changed.")
        db.commit()                                                                      # 5
        return {"removed": gone, "saved": saved}
    except BaseException:
        db.rollback()
        raise


def open_db(sqlite_path: str | None):
    if sqlite_path:
        return SQLiteDB(sqlite_path)
    dsn = os.environ.get("DATABASE_URL")
    if dsn:
        return PostgresDB(dsn)
    path = os.environ.get("NIMROD_DB")
    if path:
        return SQLiteDB(path)
    raise Stop("Say which database: export DATABASE_URL (Postgres), or --sqlite PATH, or NIMROD_DB.")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Remove the play history already on the server (row 2.58). "
                                             "Without --apply it only counts.")
    ap.add_argument("--sqlite", help="a SQLite database file (otherwise DATABASE_URL, then NIMROD_DB)")
    ap.add_argument("--apply", action="store_true", help="remove them (needs --expect)")
    ap.add_argument("--expect", type=int, help="the count the dry run printed; anything else changes nothing")
    ap.add_argument("--save", help="first write the rows being removed to this file, on this machine")
    a = ap.parse_args(argv)
    try:
        db = open_db(a.sqlite)
    except Stop as e:
        print(e, file=sys.stderr)
        return 2
    try:
        if not a.apply:
            s, other = dry_run(db)
            print(report(s, other, db.label()))
            print("\nDRY RUN: nothing was changed.")
            if s["count"]:
                print(f"To remove them: add --apply --expect {s['count']} (and --save FILE to keep a copy here).")
            return 0
        if a.expect is None:
            print("--apply needs --expect N, where N is the count the dry run printed. Nothing was changed.",
                  file=sys.stderr)
            return 2
        done = remove(db, a.expect, a.save)
        if done["saved"] is not None:
            print(f"Saved {done['saved']:,} rows to {a.save}.")
        if not done["removed"]:
            print("No play history rows to remove. Nothing was changed.")
        else:
            print(f"Removed {done['removed']:,} play history rows. The append-only trigger is back exactly as it was.")
        return 0
    except Stop as e:
        print(e, file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
