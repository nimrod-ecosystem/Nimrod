// presets.js — a named library of saved settings bundles for a module TYPE, so more than
// one dashboard/screen can point at the same setup instead of each holding its own copy.
//
// MIKE_CHANGE_LIST.md row 2.22 / ideas_register.md #255, ruled DECIDED (Mike, 2026-09-28):
// "This sounds good." / on making it generic: "Definitely this." A preset is a named bundle
// of one module's settings (YouTube: playlist, schedule, shuffle). Each module INSTANCE
// either points at a preset or keeps its own independent settings — today's behavior,
// unchanged when no preset is chosen.
//
// ------------------------------------------------------------------------------------
// WHY THIS IS NOT `pack_library.js` (investigated first, register #255 point 4).
//
// `pack_library.js`'s whole shape is BUILT-IN array + user-added, merged and listed/resolved
// by id — it exists because trivia/word/lesson packs ship with real, hand-authored content
// (see its own header). A preset has no built-in entries at all: there is no factory-shipped
// "Saturday morning cartoons" YouTube preset, every one is created by a real person, so the
// merge-two-sources half of that file buys nothing here. Its storage is also wrong for this:
// packs are static JSON fetched by URL or held in browser localStorage (`user_packs.js`),
// device-local and NOT the kind of thing a caregiver expects to see again on a second screen.
// A preset is closer to ordinary per-person application state — the same substrate
// `createState`/`ctx.makePersonState` already gives `profile.js`'s theme and `lessons.js`'s
// quest/sandbox mode (see below) — so it gets its own small module instead of growing a
// second, incompatible meaning into `pack_library.js`.
//
// ------------------------------------------------------------------------------------
// SCOPE: PER-PERSON, NOT PER-PROFILE AND NOT PER-ACCOUNT. Argued both ways in this feature's
// own report (`docs/from_chat/NOTES_FROM_CODE.md` / the session that added this file) — the
// short version, so it is not lost the next time this file is read cold:
//
//   * NOT per-PROFILE (a single dashboard/screen's own `stateURL`): register #255 itself says
//     a preset should be usable "on 3 dashboards" — the entire point is that switching which
//     preset an instance points at is cheaper than re-entering the same playlist on every
//     screen. Per-profile storage cannot do that; it is just today's independent-settings
//     behavior with extra steps.
//   * NOT per-ACCOUNT (every person this login owns, e.g. `/api/user-state`): that endpoint is
//     explicitly a LEGACY ALIAS in `app.py` ("What /api/user-state and /api/user-events meant
//     before people existed... Delete them once nothing in the wild calls them") that already
//     resolves to the account's single DEFAULT person — it is not real account-wide storage
//     spanning several people, and building on a path marked for deletion is the wrong
//     foundation for a new feature. A genuine account-wide store (spanning every person on a
//     facility login) does not exist for arbitrary JSON today — `media_sources.js`'s agent
//     rows get it via their OWN dedicated table with a nullable `person_id` column, not this
//     generic state substrate — and building one is real, separate infrastructure, not this
//     pass's job.
//   * PER-PERSON (`profiles.personStateURL(personId, key)`, `ctx.makePersonState`) is what is
//     actually live, current and already used exactly this way by `modules/keyboard.js`'s
//     input bindings and `kiosk.js`'s marker/device preferences — a "3 dashboards" example is
//     precisely one PERSON's several screens, which is what per-person state already means in
//     this codebase (`profile.js`: "ACCOUNT -> PERSON -> Screens" — Screens/dashboards are
//     PLURAL under one person). It also keeps a facility account's residents from bleeding
//     into each other's preset lists, which `media_sources.js`'s own header names as the exact
//     failure per-person scoping on that file exists to prevent ("a merged pile of four
//     families"). `makeUserState` in `home.js`/`inputs.js`/`output_panel.js` is ALREADY this —
//     the name is historical (`app.py`'s own comment: "What /api/user-state... meant before
//     people existed") — so this file reuses that exact, already-proven naming and shape
//     rather than inventing a fourth term for the same thing.
//
// ------------------------------------------------------------------------------------
// SHAPE: one small reserved document, like `lessons.js`'s `PROFILE_SETTINGS_KEY` ('settings')
// — a single per-person JSON blob holding EVERY preset (of every module type) as a flat array,
// not one server row per preset. A presets LIBRARY is a collection of named things rather than
// a single value (unlike theme/questMode), so the live handle below is shaped differently from
// `createQuestMode` — list/get/save/delete instead of a bare `get`/`isSandbox` — but it rides
// the exact same `ctx.makePersonState`/`createState` seam, one document, one version, one
// last-write-wins-with-rebase write path already proven by every other reserved key.
//
// Module ids are 32-hex UUIDs (`module.js`), so a short, readable reserved key like this one
// never collides with an instance's own state — the same trick `'settings'` and `'lessons'`
// already rely on.
export const PRESETS_KEY = 'presets';

