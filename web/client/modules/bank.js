// modules/bank.js — THE QUESTIONS AND WORDS, as a MODULE rather than as a tab.
//
// Mike, 2026-08-31, on the tab I had added for this:
//
//   *"Could it be a module and have a link from the modules that feed off of it?"*
//
// Yes, and it is better, for a reason that is about this project's shape rather than about
// screen space. **Almost everything here is a module**, and a tab is an exception that has to
// earn itself. This one could not: the bank is content on a screen, edited by whoever sets that
// screen up, and adding it to a screen is exactly the gesture the composer already exists for.
//
// It also puts the thing next to what uses it. A tab called "Questions" sits in a sidebar with
// no relationship to the games; a module sits on the same screen as Trivia and Word Forge, which
// is where somebody wondering *"where do the questions come from?"* is actually looking.
//
// ---------------------------------------------------------------------------------------
// WHERE THE BANK LIVES, AND WHY IT IS NOT THIS MODULE'S OWN STATE
// ---------------------------------------------------------------------------------------
//
// **A module's own state is the wrong place for content two other modules read.** If the bank
// lived in this instance's row, a screen with the editor removed would lose its questions, and
// two editors on one screen would each hold half a syllabus.
//
// So it lives in a SHARED per-profile row — `ctx.makeState('bank')` — the same handle the
// director uses to reach its children's storage. Trivia and Word Forge open the same row by the
// same key. Nobody owns it; everybody reads it.
//
// *(A later refinement worth naming rather than doing quietly: per-PERSON would be better still,
// so a syllabus follows somebody to any screen the way their input bindings already do. Modules
// have no per-person handle today, and inventing one here — in a content editor — would be
// smuggling a new capability in through the side door. It wants doing deliberately.)*
//
// ---------------------------------------------------------------------------------------
// THE LINK BACK, WHICH IS THE HALF THAT MAKES IT FINDABLE
// ---------------------------------------------------------------------------------------
//
// A tab is discoverable by existing. A module is not — somebody has to know to add it. That is
// the one real cost of this change, and it is paid the way Mike suggested: **the modules that
// feed off the bank say where their content comes from**, and say it loudest when they have
// none. See the empty state in `trivia.js`.
//
// It announces itself on `BANK_TOPIC` whenever the content changes, so a game on the same screen
// picks up an edit without anybody remounting anything — a caregiver typing questions on one
// half of the screen while somebody plays on the other is a real thing to want, and it costs one
// publish.

import { registerModule } from '../module.js';
import { mountBankPanel, BANK_KEY } from '../bank_panel.js';

// The shared row every game and this editor open by name. One key, one document.
export const BANK_STATE = 'bank';
export const BANK_TOPIC = 'bank/changed';

registerModule(
  { type: 'bank', title: 'Questions',
    description: 'The words and questions your games ask. Write your own, or paste a list in.',
    dependsOn: 'server', importance: 'optional' },
  (ctx) => {
    const { mount, bus } = ctx;
    let shared = null;
    let panel = null;

    return {
      __probe: () => ({ mounted: !!panel, text: (shared?.get?.() || {})[`${BANK_KEY}Text`] || '' }),
      init() {
        // THE SHARED ROW, not this instance's own — see the header.
        shared = ctx.makeState ? ctx.makeState(BANK_STATE) : ctx.state;
        panel = mountBankPanel(mount, {
          settings: () => shared?.get?.() || {},
          save: async (patch) => {
            shared?.set?.(patch);
            await shared?.flush?.();
            // A game on the same screen picks up the edit without a remount.
            bus.publish(BANK_TOPIC, { key: BANK_STATE });
          },
        });
        Promise.resolve(shared?.load?.())
          .catch(() => {})                      // offline is not a reason to have no editor
          .then(() => panel.refresh())
          .then(() => shared?.startPolling?.())
          .catch((err) => console.error('bank: load', err));
      },
      onResize() {},
      onHide() { shared?.flush?.(); },
      destroy() {
        try { panel?.destroy(); } catch { /* already gone */ }
        panel = null;
        try { shared?.destroy?.(); } catch { /* already gone */ }
        shared = null;
      },
    };
  },
);
