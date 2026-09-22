// modules/ambient_drift.js — the ambient layer's first (and, on purpose, only) occupant.
//
// Chat, in the inbox, once Mike approved building the band itself: *"The layer plus ONE
// trivial thing drifting in it, to prove the band works. Not the idle game, not
// Comet-as-ambient, not the catchable-balloon economy."* This is that one trivial thing —
// a handful of soft dots drifting slowly behind the panels — and nothing else. It has no
// settings of its own, answers no verbs, and does not try to be caught.
//
// `mount: 'ambient'` on the manifest is what makes kiosk.js hand this the host-owned ambient
// surface (`.k-ambient`, band 100 in layers.css) instead of a normal `.k-mod` dashboard slot —
// see kiosk.js's `partition()`. It never occupies a slot and cannot be placed in one.
//
// MOTION IS NOT A SECOND SETTING. `wallpaper.js` already carries the photosensitivity
// reasoning (the calm end has to be GENUINELY calm, not "less animation") and a real,
// three-level scale (`gentle`/`calm`/`still`) via its own `motionOf`. This module reads that
// SAME setting off a sibling `wallpaper` instance on the same profile, if one exists, rather
// than inventing a parallel motion control this profile would have to set twice. No wallpaper
// module on the profile at all reads the same as `motionOf`'s own fallback: `gentle`.

import { registerModule } from '../module.js';
import { createProfilesClient } from '../profile.js';
import { createState } from '../state.js';
import { motionOf } from '../wallpaper.js';

// One duration per motion level, matching wallpaper.js's own ordering (slower = calmer).
// `still` has no entry on purpose — see `render()` below, which skips the animation
// altogether rather than setting a very long duration. "None, on request, everywhere."
const DRIFT_MS = { gentle: 60000, calm: 150000 };

const DOT_COUNT = 4;

registerModule(
  { type: 'ambient_drift', title: 'Ambient drift', mount: 'ambient', core: 'new',
    dependsOn: 'none', importance: 'optional',
    description: 'a few soft shapes drifting behind the panels — proves the ambient layer works, nothing more' },
  (ctx) => {
    const { mount } = ctx;
    let torn = false;

    // The SAME per-profile wallpaper motion setting `modules/wallpaper.js` itself reads —
    // found by looking for a sibling instance, the same profile-scoped lookup this session's
    // Settings module already uses for its own MODULE scope. Best-effort: offline, no
    // wallpaper module, or any other failure all read as "nothing saved", which `motionOf`
    // already turns into its own safe default.
    async function readMotion() {
      try {
        const profiles = createProfilesClient({ user: ctx.user });
        const profile = await profiles.get(ctx.profileId);
        const wp = (profile?.modules || []).find((m) => m.type === 'wallpaper');
        if (!wp) return motionOf(null, false);
        const st = createState({ url: profiles.stateURL(ctx.profileId, wp.id), user: ctx.user });
        await st.load();
        const reduced = typeof matchMedia === 'function'
          && matchMedia('(prefers-reduced-motion: reduce)').matches;
        return motionOf((st.get() || {}).motion, reduced);
      } catch {
        return motionOf(null, false);
      }
    }

    function render(motion) {
      if (torn) return;
      mount.innerHTML = '';
      const style = document.createElement('style');
      style.textContent = `
        .amb-drift{position:absolute;inset:0;overflow:hidden}
        .amb-dot{position:absolute;border-radius:50%;background:var(--on-dark,#fff);opacity:.16}
        .amb-dot.moving{animation:amb-float linear infinite}
        @keyframes amb-float{
          from{transform:translateX(-10vw)}
          to{transform:translateX(110vw)}
        }`;
      mount.appendChild(style);
      const field = document.createElement('div');
      field.className = 'amb-drift';
      // STILL MEANS STILL. No `.moving` class, no `animation`, no motion at all — the exact
      // guarantee `wallpaper.js`'s own header argues for, extended to this layer rather than
      // re-argued for it.
      const moving = motion !== 'still';
      const ms = DRIFT_MS[motion] || DRIFT_MS.gentle;
      for (let i = 0; i < DOT_COUNT; i += 1) {
        const dot = document.createElement('div');
        dot.className = moving ? 'amb-dot moving' : 'amb-dot';
        const size = 10 + (i % 3) * 6;
        dot.style.cssText = `width:${size}px;height:${size}px;top:${12 + i * 20}%;`
          + (moving ? `animation-duration:${Math.round(ms * (0.8 + i * 0.1))}ms;`
                    + `animation-delay:${Math.round(-ms * (i / DOT_COUNT))}ms;`
                    : 'left:20%;');
        field.appendChild(dot);
      }
      mount.appendChild(field);
    }

    return {
      async init() {
        render('gentle');           // correct-shaped placeholder immediately, never a blank frame
        const motion = await readMotion();
        if (!torn) render(motion);
      },
      onResize() {},
      onHide() {},
      destroy() { torn = true; },
      // For a test to assert on without parsing rendered CSS by hand.
      __probe: () => ({
        dots: mount.querySelectorAll('.amb-dot').length,
        moving: mount.querySelectorAll('.amb-dot.moving').length,
      }),
    };
  },
);
