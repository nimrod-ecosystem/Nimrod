// modules/wallpaper.js — the live wallpaper. Something worth looking at while a screen waits.
//
// Mike, 2026-08-30: build it as a module a container swaps in, **not** as a feature inside
// the video modules — *"implemented per module it would be written three times and drift,
// exactly like the rotation core."* Written once, every module gets a dignified held state,
// including ones nobody has written yet.
//
// The content rules, the flash-rate floor and the reasoning behind the motion ladder are in
// `wallpaper.js`. This file is the module: a mount, a slow clock, and a `<video>`/`<img>`
// when somebody has given us a folder.
//
// ---------------------------------------------------------------------------------------
// IT IS A HELD STATE, NOT A SCREENSAVER — and the difference is the whole design
// ---------------------------------------------------------------------------------------
//
// The paused segment is still there and still marked paused. The wallpaper is what is
// *shown* meanwhile, and coming back returns to where she was. That is why the container
// raises this OVER the stage instead of routing a state-machine transition through it: see
// the long note in `director.js`, which is where the real trap turned out to live.
//
// **The invariant, on this module's own terms.** A wallpaper is a state a screen can enter,
// so it must never be a state only an input can leave. Three separate things end it and none
// of them is a person: the module that published the hold publishes its end; that module
// being destroyed releases the hold (`held.js`); and the hold's own notify clock — six hours
// by default — is untouched and still running underneath. The wallpaper does not change what
// happens when the wait runs out. It changes what the wait looks like.
//
// ---------------------------------------------------------------------------------------
// A SLOW CLOCK, ON PURPOSE
// ---------------------------------------------------------------------------------------
//
// The ambient redraws about four times a second, not sixty. At the drift rates in
// `wallpaper.js` a faster clock would render frames indistinguishable from each other while
// keeping a Pi 400's CPU warm for six hours — and the low rate is itself part of the
// flash-rate argument rather than only an optimisation.
//
// ---------------------------------------------------------------------------------------
// STANDALONE TOO
// ---------------------------------------------------------------------------------------
//
// It registers as an ordinary module, so it can be put on a screen on its own — which is
// what somebody wants when the answer to "she has nothing to look at" is "something calm,
// all the time" rather than "something for the gaps". It needs no server and no files in
// that mode, which also makes it the honest last resort when everything else is unreachable.

import { registerModule } from '../module.js';
import { createMediaSourcesClient, resolveListing, mediaUrl } from '../media_sources.js';
import { personSources } from '../person_known.js';
import {
  MOTIONS, SCENES, VIDEO_POLICIES, ambientFrame, frameToCss, motionOf,
  usableItems, nextItem, wallpaperMode,
} from '../wallpaper.js';
import { applyGrade } from '../lut.js';
// folder art (2026-10-07): the Nimrod folder's Artwork/Wallpapers, read on this device.
import { kindFolder, handleStore } from '../user_folders.js';
import { entriesIn, fileUrlIn } from '../folder_source.js';
import { ART_KINDS } from '../art_kit.js';
import { SOURCE_RECHECK_MS } from '../media_sources.js';

