"""play_relay.py - WATCHING ALONG: what a screen is playing, passed to the people following it. Never kept.

Mirroring plan (row 2.79, docs/for_chat/mirroring_plan_20261010.md, "Smallest first step"): a screen plays a YouTube
video and a signed-in page somewhere else plays the SAME video, in step, from its own copy. Nothing is sent but a
tiny message - "this video, at this second, playing" - so the picture stays at full quality, it works on weak
facility wifi, and the screen's computer does not have to encode video. Every device plays its own copy.

WHAT THIS ADDS TO THE DRIVE SOCKET (drive.py parse_message hands these two types here):

  * `play`   - from a SCREEN: {kind, item, pos, playing, rate?, every?, screen?}. Checked field by field and COPIED,
               never relayed as given; capped at MAX_PLAY_BYTES measured on what arrived; rate-limited per socket.
               The server stamps two things on the copy: `at` (its own clock, in ms) and `from` (an id it made up for
               that screen's socket), so a follower can tell two screens apart and nobody can forge either.
  * `follow` - from a DRIVER: {on: true|false}. "This socket is watching along." Presence then counts it as a
               follower, so the screen can say "watching" instead of "helping" (kiosk.js, Mike's consent rule).
               SINCE 2026-10-12 (screen_access.py) only somebody on "who may see this screen" is let in, and by default
               the screen ASKS first: app.py decides, and a socket waiting or refused is HELD here (watch-only, not
               seeing, not counted as helping).

*** THE RULES (these are the security half; everything numeric below is a default, argued) ***

  1. A PLAY MESSAGE GOES FROM A SCREEN TO THAT PERSON'S FOLLOWING DRIVERS, AND NOWHERE ELSE. A driver's `play` is
     dropped; a screen's never reaches another screen. "Screens never talk to screens" (app.py, the drive socket)
     stays exactly as it was - this is the same direction call signals already travel.
  2. NOTHING IS STORED. The relay holds who is following and a rate counter per socket, in memory, and forgets both
     when the socket closes. No database write, no "last thing played" kept for a late joiner: the screen sends
     again the moment somebody starts following, and every few seconds anyway. That clears the storage line
     (storage_line.py rule 4: what played when stays on the device that played it) with room to spare - a play
     message is a record of what somebody is watching, so the server passing it on and keeping nothing is the
     whole point. test_play_relay.py proves no write happens.
  3. AN ITEM IS A PUBLIC ID OR AN OPAQUE ONE, NEVER A NAME. For YouTube that is the 11-character video id, which is
     public already. A file name ("Mom hospital 2024.jpg") can be personal, so a picture (kind `photo`, photos in step,
     2026-10-12) carries an OPAQUE id: 32 lowercase hex characters, the start of a SHA-256 of the picture's path inside
     its source's folder, salted per sharing session by the screen (`salt`, 16 hex, required with a photo id). The
     follow page finds its own copy by hashing its own listing the same way (client/photo_follow.js). Fixed length and
     hex, and NEVER BYTES THAT ARE ALL PRINTABLE TEXT - a short name hex-encoded ("Mom hospital 24" is thirty hex
     characters) has the right shape, and a real hash's sixteen bytes are all printable about once in 8 million, so
     such an id (or salt) is refused. PLAY_KINDS is a closed list, so another kind cannot arrive by accident.
     The salt travels with the id, so this server could in principle guess a name and hash it to compare; rule 2 is
     what stops it learning anything - the id is held in memory for the moment it is passed on, and kept nowhere.
     (client/play_sync.js argues the per-session salt against no salt and a per-person one.)
  4. A SOCKET THAT IS FOLLOWING ONLY WATCHES. app.py drops its verbs, signals and group messages, so the screen's
     "watching along" notice can never hide somebody pressing its buttons. Somebody who wants to do both opens
     the Remote page's buttons as well (a second socket), and the screen then says both.

PURE: no sockets and no I/O. app.py does the sending; test_play_relay.py drives every rule with fake connections and
a fake clock, then once more through the real socket.
"""
from __future__ import annotations

import json
import math
import re
import secrets
import time

PLAY_KINDS = frozenset({"youtube", "photo", "personal"})
# The kinds carried by an opaque, salted id (rule 3). "personal" (2026-10-17, row 2.79): a Personal videos clip, by the
# same kind of id as a picture, so a recorded message's file name never passes through here either.
OPAQUE_KINDS = frozenset({"photo", "personal"})

# A YouTube video id: exactly what youtube.js parseVideoId accepts. Public, not a person's anything.
_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
# photos in step (2026-10-12): a picture's opaque id and the sharing session's salt (rule 3). Mirrors play_sync.js.
PHOTO_ID_HEX = 32
SALT_HEX = 16
_PHOTO_ID = re.compile(r"^[0-9a-f]{32}$")
_SALT = re.compile(r"^[0-9a-f]{16}$")


