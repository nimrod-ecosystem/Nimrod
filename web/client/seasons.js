// seasons.js — "WITH THE SEASONS": a theme that changes through the year, and the sky outside as a
// state a live scene can show. Pure data and pure functions: no DOM, no network, no timers. The live
// half (listening for the weather, the clock that re-checks) is sky.js; the drawing is livescene.js.
//
// Mike, 2026-10-05: "have it so you can set your theme to weather and it will show the theme for the
// season. Maybe we could even add holiday ones starting with Halloween bc that's coming up. Then the
// weather the user connects and clock will effect the live wallpaper. So if it's night and raining
// where you are it will be night and raining on your live wallpaper."
//
// *** ONE SOURCE OF TRUTH FOR WHICH LOOK SHOWS: theme_schedule.js (Claude Design, 2026-10-05). ***
// Which season it is, which holidays there are, when each one runs (Easter and Thanksgiving computed,
// Hanukkah and Lunar New Year from the browser's own calendars, Diwali from a checked table) and what
// "Coming up" says are all Design's file, shipped as it was handed over. This file no longer keeps its
// own season starts or holiday windows (the first version, 16aeded, had Halloween as Oct 15-31 and
// whole-month seasons of its own); it asks the schedule. What stays here is OUR plumbing, which the
// schedule does not do: the hemisphere from the Weather panel's place, the time of day from the real
// sunrise and sunset, the weather from the panel's reading, and which scenes take which part of the sky.
//
// RECONCILED WITH THE SCHEDULE, each one a choice (on Mike's list as guesses, with the case for the other):
//   1. HALLOWEEN IS OCT 25-31 (Design's span), not our Oct 15-31. FOR: every holiday in the schedule runs
//      about a week, so Halloween stops being the one that eats half of fall, and one file says it. AGAINST:
//      Mike asked for Halloween first because it was coming up, and homes decorate for two weeks or more -
//      moving it back is `HOLIDAYS.halloween.span` in theme_schedule.js, one date.
//   2. THE SEASONS ARE WHOLE MONTHS (Design's seasonOf). Ours were too, so nothing moved.
//   3. NIGHT: Design's optional "night layer" swaps the whole theme to the Night scene after dark. It stays
//      OFF (Design's own default), and is not offered as a row: our darkening washes already answer the
//      time of day on the scenes that can take one (SCENE_SKY), without flipping every panel's colours
//      twice a day. AGAINST: Spring and Summer are LIGHT themes and take no wash (dark words on a darker
//      room), so they stay daylight at midnight - Design is asked to draw their own dusk and night
//      (they can read `data-sky-time`), and the night layer is one pref if Mike wants the swap instead.
//   4. WEATHER: the schedule can also add rain/snow/fog overlays from a weather code; we never pass it
//      one. Our SCENE_SKY (below) decides that per scene, and "snowing means the winter scene" stays off.
//   5. THE PIN: choosing a theme other than "With the seasons" IS the pin. The schedule's own `pin` is
//      never set.

import {
  resolve as scheduleResolve, upcoming as scheduleUpcoming, seasonOf, HOLIDAYS as SCHEDULE_HOLIDAYS,
  SCHEDULE_DEFAULTS, hanukkahNight,
} from './theme_schedule.js';

export { hanukkahNight, seasonOf };

// ---------------------------------------------------------------------------------------------
// THE CHOICE ITSELF
// ---------------------------------------------------------------------------------------------

/** Themes that are not a palette but a rule for picking one. theme.js lists these after the real ones. */
export const FOLLOW_THEMES = Object.freeze({
  seasons: { label: 'With the seasons — changes through the year' },
});
export const isFollowThemeId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(FOLLOW_THEMES, id);

// ---------------------------------------------------------------------------------------------
// SEASONS AND HOLIDAYS - asked of theme_schedule.js
// ---------------------------------------------------------------------------------------------

