#!/usr/bin/env python3
"""nimrod-ha-bridge.py - THE SCREEN'S BRIDGE TO HOME ASSISTANT (row 2.125; the plan is docs/home-assistant-plan.md).

Mike, 2026-10-25: "Home Assistant control - This is something we should really do."

WHY A BRIDGE: the screen loads the site over HTTPS, and most Home Assistant installs answer on plain
http://homeassistant.local:8123, which a browser will not call from an HTTPS page. A page MAY call this computer's own
127.0.0.1 (the lock helper beside this file proves it, with the same Chromium policy). So the page asks this bridge, and
the bridge, on the home network, asks Home Assistant. THE TOKEN LIVES HERE, in a file only this user can read: never in
the web page, never on the platform's server, and never sent back to anybody (the page sees its first and last four
characters, the way the site shows any pass phrase).

WHAT THE PAGE MAY ASK (JSON; every request from the kiosk site's Origin only, like the lock helper's POSTs; nothing at
all from another site, which a browser will not even send - the preflight fails):
    GET  /ha/status                     connected or not, the address, the token's ends, what is ticked
    POST /ha/connect  {url, token}      checks GET <url>/api/ answers "API running." with that token, then keeps both
    POST /ha/forget                     forgets the address, the token and the ticks
    GET  /ha/entities                   the things Home Assistant has that this screen could control (by domain, below)
    POST /ha/choose   {entity_id, on, label?}   tick (with the person's own name for it) or untick a thing
    POST /ha/settings {allowDoors}      the "Allow doors and locks" setting (off)
    GET  /ha/states                     the ticked things, as they are now
    POST /ha/call     {entity_id, action}       one of that thing's actions (ACTIONS); ticked things only

HOME ASSISTANT'S REST API (checked against its documentation, 2026-10-25): `Authorization: Bearer <token>`;
`GET /api/` -> {"message": "API running."}; `GET /api/states` -> [{entity_id, state, attributes, ...}];
`POST /api/services/<domain>/<service>` with {"entity_id": ...} waits for the action and returns the changed states.
The WebSocket API (live state) is the next step; until then the page asks /ha/states every few seconds.

WHAT IT WILL NOT DO, each a default argued in the plan, not a rule: control a thing nobody ticked; control a door, a
lock or a cover unless "Allow doors and locks" is on; anything but the listed actions (no arbitrary service calls);
listen anywhere but 127.0.0.1.

HARD-CODED, each with its reason:
    port 8766     beside the lock helper's 8765; free on both Pis (8080 is the old dashboard). NIMROD_HA_PORT moves it.
    5 s           how long a call to Home Assistant may take before the page is told it did not answer: a lamp that
                  has not changed in five seconds is not going to.
    4096 bytes    the page sends an address and a token at most; anything bigger is not the page.

Stdlib only (python3 on Raspberry Pi OS). Tested by test_ha_bridge.py next to it, against web/tools/pretend_home_assistant.py.
"""
import json
import os
import signal
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PORT = int(os.environ.get('NIMROD_HA_PORT', '8766'))
TIMEOUT_S = 5
MAX_BODY = 4096

# The things a screen may control, and what each may do: action -> (service, extra data). The first version's set
# (docs/home-assistant-plan.md "The first actions"); DOORS only with "Allow doors and locks".
ACTIONS = {
    'light': {'on': ('turn_on', {}), 'off': ('turn_off', {}), 'toggle': ('toggle', {}),
              'brighter': ('turn_on', {'brightness_step_pct': 20}), 'dimmer': ('turn_on', {'brightness_step_pct': -20})},
    'fan': {'on': ('turn_on', {}), 'off': ('turn_off', {}), 'toggle': ('toggle', {})},
    'switch': {'on': ('turn_on', {}), 'off': ('turn_off', {}), 'toggle': ('toggle', {})},
    'media_player': {'on': ('turn_on', {}), 'off': ('turn_off', {}), 'louder': ('volume_up', {}), 'quieter': ('volume_down', {}),
                     'pause': ('media_play_pause', {})},
    'scene': {'on': ('turn_on', {})},
}
DOORS = {
    'lock': {'lock': ('lock', {}), 'unlock': ('unlock', {})},
    'cover': {'open': ('open_cover', {}), 'close': ('close_cover', {}), 'stop': ('stop_cover', {})},
}


def config_path():
    p = os.environ.get('NIMROD_HA_CONFIG')
    if p:
        return p
    base = os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config')
    return os.path.join(base, 'nimrod', 'home-assistant.json')


def origin_of(url):
    try:
        u = urlsplit(url)
    except ValueError:
        return None
    if u.scheme not in ('http', 'https') or not u.hostname:
        return None
    default = {'http': 80, 'https': 443}[u.scheme]
    port = f':{u.port}' if u.port and u.port != default else ''
    return f'{u.scheme}://{u.hostname.lower()}{port}'


