// game/game.js — THE NIMROD GAME, STEP 1: YOUR PROFILE IS YOUR FIRST DASHBOARD.
//
// What this is, what is deliberately not here yet, and how it talks to the rest: `README.md`
// beside this file. The short version: every step drives the REAL product — a real screen, two
// real `button` instances, the real kiosk with its real transport bar and settings menu. Nothing
// here is a mock-up of a dashboard; the game is a checklist that builds one and then hands you to
// it. It reaches the rest of Nimrod only through the stores every page shares (screens, a screen's
// settings, an instance's state, per-person state) and the kiosk URL.
//
// *** EVERY STEP IS RE-ENTRANT. *** Pressing a step twice, refreshing half-way, coming back next
// week: none of it duplicates anything. The ids are remembered in PER-PERSON state (the game is
// the person's, not one screen's), and each step checks what exists before it makes anything. The
// profile screen also carries a stamp in its own settings (`game: 'profile'`), so if the per-person
// memory is ever lost — or the page was closed in the instant between making the screen and
// remembering it — the screen is found again rather than made twice. A screen the person happened
// to NAME "My profile" themselves has no stamp and is never adopted.
//
// *** IT NEVER TOUCHES ANOTHER SCREEN. *** It makes one screen and only ever writes to that one.
//
// DEFAULTS CHOSEN HERE, each revisable and none an absolute:
//   * ROOM_THEME = 'cozy' ("a window seat and books") — the only live theme that is a ROOM rather
//     than a landscape (fall, winter), a street (cyberpunk), a tank (aquarium) or a sky (night);
//     Mike: "some of those being rooms", and a profile is "like your room". Light, too, so black
//     words on a white sign read on it. Falls back to the default theme if it is ever removed.
//   * panelSurface 'clear' on the profile screen only — so the room shows around the sign and the
//     picture and they read as things ON the wall, not two white boxes in front of it. Each button
//     brings its own ground, so nothing loses contrast. One menu row away ("Panel backgrounds").
//   * PROFILE_LAYOUT 'side' — two things, two spots, nothing left over. Mike: "maybe there's already
//     a spot for it, but you can move it if you want": the picture's spot is the first, the sign's
//     the second, and the composer (Home -> the screen -> arrange) moves either. 'quad' or 'main'
//     would leave empty cells that read as something missing on a first screen.
//   * The sign starts as a plaque with the person's name (or "Your name"); the picture starts in a
//     picture frame captioned "My picture" with NO picture chosen — choosing one is the person's
//     first real use of the settings menu, and the game cannot know which photo is them.

import { THEMES, DEFAULT_THEME } from '../theme.js';
import { normalizeLayout, isArranged } from '../layout.js';

export const GAME_KEY = 'game';                 // the per-person state key
export const PROFILE_NAME = 'My profile';
export const PROFILE_STAMP = 'profile';         // settings.game on the screen this game made
export const ROOM_THEME = 'cozy';
export const PROFILE_LAYOUT = 'side';
export const SLOT = Object.freeze({ picture: 0, sign: 1 });
export const PICTURE_START = Object.freeze({ label: 'My picture', frame: 'picture', style: 'plain' });
export const SIGN_START = Object.freeze({ style: 'plaque', frame: 'none' });

// "Me" is what BOTH backends call an account's first person before anybody names them
// (`db.ensure_default_person`, `local_store.js`), so it is a placeholder, not a name to put on a sign.
const PLACEHOLDER_NAMES = new Set(['me']);
export function signWords(name) {
  const n = String(name || '').trim();
  return n && !PLACEHOLDER_NAMES.has(n.toLowerCase()) ? n : 'Your name';
}

export const kioskURL = (profileId) => `/kiosk.html?profile=${encodeURIComponent(profileId)}`;

export const roomTheme = () => (THEMES[ROOM_THEME] ? ROOM_THEME : DEFAULT_THEME);

/**
 * The game, for one person, over one backend. The backend is four factories — the same ones
 * home.html hands its panels, so signed in and signed out run this identical code:
 *
 *   profiles                         the screens client (server or local)
 *   makeSettings(pid)                a screen's settings doc (theme, layout, ...)
 *   makeInstanceState(pid, id)       one module instance's state (a button's settings)
 *   makePersonState(personId, key)   per-person state
 */
