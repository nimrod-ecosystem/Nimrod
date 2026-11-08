// quiet_hours.js — WHAT A SCREEN DOES AT NIGHT (readiness plan problem 6; proposal_quiet_hours_20261107.md, gated GO WITH
// CHANGES the same day). The plan found nights unplanned: a "dim after 10 minutes idle" and a "ring or not, all day", and
// nothing on a clock. This is the clock.
//
// *** OFF BY DEFAULT. *** Most screens are not in a bedroom, and a screen that dims itself at ten at night without being
// asked is a fault report. Turned on per SCREEN (it is about the room, as "Calls when there's no Call panel" is).
//
// WHILE ON, between From and To (they may cross midnight), each its own row:
//   * BRIGHTNESS (40% by default; 100/70/40/20): the screen dimmer. Every picture stays on screen: nothing is hidden, and
//     nothing waits for an input (the invariant). The kiosk combines it with burn-in's dim as the LOWER of the two.
//   * LOUDEST SOUND (40% by default): a CEILING on the audio bus (audio_bus.js `setCap`) for videos and music, game sounds
//     and spoken prompts. NEVER on calls or the AAC board's voice: a caller must be heard, and so must she. NEVER the
//     master: that is the person's own daytime volume, which a spoken "louder" moves; the ceiling comes off at morning and
//     the day's volume is exactly as it was.
//   * CALLS RING FOR (the one alert a call makes, call_notice.js): everyone as by day / only people who may drop in (the
//     default: on her screen, Mike) / nobody (the call still shows, silently, and Answer works).
//   * A DROP-IN AT NIGHT: as by day (it answers by itself) / rings and waits (the default). The gate's case: a drop-in
//     answers by itself, camera on, in a dark bedroom at 3 a.m. FOR "as by day": Mike checking on her. AGAINST, and it
//     decides the default: a camera opening on its own in a bedroom at night is the one thing in this list that cannot be
//     taken back; "as by day" is one choice away for the screen whose people want it.
//   * A PRESS lifts the dim and the ceiling for 10 minutes (5/10/30), so somebody sitting with her can see and hear. A press
//     is a pointerdown, a key or a switch: NOT a mouse moved (a bumped mouse must not light the room). The press still
//     does what it was for: this only listens.
//   * LIFTED BY ITSELF for the whole of a ring, a call, the intercom or a check-in (`held()`): no caller's face at 40%.
//
// THE CLOCK IS READ EVERY MINUTE, never one long timer to 07:00 (that drifts an hour across a clock change). It reads
// the device's own local time. [Risk, not fixable here: a Pi 400 has no clock battery; after a power cut with no internet
// it boots with the wrong time until it syncs, and quiet hours run at the wrong hours until then.]
//
// PURE apart from the controller's seams (`now`, timers, the audio bus, `onChange`).

export const QUIET_KEY = 'quietHours';
export const QUIET_DEFAULTS = Object.freeze({
  quietHours: false, quietFrom: 22, quietTo: 7, quietDim: 0.4, quietCap: 0.4, quietRing: 'dropin', quietDropIn: 'ring',
  quietLiftMin: 10,
});
// The channels a night ceiling reaches (audio_bus.js CHANNELS). Not 'call', not 'aac'.
export const QUIET_CAPPED = Object.freeze(['media', 'sfx', 'voice']);
export const QUIET_RINGS = Object.freeze(['all', 'dropin', 'none']);

const HALF_HOURS = Array.from({ length: 48 }, (_, i) => i / 2);
const pad = (n) => String(n).padStart(2, '0');
export const clockWords = (h) => { const n = ((Number(h) % 24) + 24) % 24; return `${pad(Math.floor(n))}:${pad(Math.round((n % 1) * 60))}`; };
const on = (v) => v?.quietHours === true;
const pct = (n) => `${Math.round(n * 100)}%`;

export const QUIET_FIELDS = Object.freeze([
  { key: 'quietHours', label: 'Quiet hours (a dimmer, quieter screen at night)', kind: 'toggle', default: false, level: 'standard',
    onLabel: 'On', offLabel: 'Off',
    note: 'Between the hours below: the screen dims, sound is capped, and calls ring only as chosen. Calls and the AAC '
      + 'board’s voice are never made quieter. A press brings it back for a while.' },
  { key: 'quietFrom', label: 'Quiet hours start at', kind: 'choice', default: 22, level: 'standard', appliesWhen: on,
    options: HALF_HOURS.map((h) => ({ value: h, label: clockWords(h) })) },
  { key: 'quietTo', label: 'Quiet hours end at', kind: 'choice', default: 7, level: 'standard', appliesWhen: on,
    options: HALF_HOURS.map((h) => ({ value: h, label: clockWords(h) })) },
  { key: 'quietDim', label: 'Brightness during quiet hours', kind: 'choice', default: 0.4, level: 'standard', appliesWhen: on,
    options: [1, 0.7, 0.4, 0.2].map((v) => ({ value: v, label: v === 1 ? '100% (not dimmed)' : pct(v) })) },
  { key: 'quietCap', label: 'Loudest sound during quiet hours', kind: 'choice', default: 0.4, level: 'standard', appliesWhen: on,
    options: [1, 0.6, 0.4, 0.2].map((v) => ({ value: v, label: v === 1 ? '100% (not capped)' : pct(v) })),
    note: 'Videos, music, game sounds and spoken prompts. Calls and the AAC board’s voice are never capped.' },
  { key: 'quietRing', label: 'During quiet hours, calls ring for', kind: 'choice', default: 'dropin', level: 'standard', appliesWhen: on,
    options: [
      { value: 'all', label: 'everyone, as by day' },
      { value: 'dropin', label: 'only people who may drop in' },
      { value: 'none', label: 'nobody (the call still shows, silently)' },
    ] },
  { key: 'quietDropIn', label: 'During quiet hours, a drop-in call', kind: 'choice', default: 'ring', level: 'standard', appliesWhen: on,
    options: [
      { value: 'ring', label: 'rings and waits for somebody to answer' },
      { value: 'day', label: 'answers by itself, as by day' },
    ] },
  { key: 'quietLiftMin', label: 'During quiet hours, a press brightens it for', kind: 'choice', default: 10, level: 'advanced', appliesWhen: on,
    options: [5, 10, 30].map((m) => ({ value: m, label: `${m} minutes` })) },
]);

