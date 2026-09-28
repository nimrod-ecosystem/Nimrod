// screen_links.js — ONE SCREEN OWNS ITS LINKS. The bridge between a screen's settings and a link runner.
//
// THE DECISION THIS FILE ENCODES (2026-09-17, DECISIONS.md: "a dashboard is a module that contains
// modules"): links are the CONTAINING screen's own structure. They are stored as an array beside the
// layout on the screen's settings doc — `settings.kiosk.links`, the same doc and the same `kiosk`
// object `kiosk.layout` already lives in — each entry `{from: {instance, port}, to: {instance, port}}`
// using the real module INSTANCE ids that screen's layout already uses. Nothing else is stored: a
// link is structure, never a value (links.js). Two things this deliberately does NOT do:
//   * there is no patch-bay UI. A link is authored by writing data; a screen that has none costs
//     nothing and is byte-for-byte what it was.
//   * it does not touch composition identity. Whether a link enters a screen's fingerprint is a
//     [design] item in NEW_CORE_SPEC.md §1/§2 that is still open; this is only where the data lives.
//
// THE RUNNER EXISTS ONLY WHILE THERE ARE LINKS. `sync()` reads the settings; no links -> no runner
// is created (and one that was is destroyed), so a screen with none subscribes to nothing.
//
// A LINK THAT CANNOT EXIST STILL SHOWS UP. The runner lists every link it was given, disabled with a
// reason if it cannot carry ("present, disabled, with a reason, never absent"). The link STORE can
// also refuse a link (an exact duplicate, or a second link into a cardinality-one port); those are
// not in the store, so they are added to `status()` here with the store's own reason rather than
// silently disappearing. A row that is not even a well-formed link (no from/to, a link to itself)
// has no structure to show and is dropped by `readLinks`, the way every `normalize*` here drops bad
// rows.
//
// INSTANCE ID -> MODULE TYPE comes from the screen's own module list (`modules()`), and type ->
// ports from the registry (`manifestOf`), so ports are found from a module's manifest without
// mounting it. `sync()` is cheap and is meant to be called whenever the screen's settings or its set
// of modules may have changed; a link whose two ends resolve differently after that changes state
// (disabled -> carrying, or back) without any subscription being rebuilt for links that did not
// change, and a link's delivered count survives a sync that leaves it alone.

import { createLinkStore, normalizeLink, portsFor } from './links.js';
import { createLinkRunner } from './link_runner.js';

// The well-formed links in `settings.kiosk`. Pure: never mutates what it is given.
export function readLinks(kioskSettings) {
  const raw = kioskSettings && kioskSettings.links;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    const link = normalizeLink(row);
    if (link) out.push(link);
  }
  return out;
}

export function createScreenLinks({ rootBus, settings, modules, manifestOf }) {
  let runner = null;
  let current = createLinkStore();   // rebuilt on every sync; the runner reads through `view`
  let rejected = [];                 // {link, reason} the store would not take
  let written = [];                  // every well-formed link, in the order written, as of the last sync
  let destroyed = false;

  // The runner is handed this rather than a store, so a sync can swap the store underneath it and
  // keep the runner (and its per-link counters and live subscriptions) for links that did not change.
  const view = { all: () => current.all() };

  function portsOf(instance) {
    let type = null;
    try { type = (modules() || []).find((m) => m && m.id === instance)?.type; } catch { type = null; }
    if (!type) return [];
    let manifest = null;
    try { manifest = manifestOf(type); } catch { manifest = null; }
    return manifest ? portsFor(manifest) : [];
  }

  function teardown() {
    runner?.destroy();
    runner = null;
    current = createLinkStore();
    rejected = [];
    written = [];
  }

  function sync() {
    if (destroyed) return;
    let links = [];
    try { links = readLinks((settings() || {}).kiosk); } catch { links = []; }
    if (!links.length) { teardown(); return; }

    const next = createLinkStore();
    const refused = [];
    for (const link of links) {
      const toPort = portsOf(link.to.instance).find((p) => p.id === link.to.port) || null;
      const res = next.addLink(link, toPort);
      if (!res.ok) refused.push({ link, reason: res.reason });
    }
    current = next;
    rejected = refused;
    written = links;
    if (!runner) {
      runner = createLinkRunner({ rootBus, store: view, portsOf });
      runner.start();
    } else {
      runner.refresh();
    }
  }

  return {
    sync,
    // null = no runner exists (the screen has no links). Otherwise one row per link, in the order
    // written, whether or not it can carry.
    status() {
      if (destroyed || !runner) return null;
      const live = new Map(runner.status().map((r) => [JSON.stringify(r.link), r]));
      const taken = new Set();
      return written.map((link) => {
        const key = JSON.stringify(link);
        // The first copy of a link the store accepted is its live row; a second identical one, or one
        // the store refused, gets a disabled row carrying the store's own reason.
        if (live.has(key) && !taken.has(key)) { taken.add(key); return live.get(key); }
        const why = rejected.find((r) => JSON.stringify(r.link) === key);
        return { link: { from: { ...link.from }, to: { ...link.to } }, ok: false, running: false,
                 delivered: 0, hopLimited: 0, reason: why ? why.reason : 'refused' };
      });
    },
    destroy() {
      destroyed = true;
      teardown();
    },
  };
}
