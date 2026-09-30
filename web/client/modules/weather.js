// modules/weather.js — THE WEATHER: now, the next few hours, and the next few days, for one place.
//
// Row 2.37 item 4 (docs/for_chat/MIKE_CHANGE_LIST.md, private repo) and room_as_home_20260930.md §7:
// the room's window shows your AI's avatar sometimes, and clicking it gives the weather. This is the
// weather half, as an ordinary module; putting it behind the window is the room's job, later.
//
// *** THE DATA: Open-Meteo (open-meteo.com), NO KEY AND NO ACCOUNT. *** The browser asks it
// directly: the forecast from api.open-meteo.com/v1/forecast, a typed place from
// geocoding-api.open-meteo.com/v1/search. Verified against its docs 2026-09-30. Its terms: the free
// API is for NON-COMMERCIAL use (private or non-profit sites with no subscriptions or ads, personal
// home automation), under 10,000 calls a day, 5,000 an hour, 600 a minute; the data is CC BY 4.0,
// so a credit line is shown under the forecast. A commercial Nimrod would need its paid plan. Listed
// for Mike.
//
// *** NO DEFAULT PLACE, AND NOTHING SENT UNTIL SOMEBODY SETS ONE. *** Until the `place` setting
// holds a town or a latitude and longitude, the panel says how to set one and makes no request at
// all. The setting's label says the place goes to Open-Meteo. What leaves the machine:
//   * a typed NAME goes to the geocoder once (to find it), and only again if the name changes;
//   * the forecast request carries the position ROUNDED TO ONE DECIMAL (about 11 km), the same rule
//     live_weather.js already uses: enough for weather, not enough to find a house;
//   * a typed "lat, lon" never touches the geocoder.
// No geolocation, ever asked on the screen: a browser permission prompt in front of somebody who
// cannot answer it is a state only an input can leave.
//
// *** NEVER A BLANK PANEL. *** The last good forecast is kept (in this panel's state, so it
// survives a reload with no connection) and shown with a plain notice when an update fails or it
// has got old. With no data at all, the panel says it could not reach the weather service and when
// it will try again. A failure is retried at the next scheduled refresh, not sooner: weather does
// not change fast enough to be worth hammering a free service during an outage.
//
// A PICTURE AND WORDS, EVERY TIME. Each icon has a label, and the words sit beside it. Colour is
// never the only signal: the icons are shapes first, coloured by the theme (weather_icons.js).
//
// A SWITCH REACHES IT. `select` with nothing lit reads the weather now aloud (one press: "what's it
// like out?"); `next`/`prev` walk the days and wrap; `select` reads the lit day; `back` goes back to
// now. When a typed name matches several places, `next`/`prev`/`select` walk and pick among them.
//
// HEALTH. It publishes `weather/state` on every scheduled tick, whether or not a place is set (the
// timer runs; with no place it sends nothing to the network), tagged with this panel. So a wedged
// timer is caught as silence, and a panel with no place yet is not. The table row it needs, for
// health.js, is `{ expectMs: 6 h }`: twice the slowest refresh on offer (3 h).
//
// DEFAULTS CHOSEN HERE — each is a setting, or argued where it is not, and all are on Mike's list:
//   * units: "Automatic" — °F where the screen's language says United States (and the few others
//     that use it), °C everywhere else. Wind follows: mph with °F, km/h with °C.
//   * refresh every 30 minutes; the next 6 hours; the next 5 days.
//   * NOT settings, argued in place below: the 1-decimal rounding (COORD_DECIMALS), five geocoder
//     matches (MATCHES), a 20 s request timeout (FETCH_TIMEOUT_MS), "old" after two missed refreshes
//     (STALE_AFTER_REFRESHES).

import { registerModule } from '../module.js';
import { iconSvg } from '../weather_icons.js';

export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
export const CREDIT = 'Weather data by Open-Meteo.com (CC BY 4.0)';

