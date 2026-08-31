// device_panel.js — CHOOSING A MICROPHONE, AND SAYING WHAT TO FALL BACK TO.
//
// The visible half of `device_pick.js`. It lives on home under Devices, with the switches and
// the marker tracker, because a microphone is a device like any other device.
//
// ---------------------------------------------------------------------------------------
// IT IS A LIST, IN ORDER — NOT A DROPDOWN
// ---------------------------------------------------------------------------------------
//
// A single "which microphone?" picker cannot express the thing that actually happens in that
// room: the best microphone is often the one that is only there SOMETIMES. A visitor's phone
// hears far better than a webcam across the room, and it leaves when they do.
//
// So the control is an ordered list — best first — and the software walks down it. Which means
// the panel's job is not "pick one" but "say what you would like, and what to do instead."
//
// ---------------------------------------------------------------------------------------
// *** NO DRAG AND DROP. *** (docs/module-input-spec.md, and it is not negotiable here)
// ---------------------------------------------------------------------------------------
//
// Reordering by dragging is the obvious design and it is unreachable for a large part of the
// people this product exists for: *"Modules must not assume a pointer. Everything reachable by
// one button, walked in one direction, and wrapping."* This is a caregiver-facing panel, but a
// caregiver may be the person with the tremor, and a control that only works with a steady hand
// on a mouse is a control somebody cannot use to set up their own screen.
//
// So: up and down buttons, which work with a mouse, a touchscreen, a keyboard and a switch.
//
// ---------------------------------------------------------------------------------------
// THE EMPTY-LABEL TRAP
// ---------------------------------------------------------------------------------------
//
// Every browser returns microphones with BLANK labels until permission has been granted once.
// A chooser that renders those shows "Microphone 1, Microphone 2, Microphone 3", which is not a
// chooser — it is a guess. So when the labels are not real yet, this shows one button asking for
// permission instead of a list, and says why.

import { describePick } from './device_pick.js';

