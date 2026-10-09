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
import { mergeSettingsDoc, mergeLayoutSave, mergeKioskSave, lostEditWords } from './doc_merge.js';
import { createEvents } from './events.js';
import { createPackReviews, missingReviewBindings, REVIEW_KEY_BINDINGS } from './pack_reviews.js';
import { createPush } from './push.js';
import { createProfilesClient } from './profile.js';
import { mountModule, extendCtx, getManifest } from './module.js';
import { createAutomation } from './automation.js';
import { createOutputBus } from './output.js';
import { createAudioBus } from './audio_bus.js';
import { createScreenSpeech } from './screen_speech.js';
import { createCameraOwner } from './camera_owner.js';
import { defaultChannels } from './output_channels.js';
import { REMOTE_STREAM } from './output_remote.js';
// (Row 2.38: `classifyLayoutChange` is layout.js's `layoutChange` plus doors -- a change that only moves a
// room object's door is applied in place, like a move, never a reload. room_doors.js argues it.)
import { createArrangement, classifyLayoutChange as layoutChange, ROOM_PANEL_ID, ROOM_PIECE_PREFIX,
  PLACE_REQUEST_TOPIC, SMALL_CLOCK_FIELD, SMALL_CLOCK_KEY, CLOCK_CORNERS, clockCornerOf } from './arrangement.js';
import {
  barModel, drawChips, drawHelpButton, mountBarHelp, helpOn, paintPlayPause, paintBigger, paintSmaller, drawCallControls, paintPieceInert, PIECE_SWITCH_TITLE,
  sitOutWakePress,
  createBarScan, barScanModeOf, BAR_SCAN_FIELD, BAR_SCAN_KEY,
} from './transport_bar.js';
// 2026-10-02: the bar's Pause / Play, a panel made bigger one level at a time, and a live call's controls.
import { PRESETS as LAYOUT_PRESETS, withPreset, HUD_TYPES, addAsOverlay } from './layout.js';
import { createLongPress, clampHoldMs } from './input_longpress.js';
// bar toggle (2026-10-06): T shows or hides the bar (H until row 2.72); hidden that way, it stays hidden a while (bar_toggle.js).
import {
  BAR_TOGGLE_TOPIC, BAR_TOGGLE_KEY_BINDINGS, missingBarToggleBindings, isBarToggleControl, createBarQuiet,
  BAR_QUIET_FIELD, BAR_SELF_FIELD, BAR_KEY_HIDDEN, BAR_HOLD_SLOP_PX,
  BAR_PLAY_FIELD, onModuleControl,   // bar while playing (row 2.65)
  moveOldBarToggleKey,   // T for the bar (row 2.72)
} from './bar_toggle.js';
import {
  SHELL_NEXT, SHELL_PREV, SHELL_PANEL, SHELL_HUSH, SHELL_MENU, SHELL_FULLSCREEN, SHELL_HOME, SHELL_MIRROR,
  SHELL_STATE, SHELL_HELP, SHELL_HOST, PLAIN_BAR_SHOW, PLAIN_BAR_RING, PLAIN_BAR_RING_END, PLAIN_BAR_MOUNT_GRACE_MS,
  PLAIN_BAR_HOLD_DEFAULT_MS, SHELL_PLAY_PAUSE, SHELL_PROMOTE, SHELL_DEMOTE,
} from './shell_verbs.js';
import {
  SYSTEM_TOPICS, verbTopic, SWITCH_MODULE_TOPIC, verbsFor, verbTarget, CALL_CONTROL_TOPIC, CALL_CONTROLS_TOPIC,
  PANEL_LIST_TOPIC, PLACE_MODULE_TOPIC, CALL_HANGUP_TOPIC,
} from './actions.js';
// 2026-10-02: a call to a screen with no Call panel rings a notice here, and the call it answers is hosted
// over the panels by the Call module (`openCallView`). `CALL_ENDED` is that module's own "the call is over".
import { createCallNotice, callNoticeModeOf, CALL_NOTICE_FIELD, NOTICE_RING_MS } from './call_notice.js';
import { CALL_ENDED, CALL_INCOMING } from './modules/call.js';
// 2026-10-04: the screen picks up a new version of the site by itself, at a quiet moment (version_watch.js).
import {
  createVersionWatch, fetchSiteVersion, pickUpVersionsOf, playKindOf, PICK_UP_FIELD, INPUT_QUIET_MS,
} from './version_watch.js';
// 2026-10-05: LOCK THIS SCREEN -- everything inside keeps working, setup included; the ways out to the computer and
// in to the account go (screen_lock.js; narrowed the same day).
import {
  createScreenLock, attachLockGuards, mountLockChip, mountPinStrip, keepWhileLocked, LOCK_PAGE_DROPS, LOCKED_PAGE,
  LOCK_KEY_BINDINGS, missingLockBindings, lockControlOf, chordWords, lockedLine, SCREEN_LOCK_TOPIC, LOCK_STATE_TOPIC,
  RELOCK_CHOICES, lockHelperFrom, createLockReporter, ensureLockCss,
} from './screen_lock.js';
// Row 2.34: the ready-made dashboards (data + the maker + their spoken routes) and the picker's tray.
import {
  createDashboardMaker, PREBUILT_DASHBOARDS, DASHBOARD_GO_TOPIC, DASHBOARD_OFFERS_FIELD, offersOn,
  dashboardSpeechRoutes, dashboardSpeechActions, dashboardSpeechBindings, dashboardsSignature, LOCKED_KEY,
} from './dashboards.js';
import { createDashboardPicker } from './dashboard_picker.js';
// Row 2.38: dashboards inside dashboards -- the live limit, the tray's wait, the trail and its breadcrumb.
import {
  SCREEN_HOME_TOPIC, NEST_LIVE_DEPTH_FIELD, nestLiveDepthFrom, TRAY_OPEN_FIELD, trayOpenMsFrom, BAR_HIDE_MS,
  trailAfter, crumbName, createBreadcrumb, EDIT_IDLE_FIELD, editIdleMsFrom,
} from './dashboard_nest.js';
// Row 2.38, the map editor: the edit view on a screen the kiosk mounts itself, and the map window.
import { openDashboardEditor } from './dashboard_editor.js';
import { mountMapWindow } from './edit_windows.js';
import { mapLoader } from './dashboard_map.js';
import { attachMasterVolume, MASTER_FIELDS } from './master_volume.js';
import { createMixerFx } from './mixer_fx.js';
import { watchPanelSound, PANEL_VOLUME_FIELD, ROOM_SOUND_FIELD, NESTED_MUTED_KEY, nestedMutedFrom } from './panel_sound.js';
import { PANEL_DRIVE_FIELDS, watchPanelDrive } from './panel_drive.js';
import { devicePlays } from './plays.js';
import { BAR_PLACE_FIELD } from './room_bar.js';
// 2026-10-02: Switch module puts the Modules library in the panel's place (see `openLibraryAt`).
import { LIBRARY_TYPE } from './library.js';
// 2026-10-02: a game tells the shell whether it is playing, so the bar's Pause / Play follows it.
import { PLAY_STATE_TOPIC } from './game_start.js';
// 2026-10-02: "3D detail on this device", a screen row (arrangement.js hands it to the 3D room).
import { DETAIL_FIELD } from './room_lod.js';
import { attachMixer, MIXER_FIELDS } from './mixer.js';
import { attachListening, LISTENING_FIELDS } from './listening_cue.js';
import {
  attachSpeech, speechOptionsFrom, speechSwitchFrom, browserRecognizer, meansSomething, SPEECH_FIELDS, SPEECH_ON_FIELDS,
  SPEECH_ACTIONS, NEAR_MISS_ACTIONS, SPEECH_BINDINGS, SPEECH_DEVICE, PHRASES, ROUTES, spokenTable,
  moduleVoiceTable, SPEECH_GRAMMAR_TOPIC,
} from './input_speech.js';
import { attachCursorDrive } from './cursor_drive.js';
import {
  watchFavourites, musicSpeechRoutes, musicSpeechActions, musicSpeechBindings, favouritesSignature,
} from './music_favourites.js';
import { createMissStore, MISS_FIELDS } from './speech_misses.js';
import {
  createSubtitles, subtitlesOptionsFrom, SUBTITLES_FIELDS, SUBTITLE_ACTIONS, SUBTITLES_EARLIER_TOPIC,
  SUBTITLES_LATEST_TOPIC,
} from './subtitles.js';
import { rankedRecognizer, enginePlanFrom, SPEECH_PASS_FIELDS } from './speech_engines.js';
import { createAmplifier, AMPLIFY_FIELDS } from './amplify.js';
import { createPhoneMicReceiver, mountMicLiveIndicator, PHONE_MIC_TOPIC } from './phone_mic.js';
import {
  createVoiceRecorder, createIdbPairStore, createMemoryPairStore, mountRecordingIndicator, VOICE_RECORDING_FIELDS,
  VOICE_RECORDING_TOPIC,
} from './voice_recording.js';
import { VOICE_MODEL_FIELDS } from './voice_model.js';
import { VOICE_ID_FIELDS, voiceIdOptionsFrom, createEnrolment, mountEnrolment } from './voice_id.js';
import {
  createIntercomReceiver, mountIntercomNotice, intercomOptionsFrom, normalizeAllowed, INTERCOM_ACTIONS, INTERCOM_FIELDS,
} from './intercom.js';
import { createDeviceStore } from './starting_defaults.js';
import { flashLimitFrom, FLASH_LIMIT_DEFAULT, flashLimitFieldWith } from './flash_limit.js';
// Hiding a panel can mute or pause it (ad7dc49): a per-panel setting, asked once when a person hides one.
import { createHideSound, WHEN_HIDDEN_FIELD, HIDE_ASK_TIMEOUT_FIELD, makesSound, whenHiddenDefault } from './hide_sound.js';
import { createChoiceMemory } from './choice_card.js';
// User folders (867a7ff, 15eb6b3, 2026-10-02): this device's fonts and colour look, never prompting; the
// "Your own folders" page in the menu.
import { checkDeviceLook } from './user_folders.js';
import { loadDeviceFonts } from './user_fonts.js';
import { userFoldersPage, USER_FOLDER_ITEMS, USER_FOLDERS_PAGE, createDeviceLookRows } from './user_folders_page.js';
// Where a person's history is kept (row 2.58, 2026-10-07): the host every player and game reaches as `ctx.history`,
// and its page on the People tab.
import { createHistoryHost, folderSink, serverSink } from './history_place.js';
import { GAMEPLAY_STREAM } from './telemetry.js';
import { historyPage, HISTORY_ITEMS, HISTORY_PAGE } from './history_page.js';
import { applyZoomFocus, ZOOM_FOCUS_FIELD } from './zoom_focus.js';
import { createAvatarCache, avatarHtml, avatarMotionContext, AVATAR_MOTION_FIELD, OTHERS_AVATAR_FIELDS } from './avatar_display.js';
import { mountSettings, resolveLevel, levelFieldItems, createLocalRow, LEVEL_ORDER } from './settings.js';
import { LAYERS } from './layers.js';
import { fieldsFor, fieldItems, normalizeField, CHOOSE_MODE_FIELD, CHOOSE_MODE_KEY, chooseModeOf } from './settings_fields.js';
// The person's usual starting level for question games, on the People tab (2026-10-06, adaptive_play.js openUsualStart).
import { openUsualStart } from './adaptive_play.js';
// players (2026-10-06): who is playing on this screen, its own tab in the ⚙ menu (player_picker.js).
import { SCREEN_PLAYERS_KEY, normalizeSeats, playersValueLabel, MAX_SEATS } from './player_picker.js';
import { mountPackLoader } from './pack_loader.js';
import { gameSettingsPage, GAME_SETTINGS_PAGE } from './unlocks.js';
// "Lesson topics" (quest / sandbox): a ⚙ menu page since 2026-10-03, moved from the Settings panel's own list.
import { MODE_KEY, MODES, modeFrom } from './lessons.js';
import { mountChoicePicker } from './choice_picker.js';
import { controlPages, CONTROL_ITEMS } from './controls_view.js';
import { connectionsPage, CONNECTION_ITEMS } from './connections.js';
import { pageRow, elsewhereMenuPage, ELSEWHERE_PAGES, ELSEWHERE_PAGE_PREFIX } from './page_links.js';
import { browserVoiceMaker, browserHasVoiceTyping, browserVoiceLabel } from './nimrod_helper.js';
import { createHealthWatch } from './health.js';
import { nextAction, applied, cleared, chooseFallback, DEFAULT_POLICY,
         RECOVERY_SETTINGS } from './recovery.js';
import { listManifests } from './module.js';
import { mountInputRuntime, INPUTS_KEY, RECORD_VERSION } from './input_runtime.js';
import { mountCursor } from './cursor.js';
import { createMicOwner } from './mic_owner.js';
import { DEFAULT_BINDINGS, isTyping, keyControl } from './input_keyboard.js';
import { attachDriveToBus } from './drive.js';
import { createCallTransport, CALL_TRANSPORT_READY } from './call_transport.js';
import { readConfig, writeConfig, bootPlan, markHopped, hasHopped,
         // after a restart (row 2.70): one row, and a restart told from a reload
         RESTART_HEADING, restartField, restartValue, restartPatch, RESTART_KEY,
         isColdStart, hasBootParam, withoutBootParam, markTab, markKeepPlace, takeKeepPlace } from './restart.js';
import { takePreviewLayout } from './preview.js';
import { applyTheme, listThemes, DEFAULT_THEME, THEMES } from './theme.js';
import { syncScene } from './livescene.js';
// Seasons and the sky outside (2026-10-05): "With the seasons" and a wallpaper that follows the weather.
import { paintedTheme, isFollowTheme, followsSeasons, DEVICE_THEME, isDeviceTheme } from './theme.js';
// "Best for this device" (2026-10-07): the default theme, and why it picked what it did on this device.
import { setDeviceHints, startingTheme, settleStartingTheme } from './theme_default.js';
import { followSky, SKY_FIELD, HOLIDAY_FIELDS, SKY_FOLLOW_KEY, HOLIDAYS_KEY, holidayRowLabel } from './sky.js';
import { sceneTakesSky, seasonsWhy, seasonContext } from './seasons.js';
import { cachedFetch } from './cache.js';
import { createPersonKnown, PERSON_KNOWN, PERSON_WAIT_MS } from './person_known.js';
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
import './modules/charts.js';          // registers 'charts' (row 2.62: what played, drawn and read aloud)
import './modules/play_objects.js';    // registers 'play_objects' (row 2.62 step 4: a stack, a pie, posters)
import './modules/room.js';            // registers 'room'
import './modules/word_games.js';      // registers 'word_games'
import './modules/spelling.js';        // registers 'spelling' (row 2.45)
import './modules/simple_math.js';     // registers 'simple_math' (kept so old screens still mount; folded into Math)
import './modules/think_games.js';     // registers 'think_games' (row 2.45: her SLP's exercises, adaptive)
import './modules/word_builder.js';    // registers 'word_builder' (row 2.45: letters to words, adaptive)
import './modules/brain_games.js';     // registers 'brain_games' (row 2.45: quick rounds, adaptive)
import './modules/quiz_mix.js';        // registers 'quiz_mix' (2026-10-06: every kind of question, round by round)
import './modules/name_that.js';       // registers 'name_that' (animal / state / person)
import './modules/karaoke.js';         // registers 'karaoke'
import './modules/solitaire.js';       // registers 'solitaire' (row 2.37, Klondike)
import './modules/note.js';            // registers 'note' (row 2.37, a note from someone)
import './modules/weather.js';         // registers 'weather' (row 2.37, the weather behind the window)
import './modules/music.js';           // registers 'music' (row 2.32, favourites by name)
import './modules/brickbreaker.js';    // registers 'brickbreaker' (row 2.37 item 10)
import './modules/rhythm.js';          // registers 'rhythm' (row 2.37 item 10)
import './modules/avatar.js';          // registers 'avatar' (row 2.37 item 5, avatar maker)
import './modules/voice_review.js';    // registers 'voice_review' (row 2.44, the voice recordings kept here)
import './modules/voice_model.js';     // registers 'voice_model' (2026-10-04: the voice-model steps, one at a time)
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
import './modules/themes.js';          // themes (2026-10-06): the theme gallery as a panel (the menu's Theme row's list)
import './modules/nimrod.js';          // registers 'nimrod' (the guide, 2026-10-02)
import './modules/devices.js';         // registers 'devices'
import './modules/whats_new.js';       // registers 'whats_new' (patch notes)
import './modules/library.js';         // registers 'library' ("Modules": everything addable; Switch module opens it in place)
import './modules/card_sort.js';       // registers 'card_sort' (sort the card onto its pile)
import './modules/profile.js';         // registers 'profile' (a person or an AI character, as a card)
import './modules/people.js';          // registers 'people' ("Your people": the landing, 2026-10-04)
import './modules/helper.js';          // registers 'helper' (Nimrod at the bottom, over the page)
import './modules/edit_options.js';    // registers 'options' (the panel editor's; './modules/view.js' imports it too)
// 'library_slot' (the builder's place for the library) comes in through './modules/view.js'.
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
// Row 2.38: home -- the dashboard this screen started on, the trail cleared (dashboard_nest.js).
export const SCREEN_HOME = SCREEN_HOME_TOPIC;

// *** STEP 6 STAGE 4: IS A REAL SCREEN MOUNTED AS ONE DASHBOARD MODULE? *** Per screen, on its settings
// row: `dashboardModule: true | false`; a row that never chose follows this default. OFF (today's
// arrangement in this file) until the bench soak passes and Mike says the default flips -- one line.
export const DASHBOARD_MODULE_DEFAULT = false;
export const DASHBOARD_MODULE_KEY = 'dashboardModule';
// "Space between panels" (`panelGap`, the screen's Display tab; argued at `shownPanelGap` and in kiosk.css).
// Exported for the suites and for any page that offers the same choice.
export const PANEL_GAPS = Object.freeze(['none', 'thin', 'roomy']);
export const PANEL_GAP_DEFAULT = 'none';
export const PANEL_GAP_FIELD = Object.freeze({ key: 'panelGap', label: 'Space between panels', kind: 'choice',
  level: 'standard', default: PANEL_GAP_DEFAULT,
  options: [{ value: 'none', label: 'None: each panel takes its full share' }, { value: 'thin', label: 'Thin' },
    { value: 'roomy', label: 'Roomy' }] });
/** Which path a real screen boots on, from its settings row and the default. Pure; exported for suites. */
export function dashboardPathFor(row, fallback = DASHBOARD_MODULE_DEFAULT) {
  const v = row && row[DASHBOARD_MODULE_KEY];
  return typeof v === 'boolean' ? v : !!fallback;
}

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
  // after a restart (row 2.70): how this page was opened -- `{ search, navType }` -- for a suite; the page's own
  // address and navigation entry when absent. See `isColdStart` (restart.js).
  launch = undefined,
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
  // PICKING UP A NEW VERSION (2026-10-04, version_watch.js): the seams a suite needs -- `{ fetchVersion,
  // pollMs, checkMs, quietWaitMs, inputQuietMs, storage }`, every one optional; `false` turns the watch off
  // for this mount. Never on an embed. The setting a person changes is the screen row's, not this.
  versionWatch: versionWatchOpts = undefined,
  // A game's "being played" ends this long after the last press (game_start.js GAME_IDLE_MS, 5 minutes, argued there).
  // A seam for the suites, the same reason `burnInIdleMs` is one: null = the module's own constant.
  gameIdleMs = null,
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
  // *** STEP 6 STAGE 4 (2026-10-01): THE REAL SCREEN ON THE DASHBOARD PATH, PER SCREEN. *** A real
  // (not embedded) kiosk reads its screen row's `dashboardModule` (true / false) at boot -- the option
  // above stays embedded-only, so no caller can switch a real screen by passing it. A row that never
  // chose follows `dashboardDefault`, which is `DASHBOARD_MODULE_DEFAULT` (exported, below): OFF until
  // the bench soak says otherwise, so a deploy changes no screen that has not opted in. A seam, so a
  // suite can prove the default-ON world without writing a row.
  dashboardDefault = DASHBOARD_MODULE_DEFAULT,
  // STEP 6 STAGE 3b -- both read only on the dashboard path (`embedded` + `dashboardModule`).
  // `dashboardChrome`: what the dashboard PLACES besides its panels -- by default the transport bar
  // along the bottom and the settings menu down the side (Mike, 2.33: the default dashboard "will
  // start out with the settings/edit menus and transport bar as open modules"). `[]` places none, and
  // then the plain bar is the bar. `plainBarSummonMs`: how long a SUMMONED plain bar stays after the
  // last touch while a placed bar carries it -- a seam for the suites, like `burnInIdleMs`.
  dashboardChrome = undefined,
  plainBarSummonMs = 6000,
  // *** `host` -- THE PAGE HOSTING THIS EMBED, AND ITS OWN ACTIONS (Home, 2026-09-30). *** Read only on
  // the dashboard path (`embedded` + `dashboardModule`); null everywhere else, so no real screen draws a
  // page's buttons. Design put Home's Modules / Save / Save as / History INSIDE the real transport bar and
  // Home's page settings INSIDE the one ⚙ menu. The contract (all optional, all read fresh):
  //   barItems()          the placed bar's first group: [{ act, label, title, disabled, primary }, ...]
  //                       and at most one { kind: 'status', text, dirty }
  //   label(act, state)   words for the bar's own ⚙ and ⛶ ({ menuOpen, full }) -- Edit IS the gear
  //   press(act, p)       what a press of one of those does. Called for SHELL_HOST, whichever thing
  //                       said it: the placed bar, a switch binding, a room object. ONE Save.
  //   menuItems()         a section of the ⚙ menu (settings.js items; `run` for a press)
  //   barHideMs()         how long a placed bar waits in full screen before tucking away (0 = never)
  //   barOver()           (optional) true while the page floats the placed bar over the panels: it then tucks
  //                       away as in full screen (Home's dashboard filling the window; modules/transport_bar.js)
  //   subscribe(fn)       the host's state changed: the bar and the menu redraw
  //   scan                (2026-10-02) the page's own controls taking the switch -- Home's edit bar:
  //                       { held(), next(), prev(), select(), back(), release() }. While `held()` the
  //                       switch's verbs are the page's and the panel router is paused; `release()` is
  //                       how the kiosk asks for it back (see syncHostScan)
  // `fullscreenElement` is a seam for the suites (a real full screen needs a person's gesture).
  host = null,
  // *** `personHost` -- THE PERSON LOOKING, AS THE HOSTING PAGE KNOWS THEM (2026-10-04). *** Read only when
  // `embedded`; null everywhere else, so no real screen takes a page's records. Home's landing, tried before anybody
  // saved it, runs over this browser's local store, whose screens client has no per-person rows: `makePersonState`
  // answers null there, and Nimrod kept a known person's notes in the browser, shared by everybody using it. The
  // contract (both optional): `state(personId, key)` -> a state handle on the person's own record (Home's own
  // maker), and `browserNotes` -> what this browser kept before a person was known (try_new.js
  // `browserNotesSource`). Handed to panels as `ctx.personHost`; today Nimrod is its one reader (nimrod_ai.js
  // `openAIStore`, modules/nimrod.js). Argued: the other per-person readers (music favourites, avatars...) keep today's preview
  // behaviour; giving every module a person's real records on a page that is only being tried is a wider choice.
  personHost = null,
  fullscreenElement = () => (typeof document !== 'undefined' ? document.fullscreenElement : null),
  // *** THE SPEECH RECOGNISER, BY WHICH ENGINE THE PERSON CHOSE (2026-09-30). *** Called ONLY when a
  // person's row turns spoken commands (or subtitles) on - never at boot. `null` means "none here", and
  // the screen says so. 'browser' is the browser's own, which sends the room's sound to its maker
  // (input_speech.js header), so it is only ever made when somebody chose it by name. Everything else is
  // the RANKED list (rows 2.46/2.47, speech_engines.js): a service on this machine ('local'), then the
  // other computers the person chose - it opens no microphone until one of them answers, and until then
  // the screen says "no recogniser on this screen". A seam for the suites, too.
  makeRecognizer = ({ engine, lang, values, micOwner: mo, phoneStreams, actsOn, wakeSays } = {}) => (engine === 'browser'
    ? browserRecognizer({ lang })
    : rankedRecognizer({ plan: enginePlanFrom({ ...(values || {}), speechEngine: engine }), micOwner: mo,
                         phoneStreams, actsOn, wakeSays })),
  // Subtitles' ONLINE route (row 2.47, NOT approved - Mike said "maybe"): made only when a person's row
  // sets `subtitlesRoute: 'online'`, and it only ever writes lines. Off by default.
  makeOnlineCaptioner = ({ lang } = {}) => browserRecognizer({ lang }),
  // How long the screen waits to learn whose it is before its panels carry on without the answer
  // (person_known.js argues the 10 s; 0 = wait however long). A seam for the suites.
  personWaitMs = PERSON_WAIT_MS,
  // "Font on this device" and "Colour look" as menu rows (2026-10-02; user_folders_page.js
  // `createDeviceLookRows`): where the folders, the choices and the fonts are. Absent: this browser's own
  // (its remembered folders, its storage, `document.fonts`). A seam for the suites.
  deviceLooks = null,
} = {}) {
  // WHICH PATH. An embed: its option, as at Stage 3. A real screen: its own settings row (Stage 4) --
  // decided once the row has loaded, below (`settings.load()`), before anything reads this. Nothing
  // between here and there does: every reader is a function called later, or code further down.
  let useDashboard = !!embedded && !!dashboardModule;
  // The host page's actions (see the option): only on the EMBEDDED dashboard path, only if it is an object.
  const hostPage = !!embedded && !!dashboardModule && host && typeof host === 'object' ? host : null;
  bus = bus || createBus();
  // Read before anything else renders: if this screen is not where the device is meant to
  // come back to, the cheapest possible outcome is to leave before mounting a whole kiosk.
  let restart = readConfig(user, storage);
  // after a restart (row 2.70): the account's dashboards, for the row's list (read after boot, and whenever the tray is).
  let restartScreens = [];
  // LOCK THIS SCREEN (2026-10-05; screen_lock.js): read here, before anything is drawn, so a screen that was
  // locked comes back locked and every guard below can ask. This device's own record (the `storage` seam).
  // Never on an embed: a preview on somebody else's page is not a screen anybody locks.
  const screenLock = embedded ? null : createScreenLock({ storage });
  const screenLocked = () => !!screenLock?.isLocked();
  // The key that locks it, as bound NOW (Devices can move it), for the words on screen.
  const lockControlNow = () => { try { return lockControlOf(runtime?.input?.listBindings?.() || []); } catch { return LOCK_KEY_BINDINGS[0].control; } };
  // A press that would leave or change the setup, while locked: refused, and said once on the quiet line.
  const lockRefuses = (what) => {
    if (!screenLocked()) return false;
    try { sayNote(lockedLine(what, lockControlNow())); } catch { /* the note is a courtesy; refusing is the point */ }
    return true;
  };
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
          <!-- A LIVE CALL'S CONTROLS (2026-10-02), first while a call is live: drawn from the call
               panel's own report (transport_bar.js drawCallControls), gone the moment it ends. -->
          <span class="k-call" data-call-controls hidden></span>
          <!-- *** "Home", NOT "Screens". Mike's call, 2026-09-06. *** His reasoning: people
               will see "Screens" and ask what screens MEANS, and Home is the familiar exit
               word. He was given the argument against it — a button called Home that does not
               take you home reads oddly — and chose Home anyway, which is his to choose.
               The title says what it actually does, which is where the precision belongs. -->
          <button data-act="home" title="your screens, and the way out (S)">⌂ Home</button>
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
          <button data-act="playpause" title="pause or play the selected panel" disabled>⏸ Pause</button>
          <button data-act="next" title="next (→ / ↓)">Next ▸</button>
          <!-- Only on an arranged screen; hidden below when there is no layout. See panelNext. -->
          <button data-act="panel" title="move to the next panel" hidden>Panel ▸</button>
          <!-- SWITCH MODULE (2026-10-02): the Modules library in the selected panel's place - see openLibraryAt. -->
          <button data-act="switch" title="switch the selected panel to another module">Switch module</button>
          <!-- BIGGER (2026-10-02 evening): the panel corner's press for the selected panel - see promotePanel. -->
          <button data-act="bigger" title="make the selected panel bigger, one step at a time">⤢ Bigger</button>
          <!-- SMALLER (2026-10-03): the way back down, one level a press, dimmed while nothing is bigger - see demotePanel. -->
          <button data-act="smaller" title="nothing is bigger now" disabled>⤡ Smaller</button>
          <button data-act="mirror" title="mirror mode (C) — camera full screen">Mirror</button>
          <!-- PLAY/PAUSE: the reason it was once left out is gone. NO BACKTICKS IN THIS COMMENT
               (it is inside the root.innerHTML template literal; see the BACK comment above).
               It was left out because there was no shared capability for a bar button to use.
               There is one now: the pause and play VERBS (actions.js MEDIA_VERBS), which
               YouTube, Karaoke, Music and Brick breaker already answer, and which voice and a
               switch already send. So Pause / Play (the button between Back and Next) sends the
               selected panel those verbs, and is DIMMED, never hidden, on a panel that answers
               neither. The whole argument is at playPauseSelected below. -->
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
  // (seasons, 2026-10-05) `fade`: the date changed the look by itself (sky.js) - the scene fades (livescene FADE_MS).
  function applyKioskTheme(id, { fade = false } = {}) {
    // An embed lives on somebody's page, which already has a theme (its own picker, or the
    // signed-in profile's). A screen that has never picked one must not reset that to default.
    lastShownTheme = id;                     // Stage 4: what `syncShownTheme` compares against
    if (embedded && !id) return null;
    const resolved = applyTheme(document.documentElement, id, { flashLimit: flashLimitNow });
    // Subtitles follow the theme's subtitle style (theme.js `--subtitles-style`). In a try: `subtitles`
    // is a later `let`, and the first theme is applied before it exists.
    try { subtitles?.restyle(); } catch (err) { console.error('kiosk: subtitles', err); }
    // The scene's own flashes (neon signs, lightning) follow the screen's flash limit, read every render.
    // (2026-10-05: `paintedTheme`, not THEMES[resolved] -- the same theme, plus what "With the seasons"
    // adds to it while it falls back, e.g. Halloween's cat on Night. See theme.js.)
    syncScene(kioskEl, paintedTheme(id), { flashLimit: flashLimitNow, fade });
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
  // *** "PERSON KNOWN" (person_known.js, 2026-10-02): THE ONE PLACE THAT SAYS WHEN THAT ANSWER IS IN. ***
  // A getter could only say "null" -- not whether null meant "still looking" or "this screen is
  // nobody's". Panels that read the person once at mount (photos, personal videos, the wallpaper, a
  // button, a board, Wait and Go's music, YouTube's presets, the keyboard's bindings) started without
  // the person on a slow boot -- `personId` above is filled by the background lookup, which starts
  // after they mount. Yet THE SCREEN'S OWN ROW, which this file awaits before ANY panel mounts (see
  // `arr.setProfile` below; live, or the last-known-good copy offline), already names the person. So the
  // handle settles from that row, before the first panel; the background lookup settles it again (the
  // same answer changes nothing; a different one -- the screen handed to somebody between the two
  // reads -- makes every panel re-read). Retained, so a panel mounted at any time is told at once. If no
  // answer comes within `personWaitMs` the screen carries on as nobody's, and a late answer still lands.
  const personKnown = createPersonKnown({
    timeoutMs: personWaitMs,
    onSettle: (v) => { try { bus.publish(PERSON_KNOWN, v); } catch (err) { console.error('kiosk: person known', err); } },
  });

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
  // *** WHEN THIS SCREEN IS TALKING (screen_speech.js, 2026-10-04). *** The speech channel marks it; the voice
  // recorder keeps nothing heard while it talks, and the recogniser does not take its own words as a person's.
  const screenSpeech = createScreenSpeech();
  // WAS THE MENU OPEN WHEN A PAUSE / PLAY VERB ARRIVED (2026-10-02)? Subscribed HERE, before the input router
  // exists, so it hears each verb before the router does (the bus delivers in subscription order): the bar's
  // Pause / Play follows a spoken or switched pause only when the verb went to the panel -- and a pause that
  // OPENS the menu (Brick breaker's) must still count. See `notePause`. `menu` is a later const: read in a try.
  let menuOpenAtVerb = false;
  const offVerbSnap = ['pause', 'play'].map((v) => bus.subscribe(verbTopic(v), () => {
    try { menuOpenAtVerb = !!menu.isOpen(); } catch { menuOpenAtVerb = false; }
  }));

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
  // A call arriving at this screen with no Call panel on it (call_notice.js, 2026-10-02): the notice, the
  // call it answered (the Call module hosted over the panels until hang-up), and whether either has the scan.
  let callNotice = null;
  let callView = null;
  let callScanHeld = false;
  let cursor = null;
  let cursorDrive = null;        // cursor_drive.js: "cursor left", "click", "scroll down" move the aim
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
  let lastShownTheme;            // the theme id last applied (Stage 4: a swap re-applies only on a change)
  const bootProfileId = profileId;   // the screen this kiosk booted on (Stage 4: its doc is the one held open)
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
  // "Sound like it's in the room" per panel (panel_sound.js), remembered here until the chain exists and
  // replayed onto it then - choosing a room for a panel must not, by itself, start an audio context.
  const ownerRoom = new Map();
  function effects() {
    if (fxReal || torn) return fxReal;
    try { fxReal = createMixerFx(); } catch (err) { console.error('kiosk: no mixer effects', err); fxReal = null; return null; }
    try { mixer?.sync(); mixer?.setScene(soundScene); } catch (err) { console.error('kiosk: mixer effects', err); }
    for (const [owner, v] of ownerRoom) { try { fxReal.setOwnerReverb(owner, v); } catch (err) { console.error('kiosk: room sound', err); } }
    return fxReal;
  }
  audio.setOwnerReverb = (owner, v) => {
    if (!owner) return 'off';
    if (v && v !== 'off') ownerRoom.set(String(owner), v); else ownerRoom.delete(String(owner));
    return fxReal ? fxReal.setOwnerReverb(owner, v) : (v || 'off');
  };
  audio.ownerReverb = (owner) => ownerRoom.get(String(owner)) || 'off';
  const fxLazy = {
    setCompressor: (ch, on) => fxReal?.setCompressor(ch, on),
    setReverb: (ch, v) => fxReal?.setReverb(ch, v),
    setScene: (id) => fxReal?.setScene(id),
    state: () => (fxReal ? fxReal.state() : null),
    // User folders (867a7ff): an audio plugin (WAM) from the device's own folder.
    addWamFromFolder: (...a) => effects()?.addWamFromFolder(...a),
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
  // the row names - 'local' by default: the ranked recogniser (speech_engines.js), which opens no
  // microphone until a speech service on this machine (web/speech_service) answers, and until then the
  // screen says "no recogniser on this screen" instead of listening somewhere else. kiosk_test proves no
  // getUserMedia and no recogniser start without the setting.
  let speech = null;             // attachSpeech's handle while a recogniser is running, else null
  let speechRec = null;          // the recogniser itself (the ranked one has a status and captions)
  let speechOffs = [];           // its status / caption subscriptions
  let onlineCap = null;          // subtitles' online route, only when a row chose it
  let speechSig = null;
  let speechStatus = 'off';      // off | no-local | no-browser | no-mic | blocked | listening | subtitles-only
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
  let voicePrints = null;        // who is set up on this computer (row 2.56): [{ person, name }], null = not asked yet
  let enrolment = null;          // a voice being set up right now (voice_id.js), and its panel
  let enrolPanel = null;
  // ---- VOICE RECORDING FOR TRAINING, AND THE INTERCOM (row 2.44; wired 2026-09-30) ---------------------
  // Built as pieces in bbd206a; constructed here. Both OFF for everybody: recording keeps nothing unless
  // the person's row says `voiceRecording: true` AND a ranked recogniser is running (it opens no
  // microphone of its own), and the intercom admits nobody until somebody is on the person's approved
  // list (`intercomAllowed`, edited on the home page's Remote tab). Each says so on the screen whenever
  // it is live, and NO SETTING HIDES EITHER NOTICE (voice_recording.js / intercom.js headers).
  let voiceStore = null;         // the pair store (this browser's IndexedDB; memory if there is none)
  let voiceRec = null;           // the recorder: follows the person's row and the running recogniser
  let recPill = null;            // "Recording voice for training"
  let intercomRx = null;         // the room's half of the intercom, once the drive socket exists
  let intercomNote = null;       // "Intercom opening / open: <name>", with End
  // A CALL AND THE ROOM (2026-09-30). The call transport reports a call going live and ending (its
  // `onLive`), and the screen does two things with it:
  //   * VOICE RECORDING IS HELD for the whole live call, for the intercom's reason: the recogniser would
  //     hear the caller through the speaker. Its own reason ('call'), so an intercom and a call cannot
  //     release each other's hold.
  //   * AN OPEN INTERCOM GIVES THE ROOM TO AN ANSWERED CALL, and its phone is told why ('call'). A call
  //     only RINGING leaves it alone - the room can still decline and carry on talking.
  // And a NEW call while an intercom is open is refused as busy only if the person's row chose 'busy'
  // (intercom.js `callDuringIntercom`; the default 'ring' is argued there). Function declarations, so
  // the transport's getter can name them before this line runs; they only ever run on a call.
  function onCallLive(on) {
    try { voiceRec?.hold('call', !!on); } catch (err) { console.error('kiosk: voice recording hold', err); }
    if (on) { try { intercomRx?.endAll('call'); } catch (err) { console.error('kiosk: intercom', err); } }
  }
  // *** THE CALL TRANSPORT — the reason the Call panel could never ring. ***
  //
  // `modules/call.js` has always read `ctx.callTransport` and nothing ever supplied one,
  // so the panel mounted, showed its idle state and waited forever. It is built LAZILY
  // from the drive socket, because that socket is opened during the async person lookup
  // below and a module mounted before it resolved would otherwise capture null for good —
  // the same reason `personId` and `output` are getters. (2026-10-02: the screen also builds it
  // as soon as the socket attaches, for the incoming-call notice - see `attachCallNotice`.)
  //
  // ONE SOCKET, NOT TWO. Signalling rides the connection this screen already has: it is
  // already authenticated, it already knows which two devices belong to one person, and
  // it already reconnects on facility wifi. A second socket would be a second thing to
  // get all three of those right.
  function callTransportNow() {
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
        // A NEW call while an intercom is open: refused as busy only if the person's row chose that
        // (intercom.js `callDuringIntercom`, default 'ring' - argued there).
        busy: () => callRefusedForIntercom(),
      });
      // A call going live (answered) or ending: voice recording holds for it, and an open intercom
      // gives the room to it. See `onCallLive`.
      callTransport.onLive((on) => onCallLive(on));
    }
    return callTransport;
  }
  function callRefusedForIntercom() {
    try {
      return (intercomRx?.sessions?.() || []).length > 0
        && intercomOptionsFrom(personRow || {}).callDuringIntercom === 'busy';
    } catch { return false; }
  }
  // ---- THE FLASH LIMIT (rows 2.43/2.48; flash_limit.js) -------------------------------------------------
  // The screen's row and the person's row (the stricter wins), with the starting-defaults layer on THIS
  // device filling only what nobody chose. A module reads it as `ctx.flashLimitPerSecond` (a getter, so a
  // changed setting is followed); automation's slow wave and the live scene read it every tick.
  // `screenRowNow` is a stand-in until the screen's settings row exists (it is built further down): a
  // reader that runs before then gets the default (no limit, unless the starting-defaults layer set one;
  // flash_limit.js, 8a89e31) - never a ReferenceError from a `const` not reached.
  let screenRowNow = () => ({});
  // The starting-defaults layer, read ONCE, on first use (flashLimitNow can run every frame; this parses
  // a record out of storage). A layer applied on another page of this device lands at the next boot.
  let startingStore = null;
  function startingLayer() {
    if (!startingStore) {
      try { startingStore = createDeviceStore(storage ? { storage } : {}); } catch { return {}; }
    }
    try { return startingStore.layer() || {}; } catch { return {}; }
  }
  function flashLimitNow() {
    try { return flashLimitFrom([screenRowNow() || {}, personRow || {}], startingLayer()); }
    catch { return FLASH_LIMIT_DEFAULT; }
  }
  // THE AVATARS' CONTEXT (avatar_display.js `avatarMotionContext`), read fresh at every draw: the screen's
  // row, the person's, the starting-defaults layer, and WHO THIS SCREEN IS FOR (`viewerId` -- without it
  // every face, the person's own included, counts as "somebody else's" for OTHERS_AVATAR_FIELDS). The who
  // page's cache and a call panel's (`ctx.avatarContext`) both read this one function, so a changed row
  // reaches every face on the screen. Before the screen's row exists it reads as empty, never a throw.
  function avatarContextNow() {
    try {
      return avatarMotionContext({ screen: screenRowNow() || {}, viewer: personRow || {}, layer: startingLayer(),
        flashLimit: flashLimitNow, viewerId: personId });
    } catch { return avatarMotionContext({ viewerId: personId }); }
  }
  // THE PERSON'S MUSIC FAVOURITES AS SPOKEN ROUTES (music_favourites.js): "computer please play <name>".
  // Their routes join input_speech's own when speech attaches; their actions are registered and their
  // bindings added at runtime (never written into the person's bindings record).
  let musicFavs = null;
  let musicRoutes = {};
  let offMusicActions = null;
  // ROW 2.34: THE PERSON'S DASHBOARDS AS SPOKEN ROUTES ("go to <name>"), and the ready-made ones ("go to my
  // room"), added the same way as the music favourites -- see `applyDashboards`.
  let dashRoutes = {};
  let offDashActions = null;
  let lastDashList = [];
  const SILENT_INPUT = { down() {}, up() {} };   // subtitles-only: the room is heard, nothing is pressed
  // `subtitlesRoute` is here too: the online captioner starts and stops with the recogniser.
  // The person's own voice model (voice_model.js): its switch and port change where "this screen" listens.
  // (Its folder is the speech service's own, `--my-voice`, not a setting here.)
  // Who is talking (voice_id.js, row 2.56): its two keys are sent to the speech program when the recogniser connects.
  const SPEECH_KEYS = [...SPEECH_ON_FIELDS, ...SPEECH_FIELDS, ...SPEECH_PASS_FIELDS, ...MISS_FIELDS, ...VOICE_ID_FIELDS]
    .map((f) => f.key).concat('subtitlesRoute', 'voiceModelOn', 'voiceModelPort');
  const AMP_KEYS = AMPLIFY_FIELDS.map((f) => f.key);
  const SUBS_KEYS = SUBTITLES_FIELDS.map((f) => f.key);
  // The keys whose change adds or removes rows in the Voice section without restarting speech.
  const REC_MENU_KEYS = ['voiceRecording', 'intercomAllowed'];
  let recMenuSig = null;
  const sigOf = (r, keys) => JSON.stringify(keys.map((k) => (r && k in r ? r[k] : null)));

  function stopSpeech() {
    for (const off of speechOffs) { try { off(); } catch { /* gone */ } }
    speechOffs = [];
    // The recorder lets go of the recogniser first (it saves what it has already heard whole).
    try { voiceRec?.detach(); } catch (err) { console.error('kiosk: voice recording', err); }
    // A voice being set up stops with the recogniser it was talking through (nothing is saved; its panel says so).
    try { enrolment?.cancel(); } catch { /* already over */ }
    try { speech?.destroy(); } catch (err) { console.error('kiosk: speech', err); }
    speech = null;
    speechRec = null;
    try { onlineCap?.stop(); } catch { /* already stopped */ }
    onlineCap = null;
    try { offMissSchedule?.(); } catch { /* already stopped */ }
    offMissSchedule = null;
    missStore = null;
  }
  // THE FOCUSED MODULE'S OWN SPOKEN COMMANDS (87bcd41, wired 2026-10-02): its manifest's `voice`, as a
  // table of only the verbs it answers (input_speech.js `moduleVoiceTable`). Read at the moment
  // something is heard, so focus moving needs no restart of the recogniser.
  const focusedVoice = () => {
    try {
      const m = runtime?.router?.focused?.();
      return m ? moduleVoiceTable(getManifest(m.type)?.voice, { verbs: verbsFor(m.type) }) : null;
    } catch { return null; }
  };
  // (Re)attach speech from the person's row -- only when one of ITS settings changed, so a poll that
  // brings nothing new never restarts a recogniser under somebody who is mid-sentence.
  function syncSpeech(row) {
    const r = row || {};
    const sw = speechSwitchFrom(r);
    const subsOn = r.subtitlesOn === true;
    const want = sw.on || subsOn;
    const sig = JSON.stringify([want, !!runtime, torn, sigOf(r, SPEECH_KEYS),
      favouritesSignature(musicFavs?.list?.() || []), dashboardsSignature(dashRoutes)]);
    if (sig === speechSig) return;
    speechSig = sig;
    stopSpeech();
    speechStatus = 'off';
    if (torn || !want || !runtime) { onVoiceChange?.(); return; }
    let rec = null;
    const routes = { ...ROUTES, ...musicRoutes, ...dashRoutes };
    try {
      const wakes = speechOptionsFrom(r).wake;
      rec = makeRecognizer({ engine: sw.engine, lang: 'en-US', values: r, micOwner,
                             phoneStreams: () => phoneRx?.streams?.() || [],
                             // Subtitles-only has no commands, so every sure guess is as good as any.
                             actsOn: sw.on ? (t) => meansSomething(t, wakes, PHRASES, routes, focusedVoice()) : null,
                             // A wake-phrase detector (speechWakeUrl, 82d97a4) opens the listening window
                             // the moment it hears the phrase.
                             wakeSays: sw.on ? (wakes[0] || null) : null });
    } catch (err) { console.error('kiosk: recogniser', err); rec = null; }
    if (!rec) { speechStatus = sw.engine === 'browser' ? 'no-browser' : 'no-local'; onVoiceChange?.(); return; }
    speechRec = rec;
    // VOICE RECORDING hears what this recogniser already cut (a ranked one; the browser's own cuts
    // nothing and is never attached). It keeps nothing unless the person's row turned it on.
    try { voiceRec?.attach(rec); } catch (err) { console.error('kiosk: voice recording', err); }
    // THE RANKED RECOGNISER SAYS WHETHER ANYTHING IS ANSWERING (rows 2.46/2.47). Until an engine says
    // hello it has opened no microphone, and the menu says "no recogniser on this screen".
    const fromRec = (st) => {
      const s = st && st.state;
      if (s === 'waiting' || s === 'stopped') return 'no-local';
      if (s === 'no-mic') return 'no-mic';
      if (s === 'blocked') return 'blocked';
      return sw.on ? 'listening' : 'subtitles-only';
    };
    if (typeof rec.onStatus === 'function') {
      speechOffs.push(rec.onStatus((st) => {
        if (speechRec !== rec) return;
        const next = fromRec(st);
        if (next !== speechStatus) { speechStatus = next; onVoiceChange?.(); }
      }));
    }
    // WHO IS TALKING (row 2.56, voice_id.js): who is set up on this computer, for the Voice rows' wording - names and
    // dates only (the speech program never sends a voiceprint's numbers). Asked once an engine that offers it is up.
    voicePrints = null;
    if (rec.voiceId && typeof rec.voiceId.onEvent === 'function') {
      speechOffs.push(rec.voiceId.onEvent((m) => {
        if (speechRec !== rec || !m) return;
        if (m.kind === 'voiceprints') {
          voicePrints = (Array.isArray(m.people) ? m.people : []).filter((p) => p && p.usable !== false)
            .map((p) => ({ person: String(p.person || ''), name: String(p.name || '') }));
          onVoiceChange?.();
        } else if (m.kind === 'enrolled' || m.kind === 'forgotten') {
          try { rec.voiceId.list(); } catch { /* the next status asks again */ }
        }
      }));
      if (typeof rec.onStatus === 'function') {
        speechOffs.push(rec.onStatus(() => {
          if (speechRec !== rec || voicePrints !== null) return;
          try { if (rec.voiceId.available()) rec.voiceId.list(); } catch { /* not up yet */ }
        }));
      }
    }
    // Captions: every pass of every utterance, corrected in place (row 2.47). With them, `onHeard` does
    // not also write lines - one utterance, one line.
    const captions = typeof rec.onCaption === 'function';
    if (captions) {
      speechOffs.push(rec.onCaption((c) => { try { subtitles?.caption(c); } catch (err) { console.error('kiosk: subtitles', err); } }));
    }
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
        routes,
        screenSpeech,
        scoped: sw.on ? focusedVoice : null,
        // Subtitles-only: no commands, so nothing is confirmed, asked, logged or announced -- the
        // recogniser is there to write the room down, and a wake phrase does nothing.
        ...(sw.on ? {} : { confirm: 'off', nearMiss: false }),
        output: sw.on ? output : null,
        bus: sw.on ? bus : null,
        misses: sw.on ? missStore : null,
        onHeard: (h) => { if (captions) return; try { subtitles?.heard(h); } catch (err) { console.error('kiosk: subtitles', err); } },
      });
      speech.start();
      speechStatus = typeof rec.status === 'function' ? fromRec(rec.status()) : (sw.on ? 'listening' : 'subtitles-only');
      // SUBTITLES' ONLINE ROUTE: only when the row chose it, only while subtitles are on, never a
      // command (its words go straight to the subtitles), and never twice when the browser's own is
      // already the recogniser.
      if (subsOn && sw.engine !== 'browser' && subtitlesOptionsFrom(r).route === 'online') {
        try {
          onlineCap = makeOnlineCaptioner({ lang: 'en-US' });
          onlineCap?.start((text) => {
            try { subtitles?.add({ text, source: 'online' }); } catch (err) { console.error('kiosk: subtitles', err); }
          });
        } catch (err) { console.error('kiosk: online captions', err); onlineCap = null; }
      }
    } catch (err) {
      console.error('kiosk: speech', err);
      stopSpeech();
      speechStatus = 'off';
    }
    onVoiceChange?.();
  }
  // The person's music favourites, kept current: each change rebuilds the "play <name>" routes, swaps
  // their actions and runtime bindings, and re-attaches speech (only if the spoken names changed - the
  // signature above). No person, no favourites: `watchFavourites` returns null and nothing is added.
  function applyMusic(list) {
    let made = {};
    try { made = musicSpeechRoutes(list || []).routes || {}; } catch (err) { console.error('kiosk: music routes', err); made = {}; }
    musicRoutes = made;
    try { offMusicActions?.(); } catch { /* gone */ }
    offMusicActions = null;
    try {
      const off = runtime?.actions?.registerAll?.(musicSpeechActions(musicRoutes));
      offMusicActions = typeof off === 'function' ? off : null;
    } catch (err) { console.error('kiosk: music actions', err); }
    // The dashboards' phrases are made around the music's, so a change here may free or take one of theirs.
    applyDashboards(lastDashList);
    applyExtraSpeechBindings();
    if (personRow) syncSpeech(personRow);
  }
  // The runtime's extra bindings are ONE list (input_runtime.js `setExtraBindings` replaces it), so the
  // music favourites' and the dashboards' are always set together.
  function applyExtraSpeechBindings() {
    try { runtime?.setExtraBindings?.([...musicSpeechBindings(musicRoutes), ...dashboardSpeechBindings(dashRoutes)]); }
    catch (err) { console.error('kiosk: spoken bindings', err); }
  }
  // ROW 2.34: the dashboards the picker lists become "go to <name>" (made AFTER the music favourites, so
  // nothing here can take one of their phrases), plus the ready-made ones' "go to my room". Re-attaches
  // speech only when what is speakable changed (the signature in `syncSpeech`). An embed has no other
  // dashboards and answers none of this.
  function applyDashboards(list) {
    if (embedded || torn) return;
    lastDashList = Array.isArray(list) ? list : [];
    let made = {};
    try {
      made = dashboardSpeechRoutes(list || [], { taken: spokenTable(PHRASES, { ...ROUTES, ...musicRoutes }) }).routes || {};
    } catch (err) { console.error('kiosk: dashboard routes', err); made = {}; }
    if (dashboardsSignature(made) === dashboardsSignature(dashRoutes) && offDashActions) return;
    dashRoutes = made;
    try { offDashActions?.(); } catch { /* gone */ }
    offDashActions = null;
    try {
      const off = runtime?.actions?.registerAll?.(dashboardSpeechActions(dashRoutes));
      offDashActions = typeof off === 'function' ? off : null;
    } catch (err) { console.error('kiosk: dashboard actions', err); }
    applyExtraSpeechBindings();
    if (personRow) syncSpeech(personRow);
  }
  function watchMusic(personId) {
    if (musicFavs || torn || !personId) return;
    try {
      musicFavs = watchFavourites({ makePersonState: childCtx({ id: 'music' }).makePersonState, personId,
                                    onChange: (list) => { if (!torn) applyMusic(list); } });
    } catch (err) { console.error('kiosk: music favourites', err); musicFavs = null; }
  }
  // Everything the person's row drives, in one place: the listening cue, subtitles, amplify, speech.
  function applyPerson(row) {
    const r = row || {};
    personRow = r;
    // The person is a level of the chain (2026-10-02): a screen, dashboard and device that never picked
    // follow the person's colours and backgrounds.
    try { syncShownTheme(); } catch (err) { console.error('kiosk: the person level', err); }
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
    // Recording follows the row BEFORE speech (re)attaches, so a recogniser attached below is heard
    // with the row's own options. Its keys are not speech's: turning it on never restarts a recogniser.
    try { voiceRec?.update(r); } catch (err) { console.error('kiosk: voice recording', err); }
    // Somebody taken off the approved list while talking is cut off now, not at the next offer.
    try { intercomRx?.recheck(); } catch (err) { console.error('kiosk: intercom', err); }
    // Their rows come and go in the Voice section with these settings (and speech may not restart to
    // repaint it): the menu is redrawn when one of them changed.
    const rs = sigOf(r, REC_MENU_KEYS);
    const menuDue = recMenuSig !== null && rs !== recMenuSig;
    recMenuSig = rs;
    syncSpeech(r);
    if (menuDue) onVoiceChange?.();
  }

  // A DEVICE'S SHIPPED BINDINGS STAND UNTIL THE PERSON BINDS THAT DEVICE THEMSELVES. The runtime's
  // `fallback` only covers somebody with NOTHING saved; a person who saved a switch setup has a record,
  // and it replaced every default - including the spoken ones, so "computer please pause" would fire
  // nothing for exactly the people most likely to have set things up. So the person's handle is read
  // through this: a saved record with no binding on the speech device gets SPEECH_BINDINGS added (in
  // memory only - never written back). Binding any phrase yourself takes over the whole device.
  function withSpeechBindings(handle) {
    const add = (s) => {
      const rec0 = s && s[INPUTS_KEY];
      if (!rec0 || rec0.v !== RECORD_VERSION || !Array.isArray(rec0.bindings)) return s;
      // T for the bar (row 2.72): a record that saved the shipped H binding has it on T, in memory (bar_toggle.js).
      const movedT = moveOldBarToggleKey(rec0.bindings);
      const rec = movedT === rec0.bindings ? rec0 : { ...rec0, bindings: movedT };
      if (rec !== rec0) s = { ...s, [INPUTS_KEY]: rec };
      // The reviewing keys (W / O, pack_reviews.js) the same way: added in memory where the record does
      // not already use that key or bind that action. What a person set up wins.
      // (2026-10-05) ...and the lock's chord (screen_lock.js `missingLockBindings`), the same rule, on a real screen.
      const review = [...missingReviewBindings(rec.bindings), ...(screenLock ? missingLockBindings(rec.bindings) : []),
        ...missingBarToggleBindings(rec.bindings)];   // bar toggle: T (row 2.72), the same rule (bar_toggle.js)
      if (rec.bindings.some((b) => b && b.device === SPEECH_DEVICE)) {
        return review.length ? { ...s, [INPUTS_KEY]: { ...rec, bindings: [...rec.bindings, ...review] } } : s;
      }
      return { ...s, [INPUTS_KEY]: { ...rec, bindings: [...rec.bindings, ...SPEECH_BINDINGS, ...review] } };
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
      // A new outline starts no faster than the screen's flash limit (subtitles.js).
      flashLimit: flashLimitNow,
    });
  } catch (err) { console.error('kiosk: subtitles', err); subtitles = null; }
  // VOICE RECORDING (row 2.44): built once, inert. Its store is THIS browser's IndexedDB (opened on first
  // use, which is never while recording is off), or memory where there is none. Its notice is mounted now
  // and stays hidden until it records; nothing hides it while it does.
  try {
    try { voiceStore = createIdbPairStore(); } catch { voiceStore = createMemoryPairStore(); }
    voiceRec = createVoiceRecorder({ store: voiceStore, bus, screenSpeech });
    recPill = mountRecordingIndicator(kioskEl, { recorder: voiceRec, bus });
  } catch (err) { console.error('kiosk: voice recording', err); voiceRec = null; recPill = null; }
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
        screenSpeech,
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
  // ROW 2.41: any numeric setting can be driven by an input. Bindings are the screen's (settings
  // `automations`); the values they drive are an in-memory layer over each panel's own state
  // (automation.js). `settings` is only read inside the callback, long after it exists.
  const automation = createAutomation({
    bus,
    // The slow wave's shortest period follows the screen's flash limit, re-read every tick.
    flashLimit: flashLimitNow,
    // Row 2.62 step 3: "what's been played" - this device's own record, counted for THIS screen only (the same
    // filter the Charts panel uses). A getter, so a screen with no data rule never opens the record.
    plays: () => devicePlays(),
    screen: () => profileId,
    // Row 2.62's question: a panel's own size, turn, colour shift and move, drivable on every panel (panel_drive.js).
    extraFields: PANEL_DRIVE_FIELDS,
    onChange: (list) => { try { settings.set({ automations: list }); } catch (err) { console.error('kiosk: automations save', err); } },
  });

  // THE SETTINGS PANEL IS THE ⚙ MENU (2026-10-03; `settingsMenuFor`, beside the menu). Panels mount before the
  // menu exists, so a panel asking for it waits on this; it settles the moment the menu is built.
  let menuBuilt = null;
  const menuReady = new Promise((resolve) => { menuBuilt = resolve; });
  // The view whose rows are being built or pressed right now: the ⚙ menu (null) or a Settings panel's. Each has
  // its own "Settings for" and tab; `menuView()` is how the row builders below ask whose.
  let viewNow = null;
  // The Settings panels' views of the menu, as { view, instanceId }, and whether a repaint of them is queued.
  const menuViews = new Set();
  let viewSyncQueued = false;

  // players (2026-10-06): WHO IS PLAYING ON THIS SCREEN, on the screen's own row (`screenPlayers`), set on the ⚙ menu's
  // Players tab (`playersItems`) and read by every game whose own "Players" follows the screen (childCtx
  // `screenPlayers`; adaptive_play.js resolvePlayers). Read lazily: `settings` and the people are declared below.
  let playerPeople = null;                 // the people as the Players picker last listed them (names)
  const screenPersonNow = () => { try { return personKnown.get().personId || personId || null; } catch { return null; } };
  const screenPlayersHost = {
    seats() {
      let raw = null;
      try { raw = (settings.get() || {})[SCREEN_PLAYERS_KEY]; } catch { raw = null; }
      const seats = normalizeSeats(raw, { selfId: screenPersonNow(), max: MAX_SEATS });
      // A person's name as this login knows them now, where the list has been read; else the name they were picked by.
      return seats.map((s) => (s.kind === 'person' && Array.isArray(playerPeople)
        ? { ...s, name: playerPeople.find((p) => p && p.id === s.id)?.name || s.name } : s));
    },
    self() {
      let name = '';
      try { name = (whoState && whoState.name) || ''; } catch { name = ''; }
      return { id: screenPersonNow(), name };
    },
    subscribe(fn) {
      const read = () => { try { return JSON.stringify((settings.get() || {})[SCREEN_PLAYERS_KEY] ?? null); } catch { return 'null'; } };
      let sig = read();
      let off = null;
      try {
        off = settings.subscribe?.(() => {
          const now = read();
          if (now === sig) return;
          sig = now;
          try { fn(); } catch (err) { console.error('kiosk: players', err); }
        }) || null;
      } catch { off = null; }
      return () => { try { off?.(); } catch { /* gone */ } };
    },
  };

  // *** WHERE THE PERSON'S HISTORY IS KEPT (row 2.58, 2026-10-07; history_place.js). *** One host per screen: it
  // reads the person's own `history-place` row (lazily - the person is resolved in the background), copies what
  // played to their Nimrod folder or, opted in, to us, and routes game results and board words when the person has
  // moved them off the site's log. Their default is the log, so until somebody chooses, nothing here changes them.
  // No server half on a local backend (the suites, signed out): nothing can be kept with us there.
  const historyHost = createHistoryHost({
    personId: () => screenPersonNow(),
    makePersonState: (pid, key) => (pid && profiles.personStateURL && !makeState
      ? createState({ url: profiles.personStateURL(pid, key), user, cacheKey: `person:${user}:${pid}:${key}`, push })
      : null),
    folder: folderSink(),
    server: !makeState && profiles.personHistoryURL ? serverSink({ urlFor: profiles.personHistoryURL, user }) : null,
  });

  const childCtx = (mod) => ({
    bus, user, profileId,
    // Where this person's history is kept (above): plays.js `panelPlays` copies through it.
    history: historyHost,
    // *** THE SETTINGS PANEL (modules/settings.js) MOUNTS THIS SCREEN'S OWN MENU (2026-10-03). *** Mike: "The
    // settings module should be the same as the settings menu. There shouldn't be 2 different things." A promise
    // of the menu's handle drawn into `host` (`settingsMenuFor`): the same rows, tabs, levels and pages as ⚙.
    settingsMenu: (host, opts = {}) => menuReady.then(() => settingsMenuFor(host, opts || {})),
    // WHOSE SCREEN THIS IS. Resolved in the background below, so it is a FUNCTION rather
    // than a value - a module mounted before the lookup returns would otherwise capture
    // null forever. Bindings have been per-person since the input runtime landed; this is
    // media catching up to the same idea.
    // 2026-10-02: the screen's "person known" answer first (settled from the screen's row before any
    // panel mounts -- see `personKnown`), then the background lookup's.
    get personId() { return personKnown.get().personId || personId || null; },
    // THE ANSWER ITSELF, retained (person_known.js): `get()`, `subscribe(fn)`, `whenSettled()`. A panel
    // that must not use a person before the screen knows (a media list) waits on it; one that draws
    // first follows it. Hosts without it (home.js, the suites' own ctx) are treated as already settled.
    personKnown,
    rootBus: bus, instanceId: mod.id,
    // What a note made in Nimrod's notes says about where it was made (modules/nimrod.js noteContext).
    // `person` (2026-10-07, row 2.54): who this screen is for, when it knows (the people bar's name).
    noteContext: () => {
      let person = null;
      try { person = (whoState && whoState.name) || null; } catch { person = null; }
      return { dashboard: arr.profile()?.name || null, person };
    },
    // The hosting page's word for the person looking (the `personHost` option): embedded only.
    personHost: embedded && personHost && typeof personHost === 'object' ? personHost : null,
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
    // (Built by `callTransportNow`, below: since 2026-10-02 the screen builds it itself the moment the drive
    // socket attaches, so a screen with no Call panel can still ring - call_notice.js.)
    get callTransport() { return callTransportNow(); },
    // The arbiter itself, for a module that MAKES continuous sound - a music bed, a video.
    // A module that only speaks wants `output`; this is for the things that keep playing.
    audio,
    // What hiding a panel does to its sound (hide_sound.js, ad7dc49). A getter: it is built just after the
    // screen's settings row (a later `const`), and a read before then is null, not a ReferenceError.
    get hidePolicy() { try { return hideSound; } catch { return null; } },
    micOwner,
    // WHERE SOMEBODY IS POINTING, for a module that wants a position rather than a verb -
    // `comet.js` is the reason it exists. A getter for the same reason `output` is: the input
    // runtime is built further down, and a module mounted before it would capture undefined
    // forever. Modules read the aim off the BUS; this handle is only for `latest()`, so a
    // panel mounted mid-session can start under her hand instead of blank.
    get aim() { return runtime?.aim || null; },
    cameraOwner,
    automation,
    // THE SCREEN'S FLASH LIMIT (flash_limit.js `flashLimit(ctx)`): a getter, so a module that reads it
    // when it needs it follows a changed setting. No limit unless somebody (or the starting-defaults
    // layer) chose one (8a89e31).
    get flashLimitPerSecond() { return flashLimitNow(); },
    // THE AVATARS' CONTEXT (avatarContextNow above): a module that draws people's faces (the call tile)
    // hands this to its avatar cache, so faces moving, the flash limit and "other people's avatars" reach it.
    avatarContext: () => avatarContextNow(),
    // The voice recordings this screen keeps (modules/voice_review.js): the recorder's own store, so the
    // review panel sees what was just kept, and the person's row for its retention wording.
    get voiceStore() { return voiceStore; },
    personRow: () => personRow,
    // "Your own voice model" (the Voice model module, modules/voice_model.js, 2026-10-04): the screen's recorder,
    // so reading phrases arms it, and a writer for ONLY that person's own voice-model rows - the panel can
    // flip "Use my own voice model" and set its port, and nothing else on the row.
    get voiceRecorder() { return voiceRec; },
    // WHO IS TALKING (row 2.56): the recogniser's voice seam (speech_engines.js makeVoiceId) - so a module can set
    // up or forget a voice, and list who is set up here (names, never numbers). null while nothing listens.
    get voiceId() { return speechRec?.voiceId || null; },
    saveVoiceModel: (patch) => {
      const keys = new Set(VOICE_MODEL_FIELDS.map((f) => f.key));
      const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => keys.has(k)));
      if (!personInputs?.set || !Object.keys(clean).length) return false;
      try { personInputs.set(clean); return true; } catch (err) { console.error('kiosk: voice model setting', err); return false; }
    },
    ...(sources ? { sources } : {}),
    makeState: (key, opts) => stateFor(key, opts),
    // The shared game-results stream goes through the history host (history_place.js `route`): on the site's log as
    // always unless the person chose another place for game results. Every other stream is untouched.
    makeEvents: (key, opts) => (key === GAMEPLAY_STREAM
      ? historyHost.route('games', eventsFor(key, opts), { key: profileId })
      : eventsFor(key, opts)),
    // *** REVIEW BY PLAYING (pack_reviews.js). *** The ACCOUNT's review log - not this screen's, not the
    // person's: a question passed on a phone counts on every screen of the account - plus the packs waiting
    // for review. A local backend (the suites, signed out) keeps the log in its own store under `_account`.
    // `lazy`: a pack is fetched when something here plays from it, not every pack for every panel (pack_reviews.js).
    makePackReviews: () => createPackReviews({
      events: makeEvents ? makeEvents('question-reviews', { pollMs: 30000 }, '_account') : null,
      user, push, bus, pollMs: 30000, lazy: true,
    }),
    // *** THE MODULES LIBRARY AS A PANEL OF ITS OWN (2026-10-02, modules/library.js). *** A function of the
    // instance id, not a value bound to `mod`: a dashboard module hands its children THIS ctx (extended), so a
    // library inside it asks with its own id. Picking there turns that panel into the pick, in its place.
    libraryHost: (instanceId) => libraryHostFor(instanceId),
    // "How you choose things" (6fd7575): 'point' or 'step', read when asked (a module mounted at boot, before
    // the menu below exists, gets the default rather than a ReferenceError).
    chooseMode: () => { try { return chooseModeNow(); } catch { return chooseModeOf(null); } },
    // A SCREEN, OR A PAGE SHOWING ONE (2026-10-02, profile.js): true on a real screen, false when this kiosk is
    // embedded in another page (Home, the modules page). "A screen never places a call" reads this first.
    isScreen: !embedded,
    // How long after the last press a game stops counting as being played (game_start.js gameIdleMsOf; a suite's seam).
    ...(Number.isFinite(gameIdleMs) && gameIdleMs > 0 ? { gameIdleMs } : {}),
    // HOW MANY PANELS SHARE THIS PANEL'S DASHBOARD (game_start.js `panelAlone`: "when it is the only thing on
    // the dashboard"), or null when this panel is not one of the showing dashboard's (a nested one, a library).
    // A getter, read when asked; `this.instanceId` so a ctx extended for a dashboard's child asks about the child.
    get panelCount() {
      try {
        const id = (this && this.instanceId) || mod.id;
        const recs = menuPanelRecs();
        return recs.some((r) => r && r.id === id) ? recs.length : null;
      } catch { return null; }
    },
    // *** ROW 2.38: A DASHBOARD PLACED ON THIS SCREEN SHOWS ANOTHER ONE (modules/view.js). *** It is one
    // level deep (`nestDepth`; the screen's own dashboard is built with 0, `buildDashboard`), it opens ITS
    // dashboard's rows with these UNSCOPED makers (`makeState` above is bound to the screen showing), and
    // how many levels move live is the screen's setting (dashboard_nest.js argues the default). Arrows and
    // a getter: `stateForProfile` and `settings` are declared further down.
    nestDepth: 1,
    profiles,                 // the screens client: a nested dashboard reads the record of the one it shows
    nestMakeState: (key, opts, pid) => stateForProfile(key, opts, pid),
    nestMakeEvents: (key, opts, pid) => eventsForProfile(key, opts, pid),
    nestLiveDepth: () => { try { return nestLiveDepthFrom(settings.get() || {}); } catch { return undefined; } },
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
    // players (2026-10-06): WHO IS PLAYING ON THIS SCREEN (the ⚙ menu's Players tab; player_picker.js). A game whose own
    // "Players" says "This screen's players" reads these. `seats()`: in turn order, a person's name as this login
    // knows them now; empty is the screen's person alone. `self()`: the screen's person. `subscribe(fn)`: told when
    // the seats change.
    screenPlayers: screenPlayersHost,
  });

  // *** "EVERY <MODULE> PANEL": THE MODULE LEVEL OF THE CHAIN (2026-10-02; settings.js "LEVELS"). ***
  // A value set for every panel of one kind, kept on THIS SCREEN's row under `moduleDefaults: { type: {...} }`.
  // A panel that has not set a key itself reads the kind's value: its state handle is LAYERED
  // (`withTypeLayer`), so the module needs no change -- it reads `ctx.state.get()` as it always has. A
  // panel's own value always wins; setting it back to null ("follow") hands it back to the kind.
  //   WHY THE SCREEN'S ROW, argued: FOR the person's (every Photos panel they ever see), a caregiver tuning
  //   one screen would change another screen in another room. FOR the screen's (chosen): the chain puts the
  //   module level ABOVE the screen's in specificity, and the row it is kept on is the one the screen
  //   already owns -- nothing new to store. A person-wide version is a later level, on Mike's list.
  // Nothing has a kind's value until somebody sets one, so every screen today reads exactly as it did.
  const MODULE_DEFAULTS_KEY = 'moduleDefaults';
  const isSetValue = (v) => v !== undefined && v !== null;
  function typeDefaults(type) {
    let all;
    try { all = (settings.get() || {})[MODULE_DEFAULTS_KEY]; } catch { all = null; }
    const t = all && typeof all === 'object' ? all[type] : null;
    return t && typeof t === 'object' && !Array.isArray(t) ? t : null;
  }
  function writeTypeDefault(type, key, value) {
    const all = { ...((settings.get() || {})[MODULE_DEFAULTS_KEY] || {}) };
    const cur = { ...(all[type] || {}) };
    if (isSetValue(value)) cur[key] = value; else delete cur[key];
    if (Object.keys(cur).length) all[type] = cur; else delete all[type];
    settings.set({ [MODULE_DEFAULTS_KEY]: all });
  }
  function withTypeLayer(base, type) {
    if (!base || typeof base.get !== 'function') return base;
    const merged = () => {
      const own = base.get() || {};
      const t = typeDefaults(type);
      if (!t) return own;
      const out = { ...own };
      for (const [k, v] of Object.entries(t)) if (!isSetValue(own[k]) && isSetValue(v)) out[k] = v;
      return out;
    };
    const subs = new Set();
    let typeSig = JSON.stringify(typeDefaults(type));
    const offSettings = settings.subscribe?.(() => {
      const sig = JSON.stringify(typeDefaults(type));
      if (sig === typeSig) return;
      typeSig = sig;
      const row = merged();
      for (const fn of [...subs]) { try { fn(row); } catch (err) { console.error('kiosk: a panel subscriber', err); } }
    }) || null;
    // ONLY `get` / `subscribe` / `destroy` change, and `own()` is added: the menu's "Following: every
    // <module> panel" needs to know what the panel set itself. Everything else is the handle's own (an
    // own-property copy, which is also what automation.wrapState makes of it).
    return Object.assign({}, base, {
      get: merged,
      own: () => base.get() || {},
      subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        subs.add(fn);
        const off = base.subscribe?.(() => fn(merged()));
        return () => { subs.delete(fn); try { off?.(); } catch { /* gone */ } };
      },
      destroy() {
        subs.clear();
        try { offSettings?.(); } catch { /* gone */ }
        return base.destroy?.();
      },
    });
  }

  async function mountInstance(mod, host) {
    // `stateKey` (2026-10-02, "Switch module"): a panel switched to another type keeps the SAME instance
    // id (its place, its chip, its focus) but reads and writes ITS OWN row for that type, so the new
    // type starts fresh and the old one's settings are still there when it is switched back
    // (arrangement.js `switchPanel`).
    const rowKey = mod.stateKey || mod.id;
    const state = automation.wrapState(mod.id, withTypeLayer(stateFor(rowKey), mod.type), { manifest: getManifest(mod.type) });
    // The talk board's words go through the history host too (history_place.js `route`, kind `select` only): the
    // site's log as always unless the person chose another place for them.
    const events = mod.type === 'board'
      ? historyHost.route('words', eventsFor(rowKey), { key: rowKey })
      : eventsFor(rowKey);
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
    // THIS PANEL'S OWN SOUND (panel_sound.js, 2026-10-02): its volume, "sound like it's in the room", and on
    // a TV the things on it - kept on the same row, applied to the bus here, cleared when it goes.
    const offSound = watchPanelSound(audio, mod.id, state);
    // THIS PANEL'S DRIVEN SIZE, TURN, COLOUR AND MOVE (panel_drive.js, row 2.62): only ever set by an automation
    // rule (an overlay on the wrapped `state`), applied to this panel's box on top of wherever it was placed.
    const offDrive = watchPanelDrive(host, state);
    instance.init();
    state.startPolling(); events.startPolling();
    return { instance, state, events, type: mod.type, id: mod.id, title: instance.manifest.title, el: host, offSound, offDrive,
      ...(mod.stateKey ? { stateKey: mod.stateKey } : {}) };
  }
  function destroyRec(rec) {
    if (!rec) return;
    try { rec.instance.destroy(); } catch { /* noop */ }
    try { rec.offSound?.(); } catch { /* noop */ }
    try { rec.offDrive?.(); } catch { /* noop */ }
    rec.state.destroy?.(); rec.events.destroy?.();
  }

  // ---- per-profile settings: theme + the kiosk LAYOUT (data-driven) --------
  // (2026-10-04: a refused write is MERGED, not rebased wholesale -- doc_merge.js; the same as a swapped-in
  // screen's doc, `swapDoc` below. The whole arrangement is one key, `kiosk`, so the ordinary rebase laid this
  // screen's whole copy over another device's change. A change made here that gave way is said once.)
  // Which value stands when this screen and another device changed the SAME thing at once: 'theirs' (the
  // other device's, already accepted by the server; the screen says so) or 'mine'. Argued in doc_merge.js:
  // the edit that gives way must be the one whose author can be told, and only this screen can tell anyone.
  // Used for this doc, a swapped-in screen's, and a dashboard's own (handed to view.js as `ctx.conflictPrefer`).
  const CONFLICT_PREFER = 'theirs';
  const settings = stateFor('settings', {
    merge: (b, m, t) => mergeSettingsDoc(b, m, t, { prefer: CONFLICT_PREFER }),
    onLost: (lost) => sayLostEdit(bootProfileId, lost),
  });
  // HIDE = MUTE (ad7dc49): what hiding a sound-making panel does, asked once and remembered (choices row).
  // (The choices row is loaded in the background and closed on teardown: a handle never loaded reads
  // empty forever and writes against version 0.)
  const choicesState = stateFor('choices');
  choicesState.load().catch(() => {});
  const hideSound = createHideSound({
    memory: createChoiceMemory(choicesState),
    host: () => root,
    askTimeoutMs: () => (settings.get() || {}).hideAskTimeoutMs,
    // "Pause it" pauses a module that answers the pause verb (2026-10-02), sent to that panel on this bus.
    bus,
  });
  // The flash limit reads the screen's row from here on (see `flashLimitNow`).
  screenRowNow = () => settings.get() || {};
  settings.subscribe((s) => { try { automation.load(s?.automations || []); } catch (err) { console.error('kiosk: automations', err); } });
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
  // *** THE SWAPPED-IN SCREEN'S OWN SETTINGS DOC (2026-10-02; Mike's list 09-30 ~1324: "room edits on a
  // swapped-in screen apply but aren't saved"). *** On this file's own path (`showScreen`, not the dashboard
  // module's), a swap used to read the incoming screen's layout and close its doc at once, so an edit to that
  // screen's room had nowhere to be written. The doc is now KEPT OPEN while that screen shows -- `{ id, doc }`,
  // closed by the next swap, by going home, and on teardown -- and the room's edits are saved to it, the
  // same way the boot screen's are saved to `settings`. Its lock list (`lockedIdsNow`) is read from it too.
  // CLOSED ONLY AFTER ITS LAST WRITE HAS GONE: state.js `destroy()` cancels a write still waiting out its
  // debounce, so a room edit made just before swapping away would otherwise be lost (found by kiosk_test).
  //
  // *** AND IT IS SYNCED LIKE ANY OTHER DOC (2026-10-04; the gap d377083 left: "an edit made on another device
  // while that screen shows could be overwritten"). *** It used to be opened, read once and written blind:
  //   * it now POLLS (and hears push), so a change made elsewhere -- Mike on his phone, in Home -- reaches the
  //     screen while it shows: a door or a placement in place, a look or a Room row by drawing the room again,
  //     anything else by rebuilding the arrangement in place (`applySwapLayout`; never a reload, which would
  //     land on the boot screen). `shown` is the layout as saved that the screen is showing, so the doc's own
  //     echo of an edit made here is recognised and not applied twice;
  //   * a write still carries its version, so a stale one is refused (409) -- and the refusal is MERGED, not
  //     rebased wholesale (doc_merge.js `mergeSettingsDoc`): the whole arrangement is one key (`kiosk`), so
  //     state.js's ordinary rebase would have laid this screen's whole copy over the other device's change.
  //     A door here and a look there both stay; the same thing changed both ways keeps the other device's
  //     value, and the screen says so in one quiet line (`sayLostEdit`). The policy is argued in doc_merge.js.
  // (Which value stands in a true clash: `CONFLICT_PREFER`, beside `settings` above.)
  let swapDoc = null;                     // { id, doc, shown, off }
  const swapDocNow = () => (swapDoc && swapDoc.id === profileId ? swapDoc.doc : null);
  function closeSwapDoc(rec) {
    if (!rec || !rec.doc) return;
    try { rec.off?.(); } catch { /* already gone */ }
    rec.off = null;
    const doc = rec.doc;
    let p = null;
    try { p = doc.flush?.(); } catch { p = null; }
    Promise.resolve(p).catch(() => { /* offline: nothing more to do */ })
      .finally(() => { try { doc.destroy(); } catch { /* already gone */ } });
  }
  // 2026-10-02, edit mode on the dashboard's room (arrangement.js ROOM_PANEL_ID): where a door or a Room
  // row it changes is saved -- this screen's own layout, the doc the edit view saves to.
  // The 09-12 watch is TOLD first, so a room the arrangement redraws itself is never reloaded under the
  // person editing it. (2026-10-02, later: on a SWAPPED-IN screen, that screen's own doc -- `swapDoc`
  // above. A preview layout belongs to the screen it was handed to and never follows a swap, so it only
  // stops the boot screen's save. The swapped doc's watch is told through `shown`, 2026-10-04.)
  // (Named, 2026-10-04, so the suites can drive the save the arrangement makes: `layoutStore` on the handle.)
  const ownLayoutStore = {
      get: () => {
        if (profileId === bootProfileId) return ((settings.get() || {}).kiosk || {}).layout || null;
        const d = swapDocNow();
        return d ? ((d.get() || {}).kiosk || {}).layout || null : null;
      },
      save: (next, base) => {
        if (embedded) return;
        if (profileId !== bootProfileId) {
          const d = swapDocNow();
          if (!d) return;
          const was = (d.get() || {}).kiosk || {};
          swapDoc.shown = next ?? null;     // already on the screen: the doc's echo is not applied again
          // 2026-10-04: the change waited on the screen before saving, and the doc moved on meanwhile (another
          // device, heard by the poll): merged onto it, never laid over it -- the same rule as a refused write.
          // The doc's echo then carries the merge to the screen (`applySwapLayout`).
          const m = mergeLayoutSave(base, next, was.layout ?? null, { prefer: CONFLICT_PREFER });
          if (m.lost.length) sayLostEdit(swapDoc.id, m.lost);
          d.set({ kiosk: { ...was, layout: m.layout } });
          return;
        }
        if (previewLayout) return;
        // *** THE BOOT SCREEN'S DOC, THE SAME RULE (2026-10-04, the window 2769509 left). *** A change heard by the
        // poll while this edit was still drawing is merged, not laid over (`mergeLayoutSave`): the write carries a
        // current version, so the server would have taken this stale copy as it stood.
        // THE 09-12 WATCH IS TOLD THE MERGED LAYOUT, not `next`: that is what the doc will hold, so it is noted and
        // never a reload. It already moved the other device's change onto the screen if it could (a placement or a
        // door, in place) -- but the edit's own redraw may have drawn over it since, so the screen is brought from
        // `next` (what the edit drew) to the merge here, the least disruptive way (`applySaved`), else rebuilt in
        // place as a swapped-in screen's is (`applySwapLayout`). Never a reload under the person editing.
        const cur = (settings.get() || {}).kiosk || {};
        const m = mergeLayoutSave(base, next, cur.layout ?? null, { prefer: CONFLICT_PREFER });
        expectLayoutSig = JSON.stringify(m.layout ?? null);
        settings.set({ kiosk: { ...cur, layout: m.layout } });
        if (m.lost.length) sayLostEdit(bootProfileId, m.lost);
        if (m.merged && JSON.stringify(m.layout ?? null) !== JSON.stringify(next ?? null)) {
          Promise.resolve().then(async () => {
            if (torn || profileId !== bootProfileId) return;
            let r = null;
            try { r = await ownArr.applySaved(next, m.layout); } catch (err) { console.error('kiosk: applying a merged layout', err); r = null; }
            if ((r && r.applied) || torn || profileId !== bootProfileId) return;
            arr.resolve(m.layout ?? undefined);
            await applyModules();
          }).catch((err) => console.error('kiosk: a merged layout', err));
        }
      },
  };
  const ownArr = createArrangement({
    bus, user, storage, embedded, settings,
    kioskEl, stageEl, mirrorEl, clockEl, ambientEl,
    mountInstance, destroyRec, watchRec, renderMods,
    runtime: () => runtime,
    health: () => health,
    profileId: () => profileId,
    flashLimit: flashLimitNow,
    layoutStore: ownLayoutStore,          // (above)
    listDashboards: () => listDashboards(),
    // Row 2.62 step 4: the room's own objects, drivable by this screen's automation rules (room_drive.js).
    driveRoom: (id, handle, fields) => automation.wrapState(id, handle, { fields }),
  });
  // *** WHICH ARRANGEMENT THE SHELL IS READING (step 6 Stage 3). *** Normally this file's own. With
  // `dashboardModule` on (embedded only), the panels are mounted by a dashboard MODULE, and the bar,
  // the menu, focus and recovery's hands must all be about ITS panels -- so every read below goes
  // through `arr`, which forwards to the dashboard's arrangement once it exists and to this file's own
  // otherwise. Same functions (arrangement.js) either way: nothing is reshaped between the two.
  // On an embed the mirror/clock corner functions are NOT forwarded: they are screen settings applied to
  // `.kiosk`, and the dashboard applies the same settings doc to its own root itself.
  //
  // *** STAGE 4: ON A REAL SCREEN THE CORNERS FOLLOW THE DASHBOARD (the plan's Q2, recommended). *** A
  // swap brings in another screen's settings doc, and its own mirror/clock corners with it. So there,
  // the corner keys ([ ] \) move the SHOWING dashboard's (they write its doc, through its arrangement),
  // and `.kiosk` carries no corner of its own: both roots carrying different corners puts top AND bottom
  // on one mirror (the `.kiosk[...]` and `.view[...]` rules in kiosk.css are equally specific), which
  // stretches it down the screen. If the dashboard failed and this file's own arrangement is showing the
  // panels, `.kiosk` is where they are, and it carries them exactly as it always did.
  let dash = null;                         // the mounted dashboard module, when there is one
  let dashHost = null;                     // ...and the element it is mounted into
  const arrNow = () => dash?.impl?.arrangement?.() || ownArr;
  const CORNER_KEYS = ['mirrorSize', 'mirrorCorner', 'clockCorner'];
  const cornersFollowDash = () => useDashboard && !embedded && !!dash;
  function applyCorners(s) {
    if (cornersFollowDash()) { for (const k of CORNER_KEYS) delete kioskEl.dataset[k]; return; }
    ownArr.applyLayout(s);
  }
  const CORNER_FNS = new Set(['patchMirror', 'patchClock', 'cycleMirrorSize', 'cycleMirrorCorner']);
  const arr = {};
  for (const k of Object.keys(ownArr)) {
    if (typeof ownArr[k] === 'function') {
      arr[k] = k === 'applyLayout' ? applyCorners
        : CORNER_FNS.has(k) ? (...a) => (cornersFollowDash() ? arrNow() : ownArr)[k](...a)
          : (...a) => arrNow()[k](...a);
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
  // *** (2026-10-07) THE DEFAULT IS NOW `clear`. *** Mike: "The default should be transparent background on panels."
  // A screen, a dashboard, a device and a person that never picked get clear panels; anything saved stays as saved.
  // FOR clear over see-through: it is the word he used, and on a still theme the words sit on the theme's own page
  // colour, which every theme already guarantees they read on. AGAINST: over a moving scene a clear panel has only
  // the halo between its words and the scene, where see-through (Classic 2D's) keeps a tint behind them. The halo is
  // now derived per theme (theme.js `panelHalo`), so the still themes no longer smudge; "See-through" is one press.
  const PANEL_SURFACES = ['solid', 'veil', 'clear'];
  const PANEL_SURFACE_DEFAULT = 'clear';
  // THIS DEVICE's settings row (settings.js `createLocalRow`: this browser's storage, nothing leaves it) --
  // the `device` level of the chain (`levelLayers` below). Not on an embed. A change made here (the menu's
  // "Settings for: This device") is seen at once: the theme and the backgrounds re-resolve.
  const deviceRow = embedded ? null : (() => {
    try { return createLocalRow(storage ? { storage } : {}); } catch { return null; }
  })();
  let offDeviceRow = null;
  // ROW 2.34: on a real screen's dashboard path the panel backgrounds are the SHOWING dashboard's, like its
  // theme (`shownTheme` below): the ready-made Basic is solid and Classic 2D see-through, and each keeps its
  // own when you swap between them. A dashboard that never picked keeps the screen's own row (the theme's
  // rule, for the theme's reason). Everywhere else it is the screen's row, as it always was. `s` is accepted
  // and ignored on the dashboard path, so every existing caller is unchanged.
  // *** 2026-10-02: AND BEYOND THE SCREEN, THE REST OF THE CHAIN (settings.js "LEVELS"). *** A screen that
  // never picked follows THIS DEVICE, then THE PERSON it is for -- the order DECISIONS.md 2026-09-30 gives
  // ("instance, module, screen/dashboard, device, person, account ... the nearest one set wins"). Nothing
  // stores an account level yet, so the chain stops at the person. A device or a person that never picked
  // either changes nothing: every screen today looks exactly as it did. Not on an embed (a preview on
  // somebody's page has no device or person of its own here).
  function shownPanelSurface(s) {
    const L = levelLayers();
    if (s && typeof s === 'object') L.screen = s;
    for (const lv of ['dashboard', 'screen', 'device', 'person']) {
      const v = L[lv] && L[lv].panelSurface;
      if (PANEL_SURFACES.includes(v)) return v;
    }
    return PANEL_SURFACES.includes(s && s.panelSurface) ? s.panelSurface : PANEL_SURFACE_DEFAULT;
  }
  function applyPanelSurface(s) {
    const v = shownPanelSurface(s);
    kioskEl.dataset.panelSurface = PANEL_SURFACES.includes(v) ? v : PANEL_SURFACE_DEFAULT;
    // The space between panels rides with the backgrounds: the same chain, the same callers (every place
    // that re-applies the look after a swap or a change calls this).
    const g = shownPanelGap(s);
    kioskEl.dataset.panelGap = PANEL_GAPS.includes(g) ? g : PANEL_GAP_DEFAULT;
  }
  // *** SPACE BETWEEN PANELS (Mike, 2026-10-02 evening: "Why are there always gaps between the modules? Can't
  // they each take up a quarter?"). *** `panelGap`: 'none' (the default: the panels meet, each exactly its share
  // of the stage, a hairline between), 'thin', 'roomy' (the look before this). kiosk.css draws all three and
  // argues them. Resolved like the panel backgrounds -- the showing dashboard, the screen, this device, the
  // person -- because it is the same kind of thing: how the panels sit on this screen.
  function shownPanelGap(s) {
    const L = levelLayers();
    if (s && typeof s === 'object') L.screen = s;
    for (const lv of ['dashboard', 'screen', 'device', 'person']) {
      const v = L[lv] && L[lv].panelGap;
      if (PANEL_GAPS.includes(v)) return v;
    }
    return PANEL_GAP_DEFAULT;
  }
  // *** STAGE 4: THE THEME IS THE SHOWING DASHBOARD'S (row 2.34, ruled; the plan's R3). *** On a real
  // screen on the dashboard path, a swap brings in another dashboard and its own Colours; going back
  // brings the first one's back. A dashboard that never picked any keeps the screen's own (the boot
  // row's) rather than dropping to the default mid-swap -- a guess, on Mike's list: FOR, a call screen
  // nobody themed does not flash to another palette; AGAINST, "per dashboard" then means "per dashboard,
  // unless unset". Everywhere else (an embed, the classic path, a failed dashboard) it is the screen's
  // row, exactly as before. The menu's Colours row writes where this reads (`themeDoc`).
  // (2026-10-07) NOBODY PICKED AT ANY LEVEL: "Best for this device" (theme_default.js) -- a moving theme where this
  // device looks able and nothing asks for less movement, the Nimrod theme everywhere else. Not on an embed: an embed
  // that never picked keeps the page around it (`applyKioskTheme` below).
  function shownTheme() {
    const v = resolveLevel('theme', levelLayers(), { from: 'dashboard', order: LEVEL_ORDER }).value;
    return v ?? (embedded ? undefined : DEVICE_THEME);
  }
  function themeDoc() {
    if (!useDashboard || embedded || !dash) return settings;
    try { return dash.impl.settingsDoc?.() || settings; } catch { return settings; }
  }
  // *** THE LEVELS THIS SCREEN HAS, AND THEIR ROWS (2026-10-02; settings.js "LEVELS"). ***
  //   dashboard  the SHOWING dashboard's own row -- only when it is not this screen's (a swap on the
  //              dashboard path); on the screen it booted on, the dashboard IS the screen, one row.
  //   screen     this screen's row (`settings`), as ever.
  //   device     this browser's own row (`deviceRow`): what this device shows whoever's screen it opens.
  //   person     the row of the person this screen is for (`personRow`), once known.
  //   account    NOT OFFERED: nothing stores a per-account settings row yet (profile.js has screens and
  //              people, no account row), and a level that saves nowhere is a level that lies. On Mike's list.
  // The theme and the panel backgrounds are resolved through this chain (shownTheme / shownPanelSurface);
  // the menu's "Settings for" steps through them (`levelSubjects`).
  const dashDistinct = () => {
    if (!useDashboard || embedded || !dash) return false;
    try { const d = dash.impl.settingsDoc?.(); return !!d && d !== settings; } catch { return false; }
  };
  function levelLayers() {
    const L = {};
    if (dashDistinct()) { try { L.dashboard = dash.impl.settings?.() || {}; } catch { L.dashboard = {}; } }
    L.screen = settings.get() || {};
    if (deviceRow) L.device = deviceRow.get();
    if (!embedded && personRow) L.person = personRow;
    return L;
  }
  function levelsHere() {
    return [...(dashDistinct() ? ['dashboard'] : []), 'screen', ...(deviceRow ? ['device'] : []),
      ...(!embedded && personInputs && personRow ? ['person'] : [])];
  }
  function syncShownTheme() {
    // The panel backgrounds follow with the theme (row 2.34): every caller of this is a swap or a change
    // to the showing dashboard's own settings.
    applyPanelSurface(settings.get());
    const id = shownTheme();
    if (id === lastShownTheme) return;
    lastShownTheme = id;
    applyKioskTheme(id);
  }
  await settings.load().catch(() => {});
  // USER FOLDERS: this device's fonts from wherever its fonts folder is now (the Nimrod folder's fonts/,
  // or one chosen just for fonts), and a colour look whose .cube is gone goes back to None. NEVER
  // PROMPTS, and fire-and-forget: it must not delay or break the boot.
  (async () => {
    try {
      if (!torn) await loadDeviceFonts();
      if (!torn) await checkDeviceLook();
    } catch (err) { console.error('kiosk: user folders', err); }
  })();
  // STAGE 4: a real screen's path, from its own row (see `dashboardPathFor`). Read once, at boot: the
  // two paths build different things, so a change to the row is applied by a reload (the watch below).
  const bootDashboardPath = embedded ? null : dashboardPathFor(settings.get(), dashboardDefault);
  if (!embedded) useDashboard = bootDashboardPath;
  // THE MASTER AND THE MIXER, on the screen's settings row. Attached before the first theme is applied
  // so the scene reaches the mixer, and before the subscribe below so its first replay syncs them.
  // Each is guarded: a sound control that throws must never stop the screen coming up.
  const readScreen = () => settings.get() || {};
  const writeScreen = (patch) => settings.set(patch);
  try { master = attachMasterVolume({ bus, audio, read: readScreen, write: writeScreen }); }
  catch (err) { console.error('kiosk: master volume', err); master = null; }
  try { mixer = attachMixer({ audio, fx: fxLazy, read: readScreen, write: writeScreen }); }
  catch (err) { console.error('kiosk: mixer', err); mixer = null; }
  // "BEST FOR THIS DEVICE" (2026-10-07, theme_default.js) asks this screen what the browser cannot know: its motion
  // settings and flash limit (the faces' own context, avatarContextNow) and its "3D detail" row. Not from an embed:
  // the hints are the page's, and an embed is a guest on somebody else's.
  if (!embedded) {
    try {
      setDeviceHints({ motion: () => avatarContextNow(),
        detail: () => (settings.get() || {})[DETAIL_FIELD.key] || deviceRow?.get?.()?.[DETAIL_FIELD.key] || 'auto' });
    } catch (err) { console.error('kiosk: device hints', err); }
  }
  applyKioskTheme(shownTheme());
  // ...and the one measurement after the first look (theme_default.js `settleStartingTheme`): the battery, and the
  // frames with the moving default up, the first time this device shows it. Only ever moves DOWN to Nimrod, and only
  // while nobody has picked a theme (still "Best for this device" when it lands).
  let deviceSettle = null;
  if (!embedded && isDeviceTheme(shownTheme())) {
    try {
      deviceSettle = settleStartingTheme({ storage: storage || undefined, onChange: () => {
        if (torn || !isDeviceTheme(shownTheme())) return;
        applyKioskTheme(shownTheme(), { fade: true });
        try { if (menu?.isOpen?.()) menu.refresh(); } catch { /* no menu yet */ }
      } });
    } catch (err) { console.error('kiosk: device theme', err); }
  }
  // SEASONS AND THE SKY (2026-10-05; sky.js): the time of day, and the weather from a Weather panel on this
  // screen, reach the theme's scene; "With the seasons" turns over by itself (a new day, a holiday starting).
  // After the first theme, so the first sky lands on a scene that is there. Guarded: it must never stop the
  // screen coming up. Reads (and follows) the screen's row for its two settings.
  let skyFollow = null;
  // (seasons, 2026-10-05) A change of look the DATE brings waits for a calm moment (Design's decision 3: not
  // mid-call, mid-game). `seasonCalm` is the version watch's hold list once it exists ("PICKING UP A NEW
  // VERSION" below sets it): the same answer to "would changing the screen now take something from somebody".
  // Before then, or with no version watch (an embed), always calm.
  let seasonCalm = null;
  try {
    skyFollow = followSky({ bus, read: readScreen, subscribe: (fn) => settings.subscribe(fn),
      calm: () => { try { return !seasonCalm || seasonCalm() == null; } catch { return true; } },
      onTheme: (o) => { if (!torn && isFollowTheme(lastShownTheme)) applyKioskTheme(lastShownTheme, { fade: !!o?.fade }); } });
  } catch (err) { console.error('kiosk: the sky', err); }
  applyLayout(settings.get());
  applyPanelSurface(settings.get());
  // The device level changed (the menu's "This device" rows): the chain re-resolves now.
  offDeviceRow = deviceRow?.subscribe?.(() => { if (!torn) syncShownTheme(); }) || null;
  // ZOOM ON FOCUS (row 2.37 item 6): the focused panel grows a little. Off unless the screen's row says.
  applyZoomFocus(kioskEl, settings.get()?.zoomFocus);
  // The listening cue starts on its defaults (the visual cue on, the tone off, duck): the person's own
  // row replaces them once whoever this screen is for has been resolved (below).
  attachListen({});
  settings.subscribe((s) => {
    applyKioskTheme(shownTheme());
    applyLayout(s);
    applyPanelSurface(s);
    try { applyZoomFocus(kioskEl, s?.zoomFocus); } catch (err) { console.error('kiosk: zoom on focus', err); }
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
  // A layout THIS FILE wrote from the menu's Layout list and applies in place (`applyLayoutPreset`): the
  // 09-12 watch below notes it rather than reloading. Declared here, before the watch can ever run.
  let expectLayoutSig = null;

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
      // 2026-10-02: a layout THIS FILE just wrote from the menu's Layout list, and applies in place itself
      // (`applyLayoutPreset`) -- noted, never a reload under the person who picked it.
      if (expectLayoutSig !== null && JSON.stringify(now) === expectLayoutSig) {
        expectLayoutSig = null; mountedLayout = now; return;
      }
      // STAGE 4: on the dashboard path, while ANOTHER dashboard is showing (a swap), the boot screen's
      // arrangement is not on screen to correct -- and coming back mounts it fresh from this very doc
      // (`showScreen`). So the change is only noted, never applied to whatever IS showing, and never a
      // reload under somebody's call.
      // (2026-10-04: on this file's own path too. There a placement change to the BOOT screen was applied to
      // the swapped-in screen's arrangement, and any other change reloaded the page out of the swap. Coming
      // back reads the boot screen's doc afresh (`showScreen`), so noting it is enough.)
      if (profileId !== bootProfileId) { mountedLayout = now; return; }
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
  // STAGE 4: THE PATH ITSELF CHANGED on this screen's row (the menu's row, another device, a script):
  // the two paths build different things, so it is applied the way a corrected arrangement is -- one
  // reload, latched. The subscribe's immediate replay is the boot value, so it never fires at boot.
  if (!embedded) {
    let reloadedForPath = false;
    settings.subscribe((s) => {
      if (reloadedForPath || torn) return;
      if (dashboardPathFor(s, dashboardDefault) === bootDashboardPath) return;
      reloadedForPath = true; reloadPage();
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
  // WHOSE SCREEN, KNOWN BEFORE THE FIRST PANEL MOUNTS (see `personKnown`): this row names the person.
  try {
    const pidFromRow = arr.profile()?.person_id || null;
    personKnown.settle(pidFromRow, pidFromRow ? 'screen-row' : 'none');
  } catch (err) { console.error('kiosk: person from the screen row', err); }

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
    // (2026-10-02: with the scan on a PIECE of the room, no panel's chip is lit -- the piece has one of its
    // own, lit, saying its name, and Back / Next dim. transport_bar.js does both, for both bars.)
    const piece = focusedPiece();
    drawChips(modsEl, barModel(arr, runtime, { audio }));
    try { paintPieceInert(controlsEl, piece); } catch { /* not drawn yet */ }
    // Switch module: dimmed with no panel to switch (D16: never hidden) -- and while a piece of the room is
    // selected, since a piece is not a panel; its title says which. A LOCKED panel's stays pressable and
    // says so (`lockedNow`: the press explains where the key is).
    const sw = controlsEl?.querySelector?.('[data-act="switch"]');
    if (sw) {
      let rec = null;
      try { rec = arr.focusedRec(); } catch { rec = null; }
      sw.disabled = !rec || !!piece;
      let locked = false;
      try { locked = !piece && !!rec && lockedNow(rec.id); } catch { locked = false; }
      sw.title = piece ? PIECE_SWITCH_TITLE(piece.label)
        : locked ? `${rec.title || rec.type} is locked on this dashboard (Unlock is on Home, under Change)`
          : 'switch the selected panel to another module';      // the markup's own title
    }
    // The Modules library standing in a panel's place goes with that panel: a rebuilt arrangement (a swap,
    // a new layout) has new boxes, and a library beside a box that is gone stands in for nothing.
    try { if (libOpen && (!libOpen.host.isConnected || !libOpen.slot.isConnected)) closeLibrary('gone'); } catch { /* declared later */ }
    // Pause / Play follows the selected panel (2026-10-02). Declared further down; harmless before then.
    try { syncPlayPause(); } catch { /* not built yet */ }
  }

  // *** WHAT IS SELECTED, WHEN IT MAY BE A PIECE OF THE ROOM (2026-10-02; Mike's list 09-30 ~1341). ***
  // arrangement.js `focusedTarget()` describes the stop the scan is on -- a panel, or a piece of the
  // dashboard's room -- and argues why `focusedRec()` keeps meaning "the panel" rather than changing. Here:
  //   DESCRIBING the selection (the bar's lit chip, the menu's "Settings for", the cat, the controls page)
  //   reads `focusedTargetNow()`, so a piece is named as itself;
  //   ACTING on "the selected panel" (Next, Back, Pause, bigger, Switch module with no panel named) reads
  //   `panelSubject()`: the focused panel, or NONE while a piece is selected. A piece has no next photo, and
  //   acting on the first panel while the bar names a door is the 09-05 failure ("a bar pointing at one panel
  //   while the switch drives another is worse than no bar"). Those buttons dim, as they do with no panel.
  function focusedTargetNow() {
    try { return arr.focusedTarget?.() || null; } catch { return null; }
  }
  function focusedPiece() {
    const t = focusedTargetNow();
    return t && t.kind === 'piece' ? t : null;
  }
  function panelSubject() {
    return focusedPiece() ? null : focusedRec();
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
    // An embed's dashboard (Stage 3) is not swapped: an embed has no other screens to go to (its
    // `list()` is empty), so this refuses rather than half-swapping inside the module.
    if (useDashboard && embedded) return null;
    // A real screen's dashboard (Stage 4): load and mount the new one, destroy the old only on success.
    if (useDashboard && dash) return swapDashboard(nextId, { remember });
    swapping = true;
    const from = profileId;
    const trailBefore = screenStack.slice();
    let incoming = null;                 // the incoming screen's settings doc (kept while it shows: `swapDoc`)
    let adopted = false;
    try {
      const next = makeState
        ? await profiles.get(nextId)
        : await cachedFetch(`profile:${user}:${nextId}`, () => profiles.get(nextId));
      if (!next || !Array.isArray(next.modules)) throw new Error('that screen has no modules');
      if (remember) rememberSwap(from, nextId);
      nameScreen(nextId, next.name);
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
      // (2026-10-02: and the doc stays OPEN while that screen shows -- `swapDoc` -- so an edit to its room is
      // saved where it belongs, and its lock list is read. Going back to the boot screen needs none: that is
      // `settings`.)
      // The screen being left: its last room edit goes to the server FIRST, so coming straight back to it
      // reads that edit rather than the copy from before it.
      if (swapDoc) { try { await swapDoc.doc.flush?.(); } catch { /* offline: it stays pending */ } }
      // (2026-10-04: merged on a refused write, and a local change that could not be kept is said -- the
      // header above `swapDoc`.)
      incoming = stateFor('settings', {
        merge: (b, m, t) => mergeSettingsDoc(b, m, t, { prefer: CONFLICT_PREFER }),
        onLost: (lost) => sayLostEdit(nextId, lost),
      });
      let sl;
      let readable = false;
      try { await incoming.load(); sl = (incoming.get().kiosk || {}).layout; readable = true; }
      catch { sl = undefined; }      // unreadable: no arrangement, not the previous screen's
      arr.resolve(sl);
      await applyModules();
      // Up: the incoming doc replaces the last swapped-in one (a swap that failed above keeps the old one).
      const before = swapDoc;
      swapDoc = readable && nextId !== bootProfileId ? { id: nextId, doc: incoming, shown: sl ?? null, off: null } : null;
      adopted = !!swapDoc;
      if (before) closeSwapDoc(before);
      if (swapDoc) watchSwapDoc(swapDoc);
      bus.publish(SCREEN_SHOWN, { profileId: nextId, from });
      drawCrumbs();
      return nextId;
    } catch (err) {
      // *** A FAILED SWAP MUST LEAVE HER LOOKING AT SOMETHING. *** Put the id back and leave
      // what is already mounted alone: "the call did not open" is recoverable, a blank screen
      // in a room she cannot leave is not.
      console.error('kiosk: could not show screen', nextId, err);
      profileId = from;
      // (Row 2.38: the trail as it was -- a swap may have cut it as well as pushed onto it.)
      screenStack.splice(0, screenStack.length, ...trailBefore);
      return null;
    } finally {
      swapping = false;
      // A doc that is not kept (the boot screen, an unreadable one, a failed swap) is closed, as it always was.
      if (incoming && !adopted) { try { incoming.destroy(); } catch { /* already gone */ } }
    }
  }

  // *** THE SWAPPED-IN DOC, WATCHED (2026-10-04; the header above `swapDoc`). *** Polling starts with the watch,
  // and both stop when the doc is closed (`closeSwapDoc`). Changes are applied one at a time, in order.
  function watchSwapDoc(rec) {
    let chain = Promise.resolve();
    rec.off = rec.doc.subscribe((s) => {
      const now = ((s || {}).kiosk || {}).layout ?? null;
      if (JSON.stringify(now) === JSON.stringify(rec.shown ?? null)) return;
      chain = chain.then(() => applySwapLayout(rec, now))
        .catch((err) => console.error('kiosk: a swapped-in screen changed elsewhere', err));
    });
    try { rec.doc.startPolling?.(); } catch (err) { console.error('kiosk: polling the swapped-in screen', err); }
  }
  /** A layout saved elsewhere for the swapped-in screen that is showing: in place where the arrangement can
   *  (`applySaved`), else the arrangement rebuilt in place, as a swap builds it. Never a reload: that would
   *  land on the screen this kiosk booted on. */
  async function applySwapLayout(rec, now) {
    if (torn || swapping || swapDoc !== rec || profileId !== rec.id) return;
    const prev = rec.shown ?? null;
    if (JSON.stringify(now) === JSON.stringify(prev)) return;
    rec.shown = now;
    let r = null;
    try { r = await arr.applySaved(prev, now); } catch (err) { console.error('kiosk: applying a saved layout', err); r = null; }
    if (r && r.applied) return;
    if (torn || swapDoc !== rec || profileId !== rec.id) return;
    arr.resolve(now ?? undefined);
    await applyModules();
  }
  /** One quiet line: a change made here gave way to the same thing changed on another device (doc_merge.js). */
  function sayLostEdit(id, lost) {
    return sayNote(lostEditWords(lost, screenNames.get(id) || null));
  }

  /** Back to whatever was showing before the last swap. */
  async function showPreviousScreen() {
    const back = screenStack.pop();
    if (!back) return null;
    const got = await showScreen(back, { remember: false });
    // Row 2.38: a back that did not happen leaves the trail as it was (the way back is still there).
    if (!got) screenStack.push(back);
    drawCrumbs();
    return got;
  }

  // ---------------------------------------------------------------------------------
  // *** ROW 2.38: THE TRAIL, AND THE WAY BACK OUT OF ANYTHING. ***
  //
  // Once a room's desk, a placed picture or a billboard can OPEN another dashboard (`dashboard/go`), a
  // person can be several dashboards deep -- and chat's note (room_as_home §7.3.4) is the rule: "A switch
  // user must never be stranded three levels down." So the back stack is a TRAIL (`trailAfter`,
  // dashboard_nest.js): going to a dashboard already on it goes back to it, which is what keeps a cycle
  // (A's door to B, B's door to A) from growing it forever. The ways back, all to the same two functions:
  //   pointer   the breadcrumb, top left, shown while the trail is longer than one ("⌂ Home › Room › Desk")
  //   scan      the dashboards tray: Back and Home are its first stops after Close
  //   switch    `kiosk/back` / `kiosk/home` (actions.js, bindable)
  //   voice     "go back" (the `back` verb, when the panel in front has nothing to cancel -- below) and
  //             "previous dashboard" / "go home" (dashboards.js NAV_ROUTES)
  // HOME is the dashboard this screen started on (`bootProfileId`), and going there clears the trail.
  const screenNames = new Map();
  function nameScreen(id, name) {
    if (id && typeof name === 'string' && name.trim()) screenNames.set(id, name.trim());
  }
  function rememberSwap(from, nextId) {
    const next = trailAfter(screenStack, from, nextId);
    screenStack.splice(0, screenStack.length, ...next);
  }
  const crumbsEl = embedded ? null : document.createElement('nav');
  const crumbs = crumbsEl ? createBreadcrumb(crumbsEl, {
    // A crumb `steps` levels up: straight there, the trail cut at it (`trailAfter` does the cutting).
    onJump: (id) => { if (id === bootProfileId) goHomeScreen().catch(() => {}); else showScreen(id).catch(() => {}); },
  }) : null;
  if (crumbsEl) kioskEl.append(crumbsEl);
  const trailNow = () => [...screenStack, profileId].map((id) => ({ id, name: crumbName(id, screenNames) }));
  function drawCrumbs() {
    try { crumbs?.draw(trailNow()); } catch (err) { console.error('kiosk: breadcrumb', err); }
  }
  /** Home: the dashboard this screen started on, and the trail cleared. */
  async function goHomeScreen() {
    if (profileId === bootProfileId) { screenStack.length = 0; drawCrumbs(); return profileId; }
    const got = await showScreen(bootProfileId, { remember: false });
    if (got) { screenStack.length = 0; drawCrumbs(); }
    return got;
  }
  offsScreen.push(bus.subscribe(SCREEN_HOME, (p) => {
    try { p?.claim?.(); } catch { /* a publisher's claim must not stop the press */ }
    goHomeScreen().catch(() => {});
  }));
  // "Go back" is the `back` verb, and it already means "cancel" to whatever panel is in front (a quiz
  // skips, a lifted room panel goes back, a call hangs up). Only when that panel has NOTHING for it --
  // the router finds no target -- and there is somewhere to go back to, does it go back a dashboard.
  // FOR: "go back" is what a person says, and a press that does nothing is the failure respondsToVerbs
  // exists to prevent. AGAINST: the same switch means two things depending on the panel in front; but
  // that is what every verb already is ("whatever is in front of you decides"), and the trail is empty
  // -- so nothing changes -- on every screen nobody opened anything from.
  function backUnhandled(info) {
    // 2026-10-02: a panel made bigger comes back down first, one level -- the nearer "back".
    if (info && info.verb === 'back' && !torn) {
      try { if (promotedAny() && demotePanel()) return { topic: SHELL_DEMOTE, fallback: 'demote' }; } catch { /* declared later */ }
      // 2026-10-02 (edit_mode.js): a panel being edited stops being edited -- the panel had nothing for it.
      try {
        if (arr.editing?.()) { bus.publish('shell/edit-panel', { on: false }); return { topic: 'shell/edit-panel', fallback: 'edit-leave' }; }
      } catch { /* no arrangement yet */ }
    }
    if (!info || info.verb !== 'back' || torn || !screenStack.length) return null;
    showPreviousScreen().catch(() => {});
    return { topic: SCREEN_BACK, fallback: 'dashboard-back' };
  }
  nameScreen(profileId, arr.profile()?.name);
  drawCrumbs();

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
    // (2026-10-02: none while a piece of the room is selected -- `panelSubject`.)
    const rec = arr.layout() ? panelSubject() : arr.stageRec();
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
    const rec = arr.layout() ? panelSubject() : arr.stageRec();
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
    // (2026-10-02: the stop focus landed on, a piece of the room included -- painting the first PANEL here
    // took the ring off a piece the moment the button reached one.)
    const id = focusedTargetNow()?.id;
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
    // (2026-10-05, screen_lock.js: locked, full screen is entered but not left from here -- leaving it shows the browser.)
    else if (lockRefuses('leaving full screen')) return;
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
  screensEl.setAttribute('aria-label', 'your dashboards');
  // (2026-10-05, screen_lock.js: locked, the way out to the composer is refused -- and the tray does not draw it.)
  const goHome = () => { if (lockRefuses('setting up dashboards')) return; location.href = '/home.html'; };
  let screensOpen = false;
  let editScanHeld = false;        // row 2.38: the edit windows or the map hold the scan (see openEditView)
  let hostScanHeld = false;        // 2026-10-02: the host page's own controls hold it (see syncHostScan)
  let libOpen = null;              // 2026-10-02: the Modules library standing in a panel's place (openLibraryAt)
  let libScanHeld = false;         // ...holding the scan while it does
  let hostScanT = null;            // ...and their "nobody answering" wait
  let hostScanFresh = false;       // ...taken during THIS verb: the verb that took it is not also theirs

  // *** ROW 2.34: THE STRIP IS THE DASHBOARD PICKER NOW (dashboard_picker.js). *** The person's dashboards,
  // then the ready-made ones they have not made yet ("+ Room", "+ Basic", "+ Classic 2D" -- dashboards.js),
  // then the way out to the composer; its own Close first. The SAME strip on both paths: on the dashboard
  // path a pick swaps load-then-swap (`swapDashboard`) and brings that dashboard's theme; on today's path it
  // is today's `showScreen`, which swaps the modules and keeps the boot screen's look (see showScreen).
  let makerInst = null;
  function dashboardMaker() {
    if (makerInst) return makerInst;
    if (typeof profiles?.create !== 'function' || typeof profiles?.addModule !== 'function') return null;
    makerInst = createDashboardMaker({
      profiles,
      // No local-first cache (`cacheKey: null`): "is this one of the ready-made ones, and is it finished?"
      // must be the server's answer, not a copy cached before another device made it.
      makeSettings: (pid) => stateForProfile('settings', { cacheKey: null }, pid),
      makeInstanceState: (pid, mid) => stateForProfile(mid, { cacheKey: null }, pid),
      // Whose: the person this screen is for (resolved after boot), else the screen record's own.
      personId: () => personId || arr.profile()?.person_id || '',
      personName: () => (whoState && whoState.name) || '',
    });
    return makerInst;
  }
  let pickerMaking = null;          // the ready-made key being made right now (the tray says so)
  let pickerNote = null;            // a sentence for the tray (a make that failed)
  const picker = createDashboardPicker(screensEl, {
    onClose: () => toggleScreens(false),
    onPick: async (id) => { toggleScreens(false); await showScreen(id); },
    onMake: (key) => { goToPrebuilt(key, { fromPicker: true }).catch(() => {}); },
    onLeave: goHome,
    // Row 2.38: the way back along the trail, for a switch (the breadcrumb is the pointer's).
    onBack: () => { toggleScreens(false); showPreviousScreen().catch(() => {}); },
    onHome: () => { toggleScreens(false); goHomeScreen().catch(() => {}); },
  });

  async function listDashboards() {
    try { return (await profiles.list()) || []; } catch (err) {
      console.error('kiosk: could not list screens', err);
      return null;                  // null = could not ask (offline), [] = asked, none
    }
  }

  // Never throws at its caller: a tray that cannot draw leaves the screen exactly as it was.
  function drawScreens() {
    drawScreensNow().catch((err) => console.error('kiosk: the dashboard picker', err));
  }
  async function drawScreensNow() {
    const got = await listDashboards();
    const list = got || [];
    if (got) restartScreens = got;     // after a restart (row 2.70): the row's list, kept current
    let offers = [];
    const maker = !embedded && got && offersOn(settings.get()) ? dashboardMaker() : null;
    if (maker) {
      try { offers = (await maker.offered(list)).map((k) => ({ key: k, ...PREBUILT_DASHBOARDS[k] })); }
      catch (err) { console.error('kiosk: ready-made dashboards', err); offers = []; }
    }
    if (!screensOpen || torn) return;
    for (const d of list) nameScreen(d?.id, d?.name);
    const prevId = screenStack[screenStack.length - 1];
    picker.draw({
      list, current: profileId, offers, making: pickerMaking, note: pickerNote,
      // (2026-10-05, screen_lock.js: locked, the dashboards still swap and a ready-made one is still made; only the
      // way out to the plain website pages, where the account's controls are, is gone.)
      leave: !screenLocked(),
      // Row 2.38: inside something an object opened -- Back (one step) and Home (the start), first.
      back: prevId ? { id: prevId, name: crumbName(prevId, screenNames) } : null,
      home: screenStack.length ? { id: bootProfileId, name: crumbName(bootProfileId, screenNames) } : null,
      // Offline, signed out, or a demo kiosk with no account. Saying so beats an empty box, and the way
      // out is still on the row below.
      empty: list.length || offers.length ? null : 'No other dashboards to show from here.',
    });
    // What the picker lists is what can be said: "go to <name>".
    applyDashboards(list);
  }

  function toggleScreens(want) {
    const was = screensOpen;
    screensOpen = want === undefined ? !screensOpen : !!want;
    screensEl.hidden = !screensOpen;
    // WHILE IT IS OPEN IT TAKES THE SCAN (the menu's rule): the panel router is paused so next / prev /
    // select move and press the tray's cursor instead of the panel underneath. The menu is put away first
    // -- two things answering one "next" is the double-move the menu's own note warns about.
    if (screensOpen && !was) {
      try { if (menu?.isOpen?.()) menu.close(); } catch { /* not up yet */ }
      releaseHostScan();
      pickerNote = null;
      picker.reset();
      try { runtime?.router?.setPaused?.(true); } catch { /* no router yet */ }
    } else if (!screensOpen && was) {
      // (Row 2.38: not while the edit windows or the map hold the scan -- they give it back themselves. Nor
      // while the Modules library stands in a panel's place, 2026-10-02.)
      try { if (!menu?.isOpen?.() && !editScanHeld && !hostScanHeld && !libScanHeld && !callScanHeld) runtime?.router?.setPaused?.(false); } catch { /* gone */ }
    }
    // Row 2.38: opening gives the bar the tray's wait; closing gives it back its own (`armBarHide`). Not
    // when the bar is already hidden -- that is the bar's own timer putting the tray away.
    if (screensOpen !== was && !torn) {
      try { if (!controlsEl.classList.contains('hidden')) armBarHide(); } catch { /* not up yet */ }
    }
    if (screensOpen) drawScreens();
  }

  /** A ready-made dashboard: this person's if they have it, made once if not, then shown. By the tray's
   *  "+ Room", by voice ("go to my room") or by a `dashboard/go { prebuilt }` from anything else. */
  async function goToPrebuilt(key, { fromPicker = false } = {}) {
    const maker = dashboardMaker();
    if (!maker || !PREBUILT_DASHBOARDS[key]) return null;
    pickerMaking = key; pickerNote = null;
    if (screensOpen) drawScreens();
    let got = null;
    try { got = await maker.ensure(key); }
    catch (err) {
      console.error('kiosk: could not make the ready-made dashboard', key, err);
      pickerNote = `Could not make ${PREBUILT_DASHBOARDS[key].label} just now. Nothing on this screen changed.`;
    } finally { pickerMaking = null; }
    if (!got) { if (fromPicker && screensOpen) drawScreens(); return null; }
    if (screensOpen) toggleScreens(false);
    // It is in the list now: "go to my room" and its name are speakable from here on.
    listDashboards().then((l) => { if (l) applyDashboards(l); }).catch(() => {});
    return got.id === profileId ? got.id : showScreen(got.id);
  }

  // The tray's scan: the same verbs the menu takes, only while it is open (and the menu is not).
  for (const [verb, fn] of [['next', () => picker.next()], ['prev', () => picker.prev()],
    ['select', () => picker.select()], ['back', () => toggleScreens(false)]]) {
    offsScreen.push(bus.subscribe(verbTopic(verb), () => {
      if (!screensOpen || torn) return;
      try { if (menu?.isOpen?.()) return; } catch { /* not up yet */ }
      fn();
      // A press is somebody using it: the tray does not put itself away under them (the bar's 3 s, poke).
      if (screensOpen) poke();
    }));
  }
  // The menu opening puts the tray away (subscribed BEFORE the menu's own handler, so the tray hands the
  // router back first and the menu then takes it): one thing holds the scan at a time.
  for (const t of [verbTopic('menu'), SHELL_MENU]) {
    offsScreen.push(bus.subscribe(t, () => { if (screensOpen) toggleScreens(false); }));
  }
  // "Go to <dashboard>" from speech, a bound switch, or a state machine: `{ id }` or `{ prebuilt }`. Not on
  // an embed: it has no other dashboards (and its showScreen refuses).
  if (!embedded) {
    offsScreen.push(bus.subscribe(DASHBOARD_GO_TOPIC, (p) => {
      if (!p || torn) return;
      // Row 2.38: a room object, a placed door or a nested dashboard asks with `claim()` -- answered here,
      // so it does not also say "nothing here answers that".
      if (p.prebuilt || p.id) { try { p.claim?.(); } catch { /* a publisher's claim must not stop the press */ } }
      if (p.prebuilt) goToPrebuilt(p.prebuilt).catch(() => {});
      else if (p.id) showScreen(p.id).catch(() => {});
    }));
  }

  // ---------------------------------------------------------------------------------
  // *** ROW 2.38: THE EDIT VIEW AND THE MAP, BY SWITCH (Stage R left the way in unbuilt). ***
  //
  // `system/edit` (actions.js; bindable, and a room object's `edit.open`) opens THIS dashboard's edit
  // windows -- Transform, Layers, Opens and shows -- and, pressed again, closes them. `system/map` opens the
  // map of the person's dashboards; choosing one goes there. Pointer users reach both from the menu.
  //   * WHERE THE EDITOR COMES FROM: on the dashboard path, the dashboard module's own (`edit()`); on
  //     today's path, the same editor (dashboard_editor.js) over this file's own arrangement, saving into
  //     the SHOWING screen's settings doc (the boot screen's handle when it is the boot screen, so the
  //     09-12 watch and the editor never write the layout from two copies).
  //   * WHILE EITHER IS OPEN IT HOLDS THE SCAN (the tray's rule): the panel router is paused, and next /
  //     prev / select walk the windows (Close of the first window first -- the way out), back closes.
  //     One thing holds the scan at a time: the menu or the tray opening puts them away first.
  //   * NOBODY ANSWERING: each puts itself away after its wait (`editIdleMs`, argued in dashboard_nest.js;
  //     the map keeps the tray's), which hands the switch back to the panels. Nothing is lost: every edit
  //     is applied and saved as it is made.
  let kEditor = null;              // today's path: this file's own editor
  let kEditorDoc = null;           // ...and the settings handle it saves through, when not the boot one
  let editIdleT = null;
  let mapWin = null, mapHost = null, mapIdleT = null;
  const editorNow = () => {
    let e = null;
    try { e = dash?.impl?.editing?.() || null; } catch { e = null; }
    if (e && e.isOpen?.() !== false) return e;
    return kEditor && kEditor.isOpen() ? kEditor : null;
  };
  function syncEditScan() {
    const want = !torn && (!!editorNow() || !!mapWin);
    if (want === editScanHeld) return;
    editScanHeld = want;
    // The edit windows opening (Home's Transform… among the ways) take the scan from a host page's controls.
    if (want) releaseHostScan();
    try {
      if (want) runtime?.router?.setPaused?.(true);
      else if (!screensOpen && !menu?.isOpen?.() && !hostScanHeld && !libScanHeld && !callScanHeld) runtime?.router?.setPaused?.(false);
    } catch { /* no router yet */ }
  }
  function armEditIdle() {
    clearTimeout(editIdleT); editIdleT = null;
    if (!editorNow() || torn) return;
    let wait = 0;
    try { wait = editIdleMsFrom(settings.get() || {}); } catch { wait = 0; }
    if (!wait) return;
    editIdleT = setTimeout(() => { editIdleT = null; closeEditView(); }, wait);
  }
  const mapLoad = () => mapLoader({
    profiles,
    makeRow: (pid, key) => stateForProfile(key, { cacheKey: null }, pid),
    title: (t) => getManifest(t)?.title || t,
  })();
  function openEditView() {
    if (torn) return null;
    const have = editorNow();
    if (have) { syncEditScan(); armEditIdle(); return have; }
    try { if (menu?.isOpen?.()) menu.close(); } catch { /* not up yet */ }
    if (screensOpen) toggleScreens(false);
    closeMap();
    let ed = null;
    try {
      if (dash?.impl?.edit) ed = dash.impl.edit();
      else {
        const own = profileId === bootProfileId;
        const edId = profileId;
        // (2026-10-04, later: a swapped-in screen's OWN doc, `swapDoc`, when it is open -- the doc that screen polls and
        // applies, so the save and the screen read one copy. A fresh handle only when there is none.)
        const swapRec = !own && swapDoc && swapDoc.id === profileId ? swapDoc : null;
        const doc = own ? settings : (swapRec ? swapRec.doc : stateForProfile('settings', { cacheKey: null }, profileId));
        if (!own && !swapRec) { kEditorDoc = doc; doc.load?.().catch?.(() => {}); }
        const savable = !embedded && !previewLayout;
        ed = kEditor = openDashboardEditor({
          arr, mountIn: kioskEl,
          baseLayout: () => ((doc.get?.() || {}).kiosk || {}).layout || arr.layout(),
          // *** MERGED ONTO THE DOC AS IT IS NOW (2026-10-04, later; the gap d40424f left). *** The windows hand the
          // base they last matched (dashboard_editor.js); a move made elsewhere while they were open is merged in, not
          // laid over (doc_merge.js `mergeLayoutSave`, CONFLICT_PREFER, the same quiet line). The watch on the doc is
          // told the merged layout first -- the 09-12 watch on the boot doc (`expectLayoutSig`), a swapped-in doc's
          // `shown` -- and the merge is handed back, so the windows move the screen to it in place. Never a reload.
          save: savable ? (next, base) => {
            if (!own && swapRec && swapDoc !== swapRec) return undefined;     // swapped away: that doc is closed
            const cur = (doc.get?.() || {}).kiosk || {};
            const m = mergeLayoutSave(base, next, cur.layout ?? null, { prefer: CONFLICT_PREFER });
            if (own) { if (JSON.stringify(m.layout ?? null) !== JSON.stringify(cur.layout ?? null)) expectLayoutSig = JSON.stringify(m.layout ?? null); }
            else if (swapRec) swapRec.shown = m.layout ?? null;
            doc.set({ kiosk: { ...cur, layout: m.layout } });
            if (m.lost.length) sayLostEdit(edId, m.lost);
            return { layout: m.layout };
          } : null,
          listDashboards: async () => (await listDashboards()) || [],
          createDashboard: !embedded && typeof profiles?.create === 'function'
            ? (name) => profiles.create(name, personId || arr.profile()?.person_id || '') : null,
          currentId: () => profileId,
          loadMap: !embedded && typeof profiles?.list === 'function' ? mapLoad : null,
          onGo: (id) => { closeEditView(); showScreen(id).catch(() => {}); },
          hidePolicy: { personHid: (id) => { try { hideSound?.personHid?.(id); } catch { /* not load-bearing */ } } },
          onClose: () => {
            kEditor = null;
            if (kEditorDoc) { try { kEditorDoc.flush?.()?.finally?.(() => {}); } catch { /* gone */ } try { kEditorDoc.destroy?.(); } catch { /* gone */ } kEditorDoc = null; }
            syncEditScan();
          },
          onChange: () => { renderMods(); },
          automation,
          // 2026-10-04: how a switch walks the Automation window follows the person's "How you choose things".
          chooseMode: () => { try { return chooseModeNow(); } catch { return chooseModeOf(null); } },
        });
      }
    } catch (err) {
      console.error('kiosk: the edit view', err);
      ed = null;
    }
    if (!ed) return null;
    watchMenu();
    // Any press, key or pointer inside the windows is somebody using them: the wait starts again.
    for (const ev of ['pointerdown', 'keydown', 'input']) ed.el?.addEventListener?.(ev, () => armEditIdle());
    ed.scan?.reset?.();
    syncEditScan();
    armEditIdle();
    return ed;
  }
  function closeEditView() {
    clearTimeout(editIdleT); editIdleT = null;
    const ed = editorNow();
    if (ed) { try { ed.close(); } catch (err) { console.error('kiosk: closing the edit view', err); } }
    syncEditScan();
  }
  function toggleEditView() { if (editorNow()) closeEditView(); else openEditView(); }

  function armMapIdle() {
    clearTimeout(mapIdleT); mapIdleT = null;
    if (!mapWin || torn) return;
    let wait = 0;
    try { wait = trayOpenMsFrom(settings.get() || {}); } catch { wait = 0; }
    if (!wait) return;
    mapIdleT = setTimeout(() => { mapIdleT = null; closeMap(); }, wait);
  }
  function openMap() {
    if (torn || embedded || typeof profiles?.list !== 'function') return null;
    if (mapWin) { armMapIdle(); return mapWin; }
    try { if (menu?.isOpen?.()) menu.close(); } catch { /* not up yet */ }
    if (screensOpen) toggleScreens(false);
    closeEditView();
    mapHost = document.createElement('div');
    mapHost.className = 'k-map';
    mapHost.style.cssText = 'position:absolute;left:50%;top:8px;transform:translateX(-50%);width:min(760px,calc(100% - 16px));'
      + 'max-height:calc(100% - 16px);overflow:auto;z-index:var(--z-menus,600);pointer-events:auto';
    kioskEl.append(mapHost);
    mapWin = mountMapWindow(mapHost, {
      load: mapLoad, current: () => profileId,
      onGo: (id) => { closeMap(); showScreen(id).catch(() => {}); },
      onClose: () => closeMap(),
    });
    for (const ev of ['pointerdown', 'keydown']) mapHost.addEventListener(ev, () => armMapIdle());
    watchMenu();
    syncEditScan();
    armMapIdle();
    return mapWin;
  }
  function closeMap() {
    clearTimeout(mapIdleT); mapIdleT = null;
    if (!mapWin) return;
    const w = mapWin;
    mapWin = null;
    try { w.destroy(); } catch { /* gone */ }
    mapHost?.remove(); mapHost = null;
    syncEditScan();
  }

  // The switch, while they hold the scan. (Not while the menu or the tray has it: one holder at a time.)
  for (const verb of ['next', 'prev', 'select', 'back']) {
    offsScreen.push(bus.subscribe(verbTopic(verb), () => {
      if (torn || screensOpen) return;
      try { if (menu?.isOpen?.()) return; } catch { /* not up yet */ }
      if (mapWin) {
        if (verb === 'back') closeMap();
        else if (verb === 'select') mapWin.select();
        else mapWin.focusStep(verb === 'next' ? 1 : -1);
        armMapIdle();
        return;
      }
      const ed = editorNow();
      if (!ed || !editScanHeld) return;
      // 2026-10-04: back comes out a level first (a row of the Automation window, its picker, the window
      // itself: edit_windows.js createWindowGroup `back`); only when nothing used it does it end the editing.
      if (verb === 'back') {
        let used = false;
        try { used = ed.scan?.back?.() === true; } catch (err) { console.error('kiosk: edit view back', err); }
        if (!used) { closeEditView(); return; }
        syncEditScan();
        armEditIdle();
        return;
      }
      if (verb === 'select') ed.scan?.select?.();
      else if (verb === 'next') ed.scan?.next?.();
      else ed.scan?.prev?.();
      syncEditScan();
      armEditIdle();
    }));
  }
  // The menu opening puts them away (the tray's rule: one thing holds the scan at a time).
  for (const t of [verbTopic('menu'), SHELL_MENU]) {
    offsScreen.push(bus.subscribe(t, () => { closeMap(); closeEditView(); releaseHostScan(); }));
  }

  // ---------------------------------------------------------------------------------
  // *** THE HOST PAGE'S OWN CONTROLS, BY SWITCH (2026-10-02: Home's edit bar). *** A page embedding this
  // kiosk (Home) may have controls of its own OUTSIDE the stage -- Home's edit bar (Scene / Add / Change…)
  // sits above it -- and a switch reaches them through this kiosk, because its input runtime is the one
  // that hears the switch. `host.scan` (see the option) is the same rule as the tray and the edit view:
  //   * WHILE THE PAGE SAYS IT HOLDS THE SCAN (`held()`, re-read whenever the host says it changed) next /
  //     prev / select / back are the page's, and the panel router is paused. The page draws the cursor
  //     and keeps its own way out first.
  //   * ONE HOLDER AT A TIME: the page taking it puts the menu, the tray, the edit windows and the map away;
  //     any of those opening tells the page to let go (`release()`).
  //   * NOBODY ANSWERING: after the edit view's own wait (`editIdleMs`, argued in dashboard_nest.js -- it IS
  //     an edit view, of the page's) the page is told to let go and the switch is the panels' again.
  //     Nothing is lost: a change on Home is made as it is pressed.
  const hostHolds = () => {
    if (!hostPage || torn) return false;
    try { return !!hostPage.scan?.held?.(); } catch { return false; }
  };
  function armHostScanIdle() {
    clearTimeout(hostScanT); hostScanT = null;
    if (!hostScanHeld || torn) return;
    let wait = 0;
    try { wait = editIdleMsFrom(settings.get() || {}); } catch { wait = 0; }
    if (!wait) return;
    hostScanT = setTimeout(() => { hostScanT = null; releaseHostScan(); }, wait);
  }
  function syncHostScan() {
    const want = hostHolds();
    if (want && !hostScanHeld) {
      hostScanHeld = true;
      // A menu row or a bar button pressed by `select` hands the page the scan in the middle of that verb's
      // delivery; the verb that took it is not also the page's (it would press its first stop). A bus publish is
      // delivered synchronously, so the flag clears once this delivery is over.
      hostScanFresh = true;
      queueMicrotask(() => { hostScanFresh = false; });
      try { if (menu?.isOpen?.()) menu.close(); } catch { /* not up yet */ }
      if (screensOpen) toggleScreens(false);
      closeMap();
      closeEditView();
      watchMenu();
      armHostScanIdle();
    } else if (!want && hostScanHeld) {
      hostScanHeld = false;
      clearTimeout(hostScanT); hostScanT = null;
      // Given back AFTER this verb has finished travelling, so the verb that let go is not also a panel's.
      queueMicrotask(() => {
        if (torn || hostScanHeld || screensOpen || editScanHeld || libScanHeld || callScanHeld) return;
        try { if (!menu?.isOpen?.()) runtime?.router?.setPaused?.(false); } catch { /* gone */ }
      });
    }
    if (hostScanHeld) { try { runtime?.router?.setPaused?.(true); } catch { /* no router yet */ } }
  }
  function releaseHostScan() {
    if (!hostScanHeld && !hostHolds()) return;
    try { hostPage?.scan?.release?.(); } catch (err) { console.error('kiosk: host scan release', err); }
    syncHostScan();
  }
  offsScreen.push(() => { clearTimeout(hostScanT); hostScanT = null; });
  if (hostPage) {
    for (const verb of ['next', 'prev', 'select', 'back']) {
      offsScreen.push(bus.subscribe(verbTopic(verb), () => {
        if (torn || hostScanFresh) return;
        syncHostScan();
        if (!hostScanHeld) return;
        try { hostPage.scan?.[verb]?.(); } catch (err) { console.error('kiosk: host scan', verb, err); }
        syncHostScan();
        armHostScanIdle();
      }));
    }
  }
  // Another screen came in: today's editor was about the screen that left; a dashboard's went with it.
  offsScreen.push(bus.subscribe(SCREEN_SHOWN, () => {
    if (kEditor) closeEditView();
    closeMap();
    syncEditScan();
  }));
  // The menu opening by ANY way (the gear, M, a door, the host) puts them away too: watched on its one
  // `hidden` attribute, as the dashboard path's SHELL_STATE watch does. Made on first use.
  let menuWatch = null;
  function watchMenu() {
    if (menuWatch || typeof MutationObserver === 'undefined') return;
    const scrim = kioskEl.querySelector('[data-settings] [data-scrim]');
    if (!scrim) return;
    menuWatch = new MutationObserver(() => { if (!scrim.hidden) { closeMap(); closeEditView(); releaseHostScan(); } });
    menuWatch.observe(scrim, { attributes: true, attributeFilter: ['hidden'] });
  }
  offsScreen.push(() => {
    try { menuWatch?.disconnect(); } catch { /* gone */ }
    clearTimeout(editIdleT); clearTimeout(mapIdleT);
    try { kEditor?.close(); } catch { /* gone */ }
    try { mapWin?.destroy(); } catch { /* gone */ }
    mapWin = null;
  });

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
  // Pause / Play (2026-10-02; `playPauseSelected` argues it): the selected panel's.
  controlsEl.querySelector('[data-act="playpause"]')?.addEventListener('click', () => { playPauseSelected(); });
  controlsEl.querySelector('[data-act="bigger"]')?.addEventListener('click', () => { promotePanel(); });
  controlsEl.querySelector('[data-act="smaller"]')?.addEventListener('click', () => { demotePanel(); });
  controlsEl.querySelector('[data-act="fs"]').addEventListener('click', toggleFs);

  // *** NIMROD, ON THE BAR (row 2.37, 2026-09-30). *** Press him and the cat explains whatever is
  // picked: the menu's cursor row when the menu is open, else the focused panel, else the screen. ONE
  // cat for the screen (`mountBarHelp`, transport_bar.js): the plain bar calls it, a placed bar says
  // SHELL_HELP and this answers. With "Cat help" off there is no button at all -- re-read whenever the
  // bar is brought up, since the setting lives with the cat's other preferences on this device.
  // (2026-10-02: a selected piece of the room is explained as the room's, standing on that piece.)
  const barHelp = mountBarHelp(kioskEl, { output: () => output, storage, focused: () => {
    const p = focusedPiece();
    return p ? { type: 'room', el: p.el || null } : focusedRec();
  } });
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
  // (2026-10-02: or the piece of the room that is selected, by its own name -- `focusedTargetNow`.)
  const subjectName = () => { const t = focusedTargetNow(); return t ? t.label : ''; };

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
  // The people's avatars for the "Who this screen is for" page: made on first draw, never at boot.
  // Null where there is no per-person state (a local backend): then nobody has a face and the page is
  // exactly what it was.
  let avatars = null;
  let whoAvatarOffs = [];
  function whoAvatars() {
    if (avatars || torn) return avatars;
    try {
      const mps = childCtx({ id: 'avatars' }).makePersonState;
      // Faces moving (ba4d79d): what this screen, the person looking and the starting-defaults layer allow,
      // read fresh at every draw.
      if (profiles.personStateURL) {
        avatars = createAvatarCache({ makePersonState: mps, user, context: () => avatarContextNow() });
      }
    } catch (err) { console.error('kiosk: avatars', err); avatars = null; }
    return avatars;
  }
  function offWhoAvatars() {
    for (const off of whoAvatarOffs.splice(0)) { try { off?.(); } catch { /* gone */ } }
  }
  // A LOCAL BACKEND HAS NO PEOPLE ENDPOINT (the dev harness, `makeState`). There is nothing to
  // pick from and no way to save a pick, so the row is not offered rather than offered and
  // broken.
  const canPickPerson = () => !!(profiles.people && profiles.moveToPerson);

  // ---- THE MENU'S TABS (2026-10-02; settings.js "TABS" is the mechanism) -------------------------------
  //
  // Mike: "The settings menu needs to be broken up into tabs. The choice for what to show should be at
  // the top above the tabs and then tabs for things like the active module, audio, video, devices,
  // users, etc." THE SET, argued, and every existing row is in exactly one (kiosk_test checks):
  //   <the panel>   its own settings, "Switch module", its background - named for the panel, because
  //                 "the active module" is a thing, not a category. FIRST, and where the menu opens.
  //   Sound         the panel's own sound first (its volume, "sound like it's in the room", a TV's
  //                 things, what hiding it does), then the screen's master and mixer, then Amplify.
  //   Display       Mike's "video": colours, backgrounds, burn-in, movement and flashing, the room, the
  //                 background's own settings, subtitles.
  //   Theme         (themes, 2026-10-06) the theme and everything about it, moved out of Display (MENU_TAB_DEFS).
  //   Devices       spoken commands and what they listen with, the voice recording, how long a switch
  //                 is held for the plain bar, "what can I press" / "why nothing happened", connections.
  //   People        who this screen is for, and the intercom.
  //   Players       (players, 2026-10-06) who is playing on this screen right now (MENU_TAB_DEFS).
  //   This page     a host page's own rows (Home's Save, Save as, History...): only on such a page.
  //   This screen   its name, the dashboard rows, Edit and the Map, when something stops working, and
  //                 where a cold boot lands.
  // AGAINST more tabs (a Voice tab, a Room tab): each tab is a press on the tab row before its rows, and
  // a tab of two rows costs more presses than it saves. AGAINST fewer: Sound and Display are where
  // somebody standing at the screen goes first; folding them into "This screen" was the old menu.
  // ABOVE THE TABS: "Settings for: <panel>" and "How much this menu shows" (Mike's "the choice for what to
  // show"). The SUBJECT is a panel on this screen - the one with focus when the menu opens, steppable to
  // any other. Not "this screen" or "a person": those are tabs already, and the same choice in two places
  // is two things that can disagree.
  // `rank` orders sections WITHIN a tab (settings.js sorts by it), since one tab gathers rows from several
  // of the shell's slots.
  const tagTab = (tab) => (rank = 0) => ({ tab, rank });
  const MENU_TAB = {
    module: tagTab('module'), audio: tagTab('audio'), display: tagTab('display'), devices: tagTab('devices'),
    people: tagTab('people'), page: tagTab('page'), screen: tagTab('screen'),
    theme: tagTab('theme'),   // themes (2026-10-06)
    players: tagTab('players'),   // players (2026-10-06)
  };
  const MENU_TAB_DEFS = () => [
    // (2026-10-02: with a LEVEL chosen in "Settings for", the first tab is that level's -- "This screen".)
    { id: 'module', label: (() => {
      const lv = menuLevel();
      if (lv !== 'instance') return levelTitle(lv);
      const pc = menuPiece();
      if (pc) return pc.label;
      const r = menuSubjectRec(); return r ? (r.title || r.type) : 'This panel';
    })() },
    { id: 'audio', label: 'Sound' },
    { id: 'display', label: 'Display' },
    // themes (2026-10-06; Mike: "its own themes module that is also a tab on the settings menu"). The Theme row (its
    // list is the theme gallery, the same list the Themes panel shows), "why this look" under it while it follows the
    // seasons, the holiday rows, and "Wallpaper follows the sky outside" - every row about the theme, moved here from
    // Display, each still in exactly one place. Beside Display, where they were. AGAINST a "Theme…" row left on
    // Display that opens this tab: a second door to one row is a stop on every Display lap for something one press
    // along the tab row already reaches. At "Just the essentials" it is the Theme row alone (the others are standard).
    { id: 'theme', label: 'Theme' },
    { id: 'devices', label: 'Devices' },
    { id: 'people', label: 'People' },
    // players (2026-10-06; Mike: "Players should be its own tab in settings"). Who is playing on this screen right now,
    // for every game that has players (a game can still pick its own, in its own "Players" row). Beside People: it is
    // about people. AGAINST folding it into People: that tab is who the SCREEN is for and what follows them; this one
    // changes from one game to the next, and a tab of its own is one press along the tab row from anywhere.
    { id: 'players', label: 'Players' },
    { id: 'page', label: 'This page' },
    { id: 'screen', label: 'This screen' },
  ];
  // Which tab (and section) each of the screen's own rows is on.
  const SCREEN_FIELD_TABS = {
    theme: ['theme', 0], burnIn: ['display', 0], panelSurface: ['display', 0], panelGap: ['display', 0],   // themes: theme on Theme
    [SMALL_CLOCK_KEY]: ['display', 0],
    [HOLIDAYS_KEY]: ['theme', 0], [SKY_FOLLOW_KEY]: ['theme', 0],   // seasons and the sky (sky.js); themes: on Theme
    ...Object.fromEntries(HOLIDAY_FIELDS.map((f) => [f.key, ['theme', 0]])),   // seasons: one row per holiday; themes: on Theme
    plainBarHoldMs: ['devices', 1], hideAskTimeoutMs: ['audio', 2],
    // bar toggle (2026-10-06): the bar's key and whether it comes up by itself, under "The bar" on Devices.
    [BAR_QUIET_FIELD.key]: ['devices', 2], [BAR_SELF_FIELD.key]: ['devices', 2],
    [BAR_PLAY_FIELD.key]: ['devices', 2],   // bar while playing (row 2.65): under "The bar" with the other two
  };
  const tagged = (rows, tab, rank = 0) => rows.map((it) => ({ ...it, tab, rank }));
  // THE SUBJECT: the panel the menu's panel rows are about. The focused one unless "Settings for" was
  // stepped to another; a panel that has gone since is the focused one again.
  // (2026-10-03: "the menu" is whichever VIEW of it is being drawn or pressed -- the ⚙ menu, or a Settings
  // panel's, each with its own "Settings for" (`settingsMenuFor`).)
  const menuView = () => viewNow || menu;
  function menuPanelRecs() {
    try {
      if (arr.layout()) return arr.panelRecs();
      return [arr.stageRec()].filter(Boolean);
    } catch { return []; }
  }
  function menuSubjectRec() {
    let id = null;
    try { id = menuView()?.subjectId?.() || null; } catch { id = null; }
    // (2026-10-02: a piece of the room is not a panel: no panel rows -- `menuPiece` has its own.)
    if (isPieceSubject(id)) return null;
    if (id) { const r = menuPanelRecs().find((x) => x.id === id); if (r) return r; }
    return panelSubject();
  }
  // *** A PIECE OF THE ROOM AS THE MENU'S SUBJECT (2026-10-02; Mike's list 09-30 ~1341). *** With the scan on
  // a piece, "Settings for" starts on THAT piece (`levelSubjects`, `defaultSubject`) and the first tab is its
  // options: exactly the rows edit mode shows when the piece is pressed with ✎ (arrangement.js `roomTargets`,
  // ca64e17 -- "Opens" for a piece; for a stop that is not an object of its own, a book or a way back, the
  // room's own rows), written where edit mode writes them. One set of rows, reached two ways.
  const isPieceSubject = (id) => typeof id === 'string' && id.startsWith(ROOM_PIECE_PREFIX);
  function menuPiece() {
    let id = null;
    try { id = menuView()?.subjectId?.() || null; } catch { id = null; }
    if (!isPieceSubject(id)) return null;
    try { return arr.pieceTarget?.(id) || null; } catch { return null; }
  }
  const pieceSubject = (p) => ({ id: p.id, label: p.whole ? `${p.label} (the room)` : p.label });
  let pieceWaitFor = null;                 // the piece whose rows the menu is waiting on (`pieceRows`)
  function pieceRows(p) {
    const t = MENU_TAB.module(0);
    const tg = p.target;
    const head = { kind: 'heading', id: 'piece-head', ...t,
      label: p.whole ? `${p.label} is part of the room: the room’s own settings` : `${p.label}, in the room` };
    let rows = [];
    if (tg && Array.isArray(tg.fields)) {
      rows = fieldItems(tg.fields.map(normalizeField).filter(Boolean), {
        values: () => { try { return tg.values?.() || {}; } catch { return {}; } },
        level: complexity(),
        onStep: (key, value) => { try { tg.set?.({ [key]: value }); } catch (err) { console.error('kiosk: a piece of the room', err); } },
      }).map((it) => ({ ...it, ...t }));
    }
    // The room's own rows load on first use (arrangement.js): the menu draws again when they are in -- ONCE
    // per piece, so a load that keeps failing (offline) cannot turn into a redraw that asks again forever.
    let waiting = null;
    try { waiting = arr.roomTargetsPending?.() || null; } catch { waiting = null; }
    if (waiting && pieceWaitFor !== p.id) {
      pieceWaitFor = p.id;
      waiting.then(() => { try { if (!torn && menu?.isOpen?.()) menu.refresh(); } catch { /* gone */ } if (!torn) refreshViews(); });
    }
    if (!rows.length) {
      rows = [{ kind: 'item', id: 'piece-none', disabled: true, ...t,
        label: waiting ? 'Loading its settings…' : `Nothing to set for ${p.label}` }];
    }
    // The same piece, chosen in edit mode in place (the ✎ corner's press, for a scan). Not at "Just the
    // essentials", for "Edit this panel"'s reason. The menu closes first: it would cover the room.
    const edit = complexity() !== 'essential' && p.rec ? [{ kind: 'item', id: 'piece-edit', ...t,
      label: 'Edit the room', hint: `${p.whole ? 'the room' : p.label}, in place: press a piece to see its options`,
      run: () => {
        try { menu.close(); } catch { /* already closed */ }
        bus.publish('shell/edit-panel', { id: ROOM_PANEL_ID, on: true, target: p.objectId || null, from: 'menu' });
      } }] : [];
    return [head, ...rows, ...edit];
  }

  // ---- "SETTINGS FOR" CHOOSES THE LEVEL (2026-10-02; settings.js "LEVELS" is the rule) ----------------
  //
  // Mike: "You should really be able to edit something at whatever level you're editing. That should
  // probably be a dropdown at the top of the settings menu along with how much to show." So the row above
  // the tabs, beside "How much this menu shows", steps through, in this order:
  //     <the selected panel>        this panel (as before: everything the menu always showed)
  //     Every <module> panel        the module level: the kind's own settings, for every panel of it here
  //     This dashboard              only while a dashboard other than this screen's own is showing
  //     This screen                 the screen's row
  //     This device                 this browser's own row (not on an embed)
  //     <the person>                the person this screen is for, once known
  //     <the other panels>          each other panel on the screen, as before
  // The levels come straight after the selected panel because "this, then everything like it, then the
  // screen..." is the chain read outward; the other panels follow because stepping to a SIBLING is the
  // rarer want. FOR putting the levels in a second row: one row stays one stop on the switch walk; a second
  // row would be a stop on every lap for something set once.
  // AT A LEVEL, the first tab is that level's rows: each SHOWS AND EDITS THE VALUE AT THAT LEVEL and, where
  // the level has not set it, says what it follows ("Following: this device — Blue"); its first choice is
  // "Follow <the level above>", so a choice is always undone in the same lap. The other tabs are the
  // screen's and the person's rows as before (a setting with one home has one place).
  // WHICH SETTINGS HAVE LEVELS TODAY, and why only these: Colours and Panel backgrounds (DECISIONS.md
  // 2026-09-30, "theme at every level", and the backgrounds already lived at three), every module's own
  // settings (panel / every panel of its kind), "When this panel is hidden" (the same), and the Layout
  // (the dashboard's, or this screen's). A setting gets a level the day something READS it there --
  // a row offered at a level nothing reads would be a control that does nothing.
  // NOT AT "JUST THE ESSENTIALS": that level is legibility and the ways out, so "Settings for" steps the
  // panels only, as before.
  const LEVEL_PREFIX = 'level:';
  function menuLevel() {
    let id = null;
    try { id = menuView()?.subjectId?.() || null; } catch { id = null; }
    return typeof id === 'string' && id.startsWith(LEVEL_PREFIX) ? id.slice(LEVEL_PREFIX.length) : 'instance';
  }
  const panelName = (r) => (r ? (r.title || r.type) : 'this panel');
  function levelName(lv) {
    if (lv === 'module') return `every ${panelName(focusedRec())} panel`;
    if (lv === 'dashboard') return 'this dashboard';
    if (lv === 'screen') return 'this screen';
    if (lv === 'device') return 'this device';
    if (lv === 'person') return whoState && whoState.name ? whoState.name : 'this person';
    return 'this panel';
  }
  const levelTitle = (lv) => { const s = levelName(lv); return s.charAt(0).toUpperCase() + s.slice(1); };
  function levelSubjects() {
    const recs = menuPanelRecs();
    const panel = (r) => ({ id: r.id, label: r.title || r.type });
    // (2026-10-02: with the scan on a piece of the room, THAT piece comes first -- the selected thing -- and
    // then every panel; "Every <module> panel" is a panel's level, so it is not offered for a piece.)
    const pc = focusedPiece();
    if (complexity() === 'essential') return [...(pc ? [pieceSubject(pc)] : []), ...recs.map(panel)];
    const f = pc ? null : focusedRec();
    const out = [];
    if (pc) out.push(pieceSubject(pc));
    if (f) out.push(panel(f), { id: `${LEVEL_PREFIX}module`, label: levelTitle('module') });
    for (const lv of levelsHere()) out.push({ id: `${LEVEL_PREFIX}${lv}`, label: levelTitle(lv) });
    for (const r of recs) if (!f || r.id !== f.id) out.push(panel(r));
    return out;
  }
  // Where each level's row is written. The dashboard's is the showing dashboard's own doc.
  function levelWriter(lv) {
    if (lv === 'dashboard') return (k, v) => themeDoc().set({ [k]: v });
    if (lv === 'screen') return (k, v) => settings.set({ [k]: v });
    if (lv === 'device') return (k, v) => deviceRow?.set({ [k]: v });
    if (lv === 'person') return (k, v) => personInputs?.set?.({ [k]: v });
    return () => {};
  }
  // The settings that have a level above the panel (see above). Their options are the Display tab's.
  // (seasons, 2026-10-05) While the Colours follow the seasons, a row under them says why this look and what
  // comes next (seasons.js seasonsWhy: "Halloween is on, and it wins over the fall scene." / "Coming up: Fall on
  // Nov 1."). Design: "People trust a theme change more when it says why." Disabled, so it is read, never a
  // stop on the switch walk (the "This screen: <name>" row's shape). For the look SHOWING (seasons.js `at`).
  // (2026-10-07) "Best for this device" says what it picked here and why, first ("Chosen because this device …",
  // theme_default.js), the same disabled shape; when what it picked is "With the seasons", the seasons' own row follows.
  const seasonsWhyItems = () => {
    const out = [];
    const shown = shownTheme();
    if (isDeviceTheme(shown)) {
      try {
        const p = startingTheme();
        const name = String(listThemes().find((t) => t.id === p.theme)?.label || p.theme).split(' — ')[0];
        out.push({ kind: 'item', id: 'device-why', disabled: true, label: `Best for this device: ${name}`,
          hint: `${p.words} Pick any theme to change it.` });
      } catch { /* nothing to say */ }
    }
    if (!followsSeasons(shown)) return out;
    try {
      const c = seasonContext();
      const w = seasonsWhy(new Date(c.at ?? Date.now()), c);
      return [...out, { kind: 'item', id: 'seasons-why', disabled: true, label: w.reason, hint: w.next }];
    } catch { return out; }
  };
  const LEVEL_LOOK_FIELDS = () => [
    // themes (2026-10-06): "Theme", not "Colours" (Mike: "Colours should change to theme"); the key is unchanged.
    // (2026-10-07) Each with its default, so the top level's "Following: the default — …" names what is in force:
    // "Best for this device" and clear panels (theme_default.js; PANEL_SURFACE_DEFAULT above).
    { key: 'theme', label: 'Theme', kind: 'choice', level: 'essential', default: DEVICE_THEME,
      options: listThemes().map((t) => ({ value: t.id, label: t.label })) },
    { key: 'panelSurface', label: 'Panel backgrounds', kind: 'choice', level: 'standard', default: PANEL_SURFACE_DEFAULT,
      options: [{ value: 'solid', label: 'Solid' }, { value: 'veil', label: 'See-through' }, { value: 'clear', label: 'Fully clear' }] },
  ];
  const levelLabels = () => ({ module: levelName('module'), dashboard: levelName('dashboard'), screen: levelName('screen'),
    device: levelName('device'), person: levelName('person') });
  // A module's own settings, as the module level offers them: the ones a switch can step (a text box or a
  // picture is a per-panel thing -- a caption, a photo -- and stays on the panel).
  function typeFields(rec) {
    let fs = [];
    try { fs = fieldsFor(rec.instance.manifest, rec.instance) || []; } catch { fs = []; }
    return fs.filter((f) => f && f.cycleable && f.kind !== 'picture' && !f.readOnly);
  }
  // *** "SEE REVIEWS…" UNDER "INCLUDE UNREVIEWED QUESTIONS" (2026-10-04; page_links.js). *** Trivia's row turns
  // reviewing on; the list of what has been reviewed, flagged and is still waiting was a page nothing linked to.
  // A ROW OF ITS OWN straight under it (after its "follow" row, if any), not words in its hint: a hint is not a
  // control, and a switch has to be able to reach it. Keyed by the SETTING, not by "trivia", so any module that
  // declares the same review setting gets the same link. Off a screen it opens /reviews.html in a new tab; on a
  // screen it shows the address and a code (the menu page). Not at "Just the essentials". In place, on `rows`.
  const REVIEW_SETTING_KEY = 'includeUnreviewed';
  function withReviewsLink(rows) {
    if (complexity() === 'essential') return rows;
    const at = rows.findIndex((it) => it && it.kind === 'item'
      && (it.key === REVIEW_SETTING_KEY || /(^|:)includeUnreviewed$/.test(String(it.id || ''))));
    if (at < 0) return rows;
    const base = String(rows[at].id || '');
    let end = at;
    while (end + 1 < rows.length && base && String(rows[end + 1]?.id || '').startsWith(`${base}:`)) end += 1;
    rows.splice(end + 1, 0, pageRow('reviews', { isScreen: !embedded,
      over: { id: 'see-reviews', label: 'See reviews…', ...MENU_TAB.module(0) } }));
    return rows;
  }
  function levelRows(lv) {
    const t = MENU_TAB.module(0);
    const tag = (rows) => rows.map((it) => ({ ...it, ...t }));
    if (lv === 'module') {
      const rec = focusedRec();
      if (!rec) return [{ kind: 'item', id: 'level-none', disabled: true, label: 'No panel selected', ...t }];
      const name = panelName(rec);
      const sounds = makesSound({ instanceId: rec.id, audio, manifest: rec.instance.manifest });
      const fields = [...typeFields(rec),
        ...(sounds ? [{ ...WHEN_HIDDEN_FIELD, default: whenHiddenDefault(rec.instance.manifest) }] : [])];
      const rows = levelFieldItems(fields, {
        level: 'module', order: ['module'], layers: () => ({ module: typeDefaults(rec.type) || {} }),
        write: (k, v) => writeTypeDefault(rec.type, k, v), complexity: complexity(),
        labels: levelLabels(), idPrefix: 'level:module:', defaultLabel: `${name}’s own default`,
      });
      withReviewsLink(rows);
      return tag([
        { kind: 'heading', id: 'level-head', label: `Every ${name} panel on this screen — a panel that has not chosen follows these` },
        ...(rows.length ? rows : [{ kind: 'item', id: 'level-none', disabled: true, label: `Nothing to set for every ${name} panel` }]),
      ]);
    }
    const order = levelsHere();
    const rows = levelFieldItems(LEVEL_LOOK_FIELDS(), {
      level: lv, order, layers: () => levelLayers(), complexity: complexity(), labels: levelLabels(),
      idPrefix: `level:${lv}:`, defaultLabel: 'the default',
      write: (k, v) => {
        levelWriter(lv)(k, v);
        try { syncShownTheme(); } catch { /* the settings subscribe re-applies it too */ }
        // A theme picked by somebody at this screen (the board's symbol-set offer listens; see the Colours row).
        if (k === 'theme' && v) bus.publish('screen/theme-picked', { theme: v, level: lv });
      },
    });
    // The Layout row: at the dashboard's level, or at the screen's when the dashboard IS the screen.
    const layoutHere = (lv === 'dashboard' || (lv === 'screen' && !dashDistinct())) && canChangeLayout();
    return tag([
      { kind: 'heading', id: 'level-head', label: `${levelTitle(lv)} — what it shows when nothing more particular has chosen` },
      ...rows,
      ...(layoutHere ? [layoutRow()] : []),
      ...(lv === 'device' ? deviceLookRows() : []),
    ]);
  }

  // *** "FONT ON THIS DEVICE" AND "COLOUR LOOK", FOR A SWITCH (2026-10-02; 1392018 / b8d918e). *** They lived
  // only on the "Your own folders" page, which a switch cannot walk (that page argues why: its folder
  // buttons open dialogs the browser draws). Both are THIS DEVICE's choices (this browser's storage, like the
  // device row), so they are rows of "Settings for: This device" -- the same rows, storage and write path as
  // the page (user_folders_page.js `createDeviceLookRows`). A switch steps a short list; a long one opens
  // the choice picker, which it scans. Nothing found here: each row is still shown, dimmed, saying why.
  // WHY HERE AND NOT THE DISPLAY TAB (argued): Display's rows are the screen's and follow the screen to
  // whoever opens it; these follow the DEVICE (a font file is on this computer, not on the account), and
  // the device level is where the menu already says "this device". AGAINST: one more press to reach them
  // ("Settings for" to This device). A font is set once, so the press is spent once.
  // Read when the menu first draws them, once per opening (`onClose` forgets the reading), and the menu
  // redraws when the reading or a write settles. Never prompts.
  let deviceLookCtl = null;
  let deviceLookRead = null;
  const redrawMenu = () => { try { if (!torn && menu?.isOpen?.()) menu.refresh(); } catch { /* gone */ } if (!torn) refreshViews(); };
  function deviceLookRows() {
    if (!deviceRow) return [];
    if (!deviceLookCtl) {
      try { deviceLookCtl = createDeviceLookRows({ ...(deviceLooks || {}), onChange: () => redrawMenu() }); }
      catch (err) { console.error('kiosk: device font and look rows', err); return []; }
    }
    if (!deviceLookRead) deviceLookRead = Promise.resolve(deviceLookCtl.read()).then(() => redrawMenu(), () => redrawMenu());
    let rows = [];
    try { rows = deviceLookCtl.rows(); } catch (err) { console.error('kiosk: device font and look rows', err); rows = []; }
    return [{ kind: 'heading', id: 'uf-head', label: 'Font and colour look on this device' }, ...rows];
  }

  // *** "IN THE SWITCH SCAN: YES / NO" FOR A PLACED PANEL (2026-10-02; c93a1ec). *** A panel placed freely
  // can be left out of the switch lap (its layout entry's `scan: false`, or a module that declares
  // `overlayScan: 'skip'`, as the floating scoreboard does). The only way back in was a button ON that
  // panel - which a switch cannot reach while the panel is out of the lap. "Settings for" does reach every
  // panel, in the lap or not (arrangement.js `panelRecs`), so the choice is a row of the panel's own tab,
  // and it writes exactly what the panel's button writes: `shell/place { id, scan }`, which the dashboard
  // showing it applies in place and saves (arrangement.js "A PANEL ASKS TO FLOAT").
  //   Only on a PLACED panel: a panel in a grid slot is always in the lap (the arrangement refuses the change).
  //   AT EVERY LEVEL OF "How much this menu shows", "Just the essentials" included, argued: it is the switch's
  //   only way back to a panel it cannot reach, and that is what that level keeps (the ways out). AGAINST: one
  //   more stop on the panel's tab - but only for a placed panel, and only while it is the menu's subject.
  //   The row says what is true NOW (the lap as the dashboard has it: `focusRing`), not what was last asked.
  let lapNote = null;                      // { id, text }: the last change nobody answered
  const placedHere = (id) => { try { return (arr.placedRecs || []).some((r) => r && r.id === id); } catch { return false; } };
  const inLapNow = (id) => { try { return (focusRing() || []).some((s) => s && s.id === id); } catch { return true; } };
  function inLapRow(rec) {
    if (!rec || !placedHere(rec.id)) return null;
    const on = inLapNow(rec.id);
    const note = lapNote && lapNote.id === rec.id ? lapNote.text : '';
    return { kind: 'item', id: 'scan-lap', ...MENU_TAB.module(0),
      label: `In the switch scan: ${on ? 'yes' : 'no'}`,
      hint: note || (on ? `${panelName(rec)} is a stop on every lap; press to leave it out`
        : `${panelName(rec)} is left out of the lap; press to put it back in`),
      run: () => setInLap(rec.id, !on) };
  }
  function setInLap(id, on) {
    let taken = false;
    lapNote = null;
    try {
      bus.publish(PLACE_REQUEST_TOPIC, { id, scan: !!on, claim: () => { taken = true; },
        reply: (r) => {
          lapNote = r && r.ok === false ? { id, text: `that did not change (${r.reason || 'the dashboard said no'})` } : null;
          redrawMenu();
        } });
    } catch (err) { console.error('kiosk: in the switch scan', err); }
    if (!taken) { lapNote = { id, text: 'nothing on this screen answered, so nothing changed' }; redrawMenu(); }
  }

  // ---- THE LAYOUT, FROM THE MENU (2026-10-02). Mike: "an easy way to change the layout of any dashboard.
  // Probably more choices for layouts." ----------------------------------------------------------------
  // "Layout: <what it is>…" on the dashboard's level opens a short list in the same tab (the "Switch module"
  // shape: Keep first, where the cursor starts, then each arrangement), so a switch walks it and Back leaves
  // it. NOT a row that cycles: every arrangement remounts the panels, and a cycle would remount them on
  // every press on the way to the one wanted. Picking one writes the dashboard's own row and rebuilds the
  // panels IN PLACE (no reload: full screen, a call, the camera all carry on); the panels keep their places
  // in order, a bigger arrangement fills from the panels not shown, a smaller one keeps the rest for when it
  // is bigger again (layout.js `withPreset`). Offered where a rebuild in place exists: this screen's own
  // dashboard on either path, or any dashboard showing on the dashboard path; not a preview or an embed.
  let layoutOpen = false;
  function canChangeLayout() {
    if (embedded || previewLayout) return false;   // a preview's arrangement is a one-shot, never saved
    if (useDashboard) return !!dash;
    return profileId === bootProfileId;
  }
  function layoutDoc() { return useDashboard ? themeDoc() : settings; }
  function currentPreset() {
    const l = arr.layout();
    return l ? (LAYOUT_PRESETS.find((p) => p.id === l.preset) || null) : null;
  }
  function layoutRow() {
    const p = currentPreset();
    return { kind: 'item', id: 'layout-pick', label: `Layout: ${p ? p.label : 'One at a time'}…`,
      hint: 'more ways to arrange the panels', run: () => { layoutOpen = true; const v = menuView(); v.refresh(); v.focusRow('layout-keep'); } };
  }
  function layoutRows() {
    const cur = currentPreset();
    const t = MENU_TAB.module(0);
    return [
      { kind: 'heading', id: 'layout-head', label: 'Arrange the panels as', ...t },
      { kind: 'item', id: 'layout-keep', label: `Keep ${cur ? cur.label : 'one at a time'}`, hint: 'leave it as it is', ...t,
        run: () => { layoutOpen = false; const v = menuView(); v.refresh(); v.focusRow('layout-pick'); } },
      ...LAYOUT_PRESETS.map((p) => ({ kind: 'item', id: `layout:${p.id}`, label: p.label, ...t,
        hint: `${p.slots} panel${p.slots === 1 ? '' : 's'}${cur && cur.id === p.id ? ' · now' : ''}`,
        run: () => { applyLayoutPreset(p.id).catch((err) => console.error('kiosk: layout', err)); } })),
    ];
  }
  async function applyLayoutPreset(id) {
    if (!canChangeLayout()) return false;
    const doc = layoutDoc();
    const cur = (doc.get?.() || {}).kiosk || {};
    const mods = arr.profile()?.modules || [];
    const next = withPreset(cur.layout, id, mods, { spareOk: (m) => getManifest(m.type)?.mount !== 'ambient' });
    layoutOpen = false;
    // (2026-10-04: NO BASE NEEDED HERE, checked -- read above and written below with nothing waited on between, so
    // a change already heard is in `cur`; one not yet heard is the server's refusal, merged by the doc itself
    // (doc_merge.js `mergeSettingsDoc`). kiosk_test's "last writers" section proves the first.)
    // Told FIRST: the 09-12 watch hears this write synchronously, and must not reload for a change this
    // file is about to apply in place.
    expectLayoutSig = JSON.stringify(next);
    doc.set({ kiosk: { ...cur, layout: next } });
    try {
      if (useDashboard && dash) {
        await doc.flush?.().catch?.(() => {});
        await swapDashboard(profileId, { remember: false });
      } else {
        arr.resolve(next);
        await applyModules();
      }
    } catch (err) { console.error('kiosk: rearranging', err); }
    try { if (menu.isOpen()) { menu.refresh(); menu.focusRow('layout-pick'); } } catch { /* the menu may be gone */ }
    refreshViews();
    renderMods();
    return true;
  }

  const SCREEN_FIELDS = () => [
    // COLOURS. Themes are already per-screen (`theme.js`, DECISIONS.md) and the kiosk already
    // applies one — there was simply no way to change it from the screen it applies to.
    // `essential`, because on a bedside screen this is a legibility control, not decoration:
    // it is the row somebody reaches for when the person in front of it cannot read what is
    // there.
    // (2026-10-03: its list -- every theme a tile in its own colours, choice_picker.js -- is what the Settings
    // panel's old Theme page drew, so that page is now this row's own list: the guide's 'sc-theme' opens it.)
    // (themes, 2026-10-06: called "Theme" now, on the Theme tab; its list is the theme gallery - a still of every
    // theme, the holidays included, with search, order and filters - and the Themes panel shows the same list.)
    // (2026-10-07: the default is "Best for this device", theme_default.js; the row under this one says what it
    // picked here and why.)
    { key: 'theme', label: 'Theme', kind: 'choice', level: 'essential',
      default: DEVICE_THEME,
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
        { value: 'drift', label: 'Slowly shift the picture when idle (for OLED screens)' },
      ] },
    // Mike, 2026-09-23: "I would make the backgrounds transparent/translucent wherever
    // possible." `standard`, not `essential`, matching `burnIn` above -- a preference, not a
    // legibility escape hatch. (2026-10-07: the default is `clear`, PANEL_SURFACE_DEFAULT, argued there.)
    { key: 'panelSurface', label: 'Panel backgrounds', kind: 'choice', level: 'standard',
      default: PANEL_SURFACE_DEFAULT,
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'veil', label: 'See-through' },
        { value: 'clear', label: 'Fully clear' },
      ] },
    // SEASONS AND THE SKY (2026-10-05; sky.js argues both defaults). Each row only where it changes something
    // anybody can see -- a row tuning a thing that is off is a stop on the switch walk for nothing: "Holiday
    // looks" while the Colours follow the seasons, "Wallpaper follows the sky outside" while the scene showing
    // answers to the weather or the time of day (seasons.js SCENE_SKY). So on any other theme the menu's rows
    // are exactly what they were.
    // (seasons, 2026-10-05) "Holiday looks" is now one row per holiday (sky.js HOLIDAY_FIELDS argues the eleven
    // stops), each naming its next dates ("Halloween look, Oct 25 to Oct 31"). A screen that saved the old
    // single "Off" shows them all off.
    ...(followsSeasons(shownTheme()) ? HOLIDAY_FIELDS.map((f) => ({ ...f,
      default: readScreen()[HOLIDAYS_KEY] === false ? false : f.default,
      label: (() => { try { return holidayRowLabel(f.holiday); } catch { return f.label; } })() })) : []),
    ...(sceneTakesSky(paintedTheme(shownTheme()).scene) ? [{ ...SKY_FIELD, options: SKY_FIELD.options.map((o) => ({ ...o })) }] : []),
    // Space between panels (2026-10-02 evening): none by default, so four up is four quarters.
    { ...PANEL_GAP_FIELD, options: PANEL_GAP_FIELD.options.map((o) => ({ ...o })) },
    // "Show a small clock" (2026-10-03; arrangement.js SMALL_CLOCK_FIELD argues it): off or a corner. Only where
    // it can act (`canOverlayHere`: Home, or a screen whose arrangement this menu may change).
    ...(hostHandles('smallclock') || canAddHere() ? [{ ...SMALL_CLOCK_FIELD, options: SMALL_CLOCK_FIELD.options.map((o) => ({ ...o })) }] : []),
    // 2026-10-02 (room_lod.js): how much detail 3D rooms draw on THIS device -- measured, or chosen by somebody
    // who knows better (a fast Pi 5, a slow laptop on battery). `advanced`, as room_lod.js declares it.
    { ...DETAIL_FIELD },
    // HOW LONG TO HOLD A SWITCH FOR THE PLAIN BAR (Stage 3b; only where there is a plain bar -- the
    // dashboard path). Design's 1.5 s, settable 1-3 s (Rule 1: a setting, not a constant). `essential`:
    // like the complexity row, it is part of the way OUT, and a way out that a level can hide is not one.
    ...(useDashboard ? [{ key: 'plainBarHoldMs', label: 'Hold a switch this long for the plain bar',
      kind: 'choice', level: 'essential', default: PLAIN_BAR_HOLD_DEFAULT_MS,
      options: [1000, 1500, 2000, 2500, 3000].map((ms) => ({ value: ms, label: `${ms / 1000} seconds` })) }] : []),
    // bar toggle (2026-10-06; bar_toggle.js argues both rows and why there are two). The SCREEN's, beside the hold row:
    // they are about the keys and the hands in front of this device, the same reason that row is the screen's.
    { ...BAR_QUIET_FIELD, options: BAR_QUIET_FIELD.options.map((o) => ({ ...o })) },
    { ...BAR_SELF_FIELD, options: BAR_SELF_FIELD.options.map((o) => ({ ...o })) },
    // bar while playing (row 2.65; bar_toggle.js argues the default): the screen's too, for the same reason.
    { ...BAR_PLAY_FIELD, options: BAR_PLAY_FIELD.options.map((o) => ({ ...o })) },
    // Hide = mute (ad7dc49): how long the "hidden panel: keep playing / mute / pause?" card waits.
    HIDE_ASK_TIMEOUT_FIELD,
    // STEP 6 STAGE 4: which way a real screen is put together (`dashboardPathFor`). `advanced`: it is a
    // switch for whoever is testing the change, not something a person sets up a screen with. Picking
    // the other one restarts the screen (the path watch), because the two build different things.
    ...(!embedded ? [{ key: DASHBOARD_MODULE_KEY,
      label: 'Put this screen together as one dashboard (new, being tested; restarts the screen)',
      kind: 'toggle', level: 'advanced', default: !!dashboardDefault, onLabel: 'Yes', offLabel: 'No' }] : []),
    // ROW 2.34: whether Home's picker offers the ready-made dashboards (dashboards.js argues the default).
    ...(!embedded ? [{ ...DASHBOARD_OFFERS_FIELD }] : []),
    // ROW 2.38: how long the dashboards tray waits between presses, and how many levels of a dashboard
    // shown inside a dashboard move live. Both argued in dashboard_nest.js; both the SCREEN's (the
    // device pays for live levels; the tray belongs to this screen's bar).
    ...(!embedded ? [{ ...TRAY_OPEN_FIELD }, { ...NEST_LIVE_DEPTH_FIELD }] : []),
    // ROW 2.38, the map editor: how long the edit windows wait with nobody pressing (dashboard_nest.js).
    { ...EDIT_IDLE_FIELD },
    // 2026-10-02 (call_notice.js): a call to this screen when it has no Call panel - a notice to answer or
    // decline (the default), or no ring here at all. The SCREEN's: it is about this room (a bedroom screen
    // that should not ring at night, a hallway one that should), not the person, who rings on every screen.
    // Not on an embed (an embed never has the drive socket a call arrives on).
    ...(!embedded ? [{ ...CALL_NOTICE_FIELD }] : []),
    // 2026-10-04 (version_watch.js argues the default, OFF: a live screen is never changed remotely, so following
    // deploys is chosen per screen - the bench turns it on): this screen restarts itself once for a new version
    // of the site, only when nothing is going on. The SCREEN's: it is about this device and its room. Not on an
    // embed (an embed never reloads the page it sits on).
    ...(!embedded ? [{ ...PICK_UP_FIELD }] : []),
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
  // *** MOVEMENT AND FLASHING (2026-09-30): zoom on focus (row 2.37 item 6) and the flash limit (rows
  // 2.43/2.48), under their own heading after the screen's rows and before Sound. *** Argued:
  //   * WHY TOGETHER: both are about what moves or changes on this screen, and the person looking for
  //     "things flash" is the person who also wants to know whether things grow when focused.
  //   * WHY THE SCREEN'S ROW, not the person's: a screen in a room is seen by everybody in it, so the
  //     limit belongs to the place (flashLimitFrom also reads the person's row, and the stricter of the
  //     two wins - a person's own lower choice still protects them on any screen). AGAINST: somebody
  //     who needs 1 a second has to set it on each screen they use. On Mike's list.
  //   * WHY `standard` (as both files declare it), not `essential`: neither is a way out or a legibility
  //     control, and "Just the essentials" is kept to those. (8a89e31: the flash limit defaults to NO
  //     limit; the row shows what the starting-defaults layer set -- a screen whose photosensitivity box
  //     set 3 reads 3 here -- via `flashLimitFieldWith`.)
  //   * Faces moving (ba4d79d) sits with them: it is the same question, what moves on this screen.
  //   * Other people's own avatars (OTHERS_AVATAR_FIELDS, 2026-10-02) sit with faces moving: the screen's
  //     copy is the place's choice and WINS over the person's (avatar_display.js argues the precedence).
  const MOTION_FIELDS = () => [ZOOM_FOCUS_FIELD, flashLimitFieldWith(startingLayer()), AVATAR_MOTION_FIELD,
    ...OTHERS_AVATAR_FIELDS];

  // THE ROOM ON THIS SCREEN, if any: the focused panel when it is a room, else the first room mounted.
  // Only a MOUNTED room -- its reactions editor opens inside it, so a room that is not on the screen
  // has nowhere to open one.
  function roomRec() {
    const f = focusedRec();
    if (f?.type === 'room') return f;
    return [arr.stageRec(), ...(arr.slotRecs || []), ...(arr.placedRecs || [])].find((r) => r?.type === 'room') || null;
  }
  // THE BAR ON THE ROOM'S LOW CABINET (room_bar.js): offered only where it can happen -- a real screen's
  // dashboard whose room has an object that holds the bar (its placed bar is the one that moves).
  function barCanSitOnCabinet() {
    if (!useDashboard || embedded || !dash) return false;
    try { return !!dash.impl.canHoldBar?.(); } catch { return false; }
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
    // The ranked list's rows (rows 2.46/2.47): none for the browser's own; a computer's rows only while
    // a pass uses it; the third pass only after a second.
    speechPass2: (r) => !usesBrowser(r),
    speechPass3: (r) => !usesBrowser(r) && passUses(r).length > 1,
    speechRemote1Name: (r) => passUses(r).includes('remote1'),
    speechRemote1Url: (r) => passUses(r).includes('remote1'),
    speechRemote1Key: (r) => passUses(r).includes('remote1'),
    speechRemote2Name: (r) => passUses(r).includes('remote2'),
    speechRemote2Url: (r) => passUses(r).includes('remote2'),
    speechRemote2Key: (r) => passUses(r).includes('remote2'),
    speechLocalUrl: (r) => passUses(r).includes('local'),
    speechSureAt: (r) => !usesBrowser(r),
    speechWaitMs: (r) => !usesBrowser(r),
    speechEndMs: (r) => !usesBrowser(r),
    speechEars: (r) => !usesBrowser(r),
  };
  const usesBrowser = (r) => speechSwitchFrom(r).engine === 'browser';
  // Every slot the person put in the list, with or without an address (so the address row can appear).
  function passUses(r) {
    if (usesBrowser(r)) return [];
    const list = [speechSwitchFrom(r).engine, r.speechPass2, r.speechPass3];
    return [...new Set(list.filter((s) => ['local', 'remote1', 'remote2'].includes(s)))];
  }
  function voiceStatusItem() {
    const r = personRow || {};
    const browser = speechSwitchFrom(r).engine === 'browser';
    const row = (label, hint) => ({ kind: 'item', id: 'voice-status', disabled: true, label, ...(hint ? { hint } : {}) });
    // What the ranked recogniser reports (rows 2.46/2.47): which engines answer, and where the sound goes.
    let st = null;
    try { st = speechRec?.status?.() || null; } catch { st = null; }
    const ready = (st?.engines || []).filter((e) => e.state === 'ready');
    const firstPass = (st?.engines || [])[0] || null;
    const away = ready.filter((e) => e.slot !== 'local').map((e) => e.name);
    const maker = browserVoiceMaker();
    const goes = browser ? `the room’s sound goes to ${maker === 'the browser’s maker' ? maker : `${maker}, the browser’s maker`}`
      : away.length ? `the room’s sound goes to: ${away.join(', ')}` : '';
    const online = onlineCap ? 'subtitles also send the room’s sound to the browser’s maker' : '';
    const hints = (...xs) => xs.filter(Boolean).join('; ');
    if (speechStatus === 'no-local') {
      if (st && !(st.engines || []).length && (st.skipped || []).length) {
        return row(`Not listening: ${st.skipped[0].name} has no address yet`, 'the room’s sound is not sent anywhere');
      }
      if (firstPass && firstPass.slot !== 'local') {
        return row(`Not listening: ${firstPass.name} is not answering`, 'nothing is recorded until it answers');
      }
      return row('Not listening: no speech program is running on this computer', hints('the room’s sound is not sent anywhere', online));
    }
    if (speechStatus === 'no-browser') return row('Not listening: this browser has no recogniser of its own');
    if (speechStatus === 'no-mic') return row('Not listening: the microphone could not be opened');
    if (speechStatus === 'blocked') return row('Not listening yet: the browser is holding sound until the screen is touched');
    if (speechStatus === 'listening') {
      return row(`Listening for “${speech?.wakePhrases?.()?.[0] || 'the wake phrase'}”`, hints(goes, online));
    }
    if (speechStatus === 'subtitles-only') return row('Writing down what is said (spoken commands are off)', hints(goes, online));
    return null;
  }
  // *** NO SPEECH PROGRAM ON THIS COMPUTER: SAY HOW TO GET ONE, AND OFFER THE NO-INSTALL CHOICE (DECISIONS 2026-10-07
  // item 3; nimrod_helper.js). *** Under the status row, two rows a person can press: the helper's page (a screen shows
  // its address and a code, page_links.js), and this browser's own voice typing, its row naming who receives the
  // sound. Only for "this computer" being the one not answering - a chosen other computer, or one with no address,
  // has its own status line and nothing here would fix it. Nothing switches to the browser's by itself.
  function noSpeechProgramHere() {
    if (speechStatus !== 'no-local') return false;
    let st = null;
    try { st = speechRec?.status?.() || null; } catch { st = null; }
    if (st && !(st.engines || []).length && (st.skipped || []).length) return false;
    const firstPass = (st?.engines || [])[0] || null;
    return !firstPass || firstPass.slot === 'local';
  }
  function noSpeechProgramItems() {
    if (!noSpeechProgramHere()) return [];
    const rows = [pageRow('helper', { isScreen: !embedded })];
    if (browserHasVoiceTyping()) {
      rows.push({ kind: 'item', id: 'voice-use-browser', label: browserVoiceLabel(browserVoiceMaker()),
        hint: 'nothing to install; it is used only once you choose it here',
        run: () => { try { personInputs?.set?.({ speechEngine: 'browser' }); } catch (err) { console.error('kiosk: voice typing', err); } } });
    }
    return rows.filter(Boolean);
  }
  // *** SETTING UP AND FORGETTING THIS PERSON'S VOICE ON THIS COMPUTER (row 2.56, voice_id.js). *** Under the Voice
  // heading, only when the speech program answering here offers it: "Set up my voice" - THE OPT-IN, reading five
  // sentences aloud - and, once set up, "Forget my voice". The voiceprint is kept by the speech program, on its own
  // computer; this page never holds it. Never a lock: nothing on the site is allowed or refused by it.
  function voiceIdItems(r) {
    if (!personId || !speechRec?.voiceId || !voiceIdOptionsFrom(r).on) return [];
    let able = false;
    try { able = !!speechRec.voiceId.available(); } catch { able = false; }
    if (!able) return [];
    const name = (whoState && whoState.name) || '';
    const mine = (voicePrints || []).some((p) => p.person === String(personId));
    const rows = [{ kind: 'item', id: 'voice-id-setup',
      label: mine ? 'Set up my voice again' : 'Set up my voice, so what I say is labelled with my name',
      hint: 'read five sentences aloud; only numbers that describe the voice are kept, on this computer',
      run: () => startEnrolment(name) }];
    if (mine) {
      rows.push({ kind: 'item', id: 'voice-id-forget', label: 'Forget my voice on this computer',
        hint: 'deletes it; what you say is still written down, as "Unknown"',
        run: () => { try { speechRec?.voiceId?.forget(String(personId)); } catch (err) { console.error('kiosk: forget voice', err); } } });
    }
    return rows;
  }
  function startEnrolment(name) {
    try { menu.close(); } catch { /* already closed */ }
    try { enrolment?.cancel(); } catch { /* already over */ }
    try { enrolPanel?.close(); } catch { /* already closed */ }
    const voice = speechRec?.voiceId;
    if (!voice || !personId) return;
    const mine = createEnrolment({ voice, person: String(personId), name,
      onChange: (s) => { if (enrolment === mine) { try { enrolPanel?.draw(s); } catch { /* panel gone */ } } } });
    enrolment = mine;
    try { enrolPanel = mountEnrolment(kioskEl, mine, { onClosed: () => { if (enrolment === mine) { enrolment = null; enrolPanel = null; } } }); }
    catch (err) { console.error('kiosk: voice set-up panel', err); enrolPanel = null; }
    mine.start();
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
      ...(sw.on || subsOn ? SPEECH_PASS_FIELDS.filter(keep) : []),
      // THIS PERSON'S OWN VOICE MODEL (voice_model.js): with the other "what listens" rows, while anything listens.
      ...(sw.on || subsOn ? VOICE_MODEL_FIELDS : []),
      // WHO IS TALKING (voice_id.js, row 2.56): the switch while anything listens; "how sure" only while it is on.
      ...(sw.on || subsOn ? VOICE_ID_FIELDS.filter((f) => f.key === 'voiceIdOn' || voiceIdOptionsFrom(r).on) : []),
      ...(sw.on ? [...SPEECH_FIELDS, ...LISTENING_FIELDS, ...MISS_FIELDS].filter(keep) : []),
      ...SUBTITLES_FIELDS.filter((f) => f.key === 'subtitlesOn' || (subsOn && (!/^subtitles(Shrink|SmallestPx)$/.test(f.key) || r.subtitlesStyle === 'eyechart' || subtitles?.style?.() === 'eyechart'))),
      ...AMPLIFY_FIELDS.filter((f) => f.key === 'amplifyOn' || ampOn),
      // VOICE RECORDING (row 2.44): the switch always (so anybody can SEE it is off, and a guardian
      // can find it); its retention rows only while it is on - the same rule as every mode above.
      ...VOICE_RECORDING_FIELDS.filter((f) => f.key === 'voiceRecording' || r.voiceRecording === true),
      // THE INTERCOM'S rows only once somebody is on its approved list (edited on the home page, where
      // the grants are): with nobody approved there is no intercom to tune.
      ...(normalizeAllowed(r.intercomAllowed).length ? INTERCOM_FIELDS : []),
      // OTHER PEOPLE'S OWN AVATARS, the PERSON's copy (avatar_display.js; the screen's copy is on Display,
      // with faces moving, and wins where it chose). On the People tab, argued: FOR Display (it is about
      // what is drawn): the screen's copy is already there, and the same row twice on one tab reads as a
      // duplicate. FOR People (chosen): it is this person's say about OTHER PEOPLE showing up on their
      // screens, which is what the tab is for, beside who may talk in on the intercom.
      ...OTHERS_AVATAR_FIELDS,
    ];
    const items = fieldItems(fields.map(normalizeField).filter(Boolean), {
      values: () => personInputs?.get?.() || {},
      level: complexity(),
      onStep: (key, value) => { try { personInputs?.set?.({ [key]: value }); } catch (err) { console.error('kiosk: voice setting', err); } },
    });
    if (!items.length) return [];
    const status = voiceStatusItem();
    // *** THE TABS (2026-10-02): the voice section is four things, and each goes where somebody would
    // look for it. *** Spoken commands, what they listen with and the voice recording are DEVICES (an
    // input, like a switch); subtitles are DISPLAY (words on the screen); amplify is SOUND (a hearing aid
    // through the speaker); the intercom is PEOPLE (who may talk in). Every row is in exactly one, under
    // its own heading; the rules above for which rows show are unchanged.
    const keyOf = (it) => String(it.id || '').replace(/^set:/, '');
    const SUBS = new Set(SUBTITLES_FIELDS.map((f) => f.key));
    const AMP = new Set(AMPLIFY_FIELDS.map((f) => f.key));
    const IC = new Set(INTERCOM_FIELDS.map((f) => f.key));
    const OTH = new Set(OTHERS_AVATAR_FIELDS.map((f) => f.key));
    const group = (set) => items.filter((it) => set.has(keyOf(it)));
    const subs = group(SUBS), amp = group(AMP), ic = group(IC), oth = group(OTH);
    const dev = items.filter((it) => !SUBS.has(keyOf(it)) && !AMP.has(keyOf(it)) && !IC.has(keyOf(it)) && !OTH.has(keyOf(it)));
    const t = MENU_TAB;
    return [
      ...(dev.length || status ? [{ kind: 'heading', id: 'voice-head', label: 'Voice', ...t.devices(0) },
        ...(status ? [{ ...status, ...t.devices(0) }] : []),
        ...noSpeechProgramItems().map((it) => ({ ...it, ...t.devices(0) })),
        ...dev.map((it) => ({ ...it, ...t.devices(0) })),
        ...((sw.on || subsOn) ? voiceIdItems(r).map((it) => ({ ...it, ...t.devices(0) })) : [])] : []),
      ...(subs.length ? [{ kind: 'heading', id: 'subtitles-head', label: 'Subtitles', ...t.display(4) },
        ...subs.map((it) => ({ ...it, ...t.display(4) }))] : []),
      ...(amp.length ? [{ kind: 'heading', id: 'amplify-head', label: 'Amplify the room', ...t.audio(3) },
        ...amp.map((it) => ({ ...it, ...t.audio(3) }))] : []),
      ...(ic.length ? [{ kind: 'heading', id: 'intercom-head', label: 'Intercom', ...t.people(1) },
        ...ic.map((it) => ({ ...it, ...t.people(1) }))] : []),
      ...(oth.length ? [{ kind: 'heading', id: 'others-avatars-head', label: 'Other people’s avatars', ...t.people(2) },
        ...oth.map((it) => ({ ...it, id: `person:${keyOf(it)}`, ...t.people(2) }))] : []),
    ];
  }

  // THE PERSON'S USUAL STARTING LEVEL FOR QUESTION GAMES (2026-10-06; adaptive_play.js openPersonLadder argues it).
  // Mike: a start changed in a game's own menu is for that person in that game, "Not the global settings". This is
  // the global one: the person's, on their own `ratings` row, for every game with no start of its own for them. On
  // the People tab, under its own heading. Opened the first time the menu is built for this person.
  let usualStart = null;
  function usualStartItems() {
    if (!personId || embedded || torn) return [];
    if (usualStart?.personId !== personId) {
      try { usualStart?.destroy(); } catch { /* gone */ }
      try {
        usualStart = openUsualStart({ makePersonState: childCtx({ id: 'games' }).makePersonState, personId,
          onChange: () => { if (!torn) menu.refresh(); } });
      } catch (err) { console.error('kiosk: usual starting level', err); usualStart = null; }
    }
    if (!usualStart) return [];
    const rows = fieldItems([normalizeField(usualStart.field)], {
      values: () => usualStart?.values() || {},
      level: complexity(),
      onStep: (key, value) => { try { usualStart?.set(value); } catch (err) { console.error('kiosk: usual starting level', err); } },
    });
    return rows.length ? [{ kind: 'heading', id: 'games-start-head', label: 'Games', ...MENU_TAB.people(3) },
      ...rows.map((it) => ({ ...it, id: `person:${String(it.id || '').replace(/^set:/, '')}`, ...MENU_TAB.people(3) }))] : [];
  }

  // ---- players (2026-10-06): THE PLAYERS TAB (MENU_TAB_DEFS argues the tab; player_picker.js the picker) ----------
  // ONE ROW, "Players", on the screen's own row (`screenPlayers`): a press opens the shared player picker (how many, and
  // who sits where: this login's people, the people connected to it, guests). Empty is the screen's person alone, which
  // is what every game did before, so nothing changes for anybody who never opens it. STANDARD, not essential: the
  // games' own "Players" rows are standard, and a menu kept to the essentials is one kept short for the person at the
  // screen, not one somebody sets a game up from. [A guess, on Mike's list.]
  const SCREEN_PLAYERS_FIELD = Object.freeze({
    key: SCREEN_PLAYERS_KEY, label: 'Players', kind: 'players', follow: false, max: MAX_SEATS, level: 'standard',
    note: 'Every game with players uses these, unless its own “Players” picks others.',
  });
  // The picker's people: as the person this screen is for sees them (their own "I call them" first), kept for names.
  function playerHostNow() {
    const self = screenPlayersHost.self();
    return {
      self,
      screenSeats: screenPlayersHost.seats(),
      guests: playerGuestsOnScreen(),
      people: profiles.people
        ? () => Promise.resolve(self.id ? profiles.people(self.id) : profiles.people())
          .catch(() => profiles.people())      // a host whose list takes no viewer: the login's names
          .then((list) => { playerPeople = list || []; return playerPeople; })
        : null,
    };
  }
  // Guest names already used on this screen (its own players and every panel's), offered again without typing.
  function playerGuestsOnScreen() {
    const out = [];
    const add = (v) => { for (const s of normalizeSeats(v)) if (s.kind === 'guest') out.push(s.name); };
    try { add((settings.get() || {})[SCREEN_PLAYERS_KEY]); } catch { /* not yet */ }
    for (const r of menuPanelRecs()) { try { add(r?.state?.get?.()?.players); } catch { /* a panel without state */ } }
    return out;
  }
  // A players row's words, with the screen's person's name and the people's names as this login knows them now.
  function withPlayerNames(rows) {
    const selfName = screenPlayersHost.self().name;
    return rows.map((it) => {
      if (!it || !it.players) return it;
      const words = playersValueLabel(it.players.value, { follow: it.players.follow, selfName, people: playerPeople });
      const note = it.field?.note;
      // (A row following "every <it> panel" keeps saying so.)
      const h = typeof it.hint === 'string' ? it.hint : '';
      const follow = h.startsWith('Following: ') && h.includes(' — ') ? h.slice(0, h.indexOf(' — ') + 3) : '';
      return { ...it, hint: follow + [words, note].filter(Boolean).join(' · ') };
    });
  }
  function playersItems() {
    if (torn) return [];
    const t = MENU_TAB.players;
    const rows = fieldItems([normalizeField(SCREEN_PLAYERS_FIELD)], {
      values: () => { try { return settings.get() || {}; } catch { return {}; } },
      level: complexity(),
      onStep: (key, value) => { try { settings.set({ [key]: value }); } catch (err) { console.error('kiosk: players', err); } },
    });
    return rows.length ? [{ kind: 'heading', id: 'players-head', label: 'Who is playing on this screen', ...t(0) },
      ...withPlayerNames(rows).map((it) => ({ ...it, id: 'screen-players', ...t(0) }))] : [];
  }

  // ---- "SWITCH MODULE": THE MODULES LIBRARY IN THE PANEL'S PLACE (2026-10-02) ------------------------
  //
  // Mike: "modules on a dashboard should be as hot swappable as possible. Maybe a switch module button on
  // the transport bar for the selected module." And then, on the short list this used to open in the menu:
  // "It should probably open the modules module in the place of the module you selected to switch. Then you
  // could double click on the module you want in the modules module and it would replace the modules
  // module." So, reached five ways — the bar's "Switch module" (both bars), the panel tab's "Switch <panel>
  // to another module…", a bound switch (`menu/switch-module`), "switch module" said aloud, and the AI's
  // place / swap (`PLACE_MODULE_TOPIC`) — one thing happens:
  //   1. THE LIBRARY STANDS IN THE PANEL'S PLACE (`openLibraryAt`): the `library` module, mounted in a
  //      box beside the panel's own, in the same cell / spot / stage, and the panel's box hidden (not torn
  //      down: told `onHide`, so the hide policy mutes or pauses it as for any hidden panel). Its first
  //      button is "Keep <panel>" — the way out, first. While it is open it holds the scan (the screens
  //      tray's rule): the panel router is paused and next / prev / select / back walk the library.
  //   2. ONE PRESS SHOWS A THING, A SECOND (or a double click) PUTS IT THERE: `switchPanel` (same id, same
  //      place; a fresh row for the new type; the old one's row kept for switching back; remembered on the
  //      dashboard), then the box is shown again, holding the new module, and the library goes.
  //   3. "KEEP <PANEL>", BACK, OR NOBODY TOUCHING IT FOR ITS `idleMs` (library.js decision 5): the library
  //      goes and the panel is shown exactly as it was (`onShow`).
  // A host page with its OWN switch (Home) still gets the press (`hostSwitch`), and may open the same
  // library itself with its own pick (`kiosk.openLibrary(id, { onPick })`): one chooser, however reached.
  // RECENT: the last six modules switched to (SWITCH_RECENT_MAX, argued: one row, one scan lap), and how
  // often each was (`switchCounts`, for "most used"), kept on the PERSON's row when the screen has one
  // (they are that person's habits, and follow them), else on the screen's.
  const SWITCH_RECENT_MAX = 6;
  const SWITCH_RECENT_KEY = 'switchRecent';
  const SWITCH_COUNTS_KEY = 'switchCounts';
  // The tally keeps the sixty most-used types: more than the library has modules, so nothing real falls
  // off; a bound only so a row cannot grow without end. A mechanism's limit, not a preference.
  const SWITCH_COUNTS_MAX = 60;
  // The library's own row when it stands in a panel's place (sort, category, scan, card size, its wait):
  // one per screen, so it opens the way it was left wherever it opens.
  const LIBRARY_ROW = 'library-switch';
  // (`libOpen` / `libScanHeld` are declared with `screensOpen`, further up: the tray and the edit view read
  // them, and a `let` read before its own line throws.)
  const switchRow = () => (personInputs && personRow ? (personInputs.get?.() || {}) : (settings.get() || {}));
  function switchRecent() {
    const v = switchRow()[SWITCH_RECENT_KEY];
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string' && getManifest(t)) : [];
  }
  function switchCounts() {
    const v = switchRow()[SWITCH_COUNTS_KEY];
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function rememberSwitch(type) {
    const next = [type, ...switchRecent().filter((t) => t !== type)].slice(0, SWITCH_RECENT_MAX);
    const counts = { ...switchCounts() };
    counts[type] = (Number(counts[type]) || 0) + 1;
    const keys = Object.keys(counts);
    if (keys.length > SWITCH_COUNTS_MAX) {
      keys.sort((a, b) => (Number(counts[a]) || 0) - (Number(counts[b]) || 0));
      for (const k of keys.slice(0, keys.length - SWITCH_COUNTS_MAX)) if (k !== type) delete counts[k];
    }
    const patch = { [SWITCH_RECENT_KEY]: next, [SWITCH_COUNTS_KEY]: counts };
    try {
      if (personInputs && personRow) personInputs.set?.(patch);
      else settings.set(patch);
    } catch (err) { console.error('kiosk: switch recent', err); }
  }
  const libraryUsage = () => ({ recent: switchRecent(), counts: { ...switchCounts() } });

  // ---- A LOCKED PANEL STAYS WHERE IT IS (2026-10-02; Mike's list 09-30 ~1060) ---------------------------
  // The tutorial dashboard locks Nimrod and the settings into its bottom two places "against accidents"
  // (dashboards.js LOCKED_KEY: instance ids on the dashboard's settings doc; home_profile.js says what a lock
  // means and why it has a key). Home's edit bar honoured it; this file's Switch module did not. Now every way
  // this file switches a panel asks `lockedNow` first -- the same check as Home's own -- and a locked panel
  // stays, with a notice saying why and where the key is (Home's Change tray, Unlock):
  //   the bar's Switch module (both bars), the menu's "Switch <panel>…", a bound switch, "switch module" said
  //   aloud, the AI's place / swap (`openLibraryAt`), and a pick that would put another module there
  //   (`doSwitch`: the library's pick, a Modules panel's own pick, `kiosk.switchPanel`).
  // WHICH LIST: the SHOWING dashboard's -- on the dashboard path its own doc (`themeDoc`); on this file's path
  // the swapped-in screen's (`swapDoc`), or `settings` on the screen it booted on. Read at the press, never
  // cached, so an Unlock is honoured as soon as this screen's copy of the doc has it.
  // NOT ASKED: recovery's swap (arrangement.js `swapPanel` replaces a panel that FAILED; the lock is against
  // accidents, not against keeping a screen alive), and a host page's own pick (Home asks its own `lockedNow`
  // before it opens the library, `onPick`).
  // THE BAR'S BUTTON STAYS PRESSABLE on a locked panel and its title says why: a press then SAYS why, where a
  // dimmed button would give a switch user nothing at all for the press (Home's tray dims, because Unlock is
  // the next button along there; here the key is on another page). On Mike's list.
  function lockedIdsNow() {
    let row = null;
    try {
      if (useDashboard && dash) row = themeDoc().get?.() || null;
      else if (profileId !== bootProfileId) row = swapDocNow()?.get?.() || null;
      else row = settings.get() || null;
    } catch { row = null; }
    const v = row && row[LOCKED_KEY];
    return Array.isArray(v) ? v : [];
  }
  // (A declaration, not a const: the bar asks it on its first draw, long before this line runs.)
  function lockedNow(id) { return !!id && lockedIdsNow().includes(id); }
  const lockedWords = (rec) => `${rec ? (rec.title || rec.type) : 'This panel'} is locked on this dashboard, so it stays `
    + 'where it is. To unlock it: on Home, choose it, press Change, then Unlock.';
  // THE NOTICE: a line over the screen, read out to a screen reader (role=status), gone by itself -- never a
  // thing anybody has to dismiss. HOW LONG, argued: long enough to read it SLOWLY. LOCK_NOTE_WPM is a slow
  // reader's pace (a hundred words a minute is about half an adult's ordinary silent reading speed), with a
  // floor (LOCK_NOTE_MIN_MS) so a short title still leaves time to look up. The sentence above is ~25 words:
  // about 15 s. Guesses, on Mike's list. Drawn in the theme's own tokens; above the menu (`menus + 1`), since
  // the menu's own "Switch <panel>…" row is one of the presses that shows it.
  const LOCK_NOTE_WPM = 100;
  const LOCK_NOTE_MIN_MS = 6000;
  let lockNoteEl = null;
  let lockNoteT = null;
  function sayLocked(rec) { return sayNote(lockedWords(rec)); }
  // The same quiet line, for anything else this screen has to say once (2026-10-04: an edit that gave way to
  // another device's, `sayLostEdit`). Same timing rule, same place.
  function sayNote(text) {
    if (torn || typeof document === 'undefined') return text;
    if (!lockNoteEl) {
      lockNoteEl = document.createElement('div');
      lockNoteEl.setAttribute('role', 'status');
      lockNoteEl.setAttribute('aria-live', 'polite');
      lockNoteEl.dataset.lockNote = '';
      lockNoteEl.style.cssText = 'position:absolute;left:50%;bottom:14%;transform:translateX(-50%);'
        + `z-index:${LAYERS.menus + 1};max-width:min(80%,640px);padding:12px 18px;border-radius:12px;`
        + 'pointer-events:none;text-align:center;font:600 clamp(15px,2.1vmin,22px)/1.4 system-ui,-apple-system,Segoe UI,sans-serif;'
        + 'background:var(--surface);color:var(--text);border:2px solid var(--focus)';
      kioskEl.append(lockNoteEl);
    }
    lockNoteEl.textContent = text;
    lockNoteEl.hidden = false;
    clearTimeout(lockNoteT);
    const words = text.split(/\s+/).filter(Boolean).length;
    const ms = Math.max(LOCK_NOTE_MIN_MS, Math.round((words * 60000) / LOCK_NOTE_WPM));
    lockNoteT = setTimeout(() => { if (lockNoteEl) lockNoteEl.hidden = true; }, ms);
    return text;
  }
  function hostSwitch() {
    if (!hostPage || typeof hostPage.press !== 'function' || typeof hostPage.barItems !== 'function') return false;
    try { return (hostPage.barItems() || []).some((it) => it && it.act === 'switch'); } catch { return false; }
  }
  /** Switch module for panel `id` (default: the focused one; or, when the press names a module `type`,
   *  the first panel of that type -- Nimrod the guide's "Replace the pictures"). */
  function openSwitch(id = null, p = null) {
    if (torn) return false;
    if (hostSwitch()) {
      try { hostPage.press('switch', { from: 'switch-module', ...(p && p.type ? { type: p.type } : {}) }); }
      catch (err) { console.error('kiosk: host switch', err); }
      return true;
    }
    const recs = menuPanelRecs();
    const rec = id ? recs.find((r) => r.id === id) || null
      : (p && p.type ? recs.find((r) => r.type === p.type) : null) || panelSubject();
    if (!rec) { if (!menu.isOpen()) menu.open(); return false; }
    openLibraryAt(rec.id).catch((err) => console.error('kiosk: switch module', err));
    return true;
  }
  /** Hold the scan for the library (the router paused), or give it back when nothing else holds it. */
  function holdLibraryScan(on) {
    libScanHeld = !!on;
    try {
      if (on) runtime?.router?.setPaused?.(true);
      else if (!screensOpen && !menu?.isOpen?.() && !editScanHeld && !hostScanHeld && !callScanHeld) runtime?.router?.setPaused?.(false);
    } catch { /* no router yet */ }
  }
  /** Put the Modules library in panel `id`'s place. `onPick(item)`: a host page's own switch (Home) -- the
   *  library goes and the host does the rest; without it a pick is this screen's `switchPanel`. `onCancel`:
   *  told when it goes without a pick. `focus` / `autoPlace`: a module asked for by name (the AI). */
  async function openLibraryAt(id, { onPick = null, onCancel = null, focus = null, autoPlace = false } = {}) {
    if (torn || typeof document === 'undefined') return false;
    const rec = menuPanelRecs().find((r) => r.id === id) || null;
    const host = rec && rec.el;
    if (!rec || !host || !host.parentNode) return false;
    // A locked panel stays where it is (see `lockedNow`). A host page's own pick asked its own lock first.
    if (!onPick && lockedNow(rec.id)) { sayLocked(rec); return false; }
    if (libOpen) {
      if (libOpen.id === rec.id && !focus) return true;
      closeLibrary('replaced');
    }
    try { if (menu.isOpen()) menu.close(); } catch { /* not up */ }
    const slot = document.createElement('div');
    slot.className = 'k-mod k-libslot';
    slot.dataset.libraryFor = rec.id;
    host.after(slot);
    const lo = { id: rec.id, host, slot, hiddenStyle: host.style.display, onPick, onCancel, inst: null, state: null,
      promoted: false, picking: false };
    host.style.display = 'none';
    try { rec.instance?.onHide?.({ by: 'auto' }); } catch (err) { console.error('kiosk: hiding a panel for the library', err); }
    libOpen = lo;
    holdLibraryScan(true);
    const target = { id: rec.id, type: rec.type, title: rec.title || rec.type, base: arr.baseTypeOf?.(rec.id) || rec.type };
    const libHost = {
      mode: 'switch', target, focus, autoPlace,
      usage: libraryUsage,
      place: (item) => pickInPlace(lo, item),
      cancel: (why) => { if (libOpen === lo) closeLibrary(why || 'keep'); },
      bigger: () => { if (libOpen !== lo) return; lo.promoted = !!promotePanel(rec.id) || lo.promoted; },
      // 2026-10-03: "Over the dashboard" -- the library goes, the panel it stood in for is shown as it was, and
      // the pick is put over the dashboard (`overlayHere`). Only where that can be done (`canOverlayHere`).
      ...(canOverlayHere() ? { overlay: async (item) => {
        if (libOpen !== lo || !item || !item.type) return false;
        closeLibrary('keep');
        return overlayHere(item.type);
      } } : {}),
    };
    try {
      lo.state = withTypeLayer(stateFor(LIBRARY_ROW), LIBRARY_TYPE);
      lo.inst = mountModule(LIBRARY_TYPE, extendCtx(childCtx({ id: `library:${rec.id}`, type: LIBRARY_TYPE }), {
        mount: slot, state: lo.state, events: null, libraryHost: () => libHost,
      }));
      await lo.state.load().catch(() => {});
      if (libOpen !== lo) return false;          // closed while its row loaded
      await lo.inst.init();
      if (libOpen !== lo) return true;           // already picked (an AI's request) or closed
      lo.state.startPolling?.();
    } catch (err) {
      console.error('kiosk: the library would not open', err);
      if (libOpen === lo) closeLibrary('failed');
      return false;
    }
    renderMods();
    return true;
  }
  /** What a Modules panel of its own is handed (`childCtx.libraryHost`): a pick turns THAT panel into the
   *  pick, in its place (Mike: "it would replace the modules module"). On a host page with its own switch
   *  (Home) the host is asked to do it, as for the AI's place. */
  function libraryHostFor(instanceId) {
    if (!instanceId) return null;
    const rec = () => menuPanelRecs().find((x) => x.id === instanceId) || null;
    return {
      mode: 'panel',
      get target() {
        const r = rec();
        return r ? { id: r.id, type: r.type, title: r.title || r.type, base: arr.baseTypeOf?.(r.id) || r.type } : null;
      },
      usage: libraryUsage,
      place: async (item) => {
        if (!item || !item.type || torn) return false;
        if (hostSwitch()) {
          try { hostPage.press('place', { id: instanceId, type: item.type, from: 'library' }); return true; }
          catch (err) { console.error('kiosk: host place', err); return false; }
        }
        return doSwitch(instanceId, item.type, item.settings || null);
      },
      // 2026-10-03: "Over the dashboard" -- this Modules panel stays, and the pick goes over the dashboard.
      ...(canOverlayHere() ? { overlay: (item) => (item && item.type && !torn ? overlayHere(item.type) : false) } : {}),
    };
  }

  // =================================================================================================
  // *** OVER THE DASHBOARD, AND "SHOW A SMALL CLOCK", FROM THIS SCREEN (2026-10-03). ***
  // Mike: "Where are the overlays? I'd like to make a dashboard that's full screen photos with a small clock
  // overlay somewhere." layout.js `addAsOverlay` argues where an overlay goes (a free corner, out of the lap);
  // arrangement.js SMALL_CLOCK_FIELD argues the corner clock's row. Two ways to do either:
  //   ON HOME (a host page with its own switch, `hostSwitch`): Home's settings are drafted and its arrangement
  //     is Home's to write (with Undo), so the press goes to the page -- `overlay { type }`, `smallclock { corner }`.
  //   ON A SCREEN OF ITS OWN (kiosk.html, a Pi), where this file may change the arrangement (`canChangeLayout`):
  //     the module is added to the screen (`profiles.addModule`), the layout or the corner is written where the
  //     Layout row writes (`layoutDoc`), and the screen is put together again the way the Layout row does it --
  //     a remount, like any arrangement change from this menu. A clock that is already the corner clock is
  //     never added twice: its corner is set, and 'off' hides it (its module and its settings kept).
  //   ANYWHERE ELSE (a preview, an embed with no page behind it): neither is offered -- a row or a button that
  //     cannot do what it says is not drawn.
  // =================================================================================================
  // (Declarations, not consts: a menu drawn before this line runs asks them, as it asks `lockedNow`.)
  function canAddHere() { return !torn && canChangeLayout() && typeof profiles?.addModule === 'function' && typeof profiles?.get === 'function'; }
  // The host page says which of these presses it answers (`host.handles(act)`; Home: 'overlay' and 'smallclock',
  // on the dashboard filling the window too, where its bar has no Switch module for `hostSwitch` to find).
  function hostHandles(act) {
    try { return !!hostPage && typeof hostPage.press === 'function' && hostPage.handles?.(act) === true; } catch { return false; }
  }
  function canOverlayHere() { return hostHandles('overlay') || canAddHere(); }
  /** The HUD module of `type` (an unplaced clock or camera) on this screen, or null. */
  function hudHere(type, layout) {
    const held = new Set([...((layout && layout.slots) || []), ...((layout && layout.placed) || []).map((p) => p && p.id)]);
    return (arr.profile()?.modules || []).find((m) => m.type === type && !held.has(m.id)) || null;
  }
  /** Put this screen together again with a new module and/or layout (the Layout row's way, `applyLayoutPreset`).
   *  `base`: the `kiosk` key as it was read before the wait (2026-10-04, later) -- see below. */
  async function rebuildHere(doc, kioskIn, base = undefined) {
    // *** THE WAIT IS MERGED, NOT LAID OVER (2026-10-04, later; the gap d40424f left). *** Both callers read the key,
    // wait on the server to add a module, then write the whole key back: a change heard in that wait (another device
    // -- a placement, a corner, the room) was gone. It is merged onto the key as it is now (doc_merge.js
    // `mergeKioskSave`, CONFLICT_PREFER), and a choice made here that gave way is said on the quiet line. What is
    // rebuilt below is the merge, so the screen shows what was saved.
    const now = (doc.get?.() || {}).kiosk || {};
    const m = mergeKioskSave(base, kioskIn, now, { prefer: CONFLICT_PREFER });
    const kiosk = m.kiosk;
    if (m.lost.length) sayLostEdit(profileId, m.lost);
    // Told FIRST, as the Layout row does: the 09-12 watch hears this write synchronously and must not reload for
    // a change this file applies itself. Only when the layout really changes (an unchanged one is never heard).
    const before = now.layout ?? null;
    if (JSON.stringify(before) !== JSON.stringify(kiosk.layout ?? null)) expectLayoutSig = JSON.stringify(kiosk.layout ?? null);
    doc.set({ kiosk });
    try {
      if (useDashboard && dash) {
        await doc.flush?.().catch?.(() => {});
        await swapDashboard(profileId, { remember: false });
      } else {
        arr.setProfile(await profiles.get(profileId));
        arr.resolve(kiosk.layout);
        await applyModules();
      }
    } catch (err) { console.error('kiosk: putting the screen together again', err); }
    try { if (menu.isOpen()) menu.refresh(); } catch { /* the menu may be gone */ }
    refreshViews();
    renderMods();
  }
  /** A module of `type` over the dashboard. Resolves true when it was done (or handed to the page). */
  async function overlayHere(type) {
    if (torn || !type) return false;
    if (hostHandles('overlay')) {
      try { hostPage.press('overlay', { type, from: 'library' }); return true; }
      catch (err) { console.error('kiosk: host overlay', err); return false; }
    }
    if (!canAddHere()) return false;
    const doc = layoutDoc();
    const cur = (doc.get?.() || {}).kiosk || {};
    try {
      if (HUD_TYPES.includes(type)) {
        const have = hudHere(type, cur.layout);
        const c = clockCornerOf({ kiosk: cur });
        // A corner clock that is off is turned on where it was set: what "over the dashboard" means for it.
        const next = type === 'clock' && (!have || c === 'off')
          ? { ...cur, clock: { ...(cur.clock || {}), corner: c === 'off' ? SMALL_CLOCK_FIELD.default : c } } : cur;
        if (have) {
          if (next !== cur) doc.set({ kiosk: next });       // only the corner: nothing remounts
          return true;
        }
        await profiles.addModule(profileId, type);
        await rebuildHere(doc, { ...next }, cur);      // (the base: read before the wait, merged in `rebuildHere`)
        return true;
      }
      const mod = await profiles.addModule(profileId, type);
      // *** PLACED ON THE KEY AS IT IS AFTER THE WAIT (2026-10-04, later), not the one read before it. *** "Put W
      // over the dashboard" is a choice that can be made again on whatever the layout now is (`addAsOverlay` is
      // pure), so it is: a panel moved elsewhere meanwhile stays moved, and W takes a corner that is free NOW.
      //   FOR this over merging (as `rebuildHere` does for the corner clock): adding an entry changes the placed
      //   list's shape, and doc_merge.js merges a list element by element only when its shape is unchanged -- so a
      //   merge would call ANY placement change elsewhere a clash and drop W. AGAINST: none found; there is nothing
      //   here a clash could be about. (The base still goes to `rebuildHere`, so it is one rule if this ever waits again.)
      const now = (doc.get?.() || {}).kiosk || {};
      const avoid = [];
      if (hudHere('clock', now.layout) && clockCornerOf({ kiosk: now }) !== 'off') avoid.push(clockCornerOf({ kiosk: now }));
      if (hudHere('camera', now.layout)) avoid.push((now.mirror && now.mirror.corner) || 'tr');
      const r = addAsOverlay(now.layout || null, mod.id, { type, avoid });
      // The one-at-a-time stage has nothing to float over: the new module simply joins it.
      await rebuildHere(doc, r.entry ? { ...now, layout: r.layout } : { ...now }, now);
      return true;
    } catch (err) {
      console.error('kiosk: over the dashboard', err);
      return false;
    }
  }
  /** "Show a small clock": `corner` is one of CLOCK_CORNERS. A corner with no corner clock adds one. */
  async function smallClockHere(corner) {
    if (torn || !CLOCK_CORNERS.includes(corner)) return false;
    if (hostHandles('smallclock')) {
      try { hostPage.press('smallclock', { corner, from: 'menu' }); return true; }
      catch (err) { console.error('kiosk: host small clock', err); return false; }
    }
    if (!canAddHere()) return false;
    const doc = layoutDoc();
    const cur = (doc.get?.() || {}).kiosk || {};
    const have = hudHere('clock', cur.layout);
    const next = { ...cur, clock: { ...(cur.clock || {}), corner } };
    if (have || corner === 'off') {
      // Only the corner: applied by the settings subscribe (arrangement.js applyLayout), nothing remounts.
      doc.set({ kiosk: next });
      try { if (menu.isOpen()) menu.refresh(); } catch { /* the menu may be gone */ }
      return true;
    }
    try { await profiles.addModule(profileId, 'clock'); } catch (err) { console.error('kiosk: adding a small clock', err); return false; }
    await rebuildHere(doc, next, cur);                 // (the base: read before the wait, merged in `rebuildHere`)
    return true;
  }
  /** What the row shows: the corner clock's corner, or Off when this screen has none. */
  function smallClockNow() {
    let cur = {};
    try { cur = (layoutDoc().get?.() || {}).kiosk || {}; } catch { cur = {}; }
    if (!hudHere('clock', arr.layout() || cur.layout)) return 'off';
    return clockCornerOf({ kiosk: cur });
  }
  async function pickInPlace(lo, item) {
    if (libOpen !== lo || lo.picking || !item || !item.type) return false;
    lo.picking = true;
    try {
      if (lo.onPick) {
        closeLibrary('picked-host');
        return (await lo.onPick(item)) !== false;
      }
      const ok = await doSwitch(lo.id, item.type, item.settings || null);
      // On success the box holds the new module: shown again, the library gone. On failure the arrangement
      // put the old module back in the box; the library stays and says nothing changed.
      if (ok && libOpen === lo) closeLibrary('picked');
      return ok;
    } catch (err) {
      console.error('kiosk: switching from the library', err);
      return false;
    } finally { lo.picking = false; }
  }
  /** The library goes; the panel's box is shown again. Returns false when there was none. */
  function closeLibrary(why = 'keep') {
    const lo = libOpen;
    if (!lo) return false;
    libOpen = null;
    if (lo.inst) { try { lo.inst.destroy(); } catch (err) { console.error('kiosk: closing the library', err); } }
    else { try { lo.state?.destroy?.(); } catch { /* gone */ } }
    try { lo.slot.remove(); } catch { /* gone */ }
    try { lo.host.style.display = lo.hiddenStyle || ''; } catch { /* gone */ }
    // The panel it stood in for, as it was. Not after a switch: that box holds a new module that never hid.
    if (why !== 'picked' && why !== 'gone') {
      try { menuPanelRecs().find((r) => r.id === lo.id)?.instance?.onShow?.({ by: 'auto' }); } catch (err) { console.error('kiosk: showing a panel again', err); }
    }
    if (lo.promoted) { try { demotePanel(); } catch { /* already smaller */ } }
    if (!torn) holdLibraryScan(false);
    if (why !== 'picked' && why !== 'picked-host' && typeof lo.onCancel === 'function') {
      try { lo.onCancel(why); } catch (err) { console.error('kiosk: library cancel', err); }
    }
    if (!torn) renderMods();
    return true;
  }
  async function doSwitch(id, type, apply = null) {
    // A locked panel is not switched, however the pick arrived (see `lockedNow`).
    if (lockedNow(id)) { sayLocked(menuPanelRecs().find((r) => r.id === id) || null); return false; }
    let ok = false;
    try { ok = !!(await arr.switchPanel(id, type)); } catch (err) { console.error('kiosk: switch module', err); ok = false; }
    if (ok) {
      rememberSwitch(type);
      // A scene is a module with one choice made (library.js `sceneItems`): made on the panel's new row.
      if (apply && typeof apply === 'object') {
        try { menuPanelRecs().find((r) => r.id === id)?.state?.set?.(apply); } catch (err) { console.error('kiosk: a scene’s setting', err); }
      }
    }
    try { if (menu.isOpen()) menu.refresh(); } catch { /* the menu may be gone */ }
    refreshViews();
    renderMods();
    return ok;
  }
  // While the library stands in a place it takes the verbs (the router is paused): the same nine a panel
  // would get, and the panel-step pair as next / prev, so the arrow keys and a two-switch setup walk it.
  for (const [verb, as] of [['next', 'next'], ['prev', 'prev'], ['select', 'select'], ['back', 'back'], ['up', 'up'],
    ['down', 'down'], ['left', 'left'], ['right', 'right'], ['focus-next', 'next'], ['focus-prev', 'prev']]) {
    offsScreen.push(bus.subscribe(verbTopic(verb), () => {
      // (A call notice or a hosted call over the panels has the scan while it shows: see `holdCallScan`.)
      if (!libOpen || torn || screensOpen || editScanHeld || callScanHeld) return;
      try { if (menu?.isOpen?.()) return; } catch { /* not up yet */ }
      try { libOpen.inst?.impl?.verb?.(as); } catch (err) { console.error('kiosk: library verb', err); }
    }));
  }

  // ---- A TV'S THINGS, ON THE SOUND TAB (2026-10-02; panel_sound.js) -----------------------------------
  // For a panel that is a dashboard showing another one: one row per thing on it that makes sound, "On" /
  // "Muted", kept on the TV's own row. The things are what the bus knows is playing ON the TV (its
  // `within`), named by the TV's own dashboard where it can say.
  function nestedSoundRows(rec) {
    let inner = [];
    try { inner = audio.ownersWithin?.(rec.id) || []; } catch { inner = []; }
    if (!inner.length) return [];
    let names = new Map();
    try {
      const a = rec.instance?.impl?.arrangement?.();
      const recs = a ? [a.stageRec?.(), ...(a.slotRecs || []), ...(a.placedRecs || [])].filter(Boolean) : [];
      names = new Map(recs.map((r) => [r.id, r.title || r.type]));
    } catch { names = new Map(); }
    const muted = () => nestedMutedFrom(rec.state.get() || {});
    return inner.map((id) => ({
      kind: 'item', id: `nested-sound:${id}`,
      label: `On it: ${names.get(id) || 'something playing'}`,
      hint: muted()[id] ? 'Muted' : 'On',
      run: () => {
        const cur = { ...muted() };
        if (cur[id]) delete cur[id]; else cur[id] = true;
        try { rec.state.set({ [NESTED_MUTED_KEY]: cur }); } catch (err) { console.error('kiosk: TV sound', err); }
      },
    }));
  }

  // ---- PAUSE / PLAY: ONE BUTTON FOR THE SELECTED PANEL (2026-10-02) -------------------------------------
  //
  // Mike: "Modules shouldn't really have a pause. That's a universal function. If anything, stuff like that
  // should maybe belong to the transport bar? Is that a sensible approach? Should continuing to play be the
  // default for everything? Is there already a standard for different things."
  //
  // THE STANDARD ALREADY EXISTED, and it is why this is small: the `pause` and `play` VERBS (actions.js
  // MEDIA_VERBS). A spoken "pause", a bound switch and the router already send them to the focused panel,
  // and YouTube, Karaoke, Music and Brick breaker already answer them. What was missing was a BUTTON.
  //
  // BOTH SIDES, argued:
  //   FOR a pause on each module (what there was): a module knows what "paused" means for it -- a game
  //     freezes its ball, a video holds its frame, a quiz stops its timer -- and can draw its own state.
  //   FOR one universal pause on the bar (chosen): pausing is the same act everywhere to the person doing it,
  //     a switch user should not have to find a different pause inside every panel, and ONE place to press
  //     it means one thing to bind, one word to say and one button to learn. The module still decides what
  //     pause MEANS -- the verb arrives and it does its own thing -- so nothing a module knows is lost.
  // WHO CAN PAUSE: a module that answers BOTH verbs in the verb map (MODULE_VERBS; `answersPause`). ARGUED
  //   against a manifest flag (`pausable: true`): the map is already the declaration the router acts on, and a
  //   second list could say "pausable" about a module the verb never reaches -- a button that looks live and
  //   is not, which is worse than a dimmed one. A module that answers neither gets a DIMMED button saying so
  //   (D16: never hidden).
  // WHICH WAY IT IS: no module reports "am I paused" (module.js has no such contract), so the shell
  //   remembers what IT last sent each panel, and also what a spoken or switched pause / play sent while that
  //   panel had focus. If the module was paused some other way (YouTube's own controls), the button may say
  //   "Pause" over a paused video: pressing it sends `pause` again, which is harmless (the verbs are
  //   idempotent), and the next press is "Play". Never a wrong action, at worst one extra press.
  // KEEP PLAYING IS THE DEFAULT FOR EVERYTHING, as it is today: nothing pauses unless somebody presses, and a
  //   hidden panel keeps playing unless its own "when this panel is hidden" says otherwise (hide_sound.js;
  //   its "pause it" now uses these same verbs).
  // MENU AND ROUTER: sent straight to the panel's own instance topic, not through the router, so the menu's
  //   row works while the menu holds the switch (the router is paused then).
  const pausedPanels = new Set();
  const canPausePanel = (rec) => {
    if (!rec) return false;
    try { return !!verbTarget(rec.type, 'pause') && !!verbTarget(rec.type, 'play'); } catch { return false; }
  };
  function playPauseState() {
    let rec = null;
    try { rec = panelSubject(); } catch { rec = null; }      // (none while a piece of the room is selected)
    return { can: canPausePanel(rec), paused: !!rec && pausedPanels.has(rec.id), name: rec ? panelName(rec) : null, id: rec ? rec.id : null };
  }
  function sendPanelVerb(rec, verb) {
    const t = verbTarget(rec.type, verb);
    if (!t) return false;
    const topic = typeof bus.instanceTopic === 'function' ? bus.instanceTopic(rec.id, t.topic) : t.topic;
    bus.publish(topic, t.payload, { from: 'transport' });
    return true;
  }
  function playPauseSelected(id = null) {
    if (torn) return null;
    let rec = null;
    try { rec = id ? (menuPanelRecs().find((r) => r.id === id) || null) : panelSubject(); } catch { rec = null; }
    if (!canPausePanel(rec)) return null;
    const verb = pausedPanels.has(rec.id) ? 'play' : 'pause';
    sendPanelVerb(rec, verb);
    if (verb === 'pause') pausedPanels.add(rec.id); else pausedPanels.delete(rec.id);
    syncPlayPause();
    return verb;
  }
  function syncPlayPause() {
    const s = playPauseState();
    try { paintPlayPause(controlsEl.querySelector('[data-act="playpause"]'), s); } catch { /* not drawn yet */ }
    // Bigger / Smaller follows the same selection (2026-10-02 evening; transport_bar.js paintBigger).
    let b = null;
    try {
      b = biggerState();
      paintBigger(controlsEl.querySelector('[data-act="bigger"]'), b);
      paintSmaller(controlsEl.querySelector('[data-act="smaller"]'), b);
    } catch { b = null; /* not built yet */ }
    if (useDashboard) { try { bus.publish(SHELL_STATE, b ? { playPause: s, bigger: b } : { playPause: s }); } catch { /* not load-bearing */ } }
    return s;
  }
  // What the bars' Bigger and Smaller say (2026-10-03, Mike: "no way to demote it"). Bigger: the selected
  // panel, one level up; dimmed at the top (it already fills the screen). Smaller: one level down, live
  // whenever ANYTHING is bigger -- before, the one button said Smaller only at the screen level, so a panel
  // filling its dashboard had no way back on either bar. Two buttons, both always drawn (dimmed, never hidden).
  function biggerState() {
    let rec = null;
    try { rec = panelSubject(); } catch { rec = null; }
    let promoted = false;
    try { promoted = promotedAny(); } catch { promoted = false; }
    return { can: !!rec, top: !!rec && promotedScreen === rec.id, promoted,
      name: rec ? panelName(rec) : null, id: rec ? rec.id : null };
  }

  // ---- MAKE THE SELECTED PANEL BIGGER, ONE LEVEL AT A TIME (2026-10-02; arrangement.js has its half) ----
  //   level 1   the panel fills its dashboard (the arrangement: `promote`)
  //   level 2   the panel fills the SCREEN: the mirror and the corner clock step aside and the screen goes
  //             full screen (when the browser allows it -- from a press it does; from a voice it may not, and
  //             the panel still fills the window)
  // DOWN, one level a press: the corner (which reads "smaller" at the top), "make it smaller", a bound
  // switch, Escape, or Back where the panel itself has nothing for Back (the trail's own rule, below).
  // Leaving full screen any other way (the browser's own Escape) drops the screen level too.
  let promotedScreen = null;          // the panel taken up to the screen, or null
  let fsByPromote = false;            // this file asked for full screen for it (so it is this file's to leave)
  const promotedAny = () => !!promotedScreen || !!(arr.promotedId?.());
  function syncPromote() {
    if (promotedScreen) kioskEl.dataset.promoted = 'screen'; else delete kioskEl.dataset.promoted;
    try { arr.setPromoteTop?.(promotedScreen); } catch { /* not load-bearing */ }
    try { if (menu?.isOpen?.()) menu.refresh(); } catch { /* not up */ }
    refreshViews();
    try { syncPlayPause(); } catch { /* the bars' Bigger / Smaller; not load-bearing */ }
    try { liftCorners(); } catch { /* the corners moved with the panel; not load-bearing */ }
  }
  function promotePanel(id = null) {
    if (torn) return null;
    let rec = null;
    try { rec = id ? (menuPanelRecs().find((r) => r.id === id) || null) : panelSubject(); } catch { rec = null; }
    if (!rec) return null;
    // The corner of a panel already at the top reads "smaller": the same press goes back down.
    if (promotedScreen === rec.id) return demotePanel();
    let r = null;
    try { r = arr.promote?.(rec.id) || null; } catch { r = null; }
    if (r && r.level === 'dashboard') { promotedScreen = null; syncPromote(); return 'dashboard'; }
    // At the top of its dashboard already (or a one-at-a-time stage, or a room's module): the screen.
    promotedScreen = rec.id;
    if (!fullscreenElement()) {
      try {
        const p = root.requestFullscreen?.();
        fsByPromote = true;
        p?.catch?.(() => { fsByPromote = false; });
      } catch { fsByPromote = false; }
    }
    syncPromote();
    return 'screen';
  }
  function demotePanel() {
    if (promotedScreen) {
      promotedScreen = null;
      // (2026-10-05, screen_lock.js: locked, the screen stays in full screen; the panel still goes back down.)
      if (fsByPromote && fullscreenElement() && !screenLocked()) { try { document.exitFullscreen?.()?.catch?.(() => {}); } catch { /* not ours */ } }
      fsByPromote = false;
      syncPromote();
      return 'screen';
    }
    let done = false;
    try { done = !!arr.demote?.(); } catch { done = false; }
    if (done) { syncPromote(); return 'dashboard'; }
    return null;
  }
  // The browser left full screen by its own means: the screen level goes with it (the panel still fills
  // its dashboard, one level down, exactly as a press of "smaller" would leave it).
  const onFsChange = () => {
    if (!fullscreenElement() && promotedScreen && fsByPromote) { fsByPromote = false; promotedScreen = null; syncPromote(); }
  };
  if (typeof document !== 'undefined') document.addEventListener('fullscreenchange', onFsChange);
  // ESCAPE DEMOTES while something is made bigger -- before anything else hears it (capture, on the window):
  // the menu verb and the plain bar would otherwise take the same key. Not while typing, not with the menu
  // open (it is the menu's), and on an embed only for a key inside its box -- OR A KEY WITH NOTHING FOCUSED
  // (2026-10-03). Measured on Home's landing with real keys: after a press on a panel nothing is focused, the
  // key lands on the body, and "inside its box" threw it away, so Escape did nothing there. A panel made
  // bigger is on screen and the key went to no field of the host page's: it is this screen's.
  const onEscDemote = (e) => {
    if (e.key !== 'Escape' || !promotedAny() || isTyping(e.target)) return;
    try { if (menu.isOpen()) return; } catch { return; }
    const t = e.target;
    const nothingFocused = typeof document !== 'undefined' && (t === document || t === document.body || t === document.documentElement || t === window);
    if (embedded && !nothingFocused && !(t instanceof Node && root.contains(t))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    demotePanel();
  };
  window.addEventListener('keydown', onEscDemote, true);
  // *** THE CORNERS COME UP WITH A PRESS (2026-10-02 evening; arrangement.js's corner header has the bug). ***
  // The corners showed on hover or focus only, so a screen with no hover (touch) never showed one. Now a
  // press anywhere brings them up for the bar's own time (BAR_HIDE_MS) -- the same press that brings the
  // bar up -- and the next press, on a corner, takes it. Set AFTER the click, never on pointerdown: a corner
  // appearing under a press already under way would take its release (a mouse's click goes to what the
  // press and the release share) or its tap (a touch's is hit-tested again), and the press meant for the
  // panel would be lost. Only for a pointer's click (`detail` > 0): a key or a switch activating a button
  // clicks with detail 0, and a switch user's every select is no reason to flash the corners.
  let cornersT = null;
  function revealCorners() {
    if (torn) return;
    kioskEl.dataset.corners = 'up';
    liftCorners();
    clearTimeout(cornersT);
    cornersT = setTimeout(() => { cornersT = null; delete kioskEl.dataset.corners; }, BAR_HIDE_MS);
  }
  const onClickForCorners = (e) => { if (e && e.detail > 0) setTimeout(revealCorners, 0); };
  root.addEventListener('click', onClickForCorners, { capture: true, passive: true });
  // A FINGER IS NOT A HOVER. Chrome gives the spot under a finger `:hover` before it hit-tests the tap, so
  // the corner's hover rule woke a hidden corner just in time to take a tap meant for the panel under it
  // (measured, real touch input). The hover rules (arrangement.js, edit_mode.js) stand down while the last
  // press was a finger or a pen; a mouse's press brings them back. Capture, so it is set before the tap.
  const onPressKind = (e) => {
    try { document.documentElement.dataset.press = e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'mouse'; }
    catch { /* no document */ }
  };
  root.addEventListener('pointerdown', onPressKind, { capture: true, passive: true });
  // NEVER UNDER THE BAR. A bottom-row corner can sit under the transport bar (a 2x2's lower-left one, under
  // the placed bar: measured at 1920x1080). Any corner (⤢ or ✎) that overlaps a bar that is showing is
  // lifted just above it, through `--k-corner-lift` on that button; every other one is 0. Run whenever a
  // bar or the corners come up or go, a panel is made bigger, and when a pointer comes onto a panel (a
  // mouse's hover shows a corner without any press).
  const CORNER_GAP_PX = 6;            // the corner's own inset (arrangement.js `right:6px`), kept above the bar too
  function shownBarRects() {
    const out = [];
    const bars = [controlsEl, ...kioskEl.querySelectorAll('.tb-bar')];
    for (const b of bars) {
      if (!b || !b.isConnected) continue;
      if (b === controlsEl && (b.classList.contains('hidden') || b.classList.contains('k-plain-off'))) continue;
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(r);
    }
    return out;
  }
  function liftCorners() {
    if (torn || typeof document === 'undefined') return;
    let bars = [];
    try { bars = shownBarRects(); } catch { bars = []; }
    for (const btn of kioskEl.querySelectorAll('.k-promote, .k-editc')) {
      const had = parseFloat(btn.style.getPropertyValue('--k-corner-lift')) || 0;
      let lift = 0;
      if (bars.length) {
        // Where it would sit unlifted: its box now, moved back down by the lift it has.
        const r = btn.getBoundingClientRect();
        const top = r.top + had, bottom = r.bottom + had;
        for (const b of bars) {
          if (r.right > b.left && r.left < b.right && bottom > b.top && top < b.bottom) lift = Math.max(lift, Math.ceil(bottom - b.top + CORNER_GAP_PX));
        }
      }
      if (lift === had) continue;
      if (lift > 0) btn.style.setProperty('--k-corner-lift', `${lift}px`);
      else btn.style.removeProperty('--k-corner-lift');
    }
  }
  const onPointerOverForCorners = (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('.k-cell, .k-pcell, .k-stage')) liftCorners();
  };
  root.addEventListener('pointerover', onPointerOverForCorners, { capture: true, passive: true });
  // AND AGAIN WHEN THE PLAIN BAR HAS FADED IN (2026-10-03, measured with real CDP presses at 1920x1080 and
  // 1280x720): the press that wakes the bar brings the corners up while the bar is still at opacity 0, so
  // `shownBarRects` skipped it and a 2x2's lower-left corner stayed under the bar for that whole wake. Its
  // own transition ending is the moment it is really there (no timer guessing kiosk.css's fade).
  const onBarFaded = (e) => { if (e.target === controlsEl && e.propertyName === 'opacity') liftCorners(); };
  controlsEl.addEventListener('transitionend', onBarFaded);

  // ---- A LIVE CALL'S CONTROLS (2026-10-02; modules/call.js answers, actions.js CALL_ACTIONS) ------------
  // Drawn on the plain bar here and on a placed bar by itself, from the call panel's own report; offered as
  // rows at the top of the menu's first tab while a call is live, so a scan reaches them too.
  let callState = null;
  function sendCallControl(payload) { try { bus.publish(CALL_CONTROL_TOPIC, { ...payload, from: 'kiosk' }); } catch (err) { console.error('kiosk: call control', err); } }
  function drawPlainCallControls() {
    try { drawCallControls(controlsEl.querySelector('[data-call-controls]'), callState, sendCallControl); }
    catch (err) { console.error('kiosk: call controls', err); }
  }
  function callRows() {
    const s = callState;
    if (!s || !s.live) return [];
    const t = { ...MENU_TAB.module(-1) };
    const row = (id, label, hint, payload, disabled = false) => ({ kind: 'item', id: `call-ctl:${id}`, label, hint, disabled, ...t,
      run: () => sendCallControl(payload) });
    const pct = Math.round((Number(s.volume) || 0) * 100);
    return [
      { kind: 'heading', id: 'call-ctl-head', label: 'This call', ...t },
      row('mic', s.mic ? 'Mute my microphone' : 'Unmute my microphone', s.mic ? 'they can hear this room' : 'muted: they cannot hear you', { mic: 'toggle' }, s.hasMic === false),
      row('speaker', s.speaker ? 'Mute the speaker' : 'Unmute the speaker', s.speaker ? 'their voice plays here' : 'muted in this room', { speaker: 'toggle' }),
      row('their', s.theirVideo ? 'Hide their video' : 'Show their video', s.video ? (s.theirVideo ? 'showing' : 'hidden: their name shows instead') : 'an audio call', { theirVideo: 'toggle' }, !s.video),
      row('mine', s.myVideo ? 'Hide my video' : 'Show my video', s.sending ? (s.myVideo ? 'they can see you' : 'they cannot see you') : 'no camera on this call', { myVideo: 'toggle' }, !s.sending),
      row('quieter', 'Call quieter', `now ${pct}%`, { volume: -1 }),
      row('louder', 'Call louder', `now ${pct}%`, { volume: 1 }),
    ];
  }

  // ---- A CALL TO A SCREEN WITH NO CALL PANEL (2026-10-02; call_notice.js) ------------------------------
  // The notice rings over the panels; its Answer claims the call and hands it HERE, where the Call module is
  // mounted over the panels to host it - its full view, the bar's live-call controls (it reports them, as a
  // panel does), the camera and microphone opened only once the claim is won - until somebody hangs up. Then
  // the view goes, and the screen is exactly as it was: nothing underneath was hidden, swapped or remounted.
  //
  // *** WHY AN OVERLAY, NOT THE CALL IN A PANEL'S PLACE (the library's `openLibraryAt`). Argued: ***
  //   FOR a panel's place: it reuses the library's box-beside-the-panel mechanism, and it is what the old Cici
  //   design did (the call overrode the clock quadrant).
  //   AGAINST, and it wins: it has to CHOOSE a panel to stand in for, and every choice is wrong somewhere - a
  //   one-panel screen loses its photos; a locked panel may not be touched; a TV or a room has no "place" a
  //   call fits; the panel promoted to full screen is the one somebody is looking at. Cici's clock quadrant
  //   was a choice for one fixed layout, and no layout here is fixed. A dashboard swap mid-ring would also
  //   tear an in-place notice down with the panel it stood in. An overlay chooses nothing, survives a swap,
  //   is always the same size and place, and "everything returns as it was" is just removing it.
  // THE CALL VIEW is in the `floating` band, BEFORE the mirror in the document: the mirror (same band, later)
  // stays on top of it, because the mirror IS the self-view (call.js header) - a call never draws a second
  // view of this room. The bar (above it) keeps its live-call controls. The NOTICE is above the menu, so a
  // ring is never hidden behind it; while the menu is open a switch drives the menu, and pointer and voice
  // still reach the notice.
  // WHILE EITHER SHOWS IT HAS THE SCAN (the library's rule): the panel router is paused, the dashboards tray
  // and a host page's controls let go, and next / prev / select / back walk the notice (Decline first, see
  // call_notice.js) or the call view (its Hang up). The menu, the edit view and the map keep the scan while
  // they are open - whoever has them open is at the screen.
  const CALL_VIEW_ROW = 'call-notice';     // the hosted call's own row: its volume, kept for this screen
  const CALL_VIEW_ID = 'call:notice';
  function holdCallScan(on) {
    callScanHeld = !!on;
    try {
      if (on) {
        if (screensOpen) toggleScreens(false);
        releaseHostScan();
        runtime?.router?.setPaused?.(true);
      } else if (!screensOpen && !menu?.isOpen?.() && !editScanHeld && !hostScanHeld && !libScanHeld) {
        runtime?.router?.setPaused?.(false);
      }
    } catch { /* no router yet */ }
  }
  // While the call view shows: one stop, Hang up. Nothing is lit at first (a stray select does nothing);
  // `back` hangs up, as it does on a Call panel (actions.js `call: { back: 'call/hangup' }`).
  function callViewVerb(v) {
    const cv = callView;
    if (!cv) return;
    if (v === 'next' || v === 'prev') cv.lit = 0;
    else if (v === 'select') { if (cv.lit === 0) hangUpCallView(); }
    else if (v === 'back') hangUpCallView();
    paintCallView(cv);
  }
  function paintCallView(cv) {
    if (!cv?.hang) return;
    const on = cv.lit === 0;
    if (on) cv.hang.dataset.lit = '1'; else delete cv.hang.dataset.lit;
    cv.hang.style.boxShadow = on ? '0 0 0 4px var(--scan-ring, var(--focus))' : '';
  }
  // Hang up the hosted call the way every other way does: the topic the Call module listens on.
  function hangUpCallView() { try { bus.publish(CALL_HANGUP_TOPIC, { from: 'kiosk' }); } catch (err) { console.error('kiosk: hang up', err); } }
  for (const [verb, as] of [['next', 'next'], ['prev', 'prev'], ['select', 'select'], ['back', 'back'],
    ['focus-next', 'next'], ['focus-prev', 'prev']]) {
    offsScreen.push(bus.subscribe(verbTopic(verb), () => {
      if (torn || !callScanHeld || screensOpen || editScanHeld) return;
      try { if (menu?.isOpen?.()) return; } catch { /* not up yet */ }
      try {
        if (callNotice?.showing?.()) callNotice.verb(as);
        else if (callView) callViewVerb(as);
      } catch (err) { console.error('kiosk: call verb', err); }
    }));
  }
  function attachCallNotice() {
    if (callNotice || torn || embedded || typeof document === 'undefined') return;
    const t = callTransportNow();
    if (!t || typeof t.onRing !== 'function') return;
    try {
      callNotice = createCallNotice({
        transport: t, host: kioskEl, bus,
        mode: () => callNoticeModeOf(settings.get() || {}),
        output: () => output,
        holdScan: (on) => { if (on) holdCallScan(true); else if (!callView) holdCallScan(false); },
        openCall: (from, opts) => openCallView(from, opts),
        zIndex: LAYERS.menus + 50,
      });
    } catch (err) { console.error('kiosk: call notice', err); callNotice = null; }
  }
  /** Host an answered call over the panels: the Call module, handed the call (call.js `takeCall`). */
  async function openCallView(from, { ringStartedAt = null } = {}) {
    if (torn || typeof document === 'undefined') return false;
    if (callView) closeCallView('replaced');
    const box = document.createElement('div');
    box.className = 'k-callview';
    box.dataset.callView = '';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Call');
    box.style.cssText = `position:absolute;inset:0;z-index:${LAYERS.floating};pointer-events:auto;background:var(--bg)`;
    const slot = document.createElement('div');
    slot.style.cssText = 'position:absolute;inset:0';
    // The way out, on the screen the whole call (a pointer, a scan, "hang up" said, `back`).
    const hang = document.createElement('button');
    hang.type = 'button';
    hang.dataset.callHangup = '';
    hang.textContent = 'Hang up';
    hang.style.cssText = 'position:absolute;top:2.5vmin;left:50%;transform:translateX(-50%);z-index:1;'
      + 'min-height:56px;min-width:8em;padding:.5em 1.4em;border-radius:12px;cursor:pointer;'
      + 'font:600 clamp(16px,2.4vmin,26px) system-ui,-apple-system,Segoe UI,sans-serif;'
      + 'background:var(--surface);color:var(--text);border:2px solid var(--focus)';
    hang.addEventListener('click', () => hangUpCallView());
    box.append(slot, hang);
    if (mirrorEl && mirrorEl.parentNode === kioskEl) kioskEl.insertBefore(box, mirrorEl);
    else kioskEl.append(box);
    const cv = { box, slot, hang, inst: null, state: null, events: null, lit: -1, offs: [] };
    callView = cv;
    holdCallScan(true);
    try {
      cv.state = withTypeLayer(stateFor(CALL_VIEW_ROW), 'call');
      // Its own record, so an answer from the notice is recorded with its ring-to-answer time, as a panel's is.
      cv.events = eventsFor(CALL_VIEW_ROW);
      cv.inst = mountModule('call', extendCtx(childCtx({ id: CALL_VIEW_ID, type: 'call' }), {
        mount: slot, state: cv.state, events: cv.events,
      }));
      await cv.state.load?.().catch?.(() => {});
      if (callView !== cv) return false;
      await cv.inst.init();
      if (callView !== cv) return false;
      cv.state.startPolling?.();
    } catch (err) {
      console.error('kiosk: the call view would not open', err);
      if (callView === cv) closeCallView('failed');
      return false;
    }
    const live = () => { try { return !!cv.inst?.impl?.controls?.()?.live; } catch { return false; } };
    // IT GOES WHEN THE CALL ENDS, however it ends: the module's own `call/ended` (a hang-up here or there, a
    // dropped connection, a failed answer), or the transport saying the call is no longer live (a Call panel
    // mounted mid-call by a dashboard swap would take the transport's end from this module).
    cv.offs.push(bus.subscribe(CALL_ENDED, () => { if (callView === cv && !live()) closeCallView('ended'); }));
    try {
      cv.offs.push(callTransport?.onLive?.((on) => { if (!on && callView === cv) queueMicrotask(() => { if (callView === cv && !live()) closeCallView('ended'); }); }) || (() => {}));
    } catch { /* no transport */ }
    let took = false;
    try { took = await cv.inst.impl.takeCall(from, { ringStartedAt }); }
    catch (err) { console.error('kiosk: answering in the call view', err); took = false; }
    if (callView === cv && !took && !live()) closeCallView('failed');
    return true;     // the module had the call: whatever became of it, it hung up its own way
  }
  function closeCallView(why = 'ended') {
    const cv = callView;
    if (!cv) return false;
    callView = null;
    cv.offs.splice(0).forEach((off) => { try { off?.(); } catch { /* gone */ } });
    // A call still live is hung up by the module itself on the way out (call.js `destroy`).
    if (cv.inst) { try { cv.inst.destroy(); } catch (err) { console.error('kiosk: closing the call view', err); } }
    else { try { cv.state?.destroy?.(); } catch { /* gone */ } }
    try { cv.events?.destroy?.(); } catch { /* gone */ }
    try { cv.box.remove(); } catch { /* gone */ }
    if (!torn && !callNotice?.showing?.()) holdCallScan(false);
    void why;
    return true;
  }

  // `:scope >` is not decoration. The camera module draws its OWN hidden `[data-settings]` inline
  // panel inside the mirror overlay, which comes EARLIER in document order, so a bare
  // `querySelector('[data-settings]')` mounted this menu inside it: open, but hidden by its
  // ancestor and 0x0 wide, on every screen that has a camera.
  // "HOW YOU CHOOSE THINGS" (2026-10-02, 6fd7575; settings_fields.js CHOOSE_MODE_FIELD): point and click (long
  // lists open as a list) or step through (for a switch). The person's row when the screen has one (it is
  // how THEY choose, and follows them), else the screen's. On the Devices tab, after the voice rows.
  const choiceRow = () => (personInputs && personRow && !embedded ? personInputs : settings);
  const chooseModeNow = () => chooseModeOf((choiceRow().get?.() || {})[CHOOSE_MODE_KEY]);
  function chooseModeItems() {
    // (2026-10-02: and how a switch walks the transport bar, which follows it by default -- transport_bar.js.)
    return fieldItems([normalizeField(CHOOSE_MODE_FIELD), normalizeField(BAR_SCAN_FIELD)], {
      values: () => choiceRow().get?.() || {},
      level: complexity(),
      onStep: (k, v) => {
        try { choiceRow().set?.({ [k]: v }); }
        catch (err) { console.error('kiosk: choose mode', err); }
      },
    }).map((it) => ({ ...it, ...MENU_TAB.devices(0) }));
  }
  // *** ONE MENU, TWO PLACES (2026-10-03). *** These options ARE the screen's settings: the ⚙ menu is
  // `mountSettings` over them, and so is every Settings panel on this screen (`settingsMenuFor`, below). There
  // is no second list anywhere; a row added here is in both.
  const menuOptions = {
    chooseMode: chooseModeNow,
    playerHost: () => playerHostNow(),   // players: who the player picker lists
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
    })()), ...voiceItems(), ...chooseModeItems(), ...usualStartItems(), ...playersItems()],   // players: its own tab
    // SCREEN-LEVEL SETTINGS. Written to the profile settings blob, which IS the screen level
    // of the inheritance chain — the same place the theme, the layout and the recovery policy
    // already live, so this adds a control over existing storage rather than a new home.
    screenItems: () => [
      ...(arr.profile()?.name ? [{ kind: 'item', id: 'screen-name', disabled: true, ...MENU_TAB.screen(0),
          label: `This screen: ${arr.profile().name}`, hint: 'renamed in Dashboards, on the home page' }] : []),
      // (Tabs: "How it looks" heads the Display tab's first rows; "Switches" the hold row on Devices; "Hidden
      // panels" the hide question's wait on Sound. Each row's tab: SCREEN_FIELD_TABS, else This screen.)
      { kind: 'heading', id: 'look-head', label: 'How it looks', ...MENU_TAB.display(0) },
      { kind: 'heading', id: 'switch-hold-head', label: 'Switches', ...MENU_TAB.devices(1) },
      { kind: 'heading', id: 'bar-key-head', label: 'The bar', ...MENU_TAB.devices(2) },   // bar toggle
      { kind: 'heading', id: 'hide-head', label: 'Hidden panels', ...MENU_TAB.audio(2) },
      ...fieldItems(SCREEN_FIELDS().map(normalizeField).filter(Boolean), {
        // (Stage 4: Colours shows -- and sets -- the theme of the dashboard that is SHOWING, `themeDoc`.
        // Everywhere but a real screen's dashboard path that is this screen's own row, as it always was.)
        // (Row 2.34: "Panel backgrounds" likewise -- the showing dashboard's, `shownPanelSurface`.)
        values: () => ({ ...(settings.get() || {}), theme: shownTheme(), panelSurface: shownPanelSurface(settings.get()),
          panelGap: shownPanelGap(settings.get()), [SMALL_CLOCK_KEY]: smallClockNow() }),
        // NOT filtered by `complexity()`. Both rows are declared `essential`, so passing the
        // active level would change nothing today — but passing `advanced` here would be the
        // quiet way the escape hatch stops being one the first time somebody adds a row.
        level: complexity(),
        onStep: (key, value) => {
          if (key === 'theme') themeDoc().set({ theme: value });
          else if (key === 'panelSurface') themeDoc().set({ panelSurface: value });
          else if (key === 'panelGap') themeDoc().set({ panelGap: value });
          // (2026-10-03: not a key of its own -- the corner clock's corner, or a clock added; `smallClockHere`.)
          else if (key === SMALL_CLOCK_KEY) smallClockHere(value).catch((err) => console.error('kiosk: small clock', err));
          else settings.set({ [key]: value });
          // A THEME PICKED HERE, BY SOMEBODY AT THIS SCREEN. Published after the set (which
          // applies the theme synchronously), so a listener sees the new theme already on screen.
          // It is how the AAC board knows it may offer its symbol-set choice card: a theme that
          // arrives from another device by polling never passes through here, so it never asks.
          // Topic: `THEME_PICKED_TOPIC` in modules/board.js (its suite checks this line).
          if (key === 'theme') bus.publish('screen/theme-picked', { theme: value });
        },
      }).map((it) => {
        const [tab, rank] = SCREEN_FIELD_TABS[String(it.id || '').replace(/^set:/, '')] || ['screen', 0];
        return { ...it, tab, rank };
      }).flatMap((it) => (it.id === 'set:theme' ? [it, ...seasonsWhyItems().map((w) => ({ ...w, tab: it.tab, rank: it.rank }))] : [it])),   // seasons
      // MOVEMENT AND FLASHING (argued at MOTION_FIELDS): written to the screen's row, seen at once (the
      // settings subscribe applies zoom; the flash limit is read live by everything that repeats).
      ...(() => {
        const rows = fieldItems(MOTION_FIELDS().map(normalizeField).filter(Boolean), {
          values: () => settings.get() || {},
          level: complexity(),
          onStep: (key, value) => { settings.set({ [key]: value }); },
        });
        return rows.length ? tagged([{ kind: 'heading', id: 'motion-head', label: 'Movement and flashing' }, ...rows], 'display', 1) : [];
      })(),
      // THE SCREEN'S SOUND: written to the same screen row, heard at once (the settings subscribe above
      // re-syncs the master and the mixer on every change). On the Sound tab, after the panel's own.
      ...tagged([{ kind: 'heading', id: 'sound-head', label: 'Sound' },
        ...fieldItems(SOUND_FIELDS().map(normalizeField).filter(Boolean), {
          values: () => settings.get() || {},
          level: complexity(),
          onStep: (key, value) => { settings.set({ [key]: value }); },
        })], 'audio', 1),
      // THE ROOM (Display tab): its reactions, and where the transport bar is.
      ...tagged([
        ...(roomRec() || barCanSitOnCabinet() ? [{ kind: 'heading', id: 'room-head', label: 'The room' }] : []),
        // THE ROOM'S REACTIONS (rows 2.36/2.37): which object lights, rings or pulses for which event. Only
        // while a room is on the screen -- a row that opens nothing is a row that lies.
        ...(roomRec() ? [{ kind: 'item', id: 'room-reactions', label: 'Room reactions…',
            hint: 'what the room’s things do when something happens', run: () => openRoomReactions() }] : []),
        // THE BAR ON THE LOW CABINET (room_bar.js argues it, off by default): only where the showing
        // dashboard's room has an object that holds the bar and there is a placed bar to move.
        ...(barCanSitOnCabinet() ? fieldItems([normalizeField(BAR_PLACE_FIELD)].filter(Boolean), {
          values: () => (themeDoc().get?.() || {}),
          level: complexity(),
          onStep: (key, value) => { themeDoc().set({ [key]: value }); },
        }) : []),
      ], 'display', 3),
      // ROW 2.38, the map editor: the edit view and the map, for a pointer (a switch binds `system/edit` /
      // `system/map`). Every row here is a stop on the one-switch walk ahead of Home, so: ONE row at "The
      // usual" (Edit -- the map is one press inside it, the Opens-and-shows window's Map), the Map's own row
      // only at "Everything", and neither at "Just the essentials" (the way out and legibility, nothing
      // else). The map not on an embed (nowhere to go).
      ...(complexity() !== 'essential' ? [
        { kind: 'item', id: 'edit-view', label: 'Edit this dashboard…', ...MENU_TAB.screen(1),
          hint: 'move things, choose what each one opens or shows, and what drives its settings', run: () => openEditView() },
      ] : []),
      ...(complexity() === 'advanced' && !embedded ? [{ kind: 'item', id: 'dashboard-map', label: 'Map of your dashboards…',
        ...MENU_TAB.screen(1), hint: 'every dashboard, and what opens or shows which', run: () => openMap() }] : []),
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
      ...(arr.ambientRec() ? (() => {
        const rows = fieldItems(fieldsFor(arr.ambientRec().instance.manifest, arr.ambientRec().instance), {
          values: () => arr.ambientRec().state.get() || {},
          level: complexity(),
          onStep: (key, value) => { arr.ambientRec().state.set({ [key]: value }); },
        });
        // (Display tab, under its own name: "Behind everything: <the ambient module>".)
        return rows.length ? tagged([{ kind: 'heading', id: 'ambient-head',
          label: `Behind everything: ${arr.ambientRec().title || arr.ambientRec().type}` }, ...rows], 'display', 2) : [];
      })() : []),
    ],
    // In a laid-out screen every panel is visible at once and the kiosk has no focus
    // concept yet, so there is no single subject and the menu says so rather than
    // guessing at one.
    // mountInstance flattens the manifest: the record carries `title`, NOT `manifest`.
    // Reading `manifest.title` silently fell back to the raw type, so the menu said
    // "This panel — photos" instead of "Photos".
    // (2026-10-02: the menu's SUBJECT -- the focused panel unless "Settings for" was stepped -- not
    // always the focused one. `menuSubjectRec` above.)
    subject: () => {
      // (2026-10-02: a LEVEL names itself -- "Every Photos panel", "This screen".)
      const lv = menuLevel();
      if (lv !== 'instance') return { type: 'level', title: levelTitle(lv), heading: levelTitle(lv) };
      // (2026-10-02: a piece of the room names itself -- `menuPiece`.)
      const pc = menuPiece();
      if (pc) return { type: 'room-piece', title: pc.label };
      const r = menuSubjectRec();
      return r ? { type: r.type, title: r.title || r.type } : null;
    },
    // ---- THE TABS (2026-10-02; MENU_TAB_DEFS above argues the set) ----
    tabs: () => MENU_TAB_DEFS(),
    slotTabs: { who: 'people', subject: 'module', extras: 'screen', screen: 'screen' },
    // Where it opens: the panel's tab -- except on a host page with its own rows (Home), where they are what
    // somebody opening the menu came for (the gear there reads "Edit"), so "This page" first.
    startTab: () => {
      try { if (hostPage && typeof hostPage.menuItems === 'function' && (hostPage.menuItems() || []).length) return 'page'; }
      catch { /* a host that throws costs its own tab, never the menu */ }
      return 'module';
    },
    topIds: ['set:complexity'],
    // (2026-10-02: the panels AND the levels -- `levelSubjects` argues the order.)
    subjects: () => levelSubjects(),
    // (2026-10-02: the selected STOP -- a piece of the room included, `focusedTargetNow`.)
    defaultSubject: () => focusedTargetNow()?.id || null,
    // A different subject closes the Layout list.
    onSubject: () => { layoutOpen = false; },
    fullscreenTarget: root,
    // The who page's avatar subscription lets go with the menu (see the page). The menu gives the router
    // back as it closes (settings.js); with the Modules library standing in a panel's place, the library
    // still holds the scan, so it is taken again here (this hook runs after that).
    // (2026-10-02: and the device's fonts and looks are read again next time -- a file added meanwhile shows.)
    onClose: () => { offWhoAvatars(); layoutOpen = false; deviceLookRead = null; if (libOpen && !torn) holdLibraryScan(true);
      // A call notice or a hosted call keeps the scan it had (the menu's close gives the router back).
      if (callScanHeld && !torn) holdCallScan(true); },
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
      // (2026-10-02: a LEVEL chosen in "Settings for" -- that level's rows, and its Layout list while open.)
      const lv = menuLevel();
      if (lv !== 'instance') return layoutOpen && canChangeLayout() ? layoutRows() : levelRows(lv);
      // (2026-10-02: a piece of the room chosen in "Settings for" -- its own options, `pieceRows`.)
      const pc = menuPiece();
      if (pc) return pieceRows(pc);
      const rec = menuSubjectRec();
      if (!rec) return [];
      // The instance-level override goes FIRST — "which panel is this" before "what does this
      // kind of panel let you change" — and through the same `fieldItems`/`onStep` call as the
      // module's own fields, so cycling, hints and disabling all work identically; it is only a
      // different SOURCE array, not a different mechanism.
      const fieldsOpts = {
        // A FUNCTION, not a snapshot: two presses without a repaint in between would
        // otherwise step from the same stale value twice, and the second press would look
        // dropped — which somebody debugs as a broken switch.
        values: () => rec.state.get() || {},
        level: complexity(),
        // (row 2.57) A value the panel keeps somewhere else - a YouTube key, sealed on the server - is
        // handed to the panel (`settingsWrite` returns true) and never stored in its settings.
        onStep: (key, value) => {
          let taken = false;
          try { taken = (rec.instance?.impl || rec.instance)?.settingsWrite?.(key, value) === true; } catch (err) { console.error('kiosk: settingsWrite', err); }
          if (!taken) rec.state.set({ [key]: value });
        },
      };
      const items = fieldItems([
        ...PANEL_INSTANCE_FIELDS().map(normalizeField).filter(Boolean),
        ...fieldsFor(rec.instance.manifest, rec.instance),
      ], fieldsOpts).map((it) => ({ ...it, ...MENU_TAB.module(0) }));
      // *** "FOLLOWING: EVERY <MODULE> PANEL" (2026-10-02; the module level, `withTypeLayer`). *** Only where
      // the kind HAS a value for the key -- every other row is exactly what it was. A row the panel has not
      // set itself says what it follows; one it has set gets a second row that puts it back.
      const kind = typeDefaults(rec.type);
      if (kind) {
        const own = (() => { try { return rec.state.own?.() || null; } catch { return null; } })();
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const it = items[i];
          if (!it.key || !isSetValue(kind[it.key]) || !own) continue;
          if (!isSetValue(own[it.key])) {
            items[i] = { ...it, hint: `Following: ${levelName('module')} — ${it.hint}` };
          } else {
            items.splice(i + 1, 0, { kind: 'item', id: `set:${it.key}:follow`, ...MENU_TAB.module(0),
              label: `${it.label}: follow ${levelName('module')}`, hint: 'put it back to following',
              run: () => { rec.state.set({ [it.key]: null }); } });
          }
        }
      }
      // "See reviews…" under "Include unreviewed questions" (Trivia's), 2026-10-04 (`withReviewsLink`).
      withReviewsLink(items);
      // players: a game's "Players" row names the people as this login knows them.
      items.splice(0, items.length, ...withPlayerNames(items));
      // PAUSE / PLAY for this panel (2026-10-02; `playPauseSelected` argues it): only on a panel that can.
      if (canPausePanel(rec)) {
        const paused = pausedPanels.has(rec.id);
        items.push({ kind: 'item', id: 'play-pause', ...MENU_TAB.module(0),
          label: paused ? `Play ${panelName(rec)}` : `Pause ${panelName(rec)}`,
          hint: paused ? 'it is paused' : 'the same as the bar’s Pause', run: () => { playPauseSelected(rec.id); } });
      }
      // *** THE PANEL'S OWN SOUND, on the Sound tab (2026-10-02; panel_sound.js). *** Only on a panel that
      // makes sound -- a TV counts when anything on it does (audio_bus.js `within`). "When this panel is
      // hidden" (ad7dc49) moved here from the panel's rows: it is about sound.
      const sounds = makesSound({ instanceId: rec.id, audio, manifest: rec.instance.manifest });
      if (sounds) {
        const soundRows = fieldItems([
          normalizeField(PANEL_VOLUME_FIELD),
          // (2026-10-02: the default is the module's own -- hide_sound.js `whenHiddenDefault`; a call keeps playing.)
          normalizeField({ ...WHEN_HIDDEN_FIELD, default: whenHiddenDefault(rec.instance.manifest) }),
          normalizeField(ROOM_SOUND_FIELD),
        ].filter(Boolean), fieldsOpts);
        items.push(...tagged([{ kind: 'heading', id: 'panel-sound-head', label: `${rec.title || rec.type}: its sound` },
          ...soundRows, ...nestedSoundRows(rec)], 'audio', 0));
      }
      // *** "MAKE YOUR OWN PACK WITH THE AI OF YOUR CHOICE" NEEDED A WAY BACK IN. ***
      // `games.html`'s course page already has the prompt; without this, the file it produces
      // had nowhere to go. A plain item with `page:` here, a matching entry in `pages` below —
      // same pattern this file already uses for `who`, not a new mechanism. Reachable from
      // whichever module actually reads a pack (Trivia, Word Forge) plus Quests, since a
      // pack's points feed the same economy — not from every module, which would be a row
      // that does nothing on a panel with no concept of a pack.
      if (['trivia', 'wordforge', 'quests'].includes(rec.type)) {
        items.push({
          kind: 'item', id: 'load-pack', page: 'pack-loader', ...MENU_TAB.module(0),
          label: 'Load your own pack',
          hint: 'from a file, or paste JSON',
        });
      }
      // "SWITCH MODULE" (2026-10-02): the Modules library in this panel's place (`openLibraryAt` closes the
      // menu first: it would cover the library). Not at "Just the essentials" (that level is legibility and
      // the ways out); the bar's button is there.
      // (2026-10-02: a LOCKED panel's row stays, and says so; pressing it says how to unlock -- `lockedNow`.)
      if (complexity() !== 'essential') items.push({ kind: 'item', id: 'switch-module', ...MENU_TAB.module(0),
        label: `Switch ${rec.title || rec.type} to another module…`,
        hint: lockedNow(rec.id) ? 'locked on this dashboard: Unlock is on Home, under Change'
          : 'opens Modules in its place; its settings are kept for when you switch back',
        run: () => openSwitch(rec.id) });
      // EDIT THIS PANEL IN PLACE (2026-10-02; edit_mode.js, the ✎ corner's press for a scan). The menu closes
      // first: it would cover the panel being edited. Not at "Just the essentials", for Switch module's reason.
      if (complexity() !== 'essential') items.push({ kind: 'item', id: 'edit-panel', ...MENU_TAB.module(0),
        label: 'Edit this panel', hint: `${panelName(rec)}, in place: press a thing in it to see its options`,
        run: () => {
          try { menu.close(); } catch { /* already closed */ }
          bus.publish('shell/edit-panel', { id: rec.id, on: true, from: 'menu' });
        } });
      // MAKE IT BIGGER / SMALLER (2026-10-02; the corner's press, for a scan). Not at "Just the essentials"
      // (legibility and the ways out). It closes the menu first: the menu covers what it would show.
      if (complexity() !== 'essential') {
        const top = promotedScreen === rec.id;
        const filling = arr.promotedId?.() === rec.id;
        // 2026-10-03 ("no way to demote it"): "smaller" is its own row whenever this panel is bigger, at
        // either level -- before, it was offered only at the screen level. "Bigger" goes while there is no
        // level above.
        if (!top) {
          items.push({ kind: 'item', id: 'promote', ...MENU_TAB.module(0),
            label: `Make ${panelName(rec)} bigger`,
            hint: filling ? 'fills its dashboard now — next, the screen' : 'fills its dashboard, then the screen',
            run: () => { try { menu.close(); } catch { /* already closed */ } promotePanel(rec.id); } });
        }
        if (top || filling) {
          items.push({ kind: 'item', id: 'demote', ...MENU_TAB.module(0),
            label: `Make ${panelName(rec)} smaller`,
            hint: top ? 'back to filling its dashboard' : 'back to its place on the dashboard',
            run: () => { try { menu.close(); } catch { /* already closed */ } demotePanel(); } });
        }
      }
      // IN THE SWITCH SCAN, OR NOT (2026-10-02; `inLapRow` argues it): on a panel placed freely.
      const lap = inLapRow(rec);
      if (lap) items.push(lap);
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
      // "Your own folders" (15eb6b3): fonts, colour looks, plugins on this device. (2026-10-03, from the
      // Settings panel's copy: its font and colour-look rows follow "How you choose things", like every list.)
      get [USER_FOLDERS_PAGE]() { return userFoldersPage({ chooseMode: chooseModeNow }); },
      // "Where your history is kept" (row 2.58, 2026-10-07; history_page.js), on the People tab.
      get [HISTORY_PAGE]() { return historyPage({ host: historyHost }); },
      // THE NIMROD GAME (unlocks.js, 2026-10-02): its settings page, on this screen's own rows and bus. Its id is
      // unlocks.js's GAME_SETTINGS_PAGE ('sc-game'), the id the guide asks for, since 2026-10-03 ('game' before).
      get [GAME_SETTINGS_PAGE]() {
        return gameSettingsPage({ makeState: (k, o) => stateFor(k, o), makeEvents: (k, o) => eventsFor(k, o), bus });
      },
      // LESSON TOPICS (moved here from the Settings panel's own list, 2026-10-03; its id 'sc-mode' kept, so the
      // guide's "Show the lesson-topic setting" still finds it). `lessonTopicsPage` argues it.
      get 'sc-mode'() { return lessonTopicsPage(); },
      // A PAGE SET UP SOMEWHERE ELSE, ON A SCREEN (2026-10-04; page_links.js): the address and a code to scan,
      // instead of opening /claude.html or /reviews.html over the dashboard. Back is the menu's own.
      ...Object.fromEntries(Object.keys(ELSEWHERE_PAGES).map((k) => [`${ELSEWHERE_PAGE_PREFIX}${k}`, elsewhereMenuPage(k)])),
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
        const rec = menuSubjectRec();
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
              // EACH PERSON'S AVATAR BESIDE THEIR NAME (row 2.37 item 5; avatar_display.js). One cache
              // for the screen, made the first time this page is drawn (not at boot: nobody may ever
              // open it), one read per person. Somebody with no avatar gets an empty slot and the
              // name exactly as before.
              const av = whoAvatars();
              const face = (id) => (av ? avatarHtml(av.get(id), { personId: id }) : '');
              el.innerHTML = peopleList.map((who) => {
                const on = personId && who.id === personId;
                return `<button class="st-item" type="button" data-person="${esc(who.id)}">
                  <span class="st-label"><span data-avatar-slot>${face(who.id)}</span>${esc(who.name)}</span>
                  ${on ? '<span class="st-hint">this screen is theirs</span>' : ''}
                </button>`;
              }).join('');
              // A face that arrives (or changes) later rewrites ONLY that person's slot; a picture that
              // will not decode falls back (bindErrors). Both let go when this page is gone - the next
              // change after the menu closes finds the page detached and unsubscribes, and closing the
              // menu lets go at once (`onClose`).
              if (av) {
                offWhoAvatars();
                const offErr = av.bindErrors(el);
                const offSub = av.subscribe((pid) => {
                  if (!el.isConnected) { offWhoAvatars(); return; }
                  const slot = [...el.querySelectorAll('[data-person]')].find((b) => b.dataset.person === pid)
                    ?.querySelector('[data-avatar-slot]');
                  if (slot) slot.innerHTML = face(pid);
                });
                whoAvatarOffs = [offErr, offSub];
              }
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
      // A LIVE CALL'S CONTROLS (2026-10-02; `callRows`): at the top of the first tab while a call is live,
      // whichever panel or level the menu is about -- the scan's way to them.
      ...callRows(),
      // THE HOST PAGE'S SECTION (Home: its Save / Save as / History and its page settings), first in
      // the menu's middle: they are what somebody on that page came to the menu for. A host that throws
      // costs its own rows, never the menu -- the menu is the tool for repairing the broken thing.
      // (Tabs: its own tab, "This page" -- unless a row names another. Only on a page that has rows.)
      // (2026-10-04: asked for in plain words while the menu is plain -- `plainMenu`, below.)
      ...(() => {
        if (!hostPage || typeof hostPage.menuItems !== 'function') return [];
        try { return (hostPage.menuItems(plainMenu() ? { plain: true } : undefined) || []).map((it) => (it && !it.tab ? { ...it, ...MENU_TAB.page(0) } : it)); }
        catch (err) { console.error('kiosk: host menu', err); return []; }
      })(),
      // (Tabs: "what can I press" and "what else this talks to" are Devices.)
      ...tagged(runtime ? CONTROL_ITEMS : [], 'devices', 2),
      // The Nimrod Game's page (unlocks.js), on the This screen tab -- and beside it "Lesson topics" (quest or
      // sandbox; moved here from the Settings panel's own list 2026-10-03), the other thing that decides what
      // the lessons and games let somebody open.
      ...tagged([{ kind: 'item', id: 'game', label: 'Nimrod Game', page: GAME_SETTINGS_PAGE },
        { kind: 'item', id: 'lesson-topics', label: 'Lesson topics', page: 'sc-mode',
          hint: `now: ${modeFrom(settings.get() || {}) === 'quest' ? 'Quest' : 'Sandbox'}` },
        // *** "REVIEW QUESTIONS…" (2026-10-04; page_links.js argues the screen's behaviour). *** /reviews.html had
        // no link at all. Beside the Nimrod Game and Lesson topics, argued: FOR the panel's own tab only (it is a
        // Trivia thing): that row is there too, under "Include unreviewed questions" (`withReviewsLink`), but only
        // while a Trivia panel is the subject, and the review list is the ACCOUNT's, for every pack, wanted from
        // any panel. AGAINST This screen: it is not about this screen. It sits with the two rows that decide what
        // the games ask, which is what a review decides. Not at "Just the essentials" (legibility and the ways out).
        ...(complexity() !== 'essential' ? [pageRow('reviews', { isScreen: !embedded })] : [])], 'screen', 2),
      ...tagged(CONNECTION_ITEMS, 'devices', 3),
      // *** "CLAUDE ON THIS ACCOUNT…" (2026-10-04). *** Mike: "How do I go there?" -- /claude.html had no link.
      // ON DEVICES, beside "What else this can talk to", argued: there is no AI tab, and the voice rows (the
      // closest thing: speech in) are on Devices already. Claude is something this screen TALKS TO, which is
      // exactly what that row lists. AGAINST "This device" (the level in "Settings for"): the key is the
      // ACCOUNT's, kept on the server, not this browser's -- and a level is a press away on every lap. AGAINST
      // People: that tab is who the screen is for, not what it connects to. Not at "Just the essentials".
      ...(complexity() !== 'essential' ? tagged([pageRow('claude', { isScreen: !embedded })], 'devices', 3) : []),
      // (2026-10-04: the song and video search keys, 93074ff, beside Claude for the same reason: something this
      // site talks to, with a key kept on the server. Until now only the recommend window linked to it.)
      ...(complexity() !== 'essential' ? tagged([pageRow('search', { isScreen: !embedded })], 'devices', 3) : []),
      ...tagged(USER_FOLDER_ITEMS, 'screen', 2),
      // Where this person's history is kept (history_page.js argues the People tab).
      ...tagged(HISTORY_ITEMS, 'people', 3),
      // LETTING THE SCREEN FIX ITSELF, as an ordinary settings row. Turning recovery on used
      // to mean hand-writing state; now it is one press, which is what "turn it on for the
      // bench first" has to mean in practice. Written to the same profile settings blob the
      // engine reads, so there is one source of truth rather than two.
      ...tagged([{ kind: 'heading', id: 'recovery-head', label: 'When something stops working' },
        ...fieldItems(RECOVERY_SETTINGS.map(normalizeField).filter(Boolean), {
          values: () => (settings.get() || {}).recovery || {},
          level: complexity(),
          onStep: (key, value) => {
            const cur = (settings.get() || {}).recovery || {};
            settings.set({ recovery: { ...cur, [key]: value } });
          },
        })], 'screen', 2),
      // after a restart (row 2.70; restart.js argues the one row, its list and the default): Home, where it left off,
      // or any dashboard on the account, by name. Device-local, as it always was.
      ...tagged([RESTART_HEADING, ...fieldItems([normalizeField(restartField({
        cfg: restart, screens: restartScreens, homeId: bootProfileId,
        homeName: screenNames.get(bootProfileId) || restartScreens.find((d) => d && d.id === bootProfileId)?.name
          || (profileId === bootProfileId ? arr.profile()?.name : '') || '',
        names: screenNames,
      }))].filter(Boolean), {
        values: () => ({ [RESTART_KEY]: restartValue(restart) }),
        level: complexity(),
        idPrefix: '',
        onStep: (_key, value) => {
          restart = writeConfig(user, restartPatch(value), storage);
          menu.refresh();
        },
      })], 'screen', 3)],
    // Still ungated at the bedside, deliberately. The three-way switch in input.js gates
    // which BINDINGS fire; it does not answer "is a moderator standing here", and inventing
    // that mapping would be guessing at semantics nobody has decided. Open, and recorded as
    // open rather than papered over with a plausible-looking default.
    gated: false,
    // A press in the ⚙ menu shows in every Settings panel at once (`refreshViews`).
    onSelect: () => refreshViews(),
  };
  // ---- LOCK THIS SCREEN, IN THE ONE MENU (2026-10-05; screen_lock.js argues which rows stay and why) ------------------
  // Applied to `menuOptions` ITSELF, so the ⚙ menu (and the plain-words layer below, built over it) and every Settings
  // panel (`settingsMenuFor`) are one locked menu - no second list. Unlocked, every slot reads straight through, plus the
  // lock's own rows at the top of This screen. Locked (narrowed 2026-10-05): every tab, every level and every row stays
  // EXCEPT the ways to the computer and the account (`keepWhileLocked`: the keys pages, Your own folders, Who this screen
  // is for, key / pass phrase / sound-address rows), those pages refuse to open whatever asks (`LOCK_PAGE_DROPS`),
  // "Leave full screen" is not offered, and ABOVE THE TABS one row says it is locked and how to unlock (a stop only when
  // a PIN makes it pressable).
  const LOCK_STATE_ROW = 'screen-lock-state';
  const LOCK_RELOCK_KEY = 'screenRelockHours';
  let pinStrip = null;
  function openPinStrip(mode) {
    if (!screenLock || torn || typeof document === 'undefined') return null;
    if (!pinStrip) {
      pinStrip = mountPinStrip(kioskEl, {
        submit: async (m, pin) => {
          if (m === 'set') {
            const r = await screenLock.setPin(pin);
            return r.ok ? { ok: true } : { ok: false, text: 'That PIN could not be kept here.' };
          }
          const r = await screenLock.unlock({ pin, by: 'pin' });
          if (r.ok) return { ok: true };
          if (r.reason === 'wait') {
            return { ok: false, text: `Too many tries: wait ${Math.ceil((r.waitMs || 0) / 1000)} seconds. Forgot it? Clearing this `
              + 'browser’s saved data for this site removes the lock and the PIN.' };
          }
          return { ok: false, text: 'That is not the PIN.' };
        },
      });
    }
    pinStrip.open(mode);
    return pinStrip;
  }
  function lockMenuRows() {
    if (!screenLock) return [];
    const words = chordWords(lockControlNow());
    const pin = screenLock.needsPin();
    if (screenLocked()) {
      return [{ kind: 'item', id: LOCK_STATE_ROW, disabled: !pin,
        label: pin ? 'Locked: unlock…' : `Locked: ${words} unlocks it`,
        hint: pin ? `type the PIN (or press ${words})` : 'everything on it still works; leaving it and the account’s keys wait until it is unlocked',
        ...(pin ? { run: () => { try { menu.close(); } catch { /* already closed */ } openPinStrip('unlock'); } } : {}) }];
    }
    // Not at "Just the essentials" (legibility and the ways out); the chord works at every level.
    if (complexity() === 'essential') return [];
    const t = MENU_TAB.screen(-1);
    return [
      { kind: 'heading', id: 'screen-lock-head', label: 'Locking this screen', ...t },
      { kind: 'item', id: 'screen-lock', label: 'Lock this screen', ...t,
        hint: `everything on it keeps working, editing too; leaving it and the account’s keys wait for ${words}${pin ? ' and the PIN' : ''}`,
        run: () => { screenLock.lock({ by: 'menu' }); } },
      { kind: 'item', id: 'screen-lock-pin', label: pin ? 'Unlock PIN: on' : 'Unlock PIN: off', ...t,
        hint: pin ? 'press to remove it' : 'press to choose one: then unlocking asks for it, and works by touch alone',
        run: () => {
          if (pin) { screenLock.clearPin(); return; }
          try { menu.close(); } catch { /* already closed */ }
          openPinStrip('set');
        } },
      ...fieldItems([normalizeField({ key: LOCK_RELOCK_KEY, label: 'Lock again by itself', kind: 'choice', level: 'advanced',
        default: 0, options: RELOCK_CHOICES.map((h) => ({ value: h,
          label: h ? `after ${h} hour${h === 1 ? '' : 's'} of nobody using it` : 'Never' })) })].filter(Boolean), {
        values: () => ({ [LOCK_RELOCK_KEY]: screenLock.get().relockHours }),
        level: complexity(),
        onStep: (k, v) => { screenLock.setRelockHours(Number(v)); },
      }).map((it) => ({ ...it, ...t })),
    ];
  }
  if (screenLock) {
    const own = { fields: menuOptions.fields, whoItems: menuOptions.whoItems,
      screenItems: menuOptions.screenItems, extras: menuOptions.extras, pages: menuOptions.pages };
    const keep = (rows) => (screenLocked() ? keepWhileLocked(rows) : rows);
    Object.assign(menuOptions, {
      fields: () => keep(own.fields()),
      whoItems: () => keep(own.whoItems()),
      screenItems: () => keep(own.screenItems()),
      extras: () => [...lockMenuRows(), ...keep(own.extras())],
      // The pages behind the dropped rows, whatever asks for them (a guide's act, a bound switch): words and Back.
      pages: new Proxy(own.pages, {
        get: (t, k) => (screenLocked() && LOCK_PAGE_DROPS.includes(k) ? LOCKED_PAGE : t[k]),
      }),
      topIds: [...(menuOptions.topIds || []), LOCK_STATE_ROW],
      canLeaveFullscreen: () => !screenLocked(),
    });
  }
  // *** THE ⚙ MENU IN PLAIN WORDS, OVER A PAGE THAT ASKS FOR A PLAIN BAR (2026-10-04, Your people). *** The host page's
  // `plainBar()` (modules.html: Your people, filling the window) already keeps the bar to plain words
  // (modules/transport_bar.js "A PLAIN BAR"); this does the same for the menu its ⚙ opens -- the ⚙ menu only: a
  // Settings panel (`settingsMenuFor`) is the whole menu, put on a dashboard on purpose. While the host asks:
  //   * "Settings for" holds the selected part alone (no "Every <it> panel", no levels, no other panels); the first tab
  //     and its heading are that part's own name ("This part" when it has none), and it loses what only acts on a
  //     panel of a dashboard: Switch, Edit this panel, bigger / smaller, Pause / Play, the switch lap, the panel's box.
  //   * the other tabs lose the rows that only act on the panels (Panel backgrounds, Space between panels, Grow the
  //     panel the cursor is on, Show a small clock -- the page's own "Edit my page" adds a clock --, the hidden-panel
  //     question, Edit this dashboard, the Map); two keep their place in plainer words (Claude, the screen's name);
  //     and the host's own rows are asked for plainly (`menuItems({ plain: true })`).
  // HIDDEN, NOT DIMMED, for the plain bar's reason (transport_bar.js PLAIN_HIDES, argued there against D16's "dimmed,
  // never hidden"): these never act on this page, and a column of grey panel words is the vocabulary it keeps away.
  // NOTHING BECOMES UNREACHABLE: "All settings…", at the end of every tab, is this menu as it is everywhere else, until
  // it closes (the next ⚙ is plain again). Off such a page every slot below reads straight through, unchanged.
  let menuAll = false;                     // "All settings…" pressed: the whole menu, until it closes
  const hostAsksPlain = () => { try { return !!hostPage && typeof hostPage.plainBar === 'function' && !!hostPage.plainBar(); } catch { return false; } };
  function plainMenu() { return !viewNow && !menuAll && hostAsksPlain(); }
  const PLAIN_PART = 'This part';
  const PLAIN_MENU_DROPS = new Set(['switch-module', 'edit-panel', 'promote', 'demote', 'play-pause', 'scan-lap', 'piece-edit',
    'set:instancePanelSurface', 'set:panelSurface', `set:${PANEL_GAP_FIELD.key}`, `set:${ZOOM_FOCUS_FIELD.key}`,
    `set:${SMALL_CLOCK_KEY}`, `set:${HIDE_ASK_TIMEOUT_FIELD.key}`, 'edit-view', 'dashboard-map']);
  const PLAIN_MENU_WORDS = {
    'claude-page': { label: 'Claude…', hint: (h) => h.replace('the account’s key', 'the key it uses') },
    'screen-name': { hint: () => 'renamed on the home page' },
  };
  function plainRow(it) {
    if (!it || PLAIN_MENU_DROPS.has(it.id) || /:follow$/.test(String(it.id || ''))) return null;
    const w = PLAIN_MENU_WORDS[it.id];
    let out = !w ? it : { ...it, ...(w.label ? { label: w.label } : {}), ...(w.hint && typeof it.hint === 'string' ? { hint: w.hint(it.hint) } : {}) };
    // (A row following "every <it> panel" says only what it is set to: the level is not offered here.)
    const follow = `Following: ${levelName('module')} — `;
    if (typeof out.hint === 'string' && out.hint.startsWith(follow)) out = { ...out, hint: out.hint.slice(follow.length) };
    return out;
  }
  const plainSlot = (f) => (...a) => (plainMenu() ? (f(...a) || []).map(plainRow).filter(Boolean) : f(...a));
  const allSettingsRow = () => ({ kind: 'item', id: 'all-settings', tab: '*end', label: 'All settings…',
    hint: 'the full menu, as it is everywhere else',
    run: () => { menuAll = true; try { menu.refresh(); menu.focusRow('tabs'); } catch { /* closed meanwhile */ } } });
  const plainMenuOptions = {
    ...menuOptions,
    subject: () => {
      const s = menuOptions.subject();
      return s && plainMenu() ? { ...s, heading: s.title || PLAIN_PART } : s;
    },
    tabs: () => {
      const t = menuOptions.tabs();
      return plainMenu() ? t.map((d) => (d.id === 'module' && d.label === 'This panel' ? { ...d, label: PLAIN_PART } : d)) : t;
    },
    subjects: () => {
      const all = menuOptions.subjects();
      if (!plainMenu()) return all;
      const want = menuOptions.defaultSubject();
      const one = (all || []).find((s) => s && s.id === want)
        || (all || []).find((s) => s && !String(s.id || '').startsWith(LEVEL_PREFIX));
      return one ? [one] : [];
    },
    fields: plainSlot(menuOptions.fields), whoItems: plainSlot(menuOptions.whoItems), screenItems: plainSlot(menuOptions.screenItems),
    extras: () => (plainMenu() ? [...plainSlot(menuOptions.extras)(), allSettingsRow()] : menuOptions.extras()),
    onClose: () => { menuAll = false; menuOptions.onClose(); },
  };
  const menu = mountSettings(kioskEl.querySelector(':scope > [data-settings]'), plainMenuOptions);
  // Every repaint the screen asks of the ⚙ menu (a name arriving, a voice changing...) reaches the panels too.
  {
    const ownRefresh = menu.refresh;
    menu.refresh = (...a) => { const r = ownRefresh(...a); refreshViews(); return r; };
  }
  // ...and a change to the screen's row from anywhere (another device, a page that writes it itself).
  {
    const offViewSync = settings.subscribe?.(() => refreshViews());
    if (typeof offViewSync === 'function') offsScreen.push(offViewSync);
  }
  menuBuilt?.();

  // ---- THE SETTINGS PANEL IS THIS MENU (2026-10-03) ------------------------------------------------------
  //
  // Mike: "The settings module should be the same as the settings menu. There shouldn't be 2 different things."
  // Until now the Settings panel (modules/settings.js) built its own list - other panels' settings, a Theme page,
  // Lesson topics, the Nimrod Game, Your own folders, and a note that the screen's own settings were "not
  // reachable from here yet". That was a second list to keep in step, and it had already fallen behind (no tabs,
  // no levels, no "How much this menu shows", none of the screen's rows).
  //
  // HOW THE PANEL GETS THE MENU, argued. The panel asks `ctx.settingsMenu(host)` and gets THIS menu - the same
  // `menuOptions`, mounted by the same `mountSettings` into its own box with `asPanel` (no open/close chrome).
  //   FOR: one list of rows, one write path per row, by construction. A row added above is in the panel the
  //   same day, with no second place to remember; the panel can never show a setting the menu does not.
  //   AGAINST: the panel needs a host that has a menu. A bare module page has none, and there the panel says so
  //   (modules/settings.js argues that over showing a subset).
  //   AGAINST, the other shape considered: one menu INSTANCE moved between the ⚙ scrim and the panel. Rejected:
  //   both are wanted on screen at once (Mike: both open, in step), and the ⚙ menu resets to the selected panel
  //   at every open, which would yank the panel's place out from under somebody using it.
  // WHAT IS SHARED AND WHAT IS NOT: every VALUE is shared (the rows read and write the same records), so a change
  // in either shows in the other (`refreshViews` on every press, and when the screen's row changes). The VIEW is
  // each one's own - "Settings for", the tab, the cursor, an open page - so somebody at the panel and somebody at
  // ⚙ do not move each other's place. A panel starts on the selected panel, never on itself.
  // SWITCH SCANNING: the panel answers the menu's own four moves (actions.js MODULE_VERBS `settings`); while the
  // ⚙ menu is open it is in front and has the presses, exactly as with any other panel.
  function refreshViews() {
    if (viewSyncQueued || !menuViews.size) return;
    viewSyncQueued = true;
    Promise.resolve().then(() => {
      viewSyncQueued = false;
      if (torn) return;
      for (const e of [...menuViews]) { try { e.view.refresh(); } catch (err) { console.error('kiosk: settings panel', err); } }
    });
  }
  /** A press in one panel: the ⚙ menu (if open) and every other panel show it. */
  function syncFrom() {
    // (`menu.refresh` repaints the panels as well; closed, only they need it.)
    try { if (menu.isOpen()) menu.refresh(); else refreshViews(); } catch { refreshViews(); }
  }
  function inView(view, fn) {
    const was = viewNow;
    viewNow = view;
    try { return fn(); } finally { viewNow = was; }
  }
  /** Rows built for `view`: a press on one (its `run` / `commit`) is answered as that view's. */
  function rowsFor(view, rows) {
    return (rows || []).map((it) => {
      if (!it || (typeof it.run !== 'function' && typeof it.commit !== 'function')) return it;
      const out = { ...it };
      if (typeof it.run === 'function') out.run = (...a) => inView(view, () => it.run(...a));
      if (typeof it.commit === 'function') out.commit = (...a) => inView(view, () => it.commit(...a));
      return out;
    });
  }
  /** The ⚙ menu, drawn into `host` as a panel (modules/settings.js). Null once the screen is gone. */
  function settingsMenuFor(host, { instanceId = null } = {}) {
    if (torn || !host) return null;
    let view = null;
    const o = menuOptions;
    const as = (f) => (typeof f === 'function' ? (...a) => inView(view, () => f(...a)) : f);
    const rows = (f) => (...a) => inView(view, () => rowsFor(view, f(...a)));
    const pages = {};
    for (const k of Object.keys(Object.getOwnPropertyDescriptors(o.pages))) {
      Object.defineProperty(pages, k, {
        enumerable: true,
        get: () => {
          const def = inView(view, () => o.pages[k]);
          if (!def || typeof def.render !== 'function') return def;
          return { ...def, render: (el) => inView(view, () => def.render(el)) };
        },
      });
    }
    view = mountSettings(host, {
      ...o,
      person: as(o.person), subject: as(o.subject), tabs: as(o.tabs), startTab: as(o.startTab),
      subjects: as(o.subjects), onSubject: as(o.onSubject),
      whoItems: rows(o.whoItems), screenItems: rows(o.screenItems), fields: rows(o.fields), extras: rows(o.extras),
      // It starts on the selected panel, as ⚙ does - but never on ITSELF (a Settings panel's own rows are the
      // panel's box and background, not what somebody opened it for): the next subject instead.
      defaultSubject: () => inView(view, () => {
        const want = o.defaultSubject?.() || null;
        if (want && want !== instanceId) return want;
        const list = (o.subjects?.() || []).filter((s) => s && s.id && s.id !== instanceId);
        return list[0]?.id || null;
      }),
      pages,
      asPanel: true, inline: true, includeHome: false, fullscreenTarget: null,
      onHome: null, onClose: null,
      onSelect: () => syncFrom(),
    });
    const entry = { view, instanceId };
    menuViews.add(entry);
    view.open();
    return {
      ...view,
      /** Show what a page id names (modules/settings.js maps its own ids to these): a page of the menu, a row
       *  ('row:<id>' -- its list, never a step), a tab ('tab:<id>'), or a panel's own settings ('type:<module>',
       *  the first panel of that type here). False, and nothing changes, when this screen has no such thing. */
      show(what) {
        const s = String(what || '');
        if (!s || torn) return false;
        if (s.startsWith('type:')) {
          const rec = menuPanelRecs().find((r) => r.type === s.slice(5) && r.id !== instanceId);
          if (!rec) return false;
          if (view.page()) view.closePage();
          view.setSubject(rec.id);
          view.showTab('module');
          return true;
        }
        if (s.startsWith('tab:')) {
          if (view.page()) view.closePage();
          return !!view.showTab(s.slice(4));
        }
        if (s.startsWith('row:')) return !!view.openRow(s.slice(4));
        return !!view.openPage(s);
      },
      destroy() {
        menuViews.delete(entry);
        try { view.destroy(); } catch { /* already gone */ }
      },
    };
  }

  // *** LESSON TOPICS, A PAGE OF THIS MENU (2026-10-03; moved from the Settings panel's own list). ***
  // Quest keeps lesson topics locked until they are watched; Sandbox opens everything (lessons.js MODE_KEY on the
  // screen's row, the record Trivia, Word Forge and the algebra game read). A PAGE, not a two-way row, argued: it
  // carries a paragraph saying what the two mean and that nothing unlocked is lost by switching, which a hint
  // cannot hold, and it is set rarely. AGAINST: two presses (in, choose) where a row would be one. Its list is the
  // choice picker, so a switch walks it by the page's own moves (settings.js openPage). Choosing applies at once.
  function lessonTopicsPage() {
    const owner = menuView();
    return {
      title: 'Lesson topics',
      render(el) {
        el.innerHTML = `<p class="st-hint" style="display:block;margin:0 0 10px">Quest keeps lesson topics locked
          until they’re watched. Sandbox opens everything right away. Points are earned either way, and nothing
          already unlocked is ever lost by switching.</p><div data-lesson-topics></div>`;
        const box = el.querySelector('[data-lesson-topics]');
        let pick = null;
        const draw = () => {
          try { pick?.destroy(); } catch { /* already gone */ }
          pick = mountChoicePicker(box, {
            title: null, key: MODE_KEY, value: modeFrom(settings.get() || {}),
            options: [{ value: 'sandbox', label: 'Sandbox — everything open' }, { value: 'quest', label: 'Quest — topics unlock as you go' }],
            cancelLabel: 'Back',
            onPick: (v) => {
              settings.set({ [MODE_KEY]: MODES.includes(v) ? v : 'sandbox' });
              if (box.isConnected) draw();
              refreshViews();
            },
            onCancel: () => { try { owner?.closePage?.(); } catch { /* gone */ } },
          });
        };
        draw();
        return {
          next: () => pick?.next(), prev: () => pick?.prev(), select: () => pick?.select(),
          back: () => (pick ? pick.back() : false),
          destroy: () => { try { pick?.destroy(); } catch { /* gone */ } pick = null; },
        };
      },
    };
  }
  controlsEl.querySelector('[data-act="settings"]').addEventListener('click', () => menu.toggle());
  controlsEl.querySelector('[data-act="switch"]')?.addEventListener('click', () => openSwitch());
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
      if (!p?.person_id) { whoState = false; menu.refresh(); if (!torn) personKnown.settle(null, 'none'); return; }
      personId = p.person_id;
      // The live answer (usually the same one the screen's row gave at boot, which changes nothing).
      if (!torn) personKnown.settle(p.person_id, 'found');
      // Whose voice recordings these are (they are kept per person, on this device).
      try { voiceRec?.setPersonId(p.person_id); } catch (err) { console.error('kiosk: voice recording', err); }
      if (profiles.people) {
        const who = (await profiles.people()).find((x) => x.id === p.person_id);
        // A person_id pointing at somebody who is gone is ALSO a finished answer. Named by the name on their card
        // (`profile_name`), not an "I call them" the login gave them: this screen is theirs (claims.seen_name).
        whoState = who ? { name: who.profile_name || who.name } : false;
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
        // FIRST the screen's own incoming-call notice (2026-10-02, call_notice.js): it builds the transport
        // and watches its rings, so a call to a screen with NO Call panel on it is no longer silent. Before
        // the "ready", so a panel that binds on it is already the one a ring finds (no double ring).
        if (!torn) attachCallNotice();
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
          // THE INTERCOM (row 2.44): same socket, so only somebody the server lets drive this screen
          // reaches it at all, and then only if the SERVER-STAMPED sender is on the person's approved
          // list (read at every offer, so a removal bites at once). It warns the room first, shows
          // "Intercom open: <name>" with End the whole time (NO SETTING HIDES IT), and:
          //   * a LIVE CALL makes it busy - an intercom never talks over a call (call_transport.js
          //     `isLive`; a call only ringing does not count, see there);
          //   * while one is opening or open, VOICE RECORDING IS HELD: the recogniser would hear the
          //     caller through the speaker, and a training pair of somebody else is not kept.
          try {
            intercomRx = createIntercomReceiver({
              link: drive, bus,
              config: (settings.get() || {}).call || {},
              options: () => intercomOptionsFrom(personRow || {}),
              micOwner, audio, output,
              busy: () => { try { return !!callTransport?.isLive?.(); } catch { return false; } },
              onChange: (sessions) => {
                try { voiceRec?.hold('intercom', (sessions || []).length > 0); } catch (err) { console.error('kiosk: voice recording hold', err); }
              },
            });
            intercomNote = mountIntercomNotice(kioskEl, { receiver: intercomRx, bus });
          } catch (err) { console.error('kiosk: intercom', err); }
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
      // The person's music favourites become spoken "play <name>" routes (music_favourites.js).
      watchMusic(p.person_id);
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
      // W / O: "this question is wrong / fine" while reviewing (pack_reviews.js). Inert everywhere else.
      ...REVIEW_KEY_BINDINGS,
      // Ctrl+Shift+L: lock / unlock this screen (2026-10-05, screen_lock.js). Not on an embed (nothing to lock).
      ...(screenLock ? LOCK_KEY_BINDINGS.map((b) => ({ ...b })) : []),
      // bar toggle (2026-10-06): T shows or hides the bar (row 2.72; H before, bar_toggle.js). Every screen, an embed's too.
      ...BAR_TOGGLE_KEY_BINDINGS.map((b) => ({ ...b })),
    ],
    ignore: isKioskChrome,
    // Row 2.38: an unanswered `back` goes back a dashboard when there is one to go back to (`backUnhandled`).
    onUnhandled: (info) => backUnhandled(info),
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
  // (And "Intercom: end it": a switch or a phrase bound to it ends an open intercom, one press.)
  try { runtime.actions.registerAll([...SPEECH_ACTIONS, ...NEAR_MISS_ACTIONS, ...SUBTITLE_ACTIONS, ...INTERCOM_ACTIONS]); }
  catch (err) { console.error('kiosk: speech actions', err); }
  await runtime.load();
  // The menu takes the verbs while it is open and hands them back when it closes.
  menu.attachBus(bus, runtime.router);
  // ROW 2.34: the dashboards as spoken routes from the start ("go to my room" works before anybody has
  // opened the picker). Fire and forget: a list that will not come is no reason to hold the screen up.
  if (!embedded) {
    listDashboards().then((l) => { if (!torn) applyDashboards(l || []); })
      .catch((err) => console.error('kiosk: dashboard routes', err));
  }
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
  // THE CURSOR BY COMMAND (87bcd41, wired 2026-10-02): a bound switch or "cursor left" / "click" / "scroll
  // down" moves the aim, so the cursor above draws it.
  try { cursorDrive = attachCursorDrive({ bus, aim: runtime.aim, settings: () => (settings.get() || {}).cursor || {} }); }
  catch (err) { console.error('kiosk: cursor drive', err); }
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
    // (2026-10-05, screen_lock.js) UNLOCKED BY SOMEBODY: the two rungs that take the screen away from whoever is
    // using it -- the page reload and the machine's reboot -- wait until it is locked again. Remount and swap
    // stay: they mend one panel in place. Not counted as applied, so the ladder is where it was when locked.
    if (screenLock?.staysOut() && (decision.action === 'reload' || decision.action === 'reboot')) {
      return done({ performed: false, held: 'unlocked' });
    }

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
    // A PLACED bar is held the same way (Home, 2026-09-30): in full screen it tucks itself away, and the
    // cat saying "this is the bar" must not ring empty space there either. It hears it as state.
    if (useDashboard) bus.publish(SHELL_STATE, { barHeld });
    return barHeld;
  }
  function poke() {
    controlsEl.classList.remove('hidden');
    // bar toggle: anything that pokes is somebody asking for the bar (the automatic reveals ask `autoPoke` first),
    // so the key's quiet period is over. (`barQuiet` is declared below; a poke during boot, before it is, has none.)
    controlsEl.classList.remove('k-bar-hidden');
    try { barQuiet.show(); } catch { /* not declared yet: nothing to end */ }
    try { syncHelp(); } catch { /* declared above; never a reason for the bar not to come up */ }
    try { liftCorners(); } catch { /* a panel's corner above the bar; not load-bearing */ }
    armBarHide();
  }
  // *** ROW 2.38: WHILE THE DASHBOARDS TRAY IS OPEN, THE BAR AND THE TRAY WAIT THE TRAY'S OWN TIME. ***
  // The screen's setting (`dashboardTrayMs`, dashboard_nest.js argues 15 s from the scan's response time);
  // every press on the tray pokes, so it is the gap between presses a person is given. 0 = until it is
  // closed: nothing is armed while it is open (the tray is a strip, not a scrim -- the panels keep playing).
  // Closed, the bar is back on its own 3 s.
  function armBarHide() {
    clearTimeout(hideT);
    hideT = null;
    if (barHeld) return;
    let wait = BAR_HIDE_MS;
    if (screensOpen) {
      try { wait = trayOpenMsFrom(settings.get() || {}); } catch { wait = BAR_HIDE_MS; }
      if (wait === 0) return;
    }
    hideT = setTimeout(() => {
      hideT = null;
      if (!embedded) controlsEl.classList.add('hidden');    // an embed's bar stays: see kiosk.css
      try { liftCorners(); } catch { /* the corners come back down with it; not load-bearing */ }
      // The picker goes with the bar it hangs off. This is the "what if nobody answers"
      // answer for it: left alone, it puts itself away and the screen is back to what it was
      // doing, with nothing having been decided on anybody's behalf.
      toggleScreens(false);
    }, wait);
  }

  // *** BAR TOGGLE (2026-10-06; bar_toggle.js argues the key, the two settings and why nobody is stranded). ***
  // The key shows or hides THE bar: a placed bar while it carries the bar (told as SHELL_STATE `barKeyHidden`, and it
  // tucks itself away), else this file's own. Hidden by the key, nothing brings it back BY ITSELF for the screen's
  // quiet period -- the automatic reveals (a touch, a key, the pointer near it, a switch press) ask `autoPoke` /
  // `barMayPopUp` first. Anything that asks for the bar (`poke`, the plain bar's summons, the cat) still shows it.
  // bar while playing (row 2.65; bar_toggle.js): a game is being played while a panel STILL ON THE SCREEN says it is
  // playing (PLAY_STATE_TOPIC with no slideshow / video kind -- version_watch.js reads it the same way), and no call is
  // live. Kept here, not with the version watch's copy: that one exists only off an embed, and Home is an embed.
  const barGames = new Map();          // panel id -> true while it says a game is playing
  offsScreen.push(bus.subscribe(PLAY_STATE_TOPIC, (p) => {
    if (!p || !p.id) return;
    if (p.playing && playKindOf(p) === 'game') barGames.set(p.id, true); else barGames.delete(p.id);
  }));
  function gamePlaying() {
    if (callState || barGames.size === 0) return false;
    let ids;
    try { ids = new Set(menuPanelRecs().map((r) => r.id)); } catch { return false; }
    for (const id of barGames.keys()) if (ids.has(id)) return true;
    return false;
  }
  // (row 2.65) Does a game being played FILL THE SCREEN (bar_toggle.js argues the reading): the panel on a one-at-a-time
  // stage, the only panel in the arrangement's slots (an overlay over it covers a corner, not the game), or a panel made
  // bigger to fill its dashboard or the screen. In a room's scene, or beside other panels, it shares the screen.
  function gameFillsScreen() {
    if (!gamePlaying()) return false;
    let lay = null;
    try { lay = arr.layout(); } catch { return false; }
    let ids;
    try { ids = new Set(menuPanelRecs().map((r) => r.id)); } catch { return false; }
    for (const id of barGames.keys()) {
      if (!ids.has(id)) continue;
      if (promotedScreen === id) return true;
      try { if (arr.promotedId?.() === id) return true; } catch { /* no arrangement */ }
      if (!lay) { try { if (arr.stageRec()?.id === id) return true; } catch { /* none */ } continue; }
      const slots = (Array.isArray(lay.slots) ? lay.slots : []).filter(Boolean);
      if (slots.length === 1 && slots[0] === id) return true;
    }
    return false;
  }
  const barQuiet = createBarQuiet({ settings: () => settings.get() || {}, playing: gamePlaying, fills: gameFillsScreen });
  const placedBarEl = () => (useDashboard && plainBarState === 'off' ? kioskEl.querySelector('.tb-bar') : null);
  function barShowing() {
    const placed = placedBarEl();
    if (placed) return placed.dataset.tucked !== '1';
    if (controlsEl.classList.contains('k-bar-hidden')) return false;
    // The plain bar on the dashboard path ignores `.hidden` (kiosk.css `.k-plain`: drawn while it is the bar).
    return useDashboard ? plainBarState !== 'off' : !controlsEl.classList.contains('hidden');
  }
  const barMayPopUp = () => { try { return barQuiet.mayPopUp(); } catch { return true; } };
  /** An automatic reveal: allowed while the bar is up (keeping it up) or when it may come up by itself. */
  function autoPoke() {
    if (!barShowing() && !barMayPopUp()) return false;
    poke();
    return true;
  }
  // The press that toggles must not also wake the bar first (it would then hide what it was asked to show).
  const toggleBindings = () => { try { return runtime?.input?.listBindings?.() || []; } catch { return []; } };
  const isBarToggleKey = (e) => { try { return isBarToggleControl(toggleBindings(), 'keyboard', keyControl(e)); } catch { return false; } };
  const isBarToggleEdge = (device, control) => isBarToggleControl(toggleBindings(), device, control);
  function hideBarByKey() {
    barQuiet.hide();
    clearTimeout(hideT); hideT = null;
    try { toggleScreens(false); } catch { /* the picker hangs off the bar and goes with it, as on the auto-hide */ }
    if (useDashboard) {
      plainSummoned = false; clearTimeout(plainSummonT); plainSummonT = null;
      syncPlainBar();
      bus.publish(SHELL_STATE, { [BAR_KEY_HIDDEN]: true });
    }
    // This file's own bar, unless a placed bar carries the bar -- then the plain bar is left alone, so it still comes
    // up by itself if that bar fails (the plain bar's own rule, `syncPlainBar`). Read AFTER a summoned one is let go.
    if (!placedBarEl()) controlsEl.classList.add('hidden', 'k-bar-hidden');
    try { liftCorners(); } catch { /* the corners come back down with it; not load-bearing */ }
  }
  function showBarByKey() {
    barQuiet.show();
    controlsEl.classList.remove('k-bar-hidden');
    if (useDashboard) bus.publish(SHELL_STATE, { [BAR_KEY_HIDDEN]: false });
    if (!placedBarEl()) poke();
  }
  function toggleBarByKey() {
    if (torn) return;
    if (barShowing()) hideBarByKey(); else showBarByKey();
  }
  offsScreen.push(bus.subscribe(BAR_TOGGLE_TOPIC, (p) => { try { p?.claim?.(); } catch { /* never stops the press */ } toggleBarByKey(); }));

  // NOBODY STRANDED (bar_toggle.js): while the bar is hidden and may not come up by itself, HOLDING STILL on the
  // screen for the plain bar's hold time brings it -- the touch-only person's way back. A tap is still a tap; a press
  // that moves is a drag and is let go. The ring says what is happening, as for the switch hold.
  let barHoldT = null, barRingT = null, barHoldAt = null;
  function endBarHold() {
    clearTimeout(barHoldT); clearTimeout(barRingT); barHoldT = null; barRingT = null;
    if (barHoldAt) { barHoldAt = null; try { hideRing(); } catch { /* none drawn */ } }
  }
  // bar while playing: `onControl` -- the press is on a module's own button, which does not bring the bar however it
  // may come up, so the hold is the way to it there too (a panel that is all buttons has nowhere else to tap).
  function startBarHold(e, onControl = false) {
    endBarHold();
    if (torn || barShowing() || (!onControl && barMayPopUp())) return;
    if (e && e.isPrimary === false) return;
    const ms = clampHoldMs((settings.get() || {}).plainBarHoldMs);
    barHoldAt = { x: e?.clientX ?? 0, y: e?.clientY ?? 0 };
    const ringAfter = Math.min(250, ms);
    barRingT = setTimeout(() => {
      barRingT = null;
      if (barHoldAt) showRing({ holdMs: ms, ringAfterMs: ringAfter, text: 'Keep holding for the bar' });
    }, ringAfter);
    barHoldT = setTimeout(() => {
      barHoldT = null;
      if (!barHoldAt) return;
      endBarHold();
      showBarByKey();
    }, ms);
  }
  function moveBarHold(e) {
    if (!barHoldAt) return;
    if (Math.hypot((e.clientX ?? 0) - barHoldAt.x, (e.clientY ?? 0) - barHoldAt.y) > BAR_HOLD_SLOP_PX) endBarHold();
  }
  root.addEventListener('pointermove', moveBarHold, { passive: true });
  for (const ev of ['pointerup', 'pointercancel']) root.addEventListener(ev, endBarHold, { passive: true });
  offsScreen.push(() => {
    endBarHold();
    root.removeEventListener('pointermove', moveBarHold);
    for (const ev of ['pointerup', 'pointercancel']) root.removeEventListener(ev, endBarHold);
  });

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
    if (onModuleControl(e.target)) return;   // bar while playing: resting on a module's button near it is aiming at the button
    const r = controlsEl.getBoundingClientRect();
    if (e.clientX >= r.left - BAR_REVEAL_MARGIN_PX && e.clientX <= r.right + BAR_REVEAL_MARGIN_PX
        && e.clientY >= r.top - BAR_REVEAL_MARGIN_PX) autoPoke();   // bar toggle: unless the bar is to stay away
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
  // A PRESS THAT WOKE THE BAR IS NOT ALSO A PRESS ON IT (2026-10-02, late; transport_bar.js `sitOutWakePress`
  // argues it): a tap on the calculator's "=" where the hidden bar sat was sent to the bar. The bar that was
  // hidden when this press began sits the rest of it out, so the press stays with what was under it.
  let endWakePress = () => {};
  const pokeOnPress = (e) => {
    const wasHidden = controlsEl.classList.contains('hidden');
    // bar while playing (row 2.65, measured: a touch on a Quiz mix answer tile brought the bar): a press on a module's
    // own control is aimed at it -- no bar, and its 3 s is not stretched. Held still, it brings the bar (`startBarHold`).
    if (onModuleControl(e.target)) { startBarHold(e, true); return; }
    // bar toggle: held back while the key's quiet period runs (or "only when I ask"); then a hold brings it.
    if (!autoPoke()) { startBarHold(e); return; }
    if (wasHidden && !controlsEl.classList.contains('hidden')) endWakePress = sitOutWakePress(controlsEl, e);
  };
  // bar toggle: the toggle's own key does not wake the bar on its way to toggling it.
  const pokeOnKey = (e) => { if (!isBarToggleKey(e)) autoPoke(); };
  root.addEventListener('pointerdown', pokeOnPress, { passive: true });
  root.addEventListener('keydown', pokeOnKey, { passive: true });
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
    // (A real screen -- Stage 4 -- owns the whole page, so a key with nothing focused, landing on the
    // body, is ours too; only an embed needs the key to have landed inside its box.)
    if (useDashboard && e.key === 'Escape'
        && (!embedded || (e.target instanceof Node && root.contains(e.target)))
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
    // bar toggle (2026-10-06): the screen picker moved from H to S ("your Screens"); the bar's key is an ordinary
    // binding (T since row 2.72; bar_toggle.js argues both moves). It brings the bar it hangs off with it, as H's keydown did.
    // Not with Ctrl / Alt / Meta: Ctrl+S is the browser's save, pressed by habit.
    else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.altKey && !e.metaKey) { poke(); toggleScreens(); return; }
    else if (e.key.toLowerCase() === 'c') toggleMirrorFull();
    else if (e.key.toLowerCase() === 'f') toggleFs();
    else if (e.key === '[') cycleMirrorSize(-1);
    else if (e.key === ']') cycleMirrorSize(1);
    else if (e.key === '\\') cycleMirrorCorner();
    else return;
    autoPoke();   // bar toggle: a hotkey shows the bar as any key does, unless the bar is to stay away
  };
  window.addEventListener('keydown', onKey);

  // ---- WHERE A COLD BOOT LANDS -------------------------------------------
  // `stageDefs.length` clamps a remembered position: a screen can lose modules between
  // boots, and restoring slot 4 of a two-module screen is a blank stage.
  // AFTER A RESTART (row 2.70; restart.js argues it): a chosen dashboard is opened only on a COLD start -- the launcher's
  // `?boot=1`, or the first load in this tab. The flag is taken out of the address at once, so this page's own reloads
  // (a refresh, the recovery ladder, a new version) are reloads. A new version's reload also brings back where the
  // person was (`keepPlace`, below the first mount). Never on an embed: a page holding a preview is not restarting.
  const launchSearch = launch?.search ?? (typeof location !== 'undefined' ? location.search : '');
  let launchNav = launch?.navType ?? '';
  if (launch?.navType === undefined) {
    try { launchNav = performance.getEntriesByType('navigation')[0]?.type || ''; } catch { launchNav = ''; }
  }
  const coldStart = !embedded && isColdStart({ search: launchSearch, session, navType: launchNav });
  const keepPlace = embedded || coldStart ? null : takeKeepPlace(session);
  if (!embedded) {
    markTab(session);
    if (!launch && hasBootParam(launchSearch)) {
      try { history.replaceState(history.state, '', withoutBootParam(location.href)); } catch { /* the next reload is still told apart by the tab mark */ }
    }
  }
  const plan = bootPlan({
    config: restart,
    currentProfileId: profileId,
    stageCount: arr.stageDefs().length,
    hopped: hasHopped(session),
    cold: coldStart,
    keep: !!keepPlace && keepPlace.boot === profileId,
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
    // bar toggle: summoning is asking for it -- whatever the key hid, the plain bar comes up, and the quiet period ends.
    controlsEl.classList.remove('k-bar-hidden');
    try { barQuiet.show(); } catch { /* not declared yet: nothing to end */ }
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
    // bar toggle: the screen hold says "for the bar"; the switch hold keeps its own words.
    const ringText = ringEl.querySelector('.k-ring-text');
    if (ringText) ringText.textContent = p?.text || 'Keep holding for the plain bar';
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
  // STAGE 4: A STACK OF DOCKS, not one. A screen swap mounts the new dashboard (and its menu module)
  // BEFORE the old one goes, so for a moment two menu modules each hold a dock. The menu lives in the
  // newest; when one lets go it returns to the one before (a swap that failed: back into the old
  // dashboard, still on screen) or, with none left, to the shell.
  const menuDocks = [];
  function placeMenu() {
    const el = menuDocks[menuDocks.length - 1];
    const scrim = menuHostEl.querySelector('[data-scrim]');
    if (el) {
      if (menuHostEl.parentNode !== el) el.append(menuHostEl);
      scrim?.classList.add('st-inline');
    } else {
      scrim?.classList.remove('st-inline');
      if (!torn && menuHostEl.parentNode !== kioskEl) kioskEl.append(menuHostEl);
    }
  }
  function dockMenu(el) {
    if (!el || torn) return () => {};
    menuDocks.push(el);
    placeMenu();
    return () => {
      const i = menuDocks.lastIndexOf(el);
      if (i < 0) return;
      menuDocks.splice(i, 1);
      placeMenu();
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
    // (On a real screen the picker gets the plain bar's own "what if nobody answers": it puts itself
    // away with the bar's auto-hide unless somebody keeps touching the screen. An embed's bar stays.)
    on(SHELL_HOME, () => { toggleScreens(); if (!embedded && screensOpen) poke(); });
    on(SHELL_MIRROR, () => { toggleMirrorFull(); });
    on(SHELL_HELP, () => { explainHelp(); });
    on(PLAIN_BAR_SHOW, () => { summonPlainBar(); });
    on(PLAIN_BAR_RING, (p) => { showRing(p); });
    on(PLAIN_BAR_RING_END, () => { hideRing(); });
    // Touching the plain bar keeps it up; letting it be puts a summoned one away again.
    controlsEl.addEventListener('pointerdown', () => { if (plainSummoned) summonPlainBar(); }, { passive: true });
    // THE HOST PAGE'S ACTIONS (Home): whatever said SHELL_HOST, the host's one `press` does it.
    on(SHELL_HOST, (p) => {
      if (!hostPage || typeof hostPage.press !== 'function' || !p?.act) return;
      try { hostPage.press(p.act, p); } catch (err) { console.error('kiosk: host press', err); }
    });
    // The host's state changed (a save finished, a setting cycled): the menu shows its rows' new values.
    if (hostPage && typeof hostPage.subscribe === 'function') {
      try {
        // ...and whether its own controls hold the scan now (Home's edit bar, `host.scan`: syncHostScan).
        const offHost = hostPage.subscribe(() => {
          if (torn) return;
          try { menu.refresh(); } catch { /* not up */ }
          syncHostScan();
        });
        if (typeof offHost === 'function') offsShell.push(offHost);
      } catch (err) { console.error('kiosk: host subscribe', err); }
    }
    // WHETHER THE ONE MENU IS OPEN, told to placed chrome (the gear reads "Done editing" on Home). The
    // menu opens by the gear, by M, by a switch's Menu verb, by a room's door and by the host; watching
    // its one `hidden` attribute catches every one of them without a hook in each.
    const scrimEl = menuHostEl?.querySelector('[data-scrim]');
    const MO = typeof MutationObserver !== 'undefined' ? MutationObserver : null;
    if (scrimEl && MO) {
      let was = !scrimEl.hidden;
      const mo = new MO(() => {
        const now = !scrimEl.hidden;
        if (now === was) return;
        was = now;
        bus.publish(SHELL_STATE, { menuOpen: now });
      });
      mo.observe(scrimEl, { attributes: true, attributeFilter: ['hidden'] });
      offsShell.push(() => mo.disconnect());
    }
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
  // *** THE BAR BY SWITCH (2026-10-02; transport_bar.js `createBarScan` argues the groups and the default). ***
  // `shell/bar-scan` hands THE bar (the placed one when it carries the bar, else this plain one) the switch.
  // It is one more holder of the scan, and it lets go by itself the moment any of the others takes it.
  const barScan = createBarScan({
    bus,
    barRoot: () => (useDashboard && plainBarState === 'off' ? kioskEl.querySelector('.tb-bar') : null) || controlsEl,
    mode: () => barScanModeOf((choiceRow().get?.() || {})[BAR_SCAN_KEY], chooseModeNow()),
    othersHold: () => torn || screensOpen || !!menu?.isOpen?.() || editScanHeld || hostScanHeld || libScanHeld || callScanHeld,
    pause: (on) => { try { runtime?.router?.setPaused?.(!!on); } catch { /* no router yet */ } },
    isPaused: () => { try { return runtime?.router ? !!runtime.router.isPaused() : true; } catch { return true; } },
    show: (on) => { holdBar(!!on); },
    idleMs: () => { try { return editIdleMsFrom(settings.get() || {}); } catch { return 0; } },
  });
  offsScreen.push(() => barScan.destroy());
  // "Switch module" (2026-10-02): the bar's button (both bars), a bound switch and "switch module" said
  // aloud all arrive here (shell_verbs.js SHELL_SWITCH_MODULE is the same topic). Every path.
  offsScreen.push(bus.subscribe(SWITCH_MODULE_TOPIC, (p) => { claimed(p); openSwitch(null, p); }));
  // THE AI'S place / swap (library.js LIBRARY_AI_ACTIONS): which panels are here, answered at once, and "that
  // panel becomes that module" -- through the library in its place, so the game's lock is asked as for a
  // press. A host page with its own switch (Home) is handed the request as `place`.
  offsScreen.push(bus.subscribe(PANEL_LIST_TOPIC, (p) => {
    try { p?.reply?.(menuPanelRecs().map((r) => ({ id: r.id, type: r.type, title: r.title || r.type }))); }
    catch (err) { console.error('kiosk: panel list', err); }
  }));
  offsScreen.push(bus.subscribe(PLACE_MODULE_TOPIC, (p) => {
    if (!p || typeof p.id !== 'string' || typeof p.type !== 'string' || torn) return;
    claimed(p);
    if (hostSwitch()) {
      try { hostPage.press('place', { id: p.id, type: p.type, from: p.from || 'place' }); } catch (err) { console.error('kiosk: host place', err); }
      return;
    }
    openLibraryAt(p.id, { focus: p.type, autoPlace: true }).catch((err) => console.error('kiosk: place', err));
  }));
  // 2026-10-02: Pause / Play (both bars, a bound switch), and making a panel bigger / smaller (the corner,
  // the menu's row, a bound switch, "make it bigger" / "make it smaller"). Every path.
  offsScreen.push(bus.subscribe(SHELL_PLAY_PAUSE, (p) => { claimed(p); playPauseSelected(p && p.id ? p.id : null); }));
  offsScreen.push(bus.subscribe(SHELL_PROMOTE, (p) => { claimed(p); promotePanel(p && p.id ? p.id : null); }));
  offsScreen.push(bus.subscribe(SHELL_DEMOTE, (p) => { claimed(p); demotePanel(); }));
  // A spoken or switched pause / play reached the selected panel through the router: the button follows.
  const notePause = (verb) => () => {
    // Only when the verb went to the PANEL: with the menu open when it arrived, the router held it.
    if (menuOpenAtVerb) return;
    const rec = panelSubject();
    if (!canPausePanel(rec)) return;
    if (verb === 'pause') pausedPanels.add(rec.id); else pausedPanels.delete(rec.id);
    syncPlayPause();
  };
  offsScreen.push(bus.subscribe(verbTopic('pause'), notePause('pause')));
  offsScreen.push(bus.subscribe(verbTopic('play'), notePause('play')));
  // A game says whether it is playing (game_start.js: it waits for Start, the demo, its own pause): the
  // button follows the game, not the last press.
  offsScreen.push(bus.subscribe(PLAY_STATE_TOPIC, (p) => {
    if (!p || !p.id) return;
    // `rest` (game_start.js createPlayWatch): nobody has pressed it for a while, or the sitting ended. Not paused:
    // the button stays as it was (a "Play" on a game that is not paused would do nothing).
    if (!p.playing && p.rest) return;
    if (p.playing) pausedPanels.delete(p.id); else pausedPanels.add(p.id);
    syncPlayPause();
  }));
  // A live call's controls, as the call panel reports them: the plain bar draws them, the menu offers them.
  offsScreen.push(bus.subscribe(CALL_CONTROLS_TOPIC, (s) => {
    callState = s && s.live ? { ...s } : null;
    drawPlainCallControls();
    if (callState) poke();
    try { if (menu.isOpen()) menu.refresh(); } catch { /* not up */ }
    refreshViews();
  }));
  if (!embedded) {
    offsScreen.push(bus.subscribe(SYSTEM_TOPICS.dashboards, (p) => { claimed(p); poke(); toggleScreens(true); }));
  }
  // Row 2.38: the edit view (open / close) and the map (open / close) -- see openEditView above. The map
  // is not offered on an embed: it has no other dashboards to show or go to.
  offsScreen.push(bus.subscribe(SYSTEM_TOPICS.edit, (p) => { claimed(p); toggleEditView(); }));
  if (!embedded) {
    offsScreen.push(bus.subscribe(SYSTEM_TOPICS.map, (p) => { claimed(p); if (mapWin) closeMap(); else openMap(); }));
  }
  // Row 2.37: a room's book or window opens ONE module by type (room_scene.js MODULE_TOPIC) -- claimed only
  // when this screen has it, so an unclaimed press lets the room say so instead of doing nothing.
  offsScreen.push(bus.subscribe('system/module', (p) => {
    const type = p?.module;
    if (!type || !(arr.profile()?.modules || []).some((m) => m.type === type)) return;
    claimed(p);
    Promise.resolve(showModule(type)).catch((err) => console.error('kiosk: open module', err));
  }));
  // ...and which modules this screen has, for a library's books (room_scene.js MODULE_LIST_TOPIC).
  offsScreen.push(bus.subscribe('system/module-list', (p) => {
    claimed(p);
    try { p?.reply?.((arr.profile()?.modules || []).map((m) => m.type)); } catch { /* a room's reply must not stop the screen */ }
  }));
  // A phone joined or left (phone_mic.js): an amplifier set to play "a phone" follows it.
  offsScreen.push(bus.subscribe(PHONE_MIC_TOPIC, () => {
    try { amplifier?.sourceChanged?.()?.catch?.((err) => console.error('kiosk: amplify', err)); }
    catch (err) { console.error('kiosk: amplify', err); }
    // ...and a ranked recogniser listening to "a phone when one is joined" (row 2.46, two ears).
    try { speechRec?.sourcesChanged?.(); } catch (err) { console.error('kiosk: speech ears', err); }
  }));
  // Subtitles' scroll back, from a switch bound to either action (row 2.47).
  offsScreen.push(bus.subscribe(SUBTITLES_EARLIER_TOPIC, (p) => { claimed(p); try { subtitles?.earlier(); } catch { /* none */ } }));
  offsScreen.push(bus.subscribe(SUBTITLES_LATEST_TOPIC, (p) => { claimed(p); try { subtitles?.latest(); } catch { /* none */ } }));

  // ---- LOCK THIS SCREEN (2026-10-05; screen_lock.js has Mike's ask and every argument) ---------------------------
  // The chord (or a switch bound to `system/screen-lock`) toggles it; with a PIN set, unlocking opens the PIN strip.
  // Locking puts nothing away (narrowed 2026-10-05: editing, the map and Switch module stay usable while locked) except
  // a password box somebody was typing in. The guards refuse what leaves the page; the chip says "Unlocked" while somebody
  // has unlocked it; the bus hears every change (LOCK_STATE_TOPIC), and so does a helper on this computer when the
  // launcher named one (`?lockHelper=`, loopback only: the Pi's half, in the report's plan).
  // ONE SENTENCE EVERY 10 SECONDS AT MOST (hard-coded): a refused key pressed twice, or held, says so once.
  const LOCK_SAY_EVERY_MS = 10 * 1000;
  let lockGuards = null, lockChip = null, lockReporter = null, lockSaidAt = 0;
  function toggleScreenLock() {
    if (!screenLock || torn) return;
    screenLock.toggle({ by: 'chord' })
      .then((r) => { if (r && r.reason === 'pin' && !torn) openPinStrip('unlock'); })
      .catch((err) => console.error('kiosk: lock', err));
  }
  if (screenLock) {
    ensureLockCss(document);
    const BLOCKED_WORDS = { link: 'opening another page', window: 'opening another page', file: 'opening the computer’s files',
      menu: 'the browser’s own menu', drag: 'dragging things off the screen', key: 'leaving it',
      secret: 'typing a key or password' };
    lockGuards = attachLockGuards({
      scope: root, isLocked: screenLocked,
      isFullscreen: () => { try { return !!fullscreenElement(); } catch { return false; } },
      onBlocked: (what) => {
        const t = Date.now();
        if (t - lockSaidAt < LOCK_SAY_EVERY_MS) return;
        lockSaidAt = t;
        lockRefuses(BLOCKED_WORDS[what] || 'leaving it');
      },
    });
    lockChip = mountLockChip(kioskEl);
    const helperUrl = lockHelperFrom({ storage });
    lockReporter = helperUrl ? createLockReporter({ url: helperUrl }) : null;
    // A password box somebody is in when it locks is put down (the guards refuse it from then on).
    const closeForLock = () => {
      try {
        const a = document.activeElement;
        if (a && a.matches?.('input[type="password"]') && !a.closest?.('[data-pin-strip]')) a.blur();
      } catch { /* nothing focused */ }
    };
    const syncLock = (s, boot = false) => {
      const locked = screenLocked();
      if (locked) kioskEl.dataset.screenLocked = ''; else delete kioskEl.dataset.screenLocked;
      try { lockGuards.sync(); } catch (err) { console.error('kiosk: lock guards', err); }
      if (screenLock.staysOut()) lockChip.show(`Unlocked — ${chordWords(lockControlNow())} to lock`); else lockChip.hide();
      if (!boot) {
        if (locked) closeForLock();
        try { if (menu.isOpen()) menu.refresh(); else refreshViews(); } catch { /* not up */ }
        try { if (screensOpen) drawScreens(); } catch { /* not up */ }
      }
      try { bus.publish(LOCK_STATE_TOPIC, { ...screenLock.get(), by: s?.by || 'boot' }); } catch (err) { console.error('kiosk: lock state', err); }
      lockReporter?.report(screenLock.get());
    };
    offsScreen.push(screenLock.subscribe((s) => { if (!torn) syncLock(s); }));
    offsScreen.push(bus.subscribe(SCREEN_LOCK_TOPIC, (p) => { claimed(p); toggleScreenLock(); }));
    offsScreen.push(() => {
      for (const x of [lockGuards, lockChip, lockReporter, pinStrip]) { try { x?.destroy(); } catch { /* gone */ } }
      try { screenLock.destroy(); } catch { /* gone */ }
    });
    syncLock(null, true);
  }

  // ---- PICKING UP A NEW VERSION (2026-10-04; version_watch.js has the finding and every argument) ---------
  // The bench soak found a screen one deploy behind after 41 hours: nothing reloads it. The watch polls the
  // server's version and, when it changes, reloads through the SAME seam the 09-12 watch uses (`reloadPage`:
  // `location.reload()`, which keeps this URL -- the same screen, the same dashboard, the device key in it), once
  // per version, only when `versionHold()` says nothing would be lost, preferably between two photos or videos.
  // Not on an embed: a preview on somebody else's page must never reload that page.
  // What the bus tells this screen, kept for the hold list. Each is the panel's own report, not a guess:
  const vPlaying = new Map();      // panel id -> 'game' | 'slideshow' | 'video', while it says it is playing
  const vGrammars = new Map();     // key -> { instanceId, dictation }: a question waiting, a dictation window
  let vRecording = false;          // an utterance heard and not yet saved, or a reading phrase armed
  let vRingingAt = null;           // a Call panel ringing (its CALL_INCOMING), until its CALL_ENDED
  let versionWatch = null;
  if (!embedded && versionWatchOpts !== false) {
    const vo = versionWatchOpts || {};
    const inputQuietMs = Number.isFinite(vo.inputQuietMs) ? vo.inputQuietMs : INPUT_QUIET_MS;
    offsScreen.push(bus.subscribe(PLAY_STATE_TOPIC, (p) => {
      if (!p || !p.id) return;
      if (p.playing) vPlaying.set(p.id, playKindOf(p)); else vPlaying.delete(p.id);
    }));
    offsScreen.push(bus.subscribe(CALL_INCOMING, () => { vRingingAt = Date.now(); }));
    offsScreen.push(bus.subscribe(CALL_ENDED, () => { vRingingAt = null; }));
    offsScreen.push(bus.subscribe(VOICE_RECORDING_TOPIC, (s) => {
      vRecording = !!(s && ((Number(s.pending) || 0) > 0 || s.prompt));
    }));
    offsScreen.push(bus.subscribe(SPEECH_GRAMMAR_TOPIC, (p) => {
      if (!p || typeof p !== 'object') return;
      const key = p.instanceId ? `#${p.instanceId}` : `@${p.source || ''}`;
      const words = Array.isArray(p.words) ? p.words.filter(Boolean) : [];
      if (p.open !== false && (words.length > 0 || p.dictation === true)) {
        vGrammars.set(key, { instanceId: p.instanceId || null, dictation: p.dictation === true });
      } else vGrammars.delete(key);
    }));
    // ONLY WHAT IS STILL ON THE SCREEN COUNTS. A game switched away while it was playing never says it stopped;
    // left in, it would hold every reload forever. A report with no panel id (a source-wide grammar) counts.
    const onScreenIds = () => { try { return new Set(menuPanelRecs().map((r) => r.id)); } catch { return new Set(); } };
    const playingKinds = () => {
      const ids = onScreenIds();
      return [...vPlaying].filter(([id]) => ids.has(id)).map(([, kind]) => kind);
    };
    // A ring that never said it ended (a Call panel taken off mid-ring) stops counting after the caller's own
    // give-up time (call_notice.js NOTICE_RING_MS) and a margin, not never.
    const ringing = () => vRingingAt !== null && Date.now() - vRingingAt < NOTICE_RING_MS + 30 * 1000;
    const versionHold = () => {
      if (torn) return 'gone';
      // (2026-10-05, screen_lock.js: somebody unlocked this screen to use it for something else -- stay out of it.)
      if (screenLock?.staysOut()) return 'unlocked';
      try { if (callTransport?.isLive?.() || callView || callNotice?.showing?.() || ringing()) return 'call'; } catch { return 'call'; }
      try { if ((intercomRx?.sessions?.() || []).length > 0) return 'intercom'; } catch { /* none */ }
      if (playingKinds().includes('game')) return 'game';
      try { if (menu?.isOpen?.() || screensOpen) return 'menu'; } catch { /* not built */ }
      try { if (editorNow() || mapWin || arr.editing?.()) return 'edit'; } catch { /* not built */ }
      if (libOpen) return 'library';
      if (vRecording) return 'recording';
      {
        const ids = onScreenIds();
        // (2026-10-07, game_start.js createPlayWatch) A GAME'S question waiting for a spoken answer is the game's own
        // hold: 'game' above, while somebody is playing it. Counted here as well, an answer game left open (its grammar
        // stays open while a question waits) held every reload for ever. A dictation window still holds by itself.
        const open = [...vGrammars.values()].filter((g) => (!g.instanceId || ids.has(g.instanceId))
          && (g.dictation || !g.instanceId));
        if (open.length) return 'dictation';
      }
      try { if (drive?.presence?.().drivers > 0) return 'helping'; } catch { /* no socket */ }
      if (inputQuietMs > 0) {
        try {
          const last = runtime?.recentActivity?.().slice(-1)[0];
          if (last?.at && Date.now() - last.at < inputQuietMs) return 'input';
        } catch { /* no runtime */ }
      }
      return null;
    };
    // (seasons) The same hold list decides when the date may change the look (see `seasonCalm` at the sky).
    seasonCalm = versionHold;
    const quietKindNow = () => {
      const kinds = playingKinds();
      return kinds.includes('video') ? 'video' : (kinds.includes('slideshow') ? 'slideshow' : null);
    };
    try {
      versionWatch = createVersionWatch({
        fetchVersion: vo.fetchVersion || (() => fetchSiteVersion()),
        enabled: () => !torn && pickUpVersionsOf(settings.get() || {}),
        hold: versionHold,
        quietKind: quietKindNow,
        // after a restart (row 2.70): a new version is not a restart -- the person comes back where they were.
        act: () => { if (!torn) { markKeepPlace(session, { boot: bootProfileId, id: profileId }); reloadPage(); } },
        storage: vo.storage !== undefined ? vo.storage
          : (session || (() => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; } })()),
        ...(vo.pollMs != null ? { pollMs: vo.pollMs } : {}),
        ...(vo.checkMs != null ? { checkMs: vo.checkMs } : {}),
        ...(vo.quietWaitMs != null ? { quietWaitMs: vo.quietWaitMs } : {}),
      });
      // THE QUIET MOMENTS: the next photo is asked for (photos.js publishes `photos/next` as it advances), a
      // video ends (the content director's `segment/done`).
      offsScreen.push(bus.subscribe('photos/next', () => { versionWatch?.quiet('slideshow').catch(() => {}); }));
      offsScreen.push(bus.subscribe('segment/done', () => { versionWatch?.quiet('video').catch(() => {}); }));
      offsScreen.push(() => { try { versionWatch?.destroy(); } catch { /* gone */ } });
      versionWatch.start();
    } catch (err) { console.error('kiosk: version watch', err); versionWatch = null; }
  }

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
  //
  // *** STAGE 4 (2026-10-01): THE REAL SCREEN, WHEN ITS ROW SAYS SO (`dashboardPathFor`). *** The same
  // module, and three differences from an embed, each because a real screen IS a screen:
  //   * its panels' state is the screen's own (`stateForProfile`, scoped to the dashboard's id -- a
  //     swapped-in dashboard's panels must find THEIR rows, not the boot screen's), layered by the
  //     automation exactly as `mountInstance`'s are; and it runs its links (`embedded: false`);
  //   * the boot screen's settings doc is LENT to it (`settingsHandle`), not opened twice, and the
  //     arrangement it boots with is the one this file read (`savedLayout`, a preview included), so the
  //     09-12 watch above stays the one thing that corrects it;
  //   * its transport bar docks OVER the stage's bottom edge (`over`), and the kiosk counts as full
  //     screen for it (the kiosk IS the whole screen), so it tucks itself away after its delay and
  //     comes back on a touch, a key, a switch or the pointer near it -- the bar a bedside screen has
  //     always had, rather than a permanent row taken off the panels.
  const REAL_DASHBOARD_CHROME = [
    { id: 'chrome-bar', type: 'transport_bar', dock: 'bottom', over: true },
    { id: 'chrome-menu', type: 'settings_menu', dock: 'left' },
  ];
  const chromeFor = () => (Array.isArray(dashboardChrome) ? dashboardChrome
    : embedded ? DEFAULT_DASHBOARD_CHROME : REAL_DASHBOARD_CHROME);
  // State scoped to ANY dashboard id (`stateFor` reads the current `profileId`, and a dashboard being
  // mounted for a swap is not current yet). The same handles `stateFor`/`eventsFor` make, for `pid`.
  const stateForProfile = (key, opts = {}, pid = profileId) => (makeState
    ? makeState(key, opts, pid)
    : createState({ url: profiles.stateURL(pid, key), user, cacheKey: `${user}:${pid}:${key}`, push, ...opts }));
  const eventsForProfile = (key, opts = {}, pid = profileId) => (makeEvents
    ? makeEvents(key, opts, pid)
    : createEvents({ url: profiles.eventsURL(pid, key), user, push, ...opts }));

  /** Mount ONE dashboard module for screen `id` into a fresh host beside the current one. Resolves
   *  `{ d, host }` once it is up; throws (with nothing left behind) if it would not start. `hidden`:
   *  mounted invisible, so the one on screen stays what is seen until this one has succeeded. */
  async function buildDashboard(id, record, { layout = undefined, hidden = false, startIndex = 0 } = {}) {
    const host = document.createElement('div');
    host.className = 'k-dash';
    if (hidden) { host.style.visibility = 'hidden'; host.setAttribute('aria-hidden', 'true'); }
    (dashHost || stageEl).after(host);
    let d = null;
    try {
      // (Registered as `dashboard` since row 2.34; `view` stays an alias -- modules/view.js.)
      d = mountModule('dashboard', extendCtx(childCtx({ id: `dashboard:${id}`, type: 'dashboard' }), {
        mount: host, state: null, events: null,
        // Row 2.38: the screen's OWN dashboard is the top of any nesting (depth 0), never a nested one.
        nestDepth: 0,
        viewId: id, profileId: id, arrangement: record,
        ...(layout !== undefined ? { layoutOverride: layout } : {}),
        // Row 2.38: the edit view on a real screen saves what it changes to this dashboard's row (never a
        // preview's one-shot layout, never an embed's).
        saveLayout: !embedded && !previewLayout,
        router: runtime.router, health, storage, embedded: !!embedded,
        ...(embedded ? {} : {
          makeState: stateForProfile, makeEvents: eventsForProfile,
          // 2026-10-04: a dashboard's own settings doc merges a refused write (view.js), with the same policy,
          // and a change that gave way is said on this screen's quiet line.
          conflictPrefer: CONFLICT_PREFER,
          note: (text) => sayNote(text),
          // (2026-10-02: layered by "every <module> panel" on this screen first -- `withTypeLayer`.)
          wrapState: (mid, st, type) => automation.wrapState(mid, withTypeLayer(st, type), { manifest: getManifest(type) }),
          // Row 2.62 step 4: the dashboard's room objects, registered with the same engine (room_drive.js).
          wrapTarget: (id, st, fields) => automation.wrapState(id, st, { fields }),
          ...(id === bootProfileId ? {
            settingsHandle: settings,
            // A layout the dashboard writes to this doc AND applies itself (edit mode redrawing its room):
            // the 09-12 watch notes it rather than reloading under the person editing.
            expectLayout: (l) => { expectLayoutSig = JSON.stringify(l ?? null); },
          } : {}),
          startIndex,
        }),
        // Stage 3b: what it places besides its panels, and the shell's one menu to dock.
        chrome: chromeFor(),
        shell: {
          dockMenu, helpOn: () => helpOn(storage),
          // Home (2026-09-30): the host page's actions for the placed bar, and what its words need.
          host: hostPage, menuOpen: () => !!menu.isOpen(), barHeld: () => barHeld,
          // bar toggle (2026-10-06): may the placed bar come up by itself, did the key hide it, and is this
          // press the toggle's own (so it does not wake the bar it is about to toggle).
          barMayPopUp: () => barMayPopUp(), barKeyHidden: () => { try { return barQuiet.hiddenByKey(); } catch { return false; } },
          isBarToggleKey: (e) => isBarToggleKey(e), isBarToggleEdge: (device, control) => isBarToggleEdge(device, control),
          // 2026-10-02: what the placed bar's Pause / Play and a live call's controls show at mount.
          playPause: () => playPauseState(), callControls: () => callState,
          bigger: () => biggerState(),
          fullscreenElement: () => {
            let f = null;
            try { f = fullscreenElement(); } catch { f = null; }
            return f || (embedded ? null : kioskEl);
          },
        },
      }));
      await d.init();
      if (!d.impl.arrangement?.()) throw new Error('the dashboard module did not build an arrangement');
      return { d, host };
    } catch (err) {
      try { d?.destroy(); } catch { /* already gone */ }
      host.remove();
      throw err;
    }
  }
  // What the shell hears from the dashboard that is showing (and only while it is).
  function wireDashboard(d) {
    // (Row 2.38: the dashboard's edit windows opening or closing -- by their own Close, too -- moves the scan.)
    d.impl.onChange?.(() => { if (dash === d) { renderMods(); syncPlainBar(); syncEditScan(); } });
    d.impl.onSettings?.(() => { if (dash === d) syncShownTheme(); });
  }
  // Every mounted record a dashboard holds, by id (the health watch is keyed by them).
  function dashRecIds(d) {
    const a = d?.impl?.arrangement?.();
    if (!a) return [];
    return [a.stageRec?.(), ...(a.slotRecs || []), ...(a.placedRecs || []),
      a.cameraRec?.(), a.clockRec?.(), a.ambientRec?.()].filter(Boolean).map((r) => r.id);
  }

  async function mountDashboard() {
    stageEl.style.display = 'none';
    try {
      // An embed: the arrangement it was handed (Stage 3). A real screen: the one this file read --
      // a preview's, else the doc's as it is NOW (a placement saved in the boot gap included).
      const layout = embedded ? (savedLayout || null)
        : (previewLayout || (settings.get().kiosk || {}).layout || null);
      const built = await buildDashboard(profileId, ownArr.profile(), {
        layout, startIndex: embedded ? 0 : plan.stageIndex,
      });
      dash = built.d; dashHost = built.host;
      wireDashboard(dash);
      applyLayout(settings.get());          // `.kiosk` stops carrying corners (see `applyCorners`)
      syncShownTheme();
      renderMods();
      syncPlainBar();
    } catch (err) {
      console.error('kiosk: the dashboard module failed; showing the panels directly', err);
      dash = null; dashHost = null;
      stageEl.style.display = '';
      // The HUD too (the mirror, the corner clock, the ambient layer): this file's own, as it would
      // have mounted them with no dashboard at all.
      try { await ownArr.mountOverlays(); } catch (e2) { console.error('kiosk: overlays', e2); }
      if (arr.layout()) await mountLayout(); else await showPrimary(embedded ? 0 : plan.stageIndex);
      syncPlainBar();                       // no dashboard, so the plain bar is THE bar
    }
  }

  /** STAGE 4: a screen swap on the dashboard path. LOAD AND MOUNT THE NEW DASHBOARD FIRST, invisibly,
   *  and destroy the old one ONLY once the new one is up (the plan's showScreen rule, kiosk.js's own
   *  "A FAILED SWAP MUST LEAVE HER LOOKING AT SOMETHING", now by construction): a screen record that
   *  will not load, or a dashboard that throws, leaves the old one exactly where it was -- same panels,
   *  same instances, same focus, same theme -- and returns null. The incoming dashboard reads its OWN
   *  settings doc (its arrangement, its corners, its theme), which also retires the
   *  §showscreen-inherits-layout class: there is no boot handle for it to read by mistake. */
  async function swapDashboard(nextId, { remember = true } = {}) {
    swapping = true;
    const from = profileId;
    const old = dash, oldHost = dashHost;
    const oldIds = dashRecIds(old);
    try {
      const next = makeState
        ? await profiles.get(nextId)
        : await cachedFetch(`profile:${user}:${nextId}`, () => profiles.get(nextId));
      if (!next || !Array.isArray(next.modules)) throw new Error('that screen has no modules');
      // Back to the screen this kiosk booted on: its doc is the one held open (lent again), and its
      // arrangement is the doc's as it is NOW (the 09-12 watch only noted changes while it was away).
      const built = await buildDashboard(nextId, next, {
        hidden: true,
        ...(nextId === bootProfileId ? { layout: (settings.get().kiosk || {}).layout || null } : {}),
      });
      if (torn) { try { built.d.destroy(); } catch { /* gone */ } built.host.remove(); return null; }
      // ---- it is up. Only now does anything about the screen change. ----
      if (remember) rememberSwap(from, nextId);
      nameScreen(nextId, next.name);
      profileId = nextId;
      dash = built.d; dashHost = built.host;
      wireDashboard(dash);
      built.host.style.visibility = ''; built.host.removeAttribute('aria-hidden');
      try { old?.destroy(); } catch (err) { console.error('kiosk: the old dashboard did not go quietly', err); }
      oldHost?.remove();
      // The old panels stop being watched (a destroyed panel publishes nothing, and a watch on it would
      // call it stalled); any id the new dashboard also has was just watched again by its own mount.
      const keep = new Set(dashRecIds(dash));
      for (const id of oldIds) if (!keep.has(id)) { try { health.forget(id); } catch { /* not load-bearing */ } }
      // A new dashboard's bar gets its own 2 s to mount before the plain bar steps in for it.
      clearTimeout(barGraceT); barGraceT = null; barGraceOver = false;
      applyLayout(settings.get());
      syncShownTheme();
      const f = focusedTargetNow();
      if (f) paintFocus(f.id);
      renderMods();
      syncPlainBar();
      bus.publish(SCREEN_SHOWN, { profileId: nextId, from });
      drawCrumbs();
      return nextId;
    } catch (err) {
      // *** THE OLD DASHBOARD NEVER LEFT. *** Nothing above the "it is up" line touched it.
      console.error('kiosk: could not show screen', nextId, err);
      return null;
    } finally {
      swapping = false;
    }
  }
  if (useDashboard) await mountDashboard();
  else if (arr.layout()) await mountLayout(); else await showPrimary(plan.stageIndex);
  // after a restart (row 2.70): a new version picked up while a dashboard opened from Home was showing -- back to it, in
  // place, with Home behind it on the trail. One that has gone since (or will not load) leaves Home showing.
  if (keepPlace && keepPlace.boot === bootProfileId && keepPlace.id && keepPlace.id !== profileId && !plan.redirectTo) {
    try { await showScreen(keepPlace.id); } catch (err) { console.error('kiosk: back to where it was', err); }
  }
  // The row's list of dashboards, read once now (the tray keeps it current after). Not on an embed (no other screens).
  if (!embedded && !torn && typeof profiles?.list === 'function') {
    listDashboards().then((l) => { if (l && !torn) restartScreens = l; }).catch(() => {});
  }

  // Links, once the modules exist: sync now, and again whenever the settings doc changes (links
  // written after boot are picked up without a reload, since they are not part of the layout). The
  // subscribe replays at once if settings are loaded, so the explicit sync only matters when they
  // are not; it is idempotent either way.
  // (Stage 4: a real screen's dashboard runs its OWN links, from its own doc; this file's runner is
  // only for when this file's arrangement is the one showing the panels.)
  let offLinks = null;
  if (screenLinks && !dash) {
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
    // bar toggle (2026-10-06): for a suite and a diagnostic page -- is the bar up, and the key's quiet period.
    barToggle: () => ({ showing: barShowing(), mayPopUp: barMayPopUp(), holding: !!barHoldAt, ...barQuiet.probe() }),   // (+ playing, whilePlaying: bar while playing)
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
    // Row 2.38: home (the dashboard this screen started on), the trail with names (what the breadcrumb
    // says), and the tray's state -- for the suites and a diagnostic page.
    goHomeScreen,
    trail: () => trailNow(),
    crumbsEl: () => crumbsEl,
    trayOpen: () => screensOpen,
    picker: () => picker,
    // Row 2.38, the map editor: the edit view (whichever editor is open: the dashboard's or this file's
    // own), the map window, and whether either holds the scan -- for the suites and a diagnostic page.
    editView: () => editorNow(),
    openEditView,
    closeEditView,
    mapWindow: () => mapWin,
    openMap,
    closeMap,
    editScanHeld: () => editScanHeld,
    // 2026-10-02: whether the host page's own controls (Home's edit bar) hold the scan -- for the suites.
    hostScanHeld: () => hostScanHeld,
    // 2026-10-02: the bar's own switch scan (transport_bar.js createBarScan) -- `.probe()` says where it is.
    barScan: () => barScan,
    stageCount: () => arr.stageDefs().length,
    // NOTE: `layout()` was already taken by the mirror/clock HUD positions below. A second
    // `layout:` key in this same object literal is silently shadowed by it — which is
    // exactly what happened first time. This one is the composed SLOT layout.
    slotLayout: () => (arr.layout() ? { ...arr.layout() } : null),
    // The switch lap as the arrangement has it now (`focusRing`: a panel left out of it is not here) -- for
    // the suites (2026-10-02, "In the switch scan").
    focusRing: () => { try { return focusRing().map((s) => ({ ...s })); } catch { return []; } },
    slotCount: () => arr.slotRecs.length,
    slotTypes: () => arr.slotRecs.map((r) => r.type),
    // One row per link on this screen, carrying or not, each with `ok` and (if not) a `reason`.
    // NULL means no runner exists: the screen has no links, or this is an embed. See screen_links.js.
    // (Stage 4: on a real screen's dashboard path, the SHOWING dashboard's runner.)
    linkStatus: () => { const sl = dash ? arr.screenLinks : screenLinks; return sl ? sl.status() : null; },
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
    // (Stage 4: where the corners ARE -- the showing dashboard's root on a real screen's dashboard path.)
    layout: () => {
      const d = (cornersFollowDash() && dash?.impl?.rootEl?.()) || kioskEl;
      return { mirrorSize: d.dataset.mirrorSize, mirrorCorner: d.dataset.mirrorCorner, clockCorner: d.dataset.clockCorner };
    },
    // Stage 4: which path this screen booted on (true = one dashboard module) -- for a suite, a
    // diagnostic page and the bench soak. (`dashboard()` below says whether the module is mounted.)
    dashboardPath: () => !!useDashboard,
    showPrimary,
    showModule,
    menu,
    runtime,
    // 2026-10-04: the version watch, so a suite can drive it a step at a time and a diagnostic page can say
    // which version this screen runs and what it is waiting for. Null on an embed (it has none).
    versionWatch: versionWatch ? {
      poll: () => versionWatch.poll(), check: () => versionWatch.check(),
      quiet: (kind) => versionWatch.quiet(kind), state: () => versionWatch.state(),
    } : null,
    // 2026-10-05 (screen_lock.js): the lock, its PIN strip and its guards -- for the suites and a diagnostic page.
    // Null on an embed (nothing to lock).
    screenLock: () => screenLock,
    pinStrip: () => pinStrip,
    lockGuards: () => lockGuards,
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
    // 2026-10-02: the cursor by command, the effects chain (null until something asked for it), the
    // menu's Switch list (which panel it is open for, or null) and the switch itself.
    cursorDrive: () => cursorDrive,
    // (The Switch list is the Modules library in the panel's place now: `switchOpen` says which panel it
    // stands in for; `library()` is its state, for a suite; `openLibrary` is the way a host page -- Home --
    // opens it with its own pick: `kiosk.openLibrary(id, { onPick(item), onCancel(why), focus, autoPlace })`.)
    switchOpen: () => (libOpen ? { id: libOpen.id, library: true } : null),
    // 2026-10-02, for the suites: what is selected (a panel, or a piece of the room: arrangement.js
    // `focusedTarget`), the lock list being honoured now and the lock notice while it shows (else null).
    focusedTarget: () => focusedTargetNow(),
    lockedIds: () => [...lockedIdsNow()],
    lockNote: () => (lockNoteEl && !lockNoteEl.hidden ? lockNoteEl.textContent : null),
    // 2026-10-04, for the suites: the same quiet line by its general name (`sayNote`), and the swapped-in
    // screen's doc while it shows (null on the boot screen).
    note: () => (lockNoteEl && !lockNoteEl.hidden ? lockNoteEl.textContent : null),
    // ...and the way a host page says something on it (2026-10-04, later: Home's edit bar, when a change made there
    // gave way to another device's -- modules.html `tellLost`). Same line, same timing rule.
    say: (text) => (typeof text === 'string' && text ? sayNote(text) : null),
    swapDoc: () => swapDocNow(),
    // ...and the store the showing arrangement saves its room to (`ownLayoutStore`, or the dashboard's own,
    // view.js), so a suite can save with a base the doc has moved on from, in a fixed order.
    layoutStore: () => (dash?.impl?.layoutStore?.() || ownLayoutStore),
    openSwitch: (id) => openSwitch(id),
    switchPanel: (id, type) => doSwitch(id, type),
    openLibrary: (id, opts = {}) => openLibraryAt(id, opts || {}),
    closeLibrary: () => closeLibrary('keep'),
    library: () => (libOpen ? { id: libOpen.id, slot: libOpen.slot, probe: libOpen.inst?.impl?.__probe?.() || null } : null),
    libraryUsage: () => libraryUsage(),
    // 2026-10-02, for the suites and a diagnostic page: Pause / Play (the selected panel's state, and the
    // press), making a panel bigger / smaller (and where it is: 'screen', the id filling its dashboard, or
    // null), a live call's controls as the bar draws them, the levels this screen has, their rows, the
    // device level's row and the Layout list's pick.
    playPause: () => playPauseState(),
    pressPlayPause: (id) => playPauseSelected(id || null),
    promote: (id) => promotePanel(id || null),
    demote: () => demotePanel(),
    promoted: () => ({ screen: promotedScreen, dashboard: arr.promotedId?.() || null }),
    callControls: () => (callState ? { ...callState } : null),
    levels: () => levelsHere(),
    levelLayers: () => levelLayers(),
    deviceRow: () => deviceRow,
    typeDefaults: (type) => ({ ...(typeDefaults(type) || {}) }),
    shownTheme: () => shownTheme(),
    pickLayout: (id) => applyLayoutPreset(id),
    // Every panel on the screen as { id, type, title, stateKey } (what the menu's "Settings for" steps through).
    panels: () => menuPanelRecs().map((r) => ({ id: r.id, type: r.type, title: r.title, stateKey: r.stateKey || null })),
    // 2026-10-03, for the suites: each Settings panel's view of this menu ({ instanceId, view }: the view is the
    // same `mountSettings` handle as `menu`, drawn as a panel).
    settingsViews: () => [...menuViews].map((e) => ({ instanceId: e.instanceId, view: e.view })),
    // 2026-10-07 (the Modules page, library.html): the same menu-as-a-panel a Settings panel on this screen gets
    // (`ctx.settingsMenu`), for a Settings panel the hosting PAGE draws beside the kiosk. Same views, same sync.
    settingsMenu: (host, opts = {}) => menuReady.then(() => settingsMenuFor(host, opts || {})),
    effects: () => fxReal,
    soundScene: () => soundScene,
    listening: () => listening,
    // The voice (2026-09-30, second pass), for a test and a diagnostic page: the speech handle (null
    // unless a recogniser is running), why it is or is not listening, the miss store (null unless on),
    // subtitles, amplify, and the phone-microphone receiver and its notice (null until the drive).
    speech: () => speech,
    speechRecognizer: () => speechRec,
    // The person's music favourites watch (null with no person), and the spoken routes made from it.
    musicFavourites: () => musicFavs,
    musicRoutes: () => ({ ...musicRoutes }),
    // Row 2.34, for a suite and a diagnostic page: the dashboards' spoken routes, the picker (open?, its
    // stops, where its cursor is), and the ready-made maker (null where screens cannot be made).
    dashboardRoutes: () => ({ ...dashRoutes }),
    dashboardPicker: () => ({ open: screensOpen, items: picker.items(), cursor: picker.cursor(),
      making: pickerMaking, note: pickerNote }),
    dashboardMaker: () => dashboardMaker(),
    goToPrebuilt: (key) => goToPrebuilt(key),
    onlineCaptioner: () => onlineCap,
    speechStatus: () => speechStatus,
    misses: () => missStore,
    subtitles: () => subtitles,
    amplifier: () => amplifier,
    automation: () => automation,
    phoneMic: () => phoneRx,
    micPill: () => micPill,
    // Row 2.44 (wired 2026-09-30): the voice recorder (always built, off unless the person's row says),
    // its store and notice, and the intercom's room half and notice (null until the drive socket).
    voiceRecording: () => voiceRec,
    voiceStore: () => voiceStore,
    recordingPill: () => recPill,
    intercom: () => intercomRx,
    intercomNotice: () => intercomNote,
    // The call transport (built when the drive socket attaches; the intercom's busy check reads it).
    callTransport: () => callTransport,
    // 2026-10-02 (call_notice.js), for the suites: the incoming-call notice (null until the drive socket),
    // the call it answered while that is hosted over the panels (else null), and whether either has the scan.
    callNotice: () => callNotice,
    callView: () => (callView ? { el: callView.box, lit: callView.lit, controls: callView.inst?.impl?.controls?.() || null } : null),
    callScanHeld: () => callScanHeld,
    // The screen's flash limit as everything on it reads it, and the who page's avatar cache (null
    // until that page is first drawn).
    flashLimit: () => flashLimitNow(),
    avatars: () => avatars,
    // Nimrod on the bar: explain what is picked, as the bar's button does.
    help: () => explainHelp(),
    // This screen's bus, for something ABOVE the modules that answers verbs on it -- Home's walkthrough
    // (Nimrod the cat hears `nimrod-cat/next|prev|skip` here, so a switch bound to them drives him).
    bus: () => bus,
    // Whose screen this is, and whether that is settled yet (person_known.js) -- for a suite, and for
    // anything above the panels that needs the same answer they get.
    personKnown: () => personKnown,
    destroy() {
      torn = true;                 // before anything else — see the flag's declaration
      try { deviceSettle?.cancel(); } catch { /* already done */ }   // "Best for this device": its one measurement
      try { personKnown.destroy(); } catch { /* already gone */ }   // its timer, and its listeners
      // The Settings panels' views of the menu go with the panels (their `destroy`); any left are let go here.
      for (const e of [...menuViews]) { try { e.view.destroy(); } catch { /* already gone */ } }
      menuViews.clear();
      // The Modules library, if it stands in a panel's place: its row and its game handle let go.
      try { closeLibrary('gone'); } catch { /* already gone */ }
      // A swapped-in screen's settings doc (kept open while it showed), and the lock notice's timer.
      closeSwapDoc(swapDoc);
      swapDoc = null;
      clearTimeout(lockNoteT);
      clearTimeout(plainSummonT); clearTimeout(barGraceT);
      try { longPress?.destroy(); } catch { /* already gone */ }
      offsShell.forEach((off) => { try { off(); } catch { /* already gone */ } });
      ringEl?.remove();
      window.removeEventListener('keydown', onKey);
      // 2026-10-02: Escape-to-smaller, full screen left, and the device level's listener.
      window.removeEventListener('keydown', onEscDemote, true);
      root.removeEventListener('click', onClickForCorners, true);
      root.removeEventListener('pointerdown', onPressKind, true);
      root.removeEventListener('pointerover', onPointerOverForCorners, true);
      controlsEl.removeEventListener('transitionend', onBarFaded);
      clearTimeout(cornersT);
      try { document.removeEventListener('fullscreenchange', onFsChange); } catch { /* no document */ }
      try { offDeviceRow?.(); } catch { /* already gone */ }
      try { skyFollow?.stop(); } catch { /* already gone */ }   // seasons and the sky (sky.js): its minute timer
      for (const off of offVerbSnap) { try { off?.(); } catch { /* already gone */ } }
      root.removeEventListener('mousemove', pokeIfNearBar);
      // The pointerdown/keydown pair were never detached here even before today - a real,
      // separate leak, fixed alongside this one since it is the exact same class of bug.
      root.removeEventListener('pointerdown', pokeOnPress);
      root.removeEventListener('keydown', pokeOnKey);   // bar toggle: was `poke`
      try { endWakePress(); } catch { /* none under way */ }
      clearTimeout(hideT);
      barHeld = false;
      // The burn-in trio was never detached, and its timer never cleared. Invisible on a page that
      // mounts one kiosk for its whole life; an embed mounts and destroys into the SAME root every
      // time somebody picks another module, so each cycle stacked three more listeners on it.
      for (const ev of BURN_IN_EVENTS) root.removeEventListener(ev, pokeBurnIn);
      clearBurnIn();
      clearInterval(recoveryTimer);
      health.destroy();
      try { automation.destroy(); } catch { /* already gone */ }
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
      try { crumbs?.destroy(); crumbsEl?.remove(); } catch { /* already gone */ }   // row 2.38
      // The recogniser first: no microphone left open, no miss-log schedule left pruning.
      onVoiceChange = null;
      stopSpeech();
      try { enrolPanel?.close(); } catch { /* already gone */ } enrolPanel = null; enrolment = null;
      // A call hosted over the panels hangs up (its module tells the far end), and the notice goes.
      try { closeCallView('gone'); } catch { /* already gone */ }
      try { callNotice?.destroy(); } catch { /* already gone */ } callNotice = null;
      // Before the socket, so the far end is told rather than left watching a frozen frame.
      try { callTransport?.destroy(); } catch { /* already gone */ } callTransport = null;
      // A phone joined as a microphone is told the screen has gone (before the socket closes).
      try { phoneRx?.destroy(); } catch { /* already gone */ } phoneRx = null;
      try { micPill?.destroy(); } catch { /* already gone */ } micPill = null;
      // An open intercom is ended and its phone told (before the socket closes), and its notice goes.
      try { intercomRx?.destroy(); } catch { /* already gone */ } intercomRx = null;
      try { intercomNote?.destroy(); } catch { /* already gone */ } intercomNote = null;
      // Voice recording: detached already (stopSpeech, above); its notice goes and its store closes.
      try { voiceRec?.destroy(); } catch { /* already gone */ } voiceRec = null;
      try { recPill?.destroy(); } catch { /* already gone */ } recPill = null;
      try { voiceStore?.close?.(); } catch { /* already gone */ } voiceStore = null;
      // The who page's avatars: its subscription, and one state handle per person it read.
      offWhoAvatars();
      try { avatars?.destroy(); } catch { /* already gone */ } avatars = null;
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
      // Hide = mute: its open question card, and the choices row it remembers answers in.
      try { hideSound?.destroy(); } catch { /* already gone */ }
      try { choicesState?.destroy?.(); } catch { /* already gone */ }
      try { barHelp.destroy(); } catch { /* already gone */ }
      // Silences anything mid-sentence as well as clearing the queue. A screen that is being
      // torn down must not keep talking.
      try { output?.destroy(); } catch { /* already gone */ }
      // After the output bus (whose speech channel it taps): clears its lines and any room it reserved.
      try { subtitles?.destroy(); } catch { /* already gone */ } subtitles = null;
      // The music favourites' watch (its poll) and the actions it registered.
      try { offMusicActions?.(); } catch { /* already gone */ } offMusicActions = null;
      // ...and the dashboards' spoken actions, and the picker's own listener (row 2.34).
      try { offDashActions?.(); } catch { /* already gone */ } offDashActions = null;
      try { picker.destroy(); } catch { /* already gone */ }
      try { musicFavs?.destroy(); } catch { /* already gone */ } musicFavs = null;
      try { usualStart?.destroy(); } catch { /* already gone */ } usualStart = null;   // the usual starting level's row
      try { audio?.destroy(); } catch { /* already gone */ }
      try { cameraOwner?.destroy(); } catch { /* already gone */ }
      try { cursor?.destroy(); } catch { /* already gone */ }
      try { cursorDrive?.destroy?.(); } catch { /* already gone */ } cursorDrive = null;
      try { markerTracker?.destroy(); } catch { /* already gone */ }
      try { micOwner.destroy(); } catch { /* already gone */ }
      try { markerState?.destroy?.(); } catch { /* already gone */ }
      try { deviceState?.destroy?.(); } catch { /* already gone */ }
      try { historyHost.destroy(); } catch { /* already gone */ }
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
