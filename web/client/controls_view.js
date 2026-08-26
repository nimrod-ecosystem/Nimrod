// controls_view.js — the two questions a caregiver actually asks at a bedside screen.
//
//   "WHAT CAN I PRESS RIGHT NOW?"      -> whatCanIPress()
//   "WHY DID NOTHING JUST HAPPEN?"     -> whyNothingHappened()
//
// Both are borrowed straight from operating systems, and both matter MORE here than they do
// there. A tiling window manager ships a keybinding overlay as a convenience for somebody
// who chose their own bindings. Here, bindings belong to a PERSON and follow them between
// machines — so a caregiver walking up to a screen genuinely cannot know what that switch
// does, and there is no manual to consult because the answer is different for every person.
//
// The second is the `journalctl` of this product. The input bus already decides and records
// everything: it knows a press arrived, which control it came from, whether the gate let it
// through, whether it was too short, whether it was inside a lockout, and whether the
// action it named resolved to anything on the focused panel. All of that is thrown away
// today unless somebody happens to be looking at the binder on another machine.
//
// THE FAILURE THIS EXISTS FOR is specific and it is the worst one in the product: a switch
// that appears dead. The person presses. Nothing moves. Nobody in the room can tell whether
// the switch is broken, the binding is wrong, the hold threshold is too high, the gate is
// set to moderator-only, or the panel in front of them simply has nothing to say to that
// verb. Those are five completely different repairs and they look identical.
//
// PURE FUNCTIONS FIRST, rendering second — the wording IS the feature here, so it has to be
// assertable without a browser.

import { VERBS, FOCUS_VERBS, verbTopic } from './actions.js';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VERB_LABEL = Object.fromEntries([...VERBS, ...FOCUS_VERBS].map((v) => [v.id, v.label]));

// A control name a person can read out loud. "key:arrowdown" is not one.
export function controlLabel(device = '', control = '') {
  const c = String(control || '');
  if (c.startsWith('key:')) {
    const k = c.slice(4);
    const pretty = {
      ' ': 'Space', arrowdown: 'Down', arrowup: 'Up', arrowleft: 'Left', arrowright: 'Right',
      escape: 'Esc', enter: 'Enter', tab: 'Tab', backspace: 'Backspace',
    };
    return k.split('+').map((part) => pretty[part] || (part.length === 1 ? part.toUpperCase() : part))
      .join(' + ');
  }
  if (c.startsWith('pointer:')) return `Mouse ${c.slice(8)}`;
  if (String(device).startsWith('gamepad')) return `Controller ${c.replace(/^.*:/, '')}`;
  return c || String(device) || 'something';
}

// ---------------------------------------------------------------------------------
// "What can I press right now?"
//
// The answer has THREE tiers, and collapsing them would be the whole mistake:
//   works    bound, and the focused panel answers it
//   nothing  bound, but this panel has nothing to say to that verb — not broken, not useful
//   blocked  bound, but the gate will refuse it from whoever is pressing
// ---------------------------------------------------------------------------------
export function whatCanIPress({ bindings = [], targets = {}, gate = 'both', subject = null } = {}) {
  const rows = [];
  for (const b of bindings) {
    const verb = String(b.actionId || '').replace(/^verb\//, '');
    const isFocus = FOCUS_VERBS.some((v) => v.id === verb);
    const hit = targets[verb];

    // The gate is three-way: 'both' lets everything through; otherwise a binding whose role
    // is 'universal' still passes, and one bound to the other role does not.
    const blocked = gate !== 'both' && b.role && b.role !== 'universal' && b.role !== gate;

    let status = 'works';
    let says = '';
    if (blocked) {
      status = 'blocked';
      says = `the gate is set to ${gate} only`;
    } else if (isFocus) {
      says = 'moves between panels';
    } else if (hit) {
      says = subject ? `${VERB_LABEL[verb] || verb} on ${subject}` : (VERB_LABEL[verb] || verb);
    } else {
      status = 'nothing';
      says = subject ? `nothing on ${subject}` : 'nothing here';
    }

    rows.push({
      control: controlLabel(b.device, b.control),
      verb,
      verbLabel: VERB_LABEL[verb] || verb || '(unbound)',
      says,
      status,
      holdMs: b.holdMs || 0,
    });
  }
  // Working things first. Somebody scanning this list under pressure should meet what
  // works before they meet what does not.
  const order = { works: 0, nothing: 1, blocked: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status]
    || a.verbLabel.localeCompare(b.verbLabel));
}

