// sky.js — THE SKY OUTSIDE, FOLLOWED: a screen's live wallpaper shows the time of day and the weather
// where it is, and "With the seasons" turns over on its own at midnight. The live half of seasons.js.
//
// Mike, 2026-10-05: "the weather the user connects and clock will effect the live wallpaper. So if it's
// night and raining where you are it will be night and raining on your live wallpaper."
//
// WHERE THE WEATHER COMES FROM: the Weather panel's own reading. modules/weather.js already fetches the
// forecast for the place somebody typed into it, and says so on the bus (`weather/now`) for the room's
// window; this listens to the same message. NO NEW REQUEST, NO NEW SERVICE, NO KEY, and nothing at all
// without a Weather panel on the screen - then the wallpaper follows only the clock. (A place set for the
// whole screen rather than in a panel is a later step; on Mike's list.)
//
// WHAT IT DOES WITH IT, once a minute and whenever the weather or a setting changes:
//   * the time of day (seasons.js timeOfDay): the real sunrise and sunset at the weather's place, or this
//     device's clock and fixed hours with no place;
//   * the weather (seasons.js weatherKind), while the reading is under three hours old - the same "keep
//     the last good reading through an outage" rule as live_weather.js, after which the sky clears;
//   * tells the page's theme scenes (livescene.js setSceneSky), which re-draw only when it changed;
//   * keeps seasons.js's context (the hemisphere, holidays on or off) and calls `onTheme` when what
//     "With the seasons" paints has changed (a new day, a holiday starting, the place arriving).
//
// A HIDDEN PAGE DOES NO WORK: the minute's check is skipped while the document is hidden, and runs once
// the moment it is shown again. (The scene's own movement is CSS; a hidden page paints nothing.)

import { timeOfDay, weatherKind, setSeasonContext, seasonContext, resolveSeasonal } from './seasons.js';
import { setSceneSky } from './livescene.js';

export const SKY_FOLLOW_KEY = 'skyFollow';
export const HOLIDAYS_KEY = 'holidayLooks';
export const SKY_MODES = Object.freeze(['both', 'weather', 'time', 'off']);
// How long a weather reading counts: live_weather.js's STALE_MS, so the site has one answer.
export const WEATHER_FRESH_MS = 3 * 60 * 60 * 1000;
// How often the time of day is re-checked. Dawn and dusk are an hour wide; a minute is plenty, and the
// check is a little arithmetic.
export const SKY_TICK_MS = 60 * 1000;

/**
 * "Wallpaper follows the sky outside" - ONE row, a choice, rather than two on/off rows: every row is a
 * stop on a one-switch walk through the menu. Default: the weather AND the time of day, argued:
 *   FOR: it is what was asked for; it only shows on a moving scene that answers to it (seasons.js
 *   SCENE_SKY), and only darkens, so words on it get easier to read, not harder; with no Weather panel
 *   the weather half simply has nothing to say. A darker screen at night is also the gentler one.
 *   AGAINST: a scene picked for how it looks now changes by itself - which is what "Neither" is for.
 */
export const SKY_FIELD = Object.freeze({
  key: SKY_FOLLOW_KEY, label: 'Wallpaper follows the sky outside', kind: 'choice', level: 'standard', default: 'both',
  note: 'A moving scene shows the time of day, and the weather from a Weather panel on this screen.',
  options: [
    { value: 'both', label: 'The weather and the time of day' },
    { value: 'weather', label: 'Just the weather' },
    { value: 'time', label: 'Just the time of day' },
    { value: 'off', label: 'Neither' },
  ],
});

/** "Holiday looks", beside "With the seasons" (seasons.js argues the default and the dates). */
export const HOLIDAY_FIELD = Object.freeze({
  key: HOLIDAYS_KEY, label: 'Holiday looks', kind: 'toggle', level: 'standard', default: true,
  onLabel: 'On', offLabel: 'Off',
  note: 'With the seasons, a holiday look on its dates - Halloween from October 15 to 31.',
});

export const skyModeOf = (v) => (SKY_MODES.includes(v) ? v : SKY_FIELD.default);
export const holidaysOn = (v) => v !== false;

