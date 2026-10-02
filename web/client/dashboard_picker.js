// dashboard_picker.js — THE DASHBOARD PICKER: the tray the bar's Home button opens (row 2.34).
//
// Mike, 2026-09-30: *"Maybe have a dashboard select part in the transport bar where you can jump between
// them."* It is the strip that has hung above the bar since G11 (kiosk.js `drawScreens`), grown into a
// tray of the person's dashboards PLUS the ready-made ones they have not made yet ("+ Room", ...), and
// made reachable the three ways row 2.34 asks for:
//   * the SCAN -- while it is open it takes the verbs (next / prev / select / back) the way the settings
//     menu does, and a cursor shows where a press will land. The kiosk pauses the panel router meanwhile,
//     so "next" moves the cursor, not the photo underneath;
//   * a SWITCH -- `system/dashboards` (actions.js) opens it; bind any switch to it;
//   * VOICE -- "computer please my dashboards" opens it, and "go to <name>" / "go to my room" skip it
//     (dashboards.js PREBUILT_ROUTES and `dashboardSpeechRoutes`).
//
// *** STILL A STRIP, NOT A SCRIM (the G11 safety argument, unchanged). *** Whatever is playing keeps
// playing and stays visible; the tray covers a row above the bar. It puts itself away with the bar's own
// auto-hide (the kiosk's "what if nobody answers"), by Close, by Back, by Escape and by Home again. Its
// way out is its FIRST stop (Design: "Lifted panels and dialogs take over the scan, and their way out
// comes first"), so a stray select lands on Close.
//
// This file draws and keeps the cursor. What a press DOES (swap, make, leave) is the kiosk's: it is
// handed in, so the tray never reaches into the screen.

const CURSOR_OUTLINE = '3px solid var(--accent, #2c6e49)';

/**
 * `el` is the tray (kiosk.js's `[data-screens]`). Handlers, all optional:
 *   onClose()            Close was pressed
 *   onPick(id)           one of the person's dashboards
 *   onMake(key)          a ready-made one not made yet
 *   onLeave()            the way out to the composer (a navigation, which leaves full screen)
 * `draw(model)`:  { list: [{ id, name }], current, offers: [{ key, label, blurb }], making: key|null,
 *                   note: string|null, empty: string|null }
 */
export function createDashboardPicker(el, { onClose, onPick, onMake, onLeave } = {}) {
  let cursor = 0;
  let model = null;

  const buttons = () => [...el.querySelectorAll('button.k-scr')].filter((b) => !b.disabled);

  function paint() {
    const bs = buttons();
    if (!bs.length) { cursor = 0; return; }
    if (cursor >= bs.length) cursor = bs.length - 1;
    if (cursor < 0) cursor = 0;
    for (const b of el.querySelectorAll('button.k-scr')) {
      delete b.dataset.cursor;
      b.style.outline = '';
      b.style.outlineOffset = '';
    }
    const at = bs[cursor];
    at.dataset.cursor = '1';
    at.style.outline = CURSOR_OUTLINE;
    at.style.outlineOffset = '2px';
  }

  function button(cls, text, attrs = {}, title = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `k-scr${cls ? ` ${cls}` : ''}`;
    b.textContent = text;
    if (title) b.title = title;
    for (const [k, v] of Object.entries(attrs)) b.dataset[k] = v;
    el.append(b);
    return b;
  }
  function note(text, live = false) {
    const p = document.createElement('div');
    p.className = 'k-scr-note';
    if (live) { p.setAttribute('role', 'status'); p.setAttribute('aria-live', 'polite'); }
    p.textContent = text;
    el.append(p);
  }

  function draw(m) {
    model = m || { list: [], offers: [] };
    const keepKey = buttons()[cursor]?.dataset?.pickKey || null;
    el.innerHTML = '';
    // The way out, first.
    button('k-scr-close', '✕ Close', { pick: 'close', pickKey: 'close' }, 'put this away');
    if (model.empty) note(model.empty);
    for (const d of model.list || []) {
      const b = button(d.id === model.current ? 'on' : '', d.name || 'Dashboard',
        { pick: 'dashboard', id: d.id, pickKey: `d:${d.id}` });
      b.disabled = d.id === model.current;
      if (b.disabled) b.setAttribute('aria-current', 'true');
    }
    for (const o of model.offers || []) {
      const making = model.making === o.key;
      const b = button('k-scr-new', making ? `Making ${o.label}…` : `+ ${o.label}`,
        { pick: 'prebuilt', key: o.key, pickKey: `p:${o.key}` }, o.blurb || '');
      b.disabled = !!model.making;
    }
    if (model.note) note(model.note, true);
    const out = button('k-scr-out', 'Set up dashboards ↗', { pick: 'leave', pickKey: 'leave' },
      'opens the composer — this does leave full screen, because it leaves the screen');
    out.disabled = false;
    // Keep the cursor on the same thing across a redraw (a "making" redraw must not jump it to Close).
    const i = keepKey ? buttons().findIndex((b) => b.dataset.pickKey === keepKey) : -1;
    if (i >= 0) cursor = i;
    paint();
  }

  function press(b) {
    if (!b || b.disabled) return;
    const kind = b.dataset.pick;
    if (kind === 'close') onClose?.();
    else if (kind === 'dashboard') onPick?.(b.dataset.id);
    else if (kind === 'prebuilt') onMake?.(b.dataset.key);
    else if (kind === 'leave') onLeave?.();
  }

  const onClick = (e) => {
    const b = e.target.closest?.('button.k-scr');
    if (!b || !el.contains(b)) return;
    const i = buttons().indexOf(b);
    if (i >= 0) { cursor = i; paint(); }
    press(b);
  };
  el.addEventListener('click', onClick);

  return {
    draw,
    reset() { cursor = 0; paint(); },
    next() { const n = buttons().length; if (n) { cursor = (cursor + 1) % n; paint(); } },
    prev() { const n = buttons().length; if (n) { cursor = (cursor - 1 + n) % n; paint(); } },
    select() { press(buttons()[cursor]); },
    /** What the cursor is on, and every stop, for a suite and a diagnostic page. */
    cursor: () => { const b = buttons()[cursor]; return b ? { kind: b.dataset.pick, id: b.dataset.id || null, key: b.dataset.key || null, text: b.textContent } : null; },
    items: () => [...el.querySelectorAll('button.k-scr')].map((b) => ({ kind: b.dataset.pick, id: b.dataset.id || null,
      key: b.dataset.key || null, text: b.textContent, disabled: b.disabled })),
    model: () => model,
    destroy() { el.removeEventListener('click', onClick); },
  };
}
