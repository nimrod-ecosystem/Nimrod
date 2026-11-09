// rhythm_song.js — PLAYING A BEAT SABER MAP SOMEBODY BROUGHT (row 2.222, note FE 4; proposal_teams_beatmaps_20261106 and
// proposal_rhythm_levels_20261108, both gated). beatmap.js reads the map; `judgeNote` (rhythm_beat.js) judges a press against
// its notes; this is the song itself: its clock, which note is lit, what has been missed, and how it ended. The panel
// (modules/rhythm.js) draws it. No DOM here, and the song's element is handed in, so a suite needs no real song.
//
// *** THE SONG'S OWN CLOCK. *** "Now" is the song's position, so a stall in the song never makes a press late. Nothing is judged
// or missed while it is paused or buffering (the gate: `now` comes from the song, never from the animation frames).
//
// PLAYED THROUGH AN <audio> ON THE AUDIO BUS (the media tier), never decoded into memory: a four-minute song is about 85 MB of
// samples on a Pi 400. A spoken word ducks it, a call pauses it, Hush silences it, as any video.
//
// THE THREE WAYS TO PLAY (the row "How to play a song"):
//   one   ONE BUTTON: every note is one press of anything. The default, Code's guess while Mike rules (on his list): the only way
//         a single switch can play, and one a beginner finishes. AGAINST: it ignores the map's colours and lanes, which are the
//         game for an experienced player; they are one setting away.
//   two   TWO BUTTONS: the map's two colours are the left and right tiles. A touch on a tile, or Back for left and Next for right.
//         Opt-in, because it changes what a scanning person's two switches mean.
//   four  FOUR LANES: the map's four columns are four tiles to touch.
//   A press that names no side (one switch, in any way of playing) always counts: the panel's own rule, "a switch or a key always
//   counts".
//
// NOTHING ENDS A SONG BUT THE SONG (no fail, as the game has always been): a miss is just not a hit. A song nobody plays along to
// plays to its end (the gate: the beat's idle stop would cut the music mid-song).
//
// THINNING: `thinNotes` with a minimum gap, and a note thinned away is never lit and never judged. The gap's default is worked out,
// not fixed (`autoGapMs`), and the screen's flash limit sets a floor under it. WHEN A TILE LIGHTS is worked out once, ahead
// (`lightTimes`), and does not depend on the presses, so a run of presses can never make the lights come faster.
import { judgeNote, missedNotes, noteWindowMs, WINDOWS, WINDOW_MAX_FRACTION } from './rhythm_beat.js';
import { thinNotes, LANES } from './beatmap.js';
import { MUSIC_GROUP, VIDEO_PRIORITY } from './audio_bus.js';
import { maxPerMinute, minFlashPeriodMs, normalizeFlashLimit, FLASH_LIMIT_DEFAULT } from './flash_limit.js';

export const PLAY_MODES = Object.freeze(['one', 'two', 'four']);
export const PLAY_MODE_DEFAULT = 'one';
// How early a note's tile lights before its moment. Half a second by default. FOR less: closer to the music. AGAINST, and it sets
// it: a press that takes effort needs warning, and unlike the beat game's steady tick a map's next note cannot be felt coming.
export const LEAD_CHOICES = Object.freeze([0, 250, 500, 1000]);
export const LEAD_DEFAULT = 500;
// The minimum gap between notes. 0 is "worked out for this person" (`autoGapMs`); the rest are chosen.
export const GAP_CHOICES = Object.freeze([0, 200, 300, 400, 600, 800, 1000, 1500]);

/** The tiles a song is drawn on: two for colours, four for lanes, or the panel's own number for one button. PURE. */
export const tilesFor = (mode, tiles) => (mode === 'two' ? 2 : mode === 'four' ? LANES : Math.max(1, Math.round(Number(tiles) || LANES)));
/** Which tile a note lights. PURE. */
export function tileOfNote(note, mode, tiles) {
  if (!note) return null;
  if (mode === 'two') return note.colour === 1 ? 1 : 0;
  if (mode === 'four') return note.lane;
  return note.lane % tilesFor(mode, tiles);
}
/**
 * The gap "worked out for this person": for one button, the gap at which a note keeps the person's whole window (a window is capped
 * at 40% of the gap, so window / 0.4); a person with a generous window so gets a dense map thinned to what they can play. For two
 * buttons or four lanes, none: somebody choosing those wants the map's own notes, and can set a gap. PURE.
 */
