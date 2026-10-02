// modules/edit_options.js — THE OPTIONS OF WHATEVER YOU CHOSE (type `options`), the builder dashboard's top
// right (Mike, 2026-10-02: "The settings could be for anything you click on whenever a module is in edit
// mode").
//
// It shows the options of the thing chosen in a panel being edited (edit_mode.js): the words on a sign, its
// picture, a whole panel. It CLAIMS each selection (`edit/selected`), so the panel being edited does not
// also draw its own little card; with this panel nowhere on the screen, that card is how the same options
// show. The rows are the same ones, drawn by the same renderer (edit_mode.js `renderOptions`).
//
// *** WHY ITS OWN MODULE AND NOT THE SETTINGS PANEL. *** The settings panel (modules/settings.js) is another
// agent's file this round and is the screen's whole menu; this is one small view of one chosen thing. The
// lines that would let the settings panel show a selection too are with the coordinator. If they land, the
// builder can hold the settings panel in this place instead -- one value in dashboards.js.
//
// Nothing chosen: it says how to choose something, in words. Done (in its card) ends the editing.

import { registerModule } from '../module.js';
import { renderOptions, EDIT_SELECTED_TOPIC, EDIT_ENDED_TOPIC, EDIT_PANEL_TOPIC, ensureEditCss } from '../edit_mode.js';

// What it says with nothing chosen. Site copy: no "her screen", no names.
export const OPTIONS_IDLE = 'Nothing is chosen yet. Press ✎ in the corner of a panel (beside ⤢), then press a thing in it: '
  + 'its options show here. Done, or Escape, stops.';

// Which rows: the ⚙ menu's levels. 'standard' is the menu's own default; 'advanced' shows every row a
// module declares (the builder is where somebody goes to set things, so it is one press away).
export const OPTIONS_SETTINGS = Object.freeze([
  Object.freeze({ key: 'level', label: 'Show', kind: 'choice', default: 'standard', level: 'essential',
    options: [{ value: 'essential', label: 'The essentials' }, { value: 'standard', label: 'The usual ones' }, { value: 'advanced', label: 'Everything' }] }),
]);

registerModule(
  { type: 'options', title: 'Options', core: 'new', dependsOn: 'local', importance: 'optional',
    description: 'The options of whatever you choose in a panel you are editing: press ✎ on a panel, then press a thing in it.',
    settings: OPTIONS_SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let sel = null;
    let view = null;
    let torn = false;
    const offs = [];
    const level = () => {
      const v = state?.get?.()?.level;
      return ['essential', 'standard', 'advanced'].includes(v) ? v : 'standard';
    };
    function draw() {
      if (torn) return;
      try { view?.destroy(); } catch { /* gone */ }
      view = null;
      if (!sel) {
        mount.innerHTML = `<div class="em-opts" data-options-idle><strong class="em-title">Options</strong><p class="em-help">${OPTIONS_IDLE}</p></div>`;
        return;
      }
      const host = document.createElement('div');
      host.dataset.optionsFor = sel.panelId || '';
      mount.replaceChildren(host);
      const panelId = sel.panelId;
      view = renderOptions(host, sel, {
        level: level(),
        doneLabel: 'Done',
        onDone: () => { try { ctx.bus?.publish?.(EDIT_PANEL_TOPIC, { id: panelId, on: false, from: 'options' }); } catch (err) { console.error('options: done', err); } },
      });
    }
    return {
      init() {
        ensureEditCss(mount.ownerDocument || document);
        mount.dataset.options = '';
        offs.push(ctx.bus?.subscribe?.(EDIT_SELECTED_TOPIC, (p) => {
          if (!p || typeof p !== 'object') return;
          try { p.claim?.(); } catch { /* nothing to claim */ }
          sel = p;
          draw();
        }));
        offs.push(ctx.bus?.subscribe?.(EDIT_ENDED_TOPIC, (p) => {
          if (sel && (!p || !p.id || p.id === sel.panelId)) { sel = null; draw(); }
        }));
        offs.push(state?.subscribe?.(() => { if (sel) draw(); }));
        draw();
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        for (const off of offs.splice(0)) { try { off?.(); } catch { /* gone */ } }
        try { view?.destroy(); } catch { /* gone */ }
        mount.innerHTML = '';
      },
      __probe: () => ({ selected: sel ? { panelId: sel.panelId, target: sel.target, label: sel.label } : null }),
    };
  },
);
