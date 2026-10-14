"""quota.py - HOW MUCH ONE LOGIN MAY KEEP ON THIS SITE, and what it is told when it is full. Tested: test_quota.py.

Mike, 2026-10-14 (DECISIONS.md, "a per-account storage limit"): *"Seems like we would need some limit to keep the site
free."* storage_line.py rule 10 closes the obvious shapes of a recording smuggled into ONE row, and says what it cannot
close: a client set on it can spread a recording over many small rows, because nothing counted how much one account
keeps. This is that count, and the line drawn on it.

THE RULES:
  1. EVERYTHING A LOGIN KEEPS IS COUNTED, in every table that holds what a client sends (USAGE_TABLES): the bytes of
     every column of every row, plus ROW_OVERHEAD a row for what the database spends keeping it. Tables two logins
     share, or that only exist for a few minutes, are not counted, and NOT_COUNTED says why for each - a table in
     neither list fails test_quota.py, so a new table cannot be left out of the count by forgetting it.
  2. A MESSAGE LEFT ON SOMEBODY ELSE'S SCREEN (a note, a recommendation) IS COUNTED AGAINST WHOEVER LEFT IT, not the
     person it was left for. Those rows live in the recipient's event log (and say who wrote them, `principal_id`),
     but a family must never find their own login full because somebody else filled it - and the sender's own room
     is what bounds how much they can leave.
  3. A WRITE THAT WOULD TAKE THE LOGIN PAST THE LIMIT IS REFUSED, WITH A SENTENCE (`refusal`): what the limit is, what
     uses the space, and what to do. Never silently dropped. HTTP 507 ("Insufficient Storage", what Dropbox and
     Nextcloud answer for a full account): a 5xx, so a screen's history copy keeps its place and tries again later
     instead of giving those entries up for good (history_place.js), which is right - room can be made.
  4. READS ALWAYS WORK, AND SO DOES REMOVING THINGS. A write that does not grow the login - a setting overwritten
     with something no bigger, which is most of what a screen does all day - is never refused, even over the limit.
     So a login already over the limit when this ships (or after the limit is lowered) keeps working: its screens
     keep their settings, nothing already kept is touched or lost, and only what would ADD to it waits until there
     is room. A count of zero growth is "no bigger", so a screen re-saving the same setting is never refused.
  5. THE LIMIT IS SERVER CONFIG, NOT A PERSON'S SETTING: the environment variable NIMROD_ACCOUNT_LIMIT_MB (megabytes,
     a decimal number). 0 turns it off (somebody running their own copy of the site for one family). Unset, or not a
     number: DEFAULT_LIMIT_MB.

THE NUMBERS ARE DEFAULTS, ARGUED (Rule 1, 2026-09-11):

  DEFAULT_LIMIT_MB = 100. Measured 2026-10-14 on a copy of the dev database (8,785 logins, nearly all of them test
    suites' and Mike's own dev login - there is no real household in it; production was not touched): median 1.1 KB,
    95th percentile 18 KB, the heaviest 269 KB, all counted the way this file counts. What a HEAVY REAL household
    could legitimately need, from the caps that already exist: history kept with us is at most HISTORY_MAX_ROWS
    (10,000) rows a person at most 1 KiB each - about 13 MB a person with its totals, 2-4 MB typically; the
    walkthrough notes record at every maximum at once is 1.26 MB (storage_line.py); twenty screens of settings are
    well under 1 MB. Four people with every cap full is about 60 MB. The event log has no cap (it is append-only by
    design, provenance.py) and grows by roughly 100-300 bytes a game result or note.
    100 MB is about 370 times the heaviest login measured, clears the four-people-every-cap-full household, and leaves
    room for years of its event log.
    What it costs: production is Render's managed Postgres (moved off Neon 2026-09-19, docs/deploy.md), whose storage
    is billed per GB a month (about $0.30) - a login at the full 100 MB costs about 3 cents a month. Neon's free plan,
    the free path if the site ever goes back to it, holds 1 GB a project (neon.com/pricing, read 2026-10-14) - ten
    logins at the full limit. So this limit stops ONE login filling the database; it does not make one free database
    big enough for everybody, and the database's own size still has to be watched as the site grows.
    For a lower number (25 MB): forty full logins to a free 1 GB database instead of ten. Against: a heavy household
    with history kept with us for several people would reach it in a year or two, and the part of the space that is
    the event log cannot be removed by the person (append-only), so reaching it through ordinary use is a wall only a
    raised limit fixes. For a higher one (500 MB): nobody legitimate is near it, but two full logins would fill a free
    database. Mike's call; one number.
  ROW_OVERHEAD = 100 bytes a row: what the database spends on a row beyond its text - Postgres's row header and line
    pointer (about 28 bytes) and an entry in each index (the event log has four). Counted so that a client spreading
    something over many tiny rows pays for the rows, not only for their few bytes of text.
  RECOUNT_S = 300 and FRESH_S = 30: the count is a query over the login's rows, so it is not run on every write. A
    login comfortably under the limit is recounted at most every five minutes (writes in between are added to the
    last count as they are accepted); a write that would bring it within NEAR (90%) of the limit gets a count no
    more than thirty seconds old first, and a refusal is only ever made on such a count. Room made shows at once:
    removing history, a person, a screen, a module or a folder forgets the count, and a setting saved smaller is
    taken off it. Anything else removed shows within thirty seconds.

Sizes are counted as the database holds them. Text is stored as JSON with every non-English letter written as a
six-character escape (\\u00e9), so a setting in Chinese counts more than its weight in letters - at 100 MB that is far
from mattering, but it is said here so nobody is surprised by it.
"""
from __future__ import annotations