/** The schedule's holidays: { id: { label, scene, starter, span|test } }, in the schedule's order. */
export const HOLIDAYS = SCHEDULE_HOLIDAYS;
export const HOLIDAY_IDS = Object.freeze(Object.keys(SCHEDULE_HOLIDAYS));
/** The four seasons and what each is called. Each season's theme has the season's own id. */
export const SEASON_LOOKS = Object.freeze({
  spring: { label: 'Spring' }, summer: { label: 'Summer' }, fall: { label: 'Fall' }, winter: { label: 'Winter' },
});

/**
 * WHICH HOLIDAYS THIS SCREEN KEEPS, from what was saved:
 *   true / undefined   the schedule's starter set (Design's `starter: true`)
 *   false              none (the single "Holiday looks: Off" row of 16aeded)
 *   { id: bool }       those, the starter set filling the rest
 * Always a full { id: bool } map.
 *
 * THE STARTER SET IS THE DEFAULT, argued (a guess on Mike's list): New Year's, Valentine's, St Patrick's,
 * Easter, July 4, Halloween, Thanksgiving and Christmas on; Lunar New Year, Diwali and Hanukkah offered,
 * off. FOR: they only ever show to somebody who chose "With the seasons", a choice that already says
 * "change through the year", and each is one tick to turn off. AGAINST, two ways: Design's own note that
 * it might be better to start with NONE and ask during setup (there is no setup question yet, so "none"
 * would make the feature invisible until somebody went looking); and that the starter set keeps two
 * Christian holidays on and the Jewish, Hindu and Chinese ones off - a secular-only starter (New Year's,
 * Valentine's, St Patrick's, July 4, Halloween, Thanksgiving) is the other honest default.
 */
export function holidayPrefs(saved) {
  const starter = { ...SCHEDULE_DEFAULTS.holidays };
  if (saved === false) return Object.fromEntries(HOLIDAY_IDS.map((id) => [id, false]));
  if (saved && typeof saved === 'object') {
    for (const id of HOLIDAY_IDS) if (typeof saved[id] === 'boolean') starter[id] = saved[id];
  }
  return starter;
}

/** 'north' or 'south', from a latitude. No latitude (or the equator itself): north. */
export const hemisphereOf = (lat) => (Number.isFinite(Number(lat)) && lat !== null && lat !== '' && Number(lat) < 0 ? 'south' : 'north');

/** Which season `date` is in (theme_schedule.js: whole months, flipped in the south). */
export function seasonFor(date, { hemisphere = 'north' } = {}) { return seasonOf(date, hemisphere); }

const schedulePrefs = ({ lat = null, holidays } = {}) => ({ hemisphere: hemisphereOf(lat), holidays: holidayPrefs(holidays) });

/**
 * What "With the seasons" wears at `date`, from the schedule.
 *   lat       where the weather is for (for the hemisphere), or null
 *   holidays  what was saved (see holidayPrefs)
 *   has(id)   does theme `id` exist? (theme.js passes `id => !!THEMES[id]`)
 *   last      the theme when neither the look nor its season exists
 * Returns { key, label, kind: 'holiday'|'season', theme, overlays, wanted, fellBack, reason, night }.
 * `key` is the holiday's id or the season; `night` is Hanukkah's candle count (else null); `reason` is the
 * schedule's own sentence for the settings screen ("Halloween is on, and it wins over the fall scene.").
 */
export function resolveSeasonal(date, { lat = null, holidays, has = () => true, last = 'default' } = {}) {
  const prefs = schedulePrefs({ lat, holidays });
  const r = scheduleResolve(date, prefs, {});
  const season = seasonOf(date, prefs.hemisphere);
  const holiday = r.layer === 'holiday' ? r.holiday : null;
  const key = holiday || season;
  const label = holiday ? SCHEDULE_HOLIDAYS[holiday].label : SEASON_LOOKS[season].label;
  const theme = has(r.theme) ? r.theme : (has(season) ? season : last);
  return { key, label, kind: holiday ? 'holiday' : 'season', theme, overlays: [], wanted: r.theme,
    fellBack: theme !== r.theme, reason: r.reason, night: holiday === 'hanukkah' ? Math.max(1, hanukkahNight(date)) : null };
}

