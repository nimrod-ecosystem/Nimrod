// modules/scoreboard.js — ONE SCOREBOARD, for any count somebody wants to keep.
//
// Row 2.40 (docs/for_chat/MIKE_CHANGE_LIST.md, private repo). Mike, 2026-09-30: *"Scoreboard will
// have to be a module. Now that you mention it, we probably have a bunch of modules drawing their
// own scoreboards. We shouldn't have that."* Design's spec (room-add-ons README §11): *"Any counter
// against a target the person sets: { label, value, target, period }. Buttons: − 1 / + 1 / Set the
// target / Show as overlay. It's a fact, not a verdict: no red for being under the target."*
//
// TWO KINDS OF COUNTER, ONE CARD:
//   * COUNTED HERE — books read, glasses of water, days out of bed. −1 / +1 change it, and a period
//     (none / per day / per week) starts it again at 0 when the period turns over.
//   * FOLLOWED — the value comes from somewhere else and this card only shows it:
//       - a game on the same screen, through the score contract in `../score_source.js` (Trivia's
//         right answers, Comet's hearts caught, Math's points this sitting ...). Nothing is wired:
//         a game that speaks shows up under "Follow", and pressing it adds the card;
//       - the points ledger (`../points.js`): points EARNED today / this week / all time. Earned,
//         not the balance — spending a reward is not something to see a number drop for.
//     A followed card has no −1 / +1: the number is the source's, and a button that did nothing
//     would be a press spent for no result (actions.js says the same about verbs).
//
// IT IS A FACT, NOT A VERDICT. Checked, not just intended (`dev/scoreboard_test.html`):
//   * a card under its target looks exactly like a card over it — same meter, same colour, no
//     "behind" or "short" anywhere. Reaching the target ADDS the words "Target reached"; nothing is
//     ever taken away or turned a warning colour for not reaching it;
//   * the only colours are theme tokens, and meaning is always carried by text as well.
//
// WHERE THE COUNTERS LIVE, and why: in a SHARED per-profile row (`ctx.makeState('scoreboard')`),
// the same shape `bank.js` uses for the question bank and for the same reason. "Books read" is a fact
// about the person using this profile, not about one panel — a scoreboard in a scene and one flat on
// the screen must agree, and removing one panel must not lose the count. What is PER PANEL (this
// instance's own `ctx.state`) is only how it is shown: the whole board, or one counter as an overlay.
//
// "SHOW AS OVERLAY" — HONEST ABOUT WHAT IT IS TODAY. The button turns this panel into one counter,
// drawn large with no card around it, meant to sit over a scene or in a corner. A true overlay that
// floats ABOVE other panels needs the host to mount a module in the `floating` layer
// (`layers.js`), and the host files (`arrangement.js` / `kiosk.js`) have no such mount yet —
// `mount: 'ambient'` exists, but that layer is BEHIND the panels. Flagged for Mike, not faked.
//
// A SWITCH REACHES EVERY BUTTON. `next`/`prev` walk a highlight through every button in reading
// order (wrapping — a highlight that stopped at the end would strand somebody there); `select`
// presses the lit one; `up`/`down` are +1 / −1 on the counter in front of you. The highlight is
// hidden until the first verb, and the first `select` only reveals it — the calculator's rule, so a
// stray press never changes a count nobody saw lit.
//
// DEFAULTS CHOSEN HERE, each revisable and each on Mike's list:
//   * −1 stops at 0. A count of things done cannot be below none, and −1 exists to undo a mis-press.
//   * The target moves by 1 or by 10, and stepping it below 1 means "no target".
//   * A new counter typed with no name is called "Counter 1", "Counter 2" ... so somebody who cannot
//     type can still add one.
//   * Removing a counter takes two presses ("Press again to remove"). If nobody presses again,
//     nothing happens — the confirm can never block the screen.

import { registerModule } from '../module.js';
import { SCORE_TOPIC, SCORE_ASK_TOPIC, SCORE_SHOWN_TOPIC, normalizeScore } from '../score_source.js';
import { createPointsLedger, pointsEvents, pointsValue, dayKey, weekStart, fmtPoints,
         REWARD_TYPE, EXCHANGE_TYPE, POINTS_TOPIC } from '../points.js';

export const SCOREBOARD_STATE = 'scoreboard';
export const PERIODS = ['none', 'day', 'week'];
export const PERIOD_WORDS = { none: '', day: 'today', week: 'this week' };
const PERIOD_ROW = { none: 'Counts: all the time', day: 'Counts: per day', week: 'Counts: per week' };

