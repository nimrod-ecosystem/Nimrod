// output.js - the OUTPUT BUS: a module says WHAT, the person's settings decide HOW.
//
// The mirror of input.js, and it exists for the same reason. The input bus stopped
// modules caring which switch someone owns. This stops them caring how that person
// wants to be told things. A module emits a VERB - "alert", "say" - and never learns
// whether it became speech, a banner, a tone, a blinking light or a message on another
// device in the house.
//
//   module -> verb -> [route by the PERSON'S settings, arbitrate, log] -> channels
//
// WHY THIS IS NOT A NOTIFICATION LIBRARY. Two things make it different, and both come
// from the same place the input bus did:
//
// 1. ROUTING IS A PROPERTY OF THE PERSON, not the app. The WheelTrak usability study
//    found notification preferences scattered across phone call, text and email, and
//    that most participants did NOT want their children or spouses notified because of
//    the care burden it created. That is not a feature request, it is a statement that
//    "how you tell me" belongs to the user, per verb, and travels with them. Same shape
//    as input bindings, same per-user storage.
//
// 2. EVERY UNDELIVERED MESSAGE IS RECORDED, with the reason. A notification that was
//    never spoken because something more urgent was already speaking is not nothing -
//    it is the output-side twin of a false activation, and nobody measures it either.
//    `onDelivery` sees the drops as well as the deliveries.
//
// ARBITRATION IS THE HARD PART, and Cici learned it the expensive way: there is one
// pair of ears. Two modules speaking at once is not twice the information, it is none.
// So each channel declares how many things it can do at once (speech: 1, a screen
// banner: 3), higher priority preempts lower, and a preempted message is put BACK in
// the queue rather than lost - unless it has been preempted so often it is stale, at
// which point saying it late is worse than not saying it.
//
// EVERYTHING EXPIRES. A message about something that happened five minutes ago,
// delivered now because the queue was busy, is noise that trains someone to ignore the
// channel. `ttlMs` is on every item and the default is deliberately short.
//
// Timers and the clock are injectable, so all of the above is tested as arithmetic.

// Ascending urgency. The order IS the priority - index in this array.
export const VERBS = ['status', 'say', 'notify', 'alert'];

// A channel is a way of reaching a person. `remote` (another device in the house) is
// named here but has no adapter yet; naming it costs nothing and keeps the routing
// vocabulary from having to change when it arrives.
export const CHANNELS = ['screen', 'speech', 'sound', 'light', 'remote'];

// The closed set of reasons a message did not arrive. Closed like input.js's REJECTIONS,
// and for the same reason: a research payload validates against it.
export const DROPS = [
  'no-channel',      // the person's routing sends this verb nowhere
  'no-adapter',      // routed to a channel this device does not have
  'muted',           // the channel is off right now (quiet hours, headphones out)
  'expired',         // it waited longer than it was worth
  'preempted',       // something more urgent took the channel, too many times
  'queue-full',      // the channel is saturated and this was the least urgent
  'failed',          // the adapter threw
];

export const DELIVERY_TOPIC = 'output/delivery';   // live diagnostic, not the record

// What a person gets by default, before they have expressed any preference. Chosen so a
// screen with no settings still WORKS: the loud things are loud, the quiet things are
// quiet, and nothing is silent. Bindable/configurable must never mean arrives inert -
// the same rule the input bus ships under.
export const DEFAULT_ROUTING = {
  status: ['screen'],
  say: ['speech'],
  notify: ['screen', 'sound'],
  alert: ['screen', 'speech', 'sound'],
};

export const priorityOf = (verb) => Math.max(0, VERBS.indexOf(verb));

