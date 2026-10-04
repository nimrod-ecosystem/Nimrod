#!/usr/bin/env python3
"""The speech service's protocol, tested with the fake backend - no model, no microphone, nothing
downloaded. Both servers are exercised: FastAPI (through its TestClient) and plain websockets (a real
socket on a free loopback port).

Run, from web/:
    py -3.13 speech_service/test_service.py
    py -3.13 speech_service/test_service.py --real-whisper <folder of 16 kHz mono wav files>
        (also runs every wav through the REAL faster-whisper backend over a real socket and prints
         text, confidence and seconds per utterance; the model must already be in the local cache)
"""
from __future__ import annotations

import asyncio
import json
import socket
import sys
import threading
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from speech_service.backends import FakeBackend, FakeWakeDetector, _Edge  # noqa: E402
from speech_service.service import (  # noqa: E402
    CLOSE_UNAUTHORISED, Session, create_app, secrets_match, serve_websockets)

passed = 0
failed = 0


def check(name: str, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


def pcm(ms: int, value: int = 1000) -> bytes:
    n = int(16000 * ms / 1000)
    return (value.to_bytes(2, 'little', signed=True)) * n


# ------------------------------------------------------------------ the Session, no transport ----
async def session_tests():
    sent, closed = [], []

    async def send(m):
        sent.append(m)

    async def close(code):
        closed.append(code)

    b = FakeBackend(script=['computer please pause', {'text': 'maybe', 'confidence': 0.3,
                                                      'words': [{'w': 'maybe', 'conf': 0.3}]}])
    s = Session(b, send, close, secret='s3')
    await s.on_bytes(pcm(20))
    check('audio before hello: refused and closed', closed and sent[-1]['kind'] == 'error', sent)

    sent.clear(); closed.clear()
    s = Session(b, send, close, secret='s3')
    await s.on_text(json.dumps({'type': 'hello', 'secret': 'wrong'}))
    check('*** a wrong secret: an error and close 4401 - nothing is transcribed ***',
          closed == [CLOSE_UNAUTHORISED] and sent[-1]['error'] == 'secret', (closed, sent))

    sent.clear(); closed.clear()
    s = Session(b, send, close, secret='s3')
    await s.on_text(json.dumps({'type': 'hello', 'secret': 's3', 'rate': 16000}))
    check('hello: the engine and what it can do', sent[-1]['kind'] == 'hello' and sent[-1]['engine'] == 'fake'
          and sent[-1]['grammar'] is True and sent[-1]['protocol'] == 1, sent)
    await s.on_bytes(pcm(20))
    check('audio with no utterance begun is dropped, not stored or answered', len(sent) == 1)
    await s.on_text(json.dumps({'type': 'mode', 'mode': 'grammar', 'grammar': ['pause', 'play']}))
    await s.on_text(json.dumps({'type': 'begin', 'utteranceId': 'u1'}))
    await s.on_bytes(pcm(100))
    check('partials come back under the utterance id', sent[-1] == {'kind': 'partial', 'utteranceId': 'u1',
                                                                    'text': 'partial 1', 'engine': 'fake'}, sent[-1])
    await s.on_text(json.dumps({'type': 'end', 'utteranceId': 'u1'}))
    await s.drain()
    f = sent[-1]
    check('*** end -> one final: text, confidence, words, engine, the same utterance id ***',
          f['kind'] == 'final' and f['utteranceId'] == 'u1' and f['text'] == 'computer please pause'
          and f['confidence'] == 0.9 and f['words'][0] == {'w': 'computer', 'conf': 0.9} and f['engine'] == 'fake', f)
    check('final says how long the audio was', f['audioMs'] == 100, f)
    check('grammar mode reaches a backend that has grammars', b.grammars[-1] == ['pause', 'play'], b.grammars)
    await s.on_text(json.dumps({'type': 'mode', 'mode': 'open', 'grammar': None}))
    await s.on_text(json.dumps({'type': 'begin', 'utteranceId': 'u2'}))
    check('back to open: no grammar', b.grammars[-1] is None, b.grammars)
    await s.on_text(json.dumps({'type': 'cancel', 'utteranceId': 'u2'}))
    n = len(sent)
    await s.on_text(json.dumps({'type': 'end', 'utteranceId': 'u2'}))
    await s.drain()
    check('a cancelled utterance is never transcribed', sent[-1]['kind'] == 'error' and len(sent) == n + 1, sent[-1])
    # A new begin abandons one never ended.
    await s.on_text(json.dumps({'type': 'begin', 'utteranceId': 'u3'}))
    await s.on_text(json.dumps({'type': 'begin', 'utteranceId': 'u4'}))
    await s.on_bytes(pcm(40))
    await s.on_text(json.dumps({'type': 'end', 'utteranceId': 'u4'}))
    await s.drain()
    finals = [m for m in sent if m['kind'] == 'final']
    check('a begin with no end is abandoned by the next begin (one final, for u4)',
          [m['utteranceId'] for m in finals] == ['u1', 'u4'], finals)
    check('low confidence is passed through as the engine said it', finals[-1]['confidence'] == 0.3, finals[-1])

    # The length cap.
    sent.clear()
    s2 = Session(FakeBackend(script=['x'], partials=False), send, close, max_utterance_s=0.5)
    await s2.on_text(json.dumps({'type': 'hello'}))
    await s2.on_text(json.dumps({'type': 'begin', 'utteranceId': 'long'}))
    for _ in range(10):
        await s2.on_bytes(pcm(100))
    await s2.on_text(json.dumps({'type': 'end', 'utteranceId': 'long'}))
    await s2.drain()
    f = sent[-1]
    check('*** an utterance past the cap stops growing, and says it was cut ***',
          f['cut'] is True and f['audioMs'] == 500, f)

    check('secrets: none set accepts anything; set, only the same string',
          secrets_match(None, None) and secrets_match('a', 'a') and not secrets_match('a', 'b')
          and not secrets_match('a', None))

    # Two utterances back to back: finals in order even though decoding runs off the loop.
    sent.clear()
    s3 = Session(FakeBackend(script=['one', 'two'], partials=False, delay_s=0.05), send, close)
    await s3.on_text(json.dumps({'type': 'hello'}))
    for uid in ('a', 'b'):
        await s3.on_text(json.dumps({'type': 'begin', 'utteranceId': uid}))
        await s3.on_bytes(pcm(20))
        await s3.on_text(json.dumps({'type': 'end', 'utteranceId': uid}))
    await s3.drain()
    got = [(m['utteranceId'], m['text']) for m in sent if m['kind'] == 'final']
    check('two utterances back to back: both answered, each under its own id, IN THE ORDER SAID',
          got == [('a', 'one'), ('b', 'two')], got)


# ------------------------------------------------------------------ the wake stream ------------
def mark(ms: int = 20) -> bytes:
    """Audio the fake wake detector 'hears' as its phrase."""
    return pcm(ms, 12345)


async def wake_tests():
    sent, closed = [], []

    async def send(m):
        sent.append(m)

    async def close(code):
        closed.append(code)

    e = _Edge(0.5, 2.0)
    fires = [e.check('w', s, t) for s, t in [(0.6, 0.08), (0.9, 0.16), (0.7, 0.24), (0.1, 0.32),
                                                (0.8, 0.40), (0.1, 2.5), (0.8, 2.6)]]
    check('*** the edge rule: ONE fire per crossing, and none again inside the refractory time ***',
          fires == [True, False, False, False, False, False, True], fires)

    s = Session(FakeBackend(script=['computer please pause'], partials=False), send, close,
                wake=FakeWakeDetector())
    await s.on_text(json.dumps({'type': 'hello'}))
    check('hello says which wake words this service can hear', sent[-1]['wake'] == ['computer_please'], sent[-1])
    await s.on_bytes(mark())
    check('no wake events until the screen asks for the stream', len(sent) == 1, sent)
    await s.on_text(json.dumps({'type': 'wake', 'on': True}))
    await s.on_bytes(pcm(500, 0))
    await s.on_bytes(mark())
    w = sent[-1]
    check('*** wake on: audio OUTSIDE any utterance is scored, and the phrase comes back as an event ***',
          w['kind'] == 'wake' and w['word'] == 'computer_please' and w['score'] == 0.9
          and w['atMs'] == 520 and 'utteranceId' not in w and w['detector'] == 'fake-wake:computer_please', w)
    n = len(sent)
    await s.on_bytes(mark())
    await s.on_bytes(pcm(500, 0))
    await s.on_bytes(mark())
    check('the phrase again inside the refractory time: no second event', len(sent) == n, sent[n:])
    await s.on_bytes(pcm(2000, 0))
    await s.on_text(json.dumps({'type': 'begin', 'utteranceId': 'u9'}))
    await s.on_bytes(mark())
    await s.on_bytes(pcm(300))
    await s.on_text(json.dumps({'type': 'end', 'utteranceId': 'u9'}))
    await s.drain()
    kinds = [(m['kind'], m.get('utteranceId')) for m in sent[n:]]
    check('*** inside an utterance: the wake event names it and comes BEFORE its final; the final still comes ***',
          kinds == [('wake', 'u9'), ('final', 'u9')], kinds)
    check('the utterance audio still reaches the recogniser whole (wake scoring takes nothing away)',
          sent[-1]['audioMs'] == 320, sent[-1])
    await s.on_text(json.dumps({'type': 'wake', 'on': False}))
    n = len(sent)
    await s.on_bytes(pcm(3000, 0))
    await s.on_bytes(mark())
    check('wake off: no more events', len(sent) == n, sent[n:])

    sent.clear()
    s2 = Session(FakeBackend(), send, close)
    await s2.on_text(json.dumps({'type': 'hello'}))
    await s2.on_text(json.dumps({'type': 'wake', 'on': True}))
    check('wake on a service with no detector: an error, said', sent[0]['wake'] == []
          and sent[-1] == {'kind': 'error', 'error': 'no wake detector on this service'}, sent)

    sent.clear()
    s3 = Session(None, send, close, wake=FakeWakeDetector(word='hey_jarvis'))
    await s3.on_text(json.dumps({'type': 'hello'}))
    await s3.on_text(json.dumps({'type': 'begin', 'utteranceId': 'x'}))
    await s3.on_text(json.dumps({'type': 'wake', 'on': True}))
    await s3.on_bytes(mark())
    check('*** a wake-only service (--backend none): engine none, refuses begin, still wakes ***',
          sent[0]['engine'] == 'none' and sent[1]['kind'] == 'error' and sent[1]['utteranceId'] == 'x'
          and sent[-1]['kind'] == 'wake' and sent[-1]['word'] == 'hey_jarvis', sent)
    check('a wake-only service never answers a final', not any(m['kind'] == 'final' for m in sent), sent)


# ------------------------------------------------------------------ FastAPI --------------------
def fastapi_tests():
    from fastapi.testclient import TestClient
    app = create_app(FakeBackend(script=['nimrod please next']), secret='k')
    c = TestClient(app)
    h = c.get('/health').json()
    check('/health: up, which engine, whether a secret is needed - and nothing heard',
          h == {'ok': True, 'engine': 'fake', 'protocol': 1, 'secret': True, 'wake': []}, h)
    with c.websocket_connect('/speech') as ws:
        ws.send_text(json.dumps({'type': 'hello', 'secret': 'k'}))
        check('fastapi: hello', ws.receive_json()['kind'] == 'hello')
        ws.send_text(json.dumps({'type': 'begin', 'utteranceId': 'z'}))
        ws.send_bytes(pcm(60))
        p = ws.receive_json()
        ws.send_text(json.dumps({'type': 'end', 'utteranceId': 'z'}))
        f = ws.receive_json()
        check('*** fastapi: binary audio in, partial then final out, under the same id ***',
              p['kind'] == 'partial' and f['kind'] == 'final' and f['utteranceId'] == 'z'
              and f['text'] == 'nimrod please next', (p, f))
    with c.websocket_connect('/speech') as ws:
        ws.send_text(json.dumps({'type': 'hello', 'secret': 'nope'}))
        e = ws.receive_json()
        check('fastapi: a wrong secret is refused', e['kind'] == 'error' and e['error'] == 'secret', e)


# ------------------------------------------------------------------ plain websockets -----------
def free_port() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def start_ws_server(backend, secret=None, wake=None):
    port = free_port()
    ready = threading.Event()
    loop = asyncio.new_event_loop()

    def run():
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(serve_websockets(backend, '127.0.0.1', port, secret=secret, ready=ready,
                                                     wake=wake))
        except Exception:  # noqa: BLE001 - stopped
            pass

    t = threading.Thread(target=run, daemon=True)
    t.start()
    ready.wait(10)
    return port, loop


async def ws_client(port, clips, secret=None, mode=None):
    from websockets.asyncio.client import connect
    out = []
    async with connect(f'ws://127.0.0.1:{port}/speech', max_size=2 ** 20) as ws:
        await ws.send(json.dumps({'type': 'hello', 'secret': secret, 'rate': 16000}))
        hello = json.loads(await ws.recv())
        if mode:
            await ws.send(json.dumps(mode))
        for i, data in enumerate(clips):
            uid = f'c{i}'
            t0 = time.perf_counter()
            await ws.send(json.dumps({'type': 'begin', 'utteranceId': uid}))
            for k in range(0, len(data), 3200):          # 100 ms frames, as the screen sends them
                await ws.send(data[k:k + 3200])
            await ws.send(json.dumps({'type': 'end', 'utteranceId': uid}))
            while True:
                m = json.loads(await ws.recv())
                if m['kind'] == 'final' and m['utteranceId'] == uid:
                    m['wall_s'] = time.perf_counter() - t0
                    out.append(m)
                    break
                if m['kind'] == 'error':
                    out.append(m)
                    break
    return hello, out


def websockets_tests():
    port, _loop = start_ws_server(FakeBackend(script=['computer please louder'], partials=False), secret='pw')
    hello, out = asyncio.run(ws_client(port, [pcm(300)], secret='pw'))
    check('*** plain websockets server (what the Pi runs): hello, then a final for the clip ***',
          hello['kind'] == 'hello' and out and out[0]['text'] == 'computer please louder', (hello, out))

    async def bad():
        from websockets.asyncio.client import connect
        async with connect(f'ws://127.0.0.1:{port}/speech') as ws:
            await ws.send(json.dumps({'type': 'hello', 'secret': 'no'}))
            e = json.loads(await ws.recv())
            try:
                await ws.recv()
            except Exception as err:  # noqa: BLE001
                return e, getattr(getattr(err, 'rcvd', None), 'code', None)
            return e, None
    e, code = asyncio.run(bad())
    check('plain websockets: a wrong secret -> error, close 4401', e['error'] == 'secret' and code == CLOSE_UNAUTHORISED,
          (e, code))

    # The wake stream over a real socket: 20 ms frames, no utterance, one event back.
    wport, _ = start_ws_server(None, wake=FakeWakeDetector(word='hey_jarvis'))

    async def wake_client():
        from websockets.asyncio.client import connect
        async with connect(f'ws://127.0.0.1:{wport}/speech') as ws:
            await ws.send(json.dumps({'type': 'hello'}))
            hello = json.loads(await ws.recv())
            await ws.send(json.dumps({'type': 'wake', 'on': True}))
            for _ in range(25):
                await ws.send(pcm(20, 0))
            await ws.send(mark())
            return hello, json.loads(await asyncio.wait_for(ws.recv(), 5))
    hello, ev = asyncio.run(wake_client())
    check('*** plain websockets, wake-only: hello lists the word; streamed frames -> one wake event ***',
          hello['engine'] == 'none' and hello['wake'] == ['hey_jarvis'] and ev['kind'] == 'wake'
          and ev['word'] == 'hey_jarvis' and ev['atMs'] == 520, (hello, ev))


def read_wav(p: Path) -> bytes:
    with wave.open(str(p), 'rb') as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, p
        return w.readframes(w.getnframes())


async def live_client(url, clips, secret=None, mode=None):
    from websockets.asyncio.client import connect
    out = []
    async with connect(url, max_size=2 ** 20) as ws:
        await ws.send(json.dumps({'type': 'hello', 'secret': secret, 'rate': 16000}))
        hello = json.loads(await ws.recv())
        if mode:
            await ws.send(json.dumps(mode))
        for i, data in enumerate(clips):
            uid = f'c{i}'
            await ws.send(json.dumps({'type': 'begin', 'utteranceId': uid}))
            for k in range(0, len(data), 640):          # 20 ms frames, as the screen sends them
                await ws.send(data[k:k + 640])
            t0 = time.perf_counter()                     # from the END of speech: what a person waits
            await ws.send(json.dumps({'type': 'end', 'utteranceId': uid}))
            while True:
                m = json.loads(await ws.recv())
                if m['kind'] in ('final', 'error') and m.get('utteranceId') == uid:
                    m['wall_s'] = time.perf_counter() - t0
                    out.append(m)
                    break
    return hello, out


def live(url: str, folder: str, grammar=None, secret=None):
    """Send every wav in `folder` to a RUNNING service and print what came back, timed from the end of
    each clip. The clip is sent faster than real time, so for a backend that decodes as audio arrives
    (Vosk) this time includes decoding the whole clip - an upper bound on the real wait."""
    files = sorted(Path(folder).glob('*.wav'))
    mode = {'type': 'mode', 'mode': 'grammar', 'grammar': grammar} if grammar else None
    hello, out = asyncio.run(live_client(url, [read_wav(f) for f in files], mode=mode, secret=secret))
    print(f'\nLIVE {url} ({hello.get("engine")}), {len(files)} clips{" grammar" if grammar else ""}')
    walls = []
    for f, m in zip(files, out):
        walls.append(m.get('wall_s', 0))
        low = [w['w'] for w in m.get('words', []) if (w.get('conf') or 0) < 0.6]
        print(f'  {f.stem:52s} {m.get("wall_s", 0):5.2f}s conf {m.get("confidence")!s:.5}  "{m.get("text")}"  low:{low}')
    walls.sort()
    if walls:
        print(f'  after end of speech: median {walls[len(walls) // 2]:.2f} s, max {walls[-1]:.2f} s')


def real_whisper(folder: str):
    from speech_service.backends import WhisperBackend
    t0 = time.perf_counter()
    b = WhisperBackend()
    load = time.perf_counter() - t0
    files = sorted(Path(folder).glob('*.wav'))
    port, _ = start_ws_server(b)
    hello, out = asyncio.run(ws_client(port, [read_wav(f) for f in files]))
    print(f'\nREAL faster-whisper ({hello.get("engine")}), load {load:.1f} s, {len(files)} clips')
    walls = []
    for f, m in zip(files, out):
        walls.append(m.get('wall_s', 0))
        low = [w['w'] for w in m.get('words', []) if (w.get('conf') or 0) < 0.6]
        print(f'  {f.stem:34s} {m.get("wall_s", 0):5.2f}s  decode {m.get("ms")} ms  conf {m.get("confidence")!s:.5}'
              f'  "{m.get("text")}"  low:{low}')
    if walls:
        walls.sort()
        print(f'  median {walls[len(walls) // 2]:.2f} s, max {walls[-1]:.2f} s')


def wake_model_tests():
    """The project's own wake models (models/*.onnx, trained 2026-10-02): `--wake computer_please` must
    find them, and they must stay small enough to live in the repo."""
    import tempfile
    from speech_service.backends import WAKE_MODELS_DIR, resolve_wake_models
    # Which trained models ship is Mike's call (licences; see the training report), so these checks cover
    # whichever ARE in models/ -- none, today -- and the resolver is proven on a temporary folder below.
    present = sorted(Path(WAKE_MODELS_DIR).glob('*.onnx')) if Path(WAKE_MODELS_DIR).is_dir() else []
    files = present
    sizes = {f.name: f.stat().st_size for f in present}
    check('*** each shipped wake model is under 1 MB (a big one belongs elsewhere) ***',
          all(s < 1_000_000 for s in sizes.values()), sizes)
    got = resolve_wake_models([f.stem for f in present])
    check('each shipped model resolves from its bare name', [Path(g) for g in got] == present, got)
    check("openWakeWord's own pre-trained names and explicit paths pass through untouched",
          resolve_wake_models(['hey_jarvis', 'x/y.onnx', 'computer_please.onnx']) == ['hey_jarvis', 'x/y.onnx',
                                                                                    'computer_please.onnx'])
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / 'foo.onnx').write_bytes(b'')
        check('a bare name resolves only when that file exists', resolve_wake_models(['foo', 'bar'], d) ==
              [str(Path(d) / 'foo.onnx'), 'bar'])
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:
        print('SKIP  wake models not run (no onnxruntime here)')
        return
    for f in files:
        if not f.is_file():
            continue
        s = ort.InferenceSession(str(f), providers=['CPUExecutionProvider'])
        i = s.get_inputs()[0]
        y = s.run(None, {i.name: np.zeros((1, 16, 96), np.float32)})[0]
        check(f'{f.name}: takes 16 frames of 96 features, gives one score in 0..1',
              list(i.shape)[1:] == [16, 96] and y.shape == (1, 1) and 0 <= float(y[0, 0]) <= 1,
              (i.shape, y.shape, y))


