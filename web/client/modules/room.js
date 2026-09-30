// modules/room.js — A ROOM, AS A MODULE: so the room renderer can be tried on the modules page.
//
// Change list rows 2.33, 2.34 and 2.37. The renderer is `../room_scene.js` (Claude Design's rules,
// ported); the rooms are `../room_presets.js`. This file is only the module: settings as data, a
// mount, the verbs, and what a press does when nothing on the page answers it.
//
// *** WHAT IT IS NOT, YET: the room is not the screen here. *** Step 6 Stage R is where a dashboard's
// scene becomes a room and real modules mount in its slots. Here the room is ONE PANEL: its display
// objects (the cabinet, the bookshelf) lift a flat, labelled, empty slot — the place a transport bar
// or the edit menus will go — and its button objects publish the SAME verbs the plain bar's buttons
// will (`system/fullscreen`, `system/settings`) on the bus. Nothing in the kiosk answers those topics
// yet (kiosk.js is Stage R's to wire), so on a page where nobody claims the press:
//   * the flower pot puts THIS PANEL into full screen and out again — the nearest honest meaning of
//     "full screen on/off" for one panel;
//   * the door says, for a moment, where settings open on a real screen. It is a note at the top of
//     the panel that closes itself (never a dialog, never waiting on anybody).
//
// *** THE INVARIANT. *** A room takes no input and asks for none: left alone it is scenery with a
// clock on the wall. The one state a press can open — a lifted panel — goes back by itself after
// "Put a lifted panel back after" (default one minute), unless somebody chose "Never".
//
// *** NOTIFICATIONS. *** The lamp lights and the cat's ears perk up when the wake phrase is heard
// (`speech/listening`, the same event listening_cue.js answers — the on-screen cue still comes; the
// room only adds to it). Anything else can make the room react by publishing `room/notify` with
// `{ event: 'message' | 'call' | 'visitor' | 'timer' | 'wake' | <a custom name>, ms?, text?, cueShown? }`.
// *** THE ON-SCREEN CUE ALWAYS COMES TOO (room-add-ons §6). *** For a `room/notify` the room shows the
// event in words itself (a note at the top of the panel, `room_notify.js` CUES, or `text`) unless the
// publisher says `cueShown: true` — it drew its own, like the listening cue does for the wake phrase.
// WHICH OBJECT DOES WHAT is the room's own list of rules (`../room_notify.js`), stored in this
// instance's state row as `notify` (nothing stored = Design's defaults). `room/reactions` opens the
// editor (`../room_notify_editor.js`) inside the room; while it is open, room/next, room/prev,
// room/select and room/back drive it, and it closes by itself after "Put a lifted panel back after".
//
// *** NIMROD, THE HELP BUTTON (room-add-ons §2; Mike, room_as_home §7.1.2). *** Pressing the room's
// cat explains whatever was picked last — the object the scan landed on or the pointer rested on —
// or, with nothing picked, the room itself (`../cat_help.js`). He is out of the way of the thing he
// explains, and the room's own sleeping cat steps away while he talks. Petting him is the stroke
// (a pointer drawn across him) or holding the switch on him (`room/hold`); with "Cat help" off in
// his settings, a plain press pets him as it always did. WHY PRESS = HELP AND NOT A ROOM SETTING
// "pressing Nimrod: explains / pets": that setting would be a second switch for the same choice
// "Cat help: on/off" already makes, and two switches for one thing is how they end up disagreeing.

//
// *** THE SECOND PASS (row 2.37 items 4, 6, 7, 11, 13). *** All settings on the pieces that exist:
//   the window    shows the weather in a pane and opens the weather when pressed; your AI can visit
//                 (`room/visit` { text, src? }), never at night unless "any time" was chosen
//   the bookshelf is a library: each book a module, pressed = that module opens (`system/module`)
//   the desk, sofa, armchair and bed zoom into their area, with Back first and a return by itself
//   any animal    can be petted: the cat purrs (a setting); "Pet Nimrod" is also in his help bubble, so
//                 one switch can pet him — press him, then Pet — without a hold binding
//   zoom on focus stays this module's "Grow what the cursor is on" (off by default); the screen-wide
//                 version for panels is `../zoom_focus.js`.

