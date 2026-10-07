// spotify_connect.js — "CONNECT SPOTIFY": THE STEPS, IN PLAIN WORDS, WITH THE RETURN ADDRESS READY TO COPY. Row 2.61.
//
// Mike, 2026-10-07, after the embed played full songs: *"So the app route is a better option to leave open for the
// user and make it so they can connect it as easily as they want."* The embed is the no-setup route; this is the
// fuller one (playing on another speaker, the playlist's songs for the site's weighted shuffle, the song's name and
// cover). What stands in the way is making a Spotify app, so this walks it:
//   1. developer.spotify.com/dashboard, signed in with the Spotify login that has Premium;
//   2. Create app (any name);
//   3. the Redirect URI - THIS site's exact /spotify_callback.html, shown in a box with a Copy button;
//   4. tick Web API, agree, Save;
//   5. copy the Client ID, paste it here - saved ONCE with the account's Spotify key (recommend_search.py), so the
//      keys page and every music panel use the same one;
//   then Connect.
//
// *** ON A SCREEN, STEP 1 SHOWS THE ADDRESS AND A CODE TO SCAN, AND NOTHING OPENS (page_links.js's rule, argued
// there). *** A Spotify developer page opened on a screen covers it until somebody closes it. Off a screen it is an
// ordinary link that opens a new tab. On a screen page that is really somebody's computer (signed in, an ordinary
// browser window - page_links.js `canOpenHere`), the link is offered beside the address, as "Open it here" is.
//
// WHAT IS CHECKED AND WHAT IS NOT: "up to five people" and Premium for the app's owner are music_spotify.js's list,
// read on developer.spotify.com 2026-09-30. "User Management" (where those people are added) and the exact button
// names (Create app, Redirect URIs, Web API) are from the keys page's steps and training knowledge - Spotify renames
// things; check them against the dashboard on the first real setup.
//
// This file draws; modules/music.js owns the state and the presses. Every button carries `data-act` and `data-walk`,
// so a switch reaches the Copy and Save buttons the same as a touch.

import { qrSVG } from './qr.js';

export const SPOTIFY_DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
export const SPOTIFY_DASHBOARD_ADDRESS = 'developer.spotify.com/dashboard';

// Every word the steps show, in one place, so the suite can hold them to the house rules (plain words, nobody named).
export const CONNECT_WORDS = Object.freeze({
  intro: 'To play your own Spotify here, make a free Spotify app once. It takes about five minutes, on a computer.',
  premium: 'The Spotify login that makes the app needs Spotify Premium. Anyone else who will connect with their own '
    + 'Spotify login has to be added under User Management in the app’s settings first (Spotify allows up to five '
    + 'people for an app like this).',
  step1Off: 'Go to {dev} and sign in with your Spotify login.',
  step1Screen: 'On your phone or computer, open {dev} and sign in with your Spotify login.',
  step2: 'Press Create app. Any name and description will do.',
  step3: 'Under Redirect URIs, paste this address exactly, then press Add:',
  step4: 'Tick Web API, agree to Spotify’s terms, and press Save.',
  step5: 'Open the app’s Settings, copy its Client ID, and paste it here:',
  once: 'The Client ID is saved once, for every music panel and the keys page. It is not a secret. The Client secret '
    + 'is never needed for playing.',
  notSecure: 'Spotify only accepts a return address on https (or http://127.0.0.1 on this machine), and this page is '
    + 'not on one, so connecting will not work from this address.',
  copy: 'Copy',
  copied: 'Copied.',
  copyFailed: 'Could not copy. Select the address and copy it by hand.',
  save: 'Save and connect',
  idLabel: 'Client ID',
  openHere: 'Open it here',
  screenNote: 'Nothing opens on this screen: it keeps showing what it was showing.',
});

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Does Spotify accept this return address? https, or a loopback IP literal on http ("localhost is not allowed",
 *  music_spotify.js's checked list). PURE. */
export function callbackAccepted(callback) {
  try {
    const u = new URL(String(callback || ''));
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === '[::1]');
  } catch { return false; }
}

