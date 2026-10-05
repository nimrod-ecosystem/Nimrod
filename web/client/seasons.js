// seasons.js — "WITH THE SEASONS": a theme that changes through the year, and the sky outside as a
// state a live scene can show. Pure data and pure functions: no DOM, no network, no timers. The live
// half (listening for the weather, the clock that re-checks) is sky.js; the drawing is livescene.js.
//
// Mike, 2026-10-05: "have it so you can set your theme to weather and it will show the theme for the
// season. Maybe we could even add holiday ones starting with Halloween bc that's coming up. Then the
// weather the user connects and clock will effect the live wallpaper. So if it's night and raining
// where you are it will be night and raining on your live wallpaper."
//
// *** EVERYTHING DESIGN WILL CHANGE IS DATA, AND EACH CHANGE IS ONE ENTRY. ***
//   * A season or a holiday NAMES the theme it wants (`theme`) and what to wear until that theme
//     exists (`fallback`). The day Design's Spring lands in live_themes.js as `spring`, the Spring
//     entry below starts using it — nothing here changes. Today Spring, Summer and Halloween fall back.
//   * A holiday's dates are an entry in HOLIDAYS (`from`/`to`, month-day), not a branch in the code.
//   * Which scenes answer to the weather and the time of day, and how, is SCENE_SKY.
//
// GUESSES, each on Mike's list with the case for the opposite (see the report for 2026-10-05):
//   1. Meteorological seasons (whole months: spring is March-May), not the equinoxes. FOR: whole months
//      are what weather services use and easy to predict ("it changes on the 1st"). AGAINST: US
//      calendars print Sept 22 as the first day of fall. Changing it is SEASON_STARTS, four dates.
//   2. The hemisphere comes from the place the weather is for (its latitude); with no place, north.
//   3. Halloween runs October 15-31. FOR: a two-week run-up is how most homes decorate, long enough
//      to be noticed, short enough that Fall keeps most of October. AGAINST: shops start on the 1st;
//      or a single week keeps it more of an event. One entry: HOLIDAYS[0].from.
//   4. Holiday looks default ON. FOR: they only ever show to somebody who picked "With the seasons",
//      a choice that already says "change through the year". AGAINST: not everybody keeps Halloween,
//      and spooky pictures can upset somebody - which is why it is a switch, beside the theme.

// ---------------------------------------------------------------------------------------------
// THE CHOICE ITSELF
// ---------------------------------------------------------------------------------------------

/** Themes that are not a palette but a rule for picking one. theme.js lists these after the real ones. */
export const FOLLOW_THEMES = Object.freeze({
  seasons: { label: 'With the seasons — changes through the year' },
});
export const isFollowThemeId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(FOLLOW_THEMES, id);

// ---------------------------------------------------------------------------------------------
// SEASONS AND HOLIDAYS, AS DATA
// ---------------------------------------------------------------------------------------------

/** The day each season starts in the NORTHERN hemisphere, month-day. South is the same, six months on. */
export const SEASON_STARTS = Object.freeze({ spring: '03-01', summer: '06-01', fall: '09-01', winter: '12-01' });

/**
 * What each season wears. `theme`: the theme it wants (a key of theme.js THEMES). `fallback`: what to
 * wear until that theme exists - a theme that does, plus any overlays (livescene.js) on top of it.
 *
 * TODAY'S FALLBACKS, argued (Design is drawing the real ones, private note 32):
 *   spring  -> Cozy + Blossom petals: the light, green window seat, with the overlay Design already
 *              drew as "the spring counterpart to falling leaves".
 *   summer  -> Cozy + a butterfly now and then: the same light room, a different visitor, so the two
 *              do not look identical. AGAINST: Warm (amber, still) is sunnier but has no scene at all.
 *   fall, winter -> their own live themes, which exist.
 */
export const SEASON_LOOKS = Object.freeze({
  spring: { label: 'Spring', theme: 'spring', fallback: { theme: 'cozy', overlays: ['petals'] } },
  summer: { label: 'Summer', theme: 'summer', fallback: { theme: 'cozy', overlays: ['butterfly'] } },
  fall:   { label: 'Fall',   theme: 'fall',   fallback: { theme: 'fall', overlays: [] } },
  winter: { label: 'Winter', theme: 'winter', fallback: { theme: 'winter', overlays: [] } },
});

/**
 * Holidays, checked before the season. `from`/`to` are month-day and INCLUSIVE; a window that wraps the
 * new year (`12-20` to `01-02`) works. First match wins, so a short holiday inside a long one goes first.
 * Halloween falls back to Night + the black cat and the moon until Design's own Halloween exists.
 */