export function createOutputBus({
  bus = null,
  channels = {},                 // name -> adapter
  routing = DEFAULT_ROUTING,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onDelivery = null,             // every outcome, delivered or dropped
  defaultTtlMs = 20000,
  queueLimit = 12,               // per channel
  maxPreemptions = 2,
} = {}) {
  const queues = new Map();      // channel -> [item]
  const running = new Map();     // channel -> [{item, cancel}]
  const muted = new Set();
  let route = { ...routing };
  let seq = 0;

  const adapterFor = (name) => channels[name] || null;
  const concurrencyOf = (name) => Math.max(1, Number(adapterFor(name)?.concurrency) || 1);
  const queueOf = (name) => (queues.has(name) ? queues.get(name) : (queues.set(name, []), queues.get(name)));
  const runningOf = (name) => (running.has(name) ? running.get(name) : (running.set(name, []), running.get(name)));

  function report(item, channel, { delivered = false, reason = null } = {}) {
    const rec = {
      at: now(),
      id: item.id,
      verb: item.verb,
      priority: item.priority,
      channel,
      source: item.source || null,
      delivered,
      reason,
      // How long it sat between being emitted and being resolved. The output-side twin
      // of input latency, and the number that says whether a channel is oversubscribed.
      waitedMs: now() - item.at,
    };
    try { onDelivery?.(rec); } catch (err) { console.error('output log sink threw', err); }
    bus?.publish(DELIVERY_TOPIC, rec);
    return rec;
  }

  // ---- the queue ----------------------------------------------------------------

  const expired = (item) => now() - item.at >= item.ttlMs;

  // Highest priority first; among equals, oldest first, so a burst of the same verb
  // still comes out in the order it happened.
  function takeNext(name) {
    const q = queueOf(name);
    let best = -1;
    for (let i = 0; i < q.length; i++) {
      if (expired(q[i])) { report(q[i], name, { reason: 'expired' }); q.splice(i, 1); i--; continue; }
      if (best < 0 || q[i].priority > q[best].priority) best = i;
    }
    return best < 0 ? null : q.splice(best, 1)[0];
  }

  function start(name, item) {
    const adapter = adapterFor(name);
    const run = { item, cancel: null, done: false };
    runningOf(name).push(run);

    const finish = (outcome) => {
      if (run.done) return;
      run.done = true;
      const list = runningOf(name);
      const at = list.indexOf(run);
      if (at >= 0) list.splice(at, 1);
      if (outcome) report(item, name, outcome);
      pump(name);
    };
    run.finish = finish;

    let result;
    try {
      result = adapter.present({ ...item }, { done: () => finish({ delivered: true }) });
    } catch (err) {
      console.error(`output channel "${name}" threw`, err);
      finish({ reason: 'failed' });
      return;
    }
    // An adapter may return a promise, return a cancel function, or call done() itself.
    // All three are normal: speech resolves when it stops speaking, a banner resolves on
    // a timer, a tone resolves immediately.
    if (typeof result === 'function') run.cancel = result;
    else if (result && typeof result.then === 'function') {
      result.then(() => finish({ delivered: true }), (err) => {
        console.error(`output channel "${name}" failed`, err);
        finish({ reason: 'failed' });
      });
    } else if (result && typeof result.cancel === 'function') {
      run.cancel = result.cancel;
      if (result.done && typeof result.done.then === 'function') {
        result.done.then(() => finish({ delivered: true }), () => finish({ reason: 'failed' }));
      }
    }
  }

  // Take the channel away from the least urgent thing on it, if this is more urgent.
  function preemptFor(name, item) {
    const list = runningOf(name);
    if (list.length < concurrencyOf(name)) return true;
    let victim = null;
    for (const run of list) if (!victim || run.item.priority < victim.item.priority) victim = run;
    if (!victim || victim.item.priority >= item.priority) return false;

    try { victim.cancel?.(); } catch (err) { console.error('cancel threw', err); }
    const evicted = victim.item;
    victim.finish(null);                       // removed from `running`, no record yet

    evicted.preemptions = (evicted.preemptions || 0) + 1;
    // Put it back - being interrupted is not the same as being unwanted. But a message
    // that keeps losing the channel is getting stale, and saying it long after the
    // moment has passed is worse than not saying it.
    if (evicted.preemptions <= maxPreemptions && !expired(evicted)) {
      queueOf(name).push(evicted);
      report(evicted, name, { reason: 'preempted' });
    } else {
      report(evicted, name, { reason: 'preempted' });
    }
    return true;
  }

  function pump(name) {
    const list = runningOf(name);
    while (list.length < concurrencyOf(name)) {
      const item = takeNext(name);
      if (!item) return;
      start(name, item);
    }
  }

  function enqueue(name, item) {
    if (!adapterFor(name)) return report(item, name, { reason: 'no-adapter' });
    if (muted.has(name)) return report(item, name, { reason: 'muted' });

    if (runningOf(name).length < concurrencyOf(name)) { start(name, item); return null; }
    if (preemptFor(name, item)) { queueOf(name).push(item); pump(name); return null; }

    const q = queueOf(name);
    if (q.length >= queueLimit) {
      // Saturated. Drop the least urgent thing waiting - which may well be this one.
      let worst = item, worstAt = -1;
      q.forEach((x, i) => { if (x.priority < worst.priority) { worst = x; worstAt = i; } });
      if (worstAt >= 0) q.splice(worstAt, 1);
      report(worst, name, { reason: 'queue-full' });
      if (worst === item) return null;
    }
    q.push(item);
    return null;
  }

  // ---- the front door -------------------------------------------------------------

  function emit({ verb = 'notify', text = '', source = null, data = null, ttlMs = null,
                  priority = null, exclude = [] } = {}) {
    const v = VERBS.includes(verb) ? verb : 'notify';
    const item = {
      id: `o${++seq}`,
      verb: v,
      priority: Number.isFinite(priority) ? Number(priority) : priorityOf(v),
      text: String(text || ''),
      source, data,
      at: now(),
      ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? Number(ttlMs) : defaultTtlMs,
      preemptions: 0,
    };

    // `exclude` exists for exactly one caller: the remote receiver, re-emitting a
    // message that ARRIVED from another device. Without it, a person whose routing
    // includes `remote` would post it straight back out and the two devices would talk
    // to each other forever. Excluding a channel here still lets the person's own
    // screen/speech/sound choices apply — it only forbids the bounce.
    const names = (route[v] || []).filter((c) => !exclude.includes(c));
    if (!names.length) { report(item, null, { reason: 'no-channel' }); return item.id; }
    // One item, several channels: each gets its own copy, because they succeed and fail
    // independently. Speech being busy must not stop the banner appearing.
    for (const name of names) enqueue(name, { ...item });
    return item.id;
  }

  // Convenience, and the names modules will actually type.
  const say = (text, opts = {}) => emit({ ...opts, verb: 'say', text });
  const notify = (text, opts = {}) => emit({ ...opts, verb: 'notify', text });
  const alert = (text, opts = {}) => emit({ ...opts, verb: 'alert', text });
  const status = (text, opts = {}) => emit({ ...opts, verb: 'status', text });

  function setRouting(next) {
    route = {};
    for (const v of VERBS) {
      const list = (next && next[v]) || [];
      route[v] = list.filter((c) => CHANNELS.includes(c));
    }
    return { ...route };
  }

  function setMuted(name, on) {
    if (on) muted.add(name); else muted.delete(name);
    if (!on) pump(name);
    return [...muted];
  }

  // Stop everything, now. The caregiver-facing panic button, and what a screen does when
  // it goes to sleep - the output-side twin of the input bus's releaseAll().
  function silence() {
    for (const [name, list] of running) {
      // ORDER MATTERS. Finishing a running item pumps the channel, so if the queue is
      // still full the "silence" immediately starts the next thing and the screen keeps
      // talking. Empty the queue first, then stop what is in flight.
      const q = queueOf(name);
      while (q.length) report(q.pop(), name, { reason: 'muted' });
      for (const run of [...list]) {
        try { run.cancel?.(); } catch (err) { console.error('cancel threw', err); }
        run.finish({ reason: 'muted' });
      }
    }
  }

  return {
    emit, say, notify, alert, status,
    setRouting, getRouting: () => ({ ...route }),
    setMuted, isMuted: (name) => muted.has(name),
    silence,
    pending: (name) => queueOf(name).length,
    active: (name) => runningOf(name).length,
    channels: () => Object.keys(channels),
    destroy() { silence(); queues.clear(); running.clear(); },
  };
}
