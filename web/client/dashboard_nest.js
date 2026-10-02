// dashboard_nest.js — DASHBOARDS INSIDE DASHBOARDS, AND THE WAY BACK OUT (row 2.38, first piece).
//
// Mike, 2026-09-30: *"A map would just be another sort of customizable dashboard where the scene objects
// open different dashboards. So recursion. Like you could have a dashboard on a billboard or something
// that you could click into. Any object in any scene could really be like that. Turtles all the way up.
// Turtles all the way down."*
//
// Chat's five safety notes (room_as_home §7.3), and where each one lives:
//   1. CYCLES ARE ALLOWED. Nothing assumes it reaches the bottom: every nested dashboard counts its depth
//      (`nestDepth`, the screen itself is 0) and past the live limit draws a CARD that mounts nothing --
//      so a dashboard holding itself stops at the limit (modules/view.js; dashboard_nest_test proves it).
//   2. LIVE RENDERING STOPS AT A DEPTH (`nestLiveDepth`, below). Deeper levels are a labelled card until
//      pressed.
//   3. CLICKING IN IS A SCREEN SWAP: an object, a placed module or a nested dashboard publishes
//      `dashboard/go { id }`, which the kiosk already answers with its load-then-swap (`showScreen`).
//   4. THE WAY BACK IS ALWAYS THERE: a breadcrumb on screen while you are inside something (pointer),
//      Back and Home in the dashboards tray (scan), `kiosk/back` / `kiosk/home` as bindable actions
//      (a switch), and "go back" / "go home" (voice).
//   5. SEVERAL SCREENS (an avatar walking to another device) is NOT built here; see the report.
//
// This file is the light, shared part: constants, the two settings, and pure helpers. It imports
// nothing, so room_scene.js, arrangement.js and view.js can all use it without pulling in speech.

/** "Show dashboard <id> here": `{ id }` or `{ prebuilt }` (dashboards.js re-exports it). */
export const DASHBOARD_GO_TOPIC = 'dashboard/go';
/** Back along the trail, and Home (the dashboard this screen started on). kiosk.js answers both. */
export const SCREEN_BACK_TOPIC = 'kiosk/back';
export const SCREEN_HOME_TOPIC = 'kiosk/home';
/** What a SWITCH's `select` reaches on a nested dashboard (actions.js MODULE_VERBS.dashboard). */
export const NEST_OPEN_TOPIC = 'dashboard/open';
/** A placed module that carries `opens`: the router routes it as this type (arrangement.js `focusRing`),
 *  so `select` on it publishes OPENS_PRESS_TOPIC on that instance, and the arrangement opens the door. */
export const OPENS_TYPE = 'opens';
export const OPENS_PRESS_TOPIC = 'opens/press';

// =====================================================================================================
// SETTING 1: HOW MANY LEVELS OF DASHBOARD-INSIDE-A-DASHBOARD ARE DRAWN LIVE.
//
// Counted from the screen: 1 = a dashboard on the screen's billboard is live, 2 = and one on ITS
// billboard too. Deeper than the setting, each is a card (its name and what is on it) until pressed.
// 0 = no live nesting at all: every one is a card.
//
// DEFAULT 1 -- chat guessed 2; MEASURED, and changed. dashboard_nest_test's "cost" section, a dashboard
// holding ITSELF, frames drawn per second:
//                         live levels:   0     1     2     3
//   bench Pi 400 (cici1), a ROOM          54    39    22    18   (up in 0.8 / 0.7 / 1.2 / 1.8 s)
//   bench Pi 400 (cici1), a grid          61    61    61    61   (clock + itself; up in 55-230 ms)
//   desktop, headless Chrome, either      57-59 throughout          (DOM: +49 nodes a grid level, +340 a room)
// (2026-10-01; the bench was already at load average 4.5 before the browser started, so the Pi rows are
// on the pessimistic side.) A grid inside a grid costs nothing worth counting; a ROOM inside a room costs
// a live window scene and its art per level, and at 2 the Pi falls to 22 frames a second for anything
// moving on that screen. FOR 2 (chat's): the "turtles" picture -- a room whose billboard shows a room
// whose billboard moves too. FOR 1, and it wins: the screen this is built for is a Pi 400, 39 fps is
// smooth and 22 is visibly not, and the second level is a card that one press turns into the real thing.
// A faster screen sets 2 or more. The limit is a SETTING on the screen's row (the device is what pays),
// not the person's.
// =====================================================================================================
export const NEST_LIVE_DEPTH_KEY = 'nestLiveDepth';
export const NEST_LIVE_DEPTH_DEFAULT = 1;
// The top of the menu's range, not a safety cap: the card below the limit is what stops a cycle, so any
// whole number works. Four is where the menu stops offering, because by then each copy is a few pixels.
export const NEST_LIVE_DEPTH_MAX = 4;
export const NEST_LIVE_DEPTH_FIELD = Object.freeze({
  key: NEST_LIVE_DEPTH_KEY,
  label: 'Dashboards shown inside other dashboards: how many levels move live',
  kind: 'choice', level: 'advanced', default: NEST_LIVE_DEPTH_DEFAULT,
  options: Object.freeze([
    { value: 0, label: 'None: show a card for each' },
    { value: 1, label: 'One level' },
    { value: 2, label: 'Two levels' },
    { value: 3, label: 'Three levels' },
    { value: 4, label: 'Four levels' },
  ]),
});

