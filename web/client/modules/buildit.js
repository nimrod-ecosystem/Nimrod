// modules/buildit.js — BUILD IT: SEE A FINISHED MODEL, BUILD THE SAME (2026-10-09).
//
// Mike, 2026-10-09: "We should have a building game where you can see the finished product and you have to build it."
// The levels, the models and the choices are ../build_it.js (argued there: choose the next part from two or three at
// the easy levels, build it in the brick builder at the harder ones, checked after every change); the drawing and
// the builder are ../brick_builder.js and ../brick_builder_view.js; this file is the panel.
//
// *** ONE SWITCH AT THE EASY LEVELS (argued). *** The choices light in turn by themselves (`lightMs`, 2 s by default,
// never faster than the screen's flash limit) and a press takes the lit one. Two switches: next / previous move the
// light and select takes it. A tap or a click takes any choice. FOR the light moving by itself: one switch is why the
// choosing exists. AGAINST: a light that moves asks a person to wait for it; "The choices light in turn: only when
// pressed" is one setting away, and the pointer never waits.
//
// *** NOTHING BLOCKS, AND NOTHING NAGS. *** It waits for Start (game_start.js; a still picture of the first model,
// no demo -- a computer building a model one part at a time is not a demo anybody needs, so no row offers one). A
// wrong choice says so and is not offered again; nothing is lost. A built model says "Built it!" and the next one
// comes up by itself after REST_MS (a press skips it). A GAME NOBODY IS PLAYING COMES TO REST: IDLE_MS with no press
// and the light stops; the next press wakes it (and only wakes it: it does not take whatever happened to be lit).
//
// THE SCORE is models built this game (score_source.js). EACH MODEL BUILT PAYS `buildPoints` Play points (1 by
// default): FOR, every model is built by presses -- nothing builds itself. AGAINST: at level 1 it is two presses a
// point. 0 turns it off. Being played: game_start.js createPlayWatch.

import { registerModule } from '../module.js';
import { createScoreSource, ownScoreField, ownScoreMode, showOwnScore } from '../score_source.js';
import { createPointsLedger } from '../points.js';
import { createGameTones } from '../game_tones.js';
import { flashLimit, minFlashPeriodMs } from '../flash_limit.js';
import {
  autostartFields, shouldAutostart, panelAlone, createPlayWatch, START_VOICE, ensureStartStyle, startOverlayHtml, START_LINES,
} from '../game_start.js';
import { GRID, buildSvg, matchBuilds, settle, newBuild } from '../brick_builder.js';
import { mountBuilderView, handWords } from '../brick_builder_view.js';
import { LEVELS, LEVEL_IDS, levelOf, targetsFor, modeFor, choicesFor, nextNeeded, buildOrder } from '../build_it.js';

export const GAME = 'buildit';
export const TITLE = 'Build it';
export const SCORE_LABEL = 'Build it: models built';
// A game nobody is pressing comes to rest after this long: brick drop's 45 s, for the same reasons (longer than anybody
// thinking about one choice, short enough that an empty room does not watch a light go round). [On the report's list.]
export const IDLE_MS = 45000;
// "Built it!" stays this long before the next model: long enough to see it finished and read the words.
export const REST_MS = 3500;
// The builder's floor in BUILD mode: 6 x 6 cells, two more than any model here, so it can be built anywhere on it.
export const WORK_FLOOR = 6;
export const VOICE = Object.freeze({ ...START_VOICE });

