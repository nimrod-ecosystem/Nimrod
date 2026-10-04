// suite_list.js - WHICH dev/*_test.html SUITES `run_all.html` RUNS, WHICH IT DOES NOT AND WHY,
// AND THE CHECK THAT KEEPS THE TWO HONEST.
//
// *** WHY THIS FILE EXISTS: THE HAND LIST DRIFTED BY 45 SUITES AND NOTHING NOTICED. ***
//
// `run_all.html` used to carry its own `const SUITES = [...]`. On 2026-09-30 it named 103 suites
// while 148 `*_test.html` files sat on disk - `auth`, `bus`, `keyboard`, `points`, `word_games`
// and forty more had never once run on that page. None had been left out on purpose (`git log -G`
// over the page's history shows every one of the 45 was simply never added). The page even said
// so in prose ("hand-kept and is missing suites"), and prose is not a check.
//
// So the list lives here, beside the reasons for everything NOT on it, and `suiteListProblems()`
// fails whenever a suite exists that is in neither, a name is in both, or a listed name has no
// file. `run_all.html` runs that check before it runs anything, and `suite_list_test.html` runs it
// as an ordinary suite - so `run_suite.py` and CI (which walks `dev/*_test.html`) catch it too.
//
// ADDING A SUITE: put its name in SUITES. If it genuinely cannot run on that page, put it in
// EXCLUDED with a one-line reason instead - "needs X that is not normally running", not "flaky".

