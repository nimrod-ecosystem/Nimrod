// modules/library.js — "MODULES", a module (type 'library'): everything you can put on a screen, to look
// through, filter and sort, with the Nimrod Game's sandbox / game toggle on it. The library itself — the
// items, the categories, the grid and its cursor — is ../library.js; this file is the module around it.
//
// TWO WAYS IT IS ON A SCREEN, one module:
//   * A PANEL OF ITS OWN (added like any module). Picking something there turns THIS panel into it, in the
//     same place — Mike: "you could double click on the module you want in the modules module and it would
//     replace the modules module." Its settings are kept for switching back (the arrangement's
//     `switchPanel`), so Switch module brings the library back with its sort and category as they were.
//   * IN ANOTHER PANEL'S PLACE, for Switch module (kiosk.js `openLibraryAt`): the kiosk hands it a host
//     that says which panel it stands in for, what to do with a pick, and how to put the panel back.
// The host arrives as `ctx.libraryHost(instanceId)` (kiosk.js `childCtx`), so a library inside a dashboard
// inside the kiosk still finds it. With no host (a preview page) it is a catalogue to read: nothing can be
// put anywhere, and its details say where to go to do that.
//
// Verbs (actions.js MODULE_VERBS.library): next / prev / up / down / left / right / select / back.

import { registerModule } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { createUnlockGate } from '../unlocks.js';
import {
  LIBRARY_TYPE, LIBRARY_TITLE, LIBRARY_SETTINGS, LIBRARY_DEFAULTS, libraryItems, brickItems, mountLibrary,
  registerLibraryAIActions, CATEGORY_IDS, USE_FILTERS,
} from '../library.js';

export const LIBRARY_VERB_TOPICS = Object.freeze(Object.fromEntries(
  ['next', 'prev', 'select', 'back', 'up', 'down', 'left', 'right'].map((v) => [v, `library/${v}`]),
));
const FIELDS = LIBRARY_SETTINGS.map((f) => normalizeField(f)).filter(Boolean);
const BRICKS_URL = new URL('../design-assets/bricks/bricks.json', import.meta.url).href;

/** The published bricks, as library items (empty when the list cannot be read: the 3D chip says so). */
export async function loadBricks(fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  if (!fetchImpl) return [];
  try {
    const r = await fetchImpl(BRICKS_URL, { cache: 'force-cache' });
    if (!r || !r.ok) return [];
    return brickItems(await r.json());
  } catch { return []; }
}

/** What the module reads off its state row: the declared settings, plus the category and the filter. */
export function libraryPrefsFrom(values = {}) {
  const v = values || {};
  const out = {};
  for (const f of FIELDS) {
    const x = fieldValue(f, v);
    // A stored value that is none of the choices is not a choice: the default stands.
    out[f.key] = (f.options || []).some((o) => o.value === x) ? x : f.default;
  }
  out.category = CATEGORY_IDS.includes(v.category) ? v.category : 'all';
  out.use = USE_FILTERS.some((u) => u.id === v.use) ? v.use : 'any';
  return { ...LIBRARY_DEFAULTS, ...out };
}

// The AI's `place` / `swap` go wherever the library goes (../library.js argues them).
registerLibraryAIActions();

registerModule(
  { type: LIBRARY_TYPE, title: LIBRARY_TITLE, core: 'new', dependsOn: 'none', importance: 'optional',
    description: 'everything you can put on a screen — modules, scenes, furniture and 3D bricks — to look '
      + 'through, filter and sort; pick one and it takes this place',
    settings: LIBRARY_SETTINGS },
  (ctx) => {
    const { mount } = ctx;
    let lib = null;
    let gate = null;
    let offState = null;
    const offs = [];
    let torn = false;
    const host = (() => { try { return typeof ctx.libraryHost === 'function' ? ctx.libraryHost(ctx.instanceId) || null : null; } catch { return null; } })();
    const values = () => { try { return ctx.state?.get?.() || {}; } catch { return {}; } };
    const say = (text) => { try { ctx.output?.say?.(text, { source: LIBRARY_TYPE }); } catch { /* no voice */ } };
    return {
      async init() {
        try { await ctx.state?.load?.(); } catch { /* the defaults stand */ }
        if (torn) return;
        // The Nimrod Game, for this dashboard (unlocks.js): only where the host can open its rows.
        if (typeof ctx.makeState === 'function' && typeof ctx.makeEvents === 'function') {
          try { gate = createUnlockGate({ makeState: ctx.makeState, makeEvents: ctx.makeEvents, bus: ctx.bus || null }); }
          catch { gate = null; }
        }
        const ready = gate ? gate.load().catch(() => null) : Promise.resolve(null);
        lib = mountLibrary(mount, {
          items: () => libraryItems(),
          moreItems: () => loadBricks(),
          host, gate, say,
          // The person's "How you choose things" (6fd7575): "step through" scans the library by rows.
          chooseMode: () => (typeof ctx.chooseMode === 'function' ? ctx.chooseMode() : ctx.chooseMode),
          prefs: libraryPrefsFrom(values()),
          onPrefs: (patch) => { try { ctx.state?.set?.(patch); } catch (err) { console.error('library: save', err); } },
        });
        try { gate?.startPolling?.(); } catch { /* offline */ }
        try { offState = ctx.state?.subscribe?.((v) => { lib?.setPrefs(libraryPrefsFrom(v)); }) || null; } catch { offState = null; }
        for (const [verb, topic] of Object.entries(LIBRARY_VERB_TOPICS)) {
          try { const off = ctx.bus?.subscribe?.(topic, () => lib?.verb(verb)); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ }
        }
        // What the host asked for at open (an AI's "put X where Y is", already pressed): after the game has
        // said what is locked, so a locked module shows its ways to unlock instead of being put there.
        if (host && host.focus) {
          await ready;
          if (!torn) lib?.openFor(host.focus, { autoPlace: !!host.autoPlace });
        }
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { offState?.(); } catch { /* gone */ }
        try { lib?.destroy(); } catch { /* gone */ }
        try { gate?.destroy(); } catch { /* gone */ }
        lib = null; gate = null;
        mount.innerHTML = '';
      },
      // The verbs, for a host that holds the scan itself (kiosk.js, in another panel's place).
      verb: (v) => (lib ? lib.verb(v) : false),
      __probe: () => (lib ? lib.__probe() : null),
    };
  },
);
