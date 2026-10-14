// screen_switch.js - CHANGING DASHBOARD FROM THE SCREEN IS AN ACTUAL SWITCH (row 2.89, Mike 2026-10-14 via chat CB).
//
// Mike: *"It should be opening the dashboard the same as if you went back to the dashboards page. We probably need to
// make sure it's also not just stacking dashboards on top of each other. It should be an actual switch."* Seen on the
// bench: his YouTube dashboard, reached from the bar, said "No videos yet" (from the dashboards page it played); and
// Pictures reached from YouTube had a solid background behind the pictures, not its see-through one.
//
// WHY: the bar's switch was IN PLACE (kiosk.js `showScreen`): only the arrangement and its modules changed, and the
// handle on the screen the page was OPENED on - its theme, its panel look, its "every <kind> panel" settings - stayed,
// on purpose, written in kiosk.js. So the incoming dashboard was drawn with the first one's look and settings.
//
// THE CHOICE, ARGUED (chat CB; Mike's words above):
//   A. The switch is the SAME LOAD the dashboards page does: `kiosk.html?profile=<id>`. FOR: identical by
//      construction - nothing of the old dashboard can leak, and a test compares two addresses; nothing stacks.
//      AGAINST: a second of loading; the way Back and Home has to be carried across it (below); a live call would drop.
//   B. Mend the in-place swap so it re-points everything. FOR: no reload. AGAINST: the opened-on handle is read in many
//      places, and the next one added drifts the same way - patching the same thing many ways.
//   TAKEN: A as the rule. In place only WHILE SOMETHING LIVE IS RUNNING - a call, the intercom, a quiet check-in (chat:
//   keeping the call and the camera alive across a switch is still worth keeping) - where a reload would cut a person
//   off. The state machine's own swaps (`kiosk/show`, a call's screen) stay in place, as they were.
//
// CARRIED ACROSS THE LOAD (sessionStorage: this tab only, gone with the browser): the trail (for Back and the crumbs),
// the dashboard this screen started on (for Home), and the names the crumbs show. Read once, by the page it was
// written for, within TRAIL_FRESH_MS - a stale record from an old switch is never applied to a later page.
// The launcher's own address parts (`lockHelper`, `localVoice`) go with the switch; its `boot=1` does not (a switch is
// not a restart, restart.js).

export const TRAIL_KEY = 'nimrod.kiosk.trail';
// Two minutes: a load takes seconds, even on a Pi on a slow network; long enough for a slow one, short enough that a
// record left by a switch that never landed cannot be picked up by a later page.
export const TRAIL_FRESH_MS = 2 * 60 * 1000;
// What the Pi launcher put on the address that a switched-to page must keep (restart.js KEPT_AFTER_PAIRING, minus boot).
export const KEPT_ON_SWITCH = Object.freeze(['lockHelper', 'localVoice']);

/** The address the dashboards page opens a dashboard with, plus the launcher's parts from `search`. Pure. */
export function switchURL(id, search = '') {
  let p;
  try { p = new URLSearchParams(search || ''); } catch { p = new URLSearchParams(); }
  const keep = KEPT_ON_SWITCH.filter((k) => p.get(k)).map((k) => `&${k}=${encodeURIComponent(p.get(k))}`).join('');
  return `kiosk.html?profile=${encodeURIComponent(String(id || ''))}${keep}`;
}

/** Reload, or in place? In place when embedded, when the host did not ask for reloads, or while `live` names something
 * running (a call, the intercom, a check-in). Pure. */
export function switchesByReload({ reload = false, embedded = false, live = null } = {}) {
  return !!reload && !embedded && !live;
}

const sess = (s) => s || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
const cleanIds = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []);

/** Before the load: where we are going, the trail it will have, Home, and the crumbs' names. */
export function writeTrail({ to, stack = [], home = '', names = {} } = {}, { session, now = Date.now() } = {}) {
  const s = sess(session);
  if (!s || !to) return false;
  const rec = { to: String(to), stack: cleanIds(stack), home: typeof home === 'string' ? home : '',
    names: Object.fromEntries(Object.entries(names || {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')),
    at: Number(now) };
  try { s.setItem(TRAIL_KEY, JSON.stringify(rec)); return true; } catch { return false; }
}

/** After it, once: the record when it was written for `profileId` and is fresh, else null. Always removed as read. */
export function takeTrail(profileId, { session, now = Date.now() } = {}) {
  const s = sess(session);
  if (!s) return null;
  let rec = null;
  try { rec = JSON.parse(s.getItem(TRAIL_KEY) || 'null'); } catch { rec = null; }
  try { if (typeof s.removeItem === 'function') s.removeItem(TRAIL_KEY); else s.setItem(TRAIL_KEY, ''); } catch { /* read once is enough */ }
  if (!rec || typeof rec !== 'object' || rec.to !== profileId) return null;
  const age = Number(now) - Number(rec.at);
  if (!Number.isFinite(age) || age < 0 || age > TRAIL_FRESH_MS) return null;
  return { stack: cleanIds(rec.stack).filter((id) => id !== profileId), home: typeof rec.home === 'string' ? rec.home : '',
    names: rec.names && typeof rec.names === 'object' ? rec.names : {} };
}