export const HOLIDAYS = Object.freeze([
  { id: 'halloween', label: 'Halloween', from: '10-15', to: '10-31',
    theme: 'halloween', fallback: { theme: 'night', overlays: ['cat', 'moon'] } },
]);

// ---------------------------------------------------------------------------------------------
// DATES
// ---------------------------------------------------------------------------------------------

const md = (s) => { const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim()); return m ? (+m[1]) * 100 + (+m[2]) : null; };
/** A date's month-day as a number (Oct 5 -> 1005), from this device's own calendar. */
export const monthDay = (date) => (date.getMonth() + 1) * 100 + date.getDate();

/** Is `date` inside the inclusive month-day window from..to? Handles a window that wraps the year. */
export function inWindow(date, from, to) {
  const a = md(from), b = md(to), d = monthDay(date);
  if (a == null || b == null) return false;
  return a <= b ? (d >= a && d <= b) : (d >= a || d <= b);
}

/** 'north' or 'south', from a latitude. No latitude (or the equator itself): north. */
export const hemisphereOf = (lat) => (Number.isFinite(Number(lat)) && lat !== null && lat !== '' && Number(lat) < 0 ? 'south' : 'north');

/** Which season `date` is in. The south runs six months on from the north. */
export function seasonFor(date, { hemisphere = 'north', starts = SEASON_STARTS } = {}) {
  const order = ['spring', 'summer', 'fall', 'winter'];
  const d = monthDay(date);
  // The latest start on or before today, wrapping to the last one of the year (winter before March).
  const sorted = order.map((id) => [id, md(starts[id])]).filter(([, v]) => v != null).sort((x, y) => x[1] - y[1]);
  let north = sorted.length ? sorted[sorted.length - 1][0] : 'fall';
  for (const [id, v] of sorted) if (d >= v) north = id;
  if (hemisphere !== 'south') return north;
  return order[(order.indexOf(north) + 2) % 4];
}

/** The holiday `date` falls in, or null. */
export function holidayFor(date, list = HOLIDAYS) {
  for (const h of list || []) if (h && inWindow(date, h.from, h.to)) return h;
  return null;
}

/**
 * What "With the seasons" wears on `date`.
 *   lat       where the weather is for (for the hemisphere), or null
 *   holidays  holiday looks on (default) or off
 *   has(id)   does theme `id` exist? (theme.js passes `id => !!THEMES[id]`)
 * Returns { key, label, kind: 'holiday'|'season', theme, overlays, wanted, fellBack }.
 */
export function resolveSeasonal(date, { lat = null, holidays = true, has = () => false,
  seasons = SEASON_LOOKS, holidayList = HOLIDAYS, starts = SEASON_STARTS, last = 'default' } = {}) {
  const h = holidays ? holidayFor(date, holidayList) : null;
  const key = h ? h.id : seasonFor(date, { hemisphere: hemisphereOf(lat), starts });
  const entry = h || seasons[key] || {};
  const pick = (want, fb) => {
    if (want && has(want)) return { theme: want, overlays: [...(entry.overlays || [])], fellBack: false };
    if (fb && fb.theme && has(fb.theme)) return { theme: fb.theme, overlays: [...(fb.overlays || [])], fellBack: true };
    return { theme: last, overlays: [], fellBack: true };
  };
  const got = pick(entry.theme, entry.fallback);
  return { key, label: entry.label || key, kind: h ? 'holiday' : 'season', wanted: entry.theme || null, ...got };
}

// The context the page is in: where (for the hemisphere) and whether holidays are on. sky.js keeps it
// up to date on a screen; a page with no screen (the landing page) gets north, holidays on.
let CONTEXT = { lat: null, holidays: true };
export const seasonContext = () => ({ ...CONTEXT });
export function setSeasonContext(patch = {}) {
  const next = { ...CONTEXT };
  if ('lat' in patch) next.lat = Number.isFinite(Number(patch.lat)) && patch.lat !== null && patch.lat !== '' ? Number(patch.lat) : null;
  if ('holidays' in patch) next.holidays = patch.holidays !== false;
  const changed = next.lat !== CONTEXT.lat || next.holidays !== CONTEXT.holidays;
  CONTEXT = next;
  return changed;
}

// ---------------------------------------------------------------------------------------------
// THE TIME OF DAY
// ---------------------------------------------------------------------------------------------

export const TIMES = Object.freeze(['dawn', 'day', 'dusk', 'night']);

/**
 * Dawn and dusk, around sunrise and sunset, in minutes. Dusk runs from half an hour before sunset to
 * half an hour after (about when the sky is dark, at most latitudes); dawn mirrors it.
 */
