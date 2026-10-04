"""notes.py - A NOTE LEFT FROM SOMEBODY ELSE'S ACCOUNT.

The note module (client `modules/note.js`, row 2.37) is one short note on a screen, kept as an
append-only events stream per screen. Until this file, only the account that owns the screen
could write it - the kiosk itself, or the owner's own phone. Mike, 2026-10-01: a visitor CAN
leave the note from their own account. This is the rule for that, pure and tested alone
(`test_notes.py`), the same shape as grants.py and links.py.

WHO MAY. The owner, always. Anybody else needs BOTH:
  1. a live drive grant on the person (grants.may_drive), AND
  2. a tick from the owner on the person's own row (`noteWriters`), the list the Remote tab
     edits - exactly how the intercom's approved list works (row 2.44).

WHY NOT THE DRIVE GRANT ALONE, which was the cheaper answer and has a real argument: a driver
can already change the note by driving the panel. But a driver can only PICK - a ready-made
note, a name already in the history - and only while the room can see the screen being driven.
This route lets somebody TYPE 280 characters of their own onto a screen, from anywhere, at any
hour. That is a different thing to consent to, and a grant given to a clinician for one therapy
block, or a "participant" grant for two people playing a game, was not consent to it. So the
grant is the outer wall and the tick is the specific yes. WHAT HAPPENS IF NOBODY TICKS ANYBODY:
nobody else can leave a note - inaction, not a stranded screen - which is the shape this project
accepts for a default-off permission.

WHY NOT links.py's `messages` capability, which is the long-term home of "may reach her with
words": links have storage and rules but no route and no UI yet, so a rule built on them would
work for nobody today. When links land, `messages` is the obvious second way in; it is one
`or` in `may_leave_note`.

WHO WROTE IT IS THE SERVER'S ANSWER. The row's `author` is the writing account's display name
(or "Someone" if it has none, or if the writer asked to be "Someone"), whatever the body said,
and the account itself is stamped in the row's `principal_id` column - which the owner reads
and a visitor never does. "Someone" hides the writer from the room, never from the owner.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict, deque

from grants import may_drive

# The module's own limits (note.js MAX_TEXT / MAX_NAME / SOMEONE). Kept equal by test_notes.py
# and note_visit_test.html between them; a mismatch shows up as a refused save.
MAX_TEXT = 280
MAX_NAME = 40
SOMEONE = "Someone"
NOTE_KIND = "note"
# The streams the module's "Which note" setting can pick. Nothing else is reachable here.
NOTE_STREAMS = ("note", "note2", "note3")
# TAKING THE NOTE DOWN is a row too (note.js TAKEN_DOWN): kind 'note', via 'taken down', no words,
# `from` = the row it took down. The history is never shortened - "nothing showing" is just the
# newest entry - and it needs no permission of its own: whoever may leave a note may take one down.
TAKEN_DOWN = "taken down"
VIA = ("changed", "put back", TAKEN_DOWN)

# WHERE THE TICK LIVES: the person's own row (person state, key `input-bindings` - the client's
# INPUTS_KEY, where the intercom's `intercomAllowed` already lives). Only the person's owner can
# write that row (app.py `owned_person` on person state), which is what makes it safe to read
# as a permission here.
PERSON_ROW_KEY = "input-bindings"
WRITERS_FIELD = "noteWriters"

# A display name: the same characters a person or screen name allows (app.NAME_RE), shorter.
DISPLAY_NAME_RE = re.compile(r"^[\w .,'’\-]{1,%d}$" % MAX_NAME)


def writers_from(row: dict | None) -> set[str]:
    """The ticked accounts on a person's row. PURE. Plain names, or the intercom list's
    `{account, name}` shape; anything else is ignored rather than trusted."""
    raw = (row or {}).get(WRITERS_FIELD) if isinstance(row, dict) else None
    out: set[str] = set()
    if not isinstance(raw, list):
        return out
    for e in raw:
        a = e if isinstance(e, str) else (e.get("account") if isinstance(e, dict) else None)
        if isinstance(a, str) and a.strip():
            out.add(a.strip())
    return out


def may_leave_note(person_id: str, *, account: str, owner: str | None, grants: list[dict],
                   writers: set[str], now_iso: str, messages: bool = False) -> bool:
    """The whole question. PURE. Read the module header for why it is grant AND tick.

    A person with no owner does not exist, and is indistinguishable from one you may not
    write to - same anti-oracle rule as grants.may_drive.

    `messages` (2026-10-04): the SECOND WAY IN this header left room for - a live links.py
    `messages` permission (links.may, answered by the caller). Only an invitation makes one
    (claims.py: the account that looks after the person said yes on it, for named people). It
    does not widen anything else: no drive grant, no tick, no screen state.
    """
    if not person_id or not account or not owner:
        return False
    if owner == account:
        return True
    if messages:
        return True
    if account not in (writers or set()):
        return False
    return may_drive(person_id, account=account, owner=owner, grants=grants, now_iso=now_iso)


def clean_display_name(raw: str | None) -> str:
    """'' clears the name. Raises ValueError on anything a name may not be."""
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    if not s:
        return ""
    if len(s) > MAX_NAME or not DISPLAY_NAME_RE.match(s):
        raise ValueError("a name is letters, numbers, spaces and . , ' - (at most %d)" % MAX_NAME)
    return s


def build_row(data: dict | None, *, display_name: str) -> dict:
    """The `data` the server stores for one note. PURE. Raises ValueError on a bad note.

    THE AUTHOR IS NOT TAKEN FROM THE BODY. The only thing a writer can choose is to be
    "Someone"; any other name in the body is replaced by their own.
    """
    d = data if isinstance(data, dict) else {}
    via = d.get("via") if d.get("via") in VIA else "changed"
    # A take-down carries no words, whatever the body sent: it is "no note showing", not a note.
    text = "" if via == TAKEN_DOWN else str(d.get("text") or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text and via != TAKEN_DOWN:
        raise ValueError("write a note first")
    if len(text) > MAX_TEXT:
        # Refused rather than cut: a note silently shortened says something its writer did not.
        raise ValueError(f"a note is at most {MAX_TEXT} characters")
    asked = re.sub(r"\s+", " ", str(d.get("author") or "")).strip()
    author = SOMEONE if asked.lower() == SOMEONE.lower() else (display_name or SOMEONE)
    src = d.get("from")
    src = src if isinstance(src, int) and not isinstance(src, bool) else None
    return {"text": text, "author": author, "via": via, "from": src}


def visible_row(e: dict) -> dict:
    """One row as a visitor sees it: what the screen shows, nothing about accounts."""
    d = e.get("data") if isinstance(e.get("data"), dict) else {}
    return {
        "id": e.get("id"), "kind": e.get("kind"), "created_at": e.get("created_at"),
        "data": {k: d.get(k) for k in ("text", "author", "via", "from") if k in d},
    }


# ---------------------------------------------------------------- "See older messages"
# Mike, 2026-10-04 (DECISIONS.md "People across accounts", item 9): "you can scroll back through your old notes".
# The person's own history across all their screens and all three note streams, newest first, a page at a time.
#
# HOW FAR BACK IT GOES: to the first note ever left. Notes are rows in the append-only `events` table, which a
# trigger keeps from being changed or deleted (the note's history is the note - see the header), so nothing here
# prunes, and this changes no retention: it reads what was already kept.
#
# WHAT IS LEFT OUT: a take-down (it has no words) and a "put back" (the same note shown again, already in the list
# once). WHAT A ROW SAYS: the words, who signed it, when, and which screen - never which login wrote it (the owner's
# own screen log has that, in `principal_id`; this list is for reading, not for auditing).
HISTORY_PAGE = 20      # how many one press of "Show more" brings: a phone screen or two of messages
HISTORY_MAX = 50       # the most one request may ask for: bounds one request, not a person


def history_entry(e: dict, screen_name: str = "") -> dict | None:
    """One note row as a line of "See older messages", or None if it is not one to list. PURE."""
    if not isinstance(e, dict) or e.get("kind") != NOTE_KIND:
        return None
    d = e.get("data") if isinstance(e.get("data"), dict) else {}
    if d.get("via") in (TAKEN_DOWN, "put back"):
        return None
    text = str(d.get("text") or "").strip()
    if not text:
        return None
    return {"id": e.get("id"), "text": text, "author": str(d.get("author") or "").strip() or SOMEONE,
            "at": e.get("created_at"), "screen": screen_name}


class RateLimit:
    """Sliding window, per key, in process.

    TWELVE IN TEN MINUTES, per writer per person. A note is meant to be THE note; somebody
    fiddling with the wording might save five times, and nobody leaving a note needs twelve.
    What it stops is a script (or a stuck retry) pushing a person's real notes out of the
    window the screen loads. A server-side guard, not a preference - but it is a number, so it
    is on Mike's list with this argument.

    SAME HONEST LIMIT AS app.py's pairing throttle: it resets on a restart and does not span
    workers. It bounds a flood; it is not a distributed limiter.
    """

    def __init__(self, limit: int = 12, window: float = 600.0, clock=time.monotonic):
        self.limit, self.window, self._clock = limit, window, clock
        self._hits: dict[str, deque] = defaultdict(deque)

    def hit(self, key: str) -> bool:
        """Count one attempt. True if allowed."""
        now = self._clock()
        q = self._hits[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()
