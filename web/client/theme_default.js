// theme_default.js — "BEST FOR THIS DEVICE": WHICH THEME A SCREEN WEARS UNTIL SOMEBODY PICKS ONE.
//
// Mike, 2026-10-07: *"I kind of want a live theme to be a default. Would people not like that? If that's no good
// or for less powerful devices it should be the Nimrod theme."*
//
// So the default is a RULE, offered in every theme list as one more choice beside "With the seasons" (a choice
// that is a rule rather than a palette, as that one is): a moving theme -- "With the seasons" -- on a device that
// looks able to run it and where nothing asks for less movement; the Nimrod theme everywhere else. It is the
// choice a screen has before anybody picks (the bottom of the levels: settings.js LEVELS, kiosk.js `shownTheme`),
// the one the ready-made landing pages are made with (dashboards.js), and a way back to "the default" for anybody
// who picked something else. Any theme somebody picks wins over it, at any level; it never replaces a choice.
//
// *** WHY A CHOICE AND NOT ONLY A FALLBACK, argued. *** FOR a fallback only (nothing stored, the rule runs wherever
// nothing is set): one fewer tile, and nothing in anybody's records names a rule. AGAINST, and it decides it: the
// landing page is MADE with its look written into it (dashboards.js records must name a theme), so a fallback would
// never reach the first page anybody sees; and a record made on a fast laptop and shown on a slow screen has to
// decide on the screen, not where it was made. A stored rule does both. It also gives the screen's own Theme row,
// which has no "Follow", a way back to the default.
//
// THE RULE (`pickStartingTheme`, pure), first match wins, the reasons that protect somebody first:
//   1. the device asks for less motion (prefers-reduced-motion)               -> Nimrod
//   2. movement is set to a minimum here (the starting-defaults "Movement" box, or a settings row)  -> Nimrod
//   3. a flash limit is set here (photosensitivity: flash_limit.js)            -> Nimrod
//   4. a program, not a person, is driving the browser (navigator.webdriver)   -> Nimrod
//   5. "3D detail on this device" (room_lod.js DETAIL_FIELD) set to light       -> Nimrod; set to full skips 8-10
//   6. a phone or tablet: a touch screen and no mouse                          -> Nimrod
//   7. the browser asks to save data                                           -> Nimrod
//   8. fewer than RULE.minCores processor cores                                -> Nimrod
//   9. less than RULE.minMemoryGB of memory (Chromium reports it; others skip) -> Nimrod
//  10. room_lod.js's timing calls this device slow                             -> Nimrod
//  11. on battery and at or under RULE.lowBattery                              -> Nimrod
//  12. a moving scene was measured here under RULE.minFps                       -> Nimrod
//  otherwise "With the seasons".
//
// *** THE NUMBERS, EACH A DEFAULT IN ONE PLACE (Rule 1), ARGUED. ***
//   minCores 4      A moving scene costs most of one core on the bench Pi 400 (Fall 141% of a core, the new
//                   scenes 66-93%, web/tools/pi_scene_bench.py) and a desktop core a fraction of that, but on a
//                   two-core machine even a fraction of one core is half of what photos, a video and the page
//                   have left. Four is where a scene can have a core without taking one from somebody's video.
//                   AGAINST: a fast two-core laptop would run it fine - and gets Nimrod by default, one tap away.
//   minMemoryGB 4   Chromium reports deviceMemory in steps (0.25 .. 8). Under 4 GB is the low-end Chromebook and
//                   the old tablet, where the scene's layers and the photos' decoded pictures compete for memory.
//   minFps 40       Measured with the scene RUNNING (`probeFrames`), a few seconds after it starts. Under 40 a
//                   second the drift visibly stutters; 60 is what a healthy screen gives. Between is a device
//                   coping, and a default should not ask a device to cope.
//   lowBattery 0.2  20% is where Windows and most phones turn their own battery saver on by default - the
//                   browser cannot see that switch, so this is the nearest thing it can.
//   probeDelayMs 3000, probeFrames 90, probeMaxMs 2000: start after the page has settled (its first seconds are
//                   loading, which is not what the scene costs), then about a second and a half of frames.
//   room_lod.js's SLOW_MS (8 ms per 100 rounds) is reused, not restated: its timing already separates the bench
//   Pi 400 (42-48 ms) from a desktop (13-14 ms), which hardwareConcurrency/deviceMemory alone cannot
//   (avatar_display.js argued that: a Pi 400 reports 4 cores and 4 GB, like many laptops).
//
// *** A RASPBERRY PI (a screen in a room) GETS NIMROD, decided here, argued. *** FOR moving: the bench Pi 400 drew
// every scene at about 60 frames a second. AGAINST, and it decides it: that was the scene ALONE; a screen in a room
// also crossfades photos and plays video, which a Pi 400 decodes in software, and a scene that adds 66-141 points of
// one core competes with exactly the things people put the screen there for. room_lod.js's timing calls it slow, so
// rule 10 gives Nimrod with no Pi-specific check. Anybody who wants the scene there picks it (or sets "3D detail" to
// full), and it is theirs.
//
// *** WHAT IS MEASURED ONCE AND KEPT, AND WHAT IS ASKED EVERY TIME. *** Kept on this device (`CACHE_KEY`): the
// timing (it does not change) and the frames measured with a scene up (taken once, the first time this device shows
// a moving default). Asked every time: everything about motion (1-3: a person can turn those on at any moment and
// must not wait for a re-measure), the pointer, the cores, the memory, and the battery last read on this page.
//
// *** IT CAN CHANGE ONCE, DOWNWARD, A FEW SECONDS IN. *** The first time a device shows the moving default, the
// frames are measured with it running; if they are too slow, the screen goes to Nimrod (fading) and says why. It
// never goes the other way by itself: a device that started on Nimrod is not handed a moving scene mid-look.

