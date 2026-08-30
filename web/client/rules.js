// rules.js — a screen's state machine, in sentences.
//
// *** THE ENGINE IS ALREADY AUTHORABLE; NOBODY CAN READ IT. *** `statemachine.js` runs a JSON
// config, and `director.js` already reads that config from per-screen state — so what a screen
// does is DATA today. What is missing is not a mechanism. It is that the data is a nested
// object with `on`, `pick`, `gate` and `$back` in it, and the person who needs to change it
// is a caregiver deciding that a call should interrupt the photos.
//
// SO THIS IS A READER FIRST AND AN EDITOR SECOND. Every rule is rendered as one sentence —
// "when a call comes in → show Call, from any screen" — and only the rules somebody actually
// wants to change are offered as switches. DECISIONS.md's eventual node editor is a better
// version of the same idea; this is the part that makes the call configurable now.
//
// *** IT SHOWS WHAT IT DOES NOT UNDERSTAND, RATHER THAN HIDING IT. *** A config can contain a
// guard or a shape this file has no sentence for. Rendering only the parts it recognises would
// tell somebody their screen has three rules when it has five, and they would then make a
// decision on a list that is quietly wrong. An unrecognised rule is shown as itself.
//
// AND IT NEVER SILENTLY REWRITES. Turning a switch on edits one branch of the config and
// leaves everything else byte-for-byte, because a config a person hand-wrote is theirs.

import { PROVIDERS, DIRECTOR_CONFIG } from './modules/director.js';
import { BACK } from './statemachine.js';

// Module types whose settings are a state machine.
export const MACHINE_TYPES = new Set(['director']);

// The topics a call arrives and departs on. One place, so the rule the switch writes and the
// rule the reader recognises can never drift apart.
export const CALL_TOPIC = 'call/incoming';
export const CALL_ENDED_TOPIC = 'call/ended';
export const CALL_STATE = 'call';

// States that are not content providers still need a human name, or a sentence reads
// "show call" with a raw id in it - which is the same leak this file exists to stop.
const EXTRA_LABELS = { call: 'Call' };
const labelOf = (id) => PROVIDERS.find((p) => p.id === id)?.label || EXTRA_LABELS[id] || id;

// A topic in words. Unknown topics keep their raw name rather than being dressed up as
// something they are not.
const TOPIC_WORDS = {
  'segment/done': 'one finishes',
  [CALL_TOPIC]: 'a call comes in',
  [CALL_ENDED_TOPIC]: 'the call ends',
};
const topicWords = (t) => TOPIC_WORDS[t] || `“${t}”`;

function targetWords(tr) {
  if (tr.pick) {
    const from = (tr.pick.from || []).map(labelOf);
    const gated = tr.pick.gate !== 'none';
    return `pick another one${from.length ? ` from ${from.join(', ')}` : ''}`
      + (gated ? ', from whatever the time of day allows' : '');
  }
  if (tr.to === BACK) return 'go back to whatever was on before';
  if (tr.to != null) return `show ${labelOf(tr.to)}`;
  return null;
}

/**
 * Every rule in a config, as sentences. PURE.
 * Returns [{scope, stateId, when, then, kind, raw}] — `kind: 'unknown'` for anything this
 * file has no words for, which is shown rather than dropped.
 */
export function describeConfig(config) {
  const out = [];
  if (!config || typeof config !== 'object') return out;

  if (config.initial != null) {
    out.push({ scope: 'start', when: 'when the screen starts',
               then: `show ${labelOf(config.initial)}`, kind: 'initial' });
  }

  const forTransitions = (topic, list, scope, stateId) => {
    for (const tr of list || []) {
      const then = targetWords(tr);
      out.push({
        scope, stateId, kind: then ? 'transition' : 'unknown',
        when: `when ${topicWords(topic)}`
          + (scope === 'global' ? ', from any screen' : ` while showing ${labelOf(stateId)}`)
          + (tr.when ? ` (only if ${tr.when})` : ''),
        then: then || JSON.stringify(tr),
        topic, raw: tr,
      });
    }
  };

  for (const [topic, list] of Object.entries(config.on || {})) {
    forTransitions(topic, list, 'global');
  }
  for (const [stateId, st] of Object.entries(config.states || {})) {
    for (const [topic, list] of Object.entries(st.on || {})) {
      forTransitions(topic, list, 'state', stateId);
    }
    if (st.after && st.after.ms != null) {
      const then = targetWords(st.after);
      out.push({
        scope: 'state', stateId, kind: then ? 'timer' : 'unknown',
        when: `after ${Math.round(st.after.ms / 1000)} seconds of ${labelOf(stateId)}`,
        then: then || JSON.stringify(st.after), raw: st.after,
      });
    }
  }

  // The daypart gate is a rule people very much want to read, and it is not a transition.
  const en = config.daypart?.enabled;
  if (en) {
    for (const [part, ids] of Object.entries(en)) {
      out.push({ scope: 'daypart', kind: 'daypart',
                 when: `during ${part}`,
                 then: `only ${(ids || []).map(labelOf).join(', ') || 'nothing'} may play` });
    }
  }
  return out;
}