/** The live limit from a settings row (anything not a whole number 0..MAX is the default). */
export function nestLiveDepthFrom(row) {
  const v = row && row[NEST_LIVE_DEPTH_KEY];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n <= NEST_LIVE_DEPTH_MAX ? n : NEST_LIVE_DEPTH_DEFAULT;
}

/** How a dashboard at `depth` is drawn: 'live' or 'card'. The screen itself (depth 0) is always live. */
export function nestMode(depth, limit = NEST_LIVE_DEPTH_DEFAULT) {
  const d = Number.isInteger(depth) && depth > 0 ? depth : 0;
  if (d === 0) return 'live';
  const lim = Number.isInteger(limit) && limit >= 0 ? limit : NEST_LIVE_DEPTH_DEFAULT;
  return d <= lim ? 'live' : 'card';
}

// =====================================================================================================
// SETTING 2: HOW LONG THE DASHBOARDS TRAY STAYS OPEN WITH NOBODY PRESSING.
//
// It used to close with the bar's own 3 s. Every press on it restarts the wait, so the number is the gap
// BETWEEN presses that a person is allowed -- and input_scan.js's header is the argument for it: "the
// step is set by how long a response takes ... Somebody can follow the question perfectly and still need
// fifteen seconds to signal an answer." DEFAULT 15 s, the same response time the scan carries
// (SCAN_DEFAULTS.stepMs). FOR: a slow switch user is not shut out of their own tray between presses.
// AGAINST: somebody with a mouse who opens it and walks off sees the bar and the tray for 15 s instead
// of 3. "With the bar (3 seconds)" is the old behaviour, one choice away. LEVEL `advanced` ("Everything"),
// not "The usual": with the 15 s default the slow switch user is already served, so this is set once, and
// one more stop ahead of Home on every one-switch walk through the menu is the cost the mixer's rows
// were kept off that walk for (kiosk.js). "Until it is closed" passes the
// what-if-nobody-answers test (CLAUDE.md): the tray is a strip, not a scrim, so the panels keep playing
// and stay visible under it; Close is its first stop.
// (A literal here rather than an import of input_scan.js, so this file stays import-free; the suite
// checks the two agree.)
// =====================================================================================================
export const TRAY_OPEN_KEY = 'dashboardTrayMs';
export const TRAY_OPEN_DEFAULT_MS = 15000;
export const BAR_HIDE_MS = 3000;
export const TRAY_OPEN_FIELD = Object.freeze({
  key: TRAY_OPEN_KEY,
  label: 'Keep the dashboards tray open, with nobody pressing, for',
  kind: 'choice', level: 'advanced', default: TRAY_OPEN_DEFAULT_MS,
  options: Object.freeze([
    { value: BAR_HIDE_MS, label: '3 seconds (with the bar)' },
    { value: 10000, label: '10 seconds' },
    { value: 15000, label: '15 seconds' },
    { value: 30000, label: '30 seconds' },
    { value: 60000, label: '1 minute' },
    { value: 0, label: 'Until it is closed' },
  ]),
});

