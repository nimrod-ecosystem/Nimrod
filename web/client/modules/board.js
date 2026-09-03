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
import { normalizeBoard, tierOf, BUILTIN_BOARDS, YESNO } from '../aac_vocab.js';
import { speak as speakDefault } from '../voice.js';

// A card shorter or narrower than this has no room for a symbol AND a legible word. See
// `setUnit`. Chosen so the smallest card that still shows both is comfortably readable rather
// than technically non-overlapping.
const TIGHT_PX = 72;

export const BOARD_TOPIC = 'board/selected';   // live nudge for anything on the same screen
export const SELECT_KIND = 'select';           // the durable record's event kind

const DEFAULTS = {
  boardId: 'yesno',
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
};

export const SETTINGS = [
  { key: 'boardId', label: 'Which board', kind: 'choice', default: 'yesno', level: 'standard',
    options: [
      { value: 'yesno', label: 'Yes / No / Other' },
      { value: 'care',  label: 'Care board (16 words)' },
    ] },
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
];

registerModule(
  { type: 'board', title: 'Talk',
    description: 'A communication board. Big cards that say the word out loud when they are chosen.',
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
    let pressTimer = null;
    let ro = null;

    const el = (s) => mount.querySelector(s);
    const grid = () => el('[data-grid]');

    function boardFor(id) {
      const saved = (state?.get?.() || {}).board;      // a board somebody built themselves
      if (saved && saved.cells) return normalizeBoard(saved);
      return normalizeBoard(BUILTIN_BOARDS[id] || YESNO);
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
    function setUnit() {
      const g = grid();
      const t = tierOf(board.tier) || tierOf(3);
      if (!g || !t) return;
      const w = g.clientWidth, h = g.clientHeight;
      if (!w || !h) return;                     // not laid out yet; onResize will come back
      const u = Math.min(w / t.cols, h / t.rows) / 100;
      g.style.setProperty('--u', `${u}px`);
      // *** TOO SMALL FOR BOTH? DROP THE PICTURE, NEVER THE WORD. *** Same rule as color: the
      // symbol supports meaning, the word carries it. A board squeezed into a corner of a
      // dashboard stays readable; one that shrank the word to keep a picture would be neither
      // readable nor recognizable. The threshold is the card's short side in px.
      g.classList.toggle('ab-tight', Math.min(w / t.cols, h / t.rows) < TIGHT_PX);
    }

    function draw() {
      const t = tierOf(board.tier) || tierOf(3);
      const g = grid();
      if (!g) return;
      g.style.gridTemplateColumns = `repeat(${t.cols}, 1fr)`;
      g.style.gridTemplateRows = `repeat(${t.rows}, 1fr)`;
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
          b.innerHTML = (sym ? `<span class="ab-sym">${sym}</span>` : '')
            + `<span class="ab-word">${escapeHtml(cell.word)}</span>`;
          // pointerdown, and it stops there: a tap IS this card, and letting it bubble would
          // let a global pointer binding ALSO fire a generic select — the same card chosen
          // twice, or worse, a different one. The private build hit this and says so.
          b.addEventListener('pointerdown', (e) => { e.stopPropagation(); choose(i); });
        }
        g.append(b);
        cardEls.push(b);
      }
      setUnit();
      paint();
    }

    function paint() {
      const showOne = cfg.reveal === 'one' && !!scan;
      cardEls.forEach((b, i) => {
        b.classList.toggle('ab-lit', !!scan && i === lit);
        b.classList.toggle('ab-away', showOne && i !== lit);
      });
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

    function applyConfig() {
      board = boardFor(cfg.boardId);
      lit = 0;
      applyAppearance();
      draw();
      startScan();
    }

    return {
      __probe: () => ({
        boardId: board.id, tier: board.tier, cells: board.cells.length,
        lit, scanning: !!scan, reveal: cfg.reveal,
        words: cardEls.map((b) => b.textContent || ''),
        shown: cardEls.filter((b) => !b.classList.contains('ab-away')).length,
        // Appearance, so a test can assert the palette actually reaches the cards rather than
        // that a config key was set.
        themed: !!mount.querySelector('.aboard.ab-themed'),
        hc: !!mount.querySelector('.aboard.ab-hc'),
      }),

      init() {
        mount.innerHTML = `
          <div class="aboard">
            <div class="ab-grid" data-grid role="group" aria-label="communication board"></div>
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

        state?.subscribe?.(() => {
          cfg = { ...DEFAULTS, ...(state.get() || {}) };
          applyConfig();
        });

        // The board never names its input. `board/next` moves the scanner on, `board/select`
        // takes whatever is lit — so a switch, a key, a dwell or somebody's phone all drive it
        // with no change here. A single-switch setup binds only `board/select` and lets the
        // clock do the advancing.
        bus?.subscribe?.('board/next', () => { if (scan) scan.next(); });
        bus?.subscribe?.('board/select', () => { if (scan) choose(lit); });
      },

      onResize() { setUnit(); },
      onHide() { stopScan(); },
      onShow() { startScan(); },

      destroy() {
        destroyed = true;
        stopScan();
        try { ro?.disconnect(); } catch { /* already gone */ } ro = null;
        if (pressTimer != null) { clearTimer(pressTimer); pressTimer = null; }
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
