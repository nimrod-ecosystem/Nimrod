# NimrodLink protocol, version 1

**Status:** draft, implemented, tested. Version 1.
**Licence:** MIT, same as the rest of this repository. Use it, change it, ship it, fork it.
**Reference implementation:** [`tools/nano_protocol.py`](../tools/nano_protocol.py) ·
**Conformance tests:** [`tools/test_nano_protocol.py`](../tools/test_nano_protocol.py) (41 checks)

---

## What this is

A small device records something. Something else in the room collects it and sends it
onward. This document specifies the bytes that pass between them, precisely enough that
two people who never speak to each other can write the two ends and have them work.

It was written for wheelchair dataloggers — a sensor on a chair, a box where the chair
parks — but nothing in it is about wheelchairs. **It moves an append-only stream of bytes
off a device that is only intermittently in range.**

## Scope

**It does not define your data.** See [Format-agnostic](#format-agnostic-the-most-important-decision-here).

**It does not define how the collector sends data onward** — HTTP, MQTT, a USB stick, a
carrier pigeon. That is outside this document on purpose.

## Terminology

| term | meaning |
| --- | --- |
| **logger** | the device holding the data. Peripheral, in BLE terms. The chair. |
| **collector** | the thing that comes and gets it. Central, in BLE terms. The box in the room. |
| **stream** | the logger's bytes, as one append-only sequence with stable offsets |
| **offset** | a byte position in the stream. **Counted from the first byte ever appended**, not from the start of storage |
| **bookmark** | how far the collector has told the logger it has got. Advisory |

**MUST**, **MUST NOT**, **SHOULD** and **MAY** carry their usual meanings.

---

## Design principles

These are the four decisions everything else follows from. Each exists because of a
specific way this goes wrong in a house.

### Format-agnostic: the most important decision here

**The protocol never looks inside a record.** The logger ships bytes, the collector does
not parse them, and whatever stores them keeps an opaque blob. Only the people who wrote
the logger ever need to know what a record contains.

This is not laziness. A protocol that dictated record layout would be **dead on arrival
with any manufacturer that already has one** — and every manufacturer already has one. By
specifying the *pipe* and not the *contents*, this can be adopted by people who will never
change their formats, and their formats can change without touching anything here. There is
also no second implementation of anybody's record layout to drift out of sync with theirs.

### Stable offsets

`total` is **the number of bytes ever appended**, not the number currently stored. Byte
5,000 is always the same byte, even after a ring buffer has overwritten it. This is what
lets a collector ask for an old offset and get a truthful answer — including the truthful
answer *"that is gone now."*

### Resumable, always

Somebody will walk away mid-transfer. **A transfer that restarts from zero when
interrupted never finishes a long backlog, and gets worse the more data is waiting** —
exactly backwards. Every data frame therefore carries its own offset, and a collector may
resume from any offset at any time.

### The bookmark is not a delete pointer

`confirmed` records how far the collector says it has got. **A logger MUST still serve any
offset it physically holds, including offsets below the bookmark.** That single rule is
what makes the collector disposable: if it dies holding data that never reached its
destination, a replacement asks for an older offset and nothing is lost.

---

## Transport binding: BLE GATT

Version 1 defines one binding. The frame layouts below are transport-independent and could
be carried over serial or anything else; only this section is BLE-specific.

The logger **MUST** advertise the service UUID, not merely a name. A collector finds the
right device by what it can do, not by two people having typed matching strings.

| role | UUID | properties |
| --- | --- | --- |
| service | `4e696d72-6f64-4c69-6e6b-000000000001` | — |
| **status** | `4e696d72-6f64-4c69-6e6b-000000000002` | read, notify |
| **control** | `4e696d72-6f64-4c69-6e6b-000000000003` | write, write-without-response |
| **data** | `4e696d72-6f64-4c69-6e6b-000000000004` | notify |

The UUIDs are the ASCII of `NimrodLink` so they are recognisable in a scanner rather than
being one more random blob to look up.

**Data uses NOTIFY, not INDICATE.** Indications are acknowledged one at a time and would
roughly halve an already slow link. The offset on every frame buys the reliability back: a
dropped notification appears as a gap, and the collector re-requests exactly that gap.

---

## Frame layouts

All integers are **little-endian and unsigned**. Implementations **SHOULD** lay these
bytes out by hand rather than casting a packed struct — the two ends are built by different
toolchains, and a struct's layout is a promise a compiler makes to itself.

### Status — 20 bytes, read from the status characteristic

| offset | size | field | meaning |
| ---: | ---: | --- | --- |
| 0 | 1 | `proto` | protocol version. **1** for this document |
| 1 | 1 | `flags` | bit 0 = `MORE` (bytes exist past the send cursor). Others reserved, **MUST** be 0 |
| 2 | 2 | `chunk` | maximum payload bytes per data frame, **excluding** the 4-byte offset |
| 4 | 4 | `total` | bytes ever appended |
| 8 | 4 | `oldest` | lowest offset the logger can still produce |
| 12 | 4 | `confirmed` | the bookmark |
| 16 | 4 | `fw` | logger firmware version, opaque to this protocol |

Twenty bytes fits a single ATT read at the default 23-byte MTU, which matters because
reading status is the first thing every collector does.

A collector **MUST** read status before anything else, and **MUST** refuse to proceed if
`proto` is not a version it implements. *Failing loudly matters more than it looks: a
collector that misread a struct would forward plausible nonsense for weeks, and nobody
would notice until somebody analysed it.*

A collector **MUST NOT** assume `chunk`. It is a property of the logger and its negotiated
MTU, and it is read, never guessed.

### Control — 5 bytes, written to the control characteristic

| offset | size | field |
| ---: | ---: | --- |
| 0 | 1 | `op` |
| 1 | 4 | `arg` |

| op | name | arg | effect |
| ---: | --- | --- | --- |
| `0x01` | **SEEK** | offset | set the send cursor and begin sending |
| `0x02` | **ACK** | offset | "everything below this offset is durably held" |
| `0x03` | **STOP** | — | stop sending |
| `0x04` | **PING** | — | no effect; refresh status |

A logger **MUST** accept a SEEK to any offset, **forwards or backwards**. Seeking backwards
is the entire recovery story.

A logger **MUST NOT** move `confirmed` backwards. An ACK with a lower offset than the
current bookmark is ignored — otherwise a stale collector rewinds a good bookmark.

A logger **MUST NOT** delete, overwrite or otherwise treat data as expendable because of an
ACK. ACK is a bookmark. Storage reclamation is the logger's own business and independent of
this protocol.

### Data frame — 4 + N bytes, notified on the data characteristic

| offset | size | field |
| ---: | ---: | --- |
| 0 | 4 | `offset` — stream position of the first payload byte |
| 4 | N | payload, `1 ≤ N ≤ chunk` |

The final frame of a stream **MAY** be shorter than `chunk`. A frame **MUST NOT** be sent
with an empty payload.

---

## How a collection goes

1. Connect. Read **status**.
2. Check `proto`. Note `chunk`, `total`, `oldest`, `confirmed`.
3. If `confirmed < oldest`, some history is **unrecoverable** — record the loss, and start
   from `oldest`.
4. Write **SEEK** to the chosen start offset.
5. Receive data frames. For each: if `offset` equals the expected position, append. If it
   is lower, the overlap is already held — take only the tail. If it is higher, **a frame
   was dropped**: see below.
6. When everything is received, store it durably, then write **ACK** with the new position.
7. Disconnect, or **STOP** and stay connected.

### Handling a gap

When a frame arrives from beyond the expected position, the collector **MUST NOT** write
the payload. **It MUST NOT fill the gap with anything.** *Data that looks continuous and
is not is the worst possible outcome for a longitudinal study — worse than a hole, because
a hole is visible.*

The collector **SHOULD** SEEK back to the expected position and continue.

If the logger answers a backwards SEEK with a frame from a still-higher offset, **the
history is genuinely gone** — the logger no longer holds it. The collector **MUST** record
the extent of the loss and resume from what the logger can give.

> **A collector that seeks back forever instead of recording the loss will never finish.**
> This is not hypothetical: it was found by the conformance tests, which returned zero
> bytes from a logger whose ring buffer had wrapped, before the rule was written down.

### Detecting the end

**A collector MUST decide it is finished by comparing what it holds against `total`. It
MUST NOT treat silence as completion.**

> A dropped **final** frame leaves the stream exactly as quiet as a completed transfer, and
> no later offset ever arrives to reveal the hole. A collector that trusted the silence
> would lose the tail of every unlucky transfer and never know it had. Also found by the
> conformance tests, which lost 8 bytes off the end of every run until this was a rule.

If the stream goes quiet and the held position is below `total`, the collector **SHOULD**
re-read status and SEEK to its own position.

### Durability, and what ACK actually promises

**ACK means "I have these bytes somewhere durable." It does not mean "they reached their
destination."**

This is deliberate, and it is what lets a collection happen during a network outage: the
collector writes to its own storage and acknowledges immediately, so the logger can move on
rather than waiting for the internet to come back. The collector keeps its own, separate
record of what actually got delivered onward.

**This is only safe because the bookmark is not a delete pointer.** If the collector then
dies with undelivered data, a replacement SEEKs backwards and the logger still has it. Two
independent bookmarks, nothing destructive, and the collector stays replaceable.

---

## Conformance

[`tools/test_nano_protocol.py`](../tools/test_nano_protocol.py) runs against
[`tools/nano_protocol.py`](../tools/nano_protocol.py) with no hardware and no dependencies:

```
py -3.13 tools/test_nano_protocol.py
```

It covers frame layouts, version mismatch, clean transfers, dropped frames including the
first and the last, resumption across sessions, a wrapped ring buffer, bookmark semantics,
every chunk size from 1 to 243 bytes, and a negative control demonstrating what a collector
that ignored offsets would produce.

[`tools/nano_probe.py`](../tools/nano_probe.py) is a working collector for a desktop. It
will talk to any conforming logger over BLE and report throughput — useful for checking an
implementation and for finding out what a given radio and MTU can actually manage.

## Versioning

`proto` is a single byte, incremented **only** for a change that would make an existing
implementation misread bytes. New `flags` bits and new `op` values are **not** breaking:
unknown flag bits and unknown opcodes **MUST** be ignored, which is why reserved bits must
be sent as zero.

## Known limits of version 1

Stated rather than buried.

- **`total` is 32 bits** — about 4 GB per stream. Ample for summarised sensor data, not for
  raw high-rate audio or video. A future version would widen it.
- **No authentication or encryption at this layer.** Anything in radio range that speaks
  this protocol can read the stream. Use BLE pairing, or do not put anything sensitive in
  it, or both. *This is a real gap and it is left open on purpose: bolting a half-designed
  crypto scheme onto a v1 is worse than saying plainly that it is not there.*
- **One collector at a time**, implied by a single send cursor and a single bookmark.
- **The BLE binding assumes GATT notifications.** Other transports are possible and unspecified.
- **Throughput is not specified and cannot be** — it depends on the radio, the stack and
  the negotiated MTU. Measure it with `nano_probe.py` rather than quoting anyone's estimate.