import json
import os
import threading

ENV = "NIMROD_ACCOUNT_LIMIT_MB"
DEFAULT_LIMIT_MB = 100
ROW_OVERHEAD = 100
RECOUNT_S = 300.0
FRESH_S = 30.0
NEAR = 0.9
STATUS = 507
MB = 1_000_000                     # megabytes as people mean them (and as hosting bills them), not mebibytes

# Every table that holds what a client sends, and the column that names the login it belongs to. `profile_modules`
# and `session_roster` name theirs through the row they hang off (db.py account_usage joins them). The event log is
# split by rule 2 (db.py account_usage).
USAGE_TABLES = {
    "state": "user_id",
    "events": "user_id",
    "history": "user_id",
    "history_totals": "user_id",
    "people": "account_id",
    "person_labels": "account_id",
    "profiles": "user_id",
    "profile_modules": ("profiles", "profile_id", "user_id"),
    "media_sources": "user_id",
    "drive_grants": "owner_id",
    "claim_invites": "owner_id",
    "device_keys": "user_id",
    "sessions": "user_id",
    "session_roster": ("sessions", "session_id", "user_id"),
}

# The tables that are NOT counted, and why. A table in neither list fails test_quota.py.
NOT_COUNTED = {
    "links": "one row for two logins (a connection): counting it against either one would be arbitrary, and a pair "
             "has exactly one",
    "link_permissions": "the switches on a connection, shared by both logins, and at most one of each switch a person",
    "pairings": "a code that lives for fifteen minutes while a folder is connected, belonging to no login until used",
    "screen_pairings": "a code that lives for ten minutes while a screen is set up, belonging to no login until used",
    "will": "legacy, unused",
}

# The words for each table when a person is told what uses their space (the same words as the "what we keep" list).
WORDS = {
    "state": "settings",
    "events": "the activity log (game results, notes and messages)",
    "history": "history kept with us",
    "history_totals": "history totals",
    "people": "people",
    "person_labels": "names you call people",
    "profiles": "screens",
    "profile_modules": "modules on screens",
    "media_sources": "folder addresses",
    "drive_grants": "who may control a screen",
    "claim_invites": "invitations",
    "device_keys": "screens' sign-ins",
    "sessions": "sessions",
    "session_roster": "who was at each session",
}


def limit_bytes(environ=None) -> int | None:
    """The limit in bytes, from NIMROD_ACCOUNT_LIMIT_MB; None when it is turned off (0)."""
    raw = (environ if environ is not None else os.environ).get(ENV, "")
    try:
        mb = float(raw) if str(raw).strip() else float(DEFAULT_LIMIT_MB)
    except ValueError:
        mb = float(DEFAULT_LIMIT_MB)
    if mb != mb or mb < 0 or mb == float("inf"):   # NaN, negative, infinite: not a limit anybody meant
        mb = float(DEFAULT_LIMIT_MB)
    return None if mb == 0 else int(round(mb * MB))


def stored(data) -> str:
    """A row's JSON exactly as db.py writes it (json.dumps' defaults), so a size here is the size stored there."""
    return json.dumps(data)


def row_size(*texts) -> int:
    """What one new row costs: the bytes of its text, plus ROW_OVERHEAD."""
    return ROW_OVERHEAD + sum(len(t.encode("utf-8")) for t in texts if isinstance(t, str))


def say_size(n: int) -> str:
    """Bytes as a person reads them: '840 bytes', '12 KB', '3.4 MB', '100 MB'."""
    if n < 1000:
        return f"{n:,} bytes"
    if n < MB:
        return f"{n / 1000:,.0f} KB"
    mb = n / MB
    return f"{mb:,.0f} MB" if mb >= 10 or mb == int(mb) else f"{mb:,.1f} MB"


