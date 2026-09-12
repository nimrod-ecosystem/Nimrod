// Health-gated demo embed: probe a health endpoint before ever creating an iframe over a
// poster, so a cold host never shows its own error page (a 502, a timeout) to a visitor.
//
// Built for the landing page's demo first (CPL sample-site work order, 0.2), then pulled out
// here so the /learn/ sample site's own demo embeds share the exact same behaviour instead of
// a second copy that could drift from the first one's fixes. Not a module in the dashboard
// sense — no registry entry, no `(user, profile, instance)` contract — just a plain function
// two static pages both call.
//
// Markup contract (see landing.html or learn/index.html for a worked example):
//   <div class="demo-frame">                      <- frameEl: waking/failed panels append here
//     <button data-play>...</button>               <- playEl: hidden/removed once resolved
//     <div data-live hidden></div>                  <- liveEl: the iframe is appended here
//   </div>
// and the caller's own stylesheet defines .demo-waking / .demo-waking-inner / .demo-spin
// (copy the block from landing.html — it is plain CSS, not something this file can inject
// without also owning layout decisions that belong to the page, not the gate).
export function mountHealthGate({
  playEl,
  liveEl,
  frameEl,
  src,
  title,
  // *** NOT `/api/healthz`. *** That endpoint calls `store.ping()` — it checks the DATABASE,
  // and `kiosk.html?demo=1` never touches the database at all (`bootLocal()` runs entirely
  // off `local_store.js`, which has no `fetch()` in it whatsoever — checked directly before
  // changing this). So the old probe was gating a DB-free demo on a DB round trip nobody
  // asked for, and it showed the "waking up" panel every time Neon's free-tier compute had
  // suspended even though the demo itself needed nothing from it (Revision 5 addendum,
  // 2026-09-12 — Mike's own screenshots of the panel on a page a hiring panel will open).
  // `kiosk.html` itself is the right thing to probe: it is served by plain `StaticFiles`
  // with zero DB dependency, and it is the exact file `src` is about to load anyway, so a
  // HEAD request against it answers the only question that matters here — is the process
  // itself up and serving — with nothing extra riding along.
  healthUrl = '/kiosk.html',
  maxWaitMs = 45000,          // the copy below promises "about 30 seconds"; leave margin
  retryGapMs = 2500,
  allow = 'autoplay; fullscreen',
  btnClass = 'btn ghost',   // landing.html's dark hero wants 'btn ondark ghost'; pass it in
} = {}) {
  if (!playEl || !liveEl || !frameEl) return null;

  function probeOnce(timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(healthUrl, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => clearTimeout(t));
  }

  function loadFrame() {
    frameEl.querySelector('.demo-waking')?.remove();
    const f = document.createElement('iframe');
    f.src = src;
    f.title = title;
    // No camera or microphone in the allow list on any embed of this: the point of the
    // gate is a stranger never being asked for anything before they have chosen to look.
    f.setAttribute('allow', allow);
    f.setAttribute('loading', 'lazy');
    liveEl.append(f);
    liveEl.hidden = false;
    playEl.remove();
  }

  function panel(html) {
    frameEl.querySelector('.demo-waking')?.remove();
    const el = document.createElement('div');
    el.className = 'demo-waking';
    el.setAttribute('role', 'status');
    el.innerHTML = html;
    frameEl.appendChild(el);
    el.querySelector('[data-retry]')?.addEventListener('click', () => attempt());
    return el;
  }

  function showWaking() {
    playEl.hidden = true;
    panel(
      '<div class="demo-waking-inner"><div class="demo-spin" aria-hidden="true"></div>' +
      '<p><b>The demo is waking up</b> — about 30 seconds. It sleeps when nobody’s looked at ' +
      'it for a while, to keep it free to run. It will load on its own.</p>' +
      '<button type="button" class="' + btnClass + '" data-retry>Try again now</button></div>'
    );
  }

  function showFailed() {
    // *** "READ THE CODE INSTEAD" IS CUT. *** Revision 6, 2026-09-12: confirmed cut, not a
    // temporary softening — Mike's read is that pointing a stalled demo at a GitHub link is
    // worse than the wait itself. One plain sentence, nothing to click but a real retry.
    playEl.hidden = true;
    panel(
      '<div class="demo-waking-inner">' +
      '<p><b>The demo isn’t answering right now.</b> Please try again in a minute.</p>' +
      '<button type="button" class="' + btnClass + '" data-retry>Try again</button></div>'
    );
  }

  let running = false;
  async function attempt() {
    if (running) return;
    running = true;
    frameEl.querySelector('.demo-waking')?.remove();
    const fast = await probeOnce(3000);
    if (fast) { running = false; loadFrame(); return; }
    showWaking();
    const start = Date.now();
    let ok = false;
    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, retryGapMs));
      ok = await probeOnce(4000);
      if (ok) break;
    }
    running = false;
    if (ok) loadFrame(); else showFailed();
  }

  playEl.addEventListener('click', attempt);
  return { attempt };
}
