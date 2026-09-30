// transport_bar.js — THE CHIPS ON A TRANSPORT BAR: which panels there are, which one is lit, and
// what pressing each one does. Step 6 Stage 3b (2026-09-30).
//
// Moved VERBATIM out of kiosk.js's `renderMods` so there is ONE implementation of the chips, drawn by
// two bars: the kiosk shell's own PLAIN bar (the one no dashboard can remove), and the transport bar
// MODULE a dashboard places (`modules/transport_bar.js`, Mike 2026-09-30: "They are modules ...
// placed in the dashboard"). Everything the chips read is handed in -- the arrangement's state, the
// input runtime (for which panels a switch can reach) and the three moves -- so the body below is the
// kiosk's own code, comments and all, apart from being at module level. The documented fixes it
// carries (G4 grid chips, G9 unplaced reachable, D16 no self-deleting chip, PRIORITY.md #3 stable
// order) are pinned by transport_test and re-proven by the step 6 revert harness against THIS file.
//
// *** AND THE NIMROD BUTTON (row 2.37, 2026-09-30), ALSO ONCE, FOR BOTH BARS. *** Mike (room_as_home
// §7.1.2): Nimrod the cat *"tells you about whatever you selected when you click on him."* On a room
// the room's own cat is that button; everywhere else it is this one, on the bar. `drawHelpButton` makes
// the button both bars show; `mountBarHelp` is the one cat a SHELL brings for it (the placed bar says
// SHELL_HELP and the shell's cat answers -- one cat per screen, not one per bar). "Cat help" off (the
// person's own setting, cat_guide.js) = NO BUTTON, not a button that does nothing.

import { readCatPrefs } from './cat_guide.js';
import { mountCatHelp, selectionFrom } from './cat_help.js';

export const HELP_ACT = 'help';

/** Is the Nimrod button offered? The person's "Cat help" (on by default). Unreadable = on. */
export function helpOn(storage) {
  try { return readCatPrefs(storage).help !== false; } catch { return true; }
}

/**
 * The Nimrod button, the same on both bars: put into `parent` before `before` (the gear, so the way
 * out stays last). `onPress` is what the bar does with it. Returns the button.
 */
export function drawHelpButton(parent, { before = null, onPress = null, doc = parent?.ownerDocument } = {}) {
  if (!parent || !doc) return null;
  const b = doc.createElement('button');
  b.type = 'button';
  b.dataset.act = HELP_ACT;
  b.className = 'k-help';
  b.textContent = 'Nimrod';
  b.title = 'Nimrod explains what is picked: pick a panel or a setting, then press';
  b.setAttribute('aria-label', 'Nimrod: explain what is picked');
  b.addEventListener('click', () => { try { onPress?.(); } catch (err) { console.error('transport bar: help', err); } });
  if (before && before.parentNode === parent) parent.insertBefore(b, before);
  else parent.append(b);
  return b;
}

/**
 * The shell's cat, for the bar's button: explains the picked thing -- an open menu's cursor row, a
 * selected thing that carries `data-help`, else the focused panel (`focused()`: an arrangement record,
 * `{ type, el }`), else the screen. Made on the first press (cat_help draws nothing until then anyway).
 * `output` is a getter: the shell's output bus can arrive after the bar does.
 */
export function mountBarHelp(host, { output = () => null, storage, focused = () => null, doc = host?.ownerDocument } = {}) {
  let cat = null;
  const proxy = {
    say: (...a) => output()?.say?.(...a),
    cancel: (...a) => output()?.cancel?.(...a),
  };
  function getSelection() {
    let s = null;
    try { s = selectionFrom(doc, { scope: host }); } catch { s = null; }
    if (s && s.kind !== 'screen') return s;
    let r = null;
    try { r = focused?.() || null; } catch { r = null; }
    return r ? { kind: 'module', type: r.type, el: r.el || null } : s;
  }
  return {
    /** Explain what is picked. Null when "Cat help" is off (or there is nowhere to stand). */
    explain() {
      if (!host) return null;
      if (!cat) {
        const opts = { output: proxy, screen: 'kiosk', getSelection, doc };
        if (storage !== undefined) opts.storage = storage;
        cat = mountCatHelp(host, opts);
      }
      return cat ? cat.explain() : null;
    },
    shown: () => !!cat?.shown(),
    close: () => cat?.close(),
    destroy() { try { cat?.destroy(); } catch { /* already gone */ } cat = null; },
  };
}

/**
 * The model both bars draw from, read fresh from an arrangement (`arrangement.js`) and an input
 * runtime-like object (`{ router }`). Pure reads; nothing is kept.
 */
export function barModel(arr, runtime) {
  if (!arr) return null;
  return {
    layout: arr.layout(), profile: arr.profile() || { modules: [] }, slotRecs: arr.slotRecs,
    placedRecs: arr.placedRecs || [],             // Stage R: modules placed freely are panels too
    stageDefs: arr.stageDefs(), primary: arr.primary(), focusId: arr.focusedRec()?.id,
    runtime: runtime || null,
    focusPlaced: arr.focusPlaced, showUnplaced: arr.showUnplaced, showPrimary: arr.showPrimary,
    instanceTitle: arr.instanceTitle,
  };
}

