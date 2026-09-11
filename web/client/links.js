// links.js — DATA LINKS: the third bus's message format.
//
// `docs/glossary.md` names the word; `docs/architecture.md` names the bus; this is what
// actually rides it. A data link is the spreadsheet-cell-reference sense — one module's
// number, text, time or picture appears as another module's property, continuously, the way
// `=B2` shows B2's value and keeps showing it. Not one thing running after another; one thing
// SHOWING another. See `bus_and_generator_20260910.md` §1.3-1.5 for the reasoning; this file
// is the primitives it argues for, nothing more — no patch-bay UI, no module wired with real
// ports yet. Those are later, separate work, not blocked on anything here.
//
// CONDITIONING IS A SEPARATE FILE, `conditioning.js` — the wire-transform family (debounce/
// hold/lockout for event-class, the unchanged-value guard/rate-limiting for continuous), kept
// apart from the message shapes here the same way `input.js`'s conditioning is kept apart
// from `bus.js`'s own transport. A sender applies the class-appropriate conditioner before
// calling `wrapValue`/`linkTopic` below; neither file needs to import the other to do that.
//
// THE SPLIT THAT MATTERS MOST: a LINK is structural, a VALUE is runtime.
//
//   link   {from: {instance, port}, to: {instance, port}}   — WHAT is wired to what.
//          No value. Enters the composition fingerprint (a different converter is a
//          different patch), the same way a prefab override does. Inspectable with no
//          traffic flowing at all.
//   value  {value, timestamp, class, provenance, edge?, seq?}   — what is CURRENTLY on the
//          wire. Runtime, enters nothing, and a data link with no value flowing over it yet
//          is still a real, recorded link — the same way an unset binding is still a real row.
//
// Keeping the two apart is what lets a link be inspected without traffic and traffic be
// recorded without a link — a verb from a switch has no link at all; it has a binding.
//
// INSTANCE ADDRESSING IS WHAT MAKES THIS POSSIBLE. `bus.js`'s `scope(instanceId)` and
// `instanceTopic` (2026-09-10) turn `(instance, port)` into a real, addressable topic string
// instead of a type-wide broadcast — built first, in the same session, because a data link
// could not exist without it. `linkTopic` below is the one place that fact is used.

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// The whole vocabulary a port's `type` can be, matching Mike's own list exactly rather than
// inventing a bigger one: "one module's number, text, time or picture". `boolean` is not
// separate — a boolean is a number with a two-value range (see `normalizePort`'s `range`),
// the same way Eurorack has no separate "gate" jack type, only a voltage read as one.
export const PORT_TYPES = ['number', 'text', 'image', 'time'];
export const PORT_CLASSES = ['event', 'continuous'];
export const PORT_DIRECTIONS = ['in', 'out'];
// How many links may terminate on a port — the gap the convergent-structure research named:
// shape 4 (kind + direction) said nothing about cardinality, which chemistry's valence and
// every wiring standard treat as load-bearing. 'one' (the conservative default — a single
// source of truth, the common case) or 'many' (fan-in, which needs a declared combine rule to
// mean anything — summing, last-write-wins, whatever a future merge node states explicitly).
// DECLARED ONLY, NOT ENFORCED HERE — no module is wired with real ports yet (see the file
// header), so there is nothing yet that would refuse a second link to a 'one' port. That
// enforcement is the same "later, separate work" the header already names for the patch bay.
export const PORT_CARDINALITIES = ['one', 'many'];