import { deviceCapability } from './room_lod.js';

export const DEVICE_THEME = 'device';
export const DEVICE_THEME_LABEL = 'Best for this device — moving only where it runs smoothly';
export const LIVE_PICK = 'seasons';
export const STILL_PICK = 'default';

export const THEME_DEFAULT_RULE = Object.freeze({
  minCores: 4, minMemoryGB: 4, minFps: 40, lowBattery: 0.2,
  probeDelayMs: 3000, probeFrames: 90, probeMaxMs: 2000, minFramesMeasured: 5,
});

export const isDeviceTheme = (id) => id === DEVICE_THEME;

// The reasons, in plain words: what the Theme tab says under "Best for this device".
export const BECAUSE_WORDS = Object.freeze({
  'reduced-motion': 'this device asks for less motion',
  'motion-setting': 'movement is set to a minimum here',
  'flash-limit': 'a limit on flashing is set here',
  automated: 'a program, not a person, is using this browser',
  'light-detail': 'this device is set to light 3D detail',
  touch: 'this looks like a phone or tablet, where a moving scene runs the battery down',
  'save-data': 'this device asks to save data',
  'few-cores': 'this device has few processor cores',
  'little-memory': 'this device has little memory',
  slow: 'this device would have to work hard to draw a moving scene',
  'low-battery': 'this device is low on battery',
  'not-smooth': 'a moving scene did not run smoothly here',
  smooth: 'this device runs a moving scene smoothly',
  able: 'this device looks able to run a moving scene',
});
/** "Chosen because this device …" for a pick. */
export const whyWords = (because) => `Chosen because ${BECAUSE_WORDS[because] || BECAUSE_WORDS.able}.`;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * THE RULE. PURE: the same signals always give the same answer. Any signal left out is "not known" and does not
 * count against the device (a browser that does not report memory is not called small for it).
 *   reducedMotion  the device asks for less motion          motionSetting  movement set to a minimum here
 *   flashLimit     a number = a limit is set (null/Infinity = none)
 *   automated      navigator.webdriver                       detail         'auto' | 'full' | 'proxy'
 *   coarseOnly     touch and no fine pointer                  saveData       the browser asks to save data
 *   cores, memoryGB                                           cpu            { slow, ms } (room_lod.js), read last
 *   battery        { charging, level }                        frames         { fps, measured }
 * -> { theme: 'seasons' | 'default', because, live }
 */
