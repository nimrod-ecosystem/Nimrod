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
import { verbTopic, BAR_SCAN_TOPIC } from './actions.js';

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
// *** BIGGER / SMALLER, FOR THE SELECTED PANEL (2026-10-02 evening). *** The panel corner's press
// (arrangement.js `promote`, kiosk.js `promotePanel`), on both bars: one level at a time, and at the top
// (the panel fills the screen) the same press goes back down, as the corner does. It is here because a
// corner is a small target in a panel's corner, and the bar is where a finger or a switch already goes.
// Drawn from the shell's state ({ can, smaller, name }); dimmed with no panel selected (D16). Fixed width,
// like Pause / Play, so the words changing never moves a button after it.
export const BIGGER_ACT = 'bigger';
export function paintBigger(btn, s = {}) {
  if (!btn) return;
  const can = !!(s && s.can);
  const smaller = !!(s && s.smaller);
  const name = (s && s.name) || 'the selected panel';
  btn.disabled = !can;
  btn.textContent = smaller ? '⤡ Smaller' : '⤢ Bigger';
  btn.setAttribute('aria-pressed', smaller ? 'true' : 'false');
  btn.style.minWidth = '6.2em';
  btn.title = !can ? 'no panel is selected' : smaller ? `make ${name} smaller` : `make ${name} bigger, one step at a time`;
}

