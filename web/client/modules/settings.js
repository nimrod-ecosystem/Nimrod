// modules/settings.js — the Settings PANEL, which IS the screen's settings menu.
//
// *** ONE THING, NOT TWO (Mike, 2026-10-03). *** "The settings module should be the same as the settings menu.
// There shouldn't be 2 different things." Until then this file built its own list: every other panel's
// settings (one page each), a Theme page, "Lesson topics", the Nimrod Game, "Your own folders", and a "This
// screen" page saying the screen's own settings were "not reachable from here yet". It was a second list of
// settings to keep in step with the ⚙ menu's, and it had already fallen behind it (no tabs, no levels, no "How
// much this menu shows", none of the screen's rows).
//
// NOW THE PANEL DRAWS THE ⚙ MENU ITSELF. The screen hands it `ctx.settingsMenu(host)` (kiosk.js
// `settingsMenuFor`): the same `mountSettings` over the same rows, tabs, levels and pages, drawn in this box
// without the menu's open/close chrome (settings.js `asPanel`). Every value is shared, so a change in the panel
// shows in the ⚙ menu and the other way round; each keeps its own place ("Settings for", the tab, the cursor).
// Where the old pages went, every one of them a ⚙ menu thing now:
//   Theme          -> the Colours row's own list (every theme a tile in its colours): 'sc-theme' opens it
//   Lesson topics  -> a ⚙ menu page, 'sc-mode', on the This screen tab
//   Nimrod Game    -> the ⚙ menu's page GAME_SETTINGS_PAGE (unlocks.js draws it, as before)
//   Your own folders -> the ⚙ menu's page (user_folders_page.js)
//   This screen    -> gone: the screen's settings are right here now ('sc-device' shows the Display tab)
//   another panel's settings -> "Settings for: <that panel>" ('type:<module>' chooses it)
//
// *** WITH NO SCREEN TO HOST IT (a bare module page), IT SAYS SO. *** Argued against the other choice, "show a
// sensible subset" (the account theme, the folders): FOR a subset, somebody trying the module on its own sees
// something live. AGAINST, and it decides it: any subset is a second list of settings again - exactly the thing
// Mike ruled out - and it would drift from the menu the day a row is added there. The panel is the screen's
// menu; with no screen there is no menu to show, and saying where it works is the honest preview.
//
// `core: 'new'`: it needs `ctx.instanceId` (it never starts on itself).

import { registerModule } from '../module.js';
// THE NIMROD GAME page's id, and the answer this panel gives when asked to show a page, so Nimrod can tell a
// panel is here (no answer = no panel on this dashboard; he suggests the settings menu or the tutorial).
import { SETTINGS_SHOWN_TOPIC } from '../unlocks.js';

// *** WHERE IT OPENS, AND BEING ASKED TO SHOW A PAGE (2026-10-02, the landing Home). *** Unchanged contract:
//   startPage   on the panel's state: what it opens on ('sc-theme', 'sc-mode', 'sc-device', 'sc-game',
//               'user-folders', or 'type:<module>' for a panel's own settings). Written by the dashboard that
//               made it (dashboards.js), not a menu row: where a panel first opens is the dashboard's choice.
//   SETTINGS_OPEN_TOPIC { page }: anything on the screen (Nimrod) asks the panel to show a page. Showing a page
//               takes nothing from anybody: no focus moves, and the screen's switch still goes where it went.
export const SETTINGS_OPEN_TOPIC = 'settings-module/open';
export const START_PAGE_KEY = 'startPage';
// The menu's own four moves, as this panel's verbs (actions.js MODULE_VERBS `settings` points here).
export const SETTINGS_PANEL_VERBS = Object.freeze({
  next: 'settings/next', prev: 'settings/prev', select: 'settings/select', back: 'settings/back',
});

// The old page ids, as what they are in the menu now (see the header). Anything else is passed on as it is:
// a menu page id ('sc-mode', 'sc-game', 'user-folders'...) or 'type:<module>'.
const PAGE_ALIASES = Object.freeze({
  'sc-theme': 'row:set:theme',
  'sc-device': 'tab:display',
});
export const settingsTarget = (page) => {
  const p = String(page || '');
  return PAGE_ALIASES[p] || p;
};

