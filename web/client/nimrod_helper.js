// nimrod_helper.js — THE NIMROD HELPER FOR THIS COMPUTER, AS THE SITE SEES IT (DECISIONS 2026-10-07 item 3).
//
// Mike, 2026-10-07: *"Is this how people will work with their own local AI on the site? I think I'd like the
// standard user experience as much as possible"* (about starting the speech program from a terminal), then:
// *"We were already discussing a larger package for people to install. If it's necessary for this then make
// it part of that package."* So the speech program ships inside ONE install, the Nimrod helper
// (web/nimrod_helper), with the media agent. This file is what the site knows about it:
//   * where its page is (/helper.html, linked from the ⚙ menu when no speech program answers, page_links.js),
//   * how to ask whether it is running here (the speech program's own hello; the helper's /status),
//   * the browser's own voice typing, the choice that needs no install, named with WHO hears the sound,
//   * the page itself (helperPageHTML / mountHelperPage).
//
// *** THE BROWSER'S OWN VOICE TYPING IS OFFERED, NEVER PICKED. *** input_speech.js argues why the default
// recogniser is 'local' (the room's sound stays here): the browser's sends the room's sound to the browser's
// maker. When nothing local answers, the screen OFFERS it as a row a person presses, with who receives the
// sound in the row's own words; nothing switches to it by itself (inbox AZ item 1: "easy to find and plainly
// worded").

import { LOCAL_URL } from './speech_engines.js';

export const HELPER_PAGE = '/helper.html';
// The helper's own status page (web/nimrod_helper/settings.py DEFAULTS.statusPort).
export const HELPER_STATUS_PORT = 8790;
export const helperStatusUrl = (port = HELPER_STATUS_PORT) => `http://127.0.0.1:${port}/status`;

// *** WHERE THE DOWNLOADS ARE. EMPTY UNTIL ONE IS PUBLISHED. *** Building the Windows setup.exe needs Inno
// Setup on the build machine and a place to put the file (a GitHub release, the site itself), and signing it
// is a cost decision; all three are Mike's (the 2026-10-07 report). Until a URL is here the page says plainly
// that the download is not ready, rather than offering a link that goes nowhere.
export const HELPER_DOWNLOADS = Object.freeze({
  windows: Object.freeze({ url: '', signed: false }),
  mac: null,
  linux: null,
});

// How long to wait for the speech program's hello before saying it is not answering. 1.5 s: on the same
// computer it answers in milliseconds once running; a model still loading does not answer at all.
export const PROBE_MS = 1500;

/**
 * Who receives the sound when the browser's own voice typing is used, from the browser's user agent. Chrome:
 * Google. Edge: Microsoft. Safari (and every browser on an iPhone or iPad, which all run on Safari's engine):
 * Apple [training knowledge, each vendor's documented behaviour]. Anything else: said without a name.
 */
export function browserVoiceMaker(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  const s = String(ua || '');
  if (/\bEdg(e|A|iOS)?\//.test(s)) return 'Microsoft';
  if (/\b(CriOS|FxiOS|EdgiOS)\//.test(s) || (/\bSafari\//.test(s) && /\bVersion\//.test(s) && !/\b(Chrome|Chromium|Android)\b/.test(s))) return 'Apple';
  if (/\b(OPR|SamsungBrowser|YaBrowser|Vivaldi)\//.test(s)) return 'the browser’s maker';
  if (/\b(Chrome|Chromium)\//.test(s)) return 'Google';
  return 'the browser’s maker';
}

/** Does this browser have voice typing of its own (Chrome, Edge, Safari do; Firefox does not)? */
export function browserHasVoiceTyping(view = (typeof window !== 'undefined' ? window : null)) {
  return !!(view && (view.SpeechRecognition || view.webkitSpeechRecognition));
}

/** The ⚙ menu row's words, and the page's. */
export function browserVoiceLabel(maker = browserVoiceMaker()) {
  return `Use this browser’s own voice typing (it sends what it hears to ${maker})`;
}

/**
 * Is the speech program answering on this computer? Opens the same WebSocket the screen does and waits for its
 * hello. Resolves { answering, engine } and never rejects. A WebSocket, not a fetch of /health: a page on
 * another site may not READ a /health answer (no CORS header there), but a WebSocket hello it may.
 */
export function probeSpeech({ url = LOCAL_URL, WebSocketImpl = (typeof WebSocket !== 'undefined' ? WebSocket : null),
  timeoutMs = PROBE_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let ws = null;
    let timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      try { if (timer !== null) clearTimer(timer); } catch { /* gone */ }
      try { ws?.close(); } catch { /* closed */ }
      resolve(r);
    };
    if (!WebSocketImpl) { finish({ answering: false, engine: null, why: 'no WebSocket' }); return; }
    try { ws = new WebSocketImpl(url); } catch { finish({ answering: false, engine: null, why: 'refused' }); return; }
    timer = setTimer(() => finish({ answering: false, engine: null, why: 'no answer' }), timeoutMs);
    ws.onopen = () => { try { ws.send(JSON.stringify({ type: 'hello', rate: 16000 })); } catch { /* closing */ } };
    ws.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m && m.kind === 'hello') finish({ answering: true, engine: m.engine || null, why: 'ok' });
      else if (m && m.kind === 'error') finish({ answering: true, engine: null, why: m.error || 'error' });
    };
    ws.onerror = () => {};
    ws.onclose = () => finish({ answering: false, engine: null, why: 'closed' });
  });
}

