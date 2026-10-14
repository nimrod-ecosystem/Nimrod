// brick_builder_view.js — THE BRICK BUILDER ON A PAGE: the model drawn, the part in your hand, and every move as a
// button, a key, a tap and a switch step. The model and the moves are brick_builder.js; this file draws them and
// turns presses into them. Used by the Brick builder (modules/brickbuilder.js) and by Build it (modules/buildit.js).
//
// *** HOW A PERSON BUILDS (one rule for every input, argued). ***
//   There is a CURSOR: one 40 mm cell, ringed. "Put it here" puts the part in your hand on top of whatever is in that
//   cell (things fall down: brick_builder.js). Everything else acts on the part on top at the cursor: Pick up (it goes
//   into your hand, so MOVING a part is pick up, then put down somewhere else), Turn this one, Paint (your colour),
//   Take away. The hand has its part, size, turn and colour.
//   MOUSE: the cursor follows the pointer over the model; a click puts the part there.
//   TOUCH: a tap moves the cursor there; a tap on the same cell again puts the part (or "Put it here").
//   KEYS: the arrows move the cursor, Enter or Space puts, R turns your part, Delete takes away, P picks up,
//         Ctrl+Z / Ctrl+Y undo and redo, [ and ] change the part.
//   A SWITCH (next / previous / select): the light walks every button in order and a press presses the lit one, so
//   every move above is reachable. With nothing lit, select puts the part.
//   AGAINST dragging parts with a pointer: dragging is the hardest thing for a shaky hand and impossible with a switch,
//   and pick up + put down is two presses for everyone. A drag could be added for the mouse later; it is not needed.
//   THE MINIMUM FOR A SWITCH, argued: every action as a stop in one ring, the cursor moved a cell a press. It is slow
//   for a big model (a cell a press, ~20 stops in the ring) and fine for a small one. What would make it quick -- a
//   row-then-column scan over the floor, and "the next free spot" -- is the next step, not this one.

import {
  GRID, COLOURS, HAND_DEFAULT, createEditor, buildSvg, pickAt, specOf, sizeRows, colourCss, normalizeColour, heightAt,
} from './brick_builder.js';

