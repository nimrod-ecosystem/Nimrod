// people_page.js — "YOUR PEOPLE": THE LANDING AS A VERY SIMPLE PROFILE PAGE, as data and pure rules.
//
// Mike, 2026-10-04 (DECISIONS.md, "The landing is a very simple profile page"): *"I got too far into what I'd like
// for a site and lost track of the grandparents and soccer moms ... starting out with a very simple profile page,
// like facebook or something. Have it show your users and anyone your connected to and make messaging options
// clear. Call/send message/share picture, song, video, etc. Maybe it can still be a dashboard if it's that simple?
// And yes, probably keep a Nimrod at the bottom as a helper overlaid on the screen."*
//
// This file is everything about that page that can be checked without a page: who is on it, what each button does
// or why it is dimmed, the words it may not use, and how a switch walks it. modules/people.js draws it;
// modules/helper.js is Nimrod at the bottom; dashboards.js `people` is the one ready-made dashboard they make up.
//
// *** WHO IS ON IT (v1). *** You (the person this page is for), the other people on your account, and anybody whose
// screen is shared with your account (/api/drive/shared). Linking two accounts as friends is NOT built, so the page
// says so in plain words on a "Connect with someone" card rather than pretending.
//
// *** DIMMED, NEVER HIDDEN, AND SAYS WHY *** (Design's rule, home_profile.js and modules/profile.js). Every person's
// card has the same five buttons in the same places, so a switch user's habit holds from card to card.
//
// *** PLAIN WORDS ONLY. *** The people this is for are not building anything: no "module", "dashboard", "panel" or
// "grant" on this page (`plainWordProblems`, checked by the suite over everything the page shows).

export const PEOPLE_TYPE = 'people';
export const HELPER_TYPE = 'helper';

// The words the page may not say, whole words, singular or plural. A rule a suite checks, not a style note.
export const BANNED_WORDS = Object.freeze(['module', 'dashboard', 'panel', 'grant']);
/** The banned words found in `text`, lower case, each once. PURE. */
export function plainWordProblems(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  for (const w of BANNED_WORDS) if (new RegExp(`\\b${w}s?\\b`, 'i').test(s)) out.push(w);
  return out;
}

// The buttons on every person's card, in order. Call first (the one Mike named first, and the one that matters most
// to somebody far away), then the message, then the three kinds of thing to share.
export const ACTIONS = Object.freeze(['call', 'message', 'picture', 'song', 'video']);
export const ACTION_LABELS = Object.freeze({
  call: 'Call', message: 'Send a message', picture: 'Share a picture', song: 'Share a song', video: 'Share a video',
});

// The reasons, in plain words. Exported so the suite holds the page to them.
export const WHY = Object.freeze({
  callOnScreen: 'Calls are made from a phone or computer, not from this screen.',
  callNotAllowed: 'You can call once whoever looks after their screen shares it with you.',
  checking: 'Checking…',
  messageOnScreen: 'Messages are sent from a phone or computer, not from this screen.',
  messageRefused: (name) => `${name || 'They'} can’t get messages from you yet. Whoever looks after their screen can allow it.`,
  messageNoScreen: (name) => `${name || 'They'} ha${name ? 's' : 've'} no screen yet, so there is nowhere for a message to show.`,
  messageError: 'Could not check just now. Try again in a little while.',
  // Share: no way to put a picture, a song or a video on somebody else's screen exists yet (the report says what
  // would: the intercom's approved list, and the screen saying who sent it). Dimmed, with that said.
  soon: (what) => `Coming soon: there is no way yet to send a ${what} to someone’s screen.`,
  pictureOnScreen: 'Change your picture from a phone or computer.',
});

/**
 * The people on the page, besides you: the account's own people, then those shared with this account. PURE.
 *   own     /api/people rows ({ id, name })
 *   shared  /api/drive/shared rows ({ person_id, name, label })
 *   selfId  the person the page is for (left out: they have their own card at the top)
 * -> [{ id, name, via: 'account' | 'shared' }], each person once (the account's own wins).
 */
export function connectionsFrom({ own = [], shared = [], selfId = '' } = {}) {
  const out = [];
  for (const p of Array.isArray(own) ? own : []) {
    if (!p || !p.id || p.id === selfId || out.some((x) => x.id === p.id)) continue;
    out.push({ id: String(p.id), name: String(p.name || '').trim() || 'Someone', via: 'account' });
  }
  for (const g of Array.isArray(shared) ? shared : []) {
    const id = g && g.person_id ? String(g.person_id) : '';
    if (!id || id === selfId || out.some((x) => x.id === id)) continue;
    out.push({ id, name: String(g.name || '').trim() || 'Someone', via: 'shared' });
  }
  return out;
}

/**
 * Each button on one person's card: `{ act, label, enabled, reason, href? }`. PURE.
 *   isScreen      a screen in somebody's room (ctx.isScreen): it never places a call and never sends anything
 *   may           may this account call them? true / false / null (still finding out) — modules/profile.js mayCall
 *   noteStatus    can a message be left for them? 'ok' | 'refused' | 'none' (no screen) | 'error' | null (checking)
 *   callHref      where Call goes when it can (/call.html?person=...)
 */
