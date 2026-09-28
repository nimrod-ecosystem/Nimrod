// link_runner.js — the thing that makes a LINK carry a VALUE.
//
// `links.js` is structure: what a port is, what a link is, what rides a link's wire. Its own header
// says "no patch-bay UI, no module wired with real ports yet". `ports.js` lets a module send and
// listen; this is the third piece, the one between two modules. It reads a link store, and for each
// link that can carry, listens on the FROM port's topic and republishes on the TO port's topic:
//
//   const runner = createLinkRunner({ rootBus, store, portsOf });
//   runner.start();        // subscribes; nothing is carried before this
//   runner.refresh();      // the store or the set of mounted modules changed: re-read both
//   runner.status();       // every link, with whether it is carrying and, if not, why
//   runner.destroy();      // unsubscribes everything
//
// `store` is a `createLinkStore()` (the structure, and where cardinality is enforced). `portsOf(id)`
// returns a module INSTANCE's normalized ports (`portsFor(getManifest(type))`), or [] if it does not
// know the instance — the host owns "which instance is which module type", not this file.
//
// WHAT A HOP DOES, in the order links.js's own comments ask for:
//   * `classifyPatch(fromPort, toPort)` decides whether the link may carry at all. A link that
//     classifies not-ok does not carry traffic, and is not dropped from `status()`: "present,
//     disabled, with a reason, never absent" (settings_fields.js's rule, applied to a link).
//   * `mapRange` is applied ONLY for a `linear-range` link with BOTH ranges present. `classifyPatch`
//     calls an event/number -> event/number link `linear-range` with two null ranges, because two
//     unranged number ports have no range to compare; `mapRange` with a missing range returns the
//     number unchanged, so that case is an identity, and the hop says `identity` because that is
//     what happened, not what the classifier's vocabulary happened to call it. (Checked in
//     link_runner_test.html rather than assumed.)
//   * a hop is APPENDED to provenance — `{source: '<to.instance>/<to.port>', transform}` — never
//     written over what is there; the envelope that was sent is not mutated.
//   * THE SOURCE'S TIMESTAMP IS KEPT. links.js: "a sink using arrival time cannot recover the
//     source's timing", so the runner spreads the envelope it was given and changes only the value
//     and the provenance. `seq` and `edge` ride along the same way.
//
// LINKS RUN OUT -> IN. `classifyPatch` looks at class and type only; it will happily say a link from
// an IN port to another IN port is fine. The runner adds the direction check, because a link out of
// an IN port, or into an OUT port, is not something a module can act on and would otherwise let a
// link publish onto a topic that only a module is supposed to publish on.
//
// *** THE HOP CAP, A DEFAULT, NOT A RULE. *** A value that has been carried `maxHops` times is not
// carried again (default `DEFAULT_MAX_HOPS`, 16 — provenance entries, the origin counting as one, so
// it allows an origin plus fifteen links, well past any patch a person would draw by hand). What it
// is for: a cycle. Links only run OUT -> IN, so a loop needs something in the middle that turns an
// IN value back into an OUT one — a relay or converter module, none of which exists yet — and the bus
// is synchronous, so an uncapped loop is a stack overflow rather than a slow drain. It is an option
// (`maxHops`) rather than a constant so a host with a long legitimate chain can raise it, and a
// capped drop is COUNTED in `status()` (`hopLimited`), never silent.
// KNOWN LIMIT: a module that re-emits what it received through `ports.emit` starts a FRESH origin
// (that is what `emit` is for), so the path breaks there and this cap cannot see a cycle through
// such a module. A relay that wants the cap to bind has to continue the path — append to the
// provenance it received — the way the hand-written relay in `link_runner_test.html` does. If a real
// relay module is ever written, `ports.emit` wants a way to say "continue this envelope".
//
// NO CONDITIONING IS WIRED IN. `conditioning.js` (debounce/hold/lockout, the unchanged-value guard)
// is deliberately not applied here yet; a link carries every value it is given. When it is, it goes
// between the subscription and the republish, in this file.
//
// NOTHING LEAKS. Every subscription is owned by one entry and released when its link is removed, is
// disabled, or the runner is destroyed. link_runner_test.html counts live subscribers through a
// wrapper (the bus cannot be asked) across sixty add/remove/refresh cycles and after destroy — the
// R6 soak lesson in NEW_CORE_SPEC.md §3, applied to a thing that owns timers of the same shape.