// ---------------------------------------------------------------------------------------
// folder art: PICTURES FROM A FOLDER (2026-10-07)
// ---------------------------------------------------------------------------------------
//
// Before this the panel played a folder only from a link parameter (`?wallpaperSource=`): no
// settings row chose one. `sourceId` is now that row, "Pictures from a folder", with the same live
// list of connected folders the Photos panel's "Photos from" offers, plus two of its own:
//
//   NIMROD_FOLDER  THE DEFAULT. Artwork/Wallpapers in the person's Nimrod folder (user_folders.js,
//                  the folder the art kit tells people to save wallpapers in), read straight from the
//                  folder on this device, with nothing to connect first.
//   NO_FOLDER      the built-in moving colours only - for anybody who keeps pictures in that folder
//                  for something else and wants this panel to leave them alone.
//
// THE DEFAULT, BOTH SIDES. For: the art kit already says "make a wallpaper, save it in
// Artwork/Wallpapers"; a default that then ignores that folder makes the kit a two-step job
// (connect it, then pick it here, then type the album). Nothing changes for anybody whose folder is
// empty or who has no Nimrod folder - the ambient shows, exactly as before. Against: a panel set up
// before today starts showing pictures by itself the day somebody saves one there, without anybody
// choosing that on this panel. That is what the folder is for, and NO_FOLDER is one press away.
// The Photos panel's own default (adopt the account's only source) was not copied: a wallpaper is
// what shows when nothing else does, so pictures from an unrelated photo folder appearing in it would
// be the bigger surprise.
//
// *** NEVER BLOCKS, NEVER SAYS ANYTHING ON SCREEN. *** No Nimrod folder, a folder whose permission
// lapsed (it does after a restart, until somebody presses Allow in This screen, Your own folders), no
// Wallpapers folder, an empty one: the built-in wallpaper shows, as it always did, and the reason is
// one quiet line after the row's value, in the settings menu (`folderNote`, the row's live `status`). Only a lapsed permission is
// re-checked by itself (every SOURCE_RECHECK_MS, the Photos panel's own number), because that is the
// one case waiting on a press somewhere else; the rest are read again when the panel is shown.
export const NIMROD_FOLDER = 'nimrod-folder';
export const NO_FOLDER = 'none';
// The kind's folder name from the art kit's own table, so the two cannot disagree.
export const WALLPAPER_FOLDER = (ART_KINDS.find((k) => k.id === 'wallpaper') || {}).folder || 'Wallpapers';
const WHERE = `Artwork/${WALLPAPER_FOLDER} in your Nimrod folder`;

/**
 * folder art: the pictures (and clips) in the Nimrod folder's Artwork/Wallpapers, names only - no file is
 * read here. Never prompts, never throws. Resolves `{ status, dir, items }`, status one of
 * 'ok' | 'empty' | 'none' (no Nimrod folder on this device) | 'permission' | 'missing' | 'error'.
 */
export async function readNimrodWallpapers({ store = handleStore(), names } = {}) {
  const out = (status, dir = null, items = []) => ({ status, dir, items });
  let k = null;
  try { k = await kindFolder('artwork', { store, ...(names ? { names } : {}) }); } catch { return out('none'); }
  if (!k || k.source === 'none') return out('none');
  if (k.permission !== 'granted') return out('permission');
  if (!k.dir) return out('missing');
  let dir = null;
  try { dir = await k.dir.getDirectoryHandle(WALLPAPER_FOLDER); } catch { return out('missing'); }
  try {
    const items = (await entriesIn(dir)).items
      .filter((it) => it.kind === 'image' || it.kind === 'video')
      .map((it) => ({ id: it.path, name: it.name, path: it.path, kind: it.kind }));
    return out(items.length ? 'ok' : 'empty', dir, items);
  } catch { return out('error'); }
}

/** folder art: the quiet line after "Pictures from a folder"'s value. Plain words; '' when there is nothing to say. Pure. */
export function folderNote(choice, status, count = 0) {
  const n = `${count} ${count === 1 ? 'picture' : 'pictures'}`;
  if (choice === NO_FOLDER) return '';
  if (choice === NIMROD_FOLDER) {
    return {
      ok: `${n} there.`,
      empty: `${WHERE} is empty, so the built-in wallpaper shows. Save pictures there to see them here.`,
      none: 'There is no Nimrod folder on this device, so the built-in wallpaper shows. Set one up in This screen, Your own folders.',
      permission: 'Your Nimrod folder needs permission again: press Allow in This screen, Your own folders. Until then the built-in wallpaper shows.',
      missing: `There is no ${WHERE}, so the built-in wallpaper shows. “Set up your Nimrod folder” in This screen, Your own folders makes it.`,
      error: `${WHERE} could not be read just now, so the built-in wallpaper shows.`,
    }[status] || '';
  }
  return {
    ok: `${n} there.`,
    empty: 'That folder has no pictures in it, so the built-in wallpaper shows.',
    gone: 'That folder is not connected here any more, so the built-in wallpaper shows. Choose another, or connect it again in Media / Sources.',
    permission: 'That folder needs permission again (Media / Sources). Until then the built-in wallpaper shows.',
    missing: 'This device no longer has that folder, so the built-in wallpaper shows. Reconnect it in Media / Sources.',
    album: 'That folder has no album by that name, so the built-in wallpaper shows.',
    error: 'That folder could not be read just now, so the built-in wallpaper shows.',
  }[status] || '';
}

