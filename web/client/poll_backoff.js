// poll_backoff.js — how fast to retry a poll that just failed, and how quickly to slow down.
//
// Found necessary 2026-09-15: state.js's and events.js's polling loops retried at a FIXED
// interval forever, success or failure alike. During a real database outage (Neon, that
// day) every open kiosk kept hammering the same failing endpoint every ~1.5 seconds,
// nonstop, for hours — which is exactly the behavior that helped burn through a monthly
// network-transfer allowance while providing no benefit at all, since none of those
// requests could possibly have succeeded. Worse: this is not a freak failure mode. A kiosk
// is DESIGNED to run unattended for as long as the screen is on, so "the backend is briefly
// unreachable" is a case ordinary operation must handle cheaply, not an edge case to shrug
// off — see NOTES_FROM_CODE.md, 2026-09-15.
//
// EXPONENTIAL, NOT LINEAR, AND CAPPED. Backing off by a fixed amount per failure still adds
// up to a lot of requests over a multi-hour outage; capping the growth keeps a genuinely
// brief blip (a few seconds) retrying close to its normal cadence, while a real outage
// (minutes to hours) quickly settles onto a much slower cadence instead of drifting toward
// either "basically the same as no backoff" or "waits forever."
//
// RESETS TO THE FLOOR THE INSTANT A REQUEST SUCCEEDS, deliberately. The point is only to
// stop wasting requests DURING an outage, never to mark a device "unreliable" and treat it
// differently afterward. The moment the server answers, it's business as usual at the
// normal cadence — no slow ramp back up.
//
// `consecutiveFailures <= 0` (the healthy case) returns `baseMs` unchanged, so a caller
// that has never seen a failure — the overwhelming majority of the time — pays no cost at
// all for this existing: same request, same cadence as before this file existed.
export function nextPollDelay(baseMs, consecutiveFailures, maxMs) {
  if (consecutiveFailures <= 0) return baseMs;
  // The exponent itself is capped separately from the final value — with no cap here, a
  // poll left failing for days would keep computing `baseMs * 2 ** N` with N in the
  // hundreds, which overflows toward `Infinity` in floating point long before `Math.min`
  // ever gets a chance to clamp it back down to `maxMs`. 30 is already far past the point
  // `2 ** 30` alone exceeds any sane `maxMs`, so the clamp below is what actually decides
  // the answer either way.
  const scaled = baseMs * (2 ** Math.min(consecutiveFailures, 30));
  return Math.min(scaled, maxMs);
}