export function autoGapMs(windowSetting, mode) {
  if (mode !== PLAY_MODE_DEFAULT) return 0;
  const w = typeof windowSetting === 'number' ? windowSetting : (WINDOWS[windowSetting] ?? WINDOWS.generous);
  return Math.round(w / WINDOW_MAX_FRACTION);
}
/** The gap in force: the chosen or worked-out one, never under what the screen's flash limit allows. PURE. */
export function gapInForce({ gapMs = 0, windowSetting = 'generous', mode = PLAY_MODE_DEFAULT, flashLimit = FLASH_LIMIT_DEFAULT } = {}) {
  const chosen = Number(gapMs) > 0 ? Number(gapMs) : autoGapMs(windowSetting, mode);
  const perMinute = maxPerMinute(normalizeFlashLimit(flashLimit));
  return Math.max(chosen, Number.isFinite(perMinute) && perMinute > 0 ? 60000 / perMinute : 0);
}
/**
 * When each note's tile is lit: from `leadMs` before its moment (later if the note before is still open, or if the flash limit says
 * it must wait) until its judging window closes. One note lit at a time, and every light starts at least the limit's period after
 * the one before. PURE.
 */
export function lightTimes(notes, { leadMs = LEAD_DEFAULT, window: windowSetting = 'generous', offsetMs = 0, flashLimit = FLASH_LIMIT_DEFAULT } = {}) {
  const list = Array.isArray(notes) ? notes : [];
  const period = minFlashPeriodMs(normalizeFlashLimit(flashLimit));
  const lead = Math.max(0, Number(leadMs) || 0);
  const late = Number(offsetMs) || 0;
  const out = [];
  let on = -Infinity, off = -Infinity;
  list.forEach((n, i) => {
    on = Math.max(Number(n.ms) - lead, off, on + period);
    off = Number(n.ms) + noteWindowMs(list, i, windowSetting) + late;
    out.push({ on, off });
  });
  return out;
}

/**
 * One song, once. `url`: the song; `notes`: beatmap.js's. Returns
 *   start() -> Promise<{ ok, reason? }>   (a browser may refuse sound before a press: reason 'blocked')
 *   pause() resume() stop()
 *   step()        catch up: the notes that have been missed; call every frame
 *   press({ tile?, side? }) -> { verdict, i } | null   null: not judged (paused, buffering, or nowhere near a note)
 *   lit() -> { i, tile, hit } | null
 *   result() -> { hits, total, misses, presses }, state()
 * `onEnded(result)` once, when the song plays out; `onFailed()` once, when the song will not play.
 */
