"""One-time data migration: copy every row out of the old Neon database and into the
new Render-managed Postgres database, table by table. Run once during the Neon -> Render
cutover (2026-09-19), then this file has no further job — safe to delete afterward, or
leave as a reference for the next provider move.

Schema is NOT copied here. web/server/db.py's own PostgresStore._migrate() already
creates every table (it runs at import time, module-tested, the same code that bootstraps
a brand-new deploy) — this script imports and calls it against the DESTINATION so the
schema is bootstrapped by the real code path, not a second, drifting copy of the DDL.

Usage (both env vars are connection strings — never pass these on the command line where
they'd land in shell history; export them first):

    export SOURCE_DATABASE_URL="postgresql://...neon.tech/..."   # the OLD Neon database
    export DEST_DATABASE_URL="postgresql://...render.com/..."    # the NEW Render Postgres
    py -3.13 migrate_neon_to_render.py

Refuses to run if the destination already has rows in any of these tables — this is meant
to run against a freshly bootstrapped, empty Render database exactly once. If you need to
re-run it (a partial copy, a mistake), truncate the destination tables first and re-run;
this script does not attempt to merge or dedupe.
"""
import os
import sys

# Same order db.py's own _migrate() creates them in - not load-bearing (no FK constraints
# are declared anywhere in this schema) but keeps the copy readable in dependency order.
TABLES = [
    "drive_grants", "links", "link_permissions", "people", "profiles", "pairings",
    "screen_pairings", "device_keys", "media_sources", "profile_modules", "state",
    "events", "sessions", "session_roster",
]


def main() -> int:
    source_url = os.environ.get("SOURCE_DATABASE_URL")
    dest_url = os.environ.get("DEST_DATABASE_URL")
    if not source_url or not dest_url:
        print("Set SOURCE_DATABASE_URL (old Neon) and DEST_DATABASE_URL (new Render "
              "Postgres) before running this.", file=sys.stderr)
        return 1

    import psycopg

    # Bootstrap the destination schema using the real, tested migration code - not a
    # second copy of the DDL that could drift from db.py.
    sys.path.insert(0, os.path.dirname(__file__))
    from db import PostgresStore
    print("Bootstrapping destination schema via PostgresStore._migrate() ...")
    PostgresStore(dest_url)
    print("Destination schema ready.\n")

    with psycopg.connect(source_url) as src, psycopg.connect(dest_url) as dst:
        # Refuse to run against a destination that already has data - this script does a
        # plain INSERT, not an upsert, and a second run would either duplicate rows or
        # fail confusingly on a primary key collision. Fail clearly, up front, instead.
        with dst.cursor() as check:
            nonempty = []
            for table in TABLES:
                check.execute(f"SELECT count(*) FROM {table}")
                if check.fetchone()[0] > 0:
                    nonempty.append(table)
            if nonempty:
                print(f"Destination already has rows in: {', '.join(nonempty)}. Refusing "
                      "to run - truncate those tables first if you really mean to redo "
                      "this copy.", file=sys.stderr)
                return 1

        totals = {}
        for table in TABLES:
            with src.cursor() as scur:
                scur.execute(f"SELECT * FROM {table}")
                rows = scur.fetchall()
                columns = [d.name for d in scur.description]
            if not rows:
                totals[table] = 0
                print(f"{table}: 0 rows (nothing to copy)")
                continue
            placeholders = ", ".join(["%s"] * len(columns))
            col_list = ", ".join(columns)
            with dst.cursor() as dcur:
                dcur.executemany(
                    f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})", rows)
            totals[table] = len(rows)
            print(f"{table}: copied {len(rows)} rows")
        dst.commit()

        # events.id is BIGSERIAL - the explicit inserts above set real values but never
        # advanced the sequence, so the very next INSERT without an explicit id would
        # collide with the highest copied id. Advance it now, once, after the copy.
        with dst.cursor() as dcur:
            dcur.execute(
                "SELECT setval(pg_get_serial_sequence('events', 'id'), "
                "COALESCE((SELECT MAX(id) FROM events), 1))")
        dst.commit()

    print("\nVerifying row counts (source vs destination) ...")
    ok = True
    with psycopg.connect(source_url) as src, psycopg.connect(dest_url) as dst:
        for table in TABLES:
            with src.cursor() as scur, dst.cursor() as dcur:
                scur.execute(f"SELECT count(*) FROM {table}")
                dcur.execute(f"SELECT count(*) FROM {table}")
                s_count, d_count = scur.fetchone()[0], dcur.fetchone()[0]
                match = "OK" if s_count == d_count else "MISMATCH"
                if s_count != d_count:
                    ok = False
                print(f"  {table}: source={s_count} dest={d_count}  {match}")

    if not ok:
        print("\nRow count mismatch somewhere above - do NOT flip DATABASE_URL over to "
              "the new database until this is resolved.", file=sys.stderr)
        return 1
    print("\nAll tables match. Safe to point DATABASE_URL at the new Render database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
