// status_icons.js - ONE SMALL STRIP THAT SAYS, THE WHOLE TIME, WHAT ON THIS SCREEN SEES, HEARS, SENDS OR CONTROLS.
//
// Mike, 2026-10-14: "I feel like there should be something small that stays up the whole time like the recording icon
// does when it's recording. We maybe need to work with Design for a system that looks good for this." THE LOOK IS
// DESIGN'S; THE STATES ARE CODE'S. This file is the state layer and a plain strip to show it, with PLACEHOLDER glyphs
// (simple shapes, each marked `data-placeholder`) until Design sends the real ones. The brief that went to Design:
// Nimrod_Ecosystem/docs/for_chat/status_icons_brief_20261014.md.
//
// THE SHAPE:
//   * A REGISTRY. Each part of the screen reports its own state: `set(id, { on, label, who, kind })`. A part that has
//     no event to report from is WATCHED instead (`watch(id, probe)`): the probe is read on a slow tick (one second)
//     and whenever anything pokes the registry, so a state with no event still shows within a second.
//   * A STRIP (`mountStatusStrip`): tiny glyphs in a row, the FIRST row of the screen's notice column
//     (live_notices.js), so a glyph can never be drawn over a notice and a notice never over a glyph - the failure that
//     column exists to prevent. Above panels, below the bar and the menus (the column's band, layers.css `floating`).
//     Each glyph has its words as its accessible name and, on hover or focus, as a label beside it.
//   * NOTHING FLASHES. A glyph comes on AT ONCE when its part reports it (a watched one within a second; the screen
//     pokes the registry at every event it has, so most are immediate) and goes off only once it
//     has been on for `minOnMs` (2 s by default): a state flickering on and off (a microphone between two utterances)
//     is one steady glyph, not a blink. At most one off-and-on every two seconds, far under the 3-a-second line
//     (flash_limit.js, WCAG 2.3.1). No animation of any kind; the strip has no transition.
//   * THE NOTICES STAY. "Intercom open: Bea" with End, "Bea is checking in" with End, "Sharing your screen with" - the
//     wordy notices are unchanged and still say who, with the press that ends it. The strip is the always-there summary
//     beside them, and the one place a state with no notice of its own (the camera, the AI, offline) is shown at all.
//
// WHICH ICONS SHOW (Mike, 2026-10-14, on the check-in's notice: "Let's not make it hideable now"):
//   * Anything that SEES, HEARS, SENDS or CONTROLS - the camera, a microphone, sound or words leaving the screen,
//     somebody else's hands on it - is ON and NOT HIDEABLE NOW. A current choice, not a rule; `hideable: false` on a
//     definition is the one line to change when Mike reopens it.
//       FOR not hideable: these are the promise the screen makes to the room. A setting that hides "the camera is on" is
//       a setting somebody can turn off without the person in the room knowing, which is the whole thing the icon is for.
//       AGAINST: a family who set the screen up and knows the mirror is always on may find a glyph that never goes away
//       to be noise over the photos. Answered for now by the strip being a few small glyphs in a corner, not a banner.
//   * STATUS ONLY (nothing sees, hears, sends or controls - offline, locked, the stand-in, music on another speaker,
//     a local model) - a setting each, argued at each definition below. Off by default unless it explains something
//     somebody at the screen would otherwise be puzzled by.

import { noticeStack, ensureNoticeStyles } from './live_notices.js';

export const PRIVACY_KINDS = Object.freeze(['sees', 'hears', 'sends', 'controls']);
export const KINDS = Object.freeze([...PRIVACY_KINDS, 'status']);
export const MIN_ON_MS = 2000;
// music_player.js MUSIC_TOPICS.now, named here so the screen need not import the whole music router to hear it (the
// suite checks the two agree). `kind: 'spotify'` is Spotify playing on a speaker that is not this screen.
export const MUSIC_NOW_TOPIC = 'music/now';
export const POLL_MS = 1000;
const MAX_LABEL = 120;