import { registerModule, listManifests } from '../module.js';
import { normalizeField, fieldValue } from '../settings_fields.js';
import { mountRoomScene, RENDER_DEFAULTS, OBJECT_DEFAULTS, DEFAULT_BOOKS, MAX_BOOKS, moduleLabel } from '../room_scene.js';
import { listPresets, presetRecipe, DEFAULT_PRESET } from '../room_presets.js';
import { LISTENING_TOPIC } from '../input_speech.js';
import { mountCatHelp } from '../cat_help.js';
import { readRules, objectsIn, cueFor, playSound } from '../room_notify.js';
import { mountNotifyEditor } from '../room_notify_editor.js';
import { flashLimit } from '../flash_limit.js';

// Every default argued (Rule 1), and every one of them a setting:
//   preset 'theRoom'   the room whose furniture carries the controls: it is the one that shows what
//                      this renderer is FOR (objects that are buttons, displays that lift). Design's
//                      four starter rooms are one press away.
//   light 'auto'       Design's rule 5: follow the real clock. Fixed day/evening/night for anybody
//                      who wants the look without the change (a night owl, a screen in a dark room).
//   labels 'always'    Design: an object's meaning is never only its picture. "When pointed at" is
//                      for somebody who finds the chips busy and can point.
//   motion 'gentle'    the same ladder, words and default as `scene` and `wallpaper`.
//   liftReturnMs 60000 the invariant's way out (room_scene.js RENDER_DEFAULTS says why a minute).
//   zoom 'off'         Design (room-add-ons §1): zoom on focus is off by default, 1.1–1.5×.
//   signWords ''       empty keeps each room's own words; anything typed goes on every sign in it.
//   showSlots false    an editing aid (Design's "Show slot sizes"), not something a room shows.
// The second pass (every one on Mike's list, for and against):
//   shelf 'library'    Mike's own words for the bookshelf (§7.2.4) are newer than the prototype's "edit
//                      menus on the shelf", and the edit menus are not a module yet (the shelf lifted an
//                      EMPTY slot). "As the room has it" keeps the prototype's shelf.
//   books 'screen'     the modules on this screen (asked of the kiosk), else a few common ones.
//   windowShows 'weather'  the weather sits in one pane when the weather module has any; with no weather
//                      module or no place set, the window is exactly the view it was. Sends nothing.
//   windowPress 'weather'  pressing the window opens the weather (Mike: "Click the window for the
//                      weather"). Against: one more stop in the scan; "Nothing" removes it.
//   aiVisits 'news'    Design's middle choice: only when something has something to say, never at night.
//   closeups 'on'      desks, sofas, armchairs and beds zoom in (Mike, §7.2.13). Against: more stops in
//                      the scan for a switch user; "Off" removes them.
//   closeupReturnMs 120000  room_scene.js RENDER_DEFAULTS says why two minutes.
//   petSound true      room_scene.js RENDER_DEFAULTS says why: it answers the person's own press.
export const DEFAULTS = Object.freeze({
  preset: DEFAULT_PRESET, light: 'auto', labels: 'always', motion: 'gentle',
  liftReturnMs: RENDER_DEFAULTS.liftReturnMs, zoom: 'off', signWords: '', showSlots: false,
  shelf: OBJECT_DEFAULTS.shelf, books: 'screen', bookList: '', windowShows: OBJECT_DEFAULTS.windowShows,
  windowPress: OBJECT_DEFAULTS.windowPress,
  aiVisits: RENDER_DEFAULTS.aiVisits, closeups: OBJECT_DEFAULTS.closeups, closeupReturnMs: RENDER_DEFAULTS.closeupReturnMs,
  petSound: RENDER_DEFAULTS.petSound,
});

