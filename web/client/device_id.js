// device_id.js - WHICH DEVICE THIS IS: an id it keeps, and the name the person or the launcher gave it (2026-10-25).
//
// Mike, 2026-10-25: "In this case I would be calling a different device on my account." A call rang every screen of the
// person; to ring ONE (drive.py ScreenTargets), a screen tells the server which device it is. A SCREEN RECORD is not a
// device - two devices can show the same screen, and their settings doc is shared - so the id lives in this browser:
// random, made once, kept. The NAME is what a caller sees in "Ring": the launcher's `deviceName` (kiosk-launch.sh
// NIMROD_DEVICE_NAME, "Bench Pi"), kept like `haBridge`; with none given, a plain fallback with the id's last four, so
// two unnamed screens are still told apart. A page that cannot keep anything makes a new id each load: it rings for
// every ordinary call as before, and a one-screen call finds it under its new id.

export const DEVICE_ID_KEY = 'nimrod:device-id';
export const DEVICE_NAME_KEY = 'nimrod:device-name';
export const DEVICE_NAME_PARAM = 'deviceName';
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
function randomHex(n = 16) {
  try {
    const a = new Uint8Array(n / 2);
    globalThis.crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
}

/** This browser's device id: kept, else made and kept. */
export function deviceId({ storage = defaultStorage() } = {}) {
  let id = null;
  try { id = storage?.getItem?.(DEVICE_ID_KEY) || null; } catch { id = null; }
  if (id && ID_RE.test(id)) return id;
  id = `dv-${randomHex(16)}`;
  try { storage?.setItem?.(DEVICE_ID_KEY, id); } catch { /* not kept: a new one next load */ }
  return id;
}

/** A name, printable and short. PURE. */
export const cleanDeviceName = (v) => String(v ?? '').replace(/[\x00-\x1f\x7f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);

/**
 * What a screen asks to be called when it is added with a code (2026-10-27, row 2.139 item 1). Mike found two screens
 * on his account both called "This screen" - every kiosk asked with that - and could not tell which was which. Now:
 * the launcher's `deviceName` or the one kept, else what kind of computer this is, in plain words ("Raspberry Pi",
 * "Windows computer"). The server numbers a name already used on the account ("Raspberry Pi 2"), and the person adding
 * it can still type any name. PURE given `nav`.
 */
export function screenLabelGuess({ search = (typeof location !== 'undefined' ? location.search : ''), storage = defaultStorage(),
  nav = (typeof navigator !== 'undefined' ? navigator : null) } = {}) {
  // Only what the server takes as a screen name (app.py NAME_RE: letters, digits, spaces and . , ' ’ -): a launcher name
  // with brackets in it must not stop the screen from asking for a code at all.
  const fit = (s) => String(s || '').replace(/[^\p{L}\p{N}_ .,'’-]/gu, '').replace(/\s+/g, ' ').trim();
  let asked = null;
  try { asked = new URLSearchParams(search || '').get(DEVICE_NAME_PARAM); } catch { asked = null; }
  const a = fit(cleanDeviceName(asked));
  if (a) return a;
  let kept = '';
  try { kept = fit(cleanDeviceName(storage?.getItem?.(DEVICE_NAME_KEY))); } catch { kept = ''; }
  if (kept) return kept;
  const plat = String(nav?.userAgentData?.platform || nav?.platform || '');
  const ua = String(nav?.userAgent || '');
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Win/i.test(plat) || /Windows/.test(ua)) return 'Windows computer';
  if (/Mac/i.test(plat)) return 'Mac';
  if (/arm|aarch/i.test(plat)) return 'Raspberry Pi';      // a Linux ARM computer running a screen: almost always a Pi
  if (/CrOS|Chrome ?OS/i.test(ua + plat)) return 'Chromebook';
  if (/Linux/i.test(plat)) return 'Linux computer';
  return 'This screen';
}

/** This device's name: the launcher's `deviceName` (kept), else the kept one, else "A screen (…abcd)". */
export function deviceName({ search = (typeof location !== 'undefined' ? location.search : ''), storage = defaultStorage(), id = '' } = {}) {
  let asked = null;
  try { asked = new URLSearchParams(search || '').get(DEVICE_NAME_PARAM); } catch { asked = null; }
  const a = cleanDeviceName(asked);
  if (a) { try { storage?.setItem?.(DEVICE_NAME_KEY, a); } catch { /* not kept */ } return a; }
  let kept = null;
  try { kept = cleanDeviceName(storage?.getItem?.(DEVICE_NAME_KEY)); } catch { kept = ''; }
  return kept || `A screen (…${String(id || '').slice(-4) || '????'})`;
}
