// modules/transport_bar.js — THE TRANSPORT BAR, AS A MODULE PLACED IN A DASHBOARD. Step 6 Stage 3b.
//
// Mike, 2026-09-30: *"They are modules. They're not being drawn by a module. They're being placed in
// the dashboard."* So the bar a dashboard shows is this module, placed there like any other (docked
// along the bottom for now; on the room's low cabinet once scene placement exists). The screen's own
// PLAIN bar stays in the shell, and comes up by itself whenever no placed module carries the bar --
// which is what `chrome: 'bar'` on the manifest declares this module does.
//
// *** IT OWNS NOTHING IT SHOWS. ***
//   * THE CHIPS are drawn by `transport_bar.js`, the same code the plain bar uses, from the
//     dashboard it is placed in (`ctx.container`: the dashboard module's contract), so the two bars
//     can never disagree about which panels there are or which is lit.
//   * THE BUTTONS say what was pressed, as topics (`shell_verbs.js`), and the shell does it with the
//     functions its own plain bar calls. There is one Next, one Hush, one menu -- however many things
//     can press them.
//
// Not a panel: the dashboard mounts it into a dock, not a slot, so it has no chip of its own, is never
// focused, and is never offered as a recovery fallback. It declares no settings yet: what goes IN the
// bar and in what order is Design's home-dashboard spec, and it follows the plain bar's until that
// lands as settings.

import { registerModule } from '../module.js';
import { barModel, drawChips, drawHelpButton, helpOn } from '../transport_bar.js';
import {
  SHELL_NEXT, SHELL_PREV, SHELL_PANEL, SHELL_HUSH, SHELL_MENU, SHELL_FULLSCREEN, SHELL_HOME,
  SHELL_MIRROR, SHELL_STATE, SHELL_HELP,
} from '../shell_verbs.js';

// The buttons, in the plain bar's order. `embedOnly: false` = hidden on a preview (an embed has no
// other screens to go Home to, and never the camera as an overlay), the same rule kiosk.css applies to
// the plain bar there.
const BUTTONS = [
  { act: 'home', verb: SHELL_HOME, label: '⌂ Home', title: 'your screens', embed: false },
  { act: 'back', verb: SHELL_PREV, label: '◂ Back', title: 'back — the one before this' },
  { act: 'next', verb: SHELL_NEXT, label: 'Next ▸', title: 'next' },
  { act: 'panel', verb: SHELL_PANEL, label: 'Panel ▸', title: 'move to the next panel' },
  { act: 'mirror', verb: SHELL_MIRROR, label: 'Mirror', title: 'the camera, full screen', embed: false },
  { act: 'hush', verb: SHELL_HUSH, label: 'Hush',
    title: 'pause the music and video so you can talk (voices and speech are still heard)' },
  { act: 'settings', verb: SHELL_MENU, label: '⚙', title: 'settings' },
  { act: 'fs', verb: SHELL_FULLSCREEN, label: '⛶', title: 'full screen' },
];

registerModule(
  { type: 'transport_bar', title: 'Transport bar',
    description: 'The bar of panel buttons and controls, placed in a dashboard',
    chrome: 'bar', importance: 'critical', dependsOn: 'none', settings: [] },
  (ctx) => {
    const { mount } = ctx;
    const say = ctx.rootBus || ctx.bus;
    let root = null, modsEl = null;
    let hushed = !!ctx.audio?.isHushed?.();
    // Whether the Nimrod button is offered: the shell's reading of the person's "Cat help" when there
    // is a shell (it re-reads and says so on SHELL_STATE), else this device's own.
    let helpShown = (() => {
      try { return typeof ctx.shell?.helpOn === 'function' ? !!ctx.shell.helpOn() : helpOn(ctx.storage); }
      catch { return true; }
    })();
    let helpEl = null;
    const offs = [];

    function arrangement() { return ctx.container?.arrangement?.() || null; }

    function draw() {
      if (!root) return;
      const a = arrangement();
      drawChips(modsEl, barModel(a, ctx.router ? { router: ctx.router } : null));
      // Panel ▸ only on an arranged screen with more than one panel to move between -- the plain
      // bar's own rule (kiosk.js `syncPanelBtn`).
      const n = (ctx.router?.reachable?.() || []).length;
      const panel = root.querySelector('[data-act="panel"]');
      if (panel) panel.hidden = !a?.layout?.() || n < 2;
      const h = root.querySelector('[data-act="hush"]');
      if (h) {
        h.dataset.on = hushed ? '1' : '0';
        h.textContent = hushed ? 'Sound off' : 'Hush';
        h.setAttribute('aria-pressed', hushed ? 'true' : 'false');
      }
      if (helpEl) helpEl.hidden = !helpShown;
    }

    return {
      init() {
        root = document.createElement('div');
        root.className = 'tb-bar';
        root.setAttribute('role', 'toolbar');
        root.setAttribute('aria-label', 'transport bar');
        modsEl = document.createElement('div');
        modsEl.className = 'tb-mods';
        const actions = document.createElement('div');
        actions.className = 'tb-actions';
        for (const b of BUTTONS) {
          if (b.embed === false && ctx.embedded) continue;
          const el = document.createElement('button');
          el.type = 'button';
          el.dataset.act = b.act;
          el.textContent = b.label;
          el.title = b.title;
          el.addEventListener('click', () => say?.publish(b.verb, { from: 'transport_bar' }));
          actions.append(el);
        }
        // Nimrod: the same button the plain bar has (transport_bar.js), just before the gear. It says
        // SHELL_HELP and the shell's one cat answers.
        helpEl = drawHelpButton(actions, { before: actions.querySelector('[data-act="settings"]'),
          onPress: () => say?.publish(SHELL_HELP, { from: 'transport_bar' }) });
        root.append(modsEl, actions);
        mount.append(root);
        const off = ctx.container?.onChange?.(() => draw());
        if (typeof off === 'function') offs.push(off);
        const off2 = say?.subscribe?.(SHELL_STATE, (s) => {
          if (!s) return;
          if ('hushed' in s) hushed = !!s.hushed;
          if ('help' in s) helpShown = !!s.help;
          if ('hushed' in s || 'help' in s) draw();
        });
        if (typeof off2 === 'function') offs.push(off2);
        draw();
      },
      onResize() {},
      onHide() {},
      destroy() {
        offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
        root?.remove(); root = null; modsEl = null; helpEl = null;
      },
    };
  },
);