const STYLE_ID = 'brick-builder-style';
const CSS = `
.bb{box-sizing:border-box;width:100%;height:100%;min-height:0;display:block;padding:.5rem;color:var(--text);
  font-family:var(--font);container-type:size;outline:none;
  --bb-edge: var(--border, #8a8470); --bb-floor: var(--surface-alt, #e8e4cf)}
.bb:focus-visible{outline:3px solid var(--focus, currentColor);outline-offset:-3px}
.bb *{box-sizing:border-box}
.bb [hidden]{display:none !important}
@container (min-aspect-ratio: 5/4){ .bb-in{grid-template-columns:minmax(0,1.5fr) minmax(14rem,1fr) !important;grid-template-rows:minmax(0,1fr) auto !important}
  .bb-side{grid-row:1 / span 2;grid-column:2} }
.bb-in{display:grid;gap:.5rem;min-height:0;height:100%;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1.4fr) minmax(0,1fr) auto}
.bb-board{position:relative;min-height:0;touch-action:none;cursor:pointer;border-radius:10px;background:var(--surface)}
.bb-board>svg{position:absolute;inset:0;width:100%;height:100%}
.bb-side{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:.45rem;padding:.1rem}
.bb-row{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}
.bb-row>.bb-lab{flex-basis:100%;margin:.1rem 0 0;font-weight:700;font-size:.95rem;color:var(--text-strong, var(--text))}
.bb-btn{min-height:44px;min-width:44px;padding:.15em .7em;border-radius:10px;border:2px solid var(--bb-edge);background:var(--surface);
  color:var(--text-strong, var(--text));font:700 1rem/1.1 var(--font);cursor:pointer}
.bb-btn[disabled]{opacity:.45;cursor:default}
.bb-btn[data-act="put"]{border-color:var(--accent, var(--bb-edge));border-width:3px;font-size:1.1rem}
.bb-btn[data-lit="1"]{outline:4px solid var(--scan-ring, var(--focus, currentColor));outline-offset:2px;box-shadow:0 0 0 2px var(--surface)}
.bb-sw{width:44px;height:44px;border-radius:10px;border:2px solid var(--bb-edge);background:var(--bk);cursor:pointer;padding:0}
.bb-sw[aria-pressed="true"]{outline:3px solid var(--text-strong, var(--text));outline-offset:2px}
.bb-sw[data-lit="1"]{outline:4px solid var(--scan-ring, var(--focus, currentColor));outline-offset:3px}
.bb-own{display:inline-flex;align-items:center;gap:.3rem;font-weight:600}
.bb-own input{width:44px;height:44px;padding:0;border:2px solid var(--bb-edge);border-radius:10px;background:var(--surface)}
.bb-hand{margin:0;font-weight:700}
.bb-say{margin:0;min-height:1.4em;font-weight:600;color:var(--text-strong, var(--text))}
`;
export function ensureBuilderStyle(doc) {
  if (!doc || doc.getElementById?.(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  (doc.head || doc.documentElement).append(el);
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ROW_WORDS = Object.freeze({
  w: ['Narrower', 'Wider'], l: ['Shorter', 'Longer'], h: ['Lower', 'Taller'],
});
/** "Brick, 80 × 40 × 40 mm, theme colour 2" -- the hand in words. */
export function handWords(hand) {
  const spec = specOf(hand);
  const c = normalizeColour(hand.colour);
  const i = COLOURS.indexOf(c);
  return `${spec.title}${hand.rot ? `, turned ${hand.rot * 90}°` : ''}, ${i >= 0 ? `theme color ${i + 1}` : `your own color`}`;
}

/**
 * mountBuilderView(host, opts) -> view
 *   doc            the document (default host.ownerDocument)
 *   build, hand    where to start
 *   onChange(build, what)   after every change to the model (what: 'put' | 'remove' | ... | 'hand' | 'cursor')
 *   onAct(act, el) a button this view does not know (the host's own, put in `extraHtml`): return true if handled
 *   extraHtml      the host's own rows (buttons with data-act), put at the end of the side
 *   sockets        draw sockets (default true)
 *   hide           acts not to offer (e.g. ['pickUp'] in a game)
 *   onPress()      any press at all (the host's "being played")
 */
export function mountBuilderView(host, opts = {}) {
  const doc = opts.doc || host.ownerDocument || document;
  ensureBuilderStyle(doc);
  const hide = new Set(opts.hide || []);
  let dead = false;
  let lit = -1;
  let say = '';
  let lastSvg = '';
  let inPress = false;
  const ed = createEditor(opts.build || null, {
    hand: opts.hand || HAND_DEFAULT,
    onChange: (b, what) => {
      if (what !== 'cursor' && what !== 'hand') { try { opts.onChange?.(b, what); } catch (err) { console.error('brick builder: onChange', err); } }
      if (!inPress) render();
    },
  });

  const btn = (act, label, extra = '') => (hide.has(act) ? '' : `<button type="button" class="bb-btn" data-act="${act}"${extra}>${label}</button>`);
  host.innerHTML = `<div class="bb" data-bb tabindex="0" aria-label="Brick builder"><div class="bb-in">`
    + '<div class="bb-board" data-board role="img"></div>'
    + '<div class="bb-side" data-side>'
    + '<div class="bb-row" data-group="move"><p class="bb-lab">Where</p>'
    + `${btn('up', '↗ Back', ' aria-label="Move back"')}${btn('left', '↖ Left', ' aria-label="Move left"')}`
    + `${btn('right', '↘ Right', ' aria-label="Move right"')}${btn('down', '↙ Front', ' aria-label="Move to the front"')}`
    + `${btn('put', '⬇ Put it here')}</div>`
    + '<div class="bb-row" data-group="here"><p class="bb-lab">The part here</p>'
    + `${btn('pickUp', 'Pick up')}${btn('turnHere', '↻ Turn this one')}${btn('paint', 'Paint it')}${btn('remove', 'Take away')}</div>`
    + '<div class="bb-row" data-group="hand"><p class="bb-lab">In your hand: <span class="bb-hand" data-hand></span></p>'
    + `${btn('partPrev', '◀ Part')}${btn('partNext', 'Part ▶')}${btn('turn', '↻ Turn')}`
    + ['w', 'l', 'h'].map((r) => `${btn(`${r}-`, ROW_WORDS[r][0])}${btn(`${r}+`, ROW_WORDS[r][1])}`).join('') + '</div>'
    + `<div class="bb-row" data-group="colour"><p class="bb-lab">Color</p>${hide.has('colour') ? '' : COLOURS.map((c, i) => `<button type="button" class="bb-sw" data-act="colour" data-colour="${c}" aria-label="Theme color ${i + 1}" style="--bk:${colourCss(c)}"></button>`).join('')}`
    + `${hide.has('ownColour') ? '' : '<label class="bb-own">Your own <input type="color" data-own value="#c07a3e"></label>'}</div>`
    + `<div class="bb-row" data-group="history">${btn('undo', '↶ Undo')}${btn('redo', '↷ Redo')}`
    + `${btn('floor+', 'Bigger floor')}${btn('floor-', 'Smaller floor')}</div>`
    + (opts.extraHtml || '')
    + '</div><p class="bb-say" data-say role="status" aria-live="polite"></p></div></div>';
  const root = host.querySelector('[data-bb]');
  const board = host.querySelector('[data-board]');
  const sayEl = host.querySelector('[data-say]');
  const handEl = host.querySelector('[data-hand]');
  const ownEl = host.querySelector('[data-own]');

  const stops = () => [...root.querySelectorAll('[data-act]')].filter((b) => !b.hidden && !b.disabled && !b.closest('[hidden]'));
  function tell(text) { say = text; if (sayEl && sayEl.textContent !== text) sayEl.textContent = text; }

  function render() {
    if (dead) return;
    const b = ed.get();
    const hand = ed.hand();
    const svg = buildSvg(b.parts, { floor: b.floor, cursor: ed.cursor(), ghost: ed.ghost(), sockets: opts.sockets !== false,
      title: `${b.name}: ${b.parts.length} part${b.parts.length === 1 ? '' : 's'}` });
    if (svg !== lastSvg) { board.innerHTML = svg; lastSvg = svg; }
    board.setAttribute('aria-label', `${b.name}, ${b.parts.length} part${b.parts.length === 1 ? '' : 's'}. The cursor is ${cursorWords()}.`);
    if (handEl) handEl.textContent = handWords(hand);
    const rows = sizeRows(hand.part);
    for (const r of ['w', 'l', 'h']) for (const d of ['-', '+']) {
      const el = root.querySelector(`[data-act="${r}${d}"]`);
      if (!el) continue;
      el.hidden = !rows.includes(r);
      if (r === 'h') el.textContent = hand.part === 'baseplate' ? (d === '-' ? 'Thinner' : 'Thicker') : ROW_WORDS.h[d === '-' ? 0 : 1];
    }
    const here = ed.here();
    for (const a of ['pickUp', 'turnHere', 'paint', 'remove']) { const el = root.querySelector(`[data-act="${a}"]`); if (el) el.disabled = !here; }
    const u = root.querySelector('[data-act="undo"]'); if (u) u.disabled = !ed.canUndo();
    const r = root.querySelector('[data-act="redo"]'); if (r) r.disabled = !ed.canRedo();
    for (const sw of root.querySelectorAll('.bb-sw')) sw.setAttribute('aria-pressed', String(sw.dataset.colour === hand.colour));
    if (ownEl && /^#/.test(hand.colour) && ownEl.value !== hand.colour) ownEl.value = hand.colour;
    const list = stops();
    if (lit >= list.length) lit = list.length ? 0 : -1;
    for (const [i, el] of list.entries()) { const want = i === lit ? '1' : '0'; if (el.dataset.lit !== want) el.dataset.lit = want; }
    for (const el of root.querySelectorAll('[data-lit="1"]')) if (!list.includes(el)) el.dataset.lit = '0';
  }
  function cursorWords() {
    const c = ed.cursor();
    const here = ed.here();
    const h = heightAt(ed.get().parts, c.x, c.z);
    return `${c.x + 1} across and ${c.z + 1} back${here ? `, on a ${specOf(here).label.toLowerCase()} ${h} mm up` : ', on the floor'}`;
  }

  /** Every move by name. Returns true when something changed. */
  function press(act, el = null) {
    if (dead) return false;
    try { opts.onPress?.(act); } catch { /* the host's bookkeeping */ }
    let ok = false;
    inPress = true;
    try { ok = doPress(act, el); } finally { inPress = false; }
    render();
    return ok;
  }
  function doPress(act, el) {
    let ok = false;
    switch (act) {
      case 'left': ok = ed.moveCursor(-1, 0); break;
      case 'right': ok = ed.moveCursor(1, 0); break;
      case 'up': ok = ed.moveCursor(0, -1); break;
      case 'down': ok = ed.moveCursor(0, 1); break;
      case 'put': {
        ok = ed.put();
        tell(ok ? `Put down: ${specOf(ed.hand()).title}.` : 'The model is full: take a part away first.');
        break;
      }
      case 'pickUp': ok = ed.pickUp(); tell(ok ? `In your hand: ${specOf(ed.hand()).title}. Put it down somewhere.` : 'Nothing here to pick up.'); break;
      case 'turnHere': ok = ed.turnHere(); tell(ok ? 'Turned.' : 'Nothing here to turn.'); break;
      case 'paint': ok = ed.paint(); tell(ok ? 'Painted.' : (ed.here() ? 'It is that color already.' : 'Nothing here to paint.')); break;
      case 'remove': ok = ed.remove(); tell(ok ? 'Taken away.' : 'Nothing here to take away.'); break;
      case 'turn': ok = ed.turnHand(); break;
      case 'partPrev': ok = ed.cyclePart(-1); break;
      case 'partNext': ok = ed.cyclePart(1); break;
      case 'w-': case 'w+': case 'l-': case 'l+': case 'h-': case 'h+':
        ok = ed.resize(act[0], act[1] === '+' ? 1 : -1);
        if (!ok) tell('It cannot go that way.');
        break;
      case 'colour': ok = ed.setColour(el?.dataset?.colour || COLOURS[0]); break;
      case 'undo': ok = ed.undo(); tell(ok ? 'Undone.' : 'Nothing to undo.'); break;
      case 'redo': ok = ed.redo(); tell(ok ? 'Done again.' : 'Nothing to redo.'); break;
      case 'floor+': ok = ed.resizeFloor(1); tell(ok ? 'A bigger floor.' : 'The floor is as big as it goes.'); break;
      case 'floor-': ok = ed.resizeFloor(-1); tell(ok ? 'A smaller floor.' : 'The floor cannot be smaller than the model.'); break;
      default:
        try { ok = !!opts.onAct?.(act, el); } catch (err) { console.error('brick builder: onAct', err); }
    }
    if (['partPrev', 'partNext', 'turn', 'colour', 'w-', 'w+', 'l-', 'l+', 'h-', 'h+'].includes(act) && ok) tell(`In your hand: ${handWords(ed.hand())}.`);
    return ok;
  }

  // ---- a switch: the light walks the buttons -------------------------------------------------------------------
  function scan(dir = 1) {
    const list = stops();
    if (!list.length) return null;
    lit = lit < 0 ? (dir > 0 ? 0 : list.length - 1) : (lit + (dir > 0 ? 1 : -1) + list.length) % list.length;
    render();
    const el = list[lit];
    try { el?.scrollIntoView?.({ block: 'nearest' }); } catch { /* not in a page */ }
    return el?.dataset.act || null;
  }
  function select() {
    const list = stops();
    const el = lit >= 0 ? list[lit] : null;
    if (!el) return press('put');
    return press(el.dataset.act, el);
  }

  // ---- pointer -------------------------------------------------------------------------------------------------
  function pickFor(e) {
    const svg = board.querySelector('svg');
    if (!svg || typeof svg.getScreenCTM !== 'function') return null;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(m.inverse());
    const b = ed.get();
    return pickAt(b.parts, b.floor, p.x, p.y);
  }
  function onBoardDown(e) {
    if (dead) return;
    try { root.focus({ preventScroll: true }); } catch { /* fine */ }
    const hit = pickFor(e);
    if (!hit) return;
    e.preventDefault();
    const c = ed.cursor();
    // A press on the cell the cursor is on puts the part; anywhere else moves the cursor (a mouse is already there).
    if (hit.x === c.x && hit.z === c.z) press('put');
    else { try { opts.onPress?.('cursor'); } catch { /* fine */ } ed.setCursor(hit.x, hit.z); }
  }
  function onBoardMove(e) {
    if (dead || e.pointerType !== 'mouse') return;
    const hit = pickFor(e);
    if (hit) ed.setCursor(hit.x, hit.z);
  }
  function onClick(e) {
    const b = e.target.closest?.('[data-act]');
    if (!b || !root.contains(b) || b.disabled) return;
    e.preventDefault();
    const list = stops();
    const i = list.indexOf(b);
    if (i >= 0 && lit >= 0) lit = i;
    press(b.dataset.act, b);
  }
  function onOwn() {
    try { opts.onPress?.('ownColour'); } catch { /* fine */ }
    ed.setColour(ownEl.value);
    tell(`In your hand: ${handWords(ed.hand())}.`);
  }
  const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'put', ' ': 'put',
    r: 'turn', R: 'turn', Delete: 'remove', Backspace: 'remove', p: 'pickUp', P: 'pickUp', '[': 'partPrev', ']': 'partNext' };
  function onKey(e) {
    if (dead) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (t && t.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;   // the button's own press
    let act = null;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) act = e.shiftKey ? 'redo' : 'undo';
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) act = 'redo';
    else if (!e.ctrlKey && !e.metaKey && !e.altKey) act = KEYS[e.key] || null;
    if (!act) return;
    e.preventDefault(); e.stopPropagation();
    press(act);
  }
  board.addEventListener('pointerdown', onBoardDown);
  board.addEventListener('pointermove', onBoardMove);
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  ownEl?.addEventListener('input', onOwn);
  render();

  return {
    el: root,
    editor: ed,
    press,
    scan,
    select,
    render,
    lit: () => { const list = stops(); return lit >= 0 && list[lit] ? list[lit].dataset.act : null; },
    say: () => say,
    tell,
    load(build) { ed.load(build); lit = -1; render(); },
    destroy() {
      dead = true;
      board.removeEventListener('pointerdown', onBoardDown);
      board.removeEventListener('pointermove', onBoardMove);
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      ownEl?.removeEventListener('input', onOwn);
      host.innerHTML = '';
    },
  };
}

export { GRID };
