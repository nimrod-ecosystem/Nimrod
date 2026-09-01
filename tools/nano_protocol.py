#!/usr/bin/env python3
"""The NimrodLink wire format — the authoritative description of it.

WHY THIS IS PYTHON AND NOT A COMMENT IN THE FIRMWARE. Two independent implementations have
to agree about these bytes: a Nano built by the Arduino toolchain and an ESP32 built by
another one, neither of which can be run on the machine the protocol was designed on. A
packed struct shared between them would be a promise the compilers make to themselves. So
the layout is written out by hand on both sides, and THIS FILE IS THE THING THEY ARE BOTH
COPYING FROM — plus a test suite that runs anywhere, with no board attached.

It is also not academic: `nano_probe.py` imports it to talk to a real Nano over BLE, which
means the reference implementation is the same code that gets exercised against hardware.

THE PROTOCOL, in one paragraph. The logger advertises a service with three
characteristics. STATUS (read) says how many bytes exist, how far the box has confirmed,
and how big a chunk is. CONTROL (write) takes {op, arg}: seek to an offset, acknowledge an
offset, or stop. DATA (notify) streams chunks, and EVERY CHUNK CARRIES ITS OWN OFFSET —
which is what makes a dropped notification cost one re-request instead of the transfer.

TWO DESIGN POINTS THAT LOOK LIKE DETAIL AND ARE NOT:

  * THE ACKNOWLEDGED OFFSET IS A BOOKMARK, NOT A DELETE POINTER. A box may seek backwards
    to anything the logger still holds. That is what makes the box disposable: if it dies
    holding data that never reached a server, a replacement asks for an older offset.

  * ACK MEANS "I HAVE IT SOMEWHERE DURABLE", NOT "THE SERVER HAS IT". The box writes to its
    own card and acknowledges immediately, so a chair can hand off and leave DURING a
    network outage instead of waiting for one to end. The box keeps its own separate
    pointer for what actually reached the server.

  * COMPLETION IS DECIDED BY COMPARING AGAINST `total`, NEVER BY THE NOTIFICATIONS
    STOPPING. A dropped FINAL chunk looks exactly like a finished transfer — the stream
    goes quiet either way, and there is no later chunk whose offset would reveal the hole.
    A box that trusted the silence would lose the tail of every transfer it was unlucky
    with, and would never know. This one cost a test failure to find.
"""
from __future__ import annotations

import struct

PROTO = 1

SERVICE_UUID = "4e696d72-6f64-4c69-6e6b-000000000001"
STATUS_UUID  = "4e696d72-6f64-4c69-6e6b-000000000002"
CONTROL_UUID = "4e696d72-6f64-4c69-6e6b-000000000003"
DATA_UUID    = "4e696d72-6f64-4c69-6e6b-000000000004"

OP_SEEK = 0x01
OP_ACK  = 0x02
OP_STOP = 0x03
OP_PING = 0x04

FLAG_MORE = 0x01

STATUS_LEN = 20
CONTROL_LEN = 5
HEADER_LEN = 4          # the uint32 offset on the front of every data chunk


class Status:
    """What the logger says about itself. 20 bytes, little-endian, one ATT read.

    `oldest` is the earliest offset the logger can still produce. It exists so a box can
    learn IMMEDIATELY that some history is unrecoverable — a ring buffer wrapped while it
    was away — instead of discovering it by asking for bytes and getting a silent jump.
    Twenty bytes still fits a single read at the default 23-byte MTU."""

    __slots__ = ("proto", "flags", "chunk", "total", "oldest", "confirmed", "fw")

    def __init__(self, proto, flags, chunk, total, oldest, confirmed, fw):
        self.proto, self.flags, self.chunk = proto, flags, chunk
        self.total, self.oldest, self.confirmed, self.fw = total, oldest, confirmed, fw

    @property
    def more(self) -> bool:
        return bool(self.flags & FLAG_MORE)

    def __repr__(self):
        return (f"Status(proto={self.proto}, chunk={self.chunk}, total={self.total}, "
                f"oldest={self.oldest}, confirmed={self.confirmed}, fw={self.fw}, "
                f"more={self.more})")


