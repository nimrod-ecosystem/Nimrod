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
  healthUrl = '/api/healthz',
  maxWaitMs = 45000,          // the copy below promises "about 30 seconds"; leave margin
  retryGapMs = 2500,
  allow = 'autoplay; fullscreen',
  githubUrl = 'https://github.com/nimrod-ecosystem/Nimrod',
  btnClass = 'btn ghost',   // landing.html's dark hero wants 'btn ondark ghost'; pass it in
} = {}) {
  if (!playEl || !liveEl || !frameEl) return null;

  function probeOnce(timeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(healthUrl, { signal: ctrl.signal, cache: 'no-store' })
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
    playEl.hidden = true;
    panel(
      '<div class="demo-waking-inner">' +
      '<p><b>The demo isn’t answering right now.</b> Try again in a minute, or ' +
      '<a href="' + githubUrl + '">read the code</a> instead.</p>' +
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
