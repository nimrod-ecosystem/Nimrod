// game_music_checks.js — THE SAME MUSIC CHECKS FOR EVERY GAME THAT PLAYS ITS MUSIC BY THE PLAY WATCH (row 2.107,
// 2026-10-31): Build it, Sort the bricks, Solitaire, Word Forge, Dress-up, Brick mosaic. Each suite hands in how to open
// its game and how to press, pause and hide it; what is checked is the same for all of them, so a game that wires its
// music differently from the rest fails here rather than sounding different on a screen.
// (The quiz engine's are in quiz_test_rig.js `quizMusicChecks`; the four games before these have their own.)

import { createAudioBus, DUCK_TO } from '../audio_bus.js';
import { createFakeAudioContext } from '../game_tones.js';

/** The rows: the shared ones, with this game's default. */
export function musicRowChecks({ check, manifest, name, defaultMode = 'mine' }) {
  const R = Object.fromEntries((manifest?.settings || []).map((r) => [r.key, r]));
  check(`${name}: *** row 2.107: the shared music rows, "${defaultMode}" by default ***`, R.music?.default === defaultMode
    && (R.music.options || []).map((o) => o.value).join() === 'mine,folder,favourite,ambient,off'
    && !!R.musicSourceId && !!R.musicAlbum && !!R.musicFavourite && R.musicVolume?.default === 0.3, JSON.stringify(R.music?.default));
}

/**
 * The music while it is played.
 *   open({ audio, makeAudioContext, instanceId, saved })  mounts the game (waiting for Start unless the suite says)
 *       and returns { press(), pause()?, hide(), show()?, set(patch), destroy() }
 *   src   the music's id on the arbiter (`<game>-music:<instanceId>`)
 */
export async function musicPlayChecks({ check, name, open, src, instanceId = 'gm1' }) {
  const audio = createAudioBus();
  const contexts = [];
  const g = await open({ audio, instanceId, saved: { music: 'ambient' },
    makeAudioContext: () => { const c = createFakeAudioContext(); contexts.push(c); return c; } });
  const on = () => !!audio.state()[src]?.active;
  const st = audio.state()[src];
  check(`${name}: the music is on the speaker arbiter: music group, media tier`, st?.group === 'music' && st?.tier === 'media', JSON.stringify(st));
  check(`${name}: *** nothing plays before anybody plays ***`, !on());
  await g.press();
  check(`${name}: *** being played: the music plays ***`, on() && contexts.some((c) => c.made.oscillators.length > 0),
    JSON.stringify(audio.state()[src]));
  audio.register('suite-voice', { tier: 'voice' });
  audio.setActive('suite-voice', true);
  check(`${name}: a voice ducks it`, audio.state()[src]?.level === DUCK_TO, JSON.stringify(audio.state()[src]));
  audio.setActive('suite-voice', false);
  if (g.pause) {
    await g.pause();
    check(`${name}: *** paused: the music stops ***`, !on());
    await g.press();
    check(`${name}: going on: it plays again`, on());
  }
  await g.hide();
  check(`${name}: *** hidden: it stops ***`, !on());
  await g.show?.();
  await g.press();
  check(`${name}: shown and pressed again: it plays`, on());
  await g.set({ music: 'off' });
  check(`${name}: Music set to no music while played: silent`, !on());
  await g.set({ music: 'ambient' });
  check(`${name}: ...and on again while played: it plays`, on());
  await g.destroy();
  check(`${name}: *** destroyed: off the arbiter, every context it made closed ***`, !(src in audio.state())
    && contexts.every((c) => c.made.closed), JSON.stringify(contexts.map((c) => c.made.closed)));
}