export const SETTINGS = [
  { key: 'preset', label: 'Which room', kind: 'choice', default: DEFAULTS.preset, level: 'essential',
    options: listPresets() },
  { key: 'light', label: 'Light', kind: 'choice', default: DEFAULTS.light, level: 'essential',
    options: [
      { value: 'auto', label: 'Follows the clock' },
      { value: 'day', label: 'Day' },
      { value: 'evening', label: 'Evening' },
      { value: 'night', label: 'Night' },
    ] },
  { key: 'labels', label: 'Labels on objects', kind: 'choice', default: DEFAULTS.labels, level: 'essential',
    options: [
      { value: 'always', label: 'Always' },
      { value: 'pointed', label: 'When pointed at' },
    ] },
  { key: 'signWords', label: 'Words on the signs', kind: 'text', default: DEFAULTS.signWords, level: 'standard',
    placeholder: 'The room’s own words', maxLength: 40 },
  { key: 'motion', label: 'Movement', kind: 'choice', default: DEFAULTS.motion, level: 'standard',
    options: [
      { value: 'gentle', label: 'gentle — as designed' },
      { value: 'calm', label: 'calm — slower' },
      { value: 'still', label: 'still — no movement at all' },
    ] },
  { key: 'liftReturnMs', label: 'Put a lifted panel back after', kind: 'choice', default: DEFAULTS.liftReturnMs,
    level: 'standard',
    options: [
      { value: 30000, label: '30 seconds' },
      { value: 60000, label: '1 minute' },
      { value: 120000, label: '2 minutes' },
      { value: 0, label: 'Never (put it back yourself)' },
    ] },
  { key: 'zoom', label: 'Grow what the cursor is on', kind: 'choice', default: DEFAULTS.zoom, level: 'standard',
    options: [
      { value: 'off', label: 'Off' },
      { value: '1.1', label: 'A little (1.1×)' },
      { value: '1.25', label: 'Some (1.25×)' },
      { value: '1.5', label: 'A lot (1.5×)' },
    ] },
  { key: 'showSlots', label: 'Show slot sizes', kind: 'toggle', default: DEFAULTS.showSlots, level: 'advanced',
    onLabel: 'Shown', offLabel: 'Hidden' },
  // ---- the second pass ----
  { key: 'shelf', label: 'The bookshelf', kind: 'choice', default: DEFAULTS.shelf, level: 'standard',
    help: 'A library: each book is a module, and pressing a book opens it.',
    options: [
      { value: 'library', label: 'A library of modules' },
      { value: 'recipe', label: 'As the room has it' },
    ] },
  { key: 'books', label: 'Books on the shelf', kind: 'choice', default: DEFAULTS.books, level: 'standard',
    options: [
      { value: 'screen', label: 'This screen’s modules' },
      { value: 'few', label: 'A few common ones' },
      { value: 'named', label: 'The ones named below' },
    ] },
  { key: 'bookList', label: 'Name the books', kind: 'text', default: DEFAULTS.bookList, level: 'advanced',
    placeholder: 'Photos, Clock, Weather', maxLength: 300,
    help: 'Module names, separated by commas. Used when "Books on the shelf" is "The ones named below".' },
  { key: 'windowShows', label: 'The window shows', kind: 'choice', default: DEFAULTS.windowShows, level: 'standard',
    help: 'The weather comes from the Weather module, once it has a place. The room sends nothing itself.',
    options: [
      { value: 'weather', label: 'The view and the weather' },
      { value: 'view', label: 'Just the view' },
    ] },
  { key: 'windowPress', label: 'Pressing the window', kind: 'choice', default: DEFAULTS.windowPress, level: 'standard',
    options: [
      { value: 'weather', label: 'Opens the weather' },
      { value: 'nothing', label: 'Does nothing' },
    ] },
  { key: 'aiVisits', label: 'Your assistant visits the window', kind: 'choice', default: DEFAULTS.aiVisits, level: 'standard',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'news', label: 'When it has news (not at night)' },
      { value: 'anytime', label: 'When it has news, night too' },
    ] },
  { key: 'closeups', label: 'Look closer at a desk or sofa', kind: 'choice', default: DEFAULTS.closeups, level: 'standard',
    options: [
      { value: 'on', label: 'On: pressing one zooms in' },
      { value: 'off', label: 'Off' },
    ] },
  { key: 'closeupReturnMs', label: 'Go back to the whole room after', kind: 'choice', default: DEFAULTS.closeupReturnMs,
    level: 'standard',
    options: [
      { value: 30000, label: '30 seconds' },
      { value: 60000, label: '1 minute' },
      { value: 120000, label: '2 minutes' },
      { value: 300000, label: '5 minutes' },
      { value: 0, label: 'Never (press Back yourself)' },
    ] },
  { key: 'petSound', label: 'Sound when an animal is petted', kind: 'toggle', default: DEFAULTS.petSound, level: 'standard',
    onLabel: 'On', offLabel: 'Off' },
];

