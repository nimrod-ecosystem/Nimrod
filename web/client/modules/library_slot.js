// modules/library_slot.js — THE MODULES LIBRARY'S PLACE ON THE BUILDER (type `library_slot`), until the
// library itself is registered (2026-10-02).
//
// The builder dashboard (dashboards.js `builder`) has the modules library in its bottom right. The library
// is being built at the same time, as its own module (type `library`, or `modules`), by another piece of
// work. So the builder does not name a type that may not exist yet -- a record naming a module nobody
// registered fails dashboards.js `recordProblems` and would put an error notice in a person's panel.
// It names THIS, which:
//   * mounts the library INSIDE itself, as soon as a module of one of LIBRARY_TYPES is registered on the
//     page (looked for when it starts, so a page that registers the library shows it with no other change);
//   * until then says, in words, where the library will be and how to put a module in the panel being
//     edited meanwhile (Switch module).
// (As this was written the library landed in the working tree beside it -- modules/library.js, type `library`,
// imported by kiosk.js -- so on a real screen and on Home this mounts it. The slot stays for two reasons: the
// builder's record must not depend on a module that is not committed yet, and on the builder a pick in the
// library goes INTO the panel being edited, not in place of the library -- see `libraryHost` below.)

import { registerModule, getManifest, mountModule, extendCtx } from '../module.js';
import { EDIT_SELECTED_TOPIC, EDIT_ENDED_TOPIC } from '../edit_mode.js';

// The names the library may register under, in the order looked for (the coordinator's: `library`/`modules`).
export const LIBRARY_TYPES = Object.freeze(['library', 'modules']);
export const LIBRARY_WAITING = 'The modules library goes here. Until it arrives, Switch module (on the bar) puts any module '
  + 'in the panel you are editing, and the Add tray above your Home adds one.';

/** The library's registered type, or null while none is. */
export function libraryType(lookup = getManifest) {
  for (const t of LIBRARY_TYPES) { try { if (lookup(t)) return t; } catch { /* not this one */ } }
  return null;
}

registerModule(
  { type: 'library_slot', title: 'Modules library', core: 'new', dependsOn: 'local', importance: 'optional',
    description: 'Where the modules library sits on the builder: it shows the library once that is installed.',
    settings: [] },
  (ctx) => {
    const { mount } = ctx;
    let child = null;
    // The panel being edited on this dashboard, if any (edit_mode.js publishes each choice and each end).
    let editing = null;
    const offs = [];
    return {
      init() {
        mount.dataset.librarySlot = '';
        offs.push(ctx.bus?.subscribe?.(EDIT_SELECTED_TOPIC, (p) => { if (p && p.panelId && p.panelId !== ctx.instanceId) editing = p.panelId; }));
        offs.push(ctx.bus?.subscribe?.(EDIT_ENDED_TOPIC, (p) => { if (!p || p.id === editing) editing = null; }));
        const type = libraryType();
        // A child is mounted on the ROOT bus (mountModule scopes it again for the child), the container rule
        // director.js and view.js keep. A host with no root bus: say so in words rather than half-mount it.
        const bus = ctx.rootBus || (typeof ctx.bus?.scope === 'function' ? ctx.bus : null);
        if (type && bus) {
          const host = document.createElement('div');
          host.style.cssText = 'position:absolute;inset:0';
          mount.replaceChildren(host);
          try {
            // This panel's own state and events, lent: the child's destroy must not close what the host closes.
            const lend = (h) => (h ? Object.assign(Object.create(h), { destroy() {} }) : h);
            // *** ON THE BUILDER, A PICK GOES INTO WHAT IS BEING EDITED. *** The library asks its host for the
            // panel a pick lands in (kiosk.js `libraryHost(instanceId)`: by default its OWN panel -- "it would
            // replace the modules module"). Here that would replace the library with the pick; Mike's builder is
            // a shop beside the thing being edited ("the shop to add items to your profile"). So while a panel
            // is being edited (edit_mode.js, heard on the bus), the host asked for is THAT panel's; with nothing
            // being edited it is this one's, as anywhere else. Read at the moment of asking, never captured.
            const extra = { mount: host, bus, state: lend(ctx.state), events: lend(ctx.events) };
            if (typeof ctx.libraryHost === 'function') {
              const hostFor = () => { try { return ctx.libraryHost(editing || ctx.instanceId) || null; } catch { return null; } };
              extra.libraryHost = () => new Proxy({}, {
                get: (_, k) => { const h = hostFor(); const v = h ? h[k] : undefined; return typeof v === 'function' ? v.bind(h) : v; },
                has: (_, k) => { const h = hostFor(); return !!h && k in h; },
              });
            }
            child = mountModule(type, extendCtx(ctx, extra));
            child.init();
            mount.dataset.librarySlot = type;
            return;
          } catch (err) {
            console.error(`library_slot: ${type} would not start`, err);
            try { child?.destroy(); } catch { /* gone */ }
            child = null;
          }
        }
        mount.innerHTML = `<div class="em-opts" data-library-waiting><strong class="em-title">Modules library</strong>`
          + `<p class="em-help">${LIBRARY_WAITING}</p></div>`;
      },
      onResize() { try { child?.onResize?.(); } catch { /* not load-bearing */ } },
      onHide() { try { child?.onHide?.(); } catch { /* not load-bearing */ } },
      onShow() { try { child?.onShow?.(); } catch { /* not load-bearing */ } },
      destroy() {
        for (const off of offs.splice(0)) { try { off?.(); } catch { /* gone */ } }
        try { child?.destroy(); } catch (err) { console.error('library_slot: destroy', err); }
        child = null;
        mount.innerHTML = '';
      },
    };
  },
);
