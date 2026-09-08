// Educational — the GENERATED learning provider (alphabet / counting / vocab).
//
// This is the nimrod_95 interstitials generated flow re-homed as its own module and
// reworked from the retired 2×2 layout to a SINGLE in-stage graphic (no camera, no
// presenter quadrant — the self-view camera is its own module now). Content-as-
// meaning (DECISIONS.md): an item is SEMANTIC DATA, never pre-rendered —
//   { kind, graphic:{type,value}, speak }
// The renderer draws the graphic LIVE in the profile's theme (it uses the CSS
// variables the shell set on :root, so it themes for FREE) and speaks the line via
// the profile's VOICE (voice.js `speak()`), so changing theme or voice re-renders /
// re-speaks every segment with no re-authoring.
//
// Same spine as the other providers: content library -> shared picker (rng.js, with
// `kind` as the diversity axis so you don't get three counting items in a row) ->
// render + speak -> append-only play event (stats derive from the log).
//
// DIRECTOR-READY like youtube/personal. A generated item has no natural "ended", so
// it ends on a DISPLAY TIMER: after the item's `displaySec`, it fires
// `segment/done{provider:'educational'}` — the seam the content director advances on.
// Standalone it also auto-advances. A `directed` instance (seeded by the container)
// does NOT autostart; the director drives every activation via `educational/next`.
//
// INJECTION SEAMS for deterministic tests (no audio, controllable time):
//   * ctx.speak(text, voicePref)        overrides voice.js speak() — a test records calls
//   * ctx.setTimer / ctx.clearTimer     override the display timer — a test steps it
// The container forwards its own injected speak/timers to this child, so the
// director's tests stay deterministic.

import { registerModule } from '../module.js';
import { readWithLegacy } from '../settings_fields.js';
import { createState } from '../state.js';
import { pick, statsFromEvents } from '../rng.js';
import { speak as speakDefault, cancel as cancelSpeak } from '../voice.js';

// The library is per-PROFILE data, so two people on one account get different segments.
// It has always been readable from `state.items` as objects; `state.itemsText` adds the
// same editable LINE FORMAT the other content modules use, so a person can edit their
// library as text instead of hand-writing JSON:
//
//     kind | graphicType:value | the line to speak
//     counting | number:3   | Three. One, two, three.
//     alphabet | letters:A  | A. A is for apple.
//     vocab    | word:cup   | Cup. This is a cup.
//
// `id` is derived from the kind and value, so lines need no bookkeeping. `items`
// (objects) still wins when present; text is the convenience, not a second source of
// truth. Blank lines and `#` comments are ignored.
export function parseItems(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const parts = l.split('|').map((x) => x.trim());
    if (parts.length < 3) continue;
    const [kind, graphic, speak] = parts;
    const i = graphic.indexOf(':');
    if (i < 0 || !kind || !speak) continue;
    const type = graphic.slice(0, i).trim();
    const value = graphic.slice(i + 1).trim();
    if (!type || !value) continue;
    out.push({
      id: `${kind}-${value}`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
      kind,
      graphic: { type, value: type === 'number' ? Number(value) : value },
      speak,
      enabled: true,
    });
  }
  return out;
}

// A small default library so a fresh instance shows something immediately. Data only
// — the meaning, not pixels. Editable/extendable later via the module's state / a
// future content-library editor.
export const DEFAULT_ITEMS = [
  { id: 'count-1', kind: 'counting', graphic: { type: 'number', value: 1 }, speak: 'One.', enabled: true },
  { id: 'count-3', kind: 'counting', graphic: { type: 'number', value: 3 }, speak: 'Three. One, two, three.', enabled: true },
  { id: 'count-5', kind: 'counting', graphic: { type: 'number', value: 5 }, speak: 'Five. Count with me: one, two, three, four, five.', enabled: true },
  { id: 'letter-a', kind: 'alphabet', graphic: { type: 'letters', value: 'A' }, speak: 'A. A is for apple.', enabled: true },
  { id: 'letter-b', kind: 'alphabet', graphic: { type: 'letters', value: 'B' }, speak: 'B. B is for ball.', enabled: true },
  { id: 'word-cup', kind: 'vocab', graphic: { type: 'word', value: 'cup' }, speak: 'Cup. This is a cup.', enabled: true },
  { id: 'word-dog', kind: 'vocab', graphic: { type: 'word', value: 'dog' }, speak: 'Dog. The dog says woof.', enabled: true },
];

