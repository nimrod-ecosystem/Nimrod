#!/usr/bin/env python3
"""collector.py — THE BOX. The always-plugged-in half of the data-transfer system.

A logger on something that moves — a wheelchair, a walker, anything with a Nano and a
reason to record — cannot reach the internet. A phone can, and for the population this is
built for the phone is the problem rather than the solution: their own published study says
the top barrier was remembering to charge them, and a fifth of participants had no
smartphone or tablet at all. So: a small thing that stays plugged in where the chair parks,
pulls whatever is new whenever the chair is nearby, and sends it on.

WHAT THIS FILE IS AND IS NOT. It is the transport half only. It never parses a record. A
record's meaning belongs to whoever built the logger, and a pipe that insisted on
understanding the payload would be dead on arrival with any manufacturer who already has a
format — and they all already have one.

    logger  --BLE-->  THIS  --HTTPS-->  a server  ------>  whoever is analysing it
                       |
                       +-- a spool file on local disk, which is the whole trick

TWO POINTERS, MOVING INDEPENDENTLY. This is the design, and everything else follows.

    ACKED     how far the LOGGER has been told it may forget. Advanced the moment bytes
              are safely on this box's own disk.
    UPLOADED  how far the SERVER has it. Advanced only after a 2xx.

ACK MEANS "I HAVE IT SOMEWHERE DURABLE", NOT "THE SERVER HAS IT". If the two were one
pointer, a chair could only hand off its data while the internet was up — so an outage at
the house would mean a logger filling and eventually overwriting, with nobody present to
notice. Separating them means the handoff happens on BLE alone, and the upload catches up
whenever it can, hours or days later.

AND THE ACK IS A BOOKMARK, NOT A DELETE POINTER. The logger keeps whatever it can hold. A
box that dies with un-uploaded bytes is replaced by one that seeks BACKWARDS to the last
offset the server confirmed. That single rule is what makes this box disposable, which is
what makes it affordable to deploy.

WHY THE SPOOL IS APPEND-ONLY BYTES AND NOT A DATABASE. Whatever is on that disk has to
survive the power being pulled out of the wall mid-write, because that is how these things
end. An append-only file plus a small state file that is written atomically is about the
most robust thing available; a half-written record at the tail is detectable and re-fetched,
because the offset it belongs at is known.

TRANSPORT IS INJECTED. `--fake` runs the whole program against an in-process logger, so the
pull loop, the resume logic, the spool and the upload are all exercised with no hardware and
no radio. When the Nano arrives, the only new thing being tested is the radio.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import sys
import tempfile
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nano_protocol as p        # noqa: E402


# --------------------------------------------------------------------------- settings
#
# EVERY KNOB IS HERE, WITH ITS DEFAULT, and every one is overridable from a JSON config
# file or a flag. Defaults are chosen for the case this is actually for — a box in
# somebody's living room that nobody will ever log in to — rather than for a demo.

@dataclass
class Settings:
    # WHO
    device_name: str = "wheeltrak"     # BLE name prefix to look for
    device_address: str = ""           # exact address; wins over name when set

    # WHERE THINGS LAND
    spool_dir: str = "./nimrod-spool"

    # HOW OFTEN
    scan_seconds: float = 8.0          # how long each scan listens
    idle_seconds: float = 60.0         # between scans when the chair is away
    busy_seconds: float = 5.0          # between scans just after a successful pull
    # A parked chair is nearby for hours, so scanning hard buys nothing and costs power;
    # a chair that just appeared is likely still there, so try again soon.

    # UPLOAD
    server: str = ""                   # e.g. https://nimrod.onrender.com  ("" = spool only)
    device_key: str = ""               # the account's device secret
    person_id: str = ""                # whose stream this is; "" -> the account stream
    stream: str = "device-data"
    upload_bytes: int = 16384          # bytes per POST
    upload_seconds: float = 30.0       # between upload attempts when there is a backlog
    max_backoff_seconds: float = 900.0 # a server that is down must not be hammered

    # SAFETY RAILS
    max_spool_bytes: int = 512 * 1024 * 1024
    # A disk that fills silently is how a box stops working without anybody knowing. At the
    # cap the collector STOPS ACKNOWLEDGING rather than dropping data: the logger keeps its
    # own copy, the backlog becomes visible, and nothing is lost.

    @classmethod
    def load(cls, path: str | None) -> "Settings":
        s = cls()
        if path and Path(path).exists():
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
            for k, v in raw.items():
                if hasattr(s, k):
                    setattr(s, k, v)
                else:
                    print(f"warning: unknown setting {k!r} ignored", file=sys.stderr)
        return s


# --------------------------------------------------------------------------- the spool

class Spool:
    """Bytes on local disk, plus the two pointers. Deliberately dull.

    The state file is written to a temp file and renamed, because rename is the closest
    thing a filesystem offers to an atomic write. A power cut therefore leaves either the
    old state or the new one, never a half-parsed one — and stale-but-valid state costs a
    re-fetch of a few bytes, which is nothing.
    """

    def __init__(self, directory: str, device: str):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in device) or "device"
        self.data_path = self.dir / f"{safe}.bin"
        self.state_path = self.dir / f"{safe}.json"
        self.state = self._read_state()

    def _read_state(self) -> dict:
        try:
            st = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            st = {}
        st.setdefault("acked", 0)        # how far the LOGGER may forget
        st.setdefault("uploaded", 0)     # how far the SERVER has it
        st.setdefault("base", 0)         # the logger offset byte 0 of the file corresponds to
        st.setdefault("holes", [])       # ranges the logger could not give back
        return st

    def _write_state(self) -> None:
        fd, tmp = tempfile.mkstemp(dir=str(self.dir))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self.state, fh)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, self.state_path)
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise

    @property
    def size(self) -> int:
        return self.data_path.stat().st_size if self.data_path.exists() else 0

    @property
    def end_offset(self) -> int:
        """The logger offset just past everything held here."""
        return self.state["base"] + self.size

    def append(self, payload: bytes) -> int:
        """Write bytes and make them durable BEFORE anybody is told they are safe.

        The fsync is the entire reason an ACK is honest. Without it, "I have it" means "the
        OS has it in a buffer", and a power cut turns that into a lie that cannot be
        detected afterwards.
        """
        with open(self.data_path, "ab") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        return self.end_offset

    def read(self, offset: int, length: int) -> bytes:
        start = offset - self.state["base"]
        if start < 0:
            return b""
        with open(self.data_path, "rb") as fh:
            fh.seek(start)
            return fh.read(length)

    def mark_acked(self, offset: int) -> None:
        if offset > self.state["acked"]:
            self.state["acked"] = offset
            self._write_state()

    def mark_uploaded(self, offset: int) -> None:
        if offset > self.state["uploaded"]:
            self.state["uploaded"] = offset
            self._write_state()

    def record_holes(self, holes) -> None:
        if not holes:
            return
        self.state["holes"].extend([list(h) for h in holes])
        self._write_state()

    @property
    def pending_upload(self) -> int:
        return max(0, self.end_offset - self.state["uploaded"])


# --------------------------------------------------------------------------- transports

class FakeLogger:
    """An in-process logger. The whole point: this program is testable with no radio.

    It can be told to drop notifications and to refuse to seek back beyond `oldest`, which
    are the two failures that actually happen and the two the resume logic exists for.
    """

    def __init__(self, data: bytes, chunk: int = 64, drop_every: int = 0, oldest: int = 0,
                 drop_once: set | None = None):
        self.data = data
        self.chunk = chunk
        # TWO WAYS TO LOSE A CHUNK, and they are not the same failure.
        #   drop_every  every Nth TRANSMISSION vanishes. With a lockstep retry this can
        #               resonate: the same chunk lands in the drop slot every time and can
        #               never get through. That is a real (if unlucky) radio, and the
        #               collector must give up LOUDLY rather than quietly return a
        #               fraction of the data.
        #   drop_once   these OFFSETS fail once and then succeed - which is what ordinary
        #               interference actually looks like, and what resume is for.
        self.drop_every = drop_every
        self.drop_once = set(drop_once or ())
        self.oldest = oldest
        self.confirmed = 0
        self.cursor = 0
        self.sent = 0
        self.stopped = False

    async def read_status(self) -> p.Status:
        return p.parse_status(p.build_status(
            total=len(self.data), confirmed=self.confirmed, chunk=self.chunk,
            cursor=self.cursor, oldest=self.oldest))

    async def write_command(self, op: int, arg: int = 0) -> None:
        if op == p.OP_SEEK:
            self.cursor = max(arg, self.oldest)
        elif op == p.OP_ACK:
            self.confirmed = max(self.confirmed, arg)
        elif op == p.OP_STOP:
            self.stopped = True

    async def stream(self, on_chunk):
        while self.cursor < len(self.data) and not self.stopped:
            payload = self.data[self.cursor:self.cursor + self.chunk]
            offset = self.cursor
            self.cursor += len(payload)
            self.sent += 1
            if offset in self.drop_once:
                self.drop_once.discard(offset)
                continue                       # interference: it works on the retry
            if self.drop_every and self.sent % self.drop_every == 0:
                continue                       # a dropped notification, silently
            await on_chunk(p.frame(offset, payload))


class BleLink:
    """The real one. Needs `pip install bleak`; imported lazily so the fake path never does."""

    def __init__(self, address: str):
        self.address = address
        self._client = None
        self._queue: asyncio.Queue = asyncio.Queue()

    async def __aenter__(self):
        from bleak import BleakClient
        self._client = BleakClient(self.address)
        await self._client.__aenter__()
        await self._client.start_notify(p.DATA_UUID, lambda _h, d: self._queue.put_nowait(bytes(d)))
        return self

    async def __aexit__(self, *exc):
        try:
            await self._client.stop_notify(p.DATA_UUID)
        except Exception:
            pass
        await self._client.__aexit__(*exc)

    async def read_status(self) -> p.Status:
        return p.parse_status(await self._client.read_gatt_char(p.STATUS_UUID))

    async def write_command(self, op: int, arg: int = 0) -> None:
        await self._client.write_gatt_char(p.CONTROL_UUID, p.command(op, arg), response=False)

    async def stream(self, on_chunk, quiet_for: float = 2.0):
        """Feed chunks until the radio goes quiet. Quiet does NOT mean finished — see the
        note in nano_protocol about why completion is decided against `total`."""
        while True:
            try:
                chunk = await asyncio.wait_for(self._queue.get(), timeout=quiet_for)
            except asyncio.TimeoutError:
                return
            await on_chunk(chunk)


# --------------------------------------------------------------------------- the pull

@dataclass
class PullResult:
    got: int = 0
    acked_to: int = 0
    complete: bool = False
    stalled: bool = False
    holes: list = field(default_factory=list)
    note: str = ""


async def pull_once(link, spool: Spool, settings: Settings, *,
                    max_stalls: int = 4, hard_cap: int = 4000) -> PullResult:
    """One visit to the logger: resume, collect, make durable, acknowledge.

    RESUME IS FROM WHAT THE SERVER HAS, NOT FROM WHAT THIS BOX HAS. A replacement box with
    an empty disk asks for everything since the last confirmed upload, which is exactly the
    case the bookmark rule was written for.
    """
    result = PullResult()
    status = await link.read_status()

    want = max(spool.end_offset, spool.state["uploaded"])
    if want < status.oldest:
        # The logger wrapped while we were away. Record the loss rather than hide it: a
        # study needs to know its data has a hole far more than it needs a tidy file.
        spool.record_holes([(want, status.oldest)])
        result.holes.append((want, status.oldest))
        result.note = "logger wrapped; some history is gone"
        want = status.oldest
        spool.state["base"] = want
        spool._write_state()

    if want >= status.total:
        result.complete = True
        result.acked_to = spool.state["acked"]
        return result

    if spool.size >= settings.max_spool_bytes:
        # STOP ACKNOWLEDGING rather than drop data. The logger keeps its copy, the backlog
        # becomes visible, and a full disk is a delay instead of a silent hole.
        result.note = "spool is full; not acknowledging"
        return result

    r = p.Reassembler(start=want)
    await link.write_command(p.OP_SEEK, want)

    async def on_chunk(raw: bytes):
        r.feed(raw)

    # KEEP GOING WHILE PROGRESS IS BEING MADE, rather than for a fixed number of rounds.
    #
    # A fixed budget was the first version and it was wrong in the way that matters: on a
    # lossy link every round recovers only as far as the NEXT dropped notification, so a
    # transfer with more drops than rounds silently ended early - it collected 1152 of 4096
    # bytes and reported no error, because the reassembler had no gap at that instant. The
    # budget has to be about being STUCK, not about how many attempts a good link needs.
    #
    # `hard_cap` is only a runaway guard for a logger that answers but never advances.
    stalls = 0
    spins = 0
    while stalls < max_stalls and spins < hard_cap:
        spins += 1
        before = r.cursor
        await link.stream(on_chunk)
        if r.gap_at is not None:
            # A dropped notification is routine. Ask again from the hole rather than
            # accepting the loss - skip_to is only for when the logger truly cannot.
            await link.write_command(p.OP_SEEK, r.gap_at)
            r.reset_to(r.gap_at)
            stalls = 0 if r.cursor > before else stalls + 1
            continue
        if r.cursor >= status.total:
            break
        status = await link.read_status()
        if r.cursor >= status.total:
            break
        if r.cursor < status.oldest:
            r.skip_to(status.oldest)
            await link.write_command(p.OP_SEEK, status.oldest)
            stalls = 0
            continue
        await link.write_command(p.OP_SEEK, r.cursor)
        stalls = 0 if r.cursor > before else stalls + 1

    if r.buf:
        spool.append(bytes(r.buf))
        # ONLY NOW. The bytes are fsynced to this box's disk, so telling the logger it may
        # forget them is a statement about durable storage rather than about a buffer.
        await link.write_command(p.OP_ACK, r.cursor)
        spool.mark_acked(r.cursor)

    # STUCK IS NOT THE SAME AS FINISHED, and saying nothing is how a box quietly collects
    # a fraction of a study for a month. If the loop stopped making progress while the
    # logger still had more, say so - the bytes we do have are correct and acknowledged,
    # but somebody needs to know the link is not working.
    if stalls >= max_stalls and r.cursor < status.total:
        result.stalled = True
        result.note = (f"stopped making progress at {r.cursor} of {status.total} "
                       f"- the link is dropping the same chunk repeatedly")

    spool.record_holes(r.holes)
    result.got = len(r.buf)
    result.acked_to = spool.state["acked"]
    result.complete = r.cursor >= status.total
    result.holes.extend(r.holes)
    return result


# --------------------------------------------------------------------------- the upload

class Uploader:
    """Spool -> server, on its own schedule, with its own pointer.

    Bytes go up base64 in an ordinary event, because the catching end already exists: the
    append-only event stream plus device-key auth. No new endpoint, no new auth story, and
    the server stores an opaque blob with a timestamp and a device id exactly as designed.
    """

    def __init__(self, settings: Settings, post=None):
        self.s = settings
        self.backoff = 0.0
        self._post = post or self._http_post

    def _url(self) -> str:
        base = self.s.server.rstrip("/")
        if self.s.person_id:
            return f"{base}/api/people/{self.s.person_id}/events/{self.s.stream}"
        return f"{base}/api/user-events/{self.s.stream}"

    def _http_post(self, url: str, body: dict, headers: dict) -> int:
        import urllib.error
        import urllib.request
        req = urllib.request.Request(
            url, data=json.dumps(body).encode("utf-8"), method="POST",
            headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status
        except urllib.error.HTTPError as e:
            return e.code
        except Exception:
            return 0        # unreachable: a network problem, not a rejection

    def send_next(self, spool: Spool) -> tuple[bool, str]:
        if not self.s.server:
            return False, "no server configured (spooling only)"
        if spool.pending_upload <= 0:
            return False, "nothing to send"
        offset = spool.state["uploaded"]
        payload = spool.read(offset, self.s.upload_bytes)
        if not payload:
            return False, "nothing readable at the upload pointer"
        body = {
            "kind": "device-blob",
            "data": {
                "device": self.s.device_name or self.s.device_address,
                "offset": offset,
                "length": len(payload),
                "encoding": "base64",
                "bytes": base64.b64encode(payload).decode("ascii"),
            },
        }
        code = self._post(self._url(), body, {"X-Device-Key": self.s.device_key})
        if 200 <= code < 300:
            spool.mark_uploaded(offset + len(payload))
            self.backoff = 0.0
            return True, f"sent {len(payload)} bytes at {offset}"
        # A REJECTION AND AN OUTAGE ARE DIFFERENT PROBLEMS. Retrying a 400 forever is a
        # loop; retrying a 503 is the correct behaviour. Only the second backs off and
        # keeps trying.
        self.backoff = min(max(self.backoff * 2, 5.0), self.s.max_backoff_seconds)
        if 400 <= code < 500 and code not in (408, 429):
            return False, f"server refused this ({code}) — will not retry blindly"
        return False, f"upload failed ({code or 'unreachable'}); retrying in {self.backoff:.0f}s"


# --------------------------------------------------------------------------- the loop

async def find_address(settings: Settings, log=print) -> str | None:
    """Look for the logger. Returns an address, or None if it is not in range."""
    if settings.device_address:
        return settings.device_address
    try:
        from bleak import BleakScanner
    except ImportError:
        log("bleak is not installed: pip install bleak")
        return None
    want = (settings.device_name or "").lower()
    for d in await BleakScanner.discover(timeout=settings.scan_seconds):
        name = (d.name or "").lower()
        if want and want in name:
            return d.address
    return None


async def run(settings: Settings, *, link_factory=None, rounds: int | None = None,
              log=print, sleep=asyncio.sleep, post=None) -> dict:
    """The program. Pull when the logger is near; upload whenever there is a backlog.

    THE TWO LOOPS ARE ONE LOOP HERE ON PURPOSE. A separate thread for uploading would buy
    nothing - the box is idle almost all the time - and would cost a second path through
    the spool's state file, which is the one thing that must never be written twice at once.
    """
    device = settings.device_address or settings.device_name or "device"
    spool = Spool(settings.spool_dir, device)
    uploader = Uploader(settings, post=post)
    stats = {"pulls": 0, "bytes": 0, "uploads": 0, "misses": 0}
    n = 0

    while rounds is None or n < rounds:
        n += 1
        made_link = None
        try:
            if link_factory:
                made_link = link_factory()
            else:
                address = await find_address(settings, log=log)
                made_link = BleLink(address) if address else None

            if made_link is None:
                stats["misses"] += 1
            else:
                async with _as_context(made_link) as link:
                    res = await pull_once(link, spool, settings)
                    stats["pulls"] += 1
                    stats["bytes"] += res.got
                    if res.got:
                        log(f"pulled {res.got} bytes, acked to {res.acked_to}")
                    if res.note:
                        log(f"note: {res.note}")
                    if res.holes:
                        log(f"LOST {sum(b - a for a, b in res.holes)} bytes the logger no longer had")
        except Exception as exc:
            # A box in somebody's living room does not get to crash. Anything unexpected is
            # logged and the loop continues; the logger keeps its copy either way.
            log(f"pull failed: {exc}")

        # UPLOAD RUNS WHETHER OR NOT THE CHAIR WAS THERE. That is the whole point of the
        # second pointer: a backlog drains during an outage's recovery, not during a visit.
        while spool.pending_upload > 0:
            ok, why = uploader.send_next(spool)
            if ok:
                stats["uploads"] += 1
                log(why)
            else:
                log(why)
                break

        if rounds is not None and n >= rounds:
            break
        await sleep(settings.busy_seconds if stats["bytes"] else settings.idle_seconds)

    stats["pending_upload"] = spool.pending_upload
    stats["acked"] = spool.state["acked"]
    stats["uploaded"] = spool.state["uploaded"]
    stats["holes"] = spool.state["holes"]
    return stats


class _NullContext:
    """Lets a plain object stand in for something with `async with`, so the fake logger
    does not have to grow a context manager it has no use for."""

    def __init__(self, obj):
        self.obj = obj

    async def __aenter__(self):
        return self.obj

    async def __aexit__(self, *exc):
        return False


def _as_context(obj):
    return obj if hasattr(obj, "__aenter__") else _NullContext(obj)


# --------------------------------------------------------------------------- cli

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="The box: pull from a logger, spool it, send it on.")
    ap.add_argument("--config", help="JSON file of settings; every key is optional")
    ap.add_argument("--name", help="BLE name to look for")
    ap.add_argument("--address", help="exact BLE address (skips scanning)")
    ap.add_argument("--spool", help="where to keep the spool")
    ap.add_argument("--server", help="https://... ; omit to spool without uploading")
    ap.add_argument("--key", help="device key")
    ap.add_argument("--person", help="person id; omit for the account stream")
    ap.add_argument("--rounds", type=int, help="stop after N passes (default: forever)")
    ap.add_argument("--fake", type=int, metavar="BYTES",
                    help="run against an in-process logger holding N bytes - no radio")
    ap.add_argument("--fake-drop", type=int, default=0, metavar="N",
                    help="with --fake, drop every Nth notification")
    ap.add_argument("--settings", action="store_true", help="print every setting and its default")
    args = ap.parse_args(argv)

    if args.settings:
        for k, v in asdict(Settings()).items():
            print(f"{k:22} {v!r}")
        return 0

    s = Settings.load(args.config)
    for flag, attr in (("name", "device_name"), ("address", "device_address"),
                       ("spool", "spool_dir"), ("server", "server"),
                       ("key", "device_key"), ("person", "person_id")):
        val = getattr(args, flag)
        if val:
            setattr(s, attr, val)

    factory = None
    if args.fake:
        payload = bytes((i * 7 + 11) % 256 for i in range(args.fake))
        logger = FakeLogger(payload, chunk=64, drop_every=args.fake_drop)
        factory = lambda: logger        # noqa: E731 - one line, one use
        s.idle_seconds = s.busy_seconds = 0.01

    stats = asyncio.run(run(s, link_factory=factory, rounds=args.rounds))
    print(json.dumps(stats, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
