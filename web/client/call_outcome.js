// call_outcome.js — HOW OFTEN CALLS CANNOT CONNECT, counted once per call (2026-10-26, chat's note CV; row 2.167).
//
// Mike's ruling (2026-09-08): no relay server; revisit only if calls that cannot connect are MOST calls - so measure
// first. Each call is reported once, "direct" when it connects and "failed" when it cannot; the site keeps two counts a
// day and nothing about who called whom (app.py POST /api/call/outcome, db.py call_outcomes). Fire and forget: a report
// that fails changes nothing about the call.
//
// The rule used to live inside the caller page (call_page.js) alone, so a call placed from a screen's Call panel
// (kiosk.js `dialOut`, row 2.167) was never counted. It is here now, once, for every end that PLACES a call.
//
// *** WHICH END REPORTS: THE ONE THAT PLACED THE CALL. NEVER THE ONE THAT ANSWERED. *** Argued:
//   * FOR the caller: a call has exactly one caller, and it is the caller that holds the call's whole life - it rang,
//     it waits for the answer, its own connect clock and stall clock decide "could not connect". It is also what was
//     already counted (the caller page), so the numbers before and after this change mean the same thing.
//   * AGAINST the answering end: most calls are a phone calling a screen. If screens reported too, every one of those
//     would be counted twice - the server keeps one report per login and call (`user|session`), and the phone and the
//     screen are different logins. When both ends are screens (one Call panel calling another screen), the same rule
//     gives exactly one report: the calling screen's, as a caller; the answering screen never reports, as before.
//   * The case for the answering end: a screen is always on, and a phone page can be closed before its report leaves.
//     True, but a report lost that way is one missing count in a ratio, and the double count above would be every call.
//   * The server (app.py) also counts one report per call session whoever sends it, so a second end reporting by
//     mistake one day still cannot count a call twice.
//
// HOW IT HEARS THE ENDING: the transport's `onLive(false, { reason })` (call_transport.js), which comes BEFORE `onEnded`
// - the owner of a call (the caller page, a Call panel) tears the transport down in its `onEnded`, and a listener added
// any other way would be gone before the ending reached it.

import { authHeaders } from './auth.js';

export const CALL_OUTCOME_PATH = '/api/call/outcome';

/**
 * How a call that ENDED counts. Pure. 'failed' when it could not connect: never connected ('unconnected'), or lost
 * before it ever connected ('stalled' with `connected` false). Anything else (declined, no answer, hung up, lost after
 * it had connected) is not a connection failure: null.
 */
export function failedEnding(reason, connected) {
  return reason === 'unconnected' || (reason === 'stalled' && !connected) ? 'failed' : null;
}

/**
 * Watch one CALLER's transport and report each of its calls once: `report('direct' | 'failed', session)`. Attach it
 * before the call is placed. Returns a function that stops watching. A transport without `onLive` / `onConnection`
 * (an older one, a suite's fake) is simply not counted.
 */
export function watchCallOutcome(transport, report) {
  if (!transport || typeof report !== 'function') return () => {};
  let session = null;
  let connected = false;
  let sent = false;
  const sessionNow = () => { try { return transport.__probe?.().session || null; } catch { return null; } };
  function begin(s) {
    if (!s || s === session) return;
    session = s; connected = false; sent = false;           // a new call on the same transport: counted on its own
  }
  function send(outcome) {
    if (sent) return;
    const s = session || sessionNow();
    if (!s) return;
    sent = true;
    try { report(outcome, s); } catch (err) { console.error('call outcome', err); }
  }
  const offs = [
    transport.onLive?.((on, info) => {
      if (on) { begin(sessionNow()); return; }
      if (failedEnding(info && info.reason, connected)) send('failed');
    }),
    transport.onAnswered?.((a) => { if (a && typeof a.session === 'string') begin(a.session); }),
    transport.onConnection?.((st) => {
      if (st !== 'connected' || connected) return;
      connected = true;
      send('direct');
    }),
  ];
  return () => { for (const off of offs) { try { off?.(); } catch { /* gone */ } } };
}

/** The report itself: POST the outcome and the call's session, as the login on this page. Fire and forget. */
export function postCallOutcome({ fetchImpl = (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null), base = '', user = null } = {}) {
  return (outcome, session) => {
    if (!fetchImpl) return;
    try {
      Promise.resolve(fetchImpl(`${base}${CALL_OUTCOME_PATH}`, { method: 'POST', credentials: 'same-origin',
        headers: { ...authHeaders(user), 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome, session }) }))
        .catch(() => {});
    } catch { /* counted nowhere: nothing lost for the call */ }
  };
}