/** "Photos, weather, AAC board" -> module types, matched by type or by title. Unknown names dropped. */
export function booksFromList(text = '', manifests = null) {
  let all = manifests;
  if (!all) { try { all = listManifests(); } catch { all = []; } }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const out = [];
  for (const raw of String(text || '').split(',')) {
    const n = norm(raw);
    if (!n) continue;
    const m = all.find((x) => norm(x.type) === n) || all.find((x) => norm(x.title) === n);
    if (m && !out.includes(m.type)) out.push(m.type);
    if (out.length >= MAX_BOOKS) break;
  }
  return out;
}

const FIELDS = Object.fromEntries(SETTINGS.map(normalizeField).filter(Boolean).map((f) => [f.key, f]));

/** What is in force, read through each declaration — the same reading the settings menu does. */
export function configFrom(row = {}) {
  const cfg = {};
  for (const f of Object.values(FIELDS)) cfg[f.key] = fieldValue(f, row || {});
  for (const k of ['preset', 'light', 'labels', 'motion', 'zoom', 'shelf', 'books', 'windowShows', 'windowPress', 'aiVisits', 'closeups']) {
    if (!FIELDS[k].options.some((x) => x.value === cfg[k])) cfg[k] = DEFAULTS[k];
  }
  for (const k of ['liftReturnMs', 'closeupReturnMs']) {
    if (!FIELDS[k].options.some((x) => x.value === cfg[k])) cfg[k] = DEFAULTS[k];
  }
  cfg.signWords = String(cfg.signWords ?? '').slice(0, 40);
  cfg.bookList = String(cfg.bookList ?? '').slice(0, 300);
  cfg.showSlots = !!cfg.showSlots;
  cfg.petSound = !!cfg.petSound;
  return cfg;
}

/** The books the renderer is given: null = ask the screen (then a few common ones). */
export function booksOption(cfg) {
  if (cfg.books === 'few') return DEFAULT_BOOKS.slice();
  if (cfg.books === 'named') { const named = booksFromList(cfg.bookList); return named.length ? named : DEFAULT_BOOKS.slice(); }
  return null;
}

// What the renderer is told, from what the settings say.
const renderOpts = (cfg) => ({
  light: cfg.light, labels: cfg.labels, motion: cfg.motion, liftReturnMs: cfg.liftReturnMs,
  zoom: cfg.zoom === 'off' ? null : Number(cfg.zoom), signWords: cfg.signWords, showSlots: cfg.showSlots,
  shelf: cfg.shelf, books: booksOption(cfg), windowShows: cfg.windowShows,
  windowPress: cfg.windowPress === 'nothing' ? 'recipe' : cfg.windowPress, aiVisits: cfg.aiVisits,
  closeups: cfg.closeups, closeupReturnMs: cfg.closeupReturnMs, petSound: cfg.petSound,
});