export const DEFAULTS = Object.freeze({
  autostart: false, autostartAlone: 'same', level: 1, how: 'level', colours: true, lightMs: 2000, sounds: true, buildPoints: 1,
});
const SETTINGS = [
  ownScoreField({ level: 'essential', note: 'Models built this game. A Scoreboard on the same screen can show it instead.' }),
  { key: 'level', label: 'Level', kind: 'choice', default: 1, level: 'essential',
    options: LEVEL_IDS.map((n) => ({ value: n, label: `${LEVELS[n].label}: ${LEVELS[n].parts[0]} to ${LEVELS[n].parts[1]} parts` })),
    note: 'Starts with the next model.' },
  { key: 'how', label: 'How you build', kind: 'choice', default: 'level', level: 'essential',
    options: [
      { value: 'level', label: 'As the level says (choose at Easy and Gentle, build from Medium)' },
      { value: 'choose', label: 'Choose the next part from two or three (one switch)' },
      { value: 'build', label: 'Build it in the brick builder' },
    ] },
  ...autostartFields({ on: false }),
  { key: 'colours', label: 'Colors must match', default: true, level: 'standard', onLabel: 'Yes', offLabel: 'No, only the shape' },
  { key: 'lightMs', label: 'The choices light in turn', kind: 'choice', default: 2000, level: 'standard',
    options: [{ value: 1000, label: 'Every second' }, { value: 2000, label: 'Every 2 seconds' }, { value: 3000, label: 'Every 3 seconds' },
      { value: 5000, label: 'Every 5 seconds' }, { value: 0, label: 'Only when pressed (next / previous)' }],
    note: 'Never faster than the screen\'s flashing limit.' },
  { key: 'sounds', label: 'Sounds', default: true, level: 'standard', onLabel: 'On', offLabel: 'Off' },
  { key: 'buildPoints', label: 'Play points for each model built', kind: 'number', default: 1, min: 0, max: 20, step: 1,
    level: 'advanced', note: '0 means models pay nothing.' },
];
const TONES = { right: [523, 120, 'triangle'], wrong: [196, 160, 'sine'], built: [784, 320, 'triangle'] };

const STYLE_ID = 'buildit-style';
const CSS = `
.bi-wrap{width:100%;height:100%;min-height:0;color:var(--text);outline:none;container-type:size}
.bi-wrap:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px}
.bi-wrap *{box-sizing:border-box}
.bi{height:100%;display:grid;gap:.4rem;padding:.5rem;font-family:var(--font);grid-template-columns:minmax(0,1fr);
  grid-template-rows:minmax(0,.8fr) minmax(0,1.6fr) auto}
@container (min-aspect-ratio: 4/3){ .bi{grid-template-columns:minmax(0,1fr) minmax(0,2fr);grid-template-rows:minmax(0,1fr) auto}
  .bi-bar{grid-column:1 / span 2} }
.bi [hidden]{display:none !important}
.bi-target{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border:2px solid var(--border, #8a8470);border-radius:12px;background:var(--surface);padding:.3rem}
.bi-lab{margin:0;font-weight:800;color:var(--text-strong, var(--text))}
.bi-pic{position:relative;min-height:0}
.bi-pic>svg,.bi-choice>svg{position:absolute;inset:0;width:100%;height:100%}
.bi-work{min-height:0;position:relative}
.bi-choices{height:100%;display:grid;gap:.5rem;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
.bi-choice{position:relative;min-height:6rem;border-radius:12px;border:3px solid var(--border, #8a8470);background:var(--surface);cursor:pointer;padding:0}
.bi-choice[data-lit="1"]{outline:5px solid var(--scan-ring, var(--focus, currentColor));outline-offset:3px;box-shadow:0 0 0 3px var(--surface)}
.bi-choice[data-tried]{opacity:.4;cursor:default}
.bi-choice .bi-num{position:absolute;left:.4rem;top:.3rem;font:800 1.1rem/1 var(--font);color:var(--text-strong, var(--text))}
.bi-choice .bi-no{position:absolute;left:0;right:0;bottom:.3rem;text-align:center;font-weight:800;color:var(--text-strong, var(--text))}
.bi-bar{display:flex;flex-wrap:wrap;gap:.2rem 1.2rem;align-items:baseline;justify-content:center;min-height:2.2em}
.bi-say{margin:0;font-size:clamp(15px, 2.4vmin, 28px);font-weight:600;color:var(--text-strong, var(--text))}
.bi-score{margin:0;font-size:clamp(14px, 2.1vmin, 24px)}
`;
function ensureStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

/** "3 of 5 parts are right" -- the line under a model being built, from matchBuilds. Pure. */
export function progressWords(m) {
  if (!m) return '';
  if (m.same) return 'Built it!';
  const extra = m.extra > 0 ? `, and ${m.extra} part${m.extra === 1 ? '' : 's'} that ${m.extra === 1 ? 'is' : 'are'} not in it` : '';
  return `${m.right} of ${m.total} part${m.total === 1 ? '' : 's'} ${m.right === 1 ? 'is' : 'are'} right${extra}.`;
}