// Every *_test.html in this folder that `run_all.html` runs.
export const SUITES = [
  'adulting', 'aim', 'cursor_drive', 'algebra', 'calc', 'calculator', 'calculator_link', 'link_runner', 'ports', 'bank', 'board', 'board_editor', 'camera', 'clock', 'clock_hud_contrast', 'comet', 'layers', 'packs', 'pack_reviews', 'composer', 'connections', 'controls_view', 'demo_strip',
  'composer_reach', 'device_pick', 'director', 'drive',
  'educational', 'events', 'fs_sink', 'health', 'home', 'input', 'input_runtime', 'inputs', 'interstitials',
  'input_dwell', 'input_scan', 'longpress',
  'kiosk', 'arrangement', 'placement', 'dashboard_stage4', 'dashboards', 'dashboard_nest', 'edit_mode', 'map_editor', 'lessons', 'live_settings', 'local_store', 'media', 'media_sources', 'media_stall',
  'marker', 'mic_owner', 'modules_catalog', 'output',
  'output_panel',
  'output_remote', 'pair', 'pairing', 'panel_fit', 'panel_gap', 'people', 'personal', 'photos', 'pond',
  'audio_bus', 'automation', 'call', 'call_transport', 'camera_owner', 'view', 'game_music', 'music', 'pressgame', 'records', 'rules',
  // FIRST-ISH ON PURPOSE would be better still, but the list is alphabetical-ish and this is
  // close enough: `imports` proves every client module PARSES, and it is the check that tells
  // you which file is broken when half this page reports `no summary`. A module that will not
  // parse takes down every suite that imports it and names none of them.
  'imports',
  // Does every module fit the box it is given, and re-fit when the box changes? (G6)
  'fit',
  // Is every panel on a screen reachable from the transport bar? (G9) Mounts real kiosks.
  'transport',
  'press_overlay', 'preview', 'progress', 'record_panel', 'recorder', 'qr', 'quests', 'recovery', 'resilience',
  'restart', 'rng', 'screen_pair', 'segment_heartbeat', 'sender', 'settings', 'settings_audit',
  // 2026-10-02: the one picture picker (recent, add from this device, a folder's thumbnails).
  'picture_picker',
  // 2026-10-02: a long choice (themes, fonts, scenes) opens a list; a short one, or a person stepping, steps.
  'choice_picker',
  // R6: mounts and destroys every module six times and reports what does not come back. 23s here.
  'soak',
  // PRIORITY.md #8's voice-command set. Opens no microphone: the matcher is a pure function
  // over text and the recogniser is injected, which is the same seam that lets a local engine
  // replace the browser's one.
  'speech',
  // Row 2.28 follow-ups: the miss log, the listening cue/tone/duck, and the master volume.
  'speech_misses', 'listening_cue', 'master_volume',
  // Rows 2.46/2.47: ranked recognisers and two ears, against fake sockets (plus the real capture path
  // on the browser's fake microphone). Needs no speech service running.
  'speech_engines',
  'sprint',
  'statemachine', 'talk', 'theme', 'tour', 'trivia', 'voice', 'walkthrough', 'wallpaper', 'watchdog', 'wordforge', 'youtube',
  'youtube_watchdog',
  // 2026-10-04: a screen picks up a deploy by itself, once, at a quiet moment; pages show a chip instead.
  'version_watch',
  // *** ADDED 2026-09-30, WHEN THE LIST CHECK FIRST RAN: all of these were on disk and had never
  // been on this page. Each was run on its own from `run_suite.py` before being added. Grouped by
  // what they cover rather than slotted into the lines above, so the provenance stays readable. ***
  // Infrastructure: sign-in, the bus, server push, and the two polling back-offs.
  'auth', 'bus', 'push', 'poll_backoff', 'state_events_backoff',
  // 2026-10-04: two clients on one settings doc -- a refused write is merged, never laid over the other's.
  'doc_merge',
  // Input devices and the press primitives every control is built from.
  'keyboard', 'input_pointer', 'input_facegesture', 'button', 'pressable', 'choice_card', 'hide_sound', 'user_folders', 'color_picker',
  // Modules as things: the module contract, try-before-add, prefabs, presets, the editor windows,
  // and data links with the wire transforms and tempo values that ride on them.
  'module', 'module_try', 'prefab', 'presets', 'starting_defaults', 'settings_module', 'edit_windows', 'links', 'conditioning', 'tempo',
  // Content packs, AAC data and a hosted photo source.
  'pack_library', 'pack_loader', 'user_packs', 'aac_sets', 'board_symbols', 'learn_cma_source',
  // Games, scoring and the reward side.
  'game', 'game_teardown', 'points', 'scoreboard', 'contests', 'word_games', 'transcript_quiz', 'reading_log',
  // Row 2.45: the shared miss-flow engine and the games on it, and the sing-along frame.
  'quiz_flow', 'rating', 'think_games', 'word_builder', 'brain_games', 'spelling', 'simple_math', 'name_that', 'karaoke',
  // Row 2.37: Klondike on one switch, and a note from someone.
  'solitaire', 'note', 'note_visit', 'weather', 'brickbreaker', 'rhythm', 'avatar', 'avatar_display', 'svg_sanitize',
  // 2026-10-02 late: games wait for Start (autostart a setting), the computer's demo and its players, card sort.
  'game_start', 'card_sort',
  // 2026-10-02: "person known" -- panels that read the person once at mount end up with the person on a slow boot.
  'person_known',
  // The room, the cat, ambient motion and sound.
  'room', 'room_scene', 'scene_motion', 'room_notify', 'cat_guide', 'cat_help', 'comet_ambient', 'ambient_drift', 'mixer',
  // Row 2.37, second pass: the window's weather, the library, petting, close-ups, zoom on focus.
  'room_objects',
  // 2026-10-02: the 3D room (CSS 3D transforms): its walls, modules on them, the drift and its guards.
  'room3d',
  // 2026-10-02: a 3D room flattened to a 2D room (doors and screens still live), and two levels of detail.
  'room_flat',
  // 2026-10-02: furniture built from Nimrod bricks, drawn in the rooms (its picture), and the bricks page.
  'brick_builds', 'bricks_page',
  // The QR encoder checked against a reference decoder.
  'qr_oracle',
  // Arrived on disk WHILE this list was being fixed (other work in flight the same day), and the
  // new check flagged both within minutes - which is the check doing its job. Both pass on their own.
  'amplify', 'subtitles', 'phone_mic',
  // Row 2.44: the phone that is the microphone shows a module (the clock) under a bar nothing covers.
  'phone_mic_show',
  // Row 2.44: voice recording for training, and the two-way phone intercom limited to an approved list.
  'voice_recording', 'intercom',
  // 2026-10-02: a speech model trained on one person's own voice (Euphonia): the page, reading phrases, the export.
  'voice_model',
  // 2026-10-04: the Voice model module - the six steps one at a time, worked out from evidence; export to Recordings;
  // the "is it answering?" probe; its settings; the AI set in the catalog and the library.
  'voice_model_guide',
  // 2026-10-02: the caller page - a family member calls a screen (call.html), gated on the drive grant.
  'call_page',
  // 2026-10-02: a call to a screen with no Call panel - a notice (Decline / Answer), and the call it answers
  // hosted over the panels. Mounts real kiosks and real sockets (needs the server).
  'call_notice',
  // Rows 2.29 / 2.30: Home is the modules page (save, save as, history, the first sign-in).
  'home_dashboard', 'home_page',
  // 2026-10-02: Home is your profile (started from an example, made your own; the edit bar, hot swap).
  'home_profile',
  // 2026-10-02: Home on a phone (375 and 320 wide; untouched at 1280 and 1920).
  'home_phone',
  'nimrod_guide', 'whats_new',
  // 2026-10-02: the Nimrod Game - game / learning / sandbox, unlocks gating Add, the tour's points.
  'unlocks',
  // 2026-10-02: the Nimrod guide as the AI module (talk to your own AI; actions only on a press; notes).
  'nimrod_ai',
  // 2026-10-04: "Try it as someone new" - a test person, fresh; Start over; Back to me; notes kept; Home in a frame.
  'try_new',
  // 2026-10-04: "Your people" - the landing as a very simple profile page; Nimrod at the bottom; the screen variant.
  'people_page',
  // 2026-10-04: "Edit my page" - Your people as sections you add, remove and move; About me and boxes from the library.
  'page_sections',
  // 2026-10-04: invite someone to take over a profile you made (the invite window, join.html, both sides' cards).
  'claim',
  // 2026-10-04: recommend a YouTube or Spotify song or video to one of your people; "Recommended for you".
  'recommend',
  // 2026-10-04: Home follows the person picked on the people bar (their screen, theme, Home; one made if none).
  'home_person',
  // 2026-10-02: AI characters as profiles (seeds, a person's own, rooms as dashboards) and the profile card.
  'ai_characters', 'profile',
  // 2026-10-02: "Modules", the library of everything addable (categories, sort, filter, the game's locks,
  // the AI's place / swap); transport_test drives it in a panel's place in a real kiosk.
  'library',
  // 2026-10-02: settings at every level, Pause / Play on the bar, a panel made bigger, a call's controls,
  // more layouts. Mounts real kiosks (needs the server).
  'screen_controls',
  // 2026-10-03: "Over the dashboard" -- any module as a small floating panel, the small corner clock as a setting,
  // and the "Photos with a clock" example measured at 1280x720 and 1920x1080. Mounts real kiosks (needs the server).
  'overlay',
  // This list's own check, as a suite - so `run_suite.py` and CI catch drift too.
  'suite_list',
];

