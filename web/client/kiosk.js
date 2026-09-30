// kiosk.js — the full-screen PRODUCT surface (as opposed to index.html, the dev
// harness). It opens ONE profile full-screen, caregiver-driven by keyboard + mouse
// (the patient isn't controlling it yet), with:
//
//   * a big STAGE that shows one module at a time (photos / youtube / the Lineup
//     director / …), switchable with number keys or the on-screen dots;
//   * persistent HUD OVERLAYS — the camera self-view "mirror" and a translucent
//     clock — mounted ONCE and left running while the stage changes. The model is
//     "one content surface + a small HUD", not the old four-quadrant split.
//   * MIRROR MODE (C): the camera fills the whole screen; press again to return.
//   * an auto-hiding control bar (mouse).
//
// LAYOUT IS PER-PROFILE DATA. The mirror's SIZE + CORNER and the clock's CORNER live
// in the profile `settings` blob (the same one that carries theme + voice), so they
// re-render for free and can be tuned at the bedside — `[`/`]` resize the mirror,
// `\` cycles its corner, and the choice persists to the profile. Defaults: a large
// mirror top-right, the clock bottom-left.
//
// Stage modules are mounted LAZILY (only the visible one is live, so a hidden
// youtube/director isn't playing audio behind the scenes); the HUD overlays are the
// exception. Reuses the exact runtime + container ctx the harness uses, so a Lineup
// director works here. Resilience: state handles + the profile fetch are cached, so a
// brief server outage doesn't blank the screen (the media agent is local).

import { createBus } from './bus.js';
import { createState } from './state.js';
import { createEvents } from './events.js';
import { createPush } from './push.js';
import { createProfilesClient } from './profile.js';
import { mountModule, extendCtx } from './module.js';
import { createOutputBus } from './output.js';
import { createAudioBus } from './audio_bus.js';
import { createCameraOwner } from './camera_owner.js';
import { defaultChannels } from './output_channels.js';
import { REMOTE_STREAM } from './output_remote.js';
import { createArrangement, layoutChange } from './arrangement.js';
import { barModel, drawChips, drawHelpButton, mountBarHelp, helpOn } from './transport_bar.js';
import { createLongPress } from './input_longpress.js';
import {
  SHELL_NEXT, SHELL_PREV, SHELL_PANEL, SHELL_HUSH, SHELL_MENU, SHELL_FULLSCREEN, SHELL_HOME, SHELL_MIRROR,
  SHELL_STATE, SHELL_HELP, PLAIN_BAR_SHOW, PLAIN_BAR_RING, PLAIN_BAR_RING_END, PLAIN_BAR_MOUNT_GRACE_MS,
  PLAIN_BAR_HOLD_DEFAULT_MS,
} from './shell_verbs.js';
import { SYSTEM_TOPICS } from './actions.js';
import { attachMasterVolume, MASTER_FIELDS } from './master_volume.js';
import { createMixerFx } from './mixer_fx.js';
import { attachMixer, MIXER_FIELDS } from './mixer.js';
import { attachListening, LISTENING_FIELDS } from './listening_cue.js';
import {
  attachSpeech, speechOptionsFrom, speechSwitchFrom, browserRecognizer, SPEECH_FIELDS, SPEECH_ON_FIELDS,
  SPEECH_ACTIONS, NEAR_MISS_ACTIONS, SPEECH_BINDINGS, SPEECH_DEVICE,
} from './input_speech.js';
import { createMissStore, MISS_FIELDS } from './speech_misses.js';
import { createSubtitles, SUBTITLES_FIELDS } from './subtitles.js';
import { createAmplifier, AMPLIFY_FIELDS } from './amplify.js';
import { createPhoneMicReceiver, mountMicLiveIndicator, PHONE_MIC_TOPIC } from './phone_mic.js';
import { mountSettings } from './settings.js';
import { LAYERS } from './layers.js';
import { fieldsFor, fieldItems, normalizeField } from './settings_fields.js';
import { mountPackLoader } from './pack_loader.js';
import { controlPages, CONTROL_ITEMS } from './controls_view.js';
import { connectionsPage, CONNECTION_ITEMS } from './connections.js';
import { createHealthWatch } from './health.js';
import { nextAction, applied, cleared, chooseFallback, DEFAULT_POLICY,
         RECOVERY_SETTINGS } from './recovery.js';
import { listManifests } from './module.js';
import { mountInputRuntime, INPUTS_KEY, RECORD_VERSION } from './input_runtime.js';
import { mountCursor } from './cursor.js';
import { createMicOwner } from './mic_owner.js';
import { DEFAULT_BINDINGS, isTyping } from './input_keyboard.js';
import { attachDriveToBus } from './drive.js';
import { createCallTransport, CALL_TRANSPORT_READY } from './call_transport.js';
import { readConfig, writeConfig, bootPlan, markHopped, hasHopped,
         restartItems } from './restart.js';
import { takePreviewLayout } from './preview.js';
import { applyTheme, listThemes, DEFAULT_THEME, THEMES } from './theme.js';
import { syncScene } from './livescene.js';
import { cachedFetch } from './cache.js';
import './modules/clock.js';
import './modules/keyboard.js';
import './modules/camera.js';
import './modules/photos.js';
import './modules/youtube.js';
import './modules/personal.js';
import './modules/educational.js';
import './modules/director.js';
import './modules/sprint.js';
import './modules/quests.js';
import './modules/progress.js';
import './modules/reading_log.js';
import './modules/calculator.js';
import './modules/button.js';     // registers 'button' (the game's name sign and picture)
import './modules/wordforge.js';
import './modules/trivia.js';    // registers 'trivia'
import './modules/scoreboard.js';      // registers 'scoreboard'
import './modules/room.js';            // registers 'room'
import './modules/word_games.js';      // registers 'word_games'
import './modules/spelling.js';        // registers 'spelling' (row 2.45)
import './modules/simple_math.js';     // registers 'simple_math'
import './modules/name_that.js';       // registers 'name_that' (animal / state / person)
import './modules/karaoke.js';         // registers 'karaoke'
import './modules/solitaire.js';       // registers 'solitaire' (row 2.37, Klondike)
import './modules/note.js';            // registers 'note' (row 2.37, a note from someone)
import './modules/weather.js';         // registers 'weather' (row 2.37, the weather behind the window)
import './modules/bank.js';      // registers 'bank' (the shared questions + words)
import './modules/lessons.js';
import './modules/algebra.js';
import './modules/pond.js';
import './modules/wallpaper.js';
import './modules/scene.js';
import './modules/board.js';
import './modules/comet.js';
import './modules/pressgame.js';
import './modules/call.js';
import './modules/view.js';
import './modules/settings.js';
// Registered here (so the mechanism runs when a profile has one) but deliberately NOT wired
// into home.html's "Add module" picker or modules_catalog.js yet — whether/how this should be
// user-addable at all is a real product decision nobody has made; see MIKE_CHANGE_LIST.md
// §everything-becomes-a-module's sibling row on the ambient layer for the actual scope this
// shipped ("prove the band works", not a caregiver-facing feature).
import './modules/ambient_drift.js';
// UNLIKE ambient_drift above, this one IS meant to be user-addable — Mike asked for the real
// feature, not just proof the ambient band works (MIKE_CHANGE_LIST.md §comet-headless-toggle-
// proposal). Wired into home.html/modules.html's composer and modules_catalog.js as well.
import './modules/comet_ambient.js';

// Swapping the whole screen. `kiosk/show` takes a screen id (or {profileId}); `kiosk/back`
// returns to the one before it. A state machine drives these from a state's `enter`.
export const SCREEN_SHOW = 'kiosk/show';
export const SCREEN_BACK = 'kiosk/back';
export const SCREEN_SHOWN = 'kiosk/shown';

