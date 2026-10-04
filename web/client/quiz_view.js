// quiz_view.js — THE HOST EVERY ANSWER GAME SHARES (row 2.45): the screen, the voice, the switch,
// the grammar announcement, the points and the score, around `quiz_flow.js`'s engine.
//
// `word_games.js` (row 2.31) is the pattern, and this is that module's factory with the game taken
// out: spelling, simple math and name-that each supply an ADAPTER (what to ask and how to judge it)
// and a small VIEW (the picture, the board, the clip), and everything a person meets between them
// — "Is it 7?", the unsure line, the celebration, the shown answer, "Thanks for playing" — is drawn
// by the same code, with the same `.wg` classes as word games, so four games look like one family.
//
// WHAT IT OWNS, each for the reason word_games gives beside the same code:
//   * SAY through `ctx.output.say`, the newest line cancelling one still queued (row 2.27).
//   * *** HOLD WHAT IT WOULD SAY WHILE A CLIP PLAYS. *** Name that person plays a recorded message
//     and then asks who it was. A question read over the person talking is the question nobody
//     hears, so a view can gate speech (`speechGate`) and release it when the clip ends.
//   * THE GRAMMAR (`speech/grammar`), closed when the game is hidden, destroyed, or a clip is
//     playing — a game left open would take every word said in the room, and one open while a
//     clip plays would hear the clip.
//   * POINTS through `points.js` (School), once per question answered right, never for a miss.
//   * THE SCORE through `score_source.js` (row 2.40): published, and drawn here only when no
//     scoreboard on the screen is showing it (`ownScore`, default `auto`).
//   * THE BOARD: an entry game's letters or numbers, scanned by `createScanBoard` on one switch.
//   * *** THE START BUTTON, PAUSE, AND THE DEMO (2026-10-02 late; game_start.js argues them). *** A game
//     that opts in (`spec.startGate`) opens WAITING: a Start button, nothing said, the grammar closed -
//     Mike: "Brain games just starts talking." Any press, a tap, "start" / "play" (the manifest's `voice`),
//     or the bar's Play starts it, unless the panel's `autostart` says it starts by itself. Pause (the
//     bar's button, Space, "pause") silences it and puts up "Go on"; going on asks the question again.
//     While it waits, a game whose adapter can deal a `demo` question shows the computer answering one
//     after another (game_agent.js) - on a SECOND engine that says nothing, pays nothing, rates nothing
//     and reports nothing, so the demo can never touch the person's score, points or ladder.
//   * THE ANSWERS, LIT: in the 'choices' shape (quiz_flow.js `answerBy`) the switch walks the answers
//     themselves, and the tile it is on is outlined (`data-on`) - the tiles a view draws with `data-pick`.

import { createPointsLedger } from './points.js';
import { createScoreSource, ownScoreMode, showOwnScore } from './score_source.js';
import {
  createQuizEngine, createScanBoard, ANSWER_TOPIC, GRAMMAR_TOPIC, FLOW_DEFAULTS,
  esc, fillHtml, defaultChime, STARS, CAT_URL,
} from './quiz_flow.js';
import {
  shouldAutostart, panelAlone, createPlayReporter, demoLimitMs, ensureStartStyle, startOverlayHtml,
} from './game_start.js';
import { gameAgentFor, askAgent } from './game_agent.js';

// How often the computer makes a move in a quiz demo: long enough to read the answer it has lit, quick
// enough that the panel looks alive. Argued, not a setting (nobody's play changes with it).
export const DEMO_STEP_MS = 1500;

export const up = (w) => String(w == null ? '' : w).toUpperCase();

