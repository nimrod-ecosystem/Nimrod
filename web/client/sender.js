// sender.js — WHO PRESSED IT.
//
// Until now a verb on the bus was anonymous. `bus.publish('verb/select')` said WHAT happened
// and never WHO did it, and for a single switch in a single room that was exactly enough.
// Three separate things then turned out to need the missing half, and all three were stuck
// behind it:
//
//   1. MIKE'S RULING — "the driver's input device should act the same as the user's input
//      device; the only restrictions are what's set in the person's section." Remote verbs
//      were published straight onto the screen's bus, DOWNSTREAM of the gate, so the gate
//      could not see them. One place to set restrictions means one rule applied to everyone,
//      and a rule cannot apply to somebody the bus cannot name.
//   2. TAKE THE CURSOR — a driver flips the existing gate to `moderator` to work while a
//      patient is fidgeting. That only works if the driver's own verbs count as moderator,
//      which requires the bus to know they are the driver's.
//   3. A SECOND CURSOR, and therefore two people using one screen at once — a clinician and
//      a patient in the same room on their own devices. A module cannot tell two players
//      apart if every press arrives identical.
//
// WHAT THIS FILE IS NOT: it is not a security boundary. A sender is a LABEL travelling
// alongside a verb on a local bus, and anything already running on this page could forge
// one. The real boundary is upstream and unchanged — the ticket, the grant, and the frozen
// eleven-name allowlist on the wire. This decides what a NAMED party may do once the server
// has already decided they may be here at all.
//
// EVERYTHING HERE IS PURE. The gate rule in particular: it used to live inside `input.js`
// as a closure over the current gate, which meant the only way to test "may this role act"
// was to build an input bus. It is now a function of its arguments, hammered on its own,
// and the local path and the remote path call THE SAME ONE — which is the only way Mike's
// "one place for restrictions" can actually be true rather than merely intended.

// THE VOCABULARY LIVES HERE, and `input.js` re-exports it. It was the other way round for
// about ten minutes and made a CYCLE - input.js needs the gate rule, the gate rule needs the
// role names. ES modules survive that on live bindings, which is exactly the kind of thing
// that works until somebody reorders an import. So the words moved DOWN to the layer that
// only knows about words, and every existing importer is unaffected.
export const ROLES = ['moderator', 'participant', 'universal'];  // what a binding IS
export const GATES = ['both', 'moderator', 'participant'];       // who may act right now

// A sender is one of these. `system` covers anything the software did on its own behalf —
// a watchdog auto-release, a timer — because "nobody pressed this" is a real answer and
// blaming it on the person at the screen would send somebody hunting for a broken switch.
export const SENDER_KINDS = ['local', 'remote', 'system'];

export const DEFAULT_REMOTE_ROLE = 'moderator';

// The sender assumed when a publisher says nothing. It is `local` and `universal` on
// purpose: every verb published before this file existed came from a control in the room,
// and a default that quietly started FAILING the gate would break every existing screen at
// once. Silence means "the way it has always worked".
export const UNKNOWN_SENDER = Object.freeze({
  kind: 'local', id: '', label: 'someone at the screen', role: 'universal',
});

// ---------------------------------------------------------------------------------------
// normalizeSender — never throws, always returns something usable.
//
// A malformed sender must not be able to stop a press. The failure mode of being strict here
// is a switch that stops working, and there is no version of this feature worth that.
// ---------------------------------------------------------------------------------------
export function normalizeSender(raw) {
  if (!raw || typeof raw !== 'object') return { ...UNKNOWN_SENDER };
  const kind = SENDER_KINDS.includes(raw.kind) ? raw.kind : 'local';
  const role = ROLES.includes(raw.role)
    ? raw.role
    : (kind === 'remote' ? DEFAULT_REMOTE_ROLE : UNKNOWN_SENDER.role);
  const id = raw.id == null ? '' : String(raw.id);
  return {
    kind,
    id,
    label: String(raw.label || id || UNKNOWN_SENDER.label),
    role,
  };
}

// The meta object a publisher attaches. Kept as its own shape rather than merged into the
// payload because a payload belongs to whoever declared the topic — a module's `photos/next`
// payload is the module's business, and quietly adding a key to it would be reaching into
// somebody else's data.
export function senderMeta(raw) { return { from: normalizeSender(raw) }; }

// Read it back off whatever a sink was handed. Anything unrecognised reads as the unknown
// local sender, so a module written before senders existed behaves exactly as it did.
export function senderOf(meta) {
  return normalizeSender(meta && typeof meta === 'object' ? meta.from : null);
}

// ---------------------------------------------------------------------------------------
// gatePermits — MAY THIS ROLE ACT RIGHT NOW.
//
// Lifted verbatim out of `input.js`, where it was a closure and therefore untestable on its
// own. Same three rules, same order, and now one implementation that both a switch in the
// room and a driver two hundred miles away are judged by.
//
//   `universal`  a binding that is nobody's in particular — always allowed
//   `both`       the gate is open — everyone allowed
//   otherwise    the role must BE the gate
//
// `exempt` is the escape hatch that keeps the lock from becoming a trap: the gate control
// itself is never gated. Bind role-cycle as `participant`, switch the gate to moderator-only
// and without this a caregiver is locked out of their own lock, with the control that would
// undo it sitting on the wrong side of the door.
// ---------------------------------------------------------------------------------------
export function gatePermits(gate, role, { exempt = false } = {}) {
  if (exempt) return true;
  if (role === 'universal') return true;
  if (!GATES.includes(gate)) return true;   // an unknown gate is an open one, never a lockout
  if (gate === 'both') return true;
  return role === gate;
}

// A phrase for a log line or a notice. The remote case NAMES somebody, because "the gate
// refused it" and "the gate refused the OT" are different sentences to a person trying to
// work out why the screen is not responding.
export function describeSender(from) {
  const s = normalizeSender(from);
  if (s.kind === 'system') return s.label === UNKNOWN_SENDER.label ? 'the software itself' : s.label;
  if (s.kind === 'remote') return s.id ? `${s.label} (from another screen)` : 'somebody driving remotely';
  return s.label;
}
