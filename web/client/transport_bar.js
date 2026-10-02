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
import { panelVolumeFrom, toggleMutePatch } from './panel_sound.js';

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

// ---------------------------------------------------------------------------------------------------
// *** PAUSE / PLAY, ONE BUTTON FOR WHATEVER PANEL IS SELECTED (2026-10-02). *** Drawn the same on both
// bars from the shell's state ({ can, paused, name }); the shell does the pausing (kiosk.js argues it).
// DIMMED, NEVER HIDDEN, when the selected panel has nothing to pause (D16: a button that vanishes costs a
// switch user a press to learn it went), and it says so in its title. A FIXED WIDTH, so "Pause" turning
// into "Play" never moves a button after it (PRIORITY.md #3's same-position rule).
export const PLAY_PAUSE_ACT = 'playpause';
export function paintPlayPause(btn, s = {}) {
  if (!btn) return;
  const can = !!(s && s.can);
  const paused = !!(s && s.paused);
  const name = (s && s.name) || 'the selected panel';
  btn.disabled = !can;
  btn.textContent = paused ? '▶ Play' : '⏸ Pause';
  btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  btn.style.minWidth = '6.2em';
  btn.title = !can ? `${name} has nothing to pause` : paused ? `play ${name} again` : `pause ${name}`;
}

// ---------------------------------------------------------------------------------------------------
// *** A LIVE CALL'S CONTROLS ON THE BAR (2026-10-02). *** From the call panel's own report
// (actions.js CALL_CONTROLS_TOPIC; modules/call.js): shown only while a call is live, gone the moment it
// ends. Each button says what pressing it DOES ("Mute my mic", then "Unmute my mic") and is lit while the
// thing is off, so somebody walking in can see why nobody hears them. A video control on an audio-only
// call is DIMMED rather than missing (D16). `send(payload)` is the bar's way to say CALL_CONTROL_TOPIC.
// The group is `display:contents` inside the bar's own row of buttons, so it wraps with them.
export function drawCallControls(el, s, send) {
  if (!el) return;
  el.innerHTML = '';
  const live = !!(s && s.live);
  el.hidden = !live;
  el.style.display = live ? 'contents' : 'none';
  if (!live) return;
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'this call');
  const pct = Math.round((Number(s.volume) || 0) * 100);
  const b = (act, label, off, title, payload, disabled = false) => {
    const btn = el.ownerDocument.createElement('button');
    btn.type = 'button';
    btn.dataset.call = act;
    btn.textContent = label;
    btn.title = title;
    btn.style.minWidth = '7.4em';
    btn.disabled = !!disabled;
    if (off) btn.dataset.on = '1';
    btn.setAttribute('aria-pressed', off ? 'true' : 'false');
    btn.addEventListener('click', () => { if (!btn.disabled) { try { send?.(payload); } catch (err) { console.error('transport bar: call', err); } } });
    el.append(btn);
  };
  b('mic', s.mic ? 'Mute my mic' : 'Unmute my mic', !s.mic,
    s.mic ? 'they can hear this room — press to mute your microphone' : 'your microphone is muted — they cannot hear you',
    { mic: 'toggle' }, s.hasMic === false);
  b('speaker', s.speaker ? 'Mute speaker' : 'Unmute speaker', !s.speaker,
    s.speaker ? 'press to stop hearing them in this room' : 'their sound is muted in this room', { speaker: 'toggle' });
  b('their', s.theirVideo ? 'Hide their video' : 'Show their video', !s.theirVideo,
    !s.video ? 'this is an audio call: there is no video of them' : s.theirVideo ? 'show their name instead of their picture' : 'their picture is hidden',
    { theirVideo: 'toggle' }, !s.video);
  b('mine', s.myVideo ? 'Hide my video' : 'Show my video', !s.myVideo,
    !s.sending ? 'no camera is being sent on this call' : s.myVideo ? 'stop sending your camera — they will not see you' : 'they cannot see you — press to send your camera again',
    { myVideo: 'toggle' }, !s.sending);
  b('quieter', 'Call quieter', false, `the call is at ${pct}%`, { volume: -1 });
  b('louder', 'Call louder', false, `the call is at ${pct}%`, { volume: 1 });
}

