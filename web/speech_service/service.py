"""service.py - THE PROTOCOL, and the two thin servers that speak it (rows 2.46, 2.47).

*** WHAT THIS CARRIES: A ROOM'S SOUND. *** Whatever connects sends the microphone audio of the room
the screen is in. By default this binds 127.0.0.1, so the sound never leaves the machine it was
heard on. Binding any other address (a Tailscale address, so a screen can send to a desktop or a
GPU box) is an explicit flag in `__main__.py`, needs a shared secret, and is an OPTION the person
whose room it is has to choose on the screen (Mike, 2026-09-30: her audio to his desktop "is fine
for an option"; Oscar's computer when its GPU is free is another option; both OFF by default).
Only pages from the person's Nimrod (and pages on this computer) may connect: "WHICH WEB PAGES", below.

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
    {"type":"wake", "on":bool}                         start/stop the WAKE STREAM (a service started
                                                       with --wake). While on, EVERY binary frame -
                                                       inside an utterance or not - is also scored by
                                                       the wake detector. Not stored: the detector
                                                       holds its last ~10 s of features in memory.

  service -> client
    {"kind":"hello", "engine", "grammar":bool, "partials":bool, "protocol":1, "wake":[words]}
    {"kind":"partial", "utteranceId", "text", "engine"}                (backends that have them)
    {"kind":"final", "utteranceId", "text", "confidence":0..1|null,
       "words":[{"w","conf"}], "engine", "ms":decode ms, "audioMs", "cut":bool}
    {"kind":"wake", "word", "score":0..1, "atMs":where in the stream, "ms":compute ms,
       "detector", "utteranceId"?:the one open on this socket}           (once per crossing)
    {"kind":"error", "error":str, "utteranceId"?}

A WAKE-ONLY SERVICE (`--backend none --wake hey_jarvis`) answers hello with engine 'none' and
refuses `begin`; a screen streams to it for wake events and sends its utterances elsewhere. The
two can also share one process (`--backend vosk --wake ...`), each on its own socket.

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
import re
import sys
import time

PROTOCOL = 1
SAMPLE_RATE = 16000
# The longest one utterance may be before later audio is dropped (and `cut` says so). 30 s: Whisper
# reads a fixed 30 s window, so audio past it would be ignored anyway, and a stuck "begin" with no
# "end" must not grow memory forever. A flag (`--max-utterance-s`).
MAX_UTTERANCE_S = 30.0
CLOSE_UNAUTHORISED = 4401
CLOSE_PROTOCOL = 4400


# ---------------------------------------------------------------------------------------------
# WHICH WEB PAGES MAY USE THIS SERVICE (found 2026-10-07: it accepted any page from any site).
#
# A browser lets a page on ANY site open a WebSocket to 127.0.0.1 - there is no CORS check on a
# WebSocket. Without this, a page somebody merely visits could connect, send audio and read back
# what was said, or stream the room's sound through the wake detector. So the service checks the
# page's Origin itself, and refuses every other site with 403 before the socket opens.
#
# *** THE SECURITY INVARIANT: a page from a site that is not on the list never gets a socket. ***
#
# Allowed, the same as the helper's status page (nimrod_helper/supervisor.py allowed_origin):
#   * the person's Nimrod and the other addresses it is served at (DEFAULT_SITES, or --allow-origin),
#   * any page on this computer itself (http://127.0.0.1, localhost, [::1], any port: the dev server).
# No Origin header at all: ALLOWED, as the status page serves a request with none. A browser always
# sends Origin when it opens a WebSocket, so a request without one is a program, not a web page - and a
# program on this computer can send whatever Origin it likes, so refusing it would guard nothing. When
# the service listens beyond this computer, the shared secret is what stops a program elsewhere.
# The literal Origin "null" (a sandboxed frame, a page opened from a file) is refused: it names no site.
#
# HOST, while the service listens only on this computer: the Host header must name this computer too.
# That stops "DNS rebinding" (a site that points its own name at 127.0.0.1 so its page counts as
# same-site and sends no Origin). When the service listens on another address (a Tailscale address, by
# choice and with a secret), the name a screen uses for it cannot be known here, so Host is not checked.
# ---------------------------------------------------------------------------------------------
# MIRRORS nimrod_helper/settings.py DEFAULTS 'platform' + 'alsoAllow'; test_helper.py fails if they
# drift. Kept here as well because the service also runs on its own (a Pi has no helper).
DEFAULT_SITES = ('https://nimrodecosystem.com', 'https://nimrod.onrender.com')
LOCAL_ORIGIN = re.compile(r'^http://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$')
LOCAL_HOST = re.compile(r'^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$', re.IGNORECASE)


def site_list(values) -> tuple:
    """--allow-origin values (each may be comma-separated) as a clean tuple. None or [] (not given): DEFAULT_SITES.
    Given but empty (`--allow-origin ""`): no sites at all, only pages on this computer."""
    if not values:
        return DEFAULT_SITES
    out = []
    for v in values:
        for s in str(v).split(','):
            s = s.strip().rstrip('/')
            if s and s not in out:
                out.append(s)
    return tuple(out)


def origin_allowed(origin, sites=DEFAULT_SITES) -> bool:
    """May a page from `origin` use the service? None or '' (no header: not a web page) may."""
    if origin is None or origin == '':
        return True
    o = str(origin).rstrip('/')
    if LOCAL_ORIGIN.match(o):
        return True
    return o in {str(s).rstrip('/') for s in (sites or ()) if s}


def host_refusal(host) -> str:
    """'' when a Host header names this computer (or there is none), else why not. For a server that listens
    only on this computer; the helper's status page uses it too (nimrod_helper/supervisor.py)."""
    if host and not LOCAL_HOST.match(str(host).strip()):
        return f'host {str(host)[:200]} is not this computer'
    return ''


