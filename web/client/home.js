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
// person changes what EVERY tab is showing — Screens lists theirs, Devices edits theirs,
// Output routes theirs. A picker that lived in one tab would leave the others silently
// addressing somebody else, which is the single worst failure this layer could have.
// Changing person remounts the active panel; see `show()`.

import { mountPeople } from './people.js';
import { createBus } from './bus.js';

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
// `hidden: true` takes a tab out of the sidebar WITHOUT removing it. It stays in TABS, it
// stays mountable, and `show('<id>')` still reaches it — so a bookmark, a saved tab, or
// somebody who was using it is never met with a dead end.
//
// *** ADULTING IS GONE (hidden 2026-08-27, removed 2026-09-02, Mike). *** It was a personal
// points board for a carer, connected to nothing else on this page — not to a screen, not to
// a person, not to the patient — so every first-time visitor paid to read a tab about THEIR
// OWN chores while working out what the product is. It was kept hidden on the theory that the
// idea might come back attached to something. It did, and the thing it came back as already
// exists: a carer who wants their own board makes a screen and puts a quest board on it. So
// there is nothing left for this tab to be, and it is out of TABS rather than hidden in it.
export const TABS = [
  { id: 'screens',  label: 'Screens',  hint: 'make and fill your screens' },
  { id: 'media',    label: 'Media',    hint: 'connect the folders your photos live in' },
  // The ID STAYS `inputs`. A tab id is a stable identifier - it is in URLs, in tests and in
  // `INPUTS_KEY` on the server - and renaming it is a migration, not a label change. Only the
  // word a person reads moved to Devices.
  { id: 'inputs',   label: 'Devices',  hint: 'the switches, controllers and keys you use — and what each one does' },
  { id: 'output',   label: 'Output',   hint: 'how this screen answers — spoken, on screen, a sound' },
  { id: 'remote',   label: 'Remote',   hint: 'drive their screen from here, while they are at it' },
  // ON HOME, NOT ON THE KIOSK. Reviewing what a module recorded is a different job in a
  // different room, and a table of somebody's performance has no business on the screen
  // they cannot walk away from.
  { id: 'records',  label: 'Records',  hint: 'what a module wrote down, and vouching for it' },
  // The state machine, in sentences. The engine has always been authorable; what was missing
  // was that nobody could READ the config. See rules.js.
  { id: 'rules',    label: 'Rules',    hint: 'what each screen does on its own, and when' },
];

