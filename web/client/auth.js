// auth.js — the client's credential for talking to the coordination server.
//
// A paired device (the kiosk) holds a long random DEVICE SECRET and sends it as the
// `X-Device-Key` header on every request; the server maps it to the user. Pairing is
// one-time: launch the kiosk once with `?key=<secret>` and it's stored locally.
//
// When no device key is stored (the dev harness + tests), it falls back to the
// `X-Dev-User` override — which a prod server ignores, so it's harmless.

const KEY = 'nimrod:deviceKey';

export function getDeviceKey() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setDeviceKey(k) {
  try { if (k) localStorage.setItem(KEY, k); else localStorage.removeItem(KEY); }
  catch { /* private mode — best effort */ }
}

// The auth header for every API request.
export function authHeaders(user) {
  const key = getDeviceKey();
  if (key) return { 'X-Device-Key': key };
  return user ? { 'X-Dev-User': user } : {};
}

// *** A FAILED FETCH USED TO ONLY SAY "SOMETHING FAILED," NEVER "YOUR SESSION IS
// GONE." *** Found 2026-09-15: a session that stopped validating server-side (a real
// account, mid-use — see NOTES_FROM_CODE.md the same day) left home.html showing
// "Signed in, but your screens could not be loaded. Reload to try again" — a message
// that can never be true, because reloading resends the exact same broken cookie. The
// only way out was typing `/auth/logout` into the address bar by hand, which nobody
// visiting this site would know to do. Every `throw new Error(...)` after a failed
// fetch, across every client file, embedded the HTTP status in the MESSAGE TEXT
// only ("... -> 401") — nothing a caller could check without parsing a string. This
// is that status, as a real property, so a catch block can ask "was this a session
// problem?" and answer honestly instead of guessing. Callers pass their own message
// (unchanged from before) so nothing about what gets logged or shown changes except
// that `err.status` now exists.
export function httpError(res, message) {
  const err = new Error(message);
  err.status = res.status;
  return err;
}

// The question a catch block actually wants answered: "should I tell this person to
// sign in again?" 401 (not authenticated at all) and 403 (authenticated, but refused)
// both mean the session/credential on hand will not get them back in — retrying the
// same request, or reloading the same page, changes nothing without a fresh sign-in.
export function isAuthError(err) {
  return err?.status === 401 || err?.status === 403;
}