const DEFAULTS = {
  sourceId: NIMROD_FOLDER, album: '',
  // `theme` is the behaviour that existed before scenes — the ambient tinted by the profile's
  // own hue. Default so nothing anybody already set up looks different (A8).
  scene: 'theme',
  motion: 'gentle',
  allowVideo: 'auto',
  perItemMs: 60000,        // how long one picture stays before the next
};

// The ambient's redraw period. See the header — deliberately slow.
const TICK_MS = 250;

// The cross-fade between two pictures. Long enough that nothing reads as a cut, short enough
// that a person glancing over sees a picture rather than a blur.
const FADE_MS = 2500;

// `perItemMs` is a CHOICE and it wraps, because a one-switch cursor can only travel one way.
export const SETTINGS = [
  // A8: the module had a renderer and no content — one ambient, tinted by whatever the profile
  // theme happened to be, which is what "a brown moving hue" was. `theme` is the default and is
  // the old behaviour exactly, so nobody's screen changes because this arrived.
  { key: 'scene', label: 'Which wallpaper', kind: 'choice', default: 'theme', level: 'standard',
    options: SCENES.map((s) => ({ value: s.id, label: s.label })) },
  { key: 'motion', label: 'Movement', kind: 'choice', default: 'gentle', level: 'standard',
    options: [
      { value: 'gentle', label: 'gentle — a slow drift' },
      { value: 'calm',   label: 'calm — slower and softer' },
      { value: 'still',  label: 'still — no movement at all' },
    ] },
  { key: 'allowVideo', label: 'Play video wallpapers', kind: 'choice', default: 'auto',
    level: 'standard',
    options: [
      { value: 'auto',   label: 'only when movement is gentle' },
      { value: 'always', label: 'always' },
      { value: 'never',  label: 'never — pictures only' },
    ] },
  { key: 'perItemMs', label: 'Change picture every', kind: 'choice', default: 60000,
    level: 'standard',
    options: [
      { value: 30000,  label: '30 seconds' },
      { value: 60000,  label: '1 minute' },
      { value: 300000, label: '5 minutes' },
      { value: 900000, label: '15 minutes' },
    ] },
  // folder art (2026-10-07): where the pictures come from (the note above DEFAULTS argues the default). The
  // declared options are the two that need no account; a mounted panel adds every connected folder
  // (`settingsChoices`), the way the Photos panel's "Photos from" does, and the line under the row says why
  // nothing is showing when nothing is.
  { key: 'sourceId', label: 'Pictures from a folder', kind: 'choice', default: NIMROD_FOLDER, level: 'standard',
    options: [
      { value: NIMROD_FOLDER, label: 'Wallpapers in your Nimrod folder' },
      { value: NO_FOLDER, label: 'None: just the built-in wallpaper' },
    ] },
  // A connected folder's subfolder. EDITABLE here, unlike the Photos panel's read-only Album, argued: there it is
  // read-only because a name the folder does not have breaks the slideshow; here it only falls back to the built-in
  // wallpaper and says so under the row above. Only shown for a connected folder (the two above have no albums).
  { key: 'album', label: 'Album', kind: 'text', default: '', level: 'advanced', placeholder: 'Everything',
    note: 'a folder inside the chosen one, such as Wallpapers',
    appliesWhen: (v) => !!v && !!v.sourceId && v.sourceId !== NIMROD_FOLDER && v.sourceId !== NO_FOLDER },
];

