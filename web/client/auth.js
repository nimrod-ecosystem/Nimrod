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