def model_folder_tests():
    """A model trained on one person's voice (Google's Euphonia toolkit fine-tunes Whisper; converted with
    ct2-transformers-converter) is a FOLDER handed to --model. A folder missing a file faster-whisper needs
    must stop the service AT START, naming every missing file - not on the first thing somebody says, and
    not (for tokenizer.json) by quietly fetching a stock tokenizer from the internet. Empty files stand in
    for the real ones: nothing here loads a model."""
    import contextlib
    import io
    import tempfile
    from speech_service import __main__ as cli
    from speech_service.backends import (
        ModelFolderError, WhisperBackend, check_whisper_folder, is_model_folder, whisper_engine_name,
        whisper_folder_missing)

    def folder(root: Path, name: str, files):
        p = root / name
        p.mkdir()
        for f in files:
            (p / f).write_bytes(b'')
        return p

    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        full = folder(root, 'my-voice', ['model.bin', 'config.json', 'tokenizer.json', 'preprocessor_config.json',
                                         'vocabulary.json'])
        check('a complete converted folder: nothing missing, nothing advised', whisper_folder_missing(str(full)) == ([], []),
              whisper_folder_missing(str(full)))
        old = folder(root, 'older', ['model.bin', 'config.json', 'tokenizer.json', 'preprocessor_config.json',
                                     'vocabulary.txt'])
        check('vocabulary.txt (older converters) counts as the vocabulary', whisper_folder_missing(str(old))[0] == [])
        half = folder(root, 'half', ['model.bin', 'config.json'])
        missing, advised = whisper_folder_missing(str(half))
        check('*** an incomplete folder: EVERY missing file is named ***',
              missing == ['tokenizer.json', 'vocabulary.json (or vocabulary.txt)'], missing)
        check('preprocessor_config.json missing is ADVICE, not a refusal (faster-whisper has defaults for it)',
              advised == ['preprocessor_config.json'], advised)
        msg = ''
        try:
            check_whisper_folder(str(half))
        except ModelFolderError as err:
            msg = str(err)
        check('*** the refusal names the files and the fix (convert again with --copy_files) ***',
              'tokenizer.json' in msg and 'vocabulary' in msg and '--copy_files' in msg, msg)
        check('a complete folder passes the check (and hands back what is advised: nothing)',
              check_whisper_folder(str(full)) == [])
        gone = ''
        try:
            check_whisper_folder(str(root / 'nope' / 'model'))
        except ModelFolderError as err:
            gone = str(err)
        check('a folder that is not there is refused, said plainly', 'does not exist' in gone, gone)
        check('a model NAME (small.en) is not a folder and is not checked; a path is',
              not is_model_folder('small.en') and is_model_folder(str(full)) and is_model_folder('models/x'))
        check("the engine's name is the folder's own name, never its full path (paths name people)",
              whisper_engine_name(str(full)) == 'whisper:my-voice' and whisper_engine_name('small.en') == 'whisper:small.en',
              whisper_engine_name(str(full)))
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = cli.main(['--backend', 'whisper', '--model', str(half)])
        check('*** the service will not start on an incomplete folder: exit 2, the missing files named ***',
              code == 2 and 'tokenizer.json' in err.getvalue() and 'vocabulary' in err.getvalue(), (code, err.getvalue()))
        loaded = 'faster_whisper' in sys.modules
        try:
            WhisperBackend(model=str(half))
            refused = False
        except ModelFolderError:
            refused = True
        check('*** WhisperBackend itself refuses too, BEFORE faster-whisper is even imported ***',
              refused and ('faster_whisper' in sys.modules) == loaded)


