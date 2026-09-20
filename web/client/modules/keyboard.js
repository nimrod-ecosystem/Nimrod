// Keyboard — the first "each input device is its own module" module (H4 in the private
// backlog, port-order step 3). Shows what every key on this person's keyboard currently
// does: their own saved bindings if they have any, the shipped defaults if they don't -
// "bindable must never mean arrives unconfigured" (input_keyboard.js's own rule) applies
// here too, so an unconfigured person sees the real, working defaults, not an empty list.
//
// READ-ONLY BY DESIGN, FOR NOW - genuinely not the smaller half of H4's ask, and worth
// saying why rather than quietly under-building it. `input_runtime.js` states its own
// contract plainly: "WHAT IT DELIBERATELY DOES NOT DO: no binding EDITOR. Capturing a
// control, naming it and saving it is the binder's job and stays on the home side. This
// runtime only consumes." A device module mounted via this runtime editing bindings
// in place would contradict that stated boundary, not extend it - so this module shows
// the real, live record (per the runtime's own contract) and links out to the existing
// Devices/Inputs page for the actual edit, rather than growing a second binding editor
// nobody asked this file to keep in sync with the first one. Whether editing capability
// should eventually MOVE into device modules (retiring the binder's exclusivity) is a
// real architectural question, not answered here - see MIKE_CHANGE_LIST.md §0f-2.

import { registerModule } from '../module.js';
import { normalizeRecord, INPUTS_KEY } from '../input_runtime.js';
import { KEYBOARD_DEVICE, DEFAULT_BINDINGS } from '../input_keyboard.js';
import { VERBS, FOCUS_VERBS } from '../actions.js';

const VERB_LABEL = Object.fromEntries([...VERBS, ...FOCUS_VERBS].map((v) => [v.id, v.label]));
const labelForAction = (actionId) => {
  if (actionId === 'system/role-cycle') return 'Cycle who may act';
  const verbId = String(actionId || '').replace(/^verb\//, '');
  return VERB_LABEL[verbId] || actionId || '(unknown)';
};

// "key:ctrl+shift+e" -> "Ctrl + Shift + E"; a few keys get a friendlier word than their
// raw `e.key` name (input_keyboard.js's own `keyControl` is what produced these strings).
const KEY_WORD = {
  arrowup: 'Arrow Up', arrowdown: 'Arrow Down', arrowleft: 'Arrow Left', arrowright: 'Arrow Right',
  ' ': 'Space', escape: 'Esc', enter: 'Enter',
};
function formatControl(control) {
  const raw = String(control || '').replace(/^key:/, '');
  const parts = raw.split('+');
  return parts
    .map((p) => KEY_WORD[p] || (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' + ');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

registerModule(
  { type: 'keyboard', title: 'Keyboard', core: 'new', dependsOn: 'server',
    description: "what each key does right now - this person's own bindings, or the shipped defaults" },
  (ctx) => {
    const { mount } = ctx;
    let personState = null;
    let unsubscribe = null;
    let torn = false;

    function render(record) {
      if (torn) return;
      const rows = record.bindings
        .filter((b) => b.device === KEYBOARD_DEVICE)
        .map((b) => `
          <div class="kb-row">
            <span class="kb-key">${esc(formatControl(b.control))}</span>
            <span class="kb-arrow" aria-hidden="true">&rarr;</span>
            <span class="kb-action">${esc(labelForAction(b.actionId))}</span>
          </div>`)
        .join('');
      const list = mount.querySelector('[data-kb-rows]');
      if (list) list.innerHTML = rows || '<p class="kb-empty">No keyboard bindings yet.</p>';
    }

    return {
      async init() {
        mount.innerHTML = `
          <div class="keyboard-mod">
            <div class="kb-head">
              <h3>Keyboard</h3>
              <a class="kb-edit" href="/home.html" title="opens the Devices tab, where bindings are edited">Edit in Devices settings &#8599;</a>
            </div>
            <div data-kb-rows class="kb-rows"><p class="kb-empty">Loading&hellip;</p></div>
          </div>`;

        const style = document.createElement('style');
        style.textContent = `
          .keyboard-mod{display:flex;flex-direction:column;gap:10px;padding:14px;height:100%;box-sizing:border-box}
          .keyboard-mod .kb-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
          .keyboard-mod h3{margin:0;color:var(--text-strong)}
          .keyboard-mod .kb-edit{font-size:.9rem;color:var(--accent);text-decoration:none;white-space:nowrap}
          .keyboard-mod .kb-edit:hover{text-decoration:underline}
          .keyboard-mod .kb-rows{display:flex;flex-direction:column;gap:6px;overflow:auto}
          .keyboard-mod .kb-row{display:flex;align-items:center;gap:10px;padding:8px 10px;
            border:1px solid var(--border);border-radius:var(--radius, 10px);background:var(--surface)}
          .keyboard-mod .kb-key{font-weight:700;color:var(--text-strong);min-width:9em}
          .keyboard-mod .kb-arrow{color:var(--text-soft, #888)}
          .keyboard-mod .kb-action{color:var(--text-strong)}
          .keyboard-mod .kb-empty{color:var(--text-soft, #888);font-style:italic}
        `;
        mount.appendChild(style);

        // Shipped defaults render immediately, before any network - the same "bindable never
        // means arrives unconfigured" promise `input_runtime.js` already makes elsewhere.
        render(normalizeRecord(null, DEFAULT_BINDINGS));

        const pid = ctx.personId;
        if (!pid || !ctx.makePersonState) return;   // no person on this screen - defaults stand
        personState = await ctx.makePersonState(pid, INPUTS_KEY);
        if (torn || !personState) return;
        try { await personState.load?.(); } catch { /* offline - defaults already shown */ }
        if (torn) return;
        render(normalizeRecord(personState.get?.(), DEFAULT_BINDINGS));
        unsubscribe = personState.subscribe?.((saved) => {
          if (!torn) render(normalizeRecord(saved, DEFAULT_BINDINGS));
        });
      },
      onResize() {},
      onHide() {},
      destroy() {
        torn = true;
        try { unsubscribe?.(); } catch { /* already gone */ }
      },
    };
  },
);
