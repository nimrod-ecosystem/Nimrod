/* themeSchedule.js: which live theme is showing, from the date, the time and the weather.
 *
 * Plain JavaScript with no React and no imports, so web/client can ship this file as it is.
 *
 * THE LAYERS, highest first. The first one that has something to say wins:
 *   1. PIN      the person, or a caregiver, chose one theme. "Always this" beats everything.
 *   2. HOLIDAY  a holiday this profile celebrates is on today (each one is its own checkbox).
 *   3. NIGHT    optional: after dark, show the night scene.
 *   4. WEATHER  optional: snowing → winter. Weather always adds its overlay (rain, snow, fog)
 *               on top of whatever scene wins, unless that's turned off.
 *   5. SEASON   by month and hemisphere, mapped to a scene the person chooses.
 *
 * For somebody who has lost track of time, this is orientation as well as decoration: a scene
 * that turns with the year shows what time of year it is without anyone having to ask.
 */

const DAY = 864e5;
const ymd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const between = (d, a, b) => ymd(d) >= ymd(a) && ymd(d) <= ymd(b);

/* Western Easter Sunday (the anonymous Gregorian algorithm). */
export function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
/* US Thanksgiving: the fourth Thursday of November. */
export function thanksgiving(y) {
  const first = new Date(y, 10, 1);
  return new Date(y, 10, 1 + ((4 - first.getDay() + 7) % 7) + 21);
}
/* The Hebrew and Chinese dates come from the browser's own calendars (Intl), so there's no table
   to keep up to date. */
function calParts(d, cal) {
  try {
    const p = new Intl.DateTimeFormat('en-u-ca-' + cal, { month: cal === 'hebrew' ? 'long' : 'numeric', day: 'numeric' }).formatToParts(d);
    return { month: (p.find((x) => x.type === 'month') || {}).value, day: +(p.find((x) => x.type === 'day') || {}).value };
  } catch { return null; }
}
/* How many Hanukkah candles are lit right now: 0 outside Hanukkah, otherwise 1–8. A day starts at
   sunset, so the first candle is lit on the evening before 25 Kislev, and every evening adds one.
   `evening` is the hour the next candle is lit: sunset if the host knows it, 17:00 if not. */
export function hanukkahNight(date = new Date(), evening = 17) {
  const late = date.getHours() >= evening;
  for (let k = 0; k <= 8; k += 1) {
    const p = calParts(addDays(date, -k), 'hebrew');
    if (p && p.month === 'Kislev' && p.day === 25) { const n = k + 1 + (late ? 1 : 0); return n <= 8 ? n : 0; }
  }
  const t = calParts(addDays(date, 1), 'hebrew');
  return t && t.month === 'Kislev' && t.day === 25 && late ? 1 : 0;
}
/* LUNAR NEW YEAR, CHECKED (Code, 2026-10-05): the browser's Chinese calendar is NOT always right. Chrome's
   Intl (Chrome 152, New York time) puts 2027's first day on Feb 7 and 2030's on Feb 2; the published
   calendars say Saturday Feb 6 and Sunday Feb 3. Both new moons fall within minutes of midnight in China,
   which is exactly where an approximation lands on the wrong side. So, like Diwali, a TABLE
   comes first - [month from 0, day], 2026-2035, from China Highlights' list, 2026 from the same calendars -
   and Intl only answers for a year outside it. */
export const LUNAR_NEW_YEAR_DATES = { 2026: [1, 17], 2027: [1, 6], 2028: [0, 26], 2029: [1, 13], 2030: [1, 3],
  2031: [0, 23], 2032: [1, 11], 2033: [0, 31], 2034: [1, 19], 2035: [1, 8] };
