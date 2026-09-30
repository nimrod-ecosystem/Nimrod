// room_notify_editor.js — THE EDITOR FOR A ROOM'S NOTIFICATION RULES (room-add-ons §6).
//
// Design's sheet, drawn as a table: "When something happens · Event · Object · Does · Test",
// "+ Add a rule". Built here as rows of BUTTONS, because the one contract every editor on this site
// keeps is the settings menu's: ONE PRESS, ONE STEP. Each of Event / Object / Does / Sound steps to
// its next value on a press (`stepRule`), so a single switch can build any rule; Test fires that
// rule in the room; Remove takes it out. Nothing here needs a keyboard except a custom event's
// NAME, which is words, and the row says so.
//
//   const ed = mountNotifyEditor(host, { rules, objects, onChange, onTest, onDone });
//   ed.next() / ed.prev() / ed.select() / ed.back()      — the switch's verbs (the room routes its
//                                                          own room/next… here while this is open)
//
// *** THE WAY OUT FIRST. *** "Done" is the first thing in the DOM, the first scan stop, and where
// the cursor starts. The editor is never a gate: it takes no focus trap, no `aria-modal`, and the
// host closes it by itself after its idle time (modules/room.js uses "Put a lifted panel back
// after", the same way out a lifted panel has).
//
// *** THE ON-SCREEN CUE ALWAYS COMES TOO — the editor says so in words, above the rules. ***

