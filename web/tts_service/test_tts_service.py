#!/usr/bin/env python3
"""The voice program (tts_service.py), tested with the fake voice - no Piper, nothing downloaded, nothing played.
The guards are checked as pure functions and again over a real socket on a free loopback port.

Run, from web/:
    py -3.13 tts_service/test_tts_service.py
"""
from __future__ import annotations

import http.client
import io
import json
import sys
import threading
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tts_service as T  # noqa: E402

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


SITE = 'https://nimrodecosystem.com'

# ---- who may ask (pure) ----------------------------------------------------------------------------------------------
check('the site is allowed', T.origin_allowed(SITE))
check('no Origin (a program on this computer) is allowed', T.origin_allowed(None) and T.origin_allowed(''))
check('a page on this computer is allowed, any port', T.origin_allowed('http://127.0.0.1:8948')
      and T.origin_allowed('http://localhost:3000') and T.origin_allowed('http://[::1]:9'))
check('another site is refused', not T.origin_allowed('https://evil.example'))
check('a look-alike is refused', not T.origin_allowed('https://nimrodecosystem.com.evil.example')
      and not T.origin_allowed('http://nimrodecosystem.com') and not T.origin_allowed('http://127.0.0.1.evil.example'))
check('the literal "null" origin is refused', not T.origin_allowed('null'))
check('the render address is not on the default list', not T.origin_allowed('https://nimrod.onrender.com'))
check('--allow-origin adds a site (comma lists too)',
      T.origin_allowed('https://nimrod.onrender.com', T.site_list(['https://nimrodecosystem.com, https://nimrod.onrender.com/'])))
check('no --allow-origin is the default list', T.site_list(None) == T.DEFAULT_SITES == (SITE,))
check('Host naming this computer passes', T.refusal(SITE, '127.0.0.1:8794') == '' and T.refusal(SITE, 'localhost') == ''
      and T.refusal(SITE, '[::1]:8794') == '' and T.refusal(SITE, None) == '')
check('Host naming another computer is refused (DNS rebinding)', 'not this computer' in T.refusal(None, 'evil.example:8794')
      and 'not this computer' in T.refusal(None, '192.168.1.20:8794'))
check('only loopback addresses count as this computer', T.is_loopback('127.0.0.1') and T.is_loopback('::1')
      and T.is_loopback('[::1]') and not T.is_loopback('0.0.0.0') and not T.is_loopback('100.97.79.13') and not T.is_loopback(''))

# ---- reading a request (pure) ----------------------------------------------------------------------------------------
ok, why = T.read_request(b'{"text": "  Hello   there "}')
check('a sentence is read, spaces tidied', ok == {'text': 'Hello there', 'voice': '', 'rate': None} and why == '')
check('not JSON is refused', T.read_request(b'hello')[0] is None)
check('a list is refused', T.read_request(b'["hi"]')[0] is None)
check('no text is refused', T.read_request(b'{"text": "   "}')[0] is None and T.read_request(b'{"voice": "x"}')[0] is None)
check('text that is not a string is refused', T.read_request(b'{"text": 5}')[0] is None)
check('1000 characters are fine, 1001 are not', T.read_request(json.dumps({'text': 'a' * 1000}).encode())[0] is not None
      and T.read_request(json.dumps({'text': 'a' * 1001}).encode())[0] is None)
check('a voice name with a slash is refused (no paths)', T.read_request(b'{"text": "hi", "voice": "../x"}')[0] is None)
check('a rate is kept within 0.5-2', T.read_request(b'{"text": "hi", "rate": 9}')[0]['rate'] == 2.0
      and T.read_request(b'{"text": "hi", "rate": 0.1}')[0]['rate'] == 0.5)
check('a rate that is not a positive number is refused', T.read_request(b'{"text": "hi", "rate": "fast"}')[0] is None
      and T.read_request(b'{"text": "hi", "rate": -1}')[0] is None)
check('bad UTF-8 is refused, not a crash', T.read_request(b'{"text": "\xff"}')[0] is None)

