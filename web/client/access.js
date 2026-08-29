// access.js - the ACCESS stream: how the input itself performed, activation by activation.
//
// The third sibling of points.js (what someone EARNED) and telemetry.js (what someone DID).
// This one records whether the machine even HEARD them: every activation the input bus
// decided on, accepted or rejected, with the reason.
//
// WHY REJECTIONS ARE THE POINT. A press that debounce swallowed, a hold released too
// early, a switch that stuck and had to be auto-released - those are not errors to be
// silently absorbed, they are the measurement. False-activation rate is a metric nobody
// in this field collects, because the systems that could collect it treat a filtered
// press as nothing happening. Here it is an event with a name.
//
// TWO STREAMS, BUILT APART ON PURPOSE:
//
//   LOCAL   rich, complete, yours. Device instance names, control names, timestamps.
//           Never leaves the machine.
//   OUTBOUND  the opt-in research payload. Built field by field from an ALLOWLIST,
//           from scratch, and dropped entirely if any field fails its check.
//
// The split is here from the first commit rather than retrofitted, because retrofitting
// it is how PII leaks: a redact-and-continue filter over a rich record ships whatever
// field nobody thought to add to the deny list. toOutbound() cannot do that - it never
// sees the local record's shape, it only asks for the fields it knows by name, validates
// each one, and returns null if anything is off. FAIL CLOSED, not redact and continue.
//
// THREE FIELDS DELIBERATELY NOT SENT, and the reasoning, so a later change is a decision
// and not an oversight:
//   * `control`  - on a keyboard this is which key. Bound keys only, never free typing,
//                  but it is still keystroke data and it answers no research question
//                  that `deviceClass` does not.
//   * `device`   - the instance ("hid:0x1234 Acme Switch Pro") can carry a product
//                  string. `deviceClass` carries the part that matters.
//   * `at`       - an absolute timestamp is quasi-identifying the moment it is joined
//                  with anything else. Time-of-day IS a stated research question, so a
//                  coarse `daypart` goes instead, computed from the DEFAULT boundaries
//                  and never from a profile's own (renameable, free-text) daypart list.
//
// VOLUME. A trial is a sentence; an activation is a keystroke. Someone scanning a grid
// generates them by the hundred, so unlike createTelemetry this does NOT append one at a
// time - it buffers in memory (where the live metrics read from) and flushes in batches.

import { daypartAt, DEFAULT_DAYPARTS } from './daypart.js';
import { REJECTIONS, PHASES } from './input.js';

export const ACCESS_STREAM  = 'access';             // well-known shared stream key
export const ACCESS_TOPIC   = 'access/logged';      // bus topic - live nudge, NOT the record
export const ACTIVATION_KIND = 'activation';

// ---------------------------------------------------------------------------------
// The outbound allowlist. Adding a field here is a privacy decision; make it loudly.
// ---------------------------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9._/-]{0,63}$/;
const SESSION_RE = /^[a-f0-9-]{8,64}$/;
const DAYPARTS = DEFAULT_DAYPARTS.map((d) => d.name);
const ok = (v) => v !== undefined && v !== null;
const inSet = (set) => (v) => set.includes(v);
const ms = (max) => (v) => Number.isFinite(v) && v >= 0 && v <= max;

export const OUTBOUND_FIELDS = {
  session:     { required: true,  check: (v) => typeof v === 'string' && SESSION_RE.test(v) },
  seq:         { required: true,  check: (v) => Number.isInteger(v) && v >= 0 },
  actionId:    { required: false, check: (v) => typeof v === 'string' && ID_RE.test(v) },
  deviceClass: { required: true,  check: inSet(['gamepad', 'keyboard', 'switch', 'hid', 'serial', 'bluetooth', 'pointer', 'other']) },
  edge:        { required: false, check: inSet(['press', 'release']) },
  role:        { required: false, check: inSet(['moderator', 'participant', 'universal']) },
  gate:        { required: true,  check: inSet(['both', 'moderator', 'participant']) },
  accepted:    { required: true,  check: (v) => typeof v === 'boolean' },
  reason:      { required: false, check: inSet(REJECTIONS) },
  heldMs:      { required: false, check: ms(600000) },
  latencyMs:   { required: false, check: ms(600000) },
  daypart:     { required: true,  check: inSet(DAYPARTS) },
};

