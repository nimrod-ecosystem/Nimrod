// demo_strip.js — THE ONLY THING ON THE KIOSK AIMED AT A STRANGER.
//
// Signed out, `kiosk.html` IS the front door: the landing page's loudest button sends people
// straight to it. A visitor lands on a working screen — photos rotating, a clock, a word
// game — and until this file existed, nothing told them:
//
//   * that the photos are SAMPLES and not a stock-photo product,
//   * that their own photos could be on that screen in ten seconds,
//   * that doing so uploads nothing and installs nothing.
//
// The browser folder picker (`folder_source.js`) has been built, tested and shipped for a
// while. It was never offered anywhere a first-time visitor would find it. That is the whole
// gap this closes, and Mike named it twice: *"it would be hard for someone to know what's
// going on with anything."*
//
// ---------------------------------------------------------------------------------------
// WHY A STRIP AND NOT A MODAL, since that was the obvious alternative
//
// A modal over a demo is a thing to close, and closing it is the last interaction most
// people will have with the page. A strip says what the screen is, offers one action, and is
// still there in peripheral vision thirty seconds later when the photos have made the point
// the words could not.
//
// *** AND IT MUST NEVER APPEAR ON A REAL BEDSIDE SCREEN. *** A real bedside screen is paired
// with a device key and never runs the signed-out branch — but that is a property of the
// CALLER, so `mountDemoStrip` is deliberately dumb: it renders when asked and never decides
// for itself. The one place that decides is the signed-out boot path in kiosk.html.
//
// ---------------------------------------------------------------------------------------
// EVERY DEPENDENCY IS INJECTABLE, because the signed-out path cannot be reached in local
// development at all — the dev server answers `/api/me` with a stub user, so the branch this
// lives in never runs. A seam is the only way this gets tested rather than eyeballed once.

const DISMISSED_KEY = 'nimrod:demoStripDismissed';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Should the strip be shown at all?
 *
 * Split out and exported because the three reasons NOT to show it are the interesting part,
 * and each one is a way of getting this wrong:
 *
 *   * they dismissed it        — asking again is nagging
 *   * they have their own      — "these are sample photos" printed over somebody's actual
 *     folder connected           family photos is worse than saying nothing at all
 *   * they are signed in       — they are not a stranger; they have a home page
 */
export async function shouldShowDemo({
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  listFolders = async () => [],
  signedIn = false,
} = {}) {
  if (signedIn) return false;
  try { if (storage?.getItem(DISMISSED_KEY)) return false; } catch { /* private mode: show it */ }
  try { if ((await listFolders()).length) return false; } catch { /* no folders is fine */ }
  return true;
}

/**
 * Render the strip into `root`. Returns a handle, or null if it decided not to show.
 *
 * `onConnected(source)` fires once a folder has actually been picked.
 */
export async function mountDemoStrip(root, {
  storage = (typeof localStorage !== 'undefined' ? localStorage : null),
  listFolders = async () => [],
  pick = async () => null,
  supported = true,
  signedIn = false,
  loginHref = '/auth/login',
  onConnected = null,
} = {}) {
  if (!root) return null;
  if (!(await shouldShowDemo({ storage, listFolders, signedIn }))) return null;

  const bar = document.createElement('div');
  bar.id = 'demo';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'About this demo');

  // THE FIRST SENTENCE IS THE WHOLE JOB. It has to land for somebody who arrived from a link
  // with no idea what this is, is looking at photos of strangers, and will leave in about
  // eight seconds. So: what this is, then what they can do, then why it is safe — in that
  // order, because "nothing is uploaded" answers a question they have not asked yet.
  bar.innerHTML = `
    <span class="d-text">
      <b>This is a live demo, and these are sample photos.</b>
      <span class="d-sub">Point it at a folder of your own and it plays those instead.
        Nothing is uploaded — the pictures never leave this device.</span>
    </span>
    ${supported ? '<button class="d-go" data-pick>Use my own photos</button>' : ''}
    <a class="d-in" href="${esc(loginHref)}">Sign in to keep this</a>
    <button class="d-x" data-x aria-label="Dismiss">✕</button>
    ${supported ? '' : `
      <span class="d-note">Choosing a folder needs Chrome or Edge on a computer. On this
        browser you can still look around, and sign in to set a screen up.</span>`}`;
  root.append(bar);

  const dismiss = () => {
    try { storage?.setItem(DISMISSED_KEY, '1'); } catch { /* private mode */ }
    bar.remove();
  };
  bar.querySelector('[data-x]')?.addEventListener('click', dismiss);

  const btn = bar.querySelector('[data-pick]');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Choosing…';
    try {
      const src = await pick('My photos');
      // *** A CANCELLED PICKER IS NOT AN ERROR *** and must not look like one. Somebody who
      // opened the dialog to see what it wanted and thought better of it has done nothing
      // wrong, and should find the button exactly as they left it.
      if (!src) { btn.disabled = false; btn.textContent = 'Use my own photos'; return; }
      bar.remove();
      onConnected?.(src);
    } catch (err) {
      console.warn('demo strip: folder picker', err);
      btn.disabled = false;
      btn.textContent = 'Use my own photos';
    }
  });

  return {
    el: bar,
    dismiss,
    shown: () => !!bar.isConnected,
  };
}

// Exported so a test can put the storage back the way it found it.
export const DEMO_DISMISSED_KEY = DISMISSED_KEY;
