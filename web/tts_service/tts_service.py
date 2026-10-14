#!/usr/bin/env python3
"""tts_service.py - A VOICE FOR THE SCREEN: text to speech on this computer, for the page's local_voice.js.

Mike, 2026-10-14 (DECISIONS.md): "Yes to Piper on the bench (the program and an LJSpeech voice), to give the Pi a
voice." On a Raspberry Pi, Chromium's speechSynthesis speaks only through speech-dispatcher, and the bench has none,
so `say` there is silent. This is the program local_voice.js was written against (its header has the seam):

    GET  /health  -> {"ok": true, "engine": "piper:en_US-ljspeech-medium", "voices": [ids], "protocol": 1}
    POST /speak   {"text": "...", "voice"?: id, "rate"?: 0.5-2.0}  -> audio/wav

Standard library only, plus Piper (https://github.com/OHF-Voice/piper1-gpl, `pip install piper-tts`, GPL-3.0-or-later)
for the real voice. Piper is imported only when a real model is loaded, so this file and its suite run anywhere.
THE VOICE, argued: en_US-ljspeech-medium. Its training data (LJ Speech) is public domain. NOT the common "lessac"
voices: their data is licensed for research only, no commercial use. There is no "low" LJSpeech voice (checked
2026-10-14: only medium and high are published).

*** THE GUARDS - the speech program's rules (speech_service/service.py), for plain HTTP: ***
  * It listens on THIS COMPUTER ONLY (127.0.0.1, ::1 or localhost) and refuses to start on any other address. Nothing
    on the house's network can make the screen talk. There is no option to change that, on purpose: a screen that
    anybody in the building can make speak is a different feature, with its own question.
  * Host must name this computer (any port). That stops "DNS rebinding": a site pointing its own name at 127.0.0.1 so
    its page counts as same-site and sends no Origin.
  * Origin: a page from a site on the list (default https://nimrodecosystem.com; --allow-origin adds more, e.g.
    https://nimrod.onrender.com) or a page on this computer itself (http://127.0.0.1 / localhost / [::1], any port:
    the dev server). No Origin at all is a program on this computer, which could send any Origin it likes, so it is
    allowed, as the speech program does. The literal Origin "null" (a sandboxed frame, a file) is refused. A refused
    page gets 403 and no CORS headers, so its script cannot read anything.
  * Sizes: a request body of at most 8 KB, text of at most 1000 characters (local_voice.js MAX_TEXT), one sentence at a
    time synthesised (a lock), and at most 4 waiting behind it: one more gets 503 and the page uses the browser's
    voice.
  * NOTHING SAID IS LOGGED. The log has lengths and timings, never the words: what the screen says is a person's.

Run:
    python3 tts_service.py --model ~/piper-bench/voices/en_US-ljspeech-medium.onnx
    python3 tts_service.py --fake                (a silent stand-in voice: for trying the page without Piper)
Its suite: py -3.13 tts_service/test_tts_service.py   (from web/; a fake voice, nothing downloaded)
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROTOCOL = 1
DEFAULT_PORT = 8794          # local_voice.js DEFAULT_LOCAL_VOICE_URL (8790 the helper, 8796 my-voice, 8797 speech)
DEFAULT_SITES = ('https://nimrodecosystem.com',)
MAX_BODY = 8 * 1024          # bytes: 1000 characters of text, a voice name and a rate, with room
MAX_TEXT = 1000              # characters (local_voice.js MAX_TEXT)
MAX_WAITING = 4              # requests queued behind the one being spoken; more get 503
RATE_MIN, RATE_MAX = 0.5, 2.0
LOOPBACK_ADDRS = ('127.0.0.1', '::1', 'localhost')
LOCAL_ORIGIN = re.compile(r'^http://(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$', re.IGNORECASE)
LOCAL_HOST = re.compile(r'^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$', re.IGNORECASE)
VOICE_ID = re.compile(r'^[A-Za-z0-9_.\-]{1,80}$')


# ---------------------------------------------------------------------------------------------------------------------
# who may ask
# ---------------------------------------------------------------------------------------------------------------------
def site_list(values) -> tuple:
    """--allow-origin values (each may be comma-separated). None or [] (not given): DEFAULT_SITES."""
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
    if origin is None or origin == '':
        return True
    o = str(origin).strip().rstrip('/')
    if LOCAL_ORIGIN.match(o):
        return True
    return o in {str(s).rstrip('/') for s in (sites or ()) if s}


def refusal(origin, host, sites=DEFAULT_SITES) -> str:
    """'' when the request may go on, else why not (said in the 403 and the log; never anything said aloud)."""
    if not origin_allowed(origin, sites):
        return f'origin {str(origin)[:200]} is not allowed'
    if host and not LOCAL_HOST.match(str(host).strip()):
        return f'host {str(host)[:200]} is not this computer'
    return ''


def is_loopback(host: str) -> bool:
    return str(host or '').strip().strip('[]').lower() in LOOPBACK_ADDRS


def read_request(raw: bytes) -> tuple:
    """A /speak body -> ({text, voice, rate}, '') or (None, why). Pure."""
    try:
        body = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, ValueError):
        return None, 'the body is not JSON'
    if not isinstance(body, dict):
        return None, 'the body is not a JSON object'
    text = body.get('text')
    if not isinstance(text, str):
        return None, 'no text'
    text = re.sub(r'\s+', ' ', text).strip()
    if not text:
        return None, 'no text'
    if len(text) > MAX_TEXT:
        return None, f'text longer than {MAX_TEXT} characters'
    voice = body.get('voice') or ''
    if voice and (not isinstance(voice, str) or not VOICE_ID.match(voice)):
        return None, 'a voice name is letters, digits, dot, dash and underscore'
    rate = body.get('rate')
    if rate is not None:
        try:
            rate = float(rate)
        except (TypeError, ValueError):
            return None, 'rate is a number'
        if not (rate == rate) or rate <= 0:      # NaN or not positive
            return None, 'rate is a positive number'
        rate = max(RATE_MIN, min(RATE_MAX, rate))
    return {'text': text, 'voice': voice, 'rate': rate}, ''


# ---------------------------------------------------------------------------------------------------------------------
# the voices
# ---------------------------------------------------------------------------------------------------------------------
class FakeEngine:
    """A stand-in voice: silence, 22050 Hz mono, 50 ms per character (capped at 5 s). For the suite and for trying the
    page without Piper. `delay` (seconds) imitates a slow computer."""

    def __init__(self, voices=('fake',), delay: float = 0.0):
        self.voices = list(voices)
        self.delay = float(delay)
        self.calls = []

    @property
    def name(self) -> str:
        return f'fake:{self.voices[0]}'

    def synthesize(self, text: str, voice: str = '', rate=None) -> bytes:
        self.calls.append({'chars': len(text), 'voice': voice or self.voices[0], 'rate': rate})
        if self.delay:
            time.sleep(self.delay)
        frames = int(22050 * min(5.0, 0.05 * len(text)) / (rate or 1.0))
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(22050)
            w.writeframes(b'\x00\x00' * max(1, frames))
        return buf.getvalue()


class PiperEngine:
    """Piper voices, by model file. The voice id is the file's name without .onnx ("en_US-ljspeech-medium"); the first
    is the default. Each is loaded at start (about 11 s on the bench Pi 400), not on the first sentence."""

    def __init__(self, models):
        from piper import PiperVoice, SynthesisConfig   # imported here: the suite runs without Piper
        self._config = SynthesisConfig
        self._voices = {}
        for m in models:
            p = Path(m).expanduser()
            if not p.is_file():
                raise FileNotFoundError(f'no voice model at {p}')
            self._voices[p.name[:-5] if p.name.endswith('.onnx') else p.stem] = PiperVoice.load(str(p))
        if not self._voices:
            raise ValueError('no voice models given')
        self.voices = list(self._voices)

    @property
    def name(self) -> str:
        return f'piper:{self.voices[0]}'

    def synthesize(self, text: str, voice: str = '', rate=None) -> bytes:
        v = self._voices[voice or self.voices[0]]
        # Piper's speed is `length_scale`: how long each sound lasts, so faster speech is a smaller number.
        cfg = self._config(length_scale=(1.0 / rate) if rate else None)
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as w:
            v.synthesize_wav(text, w, syn_config=cfg)
        return buf.getvalue()


# ---------------------------------------------------------------------------------------------------------------------
# the program
# ---------------------------------------------------------------------------------------------------------------------
class Speaker:
    """One sentence at a time (the computer has one processor to share with the screen), and a short queue."""

    def __init__(self, engine, max_waiting: int = MAX_WAITING):
        self.engine = engine
        self.max_waiting = max_waiting
        self._lock = threading.Lock()
        self._count = threading.Lock()
        self._waiting = 0

    def speak(self, text: str, voice: str = '', rate=None):
        """-> (wav bytes, '') or (None, why). 'busy' when too many are already waiting."""
        if voice and voice not in self.engine.voices:
            return None, f'no voice called {voice}'
        with self._count:
            if self._waiting > self.max_waiting:      # one being spoken + max_waiting behind it
                return None, 'busy'
            self._waiting += 1
        try:
            with self._lock:
                return self.engine.synthesize(text, voice, rate), ''
        finally:
            with self._count:
                self._waiting -= 1


def note(msg: str) -> None:
    print(f'tts_service: {msg}', file=sys.stderr, flush=True)


def make_handler(speaker: Speaker, sites=DEFAULT_SITES, quiet: bool = False):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'nimrod-tts'
        sys_version = ''
        protocol_version = 'HTTP/1.1'
        timeout = 15                       # a client that opens a socket and says nothing is dropped

        def log_message(self, fmt, *args):  # the default prints the request line; never anything said
            if not quiet:
                note(f'{self.command} {self.path.split("?")[0][:40]} ' + (fmt % args)[-24:])

        def _origin(self):
            return self.headers.get('Origin')

        def _guard(self) -> bool:
            why = refusal(self._origin(), self.headers.get('Host'), sites)
            if why:
                note(f'refused: {why}')
                self._json(403, {'ok': False, 'error': why}, cors=False)
                return False
            return True

        def _cors(self):
            o = self._origin()
            if o:
                self.send_header('Access-Control-Allow-Origin', o)
                self.send_header('Vary', 'Origin')
                if self.headers.get('Access-Control-Request-Private-Network') == 'true':
                    self.send_header('Access-Control-Allow-Private-Network', 'true')

        def _send(self, code: int, body: bytes, ctype: str, cors: bool = True):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if cors:
                self._cors()
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def _json(self, code: int, obj, cors: bool = True):
            self._send(code, json.dumps(obj).encode('utf-8'), 'application/json', cors)

        def do_OPTIONS(self):
            if not self._guard():
                return
            self.send_response(204)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Max-Age', '600')
            self.send_header('Content-Length', '0')
            self._cors()
            self.end_headers()

        def do_GET(self):
            if not self._guard():
                return
            if self.path.split('?')[0] != '/health':
                self._json(404, {'ok': False, 'error': 'not found'})
                return
            self._json(200, {'ok': True, 'engine': speaker.engine.name, 'voices': list(speaker.engine.voices),
                             'protocol': PROTOCOL, 'maxText': MAX_TEXT})

        def do_POST(self):
            if not self._guard():
                return
            if self.path.split('?')[0] != '/speak':
                self._json(404, {'ok': False, 'error': 'not found'})
                return
            ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            if ctype != 'application/json':
                self._json(415, {'ok': False, 'error': 'send JSON (Content-Type: application/json)'})
                return
            try:
                n = int(self.headers.get('Content-Length') or '-1')
            except ValueError:
                n = -1
            if n < 0:
                self._json(411, {'ok': False, 'error': 'a length is needed'})
                return
            if n > MAX_BODY:
                self.close_connection = True       # the body is not read, so this connection cannot be reused
                self._json(413, {'ok': False, 'error': f'at most {MAX_BODY} bytes'})
                return
            req, why = read_request(self.rfile.read(n))
            if req is None:
                self._json(400, {'ok': False, 'error': why})
                return
            t0 = time.perf_counter()
            try:
                wav, why = speaker.speak(req['text'], req['voice'], req['rate'])
            except Exception as err:            # a broken model must not take the program down
                note(f'synthesis failed: {type(err).__name__}')
                self._json(500, {'ok': False, 'error': 'the voice could not say that'})
                return
            if wav is None:
                self._json(503 if why == 'busy' else 400, {'ok': False, 'error': why})
                return
            note(f'said {len(req["text"])} characters in {time.perf_counter() - t0:.2f} s')
            self._send(200, wav, 'audio/wav')

        def do_PUT(self):
            self._json(405, {'ok': False, 'error': 'GET /health or POST /speak'})

        do_DELETE = do_PATCH = do_PUT

    return Handler


def create_server(engine, host: str = '127.0.0.1', port: int = DEFAULT_PORT, sites=DEFAULT_SITES, quiet: bool = False):
    """The server, bound and ready (serve_forever() to run it). Refuses any address that is not this computer."""
    if not is_loopback(host):
        raise ValueError(f'{host} is not this computer: the voice program listens on 127.0.0.1 or ::1 only')

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True
        address_family = __import__('socket').AF_INET6 if ':' in host else __import__('socket').AF_INET

    return Server((host.strip('[]'), int(port)), make_handler(Speaker(engine), sites, quiet))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='A voice for the screen: text to speech on this computer (local_voice.js).')
    ap.add_argument('--model', action='append', default=[], help='a Piper voice (.onnx; its .onnx.json beside it). '
                    'Repeat for more voices; the first is the default.')
    ap.add_argument('--fake', action='store_true', help='a silent stand-in voice, no Piper needed')
    ap.add_argument('--host', default='127.0.0.1', help='127.0.0.1 (default) or ::1; nothing else is accepted')
    ap.add_argument('--port', type=int, default=DEFAULT_PORT)
    ap.add_argument('--allow-origin', action='append', default=None,
                    help=f'a website allowed to use the voice (default {", ".join(DEFAULT_SITES)}); repeatable')
    ap.add_argument('--quiet', action='store_true', help='no line per request')
    a = ap.parse_args(argv)
    if not is_loopback(a.host):
        note(f'refusing to listen on {a.host}: this computer only (127.0.0.1 or ::1)')
        return 2
    if a.fake:
        engine = FakeEngine()
    elif a.model:
        t0 = time.perf_counter()
        engine = PiperEngine(a.model)
        note(f'loaded {", ".join(engine.voices)} in {time.perf_counter() - t0:.1f} s')
    else:
        ap.error('give --model <voice.onnx> (or --fake)')
        return 2
    sites = site_list(a.allow_origin)
    srv = create_server(engine, a.host, a.port, sites, a.quiet)
    note(f'listening on http://{a.host}:{a.port} for {", ".join(sites) or "pages on this computer only"} ({engine.name})')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
