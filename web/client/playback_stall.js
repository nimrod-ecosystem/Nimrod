// playback_stall.js - WHEN PLAYBACK STOPS BY ITSELF: try to fix it, say so if wanted, and after a while show
// something else, until it works again.
//
// Mike, 2026-10-13 (DECISIONS.md, "Also to build"; note BW item 7): *"when a video is paused, frozen or loading for a
// while, try to fix it where settings allow, notify if wanted, and a setting to switch to something else after a set
// time (YouTube to pictures on a drive when the internet is out). Replaces 'let people know after'."*
//
// THREE PIECES, kept apart so each can be tested without the others:
//
//   1. THE SETTINGS (`stallFields`, `stallSettings`). One set of rows, declared once, added to every panel that plays
//      (YouTube, Personal videos, Live nature cams, the Internet Archive). Each number is a choice with a default and
//      its argument below (Rule 1).
//   2. THE REPORT (`createStallReporter`), panel side. A panel already knows when it is stuck - its own watchdog
//      (watchdog.js) fires - so it says so ON THE BUS, once per stretch of being stuck, and says when it plays again.
//      What it carries is the panel's own "switch" settings, so the screen needs no access to the panel's row.
//   3. THE SWITCH (`createStallSwitch`), screen side (kiosk.js). A panel that has been stuck for the panel's
//      "switch after" time is replaced, in its own place, by what the panel asked for (pictures from this screen's
//      backup folder by default). While the stand-in shows, the original is checked every "check again" interval
//      and put back BY ITSELF the moment it works. No press is ever needed, either way.
//
// WHAT COUNTS AS STUCK, and what does not (detection lives in each panel, which knows its own player):
//   * loading longer than "Counts as stuck after" (`stallMs`): the video never started.
//   * playing, but the position has not moved for that long (FROZEN): youtube.js's progress poll.
//   * buffering, or paused by nobody, for that long: a pause on a panel with no pause button (personal.js) is the
//     system, not a person.
//   * an error from the player, or the player itself not loading (no internet).
//   NOT STUCK: A PERSON'S OWN PAUSE. It is held, never "fixed", never switched away from (Mike, 2026-08-30: a pause
//   stays a pause). The panel says "Paused" the whole time, so nobody mistakes it for a crash. The only thing that can
//   happen to a held pause is the notice below, and only if somebody asked for notices.
//
// THE SAFETY INVARIANT (AGENTS.md / CLAUDE.md): a screen must never enter a state only an input can leave when the
// person in front of it cannot give that input. Every state here has a way out that needs nobody: the fix ladder runs
// out and moves on by itself; the switch comes back by itself; nothing here is a dialog; a notice is a line or a
// banner that goes by itself. "Leave it as it is" (fix off) is somebody's explicit choice, and even then the switch
// (its own row) still shows something else after the set time unless that is set to "Never" as well.

export const STALL_TOPIC = 'playback/stall';
export const STALL_OK_TOPIC = 'playback/ok';

const MIN = 60 * 1000;

