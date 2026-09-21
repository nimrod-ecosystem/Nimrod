// modules/settings.js — Settings AS A MODULE, not only a gear icon.
//
// Mike, 2026-09-22, closing the DECIDE row this session wrote about where "Settings" belongs:
// "Make settings a module and then a tab. It definitely shouldn't be bound to a device. You're
// supposed to pick what the settings are for — account, user, device, module, etc."
//
// The earlier scoping found `settings.js`'s own kiosk usage (`fields`/`screenItems`) is
// entirely PER-SCREEN — live state trapped in kiosk.js's own closure, unreachable from a
// generic module. Mike's answer resolves that the right way: don't bind this module to
// whichever screen happens to host it — make "which thing am I editing" an explicit choice
// INSIDE the module, the same "instance, module, screen, device, person, account" chain
// `settings_fields.js`'s own header already named as the seam nothing had built yet:
//
//   "there are six homes for one (instance, module, screen, device, person, account) and
//    they are an INHERITANCE CHAIN, not six buckets... The chain itself is not built yet;
//    this is the seam it plugs into."
//
// THIS MODULE IS THAT SEAM'S FIRST REAL DOOR, not the whole chain. Two scopes are genuinely
// wired end to end:
//
//   MODULE   — every other module instance on this profile, listed by its own title. Reuses
//              `settings_fields.js` wholesale (`fieldsFor`/`fieldItems`), the exact machinery
//              every module's own gear icon already calls on itself — this just calls it on
//              a SIBLING instead. Read/write goes straight to that instance's own saved state
//              (`profiles.stateURL`), so editing it here and editing it from the module's own
//              gear icon are the same record, never two.
//   THEME    — the profile's own theme (`profile.js`'s `resolveTheme`, `theme.js`'s
//              `applyTheme`/`listThemes`), the same real, per-profile setting this session
//              built out for pre-sign-in pages, now reachable from a signed-in dashboard too.
//
// DEVICE (a screen's own dimming, transport bar, burn-in drift, etc.) is named honestly rather
// than faked: those fields live inside kiosk.js's own running closure and are not reachable
// from an ordinary module context today. Building that reach means kiosk.js exposing its own
// screen-settings surface to something outside itself — a real, separate piece of plumbing,
// not a checkbox here. This scope links to the screen's own gear icon instead of pretending to
// edit it, the exact same honesty `modules/keyboard.js` already carries for bindings it reads
// but does not edit ("a device module... editing bindings in place would contradict [the
// binder's] stated boundary... links out... rather than growing a second editor").
// ACCOUNT/PERSON scopes are not represented — nothing concrete exists yet at those two homes
// to build a real settings UI for (sign-out and the people list already live on home.html);
// adding stub rows for scopes with nothing behind them would be exactly the "fake affordance
// worse than an absent one" `settings_fields.js` itself warns against.
//
// `core: 'new'`: this module lists ITS OWN PROFILE'S sibling instances, which needs
// `ctx.profileId` — already part of every real mounting path, but declaring the contract
// (personId/instanceId) is what `mountModule` actually checks.

