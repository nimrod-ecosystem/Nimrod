// hide_sound.js — WHAT A PANEL'S SOUND DOES WHILE THE PANEL IS HIDDEN.
//
// Mike, 2026-10-01, asked whether hiding a module should also mute it: *"That's a tricky one. Seems
// like a setting for modules. I'd say maybe start with a popup that asks if they want it muted. I
// guess I'm not sure what contexts count as hiding."* So, three parts:
//
//   1. A PER-PANEL SETTING, "When this panel is hidden": keep playing / mute it / pause it. Stored in
//      the panel's own state row under a reserved key (`instanceWhenHidden`), the same way the kiosk's
//      `instancePanelSurface` is - a module never declares or reads it.
//   2. ENACTED THROUGH THE AUDIO BUS. Mute = `audio.muteOwner(instanceId)`: every source the panel
//      registered (module.js tags them with the instance id) goes to 0 while it is hidden and comes
//      back when it is shown. Pause = the module's own `pause()` / `resume()` if its factory offers
//      them, else (2026-10-02) the `pause` / `play` VERBS if it answers them -- the same pause the bar's
//      Pause button and a spoken "pause" use; a module that offers neither is MUTED instead (silence is
//      what was asked for, and mute is the nearest silence it has).
//   3. A QUESTION, ASKED ONCE. The first time a PERSON hides a sound-making panel by their own action
//      (the Layers window's Shown/Hidden button), the shared choice card asks whether to mute it.
//
// WHAT COUNTS AS HIDDEN: whatever calls the module record's `onHide` (module.js). Today that is a
// placed panel set to Hidden (arrangement.js `applyPlaced`), a wallpaper the director covers, and the
// YouTube player inside Karaoke when Karaoke itself is hidden. NOT a panel swapped off the one-at-a-time
// stage (that destroys it - its sound ends anyway), NOT the browser tab going to the background, NOT
// the Screens picker or the menu drawn over the panel, NOT a room close-up that leaves a panel out of
// frame. The report on 2026-10-01 has the full table and why each one is or is not a hide.
//
// ---------------------------------------------------------------------------------------
// *** THE DEFAULT IS "KEEP PLAYING". *** Argued, both sides:
//   FOR mute: a hidden thing making noise is a puzzle for whoever walks in - sound with no picture
//     and no visible control to stop it.
//   FOR keep (chosen): it is what every screen does TODAY, so nothing changes for anybody until
//     somebody chooses; "hide the video, keep the music" is a real, ordinary want (a playlist behind
//     a photo screen); and a default of mute would silently break it on the first hide. The puzzle
//     case is exactly what the question is for - it is asked at the moment of the hide.
//
// *** WHAT HAPPENS IF NOBODY ANSWERS? NOTHING. *** (CLAUDE.md, "Design absolutes")
//   * The question is the choice card (choice_card.js): non-modal, closes by button, Escape and BY
//     ITSELF after `askTimeoutMs`. Unanswered, the panel keeps doing what it was doing.
//   * AUTOMATIC HIDES NEVER ASK. Only a hide somebody did with their own hands (`personHid`, or an
//     `onHide({ by: 'person' })`) can raise the card. A director covering a wallpaper at 3am asks
//     nobody anything.
//   * Asked AT MOST ONCE per panel per page load, answered or not. Unanswered, the next hide of the
//     same panel tomorrow asks again (the setting is still unset); a card that came back on every
//     toggle in one sitting would be nagging.
//
// *** WHERE THE ANSWER IS REMEMBERED: PER PANEL, AS ITS SETTING. *** Pressing an option writes that
// panel's "When hidden" setting, so the answer is visible and changeable in the panel's own settings,
// and a panel whose setting is set is never asked again. The card's two checkboxes are about the
// QUESTION, in the profile's shared choices row (the same row board.js uses), so they follow the
// screen: "Always use this option" applies that answer to every panel hidden for the first time from
// then on (written as each panel's setting, so it stays visible); "Don't show again" stops the
// question on this screen. Per PERSON was the alternative - argued in the report: the person hiding
// panels is whoever is arranging THIS screen, and a screen's sound habits belong to the screen.