// ---------------------------------------------------------------------------------------------------
// *** A PRESS THAT WAKES THE BAR IS NOT ALSO A PRESS ON IT (2026-10-02, late), BOTH BARS. *** Measured: a
// tap on the calculator's "=" where the hidden plain bar sat sent its click to `.k-controls`. Both bars come
// back on a press's pointerdown, and the rest of that press is hit-tested AGAIN -- a touch's tap at its point
// when it lifts, a mouse's release where it is -- by which time the bar is there. So the key the person was
// looking at and pressing lost the press: to the bar under a finger, to nothing at all under a mouse (its
// click goes to what the press and the release share). A mouse whose pointer is already near the bar has
// woken it before any press, so this is the touch screen's case most of all.
//
// WHERE THE PRESS GOES, ARGUED: to whatever was under it when it began, not nowhere. The bar was not on the
// screen when the press started, so what the person aimed at is what they could see -- a key, a photo, a
// game's button -- and the module under the finger is exactly as pressable as it looked. AGAINST: a person
// who taps the bottom edge only to call the bar up presses whatever is there too. But that is a visible,
// pressable thing they put their finger on; "a press does nothing" would make every first tap on a touch
// screen a dud, and teach that the screen ignores you. The press-only-wakes option is still there for
// anybody who wants it: a mouse near the bar, a key, or a switch wakes it without pressing anything.
//
// HOW: the bar sits out that one press -- `pointer-events:none`, inline, from its pointerdown until the press
// has been aimed. The click (which is hit-tested before it is dispatched) ends it; so does a cancelled press;
// and a release with no click after it (a drag, a long press) ends it `settleMs` later. (Should a release
// never be reported at all, the next press ends it: a bar is never left unpressable.)
// `WAKE_PRESS_SETTLE_MS`, argued rather than chosen: a tap's click comes straight after the finger lifts, but
// a browser that still waits to see whether a tap is the first of a double-tap holds it ~300 ms -- so 400
// covers that. It only matters when no click comes, and a person cannot see a bar appear, aim and press it
// again inside 400 ms. Not a setting: it answers "when has this press been delivered", which nobody chooses.
export const WAKE_PRESS_SETTLE_MS = 400;
/** The bar `el` sits out the press `ev` (the pointerdown that woke it). Returns a function that ends it now. */
export function sitOutWakePress(el, ev, { settleMs = WAKE_PRESS_SETTLE_MS } = {}) {
  const w = el?.ownerDocument?.defaultView;
  if (!w || !ev || ev.type !== 'pointerdown' || el.dataset.waking) return () => {};
  const prev = el.style.pointerEvents;
  el.dataset.waking = '1';
  el.style.pointerEvents = 'none';
  let t = null;
  const id = ev.pointerId;
  const done = () => {
    clearTimeout(t); t = null;
    w.removeEventListener('click', done, true);
    w.removeEventListener('pointerup', onEnd, true);
    w.removeEventListener('pointercancel', done, true);
    w.removeEventListener('pointerdown', onNext, true);
    if (!el.dataset.waking) return;
    delete el.dataset.waking;
    el.style.pointerEvents = prev;
  };
  const onEnd = (e) => {
    if (e && id !== undefined && e.pointerId !== id) return;
    clearTimeout(t);
    t = setTimeout(done, settleMs);
  };
  // The backstop, should a release never be reported: the next press means this one is over.
  const onNext = (e) => { if (e !== ev) done(); };
  w.addEventListener('click', done, true);
  w.addEventListener('pointerup', onEnd, true);
  w.addEventListener('pointercancel', done, true);
  w.addEventListener('pointerdown', onNext, true);
  return done;
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

// ===================================================================================================
// *** THE BAR BY SWITCH: A GROUP, THEN A BUTTON IN IT (2026-10-02; Mike's list 09-30 ~684, "Not built:
// Design's row/column switch scan of the bar"; Design's home-dashboard spec, "Row-column scanning"). ***
//
// Until now a switch could not press this bar at all: its buttons answered a pointer, and a switch reached
// the same things only through actions bound one by one. `BAR_SCAN_TOPIC` (actions.js; bindable) hands the
// bar the switch: next / prev / select / back walk IT instead of the panels, and the panels' router is
// paused meanwhile (the tray's, the menu's and the library's rule: one holder of the scan at a time).
//
// THE GROUPS, in the order the eye reads the bar (both bars draw them in this order, so DOM order IS it):
//   page       a host page's own buttons (Home: Modules, Save, Save as, History) -- only on Home
//   panels     the chips (and a TV's Sound, and a selected piece of the room)
//   call       a live call's controls -- only while a call is live, and gone the moment it ends
//   transport  Home, Back, Pause, Next, Panel, Switch module, Mirror, Hush: what acts on the content
//   menu       Nimrod, ⚙ and ⛶ -- the screen's own, last, where the plain bar has always kept them
// Argued: FOR five (Design drew "rows"; this bar is one row, so its rows are these runs of like buttons),
// each contiguous on screen so the dashed scope reads as one thing, and none so long the walk inside it
// is the old linear walk again. AGAINST splitting `transport` (8 stops) into "this panel" (Back, Pause,
// Next, Panel, Switch) and "the screen" (Home, Mirror, Hush): Home sits first and Mirror/Hush last, so the
// two halves would not be contiguous, and a group you cannot see as one block is worse than a longer one.
// Measured on a busy bar (4 page + 6 chips + 6 call + 8 + 3 = 27 stops): one at a time is up to 26 presses
// to the last, groups first at most 4 + 7 = 11.
//
// THE MODES -- a setting (`BAR_SCAN_FIELD`, on the person's row beside "How you choose things"):
//   rows  a group, then a button in it. The first press lights a GROUP, never a button; select goes into
//         it (its first button lit, nothing pressed); select presses; back comes out, and back from the
//         groups gives the switch back to the panels. A group with one button is pressed by the select
//         that would have gone into it (choice_picker.js's rule, so nobody learns two).
//   one   every button that can act, in the bar's order, the first press only lighting the first.
//   follow (the default) the person's "How you choose things": step through -> rows, point and click ->
//         one. Argued: FOR rows always -- only switch users scan this bar, and rows is fewer presses.
//         AGAINST, and it wins: the library already maps the same setting the same way (library.js
//         `scanMode`: step -> rows), and one rule across the product is what lets somebody learn it once.
//         The person who said "step through" is the person who said they use a switch; somebody who did
//         not gets the walk with nothing to learn, which can never strand them.
// A STRAY PRESS DOES NOTHING: the press that hands the bar the switch lights nothing; the next lights a
// group (rows) or the first button (one); only a select on something already lit presses it. And nothing
// on this bar is destructive anyway -- the call's Hang up is not on it, every toggle says which way it is.
//
// TWO QUIET ROUNDS GO BACK UP (Design: "After two quiet rounds the scan goes back up to rows"): two full
// laps of a group with no select and the groups are lit again; two laps of the groups (or of every button,
// one at a time) and the bar lets go. That last step is mine: on Design's page the bar WAS the screen; here
// the panels need the switch too, and a person who has seen everything twice and chosen nothing is the
// person least helped by staying. `quietLaps` (2, Design's number; 0 = never) is an option, not a menu row:
// it is how a scan behaves rather than a preference anybody has asked to change.
// NOBODY PRESSING: after `idleMs` (the kiosk passes the edit view's wait, which the host page's edit bar
// already uses -- the same patience for the same job) it lets go. Holding the scan is never a gate: the
// panels keep playing and a pointer works throughout.
// ANOTHER HOLDER TAKING THE SCAN (the menu, the tray, the library, a ringing call) is noticed at the next
// verb, before it is acted on, and once a second while held (`CHECK_MS`, below): the bar lets go WITHOUT
// handing the panels the switch. Somebody giving the panels the switch back underneath it (the router
// un-paused) is the same.
// THE CURSOR (Design): a solid 4px outline and a 7px inset bar on the lit button -- a shape and a bar, not
// colour alone -- and a dashed outline on the group being scanned and on the bar while it holds the scan.
// Never animated. Colours are the theme's (`--scan-ring`, else `--focus`). The lit button carries
// `data-cursor`, so "land the switch scan on it and Nimrod says what it does" (hover_info.js) reads it.
// ===================================================================================================
export const BAR_SCAN_KEY = 'barScan';
export const BAR_SCAN_MODES = Object.freeze(['follow', 'rows', 'one']);
export const BAR_SCAN_DEFAULTS = Object.freeze({ mode: 'follow', quietLaps: 2 });
export const BAR_SCAN_FIELD = Object.freeze({
  key: BAR_SCAN_KEY, label: 'Walking the bar with a switch', kind: 'choice', level: 'standard',
  default: BAR_SCAN_DEFAULTS.mode,
  options: Object.freeze([
    Object.freeze({ value: 'follow', label: 'As you choose things' }),
    Object.freeze({ value: 'rows', label: 'A group, then a button in it' }),
    Object.freeze({ value: 'one', label: 'One button at a time' }),
  ]),
});
/** The walk a person gets: their own choice, else what "How you choose things" implies. */
export function barScanModeOf(v, chooseMode = 'point') {
  if (v === 'rows' || v === 'one') return v;
  return chooseMode === 'step' ? 'rows' : 'one';
}
// How often a held scan checks whether something else has taken it (see above). Not a UI number: it is
// how long a stale outline may linger after the menu or a call took the scan. Every verb checks at once,
// so a press is never sent to the wrong holder.
const CHECK_MS = 1000;
export const BAR_GROUP_NAMES = Object.freeze({
  page: 'this page', panels: 'the panels', call: 'this call', transport: 'the controls', menu: 'help, settings and full screen',
});

/** Which group a bar button belongs to (both bars: the plain one and the placed module). */
export function barGroupOf(el) {
  if (!el || typeof el.closest !== 'function') return 'transport';
  if (el.closest('[data-call-controls]')) return 'call';
  if (el.closest('.tb-host')) return 'page';
  if (el.closest('[data-mods], .tb-mods')) return 'panels';
  const a = el.dataset?.act;
  if (a === 'help' || a === 'settings' || a === 'fs') return 'menu';
  return 'transport';
}
function isStop(el) {
  if (!el || el.disabled || el.hidden) return false;
  try {
    if (!el.getClientRects().length) return false;            // display:none, or inside it
    const v = el.ownerDocument?.defaultView?.getComputedStyle?.(el)?.visibility;
    return v !== 'hidden';                                     // a tucked placed bar
  } catch { return false; }
}
/** A button's identity across a redraw (the chips are re-made on every change). */
function stopKey(el) {
  const d = el?.dataset || {};
  if (d.act) return `act:${d.act}`;
  if (d.host) return `host:${d.host}`;
  if (d.call) return `call:${d.call}`;
  if (d.piece) return `piece:${d.piece}`;
  if (d.soundFor) return `sound:${d.soundFor}`;
  if (d.id) return `id:${d.id}`;
  if (d.i != null) return `i:${d.i}`;
  return `text:${(el?.textContent || '').trim()}`;
}
/** The bar's groups, in order, each with the buttons that can act now: [{ key, name, stops: [el] }]. */
export function barGroups(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const out = [];
  const byKey = new Map();
  for (const el of root.querySelectorAll('button')) {
    if (!isStop(el)) continue;
    const key = barGroupOf(el);
    let g = byKey.get(key);
    if (!g) { g = { key, name: BAR_GROUP_NAMES[key] || key, stops: [] }; byKey.set(key, g); out.push(g); }
    g.stops.push(el);
  }
  return out;
}

const RING = 'var(--scan-ring, var(--focus, currentColor))';
const LOOKS = {
  scope: { outline: `2px dashed ${RING}`, outlineOffset: '3px', boxShadow: null },
  group: { outline: `3px dashed ${RING}`, outlineOffset: '2px', boxShadow: null },
  item: { outline: `4px solid ${RING}`, outlineOffset: '2px', boxShadow: `inset 0 -7px 0 ${RING}` },
};

/**
 * The bar's switch scan. Everything about the screen is handed in, so the shell decides who holds the
 * scan and this only walks a bar:
 *   bus         the screen's bus: the verbs, and BAR_SCAN_TOPIC (toggles)
 *   barRoot()   THE bar now: the placed module's `.tb-bar`, or the shell's plain `.k-controls`
 *   mode()      'rows' | 'one' (`barScanModeOf`)
 *   othersHold() something else holds the scan (the menu, the tray, the edit view, the library, a call...)
 *   pause(on)   the panels' router; isPaused() whether it still is
 *   show(on)    keep the bar on screen while held (the kiosk's `holdBar`)
 *   idleMs()    let go after this long with nobody pressing (0 = never)
 * Returns { enter, leave, toggle, held, probe, destroy }.
 */
export function createBarScan({
  bus = null,
  barRoot = () => null,
  mode = () => 'one',
  othersHold = () => false,
  pause = () => {},
  isPaused = () => true,
  show = () => {},
  idleMs = () => 0,
  quietLaps = BAR_SCAN_DEFAULTS.quietLaps,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
  const laps0 = Number.isInteger(quietLaps) && quietLaps >= 0 ? quietLaps : BAR_SCAN_DEFAULTS.quietLaps;
  let held = false;
  let level = null;               // null (nothing lit yet) | 'groups' | 'items'
  let gk = null, gAt = 0;         // the lit group: its key, and where it was
  let sk = null, sAt = 0;         // the lit button: its key, and where it was
  let laps = 0;
  let rootEl = null;
  let mo = null;
  let idleT = null, checkT = null;
  const painted = new Map();      // el -> what it looked like before
  const offs = [];

  const modeNow = () => (safe(mode, 'one') === 'rows' ? 'rows' : 'one');
  const rootNow = () => safe(barRoot, null) || null;

  // Where the cursor is, read fresh against the bar as it is drawn now.
  function where() {
    const gs = barGroups(rootNow());
    const rows = modeNow() === 'rows';
    if (!gs.length || level === null) return { gs, rows, gi: -1, list: [], si: -1 };
    let gi = -1;
    if (rows) {
      gi = gs.findIndex((g) => g.key === gk);
      if (gi < 0) { gi = Math.min(gAt, gs.length - 1); if (level === 'items') { level = 'groups'; sk = null; } }
      gk = gs[gi].key; gAt = gi;
      if (level === 'groups') return { gs, rows, gi, list: [], si: -1 };
    } else if (level === 'groups') {
      level = 'items';
    }
    const list = rows ? gs[gi].stops : gs.flatMap((g) => g.stops);
    let si = list.findIndex((el) => stopKey(el) === sk);
    if (si < 0) si = Math.min(sAt, list.length - 1);
    sk = stopKey(list[si]); sAt = si;
    return { gs, rows, gi, list, si };
  }

  function unpaint() {
    for (const [el, was] of painted) {
      try {
        el.style.outline = was.outline; el.style.outlineOffset = was.outlineOffset; el.style.boxShadow = was.boxShadow;
        delete el.dataset.barScan;
        delete el.dataset.cursor;
        if (was.current == null) el.removeAttribute('aria-current'); else el.setAttribute('aria-current', was.current);
      } catch { /* gone */ }
    }
    painted.clear();
  }
  function look(el, kind) {
    if (!el) return;
    if (!painted.has(el)) {
      painted.set(el, { outline: el.style.outline, outlineOffset: el.style.outlineOffset, boxShadow: el.style.boxShadow,
        current: el.getAttribute('aria-current') });
    }
    const l = LOOKS[kind];
    el.style.outline = l.outline;
    el.style.outlineOffset = l.outlineOffset;
    if (l.boxShadow) el.style.boxShadow = l.boxShadow;
    el.dataset.barScan = kind;
    if (kind === 'item') { el.dataset.cursor = ''; el.setAttribute('aria-current', 'true'); }
  }
  function paint() {
    unpaint();
    if (!held) return;
    const r = rootNow();
    if (r) look(r, 'scope');
    const w = where();
    if (level === null || w.gi < 0 && !w.list.length) return;
    if (w.rows) {
      for (const el of w.gs[w.gi].stops) { if (level === 'groups' || el !== w.list[w.si]) look(el, 'group'); }
    }
    const lit = level === 'items' ? w.list[w.si] : null;
    if (lit) {
      look(lit, 'item');
      try { lit.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* no layout */ }
    }
  }

  function watch(on) {
    try { mo?.disconnect(); } catch { /* gone */ }
    mo = null;
    rootEl = null;
    if (!on) return;
    rootEl = rootNow();
    const MO = rootEl?.ownerDocument?.defaultView?.MutationObserver;
    if (!rootEl || typeof MO !== 'function') return;
    // A redraw (chips re-made, the call's controls coming and going, a button dimmed): paint again. Only
    // what changes the stops is watched, so painting (style, data-*) never wakes it.
    mo = new MO(() => { if (held) { if (!stillMine()) return; paint(); } });
    mo.observe(rootEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
  }
  function armIdle() {
    if (idleT != null) { clearTimer(idleT); idleT = null; }
    if (!held) return;
    const ms = Number(safe(idleMs, 0)) || 0;
    if (ms > 0) idleT = setTimer(() => { idleT = null; leave(); }, ms);
  }
  function armCheck() {
    if (checkT != null) { clearTimer(checkT); checkT = null; }
    if (!held) return;
    checkT = setTimer(() => { checkT = null; if (stillMine()) armCheck(); }, CHECK_MS);
  }
  function stopTimers() {
    if (idleT != null) { clearTimer(idleT); idleT = null; }
    if (checkT != null) { clearTimer(checkT); checkT = null; }
  }

  /** Still ours? Another holder took the scan, or the panels were given it back: let go, quietly. */
  function stillMine() {
    if (!held) return false;
    if (safe(othersHold, false) || !safe(isPaused, true)) { drop(); return false; }
    return true;
  }
  // Let go WITHOUT touching the router: whoever has the scan now is in charge of it.
  function drop() {
    if (!held) return;
    held = false;
    stopTimers();
    watch(false);
    unpaint();
    safe(() => show(false));
  }

  function enter() {
    if (held) return true;
    if (safe(othersHold, false) || !rootNow()) return false;
    held = true;
    level = null; gk = null; gAt = 0; sk = null; sAt = 0; laps = 0;
    safe(() => pause(true));
    safe(() => show(true));
    watch(true);
    paint();
    armIdle();
    armCheck();
    return true;
  }
  function leave() {
    if (!held) return;
    drop();
    if (!safe(othersHold, false)) safe(() => pause(false));
  }

  function press(el) {
    laps = 0;
    try { el.click(); } catch (err) { console.error('transport bar: switch press', err); }
  }

  function step(v) {
    const w = where();
    if (!w.gs.length) { if (v === 'back') leave(); return; }
    const d = v === 'prev' ? -1 : 1;
    if (level === null) {
      if (v === 'back') { leave(); return; }
      // The first press only LIGHTS: a group (rows), or the first button (one at a time).
      if (w.rows) { level = 'groups'; gAt = d < 0 && v !== 'select' ? w.gs.length - 1 : 0; gk = w.gs[gAt].key; }
      else { level = 'items'; const all = w.gs.flatMap((g) => g.stops); sAt = d < 0 && v !== 'select' ? all.length - 1 : 0; sk = stopKey(all[sAt]); }
      laps = 0;
      paint();
      return;
    }
    if (level === 'groups') {
      if (v === 'back') { leave(); return; }
      if (v === 'select') {
        const g = w.gs[w.gi];
        if (g.stops.length === 1) { press(g.stops[0]); if (stillMine()) paint(); return; }
        level = 'items'; sAt = 0; sk = stopKey(g.stops[0]); laps = 0;
        paint();
        return;
      }
      const n = w.gs.length;
      const to = ((w.gi + d) % n + n) % n;
      if ((d > 0 && to === 0) || (d < 0 && to === n - 1)) laps += 1;
      gAt = to; gk = w.gs[to].key;
      if (laps0 && laps >= laps0) { leave(); return; }
      paint();
      return;
    }
    // level === 'items'
    if (v === 'back') {
      if (w.rows) { level = 'groups'; sk = null; laps = 0; paint(); } else leave();
      return;
    }
    if (v === 'select') { press(w.list[w.si]); if (stillMine()) paint(); return; }
    const n = w.list.length;
    const to = ((w.si + d) % n + n) % n;
    if ((d > 0 && to === 0) || (d < 0 && to === n - 1)) laps += 1;
    sAt = to; sk = stopKey(w.list[to]);
    if (laps0 && laps >= laps0) {
      if (w.rows) { level = 'groups'; sk = null; laps = 0; paint(); } else leave();
      return;
    }
    paint();
  }

  function onVerb(v) {
    if (!held || !stillMine()) return;
    step(v);
    if (held) armIdle();
  }
  if (bus && typeof bus.subscribe === 'function') {
    for (const [verb, as] of [['next', 'next'], ['prev', 'prev'], ['select', 'select'], ['back', 'back'],
      ['focus-next', 'next'], ['focus-prev', 'prev']]) {
      offs.push(bus.subscribe(verbTopic(verb), () => onVerb(as)));
    }
    // The menu key opens the menu (its own handler, subscribed first): it has the scan now.
    for (const t of [verbTopic('menu'), 'shell/menu']) offs.push(bus.subscribe(t, () => { if (held) stillMine(); }));
    offs.push(bus.subscribe(BAR_SCAN_TOPIC, (p) => {
      try { p?.claim?.(); } catch { /* a publisher's claim must not stop the press */ }
      if (held) leave(); else enter();
    }));
  }

  return {
    enter,
    leave,
    toggle: () => (held ? (leave(), false) : enter()),
    held: () => held,
    /** For a suite and a diagnostic page: where the scan is. */
    probe() {
      const r = rootNow();
      const w = held ? where() : { gs: [], gi: -1, list: [], si: -1 };
      const lit = held && level === 'items' ? w.list[w.si] : null;
      return {
        held, mode: modeNow(), level: held ? level : null,
        group: held && w.gi >= 0 ? w.gs[w.gi].key : (held && lit ? barGroupOf(lit) : null),
        cursor: lit ? (lit.textContent || '').trim() : null,
        groups: w.gs.map((g) => g.key), laps,
        root: r ? (r.classList?.contains('tb-bar') ? 'tb-bar' : r.classList?.contains('k-controls') ? 'k-controls' : r.tagName) : null,
      };
    },
    destroy() {
      leave();
      offs.splice(0).forEach((off) => { try { off?.(); } catch { /* gone */ } });
    },
  };
}
