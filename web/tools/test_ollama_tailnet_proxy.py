#!/usr/bin/env python3
"""ollama_tailnet_proxy.py: the Host header rewritten, only the site's three requests passed on, the Origin passed
through and Ollama's CORS answer passed back, a body cap, loopback only. Against a FAKE Ollama (a tiny server here
that records what it was sent). Then, if a real Ollama answers on 127.0.0.1:11434, one read-only check through the
proxy: the list of models, sent with a Tailscale name as the Host - the request that is 403 without the proxy.
Nothing is installed, and Ollama's settings are not touched.

Run, from web/:
    py -3.13 tools/test_ollama_tailnet_proxy.py
"""
from __future__ import annotations

import http.client
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ollama_tailnet_proxy as P  # noqa: E402

passed = 0
failed = 0


def check(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print(f'PASS  {name}')
    else:
        failed += 1
        print(f'FAIL  {name}   {detail}')


SEEN = []


class FakeOllama(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def _answer(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n) if n else b''
        SEEN.append({'method': self.command, 'path': self.path, 'host': self.headers.get('Host'),
                     'origin': self.headers.get('Origin'), 'body': body})
        # Like Ollama: a Host that is not its own is refused.
        if self.headers.get('Host', '').split(':')[0] not in ('127.0.0.1', 'localhost'):
            self.send_response(403); self.send_header('Content-Length', '0'); self.end_headers(); return
        out = json.dumps({'object': 'list', 'data': [{'id': 'qwen2.5:3b'}]}).encode()
        self.send_response(204 if self.command == 'OPTIONS' else 200)
        if self.headers.get('Origin') == 'https://nimrodecosystem.com':
            self.send_header('Access-Control-Allow-Origin', 'https://nimrodecosystem.com')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', '0' if self.command == 'OPTIONS' else str(len(out)))
        self.end_headers()
        if self.command != 'OPTIONS':
            self.wfile.write(out)

    do_GET = do_POST = do_OPTIONS = do_DELETE = _answer


def serve(srv):
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return t


def ask(port, method, path, headers=None, body=None):
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    data = r.read()
    out = (r.status, dict(r.getheaders()), data)
    c.close()
    return out


fake = ThreadingHTTPServer(('127.0.0.1', 0), FakeOllama)
serve(fake)
up = f'127.0.0.1:{fake.server_address[1]}'
proxy = P.make_server(0, up)
serve(proxy)
pp = proxy.server_address[1]
TS = 'desktop-56volbn.tailce89ac.ts.net:8443'

st, hd, data = ask(pp, 'GET', '/v1/models', {'Host': TS, 'Origin': 'https://nimrodecosystem.com'})
check('*** a request carrying the Tailscale name reaches Ollama with Ollama\'s own name as the Host ***',
      st == 200 and SEEN[-1]['host'] == up, f'{st} {SEEN[-1] if SEEN else None}')
check('...the Origin is passed on, so Ollama\'s allow-list (OLLAMA_ORIGINS) still decides', SEEN[-1]['origin'] == 'https://nimrodecosystem.com')
check('...and Ollama\'s CORS answer comes back', hd.get('Access-Control-Allow-Origin') == 'https://nimrodecosystem.com', str(hd))
check('...with the body', json.loads(data)['data'][0]['id'] == 'qwen2.5:3b')

body = json.dumps({'model': 'qwen2.5:3b', 'messages': [{'role': 'user', 'content': 'hi'}]}).encode()
st, _, _ = ask(pp, 'POST', '/v1/chat/completions', {'Host': TS, 'Content-Type': 'application/json', 'Content-Length': str(len(body))}, body)
check('a chat request is passed on, body intact', st == 200 and SEEN[-1]['body'] == body and SEEN[-1]['method'] == 'POST')
st, _, _ = ask(pp, 'POST', '/api/chat', {'Host': TS, 'Content-Length': str(len(body))}, body)
check('Ollama\'s own /api/chat (ai.js contextTokens) is passed on', st == 200 and SEEN[-1]['path'] == '/api/chat')
st, _, _ = ask(pp, 'OPTIONS', '/v1/chat/completions', {'Host': TS, 'Origin': 'https://nimrodecosystem.com',
                                                        'Access-Control-Request-Method': 'POST'})
check('the browser\'s preflight is passed on', st == 204 and SEEN[-1]['method'] == 'OPTIONS')

n = len(SEEN)
refused = []
for method, path in [('POST', '/api/pull'), ('DELETE', '/api/delete'), ('POST', '/api/create'), ('POST', '/api/copy'),
                     ('POST', '/api/generate'), ('GET', '/api/tags'), ('GET', '/'), ('POST', '/v1/models'), ('HEAD', '/v1/models')]:
    st, _, _ = ask(pp, method, path, {'Host': TS, 'Content-Length': '0'})
    refused.append(st)
check('*** everything else - pull, delete, create, copy, generate, the tags list - is NOT passed on ***',
      all(s == 404 for s in refused) and len(SEEN) == n, f'{refused} {len(SEEN) - n} reached')
big = b'x' * (P.MAX_BODY + 1)
st, _, _ = ask(pp, 'POST', '/v1/chat/completions', {'Host': TS, 'Content-Length': str(len(big))}, big)
check('a body over the cap is refused before it reaches Ollama', st == 413 and len(SEEN) == n)
try:
    P.make_server(0, up, host='0.0.0.0')
    check('it will not listen on the network, only on this computer', False)
except SystemExit:
    check('it will not listen on the network, only on this computer', True)

fake.shutdown(); fake.server_close()
st, _, _ = ask(pp, 'GET', '/v1/models', {'Host': TS})
check('Ollama not running: a plain 502, not a hang', st == 502)
proxy.shutdown(); proxy.server_close()

# ---- the real Ollama on this computer, if there is one: read-only ---------------------------------------------
try:
    c = http.client.HTTPConnection('127.0.0.1', 11434, timeout=5)
    c.request('GET', '/v1/models', headers={'Host': TS})
    direct = c.getresponse().status
    c.close()
except OSError:
    direct = None
if direct is None:
    print('SKIP  no Ollama on 127.0.0.1:11434: the live check did not run')
else:
    check('(live) Ollama itself refuses the Tailscale name: the reason this proxy exists', direct == 403, str(direct))
    real = P.make_server(0, P.DEFAULT_UPSTREAM)
    serve(real)
    st, hd, data = ask(real.server_address[1], 'GET', '/v1/models', {'Host': TS, 'Origin': 'https://nimrodecosystem.com'})
    ids = [m.get('id') for m in json.loads(data or b'{}').get('data', [])] if st == 200 else []
    check('(live) *** through the proxy, the same request is answered: the models ***', st == 200 and len(ids) > 0, f'{st} {ids}')
    real.shutdown(); real.server_close()

print(f'\n{"ALL PASS" if failed == 0 else f"{failed} FAILED"} - {passed} passed')
sys.exit(1 if failed else 0)