// Build the research payload for ONE local record. Returns null - the whole event is
// dropped - if any allowlisted field is present but fails its check, or any required
// field is missing. An optional field that is absent is simply absent; an optional field
// that is present and WRONG kills the event, because "wrong" is where surprises live.
export function toOutbound(rec, { session, seq, dayparts = DEFAULT_DAYPARTS } = {}) {
  if (!rec || typeof rec !== 'object') return null;

  // Derived, never copied: computing these here is what keeps a renamed profile daypart
  // or a raw device string from reaching the payload at all.
  const source = {
    session,
    seq,
    actionId: rec.actionId ?? undefined,
    deviceClass: rec.deviceClass,
    edge: rec.edge ?? undefined,
    role: rec.role ?? undefined,
    gate: rec.gate,
    accepted: rec.accepted,
    reason: rec.reason ?? undefined,
    heldMs: ok(rec.heldMs) ? Number(rec.heldMs) : undefined,
    latencyMs: ok(rec.latencyMs) ? Number(rec.latencyMs) : undefined,
    daypart: Number.isFinite(rec.at) ? daypartAt(rec.at, dayparts) : undefined,
  };

  const out = {};
  for (const [field, spec] of Object.entries(OUTBOUND_FIELDS)) {
    const v = source[field];
    if (v === undefined) {
      if (spec.required) return null;      // missing something we promised - drop it
      continue;
    }
    if (!spec.check(v)) return null;       // present and unexpected - drop it
    out[field] = v;
  }
  return out;
}

export function toOutboundBatch(records, { session, dayparts = DEFAULT_DAYPARTS } = {}) {
  const out = [];
  (records || []).forEach((rec, i) => {
    const row = toOutbound(rec, { session, seq: i, dayparts });
    if (row) out.push(row);
  });
  return out;
}

// ---------------------------------------------------------------------------------
// THE EDGE STREAM - what the hand did, kept in its own ring with its own allowlist.
//
// WHY NOT THE SAME RING. `summarize` and `falseActivationRate` read `accepted`, and an edge
// record does not have one - so `isRejected` would be true for every edge and the false
// activation rate, the one metric nobody else in this field collects, would silently become
// nonsense. Two kinds of record in one list is how that happens quietly.
//
// SAME THREE EXCLUSIONS AS THE ACTIVATION PAYLOAD, for the same reasons: no `control` (on a
// keyboard that is which key), no `device` instance (it can carry a product string), no
// absolute `at` (quasi-identifying once joined with anything else - `daypart` goes instead).
//
// WHAT IS NEW ON THE WIRE, and it is a real privacy decision made loudly: how long a person
// held a control, and whether they let go on their own. Mike, 2026-08-29: "yes, it should be
// tracked." It is still the OPT-IN research payload - nothing leaves a machine because this
// list exists, only because somebody turned the payload on.
// ---------------------------------------------------------------------------------

export const EDGE_KIND = 'edge';

export const EDGE_OUTBOUND_FIELDS = {
  session:     { required: true,  check: (v) => typeof v === 'string' && SESSION_RE.test(v) },
  seq:         { required: true,  check: (v) => Number.isInteger(v) && v >= 0 },
  deviceClass: { required: true,  check: inSet(['gamepad', 'keyboard', 'switch', 'hid', 'serial', 'bluetooth', 'pointer', 'other']) },
  phase:       { required: true,  check: inSet(PHASES) },
  // Absent on a down by design; present and impossible kills the row.
  heldMs:      { required: false, check: ms(600000) },
  // What the configuration demanded. Without it `heldMs` conflates "held because it was asked
  // for" with "held because letting go was hard", which are opposite findings.
  requiredHoldMs: { required: false, check: ms(600000) },
  auto:        { required: true,  check: (v) => typeof v === 'boolean' },
  bound:       { required: true,  check: (v) => typeof v === 'boolean' },
  concurrent:  { required: false, check: (v) => Number.isInteger(v) && v >= 0 && v <= 32 },
  daypart:     { required: true,  check: inSet(DAYPARTS) },
};

export function toOutboundEdge(rec, { session, seq, dayparts = DEFAULT_DAYPARTS } = {}) {
  if (!rec || typeof rec !== 'object') return null;
  const source = {
    session,
    seq,
    deviceClass: rec.deviceClass,
    phase: rec.phase,
    heldMs: ok(rec.heldMs) ? Number(rec.heldMs) : undefined,
    requiredHoldMs: ok(rec.requiredHoldMs) ? Number(rec.requiredHoldMs) : undefined,
    auto: rec.auto,
    bound: rec.bound,
    concurrent: ok(rec.concurrent) ? Number(rec.concurrent) : undefined,
    daypart: Number.isFinite(rec.at) ? daypartAt(rec.at, dayparts) : undefined,
  };
  const out = {};
  for (const [field, spec] of Object.entries(EDGE_OUTBOUND_FIELDS)) {
    const v = source[field];
    if (v === undefined) {
      if (spec.required) return null;
      continue;
    }
    if (!spec.check(v)) return null;
    out[field] = v;
  }
  return out;
}

export function toOutboundEdgeBatch(records, { session, dayparts = DEFAULT_DAYPARTS } = {}) {
  const out = [];
  (records || []).forEach((rec, i) => {
    const row = toOutboundEdge(rec, { session, seq: i, dayparts });
    if (row) out.push(row);
  });
  return out;
}

// ---------------------------------------------------------------------------------
// Metrics, derived from the local records. Same posture as telemetry.js: nothing here
// is a stored total, everything derives from the stream.
// ---------------------------------------------------------------------------------