// *** THE TRANSPORT BAR. ***
//
// This used to return immediately whenever a layout was present, on the reasoning that there
// is "nothing to switch between — it's all visible". That was true of SWITCHING and wrong
// about the bar: what Mike saw on the live site was `Screens · Next · Mirror · Hush · ⚙ · ⛶`
// with no per-module buttons at all (G4), on exactly the screens where naming a panel matters
// most — and it is why the gear could not show panel settings either, since both were reading
// the same missing concept.
//
// So on a grid the buttons still exist; pressing one MOVES FOCUS rather than swapping the
// stage, because on a grid there is nothing to swap. Same button, two meanings, and the
// difference is a property of the screen rather than of the control — which is what keeps it
// one bar instead of two.
/** Draw the chips into `modsEl` (emptied first). `m` is a `barModel`. */
export function drawChips(modsEl, m) {
  if (!modsEl || !m) return;
  const { layout, profile, slotRecs, placedRecs = [], stageDefs, primary, focusId, runtime,
          focusPlaced, showUnplaced, showPrimary, instanceTitle } = m;
  modsEl.innerHTML = '';
  if (layout) {
    // *** ONE STABLE ORDER, FROM `profile.modules`, WHETHER A PANEL IS PLACED OR NOT. ***
    //
    // PRIORITY.md #3: "panels rearranging when focus changes, which violates the same-position
    // rule the whole product depends on."
    //
    // This used to draw every PLACED panel first and then every unplaced one, so the moment a
    // panel moved between those two groups the whole bar reshuffled. Measured on a five-panel
    // screen, pressing one off-screen chip:
    //
    //     Photos, Trivia, Word Forge, Quests, Pond  ->  Trivia, Word Forge, Photos, Pond
    //
    // Three buttons that had nothing to do with the swap moved under the finger. For somebody
    // scanning this bar with one switch, a button that moves is a press spent on the wrong
    // thing -- which is exactly what the same-position rule exists to prevent.
    //
    // `profile.modules` is the stable identity order both halves were already derived from,
    // so ordering by it costs nothing and cannot reshuffle: being placed or unplaced becomes
    // a STATE the chip carries (`k-off`), not a position it moves to.
    //
    // *** ONLY PANELS THE ROUTER WILL ACTUALLY FOCUS GET A BUTTON. ***
    //
    // `reachable()` is the router's own list -- a module type absent from the verb map is
    // never focused, which is deliberate and documented there. The CLOCK is the standing
    // example: it declares no verbs, so nothing can be done to it, so focusing it would
    // strand a switch on a panel with nothing to press.
    //
    // My first version listed every slot and produced a Clock button that did nothing when
    // pressed -- a control that lies about what it can do, which on this bar is worse than a
    // missing one: somebody with one switch spends a press finding out.
    //
    // *** D16, AND IT IS FIXED RATHER THAN ASKED ABOUT. ***
    //
    // A module with no verbs (quests, trivia, word forge...) HAD a chip while it was
    // unplaced, because pressing it did something real -- it brought the panel on screen.
    // The moment it landed it stopped being `reachable`, and its chip disappeared. **So
    // pressing a button deleted that button, and there was no way to send the panel back.**
    //
    // Chat, and this is the whole of it: *"a control that removes itself when pressed is the
    // failure mode Nimrod exists to prevent. Somebody using one switch cannot recover from
    // it, and on a bedside screen nobody is there to undo it... An empty control area is a
    // correct answer. A vanishing button is not."*
    //
    // So the chip STAYS, and `input_router.setFocus` now accepts any panel on the screen
    // while switch-cycling still visits only panels that answer a verb. What remains is the
    // honesty problem the original filter existed for -- a button must not lie about what it
    // can do -- and that is answered by SAYING SO on the chip rather than by removing it.
    const focusable = new Set((runtime?.router?.reachable?.() || []).map((m) => m.id));
    // Stage R: placed in a slot OR placed freely -- both are on the screen, both are focused by a press.
    const placedIds = new Set([...layout.slots.filter(Boolean), ...(layout.placed || []).map((p) => p.id)]);
    for (const def of profile.modules) {
      // The HUD pair are not panels, the same exclusion `unplacedDefs` makes: an unplaced
      // camera is the mirror overlay and an unplaced clock is the corner clock.
      if (def.type === 'camera' || def.type === 'clock') continue;
      const placed = placedIds.has(def.id);
      if (placed) {
        const rec = slotRecs.find((r) => r.id === def.id) || placedRecs.find((r) => r.id === def.id);
        if (!rec) continue;
        // NOT `continue` any more -- see D16 above. The chip is drawn either way, and says
        // which kind of chip it is instead of disappearing.
        const noControls = focusable.size && !focusable.has(rec.id);
        const b = document.createElement('button');
        b.className = 'k-dot' + (rec.id === focusId ? ' on' : '')
          + (noControls ? ' k-nover' : '');
        if (noControls) {
          b.title = 'nothing on this panel answers a button \u2014 pressing it puts the '
            + 'outline here, and the controls stay empty';
        }
        b.textContent = rec.title || rec.type;
        b.dataset.id = rec.id;
        b.addEventListener('click', () => focusPlaced(rec.id));
        modsEl.append(b);
      } else {
        const b = document.createElement('button');
        b.className = 'k-dot k-off';
        b.textContent = instanceTitle(def);
        b.dataset.id = def.id;
        b.title = 'not in this screen\u2019s arrangement \u2014 show it in the panel that has focus';
        b.addEventListener('click', () => { showUnplaced(def); });
        modsEl.append(b);
      }
    }
    return;
  }

  stageDefs.forEach((d, j) => {
    const b = document.createElement('button');
    b.className = 'k-dot' + (j === primary ? ' on' : '');
    b.textContent = d.type;
    b.dataset.i = j;
    b.addEventListener('click', () => showPrimary(j));
    modsEl.append(b);
  });
}
