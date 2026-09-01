// connections.js — WHAT ELSE THIS CAN TALK TO, and the one place you go to find out.
//
// Mike's design, and the third sentence is the one that makes the first two safe:
//
//   *"Maybe complete tabs like the state machine should be hidden behind the power user
//   setting. And tabs involving optional things like VPN, HA, and AI should be hidden unless
//   you connect them. Maybe have a connections tab or something so people will see them and
//   know they are an option."*
//
// ---------------------------------------------------------------------------------------
// WHY THE THIRD SENTENCE IS LOAD-BEARING.
//
// Hiding a feature until it is connected is obviously right for a first run - a caregiver
// setting up a bedside screen should not have to scroll past a Home Assistant tab. But hiding
// something means NOBODY EVER LEARNS IT EXISTS, and "nobody used it" then gets diagnosed as
// "they did not want it" rather than "they never saw it".
//
// THAT IS THE WAYFINDER FAILURE EXACTLY: the product worked, the setup cost fell on somebody
// tired, and it looked like a demand problem when it was a discovery problem. A Connections
// page is the fix - ONE PLACE THAT LISTS EVERYTHING, CONNECTED OR NOT - and it is what lets
// every other tab hide without anything becoming a secret.
//
// So there are three visibility rules and they are deliberately different:
//
//   BY LEVEL       `advanced` hides a whole area from people who do not want it. The state
//                  machine, precedence sequences, recovery ladders.
//   BY CONNECTION  hidden until the integration exists at all. Home Assistant, an AI, a
//                  direct link. This is `requires`, extended from a marking on a FIELD to a
//                  visibility rule on an AREA.
//   ALWAYS         Home, Close, and anything that is the way out. Safety invariant, and this
//                  file must never be able to touch them - see `visibleAreas`.
//
// ---------------------------------------------------------------------------------------
// A CONNECTION IS NOT A SETTING, and keeping them separate is what stops this becoming a
// second settings system. A connection answers "is this thing reachable"; everything you might
// then CONFIGURE about it lives in that integration's own area, hidden until it is.
//
// EVERYTHING HERE IS PURE. The catalog is data, the rules are functions of their arguments,
// and the page renders whatever it is handed. Nothing probes anything - a host supplies the
// live status, because "can I reach Home Assistant right now" is a runtime question with a
// network in it.

export const CONNECTION_STATES = ['connected', 'available', 'unavailable'];

// `available`   we know how to talk to it, nobody has set it up
// `connected`   set up and reachable
// `unavailable` set up but NOT reachable right now — which is a different sentence from
//               "you have not set this up", and merging them is how somebody spends an
//               evening re-entering credentials that were already correct.
export const DEFAULT_STATE = 'available';

// THE CATALOG. Data, so a new integration is a row rather than a screen. `area` is the id
// of the settings area it reveals, which is the whole hide-until-connected mechanism.
export const CONNECTIONS = [
  {
    id: 'media-agent',
    title: 'Your own photos and videos',
    area: 'media',
    blurb: 'A folder on your own computer or drive. The platform never holds your media — it '
      + 'stores a pointer, and the bytes come straight from you.',
    // The one thing on this list that a bedside screen genuinely needs, which is why it is
    // first and why it is not `advanced`.
    level: 'standard',
  },
  {
    id: 'direct',
    title: 'A direct link between devices',
    area: 'direct',
    blurb: 'A VPN or tailnet, so two of your devices can reach each other without going '
      + 'through the platform. Needed for seeing a screen live.',
    level: 'advanced',
  },
  {
    id: 'home-assistant',
    title: 'Home Assistant',
    area: 'home-assistant',
    blurb: 'Lights, blinds, a doorbell. Once connected, these become things a switch can do — '
      + 'the same switch, the same bindings.',
    level: 'advanced',
  },
  {
    id: 'ai',
    title: 'An AI you have connected',
    area: 'ai',
    blurb: 'Used for checking a shared module before you install it, and for writing plain '
      + 'summaries. It advises; it never decides.',
    level: 'advanced',
  },
  {
    id: 'logger',
    title: 'A wearable or chair logger',
    area: 'logger',
    blurb: 'A small device that records and hands its data over when it is in range.',
    level: 'advanced',
  },
];

const byId = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c]));
export const connectionById = (id) => byId[id] || null;

export function normalizeState(s) {
  return CONNECTION_STATES.includes(s) ? s : DEFAULT_STATE;
}