import { NOTIFY_EVENTS_LIST, REACTIONS, SOUNDS, DEFAULT_RULES, objectLabel, stepRule, newRule, normalizeRule,
  NAME_MAX } from './room_notify.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function mountNotifyEditor(host, {
  rules = DEFAULT_RULES,
  objects = [],
  onChange = null,        // (rules | null) — null means "Design's defaults" (nothing stored)
  onTest = null,          // (rule)
  onDone = null,
  doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!host || !doc) return null;
  let list = (Array.isArray(rules) ? rules : DEFAULT_RULES).map((r) => normalizeRule(r)).filter(Boolean);
  let cursor = 0;
  let destroyed = false;
  const present = new Set(objects.map((o) => o.value));

  const el = doc.createElement('div');
  el.setAttribute('data-rn-editor', '');
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'What the room does when something happens');
  el.style.cssText = [
    'position:absolute', 'inset:8px', 'overflow:auto', 'z-index:40', 'box-sizing:border-box',
    'background:rgba(10,51,35,.96)', 'color:#e8f0ea', 'border:1px solid rgba(255,255,255,.22)',
    'border-radius:14px', 'padding:12px 14px', 'box-shadow:0 10px 40px rgba(0,0,0,.45)', 'font:inherit',
  ].join(';');
  host.append(el);

  const BTN = 'background:transparent;color:#e8f0ea;border:1px solid rgba(255,255,255,.3);border-radius:9px;'
    + 'padding:8px 10px;font:inherit;cursor:pointer;min-height:44px;text-align:left';
  const PRIMARY = 'background:#F7C948;color:#0A3323;border:0;border-radius:9px;padding:8px 14px;'
    + 'font:inherit;font-weight:700;cursor:pointer;min-height:44px';

  const label = {
    on: (r) => (r.on === 'custom' ? `Something else: ${r.name}` : NOTIFY_EVENTS_LIST.find((e) => e.value === r.on)?.label || r.on),
    object: (r) => (r.object == null ? 'No object' : `${objectLabel(r.object)}${present.has(r.object) ? '' : ' (not in this room)'}`),
    does: (r) => REACTIONS.find((x) => x.value === r.does)?.label || r.does,
    sound: (r) => SOUNDS.find((s) => s.value === (r.sound ?? null))?.label || 'No sound',
  };
  const ARIA = { on: 'When', object: 'Object', does: 'Does', sound: 'Sound' };

  function render() {
    const rows = list.map((r, i) => `
      <div data-rn-rule="${i}" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,.14)">
        ${['on', 'object', 'does', 'sound'].map((f) => `<button type="button" data-scan data-rn="${f}" data-i="${i}" style="${BTN}"
          aria-label="${ARIA[f]}: ${esc(label[f](r))}. Press to change.">${esc(label[f](r))}</button>`).join('')}
        ${r.on === 'custom' ? `<label style="display:flex;gap:6px;align-items:center;font-size:.9em">Name
          <input data-rn-name data-i="${i}" type="text" maxlength="${NAME_MAX}" value="${esc(r.name)}"
            style="font:inherit;min-height:36px;width:12ch" aria-label="The event’s name (needs a keyboard)">
          <small>(needs a keyboard)</small></label>` : ''}
        <button type="button" data-scan data-rn="test" data-i="${i}" style="${BTN}">Test</button>
        <button type="button" data-scan data-rn="remove" data-i="${i}" style="${BTN}">Remove</button>
      </div>`).join('');
    el.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button type="button" data-scan data-rn-done style="${PRIMARY}">Done</button>
        <h3 style="margin:0;font-size:1.05em">When something happens</h3>
      </div>
      <p style="margin:8px 0">Pick an event, an object, and what it does. The on-screen cue always comes too;
        the objects only add to it.</p>
      ${rows || '<p data-rn-empty style="margin:8px 0">No rules. Nothing in the room reacts; the on-screen cue still comes.</p>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button type="button" data-scan data-rn-add style="${BTN}">+ Add a rule</button>
        <button type="button" data-scan data-rn-defaults style="${BTN}">Put back the defaults</button>
      </div>`;
    paintCursor();
  }

  const stops = () => [...el.querySelectorAll('[data-scan]')];
  function paintCursor() {
    const s = stops();
    if (!s.length) return null;
    cursor = Math.max(0, Math.min(cursor, s.length - 1));
    s.forEach((b, i) => {
      const on = i === cursor;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
      b.style.outline = on ? '3px solid #F7C948' : '';
      b.style.outlineOffset = on ? '2px' : '';
    });
    return s[cursor];
  }

  function commit(next, defaults = false) {
    list = next;
    render();
    try { onChange?.(defaults ? null : list.map((r) => ({ ...r }))); } catch (err) { console.error('room reactions: onChange', err); }
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b) || destroyed) return;
    const s = stops();
    const at = s.indexOf(b);
    if (at >= 0) cursor = at;
    if (b.hasAttribute('data-rn-done')) { try { onDone?.(); } catch (err) { console.error('room reactions: onDone', err); } return; }
    if (b.hasAttribute('data-rn-add')) { const r = newRule(objects); if (r) commit([...list, r]); return; }
    if (b.hasAttribute('data-rn-defaults')) { commit(DEFAULT_RULES.map((r) => ({ ...r })), true); return; }
    const f = b.getAttribute('data-rn');
    const i = Number(b.getAttribute('data-i'));
    if (!f || !list[i]) return;
    if (f === 'test') { try { onTest?.({ ...list[i] }); } catch (err) { console.error('room reactions: onTest', err); } return; }
    if (f === 'remove') { commit(list.filter((_, k) => k !== i)); return; }
    commit(list.map((r, k) => (k === i ? stepRule(r, f, objects) : r)));
  });
  el.addEventListener('change', (e) => {
    const box = e.target.closest?.('[data-rn-name]');
    if (!box) return;
    const i = Number(box.getAttribute('data-i'));
    const name = String(box.value || '').trim().slice(0, NAME_MAX);
    if (!list[i] || !name || name === list[i].name) return;
    commit(list.map((r, k) => (k === i ? { ...r, name } : r)));
  });

  render();

  return {
    el,
    rules: () => list.map((r) => ({ ...r })),
    setRules(next) { list = (Array.isArray(next) ? next : DEFAULT_RULES).map(normalizeRule).filter(Boolean); render(); },
    focused: () => stops()[cursor] || null,
    next() { const s = stops(); if (!s.length) return null; cursor = (cursor + 1) % s.length; return paintCursor(); },
    prev() { const s = stops(); if (!s.length) return null; cursor = (cursor - 1 + s.length) % s.length; return paintCursor(); },
    select() { const b = stops()[cursor]; if (!b) return false; b.click(); return true; },
    back() { try { onDone?.(); } catch (err) { console.error('room reactions: onDone', err); } return true; },
    destroy() { if (destroyed) return; destroyed = true; el.remove(); },
  };
}