/**
 * Is the helper running here, and what are its parts doing? Its /status (web/nimrod_helper/supervisor.py).
 * Resolves { running, version, parts } and never rejects. Not running, or a site the helper does not allow:
 * { running: false } - the browser hides the answer either way, so the two cannot be told apart from here.
 */
export async function probeHelper({ port = HELPER_STATUS_PORT, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null),
  timeoutMs = PROBE_MS } = {}) {
  if (!fetchImpl) return { running: false, parts: [] };
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(helperStatusUrl(port), { cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) });
    if (!r || !r.ok) return { running: false, parts: [] };
    const j = await r.json();
    if (!j || j.helper !== 'nimrod') return { running: false, parts: [] };
    return { running: true, version: j.version || '', parts: Array.isArray(j.parts) ? j.parts : [] };
  } catch {
    return { running: false, parts: [] };
  } finally {
    if (t) clearTimeout(t);
  }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const STATE_WORDS = { running: 'running', starting: 'starting', restarting: 'starting again', failed: 'could not start',
  waiting: 'waiting', stopped: 'stopped' };

/** The "on this computer now" lines, from the two probes (null = still checking). */
export function hereHTML({ speech = null, helper = null } = {}) {
  const lines = [];
  if (!speech) lines.push('<li>Checking for a speech program on this computer…</li>');
  else if (speech.answering) lines.push(`<li data-here-speech="yes"><b>A speech program is answering on this computer.</b> Spoken commands and subtitles can use it.</li>`);
  else lines.push('<li data-here-speech="no"><b>No speech program is answering on this computer.</b></li>');
  if (helper?.running) {
    const parts = (helper.parts || []).map((p) => `${esc(p.label)}: ${esc(STATE_WORDS[p.state] || p.state)}${p.note ? ` (${esc(p.note)})` : ''}`);
    lines.push(`<li data-here-helper="yes">The Nimrod helper is running here${helper.version ? ` (version ${esc(helper.version)})` : ''}.`
      + `${parts.length ? ` ${parts.join('; ')}.` : ''}</li>`);
  } else if (helper) {
    lines.push('<li data-here-helper="no">The Nimrod helper is not running here (or this page is not allowed to ask it).</li>');
  }
  return `<ul class="nh-here">${lines.join('')}</ul>`;
}

