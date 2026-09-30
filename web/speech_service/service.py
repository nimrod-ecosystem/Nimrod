"""service.py - THE PROTOCOL, and the two thin servers that speak it (rows 2.46, 2.47).

*** WHAT THIS CARRIES: A ROOM'S SOUND. *** Whatever connects sends the microphone audio of the room
the screen is in. By default this binds 127.0.0.1, so the sound never leaves the machine it was
heard on. Binding any other address (a Tailscale address, so a screen can send to a desktop or a
GPU box) is an explicit flag in `__main__.py`, needs a shared secret, and is an OPTION the person
whose room it is has to choose on the screen (Mike, 2026-09-30: her audio to his desktop "is fine
for an option"; Oscar's computer when its GPU is free is another option; both OFF by default).

ONE PROTOCOL, over one WebSocket at /speech. Text frames are JSON; binary frames are audio.

  client -> service
    {"type":"hello", "secret"?:str, "rate":16000}      FIRST, always. Wrong or missing secret (when
                                                       the service has one): an error, then close 4401.
    {"type":"mode", "mode":"open"|"grammar", "grammar":[..]|null}
                                                       how to listen from the next utterance on. A
                                                       backend without grammars ignores it (hello says).
    {"type":"begin", "utteranceId":str}                somebody started talking
    <binary>                                           16 kHz mono 16-bit little-endian PCM, for the
                                                       utterance begun last
    {"type":"end", "utteranceId":str}                  they stopped: transcribe it
    {"type":"cancel", "utteranceId":str}               never mind (a click, not speech)

  service -> client
    {"kind":"hello", "engine", "grammar":bool, "partials":bool, "protocol":1}
    {"kind":"partial", "utteranceId", "text", "engine"}                (backends that have them)
    {"kind":"final", "utteranceId", "text", "confidence":0..1|null,
       "words":[{"w","conf"}], "engine", "ms":decode ms, "audioMs", "cut":bool}
    {"kind":"error", "error":str, "utteranceId"?}

THE CLIENT DECIDES WHERE AN UTTERANCE STARTS AND ENDS, not the service. That is what lets one
utterance go to several services (the ranked list) and come back under ONE id from each - a fast
guess from the Pi and a better one from the desktop are then two answers to the same question,
not two unrelated transcripts to be lined up by clock time.
"""
# No `from __future__ import annotations` here: FastAPI reads the handler's `ws: WebSocket`
# annotation at runtime, and WebSocket is imported inside `create_app` (so the Pi, with no FastAPI,
# can still import this file).
import asyncio
import hmac
import json
import time

PROTOCOL = 1
SAMPLE_RATE = 16000
# The longest one utterance may be before later audio is dropped (and `cut` says so). 30 s: Whisper
# reads a fixed 30 s window, so audio past it would be ignored anyway, and a stuck "begin" with no
# "end" must not grow memory forever. A flag (`--max-utterance-s`).
MAX_UTTERANCE_S = 30.0
CLOSE_UNAUTHORISED = 4401
CLOSE_PROTOCOL = 4400


def secrets_match(expected: str | None, given) -> bool:
    if not expected:
        return True
    if not isinstance(given, str):
        return False
    return hmac.compare_digest(expected.encode('utf-8'), given.encode('utf-8'))


