// town_talk.js — THE SEAM BETWEEN THE TOWN AND AN AI STORYTELLER: "Talk to King Bram".
//
// Mike, 2026-10-12 (public DECISIONS.md, newest section): build Design's ideas, the Town and Story time first, with
// conversations with the characters and free-form stories on the desktop model. The Town (modules/town.js) puts a
// "Talk to <character>" button in each character's home. THIS FILE IS ONLY THE SEAM: nothing here talks, and no AI
// is called from the Town. Whatever answers (the AI storyteller, `story_ai.js`, built separately) registers here.
//
// TWO WAYS IN, so a later step can pick whichever fits it:
//   * A FUNCTION: `registerTownTalk(handler)`. The town calls `handler(request)` when the button is pressed and
//     treats a truthy return (or a promise of one) as "taken". Returns the function that unregisters it.
//   * AN EVENT: every press is also published on the panel's bus as TOWN_TALK_TOPIC ('town/talk') with the same
//     request, whether or not a handler is registered, so a module on the same screen can answer without importing
//     anything but this file's topic name.
//
// THE REQUEST, plain data (nothing a person typed):
//   { character: 'king' | 'queen' | 'jack' | 'joker', name: 'King Bram', place: 'kingHall',
//     placeLabel: 'The Great Hall', blurb: "King Bram's home. ...", theme: 'nimrod' (the Design deck id),
//     instanceId, personId }
//
// WHETHER THE BUTTON SHOWS is the Town's "Talk to the characters" setting: by default only once something has
// registered here (`townTalkReady()`), so a one-switch scan never stops on a button that does nothing.

export const TOWN_TALK_TOPIC = 'town/talk';
export const TOWN_TALK_ROLES = Object.freeze(['king', 'queen', 'jack', 'joker']);

let handler = null;
const watchers = new Set();

function tell() {
  for (const fn of [...watchers]) { try { fn(townTalkReady()); } catch (err) { console.error('town_talk: watcher', err); } }
}

/** The AI side registers here. One handler at a time: the newest wins. Returns the function that unregisters it. */
export function registerTownTalk(fn) {
  if (typeof fn !== 'function') return () => {};
  handler = fn;
  tell();
  return () => { if (handler === fn) { handler = null; tell(); } };
}

/** Is anything set up to answer? */
export const townTalkReady = () => typeof handler === 'function';

/** Be told when that changes (a storyteller set up or taken away). Returns the unsubscribe. */
export function onTownTalkChange(fn) {
  if (typeof fn !== 'function') return () => {};
  watchers.add(fn);
  return () => watchers.delete(fn);
}

/**
 * The button was pressed: publish the request, and hand it to the registered handler if there is one.
 * Resolves true when a handler took it, false when nothing is set up (the Town then says so in words).
 */
export async function talkTo(request = {}, { bus = null } = {}) {
  const role = TOWN_TALK_ROLES.includes(request.character) ? request.character : null;
  if (!role) return false;
  const req = { ...request, character: role };
  try { bus?.publish?.(TOWN_TALK_TOPIC, req); } catch (err) { console.error('town_talk: publish', err); }
  if (typeof handler !== 'function') return false;
  try { return !!(await handler(req)); } catch (err) { console.error('town_talk: handler', err); return false; }
}