def hex_is_text(h: str) -> bool:
    """True when every byte the hex spells is printable ASCII (0x20-0x7e): a name dressed as an id. PURE."""
    if not isinstance(h, str) or not h or len(h) % 2:
        return False
    try:
        raw = bytes.fromhex(h)
    except ValueError:
        return False
    return all(0x20 <= b <= 0x7E for b in raw)


def is_photo_id(v) -> bool:
    return isinstance(v, str) and bool(_PHOTO_ID.match(v)) and not hex_is_text(v)


def is_salt(v) -> bool:
    return isinstance(v, str) and bool(_SALT.match(v)) and not hex_is_text(v)


_ITEM_RULES = {"youtube": lambda v: isinstance(v, str) and bool(_YT_ID.match(v)), "photo": is_photo_id,
               "personal": is_photo_id}

# *** THE SIZE CAP: 1 KB, measured on the message AS IT ARRIVED (compact JSON). *** A real one is about 150 bytes
# (measured in the suite: kind, an 11-character id, two numbers, a flag and a 40-character screen name). The cap is
# there so the relay is never a free broadcast pipe that the room fans out to every follower; nothing real is near it.
MAX_PLAY_BYTES = 1024

# The longest a video position can be, in seconds. YouTube videos run to twelve hours; a live stream's position
# can be larger. A week is far past anything real and still refuses nonsense (1e308, a date in ms).
MAX_POS_S = 7 * 24 * 3600

# The speeds a player can be set to. YouTube offers 0.25-2 in steps (its IFrame API getAvailablePlaybackRates).
MIN_RATE, MAX_RATE = 0.25, 2.0

# How often the screen says it is still there, in seconds, as it tells the follower (so the follower can wait
# three heartbeats before deciding the screen went quiet). The screen's own setting offers 2, 5 or 10.
MIN_EVERY_S, MAX_EVERY_S = 1, 60

# The screen's name as the page shows it ("Following Robin's screen (Living room)"). Cut, never refused.
MAX_SCREEN_NAME = 40
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")

# *** THE RATE LIMIT: TWO A SECOND, BURSTS OF TEN, PER SOCKET. *** Argued:
#   * what a real screen sends: one message every 2 s while something plays (the default heartbeat), plus one for
#     each change (start, pause, a seek, the next video). The sender coalesces changes to at most one every 250 ms,
#     so the most a person scrubbing through a video can produce is four a second, for a second or two;
#   * so two a second sustained is four times the heartbeat, and a burst of ten absorbs a scrub without dropping a
#     message that matters. A message dropped here is not lost for long: the next heartbeat carries the same facts;
#   * for a higher limit: none - nothing real comes near it. For a lower one: one a second would drop the second
#     message of an ordinary pause-then-play. Not a person's setting: nobody can judge it from a menu.
# The same shape as game_rooms.py's limit (four a second, bursts of twenty), smaller because this traffic is.
RATE_PER_S = 2.0
RATE_BURST = 10

