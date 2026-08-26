#!/usr/bin/env python3
"""The box, end to end, with no radio and no server.

    py -3.13 test_collector.py

WHAT THIS BUYS. When the Nano arrives, the only untested thing left is the radio itself:
the resume logic, the two pointers, the durability rule, the spool and the upload have all
already been driven here against an in-process logger that can be told to misbehave.

The failures exercised are the ones that actually happen to a box in a living room -
dropped notifications, a chair that leaves mid-transfer, a server that is down, a logger
that wrapped, a full disk, and the power going out between two writes.
"""
from __future__ import annotations

import asyncio
import base64
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from collector import FakeLogger, Settings, Spool, Uploader, pull_once, run   # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t):
    print(f"\n-- {t}")


def payload(n: int) -> bytes:
    return bytes((i * 7 + 11) % 256 for i in range(n))


class Tmp:
    def __enter__(self):
        self.d = tempfile.mkdtemp(prefix="nimrod-spool-")
        return self.d

    def __exit__(self, *a):
        shutil.rmtree(self.d, ignore_errors=True)


def settings(d, **kw):
    s = Settings()
    s.spool_dir = d
    s.device_name = "test"
    s.idle_seconds = s.busy_seconds = 0.001
    for k, v in kw.items():
        setattr(s, k, v)
    return s


class FakeServer:
    """Records what was POSTed and can be told to fail in the two different ways."""

    def __init__(self, code=200):
        self.code = code
        self.posts = []

    def __call__(self, url, body, headers):
        self.posts.append({"url": url, "body": body, "headers": headers})
        return self.code

    def bytes_received(self) -> bytes:
        out = bytearray()
        for post in sorted(self.posts, key=lambda x: x["body"]["data"]["offset"]):
            out += base64.b64decode(post["body"]["data"]["bytes"])
        return bytes(out)


# ============================================================ the happy path
section("a clean visit")

with Tmp() as d:
    data = payload(4096)
    logger = FakeLogger(data, chunk=64)
    s = settings(d)
    spool = Spool(d, "test")
    res = asyncio.run(pull_once(logger, spool, s))
    check("everything was collected", res.got == 4096, f"{res.got}")
    check("and it is byte-for-byte what the logger held",
          spool.read(0, 4096) == data)
    check("the transfer is reported complete", res.complete)
    check("the logger was told it may forget, up to exactly what we hold",
          logger.confirmed == 4096, f"{logger.confirmed}")
    # THE RULE THIS WHOLE DESIGN TURNS ON.
    check("but NOTHING is marked uploaded - ack is not delivery",
          spool.state["uploaded"] == 0, f"{spool.state['uploaded']}")
    check("so the backlog is visible", spool.pending_upload == 4096)

# ============================================================ dropped notifications
section("dropped notifications - routine, and must not cost data")

with Tmp() as d:
    data = payload(4096)
    logger = FakeLogger(data, chunk=64, drop_every=3)      # one in three vanishes
    spool = Spool(d, "test")
    res = asyncio.run(pull_once(logger, spool, settings(d)))
    check("a lossy radio still delivers every byte", spool.read(0, 4096) == data,
          f"got {res.got}")
    check("and nothing is recorded as lost, because nothing WAS lost", res.holes == [])
    check("the ack still matches what is held", logger.confirmed == 4096)

with Tmp() as d:
    # ORDINARY INTERFERENCE: specific chunks fail once, then get through on the retry.
    # This is what a real radio does, and what resume exists for.
    data = payload(2048)
    logger = FakeLogger(data, chunk=32, drop_once={0, 64, 128, 512, 1024, 2016})
    spool = Spool(d, "test")
    res = asyncio.run(pull_once(logger, spool, settings(d)))
    check("chunks that fail once and succeed on retry cost nothing",
          spool.read(0, 2048) == data, f"got {res.got}")
    check("and it is not reported as stalled", not res.stalled)

with Tmp() as d:
    # THE PATHOLOGICAL CASE: a link that drops the SAME chunk on every attempt. The bytes
    # can never arrive. What matters is that the box says so instead of quietly returning
    # a fraction - which is exactly what it did before this assertion existed.
    data = payload(2048)
    logger = FakeLogger(data, chunk=32, drop_every=2)
    spool = Spool(d, "test")
    res = asyncio.run(pull_once(logger, spool, settings(d)))
    check("an unrecoverable link gives up rather than hanging", res.complete is False)
    check("and SAYS it is stuck rather than reporting a quiet success", res.stalled)
    check("the note names where it got to", "stopped making progress" in res.note, res.note)
    # The bytes it did get are still correct and still acknowledged - a bad link costs
    # throughput, never integrity.
    check("what it DID collect is byte-correct", spool.read(0, spool.size) == data[:spool.size])
    check("and the logger was only released up to what is really held",
          logger.confirmed == spool.end_offset, f"{logger.confirmed} vs {spool.end_offset}")