export const REFRESH_OPTIONS = Object.freeze([15, 30, 60, 120, 180]);   // minutes
export const MAX_REFRESH_MIN = Math.max(...REFRESH_OPTIONS);
// Rounding a position before it is stored or sent. One decimal is ~11 km: Open-Meteo's own models
// run at 1-11 km, so a finer position buys little forecast and gives away a street. Kept equal to
// live_weather.js's rule so the site has ONE answer to "how precisely do we say where you are".
export const COORD_DECIMALS = 1;
// How many places a typed name offers. Five is enough to tell the Springfields apart and short
// enough for a switch to walk; a sixth-best match for a name is almost never the one wanted.
export const MATCHES = 5;
// A request with no answer after this long counts as failed, so a hung connection shows the stale
// notice instead of a panel that silently never updates. Well past a slow facility connection.
export const FETCH_TIMEOUT_MS = 20000;
// Data is called old once this many refreshes have gone by without a new one, even if no request
// visibly failed (a sleeping laptop, a suspended tab). One missed refresh is ordinary; two is news.
export const STALE_AFTER_REFRESHES = 2;
export const MAX_HOURS = 12;
export const MAX_DAYS = 7;

// Countries (by the screen's locale region) that read temperature in Fahrenheit.
const FAHRENHEIT_REGIONS = new Set(['US', 'LR', 'MM', 'PR', 'GU', 'VI', 'AS', 'MP', 'BS', 'KY', 'PW', 'FM', 'MH']);

