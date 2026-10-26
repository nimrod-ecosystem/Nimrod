// flash_warning.js - "THIS GAME CAN FLASH" (row 2.124, chat's note CS 4).
//
// Mike, 2026-10-25: "There could maybe be a warning any time you open a game with a photosensitivity risk as a splash
// screen or something. Isn't that standard?" It is: console games commonly show a photosensitivity warning when they
// start. And it fits his ruling on the same row: the default is not restricted ("we don't want to restrict the site on
// certain people's needs by default"); a person is TOLD, and the photosensitivity setting is one press away.
//
// WHICH GAMES: a module that can flash faster than three times a second within its own range says so in its manifest,
// `canFlash: true` (Rhythm tiles: up to five beats a second; Wait and Go: bursts of blooms). Most modules that read the
// flash limit only use it as a floor under slow scan lights, and are not marked.
//
// WHEN (a screen setting, `flashWarning`): the first time each game opens on this screen (the default), every time,
// or never. Never shown when the screen already limits flashing to three a second or less - the protection is on.
// "Seen" is kept in this browser (per screen, not per person: a screen in a room is seen by everybody in it, the flash
// limit's own reasoning in kiosk.js MOTION_FIELDS).
//
// *** NOT A GATE, NOT A SPLASH THAT WAITS (CLAUDE.md: a screen must never enter a state that only an input can leave,
// when the person in front of it cannot give that input). *** It is a banner over the top of the game, which goes by
// itself after FLASH_WARNING_MS; the game behind it is never covered or stopped, and nothing waits for "OK". Argued
// against a full-screen splash that needs a press: on a screen whose person cannot press, that is exactly the
// forbidden state, and somebody who can press loses nothing by the banner going away on its own.

export const FLASH_WARNING_KEY = 'flashWarning';
// How long the banner stays: twelve seconds, long enough to read two short lines slowly, short enough that a game
// started by somebody who did not look is not covered for long.
export const FLASH_WARNING_MS = 12 * 1000;
const SEEN_KEY = 'nimrod.flashWarned.v1';

export const FLASH_WARNING_FIELD = Object.freeze({
  key: FLASH_WARNING_KEY, label: 'Warn before games that can flash', kind: 'choice', default: 'first', level: 'standard',
  options: [{ value: 'first', label: 'The first time each game opens' }, { value: 'always', label: 'Every time' },
    { value: 'never', label: 'Never' }],
  note: 'A short note over the game that goes by itself. Not shown when the flash limit is three a second or less.',
});

/** Whether to warn: a game that can flash, a setting that asks for it, no limit already protecting, not yet seen. PURE. */
export function shouldWarn({ canFlash = false, setting = 'first', limit = Infinity, seen = false } = {}) {
  if (!canFlash || setting === 'never') return false;
  if (Number.isFinite(Number(limit)) && Number(limit) <= 3) return false;
  return setting === 'always' || !seen;
}

const store = {
  get() { try { const a = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } },
  add(type) { try { const a = store.get(); if (!a.includes(type)) globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...a, type].slice(-200))); } catch { /* not kept */ } },
};
export const flashSeen = (type) => store.get().includes(type);
export const markFlashSeen = (type) => store.add(type);
export const forgetFlashSeenForTest = () => { try { globalThis.localStorage?.removeItem(SEEN_KEY); } catch { /* none */ } };

/** The words. PURE. */
export const flashWords = (title) => `${title || 'This game'} can flash quickly. If flashing light is a problem for anyone `
  + 'here, set a flash limit in the settings.';

/**
 * Show the banner over `host` (a panel's box). `onSetting()` opens the settings (the flash limit is under Movement and
 * flashing). Returns { el, dismiss() }; it dismisses itself after FLASH_WARNING_MS.
 */
export function showFlashWarning(host, { title = '', onSetting = null, setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = (h) => clearTimeout(h), ms = FLASH_WARNING_MS } = {}) {
  const doc = host?.ownerDocument;
  if (!doc) return { el: null, dismiss() {} };
  const el = doc.createElement('div');
  el.className = 'flash-warning';
  el.dataset.flashWarning = '';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:absolute;left:8px;right:8px;top:8px;z-index:30;display:flex;flex-wrap:wrap;gap:8px;align-items:center;'
    + 'padding:10px 12px;border-radius:10px;background:var(--surface,#fff);color:var(--text,#222);border:2px solid var(--accent,#2b6cb0);'
    + 'box-shadow:0 2px 10px rgba(0,0,0,.25);font-size:1rem;pointer-events:auto';
  const p = doc.createElement('span');
  p.style.flex = '1 1 240px';
  p.textContent = flashWords(title);
  el.append(p);
  let timer = null, gone = false;
  const dismiss = () => { if (gone) return; gone = true; if (timer != null) clearTimer(timer); try { el.remove(); } catch { /* gone */ } };
  const btn = (label, fn) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'min-height:44px;padding:6px 12px;border-radius:8px;font:inherit;font-weight:600;cursor:pointer';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    el.append(b);
  };
  if (typeof onSetting === 'function') btn('Flash limit', () => { dismiss(); try { onSetting(); } catch { /* no menu */ } });
  btn('OK', dismiss);
  try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch { /* leave it */ }
  host.append(el);
  timer = setTimer(dismiss, ms);
  return { el, dismiss };
}
