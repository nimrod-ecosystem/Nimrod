// private_network.js - "WHEN A CALL CAN'T CONNECT": the guide to a private network between your own devices (chat's
// note CV, 2026-10-26). Its words live here so the suite reads what a visitor reads (nimrod_helper.js's pattern).
//
// Mike, 2026-10-26: "I feel like what we decided for the call fallback was people would have to use their own VPN. We
// should make it clear that that's the case, easy to set up, and clear that that's what you need to do if a call fails
// because of it." His ruling of 2026-09-08 (DECISIONS.md): no relay server of the project's; say so plainly; revisit
// only if it affects most calls; measure before spending. So a call that cannot connect points here, and the call page
// says it up front.
//
// TAILSCALE FIRST, argued: the free Personal plan covers a family (up to 6 users, unlimited devices) [Tailscale's
// pricing page, checked 2026-10-26]; it has apps for every phone and computer and a one-line install for a Pi; and
// sharing ONE device with somebody on another account is on every plan, reaching only that device [Tailscale's sharing
// docs, checked 2026-10-26]. Mike's own phone called the bench over it on 2026-10-26. Others are named so nobody thinks
// it is the only way. Nimrod is not affiliated with any of them.

export const PRIVATE_NETWORK_URL = '/private-network.html';
export const PRIVATE_NETWORK_TITLE = 'When a call can’t connect';

// The sentence a failed call shows, before its link (call_page.js) - one place for the words.
export const CALL_BLOCKED_TEXT = 'This call could not connect directly. Some networks block it (phones on mobile data, '
  + 'many care-facility and guest Wi-Fi networks). If this keeps happening, set up a private network between your devices.';
// ...and the short form on a screen, where a person may not be able to follow a link (call_notice.js, modules/call.js).
export const CALL_BLOCKED_SHORT = 'The call could not connect. Some networks block calls; a private network between '
  + 'the devices fixes it.';
// Said up front where calls are described (call.html), so nobody learns it from a failure.
export const CALL_UP_FRONT = 'Calls go straight from one device to the other, through no server of ours, so nobody '
  + 'else can see or hear them. Some networks block that. If yours does, a free private network between your devices '
  + 'fixes it.';

export const PRIVATE_NETWORK_STYLE = `
.pn{max-width:44rem;margin:0 auto}
.pn h1{font-size:1.6rem;margin:0 0 .4em}
.pn h2{font-size:1.2rem;margin:1.4em 0 .4em}
.pn ol,.pn ul{padding-left:1.3em}
.pn li{margin:.35em 0}
.pn code{background:var(--surface-alt);padding:.1em .35em;border-radius:4px;font-size:.92em}
.pn a{color:var(--link)}
.pn .pn-note{color:var(--text-muted);font-size:.92rem}
.pn h3{font-size:1.02rem;margin:1em 0 .3em}
.pn .pn-more{margin:1em 0;border:1px solid var(--border);border-radius:8px;padding:.5em .9em}
.pn .pn-more>summary{cursor:pointer;font-weight:600}
.pn .pn-copy{font:inherit;font-size:.85rem;padding:.1em .6em;margin-left:.3em;border:1px solid var(--border);border-radius:6px;
  background:var(--surface);color:var(--text);cursor:pointer}`;

// *** THIS DEVICE'S STEPS FIRST (row 2.167, Mike 2026-11-02: decisions (a) to (d) "yes"). *** The page reads which kind
// of device it is open on and shows that device's steps; the rest sit behind "Setting up a different device?". "The
// package manager" Mike asked for is the device's OWN installer (winget, apt, the app store): a web page cannot install
// a private network, so the page walks a person to the one that can. The device is GUESSED from the browser's own
// description of itself; a wrong guess costs one press (the other devices are right there), so it is never asked.
export const DEVICE_KINDS = Object.freeze(['windows', 'mac', 'android', 'iphone', 'pi', 'linux']);
export const DEVICE_LABELS = Object.freeze({
  windows: 'A Windows computer', mac: 'A Mac', android: 'An Android phone or tablet', iphone: 'An iPhone or iPad',
  pi: 'The screen (a Raspberry Pi)', linux: 'A Linux computer',
});
/** Which kind of device a browser says it is on, or null. `nav`: { userAgent, platform, maxTouchPoints }. */
export function deviceKindOf(nav = {}) {
  const ua = String(nav.userAgent || ''), pf = String(nav.platform || '');
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iphone';
  // An iPad asking for the desktop site says "Macintosh", but a Mac has no touch screen.
  if (/Macintosh/i.test(ua) && Number(nav.maxTouchPoints) > 1) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua) || /^Win/i.test(pf)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(pf)) return 'mac';
  // A Raspberry Pi's browser says Linux on ARM (aarch64 or armv7); other Linux is a computer.
  if (/Linux/i.test(ua) && /aarch64|arm/i.test(ua + ' ' + pf)) return 'pi';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return null;
}

const STORE_ANDROID = 'https://play.google.com/store/apps/details?id=com.tailscale.ipn';
const STORE_IOS = 'https://apps.apple.com/app/tailscale/id1470499037';
const DOWNLOAD = 'https://tailscale.com/download';
const WINGET = 'winget install tailscale.tailscale';
const PI_LINES = ['curl -fsSL https://tailscale.com/install.sh | sh', 'sudo tailscale up'];
const link = (href, text) => `<a href="${href}" rel="noopener" target="_blank">${text}</a>`;
const copyable = (line) => `<code>${line}</code> <button type="button" class="pn-copy" data-copy="${line.replace(/"/g, '&quot;')}">Copy</button>`;