const SETTINGS = [
  { key: 'place', label: 'Place (sent to Open-Meteo to look up the weather)', kind: 'text', default: '', level: 'standard',
    note: 'A town name, or a latitude and longitude like 40.7, -74.0. The name, or the position rounded to about 11 km, '
      + 'is sent to Open-Meteo (open-meteo.com), a free weather service. Nothing is sent until a place is set.' },
  { key: 'units', label: 'Temperature', kind: 'choice', default: 'auto', level: 'standard',
    options: [{ value: 'auto', label: 'Automatic (from the screen’s language)' },
      { value: 'f', label: '°F, wind in mph' }, { value: 'c', label: '°C, wind in km/h' }] },
  { key: 'refreshMin', label: 'Check for new weather every', kind: 'choice', default: 30, level: 'advanced',
    options: REFRESH_OPTIONS.map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` })) },
  { key: 'hours', label: 'Hours ahead to show', kind: 'number', default: 6, min: 0, max: MAX_HOURS, step: 1, level: 'standard' },
  { key: 'days', label: 'Days to show', kind: 'number', default: 5, min: 1, max: MAX_DAYS, step: 1, level: 'standard' },
];
export const DEFAULTS = Object.freeze(Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------
// PURE HELPERS — exported so the suite checks the rules without a DOM or a network
// ---------------------------------------------------------------------------------------

// WMO weather codes, as Open-Meteo documents them, in plain words. `short` fits under an hour.
const CODES = {
  0: ['Clear', 'Clear', 'clear'], 1: ['Mostly clear', 'Clear', 'clear'], 2: ['Partly cloudy', 'Some cloud', 'partly'],
  3: ['Cloudy', 'Cloudy', 'cloud'], 45: ['Fog', 'Fog', 'fog'], 48: ['Freezing fog', 'Fog', 'fog'],
  51: ['Light drizzle', 'Drizzle', 'drizzle'], 53: ['Drizzle', 'Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'Drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'Icy', 'sleet'], 57: ['Heavy freezing drizzle', 'Icy', 'sleet'],
  61: ['Light rain', 'Rain', 'rain'], 63: ['Rain', 'Rain', 'rain'], 65: ['Heavy rain', 'Heavy rain', 'rain'],
  66: ['Freezing rain', 'Icy rain', 'sleet'], 67: ['Heavy freezing rain', 'Icy rain', 'sleet'],
  71: ['Light snow', 'Snow', 'snow'], 73: ['Snow', 'Snow', 'snow'], 75: ['Heavy snow', 'Heavy snow', 'snow'],
  77: ['Snow grains', 'Snow', 'snow'],
  80: ['Light showers', 'Showers', 'rain'], 81: ['Showers', 'Showers', 'rain'], 82: ['Heavy showers', 'Heavy rain', 'rain'],
  85: ['Light snow showers', 'Snow', 'snow'], 86: ['Heavy snow showers', 'Heavy snow', 'snow'],
  95: ['Thunderstorm', 'Storm', 'storm'], 96: ['Thunderstorm with hail', 'Storm', 'storm'],
  99: ['Thunderstorm with heavy hail', 'Storm', 'storm'],
};

/** A WMO code in words, and which picture goes with it. Day or night changes only the picture. */
export function describeCode(code, isDay = true) {
  const row = code == null || code === '' ? null : CODES[Number(code)];
  if (!row) return { words: 'Unknown weather', short: 'Unknown', icon: 'unknown', snow: false };
  const [words, short, kind] = row;
  const night = isDay === false || isDay === 0;
  const icon = kind === 'clear' ? (night ? 'moon' : 'sun') : kind === 'partly' ? (night ? 'partly-night' : 'partly-day') : kind;
  return { words, short, icon, snow: kind === 'snow' };
}

export const roundCoord = (n) => { const f = 10 ** COORD_DECIMALS; return Math.round(Number(n) * f) / f; };

/**
 * What the `place` setting says: nothing, a position, or a name to look up. A remembered pick is
 * used only while the setting still says the name it was picked for.
 */
export function resolvePlace(text, chosen = null) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { kind: 'none' };
  const m = /^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
  if (m) {
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const la = roundCoord(lat), lo = roundCoord(lon);
      return { kind: 'coords', lat: la, lon: lo, name: `${la}, ${lo}`, key: `${la},${lo}` };
    }
  }
  if (chosen && chosen.query === t && Number.isFinite(chosen.lat) && Number.isFinite(chosen.lon)) {
    const la = roundCoord(chosen.lat), lo = roundCoord(chosen.lon);
    return { kind: 'chosen', lat: la, lon: lo, name: String(chosen.name || t), key: `${la},${lo}` };
  }
  return { kind: 'search', query: t };
}

/** Temperature or wind units for a preference: 'f' | 'c'. "auto" reads the screen's locale. */
export function resolveUnits(pref, lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US') {
  if (pref === 'f' || pref === 'c') return pref;
  let region = '';
  try { region = new Intl.Locale(lang).maximize().region || ''; } catch { region = (/[-_]([A-Za-z]{2})\b/.exec(lang || '') || [])[1] || ''; }
  return FAHRENHEIT_REGIONS.has(region.toUpperCase()) ? 'f' : 'c';
}
export const temp = (c, units) => (Number.isFinite(c) ? Math.round(units === 'f' ? c * 9 / 5 + 32 : c) : null);
export const windWords = (kmh, units) => (!Number.isFinite(kmh) ? ''
  : units === 'f' ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`);

export function geocodeUrl(query, lang = 'en') {
  const l = /^[a-z]{2}/i.exec(String(lang || 'en'))?.[0]?.toLowerCase() || 'en';
  return `${OPEN_METEO_GEOCODE}?name=${encodeURIComponent(String(query).trim())}&count=${MATCHES}&language=${l}&format=json`;
}
/** The forecast request. Always metric: units are converted here, so switching them needs no request. */
export function forecastUrl({ lat, lon }, days = DEFAULTS.days) {
  const d = Math.min(Math.max(Math.round(Number(days)) || 1, 2), MAX_DAYS);   // at least 2, so 12 hours can cross midnight
  return `${OPEN_METEO_FORECAST}?latitude=${roundCoord(lat)}&longitude=${roundCoord(lon)}`
    + '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m'
    + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    + `&timezone=auto&forecast_days=${d}`;
}

/** Geocoder answer -> up to MATCHES places. Nothing found is an empty list, never a throw. */
export function placesFrom(json) {
  const list = Array.isArray(json?.results) ? json.results : [];
  return list
    .filter((r) => r && Number.isFinite(r.latitude) && Number.isFinite(r.longitude))
    .slice(0, MATCHES)
    .map((r) => ({ name: [r.name, r.admin1, r.country].filter(Boolean).join(', '), lat: roundCoord(r.latitude), lon: roundCoord(r.longitude) }));
}

const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Open-Meteo's answer -> the little model this panel draws. Times stay as the PLACE's local clock
 * strings (timezone=auto), so "3 PM" is 3 PM where the weather is. Throws on an answer with no
 * current temperature: a malformed reply is a failed update, not a blank one.
 */
export function normalizeForecast(json) {
  const cur = json?.current;
  const t = num(cur?.temperature_2m);
  if (!cur || t == null || typeof cur.time !== 'string') throw new Error('weather: no current reading in the answer');
  const now = { time: cur.time, tempC: t, feelsC: num(cur.apparent_temperature), code: num(cur.weather_code),
    isDay: cur.is_day !== 0, windKmh: num(cur.wind_speed_10m) };
  const h = json.hourly || {};
  const hours = [];
  (Array.isArray(h.time) ? h.time : []).forEach((time, i) => {
    if (hours.length >= MAX_HOURS || typeof time !== 'string' || time <= cur.time) return;
    hours.push({ time, tempC: num(h.temperature_2m?.[i]), code: num(h.weather_code?.[i]),
      rainPct: num(h.precipitation_probability?.[i]), isDay: h.is_day?.[i] !== 0 });
  });
  const d = json.daily || {};
  const days = (Array.isArray(d.time) ? d.time : []).slice(0, MAX_DAYS).map((date, i) => ({
    date, code: num(d.weather_code?.[i]), maxC: num(d.temperature_2m_max?.[i]), minC: num(d.temperature_2m_min?.[i]),
    rainPct: num(d.precipitation_probability_max?.[i]),
  }));
  return { now, hours, days };
}

const utcFromLocal = (s) => {   // 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM', read as a wall clock
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : null;
};
/** "3 PM" (or "15" in a 24-hour locale), for a place-local time string. */
export function hourLabel(time) {
  const d = utcFromLocal(time);
  if (!d) return '';
  try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(d); }
  catch { return `${String(d.getUTCHours()).padStart(2, '0')}:00`; }
}
/** "Today", "Tomorrow", then the weekday. `long` for speech. */
export function dayLabel(date, index, { long = false } = {}) {
  if (index === 0) return 'Today';
  if (index === 1) return 'Tomorrow';
  const d = utcFromLocal(date);
  if (!d) return '';
  try { return new Intl.DateTimeFormat(undefined, { weekday: long ? 'long' : 'short', timeZone: 'UTC' }).format(d); }
  catch { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]; }
}
/** A local clock time for "not updated since ...": this machine's clock, since it is our fetch time. */
export function sinceWords(ms, nowMs = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms);
  let time;
  try { time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d); }
  catch { time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; }
  if (new Date(nowMs).toDateString() === d.toDateString()) return time;
  let day;
  try { day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(d); } catch { day = ''; }
  return `${day} ${time}`.trim();
}