// The built-in sources: the points ledger, read three ways. Their period is part of what they ARE
// (points earned TODAY), so a card following one has no period of its own to set.
export const BUILTIN_SOURCES = [
  { source: 'points:today', label: 'Points earned today', period: 'day' },
  { source: 'points:week', label: 'Points earned this week', period: 'week' },
  { source: 'points:all', label: 'Points earned, all time', period: 'none' },
];
const builtin = (id) => BUILTIN_SOURCES.find((b) => b.source === id) || null;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------
// PURE HELPERS — exported so the suite checks the rules without a DOM
// ---------------------------------------------------------------------------------------

// LOCAL calendar day, never UTC: "today" is the day of whoever is in front of the screen (the
// same reasoning points.js's dayKey and reading_log's todayStr give).
export function localDay(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The key of the period `now` falls in: a day, a week (by its Monday), or null for "none". */
export function periodKey(period, now) {
  if (period === 'day') return localDay(now);
  if (period === 'week') return `week-of-${localDay(weekStart(now))}`;
  return null;
}

/**
 * A counter as it stands NOW. When its period has turned over, the value starts again at 0 and
 * the old one is kept as `last` — nothing is thrown away, it is just no longer this period's.
 * Pure: returns a new object, or the same one when nothing changed.
 */
export function rollCounter(c, now) {
  if (!c || c.source) return c;
  const period = PERIODS.includes(c.period) ? c.period : 'none';
  if (period === 'none') return c;
  const key = periodKey(period, now);
  if (c.periodKey === key) return c;
  if (!c.periodKey) return { ...c, periodKey: key };
  return { ...c, value: 0, periodKey: key, last: { key: c.periodKey, value: Number(c.value) || 0 } };
}

/** +1 / −1 (or any whole step). Stops at 0 — see the header. */
export function bump(c, delta, now) {
  const r = rollCounter(c, now);
  const n = Math.round(Number(delta) || 0);
  if (!n || r.source) return r;
  return { ...r, value: Math.max(0, (Number(r.value) || 0) + n) };
}

/** Move the target. Below 1 means "no target"; from no target, a step up starts at the step. */
export function stepTarget(c, delta) {
  const n = Math.round(Number(delta) || 0);
  if (!n) return c;
  const t = Number.isFinite(c.target) && c.target > 0 ? c.target : 0;
  const next = t + n;
  return { ...c, target: next >= 1 ? next : null };
}

/** none -> per day -> per week -> none, wrapping (one switch travels one way). */
export function cyclePeriod(c, now) {
  const at = PERIODS.indexOf(PERIODS.includes(c.period) ? c.period : 'none');
  const period = PERIODS[(at + 1) % PERIODS.length];
  return { ...c, period, periodKey: periodKey(period, now) };
}

/**
 * The words on a card. Deliberately only FACTS: the number, "of N", the period, and "Target
 * reached" once it is. There is no branch that says anything about being under the target,
 * because there is nothing to say — `dev/scoreboard_test.html` holds this line.
 */
export function describe(value, target, period = 'none') {
  const v = Number(value) || 0;
  const t = Number.isFinite(target) && target > 0 ? target : null;
  return {
    value: fmtPoints(v),
    of: t ? `of ${fmtPoints(t)}` : '',
    period: PERIOD_WORDS[period] || '',
    reached: t !== null && v >= t,
    fraction: t ? Math.max(0, Math.min(1, v / t)) : null,
  };
}

/** Points EARNED in a period (spends and exchanges left out), from the ledger's events. */
export function earnedIn(events, period, now) {
  const since = period === 'week' ? weekStart(now) : null;
  const today = period === 'day' ? localDay(now) : null;
  return pointsEvents(events)
    .filter((e) => {
      const t = e.data && e.data.type;
      if (t === REWARD_TYPE || t === EXCHANGE_TYPE) return false;
      if (today) return dayKey(e.created_at) === today;
      if (since != null) return new Date(e.created_at).getTime() >= since;
      return true;
    })
    .reduce((n, e) => n + pointsValue(e), 0);
}

/** A fresh counter. `source` set means followed; otherwise counted here. */
export function newCounter({ label, source = null, period = 'none' } = {}, taken = [], now = Date.now()) {
  let i = taken.length + 1;
  let id = `c${i}`;
  const ids = new Set(taken.map((c) => c && c.id));
  while (ids.has(id)) { i += 1; id = `c${i}`; }
  const c = { id, label: String(label || `Counter ${taken.filter((x) => !x.source).length + 1}`).slice(0, 60),
    value: 0, target: null, period: source ? 'none' : period, periodKey: null, last: null, source: source || null };
  return source ? c : rollCounter(c, now);
}

// ---------------------------------------------------------------------------------------
// THE MODULE
// ---------------------------------------------------------------------------------------

registerModule(
  { type: 'scoreboard', title: 'Scoreboard', core: 'new',
    // `local`: counting works with no server at all (the counters simply are not saved). The
    // points sources need the platform; a card following one says so rather than showing a 0.
    dependsOn: 'local', importance: 'optional',
    description: 'Any count you want to keep, against a target you set — or a game’s score, followed from the same screen' },
  (ctx) => {
    const { mount, bus } = ctx;
    const now = ctx.now || (() => Date.now());
    const me = String(ctx.instanceId || 'scoreboard');

    let shared = null;            // the per-profile row the counters live in
    let counters = [];
    let view = { mode: 'panel', focus: null };   // this panel's own: whole board, or one overlay
    const sources = new Map();    // source id -> normalized last update, from the score contract
    let ledger = null;
    let editing = null;           // the counter whose target row is open
    let confirmRemove = null;     // first press of Remove
    let lit = -1;                 // index into the walk, -1 = hidden until the first verb
    let claimed = new Set();      // sources this panel is SHOWING (score/shown)
    let ticker = null;
    let torn = false;

    let listEl = null, addEl = null, followEl = null, inputEl = null, rootEl = null;

    // ---- storage -------------------------------------------------------------------------
    const readCounters = (s) => (Array.isArray(s && s.counters) ? s.counters.filter((c) => c && c.id) : []);
    function saveCounters(next) {
      counters = next;
      if (shared) { shared.set?.({ counters }); Promise.resolve(shared.flush?.()).catch(() => {}); }
      render();
    }
    function saveView(patch) {
      view = { ...view, ...patch };
      try { ctx.state?.set?.({ mode: view.mode, focus: view.focus }); } catch { /* a view is not worth a crash */ }
      render();
    }
    const update = (id, fn) => saveCounters(counters.map((c) => (c.id === id ? fn(c) : c)));

    // ---- what a card shows -----------------------------------------------------------------
    function ensureLedger() {
      if (ledger || typeof ctx.makeEvents !== 'function') return;
      try {
        ledger = createPointsLedger({ makeEvents: ctx.makeEvents, bus });
        ledger.subscribe?.(() => render());
        Promise.resolve(ledger.load()).then(() => ledger?.startPolling?.()).catch(() => {});
      } catch (err) { ledger = null; console.error('scoreboard: no points ledger', err); }
    }

    function reading(c) {
      const t = rollCounter(c, now());
      if (!c.source) {
        return { value: Number(t.value) || 0, target: c.target, period: t.period || 'none',
          note: '', live: true, counted: true, last: t.last };
      }
      const b = builtin(c.source);
      if (b) {
        if (!ledger) return { value: 0, target: c.target, period: b.period, live: false, counted: false,
          note: 'Points need this screen to be signed in.' };
        return { value: earnedIn(ledger.get()?.events || [], b.period, now()), target: c.target,
          period: b.period, live: true, counted: false, note: '' };
      }
      const s = sources.get(c.source);
      if (!s) return { value: 0, target: c.target, period: 'none', live: false, counted: false,
        note: 'Waiting for it to be on this screen.' };
      return { value: s.value ?? 0, target: c.target ?? s.target, period: 'none', live: !s.gone,
        counted: false, note: s.gone ? 'Not on this screen right now — this was the last score.' : s.detail };
    }

    function btn(act, id, label, extra = '') {
      return `<button type="button" class="sb-btn" data-walk data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''}${extra}>${label}</button>`;
    }

    function cardHTML(c) {
      const r = reading(c);
      const d = describe(r.value, r.target, r.period);
      const meter = d.fraction === null ? ''
        : `<div class="sb-meter" role="meter" aria-valuemin="0" aria-valuemax="${esc(r.target)}"
             aria-valuenow="${esc(r.value)}" aria-label="${esc(c.label)}: ${esc(d.value)} ${esc(d.of)}">
             <span class="sb-meter-fill" style="width:${Math.round(d.fraction * 100)}%"></span></div>`;
      const last = r.last && r.counted
        ? `<p class="sb-last">Last time: ${esc(fmtPoints(r.last.value))}</p>` : '';
      const editRow = editing !== c.id ? '' : `
        <div class="sb-edit" role="group" aria-label="Set the target for ${esc(c.label)}">
          ${btn('t-10', c.id, 'Target − 10')}${btn('t-1', c.id, 'Target − 1')}
          ${btn('t+1', c.id, 'Target + 1')}${btn('t+10', c.id, 'Target + 10')}
          ${btn('tnone', c.id, 'No target')}
          ${r.counted ? btn('period', c.id, PERIOD_ROW[r.period] || PERIOD_ROW.none) : ''}
          ${btn('tdone', c.id, 'Done')}
        </div>`;
      return `
        <section class="sb-card" data-counter="${esc(c.id)}" aria-label="${esc(c.label)}">
          <p class="sb-label">${esc(c.label)}</p>
          <p class="sb-figure" role="status" aria-live="polite">
            <span class="sb-value" data-value>${esc(d.value)}</span>
            ${d.of ? `<span class="sb-of">${esc(d.of)}</span>` : ''}
            ${d.period ? `<span class="sb-period">${esc(d.period)}</span>` : ''}</p>
          ${meter}
          ${d.reached ? '<p class="sb-reached" data-reached>Target reached</p>' : ''}
          ${r.note ? `<p class="sb-note">${esc(r.note)}</p>` : ''}
          ${last}
          <div class="sb-btns">
            ${r.counted ? btn('dec', c.id, '− 1', ' aria-label="minus one"') + btn('inc', c.id, '+ 1', ' aria-label="plus one"') : ''}
            ${btn('target', c.id, 'Set the target')}
            ${btn('overlay', c.id, 'Show as overlay')}
            ${btn('remove', c.id, confirmRemove === c.id ? 'Press again to remove' : 'Remove')}
          </div>
          ${editRow}
        </section>`;
    }

    function overlayHTML(c) {
      const r = reading(c);
      const d = describe(r.value, r.target, r.period);
      return `
        <div class="sb-ov" data-counter="${esc(c.id)}" aria-label="${esc(c.label)}">
          <p class="sb-ov-figure" role="status" aria-live="polite"><span class="sb-value" data-value>${esc(d.value)}</span>
            ${d.of ? `<span class="sb-of">${esc(d.of)}</span>` : ''}</p>
          <p class="sb-ov-label">${esc(c.label)}${d.period ? ` · ${esc(d.period)}` : ''}</p>
          ${d.reached ? '<p class="sb-reached" data-reached>Target reached</p>' : ''}
          ${btn('panel', null, 'Show the whole scoreboard')}
        </div>`;
    }

    function followHTML() {
      const followed = new Set(counters.map((c) => c.source).filter(Boolean));
      const games = [...sources.values()].filter((s) => !s.gone && !followed.has(s.source));
      const points = typeof ctx.makeEvents === 'function'
        ? BUILTIN_SOURCES.filter((b) => !followed.has(b.source)) : [];
      if (!games.length && !points.length) return '';
      return `<p class="sb-follow-head">Or follow a score:</p>
        <div class="sb-follow-row">
          ${games.map((s) => btn('follow', null, `Follow: ${esc(s.label)}`, ` data-source="${esc(s.source)}"`)).join('')}
          ${points.map((b) => btn('follow', null, `Follow: ${esc(b.label)}`, ` data-source="${esc(b.source)}"`)).join('')}
        </div>`;
    }

    // ---- which sources this panel is SHOWING, told to the games (score/shown) --------------
    function claim(next) {
      for (const s of claimed) if (!next.has(s)) bus.publish(SCORE_SHOWN_TOPIC, { source: s, by: me, on: false });
      for (const s of next) if (!claimed.has(s)) bus.publish(SCORE_SHOWN_TOPIC, { source: s, by: me, on: true });
      claimed = next;
    }

    function overlayCounter() {
      return counters.find((c) => c.id === view.focus) || null;
    }

    // Re-entrant calls (a ledger that reports synchronously the moment it is subscribed to) are
    // folded into one more pass after this one, rather than nesting a render inside a render.
    let rendering = false, again = false;
    function render() {
      if (torn || !listEl) return;
      if (rendering) { again = true; return; }
      rendering = true;
      try {
        let passes = 0;   // bounded: a source that answered every render with a new value must not spin
        do { again = false; renderOnce(); passes += 1; } while (again && !torn && passes < 4);
      } finally { rendering = false; }
    }
    function renderOnce() {
      if (counters.some((c) => builtin(c.source))) ensureLedger();
      const ov = view.mode === 'overlay' ? overlayCounter() : null;
      rootEl.dataset.mode = ov ? 'overlay' : 'panel';
      addEl.hidden = !!ov;
      if (ov) {
        listEl.innerHTML = overlayHTML(ov);
      } else if (!counters.length) {
        listEl.innerHTML = '<p class="sb-empty">Nothing counted yet. Add a counter below, or follow a score.</p>';
      } else {
        listEl.innerHTML = counters.map(cardHTML).join('');
      }
      followEl.innerHTML = ov ? '' : followHTML();
      claim(new Set((ov ? [ov] : counters).map((c) => c.source).filter(Boolean)));
      paintLit();
    }

    // ---- the walk ---------------------------------------------------------------------------
    const walk = () => [...mount.querySelectorAll('[data-walk]')].filter((b) => !b.disabled && !b.closest('[hidden]'));
    function paintLit() {
      const list = walk();
      if (lit >= list.length) lit = list.length ? list.length - 1 : -1;
      list.forEach((b, i) => {
        if (i === lit) { b.dataset.on = '1'; b.setAttribute('aria-current', 'true'); }
        else { delete b.dataset.on; b.removeAttribute('aria-current'); }
      });
    }
    function moveLit(delta) {
      const n = walk().length;
      if (!n) return;
      lit = lit < 0 ? (delta > 0 ? 0 : n - 1) : ((lit + delta) % n + n) % n;
      paintLit();
    }
    function selectLit() {
      const list = walk();
      if (!list.length) return;
      if (lit < 0) { lit = 0; paintLit(); return; }     // reveal first; never press a button nobody saw lit
      act(list[lit]);
    }
    // The counter the person is "on": the lit button's card, the overlay's, or the first counted one.
    function focusedCounter() {
      const b = lit >= 0 ? walk()[lit] : null;
      const id = b?.closest('[data-counter]')?.dataset.counter
        || (view.mode === 'overlay' ? view.focus : null);
      return counters.find((c) => c.id === id) || counters.find((c) => !c.source) || null;
    }
    function delta(n) {
      const c = focusedCounter();
      if (!c || c.source) return;
      confirmRemove = null;
      update(c.id, (x) => bump(x, n, now()));
    }

    // ---- what a press does ------------------------------------------------------------------
    function act(b) {
      if (!b || torn) return;
      const a = b.dataset.act;
      const id = b.dataset.id || null;
      if (a !== 'remove') confirmRemove = null;
      switch (a) {
        case 'inc': return update(id, (c) => bump(c, 1, now()));
        case 'dec': return update(id, (c) => bump(c, -1, now()));
        case 'target': editing = editing === id ? null : id; return render();
        case 'tdone': editing = null; return render();
        case 't-10': return update(id, (c) => stepTarget(c, -10));
        case 't-1': return update(id, (c) => stepTarget(c, -1));
        case 't+1': return update(id, (c) => stepTarget(c, 1));
        case 't+10': return update(id, (c) => stepTarget(c, 10));
        case 'tnone': return update(id, (c) => ({ ...c, target: null }));
        case 'period': return update(id, (c) => cyclePeriod(c, now()));
        case 'overlay': editing = null; lit = -1; return saveView({ mode: 'overlay', focus: id });
        case 'panel': lit = -1; return saveView({ mode: 'panel' });
        case 'remove':
          if (confirmRemove !== id) { confirmRemove = id; return render(); }
          confirmRemove = null;
          if (editing === id) editing = null;
          return saveCounters(counters.filter((c) => c.id !== id));
        case 'add': {
          const label = (inputEl?.value || '').trim();
          if (inputEl) inputEl.value = '';
          return saveCounters([...counters, newCounter({ label }, counters, now())]);
        }
        case 'follow': {
          const src = b.dataset.source;
          const known = builtin(src) || sources.get(src);
          if (!known) return undefined;
          return saveCounters([...counters, newCounter({ label: known.label, source: src }, counters, now())]);
        }
        default: return undefined;
      }
    }

    function onClick(e) {
      const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
      if (b && mount.contains(b)) act(b);
    }

    return {
      __probe: () => ({ counters: counters.map((c) => ({ ...c })), view: { ...view }, lit, editing,
        claimed: [...claimed], sources: [...sources.keys()], ticking: ticker != null }),
      init() {
        // The stylesheet rides inside the mount (see scoreboard.css's header for why not <head>).
        let cssHref = '';
        try { cssHref = new URL('../scoreboard.css', import.meta.url).href; } catch { /* unstyled, still works */ }
        mount.innerHTML = `
          ${cssHref ? `<link rel="stylesheet" data-sb-css href="${esc(cssHref)}">` : ''}
          <div class="sb" data-sb data-mode="panel">
            <div class="sb-list" data-list></div>
            <div class="sb-add" data-add-area>
              <div class="sb-add-row">
                <input class="sb-input" data-new-label type="text" placeholder="What to count" aria-label="What to count">
                ${btn('add', null, 'Add a counter')}
              </div>
              <div class="sb-follow" data-follow></div>
            </div>
          </div>`;
        // ONE delegated listener for every button: each one carries `data-act`, the same thing
        // `select` presses, so a click and a switch cannot drift apart.
        mount.addEventListener('click', onClick);
        rootEl = mount.querySelector('[data-sb]');
        listEl = mount.querySelector('[data-list]');
        addEl = mount.querySelector('[data-add-area]');
        followEl = mount.querySelector('[data-follow]');
        inputEl = mount.querySelector('[data-new-label]');
        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') act(mount.querySelector('[data-act="add"]')); });

        // This panel's own view.
        const own = ctx.state?.get?.() || {};
        view = { mode: own.mode === 'overlay' ? 'overlay' : 'panel', focus: own.focus || null };

        // The counters: the shared per-profile row, else this panel's own state, else memory.
        try { shared = typeof ctx.makeState === 'function' ? ctx.makeState(SCOREBOARD_STATE) : null; }
        catch (err) { shared = null; console.error('scoreboard: no shared row', err); }
        if (!shared && ctx.state) shared = ctx.state;
        if (shared) {
          counters = readCounters(shared.get?.());
          shared.subscribe?.((s) => { counters = readCounters(s); render(); });
          if (shared !== ctx.state) {
            Promise.resolve(shared.load?.()).catch(() => {})
              .then(() => { counters = readCounters(shared?.get?.()); render(); shared?.startPolling?.(); })
              .catch(() => {});
          }
        }

        // The score contract.
        bus.subscribe(SCORE_TOPIC, (p) => {
          const s = normalizeScore(p);
          if (!s) return;
          if (s.gone) {
            const prev = sources.get(s.source);
            if (prev && (!s.instance || !prev.instance || prev.instance === s.instance)) sources.set(s.source, { ...prev, gone: true });
          } else {
            sources.set(s.source, s);
          }
          render();
        });
        // A game that arrives asks who is showing it: say so again.
        bus.subscribe(SCORE_ASK_TOPIC, () => {
          for (const s of claimed) bus.publish(SCORE_SHOWN_TOPIC, { source: s, by: me, on: true });
        });
        // Points paid on this screen reach the ledger's own record first; fetch it now rather than
        // waiting for the next poll, so "points earned today" moves when the point is earned.
        bus.subscribe(POINTS_TOPIC, () => { if (ledger) Promise.resolve(ledger.load()).catch(() => {}); });

        // Verbs.
        bus.subscribe('scoreboard/next', () => moveLit(1));
        bus.subscribe('scoreboard/prev', () => moveLit(-1));
        bus.subscribe('scoreboard/select', () => selectLit());
        bus.subscribe('scoreboard/delta', (n) => delta(n));

        render();
        // Anything already on the screen: say what you have.
        bus.publish(SCORE_ASK_TOPIC, {});
        // A per-day counter shown overnight has to read 0 in the morning without anybody pressing
        // anything; once a minute is plenty for a day boundary and costs nothing.
        ticker = setInterval(() => render(), 60 * 1000);
      },
      onResize() {},
      onHide() { try { shared?.flush?.(); ctx.state?.flush?.(); } catch { /* nothing to do */ } },
      destroy() {
        torn = true;
        mount.removeEventListener('click', onClick);
        if (ticker != null) { clearInterval(ticker); ticker = null; }
        for (const s of claimed) bus.publish(SCORE_SHOWN_TOPIC, { source: s, by: me, on: false });
        claimed = new Set();
        if (ledger) { try { ledger.destroy(); } catch { /* already gone */ } ledger = null; }
        if (shared && shared !== ctx.state) { try { shared.destroy?.(); } catch { /* already gone */ } }
        shared = null;
      },
    };
  },
);
