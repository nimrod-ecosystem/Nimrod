// modules/board.js — THE COMMUNICATION BOARD. The smallest real AAC surface in either repo.
//
// The vocabulary and every rule about position live in `aac_vocab.js`; the scan loop lives in
// `input_scan.js`; the symbols are `aac_symbols.js`. This file is the part that puts them on a
// screen and lets somebody speak with them.
//
// ---------------------------------------------------------------------------------------
// *** IT SAYS THINGS IN THE ROOM. IT DOES NOT SUMMON ANYBODY. ***
// ---------------------------------------------------------------------------------------
//
// `PRINCIPLES.md` §2 carries, as a candidate absolute still awaiting Mike, the boundary
// statement that Nimrod is not a medical device, not a nurse call system, not for emergencies —
// and that **a board must never be the thing someone uses to summon help.**
//
// This file is where somebody would be tempted, so the temptation is named. A `Help` card and a
// `Pain` card are right there, the output bus now has a working `remote` channel, and wiring
// them together is two lines. Do not. It would turn a talking aid into a piece of safety
// equipment that nobody has tested, certified, or agreed to answer — and the failure mode is
// not "the feature does not work", it is somebody in a bed believing a button reached a nurse.
//
// Structurally, that is why selections go out as **`say`** and never as `notify` or `alert`.
// `say` routes to speech (DEFAULT_ROUTING in `output.js`) and stays in the room. `notify`
// reaches `remote`, which is another device in the house. The verb is the boundary.
//
// ---------------------------------------------------------------------------------------
// IT MEASURES, AND IT SHOWS THE PERSON NOTHING ABOUT IT
// ---------------------------------------------------------------------------------------
//
// Selections are appended to an event stream, because that is how anybody ever finds out
// whether a board is working — which words get used, which never do, whether a tier change
// helped. `PRINCIPLES.md` §4 retires the claim that the board *"doesn't measure at all"* as
// simply wrong: it measures plenty, and the question was only ever what gets shown to whom.
//
// So nothing on this screen tells the person how long they took, how many laps went by, or how
// they are doing. Mike, correcting a rule that had been written too broadly:
//
//   > *"a person shouldn't feel judged about how long it takes them to make a selection on an
//   > AAC board in regular use."*
//
// The distinction that does the work is WHO ASKED. A score in a game somebody chose to play is
// the point of the game. A latency readout on the board somebody uses to talk is a verdict
// nobody asked for, on the one surface they cannot avoid.
//
// ---------------------------------------------------------------------------------------
// SCANNING IS OPTIONAL, AND OFF IS THE DEFAULT
// ---------------------------------------------------------------------------------------
//
// Most people who use a board touch it. Scanning is for somebody who cannot, and turning it on
// for everybody would make a board that answers a tap into a board that answers a tap
// eventually. So: off by default, and when it is on the loop comes from `input_scan.js` with
// its 15-second step and hybrid `next`.
//
// Touch still works while scanning — a caregiver demonstrating a card should not have to turn
// the scanner off first. A touch selects THAT card rather than the lit one, and then tells the
// scanner a choice was made, so both end up in the same place: paused on the choice, then a
// fresh pass from the top.

import { registerModule } from '../module.js';
import { createScan, SCAN_DEFAULTS } from '../input_scan.js';
import { symbolSvg } from '../aac_symbols.js';
import { normalizeBoard, tierOf, gridOf, BUILTIN_BOARDS, YESNO } from '../aac_vocab.js';
import { createMediaSourcesClient, resolveItemUrl } from '../media_sources.js';
import { mountBoardEditor, blankBoard } from '../board_editor.js';
import { speak as speakDefault } from '../voice.js';

// A card shorter or narrower than this has no room for a symbol AND a legible word. See
// `setUnit`. Chosen so the smallest card that still shows both is comfortably readable rather
// than technically non-overlapping.
const TIGHT_PX = 72;

// *** BELOW THIS, THE SWITCHER GOES AND THE CARDS KEEP THE ROOM. ***
//
// A board can be one quadrant of a screen, and the switcher is a caregiver's control on a
// surface somebody TALKS through. Measured: at 260x120 the chip row costs about 40px of 120,
// which leaves four rows of twenty — and the words then spill out of their own cards. That is
// the board failing at its actual job to keep a convenience visible, which is the wrong trade
// every time. The setting is still in the menu at any size.
const SWITCHER_MIN_H = 220;

// *** HOW LOPSIDED A CARD MAY GET BEFORE THE GRID IS TURNED. ***
//
// A card 2.2× longer than it is wide is still a card. Past that it is a stripe, and on a phone
// held upright the three-across starter board measures 120px wide by 806px tall — three
// slivers, with the word set at a size chosen for a square. Nothing about that is usable, and
// it is the shape Mike will be holding tomorrow.
//
// The threshold is what keeps this NARROW. A tablet in landscape running the 4×4 measures well
// inside it and is never touched; only the genuinely pathological case moves.
const LOPSIDED = 2.2;

export const BOARD_TOPIC = 'board/selected';   // live nudge for anything on the same screen

// The id under which a board somebody BUILT is offered in the switcher. Not a real entry in
// `BUILTIN_BOARDS` — it means "the one stored on this instance", whatever that is today.
const CUSTOM_ID = 'custom';
// The chips say what a caregiver would call these, not what the data calls them: `YESNO.name`
// is "Yes or no" and `CARE.name` is "Talk", and a switcher reading "Talk" next to a module
// that no longer is would be the exact confusion this rename removes.
// The chips above the cards. `care` says "example" here too: the chip is what somebody choosing
// a board actually reads, and a word that only appears in the settings menu is a word most
// people will never see. Kept short — this sits over a communication surface, not a settings page.
const BOARD_LABELS = { yesno: 'Yes / No / Other', care: 'Care board (example)' };
export const SELECT_KIND = 'select';           // the durable record's event kind

