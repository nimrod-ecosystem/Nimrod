// ai_activity.js - IS AN AI BEING ASKED RIGHT NOW, AND DO THE WORDS LEAVE THIS COMPUTER? (status icons, 2026-10-14)
//
// There is no single place every AI question goes through: ai.js (a model on this computer, in the house, or anywhere
// OpenAI-shaped) and nimrod_ai.js's Claude (through this site's server) each send their own. Both now note the start
// and end of each question here, and the screen's status strip (status_icons.js) reads it: "Asking an AI over the
// internet" while words are on their way to another computer, and, only if the screen switched it on, "Asking the AI on
// this computer". Module-level on purpose: an AI made anywhere on the page counts, without being handed anything.
//
// WHERE, ARGUED: only this computer (localhost, 127.x, ::1) is 'local'. A model on another computer in the house is
// 'away': the words leave this screen, the same line speech draws ("Another computer (sends the room's sound there)").

const busy = { local: 0, away: 0 };
const fns = new Set();

/** 'local' for an address on this computer, 'away' for anything else (the house's network included). Pure. */
export function aiWhere(url) {
  let h = '';
  try { h = new URL(String(url || '')).hostname.toLowerCase(); } catch { return 'away'; }
  h = h.replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h) ? 'local' : 'away';
}

/** A question starts. Returns the function that ends it (safe to call twice). */
export function beginAI(where = 'away') {
  const w = where === 'local' ? 'local' : 'away';
  busy[w] += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busy[w] = Math.max(0, busy[w] - 1);
    emit();
  };
}

/** { local, away }: how many questions are on their way right now. */
export function aiActivity() { return { ...busy }; }

export function onAIActivity(fn) { fns.add(fn); return () => fns.delete(fn); }

function emit() {
  const s = aiActivity();
  for (const f of [...fns]) { try { f(s); } catch (err) { console.error('ai activity', err); } }
}
