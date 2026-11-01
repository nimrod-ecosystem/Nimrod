// outside_reach.js - WHEN SOMETHING OUTSIDE THIS SITE COULD NOT BE REACHED, SAY WHAT MAY HAVE STOPPED IT (row 2.148).
//
// Mike, 2026-10-28: "ad blockers have broken Nimrod before - Can we fix Nimrod so this doesn't happen?" Several panels
// ask an outside service straight from the browser (the weather from Open-Meteo, Wikipedia, the Internet Archive,
// YouTube's own player and its video names, Spotify). An ad or privacy blocker, in the browser or on the network
// (uBlock Origin, AdGuard, Brave's shields, Pi-hole, AdGuard Home), can stop any of them. Each panel had its own
// sentence for "could not reach it"; this is the one sentence they share, so the same trouble reads the same
// everywhere, and blockers are named as ONE possible cause beside the network - never as the cause.
//
// *** WHAT A PAGE CAN ACTUALLY TELL, AND WHAT IT CANNOT. ***
//   * A fetch() to another host that never got an answer REJECTS WITH A TypeError ("Failed to fetch" in Chrome,
//     "NetworkError when attempting to fetch resource." in Firefox, "Load failed" in Safari). It is the SAME TypeError
//     for an extension refusing it (Chrome prints net::ERR_BLOCKED_BY_CLIENT in the console and never hands it to the
//     page), a DNS blocker (Pi-hole and AdGuard Home answer 0.0.0.0 or "no such name"), no internet behind the wifi, a
//     wifi sign-in page in the way, and a refused cross-site answer. Browsers make these identical on purpose, so a
//     page cannot map the network around it. So a blocker can be NAMED as possible, never CONFIRMED: 'stopped'.
//   * navigator.onLine === false IS reliable, in that one direction: no network at all. Blockers are then not the
//     cause, and the sentence does not mention them: 'offline'. (true only says some network is attached.)
//   * A request that went out and got nothing back in time. Extension and DNS blockers refuse at once, so a wait that
//     runs out is the network, or a filter that silently drops (some guest and facility networks do): 'slow'.
//   * Any HTTP answer, or a body that could not be read: the host ANSWERED, so nothing stopped the request on the
//     way. Not a blocker and not the connection: 'answered'.
// *** WHAT THIS DELIBERATELY DOES NOT DO: ask for a "bait" address (an ads.js) to see whether a blocker is there. ***
// That is the anti-ad-blocker trick. It says only that SOME rule matched a bait name, not that this service is
// stopped, and a site that probes its visitors for blockers is not treating their choice as theirs.
//
// Site copy: plain words, nobody named. Pure: no network, no DOM.

export const REACH = Object.freeze({ OFFLINE: 'offline', SLOW: 'slow', STOPPED: 'stopped', ANSWERED: 'answered' });

function onlineNow() {
  try { return typeof navigator !== 'undefined' && navigator && 'onLine' in navigator ? navigator.onLine : true; }
  catch { return true; }
}

/**
 * Which of the four it looks like (REACH), or null when there is nothing to go on. `err` is what a request threw,
 * or a Response-like answer that was not ok (anything with a numeric `status`). `online` is a seam for the suites.
 * A request a person CANCELLED is the caller's to tell apart before asking: an AbortError here is read as a wait
 * that ran out, which is what every caller's own timer uses it for.
 */
export function reachTrouble(err, { online = onlineNow } = {}) {
  let on = true;
  try { on = (typeof online === 'function' ? online() : online) !== false; } catch { on = true; }
  if (!on) return REACH.OFFLINE;
  if (err == null) return null;
  if (typeof err === 'object' && typeof err.status === 'number') return REACH.ANSWERED;
  const name = String(err && err.name || '');
  const msg = String(err && err.message || err || '');
  if (name === 'AbortError' || name === 'TimeoutError' || /\btime(d)?\s?out\b|\btimeout\b/i.test(msg)) return REACH.SLOW;
  if (/^HTTP\s*\d+/i.test(msg)) return REACH.ANSWERED;              // a caller that threw on a status (weather.js)
  if (name === 'SyntaxError') return REACH.ANSWERED;                 // it answered, with something unreadable
  if (name === 'TypeError') return REACH.STOPPED;                    // the browser's one word for "no answer at all"
  return null;
}

// "The weather service" in the middle of a sentence.
const midSentence = (what) => String(what).replace(/^The /, 'the ');

/**
 * The plain sentence for "could not reach `what`". `host` is the address to allow in a blocker ("open-meteo.com");
 * `trouble` is reachTrouble's answer, or left out when the panel does not know why (it then names both causes).
 */
export function cantReachWords(what, { host = '', trouble = null } = {}) {
  const w = String(what || 'It');
  if (trouble === REACH.OFFLINE) return `This device is not connected to the internet, so ${midSentence(w)} could not be reached.`;
  if (trouble === REACH.SLOW) return `${w} did not answer in time. ${SLOW_WHY}`;
  if (trouble === REACH.ANSWERED) return `${w} answered with an error just now. It may be busy.`;
  return `${w} could not be reached from here. ${stoppedWhy(host)}`;
}

/**
 * Only the WHY, for a panel whose own first line already says what could not be reached ("Could not reach the
 * weather service."), so it is not said twice.
 */
export function cantReachWhy({ host = '', trouble = null } = {}) {
  if (trouble === REACH.OFFLINE) return 'This device is not connected to the internet.';
  if (trouble === REACH.SLOW) return `It did not answer in time. ${SLOW_WHY}`;
  if (trouble === REACH.ANSWERED) return 'It answered with an error, so it may be busy.';
  return stoppedWhy(host);
}

const SLOW_WHY = 'The internet here may be slow or down, or a filter on this network may be holding it back.';
function stoppedWhy(host) {
  return 'The internet may be down, or an ad or privacy blocker on this device or on the network may be stopping it.'
    + (host ? ` Allowing ${host} in the blocker may fix it.` : '');
}