export function pickStartingTheme(s = {}, rule = THEME_DEFAULT_RULE) {
  const still = (because) => ({ theme: STILL_PICK, because, live: false });
  if (s.reducedMotion) return still('reduced-motion');
  if (s.motionSetting) return still('motion-setting');
  const fl = num(s.flashLimit);
  if (fl !== null && fl > 0) return still('flash-limit');
  if (s.automated) return still('automated');
  if (s.detail === 'proxy') return still('light-detail');
  if (s.coarseOnly) return still('touch');
  if (s.saveData) return still('save-data');
  const toldFast = s.detail === 'full';
  if (!toldFast) {
    const cores = num(s.cores);
    if (cores !== null && cores < rule.minCores) return still('few-cores');
    const mem = num(s.memoryGB);
    if (mem !== null && mem < rule.minMemoryGB) return still('little-memory');
    const cpu = s.cpu;   // read last: on a real device it is a timing (room_lod.js), taken once
    if (cpu && cpu.slow) return still('slow');
  }
  const b = s.battery;
  if (b && b.charging === false && num(b.level) !== null && b.level <= rule.lowBattery) return still('low-battery');
  const f = s.frames;
  if (f && f.measured && num(f.fps) !== null && f.fps < rule.minFps) return still('not-smooth');
  return { theme: LIVE_PICK, because: f && f.measured ? 'smooth' : 'able', live: true };
}