/** The page's words. Pure, so the suite reads exactly what a visitor reads. */
export function helperPageHTML({ downloads = HELPER_DOWNLOADS, maker = browserVoiceMaker(), hasVoiceTyping = true,
  here = '' } = {}) {
  const win = downloads?.windows || null;
  const download = win && win.url
    ? `<p><a class="nh-download" data-download="windows" href="${esc(win.url)}">Download the Nimrod helper for Windows</a></p>
       ${win.signed ? '' : `<p class="nh-soft">The download is not signed yet, so Windows may say “Windows protected your PC”
       the first time. If you got it from this page, choose <b>More info</b>, then <b>Run anyway</b>.</p>`}`
    : '<p data-download="none"><b>The Windows download is not ready yet.</b> This page will have it when it is. Until then, this browser’s own voice typing works with nothing installed (below).</p>';
  const noInstall = hasVoiceTyping
    ? `<p>This browser’s own voice typing works with nothing installed, but <b>it sends what it hears to ${esc(maker)}</b>.
       To use it on a screen: the ⚙ menu, <b>Devices</b>, <b>Voice</b>, then “What writes down what is said”. When a screen
       finds no speech program on its computer, its ⚙ menu offers the same choice:</p>
       <p class="nh-quote">“${esc(browserVoiceLabel(maker))}”</p>
       <p class="nh-soft">Nothing switches to it by itself; it is used only once somebody chooses it.</p>`
    : '<p>This browser has no voice typing of its own (Chrome, Edge and Safari have one). Spoken commands here need the helper.</p>';
  return `
  <h1>Get the Nimrod helper for this computer</h1>
  <p class="nh-lead">A small program for this computer that does two things a web page can’t: it turns speech into
  words <b>here, on this computer</b>, and it lets your screens show the photos and videos in a folder here.</p>

  <section data-section="here"><h2>On this computer now</h2><div data-here>${here || hereHTML()}</div></section>

  <section data-section="download"><h2>Download</h2>
  ${download}
  <p class="nh-soft">For Windows 10 and 11. Mac and Linux are not ready yet.</p></section>

  <section data-section="installs"><h2>What it installs</h2>
  <ul>
    <li><b>The speech program.</b> It turns what the microphone hears into words, on this computer, with Whisper (an
      open speech model). The first time it starts, it downloads the model: about 500 MB, once.</li>
    <li><b>The media agent.</b> It lets your screens show the photos and videos in a folder on this computer. It is
      off until you choose a folder.</li>
    <li><b>Its own copy of Python,</b> the language both are written in. It doesn’t touch any Python already on the
      computer.</li>
  </ul>
  <p>Everything goes in your own user folder, so it needs no administrator password:</p>
  <ul>
    <li><code>AppData\\Local\\Programs\\Nimrod Helper</code>: the program</li>
    <li><code>AppData\\Local\\Nimrod Helper</code>: its settings, its logs and the speech model</li>
  </ul></section>

  <section data-section="does"><h2>What it does</h2>
  <ul>
    <li>It starts when you sign in to Windows, and starts a part again if it stops. You can turn that off in
      Task Manager, under <b>Startup apps</b>.</li>
    <li>It answers this computer only. Other computers on your network can’t reach it.</li>
    <li>It opens no microphone or camera of its own. The web page asks for the microphone, as it always does, and
      sends the sound to the helper on this same computer.</li>
    <li>You can see what it is doing at <code>127.0.0.1:${HELPER_STATUS_PORT}</code> on this computer (the Start menu has a
      shortcut, “Nimrod helper status”).</li>
  </ul></section>

  <section data-section="private"><h2>What it hears and sees stays on this computer</h2>
  <ul>
    <li>The sound goes from the page to the helper on this computer and is turned into words there. The helper
      doesn’t keep the sound.</li>
    <li>Photos and videos go from your folder to the screens you connect, and nowhere else.</li>
    <li>Nothing it hears or sees is sent to Nimrod or to anyone else.</li>
    <li>What it does fetch from the internet: the speech model, once, from Hugging Face. And when you connect a
      folder, your Nimrod account is told this computer’s name and how to reach it, not what is in the folder.</li>
  </ul></section>

  <section data-section="no-install"><h2>Without installing anything</h2>
  ${noInstall}</section>

  <section data-section="remove"><h2>How to remove it</h2>
  <p>On Windows: <b>Settings</b>, <b>Apps</b>, <b>Installed apps</b>, <b>Nimrod helper</b>, <b>Uninstall</b>.</p>
  <p>That removes the program, its settings and logs, the speech model it downloaded, its Start menu shortcuts,
  and starting with Windows. Nothing of it is left behind.</p>
  <p class="nh-soft">To keep it but stop it starting with Windows: Task Manager, <b>Startup apps</b>, Nimrod helper,
  <b>Disable</b>.</p></section>`;
}

export const HELPER_STYLE = `
  .nh{max-width:44rem;margin:0 auto}
  .nh h1{font-size:1.6rem;line-height:1.25;margin:.25rem 0 .5rem}
  .nh h2{font-size:1.15rem;margin:1.75rem 0 .4rem}
  .nh .nh-lead{font-size:1.05rem}
  .nh .nh-soft{color:var(--text-muted)}
  .nh .nh-quote{padding:.5rem .75rem;border-left:3px solid var(--accent, currentColor);background:var(--surface)}
  .nh code{background:var(--surface);padding:0 .25rem;border-radius:4px;overflow-wrap:anywhere}
  .nh a{color:var(--link)}
  .nh .nh-download{display:inline-block;padding:.6rem 1rem;border-radius:8px;background:var(--accent);color:var(--bg);
    text-decoration:none;font-weight:600;min-height:44px}
  .nh ul{padding-left:1.25rem}
`;

/** Mount the page into `el`, then ask whether the speech program and the helper are running here. */
export function mountHelperPage(el, { probe = probeSpeech, probeH = probeHelper, downloads = HELPER_DOWNLOADS,
  maker = browserVoiceMaker(), hasVoiceTyping = browserHasVoiceTyping() } = {}) {
  el.classList?.add('nh');
  el.innerHTML = helperPageHTML({ downloads, maker, hasVoiceTyping });
  const here = el.querySelector('[data-here]');
  let speech = null;
  let helper = null;
  const paint = () => { if (here) here.innerHTML = hereHTML({ speech, helper }); };
  const ready = Promise.all([
    Promise.resolve(probe()).then((r) => { speech = r; paint(); }),
    Promise.resolve(probeH()).then((r) => { helper = r; paint(); }),
  ]);
  return { ready, state: () => ({ speech, helper }) };
}
