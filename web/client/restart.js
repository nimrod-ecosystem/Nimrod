// restart.js — what a screen does when the power comes back.
//
// Mike, describing the case this exists for: *"when things go wonky and someone wants to
// cold boot."* Power-cycling is the universal repair, and today it lands you back in
// whatever state was wonky — same screen, first module. There has to be a way to say
// "when this comes back, go somewhere known-good."
//
// THREE HONEST OPTIONS, and no fourth:
//   resume  — where she was, module and all. Best when nothing is wrong.
//   top     — this screen, from the first module. Today's behavior, and the default,
//             because changing what existing screens do on reboot without being asked is
//             not a change anybody consented to.
//   screen  — a NAMED screen, whatever the URL happens to say. The escape hatch.
//
// WHY THIS IS DEVICE-LOCAL AND NOT ON THE SERVER — the one decision here worth arguing.
//
// Everything else in this project belongs to a PERSON and follows them between machines,
// and that is right for bindings, routing and themes. This is the exception, for two
// reasons that both point the same way:
//
//   1. IT MUST BE READABLE FROM WHATEVER SCREEN YOU LAND ON. If "boot to screen A" were
//      stored in screen A's settings, then being stuck on screen B — the actual failure —
//      would be the one situation where the setting cannot be found. A per-screen setting
//      solves the case where nothing is wrong and fails the case it exists for.
//   2. IT IS A RECOVERY PATH, so it has to work when the network does not. A cold boot
//      during an outage is exactly when somebody reaches for this. localStorage is on the
//      disk in the room; the server may as well be on the moon.
//
// The cost is honest and worth stating: a clinician cannot set this remotely. Someone has
// to be standing at the screen. For a repair gesture, that is who is there anyway.
//
// THE POSITION IS ALSO LOCAL, and for a plainer reason: "which module was showing" changes
// every time somebody presses next, and writing that to a server would be a network round
// trip per press, forever, to record something no other device wants to know.

export const MODES = ['resume', 'top', 'screen'];
export const DEFAULT_MODE = 'top';

const KEY = 'nimrod.restart';
// A page that has ALREADY bounced must not bounce again. Two screens each naming the other
// would otherwise ping-pong forever, and a redirect loop on a bedside screen is a black
// screen nobody can explain. sessionStorage is exactly the right lifetime: it survives the
// redirect and dies with the tab, so a real power cycle starts fresh.
const HOP = 'nimrod.restart.hopped';

const readJSON = (store, key) => {
  try { return JSON.parse(store.getItem(key) || 'null'); } catch { return null; }
};

const storeOf = (s) => s || (typeof localStorage !== 'undefined' ? localStorage : null);

// Everything for one account, in one row: { mode, screenId, positions: {profileId: index} }
export function readConfig(user, storage = undefined) {
  const store = storeOf(storage);
  if (!store) return { mode: DEFAULT_MODE, screenId: '', positions: {} };
  const all = readJSON(store, KEY) || {};
  const mine = all[user || ''] || {};
  return {
    mode: MODES.includes(mine.mode) ? mine.mode : DEFAULT_MODE,
    screenId: typeof mine.screenId === 'string' ? mine.screenId : '',
    positions: (mine.positions && typeof mine.positions === 'object') ? { ...mine.positions } : {},
  };
}

export function writeConfig(user, patch, storage = undefined) {
  const store = storeOf(storage);
  const next = { ...readConfig(user, storage), ...patch };
  if (!MODES.includes(next.mode)) next.mode = DEFAULT_MODE;
  if (!store) return next;
  try {
    const all = readJSON(store, KEY) || {};
    all[user || ''] = next;
    store.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode: the setting simply does not persist */ }
  return next;
}

export const readPosition = (user, profileId, storage = undefined) => {
  const n = readConfig(user, storage).positions[profileId];
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export function writePosition(user, profileId, index, storage = undefined) {
  if (!profileId || !Number.isInteger(index) || index < 0) return;
  const cfg = readConfig(user, storage);
  // Written whatever the mode is, so switching to "resume" later does not begin by
  // forgetting where she was.
  writeConfig(user, { positions: { ...cfg.positions, [profileId]: index } }, storage);
}

// PURE. What this page should do, given the config and where it currently is.
//
//   { redirectTo, stageIndex }
//
// `stageCount` clamps a remembered index: a screen can lose modules between boots, and
// restoring position 4 of a 2-module screen is a blank stage.
export function bootPlan({
  config = null,
  currentProfileId = '',
  stageCount = 0,
  hopped = false,
} = {}) {
  const cfg = config || { mode: DEFAULT_MODE, screenId: '', positions: {} };

  if (cfg.mode === 'screen' && cfg.screenId && cfg.screenId !== currentProfileId && !hopped) {
    return { redirectTo: cfg.screenId, stageIndex: 0 };
  }
  if (cfg.mode === 'resume') {
    const want = cfg.positions[currentProfileId];
    const n = Number.isInteger(want) && want >= 0 ? want : 0;
    return { redirectTo: null, stageIndex: stageCount > 0 ? Math.min(n, stageCount - 1) : 0 };
  }
  return { redirectTo: null, stageIndex: 0 };
}

// The hop guard, kept here so the rule and its lifetime live together.
export function markHopped(storage = undefined) {
  const s = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  try { s?.setItem(HOP, '1'); } catch { /* private mode */ }
}
export function hasHopped(storage = undefined) {
  const s = storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  try { return s?.getItem(HOP) === '1'; } catch { return false; }
}

// What the settings menu shows. Kept next to the rules rather than in the kiosk, so the
// wording and the behavior cannot drift apart.
export function restartItems(cfg, { screenName = 'this screen', onChange } = {}) {
  const tick = (m) => (cfg.mode === m ? '✓ ' : '');
  return [
    { kind: 'heading', id: 'restart', label: 'When the power comes back' },
    {
      kind: 'item', id: 'restart-resume', label: `${tick('resume')}Pick up where she left off`,
      run: () => onChange({ mode: 'resume' }),
    },
    {
      kind: 'item', id: 'restart-top', label: `${tick('top')}Start this screen from the top`,
      run: () => onChange({ mode: 'top' }),
    },
    {
      kind: 'item', id: 'restart-screen',
      // Naming the CURRENT screen is the whole gesture: you walk to the one that works and
      // say "come back here". No picker, no list to scan, one press.
      label: `${cfg.mode === 'screen' && cfg.screenId ? '✓ ' : ''}Always come back to ${screenName}`,
      hint: cfg.mode === 'screen' && cfg.screenId ? 'set' : '',
      run: () => onChange({ mode: 'screen' }),
    },
  ];
}
