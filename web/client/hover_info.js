// hover_info.js — "HOVER OVER ANYTHING AND NIMROD TELLS YOU WHAT IT DOES."
//
// Mike, 2026-10-02: *"Hover over anything and Nimrod tells you what it does. Native Instruments has a
// feature like this in Kontakt or Maschine. I think Ableton Live does too."* Ableton's Info View and
// Kontakt's info pane are a fixed box that always describes the control under the mouse: nothing pops up,
// nothing waits, and you can ignore it. That is the shape here, in two places:
//   * the Nimrod module's own info area (modules/nimrod.js), when he is on the dashboard;
//   * a one-line status line along the bottom of the page (`mountInfoLine`) when he is not — Home's
//     setting "Explain what the pointer is on" turns it off.
//
// *** ONE SOURCE OF WORDS. *** What a thing IS comes from cat_help.js (`selectionAt` / `explain`): the same
// catalog lead for a panel, the same field help for a settings row, the same room-object lines the cat
// says when pressed. This file only decides WHEN to ask: the pointer arriving on something, the keyboard
// focus arriving on something, or the SCAN CURSOR arriving on something — a switch user has no pointer,
// and "hover" for them is where the scan is.
//
// *** NEVER A GATE, NEVER A POP-UP. *** The info area and the line are `aria-live="polite"` text in a box
// that is already there; nothing appears over anything, nothing takes focus, nothing waits for an answer.
// The line takes no pointer events, so it can never be in the way of the thing it describes.

import { explainAt } from './cat_help.js';

// What marks "the scan cursor is here" across the site, newest first: a settings row (`.st-item.on`), a
// focused panel (`data-focused`), a room object (`.is-scan`), Home's edit bar (`data-cursor`).
export const SCAN_MARKS = Object.freeze(['.st-item.on', '.k-cell[data-focused]', '.is-scan', '[data-cursor]']);
const SCAN_SEL = SCAN_MARKS.join(', ');
// The attributes those marks are set through, for the observer.
const SCAN_ATTRS = ['class', 'data-focused', 'data-cursor'];

/**
 * Watch `root` (an element or a document) and call `onInfo({ title, text, sel, via })` whenever the
 * pointer, the focus or the scan cursor arrives on something describable. `via`: 'pointer' | 'focus' |
 * 'scan'. Repeats are dropped (the same element twice says nothing new). `enabled()` is read at every
 * event, so a setting turned off takes effect at once. Returns { stop(), last() }.
 */
export function watchHover(root, { onInfo, enabled = () => true, chat = () => 'some' } = {}) {
  const doc = root?.ownerDocument || root;
  const host = root?.nodeType === 9 ? root.documentElement : root;
  if (!host || typeof onInfo !== 'function') return { stop() {}, last: () => null };
  let lastEl = null;
  let last = null;
  let stopped = false;
  const on = () => { try { return !!enabled(); } catch { return false; } };
  const level = () => { try { return chat() || 'some'; } catch { return 'some'; } };

  function tell(el, via) {
    if (stopped || !el || !on()) return;
    let words = null;
    try { words = explainAt(el, { chat: level() }); } catch { words = null; }
    if (!words || !words.text) return;
    const at = words.sel?.el || el;
    if (at === lastEl && via !== 'scan') return;
    lastEl = at;
    last = { title: words.title, text: words.text, via };
    try { onInfo({ ...last, sel: words.sel }); } catch (err) { console.error('hover info: onInfo', err); }
  }
  const onOver = (e) => tell(e.target, 'pointer');
  const onFocus = (e) => tell(e.target, 'focus');
  host.addEventListener('pointerover', onOver, true);
  host.addEventListener('focusin', onFocus, true);

  // The scan cursor: a mark ARRIVING on an element. Only marked elements are looked at, so the observer
  // costs almost nothing when nothing is being scanned.
  let obs = null;
  const View = doc?.defaultView;
  if (View && typeof View.MutationObserver === 'function') {
    obs = new View.MutationObserver((records) => {
      if (stopped || !on()) return;
      let hit = null;
      for (const r of records) {
        const t = r.target;
        if (t?.nodeType === 1 && t.matches?.(SCAN_SEL)) hit = t;
      }
      if (hit) tell(hit, 'scan');
    });
    obs.observe(host, { subtree: true, attributes: true, attributeFilter: SCAN_ATTRS });
  }

  return {
    stop() {
      stopped = true;
      host.removeEventListener('pointerover', onOver, true);
      host.removeEventListener('focusin', onFocus, true);
      try { obs?.disconnect(); } catch { /* gone */ }
    },
    last: () => (last ? { ...last } : null),
  };
}

// ---------------------------------------------------------------------------------------------------
// THE STATUS LINE: Nimrod's info area when he is not on the dashboard. One line of text along the
// bottom of the page, in the theme's own colours (tokens, never a hard colour), that takes no pointer
// events. `idle` is what it says before anything has been pointed at, and when it is turned back on.
// `hidden()` — the host says when not to show it (the Nimrod module is on screen and saying it himself).
// ---------------------------------------------------------------------------------------------------
export const INFO_LINE_IDLE = 'Point at anything and Nimrod will tell you what it does.';

export function mountInfoLine(doc = (typeof document !== 'undefined' ? document : null), {
  root = null, enabled = () => true, hidden = () => false, idle = INFO_LINE_IDLE, chat = () => 'some',
} = {}) {
  if (!doc?.body) return null;
  const line = doc.createElement('div');
  line.className = 'nimrod-infoline';
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  line.setAttribute('data-hover-ignore', '');
  line.style.cssText = [
    'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:8000', 'pointer-events:none',
    'padding:6px 16px', 'font-size:.9rem', 'line-height:1.35', 'white-space:nowrap', 'overflow:hidden',
    'text-overflow:ellipsis', 'background:var(--surface)', 'color:var(--text)',
    'border-top:1px solid var(--border)', 'opacity:.96',
  ].join(';');
  const title = doc.createElement('b');
  const text = doc.createElement('span');
  line.append(title, text);
  doc.body.append(line);

  const show = (t, s) => { title.textContent = t ? `${t}: ` : ''; text.textContent = s || ''; };
  const idleText = () => { try { return (typeof idle === 'function' ? idle() : idle) || INFO_LINE_IDLE; } catch { return INFO_LINE_IDLE; } };
  let pointed = false;           // something has been explained since the last reset
  const sync = () => {
    let off = false;
    try { off = !enabled() || !!hidden(); } catch { off = true; }
    line.hidden = off;
    doc.body.classList.toggle('has-infoline', !off);
    if (!pointed) show('', idleText());
  };
  sync();
  const w = watchHover(root || doc, {
    enabled: () => { try { return !!enabled(); } catch { return false; } },
    chat,
    onInfo: (i) => { pointed = true; sync(); show(i.title, i.text); },
  });
  return {
    el: line,
    sync,
    text: () => line.textContent,
    say: (t, s) => { pointed = true; show(t, s); },
    reset: () => { pointed = false; show('', idleText()); },
    destroy() { w.stop(); line.remove(); doc.body.classList.remove('has-infoline'); },
  };
}
