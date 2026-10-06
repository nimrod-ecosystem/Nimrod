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
import logging
import secrets
import sqlite3
import threading
import uuid

# Pure rules, no storage - db imports grants/links and never the other way round.
import claims as claim_rules
import grants
import links
import provenance

log = logging.getLogger("nimrod")
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

    # THE NAME A ROW SHOWS ITS OWN ACCOUNT (claims.display_name, in SQL): its "I call them" if it has one (any row,
    # since 2026-10-05), else a home row's own name, else the home's name. Every caller of list_people / get_person -
    # screens, notes, the kiosk - gets the name the holding account knows them by, without knowing homes exist.
    # *** NOT FOR ANYTHING ANOTHER LOGIN READS: that is _PROFILE_NAME_SQL (claims.profile_name). ***
    _PROFILE_NAME_SQL = "CASE WHEN p.home_id IS NULL OR p.home_id='' THEN p.name ELSE COALESCE(h.name, p.name) END"
    _NAME_SQL = f"COALESCE(NULLIF(p.call_name,''), {_PROFILE_NAME_SQL})"
    # FIRST IS "YOU": the oldest row, and on a tie (two rows written in the same clock tick) a home row before one
    # a connection made - so a link accepted on a brand-new login can never become that login's "you".
    _PEOPLE_ORDER = "p.created_at, CASE WHEN p.home_id IS NULL OR p.home_id='' THEN 0 ELSE 1 END"

    def list_people(self, account_id: str, *, profile: bool = False) -> list[dict]:
        """`profile`: each name as anybody else sees it (claims.profile_name), for whatever another login reads."""
        name_sql = self._PROFILE_NAME_SQL if profile else self._NAME_SQL
        with self._tx() as cur:
            cur.execute(self._q(
                f"SELECT p.id, {name_sql}, p.created_at FROM people p LEFT JOIN people h ON h.id = p.home_id "
                f"WHERE p.account_id=? ORDER BY {self._PEOPLE_ORDER}"), (account_id,))
            rows = cur.fetchall()
        return [{"id": r[0], "name": r[1], "created_at": r[2]} for r in rows]

    def get_person(self, account_id: str, person_id: str, *, profile: bool = False) -> dict | None:
        """Ownership gate: only the owning account ever sees a person. `profile` as list_people's."""
        name_sql = self._PROFILE_NAME_SQL if profile else self._NAME_SQL
        with self._tx() as cur:
            cur.execute(self._q(
                f"SELECT p.id, {name_sql}, p.created_at FROM people p LEFT JOIN people h ON h.id = p.home_id "
                "WHERE p.account_id=? AND p.id=?"), (account_id, person_id))
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

        NORMALIZED ON THE WAY IN, so storage never holds a role nothing understands. That is
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
        with self._tx() as cur:
            return self._link_upsert(cur, a, b, created_by, _now())

    def _link_upsert(self, cur, a: str, b: str, created_by: str, ts: str) -> dict:
        """create_link's body, on a cursor the caller holds - so accepting an invitation can connect two
        accounts inside the same transaction that marks the link used (SQLite's lock is not re-entrant)."""
        lo, hi = links.canonical_pair(a, b)
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

        `capability` is VALIDATED and raises on anything unrecognized - unlike
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

    # ---- PEOPLE ACROSS ACCOUNTS: a profile has a home (claims.py) --------
    # Read claims.py first: the RULES live there, pure and tested alone. This is storage.
    #   * `people.home_id`  the row that is the main instance of this profile; NULL: this row is its own home.
    #                       Kept FLAT - it always names a home - so "whose profile is this" is one lookup.
    #   * `people.call_name` "I call them": the holding account's own name for the person (any row, 2026-10-05).
    #   * `people.source_id` the row on the other account this one reaches through (messages, a call's grant).
    #   * `people.link_id`  the connection (links) that put it here; `people.made_by` 'claim' | 'link' - so
    #                       ending a connection undoes exactly what it made, and nothing else.
    # An invitation is stored as the SHA-256 of its token, never the token.

    _PERSON_COLS = "id, account_id, name, created_at, home_id, call_name, source_id, link_id, made_by"

    @staticmethod
    def _person_full(r) -> dict:
        return {"id": r[0], "account_id": r[1], "name": r[2], "created_at": r[3], "home_id": r[4] or None,
                "call_name": r[5] or "", "source_id": r[6] or None, "link_id": r[7] or None,
                "made_by": r[8] or None}

    def person_row(self, person_id: str) -> dict | None:
        """The whole row, NOT scoped to the caller (person_owner's warning applies: not a permission)."""
        with self._tx() as cur:
            cur.execute(self._q(f"SELECT {self._PERSON_COLS} FROM people WHERE id=?"), (person_id,))
            r = cur.fetchone()
        return self._person_full(r) if r else None

    def people_rows(self, account_id: str) -> list[dict]:
        """Every row on this account, in list_people's order, each with its home's name and account."""
        cols = ", ".join(f"p.{c.strip()}" for c in self._PERSON_COLS.split(","))
        with self._tx() as cur:
            cur.execute(self._q(
                f"SELECT {cols}, h.name, h.account_id FROM people p LEFT JOIN people h ON h.id = p.home_id "
                f"WHERE p.account_id=? ORDER BY {self._PEOPLE_ORDER}"), (account_id,))
            rows = cur.fetchall()
        out = []
        for r in rows:
            d = self._person_full(r)
            d["home_name"], d["home_account"] = r[9], r[10]
            out.append(d)
        return out

    def holders_of(self, home_id: str) -> list[dict]:
        """The rows on other accounts whose profile is this one."""
        with self._tx() as cur:
            cur.execute(self._q(f"SELECT {self._PERSON_COLS} FROM people WHERE home_id=?"), (home_id,))
            rows = cur.fetchall()
        return [self._person_full(r) for r in rows]

    def holder_counts(self, account_id: str) -> dict[str, int]:
        """For each profile this account looks after, how many rows on OTHER accounts hold it - one query for a
        whole page of cards ("Shared with")."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT p.home_id, COUNT(*) FROM people p JOIN people h ON h.id = p.home_id "
                "WHERE h.account_id=? AND p.account_id<>? GROUP BY p.home_id"), (account_id, account_id))
            rows = cur.fetchall()
        return {r[0]: int(r[1]) for r in rows if r[0]}

    def count_link_rows(self, account_id: str, link_id: str | None) -> int:
        """How many rows one connection put on this account's page (claims.LAST_CARD_STAYS)."""
        if not link_id:
            return 0
        with self._tx() as cur:
            cur.execute(self._q("SELECT COUNT(*) FROM people WHERE account_id=? AND link_id=?"), (account_id, link_id))
            return int(cur.fetchone()[0])

    def _drop_copy_permissions(self, cur, r: dict) -> None:
        """The permissions that came with a row a connection put on an account: the switches on the row it reaches
        through (`source_id`), on that connection, for that account ("may leave messages" above all). Nothing
        else: the source's switches for anybody else, and every drive grant, stay as they are."""
        if not r.get("link_id") or not r.get("source_id"):
            return
        cur.execute(self._q(
            "DELETE FROM link_permissions WHERE link_id=? AND person_id=? AND subject_kind='account' AND subject_id=?"),
            (r["link_id"], r["source_id"], r["account_id"]))

    def drop_held_row(self, row_id: str, *, keep_if_screens: bool = True) -> str:
        """Take ONE row whose profile lives elsewhere off its account's page, without ending the connection
        (claims.py "ONE CARD AT A TIME"; the caller has asked claims.unshare_refusal / remove_card_refusal).
          'removed'  a row a connection made: gone, with its settings;
          'kept'     ...that has a screen of its own (and keep_if_screens): stays as that account's own plain row,
                     named what they called them, so no screen loses its person;
          'plain'    a row made by its account and taken over by a claim: its account's own plain row again, with
                     the picture and page it had before (db.unlink treats it the same way);
          'screens'  a row with a screen and not keep_if_screens: nothing done;
          'gone'     no such row, or its own home: nothing done.
        The permissions that came with the row go in every case but the last two."""
        with self._tx() as cur:
            cur.execute(self._q(f"SELECT {self._PERSON_COLS} FROM people WHERE id=?"), (row_id,))
            got = cur.fetchone()
            r = self._person_full(got) if got else None
            if not r or not r["home_id"]:
                return "gone"
            cur.execute(self._q("SELECT COUNT(*) FROM profiles WHERE user_id=? AND person_id=?"), (r["account_id"], r["id"]))
            screens = int(cur.fetchone()[0])
            if r["made_by"] != "claim" and screens and not keep_if_screens:
                return "screens"
            self._drop_copy_permissions(cur, r)
            if r["made_by"] == "claim":
                self._make_plain(r, home_name=None, cur=cur)
                return "plain"
            if screens:
                cur.execute(self._q("SELECT name FROM people WHERE id=?"), (r["home_id"],))
                h = cur.fetchone()
                self._make_plain(r, home_name=h[0] if h else None, cur=cur)
                return "kept"
            cur.execute(self._q("DELETE FROM link_permissions WHERE person_id=?"), (r["id"],))
            cur.execute(self._q("DELETE FROM state WHERE user_id=? AND profile_id=?"), (r["account_id"], person_scope(r["id"])))
            self._drop_person_labels(cur, r["id"])
            cur.execute(self._q("DELETE FROM people WHERE id=? AND account_id=?"), (r["id"], r["account_id"]))
            return "removed"

    def screens_by_person(self, account_id: str) -> dict[str, int]:
        """How many screens each of this account's people has - one query for a whole page of cards."""
        with self._tx() as cur:
            cur.execute(self._q("SELECT person_id, COUNT(*) FROM profiles WHERE user_id=? GROUP BY person_id"),
                        (account_id,))
            rows = cur.fetchall()
        return {r[0]: int(r[1]) for r in rows if r[0]}

    def set_call_name(self, account_id: str, person_id: str, name: str) -> bool:
        """"I call them", on any row of this account's (2026-10-05: a person you made too - your private label
        beside the name on their card); '' clears."""
        with self._tx() as cur:
            cur.execute(self._q("UPDATE people SET call_name=? WHERE id=? AND account_id=?"),
                        (name or None, person_id, account_id))
            return bool(cur.rowcount and cur.rowcount > 0)

    # "I CALL THEM", PER PERSON (Mike, 2026-10-05; claims.seen_name has the rules). `person_labels`: one row per
    # (the person looking, the card), on the login that holds both. A TABLE, not a key in the looking person's own
    # state - argued: FOR state, it is no new table, it goes wherever that person's settings go, and deleting the
    # person deletes it. AGAINST, and it decides it: (1) the name every list shows is resolved here, in one query,
    # instead of opening a settings blob per read; (2) a write is checked by the server, field by field (the name's
    # rules, both people on this login, not your own card) - a state key is written whole by the client through the
    # general state route, which would have to be fenced off for this one key; (3) two labels saved at once from two
    # tabs are two rows, not one blob's version conflict; (4) the privacy page lists it by name. The cost is cleanup,
    # paid in the three places a person row is deleted (_drop_person_labels).
    def person_labels(self, account_id: str, viewer_id: str) -> dict[str, str]:
        """The labels `viewer_id` has set, card id -> name, on this login only."""
        if not viewer_id:
            return {}
        with self._tx() as cur:
            cur.execute(self._q("SELECT person_id, name FROM person_labels WHERE account_id=? AND viewer_id=?"),
                        (account_id, viewer_id))
            rows = cur.fetchall()
        return {r[0]: r[1] for r in rows if r[1]}

    def set_person_label(self, account_id: str, viewer_id: str, person_id: str, name: str) -> None:
        """The caller (app.py) has checked both people are on this login and are not the same person. '' clears."""
        with self._tx() as cur:
            if not name:
                cur.execute(self._q("DELETE FROM person_labels WHERE account_id=? AND viewer_id=? AND person_id=?"),
                            (account_id, viewer_id, person_id))
                return
            cur.execute(self._q(
                "INSERT INTO person_labels(account_id, viewer_id, person_id, name, updated_at) VALUES(?,?,?,?,?) "
                "ON CONFLICT(account_id, viewer_id, person_id) DO UPDATE SET name=excluded.name, "
                "updated_at=excluded.updated_at"), (account_id, viewer_id, person_id, name, _now()))

    def _drop_person_labels(self, cur, person_id: str) -> None:
        """A person row is going: every label set BY them and every label ON them, so no name outlives its card."""
        cur.execute(self._q("DELETE FROM person_labels WHERE viewer_id=? OR person_id=?"), (person_id, person_id))

    def _first_person(self, cur, account_id: str) -> dict | None:
        cur.execute(self._q(
            f"SELECT p.id, p.home_id, p.created_at FROM people p WHERE p.account_id=? "
            f"ORDER BY {self._PEOPLE_ORDER} LIMIT 1"), (account_id,))
        r = cur.fetchone()
        return {"id": r[0], "home_id": r[1] or None, "created_at": r[2]} if r else None

    def first_person_id(self, account_id: str) -> str | None:
        """The account's first person ("you"), WITHOUT creating one (ensure_default_person does)."""
        with self._tx() as cur:
            f = self._first_person(cur, account_id)
        return f["id"] if f else None

    _INVITE_COLS = ("id, token_hash, owner_id, person_id, created_at, expires_at, used_at, used_by, "
                    "cancelled_at, see_people, messages, kind, shares")

    @staticmethod
    def _invite_row(r) -> dict:
        try:
            shares = json.loads(r[12]) if r[12] else None
        except (TypeError, ValueError):
            shares = None
        return {"id": r[0], "token_hash": r[1], "owner_id": r[2], "person_id": r[3], "created_at": r[4],
                "expires_at": r[5], "used_at": r[6], "used_by": r[7], "cancelled_at": r[8],
                "see_people": bool(r[9]), "messages": bool(r[10]), "kind": r[11] or "claim",
                "shares": shares if isinstance(shares, list) else None}

    def create_invite(self, owner_id: str, person_id: str, token_hash: str, expires_at: str, *,
                      kind: str = "claim", shares: list[dict] | None = None,
                      sweep_before: str | None = None) -> dict:
        """A new invitation. `kind` 'claim' (person_id: who is handed over) or 'connect' (person_id: the
        inviter's own "you"). `shares`: claims.clean_shares' list, stored as JSON.

        ONE LIVE LINK PER PERSON HANDED OVER: an older claim link still waiting for the same person is
        cancelled in the same transaction, so a link sent last week and forgotten cannot be used after a new
        one went out. CONNECT LINKS ARE NOT: somebody may send one to each of three friends at once.

        `sweep_before` (an ISO time): links nobody used that ran out or were taken back before it are
        deleted first, anybody's - the tidy-up rides on making a link, which is rate limited, rather
        than on a timer this server does not have (claims.KEEP_DEAD_INVITE_DAYS says how long)."""
        if kind not in claim_rules.INVITE_KINDS:
            raise ValueError(f"unknown invitation kind {kind!r}")
        iid, ts = _new_id(), _now()
        shares = list(shares or [])
        any_msgs = any(s.get("messages") for s in shares)
        with self._tx() as cur:
            if sweep_before:
                cur.execute(self._q(
                    "DELETE FROM claim_invites WHERE used_at IS NULL AND (expires_at < ? "
                    "OR (cancelled_at IS NOT NULL AND cancelled_at < ?))"), (sweep_before, sweep_before))
            if kind == "claim":
                cur.execute(self._q(
                    "UPDATE claim_invites SET cancelled_at=? WHERE owner_id=? AND person_id=? AND kind='claim' "
                    "AND used_at IS NULL AND cancelled_at IS NULL"), (ts, owner_id, person_id))
            # see_people / messages are 8908b2c's two choices, kept for links made before this (accept_invite
            # reads them when `shares` is empty); a new link writes them as what its shares add up to.
            cur.execute(self._q(
                f"INSERT INTO claim_invites({self._INVITE_COLS}) VALUES(?,?,?,?,?,?,NULL,NULL,NULL,?,?,?,?)"),
                (iid, token_hash, owner_id, person_id, ts, expires_at, 1 if len(shares) > 1 else 0,
                 1 if any_msgs else 0, kind, json.dumps(shares)))
        return {"id": iid, "owner_id": owner_id, "person_id": person_id, "created_at": ts,
                "expires_at": expires_at, "kind": kind, "shares": shares}

    def list_invites(self, owner_id: str, person_id: str | None = None, *, kind: str = "claim") -> list[dict]:
        """This account's invitations of one kind (for one person, if given), newest first. No tokens."""
        sql = f"SELECT {self._INVITE_COLS} FROM claim_invites WHERE owner_id=? AND kind=?"
        params: tuple = (owner_id, kind)
        if person_id:
            sql += " AND person_id=?"
            params = (owner_id, kind, person_id)
        with self._tx() as cur:
            cur.execute(self._q(sql + " ORDER BY created_at DESC"), params)
            rows = cur.fetchall()
        return [self._invite_row(r) for r in rows]

    def cancel_invite(self, owner_id: str, invite_id: str) -> int:
        """Take a waiting link back. Only the inviter; only one not yet used or cancelled."""
        with self._tx() as cur:
            cur.execute(self._q(
                "UPDATE claim_invites SET cancelled_at=? WHERE id=? AND owner_id=? "
                "AND used_at IS NULL AND cancelled_at IS NULL"), (_now(), invite_id, owner_id))
            return cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0

    def invite_by_hash(self, token_hash: str) -> dict | None:
        if not token_hash:
            return None
        with self._tx() as cur:
            cur.execute(self._q(f"SELECT {self._INVITE_COLS} FROM claim_invites WHERE token_hash=?"),
                        (token_hash,))
            r = cur.fetchone()
        return self._invite_row(r) if r else None

    def invite_shares(self, inv: dict) -> list[dict]:
        """What an invitation shares. A link made before shares existed (8908b2c) carries its two old
        choices instead: "see your other people" meant everybody the inviter looks after."""
        if inv.get("shares") is not None:
            return inv["shares"]
        owner = inv["owner_id"]
        first = self.first_person_id(owner)
        rows = [r for r in self.people_rows(owner) if not r["home_id"] and r["id"] != inv["person_id"]]
        picked = rows if inv.get("see_people") else [r for r in rows if r["id"] == first]
        return [{"person_id": r["id"], "messages": bool(inv.get("messages"))} for r in picked]

    # -- rows made by a connection --------------------------------------------------------------------

    class _Refused(Exception):
        def __init__(self, reason: str):
            super().__init__(reason)
            self.reason = reason

    def _holds(self, cur, account_id: str, home_id: str) -> bool:
        """Does this account already have a row for this profile (the home itself, or one pointing at it)?"""
        cur.execute(self._q("SELECT id FROM people WHERE account_id=? AND (id=? OR home_id=?) LIMIT 1"),
                    (account_id, home_id, home_id))
        return cur.fetchone() is not None

    def _add_linked_row(self, cur, account_id: str, *, home_id: str, source_id: str, link_id: str,
                        ts: str) -> str | None:
        """A row on `account_id` for somebody whose profile lives at `home_id`, unless it has one already.
        Its stored name is the home's name at this moment - only ever shown if the home goes away."""
        if self._holds(cur, account_id, home_id):
            return None
        cur.execute(self._q("SELECT name FROM people WHERE id=?"), (home_id,))
        r = cur.fetchone()
        rid = _new_id()
        cur.execute(self._q(
            f"INSERT INTO people({self._PERSON_COLS}) VALUES(?,?,?,?,?,NULL,?,?,'link')"),
            (rid, account_id, (r[0] if r else "") or "Someone", ts, home_id, source_id, link_id))
        return rid

    def _messages_upsert(self, cur, link_id: str, person_id: str, subject_id: str, ts: str) -> None:
        """links.py's `messages` switch, on: `subject_id` may leave messages for `person_id` (idempotent)."""
        cur.execute(self._q(
            "SELECT id FROM link_permissions WHERE link_id=? AND person_id=? AND capability='messages' "
            "AND subject_kind='account' AND subject_id=?"), (link_id, person_id, subject_id))
        if cur.fetchone():
            return
        cur.execute(self._q(
            "INSERT INTO link_permissions(id, link_id, person_id, capability, subject_kind, subject_id, "
            "expires_at, created_at) VALUES(?,?,?,'messages','account',?,NULL,?)"),
            (_new_id(), link_id, person_id, subject_id, ts))

    def accept_invite(self, invite_id: str, account_id: str, *, messages_back: bool = True) -> tuple[str, dict | None]:
        """("ok", {kind, link_id, joined, first}) | ("gone", None) | ("claimed", None).

        SINGLE USE BY CONSTRUCTION: the invite is marked used by an UPDATE that only matches an unused,
        uncancelled, unexpired row, and only the request whose UPDATE changed exactly one row goes on.
        A CLAIM IS ONE BY CONSTRUCTION TOO: the inviter's row joins the claimer's profile through an UPDATE
        that only matches it while it is still its own home, so two people pressing "Make this mine" on two
        links for the same person get one yes and one "already". Everything - the connection, the rows, the
        switches - is written in that one transaction: a refusal anywhere rolls all of it back, and the link
        stays unused, which is right: it did not make anything theirs.

        THE CLAIMER'S FIRST PERSON IS WHO THEY ARE. ensure_default_person makes one first, so a link accepted
        by a brand-new login never makes a row that could become its "you"."""
        self.ensure_default_person(account_id)
        ts = _now()
        try:
            with self._tx() as cur:
                cur.execute(self._q(f"SELECT {self._INVITE_COLS} FROM claim_invites WHERE id=?"), (invite_id,))
                r = cur.fetchone()
                if not r:
                    return ("gone", None)
                inv = self._invite_row(r)
                cur.execute(self._q(
                    "UPDATE claim_invites SET used_at=?, used_by=? WHERE id=? AND used_at IS NULL "
                    "AND cancelled_at IS NULL AND expires_at > ?"), (ts, account_id, invite_id, ts))
                if cur.rowcount != 1:
                    return ("gone", None)
                owner = inv["owner_id"]
                me = self._first_person(cur, account_id)
                my_home = me["home_id"] or me["id"]
                link = self._link_upsert(cur, owner, account_id, account_id, ts)
                lid = link["id"]
                joined = None
                if inv["kind"] == "claim":
                    pid = inv["person_id"]
                    cur.execute(self._q(
                        "UPDATE people SET home_id=?, source_id=?, link_id=?, made_by='claim', "
                        "call_name=COALESCE(NULLIF(call_name,''), name) "
                        "WHERE id=? AND account_id=? AND (home_id IS NULL OR home_id='')"),
                        (my_home, me["id"], lid, pid, owner))
                    if cur.rowcount != 1:
                        raise self._Refused("claimed")
                    # Everything that pointed at the claimed row points at the claimer's own profile now.
                    cur.execute(self._q("UPDATE people SET home_id=? WHERE home_id=?"), (my_home, pid))
                    joined = pid
                shares = inv["shares"]
                if shares is None:
                    # A link made before shares existed (8908b2c): its two old choices, read in this same
                    # transaction ("see your other people" meant everybody the inviter looks after).
                    cur.execute(self._q(
                        f"SELECT p.id FROM people p WHERE p.account_id=? AND (p.home_id IS NULL OR p.home_id='') "
                        f"ORDER BY {self._PEOPLE_ORDER}"), (owner,))
                    homes = [x[0] for x in cur.fetchall()]
                    first_owner = homes[0] if homes else None
                    picked = [h for h in homes if h != inv["person_id"]] if inv["see_people"] else \
                        [h for h in homes if h == first_owner and h != inv["person_id"]]
                    shares = [{"person_id": h, "messages": inv["messages"]} for h in picked]
                for s in shares:
                    q = s.get("person_id")
                    if not q or q == joined:
                        continue
                    # Still the inviter's, and still a profile they look after - else it is skipped, not refused:
                    # one person deleted since the link was made must not cost the rest of the invitation.
                    cur.execute(self._q(
                        "SELECT id FROM people WHERE id=? AND account_id=? AND (home_id IS NULL OR home_id='')"),
                        (q, owner))
                    if not cur.fetchone():
                        continue
                    self._add_linked_row(cur, account_id, home_id=q, source_id=q, link_id=lid, ts=ts)
                    if s.get("messages"):
                        self._messages_upsert(cur, lid, q, account_id, ts)
                if inv["kind"] == "connect":
                    self._add_linked_row(cur, owner, home_id=my_home, source_id=me["id"], link_id=lid, ts=ts)
                if messages_back:
                    self._messages_upsert(cur, lid, me["id"], owner, ts)
        except self._Refused as e:
            return (e.reason, None)
        except Exception as e:                              # noqa: BLE001 - narrowed just below
            # By NAME, because psycopg is not importable in SQLite dev: both engines call it this.
            if type(e).__name__ not in ("IntegrityError", "UniqueViolation"):
                raise
            return ("claimed", None)
        if joined:
            self._tidy_self_rows(account_id, me["id"])
        return ("ok", {"kind": inv["kind"], "link_id": lid, "joined": joined, "first": me["id"],
                       "owner_id": owner})

    def _tidy_self_rows(self, account_id: str, first_id: str) -> None:
        """After a claim: a row on the claimer's own account that now points at the claimer (they had been
        shared the very profile they took over) is them twice. A connection's row is removed; one with a
        screen of its own is kept, as a plain row."""
        for r in self.holders_of(first_id):
            if r["account_id"] != account_id or r["made_by"] != "link":
                continue
            if self.count_person_screens(account_id, r["id"]):
                self._make_plain(r, home_name=None)
            else:
                self.delete_person(account_id, r["id"])

    def _make_plain(self, r: dict, *, home_name: str | None, cur=None) -> None:
        """A row whose profile is no longer elsewhere: nothing pointing out, and still called what it was called.
        Since "I call them" may sit on any row (2026-10-05) it is KEPT as that account's label, and the name on the
        card is the profile's: a row taken over by a claim keeps its own name from before the claim (the claim never
        changed it), a connection's row the home's name. What the account sees is unchanged either way. A label the
        same as the name is dropped, so nothing reads twice."""
        prof = ((r.get("name") if r.get("made_by") == "claim" else None) or home_name or r.get("name") or "").strip()
        call = (r.get("call_name") or "").strip()
        name = prof or call or "Someone"
        label = call if call and call != name else None
        sql = self._q("UPDATE people SET name=?, call_name=?, home_id=NULL, source_id=NULL, link_id=NULL, "
                      "made_by=NULL WHERE id=?")
        if cur is not None:
            cur.execute(sql, (name, label, r["id"]))
            return
        with self._tx() as c:
            c.execute(sql, (name, label, r["id"]))

    def copy_profile_if_empty(self, from_account: str, from_pid: str, to_account: str, to_pid: str) -> list[str]:
        """"Most of the work already done": each profile key (picture, page) the claimer has not set yet is
        copied from the row the inviter made. Never over something the claimer already has."""
        copied = []
        for key in sorted(claim_rules.PROFILE_KEYS):
            dst = self.get_state(to_account, person_scope(to_pid), key)
            if dst.get("version") or dst.get("data"):
                continue
            src = self.get_state(from_account, person_scope(from_pid), key)
            if not src.get("data"):
                continue
            status, _ = self.put_state(to_account, person_scope(to_pid), key, src["data"], dst.get("version", 0))
            if status == "ok":
                copied.append(key)
        return copied

    # -- ending a connection --------------------------------------------------------------------------

    def unlink(self, a: str, b: str, broken_by: str) -> int:
        """"Stop sharing", from either side: undo what the connection between a and b made, then break it.

          * a row the connection MADE ('link') is removed with its settings - unless the account holding it
            gave it a screen, when it stays as that account's own plain row (nobody's screen loses its person);
          * a row the connection JOINED ('claim') goes back to being its account's own plain row, called what
            that account called it, with whatever picture and page it had before the claim (the claimer's
            later changes stay the claimer's), and rows that were shared FROM it point at it again;
          * links.py's break: every permission on the link goes, and the link is marked broken.
        Never a home row. Message history is left alone (break_link says why). 1 if a link was broken, else 0."""
        link = self.get_link(a, b)
        if not link or not links.link_is_active(link):
            return 0
        lid, ts = link["id"], _now()
        with self._tx() as cur:
            cur.execute(self._q(f"SELECT {self._PERSON_COLS} FROM people WHERE link_id=?"), (lid,))
            rows = [self._person_full(r) for r in cur.fetchall()]
            for r in rows:
                if r["made_by"] == "claim":
                    self._make_plain(r, home_name=None, cur=cur)
                    cur.execute(self._q("UPDATE people SET home_id=? WHERE source_id=? AND id<>?"),
                                (r["id"], r["id"], r["id"]))
                    continue
                cur.execute(self._q("SELECT COUNT(*) FROM profiles WHERE user_id=? AND person_id=?"),
                            (r["account_id"], r["id"]))
                if cur.fetchone()[0]:
                    cur.execute(self._q("SELECT name FROM people WHERE id=?"), (r["home_id"],))
                    h = cur.fetchone()
                    self._make_plain(r, home_name=h[0] if h else None, cur=cur)
                    continue
                cur.execute(self._q("DELETE FROM state WHERE user_id=? AND profile_id=?"),
                            (r["account_id"], person_scope(r["id"])))
                self._drop_person_labels(cur, r["id"])
                cur.execute(self._q("DELETE FROM people WHERE id=? AND account_id=?"), (r["id"], r["account_id"]))
            cur.execute(self._q("DELETE FROM link_permissions WHERE link_id=?"), (lid,))
            cur.execute(self._q("UPDATE links SET broken_at=?, broken_by=? WHERE id=?"), (ts, broken_by, lid))
        return 1

    # -- "may they leave messages for my people", per connection ---------------------------------------

    def _shared_sources(self, cur, link_id: str, owner: str, other: str) -> list[str]:
        """The owner's rows the other account holds through this connection."""
        cur.execute(self._q(
            "SELECT DISTINCT p.source_id FROM people p JOIN people s ON s.id = p.source_id "
            "WHERE p.account_id=? AND p.link_id=? AND s.account_id=?"), (other, link_id, owner))
        return [r[0] for r in cur.fetchall() if r[0]]

    def link_messages(self, link_id: str, owner: str, other: str) -> bool:
        """May `other` leave messages for any of `owner`'s people through this connection?"""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT lp.id FROM link_permissions lp JOIN people p ON p.id = lp.person_id "
                "WHERE lp.link_id=? AND lp.capability='messages' AND lp.subject_id=? AND p.account_id=? LIMIT 1"),
                (link_id, other, owner))
            return cur.fetchone() is not None

    def set_link_messages(self, link_id: str, owner: str, other: str, on: bool) -> int:
        """Turn "may leave messages" on or off for every one of `owner`'s people `other` holds through this
        connection. Touches only `messages` rows whose subject is `other` on `owner`'s people."""
        ts = _now()
        with self._tx() as cur:
            sources = self._shared_sources(cur, link_id, owner, other)
            if on:
                for s in sources:
                    self._messages_upsert(cur, link_id, s, other, ts)
                return len(sources)
            cur.execute(self._q(
                "DELETE FROM link_permissions WHERE link_id=? AND capability='messages' AND subject_id=? "
                "AND person_id IN (SELECT id FROM people WHERE account_id=?)"), (link_id, other, owner))
            return cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

    # -- 8908b2c's claims, carried over once ------------------------------------------------------------

    def _migrate_old_claims(self) -> int:
        """`person_claims` (8908b2c: the claimed person stayed on the inviter's account, with a row naming
        the claimer) becomes the home model, then the table is dropped - a table nothing reads would tell the
        privacy page we keep a record we no longer use. SAFE EITHER WAY: no table, nothing happens; each row
        is carried over idempotently, so a migration cut short by a restart finishes on the next one.

        For each old claim: the person joins the claimer's own first person (their picture and page are
        copied to the claimer if theirs are empty - the claimer's own changes lived on that person), the
        inviter keeps the old name as "I call them", and the people the claimer could see become rows on
        the claimer's account. The `messages` switches the old claim wrote are already on the link."""
        if "person_claims" not in self._table_names():
            return 0
        with self._tx() as cur:
            cur.execute("SELECT person_id, owner_id, account_id, see_people, messages FROM person_claims")
            old = cur.fetchall()
        n = 0
        for pid, owner, acct, see, _msgs in old:
            row = self.person_row(pid)
            if not row or row["account_id"] != owner or not acct or acct == owner:
                continue
            first = self.ensure_default_person(acct)
            link = self.create_link(owner, acct, created_by=acct)
            ts = _now()
            with self._tx() as cur:
                if not row["home_id"]:
                    cur.execute(self._q(
                        "UPDATE people SET home_id=?, source_id=?, link_id=?, made_by='claim', "
                        "call_name=COALESCE(NULLIF(call_name,''), name) WHERE id=?"), (first, first, link["id"], pid))
                    cur.execute(self._q("UPDATE people SET home_id=? WHERE home_id=?"), (first, pid))
                cur.execute(self._q(
                    f"SELECT p.id FROM people p WHERE p.account_id=? AND (p.home_id IS NULL OR p.home_id='') "
                    f"ORDER BY {self._PEOPLE_ORDER}"), (owner,))
                homes = [x[0] for x in cur.fetchall()]
                seen = homes if see else homes[:1]
                for q in seen:
                    self._add_linked_row(cur, acct, home_id=q, source_id=q, link_id=link["id"], ts=ts)
            if not row["home_id"]:
                self.copy_profile_if_empty(owner, pid, acct, first)
            n += 1
        with self._tx() as cur:
            cur.execute("DROP TABLE IF EXISTS person_claims")
        return n

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
        them, and that is the point.

        A PROFILE OTHER ACCOUNTS HOLD (2026-10-04 night): their rows stay, as their own plain rows named
        what they called them (a GUESS - Mike's list; the case for the opposite is that the person meant to
        leave everybody's page, which "Stop sharing" with each of them does). The switches on this person
        go with it."""
        scope = person_scope(person_id)
        row = self.person_row(person_id)
        mine = bool(row) and row["account_id"] == account_id
        holders = self.holders_of(person_id) if mine and not row["home_id"] else []
        with self._tx() as cur:
            for h in holders:
                self._make_plain(h, home_name=row["name"], cur=cur)
            if mine:
                cur.execute(self._q("DELETE FROM link_permissions WHERE person_id=?"), (person_id,))
                # A row a connection put here takes the permissions that came with it (drop_held_row says which),
                # so deleting your card for somebody does not leave you able to message them through it.
                if row["home_id"]:
                    self._drop_copy_permissions(cur, row)
            cur.execute(self._q("DELETE FROM state WHERE user_id=? AND profile_id=?"), (account_id, scope))
            if mine:
                self._drop_person_labels(cur, person_id)
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
            r = self._first_person(cur, account_id)
            if r is not None:
                return r["id"]
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
    # (description, is_personal, WHAT TURNS IT ON)
    #
    # *** THE THIRD ELEMENT SAYS WHAT ACT CREATES THE ROW, and it is not a boolean. *** The
    # review asked for an "on/off column per account" so that "every one of these is opt in"
    # would be visible rather than asserted. A true/false toggle would have overclaimed in
    # exactly the way the old privacy headline did: `profiles` is not opt-in, it IS the
    # product — you cannot have a screen and not have a row saying you made one.
    #
    # What is actually true, and stronger, is that NOTHING HERE EXISTS BECAUSE SOMEBODY MADE
    # AN ACCOUNT. Every row is caused by a specific thing the person did, and naming that act
    # is checkable in a way a green tick is not. Same correction as the headline: claim the
    # thing the data supports.
    STORAGE_NOTES = {
        "profiles":        ("The screens you made, and what you called them.", False,
                            "when you make a screen"),
        "profile_modules": ("Which modules are on each screen, and in what order.", False,
                            "when you add a module to a screen"),
        # The weather town (MIKE_LIST_20260930, Weather item 6): the Weather panel keeps the
        # place in its own settings, here, so this row is where it is declared. Said in full
        # because a town IS a location, and NEVER_STORED below used to say "your location" flat.
        "state":           ("Settings for those modules - a photo interval, a theme, a "
                            "layout. Small, and yours. For the question games: each player's "
                            "level and how each question has gone, on the screen they play on; "
                            "for the person a screen is for, their Trivia level and where it "
                            "starts are kept with them instead, so it is the same on each of "
                            "their screens. Also the name you sign notes with, "
                            "if you choose one. Your page: the parts on it, what you wrote in "
                            "About me, who can see your page, which parts of it they are "
                            "shown, its colours, and whether it shows older messages. And if "
                            "you set a place for Weather: the town "
                            "you typed, the match you picked with its position rounded to "
                            "about 11 km, and the last forecast, so the panel knows where to "
                            "look and still has something to show without a connection. "
                            "That place is also sent to Open-Meteo, a free weather service, "
                            "to fetch the forecast. And if you turn on Claude for your account: "
                            "your Claude API key, ENCRYPTED (never shown back, only its last four "
                            "characters), the models you chose, your daily spending limit, and a "
                            "count per day of how much was used and what it cost - never what "
                            "was said. What you say to Claude is sent to Anthropic to be answered, "
                            "as text only. And if you add a YouTube or Spotify key to search "
                            "for songs and videos by name: those keys, ENCRYPTED (never shown "
                            "back, only the last four characters), and which YouTube filter you "
                            "chose. What you search for is sent to YouTube or Spotify to be "
                            "answered and is not kept here.", False,
                            "when you change a setting"),
        "events":          ("An append-only log of what a module did: which photo was shown "
                            "when, a game result. It GROWS over time. Sensor readings, if you "
                            "run a logger, arrive here too.", True,
                            "when a module you added writes one"),
        "people":          ("The NAME you gave a person, so their screen can say who it is "
                            "for, and what you call them if you chose a name of your own for "
                            "anybody on your page (only the people using your login see that). This is the most personal "
                            "thing here. When somebody's profile is on your page because you "
                            "connected, or because they took over a person you made: which profile "
                            "it is (theirs, kept on their own login), which connection put them "
                            "there, and how - so stopping sharing removes exactly that.", True,
                            "when you add a person, connect with somebody, or somebody shares a "
                            "person with you"),
        # 2026-10-05: "I call them" for just one of the people on a login (claims.seen_name).
        "person_labels":   ("When more than one person uses the same login: what one of them calls "
                            "somebody on their page, if they saved it just for themselves rather than "
                            "for everyone on the login - who set it, who it is for, and the name. It shows only while "
                            "the page is for the person who set it, never to the person it names or to "
                            "anybody on another login. Removing either person removes it.", True,
                            "when somebody saves an \"I call them\" name just for themselves"),
        "media_sources":   ("A label and an ADDRESS for the folder your media lives in - a "
                            "pointer at your own machine. Never the files themselves.", True,
                            "when you connect a folder"),
        "drive_grants":    ("Which other accounts you have allowed to drive a screen, and "
                            "until when.", True,
                            "when you let somebody drive a screen"),
        "device_keys":     ("A credential for each unattended screen you set up, and the name "
                            "you gave it.", True,
                            "when you adopt an unattended screen"),
        "links":           ("Who you are connected to - one entry for each pair of people. "
                            "It is a relationship, not a permission: it lasts until one of "
                            "you ends it.", True,
                            "when you connect to somebody"),
        "link_permissions": ("What each connection is allowed to do - send messages, call, "
                            "watch a screen, add photos. Each one can be switched off on its "
                            "own, and ending the connection removes them all.", True,
                            "when you allow a connection to do something"),
        "claim_invites":   ("A link you made to connect with somebody, or inviting somebody to take "
                            "over one of your people: which kind, which person, which of your people "
                            "it shares and whether they may leave messages for each, when it runs "
                            "out, and whose login used it. Never the link itself - only a scrambled "
                            "form of it that cannot be turned back into a working link. A link nobody "
                            "used is deleted 30 days after it runs out or is taken back.", True,
                            "when you send somebody a link"),
        "sessions":        ("When a play or therapy session started and ended, and how it "
                            "ended. It is what lets a result say who was in the room, without "
                            "tagging every single answer.", True,
                            "when a session is recorded"),
        "session_roster":  ("Who was present for a session and in what part - playing, "
                            "helping, observing - and when they came and went.", True,
                            "when a session is recorded"),
        "screen_pairings": ("A short-lived code while a screen is being set up. Deleted "
                            "afterwards.", False,
                            "only while a screen is being set up"),
        "pairings":        ("A short-lived code while a media folder is being connected. "
                            "Deleted afterwards.", False,
                            "only while a folder is being connected"),
        "will":            ("Legacy table, unused.", False),
    }

    # Said once, on the page, because it is the part that matters and it is still true.
    NEVER_STORED = [
        "your photos, videos or recordings - they stay on your machine",
        "camera feeds - they never leave the device",
        "your location - the device is never asked where it is (a town you type for "
        "Weather is a setting, listed above)",
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
                # What the person did to cause this row. Unknown for an undescribed table, and
                # saying so is better than guessing on a privacy page.
                "when": (note[2] if note and len(note) > 2 else None),
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
    # caseload) needs each resident's photos to be THEIRS: on their screen, and not on
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
    #   1. ORGANIZATION, and this is the honest primary. The right albums on the right
    #      screen. An account with several people needs one person's photos to be what
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

        `principal_type` is normalized on the way in - an unrecognized value becomes NULL
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

    def get_event(self, user_id: str, pid: str, stream: str, event_id) -> dict | None:
        """One event, scoped to its owner. None if it is not there or not theirs.

        SCOPED ON PURPOSE: this is what attestation uses to check a target exists, and an
        unscoped lookup would let somebody attest a row in another account's stream - which
        would write their name onto data they cannot even read.
        """
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT id, kind, data, created_at, session_id, principal_id, principal_type, "
                "attested_by, attested_at, producer_version FROM events "
                "WHERE user_id=? AND profile_id=? AND stream=? AND id=?"),
                (user_id, pid, stream, event_id))
            r = cur.fetchone()
        if not r:
            return None
        return {"id": r[0], "kind": r[1], "data": json.loads(r[2]), "created_at": r[3],
                "session_id": r[4], "principal_id": r[5], "principal_type": r[6],
                "attested_by": r[7], "attested_at": r[8], "producer_version": r[9]}

    def attest_event(self, user_id: str, pid: str, stream: str, event_id,
                     *, attester: str, note: str = "") -> dict:
        """Vouch for one row, as a NEW append-only event that cites it.

        *** `attester` COMES FROM THE AUTHENTICATED SESSION, NEVER FROM A REQUEST BODY. ***
        That is the entire trust model and the reason the four attestation columns are not
        postable: you may only attest as yourself, so the server never evaluates a claim about
        a third party. See provenance.py's ATTESTATION block.

        The trial row is NOT touched - it could not be, the triggers forbid it - so what makes
        a row attested is the existence of another row pointing at it.
        """
        target = self.get_event(user_id, pid, stream, event_id)
        problem = provenance.attestation_problem(target, attester)
        if problem:
            raise ValueError(problem)
        return self.append_event(
            user_id, pid, stream, provenance.ATTESTATION_KIND,
            provenance.attestation_row(target_id=target["id"], attester=attester, note=note),
            # The attestation row's own provenance. `attested_at` is when THIS row was
            # written, which is genuinely when somebody looked - not when the trial happened.
            session_id=target.get("session_id"),
            principal_id=attester, principal_type="human",
            attested_by=attester, attested_at=_now(),
        )

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
        # THE PROVENANCE COLUMNS COME BACK OUT. They were selected here and then dropped on the
        # floor by the row builder, which made them WRITE-ONLY: a value could be stored and
        # never read through the normal path. On an append-only clinical log that is worse than
        # not having the column, because the row looks complete and its producer is
        # unrecoverable. Null stays null and still means "not captured".
        events = [
            {"id": r[0], "kind": r[1], "data": json.loads(r[2]), "created_at": r[3],
             "session_id": r[4], "principal_id": r[5], "principal_type": r[6],
             "attested_by": r[7], "attested_at": r[8], "producer_version": r[9]} for r in rows
        ][::-1]  # chronological (oldest first) for display
        return {"events": events, "total": total}

    def events_before(self, user_id: str, profile_ids: list[str], streams: tuple[str, ...] | list[str], kind: str,
                      *, before: int | None = None, limit: int = 50) -> list[dict]:
        """One account's events of one kind across several screens and streams, NEWEST FIRST, with ids below
        `before` (None: from the newest). For "See older messages" (notes.py): a page at a time, by id, so a note
        arriving while somebody reads does not shift what "Show more" brings. Ids only ever grow, on both engines.
        No provenance columns: the caller lists words, not who wrote the row."""
        if not profile_ids or not streams:
            return []
        pin = ",".join("?" for _ in profile_ids)
        sin = ",".join("?" for _ in streams)
        sql = (f"SELECT id, profile_id, stream, kind, data, created_at FROM events WHERE user_id=? "
               f"AND profile_id IN ({pin}) AND stream IN ({sin}) AND kind=?")
        params: list = [user_id, *profile_ids, *streams, kind]
        if before is not None:
            sql += " AND id < ?"
            params.append(int(before))
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(int(limit))
        with self._tx() as cur:
            cur.execute(self._q(sql), tuple(params))
            rows = cur.fetchall()
        return [{"id": r[0], "profile_id": r[1], "stream": r[2], "kind": r[3], "data": json.loads(r[4]),
                 "created_at": r[5]} for r in rows]

    def rows_through(self, owner: str, visitor: str) -> list[str]:
        """The owner's rows that stand for the visitor's login: each row on the owner's page whose profile came
        through the visitor's login (its `source_id` is a row of theirs). What "Who can see my page: people I
        pick" names (page_visits.py)."""
        with self._tx() as cur:
            cur.execute(self._q(
                "SELECT p.id FROM people p JOIN people s ON s.id = p.source_id "
                "WHERE p.account_id=? AND s.account_id=?"), (owner, visitor))
            return [r[0] for r in cur.fetchall()]


class SQLiteStore(_Store):
    """Local-dev engine. One connection + a lock (the coordination server is tiny)."""

    _pg = False

    def __init__(self, path: str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()
        self._migrate_old_claims()

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
                -- home_id .. made_by: PEOPLE ACROSS ACCOUNTS (claims.py; the storage section above
                -- says what each holds). All nullable: a NULL home_id is a row that is its own home,
                -- which is what every row written before them was. Indexed after the guarded ALTERs.
                CREATE TABLE IF NOT EXISTS people (
                    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
                    created_at TEXT NOT NULL, home_id TEXT, call_name TEXT, source_id TEXT,
                    link_id TEXT, made_by TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_people_account ON people(account_id);

                -- "I CALL THEM", PER PERSON (2026-10-05; claims.seen_name, and the storage note
                -- beside person_labels() argues a table over a state key): the name `viewer_id`
                -- calls `person_id`, both people on `account_id`.
                CREATE TABLE IF NOT EXISTS person_labels (
                    account_id TEXT NOT NULL, viewer_id TEXT NOT NULL, person_id TEXT NOT NULL,
                    name TEXT NOT NULL, updated_at TEXT NOT NULL,
                    PRIMARY KEY (account_id, viewer_id, person_id)
                );
                CREATE INDEX IF NOT EXISTS ix_person_labels_person ON person_labels(person_id);

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

                -- INVITATIONS (claims.py). An invitation holds the SHA-256 of its token, never the
                -- token. `kind` claim | connect; `shares` the people it shares, as JSON. The old
                -- `person_claims` table (8908b2c) is carried into people.home_id and dropped by
                -- _migrate_old_claims - it is not created here any more.
                CREATE TABLE IF NOT EXISTS claim_invites (
                    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, owner_id TEXT NOT NULL,
                    person_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
                    used_at TEXT, used_by TEXT, cancelled_at TEXT,
                    see_people INTEGER NOT NULL DEFAULT 1, messages INTEGER NOT NULL DEFAULT 1,
                    kind TEXT NOT NULL DEFAULT 'claim', shares TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS ux_claim_invites_hash ON claim_invites(token_hash);
                CREATE INDEX IF NOT EXISTS ix_claim_invites_person ON claim_invites(owner_id, person_id);

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
            # People across accounts (2026-10-04 night): a profile's home, "I call them", and where a
            # row came from. Nullable, undefaulted: every existing row is its own home, as it was.
            pcols = {r[1] for r in self._conn.execute("PRAGMA table_info(people)")}
            for col in ("home_id", "call_name", "source_id", "link_id", "made_by"):
                if col not in pcols:
                    self._conn.execute(f"ALTER TABLE people ADD COLUMN {col} TEXT")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_people_home ON people(home_id)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_people_link ON people(link_id)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_people_source ON people(source_id)")
            icols = {r[1] for r in self._conn.execute("PRAGMA table_info(claim_invites)")}
            if "kind" not in icols:
                self._conn.execute("ALTER TABLE claim_invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'claim'")
            if "shares" not in icols:
                self._conn.execute("ALTER TABLE claim_invites ADD COLUMN shares TEXT")
            self._conn.commit()


    def _table_names(self) -> list[str]:
        cur = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        return [r[0] for r in cur.fetchall()]


class PostgresStore(_Store):
    """Deploy engine (Render's managed Postgres / any Postgres). A small pooled
    connection; the SAME ``_Store`` logic runs on top. Its live smoke is the deploy step
    (docs/deploy.md Part B) — there is no local Postgres in dev to run it against here."""

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
        # *** A SLOW OR UNREACHABLE DATABASE AT BOOT MUST NOT TAKE DOWN THE WHOLE SITE. ***
        # Found 2026-09-14: this raised `PoolTimeout` on every restart for two hours
        # straight (Render's Events log: "Instance failed... exited with status 1", every
        # ~6 minutes) because Neon was not answering within 30s. Since this constructor runs
        # at MODULE IMPORT TIME (`app.py`'s `store = PostgresStore(...)`), that exception
        # crashed the import, which meant uvicorn never started serving ANYTHING -- not just
        # the DB-backed routes, but landing.html, modules.html, the anonymous local kiosk,
        # every static file -- none of which touch this store at all. Render's supervisor
        # then restarted the process into the identical failure, on a loop, for two hours.
        #
        # `.wait()` was only ever a nicety: `ConnectionPool` opens connections in a
        # background thread regardless of whether anything calls `.wait()`, so skipping it
        # (or having it time out) does not stop the pool from working -- a later checkout
        # via `self._tx()` simply waits for a connection itself, or raises for THAT ONE
        # REQUEST, which FastAPI turns into a 500 without taking the process down. So a slow
        # or currently-unreachable database now costs one clear log line at boot instead of
        # the whole product.
        #
        # KNOWN GAP, not silently papered over: if `_migrate()` below also fails because the
        # database was unreachable, migrations for this deploy will not automatically retry
        # -- they only run here, at construction. A deploy that both needs a new migration
        # AND boots while the database is unreachable would need a manual restart once the
        # database is confirmed healthy. Written down rather than solved here because the
        # fix that matters right now is "the site stays up," not "migrations self-heal."
        try:
            self._pool.wait(timeout=30.0)
        except Exception as err:
            log.error("Postgres pool not ready at boot (%s) -- serving anyway; "
                      "it keeps trying to connect in the background", err)
        try:
            self._migrate()
        except Exception as err:
            log.error("Migration did not run at boot (%s) -- it will NOT be retried "
                      "automatically; restart the service once the database is reachable "
                      "if this deploy added one", err)
        try:
            self._migrate_old_claims()
        except Exception as err:
            # Each old claim is carried over idempotently and the table is dropped only at the end, so
            # a failure here leaves person_claims in place for the next boot to finish.
            log.error("Carrying old claims into the home model did not finish (%s) -- "
                      "the next restart tries again", err)

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
            "CREATE TABLE IF NOT EXISTS drive_grants (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, "
            "person_id TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, "
            "label TEXT NOT NULL DEFAULT '', expires_at TEXT, created_at TEXT NOT NULL)",
            # Additive and defaulted, so a live database keeps working while the deploy rolls:
            # old code writing a row gets `moderator` from the default, new code reading an old
            # row gets `moderator` too. *** MUST FOLLOW THE CREATE TABLE ABOVE. *** Found
            # 2026-09-16, migrating to a brand-new empty Postgres: this ran FIRST on the live
            # database's own boot, which worked only because that table already existed from
            # years of use — an empty database has nothing yet to ALTER, so `_migrate()` failed
            # on its very first statement and silently created NOTHING (the whole method runs
            # in one transaction; the first error rolls all of it back). Every other ALTER in
            # this file already follows its table's CREATE — this was the one out of order.
            "ALTER TABLE drive_grants ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'moderator'",
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

            # Invitations - see claims.py and the SQLite block above. person_claims is no longer
            # created: _migrate_old_claims carries any rows into people.home_id and drops it.
            "CREATE TABLE IF NOT EXISTS claim_invites (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, "
            "owner_id TEXT NOT NULL, person_id TEXT NOT NULL, created_at TEXT NOT NULL, "
            "expires_at TEXT NOT NULL, used_at TEXT, used_by TEXT, cancelled_at TEXT, "
            "see_people INTEGER NOT NULL DEFAULT 1, messages INTEGER NOT NULL DEFAULT 1, "
            "kind TEXT NOT NULL DEFAULT 'claim', shares TEXT)",
            "ALTER TABLE claim_invites ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'claim'",
            "ALTER TABLE claim_invites ADD COLUMN IF NOT EXISTS shares TEXT",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_claim_invites_hash ON claim_invites(token_hash)",
            "CREATE INDEX IF NOT EXISTS ix_claim_invites_person ON claim_invites(owner_id, person_id)",

            "CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, "
            "name TEXT NOT NULL, created_at TEXT NOT NULL, home_id TEXT, call_name TEXT, source_id TEXT, "
            "link_id TEXT, made_by TEXT)",
            # People across accounts - nullable, undefaulted; every existing row is its own home.
            "ALTER TABLE people ADD COLUMN IF NOT EXISTS home_id TEXT",
            "ALTER TABLE people ADD COLUMN IF NOT EXISTS call_name TEXT",
            "ALTER TABLE people ADD COLUMN IF NOT EXISTS source_id TEXT",
            "ALTER TABLE people ADD COLUMN IF NOT EXISTS link_id TEXT",
            "ALTER TABLE people ADD COLUMN IF NOT EXISTS made_by TEXT",
            "CREATE INDEX IF NOT EXISTS ix_people_account ON people(account_id)",
            "CREATE INDEX IF NOT EXISTS ix_people_home ON people(home_id)",
            "CREATE INDEX IF NOT EXISTS ix_people_link ON people(link_id)",
            "CREATE INDEX IF NOT EXISTS ix_people_source ON people(source_id)",
            # "I call them", per person - see the SQLite block.
            "CREATE TABLE IF NOT EXISTS person_labels (account_id TEXT NOT NULL, viewer_id TEXT NOT NULL, "
            "person_id TEXT NOT NULL, name TEXT NOT NULL, updated_at TEXT NOT NULL, "
            "PRIMARY KEY (account_id, viewer_id, person_id))",
            "CREATE INDEX IF NOT EXISTS ix_person_labels_person ON person_labels(person_id)",

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
