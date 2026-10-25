#!/usr/bin/env python3
"""pretend_home_assistant.py - A PRETEND HOME ASSISTANT, so Home Assistant control is tested with no hub (row 2.125).

docs/home-assistant-plan.md, "Testing without a hub": the bridge (web/kiosk_installer/deploy/nimrod-ha-bridge.py) and
the page are tested against this. It answers the parts of Home Assistant's REST API the bridge uses, in Home Assistant's
own shapes (checked against its documentation, 2026-10-25):
    GET  /api/                              {"message": "API running."}
    GET  /api/states                        [{entity_id, state, attributes, last_changed, last_updated, ...}]
    GET  /api/states/<entity_id>            one, or 404
    POST /api/services/<domain>/<service>   {"entity_id": ...} -> the changed states; an unknown service is 400
Every request needs `Authorization: Bearer <token>` (401 otherwise). The things in it: two lights, a fan, a TV, a scene,
and a front door lock (for "Allow doors and locks"). It keeps every call it was asked, for a test to read (`calls`).

Run by hand:  py -3.13 web/tools/pretend_home_assistant.py --port 8123 --token pretend-token
"""
import argparse
import copy
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DEVICES = {
    'light.lamp': {'state': 'off', 'attributes': {'friendly_name': 'Lamp', 'brightness': 0}},
    'light.big_light': {'state': 'on', 'attributes': {'friendly_name': 'Big light', 'brightness': 255}},
    'fan.ceiling_fan': {'state': 'off', 'attributes': {'friendly_name': 'Ceiling fan'}},
    'media_player.tv': {'state': 'off', 'attributes': {'friendly_name': 'TV', 'volume_level': 0.3}},
    'scene.evening': {'state': 'scening', 'attributes': {'friendly_name': 'Evening'}},
    'lock.front_door': {'state': 'locked', 'attributes': {'friendly_name': 'Front door'}},
    'sensor.temperature': {'state': '21', 'attributes': {'friendly_name': 'Temperature', 'unit_of_measurement': '°C'}},
}


def now():
    return time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime())


class Pretend:
    def __init__(self, token='pretend-token'):
        self.token = token
        self.devices = copy.deepcopy(DEVICES)
        self.calls = []
        self.lock = threading.Lock()

    def state(self, eid):
        d = self.devices[eid]
        return {'entity_id': eid, 'state': d['state'], 'attributes': d['attributes'], 'last_changed': now(),
                'last_reported': now(), 'last_updated': now(), 'context': {'id': 'x', 'parent_id': None, 'user_id': None}}

    def service(self, domain, service, data):
        eid = data.get('entity_id')
        if eid not in self.devices or not eid.startswith(domain + '.'):
            return None
        d = self.devices[eid]
        a = d['attributes']
        if service == 'turn_on':
            d['state'] = 'on' if domain != 'scene' else 'scening'
            if domain == 'light':
                step = data.get('brightness_step_pct')
                a['brightness'] = max(0, min(255, (a.get('brightness') or 0) + round(255 * step / 100))) if step else 255
                if a['brightness'] == 0:
                    d['state'] = 'off'
        elif service == 'turn_off':
            d['state'] = 'off'
            if domain == 'light':
                a['brightness'] = 0
        elif service == 'toggle':
            return self.service(domain, 'turn_off' if d['state'] == 'on' else 'turn_on', data)
        elif service in ('volume_up', 'volume_down'):
            a['volume_level'] = round(max(0, min(1, a.get('volume_level', 0) + (0.1 if service == 'volume_up' else -0.1))), 2)
        elif service == 'media_play_pause':
            d['state'] = 'paused' if d['state'] == 'playing' else 'playing'
        elif service in ('lock', 'unlock'):
            d['state'] = 'locked' if service == 'lock' else 'unlocked'
        else:
            return False
        return [self.state(eid)]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth(self):
        if self.headers.get('Authorization') != f'Bearer {self.server.ha.token}':
            self._send(401, {'message': 'Unauthorized'})
            return False
        return True

    def do_GET(self):
        if not self._auth():
            return
        p = urlsplit(self.path).path
        ha = self.server.ha
        with ha.lock:
            if p == '/api/':
                return self._send(200, {'message': 'API running.'})
            if p == '/api/states':
                return self._send(200, [ha.state(e) for e in ha.devices])
            if p.startswith('/api/states/'):
                eid = p[len('/api/states/'):]
                return self._send(200, ha.state(eid)) if eid in ha.devices else self._send(404, {'message': 'Entity not found.'})
        self._send(404, {'message': 'Not found'})

    def do_POST(self):
        if not self._auth():
            return
        parts = urlsplit(self.path).path.strip('/').split('/')
        n = int(self.headers.get('Content-Length') or 0)
        try:
            data = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        except ValueError:
            return self._send(400, {'message': 'Invalid JSON'})
        if len(parts) == 4 and parts[:2] == ['api', 'services']:
            ha = self.server.ha
            with ha.lock:
                ha.calls.append((parts[2], parts[3], data))
                out = ha.service(parts[2], parts[3], data)
            if out is False:
                return self._send(400, {'message': f'Service {parts[2]}.{parts[3]} not found.'})
            return self._send(200, out or [])
        self._send(404, {'message': 'Not found'})


def start(port=0, token='pretend-token'):
    """Start one in a thread. Returns (server, pretend, base url)."""
    httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    httpd.ha = Pretend(token)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.ha, f'http://127.0.0.1:{httpd.server_address[1]}'


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--port', type=int, default=8123)
    ap.add_argument('--token', default='pretend-token')
    a = ap.parse_args()
    httpd = ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    httpd.ha = Pretend(a.token)
    print(f'pretend Home Assistant on http://127.0.0.1:{a.port} (token: the one given with --token)')
    httpd.serve_forever()