const DEFAULTS = {
  // *** THE DEFAULT IS THE 16-CARD BOARD, NOT YES / NO / OTHER. ***
  //
  // Mike, 2026-09-06: *"Default it to the larger board rather than yes/no/other."* Three cards
  // is what somebody sees first, and it makes the whole module look like a toy — he built this
  // and still had to know the system was there to find the bigger board inside it.
  //
  // *** AND THERE IS A REAL OBJECTION TO THIS, WRITTEN IN `aac_vocab.js` BY AN EARLIER PASS. ***
  // The care set is ONE PERSON'S BOARD, and it has no eat / drink / hungry / thirsty cards
  // because those did not apply to them — *"for anybody else that is a hole in the middle of
  // their vocabulary rather than a considered omission."* That warning is right and it is not
  // answered by this change; what answers it is a general starter set, which is vocabulary
  // design for people with communication needs and is not mine to invent. Recorded as a DECIDE
  // row rather than quietly shipped as though the hole were not there, and the board says its
  // own provenance on screen now instead of only in a comment.
  //
  // Nobody's existing screen moves: this is a DEFAULT, so it applies only where no board has
  // been chosen and none has been built. See `boardFor`.
  // *** BACK TO `yesno`, AND THIS REVERSES WHAT G8 ASKED FOR. Mike's call, 2026-09-06. ***
  //
  // G8 was *"default it to the larger board rather than yes/no/other"*, and that shipped. Then
  // the reason the larger board is larger got looked at: **the 16-word set is ONE PERSON'S
  // board** — see `aac_vocab.js`, which says so and adds that it has no eat / drink / hungry /
  // thirsty cards, *"which for anybody else is a hole in the middle of their vocabulary rather
  // than a considered omission."* For somebody new that hole sits exactly where the most-used
  // vocabulary in AAC normally is.
  //
  // Mike's answer: *"keep the care set, but as a labelled EXAMPLE board, not the default. It
  // doubles as documentation for what a custom board looks like."*
  //
  // **`yesno` is not a smaller version of the same mistake.** It is three cards that are
  // complete for what they are — yes, no, and a way to say "something else" — and nothing in it
  // is specific to one person. It is a defensible default in a way a stranger's care words are
  // not.
  //
  // THE REAL ANSWER IS STILL UNWRITTEN and is D13: Project Core's Universal Core, 36 words,
  // designed as a starter vocabulary for somebody who does not have one. Blocked on its licence.
  // Nothing invented here in the meantime — vocabulary for people with communication needs is
  // not something to make up inside a default change.
  boardId: 'yesno',
  // *** THE BOARD ROW IS OFF BY DEFAULT NOW, AND THAT REVERSES A DEFAULT FROM EARLIER TODAY. ***
  //
  // Mike, 2026-09-06: *"The board row is a hazard. It sits above the cards where somebody who
  // can only manage yes/no/other can hit it and lose their board."*
  //
  // The row shipped ON because switching was invisible, and that problem was real. The answer
  // was wrong: it put a caregiver's control inside the reach of the person the board is FOR,
  // on the one surface where an accidental press costs somebody their sentence. Switching now
  // lives in the board's own settings panel, which is where the rest of the caregiver controls
  // are, so the row is a convenience rather than the only route — and anybody who wants it can
  // still turn it on.
  showBoards: false,
  // Hides the row AND the gear. See the SETTINGS entry for the way back out, which is the only
  // part of a lock worth arguing about.
  locked: false,
  scan: false,
  stepMs: SCAN_DEFAULTS.stepMs,
  // 'all' — every card visible, one highlighted. 'one' — only the lit card on screen.
  //
  // *** DEFAULT 'all', AND THE COUNTER-CASE IS A REAL PERSON. *** Standard AAC shows the whole
  // set: seeing what is coming is most of what makes waiting through a scan bearable, and it is
  // how somebody plans a reach. But the private bedside build deliberately shows ONE card at a
  // time on its yes/no scanner — for somebody who is reading two large cards from a bed, one at
  // a time is easier, and filtering a grid visually may itself be the hard part. Both wants are
  // legitimate; this is a default, not a rule, and 'one' is one setting away.
  reveal: 'all',
  // A beat on the chosen card so the choice registers before anything else happens.
  pauseMs: SCAN_DEFAULTS.pauseMs,

  // *** THE BOARD IS PINNED TO ITS OWN PALETTE, NOT THE PROFILE'S THEME (2026-09-02). ***
  //
  // `false` means pinned. The measurements and the full argument are on `.aboard` in
  // modules.css; the short version is that the symbol palette is a set of light values and the
  // old word colours were a set of dark ones, so whichever surface the theme picked, one of the
  // two was illegible — and this is the panel somebody uses to SAY THINGS. A decoration setting
  // should not be able to reach it.
  //
  // IT IS A DEFAULT, NOT A RULE. Somebody whose whole screen is Warm and who wants the board to
  // match sets this to true and gets exactly that; the pinned contrast figures simply stop
  // being guaranteed, which is their business to decide. The counter-case is real — a person
  // who is not at a bedside, setting up their own screen, and for whom a board that ignores
  // their theme just looks broken.
  followTheme: false,

  // The board's OWN high-contrast switch, because pinning the palette also cut it off from the
  // `contrast` theme. Off by default — the pinned dark palette already clears every floor, and
  // black-on-white at 21:1 is a different tradeoff (maximum legibility, no colour cue at all)
  // that should be somebody's choice rather than their starting point.
  highContrast: false,

  // *** DOES TOUCHING A CARD CHOOSE IT? DEFAULT YES. ***
  //
  // Yes, because that is what a board is for and it is what everybody expects the first time
  // they see one. The counter-case is real and specific rather than hypothetical: somebody who
  // rests a hand on the screen, or drags across it to steady themselves, selects every card
  // they brush. For that person a tap is noise and the deliberate act is somewhere else —
  // dwelling, a switch, a scan.
  //
  // It is also what makes DWELL usable at all on a touchscreen. A tap that selects instantly
  // fires before any dwell clock can run, so with both on the dwell is dead code. A host that
  // turns dwell on should turn this off, and say so; `talk.html` does exactly that and leaves
  // the caregiver a way to put it back.
  tapSelects: true,

  // *** TURN THE GRID WHEN THE SCREEN SHAPE WOULD MAKE THE CARDS INTO STRIPES. DEFAULT ON,
  // AND THIS ONE NEEDS MIKE'S EYES BECAUSE IT LEANS ON THE FILE'S OWN RULE. ***
  //
  // `aac_vocab.js` is built around "a layout never changes under someone without a decision",
  // and turning a device is not a decision about a layout. So the argument for defaulting this
  // ON has to be made rather than assumed:
  //
  //   * It is a TRANSPOSE and nothing else. The same grid, turned. A card that was first in
  //     reading order is still first, last is still last, and no card ever swaps with another.
  //     This is not the silent reflow that rule exists to prevent — that one is vocabulary
  //     growth quietly renumbering slots, which still cannot happen.
  //   * It is deterministic and it is reversible by the person: turn the device back and the
  //     board is exactly as it was. A learned reach is not destroyed, it is rotated with the
  //     thing being held.
  //   * It only fires when the alternative is unusable. See `LOPSIDED`.
  //
  //   *** AND THE COUNTER-CASE IS REAL: somebody who HAS learned this board, on a device that
  //   moves between portrait and landscape, gets their reach turned underneath them. For that
  //   person this should be OFF, and it is one setting. It is off-able precisely because I do
  //   not think a default can be right for both. ***
  fitScreen: true,
};

