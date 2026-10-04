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
import { mergeLayoutSave, lostEditWords } from './doc_merge.js';

// *** A SAVE MERGES ONTO THE LAYOUT AS IT IS NOW (2026-10-04, later; the writer ddf57d7 left). *** The composer
// keeps its own copy of the layout from the moment it loaded, and Save used to write that copy whole -- so a panel
// moved, or a room changed, on another device while the composer was open was put back. Now `base` is the layout as
// saved that the copy was made from (the load, then each save), and Save merges the copy onto the doc as it is at the
// save (doc_merge.js `mergeLayoutSave`, the placed list by id: this page moves modules between the grid and the free
// placement, which adds and removes entries). In a true clash the other device's value stands -- the kiosk's
// CONFLICT_PREFER, for its reason (doc_merge.js header) -- and the status line says so, in the one wording.
// The copy is then the merge, so what this page shows is what was saved. (No Undo here to keep in step with it.)
const COMPOSER_CONFLICT_PREFER = 'theirs';

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
  let base = undefined;   // the layout AS SAVED that `layout` was made from (see the header); undefined: not loaded
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
    // Stage R: modules PLACED freely (in the scene, flat on screen, overlay) are not in this grid and
    // this composer does not edit them (the edit windows do) -- but it names them, so nothing sits on
    // a screen that the page arranging that screen does not mention.
    const freely = (layout.placed || []).map((p) => modules().find((m) => m.id === p.id)).filter(Boolean);
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
      ${freely.length ? `<p class="c-note" data-freely>Placed freely: ${freely.map((m) => esc(titleOf(m.type))).join(', ')}
        — moved with the edit windows, not in this grid.</p>` : ''}
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
        // `...layout`: the placed list and the scene ride along (Stage R) -- this line used to rebuild
        // the layout from preset + slots alone, which dropped them on the next autosave.
        layout = normalizeLayout({ ...layout, preset: b.dataset.preset, slots: layout.slots }, modules().map((m) => m.id));
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
        // A module put in a slot leaves the free placement (one place per instance: normalizeLayout's
        // rule, the slot wins); everything else placed freely rides along.
        layout = normalizeLayout({ ...layout, slots }, modules().map((m) => m.id));
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
      // Clear empties the GRID. What is placed freely stays: this composer does not show it as
      // something Clear would remove, and removing what a button does not show is a surprise. (Stage R;
      // on Mike's list with the other side argued.) The ids are re-checked against the modules.
      layout = normalizeLayout({ ...layout, slots: [] }, modules().map((m) => m.id));
      dirty = true; render(); queueSave();
    });
  }

  async function save() {
    if (busy || !current || !settings) return;
    busy = true;
    try {
      // The doc as it is NOW (this handle is not polled), so a change made elsewhere since the load is seen.
      if (typeof settings.load === 'function') await settings.load().catch(() => {});
      const cur = (settings.get() || {}).kiosk || {};
      // Store `null` when nothing is arranged, so the kiosk falls back to its normal
      // one-at-a-time stage instead of showing an empty grid.
      const mine = layout;
      const next = isArranged(mine) ? mine : null;
      const m = mergeLayoutSave(base, next, cur.layout ?? null, { prefer: COMPOSER_CONFLICT_PREFER, byId: true });
      settings.set({ kiosk: { ...cur, layout: m.layout } });
      await settings.flush();
      base = m.layout ?? null;
      // The copy becomes what was saved -- with anything changed HERE while the save was out laid back on top
      // (merged as this page's own, onto the save it was made against).
      const ids = modules().map((x) => x.id);
      if (layout === mine) {
        // (Nothing merged in: the copy stays as it is -- a cleared grid keeps its shape although `null` was stored.)
        if (m.merged) layout = normalizeLayout(m.layout, ids);
        dirty = false;
      } else if (!m.merged) {
        dirty = true;
        queueSave();
      } else {
        layout = normalizeLayout(mergeLayoutSave(mine, layout, m.layout, { prefer: 'mine', byId: true }).layout, ids);
        dirty = true;
        queueSave();
      }
      const what = isArranged(m.layout) ? 'Layout saved.' : 'Layout cleared — the screen shows one module at a time.';
      if (m.lost.length) say(`${what} ${lostEditWords(m.lost, current.name || null)}`, true);
      else say(m.merged ? `${what} A change made on another device is kept too.` : what);
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
    base = ((settings.get() || {}).kiosk || {}).layout ?? null;
    layout = normalizeLayout(base, modules().map((m) => m.id));
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
