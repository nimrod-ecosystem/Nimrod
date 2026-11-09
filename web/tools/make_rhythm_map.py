"""make_rhythm_map.py - a draft Beat Saber map from a song, for the Rhythm game (row 2.253, note FW 1.4; proposal_rhythm_levels, gated).

Finds the beats and the onsets in a song and writes a map zip at three levels: Easy (on the beat), Normal (the beat and the strong onsets),
Hard (the onsets). The zip opens in Rhythm's "Open a map...", or in an editor to be tuned by ear. It is the standard format, so
people's maps and these go through one reader. A DRAFT: the machine finds where the music moves, not what is fun to press.

  py -3.13 web/tools/make_rhythm_map.py <song> [<song> ...] --out <folder>
  options: --gaps 600,350,200 (the shortest time between notes in Easy, Normal, Hard, ms)  --quality 4 (Ogg Vorbis, ffmpeg's -q:a)

Offline; nothing is uploaded. The song goes into the zip with its tags, so a zip is as shareable as its song is, and no more; this makes no map public.

Needs: ffmpeg on PATH, and numpy.

*** NOT librosa, as the proposal named. *** FOR it: tested by many. AGAINST, and it wins for a draft: a large install for what is about 60 lines
here (the same method: spectral flux for onsets, a tempo prior over the autocorrelation, Ellis's dynamic-programming beat tracker, which
also follows a song that drifts), and numpy is already here. If a song's draft is wrong often enough to matter, swap `analyse`.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

import numpy as np

RATE = 22050
FFT = 2048
HOP = 512
FRAME_S = HOP / RATE
# Tempo is searched here. A song's beat could be read at half or twice itself; the prior leans to the middle.
BPM_MIN, BPM_MAX, BPM_PRIOR = 50.0, 200.0, 110.0
# Ellis's weight on keeping to the tempo against landing on an onset; 100 is the published value, also librosa's.
TIGHTNESS = 100.0
# Quieter than this share of the song's loud level is treated as no music: no notes in a fade or a silent intro.
QUIET = 0.1
# An onset must stand this many deviations over its neighbourhood to count at all; "strong" (Normal) is the top share of them.
ONSET_DELTA, STRONG_SHARE = 0.5, 0.35
# Shortest time between notes, Easy / Normal / Hard. FOR shorter: more of the song. AGAINST: Rhythm thins for one button anyway (625 ms at a
# generous window), and two buttons or four lanes play what the level holds. An option, since a fast song may want other numbers.
GAPS_MS = (600, 350, 200)
LEVELS = (('Easy', 1), ('Normal', 3), ('Hard', 5))
# COLOURS CHANGE EVERY BAR (four beats). The proposal said by phrase; FOR that: tidier to tune. AGAINST, and it wins: a 16-beat phrase on one
# hand is one button for eight seconds, which is not two-button play.
BEATS_PER_BAR = 4
MAP_ZIP_MAX = 80 * 1024 * 1024    # beatmap.js's cap; a zip over it would be refused when opened


def decode(path):
    """The song as mono floats at RATE."""
    run = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True)
    if run.returncode != 0:
        raise ValueError(f'ffmpeg could not read it: {run.stderr.decode(errors="replace").strip()[:200]}')
    return np.frombuffer(run.stdout, dtype=np.float32).copy()


def envelope(samples):
    """(onset strength per frame, loudness per frame). Frame k is centred on k * HOP samples."""
    padded = np.concatenate([np.zeros(FFT // 2), samples, np.zeros(FFT // 2)])
    n = max(0, (len(padded) - FFT) // HOP + 1)
    if n < 2:
        return np.zeros(n), np.zeros(n)
    window = np.hanning(FFT)
    flux, loud = np.zeros(n), np.zeros(n)
    prev = None
    for k in range(n):
        frame = padded[k * HOP:k * HOP + FFT]
        mag = np.log1p(100.0 * np.abs(np.fft.rfft(frame * window)))
        if prev is not None:
            flux[k] = np.maximum(0.0, mag - prev).sum()
        prev = mag
        loud[k] = float(np.sqrt(np.mean(frame ** 2)))
    # Take away the local level, so a loud section is not all "onset".
    width = max(1, int(round(1.0 / FRAME_S)))
    level = np.convolve(flux, np.ones(width) / width, mode='same')
    flux = np.maximum(0.0, flux - level)
    sd = flux.std()
    return (flux / sd if sd > 0 else flux), loud


def tempo_of(env):
    """Beats a minute: the autocorrelation's best lag, under a log-normal lean to the prior."""
    env = env - env.mean()
    spectrum = np.fft.rfft(env, 2 * len(env))
    corr = np.fft.irfft(spectrum * np.conj(spectrum))[:len(env)]
    lags = np.arange(max(1, int(60.0 / BPM_MAX / FRAME_S)), min(len(env) - 1, int(np.ceil(60.0 / BPM_MIN / FRAME_S))) + 1)
    if len(lags) == 0:
        return BPM_PRIOR
    bpm = 60.0 / (lags * FRAME_S)
    weighted = corr[lags] * np.exp(-0.5 * (np.log2(bpm / BPM_PRIOR) / 1.0) ** 2)
    i = int(np.argmax(weighted))
    # Between frames: a parabola through the peak, or a tempo could only be a few whole lags apart.
    lag = float(lags[i])
    if 0 < i < len(lags) - 1:
        a, b, c = weighted[i - 1], weighted[i], weighted[i + 1]
        if a - 2 * b + c < 0:
            lag += 0.5 * (a - c) / (a - 2 * b + c)
    return 60.0 / (lag * FRAME_S)


