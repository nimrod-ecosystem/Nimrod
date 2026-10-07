"""storage_line.py - what the state and event routes refuse to keep. Tested alone: test_storage_line.py.

*** THE LINE (Mike, 2026-10-07; DECISIONS.md, "what the server may hold", row 2.58): nothing that is a
person's content or body goes on the server - no pictures, audio, video, recordings, voiceprints, or
health checkboxes. Small text the site needs across devices stays. ***

The state and event routes take any JSON a signed-in client sends, so the line is only as true as the
check in front of them. These are the server's half of it - security invariants, stated firmly on purpose:

  1. RAW SENSOR RECORDINGS ARE REFUSED. Event kind `device-blob` and stream `device-data` are what
     tools/collector.py sends (base64 logger bytes, ~22 KB a row). They belong on the household's own
     machine; the collector keeps them in its own spool when it has nowhere to send them.
  2. A PICTURE, SOUND OR VIDEO INSIDE THE JSON IS REFUSED: any string (value or key) that starts
     `data:image/`, `data:audio/` or `data:video/`, in any case, and any long unbroken run of base64
     (BASE64_RUN_MAX, argued below) - which is what such a thing looks like once it is text.
  3. EVERY ROW HAS A SIZE CAP: STATE_MAX_BYTES for a saved setting, EVENT_MAX_BYTES for an event.
     The cap is the backstop for whatever the two pattern rules cannot see (numbers in a list, say).
  4. PLAY HISTORY IS REFUSED (Mike, 2026-10-07, row 2.58: "This is the kind of data people should keep on
     their own system though"): which photo, video or song played when. Event kind `play` (what every
     player appended to its panel's events: `{id, at}`) and stream `plays` (plays.js's shared stream, never
     written to before this). They are kept on the device that played them now (client/plays.js). A
     panel's stream is named by its instance id, so the kind is the only thing that says "a play".
     The rows already here are removed by remove_play_history.py, which Mike runs.

THE NUMBERS ARE DEFAULTS, ARGUED (Rule 1, 2026-09-11) - measured 2026-10-07, not guessed:

  STATE_MAX_BYTES = 2 MiB. The local dev database's largest state row is 2,069 bytes (input-bindings),
    but that database holds no walkthrough notes, so it understates the real ceiling. The biggest thing the
    client can legitimately write is the person record `nimrod-ai`: up to 200 notes (nimrod_notes.js
    NOTES_MAX) of up to 4,000 characters each plus their context (~4.7 KB a note at the most, ~940 KB),
    plus the walkthrough wrap-ups kept beside them (walkthrough_wrap.js: a 1,500-character summary, a
    6,000-character cleaned copy and 300-character lines, five finished kept). With every list at its
    maximum at once that is about 1.26 MB (test_storage_line.py builds it and checks it passes); a realistic
    record is 100-400 KB (nimrod_notes.js's own estimate is ~100 KB). 2 MiB clears the all-maximums case
    with room to spare. Everything else measured or read is tens of KB at most.
  EVENT_MAX_BYTES = 16 KiB. Events are small facts: the largest legitimate one in the dev database is
    1,422 bytes (a transcript-lessons question set); game trials are under 300, points under 250, a play
    log under 130. 16 KiB is eleven times the largest seen and still refuses a 16 KB logger chunk.
  BASE64_RUN_MAX = 1,024 characters (768 bytes once decoded). The longest unbroken run of base64
    characters in any legitimate dev-database row is 32 (a hex id); OAuth-style tokens run 200-400. The
    smallest useful thumbnail is 1-2 KB (1,400-2,700 characters) and a second of the most compressed speech
    about 750 bytes, so 1,024 sits above every legitimate run and below nearly every real picture or sound.
    Runs that are wrapped over several lines (MIME style, lines of 60+ characters) are measured as one.

Sizes are measured as the client sent them: compact JSON, UTF-8 - so a name in Chinese costs what it
weighs, not the six bytes per character the database's own escaping would charge.
"""
from __future__ import annotations

import json
import re

STATE_MAX_BYTES = 2 * 1024 * 1024
EVENT_MAX_BYTES = 16 * 1024
BASE64_RUN_MAX = 1024

REFUSED_EVENT_KINDS = frozenset({"device-blob"})
REFUSED_EVENT_STREAMS = frozenset({"device-data"})
PLAY_HISTORY_KINDS = frozenset({"play"})
PLAY_HISTORY_STREAMS = frozenset({"plays"})