// ---------------------------------------------------------------------------------------------------
// READING THIS DEVICE
// ---------------------------------------------------------------------------------------------------
export const CACHE_KEY = 'nimrod:theme-device';
const defStorage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };
function readCache(storage) {
  try { const v = JSON.parse((storage ?? defStorage())?.getItem(CACHE_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; }
  catch { return {}; }
}
function writeCache(patch, storage) {
  try { const st = storage ?? defStorage(); st?.setItem(CACHE_KEY, JSON.stringify({ ...readCache(st), ...patch, v: 1 })); }
  catch { /* private mode: measured again next time */ }
}
/** Forget what was measured on this device (a test, or "measure again"). */
export function forgetDeviceMeasure(storage) { try { (storage ?? defStorage())?.removeItem(CACHE_KEY); } catch { /* nothing kept */ } }

// What the host knows that the browser does not: the screen's motion settings and its "3D detail" row. The kiosk
// sets these once (`setDeviceHints`) so that theme.js, which has no host, asks the same question it does.
let hints = { motion: null, detail: null };
let lastBattery = null;
let cpuThisPage = null;
/** `motion()` -> { reduceMotion, flashLimit } (avatar_display.js avatarMotionContext's shape); `detail()` -> 'auto'|'full'|'proxy'. */
export function setDeviceHints({ motion = null, detail = null } = {}) { hints = { motion, detail }; }
const call = (f) => { try { return typeof f === 'function' ? f() : f; } catch { return null; } };
const mq = (win, q) => { try { return !!win?.matchMedia?.(q)?.matches; } catch { return false; } };

/** The signals for `pickStartingTheme`, read from this browser now. `cpu` is a getter: timed only if reached. */
export function readDeviceSignals({ win = (typeof window !== 'undefined' ? window : null), storage, motion, detail } = {}) {
  const nav = win?.navigator || null;
  const m = call(motion ?? hints.motion) || {};
  const d = call(detail ?? hints.detail) || 'auto';
  const cache = readCache(storage);
  const s = {
    reducedMotion: mq(win, '(prefers-reduced-motion: reduce)') || !!m.deviceReduced,
    motionSetting: m.reduceMotion === true,
    flashLimit: num(m.flashLimit) !== null && m.flashLimit !== Infinity ? m.flashLimit : null,
    automated: nav?.webdriver === true,
    detail: d,
    coarseOnly: mq(win, '(pointer: coarse)') && !mq(win, '(any-pointer: fine)'),
    saveData: nav?.connection?.saveData === true,
    cores: num(nav?.hardwareConcurrency),
    memoryGB: num(nav?.deviceMemory),
    battery: lastBattery,
    frames: cache.frames && typeof cache.frames === 'object' ? { ...cache.frames, measured: true } : null,
  };
  Object.defineProperty(s, 'cpu', { enumerable: true, get: () => {
    if (num(cache.cpuMs) !== null) return { ms: cache.cpuMs, slow: !!cache.cpuSlow, measured: true };
    if (!cpuThisPage) {
      try { cpuThisPage = deviceCapability({ detail: 'auto' }); } catch { cpuThisPage = { slow: false, measured: false }; }
      if (cpuThisPage.measured) writeCache({ cpuMs: cpuThisPage.ms, cpuSlow: !!cpuThisPage.slow }, storage);
    }
    return cpuThisPage;
  } });
  return s;
}

/** What "Best for this device" paints here, now: { theme, because, live, words }. */
export function startingTheme(opts = {}) {
  const p = pickStartingTheme(readDeviceSignals(opts), opts.rule || THEME_DEFAULT_RULE);
  return { ...p, words: whyWords(p.because) };
}

/**
 * Frames with the scene up: `{ fps, median, count, measured }`. Not measured (and never counted against the device)
 * when the page is hidden, or when fewer than RULE.minFramesMeasured frames came at all (a browser that is not
 * drawing is not a slow one).
 */
export function probeFrames({ win = (typeof window !== 'undefined' ? window : null), rule = THEME_DEFAULT_RULE } = {}) {
  return new Promise((done) => {
    const raf = win?.requestAnimationFrame?.bind(win);
    if (!raf || win.document?.visibilityState === 'hidden') { done({ measured: false, count: 0 }); return; }
    const times = [];
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      const gaps = times.slice(1).map((t, i) => t - times[i]).filter((g) => g > 0).sort((a, b) => a - b);
      if (gaps.length + 1 < rule.minFramesMeasured) { done({ measured: false, count: times.length }); return; }
      const median = gaps[Math.floor(gaps.length / 2)];
      done({ measured: true, count: times.length, median: Math.round(median * 10) / 10, fps: Math.round(1000 / median) });
    };
    const tick = (t) => { if (over) return; times.push(t); if (times.length >= rule.probeFrames) finish(); else raf(tick); };
    raf(tick);
    setTimeout(finish, rule.probeMaxMs);
  });
}

/**
 * THE ONE MEASUREMENT AFTER THE FIRST LOOK. Reads the battery (where the browser has it), and if the moving default
 * is showing and this device has never been measured with a scene up, waits for the page to settle and measures the
 * frames, keeping the answer. Calls `onChange(pick)` when what "Best for this device" paints is now different (only
 * ever downward, see the header). -> { cancel(), done: Promise<pick> }.
 */
export function settleStartingTheme({ win = (typeof window !== 'undefined' ? window : null), storage, onChange = null,
  rule = THEME_DEFAULT_RULE, probe = probeFrames } = {}) {
  let cancelled = false;
  let timer = null;
  const done = (async () => {
    const before = startingTheme({ win, storage, rule });
    try {
      const get = win?.navigator?.getBattery;
      if (typeof get === 'function') {
        const b = await Promise.race([get.call(win.navigator), new Promise((r) => setTimeout(() => r(null), 500))]);
        if (b && typeof b.level === 'number') lastBattery = { charging: !!b.charging, level: b.level };
      }
    } catch { /* no battery to read */ }
    if (cancelled) return before;
    const mid = startingTheme({ win, storage, rule });
    if (mid.live && !readCache(storage).frames) {
      await new Promise((r) => { timer = setTimeout(r, rule.probeDelayMs); });
      if (cancelled) return mid;
      const f = await probe({ win, rule });
      if (f && f.measured) writeCache({ frames: { fps: f.fps, median: f.median, at: Date.now() } }, storage);
    }
    if (cancelled) return mid;
    const after = startingTheme({ win, storage, rule });
    if (after.theme !== before.theme) { try { onChange?.(after); } catch (err) { console.error('theme default: onChange', err); } }
    return after;
  })();
  return { done, cancel() { cancelled = true; clearTimeout(timer); } };
}

/** Forget this page's battery reading and timing (a test). */
export function resetDeviceReadings() { lastBattery = null; cpuThisPage = null; hints = { motion: null, detail: null }; }