# ---- the queue ---------------------------------------------------------------------------------------------------------
sp = T.Speaker(T.FakeEngine(voices=('a', 'b')))
wav, why = sp.speak('Hello', 'b', 1.5)
check('a named voice is used', wav and why == '' and sp.engine.calls[-1]['voice'] == 'b')
check('an unknown voice says so', sp.speak('Hello', 'zz') == (None, 'no voice called zz'))
gate = threading.Event()


class Slow(T.FakeEngine):
    def synthesize(self, text, voice='', rate=None):
        gate.wait(5)
        return super().synthesize(text, voice, rate)


slow = T.Speaker(Slow(), max_waiting=1)
results = []
threads = [threading.Thread(target=lambda: results.append(slow.speak('hi')[1])) for _ in range(2)]
for t in threads:
    t.start()
for _ in range(200):
    if slow._waiting >= 2:
        break
    threading.Event().wait(0.01)
busy = slow.speak('one too many')
gate.set()
for t in threads:
    t.join(5)
check('one being said + max_waiting queued; one more is told "busy"', busy == (None, 'busy') and results == ['', ''], (busy, results))

# ---- a real server on a free loopback port ------------------------------------------------------------------------------
try:
    T.create_server(T.FakeEngine(), host='0.0.0.0', port=0)
    check('it refuses to listen beyond this computer', False)
except ValueError:
    check('it refuses to listen beyond this computer', True)
check('the command line refuses another address too', T.main(['--fake', '--host', '0.0.0.0']) == 2)

engine = T.FakeEngine(voices=('en_US-ljspeech-medium', 'other'))
srv = T.create_server(engine, '127.0.0.1', 0, quiet=True)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()


def req(method, path, body=None, headers=None, raw=None):
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
    h = {'Host': f'127.0.0.1:{port}', **(headers or {})}
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if data is not None and 'Content-Type' not in h:
        h['Content-Type'] = 'application/json'
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    out = (r.status, {k.lower(): v for k, v in r.getheaders()}, r.read())
    c.close()
    return out


s, h, b = req('GET', '/health', headers={'Origin': SITE})
j = json.loads(b)
check('/health answers the site, with its engine and voices', s == 200 and j['ok'] is True
      and j['engine'] == 'fake:en_US-ljspeech-medium' and j['voices'] == ['en_US-ljspeech-medium', 'other'] and j['protocol'] == 1)
check('...with CORS for exactly that site', h.get('access-control-allow-origin') == SITE and h.get('vary') == 'Origin')
s, h, b = req('GET', '/health')
check('/health with no Origin (a program) answers, with no CORS header', s == 200 and 'access-control-allow-origin' not in h)
s, h, b = req('GET', '/health', headers={'Origin': 'https://evil.example'})
check('another site gets 403 and no CORS header (its script reads nothing)', s == 403 and 'access-control-allow-origin' not in h)
s, h, b = req('POST', '/speak', {'text': 'Hello'}, headers={'Origin': 'https://evil.example'})
check('another site cannot make the screen talk', s == 403 and len(engine.calls) == 0)
s, h, b = req('POST', '/speak', {'text': 'Hello'}, headers={'Origin': SITE, 'Host': 'rebound.example:8794'})
check('a rebinding Host cannot either', s == 403 and len(engine.calls) == 0)
s, h, b = req('OPTIONS', '/speak', headers={'Origin': SITE, 'Access-Control-Request-Method': 'POST',
                                           'Access-Control-Request-Headers': 'content-type',
                                           'Access-Control-Request-Private-Network': 'true'})
check('the preflight allows POST with a JSON body, and the private-network question', s == 204
      and 'POST' in h.get('access-control-allow-methods', '') and h.get('access-control-allow-headers') == 'Content-Type'
      and h.get('access-control-allow-private-network') == 'true' and h.get('access-control-allow-origin') == SITE)
