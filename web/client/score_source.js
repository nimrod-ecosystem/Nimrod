// score_source.js — THE SCORE CONTRACT: how a module says "here is my score" without drawing a
// scoreboard of its own, and how the scoreboard module hears it.
//
// Row 2.40 (docs/for_chat/MIKE_CHANGE_LIST.md, private repo). Mike, 2026-09-30: *"Scoreboard will
// have to be a module. Now that you mention it, we probably have a bunch of modules drawing their
// own scoreboards. We shouldn't have that."* The audit behind this file found six that did
// (trivia, comet, comet_ambient, algebra, wordforge, sprint's "points today" line). Each one now
// PUBLISHES its score here, and `modules/scoreboard.js` shows it.
//
// ---------------------------------------------------------------------------------------
// THE CONTRACT — three bus topics, all fixed strings
// ---------------------------------------------------------------------------------------
//
//   score/update  { source, label, value, target?, detail?, instance?, gone? }
//                 A module's score, every time it changes. `source` is a stable, machine-safe id
//                 (the module's type, e.g. 'trivia'); `label` is what a person reads ("Trivia:
//                 right answers"); `value` is a finite number; `target` is OPTIONAL and only a
//                 suggestion (the person's own target on the scoreboard wins); `detail` is one
//                 short line of context ("3 in a row"). `gone: true` means the source left the
//                 screen (its module was destroyed) — the scoreboard keeps the last value and
//                 says it is not live.
//   score/ask     {}
//                 "Everybody say what you have." A scoreboard that mounts after a game asks, and
//                 every live source re-announces. A source that mounts after a scoreboard asks
//                 too, so the scoreboard re-states which sources it is SHOWING (below).
//   score/shown   { source, by, on }
//                 A scoreboard saying "I am showing `source` right now" (on: true) or "not any
//                 more" (on: false). `by` is the scoreboard's instance id. This is what lets a
//                 game step its own readout aside ONLY when something else is really showing it.
//
// *** WHY ONE TOPIC WITH THE ID IN THE PAYLOAD, NOT `score/<id>`. *** Argued both ways:
//   * FOR `score/<id>`: it is how the rest of the bus is shaped (`photos/next`), and a listener
//     for one game hears nothing else.
//   * AGAINST, and it wins: `bus.js` subscribes to EXACT topics — there is no wildcard — so a
//     scoreboard could only hear a source it already knew the name of. The scoreboard has to
//     DISCOVER what is on the screen ("follow Trivia" appears because Trivia spoke), and a
//     module written next year has to show up without anyone editing a list. One topic makes
//     discovery free; the per-source filter is one `if` on the receiving side.
//
// *** WHY THE BUS AND NOT A DATA LINK (`ports.js`/`links.js`). *** A port is the right address for
// "THIS instance's output into THAT instance's input", and a score is exactly that shape. But a
// link today has no setup screen — the calculator's catalog entry says a link "is written into the
// data behind the screen by hand" — so a score that could only travel on a link would reach no
// scoreboard anybody could set up. The broadcast works the day it ships, with nothing to wire. A
// `score` OUT port on each game is the natural second step once links can be made by a person; it
// is flagged for Mike rather than half-built here.
//
// ---------------------------------------------------------------------------------------
// "SHOW MY OWN SCORE HERE" — the per-module setting, and why its default is `auto`
// ---------------------------------------------------------------------------------------
//
// Every migrated module declares the same three-way `ownScore` choice (see `ownScoreField`):
//   auto    show it on this panel UNLESS a scoreboard on the screen is showing it (default)
//   always  show it here regardless
//   off     never show it here
//
// Argued both ways, because the two rulings pull in different directions:
//   * FOR default `off` (what row 2.40 read as at first): a module drawing its own scoreboard is
//     the thing Mike said "we shouldn't have".
//   * AGAINST, and it wins: Mike ruled on 2026-09-22, for trivia and comet specifically, that a
//     score is shown BY DEFAULT — *"Why should a screen someone can't walk away from not show a
//     score? Games have scores. That's pretty standard."* With `off` as the default, every game on
//     a screen with no scoreboard would show no score at all, which silently reverses that ruling.
//     `auto` satisfies both: a score is on the screen by default, and it is never drawn twice —
//     the moment a scoreboard shows it, the game's own readout steps aside.
// This is a DEFAULT, not a rule, and it is on Mike's list.
//
// NOTHING HERE TOUCHES POINTS. What a score IS (earned, caught, right) is still decided by each
// module and paid by `points.js` exactly as before; this file only carries the number.

export const SCORE_TOPIC = 'score/update';
export const SCORE_ASK_TOPIC = 'score/ask';
export const SCORE_SHOWN_TOPIC = 'score/shown';

// Same character set a bindable action id uses (actions.js ID_RE), plus ':' so a built-in source
// can carry a qualifier ('points:today'). Short, machine-safe, and never a label.
const SOURCE_RE = /^[a-z0-9][a-z0-9_:.-]{0,63}$/;
export const isSourceId = (s) => typeof s === 'string' && SOURCE_RE.test(s);

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * One `score/update` payload, checked. Returns null for anything that is not one — a malformed
 * publish from one module must not put a wrong number on somebody else's scoreboard, and must not
 * throw into it either.
 */