def top_parts(tables: dict, n: int = 2) -> list[str]:
    """The words for the biggest `n` parts of a count (db.py account_usage's `tables`)."""
    ranked = sorted(((v.get("bytes", 0), t) for t, v in (tables or {}).items() if v.get("bytes")), reverse=True)
    return [WORDS.get(t, t) for _, t in ranked[:n]]


def refusal(used: int, limit: int, tables: dict) -> str:
    """The sentence a full login reads: the limit, what uses the space, what to do. Nothing technical."""
    parts = top_parts(tables)
    most = f" Most of it is {' and '.join(parts)}." if parts else ""
    tail = ""
    if parts and parts[0] == WORDS["events"]:
        tail = (" The activity log cannot be removed from here; if it is what fills the space, whoever runs this "
                "site can raise the limit.")
    return (f"This was not saved: this login keeps {say_size(used)} on this site, and the most one login can keep is "
            f"{say_size(limit)}.{most} To make room, remove history kept with us (\"Where your history is kept\", "
            f"then \"Remove what is kept with us\"), or keep things in your own Nimrod folder instead. Nothing "
            f"already kept is lost, and everything can still be seen and changed.{tail}")


def usage_sentence(used: int, limit: int | None) -> str:
    """One line for the account page: how much this login keeps, of how much."""
    if limit is None:
        return f"This login keeps {say_size(used)} on this site. This site has no limit for one login."
    if used <= 0:
        return f"This login keeps nothing on this site yet. One login may keep up to {say_size(limit)}."
    pct = 100 * used / limit if limit else 0
    over = " That is over the limit: what is kept stays, but nothing more can be added until there is room." \
        if used > limit else ""
    return (f"This login keeps {say_size(used)} on this site, of the {say_size(limit)} one login may keep "
            f"({pct:,.1f}%).{over}")


def limit_sentence(limit: int | None) -> str:
    """The public line on "what we keep" (no login's data in it)."""
    if limit is None:
        return "This copy of the site sets no limit on how much one login may keep."
    return (f"Each login may keep up to {say_size(limit)} here, all of the above together. That keeps the site free "
            f"to run. Past it, nothing already kept is lost or hidden; only adding more waits until there is room.")


def allowed(used: int, adding: int, limit: int | None) -> bool:
    """May a write that adds `adding` bytes go ahead? A write that does not grow the login always may (rule 4)."""
    return limit is None or adding <= 0 or used + adding <= limit


class UsageCache:
    """The last count for each login, plus what was accepted since. In the process (one per server); a restart
    starts counting again, which only costs a query. `count(account)` must return db.py account_usage's dict."""

    def __init__(self, recount_s: float = RECOUNT_S, fresh_s: float = FRESH_S, near: float = NEAR,
                 max_entries: int = 20_000):
        self.recount_s, self.fresh_s, self.near, self.max_entries = recount_s, fresh_s, near, max_entries
        self._lock = threading.Lock()
        self._d: dict[str, dict] = {}

    def check(self, account: str, adding: int, limit: int | None, count, now: float) -> tuple[bool, dict]:
        """(may it go ahead, the count used to decide - {"bytes", "tables", ...}). Counts again when the last count
        is too old for the decision (see the module's RECOUNT_S / FRESH_S): never refuses on an old count."""
        if limit is None or adding <= 0:
            return True, {}
        with self._lock:
            e = self._d.get(account)
        est = (e["bytes"] + e["added"]) if e else 0
        age = (now - e["at"]) if e else None
        nearly = e is not None and est + adding > self.near * limit
        if e is None or age > self.recount_s or (nearly and age > self.fresh_s):
            e = self.store(account, count(account), now)
            est = e["bytes"]
        return allowed(est, adding, limit), {**e, "bytes": est}

    def store(self, account: str, usage: dict, now: float) -> dict:
        e = {"bytes": int(usage.get("bytes", 0)), "tables": usage.get("tables", {}), "rows": usage.get("rows", 0),
             "at": now, "added": 0}
        with self._lock:
            if len(self._d) >= self.max_entries and account not in self._d:
                oldest = sorted(self._d, key=lambda a: self._d[a]["at"])[: max(1, self.max_entries // 10)]
                for a in oldest:
                    self._d.pop(a, None)
            self._d[account] = e
        return e

    def added(self, account: str, n: int) -> None:
        """A write of `n` bytes was accepted: add it to the last count until the next one. Negative for a setting
        saved smaller, so the room it made counts at once."""
        if not n:
            return
        with self._lock:
            e = self._d.get(account)
            if e is not None:
                e["added"] += n

    def peek(self, account: str) -> dict | None:
        """The last count and what was added since ({"bytes", "tables", "rows", "at", "added"}), or None."""
        with self._lock:
            e = self._d.get(account)
            return dict(e) if e else None

    def forget(self, account: str) -> None:
        """Something was removed: count afresh next time."""
        with self._lock:
            self._d.pop(account, None)
