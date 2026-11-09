"""Tests for make_rhythm_map.py on songs made here, whose beats are known: py -3.13 web/tools/test_make_rhythm_map.py   (needs ffmpeg)"""
import json
import os
import sys
import tempfile
import wave
import zipfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_rhythm_map as M  # noqa: E402

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}  {detail}')


def clicks(times, seconds, level=0.8, hz=1000.0):
    """A click at each time, on a little noise, as floats at M.RATE."""
    out = np.random.default_rng(7).normal(0, 0.002, int(seconds * M.RATE)).astype(np.float32)
    length = int(0.03 * M.RATE)
    shape = np.exp(-np.arange(length) / (0.008 * M.RATE)) * np.sin(2 * np.pi * hz * np.arange(length) / M.RATE)
    for t in times:
        i = int(t * M.RATE)
        out[i:i + length] += (level * shape[:len(out[i:i + length])]).astype(np.float32)
    return out


def nearest_ms(found, want):
    found = np.array(found)
    return np.array([np.abs(found - t).min() for t in want]) * 1000.0


steady = np.arange(0.5, 40, 0.5)       # 120 a minute
r = M.analyse(clicks(steady, 40))
check('*** a steady song: the tempo is found ***', abs(r['bpm'] - 120) < 1.5, r['bpm'])
near = nearest_ms(r['levels']['Hard'], steady)
check('*** the notes land on the clicks, within two frames ***', np.percentile(near, 95) <= 2 * M.FRAME_S * 1000, np.percentile(near, 95))
for name, gap in zip(('Easy', 'Normal', 'Hard'), M.GAPS_MS):
    t = r['levels'][name]
    check(f'{name}: none closer than its gap', len(t) > 5 and np.diff(t).min() >= gap / 1000 - 1e-6, np.diff(t).min() if len(t) > 1 else t)
check('Easy, at a beat under its gap, takes every other beat', abs(np.median(np.diff(r['levels']['Easy'])) - 1.0) < 0.05, np.median(np.diff(r['levels']['Easy'])))

accents = np.arange(0.75, 40, 2.0)
mix = clicks(steady, 40) + clicks(accents, 40, level=0.8, hz=3000.0)
r2 = M.analyse(mix, (600, 200, 200))
near = nearest_ms(r2['levels']['Normal'], accents)
check('Normal takes strong onsets between the beats', np.mean(near < 50) > 0.8, np.mean(near < 50))
check('*** Normal keeps the beat as well ***', np.mean(nearest_ms(r2['levels']['Normal'], np.arange(0.5, 40, 1.0)) < 50) > 0.9)
check('Hard holds at least what Normal does', len(r2['levels']['Hard']) >= len(r2['levels']['Normal']), (len(r2['levels']['Hard']), len(r2['levels']['Normal'])))

gappy = np.concatenate([np.arange(0.5, 15, 0.5), np.arange(30, 45, 0.5)])
r3 = M.analyse(clicks(gappy, 45))
silent = [t for t in r3['levels']['Hard'] if 16 < t < 29]
check('*** no notes in a silence in the middle ***', len(silent) == 0, silent[:5])
check('...and the music after it still has them', sum(1 for t in r3['levels']['Hard'] if t > 30) > 10)

t, drift = 0.5, []
while t < 60:
    drift.append(t)
    t += 60.0 / (100 + 30 * t / 60)        # 100 to 130 a minute
r4 = M.analyse(clicks(np.array(drift), 60))
check('a song that drifts is still followed', np.percentile(nearest_ms(r4['levels']['Hard'], drift), 90) <= 60, np.percentile(nearest_ms(r4['levels']['Hard'], drift), 90))

check('thin keeps the first of a run, then waits', M.thin([0, 0.1, 0.25, 0.3, 0.9], 0.25) == [0, 0.25, 0.9], M.thin([0, 0.1, 0.25, 0.3, 0.9], 0.25))
check('thin_keeping keeps every beat and adds only clear of them', M.thin_keeping([1.0, 2.0], [1.1, 1.5, 2.3], 0.25) == [1.0, 1.5, 2.0, 2.3], M.thin_keeping([1.0, 2.0], [1.1, 1.5, 2.3], 0.25))

dat = M.difficulty_dat([0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0], 120.0)
notes = dat['colorNotes']
check('notes are in beats at the map\'s tempo', [n['b'] for n in notes][:3] == [0.0, 1.0, 2.0])
check('colours change by the bar', [n['c'] for n in notes] == [0, 0, 0, 0, 1, 1, 1])
check('each colour keeps to its own two lanes, walking', [n['x'] for n in notes] == [0, 1, 0, 1, 2, 3, 2], [n['x'] for n in notes])
check('every note is inside the lanes and any cut', all(0 <= n['x'] <= 3 and n['y'] == 0 and n['d'] == 8 for n in notes))
check('a name is made safe for a file', M.safe_name('a/b: c?') == 'a_b_ c_' and M.safe_name('...') == 'song', M.safe_name('a/b: c?'))

with tempfile.TemporaryDirectory() as d:
    wav = os.path.join(d, 'My Song.wav')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(M.RATE)
        w.writeframes((np.clip(clicks(steady, 40), -1, 1) * 32767).astype(np.int16).tobytes())
    out = M.make_map(wav, os.path.join(d, 'maps'))
    check('it makes a zip named for the song', os.path.basename(out['zip']) == 'My Song.zip' and abs(out['bpm'] - 120) < 1.5, out)
    with zipfile.ZipFile(out['zip']) as z:
        names = set(z.namelist())
        info = json.loads(z.read('Info.dat'))
        easy = json.loads(z.read('EasyStandard.dat'))
        ogg = z.read('song.egg')
    check('Info.dat, three levels and the song are in it', names == {'Info.dat', 'EasyStandard.dat', 'NormalStandard.dat', 'HardStandard.dat', 'song.egg'}, names)
    check('the song is really Ogg Vorbis', ogg[:4] == b'OggS' and b'vorbis' in ogg[:64])
    check('Info.dat names what the reader looks for', info['_songFilename'] == 'song.egg' and info['_beatsPerMinute'] > 0
          and [x['_difficulty'] for x in info['_difficultyBeatmapSets'][0]['_difficultyBeatmaps']] == ['Easy', 'Normal', 'Hard'])
    back = np.array([n['b'] for n in easy['colorNotes']]) * 60.0 / info['_beatsPerMinute']
    check('*** read back at Info.dat\'s tempo, the notes are where they were found ***', len(back) > 15 and np.percentile(nearest_ms(steady, back), 90) < 60, np.percentile(nearest_ms(steady, back), 90))
    check('nothing half-written is left behind', not [f for f in os.listdir(os.path.dirname(out['zip'])) if f.endswith('.part')])

    bad = os.path.join(d, 'not a song.mp3')
    with open(bad, 'wb') as f:
        f.write(b'this is not audio')
    code = M.main([bad, '--out', os.path.join(d, 'maps')])
    check('*** a file that is not a song is said, and stops nothing else ***', code == 1 and not os.path.exists(os.path.join(d, 'maps', 'not a song.zip')))
    quiet = np.zeros(M.RATE * 5, dtype=np.float32)
    try:
        M.analyse(quiet)
        check('a silent song is said', False)
    except ValueError as err:
        check('a silent song is said', 'nothing' in str(err), err)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
