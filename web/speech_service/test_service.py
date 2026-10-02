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
    fastapi_tests()
    websockets_tests()
    print(f'\n{"ALL PASS" if not failed else "FAILED"} - {passed} passed, {failed} failed')
    if '--real-whisper' in sys.argv:
        real_whisper(sys.argv[sys.argv.index('--real-whisper') + 1])
    sys.exit(1 if failed else 0)