export function createSongRun({
  url, notes = [], mode = PLAY_MODE_DEFAULT, tiles = LANES, window: windowSetting = 'generous', offsetMs = 0, gapMs = 0,
  flashLimit = FLASH_LIMIT_DEFAULT, leadMs = LEAD_DEFAULT, audio = null, audioId = 'rhythm:song', channel = 'media',
  makeAudio = (src) => (typeof Audio === 'function' ? new Audio(src) : null), onEnded = null, onFailed = null,
} = {}) {
  const m = PLAY_MODES.includes(mode) ? mode : PLAY_MODE_DEFAULT;
  const list = thinNotes(notes, gapInForce({ gapMs, windowSetting, mode: m, flashLimit }));
  const lights = lightTimes(list, { leadMs, window: windowSetting, offsetMs, flashLimit });
  const answered = new Map();     // i -> verdict: a press has been judged against this note
  const missed = new Set();       // no press came in its window (a press a little later still gets told "late")
  const closed = { has: (i) => answered.has(i) || missed.has(i) };
  let hits = 0, presses = 0, gain = 1, wanted = false, buffering = false, finished = false, dead = false, cursor = 0;
  const el = makeAudio(url);
  if (el) { try { el.preload = 'auto'; } catch { /* a fake */ } }
  const enact = () => {
    if (!el) return;
    try { el.volume = Math.max(0, Math.min(1, gain)); } catch { /* not ready */ }
    if (gain === 0) { try { el.pause?.(); } catch { /* fine */ } } else if (wanted && el.paused) { try { el.play?.()?.catch?.(() => {}); } catch { /* fine */ } }
  };
  try {
    audio?.register?.(audioId, { tier: 'media', group: MUSIC_GROUP, groupPriority: VIDEO_PRIORITY, channel,
      onGain: (level) => { gain = Number(level) || 0; enact(); } });
  } catch (err) { console.error('rhythm song: audio bus', err); }
  const active = (on) => { try { audio?.setActive?.(audioId, on); } catch { /* advice only */ } };
  const result = () => ({ hits, total: list.length, misses: missed.size, presses });
  const songNow = () => Number(el?.currentTime || 0) * 1000;
  const judgeable = () => !!el && wanted && !el.paused && !buffering && !finished && !dead;
  function step(atEnd = false) {
    if (!atEnd && !judgeable()) return;
    for (const i of missedNotes(atEnd ? Infinity : songNow(), list, { window: windowSetting, offset: offsetMs, judged: closed })) missed.add(i);
  }
  el?.addEventListener?.('waiting', () => { buffering = true; });
  el?.addEventListener?.('playing', () => { buffering = false; });
  el?.addEventListener?.('ended', () => {
    if (finished || dead) return;
    finished = true; wanted = false;
    step(true);                       // whatever was left at the very end is missed
    active(false);
    try { onEnded?.(result()); } catch (err) { console.error('rhythm song: ended', err); }
  });
  el?.addEventListener?.('error', () => {
    if (finished || dead) return;
    finished = true; wanted = false;
    active(false);
    try { onFailed?.(); } catch (err) { console.error('rhythm song: failed', err); }
  });
  return {
    async start() {
      if (!el) return { ok: false, reason: 'no-audio' };
      wanted = true;
      active(true);
      try { await el.play?.(); return { ok: true }; } catch { return { ok: false, reason: 'blocked' }; }
    },
    pause() { wanted = false; try { el?.pause?.(); } catch { /* fine */ } active(false); },
    async resume() {
      if (finished || dead || !el) return { ok: false };
      wanted = true; active(true);
      try { await el.play?.(); return { ok: true }; } catch { return { ok: false, reason: 'blocked' }; }
    },
    stop() {
      if (dead) return;
      dead = true; wanted = false;
      try { el?.pause?.(); el?.removeAttribute?.('src'); el?.load?.(); } catch { /* a fake, or gone */ }
      active(false);
      try { audio?.unregister?.(audioId); } catch { /* gone */ }
    },
    step,
    /** The panel's speaker ("Its sound comes out of"). */
    setSink(id) { try { Promise.resolve(el?.setSinkId?.(id)).catch(() => {}); } catch { /* the default speaker */ } },
    /** A press, judged against the nearest note not yet answered. Far from any note it is not an answer, and takes no note away. */
    press({ tile = null, side = null } = {}) {
      if (!judgeable()) return null;
      presses += 1;
      step();
      const j = judgeNote(songNow(), list, { window: windowSetting, offset: offsetMs, judged: { has: (i) => answered.has(i) } });
      if (j.i < 0) return null;
      if (j.verdict !== 'hit' && Math.abs(j.delta) > 2 * noteWindowMs(list, j.i, windowSetting)) return null;
      const named = tile != null ? tile : side;
      let verdict = j.verdict;
      if (verdict === 'hit' && named != null && m !== PLAY_MODE_DEFAULT && named !== tileOfNote(list[j.i], m, tiles)) verdict = 'wrong';
      if (verdict === 'hit') hits += 1;
      answered.set(j.i, verdict);
      missed.delete(j.i);
      return { verdict, i: j.i };
    },
    /** The note lit now. The lights go on whether or not anybody presses: a hit shows on the tile until the note's light ends. */
    lit() {
      if (!judgeable()) return null;
      const t = songNow();
      while (cursor < lights.length && t > lights[cursor].off) cursor += 1;
      if (cursor >= lights.length || t < lights[cursor].on) return null;
      return { i: cursor, tile: tileOfNote(list[cursor], m, tiles), hit: answered.get(cursor) === 'hit' };
    },
    result,
    state: () => ({ mode: m, total: list.length, ...result(), wanted, buffering, finished, playing: judgeable(),
      at: el ? Number(el.currentTime || 0) : 0 }),
  };
}