registerModule(
  { type: 'wallpaper', title: 'Wallpaper',
    description: 'Something calm on screen. Works with no files at all, or plays from a folder you choose.',
    // No server and no files needed for the built-in ambient, which is exactly what makes it
    // usable as a fallback when nothing else is reachable — same argument as comet.js.
    dependsOn: 'none', importance: 'optional', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, user } = ctx;
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    const now = ctx.now || (() => Date.now());
    // Whose sources: whoever the screen is for, once it knows (person_known.js) -- the ambient draws at
    // once regardless; only the folder's pictures wait, and they re-list if the answer changes.
    const client = personSources(ctx,
      (pid) => createMediaSourcesClient({ user, cache: true, personId: pid }),
      { onChange: () => { if (!destroyed) reload().catch((e) => console.warn('wallpaper: reload', e)); } });

    let cfg = { ...DEFAULTS };
    let items = [];
    let recent = [];
    let current = null;
    let source = null;
    let loadSeq = 0;
    let destroyed = false;
    let tick = null, swap = null;
    let t0 = now();
    let layers = [];          // the two cross-fading media layers
    let front = 0;
    // folder art: where the pictures come from now, for the line under the row; the connected folders, for its options.
    const folderStore = ctx.folderStore || handleStore();
    let folderState = { choice: NIMROD_FOLDER, status: 'none', count: 0 };
    let knownSources = [];
    let recheck = null;
    let showSeq = 0;
    const layerRelease = new Map();   // layer -> release() for a picture read out of the Nimrod folder

    // KEPT SEPARATE FROM `cfg.motion`, the same way comet.js and pond.js keep the system's
    // request apart from the saved setting: folding them makes the settings row lie.
    let systemReduced = false;
    let mq = null, onMq = null;

    const motion = () => motionOf(cfg.motion, systemReduced);
    const policy = () => (VIDEO_POLICIES.includes(cfg.allowVideo) ? cfg.allowVideo : 'auto');
    const perItemMs = () => Math.max(5000, Number(cfg.perItemMs) || DEFAULTS.perItemMs);
    const pool = () => usableItems(items, { policy: policy(), motion: motion() });

    const el = (s) => mount.querySelector(s);

    // The theme's own hue, so the wallpaper is not a second palette arguing with the one the
    // profile chose. Falls back to a neutral blue when read outside a themed page.
    function themeHue() {
      try {
        const v = getComputedStyle(mount).getPropertyValue('--wallpaper-hue').trim();
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      } catch { /* not in a document, or no theme */ }
      return 210;
    }

    function paintAmbient() {
      const box = el('[data-ambient]');
      if (!box) return;
      box.style.background = frameToCss(ambientFrame(now() - t0, {
        motion: motion(), hueBase: themeHue(), scene: cfg.scene,
      }));
    }

    function startTick() {
      stopTick();
      paintAmbient();
      // 'still' means still: one frame and no clock at all, rather than a clock redrawing an
      // identical frame forever.
      if (motion() === 'still') return;
      const run = () => {
        if (destroyed) return;
        paintAmbient();
        tick = setTimer(run, TICK_MS);
      };
      tick = setTimer(run, TICK_MS);
    }
    function stopTick() { if (tick != null) { clearTimer(tick); tick = null; } }

    // ------------------------------------------------------------------------------------
    // MEDIA
    // ------------------------------------------------------------------------------------

    // folder art: a picture read out of the Nimrod folder holds an object URL until its layer is emptied.
    function releaseLayer(l) {
      const r = layerRelease.get(l);
      layerRelease.delete(l);
      try { r?.(); } catch { /* gone */ }
    }

    function clearLayer(l) {
      releaseLayer(l);
      l.innerHTML = '';
      l.style.opacity = '0';
    }

    function showItem(it) {
      if (!it || !source) return;
      current = it;
      recent = [...recent, it.id].slice(-12);
      const back = layers[1 - front];
      if (!back) return;
      const seq = ++showSeq;
      // folder art: a connected folder's listing already carries `url` (an agent's did not need one: it was built
      // here). The Nimrod folder's pictures are read one at a time, when shown, so a folder of fifty holds one.
      const direct = it.url || (source.base_url ? mediaUrl(source.base_url, it.path) : '');
      if (direct) { place(back, it, direct, null); return; }
      if (!source.dir) return;
      fileUrlIn(source.dir, it.path).then((got) => {
        if (destroyed || seq !== showSeq || !got) { try { got?.release?.(); } catch { /* gone */ } return; }
        place(back, it, got.url, got.release);
      }).catch((e) => console.warn('wallpaper: a picture from the Nimrod folder', e));
    }

    function place(back, it, url, release) {
      releaseLayer(back);
      back.innerHTML = '';
      if (release) layerRelease.set(back, release);
      if (it.kind === 'video') {
        const v = document.createElement('video');
        // Muted with no unmute — see the header of `wallpaper.js`. `playsInline` so iOS does
        // not take the video full-screen over the rest of the screen.
        v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true;
        v.playsInline = true; v.setAttribute('playsinline', '');
        v.src = url;
        applyGrade(v, 'wallpaper');    // row 2.49, lut.js: off by default, untouched when off
        back.append(v);
        v.play?.().catch(() => { /* a wallpaper that will not autoplay is not an error worth showing */ });
      } else {
        const img = document.createElement('img');
        img.alt = '';                  // decorative: a wallpaper is not content to announce
        img.src = url;
        applyGrade(img, 'wallpaper');
        back.append(img);
      }
      // Cross-fade. At `still` there is no fade — a hard change is less motion than a
      // dissolve, which is the whole point of that setting.
      const fadeMs = motion() === 'still' ? 0 : FADE_MS;
      back.style.transition = fadeMs ? `opacity ${fadeMs}ms linear` : 'none';
      layers[front].style.transition = back.style.transition;
      back.style.opacity = '1';
      layers[front].style.opacity = '0';
      front = 1 - front;
      // The layer that just went out keeps its video decoding until the fade is over; then it
      // is emptied, or an hour of wallpaper leaves twenty <video> elements running.
      const gone = layers[1 - front];
      setTimer(() => { if (!destroyed && gone !== layers[front]) clearLayer(gone); }, fadeMs + 50);
    }

    function advance() {
      const p = pool();
      if (!p.length) { render(); return; }
      showItem(nextItem(p, { recent, rand: ctx.rand || Math.random, now: now() }));
    }

    function startSwap() {
      stopSwap();
      if (wallpaperMode(items, { policy: policy(), motion: motion() }) !== 'media') return;
      const run = () => {
        if (destroyed) return;
        advance();
        swap = setTimer(run, perItemMs());
      };
      swap = setTimer(run, perItemMs());
    }
    function stopSwap() { if (swap != null) { clearTimer(swap); swap = null; } }

    function render() {
      const media = wallpaperMode(items, { policy: policy(), motion: motion() }) === 'media';
      const box = el('[data-media]');
      if (box) box.hidden = !media;
      // The ambient stays UNDERNEATH rather than being torn down: a picture that fails to
      // load, or a folder that goes away mid-session, then falls back to something instead of
      // to a black rectangle.
      const amb = el('[data-ambient]');
      if (amb) amb.hidden = false;
    }

    async function ensureSource() {
      const sources = await client.list();
      knownSources = Array.isArray(sources) ? sources : [];   // folder art: the row's live options
      if (cfg.sourceId) {
        const found = sources.find((s) => s.id === cfg.sourceId);
        if (found) return found;
      }
      const qp = new URLSearchParams(location.search);
      const ws = qp.get('wallpaperSource');
      if (ws) {
        const base = ws.replace(/\/+$/, '');
        const existing = sources.find((s) => s.base_url === base);
        const src = existing || await client.add({ label: 'dev wallpaper', base_url: base, kind: 'agent' });
        state.set({ sourceId: src.id, album: qp.get('wallpaperAlbum') || cfg.album });
        return src;
      }
      return null;
    }

    async function reload() {
      const seq = ++loadSeq;
      let src = null;
      // *** A WALLPAPER NEVER REPORTS AN ERROR ON SCREEN. *** It is the thing shown when
      // something else has stopped; putting "source unreachable" in front of somebody who did
      // not ask for a wallpaper in the first place turns a calm screen into a fault report.
      // The ambient is always underneath, so every failure here has somewhere to land.
      clearRecheck();
      showSeq += 1;          // folder art: a picture still being read for the old listing lands on nothing
      // folder art: '' (a panel saved before the row existed) means the default, like any unset row.
      const choice = cfg.sourceId || NIMROD_FOLDER;
      try { src = await ensureSource(); }
      catch (e) { console.warn('wallpaper: sources', e); }
      if (seq !== loadSeq || destroyed) return;
      // folder art: the Nimrod folder's Artwork/Wallpapers (the default). Every way it can be unavailable lands on the
      // built-in wallpaper, with the reason under the settings row; a lapsed permission is looked at again by itself.
      if (!src && choice === NIMROD_FOLDER) {
        let r = { status: 'error', dir: null, items: [] };
        try { r = await readNimrodWallpapers({ store: folderStore }); }
        catch (e) { console.warn('wallpaper: the Nimrod folder', e); }
        if (seq !== loadSeq || destroyed) return;
        source = r.dir ? { kind: 'nimrod', dir: r.dir } : null;
        items = r.dir ? r.items : [];
        folderState = { choice, status: r.status, count: items.length };
        if (r.status === 'permission') armRecheck();
        render();
        if (pool().length) { advance(); startSwap(); }
        return;
      }
      if (!src) {
        source = null; items = [];
        folderState = { choice, status: choice === NO_FOLDER ? 'ok' : 'gone', count: 0 };
        render(); return;
      }
      let listing = null;
      let failed = null;
      try { listing = await resolveListing(src, cfg.album); }
      catch (e) { console.warn('wallpaper: listing', e); failed = e; }
      if (seq !== loadSeq || destroyed) return;
      source = src;
      items = (listing?.items || []).filter((it) => it.kind === 'image' || it.kind === 'video');
      const code = failed ? (['permission', 'missing', 'album'].includes(failed.code) ? failed.code : 'error') : null;
      folderState = { choice, status: code || (items.length ? 'ok' : 'empty'), count: items.length };
      render();
      if (pool().length) { advance(); startSwap(); }
    }

    // folder art: a lapsed permission comes back only when somebody presses Allow elsewhere; look again now and then.
    function armRecheck() {
      clearRecheck();
      recheck = setTimer(() => {
        recheck = null;
        if (!destroyed) reload().catch((e) => console.warn('wallpaper: recheck', e));
      }, SOURCE_RECHECK_MS);
    }
    function clearRecheck() { if (recheck != null) { clearTimer(recheck); recheck = null; } }

    function applyConfig() {
      startTick();
      render();
      startSwap();
    }

    return {
      __probe: () => ({
        motion: motion(), policy: policy(), systemReduced,
        mode: wallpaperMode(items, { policy: policy(), motion: motion() }),
        items: items.length, usable: pool().length,
        currentId: current?.id || null,
        ticking: tick != null, swapping: swap != null,
        css: el('[data-ambient]')?.style.background || '',
        folder: { ...folderState }, rechecking: recheck != null,   // folder art
        shownSrc: layers.map((l) => l.querySelector('img,video')?.getAttribute('src') || ''),
      }),

      // folder art: the row's live options - the two of its own around every connected folder - and the line under it.
      settingsChoices: () => ({
        sourceId: {
          options: [
            { value: NIMROD_FOLDER, label: 'Wallpapers in your Nimrod folder' },
            ...knownSources.filter((s) => s && s.id).map((s) => ({ value: s.id, label: s.label || s.base_url || s.id })),
            { value: NO_FOLDER, label: 'None: just the built-in wallpaper' },
          ],
          status: folderNote(folderState.choice, folderState.status, folderState.count),
        },
      }),

      init() {
        mount.innerHTML = `
          <div class="wp">
            <div class="wp-ambient" data-ambient></div>
            <div class="wp-media" data-media hidden>
              <div class="wp-layer" data-layer></div>
              <div class="wp-layer" data-layer></div>
            </div>
          </div>`;
        layers = [...mount.querySelectorAll('[data-layer]')];

        mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        systemReduced = !!mq?.matches;
        onMq = (e) => { systemReduced = e.matches; applyConfig(); };
        mq?.addEventListener?.('change', onMq);

        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        t0 = now();
        applyConfig();

        state?.subscribe?.(() => {
          cfg = { ...DEFAULTS, ...(state.get() || {}) };
          applyConfig();
          reload().catch((e) => console.warn('wallpaper: reload', e));
        });

        // `wallpaper/next` so the same skip any other module offers is available here. It is
        // a convenience, never a requirement: nothing waits for it.
        bus?.subscribe?.('wallpaper/next', () => advance());

        reload().catch((e) => console.warn('wallpaper: load', e));
      },

      onResize() { /* the layers are CSS-sized; nothing to recompute */ },
      onHide() { stopTick(); stopSwap(); clearRecheck(); },
      // folder art: shown again, a Nimrod folder that was not ready (set up, allowed or filled since) is read again.
      onShow() {
        applyConfig();
        if ((cfg.sourceId || NIMROD_FOLDER) === NIMROD_FOLDER && folderState.status !== 'ok') {
          reload().catch((e) => console.warn('wallpaper: reload', e));
        }
      },

      destroy() {
        destroyed = true;
        client.dispose();
        stopTick(); stopSwap(); clearRecheck();
        mq?.removeEventListener?.('change', onMq);
        for (const l of layers) { try { clearLayer(l); } catch { /* already gone */ } }
        layers = [];
        mount.innerHTML = '';
      },
    };
  },
);

export { MOTIONS };
