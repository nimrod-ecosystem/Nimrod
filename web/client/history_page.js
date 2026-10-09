// history_page.js — "WHERE YOUR HISTORY IS KEPT": the menu page that says it plainly, and changes it (row 2.58).
//
// Chat's ask (note BG item 1.3): *"The site says plainly where a person's history lives, and offers a second place
// when it is only on one device."* So each kind of history (history_place.js HISTORY_KINDS) gets: what it is, where it
// is kept now in one plain sentence (`whereWords`), a button per place it can go, and - when it is only on this
// device - one line with a button: "Only on this screen. A reset would lose it. Keep a copy in your Nimrod folder?"
// A line, not a dialog: nothing here interrupts anybody, and a screen nobody touches simply keeps going.
//
// ON THE PEOPLE TAB (kiosk.js), argued: the choice is the person's (one row per person, history_place.js header), and
// that tab is who the screen is for. AGAINST "This screen": the folder half is per device - which is why the page says,
// per kind, what THIS device does with the person's choice.
//
// NO MOVES are handed to the menu (the user_folders_page.js reasoning): "Allow it again" opens the browser's own
// prompt, which a switch cannot answer. A keyboard and a pointer reach every button.

import { HISTORY_KINDS, KIND_IDS, PLACE_WORDS, whereWords, secondPlaceOffer } from './history_place.js';

export const HISTORY_PAGE = 'history-place';
export const HISTORY_ITEMS = [
  { kind: 'item', id: HISTORY_PAGE, label: 'Where your history is kept',
    hint: 'what played, game results, talk board words: this device, your Nimrod folder, or with us', page: HISTORY_PAGE },
];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const say = (text, attrs = '') => (text ? `<p class="st-hint" style="display:block;margin:0 0 8px" ${attrs}>${esc(text)}</p>` : '');
const button = (act, label, hint = '', data = {}) => `<button class="st-item" type="button" data-act="${act}"${
  Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}>
    <span class="st-label">${esc(label)}</span>${hint ? `<span class="st-hint">${esc(hint)}</span>` : ''}</button>`;

const PLACE_HINTS = Object.freeze({
  device: 'nothing to set up; nothing leaves this device',
  folder: 'a copy in the Data folder of your Nimrod folder, on each device that has one',
  us: 'follows the person to another device; what is on this device now is sent too',
  log: 'as it was before: every entry, in the site\'s log',
});

/** The page's markup for a `host.status()` reading. Pure. */
export function historyHtml(s) {
  const parts = [];
  parts.push(say('Levels and points are not history: they stay with the person on every screen. History is every play, '
    + 'every answer and every word, and it goes where you choose.'));
  if (!s.person) {
    parts.push(say('This screen does not know whose it is yet, so history stays on this device. Choose who the screen is '
      + 'for (People), then come back here.', 'data-hp-noperson'));
  }
  const cap = s.cap || null;
  for (const kind of KIND_IDS) {
    const k = HISTORY_KINDS[kind];
    const place = s.places[kind];
    const withUs = s.withUs ? s.withUs[k.stream] || { rows: 0, counted: 0 } : null;
    parts.push(`<div class="st-head" data-hp-section="${kind}">${esc(k.title)}</div>`);
    parts.push(say(`${k.what[0].toUpperCase()}${k.what.slice(1)}.`));
    parts.push(say(whereWords(kind, place, { folder: s.folder, withUs, cap, waiting: s.waiting ? s.waiting[kind] : undefined }),
      `data-hp-where="${kind}"`));
    // GAME RESULTS AND WORDS LEFT THE SITE'S LOG (2026-10-08, Mike's ruling: their own system by default, the server
    // the opt-in). What the log held stays and is still shown; what another device no longer sees, said plainly.
    if (kind !== 'plays' && place !== 'log') {
      parts.push(say('What the site\'s log already held stays there and still shows.' + (place === 'us' ? ''
        : ' New entries are kept where you choose, so another device - a family member\'s phone, say - shows only those '
          + 'older ones, not new ones from here.'), `data-hp-before="${kind}"`));
    }
    const offer = s.person ? secondPlaceOffer(kind, place, { folder: s.folder, canUs: s.canUs }) : null;
    if (offer) {
      parts.push(say(offer.text, `data-hp-offer="${kind}"`));
      for (const o of offer.offers) {
        parts.push(button('place', o === 'folder' ? 'Keep a copy in your Nimrod folder' : 'Keep a copy with us', '',
          { kind, place: o }));
      }
    }
    if (s.person) {
      for (const p of k.places) {
        if (p === 'us' && !s.canUs) continue;
        // The site's full log is offered only to a person already on it (2026-10-08): it is the place that cannot be
        // capped or removed from, and "with us" is the opt-in now. Whoever is on it sees it and can move off.
        if (p === 'log' && place !== 'log') continue;
        parts.push(button('place', `${PLACE_WORDS[p]}${p === place ? ' (now)' : ''}`, PLACE_HINTS[p], { kind, place: p }));
      }
    }
    if (place === 'folder' && s.folder === 'permission') parts.push(button('allow-folder', 'Allow it again', 'the browser asks'));
    if (withUs && (withUs.rows || withUs.counted)) {
      parts.push(say(`Kept with us: ${Number(withUs.rows || 0).toLocaleString('en-US')} entries`
        + (withUs.counted ? `, and ${Number(withUs.counted).toLocaleString('en-US')} older ones counted.` : '.'), `data-hp-kept="${kind}"`));
      parts.push(button('remove', 'Remove what is kept with us', 'only this kind; this device and your folder keep theirs', { kind }));
    }
    const l = s.last && s.last[kind];
    if (l && l.why && SECOND(l.place)) {
      parts.push(say(l.why === 'not opted in' ? 'The last copy waited for your choice to be saved; it tries again.'
        : `The last copy did not go through (${l.why}). It tries again; nothing is lost on this device.`, `data-hp-last="${kind}"`));
    }
  }
  parts.push('<p class="st-hint" style="display:block;margin:8px 0 0" role="status" data-hp-msg></p>');
  return parts.join('\n');
}
const SECOND = (p) => p === 'folder' || p === 'us';

