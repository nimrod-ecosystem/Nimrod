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
// Plus three things that SILENCE rather than duck, because they are conversations and not cues:
// HUSH (somebody talking in the room, on a button), a CALL (see CALL_MODES), and a source that
// registered with `silence: true` (a person talking TO the screen - `listening_cue.js`'s "pause
// everything" mode, and a voice game that is waiting for an answer; row 2.28). A duck is
// right for a sentence and wrong for five minutes — a bed murmuring under a conversation is
// not a bed, it is a distraction nobody chose.
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

// *** A CALL PAUSES EVERYTHING ELSE. IT DOES NOT DUCK IT. *** (Mike, 2026-08-29: "in the case
// of auto answer I would have anything else playing sound pause, and make that an option for
// any call.") A duck is right for a cue that lasts a second and wrong for a conversation: a
// music bed murmuring at half volume under a five-minute call is not a bed, it is a
// distraction nobody chose. And auto-answer is the case that settles it - if a call can open
// itself, whatever was playing must get out of the way without anybody being there to do it.
//
// AN OPTION, NOT A LAW, because somebody watching a film together over a call may well want
// the film to keep going quietly - which is exactly the case Cici's own note about
// watch-together was making.
export const CALL_MODES = ['pause', 'duck'];

// *** spotify sdk (2026-10-07): WHAT A SOURCE DOES WHEN IT WOULD BE DUCKED - PER SOURCE. ***
// 'duck' (every source until now, and still the default): the tier rule above, a soft bed under the words.
// 'pause': this source goes to 0 for as long as it would have been ducked, and comes back when the
// higher tier ends. A DECISION like hush, so no channel floor lifts it. Asked for by Spotify playing
// through this page (spotify_sdk.js): Spotify's developer policy says "Do not permit any device or
// system to segue, mix, re-mix, or overlap" its content with other audio [developer.spotify.com/policy,
// read 2026-10-07], which read literally rules out a bed under a spoken cue. A per-source default, not a
// law: `setWhenDucked` changes it live, and nothing else on the bus changes.
export const DUCK_MODES = Object.freeze(['duck', 'pause']);

// Video outranks game music inside the `music` group.
export const MUSIC_GROUP = 'music';
export const VIDEO_PRIORITY = 10;
export const GAME_MUSIC_PRIORITY = 0;

// ---------------------------------------------------------------------------------------
// *** THE MASTER (row 2.28, Mike 2026-09-30: "louder" "would control the audio busses master
// volume"). Now the master of row 2.35's mixer (below): a fader per channel and a minimum per
// channel sit under it. ***
//
// ONE NUMBER, 0..1, THAT EVERY REGISTERED SOURCE'S LEVEL IS MULTIPLIED BY. It multiplies, never
// replaces: a ducked video is ducked AND turned down, and nothing the arbiter silenced (the losing
// music, hush, a call set to pause) can be un-silenced by turning the master up. The speech channel
// has no `onGain`, so it reads `master()` when it speaks (output_channels.js) - otherwise "quieter"
// would turn the video down and leave the voice as loud as ever, a master that is not.
//
// *** IT HAS A FLOOR, AND A BROKEN ONE PLAYS AT FULL VOLUME. *** Both follow from the rule at the
// top of this file - a failure never silences her:
//   * THE FLOOR, 10% BY DEFAULT, A SETTING. The same number YouTube's own volume floor already
//     uses and Mike OK'd for it (row 2.28 call 3), for the same reason: a "quieter" that can reach
//     zero leaves a screen playing with no sound, which to the next person in the room looks
//     exactly like broken audio. Making it silent is a different act with its own controls (Hush
//     on the bar, "pause"). The person who wants it HIGHER - a caregiver who never wants a
//     "quieter" from somebody passing through to bury the screen - raises it (master_volume.js
//     offers 10/20/30%); the person who finds 10% too loud at night turns the machine's own
//     volume down. A floor of zero is refused rather than honoured, because it would make a
//     volume control into a mute that no one can see, and mute already has honest controls.
//   * A BROKEN MASTER (NaN, a string, a corrupt saved value) IS FULL VOLUME. "Too loud" is
//     annoying and fixable by the next person in the room; "silent" is the product gone.
// ---------------------------------------------------------------------------------------
export const MASTER_FLOOR = 0.1;

