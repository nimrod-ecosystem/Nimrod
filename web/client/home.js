// home.js — the HOME page: what a signed-in person sees, and the only place they
// compose what they want to use.
//
// The three surfaces, and why they're separate:
//   landing.html  public. What Nimrod is, and a way in. Signed out only.
//   home.html     THIS. Your profiles: make one, put modules in it, open it.
//   kiosk.html    the running screen. Full-screen, one module at a time, calm.
//
// Home COMPOSES, the kiosk PLAYS. That split is deliberate: the kiosk is a screen that
// may sit in a care facility running unattended for days, so it must not also be a
// management UI. Everything you'd fiddle with lives here instead, and "Open" hands the
// finished profile to the kiosk with `?profile=<id>`.
//
// Before this page existed, signing in redirected to the kiosk — which auto-seeded a
// bedside profile and gave you no way to add anything to it. That is why the games were
// not playable: there was nowhere to put them.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The modules a person can add, from the registry (whatever was imported). Sorted by
// title so the picker is scannable rather than load-order-dependent.
export function moduleCatalog(manifests) {
  return [...(manifests || [])]
    .filter((m) => m && m.type)
    .sort((a, b) => String(a.title || a.type).localeCompare(String(b.title || b.type)));
}

export function kioskURL(profileId) {
  return `/kiosk.html?profile=${encodeURIComponent(profileId)}`;
}

// Mounts the page. `profiles` is the profiles client; `manifests` the module registry
// listing; `onOpen` is injectable so a test can assert the hand-off without navigating.
export async function mountHome(root, { email = '', profiles, manifests = [], onOpen = null } = {}) {
  const catalog = moduleCatalog(manifests);
  // The server stores module instances as {id, type} — no human title. Look the title up
  // from the registry so a chip reads "Quests", not "quests"; fall back to the type for a
  // module this build no longer registers, so an old profile still renders.
  const titleOf = (type) => (catalog.find((m) => m.type === type) || {}).title || type;
  const open = onOpen || ((id) => { location.href = kioskURL(id); });
  let list = [];
  let busy = false;

  root.innerHTML = `
    <div class="home">
      <header class="h-top">
        <div class="h-brand">Nimrod<span>.</span></div>
        <div class="h-who">
          ${email ? `<span class="h-email">${esc(email)}</span>` : ''}
          <a class="h-signout" href="/auth/logout">Sign out</a>
        </div>
      </header>

      <div class="h-intro">
        <h1>Your screens</h1>
        <p>A <b>screen</b> is a set of modules — photos, a clock, games, the lineup — that you
          open full-screen. Make one for each person or place.</p>
      </div>

      <form class="h-new" data-new>
        <input type="text" data-name placeholder="Name a new screen (e.g. Bedside, Oscar)" aria-label="new screen name" required>
        <button type="submit" class="h-btn h-primary">Create</button>
      </form>

      <div class="h-msg" data-msg></div>
      <div class="h-list" data-list><p class="h-loading">Loading…</p></div>
    </div>`;

  const el = (sel) => root.querySelector(sel);
  const listEl = el('[data-list]');
  const msgEl = el('[data-msg]');

  const say = (text, bad = false) => {
    msgEl.textContent = text || '';
    msgEl.classList.toggle('bad', !!bad);
  };

  function card(p) {
    const mods = p.modules || [];
    const chips = mods.length
      ? mods.map((m) => `<span class="h-chip">${esc(m.title || titleOf(m.type))}
          <button class="h-x" data-remove="${esc(p.id)}:${esc(m.id)}" aria-label="remove ${esc(m.type)}">×</button>
        </span>`).join('')
      : `<span class="h-none">No modules yet — add one below.</span>`;
    return `
      <section class="h-card">
        <div class="h-card-head">
          <h2>${esc(p.name)}</h2>
          <button class="h-btn h-primary" data-open="${esc(p.id)}" ${mods.length ? '' : 'disabled'}>Open</button>
        </div>
        <div class="h-chips">${chips}</div>
        <div class="h-add">
          <select data-pick="${esc(p.id)}" aria-label="module to add">
            ${catalog.map((m) => `<option value="${esc(m.type)}">${esc(m.title || m.type)}</option>`).join('')}
          </select>
          <button class="h-btn" data-add="${esc(p.id)}">Add module</button>
          ${mods.length ? '' : '<span class="h-hint">a screen needs at least one module to open</span>'}
        </div>
      </section>`;
  }

  function render() {
    listEl.innerHTML = list.length
      ? list.map(card).join('')
      : `<p class="h-empty">No screens yet. Name one above and hit Create.</p>`;

    for (const b of root.querySelectorAll('[data-open]')) {
      b.addEventListener('click', () => open(b.dataset.open));
    }
    for (const b of root.querySelectorAll('[data-add]')) {
      b.addEventListener('click', () => guard(async () => {
        const pid = b.dataset.add;
        const type = root.querySelector(`[data-pick="${CSS.escape(pid)}"]`).value;
        await profiles.addModule(pid, type);
        await refresh();
        say(`Added ${type}.`);
      }));
    }
    for (const b of root.querySelectorAll('[data-remove]')) {
      b.addEventListener('click', () => guard(async () => {
        const [pid, mid] = b.dataset.remove.split(':');
        await profiles.removeModule(pid, mid);
        await refresh();
        // Removing a module drops its CONFIG; its append-only events survive on the
        // server, so re-adding a game doesn't erase what was already recorded.
        say('Removed. Anything it already recorded is kept.');
      }));
    }
  }

  // One at a time: these are server round-trips, and a double-click that fires two
  // creates leaves a duplicate screen the user then has to puzzle over.
  async function guard(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); }
    catch (err) { console.error(err); say('That didn’t save — check your connection and try again.', true); }
    finally { busy = false; }
  }

  async function refresh() {
    const raw = await profiles.list();
    // The list endpoint returns profiles without their modules; fetch each so the cards
    // can show what's actually in them.
    list = await Promise.all(raw.map((p) => profiles.get(p.id).catch(() => ({ ...p, modules: [] }))));
    render();
  }

  el('[data-new]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el('[data-name]');
    const name = input.value.trim();
    if (!name) return;
    guard(async () => {
      await profiles.create(name);
      input.value = '';
      await refresh();
      say(`Created “${name}”. Add some modules to it.`);
    });
  });

  await refresh();
  return { refresh, profiles: () => list, catalog: () => catalog };
}