import { showChoiceCard, CHOICE_TIMEOUT_MS } from './choice_card.js';
import { verbTarget } from './actions.js';

export const WHEN_HIDDEN_KEY = 'instanceWhenHidden';
export const WHEN_HIDDEN_MODES = Object.freeze(['keep', 'mute', 'pause']);
export const WHEN_HIDDEN_DEFAULT = 'keep';

// *** THE DEFAULT IS PER MODULE NOW (2026-10-02), AND IT IS STILL "KEEP PLAYING" FOR EVERY MODULE THAT
// SHIPS. *** A module's manifest may say `whenHidden: 'keep' | 'mute' | 'pause'`, the mode a panel of
// it uses until somebody chooses (the panel's own setting, or "every <module> panel" in the menu, wins).
// Mike, on calls: a hidden call panel MAY mute, and by default it does not -- `modules/call.js` declares
// 'keep' outright, so the day the site-wide default is argued the other way a call does not go silent
// with it (somebody on a call who hides the panel to look at photos is still talking to that person).
// A value that is not one of the three is no declaration.
export function whenHiddenDefault(manifest) {
  const v = manifest && manifest.whenHidden;
  return WHEN_HIDDEN_MODES.includes(v) ? v : WHEN_HIDDEN_DEFAULT;
}

// *** "PAUSE" IS THE PAUSE VERB (2026-10-02). *** Before this, "pause it" paused only a module whose
// factory offered `pause()` / `resume()`, and MUTED everything else -- including YouTube, Karaoke, Music
// and Brick breaker, which already answer the `pause` and `play` verbs (actions.js MODULE_VERBS). Now a
// module that answers the verb is paused with it, sent to THAT panel (instance-addressed, the router's
// own rule), exactly as the bar's Pause button and a spoken "pause" pause it. Mute stays the fallback
// for a module that can do neither (silence is what was asked for).
export function answersPause(type, maps) {
  try { return !!verbTarget(type, 'pause', maps) && !!verbTarget(type, 'play', maps); } catch { return false; }
}
export const HIDE_QUESTION_ID = 'hide.sound';
// How long a person's press waits for its hide to land (the placement is applied asynchronously).
export const PENDING_MS = 5000;

const LABELS = Object.freeze({ keep: 'Keep playing', mute: 'Mute while hidden', pause: 'Pause while hidden' });

// The panel-level row (kiosk.js PANEL_INSTANCE_FIELDS, beside "This panel's background").
export const WHEN_HIDDEN_FIELD = Object.freeze({
  key: WHEN_HIDDEN_KEY, label: 'When this panel is hidden', kind: 'choice', level: 'standard',
  default: WHEN_HIDDEN_DEFAULT,
  options: Object.freeze([
    Object.freeze({ value: 'keep', label: 'Keep playing' }),
    Object.freeze({ value: 'mute', label: 'Mute it' }),
    // Honest about the fallback rather than a row that silently does something else.
    Object.freeze({ value: 'pause', label: 'Pause it (mutes it if it cannot pause)' }),
  ]),
});

// The screen-level row: how long the question stays up. The choice card's own default, so every
// card on a screen goes away on the same clock; the card refuses anything under its minimum.
export const HIDE_ASK_TIMEOUT_KEY = 'hideAskTimeoutMs';
export const HIDE_ASK_TIMEOUT_FIELD = Object.freeze({
  key: HIDE_ASK_TIMEOUT_KEY, label: 'The "mute it while hidden?" question goes away after', kind: 'choice',
  level: 'advanced', default: CHOICE_TIMEOUT_MS,
  options: Object.freeze([
    Object.freeze({ value: 15000, label: '15 seconds' }),
    Object.freeze({ value: 30000, label: '30 seconds' }),
    Object.freeze({ value: 60000, label: '1 minute' }),
    Object.freeze({ value: 120000, label: '2 minutes' }),
  ]),
});

/** A stored mode, or undefined when nobody has chosen one (which is NOT the same as 'keep'). */
export function storedMode(state) {
  let v;
  try { v = state?.get?.()?.[WHEN_HIDDEN_KEY]; } catch { v = undefined; }
  return WHEN_HIDDEN_MODES.includes(v) ? v : undefined;
}

