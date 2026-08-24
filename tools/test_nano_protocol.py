#!/usr/bin/env python3
"""The NimrodLink wire format, tested with no board attached.

WHAT THIS IS GUARDING. Two firmwares that cannot be run side by side have to agree about
these bytes, and the failure mode if they do not is not a crash — it is a server quietly
accumulating plausible-looking nonsense for weeks. So the layout and the reassembly logic
are pinned here, and both implementations copy from `nano_protocol.py`.

The interesting half is `Reassembler`. BLE notifications are unacknowledged, so chunks get
dropped; the offset header on every chunk is what turns that from a stalled transfer into
one re-request. **The rule it must never break: never write a byte it did not receive.**
A gap has to stop the run, not be papered over — silently correct-looking data is the worst
outcome for a longitudinal study.

Zero deps. Run:

    py -3.13 test_nano_protocol.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nano_protocol as p  # noqa: E402

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = ""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}   {detail}")


def section(title: str):
    print(f"\n{title}")


class FakeLogger:
    """The Nano's side, in Python: the same cursor/bookmark rules NimrodLink.cpp implements.

    Written so the reassembler is tested against something that behaves like the real
    thing — including the parts that are easy to get wrong, like a ring buffer forgetting
    history and a seek being allowed to go backwards."""

    def __init__(self, data: bytes, chunk: int = 16, capacity: int | None = None):
        self.data = bytearray(data)
        self.chunk = chunk
        self.capacity = capacity            # None = keeps everything
        self.cursor = 0
        self.confirmed = 0
        self.sending = False

    @property
    def total(self) -> int:
        return len(self.data)

    @property
    def oldest(self) -> int:
        if self.capacity is None:
            return 0
        return max(0, self.total - self.capacity)

    def status(self) -> bytes:
        return p.build_status(self.total, self.confirmed, self.chunk,
                              cursor=self.cursor, oldest=self.oldest)

    def control(self, raw: bytes) -> None:
        op, arg = p.parse_command(raw)
        if op == p.OP_SEEK:
            self.cursor = arg
            self.sending = True
        elif op == p.OP_ACK:
            self.confirmed = max(self.confirmed, arg)
        elif op == p.OP_STOP:
            self.sending = False

    def next_chunk(self) -> bytes | None:
        if not self.sending or self.cursor >= self.total:
            return None
        if self.cursor < self.oldest:
            self.cursor = self.oldest          # history is gone; skip forward, visibly
        payload = bytes(self.data[self.cursor:self.cursor + self.chunk])
        out = p.frame(self.cursor, payload)
        self.cursor += len(payload)
        return out


def pull(logger: FakeLogger, start: int = 0, drop_at: set[int] | None = None,
         max_steps: int = 10000) -> p.Reassembler:
    """A whole transfer, the way a real box has to do it.

    This is not test scaffolding — it is the reference for the box's side, and two of its
    rules were found by this suite failing:

      * WHEN THE STREAM GOES QUIET, COMPARE AGAINST `total`. A dropped final chunk is
        indistinguishable from a completed transfer otherwise.
      * IF A RE-SEEK DOES NOT CLOSE A GAP, THE HISTORY IS GONE. Seek back once; if the
        logger still answers with a higher offset, it cannot go back that far, so record
        the hole and move on instead of seeking into the void forever.
    """
    drop_at = set(drop_at or ())
    r = p.Reassembler(start)
    logger.control(p.command(p.OP_SEEK, start))
    reseeks = 0
    for _ in range(max_steps):
        chunk = logger.next_chunk()
        if chunk is None:
            if r.cursor < logger.total and reseeks < 64:
                reseeks += 1
                logger.control(p.command(p.OP_SEEK, r.cursor))
                continue
            break
        offset, _payload = p.parse_frame(chunk)
        if offset in drop_at:
            drop_at.discard(offset)            # drop it exactly once, then let it through
            continue
        if r.feed(chunk):
            continue
        if r.gap_at is None:
            continue                           # a repeat of bytes already held
        # A hole. Seek back to it once and see whether the logger can still reach it.
        target = r.gap_at
        r.reset_to(target)
        logger.control(p.command(p.OP_SEEK, target))
        nxt = logger.next_chunk()
        if nxt is None:
            continue
        noff, _ = p.parse_frame(nxt)
        if noff > r.cursor:
            r.skip_to(noff)                    # genuinely unrecoverable — record the loss
        r.feed(nxt)
    return r


def main():
    # ---- the structs -------------------------------------------------------
    section("status and commands on the wire")
    raw = p.build_status(total=1234, confirmed=1000, chunk=16, fw=7, oldest=200)
    check("status is 20 bytes, so it still fits one read at the default MTU",
          len(raw) == p.STATUS_LEN and len(raw) <= 22, str(len(raw)))
    s = p.parse_status(raw)
    check("it round-trips", (s.total, s.confirmed, s.chunk, s.fw) == (1234, 1000, 16, 7), repr(s))
    check("...including how far back the logger can still reach", s.oldest == 200, str(s.oldest))
    check("MORE is set when there are bytes past the cursor", s.more)
    check("MORE is clear when caught up", not p.parse_status(p.build_status(50, 50, 16)).more)

    # A version mismatch has to be loud. An old box misreading a new struct would post
    # plausible nonsense for weeks before anyone analysed it.
    bad = bytearray(raw)
    bad[0] = 99
    threw = False
    try:
        p.parse_status(bytes(bad))
    except ValueError:
        threw = True
    check("a protocol mismatch refuses to talk rather than guessing", threw)
    threw = False
    try:
        p.parse_status(raw[:8])
    except ValueError:
        threw = True
    check("a short status is refused, not padded", threw)

    check("a command is 5 bytes", len(p.command(p.OP_SEEK, 900)) == p.CONTROL_LEN)
    check("commands round-trip", p.parse_command(p.command(p.OP_ACK, 4294967295)) == (p.OP_ACK, 4294967295))
    check("a 32-bit offset survives the top bit",
          p.parse_frame(p.frame(0x80000001, b"x"))[0] == 0x80000001)

    # ---- a clean transfer --------------------------------------------------
    section("a clean transfer")
    data = bytes((i * 7 + 3) & 0xFF for i in range(1000))
    lg = FakeLogger(data, chunk=16)
    r = pull(lg)
    check("every byte arrives", bytes(r.buf) == data, f"{len(r.buf)} of {len(data)}")
    check("the cursor ends at the total", r.cursor == len(data), str(r.cursor))
    check("a partial final chunk is handled", len(data) % 16 != 0)

    # ---- dropped notifications --------------------------------------------
    # This is why every chunk carries its offset. Notifications are unacknowledged, so
    # this is the normal case, not an edge case.
    section("dropped notifications")
    lg = FakeLogger(data, chunk=16)
    r = pull(lg, drop_at={160})
    check("one dropped chunk still yields the exact bytes", bytes(r.buf) == data,
          f"{len(r.buf)} of {len(data)}")

    lg = FakeLogger(data, chunk=16)
    r = pull(lg, drop_at={0, 48, 160, 800, 992})
    check("five drops, including the first and last, still exact", bytes(r.buf) == data,
          f"{len(r.buf)} of {len(data)}")

    # THE BUG THIS SUITE FOUND. Losing the LAST chunk looks exactly like a finished
    # transfer: the stream goes quiet either way, and no later offset ever reveals the
    # hole. A box that trusted the silence would lose the tail and never know.
    lg = FakeLogger(data, chunk=16)
    r = pull(lg, drop_at={992})
    check("a dropped FINAL chunk is caught by comparing against total, not by silence",
          bytes(r.buf) == data, f"{len(r.buf)} of {len(data)}")
    check("...and nothing was recorded as lost, because nothing was",
          r.holes == [], str(r.holes))

    # THE RULE THAT MATTERS MOST: never invent a byte.
    r2 = p.Reassembler(0)
    r2.feed(p.frame(0, b"aaaa"))
    ignored = r2.feed(p.frame(100, b"zzzz"))     # a chunk from far ahead
    check("a chunk from beyond the gap is IGNORED, not written", not ignored)
    check("...and the buffer holds only what actually arrived", bytes(r2.buf) == b"aaaa", repr(bytes(r2.buf)))
    check("...and the gap is reported where the hole starts", r2.gap_at == 4, str(r2.gap_at))

    # ---- resuming ----------------------------------------------------------
    section("resuming — the chair rolled away mid-transfer")
    lg = FakeLogger(data, chunk=16)
    lg.control(p.command(p.OP_SEEK, 0))
    part = p.Reassembler(0)
    for _ in range(20):                          # 320 bytes, then the chair leaves
        part.feed(lg.next_chunk())
    got_first = part.received
    check("a partial visit collects something", got_first == 320, str(got_first))

    # Next visit: the box acknowledges what it stored and asks for the rest.
    lg.control(p.command(p.OP_ACK, got_first))
    check("the bookmark advanced", p.parse_status(lg.status()).confirmed == got_first)
    rest = pull(lg, start=got_first)
    check("the second visit collects exactly the remainder",
          bytes(part.buf) + bytes(rest.buf) == data,
          f"{len(part.buf)}+{len(rest.buf)} of {len(data)}")
    check("...and nothing was sent twice", len(part.buf) + len(rest.buf) == len(data))

    # ---- the bookmark is not a delete pointer ------------------------------
    # This is what makes the box disposable: if it dies holding data that never reached a
    # server, a replacement asks for an older offset and nothing is lost.
    section("the bookmark is advisory")
    lg = FakeLogger(data, chunk=16)
    pull(lg)
    lg.control(p.command(p.OP_ACK, len(data)))
    check("everything is acknowledged", p.parse_status(lg.status()).confirmed == len(data))
    again = pull(lg, start=0)
    check("a replacement box can still re-read from zero", bytes(again.buf) == data,
          f"{len(again.buf)} of {len(data)}")
    check("...and acknowledging never moved backwards",
          p.parse_status(lg.status()).confirmed == len(data))

    lg.control(p.command(p.OP_ACK, 10))
    check("a stale, lower ack does not rewind the bookmark",
          p.parse_status(lg.status()).confirmed == len(data),
          str(p.parse_status(lg.status()).confirmed))

    # ---- history that is genuinely gone ------------------------------------
    # A ring buffer that wrapped while the box was away. The box must be able to tell
    # "nothing new" from "I have lost some", because only one of those needs a human.
    section("history the logger no longer has")
    lg = FakeLogger(data, chunk=16, capacity=256)
    check("the logger admits how far back it can go", lg.oldest == len(data) - 256, str(lg.oldest))
    lost_before = lg.oldest
    r = pull(lg, start=0)
    check("asking for lost history yields exactly what survives",
          bytes(r.buf) == data[lost_before:], f"{len(r.buf)} vs 256")
    # A study needs to know its data has a hole far more than it needs a file that looks
    # continuous. So the loss is RECORDED, with its exact extent.
    check("...and the loss is recorded, not silently filled",
          r.holes == [(0, lost_before)], str(r.holes))
    check("...with the right number of bytes missing", r.lost == lost_before, str(r.lost))
    check("the box could have known up front, from status alone",
          p.parse_status(lg.status()).oldest == lost_before)

    # ---- chunk size is read, never assumed ---------------------------------
    # The default ATT MTU leaves 16 payload bytes; ArduinoBLE may or may not negotiate
    # more. Every size has to work, because the number is a bench measurement.
    section("any chunk size")
    for chunk in (1, 4, 16, 20, 100, 243):
        lg = FakeLogger(data, chunk=chunk)
        r = pull(lg)
        check(f"chunk={chunk} transfers exactly", bytes(r.buf) == data,
              f"{len(r.buf)} of {len(data)}")

    # ---- negative control --------------------------------------------------
    # Everything above would also pass against a reassembler that just concatenated
    # payloads and ignored offsets, so prove the offsets are load-bearing.
    section("negative control")
    naive = bytearray()
    lg = FakeLogger(data, chunk=16)
    lg.control(p.command(p.OP_SEEK, 0))
    dropped_one = False
    while True:
        c = lg.next_chunk()
        if c is None:
            break
        off, payload = p.parse_frame(c)
        if off == 160 and not dropped_one:
            dropped_one = True
            continue
        naive += payload                      # concatenate blindly, as a naive box would
    check("a box that ignored offsets would produce WRONG data of the RIGHT-ish length",
          bytes(naive) != data and len(naive) == len(data) - 16,
          f"{len(naive)} vs {len(data)}")
    check("...which is why the offset header exists", True)

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