function newPresetId() {
  return (globalThis.crypto?.randomUUID?.() || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
}

// ---------- pure ----------

/** Every preset in `values` (the person's `presets` document), optionally filtered by type. */
export function presetsFrom(values, type = null) {
  const all = Array.isArray(values?.presets) ? values.presets : [];
  return type ? all.filter((p) => p && p.type === type) : all.slice();
}

export function presetById(values, id) {
  if (!id) return null;
  return presetsFrom(values).find((p) => p.id === id) || null;
}

// ---------- the live handle ----------
//
// `makeState` is `ctx.makePersonState` ALREADY CURRIED onto one person, i.e. `(key, opts) =>
// handle` — the exact shape `createQuestMode({ makeState })` above already takes, and the
// exact currying `home.js`'s own `forPerson()` already builds for `makeUserState`. A caller
// with a raw `(personId, key) => handle` factory (a module's `ctx.makePersonState`) passes
// `(key, opts) => ctx.makePersonState(ctx.personId, key, opts)`; nothing here needs to know
// which person it is.
export function createPresetLibrary({ makeState } = {}) {
  if (typeof makeState !== 'function') {
    throw new Error('createPresetLibrary: makeState is required');
  }
  const state = makeState(PRESETS_KEY);
  if (!state) {
    // No live state handle for this person — e.g. the real `ctx.makePersonState` itself
    // returned null (no person on this screen yet, or the host has no `personStateURL` at
    // all). `modules/keyboard.js` guards the exact same possibility on its own per-person
    // handle ("if (torn || !personState) return") — here the equivalent is an always-empty,
    // safely no-op library, so a caller deep inside a module's `init()` is never taken down
    // by a host that has not finished wiring the person layer.
    return {
      load: async () => {},
      startPolling: () => {},
      listPresets: () => [],
      getPreset: () => null,
      savePreset: async () => { throw new Error('createPresetLibrary: no state available for this person'); },
      deletePreset: async () => {},
      subscribe: () => () => {},
      get: () => ({}),
      destroy: () => {},
    };
  }

  const all = () => presetsFrom(state.get());

  function listPresets(type = null) {
    return presetsFrom(state.get(), type);
  }

  function getPreset(id) {
    return presetById(state.get(), id);
  }

  // Create (no `id`) or update (`id` given) a preset. `settings` is stored VERBATIM — this
  // file has no opinion on what a YouTube (or any other) preset's settings look like; that is
  // the calling module's contract, exactly the way an instance's own saved state already is.
  async function savePreset({ id = null, type, name, settings } = {}) {
    const t = String(type || '').trim();
    const nm = String(name || '').trim();
    if (!t) throw new Error('savePreset: type is required');
    if (!nm) throw new Error('savePreset: name is required');
    const now = Date.now();
    const list = all();
    let saved;
    if (id) {
      const at = list.findIndex((p) => p.id === id);
      if (at < 0) throw new Error('savePreset: no such preset');
      saved = { ...list[at], type: t, name: nm, settings: { ...(settings || {}) }, updatedAt: now };
      const next = list.slice();
      next[at] = saved;
      state.set({ presets: next });
    } else {
      saved = { id: newPresetId(), type: t, name: nm, settings: { ...(settings || {}) },
                createdAt: now, updatedAt: now };
      state.set({ presets: [...list, saved] });
    }
    await state.flush?.();
    return saved;
  }

  async function deletePreset(id) {
    if (!id) return;
    state.set({ presets: all().filter((p) => p.id !== id) });
    await state.flush?.();
  }

  return {
    load: () => state.load(),
    startPolling: () => state.startPolling?.(),
    listPresets,
    getPreset,
    savePreset,
    deletePreset,
    subscribe: (fn) => state.subscribe(fn),
    get: () => state.get(),
    destroy: () => state.destroy(),
  };
}
