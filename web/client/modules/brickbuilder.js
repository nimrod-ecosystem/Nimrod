// modules/brickbuilder.js — THE BRICK BUILDER: MAKE A MODEL FROM NIMROD PARTS (2026-10-09).
//
// Mike, 2026-10-09: "We need some sort of builder on the site for making models out of the bricks as well as building
// rooms/dashboards." The model and its moves are ../brick_builder.js, the page around them ../brick_builder_view.js
// (both argued there: things fall down, one cursor, pick up + put down, every move a button a switch can reach). This
// file is the module: where a person's models are kept, the rows for them, and the verbs.
//
// *** WHERE A MODEL IS KEPT, ARGUED. *** Two places, both from a press or by themselves:
//   ON OUR SERVER, by itself after every change, in ONE ROW SHARED BY THE PERSON'S BUILDERS (`ctx.makeState
//   ('brick_builder')`, the shape `bank` and `scoreboard` use), one key per model (`build_<id>`), so two devices
//   changing two models never overwrite each other (state.js keeps a refused write's other keys). A model is a
//   person's own small layout data: parts, sizes, places and colour names -- no picture, no sound -- which the server
//   may hold (storage_line.py; test_storage_line.py checks a real model passes). AGAINST: "keep everything a person
//   makes on their own machine". A model is the same kind of thing as a screen's layout, which is kept here; and a
//   model kept only on one device would not be in the builder on the next one.
//   IN THE NIMROD FOLDER, from "Save to my Nimrod folder": `Data/Brick models/<name>.json` (user_folders.js, the
//   "things you export" folder), or a download where there is no folder. "Open a file" reads one back, and reads
//   the published furniture's own files too (design-assets/bricks/scenes/*.json).
//   A model is saved only once something is put in it, so opening the builder makes no empty models.
//
// HARD-CODED, argued: the folder's name "Brick models" (inside Data, beside the person's other exports; a new
// SUBFOLDERS kind of its own was argued against -- nothing reads it on another device yet, and Data's README already
// says "things you export"). The delete press asks twice within DELETE_MS (5 s): nothing waits on the second press --
// if nobody gives it, nothing is deleted.

import { registerModule } from '../module.js';
import {
  SCHEMA, FLOOR_CELLS, GRID, newBuild, normalizeBuild, toFile, fromFile, fileNameFor, exampleBuild, EXAMPLE_LABELS, cleanName,
} from '../brick_builder.js';
import { mountBuilderView } from '../brick_builder_view.js';
import { SUBFOLDERS, kindFolder, allowAgain, subfolder, handleStore } from '../user_folders.js';

export const TYPE = 'brickbuilder';
export const TITLE = 'Brick builder';
export const SHARED_KEY = 'brick_builder';
export const BUILD_PREFIX = 'build_';
export const FOLDER_NAME = 'Brick models';
export const DELETE_MS = 5000;

export const DEFAULTS = Object.freeze({ floorCells: FLOOR_CELLS, sockets: true });
const SETTINGS = [
  { key: 'floorCells', label: 'A new model starts on a floor of', kind: 'choice', default: FLOOR_CELLS, level: 'essential',
    options: [8, 12, 16, 24, 32].map((n) => ({ value: n, label: `${n * GRID} mm square (${n} × ${n} bricks)` })),
    note: 'It grows by itself to fit a big part, and "Bigger floor" makes it bigger.' },
  { key: 'sockets', label: 'Draw the sockets on every part', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No, plain faces',
    note: 'Plain faces are quicker to draw on a slow computer.' },
];