def refusal(origin, host, sites=DEFAULT_SITES, loopback: bool = True) -> str:
    """'' when the request may go on, else why not (said in the 403 and the log, never anything heard)."""
    if not origin_allowed(origin, sites):
        return f'origin {str(origin)[:200]} is not allowed'
    return host_refusal(host) if loopback else ''


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
                 max_utterance_s: float = MAX_UTTERANCE_S, wake=None):
        self.b = backend
        self.wake = wake              # a detector (backends.make_wake) or None
        self.wake_stream = None       # this socket's stream, while the screen asked for one
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
            await self.send({'kind': 'hello', 'engine': self.b.name if self.b is not None else 'none',
                             'protocol': PROTOCOL,
                             'grammar': bool(getattr(self.b, 'supports_grammar', False)),
                             'partials': bool(getattr(self.b, 'partials', False)),
                             'wake': list(getattr(self.wake, 'words', None) or [])})
            return
        if t == 'wake':
            if msg.get('on') is False:
                self.wake_stream = None
            elif self.wake is None:
                await self.send({'kind': 'error', 'error': 'no wake detector on this service'})
            elif self.wake_stream is None:
                try:
                    self.wake_stream = self.wake.stream()
                except Exception as err:  # noqa: BLE001
                    await self.send({'kind': 'error', 'error': f'wake: {err}'})
            return
        if t == 'begin' and self.b is None:
            await self.send({'kind': 'error', 'error': 'this service only detects wake words',
                             'utteranceId': str(msg.get('utteranceId') or '')})
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
        if self.wake_stream is not None and data:
            await self._wake_feed(data)
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

    async def _wake_feed(self, data: bytes):
        # ON THE LOOP, not a thread: one 80 ms step is a few ms (bench: see the report), the order of
        # frames matters, and a thread hop per 20 ms frame would cost more than the step itself.
        t0 = time.perf_counter()
        try:
            hits = self.wake_stream.feed(data)
        except Exception as err:  # noqa: BLE001
            self.wake_stream = None
            await self.send({'kind': 'error', 'error': f'wake: {err}'})
            return
        if not hits:
            return
        ms = round((time.perf_counter() - t0) * 1000, 1)
        for h in hits:
            ev = {'kind': 'wake', 'word': h['word'], 'score': h['score'], 'atMs': h['atMs'], 'ms': ms,
                  'detector': getattr(self.wake, 'name', 'wake')}
            if self.cur:
                ev['utteranceId'] = self.cur['id']
            await self.send(ev)

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
_last_refusal = [0.0]


