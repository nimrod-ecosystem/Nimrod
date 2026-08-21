// composer.js — the DASHBOARD COMPOSER: arrange a screen's modules into a layout.
//
// A tab inside home, not a page of its own. Pick a screen, pick how it's divided, drop a
// module into each slot. "Save & open" commits it and launches it; "Preview" launches the
// arrangement you are looking at WITHOUT saving, so a layout can be tried and abandoned.
//
// The preview is built from the SAME `layout.js` grid helpers the kiosk renders with, so
// what you arrange here and what appears on the screen cannot drift apart — the usual way
// a mock-up-style editor starts lying to you.
//
// Assignment is by dropdown rather than drag-and-drop, deliberately for now: it works on a
// touch screen and with a keyboard, which drag does not without a lot of extra code. The
// slot grid is the real spatial model, so drag can be added on top later without changing
// anything that is stored.

import { stashPreviewLayout } from './preview.js';
import {
  PRESETS, preset, normalizeLayout, isArranged, gridStyle, slotStyle, placement,
} from './layout.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// `embedded` drops the heading and the screen-picker chips, because when this is mounted
// INSIDE a screen's own card the screen is already chosen and named above it. `autosave`
// removes the Save button entirely and commits shortly after each change — Mike arranged a
// four-up layout, pressed Open without pressing Save, and got the unsaved (empty) one. The
// fix is not a better warning; it is not having a step you can forget.
export function mountComposer(root, {
  profiles, manifests = [], makeSettings, onOpen = null, initialProfileId = null,
  embedded = false, autosave = false, saveDelayMs = 350,
} = {}) {
  const titleOf = (type) => (manifests.find((m) => m.type === type) || {}).title || type;
  const open = onOpen || ((id) => { location.href = `/kiosk.html?profile=${encodeURIComponent(id)}`; });

  let list = [];          // profiles (with modules)
  let current = null;     // the profile being arranged
  let settings = null;    // its settings state handle
  let layout = { preset: 'full', slots: [null] };
  let dirty = false;
  let busy = false;
  let saveTimer = null;

  // Debounced: changing a preset re-renders every slot, and a person clicking through
  // presets should not fire a write per click.
  function queueSave() {
    if (!autosave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, saveDelayMs);
  }
  // Anything that must act on the CURRENT arrangement has to land the pending write first.
  async function settle() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await save(); }
  }

  const el = (sel) => root.querySelector(sel);
  const say = (t, bad = false) => {
    const m = el('[data-cmsg]');
    if (m) { m.textContent = t || ''; m.classList.toggle('bad', !!bad); }
  };

  function modules() { return (current && current.modules) || []; }

  function slotCell(id, i) {
    const mod = modules().find((m) => m.id === id);
    const options = [`<option value="">— empty —</option>`].concat(
      modules().map((m) =>
        `<option value="${esc(m.id)}" ${m.id === id ? 'selected' : ''}>${esc(titleOf(m.type))}</option>`),
    ).join('');
    return `
      <div class="c-slot" style="${slotStyle(layout.preset, i)}" data-slot="${i}">
        <div class="c-slot-n">${i + 1}</div>
        <div class="c-slot-name">${mod ? esc(titleOf(mod.type)) : '<span class="c-empty">empty</span>'}</div>
        <select class="c-pick" data-assign="${i}" aria-label="module for slot ${i + 1}">${options}</select>
      </div>`;
  }

  function render() {
    if (!el('[data-composer]')) return;

    // screen picker (absent when embedded — the card around it already names the screen)
    const picker = el('[data-screens]');
    if (picker) picker.innerHTML = list.length
      ? list.map((p) =>
          `<button class="c-chip${current && p.id === current.id ? ' on' : ''}" data-screen="${esc(p.id)}">${esc(p.name)}</button>`).join('')
      : '<span class="c-note">No screens yet — make one above.</span>';

    const body = el('[data-cbody]');
    if (!current) { body.innerHTML = ''; return; }

    if (!modules().length) {
      body.innerHTML = `<p class="c-note">“${esc(current.name)}” has no modules yet.
        Add some on the Screens tab, then arrange them here.</p>`;
      return;
    }

    const { unplaced } = placement(layout, modules());
    body.innerHTML = `
      <div class="c-presets" data-presets>
        ${PRESETS.map((p) =>
          `<button class="c-chip${p.id === layout.preset ? ' on' : ''}" data-preset="${esc(p.id)}">${esc(p.label)}</button>`).join('')}
      </div>
      <div class="c-grid" style="${gridStyle(layout.preset)}">
        ${layout.slots.map((id, i) => slotCell(id, i)).join('')}
      </div>
      <p class="c-note">${unplaced.length
        ? `Not on screen: ${unplaced.map((m) => esc(titleOf(m.type))).join(', ')} — still saved, just not shown.`
        : 'Every module is placed.'}</p>
      <div class="c-actions">
        ${autosave ? '' : `<button class="c-btn c-primary" data-save ${dirty ? '' : 'disabled'}>Save layout</button>`}
        <button class="c-btn" data-open>${autosave ? 'Open' : 'Save &amp; open'}</button>
        <button class="c-btn" data-preview>Preview</button>
        <button class="c-btn" data-clear>Clear</button>
      </div>`;

    for (const b of root.querySelectorAll('[data-preset]')) {
      b.addEventListener('click', () => {
        // Keep what still fits when the shape changes; a narrower preset drops the tail
        // rather than silently reshuffling everything the person just arranged.
        layout = normalizeLayout({ preset: b.dataset.preset, slots: layout.slots }, modules().map((m) => m.id));
        dirty = true; render(); queueSave();
      });
    }
    for (const sel of root.querySelectorAll('[data-assign]')) {
      sel.addEventListener('change', () => {
        const i = Number(sel.dataset.assign);
        const id = sel.value || null;
        const slots = [...layout.slots];
        // One instance can only be in one place: clear it wherever else it sat.
        if (id) for (let k = 0; k < slots.length; k++) if (slots[k] === id) slots[k] = null;
        slots[i] = id;
        layout = normalizeLayout({ preset: layout.preset, slots }, modules().map((m) => m.id));
        dirty = true; render(); queueSave();
      });
    }
    const saveBtn = el('[data-save]');
    if (saveBtn) saveBtn.addEventListener('click', save);
    // Two ways out, because they are genuinely different intentions.
    // "Save & open" commits first: opening while `dirty` used to launch the last SAVED
    // layout (often none at all), which looked exactly like the composer ignoring
    // everything you had just arranged.
    el('[data-open]').addEventListener('click', async () => {
      await settle();
      if (dirty) {
        await save();
        if (dirty) return;              // save failed; `say()` already explained why
      }
      open(current.id);
    });
    // "Preview" commits nothing: it hands the CURRENT arrangement to the kiosk for one
    // load, so a layout can be tried — or swapped to temporarily — without becoming the
    // screen. Reloading there returns to the saved one.
    el('[data-preview]').addEventListener('click', () => {
      clearTimeout(saveTimer); saveTimer = null;   // previewing must not commit anything
      stashPreviewLayout(current.id, layout);
      open(current.id);
    });
    el('[data-clear]').addEventListener('click', () => {
      layout = normalizeLayout({ preset: layout.preset, slots: [] }, []);
      dirty = true; render(); queueSave();
    });
  }

  async function save() {
    if (busy || !current || !settings) return;
    busy = true;
    try {
      const cur = settings.get().kiosk || {};
      // Store `null` when nothing is arranged, so the kiosk falls back to its normal
      // one-at-a-time stage instead of showing an empty grid.
      settings.set({ kiosk: { ...cur, layout: isArranged(layout) ? layout : null } });
      await settings.flush();
      dirty = false;
      say(isArranged(layout) ? 'Layout saved.' : 'Layout cleared — the screen shows one module at a time.');
      render();
    } catch (err) {
      console.error(err);
      say('That didn’t save — check your connection and try again.', true);
    } finally { busy = false; }
  }

  async function select(pid) {
    const p = list.find((x) => x.id === pid);
    if (!p) return;
    current = p;
    if (settings) settings.destroy();
    settings = makeSettings(p.id);
    await settings.load().catch(() => {});
    layout = normalizeLayout((settings.get().kiosk || {}).layout, modules().map((m) => m.id));
    dirty = false;
    say('');
    render();
  }

  async function refresh() {
    const raw = await profiles.list();
    list = await Promise.all(raw.map((p) => profiles.get(p.id).catch(() => ({ ...p, modules: [] }))));
    const keep = (current && list.find((p) => p.id === current.id)) || null;
    render();
    const target = keep || list.find((p) => p.id === initialProfileId) || list[0];
    if (target) await select(target.id);
  }

  root.innerHTML = embedded
    ? `<div class="composer c-embedded" data-composer>
         <p class="c-lead">Pick how this screen is divided, then put a module in each slot.
           Changes save as you make them.</p>
         <div class="c-msg" data-cmsg></div>
         <div data-cbody></div>
       </div>`
    : `<div class="composer" data-composer>
         <h1>Dashboard composer</h1>
         <p class="c-lead">Choose a screen, pick how it's divided, and put a module in each slot.
           “Save &amp; open” keeps this arrangement; “Preview” just tries it.</p>
         <div class="c-screens" data-screens></div>
         <div class="c-msg" data-cmsg></div>
         <div data-cbody></div>
       </div>`;

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-screen]');
    if (b) select(b.dataset.screen);
  });

  return {
    refresh,
    select,
    layout: () => layout,
    settle,
    destroy() {
      clearTimeout(saveTimer); saveTimer = null;
      if (settings) { settings.destroy(); settings = null; }
    },
  };
}