// `v` as a master gain: finite and inside [floor, 1], or full volume when it is not a number.
function masterValue(v, floor) {
  if (v === null || v === undefined || v === '') return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(floor, Math.min(1, n));
}
function floorValue(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : MASTER_FLOOR;
}

// ---------------------------------------------------------------------------------------
// *** THE MIXER (row 2.35, Mike 2026-09-30: "the audio bus needs busses like a mixer. Because you
// probably wouldn't want incoming calls dropping too low. Maybe have minimums for certain
// channels."). ***
//
// A CHANNEL IS A FADER AND A MINIMUM. Every source sits on one: its tier's, unless it names another.
// The arbiter's rules above are unchanged and run FIRST; the mixer only changes how loud a source
// that the arbiter says should sound actually sounds:
//
//     heard = arbiter level (duck, exclusivity, hush, call) x channel fader x master
//     then, IF THE ARBITER SAYS IT SHOULD SOUND AT ALL (level > 0), never under the channel's floor.
//
// *** THE INTERACTION, AND WHY IT IS THIS ONE. ***
//   * A DUCK, THE MASTER AND A FADER ARE VOLUMES. The floor outranks all three. That is the whole
//     point of a floor: "calls shouldn't drop too low" has to survive a "quieter" from somebody
//     passing through, a fader somebody set last week, AND a duck. The case that decides it is her
//     AAC voice DURING A CALL: the call tier ducks the voice tier, and that is exactly the moment
//     her words have to reach the person on the other end.
//   * EXCLUSIVITY, HUSH, A CALL SET TO PAUSE AND A STOPPED SOURCE ARE DECISIONS, NOT VOLUMES. They
//     give 0, and the floor never lifts a 0. A floor that un-silenced the losing game music, or a
//     video under a hush, would turn "never too quiet" into "can never be stopped", and stopping
//     things has its own honest controls. So a floor is "when this is heard, at least this loud" -
//     never "always heard".
//   * The person who wants the opposite - a call that follows the master all the way down - sets
//     the call floor to "no minimum". A channel floor of 0 is allowed, unlike the master's, because
//     it removes a guarantee rather than creating an invisible mute: the master's floor still holds.
//
// A FADER CAN REACH 0, UNLIKE THE MASTER. The master is moved by a spoken "quieter" from anybody in
// the room, so it keeps its floor. A fader is a settings row somebody chose deliberately, and "no
// game beeps at all" is a legitimate thing to choose. On a floored channel the floor still wins.
//
// A BROKEN fader is full volume; a BROKEN floor is that channel's default floor - never 0, never
// silence. Same rule as everything else in this file.
// ---------------------------------------------------------------------------------------

// The channels, in the order a mixer shows them. `effects`: whether anything on this channel is
// played through Web Audio, so an insert (reverb, compressor, a plugin) can reach it at all - see
// mixer_fx.js. Calls (WebRTC, played by a media element) and the spoken prompts (the browser's own
// speech engine) can only be given a volume.
export const CHANNELS = Object.freeze([
  Object.freeze({ id: 'call',  label: 'Calls',                floor: 0.6, effects: false }),
  // *** THE AAC VOICE IS ITS OWN CHANNEL. *** It is the one sound on the screen that is a person
  // talking, and it must never be buried - so it gets its own floor, apart from the spoken prompts
  // it used to share the voice tier with.
  Object.freeze({ id: 'aac',   label: 'Talking board voice',  floor: 0.6, effects: true }),
  Object.freeze({ id: 'voice', label: 'Spoken prompts',       floor: 0,   effects: false }),
  Object.freeze({ id: 'media', label: 'Videos and music',     floor: 0,   effects: true }),
  Object.freeze({ id: 'sfx',   label: 'Game sounds',          floor: 0,   effects: true }),
  // AMPLIFY (row 2.42, 2026-09-30 wiring): the room's microphone played louder, on its own fader so it
  // can be set apart from everything else. No minimum: it is a hearing aid somebody turns on, not a
  // voice that must never be buried, and a floor on a live microphone would fight its howl guard.
  // No effects: amplify.js runs its own chain (gain -> limiter -> meter), not mixer_fx's.
  Object.freeze({ id: 'amplify', label: 'Amplified microphone', floor: 0, effects: false }),
]);
export const CHANNEL_IDS = CHANNELS.map((c) => c.id);
export const CHANNEL_FLOORS = Object.freeze(Object.fromEntries(CHANNELS.map((c) => [c.id, c.floor])));
// Which channel a tier lands on when a source does not name one. `talk` (push-to-talk, a listening
// window) and `voice` share one: both are the screen speaking or listening, not a person.
export const TIER_CHANNEL = Object.freeze({ call: 'call', talk: 'voice', voice: 'voice', media: 'media', sfx: 'sfx' });

