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
import secrets
import sqlite3
import threading
import uuid

# Pure rules, no storage - db imports grants and never the other way round.
import grants
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
            # Same story one table over: grants shipped before they conferred a role, so an
            # existing table needs the column added. Defaulted to `moderator`, which is what
            # every grant made before this already effectively was.
            gcols = {r[1] for r in self._conn.execute("PRAGMA table_info(drive_grants)")}
            if "role" not in gcols:
                self._conn.execute(
                    "ALTER TABLE drive_grants ADD COLUMN role TEXT NOT NULL DEFAULT 'moderator'")
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
            # Additive and defaulted, so a live database keeps working while the deploy rolls:
            # old code writing a row gets `moderator` from the default, new code reading an old
            # row gets `moderator` too.
            "ALTER TABLE drive_grants ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'moderator'",
            "CREATE TABLE IF NOT EXISTS drive_grants (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, "
            "person_id TEXT NOT NULL, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, "
            "label TEXT NOT NULL DEFAULT '', expires_at TEXT, created_at TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS ix_grants_person ON drive_grants(owner_id, person_id)",
            "CREATE INDEX IF NOT EXISTS ix_grants_subject ON drive_grants(subject_kind, subject_id)",

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
