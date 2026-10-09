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
import { createAvatarCache } from './avatar_display.js';
import { createBus } from './bus.js';
import { mountPackLoader } from './pack_loader.js';
// settings sidebar (2026-10-08): the sidebar, its tabs and its look are site_nav.js's, shared with Home and Modules.
import { SITE_TABS, VISIBLE_SITE_TABS, siteSideHTML } from './site_nav.js';
// "Try it as someone new" (2026-10-04): a test person, and the strip that says so (try_new.js argues it).
import { readTrialRecord, startTrial, startOver, backToMe, removeTrial, syncTrial, mountTrialBar } from './try_new.js';
import { localScopeRows, clearLocalScope } from './local_store.js';

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

// The tabs in the sidebar. (settings sidebar, 2026-10-08: the list and its history moved to site_nav.js, which draws
// the one sidebar for My dashboards, Home and Modules -- Mike: "Every tab should have the sidebar like the devices and
// Dashboards tab." The names stay exported here, unchanged, for everything that already reads them.)
export const TABS = SITE_TABS;

// What the sidebar actually draws.
export const VISIBLE_TABS = VISIBLE_SITE_TABS;

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
                                       signedIn = null, storage = undefined,
                                       // settings sidebar (2026-10-08): the tab to open on, so a sidebar tab on
                                       // Home or Modules (/home.html?tab=inputs) lands on that tab. Unknown: Dashboards.
                                       startTab = null,
                                       navigate = (url) => {
                                         // A dev `?user=` rides along (a signed-in browser's cookie needs nothing).
                                         const u = new URLSearchParams(location.search).get('user');
                                         location.assign(u ? `${url}?user=${encodeURIComponent(u)}` : url);
                                       } } = {}) {
  const isSignedIn = signedIn == null ? !!email : !!signedIn;
  // TRY IT AS SOMEONE NEW: signed in only (signed out, a private window is the way -- try_new.js), and only with
  // a person-state seam to keep the test person's record on.
  const canTry = isSignedIn && typeof makePersonState === 'function' && typeof profiles?.addPerson === 'function';
  let active = 'screens';
  let panel = null;
  let personId = '';
  let personName = '';

  // THE SIDEBAR (settings sidebar, 2026-10-08): site_nav.js draws it, the same one Home and Modules now have. Its
  // history -- why the pages sit ABOVE the tabs and are marked as leaving this shell (B4), "Modules" and "Make your
  // profile" (2026-10-07, 2026-09-29), Switch account and Try as a guest (PRIORITY.md #6), the account's own pages
  // (2026-10-04) -- moved there with it. What stays here is this page's own: the tabs are BUTTONS that change the
  // panel in place, and "Try it as someone new" (try_new.js) in the foot.
  root.innerHTML = `
    <div class="shell">
      ${siteSideHTML({
        here: 'dashboards', signedIn: isSignedIn, email,
        // TRY IT AS SOMEONE NEW (try_new.js): the site as a brand-new person meets it, on a test person, nothing of
        // yours touched. While one is being tried, the strip above the people bar has its actions.
        footExtra: canTry
          ? '<button type="button" class="s-signout s-acct" data-trynew hidden title="A test person on this account: the landing as their first visit. Nothing of yours changes; your notes stay yours.">Try it as someone new</button>'
            + '<button type="button" class="s-signout s-acct" data-tryremove hidden title="The test person and their dashboards go; any notes they hold move to you first.">Remove the test person</button>'
            + '<span class="s-signout" data-trymsg hidden></span>'
          : '',
      })}
      <main class="s-main">
        <div data-trial></div>
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
    // *** THE CAMERA IS NOT STARTED HERE ANY MORE. *** (G10)
    //
    // This line used to read `await tracker.start()`, so ARRIVING at Devices — to bind a
    // switch, to pick a microphone, to read the page — asked the browser for a webcam.
    // Mike, off the live site: "On a public demo that is a bad first impression and it is
    // unprompted."
    //
    // The rule was already written twenty lines up, for the microphone: *"a settings page that
    // turned the microphone on to show you a settings page would be its own bug."* The camera
    // half simply did not follow it. The panel owns the prompt now, behind the button that
    // says what it is for — and it still starts with no prompt on a return visit where the
    // browser has already been told yes.
    //
    // The other half of the old comment stands and is unchanged: the camera closes when the
    // tab is left. `destroy` below still tears the tracker down, and a calibration panel that
    // left the webcam on after its tab was closed would be the single worst thing in this repo.
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
      // `personId`/`makeUserState` (register #255): presets are a per-PERSON library (see
      // presets.js's own header for the scope argument), the exact same currying `inputs.js`
      // already gets below for bindings. Absent before a person has resolved — `mountMedia`
      // treats that exactly like a signed-out visitor: the Presets section renders, says so,
      // and every other part of the page (Sources) is unaffected.
      const m = mountMedia(host, { user, personId, makeUserState });
      await m.refresh();

      // "MAKE YOUR OWN PACK" NEEDED SOMEWHERE TO LAND BESIDES A GAME'S OWN MENU. Mike's own
      // ask: Media is where a caregiver already comes to add their own content (a folder of
      // photos) — a pack is the same idea, content someone brought rather than what shipped,
      // so it gets a section here too, not only inside Trivia's/Word Forge's settings.
      // Unrestricted (`kind` omitted): someone here may be adding a pack for a game they are
      // not currently looking at.
      const packHost = document.createElement('div');
      packHost.className = 'm-packs';
      packHost.innerHTML = '<h3 class="m-packs-head">Content packs</h3>';
      host.append(packHost);
      const packRec = mountPackLoader(packHost, {});

      return {
        async refresh() { await m.refresh(); return this; },
        destroy() {
          try { packRec?.destroy?.(); } catch (e) { console.error(e); }
          try { m.destroy?.(); } catch (e) { console.error(e); }
        },
      };
    }
    if (id === 'inputs') {
      // TWO PANELS IN ONE TAB, and it is the right tab: a marker tracker is a DEVICE, sitting
      // with the switches and controllers rather than in a category of its own. Composed here
      // rather than by nesting one panel inside the other, so neither file has to know about
      // the other's internals and either can be mounted alone by a test.
      const { mountInputs } = await import('./inputs.js');
      // `personName` added 2026-09-13 (Revision 9) — `personId` was already being passed and
      // silently dropped, since bindings are per-person and nothing on the tab ever said
      // whose. `mountInputs` re-mounts fresh on every person switch (this whole `mount`
      // function does), so a name read once at mount time is never stale.
      const i = mountInputs(host, { profiles, user, makeUserState, personId, personName });

      // SCREENS ON THIS ACCOUNT (2026-10-09, account_screens.js argues why here and not its own sidebar entry):
      // under the Devices heading, above the bindings. On an account only (a sign-in, or a screen's own key) -
      // signed out, this page runs on this browser's own storage and there is no account to have screens on.
      let screens = null;
      if (isSignedIn) {
        const scrHost = document.createElement('div');
        scrHost.dataset.accountScreensHost = '';
        const intro = host.querySelector('.h-intro');
        if (intro) intro.after(scrHost); else host.prepend(scrHost);
        try {
          const { mountAccountScreens } = await import('./account_screens.js');
          screens = mountAccountScreens(scrHost, { user });
          screens.refresh().catch((err) => console.error('home: account screens', err));   // not awaited: the bindings need not wait
        } catch (err) {
          console.error('home: account screens', err);
          scrHost.remove();
        }
      }
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
          await screens?.refresh?.();
          await mics?.refresh?.();
          await marker?.refresh?.();
          return this;
        },
        destroy() {
          try { marker?.destroy?.(); } catch (e) { console.error(e); }
          try { mics?.destroy?.(); } catch (e) { console.error(e); }
          try { screens?.destroy?.(); } catch (e) { console.error(e); }
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
        // The intercom's approved list lives on the person's own row (row 2.44).
        makePersonState,
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
  // Each person's avatar beside their name (row 2.37 item 5): ONE cache for the page, one read
  // per person, whatever redraws (`avatar_display.js`). No per-person state seam, no faces.
  const avatars = makePersonState ? createAvatarCache({ makePersonState, user }) : null;
  // The account's test people (try_new.js), by id -> their record. Read on mount and after each trial action.
  let trialRecs = new Map();
  const people = mountPeople(root.querySelector('[data-people]'), {
    profiles,
    storage,
    avatars,
    tag: (p) => (trialRecs.has(p.id) ? 'test' : ''),
    onChange: (person) => {
      personId = (person && person.id) || '';
      personName = (person && person.name) || '';
      trialFollow();
      if (panel) show(active);      // whoever is on screen is now showing the wrong person
    },
  });
  await people.refresh({ notify: false });
  personId = (people.current() || {}).id || '';
  personName = (people.current() || {}).name || '';

  // ---- TRY IT AS SOMEONE NEW (try_new.js) ------------------------------------------------------------------
  // Here because this is where the account's people are: the sidebar's "Try it as someone new" makes (or resumes)
  // the test person and opens the landing as their first visit; while they are the person shown, a strip above
  // the people bar says so and has Start over (two presses) and Back to me. Picking the test person on the bar
  // enters it; picking anybody else leaves it (syncTrial), so this browser always agrees with who is shown.
  const trialHost = root.querySelector('[data-trial]');
  const localScope = { rows: localScopeRows, clear: clearLocalScope };
  let trialBar = null;
  const sideMsg = (text) => {
    const el = root.querySelector('[data-trymsg]');
    if (el) { el.textContent = text || ''; el.hidden = !text; }
  };
  function paintTrial() {
    if (!canTry) return;
    const cur = people.current();
    const rec = cur ? trialRecs.get(cur.id) : null;
    try { trialBar?.destroy(); } catch { /* gone */ }
    trialBar = null;
    if (rec) {
      trialBar = mountTrialBar(trialHost, {
        landing: '/modules.html', name: cur.name,
        onStartOver: async () => {
          await startOver({ profiles, makePersonState, personId: cur.id, user, storage, localScope });
          navigate('/modules.html');
        },
        onBack: async () => {
          const owner = await backToMe({ makePersonState, personId: cur.id, storage });
          await people.refresh({ want: owner || null });
          paintTrial();
        },
      });
    }
    const tryBtn = root.querySelector('[data-trynew]');
    const rmBtn = root.querySelector('[data-tryremove]');
    if (tryBtn) tryBtn.hidden = !!rec;
    if (rmBtn) rmBtn.hidden = !!rec || !trialRecs.size;
  }
  function trialFollow() {
    if (!canTry) return;
    const cur = people.current();
    if (cur) syncTrial({ user, personId: cur.id, record: trialRecs.get(cur.id) || null, storage });
    paintTrial();
  }
  async function readTrials() {
    if (!canTry) return;
    const next = new Map();
    for (const p of people.list()) {
      try { const r = await readTrialRecord(makePersonState, p.id); if (r) next.set(p.id, r); }
      catch { if (trialRecs.has(p.id)) next.set(p.id, trialRecs.get(p.id)); }   // offline: what was known
    }
    trialRecs = next;
    people.repaint();
    trialFollow();
  }
  if (canTry) {
    root.querySelector('.s-foot')?.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest?.('[data-trynew]')) {
        t.disabled = true; sideMsg('');
        try {
          await startTrial({ profiles, makePersonState, user, ownerId: personId, storage });
          navigate('/modules.html');
        } catch (err) { console.error('home: try it as someone new', err); sideMsg(err?.message || 'That did not work.'); }
        finally { t.disabled = false; }
        return;
      }
      if (t.closest?.('[data-tryremove]')) {
        const id = [...trialRecs.keys()][0];
        if (!id || !globalThis.confirm('Remove the test person and their dashboards? Any notes they hold move to you first.')) return;
        t.disabled = true; sideMsg('');
        try {
          await removeTrial({ profiles, makePersonState, personId: id, storage, localScope });
          await people.refresh();
          await readTrials();
          sideMsg('The test person is gone.');
        } catch (err) { console.error('home: remove the test person', err); sideMsg(err?.message || 'That did not work.'); }
        finally { t.disabled = false; }
      }
    });
    // Not awaited: one read per person must not hold up the page; the button and the strip appear when known.
    readTrials().catch((err) => console.error('home: test people', err));
  }

  const api = {
    show,
    active: () => active,
    panel: () => panel,
    people,
    person: () => people.current(),
    // "Try it as someone new", for a suite: read the test people again, and who they are.
    trial: { read: () => readTrials(), records: () => new Map(trialRecs) },
    destroy() {
      try { trialBar?.destroy(); } catch { /* gone */ }
      people.destroy();
      avatars?.destroy();
      if (panel && panel.destroy) panel.destroy();
    },
  };
  await show(startTab || 'screens');   // (`show` falls back to Dashboards for a tab it does not know)
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
        <!-- *** THE COPY FOLLOWS THE TAB, or the rename makes things worse rather than
             better. *** PRIORITY.md #4 renames Screens to Dashboards; a sidebar reading
             Dashboards that opens a page headed "Your screens" is two names for one thing,
             which is the confusion the rename exists to remove, doubled.
             The word screen stays in the CODE -- ids, mountScreens, stageEl, the saved
             screens key -- for the same reason the tab id did: renaming an identifier is a
             migration, not a wording change.
             AND NO BACKTICKS IN HERE. This comment is inside a template literal. The warning
             is already written twenty lines up and I still quoted a field name in backticks
             and broke the file -- third time this session, caught each time in seconds by
             imports_test, which is the entire argument for that suite existing. -->
        <h1>Your dashboards</h1>
        <p>A <b>dashboard</b> is a set of modules — photos, a clock, games, the lineup — that you
          open full-screen. Make one for each person or place.</p>
      </div>

      <form class="h-new" data-new>
        <input type="text" data-name placeholder="Name a new dashboard (e.g. Bedside, Living room)"
        aria-label="new dashboard name" required>
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
          ${mods.length ? '' : '<span class="h-hint">a dashboard needs at least one module to open</span>'}
        </div>
        <!-- WHAT THE THING YOU ARE ABOUT TO ADD ACTUALLY DOES.
             The picker was fourteen bare words - "Pond", "Sprint", "Quests", "Lineup" - and
             none of them mean anything to somebody deciding whether this helps their mother.
             The descriptions were already declared in every module manifest and were read by
             NOTHING. This is that data, on screen, next to the decision it informs. -->
        <p class="h-modwhat" data-modwhat="${esc(p.id)}">${esc(catalog[0]?.description || '')}</p>
        <!-- The description answers "what is this"; it cannot answer "what does it LOOK like",
             which is the other half of deciding whether it helps your mother.

             *** IT MOUNTS THE THING HERE NOW, RATHER THAN NAVIGATING TO IT. ***

             It used to be a link to /modules.html?m=<type>, which showed the right answer on
             the wrong page: somebody halfway through building a dashboard was taken off it, and
             the way back was the browser's back button. Chat's #10. Deciding whether to add a
             module is a decision made HERE, next to the picker and the dashboard it would go
             on, so the evidence belongs here too.

             The scaffolding is module_try.js, the same host the public parts page uses -
             everything it touches is a local throwaway backend, so nothing a visitor does while
             poking at a preview reaches their real dashboard. It tracks the picker: see
             syncModuleWhat. (No backticks here either; see above.) -->
        <button type="button" class="h-modsee" data-modsee="${esc(p.id)}"
          aria-expanded="false">See it running</button>
        <div class="h-modpreview" data-modpreview="${esc(p.id)}" hidden></div>
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
    // A preview showing the fourth module after somebody has moved the picker to the seventh
    // is worse than no preview — it answers a question they are no longer asking, and it
    // answers it convincingly. So changing the picker takes the old one down; pressing the
    // button again brings up whatever is selected now.
    closePreview(id);
    if (!what) return;
    const m = catalog.find((x) => x.type === sel.value);
    what.textContent = (m && m.description) || '';
  }
  listEl.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-pick]');
    if (sel) syncModuleWhat(sel);
  });

  // ------------------------------------------------------------------------------------
  // "SEE IT RUNNING" — a real module, here, on the page where the decision is being made
  // ------------------------------------------------------------------------------------
  //
  // One try-host for the whole page, built the first time somebody asks and never before: it
  // seeds a starter screen and builds a bus, an output bus, an audio arbiter and both device
  // owners, and nobody who never presses the button should pay for that.
  let tryHost = null;
  let tryHostP = null;
  const previews = new Map();           // profileId -> the element a module is mounted in

  /**
   * *** A MODULE BRINGS ITS OWN STYLESHEET, BECAUSE THIS PAGE HAS NEVER NEEDED IT. ***
   *
   * `home.html` does not link `modules.css` -- it had no reason to, until this page started
   * mounting modules. Without it a preview renders as raw markup: no card, no grid, no
   * `.mod-host` scroll box, the whole module running off the bottom of the document. Somebody
   * pressing "see it running" would conclude the module is broken, which is the exact opposite
   * of what the button is for.
   *
   * Found by LOOKING at the render, not by a check -- the checks all passed, because a module
   * that mounts and answers to `mod-host` is mounted whether or not anything styled it.
   *
   * Loaded ON DEMAND rather than in the page head: most visits here never open a preview, and
   * a page that pulls the whole module stylesheet to render a list of dashboard names is
   * paying for something nobody asked for. Awaited, so the first frame is the styled one
   * instead of a flash of unstyled module.
   */
  let cssP = null;
  function moduleCss() {
    if (cssP) return cssP;
    if (document.querySelector('link[data-modules-css]')) { cssP = Promise.resolve(); return cssP; }
    cssP = new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/modules.css';
      link.dataset.modulesCss = '1';
      // Resolve either way: a preview with no stylesheet is worse than one with, and much
      // better than a button that hangs because a stylesheet 404'd.
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    });
    return cssP;
  }

  async function getTryHost() {
    if (tryHost) return tryHost;
    if (!tryHostP) {
      tryHostP = import('./module_try.js')
        .then((m) => m.createTryHost())
        .then((h) => { tryHost = h; return h; });
    }
    return tryHostP;
  }

  function closePreview(pid) {
    const box = listEl.querySelector(`[data-modpreview="${CSS.escape(pid)}"]`);
    const btn = listEl.querySelector(`[data-modsee="${CSS.escape(pid)}"]`);
    const el = previews.get(pid);
    if (el && tryHost) { try { tryHost.unmount(el); } catch (err) { console.error(err); } }
    previews.delete(pid);
    if (box) { box.hidden = true; box.innerHTML = ''; }
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.textContent = 'See it running'; }
  }

  async function togglePreview(btn) {
    const pid = btn.dataset.modsee;
    const box = listEl.querySelector(`[data-modpreview="${CSS.escape(pid)}"]`);
    const sel = listEl.querySelector(`[data-pick="${CSS.escape(pid)}"]`);
    if (!box || !sel) return;
    if (!box.hidden) { closePreview(pid); return; }

    const type = sel.value;
    box.hidden = false;
    box.innerHTML = '<p class="h-quiet">Starting it up…</p>';
    btn.setAttribute('aria-expanded', 'true');
    btn.textContent = 'Hide it';
    try {
      const [host] = await Promise.all([getTryHost(), moduleCss()]);
      // `mod-box` is what makes the module size itself to THIS box rather than to the page —
      // the container the modules.css container queries are written against. Without it a
      // module in a 320px-tall preview lays itself out as though it had a screen.
      // *** THE HEIGHT IS INLINE, AND THAT IS NOT LAZINESS. ***
      //
      // `mod-box` is `container-type:size`, which needs a DEFINITE size or it contains
      // nothing -- and the module then lays itself out against the page and runs off the
      // bottom of it. The rest of the look (border, corner, background) is in home.html's
      // stylesheet where it belongs, but the one declaration the containment depends on ships
      // with the element that declares itself a container. Caught by looking at the preview on
      // a page that does not load those styles: the module spilled down the whole document.
      box.innerHTML = '<div class="h-modstage mod-box" style="height:320px"></div>';
      const stage = box.firstElementChild;
      host.mount(type, stage);
      previews.set(pid, stage);
    } catch (err) {
      console.error('home: preview failed', err);
      // A module that will not start is worth saying plainly. It is also not a reason to lose
      // the dashboard somebody is building, which is the whole point of previewing here.
      box.innerHTML = '<p class="h-quiet">That one would not start here. It still works on a '
        + 'dashboard — some modules need a camera or a folder that this preview has not got.</p>';
    }
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
    // Every card is about to be replaced, so anything mounted inside one has to come down
    // first. A module left running inside discarded markup keeps its timers, its audio
    // registration and its camera claim -- which on this page means a preview somebody closed
    // ten minutes ago still holding the microphone.
    for (const pid of [...previews.keys()]) closePreview(pid);
    listEl.innerHTML = list.length
      ? list.map(card).join('')
      : `<p class="h-empty">No screens yet. Name one above and hit Create.</p>`;

    // Arranging is part of the screen, not a separate place you have to remember to visit.
    // The composer is mounted lazily: most visits to this page are not about layout, and a
    // settings handle per screen would be a request per card at load.
    for (const b of root.querySelectorAll('[data-arrange]')) {
      b.addEventListener('click', () => toggleArrange(b));
    }
    for (const b of root.querySelectorAll('[data-modsee]')) {
      b.addEventListener('click', () => togglePreview(b));
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