/** The look's identity at `date`: what changing means. Hanukkah's night is part of it (one more candle). */
export function seasonalKey(date, opts = {}) {
  const r = resolveSeasonal(date, opts);
  return r.night ? `${r.key}:${r.night}` : r.key;
}

const dayOf = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const MEMO = new Map();
function memo(key, fn) {
  if (MEMO.has(key)) return MEMO.get(key);
  if (MEMO.size > 64) MEMO.clear();
  const v = fn();
  MEMO.set(key, v);
  return v;
}

/**
 * The next `n` changes of look after `date`: [{ date, theme, key, label, kind }]. Design's `upcoming`,
 * remembered for the day (it walks a year of days, and a menu asks it on every paint).
 */
export function comingUp(date, { lat = null, holidays, n = 1 } = {}) {
  const prefs = schedulePrefs({ lat, holidays });
  return memo(`up|${dayOf(date)}|${n}|${JSON.stringify(prefs)}`, () => scheduleUpcoming(date, prefs, n).map((u) => {
    const key = u.holiday || seasonOf(u.date, prefs.hemisphere);
    return { date: u.date, theme: u.theme, key, kind: u.holiday ? 'holiday' : 'season',
      label: u.holiday ? SCHEDULE_HOLIDAYS[u.holiday].label : SEASON_LOOKS[key]?.label || key };
  }));
}

/**
 * The next run of holiday `id` that has not ended by `date`'s day: { from, to } (whole days, noon), or null
 * (Diwali past the end of its table). A holiday with dates (`span`) is read straight off them. Hanukkah and
 * Lunar New Year come from the browser's calendars a day at a time, so only the weeks they can fall in are
 * looked at (Hanukkah starts between late November and late December, Lunar New Year between Jan 21 and
 * Feb 20) - a year of days through Intl would cost a slow screen a second. Remembered for the day.
 */
const TEST_WEEKS = { hanukkah: [10, 20, 45], lunarNewYear: [0, 15, 45] };   // [month from 0, day, how many days]
export function holidayWindow(id, date) {
  const h = SCHEDULE_HOLIDAYS[id];
  if (!h) return null;
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return memo(`win|${id}|${dayOf(date)}`, () => {
    const noon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    const runs = [];
    const Y = date.getFullYear();
    if (typeof h.span === 'function') {
      for (const y of [Y, Y + 1, Y + 2]) for (const s of [h.span(y), h.also && h.also(y)]) if (s) runs.push(s);
    } else if (TEST_WEEKS[id]) {
      const [m, d0, n] = TEST_WEEKS[id];
      const only = { holidays: Object.fromEntries(HOLIDAY_IDS.map((k) => [k, k === id])) };
      for (const y of [Y - 1, Y, Y + 1]) {
        let from = null;
        for (let i = 0; i <= n; i += 1) {
          const d = new Date(y, m, d0 + i, 12);
          const on = scheduleResolve(d, only).holiday === id;
          if (on && !from) from = d;
          if (!on && from) { runs.push([from, new Date(y, m, d0 + i - 1, 12)]); break; }
        }
      }
    }
    const next = runs.filter((r) => r[1] >= today).sort((x, y) => x[0] - y[0])[0];
    return next ? { from: noon(next[0]), to: noon(next[1]) } : null;
  });
}

/**
 * THE SENTENCE UNDER THE COLOURS ROW while it follows the seasons: why this look, and what comes next.
 * "Halloween is on, and it wins over the fall scene. Coming up: Fall on Nov 1." The day before a change it
 * says "Tomorrow: Halloween." - Design's suggestion, so a caregiver is not surprised by the screen.
 * `lang` is the date's language (the browser's own when omitted).
 */
