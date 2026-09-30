// live_notices.js — ONE PLACE ON A SCREEN FOR "SOMETHING IS LISTENING" NOTICES (row 2.44).
//
// Three things can open a way into a room, and each promises to say so on the screen for as long as
// it does: a phone joined as a microphone ("Microphone on: <phone>", phone_mic.js), voice recording
// for training ("Recording voice for training", voice_recording.js), and the intercom ("Intercom
// open: <name>", intercom.js). Each was going to pin itself to the top-left corner, and two at once
// would have been drawn ON TOP OF EACH OTHER - one notice hiding another is the one failure these
// notices cannot have. So they share a column: a fixed stack in the corner, each notice a row in it,
// in the order they were mounted. Nothing here decides whether a notice shows; each owner does.

export function ensureNoticeStyles(doc) {
  if (!doc || doc.querySelector('link[data-live-notices-css]')) return;
  try {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./live_notices.css', import.meta.url).href;
    link.setAttribute('data-live-notices-css', '');
    doc.head.append(link);
  } catch { /* unstyled, still says it */ }
}

/** The host's notice column, made on first use. Every notice on one screen goes into the same one. */
export function noticeStack(host, doc = host?.ownerDocument || (typeof document !== 'undefined' ? document : null)) {
  if (!host || !doc) throw new Error('noticeStack: a host element is required');
  ensureNoticeStyles(doc);
  let s = null;
  for (const c of host.children) if (c.classList && c.classList.contains('live-notices')) { s = c; break; }
  if (!s) {
    s = doc.createElement('div');
    s.className = 'live-notices';
    host.append(s);
  }
  return s;
}
