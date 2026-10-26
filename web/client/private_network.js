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
.pn .pn-note{color:var(--text-muted);font-size:.92rem}`;

export function privateNetworkHTML() {
  return `<article class="pn" data-private-network>
  <h1>${PRIVATE_NETWORK_TITLE}: a private network between your devices</h1>
  <p>Nimrod calls go straight from one device to the other, through no server of ours, so nobody else can see or hear
    them. Some networks block that: phones on mobile data, and many care-facility and guest Wi-Fi networks. When a call
    says it could not connect directly, the fix is a private network between your own devices. It is free and takes
    about ten minutes.</p>

  <h2>Tailscale (the easiest)</h2>
  <p>Free for personal use: up to six people, any number of devices.</p>
  <ol>
    <li><b>Make one Tailscale account</b> at <a href="https://tailscale.com" rel="noopener" target="_blank">tailscale.com</a>.
      Sign in with the same account on every device below.</li>
    <li><b>Your phone:</b> install the Tailscale app from the App Store or Google Play, sign in, and turn it on.</li>
    <li><b>A computer:</b> install Tailscale from <a href="https://tailscale.com/download" rel="noopener" target="_blank">tailscale.com/download</a> and sign in.</li>
    <li><b>The screen</b> (a Raspberry Pi): somebody comfortable with a terminal runs, once,
      <code>curl -fsSL https://tailscale.com/install.sh | sh</code> and then <code>sudo tailscale up</code>, and opens
      the sign-in link it prints.</li>
    <li><b>Call with Tailscale on at both ends.</b> That is all: the call finds its way through it.</li>
  </ol>

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

/** Draw the guide into `root`. */
export function mountPrivateNetworkPage(root) {
  if (!root) return null;
  root.innerHTML = privateNetworkHTML();
  return { root };
}
