# Module: clock

> One line: a large, readable clock for orientation — time, weekday + part-of-day, and date.

## Purpose
Orientation for a disoriented patient. A brain-injured person waking in an unfamiliar room
often loses track of time and day; a calm, glanceable "it's **Monday night**, August 10" helps
ground them. It's the first default-dashboard module and the simplest — its second job is to
establish the default-module + settings convention the other modules follow.

## How it looks / behaves
A big time, a friendly `Weekday part-of-day` line ("Monday night"), and the full date. A small
gear (⚙) reveals inline settings: 12/24-hour, seconds on/off, date on/off, size (S/M/L), and
time zone (Device or a named US zone / UTC). Display-only — it takes no input and needs no
accessibility input path.

## Inputs → outputs (on the bus)
- **Sources:** none. The clock is self-contained (a 1-second tick).
- **Bindings:** none.
- **Sinks:** none — it neither listens to nor publishes on the bus.

## State & storage
**Overwrite kind** (settings): `{ hour12, seconds, showDate, size, tz }`, server-side, keyed to
`(user, profile, instance)`, last-write-wins with a version. Each settings control writes its
key via the state handle; the render adopts server truth (own writes, first load, or another
device via the poller). In-memory mirror only — **no `localStorage`/IndexedDB**. Settings travel
with the profile: open it on another device and the same clock comes back.

## Privacy notes
None. No media, no network beyond the state round-trip, no patient data.

## How to extend
- **More formats:** add options to the settings panel; they're just keys in the config object,
  persisted automatically.
- **Publish time on the bus** if another module ever needs a shared tick — add a source rather
  than have modules each run their own timer.

## Status
**Tested.** Validated 2026-08-10: renders time/weekday/part-of-day/date; 1-second tick advances;
every setting (12/24h, seconds, date, size, zone incl. cross-zone Pacific→Sunday) applies and
persists per profile (confirmed via a second tab loading identical config, version 4); per-profile
isolation (absent on a profile without it); interval cleaned up on profile switch with zero
console errors.