def parse_status(raw: bytes) -> Status:
    if len(raw) < STATUS_LEN:
        raise ValueError(f"status is {len(raw)} bytes, expected {STATUS_LEN}")
    proto, flags, chunk, total, oldest, confirmed, fw = struct.unpack_from("<BBHIIII", raw, 0)
    if proto != PROTO:
        # Loudly, not quietly. An old box misreading a new struct would post plausible
        # nonsense to a server for weeks, and nobody would notice until somebody analyzed
        # it. Better to refuse to talk.
        raise ValueError(f"protocol {proto}, this tool speaks {PROTO}")
    return Status(proto, flags, chunk, total, oldest, confirmed, fw)


def build_status(total: int, confirmed: int, chunk: int, fw: int = 1,
                 cursor: int | None = None, oldest: int = 0) -> bytes:
    """The logger's side. Here so the test can round-trip without a board."""
    flags = FLAG_MORE if (cursor if cursor is not None else confirmed) < total else 0
    return struct.pack("<BBHIIII", PROTO, flags, chunk, total, oldest, confirmed, fw)


def command(op: int, arg: int = 0) -> bytes:
    return struct.pack("<BI", op, arg)


def parse_command(raw: bytes) -> tuple[int, int]:
    if len(raw) < CONTROL_LEN:
        raise ValueError(f"command is {len(raw)} bytes, expected {CONTROL_LEN}")
    return struct.unpack_from("<BI", raw, 0)


def frame(offset: int, payload: bytes) -> bytes:
    return struct.pack("<I", offset) + payload


def parse_frame(raw: bytes) -> tuple[int, bytes]:
    if len(raw) < HEADER_LEN:
        raise ValueError(f"chunk is {len(raw)} bytes, too short to carry an offset")
    return struct.unpack_from("<I", raw, 0)[0], raw[HEADER_LEN:]


class Reassembler:
    """Turns a stream of possibly-dropped, possibly-reordered chunks into bytes.

    THIS IS THE PART MOST LIKELY TO BE WRONG, which is why it is here rather than only in
    two firmwares that cannot be run side by side. It is deliberately strict about one
    thing: it never writes a byte it did not receive. A gap stops the run and reports where
    to seek back to, rather than being papered over with zeroes — silently correct-looking
    data is the worst possible failure for a study.
    """

    def __init__(self, start: int = 0):
        self.start = start
        self.cursor = start
        self.buf = bytearray()
        self.gap_at: int | None = None
        # Ranges the logger could not give us — a ring buffer wrapped while the box was
        # away. RECORDED RATHER THAN HIDDEN: a study needs to know its data has a hole in
        # it far more than it needs a file that looks continuous.
        self.holes: list[tuple[int, int]] = []

    def feed(self, chunk: bytes) -> bool:
        """Returns True if the chunk advanced the stream, False if it was ignored."""
        offset, payload = parse_frame(chunk)
        if offset == self.cursor:
            self.buf += payload
            self.cursor += len(payload)
            return True
        if offset < self.cursor:
            # A repeat after a re-seek: the overlap is already held, so take only the tail.
            # Dropping the whole chunk instead would stall forever if the logger always
            # resumes slightly behind where we asked.
            skip = self.cursor - offset
            if skip < len(payload):
                self.buf += payload[skip:]
                self.cursor += len(payload) - skip
                return True
            return False
        # offset > cursor: something was dropped. Record where, and stop trusting the run.
        if self.gap_at is None:
            self.gap_at = self.cursor
        return False

    def skip_to(self, offset: int) -> None:
        """Accept that bytes between here and `offset` are gone, and record the loss.

        Only for when a re-seek has already been TRIED and the logger still cannot go
        back that far. Reaching for this on the first gap would turn a dropped
        notification — routine, recoverable — into permanent data loss."""
        if offset <= self.cursor:
            return
        self.holes.append((self.cursor, offset))
        self.cursor = offset
        self.gap_at = None

    def reset_to(self, offset: int) -> None:
        """After seeking backwards, forget the gap and expect bytes from `offset`."""
        if offset != self.cursor:
            # Only legal backwards; forwards would mean inventing the bytes in between.
            if offset > self.cursor:
                raise ValueError("cannot reset forwards — that would skip unreceived bytes")
            del self.buf[len(self.buf) - (self.cursor - offset):]
            self.cursor = offset
        self.gap_at = None

    @property
    def received(self) -> int:
        return self.cursor - self.start

    @property
    def lost(self) -> int:
        return sum(b - a for a, b in self.holes)
