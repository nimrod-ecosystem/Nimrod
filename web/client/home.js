// home.js — the HOME SHELL: what a signed-in person sees. A sidebar of TABS over one
// main panel; this file owns the shell and the "Screens" tab, and each other tab is its
// own module (the composer lives in composer.js).
//
// The three surfaces, and why they're separate:
//   landing.html  public. What Nimrod is, and a way in. Signed out only.
//   home.html     THIS. Your profiles: make one, put modules in it, open it.
//   kiosk.html    the running screen. Full-screen, one module at a time, calm.
//
// Home COMPOSES, the kiosk PLAYS. That split is deliberate: the kiosk is a screen that
// may sit in a care facility running unattended for days, so it must not also be a
// management UI. Everything you'd fiddle with lives here instead, and "Open" hands the
// finished profile to the kiosk with `?profile=<id>`.
//
// Before this page existed, signing in redirected to the kiosk — which auto-seeded a
// bedside profile and gave you no way to add anything to it. That is why the games were
// not playable: there was nowhere to put them.
//
// THE PERSON BAR sits above the panel rather than inside any one tab, because the current
// person changes what EVERY tab is showing — Screens lists theirs, Inputs edits theirs,
// Output routes theirs. A picker that lived in one tab would leave the others silently
// addressing somebody else, which is the single worst failure this layer could have.
// Changing person remounts the active panel; see `show()`.

import { mountPeople } from './people.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The modules a person can add, from the registry (whatever was imported). Sorted by
// title so the picker is scannable rather than load-order-dependent.
export function moduleCatalog(manifests) {
  return [...(manifests || [])]
    .filter((m) => m && m.type)
    .sort((a, b) => String(a.title || a.type).localeCompare(String(b.title || b.type)));
}

export function kioskURL(profileId) {
  return `/kiosk.html?profile=${encodeURIComponent(profileId)}`;
}

// The tabs in the sidebar. Adding one means adding a `mount` here — the shell doesn't
// need to know anything else about it. (An "Audio hub" tab belongs here when it exists;
// an empty tab is worse than no tab, so it isn't stubbed.)
export const TABS = [
  { id: 'screens',  label: 'Screens',  hint: 'make and fill your screens' },
  { id: 'media',    label: 'Media',    hint: 'connect the folders your photos live in' },
  { id: 'inputs',   label: 'Inputs',   hint: 'bind switches, controllers and keys to actions' },
  { id: 'output',   label: 'Output',   hint: 'how this screen answers — spoken, on screen, a sound' },
  { id: 'adulting', label: 'Adulting', hint: 'your own points board' },
];

// The shell: sidebar + one mounted panel. `mountTab` is injectable so a test can drive
// the navigation without the real panels.
// `signedIn` decides the sidebar's way in/out. It defaults to "there is an email", which is
// true for a Google session, but it is passed explicitly by home.html — a signed-in account
// with no email on it would otherwise be offered a Sign IN link.
// `makePersonState` / `makePersonEvents` take the person id FIRST: (personId, key, opts).
// The shell curries the current person onto them before handing the panels the
// `makeUserState` / `makeUserEvents` they already expect, so inputs.js and output_panel.js
// needed no changes at all to become per-person.
export async function mountHome(root, { email = '', profiles, manifests = [], onOpen = null,
                                       makeSettings = null, makeState = null, makeEvents = null,
                                       user = null, bus = null, mountTab = null,
                                       makePersonState = null, makePersonEvents = null,
                                       signedIn = null, storage = undefined } = {}) {
  const isSignedIn = signedIn == null ? !!email : !!signedIn;
  let active = 'screens';
  let panel = null;
  let personId = '';

  root.innerHTML = `
    <div class="shell">
      <nav class="s-side">
        <div class="s-brand">Nimrod<span>.</span></div>
        <ul class="s-nav">
          ${TABS.map((t) => `<li><button class="s-navb" data-tab="${t.id}" title="${t.hint}">${t.label}</button></li>`).join('')}
        </ul>
        <div class="s-foot">
          ${email ? `<div class="s-email">${esc(email)}</div>` : ''}
          ${isSignedIn
            ? '<a class="s-signout" href="/auth/logout">Sign out</a>'
            : '<a class="s-signout" href="/auth/login">Sign in</a>'}
        </div>
      </nav>
      <main class="s-main">
        <div data-people></div>
        <div data-panel></div>
      </main>
    </div>`;

  const main = root.querySelector('[data-panel]');

  // Curried onto the current person. A panel that asked for per-person state before a
  // person resolved would address the empty id and 404 every save, so this throws loudly
  // instead of failing quietly at the bedside.
  const forPerson = (make) => (make
    ? (key, opts) => {
        if (!personId) throw new Error('no person selected yet');
        return make(personId, key, opts);
      }
    : null);
  const makeUserState = forPerson(makePersonState);
  const makeUserEvents = forPerson(makePersonEvents);
  const mount = mountTab || (async (id, host) => {
    if (id === 'media') {
      const { mountMedia } = await import('./media.js');
      const m = mountMedia(host, { user });
      await m.refresh();
      return m;
    }
    if (id === 'inputs') {
      const { mountInputs } = await import('./inputs.js');
      const i = mountInputs(host, { profiles, user, makeUserState, personId });
      await i.refresh();
      return i;
    }
    if (id === 'output') {
      const { mountOutput } = await import('./output_panel.js');
      const o = mountOutput(host, { user, makeUserState, makeUserEvents });
      await o.refresh();
      return o;
    }
    if (id === 'adulting') {
      const { mountAdulting } = await import('./adulting.js');
      const a = mountAdulting(host, { profiles, bus, user, makeState, makeEvents });
      await a.refresh();
      return a;
    }
    return mountScreens(host, { profiles, manifests, onOpen, makeSettings, personId });
  });

  async function show(id) {
    active = TABS.some((t) => t.id === id) ? id : 'screens';
    for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === active);
    if (panel && panel.destroy) { try { panel.destroy(); } catch (e) { console.error(e); } }
    main.innerHTML = '';
    panel = await mount(active, main);
  }

  for (const b of root.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => { show(b.dataset.tab); });
  }

  // The bar reports the current person once on mount and again on every change. The first
  // report is what makes `personId` valid before any panel is built, which is why the
  // first `show()` waits for it below rather than racing it.
  const people = mountPeople(root.querySelector('[data-people]'), {
    profiles,
    storage,
    onChange: (person) => {
      personId = (person && person.id) || '';
      if (panel) show(active);      // whoever is on screen is now showing the wrong person
    },
  });
  await people.refresh({ notify: false });
  personId = (people.current() || {}).id || '';

  const api = {
    show,
    active: () => active,
    panel: () => panel,
    people,
    person: () => people.current(),
    destroy() {
      people.destroy();
      if (panel && panel.destroy) panel.destroy();
    },
  };
  await show('screens');
  return api;
}

