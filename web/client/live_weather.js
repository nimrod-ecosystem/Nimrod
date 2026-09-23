// live_weather.js — the weather overlay, following the real local forecast.
//
// From Claude Design, 2026-09-23. Pairs with livescene.js: this file only decides WHICH weather
// overlay is showing; the drawing is the ordinary `rain` / `snow` / `fog` overlay.
//
// *** FOUR RULES, EACH ONE A DECISION RATHER THAN A DEFAULT ***
//
// 1. A PLACE IS TYPED BY A CAREGIVER, ONCE, AND NEVER ASKED FOR ON THE SCREEN. No geolocation.
//    A browser permission prompt on a bedside screen is a state only an input can leave, in front
//    of somebody who cannot give it. The caregiver types a town in settings; it is looked up once.
// 2. ONLY A COARSE POSITION EVER LEAVES THE MACHINE. Coordinates are rounded to one decimal
//    (~11 km) before they are stored or sent. That is enough for weather and not enough to find a
//    house. It is still a network request to a third party, so it is OFF by default, and the
//    storage table on the landing page must list the saved town when it is on.
// 3. A WEATHER FEED NEVER REPORTS AN ERROR ON SCREEN. Same rule as the wallpaper: offline, rate
//    limited or malformed all land on "no weather", which is a normal state of the sky. The last
//    good reading is kept for three hours, so a dropped connection does not make the rain stop.
// 4. NO LIGHTNING. Thunderstorms map to rain. A flash is a flash, whatever it is for.
//
// Source: Open-Meteo (https://open-meteo.com), which needs no key. Its data is licensed CC BY 4.0,
// so it needs a credit line in ATTRIBUTIONS.md and wherever the setting is offered. CODE: confirm
// the current terms before shipping. Design has not verified them.

import { overlayForWeatherCode as weatherOverlay } from './livescene.js';

const POLL_MS = 30 * 60 * 1000;          // the sky does not change faster than this matters
const STALE_MS = 3 * 60 * 60 * 1000;     // keep the last good reading this long through an outage
const round1 = (n) => Math.round(Number(n) * 10) / 10;

/** Look a place up once. Returns { name, lat, lon } with coordinates already rounded, or null. */
export async function findPlace(query, { fetchImpl = fetch } = {}) {
  const q = String(query || '').trim();
  if (!q) return null;
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name='
      + encodeURIComponent(q);
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const hit = (await res.json())?.results?.[0];
    if (!hit) return null;
    return {
      name: [hit.name, hit.admin1, hit.country].filter(Boolean).join(', '),
      lat: round1(hit.latitude), lon: round1(hit.longitude),
    };
  } catch { return null; }
}

/** The current WMO code for a place, or null. Never throws. */
export async function currentCode({ lat, lon }, { fetchImpl = fetch } = {}) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${round1(lat)}&longitude=${round1(lon)}`
      + '&current=weather_code';
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const code = (await res.json())?.current?.weather_code;
    return Number.isFinite(code) ? code : null;
  } catch { return null; }
}

/**
 * Follow the weather for a place and call `onChange(overlayKeyOrNull)` whenever it changes.
 *
 *   const w = followWeather({ lat: 51.5, lon: -0.1 }, (k) => scene.set({ overlays: k ? [k] : [] }));
 *   w.stop();
 */
export function followWeather(place, onChange, {
  fetchImpl = fetch, now = () => Date.now(),
  setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (id) => clearTimeout(id),
} = {}) {
  let last = { key: null, at: 0 };
  let shown;
  let timer = null;
  let stopped = false;

  const emit = (k) => { if (k !== shown) { shown = k; try { onChange?.(k); } catch { /* the host's problem */ } } };

  async function tick() {
    if (stopped) return;
    const code = await currentCode(place, { fetchImpl });
    if (stopped) return;
    if (code != null) last = { key: weatherOverlay(code), at: now() };
    // A failed read keeps the last good one until it is stale, then lets the sky clear.
    emit(now() - last.at <= STALE_MS ? last.key : null);
    timer = setTimer(tick, POLL_MS);
  }
  tick();

  return {
    get current() { return shown ?? null; },
    stop() { stopped = true; if (timer != null) clearTimer(timer); },
  };
}