// ---- the one rule that is a switch, for now -------------------------------------------
//
// A call is the case that motivated this: it has to interrupt from ANY state and hand the
// screen back, which is a global transition plus `$back`.

export const hasCallRule = (config) =>
  !!(config?.on?.[CALL_TOPIC]?.some((t) => t.to === CALL_STATE)
     && config?.on?.[CALL_ENDED_TOPIC]?.some((t) => t.to === BACK));

/** Add the call rules. Returns a NEW config; the original is untouched. */
export function withCallRule(config) {
  const next = JSON.parse(JSON.stringify(config || {}));
  next.on = next.on || {};
  next.states = next.states || {};
  // Prepended, so a call is considered before whatever else answers the same topic.
  next.on[CALL_TOPIC] = [{ to: CALL_STATE },
    ...(next.on[CALL_TOPIC] || []).filter((t) => t.to !== CALL_STATE)];
  next.on[CALL_ENDED_TOPIC] = [{ to: BACK },
    ...(next.on[CALL_ENDED_TOPIC] || []).filter((t) => t.to !== BACK)];
  // The state has to EXIST or the transition resolves to nothing and the call goes nowhere.
  if (!next.states[CALL_STATE]) {
    next.states[CALL_STATE] = { enter: { publish: `${CALL_STATE}/activate` } };
  }
  // *** AND IT MUST NOT BE IN THE ROTATION. *** Every `pick` here draws from a list of
  // content; leaving `call` out of those lists is what stops the screen deciding to show a
  // call because it felt like it.
  return next;
}

export function withoutCallRule(config) {
  const next = JSON.parse(JSON.stringify(config || {}));
  if (next.on) {
    for (const topic of [CALL_TOPIC, CALL_ENDED_TOPIC]) {
      const kept = (next.on[topic] || []).filter(
        (t) => !(topic === CALL_TOPIC ? t.to === CALL_STATE : t.to === BACK));
      if (kept.length) next.on[topic] = kept; else delete next.on[topic];
    }
    if (!Object.keys(next.on).length) delete next.on;
  }
  // The `call` STATE is deliberately left in place. Removing it would throw away anything
  // somebody configured on it, and an unreachable state costs nothing.
  return next;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountRules(host, { profiles, user, makeState = null } = {}) {
  let screens = [];       // [{pid, name, mid, handle, config}]
  let error = '';

  host.innerHTML = '<div class="rul"><p class="rul-loading">Loading…</p></div>';
  const root = host.querySelector('.rul');

  async function load() {
    screens = []; error = '';
    try {
      for (const p of (await profiles.list()) || []) {
        for (const m of p.modules || []) {
          if (!MACHINE_TYPES.has(m.type)) continue;
          const handle = makeState ? makeState(m.id, {}, p.id) : null;
          await handle?.load?.().catch(() => {});
          const saved = handle?.get?.() || {};
          screens.push({ pid: p.id, name: p.name || p.id, mid: m.id, handle,
                         config: saved.config || DIRECTOR_CONFIG });
        }
      }
    } catch (e) { error = String(e?.message || e); }
    render();
  }

  function render() {
    if (error) { root.innerHTML = `<p class="rul-empty">Rules could not be loaded. ${esc(error)}</p>`; return; }
    if (!screens.length) {
      root.innerHTML = '<h1>Rules</h1><p class="rul-empty">No screen is running a Lineup yet. '
        + 'Add <b>Lineup</b> to a screen and what it does will be listed here, in sentences.</p>';
      return;
    }
    const parts = ['<h1>Rules</h1>',
      '<p class="rul-intro">What each screen does on its own, and when. These are the same '
      + 'rules the screen actually runs — not a description of them.</p>'];

    screens.forEach((s, i) => {
      const rules = describeConfig(s.config);
      const call = hasCallRule(s.config);
      parts.push(`<section class="rul-screen"><h2>${esc(s.name)}</h2>`);
      parts.push(`<label class="rul-switch">
        <input type="checkbox" data-call="${i}"${call ? ' checked' : ''}>
        <span><b>A call interrupts this screen.</b> When a call comes in the screen shows it,
        from whatever it was doing, and goes back afterwards.</span></label>`);
      parts.push('<ul class="rul-list">');
      for (const r of rules) {
        parts.push(`<li class="rul-${esc(r.kind)}">
          <span class="rul-when">${esc(r.when)}</span>
          <span class="rul-arrow">→</span>
          <span class="rul-then">${esc(r.then)}</span>
          ${r.kind === 'unknown' ? '<em class="rul-note">this one has no plain wording yet</em>' : ''}
        </li>`);
      }
      parts.push('</ul></section>');
    });
    root.innerHTML = parts.join('');
  }

  root.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-call]');
    if (!box) return;
    const s = screens[Number(box.dataset.call)];
    if (!s) return;
    const next = box.checked ? withCallRule(s.config) : withoutCallRule(s.config);
    s.config = next;
    render();
    // A PATCH, not the whole blob. Writing back a spread snapshot would clobber anything
    // else that changed in this module's settings since it was read.
    try { await s.handle?.set?.({ config: next }); }
    catch (err) { console.error('rules: could not save', err); }
  });

  return { refresh: load, render, screens: () => screens.map((s) => ({ ...s })), destroy() {} };
}