// ---------------------------------------------------------------------------------------
// normalizePort — one declaration in, one usable port out (or null).
//
// A BAD DECLARATION IS DROPPED, NEVER THROWN — the same rule `settings_fields.js`'s
// `normalizeField` states for exactly the same reason: one module's malformed port must not
// take a whole manifest down with it.
//
// `range` is REQUIRED for a continuous `number` port and meaningless for anything else —
// §1.3 item 8: "range on the type, for continuous values... Declare the range on the port, so
// the default transform is identity" (or a linear map, between two number ports). A number
// port with no range is dropped rather than silently treated as 0..1, because a wrong
// assumed range is a wrong-sounding patch that looks correct until somebody checks the
// numbers.
// ---------------------------------------------------------------------------------------
export function normalizePort(raw) {
  const id = String(raw?.id || '').trim();
  if (!ID_RE.test(id)) return null;
  if (!PORT_TYPES.includes(raw?.type)) return null;
  if (!PORT_CLASSES.includes(raw?.class)) return null;
  const direction = PORT_DIRECTIONS.includes(raw?.direction) ? raw.direction : null;
  if (!direction) return null;
  let range = null;
  if (raw.type === 'number' && raw.class === 'continuous') {
    const lo = Number(raw?.range?.[0]);
    const hi = Number(raw?.range?.[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
    range = [lo, hi];
  }
  // Unspecified means 'one' — the conservative reading, matching "off by default, available
  // to anybody who declares otherwise" — never a silent 'many' nobody asked for.
  const cardinality = PORT_CARDINALITIES.includes(raw?.cardinality) ? raw.cardinality : 'one';
  return {
    id,
    label: String(raw.label || id),
    direction,
    class: raw.class,
    type: raw.type,
    range,
    cardinality,
  };
}

// A manifest's declared ports, normalized and de-duplicated by id. Bad rows drop silently,
// same reasoning as `normalizePort` itself.
export function portsFor(manifest) {
  const seen = new Set();
  const out = [];
  for (const raw of manifest?.ports || []) {
    const p = normalizePort(raw);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// normalizeLink — the structural record. NO VALUE FIELD EXISTS ON THIS TYPE, ON PURPOSE —
// see the file header. `{from: {instance, port}, to: {instance, port}}`, and nothing else
// belongs here: not a transform, not a timestamp, not who is currently the source of truth.
// Bad rows return null, same convention as every other `normalize*` in this codebase.
// ---------------------------------------------------------------------------------------
function normalizeEndpoint(raw) {
  const instance = String(raw?.instance || '').trim();
  const port = String(raw?.port || '').trim();
  if (!instance || !port) return null;
  return { instance, port };
}

export function normalizeLink(raw) {
  const from = normalizeEndpoint(raw?.from);
  const to = normalizeEndpoint(raw?.to);
  if (!from || !to) return null;
  // A link from a port to ITSELF is not a link, it is a typo — nothing patches a value into
  // its own source, and the cycle guard this would otherwise need to catch is cheaper to
  // simply refuse outright.
  if (from.instance === to.instance && from.port === to.port) return null;
  return { from, to };
}

// The bus topic a link's VALUE actually rides on. Reuses instance addressing (`bus.js`
// `instanceTopic`) rather than inventing a second addressing scheme — an (instance, port)
// pair IS the thing instance addressing exists to make real. `link/` prefixes the port name
// so a data-link value can never collide with a verb topic on the same instance (a module's
// `next` port, if it ever had one, would be `link/next#id`, never bare `next#id`).
export function linkTopic(bus, endpoint) {
  return bus.instanceTopic(endpoint.instance, `link/${endpoint.port}`);
}

// ---------------------------------------------------------------------------------------
// classifyPatch — TYPE AS HINT OR GATE (§1.4).
//
// Three rules, in the order they must be checked:
//
//   1. continuous -> event is not automatic, ever. THE SAFETY GATE (§1.4 item 3): a
//      continuous value crossing a threshold to produce a verb — exactly how dwell already
//      works — must stay possible, but only through a DECLARED edge-detector node in the
//      chain, never an implicit "number > 0.5 fires the verb". The safety-invariant lint has
//      to know everything that CAN produce a verb; an implicit threshold on an arbitrary
//      patch makes that unknowable. Returned as a gate, not silently allowed.
//   2. event -> continuous is the mirror image and gated the same way, through a declared
//      hold-or-latch node — an event has no value to hold between occurrences on its own.
//   3. Otherwise, type decides. number -> number is ALWAYS meaningful (§1.4 item 1) — the
//      unit is shared, so scaling is the only transform ever needed: identity when the
//      ranges already match, a linear map when they don't. Any other matching type
//      (text -> text, image -> image, time -> time) is a direct pass-through. A MISMATCHED
//      pair with no default (number -> text, image -> anything) has no free transform, and
//      is returned disabled with a reason rather than omitted — "present, disabled, with a
//      reason, never absent" is `settings_fields.js`'s own rule for a control that cannot be
//      cycled, applied here to a link that cannot be drawn live.
//
// Returns `{ok, reason?, transform?, from?, to?}` — never throws, so a malformed port pair
// reads as "needs a converter" rather than crashing whatever is asking.
// ---------------------------------------------------------------------------------------
export function classifyPatch(fromPort, toPort) {
  if (!fromPort || !toPort) return { ok: false, reason: 'needs-converter' };

  if (fromPort.class === 'continuous' && toPort.class === 'event') {
    return { ok: false, reason: 'needs-edge-node' };
  }
  if (fromPort.class === 'event' && toPort.class === 'continuous') {
    return { ok: false, reason: 'needs-hold-node' };
  }

  if (fromPort.type === 'number' && toPort.type === 'number') {
    const same = !!fromPort.range && !!toPort.range
      && fromPort.range[0] === toPort.range[0] && fromPort.range[1] === toPort.range[1];
    return {
      ok: true,
      transform: same ? 'identity' : 'linear-range',
      from: fromPort.range || null,
      to: toPort.range || null,
    };
  }

  if (fromPort.type === toPort.type) return { ok: true, transform: 'identity' };

  return { ok: false, reason: 'needs-converter' };
}

// A linear map from one number range onto another — the ONE default transform §1.4 item 1
// argues for. Clamped: a value arriving outside its declared range is a sending bug, and a
// clamped-but-visible number is a better failure than a difficulty dial reading 11.
export function mapRange(value, from, to) {
  const n = Number(value);
  if (!Number.isFinite(n) || !from || !to) return n;
  const [flo, fhi] = from, [tlo, thi] = to;
  if (fhi === flo) return tlo;
  const t = (n - flo) / (fhi - flo);
  const clamped = Math.max(0, Math.min(1, t));
  return tlo + clamped * (thi - tlo);
}

// ---------------------------------------------------------------------------------------
// The value envelope — what actually flows over a link's topic. §1.3 items 2, 5-8.
//
//   value        the payload itself, already in the SINK port's declared range where the
//                link is a number->number patch (the caller applies `mapRange` before
//                calling this — wrapValue does not reach into `classifyPatch` itself, so a
//                data link and a plain bus publish that happens to reuse this shape stay
//                the same function).
//   timestamp    the SOURCE's own timestamp, decided 2026-08-30 — "a rhythm game cares
//                *when*, not only *what*, and a sink using arrival time cannot recover the
//                source's timing afterwards." Defaults to `Date.now()` at the point of
//                origin, i.e. wherever `wrapValue` is actually called — which is correct
//                exactly because a link's source is where this function should be called
//                FROM, not a relay further down the chain re-stamping it.
//   class        'event' | 'continuous', carried on the message as well as declared on the
//                port (§1.3 item 6) — the field a sink like the music module reads to decide
//                "smooth this one, latch that one" without re-deriving it from the port.
//   provenance   a PATH, not a point (§1.3 item 4) — see `appendProvenance`.
//   edge         event-class only: 'press' | 'release', when the source is itself an edge.
//   seq          event-class only: a per-source monotonic counter (§1.3 item 7) — lets a
//                sink drop a duplicate delivered twice over a lossy hop (a polled mailbox, a
//                stalled data channel) instead of, say, a board saying a word twice.
// ---------------------------------------------------------------------------------------
export function wrapValue({ value, class: cls, provenance = [], edge = undefined, seq = undefined,
                             timestamp = Date.now() }) {
  const out = { value, timestamp, class: PORT_CLASSES.includes(cls) ? cls : 'continuous',
                provenance: [...provenance] };
  if (cls === 'event') {
    if (edge === 'press' || edge === 'release') out.edge = edge;
    if (Number.isFinite(seq)) out.seq = seq;
  }
  return out;
}

// appendProvenance — the one rule from `bus.js` (a transform may not rewrite `meta.from`)
// generalised to a chain: a transform may APPEND a hop and nothing may overwrite what is
// already there. `hop` is `{source, transform}` — an instance/port pair or a device id, plus
// what it did on the way through (`'identity'`, `'linear-range'`, a converter's own name).
// Returns a NEW array; the input is never mutated, so a value already published elsewhere
// cannot be corrupted by a later hop's own bookkeeping.
export function appendProvenance(provenance, hop) {
  return [...(provenance || []), { ...hop }];
}

// A per-source sequence counter, event-class only (§1.3 item 7) — continuous values don't
// need one, because latest-wins makes a dropped or duplicated delivery harmless. One counter
// per distinct source id, so two sources on the same link don't stomp each other's numbering.
export function createSequencer() {
  const counters = new Map();
  return {
    next(sourceId) {
      const n = (counters.get(sourceId) || 0) + 1;
      counters.set(sourceId, n);
      return n;
    },
  };
}
