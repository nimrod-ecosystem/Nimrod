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
import { REJECTIONS } from './input.js';

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
  let pending = [];
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

  function flush() {
    if (!stream || !pending.length) return Promise.resolve(null);
    const batch = pending;
    pending = [];
    return stream.append(ACTIVATION_KIND, { session: id, count: batch.length, rows: batch });
  }

  return {
    session: id,
    // Hand this straight to createInputBus({ onActivation }).
    record,
    get: () => [...ring],
    clear: () => { ring.length = 0; },
    flush,
    summarize: () => summarize(ring),
    byReason: () => byReason(ring),
    byDevice: () => byDevice(ring),
    byAction: () => byAction(ring),
    // The opt-in payload, built fresh from the allowlist every time it is asked for.
    outbound: (dayparts = DEFAULT_DAYPARTS) => toOutboundBatch(ring, { session: id, dayparts }),
    destroy: () => { flush(); stream?.destroy?.(); ring.length = 0; },
  };
}

function newSession() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = new Array(16).fill(0).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  return b.join('');
}