export function normalizeScore(p) {
  if (!p || typeof p !== 'object') return null;
  if (!isSourceId(p.source)) return null;
  const gone = p.gone === true;
  const value = finite(p.value);
  if (!gone && value === null) return null;
  const target = finite(p.target);
  return {
    source: p.source,
    label: String(p.label || p.source).slice(0, 80),
    value,
    target: target !== null && target > 0 ? target : null,
    detail: p.detail ? String(p.detail).slice(0, 80) : '',
    instance: p.instance ? String(p.instance) : null,
    gone,
  };
}

/**
 * Watch whether any scoreboard is SHOWING `source` right now. `onChange(shown)` fires only when
 * the answer flips. Used by `createScoreSource` below, and on its own by a module whose readout
 * mirrors a built-in source rather than a score of its own (sprint's "points today" mirrors the
 * scoreboard's 'points:today').
 */
export function watchShown(bus, source, onChange = null) {
  const by = new Set();
  let live = true;
  const off = bus.subscribe(SCORE_SHOWN_TOPIC, (p) => {
    if (!live || !p || p.source !== source || !p.by) return;
    const before = by.size > 0;
    if (p.on === false) by.delete(String(p.by)); else by.add(String(p.by));
    const after = by.size > 0;
    if (before !== after && typeof onChange === 'function') {
      try { onChange(after); } catch (err) { console.error('score_source: onChange', err); }
    }
  });
  // Ask once, so a scoreboard that was already on the screen says what it is showing.
  bus.publish(SCORE_ASK_TOPIC, {});
  return {
    shown: () => by.size > 0,
    destroy() { if (!live) return; live = false; off(); by.clear(); },
  };
}

/**
 * A module's handle for publishing its score.
 *
 *   const score = createScoreSource(ctx.bus, { source: 'trivia', label: 'Trivia: right answers',
 *                                              instance: ctx.instanceId, onShownChange: render });
 *   score.set(rightCount, { detail: '3 in a row' });   // publishes only when something changed
 *   score.shownElsewhere();                           // is a scoreboard showing it?
 *   score.destroy();                                  // in destroy(): says `gone`, releases all
 *
 * NEVER THROWS INTO A MODULE, the same rule `ports.js` keeps: an unusable bus makes an inert
 * handle, and a non-finite value is simply not published.
 */
export function createScoreSource(bus, { source, label, instance = null, onShownChange = null } = {}) {
  const usable = !!(bus && typeof bus.publish === 'function' && typeof bus.subscribe === 'function')
    && isSourceId(source);
  if (!usable) {
    return { set: () => false, shownElsewhere: () => false, last: () => null, destroy() {} };
  }
  let last = null;           // { value, target, detail }
  let live = true;
  let lbl = String(label || source);
  const announce = () => {
    if (!live || !last) return;
    bus.publish(SCORE_TOPIC, { source, label: lbl, instance, ...last });
  };
  const offAsk = bus.subscribe(SCORE_ASK_TOPIC, () => announce());
  const shown = watchShown(bus, source, onShownChange);

  return {
    set(value, { target = null, detail = '', label: newLabel = null } = {}) {
      if (!live) return false;
      const v = finite(value);
      if (v === null) return false;
      const t = finite(target);
      const next = { value: v, target: t !== null && t > 0 ? t : null, detail: detail ? String(detail) : '' };
      const relabel = newLabel && String(newLabel) !== lbl;
      if (relabel) lbl = String(newLabel);
      if (!relabel && last && last.value === next.value && last.target === next.target
          && last.detail === next.detail) return false;
      last = next;
      announce();
      return true;
    },
    shownElsewhere: () => shown.shown(),
    last: () => (last ? { ...last } : null),
    destroy() {
      if (!live) return;
      live = false;
      offAsk();
      shown.destroy();
      bus.publish(SCORE_TOPIC, { source, label: lbl, instance, gone: true });
    },
  };
}

// ---------------------------------------------------------------------------------------
// THE PER-MODULE SETTING
// ---------------------------------------------------------------------------------------

export const OWN_SCORE_KEY = 'ownScore';
export const OWN_SCORE_MODES = ['auto', 'always', 'off'];

/**
 * The settings row every migrated module declares. `label` defaults to 'Score', the label trivia
 * and comet already used, so a caregiver who knew where the row was still finds it there.
 */
export function ownScoreField({ label = 'Score', level = 'essential', note = null } = {}) {
  return {
    key: OWN_SCORE_KEY, label, kind: 'choice', default: 'auto', level,
    options: [
      { value: 'auto', label: 'On this panel, unless a scoreboard shows it' },
      { value: 'always', label: 'On this panel, always' },
      { value: 'off', label: 'Not on this panel' },
    ],
    note: note || 'A Scoreboard on the same screen can show it instead.',
  };
}

/**
 * Which mode a module's saved settings mean. `showScore: false` is the key trivia and comet used
 * before this row existed; somebody who turned the score off keeps it off, rather than having it
 * come back because the key was renamed.
 */
export function ownScoreMode(saved = {}) {
  const s = saved || {};
  if (OWN_SCORE_MODES.includes(s.ownScore)) return s.ownScore;
  if (s.showScore === false) return 'off';
  return 'auto';
}

/** Should the module draw its own score right now? */
export function showOwnScore(mode, shownElsewhere) {
  if (mode === 'always') return true;
  if (mode === 'off') return false;
  return !shownElsewhere;
}