export function actionsFor(person, { isScreen = false, may = null, noteStatus = null, callHref = '' } = {}) {
  const name = person && person.name ? person.name : '';
  // `short`: the few words shown ON a dimmed button, under its label (the whole reason is a tap away, and is the
  // button's description for a screen reader) -- a phone has no hover, so a reason only in a tooltip is no reason.
  const b = (act, enabled, reason = '', short = '', extra = {}) =>
    ({ act, label: ACTION_LABELS[act], enabled: !!enabled, reason, short: enabled ? '' : short, ...extra });
  const call = isScreen ? b('call', false, WHY.callOnScreen, 'From a phone')
    : may === null ? b('call', false, WHY.checking, 'Checking…')
      : may ? b('call', true, '', '', { href: callHref })
        : b('call', false, WHY.callNotAllowed, 'Not shared yet');
  const message = isScreen ? b('message', false, WHY.messageOnScreen, 'From a phone')
    : noteStatus === 'ok' ? b('message', true)
      : noteStatus === 'refused' ? b('message', false, WHY.messageRefused(name), 'Not allowed yet')
        : noteStatus === 'none' ? b('message', false, WHY.messageNoScreen(name), 'No screen yet')
          : noteStatus === 'error' ? b('message', false, WHY.messageError, 'Try again later')
            : b('message', false, WHY.checking, 'Checking…');
  return [call, message,
    b('picture', false, WHY.soon('picture'), 'Coming soon'),
    b('song', false, WHY.soon('song'), 'Coming soon'),
    b('video', false, WHY.soon('video'), 'Coming soon')];
}

// Nimrod at the bottom (modules/helper.js) asks for himself to be opened; the page that can open him over itself
// (modules/people.js) answers and calls `claim()`. Nobody answering: the helper says where he is instead.
export const HELPER_OPEN_TOPIC = 'helper/open';
// The switch's four verbs on this page (actions.js MODULE_VERBS `people`).
export const PEOPLE_VERB_TOPICS = Object.freeze({
  next: 'people/next', prev: 'people/prev', select: 'people/select', back: 'people/back',
});
export const HELPER_VERB_TOPICS = Object.freeze({ select: 'helper/select' });

/** What a GET of /api/people/<id>/notes/screens says about leaving a message. PURE. */
export function noteStatusFrom(status, body) {
  if (status === 403 || status === 404) return 'refused';
  if (status !== 200 || !body) return 'error';
  return Array.isArray(body.screens) && body.screens.length ? 'ok' : 'none';
}

// *** HOW A SWITCH WALKS IT: the person's "How you choose things" (settings_fields.js CHOOSE_MODE_KEY), as the
// transport bar reads it (transport_bar.js barScanModeOf). *** 'step' -> 'rows': next / prev walk the CARDS (you,
// each person, Connect, More, Nimrod), select goes into one and next / prev then walk its buttons, back comes out.
// 'point' (the default) -> 'one': next / prev walk every button in turn. FOR rows by default: five buttons on every
// card is a long walk for one switch. AGAINST, and it decides it: the person's own setting already says which they
// want, everywhere else on the site, and a page that answered differently would be the one place they had to learn.
export function scanModeOf(chooseMode) { return chooseMode === 'step' ? 'rows' : 'one'; }

/** One step of a cursor over `n` stops, wrapping (a walk that stops at its end strands one switch there). PURE. */
export function stepCursor(at, n, by) {
  if (!n) return 0;
  return (((Number(at) || 0) + by) % n + n) % n;
}

/**
 * The messages left for you, newest first: one per screen (the note it shows), at most `limit`. PURE.
 * `screens`: [{ name, note }] where `note` is that screen's current note row (modules/note.js currentNote) or null.
 */
export function incomingFrom(screens, { limit = 3, whenOf = (e) => Date.parse(e?.created_at || '') || 0 } = {}) {
  return (Array.isArray(screens) ? screens : [])
    .filter((s) => s && s.note && s.note.data && String(s.note.data.text || '').trim())
    .map((s) => ({ screen: s.name || '', text: String(s.note.data.text).trim(), author: String(s.note.data.author || '').trim(), at: whenOf(s.note) }))
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, limit));
}

// THE SETTINGS (Rule 1: every constant a setting or argued).
//   incoming  3   how many messages for you the page shows. FOR 3: one per screen covers almost everybody (a phone
//                 and a screen in a room), and the page stays about people, not a message list. Choices 0 (off) to 5.
//   closeAfterMs  120000  ON A SCREEN, a window opened over the page (Nimrod) closes by itself after this long with no
//                 press. CLAUDE.md's invariant: a screen must never enter a state only an input can leave when the
//                 person in front of it cannot give that input -- whoever opened it may have walked away. 2 minutes is
//                 long enough to read his longest answer, short enough that a stray press costs a few minutes of the
//                 page, not a night. Off a screen (a phone, a computer) it never closes by itself: the person who
//                 opened it is the one holding it. "Never" is a choice for somebody who wants it to stay.
export const INCOMING_CHOICES = Object.freeze([0, 1, 3, 5]);
export const CLOSE_CHOICES = Object.freeze([60000, 120000, 300000, 0]);
export const PEOPLE_SETTINGS = Object.freeze([
  { key: 'incoming', label: 'Messages for you to show', kind: 'choice', default: 3, level: 'standard',
    options: INCOMING_CHOICES.map((n) => ({ value: n, label: n ? String(n) : 'None' })),
    help: 'The newest message left on each of your screens, newest first.' },
  { key: 'closeAfterMs', label: 'On a screen, close Nimrod by himself after', kind: 'choice', default: 120000, level: 'advanced',
    options: CLOSE_CHOICES.map((ms) => ({ value: ms, label: ms ? `${ms / 60000} minute${ms === 60000 ? '' : 's'}` : 'Never' })),
    help: 'So a window opened on a screen nobody is pressing goes back to the people by itself.' },
]);