// ---------------------------------------------------------------------------------
// "Why did nothing happen?"
//
// Turns the input bus's own record of a refusal into the sentence a person needs. Every
// branch here corresponds to a DIFFERENT REPAIR, which is the entire justification for not
// collapsing them into "press not accepted".
// ---------------------------------------------------------------------------------
export function explainActivation(rec = {}) {
  if (!rec || typeof rec !== 'object') return { ok: false, text: 'nothing recorded' };
  const who = controlLabel(rec.device, rec.control);

  // A REMOTE PRESS GETS ITS OWN SENTENCE. Once the gate started judging drivers as well as
  // switches, refusals from both started landing in this list - and "X is bound, but the
  // gate is refusing it" is nonsense about somebody driving from another house, because
  // there is no binding involved. Worse, it would send a caregiver hunting for a switch
  // fault when the repair is one toggle on this screen. So it names the gate and the role,
  // which together ARE the repair.
  if (rec.device === 'remote') {
    if (rec.accepted) {
      const verb = String(rec.actionId || '').replace(/^verb\//, '');
      return { ok: true, text: `${who} → ${VERB_LABEL[verb] || verb || 'an action'}` };
    }
    if (rec.reason === 'role-gated') {
      return { ok: false, text: `${who} was refused — this screen is set to `
        + `"${rec.gate}" and they are ${rec.role || 'unknown'}` };
    }
    return { ok: false, text: `${who} was refused (${rec.reason || 'no reason recorded'})` };
  }

  if (rec.accepted) {
    const verb = String(rec.actionId || '').replace(/^verb\//, '');
    return { ok: true, text: `${who} → ${VERB_LABEL[verb] || verb || 'an action'}` };
  }

  const reason = String(rec.reason || '');
  // EVERY KEY HERE IS A REASON `input.js` ACTUALLY REPORTS, checked against the source
  // rather than invented - an explanation for a reason the bus never emits is a comforting
  // lie, and one it does emit that is missing here shows up as a bare code at the bedside.
  const say = {
    unbound: 'is not bound to anything yet',
    'role-gated': 'is bound, but the gate is refusing it from whoever pressed it',
    'unknown-action': 'is bound to something that no longer exists',
    'too-short': `was released too quickly — it needs ${rec.holdMs || 'a longer'}ms`,
    debounce: 'came too soon after the last one and was treated as a bounce',
    lockout: 'is still inside its repeat lockout from the last press',
    'auto-release': 'was let go by the watchdog rather than by a person — usually a stuck switch',
  }[reason] || `was refused (${reason || 'no reason recorded'})`;

  return { ok: false, text: `${who} ${say}` };
}

// The one-line summary that is worth more than the list, because it answers "is it the
// switch or is it us" before anybody reads a single row.
export function verdict(records = []) {
  const list = (records || []).filter(Boolean);
  if (!list.length) {
    // NOT "no errors". A screen that has heard nothing at all is the loudest possible
    // symptom - it means the press is not reaching the software, so the repair is the
    // cable, the battery or the jack, and nobody should be reading bindings yet.
    return { tone: 'quiet', text: 'Nothing has been pressed yet — the screen has heard nothing at all' };
  }
  const refused = list.filter((r) => !r.accepted);
  if (!refused.length) return { tone: 'good', text: `${list.length} presses, all of them accepted` };
  if (refused.length === list.length) {
    const reasons = [...new Set(refused.map((r) => r.reason).filter(Boolean))];
    return {
      tone: 'bad',
      text: `Every press is being refused${reasons.length === 1 ? ` — ${reasons[0]}` : ''}`,
    };
  }
  return { tone: 'mixed', text: `${list.length - refused.length} of ${list.length} presses accepted` };
}

// ---------------------------------------------------------------------------------
// Rendering. Deliberately plain: this is read by somebody standing up.
// ---------------------------------------------------------------------------------
export function renderControls(el, { bindings, targets, gate, subject }) {
  const rows = whatCanIPress({ bindings, targets, gate, subject });
  if (!rows.length) {
    el.innerHTML = '<p class="cv-none">Nothing is bound yet. Set controls up on the Inputs page.</p>';
    return rows;
  }
  el.innerHTML = `<table class="cv-table">${rows.map((r) => `
    <tr class="cv-${r.status}">
      <td class="cv-key">${esc(r.control)}</td>
      <td class="cv-verb">${esc(r.verbLabel)}</td>
      <td class="cv-says">${esc(r.says)}${r.holdMs ? ` <span class="cv-hint">hold ${r.holdMs}ms</span>` : ''}</td>
    </tr>`).join('')}</table>`;
  return rows;
}

export function renderActivity(el, records = []) {
  const v = verdict(records);
  const lines = (records || []).slice(-12).reverse().map(explainActivation);
  el.innerHTML = `
    <p class="cv-verdict cv-${v.tone}">${esc(v.text)}</p>
    ${lines.length ? `<ul class="cv-log">${lines.map((l) => `
      <li class="${l.ok ? 'cv-ok' : 'cv-no'}">${esc(l.text)}</li>`).join('')}</ul>` : ''}`;
  return { verdict: v, lines };
}

// Both pages, ready to hand to the settings menu.
export function controlPages({ runtime, subjectName = () => '' }) {
  return {
    controls: {
      title: 'What can I press right now',
      render: (el) => renderControls(el, {
        bindings: runtime.record().bindings,
        targets: runtime.router.targets(),
        gate: runtime.gate(),
        subject: subjectName(),
      }),
    },
    activity: {
      title: 'Why nothing happened',
      render: (el) => renderActivity(el, runtime.recentActivity()),
    },
  };
}

export const CONTROL_ITEMS = [
  { kind: 'heading', id: 'controls-head', label: 'Controls' },
  { kind: 'item', id: 'controls', label: 'What can I press right now', page: 'controls' },
  { kind: 'item', id: 'activity', label: 'Why nothing happened', page: 'activity' },
];