// ----------------------------------------------------------------------------------------------------------------
// THE DEFAULTS, each argued (both sides; the one chosen first). Listed for Mike's list in the report.
// ----------------------------------------------------------------------------------------------------------------
export const STALL_DEFAULTS = Object.freeze({
  // COUNTS AS STUCK AFTER: 20 seconds - the number youtube.js and personal.js already used ("long enough that a
  // slow-but-working load on facility wifi isn't cut off, short enough that nobody sits in front of a frozen screen
  // for long"). Shorter cuts off slow loads; longer is that much longer looking at a spinner.
  stallMs: 20000,
  // TRY TO FIX IT: on. The fixes are the ones the panels already made (carry on, reload, the next item); turning them
  // off is for somebody who would rather see the problem than have the screen paper over it (a person debugging).
  stallFix: true,
  // TRIES BEFORE MOVING ON: 2. The ladder per item is: (1) carry on from where it stopped - instant, keeps the place;
  // (2) load it again AT THE SAME PLACE - what a frozen picture needs, since "carry on" does nothing to a player that
  // thinks it is playing; then the next item. FOR 1 (what it was): a dead video is left 20 s sooner. AGAINST: a long
  // video that froze at minute 30 was skipped, never reloaded, and its place was lost. 3 adds a third reload that has
  // rarely worked when two did not.
  stallTries: 2,
  // SAY WHEN IT GETS STUCK: a quiet line on the panel. 'alerts' adds a notice through this screen's alerts (the output
  // bus `notify`: by default a banner and a tone on this screen, by the person's own routing) when the panel switches
  // to something else, and when a pause has been left longer than the pause time. FOR the line only: the notice today
  // reaches only THIS screen (there is no remote channel yet, output.js), so it would tell the room what the panel
  // already says - and a tone in the room at 3 a.m. because the internet blinked is the false alarm that teaches
  // everybody to ignore alerts (recovery.js). AGAINST: the pause notice was on by default before (2026-08-30). A row
  // that set the old pause time keeps its notice (see `stallSettings`), so nobody's choice is undone.
  stallNotify: 'panel',
  // A PAUSE COUNTS AS LEFT AFTER: six hours - the old "let people know after" time (Mike, 2026-08-30). Used only for
  // 'alerts'. Kept under its old key because its meaning did not change: how long a held pause runs before a notice.
  heldNotifyMs: 6 * 60 * MIN,
  // SWITCH TO SOMETHING ELSE AFTER: 5 minutes of being stuck. Long enough that the fix ladder (about a minute for one
  // dead item, longer across a playlist) gets its chance and a blip never switches anything; short enough that a
  // screen whose internet is out shows pictures within minutes rather than a dead video all evening. AGAINST ON BY
  // DEFAULT: a panel changing by itself can surprise somebody; "Never" is one press, and it comes back by itself.
  stallSwitchMs: 5 * MIN,
  // SWITCH TO: pictures from this screen's backup folder ("Backup folder for this screen", This screen tab), else a
  // folder on this computer that this screen can see - Mike's "pictures on a drive". The clock or moving colors are
  // there for a screen with no pictures. The NEXT ITEM is already what the fix ladder does, and in a content director
  // the director moves on by itself ('segment/done'), so it is not offered again here.
  stallSwitchTo: 'backup',
  // CHECK AGAIN EVERY: 1 minute while something else is showing - the backup-source recheck's own number
  // (media_sources.js SOURCE_RECHECK_MS): one small request, well inside how long anybody would notice. Shorter is
  // more requests at a network that is down; longer leaves the stand-in up that much after it is back.
  stallBackMs: MIN,
});

export const NOTIFY_MODES = Object.freeze(['panel', 'alerts', 'off']);

// What a panel can switch to, and what each mounts. `backup` is a photos panel pointed at the backup folder.
export const SWITCH_TARGETS = Object.freeze({
  backup: { type: 'photos', words: 'pictures are' },
  clock: { type: 'clock', words: 'the clock is' },
  wallpaper: { type: 'wallpaper', words: 'moving colors are' },
});

