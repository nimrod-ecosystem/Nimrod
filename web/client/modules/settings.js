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
import { fieldsFor, fieldItems, opensPicker, chooseModeOf, DEFAULT_CHOOSE_MODE } from '../settings_fields.js';
import { mountChoicePicker, openChoiceDialog } from '../choice_picker.js';
import { createProfilesClient, resolveTheme } from '../profile.js';
import { createState } from '../state.js';
import { applyTheme, listThemes, resolveThemeId } from '../theme.js';
import { MODE_KEY, MODES, modeFrom, PROFILE_SETTINGS_KEY } from '../lessons.js';
// THE NIMROD GAME page (game / learning / sandbox, what is locked, the tour's points): drawn by unlocks.js.
// SETTINGS_SHOWN_TOPIC is this panel's answer when asked to show a page, so Nimrod can tell a panel is here
// (no answer = no panel on this dashboard, and he suggests the settings menu or the tutorial instead).
import { gameSettingsPage, SETTINGS_SHOWN_TOPIC, GAME_SETTINGS_PAGE } from '../unlocks.js';
import { createEvents } from '../events.js';

// *** WHERE IT OPENS, AND BEING ASKED TO SHOW A PAGE (2026-10-02, the landing Home). *** Mike: the landing
// Home's settings panel "launches on themes tab", and Nimrod's choices show the page they talk about ("It
// would also open up the Nimrod Game settings menu in the settings menu window"). Two additions, neither
// changing what a panel with no `startPage` does:
//   startPage   on the panel's state: the page it opens on ('sc-theme', 'sc-mode', 'sc-device', or
//               'type:<module>' for a sibling's own settings). Written by the dashboard that made it
//               (dashboards.js), not a menu row: where a panel first opens is the dashboard's choice.
//   SETTINGS_OPEN_TOPIC { page }: anything on the screen (Nimrod) asks the panel to show a page. Showing a
//               page takes nothing from anybody: this panel never pauses the switch router.
// `type:<module>` resolves to the FIRST panel of that type on this screen; none, and nothing changes.
export const SETTINGS_OPEN_TOPIC = 'settings-module/open';
export const START_PAGE_KEY = 'startPage';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// One field row, drawn exactly like `settings.js`'s own list rows (`.st-item`/`.st-label`/
// `.st-hint`) so a page opened from this module reads as part of the same menu, not a
// second, differently-styled one bolted on.
//
// A LONG CHOICE OPENS A LIST HERE TOO (2026-10-02; settings_fields.js "HOW SOMEBODY CHOOSES"): the same
// `opensPicker` rule the menu uses, with the mode in force, and the same picker - as a dialog, because
// these rows are drawn by this page rather than by the menu. `mode` is read at the click.
function renderFieldRows(el, items, mode = () => DEFAULT_CHOOSE_MODE) {
  const opens = (it) => !!(it && it.choice && it.field && !it.disabled && opensPicker(it.field, { mode: mode() }));
  el.innerHTML = items.length
    ? items.map((it, n) => `
        <button class="st-item${opens(it) || it.picture ? ' st-opens' : ''}" type="button" data-n="${n}" ${it.disabled ? 'disabled' : ''}
          ${opens(it) || it.picture ? 'aria-haspopup="dialog"' : ''}>
          <span class="st-label">${esc(it.label)}</span>
          ${it.hint ? `<span class="st-hint">${esc(it.hint)}</span>` : ''}
        </button>`).join('')
    : '<p>Nothing to set here.</p>';
  el.querySelectorAll('[data-n]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const it = items[Number(btn.dataset.n)];
      if (opens(it)) { openChoiceDialog({ ...it.choice, onPick: (v) => { it.commit?.(v); } }); return; }
      it?.run?.();
    });
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
    const offs = [];           // bus subscriptions (SETTINGS_OPEN_TOPIC)
    // HOW THE PERSON CHOOSES (2026-10-02): the host's answer (`ctx.chooseMode`, a value or a function -
    // the kiosk reads it off the person's row), else 'point'. Read at every press, never cached.
    const modeNow = () => {
      try { return chooseModeOf(typeof ctx.chooseMode === 'function' ? ctx.chooseMode() : ctx.chooseMode); }
      catch { return DEFAULT_CHOOSE_MODE; }
    };

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
            renderFieldRows(el, items, modeNow);
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
    // *** EVERY THEME AT ONCE, WITH ITS COLOURS (2026-10-02). *** This page was a <select>: one more list
    // of names to read and no idea what "Forge" looks like until it was chosen. It is the choice picker
    // now (choice_picker.js), each theme a tile showing its own ground, surface, accent and text, one click
    // to choose, and a switch scans it by rows (the page hands its moves to the menu - settings.js
    // openPage). Choosing applies at once and the list stays, so somebody can try a few; "Back" leaves.
    pages['sc-theme'] = {
      title: 'Theme',
      render(el) {
        el.innerHTML = `<p class="st-hint" style="display:block;margin:0 0 10px">Applies to every
          screen on this account.</p><div data-theme-picker></div>`;
        const box = el.querySelector('[data-theme-picker]');
        let pick = null;
        let current;
        const save = async (id) => {
          applyTheme(document.documentElement, id);
          const settingsState = createState({ url: profiles.stateURL(ctx.profileId, PROFILE_SETTINGS_KEY), user: ctx.user });
          await settingsState.load().catch(() => {});
          settingsState.set({ theme: id });
        };
        const draw = () => {
          if (!box.isConnected && pick) return;
          try { pick?.destroy(); } catch { /* already gone */ }
          pick = mountChoicePicker(box, {
            title: null, key: 'theme', preview: 'theme', value: current,
            options: listThemes().map(({ id, label }) => ({ value: id, label })),
            cancelLabel: 'Back',
            onPick: (v) => { current = resolveThemeId(v); draw(); save(current).catch(() => {}); },
            onCancel: () => { try { menu?.closePage?.(); } catch { /* gone */ } },
          });
        };
        draw();
        resolveTheme(profiles, ctx.user).then((theme) => {
          if (!el.isConnected) return;
          current = resolveThemeId(theme);
          draw();
        }).catch(() => {});
        // The page's moves, for the menu to route a switch to (settings.js openPage).
        return {
          next: () => pick?.next(),
          prev: () => pick?.prev(),
          select: () => pick?.select(),
          back: () => (pick ? pick.back() : false),
          destroy: () => { try { pick?.destroy(); } catch { /* gone */ } pick = null; },
        };
      },
    };

    // LEARNING MODE SCOPE — quest (lesson-topic gating enforced) vs sandbox (everything
    // open), register 252/257.2, Mike 2026-09-28. Same reserved per-profile document as
    // THEME above (`../lessons.js`'s own header on `createQuestMode` explains why this rides
    // that seam rather than a new one) — Trivia, Word Forge and the algebra game all read it
    // the same way they already read the shared unlock log, with no wiring specific to any one
    // of them. Points are earned in both modes; nothing here ever touches the unlock log
    // itself, so switching back and forth loses nothing.
    //
    // NO LOCK IS BUILT HERE. Mike's own ruling named a possible future guardian lock on this
    // control ("unless locked by a guardian account or something") but the row that asked for
    // this switch also says the lock itself "needs a design pass with Mike" and this codebase
    // has no guardian/owner-account concept today (`web/server/grants.py`'s only roles,
    // moderator/participant, govern who may DRIVE a screen, not who may change a setting). If
    // that lock is built later, this is the control it would need to disable — named here so
    // whoever builds it does not have to go hunting for where "mode" actually lives.
    pages['sc-mode'] = {
      title: 'Learning mode',
      render(el) {
        el.innerHTML = `<p class="st-hint" style="display:block;margin:0 0 10px">Quest keeps
          lesson topics locked until they’re watched. Sandbox opens everything right away.
          Points are earned either way, and nothing already unlocked is ever lost by
          switching.</p>
          <select data-mode-select style="width:100%;padding:10px;border-radius:10px;
            border:1px solid var(--border);background:var(--surface);color:var(--text)">
            <option value="sandbox">Sandbox — everything open</option>
            <option value="quest">Quest — topics unlock as you go</option>
          </select>`;
        const sel = el.querySelector('[data-mode-select]');
        const modeState = createState({ url: profiles.stateURL(ctx.profileId, PROFILE_SETTINGS_KEY), user: ctx.user });
        modeState.load().then(() => {
          if (!el.isConnected) return;
          sel.value = modeFrom(modeState.get());
        }).catch(() => {});
        sel.addEventListener('change', () => {
          const value = MODES.includes(sel.value) ? sel.value : 'sandbox';
          modeState.set({ [MODE_KEY]: value });
        });
      },
    };

    // THE NIMROD GAME — this profile's game mode, its unlocks and its points (unlocks.js). The same
    // reserved settings document as the two pages above; the unlock log and the points ledger are this
    // profile's streams (the screen's own makeEvents when the host gives one).
    pages[GAME_SETTINGS_PAGE] = {
      title: 'Nimrod Game',
      render(el) {
        gameSettingsPage({
          makeState: (key) => createState({ url: profiles.stateURL(ctx.profileId, key), user: ctx.user }),
          makeEvents: (key, opts = {}) => (typeof ctx.makeEvents === 'function' ? ctx.makeEvents(key, opts)
            : createEvents({ url: profiles.eventsURL(ctx.profileId, key), user: ctx.user, ...opts })),
          bus: ctx.bus || null,
        }).render(el);
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
        // A PANEL DOES NOT TAKE THE KEYBOARD BY ARRIVING (2026-10-02). Opening the inline menu focuses its
        // panel (settings.js `show`), and an open menu keeps Tab inside itself -- right for the screen's
        // one menu, wrong for a panel that is simply ON a dashboard (the landing Home has one): a keyboard
        // user would land in it and could not Tab out. So focus goes back to where it was after opening.
        const doc = mount.ownerDocument;
        const had = doc?.activeElement || null;
        const giveBack = () => {
          try {
            if (!doc || !mount.contains(doc.activeElement)) return;
            if (had && had !== doc.body && had.isConnected && !mount.contains(had)) had.focus?.();
            else doc.activeElement?.blur?.();
          } catch { /* nothing to give back */ }
        };
        mount.innerHTML = '<div data-settings-root style="width:100%;height:100%"></div>';
        profiles = createProfilesClient({ user: ctx.user });

        menu = mountSettings(mount.querySelector('[data-settings-root]'), {
          inline: true,
          includeHome: false,
          chooseMode: modeNow,
          person: () => null,
          subject: () => ({ type: 'settings', title: 'Settings' }),
          extras: () => [
            ...moduleRows.map((row) => ({
              kind: 'item', id: `mod-${row.id}`, label: row.title, page: `mod-${row.id}`,
            })),
            { kind: 'item', id: 'sc-theme', label: 'Theme', page: 'sc-theme' },
            { kind: 'item', id: 'sc-mode', label: 'Learning mode', page: 'sc-mode' },
            { kind: 'item', id: GAME_SETTINGS_PAGE, label: 'Nimrod Game', page: GAME_SETTINGS_PAGE },
            { kind: 'item', id: 'sc-device', label: 'This screen', page: 'sc-device' },
          ],
          pages,
        });
        menu.open();

        // Asked to show a page (Nimrod). Before the sibling list is in, a `type:` page is remembered and
        // shown when it is.
        let wanted = null;
        const showPage = (page) => {
          const p = String(page || '');
          const sib = p.startsWith('type:') ? moduleRows.find((r) => r.type === p.slice(5)) : null;
          const id = p.startsWith('type:') ? (sib ? `mod-${sib.id}` : null) : p;
          if (!id || !pages[id]) { wanted = p.startsWith('type:') ? p : null; return false; }
          wanted = null;
          // Showing a page because somebody ELSE asked (Nimrod) must not move their keyboard focus here.
          const before = doc?.activeElement || null;
          try { if (menu.page?.()) menu.closePage?.(); menu.openPage(id); } catch (err) { console.error('settings: open page', err); }
          try { if (before && before !== doc.body && before.isConnected && !mount.contains(before)) before.focus?.(); } catch { /* gone */ }
          return true;
        };
        try {
          // Answer every ask, shown or not: the answer means "a settings panel is here" (unlocks.js).
          const off = ctx.bus?.subscribe?.(SETTINGS_OPEN_TOPIC, (p) => {
            if (torn) return;
            const shown = showPage(p?.page);
            try { ctx.bus?.publish?.(SETTINGS_SHOWN_TOPIC, { page: p?.page || null, shown: !!shown }); } catch { /* no bus */ }
          });
          if (typeof off === 'function') offs.push(off);
        } catch { /* no bus: nothing can ask */ }
        let start = null;
        try { await ctx.state?.load?.(); start = (ctx.state?.get?.() || {})[START_PAGE_KEY] || null; } catch { start = null; }
        if (torn) return;
        if (start) showPage(start);
        giveBack();

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
          if (wanted && !menu.page?.()) showPage(wanted);
        } catch (err) {
          // A profile the server has never stored (a Home being TRIED, before Save - the landing's
          // examples) has no siblings to list: that is an ordinary state, not a fault, so it is not
          // logged as one. Anything else still is.
          if (err && err.status === 404) console.info('settings: no saved profile here yet, so no other panels to list');
          else console.error('settings: could not list this profile’s modules', err);
        }
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { menu?.destroy?.(); } catch { /* already gone */ }
      },
      // For a test to assert on without reaching into the closure by hand.
      __probe: () => ({ moduleRows: moduleRows.map((r) => ({ ...r })), open: menu?.isOpen?.(), page: menu?.page?.() || null }),
    };
  },
);