// PLACEHOLDER GLYPHS (24x24, drawn in currentColor, told apart by SHAPE, never by colour alone). Design replaces these.
const G = {
  square: '<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="2"/>',
  micOut: '<rect x="5" y="4" width="5" height="9" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7.5 16v4M13 12h8M17.5 8.5 21 12l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="17.5" r="1.3" fill="currentColor"/>',
  camera: '<rect x="2.5" y="7" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 10.5 21.5 7v10l-6-3.5z" fill="currentColor"/>',
  call: '<path d="M6.5 3.5 9.5 3l1.5 4.5-2 1.5a10 10 0 0 0 6 6l1.5-2 4.5 1.5-.5 3a2 2 0 0 1-2 1.5A15.5 15.5 0 0 1 3.5 5.5a2 2 0 0 1 3-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  intercom: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/>',
  eye: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  eyeHalf: '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>',
  arrow: '<path d="M5 3l14 8-6 1.5L10 19z" fill="currentColor"/>',
  key: '<circle cx="8" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 12h9M18 12v3.5M21 12v2.5" fill="none" stroke="currentColor" stroke-width="2"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18.5z" fill="none" stroke="currentColor" stroke-width="2"/>',
  chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" stroke="currentColor" stroke-width="1.6"/>',
  note: '<path d="M9 17.5V5l9-2v12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6.5" cy="17.5" r="2.5" fill="currentColor"/><circle cx="15.5" cy="15" r="2.5" fill="currentColor"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="1.5" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/>',
  offline: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 18 18 6" stroke="currentColor" stroke-width="2"/>',
  picture: '<rect x="3" y="4.5" width="18" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5.5 17l4.5-5.5 3.5 4 2.5-2.5 3 4z" fill="currentColor"/>',
  dot: '<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/>',
};

// THE STATES (the inventory; the brief has each one's who-and-how-long). `order` is the strip's left-to-right order:
// what sees first, then hears, sends, controls, then the statuses. `setting` only on a hideable one.
export const STATUS_DEFS = Object.freeze([
  { id: 'camera', kind: 'sees', label: 'The camera is on', glyph: 'camera' },
  { id: 'checkin', kind: 'sees', label: 'Someone is checking in quietly', glyph: 'eye' },
  { id: 'watching', kind: 'sees', label: 'Sharing your screen', glyph: 'eyeHalf' },
  { id: 'recording', kind: 'hears', label: 'Recording voice for training', glyph: 'square' },
  { id: 'listening', kind: 'hears', label: 'Listening for spoken commands or subtitles', glyph: 'mic' },
  { id: 'phone-mic', kind: 'hears', label: 'A phone is a microphone here', glyph: 'phone' },
  { id: 'sound-away', kind: 'sends', label: 'What the room says goes to another computer to be written down', glyph: 'micOut' },
  { id: 'call', kind: 'sends', label: 'On a call', glyph: 'call' },
  { id: 'intercom', kind: 'sends', label: 'Intercom open', glyph: 'intercom' },
  { id: 'ai-away', kind: 'sends', label: 'Asking an AI over the internet', glyph: 'cloud' },
  { id: 'driving', kind: 'controls', label: 'Someone is helping from another screen', glyph: 'arrow' },
  { id: 'lent', kind: 'controls', label: 'Lent during a call', glyph: 'key' },
  // STATUS ONLY. Each default argued:
  // OFFLINE - ON by default. FOR: it is the answer to "why are there no new photos, why can't anyone call", and a carer
  //   at the screen has no other way to see it. AGAINST: on a screen that is offline on purpose it never goes away;
  //   that screen can switch it off.
  { id: 'offline', kind: 'status', label: 'No internet', glyph: 'offline', setting: 'statusIconOffline', defaultShow: true },
  // MUSIC ON ANOTHER SPEAKER - ON by default. FOR: the screen looks silent while it plays somewhere else, and "is the
  //   music on?" is a question somebody in the room asks; it is also this screen controlling another device. AGAINST:
  //   a household that plays to the kitchen speaker on purpose knows. Switchable.
  { id: 'music-away', kind: 'status', label: 'Music is playing on another speaker', glyph: 'note', setting: 'statusIconMusicAway', defaultShow: true },
  // LOCKED - OFF by default. The lock screen already says it, full size; a glyph as well says it twice.
  { id: 'locked', kind: 'status', label: 'This screen is locked', glyph: 'lock', setting: 'statusIconLocked', defaultShow: false, level: 'advanced' },
  // THE STAND-IN FOR A STALLED VIDEO - OFF by default. 4b4f06a already says it quietly once and then shows pictures;
  //   the pictures ARE the content, and a glyph over them for as long as the video stays stuck is a reminder of a fault
  //   nobody in the room can fix. Somebody diagnosing a screen can turn it on.
  { id: 'stand-in', kind: 'status', label: 'Showing pictures while a video will not play', glyph: 'picture', setting: 'statusIconStandIn', defaultShow: false, level: 'advanced' },
  // A LOCAL AI - OFF by default. Nothing leaves the screen (that is 'ai-away', which is not hideable); a glyph for
  //   every local question is a glyph that comes and goes with every game turn, for no promise kept.
  { id: 'ai-local', kind: 'status', label: 'Asking the AI on this computer', glyph: 'chip', setting: 'statusIconAiLocal', defaultShow: false, level: 'advanced' },
].map((d, i) => Object.freeze({ ...d, order: i, hideable: !!d.setting })));