def beats_of(env, bpm):
    """Frames of the beats: Ellis's dynamic programme, each beat the best trade between its onset and keeping time with the one before."""
    n = len(env)
    period = 60.0 / bpm / FRAME_S
    score = env.astype(float).copy()
    back = np.full(n, -1)
    lo, hi = int(round(period / 2)), int(round(period * 2))
    offs = np.arange(-hi, -lo + 1)
    penalty = -TIGHTNESS * np.log(-offs / period) ** 2
    for t in range(n):
        start = max(0, -offs[0] - t)
        if start >= len(offs):
            continue
        cand = score[t + offs[start:]] + penalty[start:]
        best = int(np.argmax(cand))
        if cand[best] > 0:
            score[t] = env[t] + cand[best]
            back[t] = t + offs[start + best]
    # Finish on the last strong local best.
    ends = [t for t in range(1, n - 1) if score[t] >= score[t - 1] and score[t] >= score[t + 1]]
    if not ends:
        return np.array([], dtype=int)
    ends = np.array(ends)
    limit = 0.5 * np.median(score[ends])
    t = int(ends[score[ends] >= limit][-1])
    out = []
    while t >= 0:
        out.append(t)
        t = int(back[t])
    return np.array(out[::-1], dtype=int)


def onsets_of(env):
    """Frames where the music moves: local peaks standing clear of what is around them."""
    out = []
    near = max(1, int(round(0.03 / FRAME_S)))
    for t in range(near, len(env) - near):
        if env[t] <= 0 or env[t] < env[t - near:t + near + 1].max():
            continue
        if env[t] >= ONSET_DELTA:
            out.append(t)
    return np.array(out, dtype=int)


def thin(times, gap_s):
    """The first of each run, then the next once `gap_s` has passed (beatmap.js's thinning, so a level is steady, not merged). PURE."""
    out, last = [], -1e12
    for t in times:
        if t - last >= gap_s - 1e-9:
            out.append(float(t))
            last = t
    return out


def analyse(samples, gaps_ms=GAPS_MS):
    """{ bpm, levels: { name: [seconds] } } from the song's samples."""
    env, loud = envelope(samples)
    if len(env) < 8 or env.max() <= 0:
        raise ValueError('it has nothing in it to follow: silent, or too short')
    bpm = tempo_of(env)
    beats = beats_of(env, bpm)
    onsets = onsets_of(env)
    # A long song's silences are no music, however the tracker walked through them.
    enough = QUIET * np.percentile(loud, 95)
    sounding = lambda f: f[loud[f] >= enough] if len(f) else f  # noqa: E731
    beats, onsets = sounding(beats), sounding(onsets)
    strong = onsets[env[onsets] >= np.quantile(env[onsets], 1 - STRONG_SHARE)] if len(onsets) else onsets
    secs = lambda f: np.sort(np.unique(f)) * FRAME_S  # noqa: E731
    easy, normal, hard = gaps_ms
    return {
        'bpm': bpm,
        'levels': {
            'Easy': thin(secs(beats), easy / 1000.0),
            # Beats are kept first: a strong onset takes a note only where no beat is too close.
            'Normal': thin_keeping(secs(beats), secs(strong), normal / 1000.0),
            'Hard': thin(secs(np.concatenate([beats, onsets])), hard / 1000.0),
        },
    }


def thin_keeping(first, others, gap_s):
    """All of `first` (thinned), then each of `others` that lands at least `gap_s` from every note kept. PURE."""
    kept = thin(first, gap_s)
    for t in others:
        i = np.searchsorted(kept, t)
        before = kept[i - 1] if i > 0 else -1e12
        after = kept[i] if i < len(kept) else 1e12
        if t - before >= gap_s and after - t >= gap_s:
            kept.insert(int(i), float(t))
    return kept


