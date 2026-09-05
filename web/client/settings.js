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
// 2. THE SHELL RENDERS EVERY CONTROL. Modules declare their settings as DATA (see
//    `settings_fields.js`), not as DOM they render themselves. This is not tidiness. If a
//    module hands over
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
// WHAT IS DELIBERATELY NOT HERE: the default key binding (slice 3, `S` — `M` and `F` are
// already taken by the kiosk's mirror and fullscreen). Module settings ARRIVED in slice 2 and
// live in `settings_fields.js`, which is pure and knows nothing about this shell: it turns a
// declaration into an ordinary `{ kind:'item', label, hint, run }`, which is exactly what
// `extras` already produced, so the cursor walks them with no special case here.
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
  // The focused panel's own settings, already built into items by `fieldItems`. They arrive
  // as ITEMS rather than as declarations so this file never has to learn what a field is -
  // the rules that matter for one button (wrapping, stepping, what is not cycleable) are
  // pure and live next door, where they can be hammered without a browser.
  fields = [],
  canFullscreen = false,
  isFullscreen = false,
  // See the Home row below. Default true, because "there should be SOME way out" is the
  // default that survived F18's correction.
  includeHome = true,
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
  if (subject && fields.length) {
    out.push(...fields);
  } else if (subject) {
    // A PANEL WITH NOTHING TO CHANGE STILL GETS A ROW. Dropping it would leave the heading
    // naming a panel and then nothing underneath, which reads as a menu that failed to load;
    // the sentence is short and it is the truth.
    out.push({
      kind: 'item',
      id: 'panel-settings',
      label: `Nothing to change in ${subject.title || subject.type}`,
      disabled: true,
    });
  }
  // With no subject the heading above already says "No panel selected", and repeating it
  // costs a row on a screen where rows are presses.

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
  // A Home button, here, by default.
  //
  // *** THIS WAS WRITTEN AS AN ABSOLUTE AND IT WAS NOT MIKE'S. *** The previous comment said
  // the way out is "never hidden, at any complexity level, by any host", and called itself
  // the one rule in the project allowed to be absolute. Nobody signed that off: it was put
  // here by a Claude in 28861e4, it is not in `PRINCIPLES.md`, and only Mike declares an
  // absolute. Corrected 2026-09-03 when he read it back: *"I don't know if I said to write
  // that. Home shouldn't always be visible."*
  //
  // WHAT HE ACTUALLY WANTS, and it is a better design than the rule was: Home is a
  // DESTINATION, not a fixture. The site is itself a module, so "home" is going to the home
  // module — which means a kiosk could put it in a corner panel, or on the coming global
  // transport bar (the one that selects which module it is driving, or the audio player, or
  // the kiosk), or leave it here in the menu, or several of those at once. Where it lives
  // becomes a setting.
  //
  // WHAT SURVIVES THE CORRECTION IS SMALLER AND IS A DEFAULT, NOT A RULE: there should be
  // SOME way out, and the person who needs one most is the one who cannot find another way
  // back — so this menu offers one unless a host has deliberately put it somewhere else.
  // "Reachable" was the thing worth protecting; "always visible on this screen" was the
  // overreach, and it is the difference Mike drew himself.
  // ...and `includeHome` is how a host says it HAS put one somewhere else, which is exactly
  // the case F18 left room for. A module opening this menu about ITSELF passes false: from
  // inside one panel of a screen, "Home" would mean navigating the whole kiosk away, which is
  // not that panel's to offer and is already on the shell's own menu. A row that cannot
  // honestly do what it says is worse than an absent one.
  if (includeHome) out.push({ kind: 'item', id: 'home', label: 'Home' });
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
// One level, not a stack - and that is a PREFERENCE, not a law. The argument for it is
// real: a menu somebody can get lost three levels down fails the person it is for, and
// every page in front of us today fits. The argument against it has not been hunted yet -
// per-module settings that themselves contain a list (pick a source, then pick an album
// inside it) are the obvious shape that would want depth. Revisit when one turns up rather
// than bending a page into a shape it does not fit.
export function mountSettings(root, {
  person = () => null,
  subject = () => null,
  extras = () => [],
  // Read at every paint, never cached. A field row shows its CURRENT value, so a snapshot
  // taken at mount time would show yesterday's number to somebody standing at the screen.
  fields = () => [],
  pages = {},                  // { id: { title, render(el) } }
  onHome = null,
  onSelect = null,             // told about every activation — the host wires the effects
  // *** TOLD WHENEVER THE MENU CLOSES, however it closed. ***
  //
  // `onSelect` cannot serve this: `activate` handles `close` and returns BEFORE calling it,
  // and the menu can also be closed by Escape, by the `back` verb, or by clicking the scrim.
  // A host that needs to know has four paths to miss and no way to catch three of them.
  //
  // It exists because a MODULE can now open this menu about itself. When a game opens to its
  // own settings, closing the menu IS starting the game — and without this the panel would
  // sit there with the menu gone and the game not begun, which is a dead rectangle somebody
  // has to guess their way out of.
  onClose = null,
  gated = true,
  isModerator = () => true,
  onRefused = null,
  fullscreenTarget = null,     // an element, or null for "this surface cannot go fullscreen"
  // *** WHERE THE MENU IS ALLOWED TO REACH. ***
  //
  // The default is the whole viewport, which is right for the SHELL's menu — it is the one a
  // person opens about the screen, and it is meant to take the screen over while it is up.
  //
  // `inline` scopes it to whatever it was mounted into. That exists because a MODULE can now
  // open this menu about itself, and a module that covered the entire display to ask about
  // its own settings would be a panel reaching outside its own box — the one thing the module
  // contract forbids. On a grid kiosk a game asking about itself must darken its own quarter
  // and nothing else, or setting up Wait-and-Go would blank out the photographs next to it.
  //
  // It is a positioning choice and nothing else: the same markup, the same one-switch cursor,
  // the same rows. Nothing about what the menu CAN do changes with it.
  inline = false,
  includeHome = true,
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
    <div class="st-scrim${inline ? ' st-inline' : ''}" data-scrim hidden>
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
      // A module that throws while the menu is opening must not take the menu with it - the
      // menu is the tool for repairing the broken thing.
      // ...and it SAYS SO on the console rather than swallowing it. A menu that silently
      // shows no settings for a panel that has some is indistinguishable from a panel that
      // declares none, which is a bug nobody can find.
      fields: (() => { try { return fields() || []; }
        catch (err) { console.warn('settings: fields() threw', err); return []; } })(),
      canFullscreen: !!fullscreenTarget,
      includeHome,
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
    // REPAINT AFTER EVERY ACTIVATION. A field row's whole job is to show what it is set to,
    // and stepping it without redrawing leaves the old value on screen - which from a switch
    // reads as the press having been dropped, and the repair for that looks like a hardware
    // fault. `render()` keeps the cursor on the row it was on, so nothing moves under a hand.
    if (open && !page) render();
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
    // Last, and never allowed to throw the close: a host that fails while reacting must not
    // leave the menu half-closed, which is the one state nothing can recover from.
    try { onClose?.(); } catch (err) { console.error('settings: onClose', err); }
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