registerModule(
  { type: GAME, title: TITLE, core: 'new',
    description: 'See a finished model of Nimrod bricks and build the same. At the easy levels, choose the next part '
      + 'from two or three and it snaps into place (one switch can play); at the harder ones, build it yourself.',
    dependsOn: 'local', importance: 'optional', settings: SETTINGS, voice: VOICE },
  (ctx) => {
    const { mount, bus, state } = ctx;
    const audio = ctx.audio || null;
    const rand = ctx.rand || Math.random;
    const setT = typeof ctx.setTimer === 'function' ? ctx.setTimer : (fn, ms) => setTimeout(fn, ms);
    const clearT = typeof ctx.clearTimer === 'function' ? ctx.clearTimer : (h) => clearTimeout(h);
    const doc = mount.ownerDocument || (typeof document !== 'undefined' ? document : null);
    const plays = createPlayWatch(bus, ctx);

    let cfg = { ...DEFAULTS };
    let started = false, dead = false, hidden = false, idle = true, armed = false;
    let level = 1, targets = [], ti = 0, target = null, mode = 'choose';
    let attempt = [];          // choose mode: the parts put so far
    let choices = [], lit = -1;
    let phase = 'play';        // 'play' | 'built'
    let built = 0;             // models built this game
    let news = '';
    let lightTimer = null, idleTimer = null, restTimer = null;
    let view = null;           // build mode: the brick builder
    let lastMatch = null;
    let rootEl = null, targetEl = null, targetWords = null, workEl = null, sayEl = null, scoreEl = null, overlayEl = null;
    let score = null, ledger = null, tones = null;
    const offs = [];

    // ---- timers ----------------------------------------------------------------------------------------------
    const lightStep = () => {
      const v = Number(cfg.lightMs);
      return v > 0 ? Math.max(v, minFlashPeriodMs(flashLimit(ctx))) : 0;
    };
    const clear = (h) => { if (h != null) { try { clearT(h); } catch { /* gone */ } } return null; };
    function stopLight() { lightTimer = clear(lightTimer); }
    function armLight() {
      stopLight();
      if (dead || hidden || !started || idle || phase !== 'play' || mode !== 'choose' || !choices.length || !(lightStep() > 0)) return;
      lightTimer = setT(() => { lightTimer = null; moveLight(1, { auto: true }); armLight(); }, lightStep());
    }
    function armIdle() {
      idleTimer = clear(idleTimer);
      if (dead || !started) return;
      idleTimer = setT(() => { idleTimer = null; idle = true; stopLight(); plays.rest(); tones?.setActive(false); render(); }, IDLE_MS);
    }

    // ---- the game ----------------------------------------------------------------------------------------------
    function sound(ev) { if (cfg.sounds && armed && tones) { const t = TONES[ev]; if (t) tones.tone(t[0], t[1], { type: t[2], level: 0.6 }); } }
    function save() { try { state?.set?.({ stats: { built } }); } catch { /* fine */ } }

    function loadTarget() {
      targets = targetsFor(level);
      ti = ((ti % targets.length) + targets.length) % targets.length;
      target = targets[ti];
      mode = modeFor(level, cfg.how);
      attempt = [];
      phase = 'play';
      lastMatch = null;
      news = '';
      if (mode === 'choose') {
        if (view) { view.destroy(); view = null; }
        newChoices();
      } else {
        choices = []; lit = -1;
        mountBuilder();
      }
      render();
    }
    function newChoices() {
      const n = (LEVELS[level] || LEVELS[1]).choices;
      choices = choicesFor(target, attempt, n, rand, { colours: cfg.colours !== false }).map((c) => ({ ...c, tried: false }));
      // Nothing is lit while it waits for Start: Start is the one thing a press presses then (game_start.js).
      lit = started && lightStep() > 0 ? 0 : -1;
      armLight();
    }
    function mountBuilder() {
      if (!workEl) return;
      if (view) view.destroy();
      const first = nextNeeded(target, [], { colours: cfg.colours !== false });
      view = mountBuilderView(workEl, {
        doc,
        build: newBuild({ name: target.name, floorCells: WORK_FLOOR }),
        hand: first ? { part: first.part, w: first.w, l: first.l, h: first.h, rot: first.rot, colour: first.colour } : undefined,
        hide: ['floor+', 'floor-'],
        extraHtml: '<div class="bb-row" data-group="help"><button type="button" class="bb-btn" data-act="nextPart">Give me the next part</button></div>',
        onAct: (act) => {
          if (act !== 'nextPart') return false;
          const t = nextNeeded(target, view.editor.get().parts, { colours: cfg.colours !== false });
          if (!t) { view.tell('You have every part it needs. Look at where they go.'); return true; }
          view.editor.setHand({ part: t.part, w: t.w, l: t.l, h: t.h, rot: t.rot, colour: t.colour });
          view.tell(`In your hand: ${handWords(view.editor.hand())}.`);
          return true;
        },
        onPress: () => { if (started) markInput(); },
        onChange: (b) => checkBuilt(b.parts),
      });
    }
    function checkBuilt(parts) {
      if (phase !== 'play' || !target) return;
      lastMatch = matchBuilds(target.parts, parts, { colours: cfg.colours !== false, turns: true });
      if (lastMatch.same) finished();
      else { news = progressWords(lastMatch); view?.tell(news); render(); }
    }
    function finished() {
      phase = 'built';
      built += 1;
      news = `Built it! ${target.name}.`;
      view?.tell(news);
      stopLight();
      sound('built');
      save();
      pay();
      restTimer = clear(restTimer);
      restTimer = setT(() => { restTimer = null; nextTarget(); }, REST_MS);
      render();
    }
    function nextTarget() {
      if (dead) return;
      restTimer = clear(restTimer);
      ti += 1;
      loadTarget();
    }
    function pay() {
      const per = Math.round(Number(cfg.buildPoints) || 0);
      if (!(per > 0) || !ledger) return;
      Promise.resolve(ledger.award({ amount: per, source: GAME, type: 'Play', tags: [GAME], note: `${TITLE}: ${target.name} built` }))
        .catch((err) => console.error('buildit: points', err));
    }

    // ---- presses -------------------------------------------------------------------------------------------------
    function markInput() {
      const woke = idle;
      idle = false;
      if (!armed) { armed = true; tones?.resume?.(); }
      tones?.setActive(!!cfg.sounds && !hidden);
      plays.active();
      armIdle();
      return woke;
    }
    function startGame() {
      if (dead || started) return false;
      started = true;
      built = 0;
      markInput();
      // The model on the Start screen is the first one to build: it is not dealt again.
      if (!target) loadTarget(); else { if (mode === 'choose' && lightStep() > 0) lit = 0; armLight(); render(); }
      return true;
    }
    function moveLight(dir, { auto = false } = {}) {
      if (mode !== 'choose' || !choices.length) return;
      const open = choices.map((c, i) => (c.tried ? -1 : i)).filter((i) => i >= 0);
      if (!open.length) return;
      const at = open.indexOf(lit);
      lit = open[(at < 0 ? 0 : at + (dir > 0 ? 1 : -1) + open.length) % open.length];
      if (!auto) armLight();
      render();
    }
    function take(i) {
      const c = choices[i];
      if (!c || c.tried || phase !== 'play') return;
      if (c.right) {
        attempt = settle([...attempt, { ...c.part, id: `a${attempt.length + 1}` }]);
        sound('right');
        if (attempt.length >= buildOrder(target.parts).length) { finished(); return; }
        news = 'Yes! That one goes there.';
        newChoices();
      } else {
        c.tried = true;
        sound('wrong');
        news = 'Not that one. Look at the model again.';
        moveLight(1);
      }
      render();
    }
    /** A switch's one press, a tap, Enter: Start first, then a rest skipped, then the lit choice (or the builder's). */
    function select() {
      if (dead) return;
      if (startGame()) return;
      const woke = markInput();
      if (phase === 'built') { nextTarget(); return; }
      if (woke && mode === 'choose') { news = ''; lit = lightStep() > 0 ? lit : -1; armLight(); render(); return; }
      if (mode === 'choose') { if (lit < 0) { moveLight(1); return; } take(lit); return; }
      view?.select();
    }
    function step(dir) {
      if (dead) return;
      if (startGame()) return;
      markInput();
      if (phase === 'built') { nextTarget(); return; }
      if (mode === 'choose') moveLight(dir); else view?.scan(dir);
    }
    function move(act) {
      if (dead || !started) return;
      markInput();
      if (mode === 'build') view?.press(act);
      else if (act === 'left' || act === 'up') moveLight(-1); else moveLight(1);
    }

    function onPointerDown(e) {
      if (dead || !(e.target instanceof Element) || !mount.contains(e.target)) return;
      try { rootEl?.focus?.({ preventScroll: true }); } catch { /* fine */ }
      if (e.target.closest('[data-start]')) { e.preventDefault(); startGame(); return; }
      const ch = e.target.closest('[data-choice]');
      if (ch && started) {
        e.preventDefault();
        const woke = markInput();
        if (phase === 'built') { nextTarget(); return; }
        if (woke) armLight();
        take(Number(ch.dataset.choice));
        return;
      }
      if (!started) { startGame(); return; }
      if (phase === 'built' && !view?.el.contains(e.target)) nextTarget();
    }
    function onKey(e) {
      if (dead || e.repeat) return;
      if (!started && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startGame(); return; }
      if (mode === 'build' && started) return;   // the builder has its own keys
      const k = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (k) { e.preventDefault(); e.stopPropagation(); step(k); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); select(); return; }
      if (/^[1-3]$/.test(e.key) && mode === 'choose' && started) { e.preventDefault(); markInput(); take(Number(e.key) - 1); }
    }

    // ---- drawing -------------------------------------------------------------------------------------------------
    let drawnTarget = '', drawnChoices = '', lastSay = '', lastScore = '';
    function render() {
      if (dead || !rootEl) return;
      const bi = rootEl.querySelector('[data-bi]');
      bi.dataset.mode = mode; bi.dataset.phase = phase; bi.dataset.started = started ? '1' : '0';
      if (overlayEl) {
        overlayEl.hidden = started;
        if (!started && !overlayEl.firstChild) overlayEl.innerHTML = startOverlayHtml({ note: false });
      }
      const tKey = `${target?.id}|${started}`;
      if (target && tKey !== drawnTarget) {
        targetEl.innerHTML = buildSvg(target.parts, { floor: target.floor, sockets: true, title: `${target.name}, ${target.parts.length} parts` });
        targetWords.textContent = `Build this: ${target.name} (${target.parts.length} parts)`;
        drawnTarget = tKey;
      }
      if (mode === 'choose' && workEl) {
        const key = JSON.stringify([target?.id, attempt.length, choices.map((c) => [c.tried, c.part.id, c.part.x, c.part.z, c.part.colour, c.part.w, c.part.h]), lit, phase]);
        if (key !== drawnChoices) {
          if (phase === 'built') {
            workEl.innerHTML = `<div class="bi-choices"><div class="bi-choice" data-done role="img" aria-label="${target.name}, built">${buildSvg(attempt, { floor: target.floor, title: `${target.name}, built` })}</div></div>`;
          } else {
            workEl.innerHTML = `<div class="bi-choices" role="group" aria-label="Which part goes next?">${choices.map((c, i) => {
              const pic = buildSvg([...attempt, { ...c.part, id: 'next' }], { floor: target.floor, focus: 'next', title: `Choice ${i + 1}` });
              return `<button type="button" class="bi-choice" data-choice="${i}" data-lit="${i === lit ? 1 : 0}"${c.tried ? ' data-tried="" aria-disabled="true"' : ''}`
                + ` aria-label="Choice ${i + 1}${c.tried ? ': not this one' : ''}"><span class="bi-num">${i + 1}</span>${pic}${c.tried ? '<span class="bi-no">✕ Not this one</span>' : ''}</button>`;
            }).join('')}</div>`;
          }
          drawnChoices = key;
        }
      } else drawnChoices = '';
      const line = !started ? START_LINES.still
        : idle ? 'Press to play.'
          : news || (mode === 'choose' ? (lightStep() > 0 ? 'Which part goes next? Press when it is lit.' : 'Which part goes next?') : 'Build the same model.');
      if (sayEl && line !== lastSay) { sayEl.textContent = line; lastSay = line; }
      const own = started && showOwnScore(ownScoreMode({ ownScore: cfg.ownScore }), !!score?.shownElsewhere());
      const txt = own ? `Built: ${built} · Level: ${LEVELS[level].label}` : '';
      if (scoreEl && txt !== lastScore) { scoreEl.textContent = txt; scoreEl.hidden = !txt; lastScore = txt; }
      if (started) { try { score?.set(built, { detail: `Level: ${LEVELS[level].label}` }); } catch (err) { console.error('buildit: score', err); } }
    }

    function applyCfg(s) {
      const v = s || {};
      const next = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (v[k] !== undefined) next[k] = v[k];
      next.level = levelOf(next.level);
      if (!['level', 'choose', 'build'].includes(next.how)) next.how = 'level';
      if (v.ownScore !== undefined) next.ownScore = v.ownScore;
      const was = cfg;
      cfg = next;
      const changedGame = was.level !== next.level || was.how !== next.how || was.colours !== next.colours;
      if (changedGame) { level = next.level; ti = 0; loadTarget(); }
      else if (was.lightMs !== next.lightMs) { if (mode === 'choose') { lit = lightStep() > 0 ? Math.max(0, lit) : lit; armLight(); } render(); }
      else render();
    }

    return {
      init() {
        ensureStartStyle(doc);
        ensureStyle(doc);
        mount.innerHTML = '<div class="bi-wrap gs-host" data-bi-root tabindex="0" aria-label="Build it"><div class="bi" data-bi>'
          + '<div class="bi-target"><p class="bi-lab" data-target-words></p><div class="bi-pic" data-target role="img"></div></div>'
          + '<div class="bi-work" data-work></div>'
          + '<div class="bi-bar"><p class="bi-say" role="status" aria-live="polite"></p><p class="bi-score" data-score hidden></p></div>'
          + '</div><div data-start-host hidden></div></div>';
        rootEl = mount.querySelector('[data-bi-root]');
        targetEl = mount.querySelector('[data-target]');
        targetWords = mount.querySelector('[data-target-words]');
        workEl = mount.querySelector('[data-work]');
        sayEl = mount.querySelector('.bi-say');
        scoreEl = mount.querySelector('[data-score]');
        overlayEl = mount.querySelector('[data-start-host]');
        mount.addEventListener('pointerdown', onPointerDown);
        mount.addEventListener('keydown', onKey);
        try { ledger = typeof ctx.makeEvents === 'function' ? createPointsLedger({ makeEvents: ctx.makeEvents, bus }) : null; }
        catch (err) { ledger = null; console.error('buildit: no points ledger', err); }
        score = createScoreSource(bus, { source: GAME, label: SCORE_LABEL, instance: ctx.instanceId || null, onShownChange: () => render() });
        tones = createGameTones({ audio, audioId: `${GAME}:${ctx.instanceId || 'bi'}`, volume: 0.5,
          ...(ctx.makeAudioContext ? { makeContext: ctx.makeAudioContext, fx: null } : {}) });
        const first = state?.get?.() || {};
        cfg = { ...DEFAULTS };
        for (const k of Object.keys(DEFAULTS)) if (first[k] !== undefined) cfg[k] = first[k];
        cfg.level = levelOf(cfg.level);
        if (first.ownScore !== undefined) cfg.ownScore = first.ownScore;
        level = cfg.level;
        loadTarget();
        try { const off = state?.subscribe?.((s) => applyCfg(s)); if (typeof off === 'function') offs.push(off); } catch { /* fine */ }
        const sub = (t, fn) => { try { const off = bus?.subscribe?.(t, fn); if (typeof off === 'function') offs.push(off); } catch { /* no bus */ } };
        sub(`${GAME}/next`, () => step(1));
        sub(`${GAME}/prev`, () => step(-1));
        sub(`${GAME}/select`, () => select());
        sub(`${GAME}/left`, () => move('left'));
        sub(`${GAME}/right`, () => move('right'));
        sub(`${GAME}/up`, () => move('up'));
        sub(`${GAME}/down`, () => move('down'));
        sub(`${GAME}/resume`, () => { if (!startGame()) { markInput(); armLight(); render(); } });
        sub(`${GAME}/pause`, () => { idle = true; stopLight(); plays.pause(); render(); });
        sub(`${GAME}/new`, () => { if (started) { ti += 1; loadTarget(); } });
        if (shouldAutostart(first, { fallback: DEFAULTS.autostart, alone: panelAlone(ctx) })) startGame();
        else { plays.pause(); render(); }
      },
      onResize() { render(); },
      onHide() { hidden = true; stopLight(); tones?.setActive(false); if (started) plays.rest(); try { state?.flush?.(); } catch { /* fine */ } },
      onShow() { hidden = false; armLight(); render(); },
      destroy() {
        dead = true;
        stopLight(); idleTimer = clear(idleTimer); restTimer = clear(restTimer);
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('keydown', onKey);
        for (const off of offs.splice(0)) { try { off(); } catch { /* gone */ } }
        try { view?.destroy(); } catch { /* gone */ } view = null;
        try { plays.destroy(); } catch { /* gone */ }
        try { tones?.destroy(); } catch { /* gone */ } tones = null;
        try { score?.destroy(); } catch { /* gone */ } score = null;
        try { ledger?.destroy?.(); } catch { /* gone */ } ledger = null;
        mount.innerHTML = '';
      },
      __probe: () => ({
        started, idle, level, mode, phase, built, target: target?.id || null, attempt: attempt.length,
        choices: choices.map((c) => ({ right: c.right, tried: c.tried })), lit, news, say: lastSay, playing: plays.playing(),
        lightOn: lightTimer != null, resting: restTimer != null, match: lastMatch, cfg: { ...cfg },
      }),
      __view: () => view,
      __target: () => target,
    };
  },
);

export { LEVELS, GRID };