// Mount a kiosk for one profile into `root`. Returns a small control handle
// (also used by the dev test). `profiles`/`bus` are injectable.
// `makeState` / `makeEvents` / `sources` are injectable for the same reason home.html needs
// them: signed out, there is no server to hold any of this, and the kiosk has to run anyway.
// Default to the server-backed handles so every existing caller is unchanged.
export async function mountKiosk(root, {
  user, profileId, profiles, bus, makeState = null, makeEvents = null, sources = null,
  // Seams for the restart behavior: the test needs its own storage and must never be
  // navigated away from mid-run.
  storage = undefined, session = undefined,
  navigate = (url) => { if (typeof location !== 'undefined') location.replace(url); },
  // RECOVERY SEAMS. All three exist so the test can walk the whole ladder without anything
  // actually happening - a suite that reloads the page cannot report its own results, and
  // one that reboots a machine is not a suite anybody will run twice.
  reloadPage = () => { if (typeof location !== 'undefined') location.reload(); },
  // Null means THIS DEVICE CANNOT REBOOT ITSELF, which is the honest default: no browser on
  // any platform can restart the host OS. A Nimrod appliance with a local helper supplies one.
  rebootDevice = null,
  onRecovery = null,               // told about every action taken, for the log and the tests
  recoveryNow = () => Date.now(),
  recoveryTick = 60 * 1000,
  // Burn-in protection's own idle wait (2.18) — real default below, ten minutes. A test that
  // actually waited that long to prove the dim/drift class appears would be a test nobody
  // runs; this seam lets it use milliseconds instead, the same reason `recoveryTick` is one.
  burnInIdleMs = 10 * 60 * 1000,
  // *** `embedded`: "THIS KIOSK IS A PREVIEW HOST ON SOMEBODY ELSE'S PAGE." Default false, and
  // false is byte-for-byte today's behavior. `modules.html` mounts the real kiosk inside a box on
  // a public page so the transport bar and settings menu are the ONE implementation rather than
  // a copy that drifts (module_try.js's `mountEmbeddedKiosk`). When true, and ONLY then:
  //   - it never presents itself as the person's screen: no remote-drive socket, so nobody can
  //     drive a page that merely happens to be open in a browser tab, and no "someone is helping"
  //     banner logic behind it;
  //   - it keeps FALLBACK bindings (`DEFAULT_BINDINGS`) and never loads the person's saved ones,
  //     nor the marker-tracking / microphone-preference layer that comes after them. A saved
  //     `pointer:mouse` binding makes `input_pointer.js` route every left click through the bus
  //     as a switch press instead of clicking what you point at - the exact hijack
  //     `module_try.js`'s createLiveHost header documents on this same page;
  //   - it sizes to its parent (`.k-embed`, kiosk.css) instead of the viewport, keeps its bar
  //     showing (a visitor cannot use a settings menu they cannot see), and ignores the
  //     screen's saved arrangement (one panel on the stage), the profile cache, and the
  //     watch that reloads when a corrected layout arrives after boot;
  //   - it does not consume the composer's one-shot preview-layout stash, does not stomp the
  //     host page's own theme when the screen has none saved, and its caregiver hotkeys only
  //     answer when the keystroke is inside `root` (a reader pressing "f" on a public page must
  //     not go fullscreen).
  // The caller supplies `navigate`/`reloadPage`/`storage`/`session` seams; `reloadPage` here
  // means "rebuild this embed", not "reload the page".
  embedded = false,
  // `embedLayout` -- ONLY read when `embedded` is true; ignored otherwise, so no real screen can be
  // handed an arrangement this way. An embed normally shows one panel on the stage with no layout.
  // The camera, the clock and ambient modules are not panels on a stage (`partition()` turns them
  // into the mirror, the corner clock and the background layer), so they would get no bar and no
  // menu of their own. A one-slot layout that PLACES them makes each an ordinary panel, which is
  // what `partition()` already does for any placed module. Held in memory only: the kiosk never
  // writes its layout back (its one write to `settings.kiosk`, `patchMirror`, spreads the STORED
  // value), so a signed-in visitor's real arrangement is untouched.
  embedLayout = null,
  // *** `dashboardModule` -- STEP 6 STAGE 3 (2026-09-30). Default false, and ONLY read when `embedded` is
  // true: no real screen can be switched onto it by passing this. When on, the panels are not mounted
  // by this file's own arrangement: the shell mounts ONE dashboard module (`modules/view.js`, a thin
  // module over the same `arrangement.js`) and draws its bar and menu from THAT module's arrangement.
  // `modules.html` turns it on (module_try.js), so it is proven on a public page before any screen
  // anybody sits at. Stage 4 makes it the default on a real screen; until then nothing else changes.
  dashboardModule = false,
  // STEP 6 STAGE 3b -- both read only on the dashboard path (`embedded` + `dashboardModule`).
  // `dashboardChrome`: what the dashboard PLACES besides its panels -- by default the transport bar
  // along the bottom and the settings menu down the side (Mike, 2.33: the default dashboard "will
  // start out with the settings/edit menus and transport bar as open modules"). `[]` places none, and
  // then the plain bar is the bar. `plainBarSummonMs`: how long a SUMMONED plain bar stays after the
  // last touch while a placed bar carries it -- a seam for the suites, like `burnInIdleMs`.
  dashboardChrome = undefined,
  plainBarSummonMs = 6000,
  // *** THE SPEECH RECOGNISER, BY WHICH ENGINE THE PERSON CHOSE (2026-09-30). *** Called ONLY when a
  // person's row turns spoken commands (or subtitles) on - never at boot. `null` means "none here", and
  // the screen says so. 'local' has no engine yet (a Vosk/whisper service on the device plugs in HERE);
  // 'browser' is the browser's own, which sends the room's sound to its maker (input_speech.js header),
  // so it is only ever made when somebody chose it by name. A seam for the suites, too.
  makeRecognizer = ({ engine, lang } = {}) => (engine === 'browser' ? browserRecognizer({ lang }) : null),
} = {}) {
  const useDashboard = !!embedded && !!dashboardModule;
  bus = bus || createBus();
  // Read before anything else renders: if this screen is not where the device is meant to
  // come back to, the cheapest possible outcome is to leave before mounting a whole kiosk.
  let restart = readConfig(user, storage);
  profiles = profiles || createProfilesClient({ user });
  // ONE shared push connection for every events handle this kiosk opens, not one per
  // handle — see push.js's own header for why. Only on the real server-backed path:
  // `makeEvents` injected means signed-out/offline/test, with no server to hold a
  // stream open to in the first place (same reason that path skips `createProfilesClient`
  // above). Every `createEvents()` call below still works with no `push` at all — it is
  // an accelerant for the existing poll-with-backoff, never the only path to a correct
  // screen (push.js's "fails quiet" header).
  const push = makeEvents ? null : createPush({ user });

  root.innerHTML = `
    <div class="kiosk">
      <!-- THE AMBIENT LAYER (band 100, layers.css). Empty by default -- a host-owned surface
           for whatever a headless 'mount: ambient' module draws, sitting behind every panel
           (z-panels, band 200) but above nothing else. aria-hidden because it is scenery,
           never content a screen reader should announce -- the same rule the board's own
           under-the-cards layer follows (modules.css's .ab-flight class). NO BACKTICKS: this
           comment is inside a template literal and one closes the string. -->
      <div class="k-ambient" data-ambient hidden aria-hidden="true"></div>
      <div class="k-stage" data-stage></div>
      <div class="k-mirror" data-mirror hidden></div>
      <div class="k-clock" data-clock hidden></div>
      <div class="k-controls" data-controls>
        <div class="k-mods" data-mods></div>
        <div class="k-actions">
          <!-- *** "Home", NOT "Screens". Mike's call, 2026-09-06. *** His reasoning: people
               will see "Screens" and ask what screens MEANS, and Home is the familiar exit
               word. He was given the argument against it — a button called Home that does not
               take you home reads oddly — and chose Home anyway, which is his to choose.
               The title says what it actually does, which is where the precision belongs. -->
          <button data-act="home" title="your screens, and the way out (H)">⌂ Home</button>
          <!-- BACK. The reverse of Next, and until now there was nothing here — see
               prevInPrimary below for why this waited on nothing new: photos, personal,
               educational, youtube, wordforge, trivia and interstitials already
               answer a type/prev topic (MODULE_VERBS in actions.js), because the
               keyboard's ArrowUp has driven it all along. The button was the only thing
               missing.
               NO BACKTICKS IN THIS COMMENT. It lives inside a template literal, same trap
               documented in home.js — a backtick here closes the template string early and
               turns the next word into a bare JS identifier, which is exactly what broke
               here (SyntaxError: Unexpected identifier 'prevInPrimary'). -->
          <button data-act="back" title="back — the one before this (↑)">◂ Back</button>
          <button data-act="next" title="next (→ / space)">Next ▸</button>
          <!-- Only on an arranged screen; hidden below when there is no layout. See panelNext. -->
          <button data-act="panel" title="move to the next panel" hidden>Panel ▸</button>
          <button data-act="mirror" title="mirror mode (C) — camera full screen">Mirror</button>
          <!-- *** PLAY/PAUSE WAS INVESTIGATED AND DELIBERATELY LEFT OUT. ***
               NO BACKTICKS IN THIS COMMENT — same trap as the one above: this lives inside
               the root.innerHTML template literal and a backtick here closes that string
               early, exactly the bug that had to be fixed in the BACK comment just above.
               There is no cross-module "is this panel playing" concept to put a button on top
               of. audio_bus.js (the Hush button, just below) arbitrates VOLUME LEVELS, not
               playback state — its own header says a source "enacts [a level] however it
               likes … or a pause", which means the bus cannot answer "is this paused" even
               for the sources that do pause on a duck. module.js's instance contract is
               init/onResize/onHide/onShow/destroy and nothing else; there is no
               togglePlay/isPlaying convention any module implements. The two modules that
               DO have a real running/paused state are shaped differently ON PURPOSE:
               sprint.js exposes it as its OWN verb (sprint/control: start/pause/toggle,
               already reachable through Select/Next/Back once it has focus — see
               MODULE_VERBS in actions.js), and youtube.js leaves pause to the PLAYER'S OWN
               ON-SCREEN CONTROLS deliberately (pauseIsReachable = true, so "a visitor has a
               pause button to press"). A single bar button can reach neither without either
               reinventing a name every module would have to adopt, or special-casing two
               module types by hand and silently doing nothing on every other panel — and a
               control that looks live and is not is worse than no control (see the D16 note
               in input_router.js: "a control that removes itself when pressed is the
               failure mode Nimrod exists to prevent" — a control that LOOKS pressable and
               ISN'T is that same failure from the other direction). Building the real thing
               means giving every playable module a shared capability, which is a change to
               every module in modules/ and out of scope for this task (kiosk.js/clock.js
               only). Left out rather than shipped cosmetic — Hush remains the one real,
               working "make the noise stop" control on this bar. -->
          <!-- HUSH. Not a mute: her voice and any cue still come through, only the media
               stops. It is for the ordinary moment when somebody walks in to talk to her and
               the music is in the way. -->
          <button data-act="hush" data-on="0"
            title="pause the music and video so you can talk (voices and speech are still heard)">Hush</button>
          <button data-act="settings" title="settings (Esc or M)">⚙</button>
          <button data-act="fs" title="fullscreen (F)">⛶</button>
        </div>
      </div>
      <!-- The screen picker. A STRIP above the transport bar, not a scrim over the screen:
           whatever is playing keeps playing and stays visible while somebody chooses. See
           toggleScreens below. NO BACKTICKS: this comment is inside a template literal and one
           closes the string. dev/imports_test.html caught this within seconds of the mistake,
           which is the third time in one session and the first time it cost nothing. -->
      <div class="k-screens" data-screens hidden role="group" aria-label="your screens"></div>
      <div class="k-remote" data-remote hidden>Someone is helping from another screen</div>
      <div data-settings></div>
    </div>`;
  const kioskEl = root.querySelector('.kiosk');
  if (embedded) kioskEl.classList.add('k-embed');
  // *** A LIVE THEME'S ANIMATED WORLD MUST LIVE INSIDE THE FULLSCREEN TARGET. ***
  //
  // Mike, 2026-09-23: "Transparent background and themes don't seem to work when you go into
  // fullscreen." Traced, not guessed at: `toggleFs()` below calls `root.requestFullscreen()` —
  // `root` is the element `mountKiosk` was handed (`kiosk.html`'s `#root`), a PLAIN SIBLING of
  // whatever `applyTheme(document.documentElement, ...)` mounts a live scene INTO. `theme.js`'s
  // own `applyTheme` always calls `syncScene(rootEl, theme)` with the SAME `rootEl` it was
  // given, and `livescene.js`'s `syncScene` treats `rootEl === document.documentElement` as "the
  // whole page" and appends the scene straight onto `document.body` — a SIBLING of `#root`, not
  // a descendant of it. The Fullscreen API only paints the fullscreened element and ITS OWN
  // descendants; a sibling appended to `<body>` is excluded from that view entirely, confirmed
  // directly (`document.getElementById('root').contains(document.querySelector('.ls')) ===
  // false`) rather than assumed from the spec. `panelSurface: clear/veil` then has nothing left
  // to reveal once fullscreen hides the very layer it was supposed to show through.
  //
  // Fixed by ALSO mounting the scene where it survives fullscreen: `.kiosk` is already a real
  // descendant of `root`, already positioned (`position:fixed;inset:0`) so `.ls`'s own
  // `position:absolute;inset:0` resolves against it correctly, and already an isolated stacking
  // context so the scene's own `z-index:var(--z-world)` sorts behind `.k-stage`'s panels (200)
  // without a new host element. `data-scene-host` is `livescene.js`'s own opt-in marker (the
  // SAME mechanism `board.js`'s per-instance veil/clear mode already uses) — set once, here,
  // rather than re-checked on every theme change. The ORIGINAL `document.documentElement` mount
  // is left running too, deliberately not torn out: nothing reads `html[data-live-scene]` from
  // this file, but another page's own CSS might, and removing a working, order-independent
  // effect to save one redundant (and cheap — CSS-driven, not a second detection loop) animated
  // background is not a trade worth making under time pressure without checking every caller.
  kioskEl.setAttribute('data-scene-host', '');
  function applyKioskTheme(id) {
    // An embed lives on somebody's page, which already has a theme (its own picker, or the
    // signed-in profile's). A screen that has never picked one must not reset that to default.
    if (embedded && !id) return null;
    const resolved = applyTheme(document.documentElement, id);
    syncScene(kioskEl, THEMES[resolved]);
    // The mixer's "sounds like: match the scene" follows the scene the screen is actually showing.
    soundScene = THEMES[resolved]?.scene || null;
    try { mixer?.setScene(soundScene); } catch (err) { console.error('kiosk: mixer scene', err); }
    return resolved;
  }
  const stageEl = root.querySelector('[data-stage]');
  const ambientEl = root.querySelector('[data-ambient]');
  const mirrorEl = root.querySelector('[data-mirror]');
  const clockEl = root.querySelector('[data-clock]');
  const controlsEl = root.querySelector('[data-controls]');
  const remoteEl = root.querySelector('[data-remote]');
  const modsEl = root.querySelector('[data-mods]');

  // WHOSE SCREEN THIS IS. Declared UP HERE rather than beside the lookup that fills it,
  // because `childCtx` exposes it as a getter and the first module mounts before that
  // lookup has even started - a `let` further down the file is still in its temporal dead
  // zone at that moment, which threw. Null until the background resolve lands, which every
  // consumer already has to handle anyway.
  let personId = null;

  // The output bus for this surface. Built once, shared by every module on the screen -
  // which is the whole point of it: there is ONE pair of ears, so arbitration has to happen
  // above the modules or two of them talk over each other and produce nothing.
  //
  // Channels are whatever this device actually has. `defaultChannels` omits a channel it
  // cannot provide rather than shipping a broken one, so output.js reports `no-adapter`
  // instead of a message vanishing.
  // *** THE SPEAKER ARBITER, ABOVE THE OUTPUT BUS AND ABOVE EVERY MODULE. ***
  // There is one pair of ears on this screen. A video, a game's music bed and a spoken cue
  // all reach it at once unless something coordinates them, and the coordination has to live
  // above all three - a module cannot know what else is making noise. Built before the output
  // bus because the speech channel registers with it.
  const audio = createAudioBus();

  // *** THE CAMERA ARBITER. *** One webcam, and on Linux a second open of it FAILS rather
  // than sharing - so unlike the speaker this is a strict single owner. It exists mainly to
  // protect one thing: her mirror must not go dark because a call arrived. See camera_owner.js.
  const cameraOwner = createCameraOwner();

  // *** THE MICROPHONE ARBITER. *** Same discipline as the camera and one extra reason for it:
  // two things holding a live microphone is a privacy event, not a resource conflict, and a
  // single owner is the only thing that can honestly answer "is anything listening?". Nothing
  // opens it here — it is opened by whatever acquires it, which today is a call and nothing
  // else. See mic_owner.js for why a call and a recognizer want opposite processing.
  //
  // *** THE FALLBACK PREFERENCE, FOUND MISSING 2026-09-17. *** `home.js`'s Devices tab lets a
  // caregiver set an ORDERED list of preferred microphones (mic_owner.js's whole reason for
  // being one — "for somebody whose only route to being understood runs through it, [losing
  // it] is being cut off") and writes it to per-person state. This construction used to call
  // `createMicOwner()` with no `preferred` at all — the actual bedside screen never read that
  // list, so a call here fell back to whatever `getUserMedia` picked by default, silently
  // ignoring a preference the caregiver had already configured on another device. `deviceState`
  // below is loaded the same way `markerState` already is; `preferred` is a function so it
  // reads whatever is currently loaded rather than freezing the value from before boot.
  const micOwner = createMicOwner({
    preferred: () => (deviceState?.get() || {}).microphonePreferred || [],
  });

  let output = null;
  // *** DECLARED HERE, NOT WHERE THEY ARE BUILT, AND THAT IS NOT TIDINESS. ***
  // `childCtx` below hands modules a GETTER for the aim, because the input runtime is built
  // much further down and a module mounted first would otherwise capture null forever — the
  // same reason `output` and `personId` are getters. But a getter still needs its variable to
  // be IN SCOPE when it runs: with `let runtime` declared next to where it is assigned, the
  // first overlay to mount hit the temporal dead zone and the whole kiosk failed to boot with
  // "Cannot access 'runtime' before initialization". Caught by kiosk_test going from 133
  // passing to zero, which is the useful kind of failure.
  let runtime = null;
  // *** DECLARED HERE, NOT WHERE THEY ARE ASSIGNED, AND THIS IS THE SECOND TIME. ***
  //
  // `childCtx` hands modules a `get callTransport()` that reads both of these. A getter runs
  // whenever a module reads it -- at mount, for call.js -- and the first mount happens well before the async person
  // lookup further down builds them — so with `let` sitting beside the assignment, the getter
  // hit the temporal dead zone and threw `Cannot access 'callTransport' before initialization`
  // on the very first mount. Not a null, not a warning: the whole kiosk failed to start.
  //
  // `let runtime` above did exactly this once already (the kiosk suite went 133 to 0). The
  // pattern to keep: ANYTHING A GETTER ON `childCtx` READS IS DECLARED IN THIS BLOCK. The
  // laziness is the point — a module mounted early must see the value when it arrives, not
  // capture null forever — and that only works if the binding exists from the start.
  let drive = null;
  let callTransport = null;
  let cursor = null;
  let markerTracker = null;
  let markerState = null;
  let deviceState = null;      // the person's ordered microphone preference — see micOwner above
  // *** SET FIRST IN `destroy()`, AND READ AFTER EVERY AWAIT THAT BUILDS SOMETHING. ***
  //
  // The kiosk resolves its person in the background so a name lookup cannot stop the screen
  // coming up. That is right, and it means the two things the lookup builds — the person's
  // binding state and the marker tracker — are constructed AFTER a `destroy()` may already have
  // run past the lines that would have torn them down. Both then polled the server every 1500ms
  // about a screen that was gone, one more pair on every mount.
  //
  // Measured, not inferred: cycling `mountKiosk` gave 2, 4, 6 outstanding intervals over three
  // cycles. It is the same race `director.js` had, and it is a shape worth recognising —
  // *anything built after an await needs to ask whether it is still wanted.*
  let torn = false;

  // ---- THE SOUND OF THE SCREEN: master, mixer, effects, the listening cue (2026-09-30) ---------
  //
  // Built and tested on their own today (rows 2.28, 2.35, 2.36); this is where the screen constructs
  // them. The master and the mixer read the SCREEN's settings row (like a TV keeps its volume: the two
  // bedside units get swapped, and a mix saved per browser would reset on every swap -- master_volume.js
  // and mixer.js both say why). The listening cue reads the PERSON's row (it is about how that person
  // wants to be answered). Declared here with the rest of the early state, because modules reach the
  // effects through the audio bus handle below and a module can mount before the settings load.
  let master = null;             // master_volume.js: "louder"/"quieter" and the Volume row
  let mixer = null;              // mixer.js: faders and minimums on the bus, compressor/reverb on the effects
  let soundScene = null;         // the theme's live scene id, which "sounds like: match the scene" follows
  let listening = null;          // listening_cue.js: the cue, the tone, the duck, the voice-game pause
  let listenSig = null;
  let offListenPerson = null;
  let personInputs = null;       // the person's own row (bindings, and the listening settings beside them)
  // *** THE EFFECTS CHAIN IS MADE ON FIRST USE, NOT AT BOOT. *** mixer_fx.js makes an AudioContext the
  // moment anything touches a channel, and applying the saved mix at boot (the talking-board compressor
  // is on by default) would make one on every screen -- an audio thread running on a Pi 400 for a chain
  // nothing on the kiosk sends sound through yet (the board speaks through the browser's voice, which no
  // effect can reach). So the chain is built when a module first asks for it (game_music.js, through
  // `audio.effects()`), and the saved mix is replayed onto it then. Until that moment the mixer's effect
  // settings are remembered in the settings row and applied to nothing, which is exactly what they did.
  let fxReal = null;
  function effects() {
    if (fxReal || torn) return fxReal;
    try { fxReal = createMixerFx(); } catch (err) { console.error('kiosk: no mixer effects', err); fxReal = null; return null; }
    try { mixer?.sync(); mixer?.setScene(soundScene); } catch (err) { console.error('kiosk: mixer effects', err); }
    return fxReal;
  }
  const fxLazy = {
    setCompressor: (ch, on) => fxReal?.setCompressor(ch, on),
    setReverb: (ch, v) => fxReal?.setReverb(ch, v),
    setScene: (id) => fxReal?.setScene(id),
    state: () => (fxReal ? fxReal.state() : null),
  };
  // HOW A MODULE REACHES THE EFFECTS: through the audio bus handle it is already given (`ctx.audio`),
  // so game_music.js needs one optional read and no module had to change what it passes. A missing or
  // broken chain is `null`, and the caller plays direct, as it always did.
  audio.effects = effects;

  // The listening cue, (re)attached from the person's row -- only when one of ITS settings changed, so
  // a poll that brings nothing new does not remount the cue under somebody who is mid-sentence.
  const LISTEN_KEYS = [...LISTENING_FIELDS.map((f) => f.key), 'listenDuck'];
  const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; } };
  function attachListen(row = {}) {
    const r = row || {};
    const sig = JSON.stringify(LISTEN_KEYS.map((k) => (k in r ? r[k] : null)));
    if (listening && sig === listenSig) return;
    try { listening?.destroy(); } catch (err) { console.error('kiosk: listening cue', err); }
    listening = null;
    listenSig = sig;
    if (torn) return;
    try {
      listening = attachListening({ bus, audio, host: kioskEl, settings: r, reducedMotion: reducedMotion() });
    } catch (err) { console.error('kiosk: listening cue', err); }
  }

  // ---- THE VOICE: spoken commands, subtitles, amplify, a phone as a microphone (2026-09-30) ---------
  //
  // Second wiring pass (rows 2.28, 2.42; public 5263a56, 7bf59ef, 0636797). ALL OFF BY DEFAULT, and all
  // read off the PERSON's row (the one their bindings and listening settings already live in): how
  // somebody wants to be heard and shown follows them to any screen. A screen with no person (an
  // embed, signed out, not handed to anybody) has no row, so every one of these stays off there.
  //
  // *** NOTHING OPENS A MICROPHONE BY DEFAULT. *** The recogniser is made only when the row says
  // `speechOn` (or `subtitlesOn`, which needs the room's words written down), and only by the engine
  // the row names - 'local' by default, which does not exist yet, so the screen says "no recogniser on
  // this screen" instead of listening somewhere else. kiosk_test proves no getUserMedia and no
  // recogniser start without the setting.
  let speech = null;             // attachSpeech's handle while a recogniser is running, else null
  let speechSig = null;
  let speechStatus = 'off';      // off | no-local | no-browser | listening | subtitles-only
  let missStore = null;          // speech_misses.js, only while `speechMissLog` is on
  let offMissSchedule = null;
  let subtitles = null;          // subtitles.js: built once (the output bus taps it), a mode off by default
  let amplifier = null;          // amplify.js: built once (inert until the row turns it on)
  let ampSig = null;
  let subsSig = null;
  let phoneRx = null;            // phone_mic.js: the screen's half, once the drive socket exists
  let micPill = null;            // "Microphone on: <phone>" -- NO SETTING HIDES IT (see where it is mounted)
  let personRow = null;          // the person's row as last seen; null = no person row on this screen
  let onVoiceChange = null;      // the menu's refresh, once the menu exists (it is built further down)
  const SILENT_INPUT = { down() {}, up() {} };   // subtitles-only: the room is heard, nothing is pressed
  const SPEECH_KEYS = [...SPEECH_ON_FIELDS, ...SPEECH_FIELDS, ...MISS_FIELDS].map((f) => f.key);
  const AMP_KEYS = AMPLIFY_FIELDS.map((f) => f.key);
  const SUBS_KEYS = SUBTITLES_FIELDS.map((f) => f.key);
  const sigOf = (r, keys) => JSON.stringify(keys.map((k) => (r && k in r ? r[k] : null)));

  function stopSpeech() {
    try { speech?.destroy(); } catch (err) { console.error('kiosk: speech', err); }
    speech = null;
    try { offMissSchedule?.(); } catch { /* already stopped */ }
    offMissSchedule = null;
    missStore = null;
  }
  // (Re)attach speech from the person's row -- only when one of ITS settings changed, so a poll that
  // brings nothing new never restarts a recogniser under somebody who is mid-sentence.
  function syncSpeech(row) {
    const r = row || {};
    const sw = speechSwitchFrom(r);
    const subsOn = r.subtitlesOn === true;
    const want = sw.on || subsOn;
    const sig = JSON.stringify([want, !!runtime, torn, sigOf(r, SPEECH_KEYS)]);
    if (sig === speechSig) return;
    speechSig = sig;
    stopSpeech();
    speechStatus = 'off';
    if (torn || !want || !runtime) { onVoiceChange?.(); return; }
    let rec = null;
    try { rec = makeRecognizer({ engine: sw.engine, lang: 'en-US' }); } catch (err) { console.error('kiosk: recogniser', err); rec = null; }
    if (!rec) { speechStatus = sw.engine === 'browser' ? 'no-browser' : 'no-local'; onVoiceChange?.(); return; }
    const opts = speechOptionsFrom(r);
    // THE MISS LOG: only while spoken commands are on AND the person's row asks for it (OFF site-wide;
    // Mike, row 2.28 (b)). On this device, text only, pruned on a schedule that stops with the speech.
    if (sw.on && r.speechMissLog === true) {
      try {
        missStore = createMissStore({ keepDays: r.speechMissKeepDays, ...(storage ? { storage } : {}) });
        offMissSchedule = missStore.startSchedule();
      } catch (err) { console.error('kiosk: miss log', err); missStore = null; }
    }
    try {
      speech = attachSpeech(sw.on ? runtime.input : SILENT_INPUT, {
        recognizer: rec,
        ...opts,
        // Subtitles-only: no commands, so nothing is confirmed, asked, logged or announced -- the
        // recogniser is there to write the room down, and a wake phrase does nothing.
        ...(sw.on ? {} : { confirm: 'off', nearMiss: false }),
        output: sw.on ? output : null,
        bus: sw.on ? bus : null,
        misses: sw.on ? missStore : null,
        onHeard: (h) => { try { subtitles?.heard(h); } catch (err) { console.error('kiosk: subtitles', err); } },
      });
      speech.start();
      speechStatus = sw.on ? 'listening' : 'subtitles-only';
    } catch (err) {
      console.error('kiosk: speech', err);
      stopSpeech();
      speechStatus = 'off';
    }
    onVoiceChange?.();
  }
  // Everything the person's row drives, in one place: the listening cue, subtitles, amplify, speech.
  function applyPerson(row) {
    const r = row || {};
    personRow = r;
    attachListen(r);
    const ss = sigOf(r, SUBS_KEYS);
    if (ss !== subsSig) {
      subsSig = ss;
      try { subtitles?.update(r); } catch (err) { console.error('kiosk: subtitles', err); }
    }
    const as = sigOf(r, AMP_KEYS);
    if (as !== ampSig) {
      ampSig = as;
      try { amplifier?.update(r)?.catch?.((err) => console.error('kiosk: amplify', err)); }
      catch (err) { console.error('kiosk: amplify', err); }
    }
    syncSpeech(r);
  }

  // A DEVICE'S SHIPPED BINDINGS STAND UNTIL THE PERSON BINDS THAT DEVICE THEMSELVES. The runtime's
  // `fallback` only covers somebody with NOTHING saved; a person who saved a switch setup has a record,
  // and it replaced every default - including the spoken ones, so "computer please pause" would fire
  // nothing for exactly the people most likely to have set things up. So the person's handle is read
  // through this: a saved record with no binding on the speech device gets SPEECH_BINDINGS added (in
  // memory only - never written back). Binding any phrase yourself takes over the whole device.
  function withSpeechBindings(handle) {
    const add = (s) => {
      const rec = s && s[INPUTS_KEY];
      if (!rec || rec.v !== RECORD_VERSION || !Array.isArray(rec.bindings)) return s;
      if (rec.bindings.some((b) => b && b.device === SPEECH_DEVICE)) return s;
      return { ...s, [INPUTS_KEY]: { ...rec, bindings: [...rec.bindings, ...SPEECH_BINDINGS] } };
    };
    return {
      load: (...a) => handle.load(...a),
      get: () => add(handle.get()),
      subscribe: handle.subscribe ? (fn) => handle.subscribe((s) => fn(add(s))) : undefined,
      startPolling: (...a) => handle.startPolling?.(...a),
      destroy: (...a) => handle.destroy?.(...a),
      set: (...a) => handle.set?.(...a),
    };
  }

  // ---- MARKER TRACKING AT THE BEDSIDE -------------------------------------------------
  //
  // OFF UNLESS SOMEBODY TURNED IT ON. Not "started and idle": a screen that opens the webcam
  // because a feature exists is a screen with a camera light on in somebody's room for no
  // reason. The camera is opened only when the setting says to, and released the moment it
  // stops.
  //
  // The calibration is stored PER PERSON, in the same place the input bindings are, and it is
  // POLLED for the same reason: a caregiver can set the sock up on a laptop on the Devices tab
  // and it reaches the bedside within a poll or two, with nobody reloading anything on the
  // screen the person is using. That is the clinical scenario — one person configuring while
  // another is using it — and it needed no new transport, because per-person state already
  // does exactly this for switches.
  //
  // *** THERE IS NO CALIBRATION UI HERE, DELIBERATELY. *** Clicking the sock happens on home.
  // This surface only consumes the numbers — the same split `input_runtime.js` makes, where the
  // runtime consumes bindings and the binder stays on the other side.
  async function startMarkerTracking(personId2) {
    if (markerTracker || !personId2 || !profiles.personStateURL) return;
    const [{ createMarkerTracker, shouldTrack }, { MARKER_KEY }] = await Promise.all([
      import('./input_marker.js'), import('./marker_panel.js'),
    ]);
    if (torn) return;                              // the dynamic import is an await like any other
    markerState = createState({
      url: profiles.personStateURL(personId2, MARKER_KEY),
      user,
      cacheKey: `person:${user}:${personId2}:${MARKER_KEY}`,
      // The exact scenario push.js's own header names: "a laptop composing a setup and a
      // paired kiosk showing it." A caregiver clicking the sock on home now reaches the
      // bedside instantly when push is up, and within a poll or two either way.
      push,
    });
    await markerState.load().catch(() => {});     // offline: the shipped default is OFF anyway
    // Torn down while that loaded. Close the handle rather than leaving it polling for a screen
    // that no longer exists — `destroy()` has already run past its `markerState?.destroy?.()`.
    if (torn) { try { markerState.destroy?.(); } catch { /* already gone */ } markerState = null; return; }
    markerTracker = createMarkerTracker({
      aim: runtime.aim,
      cameraOwner,
      settings: () => markerState.get() || {},
    });
    const sync = (saved) => {
      const on = shouldTrack(saved);
      if (on && !markerTracker.isRunning()) {
        markerTracker.start().catch((err) => console.error('kiosk: marker camera', err));
      } else if (!on && markerTracker.isRunning()) {
        markerTracker.stop();
      }
    };
    sync(markerState.get());
    markerState.subscribe?.(sync);
    markerState.startPolling?.();
  }

  // ---- THE MICROPHONE FALLBACK PREFERENCE, PER PERSON --------------------------------
  //
  // Same shape as `startMarkerTracking` above, for the same reason: a caregiver sets this on
  // home.html's Devices tab, on any device, and it has to reach the bedside without anyone
  // reloading anything. `micOwner`'s `preferred` callback already reads `deviceState.get()`
  // lazily, so nothing else needs to change once this loads — the fallback ladder just starts
  // finding entries where it found none before.
  async function startDevicePreference(personId2) {
    if (deviceState || !personId2 || !profiles.personStateURL) return;
    const { DEVICE_KEY } = await import('./device_panel.js');
    if (torn) return;                              // the dynamic import is an await like any other
    deviceState = createState({
      url: profiles.personStateURL(personId2, DEVICE_KEY),
      user,
      cacheKey: `person:${user}:${personId2}:${DEVICE_KEY}`,
      push,
    });
    await deviceState.load().catch(() => {});      // offline: the shipped default is an empty list
    if (torn) { try { deviceState.destroy?.(); } catch { /* already gone */ } deviceState = null; return; }
    deviceState.startPolling?.();
  }
  // SUBTITLES, built BEFORE the output bus (0636797's list, step 1) because the bus's speech channel is
  // handed to it to tap: what the screen says is written as it is said, and nothing muted is written.
  // A mode, OFF until the person's row turns it on (`update`); off, it keeps nothing. The board's words
  // are the person this screen is for talking, so they are labelled with that person's name.
  try {
    subtitles = createSubtitles(kioskEl, {
      boardSpeaker: () => {
        try { return whoState && whoState.name ? { name: whoState.name } : null; } catch { return null; }
      },
    });
  } catch (err) { console.error('kiosk: subtitles', err); subtitles = null; }
  try {
    // NO `mount`, SO NO SCREEN CHANNEL - deliberately. A banner adapter rendering into the
    // kiosk root has never been tried on this surface and could land on top of her photos.
    // `say` routes to speech anyway (DEFAULT_ROUTING), and anything routed to `screen` is
    // reported as `no-adapter` rather than vanishing, which is the honest failure. Add it
    // when there is a designated place for a banner and a test that it does not cover
    // anything.
    //
    // *** THE MAILBOX, WIRED (2026-08-31). *** Without an `events` handle `defaultChannels`
    // builds no `remote` channel at all, so `output.notify` on this surface had nowhere to go
    // beyond the room it was already in — which is the wrong answer for the one message this
    // screen actually sends: "the screen has been paused for a while", six hours after
    // somebody paused it. That is addressed to a person who is not here.
    //
    // The stream is the account's own mailbox, not the profile's: it is how a person's OTHER
    // DEVICES hear from this one, and which screen was open when the message was written is
    // beside the point.
    //
    // *** SENDING ONLY. THE RECEIVER IS NOT WIRED, AND THAT IS A DECISION RATHER THAN AN
    // OVERSIGHT. *** `createRemoteReceiver` would let any of the account's devices put text
    // and speech onto THIS screen — which for a bedside screen somebody sits in front of ~24/7
    // is a different feature with its own consent question, not a symmetrical half of this
    // one. The sending half carries no such question: it puts a message in the account's own
    // mailbox and nothing about this room changes.
    output = createOutputBus({
      bus,
      channels: defaultChannels({
        audio,
        // WIRED TO `push`, 2026-09-17 — the legacy /api/user-events alias's POST handler
        // (append_user_event) now calls `_push.publish` too, the same self-referential-path
        // pattern the per-profile events endpoint already used. Until this, this mailbox
        // channel was one of the few state/events handles still stuck on the raw poll
        // interval regardless of whether push was up elsewhere on the same screen — found
        // while answering Mike's "does this scale to other users" question about the
        // Neon-quota polling default.
        events: createEvents({ url: `/api/user-events/${REMOTE_STREAM}`, user, push }),
        captions: subtitles,
      }),
    });
  } catch (err) {
    // A screen that cannot speak is still a screen. Modules treat `output` as optional.
    console.error('kiosk: no output bus', err);
  }

  // AMPLIFY (row 2.42): built once, inert until the person's row turns it on. On its own mixer channel
  // under the master; its source is this screen's microphone (through the arbiter) or a phone joined
  // as a microphone. It says why when its howl guard turns it off (through `output`).
  try {
    amplifier = createAmplifier({ audio, micOwner, output, phoneStream: () => phoneRx?.stream?.() || null });
  } catch (err) { console.error('kiosk: amplify', err); amplifier = null; }

  const ck = (key) => `${user}:${profileId}:${key}`;   // resilience cache key per handle

  const stateFor = (key, opts = {}) => (makeState
    ? makeState(key, opts, profileId)
    : createState({ url: profiles.stateURL(profileId, key), user, cacheKey: ck(key), push, ...opts }));
  const eventsFor = (key, opts = {}) => (makeEvents
    ? makeEvents(key, opts, profileId)
    : createEvents({ url: profiles.eventsURL(profileId, key), user, push, ...opts }));

  const childCtx = (mod) => ({
    bus, user, profileId,
    // WHOSE SCREEN THIS IS. Resolved in the background below, so it is a FUNCTION rather
    // than a value - a module mounted before the lookup returns would otherwise capture
    // null forever. Bindings have been per-person since the input runtime landed; this is
    // media catching up to the same idea.
    get personId() { return personId; },
    rootBus: bus, instanceId: mod.id,
    // *** THE OUTPUT BUS, WHICH THE KIOSK DID NOT HAVE. *** Exactly the gap input_runtime.js
    // closed on the other side: the whole output layer was constructed inside the Output TAB,
    // so "how you want to be told things" was configurable where a clinician sets up and
    // silent where the person actually lives. A module that wants to SAY something had
    // nowhere to say it.
    //
    // A getter for the same reason personId is: it is built lazily below, and a module
    // mounted first would otherwise capture undefined forever.
    get output() { return output; },
    // *** THE CALL TRANSPORT — the reason the Call panel could never ring. ***
    //
    // `modules/call.js` has always read `ctx.callTransport` and nothing ever supplied one,
    // so the panel mounted, showed its idle state and waited forever. It is built LAZILY
    // from the drive socket, because that socket is opened during the async person lookup
    // below and a module mounted before it resolved would otherwise capture null for good —
    // the same reason `personId` and `output` are getters.
    //
    // ONE SOCKET, NOT TWO. Signalling rides the connection this screen already has: it is
    // already authenticated, it already knows which two devices belong to one person, and
    // it already reconnects on facility wifi. A second socket would be a second thing to
    // get all three of those right.
    get callTransport() {
      if (!callTransport && drive) {
        callTransport = createCallTransport({
          link: drive,
          role: 'screen',              // a bedside screen answers; it never places a call
          // ICE comes from the person's own settings when they have any, and falls back to
          // public STUN. NO TURN RELAY IS CONFIGURED and there is no UI to add one yet —
          // so a call works wherever a direct path exists and fails honestly where it does
          // not. See call_transport.js for why that is the right default rather than a gap.
          config: (settings.get() || {}).call || {},
          onLog: (...a) => console.debug('call:', ...a),
        });
      }
      return callTransport;
    },
    // The arbiter itself, for a module that MAKES continuous sound - a music bed, a video.
    // A module that only speaks wants `output`; this is for the things that keep playing.
    audio,
    micOwner,
    // WHERE SOMEBODY IS POINTING, for a module that wants a position rather than a verb -
    // `comet.js` is the reason it exists. A getter for the same reason `output` is: the input
    // runtime is built further down, and a module mounted before it would capture undefined
    // forever. Modules read the aim off the BUS; this handle is only for `latest()`, so a
    // panel mounted mid-session can start under her hand instead of blank.
    get aim() { return runtime?.aim || null; },
    cameraOwner,
    ...(sources ? { sources } : {}),
    makeState: (key, opts) => stateFor(key, opts),
    makeEvents: (key, opts) => eventsFor(key, opts),
    // PER-PERSON state, distinct from `makeState`'s per-profile/instance scope (see
    // `profile.js`'s `stateURL` vs `personStateURL`). For a module that needs to read/write
    // something that must follow the PERSON across screens - e.g. a device module reading
    // their real input-bindings record - not something scoped to this one placement.
    // SAME SIGNATURE AS EVERY OTHER `makePersonState` IN THIS CODEBASE - `(personId, key,
    // opts)`, personId first, not curried (see `local_store.js`'s backend version and
    // `home.js`'s own comment on the convention; `module_try.js`'s `createTryHost` already
    // wires its host's version straight through unchanged). A caller reads `ctx.personId`
    // itself (a getter, resolves in the background like `output`/`aim` already do) and
    // passes it in - this function does not chase the resolution itself, so its contract
    // is identical whether the caller already has a personId or is still waiting on one.
    // Returns `null` (a real, handleable answer, not an error) if personId is falsy or this
    // deploy has no person-state endpoint.
    makePersonState: (pid, key, opts = {}) => {
      if (!pid || !profiles.personStateURL) return null;
      return createState({
        url: profiles.personStateURL(pid, key), user,
        cacheKey: `person:${user}:${pid}:${key}`, push, ...opts,
      });
    },
  });

  async function mountInstance(mod, host) {
    const state = stateFor(mod.id);
    const events = eventsFor(mod.id);
    // `extendCtx`, NOT `{ ..., ...childCtx(mod) }`: a spread reads every getter on `childCtx` once and
    // hands the module the value it had at this instant, which is exactly what the getters exist to
    // avoid (a call panel mounted before the drive socket kept a null transport for good). 2026-09-30.
    const instance = mountModule(mod.type, extendCtx(childCtx(mod), { mount: host, state, events }));
    await state.load().catch(() => {});
    await events.load().catch(() => {});
    // THIS PANEL'S OWN `panelSurface`, read off the SAME state row the module's own settings
    // live in, under a key no module declares — the module never sees this subscription, only
    // the host does. `state.subscribe` fires immediately (state is already loaded above) and
    // again on every later change, so a pick made through the menu reaches this exact `.k-mod`
    // the same tick the screen-wide setting reaches every panel that has NOT overridden it.
    // Anything other than an explicit solid/veil/clear — including 'default', or simply never
    // having been set — clears the attribute rather than writing 'default' into the DOM, so the
    // lower-specificity screen-level rule (kiosk.css) is what applies.
    state.subscribe((s) => {
      const v = s && s.instancePanelSurface;
      if (v === 'solid' || v === 'veil' || v === 'clear') host.dataset.panelSurface = v;
      else delete host.dataset.panelSurface;
    });
    instance.init();
    state.startPolling(); events.startPolling();
    return { instance, state, events, type: mod.type, id: mod.id, title: instance.manifest.title, el: host };
  }
  function destroyRec(rec) {
    if (!rec) return;
    try { rec.instance.destroy(); } catch { /* noop */ }
    rec.state.destroy?.(); rec.events.destroy?.();
  }

  // ---- per-profile settings: theme + the kiosk LAYOUT (data-driven) --------
  const settings = stateFor('settings');
  // ---- THE ARRANGEMENT: what is on this screen, and where (step 6 of the port, Stage 1) ------
  //
  // Resolving and partitioning the layout, the HUD overlays, the slots and the one-at-a-time stage,
  // focus and the unplaced swap, the rebuild a screen swap runs, `showModule`, recovery's hands, the
  // mirror/clock corners and the screen's links live in `arrangement.js` now -- moved verbatim, so
  // their long comments (and their history) went with them. This file keeps the shell. Built HERE,
  // before the first `settings.subscribe` below, because `applyLayout` runs from it; building it does
  // nothing else (no awaits, no mounts, no DOM). What it needs that the shell builds LATER is handed
  // over as a getter -- the input runtime, the health watch, the screen id a swap changes -- the same
  // reason `childCtx` uses getters. (`health` is a `const` further down: its getter is only called by
  // `swapPanel`, which only recovery calls, long after it exists.)
  const ownArr = createArrangement({
    bus, user, storage, embedded, settings,
    kioskEl, stageEl, mirrorEl, clockEl, ambientEl,
    mountInstance, destroyRec, watchRec, renderMods,
    runtime: () => runtime,
    health: () => health,
    profileId: () => profileId,
  });
  // *** WHICH ARRANGEMENT THE SHELL IS READING (step 6 Stage 3). *** Normally this file's own. With
  // `dashboardModule` on (embedded only), the panels are mounted by a dashboard MODULE, and the bar,
  // the menu, focus and recovery's hands must all be about ITS panels -- so every read below goes
  // through `arr`, which forwards to the dashboard's arrangement once it exists and to this file's own
  // otherwise. Same functions (arrangement.js) either way: nothing is reshaped between the two.
  // The mirror/clock corner functions are NOT forwarded: they are screen settings applied to `.kiosk`,
  // and the dashboard applies the same settings doc to its own root itself.
  let dash = null;                         // the mounted dashboard module, when there is one
  let dashHost = null;                     // ...and the element it is mounted into
  const arrNow = () => dash?.impl?.arrangement?.() || ownArr;
  const OWN_ONLY = new Set(['applyLayout', 'patchMirror', 'cycleMirrorSize', 'cycleMirrorCorner']);
  const arr = {};
  for (const k of Object.keys(ownArr)) {
    if (typeof ownArr[k] === 'function') {
      arr[k] = OWN_ONLY.has(k) ? ownArr[k] : (...a) => arrNow()[k](...a);
    } else {
      Object.defineProperty(arr, k, { enumerable: true, get: () => arrNow()[k] });
    }
  }
  // Its functions, under the names this file always called them by, so the shell reads as it did.
  // Its STATE is not destructured: a swap replaces it, so it is read through `arr.layout()`,
  // `arr.stageRec()` and the rest, every time.
  const {
    applyLayout, patchMirror, cycleMirrorSize, cycleMirrorCorner,
    focusedRec, focusPlaced, showUnplaced, showPrimary, paintFocus, mountLayout, applyModules,
    showModule, focusRing, instanceTitle, remountPanel, swapPanel,
  } = arr;
  // Declared here, ahead of `settings.subscribe` below, rather than down with the rest of the
  // burn-in code. `subscribe` calls its callback IMMEDIATELY if settings are already loaded
  // (state.js's `subscribe`: `if (loaded) fn(snapshot())`), and `settings.load()` a few lines
  // down is awaited before that subscribe call — so on every real boot the callback runs
  // synchronously, inside this same tick, long before execution would otherwise reach the
  // `let burnInT` that used to sit next to `armBurnIn`/`clearBurnIn`. A `let` is not
  // initialized until its own line runs, so `pokeBurnIn()` → `clearBurnIn()` →
  // `clearTimeout(burnInT)` hit `burnInT` in its temporal dead zone and threw
  // "Cannot access 'burnInT' before initialization" on every load, live included — a comment
  // beside the subscribe call argued this callback "only ever runs later", which is true for a
  // setting a person actually changes but not for the immediate replay `subscribe` performs.
  let burnInT = null;
  // *** PANEL BACKGROUNDS, HOST-LEVEL. *** Mike, 2026-09-23, looking at the live kiosk: "I would
  // make the backgrounds transparent/translucent wherever possible. Like the clock and trivia."
  // Every panel in the grid gets its background from ONE rule (`.k-stage .k-mod`, kiosk.css) --
  // no module sets its own, checked by grep before writing this -- so this is a HOST setting,
  // not something asked of each module (the live-themes README's own rule: "a thing written per
  // module gets written three times and drifts"). `veil`/`clear` reuse `--board-veil`/
  // `--board-halo`, the SAME tokens board.js's own veil/clear mode already uses and Design has
  // already calibrated per theme -- both are the same question ("what does a translucent
  // surface look like over this theme's moving scene"), so this answers it once rather than
  // asking Design to calibrate a second, panel-specific color per theme. `solid` (today's only
  // behaviour) stays the default -- nobody's screen changes until they pick this.
  const PANEL_SURFACES = ['solid', 'veil', 'clear'];
  function applyPanelSurface(s) {
    const v = s && s.panelSurface;
    kioskEl.dataset.panelSurface = PANEL_SURFACES.includes(v) ? v : 'solid';
  }
  await settings.load().catch(() => {});
  // THE MASTER AND THE MIXER, on the screen's settings row. Attached before the first theme is applied
  // so the scene reaches the mixer, and before the subscribe below so its first replay syncs them.
  // Each is guarded: a sound control that throws must never stop the screen coming up.
  const readScreen = () => settings.get() || {};
  const writeScreen = (patch) => settings.set(patch);
  try { master = attachMasterVolume({ bus, audio, read: readScreen, write: writeScreen }); }
  catch (err) { console.error('kiosk: master volume', err); master = null; }
  try { mixer = attachMixer({ audio, fx: fxLazy, read: readScreen, write: writeScreen }); }
  catch (err) { console.error('kiosk: mixer', err); mixer = null; }
  applyKioskTheme(settings.get().theme);
  applyLayout(settings.get());
  applyPanelSurface(settings.get());
  // The listening cue starts on its defaults (the visual cue on, the tone off, duck): the person's own
  // row replaces them once whoever this screen is for has been resolved (below).
  attachListen({});
  settings.subscribe((s) => {
    applyKioskTheme(s.theme);
    applyLayout(s);
    applyPanelSurface(s);
    // A volume or a mix changed from the menu, or from another device, is heard now.
    try { master?.sync(); } catch (err) { console.error('kiosk: master volume', err); }
    try { mixer?.sync(); } catch (err) { console.error('kiosk: mixer', err); }
    // A change made through the menu (turning burn-in protection on, off, or switching mode)
    // takes effect immediately — re-arming rather than waiting for the next activity event,
    // so switching it off actually clears an already-dimmed/drifting screen right away.
    // `pokeBurnIn` is a function DECLARATION defined further down in this same scope, hoisted
    // above this subscribe call — safe to reference here because this callback only ever RUNS
    // later, once a setting actually changes, by which point it exists.
    pokeBurnIn();
  });
  settings.startPolling();

  // A LAYOUT, if the composer saved one. It wins for whatever it places: a module sitting
  // in a slot is rendered there, so camera/clock only fall back to being HUD overlays when
  // they were NOT placed. With no layout, everything below behaves exactly as it did
  // before this existed — every screen made before the composer keeps working.
  // A PREVIEW layout, if the composer sent one. It is a ONE-SHOT handoff in sessionStorage:
  // read once, cleared immediately, never written to the profile. This is what lets someone
  // try an arrangement — or swap to one temporarily — without committing it, which the
  // composer's save-then-open behavior otherwise took away.
  const previewLayout = embedded ? null : takePreviewLayout(profileId);

  // An embed shows ONE panel on the stage, never the screen's saved arrangement: a grid with the
  // picked module in one cell of it is not "the module, large".
  const savedLayout = previewLayout
    || (embedded ? (embedLayout || null) : (settings.get().kiosk || {}).layout);

  // *** STALE-CACHE CORRECTION FOR THE ARRANGEMENT. ***
  //
  // `settings` can be LOCAL-FIRST (state.js's `load()`, when this handle carries a
  // `cacheKey` — true for every signed-in kiosk): it renders a CACHED snapshot instantly
  // and corrects against the server in the background via `notify()`. Every other setting
  // reacts to that correction (`applyLayout`, above, re-runs on every `subscribe` fire) —
  // the SLOT ARRANGEMENT never did, because `savedLayout` above is read exactly once,
  // before boot, and nothing downstream re-resolves it later.
  //
  // Reported live, signed in (2026-09-12): the composer showed one arrangement (AAC board /
  // Word Forge / Quests, Main + two) and the kiosk rendered a different one — and Word Forge
  // "did not respond" to a tap, because the slot a tap landed in and the slot the input
  // system thought that module lived in had quietly diverged. Both are the same bug: a
  // kiosk that boots from a stale cached layout goes on showing it forever, because nothing
  // ever told the stage to re-mount.
  //
  // Fixed the general way rather than patching the symptom: if the CORRECTED layout ever
  // differs from the one already mounted, the screen was already wrong the moment it
  // painted, and the one guaranteed-correct recovery — same one this file already uses
  // elsewhere for "the world changed under us" (a newly picked media folder) — is to reload.
  // Guarded to fire at most once, and skipped entirely for a one-shot PREVIEW layout, which
  // is deliberately never written back to the profile and has nothing server-side to
  // "correct" against.
  //
  // *** CAPTURED HERE, IMMEDIATELY AFTER `settings.startPolling()` — NOT AFTER THE
  // `profiles.get()` BELOW, EVEN THOUGH NEITHER `previewLayout` NOR `savedLayout` NEEDS
  // `profile`. *** Found 2026-09-15, once `push` made settings converge fast: with a real
  // await (`profiles.get(profileId)`) sitting between reading `savedLayout` and registering
  // this watch, a push notification landing in that gap — the composer's OWN save, whose
  // publish this same `settings` handle is now subscribed to — could get treated as "the
  // layout changed since boot" on a kiosk that had only ever seen ONE value, and reload
  // itself before it had finished booting. Closing the gap to zero awaits between the read
  // and the watch is the actual fix; a kiosk that boots after a genuine change still reloads
  // exactly as designed, because there is no longer a window for the watch to start late.
  // Not in an embed: it boots with NO layout on purpose (see `savedLayout`), so "the corrected layout
  // differs from the one I booted with" is true of every real screen that has one, and the reaction
  // is a rebuild, which boots with no layout, which differs again. That is a loop, and it was one.
  if (!previewLayout && !embedded) {
    // *** STAGE R (2026-09-30): A PLACEMENT-ONLY CHANGE IS APPLIED IN PLACE, NOT BY A RELOAD. ***
    // With free placement every saved drag, typed X or snap changes `layout.placed`, and this watch
    // would reload the screen under somebody's finger on every move. `layoutChange` (layout.js) says
    // which kind of change it is: 'placement' goes to the arrangement's `applyPlaced` (the moved module
    // moves; nothing is remounted, nothing reloads); anything else reloads exactly as before -- and so
    // does a placement change the arrangement refuses. 'none' is exactly the old signature equality.
    // (`bootLayoutSig` keeps its name: kiosk_test's 09-15 structural check anchors on it. The watch
    // now compares against a COPY of the boot value, advanced by each placement applied in place.)
    const bootLayoutSig = JSON.stringify(savedLayout || null);
    let mountedLayout = JSON.parse(bootLayoutSig);
    let reloadedForLayout = false;
    settings.subscribe((s) => {
      if (reloadedForLayout) return;
      const now = (s.kiosk || {}).layout || null;
      const change = layoutChange(mountedLayout, now);
      if (change === 'none') return;
      if (change === 'placement') {
        mountedLayout = now;
        Promise.resolve(arr.applyPlaced(now)).then((r) => {
          if (r && r.applied === false && !reloadedForLayout) { reloadedForLayout = true; reloadPage(); }
        }).catch((err) => console.error('kiosk: placement', err));
        return;
      }
      reloadedForLayout = true; reloadPage();
    });
  }

  // ---- partition modules: camera -> mirror, clock -> clock HUD, rest -> stage
  // cached so a server blip at boot still yields the last-known dashboard layout.
  // *** THE ARRANGEMENT HOLDS IT, AND A SWAP REPLACES IT IN PLACE (`arr.setProfile`). *** See `showScreen` below.
  // (An embed skips the cache, and it is not a nicety: `module_try.js` hands it a profile scoped to
  // ONE module, and that must never be written into `profile:<user>:<id>`, the last-known-good the
  // real kiosk falls back to when the server is down.)
  arr.setProfile((makeState || embedded)
    ? await profiles.get(profileId)        // local backend: it IS the source of truth
    : await cachedFetch(`profile:${user}:${profileId}`, () => profiles.get(profileId)));

  // This screen's links (port-order step 5): built and owned by the arrangement, with the reasoning
  // beside it in arrangement.js. The shell only syncs them once the modules exist, and unhooks them.
  const screenLinks = arr.screenLinks;

  // Resolve the saved arrangement against the modules that exist, repairing orphaned slots (G1-G3;
  // the whole story is beside `resolve` in arrangement.js).
  arr.resolve(savedLayout);

  if (previewLayout && arr.layout()) showPreviewBadge();

  arr.partition();

  // The HUD overlays -- the mirror, the corner clock, the ambient layer: mounted once, left running.
  // (`mountOverlay` in arrangement.js says why one that throws must leave no trace.)
  // (With a dashboard module, it mounts its own HUD, into its own hosts.)
  if (!useDashboard) await arr.mountOverlays();

  // The slots, the one-at-a-time stage and which panel the bar is about (`mountLayout`,
  // `showPrimary`, `focusedRec`, the unplaced swap, `paintFocus`) live in arrangement.js.

  // *** THE TRANSPORT BAR. *** Its chips -- which panels, which is lit, what pressing one does -- are
  // drawn by `transport_bar.js` (step 6 Stage 3b), the ONE implementation shared with the transport
  // bar a dashboard places; the comments on why each chip behaves as it does moved with that code.
  // This is the shell's own PLAIN bar drawing them.
  function renderMods() {
    // The panel button lives or dies with the same facts the bar is drawn from, so it is
    // refreshed here rather than at each of the four call sites that redraw the bar.
    try { syncPanelBtn?.(); } catch { /* declared later; harmless before first render */ }
    // What the bar lists is the arrangement's (arrangement.js); the bar itself is the shell's. Read
    // fresh on every draw, because a swap replaces all of it.
    drawChips(modsEl, barModel(arr, runtime));
  }

  // ---------------------------------------------------------------------------------
  // *** SWAPPING THE WHOLE SCREEN, IN PLACE. ***
  //
  // Mike, 2026-08-29: *"different people's call kiosks will be different. If someone uses an
  // AAC board, they'll need that to use for the call."* That is the argument that settles it -
  // a call screen is not one layout, it is a PERSON'S layout, and somebody who talks through a
  // board needs the board DURING the call. So the state machine has to be able to swap the
  // whole module set, not just what is on the stage.
  //
  // *** WHY IN PLACE AND NOT `navigate('kiosk.html?profile=…')`. *** That path already exists -
  // `restart.js` uses it - but it is a FULL PAGE LOAD: it destroys the audio bus, the camera
  // owner, the input runtime and the drive socket and rebuilds them. For a call that is seconds
  // of black at the worst possible moment, the camera released and re-opened for nothing, and
  // both arbiters made useless across the boundary. Here, only the modules change.
  //
  // WHAT DELIBERATELY DOES NOT CHANGE: input bindings (per PERSON, not per screen), the drive
  // socket, the health watch, the output and audio buses, the camera owner. A screen swap
  // changes what is shown - not who she is, nor what she can press.
  const offsScreen = [];
  let swapping = false;
  const screenStack = [];          // where to go back to

  /** Show another screen here, keeping everything that is not a module.
   *  `remember: false` on the return leg, so going back does not stack up forever. */
  async function showScreen(nextId, { remember = true } = {}) {
    if (!nextId || nextId === profileId || swapping) return null;
    // A dashboard module (Stage 3, embedded only) is not swapped in place: the swap that loads and
    // mounts the NEW dashboard before destroying the old is Stage 4's. An embed has no other screens
    // to go to (its `list()` is empty), so this refuses rather than half-swapping inside the module.
    if (useDashboard) return null;
    swapping = true;
    const from = profileId;
    try {
      const next = makeState
        ? await profiles.get(nextId)
        : await cachedFetch(`profile:${user}:${nextId}`, () => profiles.get(nextId));
      if (!next || !Array.isArray(next.modules)) throw new Error('that screen has no modules');
      if (remember) screenStack.push(from);
      profileId = nextId;
      arr.setProfile(next);
      // The incoming screen's own arrangement. A PREVIEW layout is a one-shot for the screen
      // it was handed to and must never follow a swap.
      //
      // Read from the INCOMING screen's settings doc. `settings` (above) is the handle opened for the
      // screen this kiosk BOOTED on and is never re-pointed, so reading it here applied the OLD
      // screen's slot ids to the NEW screen's modules -- none matched, every slot was orphaned, and
      // the panels fell back to module order instead of the arrangement somebody had made. (Reported
      // by the calculator-port agent 2026-09-28 and reproduced in kiosk_test before this fix.)
      // `stateFor` reads `profileId` when it is CALLED, and it has just been set to `nextId`.
      // Everything else on the boot handle -- theme, the panel fields in the menu -- deliberately stays
      // as it was: only the arrangement is documented as belonging to the incoming screen.
      const incoming = stateFor('settings');
      let sl;
      try { await incoming.load(); sl = (incoming.get().kiosk || {}).layout; }
      catch { sl = undefined; }      // unreadable: no arrangement, not the previous screen's
      finally { try { incoming.destroy(); } catch { /* already gone */ } }
      arr.resolve(sl);
      await applyModules();
      bus.publish(SCREEN_SHOWN, { profileId: nextId, from });
      return nextId;
    } catch (err) {
      // *** A FAILED SWAP MUST LEAVE HER LOOKING AT SOMETHING. *** Put the id back and leave
      // what is already mounted alone: "the call did not open" is recoverable, a blank screen
      // in a room she cannot leave is not.
      console.error('kiosk: could not show screen', nextId, err);
      profileId = from;
      if (remember) screenStack.pop();
      return null;
    } finally {
      swapping = false;
    }
  }

  /** Back to whatever was showing before the last swap. */
  async function showPreviousScreen() {
    const back = screenStack.pop();
    if (!back) return null;
    return showScreen(back, { remember: false });
  }

  // *** THE STATE MACHINE'S HANDLE ON THIS. *** It needs no new engine primitive: a state's
  // `enter` already publishes a topic with a payload, so `{publish: 'kiosk/show', payload:
  // '<screen id>'}` IS the verb. And that composes with `$back` for free - returning to the
  // previous STATE re-runs its enter, which re-publishes its screen.
  //
  // NOT ON THE DRIVE ALLOWLIST, and that is deliberate: `drive.py` carries a fixed list of
  // verbs a remote party may send, and "replace what is on this screen" is not something a
  // person on the other end of a socket should be able to do unasked.
  offsScreen.push(bus.subscribe(SCREEN_SHOW, (payload) => {
    const id = typeof payload === 'string' ? payload : payload?.profileId;
    showScreen(id).catch(() => {});
  }));
  offsScreen.push(bus.subscribe(SCREEN_BACK, () => { showPreviousScreen().catch(() => {}); }));

  // "next" within the current stage module — the director advances via segment/done,
  // everything else via <type>/next. Only the visible module is mounted, so this
  // never nudges a hidden one.
  // *** `Next` ADVANCES THE PANEL THAT HAS FOCUS. IT USED TO ADVANCE THE FIRST ONE. ***
  //
  // On a laid-out screen this read `slotRecs[0]` — so with focus on the third panel, pressing
  // Next skipped the FIRST panel's photo. The button and the ring described different screens,
  // which is the one thing `paintFocus` exists to prevent.
  function nextInPrimary() {
    const rec = arr.layout() ? focusedRec() : arr.stageRec();
    if (!rec) return;
    if (rec.type === 'director') bus.publish('segment/done', { reason: 'skipped' });
    else bus.publish(`${rec.type}/next`);
  }

  // *** BACK: THE REVERSE OF `Next`, AND UNTIL NOW THERE WAS NO WAY TO GO BACKWARD AT ALL. ***
  //
  // `nextInPrimary` advances the CONTENT of the focused panel — the next photo, the next
  // video, the next question. Overshoot one and the only way back was cycling all the way
  // round through `next` again, which for someone pressing a single switch is a real cost
  // and not a shrug.
  //
  // Mirrors `nextInPrimary` exactly, on the same `rec`, the same `<type>/…` topic convention.
  // NOTHING NEW HAD TO BE BUILT for it to work: `MODULE_VERBS` in actions.js already lists a
  // `prev` target for `photos`, `personal`, `educational`, `youtube`, `wordforge`, `trivia`
  // and `interstitials` — because the keyboard's ArrowUp (`verb/prev`) has driven exactly
  // this the whole time, through the router. Those modules already answer `<type>/prev`; the
  // transport bar simply never asked them to.
  //
  // THE DIRECTOR IS THE ONE DELIBERATE GAP, same as it is for `nextInPrimary`'s special case.
  // It is a WEIGHTED-PICK state machine (see director.js), not a fixed sequence, so there is
  // no segment "before" the current one to return to — only ones that might get picked again.
  // `nextInPrimary` special-cases it to `segment/done` (a forward skip, with no backward
  // counterpart); this leaves it alone rather than publishing a topic nothing on the other
  // end can honor. A press that does nothing is the exact failure `respondsToVerbs` exists to
  // prevent elsewhere in the product — the way to honor that here, without touching
  // director.js, is to not make the press at all.
  function prevInPrimary() {
    const rec = arr.layout() ? focusedRec() : arr.stageRec();
    if (!rec || rec.type === 'director') return;
    bus.publish(`${rec.type}/prev`);
  }

  // *** MOVING BETWEEN PANELS, WHICH NOTHING COULD DO. ***
  //
  // G9, Mike: *"Next does not move between them."* It does not, and it should not — Next
  // advances the CONTENT of a panel, which is what somebody wants from it on a photo frame.
  // Two meanings need two controls.
  //
  // What was actually missing is that `router.focusNext()` existed and NOTHING in the product
  // called it: no key, no button. On an arranged screen the only way to change which panel a
  // switch acts on was to click its name on the bar with a mouse — and the person this is built
  // for has no mouse. This is that control.
  //
  // Only on an arranged screen. Without a layout there is one panel on the stage, `Next` moves
  // between the modules already, and a second button would be two names for one thing.
  function panelNext() {
    if (!arr.layout()) return;
    try { runtime?.router?.focusNext?.(); } catch { /* focus is not load-bearing */ }
    const id = focusedRec()?.id;
    if (id) paintFocus(id);
    renderMods();
  }

  // MIRROR MODE (C): make the camera fill the whole screen (the mirror element
  // expands over the stage; press again to return). The camera stream stays mounted.
  let mirrorFull = false;
  function toggleMirrorFull() {
    if (!arr.cameraRec()) return;
    mirrorFull = !mirrorFull;
    kioskEl.classList.toggle('mirror-full', mirrorFull);
    try { arr.cameraRec().instance.onResize?.(); } catch { /* noop */ }
  }
  function toggleFs() {
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }

  // A way OUT. The browser back button was the only route home, which is fine for a
  // paired bedside screen that never leaves the kiosk and wrong for everyone else.
  // It lives in the auto-hiding chrome, so an unattended screen still shows nothing.
  /**
   * *** G11: PRESSING `Screens` USED TO LEAVE FULL SCREEN, AND IT COULD NOT NOT. ***
   *
   * Mike, off the live site: *"Pressing Screens from the transport bar drops out of full screen
   * back into the browser window. If the site is itself a module, navigating home should not
   * unseat you."*
   *
   * He is right, and it was not fixable where it was: this was `location.href = '/home.html'`,
   * and **every browser exits full screen on a navigation, by design** — a page may not inherit
   * full screen from another one, and the new page cannot re-enter without its own user
   * gesture. There is no flag for it. The only fix is not to navigate.
   *
   * And there was no need to. `showScreen` already swaps the whole module set IN PLACE, for
   * exactly this reason — `restart.js`'s own note says a full page load *"destroys the audio
   * bus, the camera owner, the input runtime and the drive socket and rebuilds them"*, which
   * for a call is seconds of black at the worst moment. Choosing a screen goes through that
   * path now, so full screen, the arbiters and the socket all survive it.
   *
   * *** IT IS A STRIP, NOT A SCRIM, AND THAT IS THE SAFETY ARGUMENT. *** The invariant in
   * CLAUDE.md is that a screen must never enter a state only an input can leave when the person
   * in front of it cannot give that input. A modal over her photographs would be exactly that.
   * This sits above the control bar; the panels keep playing, stay visible, and are still being
   * driven. Nobody answering it costs nothing but a row of buttons on screen — and it closes
   * with the control bar's own auto-hide, with Escape, and by pressing Screens again.
   *
   * LEAVING is still possible and still leaves full screen, which is correct: the last row goes
   * to the composer, and going to another page is going to another page.
   */
  const screensEl = root.querySelector('[data-screens]');
  const goHome = () => { location.href = '/home.html'; };
  let screensOpen = false;

  async function drawScreens() {
    let list = [];
    try { list = (await profiles.list()) || []; } catch (err) {
      console.error('kiosk: could not list screens', err);
    }
    screensEl.innerHTML = '';
    if (!list.length) {
      // Offline, signed out, or a demo kiosk with no account. Saying so beats an empty box,
      // and the way out is still on the row below.
      const p = document.createElement('div');
      p.className = 'k-scr-note';
      p.textContent = 'No other screens to show from here.';
      screensEl.append(p);
    }
    for (const s2 of list) {
      const b = document.createElement('button');
      b.className = 'k-scr' + (s2.id === profileId ? ' on' : '');
      b.textContent = s2.name || 'Screen';
      b.disabled = s2.id === profileId;
      b.addEventListener('click', async () => {
        toggleScreens(false);
        await showScreen(s2.id);
      });
      screensEl.append(b);
    }
    const setup = document.createElement('button');
    setup.className = 'k-scr k-scr-out';
    setup.textContent = 'Set up screens ↗';
    setup.title = 'opens the composer — this does leave full screen, because it leaves the screen';
    setup.addEventListener('click', goHome);
    screensEl.append(setup);
  }

  function toggleScreens(want) {
    screensOpen = want === undefined ? !screensOpen : !!want;
    screensEl.hidden = !screensOpen;
    if (screensOpen) drawScreens();
  }

  controlsEl.querySelector('[data-act="home"]').addEventListener('click', () => toggleScreens());
  controlsEl.querySelector('[data-act="back"]').addEventListener('click', prevInPrimary);
  controlsEl.querySelector('[data-act="next"]').addEventListener('click', nextInPrimary);
  const panelBtn = controlsEl.querySelector('[data-act="panel"]');
  panelBtn.addEventListener('click', panelNext);
  // Shown for a laid-out screen only, and only when there is more than one panel to move
  // between — a button that cycles a set of one is a press somebody spends finding that out.
  function syncPanelBtn() {
    const n = (runtime?.router?.reachable?.() || []).length;
    panelBtn.hidden = !arr.layout() || n < 2;
  }
  controlsEl.querySelector('[data-act="mirror"]').addEventListener('click', toggleMirrorFull);

  // *** THE HUSH BUTTON. *** Cici has had one; this is its twin.
  //
  // IT IS A TOGGLE THAT SAYS WHAT IT IS DOING, and that matters more than it sounds: silence
  // with no visible cause reads as "the screen broke", and somebody who did not press it -
  // an aide arriving mid-shift - has to be able to see why there is no sound and undo it.
  // So the label changes and the button stays lit while it is on.
  const hushBtn = controlsEl.querySelector('[data-act="hush"]');
  function renderHush() {
    const on = !!audio?.isHushed?.();
    hushBtn.dataset.on = on ? '1' : '0';
    hushBtn.textContent = on ? 'Sound off' : 'Hush';
    hushBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    hushBtn.title = on
      ? 'the music and video are paused — press to bring them back'
      : 'pause the music and video so you can talk (voices and speech are still heard)';
    // A placed transport bar shows the same state (Stage 3b): told, whichever bar was pressed.
    if (useDashboard) bus.publish(SHELL_STATE, { hushed: on });
  }
  hushBtn.addEventListener('click', () => { audio?.hush?.(!audio.isHushed()); renderHush(); });
  renderHush();
  controlsEl.querySelector('[data-act="fs"]').addEventListener('click', toggleFs);

  // *** NIMROD, ON THE BAR (row 2.37, 2026-09-30). *** Press him and the cat explains whatever is
  // picked: the menu's cursor row when the menu is open, else the focused panel, else the screen. ONE
  // cat for the screen (`mountBarHelp`, transport_bar.js): the plain bar calls it, a placed bar says
  // SHELL_HELP and this answers. With "Cat help" off there is no button at all -- re-read whenever the
  // bar is brought up, since the setting lives with the cat's other preferences on this device.
  const barHelp = mountBarHelp(kioskEl, { output: () => output, storage, focused: () => focusedRec() });
  const helpBtn = drawHelpButton(controlsEl.querySelector('.k-actions'), {
    before: controlsEl.querySelector('[data-act="settings"]'),
    onPress: () => { explainHelp(); },
  });
  let helpShown = null;
  function syncHelp() {
    const on = helpOn(storage);
    if (helpBtn) helpBtn.hidden = !on;
    if (on === helpShown) return;
    helpShown = on;
    if (useDashboard) bus.publish(SHELL_STATE, { help: on });
  }
  function explainHelp() {
    if (torn) return null;
    const said = barHelp.explain();
    if (!said) syncHelp();           // turned off since the bar was drawn: the button goes
    return said;
  }
  syncHelp();

  // ---- the universal settings menu ----------------------------------------
  //
  // The menu is driven by the INPUT BUS below, so opening it is a bindable verb and works
  // from a switch, not only a keyboard. The shell's imperative moves are what the bus calls
  // into, and remain the fallback for any surface that has no bus.
  //
  // The person's NAME is resolved in the background and never blocks the boot: a screen
  // that will not come up because a name lookup failed is strictly worse than a screen
  // that says "…" where a name goes.
  //
  // (`whoName` used to live here and was replaced by `whoState` below, which carries the
  // same name AND the difference between "still looking" and "nobody" — the difference that
  // made an empty header permanent.)
  // Escaping for the one page in this file that builds markup from account data. A person's
  // name is typed by a human and goes straight into innerHTML.
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // COMPLEXITY LEVEL — essential / standard / advanced. It lives in the profile settings blob
  // for now, which is the `screen` level of the chain; when the chain arrives it becomes an
  // ordinary inherited setting like anything else, and Mike's point stands that a patient's
  // screen may run `essential` while the clinician's laptop runs `advanced` on one account.
  //
  // *** THERE IS A WAY TO SET IT NOW, AND THE ESCAPE SHIPPED IN THE SAME COMMIT. ***
  // This used to read "there is no way to set it from here yet, ON PURPOSE" — because a level
  // that hides settings can hide the setting that changes the level, and that door only locks
  // once somebody can close it. The condition was never "wait", it was "build the escape with
  // the switch, never after", and that is met: the row is in `SCREEN_FIELDS` declared at
  // `essential`, the most permissive level, so it renders at EVERY level including the one
  // that hides everything else. No setting of it can hide it. Home, Close and every other way
  // out remain unconditional in `settings.js` and this filter never sees them.
  const complexity = () => (settings.get() || {}).complexity || 'standard';
  // *** THE MENU IS ABOUT THE SAME PANEL THE BAR AND THE RING ARE ABOUT. ***
  //
  // These three read `focusedRec()` now. They used to read `layout ? null : stageRec`, which is
  // why a grid kiosk's settings menu showed NO PANEL SETTINGS AT ALL — and the comment where
  // the null was said so honestly: *"the kiosk has no focus concept yet, so there is no single
  // subject and the menu says so rather than guessing at one."* There is one now, so it does
  // not have to guess.
  //
  // That one change closes what four rows were waiting on: the bar could not name a panel (G4),
  // the menu could not show one's settings, a tab model had nothing to call "current" (F15),
  // and a remote had nothing to aim at (F16).
  const subjectName = () => { const r = focusedRec(); return r ? (r.title || r.type) : ''; };

  // ---- the two UNIVERSAL sections, which used to be a frame with nothing in it ----------
  //
  // Mike's screenshot of the live kiosk: "SETTING UP FOR …" with no name after it, and a
  // SCREEN heading whose only row was "Close menu". Both headings are built by `settings.js`;
  // what fills them can only come from here, because only the kiosk knows which screen it is
  // and where a screen's settings live.

  // WHO — three states, and the third is the one that was being told as the first.
  // `null` means the lookup has not finished; `false` means it finished and this screen has
  // never been handed to a person. Rendering both as "…" is what made a permanent answer look
  // like a permanent wait.
  let whoState = null;                 // null = looking · false = nobody · { name } = somebody
  let peopleList = null;               // the account's people, fetched once the menu asks
  // A LOCAL BACKEND HAS NO PEOPLE ENDPOINT (the dev harness, `makeState`). There is nothing to
  // pick from and no way to save a pick, so the row is not offered rather than offered and
  // broken.
  const canPickPerson = () => !!(profiles.people && profiles.moveToPerson);

  const SCREEN_FIELDS = () => [
    // COLOURS. Themes are already per-screen (`theme.js`, DECISIONS.md) and the kiosk already
    // applies one — there was simply no way to change it from the screen it applies to.
    // `essential`, because on a bedside screen this is a legibility control, not decoration:
    // it is the row somebody reaches for when the person in front of it cannot read what is
    // there.
    { key: 'theme', label: 'Colours', kind: 'choice', level: 'essential',
      default: DEFAULT_THEME,
      options: listThemes().map((t) => ({ value: t.id, label: t.label })) },
    // *** HOW MUCH THIS MENU SHOWS — the switch, and its escape, in the same commit. ***
    //
    // The comment above `complexity` said this had no control ON PURPOSE: "a level that hides
    // settings can hide the setting that changes the level, and that door only locks once
    // somebody can close it. The escape gets built in the same commit as the switch, never
    // after." That constraint is met here rather than waived — the field is declared at
    // `essential`, the most permissive level, so it shows at EVERY level including the one
    // that hides everything else. There is no setting of it that can hide it.
    { key: 'complexity', label: 'How much this menu shows', kind: 'choice', level: 'essential',
      default: 'standard',
      options: [
        { value: 'essential', label: 'Just the essentials' },
        { value: 'standard', label: 'The usual' },
        { value: 'advanced', label: 'Everything' },
      ] },
    // BURN-IN PROTECTION (MIKE_CHANGE_LIST.md 2.18), off by default. Always-on dashboards
    // burn in on OLED — most tablets and phones, not the LCD this has mostly been tested on,
    // which is exactly why it was invisible so far. `standard`, not `essential`: unlike theme
    // and complexity this is not a legibility or escape-hatch control, it is a preference, and
    // it should not crowd the row somebody reaches for on a screen they cannot read.
    //
    // Deliberately two options, not three. A third, content-HIDING screensaver was considered
    // and left out on purpose — hiding everything is a state only an input can leave, and
    // Christine cannot give one. `dim` and `drift` both keep every pixel of content on screen
    // the whole time, so neither is a gate anybody could get stuck behind. See the DECIDE row
    // for whether a hide mode is ever wanted, for a screen where someone genuinely can dismiss
    // it themselves.
    { key: 'burnIn', label: 'Screen burn-in protection', kind: 'choice', level: 'standard',
      default: 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'dim', label: 'Dim after 10 minutes idle' },
        { value: 'drift', label: 'Slowly shift the picture when idle' },
      ] },
    // Mike, 2026-09-23: "I would make the backgrounds transparent/translucent wherever
    // possible." `standard`, not `essential`, matching `burnIn` above -- a preference, not a
    // legibility escape hatch. `solid` default: see `applyPanelSurface`'s own comment on why
    // this changes nobody's screen until they pick it.
    { key: 'panelSurface', label: 'Panel backgrounds', kind: 'choice', level: 'standard',
      default: 'solid',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'veil', label: 'See-through' },
        { value: 'clear', label: 'Fully clear' },
      ] },
    // HOW LONG TO HOLD A SWITCH FOR THE PLAIN BAR (Stage 3b; only where there is a plain bar -- the
    // dashboard path). Design's 1.5 s, settable 1-3 s (Rule 1: a setting, not a constant). `essential`:
    // like the complexity row, it is part of the way OUT, and a way out that a level can hide is not one.
    ...(useDashboard ? [{ key: 'plainBarHoldMs', label: 'Hold a switch this long for the plain bar',
      kind: 'choice', level: 'essential', default: PLAIN_BAR_HOLD_DEFAULT_MS,
      options: [1000, 1500, 2000, 2500, 3000].map((ms) => ({ value: ms, label: `${ms / 1000} seconds` })) }] : []),
  ];

  // *** THE SCREEN'S SOUND (2026-09-30). *** The master as master_volume.js declares it (Volume is
  // `essential`: on a patient screen it is the one sound control), then the mixer. THE MIXER'S ROWS ARE
  // ALL SHOWN AT "EVERYTHING" (advanced) HERE, though mixer.js declares the faders `standard`. Argued:
  //   * FOR standard (mixer.js's reading): a caregiver who wants the game beeps quieter should not have
  //     to know a menu has levels.
  //   * AGAINST, and it wins for now: five faders on "The usual" is five more stops on a one-switch walk
  //     through the menu every time, for a control set once; the master is already there for "too loud";
  //     and the mix is new today, unheard on a real screen. Moving the faders back to `standard` is one
  //     line here once somebody has used them. On Mike's list.
  const SOUND_FIELDS = () => [
    ...MASTER_FIELDS,
    ...MIXER_FIELDS.map((f) => ({ ...f, level: 'advanced' })),
  ];

  // THE ROOM ON THIS SCREEN, if any: the focused panel when it is a room, else the first room mounted.
  // Only a MOUNTED room -- its reactions editor opens inside it, so a room that is not on the screen
  // has nowhere to open one.
  function roomRec() {
    const f = focusedRec();
    if (f?.type === 'room') return f;
    return [arr.stageRec(), ...(arr.slotRecs || []), ...(arr.placedRecs || [])].find((r) => r?.type === 'room') || null;
  }
  // "Room reactions…": the room's own editor (room_notify_editor.js), opened in THAT room -- addressed to
  // its instance (bus.js `instanceTopic`), so a screen with two rooms opens one. The menu closes first:
  // the editor is in the room, under where the menu was.
  function openRoomReactions() {
    const rec = roomRec();
    if (!rec) return;
    try { menu.close(); } catch { /* already closed */ }
    const topic = typeof bus.instanceTopic === 'function' ? bus.instanceTopic(rec.id, 'room/reactions') : 'room/reactions';
    bus.publish(topic, { from: 'menu' });
  }

  // *** THE SAME SETTING, ONE LEVEL MORE SPECIFIC. *** Mike, 2026-09-23, on the screen-wide
  // version above: "You should be able to change it at different levels like if you only want
  // it for certain modules." This is the instance level of the inheritance chain this file's
  // own `fields()` comment already names (instance, module, screen, device, person, account) —
  // Slice 2 there writes screen settings to the instance for the SAME reason this does: it is
  // the most specific level, so it is correct under any chain order that ever gets built.
  // `'default'` (inherit whatever the screen says) keeps a freshly placed panel unchanged from
  // today until somebody opens ITS OWN settings and picks something else — the per-instance row
  // never overrides anything silently. Written into the panel's own state row (the same one its
  // own declared settings live in) under this reserved key; a module never reads it and never
  // declares a field by this name, so there is nothing for it to collide with.
  // `instancePanelSurface`, not `panelSurface` -- `screenItems()` and `fields()` are combined
  // into ONE flat menu by the settings shell, so the two would collide on the SAME item id
  // (`set:panelSurface`) and the screen-level row would become unreachable. Different key,
  // same reserved-namespace idea: still nothing a module ever declares or reads.
  const PANEL_INSTANCE_FIELDS = () => [
    { key: 'instancePanelSurface', label: 'This panel’s background', kind: 'choice', level: 'standard',
      default: 'default',
      options: [
        { value: 'default', label: 'Use the screen setting' },
        { value: 'solid', label: 'Solid' },
        { value: 'veil', label: 'See-through' },
        { value: 'clear', label: 'Fully clear' },
      ] },
  ];

  // *** THE VOICE, IN THE MENU (2026-09-30, second wiring pass). *** The PERSON's settings, so they sit
  // under the who heading ("Setting up for ...") and write to that person's own row -- only when this
  // screen has one (a person, signed in, not an embed); a row that could save nowhere is not offered.
  //
  // THE ONE-SWITCH WALK, argued, because every row here is a stop on it:
  //   * "Just the essentials": NOTHING added. That level is the handful of rows that make a screen
  //     readable and get somebody out (colours, how much the menu shows, volume). These are set once,
  //     by whoever sets a person up, who can pick "The usual" for it. FOR putting Subtitles there: it
  //     is a legibility control, like Colours. It loses for now because it is also a mode that writes
  //     down a room; on Mike's list.
  //   * "The usual": THREE stops while everything is off -- Spoken commands, Subtitles, Amplify. A
  //     mode's own rows appear only while that mode is on (and a row that tunes something else that is
  //     off -- the wait for a command with the two-step path off, the question's wording with "did you
  //     mean" off, how long misses are kept with the list off -- only while that is on). A row tuning a
  //     thing that is off is a stop that changes nothing anybody can see.
  //   * "Everything": the same rule, plus each file's own advanced rows (wake phrases, grammar mode...).
  const VOICE_DEPENDS = {
    speechWindowMs: (r) => speechOptionsFrom(r).twoStep,
    speechNearMissLine: (r) => speechOptionsFrom(r).nearMiss,
    speechNearMissWindowMs: (r) => speechOptionsFrom(r).nearMiss,
    speechMissKeepDays: (r) => r.speechMissLog === true,
  };
  function voiceStatusItem() {
    const r = personRow || {};
    const browser = speechSwitchFrom(r).engine === 'browser';
    const row = (label, hint) => ({ kind: 'item', id: 'voice-status', disabled: true, label, ...(hint ? { hint } : {}) });
    if (speechStatus === 'no-local') return row('Not listening: there is no recogniser on this screen yet', 'the room’s sound is not sent anywhere');
    if (speechStatus === 'no-browser') return row('Not listening: this browser has no recogniser of its own');
    if (speechStatus === 'listening') {
      return row(`Listening for “${speech?.wakePhrases?.()?.[0] || 'the wake phrase'}”`,
        browser ? 'the room’s sound goes to the browser’s maker' : '');
    }
    if (speechStatus === 'subtitles-only') return row('Writing down what is said (spoken commands are off)',
      browser ? 'the room’s sound goes to the browser’s maker' : '');
    return null;
  }
  function voiceItems() {
    if (!personInputs || !personRow || embedded) return [];
    const r = personInputs.get?.() || personRow || {};
    const sw = speechSwitchFrom(r);
    const subsOn = r.subtitlesOn === true;
    const ampOn = r.amplifyOn === true;
    const keep = (f) => !VOICE_DEPENDS[f.key] || VOICE_DEPENDS[f.key](r);
    const fields = [
      ...SPEECH_ON_FIELDS.filter((f) => f.key === 'speechOn'),
      ...(sw.on || subsOn ? SPEECH_ON_FIELDS.filter((f) => f.key !== 'speechOn') : []),
      ...(sw.on ? [...SPEECH_FIELDS, ...LISTENING_FIELDS, ...MISS_FIELDS].filter(keep) : []),
      ...SUBTITLES_FIELDS.filter((f) => f.key === 'subtitlesOn' || subsOn),
      ...AMPLIFY_FIELDS.filter((f) => f.key === 'amplifyOn' || ampOn),
    ];
    const items = fieldItems(fields.map(normalizeField).filter(Boolean), {
      values: () => personInputs?.get?.() || {},
      level: complexity(),
      onStep: (key, value) => { try { personInputs?.set?.({ [key]: value }); } catch (err) { console.error('kiosk: voice setting', err); } },
    });
    if (!items.length) return [];
    const status = voiceStatusItem();
    return [{ kind: 'heading', id: 'voice-head', label: 'Voice' }, ...(status ? [status] : []), ...items];
  }

  // `:scope >` is not decoration. The camera module draws its OWN hidden `[data-settings]` inline
  // panel inside the mirror overlay, which comes EARLIER in document order, so a bare
  // `querySelector('[data-settings]')` mounted this menu inside it: open, but hidden by its
  // ancestor and 0x0 wide, on every screen that has a camera.
  const menu = mountSettings(kioskEl.querySelector(':scope > [data-settings]'), {
    person: () => whoState,
    // The row under the who heading. It says what is true and, where the account has people
    // to choose between, opens the picker. Then the person's Voice section (voiceItems, above).
    whoItems: () => [...((() => {
      if (!canPickPerson()) {
        // Nothing to pick from and nowhere to save it. Say which, rather than showing a
        // control that cannot do what it says — the rule `settings_fields.js` states for
        // fields, applied to a row that is not one.
        return whoState === false
          ? [{ kind: 'item', id: 'who-none', disabled: true,
               label: 'This screen is not linked to a person',
               hint: 'link it in Dashboards, on the home page' }]
          : [];
      }
      return [{
        kind: 'item', id: 'who-pick', page: 'who',
        label: whoState === false ? 'Choose who this screen is for' : 'Someone else is using this screen',
        hint: whoState === false
          ? 'nobody yet — their bindings and voice come with them'
          : `now: ${whoState?.name || '…'}`,
      }];
    })()), ...voiceItems()],
    // SCREEN-LEVEL SETTINGS. Written to the profile settings blob, which IS the screen level
    // of the inheritance chain — the same place the theme, the layout and the recovery policy
    // already live, so this adds a control over existing storage rather than a new home.
    screenItems: () => [
      ...(arr.profile()?.name ? [{ kind: 'item', id: 'screen-name', disabled: true,
          label: `This screen: ${arr.profile().name}`, hint: 'renamed in Dashboards, on the home page' }] : []),
      ...fieldItems(SCREEN_FIELDS().map(normalizeField).filter(Boolean), {
        values: () => settings.get() || {},
        // NOT filtered by `complexity()`. Both rows are declared `essential`, so passing the
        // active level would change nothing today — but passing `advanced` here would be the
        // quiet way the escape hatch stops being one the first time somebody adds a row.
        level: complexity(),
        onStep: (key, value) => {
          settings.set({ [key]: value });
          // A THEME PICKED HERE, BY SOMEBODY AT THIS SCREEN. Published after the set (which
          // applies the theme synchronously), so a listener sees the new theme already on screen.
          // It is how the AAC board knows it may offer its symbol-set choice card: a theme that
          // arrives from another device by polling never passes through here, so it never asks.
          // Topic: `THEME_PICKED_TOPIC` in modules/board.js (its suite checks this line).
          if (key === 'theme') bus.publish('screen/theme-picked', { theme: value });
        },
      }),
      // THE SCREEN'S SOUND: written to the same screen row, heard at once (the settings subscribe above
      // re-syncs the master and the mixer on every change).
      { kind: 'heading', id: 'sound-head', label: 'Sound' },
      ...fieldItems(SOUND_FIELDS().map(normalizeField).filter(Boolean), {
        values: () => settings.get() || {},
        level: complexity(),
        onStep: (key, value) => { settings.set({ [key]: value }); },
      }),
      // THE ROOM'S REACTIONS (rows 2.36/2.37): which object lights, rings or pulses for which event. Only
      // while a room is on the screen -- a row that opens nothing is a row that lies.
      ...(roomRec() ? [{ kind: 'item', id: 'room-reactions', label: 'Room reactions…',
          hint: 'what the room’s things do when something happens', run: () => openRoomReactions() }] : []),
      // *** AN AMBIENT MODULE'S OWN SETTINGS, FOUND MISSING ENTIRELY 2026-09-27. ***
      //
      // `mount:'ambient'` content is never `focusedRec()` — it has no stage slot, so it never
      // becomes "the focused panel" the way `fields()` below reaches a real module's own
      // settings. `ambient_drift.js` never surfaced this gap because it declares no settings at
      // all; `comet_ambient.js` was the first ambient module built WITH real ones (decorative/
      // interactive, how many, how fast, points), and shipped them with no way to actually reach
      // them from the menu at all — Mike asked "how do I add the overlays and ambient balloons"
      // and the honest answer, before this, was "you can add it, but you can never change how it
      // behaves." Screen-level, not focus-dependent, is the right home: an ambient module is a
      // property of the SCREEN'S background, the same category theme/burnIn/panelSurface already
      // live in, not of any one panel. Empty array (today's only OTHER ambient module,
      // `ambient_drift`, declares no settings) is a silent no-op, so this costs nothing when
      // there is nothing to show.
      ...(arr.ambientRec() ? fieldItems(fieldsFor(arr.ambientRec().instance.manifest, arr.ambientRec().instance), {
        values: () => arr.ambientRec().state.get() || {},
        level: complexity(),
        onStep: (key, value) => { arr.ambientRec().state.set({ [key]: value }); },
      }) : []),
    ],
    // In a laid-out screen every panel is visible at once and the kiosk has no focus
    // concept yet, so there is no single subject and the menu says so rather than
    // guessing at one.
    // mountInstance flattens the manifest: the record carries `title`, NOT `manifest`.
    // Reading `manifest.title` silently fell back to the raw type, so the menu said
    // "This panel — photos" instead of "Photos".
    subject: () => {
      const r = focusedRec();
      return r ? { type: r.type, title: r.title || r.type } : null;
    },
    fullscreenTarget: root,
    // The menu's own Home row opens the same picker rather than navigating, so there are not
    // two controls with the same name doing different things. Leaving is the picker's last row.
    onHome: () => { try { menu.close?.(); } catch { /* noop */ } toggleScreens(true); },
    // THE FOCUSED PANEL'S OWN SETTINGS, declared by the module and rendered by the shell.
    //
    // THE HOST DOES THE WRITING, and that is the whole seam. `settings_fields.js` computes
    // the next value and hands back `(key, value)`; where that value LIVES is a question only
    // this file can answer, because a setting has six possible homes (instance, module,
    // screen, device, person, account) that form an inheritance chain. Slice 2 writes to the
    // instance, which is the most specific level and therefore correct under any chain order
    // that ever gets built. The day the chain lands, this callback grows a destination —
    // nothing in the pure layer moves.
    //
    // In a laid-out screen every panel is visible at once and there is no single focused
    // subject, so there are no panel settings to show rather than a guess at whose.
    fields: () => {
      const rec = focusedRec();
      if (!rec) return [];
      // The instance-level override goes FIRST — "which panel is this" before "what does this
      // kind of panel let you change" — and through the same `fieldItems`/`onStep` call as the
      // module's own fields, so cycling, hints and disabling all work identically; it is only a
      // different SOURCE array, not a different mechanism.
      const items = fieldItems([
        ...PANEL_INSTANCE_FIELDS().map(normalizeField).filter(Boolean),
        ...fieldsFor(rec.instance.manifest, rec.instance),
      ], {
        // A FUNCTION, not a snapshot: two presses without a repaint in between would
        // otherwise step from the same stale value twice, and the second press would look
        // dropped — which somebody debugs as a broken switch.
        values: () => rec.state.get() || {},
        level: complexity(),
        onStep: (key, value) => { rec.state.set({ [key]: value }); },
      });
      // *** "MAKE YOUR OWN PACK WITH THE AI OF YOUR CHOICE" NEEDED A WAY BACK IN. ***
      // `games.html`'s course page already has the prompt; without this, the file it produces
      // had nowhere to go. A plain item with `page:` here, a matching entry in `pages` below —
      // same pattern this file already uses for `who`, not a new mechanism. Reachable from
      // whichever module actually reads a pack (Trivia, Word Forge) plus Quests, since a
      // pack's points feed the same economy — not from every module, which would be a row
      // that does nothing on a panel with no concept of a pack.
      if (['trivia', 'wordforge', 'quests'].includes(rec.type)) {
        items.push({
          kind: 'item', id: 'load-pack', page: 'pack-loader',
          label: 'Load your own pack',
          hint: 'from a file, or paste JSON',
        });
      }
      return items;
    },
    // THE MENU'S OTHER CONTENT: things the shell should not know about, contributed by the
    // host through `extras` — which is what that hook was for.
    // THE TWO DIAGNOSTIC PAGES. Read lazily through `runtime`, because the menu is built
    // before the input stack is - and because both answer "right now", so a snapshot taken
    // at mount time would be a lie by the time anybody opened it.
    pages: {
      get controls() { return runtime ? controlPages({ runtime, subjectName }).controls : undefined; },
      get activity() { return runtime ? controlPages({ runtime, subjectName }).activity : undefined; },
      // WHAT ELSE THIS CAN TALK TO. Always present, at every complexity level, because a page
      // that is itself hidden until you are advanced enough defeats its own purpose - it
      // exists so that everything ELSE can hide without becoming a secret.
      get connections() {
        return connectionsPage({
          states: () => (settings.get() || {}).connections || {},
          level: complexity,
        });
      },
      // WHO THIS SCREEN IS FOR — the picker, as a page rather than a cycling field.
      //
      // A `choice` field would have been less code and the wrong control: handing a screen to
      // a different person changes whose bindings drive it, whose voice it speaks with and
      // whose events it writes, and cycling past three names to reach the fourth would APPLY
      // each one on the way. A page commits on a press and nothing else.
      // "LOAD YOUR OWN PACK" — the page the `load-pack` item above opens. `kind` narrows what
      // the loader accepts to whatever the FOCUSED module actually reads (Trivia wants a
      // trivia pack, Word Forge wants a words pack); Quests has no pack kind of its own, so it
      // gets the unrestricted loader — a teacher managing the whole points economy from one
      // place may be loading either kind for a game they are not currently looking at.
      get 'pack-loader'() {
        const rec = focusedRec();
        const kind = rec?.type === 'trivia' ? 'trivia' : rec?.type === 'wordforge' ? 'words' : null;
        return {
          title: 'Load your own pack',
          render(el) { mountPackLoader(el, { kind }); },
        };
      },
      get who() {
        return {
          title: 'Who this screen is for',
          render(el) {
            el.innerHTML = '<div class="st-hint">Loading…</div>';
            // The list is fetched here rather than at boot: it is a moderator action nobody
            // takes at the bedside, and a screen must not wait on it to come up.
            Promise.resolve(peopleList || profiles.people()).then((list) => {
              peopleList = list || [];
              if (!peopleList.length) {
                el.innerHTML = '<div class="st-hint">No people on this account yet. '
                  + 'Add one on the home page.</div>';
                return;
              }
              el.innerHTML = peopleList.map((who) => {
                const on = personId && who.id === personId;
                return `<button class="st-item" type="button" data-person="${esc(who.id)}">
                  <span class="st-label">${esc(who.name)}</span>
                  ${on ? '<span class="st-hint">this screen is theirs</span>' : ''}
                </button>`;
              }).join('');
              el.querySelectorAll('[data-person]').forEach((b) => {
                b.addEventListener('click', async () => {
                  const id = b.dataset.person;
                  if (id === personId) return;
                  const note = el.querySelector('.st-hint') || el;
                  try {
                    await profiles.moveToPerson(profileId, id);
                    personId = id;
                    const who = peopleList.find((x) => x.id === id);
                    whoState = who ? { name: who.name } : false;
                    // The BINDINGS are the other half of this and they are NOT re-read here.
                    // Reloading is honest about that: whose switch drives this screen changed,
                    // and the input runtime, the drive socket and the marker stream were all
                    // built around the old person at boot. Pretending a live swap happened
                    // would leave a screen that says one name and answers to another.
                    reloadPage();
                  } catch (err) {
                    b.insertAdjacentHTML('afterend',
                      `<div class="st-hint">could not move it: ${esc(err.message || err)}</div>`);
                  }
                });
              });
            }).catch((err) => {
              el.innerHTML = `<div class="st-hint">could not load the list: ${esc(err.message || err)}</div>`;
            });
          },
        };
      },
    },
    extras: () => [
      ...(runtime ? CONTROL_ITEMS : []),
      ...CONNECTION_ITEMS,
      // LETTING THE SCREEN FIX ITSELF, as an ordinary settings row. Turning recovery on used
      // to mean hand-writing state; now it is one press, which is what "turn it on for the
      // bench first" has to mean in practice. Written to the same profile settings blob the
      // engine reads, so there is one source of truth rather than two.
      { kind: 'heading', id: 'recovery-head', label: 'When something stops working' },
      ...fieldItems(RECOVERY_SETTINGS.map(normalizeField).filter(Boolean), {
        values: () => (settings.get() || {}).recovery || {},
        level: complexity(),
        onStep: (key, value) => {
          const cur = (settings.get() || {}).recovery || {};
          settings.set({ recovery: { ...cur, [key]: value } });
        },
      }),
      ...restartItems(restart, {
      screenName: arr.profile()?.name ? `“${arr.profile().name}”` : 'this screen',
      onChange: ({ mode }) => {
        // Choosing "always come back here" names THE SCREEN YOU ARE STANDING ON. That is
        // the gesture: walk to the one that works, and say come back here.
        restart = writeConfig(user, mode === 'screen'
          ? { mode, screenId: profileId }
          : { mode }, storage);
        menu.refresh();
      },
    })],
    // Still ungated at the bedside, deliberately. The three-way switch in input.js gates
    // which BINDINGS fire; it does not answer "is a moderator standing here", and inventing
    // that mapping would be guessing at semantics nobody has decided. Open, and recorded as
    // open rather than papered over with a plausible-looking default.
    gated: false,
  });
  controlsEl.querySelector('[data-act="settings"]').addEventListener('click', () => menu.toggle());
  // WHO THIS SCREEN IS FOR, resolved in the background and never blocking the boot. It
  // brings two things: the name the menu shows, and THE PERSON'S OWN BINDINGS. A screen
  // that will not come up because a name lookup failed is strictly worse than one that
  // says "…" and runs on the defaults.
  //
  // `makeState` means a local backend (the dev test): there is no /api/people behind it,
  // so the defaults simply stand rather than the runtime chasing an endpoint that is not
  // there.
  let personOff = null;
  // `drive` and `callTransport` are declared UP TOP with the rest of the early state, and
  // the reason is a bug this file has now had twice — see there.
  (async () => {
    try {
      const p = await profiles.get(profileId);
      // *** A SCREEN WITH NO PERSON IS AN ANSWER, NOT A MISSING ONE. ***
      // This used to `return` here, which left `whoState` at null forever — and null renders
      // as "…", i.e. as "still loading". A screen that has never been handed to anybody then
      // looked like a screen whose lookup had hung. `false` is the finished answer, and the
      // who row offers to fix it.
      if (!p?.person_id) { whoState = false; menu.refresh(); return; }
      personId = p.person_id;
      if (profiles.people) {
        const who = (await profiles.people()).find((x) => x.id === p.person_id);
        // A person_id pointing at somebody who is gone is ALSO a finished answer.
        whoState = who ? { name: who.name } : false;
        menu.refresh();
      }
      // REMOTE DRIVE. A verb arriving on the wire is published onto this screen's own
      // bus, so the router, the settings menu and every module answer it exactly as they
      // answer a switch in the room. Remote drive is not a second control path - it is the
      // same one with a longer wire, which is only possible because the input bus got here.
      //
      // AND THE SCREEN SAYS SO. Someone driving this screen from elsewhere is visible to
      // whoever is sitting in front of it: a person who cannot tell whether the thing in
      // front of them is being operated by somebody else has been made a passenger in their
      // own room. CONFIRMED BY MIKE 2026-08-26 as a SAFETY/CONSENT INVARIANT, which is the
      // only category of rule allowed to be absolute here. It is not a setting, it is not
      // hideable at any complexity level, and it does not bend for a nicer-looking screen.
      if (!makeState && !embedded && profiles.personStateURL) {
        drive = attachDriveToBus(bus, {
          personId: p.person_id,
          user,
          // THE PERSON'S OWN GATE, READ LIVE. This is the whole of Mike's ruling in one
          // argument: the restrictions a driver is subject to are the ones set in the
          // person's section, the same ones the switch in the room is subject to. Read
          // through a function rather than captured, because the gate is flipped mid-session
          // - that IS the "work while she is fidgeting" gesture - and a captured value would
          // be whatever it happened to be when the socket opened.
          gate: () => runtime?.gate() || 'both',
          driverId: p.person_id,
          driverLabel: 'someone helping from another screen',
          onPresence: ({ drivers }) => {
            remoteEl.hidden = !(drivers > 0);
          },
        });
        // A call transport can exist from now on (`childCtx`'s getter builds it from `drive`). The
        // panels mounted before this moment -- usually all of them -- are told, so a call panel that
        // found no transport at mount binds to it now instead of never ringing. 2026-09-30.
        if (!torn) bus.publish(CALL_TRANSPORT_READY);
        // A PHONE AS A MICROPHONE (row 2.42): the screen's half rides the same socket, so only people
        // the server already lets drive this screen can join one. Joining plays nothing by itself --
        // amplify (source "a phone") is what plays it -- and the screen SAYS a phone microphone is on
        // for as long as one is joined or joining. *** NO SETTING HIDES THAT NOTICE. *** It is a
        // listening device in somebody's room, the same kind of promise as "someone is helping from
        // another screen" (Mike's consent invariant, 2026-08-26). Code's recommendation; on Mike's list
        // to confirm as an invariant.
        if (!torn) {
          try {
            phoneRx = createPhoneMicReceiver({ link: drive, bus, config: (settings.get() || {}).call || {} });
            micPill = mountMicLiveIndicator(kioskEl, { receiver: phoneRx, bus });
          } catch (err) { console.error('kiosk: phone microphone', err); }
        }
      }
      if (makeState || embedded || !profiles.personStateURL) return;
      if (torn) return;
      personInputs = createState({
        url: profiles.personStateURL(p.person_id, INPUTS_KEY),
        user,
        cacheKey: `person:${user}:${p.person_id}:${INPUTS_KEY}`,
        // A binding edited on home.html — "an edit made ELSEWHERE lands here with nobody
        // reloading anything" is the input runtime's own stated contract — now lands here
        // near-instantly when push is up, instead of waiting out a poll interval.
        push,
      });
      personOff = await runtime.useState(withSpeechBindings(personInputs));
      // `useState` guards itself too (see `input_runtime.js`), so this is belt and braces on
      // purpose: the unsubscribe it hands back is the thing `destroy()` would have called, and
      // `destroy()` is already past that line.
      if (torn) { try { personOff?.(); } catch { /* already gone */ } personOff = null; return; }
      // THE LISTENING CUE FOLLOWS THE PERSON (2026-09-30): its settings (LISTENING_FIELDS) are about how
      // this person wants to be answered, so they are read off the person's own row -- the one their
      // bindings already live in, beside the bindings record -- and re-attached when they change.
      // 2026-09-30, second pass: the same row now drives the voice as well (applyPerson) -- speech,
      // subtitles and amplify, each re-attached only when one of its own settings changed.
      offListenPerson = personInputs.subscribe?.((s) => applyPerson(s || {})) || null;
      if (!offListenPerson) applyPerson(personInputs.get?.() || {});
      await startMarkerTracking(p.person_id);
      await startDevicePreference(p.person_id);
    } catch {
      /* offline or signed out: the shipped defaults still drive the screen */
      // ...but the who heading must stop saying "…". A lookup that FAILED is not a lookup
      // still running, and leaving it mid-sentence is the exact defect this section was
      // opened for. `false` reads as "not set up for anybody yet", which is what somebody
      // standing at an offline screen can act on.
      if (whoState === null) { whoState = false; menu.refresh(); }
    }
  })();

  // ---- THE INPUT BUS, at the bedside ---------------------------------------
  //
  // This is the half that was missing. Modules were never the problem: a module subscribes
  // to `photos/next` on its scoped bus and has no idea a switch exists, which is exactly
  // why the same module runs here, on the home page, or anywhere else. What did not exist
  // was anybody CONSTRUCTING the device half on this surface — so a person's switch drove
  // the binder on a clinician's laptop and nothing at all on the screen they actually use.
  //
  // IT STARTS ON THE SHIPPED DEFAULTS, BEFORE ANY NETWORK. A screen that is undriveable
  // until a fetch returns is undriveable exactly when the network is the thing that broke.
  // The person's own bindings replace them when they arrive, and again whenever they
  // change — which is what makes a clinician editing on a laptop land here within a poll.

  // *** A REAL BOUND SWITCH/MOUSE HIJACKED THE KIOSK'S OWN CHROME, NOT JUST A MODULE'S. ***
  // Found 2026-09-21: Mike, on the real kiosk (not a preview page this time) — "Clicking on
  // anything in the settings menu just jumps you to selecting a different item... I'll click
  // on Colours and it will jump to someone else using this screen." Reproduced directly: with
  // a real `pointer:mouse -> verb/select` binding (the same class of thing already fixed on
  // the Devices page and the modules.html preview), even the GEAR ITSELF stopped opening the
  // menu — `attachPointer`'s `preventDefault()` on a bound pointerdown suppresses the
  // compatibility click entirely, so the gear's own click handler never ran at all. That is
  // not specific to the settings menu's own next/prev/select scanning (`settings.js`) — it is
  // ANY of the kiosk's own chrome (the transport bar, the screen picker, the menu), because
  // ALL of it sits inside this same `attachPointer(target: window)`.
  //
  // The fix is the opposite shape from the Devices page's (which denylisted a few known
  // controls): here the SAFE default is "let a click through unmolested", and the exception is
  // "unless it lands inside a mounted module's own content" — `.mod-host` is the one marker
  // `mountModule` already puts on every module's root, everywhere, for free (module.js). A
  // switch driving actual content (Trivia, the AAC board, Wait and Go) is correct and
  // intended; a switch double-firing UNDER a click on the kiosk's own chrome is not, and this
  // is the boundary between those two without hand-listing every chrome element that exists
  // today or gets added later.
  const isKioskChrome = (e) => !e.target.closest?.('.mod-host');

  runtime = mountInputRuntime({
    bus,
    modules: focusRing,
    // On the dashboard path (Stage 3b) ESCAPE IS THE PLAIN BAR (Design: "Escape, from anywhere"), so
    // its menu binding is left out there; M still opens the menu, and the menu's own panel still closes
    // on Escape. Every other screen keeps Escape as the menu, exactly as it was.
    // The spoken phrases ride with the keyboard's defaults (a phrase is a press on the `speech` device,
    // so the gate, the log and rebinding all apply). They fire nothing until a recogniser is running,
    // which only a person's own setting starts. A person with a saved record: see withSpeechBindings.
    fallback: [
      ...(useDashboard ? DEFAULT_BINDINGS.filter((b) => b.control !== 'key:escape') : DEFAULT_BINDINGS),
      ...SPEECH_BINDINGS,
    ],
    ignore: isKioskChrome,
    onFocus: (m) => {
      // *** ON A GRID, SHOW WHICH PANEL THE NEXT PRESS WILL ACT ON. ***
      //
      // This used to `return` here, on the reasoning that every panel is already on screen so
      // there is nothing to switch to. True, and it left focus INVISIBLE: the router happily
      // moves focus across the slots (see `focusRing`), so a switch drives a different panel
      // each time it is cycled — and nothing on screen says which. You press, and something
      // happens somewhere.
      //
      // For somebody using a switch that is not a polish issue, it is the difference between a
      // multi-panel screen being usable and not: you cannot choose a target you cannot see.
      //
      // This is NOT the transport bar (F19/G4/D9) and does not build toward it here. No module
      // list, no buttons, no switching controls — it marks the panel the EXISTING focus concept
      // already points at. Nothing new was invented to draw it.
      if (arr.layout()) {
        // `paintFocus` and `renderMods` together, because the ring and the bar are two views of
        // one fact. Moving focus with a switch has to light the same button a press on the bar
        // would have lit, or the two controls are describing different screens.
        paintFocus(m.id);
        renderMods();
        return;
      }
      const i = arr.stageDefs().findIndex((d) => d.id === m.id);
      if (i >= 0 && i !== arr.primary()) showPrimary(i);
    },
  });
  // THE SPEECH LAYER'S ACTIONS: the spoken routes ("play opposites" -> word_games/play) and the
  // switch answers to "Did you mean that?". An input bus refuses an unregistered action, so without
  // these a route phrase or a Yes switch would be logged as unknown and do nothing.
  try { runtime.actions.registerAll([...SPEECH_ACTIONS, ...NEAR_MISS_ACTIONS]); }
  catch (err) { console.error('kiosk: speech actions', err); }
  await runtime.load();
  // The menu takes the verbs while it is open and hands them back when it closes.
  menu.attachBus(bus, runtime.router);
  // The Voice section's status row follows the recogniser (listening / none on this screen).
  onVoiceChange = () => { try { if (!torn) menu.refresh(); } catch { /* a menu that cannot repaint is not a reason to stop */ } };

  // ---- THE CURSOR -------------------------------------------------------------------
  // Shell-level rather than a module, because it draws on top of whichever module is under
  // it and a module that could draw outside its own mount would break the one rule that lets
  // two copies of anything share a screen. See cursor.js.
  //
  // DEFAULTS TO 'tracking': with a mouse the operating system already draws a pointer, and a
  // second one on top would look like a bug to every desktop visitor. A hand tracker moves
  // nothing the OS knows about, so on that screen this is the only pointer there is.
  const cursorRoot = document.createElement('div');
  kioskEl.append(cursorRoot);
  cursor = mountCursor(cursorRoot, {
    bus,
    aim: runtime.aim,
    settings: () => (settings.get() || {}).cursor || {},
  });
  // A settings edit should move the cursor now, not the next time somebody points.
  settings.subscribe?.(() => { try { cursor?.refresh(); } catch { /* never fatal */ } });

  // ---- RECOVERY: watch the panels, and act only if somebody asked --------
  //
  // *** OFF BY DEFAULT, AND THAT IS THE WHOLE DEPLOYMENT PLAN. ***
  //
  // The kiosk is served from the platform, so this file reaches EVERY screen the moment it
  // deploys - including hers, with no bench step in between. That is not a reason to keep the
  // code out; it is a reason for it to do nothing until somebody turns it on. Off by default
  // means the deploy is inert, the bench Pi can be switched on first, and the blast radius of
  // a bug here is exactly the screens that opted in.
  //
  // THE DECISION LAYER IS ELSEWHERE AND PURE. `health.js` decides whether a panel is broken;
  // `recovery.js` decides what to do about it. This function is only the hands - it performs
  // what it is told and reports what it did. Everything frightening about it has already been
  // walked at a fake clock in two test suites that mount nothing and reboot nothing.
  const health = createHealthWatch({ bus, now: recoveryNow });
  let recoveryHistory = {};
  let recoveryTimer = null;
  let currentFault = null;

  const recoveryCfg = () => ({ on: false, ...DEFAULT_POLICY,
                               ...((settings.get() || {}).recovery || {}) });

  // A panel is watched from the moment it mounts. Cheap: a heartbeat is any publish on a
  // topic the module already owns, so nothing was added to any module for this.
  function watchRec(rec) {
    if (!rec) return rec;
    try { health.watch(rec.id, rec.type); } catch { /* a watch must never break a mount */ }
    return rec;
  }

  // Is anybody actually here? The reboot rung asks, and getting this wrong means rebooting a
  // screen somebody is using - the one way this feature could actively hurt.
  function screenInUse() {
    if (menu.isOpen()) return true;                       // somebody is standing here, editing
    if (drive?.presence?.().drivers > 0) return true;     // somebody is driving it from elsewhere
    const last = runtime?.recentActivity?.().slice(-1)[0];
    if (last?.at && recoveryNow() - last.at < 10 * 60 * 1000) return true;
    return false;
  }

  // What could replace a broken panel.
  //
  // SOMEBODY'S OWN ORDER FIRST (`recovery.fallbacks`), then the automatic ranking. The
  // ranking sorts by how exposed a module is, which has no idea that this particular person
  // loves her photos and is bored by the clock - only somebody who knows her does.
  //
  // Anything already on this screen is excluded, so a preference list does not have to
  // enumerate every combination: name two things, and whichever is usable gets used.
  // Swapping YouTube for the photos she is already looking at would change nothing and look
  // like the recovery did nothing.
  function fallbackFor(faultType) {
    const onScreen = new Set([arr.stageRec()?.type, ...arr.slotRecs.map((r) => r.type),
      ...(arr.placedRecs || []).map((r) => r.type)].filter(Boolean));
    return chooseFallback(recoveryCfg().fallbacks, listManifests(),
                          { exclude: [faultType, ...onScreen] });
  }

  async function recoveryStep() {
    const cfg = recoveryCfg();
    if (!cfg.on) return null;                    // the whole feature, in one line

    const faults = health.faults();
    if (!faults.length) {
      // Recovered. Forget the per-fault history so the cheap rungs are available again if it
      // comes back - the windows survive, which is what stops a returning fault rebooting
      // the screen every twenty minutes.
      if (currentFault) { recoveryHistory = cleared(recoveryHistory); currentFault = null; }
      return null;
    }
    const f = faults[0];
    if (currentFault !== f.module) { currentFault = f.module; }

    const decision = nextAction(
      { module: f.module, since: f.since, kind: f.kind },
      recoveryHistory,
      {
        now: recoveryNow(),
        hour: new Date(recoveryNow()).getHours(),
        inUse: screenInUse(),
        // A fallback is only offered for a panel that is genuinely broken. "Nothing to show"
        // is a setup state with a human repair, and swapping her photos away because nobody
        // has connected a source yet would hide the very thing somebody needs to see.
        fallback: f.kind === 'empty' ? null : fallbackFor(f.type),
        canReboot: !!rebootDevice,
        urgency: f.kind === 'errored' ? 'normal' : 'quiet',
      },
      cfg,
    );

    const done = (extra = {}) => {
      onRecovery?.({ ...decision, fault: f, ...extra });
      return { ...decision, fault: f, ...extra };
    };

    if (decision.action === 'remount') {
      const ok = await remountPanel(f.module);
      recoveryHistory = applied(recoveryHistory, 'remount', recoveryNow());
      return done({ performed: ok });
    }
    if (decision.action === 'reload') {
      recoveryHistory = applied(recoveryHistory, 'reload', recoveryNow());
      const out = done({ performed: true });
      reloadPage();
      return out;
    }
    if (decision.action === 'swap') {
      const ok = await swapPanel(f.module, decision.to);
      recoveryHistory = applied(recoveryHistory, 'swap', recoveryNow());
      return done({ performed: ok });
    }
    if (decision.action === 'reboot') {
      recoveryHistory = applied(recoveryHistory, 'reboot', recoveryNow());
      const out = done({ performed: true });
      try { rebootDevice?.(decision); } catch { /* a helper that is not there is not a crash */ }
      return out;
    }
    if (decision.action === 'notify') {
      recoveryHistory = applied(recoveryHistory, 'notify', recoveryNow());
      return done({ performed: true });
    }
    return done({ performed: false });     // wait / hold / done - nothing to do yet
  }

  if (recoveryTick > 0) {
    recoveryTimer = setInterval(() => { recoveryStep().catch(() => {}); }, recoveryTick);
  }

  // auto-hide the control bar
  let hideT = null;
  // HELD: something above the modules is pointing at the bar and needs it on screen while it does
  // — Nimrod the cat saying "This is the bar" (Mike, 2026-09-29, live: he rang empty space, because
  // the bar starts hidden and hides itself after 3 s). One explicit seam, `holdBar(on)` on the
  // handle, rather than the cat reaching in and editing this bar's classes: the kiosk stays the only
  // thing that decides whether its bar shows. Held, the bar is shown and the timer is not armed;
  // let go, it gets an ordinary poke — shown, then the ordinary 3 s — rather than vanishing from
  // under the eyes of somebody who was just looking at it. Whoever holds it lets it go: the cat does
  // on every way it leaves (close, Escape, resting, Next to the end, the page tearing it down), and
  // `destroy()` below drops any hold, so nothing keeps this bar up forever.
  let barHeld = false;
  function holdBar(on) {
    const want = !!on && !torn;       // a torn-down kiosk has no bar to hold
    if (want === barHeld) return barHeld;
    barHeld = want;
    poke();
    return barHeld;
  }
  function poke() {
    controlsEl.classList.remove('hidden');
    try { syncHelp(); } catch { /* declared above; never a reason for the bar not to come up */ }
    clearTimeout(hideT);
    if (barHeld) return;
    hideT = setTimeout(() => {
      if (!embedded) controlsEl.classList.add('hidden');    // an embed's bar stays: see kiosk.css
      // The picker goes with the bar it hangs off. This is the "what if nobody answers"
      // answer for it: left alone, it puts itself away and the screen is back to what it was
      // doing, with nothing having been decided on anybody's behalf.
      toggleScreens(false);
    }, 3000);
  }

  // *** MOUSEMOVE ONLY REVEALS THE BAR NEAR WHERE IT ACTUALLY LIVES. *** Mike, 2026-09-20:
  // "The transport bar seems to be always on in the kiosk. It should just pop up when you put
  // your cursor near the bottom center." Before this, ANY `mousemove` anywhere on the whole
  // screen called `poke()` unconditionally — a mouse naturally drifting during ordinary use
  // keeps re-arming the 3-second timer from across the whole screen, so the bar in practice
  // almost never actually goes away. `.k-controls.hidden` is `opacity:0` (never `display:none`
  // — see kiosk.css), so its own `getBoundingClientRect()` stays valid and correctly positioned
  // even while hidden; expanding that real rect by a margin gives the reveal zone for free,
  // rather than a second, hand-guessed copy of the bar's own position that could drift out of
  // sync with it.
  //
  // POINTERDOWN AND KEYDOWN STILL POKE UNCONDITIONALLY, DELIBERATELY UNCHANGED. Position has no
  // meaning for a touch or a keypress the way it does for a hovering mouse, and narrowing THOSE
  // the same way would reintroduce the exact regression fixed 2026-09-07 (a touch screen or a
  // keyboard-only session that could never bring the bar back at all). This only narrows the
  // mousemove case, which is the only one a "cursor near the bar" even describes.
  const BAR_REVEAL_MARGIN_PX = 140;
  function pokeIfNearBar(e) {
    const r = controlsEl.getBoundingClientRect();
    if (e.clientX >= r.left - BAR_REVEAL_MARGIN_PX && e.clientX <= r.right + BAR_REVEAL_MARGIN_PX
        && e.clientY >= r.top - BAR_REVEAL_MARGIN_PX) poke();
  }
  // *** `mousemove` ALONE MEANT NO TOUCH SCREEN COULD EVER SEE THIS BAR AGAIN. ***
  //
  // Mike, 2026-09-07: *"There is still no way to choose a theme anywhere in the product."* He is
  // right, and the cause is this line rather than anything about themes. The universal settings
  // menu is built, mounted and wired to the gear on this bar; the gear is what opens it; and the
  // bar hides itself after three seconds and was only ever brought back by a MOUSE MOVE.
  //
  // A Pi kiosk with a touch screen has no mousemove. Neither does a tablet. So three seconds
  // after boot the bar left the screen for good, taking with it the theme picker, the complexity
  // switch, every module's declared settings and the way back Home. Measured on the running
  // kiosk before the fix: the gear's own bounding box sat at x = -12px, off the left edge,
  // inside a `.k-controls.hidden` that nothing on a touch device could clear.
  //
  // `pointerdown` covers mouse, touch and pen in one event, and `keydown` covers somebody at a
  // keyboard who never moves the mouse. Passive and non-capturing: this only removes a CSS
  // class, and it must not interfere with a press the board or a game is about to receive.
  //
  // The auto-hide itself stays exactly as it was. A bar that puts itself away is the right
  // behaviour and it is the safe direction -- left alone, the screen goes back to what it was
  // doing. What was wrong was that on the most likely device there was no way to bring it back.
  // BURN-IN PROTECTION (2.18) — its own idle timer, deliberately separate from the bar's
  // 3-second one above. The bar hiding is about giving the screen back to what it was
  // showing; this is about the screen having been showing the SAME PIXELS too long. Ten
  // minutes by real default, not three seconds — dimming or drifting the picture every time
  // somebody's finger left the screen would be its own kind of distracting.
  // (`burnInT` itself is declared earlier, beside `settings.subscribe` — see the comment there.)
  function clearBurnIn() {
    clearTimeout(burnInT);
    kioskEl.classList.remove('burn-dim', 'burn-drift');
  }
  function armBurnIn() {
    const mode = (settings.get() || {}).burnIn || 'off';
    if (mode === 'off') return;
    burnInT = setTimeout(() => {
      kioskEl.classList.add(mode === 'dim' ? 'burn-dim' : 'burn-drift');
    }, burnInIdleMs);
  }
  // Any activity clears it immediately and restarts the wait — same events as the bar's own
  // poke, for the same reason: pointerdown covers touch, keydown covers a keyboard with no
  // mouse ever moving.
  function pokeBurnIn() { clearBurnIn(); armBurnIn(); }
  const BURN_IN_EVENTS = ['mousemove', 'pointerdown', 'keydown'];
  for (const ev of BURN_IN_EVENTS) {
    root.addEventListener(ev, pokeBurnIn, { passive: true });
  }
  pokeBurnIn();

  root.addEventListener('mousemove', pokeIfNearBar, { passive: true });
  for (const ev of ['pointerdown', 'keydown']) {
    root.addEventListener(ev, poke, { passive: true });
  }
  // Starts hidden, deliberately — it pops up on the first real interaction (a touch, a key)
  // or a mouse coming near it, rather than showing once at boot and then, per the note above,
  // effectively never actually leaving during ordinary use. The raw template has no `hidden`
  // class on `.k-controls` (opacity defaults to visible), and `poke()`'s own hide path only
  // ever runs once ITS timeout fires — so simply not calling `poke()` at boot would have left
  // the bar showing forever, never actually arming the auto-hide. Setting the class directly
  // is what genuinely starts it hidden.
  if (!embedded) controlsEl.classList.add('hidden');

  // WHAT LEFT THIS HANDLER, and what stayed.
  //
  // Arrows, Enter, Space and the menu key are now ORDINARY BINDINGS on the input bus: they
  // are rebindable, they work from a switch, and they behave identically here and on the
  // home page. Handling them here as well would fire everything twice.
  //
  // What stays is the CAREGIVER's chrome — number keys, mirror, fullscreen, home. Those
  // are for whoever is standing at the screen with a keyboard, not for the person using
  // it, and none of them belong in anybody's binding list.
  //
  // MIRROR MOVED FROM M TO C, because M is the menu now and C was the better mnemonic
  // anyway: it is the CAMERA mirror.
  const onKey = (e) => {
    // ESCAPE, ON THE DASHBOARD PATH, IS THE PLAIN BAR (Stage 3b; Design: "Escape, from anywhere").
    // From anywhere means with the menu open too: it closes the menu on the way (the menu's own panel
    // closes itself on Escape when it has the keyboard, and never lets the key reach here). Not while
    // typing, and on an embed not for a key that landed outside the box -- the same two rules below.
    if (useDashboard && e.key === 'Escape' && (e.target instanceof Node && root.contains(e.target))
        && !isTyping(e.target)) {
      if (menu.isOpen()) menu.close();
      summonPlainBar();
      return;
    }
    if (menu.isOpen()) return;               // the menu is driven by the bus, not from here
    // (`window` and `document` can be an event's target and are not Nodes: `contains` throws on them.)
    if (embedded && !(e.target instanceof Node && root.contains(e.target))) return;   // a host page's keystrokes are not ours
    // TYPING IS NOT INPUT (input_keyboard.js says so for the bus; this handler never did). A
    // "c" typed into a text box toggled the camera mirror, an "h" opened the screen picker, and
    // a digit switched panels -- out from under the very field somebody was typing in.
    if (isTyping(e.target)) return;
    if (e.key >= '1' && e.key <= '9') { const i = Number(e.key) - 1; if (i < arr.stageDefs().length) showPrimary(i); else return; }
    else if (e.key.toLowerCase() === 'h') { toggleScreens(); return; }
    else if (e.key.toLowerCase() === 'c') toggleMirrorFull();
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else if (e.key === '[') cycleMirrorSize(-1);
    else if (e.key === ']') cycleMirrorSize(1);
    else if (e.key === '\\') cycleMirrorCorner();
    else return;
    poke();
  };
  window.addEventListener('keydown', onKey);

  // ---- WHERE A COLD BOOT LANDS -------------------------------------------
  // `stageDefs.length` clamps a remembered position: a screen can lose modules between
  // boots, and restoring slot 4 of a two-module screen is a blank stage.
  const plan = bootPlan({
    config: restart,
    currentProfileId: profileId,
    stageCount: arr.stageDefs().length,
    hopped: hasHopped(session),
  });
  if (plan.redirectTo) {
    markHopped(session);
    navigate(`kiosk.html?profile=${encodeURIComponent(plan.redirectTo)}`);
  }

  // *** THE PLAIN BAR (step 6 Stage 3b; the dashboard path only). ***
  //
  // Mike, 2026-09-30: the transport bar and the settings menu are modules PLACED in the dashboard, and
  // the 2026-09-11 reason for keeping them in the core -- a broken module must never take the
  // controls away -- is kept by a different route: *"the plain bar is always one hotkey, or one long
  // switch press, away"* ("That sounds good"). Design's spec (room-is-the-screen, "The plain bar (the
  // invariant)"): it is the system's own layer -- solid, flat, not restylable, not removable -- and it
  // opens by Escape, by a long switch press (1.5 s default, 1-3 s, a ring after 250 ms), and BY ITSELF
  // "when no object carries the transport bar: it was removed, or its module failed to mount within
  // 2 s. It stays until an object carries the bar again." Q7 (Mike's list, the guess in force): yes
  // on failure, never otherwise -- a dashboard carrying its bar does not also get this one.
  //
  // This file's own bar (`.k-controls`) IS the plain bar: the same buttons and the same chips
  // (transport_bar.js) it has always had, so nothing about it had to be rebuilt to be trustworthy.
  // *** WHAT IF NOBODY ANSWERS *** (CLAUDE.md's gate test): a summoned plain bar puts itself away after
  // `plainBarSummonMs` untouched, while a placed bar carries the bar; an automatic one never does. It is
  // never a gate -- nothing behind it stops, and it covers only the strip it sits in.
  const DEFAULT_DASHBOARD_CHROME = [
    { id: 'chrome-bar', type: 'transport_bar', dock: 'bottom' },
    { id: 'chrome-menu', type: 'settings_menu', dock: 'left' },
  ];
  let plainSummoned = false;
  let plainSummonT = null;
  let barGraceT = null;
  let barGraceOver = false;
  let plainBarState = null;                // 'off' | 'auto' | 'summoned', or null off this path
  function syncPlainBar() {
    if (!useDashboard) return;
    const s = dash?.impl?.chrome?.()?.bar;  // 'carried' | 'pending' | 'failed' | 'none' | undefined
    if (s === 'pending' && !barGraceOver && !barGraceT) {
      barGraceT = setTimeout(() => { barGraceT = null; barGraceOver = true; syncPlainBar(); }, PLAIN_BAR_MOUNT_GRACE_MS);
    }
    const auto = !dash || !(s === 'carried' || (s === 'pending' && !barGraceOver));
    plainBarState = auto ? 'auto' : plainSummoned ? 'summoned' : 'off';
    controlsEl.classList.toggle('k-plain-off', plainBarState === 'off');
    kioskEl.dataset.plainBar = plainBarState;
  }
  function summonPlainBar() {
    if (!useDashboard || torn) return;
    try { syncHelp(); } catch { /* never a reason for the plain bar not to come up */ }
    plainSummoned = true;
    syncPlainBar();
    clearTimeout(plainSummonT);
    plainSummonT = setTimeout(() => { plainSummoned = false; syncPlainBar(); }, plainBarSummonMs);
  }
  // THE RING while a switch is held (input_longpress.js). Words and a fill, never colour alone, and it
  // moves only if motion is allowed (kiosk.css). `aria-live` so a screen reader hears the instruction.
  let ringEl = null;
  function showRing(p) {
    if (!ringEl) {
      ringEl = document.createElement('div');
      ringEl.className = 'k-ring';
      ringEl.setAttribute('role', 'status');
      ringEl.setAttribute('aria-live', 'polite');
      ringEl.innerHTML = '<span class="k-ring-fill" aria-hidden="true"></span>'
        + '<span class="k-ring-text">Keep holding for the plain bar</span>';
      kioskEl.append(ringEl);
    }
    ringEl.style.setProperty('--k-ring-ms', `${Math.max(0, (p?.holdMs || 1500) - (p?.ringAfterMs || 250))}ms`);
    ringEl.hidden = false;
    ringEl.classList.remove('k-ring-go');
    void ringEl.offsetWidth;                // restart the fill for this hold
    ringEl.classList.add('k-ring-go');
  }
  function hideRing() { if (ringEl) { ringEl.hidden = true; ringEl.classList.remove('k-ring-go'); } }
  // THE ONE MENU, docked where the dashboard's menu module sits (modules/settings_menu.js): moved into
  // its box and scoped to it (settings.js inline mode), and handed back to the shell when the module
  // goes. One menu -- one cursor, one bus attachment -- wherever it is drawn.
  const menuHostEl = kioskEl.querySelector(':scope > [data-settings]');
  function dockMenu(el) {
    if (!el || torn) return () => {};
    el.append(menuHostEl);
    menuHostEl.querySelector('[data-scrim]')?.classList.add('st-inline');
    return () => {
      if (menuHostEl.parentNode !== el) return;
      menuHostEl.querySelector('[data-scrim]')?.classList.remove('st-inline');
      if (!torn) kioskEl.append(menuHostEl);
    };
  }
  // WHAT A PLACED BAR'S BUTTONS SAY (shell_verbs.js), done with the plain bar's own functions.
  const offsShell = [];
  if (useDashboard) {
    controlsEl.classList.add('k-plain');
    const on = (topic, fn) => offsShell.push(bus.subscribe(topic, fn));
    on(SHELL_NEXT, () => { nextInPrimary(); });
    on(SHELL_PREV, () => { prevInPrimary(); });
    on(SHELL_PANEL, () => { panelNext(); });
    on(SHELL_HUSH, () => { audio?.hush?.(!audio.isHushed()); renderHush(); });
    on(SHELL_MENU, () => { menu.toggle(); });
    on(SHELL_FULLSCREEN, () => { toggleFs(); });
    on(SHELL_HOME, () => { toggleScreens(); });
    on(SHELL_MIRROR, () => { toggleMirrorFull(); });
    on(SHELL_HELP, () => { explainHelp(); });
    on(PLAIN_BAR_SHOW, () => { summonPlainBar(); });
    on(PLAIN_BAR_RING, (p) => { showRing(p); });
    on(PLAIN_BAR_RING_END, () => { hideRing(); });
    // Touching the plain bar keeps it up; letting it be puts a summoned one away again.
    controlsEl.addEventListener('pointerdown', () => { if (plainSummoned) summonPlainBar(); }, { passive: true });
  }
  // *** THE SCREEN'S OWN CONTROLS, ANSWERED FOR WHATEVER PRESSES THEM (2026-09-30). *** A room's flower
  // pot, door, bookshelf and dashboard picker publish `system/*` (room_scene.js ROOM_ACTIONS) and wait to
  // hear whether anybody claimed the press -- unclaimed, the room does the nearest honest thing itself
  // (full screen for just that panel, a note saying where settings open). So the kiosk claims what it
  // does, with its own bar's functions, and a switch bound to one of these actions (actions.js
  // SYSTEM_ACTIONS) arrives here the same way. Every path, not only the dashboard's: a room can be a
  // panel on any screen.
  //   fullscreen   the screen, as the bar's ⛶ does
  //   settings     THE menu (opened, never toggled shut: a door that closes the menu is not "open")
  //   modules      the bar, whose panel buttons ARE this screen's modules -- the nearest thing a kiosk
  //                has to "open Modules"; on the dashboard path, the plain bar
  //   dashboards   the screen picker (Home). Not on an embed: it has no other screens, and its last row
  //                navigates the host page away -- left unclaimed there, so the room says so instead.
  const claimed = (p) => { try { p?.claim?.(); } catch { /* a publisher's claim must not stop the press */ } };
  const revealBar = () => { if (useDashboard) summonPlainBar(); else poke(); };
  offsScreen.push(bus.subscribe(SYSTEM_TOPICS.fullscreen, (p) => { claimed(p); toggleFs(); }));
  offsScreen.push(bus.subscribe(SYSTEM_TOPICS.settings, (p) => { claimed(p); if (!menu.isOpen()) menu.open(); }));
  offsScreen.push(bus.subscribe(SYSTEM_TOPICS.modules, (p) => { claimed(p); revealBar(); }));
  if (!embedded) {
    offsScreen.push(bus.subscribe(SYSTEM_TOPICS.dashboards, (p) => { claimed(p); poke(); toggleScreens(true); }));
  }
  // A phone joined or left (phone_mic.js): an amplifier set to play "a phone" follows it.
  offsScreen.push(bus.subscribe(PHONE_MIC_TOPIC, () => {
    try { amplifier?.sourceChanged?.()?.catch?.((err) => console.error('kiosk: amplify', err)); }
    catch (err) { console.error('kiosk: amplify', err); }
  }));

  // The long press itself, on the input bus's physical edges. Its length is a screen setting.
  const longPress = useDashboard ? createLongPress({
    bus, holdMs: () => (settings.get() || {}).plainBarHoldMs,
  }) : null;

  // *** THE DASHBOARD AS A MODULE (step 6 Stage 3; `dashboardModule`, embedded only). ***
  // One `view` module, mounted like any other module (`mountModule`, `childCtx`), into a host that
  // takes the stage's place. It is handed what the kiosk's own arrangement would have used: the same
  // screen record, the arrangement this embed wants (never the saved grid -- see `savedLayout`), the
  // input router (so a switch and the dashboard mean the same panel), the health watch, and THIS
  // kiosk's storage seam (the preview's in-memory one -- never the device's restart record).
  // *** A DASHBOARD THAT WILL NOT START MUST STILL LEAVE SOMETHING ON SCREEN. *** If it throws, it is
  // taken down and this file's own arrangement mounts the panels exactly as it would have without it.
  async function mountDashboard() {
    dashHost = document.createElement('div');
    dashHost.className = 'k-dash';
    stageEl.style.display = 'none';
    stageEl.after(dashHost);
    try {
      dash = mountModule('view', extendCtx(childCtx({ id: `dashboard:${profileId}`, type: 'view' }), {
        mount: dashHost, state: null, events: null,
        viewId: profileId, arrangement: ownArr.profile(), layoutOverride: savedLayout || null,
        router: runtime.router, health, storage, embedded: true,
        // Stage 3b: what it places besides its panels, and the shell's one menu to dock.
        chrome: Array.isArray(dashboardChrome) ? dashboardChrome : DEFAULT_DASHBOARD_CHROME,
        shell: { dockMenu, helpOn: () => helpOn(storage) },
      }));
      dash.impl.onChange?.(() => { renderMods(); syncPlainBar(); });
      await dash.init();
      if (!dash.impl.arrangement?.()) throw new Error('the dashboard module did not build an arrangement');
      renderMods();
      syncPlainBar();
    } catch (err) {
      console.error('kiosk: the dashboard module failed; showing the panels directly', err);
      try { dash?.destroy(); } catch { /* already gone */ }
      dash = null; dashHost?.remove(); dashHost = null;
      stageEl.style.display = '';
      if (arr.layout()) await mountLayout(); else await showPrimary(0);
      syncPlainBar();                       // no dashboard, so the plain bar is THE bar
    }
  }
  if (useDashboard) await mountDashboard();
  else if (arr.layout()) await mountLayout(); else await showPrimary(plan.stageIndex);

  // Links, once the modules exist: sync now, and again whenever the settings doc changes (links
  // written after boot are picked up without a reload, since they are not part of the layout). The
  // subscribe replays at once if settings are loaded, so the explicit sync only matters when they
  // are not; it is idempotent either way.
  let offLinks = null;
  if (screenLinks) {
    screenLinks.sync();
    offLinks = settings.subscribe(() => { if (!torn) screenLinks.sync(); });
  }

  return {
    // The speaker arbiter, so a test (and a future call handler) can reach hush and the
    // call mode without going through a module.
    audio: () => audio,
    // The output bus, for something ABOVE the modules that talks on this screen — Nimrod the cat
    // (`cat_guide.js`, mounted by kiosk.html). Same bus, same one pair of ears: his words queue and
    // yield like any module's instead of talking over them. Null if the bus failed to build.
    output: () => output,
    // Keep the transport bar on screen while something points at it (the cat), and let it go.
    // See `holdBar` beside `poke()`.
    holdBar,
    barHeld: () => barHeld,
    cameraOwner: () => cameraOwner,
    micOwner: () => micOwner,
    // WHAT THE MIC ARBITER WOULD ACTUALLY FALL BACK TO RIGHT NOW — exposed so a test can prove
    // the per-person preference set on home.js's Devices tab actually reaches this screen,
    // rather than trusting that wiring it through `createMicOwner`'s `preferred` callback was
    // enough. Found missing entirely until 2026-09-17: this construction called
    // `createMicOwner()` with no `preferred` at all.
    micPreferred: () => (deviceState?.get() || {}).microphonePreferred || [],
    // The screen currently showing here, and the swap itself - for a test, and for anything
    // that wants to drive it without going through the bus.
    screenId: () => profileId,
    showScreen,
    showPreviousScreen,
    screenStack: () => [...screenStack],
    stageCount: () => arr.stageDefs().length,
    // NOTE: `layout()` was already taken by the mirror/clock HUD positions below. A second
    // `layout:` key in this same object literal is silently shadowed by it — which is
    // exactly what happened first time. This one is the composed SLOT layout.
    slotLayout: () => (arr.layout() ? { ...arr.layout() } : null),
    slotCount: () => arr.slotRecs.length,
    slotTypes: () => arr.slotRecs.map((r) => r.type),
    // One row per link on this screen, carrying or not, each with `ok` and (if not) a `reason`.
    // NULL means no runner exists: the screen has no links, or this is an embed. See screen_links.js.
    linkStatus: () => (screenLinks ? screenLinks.status() : null),
    hasCamera: () => !!arr.cameraRec(),
    hasClock: () => !!arr.clockRec(),
    hasAmbient: () => !!arr.ambientRec(),
    // The raw element, for a test that needs to dispatch a real event at it (a press in the
    // gap between panels) rather than only asking whether something is mounted there.
    ambientEl: () => ambientEl,
    // WHAT IS ACTUALLY MOUNTED, not what was intended. Those were the same thing until the
    // recovery swap arrived; reporting the DEF after a panel had been replaced meant this
    // said "photos" while the screen showed a clock, which is precisely the class of quiet
    // lie the rest of this project keeps rooting out. `stageDefs` is the plan, `stageRec` is
    // the truth, and a caller asking what is on the stage wants the truth.
    primaryType: () => arr.stageRec()?.type ?? arr.stageDefs()[arr.primary()]?.type ?? null,
    // The focused panel's own saved settings. Exposed so a test can assert WHAT LANDED in
    // storage rather than what the menu says it stored - a row can read "8 seconds" while
    // holding the string "8", and the difference only shows up much later, when somebody
    // tries to compare or group settings across panels.
    stageState: () => ({ ...(arr.stageRec()?.state.get() || {}) }),
    mirrorFull: () => mirrorFull,
    layout: () => ({ mirrorSize: kioskEl.dataset.mirrorSize, mirrorCorner: kioskEl.dataset.mirrorCorner, clockCorner: kioskEl.dataset.clockCorner }),
    showPrimary,
    showModule,
    menu,
    runtime,
    // The recovery machinery, exposed so a test can drive it a step at a time rather than
    // waiting on a timer, and so a diagnostic page can show what it currently thinks.
    health,
    recovery: {
      step: recoveryStep,
      faults: () => health.faults(),
      history: () => ({ ...recoveryHistory }),
      enabled: () => recoveryCfg().on,
      inUse: screenInUse,
      fallbackFor,
      // Whether the reboot rung exists on THIS device. No browser on any platform can restart
      // the host OS, so it is false unless a Nimrod appliance supplied a local helper - and
      // the ladder skips the rung rather than waiting on something that can never happen.
      canReboot: () => !!rebootDevice,
    },
    restart: () => ({ ...restart }),
    drive: () => drive,
    next: nextInPrimary,
    prev: prevInPrimary,
    toggleMirrorFull,
    setMirror: patchMirror,
    // Step 6 Stage 3b, the dashboard path only (null elsewhere): whether the plain bar is 'off',
    // up by itself ('auto') or summoned, and the dashboard module's contract (its chrome, its panels).
    plainBar: () => plainBarState,
    dashboard: () => dash?.impl || null,
    // The screen's sound (2026-09-30), for a test and a diagnostic page: the master's handle, the
    // mixer's, the effects chain (null until something asked for one) and the scene the mix follows.
    master: () => master,
    mixer: () => mixer,
    effects: () => fxReal,
    soundScene: () => soundScene,
    listening: () => listening,
    // The voice (2026-09-30, second pass), for a test and a diagnostic page: the speech handle (null
    // unless a recogniser is running), why it is or is not listening, the miss store (null unless on),
    // subtitles, amplify, and the phone-microphone receiver and its notice (null until the drive).
    speech: () => speech,
    speechStatus: () => speechStatus,
    misses: () => missStore,
    subtitles: () => subtitles,
    amplifier: () => amplifier,
    phoneMic: () => phoneRx,
    micPill: () => micPill,
    // Nimrod on the bar: explain what is picked, as the bar's button does.
    help: () => explainHelp(),
    destroy() {
      torn = true;                 // before anything else — see the flag's declaration
      clearTimeout(plainSummonT); clearTimeout(barGraceT);
      try { longPress?.destroy(); } catch { /* already gone */ }
      offsShell.forEach((off) => { try { off(); } catch { /* already gone */ } });
      ringEl?.remove();
      window.removeEventListener('keydown', onKey);
      root.removeEventListener('mousemove', pokeIfNearBar);
      // The pointerdown/keydown pair were never detached here even before today - a real,
      // separate leak, fixed alongside this one since it is the exact same class of bug.
      root.removeEventListener('pointerdown', poke);
      root.removeEventListener('keydown', poke);
      clearTimeout(hideT);
      barHeld = false;
      // The burn-in trio was never detached, and its timer never cleared. Invisible on a page that
      // mounts one kiosk for its whole life; an embed mounts and destroys into the SAME root every
      // time somebody picks another module, so each cycle stacked three more listeners on it.
      for (const ev of BURN_IN_EVENTS) root.removeEventListener(ev, pokeBurnIn);
      clearBurnIn();
      clearInterval(recoveryTimer);
      health.destroy();
      try { offLinks?.(); } catch { /* already gone */ }
      // The dashboard module first: it tears down its own panels and its own arrangement. After it is
      // gone `arr` forwards to this file's own, which has nothing mounted on that path.
      try { dash?.destroy(); } catch { /* already gone */ }
      dash = null; dashHost?.remove(); dashHost = null;
      arr.destroy();
      settings.destroy();
      menu.destroy();
      try { personOff?.(); } catch { /* already gone */ }
      offsScreen.forEach((off) => { try { off(); } catch { /* already gone */ } });
      // The recogniser first: no microphone left open, no miss-log schedule left pruning.
      onVoiceChange = null;
      stopSpeech();
      // Before the socket, so the far end is told rather than left watching a frozen frame.
      try { callTransport?.destroy(); } catch { /* already gone */ } callTransport = null;
      // A phone joined as a microphone is told the screen has gone (before the socket closes).
      try { phoneRx?.destroy(); } catch { /* already gone */ } phoneRx = null;
      try { micPill?.destroy(); } catch { /* already gone */ } micPill = null;
      try { drive?.close(); } catch { /* already gone */ }
      // Amplify lets go of its microphone and its audio context, before the audio bus it is on.
      try { amplifier?.destroy(); } catch { /* already gone */ } amplifier = null;
      // The screen's sound: the cue and its audio sources, the master's two verbs, the mixer, and the
      // effects chain (which closes the audio context it made). Before the audio bus they register on.
      try { offListenPerson?.(); } catch { /* already gone */ } offListenPerson = null;
      try { listening?.destroy(); } catch { /* already gone */ } listening = null;
      try { master?.destroy(); } catch { /* already gone */ } master = null;
      try { mixer?.destroy(); } catch { /* already gone */ } mixer = null;
      try { fxReal?.destroy(); } catch { /* already gone */ } fxReal = null;
      try { barHelp.destroy(); } catch { /* already gone */ }
      // Silences anything mid-sentence as well as clearing the queue. A screen that is being
      // torn down must not keep talking.
      try { output?.destroy(); } catch { /* already gone */ }
      // After the output bus (whose speech channel it taps): clears its lines and any room it reserved.
      try { subtitles?.destroy(); } catch { /* already gone */ } subtitles = null;
      try { audio?.destroy(); } catch { /* already gone */ }
      try { cameraOwner?.destroy(); } catch { /* already gone */ }
      try { cursor?.destroy(); } catch { /* already gone */ }
      try { markerTracker?.destroy(); } catch { /* already gone */ }
      try { micOwner.destroy(); } catch { /* already gone */ }
      try { markerState?.destroy?.(); } catch { /* already gone */ }
      try { deviceState?.destroy?.(); } catch { /* already gone */ }
      try { push?.destroy(); } catch { /* already gone */ }
      runtime.destroy();
      stageEl.innerHTML = ''; mirrorEl.innerHTML = ''; clockEl.innerHTML = '';
      ambientEl.innerHTML = '';
    },
  };
}

function showPreviewBadge() {
  const b = document.createElement('div');
  b.textContent = 'Preview — not saved';
  b.setAttribute('data-preview-badge', '');
  b.style.cssText = 'position:fixed;top:10px;left:50%;transform:translateX(-50%);'
    + `z-index:${LAYERS.menus};`
    + 'padding:6px 14px;border-radius:999px;font:600 13px/1.2 system-ui,sans-serif;'
    + 'background:rgba(10,51,35,.88);color:#F7F4D5;border:1px solid rgba(247,244,213,.35)';
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 6000);
}