// *** STYLES: ONLY THE THEME'S OWN VARIABLES. *** The shared look is word games' `.wg` rules in
// modules.css; this adds the board, the typed answer, a text card, dots and a clip frame. Injected
// once per document rather than added to modules.css, which other work owns right now.
// The switch cursor rings in the theme's `--scan-ring` (theme.js: 3:1 on every surface in every theme), not
// the raw --link, which is not measured (2026-10-04). It sits on the panel's surfaces, never on an accent, so it
// needs no band; the triangle marker still says "lit" without colour.
const STYLE_ID = 'quiz-games-style';
const CSS = `
.wg[data-quiz]{display:block}
.qz-body{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:2cqmin;min-height:0}
.qz-body > [data-foot]{min-height:0}
.qz-body[data-entry-mode]{grid-template-rows:auto auto minmax(0,1fr)}
.qz-body[data-entry-mode] .wg-mid{grid-template-columns:1fr;justify-items:center;align-content:center;gap:1.5cqmin}
.qz-body[data-entry-mode] .wg-st{justify-items:center;text-align:center}
.qz-body[data-entry-mode] .wg-pic{padding:1.5cqmin}
.qz-body[data-entry-mode] .wg-pic svg{width:clamp(36px,15cqmin,170px)}
@container (min-aspect-ratio: 5/4){
  .qz-body[data-entry-mode]{grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);grid-template-rows:auto minmax(0,1fr)}
  .qz-body[data-entry-mode] > .wg-ask{grid-column:1 / -1}
  .qz-body[data-entry-mode] > [data-foot]{grid-column:2;grid-row:2;align-self:center}
}
.qz-left{display:grid;justify-items:center;min-width:0}
.qz-board{display:grid;gap:1.1cqmin;width:100%}
.qz-row{display:flex;gap:1.1cqmin;justify-content:center;flex-wrap:wrap;align-items:center;
  padding:.5cqmin;border-radius:2cqmin}
.qz-row[data-on="1"]{outline:max(3px,.8cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(1px,.3cqmin)}
.qz-row[data-on="1"]::before{content:"\\25B8";font-weight:800;color:var(--text)}
.qz-key{min-width:max(32px,8cqmin);min-height:max(32px,7.5cqmin);padding:0 1.2cqmin;
  border-radius:1.6cqmin;border:max(2px,.4cqmin) solid var(--border);background:var(--surface);
  color:var(--text);font:800 clamp(13px,4.2cqmin,52px)/1 var(--font);cursor:pointer}
.qz-key[data-cmd],.qz-key[data-rowback]{min-width:max(64px,14cqmin);font-size:clamp(12px,3.2cqmin,38px)}
.qz-key[data-cmd="check"]{border-color:var(--accent)}
.qz-key[data-on="1"]{outline:max(3px,1cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(2px,.5cqmin)}
.qz-key[data-on="1"]::before{content:"\\25B8\\00a0"}
.qz-entry{margin:0;font:800 clamp(20px,8cqmin,96px)/1.1 var(--font);letter-spacing:.16em;text-align:center}
.qz-entry .qz-blank{color:var(--text-soft)}
.qz-card{margin:0;padding:3cqmin 4cqmin;border:max(2px,.5cqmin) solid var(--border);border-radius:3cqmin;
  background:var(--surface);color:var(--text);font:800 clamp(18px,6.5cqmin,76px)/1.15 var(--font);
  text-align:center;max-width:56cqw}
.qz-dots{display:grid;gap:1.2cqmin;justify-items:center}
.qz-dotrow{display:flex;gap:.8cqmin;flex-wrap:wrap;justify-content:center;max-width:44cqw}
.qz-dot{width:clamp(8px,3.2cqmin,32px);aspect-ratio:1;border-radius:50%;background:var(--accent)}
.qz-dot[data-away]{background:none;border:max(2px,.45cqmin) solid var(--accent);box-sizing:border-box}
.qz-media{width:clamp(140px,52cqmin,720px);aspect-ratio:16/9;border-radius:2cqmin;overflow:hidden;
  background:var(--surface);border:max(2px,.5cqmin) solid var(--border);display:grid;place-items:center}
.qz-media video,.qz-media img{width:100%;height:100%;object-fit:contain;display:block}
.qz-media .qz-sound{font:800 clamp(24px,14cqmin,160px)/1 var(--font);color:var(--text-soft)}
.qz-note{margin:0;font-size:clamp(12px,3cqmin,36px);color:var(--text-soft)}
.qz-turn{display:inline-flex;align-items:center;gap:.35em;margin-inline-end:.5em;padding:.1em .55em .1em .15em;
  border-radius:999px;border:max(2px,.4cqmin) solid var(--border);background:var(--surface);color:var(--text);
  font-size:.62em;font-weight:800;vertical-align:middle;white-space:nowrap}
.qz-turn[data-next]{border-style:dashed}
.qz-token{display:inline-grid;place-items:center;width:1.5em;height:1.5em;border-radius:50%;
  background:var(--accent);color:var(--surface);font-weight:800}
.qz-token[data-p="1"]{background:var(--link)}
.qz-token[data-p="2"]{background:var(--text)}
.qz-token[data-p="3"]{background:var(--text-soft)}
.qz-picks{display:flex;flex-wrap:wrap;gap:2cqmin;justify-content:center;align-items:stretch}
.qz-pick{min-width:max(72px,20cqmin);min-height:max(64px,17cqmin);padding:1cqmin 2.5cqmin;border-radius:2.5cqmin;
  border:max(2px,.6cqmin) solid var(--border);background:var(--surface);color:var(--text);
  font:800 clamp(24px,11cqmin,132px)/1.1 var(--font);cursor:pointer}
.qz-pick[data-small]{min-height:max(56px,13cqmin);font-size:clamp(16px,5.5cqmin,66px)}
.qz-dots[data-count] .qz-dot{width:clamp(18px,8cqmin,72px)}
.qz-dots[data-count] .qz-dotrow{gap:2cqmin}
.qz-pick[data-on="1"]{outline:max(3px,1cqmin) solid var(--scan-ring, var(--focus, var(--link)));outline-offset:max(2px,.5cqmin)}
.qz-left-stack{display:grid;gap:2cqmin;justify-items:center}
.qz-things{display:flex;flex-wrap:wrap;gap:1.5cqmin;justify-content:center}
.qz-things .qz-card{font-size:clamp(16px,5.5cqmin,64px);padding:1.5cqmin 3cqmin}
`;
export function ensureQuizStyle(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

/**
 * A quiz module's factory, for `registerModule(manifest, quizModule(spec))`.
 *
 *   spec.type        the module type (and its bus prefix: `<type>/next`, `/select`, ...)
 *   spec.title       shown while loading / when there is nothing to ask
 *   spec.scoreLabel  what a scoreboard reads ("Spelling: right answers")
 *   spec.games       { id: adapter } — see quiz_flow.js for the adapter
 *   spec.defaults    this module's DEFAULTS (flow defaults are underneath)
 *   spec.gameKey     the setting that picks the game ('game'), or null for a one-game module
 *   spec.view        { askHtml, left, leftEl, board, entryHtml, pairHtml, explainHtml, pointNote,
 *                      init, destroy, onHide, onShow, onConfig, onDeal, onReplay, speechGate,
 *                      settingsChoices,
 *                      — added for row 2.45's adaptive games, each optional and absent = unchanged:
 *                      turnHtml(s, cfg)   whose turn it is, drawn in front of the question
 *                      onResult(r, api)   one finished question (quiz_flow.js `onResult`)
 *                      allowAward(p)      false keeps a right answer from paying points
 *                      scoreDetail(s), scoreLine(s)  the published detail / the panel's own line
 *                      onKey(k, api)      a board key carrying `view` (not `key`/`cmd`): the view's own }
 *   spec.extraTopics { next: [...], prev: [...], select: [...], skip: [...] } — more bus topics that
 *                    drive the same moves (Math keeps `algebra/submit` answering as select)
 *   spec.startGate   true: open waiting for Start (the header). Absent = starts at once, as before.
 *   spec.autostart   the module's default for the `autostart` setting (false for a game)
 *
 * A button carrying `data-pick="<value>"` anywhere in the panel answers with that value (a touched
 * tile), through the engine's `answer`, so it is judged exactly like a heard or offered answer.
 */
export function quizModule(spec) {
  const { type, title = type, scoreLabel = `${title}: right answers`, games, defaults = {},
    gameKey = null, extraTopics = {} } = spec;
  const view = spec.view || {};
  const ids = Object.keys(games);
  const gate = spec.startGate === true;
  const autostartDefault = spec.autostart === true;

  return (ctx) => {
    const { mount, bus, state } = ctx;
    const rand = ctx.rand || Math.random;
    let cfg = { ...FLOW_DEFAULTS, ...defaults };
    let ledger = null;
    let score = null;
    let lastSpeech = null;
    let held = [];
    let dead = false;
    let hidden = false;
    let lastKey = '';
    let leftHtml = null;
    // ---- Start, pause and the demo ----
    let begun = false;            // the real game has started (Start, a press, or autostart)
    let paused = false;
    let demoEng = null;           // the demo's own engine (silent, pays nothing, rates nothing)
    let demoGames = null;
    let demoTimer = null;
    let demoSteps = 0;
    let demoRested = false;
    let demoMemory = {};
    let agentNow = null;
    let lastOverlay = null;
    const reportNow = createPlayReporter(bus, ctx);
    const report = (p) => { if (gate) reportNow(p); };
    const reducedMotion = () => {
      if (typeof ctx.reducedMotion === 'boolean') return ctx.reducedMotion;
      try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; }
      catch { return false; }
    };
    const gated = () => { try { return !!view.speechGate?.(); } catch { return false; } };
    const gameOf = (c) => {
      if (!gameKey) return ids[0];
      return ids.includes(c[gameKey]) ? c[gameKey] : (ids.includes(defaults[gameKey]) ? defaults[gameKey] : ids[0]);
    };

    function speakNow(text) {
      if (!text || !ctx.output?.say) return;
      try {
        if (lastSpeech && ctx.output.cancel) ctx.output.cancel(lastSpeech);
        lastSpeech = ctx.output.say(text, { source: type });
      } catch (err) { console.error(`${type}: say`, err); }
    }
    function say(lines) {
      // NOTHING IS SAID BEFORE START, OR WHILE PAUSED. The real engine only runs after Start, so this is
      // the belt to that pair of braces: a paused game's timers move on silently.
      if (!cfg.speak || dead || !begun || paused) return;
      const text = lines.filter(Boolean).join(' ');
      if (!text) return;
      if (gated()) { held.push(text); return; }
      speakNow(text);
    }
    // The clip finished (or failed): say what was held, and open the grammar again.
    function release() {
      if (dead) return;
      const text = held.join(' ');
      held = [];
      if (text && cfg.speak) speakNow(text);
      reannounce();
      render();
    }

    function announceGrammar(g) {
      // Closed before Start and while paused: a waiting game must not take the room's words as answers.
      const closed = hidden || dead || gated() || !begun || paused;
      try {
        bus.publish(GRAMMAR_TOPIC, { source: type, instanceId: ctx.instanceId || null, ...g,
          ...(closed ? { open: false, words: [] } : {}) });
      } catch { /* nobody listening */ }
    }
    function reannounce() {
      const words = engine.grammar();
      announceGrammar({ open: words.length > 0, words, phase: engine.snapshot().phase });
    }

    function award({ amount, game, item, answer }) {
      if (!ledger || !(amount > 0)) return;
      try { if (view.allowAward && view.allowAward({ amount, game, item, answer }) === false) return; }
      catch (err) { console.error(`${type}: allowAward`, err); }
      let note = `${game}: ${answer}`;
      try { if (view.pointNote) note = view.pointNote(game, item, answer); } catch { /* keep the plain one */ }
      Promise.resolve(ledger.award({ amount, source: type, type: 'School', tags: [type, game], note }))
        .catch((err) => console.error(`${type}: points`, err));
    }

    function chime() {
      if (!cfg.sound) return;
      const level = Number(ctx.audio?.master?.());
      const lv = Number.isFinite(level) ? level : 1;
      (typeof ctx.chime === 'function' ? ctx.chime : (l) => defaultChime(l, type))(lv);
    }

    const setTimer = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearTimer = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (id) => clearTimeout(id);

    const engine = createQuizEngine({
      games, cfg: () => cfg, rand, say, award, chime,
      onChange: () => render(),
      publishGrammar: (g) => announceGrammar(g),
      onReplay: (item) => view.onReplay?.(item, api),
      onDeal: (item) => view.onDeal?.(item, api),
      onResult: (r) => view.onResult?.(r, api),
      setTimer, clearTimer,
    });

    // The board, for an entry game: rows come from the view for the current question.
    const board = createScanBoard(() => (engine.entryMode() && view.board ? view.board(engine.snapshot(), cfg) : []),
      { mode: () => cfg.boardScan || 'rows' });
    const boardActive = () => engine.snapshot().phase === 'asking' && !!engine.entryMode();

    function handleKey(k) {
      if (!k) return;
      // A key the VIEW owns, not the engine (row 2.45: the word builder's Hint and New letters, the
      // order game's Ready). Absent from every older board, so they are unchanged.
      if (k.view != null) { try { view.onKey?.(k, api); } catch (err) { console.error(`${type}: key`, err); } return; }
      if (k.key != null) engine.type(k.key, 'switch');
      else if (k.cmd) engine.press(k.cmd);
    }
    // ---- START, PAUSE, GO ON --------------------------------------------------------------------------
    function begin() {
      if (begun || dead) return false;
      stopDemo();
      begun = true; paused = false;
      report(true);
      engine.start(gameOf(cfg));
      render();
      return true;
    }
    function pauseGame() {
      if (!begun || paused || dead) return;
      paused = true;
      try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
      lastSpeech = null;
      held = [];
      report(false);
      reannounce();
      render();
    }
    function resumeGame() {
      if (begin()) return;
      if (!paused || dead) return;
      paused = false;
      report(true);
      reannounce();
      engine.press('repeat');      // the question again, if one is waiting
      render();
    }
    // ANY PRESS, waiting or paused, is Start / Go on - and nothing else.
    const gateInput = () => {
      if (!begun) { begin(); return true; }
      if (paused) { resumeGame(); return true; }
      return false;
    };

    // ---- THE DEMO: a second engine, answered by the computer ------------------------------------------
    const demoWanted = () => gate && !begun && !hidden && !dead && cfg.attract !== false && !reducedMotion()
      && typeof games[gameOf(cfg)]?.demo === 'function';
    function stopDemo() {
      if (demoTimer != null) { try { clearTimer(demoTimer); } catch { /* gone */ } demoTimer = null; }
      try { demoEng?.destroy(); } catch { /* gone */ }
      demoEng = null; demoGames = null;
    }
    function startDemo() {
      stopDemo();
      demoRested = false; demoSteps = 0; demoMemory = {};
      if (!demoWanted()) { render(); return; }
      const g = gameOf(cfg);
      const A = games[g];
      demoGames = { [g]: { ...A, items: () => {
        let it = null;
        try { it = A.demo(rand); } catch (err) { console.error(`${type}: demo`, err); }
        return it ? [it] : [];
      } } };
      // Its own engine: no say, no award, no chime, no grammar, no result - the defaults are all nothing.
      demoEng = createQuizEngine({ games: demoGames, rand, setTimer, clearTimer, onChange: () => render(),
        cfg: () => ({ ...cfg, answerBy: 'choices', twoSwitch: 'scan', sayChoice: false, askAnother: false, speak: false }) });
      agentNow = gameAgentFor(type, 'quiz');
      demoEng.start(g);
      demoTimer = setTimer(demoStep, DEMO_STEP_MS);
      render();
    }
    function demoStep() {
      demoTimer = null;
      if (!demoEng || dead || begun) return;
      demoSteps += 1;
      if (demoSteps * DEMO_STEP_MS >= demoLimitMs(cfg.attractForMs)) { demoRested = true; render(); return; }
      const s = demoEng.snapshot();
      let answer = null;
      try { answer = s.item ? String(demoGames[s.game]?.answer?.(s.item) ?? '') : null; } catch { answer = null; }
      const obs = { game: type, kind: 'quiz', t: demoSteps * DEMO_STEP_MS, actions: ['next', 'select', 'pick'],
        state: { phase: s.phase, question: s.askLine, choices: (s.candidates || []).map(String), highlight: s.highlight, answer } };
      const a = askAgent(agentNow, obs, { rand, memory: demoMemory });
      if (a?.act === 'next') demoEng.next();
      else if (a?.act === 'select') demoEng.select();
      else if (a?.act === 'pick' && a.value != null) demoEng.answer(String(a.value), 'touch');
      if (demoEng) demoTimer = setTimer(demoStep, DEMO_STEP_MS);
    }

    const onNext = () => { if (gateInput()) return; if (boardActive()) { board.next(); render(); } else engine.next(); };
    const onPrev = () => { if (gateInput()) return; if (boardActive()) { board.prev(); render(); } else engine.prev(); };
    const onSelect = () => {
      if (gateInput()) return;
      if (!boardActive()) { engine.select(); return; }
      const k = board.select();
      if (k) handleKey(k); else render();
    };

    const api = {
      engine, cfg: () => cfg, render: () => render(), release, reannounce,
      dropHeld: () => { held = []; },
      setTimer, clearTimer, bus, ctx, mount, rand,
      begun: () => begun, paused: () => paused, start: () => begin(),
    };

    function ensureSkeleton() {
      if (mount.querySelector('[data-quiz-root]')) return;
      // `.wg` is the size container (word games' rules); the grid is one level in, so it can ask
      // the container how wide it is and put a letter board beside the word rather than under it.
      mount.innerHTML = `<div class="wg gs-host" data-quiz-root data-quiz="${esc(type)}"><div class="qz-body" data-body>
        <h2 class="wg-ask" data-ask></h2>
        <div class="wg-mid" data-mid><div class="qz-left" data-left hidden></div><div class="wg-st" data-st aria-live="polite"></div></div>
        <div data-foot></div></div><div data-extra></div><div data-start-host hidden></div></div>`;
    }
    // The Start / Go on overlay, over whatever is showing (the demo, or the still first screen).
    function paintOverlay(root) {
      const host = root.querySelector('[data-start-host]');
      if (!host) return;
      const html = !gate || (begun && !paused) ? ''
        : paused ? startOverlayHtml({ label: 'Go on', text: 'Paused.' })
          : startOverlayHtml({ demo: !!demoEng && !demoRested });
      if (html !== lastOverlay) { host.innerHTML = html; lastOverlay = html; host.hidden = !html; }
      root.dataset.started = begun ? '1' : '0';
      root.dataset.paused = paused ? '1' : '0';
      root.dataset.demo = !begun && demoEng && !demoRested ? '1' : '0';
    }

    const q = (w) => `<q>${esc(w)}</q>`;
    const btn = (s, i, on) => `<button type="button" class="wg-btn" data-act="${esc(s.act)}" data-stop="${i}"${on ? ' data-on="1"' : ''}>${
      s.heard ? `${esc(s.label)}, <q>${esc(s.heard)}</q>` : esc(s.label)}</button>`;
    const btns = (s, hl) => `<div class="wg-btns">${s.map((x, i) => btn(x, i, i === hl)).join('')}</div>`;
    const hintP = (hint) => `<p class="wg-hint" data-hint>${fillHtml(cfg.hintLine, { hint: esc(hint) })}</p>`;

    function boardHtml(s) {
      const rows = (view.board ? view.board(s, cfg) : []).filter((r) => Array.isArray(r) && r.length);
      const b = board.snapshot();
      let flat = 0;
      return `<div class="qz-board" data-board data-scan="${b.mode}">${rows.map((row, ri) => {
        const rowOn = b.mode === 'rows' && b.level === 'rows' && b.row === ri;
        const entered = b.mode === 'rows' && b.level === 'keys' && b.row === ri;
        const keys = row.map((k, ci) => {
          const on = b.mode === 'keys' ? b.index === flat : (entered && b.col === ci);
          flat += 1;
          const attr = k.key != null ? `data-letter="${esc(k.key)}"` : `data-cmd="${esc(k.cmd)}"`;
          return `<button type="button" class="qz-key" ${attr} data-k="${ri}.${ci}"${on ? ' data-on="1"' : ''}>${esc(k.label)}</button>`;
        }).join('');
        const back = entered ? `<button type="button" class="qz-key" data-rowback${b.col >= row.length ? ' data-on="1"' : ''}>Back</button>` : '';
        return `<div class="qz-row" data-row="${ri}"${rowOn ? ' data-on="1"' : ''}>${keys}${back}</div>`;
      }).join('')}</div>`;
    }

    function scoreHtml(s) {
      if (!begun) return '';           // the demo's "right answers" are not anybody's
      const own = showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      if (!own) return '';
      const line = view.scoreLine ? String(view.scoreLine(s, cfg) || '') : `${s.rightCount} right so far.`;
      return `<p class="wg-count" data-score>${esc(line)}</p>`;
    }

    function render() {
      if (dead) return;
      ensureSkeleton();
      // Waiting for Start with a demo running: the demo's engine is what is drawn. Never scored.
      const E = !begun && demoEng ? demoEng : engine;
      const s = E.snapshot();
      if (begun) {
        try {
          const detail = view.scoreDetail ? String(view.scoreDetail(s, cfg) || '')
            : (s.asked ? `${s.rightCount} of ${s.asked}` : '');
          score?.set(s.rightCount, { detail });
        } catch (err) { console.error(`${type}: score`, err); }
      }
      // A new question or a new phase starts the board over, at the top.
      const key = `${s.serial}:${s.phase}`;
      if (key !== lastKey) { lastKey = key; board.reset(); }

      const root = mount.querySelector('[data-quiz-root]');
      const askEl = root.querySelector('[data-ask]');
      const midEl = root.querySelector('[data-mid]');
      const leftEl = root.querySelector('[data-left]');
      const stEl = root.querySelector('[data-st]');
      const footEl = root.querySelector('[data-foot]');
      const extraEl = root.querySelector('[data-extra]');
      root.dataset.state = s.phase;
      root.dataset.game = s.game || '';
      root.dataset.motion = reducedMotion() ? 'reduce' : 'full';
      const body = root.querySelector('[data-body]');
      // `data-entry-mode`, not `data-entry`: that one is the typed letters' own element.
      if (s.phase === 'asking' && s.entryMode) body.dataset.entryMode = s.entryMode; else delete body.dataset.entryMode;

      const stops = E.stops();
      let ask = '';
      let st = '';
      let foot = '';
      let extra = '';
      const questionPhase = s.phase === 'asking' || s.phase === 'unsure' || s.phase === 'twoMiss';

      // THE LEFT: a picture, a card, dots, or a clip the view manages itself (a <video> must not be
      // rebuilt on every change, or it would restart under the person watching it).
      let showLeft = false;
      if (view.leftEl) {
        try { showLeft = !!view.leftEl(leftEl, s, cfg, api); } catch (err) { console.error(`${type}: left`, err); }
      } else {
        const html = s.item && questionPhase && view.left ? String(view.left(s, cfg) || '') : '';
        if (html !== leftHtml) { leftEl.innerHTML = html; leftHtml = html; }
        showLeft = !!html;
      }
      leftEl.hidden = !showLeft;
      midEl.className = `wg-mid${showLeft ? '' : ' wg-one'}`;
      // THE LIT ANSWER ('choices'): the tile the switch is on, outlined. Set on the live tiles, so a view's
      // cached markup is not rebuilt for every step of the switch.
      const pickTiles = [...leftEl.querySelectorAll('[data-pick]')];
      for (const el of pickTiles) {
        const on = s.phase === 'asking' && s.lit != null && el.dataset.pick === String(s.lit);
        if ((el.dataset.on === '1') !== on) { if (on) el.dataset.on = '1'; else delete el.dataset.on; }
      }
      const tilesShowPicks = s.offers === 'choices' && pickTiles.length > 0;

      if (!s.item) {
        ask = esc(title);
        const text = s.phase === 'loading' ? 'Getting ready…' : (s.feedback?.text || '');
        st = text ? `<p class="wg-say wg-soft" data-${esc(s.phase)}>${esc(text)}</p>` : '';
      } else if (s.phase === 'asking') {
        ask = view.askHtml ? view.askHtml(s, cfg) : esc(s.askLine);
        const f = s.feedback;
        const fb = !f ? (s.voiceSeen ? '<p class="wg-say wg-soft">Say your answer.</p>' : '')
          : f.kind === 'wrong'
            ? `<p class="wg-say" data-feedback="wrong">${f.via === 'voice'
              ? fillHtml(cfg.wrongLine, { heard: q(f.heard) }) : esc(f.text)}</p>${f.hint ? hintP(f.hint) : ''}`
            : f.kind === 'hint' ? hintP(f.hint)
              : `<p class="wg-say" data-feedback="${esc(f.kind)}">${esc(f.text)}</p>`;
        st = `${fb}${s.entryMode && view.entryHtml ? view.entryHtml(s, cfg) : ''}`;
        if (s.entryMode) {
          foot = `<div class="wg-foot qz-foot">${boardHtml(s)}</div>`;
        } else if (s.offers === 'choices') {
          // The answers are the stops. Drawn as the view's own tiles when it has them (lit above), else as
          // buttons here; either way a tap answers through `data-pick`.
          const lead = s.voiceSeen ? 'Or step through them with your switch.' : 'Say it, tap it, or step through with your switch.';
          const shown = stops.map((x, i) => [x, i]).filter(([x]) => !(tilesShowPicks && x.act === 'pick'));
          const html = shown.map(([x, i]) => (x.act === 'pick'
            ? `<button type="button" class="wg-btn" data-pick="${esc(x.value)}" data-stop="${i}"${i === s.highlight ? ' data-on="1"' : ''}>${esc(x.label)}</button>`
            : btn(x, i, i === s.highlight))).join('');
          foot = `<div class="wg-foot"><span>${lead}</span>${html ? `<div class="wg-btns">${html}</div>` : ''}</div>`;
        } else {
          const lead = s.voiceSeen ? 'Or press your switch.' : 'Press your switch, or tap.';
          const offer = s.candLine ? ` <b data-offer-line>${esc(s.candLine)}</b>` : '';
          foot = `<div class="wg-foot"><span>${lead}${offer}</span>${btns(stops, s.highlight)}</div>`;
        }
      } else if (s.phase === 'unsure') {
        ask = view.askHtml ? view.askHtml(s, cfg) : esc(s.askLine);
        const line = s.unsure.reason
          ? fillHtml(cfg.unsureLine, { heard: q(s.unsure.heard), reason: esc(s.unsure.reason) })
          : fillHtml(cfg.unsureNoReasonLine, { heard: q(s.unsure.heard) });
        st = `<p class="wg-say" data-unsure>${line}</p>${btns(stops, s.highlight)}`;
      } else if (s.phase === 'twoMiss') {
        ask = view.askHtml ? view.askHtml(s, cfg) : esc(s.askLine);
        const f = s.feedback;
        const wrong = f ? `<p class="wg-say wg-soft" data-feedback="wrong">${f.via === 'voice'
          ? fillHtml(cfg.wrongLine, { heard: q(f.heard) }) : esc(f.text)}</p>` : '';
        st = `${wrong}<p class="wg-say" data-offer>${esc(cfg.twoMissLine)}</p>${btns(stops, s.highlight)}`;
      } else if (s.phase === 'celebrate') {
        ask = 'Yes!';
        st = `<div class="wg-right"><div class="wg-ring" data-ring></div>${pairHtml(s)}<p class="wg-say wg-soft">${explainHtml(s)}</p>${scoreHtml(s)}</div>`;
        extra = STARS.map(([l, t], i) => `<span class="wg-star" style="left:${l}%;top:${t}%;animation-delay:${i * 60}ms"></span>`).join('')
          + `<img class="wg-cat" src="${CAT_URL}" alt="">`;
      } else if (s.phase === 'gentle') {
        ask = esc(s.feedback?.text || '');
        st = `<div class="wg-right" data-gentle>${pairHtml(s)}${btns(stops, s.highlight)}</div>`;
      } else if (s.phase === 'answer') {
        // The revealed answer, up for `answerMs`; the next question follows by itself (no "another one?").
        ask = view.askHtml ? view.askHtml(s, cfg) : esc(s.askLine);
        st = `<div class="wg-right">${pairHtml(s)}<p class="wg-say wg-soft" data-revealed>${explainHtml(s)}</p>${scoreHtml(s)}</div>`;
      } else if (s.phase === 'another') {
        // "Would you like to do another one?" - only with the `askAnother` setting on (off by default).
        // A revealed answer stays on screen above it.
        ask = esc(cfg.anotherLine);
        const shown = s.revealed && s.pair
          ? `${pairHtml(s)}<p class="wg-say wg-soft" data-revealed>${explainHtml(s)}</p>` : '';
        st = `<div class="wg-right" data-another>${shown}${btns(stops, s.highlight)}${scoreHtml(s)}</div>`;
      } else if (s.phase === 'done') {
        ask = esc(cfg.doneLine);
        st = `<div class="wg-right">${scoreHtml(s)}${btns(stops, s.highlight)}</div>`;
      }
      let turn = '';
      try { turn = view.turnHtml ? String(view.turnHtml(s, cfg) || '') : ''; }
      catch (err) { console.error(`${type}: turn`, err); }
      askEl.innerHTML = turn + ask;
      stEl.innerHTML = st;
      footEl.innerHTML = foot;
      extraEl.innerHTML = extra;
      paintOverlay(root);
    }

    function explainHtml(s) {
      if (view.explainHtml) return view.explainHtml(s, cfg);
      return esc(s.pair?.explain || '');
    }
    function pairHtml(s) {
      if (!s.pair) return '';
      if (view.pairHtml) return view.pairHtml(s, cfg);
      return `<div class="wg-pair" data-pair>${esc(up(s.pair.answer))}</div>`;
    }

    return {
      __engine: engine,
      __board: board,
      __probe: () => engine.snapshot(),
      __api: api,
      // Start, pause and the demo, for the suites.
      __gate: () => ({ begun, paused, demo: !!demoEng, demoRested, demoSteps, agent: agentNow?.id || null,
        demoSnap: demoEng ? demoEng.snapshot() : null }),
      hear: (result) => { if (begun && !paused) engine.hear(result); },
      init() {
        ensureQuizStyle(mount.ownerDocument || (typeof document !== 'undefined' ? document : null));
        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error(`${type}: no points ledger`, err); }
        score = createScoreSource(bus, { source: type, label: scoreLabel, instance: ctx.instanceId || null,
          onShownChange: () => render() });
        const onSkip = () => { if (gateInput()) return; engine.skip(); };
        bus.subscribe(`${type}/next`, onNext);
        bus.subscribe(`${type}/prev`, onPrev);
        bus.subscribe(`${type}/select`, onSelect);
        bus.subscribe(`${type}/skip`, onSkip);
        // Pause / Play (the bar's button, Space, "pause" / "play" / "start" - actions.js maps the verbs here).
        // `/resume` and not `/play`: `/play` already names a game ("play brain games").
        bus.subscribe(`${type}/pause`, () => pauseGame());
        bus.subscribe(`${type}/resume`, () => resumeGame());
        const moves = { next: onNext, prev: onPrev, select: onSelect, skip: onSkip };
        for (const [move, topics] of Object.entries(extraTopics || {})) {
          if (!moves[move]) continue;
          for (const t of (Array.isArray(topics) ? topics : [topics])) if (t) bus.subscribe(t, moves[move]);
        }
        if (gameKey) {
          // "Play brain games" said aloud, or a switch bound to it: that game, and - waiting for Start - it
          // starts, because asking for a game by name IS pressing Start.
          bus.subscribe(`${type}/play`, (p) => {
            const g = typeof p === 'string' ? p : p?.[gameKey] ?? p?.game;
            if (!ids.includes(g)) return;
            if (!begun) { state?.set?.({ [gameKey]: g }); cfg = { ...cfg, [gameKey]: g }; begin(); return; }
            if (paused) resumeGame();
            if (engine.setGame(g)) state?.set?.({ [gameKey]: g });
          });
        }
        bus.subscribe(ANSWER_TOPIC, (r) => { if (begun && !paused) engine.hear(r); });
        mount.addEventListener('click', (e) => {
          // Waiting or paused: a press anywhere on it (Start, Go on, a demo tile) starts or goes on.
          if (gate && (!begun || paused) && mount.contains(e.target)) { gateInput(); return; }
          const a = e.target.closest?.('button[data-act]');
          if (a) { engine.press(a.dataset.act); return; }
          const p = e.target.closest?.('button[data-pick]');
          if (p) { engine.answer(p.dataset.pick, 'touch'); return; }
          const k = e.target.closest?.('button[data-k]');
          if (k) {
            const [ri, ci] = k.dataset.k.split('.').map(Number);
            const rows = view.board ? view.board(engine.snapshot(), cfg) : [];
            handleKey(rows?.[ri]?.[ci]);
          }
        });
        try { view.init?.(api); } catch (err) { console.error(`${type}: view init`, err); }
        if (gate) ensureStartStyle(mount.ownerDocument || (typeof document !== 'undefined' ? document : null));
        let configured = false;
        const apply = (snap) => {
          const prevGame = gameOf(cfg);
          const prevCfg = cfg;
          cfg = { ...FLOW_DEFAULTS, ...defaults, ...(snap || {}) };
          try { view.onConfig?.(cfg, prevCfg, api); } catch (err) { console.error(`${type}: config`, err); }
          if (!configured) return;                 // the first settings: whether it starts is decided below
          const g = gameOf(cfg);
          // Still waiting for Start: the demo follows the game picked and "While nobody is playing".
          if (!begun) {
            if (g !== prevGame || prevCfg.attract !== cfg.attract || !!demoEng !== demoWanted()) startDemo(); else render();
            return;
          }
          if (g !== prevGame && g !== engine.game()) engine.setGame(g);
          else render();
        };
        if (state?.subscribe) state.subscribe(apply);
        configured = true;
        // OPENS WAITING FOR START (a game that opts in), unless the panel starts by itself (game_start.js).
        if (!gate || shouldAutostart(cfg, { fallback: autostartDefault, alone: panelAlone(ctx) })) begin();
        else { report(false); startDemo(); }
      },
      onResize() {},
      onHide() {
        hidden = true;
        if (!begun) stopDemo();
        reannounce(); state?.flush?.(); try { view.onHide?.(api); } catch { /* noop */ }
      },
      onShow() {
        hidden = false;
        if (!begun && !demoRested) startDemo();
        reannounce(); try { view.onShow?.(api); } catch { /* noop */ }
      },
      settingsChoices: () => (view.settingsChoices ? view.settingsChoices() : {}),
      destroy() {
        dead = true;
        stopDemo();
        reannounce();
        engine.destroy();
        try { view.destroy?.(api); } catch { /* gone */ }
        try { if (lastSpeech && ctx.output?.cancel) ctx.output.cancel(lastSpeech); } catch { /* gone */ }
        lastSpeech = null;
        held = [];
        try { score?.destroy(); } catch { /* gone */ }
        score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ }
        ledger = null;
      },
    };
  };
}