function lunarNewYearDay(date) {
  const t = LUNAR_NEW_YEAR_DATES[date.getFullYear()];
  if (t) {
    const n = new Date(date.getFullYear(), t[0], t[1]);
    return between(date, n, addDays(n, 7)) || same(addDays(date, 1), n) ? n : null;
  }
  for (let k = 0; k <= 7; k += 1) { const p = calParts(addDays(date, -k), 'chinese'); if (p && String(p.month) === '1' && p.day === 1) return addDays(date, -k); }
  const p = calParts(addDays(date, 1), 'chinese');
  return p && String(p.month) === '1' && p.day === 1 ? addDays(date, 1) : null;
}
/* DIWALI follows the Hindu lunisolar calendar, which Intl doesn't have, so this is a TABLE. It needs
   checking against a published calendar, and extending past 2030.
   CHECKED by Code, 2026-10-05: the main day (Lakshmi Puja), [month from 0, day]. 2026-2035 from diwali.info's
   "Diwali dates" list; 2026 (Nov 8), 2027 (Oct 29) and 2028 (Oct 17) also agree with Wikipedia's Diwali article.
   All five of Design's dates were right; 2031-2035 are added. Some regional traditions keep it a day either
   side, which the five-day span below already covers. After 2035 there is no Diwali look until this grows. */
export const DIWALI_DATES = { 2026: [10, 8], 2027: [9, 29], 2028: [9, 17], 2029: [10, 5], 2030: [9, 26],
  2031: [10, 14], 2032: [10, 2], 2033: [9, 22], 2034: [10, 10], 2035: [9, 30] };

/* Each holiday: the scene it shows, when it starts and ends (`span`), and whether it's in the
   region's starter set. Every one is a checkbox: nobody gets a holiday they didn't choose to keep,
   and adding one is a tick. */
export const HOLIDAYS = {
  newYear: { label: "New Year's", scene: 'newYear', starter: true, span: (y) => [new Date(y - 1, 11, 31), new Date(y, 0, 1)], also: (y) => [new Date(y, 11, 31), new Date(y + 1, 0, 1)] },
  lunarNewYear: { label: 'Lunar New Year', scene: 'lunarNewYear', starter: false, test: (d) => { const n = lunarNewYearDay(d) || lunarNewYearDay(addDays(d, -1)); return !!n && between(d, addDays(n, -1), addDays(n, 7)); } },
  valentines: { label: "Valentine's Day", scene: 'valentines', starter: true, span: (y) => [new Date(y, 1, 10), new Date(y, 1, 14)] },
  stPatricks: { label: "St Patrick's Day", scene: 'stPatricks', starter: true, span: (y) => [new Date(y, 2, 14), new Date(y, 2, 17)] },
  easter: { label: 'Easter', scene: 'easter', starter: true, span: (y) => { const e = easterSunday(y); return [addDays(e, -3), addDays(e, 1)]; } },
  july4: { label: 'Fourth of July', scene: 'july4', starter: true, span: (y) => [new Date(y, 6, 2), new Date(y, 6, 4)] },
  halloween: { label: 'Halloween', scene: 'halloween', starter: true, span: (y) => [new Date(y, 9, 25), new Date(y, 9, 31)] },
  diwali: { label: 'Diwali', scene: 'diwali', starter: false, span: (y) => { const t = DIWALI_DATES[y]; if (!t) return null; const d = new Date(y, t[0], t[1]); return [addDays(d, -2), addDays(d, 2)]; } },
  thanksgiving: { label: 'Thanksgiving', scene: 'harvest', starter: true, span: (y) => { const t = thanksgiving(y); return [addDays(t, -3), addDays(t, 1)]; } },
  hanukkah: { label: 'Hanukkah', scene: 'hanukkah', starter: false, test: (d) => hanukkahNight(d) > 0 || hanukkahNight(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23)) > 0 },
  christmas: { label: 'Christmas', scene: 'christmas', starter: true, span: (y) => [new Date(y, 11, 18), new Date(y, 11, 26)] },
};
const on = (h, d) => {
  if (h.test) return h.test(d);
  return [h.span(d.getFullYear()), h.also && h.also(d.getFullYear())].some((s) => s && between(d, s[0], s[1]));
};

/* Meteorological seasons, flipped south of the equator. */
const NORTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'fall', 'fall', 'fall', 'winter'];
const FLIP = { winter: 'summer', summer: 'winter', spring: 'fall', fall: 'spring' };
export function seasonOf(date, hemisphere = 'north') { const s = NORTH[date.getMonth()]; return hemisphere === 'south' ? FLIP[s] : s; }