const DEF = new Map(STATUS_DEFS.map((d) => [d.id, d]));

/** The menu's rows: one per hideable state. The others are not settings (not hideable now). */
export const STATUS_ICON_FIELDS = STATUS_DEFS.filter((d) => d.hideable).map((d) => ({
  key: d.setting, label: `Status icon: ${d.label.charAt(0).toLowerCase()}${d.label.slice(1)}`, kind: 'toggle',
  // `standard` for the two that are on by default; the three off by default are for somebody diagnosing a screen, so
  // they are "Everything" rows (`advanced`) and not stops on every switch walk round Display.
  default: d.defaultShow, level: d.level || 'standard',
}));
export const STATUS_ICONS_NOTE = 'the camera, a microphone, sound or words sent to another computer, a call, the intercom, '
  + 'a quiet check-in, sharing the screen, and someone else controlling it - no setting hides these';

const clean = (s, n = MAX_LABEL) => String(s == null ? '' : s).replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, n);
function whoText(who) {
  const list = (Array.isArray(who) ? who : [who]).map((w) => clean(w, 60)).filter(Boolean);
  if (!list.length) return '';
  if (list.length <= 3) return list.join(', ');
  return `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`;
}

/** Is this state shown, given the screen's settings? Pure. Not hideable -> always. */
export function statusShown(id, prefs = {}, kind = null) {
  const d = DEF.get(id);
  if (!d) return !(kind === 'status' && prefs && prefs[`statusIcon:${id}`] === false);
  if (!d.hideable) return true;
  const v = prefs && prefs[d.setting];
  return typeof v === 'boolean' ? v : d.defaultShow;
}

/** The words for one state: its label, and who, if anybody. Pure. */
export function statusText(id, { label = '', who = null } = {}) {
  const base = clean(label) || DEF.get(id)?.label || clean(id);
  const w = whoText(who);
  return w ? `${base}: ${w}` : base;
}