def my_voice_tests():
    """`--my-voice` (2026-10-03). Mike, on the site's folder text box: "Shouldn't it be a folder picker for the
    voice model? Which folder do I even use?" The site never handed that path to anything - the service needs a
    path at START, on the machine it runs on, and a browser's folder picker gives a handle, never a path. So the
    service has ONE place of its own to look (speech_service/my_voice_model/), and nobody types a path anywhere.
    `--model` still names a folder kept elsewhere. Kept out of git: a person's voice is not project history."""
    from speech_service import __main__ as cli
    # The checks below are about having NO Nimrod folder: a nimrod_folder.txt on this computer must not change them.
    saved_file = cli.NIMROD_FOLDER_FILE
    cli.NIMROD_FOLDER_FILE = str(Path(__file__).resolve().parent / 'no-such-nimrod_folder.txt')
    try:
        _my_voice_checks()
    finally:
        cli.NIMROD_FOLDER_FILE = saved_file


def _my_voice_checks():
    import contextlib
    import io
    import subprocess
    import tempfile
    from speech_service import __main__ as cli
    from speech_service.backends import MY_VOICE_DIR, MY_VOICE_PORT

    here = Path(__file__).resolve().parent
    check('*** the folder it looks in is speech_service/my_voice_model, beside this file ***',
          Path(MY_VOICE_DIR) == here / 'my_voice_model', MY_VOICE_DIR)
    check('its own port, beside the shared 8797', MY_VOICE_PORT == 8796)
    a = cli.parse(['--my-voice'])
    check('*** --my-voice alone: that folder, port 8796, whisper ***',
          cli.model_and_port(a) == (MY_VOICE_DIR, 8796) and a.backend == 'whisper', cli.model_and_port(a))
    check('--my-voice --port 9001: the port given wins', cli.model_and_port(cli.parse(['--my-voice', '--port', '9001']))[1] == 9001)
    check('--my-voice --model <folder>: a model kept elsewhere, still on 8796',
          cli.model_and_port(cli.parse(['--my-voice', '--model', 'D:/voice/ct2'])) == ('D:/voice/ct2', 8796))
    check('*** without --my-voice nothing changed: small.en on 8797 (the shared service) ***',
          cli.model_and_port(cli.parse([])) == ('small.en', 8797))
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        code = cli.main(['--my-voice', '--backend', 'vosk'])
    check('--my-voice is a Whisper model: with another backend it refuses, said plainly',
          code == 2 and 'whisper' in err.getvalue(), (code, err.getvalue()))

    # A folder that is not there: exit 2, and the message says WHERE to put it and what goes in it.
    with tempfile.TemporaryDirectory() as d:
        gone = str(Path(d) / 'my_voice_model')
        err = io.StringIO()
        saved = cli.MY_VOICE_DIR
        cli.MY_VOICE_DIR = gone
        try:
            with contextlib.redirect_stderr(err):
                code = cli.main(['--my-voice'])
        finally:
            cli.MY_VOICE_DIR = saved
        msg = err.getvalue()
        check('*** no folder yet: exit 2, naming the exact folder to put it in, the files, and --model ***',
              code == 2 and gone in msg and 'model.bin' in msg and 'tokenizer.json' in msg and '--model' in msg, (code, msg))
        Path(gone).mkdir()
        (Path(gone) / 'model.bin').write_bytes(b'')
        err = io.StringIO()
        cli.MY_VOICE_DIR = gone
        try:
            with contextlib.redirect_stderr(err):
                code = cli.main(['--my-voice'])
        finally:
            cli.MY_VOICE_DIR = saved
        check('*** a folder with files missing: exit 2, every missing file named (the same check as --model) ***',
              code == 2 and 'config.json' in err.getvalue() and 'tokenizer.json' in err.getvalue(), (code, err.getvalue()))

    # *** KEPT OUT OF GIT. *** Asked of git itself, so a rule that stops matching fails here.
    repo = here.parent.parent
    for probe_file in ('web/speech_service/nimrod_folder.txt',):
        try:
            r = subprocess.run(['git', 'check-ignore', '-q', probe_file], cwd=repo, capture_output=True, timeout=20)
            check('*** git ignores speech_service/nimrod_folder.txt (it names a folder on somebody\'s computer) ***',
                  r.returncode == 0, r.returncode)
        except (OSError, subprocess.SubprocessError):
            text = (repo / '.gitignore').read_text(encoding='utf-8', errors='replace')
            check('*** .gitignore names speech_service/nimrod_folder.txt ***', probe_file in text)
    probe = 'web/speech_service/my_voice_model/model.bin'
    try:
        r = subprocess.run(['git', 'check-ignore', '-q', probe], cwd=repo, capture_output=True, timeout=20)
        check('*** git ignores everything in speech_service/my_voice_model/ ***', r.returncode == 0, r.returncode)
        r2 = subprocess.run(['git', 'check-ignore', '-q', 'web/speech_service/backends.py'], cwd=repo, capture_output=True, timeout=20)
        check('...and the rule is narrow: the service\'s own files are not ignored', r2.returncode == 1, r2.returncode)
    except (OSError, subprocess.SubprocessError):
        text = (repo / '.gitignore').read_text(encoding='utf-8', errors='replace')
        check('*** .gitignore names speech_service/my_voice_model/ (no git here to ask) ***',
              'web/speech_service/my_voice_model/' in text)