const choiceOf = (key, v) => {
  const f = QUIET_FIELDS.find((x) => x.key === key);
  const hit = f && f.options ? f.options.find((o) => String(o.value) === String(v)) : null;
  return hit ? hit.value : QUIET_DEFAULTS[key];
};

/** A screen row's quiet-hours settings, every value checked (a broken one is its default). Pure. */
export function quietSettings(row = {}) {
  const r = row && typeof row === 'object' ? row : {};
  return {
    on: r.quietHours === true,
    from: choiceOf('quietFrom', r.quietFrom), to: choiceOf('quietTo', r.quietTo),
    dim: choiceOf('quietDim', r.quietDim), cap: choiceOf('quietCap', r.quietCap),
    ring: choiceOf('quietRing', r.quietRing), dropIn: choiceOf('quietDropIn', r.quietDropIn),
    liftMin: choiceOf('quietLiftMin', r.quietLiftMin),
  };
}

/** Is `date` (local time) inside From..To? Minutes, crossing midnight; From === To is never quiet. Pure. */
export function inQuietHours(date, from, to) {
  const f = Math.round(Number(from) * 60), t = Math.round(Number(to) * 60);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f === t) return false;
  const d = date instanceof Date ? date : new Date(date);
  const m = d.getHours() * 60 + d.getMinutes();
  return f < t ? (m >= f && m < t) : (m >= f || m < t);
}

/** May a call from somebody ring now? `mayDropIn`: whether the caller may drop in on this screen. Pure. */
export function quietRingAllows(state, mayDropIn) {
  if (!state || !state.quiet) return true;
  if (state.ring === 'all') return true;
  if (state.ring === 'none') return false;
  return !!mayDropIn;
}
/** Does a drop-in answer by itself now? Pure. */
export const quietDropInAnswers = (state) => !state || !state.quiet || state.dropIn === 'day';

/**
 * The controller. `row()` the screen's settings; `audio` the audio bus (setCap); `held()` true while a ring, call,
 * intercom or check-in is on (lifts it); `onChange(state)` hears every change: { quiet, lifted, dim (1 = none), ring,
 * dropIn }. `poke()` on a press. Read every minute (`tickMs`, a seam).
 */
export function createQuietHours({
  row = () => ({}), audio = null, held = () => false, onChange = null,
  now = () => new Date(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id), tickMs = 60000,
} = {}) {
  let liftedUntil = 0;
  let timer = null;
  let last = '';
  let dead = false;
  const read = (f, d) => { try { return f(); } catch { return d; } };
  function stateNow() {
    const s = quietSettings(read(row, {}));
    const t = read(now, new Date());
    const ms = t instanceof Date ? t.getTime() : Number(t);
    const quiet = s.on && inQuietHours(t, s.from, s.to);
    const lifted = quiet && (ms < liftedUntil || !!read(held, false));
    return { quiet, lifted, dim: quiet && !lifted ? s.dim : 1, cap: quiet && !lifted ? s.cap : null,
      ring: s.ring, dropIn: s.dropIn, liftMin: s.liftMin };
  }
  function apply() {
    if (dead) return null;
    const st = stateNow();
    for (const ch of QUIET_CAPPED) { try { audio?.setCap?.(ch, st.cap != null && st.cap < 1 ? st.cap : null); } catch { /* advice */ } }
    const sig = JSON.stringify(st);
    if (sig !== last) { last = sig; try { onChange?.(st); } catch (err) { console.error('quiet hours', err); } }
    return st;
  }
  function tick() { timer = null; apply(); if (!dead) timer = setTimer(tick, tickMs); }
  tick();
  return {
    state: stateNow,
    /** A press: lifts it for "a press brightens it for" minutes, only during quiet hours. */
    poke() {
      const st = stateNow();
      if (!st.quiet) return false;
      const t = read(now, new Date());
      liftedUntil = (t instanceof Date ? t.getTime() : Number(t)) + st.liftMin * 60000;
      apply();
      return true;
    },
    /** Read again now (a setting changed, a call started or ended). */
    refresh: apply,
    destroy() {
      dead = true;
      if (timer != null) { try { clearTimer(timer); } catch { /* gone */ } }
      for (const ch of QUIET_CAPPED) { try { audio?.setCap?.(ch, null); } catch { /* gone */ } }
    },
  };
}