// `displayMs` is milliseconds - the house rule for every stored duration (settings_fields.js).
// It was `displaySec`; the KEY changed rather than the meaning of the old one, so a value
// nobody migrated reads as absent instead of as eight milliseconds. Same for the PER-ITEM
// override, which lives inside saved content rather than in settings and therefore needs the
// same fallback one level down.
const DEFAULTS = { items: null, displayMs: 8000, autoAdvance: true, directed: false };

// ---------------------------------------------------------------------------------------
// *** IT DECLARED NO SETTINGS AT ALL, AND IT HAS FOUR. ***
// ---------------------------------------------------------------------------------------
//
// `displayMs`, `autoAdvance` and `directed` have always been read from state and there has never
// been a menu that could set any of them -- the same gap `pressgame`'s last three rows turned out
// to be, and the same one F4 named: live config that no surface can reach. Somebody could change
// how long a word stays on screen only by editing storage.
//
// *** WHAT IS NOT HERE, AND WHY IT IS NOT A ROW I CAN INVENT. ***
//
// Chat, from Mike testing the live site: Educational *"counted to five for somebody who can count
// to a hundred, and the level is unsettable."* That is the real complaint and this does not fix
// it. A level dial needs BANDED CONTENT to select between, and the seven built-in items are one
// band -- so a "level" row would be a control with one position, which is worse than none because
// it claims the problem is solved. The answer is the shared content source chat keeps arriving at
// from every direction ("give it a topic or a source, get back vocabulary, questions and lesson
// material at a set difficulty"), and that is architecture, not a settings row. Recorded rather
// than papered over with a dial that does nothing.
const SETTINGS = [
  // ESSENTIAL. How long a word stays on screen is the whole reading experience for somebody who
  // needs longer than eight seconds, and they cannot tell you that it is going too fast.
  { key: 'displayMs', label: 'How long each one stays', kind: 'choice', default: 8000,
    level: 'essential',
    options: [
      { value: 5000,  label: '5 seconds' },
      { value: 8000,  label: '8 seconds' },
      { value: 15000, label: '15 seconds' },
      { value: 30000, label: '30 seconds' },
      { value: 60000, label: 'A minute' },
    ] },
  // ESSENTIAL for the same reason and in the same direction: turning it off means the screen
  // waits for a person instead of moving on without them.
  { key: 'autoAdvance', label: 'Move on by itself', default: true, level: 'essential',
    onLabel: 'Yes — after the time above', offLabel: 'No — wait to be moved on',
    note: 'Turn this off for somebody who is being shown these by a person.' },
  { key: 'directed', label: 'Somebody else is driving', default: false, level: 'advanced',
    onLabel: 'Yes — a person or a rule chooses what shows', offLabel: 'No — it picks its own' },
];
const LEGACY_DISPLAY = { key: 'displaySec', scale: 1000 };
const RECENT_CAP = 8;