const chanceWords = (pct, snow, { spoken = false } = {}) => {
  if (pct == null) return '';
  const what = snow ? 'snow' : 'rain';
  if (spoken) return pct === 0 ? `no chance of ${what}` : `${Math.round(pct)} percent chance of ${what}`;
  return `${what[0].toUpperCase()}${what.slice(1)} ${Math.round(pct)}%`;
};
const placeShort = (name) => String(name || '').split(',')[0].trim();

/** The weather now, as a sentence to read aloud. */
export function spokenNow(model, units, { place = '', staleSince = '' } = {}) {
  if (!model?.now) return 'There is no weather yet.';
  const n = model.now;
  const c = describeCode(n.code, n.isDay);
  const where = placeShort(place);
  const parts = [`${staleSince ? `This is from ${staleSince}. ` : ''}Now${where ? ` in ${where}` : ''}: ${temp(n.tempC, units)} degrees, ${c.words.toLowerCase()}.`];
  const feels = temp(n.feelsC, units);
  if (feels != null && feels !== temp(n.tempC, units)) parts.push(`Feels like ${feels}.`);
  const today = model.days?.[0];
  if (today) parts.push(spokenDay(model, 0, units, { lead: 'Today' }));
  return parts.join(' ');
}
/** One day, as a sentence. */
export function spokenDay(model, i, units, { lead = '' } = {}) {
  const d = model?.days?.[i];
  if (!d) return 'There is no forecast for that day.';
  const c = describeCode(d.code, true);
  const bits = [c.words.toLowerCase()];
  if (d.maxC != null) bits.push(`high ${temp(d.maxC, units)}`);
  if (d.minC != null) bits.push(`low ${temp(d.minC, units)}`);
  const ch = chanceWords(d.rainPct, c.snow, { spoken: true });
  if (ch) bits.push(ch);
  return `${lead || dayLabel(d.date, i, { long: true })}: ${bits.join(', ')}.`;
}

/** fetch with a timeout, resolving to JSON or throwing. The timer is always cleared. */
async function getJson(url, { fetchImpl, setT, clearT, timeoutMs = FETCH_TIMEOUT_MS, onAbort }) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  onAbort?.(ac);
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setT(() => { try { ac?.abort(); } catch { /* gone */ } reject(new Error('timed out')); }, timeoutMs); });
  try {
    const res = await Promise.race([fetchImpl(url, ac ? { signal: ac.signal } : undefined), timeout]);
    if (!res || !res.ok) throw new Error(`HTTP ${res && res.status}`);
    return await Promise.race([res.json(), timeout]);
  } finally { if (timer != null) clearT(timer); }
}

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------

