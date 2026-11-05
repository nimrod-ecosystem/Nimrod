// setting_kits.js - THE SHARED SETTINGS A MODULE CAN TAKE, IN ONE LIST (Mike, 2026-11-05, row 2.210).
//
// Mike: every setting could be a module, so people building their own modules can give them any setting. Most of that already
// exists: dozens of groups of rows are written once and added by every module that wants them (music, starting by itself, the
// wait after an answer...). What did not exist is a list of them. This is that list - the one the module editor (port step 9)
// will offer as "Add the Music settings" - and its suite checks every group still passes the settings audit, so a group that
// breaks is caught here rather than in whichever module happens to use it (proposal_cast_more_settings_20261105, EZ 3; gate GO).
//
// Each kit: `{ id, title, what, rows() }`. `rows()` is ASYNC and loads the kit's own file only when asked, so opening the list
// never pulls in every module's code. The rows are the kit's defaults (each factory called with no arguments); a module that
// adds a kit may still pass its own options, as it does today.
//
// NOT HERE YET: "Listening while it is open" (EY 2, the wake-free setting) - it waits for Mike's yes on its default.

export const SETTING_KITS = Object.freeze([
  { id: 'music', title: 'Music', what: 'Music while it is played: whose, which album, how loud.',
    rows: async () => (await import('./game_music_host.js')).gameMusicFields() },
  { id: 'autostart', title: 'Starting by itself', what: 'Whether it starts on its own when it is shown.',
    rows: async () => (await import('./game_start.js')).autostartFields() },
  { id: 'attract', title: 'While nobody is playing', what: 'What it shows (and whether it makes a sound) between turns.',
    rows: async () => (await import('./game_start.js')).attractFields() },
  { id: 'advance', title: 'After an answer', what: 'Going on by itself once it has been read, or waiting for Next; the pause; the reading pace.',
    rows: async () => [...(await import('./quiz_flow.js')).AFTER_ANSWER_FIELDS] },
  { id: 'answer-by', title: 'How a switch answers', what: 'Stepping through the answers, or yes / no questions.',
    rows: async () => [(await import('./quiz_flow.js')).answerByField()] },
  { id: 'answer-source', title: 'Where an answer came from', what: 'Showing the source of an answer, and why it is right.',
    rows: async () => { const m = await import('./answer_source.js'); return [m.answerSourceField(), m.answerExplainField()]; } },
  { id: 'album', title: 'Album', what: 'Which album of pictures or music it uses.',
    rows: async () => [(await import('./media_sources.js')).albumField()] },
  { id: 'subfolders', title: 'Folders inside', what: 'Whether the folders inside the chosen one are included.',
    rows: async () => [(await import('./media_sources.js')).subfoldersField()] },
  { id: 'stall', title: 'When playing gets stuck', what: 'Trying again, saying so, or moving on when a video or sound stops by itself.',
    rows: async () => (await import('./playback_stall.js')).stallFields() },
  { id: 'cards', title: 'Cards', what: 'How a card game deals and shows its cards.',
    rows: async () => (await import('./card_deck.js')).cardSettingsFields() },
]);

export const settingKit = (id) => SETTING_KITS.find((k) => k.id === id) || null;
