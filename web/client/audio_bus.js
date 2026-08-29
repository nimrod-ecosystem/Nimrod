// audio_bus.js — the SPEAKER arbiter. Ported from Cici's `CiciAudio`, which has been running
// on the bedside unit since 2026-07-26.
//
// *** WHY THIS HAD TO COME BEFORE ANY MORE GAMES (Mike, 2026-08-29). ***
// There is ONE pair of ears. The OS mixer happily sums every sound at once, so with no
// coordination a spoken cue lands under a music bed, two games' music play on top of each
// other, and a video keeps going while somebody is trying to talk. output.js already says
// Cici "learned it the expensive way" — and then game music shipped OUTSIDE any arbiter,
// which is exactly the failure that sentence is about.
//
// *** IT IS NOT THE OUTPUT BUS, AND THE DIFFERENCE IS THE WHOLE REASON BOTH EXIST. ***
//   output.js  arbitrates MESSAGES: discrete things with a beginning and an end, queued,
//              expiring, preempted. "Say this sentence."
//   this file   arbitrates CONTINUOUS SOUND: a video that is playing, a music bed that is
//              running, a voice that is mid-sentence. Nothing is queued; everything is
//              already making noise and the question is only HOW LOUD.
// A queue cannot express "duck the music while this plays", and a gain cannot express "say
// this when the channel frees up". Folding them together would lose one or the other.
//
// TWO RULES DO ALL THE WORK, and they are Cici's unchanged:
//
//   1. TIER DUCKING (across tiers). When a higher tier is active, every active source in a
//      lower tier drops to DUCK_TO. A voice cue or a push-to-talk pulls the music down so
//      the words land. NOT to zero — a soft bed UNDER a voice is the point; silence would
//      make every cue feel like an interruption.
//   2. EXCLUSIVITY (within a group). At most one member of a group sounds; the rest go to 0.
//      The "music" group holds a video and every game's music, so only one plays. Higher
//      `groupPriority` wins — VIDEO OUTRANKS GAME MUSIC (Mike, 2026-07-26) — and ties break
//      to the most recently activated, so opening a second game preempts the first.
//
// Plus HUSH: silence all media so somebody can talk in the room. Deliberately separate from
// the duck, because a duck is momentary and this is "stop, I am having a conversation".
//
// *** IT IS DEFENSIVE BY CONSTRUCTION, AND THAT IS NOT OPTIONAL. *** Every source keeps its
// own direct playback and treats the bus as advice. A missing or broken arbiter must never be
// able to silence her games or her voice — the failure mode of a coordinator is that
// everything plays at once, which is annoying, and never that nothing plays at all, which on
// a bedside screen is the whole product gone.
//
// Pure: it touches no DOM and knows nothing about how any source makes sound. A source hands
// it an `onGain(level)` and enacts the number however it likes — a YouTube setVolume, an
// <audio>.volume, a Web Audio gain, or a pause.

// *** DUCK DEPTH — TUNE HERE. *** How far a lower tier drops while a higher one is active.
// 1 = no duck, 0 = silent. Mike chose 0.5 on Cici: the voice lands without killing the bed.
export const DUCK_TO = 0.5;

// Higher wins. `call` and `sfx` are reserved seams, named so the vocabulary does not have to
// change when they arrive — naming them costs nothing.
export const TIERS = { call: 100, talk: 80, voice: 80, media: 40, sfx: 20 };

// Video outranks game music inside the `music` group.
export const MUSIC_GROUP = 'music';
export const VIDEO_PRIORITY = 10;
export const GAME_MUSIC_PRIORITY = 0;

export function createAudioBus({ duckTo = DUCK_TO, tiers = TIERS } = {}) {
  const sources = new Map();      // id -> {id, tier, tierP, group, gp, onGain, active, seq, level}
  let seq = 0;
  let hushed = false;
  let inRecompute = false;

  const tierP = (t) => (tiers[t] != null ? tiers[t] : 0);

  // Enact a level, but only when it actually changed — and never re-enter recompute from
  // inside an onGain, because a callback that toggles activity would otherwise recurse.
  function apply(s, level) {
    if (s.level === level) return;
    s.level = level;
    try { s.onGain?.(level, { tier: s.tier, group: s.group }); }
    catch (err) { console.error(`audio source "${s.id}" onGain threw`, err); }
  }

  function recompute() {
    if (inRecompute) return;
    inRecompute = true;
    try {
      const active = [...sources.values()].filter((s) => s.active);
      const topP = active.reduce((m, s) => Math.max(m, s.tierP), 0);

      // One winner per group.
      const winners = new Map();
      for (const s of active) {
        if (!s.group) continue;
        const w = winners.get(s.group);
        if (!w || s.gp > w.gp || (s.gp === w.gp && s.seq > w.seq)) winners.set(s.group, s);
      }

      for (const s of active) {
        let level = 1;
        if (s.tierP < topP) level *= duckTo;                                  // 1. duck
        if (s.group && winners.get(s.group)?.id !== s.id) level = 0;          // 2. exclusivity
        if (hushed && s.tier === 'media') level = 0;                          // 3. hush
        apply(s, level);
      }
    } finally {
      inRecompute = false;
    }
  }

  return {
    // Idempotent by id, so a module can call it on every mount.
    register(id, { tier = 'media', group = null, groupPriority = null, onGain = null } = {}) {
      if (!id) return null;
      let s = sources.get(id);
      if (!s) {
        // *** level STARTS null — "never enacted" — NOT 1. *** A game that wins the music
        // slot from idle has to actually START, and its onGain is what starts it. Seeding 1
        // would make the no-change guard swallow that first enact and the music would never
        // begin. Cici's carries the same comment for the same bug.
        s = { id, active: false, seq: 0, level: null };
        sources.set(id, s);
      }
      s.tier = tier || s.tier || 'media';
      s.tierP = tierP(s.tier);
      if (group !== null) s.group = group;
      if (groupPriority !== null) s.gp = groupPriority;
      if (s.gp == null) s.gp = 0;
      if (onGain) s.onGain = onGain;
      return s;
    },

    // The one signal that drives everything: "I am / am not making sound right now."
    setActive(id, on) {
      const s = sources.get(id);
      if (!s) return;
      const next = !!on;
      if (s.active === next) return;
      s.active = next;
      if (next) s.seq = ++seq;
      else apply(s, 0);            // going quiet: drop its own level too
      recompute();
    },

    play(id, spec) { this.register(id, spec); this.setActive(id, true); },
    stop(id) { this.setActive(id, false); },

    unregister(id) { if (sources.delete(id)) recompute(); },

    // *** SEPARATE FROM THE DUCK ON PURPOSE. *** A duck is momentary and leaves a bed
    // audible; this is "stop, I am talking to somebody in this room". It silences media and
    // leaves the voice tier alone, so she stays audible while everything else stops.
    hush(on) {
      const next = !!on;
      if (hushed === next) return hushed;
      hushed = next;
      recompute();
      return hushed;
    },
    isHushed: () => hushed,

    isActive: (id) => !!sources.get(id)?.active,
    levelOf: (id) => (sources.has(id) ? sources.get(id).level : null),
    duckTo: () => duckTo,

    state() {
      const out = {};
      for (const [id, s] of sources) {
        out[id] = { tier: s.tier, group: s.group ?? null, gp: s.gp, active: s.active, level: s.level };
      }
      return out;
    },

    destroy() { sources.clear(); hushed = false; },
  };
}