registerModule(
  { type: 'room', title: 'Room', core: 'new',
    // `none`: the room, its art, its clock and its window's scene need no server, no files of the
    // person's and no network — the same answer `scene` gives. The frames' two sample pictures
    // are bundled with the site like the rest of it.
    dependsOn: 'none', importance: 'optional',
    description: 'A room you can look into: furniture, a window onto a live scene, a clock and a '
      + 'calendar on the wall. Its furniture can hold the screen’s controls.',
    settings: SETTINGS },
  (ctx) => {
    const { mount, state } = ctx;
    let cfg = configFrom({});
    let scene = null;
    let help = null;
    let host = null;
    let torn = false;
    let editor = null;          // the reactions editor, while it is open
    let editorIdle = null;
    const offs = [];
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (id) => clearTimeout(id);

    // The room's notification rules, from its state row: null = Design's defaults.
    const rulesFrom = (row) => { const { rules, custom } = readRules(row || {}); return custom ? rules : null; };

    // ---- the reactions editor ----------------------------------------------------------------
    // THE INVARIANT'S WAY OUT, the same one a lifted panel has: nobody touching it for "Put a lifted
    // panel back after" closes it (0 = never, the person's own choice there already).
    function armEditor() {
      if (editorIdle != null) { clearT(editorIdle); editorIdle = null; }
      if (editor && cfg.liftReturnMs > 0) editorIdle = setT(() => { editorIdle = null; closeEditor(); }, cfg.liftReturnMs);
    }
    function closeEditor() {
      if (editorIdle != null) { clearT(editorIdle); editorIdle = null; }
      editor?.destroy();
      editor = null;
      return true;
    }
    function openEditor() {
      if (torn || !host || !scene) return null;
      if (editor) { armEditor(); return editor; }
      const row = state?.get?.() || {};
      editor = mountNotifyEditor(host, {
        rules: readRules(row).rules,
        objects: objectsIn(scene.recipe()),
        onChange: (rules) => { armEditor(); try { state?.set?.({ notify: rules }); } catch (err) { console.error('room: save rules', err); } },
        onTest: (rule) => {
          armEditor();
          scene?.testRule(rule);
          // The cue comes with the test too: a test shows exactly what the real thing will.
          scene?.toast(`Test: ${cueFor(rule)}`);
        },
        onDone: () => closeEditor(),
      });
      for (const ev of ['pointerdown', 'keydown']) editor?.el.addEventListener(ev, armEditor);
      armEditor();
      return editor;
    }
    function onSound(name) {
      const level = Number(ctx.audio?.master?.());
      playSound(name, { level: Number.isFinite(level) ? level : 1 });
    }

    // A press nobody on the page answered. See the header for why each of these is the honest one.
    function onUnclaimed(action, info = {}) {
      const { api } = info || {};
      if (torn) return;
      if (action === 'fullscreen.toggle') {
        const doc = mount.ownerDocument;
        try {
          if (doc.fullscreenElement) doc.exitFullscreen?.()?.catch?.(() => {});
          else mount.requestFullscreen?.()?.catch?.(() => api?.toast('Full screen is not available here.'));
        } catch { api?.toast('Full screen is not available here.'); }
        return;
      }
      if (action === 'settings.open') { api?.toast('On a screen, this door opens Settings.'); return; }
      if (action === 'module.open') {
        const { module } = info || {};
        // The window's weather: what the room already knows says itself, even with no Weather panel here.
        if (module === 'weather') {
          const w = api?.weather?.();
          api?.toast(w?.spoken ? `Now: ${w.spoken}` : 'Add the Weather module to this screen and set a place, and the weather shows here.');
          return;
        }
        api?.toast(`${moduleLabel(module)} is not on this screen. Add it, and this book opens it.`);
        return;
      }
      api?.toast('Nothing here answers that yet.');
    }

    function apply(row) {
      const next = configFrom(row || {});
      const presetChanged = next.preset !== cfg.preset;
      cfg = next;
      if (!scene) return;
      if (presetChanged) scene.setRecipe(presetRecipe(cfg.preset));
      scene.setOptions(renderOpts(cfg));
      // The rules ride on the room as placed here, not on the preset: a new room keeps them.
      scene.setNotify(rulesFrom(row));
    }

    return {
      // For a test: the renderer, so a suite can look at what it drew without re-deriving it.
      __scene: () => scene,
      __editor: () => editor,
      // The reactions editor, for a host that offers it (a settings row, an edit window).
      openReactions: () => openEditor(),
      init() {
        mount.innerHTML = '';
        host = document.createElement('div');
        host.className = 'room-mod';
        host.setAttribute('data-room-mod', '');
        host.style.cssText = 'position:relative;width:100%;height:100%;min-height:120px;overflow:hidden';
        mount.append(host);
        cfg = configFrom(state?.get?.() || {});
        // Nimrod's help. Draws nothing until he is pressed (cat_help.js), so mounting it is free.
        help = mountCatHelp(host, {
          output: ctx.output || null,
          screen: 'room',
          onShow: () => scene?.catAway(true),
          onClose: () => scene?.catAway(false),
        });
        // Press Nimrod: help. The bubble also offers "Pet Nimrod", so ONE switch can pet him (press him,
        // then Pet) without a hold binding; a pointer can still stroke him, a held switch still pets.
        const onCatPress = ({ id, selected }) => !!help?.explain(selected || { kind: 'screen', screen: 'room' }, {
          actions: [{ id: 'pet', label: 'Pet Nimrod', run: () => scene?.pet(id) }],
        });
        // The screen's flash limit (flash_limit.js): a getter, so a changed setting reaches the pressed-object
        // flash, the reactions and the window's scene without a remount.
        scene = mountRoomScene(host, presetRecipe(cfg.preset), { ...renderOpts(cfg), bus: ctx.bus, onUnclaimed, onCatPress, onSound,
          flashLimit: () => flashLimit(ctx) });
        scene.setNotify(rulesFrom(state?.get?.() || {}));
        const sub = state?.subscribe?.((row) => apply(row));
        if (typeof sub === 'function') offs.push(sub);
        // THE VERBS. `next`/`prev` walk the room's objects in Design's scan order, `select` presses
        // the one the cursor is on, `back` puts a lifted panel back. Through `ctx.bus`, so each also
        // answers on this instance's own scoped alias (bus.js `scope`). While the reactions editor
        // is open, they drive it instead (its first stop, and `back`, is Done).
        const drive = (inEditor, inRoom) => () => { if (editor) { armEditor(); inEditor(editor); } else inRoom(); };
        ctx.bus?.subscribe?.('room/next', drive((e) => e.next(), () => scene?.focusNext()));
        ctx.bus?.subscribe?.('room/prev', drive((e) => e.prev(), () => scene?.focusPrev()));
        ctx.bus?.subscribe?.('room/select', drive((e) => e.select(), () => scene?.select()));
        ctx.bus?.subscribe?.('room/back', drive(() => closeEditor(), () => scene?.back()));
        ctx.bus?.subscribe?.('room/reactions', () => openEditor());
        // Holding the switch on an animal pets it (room-add-ons §9). Whatever turns a held switch
        // into a verb (input_longpress.js) publishes this; a press on Nimrod is his help instead.
        ctx.bus?.subscribe?.('room/hold', () => scene?.hold());
        // Your AI at the window (row 2.37 item 4): { text, label?, src?, ms? }. The setting decides.
        ctx.bus?.subscribe?.('room/visit', (p) => { scene?.visit(p && typeof p === 'object' ? p : { text: String(p || '') }); });
        // Objects react alongside the on-screen cue, never instead of it.
        ctx.bus?.subscribe?.(LISTENING_TOPIC, (p) => {
          if (!scene) return;
          if (p && p.on) scene.notify('wake', { ms: Number(p.ms) > 0 ? Math.min(30000, Number(p.ms) + 2000) : undefined });
          else scene.clearReactions();
        });
        ctx.bus?.subscribe?.('room/notify', (p) => {
          const event = typeof p === 'string' ? p : p?.event;
          if (!scene || !event) return;
          scene.notify(event, Number(p?.ms) > 0 ? { ms: Number(p.ms) } : {});
          // The cue ALWAYS comes too — even when no object in this room reacts to it.
          if (!p?.cueShown) {
            const known = ['wake', 'message', 'call', 'visitor', 'timer'].includes(event);
            const text = typeof p?.text === 'string' && p.text.trim() ? p.text.trim()
              : cueFor(known ? event : { on: 'custom', name: event });
            scene.toast(text, Number(p?.ms) > 0 ? Math.min(30000, Number(p.ms)) : undefined);
          }
        });
      },
      onResize() { scene?.fit(); },
      // Parked while covered, like `scene`: nothing moves behind something else. Coming back is instant.
      onHide() { scene?.setOptions({ motion: 'still' }); },
      onShow() { scene?.setOptions({ motion: cfg.motion }); },
      destroy() {
        torn = true;
        while (offs.length) { try { offs.pop()(); } catch { /* gone */ } }
        closeEditor();
        help?.destroy();
        help = null;
        scene?.destroy();
        scene = null;
        mount.innerHTML = '';
        host = null;
      },
    };
  },
);