// `v` as a fader: finite inside [0, 1], or full when it is not a number.
function faderValue(v) {
  if (v === null || v === undefined || v === '') return 1;
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}
// `v` as a channel floor: finite inside [0, 1], or the channel's own default when it is not.
function channelFloorValue(v, dflt) {
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
}
const defaultFloorOf = (ch) => (CHANNEL_FLOORS[ch] != null ? CHANNEL_FLOORS[ch] : 0);

export function createAudioBus({ duckTo = DUCK_TO, tiers = TIERS, callMode = 'pause',
                                 master = 1, masterFloor = MASTER_FLOOR,
                                 faders = {}, floors = {} } = {}) {
  const sources = new Map();      // id -> {id, tier, tierP, channel, group, gp, duck, onGain, active, seq, level, owner}
  // *** HIDDEN AND MUTED (2026-10-01, hide_sound.js). *** Owners (module instance ids) whose sources
  // are muted because their panel is hidden and its "When hidden" setting says so. A DECISION, like
  // exclusivity and hush: the level is 0 and no floor lifts it. And a muted source is not SOUNDING, so
  // it does not duck anything, hold a group's slot, or count as a call - a hidden video muted by its
  // own setting must not silence the game music on the panel somebody is actually looking at.
  const mutedOwners = new Set();
  // *** A PANEL'S OWN VOLUME, AND A TV'S (2026-10-02). *** Mike, on a TV in a room showing a live
  // dashboard that plays sound: "It has to be accessible through the transport bar and settings menu."
  // A LEVEL per owner PATH: `['tv']` is the TV and everything on it, `['tv', 'yt']` is the YouTube panel
  // ON that TV only (a source's path is what it is inside, outermost first, then its owner - module.js
  // `ownedAudio` builds it). A level is a VOLUME, like a fader: it multiplies, and the channel's floor
  // still holds. EXCEPT 0, WHICH IS MUTE, A DECISION: 0 is never lifted by a floor and a muted source
  // ducks nobody - the hide rule above, for the same reason (a TV muted on purpose must not silence the
  // music somebody is listening to). Separate from `mutedOwners` on purpose: hiding and showing a panel
  // must never undo a mute somebody chose, nor a mute un-hide a panel.
  const levels = new Map();           // 'tv>yt' -> 0..1
  const pathKey = (p) => (Array.isArray(p) ? p : [p]).filter((x) => x != null && x !== '').map(String).join('>');
  const pathOf = (s) => [...(Array.isArray(s.within) ? s.within.slice().reverse() : []), ...(s.owner ? [s.owner] : [])];
  // Does rule `r` (an id list) sit inside path `p`, in order and side by side?
  const inPath = (r, p) => {
    if (!r.length || r.length > p.length) return false;
    for (let i = 0; i + r.length <= p.length; i += 1) {
      let ok = true;
      for (let j = 0; j < r.length; j += 1) if (p[i + j] !== r[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  // The product of every level that reaches this source (1 when none does; a broken one is 1).
  function ownerGain(s) {
    if (!levels.size) return 1;
    const p = pathOf(s);
    if (!p.length) return 1;
    let g = 1;
    for (const [k, v] of levels) if (inPath(k.split('>'), p)) g *= v;
    return Number.isFinite(g) ? Math.max(0, Math.min(1, g)) : 1;
  }
  let seq = 0;
  let hushed = false;
  let inRecompute = false;
  let onCall = CALL_MODES.includes(callMode) ? callMode : 'pause';
  let floor = floorValue(masterFloor);
  let masterGain = masterValue(master, floor);
  // The mixer. Only channels somebody has touched are stored; everything else reads its default.
  const faderOf = new Map();
  const floorOf = new Map();
  for (const [ch, v] of Object.entries(faders || {})) if (ch) faderOf.set(ch, faderValue(v));
  for (const [ch, v] of Object.entries(floors || {})) if (ch) floorOf.set(ch, channelFloorValue(v, defaultFloorOf(ch)));
  const faderFor = (ch) => (faderOf.has(ch) ? faderOf.get(ch) : 1);
  const floorFor = (ch) => (floorOf.has(ch) ? floorOf.get(ch) : defaultFloorOf(ch));

  // The mixer's half of a level: fader x master, lifted to the floor when the arbiter says the
  // source should sound. Guarded: anything that goes wrong here is the arbiter's level untouched.
  function mixed(level, ch, g) {
    if (!(level > 0)) return 0;
    try {
      let out = level * faderValue(faderFor(ch)) * g;
      const fl = channelFloorValue(floorFor(ch), defaultFloorOf(ch));
      if (out < fl) out = fl;
      if (!Number.isFinite(out)) return level;
      return Math.max(0, Math.min(1, out));
    } catch { return level; }
  }

  const tierP = (t) => (tiers[t] != null ? tiers[t] : 0);
  // A source's own duck depth, when it declared a usable one; the bus's otherwise. Never 0 -
  // a duck that silences is not a duck, and silence has its own rules below.
  const duckOf = (s) => {
    const n = Number(s.duck);
    return s.duck != null && Number.isFinite(n) && n > 0 && n <= 1 ? n : duckTo;
  };

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
      const all = [...sources.values()].filter((s) => s.active);
      // Hidden-and-muted reaches what a hidden TV has on it too (`within`), and a level of 0 is mute.
      const isMuted = (s) => !!((s.owner && mutedOwners.has(s.owner))
        || (Array.isArray(s.within) && s.within.some((w) => mutedOwners.has(w)))
        || ownerGain(s) === 0);
      // Everything below decides with the sources that can actually be HEARD. A muted one still
      // gets its 0 (step 4c), but it ducks nobody, wins no group and starts no call.
      const active = all.filter((s) => !isMuted(s));
      const topP = active.reduce((m, s) => Math.max(m, s.tierP), 0);
      const inCall = active.some((s) => s.tier === 'call');

      // One winner per group.
      const winners = new Map();
      for (const s of active) {
        if (!s.group) continue;
        const w = winners.get(s.group);
        if (!w || s.gp > w.gp || (s.gp === w.gp && s.seq > w.seq)) winners.set(s.group, s);
      }

      // 0. the master, read once per pass. Guarded like everything else here: whatever goes
      // wrong reading it, the answer is full volume.
      let g = 1;
      try { g = masterValue(masterGain, floor); } catch { g = 1; }

      for (const s of active) {
        let level = 1;
        if (s.tierP < topP && s.whenDucked === 'pause') {                     // 1. (spotify sdk) pause, not duck
          level = 0;
        } else if (s.tierP < topP) {                                          // 1. duck
          // The deepest duck among the active sources ABOVE this one. Every one of them uses
          // the bus's depth unless it declared its own (a listening window ducks further than
          // a spoken cue: the microphone is trying to hear a person over the video).
          let depth = 1;
          for (const o of active) if (o.tierP > s.tierP) depth = Math.min(depth, duckOf(o));
          level *= depth;
        }
        if (s.group && winners.get(s.group)?.id !== s.id) level = 0;          // 2. exclusivity
        if (hushed && s.tier === 'media') level = 0;                          // 3. hush
        // 4. a call, when set to pause. Same shape as hush and for the same reason: this is
        // a conversation, not a cue, and half-volume music under it helps nobody.
        if (inCall && onCall === 'pause' && s.tier === 'media') level = 0;
        // 4b. a source ABOVE it that asked to silence media while it is active. The same "pause"
        // the call mode means - level 0, not a stopped player - and the same reason: somebody is
        // talking to the screen. Owned by that source rather than by the hush button, so turning
        // it off can never un-hush a room somebody hushed by hand.
        if (s.tier === 'media' && active.some((o) => o.silence && o.tierP > s.tierP)) level = 0;
        // 5. fader x master x the panel's own volume (a TV's too), then the floor.
        apply(s, mixed(level * ownerGain(s), s.channel, g));
      }
      // 4c. hidden and muted by its own setting: 0, which the floor never lifts.
      for (const s of all) if (isMuted(s)) apply(s, 0);
    } finally {
      inRecompute = false;
    }
  }

  return {
    // Idempotent by id, so a module can call it on every mount.
    // `duck`: how far THIS source ducks the tiers under it while it is active (0..1, default the
    // bus's DUCK_TO). A depth, not a switch - it can never silence anything.
    // `channel`: which mixer channel it sits on (row 2.35). Default: its tier's (TIER_CHANNEL), so
    // every source registered before the mixer existed lands where it belongs with no change.
    // `silence`: while this source is active, every MEDIA source under it goes to 0 instead of
    // ducking (4b above). Off unless asked for; a source registered without it is unchanged.
    // `owner`: the module instance this source belongs to (module.js tags it from `ctx.instanceId`,
    // so a module never has to). It is what `muteOwner` mutes. Sticks across re-registers.
    // `within`: what that owner is inside, innermost first (module.js adds it for a module on a TV).
    // `whenDucked` (spotify sdk): 'duck' (default) or 'pause' - see DUCK_MODES. Sticks across re-registers.
    register(id, { tier = 'media', group = null, groupPriority = null, onGain = null,
                   duck = null, channel = null, silence = null, owner = null, within = null,
                   whenDucked = null } = {}) {
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
      // A named channel sticks across re-registers; an unnamed one follows the tier.
      if (channel && typeof channel === 'string') s.namedChannel = channel;
      s.channel = s.namedChannel || TIER_CHANNEL[s.tier] || 'media';
      if (group !== null) s.group = group;
      if (groupPriority !== null) s.gp = groupPriority;
      if (s.gp == null) s.gp = 0;
      if (duck !== null) s.duck = duck;
      if (silence !== null) s.silence = !!silence;
      if (DUCK_MODES.includes(whenDucked)) s.whenDucked = whenDucked;     // spotify sdk
      if (onGain) s.onGain = onGain;
      if (owner !== null && owner !== undefined && owner !== '') s.owner = String(owner);
      if (Array.isArray(within)) s.within = within.filter((w) => w != null && w !== '').map(String);
      return s;
    },

    // ---- A PANEL'S OWN VOLUME (see `levels` above) ----------------------------------------
    // `path`: an owner id, or [outer, ..., inner]. `v` 0..1 (0 = mute; a broken value is 1, never
    // silence). 1 removes the rule. Returns what is now in force.
    setLevel(path, v) {
      const key = pathKey(path);
      if (!key) return null;
      let n = Number(v);
      if (v === null || v === undefined || v === '' || !Number.isFinite(n)) n = 1;
      n = Math.max(0, Math.min(1, n));
      const was = levels.has(key) ? levels.get(key) : 1;
      if (n === 1) levels.delete(key); else levels.set(key, n);
      if (was !== n) recompute();
      return n;
    },
    levelFor: (path) => { const k = pathKey(path); return levels.has(k) ? levels.get(k) : 1; },

    // ---- HIDDEN AND MUTED (hide_sound.js) -----------------------------------------------
    // Every source `owner` registered - now and later - goes to 0 while muted, and comes back to
    // whatever the arbiter says when unmuted. Returns whether it is now muted.
    muteOwner(owner, on) {
      if (!owner) return false;
      const key = String(owner);
      const was = mutedOwners.has(key);
      if (on) mutedOwners.add(key); else mutedOwners.delete(key);
      if (was !== !!on) recompute();
      return mutedOwners.has(key);
    },
    isOwnerMuted: (owner) => !!owner && mutedOwners.has(String(owner)),
    // The ids of the sources an owner has registered: "does this panel make sound at all". A TV's
    // include what is on it (`within`, 2026-10-02).
    sourcesOf: (owner) => [...sources.values()].filter((s) => owner && (s.owner === String(owner)
      || (Array.isArray(s.within) && s.within.includes(String(owner))))).map((s) => s.id),
    // The owners INSIDE `owner` that make sound (a TV's panels), innermost owner ids, in order seen.
    ownersWithin: (owner) => [...new Set([...sources.values()]
      .filter((s) => owner && Array.isArray(s.within) && s.within.includes(String(owner)) && s.owner)
      .map((s) => s.owner))],

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

    // (spotify sdk) Change what one source does when it would be ducked: 'duck' | 'pause'. Returns what is
    // now in force ('duck' for a source that never said), or null for an unknown source.
    setWhenDucked(id, mode) {
      const s = sources.get(id);
      if (!s) return null;
      if (DUCK_MODES.includes(mode) && (s.whenDucked || 'duck') !== mode) { s.whenDucked = mode; recompute(); }
      return s.whenDucked || 'duck';
    },
    whenDucked: (id) => (sources.has(id) ? (sources.get(id).whenDucked || 'duck') : null),

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

    // 'pause' (default) or 'duck'. Changeable live, because the right answer differs between
    // a phone call and watching something together.
    setCallMode(mode) {
      if (!CALL_MODES.includes(mode)) return onCall;
      onCall = mode;
      recompute();
      return onCall;
    },
    callMode: () => onCall,

    // THE MASTER. `setMaster` takes 0..1 and returns what is now in force: clamped to
    // [floor, 1], or 1 when handed something that is not a number (see MASTER_FLOOR).
    setMaster(v) {
      masterGain = masterValue(v, floor);
      recompute();
      return masterGain;
    },
    master: () => masterValue(masterGain, floor),
    setMasterFloor(v) {
      floor = floorValue(v);
      masterGain = masterValue(masterGain, floor);
      recompute();
      return floor;
    },
    masterFloor: () => floor,

    // ---- THE MIXER (row 2.35) --------------------------------------------------------
    // A fader, 0..1, per channel. Returns what is now in force (a broken value is full).
    setFader(ch, v) {
      if (!ch || typeof ch !== 'string') return null;
      faderOf.set(ch, faderValue(v));
      recompute();
      return faderOf.get(ch);
    },
    fader: (ch) => faderValue(faderFor(ch)),
    // A minimum, 0..1, per channel. Returns what is now in force (a broken value is the default).
    setFloor(ch, v) {
      if (!ch || typeof ch !== 'string') return null;
      floorOf.set(ch, channelFloorValue(v, defaultFloorOf(ch)));
      recompute();
      return floorOf.get(ch);
    },
    floor: (ch) => channelFloorValue(floorFor(ch), defaultFloorOf(ch)),
    channelOf: (id) => (sources.has(id) ? sources.get(id).channel : null),
    // What a source on `ch` would be heard at with nothing ducking it: fader x master, lifted to the
    // floor. For a sound that has no `onGain` and reads its level when it starts - the speech
    // channel. Anything that goes wrong is full volume.
    channelLevel(ch) {
      let g = 1;
      try { g = masterValue(masterGain, floor); } catch { g = 1; }
      const v = mixed(1, ch, g);
      return Number.isFinite(v) ? v : 1;
    },
    // Everything a mixer screen shows, in one read.
    mix() {
      const chans = new Set([...CHANNEL_IDS, ...faderOf.keys(), ...floorOf.keys()]);
      const channels = {};
      for (const ch of chans) channels[ch] = { fader: this.fader(ch), floor: this.floor(ch), level: this.channelLevel(ch) };
      return { master: this.master(), masterFloor: floor, channels };
    },

    isActive: (id) => !!sources.get(id)?.active,
    levelOf: (id) => (sources.has(id) ? sources.get(id).level : null),
    duckTo: () => duckTo,

    state() {
      const out = {};
      for (const [id, s] of sources) {
        out[id] = { tier: s.tier, channel: s.channel, group: s.group ?? null, gp: s.gp, active: s.active, level: s.level,
                    owner: s.owner ?? null, muted: !!(s.owner && mutedOwners.has(s.owner)),
                    within: Array.isArray(s.within) ? s.within.slice() : [], ownerLevel: ownerGain(s) };
      }
      return out;
    },

    destroy() { sources.clear(); mutedOwners.clear(); levels.clear(); hushed = false; },
  };
}