s, h, b = req('OPTIONS', '/speak', headers={'Origin': 'https://evil.example', 'Access-Control-Request-Method': 'POST'})
check('another site\'s preflight is refused', s == 403 and 'access-control-allow-origin' not in h)
s, h, b = req('POST', '/speak', {'text': 'Good morning!'}, headers={'Origin': SITE})
ok_wav = False
try:
    with wave.open(io.BytesIO(b), 'rb') as w:
        ok_wav = w.getnchannels() == 1 and w.getframerate() == 22050 and w.getnframes() > 0
except wave.Error:
    pass
check('POST /speak -> a WAV the page can play', s == 200 and h.get('content-type') == 'audio/wav' and ok_wav
      and h.get('access-control-allow-origin') == SITE and h.get('cache-control') == 'no-store')
s, h, b = req('POST', '/speak', {'text': 'Hello', 'voice': 'other', 'rate': 1.25}, headers={'Origin': SITE})
check('a voice and a rate are passed on', s == 200 and engine.calls[-1] == {'chars': 5, 'voice': 'other', 'rate': 1.25})
s, h, b = req('POST', '/speak', {'text': 'Hello', 'voice': 'nope'}, headers={'Origin': SITE})
check('an unknown voice is a 400 the page can read', s == 400 and 'no voice' in json.loads(b)['error']
      and h.get('access-control-allow-origin') == SITE)
s, h, b = req('POST', '/speak', {'text': 'x' * 1001}, headers={'Origin': SITE})
check('too much text is a 400', s == 400)
s, h, b = req('POST', '/speak', raw=b'x' * (T.MAX_BODY + 1), headers={'Origin': SITE})
check('a body over 8 KB is refused unread (413)', s == 413)
s, h, b = req('POST', '/speak', raw=b'text=hi', headers={'Origin': SITE, 'Content-Type': 'application/x-www-form-urlencoded'})
check('a form post is refused (415): JSON only', s == 415)
s, h, b = req('POST', '/speak', raw=b'not json', headers={'Origin': SITE})
check('a broken body is a 400, and the program carries on', s == 400 and req('GET', '/health')[0] == 200)
s, h, b = req('GET', '/speak', headers={'Origin': SITE})
check('an unknown path is 404', s == 404 and req('POST', '/nope', {'text': 'x'})[0] == 404)
s, h, b = req('PUT', '/speak', {'text': 'x'})
check('other methods are 405', s == 405)
check('the server does not name its Python', 'python' not in h.get('server', '').lower())

before = len(engine.calls)


class Broken(T.FakeEngine):
    def synthesize(self, text, voice='', rate=None):
        raise RuntimeError('model gone')


srv2 = T.create_server(Broken(), '127.0.0.1', 0, quiet=True)
port2 = srv2.server_address[1]
threading.Thread(target=srv2.serve_forever, daemon=True).start()
c = http.client.HTTPConnection('127.0.0.1', port2, timeout=10)
c.request('POST', '/speak', body=b'{"text": "hi"}', headers={'Content-Type': 'application/json', 'Host': '127.0.0.1'})
r = c.getresponse()
r.read()
c.close()
check('a broken voice is a 500 (the page uses the browser\'s voice), never a crash', r.status == 500)
srv2.shutdown()

# Nothing said is written anywhere: the log line has the length only.
buf = io.StringIO()
old = sys.stderr
sys.stderr = buf
try:
    srv3 = T.create_server(T.FakeEngine(), '127.0.0.1', 0, quiet=False)
    p3 = srv3.server_address[1]
    threading.Thread(target=srv3.serve_forever, daemon=True).start()
    c = http.client.HTTPConnection('127.0.0.1', p3, timeout=10)
    c.request('POST', '/speak', body=json.dumps({'text': 'My secret sentence'}).encode(),
              headers={'Content-Type': 'application/json', 'Host': '127.0.0.1'})
    c.getresponse().read()
    c.close()
    srv3.shutdown()
finally:
    sys.stderr = old
check('the log never has the words, only how many', 'secret' not in buf.getvalue() and '18 characters' in buf.getvalue(), buf.getvalue())

srv.shutdown()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
