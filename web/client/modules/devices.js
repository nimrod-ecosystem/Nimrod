// modules/devices.js — DEVICES, a module (type 'devices'): every way of telling the screen what to do, and
// where each one is set up.
//
// Mike, 2026-10-02: the landing Home is four up — pictures, settings, DEVICES and Nimrod — and "Set up a
// device" is one of Nimrod's first choices: "voice commands / tracking / mouse & keyboard bindings /
// phones / computers". The setting-up itself already exists, in several places (the binder and the marker
// tracker on My dashboards' Devices tab, the settings menu's Devices tab, the voice commands page, the
// phone microphone page, screen pairing). What was missing is ONE PLACE THAT LISTS THEM, which is this
// (connections.js's argument: hiding things until they are set up only works if one place lists them all).
//
// *** IT DOES NOT EDIT ANYTHING. *** `modules/keyboard.js` set the precedent and its reason stands: the
// binder is the one binding editor, and a second one here would be two things to keep in step. Each row
// says what the device is for and goes where it is set up: a settings tab on THIS screen (`menu/tab`), or a
// page, opened in a NEW tab — a screen nobody is at must never navigate away from itself.
//
// The words are nimrod_guide_data.js's DEVICE_KINDS, the same ones Nimrod says: one description of each.

import { registerModule } from '../module.js';
import { DEVICE_KINDS, GUIDE_TOPICS } from '../nimrod_guide_data.js';

export const DEVICES_TYPE = 'devices';
export const DEVICES_VERB_TOPICS = Object.freeze({ next: 'devices/next', prev: 'devices/prev', select: 'devices/select' });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `
.dv-root{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;color:var(--text);font:inherit}
.dv-root h3{margin:0 0 8px;font-size:1.05rem}
.dv-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.dv-row{padding:8px 10px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.dv-row b{display:block}
.dv-lead{color:var(--text-muted);margin:2px 0 6px}
.dv-btns{display:flex;flex-wrap:wrap;gap:8px}
.dv-btn{min-height:44px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-alt);
  color:var(--text);font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.dv-btn.is-scan,.dv-btn:focus-visible{outline:3px solid var(--scan-ring, var(--highlight));outline-offset:2px}
`;

registerModule(
  { type: DEVICES_TYPE, title: 'Devices', core: 'new', dependsOn: 'none', importance: 'normal',
    description: 'every way of telling the screen what to do — voice, tracking, keys and switches, phones, other screens — and where each is set up',
    settings: [] },
  (ctx) => {
    const { mount } = ctx;
    let root = null;
    let cursor = 0;
    const offs = [];
    const stops = () => (root ? [...root.querySelectorAll('[data-dv-stop]')] : []);
    function paint() {
      const list = stops();
      for (const b of root?.querySelectorAll('.is-scan') || []) b.classList.remove('is-scan');
      if (!list.length) return;
      cursor = ((cursor % list.length) + list.length) % list.length;
      list[cursor].classList.add('is-scan');
    }
    function press(el) {
      if (!el) return;
      if (el.dataset.dvTab) { try { ctx.bus?.publish?.(GUIDE_TOPICS.menuTab, { tab: el.dataset.dvTab }); } catch { /* no bus */ } return; }
      if (el.tagName === 'A') { try { el.ownerDocument.defaultView?.open?.(el.href, '_blank', 'noopener'); } catch { /* blocked */ } }
    }
    const onClick = (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-dv-tab]') : null;
      if (!b || !root?.contains(b)) return;
      cursor = Math.max(0, stops().indexOf(b));
      press(b);
    };
    return {
      init() {
        const doc = mount.ownerDocument;
        root = doc.createElement('div');
        root.className = 'dv-root';
        root.innerHTML = `<h3>Devices</h3><ul class="dv-list">${DEVICE_KINDS.map((d) => `
          <li class="dv-row" data-dv="${esc(d.id)}" data-help="${esc(d.say)}" data-help-title="${esc(d.label)}">
            <b>${esc(d.label)}</b><p class="dv-lead">${esc(d.lead)}</p>
            <div class="dv-btns">
              ${d.tab ? `<button type="button" class="dv-btn" data-dv-stop data-dv-tab="${esc(d.tab)}"
                data-help="${esc(`Opens the settings menu on its ${d.tab} tab, on this screen.`)}">Settings</button>` : ''}
              <a class="dv-btn" data-dv-stop href="${esc(d.href)}" target="_blank" rel="noopener"
                data-help="${esc(`Opens “${d.hrefLabel}” in a new tab.`)}">${esc(d.hrefLabel)} ↗</a>
            </div></li>`).join('')}</ul>`;
        const style = doc.createElement('style');
        style.textContent = STYLE;
        mount.append(style, root);
        root.addEventListener('click', onClick);
        const on = (topic, fn) => { try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        on(DEVICES_VERB_TOPICS.next, () => { cursor += 1; paint(); });
        on(DEVICES_VERB_TOPICS.prev, () => { cursor -= 1; paint(); });
        on(DEVICES_VERB_TOPICS.select, () => press(stops()[cursor]));
      },
      onResize() {},
      onHide() {},
      destroy() {
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        root?.removeEventListener('click', onClick);
        mount.innerHTML = '';
        root = null;
      },
      __probe: () => ({ rows: root ? [...root.querySelectorAll('[data-dv]')].map((r) => r.dataset.dv) : [], cursor }),
    };
  },
);