export const SETTINGS = [
  { key: 'boardId', label: 'Which board', kind: 'choice', default: 'yesno', level: 'standard',
    // LIVE OPTIONS extend this at runtime: a board somebody built is offered here too. See
    // `settingsChoices` at the bottom of the factory.

    options: [
      { value: 'yesno', label: 'Yes / No / Other' },
      // LABELLED AS AN EXAMPLE, in the menu and on the board itself. Mike: it *"doubles as
      // documentation for what a custom board looks like"* — which is a real use, and only
      // works if nobody mistakes it for a starter set built for them.
      { value: 'care',  label: 'Care board — an example (16 words)' },
    ] },
  // *** SWITCHING BOARDS IS ON THE BOARD, NOT ONLY IN THE MENU. ***
  //
  // Mike: *"Make switching boards visible rather than buried behind the menu."* The setting
  // above still exists and still works; what was missing is that somebody looking at a board
  // had no way to know another one existed.
  //
  // ON by default, and the hazard is named rather than defaulted around: a person who rests or
  // drags a hand across the screen can hit a chip and lose the board they were part-way through
  // a sentence on. That is the same person `tapSelects` exists for, and the note says so — but
  // it is a separate switch, because coupling two settings means changing one silently changes
  // what the other does, which is exactly the kind of thing nobody can debug from a bedside.
  { key: 'showBoards', label: 'Show the board switcher', kind: 'toggle', default: false,
    level: 'standard', onLabel: 'Yes — a row of boards above the cards', offLabel: 'No',
    note: 'The row sits above the cards, where a resting hand can reach it. Switching is in '
      + 'the board’s own settings either way.' },
  // *** LOCK. AND THE ONLY QUESTION THAT MATTERS ABOUT A LOCK IS HOW YOU GET BACK OUT. ***
  //
  // `CLAUDE.md`: *"a caregiver locked out of their own lock is worse than no lock at all."*
  // So the way back is STRUCTURAL rather than a promise: `locked` is a DECLARED SETTING, which
  // means it is in the shell's settings menu for this panel, which is a caregiver surface the
  // module cannot hide and the lock does not touch. Unlock there and the gear comes back.
  //
  // What it hides is the two caregiver controls that sit ON the communication surface: the
  // board row and the gear. It does not hide, disable, slow or gate a single card. Somebody
  // using a locked board can say everything they could say a moment ago, which is the whole
  // test of whether a safety control on this module is safe.
  { key: 'locked', label: 'Lock the board', kind: 'toggle', default: false, level: 'standard',
    onLabel: 'Yes — hide the board row and the settings button',
    offLabel: 'No — leave the settings button on the board',
    note: 'The cards are unaffected. Unlock from this menu — it is the way back in, which is '
      + 'why it is here rather than only on the board.' },
  { key: 'scan', label: 'Scan the cards automatically', kind: 'toggle', default: false,
    level: 'standard' },
  { key: 'stepMs', label: 'Time on each card', kind: 'choice', default: SCAN_DEFAULTS.stepMs,
    level: 'standard',
    options: [
      // The 15-second default and its reasoning are in `input_scan.js`. It is not a UI number.
      { value: 5000,  label: '5 seconds' },
      { value: 10000, label: '10 seconds' },
      { value: 15000, label: '15 seconds' },
      { value: 25000, label: '25 seconds' },
      { value: 40000, label: '40 seconds' },
    ] },
  { key: 'reveal', label: 'While scanning, show', kind: 'choice', default: 'all',
    level: 'standard',
    options: [
      { value: 'all', label: 'all the cards, with one lit' },
      { value: 'one', label: 'only the card it is on' },
    ] },
  // ESSENTIAL, both of them. How readable this board is outranks which board it is showing,
  // and somebody who cannot read it cannot tell you that.
  { key: 'highContrast', label: 'High contrast', default: false, level: 'essential',
    onLabel: 'Black on white', offLabel: 'The board’s own colours' },
  { key: 'followTheme', label: 'Colours', default: false, level: 'essential',
    onLabel: 'Follow the screen’s theme', offLabel: 'The board keeps its own' },
  // ADVANCED, and grouped with the other input questions rather than sitting at the top of
  // the list: almost nobody needs to turn touch off, and the person who does will be looking
  // for it deliberately.
  { key: 'tapSelects', label: 'Touching a card chooses it', kind: 'toggle', default: true,
    level: 'advanced', onLabel: 'Yes', offLabel: 'No — use dwell, a switch or the scan',
    note: 'Turn this off for somebody who rests or drags a hand across the screen.' },
  { key: 'fitScreen', label: 'Turn the grid to fit the screen', kind: 'toggle', default: true,
    level: 'advanced', onLabel: 'Yes', offLabel: 'No — keep the grid as it is',
    note: 'Turn this off once somebody has learned where the cards are.' },
];