# ============================================================ resume
section("resume - the chair left, and came back")

with Tmp() as d:
    data = payload(4096)
    logger = FakeLogger(data, chunk=64)
    s = settings(d)

    # The chair rolls away after a couple of hundred bytes.
    logger.data = data[:256]
    spool = Spool(d, "test")
    asyncio.run(pull_once(logger, spool, s))
    check("a partial visit keeps what it got", spool.size == 256, f"{spool.size}")
    first_ack = logger.confirmed

    # It comes back later, and by then the logger has more.
    logger.data = data
    logger.cursor = 0
    asyncio.run(pull_once(logger, spool, s))
    check("the next visit RESUMES rather than starting over",
          spool.size == 4096, f"{spool.size}")
    check("and the bytes join up correctly across the two visits",
          spool.read(0, 4096) == data)
    check("the ack advanced", logger.confirmed > first_ack)

with Tmp() as d:
    # A BOX THAT DIED AND WAS REPLACED. Empty disk, but the server confirmed 1024 bytes.
    data = payload(4096)
    spool = Spool(d, "test")
    spool.state["uploaded"] = 1024
    spool.state["base"] = 1024
    spool._write_state()
    logger = FakeLogger(data, chunk=64)
    asyncio.run(pull_once(logger, spool, settings(d)))
    check("a REPLACEMENT box asks from what the server confirmed, not from zero",
          spool.size == 4096 - 1024, f"{spool.size}")
    check("and gets the right bytes", spool.read(1024, 3072) == data[1024:])

# ============================================================ the logger wrapped
section("the logger wrapped while we were away")

with Tmp() as d:
    data = payload(4096)
    # It can no longer produce anything before 2048.
    logger = FakeLogger(data, chunk=64, oldest=2048)
    spool = Spool(d, "test")
    res = asyncio.run(pull_once(logger, spool, settings(d)))
    check("the loss is RECORDED, not hidden", res.holes == [(0, 2048)], f"{res.holes}")
    check("it is persisted, so it survives a restart",
          spool.state["holes"] == [[0, 2048]], f"{spool.state['holes']}")
    check("and what remains is still collected", spool.size == 2048, f"{spool.size}")
    check("with the right bytes", spool.read(2048, 2048) == data[2048:])
    check("the note says so in words a person can read", "wrapped" in res.note, res.note)

# ============================================================ the disk is full
section("a full disk is a delay, never a hole")

with Tmp() as d:
    data = payload(4096)
    logger = FakeLogger(data, chunk=64)
    spool = Spool(d, "test")
    asyncio.run(pull_once(logger, spool, settings(d)))
    before = logger.confirmed

    logger.data = data + payload(4096)
    res = asyncio.run(pull_once(logger, spool, settings(d, max_spool_bytes=1024)))
    check("past the cap, nothing more is taken", res.got == 0)
    # THE POINT: refusing to acknowledge means the logger keeps its copy.
    check("and CRUCIALLY the ack does not advance", logger.confirmed == before)
    check("the reason is stated", "full" in res.note, res.note)

# ============================================================ upload
section("upload - its own pointer, its own schedule")

with Tmp() as d:
    data = payload(4096)
    logger = FakeLogger(data, chunk=64)
    server = FakeServer()
    s = settings(d, server="https://example.test", device_key="K", upload_bytes=1024)
    spool = Spool(d, "test")
    asyncio.run(pull_once(logger, spool, s))

    up = Uploader(s, post=server)
    sent = 0
    while spool.pending_upload > 0 and sent < 10:
        ok, _ = up.send_next(spool)
        sent += 1
        if not ok:
            break
    check("the whole spool reached the server", spool.pending_upload == 0)
    check("in bounded pieces", len(server.posts) == 4, f"{len(server.posts)}")
    check("and the server can reassemble the original bytes exactly",
          server.bytes_received() == data)
    check("each piece says where it belongs",
          [p["body"]["data"]["offset"] for p in server.posts] == [0, 1024, 2048, 3072])
    check("the device key travels as a header, not in the URL",
          server.posts[0]["headers"]["X-Device-Key"] == "K"
          and "K" not in server.posts[0]["url"])
    check("the payload is declared as base64 rather than guessed at",
          server.posts[0]["body"]["data"]["encoding"] == "base64")
    check("and the server is never asked to understand the contents",
          set(server.posts[0]["body"]["data"]) == {"device", "offset", "length", "encoding", "bytes"})