const num = (v, d, lo = 0, hi = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/**
 * THE SETTINGS IN FORCE, from a panel's own row (only the keys somebody set; defaults filled here). PURE.
 *
 * *** A ROW THAT CHOSE THE OLD "let people know after" KEEPS ITS NOTICE. *** That row set `heldNotifyMs` to a time and
 * meant "tell people". With no `stallNotify` of its own and a non-zero `heldNotifyMs` it reads as 'alerts', so the
 * new default of a line on the panel never silently undoes somebody's earlier choice. A row that never set it gets
 * the new default.
 */
export function stallSettings(row = {}) {
  const r = row && typeof row === 'object' ? row : {};
  const D = STALL_DEFAULTS;
  let notify = NOTIFY_MODES.includes(r.stallNotify) ? r.stallNotify : null;
  if (!notify) notify = (r.heldNotifyMs != null && Number(r.heldNotifyMs) > 0) ? 'alerts' : D.stallNotify;
  const switchTo = Object.prototype.hasOwnProperty.call(SWITCH_TARGETS, r.stallSwitchTo) ? r.stallSwitchTo : D.stallSwitchTo;
  return {
    stallMs: num(r.stallMs, D.stallMs, 0),
    fix: r.stallFix === undefined || r.stallFix === null ? D.stallFix : r.stallFix !== false,
    tries: Math.round(num(r.stallTries, D.stallTries, 0, 5)),
    notify,
    heldNotifyMs: num(r.heldNotifyMs, D.heldNotifyMs, 0),
    switchMs: num(r.stallSwitchMs, D.stallSwitchMs, 0),
    switchTo,
    backMs: num(r.stallBackMs, D.stallBackMs, 1000),
  };
}

/** How long a held pause runs before its notice, or 0 for no notice at all. PURE. */
export function pauseNoticeMs(row = {}) {
  const s = stallSettings(row);
  return s.notify === 'alerts' ? s.heldNotifyMs : 0;
}

/**
 * THE ROWS, declared once for every panel that plays. `parts` picks which: a panel whose own words already say what
 * is wrong (Live nature cams, the Internet Archive) takes only the switch and the notice; a panel with its own long-
 * standing start wait (Live nature cams' "try the next one after") does not take `stallMs`.
 *   'fix'    stallFix, stallTries, stallMs
 *   'notify' stallNotify (+ heldNotifyMs when `pause` is true)
 *   'switch' stallSwitchMs, stallSwitchTo, stallBackMs
 * LEVELS, argued: the three a family needs (fix, say, switch) are standard; the numbers inside them are advanced,
 * because a switch user walks every standard row of a panel's menu on every lap (the reason "If this can't be
 * reached, use" is advanced, media_sources.js).
 */
export function stallFields({ parts = ['fix', 'notify', 'switch'], pause = true, stuckWait = true } = {}) {
  const want = new Set(parts);
  const rows = [];
  const switching = (v) => Number(v?.stallSwitchMs ?? STALL_DEFAULTS.stallSwitchMs) > 0;
  if (want.has('fix')) {
    rows.push({ key: 'stallFix', label: 'When playing stops by itself', default: STALL_DEFAULTS.stallFix,
      level: 'standard', onLabel: 'Try to fix it', offLabel: 'Leave it as it is',
      note: 'Stuck means loading, frozen or buffering for longer than the time below, or paused when nobody paused it. '
        + 'Fixing it means carrying on, loading it again at the same place, then the next one. A pause somebody made '
        + 'is never undone.' });
    rows.push({ key: 'stallTries', label: 'Tries before the next one', kind: 'choice', default: STALL_DEFAULTS.stallTries,
      level: 'advanced', appliesWhen: (v) => v?.stallFix !== false,
      options: [
        { value: 1, label: '1 (carry on, then the next one)' },
        { value: 2, label: '2 (carry on, load it again, then the next one)' },
        { value: 3, label: '3' },
      ] });
    if (stuckWait) {
      rows.push({ key: 'stallMs', label: 'Counts as stuck after', kind: 'choice', default: STALL_DEFAULTS.stallMs,
        level: 'advanced',
        options: [
          { value: 10000, label: '10 seconds' },
          { value: 20000, label: '20 seconds' },
          { value: 45000, label: '45 seconds' },
          { value: 2 * MIN, label: '2 minutes (slow internet)' },
        ] });
    }
  }
  if (want.has('notify')) {
    rows.push({ key: 'stallNotify', label: 'Say when it gets stuck', kind: 'choice', default: STALL_DEFAULTS.stallNotify,
      level: 'standard',
      options: [
        { value: 'panel', label: 'A quiet line on the panel' },
        { value: 'alerts', label: 'The line, and a notice in this screen’s alerts' },
        { value: 'off', label: 'Say nothing' },
      ],
      note: 'A notice is sent when it switches to something else, and when a pause has been left a long time. '
        + 'It is never a box anybody has to close.' });
    if (pause) {
      rows.push({ key: 'heldNotifyMs', label: 'A pause counts as left after', kind: 'choice',
        default: STALL_DEFAULTS.heldNotifyMs, level: 'advanced',
        appliesWhen: (v) => stallSettings(v).notify === 'alerts',
        options: [
          { value: 60 * MIN, label: '1 hour' },
          { value: 6 * 60 * MIN, label: '6 hours' },
          { value: 12 * 60 * MIN, label: '12 hours' },
          { value: 0, label: 'Never (no notice about a pause)' },
        ],
        note: 'A paused video stays paused. This is only when the notice is sent.' });
    }
  }
  if (want.has('switch')) {
    rows.push({ key: 'stallSwitchMs', label: 'If it stays stuck, show something else after', kind: 'choice',
      default: STALL_DEFAULTS.stallSwitchMs, level: 'standard',
      options: [
        { value: MIN, label: '1 minute' },
        { value: 5 * MIN, label: '5 minutes' },
        { value: 15 * MIN, label: '15 minutes' },
        { value: 60 * MIN, label: '1 hour' },
        { value: 0, label: 'Never' },
      ],
      note: 'For when the internet is out. It comes back by itself as soon as it plays again.' });
    rows.push({ key: 'stallSwitchTo', label: 'Show instead', kind: 'choice', default: STALL_DEFAULTS.stallSwitchTo,
      level: 'standard', appliesWhen: switching,
      options: [
        { value: 'backup', label: 'Pictures from this screen’s backup folder' },
        { value: 'clock', label: 'The clock' },
        { value: 'wallpaper', label: 'Moving colors' },
      ],
      note: 'The backup folder is set in This screen. With none set, a picture folder on this computer is used.' });
    rows.push({ key: 'stallBackMs', label: 'While something else shows, check again every', kind: 'choice',
      default: STALL_DEFAULTS.stallBackMs, level: 'advanced', appliesWhen: switching,
      options: [
        { value: 30 * 1000, label: '30 seconds' },
        { value: MIN, label: '1 minute' },
        { value: 5 * MIN, label: '5 minutes' },
      ] });
  }
  return rows;
}

// ----------------------------------------------------------------------------------------------------------------
// THE REPORT - panel side
// ----------------------------------------------------------------------------------------------------------------

/**
 * One per panel. `stuck(reason)` starts a stretch of being stuck (said once; later calls in the same stretch are
 * quiet), `ok()` ends it (it played), `gone()` says the panel is going away (hidden, destroyed), `refresh()` re-says
 * an open stretch with the settings as they are now. `row()` is the panel's own settings row; `directed()` whether a
 * content director drives it (the director moves on by itself, so the screen does not switch it).
 */
export function createStallReporter({ bus, panel, type, title = '', row = () => ({}), directed = () => false,
  now = () => Date.now() } = {}) {
  let since = null;
  let reason = null;
  const say = (topic, payload) => { try { bus?.publish?.(topic, payload); } catch (err) { console.error('playback-stall: report', err); } };
  function payload() {
    const s = stallSettings(safe(row));
    let dir = false;
    try { dir = !!directed(); } catch { dir = false; }
    return { panel, type, title, reason, since, directed: dir, notify: s.notify,
      switchMs: s.switchMs, switchTo: s.switchTo, backMs: s.backMs };
  }
  return {
    stuck(why = 'stuck') {
      if (since != null) return false;
      since = now();
      reason = String(why || 'stuck');
      say(STALL_TOPIC, payload());
      return true;
    },
    ok() {
      if (since == null) return false;
      since = null; reason = null;
      say(STALL_OK_TOPIC, { panel, type });
      return true;
    },
    gone() {
      if (since == null) return false;
      since = null; reason = null;
      say(STALL_OK_TOPIC, { panel, type, gone: true });
      return true;
    },
    refresh() { if (since != null) say(STALL_TOPIC, payload()); },
    stuckSince: () => since,
  };
}
function safe(fn) { try { return (typeof fn === 'function' ? fn() : fn) || {}; } catch { return {}; } }

// ----------------------------------------------------------------------------------------------------------------
// IS IT BACK? - the check made while something else shows
// ----------------------------------------------------------------------------------------------------------------

// Where each internet panel's content comes from. One tiny request (`no-cors`: nothing is read, only whether an answer
// came) to the place the panel was already talking to. Nothing about the screen or the person goes with it.
export const PROBE_URLS = Object.freeze({
  youtube: 'https://www.youtube-nocookie.com/favicon.ico',
  livecams: 'https://www.youtube-nocookie.com/favicon.ico',
  karaoke: 'https://www.youtube-nocookie.com/favicon.ico',
  archive: 'https://archive.org/favicon.ico',
});
// How long one check waits for an answer: 10 seconds. A reply slower than that is not a network anybody can watch a
// video over; a shorter wait would call a slow-but-working connection down.
export const PROBE_WAIT_MS = 10000;

/** Can this computer reach `url` now? Never rejects. */
export function reachProbe(url, { fetchFn = (typeof fetch === 'function' ? fetch : null), waitMs = PROBE_WAIT_MS,
  online = () => (typeof navigator !== 'undefined' && navigator && 'onLine' in navigator ? navigator.onLine : true) } = {}) {
  return new Promise((done) => {
    try { if (online() === false) { done(false); return; } } catch { /* unknown: ask */ }
    if (!fetchFn || !url) { done(false); return; }
    let finished = false;
    const end = (v) => { if (!finished) { finished = true; done(v); } };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl?.abort(); } catch { /* fine */ } end(false); }, waitMs);
    const sep = url.includes('?') ? '&' : '?';
    Promise.resolve()
      .then(() => fetchFn(`${url}${sep}t=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', credentials: 'omit',
        referrerPolicy: 'no-referrer', ...(ctl ? { signal: ctl.signal } : {}) }))
      .then(() => { clearTimeout(t); end(true); }, () => { clearTimeout(t); end(false); });
  });
}

/**
 * The check for a panel type. A type with a known address is asked over the network. Any other (Personal videos,
 * which plays from this screen's own folder or helper) has nothing outside it to ask, so the answer is "try it":
 * the panel is put back, and if it is stuck again straight away the screen switches back at once (see
 * `createStallSwitch`) and waits longer before the next try.
 */
export function probeFor(type, opts = {}) {
  const url = PROBE_URLS[type];
  if (url) return () => reachProbe(url, opts);
  return null;
}

// ----------------------------------------------------------------------------------------------------------------
// THE SWITCH - screen side
// ----------------------------------------------------------------------------------------------------------------

// A panel that is stuck again within this long of being put back was not really back: the screen switches to the
// stand-in at once rather than waiting the whole "switch after" time again, and the next try waits twice as long
// (up to BACKOFF_MAX_MS). Without this a panel whose check says yes but whose content still will not play (a
// network that answers small requests and not video) would show a dead panel for minutes in every ten.
export const BACKOFF_MAX_MS = 30 * MIN;

/**
 * `swap(panel, target, info)`  put the stand-in in the panel's place; true when it did
 * `restore(panel, info)`       put the panel back
 * `probe(type)`                a function answering "is it back?", or null to just try (see `probeFor`)
 * `currentType(panel)`         what is in that place now (the arrangement may have been rebuilt meanwhile)
 * `notify(text, info)`         the alerts notice; `line(text)` the quiet line on the screen
 * Timers and the clock are injected so the whole thing runs against a fake clock.
 */
export function createStallSwitch({ bus, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id), swap, restore, probe = probeFor, currentType = () => null,
  notify = null, line = null, onChange = null } = {}) {
  const recs = new Map();        // panel -> { phase: 'stuck'|'switched', info, timer, to, wait }
  const restoredAt = new Map();  // panel -> { at, wait } (the back-off memory)
  const offs = [];
  let dead = false;

  const told = (what) => { try { onChange?.(what); } catch { /* a listener must not stop this */ } };
  const stop = (rec) => { if (rec && rec.timer != null) { clearTimer(rec.timer); rec.timer = null; } };

  function onStuck(p) {
    if (dead || !p || !p.panel || p.directed) return;
    const rec = recs.get(p.panel);
    if (rec && rec.phase !== 'stuck') return;             // switching or switched: only the check brings it back
    const next = { phase: 'stuck', info: { ...p }, timer: null };
    if (rec) stop(rec);
    recs.set(p.panel, next);
    arm(next);
  }
  function onOk(p) {
    if (dead || !p || !p.panel) return;
    const rec = recs.get(p.panel);
    if (!rec) return;
    // The original going away IS the switch: its `gone` arrives while the stand-in is being put in its place.
    if (rec.phase !== 'stuck') return;
    stop(rec);
    recs.delete(p.panel);
    if (!p.gone) restoredAt.delete(p.panel);                // it really played: the back-off starts over
  }

  function arm(rec) {
    stop(rec);
    const ms = Number(rec.info.switchMs) || 0;
    if (!(ms > 0)) return;                                  // "Never"
    const back = restoredAt.get(rec.info.panel);
    // Stuck again soon after being put back: straight back to the stand-in.
    const quick = back && now() - back.at < Math.max(ms, Number(rec.info.backMs) || 0) * 2;
    const since = Number(rec.info.since) || now();
    const wait = quick ? 0 : Math.max(0, since + ms - now());
    rec.timer = setTimer(() => { rec.timer = null; fire(rec); }, wait);
  }

  async function fire(rec) {
    if (dead || recs.get(rec.info.panel) !== rec || rec.phase !== 'stuck') return;
    const info = rec.info;
    const target = SWITCH_TARGETS[info.switchTo] ? info.switchTo : STALL_DEFAULTS.stallSwitchTo;
    rec.phase = 'switching';
    let did = false;
    try { did = !!(await swap(info.panel, target, info)); } catch (err) { console.error('playback-stall: switch', err); did = false; }
    if (dead || recs.get(info.panel) !== rec) return;
    if (!did) { recs.delete(info.panel); told({ kind: 'no-switch', panel: info.panel }); return; }
    rec.phase = 'switched';
    rec.to = SWITCH_TARGETS[target].type;
    const prev = restoredAt.get(info.panel);
    // The wait before the first check: the panel's own interval, doubled after each try that did not hold.
    rec.wait = prev && now() - prev.at < Math.max(Number(info.switchMs) || 0, Number(info.backMs) || 0) * 2
      ? Math.min(BACKOFF_MAX_MS, Math.max(Number(info.backMs) || STALL_DEFAULTS.stallBackMs, (prev.wait || 0) * 2))
      : (Number(info.backMs) || STALL_DEFAULTS.stallBackMs);
    const name = info.title || 'This panel';
    const words = `${name} stopped playing, so ${SWITCH_TARGETS[target].words} showing until it plays again.`;
    if (info.notify !== 'off') { try { line?.(words, info); } catch { /* the line is not load-bearing */ } }
    if (info.notify === 'alerts') { try { notify?.(words, info); } catch (err) { console.error('playback-stall: notice', err); } }
    told({ kind: 'switched', panel: info.panel, to: rec.to });
    armBack(rec);
  }

  function armBack(rec) {
    stop(rec);
    rec.timer = setTimer(() => { rec.timer = null; check(rec); }, rec.wait);
  }

  async function check(rec) {
    if (dead || recs.get(rec.info.panel) !== rec || rec.phase !== 'switched') return;
    const info = rec.info;
    // The arrangement was rebuilt under the stand-in (a dashboard change, a layout saved elsewhere): whatever is in
    // that place now is not ours to put back.
    let here = null;
    try { here = currentType(info.panel); } catch { here = null; }
    if (here !== rec.to) { recs.delete(info.panel); told({ kind: 'forgot', panel: info.panel }); return; }
    let back = true;
    const ask = typeof probe === 'function' ? probe(info.type) : null;
    if (typeof ask === 'function') {
      try { back = !!(await ask()); } catch { back = false; }
    }
    if (dead || recs.get(info.panel) !== rec || rec.phase !== 'switched') return;
    if (!back) { armBack(rec); return; }
    recs.delete(info.panel);
    restoredAt.set(info.panel, { at: now(), wait: rec.wait });
    let did = false;
    try { did = !!(await restore(info.panel, info)); } catch (err) { console.error('playback-stall: back', err); }
    if (did && info.notify !== 'off') { try { line?.(`${info.title || 'The panel'} is back.`, info); } catch { /* fine */ } }
    told({ kind: 'restored', panel: info.panel, ok: did });
  }

  if (bus) {
    offs.push(bus.subscribe(STALL_TOPIC, onStuck));
    offs.push(bus.subscribe(STALL_OK_TOPIC, onOk));
  }

  return {
    /** For a suite and the screen's handle: what is stuck or switched now. */
    status: () => [...recs.entries()].map(([panel, r]) => ({ panel, phase: r.phase, to: r.to || null,
      since: r.info.since, wait: r.wait || null })),
    switched: (panel) => recs.get(panel)?.phase === 'switched',
    /** Put a switched panel back now (a person asked, or a suite). */
    async restoreNow(panel) {
      const rec = recs.get(panel);
      if (!rec || rec.phase !== 'switched') return false;
      stop(rec);
      recs.delete(panel);
      try { return !!(await restore(panel, rec.info)); } catch { return false; }
    },
    destroy() {
      dead = true;
      for (const r of recs.values()) stop(r);
      recs.clear();
      restoredAt.clear();
      while (offs.length) { try { offs.pop()?.(); } catch { /* gone */ } }
    },
  };
}

// ----------------------------------------------------------------------------------------------------------------
// WHICH PICTURES - the stand-in's folder
// ----------------------------------------------------------------------------------------------------------------

const isLocal = (s) => !!s && (s.kind === 'folder' || s.kind === 'device'
  || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(String(s.base_url || '')));

/**
 * The source the "pictures" stand-in shows, or '' to let the photos panel decide as it always does. PURE.
 *   * The screen's backup folder, when it names one (and this screen may show it - never another resident's).
 *   * Otherwise ('' or 'any'), a folder ON THIS COMPUTER first - Mike's "pictures on a drive", the one thing still
 *     there when the internet is out - then any other source this screen may show. The person's own come before the
 *     account's (media_sources.js `fallbackSources`, the same rule).
 *   * 'none' (the screen's backup set to nothing): '' - nothing is chosen for it.
 * `sources` are the rows this screen has listed (media_sources.js `listedSources`), already limited to what this
 * screen may show.
 */
export function standInSource({ screenBackup = '', sources = [], personId = null } = {}) {
  const list = (Array.isArray(sources) ? sources : []).filter((s) => s && s.id);
  const may = (s) => !s.person_id || (!!personId && s.person_id === personId);
  const b = String(screenBackup == null ? '' : screenBackup);
  if (b === 'none') return '';
  if (b && b !== 'any') {
    const hit = list.find((s) => s.id === b);
    return hit && may(hit) ? hit.id : '';
  }
  const ok = list.filter(may);
  const own = (s) => !!personId && s.person_id === personId;
  const ranked = [...ok.filter((s) => isLocal(s) && own(s)), ...ok.filter((s) => isLocal(s) && !own(s)),
    ...ok.filter((s) => !isLocal(s) && own(s)), ...ok.filter((s) => !isLocal(s) && !own(s))];
  return ranked[0]?.id || '';
}