// The catalog with live status folded in. `states` is `{ id: state }` from the host.
export function connectionList(states = {}) {
  return CONNECTIONS.map((c) => ({
    ...c,
    state: normalizeState((states || {})[c.id]),
  }));
}

export const isConnected = (id, states = {}) => normalizeState((states || {})[id]) === 'connected';

// ---------------------------------------------------------------------------------------
// visibleAreas — the three rules, applied.
//
// An area declares `{ id, label, level?, requires? }`. `requires` names a connection id.
//
// *** THE SAFETY INVARIANT LIVES HERE, and it is allowed to be absolute: an area marked
// `always: true` is NEVER hidden, by any rule, at any level, connected or not. *** Home,
// Close and the way out are the reason. A stripped-down mode that hides the exit is a trap,
// and the filter that could spring it is this function, so the guard belongs in it.
// ---------------------------------------------------------------------------------------
export function visibleAreas(areas = [], { level = 'standard', states = {} } = {}) {
  const rank = { essential: 0, standard: 1, advanced: 2 };
  const at = rank[level] ?? 1;
  return (areas || []).filter((a) => {
    if (!a || !a.id) return false;
    if (a.always) return true;                       // never hidden, by anything
    if ((rank[a.level] ?? 1) > at) return false;     // too advanced for this level
    if (a.requires && !isConnected(a.requires, states)) return false;
    return true;
  });
}

// Why an area is not being shown. Exists so the answer is never a shrug: a person who was told
// about Home Assistant and cannot find it should be able to learn that it is one step away,
// not conclude the product does not have it.
export function whyHidden(area, { level = 'standard', states = {} } = {}) {
  if (!area || !area.id) return 'no such area';
  if (area.always) return null;
  const rank = { essential: 0, standard: 1, advanced: 2 };
  if ((rank[area.level] ?? 1) > (rank[level] ?? 1)) {
    return `shown at the “${area.level}” level — this screen is set to “${level}”`;
  }
  if (area.requires && !isConnected(area.requires, states)) {
    const c = connectionById(area.requires);
    return `needs ${c ? c.title : area.requires} — set it up under Connections`;
  }
  return null;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATE_WORD = {
  // SHAPE PLUS COLOR, NEVER COLOR ALONE — the mark carries it as well as the tint, because
  // these are small and this screen belongs to somebody with a brain injury.
  connected: { mark: '●', word: 'Connected' },
  available: { mark: '○', word: 'Not set up' },
  unavailable: { mark: '⚠', word: 'Set up, but not reachable right now' },
};

// ---------------------------------------------------------------------------------------
// renderConnections — the page. Deliberately plain, and it lists EVERYTHING.
//
// Nothing here is filtered by level. That is the entire point: this is the one place where a
// person sees what the product can do, whether or not they have any of it. Filtering this
// page would put the discovery problem back exactly where it was.
// ---------------------------------------------------------------------------------------
export function renderConnections(el, { states = {}, level = 'standard' } = {}) {
  const rows = connectionList(states);
  const on = rows.filter((r) => r.state === 'connected').length;
  el.innerHTML = `
    <p class="cx-lead">${on
      ? `${on} of ${rows.length} connected. Everything here is optional.`
      : 'Nothing is connected yet, and none of it is required. This list is here so you know '
        + 'what is possible.'}</p>
    <ul class="cx-list">${rows.map((r) => {
      const s = STATE_WORD[r.state];
      return `<li class="cx cx-${r.state}">
        <span class="cx-mark" aria-hidden="true">${s.mark}</span>
        <span class="cx-body">
          <span class="cx-title">${esc(r.title)}</span>
          <span class="cx-state">${esc(s.word)}</span>
          <span class="cx-blurb">${esc(r.blurb)}</span>
        </span></li>`;
    }).join('')}</ul>
    <p class="cx-foot">Connecting one of these adds its own settings. Nothing is hidden from
      you here — only from the everyday menu, so it stays short.</p>`;
  return { rows, connected: on, level };
}

// Ready to hand to the settings menu, the same shape `controlPages` returns.
export function connectionsPage({ states = () => ({}), level = () => 'standard' } = {}) {
  return {
    title: 'Connections',
    render: (el) => renderConnections(el, { states: states(), level: level() }),
  };
}

// The menu row that opens it. ALWAYS PRESENT, at every level, because a page that is itself
// hidden until you are advanced enough would defeat its own purpose.
export const CONNECTION_ITEMS = [
  { kind: 'heading', id: 'connections-head', label: 'Connections' },
  { kind: 'item', id: 'connections', label: 'What else this can talk to', page: 'connections' },
];