with Tmp() as d:
    # AN OUTAGE AND A REJECTION ARE DIFFERENT PROBLEMS.
    s = settings(d, server="https://example.test", device_key="K")
    spool = Spool(d, "test")
    spool.append(payload(64))
    down = Uploader(s, post=FakeServer(code=503))
    ok, why = down.send_next(spool)
    check("a server that is down does not advance the pointer",
          not ok and spool.state["uploaded"] == 0)
    check("and it backs off rather than hammering", down.backoff > 0)
    check("the message says it will retry", "retry" in why, why)

    refused = Uploader(s, post=FakeServer(code=400))
    ok, why = refused.send_next(spool)
    check("a REJECTED payload is not retried blindly", not ok and "not retry" in why, why)
    check("and still nothing is marked uploaded", spool.state["uploaded"] == 0)

with Tmp() as d:
    s = settings(d)                      # no server at all
    spool = Spool(d, "test")
    spool.append(payload(64))
    ok, why = Uploader(s, post=FakeServer()).send_next(spool)
    check("with no server configured it spools happily and says so",
          not ok and "spooling only" in why, why)
    check("and the bytes are still safe on disk", spool.size == 64)

# ============================================================ durability
section("the power went out")

with Tmp() as d:
    data = payload(2048)
    logger = FakeLogger(data, chunk=64)
    s = settings(d)
    spool = Spool(d, "test")
    asyncio.run(pull_once(logger, spool, s))
    spool.mark_uploaded(1024)

    # A brand new process, same disk. Nothing is carried over in memory.
    again = Spool(d, "test")
    check("the acked pointer survived", again.state["acked"] == 2048)
    check("the uploaded pointer survived", again.state["uploaded"] == 1024)
    check("the bytes survived", again.read(0, 2048) == data)
    check("and the remaining backlog is correct", again.pending_upload == 1024)

with Tmp() as d:
    spool = Spool(d, "test")
    spool.state_path.write_text("{ this is not json", encoding="utf-8")
    fresh = Spool(d, "test")
    check("a corrupt state file falls back to zeroes rather than refusing to start",
          fresh.state["acked"] == 0 and fresh.state["uploaded"] == 0)

# ============================================================ the whole program
section("the loop, as the program actually runs")

with Tmp() as d:
    data = payload(8192)
    logger = FakeLogger(data, chunk=64)
    server = FakeServer()
    s = settings(d, server="https://example.test", device_key="K", upload_bytes=4096)
    stats = asyncio.run(run(s, link_factory=lambda: logger, rounds=1,
                            log=lambda *_: None, post=server))
    check("one pass collects everything", stats["bytes"] == 8192, json.dumps(stats))
    check("and uploads it in the same pass", stats["pending_upload"] == 0, json.dumps(stats))
    # NOT `server_ok := True`, which is what this line said first and which cannot fail.
    # A green assertion that cannot go red is a claim of coverage, not coverage.
    check("and what the server holds is byte-identical to what the logger had",
          server.bytes_received() == data, f"{len(server.bytes_received())} bytes")

with Tmp() as d:
    # The chair is not there. A box must survive that forever without complaint.
    s = settings(d)
    stats = asyncio.run(run(s, link_factory=lambda: None, rounds=3, log=lambda *_: None))
    check("a chair that never appears is not an error", stats["misses"] == 3)
    check("and nothing was invented", stats["bytes"] == 0)

with Tmp() as d:
    # A logger that throws mid-visit must not take the box down.
    class Broken:
        async def read_status(self):
            raise RuntimeError("radio fell over")

    s = settings(d)
    stats = asyncio.run(run(s, link_factory=lambda: Broken(), rounds=2, log=lambda *_: None))
    check("a logger that fails mid-visit does not crash the box", stats["pulls"] == 0)

with Tmp() as d:
    # AND THE ONE THAT MATTERS MOST: the network is down for the whole visit.
    data = payload(4096)
    logger = FakeLogger(data, chunk=64)
    s = settings(d, server="https://example.test", device_key="K")
    stats = asyncio.run(run(s, link_factory=lambda: logger, rounds=1,
                            log=lambda *_: None))
    # The fake uploader is not injected here, so the real one runs and cannot reach
    # example.test - which is precisely the outage being simulated.
    check("THE HANDOFF STILL HAPPENED during a total outage", stats["bytes"] == 4096)
    check("the logger was still released", logger.confirmed == 4096)
    check("and the backlog is waiting, not lost", stats["pending_upload"] == 4096)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
