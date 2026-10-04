// home_embed.js — A WHOLE SCREEN, AS A DASHBOARD, IN THE HOME PAGE'S STAGE (rows 2.29 / 2.30).
//
// `module_try.js`'s `mountEmbeddedKiosk` shows ONE module of your default screen, deliberately scoped to
// it (its header says why: picking Trivia must not bring your whole screen, camera and all). Your
// PROFILE is different: it is a dashboard -- a screen with a room behind it, your picture and your name
// on it (`game/game.js`) -- and looking at it means looking at all of it, arranged as it is arranged.
// So this mounts the same real kiosk (`embedded` + `dashboardModule`, the same seams module_try.js
// passes, for the same reasons) on a whole screen:
//
//   * LIVE (`profileId`): that screen of yours, its modules, and its saved arrangement handed over as
//     the embed's layout (an embed never reads the saved one itself). `list()` is empty and
//     `moveToPerson` withheld, exactly as module_try.js does, so a preview can neither hop to another
//     screen nor hand this one to somebody.
//   * PREVIEW (`record`): a screen that does not exist yet -- what "Your profile" would be -- held in
//     memory, over the browser's local backend, under ids no list shows. Nothing is made on your
//     account until you Save (the page does that, with game.js).
//
// `wrapState(handle, key)` is how the page keeps settings as a draft until Save (home_dashboard.js).

import { createProfilesClient } from './profile.js';
import { createState } from './state.js';
import { createLocalBackend, createLocalMediaSources } from './local_store.js';
import { memoryStorage } from './module_try.js';
import { normalizeLayout, isArranged } from './layout.js';

/** The arrangement to hand the embed: the screen's own, if it has one that places anything. */
export function layoutFor(settings, modules) {
  const saved = settings && settings.kiosk && settings.kiosk.layout;
  if (!isArranged(saved)) return null;
  const lay = normalizeLayout(saved, (modules || []).map((m) => m.id));
  return isArranged(lay) ? lay : null;
}

// `host` (2026-09-30 follow-up): the page's own actions and settings, handed to the kiosk so they are
// drawn in ITS bar and ITS ⚙ menu (kiosk.js's `host` option). Kept across rebuilds: it is the page's.
// `people` (PREVIEW only, 2026-10-02 evening): the account's people, read-only, so a profile panel on a preview
// (the landing's top left) can show the person looking by name. Absent, it shows them as "Somebody".
// `personHost` (2026-10-04): the person looking, as the page knows them -- `{ state(personId, key), browserNotes }`,
// kiosk.js's option of that name argues it. On a PREVIEW it is how a known person's Nimrod notes reach their own
// record (the local store has no per-person rows); on a live screen it only carries `browserNotes`, so notes this
// browser kept before are moved however the landing is opened.
export async function mountEmbeddedScreen({ stage, user = null, profileId = null, record = null, layout = null,
  wrapState = null, host = null, people = null, personHost = null }) {
  const { mountKiosk } = await import('./kiosk.js');
  const wrap = wrapState || ((h) => h);
  let kiosk = null;
  let torn = false;
  let busy = false;
  let again = false;

  async function boot() {
    stage.innerHTML = '';
    const seams = {
      navigate: () => {},
      reloadPage: () => { rebuild().catch((err) => console.error('home_embed: rebuild', err)); },
      storage: memoryStorage(), session: memoryStorage(),
      sources: createLocalMediaSources(),
      embedded: true,
      dashboardModule: true,
      ...(host ? { host } : {}),
      ...(personHost ? { personHost } : {}),
    };
    if (user && profileId) {
      const real = createProfilesClient({ user });
      const screen = await real.get(profileId);
      const settings = createState({ url: real.stateURL(profileId, 'settings'), user });
      let saved = {};
      try { saved = await settings.load(); } catch { saved = {}; } finally { settings.destroy(); }
      const { moveToPerson, ...rest } = real;   // withheld: see the header
      const profiles = { ...rest, list: async () => [] };
      kiosk = await mountKiosk(stage, {
        ...seams, user, profileId, profiles,
        makeState: (key, opts = {}, pid = profileId) => wrap(createState({ url: real.stateURL(pid, key), user, ...opts }), key),
        embedLayout: layoutFor(saved, screen.modules),
      });
    } else if (record) {
      const backend = createLocalBackend();
      const profiles = {
        list: async () => [],
        get: async () => ({ ...record, modules: record.modules.map((m) => ({ ...m })) }),
        stateURL: (pid, key) => `local:${pid}::${key}`,
        eventsURL: (pid, key) => `local:${pid}::${key}`,
        ...(typeof people === 'function' ? { people: async () => { try { return (await people()) || []; } catch { return []; } } } : {}),
      };
      kiosk = await mountKiosk(stage, {
        ...seams, user: null, profileId: record.id, profiles,
        makeState: (key, opts, pid) => wrap(backend.makeState(key, opts, pid), key),
        makeEvents: backend.makeEvents,
        embedLayout: layout,
      });
    } else {
      throw new Error('home_embed: a profileId (signed in) or a record (preview) is required');
    }
    if (torn) { try { kiosk.destroy(); } catch { /* already gone */ } kiosk = null; }
  }

  function teardown() {
    const k = kiosk; kiosk = null;
    try { k?.destroy(); } catch (err) { console.error('home_embed: kiosk destroy', err); }
    stage.innerHTML = '';
  }

  // One rebuild at a time, capped -- module_try.js's rule, for its reason (a kiosk that asks to be
  // rebuilt on every boot must not spin for ever on somebody's page).
  async function rebuild() {
    if (torn) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      let n = 0;
      do { again = false; teardown(); await boot(); } while (again && !torn && ++n < 3);
      again = false;
    } finally { busy = false; }
  }

  busy = true;
  try { await boot(); } finally { busy = false; }
  if (again) await rebuild();

  return {
    get kiosk() { return kiosk; },
    rebuild,
    destroy() { torn = true; teardown(); },
  };
}