import { registerModule, getManifest } from '../module.js';
import { mountSettings } from '../settings.js';
import { fieldsFor, fieldItems } from '../settings_fields.js';
import { createProfilesClient, resolveTheme } from '../profile.js';
import { createState } from '../state.js';
import { applyTheme, listThemes, resolveThemeId } from '../theme.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// One field row, drawn exactly like `settings.js`'s own list rows (`.st-item`/`.st-label`/
// `.st-hint`) so a page opened from this module reads as part of the same menu, not a
// second, differently-styled one bolted on.
function renderFieldRows(el, items) {
  el.innerHTML = items.length
    ? items.map((it, n) => `
        <button class="st-item${it.disabled ? '' : ''}" type="button" data-n="${n}" ${it.disabled ? 'disabled' : ''}>
          <span class="st-label">${esc(it.label)}</span>
          ${it.hint ? `<span class="st-hint">${esc(it.hint)}</span>` : ''}
        </button>`).join('')
    : '<p>Nothing to set here.</p>';
  el.querySelectorAll('[data-n]').forEach((btn) => {
    btn.addEventListener('click', () => { items[Number(btn.dataset.n)]?.run?.(); });
  });
}

registerModule(
  { type: 'settings', title: 'Settings', core: 'new', dependsOn: 'server',
    description: 'edit another module’s settings, or the screen’s theme, from inside a dashboard slot' },
  (ctx) => {
    const { mount } = ctx;
    let menu = null;
    let torn = false;
    const pages = {};          // built up as the profile's own modules become known
    let moduleRows = [];       // [{id, type, title}], filled in once, read by `extras()`
    let profiles = null;

    // MODULE SCOPE — one page per sibling instance, each a live read/write against that
    // instance's own saved state (never a copy of it).
    function buildModulePage(row) {
      const manifest = getManifest(row.type);
      const st = createState({ url: profiles.stateURL(ctx.profileId, row.id), user: ctx.user });
      let values = {};
      let loaded = false;
      return {
        title: row.title,
        render(el) {
          function draw() {
            if (!el.isConnected) return;
            // `null` instance -- no live mounted copy of the sibling to ask for
            // `settingsChoices()`, so a field whose options are only known at runtime (a media
            // source's own album list, say) shows its declared/static options rather than a
            // momentarily-live one. Named here rather than silently accepted -- the same
            // honesty `modules/keyboard.js` carries for the device chain it reads but does
            // not fully reach yet.
            const items = fieldItems(fieldsFor(manifest, null), {
              values: () => values,
              onStep: (key, value) => { values = { ...values, [key]: value }; st.set({ [key]: value }); draw(); },
            });
            renderFieldRows(el, items);
          }
          el.innerHTML = '<p>Loading…</p>';
          if (loaded) { draw(); return; }
          st.load().then(() => { values = st.get() || {}; loaded = true; draw(); })
            .catch(() => { loaded = true; draw(); });
        },
      };
    }

    // THEME SCOPE — the profile's real, saved theme (the same one `resolveTheme`/`applyTheme`
    // already carry to every kiosk and pre-sign-in page this session built), not a second copy.
    pages['sc-theme'] = {
      title: 'Theme',
      render(el) {
        el.innerHTML = `<p class="st-hint" style="display:block;margin:0 0 10px">Applies to every
          screen on this account.</p>
          <select data-theme-select style="width:100%;padding:10px;border-radius:10px;
            border:1px solid var(--border);background:var(--surface);color:var(--text)"></select>`;
        const sel = el.querySelector('[data-theme-select]');
        for (const { id, label } of listThemes()) {
          const opt = document.createElement('option');
          opt.value = id; opt.textContent = label;
          sel.append(opt);
        }
        resolveTheme(profiles, ctx.user).then((theme) => {
          if (!el.isConnected) return;
          sel.value = resolveThemeId(theme);
        }).catch(() => {});
        sel.addEventListener('change', async () => {
          const id = resolveThemeId(sel.value);
          applyTheme(document.documentElement, id);
          const settingsState = createState({ url: profiles.stateURL(ctx.profileId, 'settings'), user: ctx.user });
          await settingsState.load().catch(() => {});
          settingsState.set({ theme: id });
        });
      },
    };

    // DEVICE SCOPE — honest, not faked. See this file's own header for why a real editor is
    // not here yet.
    pages['sc-device'] = {
      title: 'This screen',
      render(el) {
        el.innerHTML = `<p>Dimming, the transport bar, and the rest of a screen’s own
          display settings are not reachable from here yet — open them from that screen’s
          own ⚙ in its transport bar.</p>`;
      },
    };

    return {
      async init() {
        mount.innerHTML = '<div data-settings-root style="width:100%;height:100%"></div>';
        profiles = createProfilesClient({ user: ctx.user });

        menu = mountSettings(mount.querySelector('[data-settings-root]'), {
          inline: true,
          includeHome: false,
          person: () => null,
          subject: () => ({ type: 'settings', title: 'Settings' }),
          extras: () => [
            ...moduleRows.map((row) => ({
              kind: 'item', id: `mod-${row.id}`, label: row.title, page: `mod-${row.id}`,
            })),
            { kind: 'item', id: 'sc-theme', label: 'Theme', page: 'sc-theme' },
            { kind: 'item', id: 'sc-device', label: 'This screen', page: 'sc-device' },
          ],
          pages,
        });
        menu.open();

        try {
          const profile = await profiles.get(ctx.profileId);
          if (torn) return;
          moduleRows = (profile?.modules || [])
            .filter((m) => m.id !== ctx.instanceId)         // not itself
            .map((m) => ({ id: m.id, type: m.type, manifest: getManifest(m.type) }))
            .filter((m) => !!m.manifest)                     // skip anything unregistered
            .map((m) => ({ id: m.id, type: m.type, title: m.manifest.title || m.type }));
          for (const row of moduleRows) pages[`mod-${row.id}`] = buildModulePage(row);
          menu.refresh();
        } catch (err) {
          console.error('settings: could not list this profile’s modules', err);
        }
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        try { menu?.destroy?.(); } catch { /* already gone */ }
      },
      // For a test to assert on without reaching into the closure by hand.
      __probe: () => ({ moduleRows: moduleRows.map((r) => ({ ...r })), open: menu?.isOpen?.() }),
    };
  },
);
