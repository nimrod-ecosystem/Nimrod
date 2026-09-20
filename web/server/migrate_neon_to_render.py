"""One-time data migration: copy every row out of the old Neon database and into the
new Render-managed Postgres database, table by table. Run once during the Neon -> Render
cutover (2026-09-19), then this file has no further job — safe to delete afterward, or
leave as a reference for the next provider move.

Schema is NOT copied here. web/server/db.py's own PostgresStore._migrate() already
creates every table (it runs at import time, module-tested, the same code that bootstraps
a brand-new deploy) — this script imports and calls it against the DESTINATION so the
schema is bootstrapped by the real code path, not a second, drifting copy of the DDL.

ADDITIVE ONLY — never deletes or overwrites anything already in the destination. Found
necessary the first time this ran for real: DATABASE_URL had already been cut over to the
new (then-empty) Render database by the blueprint deploy, and a live kiosk had already
written one row (a pairing-code request) before the historical copy ran. Any real cutover
has this same gap — the destination isn't guaranteed empty by the time you get to run this
— so the copy has to coexist with whatever's already live there, not demand a blank slate.
For each table: rows whose primary key already exists in the destination are left alone
(whatever's live wins) and skipped; everything else is inserted. Safe to re-run.

Usage (both env vars are connection strings — never pass these on the command line where
they'd land in shell history; export them first):

    export SOURCE_DATABASE_URL="postgresql://...neon.tech/..."   # the OLD Neon database
    export DEST_DATABASE_URL="postgresql://...render.com/..."    # the NEW Render Postgres
    py -3.13 migrate_neon_to_render.py
"""
import os
import sys

# Same order db.py's own _migrate() creates them in - not load-bearing (no FK constraints
# are declared anywhere in this schema) but keeps the copy readable in dependency order.
# Primary key column(s) per table - used to detect what's already in the destination
# without touching or reprinting it (some of these, e.g. device_keys.key, ARE the secret
# credential value, so callers of this map must never print the key values themselves).
TABLE_PKS = {
    "drive_grants": ("id",),
    "links": ("id",),
    "link_permissions": ("id",),
    "people": ("id",),
    "profiles": ("id",),
    "pairings": ("code",),
    "screen_pairings": ("code",),
    "device_keys": ("key",),
    "media_sources": ("id",),
    "profile_modules": ("id",),
    "state": ("user_id", "profile_id", "key"),
    "events": ("id",),
    "sessions": ("id",),
    "session_roster": ("id",),
}
TABLES = list(TABLE_PKS)


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

    ok = True
    with psycopg.connect(source_url) as src, psycopg.connect(dest_url) as dst:
        for table in TABLES:
            pk_cols = TABLE_PKS[table]
            pk_list = ", ".join(pk_cols)

            with src.cursor() as scur:
                scur.execute(f"SELECT * FROM {table}")
                rows = scur.fetchall()
                columns = [d.name for d in scur.description]
            pk_idx = [columns.index(c) for c in pk_cols]

            with dst.cursor() as dcur:
                dcur.execute(f"SELECT {pk_list} FROM {table}")
                existing_pks = {tuple(r) for r in dcur.fetchall()}

            if not rows:
                print(f"{table}: source has 0 rows, {len(existing_pks)} already in "
                      "destination - nothing to copy")
                continue

            new_rows = [r for r in rows if tuple(r[i] for i in pk_idx) not in existing_pks]
            overlap = len(rows) - len(new_rows)

            if new_rows:
                placeholders = ", ".join(["%s"] * len(columns))
                col_list = ", ".join(columns)
                with dst.cursor() as dcur:
                    dcur.executemany(
                        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders})",
                        new_rows)
            dst.commit()

            note = f" ({overlap} already present, left alone)" if overlap else ""
            print(f"{table}: source={len(rows)} inserted={len(new_rows)}{note}")

        # events.id is BIGSERIAL - explicit-id inserts never advance the sequence, so the
        # very next auto-id INSERT would collide with the highest id now in the table.
        # Advance it once, after the copy, whether that max came from Neon or from live
        # rows already there.
        with dst.cursor() as dcur:
            dcur.execute(
                "SELECT setval(pg_get_serial_sequence('events', 'id'), "
                "COALESCE((SELECT MAX(id) FROM events), 1))")
        dst.commit()

    print("\nVerifying: every source row is now present in the destination ...")
    with psycopg.connect(source_url) as src, psycopg.connect(dest_url) as dst:
        for table in TABLES:
            pk_cols = TABLE_PKS[table]
            pk_list = ", ".join(pk_cols)
            with src.cursor() as scur:
                scur.execute(f"SELECT {pk_list} FROM {table}")
                source_pks = {tuple(r) for r in scur.fetchall()}
            with dst.cursor() as dcur:
                dcur.execute(f"SELECT {pk_list} FROM {table}")
                dest_pks = {tuple(r) for r in dcur.fetchall()}
            missing = source_pks - dest_pks
            if missing:
                ok = False
                print(f"  {table}: MISSING {len(missing)} row(s) from the destination")
            else:
                print(f"  {table}: OK ({len(source_pks)} source rows all present)")

    if not ok:
        print("\nAt least one table is missing rows the source has - do not treat this "
              "migration as complete.", file=sys.stderr)
        return 1
    print("\nEvery row from Neon is present in the new Render database "
          "(plus whatever was already live there). Migration complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