_ID_LEN = 8          # hex: which screen a message came from, made up here per socket, never the page's


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def parse_play(raw: dict) -> dict | None:
    """Check one `play` message from a screen. Returns a clean COPY, or None to drop it. PURE."""
    if not isinstance(raw, dict):
        return None
    try:
        size = len(json.dumps(raw, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError):
        return None                                  # not JSON-serialisable: not ours to relay
    if size > MAX_PLAY_BYTES:
        return None
    kind = raw.get("kind")
    if kind not in PLAY_KINDS:
        return None
    item = raw.get("item")
    if item is not None and not _ITEM_RULES[kind](item):
        return None                                  # only a public or opaque id, or None for "nothing playing"
    salt = raw.get("salt")
    if kind in OPAQUE_KINDS:
        if (item is not None or salt is not None) and not is_salt(salt):
            return None                              # a photo id is meaningless without its session's salt
    elif salt is not None:
        return None                                  # a salt on anything else is not ours to carry
    pos = raw.get("pos")
    if not _num(pos) or pos < 0 or pos > MAX_POS_S:
        return None
    playing = raw.get("playing")
    if not isinstance(playing, bool):
        return None
    out = {"type": "play", "kind": kind, "item": item, "pos": round(float(pos), 3),
           "playing": playing if item is not None else False}
    if kind in OPAQUE_KINDS and salt is not None:
        out["salt"] = salt
    rate = raw.get("rate", 1)
    if not _num(rate) or rate < MIN_RATE or rate > MAX_RATE:
        return None
    out["rate"] = float(rate)
    every = raw.get("every")
    if every is not None:
        if not _num(every) or every < MIN_EVERY_S or every > MAX_EVERY_S:
            return None
        out["every"] = round(float(every), 1)
    name = raw.get("screen")
    if isinstance(name, str):
        clean = _CONTROL.sub("", name).strip()[:MAX_SCREEN_NAME]
        if clean:
            out["screen"] = clean
    return out


def parse_follow(raw: dict) -> dict | None:
    """`{type: follow, on: bool}` from a driver. Only the flag; anything else is dropped. PURE."""
    if not isinstance(raw, dict) or not isinstance(raw.get("on"), bool):
        return None
    return {"type": "follow", "on": raw["on"]}


class PlayRelay:
    """Who is following, which screen is which, and how fast each socket may send. In memory only.

    `conn` is any object; only its identity is used. app.py hands in the room's driver list when it routes.
    """

    def __init__(self, now=time.monotonic, wall=lambda: time.time() * 1000.0,
                 rate_per_s: float = RATE_PER_S, burst: int = RATE_BURST):
        self._now = now
        self._wall = wall
        self._rate = float(rate_per_s)
        self._burst = float(burst)
        self._following: set[int] = set()
        # WATCH-ONLY BUT NOT (YET) SEEING (2026-10-12, screen_access.py): a driver socket that asked to follow and is
        # waiting for the screen's "yes", or was told no. It does nothing (its messages are dropped, like a
        # follower's), it hears no `play`, and presence does not count it as helping - the screen must never say
        # "someone is helping" about somebody who only asked to watch.
        self._held: set[int] = set()
        self._buckets: dict[int, list] = {}
        self._ids: dict[int, str] = {}

    # ---- the server's clock, for the pong and for `at` ----------------------------------------------
    def server_ms(self) -> int:
        return int(round(self._wall()))

    # ---- following -------------------------------------------------------------------------------------
    def follow(self, conn, on: bool) -> bool:
        """Set or clear "this socket is watching along". Returns True when that changed something."""
        k = id(conn)
        had = k in self._following
        if on:
            self._following.add(k)
            self._held.discard(k)
        else:
            self._following.discard(k)
        return had != bool(on)

    def following(self, conn) -> bool:
        return id(conn) in self._following

    def count(self, conns) -> int:
        return sum(1 for c in conns if id(c) in self._following)

    # ---- asked to watch, not seeing (2026-10-12) ---------------------------------------------------------------
    def hold(self, conn, on: bool) -> None:
        """Mark (or clear) a socket as watch-only while it is not seeing: waiting for a yes, or refused."""
        if on:
            self._held.add(id(conn))
            self._following.discard(id(conn))
        else:
            self._held.discard(id(conn))

    def held(self, conn) -> bool:
        return id(conn) in self._held

    def held_count(self, conns) -> int:
        return sum(1 for c in conns if id(c) in self._held)

    # ---- which screen ----------------------------------------------------------------------------------
    def screen_id(self, conn) -> str:
        k = id(conn)
        sid = self._ids.get(k)
        if sid is None:
            taken = set(self._ids.values())
            while True:
                sid = secrets.token_hex(_ID_LEN // 2)
                if sid not in taken:
                    break
            self._ids[k] = sid
        return sid

    # ---- the rate limit ----------------------------------------------------------------------------------
    def allow(self, conn) -> bool:
        now = self._now()
        b = self._buckets.get(id(conn))
        if b is None:
            b = self._buckets[id(conn)] = [self._burst, now]
        b[0] = min(self._burst, b[0] + (now - b[1]) * self._rate)
        b[1] = now
        if b[0] < 1.0:
            return False
        b[0] -= 1.0
        return True

    # ---- the one decision app.py asks for ----------------------------------------------------------------
    def route(self, role: str, conn, msg: dict, drivers) -> tuple[list, dict | None]:
        """Where a parsed `play` goes: (connections, the stamped copy). ([], None) = nowhere.

        Rule 1: only from a screen, only to that room's drivers who are following. Rate-limited before anything
        else is decided, so a flood costs the relay one counter and nothing more."""
        if role != "screen" or not isinstance(msg, dict) or msg.get("type") != "play":
            return [], None
        if not self.allow(conn):
            return [], None
        targets = [d for d in (drivers or []) if id(d) in self._following and d is not conn]
        if not targets:
            return [], None
        out = dict(msg)
        out["at"] = self.server_ms()
        out["from"] = self.screen_id(conn)
        return targets, out

    def left(self, conn) -> None:
        """A socket closed: everything this held about it goes."""
        k = id(conn)
        self._following.discard(k)
        self._held.discard(k)
        self._buckets.pop(k, None)
        self._ids.pop(k, None)

    def __len__(self) -> int:
        """How many sockets this holds anything about - so a test can see it all goes."""
        return len(self._following | self._held | set(self._buckets) | set(self._ids))