/** The steps for one kind of device, as list items. Every device ends signed in to the same account. */
export function deviceStepsHTML(kind) {
  const signIn = '<li>Sign in with your Tailscale account, the same one on every device, and turn it on.</li>';
  switch (kind) {
    case 'windows': return `<li>Open a terminal (search for "Terminal" in the Start menu), and paste ${copyable(WINGET)}
      Or download the installer from ${link(DOWNLOAD, 'tailscale.com/download')}.</li>${signIn}`;
    case 'mac': return `<li>Install Tailscale from the Mac App Store, or from ${link(DOWNLOAD, 'tailscale.com/download')}.</li>${signIn}`;
    case 'android': return `<li>Install Tailscale from ${link(STORE_ANDROID, 'Google Play')}.</li>${signIn}
      <li>Allow the VPN when your phone asks: that is the private network.</li>`;
    case 'iphone': return `<li>Install Tailscale from ${link(STORE_IOS, 'the App Store')}.</li>${signIn}
      <li>Allow the VPN configuration when your phone asks: that is the private network.</li>`;
    // (row 2.167, decision (c)) Nimrod's own installer does it when asked: NIMROD_VPN=1, and a QR code to scan.
    case 'pi': return `<li>Setting the screen up with Nimrod's installer? Put ${copyable('NIMROD_VPN=1')} in front of
      the install command, and scan the code it shows with your phone to sign in.</li>
      <li>Already set up: somebody comfortable with a terminal runs, once, ${copyable(PI_LINES[0])} and then
      ${copyable(PI_LINES[1])}, and opens the sign-in link it prints (on a phone is fine).</li>`;
    case 'linux': return `<li>In a terminal, run ${copyable(PI_LINES[0])} and then ${copyable(PI_LINES[1])}</li>
      <li>Open the sign-in link it prints and sign in.</li>`;
    default: return '';
  }
}

export function privateNetworkHTML({ device = null } = {}) {
  const here = DEVICE_KINDS.includes(device) ? device : null;
  const others = DEVICE_KINDS.filter((k) => k !== here);
  const section = (k) => `<section class="pn-dev" data-device="${k}"><h3>${DEVICE_LABELS[k]}</h3><ol>${deviceStepsHTML(k)}</ol></section>`;
  return `<article class="pn" data-private-network>
  <h1>${PRIVATE_NETWORK_TITLE}: a private network between your devices</h1>
  <p>Nimrod calls go straight from one device to the other, through no server of ours, so nobody else can see or hear
    them. Some networks block that: phones on mobile data, and many care-facility and guest Wi-Fi networks. When a call
    says it could not connect directly, the fix is a private network between your own devices. It is free and takes
    about ten minutes.</p>

  <h2>Tailscale (the easiest)</h2>
  <p>Free for personal use: up to six people, any number of devices.</p>
  <ol>
    <li><b>Make one Tailscale account</b> at ${link('https://tailscale.com', 'tailscale.com')}.
      Sign in with the same account on every device on the call.</li>
    <li><b>Put it on both ends of the call:</b> this device, and the screen or phone you call.</li>
    <li><b>Call with Tailscale on at both ends.</b> That is all: the call finds its way through it.</li>
  </ol>
  <p data-check-it><b>Check it works</b> before anybody needs a call: on ${link('/call.html', 'the Calls page')}, choose
    who to call and press <b>Check the connection</b>. It makes a test connection to the screen, with no camera or
    microphone, and says whether it connects directly, through your private network, or not at all.</p>
  ${here ? `<h2 data-this-device>This device: ${DEVICE_LABELS[here].replace(/^(A|An|The) /, (m) => m.toLowerCase())}</h2>
  <ol data-here>${deviceStepsHTML(here)}</ol>` : ''}
  <details class="pn-more" data-other-devices${here ? '' : ' open'}>
    <summary>${here ? 'Setting up a different device?' : 'Choose the device you are setting up'}</summary>
    ${others.map(section).join('')}
  </details>

  <h2>Someone on another account</h2>
  <p>A relative or friend with their own Tailscale account can be given just the screen. In Tailscale's admin console,
    open Machines, choose the screen, choose <b>Share</b>, and send them the invite link. They accept it with their own
    account and reach only that one device. Invite links expire after 30 days and should be kept like a password.</p>

  <h2>Other private networks</h2>
  <ul>
    <li><b>ZeroTier:</b> much like Tailscale.</li>
    <li><b>WireGuard:</b> for people who want to run it themselves.</li>
  </ul>
  <p>Any of them works, as long as both devices on the call are on it.</p>
  <p class="pn-note">Nimrod is not affiliated with Tailscale, ZeroTier or WireGuard. Calls that already connect do not
    need any of this.</p>
</article>`;
}

/** Draw the guide into `root`, this device's steps first. `nav`: the browser's navigator, or a stand-in for a suite. */
export function mountPrivateNetworkPage(root, { nav = (typeof navigator !== 'undefined' ? navigator : {}) } = {}) {
  if (!root) return null;
  const device = deviceKindOf(nav);
  root.innerHTML = privateNetworkHTML({ device });
  // Copy: the line to the clipboard, and the button says so. Where the browser will not copy, the line is still there
  // to select by hand.
  root.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    const done = (ok) => { b.textContent = ok ? 'Copied' : 'Select it to copy'; };
    try { Promise.resolve(nav.clipboard?.writeText?.(b.dataset.copy)).then(() => done(!!nav.clipboard), () => done(false)); }
    catch { done(false); }
  });
  return { root, device };
}
