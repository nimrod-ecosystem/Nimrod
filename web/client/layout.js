// layout.js — how a screen is ARRANGED. The one thing the composer and the kiosk must
// agree on, so it lives in neither of them.
//
// A layout is a preset plus a slot assignment:
//
//     { preset: 'quad', slots: ['<moduleId>', '<moduleId>', null, '<moduleId>'] }
//
// Slots hold MODULE INSTANCE IDs, not types, because one screen can hold two of the same
// module (two photo panels pointed at different folders) and they must stay distinct.
// A null slot renders empty — a half-built arrangement is a normal state to be in, not an
// error, and the composer should never refuse to save one.
//
// The kiosk falls back to its original one-module-at-a-time stage when a profile has no
// layout, so every screen that existed before this file keeps working untouched.

export const PRESETS = [
  { id: 'full',  label: 'Full screen', slots: 1, cols: '1fr',     rows: '1fr' },
  { id: 'side',  label: 'Side by side', slots: 2, cols: '1fr 1fr', rows: '1fr' },
  { id: 'stack', label: 'Stacked',      slots: 2, cols: '1fr',     rows: '1fr 1fr' },
  { id: 'quad',  label: 'Four up',      slots: 4, cols: '1fr 1fr', rows: '1fr 1fr' },
  { id: 'main',  label: 'Main + two',   slots: 3, cols: '2fr 1fr', rows: '1fr 1fr',
    // slot 0 spans both rows of the left column; 1 and 2 stack on the right.
    areas: ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'] },
];

export const DEFAULT_PRESET = 'full';

export function preset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS.find((p) => p.id === DEFAULT_PRESET);
}

export function slotCount(id) { return preset(id).slots; }

// Bring any stored layout into a shape the renderer can trust:
//   * an unknown preset falls back to the default rather than blanking the screen;
//   * the slot list is padded/truncated to the preset's slot count;
//   * a module that has since been REMOVED from the profile is dropped (its id no longer
//     resolves, and rendering a dangling reference is how a kiosk ends up blank);
//   * a module appearing twice keeps only its first slot — one instance cannot be mounted
//     into two places at once.
export function normalizeLayout(layout, validIds = []) {
  const valid = new Set(validIds);
  const p = preset(layout && layout.preset);
  const seen = new Set();
  const slots = [];
  const raw = Array.isArray(layout && layout.slots) ? layout.slots : [];
  for (let i = 0; i < p.slots; i++) {
    const id = raw[i];
    if (id && valid.has(id) && !seen.has(id)) { seen.add(id); slots.push(id); }
    else slots.push(null);
  }
  return { preset: p.id, slots };
}

// Has anyone actually arranged anything? An all-empty layout is treated as "no layout",
// so saving a preset and then walking away doesn't leave a blank kiosk.
export function isArranged(layout) {
  return !!(layout && Array.isArray(layout.slots) && layout.slots.some(Boolean));
}

// The CSS a renderer needs for the container and each slot. Kept here so the composer's
// little preview and the real kiosk cannot drift apart.
export function gridStyle(presetId) {
  const p = preset(presetId);
  return `display:grid;grid-template-columns:${p.cols};grid-template-rows:${p.rows};`;
}

export function slotStyle(presetId, i) {
  const p = preset(presetId);
  return p.areas && p.areas[i] ? `grid-area:${p.areas[i]};` : '';
}

/**
 * *** RESOLVE A SAVED LAYOUT AGAINST THE MODULES THAT ACTUALLY EXIST — AND REPAIR ORPHANS. ***
 *
 * `normalizeLayout` correctly nulls a slot whose module id is gone; it cannot render something
 * that is not there. What it could not know is that downstream, a null slot is skipped
 * silently AND the fallback stage is switched off whenever a layout exists at all. So a module
 * that was still in the profile, but whose slot had been orphaned, rendered NOWHERE — not in
 * its slot, not on the stage.
 *
 * Reported off the live site three ways at once: a Photos panel missing from an arranged
 * screen, an arrangement "not being what renders", and a screen announcing *"This screen's
 * panels were removed"* while its panel sat in the profile, un-removed.
 *
 * Two repairs, and both are repairs rather than preferences:
 *
 *   1. **An orphaned slot gets an unplaced module**, if one is going spare. ONLY slots that
 *      held something and lost it — an intentionally empty slot stays empty, because "three
 *      panels and a gap" is an arrangement somebody may have meant. This fixes corruption
 *      without overriding intent. Camera and clock are never treated as spare: an unplaced one
 *      of those is a HUD overlay by design, not a panel waiting for a home.
 *   2. **An arrangement that resolves to nothing is not an arrangement.** Returning null hands
 *      the caller back to its own no-layout path, which renders the modules that do exist.
 *
 * Lives here rather than in the kiosk because two callers already resolve layouts — the kiosk
 * at boot and again on a screen swap — and a third (`view.js`) renders them. One copy.
 */
export function resolveLayout(saved, modules = []) {
  if (!isArranged(saved)) return null;
  const l = normalizeLayout(saved, modules.map((m) => m.id));
  const rawSlots = Array.isArray(saved && saved.slots) ? saved.slots : [];
  const placed = new Set(l.slots.filter(Boolean));
  const spare = modules.filter((m) => !placed.has(m.id)
    && m.type !== 'camera' && m.type !== 'clock');
  for (let i = 0; i < l.slots.length && spare.length; i++) {
    if (!l.slots[i] && rawSlots[i]) l.slots[i] = spare.shift().id;
  }
  return l.slots.some(Boolean) ? l : null;
}

// Which modules are placed, and which are left over — the composer shows both.
export function placement(layout, modules = []) {
  const l = normalizeLayout(layout, modules.map((m) => m.id));
  const placed = new Set(l.slots.filter(Boolean));
  return { layout: l, unplaced: modules.filter((m) => !placed.has(m.id)) };
}