// What the sidebar actually draws.
export const VISIBLE_TABS = TABS.filter((t) => !t.hidden);

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
  let personName = '';

  root.innerHTML = `
    <div class="shell">
      <nav class="s-side">
        <div class="s-brand">Nimrod<span>.</span></div>
        <ul class="s-nav">
          ${VISIBLE_TABS.map((t) => `<li><button class="s-navb" data-tab="${t.id}" title="${t.hint}">${t.label}</button></li>`).join('')}
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
  // ---- which microphone, and what to fall back to ------------------------------------
  //
  // NOTHING IS OPENED HERE. The panel lists devices and writes a preference; the microphone is
  // only ever opened by whatever acquires it, which on this page is nothing at all. A settings
  // page that turned the microphone on to show you a settings page would be its own bug.
  async function mountDeviceTab(host, { makeUserState: makeState2 }) {
    const [{ createMicOwner }, { mountDevicePanel, DEVICE_KEY }] = await Promise.all([
      import('./mic_owner.js'), import('./device_panel.js'),
    ]);
    if (!makeState2) return null;
    const state = makeState2(DEVICE_KEY);
    await state.load().catch(() => {});
    const owner = createMicOwner({
      preferred: () => (state.get() || {}).microphonePreferred || [],
    });
    // RECORDING SITS DIRECTLY BENEATH THE CHOOSER, and that placement is the point: the first
    // thing anybody should do after picking microphones is record ten seconds and find out
    // whether it worked. A setup screen that cannot be tested from itself sends people away to
    // discover the problem somewhere less forgiving.
    const recHost = document.createElement('div');
    const panel = mountDevicePanel(host, {
      owner,
      settings: () => state.get() || {},
      save: async (patch) => { state.set(patch); await state.flush?.(); },
      // The ONLY place a prompt happens, and only from the button that says so.
      requestPermission: async () => {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const t of s.getTracks()) t.stop();     // we wanted the permission, not the audio
      },
    });
    await panel.refresh();

    host.append(recHost);
    const [{ mountRecordPanel }, { createPairedRecorder, webAudioCapture }, fsSink] =
      await Promise.all([
        import('./record_panel.js'), import('./recorder.js'), import('./fs_sink.js'),
      ]);
    const record = mountRecordPanel(recHost, {
      micOwner: owner,
      makeRecorder: ({ producer, keepDays }) => createPairedRecorder({
        capture: webAudioCapture({ micOwner: owner }), producer, keepDays,
      }),
      fs: fsSink,
      settings: () => state.get() || {},
      save: async (patch) => { state.set(patch); await state.flush?.(); },
    });
    await record.refresh();

    return {
      async refresh() { await panel.refresh(); await record.refresh(); return this; },
      destroy() {
        try { record.destroy(); } catch (e) { console.error(e); }
        try { panel.destroy(); } catch (e) { console.error(e); }
        try { owner.destroy(); } catch (e) { console.error(e); }
        try { state.destroy?.(); } catch (e) { console.error(e); }
      },
    };
  }

  // ---- the marker tracker's calibration, mounted under Devices ----------------------
  //
  // Assembled here rather than inside `marker_panel.js` because the panel is deliberately
  // ignorant of where its camera and its storage come from — which is what lets the whole
  // thing be tested against frames built in an array.
  //
  // THE AIM ON THIS PAGE DRIVES NOTHING, and that is correct rather than a shortcut. Home has
  // no cursor and no kiosk; what a caregiver is doing here is producing NUMBERS — a color, a
  // rest point, a gain — which the kiosk then uses. The live picture is the feedback, and the
  // "let this move the cursor" switch is a statement about the screen, not about this page.
  async function mountMarkerTab(host, { makeUserState: makeState2 }) {
    const [{ createAim }, { createCameraOwner }, { createMarkerTracker },
           { mountMarkerPanel, MARKER_KEY }] = await Promise.all([
      import('./aim.js'), import('./camera_owner.js'),
      import('./input_marker.js'), import('./marker_panel.js'),
    ]);
    if (!makeState2) return null;                 // no person resolved yet: nothing to save into
    const state = makeState2(MARKER_KEY);
    await state.load().catch(() => {});           // offline is not a reason to have no panel
    const localBus = bus || createBus();
    const aim = createAim({ bus: localBus });
    const owner = createCameraOwner();
    let panelRef = null;
    const tracker = createMarkerTracker({
      aim, cameraOwner: owner,
      settings: () => state.get() || {},
      onFrame: (f, found, mask) => panelRef?.draw(f, found, mask),
    });
    panelRef = mountMarkerPanel(host, {
      tracker, aim,
      settings: () => state.get() || {},
      save: async (patch) => { state.set(patch); await state.flush?.(); },
    });
    // The camera only opens when somebody is looking at this tab, and closes when they leave.
    // A calibration panel that left the webcam on after the tab was closed would be the single
    // worst thing in this repo.
    await tracker.start().catch((err) => { console.error('marker: camera', err); });
    return {
      async refresh() { await panelRef.refresh(); return this; },
      destroy() {
        try { tracker.destroy(); } catch (e) { console.error(e); }
        try { panelRef.destroy(); } catch (e) { console.error(e); }
        try { state.destroy?.(); } catch (e) { console.error(e); }
      },
    };
  }

  const mount = mountTab || (async (id, host) => {
    if (id === 'media') {
      const { mountMedia } = await import('./media.js');
      const m = mountMedia(host, { user });
      await m.refresh();
      return m;
    }
    if (id === 'inputs') {
      // TWO PANELS IN ONE TAB, and it is the right tab: a marker tracker is a DEVICE, sitting
      // with the switches and controllers rather than in a category of its own. Composed here
      // rather than by nesting one panel inside the other, so neither file has to know about
      // the other's internals and either can be mounted alone by a test.
      const { mountInputs } = await import('./inputs.js');
      const i = mountInputs(host, { profiles, user, makeUserState, personId });
      await i.refresh();

      // WHICH MICROPHONE, and what to fall back to. Above the marker panel because it needs no
      // camera and no calibration — somebody can set it in ten seconds and leave.
      const micHost = document.createElement('div');
      host.append(micHost);
      let mics = null;
      try {
        mics = await mountDeviceTab(micHost, { makeUserState });
      } catch (err) {
        console.error('home: device panel', err);
        micHost.remove();
      }

      const markerHost = document.createElement('div');
      host.append(markerHost);
      let marker = null;
      try {
        marker = await mountMarkerTab(markerHost, { makeUserState });
      } catch (err) {
        // A camera that will not open, or a browser with none, must not take the whole
        // Devices tab down with it — somebody came here to bind a switch.
        console.error('home: marker panel', err);
        markerHost.remove();
      }
      return {
        async refresh() {
          await i.refresh();
          await mics?.refresh?.();
          await marker?.refresh?.();
          return this;
        },
        destroy() {
          try { marker?.destroy?.(); } catch (e) { console.error(e); }
          try { mics?.destroy?.(); } catch (e) { console.error(e); }
          try { i.destroy?.(); } catch (e) { console.error(e); }
        },
      };
    }
    if (id === 'output') {
      const { mountOutput } = await import('./output_panel.js');
      const o = mountOutput(host, { user, makeUserState, makeUserEvents });
      await o.refresh();
      return o;
    }
    if (id === 'rules') {
      const { mountRules } = await import('./rules.js');
      const r = mountRules(host, { profiles, user, makeState });
      await r.refresh();
      return r;
    }
    if (id === 'records') {
      const { mountRecords } = await import('./records.js');
      const rec = mountRecords(host, { profiles, user, makeEvents });
      await rec.refresh();
      return rec;
    }
    if (id === 'remote') {
      const { mountRemote } = await import('./remote.js');
      const r = mountRemote(host, {
        personId, personName, user, bus, profiles,
      });
      await r.refresh();
      return r;
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
      personName = (person && person.name) || '';
      if (panel) show(active);      // whoever is on screen is now showing the wrong person
    },
  });
  await people.refresh({ notify: false });
  personId = (people.current() || {}).id || '';
  personName = (people.current() || {}).name || '';

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
        <input type="text" data-name placeholder="Name a new screen (e.g. Bedside, Living room)" aria-label="new screen name" required>
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
            ${catalog.map((m) => `<option value="${esc(m.type)}" title="${esc(m.description || '')}">${esc(m.title || m.type)}</option>`).join('')}
          </select>
          <button class="h-btn" data-add="${esc(p.id)}">Add module</button>
          ${mods.length ? '' : '<span class="h-hint">a screen needs at least one module to open</span>'}
        </div>
        <!-- WHAT THE THING YOU ARE ABOUT TO ADD ACTUALLY DOES.
             The picker was fourteen bare words - "Pond", "Sprint", "Quests", "Lineup" - and
             none of them mean anything to somebody deciding whether this helps their mother.
             The descriptions were already declared in every module manifest and were read by
             NOTHING. This is that data, on screen, next to the decision it informs. -->
        <p class="h-modwhat" data-modwhat="${esc(p.id)}">${esc(catalog[0]?.description || '')}</p>
        ${mods.length && makeSettings ? `
        <div class="h-arrange">
          <button class="h-btn h-quiet" data-arrange="${esc(p.id)}" aria-expanded="false">Arrange layout</button>
          <div class="h-arrange-body" data-arrange-body="${esc(p.id)}" hidden></div>
        </div>` : ''}
      </section>`;
  }

  // Keep the description in step with the picker. Delegated from the list root so it keeps
  // working across every re-render, of which there are many.
  function syncModuleWhat(sel) {
    const id = sel.dataset.pick;
    const what = listEl.querySelector(`[data-modwhat="${CSS.escape(id)}"]`);
    if (!what) return;
    const m = catalog.find((x) => x.type === sel.value);
    what.textContent = (m && m.description) || '';
  }
  listEl.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-pick]');
    if (sel) syncModuleWhat(sel);
  });

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