_MEDIA_PREFIXES = ("data:image/", "data:audio/", "data:video/")
# One run of base64 (standard or URL-safe alphabet), with its padding. A plain character class, so
# finditer is linear in the length of the string - no pattern here can be made to backtrack.
_RUN = re.compile(r"[A-Za-z0-9+/_-]+={0,2}")
# Base64 wrapped over lines (MIME style) is joined up only across lines of WRAP_MIN+ characters, so short
# lines (a list of ids one per line, a poem) are measured one line at a time like everything else.
WRAP_MIN = 60

SAY_KEEP_IT_HOME = "Pictures, sound, video and recordings stay on your own machine, not on this site."
SAY_PLAYS_STAY_HOME = ("What played when (which photo, video or song) is kept on the screen that played it, not on "
                       "this site.")


class Refused(Exception):
    """A write the line refuses. `status` is the HTTP code; `detail` is the sentence a person reads."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def row_bytes(data) -> int:
    """How big a row is, as the client sent it: compact JSON, UTF-8."""
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def longest_base64_run(s: str) -> int:
    """The longest unbroken run of base64 characters in `s` (line-wrapped base64 counted as one run)."""
    best = max((m.end() - m.start() for m in _RUN.finditer(s)), default=0)
    if best > BASE64_RUN_MAX or best < WRAP_MIN or "\n" not in s:
        return best
    chain = 0                                   # a wrapped run that the next line may continue
    for raw in s.splitlines():
        line = raw.strip()
        runs = list(_RUN.finditer(line))
        full = len(runs) == 1 and runs[0].start() == 0 and runs[0].end() == len(line)
        total = chain + len(line) if (chain and full) else 0
        best = max(best, total)
        if full and len(line) >= WRAP_MIN:
            chain = total or len(line)
        elif runs and runs[-1].end() == len(line) and runs[-1].end() - runs[-1].start() >= WRAP_MIN:
            chain = runs[-1].end() - runs[-1].start()   # "...;base64," then the first line of it
        else:
            chain = 0
    return best


def _strings(data):
    """Every string in a JSON value, keys included. Iterative, so a deeply nested body cannot blow the stack."""
    stack = [data]
    while stack:
        v = stack.pop()
        if isinstance(v, str):
            yield v
        elif isinstance(v, dict):
            for k, x in v.items():
                if isinstance(k, str):
                    yield k
                stack.append(x)
        elif isinstance(v, (list, tuple)):
            stack.extend(v)


def check_content(data) -> None:
    """Rule 2: no picture, sound or video inside the JSON, as a data: address or as a long base64 run."""
    for s in _strings(data):
        if s.lstrip()[:11].lower().startswith(_MEDIA_PREFIXES):
            raise Refused(400, "This has a picture, a sound or a video inside it. " + SAY_KEEP_IT_HOME
                          + " Save a link to where it lives instead.")
        run = longest_base64_run(s) if len(s) > BASE64_RUN_MAX else 0
        if run > BASE64_RUN_MAX:
            raise Refused(400, f"This has {run:,} characters of encoded data in a row inside it, which is what a "
                               f"picture, a sound or a recording looks like as text (the most allowed is "
                               f"{BASE64_RUN_MAX:,}). " + SAY_KEEP_IT_HOME)


def _too_big(what: str, size: int, cap: int) -> Refused:
    return Refused(413, f"This {what} is too big to keep here: {size / 1024:,.0f} KB, and the most one can be is "
                        f"{cap / 1024:,.0f} KB. " + SAY_KEEP_IT_HOME)


def check_state(data) -> None:
    """Everything a saved setting (state row) must pass. Raises Refused; returns None when it may be kept."""
    size = row_bytes(data)
    if size > STATE_MAX_BYTES:
        raise _too_big("saved setting", size, STATE_MAX_BYTES)
    check_content(data)


def check_event(stream: str, kind: str, data) -> None:
    """Everything an event must pass. Raises Refused; returns None when it may be kept."""
    if (kind or "").lower() in REFUSED_EVENT_KINDS or (stream or "").lower() in REFUSED_EVENT_STREAMS:
        raise Refused(400, "Raw sensor recordings are not kept on this site. Keep them on the household's own "
                           "machine: point the collector's server setting there, or leave it empty and the "
                           "recordings stay in the collector's own spool.")
    if (kind or "").lower() in PLAY_HISTORY_KINDS or (stream or "").lower() in PLAY_HISTORY_STREAMS:
        raise Refused(400, SAY_PLAYS_STAY_HOME)
    size = row_bytes(data)
    if size > EVENT_MAX_BYTES:
        raise _too_big("event", size, EVENT_MAX_BYTES)
    check_content(data)