class Session:
    """One connected screen. Transport-agnostic: `send(dict)` and `close(code)` are coroutines the
    server hands in, and `on_text` / `on_bytes` are called with what arrives."""

    def __init__(self, backend, send, close, secret: str | None = None,
                 max_utterance_s: float = MAX_UTTERANCE_S):
        self.b = backend
        self._send = send
        self._close = close
        self.secret = secret or None
        self.max_bytes = int(max(0.5, float(max_utterance_s)) * SAMPLE_RATE * 2)
        self.greeted = False
        self.grammar = None
        self.cur = None               # {'id', 'utt', 'bytes', 'cut'}
        self.tasks = set()
        self._last = None
        self.closed = False

    async def send(self, msg: dict):
        if self.closed:
            return
        try:
            await self._send(msg)
        except Exception:  # noqa: BLE001 - a screen that went away is not the service's error
            self.closed = True

    async def fail(self, error: str, code: int, **extra):
        await self.send({'kind': 'error', 'error': error, **extra})
        self.closed = True
        try:
            await self._close(code)
        except Exception:  # noqa: BLE001
            pass

    async def on_text(self, raw: str):
        try:
            msg = json.loads(raw)
        except (TypeError, ValueError):
            await self.send({'kind': 'error', 'error': 'not json'})
            return
        if not isinstance(msg, dict):
            await self.send({'kind': 'error', 'error': 'not an object'})
            return
        t = msg.get('type')
        if not self.greeted:
            if t != 'hello':
                await self.fail('hello first', CLOSE_PROTOCOL)
                return
            if not secrets_match(self.secret, msg.get('secret')):
                await self.fail('secret', CLOSE_UNAUTHORISED)
                return
            rate = msg.get('rate', SAMPLE_RATE)
            if rate != SAMPLE_RATE:
                await self.fail(f'rate must be {SAMPLE_RATE}', CLOSE_PROTOCOL)
                return
            self.greeted = True
            await self.send({'kind': 'hello', 'engine': self.b.name, 'protocol': PROTOCOL,
                             'grammar': bool(getattr(self.b, 'supports_grammar', False)),
                             'partials': bool(getattr(self.b, 'partials', False))})
            return
        if t == 'mode':
            g = msg.get('grammar')
            ok = msg.get('mode') == 'grammar' and isinstance(g, list) and all(isinstance(x, str) for x in g)
            self.grammar = [x for x in g if x] if ok else None
        elif t == 'begin':
            await self._end_current(abandon=True)
            uid = str(msg.get('utteranceId') or '')
            if not uid:
                await self.send({'kind': 'error', 'error': 'begin needs an utteranceId'})
                return
            try:
                utt = self.b.open(self.grammar if getattr(self.b, 'supports_grammar', False) else None)
            except Exception as err:  # noqa: BLE001
                await self.send({'kind': 'error', 'error': f'open: {err}', 'utteranceId': uid})
                return
            self.cur = {'id': uid, 'utt': utt, 'bytes': 0, 'cut': False, 'last_partial': None}
        elif t == 'end':
            uid = str(msg.get('utteranceId') or '')
            if self.cur and self.cur['id'] == uid:
                await self._end_current(abandon=False)
            else:
                await self.send({'kind': 'error', 'error': 'end for an utterance not begun', 'utteranceId': uid})
        elif t == 'cancel':
            uid = str(msg.get('utteranceId') or '')
            if self.cur and self.cur['id'] == uid:
                self.cur = None
        elif t == 'hello':
            pass   # a second hello is harmless
        else:
            await self.send({'kind': 'error', 'error': f'unknown type {t!r}'})

    async def on_bytes(self, data: bytes):
        if not self.greeted:
            await self.fail('hello first', CLOSE_PROTOCOL)
            return
        c = self.cur
        if not c or not data:
            return          # audio between utterances is not anybody's words: dropped, not stored
        if c['cut']:
            return
        room = self.max_bytes - c['bytes']
        if len(data) > room:
            data = data[:max(0, room - (room % 2))]
            c['cut'] = True
        if not data:
            return
        c['bytes'] += len(data)
        try:
            partial = c['utt'].feed(data)
        except Exception as err:  # noqa: BLE001
            await self.send({'kind': 'error', 'error': f'feed: {err}', 'utteranceId': c['id']})
            return
        if partial is not None and partial != c['last_partial']:
            c['last_partial'] = partial
            await self.send({'kind': 'partial', 'utteranceId': c['id'], 'text': partial, 'engine': self.b.name})

    async def _end_current(self, abandon: bool):
        c, self.cur = self.cur, None
        if not c or abandon:
            return
        # IN ORDER: each utterance's decode waits for the one before it, so finals come back in the
        # order things were said (a screen reading them as a conversation depends on it).
        task = asyncio.ensure_future(self._finish(c, self._last))
        self._last = task
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def _finish(self, c, before=None):
        if before is not None:
            try:
                await before
            except Exception:  # noqa: BLE001 - its own error was already sent
                pass
        t0 = time.perf_counter()
        try:
            r = await asyncio.to_thread(c['utt'].finish)
        except Exception as err:  # noqa: BLE001
            await self.send({'kind': 'error', 'error': f'finish: {err}', 'utteranceId': c['id']})
            return
        r = r or {}
        await self.send({
            'kind': 'final', 'utteranceId': c['id'], 'text': str(r.get('text') or ''),
            'confidence': r.get('confidence'), 'words': list(r.get('words') or []),
            'engine': self.b.name, 'ms': round((time.perf_counter() - t0) * 1000),
            'audioMs': round(c['bytes'] / 2 / SAMPLE_RATE * 1000), 'cut': bool(c['cut']),
        })

    async def drain(self):
        if self.tasks:
            await asyncio.gather(*list(self.tasks), return_exceptions=True)


# ---------------------------------------------------------------------------------------------
# THE TWO SERVERS. FastAPI where it is installed (the desktop); plain `websockets` where it is not
# (the bench Pi's Vosk venv has websockets and no FastAPI, and nothing new is installed for this).
# ---------------------------------------------------------------------------------------------
def create_app(backend, secret: str | None = None, max_utterance_s: float = MAX_UTTERANCE_S):
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect

    app = FastAPI(title='speech service', docs_url=None, redoc_url=None, openapi_url=None)

    @app.get('/health')
    def health():
        # Says only that it is up and which engine. Never anything heard.
        return {'ok': True, 'engine': backend.name, 'protocol': PROTOCOL, 'secret': bool(secret)}

    @app.websocket('/speech')
    async def speech(ws: WebSocket):
        await ws.accept()
        s = Session(backend, ws.send_json, lambda code: ws.close(code=code), secret=secret,
                    max_utterance_s=max_utterance_s)
        try:
            while not s.closed:
                m = await ws.receive()
                if m.get('type') == 'websocket.disconnect':
                    break
                if m.get('bytes') is not None:
                    await s.on_bytes(m['bytes'])
                elif m.get('text') is not None:
                    await s.on_text(m['text'])
            await s.drain()
        except WebSocketDisconnect:
            pass

    return app


async def serve_websockets(backend, host: str, port: int, secret: str | None = None,
                           max_utterance_s: float = MAX_UTTERANCE_S, ready=None):
    from websockets.asyncio.server import serve

    async def handler(ws):
        if ws.request is not None and ws.request.path.split('?')[0] != '/speech':
            await ws.close(code=CLOSE_PROTOCOL)
            return

        async def send(msg):
            await ws.send(json.dumps(msg))

        async def close(code):
            await ws.close(code=code)

        s = Session(backend, send, close, secret=secret, max_utterance_s=max_utterance_s)
        try:
            async for m in ws:
                if isinstance(m, (bytes, bytearray)):
                    await s.on_bytes(bytes(m))
                else:
                    await s.on_text(m)
                if s.closed:
                    break
            await s.drain()
        except Exception:  # noqa: BLE001 - the screen hung up
            pass

    async with serve(handler, host, port, max_size=2 ** 20) as server:
        if ready is not None:
            ready.set()
        await server.serve_forever()
