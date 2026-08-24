#!/usr/bin/env python3
"""Talk to a NimrodLink logger from a desktop, and MEASURE IT.

WHY THIS EXISTS BEFORE THE BOX DOES. The single most useful thing the first demo can
produce is a number: how fast can a Nano 33 BLE actually push bytes over ArduinoBLE? Every
design decision downstream hangs off it — whether a multi-week backlog moves in seconds or
in twenty minutes, and therefore how much the resumable-transfer machinery is earning.

Estimates in our notes said 5-20 kB/s. They may be badly optimistic: the default ATT MTU
is 23 bytes, which is about 16 bytes of payload per notification after the offset header,
and ArduinoBLE does not make MTU negotiation easy. **Nobody should quote a number in an
email that came from a forum post.** Measure it here.

It also means the Nano half can be finished and proven WITHOUT writing any ESP32 firmware
at all. This laptop stands in for the box.

    pip install bleak
    py -3.13 nano_probe.py --scan
    py -3.13 nano_probe.py --name wheeltrak-01 --out dump.bin
    py -3.13 nano_probe.py --name wheeltrak-01 --benchmark

WHAT IT DELIBERATELY DOES NOT DO: acknowledge anything by default. An ACK moves the
logger's bookmark, and while you are still developing you almost always want to pull the
same data again. Pass --ack when you mean it.
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nano_protocol as p  # noqa: E402

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("This needs bleak:  pip install bleak")
    raise SystemExit(2)


async def scan(seconds: float) -> None:
    print(f"scanning {seconds:.0f}s for NimrodLink loggers…\n")
    found = await BleakScanner.discover(timeout=seconds, return_adv=True)
    hits = 0
    for _addr, (dev, adv) in found.items():
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if p.SERVICE_UUID.lower() in uuids:
            hits += 1
            print(f"  {dev.name or '(no name)':<24} {dev.address}   rssi {adv.rssi} dBm")
    if not hits:
        print("  nothing advertising the NimrodLink service.")
        print("  Is the sketch running, and is the board powered?")


async def find(name: str | None, address: str | None, seconds: float):
    if address:
        return address
    print(f"looking for {'a NimrodLink logger' if not name else name}…")
    found = await BleakScanner.discover(timeout=seconds, return_adv=True)
    for _addr, (dev, adv) in found.items():
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if p.SERVICE_UUID.lower() not in uuids:
            continue
        if name and (dev.name or "") != name:
            continue
        print(f"  found {dev.name or '(no name)'} at {dev.address} ({adv.rssi} dBm)\n")
        return dev.address
    return None


async def pull(client: BleakClient, start: int, status: p.Status, verbose: bool):
    """One transfer. Returns (reassembler, seconds, chunk_count).

    THE TWO RULES THAT COST A TEST FAILURE TO FIND, both implemented here:
      * completion is decided by comparing against `total`, never by the notifications
        going quiet — a dropped FINAL chunk looks exactly like a finished transfer;
      * if a re-seek does not close a gap, that history is genuinely gone: record the hole
        and move on, rather than seeking backwards into the void forever.
    """
    r = p.Reassembler(start)
    chunks = 0
    last_rx = time.monotonic()
    pending_seek = None

    def on_notify(_h, raw: bytearray):
        nonlocal chunks, last_rx
        chunks += 1
        last_rx = time.monotonic()
        r.feed(bytes(raw))

    await client.start_notify(p.DATA_UUID, on_notify)
    t0 = time.monotonic()
    await client.write_gatt_char(p.CONTROL_UUID, p.command(p.OP_SEEK, start), response=False)

    stalls = 0
    while True:
        await asyncio.sleep(0.05)
        quiet = time.monotonic() - last_rx

        if r.gap_at is not None and r.gap_at != pending_seek:
            # A dropped notification. Seek back to the hole once.
            pending_seek = r.gap_at
            if verbose:
                print(f"    gap at {r.gap_at} — seeking back")
            r.reset_to(r.gap_at)
            await client.write_gatt_char(p.CONTROL_UUID, p.command(p.OP_SEEK, r.gap_at), response=False)
            last_rx = time.monotonic()
            continue

        if quiet < 1.5:
            continue

        # Quiet for a while. Re-read status rather than trusting the silence.
        fresh = p.parse_status(await client.read_gatt_char(p.STATUS_UUID))
        if r.cursor >= fresh.total:
            break
        if r.cursor < fresh.oldest:
            # The logger cannot reach back this far any more.
            if verbose:
                print(f"    history before {fresh.oldest} is gone — recording the loss")
            r.skip_to(fresh.oldest)
        stalls += 1
        if stalls > 8:
            print(f"    giving up at {r.cursor} of {fresh.total} — logger stopped responding")
            break
        if verbose:
            print(f"    stalled at {r.cursor}/{fresh.total} — re-seeking")
        await client.write_gatt_char(p.CONTROL_UUID, p.command(p.OP_SEEK, r.cursor), response=False)
        last_rx = time.monotonic()

    elapsed = time.monotonic() - t0
    await client.stop_notify(p.DATA_UUID)
    return r, elapsed, chunks


async def run(args) -> int:
    if args.scan:
        await scan(args.timeout)
        return 0

    address = await find(args.name, args.address, args.timeout)
    if not address:
        print("no logger found. Try --scan to see what is advertising.")
        return 1

    async with BleakClient(address) as client:
        raw = await client.read_gatt_char(p.STATUS_UUID)
        st = p.parse_status(raw)
        print(st)
        print()

        if st.total == 0:
            print("the logger has no data yet — nothing to pull.")
            return 0

        runs = args.runs if args.benchmark else 1
        rates = []
        for i in range(runs):
            start = args.start if args.start is not None else (0 if args.benchmark else st.confirmed)
            r, secs, chunks = await pull(client, start, st, args.verbose)
            got = len(r.buf)
            rate = got / secs if secs > 0 else 0
            rates.append(rate)
            label = f"run {i + 1}/{runs}: " if runs > 1 else ""
            print(f"  {label}{got} bytes in {secs:.2f}s  =  {rate / 1000:.2f} kB/s"
                  f"   ({chunks} notifications, {rate / max(chunks, 1):.0f} B/notify effective)")
            if r.holes:
                lost = r.lost
                print(f"    LOST {lost} bytes in {len(r.holes)} hole(s): {r.holes[:4]}")

        if runs > 1:
            print(f"\n  median {statistics.median(rates) / 1000:.2f} kB/s over {runs} runs")

        # THE NUMBERS THE EMAIL ACTUALLY NEEDS. A day of summaries is trivial at any rate;
        # backlog recovery is where this decides the design.
        med = statistics.median(rates) if rates else 0
        if med > 0:
            print(f"\n  at {med / 1000:.2f} kB/s:")
            for label, size in (("a day of summaries (~20 kB)", 20_000),
                                ("a week (~150 kB)", 150_000),
                                ("a month (~600 kB)", 600_000)):
                secs = size / med
                pretty = f"{secs:.0f}s" if secs < 90 else f"{secs / 60:.1f} min"
                print(f"    {label:<32} {pretty}")

        if args.out and not args.benchmark:
            Path(args.out).write_bytes(bytes(r.buf))
            print(f"\n  wrote {len(r.buf)} bytes to {args.out}")

        if args.ack:
            # Moves the logger's bookmark. Off by default: while developing you almost
            # always want to pull the same bytes again, and an accidental ack means
            # re-flashing to get them back.
            await client.write_gatt_char(p.CONTROL_UUID, p.command(p.OP_ACK, r.cursor), response=False)
            print(f"  acknowledged through {r.cursor}")

    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Pull from a NimrodLink logger and measure it.")
    ap.add_argument("--scan", action="store_true", help="list NimrodLink loggers in range and stop")
    ap.add_argument("--name", help="advertised name to connect to")
    ap.add_argument("--address", help="BLE address, skipping the scan")
    ap.add_argument("--timeout", type=float, default=8.0, help="scan seconds (default 8)")
    ap.add_argument("--start", type=int, help="offset to pull from (default: the logger's bookmark)")
    ap.add_argument("--out", help="write the pulled bytes to this file")
    ap.add_argument("--ack", action="store_true",
                    help="advance the logger's bookmark afterwards. OFF by default — see the docstring.")
    ap.add_argument("--benchmark", action="store_true", help="pull from 0 repeatedly and report a rate")
    ap.add_argument("--runs", type=int, default=3, help="benchmark runs (default 3)")
    ap.add_argument("--verbose", action="store_true", help="narrate gaps and re-seeks")
    args = ap.parse_args()
    if not args.scan and not args.name and not args.address:
        ap.error("give --name or --address, or use --scan to find one")
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