# ONE COPY PER PORT (2026-10-07, the same fix as media_agent/agent.py "one copy per port"). uvicorn turns on
# SO_REUSEADDR, and on Windows that lets a second program bind a port another is already listening on: a copy
# started by hand beside the helper's both "start", and a page's socket goes to either one. So the service
# makes its own socket and hands it to the server:
#   * Windows: SO_EXCLUSIVEADDRUSE (Windows' own answer), so the second bind fails.
#   * Elsewhere: SO_REUSEADDR, as uvicorn and asyncio set it there. It never lets two programs LISTEN on one
#     port, and it lets a service that was just restarted bind again straight away.
# It only BINDS here; the server starts listening once the model has loaded. Bound is enough to hold the port
# (on Windows), and the helper reads "something answers on the port" as "running", so listening before the
# model is ready would tell its status page the speech program is running while it is still loading.
# Elsewhere two copies started in the same second can both bind; the second then fails when it starts to listen.
def listen_socket(host: str, port: int):
    """A TCP socket bound to host:port, for the server to listen on. Raises OSError when the port is taken."""
    import socket
    sock = socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET, socket.SOCK_STREAM)
    try:
        if sys.platform == 'win32' and hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, int(port)))
    except OSError:
        sock.close()
        raise
    return sock


def note_refusal(why: str, every_s: float = 10.0) -> None:
    """One line in the log for a refused page, at most one per 10 s: a page that keeps trying must not fill
    the log (the helper moves a log aside only when the part starts again)."""
    now = time.monotonic()
    if now - _last_refusal[0] >= every_s:
        _last_refusal[0] = now
        print(f'speech service: refused a connection (403): {why}', file=sys.stderr, flush=True)


def create_app(backend, secret: str | None = None, max_utterance_s: float = MAX_UTTERANCE_S, wake=None,
               sites=DEFAULT_SITES, loopback: bool = True):
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.responses import JSONResponse, Response

    app = FastAPI(title='speech service', docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def guard(request, call_next):
        # Plain HTTP (/health and its preflight). The same check as the socket below; an allowed page gets
        # the same CORS answer the helper's status page gives (its Origin echoed, the private-network
        # preflight answered), so a page on the person's Nimrod may read /health.
        origin = request.headers.get('origin')
        why = refusal(origin, request.headers.get('host'), sites, loopback)
        if why:
            note_refusal(why)
            return JSONResponse({'ok': False, 'error': why}, status_code=403)
        if request.method == 'OPTIONS':
            resp = Response(status_code=204)
            resp.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
            resp.headers['Access-Control-Max-Age'] = '600'
        else:
            resp = await call_next(request)
        if origin:
            resp.headers['Access-Control-Allow-Origin'] = origin
            resp.headers['Vary'] = 'Origin'
            if request.headers.get('access-control-request-private-network') == 'true':
                resp.headers['Access-Control-Allow-Private-Network'] = 'true'
        return resp

    @app.get('/health')
    def health():
        # Says only that it is up and which engine. Never anything heard.
        return {'ok': True, 'engine': backend.name if backend is not None else 'none', 'protocol': PROTOCOL,
                'secret': bool(secret), 'wake': list(getattr(wake, 'words', None) or [])}

    @app.websocket('/speech')
    async def speech(ws: WebSocket):
        why = refusal(ws.headers.get('origin'), ws.headers.get('host'), sites, loopback)
        if why:
            note_refusal(why)
            # Closed BEFORE it is accepted: the server answers the handshake with HTTP 403, and no socket opens.
            await ws.close(code=1008)
            return
        await ws.accept()
        s = Session(backend, ws.send_json, lambda code: ws.close(code=code), secret=secret,
                    max_utterance_s=max_utterance_s, wake=wake)
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
                           max_utterance_s: float = MAX_UTTERANCE_S, ready=None, wake=None,
                           sites=DEFAULT_SITES, loopback: bool | None = None, sock=None):
    """`sock`: a socket from listen_socket() to serve on (host and port are then only what it was bound to)."""
    from http import HTTPStatus
    from websockets.asyncio.server import serve

    if loopback is None:
        loopback = host in ('127.0.0.1', 'localhost', '::1')

    def guard(connection, request):
        # Before the handshake completes: a page from another site gets HTTP 403 and no socket.
        why = refusal(request.headers.get('Origin'), request.headers.get('Host'), sites, loopback)
        if why:
            note_refusal(why)
            return connection.respond(HTTPStatus.FORBIDDEN, f'{why}\n')
        return None

    async def handler(ws):
        if ws.request is not None and ws.request.path.split('?')[0] != '/speech':
            await ws.close(code=CLOSE_PROTOCOL)
            return

        async def send(msg):
            await ws.send(json.dumps(msg))

        async def close(code):
            await ws.close(code=code)

        s = Session(backend, send, close, secret=secret, max_utterance_s=max_utterance_s, wake=wake)
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

    where = {'sock': sock} if sock is not None else {'host': host, 'port': port}
    async with serve(handler, max_size=2 ** 20, process_request=guard, **where) as server:
        if ready is not None:
            ready.set()
        await server.serve_forever()