/**
 * The sky to draw, from a reading and the time. Pure, so the suite checks it without a bus or a clock.
 *   reading  the last `weather/now` ({ code, icon, isDay, lat, lon, at }), or null
 *   mode     SKY_MODES
 * Returns { time, weather, lat, lon }.
 */
export function skyFrom(reading, { now = Date.now(), mode = 'both' } = {}) {
  const r = reading && typeof reading === 'object' ? reading : null;
  const fresh = !!r && Number.isFinite(r.at) && now - r.at <= WEATHER_FRESH_MS;
  // The place does not go stale: a town is where it was, even when its forecast is old.
  const lat = r && Number.isFinite(r.lat) ? r.lat : null;
  const lon = r && Number.isFinite(r.lon) ? r.lon : null;
  const m = skyModeOf(mode);
  const time = m === 'both' || m === 'time'
    ? timeOfDay(new Date(now), { lat, lon, isDay: fresh && typeof r.isDay === 'boolean' ? r.isDay : undefined }) : null;
  const weather = (m === 'both' || m === 'weather') && fresh ? weatherKind(r) : null;
  return { time, weather, lat, lon };
}

/**
 * Follow the sky for a screen.
 *   bus        the screen's bus (`weather/now` arrives on it)
 *   read()     the screen's settings row ({ skyFollow, holidayLooks })
 *   subscribe  (fn) => off: told when that row changes (optional)
 *   onTheme()  "With the seasons" now paints something else: re-apply the theme
 * Returns { sync(), stop(), get state(), get reading() }.
 */
export function followSky({ bus, read = () => ({}), subscribe = null, onTheme = null, now = () => Date.now(),
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (id) => clearTimeout(id),
  doc = (typeof document !== 'undefined' ? document : null), tickMs = SKY_TICK_MS, setSky = setSceneSky } = {}) {
  let reading = null;
  let state = null;
  let seasonKey = null;
  let timer = null;
  let stopped = false;
  const offs = [];

  const seasonal = () => {
    const ctx = seasonContext();
    const r = resolveSeasonal(new Date(now()), { ...ctx, has: () => true });   // the key, not the theme
    return `${r.key}`;
  };
  seasonKey = seasonal();

  function sync() {
    if (stopped) return;
    if (timer != null) { clearTimer(timer); timer = null; }
    timer = setTimer(sync, tickMs);
    if (doc && doc.hidden) return;                         // nothing to look at; caught up on show
    let cfg = {};
    try { cfg = read() || {}; } catch { cfg = {}; }
    const next = skyFrom(reading, { now: now(), mode: cfg[SKY_FOLLOW_KEY] });
    state = next;
    try { setSky({ time: next.time, weather: next.weather }); } catch (err) { console.error('sky: scene', err); }
    setSeasonContext({ lat: next.lat, holidays: holidaysOn(cfg[HOLIDAYS_KEY]) });
    const key = seasonal();
    if (key !== seasonKey) {
      seasonKey = key;
      try { onTheme?.(); } catch (err) { console.error('sky: theme', err); }
    }
  }

  try {
    if (bus?.subscribe) {
      offs.push(bus.subscribe('weather/now', (p) => {
        if (!p || typeof p !== 'object') return;
        // `at` is when the panel last got the weather; a reading without one counts from now.
        reading = { code: p.code, icon: p.icon, isDay: p.isDay, lat: p.lat, lon: p.lon,
          at: Number.isFinite(p.at) ? p.at : now() };
        sync();
      }));
    }
  } catch (err) { console.error('sky: weather', err); }
  try { const off = subscribe?.(() => sync()); if (typeof off === 'function') offs.push(off); } catch { /* no row to follow */ }
  const onVis = () => { if (doc && !doc.hidden) sync(); };
  try { doc?.addEventListener?.('visibilitychange', onVis); } catch { /* no document */ }
  sync();

  return {
    sync,
    get state() { return state ? { ...state } : null; },
    get reading() { return reading ? { ...reading } : null; },
    stop() {
      stopped = true;
      if (timer != null) clearTimer(timer);
      timer = null;
      while (offs.length) { try { offs.pop()(); } catch { /* gone */ } }
      try { doc?.removeEventListener?.('visibilitychange', onVis); } catch { /* no document */ }
      // The page's scenes go back to no sky: nothing is following it any more.
      try { setSky(null); } catch { /* the scene can keep it */ }
    },
  };
}
