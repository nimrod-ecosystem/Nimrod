#!/usr/bin/env python3
"""WHO IS TALKING (row 2.56): the rules, the store, the protocol - with the FAKE speaker engine, so nothing is
heard, nothing is loaded and nothing is downloaded.

Run, from web/:
    py -3.13 speech_service/test_speakers.py
    py -3.13 speech_service/test_speakers.py --real      (also loads the REAL WeSpeaker model if it is already on
                                                          this computer and embeds a second of synthetic noise -
                                                          ~10 s; skipped, and said, when it is not)
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from speech_service import speakers as SPK  # noqa: E402
from speech_service.backends import FakeBackend  # noqa: E402
from speech_service.service import Session, create_app  # noqa: E402

passed = failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


def section(t):
    print(f'\n-- {t}')


def voice(value: int, seconds: float) -> bytes:
    """`seconds` of constant audio whose sample value names a fake VOICE (FakeSpeakerEngine)."""
    return value.to_bytes(2, 'little', signed=True) * int(16000 * seconds)


def float_lists(x, found=None, minimum=8):
    """Every list of >= `minimum` plain numbers anywhere in a JSON value: what a voiceprint looks like."""
    found = [] if found is None else found
    if isinstance(x, dict):
        for v in x.values():
            float_lists(v, found, minimum)
    elif isinstance(x, list):
        if len(x) >= minimum and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in x):
            found.append(x)
        for v in x:
            float_lists(v, found, minimum)
    return found


# ------------------------------------------------------------------------------------------ the scale ----
def scale_tests():
    section('the "how sure" scale')
    f = SPK.sure_from_score
    check('the match score is "named" (0.8) and the maybe score is "maybe" (0.4)',
          f(SPK.SPEAKER_MATCH) == SPK.SURE_NAMED and f(SPK.SPEAKER_MAYBE) == SPK.SURE_MAYBE,
          (f(SPK.SPEAKER_MATCH), f(SPK.SPEAKER_MAYBE)))
    xs = [-1, -0.2, 0, 0.1, 0.29, 0.3, 0.4, 0.49, 0.5, 0.7, 0.99, 1]
    ys = [f(x) for x in xs]
    check('it only re-labels: never decreasing, 0 at or below 0, 1 at 1', all(a <= b for a, b in zip(ys, ys[1:]))
          and ys[0] == 0 and ys[2] == 0 and ys[-1] == 1, ys)
    check('not a number -> None (never a made-up certainty)', f(float('nan')) is None and f('x') is None and f(None) is None)
    check('another engine\'s numbers move the anchors, not the scale',
          f(0.6, match=0.6, maybe=0.4) == SPK.SURE_NAMED and f(0.4, match=0.6, maybe=0.4) == SPK.SURE_MAYBE)
    # The scale's anchors ARE the site's display rule. Held equal by reading subtitles.js.
    src = (HERE.parent / 'client' / 'subtitles.js').read_text(encoding='utf-8')
    m = re.search(r'SUBTITLES_DEFAULTS\s*=\s*Object\.freeze\(\{(.*?)\}\);', src, re.S)
    body = m.group(1) if m else ''
    sure = re.search(r'\bsureAt:\s*([0-9.]+)', body)
    maybe = re.search(r'\bmaybeAt:\s*([0-9.]+)', body)
    check('*** the anchors equal subtitles.js SUBTITLES_DEFAULTS sureAt / maybeAt (one rule, two files) ***',
          sure and maybe and float(sure.group(1)) == SPK.SURE_NAMED and float(maybe.group(1)) == SPK.SURE_MAYBE,
          (sure and sure.group(1), maybe and maybe.group(1)))
    vp = HERE.parent / 'client' / 'voice_id.js'
    vid = vp.read_text(encoding='utf-8') if vp.is_file() else ''
    m2 = re.search(r'SURE_NAMED\s*=\s*([0-9.]+)', vid)
    check('...and voice_id.js\'s own copy of "named"', m2 and float(m2.group(1)) == SPK.SURE_NAMED, m2 and m2.group(1))


# ------------------------------------------------------------------------------------------ the store ----
def store_tests(tmp: Path):
    section('the store: one small file per person, on this computer')
    st = SPK.VoiceprintStore(str(tmp / 'vp'))
    check('an empty or missing folder: nobody', st.all() == [] and st.summary() == [])
    d = st.save('p_1', '  Alex  ', [0.6, 0.8, 0.0], 'fake-speaker', 4, 17.25)
    files = list((tmp / 'vp').iterdir())
    check('save writes ONE file named for the person, and no temporary file is left',
          [x.name for x in files] == ['p_1.voiceprint.json'], [x.name for x in files])
    raw = json.loads(files[0].read_text(encoding='utf-8'))
    check('the file says what it is (the tag storage_line.py refuses) and holds only who, engine, numbers, when, how much',
          raw['format'] == SPK.FORMAT and set(raw) == {'format', 'v', 'person', 'name', 'engine', 'dims', 'vector',
                                                        'enrolledAt', 'clips', 'seconds'} and raw['name'] == 'Alex', raw)
    s = st.summary('fake-speaker')
    check('*** the summary a screen may see has NO numbers (invariant 1) ***',
          s and 'vector' not in s[0] and not float_lists(s, minimum=2) and s[0]['usable'] is True, s)
    check('a voiceprint made by another engine is listed as not usable here', st.summary('other')[0]['usable'] is False)
    for bad in ['../x', '..', 'a/b', 'a\\b', '', 'x' * 65, None, 5, 'a b']:
        try:
            st.save(bad, 'n', [1.0], 'e', 3, 10)
            ok = False
        except ValueError:
            ok = True
        check(f'a person id that could name another file is refused: {bad!r}', ok)
    (tmp / 'vp' / 'junk.voiceprint.json').write_text('{not json', encoding='utf-8')
    (tmp / 'vp' / 'other.voiceprint.json').write_text(json.dumps({'format': 'something-else', 'person': 'q',
                                                                   'vector': [1]}), encoding='utf-8')
    check('a broken or foreign file is skipped, never read as a voiceprint', [x['person'] for x in st.all()] == ['p_1'])
    check('forget removes it and says it existed', st.forget('p_1') is True and st.all() == [])
    check('forgetting somebody who is not set up says so', st.forget('p_1') is False)


# ------------------------------------------------------------------------------------- the rules ----
def make(tmp: Path, **kw):
    calls = {'n': 0}
    eng = SPK.FakeSpeakerEngine()

    def factory():
        calls['n'] += 1
        return eng
    sp = SPK.Speakers(factory, SPK.VoiceprintStore(str(tmp)), eng.name, **kw)
    return sp, calls, eng


def enrol_voice(sp, person, name, value, n=4, secs=4.0):
    return sp.enrol(person, name, [(sp.embed(voice(value, secs)), secs) for _ in range(n)])


def rules_tests(tmp: Path):
    section('the fake engine (what the tests stand on)')
    e = SPK.FakeSpeakerEngine()
    same = SPK.cosine(e.embed(voice(1000, 1)), e.embed(voice(1000, 2)))
    other = SPK.cosine(e.embed(voice(1000, 1)), e.embed(voice(2000, 1)))
    near = SPK.cosine(e.embed(voice(1000, 1)), e.embed(voice(1030, 1)))
    check('one voice scores 1 against itself; another voice scores far lower; an offset voice in between',
          abs(same - 1) < 1e-9 and other < SPK.SPEAKER_MAYBE and SPK.SPEAKER_MAYBE < near < 1, (same, other, near))

    section('identify')
    sp, calls, _ = make(tmp / 'r1')
    r = sp.identify(voice(1000, 2))
    check('*** nobody set up: "who" is null, and the engine is NOT loaded to find that out ***',
          r['who'] is None and r['why'] == 'nobody' and calls['n'] == 0, (r, calls))
    enrol_voice(sp, 'p_alex', 'Alex', 1000)
    enrol_voice(sp, 'p_sam', 'Sam', 2000)
    r = sp.identify(voice(1000, 2))
    check('Alex speaking: named, with how sure (at least "named")', r['who'] == 'Alex' and r['person'] == 'p_alex'
          and r['sure'] >= SPK.SURE_NAMED and r['maybe'] is None, r)
    r = sp.identify(voice(2000, 3))
    check('Sam speaking: Sam', r['who'] == 'Sam', r)
    r = sp.identify(voice(5000, 2))
    check('*** a stranger: null - nobody who did not set themselves up is ever named ***',
          r['who'] is None and r['person'] is None and r['maybe'] is None, r)
    r = sp.identify(voice(1000, 0.5))
    check('half a second ("pause"): not compared at all - too short to tell', r['who'] is None and r['why'] == 'short'
          and r['sure'] is None, r)
    # An offset voice: like Alex, not enough to name.
    mid = next(v for v in range(1001, 1100) if SPK.SURE_MAYBE <= (sp.identify(voice(v, 2))['sure'] or 0) < SPK.SURE_NAMED)
    r = sp.identify(voice(mid, 2))
    check('like Alex but not enough: who null, "maybe Alex" (the subtitle says "Unsure (maybe Alex)")',
          r['who'] is None and r['maybe'] == 'Alex', r)
    r = sp.identify(voice(1000, 2), sure_at=1.01)
    check('the person\'s own "how sure" decides: set above anything possible, nobody is ever named plainly',
          r['who'] is None and r['maybe'] == 'Alex', r)
    r = sp.identify(voice(mid, 2), sure_at=SPK.SURE_MAYBE)
    check('...and set low, the same voice is named', r['who'] == 'Alex', r)
    # Two prints of one voice: not an answer.
    enrol_voice(sp, 'p_twin', 'Twin', 1000)
    r = sp.identify(voice(1000, 2))
    check('two voiceprints nearly the same: nobody is named, the closer is a maybe, and why says so',
          r['who'] is None and r['maybe'] in ('Alex', 'Twin') and r['why'] == 'close', r)
    sp.forget('p_twin')
    check('forget, and the other is named again at once (the cache follows the folder)',
          sp.identify(voice(1000, 2))['who'] == 'Alex')

    section('enrolment')
    sp2, _, _ = make(tmp / 'r2')
    for clips, why in ([(sp2.embed(voice(1000, 4)), 4.0)] * 2, 'two sentences'), \
                      ([(sp2.embed(voice(1000, 2)), 2.0)] * 4, 'four short ones (8 s)'):
        try:
            sp2.enrol('p_a', 'A', clips)
            ok = False
        except ValueError as err:
            ok = 'Nothing was saved' in str(err)
        check(f'not enough clear speech ({why}): refused with a sentence, and nothing saved', ok and not sp2.store.all())
    clips = [(sp2.embed(voice(1000, 4)), 4.0)] * 4 + [(sp2.embed(voice(3000, 4)), 4.0)]
    d = sp2.enrol('p_a', 'A', clips)
    check('*** a sentence in another voice (staff talking, a TV) is DROPPED from the voiceprint ***',
          d['dropped'] == 1 and d['clips'] == 4, d)
    check('enrol returns who, how much and when - never the numbers', not float_lists(d, minimum=2), d)
    try:
        sp2.enrol('../evil', 'x', clips)
        ok = False
    except ValueError:
        ok = True
    check('an id that could name another file is refused at enrolment', ok)

    section('an engine that cannot run here')

    def missing():
        raise SPK.SpeakerEngineMissing('the speaker model is not on this computer')
    sp3 = SPK.Speakers(missing, SPK.VoiceprintStore(str(tmp / 'r1')), 'fake-speaker')
    r = sp3.identify(voice(1000, 2))
    check('identify says why (engine) instead of raising', r['who'] is None and r['why'] == 'engine', r)


# ------------------------------------------------------------------------------------- the protocol ----
async def protocol_tests(tmp: Path):
    section('the protocol (Session, fake backend + fake speaker engine)')
    sent = []

    async def send(m):
        sent.append(m)

    async def close(code):
        pass

    sp, calls, _ = make(tmp / 'p')
    texts = iter(['turn it up', 'hello there', 'who am i', 'the quick brown fox', 'jumps over', 'the lazy dog',
                  'and again', 'one more', 'still talking', 'last'] * 4)
    b = FakeBackend(script=lambda pcm, g: next(texts))

    async def say(s, uid, pcm):
        await s.on_text(json.dumps({'type': 'begin', 'utteranceId': uid}))
        await s.on_bytes(pcm)
        await s.on_text(json.dumps({'type': 'end', 'utteranceId': uid}))
        await s.drain()

    s = Session(b, send, close, speakers=sp)
    await s.on_text(json.dumps({'type': 'hello', 'rate': 16000}))
    check('hello names the speaker engine', sent[-1]['kind'] == 'hello' and sent[-1]['speakers'] == 'fake-speaker',
          sent[-1])
    await say(s, 'u1', voice(1000, 2))
    f = sent[-1]
    check('a screen that did not ask: the final has speaker null, and the engine was never loaded',
          f['kind'] == 'final' and f['speaker'] is None and calls['n'] == 0, (f, calls))
    await s.on_text(json.dumps({'type': 'speakers', 'on': True}))
    await say(s, 'u2', voice(1000, 2))
    f = sent[-1]
    check('asked, with nobody set up: who null (why nobody), the WORDS are there, engine still not loaded',
          f['text'] == 'hello there' and f['speaker']['who'] is None and f['speaker']['why'] == 'nobody'
          and calls['n'] == 0, (f, calls))

    # Set up Alex: four sentences, then done.
    sent.clear()
    await s.on_text(json.dumps({'type': 'enrol', 'person': 'p_alex', 'name': 'Alex'}))
    for i in range(4):
        await say(s, f'e{i}', voice(1000, 4))
    heard = [m for m in sent if m['kind'] == 'enrol-heard']
    finals = [m for m in sent if m['kind'] == 'final']
    check('each sentence: its words come back as usual, then how far the setup has got',
          len(finals) == 4 and [h['clips'] for h in heard] == [1, 2, 3, 4] and heard[-1]['seconds'] == 16.0,
          (finals, heard))
    check('a sentence being used for setup is not itself labelled (speaker null)', all(f['speaker'] is None for f in finals))
    await s.on_text(json.dumps({'type': 'enrol-done', 'person': 'p_alex'}))
    await s.drain()
    done = sent[-1]
    check('enrol-done: "enrolled", with how much went in', done['kind'] == 'enrolled' and done['person'] == 'p_alex'
          and done['name'] == 'Alex' and done['clips'] == 4, done)
    check('...and the voiceprint is a file in the folder on this computer',
          (tmp / 'p' / 'p_alex.voiceprint.json').is_file())

    sent.clear()
    await say(s, 'u3', voice(1000, 2))
    await say(s, 'u4', voice(7000, 2))
    fin = [m for m in sent if m['kind'] == 'final']
    a, b2 = fin[-2], fin[-1]
    check('two utterances, two finals', len(fin) == 2, sent)
    check('Alex talks: the final carries who = Alex and how sure', (a.get('speaker') or {}).get('who') == 'Alex'
          and a['speaker']['person'] == 'p_alex' and a['speaker']['sure'] >= 0.8, a)
    check('*** a stranger talks: who null ("Unknown") AND THE WORDS ARE STILL SENT (row 2.42) ***',
          b2['kind'] == 'final' and b2['text'] and b2['speaker']['who'] is None, b2)
    await s.on_text(json.dumps({'type': 'speakers', 'on': True, 'sureAt': 1.01}))
    await say(s, 'u5', voice(1000, 2))
    check('the screen\'s "how sure" (the person\'s setting) is what names: above anything, Alex is only a maybe',
          sent[-1]['speaker']['who'] is None and sent[-1]['speaker']['maybe'] == 'Alex', sent[-1])
    await s.on_text(json.dumps({'type': 'speakers', 'on': False}))
    await say(s, 'u6', voice(1000, 2))
    check('turned off: speaker null again', sent[-1]['speaker'] is None, sent[-1])

    # Listing and forgetting.
    await s.on_text(json.dumps({'type': 'voiceprints'}))
    v = sent[-1]
    check('voiceprints lists who is set up here', v['kind'] == 'voiceprints' and [p['person'] for p in v['people']] == ['p_alex'], v)
    # Cancel: nothing kept.
    await s.on_text(json.dumps({'type': 'enrol', 'person': 'p_sam', 'name': 'Sam'}))
    for i in range(4):
        await say(s, f'c{i}', voice(2000, 4))
    await s.on_text(json.dumps({'type': 'enrol-cancel'}))
    await s.on_text(json.dumps({'type': 'enrol-done', 'person': 'p_sam'}))
    await s.drain()
    check('cancelled, then done: refused, and nothing saved', sent[-1]['kind'] == 'enrol-failed'
          and not (tmp / 'p' / 'p_sam.voiceprint.json').exists(), sent[-1])
    await s.on_text(json.dumps({'type': 'enrol', 'person': 'p_sam', 'name': 'Sam'}))
    await say(s, 'd1', voice(2000, 4))
    await s.on_text(json.dumps({'type': 'enrol-done', 'person': 'p_sam'}))
    await s.drain()
    check('too little speech: enrol-failed with a sentence a person can read, nothing saved',
          sent[-1]['kind'] == 'enrol-failed' and 'Nothing was saved' in sent[-1]['error']
          and not (tmp / 'p' / 'p_sam.voiceprint.json').exists(), sent[-1])
    await s.on_text(json.dumps({'type': 'enrol', 'person': '../../x', 'name': 'x'}))
    check('an id that could name another file: refused', sent[-1]['kind'] == 'enrol-failed', sent[-1])
    await s.on_text(json.dumps({'type': 'forget', 'person': 'p_alex'}))
    check('forget: forgotten, it existed, and the file is gone', sent[-1] == {'kind': 'forgotten', 'person': 'p_alex',
          'existed': True} and not (tmp / 'p' / 'p_alex.voiceprint.json').exists(), sent[-1])
    await s.on_text(json.dumps({'type': 'speakers', 'on': True}))
    await say(s, 'u7', voice(1000, 2))
    check('after forgetting, Alex is Unknown - and still written down', sent[-1]['speaker']['who'] is None
          and sent[-1]['text'], sent[-1])

    everything = json.dumps(sent)
    check('*** NO MESSAGE THE SERVICE SENT CARRIED A LIST OF NUMBERS (a voiceprint never leaves, invariant 1) ***',
          not float_lists(json.loads(everything), minimum=SPK.FakeSpeakerEngine.DIMS // 2), float_lists(json.loads(everything))[:1])

    section('services without it')
    sent.clear()
    s2 = Session(FakeBackend(script=['x']), send, close)
    await s2.on_text(json.dumps({'type': 'hello', 'rate': 16000}))
    check('no speaker engine: hello says speakers null', sent[-1]['speakers'] is None, sent[-1])
    await s2.on_text(json.dumps({'type': 'enrol', 'person': 'p1', 'name': 'x'}))
    check('...and enrolling there is refused with an error, not a silent nothing',
          sent[-1]['kind'] == 'error' and 'speaker' in sent[-1]['error'], sent[-1])
    await say(s2, 'z1', voice(1000, 2))
    check('...and its finals carry speaker null', sent[-1]['kind'] == 'final' and sent[-1]['speaker'] is None, sent[-1])
    sent.clear()
    s3 = Session(None, send, close, speakers=sp)
    await s3.on_text(json.dumps({'type': 'hello', 'rate': 16000}))
    check('a wake-only service offers no "who" (it hears no utterances)', sent[-1]['speakers'] is None, sent[-1])

    section('who failing never costs the words')
    sent.clear()

    def broken():
        raise RuntimeError('boom')
    spb = SPK.Speakers(broken, SPK.VoiceprintStore(str(tmp / 'p2')), 'fake-speaker')
    SPK.VoiceprintStore(str(tmp / 'p2')).save('p_x', 'X', [1.0] * 16, 'fake-speaker', 4, 16)
    s4 = Session(FakeBackend(script=['still here']), send, close, speakers=spb)
    await s4.on_text(json.dumps({'type': 'hello', 'rate': 16000}))
    await s4.on_text(json.dumps({'type': 'speakers', 'on': True}))
    await say(s4, 'b1', voice(1000, 2))
    check('*** an engine that will not start: the final still comes, with its words, who null and why ***',
          sent[-1]['kind'] == 'final' and sent[-1]['text'] == 'still here' and sent[-1]['speaker']['who'] is None
          and sent[-1]['speaker']['why'] == 'engine', sent[-1])
    await s4.on_text(json.dumps({'type': 'enrol', 'person': 'p_y', 'name': 'Y'}))
    await say(s4, 'b2', voice(1000, 4))
    check('...and setting up a voice there says it failed, in words', any(m['kind'] == 'enrol-failed' for m in sent[-2:]),
          sent[-2:])


def fastapi_tests():
    section('/health over FastAPI')
    try:
        from fastapi.testclient import TestClient
    except ImportError:
        print('SKIP  FastAPI not installed')
        return
    sp = SPK.make_speakers('fake', folder=tempfile.mkdtemp())
    h = TestClient(create_app(FakeBackend(script=['hi']), speakers=sp), base_url='http://127.0.0.1').get('/health').json()
    check('/health names the speaker engine (never anybody\'s voiceprint)', h.get('speakers') == 'fake-speaker'
          and not float_lists(h, minimum=2), h)


def cli_tests(tmp: Path):
    section('the command line')
    from speech_service import __main__ as cli
    a = cli.parse(['--speakers', 'none'])
    check('--speakers none: off', cli.speakers_from(a, 'whisper')[0] is None)
    a = cli.parse(['--speakers', 'fake', '--voiceprints', str(tmp / 'cli')])
    sp, said = cli.speakers_from(a, 'whisper')
    check('--speakers fake --voiceprints <folder>: that folder', sp is not None and sp.store.folder == str(tmp / 'cli'), said)
    check('a wake-only service never offers it', cli.speakers_from(a, 'none')[0] is None)
    a = cli.parse(['--speaker-model', str(tmp / 'nowhere.bin')])
    sp, said = cli.speakers_from(a, 'whisper')
    check('*** auto with no model on this computer: OFF, and it says nothing is downloaded ***',
          sp is None and 'nothing is downloaded' in said, said)
    a = cli.parse([])
    check('the defaults are the argued numbers', (a.speaker_match, a.speaker_maybe, a.speaker_margin, a.speaker_min_s)
          == (SPK.SPEAKER_MATCH, SPK.SPEAKER_MAYBE, SPK.SPEAKER_MARGIN, SPK.SPEAKER_MIN_S) and a.speakers == 'auto')
    check('the default folder is beside the speech program, named voiceprints',
          Path(SPK.VOICEPRINTS_DIR) == HERE / 'voiceprints')
    try:
        r = subprocess.run(['git', 'check-ignore', '-q', str(HERE / 'voiceprints' / 'p_1.voiceprint.json')],
                           cwd=str(HERE), capture_output=True, timeout=20)
        check('*** git ignores the voiceprints folder (a voiceprint never enters the tree) ***', r.returncode == 0,
              r.returncode)
        r = subprocess.run(['git', 'check-ignore', '-q', str(HERE / 'speakers.py')], cwd=str(HERE),
                           capture_output=True, timeout=20)
        check('...and not the program itself', r.returncode == 1, r.returncode)
    except (OSError, subprocess.TimeoutExpired) as err:
        print(f'SKIP  git not available: {err}')


def real_tests():
    section('the REAL engine (--real): only files already on this computer')
    path = SPK.find_wespeaker()
    if not path:
        print('SKIP  the WeSpeaker model is not on this computer (nothing is downloaded)')
        return
    import random
    import time
    t0 = time.perf_counter()
    try:
        eng = SPK.WespeakerEngine()
    except SPK.SpeakerEngineMissing as err:
        print(f'SKIP  {err}')
        return
    load = time.perf_counter() - t0
    r = random.Random(1)
    pcm = b''.join(int(r.gauss(0, 3000)).to_bytes(2, 'little', signed=True) for _ in range(16000 * 2))
    t1 = time.perf_counter()
    v = eng.embed(pcm)
    check(f'WeSpeaker loads offline ({load:.1f} s) and gives 256 numbers for 2 s of audio ({(time.perf_counter() - t1) * 1000:.0f} ms)',
          len(v) == 256 and all(math.isfinite(x) for x in v), len(v))


if __name__ == '__main__':
    tmp = Path(tempfile.mkdtemp(prefix='nimrod_speakers_'))
    try:
        scale_tests()
        store_tests(tmp / 'store')
        rules_tests(tmp / 'rules')
        asyncio.run(protocol_tests(tmp / 'proto'))
        fastapi_tests()
        cli_tests(tmp / 'cli')
        if '--real' in sys.argv:
            real_tests()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{"ALL PASS" if not failed else "FAILED"} - {passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)
