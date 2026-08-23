// output_remote.js - the REMOTE channel: tell me on whichever device I am near.
//
// The other four channels render on the machine you are standing at. This one does not
// render at all. It posts the message to a per-user mailbox, and every other device
// signed in as that person picks it up and renders it THROUGH ITS OWN OUTPUT BUS.
//
// THAT LAST PART IS THE WHOLE DESIGN, and it is why this is a channel rather than a
// notification service. The sending device does not decide how the message appears
// somewhere else - it cannot know whether the kitchen screen has speakers, whether
// someone is asleep in that room, or whether that device is muted right now. It says
// WHAT; the receiving device applies the same person's routing to decide HOW. A message
// that arrives on three devices can be spoken on one, a banner on another, and dropped
// on the third for being muted, and all three are correct.
//
// THE MAILBOX IS AN APPEND-ONLY EVENT STREAM (/api/user-events), not a socket. No push
// infrastructure exists and inventing some for this would be the tail wagging the dog.
// Polling is a few seconds of latency, which is right for "your data is ready to send"
// and wrong for a video call - and video calls already have their own transport.
//
// FOUR THINGS THAT WOULD OTHERWISE GO WRONG, all of them the boring kind:
//
//   1. AN ECHO LOOP. A device receives a message, re-emits it locally, and the person's
//      routing includes `remote`, so it posts it straight back out. Prevented
//      structurally: a received message is re-emitted with `remote` EXCLUDED, so the
//      person's screen/speech/sound choices still apply but it cannot bounce.
//   2. HEARING YOURSELF. The sender is in the same mailbox it just posted to. Every
//      message carries the device that sent it and a device skips its own.
//   3. REPLAYING HISTORY. An append-only stream still holds last Tuesday's alerts, so
//      opening a screen would recite a week of them. A receiver notes the head of the
//      stream when it starts and only acts on what arrives AFTER.
//   4. ARRIVING STALE. A device that was asleep wakes to a backlog. Anything older than
//      its ttl is dropped rather than announced late, same rule as the local queue.
//
// SIGNED OUT, THIS CHANNEL DOES NOT EXIST, and that is honest rather than a limitation to
// paper over: there is no account, so there is no "your other devices."

export const REMOTE_STREAM = 'output-remote';
export const REMOTE_KIND = 'message';
const DEVICE_KEY = 'nimrod.deviceId';

// A stable name for THIS machine, so a device can skip its own messages. Random and
// local: it identifies a device to its owner's other devices and nothing else, and it
// never leaves the account.
export function deviceId(store = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!store) return 'device-unknown';
  let id = null;
  try { id = store.getItem(DEVICE_KEY); } catch { /* private mode */ }
  if (id) return id;
  id = (globalThis.crypto?.randomUUID?.() || `d-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`);
  try { store.setItem(DEVICE_KEY, id); } catch { /* private mode: a fresh id per load */ }
  return id;
}

// ---------------------------------------------------------------------------------
// The channel. Its whole job is to put the message in the mailbox.
// ---------------------------------------------------------------------------------
export function createRemoteChannel({ events, from = deviceId(), label = '' } = {}) {
  if (!events) throw new Error('createRemoteChannel: a user-events handle is required');
  return {
    name: 'remote',
    // Posting is cheap and independent; there is no shared resource to arbitrate over,
    // unlike one pair of ears. Several can be in flight at once.
    concurrency: 4,
    available: () => true,
    present(item) {
      // Returning the promise lets output.js record `failed` when the network is down -
      // which matters, because "I never got it on my phone" needs an answer.
      return events.append(REMOTE_KIND, {
        from, label,
        verb: item.verb,
        text: item.text,
        source: item.source || null,
        sentAt: item.at,
        ttlMs: item.ttlMs,
      });
    },
  };
}

// ---------------------------------------------------------------------------------
// The receiver. Watches the mailbox and hands anything new to the LOCAL output bus.
// ---------------------------------------------------------------------------------
export function createRemoteReceiver({
  events,
  output,
  self = deviceId(),
  now = () => Date.now(),
  maxAgeMs = 120000,          // a device that was asleep does not recite the backlog
  onReceive = null,
} = {}) {
  if (!events) throw new Error('createRemoteReceiver: a user-events handle is required');
  if (!output) throw new Error('createRemoteReceiver: an output bus is required');

  let floor = null;           // highest event id seen at start; everything at or below is history
  let started = false;
  let off = null;

  function consider(ev) {
    if (!ev || ev.kind !== REMOTE_KIND) return null;
    if (floor != null && Number(ev.id) <= floor) return null;
    const d = ev.data || {};
    if (d.from === self) return null;                                  // our own voice
    const age = now() - (Number(d.sentAt) || now());
    if (age > maxAgeMs) return { skipped: 'stale', ev };

    // Re-emitted WITHOUT the remote channel, so it cannot bounce back out. Everything
    // else about how it lands is still this device's own business.
    output.emit({
      verb: d.verb,
      text: d.text,
      source: d.source || 'remote',
      exclude: ['remote'],
      // The clock has already been running on this message. Give it what is left of its
      // life rather than a fresh full ttl, or a stale alert gets a second wind.
      ttlMs: Math.max(1000, (Number(d.ttlMs) || maxAgeMs) - age),
    });
    return { delivered: true, ev };
  }

  function sweep() {
    const list = (events.get() || {}).events || [];
    if (floor == null) {
      // First look: everything already in the mailbox is history, not news.
      floor = list.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
      return;
    }
    for (const ev of list) {
      const outcome = consider(ev);
      if (outcome) onReceive?.(outcome);
      floor = Math.max(floor, Number(ev.id) || 0);
    }
  }

  async function start() {
    if (started) return;
    started = true;
    await events.load().catch(() => {});
    sweep();                       // establishes the floor; delivers nothing
    off = events.subscribe(sweep);
    events.startPolling();
  }

  return {
    start,
    sweep,
    seenUpTo: () => floor,
    self,
    destroy() { off?.(); events.destroy?.(); started = false; },
  };
}