def root_tests():
    """`--root` (2026-10-04). Mike: "giving them an empty folder tree ... they can set the root once in the site
    and everything else could autopopulate the folder location." The site now sets up a Nimrod folder with a
    "Voice model" subfolder; the service follows it: --my-voice loads "<root>/Voice model", falling back to
    speech_service/my_voice_model as before; --model still wins. The root comes from --root, or from the first
    line of speech_service/nimrod_folder.txt."""
    import contextlib
    import io
    import re
    import tempfile
    from speech_service import __main__ as cli
    from speech_service.backends import VOICE_MODEL_SUBFOLDER

    here = Path(__file__).resolve().parent
    # *** ONE NAME, TWO LANGUAGES. *** The site makes the folder; the service looks in it. Read from the site's file.
    js = (here.parent / 'client' / 'user_folders.js').read_text(encoding='utf-8')
    m = re.search(r"\bvoice:\s*'([^']+)'", js)
    check('*** the service\'s "Voice model" folder name is the one the site makes (user_folders.js SUBFOLDERS) ***',
          m is not None and m.group(1) == VOICE_MODEL_SUBFOLDER == 'Voice model', m and m.group(1))
    check('--root is read', cli.parse(['--root', 'D:/Nimrod']).root == 'D:/Nimrod' and cli.parse([]).root is None)

    saved_file, saved_dir = cli.NIMROD_FOLDER_FILE, cli.MY_VOICE_DIR

    def run(argv):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = cli.main(argv)
        return code, err.getvalue()

    with tempfile.TemporaryDirectory() as d:
        D = Path(d)
        root = D / 'My Nimrod'
        voice = root / VOICE_MODEL_SUBFOLDER
        voice.mkdir(parents=True)
        (voice / 'README.txt').write_text('Put the converted voice model here.', encoding='utf-8')
        old = D / 'my_voice_model'
        cli.NIMROD_FOLDER_FILE = str(D / 'nimrod_folder.txt')        # not there yet
        cli.MY_VOICE_DIR = str(old)                                  # not there yet
        try:
            # 1. The site's tree with nothing in "Voice model" yet, and no old folder either.
            code, msg = run(['--my-voice', '--root', str(root)])
            check('*** root set, "Voice model" holds only the site\'s README, no old folder: exit 2, naming <root>/Voice model ***',
                  code == 2 and str(voice) in msg and 'no model' in msg and 'model.bin' in msg and '--model' in msg, (code, msg))
            # 2. ...with the old folder there: it falls back to it, and says why.
            old.mkdir()
            a = cli.parse(['--my-voice', '--root', str(root)])
            folder, how, note = cli.my_voice_folder(a)
            check('*** nothing in <root>/Voice model yet: it falls back to speech_service/my_voice_model, and says so ***',
                  folder == str(old) and how == 'fallback' and str(voice) in note, (folder, how, note))
            # 3. A model in <root>/Voice model: that is the one, before the old folder.
            (voice / 'model.bin').write_bytes(b'')
            check('*** a model in <root>/Voice model: --my-voice loads it, on 8796 ***',
                  cli.model_and_port(a) == (str(voice), 8796) and cli.my_voice_folder(a)[1] == 'root', cli.model_and_port(a))
            code, msg = run(['--my-voice', '--root', str(root)])
            check('*** ...checked at start like any model folder: every missing file named, under <root>/Voice model ***',
                  code == 2 and str(voice) in msg and 'tokenizer.json' in msg and 'config.json' in msg, (code, msg))
            # 4. --model is still the override.
            check('*** --model still wins over --root ***',
                  cli.model_and_port(cli.parse(['--my-voice', '--root', str(root), '--model', 'D:/elsewhere'])) == ('D:/elsewhere', 8796))
            # 5. Without --my-voice, --root changes nothing.
            check('without --my-voice, --root changes nothing (small.en on 8797)',
                  cli.model_and_port(cli.parse(['--root', str(root)])) == ('small.en', 8797))
            # 6. The file: its first real line, quotes taken off, comments and blanks skipped.
            Path(cli.NIMROD_FOLDER_FILE).write_text(f'# my Nimrod folder\n\n"{root}"\n', encoding='utf-8')
            check('*** nimrod_folder.txt: the first line that is not a comment, quotes taken off ***',
                  cli.read_root_file(cli.NIMROD_FOLDER_FILE) == str(root), cli.read_root_file(cli.NIMROD_FOLDER_FILE))
            check('*** no --root: the file names the Nimrod folder, and --my-voice loads its Voice model ***',
                  cli.model_and_port(cli.parse(['--my-voice'])) == (str(voice), 8796), cli.model_and_port(cli.parse(['--my-voice'])))
            other = D / 'Other'
            (other / VOICE_MODEL_SUBFOLDER).mkdir(parents=True)
            (other / VOICE_MODEL_SUBFOLDER / 'model.bin').write_bytes(b'')
            check('--root beats the file', cli.model_and_port(cli.parse(['--my-voice', '--root', str(other)]))[0] == str(other / VOICE_MODEL_SUBFOLDER))
            Path(cli.NIMROD_FOLDER_FILE).write_text('# nothing yet\n\n', encoding='utf-8')
            check('a file with only comments names nothing', cli.read_root_file(cli.NIMROD_FOLDER_FILE) is None)
            check('no file names nothing', cli.read_root_file(str(D / 'nope.txt')) is None)
            # 7. A root that does not exist (a typo, an unplugged drive): the old folder if there, said plainly.
            folder, how, note = cli.my_voice_folder(cli.parse(['--my-voice', '--root', str(D / 'Typo')]))
            check('*** a Nimrod folder that does not exist: falls back to the old folder, and says the folder is missing ***',
                  how == 'fallback' and 'does not exist' in note, (folder, how, note))
            # 8. A training checkpoint left in Voice model is USED (and refused with names), never skipped silently.
            (voice / 'model.bin').unlink()
            (voice / 'model.safetensors').write_bytes(b'')
            code, msg = run(['--my-voice', '--root', str(root)])
            check('*** a checkpoint (not converted) in <root>/Voice model: refused, saying what is missing and how to convert ***',
                  code == 2 and str(voice) in msg and 'model.bin' in msg and 'ct2-transformers-converter' in msg, (code, msg))
        finally:
            cli.NIMROD_FOLDER_FILE, cli.MY_VOICE_DIR = saved_file, saved_dir


if __name__ == '__main__':
    if '--live' in sys.argv:
        # --live <ws url> <wav folder> [--grammar "a,b,c"]: no tests, just a running service measured.
        i = sys.argv.index('--live')
        g = sys.argv[sys.argv.index('--grammar') + 1].split(',') if '--grammar' in sys.argv else None
        sec = sys.argv[sys.argv.index('--secret') + 1] if '--secret' in sys.argv else None
        live(sys.argv[i + 1], sys.argv[i + 2], grammar=g, secret=sec)
        sys.exit(0)
    asyncio.run(session_tests())
    asyncio.run(wake_tests())
    wake_model_tests()
    model_folder_tests()
    my_voice_tests()
    root_tests()
    fastapi_tests()
    websockets_tests()
    print(f'\n{"ALL PASS" if not failed else "FAILED"} - {passed} passed, {failed} failed')
    if '--real-whisper' in sys.argv:
        real_whisper(sys.argv[sys.argv.index('--real-whisper') + 1])
    sys.exit(1 if failed else 0)
