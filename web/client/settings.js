// settings.js — the UNIVERSAL SETTINGS MENU: the shell, and nothing else yet.
//
// One menu, referenced by every surface, rather than the per-module menus that Cici grew
// and then could not keep coherent (word game "players", vision probe "subject", press its
// own thing, five hand-rolled stylesheets). This slice builds the SHELL: it opens, it can
// be driven, it can be left. What a module contributes to it comes next.
//
// FOUR DECISIONS ARE BAKED IN HERE, and each one is the answer to a way this could fail.
//
// 1. THE MENU OWNS ITS NAVIGATION, and takes drive from whoever has it.
//    The obvious build is to hang this off the verb router. It is also wrong: the router
//    and the whole input bus live inside `inputs.js`, which is a HOME-side panel. The
//    KIOSK — the surface at the bedside, the one that matters — has no input bus at all
//    and is driven by its own keydown handler. A menu that needed the router would work
//    where nobody needs it and be absent where somebody does. So the shell exposes plain
//    imperative moves (`next` / `prev` / `select` / `back`), the kiosk calls them from its
//    key handler, and a host that DOES have a bus calls `attachBus()` to get the same
//    moves from `verb/*`. The day the input bus reaches the kiosk, this menu is already
//    switch-operable with no rewrite.
//
// 2. THE SHELL RENDERS EVERY CONTROL. Modules will declare their settings as DATA (slice
//    2), not as DOM they render themselves. This is not tidiness. If a module hands over
//    its own markup, the shell does not know what the controls ARE, so it cannot move a
//    cursor through them, so the menu is unreachable by anyone driving with one switch —
//    who is exactly the person this product exists for. Declared settings are the only
//    version where `next` and `select` can walk the menu. A `custom` slot stays available
//    for the two or three things a schema genuinely cannot express (the binder itself, a
//    camera preview), and those are moderator-only anyway.
//
// 3. THE CURSOR WRAPS. With one switch you can only travel one way; a list with ends is a
//    list with dead ends. Same rule the verb router already follows for focus.
//
// 4. IT IS MODERATOR-GATED BY DEFAULT, NOT BY LAW. `gated:false` turns it off. Default on,
//    because a settings menu one press away from someone who navigates by scanning is a
//    settings menu that gets opened by accident all day.
//
// WHAT IS DELIBERATELY NOT HERE: module settings (slice 2), the default key binding
// (slice 3, `S` — `M` and `F` are already taken by the kiosk's mirror and fullscreen).
// The person PICKER is not here either: a screen implies its person, so at the bedside
// there is nothing to pick and the menu states who it is for. The picker belongs on the
// home side, where a moderator chooses; `extras` is how that host adds it.

import { VERBS, verbTopic } from './actions.js';

export const MENU_VERB = 'menu';
export const MENU_TOPIC = verbTopic(MENU_VERB);

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------
// PURE: the cursor.
//
// Separated from the DOM on purpose — the navigation rules (wrapping, skipping headings,
// skipping anything disabled) are the part that has to be RIGHT for a person with one
// switch, and they are testable without rendering anything.
// ---------------------------------------------------------------------------------
export function createNav(items = []) {
  // Only real, enabled items are stops. A heading is a signpost, and stopping on one
  // costs a press and gives nothing back.
  const stops = [];
  (items || []).forEach((it, n) => {
    if (it && it.kind === 'item' && !it.disabled) stops.push(n);
  });
  let at = 0;

  const cur = () => (stops.length ? items[stops[at]] : null);

  return {
    stops: () => stops.slice(),
    count: () => stops.length,
    index: () => (stops.length ? stops[at] : -1),
    current: cur,
    setIndex(n) {
      const p = stops.indexOf(n);
      if (p >= 0) at = p;
      return cur();
    },
    // Wraps, both ways. See decision 3.
    next() { if (!stops.length) return null; at = (at + 1) % stops.length; return cur(); },
    prev() { if (!stops.length) return null; at = (at - 1 + stops.length) % stops.length; return cur(); },
  };
}

// ---------------------------------------------------------------------------------
// PURE: what the menu contains, given the situation.
//
// A plain data list so the shape can be asserted in a test without a browser, and so the
// module settings that arrive in slice 2 splice in rather than requiring a rewrite.
// ---------------------------------------------------------------------------------
export function buildItems({
  person = null,
  subject = null,
  extras = [],
  canFullscreen = false,
  isFullscreen = false,
} = {}) {
  const out = [];

  // WHO. Stated, never picked, on a surface where a screen already implies its person.
  // Rendering "…" rather than hiding the line keeps the menu the same height while the
  // person loads, so the cursor does not jump under someone mid-press.
  out.push({ kind: 'heading', id: 'who', label: `Setting up for ${person?.name || '…'}` });

  // THE SUBJECT. With nine panels on a screen, "settings" is ambiguous — the same problem
  // the verb vocabulary hit, with the same answer: the focused panel. Naming it here is
  // what makes the menu honest about which panel it is about to change.
  out.push({
    kind: 'heading',
    id: 'subject',
    label: subject ? `This panel — ${subject.title || subject.type}` : 'No panel selected',
  });
  out.push({
    kind: 'item',
    id: 'panel-settings',
    label: subject ? `Settings for ${subject.title || subject.type}` : 'Settings for this panel',
    hint: 'arriving next',
    disabled: true,
  });

  // Whatever the host has that this shell should not know about — the person picker on
  // home, "Set up controls", anything later.
  for (const e of extras || []) {
    if (e && e.kind) out.push(e);
    else if (e) out.push({ kind: 'item', ...e });
  }

  out.push({ kind: 'heading', id: 'screen', label: 'Screen' });
  if (canFullscreen) {
    out.push({
      kind: 'item',
      id: 'fullscreen',
      label: isFullscreen ? 'Leave full screen' : 'Full screen',
    });
  }
  // ALWAYS a Home button. Non-negotiable: it is the way out of anywhere, and the person
  // who needs it most is the one who cannot find any other way back.
  out.push({ kind: 'item', id: 'home', label: 'Home' });
  out.push({ kind: 'item', id: 'close', label: 'Close menu' });

  return out;
}

