// daypart.js — the time-of-day clock the platform schedules against.
//
// A "daypart" is a named stretch of the day (morning / daytime / primetime /
// sleepytime). It is the single source of truth for time-of-day across the
// platform — TWO consumers ride it:
//
//   1. the content DIRECTOR (statemachine.js) gates which segment types are
//      allowed to play right now (e.g. games only in daytime; morning &
//      sleepytime run YouTube only);
//   2. YouTube's daypart PLAYLIST selection ("at 7pm → the primetime playlist")
//      — the "time-trigger node" DECISIONS.md describes.
//
// One clock, two uses — so "no interstitials during sleepytime" and "primetime
// playlist at 17:00" agree by construction instead of being configured twice.
//
// PURE + no wall clock of its own: `now` (ms epoch) is passed in, so a schedule
// is deterministic and unit-testable. Boundaries are DATA (a per-profile setting
// later), not code — the defaults below are one real household’s rough rhythm and are
// meant to be edited.

// Ordered day boundaries. Each entry starts at `start` (local hour, 0–24) and
// runs until the next entry's start; the last wraps past midnight to the first.
// Editable per profile later — these are just sensible defaults.
export const DEFAULT_DAYPARTS = [
  { name: 'morning',    start: 6 },   // 06:00–09:00
  { name: 'daytime',    start: 9 },   // 09:00–17:00
  { name: 'primetime',  start: 17 },  // 17:00–21:00
  { name: 'sleepytime', start: 21 },  // 21:00–06:00 (wraps midnight)
];

// Which daypart a given LOCAL hour-of-day falls in. TZ-free and pure (takes a
// number), so it's the deterministic core both daypartAt() and tests call.
// `hour` may be fractional (e.g. 8.5 for 08:30). The list is treated as circular:
// an hour before the first boundary belongs to the LAST daypart (the one that
// wrapped past midnight).
export function daypartForHour(hour, dayparts = DEFAULT_DAYPARTS) {
  if (!dayparts || !dayparts.length) return null;
  let chosen = dayparts[dayparts.length - 1]; // wrap: before the first start → last
  for (const dp of dayparts) if (hour >= dp.start) chosen = dp;
  return chosen.name;
}

// Which daypart the wall-clock instant `now` (ms epoch) falls in, in LOCAL time.
// This is the one place that reads a clock; everything downstream takes the
// resulting name.
export function daypartAt(now, dayparts = DEFAULT_DAYPARTS) {
  const d = new Date(now);
  const hour = d.getHours() + d.getMinutes() / 60;
  return daypartForHour(hour, dayparts);
}
