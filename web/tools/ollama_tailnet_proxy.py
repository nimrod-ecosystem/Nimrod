#!/usr/bin/env python3
"""ollama_tailnet_proxy.py - let a screen in the house use this computer's Ollama, through `tailscale serve`.

*** WHY THIS EXISTS: `tailscale serve` + Ollama ALONE ANSWERS 403. *** Measured 2026-10-12 on this desktop
(Ollama 0.35.1): Ollama bound to 127.0.0.1 refuses any request whose Host header is not its own name
(localhost, 127.0.0.1, the bare computer name, or *.local / *.internal), a guard against DNS rebinding:

    curl -H "Host: desktop-56volbn.tailce89ac.ts.net" http://127.0.0.1:11434/v1/models   -> 403
    curl                                                http://127.0.0.1:11434/v1/models   -> 200

and `tailscale serve` passes the visitor's Host header through unchanged (its reverse proxy sets
`r.Out.Host = r.In.Host` for a TCP backend, ipn/ipnlocal/serve.go). Ollama's own FAQ says the same for every
proxy it documents: nginx `proxy_set_header Host localhost:11434`, ngrok `--host-header="localhost:11434"`,
cloudflared `--http-host-header="localhost:11434"`. `tailscale serve` has no such option. This is that one
line, as a program: it listens on 127.0.0.1:11435, sets Host to Ollama's own, and forwards.

*** AND IT LETS THROUGH ONLY WHAT THE SITE USES. *** Ollama has no password: anybody who can reach it can
pull, copy or DELETE models. Behind this, a device on the tailnet can only do what ai.js does:

    GET  /v1/models              (the list of models)
    POST /v1/chat/completions    (a reply)
    POST /api/chat               (a reply with a context size, ai.js `contextTokens`)
    OPTIONS on those three       (the browser's CORS preflight)

Everything else is 404. The visitor's Origin is passed on untouched, so Ollama's own allow-list
(OLLAMA_ORIGINS) still decides which websites may use it, and Ollama's CORS answer comes back as it is.

Standard library only: nothing to install. Binds loopback only; `--port` changes the port.

    py -3.13 tools/ollama_tailnet_proxy.py                 # 127.0.0.1:11435 -> 127.0.0.1:11434
    tailscale serve --bg --https=8443 http://127.0.0.1:11435

The steps, in plain words: web/speech_service/DESKTOP_AI_MODEL.md. Tested: tools/test_ollama_tailnet_proxy.py.
"""
from __future__ import annotations

import argparse
import http.client
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 11435
DEFAULT_UPSTREAM = '127.0.0.1:11434'
# What the site asks of an Ollama (client/ai.js). Nothing else gets through.
ALLOWED = {
    ('GET', '/v1/models'), ('POST', '/v1/chat/completions'), ('POST', '/api/chat'),
    ('OPTIONS', '/v1/models'), ('OPTIONS', '/v1/chat/completions'), ('OPTIONS', '/api/chat'),
}
# A chat request is a few kilobytes; a whole story's context is tens. 1 MB is generous and stops a flood.
MAX_BODY = 1024 * 1024
# A 7B model on a CPU can take minutes for a long answer (ai.js's own default is 10 minutes).
UPSTREAM_TIMEOUT_S = 600
HOP = {'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers',
       'transfer-encoding', 'upgrade', 'host', 'content-length'}
LOOPBACK = {'127.0.0.1', 'localhost', '::1'}


def allowed(method: str, path: str) -> bool:
    return (method.upper(), path.split('?', 1)[0]) in ALLOWED


def make_handler(upstream: str):
    host, _, port = upstream.rpartition(':')
    up_port = int(port)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        server_version = 'nimrod-ollama-proxy'

        def log_message(self, fmt, *args):  # one short line each, no bodies
            sys.stderr.write('%s %s\n' % (self.command, self.path.split('?', 1)[0]))

        def _plain(self, code: int, text: str):
            body = text.encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _forward(self):
            if not allowed(self.command, self.path):
                return self._plain(404, 'Not something this proxy passes on.')
            n = int(self.headers.get('Content-Length') or 0)
            if n > MAX_BODY:
                return self._plain(413, 'Too large.')
            body = self.rfile.read(n) if n > 0 else None
            headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            headers['Host'] = upstream          # *** the whole point: Ollama's own name ***
            try:
                conn = http.client.HTTPConnection(host, up_port, timeout=UPSTREAM_TIMEOUT_S)
                conn.request(self.command, self.path, body=body, headers=headers)
                res = conn.getresponse()
                data = res.read()
            except OSError:
                return self._plain(502, 'Ollama is not answering on this computer.')
            self.send_response(res.status, res.reason)
            for k, v in res.getheaders():
                if k.lower() not in HOP:
                    self.send_header(k, v)
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)
            conn.close()

        do_GET = _forward
        do_POST = _forward
        do_OPTIONS = _forward

        def do_PUT(self):
            self._plain(404, 'Not something this proxy passes on.')

        do_DELETE = do_PUT
        do_PATCH = do_PUT
        do_HEAD = do_PUT

    return Handler


def make_server(port: int = DEFAULT_PORT, upstream: str = DEFAULT_UPSTREAM, host: str = '127.0.0.1') -> ThreadingHTTPServer:
    if host not in LOOPBACK:
        raise SystemExit('This proxy listens on this computer only (127.0.0.1). tailscale serve is the way in.')
    return ThreadingHTTPServer((host, port), make_handler(upstream))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description='Pass the site\'s AI requests to this computer\'s Ollama, for tailscale serve.')
    p.add_argument('--port', type=int, default=DEFAULT_PORT, help=f'where this listens, on 127.0.0.1 (default {DEFAULT_PORT})')
    p.add_argument('--upstream', default=DEFAULT_UPSTREAM, help=f'Ollama\'s address (default {DEFAULT_UPSTREAM})')
    a = p.parse_args(argv)
    srv = make_server(a.port, a.upstream)
    print(f'Passing the site\'s AI requests from http://127.0.0.1:{a.port} to Ollama at http://{a.upstream}. Ctrl+C stops it.')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