// ---------------------------------------------------------------------------------
// The shell.
// ---------------------------------------------------------------------------------
// A PAGE is the `custom` escape hatch slice 1 promised: the two or three things a
// declarative schema genuinely cannot express. It renders its own DOM, it always has a way
// back, and `back` means "return to the list" rather than "close" while one is open - which
// is what anybody who has ever used a menu expects.
//
// Deliberately NOT a stack. One level is enough for everything in front of us, and a menu
// somebody can get lost three levels down is a menu that fails the person it is for.
export function mountSettings(root, {
  person = () => null,
  subject = () => null,
  extras = () => [],
  pages = {},                  // { id: { title, render(el) } }
  onHome = null,
  onSelect = null,             // told about every activation — the host wires the effects
  gated = true,
  isModerator = () => true,
  onRefused = null,
  fullscreenTarget = null,     // an element, or null for "this surface cannot go fullscreen"
  documentRef = (typeof document !== 'undefined' ? document : null),
} = {}) {
  if (!root) throw new Error('mountSettings: a root element is required');
  const doc = documentRef;

  let open = false;
  let page = null;             // the open page's id, or null for the list
  let items = [];
  let nav = createNav([]);
  let returnFocus = null;
  const busOffs = [];
  let router = null;

  root.innerHTML = `
    <div class="st-scrim" data-scrim hidden>
      <div class="st-panel" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1" data-panel>
        <div class="st-list" data-list></div>
        <div class="st-page" data-page hidden></div>
      </div>
    </div>`;
  const scrim = root.querySelector('[data-scrim]');
  const panel = root.querySelector('[data-panel]');
  const listEl = root.querySelector('[data-list]');
  const pageEl = root.querySelector('[data-page]');

  const isFullscreen = () => !!(doc && doc.fullscreenElement);

  function render() {
    items = buildItems({
      person: person(),
      subject: subject(),
      extras: extras(),
      canFullscreen: !!fullscreenTarget,
      isFullscreen: isFullscreen(),
    });
    const keep = nav.current()?.id;
    nav = createNav(items);
    // Rebuilding must not throw the cursor back to the top under somebody's hand: if the
    // item they were on still exists, stay on it.
    if (keep) {
      const n = items.findIndex((it) => it.id === keep && it.kind === 'item' && !it.disabled);
      if (n >= 0) nav.setIndex(n);
    }
    paint();
  }

  function paint() {
    const at = nav.index();
    listEl.innerHTML = items.map((it, n) => {
      if (it.kind === 'heading') return `<div class="st-head">${esc(it.label)}</div>`;
      const on = n === at;
      const dis = it.disabled ? ' disabled' : '';
      return `<button class="st-item${on ? ' on' : ''}" data-n="${n}" type="button"${dis}
        aria-current="${on ? 'true' : 'false'}">
        <span class="st-label">${esc(it.label)}</span>
        ${it.hint ? `<span class="st-hint">${esc(it.hint)}</span>` : ''}
      </button>`;
    }).join('');
    // The cursor must be visible without scrolling to it — someone driving with a switch
    // cannot scroll, and a highlighted row below the fold is the same as no highlight.
    listEl.querySelector('.st-item.on')?.scrollIntoView({ block: 'nearest' });
  }

  // --- the four moves. Everything else in the file exists to serve these. ---
  // While a page is open the only control is Back, so moving does nothing rather than
  // scrolling a cursor nobody can see.
  function next() { if (!open || page) return null; const it = nav.next(); paint(); return it; }
  function prev() { if (!open || page) return null; const it = nav.prev(); paint(); return it; }

  function activate(item) {
    if (!item || item.disabled) return null;
    if (item.page) { openPage(item.page); return item; }
    if (item.id === 'close') { close(); return item; }
    if (item.id === 'home') {
      close();
      if (onHome) onHome();
      else if (typeof location !== 'undefined') location.href = './home.html';
      return item;
    }
    if (item.id === 'fullscreen') {
      try {
        if (isFullscreen()) doc.exitFullscreen?.();
        else fullscreenTarget?.requestFullscreen?.();
      } catch { /* a browser that refuses is not an error worth showing here */ }
      // The fullscreen change is async; repaint when it lands so the label is truthful.
      setTimeout(render, 0);
      return item;
    }
    if (typeof item.run === 'function') item.run();
    onSelect?.(item);
    return item;
  }

  function select() {
    if (!open) return null;
    if (page) { closePage(); return { id: 'page-back' }; }
    return activate(nav.current());
  }

  // BACK LEAVES THE PAGE BEFORE IT LEAVES THE MENU. Closing the whole thing from inside a
  // page would throw away where somebody was, and for a person navigating by scanning,
  // getting back to a place costs real presses.
  function back() {
    if (!open) return;
    if (page) { closePage(); return; }
    close();
  }

  function openPage(id) {
    const def = pages[id];
    if (!def) return null;
    page = id;
    listEl.hidden = true;
    pageEl.hidden = false;
    pageEl.innerHTML = `<div class="st-head">${esc(def.title || id)}</div>
      <div data-page-body></div>
      <button class="st-item on" type="button" data-page-back>
        <span class="st-label">Back</span></button>`;
    try { def.render(pageEl.querySelector('[data-page-body]')); }
    catch (err) {
      // A page that throws must not strand somebody inside a broken screen with no Back.
      pageEl.querySelector('[data-page-body]').textContent = String(err.message || err);
    }
    panel.focus?.();
    return id;
  }

  function closePage() {
    page = null;
    pageEl.hidden = true;
    pageEl.innerHTML = '';
    listEl.hidden = false;
    paint();
  }

  function show() {
    if (open) return true;
    // The gate. Refusing SILENTLY would look like a broken switch, so the host is told.
    if (gated && !isModerator()) { onRefused?.({ reason: 'moderator-only' }); return false; }
    open = true;
    returnFocus = doc?.activeElement || null;
    render();
    scrim.hidden = false;
    router?.setPaused?.(true);
    panel.focus?.();
    return true;
  }

  function close() {
    if (!open) return;
    if (page) closePage();
    open = false;
    scrim.hidden = true;
    router?.setPaused?.(false);
    // Put keyboard focus back where it was, or the next Tab starts from the top of the
    // document and a sighted keyboard user is lost.
    try { returnFocus?.focus?.(); } catch { /* it may have been unmounted */ }
    returnFocus = null;
  }

  function toggle() { return open ? (close(), false) : show(); }

  // --- mouse. Clicking is still how most caregivers will use this. ---
  const listeners = new AbortController();
  const sig = { signal: listeners.signal };

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.st-item');
    if (!btn || btn.disabled) return;
    const n = Number(btn.dataset.n);
    nav.setIndex(n);
    paint();
    activate(items[n]);
  }, sig);

  // Clicking the scrim closes. A menu you cannot dismiss by clicking away reads as a
  // crash to anyone who did not mean to open it.
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); }, sig);

  pageEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-page-back]')) closePage();
  }, sig);

  // --- keyboard. ONLY the keys nothing else owns. ---
  //
  // Arrows and Enter are deliberately NOT handled here. Where an input bus exists they are
  // already bound to verb/next, verb/prev and verb/select, and handling them here too
  // would move the cursor twice per press. The kiosk, which has no bus, calls next()/
  // prev()/select() from its own key handler instead. Two paths, never both at once.
  panel.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    // The focus trap. Tab must not walk out of an open modal onto the page behind it.
    const focusable = [...panel.querySelectorAll('button:not([disabled])')];
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = doc.activeElement;
    if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }, sig);

  // --- optional: drive from a verb bus, where one exists. ---
  //
  // `router` is paused while the menu is open so a press does not ALSO reach the panel
  // behind it — pressing "next" in the menu must not advance her photos underneath.
  function attachBus(bus, verbRouter = null) {
    if (!bus) return () => {};
    router = verbRouter || router;
    const off = [
      bus.subscribe(verbTopic('menu'), () => toggle()),
      bus.subscribe(verbTopic('next'), () => { if (open) next(); }),
      bus.subscribe(verbTopic('prev'), () => { if (open) prev(); }),
      bus.subscribe(verbTopic('select'), () => { if (open) select(); }),
      bus.subscribe(verbTopic('back'), () => { if (open) back(); }),
    ];
    busOffs.push(...off);
    return () => off.forEach((fn) => fn());
  }

  return {
    open: show,
    close,
    toggle,
    isOpen: () => open,
    next, prev, select, back,
    refresh: render,
    openPage,
    closePage,
    page: () => page,
    items: () => items.map((it) => ({ ...it })),
    focusIndex: () => nav.index(),
    focusId: () => nav.current()?.id || null,
    attachBus,
    destroy() {
      close();
      listeners.abort();
      busOffs.forEach((fn) => { try { fn(); } catch { /* already gone */ } });
      busOffs.length = 0;
      root.innerHTML = '';
    },
  };
}

// Exported so a host can assert it wired every verb the menu understands.
export const MENU_VERBS = ['menu', 'next', 'prev', 'select', 'back'];
export const ALL_VERB_IDS = VERBS.map((v) => v.id);
