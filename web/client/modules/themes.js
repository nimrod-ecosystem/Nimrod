// modules/themes.js — the THEMES panel: every theme, each with a still of what it looks like, to look through and
// choose from. The same list as the ⚙ menu's Theme tab, because it IS that list.
//
// Mike, 2026-10-06: *"There probably needs to be its own themes module that is also a tab on the settings menu."*
//
// *** BUILT ONCE (the Settings-panel-is-the-⚙-menu rule, modules/settings.js). *** The panel asks the screen for
// its own menu (`ctx.settingsMenu(host)`, kiosk.js `settingsMenuFor`) and opens that menu's Theme row's list in its
// box, kept open (settings.js `openRow(id, { stay: true })`): the theme gallery (choice_picker.js +
// theme_gallery.js), with the Modules library's own search, Order and Filters (sort_filter.js). So:
//   * a choice here is written by the Theme row's own write path - the screen's theme, or the showing dashboard's
//     on the dashboard path, exactly what the ⚙ menu's row writes - and the board's "a theme was picked here" hears
//     it as it hears the row;
//   * the list stays open after a choice (try one, see the screen change, try another), and a choice made in the ⚙
//     menu or on another screen shows here at the next repaint;
//   * the LEVELS are the menu's: to set a theme for one dashboard, one device or one person, "Settings for" in the
//     ⚙ menu (or in a Settings panel) chooses the level and its Theme row opens this same gallery for that level.
//     ARGUED: FOR a level row inside this panel too - one place for everything about themes. AGAINST, and it
//     decides it for now: a second "Settings for" is a second thing that can disagree with the menu's, and the
//     panel's job is the common case (this screen's look). One press more for the rare case, in the place that
//     already does levels. On Mike's list.
//
// *** WITH NO SCREEN TO HOST IT (a bare module page, modules.html's try box), IT IS A PREVIEW. *** The gallery over
// this box alone: a choice colours this panel and nothing else (theme.js applyTheme on the panel's own box), and the
// note says so. Nothing is saved. ARGUED against "save it in this browser, as the pages without sign-in do": a try
// box that quietly changes how other pages look the next time is a surprise; a preview that says what it is is not.
//
// A SWITCH WALKS IT with the gallery's own moves (actions.js MODULE_VERBS `themes`): next / prev a row (the "Show"
// chips, then the rows of tiles), select goes into a row and takes a tile, back comes out of a row.
//
// `core: 'new'`: it needs `ctx.instanceId` (it never starts on itself).

import { registerModule } from '../module.js';
import { mountChoicePicker } from '../choice_picker.js';
import { listThemes, applyTheme, DEFAULT_THEME } from '../theme.js';

export const THEMES_TYPE = 'themes';
export const THEMES_TITLE = 'Themes';
// The ⚙ menu's Theme row (kiosk.js SCREEN_FIELDS `theme`): the row whose list this panel shows.
export const THEME_ROW_ID = 'set:theme';
export const THEMES_PANEL_VERBS = Object.freeze({
  next: 'themes/next', prev: 'themes/prev', select: 'themes/select', back: 'themes/back',
});

registerModule(
  { type: THEMES_TYPE, title: THEMES_TITLE, core: 'new', dependsOn: 'server',
    description: 'every theme, each with a still of what it looks like; choosing one changes the screen' },
  (ctx) => {
    const { mount } = ctx;
    let view = null;          // the screen's menu, drawn here and opened on its Theme row's list
    let preview = null;       // on its own: the gallery over this box (a preview)
    let torn = false;
    const offs = [];
    // The four moves, to whichever is showing: the menu (its open list) or the preview's gallery.
    const move = (verb) => () => {
      if (view) { try { view[verb]?.(); } catch (err) { console.error('themes: a move', err); } return; }
      try { preview?.[verb]?.(); } catch (err) { console.error('themes: a move', err); }
    };

    function previewHere(host, why) {
      host.innerHTML = `<div data-themes-preview style="box-sizing:border-box;height:100%;overflow:auto;padding:10px;
        color:var(--text);background:var(--surface)">
        <p data-themes-note style="margin:0 0 8px;font-size:.9rem;color:var(--text-muted)">${why} Choosing one here colours this panel only, to show it.</p>
        <div data-themes-list></div></div>`;
      const box = host.querySelector('[data-themes-preview]');
      let shown = DEFAULT_THEME;
      preview = mountChoicePicker(host.querySelector('[data-themes-list]'), {
        title: THEMES_TITLE, key: 'theme', cancel: false, value: shown,
        options: listThemes().map((t) => ({ value: t.id, label: t.label })),
        onPick: (v) => { shown = v; try { applyTheme(box, v); } catch (err) { console.error('themes: preview', err); } preview?.setValue?.(v); },
      });
    }

    return {
      async init() {
        mount.innerHTML = '<div data-themes-root style="width:100%;height:100%;position:relative;overflow:hidden"></div>';
        const host = mount.querySelector('[data-themes-root]');
        const on = (topic, fn) => {
          try { const off = ctx.bus?.subscribe?.(topic, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ }
        };
        on(THEMES_PANEL_VERBS.next, move('next'));
        on(THEMES_PANEL_VERBS.prev, move('prev'));
        on(THEMES_PANEL_VERBS.select, move('select'));
        on(THEMES_PANEL_VERBS.back, move('back'));
        if (typeof ctx.settingsMenu === 'function') {
          try { view = await ctx.settingsMenu(host, { instanceId: ctx.instanceId || null }); }
          catch (err) { console.error('themes: the screen’s menu', err); view = null; }
          if (torn) { try { view?.destroy?.(); } catch { /* gone */ } view = null; return; }
          let opened = false;
          try { opened = !!view?.openRow?.(THEME_ROW_ID, { stay: true }); } catch (err) { console.error('themes: the Theme row', err); }
          if (opened) { host.dataset.themesMode = 'screen'; return; }
          // A screen with no Theme row to open (none today): the preview, rather than a menu nobody asked for.
          try { view?.destroy?.(); } catch { /* gone */ }
          view = null;
          previewHere(host, 'This screen has no theme to set from here.');
          host.dataset.themesMode = 'preview';
          return;
        }
        previewHere(host, 'Here, on its own, there is no screen for it to set.');
        host.dataset.themesMode = 'preview';
      },
      onResize() {},
      onHide() {},
      // For a test: which way it is showing, and the open list's own probe.
      __probe: () => ({
        mode: mount.querySelector('[data-themes-root]')?.dataset.themesMode || null,
        hosted: !!view,
        page: view?.page?.() || null,
        picker: view ? (view.pickerProbe?.() || null) : (preview?.__probe?.() || null),
      }),
      destroy() {
        torn = true;
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { view?.destroy?.(); } catch { /* gone */ }
        try { preview?.destroy?.(); } catch { /* gone */ }
        view = null; preview = null;
        mount.innerHTML = '';
      },
    };
  },
);