// Suites that exist on disk and are deliberately NOT run by `run_all.html`, each with the reason.
// Empty is a fine state for this to be in - it means everything runs.
//
// `ai` and `wikipedia` both PASS; they are here only because of time. Their live sections call the
// local model on 127.0.0.1:11434 whenever it answers, and on this desktop (CPU, qwen2.5:7b,
// measured 2026-09-30) that took 240s and 152s run ALONE - past this page's 180s budget, or near
// it with three neighbours sharing the model - so they would sit amber as `no summary` every run.
// With no model server they self-skip the live part and finish in seconds. The way back is for
// each to declare `data-timeout-ms` on its `#summary` (see `budgetFor` in run_all.html) and move
// to SUITES. Meanwhile: `SUITE_WAIT=600 python web/tools/run_suite.py ai wikipedia`.
export const EXCLUDED = {
  ai: 'live section runs the local model: 240s alone here, over the 180s budget - run it with run_suite.py',
  wikipedia: 'live section runs the local model + real Wikipedia: 152s alone, over budget in a batch - run it with run_suite.py',
};

const SUFFIX = '_test.html';

// `files` is what `/api/dev/test-pages` returns: bare file names from `dev/`. Returns a list of
// problems, each `{ kind, name, text }`; an empty list means the lists and the disk agree.
export function suiteListProblems(files, suites = SUITES, excluded = EXCLUDED) {
  const onDisk = new Set(files.filter((f) => f.endsWith(SUFFIX)).map((f) => f.slice(0, -SUFFIX.length)));
  const listed = new Set(suites);
  const problems = [];
  const add = (kind, name, text) => problems.push({ kind, name, text });

  const seen = new Set();
  for (const n of suites) {
    if (seen.has(n)) add('duplicate', n, `'${n}' is in SUITES twice`);
    seen.add(n);
  }
  for (const n of onDisk) {
    if (!listed.has(n) && !(n in excluded)) {
      add('unlisted', n, `dev/${n}${SUFFIX} exists but is in neither SUITES nor EXCLUDED`);
    }
  }
  for (const n of Object.keys(excluded)) {
    if (listed.has(n)) add('both', n, `'${n}' is in SUITES and in EXCLUDED - pick one`);
    if (!String(excluded[n] || '').trim()) add('no-reason', n, `'${n}' is EXCLUDED with no reason`);
  }
  for (const n of new Set([...suites, ...Object.keys(excluded)])) {
    if (!onDisk.has(n)) add('no-file', n, `'${n}' is listed but dev/${n}${SUFFIX} does not exist`);
  }
  return problems;
}

// The file list, or null when the server cannot give one (a static server, an older build). A
// caller must treat null as "could not check", never as "nothing wrong".
export async function fetchTestPages() {
  try {
    const r = await fetch('/api/dev/test-pages');
    if (!r.ok) return null;
    const files = await r.json();
    return Array.isArray(files) && files.length ? files : null;
  } catch {
    return null;
  }
}