/** Draw the page into `el` and wire its buttons. Returns { ready, refresh, act, destroy }. */
export function renderHistoryPage(el, { host } = {}) {
  let torn = false;
  let message = '';
  const draw = async () => {
    if (!host) { el.innerHTML = say('History is kept on this device here.'); return null; }
    let s;
    try { s = await host.status(); } catch (err) { el.innerHTML = say(`Could not read it: ${String((err && err.message) || err)}`); return null; }
    if (torn) return s;
    el.innerHTML = historyHtml(s);
    const m = el.querySelector('[data-hp-msg]');
    if (m) m.textContent = message;
    return s;
  };
  async function act(name, data = {}) {
    message = '';
    try {
      if (name === 'place') {
        await host.setPlace(data.kind, data.place);
        message = `${HISTORY_KINDS[data.kind]?.title || 'History'}: ${PLACE_WORDS[data.place]}.`;
      } else if (name === 'allow-folder') {
        const p = await host.allowFolder();
        message = p === 'granted' ? 'Allowed. What was waiting is being copied to your Nimrod folder now.'
          : 'The browser did not allow it. History stays on this device until it does.';
      } else if (name === 'remove') {
        const r = await host.removeWithUs(data.kind);
        message = r.ok ? `Removed ${Number(r.rows || 0).toLocaleString('en-US')} entries kept with us.` : 'Could not remove it just now. Try again.';
      } else return;
    } catch (err) { message = `That did not work: ${String((err && err.message) || err)}`; }
    if (!torn) await draw();
  }
  const onClick = (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !el.contains(b) || b.disabled) return;
    act(b.dataset.act, { kind: b.dataset.kind || '', place: b.dataset.place || '' });
  };
  el.addEventListener('click', onClick);
  // A menu page is dropped, not destroyed, when the menu moves on: the page stops listening once it is off the page.
  let off = null;
  off = host?.subscribe ? host.subscribe(() => {
    if (torn) return;
    if (el.isConnected === false) { torn = true; try { off?.(); } catch { /* gone */ } return; }
    draw();
  }) : null;
  el.innerHTML = say('Looking…');
  const ready = draw();
  return {
    ready, refresh: draw, act,
    destroy() { torn = true; el.removeEventListener('click', onClick); try { off?.(); } catch { /* gone */ } },
  };
}

/** Ready to hand to a settings menu's `pages` (the shape userFoldersPage returns). */
export function historyPage(opts = {}) {
  return { title: 'Where your history is kept', render(el) { renderHistoryPage(el, opts); } };
}
