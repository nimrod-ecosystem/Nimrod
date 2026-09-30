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
//
// *** A HOST PAGE'S ACTIONS (Home, 2026-09-30). *** When the page hosting this kiosk handed it a `host`
// (kiosk.js; `ctx.shell.host`), the bar draws the host's buttons FIRST, in Design's order (Modules:
// <name>, Save, Save as…, History, then a status in words), and they say `SHELL_HOST { act }` like every
// other button here says its topic -- the shell calls the host's one `press`. Two of Design's buttons
// were ALREADY on this bar, so they are not drawn twice: Edit / Done editing IS the gear (edit view is
// the menu open), and Full screen IS ⛶. With a host, those two say so in words (the host's `label`),
// so the bar reads "⚙ Edit" and "⛶ Full screen" instead of two more buttons doing the same thing. A
// button that cannot act is DIMMED (disabled), never removed (Design; D16's rule on this very bar).
//
// *** IN FULL SCREEN IT TUCKS ITSELF AWAY *** after the host's `barHideMs()` (Design's 6 s by default;
// shell_verbs.js), and anything -- a press, a key, a switch edge, the pointer near it -- brings it back.
// Tucked is `visibility:hidden`, not removed: nothing reflows, a click where it was lands on the content
// (and brings it back), and the content never depends on it returning. Held (the cat pointing at it) or
// with the keyboard inside it, it stays.

import { registerModule } from '../module.js';
import { barModel, drawChips, drawHelpButton, helpOn } from '../transport_bar.js';
import {
  SHELL_NEXT, SHELL_PREV, SHELL_PANEL, SHELL_HUSH, SHELL_MENU, SHELL_FULLSCREEN, SHELL_HOME,
  SHELL_MIRROR, SHELL_STATE, SHELL_HELP, SHELL_HOST, FULLSCREEN_BAR_HIDE_DEFAULT_MS,
} from '../shell_verbs.js';
import { EDGE_TOPIC } from '../input.js';