/* Open-Meteo weather codes → the overlay each one shows. */
const WX = { fog: [45, 48], snow: [71, 73, 75, 77, 85, 86], rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99] };
export function weatherKind(code) { return Object.keys(WX).find((k) => WX[k].includes(+code)) || null; }

export const SCHEDULE_DEFAULTS = {
  pin: null,
  hemisphere: 'north',
  holidays: Object.fromEntries(Object.entries(HOLIDAYS).map(([k, h]) => [k, h.starter])),
  seasons: { spring: 'spring', summer: 'summer', fall: 'fall', winter: 'winter' },
  night: { use: false, scene: 'night', from: 20, to: 6 },
  weather: { overlays: true, snowMeansWinter: false },
};

/* resolve(date, prefs, now) → { theme, overlays, layer, holiday, reason }
   `now` is what the host knows: { weatherCode, sunrise, sunset } (Date objects). Every field is
   optional. `reason` is a sentence for the settings screen: people trust a theme that says why
   it changed. */
export function resolve(date = new Date(), prefs = {}, now = {}) {
  const p = { ...SCHEDULE_DEFAULTS, ...prefs, holidays: { ...SCHEDULE_DEFAULTS.holidays, ...prefs.holidays }, seasons: { ...SCHEDULE_DEFAULTS.seasons, ...prefs.seasons }, night: { ...SCHEDULE_DEFAULTS.night, ...prefs.night }, weather: { ...SCHEDULE_DEFAULTS.weather, ...prefs.weather } };
  const wx = weatherKind(now.weatherCode);
  const overlays = p.weather.overlays && wx ? [wx] : [];
  const season = seasonOf(date, p.hemisphere);
  const dark = now.sunrise && now.sunset ? (date < now.sunrise || date > now.sunset) : (date.getHours() >= p.night.from || date.getHours() < p.night.to);
  if (p.pin) return { theme: p.pin, overlays, layer: 'pin', reason: 'Pinned: this theme always shows.' };
  for (const [k, h] of Object.entries(HOLIDAYS)) {
    if (p.holidays[k] && on(h, date)) {
      return { theme: h.scene, overlays, layer: 'holiday', holiday: k, reason: `${h.label}${k === 'hanukkah' ? ` (night ${Math.max(1, hanukkahNight(date))})` : ''} is on, and it wins over the ${season} scene.` };
    }
  }
  if (p.night.use && dark) return { theme: p.night.scene, overlays, layer: 'night', reason: `It's after dark, so the night scene shows. In daylight it goes back to ${season}.` };
  if (wx === 'snow' && p.weather.snowMeansWinter) return { theme: 'winter', overlays, layer: 'weather', reason: "It's snowing outside, so the winter scene shows." };
  return { theme: p.seasons[season], overlays, layer: 'season', reason: `It's ${season}${p.hemisphere === 'south' ? ' (southern hemisphere)' : ''}.${wx ? ` It's ${wx === 'rain' ? 'raining' : wx === 'snow' ? 'snowing' : 'foggy'} outside, so that's added on top.` : ''}` };
}

/* What's coming up, for the settings screen and for a calendar module: the next n changes. */
export function upcoming(date = new Date(), prefs = {}, n = 4) {
  const out = []; let last = resolve(date, prefs).theme;
  for (let i = 1; i <= 400 && out.length < n; i += 1) {
    const d = addDays(date, i); d.setHours(12);
    const r = resolve(d, { ...prefs, night: { use: false } });
    if (r.theme !== last) { out.push({ date: d, theme: r.theme, layer: r.layer, holiday: r.holiday }); last = r.theme; }
  }
  return out;
}

/* One object, so a design-system bundle can expose it (only capitalised exports reach the
   namespace). In web/client, import the functions directly. */
export const THEME_SCHEDULE = { HOLIDAYS, DIWALI_DATES, LUNAR_NEW_YEAR_DATES, SCHEDULE_DEFAULTS, resolve, upcoming, seasonOf, weatherKind, hanukkahNight, easterSunday, thanksgiving };