/** The tray's wait from a settings row, in ms. 0 = until it is closed. */
export function trayOpenMsFrom(row) {
  const v = row && row[TRAY_OPEN_KEY];
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n <= 600000 ? n : TRAY_OPEN_DEFAULT_MS;
}

// =====================================================================================================
// THE TRAIL (the breadcrumb). The back stack is a TRAIL, not a log of every swap:
// going to a dashboard that is already on the trail goes BACK to it (the trail is cut there), so a
// cycle -- room A's door to B, B's door back to A -- never grows it, and the breadcrumb always reads as
// "where you are", never as history. Pure, so the kiosk and the suite run the same rule.
// =====================================================================================================

/** The trail after a swap from `from` to `next` (the stack excludes the current dashboard). */
export function trailAfter(stack, from, next) {
  const s = Array.isArray(stack) ? stack.slice() : [];
  const at = s.indexOf(next);
  if (at >= 0) return s.slice(0, at);
  if (from) s.push(from);
  return s;
}

/** A dashboard id as something a breadcrumb can say. */
export function crumbName(id, names) {
  const n = names && typeof names.get === 'function' ? names.get(id) : names && names[id];
  return typeof n === 'string' && n.trim() ? n.trim() : 'Dashboard';
}

/**
 * THE BREADCRUMB, drawn into `el` (the kiosk's): "⌂ Home › Room › Desk", shown only while the trail is
 * longer than one (at the top it would say only where you already are). Earlier crumbs are buttons that
 * go straight back to that level; the last one is where you are. Pointer only by design -- a switch
 * reaches Back and Home through the dashboards tray (its first stops after Close), so the breadcrumb is
 * never one more stop in the scan of every screen.
 *   onJump(id, steps)   a crumb `steps` levels up was pressed
 */
export function createBreadcrumb(el, { onJump } = {}) {
  const doc = el.ownerDocument || document;
  el.classList.add('k-crumbs');
  el.setAttribute('aria-label', 'where you are');
  el.style.cssText = 'position:absolute;top:8px;left:8px;z-index:calc(var(--z-floating, 400) + 10);'
    + 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;max-width:calc(100% - 16px);'
    + 'padding:4px 8px;border-radius:12px;background:var(--surface, #fffdf3);color:var(--text, #0A3323);'
    + 'box-shadow:0 1px 6px rgba(0,0,0,.18);font:600 clamp(14px,1.8vmin,18px)/1.2 -apple-system,'
    + 'BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;pointer-events:auto';
  el.hidden = true;
  let trail = [];
  const onClick = (e) => {
    const b = e.target.closest?.('button[data-crumb]');
    if (!b || !el.contains(b)) return;
    const i = Number(b.dataset.crumb);
    if (!Number.isInteger(i) || !trail[i]) return;
    onJump?.(trail[i].id, trail.length - 1 - i);
  };
  el.addEventListener('click', onClick);
  function draw(list) {
    trail = Array.isArray(list) ? list.filter((t) => t && t.id) : [];
    el.textContent = '';
    el.hidden = trail.length < 2;
    if (el.hidden) return;
    trail.forEach((t, i) => {
      if (i) {
        const sep = doc.createElement('span');
        sep.textContent = '›';
        sep.setAttribute('aria-hidden', 'true');
        sep.style.opacity = '0.6';
        el.append(sep);
      }
      const label = i === 0 ? `⌂ ${t.name}` : t.name;
      if (i === trail.length - 1) {
        const here = doc.createElement('span');
        here.textContent = label;
        here.setAttribute('aria-current', 'location');
        here.style.padding = '0 6px';
        el.append(here);
        return;
      }
      const b = doc.createElement('button');
      b.type = 'button';
      b.dataset.crumb = String(i);
      b.textContent = label;
      b.title = i === 0 ? 'go home' : `back to ${t.name}`;
      b.style.cssText = 'min-height:44px;padding:0 10px;border:0;border-radius:10px;cursor:pointer;'
        + 'background:transparent;color:inherit;font:inherit;text-decoration:underline';
      el.append(b);
    });
  }
  return {
    draw,
    trail: () => trail.map((t) => ({ ...t })),
    destroy() { el.removeEventListener('click', onClick); el.textContent = ''; el.hidden = true; },
  };
}