// How near the pointer has to come to bring a tucked bar back: the kiosk's own rule for its bar
// (kiosk.js BAR_REVEAL_MARGIN_PX, Mike 2026-09-20: "pop up when you put your cursor near"), not a new
// number. A press or a key brings it back from anywhere.
const REVEAL_MARGIN_PX = 140;

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
    let hostEl = null;
    const offs = [];
    const host = ctx.shell?.host || null;
    const doc = () => (typeof document !== 'undefined' ? document : null);
    // Seams, from the shell: which element is full screen (a suite cannot make a real one without a
    // person's gesture) and whether the one menu is open (the gear's words say so).
    const fullEl = () => {
      try { return typeof ctx.shell?.fullscreenElement === 'function' ? ctx.shell.fullscreenElement() : doc()?.fullscreenElement || null; }
      catch { return null; }
    };
    const menuOpen = () => { try { return !!ctx.shell?.menuOpen?.(); } catch { return false; } };
    let held = (() => { try { return !!ctx.shell?.barHeld?.(); } catch { return false; } })();
    let tucked = false;
    let hideT = null;

    function arrangement() { return ctx.container?.arrangement?.() || null; }

    function inFull() {
      const f = fullEl();
      return !!(f && root && (f === root || f.contains?.(root)));
    }
    function hideMs() {
      let v;
      try { v = typeof host?.barHideMs === 'function' ? host.barHideMs() : undefined; } catch { v = undefined; }
      return Number.isFinite(v) && v >= 0 ? v : FULLSCREEN_BAR_HIDE_DEFAULT_MS;
    }
    function setTucked(on) {
      tucked = !!on;
      if (!root) return;
      root.style.visibility = tucked ? 'hidden' : '';
      if (tucked) root.dataset.tucked = '1'; else delete root.dataset.tucked;
    }
    /** Show the bar, and (in full screen, unless held) tuck it away again after the delay. */
    function reveal() {
      if (!root) return;
      clearTimeout(hideT); hideT = null;
      if (tucked) setTucked(false);
      if (!inFull() || held) return;
      const ms = hideMs();
      if (!(ms > 0)) return;                      // "never" is a choice somebody may make
      hideT = setTimeout(() => {
        hideT = null;
        if (!root || !inFull() || held) return;
        // The keyboard is in the bar: somebody is using it. Their next key brings the timer back.
        if (root.contains(doc()?.activeElement)) return;
        setTucked(true);
      }, ms);
    }

    // What the host's own group shows, read fresh at every draw.
    function drawHost() {
      if (!hostEl || !host) return;
      let items = [];
      try { items = typeof host.barItems === 'function' ? (host.barItems() || []) : []; } catch (err) {
        console.error('transport bar: host items', err); items = [];
      }
      const keep = doc()?.activeElement;
      const keepAct = keep && hostEl.contains(keep) ? keep.dataset.host : null;
      hostEl.innerHTML = '';
      for (const it of items) {
        if (!it) continue;
        if (it.kind === 'status') {
          const s = document.createElement('span');
          s.className = 'tb-status' + (it.dirty ? ' dirty' : '');
          s.setAttribute('role', 'status');
          s.setAttribute('aria-live', 'polite');
          s.dataset.hostStatus = '';
          // A FIXED BOX, so changing words never move a button (the bar is centred: a status that
          // grew from "Saved" to "Unsaved changes" would shift everything on it -- PRIORITY.md #3's
          // same-position rule). Two lines tall, wrapping inside; 22ch fits the longest status in two.
          s.style.cssText = 'display:inline-flex;align-items:center;width:22ch;height:2.6em;'
            + 'white-space:normal;line-height:1.25;text-align:left;overflow:hidden';
          s.textContent = it.text || '';
          hostEl.append(s);
          continue;
        }
        const el = document.createElement('button');
        el.type = 'button';
        el.dataset.host = it.act;
        el.textContent = it.label;
        if (it.title) el.title = it.title;
        // DIMMED, NEVER HIDDEN (Design): a vanishing button costs a switch user a press to learn it went.
        el.disabled = !!it.disabled;
        // Lit, not bolded: `data-on` (Hush's look) changes the weight, which changes the width, which
        // moves every button after it. The host page styles `data-primary` without touching the size.
        if (it.primary) el.dataset.primary = '1';
        if (it.expanded != null) el.setAttribute('aria-expanded', String(!!it.expanded));
        el.addEventListener('click', () => {
          if (el.disabled) return;
          say?.publish(SHELL_HOST, { act: it.act, from: 'transport_bar' });
        });
        hostEl.append(el);
      }
      // A repaint must not drop the keyboard: the button it was on is a new button now.
      if (keepAct) hostEl.querySelector(`[data-host="${keepAct}"]`)?.focus?.();
    }
    // The gear and ⛶, in words, when the host has words for them (Home: "Edit" / "Done editing").
    function wordShell() {
      if (!root || !host || typeof host.label !== 'function') return;
      const state = { menuOpen: menuOpen(), full: !!fullEl() };
      for (const act of ['settings', 'fs']) {
        const el = root.querySelector(`.tb-actions:not(.tb-host) [data-act="${act}"]`);
        if (!el) continue;
        let w = null;
        try { w = host.label(act, state); } catch { w = null; }
        if (w) el.textContent = w;
        if (act === 'settings') el.setAttribute('aria-pressed', String(state.menuOpen));
      }
    }

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
      drawHost();
      wordShell();
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
        if (host) {
          // The host's group goes FIRST (Design's order: Modules, then Save...), as a `tb-actions` so
          // it looks like the rest of the bar.
          hostEl = document.createElement('div');
          hostEl.className = 'tb-actions tb-host';
          hostEl.setAttribute('role', 'group');
          hostEl.setAttribute('aria-label', 'this page');
          root.append(hostEl, modsEl, actions);
        } else {
          root.append(modsEl, actions);
        }
        mount.append(root);
        const off = ctx.container?.onChange?.(() => draw());
        if (typeof off === 'function') offs.push(off);
        const off2 = say?.subscribe?.(SHELL_STATE, (s) => {
          if (!s) return;
          if ('hushed' in s) hushed = !!s.hushed;
          if ('help' in s) helpShown = !!s.help;
          if ('hushed' in s || 'help' in s || 'menuOpen' in s) draw();
          if ('barHeld' in s) { held = !!s.barHeld; reveal(); }
        });
        if (typeof off2 === 'function') offs.push(off2);
        if (host && typeof host.subscribe === 'function') {
          try {
            const off3 = host.subscribe(() => draw());
            if (typeof off3 === 'function') offs.push(off3);
          } catch (err) { console.error('transport bar: host subscribe', err); }
        }
        // FULL SCREEN, AND ANYTHING THAT BRINGS THE BAR BACK. Capture and passive: this only shows a
        // bar, and must not get in the way of a press a panel is about to receive.
        const d = doc();
        if (d) {
          const onFs = () => { reveal(); draw(); };
          const onAny = () => { if (tucked || hideT) reveal(); };
          const onMove = (e) => {
            if (!tucked && !hideT) return;
            const r = root?.getBoundingClientRect?.();
            if (!r) return;
            if (e.clientX >= r.left - REVEAL_MARGIN_PX && e.clientX <= r.right + REVEAL_MARGIN_PX
                && e.clientY >= r.top - REVEAL_MARGIN_PX) reveal();
          };
          d.addEventListener('fullscreenchange', onFs);
          for (const ev of ['pointerdown', 'keydown']) d.addEventListener(ev, onAny, { capture: true, passive: true });
          d.addEventListener('mousemove', onMove, { passive: true });
          offs.push(() => {
            d.removeEventListener('fullscreenchange', onFs);
            for (const ev of ['pointerdown', 'keydown']) d.removeEventListener(ev, onAny, { capture: true });
            d.removeEventListener('mousemove', onMove);
          });
        }
        // A switch pressed (any bound or unbound control's physical edge) counts as "anything".
        const off4 = say?.subscribe?.(EDGE_TOPIC, (e) => { if (e?.phase === 'down' && (tucked || hideT)) reveal(); });
        if (typeof off4 === 'function') offs.push(off4);
        draw();
        reveal();
      },
      onResize() {},
      onHide() {},
      destroy() {
        clearTimeout(hideT); hideT = null;
        offs.splice(0).forEach((off) => { try { off(); } catch { /* already gone */ } });
        root?.remove(); root = null; modsEl = null; helpEl = null; hostEl = null;
      },
      // For a suite and a diagnostic page: is it tucked away right now.
      tucked: () => tucked,
    };
  },
);