/** Whether a panel makes sound: it registered a source, or its manifest says it does. */
export function makesSound({ instanceId, audio, manifest } = {}) {
  try { if (instanceId && audio?.sourcesOf?.(instanceId)?.length) return true; } catch { /* fall through */ }
  return !!(manifest && (manifest.sound || manifest.sounds));
}

/**
 * The host's hide policy. Hand it to modules as `ctx.hidePolicy` (module.js calls `hidden`, `shown`
 * and `gone` from the record's lifecycle).
 *
 *   memory        from choice_card.js `createChoiceMemory` (the profile's shared choices row)
 *   host()        the element the question is drawn in
 *   askTimeoutMs()  how long the question stays up (HIDE_ASK_TIMEOUT_FIELD)
 *   label(info)   what the panel is called on the card (default: its manifest title)
 *   setTimer / clearTimer   for the card, injectable for tests
 */
export function createHideSound({
  memory = null,
  host = () => (typeof document !== 'undefined' ? document.body : null),
  askTimeoutMs = () => CHOICE_TIMEOUT_MS,
  label = (info) => info?.manifest?.title || info?.type || 'This panel',
  setTimer, clearTimer,
  now = () => Date.now(),
  // The screen's bus, for pausing a module by its `pause` verb (above). Absent: only a module's own
  // `pause()` can pause, exactly as before.
  bus = null,
} = {}) {
  const hiddenNow = new Map();     // instanceId -> the info it was hidden with
  const muted = new Set();         // instanceIds this policy muted
  const paused = new Set();        // instanceIds this policy paused
  const asked = new Set();         // asked once per page load, answered or not
  // A person hid it and its `hidden` has not arrived yet: id -> when. Honoured for PENDING_MS only,
  // so a press whose hide never landed cannot turn a later AUTOMATIC hide into a question.
  const pending = new Map();
  let card = null;

  function modeFor(info) { return storedMode(info?.state) || whenHiddenDefault(info?.manifest); }
  const ownPause = (info) => !!(info?.impl && typeof info.impl.pause === 'function');
  const verbPause = (info) => !!(bus && info?.type && answersPause(info.type));
  const canPause = (info) => ownPause(info) || verbPause(info);
  // The verb, to THIS panel: its instance-addressed topic where the bus has them (bus.js `instanceTopic`).
  function sendVerb(id, info, verb) {
    const t = verbTarget(info.type, verb);
    if (!t) return false;
    const topic = typeof bus.instanceTopic === 'function' ? bus.instanceTopic(id, t.topic) : t.topic;
    bus.publish(topic, t.payload, { from: 'hide' });
    return true;
  }
  const pausedBy = new Map();      // instanceId -> 'own' | 'verb', so the resume matches the pause

  function enact(id, info) {
    const mode = modeFor(info);
    if (mode === 'keep') return;
    if (mode === 'pause' && canPause(info)) {
      if (paused.has(id)) return;
      try {
        if (ownPause(info)) { info.impl.pause(); pausedBy.set(id, 'own'); }
        else { sendVerb(id, info, 'pause'); pausedBy.set(id, 'verb'); }
        paused.add(id);
        return;
      } catch (err) { console.error('hide_sound: pause', err); }   // falls to mute: silence was asked for
    }
    if (info?.audio?.muteOwner) {
      try { info.audio.muteOwner(id, true); muted.add(id); } catch (err) { console.error('hide_sound: mute', err); }
    }
  }
  function undo(id, info) {
    if (muted.delete(id)) { try { (info?.audio || hiddenNow.get(id)?.audio)?.muteOwner?.(id, false); } catch { /* bus gone */ } }
    if (paused.delete(id)) {
      const how = pausedBy.get(id) || 'own';
      pausedBy.delete(id);
      const before = hiddenNow.get(id) || {};
      const was = { impl: info?.impl || before.impl, type: info?.type || before.type };
      try {
        if (how === 'verb') { if (bus && was.type) sendVerb(id, was, 'play'); }
        else was.impl?.resume?.();
      } catch (err) { console.error('hide_sound: resume', err); }
    }
  }

  function ask(id, info) {
    pending.delete(id);
    if (asked.has(id) || storedMode(info?.state) !== undefined) return { asked: false, reason: 'answered' };
    if (!makesSound({ instanceId: id, audio: info?.audio, manifest: info?.manifest })) return { asked: false, reason: 'silent' };
    const el = host?.();
    if (!el) return { asked: false, reason: 'nowhere' };
    asked.add(id);
    const options = ['keep', 'mute', ...(canPause(info) ? ['pause'] : [])].map((v) => ({ value: v, label: LABELS[v] }));
    const name = label(info);
    const playing = (() => { try { return (info.audio?.sourcesOf?.(id) || []).some((s) => info.audio.isActive?.(s)); } catch { return false; } })();
    const choose = (value) => {
      try { info.state?.set?.({ [WHEN_HIDDEN_KEY]: value }); } catch (err) { console.error('hide_sound: save', err); }
      if (hiddenNow.has(id)) { undo(id, info); enact(id, { ...info, state: { get: () => ({ [WHEN_HIDDEN_KEY]: value }) } }); }
    };
    const shown = showChoiceCard(el, {
      id: HIDE_QUESTION_ID,
      title: `${name} is hidden`,
      text: `${playing ? 'It is still playing sound.' : 'It can still make sound while it is hidden.'} `
        + 'Mute it while it is hidden? You can change this later in its own settings.',
      options, memory,
      timeoutMs: Number(askTimeoutMs?.()) || CHOICE_TIMEOUT_MS,
      onChoose: (value) => choose(value),
      onClose: () => { if (card?.id === id) card = null; },
      ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}),
    });
    if (shown.shown) card = { id, handle: shown };
    return { asked: !!shown.shown, reason: shown.shown ? 'shown' : shown.reason, answer: shown.answer };
  }

  function shown(info = {}) {
    const id = info.instanceId;
    if (!id) return;
    pending.delete(id);
    undo(id, info);
    hiddenNow.delete(id);
    // The question is moot once the panel is back; the card goes with it.
    if (card?.id === id) { try { card.handle.close('close'); } catch { /* gone */ } card = null; }
  }

  return {
    // ---- called by module.js -----------------------------------------------------------
    hidden(info = {}) {
      const id = info.instanceId;
      if (!id) return;
      const first = !hiddenNow.has(id);
      hiddenNow.set(id, info);
      if (first) enact(id, info);
      const waiting = pending.has(id) && now() - pending.get(id) <= PENDING_MS;
      pending.delete(id);
      if (info.by === 'person' || waiting) ask(id, info);
    },
    shown,
    gone(info = {}) {
      const id = typeof info === 'string' ? info : info.instanceId;
      if (!id) return;
      shown({ ...(typeof info === 'object' ? info : {}), instanceId: id });
    },

    // ---- called by whatever a person pressed (the Layers window's Shown/Hidden) ---------
    // The hide itself may land a moment later (the placement is applied asynchronously), so this
    // asks now if it already has, and otherwise when it does.
    personHid(id) {
      if (!id) return null;
      if (hiddenNow.has(id)) return ask(id, hiddenNow.get(id));
      pending.set(id, now());
      return { asked: false, reason: 'pending' };
    },

    // ---- for a host's settings menu and the suites ---------------------------------------
    modeOf: (state, manifest = null) => storedMode(state) || whenHiddenDefault(manifest),
    canPause: (info) => canPause(info || {}),
    makesSound,
    probe: () => ({ hidden: [...hiddenNow.keys()], muted: [...muted], paused: [...paused],
                    asked: [...asked], pending: [...pending.keys()], card: card ? card.id : null }),
    destroy() {
      for (const id of [...hiddenNow.keys()]) undo(id, hiddenNow.get(id));
      hiddenNow.clear(); pending.clear(); pausedBy.clear();
      if (card) { try { card.handle.close('close'); } catch { /* gone */ } card = null; }
    },
  };
}