export function createStatusIcons({
  prefs = () => ({}),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  setTick = (fn, ms) => setInterval(fn, ms),
  clearTick = (id) => clearInterval(id),
  minOnMs = MIN_ON_MS,
  pollMs = POLL_MS,
} = {}) {
  const states = new Map();     // id -> { on, label, who, kind, since, offTimer }
  const probes = new Map();     // id -> probe()
  const fns = new Set();
  let tick = null;
  let dead = false;

  const emit = () => { for (const f of [...fns]) { try { f(); } catch (err) { console.error('status icons', err); } } };

  function apply(id, next) {
    const key = clean(id, 40);
    if (!key || dead) return;
    const d = DEF.get(key);
    const kind = KINDS.includes(next.kind) ? next.kind : (d?.kind || 'status');
    const cur = states.get(key);
    const on = next.on === true;
    if (on) {
      if (cur?.offTimer != null) { clearTimer(cur.offTimer); cur.offTimer = null; }
      const label = clean(next.label);
      const who = next.who == null ? null : next.who;
      const changed = !cur || !cur.on || cur.label !== label || whoText(cur.who) !== whoText(who) || cur.kind !== kind;
      states.set(key, { on: true, label, who, kind, since: cur?.on ? cur.since : now(), offTimer: null, pendingOff: false });
      if (changed) emit();
      return;
    }
    if (!cur || !cur.on || cur.pendingOff) return;
    // Off: at once if it has been on long enough, otherwise when it has (no blink).
    const left = minOnMs - (now() - cur.since);
    if (left <= 0) { states.delete(key); emit(); return; }
    cur.pendingOff = true;
    cur.offTimer = setTimer(() => {
      const c = states.get(key);
      if (c && c.pendingOff) { states.delete(key); emit(); }
    }, left);
  }

  function poll() {
    for (const [id, probe] of probes) {
      let v;
      try { v = probe(); } catch { v = false; }
      apply(id, v && typeof v === 'object' ? v : { on: !!v });
    }
  }

  const api = {
    /** A part reports its state. `on` true or false; `label` replaces the definition's words; `who` a name or names. */
    set(id, s = {}) { apply(id, s || {}); },
    /** A part with no event of its own: read on every tick and every poke. A probe returns a boolean or `{ on, ... }`. */
    watch(id, probe) {
      if (typeof probe !== 'function') return () => {};
      probes.set(id, probe);
      if (!tick && pollMs > 0 && !dead) tick = setTick(poll, pollMs);
      poll();
      return () => { if (probes.get(id) === probe) { probes.delete(id); apply(id, { on: false }); } };
    },
    /** Something changed; read the probes now rather than at the next tick. */
    poke: poll,
    /** Every state that is on, shown or not, in the strip's order. */
    all() {
      return [...states.entries()].filter(([, s]) => s.on).map(([id, s]) => {
        const d = DEF.get(id);
        return { id, kind: s.kind, label: s.label || d?.label || id, who: whoText(s.who) || null,
          text: statusText(id, s), glyph: d?.glyph || 'dot', privacy: PRIVACY_KINDS.includes(s.kind),
          hideable: d ? d.hideable : s.kind === 'status', order: d ? d.order : 1000, since: s.since };
      }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    },
    /** What the strip draws: on, and shown by the screen's settings. */
    active() {
      let p = {};
      try { p = prefs() || {}; } catch { p = {}; }
      return api.all().filter((s) => (s.privacy ? true : statusShown(s.id, p, s.kind)));
    },
    isOn: (id) => !!states.get(id)?.on,
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    /** The screen's settings changed: redraw (a hideable glyph may have been switched). */
    refresh: emit,
    destroy() {
      dead = true;
      if (tick != null) { clearTick(tick); tick = null; }
      for (const s of states.values()) if (s.offTimer != null) clearTimer(s.offTimer);
      states.clear(); probes.clear(); fns.clear();
    },
  };
  return api;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The strip: the first row of the host's notice column. Returns { el, draw, destroy }. */
export function mountStatusStrip(host, registry, { doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null) } = {}) {
  if (!host || !doc || !registry) throw new Error('mountStatusStrip: a host, a document and a registry are required');
  ensureNoticeStyles(doc);
  ensureStripStyles(doc);
  const col = noticeStack(host, doc);
  const el = doc.createElement('ul');
  el.className = 'status-icons';
  el.setAttribute('aria-label', 'Status');
  el.setAttribute('role', 'list');
  el.dataset.statusIcons = '';
  col.prepend(el);
  let sig = '';

  function draw() {
    const items = registry.active();
    const s = JSON.stringify(items.map((i) => [i.id, i.text]));
    el.hidden = items.length === 0;
    if (s === sig) return;
    sig = s;
    const keep = new Map([...el.children].map((li) => [li.dataset.status, li]));
    const next = [];
    for (const it of items) {
      let li = keep.get(it.id);
      if (!li) {
        li = doc.createElement('li');
        li.className = 'si';
        li.dataset.status = it.id;
        li.tabIndex = 0;
        const svg = doc.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.setAttribute('class', 'si-glyph');
        svg.setAttribute('data-placeholder', 'design');   // a placeholder until Design's own glyph arrives
        svg.innerHTML = G[it.glyph] || G.dot;
        const lab = doc.createElement('span');
        lab.className = 'si-label';
        li.append(svg, lab);
      }
      li.dataset.kind = it.kind;
      li.setAttribute('aria-label', it.text);
      li.title = it.text;
      li.querySelector('.si-label').textContent = it.text;
      next.push(li);
    }
    for (const [id, li] of keep) if (!items.some((i) => i.id === id)) li.remove();
    next.forEach((li) => el.append(li));   // in the registry's order
  }
  const off = registry.onChange(draw);
  draw();
  return {
    el, draw,
    destroy() { try { off(); } catch { /* gone */ } el.remove(); },
  };
}

function ensureStripStyles(doc) {
  if (doc.querySelector('link[data-status-icons-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./status_icons.css', import.meta.url).href;
    link.setAttribute('data-status-icons-css', '');
    doc.head.append(link);
  } catch { /* unstyled, still says it */ }
}

export const PLACEHOLDER_GLYPHS = Object.freeze(Object.keys(G));