export const isRejected = (r) => !r.accepted;
export const isAttributed = (r) => !!r.actionId;   // an `unbound` press names no action

export function summarize(list) {
  const rows = list || [];
  const total = rows.length;
  const accepted = rows.filter((r) => r.accepted).length;
  const rejected = total - accepted;
  const lat = rows.filter((r) => r.accepted && Number.isFinite(r.latencyMs)).map((r) => r.latencyMs);
  return {
    total,
    accepted,
    rejected,
    // The headline number. Of everything the person did, what share did the system
    // decline to act on?
    falseActivationRate: total ? rejected / total : null,
    medianLatencyMs: median(lat),
    // Day-to-day variability is the thing point-in-time assessment misses, so spread
    // travels alongside the mean rather than being derivable-in-principle.
    latencySpreadMs: lat.length > 1 ? iqr(lat) : null,
  };
}

export function falseActivationRate(list) { return summarize(list).falseActivationRate; }

const tally = (list, keyOf) => {
  const out = new Map();
  for (const r of list || []) {
    const k = keyOf(r);
    if (k == null) continue;
    if (!out.has(k)) out.set(k, { key: k, total: 0, accepted: 0, rejected: 0 });
    const e = out.get(k);
    e.total++;
    r.accepted ? e.accepted++ : e.rejected++;
  }
  return [...out.values()].sort((a, b) => b.total - a.total);
};

export const byReason = (list) => tally((list || []).filter(isRejected), (r) => r.reason);
export const byDevice = (list) => tally(list, (r) => r.deviceClass);
export const byAction = (list) => tally(list, (r) => r.actionId);

function median(xs) {
  if (!xs || !xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function iqr(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return q(0.75) - q(0.25);
}

// ---------------------------------------------------------------------------------
// The log itself.
// ---------------------------------------------------------------------------------

export function createAccessLog({
  makeEvents = null,          // optional durable sink; omit and the log is memory-only
  bus = null,
  session = null,
  cap = 2000,                 // in-memory ring - what the live metrics read
  batchSize = 50,             // flush after this many, or on flush()/destroy()
} = {}) {
  const id = String(session || newSession());
  const ring = [];
  // Its OWN ring. See the EDGE STREAM note above - an edge record has no `accepted`, so one
  // shared list would make every edge read as a rejection and quietly wreck the metric.
  const edgeRing = [];
  let pending = [];
  let edgePending = [];
  const stream = makeEvents ? makeEvents(ACCESS_STREAM, { limit: cap }) : null;

  function record(rec) {
    if (!rec) return null;
    ring.push(rec);
    if (ring.length > cap) ring.splice(0, ring.length - cap);
    if (stream) {
      pending.push(rec);
      if (pending.length >= batchSize) flush();
    }
    if (bus) bus.publish(ACCESS_TOPIC, rec);   // live nudge for a binding tester UI
    return rec;
  }

  // Hand this to `bus.subscribe(EDGE_TOPIC, log.recordEdge)`. It is a SUBSCRIPTION, not a
  // constructor option, because the edge stream is opt-in per surface: a screen that is not
  // measuring anybody should not be accumulating how long they held things.
  function recordEdge(rec) {
    if (!rec) return null;
    edgeRing.push(rec);
    if (edgeRing.length > cap) edgeRing.splice(0, edgeRing.length - cap);
    if (stream) {
      edgePending.push(rec);
      if (edgePending.length >= batchSize) flushEdges();
    }
    return rec;
  }

  function flush() {
    if (!stream || !pending.length) return Promise.resolve(null);
    const batch = pending;
    pending = [];
    return stream.append(ACTIVATION_KIND, { session: id, count: batch.length, rows: batch });
  }

  function flushEdges() {
    if (!stream || !edgePending.length) return Promise.resolve(null);
    const batch = edgePending;
    edgePending = [];
    return stream.append(EDGE_KIND, { session: id, count: batch.length, rows: batch });
  }

  return {
    session: id,
    // Hand this straight to createInputBus({ onActivation }).
    record,
    recordEdge,
    get: () => [...ring],
    edges: () => [...edgeRing],
    clear: () => { ring.length = 0; edgeRing.length = 0; },
    flush,
    flushEdges,
    summarize: () => summarize(ring),
    byReason: () => byReason(ring),
    byDevice: () => byDevice(ring),
    byAction: () => byAction(ring),
    // The opt-in payload, built fresh from the allowlist every time it is asked for.
    outbound: (dayparts = DEFAULT_DAYPARTS) => toOutboundBatch(ring, { session: id, dayparts }),
    edgeOutbound: (dayparts = DEFAULT_DAYPARTS) => toOutboundEdgeBatch(edgeRing, { session: id, dayparts }),
    destroy: () => { flush(); flushEdges(); stream?.destroy?.(); ring.length = 0; edgeRing.length = 0; },
  };
}

function newSession() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  return b.join('');
}
