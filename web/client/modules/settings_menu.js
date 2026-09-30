// modules/settings_menu.js — THE SETTINGS MENU, AS A MODULE PLACED IN A DASHBOARD. Step 6 Stage 3b.
//
// Mike, 2026-09-30: the settings menu, like the transport bar, is a module PLACED in the dashboard.
// There is still ONE menu: the shell's (kiosk.js `mountSettings`, with everything only the shell knows
// -- who the screen is for, its settings, the focused panel's own fields, recovery, restart). This
// module is WHERE IT LIVES: it hands the shell its box (`ctx.shell.dockMenu(el)`) and the shell moves
// that one menu into it, scoped to the box (settings.js's inline mode). Destroy it, and the menu goes
// back to being the shell's own overlay -- so a dashboard that loses its menu module never loses the
// menu, and the plain bar's gear still opens it.
//
// Two menus drawn from one configuration were the other way to build this, and were not taken: two
// copies of "which row has the switch cursor", two things answering the menu verb, and the chance of
// both open at once. The move keeps everything a menu is -- its state, its bus attachment, its one-switch
// cursor -- exactly one thing.
//
// `chrome: 'menu'`: the dashboard reports whether a placed module carries the menu. A host with no
// shell to dock into (a preview of the module on its own) has no menu to carry, and says so: it fails
// to mount, which is the honest status, rather than showing an empty box that pretends to be a menu.

import { registerModule } from '../module.js';

registerModule(
  { type: 'settings_menu', title: 'Settings menu',
    description: 'The settings menu, placed in a dashboard',
    chrome: 'menu', importance: 'critical', dependsOn: 'none', settings: [] },
  (ctx) => {
    let root = null;
    let undock = null;
    return {
      init() {
        if (typeof ctx.shell?.dockMenu !== 'function') {
          throw new Error('settings_menu: no screen menu to place here (no ctx.shell.dockMenu)');
        }
        root = document.createElement('div');
        root.className = 'sm-dock';
        ctx.mount.append(root);
        undock = ctx.shell.dockMenu(root);
      },
      onResize() {},
      onHide() {},
      destroy() {
        try { undock?.(); } catch { /* already back */ }
        undock = null;
        root?.remove(); root = null;
      },
    };
  },
);