/** The saved models in a shared row, newest first: [{ id, name, parts, ... }]. Pure. */
export function savedBuilds(row) {
  const out = [];
  for (const [k, v] of Object.entries(row || {})) {
    if (!k.startsWith(BUILD_PREFIX) || !v || typeof v !== 'object') continue;
    const b = normalizeBuild(v);
    if (b) out.push(b);
  }
  return out.sort((a, b) => (b.updated - a.updated) || a.name.localeCompare(b.name));
}
/** "Model 3": the first free name. */
export function nextName(list, base = 'Model') {
  const taken = new Set((list || []).map((b) => String(b.name).toLowerCase()));
  let n = 1;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

registerModule(
  { type: TYPE, title: TITLE, core: 'new', dependsOn: 'local', importance: 'optional',
    description: 'make a model from Nimrod bricks, plates and brackets, in any size on the 40 mm grid: put parts down, '
      + 'stack them, turn them, color them, undo; by mouse, touch, keys or one switch',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state } = ctx;
    let shared = null;
    let view = null;
    let dead = false;
    let cfg = { ...DEFAULTS };
    let open = null;            // the id of the model on the board
    let saved = [];             // the person's models
    let unsavedNew = true;      // the model on the board has never been saved (empty)
    let deleteArmed = 0;
    let lastSaved = '';
    const offs = [];
    const now = () => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
    const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);

    const row = () => { try { return (shared || state)?.get?.() || {}; } catch { return {}; } };
    function refreshList() { saved = savedBuilds(row()); }

    function persist(build) {
      if (dead || !build) return;
      const b = normalizeBuild({ ...build, updated: now() });
      const key = `${BUILD_PREFIX}${b.id}`;
      const sig = JSON.stringify([b.name, b.floor, b.parts]);
      if (sig === lastSaved && !unsavedNew) return;
      if (unsavedNew && !b.parts.length) return;   // an empty new model is not kept
      lastSaved = sig;
      unsavedNew = false;
      try { (shared || state)?.set?.({ [key]: b }); } catch (err) { console.error('brick builder: save', err); }
      try { state?.set?.({ open: b.id }); } catch { /* fine */ }
      refreshList();
      syncExtra();
    }

    function openBuild(b, { isNew = false } = {}) {
      const n = normalizeBuild(b) || newBuild({ floorCells: cfg.floorCells });
      open = n.id;
      unsavedNew = isNew;
      lastSaved = isNew ? '' : JSON.stringify([n.name, n.floor, n.parts]);
      view?.load(n);
      if (!isNew) { try { state?.set?.({ open: n.id }); } catch { /* fine */ } }
      if (isNew && n.parts.length) persist(n);
      syncExtra();
    }
    function freshName() { refreshList(); return nextName(saved); }

    // ---- the host's own rows (models, files) -----------------------------------------------------------------
    const btn = (act, label) => `<button type="button" class="bb-btn" data-act="${act}">${label}</button>`;
    const EXTRA = '<div class="bb-row" data-group="models"><p class="bb-lab">Your models</p>'
      + '<label class="bb-own">Name <input type="text" data-name maxlength="60" size="14"></label>'
      + `${btn('modelPrev', '◀ Previous')}${btn('modelNext', 'Next ▶')}${btn('modelNew', 'New model')}${btn('modelCopy', 'Make a copy')}`
      + `${btn('modelDelete', 'Delete this model')}</div>`
      + `<div class="bb-row" data-group="start"><p class="bb-lab">Start from</p>${Object.entries(EXAMPLE_LABELS).map(([k, v]) => btn(`example:${k}`, esc(v))).join('')}</div>`
      + `<div class="bb-row" data-group="files"><p class="bb-lab">Files</p>${btn('toFolder', 'Save to my Nimrod folder')}${btn('openFile', 'Open a file')}`
      + '<input type="file" accept=".json,application/json" data-file hidden></div>';

    function syncExtra() {
      if (!view) return;
      const root = view.el;
      const nameEl = root.querySelector('[data-name]');
      const b = view.editor.get();
      if (nameEl && doc?.activeElement !== nameEl && nameEl.value !== b.name) nameEl.value = b.name;
      const others = saved.filter((s) => s.id !== open).length;
      for (const a of ['modelPrev', 'modelNext']) { const el = root.querySelector(`[data-act="${a}"]`); if (el) el.disabled = others === 0; }
      const del = root.querySelector('[data-act="modelDelete"]');
      if (del) {
        del.disabled = unsavedNew;
        del.textContent = deleteArmed > now() ? 'Press again to delete it' : 'Delete this model';
      }
      view.render();
    }

    function step(dir) {
      refreshList();
      if (!saved.length) return false;
      const i = saved.findIndex((s) => s.id === open);
      const next = saved[(i < 0 ? 0 : i + (dir > 0 ? 1 : -1) + saved.length) % saved.length];
      if (!next || next.id === open) return false;
      openBuild(next);
      view.tell(`Opened: ${next.name}.`);
      return true;
    }

    async function toFolder() {
      const b = view.editor.get();
      const text = toFile(b);
      const name = fileNameFor(b);
      try {
        const store = handleStore();
        const k = await kindFolder('data', { store });
        if (k && k.holder && k.source !== 'none' && await allowAgain(k.holder, 'readwrite') === 'granted') {
          let dir = k.source === 'own' ? k.holder : await subfolder(k.holder, 'data');
          if (!dir) dir = await k.holder.getDirectoryHandle(SUBFOLDERS.data || 'Data', { create: true });
          const sub = await dir.getDirectoryHandle(FOLDER_NAME, { create: true });
          const fh = await sub.getFileHandle(name, { create: true });
          const out = await fh.createWritable();
          try { await out.write(text); } finally { await out.close(); }
          view.tell(`Saved in your Nimrod folder: Data / ${FOLDER_NAME} / ${name}.`);
          return 'folder';
        }
      } catch (err) { console.error('brick builder: folder', err); }
      // No Nimrod folder on this device (or no leave to write in it): the file is downloaded instead.
      try {
        const blob = new Blob([text], { type: 'application/json' });
        const a = doc.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        doc.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        view.tell(`Downloaded ${name}. Set up your Nimrod folder to keep models there.`);
      } catch (err) { console.error('brick builder: download', err); view.tell('That could not be saved here.'); }
      return 'download';
    }
    async function readFile(file) {
      try {
        const b = fromFile(await file.text());
        if (!b) { view.tell('That file is not a model of Nimrod parts.'); return false; }
        openBuild({ ...b, name: cleanName(b.name) }, { isNew: true });
        persist(view.editor.get());
        view.tell(`Opened ${file.name}: ${b.parts.length} part${b.parts.length === 1 ? '' : 's'}.`);
        return true;
      } catch (err) { console.error('brick builder: open', err); view.tell('That file could not be read.'); return false; }
    }

    function onAct(act) {
      if (act === 'modelPrev') return step(-1);
      if (act === 'modelNext') return step(1);
      if (act === 'modelNew') {
        openBuild(newBuild({ name: freshName(), floorCells: cfg.floorCells }), { isNew: true });
        view.tell('A new model. Put a part down to start it.');
        return true;
      }
      if (act === 'modelCopy') {
        const b = view.editor.get();
        openBuild({ ...b, id: null, name: cleanName(`${b.name} (copy)`) }, { isNew: true });
        persist(view.editor.get());
        view.tell('A copy. Changes now go to the copy.');
        return true;
      }
      if (act === 'modelDelete') {
        if (unsavedNew) return false;
        if (deleteArmed <= now()) {
          deleteArmed = now() + DELETE_MS;
          view.tell('Press Delete again to delete this model. Nothing happens if you do not.');
          setTimeout(() => { if (!dead) syncExtra(); }, DELETE_MS + 50);
          syncExtra();
          return true;
        }
        deleteArmed = 0;
        const gone = view.editor.get();
        try { (shared || state)?.set?.({ [`${BUILD_PREFIX}${gone.id}`]: null }); } catch (err) { console.error('brick builder: delete', err); }
        refreshList();
        if (saved.length) openBuild(saved[0]); else openBuild(newBuild({ name: freshName(), floorCells: cfg.floorCells }), { isNew: true });
        view.tell(`Deleted: ${gone.name}.`);
        return true;
      }
      if (act.startsWith('example:')) {
        const b = exampleBuild(act.slice(8));
        if (!b) return false;
        openBuild({ ...b, name: b.name }, { isNew: true });
        view.tell(`${b.name}, from big pieces: ${b.parts.length} parts. It is your own model now.`);
        return true;
      }
      if (act === 'toFolder') { toFolder(); return true; }
      if (act === 'openFile') { view.el.querySelector('[data-file]')?.click(); return true; }
      return false;
    }

    return {
      async init() {
        try { shared = typeof ctx.makeState === 'function' ? ctx.makeState(SHARED_KEY) : null; } catch { shared = null; }
        try { await state?.load?.(); } catch { /* defaults */ }
        try { await shared?.load?.(); } catch { /* nothing saved yet, or offline */ }
        if (dead) return;
        const own = state?.get?.() || {};
        cfg = { floorCells: [8, 12, 16, 24, 32].includes(Number(own.floorCells)) ? Number(own.floorCells) : DEFAULTS.floorCells, sockets: own.sockets !== false };
        refreshList();
        const first = saved.find((s) => s.id === own.open) || saved[0] || null;
        view = mountBuilderView(mount, {
          doc, build: first || newBuild({ name: nextName(saved), floorCells: cfg.floorCells }), sockets: cfg.sockets,
          extraHtml: EXTRA, onAct,
          onChange: (b) => persist(b),
        });
        open = view.editor.get().id;
        unsavedNew = !first;
        lastSaved = first ? JSON.stringify([first.name, first.floor, first.parts]) : '';
        const nameEl = view.el.querySelector('[data-name]');
        nameEl?.addEventListener('change', () => { if (view.editor.rename(nameEl.value)) persist(view.editor.get()); });
        const fileEl = view.el.querySelector('[data-file]');
        fileEl?.addEventListener('change', () => { const f = fileEl.files?.[0]; if (f) readFile(f); fileEl.value = ''; });
        syncExtra();
        view.tell(first ? `${first.name}: ${first.parts.length} part${first.parts.length === 1 ? '' : 's'}.` : 'Put a part down to start a model.');
        const sub = (t, fn) => { try { const off = bus?.subscribe?.(t, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        sub(`${TYPE}/next`, () => view.scan(1));
        sub(`${TYPE}/prev`, () => view.scan(-1));
        sub(`${TYPE}/select`, () => view.select());
        sub(`${TYPE}/left`, () => view.press('left'));
        sub(`${TYPE}/right`, () => view.press('right'));
        sub(`${TYPE}/up`, () => view.press('up'));
        sub(`${TYPE}/down`, () => view.press('down'));
        sub(`${TYPE}/put`, () => view.press('put'));
        try {
          const off = state?.subscribe?.((v) => {
            if (dead || !v) return;
            const s = v.sockets !== false;
            const f = [8, 12, 16, 24, 32].includes(Number(v.floorCells)) ? Number(v.floorCells) : DEFAULTS.floorCells;
            if (s !== cfg.sockets || f !== cfg.floorCells) {
              const redraw = s !== cfg.sockets;
              cfg = { floorCells: f, sockets: s };
              if (redraw) { const b = view.editor.get(); const hand = view.editor.hand(); view.destroy(); view = null; remount(b, hand); }
            }
          });
          if (typeof off === 'function') offs.push(off);
        } catch { /* no live settings */ }
        try {
          const off = shared?.subscribe?.(() => { if (!dead) { refreshList(); syncExtra(); } });
          if (typeof off === 'function') offs.push(off);
        } catch { /* fine */ }
      },
      onResize() { view?.render(); },
      onHide() { try { (shared || state)?.flush?.(); } catch { /* fine */ } },
      destroy() {
        dead = true;
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { (shared || state)?.flush?.(); } catch { /* fine */ }
        try { shared?.destroy?.(); } catch { /* fine */ }
        view?.destroy();
        view = null;
        mount.innerHTML = '';
      },
      __probe: () => ({
        build: view?.editor.get() || null, hand: view?.editor.hand() || null, cursor: view?.editor.cursor() || null,
        saved: saved.map((s) => s.id), open, unsavedNew, lit: view?.lit() || null, say: view?.say() || '', cfg: { ...cfg },
        row: row(),
      }),
      __view: () => view,
      __readFile: (file) => readFile(file),
    };

    function remount(b, hand) {
      view = mountBuilderView(mount, { doc, build: b, hand, sockets: cfg.sockets, extraHtml: EXTRA, onAct, onChange: (x) => persist(x) });
      const nameEl = view.el.querySelector('[data-name]');
      nameEl?.addEventListener('change', () => { if (view.editor.rename(nameEl.value)) persist(view.editor.get()); });
      const fileEl = view.el.querySelector('[data-file]');
      fileEl?.addEventListener('change', () => { const f = fileEl.files?.[0]; if (f) readFile(f); fileEl.value = ''; });
      syncExtra();
    }
  },
);

export { SCHEMA };
