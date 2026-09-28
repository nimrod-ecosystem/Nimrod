// ports.js — how a MODULE uses the ports it declared. The sending and listening half of links.js.
//
// `links.js` is the structure (what a port is, what a link is, what rides a link's wire) and
// says of itself "no module wired with real ports yet". This is the first thing that lets one be:
// a small helper a module builds from what it ALREADY receives, so wiring a module's ports does
// not touch the `ctx` contract or `module.js` at all.
//
//   const ports = createPorts({ rootBus: ctx.rootBus, instanceId: ctx.instanceId, manifest });
//   ports.emit('result', 10);                      // an OUT port the manifest declared
//   const off = ports.on('answer', (value) => …);  // an IN port the manifest declared
//   ports.dispose();                               // in destroy(): releases every `on`
//
// WHY A HELPER AND NOT A NEW ctx FIELD. `NEW_CORE_SPEC.md` §1 is explicit that a module trusting an
// undocumented ctx field is depending on one caller's convention. `rootBus` and `instanceId` are
// already supplied by every real mounting path (kiosk.js `childCtx`, module_try.js's hosts) and
// `core:'new'` already enforces `instanceId`. Everything a port needs is in those two plus the
// module's own manifest, so nothing new is asked of a host — and a legacy module (algebra is the
// first) can use the same helper with the same two fields.
//
// *** IT USES `rootBus`, NOT `ctx.bus`. *** The bus a module is handed is a SCOPED view, which
// answers on both the bare topic and the instance alias (bus.js `scope`) and has no `instanceTopic`.
// A data link addresses ONE instance's port, never a broadcast, so this needs the raw bus and its
// `instanceTopic` — which is exactly what `linkTopic` calls.
//
// *** A REFUSAL IS QUIET: IT IS RETURNED, NOT THROWN. *** `emit` on a port that was not declared, or is declared
// the other way round, returns false and publishes nothing; `on` returns a callable no-op. The
// same rule `normalizePort` states for a malformed declaration: one module's mistake must not take
// a whole screen down with it. Nothing here throws into a module.
//
// WHAT IS DECIDED HERE AS A DEFAULT, each revisable:
//   * A number port takes finite numbers only. `emit('result', '7')` is refused rather than
//     coerced, so a sink never has to wonder whether "7" is a number. A text port carries
//     `String(value)`. (`image` and `time` ports pass the value through: nothing here can check them.)
//   * The sequence counter is kept per BUS, per source, not per createPorts call — so a module that
//     is torn down and re-mounted under the same instance id keeps counting instead of restarting at
//     1, which a sink de-duplicating on `seq` would read as a stale repeat. Held in a WeakMap, so it
//     dies with the bus and leaks nothing.
//   * `on` drops a payload that is not an envelope, and one whose value has the wrong type for the
//     port. A link runner only ever sends well-formed envelopes; this is for the day something else
//     publishes on a link topic.

import { portsFor, linkTopic, wrapValue, createSequencer } from './links.js';

const SEQUENCERS = new WeakMap();   // rootBus -> createSequencer()
function sequencerFor(bus) {
  let s = SEQUENCERS.get(bus);
  if (!s) { s = createSequencer(); SEQUENCERS.set(bus, s); }
  return s;
}

const NOOP = () => {};

export function createPorts({ rootBus, instanceId, manifest, now = Date.now } = {}) {
  const declared = portsFor(manifest);
  const byId = new Map(declared.map((p) => [p.id, p]));
  // A bus without `instanceTopic` is a scoped view (or nothing): there is no address to use, so
  // the helper is inert rather than half-working.
  const usable = !!(rootBus && instanceId && typeof rootBus.publish === 'function'
    && typeof rootBus.subscribe === 'function' && typeof rootBus.instanceTopic === 'function');
  const offs = new Set();
  let disposed = false;

  const topicOf = (portId) => linkTopic(rootBus, { instance: instanceId, port: portId });

  function emit(portId, value, { edge } = {}) {
    if (!usable || disposed) return false;
    const port = byId.get(portId);
    if (!port || port.direction !== 'out') return false;
    let v = value;
    if (port.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    } else if (port.type === 'text') {
      if (value === undefined || value === null) return false;
      v = String(value);
    }
    const source = `${instanceId}/${portId}`;
    const envelope = wrapValue({
      value: v,
      class: port.class,
      // ONE origin hop. Every hop a link runner adds later is appended after this, never over it.
      provenance: [{ source, transform: 'origin' }],
      edge,
      seq: port.class === 'event' ? sequencerFor(rootBus).next(source) : undefined,
      timestamp: now(),
    });
    rootBus.publish(topicOf(portId), envelope);
    return true;
  }

  function on(portId, fn) {
    if (!usable || disposed || typeof fn !== 'function') return NOOP;
    const port = byId.get(portId);
    if (!port || port.direction !== 'in') return NOOP;
    const handler = (env) => {
      if (!env || typeof env !== 'object' || !('value' in env)) return;
      if (port.type === 'number' && !(typeof env.value === 'number' && Number.isFinite(env.value))) return;
      try { fn(env.value, env); } catch (err) { console.error(`ports: "${portId}" listener`, err); }
    };
    const off = rootBus.subscribe(topicOf(portId), handler);
    let live = true;
    const release = () => { if (!live) return; live = false; offs.delete(release); off(); };
    offs.add(release);
    return release;
  }

  function dispose() {
    disposed = true;
    for (const release of [...offs]) release();
  }

  return { emit, on, dispose, declared: [...declared] };
}