export function createGame({ profiles, makeSettings, makeInstanceState, makePersonState,
                             personId, personName = '' } = {}) {
  if (!profiles || !makeSettings || !makeInstanceState || !makePersonState) {
    throw new Error('createGame: profiles, makeSettings, makeInstanceState and makePersonState are required');
  }
  if (!personId) throw new Error('createGame: a personId is required — the game is a person’s');

  async function withState(handle, fn) {
    await handle.load().catch(() => {});
    try {
      const out = await fn(handle);
      await handle.flush?.();
      return out;
    } finally { handle.destroy?.(); }
  }
  const readState = (handle) => withState(handle, (h) => h.get() || {});

  async function memory() {
    const row = await readState(makePersonState(personId, GAME_KEY));
    return (row && row.profile) || {};
  }
  async function remember(patch) {
    return withState(makePersonState(personId, GAME_KEY), (h) => {
      const cur = (h.get() || {}).profile || {};
      h.set({ profile: { ...cur, ...patch } });
    });
  }

  async function getScreen(pid) {
    if (!pid) return null;
    try {
      const p = await profiles.get(pid);
      // A screen handed to somebody else is not this person's profile any more.
      if (!p || (p.person_id && p.person_id !== personId)) return null;
      return p;
    } catch { return null; }
  }

  // The stamped screen, if the memory lost it. Only screens of this person named "My profile"
  // are even opened, so this costs one settings read in the ordinary case and none at all when
  // the person has never played.
  async function findStamped() {
    let list = [];
    try { list = await profiles.list(personId); } catch { return null; }
    for (const p of list.filter((x) => x.name === PROFILE_NAME)) {
      const s = await readState(makeSettings(p.id));
      if (s && s.game === PROFILE_STAMP) return getScreen(p.id);
    }
    return null;
  }

  async function status() {
    const mem = await memory();
    const screen = (await getScreen(mem.screenId)) || null;
    const ids = new Set(((screen && screen.modules) || []).map((m) => m.id));
    return {
      profileId: screen ? screen.id : null,
      pictureId: screen && ids.has(mem.pictureId) ? mem.pictureId : null,
      signId: screen && ids.has(mem.signId) ? mem.signId : null,
    };
  }

  async function makeProfile() {
    const mem = await memory();
    let screen = await getScreen(mem.screenId);
    if (screen) return { profileId: screen.id, created: false };
    screen = await findStamped();
    if (screen) {
      await remember({ screenId: screen.id });
      return { profileId: screen.id, created: false };
    }
    const made = await profiles.create(PROFILE_NAME, personId);
    // Stamp first, remember second: the stamp is what makes the gap between the two harmless.
    await withState(makeSettings(made.id), (h) => {
      h.set({ theme: roomTheme(), panelSurface: 'clear', game: PROFILE_STAMP });
    });
    await remember({ screenId: made.id, pictureId: null, signId: null });
    return { profileId: made.id, created: true };
  }

  // Put `id` in the layout: its own spot if that spot is free, else the first free one. A layout
  // with no free spot is the person's arrangement and is left alone (the module is still on the
  // screen, reachable from the transport bar, and the composer can place it).
  async function place(profileId, id, preferred, validIds) {
    await withState(makeSettings(profileId), (h) => {
      const cur = h.get() || {};
      const kiosk = cur.kiosk || {};
      const saved = kiosk.layout;
      let lay = isArranged(saved)
        ? normalizeLayout(saved, validIds)
        : normalizeLayout({ preset: PROFILE_LAYOUT, slots: [] }, validIds);
      if (lay.slots.includes(id)) return;
      let at = lay.slots[preferred] === null && preferred < lay.slots.length ? preferred : lay.slots.indexOf(null);
      if (at < 0) return;
      const slots = [...lay.slots];
      slots[at] = id;
      lay = { preset: lay.preset, slots };
      h.set({ kiosk: { ...kiosk, layout: lay } });
    });
  }

  async function addButton(role, start, preferred) {
    const { profileId } = await makeProfile();
    const idKey = role === 'picture' ? 'pictureId' : 'signId';
    const mem = await memory();
    const screen = await getScreen(profileId);
    const ids = ((screen && screen.modules) || []).map((m) => m.id);
    if (mem[idKey] && ids.includes(mem[idKey])) {
      return { id: mem[idKey], profileId, created: false };
    }
    const mod = await profiles.addModule(profileId, 'button');
    // Its starting settings go in BEFORE anything can mount it, then it is remembered, then placed.
    await withState(makeInstanceState(profileId, mod.id), (h) => { h.set({ ...start }); });
    await remember({ [idKey]: mod.id });
    await place(profileId, mod.id, preferred, [...ids, mod.id]);
    return { id: mod.id, profileId, created: true };
  }

  return {
    status,
    makeProfile,
    hangPicture: () => addButton('picture', { ...PICTURE_START }, SLOT.picture),
    putUpSign: () => addButton('sign', { ...SIGN_START, label: signWords(personName) }, SLOT.sign),
    kioskURL,
  };
}
