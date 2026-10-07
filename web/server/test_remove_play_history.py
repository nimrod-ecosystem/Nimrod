"""remove_play_history.py against a scratch database built by the real schema code (db.py SQLiteStore).

    py -3.13 test_remove_play_history.py

Row 2.58: play history leaves the server. This proves the script removes ONLY play-log rows, changes nothing on a
dry run or a wrong count, puts the append-only trigger back exactly as it was, and that the narrow trigger it uses
in between would refuse any other delete even if the script itself chose a wrong row. The Postgres path is checked
by the statements it sends (there is no local Postgres here, as db.py's own header says).
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

import remove_play_history as rp
from db import SQLiteStore

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t):
    print(f"\n-- {t}")


tmp = tempfile.mkdtemp(prefix="nimrod_remove_plays_")
try:
    # ------------------------------------------------------------ the shapes
    section("which rows are play history, by shape")
    check("a panel's play {id, at}", rp.is_play_history("0f3c9a", {"id": "dQw4w9WgXcQ", "at": 1759800000000}))
    check("a panel's play with only an id", rp.is_play_history("0f3c9a", {"id": "photos/a.jpg"}))
    check("plays.js's shape on stream `plays`", rp.is_play_history("plays", {"source": "spotify", "id": "spotify:track:1", "panel": "m"}))
    check("*** NOT a `play` row with other keys (somebody else's kind of play): left alone ***",
          not rp.is_play_history("gameplay", {"id": "x", "score": 3}) and not rp.is_play_history("s", {"at": 1})
          and not rp.is_play_history("s", "text") and not rp.is_play_history("s", None))
    check("plays.js's shape off its own stream is not taken for it", not rp.is_play_history("0f3c9a", {"source": "youtube", "id": "x"}))

    # ------------------------------------------------------------ a scratch database, the real schema
    def build(name):
        path = os.path.join(tmp, name)
        s = SQLiteStore(path)
        u, other = "mike@example.org", "someone@example.org"
        for i in range(7):
            s.append_event(u, "screen-1", "panel-yt", "play", {"id": f"v{i}", "at": 1759800000000 + i})
        for i in range(3):
            s.append_event(u, "screen-1", "panel-ph", "play", {"id": f"photos/p{i}.jpg", "at": 1759800000000 + i})
        s.append_event(other, "screen-9", "panel-x", "play", {"id": "v9", "at": 1})
        s.append_event(u, "screen-1", "plays", "play", {"source": "youtube", "id": "v1", "panel": "panel-yt"})
        s.append_event(u, "screen-1", "panel-yt", "held", {"id": "v1", "at": 5, "afterMs": 60000})
        s.append_event(u, "screen-1", "gameplay", "trial", {"ms": 812, "ok": True})
        s.append_event(u, "screen-1", "aac", "pressed", {"word": "drink"})
        s.append_event(u, "screen-1", "gameplay", "play", {"id": "round-3", "score": 9})     # a `play` of another shape
        return path, s

    def counts(path):
        c = sqlite3.connect(path)
        out = dict(c.execute("SELECT kind, COUNT(*) FROM events GROUP BY kind").fetchall())
        trig = c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='events_no_delete'").fetchone()
        upd = c.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='events_no_update'").fetchone()
        c.close()
        return out, trig and trig[0], upd and upd[0]

    path, store = build("a.db")
    before, trig0, upd0 = counts(path)
    check("the scratch database: 13 play rows (12 play-log shaped), plus held, trial, pressed",
          before == {"play": 13, "held": 1, "trial": 1, "pressed": 1}, str(before))
    check("it has the append-only triggers db.py made", trig0 and "events are append-only" in trig0 and upd0)

    # ------------------------------------------------------------ the dry run
    section("*** the dry run counts and changes nothing ***")
    db = rp.SQLiteDB(path)
    s, other = rp.dry_run(db)
    db.close()
    check("12 play-log rows chosen, from 4 panels... on 2 screens, 2 accounts", s["count"] == 12 and s["accounts"] == 2
          and s["screens"] == 2 and s["panels"] == 4, json.dumps({k: v for k, v in s.items() if k != "ids"}))
    check("the `play` row of another shape is counted as left alone, by its keys", s["left_alone"] == {"id,score": 1}, str(s["left_alone"]))
    text = rp.report(s, other, "SQLite")
    check("the report names no account, screen or item", "mike@" not in text and "screen-1" not in text and "v1" not in text, text)
    code = rp.main(["--sqlite", path])
    check("main() without --apply: exit 0, nothing changed", code == 0 and counts(path) == (before, trig0, upd0))

    # ------------------------------------------------------------ refusals that change nothing
    section("*** --apply without the right count changes nothing ***")
    check("--apply with no --expect: refused", rp.main(["--sqlite", path, "--apply"]) == 2 and counts(path) == (before, trig0, upd0))
    check("--apply --expect 11 (not what is there): refused, nothing changed, trigger as it was",
          rp.main(["--sqlite", path, "--apply", "--expect", "11"]) == 1 and counts(path) == (before, trig0, upd0))

    section("*** the narrow trigger: even a wrong row chosen by the script is refused by the database ***")
    db = rp.SQLiteDB(path)
    trial_id = db.conn.execute("SELECT id FROM events WHERE kind='trial'").fetchone()[0]
    play_ids = [r[0] for r in db.conn.execute("SELECT id FROM events WHERE kind='play' ORDER BY id").fetchall()]
    # The script's own DELETE also says kind = 'play'; this drives the window directly with a DELETE that does not,
    # to prove the database itself refuses a non-play row while the narrow trigger stands.
    db.begin()
    original = db.trigger_def()
    db.narrow()
    try:
        db.conn.execute("DELETE FROM events WHERE id = ?", (trial_id,))
        refused = False
    except sqlite3.IntegrityError as e:
        refused = "append-only" in str(e)
    except sqlite3.DatabaseError as e:
        refused = "append-only" in str(e)
    ok_play = db.conn.execute("DELETE FROM events WHERE id = ?", (play_ids[0],)).rowcount == 1
    db.rollback()
    db.close()
    check("*** inside the window a game result still cannot be deleted ***", refused)
    check("...while a `play` row can", ok_play)
    check("...and rolling back put everything back, trigger included", counts(path) == (before, trig0, upd0))
    db = rp.SQLiteDB(path)
    try:
        rp.remove(db, 12, _ids_for_test=[play_ids[0], trial_id])
        threw = False
    except rp.Stop:
        threw = True
    db.close()
    check("*** remove() handed a non-play id deletes fewer than chosen, stops, and rolls back ***",
          threw and counts(path) == (before, trig0, upd0))

    # ------------------------------------------------------------ the real run
    section("*** --apply --expect 12: the play log goes, everything else stays, the trigger is back as it was ***")
    backup = os.path.join(tmp, "plays_backup.jsonl")
    code = rp.main(["--sqlite", path, "--apply", "--expect", "12", "--save", backup])
    after, trig1, upd1 = counts(path)
    check("exit 0", code == 0)
    check("only the play-of-another-shape is left of kind play; held, trial and pressed untouched",
          after == {"play": 1, "held": 1, "trial": 1, "pressed": 1}, str(after))
    check("*** the append-only trigger is exactly as it was (and the update trigger untouched) ***", trig1 == trig0 and upd1 == upd0, f"{trig1!r}")
    c = sqlite3.connect(path)
    try:
        c.execute("DELETE FROM events WHERE kind='trial'")
        still = False
    except sqlite3.DatabaseError as e:
        still = "append-only" in str(e)
    try:
        c.execute("DELETE FROM events WHERE kind='play'")       # the one left is a play too: still refused
        still_play = False
    except sqlite3.DatabaseError as e:
        still_play = "append-only" in str(e)
    c.close()
    check("*** afterwards a delete is refused again - of any kind, `play` included ***", still and still_play)
    saved = [json.loads(line) for line in open(backup, encoding="utf-8")]
    check("--save kept the 12 rows on this machine first, data and all", len(saved) == 12
          and all(r["kind"] == "play" and "id" in r["data"] for r in saved))
    check("--save will not overwrite a file", rp.main(["--sqlite", path, "--apply", "--expect", "0", "--save", backup]) == 1)
    check("run again: nothing left to remove (the dry run says 0)", rp.main(["--sqlite", path]) == 0
          and rp.main(["--sqlite", path, "--apply", "--expect", "0"]) == 0 and counts(path)[0] == after)
    path2, store2 = build("b.db")
    fresh = counts(path2)[1]
    check("the trigger left behind is the one a brand-new database gets from db.py", trig1 == fresh, f"{trig1!r} vs {fresh!r}")
    check("the store still works after (an event appends)", store.append_event("mike@example.org", "screen-1", "gameplay", "trial", {"ms": 1})["id"] > 0)

    # ------------------------------------------------------------ Postgres, by the statements it sends
    section("Postgres: the same five steps, in one transaction, by the statements it sends")
    PG_DEF = "CREATE TRIGGER events_no_delete BEFORE DELETE ON public.events FOR EACH ROW EXECUTE FUNCTION events_append_only()"

    class FakeCursor:
        def __init__(self, log, play_rows):
            self.log, self.play_rows, self.last, self.rowcount, self.trig = log, play_rows, None, 0, PG_DEF

        def execute(self, sql, params=()):
            self.log.append((sql, tuple(params)))
            self.last = sql
            if sql.startswith("DELETE"):
                self.rowcount = len(params) - 1
            if sql == rp.PG_NARROW:
                self.trig = "narrow"
            if sql == PG_DEF:
                self.trig = PG_DEF

        def fetchall(self):
            if "FROM events WHERE kind" in self.last:
                return self.play_rows
            if "COUNT(*)" in self.last:
                return [(0,)]
            return []

        def fetchone(self):
            return (self.trig,) if "pg_get_triggerdef" in self.last else None

    class FakeConn:
        def __init__(self, log, rows):
            self.log, self.rows, self.done = log, rows, []

        def cursor(self):
            return FakeCursor(self.log, self.rows)

        def commit(self):
            self.done.append("commit")

        def rollback(self):
            self.done.append("rollback")

        def close(self):
            pass

    log = []
    rows = [(i, "u", "s", "p", json.dumps({"id": f"v{i}", "at": i}), "2026-10-01") for i in range(1, 4)]
    conn = FakeConn(log, rows)
    pg = rp.PostgresDB("postgresql://unused", connect=lambda dsn, autocommit: conn)
    out = rp.remove(pg, 3)
    sqls = [q for q, _ in log]
    order = [next((i for i, q in enumerate(sqls) if q.startswith(p)), -1) for p in
             ("SET LOCAL lock_timeout", "SELECT id, user_id", "SELECT pg_get_triggerdef", "DROP TRIGGER events_no_delete ON events",
              rp.PG_NARROW, "DELETE FROM events WHERE kind = %s AND id IN")]
    check("lock timeout, look, read the trigger, drop, narrow, delete - in that order", order == sorted(order) and -1 not in order, str(order))
    check("*** the narrow trigger still refuses every delete but kind `play` ***", "WHEN (OLD.kind <> 'play')" in rp.PG_NARROW
          and "events_append_only()" in rp.PG_NARROW)
    check("the delete is by id AND kind play", any(q.startswith("DELETE") and p[0] == "play" and p[1:] == (1, 2, 3) for q, p in log))
    check("*** then the ORIGINAL definition, as the database gave it, is put back; then commit ***",
          sqls.index(PG_DEF) > sqls.index(rp.PG_NARROW) and conn.done == ["commit"] and out["removed"] == 3)
    log2 = []
    conn2 = FakeConn(log2, rows)
    pg2 = rp.PostgresDB("x", connect=lambda dsn, autocommit: conn2)
    try:
        rp.remove(pg2, 4)
        stopped = False
    except rp.Stop:
        stopped = True
    check("a wrong --expect on Postgres: stopped before touching the trigger, rolled back",
          stopped and conn2.done == ["rollback"] and not any(q.startswith("DROP") for q, _ in log2))
    log3 = []
    conn3 = FakeConn(log3, rows)
    s3, _ = rp.dry_run(rp.PostgresDB("x", connect=lambda dsn, autocommit: conn3))
    check("*** the dry run on Postgres only reads (no DROP, no DELETE) and ends in a rollback ***",
          s3["count"] == 3 and conn3.done == ["rollback"]
          and not any(q.startswith(("DROP", "DELETE", "CREATE")) for q, _ in log3), str([q for q, _ in log3]))
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