import { classifyPatch, mapRange, appendProvenance, linkTopic } from './links.js';

export const DEFAULT_MAX_HOPS = 16;

const linkKey = (l) => JSON.stringify([l.from.instance, l.from.port, l.to.instance, l.to.port]);

export function createLinkRunner({ rootBus, store, portsOf, maxHops = DEFAULT_MAX_HOPS } = {}) {
  // A cap under 2 would refuse even a single hop from an origin, which is not a cap, it is "off".
  const cap = Number.isInteger(maxHops) && maxHops >= 2 ? maxHops : DEFAULT_MAX_HOPS;
  const entries = new Map();     // linkKey -> { link, verdict, off, delivered, hopLimited }
  let running = false;
  let destroyed = false;

  function portOf(instance, portId) {
    let ports = [];
    try { ports = portsOf?.(instance) || []; } catch { ports = []; }
    return ports.find((p) => p && p.id === portId) || null;
  }

  // The link's verdict: can it carry, and if so how. Reasons are `classifyPatch`'s own
  // (`needs-converter`, `needs-edge-node`, `needs-hold-node`) plus the four this file adds.
  function judge(link) {
    const from = portOf(link.from.instance, link.from.port);
    const to = portOf(link.to.instance, link.to.port);
    if (!from) return { ok: false, reason: 'from-port-missing' };
    if (!to) return { ok: false, reason: 'to-port-missing' };
    if (from.direction !== 'out') return { ok: false, reason: 'from-port-not-out' };
    if (to.direction !== 'in') return { ok: false, reason: 'to-port-not-in' };
    const c = classifyPatch(from, to);
    if (!c.ok) return { ok: false, reason: c.reason };
    const mapped = c.transform === 'linear-range' && !!c.from && !!c.to;
    return { ok: true, transform: mapped ? 'linear-range' : 'identity', from: c.from, to: c.to, mapped };
  }

  function subscribe(entry) {
    const { link } = entry;
    const toTopic = linkTopic(rootBus, link.to);
    return rootBus.subscribe(linkTopic(rootBus, link.from), (env) => {
      if (destroyed || !entry.verdict.ok) return;
      if (!env || typeof env !== 'object' || !('value' in env)) return;
      const provenance = Array.isArray(env.provenance) ? env.provenance : [];
      if (provenance.length >= cap) { entry.hopLimited += 1; return; }
      const v = entry.verdict;
      const value = v.mapped ? mapRange(env.value, v.from, v.to) : env.value;
      entry.delivered += 1;
      rootBus.publish(toTopic, {
        ...env,
        value,
        provenance: appendProvenance(provenance, {
          source: `${link.to.instance}/${link.to.port}`, transform: v.transform,
        }),
      });
    });
  }

  function sync() {
    const links = store.all();
    const wanted = new Set(links.map(linkKey));
    for (const [k, entry] of entries) {
      if (wanted.has(k)) continue;
      entry.off?.(); entry.off = null;
      entries.delete(k);
    }
    for (const link of links) {
      const k = linkKey(link);
      let entry = entries.get(k);
      if (!entry) {
        entry = { link, verdict: null, off: null, delivered: 0, hopLimited: 0 };
        entries.set(k, entry);
      }
      entry.verdict = judge(link);
      if (entry.verdict.ok && !entry.off) entry.off = subscribe(entry);
      else if (!entry.verdict.ok && entry.off) { entry.off(); entry.off = null; }
    }
  }

  return {
    start() {
      if (destroyed) return;
      running = true;
      sync();
    },
    refresh() {
      if (destroyed || !running) return;
      sync();
    },
    // Every link in the store, carrying or not. Before start() this still answers (running:false),
    // so a host can show what WOULD happen.
    status() {
      if (destroyed) return [];
      return store.all().map((link) => {
        const entry = entries.get(linkKey(link));
        const verdict = entry ? entry.verdict : judge(link);
        const row = {
          link: { from: { ...link.from }, to: { ...link.to } },
          ok: verdict.ok,
          running: !!entry?.off,
          delivered: entry?.delivered || 0,
          hopLimited: entry?.hopLimited || 0,
        };
        if (verdict.ok) row.transform = verdict.transform; else row.reason = verdict.reason;
        return row;
      });
    },
    destroy() {
      destroyed = true; running = false;
      for (const entry of entries.values()) { entry.off?.(); entry.off = null; }
      entries.clear();
    },
  };
}