export const DEVICE_KEY = 'devices';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Move an entry within an ordered list. Pure, and exported, because "did the arrows do the right
// thing" is the whole behaviour of this panel and it should not need a DOM to check.
//
// It CLAMPS rather than wrapping, which is the opposite of the rule for a scanning cursor — and
// deliberately. A cursor that stops at the end strands somebody; a list item that wraps from top
// to bottom when somebody presses "up" once too often has silently made their last choice their
// first, which is a worse surprise than a button that does nothing.
export function moveEntry(list, index, delta) {
  const out = (Array.isArray(list) ? list : []).slice();
  const to = index + delta;
  if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out;
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

// The ordered preference, joined with what is actually plugged in, ready to render.
//
// It shows BOTH: the devices somebody chose (in their order, marked present or missing) and the
// ones that are here but unchosen. A panel that only listed what is present would make a phone
// that has left the room vanish from the settings that mention it — so somebody would "fix" it
// by removing the entry, and lose the fallback the moment it came back.
export function buildRows(preferred, available) {
  const want = (Array.isArray(preferred) ? preferred : []).filter(Boolean);
  const have = (Array.isArray(available) ? available : []).filter((d) => d && d.id);
  const byId = new Map(have.map((d) => [d.id, d]));
  const rows = want.map((id, i) => ({
    id,
    label: byId.get(id)?.label || '',
    present: byId.has(id),
    rank: i,
    chosen: true,
  }));
  const extra = have
    .filter((d) => !want.includes(d.id))
    .map((d) => ({ id: d.id, label: d.label, present: true, rank: -1, chosen: false }));
  return { rows, extra };
}

export function mountDevicePanel(root, {
  owner,                                  // a mic owner (or any owner with list/labelled/choose)
  kind = 'microphone',
  settings = () => ({}),
  save = async () => {},
  // Asking for permission is the only way to make labels real. It is a real prompt, so it is
  // never done on mount — only when somebody presses the button that says it will.
  requestPermission = null,
  documentRef = (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!root) throw new Error('mountDevicePanel: a root element is required');
  if (!owner) throw new Error('mountDevicePanel: a device owner is required');

  const prefKey = `${kind}Preferred`;
  const preferred = () => {
    const v = (settings() || {})[prefKey];
    return Array.isArray(v) ? v.filter(Boolean) : [];
  };

  let available = [];
  let labelled = true;
  let destroyed = false;

  root.innerHTML = `
    <div class="dv">
      <h3>Which ${esc(kind)}</h3>
      <p class="dv-lede">In order, best first. If the top one is not connected, the next one is
        used automatically — so a ${esc(kind)} that is only in the room sometimes does not need
        anybody to change a setting when it comes and goes.</p>
      <div class="dv-permission" data-permission hidden>
        <p>This browser will not say what these ${esc(kind)}s are called until it has been given
          permission once.</p>
        <button type="button" data-grant>Allow, and show their names</button>
      </div>
      <ol class="dv-list" data-list></ol>
      <p class="dv-empty" data-empty hidden>No ${esc(kind)} is connected to this machine.</p>
      <div class="dv-extra" data-extra></div>
      <p class="dv-now" data-now role="status" aria-live="polite"></p>
    </div>`;

  const el = (sel) => root.querySelector(sel);

  function render() {
    if (destroyed) return;
    const { rows, extra } = buildRows(preferred(), available);
    el('[data-permission]').hidden = labelled || available.length === 0;
    el('[data-empty]').hidden = available.length > 0 || rows.length > 0;

    el('[data-list]').innerHTML = rows.map((r, i) => `
      <li class="dv-row${r.present ? '' : ' dv-missing'}" data-id="${esc(r.id)}">
        <span class="dv-name">${esc(r.label || 'A device that is not connected')}</span>
        <span class="dv-state">${r.present ? 'connected' : 'not connected now'}</span>
        <span class="dv-move">
          <button type="button" data-up="${i}" aria-label="move up"${i === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" data-down="${i}" aria-label="move down"${i === rows.length - 1 ? ' disabled' : ''}>↓</button>
          <button type="button" data-remove="${i}" aria-label="remove from the list">✕</button>
        </span>
      </li>`).join('');

    // The ones that are plugged in but not on the list. Shown so somebody can add them without
    // hunting, and so a device that appeared after setup is discoverable rather than invisible.
    el('[data-extra]').innerHTML = extra.length
      ? `<p class="dv-note">Also connected:</p>` + extra.map((d) => `
          <button type="button" class="dv-add" data-add="${esc(d.id)}">Use ${esc(d.label || 'this device')}</button>`).join('')
      : '';

    // WHAT IS ACTUALLY IN USE, AND WHY. The panel's most important line: without it somebody
    // reading a list of preferences has no way to know which one is live, and a silent fallback
    // is invisible in exactly the place it should be most obvious.
    const chosen = owner.chosen?.();
    const said = chosen ? describePick(chosen, { kind }) : null;
    el('[data-now]').textContent = chosen
      ? (said ? said.text : `Using ${chosen.label || 'the chosen device'}.`)
      : '';
    el('[data-now]').dataset.state = chosen?.pick || '';
  }

  async function refresh() {
    if (destroyed) return;
    available = await owner.list();
    labelled = await owner.labelled();
    await owner.choose?.();
    render();
  }

  async function setOrder(next) {
    await save({ [prefKey]: next });
    await owner.choose?.();
    render();
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const want = preferred();
    if (t.dataset.up != null) return setOrder(moveEntry(want, Number(t.dataset.up), -1));
    if (t.dataset.down != null) return setOrder(moveEntry(want, Number(t.dataset.down), 1));
    if (t.dataset.remove != null) {
      const next = want.slice();
      next.splice(Number(t.dataset.remove), 1);
      return setOrder(next);
    }
    if (t.dataset.add) return setOrder([...want, t.dataset.add]);
    if (t.hasAttribute('data-grant')) {
      // A REAL PROMPT. Only ever from this button, never on mount — a settings page that asks
      // for a microphone the moment it opens teaches people to click Block.
      try { await requestPermission?.(); } catch (err) { console.error('device: permission', err); }
      return refresh();
    }
    return undefined;
  });

  return {
    refresh,
    render,
    rows: () => buildRows(preferred(), available),
    destroy() { destroyed = true; root.innerHTML = ''; },
  };
}