// The SCREENS tab: create a screen, fill it with modules, open it.
// Scoped to ONE person. `personId` is passed rather than read from anywhere global so a
// test — and, later, a moderator view showing two people side by side — can mount two of
// these at once without them fighting over a shared "current".
export async function mountScreens(root, {
  profiles, manifests = [], onOpen = null, makeSettings = null, personId = '',
} = {}) {
  const catalog = moduleCatalog(manifests);
  // The server stores module instances as {id, type} — no human title. Look the title up
  // from the registry so a chip reads "Quests", not "quests"; fall back to the type for a
  // module this build no longer registers, so an old profile still renders.
  const titleOf = (type) => (catalog.find((m) => m.type === type) || {}).title || type;
  const open = onOpen || ((id) => { location.href = kioskURL(id); });
  let list = [];
  let busy = false;

  root.innerHTML = `
    <div class="home">
      <div class="h-intro">
        <h1>Your screens</h1>
        <p>A <b>screen</b> is a set of modules — photos, a clock, games, the lineup — that you
          open full-screen. Make one for each person or place.</p>
      </div>

      <form class="h-new" data-new>
        <input type="text" data-name placeholder="Name a new screen (e.g. Bedside, Oscar)" aria-label="new screen name" required>
        <button type="submit" class="h-btn h-primary">Create</button>
      </form>

      <div class="h-msg" data-msg></div>
      <div class="h-list" data-list><p class="h-loading">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);
  const listEl = el('[data-list]');
  const msgEl = el('[data-msg]');

  const say = (text, bad = false) => {
    msgEl.textContent = text || '';
    msgEl.classList.toggle('bad', !!bad);
  };

  function card(p) {
    const mods = p.modules || [];
    const chips = mods.length
      ? mods.map((m) => `<span class="h-chip">${esc(m.title || titleOf(m.type))}
          <button class="h-x" data-remove="${esc(p.id)}:${esc(m.id)}" aria-label="remove ${esc(m.type)}">×</button>
        </span>`).join('')
      : `<span class="h-none">No modules yet — add one below.</span>`;
    return `
      <section class="h-card">
        <div class="h-card-head">
          <h2 data-title>${esc(p.name)}</h2>
          <div class="h-actions">
            <button class="h-btn h-quiet" data-rename="${esc(p.id)}">Rename</button>
            <button class="h-btn h-quiet h-danger" data-delete="${esc(p.id)}">Delete</button>
            <button class="h-btn h-primary" data-open="${esc(p.id)}" ${mods.length ? '' : 'disabled'}>Open</button>
          </div>
        </div>
        <div class="h-chips">${chips}</div>
        <div class="h-add">
          <select data-pick="${esc(p.id)}" aria-label="module to add">
            ${catalog.map((m) => `<option value="${esc(m.type)}">${esc(m.title || m.type)}</option>`).join('')}
          </select>
          <button class="h-btn" data-add="${esc(p.id)}">Add module</button>
          ${mods.length ? '' : '<span class="h-hint">a screen needs at least one module to open</span>'}
        </div>
        ${mods.length && makeSettings ? `
        <div class="h-arrange">
          <button class="h-btn h-quiet" data-arrange="${esc(p.id)}" aria-expanded="false">Arrange layout</button>
          <div class="h-arrange-body" data-arrange-body="${esc(p.id)}" hidden></div>
        </div>` : ''}
      </section>`;
  }

  const arrangers = new Map();          // profileId -> mounted composer

  function destroyArrangers() {
    for (const c of arrangers.values()) { try { c.destroy(); } catch (e) { console.error(e); } }
    arrangers.clear();
  }

  async function toggleArrange(btn) {
    const pid = btn.dataset.arrange;
    const body = root.querySelector(`[data-arrange-body="${CSS.escape(pid)}"]`);
    if (!body) return;
    const opening = body.hidden;
    body.hidden = !opening;
    btn.setAttribute('aria-expanded', String(opening));
    btn.textContent = opening ? 'Done arranging' : 'Arrange layout';
    if (!opening) {
      // Closing must land any debounced write before the handle goes away, or the last
      // change made would be the one silently lost.
      const c = arrangers.get(pid);
      if (c) { try { await c.settle(); } catch (e) { console.error(e); } c.destroy(); arrangers.delete(pid); }
      body.innerHTML = '';
      return;
    }
    if (arrangers.has(pid)) return;
    const { mountComposer } = await import('./composer.js');
    const c = mountComposer(body, {
      profiles, manifests, makeSettings, onOpen: open,
      initialProfileId: pid, embedded: true, autosave: true,
    });
    arrangers.set(pid, c);
    await c.refresh();
    await c.select(pid);
  }

  function render() {
    destroyArrangers();
    listEl.innerHTML = list.length
      ? list.map(card).join('')
      : `<p class="h-empty">No screens yet. Name one above and hit Create.</p>`;

    // Arranging is part of the screen, not a separate place you have to remember to visit.
    // The composer is mounted lazily: most visits to this page are not about layout, and a
    // settings handle per screen would be a request per card at load.
    for (const b of root.querySelectorAll('[data-arrange]')) {
      b.addEventListener('click', () => toggleArrange(b));
    }

    for (const b of root.querySelectorAll('[data-open]')) {
      b.addEventListener('click', () => open(b.dataset.open));
    }
    for (const b of root.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => guard(async () => {
        const pid = b.dataset.add;
        const type = root.querySelector(`[data-pick="${CSS.escape(pid)}"]`).value;
        await profiles.addModule(pid, type);
        await refresh();
        say(`Added ${type}.`);
      }));
    }
    for (const b of root.querySelectorAll('[data-rename]')) {
      b.addEventListener('click', () => {
        const p = list.find((x) => x.id === b.dataset.rename);
        const name = (prompt('Rename this screen to:', p ? p.name : '') || '').trim();
        if (!name || (p && name === p.name)) return;
        guard(async () => {
          await profiles.rename(b.dataset.rename, name);
          await refresh();
          say(`Renamed to “${name}”.`);
        });
      });
    }
    for (const b of root.querySelectorAll('[data-delete]')) {
      b.addEventListener('click', () => {
        const p = list.find((x) => x.id === b.dataset.delete);
        // Spell out what survives BEFORE they confirm. Deleting drops the layout and
        // settings, but the append-only record (points earned, gameplay logged) cannot
        // be deleted — and a new screen won't get it back, because it's a new id.
        const ok = confirm([
          `Delete “${p ? p.name : 'this screen'}”?`,
          '',
          'Its modules and settings go away. Points and game history already recorded ' +
          'are kept on the server and cannot be deleted — but a new screen will not ' +
          'show them, because it is a different screen.',
          '',
          'This cannot be undone.',
        ].join('\n'));
        if (!ok) return;
        guard(async () => {
          await profiles.remove(b.dataset.delete);
          await refresh();
          say('Screen deleted. Its recorded history is kept on the server.');
        });
      });
    }
    for (const b of root.querySelectorAll('[data-remove]')) {
      b.addEventListener('click', () => guard(async () => {
        const [pid, mid] = b.dataset.remove.split(':');
        await profiles.removeModule(pid, mid);
        await refresh();
        // Removing a module drops its CONFIG; its append-only events survive on the
        // server, so re-adding a game doesn't erase what was already recorded.
        say('Removed. Anything it already recorded is kept.');
      }));
    }
  }

  // One at a time: these are server round-trips, and a double-click that fires two
  // creates leaves a duplicate screen the user then has to puzzle over.
  async function guard(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); }
    catch (err) { console.error(err); say('That didn’t save — check your connection and try again.', true); }
    finally { busy = false; }
  }

  async function refresh() {
    const raw = await profiles.list(personId);
    // The list endpoint returns profiles without their modules; fetch each so the cards
    // can show what's actually in them.
    list = await Promise.all(raw.map((p) => profiles.get(p.id).catch(() => ({ ...p, modules: [] }))));
    render();
  }

  el('[data-new]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el('[data-name]');
    const name = input.value.trim();
    if (!name) return;
    guard(async () => {
      await profiles.create(name, personId);
      input.value = '';
      await refresh();
      say(`Created “${name}”. Add some modules to it.`);
    });
  });

  await refresh();
  return { refresh, profiles: () => list, catalog: () => catalog };
}