def difficulty_dat(times, bpm):
    """A v3 difficulty: colours change by the bar, each colour keeps to its own two lanes, walking between them. PURE."""
    notes = []
    per_second = bpm / 60.0
    walk = [0, 0]
    for t in times:
        beat = t * per_second
        colour = int(beat // BEATS_PER_BAR) % 2
        lane = colour * 2 + walk[colour] % 2
        walk[colour] += 1
        notes.append({'b': round(beat, 5), 'x': lane, 'y': 0, 'c': colour, 'd': 8})
    return {'version': '3.3.0', 'bpmEvents': [], 'rotationEvents': [], 'colorNotes': notes, 'bombNotes': [], 'obstacles': [], 'sliders': [],
            'burstSliders': [], 'waypoints': [], 'basicBeatmapEvents': [], 'colorBoostBeatmapEvents': [], 'useNormalEventsAsCompatibleEvents': False}


def info_dat(title, bpm, level_names):
    return {
        '_version': '2.1.0', '_songName': title, '_songSubName': '', '_songAuthorName': '', '_levelAuthorName': 'make_rhythm_map (a draft)',
        '_beatsPerMinute': round(bpm, 3), '_shuffle': 0, '_shufflePeriod': 0.5, '_previewStartTime': 0, '_previewDuration': 10,
        '_songFilename': 'song.egg', '_coverImageFilename': '', '_environmentName': 'DefaultEnvironment', '_songTimeOffset': 0,
        '_difficultyBeatmapSets': [{'_beatmapCharacteristicName': 'Standard', '_difficultyBeatmaps': [
            {'_difficulty': name, '_difficultyRank': rank, '_beatmapFilename': f'{name}Standard.dat', '_noteJumpMovementSpeed': 10, '_noteJumpStartBeatOffset': 0}
            for name, rank in LEVELS if name in level_names]}],
    }


def safe_name(stem):
    return re.sub(r'[^\w .()\'-]+', '_', stem).strip(' .') or 'song'


def make_map(song, out_dir, gaps_ms=GAPS_MS, quality=4):
    """Writes <out_dir>/<song's name>.zip. Returns { zip, bpm, counts, seconds }; raises ValueError with a sentence when it cannot."""
    samples = decode(song)
    result = analyse(samples, gaps_ms)
    levels = {name: times for name, times in result['levels'].items() if times}
    if not levels:
        raise ValueError('no beats were found in it')
    os.makedirs(out_dir, exist_ok=True)
    title = os.path.splitext(os.path.basename(song))[0]
    target = os.path.join(out_dir, safe_name(title) + '.zip')
    with tempfile.TemporaryDirectory() as tmp:
        ogg = os.path.join(tmp, 'song.ogg')
        # THE SONG'S TAGS COME ALONG (-map_metadata 0). Suno's terms ask that its provenance is not stripped to hide where a song came from, so a
        # converter does not decide that. They can hold an account name and the lyrics: a reason to look before sharing a zip, not to strip here.
        run = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', song, '-vn', '-map_metadata', '0', '-c:a', 'libvorbis', '-q:a', str(quality), '-f', 'ogg', ogg], capture_output=True)
        if run.returncode != 0:
            raise ValueError(f'ffmpeg could not make the Ogg: {run.stderr.decode(errors="replace").strip()[:200]}')
        if os.path.getsize(ogg) > MAP_ZIP_MAX - 1024 * 1024:
            raise ValueError(f'the song is too large for a map: Rhythm reads up to {MAP_ZIP_MAX // 1048576} MB')
        with zipfile.ZipFile(target + '.part', 'w') as z:
            z.writestr('Info.dat', json.dumps(info_dat(title, result['bpm'], levels), indent=1), zipfile.ZIP_DEFLATED)
            for name, times in levels.items():
                z.writestr(f'{name}Standard.dat', json.dumps(difficulty_dat(times, round(result['bpm'], 3))), zipfile.ZIP_DEFLATED)
            z.write(ogg, 'song.egg', zipfile.ZIP_STORED)
    os.replace(target + '.part', target)
    return {'zip': target, 'bpm': result['bpm'], 'counts': {k: len(v) for k, v in levels.items()}, 'seconds': len(samples) / RATE}


def main(argv=None):
    p = argparse.ArgumentParser(description='A draft Beat Saber map from a song, for the Rhythm game.')
    p.add_argument('songs', nargs='+')
    p.add_argument('--out', required=True)
    p.add_argument('--gaps', default=','.join(str(g) for g in GAPS_MS), help='shortest ms between notes: Easy,Normal,Hard')
    p.add_argument('--quality', type=int, default=4, help="the Ogg's quality, ffmpeg's -q:a")
    a = p.parse_args(argv)
    gaps = tuple(int(g) for g in a.gaps.split(','))
    if len(gaps) != 3 or min(gaps) <= 0:
        p.error('--gaps takes three positive numbers')
    bad = 0
    for song in a.songs:
        try:
            r = make_map(song, a.out, gaps, a.quality)
            print(f"{os.path.basename(song)}: {r['bpm']:.1f} a minute, {r['seconds']:.0f} s, notes {r['counts']} -> {r['zip']}")
        except (ValueError, OSError) as err:
            bad += 1
            print(f'{os.path.basename(song)}: not made: {err}', file=sys.stderr)
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