def allowed_origins():
    raw = os.environ.get('NIMROD_HA_ORIGINS', '').strip()
    if raw:
        return {o for o in (origin_of(x.strip()) for x in raw.split(',')) if o}
    o = origin_of(os.environ.get('NIMROD_KIOSK_URL', ''))
    return {o} if o else set()


def read_config():
    try:
        with open(config_path(), encoding='utf-8') as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def write_config(c):
    path = config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.ha-', dir=os.path.dirname(path))
    try:
        try:
            os.chmod(tmp, 0o600)      # the token: this user only
        except OSError:
            pass
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(c, f, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def token_hint(token):
    t = str(token or '')
    return f'{t[:4]}…{t[-4:]}' if len(t) > 12 else ('set' if t else '')


def clean_url(url):
    """The Home Assistant address, as scheme://host[:port] with no path. None: not an http(s) address."""
    try:
        u = urlsplit(str(url or '').strip())
    except ValueError:
        return None
    if u.scheme not in ('http', 'https') or not u.hostname:
        return None
    return f'{u.scheme}://{u.netloc}'


def actions_for(domain, allow_doors=False):
    if domain in ACTIONS:
        return ACTIONS[domain]
    if allow_doors and domain in DOORS:
        return DOORS[domain]
    return None


class HAError(Exception):
    def __init__(self, reason, status=502):
        super().__init__(reason)
        self.reason, self.status = reason, status


def ha(url, token, method, path, body=None):
    """One request to Home Assistant. Returns the parsed JSON; raises HAError with words a person can read."""
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url + path, data=data, method=method,
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise HAError('Home Assistant refused the token', 401)
        if e.code == 404:
            raise HAError('Home Assistant does not have that', 404)
        raise HAError(f'Home Assistant answered {e.code}', 502)
    except (urllib.error.URLError, OSError, ValueError):
        raise HAError('Home Assistant did not answer at that address', 504)
    try:
        return json.loads(raw.decode('utf-8') or 'null')
    except ValueError:
        raise HAError('Home Assistant answered with something that is not JSON', 502)


def entity_row(s, cfg):
    eid = s.get('entity_id', '')
    domain = eid.split('.', 1)[0]
    chosen = (cfg.get('chosen') or {}).get(eid)
    attrs = s.get('attributes') or {}
    acts = actions_for(domain, cfg.get('allowDoors'))
    row = {'entity_id': eid, 'domain': domain, 'name': attrs.get('friendly_name') or eid, 'state': s.get('state'),
           'ticked': bool(chosen), 'label': (chosen or {}).get('label') or '', 'actions': sorted(acts) if acts else []}
    if 'brightness' in attrs:
        row['brightness'] = attrs.get('brightness')
    return row


class Handler(BaseHTTPRequestHandler):
    server_version = 'nimrod-ha-bridge'

    def log_message(self, fmt, *args):      # one line per request, never a body (it may hold the token)
        sys.stderr.write('ha bridge: %s %s\n' % (self.command, urlsplit(self.path).path))

    def _origin_ok(self):
        o = self.headers.get('Origin')
        return o if o and origin_of(o) in self.server.origins else None

    def _reply(self, code, obj=None, origin=None):
        body = json.dumps(obj if obj is not None else {}).encode('utf-8')
        self.send_response(code)
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self, origin):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            self._reply(413, {'ok': False, 'reason': 'too big'}, origin)
            return None
        try:
            b = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        except ValueError:
            self._reply(400, {'ok': False, 'reason': 'not JSON'}, origin)
            return None
        if not isinstance(b, dict):
            self._reply(400, {'ok': False, 'reason': 'not an object'}, origin)
            return None
        return b

    def do_OPTIONS(self):
        origin = self._origin_ok()
        if not origin or not urlsplit(self.path).path.startswith('/ha/'):
            return self._reply(403, {'ok': False, 'reason': 'origin'})
        self._reply(204, origin=origin)

    def do_GET(self):
        origin = self._origin_ok()
        if not origin:
            return self._reply(403, {'ok': False, 'reason': 'origin'})
        path = urlsplit(self.path).path
        cfg = read_config()
        try:
            if path == '/ha/status':
                return self._reply(200, {'ok': True, 'connected': bool(cfg.get('url') and cfg.get('token')),
                                         'url': cfg.get('url') or '', 'token': token_hint(cfg.get('token')),
                                         'allowDoors': bool(cfg.get('allowDoors')),
                                         'chosen': {k: v.get('label', '') for k, v in (cfg.get('chosen') or {}).items()}}, origin)
            if not (cfg.get('url') and cfg.get('token')):
                return self._reply(409, {'ok': False, 'reason': 'not connected'}, origin)
            if path == '/ha/entities':
                states = ha(cfg['url'], cfg['token'], 'GET', '/api/states') or []
                rows = [entity_row(s, cfg) for s in states if isinstance(s, dict)]
                return self._reply(200, {'ok': True, 'entities': [r for r in rows if r['actions']]}, origin)
            if path == '/ha/states':
                chosen = cfg.get('chosen') or {}
                states = ha(cfg['url'], cfg['token'], 'GET', '/api/states') or []
                rows = [entity_row(s, cfg) for s in states if isinstance(s, dict) and s.get('entity_id') in chosen]
                return self._reply(200, {'ok': True, 'states': rows}, origin)
        except HAError as e:
            return self._reply(e.status, {'ok': False, 'reason': e.reason}, origin)
        self._reply(404, {'ok': False, 'reason': 'no such thing'}, origin)

    def do_POST(self):
        origin = self._origin_ok()
        if not origin:
            return self._reply(403, {'ok': False, 'reason': 'origin'})
        path = urlsplit(self.path).path
        b = self._body(origin)
        if b is None:
            return
        with self.server.lock:
            cfg = read_config()
            try:
                if path == '/ha/connect':
                    url, token = clean_url(b.get('url')), str(b.get('token') or '').strip()
                    if not url or not token:
                        return self._reply(400, {'ok': False, 'reason': 'an address (http:// or https://) and a token, please'}, origin)
                    got = ha(url, token, 'GET', '/api/')
                    if not (isinstance(got, dict) and got.get('message') == 'API running.'):
                        return self._reply(502, {'ok': False, 'reason': 'that address answered, but not as Home Assistant'}, origin)
                    keep = {'url': url, 'token': token, 'chosen': cfg.get('chosen') if cfg.get('url') == url else {},
                            'allowDoors': bool(cfg.get('allowDoors'))}
                    write_config(keep)
                    return self._reply(200, {'ok': True, 'url': url, 'token': token_hint(token)}, origin)
                if path == '/ha/forget':
                    try:
                        os.unlink(config_path())
                    except OSError:
                        pass
                    return self._reply(200, {'ok': True}, origin)
                if path == '/ha/settings':
                    if 'allowDoors' in b:
                        # Turned off, a door ticked before stays named but cannot be called (/ha/call checks it).
                        cfg['allowDoors'] = b.get('allowDoors') is True
                        write_config(cfg)
                    return self._reply(200, {'ok': True, 'allowDoors': bool(cfg.get('allowDoors'))}, origin)
                if not (cfg.get('url') and cfg.get('token')):
                    return self._reply(409, {'ok': False, 'reason': 'not connected'}, origin)
                if path == '/ha/choose':
                    eid = str(b.get('entity_id') or '')
                    domain = eid.split('.', 1)[0]
                    if '.' not in eid or not actions_for(domain, True):
                        return self._reply(400, {'ok': False, 'reason': 'not a thing this screen can control'}, origin)
                    chosen = dict(cfg.get('chosen') or {})
                    if b.get('on') is False:
                        chosen.pop(eid, None)
                    else:
                        chosen[eid] = {'label': str(b.get('label') or '').strip()[:60]}
                    cfg['chosen'] = chosen
                    write_config(cfg)
                    return self._reply(200, {'ok': True, 'chosen': {k: v.get('label', '') for k, v in chosen.items()}}, origin)
                if path == '/ha/call':
                    eid, action = str(b.get('entity_id') or ''), str(b.get('action') or '')
                    if eid not in (cfg.get('chosen') or {}):
                        return self._reply(403, {'ok': False, 'reason': 'that thing is not ticked for this screen'}, origin)
                    domain = eid.split('.', 1)[0]
                    acts = actions_for(domain, cfg.get('allowDoors'))
                    if not acts:
                        return self._reply(403, {'ok': False, 'reason': 'doors and locks are off on this screen'}, origin)
                    if action not in acts:
                        return self._reply(400, {'ok': False, 'reason': f'{domain} cannot "{action}"'}, origin)
                    service, extra = acts[action]
                    ha(cfg['url'], cfg['token'], 'POST', f'/api/services/{domain}/{service}', {'entity_id': eid, **extra})
                    return self._reply(200, {'ok': True, 'entity_id': eid, 'action': action}, origin)
            except HAError as e:
                return self._reply(e.status, {'ok': False, 'reason': e.reason}, origin)
        self._reply(404, {'ok': False, 'reason': 'no such thing'}, origin)


def make_server(port=PORT, origins=None):
    httpd = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    httpd.origins = allowed_origins() if origins is None else set(origins)
    httpd.lock = threading.Lock()
    return httpd


def main(argv):
    httpd = make_server()
    if not httpd.origins:
        sys.stderr.write('ha bridge: no site origin (set NIMROD_KIOSK_URL or NIMROD_HA_ORIGINS); refusing every request\n')

    def stop(*_):
        threading.Thread(target=httpd.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    sys.stderr.write(f'ha bridge: on 127.0.0.1:{httpd.server_address[1]} for {", ".join(sorted(httpd.origins)) or "nobody"}\n')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