registerModule(
  // *** THE NAME IS "AAC BOARD", NOT "TALK", AND IT IS THE HIGHEST-VALUE WORD ON THE PAGE. ***
  //
  // Mike, testing the live site 2026-09-06: *"People searching for this know the term AAC.
  // Nobody recognises 'Talk' as the thing they need"* — and he built it and still had to
  // already know the system to find the larger board inside it.
  //
  // AAC is what the field calls this, what a speech therapist will say, and what somebody types
  // into a search box at two in the morning. "Talk" is what it DOES; "AAC board" is what it IS,
  // and a catalog entry has to be findable before it can be understood.
  //
  // The `type` stays `board`. A type is a stable identifier — it is in saved screens, in input
  // bindings and in tests — and renaming it is a migration, not a label change. Same rule the
  // `inputs` tab followed when it became "Devices".
  { type: 'board', title: 'AAC board',
    description: 'An AAC communication board. Big cards that say the word out loud when they '
      + 'are chosen — touched, or walked one at a time for a single switch.',
    // `normal`, not `critical` — and the distinction is not modesty. `importance` feeds the
    // recovery ladder's fallback RANKING (`recovery.js`), so `critical` does not mean "matters
    // a lot", it means "swap to this when something breaks". A board is a tool somebody uses on
    // purpose, not something to look at, which is the same reason it is in the catalog's
    // 'practice' group rather than 'comfort'.
    dependsOn: 'none', importance: 'normal', settings: SETTINGS },
  (ctx) => {
    const { mount, bus, state, events } = ctx;
    const speak = ctx.speak || ((text) => speakDefault(text));
    const setTimer = ctx.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = ctx.clearTimer || ((id) => clearTimeout(id));
    const now = ctx.now || (() => Date.now());

    let cfg = { ...DEFAULTS };
    let board = normalizeBoard(YESNO);
    let scan = null;
    let cardEls = [];
    let lit = 0;
    let destroyed = false;
    // *** EVERY LISTENER ON `mount` IS TIED TO ONE SIGNAL, AND `destroy` ABORTS IT. ***
    //
    // These used to be bare `mount.addEventListener` calls with nothing removing them, and
    // `destroy` only cleared `innerHTML` -- so a destroyed board LEFT ITS HANDLERS ON THE HOST.
    // Mount a second board on the same element and both instances answer every click, oldest
    // first, each one reaching into the LIVE markup through its own dead closure.
    //
    // Found by a check that expected the new board in the panel's list and got the old board's:
    // the dead instance's handler had opened the new instance's panel and filled it from the
    // previous screen's settings. That is not a test artifact -- a shell that reuses a mount
    // gets one person's board list rendered from somebody else's saved row.
    const gone = new AbortController();
    const listen = (target, type, fn, opts) =>
      target.addEventListener(type, fn, { ...(opts || {}), signal: gone.signal });
    let pressTimer = null;
    let ro = null;
    // An aim is resting on the card at `lit`. Separate from `scan` because the two are
    // different reasons for the same highlight, and a screen can have both.
    let pointed = false;
    let aimHold = false;                     // we are the ones holding the scan clock off
    const view = ctx.view || (typeof window !== 'undefined' ? window : null);

    const el = (s) => mount.querySelector(s);
    const grid = () => el('[data-grid]');

    /**
     * *** A BOARD SOMEBODY BUILT STILL WINS, AND THAT IS WHY THIS IS NOT ONE LINE. ***
     *
     * It used to be: if a custom board is saved, show it, full stop. That was right, and it
     * meant `boardId` did nothing at all for anybody with their own board — so a visible
     * switcher would have been a row of chips that changed nothing.
     *
     * The distinction that fixes it without moving anybody's board: was `boardId` ever
     * CHOSEN? A stored settings row that has no `boardId` key belongs to somebody who never
     * picked one, and they keep exactly what they see today — their own board, or the default.
     * Only an explicit choice overrides, which is the only case where somebody has asked.
     *
     * So a change of default cannot reach a screen that has a board on it, and cannot reach
     * one where a person deliberately chose a board either. That mattered when the default
     * moved to `care` and it matters again now that it has moved back — **anybody who was
     * given the care board by the old default and never chose it goes back to Yes / No /
     * Other**, and anybody who picked one keeps it.
     */
    function boardFor(id) {
      const row = state?.get?.() || {};
      const saved = row.board;                          // a board somebody built themselves
      const chose = Object.prototype.hasOwnProperty.call(row, 'boardId');
      const own = saved && saved.cells ? normalizeBoard(saved) : null;
      if (own && (!chose || id === CUSTOM_ID)) return own;
      return normalizeBoard(BUILTIN_BOARDS[id] || own || YESNO);
    }

    /** The chips above the cards: every board this screen could show, and which one it is on. */
    function boardChoices() {
      const row = state?.get?.() || {};
      const out = Object.entries(BUILTIN_BOARDS)
        .map(([id, b]) => ({ id, label: BOARD_LABELS[id] || b.name || id }));
      if (row.board && row.board.cells) {
        out.unshift({ id: CUSTOM_ID, label: row.board.name || 'Your board' });
      }
      return out;
    }

    function drawBoards() {
      const bar = el('[data-boards]');
      if (!bar) return;
      const choices = boardChoices();
      // Three ways this row is not drawn, and only one of them is a setting:
      //   * somebody turned it off;
      //   * there is only one board, and a switcher offering one option is chrome over a
      //     communication surface, which is the one place chrome is least welcome;
      //   * the panel is too short to spare the height — see SWITCHER_MIN_H.
      const tooShort = (mount.querySelector('.aboard')?.clientHeight || 0) > 0
        && mount.querySelector('.aboard').clientHeight < SWITCHER_MIN_H;
      // LOCKED WINS OVER THE SETTING. A lock that a stored `showBoards:true` could override
      // would not be a lock, it would be a suggestion — and the screen it failed on would be
      // one somebody deliberately locked.
      const show = !cfg.locked && cfg.showBoards !== false && choices.length > 1 && !tooShort;
      bar.hidden = !show;
      if (!show) { bar.innerHTML = ''; return; }
      bar.innerHTML = choices.map((c) => `<button type="button" class="ab-bchip" `
        + `data-board="${escapeHtml(c.id)}" aria-pressed="${c.id === board.id}">${escapeHtml(c.label)}</button>`)
        .join('');
    }

    // ------------------------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------------------------

    // *** ONE HUNDREDTH OF A CARD, MEASURED FROM THE CONTAINER. ***
    //
    // Ported from the private build, and the reason is worth keeping: a board is not always
    // full-screen. It can be one quadrant of a dashboard, and viewport units (`vmin`) would
    // size the symbol and the word as though it were — a 30px word crammed into a 54px card.
    // So the unit comes from the CARD, which means it comes from the container and the tier.
    //
    // The private file also carries the bug it fixed, which is worth carrying too: an earlier
    // version measured a HIDDEN card and got zero, so `--u:0` collapsed that card's word and
    // borders to nothing. Measure the ROOT, never a cell that might be display:none.
    // The tier as it will actually be drawn. Always the SAME NUMBER OF CELLS in the SAME
    // ORDER — only the number of columns can change, and only by transposing. See `fitScreen`.
    function effectiveTier() {
      // `gridOf`, not `tierOf`: a board somebody BUILT states its own cols/rows and that is the
      // shape it is drawn in. A board without one still gets its tier's grid, unchanged.
      const t = gridOf(board) || tierOf(3);
      if (cfg.fitScreen === false || !t) return t;
      const g = grid();
      const w = g?.clientWidth || 0, h = g?.clientHeight || 0;
      if (!w || !h || t.cols === t.rows) return t;   // a square grid transposes to itself
      const lopsidedness = (cols, rows) => {
        const cw = w / cols, ch = h / rows;
        return Math.max(cw / ch, ch / cw);
      };
      const asIs = lopsidedness(t.cols, t.rows);
      if (asIs <= LOPSIDED) return t;                // already a reasonable shape — leave it
      const turned = lopsidedness(t.rows, t.cols);
      if (turned >= asIs) return t;                  // turning it would not help
      return { ...t, cols: t.rows, rows: t.cols };
    }

    function setUnit() {
      const g = grid();
      const t = effectiveTier();
      if (!g || !t) return;
      const w = g.clientWidth, h = g.clientHeight;
      // *** THE TEMPLATE IS APPLIED BEFORE THE "not laid out yet" BAIL-OUT, AND THAT ORDER IS
      // THE BUG THIS CARRIES. ***
      //
      // It has to be applied HERE and not only in `draw` because the thing that changes it is a
      // resize — turning a tablet — and a resize does not redraw the cards. But moving it here
      // and leaving it below the `if (!w || !h) return` put it behind a guard that IS taken on
      // a first paint: on the very first mount `clientWidth` is still 0, so the function
      // returned before setting any columns and every card stacked full-width down the page.
      // The suite did not catch it because it asserted the COMPUTED tier rather than the
      // rendered grid, and a 1-column transpose and a stack of blocks look identical.
      g.style.gridTemplateColumns = `repeat(${t.cols}, 1fr)`;
      g.style.gridTemplateRows = `repeat(${t.rows}, 1fr)`;
      if (!w || !h) return;                     // not laid out yet; onResize will come back
      const u = Math.min(w / t.cols, h / t.rows) / 100;
      g.style.setProperty('--u', `${u}px`);
      // *** TOO SMALL FOR BOTH? DROP THE PICTURE, NEVER THE WORD. *** Same rule as color: the
      // symbol supports meaning, the word carries it. A board squeezed into a corner of a
      // dashboard stays readable; one that shrank the word to keep a picture would be neither
      // readable nor recognizable. The threshold is the card's short side in px.
      g.classList.toggle('ab-tight', Math.min(w / t.cols, h / t.rows) < TIGHT_PX);
      // A resize can cross SWITCHER_MIN_H in either direction, and the switcher is the thing
      // that has to give way. Called from here rather than only from `applyConfig` because a
      // resize does not change the config and would otherwise never re-ask.
      drawBoards();
    }

    function draw() {
      // The CELL COUNT comes from the declared tier and never from the effective one: turning
      // the grid changes how the cells are arranged, never how many there are.
      const t = gridOf(board) || tierOf(3);
      const g = grid();
      if (!g) return;
      releaseImages();
      g.innerHTML = '';
      cardEls = [];
      // Every slot in the tier is rendered, including empty ones. A hole is drawn as a hole:
      // the positions after it must not move, which is the whole rule in `aac_vocab.js`.
      for (let i = 0; i < t.cells; i++) {
        const cell = board.cells[i] || null;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `ab-card${cell ? ` ab-${cell.kind}` : ' ab-empty'}`;
        b.dataset.i = String(i);
        if (!cell) {
          b.disabled = true;
          b.setAttribute('aria-hidden', 'true');
        } else {
          b.setAttribute('aria-label', cell.word);
          const sym = symbolSvg(cell.symbol);
          // *** THE PICTURE IS OPTIONAL AND ARRIVES LATE; THE WORD IS NEITHER. ***
          //
          // A card with an image renders the WORD immediately and an empty picture frame, then
          // fills the frame when the file has been read. Nothing waits on the file: a board
          // whose folder permission has lapsed still says every word it says today, which is
          // the difference between a degraded board and a person with no voice this morning.
          b.innerHTML = (cell.image ? '<span class="ab-img" data-img></span>'
                        : sym ? `<span class="ab-sym">${sym}</span>` : '')
            + `<span class="ab-word">${escapeHtml(cell.word)}</span>`;
          if (cell.image) loadImage(b, cell.image);
          // pointerdown, and it stops there: a tap IS this card, and letting it bubble would
          // let a global pointer binding ALSO fire a generic select — the same card chosen
          // twice, or worse, a different one. The private build hit this and says so.
          //
          // `stopPropagation` runs even when `tapSelects` is off, and that is deliberate: with
          // touch selection turned off a tap must be a NO-OP, not a fall-through that some
          // other listener turns into a select. Off means off.
          b.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (cfg.tapSelects !== false) choose(i);
          });
        }
        g.append(b);
        cardEls.push(b);
      }
      setUnit();
      paint();
    }

    // ------------------------------------------------------------------------------------
    // CARD PICTURES — files on the person's own machine, never anything uploaded
    // ------------------------------------------------------------------------------------
    //
    // A card holds `{sourceId, path}` and resolves it through the same media-source registry
    // `photos` uses. **Nothing is uploaded and there is no code here that could upload
    // anything** — the platform stores a reference, the bytes stay where they are.
    //
    // Each picture takes a URL IT OWNS (`resolveItemUrl`) rather than one off a shared listing,
    // because a folder listing revokes the previous listing's URLs — so a card reusing one
    // would go blank the moment a photo panel refreshed the same folder. See `folderFileUrl`.
    let sourcesP = null;                      // listed once per mount, not once per card
    let imgReleases = [];

    function releaseImages() {
      for (const r of imgReleases) { try { r(); } catch { /* already gone */ } }
      imgReleases = [];
    }

    async function loadImage(cardEl, ref) {
      try {
        if (!sourcesP) {
          const client = ctx.mediaSources
            || createMediaSourcesClient({ user: ctx.user, cache: true,
                                          personId: ctx.personId || null });
          sourcesP = client.list();
        }
        const sources = (await sourcesP) || [];
        const src = sources.find((x) => x.id === ref.sourceId);
        if (!src) return;                     // the folder is not connected on this device
        const got = await resolveItemUrl(src, ref.path);
        if (!got || destroyed || !cardEl.isConnected) { got?.release?.(); return; }
        imgReleases.push(got.release);
        const frame = cardEl.querySelector('[data-img]');
        if (!frame) { got.release(); return; }
        const img = document.createElement('img');
        img.alt = '';                         // the word beside it is the label; this is decoration
        img.src = got.url;
        frame.append(img);
      } catch (err) {
        // Silent on the CARD, loud in the console. A red error over somebody's word is worse
        // than a missing picture, and the word is still there and still speaks.
        console.warn('board: could not load a card picture', err);
      }
    }

    function paint() {
      const showOne = cfg.reveal === 'one' && !!scan;
      const highlight = !!scan || pointed;
      cardEls.forEach((b, i) => {
        b.classList.toggle('ab-lit', highlight && i === lit);
        b.classList.toggle('ab-away', showOne && i !== lit);
      });
    }

    // ------------------------------------------------------------------------------------
    // AIMING — a pointer, a head, a marker, somebody's phone driving this screen
    // ------------------------------------------------------------------------------------
    //
    // The board hit-tests its OWN cards, and that is the point. A shell that wanted to do it
    // would have to reach inside `ctx.mount` and read the markup, which is the one thing a
    // module contract exists to prevent — and it would break the moment the board is one
    // quadrant of a grid rather than the whole screen.
    //
    // Units are the ones `input/aim` already uses: fractions of the VIEWPORT, 0..1. Not of
    // this panel. A single aim has to mean the same thing to every module on a screen, or a
    // grid of four panels needs four different coordinate systems.
    function aimAt(a) {
      if (destroyed) return;
      const w = Number(view?.innerWidth) || 0;
      const h = Number(view?.innerHeight) || 0;
      let hit = -1;
      if (a && a.x != null && a.y != null && w && h) {
        const px = a.x * w, py = a.y * h;
        for (let i = 0; i < cardEls.length; i++) {
          const b = cardEls[i];
          if (!b || b.disabled) continue;              // a hole is not a target
          const r = b.getBoundingClientRect();
          if (px >= r.left && px < r.right && py >= r.top && py < r.bottom) { hit = i; break; }
        }
      }
      if (hit < 0) {
        // The aim left the cards. Drop the highlight and give the scan clock back — but do
        // NOT move `lit`, so a scan that was suppressed resumes where it was rather than
        // jumping.
        if (pointed) { pointed = false; paint(); }
        holdScan(false);
        return;
      }
      // *** THE AIM WINS OVER THE SCAN CLOCK WHILE IT IS ON A CARD. ***
      // Otherwise the scanner steps out from under somebody's finger halfway through a dwell,
      // and they select the card that arrived rather than the one they were pointing at.
      holdScan(true);
      if (!pointed || lit !== hit) { pointed = true; lit = hit; paint(); }
    }

    function holdScan(on) {
      if (!scan || aimHold === !!on) return;
      aimHold = !!on;
      try { scan.suppress(aimHold); } catch (err) { console.error('board: suppress', err); }
    }

    // ------------------------------------------------------------------------------------
    // CHOOSING
    // ------------------------------------------------------------------------------------

    function choose(i) {
      const cell = board.cells[i];
      if (!cell || destroyed) return;
      lit = i;
      paint();
      flash(i);

      // *** `say`, NEVER `notify`. *** See the header: the verb is the boundary between a
      // talking aid and a nurse call. `say` routes to speech and stays in this room.
      const text = cell.say || cell.word;
      try {
        if (ctx.output?.say) ctx.output.say(text, { source: 'board' });
        else speak(text);
      } catch (err) { console.error('board: say', err); }

      // The live nudge, for anything on the same screen that wants to react.
      try { bus?.publish?.(BOARD_TOPIC, { word: cell.word, id: cell.id, board: board.id }); }
      catch (err) { console.error('board: publish', err); }

      // The durable record. It exists so somebody can find out whether the board WORKS — which
      // words get used, which never do, whether a tier change helped. Nothing about it is
      // rendered back to her; see the header.
      try {
        events?.append?.(SELECT_KIND, {
          at: now(), word: cell.word, id: cell.id, board: board.id,
          index: i, tier: board.tier, via: scan ? 'scan' : 'touch',
        })?.catch?.((err) => console.error('board: log', err));
      } catch (err) { console.error('board: log', err); }

      // Tell the scanner a choice was made, however it was made. It holds for `pauseMs` and
      // then starts a fresh pass from the top — so a touch and a scan-select leave the board in
      // the same state, and the two can never disagree about where they are.
      if (scan) scan.select();
    }

    function flash(i) {
      const b = cardEls[i];
      if (!b) return;
      b.classList.add('ab-press');
      if (pressTimer != null) clearTimer(pressTimer);
      pressTimer = setTimer(() => { pressTimer = null; b.classList.remove('ab-press'); }, 200);
    }

    // ------------------------------------------------------------------------------------
    // SCANNING
    // ------------------------------------------------------------------------------------

    function stopScan() {
      try { scan?.destroy(); } catch { /* already gone */ }
      scan = null;
      // The hold belonged to a scanner that no longer exists. Leaving it set would make the
      // NEXT scanner start life suppressed by a finger that left the screen minutes ago.
      aimHold = false;
      paint();
    }

    function startScan() {
      stopScan();
      if (!cfg.scan) return;
      // Only real cards are scanned. Stepping onto a hole would offer somebody an option that
      // is not there, and on a 15-second step that is fifteen seconds of nothing.
      const idxs = board.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
      scan = createScan({
        items: idxs,
        settings: () => ({ stepMs: cfg.stepMs, pauseMs: cfg.pauseMs, restart: 'first' }),
        onStep: (i) => { lit = i; paint(); },
        setTimer, clearTimer,
      });
      scan.start();
    }

    // The two appearance switches are CLASSES ON `.aboard`, not inline styles: the palettes
    // themselves live in modules.css next to the cards they colour, so the numbers and the
    // rules they satisfy stay in one place instead of half here and half there.
    function applyAppearance() {
      const el = mount.querySelector('.aboard');
      if (!el) return;
      el.classList.toggle('ab-themed', !!cfg.followTheme);
      // High contrast WINS over theme-following when both are on. Somebody who has asked for
      // maximum legibility has said something about being able to read it, and a theme is a
      // preference about how it looks; the accessible answer takes precedence over the
      // decorative one rather than the two fighting over the cascade.
      el.classList.toggle('ab-hc', !!cfg.highContrast);
    }

    // ------------------------------------------------------------------------------------
    // THE SETTINGS PANEL
    // ------------------------------------------------------------------------------------

    const panelEl = () => mount.querySelector('[data-panel]');
    const gearEl = () => mount.querySelector('[data-gear]');

    function panelOpen(open) {
      const pan = panelEl(); const g = gearEl();
      if (!pan || !g) return;
      pan.hidden = !open;
      g.setAttribute('aria-expanded', String(!!open));
      if (open) drawPanel();
    }

    /** Fill the panel from the CURRENT config every time it opens — never from what it said
     *  last time. Two surfaces can write these (this panel and the shell's settings menu), and
     *  a panel showing a stale checkbox is a caregiver toggling a setting to where it already
     *  is and watching nothing happen. */
    function drawPanel() {
      const sel = mount.querySelector('[data-pboard]');
      if (sel) {
        sel.innerHTML = boardChoices()
          .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === board.id ? ' selected' : ''}`
            + `>${escapeHtml(c.label)}</option>`).join('');
      }
      const show = mount.querySelector('[data-popt="showBoards"]');
      if (show) show.checked = cfg.showBoards !== false;
      const lock = mount.querySelector('[data-popt="locked"]');
      if (lock) lock.checked = !!cfg.locked;
    }

    /** Write one setting to the SAME row the shell's menu writes. Two surfaces, one truth —
     *  a panel with its own copy of a setting is a board that disagrees with its own menu. */
    function saveSetting(key, value) {
      try { state?.set?.({ ...(state.get?.() || {}), [key]: value }); }
      catch (err) { console.error('board: could not save', key, err); }
      // Offline, or a throwaway state handle (the try-it page), the write may never come back.
      // Apply it here too rather than leaving somebody pressing a control that does nothing.
      cfg = { ...cfg, [key]: value };
      applyConfig();
    }

    // ------------------------------------------------------------------------------------
    // THE EDITOR
    // ------------------------------------------------------------------------------------
    //
    // It lives in `board_editor.js` — this is only the part that opens it, puts what it made
    // into the settings row, and gets out of the way.
    let editor = null;

    /**
     * Open the editor over the board.
     *
     * *** THE DRAFT IS WHY THIS IS NOT THREE LINES. *** The editor closes ITSELF after a few
     * idle minutes, because a caregiver called into the corridor would otherwise leave the
     * person the board is for looking at a form they cannot fill in or dismiss — the exact
     * shape `CLAUDE.md` forbids. What comes back from that is a half-finished board, and it is
     * neither saved over the real one (a board written on a timer) nor thrown away (somebody's
     * afternoon). It is kept as `boardDraft` and offered back the next time this opens.
     */
    function openEditor(which) {
      const host = mount.querySelector('[data-editor]');
      if (!host) return;
      panelOpen(false);
      closeEditor();
      const row = state?.get?.() || {};
      const base = which === 'new'
        ? (row.boardDraft && !row.boardDraft.__of ? row.boardDraft : blankBoard())
        : (row.boardDraft && row.boardDraft.__of === board.id ? row.boardDraft : board);
      host.hidden = false;
      editor = mountBoardEditor(host, {
        board: base,
        making: which === 'new',
        sources: ctx.mediaSources
          || createMediaSourcesClient({ user: ctx.user, cache: true, personId: ctx.personId || null }),
        setTimer, clearTimer,
        onCancel: () => closeEditor(),
        onIdle: (draftBoard) => {
          // Keep the work, give the board back. Tagged with what it was editing so reopening
          // "Edit this board" on a DIFFERENT board does not hand somebody the wrong draft.
          saveSetting('boardDraft', { ...draftBoard, __of: which === 'new' ? null : board.id });
          closeEditor();
        },
        onSave: (made) => {
          closeEditor();
          // Two writes in one, because they are one decision: the board somebody just made,
          // and the choice to be looking at it. Saving a board and leaving the screen on the
          // old one is the sort of thing that reads as "it did not save".
          try {
            state?.set?.({ ...(state.get() || {}), board: made, boardId: CUSTOM_ID,
                           boardDraft: null });
          } catch (err) { console.error('board: could not save the board', err); }
          cfg = { ...cfg, boardId: CUSTOM_ID };
          applyConfig();
        },
      });
    }

    function closeEditor() {
      try { editor?.destroy?.(); } catch { /* already gone */ }
      editor = null;
      const host = mount.querySelector('[data-editor]');
      if (host) { host.hidden = true; host.innerHTML = ''; }
    }

    function applyConfig() {
      board = boardFor(cfg.boardId);
      drawBoards();
      // The gear goes with the row when locked. It is the other caregiver control sitting on
      // the communication surface, and hiding one while leaving the other is half a lock.
      const g = gearEl();
      if (g) g.hidden = !!cfg.locked;
      if (cfg.locked) { panelOpen(false); closeEditor(); }
      lit = 0;
      // A different board is a different set of rectangles. Whatever the aim was resting on
      // is not there any more, so the highlight goes with it rather than sitting on whichever
      // card inherited that slot.
      pointed = false;
      applyAppearance();
      draw();
      startScan();
      if (panelEl() && !panelEl().hidden) drawPanel();
    }

    return {
      __probe: () => ({
        boardId: board.id, tier: board.tier, cells: board.cells.length,
        // The switcher AS DRAWN, so a test asserts the chips rather than the setting.
        boards: [...mount.querySelectorAll('[data-board]')].map((b) => b.dataset.board),
        boardsShown: !mount.querySelector('[data-boards]')?.hidden,
        gearShown: !!mount.querySelector('[data-gear]') && !mount.querySelector('[data-gear]').hidden,
        panelOpen: !!mount.querySelector('[data-panel]') && !mount.querySelector('[data-panel]').hidden,
        panelBoards: [...mount.querySelectorAll('[data-pboard] option')].map((o) => o.value),
        locked: !!cfg.locked,
        editing: !!editor,
        editorProbe: editor ? editor.__probe() : null,
        lit, scanning: !!scan, reveal: cfg.reveal,
        pointed, aimHold, tapSelects: cfg.tapSelects !== false,
        // The grid AS DRAWN, so a test can assert the transpose rather than the setting.
        grid: (() => { const t = effectiveTier(); return t ? { cols: t.cols, rows: t.rows } : null; })(),
        litCount: cardEls.filter((b) => b.classList.contains('ab-lit')).length,
        words: cardEls.map((b) => b.textContent || ''),
        shown: cardEls.filter((b) => !b.classList.contains('ab-away')).length,
        // Appearance, so a test can assert the palette actually reaches the cards rather than
        // that a config key was set.
        themed: !!mount.querySelector('.aboard.ab-themed'),
        hc: !!mount.querySelector('.aboard.ab-hc'),
      }),

      init() {
        // *** THE PANEL, AND WHY THIS MODULE DID NOT HAVE ONE UNTIL NOW. ***
        //
        // Every caregiver control here used to live in the shell's settings menu, several
        // screens away from the board — so the only control that was actually reachable was
        // the switcher row, sitting on the communication surface itself, where the person the
        // board is FOR can hit it. That is backwards: the caregiver's controls should be the
        // ones behind a deliberate press, and the cards should be the ones under the hand.
        //
        // It is a PANEL, not a gate. It opens only from the gear, it closes on Escape, on a
        // press outside it and on Done, and nothing on the board waits for it — the cards
        // underneath keep working the moment it is closed. Opening it by accident costs a tap.
        mount.innerHTML = `
          <div class="aboard">
            <div class="ab-boards" data-boards role="group" aria-label="which board" hidden></div>
            <div class="ab-grid" data-grid role="group" aria-label="communication board"></div>
            <button type="button" class="ab-gear" data-gear aria-expanded="false"
                    aria-label="board settings">⚙</button>
            <div class="ab-editor" data-editor hidden role="dialog" aria-label="edit board"></div>
            <div class="ab-panel" data-panel hidden role="dialog" aria-label="board settings">
              <label class="ab-prow">
                <span>Board</span>
                <select data-pboard></select>
              </label>
              <div class="ab-prow ab-pbtns">
                <button type="button" class="ab-pbtn" data-edit>Edit this board</button>
                <button type="button" class="ab-pbtn" data-new>Make a new board…</button>
              </div>
              <label class="ab-prow ab-pcheck">
                <input type="checkbox" data-popt="showBoards">
                <span>Show the row of boards above the cards</span>
              </label>
              <p class="ab-pnote">The row is quick, and it is within reach of somebody who
                rests a hand on the screen. Switching is here either way.</p>
              <label class="ab-prow ab-pcheck">
                <input type="checkbox" data-popt="locked">
                <span>Lock — hide the row and this button</span>
              </label>
              <p class="ab-pnote">The cards are unaffected. To unlock, open this panel’s
                settings from the screen it is on — that menu is the way back in.</p>
              <div class="ab-prow ab-pbtns">
                <button type="button" class="ab-pbtn ab-pdone" data-pclose>Done</button>
              </div>
            </div>
          </div>`;

        cfg = { ...DEFAULTS, ...(state?.get?.() || {}) };
        applyConfig();

        // A panel can change size without the host calling onResize — a sibling collapsing, a
        // window drag, the kiosk re-laying out. Cheap, and the alternative is a board whose
        // words are the wrong size until something else happens to touch it.
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => setUnit());
          ro.observe(grid());
        }

        // The switcher's own clicks. Delegated from the mount because `drawBoards` replaces
        // the chips whenever the board changes, and a listener on a chip would go with it.
        //
        // It writes `boardId` into the SAME settings row the menu writes, so the two cannot
        // disagree — a visible control that shadowed the menu would be a second source of
        // truth about which board somebody is on. `state.set` fires `subscribe` below, which
        // re-reads and redraws; nothing here applies the change by hand.
        listen(mount, 'click', (e) => {
          const chip = e.target.closest('[data-board]');
          if (!chip || !mount.contains(chip)) return;
          const id = chip.dataset.board;
          if (id === board.id) return;                    // already on it
          try { state?.set?.({ ...(state.get() || {}), boardId: id }); }
          catch (err) { console.error('board: could not save the choice', err); }
          // Offline, or no state handle at all (the try-it page mounts with a throwaway one),
          // the write may never come back — so the board still changes here rather than
          // leaving somebody pressing a chip that visibly does nothing.
          cfg = { ...cfg, boardId: id };
          applyConfig();
        });

        // The panel's own controls. Delegated, because `drawPanel` replaces the board list.
        listen(mount, 'click', (e) => {
          if (e.target.closest('[data-gear]')) {
            panelOpen(panelEl()?.hidden !== false);
            return;
          }
          if (e.target.closest('[data-pclose]')) { panelOpen(false); return; }
          if (e.target.closest('[data-edit]')) { openEditor('edit'); return; }
          if (e.target.closest('[data-new]')) { openEditor('new'); return; }
          // The editor is a surface of its own. A press inside it is not a press on the board.
          if (e.target.closest('[data-editor]')) return;
          // A press anywhere outside the panel closes it — including on a card, which is the
          // press somebody actually wanted. `pointerdown` on the cards has already stopped
          // propagating, so this runs on the click that follows and does not eat the word.
          if (panelEl() && !panelEl().hidden && !e.target.closest('[data-panel]')) {
            panelOpen(false);
          }
        });
        listen(mount, 'change', (e) => {
          const sel = e.target.closest('[data-pboard]');
          if (sel) { saveSetting('boardId', sel.value); return; }
          const opt = e.target.closest('[data-popt]');
          if (opt) saveSetting(opt.dataset.popt, !!opt.checked);
        });
        // Escape closes it. A panel over a communication surface that could only be closed by
        // finding the right button would be the undismissable gate wearing a settings icon.
        listen(mount, 'keydown', (e) => {
          if (e.key === 'Escape' && panelEl() && !panelEl().hidden) {
            e.stopPropagation(); panelOpen(false); gearEl()?.focus();
          }
        });

        state?.subscribe?.(() => {
          cfg = { ...DEFAULTS, ...(state.get() || {}) };
          applyConfig();
        });

        // The board never names its input. `board/next` moves the scanner on, `board/select`
        // takes whatever is lit — so a switch, a key, a dwell or somebody's phone all drive it
        // with no change here. A single-switch setup binds only `board/select` and lets the
        // clock do the advancing.
        bus?.subscribe?.('board/next', () => { if (scan) scan.next(); });
        // *** `select` USED TO BE GATED ON `scan`, AND THAT WAS A HOLE. *** With scanning off,
        // a switch press reached this line and did nothing at all — so a single-switch user
        // who did not want the scan clock had no way to choose anything. What it must NOT do
        // is choose card 0 for somebody who has pointed at nothing, so the gate is now "is
        // anything actually lit": either the scanner put it there or an aim is resting on it.
        bus?.subscribe?.('board/select', () => { if (scan || pointed) choose(lit); });
        // Where the aim is. See `aimAt` — fractions of the viewport, the same units
        // `input/aim` uses, because one aim has to mean one thing across a whole screen.
        bus?.subscribe?.('board/aim', (a) => aimAt(a));
        // Choose a NAMED card, without pointing at it. This is what a remote control, a test
        // and an imported quick-phrase all want, and none of them have a position to aim
        // with. By index or by the card's own id; an unknown one is ignored rather than
        // guessed at.
        bus?.subscribe?.('board/pick', (p) => {
          if (p == null) return;
          const raw = typeof p === 'object' ? p : { index: p };
          let i = -1;
          if (raw.index != null && Number.isFinite(Number(raw.index))) i = Number(raw.index);
          else if (raw.id != null) i = board.cells.findIndex((c) => c && c.id === raw.id);
          if (i >= 0 && board.cells[i]) choose(i);
        });
      },

      // LIVE OPTIONS for the shell's settings menu. `boardId`'s declared options are the
      // built-ins, which is the contract and is all a menu can know about a module that is not
      // running. A board somebody BUILT is data, and it only exists on the mounted instance —
      // so without this the menu offers two boards while the panel offers three, and the one
      // missing is the person's own.
      settingsChoices: () => ({ boardId: boardChoices().map((c) => ({ value: c.id, label: c.label })) }),

      onResize() { setUnit(); },
      onHide() { stopScan(); },
      onShow() { startScan(); },

      destroy() {
        destroyed = true;
        stopScan();
        try { ro?.disconnect(); } catch { /* already gone */ } ro = null;
        if (pressTimer != null) { clearTimer(pressTimer); pressTimer = null; }
        releaseImages();
        closeEditor();
        gone.abort();                       // every listener this module put on the mount
        cardEls = [];
        mount.innerHTML = '';
      },
    };
  },
);

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