export function seasonsWhy(date, { lat = null, holidays, lang } = {}) {
  const r = resolveSeasonal(date, { lat, holidays });
  const next = comingUp(date, { lat, holidays, n: 1 })[0];
  if (!next) return { reason: r.reason, next: '' };
  const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const when = dayOf(next.date) === dayOf(tomorrow) ? null
    : next.date.toLocaleDateString(lang || undefined, { month: 'short', day: 'numeric' });
  return { reason: r.reason, next: when ? `Coming up: ${next.label} on ${when}.` : `Tomorrow: ${next.label}.` };
}
export function seasonsNote(date, opts = {}) {
  const w = seasonsWhy(date, opts);
  return w.next ? `${w.reason} ${w.next}` : w.reason;
}

// The context the page is in: where (for the hemisphere), which holidays, and `at` - THE MOMENT WHOSE
// LOOK IS SHOWING. A screen (sky.js) holds `at` still while a change waits for a calm moment, and moves it
// on when it lands; every theme apply on the page paints the look at `at`, so a settings change in the
// middle of a call cannot sneak the new day's look in early. Null (a page with no screen, the landing
// page): now. North, the starter holidays.
let CONTEXT = { lat: null, holidays: undefined, at: null };
export const seasonContext = () => ({ ...CONTEXT });
export function setSeasonContext(patch = {}) {
  const next = { ...CONTEXT };
  if ('lat' in patch) next.lat = Number.isFinite(Number(patch.lat)) && patch.lat !== null && patch.lat !== '' ? Number(patch.lat) : null;
  if ('holidays' in patch) next.holidays = patch.holidays === undefined ? undefined : holidayPrefs(patch.holidays);
  if ('at' in patch) next.at = Number.isFinite(patch.at) ? patch.at : null;
  const changed = next.lat !== CONTEXT.lat || JSON.stringify(next.holidays) !== JSON.stringify(CONTEXT.holidays);
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
 *
 * THE SEASONS AND HOLIDAYS (2026-10-05). Design: "rain, snow and fog always add their overlay on top of
 * whatever scene wins". So every OUTDOOR one takes the weather, and none takes a time-of-day wash (each
 * is drawn at its own hour: a holiday night is night already, and Spring and Summer are daylight scenes
 * Design is asked to give their own dusk and night). `tints: false` marks a LIGHT theme: its weather
 * comes without the darkening wash a dark one gets, for the reason cozy has none.
 *   spring, summer, easter, stPatricks, valentines, harvest   light: rain, snow, fog, storm - no wash
 *   halloween, newYear, july4, lunarNewYear                   dark, at night: every weather, washes
 *   christmas    snowing already (as winter): cloud and fog only
 *   hanukkah, diwali   NOT LISTED: indoors (a window, a hall of lamps)
 */
const LIGHT_WEATHER = Object.freeze({ weather: ['rain', 'snow', 'fog', 'storm'], time: [], tints: false });
const NIGHT_WEATHER = Object.freeze({ weather: ['cloudy', 'rain', 'snow', 'fog', 'storm'], time: [] });
export const SCENE_SKY = Object.freeze({
  fall:   { weather: ['cloudy', 'rain', 'snow', 'fog', 'storm'], time: ['dawn', 'dusk', 'night'] },
  winter: { weather: ['cloudy', 'fog'], time: ['night'] },
  night:  NIGHT_WEATHER,
  spring: LIGHT_WEATHER, summer: LIGHT_WEATHER, easter: LIGHT_WEATHER, stPatricks: LIGHT_WEATHER,
  valentines: LIGHT_WEATHER, harvest: LIGHT_WEATHER,
  halloween: NIGHT_WEATHER, newYear: NIGHT_WEATHER, july4: NIGHT_WEATHER, lunarNewYear: NIGHT_WEATHER,
  christmas: { weather: ['cloudy', 'fog'], time: [] },
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
    // A light theme (`tints: false`) takes the weather without the darkening wash.
    if (look.tint && e.tints !== false && !out.tints.includes(look.tint)) out.tints.push(look.tint);
  };
  // The time of day first, so its wash sits under the weather's.
  if (sky.time && (e.time || []).includes(sky.time)) add(sky.time);
  if (sky.weather && (e.weather || []).includes(sky.weather)) add(sky.weather);
  return out;
}