registerModule(
  { type: 'settings', title: 'Settings', core: 'new', dependsOn: 'server',
    description: 'the screen’s settings menu, as a panel: the same rows, tabs and levels as ⚙' },
  (ctx) => {
    const { mount } = ctx;
    let view = null;           // the screen's menu, drawn here (kiosk.js `settingsMenuFor`), or null
    let torn = false;
    let asked = null;          // { page, opened }: the last page somebody asked for, while it is still showing
    const offs = [];

    // Showing a page because somebody ELSE asked (Nimrod) must not move their keyboard focus here.
    function showPage(page) {
      if (!view || !page) return false;
      const doc = mount.ownerDocument;
      const before = doc?.activeElement || null;
      let shown = false;
      try { shown = !!view.show(settingsTarget(page)); } catch (err) { console.error('settings: show a page', err); shown = false; }
      if (shown) asked = { page: String(page), opened: view.page() };
      try {
        if (doc && mount.contains(doc.activeElement) && !mount.contains(before)) {
          if (before && before !== doc.body && before.isConnected) before.focus?.();
          else doc.activeElement?.blur?.();
        }
      } catch { /* nothing to give back */ }
      return shown;
    }

    function bare(why) {
      mount.innerHTML = `<div data-settings-root data-settings-bare style="height:100%;box-sizing:border-box;padding:16px;
        display:flex;flex-direction:column;justify-content:center;gap:8px;color:var(--text);background:var(--surface)">
        <strong>Settings</strong>
        <p style="margin:0">This panel is the screen’s settings menu: the same rows and tabs as the ⚙ button.
        Put it on a dashboard to use it there.</p>
        <p style="margin:0;opacity:.8">${why}</p></div>`;
    }

    return {
      async init() {
        mount.innerHTML = '<div data-settings-root style="width:100%;height:100%;position:relative"></div>';
        const host = mount.querySelector('[data-settings-root]');
        if (typeof ctx.settingsMenu !== 'function') { bare('Here, on its own, there is no screen for it to set.'); return; }
        try { view = await ctx.settingsMenu(host, { instanceId: ctx.instanceId || null }); }
        catch (err) { console.error('settings: the screen’s menu', err); view = null; }
        if (torn) { try { view?.destroy?.(); } catch { /* gone */ } view = null; return; }
        if (!view) { bare('The screen it is on has no settings menu to show.'); return; }

        // A SWITCH WALKS IT with the menu's own four moves (actions.js MODULE_VERBS `settings`).
        const on = (topic, fn) => {
          try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ }
        };
        on(SETTINGS_PANEL_VERBS.next, () => view?.next());
        on(SETTINGS_PANEL_VERBS.prev, () => view?.prev());
        on(SETTINGS_PANEL_VERBS.select, () => view?.select());
        on(SETTINGS_PANEL_VERBS.back, () => view?.back());
        // Asked to show a page (Nimrod). Answer every ask, shown or not: the answer means "a settings panel is
        // here" (unlocks.js).
        on(SETTINGS_OPEN_TOPIC, (p) => {
          if (torn) return;
          const shown = showPage(p?.page);
          try { ctx.bus?.publish?.(SETTINGS_SHOWN_TOPIC, { page: p?.page || null, shown: !!shown }); } catch { /* no bus */ }
        });

        let start = null;
        try { await ctx.state?.load?.(); start = (ctx.state?.get?.() || {})[START_PAGE_KEY] || null; } catch { start = null; }
        if (torn) return;
        if (start) showPage(start);
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { view?.destroy?.(); } catch { /* already gone */ }
        view = null;
      },
      // For a test to assert on without reaching into the closure by hand. `page` is the page somebody asked for
      // while it is still the one showing ('sc-theme' while the Colours list it opened is up), else the menu's.
      __probe: () => {
        const now = view?.page?.() || null;
        return {
          hosted: !!view,
          open: !!view?.isOpen?.(),
          page: asked && now && asked.opened === now ? asked.page : now,
          subject: view?.subjectId?.() || null,
          tab: view?.tab?.() || null,
        };
      },
    };
  },
);