registerModule(
  { type: 'weather', title: 'Weather', core: 'new',
    description: 'The weather now, the next few hours and the next few days, for a place you set. '
      + 'The place is sent to Open-Meteo, a free weather service; nothing is sent until one is set.',
    // `network`: it needs the internet to update, and shows the last weather it had without it.
    dependsOn: 'network', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const now = ctx.now || (() => Date.now());
    const fetchImpl = ctx.fetch || ((...a) => globalThis.fetch(...a));
    const rawSet = ctx.setTimeout || ((f, ms) => setTimeout(f, ms));
    const rawClear = ctx.clearTimeout || ((id) => clearTimeout(id));
    // Every timer this panel starts (the refresh AND each request's timeout) is tracked, so destroy
    // can clear them all, including a timeout for a request that is still on its way.
    const liveTimers = new Set();
    const setT = (f, ms) => { const id = rawSet(() => { liveTimers.delete(id); f(); }, ms); liveTimers.add(id); return id; };
    const clearT = (id) => { liveTimers.delete(id); rawClear(id); };
    const lang = () => ctx.lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    const OWN = { panel: `weather:${ctx.instanceId || Math.random().toString(36).slice(2)}` };

    let cfg = { ...DEFAULTS };
    let chosen = null;            // { query, name, lat, lon } — the pick for a typed name
    let lastGood = null;          // { key, at, model } — kept in state, so it survives a reload offline
    let status = 'none';          // none | short | searching | pick | notfound | searchfailed | loading | ok | failed
    let matches = [];
    let searchedQuery = null;
    let activeKey = null;         // the place key the current fetch loop is for
    let lastFailed = false;       // the most recent forecast request failed
    let seq = 0;                  // bumps on every request, so a late answer for an old place is dropped
    let tickTimer = null;
    let inflight = null;          // the AbortController of the request in flight
    let lit = -1;
    let lastSpeech = null;
    let dead = false;
    let rootEl = null;

    const refreshMs = () => (REFRESH_OPTIONS.includes(Number(cfg.refreshMin)) ? Number(cfg.refreshMin) : DEFAULTS.refreshMin) * 60000;
    const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : d; };
    const units = () => resolveUnits(cfg.units, lang());
    const place = () => resolvePlace(cfg.place, chosen);
    const shown = () => { const p = place(); return p.key && lastGood && lastGood.key === p.key ? lastGood : null; };
    const isStale = () => { const g = shown(); return !!g && (lastFailed || now() - g.at > STALE_AFTER_REFRESHES * refreshMs()); };

    function say(text) {
      if (!text || !ctx.output?.say) return;
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: 'weather' });
      } catch (e) { console.error('weather: say', e); }
    }
    function beat() {
      try { bus.publish('weather/state', { status: isStale() ? 'stale' : status, updatedAt: shown()?.at || null }, OWN); }
      catch { /* a heartbeat must never break the panel */ }
    }

    // ---- the network -------------------------------------------------------------------------
    async function lookUp(query) {
      searchedQuery = query;
      if (query.length < 2) { status = 'short'; matches = []; return; }
      status = 'searching'; matches = []; render();
      const my = ++seq;
      try {
        const found = placesFrom(await getJson(geocodeUrl(query, lang()), { fetchImpl, setT, clearT, onAbort: (a) => { inflight = a; } }));
        if (dead || my !== seq) return;
        if (found.length === 1) { choose(found[0]); return; }
        matches = found;
        status = found.length ? 'pick' : 'notfound';
        if (lit >= 0) lit = 0;
      } catch (e) {
        if (dead || my !== seq) return;
        status = 'searchfailed';
        searchedQuery = null;          // try the name again at the next tick
      }
    }
    async function getForecast(p) {
      if (!shown()) status = 'loading';
      render();
      const my = ++seq;
      try {
        const model = normalizeForecast(await getJson(forecastUrl(p, cfg.days), { fetchImpl, setT, clearT, onAbort: (a) => { inflight = a; } }));
        if (dead || my !== seq) return;
        lastGood = { key: p.key, at: now(), model };
        lastFailed = false;
        status = 'ok';
        try { state?.set?.({ lastGood }); } catch { /* memory only */ }
      } catch (e) {
        if (dead || my !== seq) return;
        lastFailed = true;
        status = shown() ? 'ok' : 'failed';
      }
    }

    // One scheduled check. With no place it sends nothing and still says it is alive.
    // `gen`: a tick that was overtaken by a restart (the place changed while it waited on the
    // network) must not schedule a second timer when its answer finally arrives.
    let tickGen = 0;
    async function tick() {
      if (dead) return;
      const gen = ++tickGen;
      tickTimer = null;
      const p = place();
      if (p.kind === 'none') { status = 'none'; matches = []; }
      else if (p.kind === 'search') { if (p.query !== searchedQuery) await lookUp(p.query); }
      else await getForecast(p);
      if (dead || gen !== tickGen) return;
      beat();
      render();
      if (tickTimer == null) tickTimer = setT(tick, refreshMs());
    }
    function restart() {
      if (tickTimer != null) { clearT(tickTimer); tickTimer = null; }
      try { inflight?.abort(); } catch { /* gone */ }
      seq++;                           // anything still on its way is for the old settings
      tick();
    }

    function choose(m) {
      if (!m) return;
      chosen = { query: String(cfg.place || '').trim(), name: m.name, lat: m.lat, lon: m.lon };
      matches = [];
      lit = -1;
      try { state?.set?.({ chosenPlace: chosen }); } catch { /* memory only */ }
      onSettings();
    }

    // ---- settings ----------------------------------------------------------------------------
    function applyState(s) {
      const snap = s || {};
      const next = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (snap[k] !== undefined) next[k] = snap[k];
      cfg = next;
      if (snap.chosenPlace && typeof snap.chosenPlace === 'object') chosen = snap.chosenPlace;
      if (snap.lastGood && snap.lastGood.model && (!lastGood || snap.lastGood.at > lastGood.at)) lastGood = snap.lastGood;
    }
    let lastLoopKey = null;
    function onSettings() {
      const p = place();
      // What decides whether to ask the network again: the place, what is asked for, how often.
      const loopKey = `${p.kind}|${p.key || p.query || ''}|${cfg.refreshMin}|${cfg.days}`;
      if (loopKey !== lastLoopKey) {
        lastLoopKey = loopKey;
        if (p.key !== activeKey || p.kind === 'search') { activeKey = p.key || null; lit = -1; }
        restart();
      } else render();                 // units, hours shown: redraw from what is already here
    }

    // ---- actions -----------------------------------------------------------------------------
    const dayCount = () => Math.min(clampInt(cfg.days, 1, MAX_DAYS, DEFAULTS.days), shown()?.model.days.length || 0);
    function readNow() {
      const g = shown();
      if (!g) { say(status === 'none' ? 'No place is set for the weather yet.' : 'There is no weather yet.'); return; }
      // A picked town is said by name; a typed position is not read out as numbers.
      const p = place();
      say(spokenNow(g.model, units(), { place: p.kind === 'chosen' ? p.name : '', staleSince: isStale() ? sinceWords(g.at, now()) : '' }));
    }
    function readDay(i) {
      const g = shown();
      if (!g) return;
      const pre = isStale() ? `This is from ${sinceWords(g.at, now())}. ` : '';
      say(pre + spokenDay(g.model, i, units()));
    }
    function act(el) {
      if (!el || dead) return;
      const a = el.dataset.act;
      if (a === 'pick') { choose(matches[Number(el.dataset.i)]); return; }
      if (a === 'day') { lit = Number(el.dataset.i); paintLit(); readDay(lit); return; }
      if (a === 'now') { readNow(); return; }
      if (a === 'retry') { restart(); }
    }

    // ---- drawing ---------------------------------------------------------------------------
    const deg = (c) => { const v = temp(c, units()); return v == null ? '–' : `${v}°`; };

    function messageHtml(title, body, extra = '') {
      return `<div class="wx-msg" data-weather-msg="${status}"><p class="wx-msg-title">${title}</p>${body ? `<p class="wx-msg-body">${body}</p>` : ''}${extra}</div>`;
    }
    function setupHtml() {
      const q = esc(String(cfg.place || '').trim());
      const mins = Math.round(refreshMs() / 60000);
      switch (status) {
        case 'short': return messageHtml('Type a little more of the place’s name.', 'At least two letters, in the Place setting of this panel.');
        case 'searching': return messageHtml(`Looking up “${q}”…`, '');
        case 'notfound': return messageHtml(`No place called “${q}” was found.`, 'Check the spelling in this panel’s Place setting, or type a latitude and longitude instead, like 40.7, -74.0.');
        case 'searchfailed': return messageHtml(`Could not look up “${q}” just now.`, `The weather service did not answer. It will try again in ${mins} minutes.`,
          '<button type="button" class="wx-btn" data-walk data-act="retry">Try again now</button>');
        case 'pick': return `<div class="wx-msg" data-weather-msg="pick"><p class="wx-msg-title">Which “${q}”?</p>
          <div class="wx-picks">${matches.map((m, i) => `<button type="button" class="wx-btn" data-walk data-act="pick" data-i="${i}">${esc(m.name)}</button>`).join('')}</div></div>`;
        case 'loading': return messageHtml(`Getting the weather for ${esc(place().name || q)}…`, '');
        case 'failed': return messageHtml('Could not reach the weather service.', `It will try again in ${mins} minutes.`,
          '<button type="button" class="wx-btn" data-walk data-act="retry">Try again now</button>');
        default: return messageHtml('No place set for the weather yet.',
          'Open this panel’s settings and type a town, or a latitude and longitude, in Place. The place is sent to '
          + 'Open-Meteo, a free weather service, to look up the weather. Nothing is sent until a place is set.');
      }
    }

    function forecastHtml(g) {
      const u = units();
      const m = g.model;
      const n = m.now;
      const c = describeCode(n.code, n.isDay);
      const stale = isStale();
      const feels = temp(n.feelsC, u);
      const detail = [feels != null && feels !== temp(n.tempC, u) ? `Feels like ${feels}°` : '', windWords(n.windKmh, u) ? `Wind ${windWords(n.windKmh, u)}` : '']
        .filter(Boolean).join(' · ');
      const hoursN = clampInt(cfg.hours, 0, MAX_HOURS, DEFAULTS.hours);
      const hours = m.hours.slice(0, hoursN);
      const days = m.days.slice(0, dayCount());
      const notice = stale ? `<div class="wx-stale" role="status" data-weather-stale>
          <p>Not updated since ${esc(sinceWords(g.at, now()))}. This is the last weather it had.</p>
          <button type="button" class="wx-btn wx-btn-small" data-act="retry">Try again now</button></div>` : '';
      return `${notice}
        <button type="button" class="wx-now" data-act="now" data-weather-now aria-label="Read the weather now aloud">
          ${iconSvg(c.icon, { label: c.words, cls: 'wx-icon wx-icon-now' })}
          <span class="wx-now-text">
            <span class="wx-place" data-weather-place>${stale ? 'Last known' : 'Now'}${place().name ? ` · ${esc(place().name)}` : ''}</span>
            <span class="wx-temp" data-weather-temp>${deg(n.tempC)}<span class="wx-unit">${u === 'f' ? 'F' : 'C'}</span></span>
            <span class="wx-words" data-weather-words>${esc(c.words)}</span>
            ${detail ? `<span class="wx-detail" data-weather-detail>${esc(detail)}</span>` : ''}
          </span>
        </button>
        ${hours.length ? `<ol class="wx-hours" aria-label="The next ${hours.length} hours" data-weather-hours>${hours.map((h) => {
          const hc = describeCode(h.code, h.isDay);
          return `<li class="wx-hour"><span class="wx-hlabel">${esc(hourLabel(h.time))}</span>${iconSvg(hc.icon, { label: hc.words })}
            <span class="wx-htemp">${deg(h.tempC)}</span><span class="wx-hwords">${esc(hc.short)}</span>
            ${h.rainPct != null ? `<span class="wx-hrain">${esc(chanceWords(h.rainPct, hc.snow))}</span>` : ''}</li>`;
        }).join('')}</ol>` : ''}
        ${days.length ? `<ol class="wx-days" aria-label="The next ${days.length} days" data-weather-days>${days.map((d, i) => {
          const dc = describeCode(d.code, true);
          return `<li><button type="button" class="wx-day" data-walk data-act="day" data-i="${i}" aria-label="${esc(spokenDay(m, i, u))}">
            <span class="wx-dlabel">${esc(dayLabel(d.date, i))}</span>${iconSvg(dc.icon, { label: dc.words })}
            <span class="wx-dwords">${esc(dc.short)}</span>
            <span class="wx-dtemps">${deg(d.maxC)} <span class="wx-dlow">/ ${deg(d.minC)}</span></span>
            ${d.rainPct != null ? `<span class="wx-drain">${esc(chanceWords(d.rainPct, dc.snow))}</span>` : ''}</button></li>`;
        }).join('')}</ol>` : ''}
        <p class="wx-credit">${esc(CREDIT)}</p>`;
    }

    function render() {
      if (dead || !rootEl) return;
      const g = shown();
      rootEl.innerHTML = `<div class="wx" data-weather data-status="${isStale() ? 'stale' : status}">${g ? forecastHtml(g) : setupHtml()}</div>`;
      paintLit();
      // Row 2.37: the room's window shows the weather it is told (room_scene.js listens for `weather/now`
      // and asks with `weather/ask`); the room itself never goes to the network. A typed position is not
      // spoken as numbers, the same rule as `readNow`.
      try {
        const n = g?.model?.now;
        if (n) {
          const c = describeCode(n.code, n.isDay);
          const p = place();
          bus.publish('weather/now', { icon: c.icon, words: c.words, temp: deg(n.tempC), stale: isStale(), at: g.at,
            spoken: spokenNow(g.model, units(), { place: p.kind === 'chosen' ? p.name : '' }) }, OWN);
        }
      } catch { /* the room's window can wait */ }
    }

    // ---- the walk ----------------------------------------------------------------------------
    // Only what is on show: a short box hides the days (weather.css), and a switch must not light
    // something nobody can see.
    const walk = () => [...mount.querySelectorAll('[data-walk]')].filter((b) => b.getClientRects().length > 0);
    function paintLit() {
      const list = walk();
      if (lit >= list.length) lit = list.length ? list.length - 1 : -1;
      list.forEach((b, i) => { if (i === lit) { b.dataset.on = '1'; b.setAttribute('aria-current', 'true'); } else { delete b.dataset.on; b.removeAttribute('aria-current'); } });
      // A panel shorter than the forecast scrolls; the lit day is brought into view for a switch user.
      try { list[lit]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* not laid out */ }
    }
    function moveLit(d) {
      const n = walk().length;
      if (!n) return;
      lit = lit < 0 ? (d > 0 ? 0 : n - 1) : ((lit + d) % n + n) % n;
      paintLit();
    }
    function selectLit() {
      const list = walk();
      if (shown() && lit < 0) { readNow(); return; }       // one press: the weather now
      if (!list.length) { readNow(); return; }
      if (lit < 0) { lit = 0; paintLit(); return; }        // a list to pick from: show the highlight first
      act(list[lit]);
    }

    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      if (b && mount.contains(b)) act(b);
    }

    return {
      __probe: () => ({ status: isStale() ? 'stale' : status, lit, cfg: { ...cfg }, units: units(), place: place(), chosen,
        matches: matches.map((m) => ({ ...m })), lastGood, stale: isStale(), timerPending: tickTimer != null }),
      init() {
        let cssHref = '';
        try { cssHref = new URL('../weather.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `${cssHref ? `<link rel="stylesheet" data-weather-css href="${esc(cssHref)}">` : ''}<div class="wx-wrap" data-weather-root></div>`;
        rootEl = mount.querySelector('[data-weather-root]');
        mount.addEventListener('click', onClick);
        applyState(state?.get?.());
        state?.subscribe?.((s) => { if (dead) return; applyState(s); onSettings(); });
        bus.subscribe('weather/next', () => moveLit(1));
        bus.subscribe('weather/prev', () => moveLit(-1));
        bus.subscribe('weather/select', () => selectLit());
        bus.subscribe('weather/back', () => { lit = -1; paintLit(); });
        bus.subscribe('weather/ask', () => render());   // a room's window, just mounted, wants the weather now
        render();
        onSettings();
      },
      onResize() {},
      onHide() { try { state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        dead = true;
        seq++;
        tickTimer = null;
        for (const id of [...liveTimers]) clearT(id);
        try { inflight?.abort(); } catch { /* gone */ }
        mount.removeEventListener('click', onClick);
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
      },
    };
  },
);