/** A code to scan for an address on another site (step 1 on a screen), or '' when there are no colours or the
 *  encoder fails - the address in words always shows. */
export function addressQR(url, colours) {
  if (!colours || !colours.dark || !colours.light) return '';
  try {
    return qrSVG(url, { level: 'M', quiet: 4, dark: colours.dark, light: colours.light, title: `Scan to open ${url}` });
  } catch (err) { console.error('spotify_connect: qr', err); return ''; }
}

/**
 * The steps, as HTML. `callback` is this site's /spotify_callback.html; `isScreen` the kiosk's own word;
 * `openHere` (a screen that is really somebody's computer) adds the link beside the address; `colours` for the
 * code; `draftId` what has been typed so far; `note` the last thing a press said.
 */
export function connectHelperHtml({ callback = '', isScreen = false, openHere = false, colours = null, draftId = '',
  note = '' } = {}) {
  const W = CONNECT_WORDS;
  const btn = (act, label, extra = '') => `<button type="button" class="mu-btn" data-act="${act}" data-walk${extra}>${esc(label)}</button>`;
  const link = `<a href="${esc(SPOTIFY_DASHBOARD_URL)}" target="_blank" rel="noopener noreferrer" data-sp-dev-link>${esc(SPOTIFY_DASHBOARD_ADDRESS)}</a>`;
  let step1;
  if (isScreen) {
    const qr = addressQR(SPOTIFY_DASHBOARD_URL, colours);
    step1 = `${esc(W.step1Screen).replace('{dev}', `<b data-sp-dev-address>${esc(SPOTIFY_DASHBOARD_ADDRESS)}</b>`)}
      ${qr ? `<div data-sp-dev-qr style="width:min(160px,60%);margin:6px 0">${qr}</div>` : ''}
      ${openHere ? `<span class="mu-hint">${esc(W.openHere)}: ${link}</span>` : `<span class="mu-hint" data-sp-screen-note>${esc(W.screenNote)}</span>`}`;
  } else {
    step1 = esc(W.step1Off).replace('{dev}', link);
  }
  return `<div class="mu-connect" data-sp-helper>
      <p class="mu-hint">${esc(W.intro)}</p>
      <ol class="mu-steps">
        <li>${step1}</li>
        <li>${esc(W.step2)}</li>
        <li>${esc(W.step3)}
          <div class="mu-row"><input type="text" readonly data-sp-callback value="${esc(callback)}" aria-label="the return address to paste into Spotify">
          ${btn('sp-copy', W.copy)}</div>
          ${callbackAccepted(callback) ? '' : `<span class="mu-msg" data-sp-not-secure>${esc(W.notSecure)}</span>`}</li>
        <li>${esc(W.step4)}</li>
        <li>${esc(W.step5)}
          <div class="mu-row"><input type="text" data-sp-id value="${esc(draftId)}" placeholder="32 letters and numbers"
            aria-label="${esc(W.idLabel)}" autocomplete="off" spellcheck="false" maxlength="64">
          ${btn('sp-save', W.save)}</div></li>
      </ol>
      ${note ? `<p class="mu-msg" data-sp-note role="status">${esc(note)}</p>` : ''}
      <p class="mu-hint">${esc(W.premium)}</p>
      <p class="mu-hint">${esc(W.once)}</p>
    </div>`;
}

/** Put `text` on the clipboard. True when it went; false asks the caller to say "copy it by hand". */
export async function copyText(text, { clipboard = (typeof navigator !== 'undefined' ? navigator.clipboard : null),
  input = null } = {}) {
  try {
    if (clipboard && typeof clipboard.writeText === 'function') { await clipboard.writeText(String(text)); return true; }
  } catch { /* fall through to selecting it */ }
  try {
    if (input && typeof input.select === 'function') {
      input.select();
      const doc = input.ownerDocument;
      if (doc && typeof doc.execCommand === 'function' && doc.execCommand('copy')) return true;
    }
  } catch { /* nothing more to try */ }
  return false;
}