// *** A PIECE OF THE ROOM, SELECTED (2026-10-02; Mike's list 09-30 ~1341). *** When the switch scan is on a
// piece of a dashboard's room (a door, the window -- arrangement.js `focusedTarget`), BOTH bars say so the
// same way, from here:
//   * the piece has its own chip, lit, with its name (`drawChips`, from `barModel`'s `piece`), and no panel's
//     chip is lit;
//   * Switch module is dimmed, its title saying why (`PIECE_SWITCH_TITLE`): a piece is not a panel;
//   * Back and Next -- the selected PANEL's previous / next thing -- are dimmed too (`paintPieceInert`). They
//     would do nothing (kiosk.js `panelSubject`), and a button that does nothing must say so (D16). Pause is
//     dimmed already: the shell reports it can't, for a piece.
/** The selected stop when it is a piece of the room (arrangement.js `focusedTarget`), else null. */
export function pieceOf(arr) {
  try { const t = arr?.focusedTarget?.(); return t && t.kind === 'piece' ? t : null; } catch { return null; }
}
export const PIECE_SWITCH_TITLE = (label) => `${label} is part of the room, not a panel: Switch module is for panels`;
// The buttons that act on the selected panel's content, dimmed while a piece is selected.
export const PIECE_INERT_ACTS = Object.freeze(['back', 'next']);
/** Dim `PIECE_INERT_ACTS` under `scope` while `piece` is selected (title says why); put them back after. */
export function paintPieceInert(scope, piece) {
  if (!scope || typeof scope.querySelector !== 'function') return;
  for (const act of PIECE_INERT_ACTS) {
    const b = scope.querySelector(`[data-act="${act}"]`);
    if (!b) continue;
    if (b.dataset.baseTitle === undefined) b.dataset.baseTitle = b.title || '';
    b.disabled = !!piece;
    b.title = piece ? `${piece.label} is selected: ${act === 'next' ? 'Next' : 'Back'} is for panels` : b.dataset.baseTitle;
  }
}
function drawPieceChip(modsEl, piece, focus) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'k-dot on k-piece';
  b.dataset.piece = piece.id;
  b.textContent = piece.label;
  b.setAttribute('aria-current', 'true');
  b.setAttribute('aria-label', `In the room: ${piece.label}, selected`);
  b.title = 'a piece of the room is selected: select presses it, and the ⚙ menu shows its options';
  // Pressed: it stays selected, as a panel's chip does.
  b.addEventListener('click', () => { try { focus?.(piece.id); } catch { /* it has gone */ } });
  modsEl.append(b);
}

/**
 * The model both bars draw from, read fresh from an arrangement (`arrangement.js`) and an input
 * runtime-like object (`{ router }`). Pure reads; nothing is kept.
 */
export function barModel(arr, runtime, { audio = null } = {}) {
  if (!arr) return null;
  // 2026-10-02: with the scan on a PIECE of the dashboard's room (arrangement.js `focusedTarget`), that piece
  // is what is lit -- its own chip, `piece` -- and no panel's.
  const piece = pieceOf(arr);
  return {
    layout: arr.layout(), profile: arr.profile() || { modules: [] }, slotRecs: arr.slotRecs,
    placedRecs: arr.placedRecs || [],             // Stage R: modules placed freely are panels too
    stageDefs: arr.stageDefs(), primary: arr.primary(), focusId: piece ? piece.id : arr.focusedRec()?.id,
    piece: piece ? { id: piece.id, label: piece.label } : null,
    runtime: runtime || null,
    focusPlaced: arr.focusPlaced, showUnplaced: arr.showUnplaced, showPrimary: arr.showPrimary,
    instanceTitle: arr.instanceTitle,
    audio,                                        // 2026-10-02: a TV's sound, on its chip
  };
}

// *** A TV'S SOUND, ON ITS CHIP (2026-10-02). *** Mike, on a TV in a room showing a live dashboard that
// plays sound: "It has to be accessible through the transport bar and settings menu." A panel that is a
// DASHBOARD (a TV, a billboard: modules/view.js nested) and has sound on it gets a second, small button
// right after its chip: "Sound" / "Muted", pressed to toggle the whole TV (panel_sound.js, the panel's own
// row, so the menu's rows and another device agree with it). Volume and each thing on the TV are the
// menu's Sound tab. Only dashboards: every sound-making panel getting one would double a bar that already
// has to fit nine chips on a small tablet (transport_test), and the menu has the rest.
const NESTED_TYPES = new Set(['dashboard', 'view']);
function drawSoundToggle(modsEl, rec, audio) {
  if (!rec || !NESTED_TYPES.has(rec.type) || !rec.state || !audio?.sourcesOf) return;
  let has = false;
  try { has = (audio.sourcesOf(rec.id) || []).length > 0; } catch { has = false; }
  if (!has) return;
  const row = rec.state.get?.() || {};
  const muted = panelVolumeFrom(row) === 0;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'k-dot-sound';
  b.dataset.soundFor = rec.id;
  b.textContent = muted ? 'Muted' : 'Sound';
  b.setAttribute('aria-pressed', muted ? 'true' : 'false');
  b.setAttribute('aria-label', `${rec.title || rec.type}: ${muted ? 'muted, press for sound' : 'sound on, press to mute'}`);
  b.title = muted ? 'sound off on this panel — press for sound' : 'press to mute this panel';
  b.addEventListener('click', () => {
    try { rec.state.set(toggleMutePatch(rec.state.get?.() || {})); } catch (err) { console.error('transport bar: sound', err); }
    b.textContent = b.textContent === 'Muted' ? 'Sound' : 'Muted';
  });
  modsEl.append(b);
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
        drawSoundToggle(modsEl, rec, m.audio);
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
    // A selected piece of the room: its own chip, last (after the panels, as in the switch lap).
    if (m.piece) drawPieceChip(modsEl, m.piece, focusPlaced);
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