export const TWILIGHT_MIN = Object.freeze({ before: 30, after: 30 });

/**
 * With no place, the hour on this device's clock decides: when each part of the day STARTS. A guess that
 * suits mid-latitudes in spring and autumn; with a place the real sunrise and sunset are used instead.
 */
export const FIXED_TIMES = Object.freeze({ dawn: '06:00', day: '07:00', dusk: '18:30', night: '19:30' });

const rad = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = rad * 23.4397;
/**
 * Sunrise and sunset for the solar day nearest `date`, at `lat`/`lon` - the standard approximation
 * (Meeus, as SunCalc writes it), good to a minute or two, which is far finer than a dusk tint needs.
 * Returns { sunrise, sunset } in epoch ms, or { polar: 'day'|'night' } where the sun does not set or rise.
 * Null without a place.
 */
export function sunTimes(date, lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (lat == null || lon == null || !Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const lw = rad * -lo;
  const phi = rad * la;
  const d = date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = rad * -0.833;
  const x = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (x < -1) return { polar: 'day' };
  if (x > 1) return { polar: 'night' };
  const w = Math.acos(x);
  const jSet = J2000 + (0.0009 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jRise = jNoon - (jSet - jNoon);
  const toMs = (j) => (j + 0.5 - J1970) * DAY_MS;
  return { sunrise: toMs(jRise), sunset: toMs(jSet) };
}

const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };

/**
 * 'dawn' | 'day' | 'dusk' | 'night' at `date`.
 *   lat, lon  where the weather is for: the real sunrise and sunset there
 *   isDay     the weather service's own day/night for that place, used only without a position, and only
 *             to correct the fixed hours when they plainly disagree (fixed says day, the service says dark)
 */
export function timeOfDay(date, { lat = null, lon = null, isDay, twilight = TWILIGHT_MIN, fixed = FIXED_TIMES } = {}) {
  const sun = sunTimes(date, lat, lon);
  if (sun && sun.polar) return sun.polar;
  if (sun) {
    const t = date.valueOf();
    const before = (twilight.before || 0) * 60000, after = (twilight.after || 0) * 60000;
    if (t >= sun.sunrise - before && t < sun.sunrise + after) return 'dawn';
    if (t >= sun.sunset - before && t < sun.sunset + after) return 'dusk';
    if (t >= sun.sunrise + after && t < sun.sunset - before) return 'day';
    return 'night';
  }
  const now = date.getHours() * 60 + date.getMinutes();
  const starts = TIMES.map((id) => [id, hm(fixed[id])]).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
  let out = starts.length ? starts[starts.length - 1][0] : 'day';
  for (const [id, v] of starts) if (now >= v) out = id;
  if (isDay === false && out === 'day') out = 'night';
  if (isDay === true && out === 'night') out = 'day';
  return out;
}

// ---------------------------------------------------------------------------------------------
// THE WEATHER
// ---------------------------------------------------------------------------------------------

export const WEATHERS = Object.freeze(['clear', 'cloudy', 'rain', 'snow', 'fog', 'storm']);

// WMO codes (what Open-Meteo returns, and what modules/weather.js already fetches) -> a sky.
// "Partly cloudy" (2) counts as clear: some cloud is not a grey sky. Freezing rain and drizzle are rain.
const CODE_SKY = {
  clear: [0, 1, 2], cloudy: [3], fog: [45, 48],
  rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
  snow: [71, 73, 75, 77, 85, 86], storm: [95, 96, 99],
};
// The weather panel's picture names (weather_icons.js), for a reading that carries no code.
const ICON_SKY = {
  sun: 'clear', moon: 'clear', 'partly-day': 'clear', 'partly-night': 'clear', cloud: 'cloudy',
  fog: 'fog', drizzle: 'rain', rain: 'rain', sleet: 'rain', snow: 'snow', storm: 'storm',
};

/** The sky for a weather reading ({ code } or { icon }, as modules/weather.js publishes), or null. */
export function weatherKind(reading) {
  if (!reading || typeof reading !== 'object') return null;
  const c = reading.code;
  if (c != null && c !== '' && Number.isFinite(Number(c))) {
    for (const [k, list] of Object.entries(CODE_SKY)) if (list.includes(Number(c))) return k;
  }
  return ICON_SKY[reading.icon] || null;
}

// ---------------------------------------------------------------------------------------------
// WHAT A SCENE SHOWS FOR A SKY
// ---------------------------------------------------------------------------------------------

/**
 * How each sky looks, for a scene that hands it to the shared layer. `overlay`: one of livescene.js's
 * weather overlays (the same rain, snow and fog Design drew to sit on any scene). `tint`: a still,
 * darkening wash (TINTS). A storm is rain under a darker sky - NO LIGHTNING: a flash is a flash.
 */
export const SKY_LOOKS = Object.freeze({
  clear: {}, cloudy: { tint: 'cloud' }, rain: { overlay: 'rain', tint: 'cloud' },
  snow: { overlay: 'snow', tint: 'cloud' }, fog: { overlay: 'fog' }, storm: { overlay: 'rain', tint: 'storm' },
  dawn: { tint: 'dawn' }, day: {}, dusk: { tint: 'dusk' }, night: { tint: 'night' },
});

/**
 * The washes. EVERY ONE DARKENS, on purpose: they only go on dark scenes, whose words are light, so a
 * darker scene behind a panel can only make those words easier to read, never harder. Still layers:
 * no animation and no flicker. A wash changes a few times a day at most (dusk, night, the rain
 * starting), in one step - not a fade, because a fade would be an animation that motion "still"
 * freezes half way, and one change of brightness is not a flash (a flash is a pair, there and back).
 */
export const TINTS = Object.freeze({
  dawn: 'linear-gradient(180deg,rgba(62,44,78,.30) 0%,rgba(96,58,52,.14) 60%,rgba(0,0,0,0) 100%)',
  dusk: 'linear-gradient(180deg,rgba(34,24,62,.42) 0%,rgba(78,40,36,.22) 65%,rgba(18,14,28,.18) 100%)',
  night: 'linear-gradient(180deg,rgba(4,8,24,.56) 0%,rgba(4,8,20,.46) 100%)',
  cloud: 'linear-gradient(180deg,rgba(44,50,58,.38) 0%,rgba(44,50,58,.12) 55%,rgba(0,0,0,0) 100%)',
  storm: 'linear-gradient(180deg,rgba(24,28,36,.50) 0%,rgba(24,28,36,.24) 60%,rgba(24,28,36,.12) 100%)',
});

/**
 * WHICH SCENES ANSWER TO THE SKY, AND TO WHAT. A scene not listed ignores it entirely. Each list names
 * the states the SHARED layer draws for that scene; a scene that draws a state itself (Design's own
 * night, say) leaves it out, and reads it from the `data-sky-time` / `data-sky-weather` attributes on its
 * `.ls` root, or from the `sky` argument its `render(sky)` is now called with.
 *   fall       outdoors by day: every weather, every time of day.
 *   winter     already snowing at dusk: fog, cloud and night only (no second snow, no rain on snow, and
 *              no "dusk" on a scene that is dusk already).
 *   night      already night: weather only.
 *   NOT LISTED, argued: cyberpunk (it rains there always, and it is always night - a dry street needs
 *   Design's scene), cozy (a LIGHT theme: a darkening wash would be dark words on a darker room - the
 *   rain belongs on its window, which is Design's), steampunk and ocean (indoors, and under water),
 *   nimrod (a plain board ground).
 */
export const SCENE_SKY = Object.freeze({
  fall:   { weather: ['cloudy', 'rain', 'snow', 'fog', 'storm'], time: ['dawn', 'dusk', 'night'] },
  winter: { weather: ['cloudy', 'fog'], time: ['night'] },
  night:  { weather: ['cloudy', 'rain', 'snow', 'fog', 'storm'], time: [] },
});

/** Does this scene answer to the sky at all? (A settings row about it is shown only where it does.) */
export const sceneTakesSky = (scene, table = SCENE_SKY) => !!(scene && table[scene]
  && ((table[scene].weather || []).length || (table[scene].time || []).length));

/**
 * The shared layer's part for `scene` under `sky` ({ time, weather }, either may be null):
 * { overlays: [livescene overlay ids], tints: [TINTS keys] }. Empty for a scene that is not listed.
 */
export function skyLook(scene, sky, table = SCENE_SKY) {
  const e = table[scene];
  const out = { overlays: [], tints: [] };
  if (!e || !sky) return out;
  const add = (state) => {
    const look = SKY_LOOKS[state];
    if (!look) return;
    if (look.overlay && !out.overlays.includes(look.overlay)) out.overlays.push(look.overlay);
    if (look.tint && !out.tints.includes(look.tint)) out.tints.push(look.tint);
  };
  // The time of day first, so its wash sits under the weather's.
  if (sky.time && (e.time || []).includes(sky.time)) add(sky.time);
  if (sky.weather && (e.weather || []).includes(sky.weather)) add(sky.weather);
  return out;
}
