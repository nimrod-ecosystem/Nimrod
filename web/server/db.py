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
import hmac
import json
import secrets
import sqlite3
import threading
import uuid

# Pure rules, no storage - db imports grants/links and never the other way round.
import grants
import links
import provenance
from datetime import datetime, timedelta, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _later(seconds: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


# THE PAIRING CODE ALPHABET. Six characters, and not six DIGITS — the same typing burden
# for a person, seven hundred times the search space (30^6 = 729 million against 10^6 = a
# single million). That matters because a guessed code attaches somebody ELSE's media
# agent to the guesser's account and hands them the contents of that folder, so the size
# of this space is a security parameter and not a style choice.
#
# EVERY AMBIGUOUS GLYPH IS SIMPLY ABSENT: no 0 or O, no 1 or I or L, no U (it is read as
# V in several common console fonts). The alternative — generating them and "helpfully"
# mapping O to 0 on the way in — is what Crockford base-32 does, and it is wrong here:
# it only works if one of each confusable pair is in the alphabet, and it still leaves a
# person staring at a character they cannot identify. If a glyph can be misread it is not
# generated, so there is nothing to correct and no wrong guess to make. The reader is
# someone squinting at a console in a care home.
PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"     # 30 characters
PAIR_CODE_LEN = 6
PAIR_TTL_SECONDS = 15 * 60      # long enough to walk to another room, short enough to matter


def _pair_code() -> str:
    return "".join(secrets.choice(PAIR_ALPHABET) for _ in range(PAIR_CODE_LEN))


def normalize_code(raw: str) -> str:
    """What a person typed, turned into what was generated.

    Case is irrelevant, and spaces and dashes are how people write a code down off a
    screen. Nothing is SUBSTITUTED — see the alphabet above: no ambiguous glyph is ever
    generated, so a typed O or 1 is a real misreading with no correct answer to map it to,
    and silently turning it into some other character would pair the wrong thing."""
    return "".join(str(raw or "").upper().split()).replace("-", "")[:32]


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

    def person_owner(self, person_id: str) -> str | None:
        """Which account owns this person - NOT scoped to the caller, on purpose.

        Every other person lookup here is ownership-gated, which is right. This one cannot
        be: a grantee has to be able to reach a person they do not own, and the room a
        socket joins is keyed by the OWNER. Callers must not treat a non-None answer as
        permission - grants.py decides that.
        """
        with self._tx() as cur:
            cur.execute(self._q("SELECT account_id FROM people WHERE id=?"), (person_id,))
            r = cur.fetchone()
        return None if r is None else r[0]

    # ---------------------------------------------------------------- drive grants
    #
    # Read grants.py first: the RULES live there, pure and tested on their own. This is
    # only storage. Nothing here decides whether somebody may drive - it hands rows to the
    # rule and the rule answers.

    def add_grant(self, owner_id: str, person_id: str, subject_kind: str, subject_id: str,
                  label: str = "", expires_at: str | None = None,
                  role: str | None = None) -> dict:
        """`role` is what the grant lets somebody BE once they are in - see grants.py.

        NORMALISED ON THE WAY IN, so storage never holds a role nothing understands. That is
        deliberately different from `subject_kind`, which is stored unvalidated precisely so a
        `group` grant can sit there inert until groups exist: a KIND decides whether somebody
        gets in at all and must fail closed, while a ROLE only narrows what an already
        authorised person may do.
        """
        gid, ts = _new_id(), _now()
        r = grants.normalize_role(role)
        with self._tx() as cur:
            cur.execute(self._q(
                "INSERT INTO drive_grants(id, owner_id, person_id, subject_kind, subject_id, "
                "label, expires_at, created_at, role) VALUES(?,?,?,?,?,?,?,?,?)"),
                (gid, owner_id, person_id, subject_kind, subject_id, label, expires_at, ts, r))
        return {"id": gid, "person_id": person_id, "subject_kind": subject_kind,
                "subject_id": subject_id, "label": label, "expires_at": expires_at,
                "created_at": ts, "role": r}

    def list_grants(self, owner_id: str, person_id: str) -> list[dict]:
        """Every grant on one person's screens - the owner's view of who may drive."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, person_id, subject_kind, subject_id, label, expires_at, created_at, role "
                "FROM drive_grants WHERE owner_id=? AND person_id=? ORDER BY created_at"),
                (owner_id, person_id))
            rows = cur.fetchall()
        return [self._grant_row(r) for r in rows]

    def grants_for_subject(self, subject_kind: str, subject_id: str) -> list[dict]:
        """Everything this subject has been granted - the grantee's view.

        Carries `owner_id` too, because the grantee needs it: person state and screens are
        keyed by the OWNING account, not by whoever is driving.
        """
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, person_id, subject_kind, subject_id, label, expires_at, created_at, owner_id, role "
                "FROM drive_grants WHERE subject_kind=? AND subject_id=? ORDER BY created_at"),
                (subject_kind, subject_id))
            rows = cur.fetchall()
        return [dict(self._grant_row(r), owner_id=r[7]) for r in rows]

    def grants_on_person(self, person_id: str) -> list[dict]:
        """Every grant on this person, whoever made it. What the auth check reads."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, person_id, subject_kind, subject_id, label, expires_at, created_at, owner_id, role "
                "FROM drive_grants WHERE person_id=?"), (person_id,))
            rows = cur.fetchall()
        return [dict(self._grant_row(r), owner_id=r[7]) for r in rows]

    def delete_grant(self, grant_id: str, *, owner_id: str = "", subject_id: str = "") -> int:
        """Revoke. EITHER side may end it: the owner takes it back, the grantee hands it
        back. Returns how many rows went, so the caller can 404 rather than pretend."""
        if not owner_id and not subject_id:
            return 0
        with self._tx() as cur:
            if owner_id:
                cur.execute(self._q("DELETE FROM drive_grants WHERE id=? AND owner_id=?"),
                            (grant_id, owner_id))
            else:
                cur.execute(self._q("DELETE FROM drive_grants WHERE id=? AND subject_id=?"),
                            (grant_id, subject_id))
            return cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0

    @staticmethod
    def _grant_row(r) -> dict:
        # `role` is read positionally like everything else, but DEFAULTED here as well as in
        # the schema: a row written before the column existed comes back as NULL, and a NULL
        # role would make a perfectly good grant confer nothing.
        # The three selects differ: the owner-facing one ends at role, the two grantee-facing
        # ones carry owner_id before it. Positional either way, and defaulted below.
        role = r[8] if len(r) > 8 else (r[7] if len(r) > 7 else None)
        return {"id": r[0], "person_id": r[1], "subject_kind": r[2], "subject_id": r[3],
                "label": r[4], "expires_at": r[5], "created_at": r[6],
                "role": grants.normalize_role(role)}

    # ---- CONNECTIONS -----------------------------------------------------
    # Read links.py first: the RULES live there, pure and tested on their own. This is
    # only storage. Nothing here decides whether somebody may do anything - it hands
    # rows to the rule and the rule answers.

    def create_link(self, a: str, b: str, created_by: str) -> dict:
        """Connect two accounts. Idempotent on the pair.

        A pair that was linked, broken, and is being linked again REUSES THE SAME ROW -
        the UNIQUE index on (account_lo, account_hi) means there is nowhere else to put
        it. Reviving clears `broken_at`, and because breaking DELETED the permissions
        (see `break_link`), the revived link starts with none. That is the safe direction:
        somebody who was cut off and later re-invited has to be re-granted, rather than
        silently getting back everything they had before the fallout.
        """
        lo, hi = links.canonical_pair(a, b)
        ts = _now()
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, account_lo, account_hi, created_by, created_at, broken_at, broken_by "
                "FROM links WHERE account_lo=? AND account_hi=?"), (lo, hi))
            row = cur.fetchone()
            if row:
                if row[5]:
                    cur.execute(self._q(
                        "UPDATE links SET broken_at=NULL, broken_by=NULL, created_by=?, created_at=? "
                        "WHERE id=?"), (created_by, ts, row[0]))
                    return {"id": row[0], "account_lo": lo, "account_hi": hi,
                            "created_by": created_by, "created_at": ts,
                            "broken_at": None, "broken_by": None, "revived": True}
                return self._link_row(row)
            lid = _new_id()
            cur.execute(self._q(
                "INSERT INTO links(id, account_lo, account_hi, created_by, created_at, "
                "broken_at, broken_by) VALUES(?,?,?,?,?,NULL,NULL)"), (lid, lo, hi, created_by, ts))
        return {"id": lid, "account_lo": lo, "account_hi": hi, "created_by": created_by,
                "created_at": ts, "broken_at": None, "broken_by": None}

    def get_link(self, a: str, b: str) -> dict | None:
        """The one row for this pair, broken or not. Callers ask links.link_is_active."""
        try:
            lo, hi = links.canonical_pair(a, b)
        except ValueError:
            return None
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, account_lo, account_hi, created_by, created_at, broken_at, broken_by "
                "FROM links WHERE account_lo=? AND account_hi=?"), (lo, hi))
            row = cur.fetchone()
        return self._link_row(row) if row else None

    def list_links(self, account: str) -> list[dict]:
        """This account's friends list. ACTIVE links only - a broken one is not a friend.

        Each row carries `other`, the account at the far end, because the caller should
        never have to work out which of lo/hi is the one it is looking at.
        """
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, account_lo, account_hi, created_by, created_at, broken_at, broken_by "
                "FROM links WHERE (account_lo=? OR account_hi=?) AND broken_at IS NULL "
                "ORDER BY created_at"), (account, account))
            rows = cur.fetchall()
        out = []
        for r in rows:
            d = self._link_row(r)
            d["other"] = d["account_hi"] if d["account_lo"] == account else d["account_lo"]
            out.append(d)
        return out

    def break_link(self, a: str, b: str, broken_by: str) -> int:
        """End the relationship. THE PERMISSIONS GO WITH IT.

        The design says removing a link takes every permission with it, and this deletes
        the rows rather than leaving them inert behind a failing link check. Inert rows
        would come back to life on any future re-link, which is the one moment somebody
        would least expect it.

        WHAT THIS DOES NOT TOUCH IS MESSAGE HISTORY, and that is a safeguarding decision,
        not a storage detail. Mike: *"In a case of harassment, you don't want someone to
        just be able to torch the evidence."* Breaking a link stops future messages; each
        side keeps its own copy of what was already said, and can never reach the other's.
        """
        try:
            lo, hi = links.canonical_pair(a, b)
        except ValueError:
            return 0
        ts = _now()
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id FROM links WHERE account_lo=? AND account_hi=? AND broken_at IS NULL"),
                (lo, hi))
            row = cur.fetchone()
            if not row:
                return 0
            cur.execute(self._q("DELETE FROM link_permissions WHERE link_id=?"), (row[0],))
            cur.execute(self._q("UPDATE links SET broken_at=?, broken_by=? WHERE id=?"),
                        (ts, broken_by, row[0]))
            return 1

    @staticmethod
    def _link_row(r) -> dict:
        return {"id": r[0], "account_lo": r[1], "account_hi": r[2], "created_by": r[3],
                "created_at": r[4], "broken_at": r[5], "broken_by": r[6]}

    # ---- the switches on a friend ----------------------------------------

    def add_link_permission(self, link_id: str, person_id: str, capability: str,
                            subject_id: str, subject_kind: str = "account",
                            expires_at: str | None = None) -> dict:
        """Turn one switch on. Idempotent per (link, person, capability, subject).

        `capability` is VALIDATED and raises on anything unrecognised - unlike
        `subject_kind`, which is stored unvalidated so a `group` row can sit there inert
        until groups exist. A kind decides whether somebody gets in at all and fails
        closed; a capability that nothing understands must never reach storage at all.

        `drive_screen` is refused here: it lives in drive_grants. See links.DELEGATED.
        """
        cap = links.normalize_capability(capability)
        if links.delegates(cap):
            raise links.UnknownCapability(
                f"{cap!r} is stored as a drive_grant, not a link permission")
        pid, ts = _new_id(), _now()
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id FROM link_permissions WHERE link_id=? AND person_id=? AND "
                "capability=? AND subject_kind=? AND subject_id=?"),
                (link_id, person_id, cap, subject_kind, subject_id))
            row = cur.fetchone()
            if row:
                cur.execute(self._q("UPDATE link_permissions SET expires_at=? WHERE id=?"),
                            (expires_at, row[0]))
                pid = row[0]
            else:
                cur.execute(self._q(
                    "INSERT INTO link_permissions(id, link_id, person_id, capability, "
                    "subject_kind, subject_id, expires_at, created_at) VALUES(?,?,?,?,?,?,?,?)"),
                    (pid, link_id, person_id, cap, subject_kind, subject_id, expires_at, ts))
        return {"id": pid, "link_id": link_id, "person_id": person_id, "capability": cap,
                "subject_kind": subject_kind, "subject_id": subject_id,
                "expires_at": expires_at, "created_at": ts}

    def list_link_permissions(self, link_id: str, person_id: str | None = None) -> list[dict]:
        """Every switch set on this link - what the settings-on-a-friend screen renders."""
        with self._tx() as cur:
            if person_id is None:
                cur.execute(self._q(
                    "SELECT id, link_id, person_id, capability, subject_kind, subject_id, "
                    "expires_at, created_at FROM link_permissions WHERE link_id=? "
                    "ORDER BY created_at"), (link_id,))
            else:
                cur.execute(self._q(
                    "SELECT id, link_id, person_id, capability, subject_kind, subject_id, "
                    "expires_at, created_at FROM link_permissions WHERE link_id=? AND person_id=? "
                    "ORDER BY created_at"), (link_id, person_id))
            rows = cur.fetchall()
        return [self._perm_row(r) for r in rows]

    def permissions_on_person(self, person_id: str) -> list[dict]:
        """Every permission on this person, whoever set it. What the auth check reads."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, link_id, person_id, capability, subject_kind, subject_id, "
                "expires_at, created_at FROM link_permissions WHERE person_id=?"), (person_id,))
            rows = cur.fetchall()
        return [self._perm_row(r) for r in rows]

    def delete_link_permission(self, perm_id: str, *, link_id: str = "") -> int:
        """Turn one switch off. Scoped by link_id so a caller cannot revoke across links."""
        with self._tx() as cur:
            if link_id:
                cur.execute(self._q("DELETE FROM link_permissions WHERE id=? AND link_id=?"),
                            (perm_id, link_id))
            else:
                cur.execute(self._q("DELETE FROM link_permissions WHERE id=?"), (perm_id,))
            return cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0

    @staticmethod
    def _perm_row(r) -> dict:
        return {"id": r[0], "link_id": r[1], "person_id": r[2], "capability": r[3],
                "subject_kind": r[4], "subject_id": r[5], "expires_at": r[6], "created_at": r[7]}

    def may_capability(self, capability: str, *, actor: str, person_id: str) -> bool:
        """The whole question, rows loaded and handed to the pure rule.

        Loads the person's owner, the link between actor and owner, and the permissions on
        the person - then `links.may` decides. Kept here so no endpoint has to remember
        which three things to fetch.
        """
        owner = self.person_owner(person_id)
        link = self.get_link(actor, owner) if owner and owner != actor else None
        return links.may(capability, actor=actor, person_id=person_id, owner=owner,
                         link=link, permissions=self.permissions_on_person(person_id),
                         now_iso=_now())

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

    # ------------------------------------------------------------- pairing
    # HOW A DEVICE JOINS AN ACCOUNT WITHOUT ANYONE TRANSCRIBING A URL.
    #
    # The old flow asked a person to read an IP address off one machine and type it into a
    # browser on another. That is an IT task wearing the clothes of a product, and it is
    # the reason the media agent was unusable by the people it exists for.
    #
    # Instead, the SIX-CHARACTER CODE, which is how Plex, Chromecast and Tailscale all do
    # this and why nobody transcribes a URL to use them:
    #
    #   1. the agent asks the platform for a code (unauthenticated - it has no account);
    #   2. it prints the code, and the addresses it thinks it can be reached at;
    #   3. the person types the code into the Media panel, signed in;
    #   4. the browser probes the addresses and keeps the one that answers.
    #
    # STEP 4 IS THE POINT. The agent does not know which of its addresses the browser can
    # actually reach - localhost only works when they are the same machine, a LAN address
    # only from the same network - and it has no way to find out. The BROWSER knows,
    # because it is the thing doing the reaching. So the agent offers candidates and the
    # browser decides, and the question "which address do I type" stops existing.
    #
    # A code is SINGLE USE and expires. Claiming requires a signed-in account, so the
    # attack to care about is guessing someone else's live code and attaching their agent
    # to your own account - which is why the alphabet is 32 characters wide, the window is
    # fifteen minutes, and app.py rate-limits wrong guesses per account.
    def create_pairing(self, agent_id: str, label: str, base_urls: list[str]) -> dict:
        code, ts = _pair_code(), _now()
        expires = _later(PAIR_TTL_SECONDS)
        with self._tx() as cur:
            cur.execute(self._q(
                "INSERT INTO pairings(code, agent_id, label, base_urls, created_at, expires_at, "
                "claimed_by, claimed_at) VALUES(?,?,?,?,?,?,?,?)"),
                (code, agent_id, label, json.dumps(base_urls), ts, expires, None, None))
        return {"code": code, "expires_at": expires}

    def get_pairing(self, code: str) -> dict | None:
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT code, agent_id, label, base_urls, created_at, expires_at, claimed_by, claimed_at "
                "FROM pairings WHERE code=?"), (code,))
            r = cur.fetchone()
        if r is None:
            return None
        return {"code": r[0], "agent_id": r[1], "label": r[2], "base_urls": json.loads(r[3]),
                "created_at": r[4], "expires_at": r[5], "claimed_by": r[6], "claimed_at": r[7]}

    def claim_pairing(self, code: str, account_id: str) -> tuple[str, dict | None]:
        """Consume a code for an account. Returns (status, pairing).

        Statuses: ok / unknown / expired / claimed. They are DISTINCT on purpose, because
        "that code has already been used" and "no such code" are different problems for
        the person standing there, and telling them the wrong one sends them to reinstall
        something that was working. The claim is a conditional UPDATE, so two browsers
        racing the same code cannot both win."""
        now = _now()
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT agent_id, label, base_urls, expires_at, claimed_by FROM pairings WHERE code=?"),
                (code,))
            r = cur.fetchone()
            if r is None:
                return ("unknown", None)
            if r[4]:
                return ("claimed", None)
            if now > r[3]:
                return ("expired", None)
            cur.execute(self._q(
                "UPDATE pairings SET claimed_by=?, claimed_at=? WHERE code=? AND claimed_by IS NULL"),
                (account_id, now, code))
            if cur.rowcount != 1:
                return ("claimed", None)      # somebody else took it between the read and the write
        return ("ok", {"agent_id": r[0], "label": r[1], "base_urls": json.loads(r[2])})

    def sweep_pairings(self) -> int:
        """Drop codes that are spent or long past. /api/pair/request is unauthenticated -
        anyone can create rows - so something has to bound the table, and a sweep on write
        is cheaper than a scheduled job on a server that may sleep. Claimed rows are kept
        for a while so a second attempt can still say "already used" rather than the much
        more confusing "no such code"."""
        cutoff = _later(-24 * 3600)
        with self._tx() as cur:
            cur.execute(self._q("DELETE FROM pairings WHERE expires_at < ? AND claimed_by IS NULL"),
                        (_now(),))
            n = cur.rowcount
            cur.execute(self._q("DELETE FROM pairings WHERE claimed_at IS NOT NULL AND claimed_at < ?"),
                        (cutoff,))
        return n

    # ------------------------------------------------- what we actually store
    # THE PRIVACY PAGE IS GENERATED FROM THIS, NOT WRITTEN BESIDE IT. Mike:
    #
    #   "The privacy list should maybe be linked to a live list or something. It could grow
    #    and we shouldn't act like what we have now is the full list forever."
    #
    # He is right, and the reason is a bug that had already happened: the landing page said
    # the server holds "your email address, the names of the screens you made, which modules
    # are on them, and a few hundred bytes of settings and scores - THAT IS ALL OF IT", and by
    # the time anybody re-read it the database also held A PERSON'S NAME, append-only event
    # streams, media-source URLs and drive grants. **The strongest claim on the page had
    # quietly become false**, and the page invites people to check.
    #
    # *** SO THE ANTI-DRIFT MECHANISM IS THE POINT, NOT THE TEXT. *** `describe_storage`
    # reads the REAL table list out of the database and joins it to these descriptions. A
    # table nobody has described comes back flagged as undocumented and SAYS SO ON THE PUBLIC
    # PAGE. Adding a table without explaining it is therefore not a silent act - it publishes
    # its own omission.
    #
    # That is deliberately uncomfortable. It is meant to be.
    STORAGE_NOTES = {
        "profiles":        ("The screens you made, and what you called them.", False),
        "profile_modules": ("Which modules are on each screen, and in what order.", False),
        "state":           ("Settings for those modules - a photo interval, a theme, a "
                            "layout. Small, and yours.", False),
        "events":          ("An append-only log of what a module did: which photo was shown "
                            "when, a game result. It GROWS over time. Sensor readings, if you "
                            "run a logger, arrive here too.", True),
        "people":          ("The NAME you gave a person, so their screen can say who it is "
                            "for. This is the most personal thing here.", True),
        "media_sources":   ("A label and an ADDRESS for the folder your media lives in - a "
                            "pointer at your own machine. Never the files themselves.", True),
        "drive_grants":    ("Which other accounts you have allowed to drive a screen, and "
                            "until when.", True),
        "device_keys":     ("A credential for each unattended screen you set up, and the name "
                            "you gave it.", True),
        "links":           ("Who you are connected to - one entry for each pair of people. "
                            "It is a relationship, not a permission: it lasts until one of "
                            "you ends it.", True),
        "link_permissions": ("What each connection is allowed to do - send messages, call, "
                            "watch a screen, add photos. Each one can be switched off on its "
                            "own, and ending the connection removes them all.", True),
        "sessions":        ("When a play or therapy session started and ended, and how it "
                            "ended. It is what lets a result say who was in the room, without "
                            "tagging every single answer.", True),
        "session_roster":  ("Who was present for a session and in what part - playing, "
                            "helping, observing - and when they came and went.", True),
        "screen_pairings": ("A short-lived code while a screen is being set up. Deleted "
                            "afterwards.", False),
        "pairings":        ("A short-lived code while a media folder is being connected. "
                            "Deleted afterwards.", False),
        "will":            ("Legacy table, unused.", False),
    }

    # Said once, on the page, because it is the part that matters and it is still true.
    NEVER_STORED = [
        "your photos, videos or recordings - they stay on your machine",
        "camera feeds - they never leave the device",
        "your location",
        "browsing history",
        "advertising identifiers",
        "anything a module shows you that you did not save",
    ]

    def _table_names(self) -> list[str]:
        raise NotImplementedError

    def describe_storage(self) -> dict:
        """Every table that actually exists, joined to its description.

        THE UNDOCUMENTED CASE IS THE FEATURE. A table with no entry above comes back with
        `documented: False`, and the public page prints it as such rather than omitting it -
        so the page can go out of date in the direction of admitting more, never less.
        """
        rows = []
        for name in sorted(self._table_names()):
            note = self.STORAGE_NOTES.get(name)
            rows.append({
                "table": name,
                "what": note[0] if note else
                        "Not yet described. It exists, so it is listed - see the source.",
                "personal": bool(note[1]) if note else True,   # assume the worse until said
                "documented": note is not None,
            })
        return {
            "stores": rows,
            "never": list(self.NEVER_STORED),
            "undocumented": [r["table"] for r in rows if not r["documented"]],
        }

    # -------------------------------------------------------- screen pairing
    # UNATTENDED SCREENS. A bedside screen reboots at 3am and has to come back on its
    # own; it cannot type a password and there is nobody there to. So it holds a long
    # random DEVICE KEY and sends it as `X-Device-Key`.
    #
    # Those keys used to live ONLY in the server's `DEVICE_KEYS` environment variable,
    # which meant only somebody with the hosting dashboard could create one - so the
    # whole unattended-kiosk feature was founder-only, and a family wanting a screen for
    # their own relative could not have one without asking us. This is the fix.
    #
    # THE DANCE IS THE ONE THE MEDIA-AGENT PAIRING ALREADY PROVED, and deliberately so:
    #
    #   1. the screen, WITH NO ACCOUNT, asks for a code
    #   2. it shows the code and polls
    #   3. a signed-in person types the code on their phone
    #   4. the screen's next poll returns a key that is now bound to that account
    #
    # *** THE POLL TOKEN IS THE PART THAT IS NOT OBVIOUS, AND IT IS THE SECURITY OF THE
    # WHOLE FLOW. *** The CODE is displayed on a screen in a room, so anybody who walks
    # past can read it - that is fine for CLAIMING, because claiming requires being signed
    # in. It is NOT fine for COLLECTING: if the code alone were enough to fetch the minted
    # key, anyone who glimpsed it could take the credential the moment somebody claimed it.
    # So `request` also returns a secret the screen keeps to itself, and the key is handed
    # back only to something that can present it.
    def create_screen_pairing(self, label: str, ttl_s: int = 600) -> dict:
        """Mint an unclaimed code. Grants nothing until somebody signs in and claims it."""
        code = _pair_code()
        poll = secrets.token_urlsafe(32)
        ts, exp = _now(), _later(ttl_s)
        with self._tx() as cur:
            cur.execute(self._q(
                "INSERT INTO screen_pairings(code, label, poll_token, created_at, expires_at) "
                "VALUES(?,?,?,?,?)"), (code, label, poll, ts, exp))
        return {"code": code, "poll_token": poll, "expires_at": exp, "label": label}

    def screen_pairing_status(self, code: str, poll_token: str) -> tuple[str, str | None]:
        """("pending"|"claimed"|"unknown"|"expired", device_key_or_None).

        A WRONG OR MISSING POLL TOKEN IS "unknown", NOT "forbidden" - the same answer as a
        code that never existed. Distinguishing them would turn this into an oracle for
        "is that code real", which is exactly what somebody who read a code off a screen
        would want to know.
        """
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT poll_token, expires_at, claimed_by, device_key FROM screen_pairings "
                "WHERE code=?"), (code,))
            r = cur.fetchone()
        if r is None or not poll_token or not hmac.compare_digest(str(r[0]), str(poll_token)):
            return ("unknown", None)
        if r[2]:
            return ("claimed", r[3])
        if str(r[1]) <= _now():
            return ("expired", None)
        return ("pending", None)

    def claim_screen_pairing(self, code: str, account_id: str) -> tuple[str, dict | None]:
        """A signed-in person adopts the screen. Mints the key HERE, not at request time -
        an unclaimed row must never contain a usable credential."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT label, expires_at, claimed_by FROM screen_pairings WHERE code=?"),
                (code,))
            r = cur.fetchone()
            if r is None:
                return ("unknown", None)
            if r[2]:
                return ("claimed", None)
            if str(r[1]) <= _now():
                return ("expired", None)
            key = "nk_" + secrets.token_urlsafe(32)
            ts = _now()
            cur.execute(self._q(
                "INSERT INTO device_keys(key, user_id, label, created_at) VALUES(?,?,?,?)"),
                (key, account_id, r[0], ts))
            cur.execute(self._q(
                "UPDATE screen_pairings SET claimed_by=?, claimed_at=?, device_key=? "
                "WHERE code=? AND claimed_by IS NULL"), (account_id, ts, key, code))
            if cur.rowcount != 1:
                return ("claimed", None)     # somebody claimed it between the read and the write
        return ("ok", {"label": r[0]})

    def device_key_user(self, key: str) -> str | None:
        """Which account owns this key, or None. The database half of `X-Device-Key`."""
        if not key:
            return None
        with self._tx() as cur:
            cur.execute(self._q("SELECT user_id FROM device_keys WHERE key=?"), (key,))
            r = cur.fetchone()
        return r[0] if r else None

    def list_device_keys(self, user_id: str) -> list[dict]:
        """What screens this account has adopted. NEVER returns the secret - a list that
        hands back credentials is a list that leaks them into logs and screenshots."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT key, label, created_at, last_seen FROM device_keys WHERE user_id=? "
                "ORDER BY created_at"), (user_id,))
            rows = cur.fetchall()
        # An id a person can revoke by, derived from the secret rather than being it.
        return [{"id": r[0][-8:], "label": r[1], "created_at": r[2], "last_seen": r[3]}
                for r in rows]

    def revoke_device_key(self, user_id: str, key_id: str) -> bool:
        """Unadopt a screen. Immediate: the next request it makes is a 401.

        THE SUFFIX MATCH IS DONE IN PYTHON, NOT IN SQL. `substr(key, -8)` is SQLite;
        Postgres spells it differently, and a dialect difference hiding inside a REVOKE is
        the kind that gets discovered in production by somebody who could not turn a screen
        off. Both backends run the same code here.
        """
        if not key_id:
            return False
        with self._tx() as cur:
            cur.execute(self._q("SELECT key FROM device_keys WHERE user_id=?"), (user_id,))
            rows = cur.fetchall()
            hit = next((r[0] for r in rows if str(r[0])[-8:] == key_id), None)
            if hit is None:
                return False
            cur.execute(self._q("DELETE FROM device_keys WHERE key=? AND user_id=?"),
                        (hit, user_id))
            return cur.rowcount > 0

    def touch_device_key(self, key: str) -> None:
        """Last seen, so a list of screens can say which one has gone quiet."""
        with self._tx() as cur:
            cur.execute(self._q("UPDATE device_keys SET last_seen=? WHERE key=?"),
                        (_now(), key))

    def sweep_screen_pairings(self) -> int:
        """Unclaimed codes are worthless but they are rows, and /screen-pair/request is
        unauthenticated - so something has to bound the table."""
        with self._tx() as cur:
            cur.execute(self._q(
                "DELETE FROM screen_pairings WHERE expires_at < ? AND claimed_by IS NULL"),
                (_now(),))
            n = cur.rowcount
            cur.execute(self._q(
                "DELETE FROM screen_pairings WHERE claimed_at IS NOT NULL AND claimed_at < ?"),
                (_later(-24 * 3600),))
        return n

    # ---------------------------------------------------------- media sources
    # Per-account registry of connected media folders. The `base_url` points at a
    # user-run media agent; the platform stores only this reference and never the
    # bytes. Ownership is enforced by user_id on every read/write.
    #
    # `person_id` IS NULLABLE, AND NULL IS THE INTERESTING VALUE. An account with one
    # person - which is most of them - never sets it, and every source is simply the
    # account's. An account with several (a family, a facility, a clinician with a
    # caseload) needs Christine's photos to be HERS: on her screen, and not on
    # somebody else's, and not something another resident's family can browse.
    #
    #   NULL          the account's own. Visible to every person in it.
    #   a person id   that person's. Visible on their screens and nowhere else.
    #
    # NULL MEANS SHARED RATHER THAN ORPHANED, which is why the column could be added
    # without touching a single existing row: every source that existed before this
    # keeps behaving exactly as it did. The alternative - backfilling every source
    # onto whichever person happened to be first - would have silently taken media
    # away from screens that were showing it.
    #
    # WHAT THIS IS ACTUALLY FOR, corrected after Mike pushed back on an earlier version
    # of this comment that led with privacy:
    #
    #   1. ORGANISATION, and this is the honest primary. The right albums on the right
    #      screen. An account with several people needs Christine's photos to be what
    #      SHE sees rather than a merged pile of four residents' families.
    #   2. A boundary between UNRELATED ACCOUNTS - a facility whose residents did not
    #      choose each other. That is the case where the word privacy still applies, and
    #      it is enforced ACROSS accounts by user_id, which predates this column.
    #   3. Somewhere for permissions to hang later. "Who may see whose media" belongs on
    #      the grants table beside "who may drive", not as a column here.
    #
    # IT IS NOT MUCH OF A PRIVACY FEATURE WITHIN ONE ACCOUNT, and saying so kept the
    # reasoning honest: anyone standing in the room already sees the screen. Visual
    # privacy there was never something software could give back.
    def create_source(self, user_id: str, label: str, base_url: str, kind: str,
                      person_id: str | None = None) -> dict:
        sid, ts = _new_id(), _now()
        pid = person_id or None            # "" and None are the same thing: the account's
        with self._tx() as cur:
            cur.execute(self._q("INSERT INTO media_sources(id, user_id, label, base_url, kind, created_at, person_id) VALUES(?,?,?,?,?,?,?)"),
                        (sid, user_id, label, base_url, kind, ts, pid))
        return {"id": sid, "label": label, "base_url": base_url, "kind": kind,
                "created_at": ts, "person_id": pid}

    def list_sources(self, user_id: str, person_id: str | None = None,
                     shared_only: bool = False) -> list[dict]:
        """Every source this account owns, or the ones a given person's screen may use.

        `person_id` given  -> that person's sources PLUS the account-wide ones. That is
                              the union a screen wants: her own albums and the family
                              ones, with no way to reach another resident's.
        `person_id` None   -> everything the account owns, which is the management view.
        `shared_only`      -> just the account-wide ones.
        """
        sql = ("SELECT id, label, base_url, kind, created_at, person_id "
               "FROM media_sources WHERE user_id=?")
        args: list = [user_id]
        if shared_only:
            sql += " AND person_id IS NULL"
        elif person_id:
            sql += " AND (person_id IS NULL OR person_id=?)"
            args.append(person_id)
        sql += " ORDER BY created_at"
        with self._tx() as cur:
            cur.execute(self._q(sql), tuple(args))
            rows = cur.fetchall()
        return [self._source_row(r) for r in rows]

    @staticmethod
    def _source_row(r) -> dict:
        return {"id": r[0], "label": r[1], "base_url": r[2], "kind": r[3],
                "created_at": r[4], "person_id": (r[5] if len(r) > 5 else None) or None}

    def get_source(self, user_id: str, sid: str) -> dict | None:
        with self._tx() as cur:
            cur.execute(self._q("SELECT id, label, base_url, kind, created_at, person_id FROM media_sources WHERE user_id=? AND id=?"),
                        (user_id, sid))
            r = cur.fetchone()
        if r is None:
            return None
        return self._source_row(r)

    def set_source_person(self, user_id: str, sid: str, person_id: str | None) -> bool:
        """Move a source between "the account's" and "one person's".

        Both directions matter. Narrowing is the privacy fix; WIDENING is how a family
        photo folder that was set up on one person's screen becomes available on all of
        them, which is the commoner mistake and the more annoying one to be stuck with.
        """
        with self._tx() as cur:
            cur.execute(self._q("UPDATE media_sources SET person_id=? WHERE user_id=? AND id=?"),
                        (person_id or None, user_id, sid))
            return cur.rowcount == 1

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
    def append_event(self, user_id: str, pid: str, stream: str, kind: str, data: dict,
                     *, session_id: str | None = None, principal_id: str | None = None,
                     principal_type: str | None = None, attested_by: str | None = None,
                     attested_at: str | None = None,
                     producer_version: str | None = None) -> dict:
        """Append one event. The provenance arguments are OPTIONAL and default to null.

        *** NULL MEANS "NOT CAPTURED", AND THAT IS AN HONEST ANSWER. *** Every existing caller
        keeps working and writes nulls, which is exactly the intended outcome: the founding
        period is visibly unattributed rather than silently assumed to be human. See
        provenance.py for why a defaulted guess would be worse than an empty column.

        `principal_type` is normalised on the way in - an unrecognised value becomes NULL
        rather than a default, because this column is a claim about who made the data and a
        typo silently written as `human` is a falsehood in a log that has no update.
        """
        payload, ts = json.dumps(data), _now()
        ptype = provenance.normalize_principal_type(principal_type)
        with self._tx() as cur:
            eid = self._returning_id(cur, self._q(
                "INSERT INTO events(user_id, profile_id, stream, kind, data, created_at, "
                "session_id, principal_id, principal_type, attested_by, attested_at, "
                "producer_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"),
                (user_id, pid, stream, kind, payload, ts, session_id, principal_id, ptype,
                 attested_by, attested_at, producer_version))
        return {"id": eid, "kind": kind, "data": data, "created_at": ts,
                "session_id": session_id, "principal_id": principal_id,
                "principal_type": ptype, "attested_by": attested_by,
                "attested_at": attested_at, "producer_version": producer_version}

    # ---- SESSIONS AND THE ROSTER (for_code.md 9g) -------------------------
    # Read provenance.py first: the rules live there, pure and tested on their own.

    def start_session(self, user_id: str, pid: str, roster: list[dict] | None = None,
                      label: str = "", expected_min: int | None = None,
                      producer_version: str | None = None, max_players: int | None = None,
                      roster_complete: bool | None = None) -> dict:
        """Open a session and record who is in the room.

        AN EMPTY ROSTER IS ALLOWED AND IS NOT AN ERROR. "Nobody said who was there" is honest;
        a confidently wrong roster is not, and refusing to start a session because nobody
        filled in a form would stop a therapy session over paperwork.
        """
        problem = provenance.roster_problem(roster)
        if problem:
            raise ValueError(problem)
        sid, ts = _new_id(), _now()
        exp = provenance.DEFAULT_EXPECTED_MIN if expected_min is None else int(expected_min)
        # NULL stays NULL. Stored as 0/1 rather than a bool so both engines agree, and read
        # back as None/True/False so callers never see the integer.
        rc = None if roster_complete is None else (1 if roster_complete else 0)
        with self._tx() as cur:
            cur.execute(self._q(
                "INSERT INTO sessions(id, user_id, profile_id, label, started_at, expected_min, "
                "ended_at, end_reason, detected_at, ran_over_ms, producer_version, max_players, "
                "roster_complete) VALUES(?,?,?,?,?,?,NULL,NULL,NULL,NULL,?,?,?)"),
                (sid, user_id, pid, label, ts, exp, producer_version, max_players, rc))
            for r in roster or []:
                cur.execute(self._q(
                    "INSERT INTO session_roster(id, session_id, principal_id, role, joined_at, "
                    "left_at) VALUES(?,?,?,?,?,NULL)"),
                    (_new_id(), sid, r["principal_id"],
                     provenance.normalize_role(r.get("role")), ts))
        return {"id": sid, "user_id": user_id, "profile_id": pid, "label": label,
                "started_at": ts, "expected_min": exp, "ended_at": None,
                "max_players": max_players, "roster_complete": roster_complete}

    def amend_roster(self, session_id: str, principal_id: str, role: str | None = None,
                     leaving: bool = False) -> bool:
        """Somebody arrived or left mid-session. Timestamped, never overwritten.

        This is why the roster is its own table rather than a blob on the session: "who was in
        the room WHEN THIS TRIAL HAPPENED" has to stay answerable months later, and a blob
        that got edited cannot answer it.
        """
        ts = _now()
        with self._tx() as cur:
            if leaving:
                cur.execute(self._q(
                    "UPDATE session_roster SET left_at=? WHERE session_id=? AND principal_id=? "
                    "AND left_at IS NULL"), (ts, session_id, principal_id))
                return (cur.rowcount or 0) > 0
            r = provenance.normalize_role(role)
            if r is None:
                raise ValueError(f"unknown role {role!r}")
            cur.execute(self._q(
                "INSERT INTO session_roster(id, session_id, principal_id, role, joined_at, "
                "left_at) VALUES(?,?,?,?,?,NULL)"), (_new_id(), session_id, principal_id, r, ts))
            return True

    def session_roster(self, session_id: str) -> list[dict]:
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT principal_id, role, joined_at, left_at FROM session_roster "
                "WHERE session_id=? ORDER BY joined_at"), (session_id,))
            rows = cur.fetchall()
        return [{"principal_id": r[0], "role": r[1], "joined_at": r[2], "left_at": r[3]}
                for r in rows]

    def set_roster_complete(self, session_id: str, complete: bool | None) -> bool:
        """Assert (or un-assert) that the roster is everybody.

        A SESSIONS FIELD, NOT AN APPEND-ONLY ONE, so unlike the provenance columns this is
        genuinely correctable later - somebody remembering at the end of a session that the
        aide was there for the first ten minutes should be able to say so.
        """
        v = None if complete is None else (1 if complete else 0)
        with self._tx() as cur:
            cur.execute(self._q("UPDATE sessions SET roster_complete=? WHERE id=?"),
                        (v, session_id))
            return (cur.rowcount or 0) > 0

    def session_is_solo(self, session_id: str) -> bool:
        """Was this one person, unassisted, ATTESTED? Rows loaded, pure rule decides."""
        sess = self.get_session(session_id)
        if not sess:
            return False
        return provenance.is_solo(self.session_roster(session_id),
                                  roster_complete=sess.get("roster_complete"),
                                  max_players=sess.get("max_players"))

    def get_session(self, session_id: str) -> dict | None:
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, user_id, profile_id, label, started_at, expected_min, ended_at, "
                "end_reason, detected_at, ran_over_ms, producer_version, max_players, "
                "roster_complete FROM sessions WHERE id=?"),
                (session_id,))
            r = cur.fetchone()
        if not r:
            return None
        return {"id": r[0], "user_id": r[1], "profile_id": r[2], "label": r[3],
                "started_at": r[4], "expected_min": r[5], "ended_at": r[6],
                "end_reason": r[7], "detected_at": r[8], "ran_over_ms": r[9],
                "producer_version": r[10], "max_players": r[11],
                "roster_complete": None if r[12] is None else bool(r[12])}

    def end_session(self, session_id: str, reason: str = "ended_by_person",
                    ended_at: str | None = None, detected_at: str | None = None,
                    ran_over_ms: int | None = None) -> bool:
        """Close it. `ended_at` may be BACKDATED to the last event - see provenance.auto_close.

        An inactivity close backdated to the timer moment instead of the last event would give
        every such session fifteen minutes of phantom duration in any length statistic, which
        is why the two timestamps are separate columns rather than one.
        """
        if reason not in provenance.END_REASONS:
            raise ValueError(f"unknown end reason {reason!r}")
        ts = ended_at or _now()
        with self._tx() as cur:
            cur.execute(self._q(
                "UPDATE sessions SET ended_at=?, end_reason=?, detected_at=?, ran_over_ms=? "
                "WHERE id=? AND ended_at IS NULL"),
                (ts, reason, detected_at or ts, ran_over_ms, session_id))
            return (cur.rowcount or 0) > 0

    def list_events(self, user_id: str, pid: str, stream: str, limit: int = 50) -> dict:
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, kind, data, created_at, session_id, principal_id, principal_type, "
                "attested_by, attested_at, producer_version FROM events "
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

                -- WHO MAY DRIVE SOMEBODY ELSE'S SCREEN. `subject_kind` is polymorphic on
                -- purpose (account / group / tag) even though only 'account' resolves
                -- today: a permissions table is the worst kind to migrate later. See
                -- grants.py for why an unresolved kind must fail closed.
                CREATE TABLE IF NOT EXISTS drive_grants (
                    id TEXT PRIMARY KEY,
                    owner_id TEXT NOT NULL,
                    person_id TEXT NOT NULL,
                    subject_kind TEXT NOT NULL,
                    subject_id TEXT NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    expires_at TEXT,
                    created_at TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'moderator'
                );
                CREATE INDEX IF NOT EXISTS ix_grants_person ON drive_grants(owner_id, person_id);
                CREATE INDEX IF NOT EXISTS ix_grants_subject ON drive_grants(subject_kind, subject_id);

                -- CONNECTIONS. Two layers, and the split is the whole design: a LINK is
                -- permanent until somebody breaks it, and PERMISSIONS hang off it. See
                -- links.py. `account_lo`/`account_hi` are canonically ordered so a pair has
                -- exactly one row and the UNIQUE index can say so - two half-links could be
                -- broken independently, and then "are these two connected" would depend on
                -- who asked.
                -- REMOVED 2026-08-28. A guardianships table shipped earlier the same day
                -- and nothing ever wrote to it - there were no endpoints. It is dropped rather
                -- than left inert because `describe_storage` reads the REAL table list and
                -- publishes it to users: an empty guardianships table tells somebody we keep a
                -- guardianship record about them when we do not, and a privacy page that
                -- over-claims is still a false one. See links.py rule 5 before rebuilding it.
                DROP TABLE IF EXISTS guardianships;

                CREATE TABLE IF NOT EXISTS links (
                    id TEXT PRIMARY KEY,
                    account_lo TEXT NOT NULL,
                    account_hi TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    broken_at TEXT,
                    broken_by TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS ux_links_pair ON links(account_lo, account_hi);
                CREATE INDEX IF NOT EXISTS ix_links_lo ON links(account_lo);
                CREATE INDEX IF NOT EXISTS ix_links_hi ON links(account_hi);

                -- The switches on a friend. `subject_kind` is polymorphic (account/group/tag)
                -- exactly as drive_grants is, and for the same reason - only 'account'
                -- resolves, and links.permission_allows fails closed on the others.
                -- NOTE `drive_screen` is NOT stored here: it already lives in drive_grants,
                -- and one switch with two sources of truth is worse than the duplication
                -- looks. links.DELEGATED is that rule.
                CREATE TABLE IF NOT EXISTS link_permissions (
                    id TEXT PRIMARY KEY,
                    link_id TEXT NOT NULL,
                    person_id TEXT NOT NULL,
                    capability TEXT NOT NULL,
                    subject_kind TEXT NOT NULL,
                    subject_id TEXT NOT NULL,
                    expires_at TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS ux_link_perm ON link_permissions(
                    link_id, person_id, capability, subject_kind, subject_id);
                CREATE INDEX IF NOT EXISTS ix_link_perm_person ON link_permissions(person_id);
                CREATE INDEX IF NOT EXISTS ix_link_perm_link ON link_permissions(link_id);

                CREATE TABLE IF NOT EXISTS profiles (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
                    created_at TEXT NOT NULL, person_id TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS ix_profiles_user ON profiles(user_id);

                CREATE TABLE IF NOT EXISTS pairings (
                    code TEXT PRIMARY KEY, agent_id TEXT NOT NULL, label TEXT NOT NULL,
                    base_urls TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                    claimed_by TEXT, claimed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_pairings_expiry ON pairings(expires_at);

                -- Screen pairing. `device_key` is NULL until somebody claims the code:
                -- an unclaimed row must never contain a usable credential.
                CREATE TABLE IF NOT EXISTS screen_pairings (
                    code TEXT PRIMARY KEY, label TEXT NOT NULL, poll_token TEXT NOT NULL,
                    created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                    claimed_by TEXT, claimed_at TEXT, device_key TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_screen_pairings_expiry ON screen_pairings(expires_at);

                -- The keys themselves, so they no longer have to live in an environment
                -- variable only the person with the hosting dashboard can edit.
                CREATE TABLE IF NOT EXISTS device_keys (
                    key TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
                    created_at TEXT NOT NULL, last_seen TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_device_keys_user ON device_keys(user_id);

                -- `person_id` is NULLABLE and NULL means "the whole account's", never
                -- "orphaned" - see create_source. That is what let the column be added
                -- without rewriting a single existing row.
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

                -- PROVENANCE COLUMNS (for_code.md 9f). Nullable, populated null, NEVER
                -- mutated after write. They exist BEFORE the first real trial because an
                -- append-only log has no update: a field absent at write time can never be
                -- supplied later. A field that exists and is empty is self-describing; a
                -- field that does not exist yet produces data that LOOKS COMPLETE.
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL, profile_id TEXT NOT NULL, stream TEXT NOT NULL,
                    kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL,
                    session_id TEXT,
                    principal_id TEXT,
                    principal_type TEXT,
                    attested_by TEXT,
                    attested_at TEXT,
                    producer_version TEXT
                );
                -- NOTE: the indexes on session_id / principal_type are NOT here. On a
                -- database that predates these columns, CREATE TABLE IF NOT EXISTS is a
                -- no-op, so the columns do not exist yet and indexing them fails the whole
                -- script. They are created after the guarded ALTERs below - the same trap,
                -- and the same fix, as profiles.person_id.

                -- A SESSION CARRIES THE ROSTER; trials carry one session_id. Per-trial "who
                -- was present" is unworkable - people come and go all day and nobody tags
                -- four hundred trials. Correcting who was there appends a correction to the
                -- SESSION, which an append-only log can do.
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    label TEXT NOT NULL DEFAULT '',
                    started_at TEXT NOT NULL,
                    expected_min INTEGER NOT NULL,
                    ended_at TEXT,
                    end_reason TEXT,
                    detected_at TEXT,
                    ran_over_ms INTEGER,
                    producer_version TEXT,
                    -- How many players the MODULE says it takes. Mike's point: a module that
                    -- declares one player could never have had two, so solo is structural
                    -- there rather than something somebody has to assert.
                    max_players INTEGER,
                    -- "Is this roster everybody?" THREE STATES: NULL nobody said · 1 yes,
                    -- confirmed · 0 known incomplete. A one-row roster with NULL here is NOT
                    -- solo - it is one person we happen to know about.
                    roster_complete INTEGER
                );
                CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id, profile_id);

                -- Amendable mid-session: a row is added or closed with a timestamp, so "who
                -- was in the room WHEN THIS TRIAL HAPPENED" stays answerable afterwards.
                CREATE TABLE IF NOT EXISTS session_roster (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    principal_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    joined_at TEXT NOT NULL,
                    left_at TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_roster_session ON session_roster(session_id);

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
            # The provenance columns on a database that predates them. SQLite has no
            # ADD COLUMN IF NOT EXISTS, and CREATE TABLE IF NOT EXISTS will not add them to
            # an events table that already exists - which every deployed one does.
            scols = {r[1] for r in self._conn.execute("PRAGMA table_info(sessions)")}
            for col in ("max_players", "roster_complete"):
                if col not in scols:
                    self._conn.execute(f"ALTER TABLE sessions ADD COLUMN {col} INTEGER")
            ecols = {r[1] for r in self._conn.execute("PRAGMA table_info(events)")}
            for col in ("session_id", "principal_id", "principal_type", "attested_by",
                        "attested_at", "producer_version"):
                if col not in ecols:
                    self._conn.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_events_session ON events(session_id)")
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS ix_events_principal ON events(principal_type)")
            cols = {r[1] for r in self._conn.execute("PRAGMA table_info(profiles)")}
            if "person_id" not in cols:
                self._conn.execute("ALTER TABLE profiles ADD COLUMN person_id TEXT NOT NULL DEFAULT ''")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_profiles_person ON profiles(person_id)")
            # Same story one table over: grants shipped before they conferred a role, so an
            # existing table needs the column added. Defaulted to `moderator`, which is what
            # every grant made before this already effectively was.
            gcols = {r[1] for r in self._conn.execute("PRAGMA table_info(drive_grants)")}
            if "role" not in gcols:
                self._conn.execute(
                    "ALTER TABLE drive_grants ADD COLUMN role TEXT NOT NULL DEFAULT 'moderator'")
            # Media sources predate the person layer entirely. NULLABLE with NO default, so
            # every existing row means "the account's" - which is exactly what they were.
            mcols = {r[1] for r in self._conn.execute("PRAGMA table_info(media_sources)")}
            if "person_id" not in mcols:
                self._conn.execute("ALTER TABLE media_sources ADD COLUMN person_id TEXT")
            self._conn.execute(
                "CREATE INDEX IF NOT EXISTS ix_media_sources_person ON media_sources(person_id)")
            self._conn.commit()


    def _table_names(self) -> list[str]:
        cur = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        return [r[0] for r in cur.fetchall()]


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

    def _table_names(self) -> list[str]:
        with self._tx() as cur:
            cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            return [r[0] for r in cur.fetchall()]

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
            # Additive and defaulted, so a live database keeps working while the deploy rolls:
            # old code writing a row gets `moderator` from the default, new code reading an old
            # row gets `moderator` too.
            "ALTER TABLE drive_grants ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'moderator'",
            "CREATE TABLE IF NOT EXISTS drive_grants (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, "
            "person_id TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, "
            "label TEXT NOT NULL DEFAULT '', expires_at TEXT, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_grants_person ON drive_grants(owner_id, person_id)",
            "CREATE INDEX IF NOT EXISTS ix_grants_subject ON drive_grants(subject_kind, subject_id)",

            # REMOVED 2026-08-28 - see the SQLite block for why it is dropped rather than
            # left inert. Nothing ever wrote to it; there were no endpoints.
            "DROP TABLE IF EXISTS guardianships",

            # Connections - see links.py and the SQLite block above for why the pair is
            # canonically ordered and why drive_screen is absent from link_permissions.
            "CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, account_lo TEXT NOT NULL, "
            "account_hi TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, "
            "broken_at TEXT, broken_by TEXT)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_links_pair ON links(account_lo, account_hi)",
            "CREATE INDEX IF NOT EXISTS ix_links_lo ON links(account_lo)",
            "CREATE INDEX IF NOT EXISTS ix_links_hi ON links(account_hi)",

            "CREATE TABLE IF NOT EXISTS link_permissions (id TEXT PRIMARY KEY, link_id TEXT NOT NULL, "
            "person_id TEXT NOT NULL, capability TEXT NOT NULL, subject_kind TEXT NOT NULL, "
            "subject_id TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_link_perm ON link_permissions("
            "link_id, person_id, capability, subject_kind, subject_id)",
            "CREATE INDEX IF NOT EXISTS ix_link_perm_person ON link_permissions(person_id)",
            "CREATE INDEX IF NOT EXISTS ix_link_perm_link ON link_permissions(link_id)",

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

            "CREATE TABLE IF NOT EXISTS pairings (code TEXT PRIMARY KEY, agent_id TEXT NOT NULL, "
            "label TEXT NOT NULL, base_urls TEXT NOT NULL, created_at TEXT NOT NULL, "
            "expires_at TEXT NOT NULL, claimed_by TEXT, claimed_at TEXT)",
            "CREATE INDEX IF NOT EXISTS ix_pairings_expiry ON pairings(expires_at)",

            "CREATE TABLE IF NOT EXISTS screen_pairings (code TEXT PRIMARY KEY, label TEXT NOT NULL, "
            "poll_token TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, "
            "claimed_by TEXT, claimed_at TEXT, device_key TEXT)",
            "CREATE INDEX IF NOT EXISTS ix_screen_pairings_expiry ON screen_pairings(expires_at)",

            "CREATE TABLE IF NOT EXISTS device_keys (key TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
            "label TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT)",
            "CREATE INDEX IF NOT EXISTS ix_device_keys_user ON device_keys(user_id)",

            "CREATE TABLE IF NOT EXISTS media_sources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
            "label TEXT NOT NULL, base_url TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, "
            "person_id TEXT)",
            # Nullable and undefaulted on purpose: every row that existed before this means
            # "the account's", which is what it already was. Nothing is backfilled, because
            # backfilling onto whichever person happened to be first would silently take
            # media away from screens that were showing it.
            "ALTER TABLE media_sources ADD COLUMN IF NOT EXISTS person_id TEXT",
            "CREATE INDEX IF NOT EXISTS ix_media_sources_user ON media_sources(user_id)",
            "CREATE INDEX IF NOT EXISTS ix_media_sources_person ON media_sources(person_id)",

            "CREATE TABLE IF NOT EXISTS profile_modules (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, "
            "type TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_pm_profile ON profile_modules(profile_id)",

            "CREATE TABLE IF NOT EXISTS state (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, key TEXT NOT NULL, "
            "data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, "
            "PRIMARY KEY (user_id, profile_id, key))",

            "CREATE TABLE IF NOT EXISTS events (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, "
            "profile_id TEXT NOT NULL, stream TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, "
            "created_at TEXT NOT NULL)",
            # PROVENANCE (for_code.md 9f) - additive, nullable, never mutated. Added as ALTERs
            # as well as in the CREATE, because the live events table already exists.
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS session_id TEXT",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS principal_id TEXT",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS principal_type TEXT",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS attested_by TEXT",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS attested_at TEXT",
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS producer_version TEXT",
            "CREATE INDEX IF NOT EXISTS ix_events_session ON events(session_id)",
            "CREATE INDEX IF NOT EXISTS ix_events_principal ON events(principal_type)",

            "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, "
            "profile_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, "
            "expected_min INTEGER NOT NULL, ended_at TEXT, end_reason TEXT, detected_at TEXT, "
            "ran_over_ms BIGINT, producer_version TEXT, max_players INTEGER, roster_complete INTEGER)",
            "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS max_players INTEGER",
            "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS roster_complete INTEGER",
            "CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id, profile_id)",

            "CREATE TABLE IF NOT EXISTS session_roster (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, "
            "principal_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL, left_at TEXT)",
            "CREATE INDEX IF NOT EXISTS ix_roster_session ON session_roster(session_id)",
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