// The live graphic, drawn from the VALUE (semantic data), styled by the theme's CSS
// vars. Pure + exported so it can be unit-tested without mounting the module.
export function graphicHTML(g) {
  if (!g || g.type === 'none') return '';
  if (g.type === 'number') {
    const n = Math.max(0, Math.min(20, Number(g.value) || 0));
    const dots = n > 0 && n <= 10 ? `<div class="ig-dots">${'<i></i>'.repeat(n)}</div>` : '';
    return `<div class="ig-number" data-value="${n}">${n}</div>${dots}`;
  }
  if (g.type === 'letters') {
    return `<div class="ig-letters">${String(g.value ?? '').toUpperCase()}</div>`;
  }
  if (g.type === 'word') {
    // *** SHOWN ONCE, NOT TWICE. *** This used to also render a letter-spelled version above
    // the word -- the exact treatment `type: 'letters'` already exists for (see the alphabet
    // entries above, e.g. `letter-a`). A vocab word ('cup', 'dog') doesn't need that; showing
    // both read as the same word in two different fonts, which is what it was.
    const w = String(g.value ?? '');
    return `<div class="ig-word"><div class="ig-wordfull">${w}</div></div>`;
  }
  return '';
}

registerModule(
    // `server`, MEASURED 2026-09-05 with every handle rejecting: it renders "‹ Learning ›" and an
    // empty stage. That is A9 ("Educational is blank") seen from the other side - the frame is
    // local, every piece of content is not.
  { type: 'educational', title: 'Educational',
    dependsOn: 'server', description: 'Gentle alphabet, counting and vocabulary, spoken aloud',
    settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events, user, profileId } = ctx;
    const speak = ctx.speak || speakDefault;                       // injectable (no audio in tests)
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));

    let cfg = { ...DEFAULTS };
    let items = [], ids = [], byId = {}, kinds = {};
    let stats = {};
    let recent = [], history = [], histPos = -1;
    let currentId = null;
    let endTimer = null;
    let voicePref = {};                                            // from the profile's settings blob
    let settings = null;

    function indexItems() {
      const fromText = (!Array.isArray(cfg.items) || !cfg.items.length) && cfg.itemsText
        ? parseItems(cfg.itemsText) : null;
      const raw = Array.isArray(cfg.items) && cfg.items.length ? cfg.items
        : (fromText && fromText.length ? fromText : DEFAULT_ITEMS);
      const list = raw.filter((it) => it && it.id && it.enabled !== false);
      items = list;
      ids = list.map((it) => it.id);
      byId = Object.fromEntries(list.map((it) => [it.id, it]));
      kinds = Object.fromEntries(list.map((it) => [it.id, it.kind || it.id]));   // kind = diversity axis
    }

    function clearEnd() { if (endTimer != null) { clearTimer(endTimer); endTimer = null; } }

    // A generated segment ends on its display timer -> segment/done (the director's
    // seam); standalone it also self-advances.
    function scheduleEnd(item) {
      clearEnd();
      const perItem = readWithLegacy(item, 'displayMs', LEGACY_DISPLAY);
      const ms = Math.max(2000,
        Number(perItem) || Number(cfg.displayMs) || DEFAULTS.displayMs);
      endTimer = setTimer(() => {
        endTimer = null;
        bus.publish('segment/done', { provider: 'educational', reason: 'ended' });
        if (cfg.autoAdvance) bus.publish('educational/next');
      }, ms);
    }

    function render(item) {
      const st = mount.querySelector('[data-stage]');
      if (st) st.innerHTML = graphicHTML(item.graphic);
      const cap = mount.querySelector('[data-name]');
      if (cap) cap.textContent = item.caption || '';
    }

    function show(id, record = true) {
      const item = byId[id];
      if (!item) return;
      currentId = id;
      render(item);
      if (item.speak) { try { speak(item.speak, voicePref); } catch (e) { console.error('educational: speak', e); } }
      if (record) {
        recent.push(id);
        if (recent.length > RECENT_CAP) recent.shift();
        history = history.slice(0, histPos + 1);
        history.push(id); histPos = history.length - 1;
        events.append('play', { id, at: Date.now() }).catch((e) => console.error('educational: play log', e));
      }
      scheduleEnd(item);
    }

    function advance() {
      if (!ids.length) { bus.publish('segment/done', { provider: 'educational', reason: 'empty' }); return; }
      const id = pick(ids, stats, { now: Date.now(), rand: Math.random, recent, channels: kinds });
      if (id) show(id, true);
    }

    function prev() { if (histPos > 0) { histPos -= 1; show(history[histPos], false); } }
    function skip() { try { cancelSpeak(); } catch { /* noop */ } clearEnd(); advance(); }

    // Read a settings row and act on it. Extracted from the state subscription so `init` can
    // call it too — see the note at the call site.
    function applyState(s) {
      cfg = { ...DEFAULTS, ...s };
      // The migration, for a module that has no declared settings yet.
      const ms = readWithLegacy(s || {}, 'displayMs', LEGACY_DISPLAY);
      if (ms !== undefined) cfg.displayMs = Number(ms);
      indexItems();
      if (!ids.length) return;
      if (!cfg.directed && (!currentId || !byId[currentId])) advance();   // standalone autostart
    }

    function deriveStats(cache) {
      const plays = (cache.events || [])
        .filter((e) => e.kind === 'play')
        .map((e) => ({ id: e.data?.id, at: e.data?.at || Date.parse(e.created_at) || 0 }));
      return statsFromEvents(plays, { idKey: 'id', atKey: 'at' });
    }

    return {
      init() {
        mount.innerHTML = `
          <div class="educational">
            <div class="stage" data-stage></div>
            <div class="caption" data-name></div>
            <div class="nav">
              <button class="pbtn" data-prev aria-label="previous">‹</button>
              <span class="source-label">Learning</span>
              <button class="pbtn" data-next aria-label="next">›</button>
            </div>
          </div>`;

        bus.subscribe('educational/next', () => advance());
        bus.subscribe('educational/prev', () => prev());
        bus.subscribe('educational/skip', () => skip());

        const nav = bus.createSource('educational-nav');
        bus.addBinding({ source: 'educational-nav', signal: 'next', topic: 'educational/next' });
        bus.addBinding({ source: 'educational-nav', signal: 'prev', topic: 'educational/prev' });
        mount.querySelector('[data-next]').addEventListener('click', () => nav.emit('next'));
        mount.querySelector('[data-prev]').addEventListener('click', () => nav.emit('prev'));

        events.subscribe((cache) => { stats = deriveStats(cache); });

        // read the profile's VOICE from its settings blob (self-contained; same pattern
        // the nimrod_95 module used — formalize via ctx when it's worth it).
        settings = createState({ url: `/api/profiles/${profileId}/state/settings`, user });
        settings.subscribe((s) => { voicePref = (s && s.voice) || {}; });
        settings.load().then(() => settings.startPolling()).catch(() => {});

        state.subscribe(applyState);
        // *** AND ONCE, DIRECTLY, BECAUSE A SUBSCRIPTION IS NOT A GUARANTEE. ***
        //
        // G12: Mike found Educational on the public parts page as *"an empty cream box"* — the
        // previous/next arrows and the "Learning" label drawn around a stage with nothing in
        // it. `module_audit.js` had already recorded the same thing and it had been read as a
        // weak module. It is not: it ships SEVEN default items and shows them perfectly well
        // on a kiosk.
        //
        // The whole difference is WHO LOADED THE STATE. `state.subscribe` replays the current
        // value only `if (loaded)` — so on the kiosk, which awaits `state.load()` before
        // `init()`, the callback fires immediately and the module starts. On a page whose host
        // does not (the parts page, the all-at-once audit), nothing ever fired, `indexItems`
        // never ran, and a module with seven items believed it had none.
        //
        // A module must not depend on its host having pre-loaded anything. `state.get()` is the
        // same data the subscription would have handed over, and a directed child is still safe
        // because the director WRITES `{directed:true}` into that row before mounting, which
        // `set` applies to the local snapshot synchronously — so this reads it even offline.
        applyState(state.get());
      },
      onResize() {},
      onHide() { try { cancelSpeak(); } catch { /* noop */ } state.flush(); },
      destroy() {
        clearEnd();
        try { cancelSpeak(); } catch { /* noop */ }
        if (settings) { settings.destroy(); settings = null; }
      },
    };
  },
);
